// Sales Tracker: the brand's product list and its sales log — and the one
// place a sale gets typed in. Everything else is derived from it.
//
// ONE INPUT, MANY READERS. The user does exactly one thing: "log a sale"
// (product, quantity — date and revenue fill themselves in). From that:
//   - totals / this month / the 8-week trend on the tracker page,
//   - the running Sales Growth campaign's numbers (js/goal-plan.js
//     buildSalesGrowthPlan): each product's "sold", revenue, repeat buyers
//     and referrals are pushed into campaign.manualMetrics here, so nobody
//     re-types them on the campaign page,
//   - the AI advice (js/ai.js suggestSalesActions) and the Excel/PDF export.
// The product list is shared both ways with the Grow Brand wizard: products
// typed there land here (mergeProductsFromWizard), and the wizard pre-fills
// from what's already here.
//
// STORAGE: `brand.salesTracker` on the brand document — except the sales
// log itself: entries live in one doc per month, brands/{brandId}/sales/
// {YYYY-MM} (the log grew without bound inside a doc Firestore caps at
// 1 MiB). js/store.js merges them back into `salesTracker.entries` in
// memory and writes what a save added/removed, so everything here still
// reads and writes the one `entries` array; old brands whose entries are
// still inline read as before and move out on the next Sales Tracker save.
//   { model, products: [{ id, name, price, cost, openingSold, discountPct,
//     discountUntil, archived }], openingRevenue, entries: [{ id, productId,
//     qty, amount, date, repeat, referral, note, eventId, source, at }],
//     lastAdvice }
// `channel` (optional): HOW the buyer came — one of SALE_CHANNELS (ads,
// social, whatsapp, event, store, marketplace, website, referral, reseller,
// other) — plus `channelDetail` (the ad platform, or the event's name).
// Older sales carry none; entryChannel() reads one from their other tags.
// EXPENSES share the month docs: an entry with `kind: "expense"` is money
// going out — { id, kind, category, amount, date, note, channelDetail, at }.
// getTracker() splits them off (`expenses`), so every reader of `entries`
// (campaign metrics, report, AI, exports) still sees sales only; save()
// puts both back together before writing.
// `source` (optional): where the sale came from — { campaignId, contentId }.
// Picking a piece of content fills its campaign in too; picking an Event
// campaign also sets `eventId` (the older field its widget reads).
// `openingSold` / `openingRevenue`: what was already sold before tracking
// started (the wizard's "sold so far") — counted in totals, never shown as
// a dated sale.
//
// Still 100% manual entry: there is no sales backend and nothing here reads
// or asks for ads data.
import { getBrand, updateBrand, listCampaigns, updateCampaign, getContent, listContent, localISODate, isBrandSalesReady, ensureBrandSales, emitStep } from "./store.js";

const DAY = 86400000;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// `loading`: the brand's month docs (js/store.js) aren't in memory yet —
// totals from `entries` are partial then, not final; asking starts the load
// (the page repaints when it lands).
export function getTracker(brand) {
  const s = brand?.salesTracker || {};
  const loading = !!brand?.id && !isBrandSalesReady(brand.id);
  if (loading) ensureBrandSales(brand.id);
  const all = Array.isArray(s.entries) ? s.entries : [];
  return {
    model: s.model || "product",
    products: Array.isArray(s.products) ? s.products : [],
    entries: all.filter((e) => e?.kind !== "expense"),
    expenses: all.filter((e) => e?.kind === "expense"),
    openingRevenue: num(s.openingRevenue),
    lastAdvice: s.lastAdvice || null,
    loading,
  };
}
// What gets stored: sales and expenses back in the one `entries` log.
function stored(tracker, patch = {}) {
  const { loading, entries, expenses, ...rest } = tracker;
  const { entries: nextSales = entries, expenses: nextExpenses = expenses, ...restPatch } = patch;
  return { ...rest, ...restPatch, entries: [...nextSales, ...nextExpenses] };
}
function save(brandId, patch) {
  const brand = getBrand(brandId);
  if (!brand) return null;
  const next = { ...stored(getTracker(brand), patch), updatedAt: Date.now() };
  updateBrand(brandId, { salesTracker: next });
  syncSalesCampaign(brandId);
  return next;
}

