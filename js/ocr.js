// Screenshot → metrics extraction. Tesseract.js is only fetched from CDN the
// first time someone actually drops a screenshot — nothing loads up front.
const TESSERACT_URL = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";

let loadingPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_URL;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the text-recognition engine. Check your connection."));
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

export async function analyzeScreenshot(fileOrDataUrl, onProgress) {
  await loadTesseract();
  const result = await window.Tesseract.recognize(fileOrDataUrl, "eng", {
    logger: (m) => {
      if (onProgress && m.status === "recognizing text") onProgress(Math.round(m.progress * 100));
    },
  });
  const text = result?.data?.text || "";
  return { text, metrics: parseMetricsFromText(text) };
}
