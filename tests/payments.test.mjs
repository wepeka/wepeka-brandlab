import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MIDTRANS_IS_PRODUCTION, paymentsOpenFor, isPaymentTester, isSettled, notificationAction, ownOrderIds, orderStatusFor, ORDER_STATUS_MAX } from "../api/_payments.js";
import orderStatusHandler from "../api/midtrans/order-status.js";
import { ADMIN_UIDS, isReadOnlyAccount, consumeFreeCall } from "../api/_aiQuota.js";

// The test run has no MIDTRANS_IS_PRODUCTION, i.e. the sandbox situation the
// live site is in until Midtrans approves the production account.
describe("payments while Midtrans is still sandbox", () => {
  test("the environment under test really is sandbox", () => {
    assert.equal(MIDTRANS_IS_PRODUCTION, false);
  });

  test("a customer can't pay online (checkout closed, WhatsApp instead)", () => {
    assert.equal(paymentsOpenFor("customer-uid", { email: "owner@kopi.id", plan: "trial" }), false);
  });

  test("an account without a doc yet can't either", () => {
    assert.equal(paymentsOpenFor("new-uid", null), false);
  });

  test("Wepeka's admin account keeps a working sandbox checkout", () => {
    assert.equal(paymentsOpenFor(ADMIN_UIDS[0], {}), true);
  });

  test("the Midtrans reviewer's demo account keeps it too (case-insensitive)", () => {
    assert.equal(isPaymentTester("r-uid", { email: "Brandlab.Reviewer.Midtrans@gmail.com" }), true);
    assert.equal(paymentsOpenFor("r-uid", { email: "brandlab.reviewer.midtrans@gmail.com" }), true);
  });
});

describe("isSettled", () => {
  test("settlement without a fraud check is paid", () => {
    assert.equal(isSettled("settlement", undefined), true);
  });

  test("a card capture Midtrans accepted is paid", () => {
    assert.equal(isSettled("capture", "accept"), true);
  });

  test("a card capture held for review (challenge) is NOT paid yet", () => {
    assert.equal(isSettled("capture", "challenge"), false);
  });

  test("denied, pending, expired and cancelled orders are not paid", () => {
    assert.equal(isSettled("capture", "deny"), false);
    assert.equal(isSettled("pending", undefined), false);
    assert.equal(isSettled("expire", undefined), false);
    assert.equal(isSettled("cancel", undefined), false);
  });
});

describe("isReadOnlyAccount", () => {
  const past = Date.now() - 60_000;
  const future = Date.now() + 86_400_000;

  test("a subscription past its end date is read-only even before the cron runs", () => {
    assert.equal(isReadOnlyAccount({ plan: "pro", status: "active", subscriptionExpiresAt: past }), true);
  });

  test("a running subscription is not", () => {
    assert.equal(isReadOnlyAccount({ plan: "pro", status: "active", subscriptionExpiresAt: future }), false);
  });

  test("Lifetime plans never lapse", () => {
    assert.equal(isReadOnlyAccount({ plan: "founder", subscriptionExpiresAt: null }), false);
  });

  test("an ended trial is read-only", () => {
    assert.equal(isReadOnlyAccount({ plan: "trial", trialEndsAt: past }), true);
  });
});

describe("consumeFreeCall", () => {
  function makeFakeDb(initial = null) {
    let stored = initial;
    return {
      doc: () => ({ path: "aiUsage/u" }),
      async runTransaction(fn) {
        return fn({
          async get() {
            return { exists: stored !== null, data: () => stored };
          },
          set(_ref, data) {
            stored = { ...(stored || {}), ...data };
          },
        });
      },
      read: () => stored,
    };
  }

  test("counts free calls per day and stops at the limit", async () => {
    const db = makeFakeDb();
    const now = new Date("2026-10-01T03:00:00Z");
    assert.equal(await consumeFreeCall(db, "u", now, 2), true);
    assert.equal(await consumeFreeCall(db, "u", now, 2), true);
    assert.equal(await consumeFreeCall(db, "u", now, 2), false);
    assert.equal(db.read().freeCount, 2);
  });

  test("a new day starts from zero again", async () => {
    const db = makeFakeDb({ freeDate: "2026-09-30", freeCount: 150 });
    assert.equal(await consumeFreeCall(db, "u", new Date("2026-10-01T03:00:00Z"), 150), true);
    assert.equal(db.read().freeCount, 1);
  });
});

