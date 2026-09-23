// Brainstorm partner (R4) — a saved chat where an idea gets THOUGHT
// THROUGH before it becomes content. Two speeds, both the owner's choice:
//
//   • Discuss (default): the AI asks what it needs, offers directions
//     with trade-offs, and only marks an idea [[idea:…]] once the
//     conversation has landed on one — nothing arrives ready-made.
//   • "Ide sekarang": the explicit shortcut that skips the discussion and
//     hands over three concrete ideas at once.
//
// Threads live in the brainstorms/ collection (js/store.js), one doc each,
// scoped to the whole brand, one campaign (+ stage), or one piece of
// content — the scope rides in through js/nav-context.js from wherever the
// owner came from (campaign detail, Companion, Tools). Ideas the owner
// keeps land on campaign.ideas / brand.ideas, and any of them can become a
// draft in Creator with one click. Route: #/brand/:id/brainstorm[/:threadId].
import { backLinkHTML } from "../back-link.js";
import {
  getBrand, getGoal, listGoals, listCampaigns, getCampaign, formatEventDate, phaseNameLabel, updateCampaign, listContent, getContent, updateContent, createContent, getSettings, onChange,
  listBrainstorms, getBrainstorm, createBrainstorm, appendBrainstormMessage, updateBrainstormMessage, updateBrainstorm, deleteBrainstorm,
  addBrandIdea, removeBrandIdea,
  listSeries, getSeries, findSeriesByNameInText,
} from "../store.js";
import { openSeriesModal } from "./series.js";
import { campaignStages, activeStageIndex } from "../campaign-metrics.js";
import { chatBrainstorm, hasAiKey, AiApiError } from "../ai.js";
import { eventCampaignFor, openEventPhases, addEventMilestone } from "../goal-actions.js";
import { aiLimitReached } from "../ai-usage.js";
import { parseDirectives, renderLightMarkdown } from "../ai-directives.js";
import { computeSignals, pulseTextFor } from "../brand-pulse.js";
import { consumeNavContext, go } from "../nav-context.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { wireMic } from "../voice-input.js";
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml as esc, toast, formatDate, openMenu, closeMenu } from "../dom.js";
import { confirmDialog } from "../modals.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { t } from "../i18n.js";

const HISTORY_FOR_MODEL = 12;
const TITLE_MAX = 60;

const TOUR_STEPS = [
  { selector: ".bs-scope", title: t("bs.eyebrow"), body: t("bs.tour.scope") },
  { selector: ".bs-composer", title: t("bs.send"), body: t("bs.tour.chat") },
  { selector: "#bs-ideas-now", title: t("bs.ideasNow"), body: t("bs.tour.ideasNow") },
  { selector: ".bs-ideas", title: t("bs.ideas.title"), body: t("bs.tour.ideas") },
];

// `compact` mounts just the chat (no threads rail, no saved-ideas column) inside
// the floating chat panel (js/consultant-panel.js): it never touches the URL or
// the page's navigation context, and hands the open thread back via onThread.
export function render(root, { brandId, threadId = null, compact = false, seed = "", onThread = null, onNavigate = null }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const state = { threadId, scope: {}, draft: seed || "", pending: false, error: "", notice: "", railOpen: false, compact, onThread, onNavigate };
  const applyNavContext = () => {
    const ctx = consumeNavContext();
    if (!ctx) return;
    // Fresh context from another screen: start a conversation about it
    // unless we were sent to a specific existing thread.
    if (!threadId) {
      state.threadId = null;
      state.scope = { campaignId: ctx.campaignId || null, stageId: ctx.stageId || null, contentId: ctx.contentId || null, goalId: ctx.goalId || null };
    }
    if (ctx.seed) state.draft = ctx.seed;
  };
  if (!compact) applyNavContext();
  if (state.threadId) {
    const th = getBrainstorm(state.threadId);
    if (th) state.scope = { campaignId: th.campaignId || null, stageId: th.stageId || null, contentId: th.contentId || null, goalId: th.goalId || null, seriesId: th.seriesId || null };
    else state.threadId = null;
  }

  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  const onCtx = () => { applyNavContext(); refresh(); };
  if (!compact) document.addEventListener("nav:context", onCtx);
  const off = onChange(refresh);
  return () => {
    if (!compact) document.removeEventListener("nav:context", onCtx);
    off?.();
  };
}

// The full page keeps its URL in step with the open thread; the compact chat
// lives in a panel and must leave the address bar alone.
function syncUrl(state, url) {
  if (!state.compact) history.replaceState(null, "", url);
}

// ---- Scope ----------------------------------------------------------------

