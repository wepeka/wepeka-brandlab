// The Sales app (Pelacak Penjualan): the brand's products, money in and money
// out (data + rules live in js/sales-tracker.js). The page opens on its two
// actions — two big picture cards, "Catat Pemasukan" (green, a coin dropping
// into a wallet) and "Catat Pengeluaran" (coral, a coin flying out) — each a
// short wizard (js/views/sales-wizard.js) that also asks where the buyer came
// from (ads, a fair, social, WhatsApp…). A slip is one tap to undo or edit.
// Everything else is read-only and derived, for the period picked (this week
// / month / 30 days / all time), each figure next to the previous span of the
// same length: money in, money out, what's left, sold; the trend; which
// products carry the revenue; which channels bring buyers — next to what was
// spent on them; where the money went; AI strategy; the Excel export.
// Gross profit is only ever computed from sales whose cost is known, and says
// how much of the revenue that covers — a missing cost is never read as zero.
// Logging and export are free for every account; the AI advice follows the
// same Lifetime gate as Copy Studio. Still 100% manual entry.
import { getBrand, listCampaigns, listContent, getContent, getSettings, unitLabel, localISODate, updateBrand, ensureBrandSales } from "../store.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";
import {
  getTracker, addProduct, updateProduct, deleteSale, deleteExpense, clearAllSales, saveAdvice, productStats, trackerTotals, weeklySeries,
  runningSalesCampaign, salesSnapshotText, activeDiscountPct, effectivePrice,
  SALES_PERIODS, periodRange, periodSummary, deltaOf, dailySeries, daysSince, futureEntries, entryUnitCost,
  channelBreakdown, expenseSummary, channelByKey, expenseCategoryByKey, entryChannel,
} from "../sales-tracker.js";
import { openIncomeWizard, openExpenseWizard, channelLabel, adPlatformLabel, categoryLabel, INCOME_COLORS, EXPENSE_COLORS } from "./sales-wizard.js";
import { salesArtSVG } from "../sales-art.js";
import { appByKey } from "../apps.js";
import { wirePointerLight } from "../my-brand-head.js";
import { salesModel } from "../goal-plan.js";
import { suggestSalesActions, hasAiKey, AiApiError } from "../ai.js";
import { pulseTextFor } from "../brand-pulse.js";
import { staleBecause, mayAutoRefresh, refreshStamp } from "../ai-autorefresh.js";
import { buildXlsx, downloadBlob } from "../xlsx-lite.js";
import { getCachedAccount, isLifetime } from "../account.js";
import { backLinkHTML } from "../back-link.js";
import { consumeNavContext } from "../nav-context.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { toast, formatNumber, formatPercent, formatDate, qs, qsa, escapeHtml as esc, loadingHTML } from "../dom.js";
import { readFlag, writeFlag, clearFlag } from "../seen-flags.js";
import { t, getLang, campaignDisplayName } from "../i18n.js";
import { aiReportButtonHTML } from "../ai-report.js";

// Products & the log can both grow long — collapsed once, they stay
// collapsed (remembered locally per brand) instead of resetting every visit.
const COLLAPSE_PREFIX = "salestracker:collapsed:";
const isSectionCollapsed = (brandId, key) => readFlag(COLLAPSE_PREFIX, `${brandId}:${key}`);
const setSectionCollapsed = (brandId, key, on) => (on ? writeFlag(COLLAPSE_PREFIX, `${brandId}:${key}`) : clearFlag(COLLAPSE_PREFIX, `${brandId}:${key}`));

const rp = (n) => `${n < 0 ? "−" : ""}Rp ${formatNumber(Math.abs(Math.round(n || 0)))}`;
const onlyDigits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const toNum = (v) => (onlyDigits(v) === "" ? null : Number(onlyDigits(v)));
const HISTORY_PAGE = 15;
const IDLE_DAYS = 14;
const dayLabel = (iso, withWeekday = true) => formatDate(iso, { year: undefined, ...(withWeekday ? { weekday: "short" } : {}) });
const hasCost = (p) => p?.cost !== null && p?.cost !== undefined && p?.cost !== "";
const perRpText = (n) => (Math.round(n * 10) / 10).toLocaleString(getLang() === "en" ? "en-US" : "id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function render(root, { brandId }) {
  if (!getBrand(brandId)) {
    location.hash = "#/";
    return () => {};
  }
  const state = {
    brandId, showAll: false, adviceBusy: false, adviceError: "", autoTried: false, dead: false,
    period: "month", trendSpan: "day", trendMetric: "revenue", historyKind: "all", historyGroup: "day", historyProduct: "", lastLogged: null,
  };
  const refresh = () => !state.dead && paint(root, brandId, state, refresh);
  refresh();
  // Arrived from a campaign's "Catat penjualan": the income wizard opens with
  // that campaign (or event) already picked, so the sale counts there.
  const nav = consumeNavContext();
  if (nav?.intent === "log-sale" && getTracker(getBrand(brandId)).products.some((p) => !p.archived)) {
    openIncome(brandId, state, refresh, { presetCampaignId: nav.campaignId || null });
  }
  autoRefreshAdvice(brandId, state, refresh);
  return () => {
    state.dead = true;
  };
}

