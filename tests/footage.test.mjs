// Raw footage from the client's crew (api/_footage.js, 2026-11-09).
import { test } from "node:test";
import assert from "node:assert/strict";
import { footageMember, checkClips, clipNames, applyFootageAdd, applyFootageRemove, MAX_CLIP } from "../api/_footage.js";

const ADMIN = "wpk";
const isAdminUid = (uid) => uid === ADMIN;
const brand = {
  ownerId: ADMIN,
  members: {
    rina: { role: "viewer", klien: true, name: "Rina" },
    dodi: { role: "editor", name: "Dodi" },
    sari: { role: "viewer", name: "Sari" },
    off: { role: "viewer", klien: true, disabled: true },
    paused: { role: "editor", seatPaused: true },
  },
};

test("who may send clips: Wepeka, the client, an editor — not a viewer, a paused seat, or someone else's brand", () => {
  assert.equal(footageMember(brand, ADMIN, isAdminUid).owner, true);
  assert.equal(footageMember(brand, "rina", isAdminUid).name, "Rina");
  assert.equal(footageMember(brand, "dodi", isAdminUid).name, "Dodi");
  for (const uid of ["sari", "off", "paused", "nobody"]) assert.throws(() => footageMember(brand, uid, isAdminUid), { code: "not-team" });
  assert.throws(() => footageMember({ ...brand, ownerId: "customer" }, "rina", isAdminUid), { code: "not-team" });
});

test("clips: video, photo or sound; a .MOV with no type from the phone is fine; too big or a PDF is not", () => {
  assert.ok(checkClips([{ name: "IMG_1.MOV", type: "", size: 10 }, { name: "mic.wav", type: "audio/wav", size: 5 }, { name: "a.jpg", type: "image/jpeg", size: 5 }]));
  assert.throws(() => checkClips([{ name: "a.pdf", type: "application/pdf", size: 5 }]), { code: "type" });
  assert.throws(() => checkClips([{ name: "x.txt", type: "", size: 5 }]), { code: "type" });
  assert.throws(() => checkClips([{ name: "a.mov", type: "video/quicktime", size: MAX_CLIP + 1 }]), { code: "size" });
  assert.throws(() => checkClips([{ name: "a.mov", type: "video/quicktime", size: 0 }]), { code: "size" });
  assert.throws(() => checkClips([]), { code: "files" });
});

test("names: the camera's own, a clash gets (2), (3) — against what's there and within the batch", () => {
  const v = (name) => ({ name, type: "video/quicktime", size: 1 });
  assert.deepEqual(clipNames([v("IMG_0412.MOV"), v("img_0412.mov"), v("IMG_0413.MOV")], ["IMG_0412.MOV"]), ["IMG_0412 (2).MOV", "img_0412 (3).mov", "IMG_0413.MOV"]);
  assert.deepEqual(clipNames([v("a/b:c.MOV")]), ["a b:c.MOV"]);
});

test("the list on the piece: added once, removed one by one", () => {
  const c = { footage: { folderId: "F1", files: [{ id: "f1", name: "IMG_1.MOV", size: 5 }] } };
  const out = applyFootageAdd(c, { files: [{ id: "f1", name: "IMG_1.MOV", size: 5 }, { id: "f2", name: "IMG_2.MOV", size: 7, type: "video/quicktime" }], folderId: "F1", by: "rina", who: "Rina", now: 9 });
  assert.equal(out.added.length, 1);
  assert.deepEqual(out.patch.footage.files.map((f) => f.id), ["f1", "f2"]);
  assert.deepEqual(out.patch.footage.files[1], { id: "f2", name: "IMG_2.MOV", size: 7, type: "video/quicktime", at: 9, by: "rina", who: "Rina" });
  const rm = applyFootageRemove({ footage: out.patch.footage }, "f1");
  assert.deepEqual([rm.patch.footage.files.map((f) => f.id), rm.removeDrive, rm.patch.footage.folderId], [["f2"], ["f1"], "F1"]);
  assert.throws(() => applyFootageRemove({ footage: out.patch.footage }, "nope"), { code: "clip" });
  assert.deepEqual(applyFootageAdd({}, { files: [{ id: "a", name: "x" }], folderId: "F9", by: "u", who: "" }).patch.footage.folderId, "F9");
});
