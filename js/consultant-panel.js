// "Tanya Brandlab" — the floating chat: ONE box, one conversation. Behind it
// the three engines that used to be three tabs still exist (js/ai.js):
//
//   • consultant  — askBrandConsultant: grounded answers about THIS brand's
//                   live data, with [[goto]] / [[draft]] / [[ask]] buttons.
//   • brainstorm  — chatBrainstorm: content ideas, ask-first-then-options,
//                   saved to a brand-scoped thread in brainstorms/ so the
//                   full Brainstorm page (campaign-scoped) sees them too.
//   • companion   — companionChat ("Teman Brand"): the warm friend. Written
//                   to the same companion thread the Home card shows, so the
//                   recap / moments flow there keeps working.
//
// By default the owner never picks an engine ("Otomatis"). Each message is routed: obvious keywords
// first (free, instant), else one tiny model call (classifyChatIntent, not
// counted against credits), and a short follow-up stays with whoever
// answered last. Every reply carries a small label saying which engine it
// came from, plus "Bukan ini maksudmu?" chips to re-answer another way —
// so a wrong guess costs one tap, never a dead end. A mode row under the
// header (Otomatis · Konsultan · Brainstorm · Teman) lets the owner pin one
// engine for the whole conversation instead. Merged 22 Sep 2026.
//
// Mounted once into document.body from layout.js's wireShell, so it survives
// the #app innerHTML getting torn down on every in-brand navigation.
import { t } from "./i18n.js";
import {
  getBrand, getSettings, listContent, listCampaigns, listOverdueAndDueSoon, createContent, addBrandIdea, updateBrand, localISODate,
  getBrainstorm, createBrainstorm, appendBrainstormMessage, updateBrainstormMessage, getCompanionThread, ensureCompanionThread,
} from "./store.js";
import { campaignStages, activeStageIndex, readStage, campaignHeadline } from "./campaign-metrics.js";
import { nextActions } from "./next-action.js";
import { computeContentMetrics } from "./formulas.js";
import { brandDnaCompleteness } from "./brand-progress.js";
import { askBrandConsultant, chatBrainstorm, companionChat, classifyChatIntent, hasAiKey, AiApiError } from "./ai.js";
import { pulseTextFor } from "./brand-pulse.js";
import { parseDirectives, renderLightMarkdown } from "./ai-directives.js";
import { icon } from "./icons.js";
import { qs, escapeHtml, formatPercent, toast } from "./dom.js";
import { mountAiFeedback } from "./ai-feedback.js";
import { readFlag, writeFlag } from "./seen-flags.js";

const ENGINES = ["consultant", "brainstorm", "companion"];
const ENGINE_ICON = { consultant: "bot", brainstorm: "bulb", companion: "heart" };
const HISTORY_FOR_MODEL = 12;
const THREAD_TITLE_MAX = 60;

// brandId -> [{ role, text, engine, nav, drafts, asks, ideas, question, rated, threadId, msgId }]
// Session-only (resets on reload): the persisted threads live in the store
// (brainstorm + companion); the Consultant never had one.
const historyByBrand = new Map();
// brandId -> the brand-scoped brainstorm thread this session writes to.
const brainstormThread = new Map();
// brandId -> engine pinned by the owner from the mode row (null = Otomatis).
const pinnedEngine = new Map();
let mountedBrandId = null;
let isOpen = false;
let pending = false;

// ---- Routing --------------------------------------------------------------

// Word-boundary keyword rules, Indonesian + English. Companion wins when it
// matches at all (feelings first); brainstorm and consultant only decide
// when exactly one of them matches — otherwise the model is asked.
const RULES = {
  companion: /\b(capek|cape|lelah|males|malas|bosan|bosen|stres|stress|pusing|semangat|takut|khawatir|nyerah|menyerah|sedih|senang|seneng|curhat|kesel|kesal|overwhelmed|tired|burnout|exhausted|frustrated|nggak tahu mulai|gak tau mulai|bingung mulai|cerita)\b/i,
  brainstorm: /\b(ide|idea|ideas|brainstorm|inspirasi|konten apa|bikin apa|posting apa|post apa|topik|angle|hook|mentok|buntu|stuck|kasih ide)\b/i,
  consultant: /\b(performa|performance|engagement|data|angka|statistik|follower|followers|reach|views|campaign|jadwal|schedule|kalender|calendar|overdue|level|milestone|strategi|strategy|analisa|analisis|berapa|how many|kenapa konten|why is|di mana|dimana|gimana caranya|cara|benchmark|target)\b/i,
};

