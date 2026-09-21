// The floating chat hub — three chats in one panel, switched from a tab bar
// along the bottom: AI Consultant (the default: grounded answers about this
// brand's data), Teman Brand (the warm companion that remembers moments) and
// Brainstorm (ask first, then options). The Home "Teman Brand" widget and the
// Brainstorm page still exist; the hub reuses the same threads and code
// (js/views/home.js renderCompanionPane, js/views/brainstorm.js compact).
//
// "Konsultasi AI" — a floating chat panel, reachable from any page inside
// a brand (mounted once into document.body from layout.js's wireShell, so
// it survives the #app innerHTML getting torn down on every in-brand
// navigation — same reason the topbar itself lives
// outside #app). Grounded in three things at once: this brand's own DNA,
// the marketing/branding frameworks every other AI feature here already
// leans on (js/ai.js's MARKETING_FRAMEWORKS_CONTEXT), and a live snapshot
// of this brand's actual tracked data — so "gimana performa konten gue
// bulan ini?" gets a real answer, not a generic one.
import { t } from "./i18n.js";
import { getBrand, getSettings, listContent, listCampaigns, listOverdueAndDueSoon, createContent, FUNNELS } from "./store.js";
import { campaignStages, activeStageIndex, readStage, campaignHeadline } from "./campaign-metrics.js";
import { nextActions } from "./next-action.js";
import { computeContentMetrics } from "./formulas.js";
import { brandDnaCompleteness } from "./brand-progress.js";
import { askBrandConsultant, hasAiKey, AiApiError, CONSULTANT_ROUTES } from "./ai.js";
import { pulseTextFor } from "./brand-pulse.js";
import { parseDirectives, renderLightMarkdown } from "./ai-directives.js";
import { icon } from "./icons.js";
import { qs, escapeHtml, formatPercent, toast } from "./dom.js";
import { mountAiFeedback } from "./ai-feedback.js";
import { readFlag, writeFlag } from "./seen-flags.js";

// brandId -> [{ role: "user"|"assistant", text }]. Session-only (resets on
// reload) — a full persisted chat log is a bigger feature than "ask a
// question and get a grounded answer," and out of scope for a first cut.
const historyByBrand = new Map();
let mountedBrandId = null;
let isOpen = false;

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


