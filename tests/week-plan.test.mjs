import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planSlots, planWeek, normalizePlanItems, activeCampaignsFor, currentPlanEntry, defaultWeeklyCount, normTitle } from "../js/week-plan.js";

describe("defaultWeeklyCount", () => {
  test("unconfigured cadence falls back to 3", () => {
    assert.equal(defaultWeeklyCount(null), 3);
    assert.equal(defaultWeeklyCount({ configured: false }), 3);
    assert.equal(defaultWeeklyCount({ configured: true, uploadDays: [] }), 3);
  });
  test("follows Ritme Kerja: upload days x per day", () => {
    assert.equal(defaultWeeklyCount({ configured: true, uploadDays: ["mon", "wed", "fri"], perDay: 1 }), 3);
    assert.equal(defaultWeeklyCount({ configured: true, uploadDays: ["mon", "wed"], perDay: 2 }), 4);
  });
  test("caps at 14 even for a very busy cadence", () => {
    assert.equal(defaultWeeklyCount({ configured: true, uploadDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], perDay: 5 }), 14);
  });
});

describe("planSlots", () => {
  test("unconfigured cadence uses Tue/Thu/Sat", () => {
    // 2026-09-28 is a Monday.
    const slots = planSlots({ cadence: null, content: [], start: "2026-09-28", end: "2026-10-04", todayISO: "2026-09-28", count: 3 });
    assert.deepEqual(slots, ["2026-09-29", "2026-10-01", "2026-10-03"]);
  });
  test("never returns a date before today", () => {
    const slots = planSlots({ cadence: null, content: [], start: "2026-09-01", end: "2026-10-04", todayISO: "2026-09-28", count: 5 });
    assert.ok(slots.every((d) => d >= "2026-09-28"));
  });
  test("skips a day already holding content up to perDay", () => {
    const cadence = { configured: true, uploadDays: ["mon", "wed", "fri"], perDay: 1 };
    const content = [{ scheduleDate: "2026-09-28", status: "idea" }];
    const slots = planSlots({ cadence, content, start: "2026-09-28", end: "2026-10-04", todayISO: "2026-09-28", count: 3 });
    assert.deepEqual(slots, ["2026-09-30", "2026-10-02"]);
  });
  test("perDay: 2 allows a second post on an otherwise-full day", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 2 };
    const content = [{ scheduleDate: "2026-09-28" }];
    const slots = planSlots({ cadence, content, start: "2026-09-28", end: "2026-09-28", todayISO: "2026-09-28", count: 1 });
    assert.deepEqual(slots, ["2026-09-28"]);
  });
  test("a goal slot (fromGoal) occupies its day like any other content", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 1 };
    const content = [{ scheduleDate: "2026-09-28", fromGoal: "goal1", status: "idea" }];
    const slots = planSlots({ cadence, content, start: "2026-09-28", end: "2026-09-28", todayISO: "2026-09-28", count: 1 });
    assert.deepEqual(slots, []);
  });
  test("archived or deleted content does not hold its day", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 1 };
    const content = [
      { scheduleDate: "2026-09-28", archived: true },
      { scheduleDate: "2026-09-28", deletedAt: Date.now() },
    ];
    const slots = planSlots({ cadence, content, start: "2026-09-28", end: "2026-09-28", todayISO: "2026-09-28", count: 1 });
    assert.deepEqual(slots, ["2026-09-28"]);
  });
  test("a published item's publishedDate also occupies its day", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 1 };
    const content = [{ publishedDate: "2026-09-28", status: "published" }];
    const slots = planSlots({ cadence, content, start: "2026-09-28", end: "2026-09-28", todayISO: "2026-09-28", count: 1 });
    assert.deepEqual(slots, []);
  });
  test("bad start/end returns no slots instead of throwing", () => {
    assert.deepEqual(planSlots({ cadence: null, content: [], start: "", end: "", todayISO: "2026-09-28", count: 3 }), []);
  });
});

