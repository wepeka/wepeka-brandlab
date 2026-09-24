// The brand report — one tidy PDF of everything that happened in a period:
// content and its numbers, followers, sales (and where they came from),
// campaign progress, what's scheduled next, what the brand learned, and the
// one thing to do next. Opened from the Home page head (and the Konten
// list's menu); a weekly nudge on Home asks for it when a week has passed
// (brand.lastReportAt, set when a PDF is downloaded).
//
// The PDF is a real file (js/pdf-libs.js: html2canvas + jsPDF): the sheet
// is laid out as A4 portrait pages from whole blocks — a table or a stat
// row is never cut across a page — then each page is rasterized.
import { getBrand, listContent, listCampaigns, getSettings, updateBrand, organicViews, FUNNELS, localISODate } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { campaignStages, activeStageIndex, readStage, campaignHeadline } from "../campaign-metrics.js";
import { getTracker } from "../sales-tracker.js";
import { brandTopAction } from "../next-action.js";
import { postingLine, bestPostsLine, lessonsOf } from "../brand-learning.js";
import { ensurePdfLibs } from "../pdf-libs.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa, toast, formatNumber, formatPercent, formatDate, escapeHtml as esc, avatarHTML } from "../dom.js";
import { t } from "../i18n.js";
import { funnelShort } from "../funnel-field.js";

const DAY = 86400000;
const OVERALL_START = "2000-01-01";
export const REPORT_EVERY_DAYS = 7;
const A4_W = 794; // px at 96dpi
const A4_H = 1123;

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const iso = (d) => localISODate(d);
const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;

function rangeFor(key, today = new Date()) {
  if (key === "week") return { start: iso(new Date(today.getTime() - 6 * DAY)), end: iso(today) };
  if (key === "month") return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  if (key === "overall") return { start: OVERALL_START, end: iso(today) };
  return null;
}
const rangeLabel = (start, end) => (start === OVERALL_START ? t("rep.range.overall") : `${formatDate(start)} – ${formatDate(end)}`);

// ---------- The numbers ----------

