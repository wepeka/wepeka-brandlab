// Rencana Minggu (Create → Rencana Minggu, js/views/rencana.js): one page a
// brand's team or client opens to see what this week is about — every piece
// day by day with its concept, reference videos, gear and notes — and takes
// along as one PDF (owner, 2026-11-09, for Quatro: "plan minggu ini ngapain,
// ada referensi video, konsep konten, gearnya apa aja, dan notes … bisa
// download dan check dari brandlab dengan mudah").
//
// This file is the plain part (no DOM): which pieces a week holds, the
// reference field read as video cards, the gear field read as a list.
import { addDays, weekStart } from "./goal-roadmap.js";

export { weekStart };

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
// Trailing punctuation a sentence leaves stuck to a link.
const cleanURL = (u) => u.replace(/[.,;:!?]+$/, "");

// Which site a link is, and its YouTube id (for the thumbnail).
export function refSource(url) {
  let u;
  try { u = new URL(url); } catch { return { kind: "link", id: "" }; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return { kind: "youtube", id: u.pathname.slice(1).split("/")[0] };
  if (/(^|\.)youtube\.com$/.test(host)) {
    const id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/) || [])[1] || "";
    return { kind: "youtube", id };
  }
  if (/(^|\.)instagram\.com$/.test(host)) return { kind: "instagram", id: "" };
  if (/(^|\.)tiktok\.com$/.test(host)) return { kind: "tiktok", id: "" };
  return { kind: "link", id: "" };
}
export const youtubeThumb = (id) => (id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : "");

// A line that only names the site ("Instagram Reels", "YouTube Shorts"): the
// card shows the site already.
const SITE_LINE = /^(instagram|youtube|tiktok|ig|yt)(\s+(reels?|shorts?|video|post))?$/i;
// "1. ", "2) ", "- ", "• " in front of a title.
const stripLead = (s) => s.replace(/^\s*(?:\d{1,2}[.)]|[-•*])\s+/, "").trim();

// The Referensi field as cards: each paragraph with a link is one video (its
// first line the title, the lines after it the notes), a paragraph of bare
// links is one card per link, and text without a link stays as text
// ("Referensi video (pelajari polanya…)").
export function parseRefs(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const blocks = src.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean);
  const refs = [];
  const notes = [];
  for (const block of blocks) {
    const urls = (block.match(URL_RE) || []).map(cleanURL);
    if (!urls.length) { notes.push(block); continue; }
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const words = lines.map((l) => l.replace(URL_RE, "").replace(/^\s*(?:\d{1,2}[.)]|[-•*])\s*$/, "").trim());
    // Only links (one per line, or several on one line): a card each.
    if (words.every((w) => !w)) {
      urls.forEach((url) => refs.push({ url, title: "", notes: [], ...refSource(url) }));
      continue;
    }
    let title = "";
    const rest = [];
    lines.forEach((line, i) => {
      const w = words[i];
      if (!w || SITE_LINE.test(w)) return;
      // "Ref: https://…" — the words around the link are its title.
      if (!title) title = stripLead(w).replace(/[:\-–—]\s*$/, "").trim();
      else rest.push(w);
    });
    refs.push({ url: urls[0], title, notes: rest, ...refSource(urls[0]) });
    // More links in the same paragraph: their own cards, no title.
    urls.slice(1).forEach((url) => refs.push({ url, title: "", notes: [], ...refSource(url) }));
  }
  return { refs, notes };
}

// The Gear field as a list: one thing per line (or split by commas / ";"),
// bullets and numbers dropped, empty lines gone.
export function gearItems(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n|;|,(?![^(]*\))/)
    .map((s) => stripLead(s).replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

// Everything to bring this week, once each (case and spacing don't make a
// second line), with the pieces that need it: [{ name, codes: ["QN-1"] }].
export function weekGear(pieces, codeOf = () => "") {
  const byKey = new Map();
  pieces.forEach((c) => {
    gearItems(c.gear).forEach((name) => {
      const key = name.toLowerCase().replace(/\s+/g, " ");
      if (!byKey.has(key)) byKey.set(key, { name, codes: [] });
      const code = codeOf(c) || c.title || "";
      const row = byKey.get(key);
      if (code && !row.codes.includes(code)) row.codes.push(code);
    });
  });
  return [...byKey.values()];
}

const dateOf = (c) => String(c.scheduleDate || "").slice(0, 10);
const timeOf = (c) => String(c.posting?.time || "");

// The pieces of the week starting `from` (a Monday), in posting order. A
// piece made twice for two platforms (mirror twins) is shown once, and a
// trial cut (KP-12B) belongs to its piece, not the plan.
export function weekPieces(content, from) {
  const to = addDays(from, 6);
  const seen = new Set();
  return content
    .filter((c) => !c.trialOf && !c.archived && !c.deletedAt)
    .filter((c) => { const d = dateOf(c); return d && d >= from && d <= to; })
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || (timeOf(a) || "99").localeCompare(timeOf(b) || "99") || (a.createdAt || 0) - (b.createdAt || 0))
    .filter((c) => {
      if (!c.mirrorGroupId) return true;
      if (seen.has(c.mirrorGroupId)) return false;
      seen.add(c.mirrorGroupId);
      return true;
    });
}

// The week's pieces grouped by day: [{ date, items }], days without a piece left out.
export function byDay(pieces) {
  const days = [];
  pieces.forEach((c) => {
    const d = dateOf(c);
    const last = days[days.length - 1];
    if (last && last.date === d) last.items.push(c);
    else days.push({ date: d, items: [c] });
  });
  return days;
}
