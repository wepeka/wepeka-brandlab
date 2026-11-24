import { test } from "node:test";
import assert from "node:assert/strict";
import { attributionOf, attributionSplit, contentMoney, marketingTotals, productionCostOf, contentGroupKey } from "../js/content-money.js";

const sale = (id, extra) => ({ id, productId: "p", qty: 1, amount: 100000, date: "2026-11-10", ...extra });
const twinsIG = { id: "c-ig", mirrorGroupId: "g1", title: "Reel kopi", platform: "Instagram", status: "published", publishedDate: "2026-11-05", productionCost: 200000 };
const twinsTT = { id: "c-tt", mirrorGroupId: "g1", title: "Reel kopi", platform: "TikTok", status: "published", publishedDate: "2026-11-05", productionCost: 200000 };
const solo = { id: "c-solo", title: "Carousel promo", platform: "Instagram", status: "published", publishedDate: "2026-11-08" };

test("how sure a sale's source is: picked, estimated, from an integration, or unknown", () => {
  assert.equal(attributionOf(sale("a", { channel: "social" })), "manual");
  assert.equal(attributionOf(sale("a", { channel: "social", attribution: "estimate" })), "estimate");
  assert.equal(attributionOf(sale("a", { channel: "ads", attribution: "auto" })), "auto");
  assert.equal(attributionOf(sale("a", {})), "unknown");
  // "estimate" without any channel is still unknown
  assert.equal(attributionOf(sale("a", { attribution: "estimate" })), "unknown");
  // older sales read their channel from a post link
  assert.equal(attributionOf(sale("a", { source: { contentId: "x" } })), "manual");
  assert.equal(attributionOf({ kind: "expense", amount: 5 }), null);
  const split = attributionSplit({ entries: [sale("a", { channel: "social" }), sale("b", { channel: "social", attribution: "estimate", amount: 50000 }), sale("c", { amount: 25000 }), { kind: "expense", amount: 999, date: "2026-11-10" }] });
  assert.deepEqual(split, { auto: 0, manual: 100000, estimate: 50000, unknown: 25000, total: 175000, count: 3 });
});

