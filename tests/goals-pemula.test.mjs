// My Goals for Pemula (2026-10-27): the four kinds (js/goal-todo.js
// goalKind + js/goal-art.js), one goal's "Yang perlu dikerjakan" list
// (goalTodo), and "Jadikan tugas" — an idea pointed at a goal as a step
// (js/goal-actions.js addGoalTask). Plus: every new string has both
// languages, and the four pictures draw.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { initStore, createBrand, createCampaign, createContent, getCampaign, getBrand, addBrandIdea, updateBrandIdea, localISODate, listContent } from "../js/store.js";
import { goalKind, goalTodo, runningGoalsOfKind } from "../js/goal-todo.js";
import { addGoalTask, goalTaskPlaces } from "../js/goal-actions.js";
import { goalArtSVG, GOAL_KINDS } from "../js/goal-art.js";
const campaignsI18n = (await import("../js/i18n/campaigns.js")).default;

const DAY = 86400000;
const iso = (daysFromNow) => localISODate(new Date(Date.now() + daysFromNow * DAY));

// A Grow Brand ladder: level 1 current with one tick and one number, level 2 locked.
const ladder = (brandId, track = "community") => createCampaign(brandId, {
  name: "Community Growth Kopi Senja", status: "active",
  goalPlan: { version: 3, track },
  missions: [
    { id: "l1", name: "Level satu", milestones: [
      { id: "m-name", kind: "check", metric: "manual.check", label: "Nama komunitas", target: null, required: true },
      { id: "m-members", kind: "number", metric: "manual.number", label: "Member", target: 50, required: true },
    ] },
    { id: "l2", name: "Level dua", milestones: [{ id: "m-ritual", kind: "check", metric: "manual.check", label: "Ritual mingguan", target: null, required: true }] },
  ],
});

// An Event with one phase already over, one running, one ahead.
const event = (brandId) => createCampaign(brandId, {
  name: "Pop-up CFD", status: "active", objective: "event",
  eventPlan: {
    eventDate: iso(20),
    phases: [
      { id: "p-past", name: "Fondasi", dateFrom: iso(-20), dateTo: iso(-10), milestones: [{ id: "e-old", kind: "check", label: "Langkah lama", dueDate: iso(-12) }] },
      { id: "p-now", name: "Awareness", dateFrom: iso(-2), dateTo: iso(8), milestones: [
        { id: "e-late", kind: "check", label: "Booking tempat", dueDate: iso(-1) },
        { id: "e-soon", kind: "check", label: "Cetak banner", dueDate: iso(3) },
      ] },
      { id: "p-next", name: "Konversi", dateFrom: iso(9), dateTo: iso(19), milestones: [{ id: "e-next", kind: "check", label: "Kirim reminder", dueDate: iso(15) }] },
    ],
  },
});

describe("goalKind: which of the four a goal is", () => {
  test("Grow Brand tracks, an Event, and anything else", () => {
    assert.equal(goalKind({ goalPlan: { version: 3, track: "social" } }), "social");
    assert.equal(goalKind({ goalPlan: { version: 3, track: "community" } }), "community");
    assert.equal(goalKind({ goalPlan: { version: 3, track: "sales" } }), "sales");
    assert.equal(goalKind({ eventPlan: { phases: [] } }), "event");
    assert.equal(goalKind({ objective: "event" }), "event");
    assert.equal(goalKind({ objective: "awareness" }), "other");
    assert.equal(goalKind({ goalPlan: { version: 2, track: "social" } }), "other");
    assert.equal(goalKind(null), "other");
  });
  test("running goals of a kind leave finished and archived ones out", () => {
    const list = [
      { status: "active", goalPlan: { version: 3, track: "sales" } },
      { status: "completed", goalPlan: { version: 3, track: "sales" } },
      { status: "archived", goalPlan: { version: 3, track: "sales" } },
      { status: "planning", goalPlan: { version: 3, track: "social" } },
    ];
    assert.equal(runningGoalsOfKind(list, "sales").length, 1);
    assert.equal(runningGoalsOfKind(list, "social").length, 1);
    assert.equal(runningGoalsOfKind(list, "event").length, 0);
  });
});

