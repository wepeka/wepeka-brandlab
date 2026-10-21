// "Lupa password" mailed by Brandlab itself (api/_authEmail.js): template,
// link language, limiter, and the request logic with fake Firebase/Resend.
import test from "node:test";
import assert from "node:assert/strict";
import { composeResetEmail, resetLinkInIndonesian, makeLimiter, handleResetRequest, looksLikeEmail } from "../api/_authEmail.js";

const LINK = "https://wepeka-ba996.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC&apiKey=k&continueUrl=https%3A%2F%2Fbrandlab.wepeka.com%2F&lang=en";

function deps(over = {}) {
  const sent = [];
  const links = [];
  return {
    sent,
    links,
    d: {
      configured: true,
      allowIp: () => true,
      allowEmail: () => true,
      makeLink: async (email, appUrl) => {
        links.push([email, appUrl]);
        if (email === "baru@example.test") throw Object.assign(new Error("no user"), { code: "auth/email-not-found" });
        return LINK;
      },
      send: async (to, mail, key) => {
        sent.push({ to, mail, key });
        return { ok: true };
      },
      appUrl: "https://brandlab.wepeka.com",
      now: 1_800_000_000_000,
      ...over,
    },
  };
}

test("reset link opens Firebase's page in Indonesian, every other part kept", () => {
  const url = new URL(resetLinkInIndonesian(LINK));
  assert.equal(url.searchParams.get("lang"), "id");
  assert.equal(url.searchParams.get("oobCode"), "ABC");
  assert.equal(url.searchParams.get("apiKey"), "k");
  assert.equal(url.searchParams.get("continueUrl"), "https://brandlab.wepeka.com/");
});

test("reset email: subject, button, plain-text twin, link escaped", () => {
  const m = composeResetEmail({ link: `${LINK}&x="<b>`, appUrl: "https://brandlab.wepeka.com" });
  assert.equal(m.subject, "Atur ulang password Brandlab kamu");
  assert.match(m.html, /Buat password baru/);
  assert.ok(!m.html.includes('x="<b>'));
  assert.ok(m.html.includes("x=&quot;&lt;b&gt;"));
  assert.match(m.text, /Buat password baru: https:\/\/wepeka-ba996\.firebaseapp\.com/);
  assert.match(m.text, /Password kamu tidak berubah/);
});

test("known email: one email to the lower-cased address, Indonesian link, per-minute key", async () => {
  const { sent, links, d } = deps();
  const r = await handleResetRequest({ email: "  Ada@Example.TEST ", ip: "1.2.3.4" }, d);
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.deepEqual(links, [["ada@example.test", "https://brandlab.wepeka.com"]]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ada@example.test");
  assert.match(sent[0].mail.html, /lang=id/);
  assert.equal(sent[0].key, `brandlab-reset-ada@example.test-${Math.floor(1_800_000_000_000 / 60000)}`);
});

test("unknown email or a typo: the same 'ok', nothing sent", async () => {
  const { sent, d } = deps();
  assert.deepEqual(await handleResetRequest({ email: "baru@example.test", ip: "1" }, d), { status: 200, body: { ok: true } });
  assert.deepEqual(await handleResetRequest({ email: "bukan-email", ip: "1" }, d), { status: 200, body: { ok: true } });
  assert.equal(sent.length, 0);
});

test("email not set up: 503 so the app falls back to Firebase", async () => {
  const { sent, d } = deps({ configured: false });
  assert.equal((await handleResetRequest({ email: "ada@example.test", ip: "1" }, d)).status, 503);
  assert.equal(sent.length, 0);
});

test("Firebase or Resend failing: 502 (fallback); a 409 repeat counts as sent", async () => {
  const boom = deps({ makeLink: async () => { throw Object.assign(new Error("x"), { code: "auth/internal-error" }); } });
  assert.equal((await handleResetRequest({ email: "ada@example.test", ip: "1" }, boom.d)).status, 502);
  const down = deps({ send: async () => ({ ok: false, status: 500 }) });
  assert.equal((await handleResetRequest({ email: "ada@example.test", ip: "1" }, down.d)).status, 502);
  const repeat = deps({ send: async () => ({ ok: false, status: 409 }) });
  assert.equal((await handleResetRequest({ email: "ada@example.test", ip: "1" }, repeat.d)).status, 200);
});

test("limits: per address and per IP answer 429", async () => {
  const allowEmail = makeLimiter({ limit: 3, windowMs: 600_000 });
  const allowIp = makeLimiter({ limit: 10, windowMs: 600_000 });
  const { d } = deps({ allowEmail, allowIp });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await handleResetRequest({ email: "ada@example.test", ip: "9.9.9.9" }, d)).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
  const more = [];
  for (let i = 0; i < 7; i++) more.push((await handleResetRequest({ email: `o${i}@example.test`, ip: "9.9.9.9" }, d)).status);
  assert.deepEqual(more, [200, 200, 200, 200, 200, 200, 429]);
});

test("limiter frees up after the window", () => {
  const allow = makeLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(allow("k", 0), true);
  assert.equal(allow("k", 10), true);
  assert.equal(allow("k", 20), false);
  assert.equal(allow("k", 1015), true);
});

test("looksLikeEmail", () => {
  assert.equal(looksLikeEmail("a@b.co"), true);
  assert.equal(looksLikeEmail("a b@c.co"), false);
  assert.equal(looksLikeEmail("x".repeat(250) + "@b.co"), false);
});