describe("planWeek", () => {
  test("today Sunday with default cadence: this week has nothing left, jumps to next week", () => {
    const plan = planWeek({ todayISO: "2026-09-27", cadence: null, content: [] });
    assert.equal(plan.label, "nextWeek");
    assert.equal(plan.start, "2026-09-28");
    assert.deepEqual(plan.slots, ["2026-09-29", "2026-10-01", "2026-10-03"]);
  });
  test("today Monday with default cadence: this week still has all 3 upload days", () => {
    const plan = planWeek({ todayISO: "2026-09-28", cadence: null, content: [] });
    assert.equal(plan.label, "thisWeek");
    assert.deepEqual(plan.slots, ["2026-09-29", "2026-10-01", "2026-10-03"]);
  });
  test("a genuine 1-post/week cadence still uses this week for its one slot", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 1 };
    const plan = planWeek({ todayISO: "2026-09-28", cadence, content: [], count: 3 });
    assert.equal(plan.label, "thisWeek");
    assert.deepEqual(plan.slots, ["2026-09-28", "2026-10-05", "2026-10-12"]);
  });
  test("both this week and next week full: keeps reaching forward, capped, and can come back empty", () => {
    const cadence = { configured: true, uploadDays: ["mon"], perDay: 1 };
    const content = [{ scheduleDate: "2026-09-28" }, { scheduleDate: "2026-10-05" }, { scheduleDate: "2026-10-12" }];
    const plan = planWeek({ todayISO: "2026-09-28", cadence, content, count: 3 });
    assert.deepEqual(plan.slots, []);
  });
  test("count above the requested cap is clamped to 14", () => {
    const cadence = { configured: true, uploadDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], perDay: 5 };
    const plan = planWeek({ todayISO: "2026-09-28", cadence, content: [], count: 99 });
    assert.equal(plan.count, 14);
  });
  test("a year boundary doesn't break date maths", () => {
    const plan = planWeek({ todayISO: "2026-12-28", cadence: null, content: [], count: 3 });
    assert.ok(plan.slots.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
    assert.ok(plan.slots.some((d) => d.startsWith("2027-")) || plan.slots.every((d) => d.startsWith("2026-")));
  });
});

describe("normalizePlanItems", () => {
  const slots = ["2026-09-29", "2026-10-01", "2026-10-03"];
  test("assigns each item to its own date when valid", () => {
    const raw = [
      { date: "2026-10-01", title: "B", angle: "b", format: "Reels", funnel: "MOFU" },
      { date: "2026-09-29", title: "A", angle: "a", format: "Reels", funnel: "TOFU" },
    ];
    const items = normalizePlanItems(raw, slots, { campaigns: [], formats: [{ name: "Reels" }] });
    assert.deepEqual(items.map((i) => i.date), slots.slice(0, 2));
    assert.equal(items[0].title, "A");
    assert.equal(items[1].title, "B");
  });
  test("an item with a bad or missing date fills a leftover slot in order", () => {
    const raw = [{ title: "A", angle: "" }, { title: "B", angle: "" }, { title: "C", angle: "" }];
    const items = normalizePlanItems(raw, slots, {});
    assert.deepEqual(items.map((i) => i.date), slots);
    assert.deepEqual(items.map((i) => i.title), ["A", "B", "C"]);
  });
  test("drops a duplicate title, keeping the first", () => {
    const raw = [{ title: "Same one", date: slots[0] }, { title: "same ONE ", date: slots[1] }, { title: "Different", date: slots[2] }];
    const items = normalizePlanItems(raw, slots, {});
    assert.equal(items.length, 2);
    assert.equal(items[1].title, "Different");
  });
  test("an unknown format is dropped rather than shown wrong", () => {
    const raw = [{ title: "A", date: slots[0], format: "Podcast" }];
    const items = normalizePlanItems(raw, slots, { formats: [{ name: "Reels" }, { name: "Carousel" }] });
    assert.equal(items[0].format, "");
  });
  test("no formats configured: whatever the model wrote is kept as-is", () => {
    const raw = [{ title: "A", date: slots[0], format: "Podcast" }];
    const items = normalizePlanItems(raw, slots, { formats: [] });
    assert.equal(items[0].format, "Podcast");
  });
  test("a bad funnel value falls back to TOFU", () => {
    const raw = [{ title: "A", date: slots[0], funnel: "nonsense" }];
    const items = normalizePlanItems(raw, slots, {});
    assert.equal(items[0].funnel, "TOFU");
  });
  test("a campaign name is matched case-insensitively to an active campaign", () => {
    const raw = [{ title: "A", date: slots[0], campaign: "summer SALE" }];
    const items = normalizePlanItems(raw, slots, { campaigns: [{ id: "c1", name: "Summer Sale" }] });
    assert.equal(items[0].campaignId, "c1");
    assert.equal(items[0].campaignName, "Summer Sale");
  });
  test("no matching campaign leaves campaignId empty", () => {
    const raw = [{ title: "A", date: slots[0], campaign: "Made Up" }];
    const items = normalizePlanItems(raw, slots, { campaigns: [{ id: "c1", name: "Summer Sale" }] });
    assert.equal(items[0].campaignId, "");
  });
  test("forceCampaign overrides every item's campaign regardless of what the model wrote", () => {
    const raw = [
      { title: "A", date: slots[0], campaign: "Some Other Campaign" },
      { title: "B", date: slots[1], campaign: "" },
    ];
    const items = normalizePlanItems(raw, slots, { campaigns: [{ id: "other", name: "Some Other Campaign" }], forceCampaign: { id: "c1", name: "Summer Sale" } });
    assert.ok(items.every((it) => it.campaignId === "c1" && it.campaignName === "Summer Sale"));
  });
  test("fewer items than slots: unfilled slots are dropped, not padded", () => {
    const raw = [{ title: "Only one", date: slots[0] }];
    const items = normalizePlanItems(raw, slots, {});
    assert.equal(items.length, 1);
  });
  test("more items than slots: extras are dropped", () => {
    const raw = slots.map((d, i) => ({ title: `T${i}`, date: d })).concat([{ title: "Extra", date: "2026-10-05" }]);
    const items = normalizePlanItems(raw, slots, {});
    assert.equal(items.length, 3);
  });
  test("titles and angles are capped to the same lengths as the campaign plan", () => {
    const raw = [{ title: "x".repeat(200), angle: "y".repeat(400), date: slots[0] }];
    const items = normalizePlanItems(raw, slots, {});
    assert.equal(items[0].title.length, 140);
    assert.equal(items[0].angle.length, 300);
  });
  test("no raw items at all yields an empty plan, not a throw", () => {
    assert.deepEqual(normalizePlanItems(null, slots, {}), []);
    assert.deepEqual(normalizePlanItems([], slots, {}), []);
  });
});

