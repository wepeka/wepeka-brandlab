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
import { communityLinksHTML, progressText, waTopbarHTML, waPopoverHTML, waGroupIds, waAllJoined } from "../js/community.js";
import { setCachedAccount } from "../js/account.js";
import { getSettings, updateSettings } from "../js/store.js";
import { paidWelcomeDue, welcomeMarks } from "../js/paid-welcome.js";
import { payThanksHTML, planLabel } from "../js/pay-thanks.js";
import { t } from "../js/i18n.js";

const DAY = 86400000;
const NOW = Date.parse("2026-10-13T03:00:00Z");

describe("community links", () => {
  test("the app and the emails point at the same group and accounts", () => {
    assert.equal(client.BRANDLAB_WA_GROUP_URL, server.BRANDLAB_WA_GROUP_URL);
    assert.deepEqual(client.FOLLOW_INSTAGRAM, server.FOLLOW_INSTAGRAM);
    assert.equal(client.SUPPORT_WA_NUMBER, server.SUPPORT_WA_NUMBER);
    assert.equal(client.TERMS_URL, server.TERMS_URL);
    assert.equal(client.PRIVACY_URL, server.PRIVACY_URL);
    assert.equal(client.REFUND_URL, server.REFUND_URL);
    assert.equal(client.WEPEKA_CONNECT_URL, server.WEPEKA_CONNECT_URL);
    for (const plan of ["founder", "founder-ultimate", "pro-monthly"]) assert.equal(client.buyUrl(plan), server.buyUrl(plan));
    assert.equal(client.TERMS_URL, "https://www.wepeka.com/syarat-ketentuan");
    assert.equal(client.PRIVACY_URL, "https://www.wepeka.com/kebijakan-privasi");
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
      const guide = server.GUIDE_WA_URL;
      assert.ok(part.includes(guide), "the guided setup chat");
      assert.ok(part.indexOf(guide) < part.indexOf(LIFETIME_WA_GROUP_URL), "the guided setup first");
      assert.ok(part.includes(server.BRANDLAB_WA_GROUP_URL), "and the general group too");
      assert.ok(part.indexOf(LIFETIME_WA_GROUP_URL) < part.indexOf(server.BRANDLAB_WA_GROUP_URL), "their own group first");
    }
    const starter = composePaidEmail({ name: "Rani", label: "Brandlab Starter — Bulanan", amount: 49000, orderId: "bl-2", isPlan: true });
    const addon = composePaidEmail({ label: "Brandlab — 300 kredit AI", amount: 15000, orderId: "bl-3", isPlan: false, lifetime: true });
    const news = composeAnnouncementEmail({ title: "Fitur baru", body: "Isi", appUrl: "https://brandlab.wepeka.com" });
    for (const mail of [starter, addon, news]) {
      assert.ok(!mail.html.includes(INVITE) && !mail.text.includes(INVITE));
      assert.ok(!mail.text.includes(server.GUIDE_WA_URL), "the guided setup is for Lifetime buyers");
    }
  });
});

