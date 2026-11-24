// api/cron/updates.js on the LOCAL Firestore emulator — `npm run test:emu`
// (project demo-brandlab, never a real one). Resend is a fake fetch.
// Posts every Update Brandlab entry once, mails them in one email inside the
// 09–20 WIB window, once a day, skipping who turned the emails off.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  BRANDLAB_EMULATOR: "1",
  GCLOUD_PROJECT: "demo-brandlab",
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099",
  CRON_SECRET: "cron-test",
  RESEND_API_KEY: "re_test_fake",
  RESEND_FROM: "Wepeka Brandlab <brandlab@wepeka.test>",
});
const { adminDb } = await import("../../api/_firebaseAdmin.js");
const { default: handler } = await import("../../api/cron/updates.js");
const { UPDATES, docIdOf } = await import("../../api/_updates.js");

let db;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let sent = [];
let clock = Date.parse("2026-12-01T03:00:00Z"); // 10.00 WIB

function call(query = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
    handler({ method: "GET", headers: { authorization: "Bearer cron-test" }, query }, res);
  });
}

before(() => {
  db = adminDb();
  Date.now = () => clock;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const batch = JSON.parse(init.body);
      sent.push(...batch.map((m) => ({ to: m.to[0], subject: m.subject, html: m.html })));
      return new Response(JSON.stringify({ data: batch.map((_, i) => ({ id: `e${i}` })) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init);
  };
});
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

beforeEach(async () => {
  await realFetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-brandlab/databases/(default)/documents`, { method: "DELETE" });
  sent = [];
  clock = Date.parse("2026-12-01T03:00:00Z");
  for (const [uid, email] of [["u1", "satu@contoh.test"], ["u2", "dua@contoh.test"], ["u3", "tiga@contoh.test"]]) {
    await db.doc(`accounts/${uid}`).set({ status: "active", plan: "trial", trialEndsAt: Date.parse("2027-01-01"), email });
  }
  await db.doc("settings/u3").set({ updatesEmailOff: true });
});

test("only the cron may call it", async () => {
  const r = await new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { resolve({ code: this.code, body }); } };
    handler({ method: "GET", headers: { authorization: "Bearer nope" }, query: {} }, res);
  });
  assert.equal(r.code, 401);
});

test("posts every entry once, then one email to everyone who wants it; the next run does nothing", async () => {
  const r = await call();
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.posted.length, UPDATES.length);
  const snap = await db.collection("announcements").get();
  assert.equal(snap.size, UPDATES.length);
  const top = snap.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt)[0];
  assert.equal(top.title, UPDATES[0].title, "the first entry is the newest post");
  assert.ok(top.steps.length >= 2 && top.images.length >= 1);
  // One email each, to the two who didn't turn them off.
  assert.deepEqual(sent.map((m) => m.to).sort(), ["dua@contoh.test", "satu@contoh.test"]);
  assert.match(sent[0].subject, /^Update Brandlab: /);
  assert.match(sent[0].html, /Cara pakai/);
  for (const d of snap.docs) assert.ok(d.data().emailedAt, `${d.id} marked as mailed`);

  sent = [];
  clock += 30 * 60 * 1000;
  const again = await call();
  assert.deepEqual(again.body.posted, []);
  assert.equal(again.body.mail.mode, "none");
  assert.equal(sent.length, 0, "nothing twice");
});

test("outside 09–20 WIB it posts but waits to mail; an edited entry updates its post, not mailed again", async () => {
  clock = Date.parse("2026-12-01T15:00:00Z"); // 22.00 WIB
  const r = await call();
  assert.equal(r.body.posted.length, UPDATES.length);
  assert.equal(r.body.mail.mode, "none");
  assert.equal(sent.length, 0);
  // Next morning it goes.
  clock = Date.parse("2026-12-02T02:10:00Z"); // 09.10 WIB
  const morning = await call();
  assert.equal(morning.body.mail.mode, "start");
  assert.equal(sent.length, 2);
  // A post changed by hand (a stale copy) is put back from the entry, without a new email.
  const id = docIdOf(UPDATES[0]);
  await db.doc(`announcements/${id}`).update({ title: "lama", hash: "x" });
  sent = [];
  const fix = await call();
  assert.deepEqual(fix.body.changed, [id]);
  assert.equal((await db.doc(`announcements/${id}`).get()).data().title, UPDATES[0].title);
  assert.equal(sent.length, 0);
});

test("dryRun writes and sends nothing", async () => {
  const r = await call({ dryRun: "1" });
  assert.equal(r.body.posted.length, UPDATES.length);
  assert.equal((await db.collection("announcements").get()).size, 0);
  assert.equal(sent.length, 0);
});
