// The team's own note about a payment (api/_ownerNotify.js): who it goes to
// and what the email and the push say. No network, no Firestore — the
// sending itself is api/midtrans/webhook.js (notifyOwner), checked here only
// for being wired into every path where money comes in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownerEmails, composeSaleNote, reviewNote, OWNER_EMAIL, ADMIN_URL } from "../api/_ownerNotify.js";

const PAID_AT = Date.parse("2026-10-13T04:37:00Z"); // 11.37 WIB
const SALE = {
  label: "Brandlab Founder Lifetime", amount: 499000, buyerName: "Rani Putri", buyerEmail: "rani@example.com", uid: "uid123",
  orderId: "bl-uid123-mv66x0fr", invoiceNo: "INV-20261013-MV66X0FR", paidAt: PAID_AT, method: "QRIS",
};

describe("who gets the note", () => {
  test("the owner's address while nothing is set", () => {
    assert.deepEqual(ownerEmails({}), [OWNER_EMAIL]);
    assert.deepEqual(ownerEmails({ OWNER_NOTIFY_EMAIL: "  " }), [OWNER_EMAIL]);
  });
  test("OWNER_NOTIFY_EMAIL replaces it: several addresses, once each", () => {
    assert.deepEqual(ownerEmails({ OWNER_NOTIFY_EMAIL: "A@wepeka.com, b@wepeka.com ,a@wepeka.com" }), ["a@wepeka.com", "b@wepeka.com"]);
  });
  test("\"off\" turns the email off; junk is dropped", () => {
    assert.deepEqual(ownerEmails({ OWNER_NOTIFY_EMAIL: "off" }), []);
    assert.deepEqual(ownerEmails({ OWNER_NOTIFY_EMAIL: "OFF" }), []);
    assert.deepEqual(ownerEmails({ OWNER_NOTIFY_EMAIL: "not an address, ok@wepeka.com" }), ["ok@wepeka.com"]);
  });
});

describe("the note about a sale", () => {
  test("subject: what was sold and for how much", () => {
    const { subject } = composeSaleNote(SALE);
    assert.equal(subject, "Ada yang beli Brandlab: Founder Lifetime · Rp 499.000");
  });
  test("the email names the buyer, the item, the money, the time and both ids", () => {
    const { text, html } = composeSaleNote(SALE);
    for (const line of [
      "Ada yang beli Brandlab: Founder Lifetime · Rp 499.000", "Pembeli: Rani Putri (rani@example.com)", "Metode bayar: QRIS",
      "Waktu: 13 Oktober 2026, 11.37 WIB", "No. invoice: INV-20261013-MV66X0FR", "No. pesanan: bl-uid123-mv66x0fr",
    ]) assert.ok(text.includes(line), line);
    assert.ok(html.includes(">Rp 499.000</h1>") && html.includes(">Founder Lifetime</p>"));
    assert.ok(text.includes(`${ADMIN_URL}/accounts/uid123`));
    assert.ok(html.includes(`href="${ADMIN_URL}/accounts/uid123"`));
    assert.ok(html.includes(`href="${ADMIN_URL}/payments"`));
    assert.ok(!text.includes("Kursi:") && !text.includes("Akun:") && !text.includes("PERLU DICEK"));
  });
  test("rows with nothing to say are left out", () => {
    const { text } = composeSaleNote({ ...SALE, method: "", buyerName: "" });
    assert.ok(!text.includes("Metode bayar"));
    assert.ok(text.includes("Pembeli: rani@example.com"));
    assert.ok(composeSaleNote({ label: "Brandlab — 300 kredit AI", amount: 15000 }).text.includes("Pembeli: Tidak diketahui"));
  });
  test("add-on labels lose their \"Brandlab —\" prefix, other names stay", () => {
    assert.match(composeSaleNote({ label: "Brandlab — 300 kredit AI", amount: 15000 }).subject, /: 300 kredit AI · Rp 15\.000$/);
    assert.match(composeSaleNote({ label: "Brandlab Pro — Bulanan", amount: 99000 }).subject, /: Pro — Bulanan · Rp 99\.000$/);
    assert.match(composeSaleNote({ label: "Brand Book — Gaya Pop", amount: 20000 }).subject, /: Brand Book — Gaya Pop · Rp 20\.000$/);
  });
  test("a capped plan says how many seats are sold and left", () => {
    const { text, push } = composeSaleNote({ ...SALE, seat: { sold: 16, cap: 50 } });
    assert.ok(text.includes("Kursi: 16 dari 50 terjual, sisa 34"));
    assert.ok(push.body.includes("Kursi: 16 dari 50 terjual, sisa 34"));
    assert.ok(composeSaleNote({ ...SALE, seat: { sold: 51, cap: 50 } }).text.includes("sisa 0"));
  });
  test("a buyer who never took the trial is marked as a new account", () => {
    assert.ok(composeSaleNote({ ...SALE, newAccount: true }).text.includes("Akun: Baru, beli tanpa trial"));
  });
  test("an auto-renew charge says so", () => {
    const { subject, text } = composeSaleNote({ ...SALE, label: "Brandlab Pro — Bulanan", amount: 99000, renewal: true });
    assert.equal(subject, "Perpanjangan otomatis: Pro — Bulanan · Rp 99.000");
    assert.ok(text.includes("Satu perpanjangan otomatis baru saja masuk."));
  });
  test("sandbox payments are marked, so test money is never read as real", () => {
    const { subject, text, push } = composeSaleNote({ ...SALE, sandbox: true });
    assert.ok(subject.startsWith("[SANDBOX] "));
    assert.ok(push.title.startsWith("[SANDBOX] "));
    assert.ok(text.includes("bukan uang sungguhan"));
  });
  test("nothing from the buyer reaches the HTML unescaped", () => {
    const { html } = composeSaleNote({ ...SALE, buyerName: "<img src=x onerror=1>", uid: "a/b?c" });
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img src=x onerror=1&gt;"));
    assert.ok(html.includes(`${ADMIN_URL}/accounts/a%2Fb%3Fc`));
  });
});