function routeByRules(text) {
  if (RULES.companion.test(text)) return "companion";
  const idea = RULES.brainstorm.test(text);
  const data = RULES.consultant.test(text);
  if (idea && !data) return "brainstorm";
  if (data && !idea) return "consultant";
  return null;
}

function lastEngine(history) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "assistant" && history[i].engine) return history[i].engine;
  return "";
}

async function decideEngine(ai, text, history) {
  const byRules = routeByRules(text);
  if (byRules) return byRules;
  const prev = lastEngine(history);
  // A short reply with no signal of its own ("iya", "yang kedua", "ok lanjut")
  // is almost always the next line of the same conversation.
  if (prev && text.length < 25) return prev;
  try {
    return await classifyChatIntent(ai, { message: text, lastEngine: prev });
  } catch {
    return prev || "consultant";
  }
}

// ---- Consultant's live snapshot ------------------------------------------

function buildSnapshot(brandId) {
  const brand = getBrand(brandId);
  const settings = getSettings();
  const content = listContent(brandId);
  const published = content.filter((c) => c.status === "published" && c.performance);
  const ers = published.map((c) => computeContentMetrics(c, settings).engagementRate).filter((v) => v !== null);
  const avgER = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null;

  const { overdue } = listOverdueAndDueSoon();
  const brandOverdue = overdue.filter((x) => x.brand.id === brandId).length;

  const campaigns = listCampaigns(brandId).filter((c) => c.status !== "archived");
  // One line per campaign built from the same engine the UI uses (stage,
  // headline number, next actions), with the id so the model can point at
  // it with [[goto:campaign:ID]].
  const coverageLines = campaigns.map((c) => {
    const ctx = { brand, campaign: c, content, settings };
    const stages = campaignStages(c);
    const idx = activeStageIndex(c, stages, content);
    const stage = stages[idx];
    if (!stage) return `- ${c.name} (id=${c.id}): belum ada tahap.`;
    const { met, total } = readStage(stage, ctx);
    const head = campaignHeadline(c, stages, idx, ctx);
    const headLine = head && head.reading.target && !head.reading.isCheck ? `${head.milestone.label} ${head.reading.current}/${head.reading.target}${head.reading.stale ? " (data basi, perlu diperbarui)" : ""}` : "";
    const where = stage.kind === "level" ? `Level ${idx + 1}/${stages.length} "${stage.name}"` : stage.kind === "window" ? `fase "${stage.name}" (${stage.dateLabel})` : `fase "${stage.name}"`;
    const acts = nextActions({ ...ctx, limit: 3 }).map((a) => a.label);
    return `- ${c.name} (id=${c.id}): ${where}, ${met}/${total} milestone tercapai${headLine ? `, ${headLine}` : ""}. Langkah berikutnya: ${acts.length ? acts.join("; ") : "-"}.`;
  });

  const dna = brandDnaCompleteness(brand.brandDNA);
  const g = brand.brandGuidelines || {};
  const guidelinesStarted = !!g.colors?.primary || !!g.fonts?.primary || g.logo?.hasLogo != null;

  return [
    `Brand DNA: ${dna.filled}/${dna.total} bagian terisi${dna.filled < dna.total ? " (belum lengkap)" : ""}.`,
    `Brand Guidelines: ${guidelinesStarted ? "udah mulai diisi" : "belum mulai diisi sama sekali"}.`,
    `Konten overdue (lewat jadwal, belum terbit): ${brandOverdue}.`,
    `Total konten: ${content.length}, sudah terbit: ${published.length}.`,
    avgER !== null ? `Rata-rata engagement rate dari konten yang udah terbit dan ada data performanya: ${formatPercent(avgER)}.` : "Belum ada data engagement rate (belum ada konten terbit dengan data performa diisi).",
    campaigns.length ? `Campaign aktif:\n${coverageLines.join("\n")}` : "Belum ada campaign aktif.",
  ].join("\n");
}