function unitOf(brandId) {
  const campaign = runningSalesCampaign(brandId);
  return unitLabel(salesModel(campaign?.goalPlan?.model || getTracker(getBrand(brandId)).model).unit);
}
// After a save in a wizard: the page behind it repaints, and the "Tercatat"
// line on the page offers Undo / Edit for that record.
function afterSave(state, refresh) {
  return ({ kind, entry, edited }) => {
    state.lastLogged = edited ? null : { kind, id: entry.id };
    refresh();
  };
}
function openIncome(brandId, state, refresh, opts = {}) {
  openIncomeWizard({
    brandId, unit: unitOf(brandId), onSaved: afterSave(state, refresh),
    // "+ Produk baru" inside the wizard: the product form opens on top, and
    // the new product comes back already picked.
    onAddProduct: (done) => openProductModal({ brandId, unit: unitOf(brandId), onSaved: (p) => { refresh(); done(p); } }),
    ...opts,
  });
}
function openExpense(brandId, state, refresh, opts = {}) {
  openExpenseWizard({ brandId, onSaved: afterSave(state, refresh), ...opts });
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  const tracker = getTracker(brand);
  // The log (month docs, js/store.js) still loading: totals from part of it
  // would read as final — and the wizards must not write over it.
  // (Waited once: a log that can't load at all shows what there is.)
  if (tracker.loading && !state.salesWaited) {
    state.salesWaited = true;
    root.innerHTML = loadingHTML(t("app.loading"));
    ensureBrandSales(brandId).then(refresh, refresh);
    return;
  }
  const campaign = runningSalesCampaign(brandId);
  const unit = unitOf(brandId);
  const active = tracker.products.filter((p) => !p.archived);
  const range = periodRange(state.period);
  const stats = productStats(tracker, range);
  const productsCollapsed = isSectionCollapsed(brandId, "products");
  const historyCollapsed = isSectionCollapsed(brandId, "history");
  const hasLog = tracker.entries.length + tracker.expenses.length > 0;
  const collapsed = new Set(brand.salesWidgetsCollapsed || []);
  const future = futureEntries(tracker);
  const app = appByKey("sales");

  root.innerHTML = `
    <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}`, t("nav.home"))}${helpButtonHTML("sales")}${guideVideoButtonHTML("sales")}</div>
    <div class="st-head">
      <div class="st-head-title">
        <span class="mb-tile lh-pic" style="--app:${app.color};--app2:${app.color2};">${salesArtSVG("app")}</span>
        <div><h1>${t("nav.sales")}</h1><p class="page-head-brand">${esc(brand.name)}</p></div>
      </div>
      ${active.length ? `<div class="st-head-actions">
        <button class="btn btn-secondary" id="st-add-product-top">${icon("plus", { size: 15 })}${t("sales.products.addTop")}</button>
        <button class="btn btn-ghost" id="st-xlsx">${icon("download", { size: 15 })}${t("sales.export.excel")}</button>
      </div>` : ""}
    </div>
    ${active.length ? `
      ${actionsHTML(tracker, state, unit)}
      ${future.length ? `<div class="st-notice">${icon("info", { size: 15 })}<span>${t("sales.notice.future", { count: future.length })}</span></div>` : ""}
      ${periodTabsHTML(state)}
      ${statsHTML(tracker, range, state, unit, collapsed)}
      ${channelsHTML(tracker, range, state, collapsed)}
      ${trendHTML(tracker, unit, state, collapsed)}
      ${adviceHTML(tracker, state, collapsed)}
      ${expensesHTML(tracker, range, state, collapsed)}
      ${campaignLinkHTML(brandId, campaign)}
    ` : emptyHTML()}
    <div class="section-title">
      <h2>${t("sales.products.title")}</h2>
      <div class="flex items-center gap-8">
        <button class="btn btn-secondary btn-sm" id="st-add-product">${icon("plus", { size: 14 })}${t("sales.products.add")}</button>
        ${stats.length ? collapseToggleHTML("st-products-toggle", productsCollapsed) : ""}
      </div>
    </div>
    ${active.length && !productsCollapsed ? `<p class="st-section-sub">${t("sales.products.sub", { period: t(`sales.period.${state.period}`) })}</p>` : ""}
    ${productsHTML(stats, campaign, unit, productsCollapsed)}
    ${active.length ? `
      <div class="section-title">
        <h2>${t("sales.history.title2")}</h2>
        <div class="flex items-center gap-8">
          ${tracker.entries.length ? `<button class="btn btn-ghost btn-sm" id="st-history-clear">${icon("trash", { size: 13 })}${t("sales.history.clearAll")}</button>` : ""}
          ${collapseToggleHTML("st-history-toggle-collapse", historyCollapsed)}
        </div>
      </div>
      ${hasLog || !historyCollapsed ? historyHTML(tracker, state, historyCollapsed, brandId) : ""}
    ` : ""}
  `;

  wireHelpButtons(root);
  wirePointerLight(root);
  wireWidgetToggle(root, { collapsedList: brand.salesWidgetsCollapsed, save: (next) => updateBrand(brandId, { salesWidgetsCollapsed: next }), refresh });
  wire(root, brandId, state, refresh, { brand, tracker, unit });
}

// Saved advice the owner asked for once is rewritten on its own — free —
// when an important signal (sales up/down, a post that took off or sold…)
// arrived after it (js/ai-autorefresh.js has the rules and the guards).
async function autoRefreshAdvice(brandId, state, refresh) {
  if (state.autoTried) return;
  state.autoTried = true;
  const brand = getBrand(brandId);
  const advice = getTracker(brand).lastAdvice;
  const ai = getSettings().ai || {};
  if (!isLifetime(getCachedAccount()) || !mayAutoRefresh(advice, ai)) return;
  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);
  const signal = staleBecause(advice, { brand, content, campaigns, settings: getSettings() });
  if (!signal) return;
  state.adviceBusy = true;
  state.autoReason = signal.title;
  refresh();
  try {
    const pulseText = pulseTextFor(brand, { content, campaigns, settings: getSettings() });
    const next = await suggestSalesActions(ai, { brand, snapshotText: salesSnapshotText(brand, { unit: unitOf(brandId) }), campaigns, pulseText, free: true });
    saveAdvice(brandId, { ...next, ...refreshStamp(advice, signal) });
  } catch {
    // Quietly keep the old advice; the owner can still refresh it by hand.
  }
  state.adviceBusy = false;
  state.autoReason = "";
  refresh();
}

function emptyHTML() {
  return `
    <div class="content-view-card glass-card" style="max-width:520px;cursor:default;margin-bottom:8px;">
      <div class="icon-wrap">${icon("wallet", { size: 22 })}</div>
      <h3>${t("sales.empty.title")}</h3>
      <p>${t("sales.empty.body")}</p>
      <button class="btn btn-primary" data-st-first-product style="margin-top:12px;">${icon("plus", { size: 15 })}${t("sales.products.addFirst")}</button>
    </div>`;
}

// The page's two actions, as big picture cards in the launcher's style:
// money in (green) and money out (coral). Under them, the last save with
// Undo / Edit — the fix for a slip.
function actionsHTML(tracker, state, unit) {
  const today = localISODate();
  const todayIn = tracker.entries.filter((e) => e.date === today);
  const todayOut = tracker.expenses.filter((e) => e.date === today);
  const card = (kind, colors, status) => `
    <button type="button" class="lh-card st-act st-act--${kind}" id="st-${kind}" style="--app:${colors.color};--app2:${colors.color2}">
      <span class="lh-card-name"><span class="st-act-sign" aria-hidden="true">${kind === "income" ? "+" : "−"}</span>${t(`sales.act.${kind}`)}</span>
      <span class="lh-card-sub">${t(`sales.act.${kind}Sub`)}</span>
      <span class="lh-card-status">${esc(status)}</span>
      <span class="lh-card-go" aria-hidden="true">${icon("arrowRight", { size: 16 })}</span>
      <span class="lh-card-art" aria-hidden="true">${salesArtSVG(kind)}</span>
    </button>`;
  const inSum = todayIn.reduce((a, e) => a + e.amount, 0);
  const outSum = todayOut.reduce((a, e) => a + e.amount, 0);
  let last = "";
  if (state.lastLogged) {
    const e = (state.lastLogged.kind === "expense" ? tracker.expenses : tracker.entries).find((x) => x.id === state.lastLogged.id);
    if (!e) state.lastLogged = null;
    else {
      const p = tracker.products.find((x) => x.id === e.productId);
      const text = state.lastLogged.kind === "expense"
        ? t("sales.last.out", { amount: rp(e.amount), what: categoryLabel(e.category) })
        : t("sales.last.in", { amount: rp(e.amount), qty: formatNumber(e.qty), name: p?.name || "", where: channelLabel(entryChannel(e)) });
      last = `<div class="st-undo ${state.lastLogged.kind === "expense" ? "is-out" : ""}" role="status"><span class="st-undo-text">${icon("check", { size: 14 })}${esc(text)}</span><span class="st-undo-actions"><button type="button" class="btn btn-ghost btn-sm" id="st-edit-last">${icon("edit", { size: 12 })}${t("sales.log.editLast")}</button><button type="button" class="btn btn-ghost btn-sm" id="st-undo">${t("sales.log.undo")}</button></span></div>`;
    }
  }
  return `
    <div class="st-acts">
      ${card("income", INCOME_COLORS, todayIn.length ? t("sales.act.todayIn", { amount: rp(inSum), count: todayIn.length }) : t("sales.act.todayNone"))}
      ${card("expense", EXPENSE_COLORS, todayOut.length ? t("sales.act.todayOut", { amount: rp(outSum) }) : t("sales.act.outNone"))}
    </div>
    ${last}`;
}

function periodTabsHTML(state) {
  return `
    <div class="st-periods">
      <span class="st-periods-label">${t("sales.period.label")}</span>
      <div class="segmented" role="tablist" aria-label="${esc(t("sales.period.label"))}">${SALES_PERIODS.map((k) => `<button type="button" role="tab" aria-selected="${state.period === k}" data-st-period="${k}" class="${state.period === k ? "active" : ""}">${t(`sales.period.${k}`)}</button>`).join("")}</div>
    </div>`;
}

// ▲ 12% / ▼ 8% / new / same — against the previous span of the same length.
// `invert`: for money out, going up is the bad direction.
function deltaHTML(d, { invert = false } = {}) {
  if (!d) return "";
  const text = d.dir === "up" || d.dir === "down" ? `${icon("arrowUp", { size: 11 })}${Math.abs(d.pct)}%` : d.dir === "new" ? t("sales.delta.new") : t("sales.delta.flat");
  const tone = invert && (d.dir === "up" || d.dir === "down") ? (d.dir === "up" ? "bad-up" : "good-down") : d.dir;
  return `<span class="st-delta st-delta--${d.dir} st-tone--${tone}" title="${esc(t("sales.delta.title"))}">${text}</span>`;
}

function statsHTML(tracker, range, state, unit, collapsed) {
  const cur = periodSummary(tracker, range);
  const prev = range.prevFrom ? periodSummary(tracker, { from: range.prevFrom, to: range.prevTo }) : null;
  const all = state.period === "all";
  // All time also holds what was sold before tracking began (opening numbers).
  const totals = trackerTotals(tracker);
  const qty = all ? totals.sold : cur.qty;
  const revenue = all ? totals.revenue : cur.revenue;
  const net = revenue - cur.spend;
  const periodName = t(`sales.period.${state.period}`);
  if (collapsed.has("stats")) return widgetCollapsedHTML("stats", "grid", t("sales.keyStats.title"), t("sales.keyStats.summary3", { in: rp(revenue), out: rp(cur.spend), period: periodName }));
  const d = (key, opts) => (prev ? deltaHTML(deltaOf(cur[key], prev[key]), opts) : "");
  const openingQty = totals.sold - cur.qty;
  const openingRev = totals.revenue - cur.revenue;
  const compareNote = all
    ? (openingQty > 0 || openingRev > 0 ? t("sales.compare.opening", { sold: formatNumber(openingQty), unit, revenue: rp(openingRev) }) : "")
    : t("sales.compare.note", { from: dayLabel(range.prevFrom, false), to: dayLabel(range.prevTo, false) });
  // Gross profit: price − product cost, only over the sales whose cost is known.
  const gross = cur.profit === null
    ? `<span>${t("sales.kpi.grossNone")} <button type="button" class="st-link" data-st-fill-cost>${t("sales.kpi.profitFill")}</button></span>`
    : `<span>${t("sales.kpi.gross", { amount: rp(cur.profit), margin: formatPercent(cur.revenue * cur.coverage ? (cur.profit / (cur.revenue * cur.coverage)) * 100 : 0, 0) })}${cur.coverage < 0.995 ? ` · ${t("sales.kpi.profitPartial", { pct: Math.round(cur.coverage * 100) })} <button type="button" class="st-link" data-st-fill-cost>${t("sales.kpi.profitFill")}</button>` : ""}</span>`;
  const notes = [compareNote, cur.repeat || cur.referral ? t("sales.stat.repeatNote", { repeat: cur.repeat, referral: cur.referral }) : ""].filter(Boolean);
  return widgetCardHTML("stats", "grid", t("sales.keyStats.title"), `
      <div class="stat-grid st-kpis">
        <div class="stat st-kpi-in"><div class="label">${t("sales.kpi.in")} ${d("revenue")}</div><div class="value st-money">${rp(revenue)}</div><div class="sub">${t("sales.kpi.revenueSub", { count: formatNumber(cur.count) })}</div></div>
        <div class="stat st-kpi-out"><div class="label">${t("sales.kpi.out")} ${d("spend", { invert: true })}</div><div class="value st-money">${rp(cur.spend)}</div><div class="sub">${cur.spend ? t("sales.kpi.outSub") : `<button type="button" class="st-link" data-st-expense>${t("sales.kpi.outNone")}</button>`}</div></div>
        <div class="stat st-kpi-net"><div class="label">${t("sales.kpi.net")}</div><div class="value st-money ${net < 0 ? "is-negative" : ""}">${rp(net)}</div><div class="sub">${t("sales.kpi.netSub")}</div></div>
        <div class="stat"><div class="label">${t("sales.kpi.sold")} ${d("qty")}</div><div class="value">${formatNumber(qty)} <small>${esc(unit)}</small></div><div class="sub">${cur.count ? t("sales.kpi.avgLine", { avg: rp(cur.avgOrder) }) : t("sales.kpi.soldSub", { days: cur.activeDays })}</div></div>
      </div>
      <p class="st-gross">${icon("money", { size: 14 })}${gross}</p>
      ${notes.length ? `<p class="st-compare">${esc(notes.join(" · "))}</p>` : ""}
    `, { sub: periodName });
}

function campaignLinkHTML(brandId, campaign) {
  return campaign
    ? `<a class="card glass-card card-tight st-campaign" href="#/brand/${brandId}/campaigns/${campaign.id}">${icon("target", { size: 16 })}<span><b>${esc(campaignDisplayName(campaign.name))}</b> — ${t("sales.campaign.synced")}</span>${icon("arrowRight", { size: 14 })}</a>`
    : `<a class="card glass-card card-tight st-campaign" href="#/brand/${brandId}/campaigns">${icon("target", { size: 16 })}<span>${t("sales.campaign.none")}</span>${icon("arrowRight", { size: 14 })}</a>`;
}

// Where buyers came from in the period, by channel (picked in the wizard),
// each with its share of revenue, what it narrows down to (ad platform, the
// fair, the post), and — for ads and fairs — the spending logged for it and
// the revenue per Rp 1 of it.
function channelsHTML(tracker, range, state, collapsed) {
  const ch = channelBreakdown(tracker, range);
  if (!ch.total && !ch.rows.length) return "";
  const tagged = ch.total - ch.untagged.count;
  if (collapsed.has("channels")) return widgetCollapsedHTML("channels", "users", t("sales.ch.title"), t("sales.src.summary", { tagged, total: ch.total }));
  const totalRevenue = ch.rows.reduce((a, r) => a + r.revenue, 0) + ch.untagged.revenue;
  const share = (rev) => (totalRevenue ? Math.round((rev / totalRevenue) * 100) : 0);
  const detailName = (k) => (k.startsWith("k:") ? getContent(k.slice(2))?.title || t("sales.src.deleted") : AD_KEYS.has(k) ? adPlatformLabel(k) : k);
  const row = (r) => {
    const c = channelByKey(r.key);
    const details = Object.entries(r.details || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `
      <div class="st-ch-row" style="--c:${c.color}">
        <span class="st-ch-ico">${icon(c.icon, { size: 16 })}</span>
        <div class="st-ch-main">
          <div class="st-ch-top"><b>${esc(channelLabel(r.key))}</b><span class="st-ch-amount">${rp(r.revenue)}</span></div>
          <div class="st-share"><span style="width:${Math.max(r.revenue ? 3 : 0, share(r.revenue))}%"></span></div>
          <small>${t("sales.ch.row", { pct: share(r.revenue), count: r.count, qty: formatNumber(r.qty) })}${details.length ? ` · ${details.map(([k, v]) => `${esc(detailName(k))} ${rp(v)}`).join(", ")}` : ""}</small>
          ${r.spend ? `<span class="st-roi ${r.perRp >= 1 ? "is-good" : "is-bad"}">${icon(r.perRp >= 1 ? "arrowUp" : "info", { size: 11 })}${t("sales.ch.roi", { spend: rp(r.spend), per: perRpText(r.perRp) })}</span>` : ""}
        </div>
      </div>`;
  };
  return widgetCardHTML("channels", "users", t("sales.ch.title"), `
      ${ch.rows.map(row).join("")}
      ${ch.untagged.count ? `
        <div class="st-ch-row is-untagged" style="--c:#8A8479">
          <span class="st-ch-ico">${icon("help", { size: 16 })}</span>
          <div class="st-ch-main">
            <div class="st-ch-top"><b>${t("sales.src.untagged")}</b><span class="st-ch-amount">${rp(ch.untagged.revenue)}</span></div>
            <div class="st-share"><span style="width:${Math.max(3, share(ch.untagged.revenue))}%"></span></div>
            <small>${t("sales.ch.untaggedHint", { count: ch.untagged.count, total: ch.total })}</small>
          </div>
        </div>` : ""}
      ${ch.rows.some((r) => r.spend) ? `<p class="ev-field-hint" style="margin:10px 0 0;">${t("sales.ch.roiNote")}</p>` : ""}
    `, { sub: t("sales.src.sub", { period: t(`sales.period.${state.period}`) }) });
}
const AD_KEYS = new Set(["meta", "tiktok", "google", "marketplace", "other"]);

// Where the money went in the period, by category.
function expensesHTML(tracker, range, state, collapsed) {
  const out = expenseSummary(tracker, range);
  if (!out.count) return "";
  if (collapsed.has("expenses")) return widgetCollapsedHTML("expenses", "wallet", t("sales.out.title"), t("sales.out.summary", { amount: rp(out.total), period: t(`sales.period.${state.period}`) }));
  return widgetCardHTML("expenses", "wallet", t("sales.out.title"), `
      ${out.byCategory.map((r) => {
        const c = expenseCategoryByKey(r.key);
        const pct = Math.round((r.amount / out.total) * 100);
        return `
        <div class="st-ch-row" style="--c:${c.color}">
          <span class="st-ch-ico">${icon(c.icon, { size: 16 })}</span>
          <div class="st-ch-main">
            <div class="st-ch-top"><b>${esc(categoryLabel(r.key))}</b><span class="st-ch-amount">${rp(r.amount)}</span></div>
            <div class="st-share is-out"><span style="width:${Math.max(3, pct)}%"></span></div>
            <small>${t("sales.out.row", { pct, count: r.count })}</small>
          </div>
        </div>`;
      }).join("")}
    `, { sub: t("sales.out.sub", { amount: rp(out.total), period: t(`sales.period.${state.period}`) }) });
}

// Trend: daily (30 days) or weekly (8 weeks), revenue or quantity. The bars
// carry no abbreviated figures (the app always shows exact numbers): the
// line above the chart reads out any bar you tap, starting with the best.
function trendSeries(tracker, state) {
  if (state.trendSpan === "week") {
    return weeklySeries(tracker, 8).map((w, i, all) => ({ ...w, label: dayLabel(w.from, false), full: `${dayLabel(w.from, false)} – ${dayLabel(w.to, false)}`, now: i === all.length - 1 }));
  }
  return dailySeries(tracker, 30).map((x, i, all) => ({ ...x, label: String(Number(x.date.slice(8))), full: dayLabel(x.date), now: i === all.length - 1 }));
}
function trendHTML(tracker, unit, state, collapsed) {
  if (!tracker.entries.length) return "";
  if (collapsed.has("trend")) return widgetCollapsedHTML("trend", "chart", t("sales.trend.title2"), t("sales.trend.summary2"));
  const series = trendSeries(tracker, state);
  const key = state.trendMetric === "qty" ? "qty" : "revenue";
  const max = Math.max(1, ...series.map((x) => x[key]));
  const hasData = series.some((x) => x.qty);
  const best = hasData ? series.reduce((b, x, i) => (x[key] > series[b][key] ? i : b), 0) : -1;
  const readout = (x) => t("sales.trend.readout", { label: x.full, qty: formatNumber(x.qty), unit, revenue: rp(x.revenue) });
  const daily = state.trendSpan !== "week";
  const quietDays = daily ? series.filter((x) => !x.qty).length : 0;
  return widgetCardHTML("trend", "chart", t("sales.trend.title2"), `
      <div class="st-trend-controls">
        <div class="segmented">${["day", "week"].map((k) => `<button type="button" data-st-trend-span="${k}" class="${state.trendSpan === k ? "active" : ""}">${t(`sales.trend.${k}`)}</button>`).join("")}</div>
        <div class="segmented">${["revenue", "qty"].map((k) => `<button type="button" data-st-trend-metric="${k}" class="${state.trendMetric === k ? "active" : ""}">${t(`sales.trend.${k}`)}</button>`).join("")}</div>
      </div>
      ${hasData ? `
      <p class="st-readout" id="st-readout" aria-live="polite">${esc(t("sales.trend.best", { text: readout(series[best]) }))}</p>
      <div class="st-trend ${daily ? "is-daily" : ""}">
        ${series.map((x, i) => `
          <button type="button" class="st-bar-col" data-st-bar="${esc(readout(x))}" aria-label="${esc(readout(x))}">
            <span class="st-bar-val">${!daily && key === "qty" && x.qty ? formatNumber(x.qty) : ""}</span>
            <span class="st-bar ${x.now ? "is-now" : ""} ${i === best ? "is-best" : ""}" style="height:${Math.max(x[key] ? 6 : 2, Math.round((x[key] / max) * 100))}%"></span>
            <span class="st-bar-label ${daily && (series.length - 1 - i) % 5 !== 0 ? "is-quiet" : ""}">${esc(x.label)}</span>
          </button>`).join("")}
      </div>
      ${daily ? `<p class="st-compare" style="margin-top:8px;">${t("sales.trend.quiet", { days: quietDays })}</p>` : ""}` : `<p class="text-faint" style="margin:14px 0 4px;font-size:13px;">${t("sales.trend.empty")}</p>`}
    `);
}

// The AI's read of the numbers: a strategy that fits this brand (its Brand
// DNA, what it sells, the channels that actually bring buyers) plus three
// moves for this week. It offers; the owner decides.
function adviceHTML(tracker, state, collapsed) {
  const lifetime = isLifetime(getCachedAccount());
  const a = tracker.lastAdvice;
  if (collapsed.has("advice")) return widgetCollapsedHTML("advice", "sparkle", t("sales.advice.title2"), a ? t("sales.advice.summary", { count: (a.actions || []).length }) : t("sales.advice.summaryEmpty"));
  return widgetCardHTML("advice", "sparkle", `${t("sales.advice.title2")}${lifetime ? "" : ` <span class="lifetime-tag">${icon("lock", { size: 11 })}${t("app.lifetimeOnly")}</span>`}`, `
      ${state.adviceBusy
        ? `${loadingHTML(state.autoReason ? esc(t("ai.auto.busy", { reason: state.autoReason })) : t("sales.advice.busy"), { style: "margin:0;" })}`
        : a
        ? `<div data-ai-answer>${a.autoReason ? `<p class="ai-auto-note">${icon("refresh", { size: 12 })}${esc(t("ai.auto.reason", { reason: a.autoReason }))}</p>` : ""}<p class="text-faint" style="font-size:11.5px;margin:0 0 6px;">${t("sales.advice.from", { date: formatDate(localISODate(new Date(a.at))) })}</p>
           ${a.summary ? `<p style="margin:0 0 12px;font-size:13.5px;">${esc(a.summary)}</p>` : ""}
           ${a.strategy?.text ? `<div class="st-strategy">${a.strategy.focus ? `<span class="st-strategy-focus">${icon("target", { size: 13 })}${esc(a.strategy.focus)}</span>` : ""}<b>${t("sales.advice.strategy")}</b><p>${esc(a.strategy.text)}</p></div>` : ""}
           ${(a.actions || []).map((x, i) => `<div class="st-advice-item"><span class="st-advice-n">${i + 1}</span><div><b>${esc(x.title)}</b>${x.why ? `<span class="st-advice-why">${esc(x.why)}</span>` : ""}${x.how ? `<p>${esc(x.how)}</p>` : ""}</div></div>`).join("")}<div class="ai-report-row">${aiReportButtonHTML("sales-advice")}</div></div>`
        : `<p class="text-muted" style="font-size:13px;margin:0 0 4px;">${t("sales.advice.intro2")}</p>`}
      ${state.adviceError ? `<p class="ev-error">${esc(state.adviceError)}</p>` : ""}
      ${state.adviceBusy ? "" : lifetime
        ? `<button class="btn ${a ? "btn-secondary" : "btn-primary"}" id="st-advice-go" style="margin-top:10px;">${icon("sparkle", { size: 14 })}${a ? t("sales.advice.again") : t("sales.advice.go2")}</button>`
        : `<a class="btn btn-secondary" href="#/pricing" style="margin-top:10px;">${icon("lock", { size: 13 })}${t("sales.advice.locked")}</a>`}
      <p class="ev-field-hint" style="margin:10px 0 0;">${t("sales.advice.note2")}</p>
    `);
}

function collapseToggleHTML(id, collapsed) {
  return `<button type="button" class="icon-btn" id="${id}" aria-label="${collapsed ? t("sales.section.show") : t("sales.section.hide")}" style="width:30px;height:30px;">${icon(collapsed ? "chevronRight" : "chevronDown", { size: 14 })}</button>`;
}

// Products ranked by the revenue they brought in the picked period, each
// with its share, margin (when the cost is filled in) and how long it has
// been quiet. A product that sold before but not for IDLE_DAYS gets a flag.
function productsHTML(stats, campaign, unit, collapsed) {
  const rows = stats.filter((s) => !s.product.archived).sort((a, b) => b.rangeRevenue - a.rangeRevenue || b.rangeQty - a.rangeQty);
  const archived = stats.filter((s) => s.product.archived);
  if (!rows.length && !archived.length) return `<div class="card glass-card card-tight"><div class="table-empty" style="padding:28px;">${t("sales.products.empty")}</div></div>`;
  if (collapsed) return "";
  const targetOf = (id) => campaign?.goalPlan?.products?.find((p) => p.id === id)?.target || null;
  const totalRevenue = rows.reduce((a, s) => a + s.rangeRevenue, 0);
  const row = (s) => {
    const p = s.product;
    const target = targetOf(p.id);
    const pct = target ? Math.min(100, Math.round((s.sold / target) * 100)) : 0;
    const discountPct = activeDiscountPct(p);
    const share = totalRevenue ? Math.round((s.rangeRevenue / totalRevenue) * 100) : 0;
    const idle = s.loggedQty ? daysSince(s.lastSaleDate) : null;
    const margin = hasCost(p) && p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : null;
    const when = idle === null ? t("sales.prod.neverSold") : idle <= 0 ? t("sales.prod.today") : t("sales.prod.lastSold", { n: idle });
    const price = discountPct
      ? `<s>${rp(p.price)}</s> ${rp(effectivePrice(p))} <span class="tag tag-discount">-${discountPct}%${p.discountUntil ? ` · ${t("sales.products.discountUntilBadge", { date: esc(formatDate(p.discountUntil, { year: undefined })) })}` : ""}</span>`
      : rp(p.price);
    return `
      <div class="st-prod ${p.archived ? "is-archived" : ""}" data-st-edit="${p.id}" role="button" tabindex="0" aria-label="${esc(`${t("common.edit")}: ${p.name}`)}">
        <div class="st-prod-main">
          <div class="st-prod-title"><b>${esc(p.name)}</b>${p.archived ? ` <span class="tag">${t("sales.products.archived")}</span>` : ""}${!p.archived && idle !== null && idle >= IDLE_DAYS ? ` <span class="tag tag-idle">${t("sales.prod.idle", { n: idle })}</span>` : ""}</div>
          <small>${price} · ${esc(when)} · ${margin !== null ? t("sales.prod.margin", { pct: margin }) : `<span class="st-nocost">${t("sales.prod.noCost")}</span>`}</small>
          ${s.rangeRevenue ? `<div class="st-share" title="${esc(t("sales.prod.share", { pct: share }))}"><span style="width:${Math.max(3, share)}%"></span></div>` : ""}
          ${target ? `<div class="st-target"><small class="text-faint">${t("sales.prod.target", { sold: formatNumber(s.sold), target: formatNumber(target), unit })}</small><div class="cd-bar"><span style="width:${pct}%"></span></div></div>` : ""}
        </div>
        <div class="st-prod-nums">
          ${s.rangeQty ? `<b>${rp(s.rangeRevenue)}</b><small>${formatNumber(s.rangeQty)} ${esc(unit)} · ${t("sales.prod.share", { pct: share })}</small>${s.rangeProfit !== null ? `<small>${t("sales.prod.profit", { amount: rp(s.rangeProfit) })}</small>` : ""}` : `<small>${t("sales.prod.periodNone")}</small>`}
        </div>
        <span class="st-prod-edit" aria-hidden="true">${icon("edit", { size: 14 })}</span>
      </div>`;
  };
  return `<div class="card glass-card card-tight st-prods">${[...rows, ...archived].map(row).join("")}</div>`;
}

// One line per record: a sale (green +) or an expense (coral −).
// The My Goals event / goal a record is linked to, as a small tag — unless the
// channel detail already names it (a fair picked as the sale's channel).
function goalTagHTML(e, brandId) {
  const id = e.eventId || e.source?.campaignId || e.campaignId;
  const c = id ? listCampaigns(brandId).find((x) => x.id === id) : null;
  if (!c || (e.channelDetail && e.channelDetail === c.name)) return "";
  return ` <span class="tag st-source-tag st-goal-tag">${icon(c.eventPlan ? "calendar" : "flag", { size: 10 })}${esc(campaignDisplayName(c.name) || "")}</span>`;
}
function entryRowHTML(e, byId, brandId, { showDate = false } = {}) {
  const date = showDate ? `<span class="st-entry-date">${esc(dayLabel(e.date, false))}</span>` : "";
  if (e.kind === "expense") {
    const c = expenseCategoryByKey(e.category);
    return `
        <div class="st-entry is-out" style="--c:${c.color}">${date}
          <span class="st-entry-ico">${icon(c.icon, { size: 14 })}</span>
          <span class="st-entry-main"><b>${esc(categoryLabel(e.category))}</b>${e.channelDetail ? ` <span class="tag">${esc(AD_KEYS.has(e.channelDetail) ? adPlatformLabel(e.channelDetail) : e.channelDetail)}</span>` : ""}${goalTagHTML(e, brandId)}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span>
          <span class="st-entry-amount">− ${rp(e.amount)}</span>
          <button class="icon-btn" data-st-edit-out="${e.id}" aria-label="${esc(t("common.edit"))}" style="width:28px;height:28px;">${icon("edit", { size: 13 })}</button>
          <button class="icon-btn" data-st-delete-out="${e.id}" aria-label="${esc(t("common.delete"))}" style="width:28px;height:28px;">${icon("trash", { size: 13 })}</button>
        </div>`;
  }
  const ch = channelByKey(entryChannel(e));
  const post = e.source?.contentId ? getContent(e.source.contentId) : null;
  const chText = ch ? `${channelLabel(ch.key)}${e.channelDetail ? ` · ${AD_KEYS.has(e.channelDetail) ? adPlatformLabel(e.channelDetail) : e.channelDetail}` : post ? ` · ${post.title || t("common.untitled")}` : ""}` : "";
  return `
        <div class="st-entry" style="--c:${ch?.color || "#8A8479"}">${date}
          <span class="st-entry-ico">${icon(ch?.icon || "help", { size: 14 })}</span>
          <span class="st-entry-main"><b>${formatNumber(e.qty)}× ${esc(byId[e.productId]?.name || "—")}</b>${chText ? ` <span class="tag st-source-tag">${esc(chText)}</span>` : ""}${goalTagHTML(e, brandId)}${e.repeat ? ` <span class="tag">${t("sales.tag.repeat")}</span>` : ""}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span>
          <span class="st-entry-amount">+ ${rp(e.amount)}</span>
          <button class="icon-btn" data-st-edit-sale="${e.id}" aria-label="${esc(t("common.edit"))}" style="width:28px;height:28px;">${icon("edit", { size: 13 })}</button>
          <button class="icon-btn" data-st-delete="${e.id}" aria-label="${esc(t("common.delete"))}" style="width:28px;height:28px;">${icon("trash", { size: 13 })}</button>
        </div>`;
}

// The log, newest first, grouped the way the owner picks: per day, per week
// (Monday–Sunday), per month, or all time in one list. Every group header
// carries that group's money in, money out and what's left; week and month
// groups fold open (the newest is open), so the headers alone read as a
// weekly / monthly summary.
const HISTORY_GROUPS = ["day", "week", "month", "all"];
const plusDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return localISODate(new Date(y, m - 1, d + n));
};
const mondayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return plusDays(iso, -((new Date(y, m - 1, d).getDay() + 6) % 7));
};
const groupKeyOf = (group, e) => (group === "week" ? mondayOf(e.date) : group === "month" ? e.date.slice(0, 7) : group === "all" ? "all" : e.date);
function groupLabel(group, key) {
  if (group === "week") return t("sales.history.weekOf", { from: dayLabel(key, false), to: dayLabel(plusDays(key, 6), false) });
  if (group === "month") return formatDate(`${key}-01`, { day: undefined, month: "long", year: "numeric" });
  if (group === "all") return t("sales.history.allTime");
  return dayLabel(key);
}
function historyHTML(tracker, state, collapsed, brandId) {
  if (collapsed) return "";
  const group = HISTORY_GROUPS.includes(state.historyGroup) ? state.historyGroup : "day";
  const byId = Object.fromEntries(tracker.products.map((p) => [p.id, p]));
  const sales = state.historyKind === "out" ? [] : tracker.entries.filter((e) => !state.historyProduct || e.productId === state.historyProduct);
  const outs = state.historyKind === "in" || state.historyProduct ? [] : tracker.expenses;
  const list = [...sales, ...outs].sort((a, b) => (b.date === a.date ? b.at - a.at : b.date < a.date ? -1 : 1));
  // Totals per group always come from the whole (filtered) log, not just the rows shown.
  const totals = new Map();
  list.forEach((e) => {
    const k = groupKeyOf(group, e);
    const row = totals.get(k) || { in: 0, out: 0, count: 0 };
    if (e.kind === "expense") row.out += e.amount;
    else {
      row.in += e.amount;
      row.count += 1;
    }
    totals.set(k, row);
  });
  const headHTML = (key, tag = "div") => {
    const tot = totals.get(key) || { in: 0, out: 0, count: 0 };
    const net = tot.in - tot.out;
    return `<${tag} class="st-day-head${group !== "day" ? " is-group" : ""}"><b>${esc(groupLabel(group, key))}${group !== "day" && tot.count ? ` <small>${t("sales.history.groupCount", { count: tot.count })}</small>` : ""}</b><span>${tot.in ? `<em class="is-in">+ ${rp(tot.in)}</em>` : ""}${tot.out ? `<em class="is-out">− ${rp(tot.out)}</em>` : ""}${group !== "day" && tot.in && tot.out ? `<em class="is-net">= ${rp(net)}</em>` : ""}</span></${tag}>`;
  };
  const rows = (items) => items.map((e) => entryRowHTML(e, byId, brandId, { showDate: group !== "day" })).join("");
  // Days and "all time" page through the log; weeks and months fold instead.
  const paged = group === "day" || group === "all";
  const shown = paged && !state.showAll ? list.slice(0, HISTORY_PAGE) : list;
  const buckets = [];
  shown.forEach((e) => {
    const k = groupKeyOf(group, e);
    const last = buckets[buckets.length - 1];
    if (last && last.key === k) last.items.push(e);
    else buckets.push({ key: k, items: [e] });
  });
  const body = !buckets.length
    ? `<div class="table-empty" style="padding:28px;">${t("sales.history.empty2")}</div>`
    : paged
    ? buckets.map((b) => `${headHTML(b.key)}${rows(b.items)}`).join("")
    : buckets.map((b, i) => `<details class="st-group"${i === 0 || state.openGroups?.has(b.key) ? " open" : ""} data-st-group="${b.key}">${headHTML(b.key, "summary")}${rows(b.items)}</details>`).join("");
  const kinds = `<div class="segmented st-history-kinds">${["all", "in", "out"].map((k) => `<button type="button" data-st-hkind="${k}" class="${state.historyKind === k ? "active" : ""}">${t(`sales.history.kind.${k}`)}</button>`).join("")}</div>`;
  const groups = `<div class="st-history-group"><span>${t("sales.history.groupBy")}</span><div class="segmented">${HISTORY_GROUPS.map((k) => `<button type="button" data-st-hgroup="${k}" class="${group === k ? "active" : ""}">${t(`sales.history.group.${k}`)}</button>`).join("")}</div></div>`;
  const productFilter = tracker.products.length > 1 && state.historyKind !== "out"
    ? `<select class="select input" id="st-history-product" aria-label="${esc(t("sales.history.filterLabel"))}"><option value="">${t("sales.history.filterAll")}</option>${tracker.products.map((p) => `<option value="${p.id}" ${state.historyProduct === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`
    : "";
  return `
    <div class="card glass-card card-tight st-history">
      <div class="st-history-filter">${groups}${kinds}${productFilter}</div>
      ${body}
      ${paged && list.length > HISTORY_PAGE ? `<button class="btn btn-ghost btn-block" id="st-history-toggle">${state.showAll ? t("sales.history.less") : t("sales.history.all", { count: list.length })}</button>` : ""}
    </div>`;
}

// ---------- Wiring ----------
function wire(root, brandId, state, refresh, { brand, tracker, unit }) {
  qs("#st-income", root)?.addEventListener("click", () => openIncome(brandId, state, refresh));
  qs("#st-expense", root)?.addEventListener("click", () => openExpense(brandId, state, refresh));
  qsa("[data-st-expense]", root).forEach((b) => b.addEventListener("click", () => openExpense(brandId, state, refresh)));
  qs("#st-undo", root)?.addEventListener("click", () => {
    const last = state.lastLogged;
    if (last?.kind === "expense") deleteExpense(brandId, last.id);
    else if (last) deleteSale(brandId, last.id);
    state.lastLogged = null;
    toast(t("sales.log.undone"));
    refresh();
  });
  const editSale = (entry) => openIncome(brandId, state, refresh, { entry });
  const editExpense = (entry) => openExpense(brandId, state, refresh, { entry });
  qs("#st-edit-last", root)?.addEventListener("click", () => {
    const last = state.lastLogged;
    const e = (last?.kind === "expense" ? tracker.expenses : tracker.entries).find((x) => x.id === last?.id);
    if (e) (last.kind === "expense" ? editExpense : editSale)(e);
  });

  qsa("[data-st-period]", root).forEach((b) =>
    b.addEventListener("click", () => {
      state.period = b.dataset.stPeriod;
      refresh();
    })
  );
  qsa("[data-st-trend-span]", root).forEach((b) => b.addEventListener("click", () => { state.trendSpan = b.dataset.stTrendSpan; refresh(); }));
  qsa("[data-st-trend-metric]", root).forEach((b) => b.addEventListener("click", () => { state.trendMetric = b.dataset.stTrendMetric; refresh(); }));
  const readoutEl = qs("#st-readout", root);
  qsa("[data-st-bar]", root).forEach((b) => {
    const show = () => {
      if (readoutEl) readoutEl.textContent = b.dataset.stBar;
    };
    b.addEventListener("click", show);
    b.addEventListener("mouseenter", show);
    b.addEventListener("focus", show);
  });
  qsa("[data-st-fill-cost]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const p = tracker.products.find((x) => !x.archived && !hasCost(x)) || tracker.products.find((x) => !x.archived);
      if (p) openProductModal({ brandId, unit, product: p, onSaved: refresh, focusCost: true });
    })
  );

  qsa("#st-add-product, #st-add-product-top", root).forEach((b) => b.addEventListener("click", () => openProductModal({ brandId, unit, onSaved: refresh })));
  qs("[data-st-first-product]", root)?.addEventListener("click", () => openProductModal({ brandId, unit, onSaved: refresh }));
  qsa("[data-st-edit]", root).forEach((row) => {
    const open = () => openProductModal({ brandId, unit, product: tracker.products.find((p) => p.id === row.dataset.stEdit), onSaved: refresh });
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    });
  });
  qsa("[data-st-edit-sale]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const entry = tracker.entries.find((e) => e.id === b.dataset.stEditSale);
      if (entry) editSale(entry);
    })
  );
  qsa("[data-st-edit-out]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const entry = tracker.expenses.find((e) => e.id === b.dataset.stEditOut);
      if (entry) editExpense(entry);
    })
  );
  qsa("[data-st-delete]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("sales.history.deleteTitle"), message: t("sales.history.deleteBody"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      deleteSale(brandId, b.dataset.stDelete);
      refresh();
    })
  );
  qsa("[data-st-delete-out]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("sales.out.deleteTitle"), message: t("sales.out.deleteBody"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      deleteExpense(brandId, b.dataset.stDeleteOut);
      refresh();
    })
  );
  qsa("[data-st-hgroup]", root).forEach((b) =>
    b.addEventListener("click", () => {
      state.historyGroup = b.dataset.stHgroup;
      state.showAll = false;
      state.openGroups = new Set();
      refresh();
    })
  );
  qsa("[data-st-group]", root).forEach((d) =>
    d.addEventListener("toggle", () => {
      state.openGroups ||= new Set();
      if (d.open) state.openGroups.add(d.dataset.stGroup);
      else state.openGroups.delete(d.dataset.stGroup);
    })
  );
  qsa("[data-st-hkind]", root).forEach((b) =>
    b.addEventListener("click", () => {
      state.historyKind = b.dataset.stHkind;
      if (state.historyKind === "out") state.historyProduct = "";
      state.showAll = false;
      refresh();
    })
  );
  qs("#st-history-product", root)?.addEventListener("change", (e) => {
    state.historyProduct = e.target.value;
    state.showAll = false;
    refresh();
  });
  qs("#st-history-toggle", root)?.addEventListener("click", () => {
    state.showAll = !state.showAll;
    refresh();
  });
  qs("#st-history-clear", root)?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: t("sales.history.clearAllTitle"), message: t("sales.history.clearAllBody", { count: tracker.entries.length }), confirmLabel: t("sales.history.clearAll"), danger: true });
    if (!ok) return;
    clearAllSales(brandId);
    state.lastLogged = null;
    toast(t("sales.history.clearAllDone"));
    refresh();
  });
  qs("#st-products-toggle", root)?.addEventListener("click", () => {
    setSectionCollapsed(brandId, "products", !isSectionCollapsed(brandId, "products"));
    refresh();
  });
  qs("#st-history-toggle-collapse", root)?.addEventListener("click", () => {
    setSectionCollapsed(brandId, "history", !isSectionCollapsed(brandId, "history"));
    refresh();
  });

  qs("#st-xlsx", root)?.addEventListener("click", () => {
    downloadBlob(buildXlsx(exportSheets(getBrand(brandId), unit)), `sales-${slug(brand.name)}-${localISODate()}.xlsx`);
    toast(t("sales.export.excelDone"));
  });

  qs("#st-advice-go", root)?.addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    if (!hasAiKey(ai)) {
      toast(t("sales.advice.noKey"), "error");
      return;
    }
    state.adviceBusy = true;
    state.adviceError = "";
    refresh();
    try {
      const fresh = getBrand(brandId);
      const salesCampaigns = listCampaigns(brandId);
      const pulseText = pulseTextFor(fresh, { content: listContent(brandId), campaigns: salesCampaigns, settings: getSettings() });
      const advice = await suggestSalesActions(ai, { brand: fresh, snapshotText: salesSnapshotText(fresh, { unit }), campaigns: salesCampaigns, pulseText });
      saveAdvice(brandId, { ...advice, refreshedFor: getTracker(fresh).lastAdvice?.refreshedFor || [] });
    } catch (e) {
      state.adviceError = e instanceof AiApiError ? e.message : t("sales.advice.err");
    }
    state.adviceBusy = false;
    refresh();
  });
}

