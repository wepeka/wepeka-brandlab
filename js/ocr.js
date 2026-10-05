// Screenshot → metrics extraction. Tesseract.js is only fetched from CDN the
// first time someone actually drops a screenshot — nothing loads up front.
import { t } from "./i18n.js";

// Pinned, with Subresource Integrity (sha384 of this exact file; audit
// S-25). Note: Tesseract itself then fetches its worker and language data
// from its own default CDN at run time — SRI on this loader doesn't cover
// those.
const TESSERACT_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
const TESSERACT_INTEGRITY = "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";

let loadingPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_URL;
    script.integrity = TESSERACT_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.onload = resolve;
    script.onerror = () => reject(new Error(t("integr.ocr.loadFailed")));
    document.head.appendChild(script);
  });
  return loadingPromise;
}

// label patterns → our metric keys. English and Indonesian side by side:
// most owners run Instagram / TikTok in Indonesian ("Tayangan", "Akun yang
// dijangkau", "Suka"…), and an English-only list read nothing off those
// screenshots.
const LABEL_MAP = [
  { key: "views", patterns: [/\bviews?\b/i, /\bplays?\b/i, /\bvideo views?\b/i, /\btayangan\b/i, /\bpenayangan\b/i, /\bpemutaran\b/i, /\bdiputar\b/i, /\bditonton\b/i] },
  { key: "reach", patterns: [/\breach\b/i, /\baccounts reached\b/i, /\bjangkauan\b/i, /\bdijangkau\b/i, /\bterjangkau\b/i] },
  { key: "likes", patterns: [/\blikes?\b/i, /\bsuka\b/i] },
  { key: "comments", patterns: [/\bcomments?\b/i, /\bkomentar\b/i] },
  { key: "shares", patterns: [/\bshares?\b/i, /\bsends?\b/i, /\bbagikan\b/i, /\bdibagikan\b/i, /\bkiriman\b/i, /\bdikirim\b/i] },
  { key: "saves", patterns: [/\bsaves?\b/i, /\bsaved\b/i, /\bsimpan\b/i, /\bdisimpan\b/i, /\bfavorit\b/i, /\bfavorites?\b/i] },
  { key: "profileVisits", patterns: [/\bprofile visits?\b/i, /\bprofile activity\b/i, /\bkunjungan profil\b/i, /\baktivitas profil\b/i] },
  { key: "followersGained", patterns: [/\bfollows?\b/i, /\bfollowers?\b/i, /\bnew followers?\b/i, /\baccounts followed\b/i, /\bpengikut\b/i, /\bikuti\b/i, /\bdiikuti\b/i] },
];

// "12.345", "12,345", "1 234" (thousands), "1,2 rb", "1.2K", "3,4 jt",
// "1.2M" → a whole number; null when it isn't one. Indonesian writes "."
// for thousands and "," for decimals, English the other way round, so the
// separator alone says nothing — what follows it does: exactly 3 digits is
// a thousands group ("12.345", "12,345"), anything else a decimal ("1,2",
// "1.25"). With an rb/ribu/K or jt/juta/M suffix a lone separator is always
// the decimal (a short number never carries a thousands group). Both kinds
// in one number: the last one is the decimal ("1.234,5", "1,234.5").
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).trim().match(/^[+]?(\d[\d.,\s  ]*?)\s*(rb|ribu|k|jt|juta|m|mio)?\.?$/i);
  if (!m) return null;
  // "1 234 567": spaces count only between groups of exactly 3 digits.
  let body = m[1].replace(/[\s  ]+(?=\d{3}(?!\d))/g, "");
  if (/[\s  ]/.test(body)) return null;
  const unit = (m[2] || "").toLowerCase();
  const mult = !unit ? 1 : unit === "k" || unit === "rb" || unit === "ribu" ? 1000 : 1000000;
  const dots = (body.match(/\./g) || []).length;
  const commas = (body.match(/,/g) || []).length;
  if (dots && commas) {
    const dec = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    body = body.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (dots + commas > 1) {
    body = body.replace(/[.,]/g, ""); // "12.345.678", "1,234,567"
  } else if (dots + commas === 1) {
    const after = body.split(/[.,]/)[1];
    body = !unit && after.length === 3 ? body.replace(/[.,]/, "") : body.replace(",", ".");
  }
  const n = parseFloat(body);
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

// Every number on one OCR line, with where it sits. A percentage ("Pengikut
// 34,7%", "Non-followers 65.3%") is a share of the views, never a count, so
// it is kept only to say "this line has its own number" (`pct`).
const NUM_TOKEN = /(\d+(?:[.,]\d+|[   ]\d{3}(?!\d))*)(?:\s*(rb|ribu|jt|juta|k|m|mio)(?![\p{L}\d]))?(\s*%)?/giu;
function numberTokens(line) {
  const out = [];
  for (const m of line.matchAll(NUM_TOKEN)) {
    const value = m[3] ? null : parseNumber(m[2] ? `${m[1]} ${m[2]}` : m[1]);
    out.push({ start: m.index, end: m.index + m[0].length, value, pct: !!m[3] });
  }
  return out;
}

const isLabelLine = (line) => LABEL_MAP.some(({ patterns }) => patterns.some((p) => p.test(line)));

// Extracts {key: value} from raw OCR text using proximity of a number to a
// known label: the first count after the label on its own line ("Suka 123
// Komentar 4"), else the nearest one before it ("1.234 Tayangan"); a label
// alone on its line takes a bare number from the line under it, then above
// it ("Tayangan" / "12.345") — never from another label's line, and never
// when its own line already had a number (a percentage counts: "Pengikut
// 34,7%" is a breakdown, not new followers).
export function parseMetricsFromText(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const found = {};
  const firstCount = (line) => numberTokens(line).find((x) => x.value !== null)?.value ?? null;
  const bareNumber = (line) => (line && !isLabelLine(line) ? firstCount(line) : null);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tokens = numberTokens(line);
    // Every label on this line, so one label never takes a number that sits
    // on the far side of another label.
    const hits = [];
    for (const { key, patterns } of LABEL_MAP) {
      let hit = null;
      for (const p of patterns) {
        const m = line.match(p);
        if (m && (!hit || m.index < hit.index)) hit = { key, index: m.index, end: m.index + m[0].length };
      }
      if (hit) hits.push(hit);
    }
    // Several labels on one line: the layout is either "Label N Label N" or
    // "N Label N Label" — whichever comes first on the line decides which
    // side each label reads. A single label keeps preferring the number after.
    const firstNum = tokens.find((x) => x.value !== null);
    const firstLabel = Math.min(...hits.map((h) => h.index));
    const numberFirst = hits.length > 1 && !!firstNum && firstNum.start < firstLabel;
    for (const { key } of LABEL_MAP) {
      if (found[key] !== undefined) continue;
      const hit = hits.find((h) => h.key === key);
      if (!hit) continue;
      let val = null;
      if (tokens.length) {
        const others = hits.filter((h) => h !== hit && (h.end <= hit.index || h.index >= hit.end));
        const labelBetween = (a, b) => others.some((h) => h.index >= a && h.end <= b);
        const after = tokens.find((x) => x.start >= hit.end && x.value !== null && !labelBetween(hit.end, x.start));
        const before = tokens.filter((x) => x.end <= hit.index && x.value !== null && !labelBetween(x.end, hit.index)).pop();
        const pick = numberFirst ? before || after : after || before;
        val = pick ? pick.value : null;
      } else {
        val = bareNumber(lines[i + 1]) ?? bareNumber(lines[i - 1]);
      }
      if (val !== null) found[key] = val;
    }
  }
  return found;
}

