// Community: the WhatsApp group + Instagram links shown after a payment
// (js/community.js, js/site-links.js) and the two emails that carry them
// (api/_community.js, api/_email.js sendEmailBatch). No network, no Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as client from "../js/site-links.js";
import * as server from "../api/_community.js";
import { composePaidEmail, composeAnnouncementEmail, announcementRecipients } from "../api/_community.js";
import { sendEmailBatch, EMAIL_BATCH_SIZE } from "../api/_email.js";
import { paidWelcomeDue } from "../js/community.js";

const DAY = 86400000;
const NOW = Date.parse("2026-10-13T03:00:00Z");

describe("community links", () => {
  test("the app and the emails point at the same group and accounts", () => {
    assert.equal(client.BRANDLAB_WA_GROUP_URL, server.BRANDLAB_WA_GROUP_URL);
    assert.deepEqual(client.FOLLOW_INSTAGRAM, server.FOLLOW_INSTAGRAM);
    assert.equal(client.SUPPORT_WA_NUMBER, server.SUPPORT_WA_NUMBER);
    assert.match(client.BRANDLAB_WA_GROUP_URL, /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/);
    assert.deepEqual(client.FOLLOW_INSTAGRAM, ["winkhsin", "wepeka.id"]);
    assert.equal(client.instagramUrl("@winkhsin"), "https://www.instagram.com/winkhsin");
    assert.equal(server.instagramUrl("wepeka.id"), "https://www.instagram.com/wepeka.id");
  });
});

describe("the thank-you sheet after payment", () => {
  const paid = { status: "active", plan: "starter", subscriptionExpiresAt: Date.now() + 30 * DAY };
  test("shown once to an account on a paid plan", () => {
    assert.equal(paidWelcomeDue(paid), true);
    assert.equal(paidWelcomeDue({ status: "active", plan: "founder", subscriptionExpiresAt: null }), true);
    assert.equal(paidWelcomeDue(paid, { seen: true }), false);
  });
  test("not for a trial, a lapsed plan, no account, or the Wepeka team", () => {
    assert.equal(paidWelcomeDue({ status: "active", plan: "trial", trialEndsAt: Date.now() + DAY }), false);
    assert.equal(paidWelcomeDue({ status: "active", plan: "starter", subscriptionExpiresAt: Date.now() - DAY }), false);
    assert.equal(paidWelcomeDue({ status: "readonly", plan: "starter", subscriptionExpiresAt: Date.now() + DAY }), false);
    assert.equal(paidWelcomeDue(null), false);
    assert.equal(paidWelcomeDue(paid, { admin: true }), false);
  });
});

describe("email after a payment", () => {
  test("a plan: welcome wording, amount, order number, group and Instagram links", () => {
    const m = composePaidEmail({ name: "Rani Contoh", label: "Brandlab Starter — Bulanan", amount: 49000, orderId: "bl-abc-123", isPlan: true, appUrl: "https://brandlab.wepeka.com" });
    assert.equal(m.subject, "Pembayaran diterima — selamat datang di Brandlab");
    for (const part of [m.html, m.text]) {
      assert.match(part, /Hai Rani,/);
      assert.match(part, /Brandlab Starter — Bulanan/);
      assert.match(part, /Rp 49\.000/);
      assert.match(part, /bl-abc-123/);
      assert.ok(part.includes(server.BRANDLAB_WA_GROUP_URL));
      assert.ok(part.includes("https://www.instagram.com/winkhsin"));
      assert.ok(part.includes("https://www.instagram.com/wepeka.id"));
      assert.ok(part.includes("https://brandlab.wepeka.com"));
    }
  });
  test("an add-on reads as a receipt, and a missing name still greets", () => {
    const m = composePaidEmail({ label: "Brandlab — 300 kredit AI", amount: 15000, orderId: "bl-x", isPlan: false });
    assert.equal(m.subject, "Pembayaran diterima — Brandlab — 300 kredit AI");
    assert.match(m.text, /^Hai,/);
    assert.doesNotMatch(m.text, /selamat datang|Makasih sudah gabung/);
    assert.ok(m.text.includes(server.BRANDLAB_WA_GROUP_URL));
  });
  test("whatever is in the name or label is escaped in the HTML", () => {
    const m = composePaidEmail({ name: "<img src=x onerror=1>", label: "A & <b>B</b>", amount: 1, orderId: "o" });
    assert.doesNotMatch(m.html, /<img src=x/);
    assert.doesNotMatch(m.html, /<b>B<\/b>/);
    assert.match(m.html, /A &amp; &lt;b&gt;B&lt;\/b&gt;/);
  });
});

