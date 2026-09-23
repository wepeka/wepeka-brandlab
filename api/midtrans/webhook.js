// Midtrans's server-to-server payment notification. This is the ONLY place
// that ever flips accounts/{uid}.plan/status to a paid state — never trust
// a client-side "payment succeeded" callback for that (see js/views/
// pricing.js's onSuccess, which just shows a toast and waits for this).
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../_firebaseAdmin.js";
import { PLANS, ADDONS, LEGACY_PLANS, LIFETIME_BOOK_STYLES, SLOTS_DOC } from "../_plans.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body || {};
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

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

  // custom_field1/2 (uid/planKey) travel with the notification unsigned —
  // Midtrans's signature only covers order_id/status_code/gross_amount, so
  // trusting them would let anyone who can reach this endpoint with a valid
  // signature (from their own tiny real payment) redirect the unlock to a
  // different account or a different plan. order_id IS covered by the
  // signature, so instead we look up what THIS order was actually for in the
  // pending record create-transaction.js wrote before ever calling Midtrans.
  const db = adminDb();
  const paymentRef = db.doc(`payments/${order_id}`);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    console.error("Midtrans webhook: no pending payment record for", order_id);
    return res.status(400).json({ error: "Order tidak dikenal." });
  }
  const pending = paymentSnap.data();

  const isPaid = ["capture", "settlement"].includes(transaction_status) && fraud_status !== "deny";
  if (!isPaid) {
    // pending/deny/expire/cancel — nothing to unlock, but 200 so Midtrans
    // doesn't keep retrying a notification we've already understood.
    return res.status(200).json({ ok: true, ignored: transaction_status });
  }

  if (pending.status !== "pending") {
    // Already settled by an earlier notification for this same order_id.
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const { uid, planKey } = pending;
  // LEGACY_PLANS is only ever reachable here because the pending doc above
  // already proved this order_id was recorded — create-transaction.js never
  // creates one for a legacy planKey, so an order_id nobody recorded (a
  // genuinely old, pre-this-system in-flight legacy payment) is now rejected
  // by the check above instead of being trusted on custom_field2 alone.
  const plan = PLANS[planKey] || ADDONS[planKey] || LEGACY_PLANS[planKey];
  if (!uid || !plan) {
    console.error("Midtrans webhook: pending record missing uid/plan", { order_id, pending });
    return res.status(400).json({ error: "Data pending tidak valid." });
  }
  // The signature covers gross_amount, so this is Midtrans's own word for
  // what was charged — it has to match what create-transaction.js quoted for
  // this order (already tier-resolved there, so no need to re-derive tiers).
  if (Number(gross_amount) !== Number(pending.amount)) {
    console.error("Midtrans webhook: amount mismatch", { order_id, planKey, gross_amount, expected: pending.amount });
    return res.status(400).json({ error: "Nominal tidak cocok dengan paket." });
  }

  const accountRef = db.doc(`accounts/${uid}`);
  const now = Date.now();

  // One transaction, re-checking payments/{order_id}.status: Midtrans can and
  // does retry the same notification, and a retry must not extend the
  // subscription a second time, take a second Founder slot, or double-count
  // revenue in the admin dashboard's per-account total.
  const firstTime = await db.runTransaction(async (tx) => {
    const [freshPaymentSnap, accountSnap] = await Promise.all([tx.get(paymentRef), tx.get(accountRef)]);
    if (!freshPaymentSnap.exists || freshPaymentSnap.data().status !== "pending") return false;

    // A Brand Book art style only joins the account's owned list.
    if (plan.bookStyle) {
      tx.set(accountRef, { bookStyles: FieldValue.arrayUnion(plan.bookStyle) }, { merge: true });
      tx.set(paymentRef, { status: "paid", amount: Number(gross_amount), paidAt: now }, { merge: true });
      return true;
    }

    // An add-on only widens the brand limit — plan, status and expiry are
    // none of its business.
    if (plan.addBrands) {
      tx.set(accountRef, { brandLimit: FieldValue.increment(plan.addBrands) }, { merge: true });
      tx.set(paymentRef, { status: "paid", amount: Number(gross_amount), paidAt: now }, { merge: true });
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
      patch.bookStyles = FieldValue.arrayUnion(...LIFETIME_BOOK_STYLES);
    }

    tx.set(accountRef, patch, { merge: true });
    tx.set(paymentRef, { status: "paid", plan: plan.plan, amount: Number(gross_amount), paidAt: now }, { merge: true });
    if (plan.slot) tx.set(db.doc(SLOTS_DOC), { [plan.slot]: FieldValue.increment(1) }, { merge: true });
    return true;
  });

  return res.status(200).json({ ok: true, duplicate: !firstTime });
}
