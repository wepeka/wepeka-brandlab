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
