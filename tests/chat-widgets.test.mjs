import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeWidget, computeWidgets, periodRange, widgetMenuText, widgetFactsText, widgetHTML, widgetHistoryLine } from "../js/chat-widgets.js";
import { parseDirectives, serializeDirectives, isEmptyReply } from "../js/ai-directives.js";
import { movesToConsultant, isContentTalk } from "../js/chat-router.js";

const settings = {
  formulas: { engagementRate: "(likes + comments + shares + saves) / reach * 100", followerConversionRate: "followersGained / reach * 100" },
  thresholds: { TOFU: {}, MOFU: {}, BOFU: {} },
  erScale: { excellent: 10, good: 8, average: 4 },
};
const post = (id, date, perf, extra = {}) => ({ id, title: `Post ${id}`, status: "published", publishedDate: date, format: "Reels", funnel: "TOFU", performance: perf, ...extra });
const today = "2026-10-29";
const content = [
  post("a", "2026-10-25", { views: 5000, reach: 1000, likes: 80, comments: 10, shares: 5, saves: 5 }),
  post("b", "2026-10-20", { views: 1200, reach: 500, likes: 10, comments: 2, shares: 0, saves: 3 }, { format: "Carousel", funnel: "MOFU" }),
  post("c", "2026-10-05", { views: 800, reach: 400, likes: 20, comments: 1, shares: 1, saves: 2 }),
  post("old", "2026-09-10", { views: 300, reach: 200, likes: 4, comments: 0, shares: 0, saves: 0 }),
  { id: "plan", title: "Besok", status: "scheduled", scheduleDate: "2026-10-30" },
  { id: "late", title: "Telat", status: "draft", scheduleDate: "2026-10-20" },
];
const brand = { id: "b1", name: "Kopi", insightsHistory: [
  { platform: "instagram", followers: 900, at: new Date("2026-09-20T10:00:00").getTime() },
  { platform: "instagram", followers: 1000, at: new Date("2026-10-28T10:00:00").getTime() },
] };
const ctx = { brand, content, campaigns: [], settings, today };

describe("chat widgets: numbers from the brand's own data", () => {
  test("periodRange: last N days and the N before", () => {
    assert.deepEqual(periodRange("7", today), { key: "7", start: "2026-10-23", end: today, prev: { start: "2026-10-16", end: "2026-10-22" } });
    assert.equal(periodRange("all", today).prev, null);
    assert.equal(periodRange("nonsense", today).key, "30");
  });
  test("performance compares with the period before", () => {
    const w = computeWidget({ kind: "performance", period: "30" }, ctx);
    assert.equal(w.now.posts, 3);
    assert.equal(w.now.views, 7000);
    assert.equal(w.before.posts, 1);
    assert.equal(w.points.length, 3);
    assert.equal(w.empty, false);
  });
  test("top posts by views, best first", () => {
    const w = computeWidget({ kind: "top-posts", period: "30" }, ctx);
    assert.deepEqual(w.posts.map((p) => p.id), ["a", "b", "c"]);
    assert.equal(w.metric, "views");
  });
  test("formats: average ER per format", () => {
    const w = computeWidget({ kind: "formats", period: "30" }, ctx);
    assert.deepEqual(w.groups.map((g) => g.name), ["Reels", "Carousel"]);
    assert.equal(w.groups[0].n, 2);
  });
  test("funnel keeps all three stages in order", () => {
    const w = computeWidget({ kind: "funnel", period: "30" }, ctx);
    assert.deepEqual(w.groups.map((g) => [g.name, g.n]), [["TOFU", 2], ["MOFU", 1], ["BOFU", 0]]);
  });
  test("followers: latest count and change over the period", () => {
    const w = computeWidget({ kind: "followers", period: "30" }, ctx);
    assert.equal(w.platforms[0].now, 1000);
    assert.equal(w.platforms[0].delta, 100);
  });
  test("schedule: next 7 days and overdue", () => {
    const w = computeWidget({ kind: "schedule" }, ctx);
    assert.equal(w.days.length, 7);
    assert.equal(w.days[1].items[0].title, "Besok");
    assert.equal(w.overdue, 1);
  });
  test("empty data says so instead of drawing zeros", () => {
    const w = computeWidget({ kind: "sales", period: "30" }, ctx);
    assert.equal(w.empty, true);
    const html = widgetHTML(w);
    assert.match(html, /chw-empty/);
    assert.equal(computeWidget({ kind: "campaign", arg: "x" }, ctx).empty, true);
  });
  test("unknown kind → nothing; duplicates and extras dropped; storable", () => {
    assert.equal(computeWidget({ kind: "pie" }, ctx), null);
    const list = computeWidgets([{ kind: "performance", period: "30", arg: "" }, { kind: "performance", period: "30", arg: "" }, { kind: "formats", period: "90", arg: "" }, { kind: "schedule", period: "30", arg: "" }], ctx);
    assert.deepEqual(list.map((w) => w.kind), ["performance", "formats"]);
    assert.doesNotMatch(JSON.stringify(list), /undefined|NaN/);
  });
  test("every widget renders without throwing", () => {
    for (const kind of ["performance", "engagement", "top-posts", "formats", "funnel", "followers", "sales", "retention", "schedule", "campaign"]) {
      const html = widgetHTML(computeWidget({ kind, period: "30" }, ctx), { fresh: true });
      assert.match(html, /chw-card/, kind);
      assert.doesNotMatch(html, /undefined|NaN/, kind);
    }
  });
  test("the prompt's menu marks kinds with no data", () => {
    const menu = widgetMenuText(ctx);
    assert.match(menu, /sales: .*NO DATA YET/);
    assert.doesNotMatch(menu, /performance: .*NO DATA YET/);
    assert.match(widgetFactsText(ctx), /konten terbit 3 \(sebelumnya 1\)/);
  });
});