// ---------- Products ----------
// `discountPct` + `discountUntil` (ISO date, inclusive): an optional running
// discount on a product's price. No end date means it just stays on until
// someone clears it. `activeDiscount`/`effectivePrice` below are the only
// places that read it — everywhere else keeps using `product.price`.
export function addProduct(brandId, { id, name, price, cost = null, openingSold = 0, discountPct = null, discountUntil = null }) {
  const tr = getTracker(getBrand(brandId));
  const product = {
    id: id || uid("p"), name: String(name || "").trim(), price: num(price), cost: cost === null || cost === "" ? null : num(cost),
    openingSold: Math.max(0, num(openingSold)), discountPct: discountPct ? Math.min(95, Math.max(0, num(discountPct))) : null, discountUntil: discountPct ? discountUntil || null : null,
    archived: false, createdAt: Date.now(),
  };
  save(brandId, { products: [...tr.products, product] });
  return product;
}
export function activeDiscountPct(product, today = localISODate()) {
  const pct = num(product?.discountPct);
  if (!pct || pct <= 0) return 0;
  if (product.discountUntil && product.discountUntil < today) return 0;
  return Math.min(95, pct);
}
export function effectivePrice(product, today = localISODate()) {
  const pct = activeDiscountPct(product, today);
  return pct ? Math.max(0, Math.round(product.price * (1 - pct / 100))) : product.price;
}
export function updateProduct(brandId, productId, patch) {
  const tr = getTracker(getBrand(brandId));
  save(brandId, { products: tr.products.map((p) => (p.id === productId ? { ...p, ...patch } : p)) });
}
// Products typed into the Grow Brand wizard. Matched by id first, then by
// name — an existing product keeps its own log and opening number (the
// wizard showed its tracked total, so there's nothing new to learn from it);
// a new one brings its "sold so far" in as the opening number.
export function mergeProductsFromWizard(brandId, { model, products, openingRevenue = null }) {
  const tr = getTracker(getBrand(brandId));
  const list = [...tr.products];
  const idMap = {};
  (products || []).forEach((w) => {
    const hit = list.find((p) => p.id === w.id) || list.find((p) => p.name.trim().toLowerCase() === String(w.name).trim().toLowerCase());
    if (hit) {
      idMap[w.id] = hit.id;
      Object.assign(hit, { name: String(w.name).trim(), price: num(w.price) || hit.price, cost: w.cost ?? hit.cost ?? null, archived: false });
    } else {
      idMap[w.id] = w.id;
      list.push({ id: w.id, name: String(w.name).trim(), price: num(w.price), cost: w.cost ?? null, openingSold: Math.max(0, num(w.sold)), archived: false, createdAt: Date.now() });
    }
  });
  const patch = { model: model || tr.model, products: list };
  if (openingRevenue !== null && !tr.entries.length) patch.openingRevenue = Math.max(0, num(openingRevenue));
  save(brandId, patch);
  return idMap;
}