const pulseNow = (brandId) => pulseTextFor(getBrand(brandId), { content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });

// ---- Rendering ------------------------------------------------------------

const starterChip = (q, engine = "") => `<button type="button" class="consultant-starter" data-chat-ask="${escapeHtml(q)}" ${engine ? `data-chat-engine="${engine}"` : ""}>${escapeHtml(q)}</button>`;

function ideaCardHTML(idea, index, j) {
  const act = idea.contentId
    ? `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content-os/creator/${escapeHtml(idea.contentId)}">${icon("check", { size: 12 })}${t("chat.idea.openDraft")}</a>`
    : `<button type="button" class="btn btn-primary btn-sm" data-chat-idea-draft="${index}:${j}">${icon("edit", { size: 12 })}${t("chat.idea.draft")}</button>`;
  const save = idea.saved
    ? `<span class="bs-done">${icon("check", { size: 12 })} ${t("chat.idea.saved")}</span>`
    : `<button type="button" class="btn btn-secondary btn-sm" data-chat-idea-save="${index}:${j}">${icon("bookmark", { size: 12 })}${t("chat.idea.save")}</button>`;
  return `
    <div class="cp-idea">
      <div class="cp-idea-title">${escapeHtml(idea.title)}</div>
      ${idea.why ? `<div class="cp-idea-why">${escapeHtml(idea.why)}</div>` : ""}
      <div class="cp-idea-actions">${act}${save}</div>
    </div>`;
}

function messageHTML(h, index, isLast = false) {
  if (h.role === "user") return `<div class="consultant-msg consultant-msg-user" data-consultant-msg="${index}">${escapeHtml(h.text)}</div>`;

  const engineHTML = h.engine ? `<span class="cp-engine cp-engine-${h.engine}">${icon(ENGINE_ICON[h.engine], { size: 11 })}${t(`chat.engine.${h.engine}`)}</span>` : "";
  const navHTML = h.nav?.length
    ? `<div class="consultant-nav-buttons">${h.nav
        .map((n) => `<button type="button" class="consultant-nav-btn" data-consultant-nav="${n.open === "insights" ? "__insights" : n.path}">${escapeHtml(n.label)}${icon("arrowRight", { size: 12 })}</button>`)
        .join("")}</div>`
    : "";
  const draftsHTML = h.drafts?.length
    ? `<div class="consultant-nav-buttons">${h.drafts
        .map((d, j) =>
          d.contentId
            ? `<button type="button" class="consultant-nav-btn" data-consultant-open-draft="${escapeHtml(d.contentId)}">${icon("check", { size: 12 })}${t("cons.draftCreated", { title: escapeHtml(d.title) })}</button>`
            : `<button type="button" class="consultant-nav-btn" data-consultant-draft="${index}:${j}" title="${t("cons.draftCreateTitle", { funnel: d.funnel })}">${icon("plus", { size: 12 })}${t("cons.draftCreate", { title: escapeHtml(d.title) })}</button>`
        )
        .join("")}</div>`
    : "";
  const ideasHTML = (h.ideas || []).map((idea, j) => ideaCardHTML(idea, index, j)).join("");
  // Follow-ups only under the newest answer — older chips would re-ask
  // questions the conversation has already moved past. A chip keeps the
  // engine that wrote it, so answering a Brainstorm question stays there.
  const asksHTML =
    isLast && h.asks?.length
      ? `<div class="consultant-followups"><p class="consultant-followups-label">${t("cons.followUp")}</p><div class="consultant-starters">${h.asks.map((q) => starterChip(q, h.engine)).join("")}</div></div>`
      : "";
  const retryHTML =
    isLast && h.question && h.engine
      ? `<div class="cp-retry"><span>${t("chat.retry.label")}</span>${ENGINES.filter((e) => e !== h.engine)
          .map((e) => `<button type="button" class="consultant-starter" data-chat-retry="${e}">${icon(ENGINE_ICON[e], { size: 11 })}${t(`chat.retry.${e}`)}</button>`)
          .join("")}</div>`
      : "";
  const body = `<div class="consultant-md">${renderLightMarkdown(h.text)}</div>`;
  return `<div class="consultant-msg consultant-msg-assistant" data-consultant-msg="${index}" data-engine="${h.engine || ""}">${engineHTML}${body}${navHTML}${draftsHTML}${ideasHTML}${asksHTML}${retryHTML}</div>`;
}

