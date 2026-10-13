// A "buy" button's plan, carried through sign-in (js/buy-intent.js): kept
// for one use, for a while, and only when it names a real plan.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { rememberBuyIntent, takeBuyIntent, isBuyablePlanKey, BUY_INTENT_FRESH_MS } = await import("../js/buy-intent.js");
const { PLANS } = await import("../api/_plans.js");
const { buyUrl, WEPEKA_CONNECT_URL } = await import("../js/site-links.js");

describe("buy intent", () => {
  beforeEach(() => mem.clear());

  test("every plan the server sells can be carried, and nothing else", () => {
    for (const key of Object.keys(PLANS)) assert.equal(isBuyablePlanKey(key), true, key);
    for (const key of ["", null, undefined, "trial", "free", "founder-monthly", "pro", "ai-unlimited", "founder'><script>", "FOUNDER"]) {
      assert.equal(isBuyablePlanKey(key), false, String(key));
    }
  });

  test("remembered once: reading it forgets it", () => {
    assert.equal(rememberBuyIntent("founder"), true);
    assert.equal(takeBuyIntent(), "founder");
    assert.equal(takeBuyIntent(), null);
  });

  test("a plan that does not exist is never remembered", () => {
    assert.equal(rememberBuyIntent("founder-forever"), false);
    assert.equal(takeBuyIntent(), null);
  });

  test("a stale wish opens nothing", () => {
    const then = Date.now();
    rememberBuyIntent("pro-yearly", then);
    assert.equal(takeBuyIntent(then + BUY_INTENT_FRESH_MS + 1), null);
    rememberBuyIntent("pro-yearly", then);
    assert.equal(takeBuyIntent(then + BUY_INTENT_FRESH_MS - 1), "pro-yearly");
  });

  test("whatever else sits in storage is ignored (and cleared)", () => {
    mem.set("brandlab:buy-intent", "not json");
    assert.equal(takeBuyIntent(), null);
    mem.set("brandlab:buy-intent", JSON.stringify({ planKey: "lifetime", at: Date.now() }));
    assert.equal(takeBuyIntent(), null);
    assert.equal(mem.size, 0);
  });

  test("the buy link asks wepeka.com for the plans page and names the plan", () => {
    assert.equal(buyUrl("founder"), `${WEPEKA_CONNECT_URL}?to=pricing&plan=founder`);
    assert.equal(buyUrl("starter-monthly"), `${WEPEKA_CONNECT_URL}?to=pricing&plan=starter-monthly`);
  });
});
