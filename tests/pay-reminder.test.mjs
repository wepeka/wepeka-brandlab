// The reminder for a Founder / Agency checkout left unpaid
// (api/_payReminder.js): when it is due, what it says, that it is
// scheduled once per order and taken back when the order is paid or
// closed — against a tiny in-memory payments/{orderId} record — plus the
// Resend calls (api/_email.js) and the webhook's wiring.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PAY_REMINDER_DELAY_MS, PAY_REMINDER_MIN_LEAD_MS, PAY_REMINDER_MIN_DELAY_MS, midtransTime, payDeadline, reminderPlan, schedulePayReminder, cancelPayReminder } from "../api/_payReminder.js";
import { composePayReminderEmail, buyUrl } from "../api/_community.js";
import { sendEmail, cancelScheduledEmail } from "../api/_email.js";
import { SEAT_CHECKOUT_MINUTES, holdKeyFor } from "../api/_plans.js";

const MIN = 60 * 1000;
// 10.39 WIB, 23 Oct 2026 — the checkout opened; it closes an hour later.
const OPENED = Date.parse("2026-10-23T03:39:00Z");
const PAY_BY = OPENED + SEAT_CHECKOUT_MINUTES * MIN; // 11.39 WIB
const ORDER = "bl-uid123-mv66x0fr";
const pendingPayment = (extra = {}) => ({
  uid: "uid123", planKey: "founder", plan: "founder", amount: 499000, status: "pending", createdAt: OPENED + 500,
  hold: { slot: "founderSlotsSold", key: holdKeyFor("uid123"), until: OPENED + 75 * MIN }, payBy: PAY_BY, ...extra,
});
// What Midtrans sends once a bank transfer's virtual account is issued.
const pendingNote = (extra = {}) => ({ order_id: ORDER, transaction_status: "pending", payment_type: "bank_transfer", expiry_time: "2026-10-23 11:39:00", ...extra });

describe("when the reminder is due", () => {
  test("Midtrans's times are WIB", () => {
    assert.equal(midtransTime("2026-10-23 11:39:00"), PAY_BY);
    assert.equal(midtransTime(" 2026-10-23 11:39:00 "), PAY_BY);
    for (const junk of ["", null, undefined, "2026-10-23", "2026-10-23T16:39:00Z", "besok"]) assert.equal(midtransTime(junk), null, String(junk));
  });
  test("the deadline: the order's own, or Midtrans's when that is sooner — never later", () => {
    assert.equal(payDeadline(pendingPayment(), {}), PAY_BY);
    assert.equal(payDeadline(pendingPayment(), pendingNote({ expiry_time: "2026-10-23 11:00:00" })), Date.parse("2026-10-23T04:00:00Z"));
    assert.equal(payDeadline(pendingPayment(), pendingNote({ expiry_time: "2026-10-24 11:39:00" })), PAY_BY, "an unsigned field can't stretch the window");
    // An order from before `payBy` was recorded: created + the window.
    assert.equal(payDeadline({ createdAt: OPENED }, {}), PAY_BY);
    assert.equal(payDeadline({}, {}), null);
  });
  test("30 minutes after the buyer picked a way to pay, early in the hour", () => {
    const at = OPENED + 2 * MIN;
    assert.equal(PAY_REMINDER_DELAY_MS, 30 * MIN);
    assert.deepEqual(reminderPlan(pendingPayment(), pendingNote(), at), { sendAt: at + 30 * MIN, deadline: PAY_BY });
  });
  test("picked late in the hour: sooner, so it still lands 15 minutes before the end", () => {
    assert.equal(PAY_REMINDER_MIN_LEAD_MS, 15 * MIN);
    assert.equal(PAY_REMINDER_MIN_DELAY_MS, 10 * MIN);
    assert.deepEqual(reminderPlan(pendingPayment(), pendingNote(), OPENED + 20 * MIN), { sendAt: PAY_BY - 15 * MIN, deadline: PAY_BY });
    assert.deepEqual(reminderPlan(pendingPayment(), pendingNote(), OPENED + 35 * MIN), { sendAt: PAY_BY - 15 * MIN, deadline: PAY_BY }, "10 minutes to pay first, then the reminder");
  });
  test("only a held seat's open order, once, on a `pending` notification", () => {
    const at = OPENED + 2 * MIN;
    const { hold, payBy, ...plain } = pendingPayment();
    assert.equal(reminderPlan(plain, pendingNote(), at), null, "a plan without a capped seat: no reminder");
    assert.equal(reminderPlan(pendingPayment({ status: "paid" }), pendingNote(), at), null);
    assert.equal(reminderPlan(pendingPayment({ status: "expire" }), pendingNote(), at), null);
    assert.equal(reminderPlan(pendingPayment({ reminder: { sendAt: at } }), pendingNote(), at), null, "already reminded");
    for (const status of ["settlement", "capture", "expire", "cancel", "deny"]) assert.equal(reminderPlan(pendingPayment(), pendingNote({ transaction_status: status }), at), null, status);
  });
  test("not when too little of the hour is left to act on it", () => {
    const lastChance = PAY_BY - 25 * MIN;
    assert.ok(reminderPlan(pendingPayment(), pendingNote(), lastChance), "25 minutes left: sent 10 later, 15 before the end");
    assert.equal(reminderPlan(pendingPayment(), pendingNote(), lastChance + 1), null);
    assert.equal(reminderPlan(pendingPayment(), pendingNote({ expiry_time: "2026-10-23 10:55:00" }), OPENED + 2 * MIN), null, "Midtrans closes it sooner (a QR code)");
  });
});

