// One-off check (not part of npm test): the real api/review and api/drive
// handlers end to end, with an in-memory Firestore, a fake Google (token
// endpoint + Drive REST) and Firebase auth replaced. Run with
//   node --experimental-test-module-mocks --test tests/review-api.check.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const ADMIN = "iSwfTtIQm6VkYoHFbI6wl7BzBF53";
Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "sec", TOKEN_VAULT_KEY: crypto.randomBytes(32).toString("base64") });

// ---- Firestore (Admin SDK shape, the parts the handlers use) ----
const docs = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== "object") o[p] = {}; o = o[p]; }
  o[parts[parts.length - 1]] = value;
}
const ref = (path) => ({
  path,
  id: path.split("/").pop(),
  get: async () => ({ exists: docs.has(path), id: path.split("/").pop(), data: () => clone(docs.get(path)) }),
  set: async (v, opt) => { docs.set(path, opt?.merge ? { ...(docs.get(path) || {}), ...clone(v) } : clone(v)); },
  update: async (v) => {
    if (!docs.has(path)) throw new Error(`no doc ${path}`);
    const cur = docs.get(path);
    for (const [k, val] of Object.entries(v)) setPath(cur, k, clone(val));
  },
  delete: async () => { docs.delete(path); },
});
const db = {
  doc: ref,
  collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
  runTransaction: async (fn) => {
    const writes = [];
    const out = await fn({ get: (r) => r.get(), update: (r, v) => writes.push([r, v]) });
    for (const [r, v] of writes) await r.update(v);
    return out;
  },
};
const deleted = [];
mock.module("../api/_firebaseAdmin.js", {
  namedExports: {
    adminDb: () => db,
    adminBucket: async () => ({ file: (p) => ({ delete: async () => { deleted.push(p); } }) }),
    requireAuth: async (req) => {
      const uid = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
      if (!uid) throw Object.assign(new Error("auth"), { status: 401 });
      return { uid, email: `${uid}@x.test` };
    },
  },
});

// ---- Google: OAuth token endpoint + a Drive in memory ----
const drive = new Map([["root", { id: "root", mimeType: "application/vnd.google-apps.folder" }]]);
let n = 0;
let revoked = false;
const json = (status, body) => ({ status, ok: status < 300, headers: new Map(), json: async () => body });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.host === "oauth2.googleapis.com") {
    if (revoked) return json(400, { error: "invalid_grant" });
    return json(200, { access_token: "tok", expires_in: 3600 });
  }
  if (init.headers?.authorization !== "Bearer tok") return json(401, {});
  const m = u.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
  const method = init.method || "GET";
  if (m) {
    const f = drive.get(decodeURIComponent(m[1]));
    if (!f) return json(404, {});
    if (method === "DELETE") { drive.delete(f.id); return json(204, {}); }
    if (method === "PATCH") { Object.assign(f, JSON.parse(init.body)); return json(200, { id: f.id }); }
    return json(200, f);
  }
  if (method === "POST") { const id = `fold${String(++n).padStart(8, "0")}`; drive.set(id, { id, ...JSON.parse(init.body) }); return json(200, { id }); }
  const q = u.searchParams.get("q");
  const name = q.match(/name='([^']*)'/)[1], parent = q.match(/and '([^']*)' in parents/)[1];
  return json(200, { files: [...drive.values()].filter((f) => f.name === name && f.parents?.includes(parent)).map((f) => ({ id: f.id })) });
};
// What the owner's browser does with the key: a resumable upload into the folder.
const browserUpload = (folderId, name) => { const id = `file${String(++n).padStart(8, "0")}`; drive.set(id, { id, name, size: "100", mimeType: "video/mp4", parents: [folderId] }); return id; };

const review = (await import("../api/review/[action].js")).default;
const driveApi = (await import("../api/drive/[action].js")).default;
const { seal } = await import("../api/_drive.js");
async function call(handler, action, uid, body = {}) {
  let status = 200, out = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(o) { out = o; return this; }, end() { return this; } };
  await handler({ method: "POST", query: { action }, headers: uid ? { authorization: `Bearer ${uid}` } : {}, body }, res);
  return { status, ...out };
}

// ---- Data: Wepeka's brand with a client (Rina) and a plain viewer (Sari) ----
docs.set("brands/q", { ownerId: ADMIN, name: "Quatro (New)", members: { rina: { role: "viewer", klien: true, name: "Rina (Quatro)", email: "rina@q.id" }, sari: { role: "viewer", name: "Sari" }, dodi: { role: "editor", name: "Dodi" } }, memberIds: ["rina", "sari", "dodi"] });
docs.set("content/c1", { ownerId: ADMIN, brandId: "q", title: "Kenalan Quatro", status: "editing", posting: { versions: [{ id: "a", n: 0, status: "pending", kind: "video" }, { id: "b", n: 1, status: "pending", kind: "video" }], notes: [] } });
docs.set("memberships/rina", { ownerIds: [ADMIN], brands: { q: { ownerId: ADMIN, role: "viewer", klien: true } } });
docs.set("memberships/sari", { ownerIds: [ADMIN], brands: { q: { ownerId: ADMIN, role: "viewer" } } });
const files = [{ name: "v1.mp4", type: "video/mp4", size: 100 }];

