// Sales Tracker: the brand's product list and sales log (data + rules live
// in js/sales-tracker.js). The page is built around ONE action — "log a
// sale": pick the product, type how many, save. Date and revenue fill
// themselves in. Everything else on the page is read-only and derived:
// this month's numbers, per-product totals, the 8-week trend, the running
// Sales Growth campaign's progress (kept in sync automatically — nobody
// re-types numbers on the campaign page), AI advice on what to do next, and
// the Excel/PDF export.
// Logging and export are free for every account; the AI advice follows the
// same Lifetime gate as Copy Studio. Still 100% manual entry — the page
// says so, and nothing here asks for or shows ads metrics.
import { getBrand, listCampaigns, getSettings, unitLabel, localISODate, updateBrand } from "../store.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";
import {
  getTracker, addProduct, updateProduct, logSale, deleteSale, clearAllSales, saveAdvice, productStats, trackerTotals, monthRange, weeklySeries,
  runningSalesCampaign, salesSnapshotText, activeDiscountPct, effectivePrice, eventCampaignsForBrand,
} from "../sales-tracker.js";
import { salesModel } from "../goal-plan.js";
import { suggestSalesActions, hasAiKey, AiApiError } from "../ai.js";
import { buildXlsx, downloadBlob } from "../xlsx-lite.js";
import { getCachedAccount, isLifetime } from "../account.js";
import { backLinkHTML } from "../back-link.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { toast, formatNumber, formatDate, qs, qsa, escapeHtml as esc, avatarHTML } from "../dom.js";
import { readFlag, writeFlag, clearFlag } from "../seen-flags.js";
import { t } from "../i18n.js";

// Products & Sales log can both grow long — collapsed once, they stay
// collapsed (remembered locally per brand) instead of resetting every visit.
const COLLAPSE_PREFIX = "salestracker:collapsed:";
const isSectionCollapsed = (brandId, key) => readFlag(COLLAPSE_PREFIX, `${brandId}:${key}`);
const setSectionCollapsed = (brandId, key, on) => (on ? writeFlag(COLLAPSE_PREFIX, `${brandId}:${key}`) : clearFlag(COLLAPSE_PREFIX, `${brandId}:${key}`));

const onlyDigits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const toNum = (v) => (onlyDigits(v) === "" ? null : Number(onlyDigits(v)));
const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;
const HISTORY_PAGE = 15;
const discountUntilPart = (product) => (product?.discountUntil ? ` (${t("sales.products.discountUntilBadge", { date: formatDate(product.discountUntil, { year: undefined }) })})` : "");

