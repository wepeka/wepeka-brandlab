import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MIDTRANS_IS_PRODUCTION, paymentsOpenFor, isPaymentTester, isSettled } from "../api/_payments.js";
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
