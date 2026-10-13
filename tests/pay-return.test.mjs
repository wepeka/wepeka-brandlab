// Back from a payment made outside the tab (js/pay-return.js): what Midtrans
// appends to the app's address, read once and taken out of the address bar.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parsePayReturn } from "../js/pay-return.js";

describe("the address a buyer comes back on", () => {
  test("from the Gojek app: result says it", () => {
    assert.deepEqual(parsePayReturn("?order_id=bl-u1-abc&result=success"), { result: "success", search: "" });
    assert.deepEqual(parsePayReturn("?order_id=bl-u1-abc&result=failure"), { result: "failure", search: "" });
  });
  test("from Midtrans's finish redirect: the transaction status says it", () => {
    assert.equal(parsePayReturn("?order_id=bl-u1-abc&status_code=200&transaction_status=settlement").result, "success");
    assert.equal(parsePayReturn("?order_id=bl-u1-abc&status_code=200&transaction_status=capture").result, "success");
    for (const status of ["deny", "cancel", "expire", "failure"]) {
      assert.equal(parsePayReturn(`?order_id=bl-u1-abc&status_code=202&transaction_status=${status}`).result, "failure", status);
    }
    // Still waiting (a transfer not made yet): came back, nothing to announce.
    assert.equal(parsePayReturn("?order_id=bl-u1-abc&status_code=201&transaction_status=pending").result, "unknown");
  });
  test("Midtrans's parameters leave the address; anything else stays", () => {
    assert.deepEqual(parsePayReturn("?utm_source=ig&order_id=bl-u1-abc&result=success&plan=founder"), { result: "success", search: "?utm_source=ig&plan=founder" });
    assert.equal(parsePayReturn("?order_id=bl-u1-abc&status_code=200&transaction_status=settlement").search, "");
  });
  test("an ordinary visit is left alone", () => {
    assert.deepEqual(parsePayReturn(""), { result: null, search: "" });
    assert.deepEqual(parsePayReturn("?utm_source=ig"), { result: null, search: "?utm_source=ig" });
    // "result" without an order is not a return from a payment.
    assert.deepEqual(parsePayReturn("?result=success"), { result: null, search: "?result=success" });
    assert.deepEqual(parsePayReturn(undefined), { result: null, search: "" });
  });
});
