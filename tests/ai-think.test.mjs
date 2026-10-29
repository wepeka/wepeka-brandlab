import { test } from "node:test";
import assert from "node:assert/strict";

import { deepSeekBody, THINK_FEATURES } from "../api/ai.js";

test("the chat partners think; everything else stays quick", () => {
  assert.deepEqual([...THINK_FEATURES].sort(), ["brainstorm", "consultant", "discuss"]);
  for (const f of ["route", "insights", "sales", "report", "companion", "recap"]) assert.equal(THINK_FEATURES.has(f), false, f);
});

test("thinking gets its own token room and drops temperature", () => {
  const on = deepSeekBody("s", "u", 1000, { temperature: 0.7, think: true });
  assert.deepEqual(on.thinking, { type: "enabled" });
  assert.equal(on.max_tokens, 7000);
  assert.equal(on.temperature, undefined);
  const off = deepSeekBody("s", "u", 1000, { temperature: 0.7 });
  assert.deepEqual(off.thinking, { type: "disabled" });
  assert.equal(off.max_tokens, 1000);
  assert.equal(off.temperature, 0.7);
});
