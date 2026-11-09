import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { seal, unseal, signState, readState, authUrl, finishConnect, runDrive, redirectUri, driveConfigured, DRIVE_SCOPE, clientBrandIds, refreshAccess } from "../api/_drive.js";

const env = { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "secret", TOKEN_VAULT_KEY: crypto.randomBytes(32).toString("base64") };

// driveConnections/{uid} in memory, shaped like the Admin SDK's doc refs.
function fakeDb() {
  const docs = new Map();
  return {
    docs,
    doc: (path) => ({
      get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
      set: async (v) => { docs.set(path, v); },
      delete: async () => { docs.delete(path); },
    }),
  };
}
const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
const googleSays = (json, status = 200) => async () => ({ ok: status < 300, status, json: async () => json });

test("Drive stays off until all three keys are set, the vault key being 32 bytes", () => {
  assert.equal(driveConfigured(env), true);
  assert.equal(driveConfigured({ ...env, TOKEN_VAULT_KEY: "" }), false);
  assert.equal(driveConfigured({ ...env, TOKEN_VAULT_KEY: Buffer.from("short").toString("base64") }), false);
});

test("the refresh token is stored sealed and only opens with the same key", () => {
  const box = seal("1//refresh", env);
  assert.ok(!box.includes("refresh"));
  assert.equal(unseal(box, env), "1//refresh");
  assert.throws(() => unseal(box, { ...env, TOKEN_VAULT_KEY: crypto.randomBytes(32).toString("base64") }));
});

test("state: signed, short-lived, and only lands back on an app route", () => {
  const s = signState({ uid: "u1", ret: "#/brand/b1/content/calendar" }, { env, now: 1000 });
  assert.deepEqual(readState(s, { env, now: 2000 }), { uid: "u1", ret: "#/brand/b1/content/calendar" });
  assert.equal(readState(s, { env, now: 1000 + 11 * 60 * 1000 }), null, "expired");
  const [body] = s.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "someone-else", x: 9e15 })).toString("base64url");
  assert.equal(readState(`${forged}.${s.split(".")[1]}`, { env, now: 2000 }), null, "tampered");
  assert.equal(readState(signState({ uid: "u1", ret: "https://evil.example" }, { env, now: 1000 }), { env, now: 2000 }).ret, "", "no off-site return");
  assert.ok(body);
});

test("consent asks for drive.file only, offline, back to this host", () => {
  const u = new URL(authUrl({ uid: "u1", ret: "#/", email: "a@b.c", redirect: "https://brandlab.wepeka.com/api/drive/callback" }, { env }));
  assert.equal(u.searchParams.get("scope"), `${DRIVE_SCOPE} openid email`);
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("login_hint"), "a@b.c");
  assert.equal(redirectUri({ headers: { host: "brandlab.wepeka.com" } }), "https://brandlab.wepeka.com/api/drive/callback");
  assert.equal(redirectUri({ headers: { host: "127.0.0.1:8743" } }), "http://127.0.0.1:8743/api/drive/callback");
});

test("callback: saves the sealed token, or sends the person back without one", async () => {
  const db = fakeDb();
  const state = signState({ uid: "u1", ret: "#/brand/b1/content/calendar" }, { env });
  const redirect = "https://brandlab.wepeka.com/api/drive/callback";
  const ok = await finishConnect({ code: "c", state, redirect, db, env, fetchImpl: googleSays({ refresh_token: "1//r", scope: `${DRIVE_SCOPE} openid email`, id_token: idToken("rani@x.id") }) });
  assert.deepEqual(ok, { location: "/#/brand/b1/content/calendar", result: "ok" });
  const saved = db.docs.get("driveConnections/u1");
  assert.equal(saved.email, "rani@x.id");
  assert.equal(unseal(saved.refresh, env), "1//r");

  const unticked = await finishConnect({ code: "c", state, redirect, db: fakeDb(), env, fetchImpl: googleSays({ refresh_token: "1//r", scope: "openid email" }) });
  assert.equal(unticked.result, "scope", "Drive box unticked on Google's screen");
  const cancelled = await finishConnect({ error: "access_denied", state, redirect, db: fakeDb(), env });
  assert.equal(cancelled.result, "cancelled");
  const stale = await finishConnect({ code: "c", state: "nope", redirect, db: fakeDb(), env });
  assert.deepEqual(stale, { location: "/#/", result: "expired" });
});

