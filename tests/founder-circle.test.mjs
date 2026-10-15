import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isCircleMember, sessionOf, recordingsOf, reviewOf, bedahOf, circleView, waNumber, reviewRequest, composeReviewNote, CIRCLE_DOC } from "../api/_founderCircle.js";
import { handleCircleRequest } from "../api/founder-circle.js";
import { ADMIN_UIDS } from "../api/_aiQuota.js";

const HOUR = 60 * 60 * 1000;

// A small fake Firestore: doc(path).get() / .set(data, { merge }).
function fakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  const merge = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k], v) : v;
    return out;
  };
  return {
    doc: (path) => ({
      async get() { const d = docs.get(path); return { exists: d !== undefined, data: () => structuredClone(d) }; },
      async set(data, opts = {}) { docs.set(path, opts.merge ? merge(docs.get(path), data) : structuredClone(data)); },
    }),
    read: (path) => docs.get(path),
  };
}
function fakeRes() {
  return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}
const NOW = Date.UTC(2026, 9, 20, 6, 0, 0);
const founder = { plan: "founder", status: "active", displayName: "Rina", email: "rina@example.com" };
async function call(db, { method = "GET", body, uid = "u1", notify = async () => {} } = {}) {
  const res = fakeRes();
  await handleCircleRequest({ method, body }, res, { db, uid, now: NOW, notify });
  return res;
}

describe("Founder Circle: who is in", () => {
  test("Lifetime plans and Wepeka's team; not trials, not a deactivated Founder", () => {
    assert.equal(isCircleMember("x", { plan: "founder", status: "active" }), true);
    assert.equal(isCircleMember("x", { plan: "founder-ultimate", status: "active" }), true);
    assert.equal(isCircleMember("x", { plan: "trial", status: "active" }), false);
    assert.equal(isCircleMember("x", { plan: "pro", status: "active" }), false);
    assert.equal(isCircleMember("x", { plan: "founder", status: "deactivated" }), false);
    assert.equal(isCircleMember(ADMIN_UIDS[0], null), true);
  });
});

describe("Founder Circle: what the app gets", () => {
  test("a session stays next until an hour after it ends", () => {
    const cfg = { nextSession: { at: NOW + 2 * HOUR, minutes: 90, topic: "Bedah Reels", link: "https://meet.google.com/abc-defg-hij" } };
    assert.equal(circleView(cfg, null, NOW).session.topic, "Bedah Reels");
    assert.ok(circleView(cfg, null, NOW + 4 * HOUR).session);
    assert.equal(circleView(cfg, null, NOW + 4.6 * HOUR).session, null);
  });
  test("a session is public only when it says so", () => {
    assert.equal(sessionOf({ at: NOW, kind: "public" }).kind, "public");
    assert.equal(sessionOf({ at: NOW }).kind, "founder");
    assert.equal(sessionOf({ at: NOW, kind: "anything" }).kind, "founder");
  });
  test("links must be https; junk is dropped", () => {
    assert.equal(sessionOf({ at: NOW, link: "javascript:alert(1)" }).link, "");
    assert.equal(sessionOf({ at: 0 }), null);
    const recs = recordingsOf([{ title: "Sesi 1", url: "https://youtu.be/a", at: 1 }, { title: "x", url: "http://bad" }, { title: "", url: "https://y" }, { title: "Sesi 2", url: "https://youtu.be/b", at: 2 }]);
    assert.deepEqual(recs.map((r) => r.title), ["Sesi 2", "Sesi 1"]);
  });
  test("review and bedah only show when they are real", () => {
    assert.equal(reviewOf({ status: "nope" }), null);
    assert.equal(reviewOf({ status: "requested", requestedAt: 5 }).status, "requested");
    assert.equal(bedahOf({ on: false }), null);
    assert.equal(bedahOf({ on: true, brandName: "Kopi" }).brandName, "Kopi");
  });
  test("WhatsApp numbers become wa.me digits", () => {
    assert.equal(waNumber("0812-3456-7890"), "6281234567890");
    assert.equal(waNumber("+62 812 3456 7890"), "6281234567890");
    assert.equal(waNumber("123"), "");
  });
  test("the team's email names who, which brand and links the admin", () => {
    const note = composeReviewNote({ name: "Rina", email: "rina@example.com", brandName: "Kopi <Pagi>", wa: "6281234567890", uid: "u1" });
    assert.match(note.subject, /Kopi <Pagi>/);
    assert.match(note.html, /Kopi &lt;Pagi&gt;/);
    assert.match(note.html, /admin\/brandlab\/founder-circle/);
    assert.match(note.text, /\+6281234567890/);
  });
  test("a request starts as requested with the brand's name", () => {
    const r = reviewRequest({ brandId: "b1", brandName: "", note: " tolong cek  warna ", wa: "08123456789" }, NOW);
    assert.equal(r.status, "requested");
    assert.equal(r.brandName, "Tanpa nama");
    assert.equal(r.note, "tolong cek warna");
    assert.equal(r.requestedAt, NOW);
  });
});

