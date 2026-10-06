// Per-user account/plan/paywall state — separate from store.js's brand/
// content data since this doc is keyed by uid (not shared team data) and
// most of its fields (plan/status/brandLimit) are intentionally NOT
// client-writable (see firestore.rules) — only the Midtrans webhook and
// wpk-dp's admin dashboard, both using the Admin SDK, can change them.
// The Firestore SDK comes from loadFirestore() (js/firebase.js) inside each
// function that needs it — this module is part of the login screen's import
// graph, which must not download Firestore. `fdb` is set by that load.
import { auth, db as fdb, loadFirestore } from "./firebase.js";
import { t } from "./i18n.js";
import { brandAsStored, hasOversizedBlob } from "./brand-assets.js";

export const DEFAULT_BRAND_LIMIT = 3;

// A trial account is 30 days, 1 brand, Pro features, no card — but as of
// Fase 2 (.claude/handoff-satu-akun.md) this app never creates one itself.
// Only wpk-dp's Admin SDK does, when a Community member claims it after the
// trial starter mission (see api/community/brandlab-actions.ts#claimTrialAction);
// firestore.rules' `accounts` collection is `allow create: if false`. Kept
// here only because trialDaysLeft()/isTrial() below and the pricing page's
// copy still need the number.
export const TRIAL_DAYS = 30;
export const TRIAL_BRAND_LIMIT = 1;

// Wepeka's own internal team account — the only uid allowed to edit the
// shared AI config in settings/main (mirrored as a literal in
// firestore.rules; keep the two in sync). Every other account just reads it.
export const ADMIN_UIDS = ["iSwfTtIQm6VkYoHFbI6wl7BzBF53"];
export function isAdmin(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}

// Instagram Graph API features (connect account, import posts, fetch/refresh
// insights, account overview, followers sync) are "Segera hadir" for
// customers while the app is being sold — each customer would otherwise
// need their own Meta developer token. Only Wepeka's internal account keeps
// them. Every Instagram API entry point checks this one function.
export function canUseInstagramApi() {
  return isAdmin(currentUid());
}

// Nothing is created here anymore (Fase 2: accounts/{uid} is made server-
// side), and the extra read it used to do is gone too — subscribeAccount's
// listener already delivers the doc, from the local cache first. Kept as a
// no-op so nothing that still imports it breaks.
export async function ensureAccountDoc() {}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Global, case-insensitive unique handle — "Wepeka Account" in the UI,
// stored without its leading "@". Enforced via a claim-doc collection
// (usernames/{lowercased}) rather than a Firestore query, since Firestore
// has no native unique-field constraint: the claim doc's mere existence
// (or lack of it) IS the uniqueness check, done atomically in a transaction
// so two people can never win a race for the same handle. Changing an
// existing username releases the old claim in the same transaction.
export async function claimUsername(uid, rawUsername) {
  const username = rawUsername.trim().toLowerCase().replace(/^@+/, "");
  if (!USERNAME_RE.test(username)) {
    throw new Error(t("auth.username.invalid"));
  }
  const { doc, runTransaction } = await loadFirestore();
  const newClaimRef = doc(fdb, "usernames", username);
  const accountRef = doc(fdb, "accounts", uid);
  await runTransaction(fdb, async (tx) => {
    const [claimSnap, accountSnap] = await Promise.all([tx.get(newClaimRef), tx.get(accountRef)]);
    if (claimSnap.exists() && claimSnap.data().uid !== uid) {
      throw new Error(t("auth.username.taken", { username }));
    }
    const oldUsername = accountSnap.data()?.username;
    if (oldUsername && oldUsername !== username) {
      tx.delete(doc(fdb, "usernames", oldUsername));
    }
    tx.set(newClaimRef, { uid });
    tx.update(accountRef, { username });
  });
  return username;
}

// Fires once immediately with the current account state, then again on
// every change — a Midtrans webhook or admin action updates this doc via
// the Admin SDK, and this listener is what makes that unlock the app (or
// lock it) live, no refresh needed.
export function subscribeAccount(uid, fn) {
  let unsub = null;
  let stopped = false;
  loadFirestore()
    .then(({ doc, onSnapshot }) => {
      if (stopped) return;
      unsub = onSnapshot(doc(fdb, "accounts", uid), (snap) => {
        fn(snap.exists() ? snap.data() : null);
      });
    })
    // The SDK didn't download (offline / blocked): main.js's loader offers a
    // reload after a while, same as a listener that never answers.
    .catch((e) => console.error("[account] Firestore unavailable", e));
  return () => {
    stopped = true;
    if (unsub) unsub();
  };
}