describe("[[widget:…]] directive", () => {
  test("parsed, hidden from the text, capped at 2", () => {
    const p = parseDirectives("Naik.\n[[widget:performance|30]]\n[[widget:top_posts|bulan]]\n[[widget:formats]]");
    assert.equal(p.cleanText, "Naik.");
    assert.deepEqual(p.widgets, [{ kind: "performance", period: "30", arg: "" }, { kind: "top-posts", period: "30", arg: "" }]);
  });
  test("campaign takes an id; unknown kinds are dropped", () => {
    assert.deepEqual(parseDirectives("x [[widget:campaign|abc-1]] [[widget:pie|7]]").widgets, [{ kind: "campaign", period: "30", arg: "abc-1" }]);
  });
  test("a widget-only reply isn't empty; it goes back into the history", () => {
    assert.equal(isEmptyReply(parseDirectives("[[widget:schedule]]")), false);
    const w = computeWidget({ kind: "top-posts", period: "30" }, ctx);
    assert.match(serializeDirectives("Ini dia", { widgets: [w] }), /\[\[widget:top-posts\|30\]\] \(chart shown: 1\. Post a/);
    assert.match(widgetHistoryLine(w), /^\[\[widget:top-posts\|30\]\]/);
  });
});

describe("routing: own numbers → Konsultan, content buttons only for content talk", () => {
  test("movesToConsultant", () => {
    assert.equal(movesToConsultant("terus performa konten aku gimana?"), true);
    assert.equal(movesToConsultant("followers aku naik berapa bulan ini"), true);
    assert.equal(movesToConsultant("followers mereka berapa sih?"), false);
    assert.equal(movesToConsultant("bikinin ide konten dong"), false);
    assert.equal(movesToConsultant("capek banget"), false);
  });
  test("isContentTalk", () => {
    assert.equal(isContentTalk("bedah marketing Mixue"), true);
    assert.equal(isContentTalk("hook yang bagus gimana"), true);
    assert.equal(isContentTalk("menurutmu harga Rp15rb kemahalan nggak?"), false);
  });
});

describe("[[reasoning]] — Cara aku nyimpulin", async () => {
  const { parseReasoning } = await import("../js/ai-directives.js");
  test("steps and the conclusion, out of the text", () => {
    const p = parseDirectives("[[reasoning]]\n- Cek: views 30 hari vs sebelumnya → 38.200 vs 12.300\n2. Konten teratas -> Kujang 48% views\nJadi: naik, tapi bertumpu ke satu konten\n[[/reasoning]]\nBulan ini naik.");
    assert.equal(p.cleanText, "Bulan ini naik.");
    assert.deepEqual(p.reasoning, [
      { kind: "step", check: "views 30 hari vs sebelumnya", found: "38.200 vs 12.300" },
      { kind: "step", check: "Konten teratas", found: "Kujang 48% views" },
      { kind: "conclusion", text: "naik, tapi bertumpu ke satu konten" },
    ]);
    assert.equal(isEmptyReply(parseDirectives("[[reasoning]]\nA → b\n[[/reasoning]]")), false);
  });
  test("while streaming: finished lines only, nothing raw in the text", () => {
    const p = parseDirectives("[[reasoning]]\nViews → naik\nKonten tera");
    assert.deepEqual(p.reasoningLive, [{ kind: "step", check: "Views", found: "naik" }]);
    assert.equal(p.cleanText, "");
  });
  test("goes back into the history", () => {
    assert.match(serializeDirectives("Naik.", { reasoning: parseReasoning("A → b\nJadi: c") }), /^\[\[reasoning\]\]\nA → b\nJadi: c\n\[\[\/reasoning\]\]\nNaik\.$/);
  });
});
