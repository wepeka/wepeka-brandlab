// Retention (watch-time) analytics — the "how long did people actually
// watch" side of performance that the plain engagement numbers can't show.
// Numbers come from one screenshot of Instagram's / TikTok's retention
// graph (js/views/content-list.js Quick Fill, or a photo sent to the chat)
// read by the AI (js/ai.js extractInsightsFromImage) or, without a vision
// model, by OCR (js/ocr.js). Everything here is deterministic: the same
// numbers always get the same verdict, so the AI's advice on top of it is
// grounded in the same reading the widgets show.
//
// Stored on content.performance.retention:
//   { videoLengthSec, avgWatchTimeSec, hookPct, completionPct, skipRatePct,
//     curve: [{ sec, pct }], source: "ai" | "ocr" | "manual", analyzedAt }
// hookPct = % of viewers still watching at second 3 (Instagram shows the
// inverse as "skip rate"); completionPct = % who reached the end.
import { t } from "./i18n.js";

export const RETENTION_FIELDS = ["videoLengthSec", "avgWatchTimeSec", "hookPct", "completionPct", "skipRatePct"];

// Benchmarks a social media specialist would use for short-form video,
// by length — a 10-second Reel keeping 60% of viewers to the end is normal,
// a 90-second one doing that is exceptional. "good" / "average" floors
// mirror the engagement thresholds in js/store.js (rateValue in
// js/formulas.js).
const HOOK_BENCH = { good: 70, average: 50 };
const LENGTH_BENCH = [
  { maxSec: 15, watchPct: { good: 75, average: 55 }, completionPct: { good: 45, average: 25 } },
  { maxSec: 30, watchPct: { good: 60, average: 40 }, completionPct: { good: 35, average: 18 } },
  { maxSec: 60, watchPct: { good: 45, average: 30 }, completionPct: { good: 25, average: 12 } },
  { maxSec: Infinity, watchPct: { good: 35, average: 20 }, completionPct: { good: 15, average: 7 } },
];

const num = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const clampPct = (v) => (v === null ? null : Math.max(0, Math.min(100, v)));

function rate(value, th) {
  if (value === null || !th) return null;
  if (value >= th.good) return "good";
  if (value >= th.average) return "average";
  return "poor";
}
const RANK = { poor: 0, average: 1, good: 2 };
const worst = (list) => list.filter(Boolean).reduce((w, r) => (w === null || RANK[r] < RANK[w] ? r : w), null);

export function benchmarksFor(lengthSec) {
  const len = num(lengthSec) || 30;
  return { hook: HOOK_BENCH, ...LENGTH_BENCH.find((b) => len <= b.maxSec) };
}

// Fills the gaps one number can give another: skip rate ↔ hook, and the
// curve's own first/last samples when the labelled figures are missing.
export function normalizeRetention(raw = {}) {
  const r = {
    videoLengthSec: num(raw.videoLengthSec),
    avgWatchTimeSec: num(raw.avgWatchTimeSec),
    hookPct: clampPct(num(raw.hookPct)),
    completionPct: clampPct(num(raw.completionPct)),
    skipRatePct: clampPct(num(raw.skipRatePct)),
    curve: Array.isArray(raw.curve)
      ? raw.curve.map((p) => ({ sec: num(p?.sec), pct: clampPct(num(p?.pct)) })).filter((p) => p.sec !== null && p.pct !== null).sort((a, b) => a.sec - b.sec).slice(0, 24)
      : [],
    source: raw.source || "manual",
    analyzedAt: raw.analyzedAt || null,
  };
  if (r.hookPct === null && r.skipRatePct !== null) r.hookPct = 100 - r.skipRatePct;
  if (r.skipRatePct === null && r.hookPct !== null) r.skipRatePct = 100 - r.hookPct;
  if (r.curve.length) {
    const last = r.curve[r.curve.length - 1];
    if (r.videoLengthSec === null && last.sec > 0) r.videoLengthSec = last.sec;
    if (r.completionPct === null) r.completionPct = last.pct;
    if (r.hookPct === null) {
      const at3 = curveAt(r.curve, 3);
      r.hookPct = at3;
      r.skipRatePct = at3 === null ? null : 100 - at3;
    }
    // A graph-only screenshot (no "average watch time" printed next to it):
    // the area under the retention curve IS the average watch time —
    // Σ(% still watching × seconds) / 100.
    if (r.avgWatchTimeSec === null && r.curve.length >= 3 && r.videoLengthSec) {
      r.avgWatchTimeSec = Math.round(curveArea(r.curve, r.videoLengthSec) * 10) / 10;
      r.avgWatchFromCurve = true;
    }
  }
  return r;
}

