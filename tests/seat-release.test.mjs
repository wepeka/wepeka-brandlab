// A Founder / Agency checkout closed without picking a way to pay frees its
// seat right away (api/_seatRelease.js): who may ask, that a seat whose
// order can still be paid is never freed — also when the close races a
// Midtrans notification — against a tiny in-memory Firestore, plus the two
// Midtrans calls (api/_midtrans.js) and the wiring in the browser, the
// endpoint, create-transaction and the webhook.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { releaseRefusal, markTransaction, releaseUnpaidSeat } from "../api/_seatRelease.js";
import { cancelSnapToken, orderTransaction } from "../api/_midtrans.js";
import { notificationAction } from "../api/_payments.js";
import { holdKeyFor, HOLD_MS, SLOTS_DOC } from "../api/_plans.js";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-10-23T03:45:00Z");
const OPENED = NOW - 6 * MIN;
const F = "founderSlotsSold";
const UID = "uid123";
const KEY = holdKeyFor(UID);
const ORDER = "bl-uid123-mv66x0fr";
const PAY = `payments/${ORDER}`;
const TOKEN = "66e4fa55-fdac-4ef9-91b5-733b97d1b862";
const openOrder = (extra = {}) => ({
  uid: UID, planKey: "founder", amount: 499000, status: "pending", createdAt: OPENED,
  hold: { slot: F, key: KEY, until: OPENED + HOLD_MS }, payBy: OPENED + 60 * MIN, snapToken: TOKEN, ...extra,
});

// Firestore, as many docs as a test needs: get, set (merge = deep merge of
// maps), update with dotted paths, and a transaction over them.
const merge = (a, b) => {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
  return out;
};
function fakeStore(docs) {
  const data = structuredClone(docs);
  const snap = (path) => ({ exists: data[path] !== undefined, data: () => structuredClone(data[path]) });
  const write = (path, v, opts) => { data[path] = opts?.merge ? merge(data[path], v) : structuredClone(v); };
  const update = (path, v) => {
    const doc = structuredClone(data[path]);
    for (const [dotted, value] of Object.entries(v)) {
      const parts = dotted.split(".");
      let o = doc;
      for (const p of parts.slice(0, -1)) o = o[p] ??= {};
      o[parts.at(-1)] = value;
    }
    data[path] = doc;
  };
  const ref = (path) => ({ path, get: async () => snap(path), set: async (v, opts) => write(path, v, opts) });
  const db = { runTransaction: async (fn) => fn({ get: async (r) => snap(r.path), set: (r, v, opts) => write(r.path, v, opts), update: (r, v) => update(r.path, v) }) };
  return { db, ref, read: (path) => data[path] };
}

// The usual scene: 13 sold, this order's hold plus someone else's.
function scene(order = openOrder(), holds = { [KEY]: OPENED + HOLD_MS, other: NOW + 30 * MIN }) {
  const store = fakeStore({ [PAY]: order, [SLOTS_DOC]: { [F]: 13, holds: { [F]: holds } } });
  const calls = { cancel: [], lookup: [] };
  const deps = {
    db: store.db, paymentRef: store.ref(PAY), slotsRef: store.ref(SLOTS_DOC), orderId: ORDER, uid: UID, now: NOW,
    cancelToken: async (token) => { calls.cancel.push(token); return { ok: true }; },
    lookupOrder: async (id) => { calls.lookup.push(id); return "none"; },
  };
  return { store, calls, deps };
}

describe("who may release which seat", () => {
  test("the order's own account, its own hold, an open order with no transaction", () => {
    assert.equal(releaseRefusal(openOrder(), UID), null);
    assert.equal(releaseRefusal(null, UID), "unknown-order");
    assert.equal(releaseRefusal(openOrder(), "someone-else"), "not-yours");
    assert.equal(releaseRefusal(openOrder(), ""), "not-yours");
    assert.equal(releaseRefusal(openOrder({ hold: { slot: F, key: holdKeyFor("someone-else"), until: 1 } }), UID), "not-yours");
    assert.equal(releaseRefusal(openOrder({ hold: undefined }), UID), "no-hold", "a plan without a capped seat");
    for (const status of ["paid", "expire", "cancel", "abandoned"]) assert.equal(releaseRefusal(openOrder({ status }), UID), "closed", status);
    assert.equal(releaseRefusal(openOrder({ transactionAt: NOW - MIN }), UID), "payable", "Midtrans already reported a VA / QR / card");
    assert.equal(releaseRefusal(openOrder({ snapToken: undefined }), UID), "no-token", "an order from before tokens were kept");
  });
});