describe("api/founder-circle.js", () => {
  test("a non-member never sees a Founder session (no kind = Founders only)", async () => {
    const db = fakeDb({ "accounts/u1": { plan: "trial", status: "active" }, [CIRCLE_DOC]: { nextSession: { at: NOW + HOUR, link: "https://x.y" }, recordings: [{ title: "Sesi 1", url: "https://youtu.be/a", at: 1 }] } });
    const res = await call(db);
    assert.deepEqual(res.body, { member: false, session: null });
  });
  test("a public live is shown to every account — and only the live", async () => {
    const db = fakeDb({ "accounts/u1": { plan: "trial", status: "active" }, "brands/b1": { ownerId: "u1", name: "Kopi" }, [CIRCLE_DOC]: { nextSession: { at: NOW + HOUR, kind: "public", topic: "Live Brandlab", link: "https://www.instagram.com/winkhsin" }, recordings: [{ title: "Sesi 1", url: "https://youtu.be/a", at: 1 }] } });
    const res = await call(db);
    assert.equal(res.body.member, false);
    assert.equal(res.body.session.kind, "public");
    assert.equal(res.body.session.link, "https://www.instagram.com/winkhsin");
    assert.equal(res.body.recordings, undefined);
    const post = await call(db, { method: "POST", body: { action: "review", brandId: "b1" } });
    assert.deepEqual(post.body, { member: false });
    assert.equal(db.read("founderCircle/u1"), undefined);
  });
  test("a Founder sees the session and recordings", async () => {
    const db = fakeDb({ "accounts/u1": founder, [CIRCLE_DOC]: { nextSession: { at: NOW + HOUR, minutes: 60, topic: "Q&A" }, recordings: [{ title: "Sesi 1", url: "https://youtu.be/a", at: NOW - 30 * 24 * HOUR }] } });
    const res = await call(db);
    assert.equal(res.body.member, true);
    assert.equal(res.body.session.topic, "Q&A");
    assert.equal(res.body.recordings.length, 1);
    assert.equal(res.body.review, null);
  });
  test("asking for the review: own brand only, once, and the team is told", async () => {
    const db = fakeDb({ "accounts/u1": founder, "brands/b1": { ownerId: "u1", name: "Kopi Pagi" }, "brands/b2": { ownerId: "someone", name: "Bukan" } });
    const sent = [];
    const notify = async (note) => { sent.push(note); };
    assert.equal((await call(db, { method: "POST", body: { action: "review", brandId: "b2" }, notify })).statusCode, 404);
    assert.equal((await call(db, { method: "POST", body: { action: "review", brandId: "../accounts/u1" }, notify })).statusCode, 404);
    const ok = await call(db, { method: "POST", body: { action: "review", brandId: "b1", wa: "0812 3456 7890", note: "cek warna" }, notify });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body.review.status, "requested");
    assert.equal(ok.body.review.brandName, "Kopi Pagi");
    assert.equal(db.read("founderCircle/u1").review.wa, "6281234567890");
    assert.equal(db.read("founderCircle/u1").email, "rina@example.com");
    assert.equal(sent.length, 1);
    const again = await call(db, { method: "POST", body: { action: "review", brandId: "b1" }, notify });
    assert.equal(again.statusCode, 409);
    assert.equal(again.body.member, true);
    assert.equal(sent.length, 1);
  });
  test("bedah sign-up and cancel", async () => {
    const db = fakeDb({ "accounts/u1": founder, "brands/b1": { ownerId: "u1", name: "Kopi Pagi" } });
    const on = await call(db, { method: "POST", body: { action: "bedah", on: true, brandId: "b1" } });
    assert.equal(on.body.bedah.brandName, "Kopi Pagi");
    const off = await call(db, { method: "POST", body: { action: "bedah", on: false } });
    assert.equal(off.body.bedah, null);
    assert.equal((await call(db, { method: "POST", body: { action: "nope" } })).statusCode, 400);
  });
});
