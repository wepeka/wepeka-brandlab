// Single source of truth for what can be bought and what a purchase grants.
// Shared by create-transaction.js (price lookup) and webhook.js (what to
// write onto accounts/{uid} once Midtrans confirms payment). The leading
// underscore keeps Vercel from exposing this file as a route.
//
// js/views/pricing.js shows the same amounts for display only — the amount
// actually charged always comes from here, keyed by planKey.
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// planKey → { amount, label, plan, durationMs, brandLimit, slot }
//  - plan: the value written to accounts/{uid}.plan
//  - durationMs: null = lifetime (no subscriptionExpiresAt)
//  - slot: which counter in meta/founderSlots this purchase consumes
export const PLANS = {
  "starter-monthly": { amount: 49000, label: "Brandlab Starter — Bulanan", plan: "starter", billing: "monthly", durationMs: MONTH_MS, brandLimit: 1 },
  "starter-yearly": { amount: 399000, label: "Brandlab Starter — Tahunan", plan: "starter", billing: "yearly", durationMs: YEAR_MS, brandLimit: 1 },
  "pro-monthly": { amount: 99000, label: "Brandlab Pro — Bulanan", plan: "pro", billing: "monthly", durationMs: MONTH_MS, brandLimit: 3 },
  "pro-yearly": { amount: 799000, label: "Brandlab Pro — Tahunan", plan: "pro", billing: "yearly", durationMs: YEAR_MS, brandLimit: 3 },
  "studio-monthly": { amount: 249000, label: "Brandlab Studio — Bulanan", plan: "studio", billing: "monthly", durationMs: MONTH_MS, brandLimit: 10 },
  "studio-yearly": { amount: 1990000, label: "Brandlab Studio — Tahunan", plan: "studio", billing: "yearly", durationMs: YEAR_MS, brandLimit: 10 },
  // `amount` is only the opening price — what is actually charged comes from
  // FOUNDER_TIERS, by how many slots are already sold (see founderAmount).
  founder: { amount: 499000, tiered: true, label: "Brandlab Founder Lifetime", plan: "founder", billing: "lifetime", durationMs: null, brandLimit: 3, slot: "founderSlotsSold" },
  "founder-ultimate": { amount: 1490000, label: "Brandlab Agency Lifetime", plan: "founder-ultimate", billing: "lifetime", durationMs: null, brandLimit: 15, slot: "founderUltimateSlotsSold" },
};

// One-time add-ons: permanent brand slots (accounts/{uid}.extraBrands — its
// own field, so a plan purchase resetting brandLimit to the plan's number
// never wipes them). Pay-once plans only — a subscriber moves to Lifetime
// first (owner's decision, 2026-09-29). Priced so that stacking
// them on Founder never undercuts Agency Lifetime: Founder + 12 brands
// (4 × the 3-pack) is ~Rp 1,5jt against Agency's Rp 1,49jt for the same 15.
export const ADDONS = {
  "addon-brand-1": { amount: 99000, label: "Brandlab — Tambah 1 brand (selamanya)", addBrands: 1 },
  "addon-brand-3": { amount: 249000, label: "Brandlab — Tambah 3 brand (selamanya)", addBrands: 3 },
};
// Premium Brand Book art styles — one-time, per account (every brand on the
// account can then export in that style). Sold to any plan, trial included.
// `bookStyle` is what the webhook adds to accounts/{uid}.bookStyles; the
// client mirrors these in js/views/brand-guidelines.js (BOOK_STYLES) for
// display only — keep the two in sync.
export const BOOK_STYLE_ADDONS = {
  "bookstyle-pop": { amount: 20000, label: "Brand Book — Gaya Pop", bookStyle: "pop" },
  "bookstyle-scrap": { amount: 20000, label: "Brand Book — Gaya Scrapbook", bookStyle: "scrap" },
  "bookstyle-photo": { amount: 20000, label: "Brand Book — Gaya Photo", bookStyle: "photo" },
};
Object.assign(ADDONS, BOOK_STYLE_ADDONS);
// Every premium style comes with a pay-once plan (part of the Founder bundle);
// the webhook writes them onto the account so nothing downstream has to know.
export const LIFETIME_BOOK_STYLES = Object.values(BOOK_STYLE_ADDONS).map((a) => a.bookStyle);

