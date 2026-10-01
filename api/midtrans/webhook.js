// Midtrans's server-to-server payment notification. This is the ONLY place
// that ever flips accounts/{uid}.plan/status to a paid state — never trust
// a client-side "payment succeeded" callback for that (see js/views/
// pricing.js's onSuccess, which just shows a toast and waits for this).
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../_firebaseAdmin.js";
import { PLANS, ADDONS, LEGACY_PLANS, LIFETIME_BOOK_STYLES, SLOTS_DOC, nextBrandSlots, recurringFor, subscriptionName, subscriptionNameFromOrder, settlePlanPurchase } from "../_plans.js";
import { RECURRING_ON, transactionStatus, createSubscription, disableSubscription } from "../_midtrans.js";
import { sendMetaEvent } from "../_meta.js";
import { MIDTRANS_IS_PRODUCTION, isPaymentTester, isSettled } from "../_payments.js";

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;

// Constant-time compare of two hex digests.
function sameDigest(a, b) {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  // No key = no way to tell a real notification from a forged one (the hash
  // would be computed over the literal text "undefined"). Refuse, loudly.
  if (!MIDTRANS_SERVER_KEY) {
    console.error("Midtrans webhook: MIDTRANS_SERVER_KEY is not set for this deployment");
    return res.status(500).json({ error: "Server belum dikonfigurasi." });
  }

  const body = req.body || {};
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;

  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return res.status(400).json({ error: "Payload tidak lengkap." });
  }
  const expectedSignature = crypto
    .createHash("sha512")
    .update(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
    .digest("hex");
  if (!sameDigest(expectedSignature, signature_key)) {
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
  // An auto-renew charge: Midtrans made this order itself ("<name><32
  // digits>"), so there's no pending record — midtransSubs/<name> says whose
  // subscription it is. Same signed notification as any payment.
  const subName = !paymentSnap.exists ? subscriptionNameFromOrder(order_id) : null;
  if (subName) {
    return res.status(200).json(await applyRenewalCharge(db, { orderId: order_id, name: subName, grossAmount: Number(gross_amount), paid: isSettled(transaction_status, fraud_status) }));
  }
  if (!paymentSnap.exists) {
    // Unknown order: nothing to unlock. Answer 200 anyway — the dashboard's
    // "Test notification URL" button sends a made-up order_id and treats
    // anything but 2xx as a failed endpoint, and a real stray notification
    // would just be retried forever otherwise. The signature check above
    // already proved it came from Midtrans.
    console.warn("Midtrans webhook: no payment record for", order_id, "- ignored");
    return res.status(200).json({ ok: true, ignored: "unknown-order" });
  }
  const pending = paymentSnap.data();

  if (!isSettled(transaction_status, fraud_status)) {
    // pending/challenge/deny/expire/cancel — nothing to unlock, but 200 so
    // Midtrans doesn't keep retrying a notification we've already understood.
    // An order that will never be paid stops showing as "pending".
    if (["expire", "cancel", "deny"].includes(transaction_status) && pending.status === "pending") {
      await paymentRef.set({ status: transaction_status, closedAt: Date.now() }, { merge: true });
    }
    return res.status(200).json({ ok: true, ignored: transaction_status });
  }

  if (pending.status !== "pending") {
    // Already settled by an earlier notification for this same order_id.
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const { uid, planKey } = pending;
  // Sandbox mode: test cards settle for real, so only Wepeka's team and the
  // Midtrans reviewer's demo accounts may unlock anything (api/_payments.js).
  // An older order from someone else is voided instead of granted.
  if (!MIDTRANS_IS_PRODUCTION) {
    const buyer = (await db.doc(`accounts/${uid}`).get()).data();
    if (!isPaymentTester(uid, buyer)) {
      await paymentRef.set({ status: "void-sandbox", closedAt: Date.now() }, { merge: true });
      console.warn("Midtrans webhook: sandbox payment from a non-tester voided", order_id);
      return res.status(200).json({ ok: true, ignored: "sandbox" });
    }
  }
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

    // AI credits: top-ups add to a pool that never expires; AI Sepuasnya
    // runs 30 more days from whichever is later, now or its current end.
    if (plan.aiCredits || plan.aiUnlimitedMs) {
      if (plan.aiCredits) tx.set(accountRef, { aiCredits: FieldValue.increment(plan.aiCredits) }, { merge: true });
      if (plan.aiUnlimitedMs) {
        const current = Number(accountSnap.data()?.aiUnlimitedUntil) || 0;
        tx.set(accountRef, { aiUnlimitedUntil: Math.max(current, now) + plan.aiUnlimitedMs }, { merge: true });
      }
      tx.set(paymentRef, { status: "paid", amount: Number(gross_amount), paidAt: now }, { merge: true });
      return true;
    }

    // A monthly brand slot: a new 30-day slot, or (renew) 30 more days on
    // the one ending soonest.
    if (plan.addBrandSlotMs) {
      const slots = nextBrandSlots(accountSnap.data()?.brandSlotsUntil, now, plan.addBrandSlotMs, { renew: !!plan.renew });
      tx.set(accountRef, { brandSlotsUntil: slots }, { merge: true });
      tx.set(paymentRef, { status: "paid", amount: Number(gross_amount), paidAt: now }, { merge: true });
      return true;
    }

    // A permanent brand slot — its own counter, so a plan purchase or a
    // renewal resetting brandLimit never takes it away.
    if (plan.addBrands) {
      tx.set(accountRef, { extraBrands: FieldValue.increment(plan.addBrands) }, { merge: true });
      tx.set(paymentRef, { status: "paid", amount: Number(gross_amount), paidAt: now }, { merge: true });
      return true;
    }

    // A plan: what it does to the account is decided against the account
    // as it is NOW (api/_plans.js settlePlanPurchase) — a queued downgrade
    // waits for the running plan's own period, a renewal adds to it, and an
    // order that can no longer apply the way it was sold (a second queued
    // downgrade, or any plan but Agency on top of a Lifetime account) is
    // recorded as paid and flagged for the admin instead of being forced
    // onto the account — a Lifetime plan is never downgraded from here.
    const decision = settlePlanPurchase(accountSnap.data() || {}, planKey, pending, now);
    if (decision.issue) {
      tx.set(paymentRef, { status: "paid", plan: plan.plan, amount: Number(gross_amount), paidAt: now, needsReview: decision.issue }, { merge: true });
      tx.set(accountRef, { paymentIssue: { orderId: order_id, status: decision.issue, planKey, at: now } }, { merge: true });
      console.warn("Midtrans webhook: paid order needs review", order_id, decision.issue);
      return "issue";
    }
    const patch = { ...decision.patch };
    if (decision.grantBookStyles) patch.bookStyles = FieldValue.arrayUnion(...LIFETIME_BOOK_STYLES);
    // Applied, but worth a look (e.g. a Founder who paid Agency's full price).
    if (decision.review) patch.paymentIssue = { orderId: order_id, status: decision.review, planKey, at: now };
    tx.set(accountRef, patch, { merge: true });
    tx.set(paymentRef, { status: "paid", plan: plan.plan, amount: Number(gross_amount), paidAt: now, ...(decision.scheduled ? { scheduled: true } : {}), ...(decision.review ? { needsReview: decision.review } : {}) }, { merge: true });
    if (decision.takesSeat) tx.set(db.doc(SLOTS_DOC), { [plan.slot]: FieldValue.increment(1) }, { merge: true });
    return true;
  });

  // Auto-renew bookkeeping happens after the unlock is committed and never
  // fails the notification: a problem here only means no auto-renew. A paid
  // order flagged for review changed nothing, so it leaves auto-renew alone.
  if (firstTime === true) {
    await syncAutoRenew(db, { uid, planKey, pending, orderId: order_id }).catch((err) => console.error("Midtrans webhook: auto-renew setup failed", order_id, err?.message));
  }
  if (firstTime) {
    // Meta Purchase, once per order (retries have firstTime false). Same
    // event id as the browser pixel in js/views/pricing.js payPlan. Awaited
    // (Vercel may freeze the function after the response) but never throws.
    const email = (await accountRef.get().catch(() => null))?.data()?.email;
    await sendMetaEvent({
      name: "Purchase",
      eventId: order_id,
      context: pending.meta,
      email,
      externalId: uid,
      customData: { currency: "IDR", value: Number(gross_amount), content_ids: [planKey], content_name: plan.label || planKey, content_type: "product", order_id },
    });
  }
  return res.status(200).json({ ok: true, duplicate: !firstTime });
}

