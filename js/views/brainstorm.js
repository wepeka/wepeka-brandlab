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
  getBrand, listCampaigns, getCampaign, updateCampaign, listContent, getContent, updateContent, createContent, getSettings, onChange,
  listBrainstorms, getBrainstorm, createBrainstorm, appendBrainstormMessage, updateBrainstormMessage, updateBrainstorm, deleteBrainstorm,
  addBrandIdea, removeBrandIdea,
} from "../store.js";
import { campaignStages, activeStageIndex } from "../campaign-metrics.js";
import { chatBrainstorm, hasAiKey, AiApiError } from "../ai.js";
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

const HISTORY_FOR_MODEL = 24;
const TITLE_MAX = 60;

const TOUR_STEPS = [
  { selector: ".bs-scope", title: t("bs.eyebrow"), body: t("bs.tour.scope") },
  { selector: ".bs-composer", title: t("bs.send"), body: t("bs.tour.chat") },
  { selector: "#bs-ideas-now", title: t("bs.ideasNow"), body: t("bs.tour.ideasNow") },
  { selector: ".bs-ideas", title: t("bs.ideas.title"), body: t("bs.tour.ideas") },
];

export function render(root, { brandId, threadId = null }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const state = { threadId, scope: {}, draft: "", pending: false, error: "", notice: "", railOpen: false };
  const applyNavContext = () => {
    const ctx = consumeNavContext();
    if (!ctx) return;
    // Fresh context from another screen: start a conversation about it
    // unless we were sent to a specific existing thread.
    if (!threadId) {
      state.threadId = null;
      state.scope = { campaignId: ctx.campaignId || null, stageId: ctx.stageId || null, contentId: ctx.contentId || null };
    }
    if (ctx.seed) state.draft = ctx.seed;
  };
  applyNavContext();
  if (state.threadId) {
    const th = getBrainstorm(state.threadId);
    if (th) state.scope = { campaignId: th.campaignId || null, stageId: th.stageId || null, contentId: th.contentId || null };
    else state.threadId = null;
  }

  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  const onCtx = () => { applyNavContext(); refresh(); };
  document.addEventListener("nav:context", onCtx);
  const off = onChange(refresh);
  return () => {
    document.removeEventListener("nav:context", onCtx);
    off?.();
  };
}

// ---- Scope ----------------------------------------------------------------

function scopeInfo(brandId, scope) {
  const campaign = scope.campaignId ? getCampaign(scope.campaignId) : null;
  const content = scope.contentId ? getContent(scope.contentId) : null;
  let stage = null;
  if (campaign) {
    const stages = campaignStages(campaign);
    stage = (scope.stageId && stages.find((s) => s.id === scope.stageId)) || stages[activeStageIndex(campaign, stages, listContent(brandId))] || null;
  }
  let label;
  if (content) label = t("bs.scope.content", { title: content.title || t("beginner.untitled") });
  else if (campaign) label = t("bs.scope.campaign", { name: campaign.name }) + (stage ? t("bs.scope.stage", { stage: stage.name }) : "");
  else label = t("bs.scope.brand");
  const stageText = stage ? `${stage.kind === "level" ? "Level" : "Phase"} "${stage.name}"${stage.dateLabel ? ` (${stage.dateLabel})` : ""}${stage.description ? ` — ${stage.description}` : ""}` : "";
  return { campaign, content, stage, label, stageText };
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
  if (!info.campaign && !info.content) chips.push(t("bs.starter.campaign"));
  chips.push(t("bs.starter.content"), t("bs.starter.stuck"));
  return chips.slice(0, 4);
}

function ideaCardHTML(idea, i, msgId, info) {
  let action;
  if (idea.contentId) action = `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content-os/creator/${esc(idea.contentId)}">${icon("check", { size: 12 })}${t("bs.idea.openDraft")}</a>`;
  else if (idea.usedHere) action = `<span class="text-faint" style="font-size:12px;">${icon("check", { size: 12 })} ${t("bs.idea.usedHere")}</span>`;
  else if (info.content) action = `<button type="button" class="btn btn-secondary btn-sm" data-bs-idea-use="${msgId}:${i}">${icon("check", { size: 12 })}${t("bs.idea.useHere")}</button>`;
  else action = `<button type="button" class="btn btn-secondary btn-sm" data-bs-idea-draft="${msgId}:${i}">${icon("edit", { size: 12 })}${t("bs.idea.draft")}</button>`;
  const save = idea.saved
    ? `<span class="text-faint" style="font-size:12px;">${icon("check", { size: 12 })} ${t("bs.idea.saved")}</span>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-bs-idea-save="${msgId}:${i}">${icon("bookmark", { size: 12 })}${t("bs.idea.save")}</button>`;
  return `
    <div class="bs-card">
      <div class="bs-card-text">💡 <b>${esc(idea.title)}</b>${idea.why ? ` — ${esc(idea.why)}` : ""}</div>
      <div class="bs-card-actions">${action}${save}</div>
    </div>`;
}

