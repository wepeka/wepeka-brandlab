import { getBrand, listContent, getSettings, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa, toast, formatNumber, formatPercent, formatDate, escapeHtml, avatarHTML } from "../dom.js";

function avg(list) { return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; }

function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }
function endOfWeek(d) { const x = startOfWeek(d); x.setDate(x.getDate() + 6); x.setHours(23, 59, 59, 999); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
// Local calendar date, not UTC — toISOString() shifts across the day
// boundary in any timezone ahead of UTC (e.g. WIB/UTC+7), quietly pulling
// "This Month"/"This Week" ranges back by a day.
function toISODate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export function openReportModal(brandId) {
  const brand = getBrand(brandId);
  if (!brand) return;

  const today = new Date();
  const state = { rangeKey: "month", start: toISODate(startOfMonth(today)), end: toISODate(endOfMonth(today)) };

  const overlay = openModal({
    title: "Generate Report",
    bodyHTML: `<div id="report-range-picker">${rangePickerHTML(state)}</div>`,
    footHTML: `
      <button class="btn btn-secondary" id="report-cancel">Cancel</button>
      <button class="btn btn-primary" id="report-generate">${icon("check", { size: 15 })}Generate</button>
    `,
    onMount: (el) => wireRangePicker(el, state),
  });

  overlay.querySelector("#report-cancel").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("#report-generate").addEventListener("click", () => {
    closeOverlay(overlay);
    openReportPreview(brand, state.start, state.end);
  });
}

// "Overall" isn't a real date range — it's just wide enough (year 2000
// onward) to include everything a brand could realistically have, so it
// can reuse the exact same start/end filtering as every other range
// instead of needing a separate "no filter" code path.
const OVERALL_START = "2000-01-01";
function rangeLabel(start, end) {
  return start === OVERALL_START ? "All time" : `${formatDate(start)} – ${formatDate(end)}`;
}

function rangePickerHTML(state) {
  return `
    <div class="chip-select" style="margin-bottom:18px;">
      <button data-range="week" class="${state.rangeKey === "week" ? "active" : ""}">This Week</button>
      <button data-range="month" class="${state.rangeKey === "month" ? "active" : ""}">This Month</button>
      <button data-range="overall" class="${state.rangeKey === "overall" ? "active" : ""}">Overall</button>
      <button data-range="custom" class="${state.rangeKey === "custom" ? "active" : ""}">Custom</button>
    </div>
    <div id="report-range-inputs" class="row-2" style="${state.rangeKey === "custom" ? "" : "display:none;"}">
      <div class="field" style="margin-bottom:0;"><label>Start</label><input class="input" type="date" id="report-start" value="${state.start}" /></div>
      <div class="field" style="margin-bottom:0;"><label>End</label><input class="input" type="date" id="report-end" value="${state.end}" /></div>
    </div>
    <p class="text-muted" style="font-size:12.5px;margin:${state.rangeKey === "custom" ? "0" : "14px 0 0"};" id="report-range-summary">
      ${state.rangeKey === "custom" ? "" : state.rangeKey === "overall" ? "All time — everything ever published" : `${formatDate(state.start)} – ${formatDate(state.end)}`}
    </p>
  `;
}

function wireRangePicker(el, state) {
  const today = new Date();
  qsa("[data-range]", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.rangeKey = btn.dataset.range;
      if (state.rangeKey === "week") { state.start = toISODate(startOfWeek(today)); state.end = toISODate(endOfWeek(today)); }
      else if (state.rangeKey === "month") { state.start = toISODate(startOfMonth(today)); state.end = toISODate(endOfMonth(today)); }
      else if (state.rangeKey === "overall") { state.start = OVERALL_START; state.end = toISODate(today); }
      qs("#report-range-picker", el).innerHTML = rangePickerHTML(state);
      wireRangePicker(el, state);
    });
  });
  const startInput = qs("#report-start", el);
  const endInput = qs("#report-end", el);
  if (startInput) startInput.addEventListener("change", () => { state.start = startInput.value; });
  if (endInput) endInput.addEventListener("change", () => { state.end = endInput.value; });
}

function openReportPreview(brand, start, end) {
  const overlay = openModal({
    title: "Report Preview",
    wide: true,
    bodyHTML: `<div class="report-preview-wrap"><div class="report-sheet" id="report-sheet">${reportSheetHTML(brand, start, end)}</div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="report-share">${icon("link", { size: 14 })}Share</button>
      <button class="btn btn-secondary" id="report-print">${icon("layers", { size: 14 })}Print</button>
      <button class="btn btn-primary" id="report-download">${icon("download", { size: 14 })}Download PDF</button>
    `,
  });

  const doPrint = () => window.print();
  overlay.querySelector("#report-print").addEventListener("click", doPrint);
  overlay.querySelector("#report-download").addEventListener("click", () => {
    toast('In the print dialog, choose "Save as PDF" as the destination.');
    setTimeout(doPrint, 400);
  });
  overlay.querySelector("#report-share").addEventListener("click", async () => {
    const summary = reportSummaryText(brand, start, end);
    if (navigator.share) {
      try {
        await navigator.share({ title: `${brand.name} — Performance Report`, text: summary });
      } catch {
        /* user cancelled share sheet — no-op */
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(summary);
        toast("Report summary copied to clipboard");
      } catch {
        toast("Couldn't access the clipboard — try Print or Download instead.", "error");
      }
    } else {
      toast("Sharing isn't supported in this browser — try Print or Download instead.", "error");
    }
  });
}

