// Beranda + "Hari ini" fixes from the 2026-10-05 audit: one streak on the
// owner's local dates, the action pool of campaigns that count every piece,
// "sudah upload?" only for finished pieces, the most urgent action winning,
// event pieces kept inside their window when moved, the trial countdown
// tiers, and the checkout-closed note for a locked-out account.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// WIB, so "before 07:00" is a different UTC day.
process.env.TZ = "Asia/Jakarta";

globalThis.window.scrollTo ??= () => {};
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { consecutiveActiveWeeks, localISODate } = await import("../js/store.js");
const { nextActions, brandTopAction } = await import("../js/next-action.js");
const { buildSocialGrowthPlan } = await import("../js/goal-plan.js");
const { planOverdueShift, trialReminderTier } = await import("../js/views/home.js");
const { closedNoteKey } = await import("../js/views/pricing.js");
const { t } = await import("../js/i18n.js");

const DAY = 86400000;
const iso = (offsetDays) => localISODate(new Date(Date.now() + offsetDays * DAY));
const settings = { formats: [], platforms: [], benchmarks: {} };
const brand = { id: "b1", name: "Kopi Senja" };

function socialCampaign() {
  const plan = buildSocialGrowthPlan({ platform: "instagram", current: { followers: 120 }, target: 1000, content: [] });
  return { id: "camp1", brandId: "b1", name: "Tumbuh di IG", status: "active", autoLinkAllContent: true, createdAt: Date.now() - 3 * DAY, ...plan };
}

describe("posting streak (one definition, local dates)", () => {
  test("a post published before 07:00 WIB counts for today", () => {
    // 2026-10-05 05:00 WIB is still 2026-10-04 on the UTC clock.
    const now = new Date("2026-10-05T05:00:00+07:00");
    assert.equal(localISODate(now), "2026-10-05");
    const content = [{ status: "published", publishedDate: "2026-10-05" }];
    assert.equal(consecutiveActiveWeeks(content, 0, now), 1);
  });
  test("counts consecutive rolling weeks back from today", () => {
    const now = new Date("2026-10-05T20:00:00+07:00");
    const content = ["2026-10-04", "2026-09-27", "2026-09-20"].map((d) => ({ status: "published", publishedDate: d }));
    assert.equal(consecutiveActiveWeeks(content, 0, now), 3);
    assert.equal(consecutiveActiveWeeks([{ status: "published", publishedDate: "2026-09-20" }], 0, now), 0);
  });
  test("Beranda's grace: a weekly poster keeps the 🔥 on upload morning and one day late", () => {
    const content = ["2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"].map((d) => ({ status: "published", publishedDate: d }));
    const at = (s) => new Date(s);
    assert.equal(consecutiveActiveWeeks(content, 0, at("2026-10-05T20:00:00+07:00"), { grace: true }), 4);
    assert.equal(consecutiveActiveWeeks(content, 0, at("2026-10-06T09:00:00+07:00"), { grace: true }), 4);
    assert.equal(consecutiveActiveWeeks(content, 0, at("2026-10-07T09:00:00+07:00"), { grace: true }), 4);
    // Strict count (milestones, streak-break nudge) is unchanged.
    assert.equal(consecutiveActiveWeeks(content, 0, at("2026-10-06T09:00:00+07:00")), 0);
    // Two empty windows in a row is a real break, grace or not.
    assert.equal(consecutiveActiveWeeks(content, 0, at("2026-10-14T09:00:00+07:00"), { grace: true }), 0);
  });
});