export function computeReportData(brand, start, end) {
  const settings = getSettings();
  const content = listContent(brand.id);
  const inRange = content.filter((c) => {
    const d = c.publishedDate || c.scheduleDate;
    return d && d >= start && d <= end;
  });
  const withMetrics = inRange.map((c) => ({ c, m: computeContentMetrics(c, settings) }));
  const published = withMetrics.filter((x) => x.c.status === "published");
  const views = published.map((x) => organicViews(x.c)).filter((v) => v != null);
  const reach = published.map((x) => x.c.performance?.reach).filter((v) => v != null);
  const ers = published.map((x) => x.m.engagementRate).filter((v) => v != null);
  const fcrs = published.map((x) => x.m.followerConversionRate).filter((v) => v != null);
  const healthEvaluated = published.filter((x) => x.m.health);
  const healthyPct = healthEvaluated.length ? (healthEvaluated.filter((x) => x.m.health === "good").length / healthEvaluated.length) * 100 : null;
  const funnelStats = FUNNELS.map((f) => {
    const items = published.filter((x) => x.c.funnel === f);
    return { funnel: f, count: items.length, avgER: avg(items.map((x) => x.m.engagementRate).filter((v) => v != null)) };
  });
  const top = published.filter((x) => organicViews(x.c)).sort((a, b) => organicViews(b.c) - organicViews(a.c)).slice(0, 5);

  // Followers: the latest number in the period vs the last one before it.
  const followers = [];
  const byPlatform = new Map();
  (brand.insightsHistory || []).forEach((h) => {
    if (h.followers === null || h.followers === undefined || !h.platform) return;
    if (!byPlatform.has(h.platform)) byPlatform.set(h.platform, []);
    byPlatform.get(h.platform).push(h);
  });
  const endMs = new Date(end + "T23:59:59").getTime();
  const startMs = new Date(start + "T00:00:00").getTime();
  for (const [platform, list] of byPlatform) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const now = [...sorted].reverse().find((h) => h.at <= endMs);
    const before = [...sorted].reverse().find((h) => h.at < startMs);
    if (now) followers.push({ platform, now: now.followers, delta: before ? now.followers - before.followers : null });
  }

  // Sales in the period.
  const tracker = getTracker(brand);
  const entries = tracker.entries.filter((e) => e.date >= start && e.date <= end);
  const productName = (id) => tracker.products.find((p) => p.id === id)?.name || "—";
  const byProduct = new Map();
  entries.forEach((e) => {
    const r = byProduct.get(e.productId) || { name: productName(e.productId), qty: 0, revenue: 0 };
    r.qty += e.qty; r.revenue += e.amount;
    byProduct.set(e.productId, r);
  });
  const campaigns = listCampaigns(brand.id);
  const sourceName = (e) => {
    if (e.source?.contentId) return content.find((c) => c.id === e.source.contentId)?.title || "";
    const id = e.source?.campaignId || e.eventId;
    return id ? campaigns.find((c) => c.id === id)?.name || "" : "";
  };
  const bySource = new Map();
  entries.forEach((e) => {
    const name = sourceName(e);
    if (!name) return;
    const r = bySource.get(name) || { name, qty: 0, revenue: 0 };
    r.qty += e.qty; r.revenue += e.amount;
    bySource.set(name, r);
  });
  const sales = {
    count: entries.length,
    qty: entries.reduce((a, e) => a + e.qty, 0),
    revenue: entries.reduce((a, e) => a + e.amount, 0),
    products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    sources: [...bySource.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 4),
  };

  // Campaigns: where each running one stands today.
  const ctxBase = { brand, content, settings };
  const campaignRows = campaigns
    .filter((c) => !["archived", "completed"].includes(c.status))
    .map((c) => {
      const stages = campaignStages(c);
      const idx = activeStageIndex(c, stages, content);
      const stage = stages[idx];
      if (!stage) return { name: c.name, stage: "—", met: 0, total: 0, head: "" };
      const ctx = { ...ctxBase, campaign: c };
      const { met, total } = readStage(stage, ctx);
      const head = campaignHeadline(c, stages, idx, ctx);
      const headText = head && head.reading?.target && !head.reading.isCheck ? `${head.milestone.label}: ${formatNumber(head.reading.current)}/${formatNumber(head.reading.target)}` : "";
      return { name: c.name, stage: stage.name, met, total, head: headText };
    });

  // Next two weeks from the report's end.
  const upcoming = content
    .filter((c) => c.status !== "published" && c.scheduleDate && c.scheduleDate > end && c.scheduleDate <= iso(new Date(new Date(end + "T12:00:00").getTime() + 14 * DAY)))
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate))
    .slice(0, 8);

  // What the brand noted and learned in the period.
  const moments = (brand.developmentLog || []).filter((m) => m.source === "moment" && m.at >= startMs && m.at <= endMs).sort((a, b) => b.at - a.at).slice(0, 6);
  const lessons = lessonsOf(brand).slice(0, 2);

  const top1 = brandTopAction({ brand, campaigns, content, settings });
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
    followers,
    sales,
    campaignRows,
    upcoming,
    moments,
    lessons,
    highlights: [postingLine(content, settings, new Date(), { withBest: false }), bestPostsLine(content, settings)].filter(Boolean),
    next: top1 ? { title: top1.action.label, why: top1.action.why } : null,
  };
}

// ---------- The sheet: blocks, packed into A4 pages for the PDF ----------
//
// Designed like a small printed report: a dark cover band with the Wepeka
// Brandlab mark, big numbers with the change against the period before,
// numbered sections, bars instead of bare tables, and a footer with the
// mark and page number on every PDF page. The brand's own colour (Edit
// Brand → colour) is the accent; Brandlab orange when it has none.

