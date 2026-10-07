// A goal made while the app was in Indonesian must read in English once the
// owner switches to EN: milestone labels, units and the descriptions that
// js/goal-plan.js writes with numbers in them (descKeys).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { buildSocialGrowthPlan, buildCommunityGrowthPlan, buildSalesGrowthPlan } from "../js/goal-plan.js";
import { normalizeMilestone } from "../js/campaign-metrics.js";
import { unitLabel, milestoneLabel } from "../js/store.js";
import { setLang, t } from "../js/i18n.js";

after(() => setLang("id"));

function milestonesOf(plan) {
  return plan.missions.flatMap((m) => m.milestones);
}
function plansMadeInIndonesian() {
  setLang("id");
  return [
    buildSocialGrowthPlan({ platform: "instagram", current: { followers: 120 }, target: 5000, months: 12, uploadsPerWeek: 3, content: [] }),
    buildCommunityGrowthPlan({ current: { members: 0 }, target: 300, months: 12, hasExisting: false }),
    buildSalesGrowthPlan({ model: "product", products: [{ name: "Kopi susu", price: 18000, sold: 4, target: 200 }], months: 6, monthlySales: 4, revenue: { current: 0, target: 0 } }),
  ];
}
// Firestore refuses an array directly inside an array.
const hasNestedArray = (v) => Array.isArray(v) ? v.some((x) => Array.isArray(x) || hasNestedArray(x)) : v && typeof v === "object" ? Object.values(v).some(hasNestedArray) : false;

describe("goal milestone descriptions follow the app language", () => {
  test("every generated description keeps its i18n keys, in a shape Firestore stores", () => {
    for (const plan of plansMadeInIndonesian()) {
      for (const ms of milestonesOf(plan).filter((m) => m.description)) {
        assert.ok(Array.isArray(ms.descKeys) && ms.descKeys.length, `${ms.label} has descKeys`);
        assert.equal(hasNestedArray(ms.descKeys), false);
        assert.equal(JSON.parse(JSON.stringify(ms.descKeys)).length, ms.descKeys.length);
      }
    }
  });

  test("a goal made in Indonesian shows English descriptions after switching to EN", () => {
    const stored = plansMadeInIndonesian().flatMap(milestonesOf).filter((m) => m.descKeys);
    setLang("en");
    for (const ms of stored) {
      const shown = normalizeMilestone(ms).description;
      const english = ms.descKeys.map((p) => t(p.key, p.params)).join(" ");
      // A label with its own generic description (store.msd.*) keeps showing that one.
      assert.ok(shown === english || shown !== ms.description, `${ms.label}: "${shown}"`);
    }
    const exact = stored.filter((ms) => normalizeMilestone(ms).description === ms.descKeys.map((p) => t(p.key, p.params)).join(" "));
    assert.ok(exact.length >= 10, `${exact.length} milestones redrawn from their keys`);
    const published = stored.find((m) => m.descKeys[0].key === "goal.ms.publishedDesc");
    assert.ok(published, "the social plan has a published-posts milestone");
    assert.match(normalizeMilestone(published).description, /\d/, "numbers survive the switch");
  });

  test("older goals without descKeys keep their stored text", () => {
    setLang("en");
    const ms = { id: "m1", metric: "manual.number", label: "Label tanpa kunci", description: "Teks lama dalam bahasa Indonesia", unit: "member", target: 3 };
    assert.equal(normalizeMilestone(ms).description, "Teks lama dalam bahasa Indonesia");
    assert.equal(normalizeMilestone({ ...ms, descKeys: [{ key: "goal.ms.doesNotExist" }] }).description, "Teks lama dalam bahasa Indonesia");
  });

  test("Community Growth label and units that used to stay Indonesian", () => {
    setLang("en");
    assert.equal(milestoneLabel("Inisiatif/sub-grup yang dijalankan mandiri oleh member"), "Initiatives/sub-groups members run on their own");
    assert.equal(unitLabel("postingan"), "posts");
    assert.equal(unitLabel("aktivitas"), "activities");
    assert.equal(unitLabel("inisiatif"), "initiatives");
    setLang("id");
    assert.equal(unitLabel("postingan"), "postingan");
  });
});