// % still watching at `sec`, linearly between the two samples around it.
// A curve that doesn't start at 0 is assumed to start at 100%.
function withStart(curve) {
  return curve[0].sec > 0 ? [{ sec: 0, pct: 100 }, ...curve] : curve;
}
export function curveAt(curve, sec) {
  if (!curve?.length) return null;
  const pts = withStart(curve);
  if (sec >= pts[pts.length - 1].sec) return pts[pts.length - 1].pct;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (sec <= b.sec) return b.sec === a.sec ? b.pct : a.pct + ((sec - a.sec) / (b.sec - a.sec)) * (b.pct - a.pct);
  }
  return null;
}
function curveArea(curve, lengthSec) {
  const pts = withStart(curve).filter((p) => p.sec <= lengthSec);
  const lastPt = pts[pts.length - 1];
  if (lastPt.sec < lengthSec) pts.push({ sec: lengthSec, pct: lastPt.pct });
  let area = 0;
  for (let i = 1; i < pts.length; i++) area += ((pts[i - 1].pct + pts[i].pct) / 2) * (pts[i].sec - pts[i - 1].sec);
  return area / 100;
}

export function hasRetentionData(retention) {
  if (!retention) return false;
  const r = normalizeRetention(retention);
  return r.hookPct !== null || r.completionPct !== null || (r.avgWatchTimeSec !== null && r.videoLengthSec !== null);
}

// The one reading every surface (Quick Fill verdict, Home widgets, the
// consultant's snapshot) shares.
export function analyzeRetention(retention) {
  const r = normalizeRetention(retention || {});
  const bench = benchmarksFor(r.videoLengthSec);
  const avgWatchPct = r.avgWatchTimeSec !== null && r.videoLengthSec ? (r.avgWatchTimeSec / r.videoLengthSec) * 100 : null;
  const loops = avgWatchPct !== null && avgWatchPct > 100;
  const ratings = {
    hook: rate(r.hookPct, bench.hook),
    watch: loops ? "good" : rate(avgWatchPct, bench.watchPct),
    completion: rate(r.completionPct, bench.completionPct),
  };
  const overall = worst([ratings.hook, ratings.watch, ratings.completion]);

  // Biggest single drop between two samples of the curve, as "where do
  // people leave" — the second the drop ends at, and how many points fell.
  let dropoff = null;
  for (let i = 1; i < r.curve.length; i++) {
    const d = r.curve[i - 1].pct - r.curve[i].pct;
    if (d > 0 && (!dropoff || d > dropoff.dropPts)) dropoff = { sec: r.curve[i].sec, fromPct: r.curve[i - 1].pct, toPct: r.curve[i].pct, dropPts: d };
  }

  let diagnosis = "none";
  const hasAny = ratings.hook || ratings.watch || ratings.completion;
  if (hasAny) {
    const len = r.videoLengthSec || 0;
    const midDrop = dropoff && len && dropoff.sec > 3 && dropoff.sec < len * 0.8;
    if (ratings.hook === "poor") diagnosis = "hook";
    else if (loops) diagnosis = "loop";
    else if ((ratings.watch === "poor" || ratings.watch === "average") && midDrop) diagnosis = "middle";
    else if (ratings.completion === "poor" && ratings.watch !== "poor") diagnosis = "ending";
    else if (overall === "good") diagnosis = "solid";
    else if (ratings.watch === "poor") diagnosis = "middle";
    else diagnosis = "mixed";
  }
  return { ...r, avgWatchPct, loops, ratings, overall, dropoff, diagnosis, bench };
}

// Human-readable verdict lines (UI language) for a Quick Fill save or a
// widget footer. `engagement` (computeContentMetrics result) adds the
// cross-read a specialist would do: great retention but weak engagement
// means the content held attention but asked for nothing.
export function retentionVerdict(analysis, engagement = null) {
  const a = analysis;
  if (!a || a.diagnosis === "none") return [];
  const lines = [t(`ret.diag.${a.diagnosis}`)];
  if (a.dropoff && a.dropoff.dropPts >= 8) lines.push(t("ret.diag.dropAt", { sec: a.dropoff.sec, pts: Math.round(a.dropoff.dropPts) }));
  if (engagement) {
    if (a.overall === "good" && engagement.erRating === "poor") lines.push(t("ret.diag.holdButNoAction"));
    else if (a.ratings.hook === "poor" && engagement.erRating === "good") lines.push(t("ret.diag.nicheButLoyal"));
  }
  return lines;
}

export function ratingLabel(rating) {
  return rating ? t(`ret.rating.${rating}`) : "—";
}

