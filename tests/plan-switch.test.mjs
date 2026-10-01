// Plan switching end to end, without Firestore: what create-transaction
// quotes (switchQuote), what the webhook writes once it's paid
// (settlePlanPurchase) and what the daily cron switches over
// (dueSchedulePatch) — the three steps an account actually goes through.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PLANS, switchQuote, settlePlanPurchase, dueSchedulePatch, runningSubscription } from "../api/_plans.js";

const DAY = 86400000;
const t0 = Date.UTC(2026, 9, 1);
const sub = (plan, billing, daysLeft, extra = {}) => ({
  plan, billing, status: "active", brandLimit: PLANS[`${plan}-${billing}`].brandLimit,
  subscriptionExpiresAt: t0 + daysLeft * DAY, ...extra,
});

// One paid checkout: quote at `now`, settle it right away, merge the patch
// the way the webhook's { merge: true } write does. Returns what was paid.
function buy(account, planKey, now) {
  const q = switchQuote(account, planKey, PLANS[planKey].amount, now);
  if (q.mode === "refused") return { account, quote: q, paid: 0 };
  const d = settlePlanPurchase(account, planKey, { mode: q.mode, amount: q.amount, credit: q.credit, price: PLANS[planKey].amount }, now);
  assert.equal(d.issue, undefined, `unexpected issue ${d.issue}`);
  return { account: { ...account, ...d.patch }, quote: q, paid: q.amount };
}
const cron = (account, now) => ({ ...account, ...(dueSchedulePatch(account, now) || {}) });

describe("a queued downgrade waits for the running plan's own period (S-14)", () => {
  test("it starts when the running plan ends, and carries its own end", () => {
    const studio = sub("studio", "monthly", 2);
    const q = switchQuote(studio, "starter-monthly", 49000, t0);
    assert.deepEqual(q, { mode: "later", amount: 49000, credit: 0, startsAt: t0 + 2 * DAY });
    const d = settlePlanPurchase(studio, "starter-monthly", { mode: "later" }, t0);
    assert.equal(d.scheduled, true);
    assert.deepEqual(d.patch.scheduledPlan, { plan: "starter", billing: "monthly", brandLimit: 1, startsAt: t0 + 2 * DAY, endsAt: t0 + 32 * DAY });
    assert.equal(d.patch.subscriptionExpiresAt, t0 + 32 * DAY);
    assert.equal(d.patch.plan, undefined, "the running plan stays until its period ends");
  });

  test("a second downgrade while one is queued is refused", () => {
    let acc = buy(sub("studio", "monthly", 2), "starter-monthly", t0).account;
    const q = switchQuote(acc, "starter-monthly", 49000, t0 + DAY);
    assert.equal(q.mode, "refused");
    assert.equal(q.code, "scheduled");
    assert.equal(q.startsAt, t0 + 2 * DAY, "the queued plan's start never moves");
    assert.equal(switchQuote(acc, "pro-monthly", 99000, t0 + DAY).code, "scheduled");
  });

  test("two downgrade checkouts paid one after the other: the second is flagged, never stacked", () => {
    const acc = buy(sub("studio", "monthly", 2), "starter-monthly", t0).account;
    const d = settlePlanPurchase(acc, "pro-monthly", { mode: "later" }, t0 + 60_000);
    assert.deepEqual(d, { issue: "schedule-conflict" });
  });

  test("audit scenario: a Studio subscriber buying Starter 'for later' every month drops to Starter on time", () => {
    let acc = sub("studio", "monthly", 30);
    let paid = 249000;
    for (let day = 0; day <= 150; day++) {
      const now = t0 + day * DAY;
      acc = cron(acc, now);
      // Two days before the running period ends, try to queue Starter again.
      const run = runningSubscription(acc, now);
      if (run && run.periodEnd - now <= 2 * DAY) {
        const r = buy(acc, "starter-monthly", now);
        acc = r.account;
        paid += r.paid;
      }
      if (day === 31) {
        assert.equal(acc.plan, "starter");
        assert.equal(acc.brandLimit, 1);
      }
    }
    // Studio ran exactly its one paid month; every month after that was a
    // Starter month, paid at Starter's price.
    assert.equal(acc.plan, "starter");
    assert.equal(paid, 249000 + 5 * 49000);
    assert.ok(acc.subscriptionExpiresAt <= t0 + 180 * DAY);
  });

  test("audit variant: queueing Starter, then upgrading to Studio yearly saves nothing", () => {
    const studio = sub("studio", "monthly", 1);
    const direct = switchQuote(studio, "studio-yearly", 1990000, t0);
    assert.equal(direct.credit, 8300); // 249.000 × 1/30
    const withStarter = buy(studio, "starter-monthly", t0);
    const q = switchQuote(withStarter.account, "studio-yearly", 1990000, t0);
    assert.equal(q.mode, "now");
    // Studio's own day at Studio's price + the prepaid Starter month at
    // Starter's price — not 31 days at Studio's price.
    assert.equal(q.credit, 8300 + 49000);
    assert.equal(q.replacesScheduled, true);
    assert.equal(withStarter.paid + q.amount, direct.amount);
  });

  test("an upgrade replaces the queued downgrade with a fresh period", () => {
    const acc = buy(sub("pro", "monthly", 10), "starter-monthly", t0).account;
    const d = settlePlanPurchase(acc, "studio-monthly", { mode: "now" }, t0 + DAY);
    assert.equal(d.patch.plan, "studio");
    assert.equal(d.patch.scheduledPlan, null);
    assert.equal(d.patch.subscriptionExpiresAt, t0 + DAY + 30 * DAY);
  });

  test("renewing the running plan moves a queued downgrade back instead of swallowing it", () => {
    const acc = buy(sub("studio", "monthly", 5), "starter-monthly", t0).account;
    const q = switchQuote(acc, "studio-monthly", 249000, t0 + DAY);
    assert.equal(q.mode, "renew");
    assert.equal(q.scheduledStartsAt, t0 + 35 * DAY);
    const d = settlePlanPurchase(acc, "studio-monthly", { mode: "renew" }, t0 + DAY);
    assert.equal(d.patch.subscriptionExpiresAt, t0 + 65 * DAY);
    assert.deepEqual(d.patch.scheduledPlan, { plan: "starter", billing: "monthly", brandLimit: 1, startsAt: t0 + 35 * DAY, endsAt: t0 + 65 * DAY });
  });

  test("a queued plan whose day has come counts as the running plan, before the cron writes it", () => {
    const acc = buy(sub("studio", "monthly", 2), "starter-monthly", t0).account;
    const later = t0 + 3 * DAY;
    assert.equal(switchQuote(acc, "starter-monthly", 49000, later).mode, "renew");
    assert.equal(switchQuote(acc, "studio-monthly", 249000, later).mode, "now");
    const patch = dueSchedulePatch(acc, later);
    assert.deepEqual(patch, { plan: "starter", billing: "monthly", brandLimit: 1, scheduledPlan: null });
    assert.equal(dueSchedulePatch(acc, t0 + DAY), null, "not before its day");
  });

  test("accounts stacked before the fix only get one queued period credited", () => {
    // Three Starter months pushed onto a Studio account the old way.
    const stacked = sub("studio", "monthly", 1, { scheduledPlan: { plan: "starter", billing: "monthly", brandLimit: 1, startsAt: t0 + DAY }, subscriptionExpiresAt: t0 + 91 * DAY });
    const q = switchQuote(stacked, "studio-yearly", 1990000, t0);
    assert.equal(q.credit, 8300 + 49000);
  });

  test("a downgrade paid after the running plan already ended starts right away", () => {
    const pro = sub("pro", "monthly", 1);
    const d = settlePlanPurchase(pro, "starter-monthly", { mode: "later" }, t0 + 2 * DAY);
    assert.equal(d.patch.plan, "starter");
    assert.equal(d.patch.subscriptionExpiresAt, t0 + 32 * DAY);
  });
});

