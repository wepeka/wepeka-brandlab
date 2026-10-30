// Sales Tracker maths: periods + the span before them, profit that never
// guesses a missing cost, edits, the double-tap guard, source breakdown.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.window.scrollTo ??= () => {};
globalThis.sessionStorage ??= new globalThis.localStorage.constructor();
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const store = await import("../js/store.js");
const T = await import("../js/sales-tracker.js");

const e = (id, date, qty, amount, over = {}) => ({ id, productId: "p1", qty, amount, date, repeat: false, referral: false, note: "", eventId: null, at: 1, ...over });
const tracker = (entries, products = [{ id: "p1", name: "Kopi", price: 10000, cost: 4000, openingSold: 0 }]) => ({ model: "product", products, entries, openingRevenue: 0, lastAdvice: null });

describe("periodRange", () => {
  const now = new Date("2026-10-14T10:00:00+07:00"); // Wednesday
  test("week = Monday..today, compared with last Monday..same weekday", () => {
    const r = T.periodRange("week", now);
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ["2026-10-12", "2026-10-14", "2026-10-05", "2026-10-07"]);
  });
  test("month = 1st..today, compared with the same number of days of last month", () => {
    const r = T.periodRange("month", now);
    assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo], ["2026-10-01", "2026-10-14", "2026-09-01", "2026-09-14"]);
  });
  test("the 31st vs a 30-day month does not spill into the next month", () => {
    const r = T.periodRange("month", new Date("2026-10-31T10:00:00+07:00"));
    assert.equal(r.prevTo, "2026-09-30");
  });
  test("30 days and all-time", () => {
    const r = T.periodRange("d30", now);
    assert.deepEqual([r.from, r.prevFrom, r.prevTo], ["2026-09-15", "2026-08-16", "2026-09-14"]);
    assert.deepEqual(T.periodRange("all", now), { key: "all", from: null, to: null, prevFrom: null, prevTo: null });
  });
});

describe("profit only counts sales with a known cost", () => {
  test("profit from sales with a cost; coverage says how much of the revenue that was", () => {
    const tr = tracker([e("a", "2026-10-01", 2, 20000), e("b", "2026-10-02", 1, 15000, { productId: "p2" })], [
      { id: "p1", name: "Kopi", price: 10000, cost: 4000, openingSold: 0 },
      { id: "p2", name: "Jasa", price: 15000, cost: null, openingSold: 0 },
    ]);
    const s = T.periodSummary(tr, {});
    assert.equal(s.revenue, 35000);
    assert.equal(s.profit, 20000 - 8000, "the Jasa sale has no cost: it is NOT counted as 100% profit");
    assert.ok(Math.abs(s.coverage - 20000 / 35000) < 1e-9);
  });
  test("no cost anywhere → profit is null, not zero", () => {
    const s = T.periodSummary(tracker([e("a", "2026-10-01", 1, 10000)], [{ id: "p1", name: "K", price: 10000, cost: null, openingSold: 0 }]), {});
    assert.equal(s.profit, null);
    assert.equal(s.coverage, 0);
  });
  test("a cost of 0 is a real cost (a service with no materials)", () => {
    const s = T.periodSummary(tracker([e("a", "2026-10-01", 1, 10000)], [{ id: "p1", name: "K", price: 10000, cost: 0, openingSold: 0 }]), {});
    assert.equal(s.profit, 10000);
  });
  test("the cost at the time of sale wins over a later change to the product's cost", () => {
    const tr = tracker([e("a", "2026-10-01", 1, 10000, { unitCost: 3000 })]);
    assert.equal(T.periodSummary(tr, {}).profit, 7000, "product cost is now 4000, the sale was made at 3000");
  });
});

describe("period summary + comparison", () => {
  const tr = tracker([e("a", "2026-10-02", 1, 10000), e("b", "2026-10-02", 3, 30000, { repeat: true }), e("c", "2026-09-05", 2, 20000)]);
  test("only entries inside the span count; averages are per sale", () => {
    const s = T.periodSummary(tr, { from: "2026-10-01", to: "2026-10-14" });
    assert.deepEqual([s.count, s.qty, s.revenue, s.avgOrder, s.activeDays, s.repeat], [2, 4, 40000, 20000, 1, 1]);
  });
  test("deltaOf: up, down, flat, new, none", () => {
    assert.deepEqual(T.deltaOf(150, 100), { dir: "up", pct: 50 });
    assert.deepEqual(T.deltaOf(50, 100), { dir: "down", pct: -50 });
    assert.deepEqual(T.deltaOf(100, 100), { dir: "flat", pct: 0 });
    assert.deepEqual(T.deltaOf(5, 0), { dir: "new", pct: null });
    assert.deepEqual(T.deltaOf(0, 0), { dir: "flat", pct: 0 });
    assert.equal(T.deltaOf(5, null), null);
  });
  test("dailySeries fills the quiet days with zeros", () => {
    const s = T.dailySeries(tr, 3, new Date("2026-10-03T09:00:00+07:00"));
    assert.deepEqual(s.map((d) => [d.date, d.qty]), [["2026-10-01", 0], ["2026-10-02", 4], ["2026-10-03", 0]]);
  });
});

