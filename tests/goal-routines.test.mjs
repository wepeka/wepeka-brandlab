// "Rutin minggu ini" (owner, 2026-10-29): in a goal's "Yang perlu
// dikerjakan", what comes back every week sits on top and asks again each
// week — a series on the days it airs (Ritme Kerja), and the goal's own
// weekly routines (a community ritual, a "+ Tugas" set to repeat), whose
// tick only covers this week. Content of a series carries its name.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { initStore, createBrand, createCampaign, createContent, createSeries, updateBrand, getCampaign, getBrand, listContent } from "../js/store.js";
import { goalTodo, routineStreak, routinesThisWeek, openCount, RITUAL_WEEKS } from "../js/goal-todo.js";
import { addGoalRoutine, toggleGoalRoutineWeek, removeGoalRoutine } from "../js/goal-actions.js";

const TODAY = "2026-10-29"; // a Thursday; its week runs Mon 26 Oct – Sun 1 Nov

const social = (brandId) => createCampaign(brandId, {
  name: "Sosmed Growth", status: "active", goalPlan: { version: 3, track: "social" },
  missions: [{ id: "l1", name: "Level satu", milestones: [{ id: "m-f", kind: "number", metric: "manual.number", label: "Followers", target: 100, required: true }] }],
});

describe("routineStreak", () => {
  test("counts back from this week, or from last week while this one is open", () => {
    assert.equal(routineStreak([], "2026-10-26"), 0);
    assert.equal(routineStreak(["2026-10-12", "2026-10-19", "2026-10-26"], "2026-10-26"), 3);
    assert.equal(routineStreak(["2026-10-12", "2026-10-19"], "2026-10-26"), 2);
    assert.equal(routineStreak(["2026-10-05", "2026-10-19"], "2026-10-26"), 1);
  });
});

