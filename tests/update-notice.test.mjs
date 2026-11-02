// "Brandlab sudah diperbarui" (js/update-notice.js): a tab compares its own
// js/main-<hash>.js with the one the live index.html loads. Pure parts only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { mainScriptOf, isHashedEntry } = await import("../js/update-notice.js");

test("reads the module entry from a production index.html", () => {
  const html = `<link rel="modulepreload" href="js/chunks/chunk-ABC123.js">
<script type="module" src="js/main-76VMJATZ.js"></script>
<script data-en="js/chunks/i18n-en-X.js" data-id="js/chunks/i18n-id-Y.js">try{}catch(e){}</script>`;
  assert.equal(mainScriptOf(html), "js/main-76VMJATZ.js");
  assert.ok(isHashedEntry("js/main-76VMJATZ.js"));
});

test("dev's plain js/main.js is not a hashed build, so the check stays off", () => {
  const src = mainScriptOf(readFileSync(new URL("../index.html", import.meta.url), "utf8"));
  assert.equal(src, "js/main.js");
  assert.equal(isHashedEntry(src), false);
});

test("anything that isn't index.html (an error page, empty) gives nothing", () => {
  assert.equal(mainScriptOf("<h1>502</h1>"), "");
  assert.equal(mainScriptOf(undefined), "");
  assert.equal(isHashedEntry(""), false);
});
