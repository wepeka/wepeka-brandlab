import { test } from "node:test";
import assert from "node:assert/strict";
import { readPostEntries } from "../js/outbox.js";
import { planSync, matchBrand, versionIdOf } from "../js/outbox-sync.js";

const f = (name) => ({ kind: "file", name });

test("a post folder reads as its kind, versions and covers", () => {
  const reels = readPostEntries("2026-11-03 Cara pesan lewat WA", [f("v2.mp4"), f("v1.mp4"), f("cover-1.jpg"), f("post.json")], { caption: "Halo", time: "19:00" });
  assert.equal(reels.type, "reels");
  assert.equal(reels.title, "Cara pesan lewat WA");
  assert.equal(reels.date, "2026-11-03");
  assert.deepEqual(reels.versions.map((v) => v.file), ["v2.mp4", "v1.mp4"], "kept in the order the folder lists them (sorted upstream)");
  assert.deepEqual(reels.covers, ["cover-1.jpg"]);
  assert.equal(reels.caption, "Halo");

  const carousel = readPostEntries("2026-11-05 Menu", [{ kind: "directory", name: "v1", slides: ["01.jpg", "02.jpg"] }, { kind: "directory", name: "v2", slides: ["01.jpg"] }]);
  assert.equal(carousel.type, "carousel");
  assert.deepEqual(carousel.versions.map((v) => [v.file, v.kind, v.slides.length]), [["v1", "set", 2], ["v2", "set", 1]]);

  const flat = readPostEntries("Promo tanpa tanggal", [f("01.jpg"), f("02.jpg"), f("03.jpg")]);
  assert.equal(flat.type, "carousel");
  assert.equal(flat.date, "");
  assert.deepEqual(flat.versions[0].slides, ["01.jpg", "02.jpg", "03.jpg"]);

  assert.equal(readPostEntries("x", [f("poster.png")]).type, "foto");
  assert.equal(readPostEntries("x", [f("a.mp4")], { type: "story" }).type, "story", "post.json decides the kind");
});

test("folders find their brand by name or Instagram handle, or by the pick made once", () => {
  const brands = [{ id: "a", name: "Kopi Pagi" }, { id: "b", name: "Bumi Fit", instagram: { username: "@bumifit.id" } }];
  assert.equal(matchBrand("kopi-pagi", brands)?.id, "a");
  assert.equal(matchBrand("bumifit.id", brands)?.id, "b");
  assert.equal(matchBrand("Klien Baru", brands), null);
  assert.equal(matchBrand("Klien Baru", brands, { klienbaru: "b" })?.id, "b");
});

test("sync: new folders become pieces, new cuts become the next revision, nothing doubles", () => {
  const brands = [{ id: "a", name: "Kopi Pagi" }];
  const post = { key: "Kopi Pagi/2026-11-03 WA", brand: "Kopi Pagi", title: "WA", date: "2026-11-03", time: "", caption: "Cap", type: "reels", covers: ["cover.jpg"], versions: [{ file: "v1.mp4", kind: "video" }] };
  const first = planSync([post], brands, () => null);
  assert.equal(first.create.length, 1);
  const data = first.create[0].data;
  assert.equal(data.format, "Reels");
  assert.equal(data.posting.local.key, post.key);
  assert.equal(data.posting.versions[0].id, versionIdOf("v1.mp4"));

  const existing = { id: "c1", caption: "Cap", status: "scheduled", posting: { ...data.posting, ig: { state: "scheduled" }, finalId: data.posting.versions[0].id } };
  assert.equal(planSync([post], brands, () => existing).update.length, 0, "same folder twice changes nothing");

  const withV2 = { ...post, versions: [...post.versions, { file: "v2.mp4", kind: "video" }] };
  const second = planSync([withV2], brands, () => existing);
  const patch = second.update[0].patch;
  assert.deepEqual(patch.posting.versions.map((v) => [v.local.file, v.n, v.status]), [["v1.mp4", 0, "pending"], ["v2.mp4", 1, "pending"]]);
  assert.equal(patch.posting.ig, null, "a booked slot is let go for the new cut");
  assert.equal(patch.status, "editing");

  assert.equal(planSync([{ ...post, brand: "Klien Baru" }], brands, () => null).unmatched.length, 1);
});

