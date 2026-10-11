// The Wepeka Brandlab bumper the player puts before the first and after the
// last guide video (js/guide-videos.js bumperHTML / playBumper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { bumperHTML } from "../js/guide-videos.js";

test("the bumper is a bundled file with a skip button and no player controls", () => {
  for (const kind of ["in", "out"]) {
    const html = bumperHTML(kind);
    const src = html.match(/<video src="([^"]+)"/)?.[1];
    assert.ok(src && existsSync(new URL(`../${src}`, import.meta.url)), `${kind}: ${src} is in the repo`);
    assert.match(html, /data-vc="skip-bumper"/);
    assert.doesNotMatch(html, /<video[^>]*\scontrols/);
  }
  assert.notEqual(bumperHTML("in"), bumperHTML("out"));
  assert.equal(bumperHTML("nope"), "");
});