function messageHTML(h, index, isLast = false) {
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
  // Follow-ups only under the newest answer — older chips would re-ask
  // questions the conversation has already moved past.
  const asksHTML =
    isLast && h.role === "assistant" && h.asks?.length
      ? `<div class="consultant-followups"><p class="consultant-followups-label">${t("cons.followUp")}</p><div class="consultant-starters">${h.asks
          .map((q) => `<button type="button" class="consultant-starter" data-consultant-starter="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
          .join("")}</div></div>`
      : "";
  const body = h.role === "assistant" ? `<div class="consultant-md">${renderLightMarkdown(h.text)}</div>` : escapeHtml(h.text);
  // Thinking about ideas rather than facts? One tap moves the question to the
  // Brainstorm chat, sentence pre-filled.
  const handoffHTML = isLast && h.role === "assistant" && h.question
    ? `<div class="cp-handoff"><button type="button" class="consultant-starter" data-consultant-handoff="${escapeHtml(h.question)}">${icon("bulb", { size: 12 })}${t("chat.handoff.brainstorm")}</button></div>`
    : "";
  return `<div class="consultant-msg consultant-msg-${h.role}" data-consultant-msg="${index}">${body}${navHTML}${draftsHTML}${asksHTML}${handoffHTML}</div>`;
}

// First-message nudges for someone who doesn't yet know what to ask —
// clicking one sends it as a real question.
const STARTER_PROMPT_KEYS = ["consultant.starter.performance", "consultant.starter.week", "consultant.starter.quiet", "consultant.starter.level"];

// The Consultant chat itself (messages + composer). The frame around it —
// header, mode tabs — is shellHTML below.
function consultantPaneHTML(brandId) {
  const brand = getBrand(brandId);
  const history = historyByBrand.get(brandId) || [];
  return `
    <div class="consultant-panel-body" id="consultant-messages">
      ${
        history.length
          ? history.map((h, i) => messageHTML(h, i, i === history.length - 1)).join("")
          : `<div class="consultant-msg consultant-msg-assistant">${t("consultant.greeting", { brand: escapeHtml(brand?.name || t("cons.thisBrand")) })}</div>
             <div class="consultant-starters">${STARTER_PROMPT_KEYS.map((k) => t(k)).map((p) => `<button type="button" class="consultant-starter" data-consultant-starter="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}</div>`
      }
    </div>
    <div class="consultant-panel-input">
      <textarea id="consultant-input" placeholder="${t("consultant.placeholder")}" rows="1"></textarea>
      <button type="button" class="icon-btn" id="consultant-send" aria-label="${t("cons.send")}">${icon("send", { size: 15 })}</button>
    </div>
  `;
}

// ---- The three chats ----------------------------------------------------
const MODES = ["consultant", "companion", "brainstorm"];
const MODE_ICON = { consultant: "bot", companion: "heart", brainstorm: "bulb" };
let mode = "consultant";
let paneCleanup = null;
const brainstormThread = new Map(); // brandId -> open Brainstorm thread, kept while switching tabs

function shellHTML(brandId) {
  return `
    <div class="consultant-panel-head cp-head">
      <div class="cp-head-main">
        <span class="cp-head-icon">${icon(MODE_ICON[mode], { size: 16 })}</span>
        <div><b>${t(`chat.mode.${mode}`)}</b><small>${t(`chat.mode.${mode}.sub`)}</small></div>
      </div>
      <button type="button" class="icon-btn" id="consultant-close" aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>
    <div class="cp-pane" id="cp-pane" data-mode="${mode}"></div>
    <nav class="cp-tabs" role="tablist" aria-label="${t("chat.tabs.aria")}">
      ${MODES.map((m) => `<button type="button" role="tab" class="cp-tab ${m === mode ? "is-active" : ""}" data-cp-mode="${m}" data-mode="${m}" aria-selected="${m === mode}">${icon(MODE_ICON[m], { size: 16 })}<span>${t(`chat.mode.${m}`)}</span></button>`).join("")}
    </nav>`;
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

// Draws the frame (header + tabs) and mounts whichever chat is active.
function renderPanel(brandId, { seed = "" } = {}) {
  const panel = qs("#consultant-panel");
  if (!panel) return;
  paneCleanup?.();
  paneCleanup = null;
  panel.dataset.mode = mode;
  panel.innerHTML = shellHTML(brandId);
  qs("#consultant-close", panel).addEventListener("click", () => togglePanel(brandId, false));
  panel.querySelectorAll("[data-cp-mode]").forEach((btn) => btn.addEventListener("click", () => switchMode(brandId, btn.dataset.cpMode)));
  mountPane(brandId, { seed });
}

function switchMode(brandId, next, opts = {}) {
  if (!MODES.includes(next)) return;
  if (next === mode && !opts.seed) return;
  mode = next;
  renderPanel(brandId, opts);
}

// A failed dynamic import is remembered by the browser for that exact URL, so
// a second try goes through a different one before giving up.
async function loadView(path) {
  try {
    return await import(path);
  } catch {
    return import(`${path}?retry=${Date.now()}`);
  }
}

async function mountPane(brandId, { seed = "" } = {}) {
  const pane = qs("#cp-pane");
  if (!pane) return;
  const close = () => togglePanel(brandId, false);
  if (mode === "consultant") {
    renderConsultant(brandId);
    return;
  }
  const mine = mode;
  try {
    if (mode === "companion") {
      const { renderCompanionPane } = await loadView("./views/home.js");
      if (mine !== mode || !qs("#cp-pane")) return;
      paneCleanup = renderCompanionPane(pane, { brandId, onNavigate: close, onBrainstorm: (text) => switchMode(brandId, "brainstorm", { seed: text }) });
    } else {
      const { render } = await loadView("./views/brainstorm.js");
      if (mine !== mode || !qs("#cp-pane")) return;
      paneCleanup = render(pane, {
        brandId, compact: true, seed, threadId: brainstormThread.get(brandId) || null,
        onThread: (id) => (id ? brainstormThread.set(brandId, id) : brainstormThread.delete(brandId)), onNavigate: close,
      });
    }
  } catch (e) {
    console.error("Chat hub pane failed", e);
    pane.innerHTML = `<p class="companion-error" style="margin:16px;">${t("chat.paneFailed")}</p>`;
  }
}

// The Consultant chat: messages and composer inside #cp-pane.
function renderConsultant(brandId) {
  const pane = qs("#cp-pane");
  if (!pane || mode !== "consultant") return;
  pane.innerHTML = consultantPaneHTML(brandId);
  scrollToBottom();
  const input = qs("#consultant-input", pane);
  const send = () => sendMessage(brandId, input.value.trim());
  qs("#consultant-send", pane).addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.focus();

  pane.querySelectorAll("[data-consultant-starter]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(brandId, btn.dataset.consultantStarter));
  });
  // Hand a question over to the Brainstorm chat with the sentence pre-filled.
  pane.querySelectorAll("[data-consultant-handoff]").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(brandId, "brainstorm", { seed: btn.dataset.consultantHandoff }));
  });

  const history = historyByBrand.get(brandId) || [];
  pane.querySelectorAll("[data-consultant-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [mi, di] = btn.dataset.consultantDraft.split(":").map(Number);
      const d = history[mi]?.drafts?.[di];
      if (!d || d.contentId) return;
      // Linked to the brand's active campaign so it counts there right away.
      const active = listCampaigns(brandId).find((c) => c.status !== "archived");
      const item = createContent(brandId, { title: d.title, funnel: d.funnel, campaignId: active?.id || "", idea: history[mi].question ? t("cons.draftIdea", { question: history[mi].question }) : "" });
      d.contentId = item.id;
      toast(t("cons.draftSaved", { title: d.title }));
      renderConsultant(brandId);
    });
  });
  pane.querySelectorAll("[data-consultant-open-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/brand/${brandId}/content-os/creator/${btn.dataset.consultantOpenDraft}`;
      togglePanel(brandId, false);
    });
  });
  // 👍/👎 under every real answer (not the greeting, not error messages),
  // hidden again once rated so a re-render doesn't ask twice.
  history.forEach((h, i) => {
    if (h.role !== "assistant" || !h.question || h.rated) return;
    mountAiFeedback(pane.querySelector(`[data-consultant-msg="${i}"]`), {
      brandId,
      feature: "consultant",
      prompt: { question: h.question, history: history.slice(0, i - 1).map((x) => ({ role: x.role, text: x.text })) },
      output: h.text,
      onRated: (rating) => { h.rated = rating; },
    });
  });

  pane.querySelectorAll("[data-consultant-nav]").forEach((btn) => {
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
}

async function sendMessage(brandId, text) {
  if (!text) return;
  const settings = getSettings();
  const ai = settings.ai || { provider: "anthropic" };
  if (!hasAiKey(ai)) {
    location.hash = "#/settings/ai";
    return;
  }

  const history = historyByBrand.get(brandId) || [];
  history.push({ role: "user", text });
  historyByBrand.set(brandId, history);
  renderConsultant(brandId);
  qs(`[data-consultant-msg="${history.length - 1}"]`)?.classList.add("is-new");
  const sendBtn = qs("#consultant-send");
  if (sendBtn) { sendBtn.classList.add("is-sent"); setTimeout(() => sendBtn.classList.remove("is-sent"), 400); }

  const messagesEl = qs("#consultant-messages");
  if (messagesEl) messagesEl.insertAdjacentHTML("beforeend", `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending is-new" id="consultant-pending"><span class="typing-dots" aria-label="${t("cons.typing")}"><i></i><i></i><i></i></span></div>`);
  scrollToBottom();

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
    const brand = getBrand(brandId);
    const snapshotText = buildSnapshot(brandId);
    const pulseText = pulseTextFor(brand, { content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
    const reply = await askBrandConsultant(ai, { brand, snapshotText, pulseText, history: history.slice(0, -1), question: text, onText: streamInto });
    const { cleanText, nav, drafts, asks } = parseDirectives(reply.trim());
    history.push({ role: "assistant", text: cleanText, nav, drafts, asks, question: text });
  } catch (err) {
    history.push({ role: "assistant", text: err instanceof AiApiError ? t("cons.error", { message: err.message }) : t("cons.errorGeneric") });
  }
  historyByBrand.set(brandId, history);
  if (mode !== "consultant") return; // the owner switched tabs mid-answer: it is waiting when they come back
  renderConsultant(brandId);
  const newest = qs(`[data-consultant-msg="${history.length - 1}"]`);
  if (newest) {
    newest.classList.add("is-new");
    // Already visible if it streamed in — only retype a reply that arrived whole.
    if (!streamed) typewriterReveal(newest, { onTick: scrollToBottom });
  }
  scrollToBottom();
}

function togglePanel(brandId, open, { openMode = null, seed = "" } = {}) {
  isOpen = open;
  const panel = qs("#consultant-panel");
  const fab = qs("#consultant-fab");
  if (panel) {
    panel.hidden = !open;
    // Restart the open animation each time (hidden → shown re-runs it).
    if (open) { panel.classList.remove("is-opening"); void panel.offsetWidth; panel.classList.add("is-opening"); }
  }
  if (fab) fab.classList.toggle("is-open", open);
  if (open) {
    // The round chat button always opens the AI Consultant; the other two
    // chats are one tap away on the tab bar (or opened on purpose by a caller).
    mode = openMode && MODES.includes(openMode) ? openMode : "consultant";
    renderPanel(brandId, { seed });
  } else {
    paneCleanup?.();
    paneCleanup = null;
  }
}

const HINT_SEEN_PREFIX = "contentos:fab-hint-seen:";

// Opened from the topbar "?" popover (js/layout.js) — the FAB itself is
// still the everyday way in.
export function openConsultantPanel({ mode: openMode = null, seed = "" } = {}) {
  if (mountedBrandId) togglePanel(mountedBrandId, true, { openMode, seed });
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
