import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { plainWords } from "../js/i18n.js";

describe("plainWords: Pemula says Tujuan, not Campaign", () => {
  test("Indonesian: campaign → tujuan, keeping capitals and -nya/-mu", () => {
    assert.equal(plainWords("Campaign baru", "id"), "Tujuan baru");
    assert.equal(plainWords("Belum ada campaign", "id"), "Belum ada tujuan");
    assert.equal(plainWords("buka dari daftar campaign-mu", "id"), "buka dari daftar tujuanmu");
    assert.equal(plainWords("cuma menentukan campaign-nya", "id"), "cuma menentukan tujuannya");
  });
  test("English: campaign(s) → goal(s)", () => {
    assert.equal(plainWords("New campaign", "en"), "New goal");
    assert.equal(plainWords("Other campaigns", "en"), "Other goals");
  });
  test("placeholders like {campaign} are never touched", () => {
    assert.equal(plainWords("Saran: {campaign}", "id"), "Saran: {campaign}");
    assert.equal(plainWords("Ini membuat {campaigns} campaign", "id"), "Ini membuat {campaigns} tujuan");
  });
  test("text without jargon passes through unchanged", () => {
    assert.equal(plainWords("Konten baru", "id"), "Konten baru");
  });
});
