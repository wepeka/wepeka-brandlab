// api/team.js on the LOCAL Firebase emulators (auth + firestore) —
// `npm run test:emu` (project demo-brandlab, never a real one). Emails go to
// an array instead of Resend.
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

Object.assign(process.env, {
  BRANDLAB_EMULATOR: "1",
  GCLOUD_PROJECT: "demo-brandlab",
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099",
});
const { adminDb, adminAuth } = await import("../../api/_firebaseAdmin.js");
const { runAction, TeamError } = await import("../../api/team.js");
const { resolvePayer } = await import("../../api/_aiQuota.js");
const { hashToken } = await import("../../api/_team.js");

const DAY = 86400000;
const PROJECT = "demo-brandlab";
let db, auth;
let outbox = [];
let clock = Date.now();
const d = () => ({ db, auth, send: async (m) => (outbox.push(m), { ok: true }), now: () => clock, origin: "http://localhost:8743" });
const as = (uid) => ({ uid });
const tokenOf = (link) => decodeURIComponent(link.split("#/undangan/")[1]);
async function expectError(promise, code) {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof TeamError, `expected TeamError ${code}, got ${e}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`expected ${code}`);
}

// Signs in on the Auth emulator's REST API, as the app would: true when
// this email + password gets in.
async function canSignIn(email, password) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.ok;
}

async function wipe() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}
async function user(uid, email, extra = {}) {
  await auth.createUser({ uid, email, password: "brandlab-dev-123", displayName: uid, emailVerified: true, ...extra });
}
async function seed({ plan = "pro", ownerExtra = {} } = {}) {
  await wipe();
  await user("owen", "owen@test.local");
  await user("rina", "rina@test.local");
  await user("budi", "budi@test.local");
  await user("unv", "unv@test.local", { emailVerified: false });
  await db.doc("accounts/owen").set({ uid: "owen", plan, status: "active", brandLimit: 3, subscriptionExpiresAt: clock + 30 * DAY, displayName: "Owen", ...ownerExtra });
  await db.doc("brands/b1").set({
    id: "b1", ownerId: "owen", name: "Kopi Pagi", archived: false, createdAt: 1,
    instagram: { username: "kopipagi", igUserId: "1", accessToken: "IG-SECRET" }, chatSessions: [{ id: "s1" }],
  });
  await db.doc("brands/b2").set({ id: "b2", ownerId: "owen", name: "Batik Rara", archived: false, createdAt: 1 });
}

before(() => {
  db = adminDb();
  auth = adminAuth();
});
beforeEach(() => {
  outbox = [];
  clock = Date.now();
});

describe("invite → accept", () => {
  test("the owner invites; the email carries the link; the preview shows a masked email", async () => {
    await seed();
    const out = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: " Rina@Test.local ", role: "editor" });
    assert.equal(out.emailSent, true);
    assert.match(out.link, /^http:\/\/localhost:8743\/#\/undangan\//);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "rina@test.local");
    assert.ok(outbox[0].text.includes(out.link));
    const inv = (await db.doc(`invites/${out.inviteId}`).get()).data();
    assert.equal(inv.status, "pending");
    assert.equal(inv.token, undefined, "the raw token is never stored");
    const p = await runAction(d(), "preview", null, { token: tokenOf(out.link) });
    assert.deepEqual([p.state, p.ownerName, p.emailMasked, p.brandNames], ["pending", "Owen", "r***@test.local", ["Kopi Pagi"]]);
  });

  test("the invited, verified email joins; tokens and the owner's chats leave the brand doc", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" });
    const out = await runAction(d(), "accept", as("rina"), { token: tokenOf(link) });
    assert.deepEqual(out.brandIds, ["b1"]);
    const b = (await db.doc("brands/b1").get()).data();
    assert.deepEqual(b.memberIds, ["rina"]);
    assert.equal(b.members.rina.role, "editor");
    assert.equal(b.members.rina.email, "rina@test.local");
    assert.equal(b.instagram.accessToken, undefined, "token off the brand doc");
    assert.equal(b.instagram.username, "kopipagi");
    assert.equal(b.chatSessions, undefined);
    assert.equal((await db.doc("brands/b1/private/integrations").get()).data().instagram.accessToken, "IG-SECRET");
    assert.deepEqual((await db.doc("brands/b1/people/owen").get()).data().chatSessions, [{ id: "s1" }]);
    const m = (await db.doc("memberships/rina").get()).data();
    assert.deepEqual(m.ownerIds, ["owen"]);
    assert.equal(m.brands.b1.role, "editor");
    // Accepting twice is harmless; the link is used up for anyone else.
    assert.equal((await runAction(d(), "accept", as("rina"), { token: tokenOf(link) })).already, true);
    await expectError(runAction(d(), "accept", as("budi"), { token: tokenOf(link) }), "used");
  });

  test("a forwarded link is refused for another email, and for an unverified one", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "viewer" });
    await expectError(runAction(d(), "accept", as("budi"), { token: tokenOf(link) }), "email-mismatch");
    const two = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "unv@test.local", role: "viewer" });
    await expectError(runAction(d(), "accept", as("unv"), { token: tokenOf(two.link) }), "unverified");
    assert.equal((await db.doc("brands/b1").get()).data().memberIds, undefined);
  });

  test("an expired or revoked invite stops working; rotate gives a fresh link", async () => {
    await seed();
    const first = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" });
    clock += 8 * DAY;
    await expectError(runAction(d(), "accept", as("rina"), { token: tokenOf(first.link) }), "expired");
    const fresh = await runAction(d(), "rotate", as("owen"), { inviteId: first.inviteId });
    await expectError(runAction(d(), "accept", as("rina"), { token: tokenOf(first.link) }), "not-found");
    await runAction(d(), "revoke", as("owen"), { inviteId: fresh.inviteId });
    await expectError(runAction(d(), "accept", as("rina"), { token: tokenOf(fresh.link) }), "revoked");
  });

  test("only the owner manages; nobody invites themselves or into a brand they don't own", async () => {
    await seed();
    await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "owen@test.local", role: "editor" }), "self");
    await expectError(runAction(d(), "invite", as("budi"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" }), "owner-inactive");
    await db.doc("accounts/budi").set({ uid: "budi", plan: "pro", status: "active", subscriptionExpiresAt: clock + DAY });
    await expectError(runAction(d(), "invite", as("budi"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" }), "not-found");
    await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "owner" }), "bad-request");
    await expectError(runAction(d(), "invite", null, { brandIds: ["b1"], email: "rina@test.local", role: "editor" }), "auth");
  });
});

describe("seats and plan", () => {
  test("every plan has 3 seats: pending invites take them; inviting the same email again replaces the link", async () => {
    await seed({ plan: "starter" });
    const one = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" });
    for (const email of ["x1@test.local", "x2@test.local"]) await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email, role: "viewer" });
    const e = await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "budi@test.local", role: "editor" }), "seats-full");
    assert.equal(e.extra.limit, 3);
    const again = await runAction(d(), "invite", as("owen"), { brandIds: ["b1", "b2"], email: "rina@test.local", role: "editor" });
    assert.equal((await db.doc(`invites/${one.inviteId}`).get()).data().status, "revoked");
    await runAction(d(), "accept", as("rina"), { token: tokenOf(again.link) });
    // On the team already: sharing another brand with her takes no new seat.
    assert.deepEqual((await db.doc("brands/b2").get()).data().memberIds, ["rina"]);
  });
  async function teamOfFour(extra = {}) {
    await seed({ ownerExtra: { teamSeatSlotsUntil: [clock + DAY], ...extra } });
    await user("dian", "dian@test.local");
    await user("eka", "eka@test.local");
    for (const [uid, email] of [["rina", "rina@test.local"], ["budi", "budi@test.local"], ["dian", "dian@test.local"], ["eka", "eka@test.local"]]) {
      clock += 1000;
      const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email, role: "editor" });
      await runAction(d(), "accept", as(uid), { token: tokenOf(link) });
    }
  }
  const flags = async () => Object.fromEntries(Object.entries((await db.doc("brands/b1").get()).data().members).map(([uid, m]) => [uid, !!m.seatPaused]));
  test("a lapsed extra seat pauses the newest member (not removed); a new seat or a free seat brings them back", async () => {
    await teamOfFour();
    await db.doc("accounts/owen").update({ teamSeatSlotsUntil: [clock - 1] });
    assert.equal((await runAction(d(), "sync", as("owen"), {})).paused, 1);
    assert.deepEqual(await flags(), { rina: false, budi: false, dian: false, eka: true });
    assert.deepEqual(await resolvePayer(db, "eka", "b1"), { error: "seat-paused" });
    assert.deepEqual(await resolvePayer(db, "rina", "b1"), { payerUid: "owen", team: true });
    // Full: no new invites while someone is paused.
    await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" }), "seats-full");
    await db.doc("accounts/owen").update({ teamSeatSlotsUntil: [clock + DAY] });
    await runAction(d(), "sync", as("owen"), {});
    assert.equal((await flags()).eka, false);
    await db.doc("accounts/owen").update({ teamSeatSlotsUntil: [clock - 1] });
    await runAction(d(), "sync", as("owen"), {});
    assert.equal((await flags()).eka, true);
    await runAction(d(), "remove", as("owen"), { memberUid: "rina" });
    assert.deepEqual(await flags(), { budi: false, dian: false, eka: false });
  });
  test("the daily job pauses a team whose extra seat ran out", async () => {
    await teamOfFour();
    await db.doc("accounts/owen").update({ teamSeatSlotsUntil: [Date.now() - 1] });
    process.env.CRON_SECRET = "test-cron";
    const { default: cron } = await import("../../api/cron/check-expiry.js");
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await cron({ headers: { authorization: "Bearer test-cron" }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.seatOwners, 1);
    const members = (await db.doc("brands/b1").get()).data().members;
    assert.equal(members.rina.seatPaused, undefined);
    assert.equal(members.eka.seatPaused, true);
  });
  test("an owner whose plan lapsed can't invite, and a pending invite can't be accepted", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" });
    await db.doc("accounts/owen").update({ subscriptionExpiresAt: clock - 1 });
    await expectError(runAction(d(), "accept", as("rina"), { token: tokenOf(link) }), "owner-inactive");
    await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "budi@test.local", role: "editor" }), "owner-inactive");
    // Nor keep an old invite alive with new links.
    const pending = (await db.collection("invites").where("ownerId", "==", "owen").get()).docs.find((x) => x.data().status === "pending");
    await expectError(runAction(d(), "rotate", as("owen"), { inviteId: pending.id }), "owner-inactive");
  });
});

describe("6-digit code", () => {
  const codeIn = (mail) => mail.subject.match(/(\d{6})/)[1];
  test("signed out: the code creates a verified account and joins", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    const start = await runAction(d(), "code-start", null, { token: tokenOf(link) });
    assert.equal(start.emailMasked, "s***@test.local");
    const code = codeIn(outbox.at(-1));
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(link), code, password: "123" }), "weak-password");
    const out = await runAction(d(), "code-finish", null, { token: tokenOf(link), code, name: "Sari", password: "rahasia-123" });
    assert.equal(out.created, true);
    const sari = await auth.getUserByEmail("sari@test.local");
    assert.equal(sari.emailVerified, true);
    assert.equal((await db.doc("brands/b1").get()).data().members[sari.uid].name, "Sari");
  });
  test("wrong codes count; five wrong locks it; a resend waits a minute", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    await runAction(d(), "code-start", null, { token: tokenOf(link) });
    await expectError(runAction(d(), "code-start", null, { token: tokenOf(link) }), "too-soon");
    const code = codeIn(outbox.at(-1));
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expectError(runAction(d(), "code-finish", null, { token: tokenOf(link), code: wrong, password: "rahasia-123" }), "code-wrong");
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(link), code, password: "rahasia-123" }), "code-locked");
  });
  test("an account made ahead of time on someone's email (unverified) is taken over by the code", async () => {
    await seed();
    // Someone else registered sari@ first, with a password only they know.
    await auth.createUser({ uid: "squat", email: "sari@test.local", password: "orang-lain-123", emailVerified: false });
    // …and tied their own Google account to it as a second way in.
    await auth.updateUser("squat", { providerToLink: { providerId: "google.com", uid: "g-orang-lain", email: "orang.lain@gmail.com" } });
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    await runAction(d(), "code-start", null, { token: tokenOf(link) });
    const code = codeIn(outbox.at(-1));
    // Her password must be usable before the code is spent on it.
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(link), code, password: "123" }), "weak-password");
    const before = Date.now();
    const out = await runAction(d(), "code-finish", null, { token: tokenOf(link), code, name: "Sari", password: "rahasia-123" });
    assert.equal(out.created, true);
    const sari = await auth.getUser("squat");
    assert.equal(sari.emailVerified, true);
    assert.equal(sari.displayName, "Sari");
    assert.deepEqual(sari.providerData.map((p) => p.providerId), ["password"], "the other Google sign-in is unlinked");
    assert.ok(new Date(sari.tokensValidAfterTime).getTime() >= before - 1000, "old sign-ins ended");
    assert.equal(await canSignIn("sari@test.local", "orang-lain-123"), false, "the first password no longer works");
    assert.equal(await canSignIn("sari@test.local", "rahasia-123"), true);
    assert.equal((await db.doc("brands/b1").get()).data().members.squat.role, "editor");
  });
  test("a verified account is left exactly as it is", async () => {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "budi@test.local", role: "viewer" });
    await runAction(d(), "code-start", null, { token: tokenOf(link) });
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(link), code: codeIn(outbox.at(-1)), password: "baru-sekali-123" }), "account-exists");
    assert.equal(await canSignIn("budi@test.local", "brandlab-dev-123"), true);
    assert.equal(await canSignIn("budi@test.local", "baru-sekali-123"), false);
  });
  test("five codes a day to one email, however many new links", async () => {
    await seed();
    const { inviteId, link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    for (let i = 0; i < 5; i++) {
      await runAction(d(), "code-start", null, { token: tokenOf(link) });
      clock += 61_000;
    }
    await expectError(runAction(d(), "code-start", null, { token: tokenOf(link) }), "code-limit");
    const fresh = await runAction(d(), "rotate", as("owen"), { inviteId });
    await expectError(runAction(d(), "code-start", null, { token: tokenOf(fresh.link) }), "code-limit");
    clock += DAY;
    await runAction(d(), "code-start", null, { token: tokenOf(fresh.link) });
  });
  test("ten wrong codes a day for one email: a new link doesn't start the count over", async () => {
    await seed();
    const first = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    const wrongFor = (code) => (code === "000000" ? "111111" : "000000");
    await runAction(d(), "code-start", null, { token: tokenOf(first.link) });
    let code = codeIn(outbox.at(-1));
    for (let i = 0; i < 5; i++) await expectError(runAction(d(), "code-finish", null, { token: tokenOf(first.link), code: wrongFor(code), password: "rahasia-123" }), "code-wrong");
    const second = await runAction(d(), "rotate", as("owen"), { inviteId: first.inviteId });
    clock += 61_000;
    await runAction(d(), "code-start", null, { token: tokenOf(second.link) });
    code = codeIn(outbox.at(-1));
    for (let i = 0; i < 5; i++) await expectError(runAction(d(), "code-finish", null, { token: tokenOf(second.link), code: wrongFor(code), password: "rahasia-123" }), "code-wrong");
    // Even the right code waits for tomorrow now.
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(second.link), code, password: "rahasia-123" }), "code-locked-day");
    clock += DAY;
    await runAction(d(), "code-start", null, { token: tokenOf(second.link) });
    const out = await runAction(d(), "code-finish", null, { token: tokenOf(second.link), code: codeIn(outbox.at(-1)), name: "Sari", password: "rahasia-123" });
    assert.equal(out.created, true);
  });
  test("ten team emails a day per owner: past that the invite is still made, its link shared instead", async () => {
    await seed();
    for (let i = 0; i < 10; i++) {
      const out = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
      assert.equal(out.emailSent, true);
    }
    const sentBefore = outbox.length;
    const late = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "sari@test.local", role: "editor" });
    assert.equal(late.emailSent, false);
    assert.equal(late.mailLimit, true);
    assert.match(late.link, /#\/undangan\//);
    clock += 61_000;
    const resend = await runAction(d(), "rotate", as("owen"), { inviteId: late.inviteId, send: true });
    assert.equal(resend.mailLimit, true);
    await expectError(runAction(d(), "code-start", null, { token: tokenOf(resend.link) }), "mail-limit");
    assert.equal(outbox.length, sentBefore, "nothing more went out");
    clock += DAY;
    assert.equal((await runAction(d(), "rotate", as("owen"), { inviteId: resend.inviteId, send: true })).emailSent, true);
  });
  test("an unverified account signed in verifies with the code; an existing account is sent to sign in", async () => {
    await seed();
    const a = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "unv@test.local", role: "viewer" });
    await runAction(d(), "code-start", null, { token: tokenOf(a.link) });
    const out = await runAction(d(), "code-finish", as("unv"), { token: tokenOf(a.link), code: codeIn(outbox.at(-1)) });
    assert.equal(out.verified, true);
    assert.equal((await db.doc("brands/b1").get()).data().members.unv.role, "viewer");
    const b = await runAction(d(), "invite", as("owen"), { brandIds: ["b2"], email: "budi@test.local", role: "viewer" });
    await runAction(d(), "code-start", null, { token: tokenOf(b.link) });
    await expectError(runAction(d(), "code-finish", null, { token: tokenOf(b.link), code: codeIn(outbox.at(-1)), password: "rahasia-123" }), "account-exists");
  });
});

describe("role, remove, leave", () => {
  async function teamOfTwo() {
    await seed();
    const { link } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1", "b2"], email: "rina@test.local", role: "editor" });
    await runAction(d(), "accept", as("rina"), { token: tokenOf(link) });
    await db.doc("brainstorms/t-rina").set({ id: "t-rina", ownerId: "rina", brandId: "b1", messages: [] });
    await db.doc("brainstorms/t-rina-own").set({ id: "t-rina-own", ownerId: "rina", brandId: "rina-brand", messages: [] });
    await db.doc("brands/b1/people/rina").set({ uid: "rina", brandId: "b1", chatSessions: [] });
  }
  test("the owner changes a role on one brand", async () => {
    await teamOfTwo();
    await runAction(d(), "role", as("owen"), { brandId: "b1", memberUid: "rina", role: "viewer" });
    assert.equal((await db.doc("brands/b1").get()).data().members.rina.role, "viewer");
    assert.equal((await db.doc("brands/b2").get()).data().members.rina.role, "editor");
    assert.equal((await db.doc("memberships/rina").get()).data().brands.b1.role, "viewer");
    await expectError(runAction(d(), "role", as("rina"), { brandId: "b1", memberUid: "rina", role: "editor" }), "not-owner");
  });
  test("removing takes her off, deletes her chats and people doc there, keeps her own elsewhere", async () => {
    await teamOfTwo();
    await runAction(d(), "remove", as("owen"), { memberUid: "rina", brandIds: ["b1"] });
    const b1 = (await db.doc("brands/b1").get()).data();
    assert.deepEqual(b1.memberIds, []);
    assert.equal(b1.members.rina, undefined);
    assert.equal((await db.doc("brainstorms/t-rina").get()).exists, false);
    assert.equal((await db.doc("brainstorms/t-rina-own").get()).exists, true);
    assert.equal((await db.doc("brands/b1/people/rina").get()).exists, false);
    assert.deepEqual(Object.keys((await db.doc("memberships/rina").get()).data().brands), ["b2"]);
    await runAction(d(), "remove", as("owen"), { memberUid: "rina" });
    assert.equal((await db.doc("memberships/rina").get()).exists, false);
  });
  test("a member leaves by themselves", async () => {
    await teamOfTwo();
    const out = await runAction(d(), "leave", as("rina"), {});
    assert.deepEqual(out.brandIds.sort(), ["b1", "b2"]);
    assert.equal((await db.doc("memberships/rina").get()).exists, false);
    assert.deepEqual((await db.doc("brands/b2").get()).data().memberIds, []);
  });
  test("access off: off the brand for now, still on the team with a seat; on: back as before", async () => {
    await teamOfTwo();
    await runAction(d(), "access", as("owen"), { brandId: "b1", memberUid: "rina", enabled: false });
    let b1 = (await db.doc("brands/b1").get()).data();
    assert.deepEqual(b1.memberIds, []);
    assert.equal(b1.members.rina.disabled, true);
    assert.equal((await db.doc("memberships/rina").get()).data().brands.b1.disabled, true);
    assert.equal((await db.doc("brainstorms/t-rina").get()).exists, true, "her chats stay");
    assert.equal((await db.doc("brands/b1/people/rina").get()).exists, true);
    assert.deepEqual(await resolvePayer(db, "rina", "b1"), { error: "disabled" });
    assert.deepEqual(await resolvePayer(db, "rina", "b2"), { payerUid: "owen", team: true }, "other brands untouched");
    // Still a seat: with her and two invites waiting, the 3 seats are full.
    for (const email of ["x1@test.local", "x2@test.local"]) await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email, role: "viewer" });
    await expectError(runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "budi@test.local", role: "editor" }), "seats-full");
    // The index rebuild keeps it off.
    await runAction(d(), "sync", as("owen"), {});
    assert.equal((await db.doc("memberships/rina").get()).data().brands.b1.disabled, true);
    await expectError(runAction(d(), "access", as("rina"), { brandId: "b1", memberUid: "rina", enabled: true }), "not-owner");
    await runAction(d(), "access", as("owen"), { brandId: "b1", memberUid: "rina", enabled: true });
    b1 = (await db.doc("brands/b1").get()).data();
    assert.deepEqual(b1.memberIds, ["rina"]);
    assert.equal(b1.members.rina.disabled, undefined);
    assert.equal((await db.doc("memberships/rina").get()).data().brands.b1.disabled, undefined);
    assert.deepEqual(await resolvePayer(db, "rina", "b1"), { payerUid: "owen", team: true });
  });
  test("someone whose access is off can still be removed, and can leave", async () => {
    await teamOfTwo();
    await runAction(d(), "access", as("owen"), { brandId: "b1", memberUid: "rina", enabled: false });
    await runAction(d(), "remove", as("owen"), { memberUid: "rina", brandIds: ["b1"] });
    assert.equal((await db.doc("brands/b1").get()).data().members.rina, undefined);
    assert.deepEqual(Object.keys((await db.doc("memberships/rina").get()).data().brands), ["b2"]);
    await runAction(d(), "access", as("owen"), { brandId: "b2", memberUid: "rina", enabled: false });
    await runAction(d(), "leave", as("rina"), {});
    assert.equal((await db.doc("brands/b2").get()).data().members.rina, undefined);
    assert.equal((await db.doc("memberships/rina").get()).exists, false);
  });
  test("sync rebuilds the index from the brands", async () => {
    await teamOfTwo();
    await db.doc("memberships/rina").delete();
    await runAction(d(), "sync", as("owen"), {});
    assert.deepEqual(Object.keys((await db.doc("memberships/rina").get()).data().brands).sort(), ["b1", "b2"]);
  });
  test("an invite id that isn't the owner's can't be rotated or revoked", async () => {
    await seed();
    const { inviteId } = await runAction(d(), "invite", as("owen"), { brandIds: ["b1"], email: "rina@test.local", role: "editor" });
    await expectError(runAction(d(), "revoke", as("rina"), { inviteId }), "not-owner");
    await expectError(runAction(d(), "rotate", as("rina"), { inviteId: hashToken("x") }), "not-found");
  });
});
