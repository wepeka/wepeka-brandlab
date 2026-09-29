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
const TIER_RANK = { starter: 1, pro: 2, studio: 3, founder: 10, "founder-ultimate": 11 };
const LIFETIME_KEYS = ["founder", "founder-ultimate", "lifetime"];
export const MIN_CHARGE = 1000;

function rankOf(plan, billing) {
  const base = TIER_RANK[plan] || 0;
  return base >= 10 ? base : base + (billing === "yearly" ? 0.5 : 0);
}

// What buying `planKey` costs this account right now, and when it starts.
// mode: "new" (nothing running), "renew" (same plan), "now" (upgrade,
// with `credit` = the unused part of the current period), "later"
// (downgrade, starts at `startsAt`). `price` is the plan's own price (for a
// tiered Founder plan, the tier price the caller already resolved).
export function switchQuote(account, planKey, price, now = Date.now()) {
  const target = PLANS[planKey];
  if (!target) return null;
  const running = isPaidAccount(account, now) && SUBSCRIPTION_PLANS.includes(account.plan) && Number(account.subscriptionExpiresAt) > now;
  if (!running) return { mode: "new", amount: price, credit: 0 };
  const currentKey = `${account.plan}-${account.billing || "monthly"}`;
  if (currentKey === planKey) return { mode: "renew", amount: price, credit: 0 };
  const current = PLANS[currentKey];
  const up = rankOf(target.plan, target.billing) > rankOf(account.plan, account.billing || "monthly");
  if (!up) return { mode: "later", amount: price, credit: 0, startsAt: Number(account.subscriptionExpiresAt) };
  const left = Math.max(0, Number(account.subscriptionExpiresAt) - now);
  const credit = current ? Math.floor((current.amount * Math.min(1, left / current.durationMs)) / 100) * 100 : 0;
  return { mode: "now", amount: Math.max(MIN_CHARGE, price - credit), credit: Math.min(credit, price - MIN_CHARGE) };
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