// First-message nudges for someone who doesn't yet know what to ask — each
// one is a real message, pre-routed so the first answer never misfires.
const STARTERS = [
  { key: "consultant.starter.performance", engine: "consultant" },
  { key: "consultant.starter.week", engine: "consultant" },
  { key: "chat.starter.ideas", engine: "brainstorm" },
  { key: "consultant.starter.quiet", engine: "consultant" },
  { key: "chat.starter.today", engine: "companion" },
];

function panelHTML(brandId) {
  const brand = getBrand(brandId);
  const history = historyByBrand.get(brandId) || [];
  const quotaOut = false;
  return `
    <div class="consultant-panel-head cp-head">
      <div class="cp-head-main">
        <span class="cp-head-icon">${icon("chat", { size: 16 })}</span>
        <div><b>${t("chat.title")}</b><small>${t("chat.sub")}</small></div>
      </div>
      <button type="button" class="icon-btn" id="consultant-close" aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>
    <div class="cp-modes" role="radiogroup" aria-label="${t("chat.mode.aria")}">
      ${["auto", ...ENGINES].map((m) => {
        const active = (pinnedEngine.get(brandId) || "auto") === m;
        return `<button type="button" role="radio" class="cp-mode ${active ? "is-active" : ""}" data-chat-mode="${m}" data-engine="${m}" aria-checked="${active}" aria-describedby="cp-tip-${m}">${m === "auto" ? icon("sparkle", { size: 12 }) : icon(ENGINE_ICON[m], { size: 12 })}<span>${t(`chat.mode.${m}`)}</span><span class="cp-mode-tip" role="tooltip" id="cp-tip-${m}">${t(`chat.mode.tip.${m}`)}</span></button>`;
      }).join("")}
    </div>
    <div class="consultant-panel-body" id="consultant-messages">
      ${
        history.length
          ? history.map((h, i) => messageHTML(h, i, i === history.length - 1)).join("")
          : `<div class="consultant-msg consultant-msg-assistant">${t("chat.greeting", { brand: escapeHtml(brand?.name || t("cons.thisBrand")) })}</div>
             <div class="consultant-starters">${STARTERS.map((s) => starterChip(t(s.key), s.engine)).join("")}</div>`
      }
    </div>
    <div class="consultant-panel-input">
      <textarea id="consultant-input" placeholder="${pinnedEngine.has(brandId) ? t(`chat.placeholder.${pinnedEngine.get(brandId)}`) : t("consultant.placeholder")}" rows="1" ${pending ? "disabled" : ""}></textarea>
      <button type="button" class="icon-btn" id="consultant-send" aria-label="${t("cons.send")}" ${pending || quotaOut ? "disabled" : ""}>${icon("send", { size: 15 })}</button>
    </div>
    <div class="cp-foot">
      <button type="button" class="btn btn-ghost btn-sm" id="chat-ideas-now" title="${escapeHtml(t("chat.ideasNow.title"))}" ${pending ? "disabled" : ""}>${icon("sparkle", { size: 12 })}${t("chat.ideasNow")}</button>
    </div>
  `.replaceAll("__BRAND__", brandId);
}

function scrollToBottom() {
  const el = qs("#consultant-messages");
  if (el) el.scrollTop = el.scrollHeight;
}

// Reveals a freshly rendered assistant bubble word-by-word, like it's
// being typed — purely cosmetic (the full reply is already in). Walks the
// text nodes so the light markdown (bold, lists, nav buttons) stays intact;
// buttons inside the bubble show up only once the text is done. Skipped
// when the OS asks for reduced motion.
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let typewriterRaf = null;

