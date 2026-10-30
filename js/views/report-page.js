// Report — one of the five apps (js/apps.js). Owner's ask, 2026-10-27:
// "tampilannya dibuat landing page yang sangat menarik, performanya gimana,
// ada analytics2nya disitu ... aku mau kaya journey, di scroll ada
// animasinya, di atas sendiri ada tulisan + icon download report, baru
// tampilin yang pdf itu". So the page is the brand's performance told top
// to bottom: a gradient hero with the period's numbers, then one stop per
// question (how did views and interactions go, which posts did best, how
// steady was posting, what got made, followers and sales, the goals, what's
// next, the AI's read), each arriving as it scrolls into view. The A4 PDF
// sheet is no longer the page: the Download button at the very top opens
// it (js/views/report.js openReportModal — the same preview, Bagikan and
// PDF as before).
//
// Every number comes from computeReportData (the PDF's own), so the page
// and the PDF always agree; nothing is estimated or compared with made-up
// benchmarks, and a brand with no numbers gets a friendly empty state.
import { getBrand, getSettings, listContent, onChange, organicViews, localISODate, followersSinceStart, FUNNELS, ER_SCALE } from "../store.js";
import { computeReportData, previousRange, rangeFor, rangeLabel, openReportModal, reportAdviceState, requestReportAdvice, OVERALL_START } from "./report.js";
import { interactionsOf, interactionsTotal, trendSeries, formatMix, postingRhythm, erSeries, healthMix, HEALTH_ORDER, erBy, engagementMix } from "../report-journey.js";
import { trendChartSVG, erChartSVG, ringSVG, sparkSVG, compactNum } from "./report-charts.js";
import { isHealthy, computeContentMetrics } from "../formulas.js";
import { brandRetentionStats, ratingLabel } from "../retention.js";
import { hasAiKey, AiApiError } from "../ai.js";
import { appByKey } from "../apps.js";
import { appIconSVG } from "../app-icons.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { icon } from "../icons.js";
import { escapeHtml as esc, qs, qsa, formatNumber, formatPercent, formatDate, avatarHTML, loadingHTML, toast } from "../dom.js";
import { t, getLang, campaignDisplayName } from "../i18n.js";
import { funnelShort } from "../funnel-field.js";

const RANGE_KEY = "wpk-report-range";
const RANGES = ["week", "month", "overall", "custom"];
const FUNNEL_VAR = { TOFU: "var(--tofu)", MOFU: "var(--mofu)", BOFU: "var(--bofu)" };
const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const locale = () => (getLang() === "en" ? "en-US" : "id-ID");
const dayMonth = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(locale(), { day: "numeric", month: "short" });

const TOUR_STEPS = [
  { selector: "#rl-download", title: t("rl.download"), body: t("rpage.tour.pdf.body") },
  { selector: ".rl-range", title: t("rpage.tour.range.title"), body: t("rpage.tour.range.body") },
  { selector: ".rl-hero", title: t("rpage.tour.sheet.title"), body: t("rpage.tour.sheet.body") },
];

// The period last looked at (this browser only); "week" the first time.
function loadRange() {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_KEY) || "null");
    if (saved && RANGES.includes(saved.key)) {
      if (saved.key === "custom" && saved.start && saved.end) return saved;
      if (saved.key !== "custom") return { key: saved.key, ...rangeFor(saved.key) };
    }
  } catch { /* storage off: start from the default */ }
  return { key: "week", ...rangeFor("week") };
}
function saveRange(st) {
  try { localStorage.setItem(RANGE_KEY, JSON.stringify({ key: st.key, start: st.start, end: st.end })); } catch { /* fine */ }
}

// ---------- Small pieces ----------

// Calm change against the period before: an arrow and a percentage, no
// colour shouting either way.
function deltaHTML(now, before, { points = false } = {}) {
  if (before === null || before === undefined || now === null || now === undefined) return "";
  if (points) {
    const diff = now - before;
    if (Math.abs(diff) < 0.05) return `<span class="rl-delta is-flat">${t("rl.same")}</span>`;
    return `<span class="rl-delta ${diff > 0 ? "is-up" : "is-down"}">${diff > 0 ? "▲" : "▼"} ${t("rep2.points", { n: Math.abs(diff).toFixed(1).replace(".", getLang() === "en" ? "." : ",") })}</span>`;
  }
  if (!before) return now ? `<span class="rl-delta is-up">${t("rl.new")}</span>` : "";
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return `<span class="rl-delta is-flat">${t("rl.same")}</span>`;
  return `<span class="rl-delta ${pct > 0 ? "is-up" : "is-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`;
}
// A number that counts up when its section arrives; the final text is in
// the markup, so without motion (or before the script runs) it's right.
const countHTML = (value, fmt, text) => `<b class="rl-num" data-count="${Number(value) || 0}" data-fmt="${fmt}">${text}</b>`;
const FMT = {
  num: (v) => formatNumber(Math.round(v)),
  gain: (v) => `${v > 0 ? "+" : ""}${formatNumber(Math.round(v))}`,
  short: (v) => compactNum(v),
  pct: (v) => formatPercent(v),
  pct0: (v) => `${Math.round(v)}%`,
  rp: (v) => rp(v),
  dec1: (v) => (Math.round(v * 10) / 10).toString().replace(".", getLang() === "en" ? "." : ","),
};

const stopHead = (n, title, sub = "") => `
  <header class="rl-stop-head">
    <span class="rl-node" aria-hidden="true">${String(n).padStart(2, "0")}</span>
    <div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>
  </header>`;

// ---------- The hero ----------

