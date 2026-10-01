// "Impor JSON" (js/store.js importJSON → js/account.js checkImport): size,
// ids, colors and the plan's brand limit, all before any write.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkImport, IMPORT_MAX_CHARS } from "../js/account.js";

const starter = { plan: "starter", status: "active", brandLimit: 1 };
const pro = { plan: "pro", status: "active", brandLimit: 3 };
const brand = (id, extra = {}) => ({ id, name: id, createdAt: 1, ...extra });
const backup = (data) => JSON.stringify(data);

describe("import guard", () => {
  test("a normal backup within the limit passes", () => {
    const out = checkImport(backup({ brands: [brand("a")], content: [{ id: "c1", brandId: "a" }] }), [], pro);
    assert.equal(out.brands.length, 1);
  });
  test("refuses to go over the plan's brand limit (S-16)", () => {
    assert.throws(() => checkImport(backup({ brands: [brand("a"), brand("b")] }), [], starter), /1/);
  });
  test("counts brands already on the account that the backup doesn't overwrite", () => {
    assert.throws(() => checkImport(backup({ brands: [brand("b")] }), [brand("a")], starter));
    assert.doesNotThrow(() => checkImport(backup({ brands: [brand("a", { name: "new name" })] }), [brand("a")], starter));
  });
  test("archived brands don't count", () => {
    assert.doesNotThrow(() => checkImport(backup({ brands: [brand("a"), brand("b", { archived: true })] }), [], starter));
  });
  test("an account already over its limit can still re-import without adding brands", () => {
    const existing = [brand("a"), brand("b")];
    assert.doesNotThrow(() => checkImport(backup({ brands: existing }), existing, starter));
  });
  test("non-string or path-like ids are refused (S-20)", () => {
    assert.throws(() => checkImport(backup({ brands: [{ id: 5, name: "x" }] }), [], pro));
    assert.throws(() => checkImport(backup({ content: [{ id: "other/doc" }] }), [], pro));
    assert.throws(() => checkImport(backup({ brands: "nope" }), [], pro));
    assert.throws(() => checkImport(backup([1, 2]), [], pro));
  });
  test("colors that aren't hex codes are dropped (they end up in style attributes)", () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const out = checkImport(backup({ brands: [brand("a", { color: evil, brandGuidelines: { colors: { primary: "#1A1816", accent: "red;background:url(x)" } } })] }), [], pro);
    assert.equal(out.brands[0].color, "");
    assert.deepEqual(out.brands[0].brandGuidelines.colors, { primary: "#1A1816", accent: "" });
  });
  test("oversized files and documents are refused", () => {
    assert.throws(() => checkImport("x".repeat(IMPORT_MAX_CHARS + 1), [], pro));
    assert.throws(() => checkImport(backup({ brands: [brand("a", { avatar: "x".repeat(1_000_001) })] }), [], pro));
  });
  test("not JSON at all keeps its SyntaxError (settings shows 'not a backup')", () => {
    assert.throws(() => checkImport("{oops", [], pro), SyntaxError);
  });
});