// ---------- Sales log ----------
// `eventId`: optional link to an Event campaign (campaign.eventPlan) — for a
// brand that sells at bazaars/launches/pop-ups, tagging a sale with which
// event it came from is what lets eventSalesStats below answer "this event
// sold how many of what" on the campaign's own page.
export function logSale(brandId, { productId, qty = 1, amount = null, date = localISODate(), repeat = false, referral = false, note = "", eventId = null, source = null, channel = null, channelDetail = "" }) {
  const tr = getTracker(getBrand(brandId));
  const product = tr.products.find((p) => p.id === productId);
  if (!product) return null;
  const q = Math.max(1, Math.round(num(qty)) || 1);
  const day = cleanDate(date);
  const src = normalizeSource(source, eventId);
  const total = amount === null || amount === "" ? effectivePrice(product, day) * q : Math.max(0, num(amount));
  // A double tap / double Enter must not log the sale twice: the same product,
  // quantity, money, day and note within a few seconds is the same sale.
  const twin = tr.entries.find((e) => Date.now() - e.at < DUPLICATE_MS && e.productId === productId && e.qty === q && e.amount === total && e.date === day && (e.note || "") === String(note || "").trim().slice(0, 140));
  if (twin) return twin;
  // unitCost: what one unit cost WHEN it was sold — a later change to the
  // product's cost must not rewrite the profit of sales already logged.
  const ch = cleanChannel(channel, channelDetail);
  const entry = { id: uid("s"), productId, qty: q, amount: total, date: day, repeat: !!repeat, referral: !!referral || ch.channel === "referral", note: String(note || "").trim().slice(0, 140), eventId: eventId || null, ...(src ? { source: src } : {}), ...ch, ...(knownCost(product.cost) ? { unitCost: num(product.cost) } : {}), at: Date.now() };
  save(brandId, { entries: [...tr.entries, entry] });
  emitStep("numbers_logged", { brandId, kind: "sales" });
  return entry;
}
const DUPLICATE_MS = 4000;
const knownCost = (c) => c !== null && c !== undefined && c !== "" && Number.isFinite(Number(c)) && Number(c) >= 0;
// A usable ISO day, never in the future (the form caps it too; this is the
// model's own guard so a typo can't hide a sale outside every period).
export function cleanDate(d, today = localISODate()) {
  const v = String(d || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) return today;
  return v > today ? today : v;
}
// Edit a logged sale. The cloud log only ever adds/removes whole entries
// (js/store.js salesWritePlan), so an edit is "replace": the same sale gets a
// new id and keeps its original `at`, which keeps its place in the log.
export function updateSale(brandId, entryId, patch = {}) {
  const tr = getTracker(getBrand(brandId));
  const old = tr.entries.find((e) => e.id === entryId);
  const product = tr.products.find((p) => p.id === (patch.productId || old?.productId));
  if (!old || !product) return null;
  const changedProduct = product.id !== old.productId;
  const q = patch.qty === undefined ? old.qty : Math.max(1, Math.round(num(patch.qty)) || 1);
  const src = patch.source === undefined ? old.source || null : normalizeSource(patch.source, patch.eventId ?? null);
  const eventId = patch.source === undefined ? old.eventId || null : patch.eventId || null;
  const { unitCost, source: _s, ...rest } = old;
  const cost = changedProduct ? (knownCost(product.cost) ? num(product.cost) : null) : unitCost ?? null;
  const next = {
    ...rest, id: uid("s"), productId: product.id, qty: q,
    amount: patch.amount === undefined || patch.amount === null || patch.amount === "" ? old.amount : Math.max(0, num(patch.amount)),
    date: patch.date === undefined ? old.date : cleanDate(patch.date),
    note: patch.note === undefined ? old.note || "" : String(patch.note || "").trim().slice(0, 140),
    repeat: patch.repeat === undefined ? !!old.repeat : !!patch.repeat,
    referral: patch.referral === undefined ? !!old.referral : !!patch.referral,
    eventId, ...(src ? { source: src } : {}), ...(cost !== null ? { unitCost: cost } : {}), editedAt: Date.now(),
  };
  if (patch.channel !== undefined) {
    delete next.channel;
    delete next.channelDetail;
    Object.assign(next, cleanChannel(patch.channel, patch.channelDetail));
    if (next.channel === "referral") next.referral = true;
  }
  save(brandId, { entries: tr.entries.map((e) => (e.id === entryId ? next : e)) });
  return next;
}
// ---------- Channels: how the buyer came ----------
// `detail`: what a channel can be narrowed to — "ad" = which ad platform,
// "event" = which fair/bazaar (an Event campaign or a typed name), "content"
// = which post. Colours/icons are for the picker tiles (js/views/sales-wizard.js).
export const SALE_CHANNELS = [
  { key: "ads", icon: "megaphone", color: "#FF6B3D", detail: "ad" },
  { key: "social", icon: "instagram", color: "#E04FD8", detail: "content" },
  { key: "whatsapp", icon: "chat", color: "#22C55E" },
  { key: "event", icon: "tent", color: "#FFB020", detail: "event" },
  { key: "store", icon: "store", color: "#3B9BFF" },
  { key: "marketplace", icon: "cart", color: "#FF5C35" },
  { key: "website", icon: "globe", color: "#4F55F5" },
  { key: "referral", icon: "users", color: "#14B8A6" },
  { key: "reseller", icon: "box", color: "#A974FF" },
  { key: "other", icon: "dots", color: "#8A8479" },
];
export const AD_PLATFORMS = ["meta", "tiktok", "google", "marketplace", "other"];
export const channelByKey = (key) => SALE_CHANNELS.find((c) => c.key === key) || null;
function cleanChannel(channel, detail = "") {
  if (!channelByKey(channel)) return {};
  const d = String(detail || "").trim().slice(0, 60);
  return d ? { channel, channelDetail: d } : { channel };
}
// A sale's channel; older sales (before channels existed) read one from
// their other tags: a post → social, an event → event, a referral → referral.
export function entryChannel(e) {
  if (channelByKey(e?.channel)) return e.channel;
  if (e?.source?.contentId) return "social";
  if (e?.eventId) return "event";
  if (e?.referral) return "referral";
  return null;
}

