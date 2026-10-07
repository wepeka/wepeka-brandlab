// Beranda tidy-up (2026-10-06): the "Minggu ini" weekly loop, the finished
// Event / Grow Brand recap, "Isi angka" two days after posting, the low AI
// credit note, and the app tint following the Brand Book.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";

globalThis.window.scrollTo ??= () => {};
globalThis.sessionStorage ??= new globalThis.localStorage.constructor();
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { localISODate } = await import("../js/store.js");
const { weekRecap, weekAhead, finishedCampaignRecaps, weekCardParts, recapCardHTML, rpCompact, lastWeekRange } = await import("../js/weekly-recap.js");
const { performanceCheckAction, brandTodayAction } = await import("../js/next-action.js");
const { lowCreditState, LOW_CREDIT_AT } = await import("../js/ai-low-credit.js");
const { brandTintColor } = await import("../js/brand-tint.js");
const { t } = await import("../js/i18n.js");
const { buildSocialGrowthPlan } = await import("../js/goal-plan.js");

const DAY = 86400000;
const NOW = new Date("2026-10-06T10:00:00+07:00");
const iso = (offsetDays) => localISODate(new Date(NOW.getTime() + offsetDays * DAY));
const brand = { id: "b1", name: "Kopi Senja" };
const settings = { formats: [], platforms: [], benchmarks: {} };

describe("Minggu ini: the last 7 days", () => {
  test("planned vs published, with an unplanned post counted as both", () => {
    const content = [
      { id: "a", status: "published", publishedDate: iso(-1), scheduleDate: iso(-1), performance: { views: 900 } },
      { id: "b", status: "published", publishedDate: iso(-3), performance: { views: 2400 } }, // never scheduled
      { id: "c", status: "scheduled", scheduleDate: iso(-2), performance: {} }, // planned, not out
      { id: "d", status: "published", publishedDate: iso(-9), performance: { views: 99999 } }, // before the window
      { id: "e", status: "draft", scheduleDate: iso(2), performance: {} }, // next week
    ];
    const r = weekRecap({ brand, content, now: NOW });
    assert.equal(r.planned, 3);
    assert.equal(r.published, 2);
    assert.equal(r.views, 3300);
    assert.equal(r.best.content.id, "b", "the most-viewed post inside the window");
    assert.equal(r.sales, null, "no sales tracker entries → no sales stat at all");
  });
  test("same window as the weekly report: today and the six days before", () => {
    assert.deepEqual(lastWeekRange(NOW), { start: "2026-09-30", end: "2026-10-06" });
  });
  test("sales logged in the window are summed; a tracker with only older sales shows zero", () => {
    const withSales = { ...brand, salesTracker: { entries: [
      { id: "s1", productId: "p", qty: 2, amount: 50000, date: iso(-1) },
      { id: "s2", productId: "p", qty: 1, amount: 25000, date: iso(-6) },
      { id: "s3", productId: "p", qty: 9, amount: 900000, date: iso(-20) },
    ] } };
    const r = weekRecap({ brand: withSales, content: [], now: NOW });
    assert.deepEqual(r.sales, { count: 2, qty: 3, revenue: 75000 });
    const old = { ...brand, salesTracker: { entries: [{ id: "s3", productId: "p", qty: 9, amount: 900000, date: iso(-20) }] } };
    assert.deepEqual(weekRecap({ brand: old, content: [], now: NOW }).sales, { count: 0, qty: 0, revenue: 0 });
  });
});

