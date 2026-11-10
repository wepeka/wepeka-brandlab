import { test } from "node:test";
import assert from "node:assert/strict";
import { applySend, applyDecision, applyClean, applyKeepFinal, driveNames, finalName, checkUploads, clientOn, clientDriveOf } from "../api/_review.js";
import { pieceFolder, checkFiles, deleteFiles, driveName, ROOT_FOLDER } from "../api/_clientDrive.js";

const piece = (posting = {}, extra = {}) => ({
  id: "c1", brandId: "b1", ownerId: "u1", title: "Cara pesan", scheduleDate: "2026-11-05", caption: "Cap", status: "editing",
  posting: { versions: [{ id: "a", n: 0, status: "revision", kind: "video" }, { id: "b", n: 1, status: "pending", kind: "video", changeNote: "Logo dipindah" }], notes: [], time: "19:00", ...posting },
  ...extra,
});
const D = (id) => `${id}-drivefile0`;

test("Drive names: code and cut, slides numbered, the approved one FINAL", () => {
  const v2 = { id: "b", n: 2 };
  assert.deepEqual(driveNames({ code: "QN-1", version: v2, files: [{ name: "v3.mp4", type: "video/mp4", size: 9 }] }), { names: ["QN-1 · Revisi 2.mp4"], poster: "QN-1 · Revisi 2 · sampul.jpg" });
  assert.deepEqual(driveNames({ code: "QN-3", version: { n: 0 }, files: [{ name: "1.jpg", type: "image/jpeg", size: 9 }, { name: "2.PNG", type: "image/png", size: 9 }] }).names, ["QN-3 · Versi pertama · 01.jpg", "QN-3 · Versi pertama · 02.png"]);
  assert.equal(finalName("QN-1", "QN-1 · Revisi 2.mp4"), "QN-1 · FINAL.mp4");
  assert.equal(finalName("QN-3", "QN-3 · Revisi 1 · 02.png"), "QN-3 · FINAL · 02.png");
  assert.throws(() => checkUploads([{ name: "x.exe", type: "application/x-msdownload", size: 9 }]), /type/);
  assert.throws(() => checkUploads([{ name: "big.mp4", type: "video/mp4", size: 301 * 1048576 }]), /size/);
  assert.equal(driveName("Kenalan / Quatro Kids Club."), "Kenalan Quatro Kids Club");
});

test("a cut sent to the client's Drive: older cuts stay to compare, a resend replaces its own copy, old Storage copies go", () => {
  const before = piece({ previews: { a: { drive: [{ id: D("a"), name: "KP-1 · Versi pertama.mp4" }], poster: D("pa"), kind: "video", at: 1 }, old: { paths: ["review/u1/c1/old/01.mp4"] } }, versions: [{ id: "a", n: 0, status: "revision" }, { id: "b", n: 1, status: "pending" }, { id: "old", n: 0, status: "revision" }] });
  const out = applySend(before, { versionId: "b", drive: [{ id: D("b"), name: "KP-1 · Revisi 1.mp4" }], poster: D("pb"), kind: "video", code: "KP-1", now: 5 });
  assert.deepEqual(Object.keys(out.patch.posting.previews).sort(), ["a", "b"]);
  assert.deepEqual(out.patch.posting.previews.b, { drive: [{ id: D("b"), name: "KP-1 · Revisi 1.mp4" }], poster: D("pb"), kind: "video", at: 5 });
  assert.deepEqual(out.removePaths, ["review/u1/c1/old/01.mp4"], "the old Storage copy goes");
  assert.deepEqual(out.removeDrive, []);
  assert.deepEqual(out.patch.posting.client, { versionId: "b", code: "KP-1", status: "waiting", sentAt: 5, decidedAt: 0, name: "" });
  const again = applySend({ ...before, posting: out.patch.posting }, { versionId: "b", drive: [{ id: D("b2"), name: "x" }], kind: "video", code: "KP-1", now: 6 });
  assert.deepEqual(again.removeDrive, [D("b"), D("pb")], "the copy sent before of the same cut");
  assert.throws(() => applySend(before, { versionId: "b", drive: [{ id: "../x" }] }), /files/);
  assert.throws(() => applySend(before, { versionId: "zz", drive: [{ id: D("z") }] }), /version/);
});