describe("switchQuote edge cases", () => {
  test("credit is rounded down to Rp 100", () => {
    const q = switchQuote(sub("starter", "monthly", 7), "pro-monthly", 99000, t0);
    assert.equal(q.credit, 11400); // 49.000 × 7/30 = 11.433,33
    assert.equal(q.amount, 99000 - 11400);
  });
  test("a plan that already ended gives no credit (never a negative one)", () => {
    assert.deepEqual(switchQuote(sub("studio", "yearly", -3), "pro-monthly", 99000, t0), { mode: "new", amount: 99000, credit: 0 });
  });
  test("paid plus credit always adds up to the price", () => {
    for (const days of [0.01, 1, 13, 29.99, 30]) {
      const q = switchQuote(sub("pro", "monthly", days), "studio-monthly", 249000, t0);
      assert.equal(q.amount + q.credit, 249000);
      assert.ok(q.amount >= 1000);
    }
  });
});

describe("what a paid plan writes", () => {
  test("a new subscription starts today and clears the trial", () => {
    const d = settlePlanPurchase({ plan: "trial", status: "active", trialEndsAt: t0 + DAY }, "pro-monthly", { mode: "new" }, t0);
    assert.deepEqual(d.patch, { plan: "pro", paidAt: t0, trialEndsAt: null, status: "active", billing: "monthly", brandLimit: 3, subscriptionExpiresAt: t0 + 30 * DAY, scheduledPlan: null });
  });
  test("paying again re-opens a lapsed account but never one an admin deactivated (S-22)", () => {
    assert.equal(settlePlanPurchase({ plan: "pro", status: "readonly", subscriptionExpiresAt: t0 - DAY }, "pro-monthly", {}, t0).patch.status, "active");
    const d = settlePlanPurchase({ plan: "pro", status: "deactivated", subscriptionExpiresAt: t0 + DAY }, "pro-monthly", {}, t0);
    assert.equal("status" in d.patch, false);
  });
  test("the cron's switch-over never touches status", () => {
    const acc = { plan: "studio", status: "deactivated", scheduledPlan: { plan: "starter", billing: "monthly", brandLimit: 1, startsAt: t0 } };
    assert.equal("status" in dueSchedulePatch(acc, t0), false);
  });
  test("Founder is pay-once: no end date, the Brand Book styles, one seat", () => {
    const d = settlePlanPurchase({ plan: "trial", status: "active" }, "founder", { mode: "new", amount: 499000, price: 499000 }, t0);
    assert.equal(d.patch.plan, "founder");
    assert.equal(d.patch.subscriptionExpiresAt, null);
    assert.equal(d.grantBookStyles, true);
    assert.equal(d.takesSeat, true);
  });
});