describe("Minggu ini: the next 7 days", () => {
  const content = [
    { id: "x1", status: "scheduled", scheduleDate: iso(0) },
    { id: "x2", status: "idea", scheduleDate: iso(3) },
    { id: "x3", status: "draft", scheduleDate: iso(6) },
    { id: "x4", status: "draft", scheduleDate: iso(7) }, // outside
    { id: "x5", status: "published", scheduleDate: iso(1), publishedDate: iso(1) }, // already out
    { id: "x6", status: "draft", scheduleDate: iso(-1) }, // late — the late rows' job
  ];
  test("counts everything dated in the week, lists what no other card shows", () => {
    const a = weekAhead({ content, now: NOW, exclude: new Set(["x1"]) });
    assert.equal(a.total, 3);
    assert.deepEqual(a.rows.map((c) => c.id), ["x2", "x3"]);
  });
  test("the card: the report nag folds in, the week plan is offered, an empty week says so", () => {
    const recap = weekRecap({ brand, content: [], now: NOW });
    const empty = weekAhead({ content: [], now: NOW });
    const parts = weekCardParts({ brandId: "b1", recap, ahead: empty, reportIsDue: true, hasPublished: true, canPlan: true });
    assert.ok(parts.bodyHTML.includes("data-report-open=\"week\""));
    assert.ok(parts.bodyHTML.includes("data-report-snooze"));
    assert.ok(!parts.bodyHTML.includes("id=\"home-report\""), "no second report button while the nag is up");
    assert.ok(parts.bodyHTML.includes("data-week-plan"));
    assert.ok(parts.bodyHTML.includes(t("beranda.week.empty")));
    const quiet = weekCardParts({ brandId: "b1", recap, ahead: empty, reportIsDue: false, hasPublished: true, canPlan: false });
    assert.ok(quiet.bodyHTML.includes("id=\"home-report\""), "the report stays one tap away as an export link");
    assert.ok(!quiet.bodyHTML.includes("data-week-plan"));
  });
  test("compact rupiah fits a stat tile", () => {
    assert.equal(rpCompact(7500, "id"), "Rp 7.500");
    assert.match(rpCompact(1250000, "id"), /^Rp 1,\d\sjt$/);
    assert.match(rpCompact(1250000, "en"), /^Rp 1\.\dM$/);
  });
});

describe("finished Event / Grow Brand ladder → one-time recap", () => {
  const eventCampaign = (over = {}) => ({
    id: "ev1", brandId: "b1", name: "Bazar Kopi", status: "completed", autoCompleted: true, createdAt: NOW.getTime() - 40 * DAY,
    eventPlan: { eventDate: iso(-3), phases: [{ id: "p1", name: "Pre-event", dateFrom: iso(-20), dateTo: iso(-3) }] },
    ...over,
  });
  const content = [
    { id: "c1", campaignId: "ev1", status: "published", publishedDate: iso(-10) },
    { id: "c2", campaignId: "ev1", status: "published", publishedDate: iso(-5) },
    { id: "c3", campaignId: "ev1", status: "draft", scheduleDate: iso(-4) },
    { id: "c4", campaignId: "", status: "published", publishedDate: iso(-5) },
  ];
  test("an event that just ended: planned vs done and the sales tagged to it", () => {
    const withSales = { ...brand, salesTracker: { products: [{ id: "p", name: "Kopi" }], entries: [{ id: "s", productId: "p", qty: 4, amount: 100000, date: iso(-3), eventId: "ev1" }] } };
    const [r] = finishedCampaignRecaps({ brand: withSales, campaigns: [eventCampaign()], content, now: NOW });
    assert.equal(r.kind, "event");
    assert.equal(r.planned, 3);
    assert.equal(r.published, 2);
    assert.deepEqual(r.sales, { count: 1, qty: 4, revenue: 100000 });
    const html = recapCardHTML(r, { brandId: "b1" });
    assert.ok(html.includes("data-recap-next=\"ev1\""));
    assert.ok(html.includes("data-recap-dismiss=\"ev1\""));
  });
  test("closed once = gone; long-finished ones and running ones never show", () => {
    assert.equal(finishedCampaignRecaps({ brand, campaigns: [eventCampaign({ recapSeenAt: Date.now() })], content, now: NOW }).length, 0);
    const old = eventCampaign({ eventPlan: { eventDate: iso(-60), phases: [{ id: "p1", dateFrom: iso(-80), dateTo: iso(-60) }] } });
    assert.equal(finishedCampaignRecaps({ brand, campaigns: [old], content, now: NOW }).length, 0);
    assert.equal(finishedCampaignRecaps({ brand, campaigns: [eventCampaign({ status: "active" })], content, now: NOW }).length, 0);
  });
  test("a Grow Brand ladder with every level done", () => {
    const ladder = {
      id: "g1", brandId: "b1", name: "Social Media Growth (Instagram)", status: "completed", autoLinkAllContent: true, createdAt: NOW.getTime() - 30 * DAY,
      missions: [{ completedAt: NOW.getTime() - 20 * DAY }, { completedAt: NOW.getTime() - 2 * DAY }],
    };
    const [r] = finishedCampaignRecaps({ brand, campaigns: [ladder], content, now: NOW });
    assert.equal(r.kind, "ladder");
    assert.deepEqual(r.levels, { done: 2, total: 2 });
    assert.equal(r.published, 3, "an auto-linking ladder counts everything published while it ran");
    const unfinished = { ...ladder, missions: [{ completedAt: 1 }, { completedAt: null }] };
    assert.equal(finishedCampaignRecaps({ brand, campaigns: [unfinished], content, now: NOW }).length, 0);
  });
});

