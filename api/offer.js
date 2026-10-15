// Public facts for the Founder's Deal page (founder/, brandlab.wepeka.com/founder,
// the Instagram-ads landing): how many Lifetime seats are gone, what the
// open wave costs, whether online payment is open, the intro video — and,
// given `?code=`, whether that Wepeka Community code is real (api/_promo.js).
// Read with the Admin SDK and cached at the edge for a few seconds, so a
// burst of ad traffic costs a handful of Firestore reads, not one each.
// Nothing here can buy anything: create-transaction prices every checkout
// itself.
import { adminDb } from "./_firebaseAdmin.js";
import { PLANS, SLOT_CAPS, SLOTS_DOC, FOUNDER_TIERS, seatsTaken, seatPrice } from "./_plans.js";
import { MIDTRANS_IS_PRODUCTION, MIDTRANS_CLIENT_KEY } from "./_payments.js";
import { promoFor, normalizePromo, communityOffer } from "./_promo.js";

// Lifetime's price once the Founder seats are gone — the struck-through
// anchor. Same numbers as js/views/pricing.js LIFETIME_NORMAL_PRICE /
// AGENCY_NORMAL_PRICE (owner's decision, 2026-10-12); keep them in step.
export const NORMAL_PRICES = { founder: 3000000, "founder-ultimate": 6000000 };
// The monthly plan with Founder's allowance (3 brands, 100 credits a day),
// for the "cheaper than N months" line.
export const PRO_MONTHLY = PLANS["pro-monthly"].amount;
const INTRO_VIDEO_KEY = "kenalan";

// The Founder seat count and price wave as the page shows them.
export function founderFacts(slotsDoc, now = Date.now()) {
  const plan = PLANS.founder;
  const cap = SLOT_CAPS[plan.slot];
  const taken = Math.min(cap, seatsTaken(slotsDoc, plan.slot, now));
  const wave = FOUNDER_TIERS.findIndex((tier) => taken < tier.upTo);
  const open = wave === -1 ? FOUNDER_TIERS.length - 1 : wave;
  const tier = FOUNDER_TIERS[open];
  const waveStart = open === 0 ? 0 : FOUNDER_TIERS[open - 1].upTo;
  return {
    taken, cap, soldOut: taken >= cap,
    price: seatPrice(plan, taken),
    wave: open + 1, waveSize: tier.upTo - waveStart, waveTaken: Math.max(0, taken - waveStart), waveLeft: Math.max(0, tier.upTo - taken),
    nextPrice: FOUNDER_TIERS[open + 1]?.amount ?? null,
    tiers: FOUNDER_TIERS.map((t, i) => ({ seats: t.upTo - (i ? FOUNDER_TIERS[i - 1].upTo : 0), price: t.amount })),
    normal: NORMAL_PRICES.founder,
  };
}

export function agencyFacts(slotsDoc, now = Date.now()) {
  const plan = PLANS["founder-ultimate"];
  const cap = SLOT_CAPS[plan.slot];
  const taken = Math.min(cap, seatsTaken(slotsDoc, plan.slot, now));
  return { taken, cap, soldOut: taken >= cap, price: plan.amount, brands: plan.brandLimit, normal: NORMAL_PRICES["founder-ultimate"] };
}

// A YouTube watch/short/embed link → its 11-character id.
export function youtubeId(src) {
  const m = String(src || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const db = adminDb();
  const [slotsSnap, videosSnap] = await Promise.all([
    db.doc(SLOTS_DOC).get().catch(() => null),
    db.doc("meta/guideVideos").get().catch(() => null),
  ]);
  const slots = slotsSnap?.exists ? slotsSnap.data() : slotsSnap ? {} : null;
  const intro = videosSnap?.data()?.videos?.[INTRO_VIDEO_KEY];
  const introSrc = Array.isArray(intro?.parts) && intro.parts[0]?.src ? intro.parts[0].src : intro?.src;
  const body = {
    // null = the seat doc couldn't be read: the page shows prices without a count.
    founder: slots ? founderFacts(slots) : null,
    agency: slots ? agencyFacts(slots) : null,
    proMonthly: PRO_MONTHLY,
    // How much a Wepeka Community code saves (never the code itself).
    community: communityOffer(),
    payOpen: MIDTRANS_IS_PRODUCTION && !!process.env.MIDTRANS_SERVER_KEY && !!MIDTRANS_CLIENT_KEY,
    video: youtubeId(introSrc) ? { id: youtubeId(introSrc), seconds: Math.round(Number(intro?.seconds || intro?.parts?.[0]?.seconds) || 0) } : null,
  };
  const raw = req.query?.code ?? new URL(req.url, "https://x").searchParams.get("code");
  if (raw != null) {
    const code = normalizePromo(raw);
    // Rupiah off per plan the code covers, e.g. { founder: 50000 }.
    const off = Object.fromEntries(["founder", "founder-ultimate"].map((key) => [key, promoFor(code, key)?.off || 0]).filter(([, n]) => n > 0));
    body.promo = Object.keys(off).length ? { ok: true, code, off } : { ok: false, code };
  }
  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
  return res.status(200).json(body);
}
