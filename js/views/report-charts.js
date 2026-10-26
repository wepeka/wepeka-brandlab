// The Report page's charts (js/views/report-page.js), drawn as plain SVG at
// the width they get on screen (no library, no scaled-down text on a
// phone). Marks follow the house rules for charts: a 2px line with a soft
// wash under it, bars at most 24px wide with a rounded top and a square
// foot, hairline solid gridlines, one labelled extreme instead of a number
// on every point. Colours come from css/report.css (--rl-line, --rl-bar),
// text from the theme's text tokens; the page's motion (the line drawing
// in, bars growing) hangs off the classes here.
import { formatNumber, escapeHtml as esc } from "../dom.js";
import { getLang } from "../i18n.js";

// 1.200 / 12,5 rb / 1,2 jt (Indonesian) — 1,200 / 12.5K / 1.2M (English).
export function compactNum(v) {
  const n = Number(v) || 0;
  const en = getLang() === "en";
  const one = (x) => x.toFixed(x >= 100 ? 0 : 1).replace(/\.0$/, "").replace(".", en ? "." : ",");
  if (Math.abs(n) >= 1e6) return `${one(n / 1e6)}${en ? "M" : " jt"}`;
  if (Math.abs(n) >= 1e4) return `${one(n / 1e3)}${en ? "K" : " rb"}`;
  return formatNumber(Math.round(n));
}

// A clean top for the y-axis: 1, 2, 2.5 or 5 × a power of ten.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// A smooth line that never overshoots its points (monotone cubic,
// Fritsch–Carlson), so a curve between two posts never dips below zero.
export function monotonePath(pts) {
  const n = pts.length;
  if (!n) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx = [], m = [], tg = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    m[i] = dx[i] ? (pts[i + 1].y - pts[i].y) / dx[i] : 0;
  }
  tg[0] = m[0];
  tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (!m[i]) { tg[i] = 0; tg[i + 1] = 0; continue; }
    const a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i]; }
  }
  const f = (v) => Math.round(v * 10) / 10;
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + tg[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - tg[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

// A bar with a 4px rounded top and a square foot on the baseline.
function barPath(x, y, w, h) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// Views (a line with a wash) over interactions (bars) — two small charts
// on one x-axis, each with its own scale (never two scales on one plot).
// `points`: [{ views, inter, label }] in time order; `labels.views` /
// `labels.inter`: the panel names. Returns the SVG and where each point
// sits, for the hover layer.
export function trendChartSVG({ width, points, labels, peakLabel = "" }) {
  const W = Math.max(280, Math.round(width));
  const small = W < 520;
  const padL = small ? 38 : 46, padR = small ? 8 : 14;
  const top = 34, viewsH = small ? 150 : 196, gap = 40, interH = small ? 64 : 84, axisH = 26;
  const H = top + viewsH + gap + interH + axisH;
  const innerW = W - padL - padR;
  const n = points.length;
  const band = innerW / Math.max(1, n);
  const xs = points.map((_, i) => padL + band * (i + 0.5));
  const viewsBase = top + viewsH;
  const interTop = viewsBase + gap;
  const interBase = interTop + interH;

  const views = points.map((p) => p.views);
  const vMax = niceMax(Math.max(0, ...views.filter((v) => v !== null)));
  const ys = views.map((v) => (v === null ? null : viewsBase - (v / vMax) * viewsH));
  const linePts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => p.y !== null);
  const line = monotonePath(linePts);
  const area = linePts.length > 1 ? `${line} L${linePts[linePts.length - 1].x},${viewsBase} L${linePts[0].x},${viewsBase} Z` : "";
  let peak = -1;
  views.forEach((v, i) => { if (v !== null && (peak < 0 || v > views[peak])) peak = i; });

  const inters = points.map((p) => p.inter);
  const iMax = Math.max(0, ...inters.filter((v) => v !== null));
  let iPeak = -1;
  inters.forEach((v, i) => { if (v !== null && v > 0 && (iPeak < 0 || v > inters[iPeak])) iPeak = i; });
  const barW = Math.max(3, Math.min(24, band * 0.56));

  const ticks = [0, vMax / 2, vMax];
  const grid = ticks.map((tv) => {
    const y = viewsBase - (tv / vMax) * viewsH;
    return `<line class="rl-grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="rl-tick" x="${padL - 8}" y="${y + 4}" text-anchor="end">${esc(compactNum(tv))}</text>`;
  }).join("");

  // Date labels: every one when there's room, else first / middle / last.
  const every = band >= (small ? 52 : 58);
  const shown = new Set(every ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1]);
  const xLabels = points.map((p, i) => (shown.has(i) ? `<text class="rl-xlabel" x="${xs[i]}" y="${interBase + 18}" text-anchor="${!every && i === 0 && n > 1 ? "start" : !every && i === n - 1 && n > 1 ? "end" : "middle"}">${esc(p.label)}</text>` : "")).join("");

  const bars = inters.map((v, i) => {
    if (v === null || !iMax) return "";
    const h = Math.max(v > 0 ? 3 : 0, (v / iMax) * interH);
    return `<path class="rl-bar${i === iPeak ? " is-peak" : ""}" data-i="${i}" style="--i:${i}" d="${barPath(xs[i] - barW / 2, interBase - h, barW, h)}"/>`;
  }).join("");
  const iPeakLabel = iPeak >= 0 ? `<text class="rl-bar-label" x="${xs[iPeak]}" y="${interBase - Math.max(3, (inters[iPeak] / iMax) * interH) - 7}" text-anchor="middle">${esc(compactNum(inters[iPeak]))}</text>` : "";

  // The highest point: a ringed dot and its number in a small pill.
  let peakMark = "";
  if (peak >= 0) {
    const px = xs[peak], py = ys[peak];
    const txt = `${compactNum(views[peak])}${peakLabel ? ` · ${peakLabel}` : ""}`;
    const pw = Math.round(txt.length * 6.6 + 18);
    const bx = Math.min(W - padR - pw, Math.max(padL, px - pw / 2));
    peakMark = `
      <g class="rl-peak">
        <rect class="rl-peak-pill" x="${bx}" y="${py - 36}" width="${pw}" height="22" rx="11"/>
        <text class="rl-peak-text" x="${bx + pw / 2}" y="${py - 21}" text-anchor="middle">${esc(txt)}</text>
        <circle class="rl-dot" cx="${px}" cy="${py}" r="5.5"/>
      </g>`;
  }

  const svg = `
    <svg class="rl-trend-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(labels.aria || "")}">
      <defs><linearGradient id="rl-wash" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--rl-line);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--rl-line);stop-opacity:0"/></linearGradient></defs>
      <text class="rl-panel" x="${padL}" y="16">${esc(labels.views)}</text>
      ${grid}
      ${area ? `<path class="rl-area" d="${area}" fill="url(#rl-wash)"/>` : ""}
      ${line ? `<path class="rl-line" d="${line}" pathLength="1"/>` : ""}
      <line class="rl-x" x1="0" x2="0" y1="${top - 6}" y2="${interBase}"/>
      ${peakMark}
      <circle class="rl-hdot" cx="0" cy="0" r="6"/>
      <text class="rl-panel" x="${padL}" y="${interTop - 12}">${esc(labels.inter)}</text>
      <line class="rl-base" x1="${padL}" x2="${W - padR}" y1="${interBase}" y2="${interBase}"/>
      ${bars}
      ${iPeakLabel}
      ${xLabels}
    </svg>`;
  return { svg, xs, ys, band, height: H, padL, padR, top, interBase };
}