describe("Hari ini: \"Isi angka\" two days after posting", () => {
  const now = NOW.getTime();
  const post = (over = {}) => ({ id: "p1", title: "Promo kopi susu", status: "published", publishedDate: iso(-2), performance: {}, ...over });
  test("a post from two days ago without numbers → Quick Fill on that post", () => {
    const a = performanceCheckAction([post()], now);
    assert.equal(a.cta.type, "performance");
    assert.equal(a.cta.contentId, "p1");
    assert.ok(a.label.includes("Promo kopi susu"));
  });
  test("numbers already in, too fresh, or older than two weeks → nothing", () => {
    assert.equal(performanceCheckAction([post({ performance: { views: 10, confirmedAt: now } })], now), null);
    assert.equal(performanceCheckAction([post({ publishedDate: iso(-1) })], now), null);
    assert.equal(performanceCheckAction([post({ publishedDate: iso(-20) })], now), null);
  });
  test("the newest due post wins and the rest are counted", () => {
    const a = performanceCheckAction([post({ id: "old", publishedDate: iso(-8) }), post({ id: "new", publishedDate: iso(-3) })], now);
    assert.equal(a.cta.contentId, "new");
    assert.ok(a.why.includes(t("next.perfCheck.more", { n: 1 })));
  });
  test("brand-level, with no campaign — and a late post still comes first", () => {
    const top = brandTodayAction({ brand, campaigns: [], content: [post()], settings, now });
    assert.equal(top.campaign, null);
    assert.equal(top.action.cta.type, "performance");
    const plan = buildSocialGrowthPlan({ platform: "instagram", current: { followers: 120 }, target: 1000, content: [] });
    const campaign = { id: "camp1", brandId: "b1", name: "Tumbuh di IG", status: "active", autoLinkAllContent: true, createdAt: now - 3 * DAY, ...plan };
    const late = { id: "late", title: "Promo", status: "scheduled", platform: "Instagram", scheduleDate: iso(-2), performance: {} };
    const urgent = brandTodayAction({ brand, campaigns: [campaign], content: [post({ platform: "Instagram" }), late], settings, now });
    assert.equal(urgent.action.id, "overdue");
  });
});