export function typewriterReveal(el, { cps = 110, onTick } = {}) {
  if (!el || reducedMotion()) return;
  if (typewriterRaf) { cancelAnimationFrame(typewriterRaf); typewriterRaf = null; }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) if (n.nodeValue.trim()) nodes.push({ node: n, full: n.nodeValue });
  if (!nodes.length) return;
  const total = nodes.reduce((sum, x) => sum + x.full.length, 0);
  nodes.forEach((x) => { x.node.nodeValue = ""; });
  el.classList.add("is-typing");
  // Time-based, not tick-based: throttled frames (background tab, low
  // power) just make it catch up, never crawl.
  const start = performance.now();
  const frame = (now) => {
    const shown = Math.min(total, Math.floor(((now - start) / 1000) * cps));
    let left = shown;
    for (const x of nodes) {
      const take = Math.max(0, Math.min(x.full.length, left));
      x.node.nodeValue = x.full.slice(0, take);
      left -= take;
    }
    onTick?.();
    if (shown >= total) {
      typewriterRaf = null;
      el.classList.remove("is-typing");
      return;
    }
    typewriterRaf = requestAnimationFrame(frame);
  };
  typewriterRaf = requestAnimationFrame(frame);
}

function renderPanel(brandId, { seed = "" } = {}) {
  const panel = qs("#consultant-panel");
  if (!panel) return;
  // The whole panel takes the pinned engine's colour (css: --cp-accent);
  // Otomatis keeps the Wepeka accent.
  panel.dataset.mode = pinnedEngine.get(brandId) || "auto";
  panel.innerHTML = panelHTML(brandId);
  scrollToBottom();
  qs("#consultant-close", panel).addEventListener("click", () => togglePanel(brandId, false));

  const input = qs("#consultant-input", panel);
  if (seed && input) input.value = seed;
  const send = () => sendMessage(brandId, input.value.trim());
  qs("#consultant-send", panel).addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  if (!pending) input.focus();
  qs("#chat-ideas-now", panel)?.addEventListener("click", () => sendMessage(brandId, input.value.trim() || t("chat.ideasNow.message"), { engine: "brainstorm", ideasNow: true }));

  const history = historyByBrand.get(brandId) || [];

  // Mode row: pin one engine for every message from here on, or go back to
  // Otomatis. Keeps whatever is typed.
  panel.querySelectorAll("[data-chat-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.dataset.chatMode;
      if (m === "auto") pinnedEngine.delete(brandId);
      else pinnedEngine.set(brandId, m);
      const typed = input.value;
      renderPanel(brandId, { seed: typed });
    });
  });

  // Starters and follow-up chips: a real message, pre-routed when the chip
  // knows where it came from.
  panel.querySelectorAll("[data-chat-ask]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(brandId, btn.dataset.chatAsk, { engine: btn.dataset.chatEngine || null }));
  });
  // "Bukan ini maksudmu?" — same question, different engine, no retyping.
  panel.querySelectorAll("[data-chat-retry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const last = [...history].reverse().find((h) => h.role === "assistant" && h.question);
      if (last) sendMessage(brandId, last.question, { engine: btn.dataset.chatRetry, retry: true });
    });
  });

  // Consultant-style draft buttons ([[draft:FUNNEL|Title]]).
  panel.querySelectorAll("[data-consultant-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [mi, di] = btn.dataset.consultantDraft.split(":").map(Number);
      const d = history[mi]?.drafts?.[di];
      if (!d || d.contentId) return;
      // Linked to the brand's active campaign so it counts there right away.
      const active = listCampaigns(brandId).find((c) => c.status !== "archived");
      const item = createContent(brandId, { title: d.title, funnel: d.funnel, campaignId: active?.id || "", idea: history[mi].question ? t("cons.draftIdea", { question: history[mi].question }) : "" });
      d.contentId = item.id;
      syncThreadBlocks(history[mi]);
      toast(t("cons.draftSaved", { title: d.title }));
      renderPanel(brandId);
    });
  });
  panel.querySelectorAll("[data-consultant-open-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/brand/${brandId}/content-os/creator/${btn.dataset.consultantOpenDraft}`;
      togglePanel(brandId, false);
    });
  });

  // Idea cards ([[idea:Title|why]] from Brainstorm or the Companion).
  panel.querySelectorAll("[data-chat-idea-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [mi, ii] = btn.dataset.chatIdeaDraft.split(":").map(Number);
      const h = history[mi];
      const idea = h?.ideas?.[ii];
      if (!idea || idea.contentId) return;
      const item = createContent(brandId, { title: idea.title, funnel: "TOFU", idea: idea.why || "", status: "idea" });
      idea.contentId = item.id;
      syncThreadBlocks(h);
      toast(t("cons.draftSaved", { title: idea.title }));
      renderPanel(brandId);
    });
  });
  panel.querySelectorAll("[data-chat-idea-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [mi, ii] = btn.dataset.chatIdeaSave.split(":").map(Number);
      const h = history[mi];
      const idea = h?.ideas?.[ii];
      if (!idea || idea.saved) return;
      addBrandIdea(brandId, { text: idea.title, description: idea.why || "" });
      idea.saved = true;
      syncThreadBlocks(h);
      toast(t("chat.idea.savedToast"));
      renderPanel(brandId);
    });
  });

  // 👍/👎 under every real answer (not the greeting, not error messages),
  // hidden again once rated so a re-render doesn't ask twice.
  history.forEach((h, i) => {
    if (h.role !== "assistant" || !h.question || !h.engine || h.rated) return;
    mountAiFeedback(panel.querySelector(`[data-consultant-msg="${i}"]`), {
      brandId,
      feature: h.engine,
      prompt: { question: h.question, history: history.slice(0, i - 1).map((x) => ({ role: x.role, text: x.text })) },
      output: h.text,
      onRated: (rating) => { h.rated = rating; },
    });
  });

  panel.querySelectorAll("[data-consultant-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.consultantNav;
      if (path === "__insights") {
        const { openInsightsModal } = await import("./views/insights-modal.js");
        togglePanel(brandId, false);
        openInsightsModal({ brandId });
        return;
      }
      location.hash = path ? `#/brand/${brandId}/${path}` : `#/brand/${brandId}`;
      togglePanel(brandId, false);
    });
  });
  // Any link out of the panel (an open draft) should also tuck it away so
  // the destination is visible.
  panel.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener("click", () => togglePanel(brandId, false)));
}