describe("Hari ini (next-action)", () => {
  test("a Social Growth campaign acts on content it counts, not only hand-linked pieces", () => {
    const content = [{ id: "c1", brandId: "b1", title: "Promo kopi susu", status: "scheduled", platform: "Instagram", scheduleDate: iso(-2), performance: {} }];
    const top = brandTopAction({ brand, campaigns: [socialCampaign()], content, settings });
    assert.equal(top.action.id, "overdue");
    assert.equal(top.action.cta.contentId, "c1");
  });
  test("an idea whose date passed is not asked 'already uploaded?' — it gets a nudge to make it", () => {
    const content = [{ id: "c2", brandId: "b1", title: "Ide dari Rencana Minggu", status: "idea", platform: "Instagram", scheduleDate: iso(-1), performance: {} }];
    const actions = nextActions({ brand, campaign: socialCampaign(), content, settings });
    assert.ok(!actions.some((a) => a.id === "overdue"), "no 'Sudah upload?' for an idea");
    const unmade = actions.find((a) => a.id === "overdue-unmade");
    assert.ok(unmade);
    assert.equal(unmade.cta.intent, "continue");
    assert.ok(!unmade.label.includes(t("next.overdue.cta")));
  });
  test("the most urgent action wins even when a less urgent one is found first", () => {
    // No content at all: making the first piece (1.5) outranks entering
    // Insights (2), which this file checks earlier.
    const top = brandTopAction({ brand, campaigns: [socialCampaign()], content: [], settings });
    assert.equal(top.action.id, "brainstorm");
  });
});

describe("Geser ke hari upload kosong", () => {
  const eventCampaign = {
    id: "ev1",
    brandId: "b1",
    status: "active",
    eventPlan: {
      eventDate: iso(20),
      phases: [
        { id: "pre-closed", name: "Pre-event", dateFrom: iso(-10), dateTo: iso(-1), milestones: [] },
        { id: "pre-open", name: "Pre-event", dateFrom: iso(-5), dateTo: iso(10), milestones: [] },
      ],
    },
  };
  const dates = [iso(1), iso(2), iso(3)];
  test("a piece from a phase that's already over stays put; others move", () => {
    const late = [
      { id: "a", campaignId: "ev1", campaignPhaseId: "pre-closed", scheduleDate: iso(-3) },
      { id: "b", campaignId: "", scheduleDate: iso(-2) },
    ];
    const { moves, kept } = planOverdueShift(late, dates, [eventCampaign], iso(1));
    assert.deepEqual(kept.map((c) => c.id), ["a"]);
    assert.deepEqual(moves.map((m) => [m.c.id, m.date]), [["b", iso(1)]]);
  });
  test("a piece from a phase still open moves inside its window, never past it", () => {
    const late = [{ id: "c", campaignId: "ev1", campaignPhaseId: "pre-open", scheduleDate: iso(-1) }];
    const { moves } = planOverdueShift(late, [iso(15)], [eventCampaign], iso(1));
    assert.equal(moves[0].date, iso(1), "no free upload day before the phase ends → tomorrow, not after the event");
  });
});

describe("trial reminder tiers", () => {
  const trial = (days) => ({ plan: "trial", status: "active", trialEndsAt: Date.now() + days * DAY });
  test("7, 3 and 1 day(s) left", () => {
    assert.equal(trialReminderTier(trial(10)), null);
    assert.equal(trialReminderTier(trial(6.5)), "week");
    assert.equal(trialReminderTier(trial(2.5)), "soon");
    assert.equal(trialReminderTier(trial(0.4)), "last");
    assert.equal(trialReminderTier({ plan: "starter", status: "active" }), null);
    assert.equal(trialReminderTier(trial(-1)), null);
  });
});

describe("checkout-closed note", () => {
  test("a locked-out account is never told its access keeps running", () => {
    const ended = { plan: "trial", status: "active", trialEndsAt: Date.now() - DAY };
    assert.equal(closedNoteKey("u1", ended), "pricing.closed.noteLocked");
    assert.equal(closedNoteKey("u1", null), "pricing.closed.noteGuest");
    assert.equal(closedNoteKey(null, null), "pricing.closed.noteGuest");
    assert.equal(closedNoteKey("u1", { plan: "trial", status: "active", trialEndsAt: Date.now() + DAY }), "pricing.closed.note");
  });
  test("the locked pricing screen shows that note once checkout reads closed", async () => {
    const { render } = await import("../js/views/pricing.js");
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [] };
    render(root, { user: { uid: "u1", email: "owner@kopi.id" }, account: { plan: "trial", status: "active", trialEndsAt: Date.now() - DAY }, locked: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(root.innerHTML.includes(t("pricing.closed.noteLocked")));
    assert.ok(!root.innerHTML.includes(t("pricing.closed.note")));
  });
});
