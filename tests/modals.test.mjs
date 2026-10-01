// promptDialog puts the owner's own text (a target number, a font name)
// into attributes — it must never become markup (audit S-20).
import { test } from "node:test";
import assert from "node:assert/strict";

const { promptDialog } = await import("../js/modals.js");

test("promptDialog escapes placeholder and value", () => {
  const made = [];
  const node = () => ({ addEventListener() {}, focus() {}, getClientRects: () => [], querySelectorAll: () => [], value: "", click() {} });
  const realCreate = document.createElement;
  const realAppend = document.body.appendChild;
  document.createElement = () => {
    const el = { innerHTML: "", className: "", addEventListener() {}, remove() {}, querySelector: () => node(), querySelectorAll: () => [] };
    made.push(el);
    return el;
  };
  document.body.appendChild = () => {};
  try {
    promptDialog({ title: "T", label: "L", placeholder: '"><img src=x onerror=alert(1)>', value: 'a"b&<c>' });
  } finally {
    document.createElement = realCreate;
    document.body.appendChild = realAppend;
  }
  const html = made[0].innerHTML;
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /placeholder="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /value="a&quot;b&amp;&lt;c&gt;"/);
});