// AI credits, bought on the spot by any paid account (not the trial —
// top-ups come on top of a plan). Mirrored for display in js/site-links.js
// (AI_TOPUPS, AI_DAILY) — keep the two in sync.
//  - aiCredits: added to accounts/{uid}.aiCredits. Never expire.
//  - aiUnlimitedMs: AI Sepuasnya — no credit limit until
//    accounts/{uid}.aiUnlimitedUntil; buying again while it runs adds 30
//    days to what's left.
export const AI_ADDONS = {
  "ai-300": { amount: 15000, label: "Brandlab — 300 kredit AI", aiCredits: 300 },
  "ai-500": { amount: 23000, label: "Brandlab — 500 kredit AI", aiCredits: 500 },
  "ai-1000": { amount: 39000, label: "Brandlab — 1.000 kredit AI", aiCredits: 1000 },
  "ai-unlimited": { amount: 50000, label: "Brandlab — AI Sepuasnya (30 hari)", aiUnlimitedMs: MONTH_MS },
};
Object.assign(ADDONS, AI_ADDONS);

// A monthly brand slot: 30 days, any paid account. accounts/{uid}.
// brandSlotsUntil holds one end date per slot; js/account.js brandLimitOf
// counts the ones still running, and once one lapses the newest brand over
// the limit turns preview-only until it's renewed (js/brand-locked.js).
// Rp 29.000 so moving up a plan always beats stacking slots (Starter + 2 >
// Pro, Pro + 7 > Studio). "-renew" extends the slot ending soonest instead
// of adding one.
export const SUBSCRIPTION_PLANS = ["starter", "pro", "studio"];
ADDONS["addon-brand-sub"] = { amount: 29000, label: "Brandlab — Tambah 1 brand (30 hari)", addBrandSlotMs: MONTH_MS };
ADDONS["addon-brand-sub-renew"] = { amount: 29000, label: "Brandlab — Perpanjang 1 slot brand (30 hari)", addBrandSlotMs: MONTH_MS, renew: true };

// The slot list after one monthly purchase. New: reuses a lapsed slot if
// there is one (so the list never grows with dead dates), else adds one.
// Renew: pushes the soonest-ending slot (running or lapsed) 30 days past
// whichever is later, now or its end. Pure — the webhook runs it in its
// transaction, the tests run it directly.
export function nextBrandSlots(slots = [], now, ms, { renew = false } = {}) {
  const list = (slots || []).map(Number).filter((n) => Number.isFinite(n));
  if (renew && list.length) {
    const i = list.indexOf(Math.min(...list));
    list[i] = Math.max(now, list[i]) + ms;
    return list;
  }
  const lapsed = list.findIndex((ts) => ts <= now);
  if (lapsed >= 0) list[lapsed] = now + ms;
  else list.push(now + ms);
  return list;
}

export const ADDON_ELIGIBLE_PLANS = ["founder", "founder-ultimate", "lifetime"];

// ---- Switching plans (no overlap) ------------------------------------------
// Buying a different plan while a subscription still runs REPLACES it —
// never two plans at once. Moving up (a bigger subscription tier, monthly →
// yearly of the same tier, or any Lifetime plan) starts now, and what's left
// of the old period comes off the new price. Moving down starts only when
// the current period ends (paid now, no refund, no credit). Same plan again
// = a plain renewal that adds to the time left. Owner's decision, 2026-09-29.
//
// The running plan's OWN period end and a queued downgrade are kept apart
// (audit S-14, 2026-10-01): accounts/{uid}.subscriptionExpiresAt is when ALL
// paid time runs out (what access, the rules and the cron read), while
// scheduledPlan.startsAt is when the running plan itself ends. Before this,
// every "later" purchase took its start from subscriptionExpiresAt — which
// the previous "later" purchase had already pushed out — so a Studio
// subscriber who kept buying Starter "for later" never dropped to Starter
// (150 days of Studio for Rp 543rb), and an upgrade credited the queued
// Starter days at Studio's rate. Now: one queued downgrade at a time, the
// credit only covers the running plan's own period (plus the queued plan's
// prepaid value, at its own price, when an upgrade replaces it), and a
// renewal moves the queued plan back instead of swallowing it.
const TIER_RANK = { starter: 1, pro: 2, studio: 3, founder: 10, "founder-ultimate": 11 };
const LIFETIME_KEYS = ["founder", "founder-ultimate", "lifetime"];
export const MIN_CHARGE = 1000;