function scopeInfo(brandId, scope) {
  const goal = scope.goalId ? getGoal(brandId, scope.goalId) : null;
  // A goal's conversation reads its Event campaign too, so the countdown and
  // phases ride along in the prompt.
  const campaign = scope.campaignId ? getCampaign(scope.campaignId) : goal?.installed?.campaigns?.event?.id ? getCampaign(goal.installed.campaigns.event.id) : null;
  const content = scope.contentId ? getContent(scope.contentId) : null;
  // A recurring Content Series ("Bedah Brand" etc.) — set either by picking
  // it in the scope menu, or auto-detected from the owner's own message
  // (see detectSeriesScope below) when they just name the series and topic
  // ("Buat Bedah Brand tentang Nike") without opening the menu first.
  const series = scope.seriesId ? getSeries(scope.seriesId) : null;
  let stage = null;
  if (campaign) {
    const stages = campaignStages(campaign);
    stage = (scope.stageId && stages.find((s) => s.id === scope.stageId)) || stages[activeStageIndex(campaign, stages, listContent(brandId))] || null;
  }
  let label;
  if (content) label = t("bs.scope.content", { title: content.title || t("beginner.untitled") });
  else if (series) label = t("series.pick", { name: series.name });
  else if (goal) label = t("roadmap.bs.scope", { name: goal.name || t("roadmap.defaultName") });
  else if (campaign) label = t("bs.scope.campaign", { name: campaign.name }) + (stage ? t("bs.scope.stage", { stage: stage.name }) : "");
  else label = t("bs.scope.brand");
  const stageText = stage ? `${stage.kind === "level" ? "Level" : "Phase"} "${stage.name}"${stage.dateLabel ? ` (${stage.dateLabel})` : ""}${stage.description ? ` — ${stage.description}` : ""}` : "";
  return { campaign, content, stage, series, label, stageText, goal, brandId };
}

// "Buat Bedah Brand tentang Nike" — the owner never has to open the scope
// menu and pick "Bedah Brand" first: if the current scope is still the
// brand-wide default (no campaign/goal/content/series already chosen) and
// their message names an existing series, that series becomes this
// (brand-new) thread's scope automatically, same as if they'd picked it.
function detectSeriesScope(brandId, scope, text) {
  if (scope.seriesId || scope.campaignId || scope.goalId || scope.contentId) return null;
  return findSeriesByNameInText(brandId, text);
}

// ---- Threads rail -----------------------------------------------------------

function threadRowHTML(th, active) {
  const scopeTag = th.contentId ? t("ai.route.creator") : th.campaignId ? t("ai.route.campaigns") : t("bs.scope.brand");
  return `
    <button type="button" class="bs-thread-item ${active ? "is-active" : ""}" data-bs-thread="${th.id}">
      <span class="bs-thread-title">${esc(th.title || t("bs.threads.untitled"))}</span>
      <span class="bs-thread-meta"><span class="tag">${esc(scopeTag)}</span>${esc(formatDate(new Date(th.updatedAt || th.createdAt || Date.now()).toISOString().slice(0, 10)))}</span>
    </button>`;
}

function railHTML(brandId, state) {
  const threads = listBrainstorms(brandId).filter((th) => th.mode !== "companion");
  const list = threads.length ? threads.map((th) => threadRowHTML(th, th.id === state.threadId)).join("") : `<p class="text-faint" style="font-size:12px;margin:6px 0;">${t("bs.threads.empty")}</p>`;
  return `
    <details class="bs-threads" ${state.railOpen ? "open" : ""}>
      <summary class="bs-threads-head">
        <span class="bs-threads-title">${icon("chat", { size: 13 })}${t("bs.threads.title")}${threads.length ? ` <span class="text-faint">(${threads.length})</span>` : ""}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="bs-new" ${!state.threadId && !currentMessages(state).length ? "disabled" : ""}>${icon("plus", { size: 12 })}${t("bs.threads.new")}</button>
      </summary>
      <div class="bs-thread-list">${list}</div>
    </details>`;
}

// ---- Messages ----------------------------------------------------------------

const currentMessages = (state) => (state.threadId ? getBrainstorm(state.threadId)?.messages || [] : []);

