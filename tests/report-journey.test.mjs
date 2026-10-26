// Report page (2026-10-27): the numbers behind its charts — views and
// interactions over time, the format mix and the posting rhythm — all
// worked out from the PDF's own computeReportData.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { initStore, createBrand, createContent } = await import("../js/store.js");
const { computeReportData } = await import("../js/views/report.js");
const { interactionsOf, interactionsTotal, trendSeries, formatMix, postingRhythm, MAX_POST_POINTS, MAX_CALENDAR_WEEKS } = await import("../js/report-journey.js");
const { monotonePath, niceMax, trendChartSVG } = await import("../js/views/report-charts.js");

await initStore("test-uid-report-journey");
const brand = createBrand({ name: "Kopi Senja" });
const post = (title, publishedDate, extra) => createContent(brand.id, { title, status: "published", publishedDate, scheduleDate: publishedDate, platform: "Instagram", ...extra });
post("Senin pagi", "2026-10-12", { format: "Reels", funnel: "TOFU", performance: { views: 1200, likes: 80, comments: 12, shares: 9, saves: 30 } });
post("Rabu", "2026-10-14", { format: "Carousel", funnel: "MOFU", performance: { views: 500, likes: 20 } });
post("Rabu lagi", "2026-10-14", { format: "Reels", funnel: "TOFU", performance: { views: 900 } });
post("Belum diisi", "2026-10-17", { format: "Reels", funnel: "BOFU", performance: {} });

describe("interactions", () => {
  test("a post's interactions add up the ones filled in; none filled = null, not 0", () => {
    assert.equal(interactionsOf({ likes: 80, comments: 12, shares: 9, saves: 30, reposts: null }), 131);
    assert.equal(interactionsOf({ likes: null, comments: null, shares: null, saves: null, reposts: null }), null);
  });
  test("the period's total, and how many posts had any", () => {
    const d = computeReportData(brand, "2026-10-11", "2026-10-17");
    assert.deepEqual(interactionsTotal(d), { total: 151, n: 2 });
  });
});

describe("views & interactions over time", () => {
  test("one point per post, oldest first, a missing number stays missing", () => {
    const d = computeReportData(brand, "2026-10-11", "2026-10-17");
    const s = trendSeries(d);
    assert.equal(s.unit, "post");
    assert.deepEqual(s.points.map((p) => p.title), ["Senin pagi", "Rabu", "Rabu lagi", "Belum diisi"]);
    assert.deepEqual(s.points.map((p) => p.views), [1200, 500, 900, null]);
    assert.deepEqual(s.points.map((p) => p.inter), [131, 20, null, null]);
  });

  test("past the post limit, weekly sums with the empty weeks kept", () => {
    const many = createBrand({ name: "Banyak Konten" });
    for (let i = 0; i < MAX_POST_POINTS + 2; i++) {
      // Two posts a day: 1–10 Sep, then 25 Sep – 4 Oct (the week of 14 Sep has none).
      const day = new Date(2026, 8, 1 + Math.floor(i / 2) + (i >= 20 ? 14 : 0));
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      createContent(many.id, { title: `P${i}`, status: "published", publishedDate: iso, scheduleDate: iso, performance: { views: 100, likes: 10 } });
    }
    const s = trendSeries(computeReportData(many, "2026-08-01", "2026-10-31"));
    assert.equal(s.unit, "week");
    assert.equal(s.points.reduce((a, p) => a + p.n, 0), MAX_POST_POINTS + 2);
    assert.equal(s.points.reduce((a, p) => a + (p.views || 0), 0), (MAX_POST_POINTS + 2) * 100);
    assert.ok(s.points.every((p, i) => i === 0 || p.date > s.points[i - 1].date));
    assert.ok(s.points.some((p) => p.n === 0 && p.views === null), "a quiet week shows as a gap, not 0 views");
  });
});

describe("format mix", () => {
  test("posts per format, average views over the posts that have views", () => {
    const d = computeReportData(brand, "2026-10-11", "2026-10-17");
    assert.deepEqual(formatMix(d), [
      { format: "Reels", count: 3, avgViews: 1050 },
      { format: "Carousel", count: 1, avgViews: 500 },
    ]);
  });
});

describe("posting rhythm", () => {
  test("a Monday-start calendar of the period, with counts that are just counts", () => {
    const d = computeReportData(brand, "2026-10-11", "2026-10-17");
    const r = postingRhythm(d, "2026-10-11", "2026-10-17", { today: "2026-10-20" });
    // 11 Oct 2026 is a Sunday: its week starts Monday 5 Oct.
    assert.equal(r.weeks.length, 2);
    assert.equal(r.weeks[0][0].date, "2026-10-05");
    assert.equal(r.weeks[0][6].inPeriod, true);
    assert.equal(r.weeks[0][5].inPeriod, false);
    assert.equal(r.weeks[1].find((c) => c.date === "2026-10-14").posts.length, 2);
    assert.equal(r.count, 4);
    assert.equal(r.activeDays, 3);
    assert.equal(r.longestGap, 3); // 14 → 17 Oct
    assert.equal(Math.round(r.perWeek * 10) / 10, 4);
    assert.equal(r.topWeekday, 2); // Wednesday, two posts
    assert.equal(r.sinceLast, null, "the period ended before today");
  });

  test("days since the last post when the period reaches today; long periods keep the latest weeks", () => {
    const d = computeReportData(brand, "2000-01-01", "2026-10-20");
    const r = postingRhythm(d, "2000-01-01", "2026-10-20", { today: "2026-10-20" });
    assert.equal(r.weeks[0][0].date, "2026-10-12", "all time starts at the first post");
    assert.equal(r.sinceLast, 3);
    const long = postingRhythm(d, "2026-01-01", "2026-10-20", { today: "2026-10-20" });
    assert.equal(long.capped, true);
    assert.equal(long.weeks.length, MAX_CALENDAR_WEEKS);
    assert.equal(long.weeks[long.weeks.length - 1][0].date, "2026-10-19");
  });
});

describe("charts", () => {
  test("the y-axis tops out at a clean number", () => {
    assert.equal(niceMax(4200), 5000);
    assert.equal(niceMax(1800), 2000);
    assert.equal(niceMax(230), 250);
    assert.equal(niceMax(0), 1);
  });
  test("the smooth line never dips below its lowest point", () => {
    const d = monotonePath([{ x: 0, y: 100 }, { x: 50, y: 100 }, { x: 100, y: 10 }, { x: 150, y: 100 }]);
    const ys = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
    assert.ok(Math.max(...ys) <= 100 && Math.min(...ys) >= 10, d);
  });
  test("the trend chart labels only the peak, and skips posts without views", () => {
    const { svg, ys } = trendChartSVG({ width: 600, points: [{ views: 100, inter: 5, label: "a" }, { views: null, inter: null, label: "b" }, { views: 300, inter: 9, label: "c" }], labels: { views: "Views", inter: "Interaksi" } });
    assert.equal(ys[1], null);
    assert.equal((svg.match(/class="rl-peak"/g) || []).length, 1);
    assert.equal((svg.match(/class="rl-bar[ "]/g) || []).length, 2);
    assert.equal((svg.match(/is-peak/g) || []).length, 1);
  });
});