function draftCardHTML(d, i, msgId) {
  return `
    <div class="bs-card">
      <div class="bs-card-actions">
        ${d.contentId
          ? `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content-os/creator/${esc(d.contentId)}">${icon("check", { size: 12 })}${t("bs.draft.created", { title: esc(d.title) })}</a>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-bs-draft="${msgId}:${i}"><span class="tag tag-${(d.funnel || "tofu").toLowerCase()}">${esc(d.funnel)}</span>${t("bs.draft.create", { title: esc(d.title) })}</button>`}
      </div>
    </div>`;
}

function messageHTML(m, { isLast, info }) {
  if (m.role === "user") return `<div class="consultant-msg consultant-msg-user"><span class="bs-user-text">${esc(m.text)}</span></div>`;
  const b = m.blocks || {};
  const inner = [
    m.text ? `<div class="consultant-md">${renderLightMarkdown(m.text)}</div>` : "",
    (b.ideas || []).map((idea, i) => ideaCardHTML(idea, i, m.id, info)).join(""),
    (b.drafts || []).map((d, i) => draftCardHTML(d, i, m.id)).join(""),
    isLast && b.asks?.length ? `<div class="consultant-starters" style="margin-top:8px;">${b.asks.map((q) => `<button type="button" class="consultant-starter" data-bs-starter="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : "",
    `<div class="bs-feedback-slot" data-bs-feedback="${m.id}"></div>`,
  ].join("");
  return `<div class="consultant-msg consultant-msg-assistant" data-bs-msg="${m.id}">${inner}</div>`;
}

function chatHTML(brandId, brand, state, info) {
  const msgs = currentMessages(state);
  const quotaOut = aiLimitReached();
  const busy = state.pending;
  let body;
  if (!msgs.length) {
    body = `
      <div class="consultant-msg consultant-msg-assistant">${esc(t("bs.intro"))}</div>
      <div class="consultant-starters">${starterChips(brandId, brand, info).map((q) => `<button type="button" class="consultant-starter" data-bs-starter="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  } else {
    body = msgs.map((m, i) => messageHTML(m, { isLast: i === msgs.length - 1, info })).join("");
  }
  if (state.notice) body += `<div class="consultant-msg consultant-msg-assistant">${esc(state.notice)}</div>`;
  if (busy) body += `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending"><span class="typing-dots" aria-label="${t("bs.typing")}"><i></i><i></i><i></i></span></div>`;

  return `
    <section class="card glass-card bs-chat">
      <div class="bs-scope">
        <span class="bs-scope-chip">${icon(info.content ? "edit" : info.campaign ? "bulb" : "target", { size: 12 })}${esc(info.label)}</span>
        <button type="button" class="link" id="bs-scope-change" style="font-size:12px;">${t("bs.scope.change")}</button>
        <span style="flex:1;"></span>
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
        <button type="button" class="btn btn-ghost btn-sm" id="bs-ideas-now" title="${esc(t("bs.ideasNow.title"))}" ${busy || quotaOut ? "disabled" : ""}>${icon("sparkle", { size: 12 })}${t("bs.ideasNow")}</button>
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
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}/tools`, t("nav.tools"))} · ${t("bs.eyebrow")}${helpButtonHTML("brainstorm")}${guideVideoButtonHTML("brainstorm")}</div>
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
  const autosize = () => { if (!input) return; input.style.height = "auto"; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  autosize();
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
    const th = createBrainstorm(brandId, { mode: "chat", title: firstText.slice(0, TITLE_MAX), campaignId: state.scope.campaignId || null, stageId: state.scope.stageId || null, contentId: state.scope.contentId || null });
    state.threadId = th.id;
    // Keep the URL honest without a hashchange (which would re-render mid-call).
    history.replaceState(null, "", `#/brand/${brandId}/brainstorm/${th.id}`);
    return th;
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
    appendBrainstormMessage(th.id, { role: "user", text });
    try {
      const ai = getSettings().ai || {};
      if (!hasAiKey(ai)) { state.notice = t("bs.noKey"); return; }
      const all = getBrainstorm(th.id)?.messages || [];
      const history = all.slice(0, -1).filter((m) => m.text).slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, text: m.text }));
      const savedIdeas = [...(getBrainstorm(th.id)?.ideas || []).map((i) => i.text), ...savedIdeasList(brandId, state, info).items.map((i) => i.text)];
      const freshBrand = getBrand(brandId);
      const campaigns = listCampaigns(brandId);
      const raw = await chatBrainstorm(ai, {
        brand: freshBrand,
        campaigns,
        pulseText: pulseTextFor(freshBrand, { content: listContent(brandId), campaigns, settings: getSettings() }),
        campaign: info.campaign,
        stageText: info.stageText,
        content: info.content,
        savedIdeas,
        history,
        message: text,
        mode,
      });
      const { cleanText, ideas, drafts, asks } = parseDirectives(raw.trim());
      appendBrainstormMessage(th.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas, drafts, asks } });
    } catch (e) {
      state.error = e instanceof AiApiError ? e.message : t("bs.failed");
    } finally {
      state.pending = false;
      refresh();
    }
  };

  qs("#bs-send", root)?.addEventListener("click", () => send());
  qs("#bs-ideas-now", root)?.addEventListener("click", () => send(input?.value.trim() || t("bs.ideasNow.message"), "ideas"));
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
      state.scope = { campaignId: th.campaignId || null, stageId: th.stageId || null, contentId: th.contentId || null };
      state.error = ""; state.notice = "";
      history.replaceState(null, "", `#/brand/${brandId}/brainstorm/${th.id}`);
      refresh();
    })
  );
  qs("#bs-new", root)?.addEventListener("click", (e) => {
    e.preventDefault();
    state.threadId = null;
    state.error = ""; state.notice = "";
    history.replaceState(null, "", `#/brand/${brandId}/brainstorm`);
    refresh();
  });
  qs(".bs-threads", root)?.addEventListener("toggle", (e) => { state.railOpen = e.target.open; });

  // Scope picker: brand-wide or one of the active campaigns. Changing scope
  // mid-conversation starts a new thread — the old one keeps its context.
  qs("#bs-scope-change", root)?.addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: r.bottom + 6, left: r.left });
    if (!menu) return;
    const options = [{ id: "", label: t("bs.scope.brand") }, ...listCampaigns(brandId).filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: t("bs.scope.campaign", { name: c.name }) }))];
    menu.innerHTML = `<div class="text-faint" style="font-size:11px;padding:6px 10px 4px;">${t("bs.scope.pickTitle")}</div>` + options.map((o) => `<button type="button" data-scope="${o.id}">${o.id === (state.scope.campaignId || "") && !state.scope.contentId ? icon("check", { size: 12 }) : ""}${esc(o.label)}</button>`).join("");
    menu.querySelectorAll("[data-scope]").forEach((b) =>
      b.addEventListener("click", () => {
        closeMenu();
        const next = { campaignId: b.dataset.scope || null, stageId: null, contentId: null };
        const same = (next.campaignId || null) === (state.scope.campaignId || null) && !state.scope.contentId;
        if (same) return;
        if (currentMessages(state).length) { state.threadId = null; history.replaceState(null, "", `#/brand/${brandId}/brainstorm`); toast(t("bs.scope.changedNew")); }
        state.scope = next;
        refresh();
      })
    );
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
      history.replaceState(null, "", `#/brand/${brandId}/brainstorm`);
      toast(t("bs.ideas.deleted"));
      refresh();
    });
  });

  // Idea / draft cards inside the chat
  const findIdea = (ref) => {
    const [msgId, idx] = ref.split(":");
    const th = getBrainstorm(state.threadId);
    const msg = th?.messages?.find((m) => m.id === msgId);
    return { th, msg, idx: Number(idx), idea: msg?.blocks?.ideas?.[Number(idx)], draft: msg?.blocks?.drafts?.[Number(idx)] };
  };
  const patchIdea = (th, msg, idx, patch, key = "ideas") => {
    const list = msg.blocks[key].map((x, i) => (i === idx ? { ...x, ...patch } : x));
    updateBrainstormMessage(th.id, msg.id, { blocks: { ...msg.blocks, [key]: list } });
  };
  const saveIdea = (th, idea) => {
    updateBrainstorm(th.id, { ideas: [...(th.ideas || []), { id: `idea-${Date.now()}`, text: idea.title, why: idea.why || "", at: Date.now(), savedTo: info.campaign ? "campaign" : "brand" }] });
    if (info.campaign) updateCampaign(info.campaign.id, { ideas: [...(info.campaign.ideas || []), { id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: idea.title, description: idea.why || "", source: "brainstorm", createdAt: Date.now() }] });
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
    });

  qsa("[data-bs-idea-save]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const { th, msg, idx, idea } = findIdea(btn.dataset.bsIdeaSave);
      if (!idea || idea.saved) return;
      saveIdea(th, idea);
      patchIdea(th, msg, idx, { saved: true });
      toast(t("bs.idea.savedToast", { title: idea.title }));
      refresh();
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
      go(`#/brand/${brandId}/content-os/creator/${c.id}`, { fromLabel: t("bs.eyebrow"), campaignId: info.campaign?.id || null, contentId: c.id, intent: "continue" });
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
