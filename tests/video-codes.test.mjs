import { test } from "node:test";
import assert from "node:assert/strict";
import { brandPrefix, prefixesOf, planCodes, parseCode, codeOf, trialFields, nextTrialLetter, codedPiece } from "../js/video-codes.js";

test("a brand's letters: initials, or the first three of one word", () => {
  assert.equal(brandPrefix("Kopi Pagi"), "KP");
  assert.equal(brandPrefix("Pinter Mandarin"), "PM");
  assert.equal(brandPrefix("@winkhsin"), "WIN");
  assert.equal(brandPrefix("3 Second"), "V3S");
  assert.equal(brandPrefix(""), "V");
  const m = prefixesOf([{ id: "b", name: "Kedai Pak", createdAt: 2 }, { id: "a", name: "Kopi Pagi", createdAt: 1 }]);
  assert.equal(m.get("a"), "KP");
  assert.equal(m.get("b"), "KP2", "the newer brand with the same letters gets a 2");
});

test("numbers go oldest first, are never handed out twice, and a trial takes its piece's", () => {
  const items = [
    { id: "new", createdAt: 30 },
    { id: "old", createdAt: 10 },
    { id: "has", createdAt: 20, videoNo: 4 },
    { id: "tr", createdAt: 40, trialOf: "old", trial: "B" },
  ];
  const trashed = { id: "gone", createdAt: 5, videoNo: 7, deletedAt: 1 };
  const plan = new Map(planCodes(items, [...items, trashed]).map((x) => [x.id, x.videoNo]));
  assert.equal(plan.get("old"), 8, "after the highest number ever used, Trash included");
  assert.equal(plan.get("new"), 9);
  assert.equal(plan.has("has"), false, "a saved number stays");
  assert.equal(plan.get("tr"), 8, "the trial shares KP-8");

  // Two devices gave the same number: the newer piece moves.
  const twice = planCodes([{ id: "a", createdAt: 1, videoNo: 3 }, { id: "b", createdAt: 2, videoNo: 3 }]);
  assert.deepEqual(twice, [{ id: "b", videoNo: 4 }]);
  assert.deepEqual(planCodes([{ id: "a", createdAt: 1, videoNo: 3 }]), [], "nothing to save twice");
});

test("codes read back from what the owner types or a folder name", () => {
  assert.deepEqual(parseCode("kp-012b"), { code: "KP-12B", base: "KP-12", letter: "B" });
  assert.deepEqual(parseCode("KP-12 2026-11-03 Judul"), { code: "KP-12", base: "KP-12", letter: "" });
  assert.equal(parseCode("2026-11-03 Judul"), null);
  assert.equal(codeOf({ videoNo: 12 }, "KP"), "KP-12");
  assert.equal(codeOf({ videoNo: 12, trialOf: "x", trial: "C" }, "KP"), "KP-12C");
  assert.equal(codeOf({}, "KP"), "");
});

test("a trial starts as the same piece, its own videos to come", () => {
  const parent = { id: "p", title: "Cara pesan", scheduleDate: "2026-11-03", format: "Reels", caption: "Cap", videoNo: 12, script: "long" };
  const f = trialFields(parent, "B");
  assert.equal(f.title, "Cara pesan · Trial B");
  assert.equal(f.trialOf, "p");
  assert.equal(f.videoNo, 12);
  assert.equal(f.scheduleDate, "2026-11-03");
  assert.equal(f.script, undefined, "the script stays on the piece");
  assert.equal(nextTrialLetter("p", [{ trialOf: "p", trial: "B" }, { trialOf: "q", trial: "C" }]), "C");
  assert.equal(codedPiece({ platform: "TikTok" }), false);
  assert.equal(codedPiece({ status: "published" }), false, "old posts from before the queue stay out");
  assert.equal(codedPiece({ status: "draft", platform: "Instagram" }), true);
});