test("one piece on several platforms is one row: a sale counts once and the production cost once", () => {
  assert.equal(contentGroupKey(twinsIG), "g1");
  assert.equal(productionCostOf([twinsIG, twinsTT]), 200000);
  assert.equal(productionCostOf([solo]), null);
  const tracker = {
    entries: [
      sale("s1", { channel: "social", source: { contentId: "c-ig" }, unitCost: 40000 }),
      sale("s2", { channel: "social", source: { contentId: "c-tt" }, unitCost: 40000 }),
      sale("s3", { channel: "ads", channelDetail: "meta", source: { contentId: "c-ig" }, unitCost: 40000, amount: 300000, qty: 3 }),
      sale("s4", { channel: "whatsapp" }), // no content: not in any row
    ],
    expenses: [{ id: "x1", kind: "expense", category: "ads", amount: 100000, date: "2026-11-09", contentId: "c-tt" }],
  };
  const rows = contentMoney({ tracker, contents: [twinsIG, twinsTT, solo] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.revenue, 500000);
  assert.equal(r.organic, 200000);
  assert.equal(r.paid, 300000);
  assert.equal(r.count, 3);
  assert.deepEqual(r.platforms.sort(), ["Instagram", "TikTok"]);
  assert.equal(r.productionCost, 200000, "not 400000: the twins carry the same cost");
  assert.equal(r.adSpend, 100000);
  assert.equal(r.cost, 300000);
  assert.equal(r.roas, 3, "300k from its ads ÷ 100k ad spend");
  // profit = 500k − 5 units × 40k = 300k; net = 300k − 300k costs = 0
  assert.equal(r.profit, 300000);
  assert.equal(r.net, 0);
  assert.equal(r.roi, 0);
  assert.equal(Math.round(r.perRp * 100) / 100, 1.67);
});

test("no ROI without product cost on every sale; a piece with only a cost still shows", () => {
  const tracker = { entries: [sale("s1", { channel: "social", source: { contentId: "c-solo" } }), sale("s2", { channel: "social", source: { contentId: "c-solo" }, unitCost: 10000 })], expenses: [] };
  const withCost = { ...solo, productionCost: 50000 };
  const [r] = contentMoney({ tracker, contents: [withCost] });
  assert.equal(r.roi, null);
  assert.equal(r.net, null);
  assert.equal(r.costCoverage, 0.5);
  assert.equal(r.perRp, 4);
  const only = contentMoney({ tracker: { entries: [], expenses: [] }, contents: [twinsIG, twinsTT] });
  assert.equal(only.length, 1);
  assert.equal(only[0].revenue, 0);
  assert.equal(only[0].cost, 200000);
  assert.equal(only[0].perRp, 0);
});

test("a deleted piece keeps its money visible instead of vanishing", () => {
  const rows = contentMoney({ tracker: { entries: [sale("s1", { channel: "social", source: { contentId: "gone" } })] }, contents: [] });
  assert.equal(rows[0].missing, true);
  assert.equal(rows[0].revenue, 100000);
});

test("marketing totals keep paid, organic and unknown apart and count production once per piece", () => {
  const tracker = {
    entries: [
      sale("s1", { channel: "ads", amount: 400000 }),
      sale("s2", { channel: "social", source: { contentId: "c-ig" }, amount: 150000 }),
      sale("s3", { channel: "event", amount: 50000 }),
      sale("s4", { amount: 70000 }),
      sale("s5", { channel: "store", amount: 30000 }),
    ],
    expenses: [
      { kind: "expense", category: "ads", amount: 100000, date: "2026-11-02" },
      { kind: "expense", category: "event", amount: 50000, date: "2026-11-03" },
      { kind: "expense", category: "stock", amount: 999999, date: "2026-11-03" },
    ],
  };
  const m = marketingTotals({ tracker, contents: [twinsIG, twinsTT, solo], from: "2026-11-01", to: "2026-11-30" });
  assert.equal(m.adSpend, 100000);
  assert.equal(m.eventSpend, 50000);
  assert.equal(m.production, 200000, "the twins once");
  assert.equal(m.spend, 350000, "stock is not marketing");
  assert.equal(m.roas, 4);
  assert.equal(m.organicContentRevenue, 150000);
  assert.equal(m.organicPerRp, 0.75);
  assert.equal(m.marketingRevenue, 600000, "ads + social + event; unknown and store stay out");
  assert.equal(m.split.unknown, 70000);
  // Outside the span: nothing.
  const none = marketingTotals({ tracker, contents: [twinsIG], from: "2026-12-01", to: "2026-12-31" });
  assert.equal(none.spend, 0);
  assert.equal(none.roas, null);
});

test("the AI's campaign line never counts an expense tagged to an event as a sale", async () => {
  const { campaignSummaryLine } = await import("../js/ai.js");
  const brand = { id: "b", brandDNA: {}, salesTracker: { entries: [
    { id: "s1", productId: "p", qty: 2, amount: 100000, date: "2026-11-10", eventId: "ev" },
    { id: "x1", kind: "expense", category: "event", amount: 750000, date: "2026-11-09", eventId: "ev" },
  ] } };
  const line = campaignSummaryLine({ id: "ev", name: "Bazar", objective: "sales" }, brand);
  assert.match(line, /2 sold, Rp 100000 in 1 logged sales/);
  assert.match(line, /money spent on this campaign \(logged\): Rp 750000/);
});

test("sales log keeps how sure the source is, and ad spend can name its post", async () => {
  const store = await import("../js/store.js");
  const { logSale, updateSale, logExpense, updateExpense, addProduct, getTracker } = await import("../js/sales-tracker.js");
  await store.initStore("u-money");
  const b = store.createBrand({ name: "Kopi Uang" });
  const c = store.createContent(b.id, { title: "Reel", status: "published", publishedDate: "2026-11-05", platform: "Instagram" });
  const p = addProduct(b.id, { name: "Kopi", price: 25000, cost: 10000 });
  const pid = p?.id || getTracker(store.getBrand(b.id)).products[0].id;
  const guess = logSale(b.id, { productId: pid, qty: 1, channel: "ads", channelDetail: "meta", source: { contentId: c.id }, attribution: "estimate" });
  assert.equal(guess.attribution, "estimate");
  assert.equal(guess.source.contentId, c.id);
  // Unknown source: nothing to be sure of, nothing stored.
  const unknown = logSale(b.id, { productId: pid, qty: 3, attribution: "estimate" });
  assert.equal(unknown.attribution, undefined);
  // Untick "perkiraan" on edit.
  const sure = updateSale(b.id, guess.id, { attribution: null });
  assert.equal(sure.attribution, undefined);
  const ad = logExpense(b.id, { category: "ads", amount: 50000, channelDetail: "meta", contentId: c.id });
  assert.equal(ad.contentId, c.id);
  // Only ad spend names a post.
  const stock = logExpense(b.id, { category: "stock", amount: 90000, contentId: c.id });
  assert.equal(stock.contentId, undefined);
  // Editing keeps the link unless it is cleared.
  assert.equal(updateExpense(b.id, ad.id, { amount: 60000 }).contentId, c.id);
});
