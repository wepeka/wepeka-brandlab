// Brand learning — what makes Brandlab's AI different from a blank ChatGPT:
// it knows what worked for THIS brand and what the owner likes, and it says
// so. Three sources, all per brand:
//
//   1. Taste — every 👍/👎 (and the note on a 👎) the owner gives an AI
//      result, kept as a short excerpt on the brand doc (brand.aiTaste).
//      The full ratings still go to the aiFeedback collection for evals;
//      that one is write-only for the client, so this is the readable copy.
//   2. Best posts — the 3–5 published posts with the strongest numbers,
//      with their actual hook and the opening of their caption, not just
//      the title.
//   3. Monthly lessons — once a month the app (not the owner) asks the AI
//      to sum up last month's numbers into 2–4 plain lessons ("Reels edukasi
//      dapat 2× views dibanding foto produk"). Stored for good on the brand
//      (brand.lessons), unlike the 8-entry pulse window. Free for the owner.
//
// learningText() puts all three into every AI prompt (through
// js/brand-pulse.js pulseTextFor); learningBasis() is the one-line "Dibuat
// berdasarkan: …" shown under a generated result, so the owner can see the
// AI remembered. Also here: data-based sentences that replace generic
// advice ("Konsisten itu kuncinya") — postingLine(), bestPostsLine().
import { getBrand, updateBrand, organicViews, localISODate, getSettings, listContent } from "./store.js";
import { computeContentMetrics } from "./formulas.js";
import { t, getLang } from "./i18n.js";

const DAY = 86400000;
const TASTE_CAP = 10;
const LESSONS_CAP = 24;
const BEST_POSTS = 4;
const BEST_WINDOW_DAYS = 120;

const clip = (s, n) => {
  const x = String(s || "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x;
};
const fmtNum = (n) => Number(n || 0).toLocaleString(getLang() === "en" ? "en-US" : "id-ID");
// "12rb" / "12k" — how people say view counts.
function shortNum(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, "")}${getLang() === "en" ? "M" : "jt"}`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "")}${getLang() === "en" ? "k" : "rb"}`;
  return fmtNum(v);
}

// ---------- 1. Taste (👍/👎) ----------

// The readable part of an AI result: a string as-is, else the first text
// field of an object (hook, caption, text…).
function excerptOf(output) {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "";
  for (const k of ["hook", "caption", "script", "text", "title", "picked", "summary"]) {
    const v = output[k];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") { const inner = excerptOf(v); if (inner) return inner; }
  }
  const first = Object.values(output).find((v) => typeof v === "string" && v.trim());
  return first || "";
}

// Called by js/ai-feedback.js on every rating.
export function rememberTaste(brandId, { rating, note = "", output = "", feature = "" }) {
  const brand = brandId ? getBrand(brandId) : null;
  if (!brand || !["up", "down"].includes(rating)) return;
  const sample = clip(excerptOf(output), 160);
  const cleanNote = clip(note, 140);
  if (!sample && !cleanNote) return;
  const taste = brand.aiTaste || {};
  const key = rating === "up" ? "likes" : "dislikes";
  const entry = { sample, note: cleanNote, feature: String(feature || "").slice(0, 40), at: Date.now() };
  updateBrand(brandId, { aiTaste: { ...taste, [key]: [...(taste[key] || []), entry].slice(-TASTE_CAP) } });
}

// ---------- 2. Best posts ----------

// The hook of a script: the text under a HOOK label, else Slide 1 of a
// carousel, else its first line.
export function hookOf(script) {
  const s = String(script || "").replace(/\r/g, "");
  if (!s.trim()) return "";
  const labelled = s.match(/(?:^|\n)\s*\**\s*HOOK\s*\**:?\s*\n([\s\S]*?)(?:\n\s*\n|\n\s*\**\s*ISI|$)/i);
  if (labelled && labelled[1].trim()) return labelled[1].trim();
  const slide = s.match(/(?:^|\n)\s*Slide\s*1\s*:?\s*\n?([^\n]+)/i);
  if (slide) return slide[1].trim();
  return s.split("\n").find((l) => l.trim())?.trim() || "";
}

const publishedAt = (c) => (c.publishedDate ? new Date(c.publishedDate + "T12:00:00").getTime() : 0);

// Published posts with numbers, strongest first: views when the brand logs
// views, else engagement rate. Recent posts only (a brand changes).
export function bestPosts(content = [], settings = getSettings(), { n = BEST_POSTS, now = Date.now() } = {}) {
  const since = now - BEST_WINDOW_DAYS * DAY;
  const rows = content
    .filter((c) => c.status === "published" && publishedAt(c) >= since)
    .map((c) => ({ c, views: organicViews(c), er: computeContentMetrics(c, settings).engagementRate }))
    .filter((r) => (r.views !== null && r.views !== undefined && r.views > 0) || (r.er !== null && r.er !== undefined));
  if (!rows.length) return [];
  const byViews = rows.filter((r) => r.views > 0).length >= Math.min(3, rows.length);
  return rows
    .sort((a, b) => (byViews ? (b.views || 0) - (a.views || 0) : (b.er || 0) - (a.er || 0)))
    .slice(0, n)
    .map((r) => ({ ...r, hook: clip(hookOf(r.c.script), 140), caption: clip(r.c.caption, 160) }));
}