function rankOf(plan, billing) {
  const base = TIER_RANK[plan] || 0;
  return base >= 10 ? base : base + (billing === "yearly" ? 0.5 : 0);
}
const keyOf = (plan, billing) => `${plan}-${billing || "monthly"}`;

// A queued downgrade whose day has come is the plan already, even before the
// daily cron (api/cron/check-expiry.js) writes it — the patch both use.
// Status is never part of it: switching plans must not re-activate an
// account an admin deactivated (audit S-22).
export function dueSchedulePatch(account, now = Date.now()) {
  const next = account?.scheduledPlan;
  if (!next?.plan || !(Number(next.startsAt) <= now)) return null;
  return { plan: next.plan, billing: next.billing, brandLimit: next.brandLimit, scheduledPlan: null };
}
function withDueSchedule(account, now) {
  const due = dueSchedulePatch(account, now);
  return due ? { ...account, ...due } : { ...(account || {}) };
}

// The subscription running right now, or null: its planKey, when its own
// period ends (`periodEnd`), when all paid time ends (`end`), and the
// downgrade queued behind it, if any.
export function runningSubscription(account, now = Date.now()) {
  const acc = withDueSchedule(account, now);
  if (!isPaidAccount(acc, now) || !SUBSCRIPTION_PLANS.includes(acc.plan)) return null;
  const end = Number(acc.subscriptionExpiresAt);
  if (!(end > now)) return null;
  const scheduled = acc.scheduledPlan?.plan ? acc.scheduledPlan : null;
  const periodEnd = scheduled ? Math.min(Number(scheduled.startsAt), end) : end;
  return { key: keyOf(acc.plan, acc.billing), plan: acc.plan, billing: acc.billing || "monthly", periodEnd, end, scheduled };
}

// What a queued downgrade was paid for and hasn't started: its own price for
// its own length (one period at most — accounts stacked before this fix
// only get one period back).
function scheduledValue(scheduled, end) {
  const p = PLANS[keyOf(scheduled.plan, scheduled.billing)];
  if (!p?.durationMs) return 0;
  const length = Math.max(0, (Number(scheduled.endsAt) || end) - Number(scheduled.startsAt));
  return p.amount * Math.min(1, length / p.durationMs);
}

const refused = (code, extra = {}) => ({ mode: "refused", code, amount: 0, credit: 0, ...extra });

// `value` (unused paid time, in rupiah) off `price`, rounded down to Rp 100,
// never below MIN_CHARGE.
function creditQuote(price, value, extra = {}) {
  const full = Math.max(0, Math.floor(value / 100) * 100);
  const credit = Math.max(0, Math.min(full, price - MIN_CHARGE));
  return { mode: "now", amount: price - credit, credit, ...extra };
}

// A Lifetime account is never sold another plan on top — it used to read
// as "nothing running", so a Founder clicking "Langganan" became a Starter
// expiring in 30 days, an Agency buying Founder dropped to 3 brands, and a
// Founder could buy Founder again (audit S-15). The one way up is Founder
// → Agency Lifetime, for the difference between the two: Agency's price
// minus what the Founder seat cost (accounts/{uid}.lifetimePaid, written by
// the webhook), never below MIN_CHARGE. Without a recorded price (a seat
// activated by hand over WhatsApp) the difference is worked out by the
// team instead: "lifetime-manual". Owner's rule, 2026-10-01.
export const isLifetimePlan = (plan) => LIFETIME_KEYS.includes(plan);
function lifetimeQuote(acc, planKey, price) {
  if (acc.plan === "founder" && planKey === "founder-ultimate") {
    const paid = Number(acc.lifetimePaid);
    if (!(paid > 0)) return refused("lifetime-manual");
    return creditQuote(price, paid, { lifetimeUpgrade: true });
  }
  return refused(acc.plan === "founder-ultimate" ? "lifetime-top" : "lifetime-owned");
}

