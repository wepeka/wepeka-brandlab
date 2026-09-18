// Midtrans's server-to-server payment notification. This is the ONLY place
// that ever flips accounts/{uid}.plan/status to a paid state — never trust
// a client-side "payment succeeded" callback for that (see js/views/
// pricing.js's onSuccess, which just shows a toast and waits for this).
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../_firebaseAdmin.js";
import { PLANS, ADDONS, FOUNDER_TIERS, LEGACY_PLANS, SLOTS_DOC } from "../_plans.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body || {};
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status, custom_field1: uid, custom_field2: planKey } = body;

  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return res.status(400).json({ error: "Payload tidak lengkap." });
  }
  const expectedSignature = crypto
    .createHash("sha512")
    .update(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
    .digest("hex");
  if (expectedSignature !== signature_key) {
    console.error("Midtrans webhook: invalid signature for", order_id);
    return res.status(403).json({ error: "Signature tidak valid." });
  }

  const plan = PLANS[planKey] || ADDONS[planKey] || LEGACY_PLANS[planKey];
  if (!uid || !plan) {
    console.error("Midtrans webhook: missing/unknown uid or planKey", { uid, planKey });
    return res.status(400).json({ error: "uid/planKey tidak dikenali." });
  }

  const isPaid = ["capture", "settlement"].includes(transaction_status) && fraud_status !== "deny";
  if (!isPaid) {
    // pending/deny/expire/cancel — nothing to unlock, but 200 so Midtrans
    // doesn't keep retrying a notification we've already understood.
    return res.status(200).json({ ok: true, ignored: transaction_status });
  }
  // The signature covers gross_amount, so this is Midtrans's own word for
  // what was charged — it has to be the price of the plan being unlocked.
  // (A tiered plan was charged whichever wave was open when checkout began.)
  const validAmounts = plan.tiered ? FOUNDER_TIERS.map((tier) => tier.amount) : [plan.amount];
  if (plan.amount && !validAmounts.includes(Number(gross_amount))) {
    console.error("Midtrans webhook: amount mismatch", { order_id, planKey, gross_amount });
    return res.status(400).json({ error: "Nominal tidak cocok dengan paket." });
  }

  const db = adminDb();
  const accountRef = db.doc(`accounts/${uid}`);
  const paymentRef = db.doc(`payments/${order_id}`);
  const now = Date.now();

  // One transaction, keyed on payments/{order_id}: Midtrans can and does
  // retry the same notification, and a retry must not extend the
  // subscription a second time, take a second Founder slot, or double-count
  // revenue in the admin dashboard's per-account total.
  const firstTime = await db.runTransaction(async (tx) => {
    const [paymentSnap, accountSnap] = await Promise.all([tx.get(paymentRef), tx.get(accountRef)]);
    if (paymentSnap.exists) return false;

    // A Brand Book art style only joins the account's owned list.
    if (plan.bookStyle) {
      tx.set(accountRef, { bookStyles: FieldValue.arrayUnion(plan.bookStyle) }, { merge: true });
      tx.set(paymentRef, { uid, orderId: order_id, plan: planKey, planKey, amount: Number(gross_amount), paidAt: now });
      return true;
    }

    // An add-on only widens the brand limit — plan, status and expiry are
    // none of its business.
    if (plan.addBrands) {
      tx.set(accountRef, { brandLimit: FieldValue.increment(plan.addBrands) }, { merge: true });
      tx.set(paymentRef, { uid, orderId: order_id, plan: planKey, planKey, amount: Number(gross_amount), paidAt: now });
      return true;
    }

    const patch = { plan: plan.plan, status: "active", paidAt: now, trialEndsAt: null };
    if (plan.billing) patch.billing = plan.billing;
    if (plan.brandLimit) patch.brandLimit = plan.brandLimit;
    if (plan.durationMs) {
      // Renewing the same plan early adds to the time left instead of
      // throwing it away; switching plans starts a fresh period from today.
      const current = accountSnap.data() || {};
      const stillRunning = current.plan === plan.plan && Number(current.subscriptionExpiresAt) > now;
      patch.subscriptionExpiresAt = (stillRunning ? current.subscriptionExpiresAt : now) + plan.durationMs;
    } else {
      patch.subscriptionExpiresAt = null;
    }

    tx.set(accountRef, patch, { merge: true });
    tx.set(paymentRef, { uid, orderId: order_id, plan: plan.plan, planKey, amount: Number(gross_amount), paidAt: now });
    if (plan.slot) tx.set(db.doc(SLOTS_DOC), { [plan.slot]: FieldValue.increment(1) }, { merge: true });
    return true;
  });

  return res.status(200).json({ ok: true, duplicate: !firstTime });
}