// ---------- Expenses: money going out ----------
// `channel`: the sales channel this spending is FOR, so a channel's revenue
// can sit next to what it cost (ads ↔ ad spend, a fair ↔ its booth fee).
export const EXPENSE_CATEGORIES = [
  { key: "stock", icon: "box", color: "#FF9F1C" },
  { key: "ads", icon: "megaphone", color: "#FF6B3D", detail: "ad", channel: "ads" },
  { key: "event", icon: "tent", color: "#FFB020", detail: "event", channel: "event" },
  { key: "shipping", icon: "truck", color: "#3B9BFF" },
  { key: "staff", icon: "users", color: "#14B8A6" },
  { key: "rent", icon: "store", color: "#A974FF" },
  { key: "ops", icon: "gear", color: "#6B7280" },
  { key: "other", icon: "dots", color: "#8A8479" },
];
export const expenseCategoryByKey = (key) => EXPENSE_CATEGORIES.find((c) => c.key === key) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
function expenseEntry({ category, amount, date, note = "", channelDetail = "", eventId = null, campaignId = null }, base = {}) {
  const cat = expenseCategoryByKey(category).key;
  const d = String(channelDetail || "").trim().slice(0, 60);
  return { ...base, kind: "expense", category: cat, amount: Math.max(0, Math.round(num(amount))), date: cleanDate(date), note: String(note || "").trim().slice(0, 140), ...(d ? { channelDetail: d } : {}), ...(eventId ? { eventId } : {}), ...(campaignId && !eventId ? { campaignId } : {}) };
}
export function logExpense(brandId, data) {
  const tr = getTracker(getBrand(brandId));
  if (!(num(data?.amount) > 0)) return null;
  const entry = expenseEntry(data, { id: uid("x"), at: Date.now() });
  const twin = tr.expenses.find((e) => Date.now() - e.at < DUPLICATE_MS && e.category === entry.category && e.amount === entry.amount && e.date === entry.date && (e.note || "") === entry.note);
  if (twin) return twin;
  save(brandId, { expenses: [...tr.expenses, entry] });
  return entry;
}
// Same "replace" rule as updateSale (new id, same `at`).
export function updateExpense(brandId, entryId, data) {
  const tr = getTracker(getBrand(brandId));
  const old = tr.expenses.find((e) => e.id === entryId);
  if (!old || !(num(data?.amount ?? old.amount) > 0)) return null;
  const next = { ...expenseEntry({ ...old, ...data }, { id: uid("x"), at: old.at }), editedAt: Date.now() };
  save(brandId, { expenses: tr.expenses.map((e) => (e.id === entryId ? next : e)) });
  return next;
}
export function deleteExpense(brandId, entryId) {
  const tr = getTracker(getBrand(brandId));
  save(brandId, { expenses: tr.expenses.filter((e) => e.id !== entryId) });
}
export function expenseSummary(tracker, { from = null, to = null } = {}) {
  const list = (tracker.expenses || []).filter((e) => inRange(e, from, to));
  const by = new Map();
  list.forEach((e) => {
    const row = by.get(e.category) || { key: e.category, count: 0, amount: 0 };
    row.count += 1; row.amount += e.amount;
    by.set(e.category, row);
  });
  return { total: list.reduce((a, e) => a + e.amount, 0), count: list.length, byCategory: [...by.values()].sort((a, b) => b.amount - a.amount) };
}
// Revenue per channel in a span, each next to the spending logged FOR that
// channel (ads, events) and the revenue per Rp 1 of it — only ever from what
// the owner logged; `perRp` is null without spending.
export function channelBreakdown(tracker, { from = null, to = null } = {}) {
  const list = tracker.entries.filter((e) => inRange(e, from, to));
  const spend = {};
  (tracker.expenses || []).filter((e) => inRange(e, from, to)).forEach((e) => {
    const ch = expenseCategoryByKey(e.category).channel;
    if (ch) spend[ch] = (spend[ch] || 0) + e.amount;
  });
  const rows = new Map();
  const untagged = { key: null, count: 0, qty: 0, revenue: 0 };
  list.forEach((e) => {
    const key = entryChannel(e);
    const row = key ? rows.get(key) || { key, count: 0, qty: 0, revenue: 0, details: {} } : untagged;
    row.count += 1; row.qty += e.qty; row.revenue += e.amount;
    // What a channel narrows down to: the ad platform / the fair's name, or
    // for social the post ("k:<contentId>", named by the page).
    const detail = e.channelDetail || (key === "social" && e.source?.contentId ? `k:${e.source.contentId}` : null);
    if (key && detail) row.details[detail] = (row.details[detail] || 0) + e.amount;
    if (key) rows.set(key, row);
  });
  Object.keys(spend).forEach((k) => { if (!rows.has(k)) rows.set(k, { key: k, count: 0, qty: 0, revenue: 0, details: {} }); });
  const out = [...rows.values()].map((r) => ({ ...r, spend: spend[r.key] || 0, perRp: spend[r.key] ? r.revenue / spend[r.key] : null }));
  return { rows: out.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend), untagged, total: list.length };
}

// A sale's origin: a piece of content brings its campaign along; an event
// is a campaign too. null when nothing was picked ("Gak tahu / campuran").
function normalizeSource(source, eventId = null) {
  const contentId = source?.contentId || null;
  const campaignId = source?.campaignId || (contentId ? getContent(contentId)?.campaignId || null : null) || eventId || null;
  return contentId || campaignId ? { campaignId, contentId } : null;
}