describe("what it says", () => {
  // Lands 28 minutes before the hour is up.
  const mail = composePayReminderEmail({ name: "Rani Putri", label: "Brandlab Founder Lifetime", amount: 499000, deadline: PAY_BY + 59 * 1000, sendAt: PAY_BY - 28 * MIN, planKey: "founder" });
  test("short, \"kamu\": the seat, until when (WIB clock, minutes cut) and how long is left, and the way back", () => {
    assert.equal(mail.subject, "Kursi Founder Lifetime kamu masih kami tahan");
    for (const line of [
      "Hai Rani,",
      "Pembayaran Founder Lifetime (Rp 499.000) kamu belum selesai. Kursimu masih kami tahan sampai pukul 11.39 WIB, sekitar 25 menit lagi. Lewat dari itu, kursinya kami lepas untuk pembeli lain.",
      "Sudah dapat nomor virtual account atau kode bayar? Bayar ke situ saja, nggak perlu pesan ulang.",
      `Selesaikan pembayaran: ${buyUrl("founder")}`,
      "Sudah bayar? Abaikan email ini.",
    ]) assert.ok(mail.text.includes(line), line);
    assert.ok(mail.html.includes(`href="${buyUrl("founder").replace(/&/g, "&amp;")}"`));
    assert.ok(mail.html.includes("pukul 11.39 WIB, sekitar 25 menit lagi"));
  });
  test("a deadline further off (or no landing time) reads as a date", () => {
    const later = composePayReminderEmail({ label: "Brandlab Founder Lifetime", deadline: PAY_BY, sendAt: PAY_BY - 3 * 60 * MIN, planKey: "founder" });
    assert.ok(later.text.includes("sampai 23 Oktober 2026, 11.39 WIB."));
    assert.ok(composePayReminderEmail({ label: "Brandlab Founder Lifetime", deadline: PAY_BY, planKey: "founder" }).text.includes("sampai 23 Oktober 2026, 11.39 WIB."));
  });
  test("the button goes to the plan's own checkout on the plans page", () => {
    assert.equal(buyUrl("founder"), "https://www.wepeka.com/brandlab/connect?to=pricing&plan=founder");
    assert.ok(composePayReminderEmail({ label: "Brandlab Agency Lifetime", planKey: "founder-ultimate", deadline: PAY_BY }).text.includes(buyUrl("founder-ultimate")));
  });
  test("no payment provider's name anywhere", () => {
    for (const part of [mail.subject, mail.html, mail.text]) assert.doesNotMatch(part, /midtrans|snap/i);
  });
  test("no name: a plain greeting; the label without \"Brandlab\"", () => {
    const m = composePayReminderEmail({ label: "Brandlab Agency Lifetime", amount: 799000, deadline: PAY_BY, planKey: "founder-ultimate" });
    assert.ok(m.text.startsWith("Hai,\n"));
    assert.equal(m.subject, "Kursi Agency Lifetime kamu masih kami tahan");
  });
});

// payments/{orderId} as one in-memory doc: get, set (merge = Firestore's
// deep merge of maps) and a transaction over it.
const merge = (a, b) => {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
  return out;
};
function fakePayment(initial) {
  let data = structuredClone(initial);
  const write = (v, opts) => { data = opts?.merge ? merge(data, v) : structuredClone(v); };
  const ref = {
    get: async () => ({ exists: data != null, data: () => structuredClone(data) }),
    set: async (v, opts) => write(v, opts),
  };
  const db = { runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (_r, v, opts) => write(v, opts) }) };
  return { ref, db, read: () => data, patch: (v) => write(v, { merge: true }) };
}