function heroHTML(brand, st, d, p, prevR) {
  const views = d.recap.views;
  const inter = interactionsTotal(d);
  const pInter = p ? interactionsTotal(p) : null;
  const vsLine = p ? `<span class="rl-hero-vs">${t("rl.vs", { period: esc(rangeLabel(prevR.start, prevR.end)) })}</span>` : "";

  // The one big number: views when they're filled in, else sales, else
  // how many posts went out.
  let fig;
  if (views.n) fig = { value: views.total, fmt: "num", text: formatNumber(views.total), sub: t(d.publishedCount === 1 ? "rl.hero.views.one" : "rl.hero.views", { n: d.publishedCount }), delta: p?.recap.views.n ? deltaHTML(views.total, p.recap.views.total) : "" };
  else if (d.sales.count) fig = { value: d.sales.revenue, fmt: "rp", text: rp(d.sales.revenue), sub: t("rl.hero.sales", { n: d.sales.count }), delta: p ? deltaHTML(d.sales.revenue, p.sales.revenue) : "" };
  else fig = { value: d.publishedCount, fmt: "num", text: formatNumber(d.publishedCount), sub: t(d.publishedCount === 1 ? "rl.hero.posts.one" : "rl.hero.posts", { n: d.publishedCount }), delta: p ? deltaHTML(d.publishedCount, p.publishedCount) : "" };

  // Up to four small numbers under it, only the ones that exist.
  const kpis = [];
  if (inter.n) kpis.push({ label: t("rl.kpi.inter"), html: countHTML(inter.total, "short", compactNum(inter.total)), delta: pInter?.n ? deltaHTML(inter.total, pInter.total) : "" });
  if (d.avgER !== null) kpis.push({ label: t("rl.kpi.er"), html: countHTML(d.avgER, "pct", formatPercent(d.avgER)), delta: p && p.avgER !== null ? deltaHTML(d.avgER, p.avgER, { points: true }) : "" });
  // Followers: what the account gained since the owner started with Brandlab
  // (saved starting count vs the latest, as of the period's end); brands with
  // only one follower count so far fall back to the per-post "new followers".
  const fs = followersSinceStart(brand, new Date(st.end + "T23:59:59").getTime());
  if (fs) kpis.push({ label: t("rl.kpi.followersSince"), html: countHTML(fs.gain, "gain", FMT.gain(fs.gain)), delta: "" });
  else if (d.recap.followersGained.n) kpis.push({ label: t("rl.kpi.followers"), html: countHTML(d.recap.followersGained.total, "num", formatNumber(d.recap.followersGained.total)), delta: p?.recap.followersGained.n ? deltaHTML(d.recap.followersGained.total, p.recap.followersGained.total) : "" });
  if (views.n && (d.sales.count || p?.sales.count)) kpis.push({ label: t("rl.kpi.sales"), html: countHTML(d.sales.revenue, "rp", rp(d.sales.revenue)), delta: p ? deltaHTML(d.sales.revenue, p.sales.revenue) : "" });
  if (d.recap.reach.n) kpis.push({ label: t("store.metric.reach"), html: countHTML(d.recap.reach.total, "short", compactNum(d.recap.reach.total)), delta: p?.recap.reach.n ? deltaHTML(d.recap.reach.total, p.recap.reach.total) : "" });
  if (views.n || d.sales.count) kpis.push({ label: t("rl.kpi.posts"), html: countHTML(d.publishedCount, "num", formatNumber(d.publishedCount)), delta: p ? deltaHTML(d.publishedCount, p.publishedCount) : "" });

  // The ring: how many of the period's posts have a healthy engagement
  // rate (the app's own ER scale); when none can be rated yet, how many
  // have their numbers filled in.
  const rated = d.posts.filter((x) => x.health);
  const healthy = rated.filter((x) => isHealthy(x.health)).length;
  const scale = getSettings().erScale || ER_SCALE;
  const ring = rated.length
    ? { pct: (healthy / rated.length) * 100, label: t("rl.ring.healthy"), sub: t("rl.ring.of", { n: healthy, total: rated.length }), note: t("rl.ring.healthyNote", { er: scale.good }) }
    : d.publishedCount
    ? { pct: (d.postsWithNumbers / d.publishedCount) * 100, label: t("rl.ring.filled"), sub: t("rl.ring.of", { n: d.postsWithNumbers, total: d.publishedCount }), note: "" }
    : null;
  const missing = d.publishedCount - d.postsWithNumbers;

  return `
    <section class="rl-hero rl-glow rl-reveal" data-stop="hero" aria-label="${esc(t("rl.hero.aria"))}">
      <div class="rl-hero-main">
        <div class="rl-hero-brand">
          <span class="rl-hero-avatar">${avatarHTML(brand)}</span>
          <span><b>${esc(brand.name)}</b><small>${esc(rangeLabel(st.start, st.end))}</small></span>
        </div>
        <div class="rl-hero-fig">${countHTML(fig.value, fig.fmt, fig.text)}</div>
        <p class="rl-hero-sub">${esc(fig.sub)}${fig.delta ? ` ${fig.delta}` : ""}</p>
        ${fig.delta ? vsLine : ""}
        ${kpis.length ? `<div class="rl-kpis rl-stagger">${kpis.slice(0, 4).map((k, i) => `
          <div class="rl-kpi" style="--i:${i}"><span class="rl-kpi-label">${esc(k.label)}</span>${k.html}${k.delta ? `<span class="rl-kpi-delta">${k.delta}</span>` : ""}</div>`).join("")}</div>` : ""}
        ${missing > 0 ? `<a class="rl-hero-fill" href="${appByKey("content-os").path(brand.id)}">${icon("edit", { size: 14 })}${esc(t(missing === 1 ? "rl.hero.missing.one" : "rl.hero.missing", { n: missing }))}</a>` : ""}
      </div>
      ${ring ? `
        <div class="rl-hero-ring">
          <div class="rl-ring is-hero">${ringSVG({ pct: ring.pct, size: 176, stroke: 18 })}
            <div class="rl-ring-mid">${countHTML(ring.pct, "pct0", `${Math.round(ring.pct)}%`)}<small>${esc(ring.label)}</small></div>
          </div>
          <p class="rl-ring-sub"><b>${esc(ring.sub)}</b>${ring.note ? `<small>${esc(ring.note)}</small>` : ""}</p>
        </div>` : ""}
    </section>`;
}

// No posts in the period (or none at all): one friendly block, in the
// Report app's colours, with the way forward.
function emptyHTML(brand, st) {
  const anyPublished = listContent(brand.id).some((c) => c.status === "published");
  const createPath = appByKey("content-os").path(brand.id);
  const otherPeriod = anyPublished && st.key !== "overall";
  return `
    <section class="rl-empty rl-glow rl-reveal" data-stop="empty">
      <div class="rl-empty-art" aria-hidden="true">${appIconSVG("report")}</div>
      <div class="rl-empty-text">
        <h2>${esc(t(anyPublished ? "rl.empty.period" : "rl.empty.title"))}</h2>
        <p>${esc(t(anyPublished ? "rl.empty.periodBody" : "rl.empty.body"))}</p>
        <div class="rl-empty-actions">
          ${otherPeriod ? `<button type="button" class="rl-cta" data-range-go="overall"><span>${esc(t("rl.empty.seeAll"))}</span><span class="rl-cta-dot">${icon("arrowRight", { size: 16 })}</span></button>` : ""}
          <a class="${otherPeriod ? "rl-ghost" : "rl-cta"}" href="${createPath}"><span>${esc(t("rl.empty.create"))}</span>${otherPeriod ? "" : `<span class="rl-cta-dot">${icon("arrowRight", { size: 16 })}</span>`}</a>
        </div>
      </div>
    </section>`;
}

// ---------- The journey: one stop per question ----------

function trendStop(n, d, series) {
  const hasViews = series.points.some((pt) => pt.views !== null);
  if (!hasViews) return "";
  const sub = series.unit === "post" ? t("rl.trend.subPost") : series.unit === "week" ? t("rl.trend.subWeek") : t("rl.trend.subMonth");
  const nameOf = (pt) => (series.unit === "post" ? pt.title || t("common.untitled") : series.unit === "week" ? t("rl.trend.weekOf", { date: dayMonth(pt.date) }) : new Date(pt.date + "T12:00:00").toLocaleDateString(locale(), { month: "long", year: "numeric" }));
  const rows = series.points.map((pt) => `<tr><th scope="row">${esc(nameOf(pt))}<small>${esc(series.unit === "post" ? dayMonth(pt.date) : t(pt.n === 1 ? "rl.posts.one" : "rl.posts", { n: pt.n }))}</small></th><td>${pt.views === null ? "—" : formatNumber(pt.views)}</td><td>${pt.inter === null ? "—" : formatNumber(pt.inter)}</td></tr>`).join("");
  return `
    <section class="rl-stop rl-reveal" data-stop="trend">
      ${stopHead(n, t("rl.trend.title"), sub)}
      <div class="rl-card rl-trend">
        <div class="rl-legend" aria-hidden="true"><span><i class="rl-key-line"></i>${t("store.metric.views")}</span><span><i class="rl-key-bar"></i>${t("rl.kpi.inter")}</span></div>
        <div class="rl-chart" id="rl-trend" tabindex="0" aria-describedby="rl-trend-hint"></div>
        <p class="rl-hint" id="rl-trend-hint">${t("rl.trend.hint")}</p>
        <details class="rl-table">
          <summary>${t("rl.trend.table")}</summary>
          <div class="rl-table-wrap"><table>
            <thead><tr><th scope="col">${t(series.unit === "post" ? "rep3.colPost" : "rl.trend.colPeriod")}</th><th scope="col">${t("store.metric.views")}</th><th scope="col">${t("rl.kpi.inter")}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
        </details>
      </div>
    </section>`;
}