describe("activeCampaignsFor", () => {
  test("keeps planning and active, drops completed and archived", () => {
    const campaigns = [{ status: "planning" }, { status: "active" }, { status: "completed" }, { status: "archived" }];
    assert.deepEqual(activeCampaignsFor(campaigns).map((c) => c.status), ["planning", "active"]);
  });
});

describe("currentPlanEntry", () => {
  test("an unsaved, unclosed weekPlan on the newest real answer is current", () => {
    const entries = [
      { role: "user", text: "hi" },
      { role: "assistant", engine: "brainstorm", weekPlan: { items: [] } },
    ];
    assert.equal(currentPlanEntry(entries), entries[1]);
  });
  test("a saved plan is no longer current", () => {
    const entries = [{ role: "assistant", engine: "brainstorm", weekPlan: { items: [], savedAt: Date.now() } }];
    assert.equal(currentPlanEntry(entries), null);
  });
  test("a closed plan is no longer current", () => {
    const entries = [{ role: "assistant", engine: "brainstorm", weekPlan: { items: [], closed: true } }];
    assert.equal(currentPlanEntry(entries), null);
  });
  test("plain plan chatter (planTalk) is skipped so the plan underneath still counts", () => {
    const entries = [
      { role: "assistant", engine: "brainstorm", weekPlan: { items: [] } },
      { role: "user", text: "kok gitu?" },
      { role: "assistant", engine: "brainstorm", planTalk: true, text: "itu karena..." },
    ];
    assert.equal(currentPlanEntry(entries), entries[0]);
  });
  test("an error bubble (no engine) is skipped", () => {
    const entries = [
      { role: "assistant", engine: "brainstorm", weekPlan: { items: [] } },
      { role: "assistant", text: "gagal", retry: "x" },
    ];
    assert.equal(currentPlanEntry(entries), entries[0]);
  });
  test("a normal answer after the plan closes it", () => {
    const entries = [
      { role: "assistant", engine: "brainstorm", weekPlan: { items: [] } },
      { role: "assistant", engine: "consultant", text: "something else" },
    ];
    assert.equal(currentPlanEntry(entries), null);
  });
  test("no entries at all", () => {
    assert.equal(currentPlanEntry([]), null);
  });
});

describe("normTitle", () => {
  test("trims, lowercases and collapses whitespace", () => {
    assert.equal(normTitle("  Some   Title  "), "some title");
  });
  test("non-string input never throws", () => {
    assert.equal(normTitle(null), "");
    assert.equal(normTitle(undefined), "");
  });
});
