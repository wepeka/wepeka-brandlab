import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { emulatorWanted, IS_EMULATOR, EMULATOR_CONFIG } from "../js/emulator.js";

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const at = (href) => new URL(href);

describe("emulator switch (js/emulator.js)", () => {
  test("never on the production hosts, whatever the query says", () => {
    for (const href of ["https://brandlab.wepeka.com/?emu=1", "https://planner.wepeka.com/?emu=1", "https://content-os.vercel.app/?emu=1"]) {
      const s = memory();
      s.setItem("brandlab:emu", "1");
      assert.equal(emulatorWanted(at(href), s), false, href);
    }
  });
  test("never on another local port", () => {
    const s = memory();
    assert.equal(emulatorWanted(at("http://localhost:3000/?emu=1"), s), false);
    assert.equal(s.getItem("brandlab:emu"), null);
  });
  test("?emu=1 on the dev server turns it on and is remembered; ?emu=0 turns it off", () => {
    const s = memory();
    assert.equal(emulatorWanted(at("http://localhost:8743/"), s), false);
    assert.equal(emulatorWanted(at("http://localhost:8743/?emu=1"), s), true);
    assert.equal(emulatorWanted(at("http://localhost:8743/#/brand/x"), s), true);
    assert.equal(emulatorWanted(at("http://127.0.0.1:8743/?emu=0"), s), false);
    assert.equal(emulatorWanted(at("http://localhost:8743/"), s), false);
  });
  test("storage that throws means off", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
    assert.equal(emulatorWanted(at("http://localhost:8743/?emu=1"), broken), false);
  });
  test("off in Node (no location) and the emulator project is a demo-* id", () => {
    assert.equal(IS_EMULATOR, false);
    assert.match(EMULATOR_CONFIG.projectId, /^demo-/);
  });
});
