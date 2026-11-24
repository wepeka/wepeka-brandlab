// Which content made money (owner, 2026-11-24: "BrandLab tidak hanya
// mengetahui konten mana yang viral, tetapi juga konten mana yang
// menghasilkan uang"). Pure sums over what is already logged in Sales
// (js/sales-tracker.js) and the content list — nothing is guessed:
//
// - A sale counts once. It names at most one channel and at most one piece
//   (`source.contentId`); a piece posted on several platforms (twins sharing
//   `mirrorGroupId`) is ONE row, so a sale is never counted per platform.
// - How sure the owner is of where a sale came from is kept apart, never
//   blended: "auto" (an integration said so — none writes it yet),
//   "manual" (the owner picked the channel), "estimate" (the owner ticked
//   "cuma perkiraan"), "unknown" ("Belum tahu").
// - Money an ad platform REPORTS (Meta conversions, later) is not a sale and
//   never lands here; only sales the business logged do.
// - Profit uses the cost each unit had when it was sold (`unitCost`). A row
//   whose sales lack a cost gets no ROI (the share that has one is given),
//   only "omzet per Rp 1 biaya", which needs no cost.
import { entryChannel } from "./sales-tracker.js";

export const ATTRIBUTIONS = ["auto", "manual", "estimate", "unknown"];

// How sure we are of a sale's source.
export function attributionOf(e) {
  if (!e || e.kind === "expense") return null;
  if (!entryChannel(e)) return "unknown";
  return e.attribution === "estimate" || e.attribution === "auto" ? e.attribution : "manual";
}

const inRange = (e, from, to) => (!from || (e.date || "") >= from) && (!to || (e.date || "") <= to);
const money = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const hasCost = (e) => e.unitCost !== null && e.unitCost !== undefined && Number.isFinite(Number(e.unitCost));

// Revenue by certainty in a span: the line under "Pembeli datang dari mana".
export function attributionSplit(tracker, { from = null, to = null } = {}) {
  const out = { auto: 0, manual: 0, estimate: 0, unknown: 0, total: 0, count: 0 };
  (tracker?.entries || []).filter((e) => e.kind !== "expense" && inRange(e, from, to)).forEach((e) => {
    out[attributionOf(e)] += money(e.amount);
    out.total += money(e.amount);
    out.count += 1;
  });
  return out;
}

// One piece of content however many platforms it went to.
export const contentGroupKey = (c) => (c ? c.mirrorGroupId || c.id : null);