test("token: a fresh access token from the stored one; a revoked connection is cleared", async () => {
  const db = fakeDb();
  db.docs.set("driveConnections/u1", { refresh: seal("1//r", env), email: "rani@x.id" });
  let sent;
  const out = await runDrive({ action: "token", uid: "u1", db, env, fetchImpl: async (url, init) => { sent = init.body; return { ok: true, status: 200, json: async () => ({ access_token: "ya29", expires_in: 3599 }) }; } });
  assert.deepEqual(out, { accessToken: "ya29", expiresIn: 3599, email: "rani@x.id" });
  assert.match(sent, /refresh_token=1%2F%2Fr/);

  await assert.rejects(runDrive({ action: "token", uid: "u1", db, env, fetchImpl: googleSays({ error: "invalid_grant" }, 400) }), { code: "reconnect" });
  assert.equal(db.docs.has("driveConnections/u1"), false);
  await assert.rejects(runDrive({ action: "token", uid: "u2", db, env }), { code: "not-connected", status: 404 });
});

test("disconnect revokes at Google and forgets the token", async () => {
  const db = fakeDb();
  db.docs.set("driveConnections/u1", { refresh: seal("1//r", env) });
  const calls = [];
  await runDrive({ action: "disconnect", uid: "u1", db, env, fetchImpl: async (url) => { calls.push(url); return { ok: true }; } });
  assert.match(calls[0], /oauth2\.googleapis\.com\/revoke\?token=1%2F%2Fr/);
  assert.equal(db.docs.has("driveConnections/u1"), false);
});

// A brand's client ("Klien") connecting their own Drive (2026-11-09).
test("a client's Drive: their brands say whose Drive gets the cuts, and forget it on disconnect", async () => {
  const admin = (uid) => uid === "wepeka";
  assert.deepEqual(clientBrandIds({ brands: { b1: { ownerId: "wepeka", role: "viewer", klien: true }, b2: { ownerId: "wepeka", role: "viewer" }, b3: { ownerId: "x", klien: true }, b4: { ownerId: "wepeka", klien: true, disabled: true } } }, admin), ["b1"]);
  const db = fakeDb();
  const updates = [];
  const base = db.doc;
  db.doc = (path) => ({ ...base(path), update: async (v) => { updates.push([path, v]); db.docs.set(path, { ...(db.docs.get(path) || {}), ...v }); } });
  db.docs.set("memberships/rina", { brands: { b1: { ownerId: "wepeka", role: "viewer", klien: true } } });
  db.docs.set("brands/b1", { ownerId: "wepeka" });
  const fetchImpl = googleSays({ access_token: "a", refresh_token: "1//r", scope: `${DRIVE_SCOPE} openid email`, id_token: idToken("admin@quatro.test") });
  const out = await finishConnect({ code: "c", state: signState({ uid: "rina", ret: "#/brand/b1/content/antrean" }, { env, now: 1000 }), redirect: "x", db, env, fetchImpl, now: 2000, isAdminUid: admin });
  assert.equal(out.result, "ok");
  assert.equal(out.location, "/#/brand/b1/content/antrean");
  assert.deepEqual(db.docs.get("brands/b1").clientDrive, { uid: "rina", email: "admin@quatro.test", at: 2000 });
  assert.ok(!JSON.stringify(updates).includes("1//r"), "the secret never lands on the brand");
  await runDrive({ action: "disconnect", uid: "rina", db, env, fetchImpl: async () => ({ ok: true }), isAdminUid: admin });
  assert.equal(db.docs.get("brands/b1").clientDrive, null);
  const access = await refreshAccess(seal("1//r", env), { env, fetchImpl: googleSays({ access_token: "fresh", expires_in: 1200 }) });
  assert.deepEqual(access, { accessToken: "fresh", expiresIn: 1200 });
});
