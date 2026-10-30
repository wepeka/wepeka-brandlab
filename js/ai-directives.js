// The directive language every chat-style AI surface here shares — the
// three tabs of "Tanya Brandlab" (js/consultant-panel.js) and Creator's
// script discussion. The model is told to end a reply with lines like
// [[goto:calendar]], [[draft:TOFU|Judul]], [[ask:Pertanyaan]],
// [[idea:Judul|kenapa]], [[moment:offer|Judul|detail]], [[handoff:brainstorm]];
// this pulls them out of the raw text so each becomes a real button instead
// of something the user has to go find in the nav or retype into Creator.
// One parser, one set of caps, so the surfaces never drift apart in what
// they accept.
import { t } from "./i18n.js";
import { FUNNELS, MOMENT_KINDS } from "./store.js";
import { CONSULTANT_ROUTES } from "./ai.js";
import { escapeHtml } from "./dom.js";
import { WIDGET_KINDS, WIDGET_PERIODS, DEFAULT_PERIOD, MAX_WIDGETS, widgetHistoryLine } from "./chat-widgets.js";

export const MAX_ASKS = 4;
export const MAX_DRAFTS = 3;
export const MAX_IDEAS = 3;
export const MAX_TASKS = 3;
export const MAX_MOMENTS = 2;
export const MAX_SAVES = 2;
export const MAX_SCRIPTS = 1;
export const MAX_SEARCHES = 1;
// A recommended move in a Konsultan answer ([[move:Title|why|how]]), shown
// as a numbered card right where the model wrote it (owner, 2026-10-31:
// "saran AI yang bagus di highlight"). The line becomes a marker in the
// text, so the card keeps its place between the paragraphs.
export const MAX_MOVES = 4;
const moveMark = (i) => `\u27E6move:${i}\u27E7`;
const MOVE_MARK_RE = /\u27E6move:(\d+)\u27E7/g;
// Numbers the consultant read off a screenshot the user sent
// ([[metrics:views=12300;hookPct=62]]) — become a "save to a post" card.
export const METRIC_DIRECTIVE_KEYS = ["views", "reach", "likes", "comments", "shares", "saves", "reposts", "profileVisits", "followersGained", "videoLengthSec", "avgWatchTimeSec", "hookPct", "completionPct", "skipRatePct"];
const RETENTION_DIRECTIVE_KEYS = new Set(["videoLengthSec", "avgWatchTimeSec", "hookPct", "completionPct", "skipRatePct"]);
const HANDOFF_TARGETS = ["consultant", "brainstorm", "companion"];
// A chart the Konsultan asks the app to draw under its answer
// ([[widget:performance|30]], [[widget:campaign|ID]]) — js/chat-widgets.js
// works the numbers out; the model only names the kind and the period.
const PERIOD_ALIASES = { week: "7", minggu: "7", month: "30", bulan: "30", quarter: "90", "3bulan": "90", semua: "all", alltime: "all" };
function widgetRequest(kind, arg) {
  const k = String(kind || "").trim().toLowerCase().replace(/_/g, "-").replace(/^top$/, "top-posts");
  if (!WIDGET_KINDS.includes(k)) return null;
  const a = String(arg || "").trim();
  if (k === "campaign" || k === "post") return { kind: k, period: DEFAULT_PERIOD, arg: a.replace(/^(?:campaign|post|id)\s*[:=]\s*/i, "") };
  const p = a.toLowerCase().replace(/\s+|hari|days?/g, "");
  return { kind: k, period: WIDGET_PERIODS.includes(p) ? p : PERIOD_ALIASES[p] || DEFAULT_PERIOD, arg: "" };
}

// "Cara aku nyimpulin": the steps behind an answer about results or what to
// do — [[reasoning]] lines "what was checked → what it showed", ending with
// "Jadi: …" — shown as a card above the answer (js/consultant-panel.js).
export const MAX_REASONING = 6;
const CONCLUSION = /^(jadi|kesimpulan(nya)?|intinya|so|conclusion)\s*[:：]\s*/i;
export function parseReasoning(body) {
  const steps = [];
  String(body || "").split("\n").forEach((raw) => {
    const line = raw.replace(/\[\[[^\]]*\]?\]?/g, "").replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim();
    if (!line || steps.length >= MAX_REASONING) return;
    if (CONCLUSION.test(line)) return void steps.push({ kind: "conclusion", text: line.replace(CONCLUSION, "").slice(0, 220) });
    const m = line.match(/^(.*?)\s*(?:→|->|=>)\s*(.+)$/);
    const check = (m ? m[1] : line).replace(/^(?:(?:saya|aku|gue|i)\s+)?(?:cek|dicek|ngecek|lihat|check(?:ed)?)\s*[:：]?\s+/i, "").trim();
    steps.push({ kind: "step", check: check.slice(0, 160), found: m ? m[2].trim().slice(0, 200) : "" });
  });
  return steps.filter((x) => x.kind === "conclusion" ? x.text : x.check);
}

