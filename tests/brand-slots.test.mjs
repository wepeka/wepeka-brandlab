import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { nextBrandSlots } from "../api/_plans.js";
import { brandLimitOf, lockedBrandIds } from "../js/account.js";

const DAY = 86400000;
const MONTH = 30 * DAY;
const now = Date.UTC(2026, 8, 29);

describe("nextBrandSlots (monthly brand slot purchase)", () => {
  test("a new slot runs 30 days from now", () => {
    assert.deepEqual(nextBrandSlots([], now, MONTH), [now + MONTH]);
  });
  test("a new slot reuses a lapsed one instead of growing the list", () => {
    assert.deepEqual(nextBrandSlots([now - DAY, now + 5 * DAY], now, MONTH), [now + MONTH, now + 5 * DAY]);
  });
  test("renew extends the slot ending soonest, from its own end when still running", () => {
    assert.deepEqual(nextBrandSlots([now + 3 * DAY, now + 20 * DAY], now, MONTH, { renew: true }), [now + 3 * DAY + MONTH, now + 20 * DAY]);
  });
  test("renew after it lapsed runs 30 days from now", () => {
    assert.deepEqual(nextBrandSlots([now - 4 * DAY], now, MONTH, { renew: true }), [now + MONTH]);
  });
});

describe("brand limit + preview-only brands", () => {
  const brands = [
    { id: "a", createdAt: 1 }, { id: "b", createdAt: 2 }, { id: "c", createdAt: 3 }, { id: "old", createdAt: 0, archived: true },
  ];
  test("limit = plan + permanent slots + monthly slots still running", () => {
    assert.equal(brandLimitOf({ brandLimit: 1, extraBrands: 2, brandSlotsUntil: [now + DAY, now - DAY] }, now), 4);
  });
  test("a lapsed monthly slot locks the newest active brand over the limit", () => {
    const account = { brandLimit: 2, brandSlotsUntil: [now - DAY] };
    assert.deepEqual([...lockedBrandIds(brands, account, now)], ["c"]);
  });
  test("while the slot runs nothing is locked", () => {
    const account = { brandLimit: 2, brandSlotsUntil: [now + DAY] };
    assert.equal(lockedBrandIds(brands, account, now).size, 0);
  });
  test("every account over its limit is held to it — a Studio → Starter downgrade keeps 1 brand open (S-16)", () => {
    assert.deepEqual([...lockedBrandIds(brands, { plan: "starter", brandLimit: 1 }, now)], ["b", "c"]);
  });
  test("archiving an older brand frees its place", () => {
    const withArchive = brands.map((b) => (b.id === "a" ? { ...b, archived: true } : b));
    assert.deepEqual([...lockedBrandIds(withArchive, { brandLimit: 1 }, now)], ["c"]);
  });
  test("Wepeka's own team account is never locked", () => {
    assert.equal(lockedBrandIds(brands, { uid: "iSwfTtIQm6VkYoHFbI6wl7BzBF53", brandLimit: 1 }, now).size, 0);
  });
});
