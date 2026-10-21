import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { leafDiff, applyPaths, merge3, listEdit, applyListEdit } from "../js/collab/diff.js";

describe("leafDiff / applyPaths (js/collab/diff.js)", () => {
  test("only the leaves that changed, arrays whole, removals as deletes", () => {
    const base = { mission: "a", vision: "b", parts: { why: "x", how: "y" }, tags: [1, 2] };
    const next = { mission: "a2", vision: "b", parts: { why: "x", how: "y2" }, tags: [1, 2, 3] };
    assert.deepEqual(leafDiff(base, next), [
      { path: ["mission"], value: "a2" },
      { path: ["parts", "how"], value: "y2" },
      { path: ["tags"], value: [1, 2, 3] },
    ]);
    assert.deepEqual(leafDiff({ a: 1, b: 2 }, { a: 1 }), [{ path: ["b"], delete: true }]);
    assert.deepEqual(leafDiff(base, structuredClone(base)), []);
    assert.deepEqual(applyPaths(base, leafDiff(base, next)), next);
  });
});

describe("merge3: a teammate's change and mine both survive", () => {
  test("untouched here → theirs; touched here → mine", () => {
    const base = { mission: "m", vision: "v", parts: { why: "w" } };
    const mine = { mission: "m-ku", vision: "v", parts: { why: "w" } };
    const theirs = { mission: "m", vision: "v-rina", parts: { why: "w-rina" } };
    assert.deepEqual(merge3(mine, base, theirs), { mission: "m-ku", vision: "v-rina", parts: { why: "w-rina" } });
  });
});

describe("listEdit / applyListEdit: two people adding ideas at once", () => {
  test("both additions are kept; a removal and an edit land on the newest copy", () => {
    const before = [{ id: "1", t: "a" }, { id: "2", t: "b" }];
    const mine = [{ id: "3", t: "baru-ku" }, { id: "1", t: "a-edit" }];
    const server = [{ id: "4", t: "baru-rina" }, { id: "1", t: "a" }, { id: "2", t: "b" }];
    const edit = listEdit(before, mine);
    assert.deepEqual(edit.removed, ["2"]);
    const out = applyListEdit(server, edit);
    assert.deepEqual(out.map((x) => x.id).sort(), ["1", "3", "4"]);
    assert.equal(out.find((x) => x.id === "1").t, "a-edit");
  });
  test("lists without ids (or repeated ids) are not id-keyed", () => {
    assert.equal(listEdit([{ t: 1 }], [{ t: 2 }]), null);
    assert.equal(listEdit([], [{ id: "a" }, { id: "a" }]), null);
    assert.equal(listEdit([{ id: "a" }], [{ id: "a" }]).empty, true);
  });
});

describe("preserveEditing (js/collab/preserve.js)", () => {
  test("a repaint gives the focused field back its text, caret and focus", async () => {
    const { captureEditing, restoreEditing } = await import("../js/collab/preserve.js");
    const made = [];
    const field = (id, value) => {
      const el = { tagName: "TEXTAREA", type: "", id, value, selectionStart: 0, selectionEnd: 0, selectionDirection: "none", scrollTop: 0, scrollLeft: 0, isConnected: true, isContentEditable: false,
        getAttribute: () => null, focus() { doc.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
      made.push(el);
      return el;
    };
    const doc = { activeElement: null, querySelector: (sel) => made.filter((e) => e.isConnected).find((e) => `#${e.id}` === sel) || null };
    const old = field("f-caption", "Halo pagi, kopi");
    old.selectionStart = 5; old.selectionEnd = 9; old.scrollTop = 12;
    doc.activeElement = old;
    const snap = captureEditing(doc);
    // The view repaints: the field is rebuilt from the saved value.
    old.isConnected = false;
    doc.activeElement = null;
    const fresh = field("f-caption", "Halo");
    assert.equal(restoreEditing(snap, doc), true);
    assert.equal(fresh.value, "Halo pagi, kopi");
    assert.deepEqual([fresh.selectionStart, fresh.selectionEnd, fresh.scrollTop], [5, 9, 12]);
    assert.equal(doc.activeElement, fresh);
  });
});