// ---------- 3. Monthly lessons ----------

export const lessonsOf = (brand) => [...(brand?.lessons || [])].sort((a, b) => (b.month || "").localeCompare(a.month || ""));

// The rows the monthly summary reads: last month's published posts with
// their numbers. Plain data for js/ai.js summarizeMonthLessons.
export function monthRows(content, settings, month) {
  return content
    .filter((c) => c.status === "published" && (c.publishedDate || "").startsWith(month))
    .map((c) => {
      const m = computeContentMetrics(c, settings);
      return { title: c.title || "", format: c.format || "", funnel: c.funnel || "", views: organicViews(c), er: m.engagementRate, hook: clip(hookOf(c.script), 100) };
    })
    .filter((r) => (r.views ?? null) !== null || (r.er ?? null) !== null);
}
export const MIN_LESSON_POSTS = 3;
export function previousMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function saveLessons(brandId, month, lessons) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const rest = (brand.lessons || []).filter((l) => l.month !== month);
  const next = lessons.length ? [...rest, { month, points: lessons.slice(0, 4), at: Date.now() }] : rest;
  updateBrand(brandId, { lessons: next.sort((a, b) => a.month.localeCompare(b.month)).slice(-LESSONS_CAP), lessonsCheckedMonth: month });
}

// ---------- For the AI prompt ----------

// One block every AI feature reads (appended to the pulse). "" when the
// brand has nothing learned yet.
export function learningText(brand, { content = [], settings = getSettings() } = {}) {
  if (!brand) return "";
  const parts = [];
  const best = bestPosts(content, settings);
  if (best.length) {
    parts.push("Best-performing posts of THIS brand — write in their spirit (tone, hook style, structure), never copy them:");
    best.forEach((b) => {
      const nums = [b.views ? `${fmtNum(b.views)} views` : "", b.er !== null && b.er !== undefined ? `ER ${Number(b.er).toFixed(1)}%` : ""].filter(Boolean).join(", ");
      parts.push(`- "${clip(b.c.title, 90)}" (${b.c.format || "?"}, ${b.c.funnel || "?"}) — ${nums}.${b.hook ? ` Hook: "${b.hook}".` : ""}${b.caption ? ` Caption opens: "${b.caption}".` : ""}`);
    });
  }
  const taste = brand.aiTaste || {};
  const likes = (taste.likes || []).slice(-4);
  const dislikes = (taste.dislikes || []).slice(-5);
  if (likes.length || dislikes.length) {
    parts.push("The owner's taste, from their 👍/👎 on earlier AI output (follow it):");
    likes.forEach((l) => parts.push(`- Liked: "${l.sample}"`));
    dislikes.forEach((d) => parts.push(`- Rejected${d.sample ? `: "${d.sample}"` : ""}${d.note ? ` — their reason: "${d.note}"` : ""}`));
  }
  const lessons = lessonsOf(brand).slice(0, 6);
  if (lessons.length) {
    parts.push("Lessons from this brand's own numbers, month by month (newest first):");
    lessons.forEach((l) => parts.push(`- ${l.month}: ${(l.points || []).join(" ")}`));
  }
  return parts.length ? parts.join("\n") : "";
}

// ---------- "Dibuat berdasarkan: …" ----------

// Up to three short, human reasons the next result will look the way it
// does — shown under generated content so the owner sees the AI remember.
export function learningBasis(brand, { content = [], settings = getSettings() } = {}) {
  if (!brand) return [];
  const out = [];
  const top = bestPosts(content, settings, { n: 1 })[0];
  if (top) {
    const nums = top.views ? t("learn.basis.views", { n: shortNum(top.views) }) : t("learn.basis.er", { er: Number(top.er).toFixed(1) });
    out.push(top.hook ? t("learn.basis.hook", { hook: clip(top.hook, 60), nums }) : t("learn.basis.post", { title: clip(top.c.title, 50), nums }));
  }
  const dislike = [...(brand.aiTaste?.dislikes || [])].reverse().find((d) => d.note || d.sample);
  if (dislike) out.push(dislike.note ? t("learn.basis.dislikeNote", { note: clip(dislike.note, 60) }) : t("learn.basis.dislike", { sample: clip(dislike.sample, 50) }));
  const lesson = lessonsOf(brand)[0];
  if (lesson?.points?.length) out.push(t("learn.basis.lesson", { point: clip(lesson.points[0], 80) }));
  return out.slice(0, 3);
}
export function basisHTML(brand, opts = {}) {
  const items = learningBasis(brand, opts);
  if (!items.length) return "";
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  return `<p class="ai-basis"><b>${t("learn.basis.label")}</b> ${items.map(esc).join(" · ")}</p>`;
}