test("end to end: connect, send two cuts, client notes, approves; older cut leaves their Drive", async () => {
  // Nobody signed in, or not Wepeka, for the owner's actions.
  assert.equal((await call(review, "upload", null, { contentId: "c1" })).status, 401);
  assert.equal((await call(review, "upload", "rina", { contentId: "c1", versionId: "a", files })).error, "private");
  // No client Drive yet.
  const off = await call(review, "upload", ADMIN, { contentId: "c1", versionId: "a", code: "QN-1", files });
  assert.deepEqual([off.status, off.error], [409, "drive-off"]);

  // Drive: a plain viewer may not use it; the client may.
  assert.equal((await call(driveApi, "token", "sari")).error, "private");
  assert.equal((await call(driveApi, "token", "rina")).error, "not-connected");
  docs.set("driveConnections/rina", { refresh: seal("1//r"), email: "rina@gmail.test" });
  assert.equal((await call(driveApi, "token", "rina")).accessToken, "tok");
  docs.get("brands/q").clientDrive = { uid: "rina", email: "rina@gmail.test", at: 1 };

  // Cut A: folder made, uploaded "by the browser", sent.
  const up = await call(review, "upload", ADMIN, { contentId: "c1", versionId: "a", code: "QN-1", files });
  assert.equal(up.status, 200);
  assert.deepEqual(up.names, ["QN-1 · Versi pertama.mp4"]);
  assert.equal(drive.get(up.folderId).name, "QN-1 · Kenalan Quatro");
  assert.equal(docs.get("content/c1").posting.clientFolder, up.folderId);
  assert.ok(docs.get("brands/q").clientDrive.folders.rootId, "root and brand folders remembered");
  const fa = browserUpload(up.folderId, up.names[0]);
  const pa = browserUpload(up.folderId, up.poster);
  assert.equal((await call(review, "send", ADMIN, { contentId: "c1", versionId: "a", kind: "video", code: "QN-1", drive: [fa], poster: pa })).status, 200);
  assert.equal(docs.get("content/c1").posting.client.status, "waiting");
  // A file outside the folder is refused.
  const stray = browserUpload("root", "x.mp4");
  assert.equal((await call(review, "send", ADMIN, { contentId: "c1", versionId: "a", drive: [stray] })).error, "missing");

  // Notes: only the client; a plain viewer and an outsider are refused.
  assert.equal((await call(review, "decide", "sari", { contentId: "c1", versionId: "a", verdict: "revise", note: { t: 2, text: "x" } })).error, "not-client");
  assert.equal((await call(review, "decide", "stranger", { contentId: "c1", versionId: "a", verdict: "approve" })).error, "not-client");
  assert.equal((await call(review, "decide", "rina", { contentId: "c1", versionId: "a", verdict: "revise", note: { t: null, text: "Musik kekencangan" } })).status, 200);
  assert.equal((await call(review, "decide", "rina", { contentId: "c1", versionId: "a", verdict: "revise", note: { t: 3.6, text: "Logo kepotong" } })).status, 200);
  const notes = docs.get("content/c1").posting.notes;
  assert.deepEqual(notes.map((x) => [x.t, x.text, x.by, x.name]), [[null, "Musik kekencangan", "client", "Rina (Quatro)"], [3, "Logo kepotong", "client", "Rina (Quatro)"]]);
  assert.equal(docs.get("content/c1").posting.client.status, "revision");

  // Cut B: both stay to compare.
  const up2 = await call(review, "upload", ADMIN, { contentId: "c1", versionId: "b", code: "QN-1", files });
  assert.equal(up2.folderId, up.folderId, "same folder");
  const fb = browserUpload(up2.folderId, up2.names[0]);
  const pb = browserUpload(up2.folderId, up2.poster);
  await call(review, "send", ADMIN, { contentId: "c1", versionId: "b", kind: "video", code: "QN-1", drive: [fb], poster: pb });
  assert.deepEqual(Object.keys(docs.get("content/c1").posting.previews).sort(), ["a", "b"]);
  // Approving the old cut is refused (a newer one went out).
  assert.equal((await call(review, "decide", "rina", { contentId: "c1", versionId: "a", verdict: "approve" })).error, "stale");
  // Approve B: A and its cover deleted from the client's Drive, B named FINAL.
  assert.equal((await call(review, "decide", "rina", { contentId: "c1", versionId: "b", verdict: "approve" })).status, 200);
  assert.ok(!drive.has(fa) && !drive.has(pa), "older cut gone for good");
  assert.equal(drive.get(fb).name, "QN-1 · FINAL.mp4");
  assert.ok(drive.has(pb));
  const p = docs.get("content/c1").posting;
  assert.deepEqual([p.finalId, p.client.status, Object.keys(p.previews)], ["b", "approved", ["b"]]);

  // Posted: the final stays in their Drive.
  assert.equal((await call(review, "clean", ADMIN, { contentId: "c1" })).status, 200);
  assert.ok(drive.has(fb));
  assert.deepEqual(deleted, [], "no Cloud Storage involved");
});

