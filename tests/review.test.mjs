import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadPaths, applySend, applyDecision, applyClean, clientView, newToken, TOKEN_RE, prefixOf } from "../api/_review.js";

const piece = (posting = {}, extra = {}) => ({
  id: "c1", brandId: "b1", ownerId: "u1", title: "Cara pesan", scheduleDate: "2026-11-05", caption: "Cap", status: "editing",
  posting: { versions: [{ id: "a", n: 0, status: "revision", kind: "video" }, { id: "b", n: 1, status: "pending", kind: "video", changeNote: "Logo dipindah" }], notes: [], time: "19:00", ...posting },
  ...extra,
});

test("links are long random tokens; copies only go under the owner's piece and cut", () => {
  assert.ok(TOKEN_RE.test(newToken()));
  assert.notEqual(newToken(), newToken());
  const [f] = uploadPaths("u1", "c1", "b", [{ name: "v2 final!.mp4", type: "video/mp4", size: 1000 }]);
  assert.equal(f.path, "review/u1/c1/b/01-v2-final-.mp4");
  assert.throws(() => uploadPaths("u1", "c1", "b", [{ name: "x.exe", type: "application/x-msdownload", size: 10 }]), /type/);
  assert.throws(() => uploadPaths("u1", "c1", "b", [{ name: "big.mp4", type: "video/mp4", size: 301 * 1048576 }]), /size/);
  assert.throws(() => applySend(piece(), { uid: "u1", versionId: "b", paths: ["review/u2/c1/b/01-x.mp4"] }), /paths/, "someone else's folder");
  assert.throws(() => applySend(piece(), { uid: "u1", versionId: "b", paths: ["review/u1/c1/b/../../x"] }), /paths/);
});

test("sending a cut points the client at it and lets every older copy go", () => {
  const before = piece({ previews: { a: { paths: [`${prefixOf("u1", "c1", "a")}01-v1.mp4`] } } });
  const { patch, removePaths } = applySend(before, { uid: "u1", versionId: "b", paths: [`${prefixOf("u1", "c1", "b")}01-v2.mp4`], kind: "video", code: "KP-1", now: 5 });
  assert.deepEqual(Object.keys(patch.posting.previews), ["b"]);
  assert.deepEqual(removePaths, ["review/u1/c1/a/01-v1.mp4"]);
  assert.deepEqual(patch.posting.client, { versionId: "b", code: "KP-1", status: "waiting", sentAt: 5, decidedAt: 0, name: "" });
});

test("the client approves (it becomes the posted cut) or sends it back with a note", () => {
  const sent = piece({ previews: { a: { paths: ["review/u1/c1/a/01.mp4"] }, b: { paths: ["review/u1/c1/b/01.mp4"] } }, client: { versionId: "b", status: "waiting", sentAt: 1 } });
  const ok = applyDecision(sent, { versionId: "b", verdict: "approve", name: "Bu Rina", now: 9 });
  assert.equal(ok.patch.posting.finalId, "b");
  assert.equal(ok.patch.posting.versions[1].status, "approved");
  assert.equal(ok.patch.posting.client.status, "approved");
  assert.equal(ok.patch.posting.client.name, "Bu Rina");
  assert.deepEqual(Object.keys(ok.patch.posting.previews), ["b"], "the approved cut stays viewable until it's posted");
  assert.deepEqual(ok.removePaths, ["review/u1/c1/a/01.mp4"]);

  const rev = applyDecision(sent, { versionId: "b", verdict: "revise", note: { t: 12.7, text: " Logo kepotong " }, name: "Rina", now: 9 });
  assert.equal(rev.patch.posting.versions[1].status, "revision");
  assert.equal(rev.patch.posting.client.status, "revision");
  const n = rev.patch.posting.notes[0];
  assert.deepEqual([n.versionId, n.t, n.text, n.by, n.name, n.done], ["b", 12, "Logo kepotong", "client", "Rina", false]);
  assert.deepEqual(rev.removePaths, []);

  assert.throws(() => applyDecision(sent, { versionId: "a", verdict: "approve" }), /stale/, "an older cut than the one sent");
  assert.throws(() => applyDecision(sent, { versionId: "b", verdict: "revise", note: { text: "  " } }), /note/);
  assert.throws(() => applyDecision(sent, { versionId: "b", verdict: "delete" }), /verdict/);
  assert.throws(() => applyDecision({ ...sent, status: "published" }, { versionId: "b", verdict: "approve" }), /posted/);
});

test("once the post is up every copy goes, and the client sees the Instagram post", async () => {
  const posted = piece({ previews: { b: { paths: ["review/u1/c1/b/01.mp4"], kind: "video" } }, client: { versionId: "b", status: "approved", code: "KP-1" }, finalId: "b", ig: { state: "published", permalink: "https://www.instagram.com/reel/ABC123/" } }, { status: "published" });
  const clean = applyClean(posted);
  assert.deepEqual(clean.patch.posting.previews, {});
  assert.deepEqual(clean.removePaths, ["review/u1/c1/b/01.mp4"]);

  const sign = async (p) => `https://signed/${p}`;
  const waiting = piece({ previews: { b: { paths: ["review/u1/c1/b/01.mp4"], kind: "video" } }, client: { versionId: "b", status: "waiting", code: "KP-2", sentAt: 3 }, notes: [{ id: "n1", versionId: "b", t: 2, text: "internal", by: "you" }] }, { id: "c2", scheduleDate: "2026-11-04" });
  const view = await clientView({ brand: { name: "Kopi Pagi", color: "#c7773b", instagram: { username: "@kopipagi" } }, contents: [posted, waiting, piece({}, { id: "c3" })], sign });
  assert.deepEqual(view.brand, { name: "Kopi Pagi", color: "#c7773b", handle: "kopipagi" });
  assert.deepEqual(view.items.map((x) => [x.code, x.state]), [["KP-2", "waiting"], ["KP-1", "posted"]], "only pieces sent to the client, waiting first");
  assert.deepEqual(view.items[0].files, ["https://signed/review/u1/c1/b/01.mp4"]);
  assert.equal(view.items[0].version.changeNote, "Logo dipindah");
  assert.deepEqual(view.items[0].notes, [], "Wepeka's own notes stay inside");
  assert.deepEqual(view.items[1].files, [], "no video once the Instagram post replaces it");
  assert.equal(view.items[1].permalink, "https://www.instagram.com/reel/ABC123/");
});
