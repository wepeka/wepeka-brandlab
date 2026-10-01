// The write gate of firestore.rules (accountActive) through its JS mirror,
// plus the auto-renew charge patch — the two places audit S-22 touched.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { writableByRules, isReadOnly } from "../js/account.js";
import { renewalChargePatch } from "../api/_plans.js";

const now = Date.UTC(2026, 9, 1);
const DAY = 86400000;

describe("who may write (firestore.rules accountActive)", () => {
  test("a running subscription writes", () => {
    assert.equal(writableByRules({ plan: "pro", status: "active", subscriptionExpiresAt: now + DAY }, now), true);
  });
  test("a lapsed subscription is read-only from its last second, before the cron runs", () => {
    const lapsed = { plan: "pro", status: "active", subscriptionExpiresAt: now - 1 };
    assert.equal(writableByRules(lapsed, now), false);
    assert.equal(isReadOnly({ ...lapsed, subscriptionExpiresAt: Date.now() - 1 }), true);
  });
  test("Lifetime has no end date and always writes", () => {
    assert.equal(writableByRules({ plan: "founder", status: "active", subscriptionExpiresAt: null }, now), true);
    assert.equal(writableByRules({ plan: "founder-ultimate", status: "active" }, now), true);
  });
  test("a trial writes until it ends", () => {
    assert.equal(writableByRules({ plan: "trial", status: "active", trialEndsAt: now + 1 }, now), true);
    assert.equal(writableByRules({ plan: "trial", status: "active", trialEndsAt: now }, now), false);
  });
  test("free, readonly and deactivated never write", () => {
    assert.equal(writableByRules({ plan: "free", status: "active" }, now), false);
    assert.equal(writableByRules({ plan: "pro", status: "readonly", subscriptionExpiresAt: now + DAY }, now), false);
    assert.equal(writableByRules({ plan: "founder", status: "deactivated" }, now), false);
  });
});

describe("auto-renew charge", () => {
  const pro = { plan: "pro", billing: "monthly", status: "active", subscriptionExpiresAt: now + 2 * DAY };
  test("adds a period from the current end", () => {
    assert.deepEqual(renewalChargePatch(pro, "pro-monthly", now), { subscriptionExpiresAt: now + 32 * DAY, status: "active" });
  });
  test("never re-activates a deactivated account (S-22)", () => {
    assert.equal("status" in renewalChargePatch({ ...pro, status: "deactivated" }, "pro-monthly", now), false);
  });
  test("a charge for another plan is a stray and changes nothing", () => {
    assert.equal(renewalChargePatch(pro, "studio-monthly", now), null);
  });
});