// ---------- Where sales come from ----------
const SOURCE_CONTENT_DAYS = 60;
// The choices for "Dari mana penjualan ini?": events, other running
// campaigns, and content published in the last 60 days (newest first).
export function saleSourceOptions(brandId, now = new Date()) {
  const campaigns = listCampaigns(brandId).filter((c) => !["archived", "completed"].includes(c.status));
  const since = localISODate(new Date(now.getTime() - SOURCE_CONTENT_DAYS * DAY));
  const content = listContent(brandId)
    .filter((c) => c.status === "published" && (c.publishedDate || "") >= since)
    .sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""));
  return {
    events: campaigns.filter((c) => c.eventPlan).sort((a, b) => (b.eventPlan?.eventDate || "").localeCompare(a.eventPlan?.eventDate || "")),
    campaigns: campaigns.filter((c) => !c.eventPlan),
    content,
  };
}
// A sale counts for a campaign when it was tagged with it (or its event).
const fromCampaign = (e, id) => e.source?.campaignId === id || e.eventId === id;
function sumEntries(list) {
  return { count: list.length, qty: list.reduce((a, e) => a + e.qty, 0), revenue: list.reduce((a, e) => a + e.amount, 0) };
}
// Money spent FOR a campaign / an event (expenses linked to it in the wizard).
const spentFor = (tracker, id, since = null) => tracker.expenses.filter((e) => (e.eventId === id || e.campaignId === id) && (!since || e.date >= since)).reduce((a, e) => a + e.amount, 0);
export function campaignSalesStats(brand, campaignId, { days = null, now = new Date() } = {}) {
  const since = days ? localISODate(new Date(now.getTime() - days * DAY)) : null;
  const tracker = getTracker(brand);
  return { ...sumEntries(tracker.entries.filter((e) => fromCampaign(e, campaignId) && (!since || e.date >= since))), spend: spentFor(tracker, campaignId, since) };
}
export function contentSalesStats(brand, contentId, { days = null, now = new Date() } = {}) {
  const since = days ? localISODate(new Date(now.getTime() - days * DAY)) : null;
  return sumEntries(getTracker(brand).entries.filter((e) => e.source?.contentId === contentId && (!since || e.date >= since)));
}
// Per-source totals over the last `days` — for the AI's sales snapshot.
// Plain data only: names are looked up by the caller.
export function salesBySource(brand, { days = SOURCE_CONTENT_DAYS, now = new Date() } = {}) {
  const since = localISODate(new Date(now.getTime() - days * DAY));
  const entries = getTracker(brand).entries.filter((e) => e.date >= since);
  const group = (keyOf) => {
    const map = new Map();
    entries.forEach((e) => {
      const k = keyOf(e);
      if (!k) return;
      const row = map.get(k) || { id: k, count: 0, qty: 0, revenue: 0 };
      row.count += 1; row.qty += e.qty; row.revenue += e.amount;
      map.set(k, row);
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
  };
  return {
    byCampaign: group((e) => e.source?.campaignId || e.eventId || null),
    byContent: group((e) => e.source?.contentId || null),
    unknown: sumEntries(entries.filter((e) => !e.source && !e.eventId)),
    total: sumEntries(entries),
  };
}

// Event campaigns this brand has (campaign.eventPlan, from the "Event" quick
// template in js/views/campaigns.js) — most recent event date first, for the
// "which event was this sale from" picker in the log form.
export function eventCampaignsForBrand(brandId) {
  return listCampaigns(brandId)
    .filter((c) => c.eventPlan && c.status !== "archived")
    .sort((a, b) => (b.eventPlan?.eventDate || "").localeCompare(a.eventPlan?.eventDate || ""));
}
// What's been logged against one event so far: per-product qty/revenue plus
// the total, read by campaign-detail.js's event-sales widget.
export function eventSalesStats(brand, eventId) {
  const tracker = getTracker(brand);
  const entries = tracker.entries.filter((e) => fromCampaign(e, eventId));
  const byProduct = {};
  entries.forEach((e) => {
    const row = byProduct[e.productId] || (byProduct[e.productId] = { qty: 0, revenue: 0 });
    row.qty += e.qty;
    row.revenue += e.amount;
  });
  const products = tracker.products
    .filter((p) => byProduct[p.id])
    .map((p) => ({ product: p, ...byProduct[p.id] }))
    .sort((a, b) => b.qty - a.qty);
  return { products, count: entries.length, qty: entries.reduce((a, e) => a + e.qty, 0), revenue: entries.reduce((a, e) => a + e.amount, 0), spend: spentFor(tracker, eventId) };
}
export function deleteSale(brandId, entryId) {
  const tr = getTracker(getBrand(brandId));
  save(brandId, { entries: tr.entries.filter((e) => e.id !== entryId) });
}
// Wipes the whole sales log (products and opening numbers stay). Used for a
// full reset — e.g. clearing test data before tracking for real.
export function clearAllSales(brandId) {
  save(brandId, { entries: [] });
  return true;
}
export function saveAdvice(brandId, advice) {
  const brand = getBrand(brandId);
  if (!brand) return;
  updateBrand(brandId, { salesTracker: stored(getTracker(brand), { lastAdvice: { ...advice, at: Date.now() } }) });
}

// ---------- Derived numbers (pure) ----------
const inRange = (e, from, to) => (!from || e.date >= from) && (!to || e.date <= to);
export function productStats(tracker, { from = null, to = null } = {}) {
  return tracker.products.map((p) => {
    const mine = tracker.entries.filter((e) => e.productId === p.id);
    const ranged = mine.filter((e) => inRange(e, from, to));
    return {
      product: p,
      sold: p.openingSold + mine.reduce((a, e) => a + e.qty, 0),
      loggedQty: mine.reduce((a, e) => a + e.qty, 0),
      loggedRevenue: mine.reduce((a, e) => a + e.amount, 0),
      rangeQty: ranged.reduce((a, e) => a + e.qty, 0),
      rangeRevenue: ranged.reduce((a, e) => a + e.amount, 0),
      lastSaleDate: mine.reduce((a, e) => (e.date > a ? e.date : a), ""),
      ...profitOf(mine, p),
      rangeProfit: profitOf(ranged, p).profit,
    };
  });
}
export function trackerTotals(tracker, range = {}) {
  const stats = productStats(tracker, range);
  const ranged = tracker.entries.filter((e) => inRange(e, range.from, range.to));
  return {
    sold: stats.reduce((a, s) => a + s.sold, 0),
    revenue: tracker.openingRevenue + tracker.entries.reduce((a, e) => a + e.amount, 0),
    loggedRevenue: tracker.entries.reduce((a, e) => a + e.amount, 0),
    rangeQty: ranged.reduce((a, e) => a + e.qty, 0),
    rangeRevenue: ranged.reduce((a, e) => a + e.amount, 0),
    rangeCount: ranged.length,
    repeatCount: tracker.entries.filter((e) => e.repeat).length,
    referralCount: tracker.entries.filter((e) => e.referral).length,
  };
}
// ---- Profit: only from sales whose cost is known ----
// A sale's unit cost = what was snapshotted when it was logged, else the
// product's current cost (older sales). Unknown cost never counts as zero —
// profit is the sum over sales WITH a cost, and `coverage` says what share
// of the revenue that was, so the page can say "estimate" honestly.
export const entryUnitCost = (e, product) => (knownCost(e.unitCost) ? num(e.unitCost) : knownCost(product?.cost) ? num(product.cost) : null);
export function profitOf(entries, product = null, productsById = null) {
  let revenue = 0, covered = 0, cost = 0, coveredCount = 0;
  entries.forEach((e) => {
    revenue += e.amount;
    const c = entryUnitCost(e, product || productsById?.[e.productId]);
    if (c === null) return;
    covered += e.amount;
    cost += c * e.qty;
    coveredCount += 1;
  });
  return { profit: coveredCount ? covered - cost : null, coverage: revenue > 0 ? covered / revenue : coveredCount === entries.length && entries.length ? 1 : 0 };
}

// ---- Periods the page can look at, each with the span just before it ----
// The comparison span is the SAME LENGTH as what has elapsed so far (10 days
// into this month vs the first 10 days of last month), never a full month vs
// a half one.
export const SALES_PERIODS = ["week", "month", "d30", "all"];
const dayAt = (y, m, d) => localISODate(new Date(y, m, d));
export function periodRange(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const today = dayAt(y, m, d);
  if (key === "week") {
    const back = (now.getDay() + 6) % 7;
    return { key, from: dayAt(y, m, d - back), to: today, prevFrom: dayAt(y, m, d - back - 7), prevTo: dayAt(y, m, d - 7) };
  }
  if (key === "d30") return { key, from: dayAt(y, m, d - 29), to: today, prevFrom: dayAt(y, m, d - 59), prevTo: dayAt(y, m, d - 30) };
  if (key === "all") return { key, from: null, to: null, prevFrom: null, prevTo: null };
  const prevDays = new Date(y, m, 0).getDate();
  return { key: "month", from: dayAt(y, m, 1), to: today, prevFrom: dayAt(y, m - 1, 1), prevTo: dayAt(y, m - 1, Math.min(d, prevDays)) };
}
export function periodSummary(tracker, { from = null, to = null } = {}) {
  const list = tracker.entries.filter((e) => inRange(e, from, to));
  const byId = Object.fromEntries(tracker.products.map((p) => [p.id, p]));
  const qty = list.reduce((a, e) => a + e.qty, 0);
  const revenue = list.reduce((a, e) => a + e.amount, 0);
  return {
    count: list.length, qty, revenue, avgOrder: list.length ? Math.round(revenue / list.length) : 0,
    activeDays: new Set(list.map((e) => e.date)).size,
    repeat: list.filter((e) => e.repeat).length, referral: list.filter((e) => e.referral).length,
    ...profitOf(list, null, byId),
    ...cashOut(tracker, revenue, from, to),
  };
}
// Money out in the span and what's left of the money in (cash, not profit).
function cashOut(tracker, revenue, from, to) {
  const spend = (tracker.expenses || []).filter((e) => inRange(e, from, to)).reduce((a, e) => a + e.amount, 0);
  return { spend, net: revenue - spend };
}
// { dir: "up"|"down"|"flat"|"new", pct } — "new" when the previous span had nothing.
export function deltaOf(cur, prev) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return null;
  if (!prev) return cur ? { dir: "new", pct: null } : { dir: "flat", pct: 0 };
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct };
}
// Last `days` days, oldest first: [{ date, qty, revenue, count }]
export function dailySeries(tracker, days = 30, now = new Date()) {
  const by = new Map();
  tracker.entries.forEach((e) => {
    const row = by.get(e.date) || { qty: 0, revenue: 0, count: 0 };
    row.qty += e.qty; row.revenue += e.amount; row.count += 1;
    by.set(e.date, row);
  });
  return Array.from({ length: days }, (_, i) => {
    const date = dayAt(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - i));
    return { date, ...(by.get(date) || { qty: 0, revenue: 0, count: 0 }) };
  });
}
// Where the sales of a span came from. One row per post, else per campaign
// (a post's sale already carries its campaign, so nothing counts twice);
// `untagged` = sales nobody marked.
export function sourceBreakdown(tracker, { from = null, to = null } = {}) {
  const list = tracker.entries.filter((e) => inRange(e, from, to));
  const rows = new Map();
  const untagged = { count: 0, qty: 0, revenue: 0 };
  list.forEach((e) => {
    const contentId = e.source?.contentId || null;
    const campaignId = e.source?.campaignId || e.eventId || null;
    const key = contentId ? `k:${contentId}` : campaignId ? `c:${campaignId}` : null;
    const row = key ? rows.get(key) || { key, kind: contentId ? "content" : "campaign", id: contentId || campaignId, count: 0, qty: 0, revenue: 0 } : untagged;
    row.count += 1; row.qty += e.qty; row.revenue += e.amount;
    if (key) rows.set(key, row);
  });
  return { rows: [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.qty - a.qty), untagged, total: list.length };
}
// Whole days since an ISO date (UTC-parsed both sides, so no DST drift).
export const daysSince = (date, today = localISODate()) => (date ? Math.round((new Date(today) - new Date(date)) / DAY) : null);
// Entries the page can't place in any period: dated after today.
export const futureEntries = (tracker, today = localISODate()) => tracker.entries.filter((e) => e.date > today);

