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
// Sepuasnya (not capped — kept so heavy use is visible to the admin);
// freeDate/freeCount are today's free background calls (api/ai.js
// FREE_FEATURES).
// — same shape the old settings/{uid}.aiUsage carried, just owned by the
// server now (firestore.rules: client can read its own, never write it).
// Since 2026-10-06 a call is counted when it STARTS (reserveCall) and given
// back if it fails (releaseCall) — see the bottom of this file.

// A plan this table doesn't know gets Starter's allowance, never more
// (audit S-25: unknown plans used to get 50/day, more than Starter).
export const DEFAULT_AI_DAILY_LIMIT = 20;

// Mirrors js/ai-usage.js's PLAN_QUOTA exactly — keep the two in sync.
// The pre-subscription plans are listed by name so they keep the 50/day
// they were sold with ("keep what they were sold", js/ai-usage.js) — only
// the fallback for anything unknown went down.
export const PLAN_QUOTA = {
  lifetime: { period: "day", limit: 50 },
  builder: { period: "day", limit: 50 },
  "content-os": { period: "day", limit: 50 },
  monthly: { period: "day", limit: 50 },
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

// Mirrors js/account.js's isTrialExpired()/isReadOnly() — plus a lapsed
// subscription, which the client only learns about once the daily cron has
// flipped its status; the server shouldn't hand out AI for up to a day after
// the paid period ended.
function isTrialExpired(account) {
  return account?.plan === "trial" && Number(account?.trialEndsAt) <= Date.now();
}
function isSubscriptionLapsed(account) {
  const until = Number(account?.subscriptionExpiresAt);
  return ["starter", "pro", "studio"].includes(account?.plan) && until > 0 && until <= Date.now();
}
// "free" (an account from before trials, never paid) has no AI either —
// it used to fall through to the default allowance.
export function isReadOnlyAccount(account) {
  return account?.status === "readonly" || account?.plan === "free" || isTrialExpired(account) || isSubscriptionLapsed(account);
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

// Background calls the app starts on its own (api/ai.js FREE_FEATURES) are
// free for the owner, but capped per account per day: bumps
// aiUsage/{uid}.freeCount and says whether this one still fits under
// `limit`. Over the cap the caller charges the call like any other.
export async function consumeFreeCall(db, uid, now = new Date(), limit = Infinity) {
  const ref = db.doc(`aiUsage/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() : {};
    const today = isoDate(now);
    const used = u.freeDate === today ? Number(u.freeCount) || 0 : 0;
    if (used >= limit) return false;
    tx.set(ref, { freeDate: today, freeCount: used + 1 }, { merge: true });
    return true;
  });
}

// (consumeFreeCall above and consumeQuota below are the old count-after-
// the-reply path; api/ai.js now goes through reserveCall/releaseCall.)
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

// ---------- Charge first, refund on failure (2026-10-06) ----------
// api/ai.js used to check the allowance before the AI call and count the
// call after the reply — so N calls started together all passed the check
// and overspent (consumeQuota above then charged the plan "one over"). Now
// reserveCall() takes the credit BEFORE the call, in the same transaction
// that takes one of the account's in-flight slots, and releaseCall() hands
// the slot back afterwards — refunding exactly what was reserved when the
// call failed. The lease is the reservation's receipt: a refund only
// happens while it still exists and it records which allowance paid, so a
// refund can never run twice or land in a different bucket.
//
// aiInflight/{uid} = { leases: { <leaseId>: { at, kind, date, month } } } —
// server-only (no rule in firestore.rules matches it, so the browser can
// neither read nor write it). kind: "plan" | "daily" (AI Sepuasnya) |
// "credits" (top-up) | "free" (one of today's free background calls).

// At most this many AI calls in flight per account at once. NOT a usage
// cap — AI Sepuasnya stays unlimited — only a guard against one account
// firing dozens of requests in parallel.
export const MAX_INFLIGHT = 3;
// A lease older than this belongs to a call whose function died without
// releasing it, and stops counting. Longer than vercel.json's maxDuration
// for api/ai.js (180 s), so a call that is still running never loses its
// lease (and with it its refund).
export const LEASE_TTL_MS = 200_000;

function liveLeases(leases, nowMs, ttlMs) {
  const out = {};
  for (const [id, l] of Object.entries(leases || {})) if (l && nowMs - Number(l.at) < ttlMs) out[id] = l;
  return out;
}

// Reserves one call for `uid`: an in-flight slot plus the credit that pays
// for it, in the order the old pre-check used — a free slot when `free`
// (and today's `freeLimit` has room), else the plan's allowance (`period`,
// `limit` from quotaFor), then AI Sepuasnya, then top-up credits.
// Returns { ok: true, leaseId, kind, used, dailyUsed, credits } — `used` is
// the plan's count for `period` after this call — or { ok: false, error:
// "busy" | "quota", ... } with nothing written at all.
export async function reserveCall(db, uid, { period, limit = Infinity, leaseId, free = false, freeLimit = Infinity, maxInflight = MAX_INFLIGHT, leaseTtlMs = LEASE_TTL_MS, now = new Date() } = {}) {
  const usageRef = db.doc(`aiUsage/${uid}`);
  const leaseRef = db.doc(`aiInflight/${uid}`);
  const accountRef = db.doc(`accounts/${uid}`);
  const today = isoDate(now);
  const month = isoMonth(now);
  return db.runTransaction(async (tx) => {
    const usageSnap = await tx.get(usageRef);
    const leaseSnap = await tx.get(leaseRef);
    const u = usageSnap.exists ? usageSnap.data() || {} : {};
    const leases = liveLeases(leaseSnap.exists ? leaseSnap.data()?.leases : null, now.getTime(), leaseTtlMs);
    const inflight = Object.keys(leases).length;
    if (inflight >= maxInflight) return { ok: false, error: "busy", inflight };

    const planUsed = usedInPeriod(u, period, now);
    let dailyUsed = usedExtraToday(u, now);
    const freeUsed = u.freeDate === today ? Number(u.freeCount) || 0 : 0;
    let extras = { dailyLimit: 0, credits: 0 };
    let kind = free && freeUsed < freeLimit ? "free" : null;
    if (!kind && !(planUsed < limit)) {
      // Plan used up: what's left is on the account doc, read inside this
      // transaction so two calls can never both spend the last credit.
      const accountSnap = await tx.get(accountRef);
      extras = extrasFor(accountSnap.exists ? accountSnap.data() : {}, uid, now);
    }
    if (!kind) kind = pickBucket({ planUsed, planLimit: limit, dailyUsed, dailyLimit: extras.dailyLimit, credits: extras.credits });
    if (!kind) return { ok: false, error: "quota", planUsed, dailyUsed, dailyLimit: extras.dailyLimit, credits: extras.credits };

    let used = planUsed;
    let credits = extras.credits;
    if (kind === "plan") {
      const count = (u.date === today ? Number(u.count) || 0 : 0) + 1;
      const monthCount = (u.month === month ? Number(u.monthCount) || 0 : 0) + 1;
      const totalCount = (Number(u.totalCount) || 0) + 1;
      tx.set(usageRef, { date: today, count, month, monthCount, totalCount }, { merge: true });
      used = period === "total" ? totalCount : period === "month" ? monthCount : count;
    } else if (kind === "daily") {
      dailyUsed += 1;
      tx.set(usageRef, { extraDate: today, extraCount: dailyUsed }, { merge: true });
    } else if (kind === "credits") {
      credits -= 1;
      tx.set(accountRef, { aiCredits: credits }, { merge: true });
    } else {
      tx.set(usageRef, { freeDate: today, freeCount: freeUsed + 1 }, { merge: true });
    }
    leases[leaseId] = { at: now.getTime(), kind, date: today, month };
    tx.set(leaseRef, { leases });
    return { ok: true, leaseId, kind, used, dailyUsed, credits };
  });
}

// Ends the call reserved under `leaseId`. outcome:
//  - "ok": the owner got a reply — the charge stands.
//  - "fail": the call failed or came back empty — exactly what was
//    reserved goes back (a free slot included).
//  - "handoff": the reply was only a hand-off line to another chat partner
//    (js/ai.js HANDOFF_RULE_*) — refunded as one of today's free calls,
//    while today's `freeLimit` has room; past it, the charge stands.
// A lease that is already gone (released before, or expired) changes
// nothing. A day/month window that rolled over since the reservation is
// left alone — that count belongs to a window that's already over.
// Returns { released, refunded, kind, used } (`used`: the plan's count for
// `period` afterwards, or null when nothing was read).
export async function releaseCall(db, uid, leaseId, { outcome = "ok", period = "day", freeLimit = Infinity, leaseTtlMs = LEASE_TTL_MS, now = new Date() } = {}) {
  const usageRef = db.doc(`aiUsage/${uid}`);
  const leaseRef = db.doc(`aiInflight/${uid}`);
  const accountRef = db.doc(`accounts/${uid}`);
  const today = isoDate(now);
  return db.runTransaction(async (tx) => {
    const leaseSnap = await tx.get(leaseRef);
    const all = (leaseSnap.exists ? leaseSnap.data()?.leases : null) || {};
    const lease = all[leaseId];
    if (!lease) return { released: false, refunded: false, kind: null, used: null };

    let refund = outcome === "fail" || (outcome === "handoff" && lease.kind !== "free");
    // A call that keeps its charge only frees its slot — no need to read
    // (and contend on) the usage doc.
    const usageSnap = refund ? await tx.get(usageRef) : null;
    const u = usageSnap?.exists ? usageSnap.data() || {} : {};
    const freeUsed = u.freeDate === today ? Number(u.freeCount) || 0 : 0;
    if (outcome === "handoff" && refund && freeUsed >= freeLimit) refund = false;
    const accountSnap = refund && lease.kind === "credits" ? await tx.get(accountRef) : null;

    const { [leaseId]: _done, ...rest } = all;
    tx.set(leaseRef, { leases: liveLeases(rest, now.getTime(), leaseTtlMs) });
    if (!refund) return { released: true, refunded: false, kind: lease.kind, used: usageSnap ? usedInPeriod(u, period, now) : null };

    const next = {};
    if (lease.kind === "plan") {
      if (u.date === lease.date) next.count = Math.max(0, (Number(u.count) || 0) - 1);
      if (u.month === lease.month) next.monthCount = Math.max(0, (Number(u.monthCount) || 0) - 1);
      next.totalCount = Math.max(0, (Number(u.totalCount) || 0) - 1);
    } else if (lease.kind === "daily") {
      if (u.extraDate === lease.date) next.extraCount = Math.max(0, (Number(u.extraCount) || 0) - 1);
    } else if (lease.kind === "free") {
      if (u.freeDate === lease.date) next.freeCount = Math.max(0, (Number(u.freeCount) || 0) - 1);
    } else if (lease.kind === "credits") {
      const a = accountSnap?.exists ? accountSnap.data() || {} : {};
      tx.set(accountRef, { aiCredits: Math.max(0, Math.floor(Number(a.aiCredits) || 0)) + 1 }, { merge: true });
    }
    // A hand-off refund is paid for with one of today's free calls.
    if (outcome === "handoff") Object.assign(next, { freeDate: today, freeCount: freeUsed + 1 });
    if (Object.keys(next).length) tx.set(usageRef, next, { merge: true });
    return { released: true, refunded: true, kind: lease.kind, used: usedInPeriod({ ...u, ...next }, period, now) };
  });
}