export function isActive(account) {
  return account?.status === "active";
}
export function isTrial(account) {
  return account?.plan === "trial";
}
// The daily cron flips an ended trial to status "readonly", but only once a
// day — between the trial's last second and that run, the date itself is
// the answer (firestore.rules applies the same check to writes).
export function isTrialExpired(account) {
  return isTrial(account) && Number(account.trialEndsAt) <= Date.now();
}
export function trialDaysLeft(account) {
  if (!isTrial(account)) return 0;
  return Math.max(0, Math.ceil((Number(account.trialEndsAt) - Date.now()) / (24 * 60 * 60 * 1000)));
}
// A paid period that has run out is read-only from its last second, like a
// trial — not only once the daily cron flips status (firestore.rules
// enforces the same on writes; audit S-22).
export function isSubscriptionLapsed(account, now = Date.now()) {
  const ends = account?.subscriptionExpiresAt;
  return !!account && account.plan !== "trial" && typeof ends === "number" && ends <= now;
}
export function isReadOnly(account) {
  return account?.status === "readonly" || isTrialExpired(account) || isSubscriptionLapsed(account);
}
// JS mirror of firestore.rules' accountActive(): may this account write
// brands/content/settings right now? Kept here so the rule is unit-tested
// (tests/account-writable.test.mjs) — keep the two in sync.
export function writableByRules(account, now = Date.now()) {
  if (!account || account.status !== "active" || account.plan === "free") return false;
  if (account.plan === "trial") return Number(account.trialEndsAt) > now;
  return !isSubscriptionLapsed(account, now);
}
export function isDeactivated(account) {
  return account?.status === "deactivated";
}

// The one definition of "can this account use Brandlab right now" — mirrors
// wpk-dp's own brandlabAccess() (src/lib/brandlab-db.ts) exactly; keep the
// two in sync. See .claude/handoff-satu-akun.md section 5.
//   "paid"    — plan isn't free/trial, status active, sub not expired
//   "trial"   — plan is trial, status active, trialEndsAt in the future
//   "expired" — the doc exists but neither of the above (lapsed sub, ended
//               trial, readonly/deactivated, or a pre-Fase-2 "free" account)
//   "none"    — no accounts/{uid} doc at all
export function accessState(account) {
  if (!account) return "none";
  const now = Date.now();
  if (account.status === "active" && account.plan !== "free" && account.plan !== "trial"
    && (account.subscriptionExpiresAt == null || Number(account.subscriptionExpiresAt) > now)) {
    return "paid";
  }
  if (account.status === "active" && account.plan === "trial" && Number(account.trialEndsAt) > now) {
    return "trial";
  }
  return "expired";
}
// Pay-once plans ("lifetime" is the pre-subscription all-in-one plan). Some
// tools — Copy Studio — are reserved for these; Wepeka's own team account
// counts too.
export const LIFETIME_PLANS = ["founder", "founder-ultimate", "lifetime"];
export function isLifetime(account) {
  return LIFETIME_PLANS.includes(account?.plan) || isAdmin(account?.uid);
}

// "free" only exists on accounts created before the trial flow.
export function hasPaidPlan(account) {
  return !!account && account.plan !== "free" && account.plan !== "trial";
}

// Only these fields are safe for the signed-in user themselves to edit —
// everything else (plan/status/brandLimit/subscriptionExpiresAt/paidAt) is
// mirrored in firestore.rules as a deny-list against request.auth.uid writes.
export async function updateOwnDisplayName(uid, displayName) {
  const { doc, setDoc } = await loadFirestore();
  await setDoc(doc(fdb, "accounts", uid), { displayName }, { merge: true });
}

export function currentUid() {
  return auth.currentUser?.uid || null;
}

// main.js updates this on every accounts/{uid} snapshot — a small
// module-level cache so views (brand limit checks, a readonly banner, etc.)
// can read the current plan/status without threading it through every
// render() call signature.
let cachedAccount = null;
export function setCachedAccount(account) {
  cachedAccount = account;
}
export function getCachedAccount() {
  return cachedAccount;
}
// The plan's brand limit + permanent slots bought on a pay-once plan
// (accounts/{uid}.extraBrands) + monthly slots still running
// (accounts/{uid}.brandSlotsUntil). All written by the Midtrans webhook.
export function brandLimitOf(account = cachedAccount, now = Date.now()) {
  const base = account?.brandLimit ?? DEFAULT_BRAND_LIMIT;
  const bought = Math.max(0, Number(account?.extraBrands) || 0);
  const rented = (account?.brandSlotsUntil || []).filter((ts) => Number(ts) > now).length;
  return base + bought + rented;
}

