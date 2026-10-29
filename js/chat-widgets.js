// Charts under a Konsultan answer in "Tanya Brandlab" (js/consultant-panel.js).
// "Gimana performa kontenku bulan ini?" used to get a wall of numbers in
// prose; now the answer explains and a widget shows. The model only picks
// WHICH widget fits the question — [[widget:performance|30]], parsed by
// js/ai-directives.js — and every number is worked out here from the brand's
// own data at the moment of the answer, then frozen on the message: a chart
// never shows a number the model made up, and an old answer keeps showing
// what it talked about. The same numbers go into the Konsultan's prompt
// (widgetFactsText), so the words and the chart agree.
// Data functions are pure (tests/chat-widgets.test.mjs); the renderers are
// plain HTML + a little SVG, no chart library. Colours follow the Report
// page's (css/report.css --rl-line / --rl-bar), one hue per chart.
import { contentMetric, organicViews, ER_SCALE, FUNNELS, localISODate } from "./store.js";
import { computeContentMetrics } from "./formulas.js";
import { getTracker, weeklySeries } from "./sales-tracker.js";
import { brandRetentionStats, benchmarksFor } from "./retention.js";
import { campaignStages, activeStageIndex, readStage, campaignHeadline } from "./campaign-metrics.js";
import { nextActions } from "./next-action.js";
import { interactionsOf } from "./report-journey.js";
import { t, getLang, campaignDisplayName } from "./i18n.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, formatNumber, formatPercent, formatDate } from "./dom.js";
import { funnelShort } from "./funnel-field.js";

export const WIDGET_KINDS = ["performance", "engagement", "top-posts", "formats", "funnel", "followers", "sales", "retention", "schedule", "campaign"];
export const WIDGET_PERIODS = ["7", "30", "90", "all"];
export const DEFAULT_PERIOD = "30";
export const MAX_WIDGETS = 2;
const MAX_POINTS = 24;
const DAY = 86400000;
const ALL_START = "2000-01-01";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const sum = (list) => list.reduce((a, b) => a + b, 0);
const noon = (iso) => new Date(`${iso}T12:00:00`);
const shift = (iso, days) => localISODate(new Date(noon(iso).getTime() + days * DAY));
const dateOf = (c) => c.publishedDate || c.scheduleDate || "";
const live = (c) => !c.archived && !c.deletedAt;

// "30" → the last 30 days up to today, and the 30 before it (null for "all").
export function periodRange(period = DEFAULT_PERIOD, today = localISODate()) {
  const key = WIDGET_PERIODS.includes(String(period)) ? String(period) : DEFAULT_PERIOD;
  if (key === "all") return { key, start: ALL_START, end: today, prev: null };
  const n = Number(key);
  const start = shift(today, -(n - 1));
  return { key, start, end: today, prev: { start: shift(start, -n), end: shift(start, -1) } };
}