describe("payments that need a look", () => {
  test("paid but not applied: the subject itself says to check", () => {
    const { subject, text, html, push } = composeSaleNote({ ...SALE, review: "lifetime-conflict" });
    assert.equal(subject, "Pembayaran masuk, perlu dicek: Founder Lifetime · Rp 499.000");
    assert.ok(text.includes("PERLU DICEK. Akun ini sudah Lifetime"));
    assert.ok(html.includes("Perlu dicek."));
    assert.ok(push.body.includes("Perlu dicek"));
  });
  test("applied but worth a look: still a sale, with the warning", () => {
    const { subject, text } = composeSaleNote({ ...SALE, review: "over-cap" });
    assert.ok(subject.startsWith("Ada yang beli Brandlab: "));
    assert.ok(text.includes("PERLU DICEK. Kursi ini terjual melewati batas kursi."));
  });
  test("every flag the webhook can set has its own sentence", () => {
    for (const code of ["unknown-plan", "lifetime-conflict", "schedule-conflict"]) assert.equal(reviewNote(code).applied, false, code);
    for (const code of ["lifetime-overpaid", "over-cap"]) assert.equal(reviewNote(code).applied, true, code);
    assert.equal(reviewNote(""), null);
    assert.match(reviewNote("something-new").text, /something-new/);
    // The flags themselves, where they are set.
    const plans = readFileSync(new URL("../api/_plans.js", import.meta.url), "utf8");
    const webhook = readFileSync(new URL("../api/midtrans/webhook.js", import.meta.url), "utf8");
    const set = new Set([...plans.matchAll(/issue: "([a-z-]+)"/g), ...plans.matchAll(/\? "(lifetime-[a-z-]+)" : undefined/g), ...webhook.matchAll(/\? "(over-cap)"/g)].map((m) => m[1]));
    assert.deepEqual([...set].sort(), ["lifetime-conflict", "lifetime-overpaid", "over-cap", "schedule-conflict", "unknown-plan"]);
  });
});

describe("the push", () => {
  test("item, money and name on the lock screen; the tap opens the app itself", () => {
    const { push } = composeSaleNote({ ...SALE, appUrl: "https://brandlab.wepeka.com/" });
    assert.equal(push.title, "Ada yang beli Brandlab");
    assert.equal(push.body, "Founder Lifetime · Rp 499.000\nRani Putri");
    assert.equal(push.url, "https://brandlab.wepeka.com/");
    assert.match(push.tag, /^brandlab-sale-/);
  });
  test("two sales never share a tag (the second would replace the first)", () => {
    assert.notEqual(composeSaleNote(SALE).push.tag, composeSaleNote({ ...SALE, orderId: "bl-uid123-mv66x0fs" }).push.tag);
  });
});

describe("wired into the webhook", () => {
  const webhook = readFileSync(new URL("../api/midtrans/webhook.js", import.meta.url), "utf8");
  test("a first payment and an auto-renew charge both send it", () => {
    assert.equal((webhook.match(/notifyOwner\(db, \{/g) || []).length, 3); // two calls + the function itself
    assert.match(webhook, /renewal: true,\n\s+orderId, amount: grossAmount, paidAt: now, notification,\n\s+\}\)\.catch\(\(err\) => console\.error\("Midtrans webhook: owner note failed"/);
  });
  test("it never fails the notification", () => {
    assert.equal((webhook.match(/owner note failed/g) || []).length, 2);
  });
});