// A Brainstorm / Companion reply also lives in its persisted thread; keep
// that copy's idea cards in step (saved / drafted) so the Home card and the
// full Brainstorm page don't offer the same thing twice.
function syncThreadBlocks(h) {
  if (!h?.threadId || !h.msgId) return;
  const th = getBrainstorm(h.threadId);
  const msg = th?.messages?.find((m) => m.id === h.msgId);
  if (!msg) return;
  updateBrainstormMessage(h.threadId, h.msgId, { blocks: { ...(msg.blocks || {}), ideas: (h.ideas || []).map((i) => ({ ...i })), drafts: (h.drafts || []).map((d) => ({ ...d })) } });
}

// ---- Sending ----------------------------------------------------------------

function pendingBubble(labelKey) {
  const messagesEl = qs("#consultant-messages");
  if (!messagesEl) return;
  messagesEl.insertAdjacentHTML("beforeend", `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending is-new" id="consultant-pending"><span class="typing-dots" aria-label="${t(labelKey)}"><i></i><i></i><i></i></span></div>`);
  scrollToBottom();
}

async function sendMessage(brandId, text, { engine = null, ideasNow = false, retry = false } = {}) {
  if (!text || pending) return;
  const settings = getSettings();
  const ai = settings.ai || { provider: "anthropic" };
  if (!hasAiKey(ai)) {
    location.hash = "#/settings/ai";
    return;
  }

  const history = historyByBrand.get(brandId) || [];
  // A retry re-answers the question already on screen — no second user bubble.
  if (!retry) history.push({ role: "user", text });
  historyByBrand.set(brandId, history);
  pending = true;
  renderPanel(brandId);
  if (!retry) qs(`[data-consultant-msg="${history.length - 1}"]`)?.classList.add("is-new");
  const sendBtn = qs("#consultant-send");
  if (sendBtn) { sendBtn.classList.add("is-sent"); setTimeout(() => sendBtn.classList.remove("is-sent"), 400); }
  pendingBubble("cons.typing");

  // The answer fills in as it is written (see js/ai.js callClaudeStream).
  let streamed = false;
  let streamTimer = 0;
  let streamRaw = "";
  const streamInto = (raw) => {
    streamed = true;
    streamRaw = raw;
    if (streamTimer) return;
    streamTimer = setTimeout(() => {
      streamTimer = 0;
      const bubble = qs("#consultant-pending");
      if (!bubble) return;
      let shown = parseDirectives(streamRaw).cleanText;
      const open = shown.lastIndexOf("[[");
      if (open !== -1 && !shown.slice(open).includes("]]")) shown = shown.slice(0, open);
      shown = shown.replace(/\[$/, "").trim();
      if (!shown) return;
      bubble.innerHTML = `<div class="consultant-md">${renderLightMarkdown(shown)}</div>`;
      scrollToBottom();
    }, 40);
  };

  try {
    // Explicit (a chip, "Langsung kasih ide", a retry) > pinned mode > routing.
    const picked = ENGINES.includes(engine) ? engine : pinnedEngine.get(brandId) || (await decideEngine(ai, text, history));
    const brand = getBrand(brandId);
    const pulseText = pulseNow(brandId);
    const prior = history.filter((h) => h.text && !(h.role === "assistant" && !h.engine)).slice(0, retry ? undefined : -1).slice(-HISTORY_FOR_MODEL).map((h) => ({ role: h.role, text: h.text }));

    if (picked === "brainstorm") {
      let th = brainstormThread.has(brandId) ? getBrainstorm(brainstormThread.get(brandId)) : null;
      if (!th) {
        th = createBrainstorm(brandId, { mode: "chat", title: text.slice(0, THREAD_TITLE_MAX) });
        brainstormThread.set(brandId, th.id);
      }
      appendBrainstormMessage(th.id, { role: "user", text });
      const all = getBrainstorm(th.id)?.messages || [];
      const threadHistory = all.slice(0, -1).filter((m) => m.text).slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, text: m.text }));
      // Everything already put in front of the owner counts as "don't repeat".
      const shown = all.flatMap((m) => (m.blocks?.ideas || []).map((i) => i.title));
      const savedIdeas = [...new Set([...shown, ...(brand.ideas || []).map((i) => i.text)])];
      const campaigns = listCampaigns(brandId);
      const raw = await chatBrainstorm(ai, {
        brand, campaigns, pulseText, savedIdeas,
        history: threadHistory, message: text,
        mode: ideasNow ? "ideas" : "chat",
        turns: all.filter((m) => m.role === "user").length,
        onText: streamInto,
      });
      const { cleanText, ideas, drafts, asks, tasks } = parseDirectives(raw.trim());
      // No event scope here, so a real-world step is still worth keeping as an idea.
      const allIdeas = [...ideas, ...tasks.map((x) => ({ title: x.title, why: x.why }))];
      const saved = appendBrainstormMessage(th.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas: allIdeas, drafts, asks } });
      history.push({ role: "assistant", engine: "brainstorm", text: cleanText || raw.trim(), ideas: allIdeas, drafts, asks, question: text, threadId: th.id, msgId: saved?.id });
    } else if (picked === "companion") {
      const thread = ensureCompanionThread(brandId);
      appendBrainstormMessage(thread.id, { role: "user", text });
      updateBrand(brandId, { companion: { ...(brand.companion || {}), lastAskedAt: localISODate() } });
      const msgs = getCompanionThread(brandId)?.messages || [];
      const threadHistory = msgs.slice(0, -1).filter((m) => m.text).slice(-16).map((m) => ({ role: m.role, text: m.text }));
      const raw = await companionChat(ai, { brand, pulseText, history: threadHistory, message: text });
      const { cleanText, ideas, asks } = parseDirectives(raw.trim());
      const saved = appendBrainstormMessage(thread.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas, asks } });
      history.push({ role: "assistant", engine: "companion", text: cleanText || raw.trim(), ideas, asks, question: text, threadId: thread.id, msgId: saved?.id });
    } else {
      const snapshotText = buildSnapshot(brandId);
      const reply = await askBrandConsultant(ai, { brand, snapshotText, pulseText, history: prior, question: text, onText: streamInto });
      const { cleanText, nav, drafts, asks } = parseDirectives(reply.trim());
      history.push({ role: "assistant", engine: "consultant", text: cleanText, nav, drafts, asks, question: text });
    }
  } catch (err) {
    history.push({ role: "assistant", text: err instanceof AiApiError ? t("cons.error", { message: err.message }) : t("cons.errorGeneric") });
  }
  historyByBrand.set(brandId, history);
  pending = false;
  if (!isOpen) return; // closed mid-answer: it is waiting when they come back
  renderPanel(brandId);
  const newest = qs(`[data-consultant-msg="${history.length - 1}"]`);
  if (newest) {
    newest.classList.add("is-new");
    // Already visible if it streamed in — only retype a reply that arrived whole.
    if (!streamed) typewriterReveal(newest, { onTick: scrollToBottom });
  }
  scrollToBottom();
}

