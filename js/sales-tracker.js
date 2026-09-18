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
// STORAGE: on the brand document (`brand.salesTracker`), not a collection of
// its own — no Firestore rules change, and a small brand's log (a few
// thousand short rows at most) sits comfortably inside one document.
//   { model, products: [{ id, name, price, cost, openingSold, discountPct,
//     discountUntil, archived }], openingRevenue, entries: [{ id, productId,
//     qty, amount, date, repeat, referral, note, eventId, at }], lastAdvice }
// `openingSold` / `openingRevenue`: what was already sold before tracking
// started (the wizard's "sold so far") — counted in totals, never shown as
// a dated sale.
//
// Still 100% manual entry: there is no sales backend and nothing here reads
// or asks for ads data.
import { getBrand, updateBrand, listCampaigns, updateCampaign, localISODate } from "./store.js";

const DAY = 86400000;
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function getTracker(brand) {
  const s = brand?.salesTracker || {};
  return {
    model: s.model || "product",
    products: Array.isArray(s.products) ? s.products : [],
    entries: Array.isArray(s.entries) ? s.entries : [],
    openingRevenue: num(s.openingRevenue),
    lastAdvice: s.lastAdvice || null,
  };
}
function save(brandId, patch) {
  const brand = getBrand(brandId);
  if (!brand) return null;
  const next = { ...getTracker(brand), ...patch, updatedAt: Date.now() };
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
export function logSale(brandId, { productId, qty = 1, amount = null, date = localISODate(), repeat = false, referral = false, note = "", eventId = null }) {
  const tr = getTracker(getBrand(brandId));
  const product = tr.products.find((p) => p.id === productId);
  if (!product) return null;
  const q = Math.max(1, Math.round(num(qty)) || 1);
  const entry = { id: uid("s"), productId, qty: q, amount: amount === null || amount === "" ? effectivePrice(product, date) * q : Math.max(0, num(amount)), date, repeat: !!repeat, referral: !!referral, note: String(note || "").trim().slice(0, 140), eventId: eventId || null, at: Date.now() };
  save(brandId, { entries: [...tr.entries, entry] });
  return entry;
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
  const entries = tracker.entries.filter((e) => e.eventId === eventId);
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
  return { products, count: entries.length, qty: entries.reduce((a, e) => a + e.qty, 0), revenue: entries.reduce((a, e) => a + e.amount, 0) };
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
  updateBrand(brandId, { salesTracker: { ...getTracker(brand), lastAdvice: { ...advice, at: Date.now() } } });
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
    `Today: ${today}. Counting unit: ${unit || "sales"}. Every number below was typed in by the business owner; there is no ads, traffic or conversion data.`,
    `All-time sold: ${totals.sold}. All-time revenue: Rp ${totals.revenue}. This month so far: ${totals.rangeQty} sold in ${totals.rangeCount} logged sales, Rp ${totals.rangeRevenue}.`,
    `Sales flagged as repeat buyers: ${totals.repeatCount}. Flagged as referrals: ${totals.referralCount}. (Flags are optional, so these are minimums.)`,
    "Products:",
    ...stats.map((s) => {
      const target = campaign?.goalPlan?.products?.find((p) => p.id === s.product.id)?.target;
      const idle = s.lastSaleDate ? Math.round((new Date(today) - new Date(s.lastSaleDate)) / DAY) : null;
      return `- ${s.product.name}: price Rp ${s.product.price}${s.product.cost ? `, cost Rp ${s.product.cost}` : ""}; sold ${s.sold} all-time${target ? ` of target ${target}` : ""}; ${s.rangeQty} this month; ${idle === null ? "no dated sale logged yet" : `last sale ${idle} day(s) ago`}.`;
    }),
    "Sold per week, oldest to newest (last 8 weeks): " + weeklySeries(tracker).map((w) => w.qty).join(", "),
  ];
  if (campaign) lines.push(`Sales Growth campaign target: ${campaign.goalPlan.target.sold} total within ${campaign.goalPlan.months} months (started ${localISODate(new Date(campaign.createdAt || Date.now()))}).`);
  return lines.join("\n");
}