const BRANDLAB_ORANGE = "#ffa52b";
const FUNNEL_COLOR = { TOFU: "#3b82f6", MOFU: "#a855f7", BOFU: "#f97316" };
const accentOf = (brand) => (/^#[0-9a-f]{6}$/i.test(brand?.color || "") ? brand.color : BRANDLAB_ORANGE);

// The period before, same length — what the big numbers compare against.
function previousRange(start, end) {
  if (start === OVERALL_START) return null;
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  const days = Math.round((e - s) / DAY) + 1;
  return { start: iso(new Date(s.getTime() - days * DAY)), end: iso(new Date(s.getTime() - DAY)), days };
}
function deltaChip(now, before, { points = false } = {}) {
  if (before === null || before === undefined || now === null || now === undefined) return "";
  let txt;
  let up;
  if (points) {
    const diff = now - before;
    if (Math.abs(diff) < 0.05) return `<span class="rp2-delta is-flat">${t("rep2.same")}</span>`;
    up = diff > 0;
    txt = `${up ? "▲ +" : "▼ −"}${t("rep2.points", { n: Math.abs(diff).toFixed(1) })}`;
  } else {
    if (!before) return now ? `<span class="rp2-delta is-up">${t("rep2.new")}</span>` : "";
    const pct = Math.round(((now - before) / before) * 100);
    if (!pct) return `<span class="rp2-delta is-flat">${t("rep2.same")}</span>`;
    up = pct > 0;
    txt = `${up ? "▲" : "▼"} ${Math.abs(pct)}%`;
  }
  return `<span class="rp2-delta ${up ? "is-up" : "is-down"}">${txt}</span>`;
}
const secHead = (n, title, sub = "") => `
  <div class="rp2-sec"><span class="rp2-sec-n">${String(n).padStart(2, "0")}</span><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ""}</div><span class="rp2-sec-line"></span></div>`;
const bar = (value, max, color) => `<span class="rp2-bar"><span style="width:${max ? Math.max(3, Math.round((value / max) * 100)) : 0}%;background:${color}"></span></span>`;
function shortNum(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, "").replace(".", ",")}jt`;
  if (v >= 10000) return `${Math.round(v / 1000)}rb`;
  return formatNumber(v);
}

function reportBlocks(brand, start, end) {
  const d = computeReportData(brand, start, end);
  const prevR = previousRange(start, end);
  const p = prevR ? computeReportData(brand, prevR.start, prevR.end) : null;
  const accent = accentOf(brand);
  const days = prevR ? prevR.days : null;
  const blocks = [];
  let n = 0;

  // Cover band
  blocks.push(`
    <div class="rp2-hero">
      <div class="rp2-hero-glow"></div>
      <div class="rp2-hero-top">
        <img class="rp2-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
        <span class="rp2-divider"></span>
        <span class="rp2-product">Brandlab</span>
        <span class="rp2-hero-kind">${t("rep2.kind")}</span>
      </div>
      <div class="rp2-hero-main">
        <div class="rp2-hero-text">
          <div class="rp2-eyebrow">${t("rep.sheetTitle")}</div>
          <h1 class="rp2-brand">${esc(brand.name)}</h1>
          <div class="rp2-period">${icon("calendar", { size: 13 })}${esc(rangeLabel(start, end))}${days ? ` · ${t("rep2.days", { n: days })}` : ""}</div>
        </div>
        <div class="rp2-hero-avatar">${avatarHTML(brand, `width:92px;height:92px;border-radius:22px;font-size:36px;${brand.avatar ? "" : `background:${accent};color:#fff;display:grid;place-items:center;font-weight:800;`}`)}</div>
      </div>
      <div class="rp2-hero-meta">${t("rep.generatedOn", { date: formatDate(iso(new Date())) })}</div>
    </div>`);

  // Big numbers
  const kpis = [
    { label: t("rep.stat.published"), value: formatNumber(d.publishedCount), delta: p && deltaChip(d.publishedCount, p.publishedCount), icon: "layers" },
    { label: t("rep.stat.totalViews"), value: shortNum(d.totalViews), delta: p && deltaChip(d.totalViews, p.totalViews), icon: "eye" },
    { label: t("dashboard.stat.avgER"), value: d.avgER === null ? "—" : formatPercent(d.avgER), delta: p && deltaChip(d.avgER, p.avgER, { points: true }), icon: "heart" },
    d.sales.count || (p && p.sales.count)
      ? { label: t("rep.sales.revenue"), value: rp(d.sales.revenue), delta: p && deltaChip(d.sales.revenue, p.sales.revenue), icon: "target" }
      : { label: t("rep.stat.totalReach"), value: shortNum(d.totalReach), delta: p && deltaChip(d.totalReach, p.totalReach), icon: "users" },
  ];
  blocks.push(`
    <div class="rp2-pad">
      <div class="rp2-kpis">
        ${kpis.map((k) => `
          <div class="rp2-kpi">
            <div class="rp2-kpi-top"><span class="rp2-kpi-icon" style="color:${accent};background:${accent}1f">${icon(k.icon, { size: 14 })}</span>${k.delta || ""}</div>
            <div class="rp2-kpi-value">${k.value}</div>
            <div class="rp2-kpi-label">${k.label}</div>
          </div>`).join("")}
      </div>
      ${p ? `<p class="rp2-compare">${t("rep2.compare", { period: esc(rangeLabel(prevR.start, prevR.end)) })}</p>` : ""}
    </div>`);

  // In short
  if (d.highlights.length || d.next) {
    blocks.push(`
      <div class="rp2-pad">
        <div class="rp2-callout" style="border-color:${accent}">
          <div class="rp2-callout-head" style="color:${accent}">${icon("sparkle", { size: 14 })}${t("rep.sec.summary")}</div>
          ${d.highlights.map((h) => `<p>${esc(h)}</p>`).join("")}
          ${d.next ? `<div class="rp2-next" style="background:${accent}14"><b style="color:${accent}">${icon("arrowRight", { size: 13 })}${t("rep.next")}</b> ${esc(d.next.title)}${d.next.why ? `<small>${esc(d.next.why)}</small>` : ""}</div>` : ""}
        </div>
      </div>`);
  }

  // Content: best posts as bars
  const maxViews = Math.max(1, ...d.top.map((x) => organicViews(x.c) || 0));
  blocks.push(`
    <div class="rp2-pad">
      ${secHead(++n, t("dashboard.topPerforming"), t("rep2.topSub", { n: d.publishedCount, healthy: d.healthyPct === null ? "—" : formatPercent(d.healthyPct, 0) }))}
      ${d.top.length
        ? `<div class="rp2-rank">${d.top.map((x, i) => `
            <div class="rp2-rank-row">
              <span class="rp2-rank-n" style="${i === 0 ? `background:${accent};color:#fff;` : ""}">${i + 1}</span>
              <div class="rp2-rank-main">
                <div class="rp2-rank-title">${esc(x.c.title || t("common.untitled"))}</div>
                <div class="rp2-rank-meta"><span class="rp2-pill" style="background:${FUNNEL_COLOR[x.c.funnel] || "#999"}1a;color:${FUNNEL_COLOR[x.c.funnel] || "#666"}">${esc(funnelShort(x.c.funnel))}</span>${x.c.format ? `<span>${esc(x.c.format)}</span>` : ""}${x.m.health ? `<span>${esc(HEALTH_LABEL[x.m.health])}</span>` : ""}</div>
                ${bar(organicViews(x.c), maxViews, i === 0 ? accent : "#c9c3bb")}
              </div>
              <div class="rp2-rank-nums"><b>${formatNumber(organicViews(x.c))}</b><small>views · ${formatPercent(x.m.engagementRate)}</small></div>
            </div>`).join("")}</div>`
        : `<p class="rp2-empty">${t("rep.noTop")}</p>`}
    </div>`);

  // Funnel mix
  const funnelTotal = d.funnelStats.reduce((a, f) => a + f.count, 0);
  if (funnelTotal) {
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("dashboard.perfByFunnel"), t("rep2.funnelSub"))}
        <div class="rp2-stack">${d.funnelStats.filter((f) => f.count).map((f) => `<span style="flex:${f.count};background:${FUNNEL_COLOR[f.funnel]}"></span>`).join("")}</div>
        <div class="rp2-legend">${d.funnelStats.map((f) => `
          <div class="rp2-legend-item"><span class="rp2-dot" style="background:${FUNNEL_COLOR[f.funnel]}"></span><b>${esc(funnelShort(f.funnel))}</b><span>${t("rep2.funnelItem", { n: f.count, er: f.avgER === null ? "—" : formatPercent(f.avgER) })}</span></div>`).join("")}</div>
      </div>`);
  }

  // Followers
  if (d.followers.length) {
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("rep.sec.followers"))}
        <div class="rp2-cards">${d.followers.map((f) => `
          <div class="rp2-card">
            <div class="rp2-card-label">${esc(f.platform)}</div>
            <div class="rp2-card-value">${formatNumber(f.now)}</div>
            ${f.delta !== null ? `<span class="rp2-delta ${f.delta >= 0 ? "is-up" : "is-down"}">${f.delta >= 0 ? "▲ +" : "▼ "}${formatNumber(f.delta)}</span>` : ""}
          </div>`).join("")}</div>
      </div>`);
  }

  // Sales
  if (d.sales.count) {
    const maxRev = Math.max(1, ...d.sales.products.map((x) => x.revenue));
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("rep.sec.sales"), t("rep2.salesSub", { count: formatNumber(d.sales.count), qty: formatNumber(d.sales.qty) }))}
        <div class="rp2-sales">
          <div class="rp2-sales-total" style="background:${accent}12;border-color:${accent}55"><small>${t("rep.sales.revenue")}</small><b>${rp(d.sales.revenue)}</b>${p ? deltaChip(d.sales.revenue, p.sales.revenue) : ""}</div>
          <div class="rp2-sales-list">${d.sales.products.map((x) => `
            <div class="rp2-sales-row"><span class="rp2-sales-name">${esc(x.name)}</span>${bar(x.revenue, maxRev, accent)}<span class="rp2-sales-num">${formatNumber(x.qty)} · ${rp(x.revenue)}</span></div>`).join("")}</div>
        </div>
        ${d.sales.sources.length ? `<div class="rp2-chips"><span class="rp2-chips-label">${t("rep.sales.from")}</span>${d.sales.sources.map((x) => `<span class="rp2-chip">${esc(x.name)} <b>${rp(x.revenue)}</b></span>`).join("")}</div>` : ""}
      </div>`);
  }

  // Campaigns
  if (d.campaignRows.length) {
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("rep.sec.campaigns"))}
        <div class="rp2-camps">${d.campaignRows.map((c) => `
          <div class="rp2-camp">
            <div class="rp2-camp-head"><b>${esc(c.name)}</b><span>${c.total ? `${c.met}/${c.total}` : ""}</span></div>
            <div class="rp2-camp-stage">${t("rep.camp.stage")}: ${esc(c.stage)}</div>
            ${c.total ? bar(c.met, c.total, accent) : ""}
            ${c.head ? `<div class="rp2-camp-head-num">${esc(c.head)}</div>` : ""}
          </div>`).join("")}</div>
      </div>`);
  }

  // Next two weeks
  if (d.upcoming.length) {
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("rep.sec.upcoming"))}
        <div class="rp2-timeline">${d.upcoming.map((c) => {
          const dt = new Date(c.scheduleDate + "T12:00:00");
          return `
            <div class="rp2-tl-row">
              <span class="rp2-tl-date" style="border-color:${accent}66"><b>${dt.getDate()}</b><small>${esc(dt.toLocaleDateString("id-ID", { month: "short" }))}</small></span>
              <span class="rp2-tl-title">${esc(c.title || t("common.untitled"))}</span>
              <span class="rp2-pill" style="background:${FUNNEL_COLOR[c.funnel] || "#999"}1a;color:${FUNNEL_COLOR[c.funnel] || "#666"}">${esc(funnelShort(c.funnel))}</span>
            </div>`;
        }).join("")}</div>
      </div>`);
  }

  // What happened & what we learned
  if (d.moments.length || d.lessons.length) {
    blocks.push(`
      <div class="rp2-pad">
        ${secHead(++n, t("rep.sec.memory"))}
        <div class="rp2-notes">
          ${d.moments.map((m) => `<div class="rp2-note">${icon("heart", { size: 13 })}<span>${esc(m.title)}${m.detail ? `<small>${esc(m.detail)}</small>` : ""}</span></div>`).join("")}
          ${d.lessons.map((l) => `<div class="rp2-note is-lesson">${icon("bulb", { size: 13 })}<span><b>${t("rep.lesson", { month: esc(l.month) })}</b> ${esc((l.points || []).join(" "))}</span></div>`).join("")}
        </div>
      </div>`);
  }
  return { blocks, data: d, accent };
}