describe("low AI credit", () => {
  test(`1..${LOW_CREDIT_AT} left in a metered window`, () => {
    assert.deepEqual(lowCreditState({ remaining: 10, limit: 20, period: "day" }), { n: 10, period: "day" });
    assert.deepEqual(lowCreditState({ remaining: 3, limit: 60, period: "total" }), { n: 3, period: "total" });
    assert.equal(lowCreditState({ remaining: 11, limit: 20, period: "day" }), null);
    assert.equal(lowCreditState({ remaining: 0, limit: 20, period: "day" }), null, "zero is the top-up dialog's job");
  });
  test("never for unmetered or read-only accounts", () => {
    assert.equal(lowCreditState({ remaining: Infinity, limit: Infinity }), null);
    assert.equal(lowCreditState({ remaining: 5, limit: 20, unlimited: true }), null);
    assert.equal(lowCreditState({ remaining: 5, limit: 20, admin: true }), null);
    assert.equal(lowCreditState({ remaining: 5, limit: 0, readOnly: true }), null);
  });
  test("says what happens next, per window", () => {
    for (const period of ["day", "month", "total"]) {
      const s = t(`aiLow.${period}`, { n: 7 });
      assert.ok(s.includes("7"), period);
      assert.doesNotMatch(s, /tinggal|AI bikinin|biar AI/i, period);
    }
  });
});

describe("app tint follows the Brand Book", () => {
  test("Brand Book primary first, then the picked brand colour", () => {
    assert.equal(brandTintColor({ color: "#ffa52b", brandGuidelines: { colors: { primary: "#1d4ed8" } } }), "#ffa52b");
    assert.equal(brandTintColor({ color: "#ffa52b", brandGuidelines: { colors: { primary: "" } } }), "#ffa52b");
    assert.equal(brandTintColor({ color: "#ffa52b", brandGuidelines: { colors: { primary: "not a colour" } } }), "#ffa52b");
    assert.equal(brandTintColor({}), "");
  });
});

describe("Beranda renders the new shape", () => {
  test("Hari ini, recap, Minggu ini, Konten terbaru and Lainnya — one block each", async () => {
    const store = await import("../js/store.js");
    const { render } = await import("../js/views/home.js");
    await store.initStore("test-uid-beranda");
    const b = store.createBrand({
      name: "Kopi Senja",
      brandDNA: { targetAudience: "Pekerja kantoran", problemSolved: "Ngantuk siang", differentiation: "Biji lokal", mission: "1) Pesan 2) Antar 3) Nikmati", callToAction: "Pesan sekarang", successOutcome: "Segar lagi", failureOutcome: "Lemas", tagline: "" },
      brandGuidelines: { colors: { primary: "#1d4ed8" }, fonts: { primary: "Inter" } },
    });
    const today = localISODate();
    const dayOff = (n) => localISODate(new Date(Date.now() + n * DAY));
    store.createCampaign(b.id, { name: "Bazar Kopi", status: "active", eventPlan: { eventDate: dayOff(-3), phases: [{ id: "p1", name: "Pre-event", dateFrom: dayOff(-20), dateTo: dayOff(-3) }] } });
    store.createContent(b.id, { title: "Post kemarin lusa", status: "published", publishedDate: dayOff(-2), performance: {} });
    store.createContent(b.id, { title: "Jadwal besok", status: "scheduled", scheduleDate: dayOff(1) });
    store.createContent(b.id, { title: "Telat", status: "scheduled", scheduleDate: dayOff(-1) });
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    const off = render(root, { brandId: b.id });
    const html = root.innerHTML;
    off?.();
    assert.ok(html.includes('id="journey-hero"'));
    assert.ok(html.includes("home-b-recap"), "the event that just ended gets its recap card");
    assert.ok(html.includes('id="home-week"'));
    assert.ok(html.includes("data-shift-overdue"), "late pieces are moved from Minggu ini");
    assert.ok(html.includes("home-more"), "Lainnya");
    assert.ok(!html.includes("report-remind\" class=\"card"), "no separate report block");
    assert.ok(!html.includes("brand-hero-streak"), "the streak moved into Minggu ini");
    assert.equal((html.match(/data-open-content="[^"]+"/g) || []).filter((m) => m.includes(today)).length, 0);
    // "Jadwal besok" sits in Minggu ini only, never also in Konten terbaru.
    const besok = store.listContent(b.id).find((c) => c.title === "Jadwal besok");
    assert.equal(html.split(`data-open-content="${besok.id}"`).length - 1, 1);
  });
});