describe("notificationAction (what a signed notification does to an order)", () => {
  const pending = { status: "pending" };
  const paid = { status: "paid", paidAt: 1 };
  test("first settlement grants; a repeat is a duplicate", () => {
    assert.equal(notificationAction(pending, "settlement"), "grant");
    assert.equal(notificationAction(pending, "capture", "accept"), "grant");
    assert.equal(notificationAction(paid, "settlement"), "duplicate");
  });
  test("a card held for review grants nothing yet", () => {
    assert.equal(notificationAction(pending, "capture", "challenge"), "ignore");
    assert.equal(notificationAction(pending, "pending"), "ignore");
  });
  test("an unpaid order that expires, is cancelled or denied is closed", () => {
    for (const s of ["expire", "cancel", "deny", "failure"]) assert.equal(notificationAction(pending, s), "close", s);
  });
  test("refunds and chargebacks on a paid order are flagged (S-19)", () => {
    for (const s of ["refund", "partial_refund", "chargeback", "partial_chargeback"]) assert.equal(notificationAction(paid, s), "flag", s);
  });
  test("a captured card denied or cancelled afterwards is flagged too", () => {
    assert.equal(notificationAction(paid, "deny"), "flag");
    assert.equal(notificationAction(paid, "cancel"), "flag");
  });
  test("a partial refund that becomes a full one is flagged again", () => {
    assert.equal(notificationAction({ status: "partial_refund", paidAt: 1 }, "refund"), "flag");
    assert.equal(notificationAction({ status: "refund", paidAt: 1 }, "settlement"), "ignore");
  });
  test("an out-of-order 'pending' after payment changes nothing", () => {
    assert.equal(notificationAction(paid, "pending"), "ignore");
  });
  test("money landing on an order already closed unpaid is flagged", () => {
    assert.equal(notificationAction({ status: "expire" }, "settlement"), "flag");
    assert.equal(notificationAction({ status: "expire" }, "expire"), "ignore");
  });
  test("a voided sandbox order stays void", () => {
    assert.equal(notificationAction({ status: "void-sandbox" }, "settlement"), "ignore");
  });
  test("sandbox: only testers' payments are granted", () => {
    assert.equal(paymentsOpenFor("someone", { email: "owner@kopi.id" }), false);
    assert.equal(paymentsOpenFor("r", { email: "wepeka.cobabrandlab@gmail.com" }), true);
  });
});

describe("order status for the buyer's own browser (analytics only)", () => {
  const uid = "uidPembeli01";
  const mine = (n) => `bl-${uid}-k${n}`;
  test("only order ids made for this account are looked up", () => {
    assert.deepEqual(ownOrderIds([mine(1), "bl-uidOrangLain-k1", mine(2)], uid), [mine(1), mine(2)]);
    assert.deepEqual(ownOrderIds([`bl-${uid}x-k1`, `${mine(1)}/../../accounts/x`, `bl-${uid}-`, `bl-${uid}-K1`, 5, null, { a: 1 }], uid), []);
    // An auto-renew charge (Midtrans's own order id) is never the browser's to ask about.
    assert.deepEqual(ownOrderIds(["bls-abc-k1x-00000000000000000000000000000001"], uid), []);
  });
  test("no duplicates, a capped list, and nothing without a uid or a list", () => {
    assert.deepEqual(ownOrderIds([mine(1), mine(1)], uid), [mine(1)]);
    assert.equal(ownOrderIds(Array.from({ length: 40 }, (_, i) => mine(i)), uid).length, ORDER_STATUS_MAX);
    assert.deepEqual(ownOrderIds([mine(1)], ""), []);
    assert.deepEqual(ownOrderIds("bl-x", uid), []);
    assert.deepEqual(ownOrderIds(undefined, uid), []);
  });
  test("paid and pending are said as they are", () => {
    assert.equal(orderStatusFor({ uid, status: "paid", paidAt: 1 }, uid), "paid");
    assert.equal(orderStatusFor({ uid, status: "paid", paidAt: 1, needsReview: "over-cap" }, uid), "paid");
    assert.equal(orderStatusFor({ uid, status: "pending" }, uid), "pending");
  });
  test("an order that will never be paid, a voided one and a reversed one are closed", () => {
    for (const s of ["expire", "cancel", "deny", "failure", "void-sandbox", "refund", "partial_refund", "chargeback"]) {
      assert.equal(orderStatusFor({ uid, status: s, paidAt: 1 }, uid), "closed", s);
    }
  });
  test("someone else's order, or none at all, is unknown", () => {
    assert.equal(orderStatusFor({ uid: "uidOrangLain", status: "paid" }, uid), "unknown");
    assert.equal(orderStatusFor({ status: "paid" }, uid), "unknown");
    assert.equal(orderStatusFor(null, uid), "unknown");
    assert.equal(orderStatusFor({ uid, status: "paid" }, undefined), "unknown");
  });

  // The endpoint itself, up to where it would need Firebase: who may ask.
  function call(req) {
    const res = { statusCode: 0, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    return orderStatusHandler({ headers: {}, body: {}, ...req }, res).then(() => res);
  }
  test("the endpoint takes POST only and nothing without a sign-in token", async () => {
    assert.equal((await call({ method: "GET" })).statusCode, 405);
    const anon = await call({ method: "POST", body: { orderIds: [mine(1)] } });
    assert.equal(anon.statusCode, 401);
    assert.equal(anon.body.orders, undefined);
    assert.equal((await call({ method: "POST", headers: { authorization: "Basic abc" }, body: { orderIds: [mine(1)] } })).statusCode, 401);
  });
});