// What buying `planKey` costs this account right now, and when it starts.
// mode: "new" (nothing running), "renew" (same plan; `scheduledStartsAt` =
// where a queued downgrade moves to), "now" (upgrade, with `credit` = the
// unused part of the current period), "later" (downgrade, starts at
// `startsAt`), "refused" (`code` says why — create-transaction answers 409).
// `price` is the plan's own price (for a tiered Founder plan, the tier
// price the caller already resolved).
export function switchQuote(account, planKey, price, now = Date.now()) {
  const target = PLANS[planKey];
  if (!target) return null;
  // Whatever its status: a Lifetime plan an admin paused is still not
  // something a subscription may overwrite.
  if (isLifetimePlan(account?.plan)) return lifetimeQuote(account, planKey, price);
  const run = runningSubscription(account, now);
  if (!run) return { mode: "new", amount: price, credit: 0 };
  if (run.key === planKey) {
    return run.scheduled
      ? { mode: "renew", amount: price, credit: 0, scheduledStartsAt: run.periodEnd + target.durationMs }
      : { mode: "renew", amount: price, credit: 0 };
  }
  if (rankOf(target.plan, target.billing) <= rankOf(run.plan, run.billing)) {
    // One queued downgrade at a time — a second one would push the first
    // (and the running plan's end with it) out again.
    if (run.scheduled) return refused("scheduled", { startsAt: run.periodEnd });
    return { mode: "later", amount: price, credit: 0, startsAt: run.periodEnd };
  }
  const current = PLANS[run.key];
  const left = Math.max(0, run.periodEnd - now);
  let value = current ? current.amount * Math.min(1, left / current.durationMs) : 0;
  if (run.scheduled) value += scheduledValue(run.scheduled, run.end);
  return creditQuote(price, value, run.scheduled ? { replacesScheduled: true } : {});
}

// What a settled plan purchase writes onto accounts/{uid} — the webhook runs
// it inside its transaction, the tests run it directly. Returns
// { patch, scheduled?, grantBookStyles?, takesSeat? } or, when the order can
// no longer be applied the way it was sold, { issue } (paid, nothing
// changed; the admin sorts it out). `pending` is the payments/{order_id}
// record create-transaction.js wrote.
export function settlePlanPurchase(account, planKey, pending = {}, now = Date.now()) {
  const plan = PLANS[planKey] || LEGACY_PLANS[planKey];
  if (!plan) return { issue: "unknown-plan" };
  const due = dueSchedulePatch(account, now) || {};
  const acc = withDueSchedule(account, now);
  // Defensive twin of switchQuote's refusal: an order opened before the
  // account went Lifetime (or one forged around the pricing page) is paid,
  // but never downgrades a Lifetime account or takes a second seat.
  if (isLifetimePlan(acc.plan) && !(acc.plan === "founder" && planKey === "founder-ultimate")) {
    return { issue: "lifetime-conflict" };
  }
  const run = runningSubscription(acc, now);
  // Paying re-opens a lapsed ("readonly") account, never one an admin
  // deactivated — that stays the admin's call (audit S-22).
  const status = acc.status === "deactivated" ? {} : { status: "active" };

  // A downgrade bought while a bigger plan runs: it waits for the running
  // plan's own period to end (api/cron/check-expiry.js switches it over).
  if (pending.mode === "later" && plan.durationMs && run && run.key !== keyOf(plan.plan, plan.billing)) {
    // Two "later" checkouts opened before either was paid: the second one
    // can't queue behind the first without stacking (see switchQuote).
    if (run.scheduled) return { issue: "schedule-conflict" };
    const startsAt = run.periodEnd;
    const endsAt = startsAt + plan.durationMs;
    return {
      patch: { ...due, scheduledPlan: { plan: plan.plan, billing: plan.billing, brandLimit: plan.brandLimit, startsAt, endsAt }, subscriptionExpiresAt: endsAt },
      scheduled: true,
    };
  }

  const patch = { ...due, plan: plan.plan, paidAt: now, trialEndsAt: null, ...status };
  if (plan.billing) patch.billing = plan.billing;
  if (plan.brandLimit) patch.brandLimit = plan.brandLimit;
  if (plan.durationMs) {
    if (run && run.key === keyOf(plan.plan, plan.billing)) {
      // Renewing the same plan early adds a period to the running one — from
      // its own end, so a queued downgrade moves back by the same amount
      // instead of being turned into time on the bigger plan.
      patch.subscriptionExpiresAt = run.end + plan.durationMs;
      patch.scheduledPlan = run.scheduled
        ? { ...run.scheduled, startsAt: run.periodEnd + plan.durationMs, endsAt: (Number(run.scheduled.endsAt) || run.end) + plan.durationMs }
        : null;
    } else {
      // New plan or upgrade: a fresh period from today. Monthly → yearly of
      // the same plan is an upgrade whose unused days (and any queued
      // downgrade's prepaid value) already came off the price (switchQuote),
      // so nothing is added on top.
      patch.subscriptionExpiresAt = now + plan.durationMs;
      patch.scheduledPlan = null;
    }
    return { patch };
  }
  patch.subscriptionExpiresAt = null;
  patch.scheduledPlan = null;
  // What this Lifetime is worth, for a later Founder → Agency upgrade: the
  // plan's full price (cash + any credit that came off it), so an upgraded
  // Founder ends at Agency's price in total.
  if (PLANS[planKey]) patch.lifetimePaid = Number(pending.price) || Number(pending.amount || 0) + Number(pending.credit || 0);
  // Agency bought at full price by an account that has meanwhile become a
  // Founder (a checkout opened before the Founder one settled): applied —
  // it's what they paid for — but the Founder price was paid on top, which
  // is the admin's to refund.
  const review = acc.plan === "founder" && !pending.lifetimeUpgrade ? "lifetime-overpaid" : undefined;
  return { patch, grantBookStyles: true, takesSeat: !!plan.slot, ...(review ? { review } : {}) };
}

