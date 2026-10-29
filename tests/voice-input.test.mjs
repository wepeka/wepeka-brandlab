import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionText } from "../js/voice-input.js";

const r = (transcript, isFinal = true) => Object.assign([{ transcript }], { isFinal });

test("sessionText joins final results and keeps the unfinished words apart", () => {
  assert.deepEqual(sessionText([r("aku mau bikin konten"), r("soal kopi susu", false)]), { final: "aku mau bikin konten", interim: "soal kopi susu" });
  assert.deepEqual(sessionText([r("ide pertama"), r("ide kedua")]), { final: "ide pertama ide kedua", interim: "" });
});

test("sessionText drops the repeated start Android sends with each final result", () => {
  assert.equal(sessionText([r("aku mau"), r("aku mau bikin video"), r("aku mau bikin video tentang kopi")]).final, "aku mau bikin video tentang kopi");
});

test("sessionText skips empty pieces", () => {
  assert.deepEqual(sessionText([r("  "), r("halo", false)]), { final: "", interim: "halo" });
});