test("approving keeps only that cut in the client's Drive (named FINAL); notes keep coming, at a second or for the whole video", () => {
  const sent = piece({ previews: { a: { drive: [{ id: D("a"), name: "KP-1 · Versi pertama.mp4" }], poster: D("pa") }, b: { drive: [{ id: D("b"), name: "KP-1 · Revisi 1.mp4" }], poster: D("pb") } }, client: { versionId: "b", status: "waiting", code: "KP-1", sentAt: 1 } });
  const ok = applyDecision(sent, { versionId: "b", verdict: "approve", name: "Bu Rina", now: 9 });
  assert.equal(ok.patch.posting.finalId, "b");
  assert.equal(ok.patch.posting.versions[1].status, "approved");
  assert.deepEqual([ok.patch.posting.client.status, ok.patch.posting.client.name], ["approved", "Bu Rina"]);
  assert.deepEqual(Object.keys(ok.patch.posting.previews), ["b"]);
  assert.deepEqual(ok.removeDrive, [D("a"), D("pa")], "the older cut and its still, deleted for good");
  assert.deepEqual(ok.finalize, { versionId: "b", files: [{ id: D("b"), name: "KP-1 · Revisi 1.mp4" }], code: "KP-1" });

  const whole = applyDecision(sent, { versionId: "b", verdict: "revise", note: { t: null, text: "Musiknya kekencangan" }, name: "Rina", now: 9 });
  const n = whole.patch.posting.notes[0];
  assert.deepEqual([n.versionId, n.t, n.text, n.by, n.name, n.done], ["b", null, "Musiknya kekencangan", "client", "Rina", false]);
  assert.equal(whole.patch.posting.client.status, "revision");
  assert.deepEqual(whole.removeDrive, [], "a note deletes nothing");
  const more = applyDecision({ ...sent, posting: whole.patch.posting }, { versionId: "b", verdict: "revise", note: { t: 4.7, text: "Logo kecilin" }, now: 10 });
  assert.deepEqual(more.patch.posting.notes.map((x) => x.t), [null, 4]);

  assert.throws(() => applyDecision(sent, { versionId: "a", verdict: "approve" }), /stale/, "an older cut than the one sent");
  assert.throws(() => applyDecision(sent, { versionId: "b", verdict: "revise", note: { text: "  " } }), /note/);
  assert.throws(() => applyDecision(sent, { versionId: "b", verdict: "delete" }), /verdict/);
  assert.throws(() => applyDecision({ ...sent, status: "published" }, { versionId: "b", verdict: "approve" }), /posted/);

  // Wepeka approves in Brandlab instead: the same clean-up.
  const mine = applyKeepFinal({ ...sent, posting: { ...sent.posting, finalId: "a" } });
  assert.deepEqual(Object.keys(mine.patch.posting.previews), ["a"]);
  assert.deepEqual(mine.removeDrive, [D("b"), D("pb")]);
  assert.equal(applyKeepFinal(piece()).patch, null, "nothing approved, nothing to tidy");
  // Posted: the client keeps the final in their Drive; old Storage copies go.
  const posted = applyClean({ ...sent, posting: { ...sent.posting, finalId: "b", previews: { ...sent.posting.previews, z: { paths: ["review/u1/c1/z/01.mp4"] } } } });
  assert.deepEqual(Object.keys(posted.patch.posting.previews), ["b"]);
  assert.deepEqual(posted.removeDrive, [D("a"), D("pa")]);
  assert.deepEqual(posted.removePaths, ["review/u1/c1/z/01.mp4"]);
});