export function render(root, { brandId }) {
  if (!getBrand(brandId)) {
    location.hash = "#/";
    return () => {};
  }
  const state = { productId: null, showAll: false, adviceBusy: false, adviceError: "", dead: false };
  const refresh = () => !state.dead && paint(root, brandId, state, refresh);
  refresh();
  return () => {
    state.dead = true;
  };
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  const tracker = getTracker(brand);
  const campaign = runningSalesCampaign(brandId);
  const unit = unitLabel(salesModel(campaign?.goalPlan?.model || tracker.model).unit);
  const active = tracker.products.filter((p) => !p.archived);
  const month = monthRange();
  const stats = productStats(tracker, month);
  const totals = trackerTotals(tracker, month);
  if (!active.some((p) => p.id === state.productId)) state.productId = active[0]?.id || null;
  const productsCollapsed = isSectionCollapsed(brandId, "products");
  const historyCollapsed = isSectionCollapsed(brandId, "history");
  const hasHistory = tracker.entries.length > 0;
  const collapsed = new Set(brand.salesWidgetsCollapsed || []);
  const events = eventCampaignsForBrand(brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}/tools`, t("nav.tools"))} · ${t("sales.eyebrow")}${helpButtonHTML("sales")}</div>
        <h1>${esc(brand.name)}</h1>
      </div>
      ${active.length ? `<button class="btn btn-secondary" id="st-xlsx">${icon("download", { size: 15 })}${t("sales.export.excel")}</button>` : ""}
    </div>
    <p class="page-sub" style="margin-bottom:22px;">${t("sales.sub")}</p>
    ${active.length ? `
      ${quickLogHTML(active, state, unit, events)}
      ${collapsed.has("stats") ? widgetCollapsedHTML("stats", "grid", t("sales.keyStats.title"), t("sales.keyStats.summary", { sold: formatNumber(totals.rangeQty), revenue: rp(totals.rangeRevenue) })) : widgetCardHTML("stats", "grid", t("sales.keyStats.title"), `
        <div class="stat-grid" style="margin-bottom:0;">
          <div class="stat"><div class="label">${t("sales.stat.monthSold")}</div><div class="value">${formatNumber(totals.rangeQty)} <small>${esc(unit)}</small></div><div class="sub">${t("sales.stat.monthSales", { count: totals.rangeCount })}</div></div>
          <div class="stat"><div class="label">${t("sales.stat.monthRevenue")}</div><div class="value st-money">${rp(totals.rangeRevenue)}</div><div class="sub">${t("sales.stat.revenueNote")}</div></div>
          <div class="stat"><div class="label">${t("sales.stat.allSold")}</div><div class="value">${formatNumber(totals.sold)} <small>${esc(unit)}</small></div><div class="sub">${t("sales.stat.allSoldNote")}</div></div>
          <div class="stat"><div class="label">${t("sales.stat.allRevenue")}</div><div class="value st-money">${rp(totals.revenue)}</div><div class="sub">${t("sales.stat.repeatNote", { repeat: totals.repeatCount, referral: totals.referralCount })}</div></div>
        </div>
      `)}
      ${campaignLinkHTML(brandId, campaign)}
      ${trendHTML(tracker, unit, collapsed)}
      ${adviceHTML(tracker, state, collapsed)}
    ` : emptyHTML()}
    <div class="section-title">
      <h2>${t("sales.products.title")}</h2>
      <div class="flex items-center gap-8">
        <button class="btn btn-secondary btn-sm" id="st-add-product">${icon("plus", { size: 14 })}${t("sales.products.add")}</button>
        ${stats.length ? collapseToggleHTML("st-products-toggle", productsCollapsed) : ""}
      </div>
    </div>
    ${productsHTML(stats, campaign, unit, productsCollapsed)}
    ${active.length ? `
      <div class="section-title">
        <h2>${t("sales.history.title")}</h2>
        <div class="flex items-center gap-8">
          <span class="text-faint" style="font-size:12px;">${t("sales.history.count", { count: tracker.entries.length })}</span>
          ${hasHistory ? `<button class="btn btn-ghost btn-sm" id="st-history-clear">${icon("trash", { size: 13 })}${t("sales.history.clearAll")}</button>` : ""}
          ${collapseToggleHTML("st-history-toggle-collapse", historyCollapsed)}
        </div>
      </div>
      ${historyHTML(tracker, state, historyCollapsed, events)}
    ` : ""}
  `;

  wireHelpButtons(root);
  wireWidgetToggle(root, { collapsedList: brand.salesWidgetsCollapsed, save: (next) => updateBrand(brandId, { salesWidgetsCollapsed: next }), refresh });
  wire(root, brandId, state, refresh, { brand, tracker, campaign, unit });
}

function emptyHTML() {
  return `
    <div class="content-view-card glass-card" style="max-width:520px;cursor:default;margin-bottom:8px;">
      <div class="icon-wrap">${icon("target", { size: 22 })}</div>
      <h3>${t("sales.empty.title")}</h3>
      <p>${t("sales.empty.body")}</p>
      <button class="btn btn-primary" data-st-first-product style="margin-top:12px;">${icon("plus", { size: 15 })}${t("sales.products.addFirst")}</button>
    </div>`;
}

