// Advanced-mode Home's "grafik2 dan stats analytics" — a customizable set of
// chart/stat widgets, separate from the plain "what do I do next" widgets in
// brand-home.js itself. Lives in its own file because it's a genuinely
// different concern (derived performance analytics vs. brand-progress
// shortcuts) and because the widget catalog + chart drawing needs room to
// grow without bloating brand-home.js's paint().
import { getSettings, updateSettings, FUNNELS } from "../store.js";
import { computeContentMetrics } from "../formulas.js";
import { formatNumber, formatPercent, qs, qsa, openMenu, escapeHtml as escapeText } from "../dom.js";
import { icon } from "../icons.js";
import { t } from "../i18n.js";

export const WIDGET_CATALOG = [
  { key: "growthViews", labelKey: "brandHome.analytics.widget.growthViews" },
  { key: "growthEngagement", labelKey: "brandHome.analytics.widget.growthEngagement" },
  { key: "topContent", labelKey: "brandHome.analytics.widget.topContent" },
  { key: "platformBreakdown", labelKey: "brandHome.analytics.widget.platformBreakdown" },
  { key: "formatBreakdown", labelKey: "brandHome.analytics.widget.formatBreakdown" },
  { key: "funnelBreakdown", labelKey: "brandHome.analytics.widget.funnelBreakdown" },
  { key: "contentHealth", labelKey: "brandHome.analytics.widget.contentHealth" },
];
export const DEFAULT_HOME_WIDGETS = WIDGET_CATALOG.map((w) => w.key);
const WIDGET_KEYS = new Set(DEFAULT_HOME_WIDGETS);

// Stored order IS display order (see updateSettings calls below) — a widget
// missing from the saved array just isn't shown, so re-enabling one always
// appends it at the end rather than trying to remember its old slot.
function enabledWidgets() {
  const saved = getSettings().homeWidgets;
  const valid = Array.isArray(saved) ? saved.filter((k) => WIDGET_KEYS.has(k)) : null;
  return valid && valid.length ? valid : DEFAULT_HOME_WIDGETS;
}

// Monday-start week bucket, so "this week" always groups the same regardless
// of which day someone happens to open the app.
function weekStart(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

function shortDate(d) {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// Each bucket carries its own boundaries (as a string key, since Top
// Performing Content's period <select> needs to round-trip a plain string
// value) so the same 8-week window backs both the trend charts and the "which
// week" filter on Top Performing Content — one source of truth for "what
// counts as this week" instead of two slightly different definitions.
function buildWeeklyBuckets(withMetricsPublished, weeks = 8) {
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10)).getTime();
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    buckets.push({
      key: String(start.getTime()),
      startTime: start.getTime(),
      label: shortDate(start),
      rangeLabel: `${shortDate(start)}–${shortDate(end)}`,
      views: 0,
      erSum: 0,
      erCount: 0,
      items: [],
    });
  }
  const byTime = new Map(buckets.map((b) => [b.startTime, b]));
  withMetricsPublished.forEach((x) => {
    const dateStr = x.c.publishedDate || x.c.scheduleDate;
    if (!dateStr) return;
    const bucket = byTime.get(weekStart(dateStr).getTime());
    if (!bucket) return;
    bucket.views += x.c.performance?.views || 0;
    bucket.items.push(x);
    if (x.m.engagementRate !== null) {
      bucket.erSum += x.m.engagementRate;
      bucket.erCount++;
    }
  });
  return buckets.map((b) => ({ ...b, avgER: b.erCount ? b.erSum / b.erCount : 0 }));
}