// After a paid order: a plan purchase stops the old plan's auto-renew (plans
// replace each other, never stack); a purchase made with "save card" becomes
// a Midtrans subscription charging the full price every period from when the
// paid time runs out.
async function syncAutoRenew(db, { uid, planKey, pending, orderId }) {
  const accountRef = db.doc(`accounts/${uid}`);
  const account = (await accountRef.get()).data() || {};
  const current = account.autoRenew || {};
  const rec = recurringFor(planKey);
  const updates = {};
  const stop = async (slot) => {
    if (!current[slot]) return;
    await disableSubscription(current[slot].subscriptionId).catch((err) => console.error("disable subscription failed", current[slot].subscriptionId, err?.message));
    updates[`autoRenew.${slot}`] = FieldValue.delete();
  };
  if (PLANS[planKey]) await stop("plan");
  if (planKey === "ai-unlimited") await stop("aiUnlimited");

  if (pending.recurring && RECURRING_ON && rec) {
    const status = await transactionStatus(orderId);
    const token = status?.saved_token_id;
    if (token) {
      const startAt = rec.slot === "plan" ? Number(account.subscriptionExpiresAt)
        : rec.slot === "aiUnlimited" ? Number(account.aiUnlimitedUntil)
        : Math.max(...(account.brandSlotsUntil || [0]).map(Number));
      const amount = (PLANS[planKey] || ADDONS[planKey]).amount;
      const name = subscriptionName(uid);
      const sub = await createSubscription({ name, amount, token, startAt, intervalMonths: rec.interval, email: account.email });
      await db.doc(`midtransSubs/${name}`).set({ uid, planKey, amount, subscriptionId: sub.id, slot: rec.slot, createdAt: Date.now() });
      updates[`autoRenew.${rec.slot}`] = { subscriptionId: sub.id, name, planKey, amount, card: status.masked_card || "", nextAt: startAt };
    }
  }
  if (Object.keys(updates).length) await accountRef.update(updates);
}

