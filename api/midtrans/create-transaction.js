// Creates a Midtrans Snap transaction token. The price is looked up here,
// server-side, from `planKey` alone — the amount is never accepted from the
// client, same principle wpk-dp's own storefront already uses ("server-
// authoritative pricing"). See js/views/pricing.js for the caller.
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { PLANS, ADDONS, founderAmount, ADDON_ELIGIBLE_PLANS, SLOT_CAPS, SLOTS_DOC } from "../_plans.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";
const SNAP_API_URL = MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }

  if (!MIDTRANS_SERVER_KEY) {
    return res.status(500).json({ error: "MIDTRANS_SERVER_KEY belum diset di Vercel (atau deployment belum di-redeploy setelah diset)." });
  }

  const { planKey } = req.body || {};
  const plan = PLANS[planKey] || ADDONS[planKey];
  if (!plan) {
    return res.status(400).json({ error: "Paket tidak valid." });
  }

  const accountRef = adminDb().doc(`accounts/${uid}`);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) return res.status(404).json({ error: "Akun tidak ditemukan — coba login ulang." });
  const account = accountSnap.data();
  if (account.status === "deactivated") return res.status(403).json({ error: "Akun ini sedang dinonaktifkan." });

  if (plan.addBrands && !ADDON_ELIGIBLE_PLANS.includes(account.plan)) {
    return res.status(403).json({ error: "Add-on ini khusus akun lifetime (Founder)." });
  }

  if (plan.bookStyle && (account.bookStyles || []).includes(plan.bookStyle)) {
    return res.status(409).json({ error: "Gaya Brand Book ini sudah kamu miliki." });
  }

  // Founder slots are a hard cap — refuse to even start a payment once the
  // counter is full. (The webhook is what actually increments it, so two
  // people paying in the same minute for the very last slot can both get
  // through; that's an acceptable, honest oversell of one — never refuse
  // someone who has already paid.)
  let amount = plan.amount;
  if (plan.slot) {
    const slotsSnap = await adminDb().doc(SLOTS_DOC).get();
    const sold = Number(slotsSnap.data()?.[plan.slot]) || 0;
    if (sold >= SLOT_CAPS[plan.slot]) {
      return res.status(409).json({ error: "Slot paket ini sudah habis." });
    }
    if (plan.tiered) amount = founderAmount(sold);
  }

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
    });
    return res.status(200).json({ token: data.token });
  } catch (err) {
    console.error("create-transaction error", err);
    return res.status(500).json({ error: "Gagal menghubungi Midtrans." });
  }
}