describe("sourceBreakdown", () => {
  test("a post's sale counts once (under the post), campaign sales under the campaign, the rest untagged", () => {
    const tr = tracker([
      e("a", "2026-10-02", 1, 10000, { source: { contentId: "k1", campaignId: "c1" } }),
      e("b", "2026-10-02", 2, 20000, { source: { campaignId: "c1", contentId: null } }),
      e("c", "2026-10-03", 1, 10000, { eventId: "ev1" }),
      e("d", "2026-10-03", 1, 10000),
    ]);
    const s = T.sourceBreakdown(tr, {});
    assert.deepEqual(s.rows.map((r) => [r.key, r.revenue]), [["c:c1", 20000], ["k:k1", 10000], ["c:ev1", 10000]].sort((a, b) => b[1] - a[1]));
    assert.deepEqual([s.untagged.count, s.untagged.revenue, s.total], [1, 10000, 4]);
  });
});

describe("logging + editing against the store", () => {
  let brand, product;
  before(async () => {
    await store.initStore("test-uid-sales");
    brand = store.createBrand({ name: "Kopi Senja" });
    product = T.addProduct(brand.id, { name: "Kopi Susu", price: 18000, cost: 7000 });
  });
  const entries = () => T.getTracker(store.getBrand(brand.id)).entries;

  test("the cost at the time of sale is kept on the entry", () => {
    const s = T.logSale(brand.id, { productId: product.id, qty: 2, date: "2026-10-01" });
    assert.equal(s.unitCost, 7000);
    assert.equal(s.amount, 36000);
  });
  test("a double tap (same sale within seconds) is one sale", () => {
    const before = entries().length;
    const a = T.logSale(brand.id, { productId: product.id, qty: 3, date: "2026-10-02" });
    const b = T.logSale(brand.id, { productId: product.id, qty: 3, date: "2026-10-02" });
    assert.equal(a.id, b.id);
    assert.equal(entries().length, before + 1);
  });
  test("a future date lands on today; junk dates too", () => {
    const today = store.localISODate();
    assert.equal(T.cleanDate("2999-01-01"), today);
    assert.equal(T.cleanDate("not a date"), today);
    assert.equal(T.cleanDate("2026-02-30x"), today);
    assert.equal(T.cleanDate("2026-10-01"), "2026-10-01");
  });
  test("editing replaces the entry (new id, same place in the log), fixes the numbers and keeps the old cost", () => {
    const orig = T.logSale(brand.id, { productId: product.id, qty: 1, date: "2026-10-03", note: "typo" });
    T.updateProduct(brand.id, product.id, { cost: 9999 });
    const next = T.updateSale(brand.id, orig.id, { qty: 4, amount: 60000, note: "dari DM" });
    assert.notEqual(next.id, orig.id);
    assert.equal(next.at, orig.at);
    assert.deepEqual([next.qty, next.amount, next.note, next.unitCost], [4, 60000, "dari DM", 7000]);
    const list = entries();
    assert.ok(!list.some((x) => x.id === orig.id));
    assert.ok(list.some((x) => x.id === next.id));
  });
  test("moving a sale to another product takes that product's cost", () => {
    const other = T.addProduct(brand.id, { name: "Teh", price: 8000, cost: 2000 });
    const orig = T.logSale(brand.id, { productId: product.id, qty: 1, date: "2026-10-04" });
    const next = T.updateSale(brand.id, orig.id, { productId: other.id });
    assert.deepEqual([next.productId, next.unitCost], [other.id, 2000]);
  });
  test("editing something that isn't there does nothing", () => {
    assert.equal(T.updateSale(brand.id, "nope", { qty: 2 }), null);
  });
});

