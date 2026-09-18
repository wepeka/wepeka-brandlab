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

// Every new account starts here: 7 days, 1 brand, Pro features, no card.
// When it ends the account goes read-only (data kept, nothing generated or
// edited) until a plan is bought — there is no permanent free plan.
// firestore.rules bounds trialEndsAt and the brand limit on create; keep
// these two numbers in sync with it.
export const TRIAL_DAYS = 7;
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

function defaultAccount(user) {
  return {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "",
    // Set once, right here, by ensureAccountDoc's transaction — a short,
    // memorable, human-referenceable id ("account #14") alongside the long
    // opaque Firebase uid, which is what actually keys every document.
    accountNumber: null,
    username: null,
    createdAt: Date.now(),
    plan: "trial",
    status: "active",
    brandLimit: TRIAL_BRAND_LIMIT,
    trialEndsAt: Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    subscriptionExpiresAt: null,
    paidAt: null,
  };
}

// Creates accounts/{uid} the first time a given uid ever signs in — every
// later sign-in (the overwhelming majority of calls, one per login) is a
// single plain getDoc(), not a transaction: a transaction needs a live
// round-trip to Firestore's backend and cannot be served from local
// persistence/cache the way a plain read can, so on a slow, proxied, or
// otherwise flaky connection it can hang far longer than a normal read
// would — every returning user would pay that cost on every login for a
// doc that, 99% of the time, already exists and needs no write at all.
// The transaction only runs on the genuinely rare path (this uid's very
// first sign-in ever), and even then only to atomically reserve the next
// accountNumber from meta/accountCounter so two brand-new signups landing
// at the same instant can never collide on the same number.
export async function ensureAccountDoc(user) {
  const ref = doc(fdb, "accounts", user.uid);
  const already = await getDoc(ref);
  if (already.exists()) return;

  const counterRef = doc(fdb, "meta", "accountCounter");
  await runTransaction(fdb, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) return;
    const counterSnap = await tx.get(counterRef);
    const nextNumber = counterSnap.exists() ? counterSnap.data().next || 1 : 1;
    tx.set(counterRef, { next: nextNumber + 1 }, { merge: true });
    tx.set(ref, { ...defaultAccount(user), accountNumber: nextNumber });
  });
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