// Brands that are preview-only: the active (not archived) brands beyond
// the limit, newest first to go. This used to apply only to accounts that
// had once rented a monthly slot, so a Studio → Starter downgrade kept
// using all 10 brands (audit S-16); now every account over its limit is
// held to it — a lapsed slot, a downgrade, or brands written around the
// app. Nothing is deleted; archiving an older brand frees its place, so the
// owner picks which ones stay open. Wepeka's own team account is exempt.
const isActiveBrand = (b) => !b.archived && !b.deletedAt;
export function lockedBrandIds(brands, account = cachedAccount, now = Date.now()) {
  if (!account || isAdmin(account?.uid) || isAdmin(currentUid())) return new Set();
  const limit = brandLimitOf(account, now);
  const active = (brands || []).filter(isActiveBrand)
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
  return new Set(active.slice(limit).map((b) => b.id));
}

// ---- "Impor JSON" guard (audit S-16 / S-20) --------------------------------
// js/store.js importJSON() runs every backup file through this before a
// single write: a bounded size, ids Firestore can take as plain doc ids
// (no "/" paths into other collections), brand colors that are hex codes
// (they end up inside style="" attributes), and — the billing part — no
// more active brands than the plan allows (an import used to create brands
// with no limit check at all). Throws an Error whose message is shown as
// is; JSON.parse's SyntaxError passes through for the "not a backup" text.
export const IMPORT_MAX_CHARS = 20 * 1024 * 1024;
const IMPORT_DOC_MAX_CHARS = 1000 * 1000; // Firestore caps a doc at 1 MiB
const IMPORT_COLLECTIONS = ["brands", "content", "campaigns", "routineTemplate", "brainstorms"];
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const hexOrBlank = (c) => (typeof c === "string" && HEX_COLOR.test(c.trim()) ? c.trim() : "");

export function checkImport(json, existingBrands = [], account = cachedAccount, now = Date.now()) {
  if (typeof json !== "string" || json.length > IMPORT_MAX_CHARS) throw new Error(t("pricing.import.tooBig", { mb: IMPORT_MAX_CHARS / 1024 / 1024 }));
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("pricing.import.badData"));
  for (const name of IMPORT_COLLECTIONS) {
    if (parsed[name] == null) continue;
    if (!Array.isArray(parsed[name])) throw new Error(t("pricing.import.badData"));
    for (const item of parsed[name]) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !SAFE_ID.test(item.id)) throw new Error(t("pricing.import.badData"));
      // A brand is measured as it will be stored: its files go to their own
      // asset docs (each checked against its own cap), its sales log to
      // brands/{id}/sales — js/store.js importJSON.
      const stored = name === "brands" ? brandAsStored(item) : item;
      if (JSON.stringify(stored).length > IMPORT_DOC_MAX_CHARS) throw new Error(t("pricing.import.docTooBig"));
      if (name === "brands" && hasOversizedBlob(item)) throw new Error(t("pricing.import.docTooBig"));
    }
  }
  parsed.brands = (parsed.brands || []).map((b) => {
    const colors = b.brandGuidelines?.colors;
    return {
      ...b,
      ...(b.color != null ? { color: hexOrBlank(b.color) } : {}),
      ...(colors && typeof colors === "object"
        ? { brandGuidelines: { ...b.brandGuidelines, colors: Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, hexOrBlank(v)])) } }
        : {}),
    };
  });
  if (!isAdmin(account?.uid) && !isAdmin(currentUid())) {
    // The brands this account would hold afterwards: the backup's, plus any
    // it already has that the backup doesn't overwrite (import never deletes).
    const imported = new Set(parsed.brands.map((b) => b.id));
    const before = (existingBrands || []).filter(isActiveBrand).length;
    const after = (existingBrands || []).filter((b) => isActiveBrand(b) && !imported.has(b.id)).length + parsed.brands.filter(isActiveBrand).length;
    const limit = brandLimitOf(account, now);
    if (after > limit && after > before) throw new Error(t("pricing.import.overLimit", { n: after, limit }));
  }
  return parsed;
}
export const isBrandLocked = (brandId, brands, account = cachedAccount) => lockedBrandIds(brands, account).has(brandId);

// The monthly slot ending soonest that is still running, for the "habis
// dalam 3 hari" reminder; null when none runs out within `withinMs`.
export function slotEndingSoon(account = cachedAccount, now = Date.now(), withinMs = 3 * 86400000) {
  const running = (account?.brandSlotsUntil || []).map(Number).filter((ts) => ts > now).sort((a, b) => a - b);
  return running.length && running[0] - now <= withinMs ? running[0] : null;
}
export function canCreateBrand(currentBrandCount) {
  return currentBrandCount < brandLimitOf();
}