// The footer every page carries: the mark, the brand, the page number.
const footerHTML = (brand, page, total) => `
  <div class="rp2-foot">
    <span class="rp2-foot-mark"><img src="assets/wepeka-logo.png" alt="Wepeka" /><span>Brandlab</span></span>
    <span>${esc(brand.name)}</span>
    <span>${total ? t("rep2.page", { n: page, total }) : "wepeka.com/brandlab"}</span>
  </div>`;

const sheetHTML = (brand, blocks) => `${blocks.map((b) => `<div class="rp-block">${b}</div>`).join("")}${footerHTML(brand, 0, 0)}`;

function reportSummaryText(brand, start, end, d) {
  return [
    t("rep.shareTitle", { brand: brand.name }),
    rangeLabel(start, end),
    "",
    `${t("rep.stat.published")}: ${d.publishedCount}`,
    `${t("rep.stat.totalViews")}: ${formatNumber(d.totalViews)}`,
    `${t("dashboard.stat.avgER")}: ${formatPercent(d.avgER)}`,
    d.sales.count ? `${t("rep.sales.revenue")}: ${rp(d.sales.revenue)} (${formatNumber(d.sales.qty)})` : "",
    ...d.highlights,
  ].filter((x) => x !== "").join("\n");
}

// Lays the blocks into A4 pages off-screen (a block never splits across
// pages), puts the footer on each, rasterizes them, saves the PDF.
const FOOT_H = 58;
async function downloadReportPdf(brand, start, end, blocks) {
  await ensurePdfLibs();
  const host = document.createElement("div");
  host.className = "rp-pdf-host";
  document.body.appendChild(host);
  try {
    // Each page is a fixed A4 box; its content sits in a body that grows,
    // and that body's height is what decides when a page is full.
    const pages = [];
    let page = null;
    let body = null;
    const newPage = () => {
      page = document.createElement("div");
      page.className = "report-sheet rp2 rp-page";
      body = document.createElement("div");
      body.className = "rp-page-body";
      page.appendChild(body);
      host.appendChild(page);
      pages.push(page);
    };
    newPage();
    blocks.forEach((html) => {
      const block = document.createElement("div");
      block.className = "rp-block";
      block.innerHTML = html;
      body.appendChild(block);
      if (body.offsetHeight > A4_H - FOOT_H && body.children.length > 1) {
        body.removeChild(block);
        newPage();
        block.classList.add("is-page-top");
        body.appendChild(block);
      }
    });
    pages.forEach((pg, i) => pg.insertAdjacentHTML("beforeend", footerHTML(brand, i + 1, pages.length)));
    await Promise.all([...host.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    if (document.fonts?.ready) await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", width: A4_W, height: A4_H, windowWidth: A4_W, logging: false, useCORS: true });
      if (i > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }
    const slug = brand.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "brand";
    pdf.save(`${slug}-report-${start === OVERALL_START ? "semua" : start}-${end}.pdf`);
  } finally {
    host.remove();
  }
}

// ---------- The modal: pick the period, see it, download ----------

export function openReportModal(brandId, { range = "week" } = {}) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const st = { key: range, ...(rangeFor(range) || rangeFor("week")), busy: false };

  const pickerHTML = () => `
    <div class="chip-select rp-range">
      ${["week", "month", "overall", "custom"].map((k) => `<button type="button" data-range="${k}" class="${st.key === k ? "active" : ""}">${t(`rep.range.${k}`)}</button>`).join("")}
    </div>
    ${st.key === "custom" ? `<div class="row-2" style="margin-top:10px;"><div class="field" style="margin-bottom:0;"><label>${t("rep.range.start")}</label><input class="input" type="date" id="rp-start" value="${st.start}" /></div><div class="field" style="margin-bottom:0;"><label>${t("rep.range.end")}</label><input class="input" type="date" id="rp-end" value="${st.end}" /></div></div>` : ""}`;

  const overlay = openModal({
    title: t("rep.title"),
    wide: true,
    bodyHTML: `<div id="rp-picker">${pickerHTML()}</div><div class="report-preview-wrap" style="margin-top:14px;"><div class="report-sheet rp2" id="report-sheet"></div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="report-share">${icon("link", { size: 14 })}${t("rep.share")}</button>
      <button class="btn btn-primary" id="report-download">${icon("download", { size: 14 })}${t("rep.downloadPdf")}</button>`,
  });
  let current = null;
  const paint = () => {
    current = reportBlocks(getBrand(brandId), st.start, st.end);
    qs("#report-sheet", overlay).innerHTML = sheetHTML(getBrand(brandId), current.blocks);
  };
  const wirePicker = () => {
    qsa("[data-range]", overlay).forEach((b) => b.addEventListener("click", () => {
      st.key = b.dataset.range;
      if (st.key !== "custom") Object.assign(st, rangeFor(st.key));
      qs("#rp-picker", overlay).innerHTML = pickerHTML();
      wirePicker();
      paint();
    }));
    const onDate = () => { st.start = qs("#rp-start", overlay)?.value || st.start; st.end = qs("#rp-end", overlay)?.value || st.end; paint(); };
    qs("#rp-start", overlay)?.addEventListener("change", onDate);
    qs("#rp-end", overlay)?.addEventListener("change", onDate);
  };
  wirePicker();
  paint();

  const dl = qs("#report-download", overlay);
  dl.addEventListener("click", async () => {
    if (st.busy) return;
    st.busy = true;
    dl.disabled = true;
    dl.innerHTML = `<div class="spinner" style="width:14px;height:14px;"></div>${t("rep.making")}`;
    try {
      await downloadReportPdf(getBrand(brandId), st.start, st.end, current.blocks);
      // The weekly reminder on Home counts from here.
      updateBrand(brandId, { lastReportAt: Date.now() });
      toast(t("rep.downloaded"));
    } catch {
      // No network for the PDF library: the print dialog still works.
      toast(t("rep.pdfHint"));
      setTimeout(() => window.print(), 300);
    }
    st.busy = false;
    dl.disabled = false;
    dl.innerHTML = `${icon("download", { size: 14 })}${t("rep.downloadPdf")}`;
  });
  qs("#report-share", overlay).addEventListener("click", async () => {
    const summary = reportSummaryText(getBrand(brandId), st.start, st.end, current.data);
    if (navigator.share) {
      try { await navigator.share({ title: t("rep.shareTitle", { brand: brand.name }), text: summary }); } catch { /* cancelled */ }
    } else if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(summary); toast(t("rep.copied")); } catch { toast(t("rep.clipboardFailed"), "error"); }
    } else {
      toast(t("rep.shareUnsupported"), "error");
    }
  });
  return overlay;
}

