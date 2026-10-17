// Brand report (2026-10-17): the interactions recap (likes, comments,
// shares, saves… per period and per post) and the numbers "Saran AI" reads.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { initStore, createBrand, createContent, contentMetric } = await import("../js/store.js");
const { computeReportData, reportSnapshotText, adviceSig, RECAP_KEYS } = await import("../js/views/report.js");

await initStore("test-uid-report-recap");
const brand = createBrand({ name: "Kopi Senja" });
const post = (title, publishedDate, extra) => createContent(brand.id, { title, status: "published", publishedDate, scheduleDate: publishedDate, format: "Reels", funnel: "TOFU", ...extra });
post("Cara seduh V60", "2026-10-12", { performance: { views: 1200, reach: 1000, likes: 80, comments: 12, shares: 9, saves: 30 } });
post("Behind the bar", "2026-10-14", { performanceByPlatform: { instagram: { views: 500, reach: 400, likes: 20, comments: 3 }, facebook: { views: 100, likes: 5 } } });
post("Belum diisi", "2026-10-15", { performance: {} });
post("Minggu lalu", "2026-10-05", { performance: { views: 300, reach: 280, likes: 10, comments: 1, shares: 0, saves: 2 } });

describe("contentMetric", () => {
  test("per-platform numbers are added up; a missing number is null, not 0", () => {
    const c = { performanceByPlatform: { instagram: { likes: 20 }, facebook: { likes: 5 } } };
    assert.equal(contentMetric(c, "likes"), 25);
    assert.equal(contentMetric(c, "shares"), null);
    assert.equal(contentMetric({ performance: { saves: "7" } }, "saves"), 7);
    assert.equal(contentMetric({ performance: { saves: "" } }, "saves"), null);
  });
});

describe("report: interactions recap", () => {
  const d = computeReportData(brand, "2026-10-11", "2026-10-17");

  test("totals over the period's published posts, with how many posts had each number", () => {
    assert.equal(d.publishedCount, 3);
    assert.equal(d.postsWithNumbers, 2);
    assert.deepEqual(d.recap.likes, { total: 105, n: 2 });
    assert.deepEqual(d.recap.comments, { total: 15, n: 2 });
    assert.deepEqual(d.recap.shares, { total: 9, n: 1 });
    assert.deepEqual(d.recap.saves, { total: 30, n: 1 });
    assert.deepEqual(d.recap.views, { total: 1800, n: 2 });
    assert.deepEqual(d.recap.followersGained, { total: 0, n: 0 });
    assert.deepEqual(RECAP_KEYS.slice(0, 6), ["views", "reach", "likes", "comments", "shares", "saves"]);
  });

  test("every published post is listed oldest first, with its own numbers", () => {
    assert.deepEqual(d.posts.map((x) => x.c.title), ["Cara seduh V60", "Behind the bar", "Belum diisi"]);
    assert.equal(d.posts[1].nums.likes, 25);
    assert.equal(d.posts[2].nums.likes, null);
  });
});

describe("report: what Saran AI reads", () => {
  const d = computeReportData(brand, "2026-10-11", "2026-10-17");
  const p = computeReportData(brand, "2026-10-04", "2026-10-10");
  const text = reportSnapshotText(brand, "2026-10-11", "2026-10-17", d, p, { start: "2026-10-04", end: "2026-10-10", days: 7 });

  test("the period, the totals against the period before, and each post", () => {
    assert.match(text, /Period: 2026-10-11 to 2026-10-17 \(7 days\)/);
    assert.match(text, /- likes: 105 \| 10/);
    assert.match(text, /- shares: 9 \| 0/);
    assert.match(text, /- followersGained: no data \| no data/);
    assert.match(text, /"Cara seduh V60" \| 2026-10-12 \| Reels \| TOFU \| 1200 \| 1000 \| 80 \| 12 \| 9 \| 30/);
    assert.match(text, /"Belum diisi" .*\| \? \| \? \|/);
    assert.match(text, /This app's scale: 10% and up very good/);
  });

  test("the fingerprint changes with the numbers and the language, not otherwise", () => {
    assert.equal(adviceSig(text, "id"), adviceSig(text, "id"));
    assert.notEqual(adviceSig(text, "id"), adviceSig(text, "en"));
    assert.notEqual(adviceSig(text, "id"), adviceSig(text.replace("105", "106"), "id"));
  });
});
