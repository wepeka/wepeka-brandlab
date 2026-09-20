// The directive language every chat-style AI surface here shares — the
// Consultant FAB (js/consultant-panel.js), the Home Companion
// (js/views/home.js), and the Brainstorm partner next (R4). The model is
// told to end a reply with lines like [[goto:calendar]], [[draft:TOFU|Judul]],
// [[ask:Pertanyaan]], [[idea:Judul|kenapa]]; this pulls them out of the raw
// text so each becomes a real button instead of something the user has to
// go find in the nav or retype into Creator. One parser, one set of caps,
// so the three surfaces never drift apart in what they accept.
import { t } from "./i18n.js";
import { FUNNELS } from "./store.js";
import { CONSULTANT_ROUTES } from "./ai.js";
import { escapeHtml } from "./dom.js";

export const MAX_ASKS = 3;
export const MAX_DRAFTS = 3;
export const MAX_IDEAS = 3;

export function parseDirectives(rawText) {
  const nav = [];
  const drafts = [];
  const asks = [];
  const ideas = [];
  const cleanText = (rawText || "")
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
        ideas.push({ title: cleanTitle, why: why.trim().slice(0, 240) });
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, nav, drafts, asks, ideas };
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
  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-•]\s+(.*)$/);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(ol ? ol[2] : ul[1])}</li>`);
      return;
    }
    closeList();
    if (!line.trim()) { out.push("<br>"); return; }
    out.push(`<p>${inline(line)}</p>`);
  });
  closeList();
  return out.join("").replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
}
