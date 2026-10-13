// Community: the WhatsApp group + Instagram links shown after a payment
// (js/community.js, js/site-links.js) and the two emails that carry them
// (api/_community.js, api/_email.js sendEmailBatch). No network, no Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as client from "../js/site-links.js";
import * as server from "../api/_community.js";
import { composePaidEmail, composeAnnouncementEmail, announcementRecipients, lifetimeGroupFor, LIFETIME_WA_GROUP_URL } from "../api/_community.js";
import { ADMIN_UIDS } from "../api/_aiQuota.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

// Two Brandlab groups (owner, 2026-10-13): one for everyone, one for
// Lifetime accounts. The second one's link is handed out by the server only.
describe("the Lifetime group", () => {
  const INVITE = LIFETIME_WA_GROUP_URL.split("/").pop();
  test("it is its own group, a plain invite link", () => {
    assert.match(LIFETIME_WA_GROUP_URL, /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/);
    assert.notEqual(LIFETIME_WA_GROUP_URL, server.BRANDLAB_WA_GROUP_URL);
  });

  test("Founder, Agency Lifetime, the old Lifetime plan and the Wepeka team get the link", () => {
    for (const plan of ["founder", "founder-ultimate", "lifetime"]) {
      assert.equal(lifetimeGroupFor("u1", { plan, status: "active", subscriptionExpiresAt: null }), LIFETIME_WA_GROUP_URL, plan);
    }
    assert.equal(lifetimeGroupFor(ADMIN_UIDS[0], null), LIFETIME_WA_GROUP_URL);
  });

  test("nobody else does: trial, subscriptions, no account, a deactivated Lifetime", () => {
    for (const account of [
      null,
      { plan: "trial", status: "active", trialEndsAt: Date.now() + 86400000 },
      { plan: "starter", status: "active", subscriptionExpiresAt: Date.now() + 86400000 },
      { plan: "pro", status: "active", subscriptionExpiresAt: Date.now() + 86400000 },
      { plan: "studio", status: "active", subscriptionExpiresAt: Date.now() + 86400000 },
      { plan: "free", status: "active" },
      { plan: "founder", status: "deactivated" },
    ]) {
      assert.equal(lifetimeGroupFor("u1", account), null, JSON.stringify(account));
    }
  });

  test("its link is nowhere in what the browser downloads", () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const files = [path.join(root, "index.html")];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|css|html|json|webmanifest)$/.test(name)) files.push(p);
      }
    };
    for (const dir of ["js", "css", "assets"]) walk(path.join(root, dir));
    assert.ok(files.length > 100);
    assert.deepEqual(files.filter((f) => readFileSync(f, "utf8").includes(INVITE)), []);
    assert.equal(Object.values(client).some((v) => typeof v === "string" && v.includes(INVITE)), false);
  });

  test("the email after a Lifetime payment carries it; any other email never does", () => {
    const founder = composePaidEmail({ name: "Rani", label: "Brandlab Founder Lifetime", amount: 499000, orderId: "bl-1", isPlan: true, lifetime: true });
    for (const part of [founder.html, founder.text]) {
      assert.ok(part.includes(LIFETIME_WA_GROUP_URL));
      assert.ok(part.includes(server.BRANDLAB_WA_GROUP_URL), "and the general group too");
      assert.ok(part.indexOf(LIFETIME_WA_GROUP_URL) < part.indexOf(server.BRANDLAB_WA_GROUP_URL), "their own group first");
    }
    const starter = composePaidEmail({ name: "Rani", label: "Brandlab Starter — Bulanan", amount: 49000, orderId: "bl-2", isPlan: true });
    const addon = composePaidEmail({ label: "Brandlab — 300 kredit AI", amount: 15000, orderId: "bl-3", isPlan: false, lifetime: true });
    const news = composeAnnouncementEmail({ title: "Fitur baru", body: "Isi", appUrl: "https://brandlab.wepeka.com" });
    for (const mail of [starter, addon, news]) {
      assert.ok(!mail.html.includes(INVITE) && !mail.text.includes(INVITE));
    }
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