describe("goalTodo: one goal's list", () => {
  let brand;
  before(async () => {
    await initStore("test-uid-goals-pemula");
    brand = createBrand({ name: "Kopi Senja" });
  });

  test("a Grow Brand goal: its open content and the current level's ticks — numbers are not to-dos", () => {
    const c = ladder(brand.id);
    createContent(brand.id, { title: "Cerita member", status: "draft", campaignId: c.id, scheduleDate: iso(2) });
    createContent(brand.id, { title: "Sudah tayang", status: "published", campaignId: c.id, publishedDate: iso(-3) });
    createContent(brand.id, { title: "Bukan buat tujuan ini", status: "idea" });
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: listContent(brand.id) });
    const labels = todo.items.map((x) => x.label);
    assert.deepEqual(labels.sort(), ["Cerita member", "Nama komunitas"].sort());
    assert.ok(!labels.includes("Member"), "a number stays in Performa");
    assert.ok(!labels.includes("Ritual mingguan"), "a locked level's tick waits");
    assert.deepEqual(todo.done.map((x) => x.label), ["Sudah tayang"]);
    const tick = todo.items.find((x) => x.kind === "task");
    assert.equal(tick.milestoneId, "m-name");
    assert.equal(tick.stageId, "l1");
  });

  test("an Event: steps of the phases not over yet, late first, then by date", () => {
    const c = event(brand.id);
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [] });
    assert.deepEqual(todo.items.map((x) => x.label), ["Booking tempat", "Cetak banner", "Kirim reminder"]);
    assert.equal(todo.items[0].late, true);
    assert.equal(todo.items[1].late, false);
    assert.equal(todo.items[0].stageName, "Awareness");
  });

  test("kept ideas wait in the list until they become content or a task", () => {
    const c = ladder(brand.id, "sales");
    const a = addBrandIdea(brand.id, { text: "Promo beli 2", campaignId: c.id, source: "chat" });
    const b = addBrandIdea(brand.id, { text: "Testimoni pelanggan", campaignId: c.id, source: "chat" });
    addBrandIdea(brand.id, { text: "Ide brand umum", source: "chat" });
    updateBrandIdea(brand.id, b.id, { status: "tasked" });
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [] });
    assert.deepEqual(todo.ideas.map((i) => i.id), [a.id]);
  });
});

describe("addGoalTask: an idea pointed at a goal as a step", () => {
  let brand;
  before(async () => {
    await initStore("test-uid-goals-pemula-task");
    brand = createBrand({ name: "Kopi Senja" });
  });

  test("a Grow Brand goal takes it as an optional tick in the level it's on", () => {
    const c = ladder(brand.id);
    const res = addGoalTask(c.id, { title: "  Kopdar Sabtu pagi ", why: "Biar member kenal" });
    assert.equal(res.ok, true);
    const lvl = getCampaign(c.id).missions[0];
    const m = lvl.milestones.find((x) => x.id === res.milestone.id);
    assert.equal(m.label, "Kopdar Sabtu pagi");
    assert.equal(m.metric, "manual.check");
    assert.equal(m.required, false, "a step the owner added never holds the level back");
    assert.equal(getCampaign(c.id).missions[1].milestones.length, 1, "the locked level is untouched");
    const todo = goalTodo({ brand: getBrand(brand.id), campaign: getCampaign(c.id), content: [] });
    assert.ok(todo.items.some((x) => x.label === "Kopdar Sabtu pagi" && x.optional));
  });

  test("an Event takes it into the phase the owner picked; a phase that's over is never offered", () => {
    const c = event(brand.id);
    assert.deepEqual(goalTaskPlaces(getCampaign(c.id)).map((p) => p.id), ["p-now", "p-next"]);
    const res = addGoalTask(c.id, { title: "Cari 2 tenant kopi", phaseId: "p-next" });
    assert.equal(res.ok, true);
    assert.equal(res.where, "Konversi");
    const phase = getCampaign(c.id).eventPlan.phases.find((p) => p.id === "p-next");
    assert.ok(phase.milestones.some((m) => m.label === "Cari 2 tenant kopi"));
  });

  test("no words, or no such goal: nothing is written", () => {
    const c = ladder(brand.id);
    const before = JSON.stringify(getCampaign(c.id).missions);
    assert.equal(addGoalTask(c.id, { title: "   " }).ok, false);
    assert.equal(addGoalTask("nope", { title: "X" }).ok, false);
    assert.equal(JSON.stringify(getCampaign(c.id).missions), before);
    assert.deepEqual(goalTaskPlaces(getCampaign(c.id)), []);
  });
});

describe("pictures and words", () => {
  test("four kinds, each with its two colours and a picture in the card's tint + shade", () => {
    assert.deepEqual(GOAL_KINDS.map((k) => k.key), ["social", "community", "sales", "event"]);
    GOAL_KINDS.forEach((k) => {
      assert.match(k.color, /^#[0-9A-F]{6}$/i);
      assert.match(k.color2, /^#[0-9A-F]{6}$/i);
      const svg = goalArtSVG(k.key);
      assert.ok(svg.startsWith("<svg") && svg.includes("i-main") && svg.includes("i-ink"), k.key);
    });
    assert.equal(goalArtSVG("nope"), "");
  });
  test("every My Goals string has both languages", () => {
    const keys = Object.keys(campaignsI18n).filter((k) => k.startsWith("gl."));
    assert.ok(keys.length > 40);
    keys.forEach((k) => {
      assert.ok(campaignsI18n[k].id && campaignsI18n[k].en, k);
    });
  });
});