export const monthRange = (d = new Date()) => ({ from: localISODate(new Date(d.getFullYear(), d.getMonth(), 1)), to: localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) });
// Last `weeks` Monday-to-Sunday weeks, oldest first: [{ from, to, qty, revenue }]
export function weeklySeries(tracker, weeks = 8, now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(monday.getTime() - (weeks - 1 - i) * 7 * DAY);
    const from = localISODate(start);
    const to = localISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    const list = tracker.entries.filter((e) => inRange(e, from, to));
    return { from, to, qty: list.reduce((a, e) => a + e.qty, 0), revenue: list.reduce((a, e) => a + e.amount, 0) };
  });
}

// ---------- Mirror into the running Sales Growth campaign ----------
export function runningSalesCampaign(brandId) {
  return listCampaigns(brandId).find((c) => c.goalPlan?.version === 3 && c.goalPlan.track === "sales" && !["archived", "completed"].includes(c.status)) || null;
}
// Pushes the tracker's numbers into the campaign's manualMetrics under the
// keys buildSalesGrowthPlan's milestones read (`sold:<productId>`,
// `revenue`, `repeatBuyers`, `referrals`). Only writes what changed, and
// only for products the campaign actually tracks. Repeat/referral counts are
// only written once at least one sale carries the flag — until then the
// campaign's own manual number (if any) is left alone.
export function syncSalesCampaign(brandId) {
  const campaign = runningSalesCampaign(brandId);
  const brand = getBrand(brandId);
  if (!campaign || !brand) return false;
  // Only from the full log (loaded per brand, js/store.js): totals from a
  // partial one would overwrite the campaign's numbers with smaller ones.
  if (!isBrandSalesReady(brandId)) return false;
  const tracker = getTracker(brand);
  const stats = productStats(tracker);
  const totals = trackerTotals(tracker);
  const next = { ...(campaign.manualMetrics || {}) };
  let changed = false;
  const put = (key, value) => {
    if (num(next[key]?.value) === value && next[key]) return;
    next[key] = { ...(next[key] || {}), value, updatedAt: Date.now(), source: "tracker" };
    changed = true;
  };
  (campaign.goalPlan.products || []).forEach((cp) => {
    const s = stats.find((x) => x.product.id === cp.id);
    if (s) put(`sold:${cp.id}`, s.sold);
  });
  if (campaign.goalPlan.target?.revenue) put("revenue", totals.revenue);
  if (totals.repeatCount) put("repeatBuyers", totals.repeatCount);
  if (totals.referralCount) put("referrals", totals.referralCount);
  if (changed) updateCampaign(campaign.id, { manualMetrics: next });
  return changed;
}