// Every door carries its check, its "done" wording and a bubble saying what
// would be missed (owner, 2026-10-13).
describe("the community sheet's doors", () => {
  test("group and follow buttons each have a to-do label, a done label and their bubble", () => {
    const html = communityLinksHTML();
    const doors = [...html.matchAll(/<a class="community-btn[^"]*"[^>]*data-done-id="([^"]+)"[\s\S]*?<\/a>/g)];
    assert.deepEqual(doors.map((m) => m[1]), ["wa", "ig:winkhsin", "ig:wepeka.id"]);
    const [group, ...follows] = doors.map((m) => m[0]);
    assert.ok(group.includes(t("community.join")) && group.includes(t("community.joined")));
    assert.ok(group.includes(`>${t("community.bubble.group")}<`));
    for (const f of follows) assert.ok(f.includes(`>${t("community.bubble.follow")}<`) && f.includes("community-tick"));
    assert.ok(follows[0].includes(t("community.followed", { handle: "@winkhsin" })));
    assert.ok(!html.includes("is-done"), "nothing is checked before it is tapped");
  });

  test("a Lifetime account gets a place for its own group above the general one, filled by the server", () => {
    const html = communityLinksHTML({ lifetime: true });
    assert.ok(html.indexOf("data-community-lifetime") < html.indexOf('data-done-id="wa"'));
    assert.ok(!communityLinksHTML().includes("data-community-lifetime"));
  });

  // Founders are guided until Brandlab runs (owner, 2026-10-18): the chat
  // that starts it is a Lifetime account's first door, the same chat the
  // email after payment opens.
  test("a Lifetime account's first door starts the guided setup on WhatsApp", () => {
    const html = communityLinksHTML({ lifetime: true });
    const doors = [...html.matchAll(/data-done-id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(doors, ["guide", "wa", "ig:winkhsin", "ig:wepeka.id"]);
    assert.ok(html.indexOf('data-done-id="guide"') < html.indexOf("data-community-lifetime"));
    const href = html.match(/href="([^"]+)"[^>]*data-done-id="guide"/)[1].replace(/&amp;/g, "&");
    assert.equal(href, server.GUIDE_WA_URL);
    assert.equal(t("community.guideText"), server.GUIDE_WA_TEXT);
    assert.ok(html.includes(t("community.guide")) && html.includes(`>${t("community.bubble.guide")}<`));
    assert.ok(!communityLinksHTML().includes('data-done-id="guide"'));
  });

  test("the line above them counts what is left", () => {
    assert.equal(progressText(0, 3), t("community.progress.none", { total: 3 }));
    assert.equal(progressText(2, 4), t("community.progress.some", { done: 2, total: 4 }));
    assert.equal(progressText(4, 4), t("community.progress.all"));
    assert.equal(progressText(0, 0), "");
  });
});

describe("the congratulations page after payment", () => {
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
  // A subscriber who was thanked and then buys Founder has never been shown
  // the Lifetime group: that account answers to its own mark.
  test("a Lifetime account is thanked on its own mark; closing it covers both", () => {
    const sub = welcomeMarks(false);
    const life = welcomeMarks(true);
    assert.equal(sub.check, "community:welcome");
    assert.deepEqual(sub.write, ["community:welcome"]);
    assert.notEqual(life.check, sub.check);
    assert.ok(life.write.includes(sub.check) && life.write.includes(life.check));
    // Thanked as a subscriber only: still due once the plan is Lifetime.
    const seen = { [sub.check]: 1 };
    const founder = { status: "active", plan: "founder", subscriptionExpiresAt: null };
    assert.equal(paidWelcomeDue(founder, { seen: !!seen[life.check] }), true);
    assert.equal(paidWelcomeDue(paid, { seen: !!seen[sub.check] }), false);
  });
});

// What a buyer comes back to after paying (owner, 2026-10-13: "congrats kamu
// sudah lifetime doang tanpa harga2 itu, lanjut ke brandlab").
describe("what the congratulations page says", () => {
  const founder = { status: "active", plan: "founder", subscriptionExpiresAt: null };
  const starter = { status: "active", plan: "starter", billing: "monthly", subscriptionExpiresAt: Date.now() + 30 * DAY };
  const text = (html) => html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("a Lifetime buyer: congratulated as Lifetime, with the plan's name and the Lifetime group's place", () => {
    const html = payThanksHTML(founder);
    assert.ok(html.includes(t("pay.thanks.title.lifetime")));
    assert.ok(html.includes(t("pay.thanks.sub.lifetime")));
    assert.match(html, /pay-thanks-pill[^>]*>Founder Lifetime</);
    assert.ok(html.indexOf("data-community-lifetime") < html.indexOf('data-done-id="wa"'));
    assert.ok(html.includes('data-done-id="ig:winkhsin"') && html.includes('data-done-id="ig:wepeka.id"'));
  });

  test("a subscriber: congratulated on the plan, general doors only", () => {
    const html = payThanksHTML(starter);
    assert.ok(html.includes(t("pay.thanks.title.plan")));
    assert.ok(html.includes(t("pay.thanks.sub.plan")));
    assert.ok(html.includes(`>${t("pricing.planName.starter")}<`));
    assert.ok(!html.includes("data-community-lifetime"));
    assert.ok(!html.includes(t("pay.thanks.title.lifetime")));
  });

  test("no price, no plan to buy, and exactly one button: into the app", () => {
    for (const account of [founder, starter, { status: "active", plan: "founder-ultimate", subscriptionExpiresAt: null }]) {
      const html = payThanksHTML(account);
      assert.doesNotMatch(text(html), /Rp\s?\d|\d{3}\.000|IDR/);
      assert.doesNotMatch(html, /data-pay=|data-pay-addon|pricing-way|pricing-price|#\/pricing/);
      const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
      assert.equal(buttons.length, 1);
      assert.ok(buttons[0][0].includes("data-pay-thanks-go"));
      assert.ok(buttons[0][1].includes(t("community.paid.cta")));
    }
  });

  test("the plan's name is the plans page's; the old Lifetime plan has a plain one, an unknown plan none", () => {
    assert.equal(planLabel({ plan: "founder-ultimate" }), t("pricing.planName.founder-ultimate"));
    assert.equal(planLabel({ plan: "pro" }), t("pricing.planName.pro"));
    assert.equal(planLabel({ plan: "lifetime" }), "Lifetime");
    assert.equal(planLabel({ plan: "sesuatu" }), "");
    assert.equal(planLabel(null), "");
    assert.ok(!payThanksHTML({ status: "active", plan: "sesuatu", subscriptionExpiresAt: null }).includes("pay-thanks-pill"));
  });

  test("whatever the plan field holds never reaches the page as markup", () => {
    assert.doesNotMatch(payThanksHTML({ status: "active", plan: "<img src=x onerror=1>", subscriptionExpiresAt: null }), /<img/);
  });
});

describe("invoice email after a payment", () => {
  const paidAt = Date.parse("2026-10-13T04:37:00Z"); // 11.37 WIB
  test("a plan: welcome wording, the invoice's facts, group and Instagram links", () => {
    const m = composePaidEmail({
      name: "Rani Contoh", email: "rani@kopi.id", label: "Brandlab Starter — Bulanan", amount: 49000, price: 49000, orderId: "bl-abc-123",
      invoiceNo: "INV-20261013-BLABC123", paidAt, method: "Transfer bank BNI (virtual account)", isPlan: true, appUrl: "https://brandlab.wepeka.com",
    });
    assert.equal(m.subject, "Invoice INV-20261013-BLABC123 — selamat datang di Brandlab");
    for (const part of [m.html, m.text]) {
      assert.match(part, /Hai Rani,/);
      assert.match(part, /INVOICE/);
      assert.match(part, /LUNAS/);
      assert.match(part, /INV-20261013-BLABC123/);
      assert.match(part, /13 Oktober 2026, 11\.37 WIB/);
      assert.match(part, /Rani Contoh \(rani@kopi\.id\)/);
      assert.match(part, /Transfer bank BNI \(virtual account\)/);
      assert.match(part, /Brandlab Starter — Bulanan/);
      assert.match(part, /Rp 49\.000/);
      assert.match(part, /Total dibayar/);
      assert.match(part, /bl-abc-123/);
      assert.match(part, /Diterbitkan oleh Wepeka/);
      assert.doesNotMatch(part, /Sisa nilai paket/);
      assert.ok(part.includes(server.BRANDLAB_WA_GROUP_URL));
      assert.ok(part.includes("https://www.instagram.com/winkhsin"));
      assert.ok(part.includes("https://www.instagram.com/wepeka.id"));
      assert.ok(part.includes("https://brandlab.wepeka.com"));
      for (const url of [server.TERMS_URL, server.REFUND_URL, server.PRIVACY_URL]) assert.ok(part.includes(url), url);
    }
  });
  test("an upgrade shows the plan's price, what was left of the old plan, and what was paid", () => {
    const m = composePaidEmail({ name: "Dimas", email: "d@x.id", label: "Brandlab Studio — Bulanan", amount: 99000, price: 149000, credit: 50000, orderId: "bl-x", invoiceNo: "INV-1", paidAt });
    for (const part of [m.html, m.text]) {
      assert.match(part, /Rp 149\.000/);
      assert.match(part, /Sisa nilai paket sebelumnya/);
      assert.match(part, /− Rp 50\.000/);
      assert.match(part, /Total dibayar[\s\S]*Rp 99\.000/);
    }
    // Numbers that don't add up: only what was really paid is shown.
    const odd = composePaidEmail({ label: "X", amount: 99000, price: 149000, credit: 10000, orderId: "o", paidAt });
    assert.doesNotMatch(odd.text, /Sisa nilai paket|149\.000/);
    assert.match(odd.text, /X: Rp 99\.000/);
  });
  test("an add-on reads as a receipt; a missing name, email or method leaves no empty row", () => {
    const m = composePaidEmail({ label: "Brandlab — 300 kredit AI", amount: 15000, orderId: "bl-x", invoiceNo: "INV-20261013-BLX", paidAt, isPlan: false });
    assert.equal(m.subject, "Invoice INV-20261013-BLX — Brandlab — 300 kredit AI");
    assert.match(m.text, /^Hai,/);
    assert.doesNotMatch(m.text, /selamat datang|Makasih sudah gabung/);
    assert.doesNotMatch(m.text, /Ditagihkan ke|Metode bayar/);
    assert.doesNotMatch(m.html, /Ditagihkan ke|Metode bayar|undefined|null/);
    assert.ok(m.text.includes(server.BRANDLAB_WA_GROUP_URL));
  });
  test("an auto-renew charge says so", () => {
    const m = composePaidEmail({ name: "Rani", label: "Brandlab Starter — Bulanan", amount: 49000, orderId: "o", invoiceNo: "INV-2", paidAt, isPlan: true, renewal: true });
    assert.equal(m.subject, "Invoice INV-2 — perpanjangan Brandlab Starter — Bulanan");
    assert.match(m.text, /Perpanjangan otomatis Brandlab Starter — Bulanan sudah kami terima/);
    assert.doesNotMatch(m.text, /selamat datang|Makasih sudah gabung/);
  });
  test("whatever is in the name, email, label or method is escaped in the HTML", () => {
    const m = composePaidEmail({ name: "<img src=x onerror=1>", email: "a@b.c<script>", label: "A & <b>B</b>", method: "<i>x</i>", amount: 1, orderId: "<o>", invoiceNo: "<n>" });
    assert.doesNotMatch(m.html, /<img src=x/);
    assert.doesNotMatch(m.html, /<b>B<\/b>/);
    assert.doesNotMatch(m.html, /<script>|<i>x<\/i>|<o>|<n>/);
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

// The green WhatsApp button in the topbar (owner, 2026-10-21): join the
// group from the top corner; once joined it takes you to WhatsApp. A tap
// before that explains what the group is for — two groups (two buttons) for
// a Lifetime account, one for everyone else.
describe("the topbar's WhatsApp button", () => {
  // Tapped = the account's mark, the one that follows it to other devices.
  const tap = (id) => updateSettings({ guideSeen: { ...(getSettings()?.guideSeen || {}), [`community:done:${id}`]: Date.now() } });
  const words = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const doors = (html) => [...html.matchAll(/data-done-id="([^"]+)"/g)].map((m) => m[1]);
  const founder = { status: "active", plan: "founder", subscriptionExpiresAt: null };
  const trial = { status: "active", plan: "trial", trialEndsAt: Date.now() + 5 * DAY };

  test("joined means every group of the account was tapped", () => {
    assert.deepEqual(waGroupIds(false), ["wa"]);
    assert.deepEqual(waGroupIds(true), ["wa-lifetime", "wa"]);
    assert.equal(waAllJoined(false, (id) => id === "wa"), true);
    assert.equal(waAllJoined(true, (id) => id === "wa"), false, "a Lifetime account still has its own group");
    assert.equal(waAllJoined(true, () => true), true);
    assert.equal(waAllJoined(false, () => false), false);
  });

  test("one group: says what it is for, with one button", () => {
    const html = waPopoverHTML({ lifetime: false });
    assert.deepEqual(doors(html), ["wa"]);
    for (const k of ["news", "tips", "ask"]) assert.ok(words(html).includes(t(`wa.perk.${k}`)), k);
    assert.ok(!html.includes("data-wa-lifetime") && !words(html).includes(t("wa.perk.live")));
    assert.ok(html.includes(client.BRANDLAB_WA_GROUP_URL));
    assert.ok(html.includes(t("community.join")) && html.includes(t("wa.pop.openGeneral")), "join, and once joined: open");
    assert.ok(!html.includes("community-bubble"));
  });

  test("Lifetime: its own group first, then the Brandlab group — two buttons, the first from the server", () => {
    const html = waPopoverHTML({ lifetime: true });
    assert.ok(html.indexOf("data-wa-lifetime") < html.indexOf('data-done-id="wa"'));
    assert.ok(words(html).includes(t("wa.perk.live")) && words(html).includes(t("wa.perk.founders")));
    assert.ok(words(html).includes(t("wa.perk.news")));
    assert.ok(!html.includes(LIFETIME_WA_GROUP_URL.split("/").pop()), "never in the page until the server hands it over");
  });

  test("not joined: a button that opens the explanation; joined with one group: a link straight to it", () => {
    setCachedAccount(trial);
    const before = waTopbarHTML();
    assert.match(before, /^<button[^>]*id="wa-group-btn"/);
    assert.ok(before.includes(`>${t("wa.top.join")}<`) && !before.includes("is-joined"));
    tap("wa");
    const after = waTopbarHTML();
    assert.match(after, /^<a [^>]*id="wa-group-btn"[^>]*is-joined/);
    assert.ok(after.includes(`href="${client.BRANDLAB_WA_GROUP_URL}"`) && after.includes(`>${t("wa.top.open")}<`));
  });

  test("Lifetime with only the Brandlab group joined: still asks; both joined: opens the two-button popover", () => {
    setCachedAccount(founder);
    tap("wa");
    const half = waTopbarHTML();
    assert.match(half, /^<button/);
    assert.ok(half.includes(`>${t("wa.top.join")}<`));
    tap("wa-lifetime");
    const both = waTopbarHTML();
    assert.match(both, /^<button[^>]*is-joined/);
    assert.ok(both.includes(`>${t("wa.top.open")}<`) && !both.includes("href="));
    setCachedAccount(null);
    updateSettings({ guideSeen: {} });
  });
});