test("a folder named with a code joins that piece from Creator, or starts its trial", () => {
  const coded = readPostEntries("KP-12 2026-11-03 Cara pesan", [f("v1.mp4")]);
  assert.equal(coded.code, "KP-12");
  assert.equal(coded.title, "Cara pesan");
  assert.equal(coded.date, "2026-11-03");
  assert.equal(readPostEntries("Promo-2 baru", [f("v1.mp4")]).code, "", "only capital codes count");

  const brands = [{ id: "a", name: "Kopi Pagi" }];
  const piece = { id: "c12", brandId: "a", title: "Cara pesan", caption: "", status: "draft", videoNo: 12, posting: { versions: [], notes: [], time: "19:00" } };
  const byCode = (code) => ({ "KP-12": piece })[code] || null;
  const post = { key: "Kopi Pagi/KP-12 2026-11-03 Cara pesan", code: "KP-12", brand: "Kopi Pagi", title: "Cara pesan", date: "2026-11-03", time: "", caption: "Dari Claude", type: "reels", covers: [], versions: [{ file: "v1.mp4", kind: "video" }] };
  const linked = planSync([post], brands, { byKey: () => null, byCode });
  assert.equal(linked.create.length, 0, "no second piece");
  const patch = linked.update[0].patch;
  assert.equal(linked.update[0].id, "c12");
  assert.equal(patch.posting.local.key, post.key);
  assert.equal(patch.posting.time, "19:00", "the hour set in Brandlab stays");
  assert.equal(patch.status, "editing");
  assert.equal(patch.caption, "Dari Claude");

  const trial = planSync([{ ...post, key: "Kopi Pagi/KP-12C Cara pesan", code: "KP-12C" }], brands, { byKey: () => null, byCode });
  assert.equal(trial.create.length, 1);
  assert.equal(trial.create[0].data.trialOf, "c12");
  assert.equal(trial.create[0].data.trial, "C");
  assert.equal(trial.create[0].data.posting.trialReel, true);

  const taken = { ...piece, posting: { ...piece.posting, local: { key: "Kopi Pagi/other" } } };
  const second = planSync([post], brands, { byKey: () => null, byCode: () => taken });
  assert.equal(second.create.length + second.update.length, 0, "a code already tied to another folder is left alone");
});

test("Claude's side of a revision: what changed in a cut, and which notes it fixed", () => {
  const read = readPostEntries("KP-1 Judul", [f("v1.mp4"), f("v2.mp4")], { changes: { "v2.mp4": " Logo dipindah ", "v9.mp4": 3 }, done: ["n1", 7] });
  assert.deepEqual(read.changes, { "v2.mp4": "Logo dipindah" });
  assert.deepEqual(read.done, ["n1"]);

  const brands = [{ id: "a", name: "Kopi Pagi" }];
  const existing = { id: "c1", caption: "x", status: "editing", posting: { local: { key: "Kopi Pagi/KP-1 Judul" }, covers: [], versions: [{ id: versionIdOf("v1.mp4"), n: 0, status: "revision", local: { file: "v1.mp4" } }], notes: [{ id: "n1", versionId: versionIdOf("v1.mp4"), t: 3, text: "Logo", done: false }, { id: "n2", text: "Musik", done: false }] } };
  const post = { key: "Kopi Pagi/KP-1 Judul", brand: "Kopi Pagi", covers: [], caption: "", type: "reels", versions: [{ file: "v1.mp4", kind: "video" }, { file: "v2.mp4", kind: "video" }], ...read };
  const { update } = planSync([post], brands, () => existing);
  const p = update[0].patch.posting;
  assert.equal(p.versions[1].changeNote, "Logo dipindah");
  assert.deepEqual(p.notes.map((n) => [n.id, n.done, n.doneBy || ""]), [["n1", true, "claude"], ["n2", false, ""]]);
  // Nothing new the second time round.
  const after = { ...existing, posting: p };
  assert.equal(planSync([post], brands, () => after).update.length, 0);
});
