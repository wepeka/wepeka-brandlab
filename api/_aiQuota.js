// Server-side mirror of the AI quota rules that used to live entirely in the
// browser (js/ai-usage.js) — moved here so a customer can no longer raise
// their own cap by editing localStorage/devtools. Three copies of the same
// numbers now exist by design (this file for enforcement, js/ai-usage.js for
// the client-side meter/UI, js/account.js + firestore.rules for the admin
// uid) — keep all of them in sync by hand.
//
// Usage doc: aiUsage/{uid} = { date, count, month, monthCount, totalCount,
// extraDate, extraCount } — count/monthCount/totalCount are calls charged to
// the PLAN's allowance; extraDate/extraCount are today's calls made on AI
// Sepuasnya (not capped — kept so heavy use is visible to the admin).
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

// Paid extras on top of the plan (both written only by the Midtrans webhook,
// api/midtrans/webhook.js; accounts/{uid} is not client-writable):
//  - accounts/{uid}.aiCredits: top-up credits. Never expire; spent last.
//  - accounts/{uid}.aiUnlimitedUntil: AI Sepuasnya — no credit limit at all
//    until then (owner's decision, 2026-09-29: truly no limit, any paid plan).
// Spending order: the plan's own allowance, then AI Sepuasnya (so top-up
// credits sit untouched while it runs), then top-up credits.
export function extrasFor(account, uid, now = new Date()) {
  if (isAdminUid(uid) || isReadOnlyAccount(account)) return { dailyLimit: 0, credits: 0 };
  const unlimited = Number(account?.aiUnlimitedUntil) > now.getTime();
  return { dailyLimit: unlimited ? Infinity : 0, credits: Math.max(0, Math.floor(Number(account?.aiCredits) || 0)) };
}
export function usedExtraToday(u, now = new Date()) {
  return u && u.extraDate === isoDate(now) ? Number(u.extraCount) || 0 : 0;
}

// Which allowance pays for the next call: "plan" | "daily" (AI Sepuasnya,
// dailyLimit = Infinity while it runs) | "credits",
// or null when all three are empty. Pure — the server's pre-check and the
// charge after a successful call both go through it.
export function pickBucket({ planUsed, planLimit, dailyUsed = 0, dailyLimit = 0, credits = 0 }) {
  if (planUsed < planLimit) return "plan";
  if (dailyUsed < dailyLimit) return "daily";
  if (credits > 0) return "credits";
  return null;
}

// Everything the account can still spend right now, for the 429 check and
// the meter the response carries back.
export function availability(account, uid, usage, now = new Date()) {
  const quota = quotaFor(account, uid);
  const extras = extrasFor(account, uid, now);
  const planUsed = usedInPeriod(usage, quota.period, now);
  const dailyUsed = usedExtraToday(usage, now);
  const bucket = pickBucket({ planUsed, planLimit: quota.limit, dailyUsed, dailyLimit: extras.dailyLimit, credits: extras.credits });
  return { quota, planUsed, dailyUsed, dailyLimit: extras.dailyLimit, credits: extras.credits, bucket };
}

// Bumps aiUsage/{uid} by 1 inside a transaction (so two near-simultaneous
// calls from the same account can never both slip through uncounted) and
// returns the freshly-counted usage for the given period. Called only after
// a provider call actually succeeded.
// `limit`: the plan's cap for `period`. Once the plan's allowance is used
// up the call is charged to today's AI Harian, then to top-up credits (read
// and decremented inside the same transaction, so two calls can never spend
// the same credit). Without `limit` every call counts against the plan, as
// before extras existed.
export async function consumeQuota(db, uid, period, now = new Date(), { limit = Infinity } = {}) {
  const ref = db.doc(`aiUsage/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() : {};
    const today = isoDate(now);
    const month = isoMonth(now);
    if (usedInPeriod(u, period, now) >= limit) {
      const accountRef = db.doc(`accounts/${uid}`);
      const accountSnap = await tx.get(accountRef);
      const extras = extrasFor(accountSnap.exists ? accountSnap.data() : {}, uid, now);
      const dailyUsed = usedExtraToday(u, now);
      const bucket = pickBucket({ planUsed: 1, planLimit: 0, dailyUsed, dailyLimit: extras.dailyLimit, credits: extras.credits });
      if (bucket === "daily") {
        tx.set(ref, { extraDate: today, extraCount: dailyUsed + 1 }, { merge: true });
        return { used: usedInPeriod(u, period, now), bucket, dailyUsed: dailyUsed + 1, credits: extras.credits };
      }
      if (bucket === "credits") {
        tx.set(accountRef, { aiCredits: extras.credits - 1 }, { merge: true });
        return { used: usedInPeriod(u, period, now), bucket, dailyUsed, credits: extras.credits - 1 };
      }
      // Nothing left (a parallel call spent the last one after our
      // pre-check): charge the plan, one over — never refuse a reply the
      // owner already got.
    }
    const count = (u.date === today ? Number(u.count) || 0 : 0) + 1;
    const monthCount = (u.month === month ? Number(u.monthCount) || 0 : 0) + 1;
    const totalCount = (Number(u.totalCount) || 0) + 1;
    tx.set(ref, { date: today, count, month, monthCount, totalCount }, { merge: true });
    const used = period === "total" ? totalCount : period === "month" ? monthCount : count;
    return { used, bucket: "plan" };
  });
}