// ---------- Engagement rate & its details ----------
// The charts the old Pro Beranda had (js/views/brand-home-analytics.js),
// now on the journey (owner, 2026-10-27: "analytics yang dulu grafik2 dll
// engagement rate masukin di report juga"): the ER over time against the
// scale's healthy mark, how the posts score, ER per platform and per
// format, what the interactions are made of, and video retention. All for
// the period on screen, from the same numbers as the PDF.
const HEALTH_VAR = {
  excellent: "var(--health-good)",
  good: "color-mix(in srgb, var(--health-good) 50%, var(--surface-2))",
  average: "var(--health-average)",
  poor: "var(--health-poor)",
};
// Bars of an average ER per group, highest first; nothing for fewer than
// two groups (one bar would only repeat the average above).
function erBarsCard(title, rows, nameOf) {
  if (rows.length < 2) return "";
  const best = rows[0].avg || 0;
  return `
    <div class="rl-card rl-mix-card">
      <h3>${title}</h3>
      <ul class="rl-bars rl-stagger">${rows.map((r, i) => `
        <li style="--i:${i}"><span class="rl-bars-name"><b>${esc(nameOf(r.name))}</b><small>${t(r.n === 1 ? "rl.posts.one" : "rl.posts", { n: r.n })}</small></span>
          <span class="rl-bars-track"><span class="rl-bars-fill${i === 0 ? " is-best" : ""}" style="--w:${best ? Math.max(3, Math.round((r.avg / best) * 100)) : 0}%"></span></span>
          <span class="rl-bars-val">${formatPercent(r.avg)}</span></li>`).join("")}</ul>
    </div>`;
}

function erStop(n, d, p, ers) {
  if (d.avgER === null || !ers.points.some((pt) => pt.er !== null)) return "";
  const scale = getSettings().erScale || ER_SCALE;
  const sub = ers.unit === "post" ? t("rl.er.subPost") : ers.unit === "week" ? t("rl.er.subWeek") : t("rl.er.subMonth");
  const h = healthMix(d);
  const healthCard = h.rated ? `
    <div class="rl-card rl-mix-card">
      <h3>${t("rl.health.title")}</h3>
      <div class="rl-stack" role="img" aria-label="${esc(HEALTH_ORDER.filter((k) => h.counts[k]).map((k) => `${t(`rl.health.${k}`)} ${h.counts[k]}`).join(", "))}">${HEALTH_ORDER.filter((k) => h.counts[k]).map((k) => `<span style="--grow:${h.counts[k]};background:${HEALTH_VAR[k]}"></span>`).join("")}</div>
      <ul class="rl-mix-list">${HEALTH_ORDER.map((k) => `
        <li><i style="background:${HEALTH_VAR[k]}"></i><b>${t(`rl.health.${k}`)}</b><span>${t(h.counts[k] === 1 ? "rl.posts.one" : "rl.posts", { n: h.counts[k] })}</span><em>${Math.round((h.counts[k] / h.rated) * 100)}%</em></li>`).join("")}</ul>
      ${h.unrated ? `<p class="rl-hint">${t(h.unrated === 1 ? "rl.health.unrated.one" : "rl.health.unrated", { n: h.unrated })}</p>` : ""}
    </div>` : "";
  const platformCard = erBarsCard(t("rl.an.platform"), erBy(d, (x) => x.c.platform), (name) => (name ? platformName(name) : t("rl.an.noPlatform")));
  const delta = p && p.avgER !== null ? deltaHTML(d.avgER, p.avgER, { points: true }) : "";
  return `
    <section class="rl-stop rl-reveal" data-stop="er">
      ${stopHead(n, t("rl.er.title"), t("rl.er.sub", { good: scale.good }))}
      <div class="rl-card rl-trend rl-er">
        <div class="rl-er-head">
          <div class="rl-er-fig"><small>${t("rl.er.avg")}</small>${countHTML(d.avgER, "pct", formatPercent(d.avgER))}${delta}</div>
          <p>${esc(sub)}</p>
        </div>
        <div class="rl-chart" id="rl-er" tabindex="0" aria-describedby="rl-er-hint"></div>
        <p class="rl-hint" id="rl-er-hint">${t("rl.trend.hint")}</p>
      </div>
      ${healthCard || platformCard ? `<div class="rl-two rl-er-cards">${healthCard}${platformCard}</div>` : ""}
    </section>`;
}

function analyticsStop(n, d) {
  const formatCard = erBarsCard(t("rl.an.format"), erBy(d, (x) => x.c.format), (name) => name || t("rl.an.noFormat"));
  const mix = engagementMix(d);
  const mixMax = Math.max(0.5, ...mix.map((r) => r.avg));
  const mixCard = mix.length ? `
    <div class="rl-card rl-mix-card">
      <h3>${t("rl.an.mix")}</h3>
      <ul class="rl-bars rl-stagger">${mix.map((r, i) => `
        <li style="--i:${i}"><span class="rl-bars-name"><b>${esc(t(`ret.mix.${r.key}`))}</b><small>${t(r.n === 1 ? "rl.posts.one" : "rl.posts", { n: r.n })}</small></span>
          <span class="rl-bars-track"><span class="rl-bars-fill" style="--w:${Math.max(3, Math.round((r.avg / mixMax) * 100))}%"></span></span>
          <span class="rl-bars-val">${formatPercent(r.avg)}</span></li>`).join("")}</ul>
      <p class="rl-hint">${t("ret.mix.hint")}</p>
    </div>` : "";
  const ret = brandRetentionStats(d.posts.map((x) => x.c), getSettings(), computeContentMetrics);
  const tile = (key, value, rating) => (value === null ? "" : `
    <div class="rl-ret-tile${rating ? ` is-${rating}` : ""}">${countHTML(value, "pct0", `${Math.round(value)}%`)}<span>${t(`ret.kpi.${key}`)}</span>${rating ? `<em>${esc(ratingLabel(rating))}</em>` : ""}</div>`);
  const topHooks = ret.rows.filter((x) => x.a.hookPct !== null && x.a.hookPct !== undefined).sort((a, b) => b.a.hookPct - a.a.hookPct).slice(0, 3);
  const retCard = ret.n ? `
    <div class="rl-card rl-ret">
      <h3>${t("rl.an.ret")}</h3>
      <div class="rl-ret-tiles">${tile("hook", ret.hook, ret.ratings.hook)}${tile("watch", ret.watch, ret.ratings.watch)}${tile("completion", ret.completion, ret.ratings.completion)}</div>
      <p class="rl-hint">${t("rl.an.retN", { n: ret.n })}</p>
      ${topHooks.length > 1 ? `<h3 class="rl-ret-sub">${t("rl.an.retTop")}</h3><ol class="rl-ret-list">${topHooks.map((x) => `<li><b>${esc(x.c.title || t("common.untitled"))}</b><em>${Math.round(x.a.hookPct)}%</em></li>`).join("")}</ol>` : ""}
    </div>` : "";
  if (!formatCard && !mixCard && !retCard) return "";
  return `
    <section class="rl-stop rl-reveal" data-stop="analytics">
      ${stopHead(n, t("rl.an.title"), t("rl.an.sub"))}
      ${formatCard || mixCard ? `<div class="rl-two">${formatCard}${mixCard}</div>` : ""}
      ${retCard}
    </section>`;
}