// ---- Mount / toggle -----------------------------------------------------------

function togglePanel(brandId, open, { seed = "" } = {}) {
  isOpen = open;
  const panel = qs("#consultant-panel");
  const fab = qs("#consultant-fab");
  if (panel) {
    panel.hidden = !open;
    // Restart the open animation each time (hidden → shown re-runs it).
    if (open) { panel.classList.remove("is-opening"); void panel.offsetWidth; panel.classList.add("is-opening"); }
  }
  if (fab) fab.classList.toggle("is-open", open);
  if (open) renderPanel(brandId, { seed });
}

const HINT_SEEN_PREFIX = "contentos:fab-hint-seen:";

// Opened from the topbar "?" popover (js/layout.js) — the FAB itself is
// still the everyday way in. `seed` pre-fills the box; `engine` is accepted
// for callers that know what they want (ignored otherwise).
export function openConsultantPanel({ seed = "" } = {}) {
  if (mountedBrandId) togglePanel(mountedBrandId, true, { seed });
}

export function mountConsultantPanel(brandId) {
  if (!brandId) return unmountConsultantPanel();
  if (mountedBrandId === brandId) return;
  unmountConsultantPanel();
  mountedBrandId = brandId;

  const fab = document.createElement("button");
  fab.type = "button";
  fab.id = "consultant-fab";
  fab.className = "consultant-fab";
  fab.setAttribute("aria-label", t("cons.fabLabel"));
  fab.innerHTML = icon("chat", { size: 22 });
  fab.addEventListener("click", () => togglePanel(brandId, !isOpen));
  document.body.appendChild(fab);

  // A speech bubble beside the round button, shown once per account so
  // people learn the orange chat circle is an AI they can ask — then it
  // stays out of the way. Hidden while the panel is open or a tour is
  // running (css).
  if (!readFlag(HINT_SEEN_PREFIX, "consultant")) {
    const hint = document.createElement("button");
    hint.type = "button";
    hint.id = "consultant-fab-hint";
    hint.className = "consultant-fab-hint";
    hint.textContent = t("consultant.fabHint");
    hint.addEventListener("click", () => togglePanel(brandId, true));
    document.body.appendChild(hint);
    writeFlag(HINT_SEEN_PREFIX, "consultant");
  }

  const panel = document.createElement("div");
  panel.id = "consultant-panel";
  panel.className = "consultant-panel";
  panel.hidden = true;
  document.body.appendChild(panel);

  isOpen = false;
}

export function unmountConsultantPanel() {
  qs("#consultant-fab")?.remove();
  qs("#consultant-fab-hint")?.remove();
  qs("#consultant-panel")?.remove();
  mountedBrandId = null;
  isOpen = false;
}