// Small area+line chart, no library — themed entirely off CSS variables so
// it matches whichever theme (light/dark) is active without extra wiring.
// Only the first, middle, and last x-axis ticks are labeled to keep 8 weeks
// of labels from overlapping into noise.
function trendChartSVG(points, { valueFormatter = (v) => v } = {}) {
  if (!points.length || points.every((p) => p.value === 0)) return "";
  const width = 600, height = 140;
  const padL = 4, padR = 4, padT = 22, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const vals = points.map((p) => p.value);
  const max = Math.max(...vals, 0.0001);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + i * stepX,
    y: padT + innerH - ((p.value - min) / range) * innerH,
    ...p,
  }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const last = coords[coords.length - 1];
  const tickIdxs = new Set([0, Math.floor((coords.length - 1) / 2), coords.length - 1]);
  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;display:block;">
      <line x1="${padL}" y1="${(padT + innerH).toFixed(1)}" x2="${width - padR}" y2="${(padT + innerH).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
      <path d="${area}" fill="var(--accent-soft)" stroke="none"/>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="var(--accent)"/>
      <text x="${last.x.toFixed(1)}" y="${Math.max(12, last.y - 10).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="var(--text)">${escapeText(valueFormatter(last.value))}</text>
      ${coords
        .filter((_, i) => tickIdxs.has(i))
        .map((c) => `<text x="${c.x.toFixed(1)}" y="${height - 6}" font-size="10" fill="var(--text-faint)" text-anchor="middle">${escapeText(c.label)}</text>`)
        .join("")}
    </svg>
  `;
}

function barRow(label, value, max) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return `
    <div class="bar-row">
      <div class="bl">${escapeText(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-val">${formatPercent(value)}</div>
    </div>
  `;
}

function emptyHTML(key) {
  return `<div class="table-empty" style="padding:24px;">${t(`brandHome.analytics.empty.${key}`)}</div>`;
}

// Every widget card is draggable by its grip handle (native HTML5 DnD, wired
// in wireAnalyticsSection) and carries data-widget-key so a drop handler can
// read the new order straight off the DOM — no separate index bookkeeping.
function widgetShellHTML(key, labelKey, bodyHTML, headerExtraHTML = "") {
  return `
    <div class="card card-tight brand-analytics-card" data-widget-key="${key}">
      <div class="brand-analytics-card-head">
        <div class="brand-analytics-card-title-row">
          <span class="brand-analytics-drag-handle" draggable="true" data-drag-handle title="${t("brandHome.analytics.dragHint")}">${icon("grip", { size: 14 })}</span>
          <div class="brand-analytics-card-title">${t(labelKey)}</div>
        </div>
        ${headerExtraHTML}
      </div>
      ${bodyHTML}
    </div>
  `;
}

function periodSelectHTML(periodOptions, selected) {
  return `
    <select class="select" data-top-content-period style="width:auto;padding:5px 28px 5px 10px;font-size:12px;border-radius:8px;">
      ${periodOptions.map((o) => `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${escapeText(o.label)}</option>`).join("")}
    </select>
  `;
}

function widgetHTML(key, data) {
  switch (key) {
    case "growthViews": {
      const svg = trendChartSVG(
        data.trend.map((b) => ({ value: b.views, label: b.label })),
        { valueFormatter: (v) => formatNumber(v) }
      );
      return widgetShellHTML(key, "brandHome.analytics.widget.growthViews", svg || emptyHTML("trend"));
    }
    case "growthEngagement": {
      const svg = trendChartSVG(
        data.trend.map((b) => ({ value: b.avgER, label: b.label })),
        { valueFormatter: (v) => formatPercent(v) }
      );
      return widgetShellHTML(key, "brandHome.analytics.widget.growthEngagement", svg || emptyHTML("trend"));
    }
    case "topContent": {
      const body = data.topContent.length
        ? data.topContent
            .map(
              (x, i) => `
        <div class="top-content-row" data-open-content="${x.c.id}" style="cursor:pointer;">
          <div class="rank">${i + 1}</div>
          <div class="ti">
            <div class="t">${escapeText(x.c.title || t("common.untitled"))}</div>
            <div class="m">${t("bha.views", { count: formatNumber(x.c.performance.views) })}${x.m.engagementRate !== null ? ` · ${formatPercent(x.m.engagementRate)} ER` : ""}</div>
          </div>
          ${x.m.health ? `<span class="health-badge health-${x.m.health}"><span class="health-dot"></span></span>` : ""}
        </div>`
            )
            .join("")
        : emptyHTML("topContent");
      return widgetShellHTML(key, "brandHome.analytics.widget.topContent", body, periodSelectHTML(data.periodOptions, data.selectedPeriod));
    }
    case "platformBreakdown": {
      if (!data.platformRows.length) return widgetShellHTML(key, "brandHome.analytics.widget.platformBreakdown", emptyHTML("breakdown"));
      const max = Math.max(1, ...data.platformRows.map((r) => r.avg));
      return widgetShellHTML(key, "brandHome.analytics.widget.platformBreakdown", data.platformRows.map((r) => barRow(r.platform, r.avg, max)).join(""));
    }
    case "formatBreakdown": {
      if (!data.formatRows.length) return widgetShellHTML(key, "brandHome.analytics.widget.formatBreakdown", emptyHTML("breakdown"));
      const max = Math.max(1, ...data.formatRows.map((r) => r.avg));
      return widgetShellHTML(key, "brandHome.analytics.widget.formatBreakdown", data.formatRows.map((r) => barRow(r.format, r.avg, max)).join(""));
    }
    case "funnelBreakdown": {
      const withData = FUNNELS.map((f) => ({ funnel: f, ...data.funnelStats[f] })).filter((f) => f.avgER !== null);
      if (!withData.length) return widgetShellHTML(key, "brandHome.analytics.widget.funnelBreakdown", emptyHTML("breakdown"));
      const max = Math.max(1, ...withData.map((f) => f.avgER));
      return widgetShellHTML(key, "brandHome.analytics.widget.funnelBreakdown", withData.map((f) => barRow(f.funnel, f.avgER, max)).join(""));
    }
    case "contentHealth": {
      if (!data.evaluated) return widgetShellHTML(key, "brandHome.analytics.widget.contentHealth", emptyHTML("health"));
      const { good, average, poor } = data.healthCounts;
      const seg = (n, color) => `<div style="width:${Math.round((n / data.evaluated) * 100)}%;background:var(--health-${color});height:100%;"></div>`;
      return widgetShellHTML(
        key,
        "brandHome.analytics.widget.contentHealth",
        `
        <div style="display:flex;height:12px;border-radius:999px;overflow:hidden;margin-bottom:14px;">${seg(good, "good")}${seg(average, "average")}${seg(poor, "poor")}</div>
        <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-good);display:inline-block;margin-right:6px;"></span>${t("dashboard.healthy")}</span><span class="v">${good}</span></div>
        <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-average);display:inline-block;margin-right:6px;"></span>${t("dashboard.average")}</span><span class="v">${average}</span></div>
        <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-poor);display:inline-block;margin-right:6px;"></span>${t("dashboard.underperforming")}</span><span class="v">${poor}</span></div>
      `
      );
    }
    default:
      return "";
  }
}

// `state.topContentPeriod` is ephemeral view state (like a table's sort
// column elsewhere in this app) — it lives in brand-home.js's closure, not in
// Firestore settings, since "which week am I looking at" isn't a preference
// worth persisting the way widget on/off + order are.
export function analyticsSectionHTML(content, settings, state) {
  const published = content.filter((c) => c.status === "published");
  const withMetrics = published.map((c) => ({ c, m: computeContentMetrics(c, settings) }));
  const keys = enabledWidgets();

  if (!published.length) {
    return `
      <div class="section-title">
        <h2>${t("brandHome.analytics.title")}</h2>
        ${customizeButtonHTML()}
      </div>
      <div class="card card-tight" style="margin-bottom:28px;">${emptyHTML("noPublished")}</div>
    `;
  }

  const buckets = buildWeeklyBuckets(withMetrics);
  const trend = buckets.map((b) => ({ label: b.label, views: b.views, avgER: b.avgER }));

  const periodOptions = [
    { value: "all", label: t("brandHome.analytics.periodAll") },
    ...[...buckets].reverse().map((b) => ({ value: b.key, label: b.rangeLabel })),
  ];
  const requestedPeriod = state?.topContentPeriod || "all";
  const selectedPeriod = periodOptions.some((o) => o.value === requestedPeriod) ? requestedPeriod : "all";
  const topContentPool = selectedPeriod === "all" ? withMetrics : buckets.find((b) => b.key === selectedPeriod)?.items || [];

  const topContent = [...topContentPool]
    .filter((x) => x.c.performance.views)
    .sort((a, b) => (b.c.performance.views || 0) - (a.c.performance.views || 0))
    .slice(0, 5);

  const platformStats = {};
  withMetrics.forEach((x) => {
    if (x.m.engagementRate === null) return;
    const p = x.c.platform || t("bha.otherPlatform");
    (platformStats[p] = platformStats[p] || []).push(x.m.engagementRate);
  });
  const platformRows = Object.entries(platformStats)
    .map(([platform, list]) => ({ platform, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);

  const formatStats = {};
  withMetrics.forEach((x) => {
    if (x.m.engagementRate === null) return;
    const f = x.c.format || t("bha.unspecifiedFormat");
    (formatStats[f] = formatStats[f] || []).push(x.m.engagementRate);
  });
  const formatRows = Object.entries(formatStats)
    .map(([format, list]) => ({ format, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);

  const funnelStats = {};
  FUNNELS.forEach((f) => {
    const items = withMetrics.filter((x) => x.c.funnel === f);
    const ers = items.map((x) => x.m.engagementRate).filter((v) => v !== null);
    funnelStats[f] = { avgER: ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null };
  });

  const healthCounts = { good: 0, average: 0, poor: 0, none: 0 };
  withMetrics.forEach((x) => { healthCounts[x.m.health || "none"]++; });
  const evaluated = healthCounts.good + healthCounts.average + healthCounts.poor;

  const data = { trend, topContent, periodOptions, selectedPeriod, platformRows, formatRows, funnelStats, healthCounts, evaluated };

  return `
    <div class="section-title">
      <h2>${t("brandHome.analytics.title")}</h2>
      ${customizeButtonHTML()}
    </div>
    ${
      keys.length
        ? `<div class="brand-analytics-grid" style="margin-bottom:28px;">${keys.map((k) => widgetHTML(k, data)).join("")}</div>`
        : `<div class="card card-tight" style="margin-bottom:28px;">${emptyHTML("noWidgets")}</div>`
    }
  `;
}

function customizeButtonHTML() {
  return `<button type="button" class="btn btn-secondary btn-sm" id="home-analytics-customize">${icon("filter", { size: 13 })}${t("brandHome.analytics.customize")}</button>`;
}

export function wireAnalyticsSection(root, state, refresh) {
  wireCustomizeMenu(root);

  const periodSelect = qs("[data-top-content-period]", root);
  if (periodSelect && state) {
    periodSelect.addEventListener("change", (e) => {
      state.topContentPeriod = e.target.value;
      refresh();
    });
  }

  wireDragReorder(root);
}

function wireCustomizeMenu(root) {
  const btn = qs("#home-analytics-customize", root);
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(btn, { top: rect.bottom + 6, right: window.innerWidth - rect.right });
    if (!menu) return;
    const current = new Set(enabledWidgets());
    menu.innerHTML = `
      <div style="padding:6px 14px 8px;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--text-faint);">${t("brandHome.analytics.customizeHint")}</div>
      ${WIDGET_CATALOG.map(
        (w) => `
        <label class="menu-checkbox-row">
          <input type="checkbox" data-home-widget="${w.key}" ${current.has(w.key) ? "checked" : ""} />
          ${t(w.labelKey)}
        </label>`
      ).join("")}
    `;
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    qsa("[data-home-widget]", menu).forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.homeWidget;
        // Preserve whatever order is already saved (which may include a
        // custom drag order) instead of resetting to the catalog's fixed
        // order — re-enabling a widget just appends it at the end.
        let order = [...enabledWidgets()];
        if (cb.checked) {
          if (!order.includes(key)) order.push(key);
        } else {
          order = order.filter((k) => k !== key);
        }
        updateSettings({ homeWidgets: order });
      });
    });
  });
}

// Native HTML5 drag-and-drop, no library — each card's grip handle is the
// draggable element (so grabbing the chart/rows inside a card doesn't start
// a drag), but the whole card is what moves, via setDragImage. Dropping
// reads the final DOM order straight off data-widget-key and saves it, so
// the next paint() just renders in that order — no separate index state to
// keep in sync.
function wireDragReorder(root) {
  const grid = qs(".brand-analytics-grid", root);
  if (!grid) return;

  qsa("[data-drag-handle]", grid).forEach((handle) => {
    handle.addEventListener("dragstart", (e) => {
      const card = handle.closest("[data-widget-key]");
      if (!card) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.dataset.widgetKey);
      e.dataTransfer.setDragImage(card, 24, 24);
      requestAnimationFrame(() => card.classList.add("dragging"));
    });
    handle.addEventListener("dragend", () => {
      handle.closest("[data-widget-key]")?.classList.remove("dragging");
    });
  });

  grid.addEventListener("dragover", (e) => {
    const dragging = grid.querySelector(".dragging");
    if (!dragging) return;
    e.preventDefault();
    const after = getDragAfterElement(grid, e.clientX, e.clientY, dragging);
    if (after == null) grid.appendChild(dragging);
    else if (after !== dragging) grid.insertBefore(dragging, after);
  });

  grid.addEventListener("drop", (e) => {
    if (!grid.querySelector(".dragging")) return;
    e.preventDefault();
    const order = qsa("[data-widget-key]", grid).map((c) => c.dataset.widgetKey);
    updateSettings({ homeWidgets: order });
  });
}

// Nearest-center heuristic (works for a wrapping grid, not just a single
// column): find whichever card's center the cursor is closest to, then
// decide before/after that card by which half of it the cursor is on.
function getDragAfterElement(grid, x, y, dragging) {
  const candidates = qsa("[data-widget-key]", grid).filter((el) => el !== dragging);
  let closest = null;
  let closestDist = Infinity;
  candidates.forEach((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = { el, isAfter: x > cx };
    }
  });
  if (!closest) return null;
  return closest.isAfter ? closest.el.nextElementSibling : closest.el;
}
