// Community codes: an extra discount on the pay-once plans for whoever
// joined Wepeka Community — the code sits in the description of the
// community's WhatsApp group (wpk-dp src/lib/site.ts communityWhatsappGroupUrl),
// and the Founder's Deal page (founder/) tells visitors to fetch it there.
// Asked by the owner on 2026-10-15 ("diskon tambahan lewat kode referral di
// bio/deskripsi grup Wepeka Community").
//
// Server-only on purpose: js/ and founder/ ship to every visitor, so a code
// written there could be read without ever joining the group
// (tests/promo.test.mjs scans for it). Change or add a code here; the page
// and the app learn the discount from /api/offer and create-transaction.
//
//   off    rupiah taken off the price create-transaction would charge
//   plans  the plan keys (api/_plans.js PLANS) it applies to
//   label  how the invoice and the owner's sale email name the discount
export const PROMO_CODES = {
  WPKCOMMUNITY: { off: 50000, plans: ["founder", "founder-ultimate"], label: "Diskon Wepeka Community" },
};

// What a visitor typed, as the key it would be stored under: letters and
// digits only, upper case ("wpk community " → "WPKCOMMUNITY").
export const normalizePromo = (raw) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);

// The code's terms for this plan, or null (unknown code, other plan).
export function promoFor(raw, planKey, codes = PROMO_CODES) {
  const code = normalizePromo(raw);
  const entry = code ? codes[code] : null;
  if (!entry || !entry.plans.includes(planKey) || !(Number(entry.off) > 0)) return null;
  return { code, off: Number(entry.off), label: entry.label };
}

// `amount` after the code, never below `floor` (Midtrans refuses a zero
// charge; api/_plans.js MIN_CHARGE). `off` = what actually came off.
export function applyPromo(amount, promo, floor = 1000) {
  const before = Math.round(Number(amount) || 0);
  if (!promo) return { amount: before, off: 0 };
  const after = Math.max(floor, before - promo.off);
  return { amount: Math.min(before, after), off: Math.max(0, before - Math.min(before, after)) };
}

// The biggest cut any code gives each plan, e.g. { founder: 50000 } — the
// "save Rp 50.000 more" line on the Founder's Deal page, which must not
// carry a code itself. Empty when no code is set.
export function communityOffer(codes = PROMO_CODES) {
  const out = {};
  for (const entry of Object.values(codes)) {
    for (const plan of entry.plans) if (Number(entry.off) > (out[plan] || 0)) out[plan] = Number(entry.off);
  }
  return out;
}
