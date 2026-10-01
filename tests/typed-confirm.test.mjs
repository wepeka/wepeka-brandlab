import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { typedWordMatches } from "../js/typed-confirm.js";

describe("typedWordMatches (Reset semua data asks for HAPUS)", () => {
  test("the exact word unlocks", () => assert.equal(typedWordMatches("HAPUS", "HAPUS"), true));
  test("case and outer spaces don't matter", () => assert.equal(typedWordMatches("  hapus ", "HAPUS"), true));
  test("anything else stays locked", () => {
    assert.equal(typedWordMatches("", "HAPUS"), false);
    assert.equal(typedWordMatches("HAPU", "HAPUS"), false);
    assert.equal(typedWordMatches("HAPUS SEMUA", "HAPUS"), false);
    assert.equal(typedWordMatches(undefined, "HAPUS"), false);
  });
});
