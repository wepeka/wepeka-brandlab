// 2026-10-15, from the "Marketing OS" brief: the path shown when Brand DNA is
// finished, Beranda's "Progres ke target", the week plan's "Dibuat
// berdasarkan" line, and the GA4 activation steps (js/activation.js).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.window.scrollTo ??= () => {};
globalThis.sessionStorage ??= new globalThis.localStorage.constructor();
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const store = await import("../js/store.js");
const { dnaNextSteps } = await import("../js/views/brand-dna.js");
const { targetProgressRows } = await import("../js/views/home.js");
const { weekPlanBasis } = await import("../js/brand-learning.js");
const { buildSocialGrowthPlan } = await import("../js/goal-plan.js");
const { addProduct, logSale } = await import("../js/sales-tracker.js");
const { stepParams, trackStep, initActivation } = await import("../js/activation.js");
const { t } = await import("../js/i18n.js");

const settings = { formats: [], platforms: [], benchmarks: {} };
const socialCampaign = (over = {}) => ({
  id: "c1", brandId: "b1", name: "Tumbuh di IG", status: "active", autoLinkAllContent: true, createdAt: Date.now(),
  ...buildSocialGrowthPlan({ platform: "instagram", current: { followers: 300 }, target: 5000, content: [] }),
  ...over,
});

describe("Brand DNA finished: the path from here", () => {
  test("nothing done yet: the Brand Book is next, the rest waits", () => {
    const { steps } = dnaNextSteps({ id: "b1", brandDNA: {} });
    assert.deepEqual(steps.map((s) => s.key), ["visual", "goal", "week"]);
    assert.deepEqual(steps.map((s) => !!s.done), [false, false, false]);
    assert.equal(steps.find((s) => s.next).key, "visual");
  });
  test("a goal and a post scheduled ahead tick those steps", () => {
    const today = "2026-10-15";
    const { steps } = dnaNextSteps({ id: "b1" }, { campaigns: [{ id: "c" }], content: [{ scheduleDate: "2026-10-17" }], today });
    assert.equal(steps.find((s) => s.key === "goal").done, true);
    assert.equal(steps.find((s) => s.key === "week").done, true);
    const old = dnaNextSteps({ id: "b1" }, { content: [{ scheduleDate: "2026-10-01" }], today });
    assert.equal(old.steps.find((s) => s.key === "week").done, false, "a date in the past is not this week's plan");
  });
  test("missing proof and brand character are named; nothing claimed for a brand saved before the boxes were kept", () => {
    const thin = (brand) => dnaNextSteps(brand).thin.map((x) => x.key);
    assert.deepEqual(thin({ id: "b", brandDNA: { parts: { guide: { empathy: "Paham", proof: [] } } } }), ["proof", "character"]);
    assert.deepEqual(thin({ id: "b", brandDNA: { parts: { guide: { proof: ["120 pelanggan tetap"] } } }, brandBuilder: { personality: { feeling: "Hangat" } } }), []);
    assert.deepEqual(thin({ id: "b", brandDNA: {}, brandBuilder: { personality: { feeling: "Hangat" } } }), [], "no parts.guide → say nothing about proof");
  });
  test("every path and note string exists in both languages", () => {
    for (const k of ["pathTitle", "path.visual", "path.visual.desc", "path.goal", "path.goal.desc", "path.week", "path.week.desc", "path.done", "path.next", "thinTitle", "thin.proof", "thin.proofCta", "thin.character", "thin.characterCta"]) {
      assert.notEqual(t(`dna.done.${k}`), `dna.done.${k}`, k);
    }
  });
});

describe("Beranda: Progres ke target", () => {
  test("a running Grow Brand campaign with no follower count says so instead of 0", () => {
    const rows = targetProgressRows({ brand: { id: "b1" }, campaigns: [socialCampaign()], content: [], settings });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].noData, true);
    assert.equal(rows[0].level, 1);
    assert.ok(rows[0].target > 0);
  });
  test("with followers logged it shows current against the level target", () => {
    const brand = { id: "b1", insights: { instagram: { followers: 640, updatedAt: Date.now() } } };
    const [row] = targetProgressRows({ brand, campaigns: [socialCampaign()], content: [], settings });
    assert.equal(row.noData, false);
    assert.equal(row.current, 640);
    assert.ok(row.pct > 0 && row.pct <= 1);
  });
  test("finished, planning and non-Grow-Brand campaigns stay out; at most three rows", () => {
    const campaigns = [
      socialCampaign({ id: "done", status: "completed" }),
      socialCampaign({ id: "plan", status: "planning" }),
      { id: "event", brandId: "b1", name: "Launching", status: "active", objective: "event", phases: [] },
      ...["a", "b", "c", "d"].map((id) => socialCampaign({ id })),
    ];
    const rows = targetProgressRows({ brand: { id: "b1" }, campaigns, content: [], settings });
    assert.deepEqual(rows.map((r) => r.campaign.id), ["a", "b", "c"]);
  });
});