// The one input of the page. Product chips (a select past 6), quantity,
// done. Revenue is price × quantity until the user overrides it; date and
// the two optional flags sit behind "details" so the default path is
// product → number → save.
function quickLogHTML(products, state, unit, events = []) {
  const current = products.find((p) => p.id === state.productId) || products[0];
  const discountPct = activeDiscountPct(current);
  const picker = products.length > 6
    ? `<select class="select input" id="st-product">${products.map((p) => `<option value="${p.id}" ${p.id === current.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`
    : `<div class="chip-select" id="st-product-chips" style="flex-wrap:wrap;">${products.map((p) => `<button type="button" data-val="${p.id}" class="${p.id === current.id ? "active" : ""}">${esc(p.name)}</button>`).join("")}</div>`;
  return `
    <div class="card glass-card st-log" id="st-log">
      <div class="page-eyebrow" style="margin-bottom:10px;">${t("sales.log.title")}</div>
      <div class="field"><label>${t("sales.log.product")}</label>${picker}</div>
      <div class="st-log-row">
        <div class="field"><label for="st-qty">${t("sales.log.qty", { unit })}</label><input class="input" id="st-qty" inputmode="numeric" autocomplete="off" value="1" /></div>
        <div class="field"><label for="st-amount">${t("sales.log.amount")}</label><input class="input" id="st-amount" inputmode="numeric" autocomplete="off" value="${formatNumber(effectivePrice(current))}" data-auto="1" /></div>
        <button class="btn btn-primary" id="st-save">${icon("check", { size: 15 })}${t("sales.log.save")}</button>
      </div>
      <p class="ev-field-hint" id="st-price-note" style="margin-top:-4px;">${discountPct ? t("sales.log.discountActive", { pct: discountPct, untilPart: discountUntilPart(current) }) : t("sales.log.amountHint")}</p>
      <details class="st-log-more">
        <summary>${t("sales.log.more")}</summary>
        <div class="st-log-row" style="margin-top:10px;">
          <div class="field"><label for="st-date">${t("sales.log.date")}</label><input class="input" type="date" id="st-date" value="${localISODate()}" max="${localISODate()}" /></div>
          <div class="field" style="flex:2;"><label for="st-note">${t("sales.log.note")}</label><input class="input" id="st-note" maxlength="140" autocomplete="off" placeholder="${esc(t("sales.log.notePh"))}" /></div>
        </div>
        ${events.length ? `
        <div class="field" style="margin-top:10px;">
          <label for="st-event">${t("sales.log.event")}</label>
          <select class="select input" id="st-event">
            <option value="">${t("sales.log.eventNone")}</option>
            ${events.map((ev) => `<option value="${ev.id}">${esc(ev.name || "")}${ev.eventPlan?.eventDate ? ` — ${esc(formatDate(ev.eventPlan.eventDate, { year: undefined }))}` : ""}</option>`).join("")}
          </select>
          <p class="ev-field-hint">${t("sales.log.eventHint")}</p>
        </div>` : ""}
        <div class="flex items-center gap-8" style="flex-wrap:wrap;">
          <label class="checkbox-chip"><input type="checkbox" id="st-repeat" />${t("sales.log.repeat")}</label>
          <label class="checkbox-chip"><input type="checkbox" id="st-referral" />${t("sales.log.referral")}</label>
        </div>
        <p class="ev-field-hint" style="margin-top:8px;">${t("sales.log.flagsHint")}</p>
      </details>
    </div>`;
}

function campaignLinkHTML(brandId, campaign) {
  return campaign
    ? `<a class="card glass-card card-tight st-campaign" href="#/brand/${brandId}/campaigns/${campaign.id}">${icon("target", { size: 16 })}<span><b>${esc(campaign.name)}</b> — ${t("sales.campaign.synced")}</span>${icon("arrowRight", { size: 14 })}</a>`
    : `<a class="card glass-card card-tight st-campaign" href="#/brand/${brandId}/campaigns">${icon("target", { size: 16 })}<span>${t("sales.campaign.none")}</span>${icon("arrowRight", { size: 14 })}</a>`;
}

function trendHTML(tracker, unit, collapsed) {
  const series = weeklySeries(tracker);
  const max = Math.max(1, ...series.map((w) => w.qty));
  if (!series.some((w) => w.qty)) return "";
  if (collapsed.has("trend")) return widgetCollapsedHTML("trend", "chart", t("sales.trend.title"), t("sales.trend.summary", { unit }));
  return widgetCardHTML("trend", "chart", t("sales.trend.title"), `
      <div class="st-trend" style="padding:0;">
        ${series.map((w, i) => `
          <div class="st-bar-col" title="${esc(formatDate(w.from, { year: undefined }))} – ${esc(formatDate(w.to, { year: undefined }))}: ${formatNumber(w.qty)} ${esc(unit)} · ${rp(w.revenue)}">
            <span class="st-bar-val">${w.qty ? formatNumber(w.qty) : ""}</span>
            <span class="st-bar ${i === series.length - 1 ? "is-now" : ""}" style="height:${Math.max(w.qty ? 6 : 2, Math.round((w.qty / max) * 100))}%"></span>
            <span class="st-bar-label">${esc(formatDate(w.from, { year: undefined }))}</span>
          </div>`).join("")}
      </div>
    `, { sub: t("sales.trend.sub", { unit }) });
}

function adviceHTML(tracker, state, collapsed) {
  const lifetime = isLifetime(getCachedAccount());
  const a = tracker.lastAdvice;
  if (collapsed.has("advice")) return widgetCollapsedHTML("advice", "sparkle", t("sales.advice.title"), a ? t("sales.advice.summary", { count: (a.actions || []).length }) : t("sales.advice.summaryEmpty"));
  return widgetCardHTML("advice", "sparkle", `${t("sales.advice.title")}${lifetime ? "" : ` <span class="lifetime-tag">${icon("lock", { size: 11 })}${t("app.lifetimeOnly")}</span>`}`, `
      ${state.adviceBusy
        ? `<div class="ocr-status" style="margin:0;"><div class="spinner"></div><span>${t("sales.advice.busy")}</span></div>`
        : a
        ? `<p class="text-faint" style="font-size:11.5px;margin:0 0 6px;">${t("sales.advice.from", { date: formatDate(localISODate(new Date(a.at))) })}</p>
           ${a.summary ? `<p style="margin:0 0 12px;font-size:13.5px;">${esc(a.summary)}</p>` : ""}
           ${(a.actions || []).map((x, i) => `<div class="st-advice-item"><span class="st-advice-n">${i + 1}</span><div><b>${esc(x.title)}</b>${x.why ? `<span class="st-advice-why">${esc(x.why)}</span>` : ""}${x.how ? `<p>${esc(x.how)}</p>` : ""}</div></div>`).join("")}`
        : `<p class="text-muted" style="font-size:13px;margin:0 0 4px;">${t("sales.advice.intro")}</p>`}
      ${state.adviceError ? `<p class="ev-error">${esc(state.adviceError)}</p>` : ""}
      ${state.adviceBusy ? "" : lifetime
        ? `<button class="btn ${a ? "btn-secondary" : "btn-primary"}" id="st-advice-go" style="margin-top:10px;">${icon("sparkle", { size: 14 })}${a ? t("sales.advice.again") : t("sales.advice.go")}</button>`
        : `<a class="btn btn-secondary" href="#/pricing" style="margin-top:10px;">${icon("lock", { size: 13 })}${t("sales.advice.locked")}</a>`}
      <p class="ev-field-hint" style="margin:10px 0 0;">${t("sales.advice.note")}</p>
    `);
}

function collapseToggleHTML(id, collapsed) {
  return `<button type="button" class="icon-btn" id="${id}" aria-label="${collapsed ? t("sales.section.show") : t("sales.section.hide")}" style="width:30px;height:30px;">${icon(collapsed ? "chevronRight" : "chevronDown", { size: 14 })}</button>`;
}

function productsHTML(stats, campaign, unit, collapsed) {
  const rows = stats.filter((s) => !s.product.archived);
  const archived = stats.filter((s) => s.product.archived);
  if (!rows.length && !archived.length) return `<div class="card glass-card card-tight"><div class="table-empty" style="padding:28px;">${t("sales.products.empty")}</div></div>`;
  if (collapsed) return "";
  const targetOf = (id) => campaign?.goalPlan?.products?.find((p) => p.id === id)?.target || null;
  const row = (s) => {
    const target = targetOf(s.product.id);
    const pct = target ? Math.min(100, Math.round((s.sold / target) * 100)) : 0;
    const discountPct = activeDiscountPct(s.product);
    const priceCell = discountPct
      ? `<s class="text-faint" style="font-size:11.5px;">${rp(s.product.price)}</s> <b>${rp(effectivePrice(s.product))}</b>
         <span class="tag tag-discount" style="display:block;margin-top:4px;width:fit-content;">-${discountPct}%${s.product.discountUntil ? ` · ${t("sales.products.discountUntilBadge", { date: esc(formatDate(s.product.discountUntil, { year: undefined })) })}` : ""}</span>`
      : rp(s.product.price);
    return `
      <tr data-st-edit="${s.product.id}" class="${s.product.archived ? "is-archived" : ""}">
        <td><b>${esc(s.product.name)}</b>${s.product.archived ? ` <span class="tag" style="font-size:10.5px;">${t("sales.products.archived")}</span>` : ""}</td>
        <td>${priceCell}</td>
        <td>${formatNumber(s.rangeQty)}</td>
        <td>${formatNumber(s.sold)}${target ? ` <span class="text-faint">/ ${formatNumber(target)}</span><div class="cd-bar" style="margin-top:5px;max-width:120px;"><span style="width:${pct}%"></span></div>` : ""}</td>
        <td>${rp(s.loggedRevenue)}</td>
        <td style="text-align:right;">${icon("edit", { size: 14 })}</td>
      </tr>`;
  };
  return `
    <div class="table-wrap"><div class="table-scroll"><table class="data-table">
      <thead><tr><th>${t("sales.col.product")}</th><th>${t("sales.col.price")}</th><th>${t("sales.col.month")}</th><th>${t("sales.col.sold", { unit })}</th><th>${t("sales.col.revenue")}</th><th></th></tr></thead>
      <tbody>${[...rows, ...archived].map(row).join("")}</tbody>
    </table></div></div>`;
}

function historyHTML(tracker, state, collapsed, events = []) {
  const byId = Object.fromEntries(tracker.products.map((p) => [p.id, p]));
  const eventById = Object.fromEntries(events.map((ev) => [ev.id, ev]));
  const list = [...tracker.entries].sort((a, b) => (b.date === a.date ? b.at - a.at : b.date < a.date ? -1 : 1));
  const shown = state.showAll ? list : list.slice(0, HISTORY_PAGE);
  if (collapsed) return "";
  return `
    <div class="card glass-card card-tight">
      ${shown.length ? shown.map((e) => `
        <div class="st-entry">
          <span class="st-entry-date">${esc(formatDate(e.date, { year: undefined }))}</span>
          <span class="st-entry-main"><b>${formatNumber(e.qty)}× ${esc(byId[e.productId]?.name || "—")}</b>${e.repeat ? ` <span class="tag">${t("sales.tag.repeat")}</span>` : ""}${e.referral ? ` <span class="tag">${t("sales.tag.referral")}</span>` : ""}${e.eventId && eventById[e.eventId] ? ` <span class="tag">${icon("calendar", { size: 10 })}${esc(eventById[e.eventId].name || "")}</span>` : ""}${e.note ? `<small>${esc(e.note)}</small>` : ""}</span>
          <span class="st-entry-amount">${rp(e.amount)}</span>
          <button class="icon-btn" data-st-delete="${e.id}" aria-label="${t("common.delete")}" style="width:28px;height:28px;">${icon("trash", { size: 13 })}</button>
        </div>`).join("") : `<div class="table-empty" style="padding:28px;">${t("sales.history.empty")}</div>`}
      ${list.length > HISTORY_PAGE ? `<button class="btn btn-ghost btn-block" id="st-history-toggle">${state.showAll ? t("sales.history.less") : t("sales.history.all", { count: list.length })}</button>` : ""}
    </div>`;
}

// ---------- Wiring ----------
function wire(root, brandId, state, refresh, { brand, tracker, campaign, unit }) {
  const productOf = (id) => tracker.products.find((p) => p.id === id);
  const priceOf = (id) => (productOf(id) ? effectivePrice(productOf(id)) : 0);
  const qtyEl = qs("#st-qty", root);
  const amountEl = qs("#st-amount", root);
  const priceNoteEl = qs("#st-price-note", root);
  const autoAmount = () => {
    if (!amountEl || amountEl.dataset.auto !== "1") return;
    amountEl.value = formatNumber(priceOf(state.productId) * Math.max(1, toNum(qtyEl.value) || 1));
  };
  const refreshPriceNote = () => {
    if (!priceNoteEl) return;
    const p = productOf(state.productId);
    const pct = p ? activeDiscountPct(p) : 0;
    priceNoteEl.textContent = pct ? t("sales.log.discountActive", { pct, untilPart: discountUntilPart(p) }) : t("sales.log.amountHint");
  };
  const formatOnInput = (el, after) =>
    el?.addEventListener("input", () => {
      const n = toNum(el.value);
      el.value = n === null ? "" : formatNumber(n);
      after?.();
    });
  formatOnInput(qtyEl, autoAmount);
  formatOnInput(amountEl, () => (amountEl.dataset.auto = amountEl.value === "" ? "1" : "0"));
  qsa("#st-product-chips button", root).forEach((b) =>
    b.addEventListener("click", () => {
      state.productId = b.dataset.val;
      qsa("#st-product-chips button", root).forEach((x) => x.classList.toggle("active", x === b));
      autoAmount();
      refreshPriceNote();
    })
  );
  qs("#st-product", root)?.addEventListener("change", (e) => {
    state.productId = e.target.value;
    autoAmount();
    refreshPriceNote();
  });
  const saveSale = () => {
    const qty = toNum(qtyEl.value);
    if (!state.productId || !qty) {
      toast(t("sales.log.errQty"), "error");
      return;
    }
    const entry = logSale(brandId, {
      productId: state.productId, qty, amount: amountEl.dataset.auto === "1" ? null : toNum(amountEl.value),
      date: qs("#st-date", root)?.value || localISODate(), note: qs("#st-note", root)?.value || "",
      repeat: !!qs("#st-repeat", root)?.checked, referral: !!qs("#st-referral", root)?.checked,
      eventId: qs("#st-event", root)?.value || null,
    });
    if (!entry) return;
    toast(t(campaign ? "sales.log.savedSynced" : "sales.log.saved", { qty: formatNumber(entry.qty), name: tracker.products.find((p) => p.id === entry.productId)?.name || "" }));
    refresh();
  };
  qs("#st-save", root)?.addEventListener("click", saveSale);
  qtyEl?.addEventListener("keydown", (e) => e.key === "Enter" && saveSale());

  qs("#st-add-product", root)?.addEventListener("click", () => openProductModal({ brandId, unit, onSaved: refresh }));
  qs("[data-st-first-product]", root)?.addEventListener("click", () => openProductModal({ brandId, unit, onSaved: refresh }));
  qsa("[data-st-edit]", root).forEach((tr) =>
    tr.addEventListener("click", () => openProductModal({ brandId, unit, product: tracker.products.find((p) => p.id === tr.dataset.stEdit), onSaved: refresh }))
  );
  qsa("[data-st-delete]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const ok = await confirmDialog({ title: t("sales.history.deleteTitle"), message: t("sales.history.deleteBody"), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      deleteSale(brandId, b.dataset.stDelete);
      refresh();
    })
  );
  qs("#st-history-toggle", root)?.addEventListener("click", () => {
    state.showAll = !state.showAll;
    refresh();
  });
  qs("#st-history-clear", root)?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: t("sales.history.clearAllTitle"), message: t("sales.history.clearAllBody", { count: tracker.entries.length }), confirmLabel: t("sales.history.clearAll"), danger: true });
    if (!ok) return;
    clearAllSales(brandId);
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
      const advice = await suggestSalesActions(ai, { brand: fresh, snapshotText: salesSnapshotText(fresh, { unit }), campaigns: listCampaigns(brandId) });
      saveAdvice(brandId, advice);
    } catch (e) {
      state.adviceError = e instanceof AiApiError ? e.message : t("sales.advice.err");
    }
    state.adviceBusy = false;
    refresh();
  });
}

const slug = (s) => String(s || "brand").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

function openProductModal({ brandId, unit, product = null, onSaved }) {
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
        ${field("sp-cost", t("goal.sales.costQ"), product?.cost ?? null, { money: true, optional: true })}
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
    else addProduct(brandId, data);
    closeOverlay(overlay);
    onSaved?.();
  });
  qs("#sp-name", overlay).focus();
}

// ---------- Export ----------
function exportSheets(brand, unit) {
  const tracker = getTracker(brand);
  const byId = Object.fromEntries(tracker.products.map((p) => [p.id, p]));
  const eventById = Object.fromEntries(eventCampaignsForBrand(brand.id).map((ev) => [ev.id, ev]));
  const yesNo = (v) => (v ? t("sales.export.yes") : "");
  const entries = [...tracker.entries].sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1));
  const months = {};
  entries.forEach((e) => {
    const m = (months[e.date.slice(0, 7)] ||= { qty: 0, revenue: 0, count: 0 });
    m.qty += e.qty;
    m.revenue += e.amount;
    m.count += 1;
  });
  return [
    {
      name: t("sales.export.sheetSales"),
      rows: [
        [t("sales.log.date"), t("sales.col.product"), t("sales.export.qty", { unit }), t("sales.export.unitPrice"), t("sales.export.revenue"), t("sales.tag.repeat"), t("sales.tag.referral"), t("sales.log.event"), t("sales.log.note")],
        ...entries.map((e) => [e.date, byId[e.productId]?.name || "—", e.qty, e.qty ? Math.round(e.amount / e.qty) : 0, e.amount, yesNo(e.repeat), yesNo(e.referral), e.eventId ? eventById[e.eventId]?.name || "" : "", e.note || ""]),
      ],
    },
    {
      name: t("sales.export.sheetProducts"),
      rows: [
        [t("sales.col.product"), t("sales.col.price"), t("goal.sales.costQ"), t("sales.export.opening"), t("sales.export.logged"), t("sales.export.totalSold", { unit }), t("sales.export.revenue")],
        ...productStats(tracker).map((s) => [s.product.name, s.product.price, s.product.cost ?? "", s.product.openingSold, s.loggedQty, s.sold, s.loggedRevenue]),
      ],
    },
    {
      name: t("sales.export.sheetMonthly"),
      rows: [
        [t("sales.export.month"), t("sales.export.salesCount"), t("sales.export.qty", { unit }), t("sales.export.revenue")],
        ...Object.keys(months).sort().map((k) => [k, months[k].count, months[k].qty, months[k].revenue]),
      ],
    },
  ];
}
