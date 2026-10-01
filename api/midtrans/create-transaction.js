// Creates a Midtrans Snap transaction token. The price is looked up here,
// server-side, from `planKey` alone — the amount is never accepted from the
// client, same principle wpk-dp's own storefront already uses ("server-
// authoritative pricing"). See js/views/pricing.js for the caller.
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { PLANS, ADDONS, founderAmount, ADDON_ELIGIBLE_PLANS, isPaidAccount, SLOT_CAPS, SLOTS_DOC, switchQuote, recurringFor } from "../_plans.js";
import { RECURRING_ON } from "../_midtrans.js";
import { metaContext } from "../_meta.js";
import { MIDTRANS_IS_PRODUCTION, MIDTRANS_CLIENT_KEY, paymentsOpenFor } from "../_payments.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const SNAP_API_URL = MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

// Why a plan can't be bought (api/_plans.js switchQuote `code`), in the
// words the toast shows when the browser has no text of its own for the
// code (js/views/pricing.js maps the codes it knows to i18n first).
const REFUSALS = {
  "lifetime-owned": "Akun kamu sudah Lifetime — nggak perlu beli paket lagi. Mau pindah paket? Chat kami lewat WhatsApp.",
  "lifetime-top": "Akun kamu sudah Agency Lifetime, paket tertinggi.",
  "lifetime-manual": "Upgrade ke Agency Lifetime untuk akunmu dihitung tim Wepeka (selisih dari harga Founder yang kamu bayar) — chat kami lewat WhatsApp.",
  scheduled: "Kamu sudah menjadwalkan pindah paket. Paket lain bisa dibeli setelah jadwal itu mulai.",
};
const refusalBody = (q) => ({ error: REFUSALS[q.code] || "Paket ini tidak bisa dibeli untuk akunmu.", code: q.code, ...(q.startsAt ? { startsAt: q.startsAt } : {}) });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // A logged-out visitor on the pricing page only needs to know whether
  // online payment exists at all (it decides the "pay via Midtrans" line).
  if (req.body?.statusOnly && !req.headers.authorization) {
    return res.status(200).json({ open: MIDTRANS_IS_PRODUCTION && !!MIDTRANS_SERVER_KEY && !!MIDTRANS_CLIENT_KEY, production: MIDTRANS_IS_PRODUCTION });
  }

  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }

  // statusOnly: may this account pay online right now, in which Midtrans
  // mode, with which client key — and, given a planKey, what it's called and
  // costs (the WhatsApp fallback message quotes it). quoteOnly: just say what
  // it would cost (the "switch plan" confirmation shows the credit / start
  // date before Snap opens). autoRenew: false opts out of saving the card even
  // where auto-renew is available.
  const { planKey, quoteOnly = false, statusOnly = false, autoRenew = true } = req.body || {};
  const plan = PLANS[planKey] || ADDONS[planKey];

  const accountRef = adminDb().doc(`accounts/${uid}`);
  const accountSnap = await accountRef.get();
  const account = accountSnap.exists ? accountSnap.data() : null;
  const open = !!MIDTRANS_SERVER_KEY && !!MIDTRANS_CLIENT_KEY && paymentsOpenFor(uid, account) && account?.status !== "deactivated";

  if (statusOnly) {
    const status = { open, production: MIDTRANS_IS_PRODUCTION, clientKey: MIDTRANS_CLIENT_KEY };
    if (plan) {
      let amount = plan.amount;
      if (plan.slot && plan.tiered) {
        const slotsSnap = await adminDb().doc(SLOTS_DOC).get();
        amount = founderAmount(Number(slotsSnap.data()?.[plan.slot]) || 0);
      }
      Object.assign(status, { label: plan.label, amount });
      // A plan this account may not buy at all (a Lifetime account, a second
      // queued downgrade) says so here, before any WhatsApp order is offered.
      const q = PLANS[planKey] && account ? switchQuote(account, planKey, amount) : null;
      if (q?.mode === "refused") Object.assign(status, { refused: refusalBody(q) });
    }
    return res.status(200).json(status);
  }

  if (!MIDTRANS_SERVER_KEY) {
    return res.status(500).json({ error: "MIDTRANS_SERVER_KEY belum diset di Vercel (atau deployment belum di-redeploy setelah diset)." });
  }
  if (!plan) {
    return res.status(400).json({ error: "Paket tidak valid." });
  }
  if (!account) return res.status(404).json({ error: "Akun tidak ditemukan — coba login ulang." });
  if (account.status === "deactivated") return res.status(403).json({ error: "Akun ini sedang dinonaktifkan." });
  // Sandbox checkout stays shut for real customers (api/_payments.js) — the
  // browser already shows the WhatsApp route; this is the enforcement.
  if (!quoteOnly && !open) {
    return res.status(403).json({ error: "Pembayaran online belum dibuka — pesan lewat WhatsApp dulu ya.", code: "payments-closed" });
  }

  // Permanent slots are for pay-once plans only — a subscriber moves to
  // Lifetime first (owner's decision, 2026-09-29); monthly slots are for
  // any paid account.
  if (plan.addBrands && !(ADDON_ELIGIBLE_PLANS.includes(account.plan) && isPaidAccount(account))) {
    return res.status(403).json({ error: "Tambah brand selamanya khusus akun Lifetime — upgrade ke Lifetime dulu." });
  }
  if (plan.addBrandSlotMs && !isPaidAccount(account)) {
    return res.status(403).json({ error: "Tambah brand tersedia setelah pilih paket." });
  }
  if ((plan.aiCredits || plan.aiUnlimitedMs) && !isPaidAccount(account)) {
    return res.status(403).json({ error: "Kredit AI tambahan tersedia setelah pilih paket." });
  }

  if (plan.bookStyle && (account.bookStyles || []).includes(plan.bookStyle)) {
    return res.status(409).json({ error: "Gaya Brand Book ini sudah kamu miliki." });
  }

  // A plan this account may not buy (api/_plans.js switchQuote: anything on
  // top of a Lifetime plan but Founder → Agency, a second queued downgrade)
  // is refused before a seat is even looked at.
  const precheck = PLANS[planKey] ? switchQuote(account, planKey, plan.amount) : null;
  if (precheck?.mode === "refused") return res.status(409).json(refusalBody(precheck));

  // Founder slots are a hard cap — refuse to even start a payment once the
  // counter is full. The webhook is what actually increments it, so a
  // checkout opened before the last slot sold can still settle — but only
  // inside its 60-minute Snap window (below); someone who has already paid
  // is never refused.
  let amount = plan.amount;
  if (plan.slot) {
    const slotsSnap = await adminDb().doc(SLOTS_DOC).get();
    const sold = Number(slotsSnap.data()?.[plan.slot]) || 0;
    if (sold >= SLOT_CAPS[plan.slot]) {
      return res.status(409).json({ error: "Slot paket ini sudah habis." });
    }
    if (plan.tiered) amount = founderAmount(sold);
  }

  // A plan while another subscription runs replaces it, never stacks:
  // upgrade = now, minus what's left of the old period; downgrade = starts
  // when the current period ends (api/_plans.js switchQuote).
  const price = amount;
  const quote = PLANS[planKey] ? switchQuote(account, planKey, price) : { mode: "new", amount: price, credit: 0 };
  if (quote.mode === "refused") return res.status(409).json(refusalBody(quote));
  amount = quote.amount;
  if (quoteOnly) return res.status(200).json({ ...quote, price });
  const recurring = RECURRING_ON && autoRenew !== false && !!recurringFor(planKey);

  // Midtrans caps order_id at 50 chars: "bl-" + 28-char uid + "-" + base36
  // timestamp (~9 chars) stays well under it. (The old "brandlab-…-<ms>"
  // form was 51 and Midtrans refused every transaction.)
  const orderId = `bl-${uid}-${Date.now().toString(36)}`;
  try {
    const midtransRes = await fetch(SNAP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Basic " + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString("base64"),
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: amount },
        customer_details: account.email ? { email: account.email } : undefined,
        item_details: [{ id: planKey, price: amount, quantity: 1, name: plan.label }],
        // Auto-renew: Snap offers to save the card; the webhook turns the
        // saved card into a Midtrans subscription (api/_plans.js recurringFor).
        ...(recurring ? { credit_card: { secure: true, save_card: true }, user_id: uid } : {}),
        // A capped seat is priced and checked against the cap when this
        // checkout opens; an hour-long window keeps a stale open checkout
        // from settling long after the last seat (or the price wave) is gone.
        ...(plan.slot ? { expiry: { unit: "minutes", duration: 60 } } : {}),
        // Carried straight through to the webhook payload — safer than
        // parsing uid/planKey back out of order_id's own text.
        custom_field1: uid,
        custom_field2: planKey,
      }),
    });
    const data = await midtransRes.json();
    if (!midtransRes.ok) {
      console.error("Midtrans create-transaction failed", midtransRes.status, data);
      // Surface Midtrans's own reason (never a key) so a misconfigured
      // dashboard/env is diagnosable from the toast instead of Vercel logs.
      const reason = Array.isArray(data?.error_messages) ? data.error_messages.join("; ") : data?.status_message || `HTTP ${midtransRes.status}`;
      return res.status(502).json({ error: `Gagal membuat transaksi pembayaran. Midtrans: ${reason}` });
    }
    // The webhook trusts THIS record for uid/planKey/amount, keyed on
    // order_id (which Midtrans's signature does cover) — not custom_field1/2,
    // which travel unsigned and could otherwise be edited in flight.
    await adminDb().doc(`payments/${orderId}`).set({
      uid, planKey, plan: plan.plan || planKey, amount, status: "pending", createdAt: Date.now(),
      // `price` = the plan's own price before any credit (a Lifetime's worth
      // for a later Founder → Agency upgrade, api/_plans.js settlePlanPurchase).
      mode: quote.mode, price, credit: quote.credit || 0, ...(quote.startsAt ? { startsAt: quote.startsAt } : {}), ...(recurring ? { recurring: true } : {}),
      ...(quote.lifetimeUpgrade ? { lifetimeUpgrade: true } : {}),
      // Buyer's browser context for the webhook's Meta Purchase event (api/_meta.js).
      meta: metaContext(req),
    });
    // orderId/amount/label let the client report a GA4 purchase with the
    // real paid value (js/analytics.js) — nothing secret in them.
    return res.status(200).json({ token: data.token, orderId, amount, label: plan.label });
  } catch (err) {
    console.error("create-transaction error", err);
    return res.status(500).json({ error: "Gagal menghubungi Midtrans." });
  }
}