// ---------- Data instead of generic advice ----------

// "Kamu belum posting 9 hari. Terakhir kali jeda segini, views turun 30%."
// or, when the rhythm is fine, what's worth repeating. null when there's
// nothing real to say.
// `withBest: false` skips the best-post fallback (the report lists best
// posts on its own line).
export function postingLine(content = [], settings = getSettings(), now = new Date(), { withBest = true } = {}) {
  const published = content.filter((c) => c.status === "published" && c.publishedDate).sort((a, b) => a.publishedDate.localeCompare(b.publishedDate));
  if (!published.length) return null;
  const today = new Date(localISODate(now) + "T12:00:00").getTime();
  const last = published[published.length - 1];
  const since = Math.round((today - publishedAt(last)) / DAY);
  if (since >= 3) {
    let line = t("learn.gap.now", { days: since });
    // The last earlier gap at least this long (or a week), and what the
    // next post did compared to the five before it.
    const minGap = Math.max(3, Math.min(since, 7));
    for (let i = published.length - 1; i >= 1; i--) {
      const gap = Math.round((publishedAt(published[i]) - publishedAt(published[i - 1])) / DAY);
      if (gap < minGap) continue;
      const after = organicViews(published[i]);
      const before = published.slice(Math.max(0, i - 5), i).map(organicViews).filter((v) => v !== null && v !== undefined);
      if (after === null || after === undefined || before.length < 2) break;
      const avg = before.reduce((a, b) => a + b, 0) / before.length;
      const pct = avg ? Math.round(((after - avg) / avg) * 100) : 0;
      if (pct <= -10) line += ` ${t("learn.gap.before", { gap, pct: Math.abs(pct) })}`;
      break;
    }
    return line;
  }
  return bestFormatLine(published, now) || (withBest ? bestPostsLine(content, settings, { one: true }) : null);
}

// "Reels kamu rata-rata dapat 2,1× views dibanding format lain."
function bestFormatLine(published, now = new Date()) {
  const since = now.getTime() - 60 * DAY;
  const groups = new Map();
  published.filter((c) => publishedAt(c) >= since && c.format).forEach((c) => {
    const v = organicViews(c);
    if (v === null || v === undefined) return;
    if (!groups.has(c.format)) groups.set(c.format, []);
    groups.get(c.format).push(v);
  });
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const fmts = [...groups.entries()].filter(([, v]) => v.length >= 2);
  if (fmts.length < 2) return null;
  fmts.sort((a, b) => avg(b[1]) - avg(a[1]));
  const [bestName, bestViews] = fmts[0];
  const others = fmts.slice(1).flatMap(([, v]) => v);
  const ratio = avg(bestViews) / Math.max(1, avg(others));
  if (ratio < 1.3) return null;
  return t("learn.format", { format: bestName, x: ratio.toFixed(1).replace(".", getLang() === "en" ? "." : ",") });
}

// "Tiga konten terbaikmu: “A” (12rb views), “B”, “C”."
export function bestPostsLine(content = [], settings = getSettings(), { one = false } = {}) {
  const best = bestPosts(content, settings, { n: one ? 1 : 3 });
  if (!best.length) return null;
  const label = (b) => `“${clip(b.c.title, 40)}”${b.views ? ` (${shortNum(b.views)} views)` : b.er !== null && b.er !== undefined ? ` (ER ${Number(b.er).toFixed(1)}%)` : ""}`;
  return one ? t("learn.best.one", { post: label(best[0]) }) : t("learn.best.many", { posts: best.map(label).join(", ") });
}

// The monthly summary, run by the app once a month (js/main.js). Free for
// the owner; skipped without enough posts, and each month is only tried once.
export async function maybeMonthlyLessons(brandId, { ai, summarize, allowed }) {
  const brand = getBrand(brandId);
  if (!brand || !allowed) return;
  const month = previousMonth();
  if (brand.lessonsCheckedMonth === month || (brand.lessons || []).some((l) => l.month === month)) return;
  const rows = monthRows(listContent(brandId), getSettings(), month);
  if (rows.length < MIN_LESSON_POSTS) {
    updateBrand(brandId, { lessonsCheckedMonth: month });
    return;
  }
  try {
    const lessons = await summarize(ai, { brand, month, rows });
    saveLessons(brandId, month, lessons);
  } catch {
    // Try again next time the app opens.
  }
}