test("footage: the crew sends raw clips into the piece's Footage folder in the client's Drive", async () => {
  docs.set("content/c2", { ownerId: ADMIN, brandId: "q", title: "Mic'd Up Coach Andi", status: "production" });
  const clips = [{ name: "IMG_0412.MOV", type: "video/quicktime", size: 3 * 1024 ** 3 }, { name: "IMG_0413.MOV", type: "video/quicktime", size: 1200 }, { name: "mic.wav", type: "audio/wav", size: 800 }];
  // A plain viewer and an outsider may not; a PDF isn't footage.
  assert.equal((await call(review, "footage-start", "sari", { contentId: "c2", code: "QN-2", files: clips })).error, "not-team");
  assert.equal((await call(review, "footage-start", "stranger", { contentId: "c2", code: "QN-2", files: clips })).error, "not-team");
  assert.equal((await call(review, "footage-start", "rina", { contentId: "c2", code: "QN-2", files: [{ name: "a.pdf", type: "application/pdf", size: 9 }] })).error, "type");

  const st = await call(review, "footage-start", "rina", { contentId: "c2", code: "QN-2", files: clips });
  assert.equal(st.status, 200);
  assert.equal(st.accessToken, "tok");
  assert.deepEqual(st.names, ["IMG_0412.MOV", "IMG_0413.MOV", "mic.wav"]);
  const folder = drive.get(st.folderId);
  assert.equal(folder.name, "Footage");
  assert.equal(drive.get(folder.parents[0]).name, "QN-2 · Mic'd Up Coach Andi", "one folder per piece");
  assert.equal(docs.get("content/c2").footage.folderId, st.folderId);
  assert.equal(docs.get("content/c2").posting.clientFolder, folder.parents[0]);

  const ids = st.names.map((name) => browserUpload(st.folderId, name));
  assert.equal((await call(review, "footage-add", "rina", { contentId: "c2", ids: ids.slice(0, 2) })).added, 2);
  assert.equal((await call(review, "footage-add", "rina", { contentId: "c2", ids })).added, 1, "a clip listed twice counts once");
  let f = docs.get("content/c2").footage;
  assert.deepEqual(f.files.map((x) => [x.name, x.by, x.who]), [["IMG_0412.MOV", "rina", "Rina (Quatro)"], ["IMG_0413.MOV", "rina", "Rina (Quatro)"], ["mic.wav", "rina", "Rina (Quatro)"]]);
  // A file outside the Footage folder is refused.
  const stray = browserUpload("root", "x.mov");
  assert.equal((await call(review, "footage-add", "rina", { contentId: "c2", ids: [stray] })).error, "missing");

  // The editor (Kerja Tim) can send more; the same camera name gets (2); same folder.
  const st2 = await call(review, "footage-start", "dodi", { contentId: "c2", code: "QN-2", files: [{ name: "IMG_0412.MOV", type: "video/quicktime", size: 50 }] });
  assert.deepEqual([st2.folderId, st2.names], [st.folderId, ["IMG_0412 (2).MOV"]]);
  const extra = browserUpload(st2.folderId, st2.names[0]);
  await call(review, "footage-add", "dodi", { contentId: "c2", ids: [extra] });
  assert.equal(docs.get("content/c2").footage.files.at(-1).who, "Dodi");

  // A wrong take goes from the list and from the client's Drive.
  assert.equal((await call(review, "footage-remove", "rina", { contentId: "c2", id: extra })).status, 200);
  assert.ok(!drive.has(extra));
  assert.equal(docs.get("content/c2").footage.files.length, 3);

  // The key to copy them to the Mac: Wepeka only.
  assert.equal((await call(review, "footage-key", "rina", { contentId: "c2" })).error, "private");
  const key = await call(review, "footage-key", ADMIN, { contentId: "c2" });
  assert.deepEqual([key.accessToken, key.folderId], ["tok", st.folderId]);
  // Wepeka itself may send clips too.
  assert.equal((await call(review, "footage-start", ADMIN, { contentId: "c2", code: "QN-2", files: [clips[1]] })).names[0], "IMG_0413 (2).MOV");
});

test("access taken away in Google: the brand forgets the client's Drive", async () => {
  revoked = true;
  const r = await call(review, "upload", ADMIN, { contentId: "c1", versionId: "b", code: "QN-1", files });
  assert.deepEqual([r.status, r.error], [409, "drive-off"]);
  assert.equal(docs.get("brands/q").clientDrive, null);
  assert.ok(!docs.has("driveConnections/rina"));
  revoked = false;
});

test("a client whose access was turned off can't act any more", async () => {
  docs.get("brands/q").members.rina.disabled = true;
  docs.get("content/c1").posting.client = { versionId: "b", status: "waiting" };
  assert.equal((await call(review, "decide", "rina", { contentId: "c1", versionId: "b", verdict: "approve" })).error, "not-client");
});
