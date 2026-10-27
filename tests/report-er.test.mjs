// Report page: the engagement-rate stops (2026-10-27, "analytics yang dulu
// grafik2 dll engagement rate masukin di report juga") — ER over time, the
// health mix, ER per platform / format, the interactions as a share of
// reach, and the ER chart. Pure functions over computeReportData's posts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
const { erSeries, healthMix, erBy, engagementMix, trendSeries, MAX_POST_POINTS } = await import("../js/report-journey.js");
const { erChartSVG } = await import("../js/views/report-charts.js");

const nums = (n = {}) => ({ views: null, reach: null, likes: null, comments: null, shares: null, saves: null, reposts: null, profileVisits: null, followersGained: null, ...n });
const post = (id, date, er, extra = {}) => ({ c: { id, title: id, publishedDate: date, platform: extra.platform || "Instagram", format: extra.format || "Reels" }, er, health: extra.health ?? null, nums: nums(extra.nums) });

describe("ER over time", () => {
  test("per post: each post's own ER, a post without one stays null", () => {
    const d = { posts: [post("a", "2026-10-12", 6.5), post("b", "2026-10-14", null), post("c", "2026-10-15", 9.1)] };
    const s = erSeries(d);
    assert.equal(s.unit, "post");
    assert.deepEqual(s.points.map((p) => [p.key, p.er]), [["a", 6.5], ["b", null], ["c", 9.1]]);
  });
  test("per week once there are many posts: the average ER of the week's posts, on the same weeks as the views chart", () => {
    const posts = [];
    for (let i = 0; i <= MAX_POST_POINTS; i++) {
      const day = new Date(2026, 6, 6 + Math.floor(i / 3) * 7 + (i % 3));
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      posts.push(post(`p${i}`, iso, i % 3 === 2 ? null : (i % 3) + 4));
    }
    const d = { posts };
    const trend = trendSeries(d);
    const s = erSeries(d, trend);
    assert.equal(s.unit, "week");
    assert.deepEqual(s.points.map((p) => p.key), trend.points.map((p) => p.key));
    assert.equal(s.points[0].er, 4.5);
    assert.equal(s.points[0].rated, 2);
    assert.equal(s.points[0].n, 3);
  });
});

describe("content health and ER per group", () => {
  test("health counts in the scale's order, unrated apart", () => {
    const d = { posts: [post("a", "2026-10-12", 12, { health: "excellent" }), post("b", "2026-10-13", 8.5, { health: "good" }), post("c", "2026-10-14", 2, { health: "poor" }), post("d", "2026-10-15", null)] };
    assert.deepEqual(healthMix(d), { counts: { excellent: 1, good: 1, average: 0, poor: 1 }, rated: 3, unrated: 1 });
  });
  test("average ER per platform and per format, only posts with an ER, highest first", () => {
    const d = { posts: [
      post("a", "2026-10-12", 4, { platform: "Instagram", format: "Reels" }),
      post("b", "2026-10-13", 8, { platform: "Instagram", format: "Carousel" }),
      post("c", "2026-10-14", 9, { platform: "TikTok", format: "Reels" }),
      post("d", "2026-10-15", null, { platform: "YouTube", format: "Video" }),
    ] };
    assert.deepEqual(erBy(d, (x) => x.c.platform), [{ name: "TikTok", avg: 9, n: 1 }, { name: "Instagram", avg: 6, n: 2 }]);
    assert.deepEqual(erBy(d, (x) => x.c.format).map((r) => [r.name, r.avg]), [["Carousel", 8], ["Reels", 6.5]]);
  });
});

describe("what the interactions are made of", () => {
  test("each kind as % of reach, averaged over posts that have both numbers; kinds nobody filled are left out", () => {
    const d = { posts: [
      post("a", "2026-10-12", 5, { nums: { reach: 1000, saves: 20, shares: 10, likes: 50 } }),
      post("b", "2026-10-13", 5, { nums: { reach: 500, saves: 5, likes: 40 } }),
      post("c", "2026-10-14", 5, { nums: { saves: 99 } }),
    ] };
    const mix = engagementMix(d);
    assert.deepEqual(mix.map((r) => [r.key, Math.round(r.avg * 100) / 100, r.n]), [["saveRate", 1.5, 2], ["shareRate", 1, 1], ["likeRate", 6.5, 2]]);
  });
});

describe("the ER chart", () => {
  test("a dashed healthy guide, the highest point labelled, a point per post", () => {
    const { svg, xs, ys } = erChartSVG({ width: 640, points: [{ er: 3, label: "1" }, { er: null, label: "2" }, { er: 11.2, label: "3" }], guide: 8, fmt: (v) => `${v}%`, labels: { guide: "sehat 8%", peak: "tertinggi", aria: "ER" } });
    assert.equal(xs.length, 3);
    assert.equal(ys[1], null);
    assert.match(svg, /class="rl-er-guide"/);
    assert.match(svg, /sehat 8%/);
    assert.match(svg, /11\.2% · tertinggi/);
    assert.match(svg, /class="rl-line is-er"/);
  });
  test("the guide stays off when it would sit above the chart", () => {
    const { svg } = erChartSVG({ width: 400, points: [{ er: 1, label: "a" }, { er: 2, label: "b" }], guide: null });
    assert.doesNotMatch(svg, /rl-er-guide/);
  });
});
