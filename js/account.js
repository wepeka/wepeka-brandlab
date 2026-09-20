// Per-user account/plan/paywall state — separate from store.js's brand/
// content data since this doc is keyed by uid (not shared team data) and
// most of its fields (plan/status/brandLimit) are intentionally NOT
// client-writable (see firestore.rules) — only the Midtrans webhook and
// wpk-dp's admin dashboard, both using the Admin SDK, can change them.
import { auth, db as fdb } from "./firebase.js";
import {
  doc, getDoc, setDoc, onSnapshot, runTransaction,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { t } from "./i18n.js";

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

// A plain read — nothing is created here anymore (Fase 2). Kept as its own
// function so callers don't have to know that; `boot()` in main.js awaits it
// before subscribing purely so the very first paint after a fresh sign-in
// already has a warm local cache instead of a beat of "loading" from
// subscribeAccount's own first snapshot.
export async function ensureAccountDoc(user) {
  await getDoc(doc(fdb, "accounts", user.uid));
}

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
  return onSnapshot(doc(fdb, "accounts", uid), (snap) => {
    fn(snap.exists() ? snap.data() : null);
  });
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
export function isReadOnly(account) {
  return account?.status === "readonly" || isTrialExpired(account);
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
export function canCreateBrand(currentBrandCount) {
  const limit = cachedAccount?.brandLimit ?? DEFAULT_BRAND_LIMIT;
  return currentBrandCount < limit;
}
