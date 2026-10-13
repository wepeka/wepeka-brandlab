// The invoice's own facts (api/_invoice.js): its number, the payment time in
// Indonesian words and how the order was paid. The email around them is
// checked in tests/community.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { invoiceNumber, paidAtLabel, paymentMethodLabel } from "../api/_invoice.js";

describe("invoice number", () => {
  const paidAt = Date.parse("2026-10-13T04:37:00Z"); // 11.37 WIB
  test("the day it was paid plus the tail of the order id", () => {
    assert.equal(invoiceNumber("bl-iSwfTtIQm6VkYoHFbI6wl7BzBF53-mv66x0fr", paidAt), "INV-20261013-MV66X0FR");
  });
  test("the same order always gets the same number", () => {
    assert.equal(invoiceNumber("bl-abc-mv66x0fr", paidAt), invoiceNumber("bl-abc-mv66x0fr", paidAt));
    assert.notEqual(invoiceNumber("bl-abc-mv66x0fr", paidAt), invoiceNumber("bl-abc-mv66x0fs", paidAt));
  });
  test("the day is Jakarta's, not UTC's", () => {
    // 14 Oct 00.30 WIB is still 13 Oct (17.30) in UTC.
    assert.equal(invoiceNumber("bl-a-x1", Date.parse("2026-10-13T17:30:00Z")), "INV-20261014-BLAX1");
  });
  test("an auto-renew order (made by Midtrans, digits at the end) still gets one", () => {
    assert.match(invoiceNumber("blsub-abc12345678901234567890123456789012", paidAt), /^INV-20261013-[0-9A-Z]{8}$/);
    assert.equal(invoiceNumber("", paidAt), "INV-20261013-BRANDLAB");
  });
});

describe("payment time", () => {
  test("Indonesian date, 24-hour time, WIB", () => {
    assert.equal(paidAtLabel(Date.parse("2026-10-13T04:37:00Z")), "13 Oktober 2026, 11.37 WIB");
    assert.equal(paidAtLabel(Date.parse("2026-01-01T17:05:00Z")), "2 Januari 2026, 00.05 WIB");
  });
});

describe("how it was paid", () => {
  test("virtual accounts name their bank", () => {
    assert.equal(paymentMethodLabel({ payment_type: "bank_transfer", va_numbers: [{ bank: "bni", va_number: "1" }] }), "Transfer bank BNI (virtual account)");
    assert.equal(paymentMethodLabel({ payment_type: "bank_transfer", permata_va_number: "1" }), "Transfer bank Permata (virtual account)");
    assert.equal(paymentMethodLabel({ payment_type: "bank_transfer", va_numbers: [{ bank: "cimb" }] }), "Transfer bank CIMB Niaga (virtual account)");
    assert.equal(paymentMethodLabel({ payment_type: "echannel" }), "Mandiri Bill Payment");
  });
  test("wallets, QRIS, cards", () => {
    assert.equal(paymentMethodLabel({ payment_type: "gopay" }), "GoPay");
    assert.equal(paymentMethodLabel({ payment_type: "qris", acquirer: "gopay" }), "QRIS");
    assert.equal(paymentMethodLabel({ payment_type: "credit_card", bank: "bni" }), "Kartu kredit/debit (BNI)");
    assert.equal(paymentMethodLabel({ payment_type: "credit_card" }), "Kartu kredit/debit");
  });
  test("nothing from the (unsigned) notification is echoed back", () => {
    assert.equal(paymentMethodLabel({ payment_type: "bank_transfer", va_numbers: [{ bank: "<b>evil</b>" }] }), "Transfer bank (virtual account)");
    assert.equal(paymentMethodLabel({ payment_type: "<script>" }), "");
    assert.equal(paymentMethodLabel({}), "");
    assert.equal(paymentMethodLabel(undefined), "");
  });
});