describe("Rencanakan minggu ini: Dibuat berdasarkan", () => {
  test("names the Brand DNA, the goal it plans for and the upload days, in that order", () => {
    const brand = { id: "b1", brandDNA: { targetAudience: "Mahasiswa" }, contentCadence: { configured: true, uploadDays: ["fri", "mon", "wed"] } };
    const basis = weekPlanBasis(brand, { campaigns: [{ name: "Tumbuh di IG" }, { name: "Jualan Kopi" }, { name: "Komunitas" }], content: [], settings });
    assert.equal(basis[0], t("learn.basis.weekDna"));
    assert.equal(basis[1], t("learn.basis.weekGoal", { names: "Tumbuh di IG, Jualan Kopi +1" }));
    assert.equal(basis[2], t("learn.basis.weekDays", { days: [t("calendar.dow.mon"), t("calendar.dow.wed"), t("calendar.dow.fri")].join(", ") }));
  });
  test("a plan scoped to one campaign names only that one; no cadence, no days", () => {
    const basis = weekPlanBasis({ id: "b1", brandDNA: {} }, { campaigns: [{ name: "A" }, { name: "B" }], scopeCampaign: { name: "B" }, content: [], settings });
    assert.deepEqual(basis, [t("learn.basis.weekGoal", { names: "B" })]);
  });
  test("nothing to say → empty, so the card shows no line", () => {
    assert.deepEqual(weekPlanBasis({ id: "b1" }, { content: [], settings }), []);
  });
});

describe("activation steps (app:step from the data layer)", () => {
  const seen = [];
  let brand;
  before(async () => {
    await store.initStore("test-uid-activation");
    brand = store.createBrand({ name: "Kopi Senja" });
    window.addEventListener("app:step", (e) => seen.push(e.detail));
  });
  const take = () => seen.splice(0);

  test("creating a campaign is goal_created, with its track", () => {
    take();
    store.createCampaign(brand.id, { name: "IG", objective: "awareness", goalPlan: { version: 3, track: "social" } });
    assert.deepEqual(take(), [{ step: "goal_created", brandId: brand.id, objective: "awareness", track: "social" }]);
  });
  test("content_published fires on the change to published only; numbers only when they change", () => {
    const c = store.createContent(brand.id, { title: "Reel 1", status: "draft" });
    take();
    store.updateContent(c.id, { status: "published", publishedDate: "2026-10-15" });
    assert.deepEqual(take().map((x) => x.step), ["content_published"]);
    store.updateContent(c.id, { status: "published" });
    assert.deepEqual(take(), [], "already published");
    store.updateContent(c.id, { performance: { views: 900, likes: 40 } });
    assert.deepEqual(take(), [{ step: "numbers_logged", brandId: brand.id, kind: "content" }]);
    store.updateContent(c.id, { performance: { views: 900, likes: 40 } });
    assert.deepEqual(take(), [], "the same numbers saved again");
  });
  test("followers typed in count, the wizard's copy doesn't; a tick is not a number", () => {
    take();
    store.updateBrandInsights(brand.id, "instagram", { followers: 1200, source: "manual" });
    store.updateBrandInsights(brand.id, "instagram", { followers: 1200, source: "wizard" });
    assert.deepEqual(take().map((x) => x.kind), ["followers"]);
    const camp = store.createCampaign(brand.id, { name: "Komunitas" });
    take();
    store.setCampaignManualMetric(camp.id, "m1", { done: true });
    assert.deepEqual(take(), []);
    store.setCampaignManualMetric(camp.id, "m2", { value: 35 });
    assert.deepEqual(take().map((x) => x.kind), ["manual"]);
  });
  test("a logged sale is numbers_logged sales", () => {
    store.ensureBrandSales?.(brand.id);
    const p = addProduct(brand.id, { name: "Kopi Susu", price: 18000 });
    take();
    logSale(brand.id, { productId: p.id, qty: 2 });
    assert.deepEqual(take().map((x) => x.kind), ["sales"]);
  });
  test("every step carries only mode and plan (no names or ids); trackStep never throws", () => {
    assert.deepEqual(Object.keys(stepParams({ n: 3 })).sort(), ["mode", "n", "plan"]);
    assert.doesNotThrow(() => trackStep("week_plan_saved", { n: 3 }));
    assert.doesNotThrow(() => initActivation());
    assert.doesNotThrow(() => store.emitStep("numbers_logged", { brandId: brand.id, kind: "content" }));
  });
});