// ---------- Weekly reminder (Home) ----------

// Due once a week has passed since the last downloaded report — and only
// for a brand with something to report. "Nanti" hides it until next week.
export function reportDue(brand, content, now = Date.now()) {
  if (!brand) return false;
  const hasSomething = content.some((c) => c.status === "published") || getTracker(brand).entries.length > 0;
  if (!hasSomething) return false;
  if (brand.reportSnoozeUntil && now < brand.reportSnoozeUntil) return false;
  return !brand.lastReportAt || now - brand.lastReportAt >= REPORT_EVERY_DAYS * DAY;
}
export function reportReminderHTML(brand) {
  const r = rangeFor("week");
  const d = computeReportData(brand, r.start, r.end);
  const bits = [
    t("rep.remind.published", { n: d.publishedCount }),
    d.totalViews ? t("rep.remind.views", { n: formatNumber(d.totalViews) }) : "",
    d.sales.count ? t("rep.remind.sales", { rp: rp(d.sales.revenue) }) : "",
  ].filter(Boolean);
  return `
    <div class="card glass-card card-tight report-remind" id="report-remind">
      <span class="report-remind-icon">${icon("download", { size: 16 })}</span>
      <span class="report-remind-text"><b>${t("rep.remind.title")}</b><small>${esc(t("rep.remind.week"))}: ${esc(bits.join(" · "))}</small></span>
      <button type="button" class="btn btn-primary btn-sm" data-report-open="week">${t("rep.downloadPdf")}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-report-snooze>${t("rep.remind.later")}</button>
    </div>`;
}
export function snoozeReport(brandId) {
  // Until next Monday morning.
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7), 6);
  updateBrand(brandId, { reportSnoozeUntil: next.getTime() });
}