// One auto-renew charge: add one more period to whatever it renews.
// payments/<order_id> makes a retried notification a no-op.
async function applyRenewalCharge(db, { orderId, name, grossAmount, paid }) {
  if (!paid) return { ok: true, ignored: "not-paid" };
  const subSnap = await db.doc(`midtransSubs/${name}`).get();
  if (!subSnap.exists) {
    console.warn("Midtrans webhook: renewal for unknown subscription", name);
    return { ok: true, ignored: "unknown-subscription" };
  }
  const sub = subSnap.data();
  if (grossAmount !== Number(sub.amount)) {
    console.error("Midtrans webhook: renewal amount mismatch", { orderId, grossAmount, expected: sub.amount });
    return { ok: true, ignored: "amount-mismatch" };
  }
  const paymentRef = db.doc(`payments/${orderId}`);
  const accountRef = db.doc(`accounts/${sub.uid}`);
  const now = Date.now();
  const applied = await db.runTransaction(async (tx) => {
    const [pay, accSnap] = await Promise.all([tx.get(paymentRef), tx.get(accountRef)]);
    if (pay.exists) return false;
    const acc = accSnap.data() || {};
    const plan = PLANS[sub.planKey];
    const addon = ADDONS[sub.planKey];
    if (plan) {
      // Only renews the plan it was made for; a plan switch disables it,
      // so a charge for anything else is a stray and changes nothing.
      if (acc.plan === plan.plan && (acc.billing || "monthly") === plan.billing) {
        tx.set(accountRef, { status: "active", subscriptionExpiresAt: Math.max(now, Number(acc.subscriptionExpiresAt) || 0) + plan.durationMs }, { merge: true });
      }
    } else if (addon?.aiUnlimitedMs) {
      tx.set(accountRef, { aiUnlimitedUntil: Math.max(now, Number(acc.aiUnlimitedUntil) || 0) + addon.aiUnlimitedMs }, { merge: true });
    } else if (addon?.addBrandSlotMs) {
      tx.set(accountRef, { brandSlotsUntil: nextBrandSlots(acc.brandSlotsUntil, now, addon.addBrandSlotMs, { renew: true }) }, { merge: true });
    }
    tx.set(paymentRef, { uid: sub.uid, planKey: sub.planKey, plan: plan?.plan || sub.planKey, amount: grossAmount, status: "paid", paidAt: now, createdAt: now, recurring: true, subscriptionName: name });
    return true;
  });
  return { ok: true, renewal: true, duplicate: !applied };
}
