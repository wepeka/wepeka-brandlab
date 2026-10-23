// One reminder for a Founder / Agency checkout whose buyer picked a way to
// pay (a virtual account, a QR code — Midtrans says `pending`) but hasn't
// paid yet: an email about half an hour later (sooner when the hour is
// nearly up) saying until when the seat is still held, with the way back to
// the plan's checkout. No cron: Resend holds the email and sends it at
// `sendAt` (api/_email.js scheduledAt); a payment or a closed order before
// then cancels it. The leading underscore
// keeps Vercel from exposing this file as a route.
//
// When to send is pure (reminderPlan); schedulePayReminder and
// cancelPayReminder take their Firestore refs and senders as arguments, so
// tests/pay-reminder.test.mjs runs the webhook's wiring against fakes.
import { PLANS, SEAT_CHECKOUT_MINUTES } from "./_plans.js";
import { composePayReminderEmail } from "./_community.js";

export const PAY_REMINDER_DELAY_MS = 30 * 60 * 1000;
// It lands at least this long before the order closes — sooner than the
// usual 30 minutes when the buyer picked a way to pay late in the hour…
export const PAY_REMINDER_MIN_LEAD_MS = 15 * 60 * 1000;
// …but never sooner than this after they picked it (time to pay first);
// with less time than that left, no reminder.
export const PAY_REMINDER_MIN_DELAY_MS = 10 * 60 * 1000;

// Midtrans's own times ("2026-10-23 17:39:12") are WIB. → ms, or null.
export function midtransTime(value) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}+07:00`);
  return Number.isFinite(ms) ? ms : null;
}

// When the order stops being payable: the deadline create-transaction
// recorded (`payBy`; an order from before it did: created + the window), or
// Midtrans's own `expiry_time` when that comes sooner. The notification's
// fields travel unsigned, so they can only ever make it earlier.
export function payDeadline(payment, notification = {}) {
  const own = Number(payment?.payBy) || (Number(payment?.createdAt) ? Number(payment.createdAt) + SEAT_CHECKOUT_MINUTES * 60 * 1000 : null);
  const theirs = midtransTime(notification?.expiry_time);
  if (own && theirs) return Math.min(own, theirs);
  return own || null;
}

// What a notification means for the reminder: null (nothing to do), or when
// to send it and the deadline it quotes. Only a held seat's order, still
// open, never reminded before, and with time left to act on the email.
export function reminderPlan(payment, notification, now = Date.now()) {
  if (!payment?.hold?.slot || payment.status !== "pending" || payment.reminder) return null;
  if (notification?.transaction_status !== "pending") return null;
  const deadline = payDeadline(payment, notification);
  if (!deadline) return null;
  const sendAt = Math.min(now + PAY_REMINDER_DELAY_MS, deadline - PAY_REMINDER_MIN_LEAD_MS);
  if (sendAt < now + PAY_REMINDER_MIN_DELAY_MS) return null;
  return { sendAt, deadline };
}

// Schedules the order's reminder. `recipient()` → { email, name } of the
// buyer; `send` = api/_email.js sendEmail, `cancel` = cancelScheduledEmail.
// Never throws on the email's account; Firestore errors are the caller's.
// → { scheduled, sendAt } | { skipped } | { error }.
export async function schedulePayReminder({ db, paymentRef, orderId, payment, notification, now = Date.now(), recipient, send, cancel }) {
  const plan = reminderPlan(payment, notification, now);
  if (!plan) return { skipped: "not-due" };
  // One per order, even when Midtrans sends `pending` twice at once: the
  // first to mark the order wins.
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(paymentRef);
    const data = fresh.exists ? fresh.data() : null;
    if (data?.status !== "pending" || data.reminder) return false;
    tx.set(paymentRef, { reminder: { sendAt: plan.sendAt, deadline: plan.deadline, at: now } }, { merge: true });
    return true;
  });
  if (!claimed) return { skipped: "taken" };
  const to = await recipient().catch(() => null);
  if (!to?.email) {
    await paymentRef.set({ reminder: { error: "no-email" } }, { merge: true });
    return { skipped: "no-email" };
  }
  const mail = composePayReminderEmail({ name: to.name, label: PLANS[payment.planKey]?.label || "", amount: payment.amount, deadline: plan.deadline, sendAt: plan.sendAt, planKey: payment.planKey });
  const r = await send({ to: to.email, ...mail, scheduledAt: plan.sendAt, idempotencyKey: `brandlab-pay-reminder-${orderId}` });
  if (!r?.ok || !r.id) {
    await paymentRef.set({ reminder: { error: String(r?.error || r?.status || "not-sent").slice(0, 200) } }, { merge: true });
    return { error: r?.error || r?.status || "not-sent" };
  }
  await paymentRef.set({ reminder: { id: r.id } }, { merge: true });
  // Paid or closed while this was being scheduled: the webhook's own cancel
  // may have looked before the id was written, so look once more.
  const after = (await paymentRef.get()).data();
  if (after?.status !== "pending") await cancelPayReminder({ paymentRef, payment: after, cancel, now });
  return { scheduled: r.id, sendAt: plan.sendAt };
}

// Takes back a reminder that hasn't gone out yet — the order was paid or
// closed. `payment`: the record as it is now (read after the change, so an
// id written a moment ago is seen). → true when one was cancelled.
export async function cancelPayReminder({ paymentRef, payment, cancel, now = Date.now() }) {
  const reminder = payment?.reminder;
  if (!reminder?.id || reminder.cancelledAt || !(Number(reminder.sendAt) > now)) return false;
  const r = await cancel(reminder.id);
  if (!r?.ok) {
    if (!r?.skipped) console.error("pay reminder: cancel failed", reminder.id, r?.error || r?.status);
    return false;
  }
  await paymentRef.set({ reminder: { cancelledAt: now } }, { merge: true });
  return true;
}