function computeReportData(brand, start, end) {
  const settings = getSettings();
  const inRange = listContent(brand.id).filter((c) => {
    const d = c.publishedDate || c.scheduleDate;
    return d && d >= start && d <= end;
  });
  const withMetrics = inRange.map((c) => ({ c, m: computeContentMetrics(c, settings) }));
  const published = withMetrics.filter((x) => x.c.status === "published");

  const views = published.map((x) => x.c.performance.views).filter((v) => v != null);
  const reach = published.map((x) => x.c.performance.reach).filter((v) => v != null);
  const ers = withMetrics.map((x) => x.m.engagementRate).filter((v) => v != null);
  const fcrs = withMetrics.map((x) => x.m.followerConversionRate).filter((v) => v != null);

  const healthEvaluated = published.filter((x) => x.m.health);
  const healthyPct = healthEvaluated.length ? (healthEvaluated.filter((x) => x.m.health === "good").length / healthEvaluated.length) * 100 : null;

  const funnelStats = FUNNELS.map((f) => {
    const items = withMetrics.filter((x) => x.c.funnel === f);
    return {
      funnel: f,
      count: items.length,
      avgER: avg(items.map((x) => x.m.engagementRate).filter((v) => v != null)),
      avgFCR: avg(items.map((x) => x.m.followerConversionRate).filter((v) => v != null)),
    };
  });

  const top = published
    .filter((x) => x.c.performance.views)
    .sort((a, b) => (b.c.performance.views || 0) - (a.c.performance.views || 0))
    .slice(0, 5);

  return {
    totalContent: inRange.length,
    publishedCount: published.length,
    totalViews: views.reduce((a, b) => a + b, 0),
    totalReach: reach.reduce((a, b) => a + b, 0),
    avgER: avg(ers),
    avgFCR: avg(fcrs),
    healthyPct,
    funnelStats,
    top,
  };
}

function reportSheetHTML(brand, start, end) {
  const d = computeReportData(brand, start, end);
  return `
    <div class="report-header">
      ${avatarHTML(brand, "width:52px;height:52px;border-radius:12px;font-size:20px;")}
      <div>
        <div class="report-brand">${escapeHtml(brand.name)}</div>
        <div class="report-title">Performance Report</div>
      </div>
      <div class="report-range">
        <div>${rangeLabel(start, end)}</div>
        <div class="report-generated">Generated ${formatDate(new Date().toISOString())}</div>
      </div>
    </div>

    <div class="report-stat-grid">
      ${reportStat("Content Published", d.publishedCount)}
      ${reportStat("Total Views", formatNumber(d.totalViews))}
      ${reportStat("Total Reach", formatNumber(d.totalReach))}
      ${reportStat("Avg. Engagement Rate", formatPercent(d.avgER))}
      ${reportStat("Avg. Follower Conversion", formatPercent(d.avgFCR))}
      ${reportStat("Healthy Content", d.healthyPct === null ? "—" : formatPercent(d.healthyPct, 0))}
    </div>

    <div class="report-section-title">Performance by Funnel</div>
    <table class="report-table">
      <thead><tr><th>Funnel</th><th>Content</th><th>Avg. Engagement</th><th>Avg. Follower Conv.</th></tr></thead>
      <tbody>
        ${d.funnelStats.map((f) => `<tr><td>${f.funnel}</td><td>${f.count}</td><td>${formatPercent(f.avgER)}</td><td>${formatPercent(f.avgFCR)}</td></tr>`).join("")}
      </tbody>
    </table>

    <div class="report-section-title">Top Performing Content</div>
    ${
      d.top.length
        ? `<table class="report-table">
            <thead><tr><th>#</th><th>Title</th><th>Platform</th><th>Views</th><th>Engagement</th><th>Health</th></tr></thead>
            <tbody>
              ${d.top
                .map(
                  (x, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(x.c.title || "Untitled")}</td><td>${escapeHtml(x.c.platform || "—")}</td><td>${formatNumber(x.c.performance.views)}</td><td>${formatPercent(x.m.engagementRate)}</td><td>${x.m.health ? HEALTH_LABEL[x.m.health] : "—"}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : `<p class="report-empty">No published content with views in this period.</p>`
    }

    <div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand.name)}</div>
  `;
}

function reportSummaryText(brand, start, end) {
  const d = computeReportData(brand, start, end);
  return [
    `${brand.name} — Performance Report`,
    rangeLabel(start, end),
    "",
    `Content published: ${d.publishedCount}`,
    `Total views: ${formatNumber(d.totalViews)}`,
    `Total reach: ${formatNumber(d.totalReach)}`,
    `Avg. engagement rate: ${formatPercent(d.avgER)}`,
    `Avg. follower conversion: ${formatPercent(d.avgFCR)}`,
    `Healthy content: ${d.healthyPct === null ? "—" : formatPercent(d.healthyPct, 0)}`,
  ].join("\n");
}

function reportStat(label, value) {
  return `<div class="report-stat"><div class="report-stat-label">${label}</div><div class="report-stat-value">${value}</div></div>`;
}
