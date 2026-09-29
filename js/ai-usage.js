// Daily AI quota, counted per account. One "use" = one model call made from
// the browser (script, hooks, ide, saran DNA, konsultan, jadwal otomatis,
// ...). The count itself is now kept and enforced server-side (api/ai.js,
// api/_aiQuota.js) in aiUsage/{uid} — this module just displays it: the meter
// the owner sees is the live aiUsage/{uid} snapshot (js/store.js
// getAiUsageDoc(), wired up in initStore()), not a number the browser could
// edit its way past.
import { getAiUsageDoc } from "./store.js";
import { getCachedAccount, isAdmin, isReadOnly, currentUid } from "./account.js";

// Accounts from before per-plan quotas (lifetime/builder/content/monthly)
// keep what they were sold.
export const DEFAULT_AI_DAILY_LIMIT = 50;

// Credits per plan. Subscriptions reset daily; the Founder lifetime plans
// are a monthly cap instead — a one-time payment can't fund an open-ended
// daily allowance forever. The trial is neither: it's a single pool for the
// whole 30-day window (not reset each day), so someone who tries the product
// hard on day 1 still has real room left later, and the number is big
// enough to actually experience the product rather than feel like a demo.
// Shown on the pricing page (js/views/pricing.js) — keep the two in sync.
// Also mirrored server-side in api/_aiQuota.js (the copy that actually
// enforces the cap) — keep both in sync.
const PLAN_QUOTA = {
  trial: { period: "total", limit: 60 },
  starter: { period: "day", limit: 20 },
  pro: { period: "day", limit: 60 },
  studio: { period: "day", limit: 200 },
  founder: { period: "month", limit: 300 },
  "founder-ultimate": { period: "month", limit: 500 },
};

function planQuota() {
  return PLAN_QUOTA[getCachedAccount()?.plan] || { period: "day", limit: DEFAULT_AI_DAILY_LIMIT };
}

// "day" | "month" | "total" — which window the limit/usage numbers below
// refer to ("total" = one pool for the account's entire trial, never reset).
export function aiQuotaPeriod() {
  return planQuota().period;
}

// The limit for the current window (see aiQuotaPeriod — the name predates
// monthly caps). Admin (Wepeka's own team account) is unmetered; a
// read-only account (ended trial, lapsed subscription) gets none at all;
// every other account gets its plan's quota, or accounts/{uid}.aiDailyLimit
// if the admin dashboard set one. The account doc is not client-writable,
// so the cap is the admin's to raise (top-up), not the user's. Display only
// now — api/_aiQuota.js decides the real cap server-side.
export function aiDailyLimit() {
  if (isAdmin(currentUid())) return Infinity;
  const account = getCachedAccount();
  if (isReadOnly(account)) return 0;
  const n = Number(account?.aiDailyLimit);
  return Number.isFinite(n) && n > 0 ? n : planQuota().limit;
}

// Day/month windows are cut at Jakarta midnight, exactly like the server
// (api/_aiQuota.js isoDate/isoMonth). This used to compare against the UTC
// date, so between 00:00 and 07:00 WIB the meter read the server's "today"
// as yesterday's and showed 0 used.
const QUOTA_TZ = "Asia/Jakarta";
const isoDateJkt = () => new Date().toLocaleDateString("en-CA", { timeZone: QUOTA_TZ });
const isoMonthJkt = () => isoDateJkt().slice(0, 7);

// Which window the current count belongs to — "day:2026-09-29",
// "month:2026-09", or "total" — so "shown once per window" notices
// (js/ai-topup.js) come back when the quota resets and not before.
export function aiQuotaWindow() {
  const period = aiQuotaPeriod();
  if (period === "total") return "total";
  return period === "month" ? `month:${isoMonthJkt()}` : `day:${isoDateJkt()}`;
}

function usageOn(u) {
  return u && u.date === isoDateJkt() ? Number(u.count) || 0 : 0;
}
function usageInMonth(u) {
  return u && u.month === isoMonthJkt() ? Number(u.monthCount) || 0 : 0;
}
// No date/month check — a total pool just accumulates for as long as the
// account stays on a "total"-period plan (currently only the trial).
function usageTotal(u) {
  return Number(u?.totalCount) || 0;
}

// Usage in the current window (today, this month on a monthly cap, or the
// whole trial on a total cap) — read straight off the live aiUsage/{uid}
// doc api/ai.js writes after every counted call.
export function aiUsageToday() {
  const u = getAiUsageDoc();
  const period = aiQuotaPeriod();
  if (period === "total") return usageTotal(u);
  return period === "month" ? usageInMonth(u) : usageOn(u);
}

export function aiUsageRemaining() {
  const limit = aiDailyLimit();
  return limit === Infinity ? Infinity : Math.max(0, limit - aiUsageToday());
}

export function aiLimitReached() {
  return aiUsageToday() >= aiDailyLimit();
}

// The server (api/ai.js) is what actually counts a call now, in the same
// transaction that confirms it succeeded — nothing left for the client to
// record. Kept as a no-op export so nothing that still imports it breaks.
export function recordAiUsage() {}