describe("the webhook's mark", () => {
  test("an open order is marked once; a closed one never", async () => {
    const { store } = scene();
    assert.equal(await markTransaction(store.db, store.ref(PAY), NOW), true);
    assert.equal(store.read(PAY).transactionAt, NOW);
    assert.equal(await markTransaction(store.db, store.ref(PAY), NOW + MIN), false);
    assert.equal(store.read(PAY).transactionAt, NOW);
    const closed = scene(openOrder({ status: "abandoned" })).store;
    assert.equal(await markTransaction(closed.db, closed.ref(PAY), NOW), false);
    assert.equal(closed.read(PAY).transactionAt, undefined);
  });
});

describe("releasing an unpaid checkout's seat", () => {
  test("closed without a way to pay: token cancelled, Midtrans has nothing, the seat is back on sale", async () => {
    const { store, calls, deps } = scene();
    assert.deepEqual(await releaseUnpaidSeat(deps), { released: true });
    assert.deepEqual(calls, { cancel: [TOKEN], lookup: [ORDER] });
    assert.equal(store.read(PAY).status, "abandoned");
    assert.equal(store.read(PAY).closedAt, NOW);
    assert.deepEqual(store.read(SLOTS_DOC).holds[F], { other: NOW + 30 * MIN }, "only this order's hold; someone else's stays");
    assert.equal(store.read(SLOTS_DOC)[F], 13, "nothing sold");
  });
  test("an older order of the account that can still be paid gets its hold back", async () => {
    const older = NOW + 20 * MIN;
    const { store, deps } = scene(openOrder({ holdPrevious: older }));
    await releaseUnpaidSeat(deps);
    assert.equal(store.read(SLOTS_DOC).holds[F][KEY], older);
  });
  test("a newer checkout of the account keeps its own hold", async () => {
    const newer = NOW + 70 * MIN;
    const { store, deps } = scene(openOrder(), { [KEY]: newer });
    assert.deepEqual(await releaseUnpaidSeat(deps), { released: true });
    assert.equal(store.read(SLOTS_DOC).holds[F][KEY], newer);
  });
  test("someone else's order: refused before Midtrans is even asked", async () => {
    const { store, calls, deps } = scene();
    assert.deepEqual(await releaseUnpaidSeat({ ...deps, uid: "someone-else" }), { released: false, reason: "not-yours" });
    assert.deepEqual(calls, { cancel: [], lookup: [] });
    assert.equal(store.read(PAY).status, "pending");
    assert.ok(store.read(SLOTS_DOC).holds[F][KEY]);
  });
  test("Midtrans already reported a transaction: kept, nothing asked", async () => {
    const { store, calls, deps } = scene(openOrder({ transactionAt: NOW - MIN }));
    assert.deepEqual(await releaseUnpaidSeat(deps), { released: false, reason: "payable" });
    assert.deepEqual(calls.cancel, []);
    assert.ok(store.read(SLOTS_DOC).holds[F][KEY]);
  });
  test("Midtrans won't cancel the checkout (a way to pay was picked): kept", async () => {
    const { store, calls, deps } = scene();
    const r = await releaseUnpaidSeat({ ...deps, cancelToken: async () => ({ ok: false, error: "Transaction is on progress" }) });
    assert.deepEqual(r, { released: false, reason: "midtrans-refused" });
    assert.deepEqual(calls.lookup, []);
    assert.equal(store.read(PAY).status, "pending");
    assert.ok(store.read(SLOTS_DOC).holds[F][KEY]);
  });
  test("Midtrans has a transaction, or can't say: kept", async () => {
    for (const [known, reason] of [["pending", "payable"], ["settlement", "payable"], ["capture", "payable"], [null, "status-unknown"]]) {
      const { store, deps } = scene();
      assert.deepEqual(await releaseUnpaidSeat({ ...deps, lookupOrder: async () => known }), { released: false, reason }, String(known));
      assert.equal(store.read(PAY).status, "pending");
      assert.ok(store.read(SLOTS_DOC).holds[F][KEY]);
    }
  });
  test("race: a `pending` notification is handled while the release checks Midtrans — the mark wins, seat kept", async () => {
    const { store, deps } = scene();
    const lookupOrder = async () => { await markTransaction(store.db, store.ref(PAY), NOW); return "none"; };
    assert.deepEqual(await releaseUnpaidSeat({ ...deps, lookupOrder }), { released: false, reason: "payable" });
    assert.equal(store.read(PAY).status, "pending");
    assert.ok(store.read(SLOTS_DOC).holds[F][KEY]);
  });
  test("race: the order is paid while the release checks Midtrans — seat kept", async () => {
    const { store, deps } = scene();
    const lookupOrder = async () => { await store.ref(PAY).set({ status: "paid", paidAt: NOW }, { merge: true }); return "none"; };
    assert.deepEqual(await releaseUnpaidSeat({ ...deps, lookupOrder }), { released: false, reason: "closed" });
    assert.equal(store.read(PAY).status, "paid");
  });
  test("race the other way: released first, then a mark comes — the order stays closed; money on it is still granted", async () => {
    const { store, deps } = scene();
    await releaseUnpaidSeat(deps);
    assert.equal(await markTransaction(store.db, store.ref(PAY), NOW + 1), false);
    const closed = store.read(PAY);
    assert.equal(notificationAction(closed, "settlement"), "grant");
    assert.equal(notificationAction(closed, "capture", "accept"), "grant");
    assert.equal(notificationAction(closed, "pending"), "ignore");
    assert.equal(notificationAction(closed, "expire"), "ignore");
    assert.equal(notificationAction(closed, "capture", "challenge"), "ignore");
  });
  test("asked twice: the second finds the order closed", async () => {
    const { calls, deps } = scene();
    await releaseUnpaidSeat(deps);
    assert.deepEqual(await releaseUnpaidSeat(deps), { released: false, reason: "closed" });
    assert.equal(calls.cancel.length, 1);
  });
});