// A ring (a meter bent round): `pct` 0–100 of the circle filled. The arc
// draws in when its section arrives (css .rl-ring-arc, --off).
export function ringSVG({ pct, size = 160, stroke = 16, gradientId = "" }) {
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `
    <svg class="rl-ring-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">
      ${gradientId ? `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--rl-a)"/><stop offset="1" style="stop-color:var(--rl-b)"/></linearGradient></defs>` : ""}
      <circle class="rl-ring-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"/>
      ${p ? `<circle class="rl-ring-arc" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}" pathLength="100" transform="rotate(-90 ${c} ${c})" style="--off:${(100 - p).toFixed(2)}"${gradientId ? ` stroke="url(#${gradientId})"` : ""}/>` : ""}
    </svg>`;
}

// A sparkline: one series, no axes (the card says what and how much). It
// stretches to its box; the line keeps its width (non-scaling stroke).
export function sparkSVG(values, { height = 56 } = {}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return "";
  const W = 100;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => ({ x: (i / (vals.length - 1)) * W, y: 4 + (1 - (v - min) / span) * (height - 8) }));
  const line = monotonePath(pts);
  return `
    <svg class="rl-spark" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="rl-spark-area" d="${line} L${W},${height} L0,${height} Z"/>
      <path class="rl-spark-line" d="${line}" vector-effect="non-scaling-stroke"/>
    </svg>`;
}