const PLATFORM_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", threads: "Threads", linkedin: "LinkedIn" };
const platformName = (p) => PLATFORM_NAME[String(p || "").toLowerCase()] || String(p || "").replace(/^./, (c) => c.toUpperCase());
const FORMAT_ICON = (f) => (/reel|video|tiktok|short/i.test(f) ? "play" : /carousel|slide/i.test(f) ? "layers" : /story/i.test(f) ? "clock" : /live/i.test(f) ? "mic" : "image");

function bestStop(n, d, brand) {
  if (!d.top.length) return "";
  const [first, ...rest] = d.top;
  const max = organicViews(first.c) || 1;
  const link = (x) => `#/brand/${brand.id}/content/list/${encodeURIComponent(x.c.id)}`;
  const inter = (x) => {
    const post = d.posts.find((p) => p.c.id === x.c.id);
    return post ? interactionsOf(post.nums) : null;
  };
  const meta = (x) => [x.c.format, x.c.funnel ? funnelShort(x.c.funnel) : "", dayMonth(x.c.publishedDate || x.c.scheduleDate)].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("");
  const firstInter = inter(first);
  return `
    <section class="rl-stop rl-reveal" data-stop="best">
      ${stopHead(n, t("rl.best.title"), t("rl.best.sub"))}
      <div class="rl-best">
        <a class="rl-best-top rl-glow" href="${link(first)}">
          <span class="rl-best-badge">${icon("flame", { size: 14 })}${t("rl.best.no1")}</span>
          <span class="rl-best-title">${esc(first.c.title || t("common.untitled"))}</span>
          <span class="rl-best-meta">${meta(first)}</span>
          <span class="rl-best-nums">
            <span><small>${t("store.metric.views")}</small>${countHTML(organicViews(first.c), "num", formatNumber(organicViews(first.c)))}</span>
            ${firstInter !== null ? `<span><small>${t("rl.kpi.inter")}</small>${countHTML(firstInter, "num", formatNumber(firstInter))}</span>` : ""}
            ${Number.isFinite(first.m.engagementRate) ? `<span><small>ER</small>${countHTML(first.m.engagementRate, "pct", formatPercent(first.m.engagementRate))}</span>` : ""}
          </span>
          <span class="rl-best-go" aria-hidden="true">${icon("arrowRight", { size: 16 })}</span>
        </a>
        ${rest.length ? `<ol class="rl-best-list rl-stagger" start="2">${rest.map((x, i) => `
          <li style="--i:${i}"><a class="rl-best-row" href="${link(x)}">
            <span class="rl-best-rank">${i + 2}</span>
            <span class="rl-best-icon" aria-hidden="true">${icon(FORMAT_ICON(x.c.format || ""), { size: 16 })}</span>
            <span class="rl-best-main"><b>${esc(x.c.title || t("common.untitled"))}</b><small>${meta(x)}</small>
              <span class="rl-meter" aria-hidden="true"><span style="--w:${Math.max(3, Math.round(((organicViews(x.c) || 0) / max) * 100))}%"></span></span></span>
            <span class="rl-best-val"><b>${formatNumber(organicViews(x.c))}</b><small>${Number.isFinite(x.m.engagementRate) ? `ER ${formatPercent(x.m.engagementRate)}` : t("store.metric.views")}</small></span>
          </a></li>`).join("")}</ol>` : ""}
      </div>
    </section>`;
}