describe("Midtrans: cancel a checkout, look up an order", () => {
  const reply = (status, body) => async (url, init) => { reply.last = { url, init }; return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  test("cancel: POST <snap>/snap/v1/transactions/<token>/cancel with the server key", async () => {
    assert.deepEqual(await cancelSnapToken(TOKEN, { serverKey: "SB-key", fetchImpl: reply(200, { canceled_at: "2026-10-23T03:45:00.000Z" }) }), { ok: true });
    assert.equal(reply.last.url, `https://app.sandbox.midtrans.com/snap/v1/transactions/${TOKEN}/cancel`);
    assert.equal(reply.last.init.method, "POST");
    assert.equal(reply.last.init.headers.Authorization, `Basic ${Buffer.from("SB-key:").toString("base64")}`);
  });
  test("cancel: already cancelled counts; a payment in progress, a missing token or a failure don't; never throws", async () => {
    assert.deepEqual(await cancelSnapToken(TOKEN, { serverKey: "k", fetchImpl: reply(400, { error_messages: ["token already canceled"] }) }), { ok: true, already: true });
    assert.deepEqual(await cancelSnapToken(TOKEN, { serverKey: "k", fetchImpl: reply(400, { error_messages: ["Transaction is on progress"] }) }), { ok: false, error: "Transaction is on progress" });
    assert.equal((await cancelSnapToken(TOKEN, { serverKey: "k", fetchImpl: reply(404, { error_messages: ["token not found"] }) })).ok, false);
    assert.equal((await cancelSnapToken(TOKEN, { serverKey: "k", fetchImpl: reply(200, {}) })).ok, false, "no canceled_at, no cancel");
    assert.equal((await cancelSnapToken(TOKEN, { serverKey: "k", fetchImpl: async () => { throw new Error("offline"); } })).ok, false);
    assert.deepEqual(await cancelSnapToken("", { serverKey: "k" }), { ok: false, error: "no-token" });
    assert.deepEqual(await cancelSnapToken("../x/y", { serverKey: "k" }), { ok: false, error: "no-token" });
    assert.deepEqual(await cancelSnapToken(TOKEN, { serverKey: "" }), { ok: false, error: "no-token" });
  });
  test("lookup: no transaction = \"none\" (HTTP 404 or status_code 404); else its status; unknown = null", async () => {
    assert.equal(await orderTransaction(ORDER, { serverKey: "k", fetchImpl: reply(404, { status_code: "404", status_message: "Transaction doesn't exist." }) }), "none");
    assert.equal(reply.last.url, `https://api.sandbox.midtrans.com/v2/${ORDER}/status`);
    assert.equal(await orderTransaction(ORDER, { serverKey: "k", fetchImpl: reply(200, { status_code: "404", status_message: "Transaction doesn't exist." }) }), "none");
    assert.equal(await orderTransaction(ORDER, { serverKey: "k", fetchImpl: reply(200, { status_code: "201", transaction_status: "pending" }) }), "pending");
    assert.equal(await orderTransaction(ORDER, { serverKey: "k", fetchImpl: reply(500, {}) }), null);
    assert.equal(await orderTransaction(ORDER, { serverKey: "k", fetchImpl: async () => { throw new Error("offline"); } }), null);
    assert.equal(await orderTransaction(ORDER, { serverKey: "" }), null);
  });
});

describe("wiring", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  test("the browser asks when a Founder / Agency checkout closes unanswered — and only then", () => {
    const src = read("js/views/pricing.js");
    assert.match(src, /onClose: \(\) => \{\n\s+if \(answered\) return;\n\s+if \(SEAT_PLAN_KEYS\.includes\(planKey\)\) releaseSeat\(orderId\);\n\s+showBankHelp\(label\);/);
    assert.match(src, /const SEAT_PLAN_KEYS = \["founder", "founder-ultimate"\];/);
    assert.match(src, /fetch\("\/api\/midtrans\/release-seat", \{\n\s+method: "POST",\n\s+keepalive: true,/);
    assert.match(src, /onPending: \(\) => \{ answered = true;/);
    assert.match(src, /onSuccess: \(\) => \{\n\s+answered = true;/);
  });
  test("the endpoint: signed in, the caller's own order ids only, the real Midtrans calls", () => {
    const src = read("api/midtrans/release-seat.js");
    assert.match(src, /\(\{ uid \} = await requireAuth\(req\)\);/);
    assert.match(src, /const \[orderId\] = ownOrderIds\(\[req\.body\?\.orderId\], uid\);/);
    assert.match(src, /cancelToken: cancelSnapToken, lookupOrder: orderTransaction,/);
  });
  test("create-transaction keeps the token and the replaced hold on the order", () => {
    assert.match(read("api/midtrans/create-transaction.js"), /\.\.\.\(hold \? \{ hold, payBy, snapToken: data\.token, \.\.\.\(previousHold \? \{ holdPrevious: previousHold \} : \{\}\) \} : \{\}\)/);
  });
  test("the webhook marks every held open order Midtrans reports on, before the reminder; a closed-by-the-buyer order can still be granted", () => {
    const src = read("api/midtrans/webhook.js");
    const branch = src.indexOf('if (action === "ignore" && pending.hold && pending.status === "pending") {');
    assert.ok(branch > 0 && branch < src.indexOf('if (action !== "grant") return'));
    const body = src.slice(branch, branch + 1500);
    assert.ok(body.indexOf("await markTransaction(db, paymentRef);") < body.indexOf("schedulePayReminder("));
    assert.match(src, /!\["pending", "abandoned"\]\.includes\(freshPaymentSnap\.data\(\)\.status\)/);
  });
});
