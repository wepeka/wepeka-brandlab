import { test } from "node:test";
import assert from "node:assert/strict";
import { postingState, formatIssues, driveFolderPath, driveFileName } from "../js/posting.js";

const v = (id, status, extra = {}) => ({ id, n: 0, status, w: 540, h: 960, dur: 10, size: 1e6, type: "video/mp4", ...extra });

test("a piece's video state follows its newest version, then its Instagram slot", () => {
  assert.equal(postingState({ status: "draft" }), "none");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "pending")], notes: [] } }), "review");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "revision")], notes: [] } }), "revision");
  // an approved older cut doesn't hide a newer one waiting for a look
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "approved"), v("b", "pending")], finalId: "a", notes: [] } }), "review");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "revision"), v("b", "approved")], finalId: "b", notes: [] } }), "ready");
  assert.equal(postingState({ status: "scheduled", posting: { versions: [v("a", "approved")], finalId: "a", notes: [], ig: { state: "scheduled" } } }), "scheduled");
  assert.equal(postingState({ status: "scheduled", posting: { versions: [v("a", "approved")], finalId: "a", notes: [], ig: { state: "failed" } } }), "failed");
  assert.equal(postingState({ status: "published", posting: { versions: [v("a", "approved")], finalId: "a", notes: [] } }), "published");
});

test("videos land in the owner's Drive as Brandlab / brand / month / piece, the posted cut marked FINAL", () => {
  const c = { scheduleDate: "2026-11-04", title: "Video jendela drive-thru" };
  assert.deepEqual(driveFolderPath({ name: "Kopi Pagi" }, c, "id"), ["Brandlab", "Kopi Pagi", "2026-11 November", "04 Nov · Video jendela drive-thru"]);
  // slashes would make Drive folders inside folders
  assert.equal(driveFolderPath({ name: "A/B Coffee" }, { title: "Promo 1/2" }, "id")[1], "A-B Coffee");
  assert.equal(driveFolderPath({ name: "X" }, { title: "Promo 1/2" }, "id")[2], "Tanpa tanggal");
  assert.equal(driveFileName({ n: 0 }, "mov"), "Original.mov");
  assert.equal(driveFileName({ n: 2 }, "mp4", true), "Revisi 2 (FINAL).mp4");
});

test("format check only speaks up about what Instagram would refuse or crop", () => {
  assert.deepEqual(formatIssues(v("a", "pending")), []);
  assert.equal(formatIssues(v("a", "pending", { w: 1920, h: 1080 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { dur: 901 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { size: 301 * 1048576 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { type: "video/webm" })).length, 1);
});

test("brandlab.json tells Claude the decision, the cut, the cover and every note by file", async () => {
  const { decisionsFor } = await import("../js/posting.js");
  const c = {
    title: "WA", scheduleDate: "2026-11-03", caption: "Cap", status: "editing",
    posting: {
      type: "reels", time: "19:00", cover: "cover-2.jpg", finalId: null,
      versions: [{ id: "a", n: 0, status: "revision", local: { file: "v1.mp4" } }, { id: "b", n: 1, status: "pending", local: { file: "v2.mp4" } }],
      notes: [{ id: "n", versionId: "a", t: 12, text: "Logo kepotong", done: false }],
    },
  };
  const d = decisionsFor(c);
  assert.equal(d.status, "review");
  assert.equal(d.final, "");
  assert.equal(d.cover, "cover-2.jpg");
  assert.deepEqual(d.versions, [{ file: "v1.mp4", status: "revision" }, { file: "v2.mp4", status: "pending" }]);
  assert.deepEqual(d.notes, [{ id: "n", file: "v1.mp4", at: "0:12", seconds: 12, text: "Logo kepotong", done: false, from: "winson" }]);
});

test("an Instagram post link is tidied to its permalink, anything else refused", async () => {
  const { igPermalink } = await import("../js/posting.js");
  assert.equal(igPermalink("https://www.instagram.com/reel/DAbc_12-x/?igsh=abc"), "https://www.instagram.com/reel/DAbc_12-x/");
  assert.equal(igPermalink("instagram.com/reels/DAbc123"), "https://www.instagram.com/reel/DAbc123/");
  assert.equal(igPermalink("https://www.instagram.com/kopipagi/p/CxYz987/"), "https://www.instagram.com/p/CxYz987/");
  assert.equal(igPermalink("https://tiktok.com/@x/video/1"), "");
});