describe("scheduling it once per order", () => {
  const at = OPENED + 2 * MIN;
  const setup = (payment = pendingPayment()) => {
    const store = fakePayment(payment);
    const sent = [];
    const cancelled = [];
    const deps = {
      db: store.db, paymentRef: store.ref, orderId: ORDER, payment, notification: pendingNote(), now: at,
      recipient: async () => ({ email: "rani@example.com", name: "Rani Putri" }),
      send: async (msg) => { sent.push(msg); return { ok: true, id: `email-${sent.length}` }; },
      cancel: async (id) => { cancelled.push(id); return { ok: true }; },
    };
    return { store, sent, cancelled, deps };
  };

  test("a `pending` notification schedules the email for 30 minutes later and records it", async () => {
    const { store, sent, deps } = setup();
    const r = await schedulePayReminder(deps);
    assert.deepEqual(r, { scheduled: "email-1", sendAt: at + 30 * MIN });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "rani@example.com");
    assert.equal(sent[0].scheduledAt, at + 30 * MIN);
    assert.equal(sent[0].idempotencyKey, `brandlab-pay-reminder-${ORDER}`);
    assert.equal(sent[0].subject, "Kursi Founder Lifetime kamu masih kami tahan");
    assert.ok(sent[0].text.includes("sampai pukul 11.39 WIB, sekitar 25 menit lagi."));
    assert.deepEqual(store.read().reminder, { sendAt: at + 30 * MIN, deadline: PAY_BY, at, id: "email-1" });
    assert.equal(store.read().status, "pending");
  });
  test("a second `pending` for the same order (a retry, another method picked) sends nothing more", async () => {
    const { sent, deps } = setup();
    await schedulePayReminder(deps);
    // The webhook read the record before the first one wrote to it.
    assert.deepEqual(await schedulePayReminder({ ...deps, now: at + MIN }), { skipped: "taken" });
    assert.equal(sent.length, 1);
  });
  test("nothing due: no write, no email", async () => {
    const { store, sent, deps } = setup();
    assert.deepEqual(await schedulePayReminder({ ...deps, notification: pendingNote({ transaction_status: "settlement" }) }), { skipped: "not-due" });
    assert.equal(sent.length, 0);
    assert.equal(store.read().reminder, undefined);
  });
  test("paid before the claim: nothing sent", async () => {
    const { store, sent, deps } = setup();
    store.patch({ status: "paid" });
    assert.deepEqual(await schedulePayReminder(deps), { skipped: "taken" });
    assert.equal(sent.length, 0);
  });
  test("paid while the email was being scheduled: taken back right away", async () => {
    const { store, sent, cancelled, deps } = setup();
    const send = async (msg) => { sent.push(msg); store.patch({ status: "paid" }); return { ok: true, id: "email-1" }; };
    await schedulePayReminder({ ...deps, send });
    assert.deepEqual(cancelled, ["email-1"]);
    assert.equal(store.read().reminder.cancelledAt, at);
  });
  test("no address, or Resend says no: recorded, not retried", async () => {
    const a = setup();
    assert.deepEqual(await schedulePayReminder({ ...a.deps, recipient: async () => ({ email: "" }) }), { skipped: "no-email" });
    assert.equal(a.sent.length, 0);
    assert.equal(a.store.read().reminder.error, "no-email");
    const b = setup();
    assert.deepEqual(await schedulePayReminder({ ...b.deps, send: async () => ({ ok: false, status: 422, error: "invalid" }) }), { error: "invalid" });
    assert.equal(b.store.read().reminder.error, "invalid");
    assert.deepEqual(await schedulePayReminder({ ...b.deps, now: at + MIN }), { skipped: "taken" });
  });
});