function rhythmStop(n, d, st) {
  if (!d.publishedCount) return "";
  const r = postingRhythm(d, st.start, st.end, { overallStart: OVERALL_START });
  const wd = (i) => new Date(2026, 9, 26 + i).toLocaleDateString(locale(), { weekday: "short" }); // 26 Oct 2026 = a Monday
  const wdLong = (i) => new Date(2026, 9, 26 + i).toLocaleDateString(locale(), { weekday: "long" });
  const todayIso = localISODate();
  const cell = (c) => {
    const day = Number(c.date.slice(8));
    const label = c.posts.length ? `${dayMonth(c.date)}: ${c.posts.map((p) => `${p.title || t("common.untitled")}${p.views !== null ? ` (${formatNumber(p.views)} views)` : ""}`).join(", ")}` : dayMonth(c.date);
    const cls = ["rl-day", c.inPeriod ? "" : "is-out", c.future ? "is-future" : "", c.posts.length ? "is-posted" : "", c.date === todayIso ? "is-today" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}" title="${esc(label)}"${c.posts.length ? ` aria-label="${esc(label)}"` : ` aria-hidden="true"`}>${c.posts.length ? `<i>${c.posts.length > 1 ? c.posts.length : ""}</i>` : ""}<em>${day}</em></span>`;
  };
  const per = r.perWeek >= 10 ? Math.round(r.perWeek) : Math.round(r.perWeek * 10) / 10;
  const facts = [
    { k: t("rl.rhythm.posted"), v: `${t(r.count === 1 ? "rl.posts.one" : "rl.posts", { n: r.count })} ${t(r.activeDays === 1 ? "rl.rhythm.days.one" : "rl.rhythm.days", { n: r.activeDays })}` },
    r.longestGap !== null ? { k: t("rl.rhythm.gap"), v: t(r.longestGap === 1 ? "rl.rhythm.nDays.one" : "rl.rhythm.nDays", { n: r.longestGap }) } : null,
    r.topWeekday !== null ? { k: t("rl.rhythm.top"), v: wdLong(r.topWeekday) } : null,
    r.sinceLast !== null ? { k: t("rl.rhythm.since"), v: r.sinceLast === 0 ? t("rl.rhythm.today") : t(r.sinceLast === 1 ? "rl.rhythm.nDaysAgo.one" : "rl.rhythm.nDaysAgo", { n: r.sinceLast }) } : null,
  ].filter(Boolean);
  return `
    <section class="rl-stop rl-reveal" data-stop="rhythm">
      ${stopHead(n, t("rl.rhythm.title"), r.capped ? t("rl.rhythm.capped", { n: r.weeks.length }) : t("rl.rhythm.sub"))}
      <div class="rl-card rl-rhythm">
        <div class="rl-cal" role="group" aria-label="${esc(t("rl.rhythm.title"))}">
          <div class="rl-cal-head" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => `<span>${esc(wd(i))}</span>`).join("")}</div>
          <div class="rl-cal-body rl-stagger">${r.weeks.map((w, i) => `<div class="rl-week" style="--i:${i}">${w.map(cell).join("")}</div>`).join("")}</div>
        </div>
        <div class="rl-rhythm-side">
          <div class="rl-rhythm-fig">${countHTML(per, r.perWeek >= 10 ? "num" : "dec1", String(per).replace(".", getLang() === "en" ? "." : ","))}<small>${t("rl.rhythm.perWeek")}</small></div>
          <dl class="rl-facts">${facts.map((f) => `<div><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join("")}</dl>
        </div>
      </div>
    </section>`;
}

function mixStop(n, d) {
  const funnelTotal = d.funnelStats.reduce((a, f) => a + f.count, 0);
  const formats = formatMix(d).filter((f) => f.format);
  if (!funnelTotal && formats.length < 1) return "";
  const best = Math.max(0, ...formats.map((f) => f.avgViews || 0));
  const funnelCard = funnelTotal ? `
    <div class="rl-card rl-mix-card">
      <h3>${t("rl.mix.funnel")}</h3>
      <div class="rl-stack" role="img" aria-label="${esc(d.funnelStats.filter((f) => f.count).map((f) => `${funnelShort(f.funnel)} ${f.count}`).join(", "))}">${FUNNELS.map((f) => d.funnelStats.find((x) => x.funnel === f)).filter((f) => f && f.count).map((f) => `<span style="--grow:${f.count};background:${FUNNEL_VAR[f.funnel]}"></span>`).join("")}</div>
      <ul class="rl-mix-list">${d.funnelStats.filter((f) => f.count).map((f) => `
        <li><i style="background:${FUNNEL_VAR[f.funnel]}"></i><b>${esc(funnelShort(f.funnel))}</b><span>${t(f.count === 1 ? "rl.posts.one" : "rl.posts", { n: f.count })}${f.avgER !== null ? ` · ER ${formatPercent(f.avgER)}` : ""}</span><em>${Math.round((f.count / funnelTotal) * 100)}%</em></li>`).join("")}</ul>
    </div>` : "";
  const formatCard = formats.length ? `
    <div class="rl-card rl-mix-card">
      <h3>${t("rl.mix.format")}</h3>
      <ul class="rl-bars rl-stagger">${formats.map((f, i) => `
        <li style="--i:${i}"><span class="rl-bars-name"><b>${esc(f.format)}</b><small>${t(f.count === 1 ? "rl.posts.one" : "rl.posts", { n: f.count })}</small></span>
          <span class="rl-bars-track"><span class="rl-bars-fill${best && f.avgViews === best ? " is-best" : ""}" style="--w:${best && f.avgViews ? Math.max(3, Math.round((f.avgViews / best) * 100)) : 0}%"></span></span>
          <span class="rl-bars-val">${f.avgViews === null ? "—" : compactNum(f.avgViews)}</span></li>`).join("")}</ul>
      <p class="rl-hint">${t("rl.mix.formatNote")}</p>
    </div>` : "";
  return `
    <section class="rl-stop rl-reveal" data-stop="mix">
      ${stopHead(n, t("rl.mix.title"), t("rl.mix.sub"))}
      <div class="rl-two">${funnelCard}${formatCard}</div>
    </section>`;
}

// Each platform's follower counts up to the period's end (the Insights
// numbers the owner logged), oldest first, for the card's little line.
function followerHistory(brand, platform, end) {
  const endMs = new Date(end + "T23:59:59").getTime();
  return (brand.insightsHistory || [])
    .filter((h) => h.platform === platform && Number.isFinite(h.followers) && h.at <= endMs)
    .sort((a, b) => a.at - b.at)
    .slice(-12)
    .map((h) => h.followers);
}

function audienceStop(n, d, p, brand, st) {
  if (!d.followers.length && !d.sales.count) return "";
  const title = d.followers.length && d.sales.count ? t("rl.aud.both") : d.followers.length ? t("rep.sec.followers") : t("rep.sec.sales");
  const followerCards = d.followers.map((f) => `
    <div class="rl-card rl-stat">
      <span class="rl-stat-icon" aria-hidden="true">${icon(/insta/i.test(f.platform) ? "instagram" : /tiktok/i.test(f.platform) ? "tiktok" : /youtube/i.test(f.platform) ? "youtube" : /facebook/i.test(f.platform) ? "facebook" : "users", { size: 18 })}</span>
      <small>${esc(t("rl.aud.followersOn", { platform: platformName(f.platform) }))}</small>
      ${countHTML(f.now, "num", formatNumber(f.now))}
      ${f.delta !== null ? `<span class="rl-delta ${f.delta > 0 ? "is-up" : f.delta < 0 ? "is-down" : "is-flat"}">${f.delta > 0 ? "▲ +" : f.delta < 0 ? "▼ " : "= "}${formatNumber(f.delta)}</span>` : ""}
      ${sparkSVG(followerHistory(brand, f.platform, st.end))}
    </div>`).join("");
  const maxRev = Math.max(1, ...d.sales.products.map((x) => x.revenue));
  const salesCard = d.sales.count ? `
    <div class="rl-card rl-sales">
      <div class="rl-sales-head"><small>${t("rep.sales.revenue")}</small>${countHTML(d.sales.revenue, "rp", rp(d.sales.revenue))}
        <span class="rl-sales-sub">${esc(t("rep2.salesSub", { count: formatNumber(d.sales.count), qty: formatNumber(d.sales.qty) }))} ${p ? deltaHTML(d.sales.revenue, p.sales.revenue) : ""}</span></div>
      ${d.sales.products.length ? `<ul class="rl-bars rl-stagger">${d.sales.products.map((x, i) => `
        <li style="--i:${i}"><span class="rl-bars-name"><b>${esc(x.name)}</b><small>${formatNumber(x.qty)}×</small></span>
          <span class="rl-bars-track"><span class="rl-bars-fill${i === 0 ? " is-best" : ""}" style="--w:${Math.max(3, Math.round((x.revenue / maxRev) * 100))}%"></span></span>
          <span class="rl-bars-val">Rp ${esc(compactNum(x.revenue))}</span></li>`).join("")}</ul>` : ""}
      ${d.sales.sources.length ? `<div class="rl-chips"><small>${t("rep.sales.from")}</small>${d.sales.sources.map((x) => `<span>${esc(x.name)} <b>${rp(x.revenue)}</b></span>`).join("")}</div>` : ""}
    </div>` : "";
  return `
    <section class="rl-stop rl-reveal" data-stop="audience">
      ${stopHead(n, title)}
      <div class="rl-aud">${followerCards ? `<div class="rl-aud-followers rl-stagger">${followerCards}</div>` : ""}${salesCard}</div>
    </section>`;
}

function goalsStop(n, d, brand) {
  const goalsPath = appByKey("campaigns").path(brand.id);
  if (!d.campaignRows.length) {
    return `
      <section class="rl-stop rl-reveal" data-stop="goals">
        ${stopHead(n, t("rl.goals.title"))}
        <div class="rl-card rl-soft">
          <p>${t("rl.goals.empty")}</p>
          <a class="rl-ghost" href="${goalsPath}"><span>${t("rl.goals.open")}</span>${icon("arrowRight", { size: 14 })}</a>
        </div>
      </section>`;
  }
  return `
    <section class="rl-stop rl-reveal" data-stop="goals">
      ${stopHead(n, t("rl.goals.title"), t("rl.goals.sub"))}
      <div class="rl-goals rl-stagger">${d.campaignRows.map((c, i) => {
        const pct = c.total ? (c.met / c.total) * 100 : 0;
        return `
        <a class="rl-card rl-goal" href="${goalsPath}" style="--i:${i}">
          ${c.total
            ? `<div class="rl-ring is-small">${ringSVG({ pct, size: 92, stroke: 10, gradientId: `rl-g-${i}` })}<div class="rl-ring-mid"><b>${c.met}/${c.total}</b></div></div>`
            : `<span class="rl-goal-icon" aria-hidden="true">${icon("flag", { size: 30 })}</span>`}
          <div class="rl-goal-text"><b>${esc(campaignDisplayName(c.name))}</b><small>${esc(t("rl.goals.stage", { stage: c.stage }))}</small>${c.head ? `<span>${esc(c.head)}</span>` : ""}</div>
        </a>`;
      }).join("")}</div>
    </section>`;
}

function nextStop(n, d, brand) {
  const createPath = appByKey("content-os").path(brand.id);
  const notes = d.highlights.filter(Boolean);
  return `
    <section class="rl-stop rl-reveal" data-stop="next">
      ${stopHead(n, t("rl.next.title"))}
      <div class="rl-two">
        <div class="rl-card rl-next">
          ${d.next ? `<span class="rl-eyebrow">${icon("arrowRight", { size: 13 })}${t("rl.next.step")}</span><b class="rl-next-title">${esc(d.next.title)}</b>${d.next.why ? `<p>${esc(d.next.why)}</p>` : ""}` : ""}
          ${notes.length ? `<ul class="rl-notes">${notes.map((x) => `<li>${icon("bulb", { size: 14 })}<span>${esc(x)}</span></li>`).join("")}</ul>` : ""}
          ${!d.next && !notes.length ? `<p>${t("rl.next.none")}</p>` : ""}
        </div>
        <div class="rl-card rl-upcoming">
          <h3>${t("rl.next.upcoming")}</h3>
          ${d.upcoming.length ? `<ul class="rl-tl rl-stagger">${d.upcoming.map((c, i) => {
            const dt = new Date(c.scheduleDate + "T12:00:00");
            return `<li style="--i:${i}"><span class="rl-tl-date"><b>${dt.getDate()}</b><small>${esc(dt.toLocaleDateString(locale(), { month: "short" }))}</small></span><span class="rl-tl-title">${esc(c.title || t("common.untitled"))}</span>${c.funnel ? `<span class="rl-tl-pill"><i style="background:${FUNNEL_VAR[c.funnel] || "var(--text-faint)"}"></i>${esc(funnelShort(c.funnel))}</span>` : ""}</li>`;
          }).join("")}</ul>` : `<p class="rl-muted">${t("rl.next.noneScheduled")}</p><a class="rl-ghost" href="${createPath}"><span>${t("rl.empty.create")}</span>${icon("arrowRight", { size: 14 })}</a>`}
        </div>
      </div>
    </section>`;
}

function aiStop(n, d, ai) {
  if (!ai.on) return "";
  const hasPosts = d.publishedCount || d.sales.count;
  if (!ai.advice && !hasPosts) return "";
  let body;
  if (ai.busy) body = `<div class="rl-card rl-ai-wait">${loadingHTML(t("rep3.aiBusy"))}</div>`;
  else if (ai.advice) {
    const a = ai.advice;
    body = `
      <div class="rl-ai rl-glow">
        <div class="rl-ai-head"><span class="rl-ai-icon">${icon("sparkle", { size: 18 })}</span><small>${esc(t("rep3.aiSub", { date: formatDate(localISODate(new Date(a.at || Date.now()))) }))}</small></div>
        ${a.summary ? `<p class="rl-ai-summary">${esc(a.summary)}</p>` : ""}
        ${a.working?.length ? `<div class="rl-ai-label">${t("rep3.aiWorking")}</div><ul class="rl-ai-work">${a.working.map((w) => `<li>${icon("check", { size: 13 })}<span>${esc(w)}</span></li>`).join("")}</ul>` : ""}
      </div>
      <div class="rl-ai-label is-out">${t("rep3.aiNext")}</div>
      <ol class="rl-ai-acts rl-stagger">${a.actions.map((x, i) => `
        <li class="rl-card" style="--i:${i}"><span class="rl-ai-n">${i + 1}</span><div><b>${esc(x.title)}</b>${x.why ? `<small>${esc(x.why)}</small>` : ""}${x.how ? `<p>${esc(x.how)}</p>` : ""}</div></li>`).join("")}</ol>
      <div class="rl-ai-foot"><p class="rl-hint">${t("rep3.aiNote")}</p><button type="button" class="rl-ghost" id="rl-ai-go">${icon("refresh", { size: 13 })}<span>${t("rep3.aiAgain")}</span></button></div>`;
  } else {
    body = `
      <div class="rl-card rl-ai-ask">
        <span class="rl-ai-icon">${icon("sparkle", { size: 20 })}</span>
        <div><b>${t("rl.ai.askTitle")}</b><p>${t("rl.ai.askBody")}</p></div>
        <button type="button" class="rl-cta" id="rl-ai-go"><span>${t("rep3.aiGo")}</span><span class="rl-cta-dot">${icon("sparkle", { size: 15 })}</span></button>
      </div>`;
  }
  return `
    <section class="rl-stop rl-reveal" data-stop="ai">
      ${stopHead(n, t("rep3.ai"))}
      ${ai.error ? `<p class="rl-ai-err">${esc(ai.error)}</p>` : ""}
      ${body}
    </section>`;
}

function endHTML() {
  return `
    <section class="rl-end rl-glow rl-reveal" data-stop="end">
      <div class="rl-end-art" aria-hidden="true">${appIconSVG("report")}</div>
      <div class="rl-end-text">
        <h2>${t("rl.end.title")}</h2>
        <p>${t("rl.end.sub")}</p>
        <button type="button" class="rl-cta" data-open-pdf><span>${t("rl.download")}</span><span class="rl-cta-dot">${icon("download", { size: 16 })}</span></button>
      </div>
    </section>`;
}

// ---------- The page ----------

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const app = appByKey("report");
  const st = loadRange();
  const ai = { on: hasAiKey(getSettings().ai || {}), busy: false, error: "", advice: null, made: new Map() };
  let undoMotion = () => {};
  // What has already arrived on screen: a repaint because the data changed
  // (sales loading in, advice made in the PDF window) shows those stops as
  // they are instead of playing their entrance again.
  const seen = new Set();
  let lastSig = "";
  const sigNow = (b, state) => `${state.sig}|${b.reportAdvice?.at || ""}|${b.name}|${String(b.avatar || "").length}`;

  root.innerHTML = `
    <div class="rl" style="--rl-a:${app.color};--rl-b:${app.color2}">
      <div class="rl-top">
        <div class="rl-top-title">
          <span class="rl-top-mark" aria-hidden="true">${icon("chart", { size: 20 })}</span>
          <h1>${t("rpage.title")}</h1>
          <span class="rl-top-help">${guideVideoButtonHTML("report")}</span>
        </div>
        <button type="button" class="rl-dl" id="rl-download" data-open-pdf>
          <span class="rl-dl-dot" aria-hidden="true">${icon("download", { size: 18 })}</span>
          <span class="rl-dl-text"><b>${t("rl.download")}</b><small>${t("rl.downloadSub")}</small></span>
        </button>
      </div>
      <div class="rl-range" id="rl-range"></div>
      <div id="rl-body"></div>
    </div>`;
  const rangeBox = qs("#rl-range", root);
  const body = qs("#rl-body", root);

  const rangeHTML = () => `
    <div class="chip-select rl-range-chips" role="group" aria-label="${esc(t("rpage.tour.range.title"))}">
      ${RANGES.map((k) => `<button type="button" data-range="${k}" class="${st.key === k ? "active" : ""}" aria-pressed="${st.key === k}">${t(`rep.range.${k}`)}</button>`).join("")}
    </div>
    ${st.key === "custom" ? `<div class="rl-dates"><label>${t("rep.range.start")}<input class="input" type="date" id="rl-start" value="${st.start}" /></label><label>${t("rep.range.end")}<input class="input" type="date" id="rl-end" value="${st.end}" /></label></div>` : ""}`;

  const setRange = (key) => {
    st.key = key;
    if (key !== "custom") Object.assign(st, rangeFor(key));
    saveRange(st);
    paintRange();
    paint();
  };
  function paintRange() {
    rangeBox.innerHTML = rangeHTML();
    qsa("[data-range]", rangeBox).forEach((b) => b.addEventListener("click", () => setRange(b.dataset.range)));
    const onDate = () => {
      const s = qs("#rl-start", rangeBox)?.value;
      const e = qs("#rl-end", rangeBox)?.value;
      if (!s || !e || s > e) return;
      st.start = s;
      st.end = e;
      saveRange(st);
      paint();
    };
    qs("#rl-start", rangeBox)?.addEventListener("change", onDate);
    qs("#rl-end", rangeBox)?.addEventListener("change", onDate);
  }

  // The charts are drawn at the width they get, and again when that changes.
  const trend = { series: null, geo: null };
  const er = { series: null, geo: null };
  const pointName = (series, pt) => (series.unit === "post" ? pt.title || t("common.untitled") : series.unit === "week" ? t("rl.trend.weekOf", { date: dayMonth(pt.date) }) : new Date(pt.date + "T12:00:00").toLocaleDateString(locale(), { month: "long", year: "numeric" }));
  const pointLabel = (series, pt) => (series.unit === "month" ? new Date(pt.date + "T12:00:00").toLocaleDateString(locale(), { month: "short" }) : dayMonth(pt.date));
  function drawTrend() {
    const box = qs("#rl-trend", body);
    if (!box || !trend.series) return;
    const width = box.clientWidth;
    if (!width) return;
    trend.geo = trendChartSVG({
      width,
      points: trend.series.points.map((pt) => ({ ...pt, label: pointLabel(trend.series, pt) })),
      labels: { views: t("store.metric.views"), inter: t("rl.kpi.inter"), aria: t("rl.trend.aria") },
      peakLabel: t("rl.trend.peak"),
    });
    box.innerHTML = `${trend.geo.svg}<div class="rl-tip" role="status" hidden></div>`;
  }
  function drawEr() {
    const box = qs("#rl-er", body);
    if (!box || !er.series) return;
    const width = box.clientWidth;
    if (!width) return;
    const scale = getSettings().erScale || ER_SCALE;
    er.geo = erChartSVG({
      width,
      points: er.series.points.map((pt) => ({ ...pt, label: pointLabel(er.series, pt) })),
      guide: scale.good,
      fmt: (v) => formatPercent(v),
      labels: { aria: t("rl.er.aria"), peak: t("rl.trend.peak"), guide: t("rl.er.guide", { good: scale.good }) },
    });
    box.innerHTML = `${er.geo.svg}<div class="rl-tip" role="status" hidden></div>`;
  }
  // Point at a chart (or the arrow keys): a crosshair, the point's dot and
  // a tooltip, text only (titles are the owner's own words). `chart`: its
  // { series, geo }; `rowsOf(pt)`: the tooltip's [key, label, value] rows.
  function wireHover(sel, chart, rowsOf) {
    const box = qs(sel, body);
    if (!box) return;
    let idx = -1;
    const show = (i) => {
      const { geo, series } = chart;
      if (!geo || i < 0 || i >= series.points.length) return;
      idx = i;
      const pt = series.points[i];
      const svg = qs("svg", box);
      const x = geo.xs[i];
      const cross = qs(".rl-x", svg);
      cross.setAttribute("x1", x);
      cross.setAttribute("x2", x);
      svg.classList.add("is-hover");
      const dot = qs(".rl-hdot", svg);
      if (geo.ys[i] !== null) { dot.setAttribute("cx", x); dot.setAttribute("cy", geo.ys[i]); dot.style.display = ""; } else dot.style.display = "none";
      qsa(".rl-bar", svg).forEach((b) => b.classList.toggle("is-hover", Number(b.dataset.i) === i));
      const tip = qs(".rl-tip", box);
      tip.textContent = "";
      const head = document.createElement("div");
      head.className = "rl-tip-head";
      head.textContent = pointName(series, pt);
      const sub = document.createElement("div");
      sub.className = "rl-tip-sub";
      sub.textContent = series.unit === "post" ? [dayMonth(pt.date), pt.format].filter(Boolean).join(" · ") : t(pt.n === 1 ? "rl.posts.one" : "rl.posts", { n: pt.n });
      tip.append(head, sub);
      rowsOf(pt).forEach(([kind, label, text]) => {
        const row = document.createElement("div");
        row.className = "rl-tip-row";
        const key = document.createElement("i");
        key.className = `rl-key-${kind}`;
        const val = document.createElement("b");
        val.textContent = text;
        const name = document.createElement("span");
        name.textContent = label;
        row.append(key, val, name);
        tip.append(row);
      });
      tip.hidden = false;
      const w = tip.offsetWidth;
      const left = Math.min(box.clientWidth - w - 4, Math.max(4, x - w / 2));
      const top = geo.ys[i] !== null ? Math.max(0, geo.ys[i] - tip.offsetHeight - 16) : 8;
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    };
    const hide = () => {
      idx = -1;
      const svg = qs("svg", box);
      svg?.classList.remove("is-hover");
      qsa(".rl-bar.is-hover", box).forEach((b) => b.classList.remove("is-hover"));
      const tip = qs(".rl-tip", box);
      if (tip) tip.hidden = true;
    };
    const indexAt = (clientX) => {
      const r = box.getBoundingClientRect();
      const i = Math.floor((clientX - r.left - chart.geo.padL) / chart.geo.band);
      return Math.max(0, Math.min(chart.series.points.length - 1, i));
    };
    box.addEventListener("pointermove", (e) => { if (chart.geo) show(indexAt(e.clientX)); });
    box.addEventListener("pointerleave", hide);
    box.addEventListener("blur", hide);
    box.addEventListener("keydown", (e) => {
      const last = chart.series.points.length - 1;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = idx < 0 ? (e.key === "ArrowRight" ? 0 : last) : idx + (e.key === "ArrowRight" ? 1 : -1);
        show(Math.max(0, Math.min(last, next)));
      } else if (e.key === "Escape") hide();
    });
  }
  const trendRows = (pt) => [["line", t("store.metric.views"), pt.views === null ? t("rl.trend.empty") : formatNumber(pt.views)], ["bar", t("rl.kpi.inter"), pt.inter === null ? t("rl.trend.empty") : formatNumber(pt.inter)]];
  const erRows = (pt) => [["er", "ER", pt.er === null ? t("rl.er.none") : formatPercent(pt.er)]];

  function paint({ quiet = false } = {}) {
    undoMotion();
    if (!quiet) seen.clear();
    const b = getBrand(brandId);
    if (!b) return;
    const d = computeReportData(b, st.start, st.end);
    const prevR = previousRange(st.start, st.end);
    const p = prevR ? computeReportData(b, prevR.start, prevR.end) : null;
    const now = reportAdviceState(brandId, st.start, st.end);
    ai.state = now;
    lastSig = sigNow(b, now);
    ai.advice = ai.made.get(now.sig) || now.advice;
    trend.series = trendSeries(d);
    er.series = erSeries(d, trend.series);

    if (!d.publishedCount && !d.sales.count) {
      body.innerHTML = emptyHTML(b, st);
    } else {
      let n = 0;
      const stops = [
        (k) => trendStop(k, d, trend.series),
        (k) => erStop(k, d, p, er.series),
        (k) => analyticsStop(k, d),
        (k) => bestStop(k, d, b),
        (k) => rhythmStop(k, d, st),
        (k) => mixStop(k, d),
        (k) => audienceStop(k, d, p, b, st),
        (k) => goalsStop(k, d, b),
        (k) => nextStop(k, d, b),
        (k) => aiStop(k, d, ai),
      ];
      const html = stops.map((fn) => {
        const out = fn(n + 1);
        if (out) n += 1;
        return out;
      }).join("");
      body.innerHTML = `${heroHTML(b, st, d, p, prevR)}<div class="rl-journey"><div class="rl-rail" aria-hidden="true"><span></span></div>${html}</div>${endHTML()}`;
    }
    qsa("[data-range-go]", body).forEach((el) => el.addEventListener("click", () => setRange(el.dataset.rangeGo)));
    qsa("[data-open-pdf]", body).forEach((el) => el.addEventListener("click", openPdf));
    qs("#rl-ai-go", body)?.addEventListener("click", makeAdvice);
    drawTrend();
    drawEr();
    wireHover("#rl-trend", trend, trendRows);
    wireHover("#rl-er", er, erRows);
    undoMotion = mountMotion(body, seen);
  }

  async function makeAdvice() {
    if (ai.busy) return;
    ai.busy = true;
    ai.error = "";
    paintAiOnly();
    try {
      const saved = await requestReportAdvice(brandId, { start: st.start, end: st.end, snapshot: ai.state.snapshot, sig: ai.state.sig });
      ai.made.set(ai.state.sig, saved);
    } catch (e) {
      ai.error = e instanceof AiApiError ? e.message : t("rep3.aiErr");
      toast(ai.error, "error");
    } finally {
      ai.busy = false;
      // The rest of the page stays as read; the advice makes its entrance.
      seen.delete("ai");
      if (root.isConnected) paint({ quiet: true });
      qs('[data-stop="ai"]', body)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    }
  }
  // While the AI works, only its stop changes (the rest stays put).
  function paintAiOnly() {
    const old = qs('[data-stop="ai"]', body);
    if (!old) return;
    const n = Number(qs(".rl-node", old)?.textContent) || 1;
    const b = getBrand(brandId);
    const tmp = document.createElement("div");
    tmp.innerHTML = aiStop(n, computeReportData(b, st.start, st.end), ai);
    const next = tmp.firstElementChild;
    if (next) { next.classList.add("is-in", "rl-quiet"); old.replaceWith(next); }
  }

  function openPdf() {
    openReportModal(brandId, { range: st.key, start: st.start, end: st.end });
  }
  qs("#rl-download", root).addEventListener("click", openPdf);

  // The light on a gradient block follows the mouse (--mx/--my).
  const onPointer = (e) => {
    const block = e.target.closest?.(".rl-glow");
    if (!block) return;
    const r = block.getBoundingClientRect();
    block.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
    block.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
  };
  root.addEventListener("pointermove", onPointer);

  let resizeTimer = 0;
  let lastWidth = qs("#rl-body", root)?.clientWidth || 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = body.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      drawTrend();
      drawEr();
    }, 120);
  };
  window.addEventListener("resize", onResize);

  // Numbers that change while the page is open (sales arriving, a post's
  // numbers filled in elsewhere, advice made in the PDF window) show up.
  const offChange = onChange(() => {
    if (!root.isConnected || ai.busy) return;
    const b = getBrand(brandId);
    if (b && sigNow(b, reportAdviceState(brandId, st.start, st.end)) !== lastSig) paint({ quiet: true });
  });

  paintRange();
  paint();
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
  return () => {
    offChange();
    undoMotion();
    window.removeEventListener("resize", onResize);
    clearTimeout(resizeTimer);
  };
}

// ---------- Motion: the journey arrives as it scrolls ----------
//
// Each stop rises in when it reaches the screen (.rl-reveal → .is-in), its
// numbers count up from zero, its chart draws in. The rail on the left
// fills as the page is read. With reduced motion everything is simply
// there, at its final numbers.
function mountMotion(body, seen = new Set()) {
  const reveals = qsa(".rl-reveal", body);
  const rail = qs(".rl-journey", body);
  // Stops already read stay as they are: no second entrance, no recount.
  const quiet = reveals.filter((el) => seen.has(el.dataset.stop));
  quiet.forEach((el) => el.classList.add("is-in", "rl-quiet"));
  const unquiet = quiet.length ? setTimeout(() => quiet.forEach((el) => el.classList.remove("rl-quiet")), 80) : 0;
  if (reduceMotion() || typeof IntersectionObserver !== "function") {
    reveals.forEach((el) => el.classList.add("is-in"));
    rail?.style.setProperty("--rl-progress", "1");
    return () => clearTimeout(unquiet);
  }
  body.classList.add("rl-anim");
  const counters = new Map();
  qsa(".rl-reveal:not(.is-in) [data-count]", body).forEach((el) => {
    counters.set(el, el.textContent);
    el.textContent = (FMT[el.dataset.fmt] || FMT.num)(0);
  });
  const timers = new Set();
  const countUp = (el) => {
    const final = counters.get(el);
    if (final === undefined) return;
    counters.delete(el);
    const target = Number(el.dataset.count) || 0;
    const fmt = FMT[el.dataset.fmt] || FMT.num;
    const t0 = performance.now();
    const dur = 1100;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? final : fmt(target * eased);
      if (k < 1) timers.add(setTimeout(step, 16));
    };
    step();
  };
  const reveal = (el) => {
    seen.add(el.dataset.stop);
    el.classList.add("is-in");
    qsa("[data-count]", el).forEach(countUp);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      reveal(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  reveals.filter((el) => !seen.has(el.dataset.stop)).forEach((el) => io.observe(el));

  // The rail fills to where the reader is.
  let ticking = false;
  const onScroll = () => {
    if (ticking || !rail) return;
    ticking = true;
    setTimeout(() => {
      ticking = false;
      const r = rail.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (window.innerHeight * 0.6 - r.top) / Math.max(1, r.height)));
      rail.style.setProperty("--rl-progress", k.toFixed(3));
    }, 16);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return () => {
    clearTimeout(unquiet);
    io.disconnect();
    window.removeEventListener("scroll", onScroll);
    timers.forEach((id) => clearTimeout(id));
  };
}