describe("channels + expenses", () => {
  let brand, product;
  before(async () => {
    await store.initStore("test-uid-sales-2");
    brand = store.createBrand({ name: "Toko Kue" });
    // The log lives in month docs: load it, as the page does, so the store
    // merges saves back in instead of reading the brand doc alone.
    await store.ensureBrandSales(brand.id);
    product = T.addProduct(brand.id, { name: "Bolu", price: 50000, cost: 20000 });
  });
  const tr = () => T.getTracker(store.getBrand(brand.id));

  test("an expense never counts as a sale, and saving anything else keeps it", () => {
    T.logSale(brand.id, { productId: product.id, qty: 2, date: "2026-10-05", channel: "ads", channelDetail: "tiktok" });
    T.logExpense(brand.id, { category: "ads", amount: 40000, date: "2026-10-04", channelDetail: "tiktok" });
    T.saveAdvice(brand.id, { summary: "x", actions: [] });
    T.logSale(brand.id, { productId: product.id, qty: 1, date: "2026-10-06", channel: "event", channelDetail: "Bazar Okt" });
    assert.equal(tr().expenses.length, 1, "advice + a new sale didn't drop the expense");
    assert.equal(T.trackerTotals(tr()).revenue, 150000, "revenue = sales only");
    assert.ok(tr().entries.every((e) => e.kind !== "expense"));
  });
  test("money in, money out and what's left over a span", () => {
    const s = T.periodSummary(tr(), { from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual([s.revenue, s.spend, s.net], [150000, 40000, 110000]);
  });
  test("channel revenue sits next to the spending logged for it", () => {
    const c = T.channelBreakdown(tr(), { from: "2026-10-01", to: "2026-10-31" });
    const ads = c.rows.find((r) => r.key === "ads");
    assert.deepEqual([ads.revenue, ads.spend, ads.perRp, ads.details.tiktok], [100000, 40000, 2.5, 100000]);
    assert.equal(c.rows.find((r) => r.key === "event").spend, 0);
    assert.equal(c.rows.find((r) => r.key === "event").perRp, null);
  });
  test("picking 'recommendation' as the channel ticks the referral flag (Sales Growth counts it)", () => {
    const s = T.logSale(brand.id, { productId: product.id, qty: 1, date: "2026-10-07", channel: "referral" });
    assert.equal(s.referral, true);
  });
  test("older sales get a channel from their other tags; unknown channels are dropped", () => {
    assert.equal(T.entryChannel({ source: { contentId: "k" } }), "social");
    assert.equal(T.entryChannel({ eventId: "e" }), "event");
    assert.equal(T.entryChannel({ referral: true }), "referral");
    assert.equal(T.entryChannel({}), null);
    const s = T.logSale(brand.id, { productId: product.id, qty: 5, date: "2026-10-08", channel: "telepathy" });
    assert.equal(s.channel, undefined);
  });
  test("editing an expense and a sale's channel; deleting an expense", () => {
    const x = tr().expenses[0];
    const y = T.updateExpense(brand.id, x.id, { amount: 60000 });
    assert.deepEqual([y.amount, y.category, y.at], [60000, "ads", x.at]);
    const sale = tr().entries[0];
    const moved = T.updateSale(brand.id, sale.id, { channel: "whatsapp", channelDetail: "" });
    assert.deepEqual([moved.channel, moved.channelDetail], ["whatsapp", undefined]);
    T.deleteExpense(brand.id, y.id);
    assert.equal(tr().expenses.length, 0);
    assert.equal(T.logExpense(brand.id, { category: "stock", amount: 0 }), null, "no zero expense");
  });
  test("the AI's snapshot carries channels, spending and the per-Rp figure — computed, not left to the model", () => {
    const today = store.localISODate();
    T.logSale(brand.id, { productId: product.id, qty: 2, date: today, channel: "ads", channelDetail: "meta" });
    T.logExpense(brand.id, { category: "ads", amount: 25000, date: today, channelDetail: "meta" });
    const text = T.salesSnapshotText(store.getBrand(brand.id), { unit: "pcs" });
    assert.match(text, /- ads: .*Rp 25000 → Rp 4\.0 revenue per Rp 1 spent/);
    assert.match(text, /Money out this month \(logged expenses\): Rp 25000 — ads Rp 25000/);
  });
});

describe("AI snapshot: the running week", () => {
  test("the last weekly number is labelled as this week so far", async () => {
    await store.initStore("test-uid-sales-3");
    const b = store.createBrand({ name: "Minggu" });
    await store.ensureBrandSales(b.id);
    const text = T.salesSnapshotText(store.getBrand(b.id), { unit: "pcs" });
    assert.match(text, /LAST number is this week so far \(day [1-7] of 7\)/);
  });
});

describe("linking sales and costs to My Goals events and goals", () => {
  test("an event's page counts the sales linked to it from any channel, plus the costs logged for it", async () => {
    await store.initStore("test-uid-sales-4");
    const b = store.createBrand({ name: "Bazar" });
    await store.ensureBrandSales(b.id);
    const p = T.addProduct(b.id, { name: "Kaos", price: 100000, cost: 40000 });
    const ev = { id: "ev-1" }, goal = { id: "goal-1" };
    T.logSale(b.id, { productId: p.id, qty: 3, date: "2026-10-10", channel: "event", channelDetail: "Bazar Okt", source: { campaignId: ev.id }, eventId: ev.id });
    T.logSale(b.id, { productId: p.id, qty: 1, date: "2026-10-11", channel: "ads", channelDetail: "meta", source: { campaignId: ev.id }, eventId: ev.id });
    T.logSale(b.id, { productId: p.id, qty: 2, date: "2026-10-12", channel: "social", source: { campaignId: goal.id } });
    T.logExpense(b.id, { category: "event", amount: 150000, date: "2026-10-09", eventId: ev.id });
    T.logExpense(b.id, { category: "ads", amount: 50000, date: "2026-10-09", campaignId: goal.id });
    const brand = store.getBrand(b.id);
    const es = T.eventSalesStats(brand, ev.id);
    assert.deepEqual([es.qty, es.revenue, es.spend], [4, 400000, 150000]);
    const cs = T.campaignSalesStats(brand, goal.id);
    assert.deepEqual([cs.count, cs.revenue, cs.spend], [1, 200000, 50000]);
    assert.equal(T.getTracker(brand).expenses.find((x) => x.campaignId).campaignId, goal.id);
  });
});