export function parseDirectives(rawText) {
  const nav = [];
  const drafts = [];
  const asks = [];
  const ideas = [];
  const tasks = [];
  const revisions = [];
  const moments = [];
  const saves = [];
  const scripts = [];
  const widgets = [];
  const searches = [];
  const moves = [];
  let reasoning = [];
  // An unclosed [[reasoning]] (still streaming): the steps so far, shown live.
  let reasoningLive = null;
  let handoff = null;
  let metrics = null;
  // The unclosed script/revision a reply ended inside (cut off, or the
  // model never closed it): { kind, title, format, funnel, target, text }.
  // Hidden from cleanText like before — while streaming it is still being
  // written — but kept, so a finished reply can show what did arrive
  // instead of an intro line with nothing under it.
  let partial = null;
  const partialBody = (body) => String(body || "").replace(/\[\[[^\]\n]*\]\]/g, "").replace(/\[\[[^\]]*$/, "").replace(/\[$/, "").trim();
  const cleanText = (rawText || "")
    .replace(/\[\[reasoning\]\]([\s\S]*?)\[\[\/reasoning\]\]/gi, (_, body) => {
      if (!reasoning.length) reasoning = parseReasoning(body);
      return "";
    })
    .replace(/\[\[reasoning\]\]([\s\S]*)$/i, (_, body) => {
      reasoningLive = parseReasoning(body.replace(/\n[^\n]*$/, ""));
      return "";
    })
    .replace(/\[\[metrics:([^\]\n]+)\]\]/gi, (_, body) => {
      if (metrics) return "";
      const perf = {};
      const retention = {};
      body.split(/[;,]/).forEach((pair) => {
        const [k, v] = pair.split("=").map((x) => (x || "").trim());
        const key = METRIC_DIRECTIVE_KEYS.find((m) => m.toLowerCase() === k.toLowerCase());
        const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
        if (!key || !isFinite(n)) return;
        if (RETENTION_DIRECTIVE_KEYS.has(key)) retention[key] = n;
        else perf[key] = Math.round(n);
      });
      if (Object.keys(perf).length || Object.keys(retention).length) metrics = { metrics: perf, retention, saved: null };
      return "";
    })
    // A rewrite of the script/caption being discussed: multi-line, so it is
    // pulled out first. An unterminated tag (reply cut off, or still
    // streaming) is hidden rather than shown raw.
    // The model closes it as [[/revise]] or, about as often, [[/revise:script]]
    // — both count (the second used to be read as "never closed", which
    // hid the whole revision: "ini versi barunya" with nothing under it).
    .replace(/\[\[revise:(script|caption)\]\]([\s\S]*?)\[\[\/revise(?::(?:script|caption))?\]\]/gi, (_, target, body) => {
      const text = body.trim();
      if (text && revisions.length < 2 && !revisions.some((r) => r.target === target.toLowerCase())) revisions.push({ target: target.toLowerCase(), text });
      return "";
    })
    .replace(/\[\[revise:(script|caption)\]\]([\s\S]*)$/i, (_, target, body) => {
      const text = partialBody(body);
      if (text) partial = { kind: "revise", target: target.toLowerCase(), title: "", format: "", funnel: "", text };
      return "";
    })
    // A finished script the owner asked for, ready to shoot:
    // [[script:FUNNEL|Title|Format]]…[[/script]] (format optional). Becomes a
    // "Script siap" card with "Setujui & simpan" — the chat never saves by
    // itself. A "CAPTION:" line inside splits off the caption. Unterminated
    // (still streaming, or cut off) is hidden rather than shown raw.
    .replace(/\[\[script:([^\]\n]*)\]\]([\s\S]*?)\[\[\/script(?::[^\]\n]*)?\]\]/gi, (_, head, body) => {
      const [funnel = "", title = "", format = ""] = head.split("|").map((x) => x.trim());
      const text = body.trim();
      if (!text || scripts.length >= MAX_SCRIPTS) return "";
      const [scriptPart, captionPart = ""] = text.split(/\n\s*\**\s*caption\s*\**\s*:\s*\**/i);
      const f = funnel.toUpperCase();
      scripts.push({
        funnel: (FUNNELS || []).includes(f) ? f : "TOFU",
        title: (title || t("chat.script.untitled")).slice(0, 140),
        format: format.slice(0, 40),
        script: scriptPart.trim(),
        caption: captionPart.trim(),
        contentId: null,
      });
      return "";
    })
    .replace(/\[\[script:([^\]\n]*)\]\]([\s\S]*)$/i, (_, head, body) => {
      const [funnel = "", title = "", format = ""] = head.split("|").map((x) => x.trim());
      const text = partialBody(body);
      const f = funnel.toUpperCase();
      if (text) partial = { kind: "script", target: "script", title: title.slice(0, 140), format: format.slice(0, 40), funnel: (FUNNELS || []).includes(f) ? f : "", text };
      return "";
    })
    .replace(/\[\[goto:campaign:([A-Za-z0-9_-]+)\]\]/g, (_, id) => {
      if (!nav.some((n) => n.key === `campaign:${id}`)) nav.push({ key: `campaign:${id}`, label: t("cons.nav.campaign"), path: `campaigns/${id}` });
      return "";
    })
    .replace(/\[\[open:insights\]\]/gi, () => {
      if (!nav.some((n) => n.key === "insights")) nav.push({ key: "insights", label: t("cons.nav.insights"), open: "insights" });
      return "";
    })
    .replace(/\[\[goto:([a-z-]+)\]\]/gi, (_, key) => {
      const route = CONSULTANT_ROUTES.find((r) => r.key === key.toLowerCase());
      if (route && !nav.some((n) => n.key === route.key)) nav.push({ ...route, label: t(`cons.route.${route.key}`) });
      return "";
    })
    .replace(/\[\[ask:([^\]\n]+)\]\]/gi, (_, q) => {
      const clean = q.trim();
      if (clean && asks.length < MAX_ASKS && !asks.includes(clean)) asks.push(clean.slice(0, 120));
      return "";
    })
    .replace(/\[\[draft:([a-z]+)\|([^\]\n]+)\]\]/gi, (_, funnel, title) => {
      const f = funnel.toUpperCase();
      const clean = title.trim();
      if (clean && drafts.length < MAX_DRAFTS && !drafts.some((d) => d.title === clean)) {
        drafts.push({ funnel: (FUNNELS || []).includes(f) ? f : "TOFU", title: clean.slice(0, 140), contentId: null });
      }
      return "";
    })
    // [[idea:Title|why]] — a third part some replies add ("|Reels") is
    // dropped instead of showing up at the end of the "why".
    .replace(/\[\[idea:([^|\]\n]+)\|([^|\]\n]+)(?:\|[^\]\n]*)?\]\]/gi, (_, title, why) => {
      const cleanTitle = title.trim().slice(0, 140);
      if (cleanTitle && ideas.length < MAX_IDEAS && !ideas.some((i) => i.title === cleanTitle)) {
        ideas.push({ title: cleanTitle, why: why.trim().slice(0, 400) });
      }
      return "";
    })
    // A real-world step for an event, not a piece of content — "find 6
    // alumni", "book the venue": [[task:Title|why|target|unit|phase]] (every
    // part after the title is optional).
    .replace(/\[\[task:([^\]\n]+)\]\]/gi, (_, body) => {
      const [title = "", why = "", target = "", unit = "", phase = ""] = body.split("|").map((x) => x.trim());
      const n = Number(String(target).replace(/[^\d.]/g, ""));
      const clean = title.slice(0, 120);
      if (clean && tasks.length < MAX_TASKS && !tasks.some((x) => x.title === clean)) {
        tasks.push({ title: clean, why: why.slice(0, 300), target: Number.isFinite(n) && n > 0 ? Math.round(n) : null, unit: unit.slice(0, 24), phase: phase.slice(0, 40) });
      }
      return "";
    })
    // Something that happened to the brand, offered by the Teman tab for
    // brand memory: [[moment:KIND|title|detail]] (detail optional). Unknown
    // kinds become "other"; the owner still has to press "Simpan".
    .replace(/\[\[moment:([^\]\n]+)\]\]/gi, (_, body) => {
      const [kind = "", title = "", detail = ""] = body.split("|").map((x) => x.trim());
      const cleanTitle = title.slice(0, 80);
      const k = kind.toLowerCase();
      if (cleanTitle && moments.length < MAX_MOMENTS && !moments.some((m) => m.title === cleanTitle)) {
        moments.push({ kind: MOMENT_KINDS.includes(k) ? k : "other", title: cleanTitle, detail: detail.slice(0, 160), saved: false, skipped: false });
      }
      return "";
    })
    // An idea the owner liked, offered for the saved list:
    // [[save:Title|why]] → "Simpan ke Tersimpan?" (the owner still decides).
    .replace(/\[\[save:([^|\]\n]+)(?:\|([^\]\n]*))?\]\]/gi, (_, title, why = "") => {
      const clean = title.trim().slice(0, 140);
      if (clean && saves.length < MAX_SAVES && !saves.some((x) => x.title === clean)) saves.push({ title: clean, why: (why || "").trim().slice(0, 400), saved: false, skipped: false });
      return "";
    })
    // "I don't know this one — search it": [[search:query|why]] becomes a
    // card that opens the in-app search (js/idea-search.js).
    .replace(/\[\[search:([^|\]\n]+)(?:\|([^\]\n]*))?\]\]/gi, (_, q, why = "") => {
      const clean = q.trim().slice(0, 100);
      if (clean && searches.length < MAX_SEARCHES && !searches.some((x) => x.q === clean)) searches.push({ q: clean, why: (why || "").trim().slice(0, 160) });
      return "";
    })
    .replace(/\[\[move:([^\]\n]+)\]\]/gi, (_, body) => {
      const [title = "", why = "", how = ""] = body.split("|").map((x) => x.trim());
      const clean = title.replace(/\*\*/g, "").slice(0, 120);
      if (!clean || moves.length >= MAX_MOVES || moves.some((m) => m.title === clean)) return "";
      moves.push({ title: clean, why: why.slice(0, 400), how: how.slice(0, 600) });
      return `\n${moveMark(moves.length - 1)}\n`;
    })
    .replace(/\[\[widget:([a-z_-]+)(?:\|([^\]\n]*))?\]\]/gi, (_, kind, arg) => {
      const w = widgetRequest(kind, arg);
      if (w && widgets.length < MAX_WIDGETS && !widgets.some((x) => x.kind === w.kind && x.arg === w.arg)) widgets.push(w);
      return "";
    })
    // "This belongs to another tab": one per reply, becomes a button that
    // asks the same question there.
    .replace(/\[\[handoff:([a-z]+)\]\]/gi, (_, target) => {
      const k = target.toLowerCase();
      if (!handoff && HANDOFF_TARGETS.includes(k)) handoff = k;
      return "";
    })
    // Whatever is left that still looks like a directive — a tag this
    // parser doesn't know, a stray closing tag, or one cut off half-way
    // ("[[script:TOFU|Jud") — is never shown to the owner as raw text.
    .replace(/\[\[\/?[a-z][a-z-]*(?::[^\]\n]*)?\]\]/gi, "")
    .replace(/\[\[[^\]]*$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, nav, drafts, asks, ideas, tasks, revisions, moments, saves, scripts, widgets, searches, moves, reasoning, reasoningLive, handoff, metrics, partial };
}