describe("announcement email", () => {
  test("title, body with **bold**, the link, and how to turn these off", () => {
    const m = composeAnnouncementEmail({ title: "Seri konten sekarang punya hari tayang", body: "Atur di **Jadwal Kerja**.\nBerlaku mulai minggu ini.", link: "https://brandlab.wepeka.com/#/updates", appUrl: "https://brandlab.wepeka.com" });
    assert.equal(m.subject, "Brandlab: Seri konten sekarang punya hari tayang");
    assert.match(m.html, /<b>Jadwal Kerja<\/b>\.<br>Berlaku/);
    assert.match(m.html, /Pengaturan → Pengingat/);
    assert.ok(m.html.includes("https://brandlab.wepeka.com/#/settings/reminders"));
    assert.ok(m.text.includes("https://brandlab.wepeka.com/#/settings/reminders"));
    assert.ok(m.html.includes(server.BRANDLAB_WA_GROUP_URL));
  });
  test("a link that isn't https is dropped; the admin's text can't inject markup", () => {
    const m = composeAnnouncementEmail({ title: "<script>x</script>", body: "<a href=evil>klik</a>", link: "javascript:alert(1)", appUrl: "https://brandlab.wepeka.com" });
    assert.doesNotMatch(m.html, /<script>|javascript:|<a href=evil>/);
    assert.ok(m.html.includes("https://brandlab.wepeka.com/#/updates"));
    assert.match(m.html, /Lihat di Brandlab/);
  });
});

describe("who an announcement is mailed to", () => {
  const acc = (uid, extra = {}) => ({ uid, email: `${uid}@contoh.test`, status: "active", plan: "starter", subscriptionExpiresAt: NOW + 10 * DAY, ...extra });
  test("active paid and running-trial accounts with an address, once per address", () => {
    const list = announcementRecipients([
      acc("a"),
      acc("b", { plan: "trial", subscriptionExpiresAt: undefined, trialEndsAt: NOW + DAY }),
      acc("c", { plan: "founder", subscriptionExpiresAt: null }),
      acc("d", { email: "A@contoh.test" }), // same inbox as "a"
    ], new Set(), NOW);
    assert.deepEqual(list.map((r) => r.uid), ["a", "b", "c"]);
    assert.equal(list[0].email, "a@contoh.test");
  });
  test("skips lapsed, ended-trial, inactive, free, address-less and opted-out accounts", () => {
    const list = announcementRecipients([
      acc("lapsed", { subscriptionExpiresAt: NOW - DAY }),
      acc("trial-ended", { plan: "trial", trialEndsAt: NOW - DAY }),
      acc("off", { status: "deactivated" }),
      acc("free", { plan: "free" }),
      acc("no-mail", { email: "" }),
      acc("bad-mail", { email: "bukan email" }),
      acc("opted-out"),
      acc("ok"),
    ], new Set(["opted-out"]), NOW);
    assert.deepEqual(list.map((r) => r.uid), ["ok"]);
  });
});

describe("sendEmailBatch", () => {
  const env = { RESEND_API_KEY: "re_test", RESEND_FROM: "Brandlab <halo@wepeka.com>" };
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ to: `u${i}@contoh.test`, subject: "s", html: "<p>h</p>", text: "t" }));
  test("off without the Resend settings — nothing is requested", async () => {
    let calls = 0;
    const r = await sendEmailBatch(msgs(3), { env: {}, fetchImpl: async () => { calls++; } });
    assert.deepEqual(r, { ok: false, skipped: true, sent: 0, failed: 3 });
    assert.equal(calls, 0);
  });
  test("chunks of 100 to the batch endpoint, bad addresses left out", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ data: [] }) }; };
    const r = await sendEmailBatch([...msgs(EMAIL_BATCH_SIZE + 20), { to: "rusak", subject: "s" }], { env, fetchImpl, idempotencyKey: "brandlab-ann-x" });
    assert.deepEqual(r, { ok: true, sent: 120, failed: 0 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.resend.com/emails/batch");
    assert.equal(calls[0].body.length, 100);
    assert.equal(calls[1].body.length, 20);
    assert.deepEqual(calls[0].body[0], { from: env.RESEND_FROM, to: ["u0@contoh.test"], subject: "s", html: "<p>h</p>", text: "t" });
    assert.equal(calls[0].init.headers.Authorization, "Bearer re_test");
    assert.equal(calls[0].init.headers["Idempotency-Key"], "brandlab-ann-x-0");
    assert.equal(calls[1].init.headers["Idempotency-Key"], "brandlab-ann-x-1");
  });
  test("stops at the chunk Resend refuses and reports how far it got", async () => {
    let n = 0;
    const fetchImpl = async () => (++n === 1 ? { ok: true, json: async () => ({}) } : { ok: false, status: 429, json: async () => ({ message: "daily quota exceeded" }) });
    const r = await sendEmailBatch(msgs(250), { env, fetchImpl });
    assert.deepEqual(r, { ok: false, sent: 100, failed: 150, status: 429, error: "daily quota exceeded" });
    assert.equal(n, 2);
  });
  test("a network failure never throws", async () => {
    const r = await sendEmailBatch(msgs(2), { env, fetchImpl: async () => { throw new Error("offline"); } });
    assert.deepEqual(r, { ok: false, sent: 0, failed: 2, error: "offline" });
  });
});