// Brand-wide averages for the Home widgets and the consultant snapshot.
export function brandRetentionStats(content, settings = null, computeMetrics = null) {
  const rows = content
    .filter((c) => c.status === "published" && hasRetentionData(c.performance?.retention))
    .map((c) => ({ c, a: analyzeRetention(c.performance.retention), m: computeMetrics && settings ? computeMetrics(c, settings) : null }));
  const avg = (key) => {
    const vals = rows.map((x) => x.a[key]).filter((v) => v !== null && v !== undefined);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const count = (key, val) => rows.filter((x) => x.a.ratings[key] === val).length;
  const hook = avg("hookPct");
  const watch = avg("avgWatchPct");
  const completion = avg("completionPct");
  const diag = {};
  rows.forEach((x) => { diag[x.a.diagnosis] = (diag[x.a.diagnosis] || 0) + 1; });
  const topDiag = Object.entries(diag).filter(([k]) => k !== "solid" && k !== "loop" && k !== "none").sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    rows,
    n: rows.length,
    hook, watch, completion,
    ratings: {
      hook: rate(hook, HOOK_BENCH),
      watch: watch !== null && watch > 100 ? "good" : rate(watch, benchmarksFor(avg("videoLengthSec")).watchPct),
      completion: rate(completion, benchmarksFor(avg("videoLengthSec")).completionPct),
    },
    poorHooks: count("hook", "poor"),
    topDiagnosis: topDiag,
    best: [...rows].sort((a, b) => (b.a.hookPct ?? -1) - (a.a.hookPct ?? -1))[0] || null,
    weakest: [...rows].filter((x) => x.a.hookPct !== null).sort((a, b) => a.a.hookPct - b.a.hookPct)[0] || null,
  };
}

// What the consultant reads (js/consultant-panel.js buildSnapshot) — plain
// Indonesian numbers, no verdict words, so the model reasons from the data
// with the specialist rules in its own prompt.
export function retentionSnapshotText(content) {
  const s = brandRetentionStats(content);
  if (!s.n) return "Retensi (watch time): belum ada konten dengan data retensi.";
  const pct = (v) => (v === null ? "-" : `${Math.round(v)}%`);
  const one = (x) => {
    const a = x.a;
    const bits = [
      a.videoLengthSec !== null ? `durasi ${Math.round(a.videoLengthSec)} dtk` : "",
      a.hookPct !== null ? `hook 3 dtk ${pct(a.hookPct)}` : "",
      a.avgWatchPct !== null ? `rata-rata ditonton ${pct(a.avgWatchPct)} durasi` : "",
      a.completionPct !== null ? `selesai ${pct(a.completionPct)}` : "",
      a.dropoff && a.dropoff.dropPts >= 8 ? `drop terbesar di detik ${a.dropoff.sec} (-${Math.round(a.dropoff.dropPts)} poin)` : "",
    ].filter(Boolean);
    return `"${x.c.title || "(tanpa judul)"}" (id=${x.c.id}): ${bits.join(", ")}`;
  };
  const lines = [
    `Retensi (watch time) dari ${s.n} konten: rata-rata hook 3 dtk ${pct(s.hook)}, rata-rata ditonton ${pct(s.watch)} durasi, selesai ditonton ${pct(s.completion)}. ${s.poorHooks} konten hook-nya di bawah 50%.`,
  ];
  if (s.best) lines.push(`Retensi terbaik: ${one(s.best)}.`);
  if (s.weakest && s.weakest !== s.best) lines.push(`Retensi terlemah: ${one(s.weakest)}.`);
  return lines.join("\n");
}

// Merges numbers read from one screenshot into a content's performance —
// only fields the reading actually has, never overwriting a typed number
// with null. Returns the patch for updateContent().
export function mergeInsightsIntoPerformance(performance = {}, insights = {}, source = "ai") {
  const next = { ...performance };
  Object.entries(insights.metrics || {}).forEach(([k, v]) => {
    const n = num(v);
    if (n !== null) next[k] = Math.round(n);
  });
  if (insights.retention && hasRetentionData(insights.retention)) {
    const prev = next.retention || {};
    const incoming = normalizeRetention({ ...insights.retention, source });
    const merged = { ...prev };
    RETENTION_FIELDS.forEach((k) => { if (incoming[k] !== null) merged[k] = incoming[k]; });
    if (incoming.curve.length) merged.curve = incoming.curve;
    merged.source = source;
    merged.analyzedAt = Date.now();
    next.retention = merged;
  }
  next.confirmedAt = Date.now();
  return next;
}