// Nothing the owner could see or use came back: no text, no card, no
// button. The chat treats that like a cut-off reply (note + "Coba lagi")
// instead of an empty bubble — or, before, the raw [[…]] lines.
export function isEmptyReply(p) {
  if (!p) return true;
  return !p.cleanText && !p.partial && !p.handoff && !p.metrics
    && !["nav", "drafts", "asks", "ideas", "tasks", "revisions", "moments", "saves", "scripts", "widgets", "searches", "moves", "reasoning"].some((k) => (p[k] || []).length);
}

// What the model wrote last time, as it wrote it: the reply's text plus its
// cards turned back into directive lines. The chat history sent with the
// next message uses this — before, only the text went back, so the model
// never saw the script or ideas it had just written ("ganti hook-nya" got a
// script written from scratch) and slowly stopped using the [[…]] lines it
// no longer saw itself use.
export function serializeDirectives(text, blocks = {}) {
  const b = blocks || {};
  const out = [];
  if ((b.reasoning || []).length) out.push(`[[reasoning]]\n${b.reasoning.map((x) => (x.kind === "conclusion" ? `Jadi: ${x.text}` : `${x.check}${x.found ? ` → ${x.found}` : ""}`)).join("\n")}\n[[/reasoning]]`);
  out.push(expandMoves(text, b.moves, (m) => `[[move:${m.title}|${m.why || ""}|${m.how || ""}]]`).trim());
  (b.ideas || []).forEach((i) => i?.title && out.push(`[[idea:${i.title}|${i.why || ""}]]`));
  (b.scripts || []).forEach((sc) => {
    if (!sc?.script) return;
    out.push(`[[script:${sc.funnel || "TOFU"}|${sc.title || ""}|${sc.format || ""}]]\n${sc.script}${sc.caption ? `\nCAPTION: ${sc.caption}` : ""}\n[[/script]]`);
  });
  (b.revisions || []).forEach((r) => r?.text && out.push(`[[revise:${r.target}]]\n${r.text}\n[[/revise]]`));
  (b.drafts || []).forEach((d) => d?.title && out.push(`[[draft:${d.funnel || "TOFU"}|${d.title}]]`));
  (b.saves || []).forEach((x) => x?.title && out.push(`[[save:${x.title}|${x.why || ""}]]`));
  (b.tasks || []).forEach((x) => x?.title && out.push(`[[task:${x.title}|${x.why || ""}]]`));
  (b.widgets || []).forEach((w) => w?.kind && out.push(widgetHistoryLine(w)));
  (b.searches || []).forEach((x) => x?.q && out.push(`[[search:${x.q}]]`));
  // Moments already offered for Memori Brand — so the next reply doesn't
  // offer the same news again.
  (b.moments || []).forEach((m) => m?.title && out.push(`[[moment:${m.kind || "other"}|${m.title}|${m.detail || ""}]]`));
  if (b.weekPlan?.items?.length) out.push(`(Week plan shown as a card:)\n${b.weekPlan.items.map((it) => `- ${it.date}: ${it.title}${it.angle ? ` — ${it.angle}` : ""}`).join("\n")}`);
  return out.filter(Boolean).join("\n");
}

