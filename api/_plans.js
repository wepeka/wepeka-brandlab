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

// One-time add-ons: extra brand slots, kept for as long as the account's own
// plan lasts. Only sold to pay-once plans (a subscriber's extra brand is a
// monthly add-on instead, still handled by hand). Priced so that stacking
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

export const ADDON_ELIGIBLE_PLANS = ["founder", "founder-ultimate", "lifetime"];

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
