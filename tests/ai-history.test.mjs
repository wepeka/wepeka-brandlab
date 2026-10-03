import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanHistory } from "../api/ai.js";

// api/ai.js sends a chat's earlier turns to the provider as real turns.
// Whatever the browser sends, what reaches the provider must alternate,
// start with the owner and end on the assistant (the newest message goes
// separately as `user`) — Anthropic refuses anything else.
describe("cleanHistory (api/ai.js)", () => {
  test("keeps alternating user/assistant turns as they are", () => {
    const h = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }];
    assert.deepEqual(cleanHistory(h), h);
  });
  test("merges neighbours with the same role, drops empty and unknown ones", () => {
    const h = [{ role: "user", content: "a" }, { role: "user", content: "a2" }, { role: "system", content: "x" }, { role: "assistant", content: "  " }, { role: "assistant", content: "b" }];
    assert.deepEqual(cleanHistory(h), [{ role: "user", content: "a\n\na2" }, { role: "assistant", content: "b" }]);
  });
  test("starts with the owner and ends on the assistant", () => {
    const h = [{ role: "assistant", content: "hi" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "dangling" }];
    assert.deepEqual(cleanHistory(h), [{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  });
  test("anything that isn't a list is no history; it is capped", () => {
    assert.deepEqual(cleanHistory("nope"), []);
    assert.deepEqual(cleanHistory(null), []);
    const long = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
    assert.ok(cleanHistory(long).length <= 40);
  });
});
