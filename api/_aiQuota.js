// Server-side mirror of the AI quota rules that used to live entirely in the
// browser (js/ai-usage.js) — moved here so a customer can no longer raise
// their own cap by editing localStorage/devtools. Three copies of the same
// numbers now exist by design (this file for enforcement, js/ai-usage.js for
// the client-side meter/UI, js/account.js + firestore.rules for the admin
// uid) — keep all of them in sync by hand.
//
// Usage doc: aiUsage/{uid} = { date, count, month, monthCount, totalCount }
// — same shape the old settings/{uid}.aiUsage carried, just owned by the
// server now (firestore.rules: client can read its own, never write it).

export const DEFAULT_AI_DAILY_LIMIT = 50;

// Mirrors js/ai-usage.js's PLAN_QUOTA exactly — keep the two in sync.
export const PLAN_QUOTA = {
  trial: { period: "total", limit: 60 },
  starter: { period: "day", limit: 20 },
  pro: { period: "day", limit: 60 },
  studio: { period: "day", limit: 200 },
  founder: { period: "month", limit: 300 },
  "founder-ultimate": { period: "month", limit: 500 },
};

// Wepeka's own internal team account — mirrors js/account.js's ADMIN_UIDS
// and firestore.rules' literal uid. Keep all three in sync.
export const ADMIN_UIDS = ["iSwfTtIQm6VkYoHFbI6wl7BzBF53"];
export function isAdminUid(uid) {
  return !!uid && ADMIN_UIDS.includes(uid);
}

function planQuota(account) {
  return PLAN_QUOTA[account?.plan] || { period: "day", limit: DEFAULT_AI_DAILY_LIMIT };
}

// Mirrors js/account.js's isTrialExpired()/isReadOnly().
function isTrialExpired(account) {
  return account?.plan === "trial" && Number(account?.trialEndsAt) <= Date.now();
}
function isReadOnlyAccount(account) {
  return account?.status === "readonly" || isTrialExpired(account);
}

// { period, limit } for this account right now — mirrors js/ai-usage.js's
// aiDailyLimit()/aiQuotaPeriod() exactly, including the quirk that the
// PERIOD always comes from the plan's own table even when aiDailyLimit
// overrides the LIMIT. Admin is unmetered; a read-only account (ended
// trial, lapsed subscription, admin-deactivated) gets zero; everyone else
// gets their plan's quota, or accounts/{uid}.aiDailyLimit if the admin
// dashboard set a top-up.
export function quotaFor(account, uid) {
  const period = planQuota(account).period;
  if (isAdminUid(uid)) return { period, limit: Infinity };
  if (isReadOnlyAccount(account)) return { period, limit: 0 };
  const n = Number(account?.aiDailyLimit);
  const limit = Number.isFinite(n) && n > 0 ? n : planQuota(account).limit;
  return { period, limit };
}

// Day/month windows are cut at Indonesian local midnight (every customer
// is in WIB/WITA/WIT; the client meter uses the browser's local date), not
// UTC — otherwise 00:00–07:00 WIB would show a different "today" than the
// one the server counts against.
const TZ = "Asia/Jakarta";
function isoDate(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
}
function isoMonth(d = new Date()) {
  return isoDate(d).slice(0, 7);
}

// How much of the given period's allowance is already used, read straight
// off the aiUsage/{uid} doc (or null if it doesn't exist yet).
export function usedInPeriod(u, period, now = new Date()) {
  if (!u) return 0;
  if (period === "total") return Number(u.totalCount) || 0;
  if (period === "month") return u.month === isoMonth(now) ? Number(u.monthCount) || 0 : 0;
  return u.date === isoDate(now) ? Number(u.count) || 0 : 0;
}

// Bumps aiUsage/{uid} by 1 inside a transaction (so two near-simultaneous
// calls from the same account can never both slip through uncounted) and
// returns the freshly-counted usage for the given period. Called only after
// a provider call actually succeeded.
export async function consumeQuota(db, uid, period, now = new Date()) {
  const ref = db.doc(`aiUsage/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() : {};
    const today = isoDate(now);
    const month = isoMonth(now);
    const count = (u.date === today ? Number(u.count) || 0 : 0) + 1;
    const monthCount = (u.month === month ? Number(u.monthCount) || 0 : 0) + 1;
    const totalCount = (Number(u.totalCount) || 0) + 1;
    tx.set(ref, { date: today, count, month, monthCount, totalCount }, { merge: true });
    const used = period === "total" ? totalCount : period === "month" ? monthCount : count;
    return { used };
  });
}