// Published posts dated inside [start, end], oldest first, with the numbers
// a chart needs (null = the owner didn't fill that one in).
export function postRows(content, settings, start, end) {
  return content
    .filter((c) => live(c) && c.status === "published" && dateOf(c) && dateOf(c) >= start && dateOf(c) <= end)
    .map((c) => {
      const m = computeContentMetrics(c, settings);
      const nums = Object.fromEntries(["likes", "comments", "shares", "saves", "reposts"].map((k) => [k, contentMetric(c, k)]));
      return {
        id: c.id, title: c.title || "", date: dateOf(c), format: (c.format || "").trim(), funnel: c.funnel || "",
        views: organicViews(c) ?? null, reach: contentMetric(c, "reach"), inter: interactionsOf(nums),
        er: isNum(m.engagementRate) ? m.engagementRate : null, health: m.health || null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function totals(rows) {
  const views = rows.map((r) => r.views).filter(isNum);
  const inter = rows.map((r) => r.inter).filter(isNum);
  const ers = rows.map((r) => r.er).filter(isNum);
  return { posts: rows.length, views: views.length ? sum(views) : null, inter: inter.length ? sum(inter) : null, er: avg(ers), rated: ers.length };
}

const slimPost = (r) => ({ id: r.id, title: r.title.slice(0, 80), date: r.date, format: r.format.slice(0, 30), views: r.views, er: r.er });

// One widget's frozen data, or null for an unknown kind. `ctx`: { brand,
// content, campaigns, settings, today }. A widget with nothing to draw comes
// back { empty: true } — it still renders, as "fill this in" with a link.
export function computeWidget({ kind, period = DEFAULT_PERIOD, arg = "" }, ctx) {
  if (!WIDGET_KINDS.includes(kind)) return null;
  const { brand, content = [], campaigns = [], settings = {}, today = localISODate() } = ctx;
  const range = periodRange(period, today);
  const base = { kind, period: range.key, start: range.start, end: range.end, at: today };
  const rows = postRows(content, settings, range.start, range.end);
  const prevRows = range.prev ? postRows(content, settings, range.prev.start, range.prev.end) : null;
  const scale = settings.erScale || ER_SCALE;

  if (kind === "performance") {
    const now = totals(rows);
    const before = prevRows ? totals(prevRows) : null;
    const pts = rows.filter((r) => isNum(r.views)).slice(-MAX_POINTS).map((r) => ({ t: r.title.slice(0, 60), d: r.date, v: r.views }));
    return { ...base, empty: !rows.length, now, before, points: pts };
  }
  if (kind === "engagement") {
    const rated = rows.filter((r) => isNum(r.er));
    const mix = { excellent: 0, good: 0, average: 0, poor: 0 };
    rated.forEach((r) => { if (r.health in mix) mix[r.health] += 1; });
    const beforeEr = prevRows ? avg(prevRows.map((r) => r.er).filter(isNum)) : null;
    return { ...base, empty: !rated.length, avg: avg(rated.map((r) => r.er)), before: beforeEr, good: scale.good, excellent: scale.excellent, mix, unrated: rows.length - rated.length, points: rated.slice(-MAX_POINTS).map((r) => ({ t: r.title.slice(0, 60), d: r.date, v: Math.round(r.er * 100) / 100 })) };
  }
  if (kind === "top-posts") {
    const byViews = rows.filter((r) => isNum(r.views)).sort((a, b) => b.views - a.views);
    const byEr = rows.filter((r) => isNum(r.er)).sort((a, b) => b.er - a.er);
    const metric = byViews.length ? "views" : "er";
    const list = (metric === "views" ? byViews : byEr).slice(0, 5).map(slimPost);
    return { ...base, empty: !list.length, metric, posts: list };
  }
  if (kind === "formats" || kind === "funnel") {
    const keyOf = kind === "formats" ? (r) => r.format : (r) => r.funnel;
    const groups = new Map();
    rows.forEach((r) => {
      const k = keyOf(r) || "";
      const g = groups.get(k) || { name: k, n: 0, ers: [], views: [] };
      g.n += 1;
      if (isNum(r.er)) g.ers.push(r.er);
      if (isNum(r.views)) g.views.push(r.views);
      groups.set(k, g);
    });
    let list = [...groups.values()].map((g) => ({ name: g.name, n: g.n, er: avg(g.ers), views: avg(g.views) }));
    if (kind === "funnel") list = FUNNELS.map((f) => list.find((g) => g.name === f) || { name: f, n: 0, er: null, views: null });
    else list.sort((a, b) => (b.er ?? -1) - (a.er ?? -1) || b.n - a.n);
    return { ...base, empty: !rows.length, groups: list.slice(0, 6) };
  }
  if (kind === "followers") {
    const startMs = noon(range.start).getTime() - 12 * 3600000;
    const byPlatform = new Map();
    (brand?.insightsHistory || []).forEach((h) => {
      if (!isNum(h.followers) || !h.platform) return;
      if (!byPlatform.has(h.platform)) byPlatform.set(h.platform, []);
      byPlatform.get(h.platform).push(h);
    });
    const platforms = [...byPlatform].map(([platform, list]) => {
      const sorted = [...list].sort((a, b) => a.at - b.at);
      const last = sorted[sorted.length - 1];
      const before = [...sorted].reverse().find((h) => h.at < startMs) || sorted.find((h) => h.at >= startMs && h !== last) || null;
      return { platform, now: last.followers, at: localISODate(new Date(last.at)), delta: before && before !== last ? last.followers - before.followers : null, series: sorted.slice(-12).map((h) => h.followers) };
    });
    return { ...base, empty: !platforms.length, platforms };
  }
  if (kind === "sales") {
    const tracker = getTracker(brand || {});
    const inR = (e, s, en) => e.date >= s && e.date <= en;
    const tot = (list) => ({ count: list.length, qty: sum(list.map((e) => e.qty || 0)), revenue: sum(list.map((e) => e.amount || 0)) });
    const entries = tracker.entries.filter((e) => inR(e, range.start, range.end));
    const before = range.prev ? tot(tracker.entries.filter((e) => inR(e, range.prev.start, range.prev.end))) : null;
    const byProduct = new Map();
    entries.forEach((e) => {
      const name = tracker.products.find((p) => p.id === e.productId)?.name || "—";
      const r = byProduct.get(name) || { name, qty: 0, revenue: 0 };
      r.qty += e.qty || 0; r.revenue += e.amount || 0;
      byProduct.set(name, r);
    });
    const weeks = weeklySeries(tracker, 8, noon(today)).map((w) => ({ d: w.from, v: w.revenue, q: w.qty }));
    return { ...base, empty: !tracker.entries.length, now: tot(entries), before, weeks, products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 3) };
  }
  if (kind === "retention") {
    const pub = content.filter((c) => live(c) && c.status === "published" && dateOf(c) >= range.start && dateOf(c) <= range.end);
    const s = brandRetentionStats(pub);
    const bench = benchmarksFor(avg(s.rows.map((x) => x.a.videoLengthSec).filter(isNum)));
    const one = (x) => (x ? { title: (x.c.title || "").slice(0, 60), hook: x.a.hookPct } : null);
    return { ...base, empty: !s.n, n: s.n, hook: s.hook, watch: s.watch, completion: s.completion, bench: { hook: bench.hook.good, watch: bench.watchPct.good, completion: bench.completionPct.good }, best: one(s.best), weakest: s.weakest !== s.best ? one(s.weakest) : null };
  }
  if (kind === "schedule") {
    const days = Array.from({ length: 7 }, (_, i) => shift(today, i));
    const planned = content.filter((c) => live(c) && c.status !== "published" && c.scheduleDate);
    const overdue = planned.filter((c) => c.scheduleDate < today).length;
    return {
      ...base, period: "7", start: today, end: days[6], empty: false, overdue,
      days: days.map((d) => ({ d, items: planned.filter((c) => c.scheduleDate === d).slice(0, 3).map((c) => ({ title: (c.title || "").slice(0, 60), status: c.status || "" })) })),
    };
  }
  if (kind === "campaign") {
    const list = campaigns.filter((c) => c.status !== "archived");
    const c = list.find((x) => x.id === arg) || (list.length === 1 ? list[0] : null);
    if (!c) return { ...base, empty: true, campaignId: "" };
    const stages = campaignStages(c);
    const idx = activeStageIndex(c, stages, content);
    const stage = stages[idx];
    const cctx = { brand, campaign: c, content, settings };
    const { met = 0, total = 0 } = stage ? readStage(stage, cctx) : {};
    const head = stage ? campaignHeadline(c, stages, idx, cctx) : null;
    return {
      ...base, empty: false, campaignId: c.id, name: c.name || "", stage: stage?.name || "", stageNo: stage ? idx + 1 : 0, stages: stages.length, met, total,
      head: head?.reading?.target && !head.reading.isCheck ? { label: head.milestone.label, current: head.reading.current, target: head.reading.target } : null,
      next: stage ? nextActions({ ...cctx, limit: 3 }).map((a) => a.label) : [],
    };
  }
  return null;
}

export function computeWidgets(requests = [], ctx) {
  const seen = new Set();
  return requests
    .filter((r) => { const k = `${r.kind}|${r.period}|${r.arg}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_WIDGETS)
    .map((r) => computeWidget(r, ctx))
    .filter(Boolean)
    // Stored on the message in Firestore: no undefined, no NaN.
    .map((w) => JSON.parse(JSON.stringify(w)));
}

// ---- What the model reads -------------------------------------------------

// The widget menu for the Konsultan's prompt: each kind, what it shows, and
// whether this brand has the data for it — the model never asks for an
// empty chart when it can tell the owner what to fill in instead.
export function widgetMenuText(ctx) {
  const { brand, content = [], campaigns = [], settings = {} } = ctx;
  const all = postRows(content, settings, ALL_START, "9999-12-31");
  const has = {
    performance: all.length > 0,
    engagement: all.some((r) => isNum(r.er)),
    "top-posts": all.some((r) => isNum(r.views) || isNum(r.er)),
    formats: all.length > 1,
    funnel: all.length > 1,
    followers: (brand?.insightsHistory || []).some((h) => isNum(h.followers)),
    sales: getTracker(brand || {}).entries.length > 0,
    retention: brandRetentionStats(content.filter((c) => c.status === "published")).n > 0,
    schedule: true,
    campaign: campaigns.some((c) => c.status !== "archived"),
  };
  const what = {
    performance: "posts published, total views, interactions and average engagement rate vs the period before, plus views per post",
    engagement: "engagement rate per post against the brand's ER scale, and how many posts are excellent/healthy/average/poor",
    "top-posts": "the 5 best posts of the period (by views, else by ER)",
    formats: "average ER and views per format (Reels, Carousel…) — what format works",
    funnel: "posts and average ER per funnel stage (awareness / trust / buying)",
    followers: "followers per platform now, the change over the period, and the line of logged follower counts",
    sales: "sales revenue and units in the period vs before, weekly revenue bars (8 weeks), top products",
    retention: "average hook (3s), watch % and completion % vs benchmarks, best and weakest hook",
    schedule: "the next 7 days: what is scheduled each day, empty days, overdue count (period ignored)",
    campaign: "one campaign's stage, milestones met, headline target progress and next steps — use [[widget:campaign|CAMPAIGN_ID]]",
  };
  return WIDGET_KINDS.map((k) => `- ${k}: ${what[k]}${has[k] ? "" : " (NO DATA YET — don't use it)"}`).join("\n");
}

// The same numbers the performance widgets would draw, as plain lines for
// the Konsultan's live snapshot (last 30 days vs the 30 before).
export function widgetFactsText(ctx) {
  const { content = [], settings = {}, today = localISODate() } = ctx;
  const r = periodRange("30", today);
  const rows = postRows(content, settings, r.start, r.end);
  const now = totals(rows);
  const before = totals(postRows(content, settings, r.prev.start, r.prev.end));
  const n = (v) => (v === null ? "-" : formatNumber(Math.round(v)));
  const p = (v) => (v === null ? "-" : `${(Math.round(v * 10) / 10).toLocaleString("id-ID")}%`);
  const lines = [
    `30 hari terakhir (${r.start} s/d ${r.end}) vs 30 hari sebelumnya: konten terbit ${now.posts} (sebelumnya ${before.posts}); total views ${n(now.views)} (sebelumnya ${n(before.views)}); total interaksi ${n(now.inter)} (sebelumnya ${n(before.inter)}); rata-rata ER ${p(now.er)} dari ${now.rated} konten berangka (sebelumnya ${p(before.er)}).`,
  ];
  // Every post of the period, best first — "yang paling jelek yang mana?"
  // needs the bottom of the list as much as the top.
  const ranked = [...rows].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.er ?? -1) - (a.er ?? -1));
  const one = (x) => `"${x.title || "(tanpa judul)"}" (${[x.format, x.funnel, x.date].filter(Boolean).join(", ")}): ${x.views === null ? "views belum diisi" : `${n(x.views)} views`}, ER ${p(x.er)}`;
  if (ranked.length) lines.push(`Semua konten terbit 30 hari terakhir, views tertinggi dulu:\n${ranked.slice(0, 15).map((x, i) => `${i + 1}. ${one(x)}`).join("\n")}${ranked.length > 15 ? `\n(+${ranked.length - 15} konten lain)` : ""}`);
  const fm = computeWidget({ kind: "formats", period: "90" }, ctx);
  const withEr = (fm?.groups || []).filter((g) => isNum(g.er) && g.name);
  if (withEr.length > 1) lines.push(`ER rata-rata per format (90 hari): ${withEr.map((g) => `${g.name} ${p(g.er)} (${g.n} konten)`).join(", ")}.`);
  const fl = computeWidget({ kind: "followers", period: "30" }, ctx);
  if (!fl.empty) lines.push(`Followers terakhir dicatat: ${fl.platforms.map((x) => `${x.platform} ${n(x.now)} (${x.at}${x.delta !== null ? `, ${x.delta >= 0 ? "+" : ""}${n(x.delta)} dalam ~30 hari` : ""})`).join(", ")}.`);
  const sl = computeWidget({ kind: "sales", period: "30" }, ctx);
  if (!sl.empty) lines.push(`Penjualan 30 hari terakhir: ${sl.now.count} transaksi, ${n(sl.now.qty)} unit, Rp ${n(sl.now.revenue)} (30 hari sebelumnya Rp ${n(sl.before.revenue)}).`);
  return lines.join("\n");
}

// A widget as it goes back into the chat history: the model sees what it
// showed last time ("yang paling atas itu kenapa?" refers to the chart).
export function widgetHistoryLine(w) {
  const bits = [];
  if (w.kind === "performance" && w.now) bits.push(`posts ${w.now.posts}, views ${w.now.views ?? "-"}, ER ${w.now.er !== null ? w.now.er.toFixed(1) : "-"}%`);
  if (w.kind === "top-posts") bits.push((w.posts || []).map((x, i) => `${i + 1}. ${x.title} (${w.metric === "views" ? `${x.views} views` : `ER ${x.er?.toFixed(1)}%`})`).join("; "));
  if (w.kind === "formats" || w.kind === "funnel") bits.push((w.groups || []).map((g) => `${g.name || "?"} ${g.n} posts${g.er !== null ? ` ER ${g.er.toFixed(1)}%` : ""}`).join("; "));
  if (w.kind === "campaign" && w.name) bits.push(`${w.name}: ${w.met}/${w.total} milestones`);
  return `[[widget:${w.kind}|${w.kind === "campaign" ? w.campaignId : w.period}]]${bits.length && bits[0] ? ` (chart shown: ${bits.join(" ")})` : ""}`;
}

// ---- Rendering --------------------------------------------------------------

const compact = (v) => {
  if (!isNum(v)) return "—";
  const en = getLang() === "en";
  const one = (x) => x.toFixed(x >= 100 ? 0 : 1).replace(/\.0$/, "").replace(".", en ? "." : ",");
  if (Math.abs(v) >= 1e6) return `${one(v / 1e6)}${en ? "M" : " jt"}`;
  if (Math.abs(v) >= 1e4) return `${one(v / 1e3)}${en ? "K" : " rb"}`;
  return formatNumber(Math.round(v));
};
const pct = (v) => (isNum(v) ? formatPercent(v, 1) : "—");
const rp = (v) => `Rp ${compact(v)}`;
const shortDate = (iso) => formatDate(iso, { year: undefined });

function deltaHTML(now, before, { points = false } = {}) {
  if (!isNum(now) || !isNum(before)) return "";
  let txt, up;
  if (points) {
    const d = now - before;
    if (Math.abs(d) < 0.05) return `<span class="chw-delta is-flat">${t("chw.delta.same")}</span>`;
    up = d > 0;
    txt = `${up ? "+" : "−"}${formatPercent(Math.abs(d), 1).replace("%", "")} ${t("chw.delta.pts")}`;
  } else {
    if (!before) return now ? `<span class="chw-delta is-up">▲ ${t("chw.delta.new")}</span>` : "";
    const d = ((now - before) / before) * 100;
    if (Math.abs(d) < 0.5) return `<span class="chw-delta is-flat">${t("chw.delta.same")}</span>`;
    up = d > 0;
    txt = `${up ? "+" : "−"}${Math.round(Math.abs(d))}%`;
  }
  return `<span class="chw-delta ${up ? "is-up" : "is-down"}">${up ? "▲" : "▼"} ${txt}</span>`;
}

// One series over time: an SVG line with a wash (stretched to the box, the
// stroke keeps its width) and HTML dots on top — round at any width, each
// with its own tooltip. `guide`: a dashed reference value (the ER "healthy" mark).
function lineHTML(points, { fmt = compact, guide = null, guideLabel = "", peakLabel = "" } = {}) {
  if (points.length < 2) return "";
  const H = 100;
  const vals = points.map((p) => p.v);
  const max = Math.max(...vals, guide || 0) * 1.12 || 1;
  const xs = points.map((_, i) => (points.length === 1 ? 50 : 3 + (i / (points.length - 1)) * 94));
  const ys = vals.map((v) => H - (v / max) * (H - 8) - 2);
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(" ");
  const peak = vals.indexOf(Math.max(...vals));
  const dots = points.map((p, i) => `<span class="chw-pt${i === peak ? " is-peak" : ""}" style="left:${xs[i]}%;top:${ys[i]}%" tabindex="0" data-tip="${esc(`${p.t || shortDate(p.d)} · ${fmt(p.v)}`)}"></span>`).join("");
  // Near an edge the pill hangs inward from the dot instead of centring on it.
  const side = xs[peak] > 70 ? " is-right" : xs[peak] < 30 ? " is-left" : "";
  const peakTag = `<span class="chw-peak${side}" style="left:${xs[peak]}%;top:${ys[peak]}%">${esc(fmt(vals[peak]))}${peakLabel ? ` · ${esc(peakLabel)}` : ""}</span>`;
  const guideLine = guide ? `<span class="chw-guide" style="top:${H - (guide / max) * (H - 8) - 2}%"><em>${esc(guideLabel)}</em></span>` : "";
  return `
    <div class="chw-line">
      <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path class="chw-area" d="${d} L${xs[xs.length - 1]},${H} L${xs[0]},${H} Z"/>
        <path class="chw-stroke" d="${d}" vector-effect="non-scaling-stroke" pathLength="1"/>
      </svg>
      ${guideLine}${dots}${peakTag}
    </div>
    <div class="chw-axis"><span>${esc(shortDate(points[0].d))}</span><span>${esc(shortDate(points[points.length - 1].d))}</span></div>`;
}

// Horizontal bars, each labelled — the label and value carry the reading,
// the bar the comparison.
function barsHTML(rows, { max = null } = {}) {
  const top = max ?? Math.max(0, ...rows.map((r) => (isNum(r.v) ? r.v : 0)));
  return `<div class="chw-bars">${rows.map((r, i) => `
    <div class="chw-bar-row">
      <span class="chw-bar-name">${r.nameHTML || esc(r.name)}</span>
      <span class="chw-bar-track"><span class="chw-bar-fill${r.hot ? " is-hot" : ""}" style="--w:${top && isNum(r.v) ? Math.max(2, (r.v / top) * 100) : 0}%;--i:${i}"></span></span>
      <span class="chw-bar-val">${r.valHTML ?? esc(r.val)}</span>
    </div>`).join("")}</div>`;
}

function kpiHTML(label, value, delta = "") {
  return `<div class="chw-kpi"><small>${esc(label)}</small><b>${esc(value)}</b>${delta}</div>`;
}

const WIDGET_ICON = { performance: "chart", engagement: "heart", "top-posts": "flame", formats: "grid", funnel: "target", followers: "users", sales: "money", retention: "teleprompter", schedule: "calendar", campaign: "flag" };
// Where the owner goes to dig in or to fill the data in.
function widgetPath(w) {
  if (w.kind === "sales") return "sales";
  if (w.kind === "schedule") return "content/calendar";
  if (w.kind === "campaign") return w.campaignId ? `campaigns/${w.campaignId}` : "campaigns";
  if (w.empty && w.kind === "followers") return "__insights";
  if (w.empty) return "content/list";
  return "report";
}

function periodLabel(w) {
  if (w.kind === "schedule") return t("chw.period.next7");
  if (w.kind === "campaign") return "";
  return w.period === "all" ? t("chw.period.all") : t("chw.period.lastN", { n: w.period });
}

function bodyHTML(w) {
  if (w.empty) return `<p class="chw-empty">${icon("info", { size: 13 })}<span>${esc(t(`chw.empty.${w.kind}`))}</span></p>`;
  if (w.kind === "performance") {
    const b = w.before;
    return `
      <div class="chw-kpis">
        ${kpiHTML(t("chw.kpi.posts"), formatNumber(w.now.posts), b ? deltaHTML(w.now.posts, b.posts) : "")}
        ${kpiHTML(t("chw.kpi.views"), compact(w.now.views), b ? deltaHTML(w.now.views, b.views) : "")}
        ${kpiHTML(t("chw.kpi.inter"), compact(w.now.inter), b ? deltaHTML(w.now.inter, b.inter) : "")}
        ${kpiHTML(t("chw.kpi.er"), pct(w.now.er), b ? deltaHTML(w.now.er, b.er, { points: true }) : "")}
      </div>
      ${w.points.length > 1 ? `<div class="chw-sub">${esc(t("chw.sub.viewsPerPost"))}</div>${lineHTML(w.points, { peakLabel: t("chw.peak") })}` : ""}`;
  }
  if (w.kind === "engagement") {
    const total = w.mix.excellent + w.mix.good + w.mix.average + w.mix.poor;
    const seg = ["excellent", "good", "average", "poor"].filter((k) => w.mix[k]).map((k) => `<span class="chw-seg is-${k}" style="flex:${w.mix[k]}" title="${esc(`${t(`chw.health.${k}`)}: ${w.mix[k]}`)}"></span>`).join("");
    const legend = ["excellent", "good", "average", "poor"].filter((k) => w.mix[k]).map((k) => `<span><i class="is-${k}"></i>${esc(t(`chw.health.${k}`))} ${w.mix[k]}</span>`).join("");
    return `
      <div class="chw-kpis is-two">
        ${kpiHTML(t("chw.kpi.er"), pct(w.avg), isNum(w.before) ? deltaHTML(w.avg, w.before, { points: true }) : "")}
        ${kpiHTML(t("chw.kpi.healthy"), `${w.mix.excellent + w.mix.good}/${total}`)}
      </div>
      ${lineHTML(w.points, { fmt: pct, guide: w.good, guideLabel: t("chw.guide.healthy", { n: w.good }) })}
      ${total ? `<div class="chw-stack">${seg}</div><div class="chw-legend">${legend}</div>` : ""}`;
  }
  if (w.kind === "top-posts") {
    return barsHTML(w.posts.map((p, i) => ({
      nameHTML: `<b>${i + 1}</b> ${esc(p.title || t("common.untitled"))}<small>${esc([p.format, shortDate(p.date)].filter(Boolean).join(" · "))}</small>`,
      v: w.metric === "views" ? p.views : p.er, hot: i === 0,
      valHTML: w.metric === "views" ? `${esc(compact(p.views))}${isNum(p.er) ? `<small>ER ${esc(pct(p.er))}</small>` : ""}` : esc(pct(p.er)),
    })));
  }
  if (w.kind === "formats" || w.kind === "funnel") {
    const useEr = w.groups.some((g) => isNum(g.er));
    const best = useEr ? Math.max(...w.groups.map((g) => g.er ?? -1)) : null;
    return `${barsHTML(w.groups.map((g) => ({
      nameHTML: `${esc(w.kind === "funnel" ? funnelShort(g.name) : g.name || t("chw.noFormat"))}<small>${esc(t("chw.nPosts", { n: g.n }))}</small>`,
      v: useEr ? g.er : g.n, hot: useEr && g.er === best && isNum(best),
      valHTML: useEr ? esc(pct(g.er)) : esc(formatNumber(g.n)),
    })))}<div class="chw-sub is-foot">${esc(useEr ? t("chw.sub.avgEr") : t("chw.sub.count"))}</div>`;
  }
  if (w.kind === "followers") {
    return `<div class="chw-follow">${w.platforms.map((p) => {
      const spark = p.series.length > 1 ? (() => {
        const min = Math.min(...p.series), max = Math.max(...p.series), span = max - min || 1;
        const d = p.series.map((v, i) => `${i ? "L" : "M"}${(i / (p.series.length - 1)) * 100},${36 - ((v - min) / span) * 30 - 3}`).join(" ");
        return `<svg class="chw-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path class="chw-area" d="${d} L100,36 L0,36 Z"/><path class="chw-stroke" d="${d}" vector-effect="non-scaling-stroke" pathLength="1"/></svg>`;
      })() : "";
      return `<div class="chw-follow-card"><small>${esc(p.platform)}</small><b>${esc(compact(p.now))}</b>${isNum(p.delta) ? `<span class="chw-delta ${p.delta > 0 ? "is-up" : p.delta < 0 ? "is-down" : "is-flat"}">${p.delta > 0 ? "▲ +" : p.delta < 0 ? "▼ −" : ""}${esc(formatNumber(Math.abs(p.delta)))}</span>` : ""}${spark}<em>${esc(t("chw.follow.at", { date: shortDate(p.at) }))}</em></div>`;
    }).join("")}</div>`;
  }
  if (w.kind === "sales") {
    const max = Math.max(1, ...w.weeks.map((x) => x.v));
    const peak = w.weeks.findIndex((x) => x.v === max);
    const cols = w.weeks.map((x, i) => `<span class="chw-col${i === peak && x.v ? " is-hot" : ""}" style="--h:${x.v ? Math.max(3, (x.v / max) * 100) : 0}%;--i:${i}" tabindex="0" data-tip="${esc(`${t("chw.weekOf", { date: shortDate(x.d) })} · ${rp(x.v)} · ${formatNumber(x.q)} ${t("chw.units")}`)}"></span>`).join("");
    return `
      <div class="chw-kpis is-two">
        ${kpiHTML(t("chw.kpi.revenue"), rp(w.now.revenue), w.before ? deltaHTML(w.now.revenue, w.before.revenue) : "")}
        ${kpiHTML(t("chw.kpi.units"), formatNumber(w.now.qty), w.before ? deltaHTML(w.now.qty, w.before.qty) : "")}
      </div>
      <div class="chw-sub">${esc(t("chw.sub.weekly"))}</div>
      <div class="chw-cols">${cols}</div>
      <div class="chw-axis"><span>${esc(shortDate(w.weeks[0].d))}</span><span>${esc(t("chw.thisWeek"))}</span></div>
      ${w.products.length ? barsHTML(w.products.map((p, i) => ({ name: p.name, v: p.revenue, hot: i === 0, val: rp(p.revenue) }))) : ""}`;
  }
  if (w.kind === "retention") {
    const meter = (key, v, bench) => `
      <div class="chw-meter">
        <span class="chw-bar-name">${esc(t(`chw.ret.${key}`))}</span>
        <span class="chw-bar-track"><span class="chw-bar-fill${isNum(v) && v >= bench ? " is-hot" : ""}" style="--w:${isNum(v) ? Math.min(100, v) : 0}%"></span><i class="chw-mark" style="left:${bench}%" title="${esc(t("chw.ret.bench", { n: bench }))}"></i></span>
        <span class="chw-bar-val">${esc(isNum(v) ? `${Math.round(v)}%` : "—")}</span>
      </div>`;
    return `
      ${meter("hook", w.hook, w.bench.hook)}${meter("watch", w.watch, w.bench.watch)}${meter("completion", w.completion, w.bench.completion)}
      <div class="chw-sub is-foot">${esc(t("chw.ret.foot", { n: w.n }))}</div>
      ${w.best ? `<p class="chw-note">${icon("flame", { size: 12 })}<span>${esc(t("chw.ret.best", { title: w.best.title || t("common.untitled"), n: Math.round(w.best.hook ?? 0) }))}</span></p>` : ""}
      ${w.weakest ? `<p class="chw-note">${icon("info", { size: 12 })}<span>${esc(t("chw.ret.weak", { title: w.weakest.title || t("common.untitled"), n: Math.round(w.weakest.hook ?? 0) }))}</span></p>` : ""}`;
  }
  if (w.kind === "schedule") {
    const today = w.start;
    return `
      ${w.overdue ? `<p class="chw-note is-warn">${icon("info", { size: 12 })}<span>${esc(t("chw.sched.overdue", { n: w.overdue }))}</span></p>` : ""}
      <div class="chw-days">${w.days.map((day) => `
        <div class="chw-day${day.items.length ? " has-items" : ""}${day.d === today ? " is-today" : ""}">
          <span class="chw-day-name">${esc(new Date(`${day.d}T12:00:00`).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { weekday: "short" }))}<small>${esc(String(Number(day.d.slice(8))))}</small></span>
          <span class="chw-day-items">${day.items.length ? day.items.map((it) => `<span>${esc(it.title || t("common.untitled"))}</span>`).join("") : `<em>${esc(t("chw.sched.free"))}</em>`}</span>
        </div>`).join("")}</div>`;
  }
  if (w.kind === "campaign") {
    const prog = w.total ? (w.met / w.total) * 100 : 0;
    const headPct = w.head && w.head.target ? Math.min(100, (w.head.current / w.head.target) * 100) : null;
    return `
      <div class="chw-camp-stage">${esc(t("chw.camp.stage", { n: w.stageNo, total: w.stages, name: w.stage }))}</div>
      <div class="chw-meter"><span class="chw-bar-name">${esc(t("chw.camp.milestones"))}</span><span class="chw-bar-track"><span class="chw-bar-fill" style="--w:${prog}%"></span></span><span class="chw-bar-val">${w.met}/${w.total}</span></div>
      ${w.head ? `<div class="chw-meter"><span class="chw-bar-name">${esc(w.head.label)}</span><span class="chw-bar-track"><span class="chw-bar-fill is-hot" style="--w:${headPct}%"></span></span><span class="chw-bar-val">${esc(compact(w.head.current))}/${esc(compact(w.head.target))}</span></div>` : ""}
      ${w.next.length ? `<div class="chw-sub is-foot">${esc(t("chw.camp.next"))}</div><ol class="chw-next">${w.next.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}`;
  }
  return "";
}

// `fresh`: the answer just arrived — bars grow and the line draws in once;
// a re-render of an older answer stays still.
export function widgetHTML(w, { fresh = false } = {}) {
  if (!w || !WIDGET_KINDS.includes(w.kind)) return "";
  const title = w.kind === "campaign" && w.name ? campaignDisplayName(w.name) : t(`chw.title.${w.kind}`);
  const period = periodLabel(w);
  return `
    <div class="chw-card${fresh ? " chw-anim" : ""}" data-widget-kind="${esc(w.kind)}">
      <div class="chw-head">
        <span class="chw-icon">${icon(WIDGET_ICON[w.kind] || "chart", { size: 13 })}</span>
        <span class="chw-title">${esc(title)}</span>
        ${period ? `<span class="chw-period">${esc(period)}</span>` : ""}
      </div>
      ${bodyHTML(w)}
      <div class="chw-foot">
        <span>${esc(t("chw.source", { date: shortDate(w.at) }))}</span>
        <button type="button" class="chw-open" data-consultant-nav="${esc(widgetPath(w))}">${esc(t(w.empty ? `chw.fill.${w.kind}` : `chw.open.${widgetPath(w) === "report" ? "report" : w.kind}`))}${icon("arrowRight", { size: 11 })}</button>
      </div>
    </div>`;
}
