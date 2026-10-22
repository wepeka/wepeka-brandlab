// Papan (js/papan/bridge.js, papan/): the storage encoding Firestore needs,
// and the canvas build staying in step with what Brandlab loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { __test } = await import("../js/papan/bridge.js");

test("pen strokes and table rows survive Firestore (no arrays inside arrays)", () => {
  const obj = { type: "pen", data: { points: [[0, 1.5], [2, 3]], width: 3 }, rows: [["a", "b"], ["c", ""]], votes: { u1: 1 }, list: [1, 2] };
  const enc = __test.encode(obj);
  const hasNested = (v) => Array.isArray(v) ? v.some((x) => Array.isArray(x) || hasNested(x)) : v && typeof v === "object" ? Object.values(v).some(hasNested) : false;
  assert.equal(hasNested(enc), false);
  assert.deepEqual(__test.decode(enc), obj);
});
test("the built canvas matches papan/version.js and loads no inline script", () => {
  const html = readFileSync(new URL("../papan/index.html", import.meta.url), "utf8");
  const ver = readFileSync(new URL("../papan/version.js", import.meta.url), "utf8").match(/"([0-9a-f]{12})"/)[1];
  assert.match(html, new RegExp(`app\\.js\\?v=${ver}`));
  assert.equal([...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].length, 0, "Brandlab's CSP blocks inline scripts");
});
test("the canvas page may be framed by Brandlab only", () => {
  const v = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const papan = v.headers.find((h) => h.source === "/papan/(.*)");
  const csp = papan.headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /frame-ancestors 'self'/);
  const rest = v.headers.find((h) => h.source === "/((?!papan/).*)");
  assert.match(rest.headers.find((h) => h.key === "Content-Security-Policy").value, /frame-ancestors 'none'/);
});