describe("taking it back", () => {
  const at = OPENED + 2 * MIN;
  const withReminder = (reminder) => fakePayment(pendingPayment({ status: "paid", reminder }));
  test("paid or closed before it went out: cancelled, once", async () => {
    const store = withReminder({ id: "email-1", sendAt: at + 30 * MIN });
    const cancelled = [];
    const cancel = async (id) => { cancelled.push(id); return { ok: true }; };
    assert.equal(await cancelPayReminder({ paymentRef: store.ref, payment: store.read(), cancel, now: at + 5 * MIN }), true);
    assert.equal(store.read().reminder.cancelledAt, at + 5 * MIN);
    assert.equal(await cancelPayReminder({ paymentRef: store.ref, payment: store.read(), cancel, now: at + 6 * MIN }), false);
    assert.deepEqual(cancelled, ["email-1"]);
  });
  test("already sent, or none scheduled: nothing to cancel", async () => {
    const cancel = async () => { throw new Error("must not be called"); };
    const sent = withReminder({ id: "email-1", sendAt: at + 30 * MIN });
    assert.equal(await cancelPayReminder({ paymentRef: sent.ref, payment: sent.read(), cancel, now: at + 31 * MIN }), false);
    const none = fakePayment(pendingPayment({ status: "expire" }));
    assert.equal(await cancelPayReminder({ paymentRef: none.ref, payment: none.read(), cancel, now: at }), false);
    const failed = withReminder({ error: "no-email" });
    assert.equal(await cancelPayReminder({ paymentRef: failed.ref, payment: failed.read(), cancel, now: at }), false);
  });
  test("Resend refuses the cancel: not marked cancelled", async () => {
    const store = withReminder({ id: "email-1", sendAt: at + 30 * MIN });
    const error = console.error;
    console.error = () => {};
    try {
      assert.equal(await cancelPayReminder({ paymentRef: store.ref, payment: store.read(), cancel: async () => ({ ok: false, status: 404 }), now: at }), false);
    } finally {
      console.error = error;
    }
    assert.equal(store.read().reminder.cancelledAt, undefined);
  });
});

describe("Resend: a scheduled send and its cancel", () => {
  const env = { RESEND_API_KEY: "test-key", RESEND_FROM: "Brandlab <a@b.co>" };
  test("scheduledAt goes out as scheduled_at (ISO)", async () => {
    let call;
    const r = await sendEmail({ to: "o@k.id", subject: "S", text: "t", scheduledAt: PAY_BY }, {
      env, fetchImpl: async (url, init) => { call = { url, init }; return { ok: true, status: 200, json: async () => ({ id: "e1" }) }; },
    });
    assert.deepEqual(r, { ok: true, id: "e1" });
    assert.equal(JSON.parse(call.init.body).scheduled_at, "2026-10-23T04:39:00.000Z");
  });
  test("cancel: POST /emails/<id>/cancel; off, bad ids and failures never throw", async () => {
    let call;
    const ok = await cancelScheduledEmail("49a3999c-0ce1-4ea6", { env, fetchImpl: async (url, init) => { call = { url, init }; return { ok: true, status: 200, json: async () => ({ id: "49a3999c-0ce1-4ea6" }) }; } });
    assert.deepEqual(ok, { ok: true });
    assert.equal(call.url, "https://api.resend.com/emails/49a3999c-0ce1-4ea6/cancel");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, "Bearer test-key");
    assert.deepEqual(await cancelScheduledEmail("e1", { env: {} }), { ok: false, skipped: true });
    assert.equal((await cancelScheduledEmail("../emails", { env })).error, "bad-id");
    assert.deepEqual(await cancelScheduledEmail("e1", { env, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: "already sent" }) }) }), { ok: false, status: 422, error: "already sent" });
    assert.equal((await cancelScheduledEmail("e1", { env, fetchImpl: async () => { throw new Error("offline"); } })).ok, false);
  });
});

describe("wired into the webhook", () => {
  const webhook = readFileSync(new URL("../api/midtrans/webhook.js", import.meta.url), "utf8");
  test("a `pending` notification for a held seat's open order schedules it (email on), before the not-a-payment exit", () => {
    const outer = webhook.indexOf('if (action === "ignore" && pending.hold && pending.status === "pending") {');
    const branch = webhook.indexOf('if (transaction_status === "pending" && emailConfigured()) {', outer);
    assert.ok(outer > 0 && branch > outer);
    assert.ok(branch < webhook.indexOf('if (action !== "grant") return'));
    assert.match(webhook.slice(branch, branch + 600), /schedulePayReminder\(\{\n\s+db, paymentRef, orderId: order_id, payment: pending, notification: body,\n\s+recipient: \(\) => buyerContact\(pending\), send: sendEmail, cancel: cancelScheduledEmail,/);
  });
  test("paid, closed or voided: a waiting reminder is taken back", () => {
    assert.equal((webhook.match(/await dropPayReminder\(paymentRef, pending, order_id\);/g) || []).length, 3);
    assert.match(webhook, /await releaseHold\(db, pending\.hold\);\n\s+await dropPayReminder\(paymentRef, pending, order_id\);\n\s+return res\.status\(200\)\.json\(\{ ok: true, ignored: transaction_status \}\);/);
    assert.match(webhook, /if \(firstTime\) \{\n\s+\/\/ Paid: [^\n]+\n\s+await dropPayReminder\(paymentRef, pending, order_id\);/);
  });
});