// Retention figures Instagram / TikTok print as text next to the graph —
// "Average watch time 0:07", "Skip rate 38%", "Watch time 2h 14m". The
// graph itself needs a vision model (js/ai.js extractInsightsFromImage);
// this is the no-AI fallback.
function parseSeconds(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const clock = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    const parts = clock.slice(1).filter((x) => x !== undefined).map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  let total = 0, hit = false;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|jam|j)\b/); if (h) { total += parseFloat(h[1].replace(",", ".")) * 3600; hit = true; }
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:m|min|mnt|menit)\b/); if (m) { total += parseFloat(m[1].replace(",", ".")) * 60; hit = true; }
  const sec = s.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|dtk|detik)\b/); if (sec) { total += parseFloat(sec[1].replace(",", ".")); hit = true; }
  return hit ? Math.round(total * 10) / 10 : null;
}

const RETENTION_LABELS = [
  { key: "avgWatchTimeSec", patterns: [/average watch time/i, /avg\.? watch time/i, /waktu tonton rata-rata/i, /rata-rata waktu tonton/i, /durasi tonton rata-rata/i], parse: parseSeconds },
  { key: "skipRatePct", patterns: [/skip rate/i, /rasio lewati/i, /tingkat lewati/i, /dilewati/i], parse: (raw) => { const m = raw.match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? parseFloat(m[1].replace(",", ".")) : null; } },
  { key: "completionPct", patterns: [/watched full video/i, /full video/i, /nonton sampai (?:habis|selesai)/i, /ditonton penuh/i], parse: (raw) => { const m = raw.match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? parseFloat(m[1].replace(",", ".")) : null; } },
];

export function parseRetentionFromText(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    for (const { key, patterns, parse } of RETENTION_LABELS) {
      if (found[key] !== undefined || !patterns.some((p) => p.test(lines[i]))) continue;
      const val = parse(lines[i]) ?? (lines[i + 1] ? parse(lines[i + 1]) : null) ?? (lines[i - 1] ? parse(lines[i - 1]) : null);
      if (val !== null && val !== undefined) found[key] = val;
    }
  }
  return found;
}

// Everything readable from one screenshot, shaped like js/ai.js
// extractInsightsFromImage so both readers plug into the same code.
// Indonesian + English: Tesseract 5 fetches each language's data from the
// same CDN path (cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int,
// ind ≈ 1.2 MB next to eng), so "ind+eng" reads "Tayangan 12.345" as well
// as "Views 12,345". If the Indonesian data can't be fetched, English alone
// still reads the digits and the labels above.
const OCR_LANGS = ["ind+eng", "eng"];
export async function analyzeScreenshot(fileOrDataUrl, onProgress) {
  await loadTesseract();
  const opts = {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") onProgress(Math.round(m.progress * 100));
    },
  };
  let result = null;
  for (let i = 0; i < OCR_LANGS.length; i++) {
    try {
      result = await window.Tesseract.recognize(fileOrDataUrl, OCR_LANGS[i], opts);
      break;
    } catch (err) {
      if (i === OCR_LANGS.length - 1) throw err;
    }
  }
  const text = result?.data?.text || "";
  return { text, metrics: parseMetricsFromText(text), retention: parseRetentionFromText(text), source: "ocr" };
}
