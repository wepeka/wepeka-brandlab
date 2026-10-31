import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { initStore, createBrand, createGoal, updateGoal, getGoal, localISODate } from "../js/store.js";
import { parseDirectives } from "../js/ai-directives.js";
import { cleanGoalChange, proposeGoalChange, applyGoalChange, planForGoal } from "../js/goal-actions.js";

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localISODate(d); };

describe("[[replot:…]] directive", () => {
  test("is pulled out of the text with its goal and values", () => {
    const p = parseDirectives("Oke, aku siapkan.\n[[replot:goal=abc-123;date=2026-12-18;seats=50;name=Seminar Ke China (Hybrid)]]");
    assert.equal(p.cleanText, "Oke, aku siapkan.");
    assert.equal(p.replots.length, 1);
    assert.equal(p.replots[0].goalId, "abc-123");
    assert.deepEqual(p.replots[0].change, { date: "2026-12-18", seats: "50", name: "Seminar Ke China (Hybrid)" });
  });
  test("one per reply, unknown keys ignored, empty ones dropped", () => {
    assert.equal(parseDirectives("a [[replot:foo=1]]").replots.length, 0);
    assert.equal(parseDirectives("[[replot:seats=5]] [[replot:seats=6]]").replots.length, 1);
  });
});

describe("cleanGoalChange", () => {
  test("keeps only values Re-plot can take", () => {
    assert.deepEqual(cleanGoalChange({ date: "18 Desember", seats: "abc", capacity: "3", push: "0", name: "  X  Y " }), { capacity: 3, name: "X Y" });
    assert.deepEqual(cleanGoalChange({ date: "2026-02-30" }), {});
    assert.deepEqual(cleanGoalChange({ seats: "120" }), { seats: 120 });
  });
});

describe("proposeGoalChange / applyGoalChange", () => {
  async function setup(status = "draft") {
    await initStore(`uid-${Math.random()}`);
    const brand = createBrand({ name: "Pinter" });
    const goal = createGoal(brand.id, { name: "Seminar", targetDate: inDays(60), startDate: localISODate(), status: "draft", inputs: { eventName: "Seminar", role: "organizer", expectedAudience: 40 } });
    updateGoal(brand.id, goal.id, { roadmap: planForGoal(brand.id, getGoal(brand.id, goal.id)), status });
    return { brandId: brand.id, goalId: goal.id };
  }

  test("a change equal to today's goal is not a proposal", async () => {
    const { brandId, goalId } = await setup();
    assert.equal(proposeGoalChange(brandId, goalId, { seats: 40 }).ok, false);
    assert.equal(proposeGoalChange(brandId, "nope", { seats: 50 }).ok, false);
  });

  test("lists what changes, writes nothing until applied", async () => {
    const { brandId, goalId } = await setup();
    const p = proposeGoalChange(brandId, goalId, { seats: 50, date: inDays(75) });
    assert.equal(p.ok, true);
    assert.deepEqual(p.rows.map((r) => r.key), ["date", "seats"]);
    assert.equal(getGoal(brandId, goalId).inputs.expectedAudience, 40);
  });

  test("a past date comes back as an error, not an apply", async () => {
    const { brandId, goalId } = await setup();
    const p = proposeGoalChange(brandId, goalId, { date: "2020-01-01" });
    assert.equal(p.errors[0], "pastDate");
    assert.equal(applyGoalChange(brandId, goalId, { date: "2020-01-01" }).ok, false);
  });

  test("applies to a draft goal: date, seats and name, roadmap re-planned", async () => {
    const { brandId, goalId } = await setup("draft");
    const target = inDays(80);
    const res = applyGoalChange(brandId, goalId, { date: target, seats: 90, name: "Seminar Ke China" });
    assert.equal(res.ok, true);
    const g = getGoal(brandId, goalId);
    assert.equal(g.targetDate, target);
    assert.equal(g.inputs.expectedAudience, 90);
    assert.equal(g.name, "Seminar Ke China");
    assert.equal(g.inputs.eventName, "Seminar Ke China");
    assert.equal(g.roadmap.target, target);
    assert.equal(proposeGoalChange(brandId, goalId, { date: target, seats: 90, name: "Seminar Ke China" }).ok, false);
  });

  test("applies to a live goal through the same re-plot as the dialog", async () => {
    const { brandId, goalId } = await setup("active");
    const target = inDays(90);
    const res = applyGoalChange(brandId, goalId, { date: target, capacity: 4 });
    assert.equal(res.ok, true);
    const g = getGoal(brandId, goalId);
    assert.equal(g.targetDate, target);
    assert.equal(g.inputs.capacityPerWeek, 4);
    assert.equal(g.roadmap.target, target);
  });
});
