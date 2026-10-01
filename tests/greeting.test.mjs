import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { greetingKey } from "../js/brand-pulse.js";
import { t } from "../js/i18n.js";

const KEY = {
  pagi: "companion.greeting.morning",
  siang: "companion.greeting.midday",
  sore: "companion.greeting.afternoon",
  malam: "companion.greeting.evening",
};

describe("greetingKey (Teman Brand greeting by hour)", () => {
  test("after midnight is still malam, not pagi", () => {
    for (const h of [0, 1, 2, 3]) assert.equal(greetingKey(h), KEY.malam, `hour ${h}`);
  });
  test("04–10 is pagi", () => {
    for (const h of [4, 7, 10]) assert.equal(greetingKey(h), KEY.pagi, `hour ${h}`);
  });
  test("11–14 is siang", () => {
    for (const h of [11, 12, 14]) assert.equal(greetingKey(h), KEY.siang, `hour ${h}`);
  });
  test("15–17 is sore", () => {
    for (const h of [15, 16, 17]) assert.equal(greetingKey(h), KEY.sore, `hour ${h}`);
  });
  test("18–23 is malam", () => {
    for (const h of [18, 21, 23]) assert.equal(greetingKey(h), KEY.malam, `hour ${h}`);
  });
  test("every key it can return has copy in the dictionary", () => {
    for (let h = 0; h < 24; h++) {
      const key = greetingKey(h);
      assert.notEqual(t(key), key, `missing i18n for ${key}`);
    }
  });
});