const slug = (s) => String(s || "brand").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

function openProductModal({ brandId, unit, product = null, onSaved, focusCost = false }) {
  const field = (id, label, value, { money = false, hint = "", optional = false } = {}) => `
    <div class="field">
      <label for="${id}">${label}${optional ? ` <span class="copy-optional">${t("goal.sales.optional")}</span>` : ""}</label>
      <input class="input" id="${id}" inputmode="numeric" autocomplete="off" data-num value="${value === null || value === undefined ? "" : formatNumber(value)}" placeholder="${money ? "Rp" : "0"}" />
      ${hint ? `<p class="ev-field-hint">${hint}</p>` : ""}
    </div>`;
  const overlay = openModal({
    title: product ? t("sales.product.editTitle") : t("sales.product.newTitle"),
    bodyHTML: `
      <div class="field"><label for="sp-name">${t("goal.sales.nameQ")}</label><input class="input" id="sp-name" maxlength="60" autocomplete="off" value="${esc(product?.name || "")}" /></div>
      <div class="row-2">
        ${field("sp-price", t("sales.product.price"), product?.price ?? null, { money: true })}
        ${field("sp-cost", t("goal.sales.costQ"), product?.cost ?? null, { money: true, optional: true, hint: t("sales.product.costHint") })}
      </div>
      ${field("sp-opening", t("sales.product.opening", { unit }), product?.openingSold ?? null, { hint: t("sales.product.openingHint"), optional: true })}
      <div class="row-2">
        ${field("sp-discount", t("sales.product.discountPct"), product?.discountPct ?? null, { optional: true })}
        <div class="field">
          <label for="sp-discount-until">${t("sales.product.discountUntilLabel")} <span class="copy-optional">${t("goal.sales.optional")}</span></label>
          <input class="input" type="date" id="sp-discount-until" min="${localISODate()}" value="${product?.discountUntil || ""}" />
        </div>
      </div>
      <p class="ev-field-hint" style="margin-top:-6px;">${t("sales.product.discountHint")}</p>
      ${product ? `<label class="checkbox-chip"><input type="checkbox" id="sp-archived" ${product.archived ? "checked" : ""} />${t("sales.product.archive")}</label><p class="ev-field-hint" style="margin-top:6px;">${t("sales.product.archiveHint")}</p>` : ""}
    `,
    footHTML: `<button type="button" class="btn btn-primary" id="sp-save">${icon("check", { size: 14 })}${t("common.save")}</button>`,
  });
  qsa("[data-num]", overlay).forEach((el) =>
    el.addEventListener("input", () => {
      const n = toNum(el.value);
      el.value = n === null ? "" : formatNumber(n);
    })
  );
  qs("#sp-save", overlay).addEventListener("click", () => {
    const name = qs("#sp-name", overlay).value.trim();
    const price = toNum(qs("#sp-price", overlay).value);
    if (!name || !price) {
      toast(t("sales.product.err"), "error");
      return;
    }
    const discountPct = toNum(qs("#sp-discount", overlay).value);
    const discountUntil = qs("#sp-discount-until", overlay).value || null;
    const data = {
      name, price, cost: toNum(qs("#sp-cost", overlay).value), openingSold: toNum(qs("#sp-opening", overlay).value) || 0,
      discountPct: discountPct && discountPct > 0 ? discountPct : null, discountUntil: discountPct && discountPct > 0 ? discountUntil : null,
    };
    if (product) updateProduct(brandId, product.id, { ...data, archived: !!qs("#sp-archived", overlay)?.checked });
    const added = product ? null : addProduct(brandId, data);
    closeOverlay(overlay);
    onSaved?.(added || product);
  });
  qs(focusCost ? "#sp-cost" : "#sp-name", overlay).focus();
}

