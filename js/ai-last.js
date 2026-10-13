// The last few AI answers of this visit, kept in memory only (never stored,
// gone on reload). js/ai.js notes every answer here as it arrives, so a
// problem report about "jawaban AI" can carry what the AI actually said even
// where the answer went straight into a form field and has no block of its
// own to hang a report button on (js/ai-report.js, js/report-problem.js).
// No imports on purpose: js/ai.js loads this, and so does the Node test.
const KEEP = 6;
const MAX_AGE_MS = 15 * 60 * 1000;
const OUTPUT_MAX = 4000;
const PROMPT_MAX = 1500;
// Plumbing calls: the connection test and the chat's one-word router.
const SKIP = new Set(["test", "route"]);
const answers = [];

// The hash route without its query (same rule as reportContext's `page`).
export const pageOf = (hash) => String(hash || "#/").replace(/[?].*$/, "").slice(0, 200);
const herePage = () => (typeof location !== "undefined" ? pageOf(location.hash) : "#/");

export function noteAiAnswer({ feature = "", output = "", prompt = "", page = herePage(), at = Date.now() } = {}) {
  const text = typeof output === "string" ? output.trim() : "";
  if (!text || SKIP.has(feature)) return;
  answers.push({ feature: String(feature || ""), output: text.slice(0, OUTPUT_MAX), prompt: String(prompt || "").slice(0, PROMPT_MAX), page, at });
  if (answers.length > KEEP) answers.splice(0, answers.length - KEEP);
}

// The newest fresh answer, optionally of one kind and/or from one page.
export function lastAiAnswer({ feature = "", page = "", now = Date.now(), maxAge = MAX_AGE_MS } = {}) {
  for (let i = answers.length - 1; i >= 0; i--) {
    const a = answers[i];
    if (now - a.at > maxAge) break;
    if ((!feature || a.feature === feature) && (!page || a.page === page)) return { ...a };
  }
  return null;
}

function lines(v, label = "") {
  if (v === null || v === undefined || v === "") return [];
  if (typeof v !== "object") return [label ? `${label}: ${v}` : String(v)];
  if (Array.isArray(v)) return v.flatMap((x) => (x && typeof x === "object" ? [...lines(x), ""] : x === null || x === undefined || x === "" ? [] : [`• ${x}`]));
  return Object.entries(v).flatMap(([k, x]) => (x && typeof x === "object" ? [`${k}:`, ...lines(x)] : lines(x, k)));
}

// An answer as plain lines a person can read: most features ask the model
// for JSON, and a raw `{"actions":[…]}` is hard on whoever reads the report.
export function readableAnswer(v) {
  if (v === null || v === undefined) return "";
  let value = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!/^[[{]/.test(s)) return s;
    try {
      value = JSON.parse(s);
    } catch {
      return s;
    }
  }
  return lines(value).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
