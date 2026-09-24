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

export const MAX_ASKS = 4;
export const MAX_DRAFTS = 3;
export const MAX_IDEAS = 3;
export const MAX_TASKS = 3;
export const MAX_MOMENTS = 2;
export const MAX_SAVES = 2;
const HANDOFF_TARGETS = ["consultant", "brainstorm", "companion"];

export function parseDirectives(rawText) {
  const nav = [];
  const drafts = [];
  const asks = [];
  const ideas = [];
  const tasks = [];
  const revisions = [];
  const moments = [];
  const saves = [];
  let handoff = null;
  const cleanText = (rawText || "")
    // A rewrite of the script/caption being discussed: multi-line, so it is
    // pulled out first. An unterminated tag (reply cut off, or still
    // streaming) is hidden rather than shown raw.
    .replace(/\[\[revise:(script|caption)\]\]([\s\S]*?)\[\[\/revise\]\]/gi, (_, target, body) => {
      const text = body.trim();
      if (text && revisions.length < 2 && !revisions.some((r) => r.target === target.toLowerCase())) revisions.push({ target: target.toLowerCase(), text });
      return "";
    })
    .replace(/\[\[revise:(?:script|caption)\]\][\s\S]*$/i, "")
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
    .replace(/\[\[idea:([^|\]\n]+)\|([^\]\n]+)\]\]/gi, (_, title, why) => {
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
    // "This belongs to another tab": one per reply, becomes a button that
    // asks the same question there.
    .replace(/\[\[handoff:([a-z]+)\]\]/gi, (_, target) => {
      const k = target.toLowerCase();
      if (!handoff && HANDOFF_TARGETS.includes(k)) handoff = k;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, nav, drafts, asks, ideas, tasks, revisions, moments, saves, handoff };
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
