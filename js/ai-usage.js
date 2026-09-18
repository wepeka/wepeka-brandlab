// Daily AI quota, counted per account. One "use" = one model call made
// from the browser (script, hooks, ide, saran DNA, konsultan, jadwal
// otomatis, ...). The count lives in this account's own settings doc
// (settings/{uid}.aiUsage = { date, count }) so it follows the person
// across devices, and resets simply by the date changing.
//
// Client-side only for now — the AI key still travels to the browser (see
// the Phase 2 note in .claude/next-session-prompt.md: a server-side proxy
// is where this becomes enforceable). Today it is an honest meter: it
// tells the owner how much they've used and stops the buttons at the cap.
import { getSettings, updateSettings, localISODate } from "./store.js";
import { getCachedAccount, isAdmin, isReadOnly, currentUid } from "./account.js";

// Accounts from before per-plan quotas (lifetime/builder/content-os/monthly)
// keep what they were sold.
export const DEFAULT_AI_DAILY_LIMIT = 50;

// Credits per plan. Subscriptions reset daily; the Founder lifetime plans
// are a monthly cap instead — a one-time payment can't fund an open-ended
// daily allowance forever. The trial is neither: it's a single pool for the
// whole 7-day window (not reset each day), so someone who tries the product
// hard on day 1 still has real room left on day 2, and the number is big
// enough to actually experience the product rather than feel like a demo.
// Shown on the pricing page (js/views/pricing.js) — keep the two in sync.
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
// so the cap is the admin's to raise (top-up), not the user's.
export function aiDailyLimit() {
  if (isAdmin(currentUid())) return Infinity;
  const account = getCachedAccount();
  if (isReadOnly(account)) return 0;
  const n = Number(account?.aiDailyLimit);
  return Number.isFinite(n) && n > 0 ? n : planQuota().limit;
}

const thisMonth = () => localISODate().slice(0, 7);

function usageOn(u) {
  return u && u.date === localISODate() ? Number(u.count) || 0 : 0;
}
function usageInMonth(u) {
  return u && u.month === thisMonth() ? Number(u.monthCount) || 0 : 0;
}
// No date/month check — a total pool just accumulates for as long as the
// account stays on a "total"-period plan (currently only the trial).
function usageTotal(u) {
  return Number(u?.totalCount) || 0;
}

// Usage in the current window (today, this month on a monthly cap, or the
// whole trial on a total cap).
export function aiUsageToday() {
  const u = getSettings().aiUsage;
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

// All three counters are kept whatever the plan, so switching between a
// daily, monthly, or total-pool plan never starts from a wrong number.
export function recordAiUsage(n = 1) {
  const u = getSettings().aiUsage;
  updateSettings({
    aiUsage: {
      date: localISODate(),
      count: usageOn(u) + n,
      month: thisMonth(),
      monthCount: usageInMonth(u) + n,
      totalCount: usageTotal(u) + n,
    },
  });
}