function starterChips(brandId, brand, info) {
  const chips = [];
  const signals = computeSignals({ brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
  const viral = signals.find((s) => s.kind === "viral");
  const jump = signals.find((s) => s.kind === "follower-jump");
  const down = signals.find((s) => s.kind === "sales-down");
  if (viral) {
    const c = listContent(brandId).find((x) => x.id === viral.refs?.contentId);
    chips.push(t("bs.starter.viral", { title: c?.title || t("pulse.untitledContent") }));
  }
  if (jump) chips.push(t("bs.starter.followerJump", { platform: jump.refs?.platform || "" }));
  if (down) chips.push(t("bs.starter.salesDown"));
  if (info.goal) return [t("roadmap.bs.starter1"), t("roadmap.bs.starter2"), t("roadmap.bs.starter3")];
  if (!info.campaign && !info.content) chips.push(t("bs.starter.campaign"));
  chips.push(t("bs.starter.content"), t("bs.starter.stuck"));
  return chips.slice(0, 4);
}

// A real-world step for an event ("find 6 alumni") — it goes to a milestone of
// the Event campaign, in the phase the owner picks, not to a content draft.
function taskCardHTML(task, i, msgId, brandId) {
  const camp = task.campaignId ? getCampaign(task.campaignId) : null;
  const phases = camp ? openEventPhases(camp) : [];
  const want = (task.phase || "").toLowerCase();
  const pick = phases.find((p) => p.name.toLowerCase() === want)?.id || phases[0]?.id || "";
  const target = task.target ? t("bs.task.target", { n: task.target, unit: task.unit || "" }).trim() : t("bs.task.check");
  let actions;
  if (task.added) actions = `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.task.added", { phase: esc(task.phaseName || "") })}</span><a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/campaigns/${esc(task.campaignId || "")}">${t("bs.task.open")}</a>`;
  else if (!phases.length) actions = `<span class="text-faint" style="font-size:12px;">${t("bs.task.noPhase")}</span>`;
  else actions = `<select class="input bs-task-phase" data-bs-task-phase="${msgId}:${i}" aria-label="${t("bs.task.phase")}">${phases.map((p) => `<option value="${esc(p.id)}" ${p.id === pick ? "selected" : ""}>${esc(phaseNameLabel(p.name))} · ${esc(formatEventDate(p.dateFrom))}–${esc(formatEventDate(p.dateTo))}</option>`).join("")}</select>
      <button type="button" class="btn btn-primary btn-sm" data-bs-task-add="${msgId}:${i}">${icon("check", { size: 12 })}${t("bs.task.add")}</button>
      ${task.saved ? `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.idea.saved")}</span>` : `<button type="button" class="btn btn-secondary btn-sm" data-bs-task-save="${msgId}:${i}">${icon("bookmark", { size: 12 })}${t("bs.idea.save")}</button>`}`;
  return `
    <div class="bs-card bs-opt bs-task">
      <div class="bs-task-tag">${icon("target", { size: 11 })}${t("bs.task.tag")}</div>
      <div class="bs-opt-title">${esc(task.title)}</div>
      ${task.why ? `<div class="bs-opt-why">${esc(task.why)}</div>` : ""}
      <div class="bs-task-target">${esc(target)}</div>
      <div class="bs-card-actions">${actions}</div>
    </div>`;
}

function ideaCardHTML(idea, i, msgId, info) {
  // "Pakai ini" turns the option into a draft content item (or adds it to the
  // content being edited); "Simpan" keeps it in the saved-ideas list for later.
  let use;
  if (idea.contentId) use = `<a class="btn btn-primary btn-sm" href="#/brand/__BRAND__/content/creator/${esc(idea.contentId)}">${icon("check", { size: 12 })}${t("bs.idea.openDraft")}</a>`;
  else if (idea.usedHere) use = `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.idea.usedHere")}</span>`;
  else if (info.content) use = `<button type="button" class="btn btn-primary btn-sm" data-bs-idea-use="${msgId}:${i}">${icon("check", { size: 12 })}${t("bs.idea.useHere")}</button>`;
  else use = `<button type="button" class="btn btn-primary btn-sm" data-bs-idea-draft="${msgId}:${i}">${icon("check", { size: 12 })}${t("bs.idea.use")}</button><button type="button" class="btn btn-secondary btn-sm" data-bs-idea-script="${msgId}:${i}" title="${esc(t("bs.idea.scriptTitle"))}">${icon("bot", { size: 12 })}${t("bs.idea.script")}</button>`;
  const save = idea.saved
    ? `<button type="button" class="bs-done bs-see-saved" data-bs-open-saved>${icon("check", { size: 12 })} ${t("bs.idea.savedSee")}</button>`
    : `<button type="button" class="btn btn-secondary btn-sm" data-bs-idea-save="${msgId}:${i}">${icon("bookmark", { size: 12 })}${t("bs.idea.save")}</button>`;
  return `
    <div class="bs-card bs-opt">
      <div class="bs-opt-title">${esc(idea.title)}</div>
      ${idea.why ? `<div class="bs-opt-why">${esc(idea.why)}</div>` : ""}
      <div class="bs-card-actions">${use}${save}</div>
    </div>`;
}

function draftCardHTML(d, i, msgId) {
  return `
    <div class="bs-card">
      <div class="bs-card-actions">
        ${d.contentId
          ? `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content/creator/${esc(d.contentId)}">${icon("check", { size: 12 })}${t("bs.draft.created", { title: esc(d.title) })}</a>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-bs-draft="${msgId}:${i}"><span class="tag tag-${(d.funnel || "tofu").toLowerCase()}">${esc(d.funnel)}</span>${t("bs.draft.create", { title: esc(d.title) })}</button>`}
      </div>
    </div>`;
}

function messageHTML(m, { isLast, info }) {
  if (m.role === "user") return `<div class="consultant-msg consultant-msg-user"><span class="bs-user-text">${esc(m.text)}</span></div>`;
  const b = m.blocks || {};
  const inner = [
    m.text ? `<div class="consultant-md">${renderLightMarkdown(m.text)}</div>` : "",
    (b.tasks || []).map((task, i) => taskCardHTML(task, i, m.id, info.brandId)).join(""),
    (b.ideas || []).map((idea, i) => ideaCardHTML(idea, i, m.id, info)).join(""),
    (b.drafts || []).map((d, i) => draftCardHTML(d, i, m.id)).join(""),
    isLast && ((b.ideas || []).length || (b.tasks || []).length)
      ? `<div class="bs-reply-actions"><button type="button" class="btn btn-ghost btn-sm" data-bs-more>${icon("refresh", { size: 12 })}${t("bs.opt.more")}</button>${(b.ideas || []).filter((x) => !x.saved).length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-bs-save-all="${m.id}">${icon("bookmark", { size: 12 })}${t("bs.opt.saveAll")}</button>` : ""}</div>`
      : "",
    isLast && b.asks?.length ? `<div class="bs-pick-label">${t("bs.pick.hint")}</div><div class="consultant-starters bs-picks">${b.asks.map((q) => `<button type="button" class="consultant-starter bs-pick" data-bs-starter="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : "",
    isLast && !(b.ideas || []).length && !(b.drafts || []).length && !(b.tasks || []).length
      ? `<div class="bs-fork"><button type="button" class="btn btn-primary btn-sm" data-bs-go-ideas>${icon("sparkle", { size: 13 })}${t("bs.go.ideas")}</button><button type="button" class="btn btn-secondary btn-sm" data-bs-answer>${icon("chat", { size: 13 })}${t("bs.go.answer")}</button></div>`
      : "",
    `<div class="bs-feedback-slot" data-bs-feedback="${m.id}"></div>`,
  ].join("");
  return `<div class="consultant-msg consultant-msg-assistant" data-bs-msg="${m.id}">${inner}</div>`;
}

function chatHTML(brandId, brand, state, info) {
  const msgs = currentMessages(state);
  const savedCount = savedIdeasList(brandId, state, info).items.length;
  const quotaOut = aiLimitReached();
  const busy = state.pending;
  let body;
  if (!msgs.length) {
    body = `
      <div class="bs-how">
        <div class="bs-how-title">${t("bs.how.title")}</div>
        <ol class="bs-how-steps"><li>${t("bs.how.1")}</li><li>${t("bs.how.2")}</li><li>${t("bs.how.3")}</li></ol>
      </div>
      <div class="consultant-msg consultant-msg-assistant">${esc(t("bs.intro"))}</div>
      <div class="consultant-starters bs-picks">${starterChips(brandId, brand, info).map((q) => `<button type="button" class="consultant-starter bs-pick" data-bs-starter="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  } else {
    body = msgs.map((m, i) => messageHTML(m, { isLast: i === msgs.length - 1, info })).join("");
  }
  if (state.notice) body += `<div class="consultant-msg consultant-msg-assistant">${esc(state.notice)}</div>`;
  if (busy) body += `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending"><span class="typing-dots" aria-label="${t("bs.typing")}"><i></i><i></i><i></i></span></div>`;

  return `
    <section class="card glass-card bs-chat">
      <div class="bs-scope">
        <span class="bs-scope-chip">${icon(info.content ? "edit" : info.series ? "sparkle" : info.campaign ? "bulb" : "target", { size: 12 })}${esc(info.label)}</span>
        <button type="button" class="link" id="bs-scope-change" style="font-size:12px;">${t("bs.scope.change")}</button>
        ${
          !state.compact && !info.series
            ? `<button type="button" class="link" id="bs-save-series" style="font-size:12px;" title="${esc(t("series.saveFromChat.hint"))}">${t("series.saveFromChat")}</button>`
            : ""
        }
        <span style="flex:1;"></span>
        ${state.compact
          ? `<button type="button" class="icon-btn" id="bs-new" aria-label="${t("bs.threads.new")}" title="${t("bs.threads.new")}" ${!state.threadId && !currentMessages(state).length ? "disabled" : ""}>${icon("plus", { size: 14 })}</button><a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/brainstorm" data-bs-full title="${esc(t("bs.saved.open", { n: savedCount }))}">${icon("bookmark", { size: 12 })}${savedCount}</a>`
          : `<button type="button" class="btn btn-secondary btn-sm" id="bs-open-saved" title="${esc(t("bs.saved.openTitle"))}">${icon("bookmark", { size: 12 })}${t("bs.saved.open", { n: savedCount })}</button>`}
        ${state.threadId ? `<button type="button" class="icon-btn" id="bs-thread-menu" aria-label="${t("common.more")}">${icon("dots", { size: 14 })}</button>` : ""}
      </div>
      <div class="bs-messages" id="bs-messages">${body.replaceAll("__BRAND__", brandId)}</div>
      ${state.error ? `<p class="companion-error">${esc(state.error)}</p>` : ""}
      ${quotaOut ? `<p class="companion-error">${t("bs.quotaReached")}</p>` : ""}
      <div class="bs-composer">
        <textarea id="bs-input" class="bs-input" rows="1" placeholder="${esc(t("bs.placeholder"))}" ${busy || quotaOut ? "disabled" : ""}>${esc(state.draft || "")}</textarea>
        <button type="button" class="chip-icon-btn" id="bs-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}" ${busy || quotaOut ? "disabled" : ""}>${icon("mic", { size: 15 })}</button>
        <button type="button" class="btn btn-primary btn-sm" id="bs-send" ${busy || quotaOut ? "disabled" : ""}>${icon("send", { size: 13 })}${t("bs.send")}</button>
      </div>
      <div class="bs-composer-foot">
        <span class="bs-composer-hint">${t("bs.composer.hint")}</span><button type="button" class="btn btn-ghost btn-sm" id="bs-ideas-now" title="${esc(t("bs.ideasNow.title"))}" ${busy || quotaOut ? "disabled" : ""}>${icon("sparkle", { size: 12 })}${t("bs.ideasNow")}</button>
      </div>
    </section>`;
}

// ---- Saved ideas panel ------------------------------------------------------

function savedIdeasList(brandId, state, info) {
  if (info.campaign) return { sub: t("bs.ideas.sub.campaign"), items: (info.campaign.ideas || []).map((i) => ({ ...i, where: "campaign" })) };
  const brand = getBrand(brandId);
  return { sub: t("bs.ideas.sub.brand"), items: (brand?.ideas || []).map((i) => ({ ...i, where: "brand" })) };
}

function ideasPanelHTML(brandId, state, info) {
  const { sub, items } = savedIdeasList(brandId, state, info);
  const rows = [...items].reverse().map((i) => `
    <div class="bs-saved-idea" data-bs-saved="${i.id}">
      <div class="bs-saved-text"><b>${esc(i.text)}</b>${i.description ? `<span class="text-muted"> — ${esc(i.description)}</span>` : ""}</div>
      <div class="bs-card-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-bs-saved-draft="${i.id}">${icon("edit", { size: 12 })}${t("bs.idea.draft")}</button>
        <button type="button" class="chip-icon-btn" data-bs-saved-delete="${i.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
      </div>
    </div>`).join("");
  return `
    <aside class="card glass-card bs-ideas">
      <div class="bs-ideas-head">
        <h2>${icon("bookmark", { size: 14 })}${t("bs.ideas.title")}</h2>
        <p class="text-faint" style="font-size:11.5px;margin:2px 0 0;">${esc(sub)}</p>
      </div>
      ${rows || `<p class="text-faint" style="font-size:12px;margin:8px 0 0;">${t("bs.ideas.empty")}</p>`}
    </aside>`;
}

// ---- Paint + wire ----------------------------------------------------------------

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const info = scopeInfo(brandId, state.scope);
  if (state.compact) {
    root.innerHTML = `<div class="bs-compact">${chatHTML(brandId, brand, state, info)}</div>`;
    wire(root, { brandId, brand, state, info, refresh });
    return;
  }
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}/campaigns`, t("nav.campaigns"))} · ${t("bs.eyebrow")}${helpButtonHTML("brainstorm")}${guideVideoButtonHTML("brainstorm")}</div>
        <h1>${esc(brand.name)}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${t("bs.sub")}</p>
      </div>
    </div>
    <div class="bs-layout">
      ${railHTML(brandId, state)}
      ${chatHTML(brandId, brand, state, info)}
      ${ideasPanelHTML(brandId, state, info)}
    </div>
  `;
  wireHelpButtons(root);
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
  wire(root, { brandId, brand, state, info, refresh });
}

function wire(root, { brandId, brand, state, info, refresh }) {
  const messagesEl = qs("#bs-messages", root);
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  const input = qs("#bs-input", root);
  // Measured after layout, and only when there is text: right after a repaint
  // (or inside the floating panel) the box can be laid out at zero width, which
  // used to leave an empty composer 160px tall.
  const autosize = () => { if (!input) return; input.style.height = "auto"; if (input.value) input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  autosize();
  setTimeout(autosize, 60);
  input?.addEventListener("input", () => { state.draft = input.value; autosize(); });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  const mic = qs("#bs-mic", root);
  if (mic && input) wireMic(mic, input);

  // 👍/👎 under the newest assistant reply only (mountAiFeedback appends DOM,
  // so it's done after innerHTML, not inside the template).
  const msgs = currentMessages(state);
  const last = msgs[msgs.length - 1];
  if (last?.role === "assistant" && !last.rated) {
    const slot = qs(`[data-bs-feedback="${last.id}"]`, root);
    const prev = msgs[msgs.length - 2];
    if (slot) mountAiFeedback(slot, { brandId, feature: "brainstorm", prompt: prev?.text || "", output: last.text, onRated: () => updateBrainstormMessage(state.threadId, last.id, { rated: true }) });
  }

  const ensureThread = (firstText) => {
    if (state.threadId && getBrainstorm(state.threadId)) return getBrainstorm(state.threadId);
    // Brand-new thread, still brand-wide scope: check if the owner just
    // named an existing series in their first message ("Buat Bedah Brand
    // tentang Nike") instead of picking it from the scope menu.
    const detected = detectSeriesScope(brandId, state.scope, firstText);
    if (detected) {
      state.scope = { ...state.scope, seriesId: detected.id };
      state.notice = t("series.autoDetected", { name: detected.name });
    }
    const th = createBrainstorm(brandId, { mode: "chat", title: firstText.slice(0, TITLE_MAX), campaignId: state.scope.goalId ? null : state.scope.campaignId || null, stageId: state.scope.stageId || null, contentId: state.scope.contentId || null, goalId: state.scope.goalId || null, seriesId: state.scope.seriesId || null });
    state.threadId = th.id;
    state.onThread?.(th.id);
    // Keep the URL honest without a hashchange (which would re-render mid-call).
    syncUrl(state, `#/brand/${brandId}/brainstorm/${th.id}`);
    return th;
  };

  // The reply shows up word by word: the typing bubble becomes the reply.
  // Half-written [[…]] lines are hidden until they close, so the owner never
  // sees raw directive syntax flash by.
  let streamTimer = 0;
  let streamRaw = "";
  const streamInto = (raw) => {
    streamRaw = raw;
    if (streamTimer) return;
    // A plain timer (not requestAnimationFrame): frames stop firing in a
    // background tab, and the reply should keep filling in regardless.
    streamTimer = setTimeout(() => {
      streamTimer = 0;
      const box = qs("#bs-messages", root);
      const bubble = box?.querySelector(".consultant-msg-pending");
      if (!bubble) return;
      let text = parseDirectives(streamRaw).cleanText;
      const open = text.lastIndexOf("[[");
      if (open !== -1 && !text.slice(open).includes("]]")) text = text.slice(0, open);
      text = text.replace(/\[$/, "").trim();
      if (!text) return;
      bubble.innerHTML = `<div class="consultant-md">${renderLightMarkdown(text)}</div>`;
      box.scrollTop = box.scrollHeight;
    }, 40);
  };

  const send = async (textArg, mode = "chat") => {
    const text = (textArg ?? input?.value ?? "").trim();
    if (!text || state.pending) return;
    state.pending = true;
    state.error = "";
    state.notice = "";
    state.draft = "";
    refresh();
    const th = ensureThread(text);
    // Read fresh, not the outer `info` closed over at the last paint() —
    // ensureThread() may have just auto-detected and set state.scope.seriesId
    // for this very message, and this async call outlives that paint cycle.
    const activeInfo = scopeInfo(brandId, state.scope);
    appendBrainstormMessage(th.id, { role: "user", text });
    try {
      const ai = getSettings().ai || {};
      if (!hasAiKey(ai)) { state.notice = t("bs.noKey"); return; }
      const all = getBrainstorm(th.id)?.messages || [];
      const history = all.slice(0, -1).filter((m) => m.text).slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, text: m.text }));
      // Everything already put in front of the owner counts as "don't repeat".
      const shown = all.flatMap((m) => (m.blocks?.ideas || []).map((i) => i.title));
      const savedIdeas = [...new Set([...shown, ...(getBrainstorm(th.id)?.ideas || []).map((i) => i.text), ...savedIdeasList(brandId, state, info).items.map((i) => i.text)])];
      const freshBrand = getBrand(brandId);
      const campaigns = listCampaigns(brandId);
      const eventCampaign = eventCampaignFor(brandId, { campaignId: state.scope.campaignId, goalId: state.scope.goalId });
      const raw = await chatBrainstorm(ai, {
        brand: freshBrand,
        campaigns,
        pulseText: pulseTextFor(freshBrand, { content: listContent(brandId), campaigns, settings: getSettings() }),
        campaign: activeInfo.campaign,
        stageText: activeInfo.stageText,
        content: activeInfo.content,
        series: activeInfo.series,
        goalId: state.scope.goalId || null,
        eventCampaign,
        savedIdeas,
        history,
        message: text,
        mode,
        turns: all.filter((m) => m.role === "user").length,
        onText: streamInto,
      });
      const { cleanText, ideas, drafts, asks, tasks } = parseDirectives(raw.trim());
      // A step can only be filed under an event; without one it is still worth
      // keeping, so it turns into an ordinary idea.
      const filed = eventCampaign ? tasks.map((x) => ({ ...x, campaignId: eventCampaign.id })) : [];
      const asIdeas = eventCampaign ? [] : tasks.map((x) => ({ title: x.title, why: x.why }));
      appendBrainstormMessage(th.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas: [...ideas, ...asIdeas], drafts, asks, tasks: filed } });
    } catch (e) {
      state.error = e instanceof AiApiError ? e.message : t("bs.failed");
    } finally {
      state.pending = false;
      refresh();
    }
  };

  qs("#bs-send", root)?.addEventListener("click", () => send());
  qs("#bs-ideas-now", root)?.addEventListener("click", () => send(input?.value.trim() || t("bs.ideasNow.message"), "ideas"));
  qsa("[data-bs-more]", root).forEach((btn) => btn.addEventListener("click", () => send(t("bs.opt.moreMsg"), "ideas")));
  // The fork under every question: skip the chat and get ideas now, or answer.
  qsa("[data-bs-go-ideas]", root).forEach((btn) => btn.addEventListener("click", () => send(t("bs.ideasNow.message"), "ideas")));
  qsa("[data-bs-answer]", root).forEach((btn) => btn.addEventListener("click", () => {
    const box = qs("#bs-input", root);
    if (!box) return;
    box.placeholder = t("bs.answer.ph");
    box.focus();
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  // Jump to (and briefly light up) the saved-ideas panel — it sits below the
  // chat on a phone, so "where did it go?" needs a one-tap answer.
  const showSaved = () => {
    const el = qs(".bs-ideas", root);
    if (!el) {
      // Compact chat has no saved-ideas column: open the full page instead.
      if (state.compact) { location.hash = `#/brand/${brandId}/brainstorm`; state.onNavigate?.(); }
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash");
  };
  // Any link out of the compact chat (an open draft, a campaign) should also
  // tuck the floating panel away so the destination is visible.
  if (state.compact) root.addEventListener("click", (e) => { if (e.target.closest('a[href^="#/"]')) state.onNavigate?.(); });
  qsa("[data-bs-full]", root).forEach((a) => a.addEventListener("click", () => state.onNavigate?.()));
  qsa("#bs-open-saved, [data-bs-open-saved]", root).forEach((btn) => btn.addEventListener("click", showSaved));
  if (state.flash) { state.flash = false; const el = qs(".bs-ideas", root); if (el) { el.classList.add("is-flash"); } }
  qsa("[data-bs-starter]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const q = btn.dataset.bsStarter;
      // Open-ended starters ("…") go into the box to be finished; complete
      // questions send right away.
      if (q.endsWith("…")) { state.draft = q + " "; refresh(); qs("#bs-input", root)?.focus(); }
      else send(q);
    })
  );

  // Threads rail
  qsa("[data-bs-thread]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const th = getBrainstorm(btn.dataset.bsThread);
      if (!th) return;
      state.threadId = th.id;
      state.scope = { campaignId: th.campaignId || null, stageId: th.stageId || null, contentId: th.contentId || null, goalId: th.goalId || null, seriesId: th.seriesId || null };
      state.error = ""; state.notice = "";
      syncUrl(state, `#/brand/${brandId}/brainstorm/${th.id}`);
      refresh();
    })
  );
  qs("#bs-new", root)?.addEventListener("click", (e) => {
    e.preventDefault();
    state.threadId = null;
    state.onThread?.(null);
    state.error = ""; state.notice = "";
    syncUrl(state, `#/brand/${brandId}/brainstorm`);
    refresh();
  });
  qs(".bs-threads", root)?.addEventListener("toggle", (e) => { state.railOpen = e.target.open; });

  // Scope picker: brand-wide or one of the active campaigns. Changing scope
  // mid-conversation starts a new thread — the old one keeps its context.
  qs("#bs-scope-change", root)?.addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: r.bottom + 6, left: r.left });
    if (!menu) return;
    const options = [
      { id: "", label: t("bs.scope.brand") },
      ...listSeries(brandId).map((s) => ({ id: `series:${s.id}`, label: t("series.pick", { name: s.name }) })),
      ...listGoals(brandId).filter((g) => g.status !== "completed").map((g) => ({ id: `goal:${g.id}`, label: t("roadmap.bs.scope", { name: g.name || t("roadmap.defaultName") }) })),
      ...listCampaigns(brandId).filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: t("bs.scope.campaign", { name: c.name }) })),
    ];
    const currentScopeId = state.scope.seriesId ? `series:${state.scope.seriesId}` : state.scope.goalId ? `goal:${state.scope.goalId}` : state.scope.campaignId || "";
    menu.innerHTML = `<div class="text-faint" style="font-size:11px;padding:6px 10px 4px;">${t("bs.scope.pickTitle")}</div>` + options.map((o) => `<button type="button" data-scope="${o.id}">${o.id === currentScopeId && !state.scope.contentId ? icon("check", { size: 12 }) : ""}${esc(o.label)}</button>`).join("");
    menu.querySelectorAll("[data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        closeMenu();
        const pick = b.dataset.scope || "";
        const next = pick.startsWith("goal:")
          ? { campaignId: null, stageId: null, contentId: null, goalId: pick.slice(5), seriesId: null }
          : pick.startsWith("series:")
            ? { campaignId: null, stageId: null, contentId: null, goalId: null, seriesId: pick.slice(7) }
            : { campaignId: pick || null, stageId: null, contentId: null, goalId: null, seriesId: null };
        const same = pick === currentScopeId && !state.scope.contentId;
        if (same) return;
        if (currentMessages(state).length) { state.threadId = null; syncUrl(state, `#/brand/${brandId}/brainstorm`); toast(t("bs.scope.changedNew")); }
        state.scope = next;
        refresh();
      })
    );
  });

  // "Save as Content Series": turn what's being brainstormed right now into
  // a reusable series — same manual form as Content OS's own Series tab
  // (js/views/series.js), just reachable without leaving the conversation.
  // Saving switches this conversation's own scope to the new series, same
  // as picking it from the scope menu, so the rest of this thread (and every
  // future "Buat <name> tentang ...") reads its context from here on.
  qs("#bs-save-series", root)?.addEventListener("click", () => {
    openSeriesModal({
      brandId,
      onSaved: (saved) => {
        if (!saved) return;
        state.scope = { campaignId: null, stageId: null, contentId: null, goalId: null, seriesId: saved.id };
        refresh();
      },
    });
  });

  qs("#bs-thread-menu", root)?.addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: r.bottom + 6, right: window.innerWidth - r.right });
    if (!menu) return;
    menu.innerHTML = `<button type="button" class="danger" data-bs-delete-thread>${icon("trash", { size: 13 })}${t("bs.ideas.deleteThread")}</button>`;
    menu.querySelector("[data-bs-delete-thread]").addEventListener("click", async () => {
      closeMenu();
      const ok = await confirmDialog({ title: t("bs.ideas.deleteThreadConfirm.title"), message: t("bs.ideas.deleteThreadConfirm.body"), confirmLabel: t("bs.ideas.deleteThread"), danger: true });
      if (!ok) return;
      deleteBrainstorm(state.threadId);
      state.threadId = null;
      syncUrl(state, `#/brand/${brandId}/brainstorm`);
      toast(t("bs.ideas.deleted"));
      refresh();
    });
  });

  // Idea / draft cards inside the chat
  const findIdea = (ref) => {
    const [msgId, idx] = ref.split(":");
    const th = getBrainstorm(state.threadId);
    const msg = th?.messages?.find((m) => m.id === msgId);
    return { th, msg, idx: Number(idx), idea: msg?.blocks?.ideas?.[Number(idx)], draft: msg?.blocks?.drafts?.[Number(idx)], task: msg?.blocks?.tasks?.[Number(idx)] };
  };
  const patchIdea = (th, msg, idx, patch, key = "ideas") => {
    const list = msg.blocks[key].map((x, i) => (i === idx ? { ...x, ...patch } : x));
    updateBrainstormMessage(th.id, msg.id, { blocks: { ...msg.blocks, [key]: list } });
  };
  // Reads the thread and campaign fresh on every call, so saving several
  // ideas in a row ("Simpan semua") never overwrites the previous one.
  const saveIdea = (thId, idea) => {
    const th = getBrainstorm(thId);
    const camp = info.campaign ? getCampaign(info.campaign.id) : null;
    updateBrainstorm(thId, { ideas: [...(th?.ideas || []), { id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: idea.title, why: idea.why || "", at: Date.now(), savedTo: camp ? "campaign" : "brand" }] });
    if (camp) updateCampaign(camp.id, { ideas: [...(camp.ideas || []), { id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: idea.title, description: idea.why || "", source: "brainstorm", createdAt: Date.now() }] });
    else addBrandIdea(brandId, { text: idea.title, description: idea.why || "" });
  };
  const draftFrom = ({ title, idea, funnel = "TOFU" }) =>
    createContent(brandId, {
      title,
      funnel,
      idea,
      status: "idea",
      campaignId: info.campaign?.id || "",
      campaignPhaseId: info.stage && info.stage.kind !== "level" ? info.stage.id : "",
      // This conversation is about a series episode → the new content
      // piece inherits the link, so Creator picks up its Series Context
      // automatically without the owner re-selecting it.
      seriesId: info.series?.id || "",
    });

  qsa("[data-bs-idea-save]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, idea } = findIdea(btn.dataset.bsIdeaSave);
      if (!idea || idea.saved) return;
      saveIdea(th.id, idea);
      patchIdea(th, msg, idx, { saved: true });
      toast(t("bs.idea.savedToast", { title: idea.title }));
      state.flash = true;
      refresh();
    })
  );
  qsa("[data-bs-save-all]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const th = getBrainstorm(state.threadId);
      const msg = th?.messages?.find((m) => m.id === btn.dataset.bsSaveAll);
      if (!msg?.blocks?.ideas) return;
      const todo = msg.blocks.ideas.filter((i) => !i.saved);
      todo.forEach((idea) => saveIdea(th.id, idea));
      updateBrainstormMessage(th.id, msg.id, { blocks: { ...msg.blocks, ideas: msg.blocks.ideas.map((i) => ({ ...i, saved: true })) } });
      toast(t("bs.idea.savedManyToast", { n: todo.length }));
      state.flash = true;
      refresh();
    })
  );
  qsa("[data-bs-task-add]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, task } = findIdea(btn.dataset.bsTaskAdd);
      if (!task || task.added) return;
      const phaseId = qs(`[data-bs-task-phase="${btn.dataset.bsTaskAdd}"]`, root)?.value || null;
      const res = addEventMilestone(task.campaignId, { title: task.title, why: task.why, target: task.target, unit: task.unit, phaseId });
      if (!res.ok) { toast(t("bs.failed"), "error"); return; }
      patchIdea(th, msg, idx, { added: true, phaseName: phaseNameLabel(res.phase.name) }, "tasks");
      toast(t("bs.task.toast", { title: task.title, phase: phaseNameLabel(res.phase.name) }));
      refresh();
    })
  );
  qsa("[data-bs-task-save]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, task } = findIdea(btn.dataset.bsTaskSave);
      if (!task || task.saved) return;
      saveIdea(th.id, { title: task.title, why: task.why });
      patchIdea(th, msg, idx, { saved: true }, "tasks");
      toast(t("bs.idea.savedToast", { title: task.title }));
      state.flash = true;
      refresh();
    })
  );
  // "Buatkan script": a draft, then straight into Creator's AI writer.
  qsa("[data-bs-idea-script]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, idea } = findIdea(btn.dataset.bsIdeaScript);
      if (!idea) return;
      let contentId = idea.contentId;
      if (!contentId) {
        const item = draftFrom({ title: idea.title, idea: t("bs.idea.fromChat", { why: idea.why || "" }) });
        contentId = item.id;
        patchIdea(th, msg, idx, { contentId });
      }
      go(`#/brand/${brandId}/content/creator/${contentId}`, { fromLabel: t("bs.eyebrow"), campaignId: info.campaign?.id || null, contentId, intent: "script" });
      state.onNavigate?.();
    })
  );
  qsa("[data-bs-idea-draft]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, idea } = findIdea(btn.dataset.bsIdeaDraft);
      if (!idea || idea.contentId) return;
      const item = draftFrom({ title: idea.title, idea: t("bs.idea.fromChat", { why: idea.why || "" }) });
      patchIdea(th, msg, idx, { contentId: item.id });
      toast(t("bs.idea.draftToast", { title: idea.title }));
      refresh();
    })
  );
  qsa("[data-bs-idea-use]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, idea } = findIdea(btn.dataset.bsIdeaUse);
      if (!idea || !info.content) return;
      const existing = getContent(info.content.id)?.idea || "";
      updateContent(info.content.id, { idea: [existing, `${idea.title}${idea.why ? ` — ${idea.why}` : ""}`].filter(Boolean).join("\n\n") });
      patchIdea(th, msg, idx, { usedHere: true });
      toast(t("bs.idea.usedToast"));
      refresh();
    })
  );
  qsa("[data-bs-draft]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, draft } = findIdea(btn.dataset.bsDraft);
      if (!draft || draft.contentId) return;
      const item = draftFrom({ title: draft.title, funnel: draft.funnel, idea: "" });
      patchIdea(th, msg, idx, { contentId: item.id }, "drafts");
      toast(t("bs.idea.draftToast", { title: draft.title }));
      refresh();
    })
  );

  // Saved ideas panel
  qsa("[data-bs-saved-draft]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const item = savedIdeasList(brandId, state, info).items.find((i) => i.id === btn.dataset.bsSavedDraft);
      if (!item) return;
      const c = draftFrom({ title: item.text, idea: item.description || "" });
      go(`#/brand/${brandId}/content/creator/${c.id}`, { fromLabel: t("bs.eyebrow"), campaignId: info.campaign?.id || null, contentId: c.id, intent: "continue" });
    })
  );
  qsa("[data-bs-saved-delete]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.bsSavedDelete;
      if (info.campaign) updateCampaign(info.campaign.id, { ideas: (info.campaign.ideas || []).filter((i) => i.id !== id) });
      else removeBrandIdea(brandId, id);
      refresh();
    })
  );
}