describe("Rutin minggu ini", () => {
  let brand, bedah, tanya;
  before(async () => {
    await initStore("test-uid-goal-routines");
    brand = createBrand({ name: "Kopi Senja" });
    bedah = createSeries(brand.id, { name: "Bedah Brand" });
    tanya = createSeries(brand.id, { name: "Tanya Kopi" });
    updateBrand(brand.id, { contentCadence: { configured: true, uploadDays: ["mon", "wed", "fri"], perDay: 1, seriesDays: { wed: bedah.id, fri: tanya.id } } });
  });

  test("a social goal: one row per series day; the week's episode fills it, else it asks for one", () => {
    const c = social(brand.id);
    createContent(brand.id, { title: "Bedah Uniqlo", status: "draft", seriesId: bedah.id, scheduleDate: "2026-10-28", campaignId: c.id });
    createContent(brand.id, { title: "Bedah lama", status: "published", seriesId: bedah.id, publishedDate: "2026-10-21" });
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: listContent(brand.id), today: TODAY });
    const rows = todo.routine.rows;
    assert.equal(todo.routine.monday, "2026-10-26");
    assert.deepEqual(rows.map((r) => [r.kind, r.label, r.date]), [["series", "Bedah Brand", "2026-10-28"], ["series", "Tanya Kopi", "2026-10-30"]]);
    assert.equal(rows[0].episode.title, "Bedah Uniqlo");
    assert.equal(rows[0].late, true, "Wednesday passed and it isn't out yet");
    assert.equal(rows[1].episode, null);
    // The episode shown in the routine is not listed twice.
    assert.ok(!todo.items.some((x) => x.label === "Bedah Uniqlo"));
    assert.equal(openCount(todo), todo.items.length + 2);
  });

  test("a published episode makes the day done; content of a series carries its name", () => {
    const c = social(brand.id);
    createContent(brand.id, { title: "Tanya: espresso?", status: "published", seriesId: tanya.id, publishedDate: "2026-10-30" });
    createContent(brand.id, { title: "Bedah Nike", status: "idea", seriesId: bedah.id, scheduleDate: "2026-11-11", campaignId: c.id });
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: listContent(brand.id), today: TODAY });
    assert.equal(todo.routine.rows.find((r) => r.label === "Tanya Kopi").done, true);
    const nike = todo.items.find((x) => x.label === "Bedah Nike");
    assert.equal(nike.seriesName, "Bedah Brand");
  });

  test("a non-social goal shows a series only once it has an episode pointed at it", () => {
    const sales = createCampaign(brand.id, { name: "Sales", status: "active", goalPlan: { version: 3, track: "sales" }, missions: [{ id: "l1", name: "L1", milestones: [] }] });
    const before = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(sales.id), content: listContent(brand.id), today: TODAY });
    assert.equal(before.rows.length, 0);
    createContent(brand.id, { title: "Bedah promo", status: "idea", seriesId: bedah.id, campaignId: sales.id });
    const after = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(sales.id), content: listContent(brand.id), today: TODAY });
    assert.deepEqual(after.rows.map((r) => r.label), ["Bedah Brand"]);
  });

  test("a weekly routine: ticking covers this week only, next week it asks again", () => {
    const c = social(brand.id);
    const { routine } = addGoalRoutine(c.id, { label: "Balas semua DM", day: "tue" });
    getCampaign(c.id).routines[0].createdAt = new Date("2026-10-20T09:00:00").getTime(); // made last week
    let rows = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: TODAY }).rows;
    const r = rows.find((x) => x.kind === "routine");
    assert.deepEqual([r.label, r.date, r.done, r.late], ["Balas semua DM", "2026-10-27", false, true]);
    assert.deepEqual(toggleGoalRoutineWeek(c.id, routine.id, "2026-10-26"), { done: true, weeks: 1 });
    rows = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: TODAY }).rows;
    assert.equal(rows.find((x) => x.kind === "routine").done, true);
    const next = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: "2026-11-03" }).rows.find((x) => x.kind === "routine");
    assert.deepEqual([next.done, next.date, next.streak], [false, "2026-11-03", 1]);
    assert.deepEqual(toggleGoalRoutineWeek(c.id, routine.id, "2026-10-26"), { done: false, weeks: 0 });
    removeGoalRoutine(c.id, routine.id);
    assert.equal((getCampaign(c.id).routines || []).length, 0);
  });

  test("a routine made after its day this week starts next week: not late, not waiting", () => {
    const c = social(brand.id);
    const { routine } = addGoalRoutine(c.id, { label: "Senin live", day: "mon" });
    getCampaign(c.id).routines[0].createdAt = new Date("2026-10-29T09:00:00").getTime();
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: TODAY });
    const r = todo.routine.rows.find((x) => x.routineId === routine.id);
    assert.deepEqual([r.fresh, r.late, r.done], [true, false, false]);
    assert.equal(openCount(todo), todo.items.length + todo.routine.rows.filter((x) => !x.done && x.kind === "series").length);
    const next = routinesThisWeek({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: "2026-11-02" }).rows.find((x) => x.routineId === routine.id);
    assert.deepEqual([next.fresh, next.late], [false, false]);
    removeGoalRoutine(c.id, routine.id);
    assert.equal((getCampaign(c.id).routines || []).length, 0);
  });

  test("a community ritual counts its weeks toward 'Ritual mingguan komunitas berjalan'", () => {
    const c = createCampaign(brand.id, {
      name: "Community", status: "active", goalPlan: { version: 3, track: "community" },
      missions: [{ id: "l1", name: "L1", milestones: [{ id: "m-rit", key: "ritual", kind: "check", metric: "manual.check", label: "Ritual mingguan komunitas berjalan", target: null, required: true }] }],
    });
    const { routine } = addGoalRoutine(c.id, { label: "Senin tanya-jawab", day: "mon", kind: "ritual" });
    toggleGoalRoutineWeek(c.id, routine.id, "2026-10-19");
    toggleGoalRoutineWeek(c.id, routine.id, "2026-10-26");
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [], today: TODAY });
    const tick = todo.items.find((x) => x.msKey === "ritual");
    assert.deepEqual([tick.ritualWeeks, tick.ritualNeed], [2, RITUAL_WEEKS]);
    const row = todo.routine.rows.find((r) => r.ritual);
    assert.deepEqual([row.done, row.streak], [true, 2]);
  });
});
