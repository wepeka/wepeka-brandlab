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

// The consultant is told (see js/ai.js's askBrandConsultant system prompt)
// to end a reply with one [[goto:KEY]] per screen it's pointing the user
// at. Pulling those out of the raw text turns "buka Content OS" from
// something you have to go find in the nav yourself into an actual button —
// same reason the answer here doesn't just say "check the calendar" without
// a way to click straight to it.
// Same idea for [[draft:FUNNEL|Title]] — a content piece the consultant
// just recommended becomes a one-click "Buatkan draft" button instead of
// something the user has to retype into Creator.
// And [[ask:Question]] — the follow-ups the consultant thinks this user
// would want next, so the starter chips aren't only a first-message thing:
// after every answer there's still something to tap instead of an empty box.
function parseNavDirectives(rawText) {
  const nav = [];
  const drafts = [];
  const asks = [];
  const cleanText = rawText
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
      if (clean && asks.length < 3 && !asks.includes(clean)) asks.push(clean.slice(0, 120));
      return "";
    })
    .replace(/\[\[draft:([a-z]+)\|([^\]\n]+)\]\]/gi, (_, funnel, title) => {
      const f = funnel.toUpperCase();
      const clean = title.trim();
      if (clean && drafts.length < 3 && !drafts.some((d) => d.title === clean)) {
        drafts.push({ funnel: (FUNNELS || []).includes(f) ? f : "TOFU", title: clean.slice(0, 140), contentId: null });
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, nav, drafts, asks };
}

// The model answers in light markdown (bold, italics, numbered/bulleted
// lists) even when asked not to — render that subset after escaping,
// instead of showing raw asterisks to the user. Anything else stays
// literal text.
function renderLightMarkdown(text) {
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
  return `<div class="consultant-msg consultant-msg-${h.role}" data-consultant-msg="${index}">${body}${navHTML}${draftsHTML}${asksHTML}</div>`;
}

// First-message nudges for someone who doesn't yet know what to ask —
// clicking one sends it as a real question.
const STARTER_PROMPT_KEYS = ["consultant.starter.performance", "consultant.starter.week", "consultant.starter.quiet", "consultant.starter.level"];

function panelHTML(brandId) {
  const brand = getBrand(brandId);
  const history = historyByBrand.get(brandId) || [];
  return `
    <div class="consultant-panel-head">
      <div class="flex items-center gap-8">
        ${icon("chat", { size: 15 })}
        <span>${t("consultant.title", { brand: escapeHtml(brand?.name || "") })}</span>
      </div>
      <button type="button" class="icon-btn" id="consultant-close" aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>
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

function renderPanel(brandId) {
  const panel = qs("#consultant-panel");
  if (!panel) return;
  panel.innerHTML = panelHTML(brandId);
  scrollToBottom();
  qs("#consultant-close", panel).addEventListener("click", () => togglePanel(brandId, false));
  const input = qs("#consultant-input", panel);
  const send = () => sendMessage(brandId, input.value.trim());
  qs("#consultant-send", panel).addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.focus();

  panel.querySelectorAll("[data-consultant-starter]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(brandId, btn.dataset.consultantStarter));
  });

  const history = historyByBrand.get(brandId) || [];
  panel.querySelectorAll("[data-consultant-draft]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [mi, di] = btn.dataset.consultantDraft.split(":").map(Number);
      const d = history[mi]?.drafts?.[di];
      if (!d || d.contentId) return;
      // Linked to the brand's active campaign so it counts there right away.
      const active = listCampaigns(brandId).find((c) => c.status !== "archived");
      const item = createContent(brandId, { title: d.title, funnel: d.funnel, campaignId: active?.id || "", idea: history[mi].question ? t("cons.draftIdea", { question: history[mi].question }) : "" });
      d.contentId = item.id;
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
  // 👍/👎 under every real answer (not the greeting, not error messages),
  // hidden again once rated so a re-render doesn't ask twice.
  history.forEach((h, i) => {
    if (h.role !== "assistant" || !h.question || h.rated) return;
    mountAiFeedback(panel.querySelector(`[data-consultant-msg="${i}"]`), {
      brandId,
      feature: "consultant",
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
  renderPanel(brandId);
  qs(`[data-consultant-msg="${history.length - 1}"]`)?.classList.add("is-new");
  const sendBtn = qs("#consultant-send");
  if (sendBtn) { sendBtn.classList.add("is-sent"); setTimeout(() => sendBtn.classList.remove("is-sent"), 400); }

  const messagesEl = qs("#consultant-messages");
  if (messagesEl) messagesEl.insertAdjacentHTML("beforeend", `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending is-new" id="consultant-pending"><span class="typing-dots" aria-label="${t("cons.typing")}"><i></i><i></i><i></i></span></div>`);
  scrollToBottom();

  try {
    const brand = getBrand(brandId);
    const snapshotText = buildSnapshot(brandId);
    const reply = await askBrandConsultant(ai, { brand, snapshotText, history: history.slice(0, -1), question: text });
    const { cleanText, nav, drafts, asks } = parseNavDirectives(reply.trim());
    history.push({ role: "assistant", text: cleanText, nav, drafts, asks, question: text });
  } catch (err) {
    history.push({ role: "assistant", text: err instanceof AiApiError ? t("cons.error", { message: err.message }) : t("cons.errorGeneric") });
  }
  historyByBrand.set(brandId, history);
  renderPanel(brandId);
  const newest = qs(`[data-consultant-msg="${history.length - 1}"]`);
  if (newest) {
    newest.classList.add("is-new");
    typewriterReveal(newest, { onTick: scrollToBottom });
  }
  scrollToBottom();
}

function togglePanel(brandId, open) {
  isOpen = open;
  const panel = qs("#consultant-panel");
  const fab = qs("#consultant-fab");
  if (panel) {
    panel.hidden = !open;
    // Restart the open animation each time (hidden → shown re-runs it).
    if (open) { panel.classList.remove("is-opening"); void panel.offsetWidth; panel.classList.add("is-opening"); }
  }
  if (fab) fab.classList.toggle("is-open", open);
  if (open) renderPanel(brandId);
}

const HINT_SEEN_PREFIX = "contentos:fab-hint-seen:";

// Opened from the topbar "?" popover (js/layout.js) — the FAB itself is
// still the everyday way in.
export function openConsultantPanel() {
  if (mountedBrandId) togglePanel(mountedBrandId, true);
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