// ---- Auto-renew (Midtrans Subscription API, card only for now) ----------
// Behind MIDTRANS_RECURRING=true (Midtrans has to enable recurring on the
// production merchant first). The first payment goes through Snap with
// "save card"; the webhook then creates a Midtrans subscription that charges
// the saved card every period. Each charge comes back through the normal,
// signed payment notification with order_id "<name>-<32 digits>", and
// midtransSubs/<name> says whose it is and what it renews.
// What can renew itself: subscriptions, AI Sepuasnya, monthly brand slots.
export function recurringFor(planKey) {
  const p = PLANS[planKey];
  // `slot`: the key under accounts/{uid}.autoRenew (letters/digits/_ only,
  // so it works as a Firestore field path).
  if (p?.durationMs) return { interval: p.billing === "yearly" ? 12 : 1, slot: "plan" };
  if (planKey === "ai-unlimited") return { interval: 1, slot: "aiUnlimited" };
  if (planKey === "addon-brand-sub") return { interval: 1, slot: `brand_${Date.now().toString(36)}` };
  return null;
}
// Midtrans: name ≤ 40 chars of [A-Za-z0-9-_~.]; each charge's order_id is
// the name + 32 digits (the docs don't say whether a "-" sits between, so
// the name ends in "x" and both forms parse).
export const subscriptionName = (uid, now = Date.now()) => `bls-${String(uid).replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}-${now.toString(36)}x`;
export function subscriptionNameFromOrder(orderId) {
  const m = /^(bls-[A-Za-z0-9]+-[a-z0-9]+x)-?\d{32}$/.exec(String(orderId || ""));
  return m ? m[1] : null;
}

// Mirrors js/account.js accessState() === "paid".
export function isPaidAccount(account, now = Date.now()) {
  return !!account && account.status === "active" && account.plan !== "free" && account.plan !== "trial"
    && (account.subscriptionExpiresAt == null || Number(account.subscriptionExpiresAt) > now);
}

// Hard caps — never reopened as a new batch. Mirrored for display in
// js/views/pricing.js (FOUNDER_SLOT_CAPS); keep the two in sync.
export const SLOT_CAPS = { founderSlotsSold: 50, founderUltimateSlotsSold: 15 };

// Founder Lifetime is sold in two waves inside the same 50 slots: the first
// 15 buyers pay less than the 35 after them. Mirrored for display in
// js/views/pricing.js (FOUNDER.tiers); keep the two in sync.
export const FOUNDER_TIERS = [
  { upTo: 15, amount: 499000 },
  { upTo: 50, amount: 699000 },
];
export function founderAmount(sold) {
  return (FOUNDER_TIERS.find((tier) => sold < tier.upTo) || FOUNDER_TIERS[FOUNDER_TIERS.length - 1]).amount;
}

// Public, Admin-SDK-written counter doc. Deliberately NOT settings/main:
// that doc carries the shared AI API keys and must stay signed-in-only,
// while the pricing page needs this number for logged-out visitors too.
export const SLOTS_DOC = "meta/founderSlots";

// planKeys sold by the pre-subscription pricing page. No longer purchasable,
// but a payment started back then can still settle — webhook.js keeps
// honouring them so nobody pays and gets nothing.
export const LEGACY_PLANS = {
  all: { plan: "lifetime", durationMs: null },
  builder: { plan: "builder", durationMs: null },
  "content-os": { plan: "content-os", durationMs: null },
  monthly: { plan: "monthly", durationMs: MONTH_MS },
};
