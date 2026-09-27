import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { quotaFor, usedInPeriod, consumeQuota, isAdminUid, ADMIN_UIDS, DEFAULT_AI_DAILY_LIMIT } from "../api/_aiQuota.js";

describe("quotaFor", () => {
  test("trial plan is a total-lifetime cap", () => {
    assert.deepEqual(quotaFor({ plan: "trial" }, "some-uid"), { period: "total", limit: 60 });
  });

  test("starter plan is a daily cap", () => {
    assert.deepEqual(quotaFor({ plan: "starter" }, "some-uid"), { period: "day", limit: 20 });
  });

  test("founder plan is a monthly cap", () => {
    assert.deepEqual(quotaFor({ plan: "founder" }, "some-uid"), { period: "month", limit: 300 });
  });

  test("admin uid is unmetered regardless of plan", () => {
    const admin = ADMIN_UIDS[0];
    assert.ok(isAdminUid(admin));
    const q = quotaFor({ plan: "starter" }, admin);
    assert.equal(q.limit, Infinity);
    assert.equal(q.period, "day"); // period still comes from the plan's own table
  });

  test("a read-only account (ended trial) gets zero, not the plan's normal limit", () => {
    const q = quotaFor({ plan: "trial", trialEndsAt: Date.now() - 1000 }, "some-uid");
    assert.equal(q.limit, 0);
  });

  test("an explicitly readonly-status account also gets zero", () => {
    const q = quotaFor({ plan: "pro", status: "readonly" }, "some-uid");
    assert.equal(q.limit, 0);
  });

  test("aiDailyLimit overrides the limit but not the plan's period", () => {
    const q = quotaFor({ plan: "founder", aiDailyLimit: 5 }, "some-uid");
    assert.equal(q.limit, 5);
    assert.equal(q.period, "month");
  });

  test("an unknown/missing plan falls back to the default daily limit", () => {
    const q = quotaFor({}, "some-uid");
    assert.deepEqual(q, { period: "day", limit: DEFAULT_AI_DAILY_LIMIT });
  });
});

describe("usedInPeriod", () => {
  test("no usage doc yet counts as 0", () => {
    assert.equal(usedInPeriod(null, "day"), 0);
  });

  test("total period always reads totalCount", () => {
    assert.equal(usedInPeriod({ totalCount: 42 }, "total"), 42);
  });

  test("day period only counts when the stored date matches today (Asia/Jakarta)", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    assert.equal(usedInPeriod({ date: today, count: 7 }, "day", now), 7);
    assert.equal(usedInPeriod({ date: "2020-01-01", count: 7 }, "day", now), 0);
  });

  test("month period rolls over: a stale month's monthCount doesn't carry forward", () => {
    const now = new Date("2026-09-27T10:00:00Z");
    assert.equal(usedInPeriod({ month: "2026-09", monthCount: 15 }, "month", now), 15);
    assert.equal(usedInPeriod({ month: "2026-08", monthCount: 15 }, "month", now), 0);
  });
});

// A tiny fake of the Firestore Admin SDK surface consumeQuota() actually
// calls: db.doc(path) -> a ref, db.runTransaction(fn) -> runs fn against a
// fake transaction backed by an in-memory doc.
function makeFakeDb(initialData) {
  let stored = initialData ? { ...initialData } : null;
  const ref = { path: "aiUsage/fake-uid" };
  return {
    doc() {
      return ref;
    },
    async runTransaction(fn) {
      const tx = {
        async get() {
          return { exists: stored !== null, data: () => stored };
        },
        set(_ref, data) {
          stored = { ...data };
        },
      };
      return fn(tx);
    },
    _read() {
      return stored;
    },
  };
}

describe("consumeQuota", () => {
  test("first call today creates the usage doc with count 1", async () => {
    const db = makeFakeDb(null);
    const now = new Date("2026-09-27T10:00:00Z");
    const { used } = await consumeQuota(db, "fake-uid", "day", now);
    assert.equal(used, 1);
    assert.equal(db._read().count, 1);
  });

  test("a same-day repeat call increments count", async () => {
    const today = new Date("2026-09-27T10:00:00Z").toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const db = makeFakeDb({ date: today, count: 3, month: today.slice(0, 7), monthCount: 3, totalCount: 3 });
    const { used } = await consumeQuota(db, "fake-uid", "day", new Date("2026-09-27T10:00:00Z"));
    assert.equal(used, 4);
  });

  test("a call on a new day resets the day count but keeps totalCount growing", async () => {
    const db = makeFakeDb({ date: "2020-01-01", count: 9, month: "2020-01", monthCount: 9, totalCount: 9 });
    const { used } = await consumeQuota(db, "fake-uid", "day", new Date("2026-09-27T10:00:00Z"));
    assert.equal(used, 1); // day reset
    assert.equal(db._read().totalCount, 10); // total keeps accumulating
  });

  test("a call in a new month resets monthCount for the month period", async () => {
    const db = makeFakeDb({ date: "2026-08-31", count: 1, month: "2026-08", monthCount: 40, totalCount: 100 });
    const { used } = await consumeQuota(db, "fake-uid", "month", new Date("2026-09-01T00:30:00Z"));
    assert.equal(used, 1);
  });
});