// What making one piece cost (owner-typed Rp, kept on every twin — the same
// number, so it is read once per group, never added up per platform).
export function productionCostOf(twins) {
  for (const c of twins || []) {
    const n = Number(c?.productionCost);
    if (c?.productionCost !== null && c?.productionCost !== undefined && c?.productionCost !== "" && Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

// Per piece of content: the sales tied to it (organic vs from its ads), the
// ad spend tied to it, its production cost, and what that adds up to.
// `contents`: the brand's content list. Lifetime unless from/to are given
// (production cost is paid once, so per-piece numbers read best since it went up).
export function contentMoney({ tracker, contents = [], from = null, to = null } = {}) {
  const byId = new Map(contents.map((c) => [c.id, c]));
  const groups = new Map();
  const groupOf = (contentId) => {
    const c = byId.get(contentId);
    const key = c ? contentGroupKey(c) : `gone:${contentId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, contentId: c?.id || contentId, missing: !c,
        organic: 0, paid: 0, revenue: 0, count: 0, qty: 0,
        byAttribution: { auto: 0, manual: 0, estimate: 0, unknown: 0 },
        profit: 0, costedRevenue: 0, adSpend: 0,
        // What Meta says its ads brought (api/instagram/[action].js writes it
        // on the automatic Iklan expense): shown beside, never in, revenue.
        reported: { purchases: 0, value: 0, impressions: 0, clicks: 0 },
      });
    }
    return groups.get(key);
  };
  for (const e of tracker?.entries || []) {
    if (e.kind === "expense" || !e.source?.contentId || !inRange(e, from, to)) continue;
    const g = groupOf(e.source.contentId);
    const amt = money(e.amount);
    g.revenue += amt;
    g.count += 1;
    g.qty += money(e.qty);
    if (entryChannel(e) === "ads") g.paid += amt; else g.organic += amt;
    g.byAttribution[attributionOf(e)] += amt;
    if (hasCost(e)) {
      g.profit += amt - Number(e.unitCost) * money(e.qty);
      g.costedRevenue += amt;
    }
  }
  for (const x of tracker?.expenses || []) {
    if (!x.contentId || !inRange(x, from, to)) continue;
    const g = groupOf(x.contentId);
    g.adSpend += money(x.amount);
    if (x.meta) {
      g.reported.purchases += money(x.meta.reportedPurchases);
      g.reported.value += money(x.meta.reportedValue);
      g.reported.impressions += money(x.meta.impressions);
      g.reported.clicks += money(x.meta.clicks);
    }
  }
  // Pieces with only a production cost still show (money out, none back yet).
  for (const c of contents) {
    if (productionCostOf([c]) !== null && !groups.has(contentGroupKey(c))) groupOf(c.id);
  }
  const twinsOf = (key) => contents.filter((c) => contentGroupKey(c) === key);
  return [...groups.values()].map((g) => {
    const twins = twinsOf(g.key);
    const lead = twins.find((c) => c.status === "published") || twins[0] || null;
    const productionCost = productionCostOf(twins);
    const cost = (productionCost || 0) + g.adSpend;
    const fullyCosted = g.revenue > 0 && g.costedRevenue === g.revenue;
    return {
      ...g,
      contentId: lead?.id || g.contentId,
      title: lead?.title || "",
      platforms: [...new Set(twins.map((c) => c.platform).filter(Boolean))],
      publishedDate: twins.map((c) => c.publishedDate).filter(Boolean).sort()[0] || null,
      productionCost,
      cost,
      // Revenue a Rp 1 of this piece's costs brought back (no product cost needed).
      perRp: cost > 0 ? g.revenue / cost : null,
      // Paid ROAS: sales logged as coming from this piece's ad ÷ its ad spend.
      roas: g.adSpend > 0 ? g.paid / g.adSpend : null,
      // ROI on profit, only when every sale in it has a product cost.
      net: fullyCosted ? g.profit - cost : null,
      roi: fullyCosted && cost > 0 ? (g.profit - cost) / cost : null,
      costCoverage: g.revenue ? g.costedRevenue / g.revenue : null,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.cost - a.cost);
}

// The whole marketing picture for a span: what marketing cost (ads, events,
// content production) next to the revenue that came through a marketing
// channel, kept apart from sales whose source is unknown.
const MARKETING_CHANNELS = new Set(["ads", "social", "event", "referral"]);
export function marketingTotals({ tracker, contents = [], from = null, to = null } = {}) {
  const entries = (tracker?.entries || []).filter((e) => e.kind !== "expense" && inRange(e, from, to));
  const expenses = (tracker?.expenses || []).filter((e) => inRange(e, from, to));
  const adSpend = expenses.filter((x) => x.category === "ads").reduce((a, x) => a + money(x.amount), 0);
  const eventSpend = expenses.filter((x) => x.category === "event").reduce((a, x) => a + money(x.amount), 0);
  // Production cost of the pieces published inside the span (once per group).
  const seen = new Set();
  let production = 0;
  for (const c of contents) {
    const key = contentGroupKey(c);
    if (seen.has(key) || c.status !== "published" || !c.publishedDate || !inRange({ date: c.publishedDate }, from, to)) continue;
    seen.add(key);
    production += productionCostOf(contents.filter((x) => contentGroupKey(x) === key)) || 0;
  }
  const adRevenue = entries.filter((e) => entryChannel(e) === "ads").reduce((a, e) => a + money(e.amount), 0);
  const organicContentRevenue = entries.filter((e) => entryChannel(e) !== "ads" && e.source?.contentId).reduce((a, e) => a + money(e.amount), 0);
  const marketingRevenue = entries.filter((e) => MARKETING_CHANNELS.has(entryChannel(e))).reduce((a, e) => a + money(e.amount), 0);
  const spend = adSpend + eventSpend + production;
  const split = attributionSplit(tracker, { from, to });
  return {
    adSpend, eventSpend, production, spend,
    adRevenue, organicContentRevenue, marketingRevenue,
    roas: adSpend > 0 ? adRevenue / adSpend : null,
    organicPerRp: production > 0 ? organicContentRevenue / production : null,
    marketingPerRp: spend > 0 ? marketingRevenue / spend : null,
    split,
  };
}

// Revenue tied to one piece (any twin) — for Creator's published card.
export function revenueOfContent({ tracker, contents = [], content }) {
  const key = contentGroupKey(content);
  if (!key) return null;
  return contentMoney({ tracker, contents }).find((g) => g.key === key) || null;
}