// ---------- Export ----------
function exportSheets(brand, unit) {
  const tracker = getTracker(brand);
  const byId = Object.fromEntries(tracker.products.map((p) => [p.id, p]));
  const campaignName = (id) => listCampaigns(brand.id).find((c) => c.id === id)?.name || "";
  const sourceText = (e) => (e.source?.contentId ? getContent(e.source.contentId)?.title || "" : campaignName(e.source?.campaignId || e.eventId));
  const yesNo = (v) => (v ? t("sales.export.yes") : "");
  const detailText = (d) => (d ? (AD_KEYS.has(d) ? adPlatformLabel(d) : d) : "");
  // Cost/profit stay empty (not 0) when the cost of that sale is unknown.
  const costOf = (e) => {
    const c = entryUnitCost(e, byId[e.productId]);
    return c === null ? "" : c * e.qty;
  };
  const byDate = (a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1);
  const entries = [...tracker.entries].sort(byDate);
  const expenses = [...tracker.expenses].sort(byDate);
  const months = {};
  const monthOf = (k) => (months[k] ||= { qty: 0, revenue: 0, count: 0, profit: 0, covered: 0, out: 0 });
  entries.forEach((e) => {
    const m = monthOf(e.date.slice(0, 7));
    m.qty += e.qty;
    m.revenue += e.amount;
    m.count += 1;
    const cost = costOf(e);
    if (cost !== "") {
      m.profit += e.amount - cost;
      m.covered += 1;
    }
  });
  expenses.forEach((e) => (monthOf(e.date.slice(0, 7)).out += e.amount));
  return [
    {
      name: t("sales.export.sheetSales"),
      rows: [
        [t("sales.log.date"), t("sales.col.product"), t("sales.export.qty", { unit }), t("sales.export.unitPrice"), t("sales.export.revenue"), t("sales.export.cost"), t("sales.export.profit"), t("sales.export.channel"), t("sales.export.channelDetail"), t("sales.tag.repeat"), t("sales.tag.referral"), t("sales.log.source"), t("sales.log.note")],
        ...entries.map((e) => {
          const cost = costOf(e);
          return [e.date, byId[e.productId]?.name || "—", e.qty, e.qty ? Math.round(e.amount / e.qty) : 0, e.amount, cost, cost === "" ? "" : e.amount - cost, entryChannel(e) ? channelLabel(entryChannel(e)) : "", detailText(e.channelDetail), yesNo(e.repeat), yesNo(e.referral), sourceText(e), e.note || ""];
        }),
      ],
    },
    {
      name: t("sales.export.sheetExpenses"),
      rows: [
        [t("sales.log.date"), t("sales.export.category"), t("sales.export.channelDetail"), t("sales.export.amountOut"), t("sales.log.note")],
        ...expenses.map((e) => [e.date, categoryLabel(e.category), detailText(e.channelDetail), e.amount, e.note || ""]),
      ],
    },
    {
      name: t("sales.export.sheetProducts"),
      rows: [
        [t("sales.col.product"), t("sales.col.price"), t("goal.sales.costQ"), t("sales.export.opening"), t("sales.export.logged"), t("sales.export.totalSold", { unit }), t("sales.export.revenue"), t("sales.export.profit")],
        ...productStats(tracker).map((s) => [s.product.name, s.product.price, s.product.cost ?? "", s.product.openingSold, s.loggedQty, s.sold, s.loggedRevenue, s.profit ?? ""]),
      ],
    },
    {
      name: t("sales.export.sheetMonthly"),
      rows: [
        [t("sales.export.month"), t("sales.export.salesCount"), t("sales.export.qty", { unit }), t("sales.export.revenue"), t("sales.export.profit"), t("sales.export.amountOut"), t("sales.export.net")],
        ...Object.keys(months).sort().map((k) => [k, months[k].count, months[k].qty, months[k].revenue, months[k].covered ? months[k].profit : "", months[k].out, months[k].revenue - months[k].out]),
      ],
    },
  ];
}