// ---------- Text snapshot for the AI (real numbers only) ----------
export function salesSnapshotText(brand, { unit = "" } = {}) {
  const tracker = getTracker(brand);
  const month = monthRange();
  const stats = productStats(tracker, month).filter((s) => !s.product.archived);
  const totals = trackerTotals(tracker, month);
  const campaign = runningSalesCampaign(brand.id);
  const today = localISODate();
  const lines = [
    `Today: ${today}. Counting unit: ${unit || "sales"}. Every number below was typed in by the business owner; there is no traffic or conversion data, and money spent (ads, fairs…) only appears where the owner logged it.`,
    `All-time sold: ${totals.sold}. All-time revenue: Rp ${totals.revenue}. This month so far: ${totals.rangeQty} sold in ${totals.rangeCount} logged sales, Rp ${totals.rangeRevenue}.`,
    `Sales flagged as repeat buyers: ${totals.repeatCount}. Flagged as referrals: ${totals.referralCount}. (Flags are optional, so these are minimums.)`,
    "Products:",
    ...stats.map((s) => {
      const target = campaign?.goalPlan?.products?.find((p) => p.id === s.product.id)?.target;
      const idle = s.lastSaleDate ? Math.round((new Date(today) - new Date(s.lastSaleDate)) / DAY) : null;
      return `- ${s.product.name}: price Rp ${s.product.price}${s.product.cost ? `, cost Rp ${s.product.cost}` : ""}; sold ${s.sold} all-time${target ? ` of target ${target}` : ""}; ${s.rangeQty} this month; ${idle === null ? "no dated sale logged yet" : `last sale ${idle} day(s) ago`}.`;
    }),
    // The last week is still running: say so, or a Wednesday reads as a crash.
    `Sold per Monday-Sunday week, oldest to newest (last 8 weeks): ${weeklySeries(tracker).map((w) => w.qty).join(", ")} — the LAST number is this week so far (day ${((new Date().getDay() + 6) % 7) + 1} of 7), not a full week; never compare it with full weeks as if it were a drop.`,
  ];
  // How buyers came (channels the owner picked when logging) and what was
  // spent, last 60 days — the per-Rp figure is computed here so the model
  // never has to (or gets to) do its own arithmetic.
  const since60 = localISODate(new Date(Date.now() - SOURCE_CONTENT_DAYS * DAY));
  const ch = channelBreakdown(tracker, { from: since60, to: today });
  if (ch.total || ch.rows.length) {
    lines.push(`Sales channels, last ${SOURCE_CONTENT_DAYS} days (picked by the owner when logging; ${ch.untagged.count} of ${ch.total} sales have no channel):`);
    ch.rows.forEach((r) => {
      const details = Object.entries(r.details || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}: Rp ${v}`).join(", ");
      lines.push(`- ${r.key}: ${r.count} sales, ${r.qty} sold, Rp ${r.revenue}${details ? ` (${details})` : ""}${r.spend ? `; logged spending for this channel Rp ${r.spend} → Rp ${(Math.round(r.perRp * 10) / 10).toFixed(1)} revenue per Rp 1 spent` : ""}.`);
    });
  }
  const out = expenseSummary(tracker, month);
  if (out.count) {
    lines.push(`Money out this month (logged expenses): Rp ${out.total} — ${out.byCategory.map((c) => `${c.key} Rp ${c.amount}`).join(", ")}. Money in minus money out this month: Rp ${totals.rangeRevenue - out.total}.`);
  } else {
    lines.push("No expenses logged this month (the owner may simply not log them) — do not assume costs.");
  }
  if (campaign) lines.push(`Sales Growth campaign target: ${campaign.goalPlan.target.sold} total within ${campaign.goalPlan.months} months (started ${localISODate(new Date(campaign.createdAt || Date.now()))}).`);
  // Where sales came from (only what the owner tagged when logging).
  const src = salesBySource(brand);
  if (src.total.count) {
    const campaignName = (id) => listCampaigns(brand.id).find((c) => c.id === id)?.name || "(deleted campaign)";
    const contentTitle = (id) => getContent(id)?.title || "(deleted content)";
    lines.push(`Where sales came from, last ${SOURCE_CONTENT_DAYS} days (tagged by the owner; ${src.unknown.count} of ${src.total.count} sales untagged):`);
    src.byContent.slice(0, 5).forEach((r) => lines.push(`- content "${contentTitle(r.id)}": ${r.qty} sold, Rp ${r.revenue}`));
    src.byCampaign.slice(0, 5).forEach((r) => lines.push(`- campaign "${campaignName(r.id)}": ${r.qty} sold, Rp ${r.revenue}`));
  }
  return lines.join("\n");
}
