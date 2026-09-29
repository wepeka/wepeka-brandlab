import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { switchQuote, subscriptionName, subscriptionNameFromOrder, recurringFor, MIN_CHARGE } from "../api/_plans.js";

const DAY = 86400000;
const now = Date.UTC(2026, 8, 29);
const sub = (plan, billing, daysLeft) => ({ plan, billing, status: "active", subscriptionExpiresAt: now + daysLeft * DAY });

describe("switchQuote: plans replace each other, never stack", () => {
  test("nothing running: full price", () => {
    assert.deepEqual(switchQuote({ plan: "trial", status: "active" }, "pro-monthly", 99000, now), { mode: "new", amount: 99000, credit: 0 });
  });
  test("same plan and billing: plain renewal at full price", () => {
    assert.equal(switchQuote(sub("pro", "monthly", 10), "pro-monthly", 99000, now).mode, "renew");
  });
  test("upgrade starts now with the unused days off the price", () => {
    const q = switchQuote(sub("starter", "monthly", 25), "pro-monthly", 99000, now);
    assert.equal(q.mode, "now");
    assert.equal(q.credit, 40800); // 49.000 × 25/30, rounded down to Rp 100
    assert.equal(q.amount, 99000 - 40800);
  });
  test("monthly → yearly of the same plan is an upgrade", () => {
    assert.equal(switchQuote(sub("pro", "monthly", 15), "pro-yearly", 799000, now).mode, "now");
  });
  test("subscription → Lifetime is an upgrade, credit off the Founder price", () => {
    const q = switchQuote(sub("studio", "monthly", 30), "founder", 499000, now);
    assert.equal(q.mode, "now");
    assert.equal(q.credit, 249000);
    assert.equal(q.amount, 250000);
  });
  test("downgrade waits for the current period to end, no credit", () => {
    const q = switchQuote(sub("pro", "monthly", 12), "starter-monthly", 49000, now);
    assert.deepEqual(q, { mode: "later", amount: 49000, credit: 0, startsAt: now + 12 * DAY });
  });
  test("yearly → monthly of the same plan is a downgrade", () => {
    assert.equal(switchQuote(sub("pro", "yearly", 200), "pro-monthly", 99000, now).mode, "later");
  });
  test("a credit bigger than the new price never makes it free or negative", () => {
    const q = switchQuote(sub("studio", "yearly", 360), "founder", 499000, now);
    assert.equal(q.amount, MIN_CHARGE);
  });
});

describe("auto-renew naming", () => {
  test("a subscription's charges map back to its name, with or without a dash", () => {
    const name = subscriptionName("iSwfTtIQm6VkYoHFbI6wl7BzBF53", now);
    assert.ok(name.length <= 40);
    const digits = "1".repeat(32);
    assert.equal(subscriptionNameFromOrder(`${name}-${digits}`), name);
    assert.equal(subscriptionNameFromOrder(`${name}${digits}`), name);
    assert.equal(subscriptionNameFromOrder(`bl-abc-${Date.now().toString(36)}`), null); // a normal Snap order
  });
  test("what can renew itself", () => {
    assert.equal(recurringFor("pro-yearly").interval, 12);
    assert.equal(recurringFor("starter-monthly").slot, "plan");
    assert.equal(recurringFor("ai-unlimited").slot, "aiUnlimited");
    assert.match(recurringFor("addon-brand-sub").slot, /^brand_/);
    assert.equal(recurringFor("founder"), null);
    assert.equal(recurringFor("ai-300"), null);
  });
});