// The move markers in a stored answer, written back out: as the directive
// line (history for the model), as plain text (copy), or dropped.
export function expandMoves(text, moves = [], fmt = () => "") {
  return String(text || "").replace(MOVE_MARK_RE, (_, i) => (moves?.[i] ? fmt(moves[i], Number(i)) : ""));
}
export const movesAsText = (text, moves) => expandMoves(text, moves, (m, i) => `${i + 1}. ${m.title}${m.why ? `\n${m.why}` : ""}${m.how ? `\n${m.how}` : ""}`);
// Rendered answer HTML (renderLightMarkdown) with each marker paragraph
// swapped for its card; `cardHTML(move, index)` draws one.
export function renderMoves(html, moves = [], cardHTML) {
  return String(html || "").replace(/<p>\u27E6move:(\d+)\u27E7<\/p>/g, (_, i) => (moves?.[i] ? cardHTML(moves[i], Number(i)) : "")).replace(MOVE_MARK_RE, "");
}

// The model answers in light markdown (bold, italics, numbered/bulleted
// lists) even when asked not to — render that subset after escaping,
// instead of showing raw asterisks to the user. Anything else stays
// literal text.
export function renderLightMarkdown(text) {
  const esc = escapeHtml(text);
  const lines = esc.split("\n");
  const out = [];
  let list = null; // "ol" | "ul"
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  const isItem = (l) => /^\s*(\d+)[.)]\s+/.test(l) || /^\s*[-•]\s+/.test(l);
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    // "### Kenapa viral" — short section headers in a longer discussion.
    const head = line.match(/^\s*#{1,4}\s+(.+)$/);
    if (head) { closeList(); out.push(`<h4 class="md-h">${inline(head[1].replace(/\s*#+\s*$/, ""))}</h4>`); return; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-•]\s+(.*)$/);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      // Keep the model's own number, in case a list does get split.
      out.push(ol ? `<li value="${ol[1]}">${inline(ol[2])}</li>` : `<li>${inline(ul[1])}</li>`);
      return;
    }
    // A blank line between two items is still the same list — models
    // double-space their lists, which used to split them into several with
    // a wide gap each; the list runs on instead.
    if (!line.trim() && list) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && isItem(next)) return;
    }
    closeList();
    // Paragraphs and lists carry their own spacing, so one blank line adds
    // nothing; only a second blank line in a row becomes a visible gap.
    if (!line.trim()) { if (i > 0 && !lines[i - 1].trim()) out.push("<br>"); return; }
    out.push(`<p>${inline(line)}</p>`);
  });
  closeList();
  return out.join("").replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
}