test("only the brand's client acts as one, and only their own connected Drive receives the cuts", () => {
  const admin = (uid) => uid === "wepeka";
  const brand = { ownerId: "wepeka", members: { rina: { role: "viewer", klien: true, name: "Rina" }, sari: { role: "viewer" }, off: { role: "viewer", klien: true, disabled: true }, dodi: { role: "editor", name: "Dodi" }, beni: { role: "editor", seatPaused: true }, ed: { role: "editor", disabled: true } }, clientDrive: { uid: "rina", email: "rina@quatro.test" } };
  assert.equal(clientOn(brand, "rina", admin).name, "Rina");
  assert.equal(clientOn(brand, "dodi", admin).name, "Dodi", "an editor works the Antrean like the client");
  assert.throws(() => clientOn(brand, "beni", admin), /not-client/, "a paused seat reads like a viewer");
  assert.throws(() => clientOn(brand, "ed", admin), /not-client/, "an editor whose access is off");
  assert.throws(() => clientOn(brand, "sari", admin), /not-client/, "a plain viewer");
  assert.throws(() => clientOn(brand, "off", admin), /not-client/, "access turned off");
  assert.throws(() => clientOn({ ...brand, ownerId: "someone" }, "rina", admin), /not-client/, "Video & posting is Wepeka's only");
  assert.deepEqual(clientDriveOf(brand), { uid: "rina", email: "rina@quatro.test" });
  assert.equal(clientDriveOf({ ...brand, clientDrive: { uid: "sari" } }), null, "not a client (any more)");
  assert.equal(clientDriveOf({ ...brand, members: {} }), null, "removed from the team");
});

// A tiny Drive in memory, answering like the REST API.
function fakeDrive() {
  const files = new Map([["root", { id: "root", name: "My Drive", mimeType: "application/vnd.google-apps.folder", parents: [] }]]);
  let n = 0;
  const calls = [];
  const res = (status, body) => ({ status, ok: status < 300, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    calls.push(`${method} ${u.pathname}`);
    if (init.headers?.authorization !== "Bearer tok") return res(401, {});
    const m = u.pathname.match(/\/files\/([^/]+)$/);
    if (m) {
      const f = files.get(decodeURIComponent(m[1]));
      if (!f) return res(404, {});
      if (method === "DELETE") { files.delete(f.id); return res(204, {}); }
      if (method === "PATCH") { Object.assign(f, JSON.parse(init.body)); return res(200, { id: f.id }); }
      return res(200, f);
    }
    if (method === "POST") { const id = `folder${String(++n).padStart(6, "0")}`; files.set(id, { id, ...JSON.parse(init.body) }); return res(200, { id }); }
    const q = u.searchParams.get("q");
    const name = q.match(/name='([^']*)'/)[1], parent = q.match(/and '([^']*)' in parents/)[1];
    return res(200, { files: [...files.values()].filter((f) => f.name === name && f.parents?.includes(parent) && !f.trashed).map((f) => ({ id: f.id })) });
  };
  return { files, calls, fetchImpl };
}

test("folders in the client's Drive: made once, found again, made again if the client deleted them", async () => {
  const d = fakeDrive();
  const one = await pieceFolder("tok", { brandName: "Quatro (New)", code: "QN-1", title: "Kenalan" }, d.fetchImpl);
  assert.equal(d.files.get(one.rootId).name, ROOT_FOLDER);
  assert.equal(d.files.get(one.folderId).name, "QN-1 · Kenalan");
  assert.deepEqual(d.files.get(one.folderId).parents, [one.brandFolderId]);
  const two = await pieceFolder("tok", { brandName: "Quatro (New)", code: "QN-1", title: "Kenalan", cache: one }, d.fetchImpl);
  assert.deepEqual(two, one);
  d.files.delete(one.folderId);
  const three = await pieceFolder("tok", { brandName: "Quatro (New)", code: "QN-1", title: "Kenalan", cache: one }, d.fetchImpl);
  assert.notEqual(three.folderId, one.folderId);

  d.files.set("video0000001", { id: "video0000001", name: "QN-1 · Revisi 1.mp4", size: "123", mimeType: "video/mp4", parents: [three.folderId] });
  assert.deepEqual(await checkFiles("tok", ["video0000001"], three.folderId, d.fetchImpl), [{ id: "video0000001", name: "QN-1 · Revisi 1.mp4", size: 123, type: "video/mp4" }]);
  await assert.rejects(checkFiles("tok", ["video0000001"], one.brandFolderId, d.fetchImpl), /missing/, "a file outside the piece's folder");
  await assert.rejects(checkFiles("bad", ["video0000001"], three.folderId, d.fetchImpl), /drive-off/);
  assert.deepEqual(await deleteFiles("tok", ["video0000001", "gonealready1"], d.fetchImpl), [], "already gone is fine");
  assert.ok(!d.files.has("video0000001"));
});
