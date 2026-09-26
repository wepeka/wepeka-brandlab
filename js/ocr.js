// Screenshot → metrics extraction. Tesseract.js is only fetched from CDN the
// first time someone actually drops a screenshot — nothing loads up front.
import { t } from "./i18n.js";

const TESSERACT_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";

let loadingPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error(t("integr.ocr.loadFailed")));
    document.head.appendChild(script);
  });
  return loadingPromise;
}

// label patterns → our metric keys
const LABEL_MAP = [
  { key: "views", patterns: [/\bviews?\b/i, /\bplays?\b/i, /\bvideo views?\b/i] },
  { key: "reach", patterns: [/\breach\b/i, /\baccounts reached\b/i] },
  { key: "likes", patterns: [/\blikes?\b/i] },
  { key: "comments", patterns: [/\bcomments?\b/i] },
  { key: "shares", patterns: [/\bshares?\b/i, /\bsends?\b/i] },
  { key: "saves", patterns: [/\bsaves?\b/i, /\bsaved\b/i] },
  { key: "profileVisits", patterns: [/\bprofile visits?\b/i, /\bprofile activity\b/i] },
  { key: "followersGained", patterns: [/\bfollows?\b/i, /\bfollowers?\b/i, /\bnew followers?\b/i, /\baccounts followed\b/i] },
];

function parseNumber(raw) {
  if (!raw) return null;
  let s = raw.replace(/,/g, "").trim();
  const mult = /[km]$/i.test(s) ? (s.toLowerCase().endsWith("k") ? 1000 : 1000000) : 1;
  s = s.replace(/[km]$/i, "");
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.round(n * mult);
}

// Extracts {key: value} from raw OCR text using proximity of a number to a known label.
export function parseMetricsFromText(text) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const found = {};
  const numRe = /(\d[\d,.]*\s*[kKmM]?)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { key, patterns } of LABEL_MAP) {
      if (found[key] !== undefined) continue;
      if (!patterns.some((p) => p.test(line))) continue;
      let match = line.match(numRe);
      if (!match && lines[i + 1]) match = lines[i + 1].match(numRe);
      if (!match && lines[i - 1]) match = lines[i - 1].match(numRe);
      if (match) {
        const val = parseNumber(match[1]);
        if (val !== null) found[key] = val;
      }
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
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hr|jam)\b/); if (h) { total += parseFloat(h[1].replace(",", ".")) * 3600; hit = true; }
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
export async function analyzeScreenshot(fileOrDataUrl, onProgress) {
  await loadTesseract();
  const result = await window.Tesseract.recognize(fileOrDataUrl, "eng", {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") onProgress(Math.round(m.progress * 100));
    },
  });
  const text = result?.data?.text || "";
  return { text, metrics: parseMetricsFromText(text), retention: parseRetentionFromText(text), source: "ocr" };
}
