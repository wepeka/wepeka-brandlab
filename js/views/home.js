import { getBrand, listContent, listCampaigns, listOverdueAndDueSoon, onChange, getSettings, updateBrand, removeBrandLogEntry, clearBrandLog, addBrandMoments, MOMENT_KINDS, MOMENT_ACTIONS, createContent, getCompanionThread, ensureCompanionThread, appendBrainstormMessage, updateBrainstormMessage, removeBrainstormMessage, updateBrainstorm, localISODate } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, escapeHtml as esc, toast, showCalloutBubble, qs, qsa } from "../dom.js";
import { brandDnaCompleteness, brandDnaDone, visualBasicsDone, brandBookProgress, identityDone as isIdentityDone } from "../brand-progress.js";
import { goalWidget, wireGoalCard } from "../goal-card.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { openContentEditor } from "./content-editor.js";
import { celebrateBuilderCompleteIfFlagged, consumeDnaJustCompleted, consumeVisualBasicsJustDone } from "./brand-builder.js";
import { funnelLabel } from "../funnel-field.js";
import { brandTopAction } from "../next-action.js";
import { getMode } from "../mode.js";
import { t } from "../i18n.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";
import { analyticsSectionHTML, wireAnalyticsSection } from "./brand-home-analytics.js";
import { openReportModal } from "./report.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { computeSignals, pulseTextFor } from "../brand-pulse.js";
import { companionChat, recapCompanion, hasAiKey, AiApiError } from "../ai.js";
import { aiLimitReached } from "../ai-usage.js";
import { parseDirectives, renderLightMarkdown } from "../ai-directives.js";
import { wireMic } from "../voice-input.js";
import { go } from "../nav-context.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";

// The brand's home, one file for both modes. The page answers one question
// — "sekarang ngapain?" — with one hero card and one button:
//
//   1. identity not done  → the hero is Brand DNA / Warna & Font progress,
//      the button goes to whichever half is still open;
//   2. identity done      → the hero is "Hari ini": the single most urgent
//      thing across the brand's campaigns (js/next-action.js).
//
// Under it: the three steps (identity → campaign → content) as a checklist,
// the schedule (overdue + up next), and — Pro only — the analytics section.
// The only mode-dependent bits are in HOME_CONFIG.
const HOME_CONFIG = {
  guided: { analytics: false, lockNext: true },
  advanced: { analytics: true, lockNext: false },
};
const config = () => HOME_CONFIG[getMode()] || HOME_CONFIG.guided;

const TOUR_STEPS = [
  { selector: "#journey-hero", title: t("beginner.tour.hero.title"), body: t("beginner.tour.hero.body") },
  { selector: "#beginner-journey", title: t("beginner.tour.journey.title"), body: t("beginner.tour.journey.body") },
  { selector: "#consultant-fab", title: t("beginner.tour.ai.title"), body: t("beginner.tour.ai.body") },
];

export function render(root, { brandId }) {
  const state = { topContentPeriod: "all" };
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

// Most-ready unfinished content first (same ordering idea as
// next-action.js's READINESS) so "lanjutkan konten" lands on the one
// closest to actually going out.
const READINESS = { scheduled: 0, editing: 1, production: 2, draft: 3, idea: 4 };

function buildSteps(brandId, brand, campaigns, content) {
  const dnaDone = brandDnaDone(brand);
  const basicsDone = visualBasicsDone(brand);
  const identityDone = dnaDone && basicsDone;
  const unpublished = content.filter((c) => c.status !== "published").sort((a, b) => (READINESS[a.status] ?? 5) - (READINESS[b.status] ?? 5));
  const hasPublished = content.some((c) => c.status === "published");
  const steps = [
    {
      key: "identity",
      app: "builder",
      title: t("beginner.step.identity.title"),
      desc: t("beginner.step.identity.desc"),
      done: identityDone,
      href: dnaDone ? `#/brand/${brandId}/guidelines/color` : `#/brand/${brandId}/dna`,
      editHref: `#/brand/${brandId}/builder`,
      cta: dnaDone ? t("beginner.step.identity.ctaGuidelines") : t("beginner.step.identity.ctaDna"),
    },
    {
      key: "campaign",
      app: "campaigns",
      title: t("beginner.step.campaign.title"),
      desc: t("beginner.step.campaign.desc"),
      done: campaigns.length > 0,
      doneNote: campaigns.length ? t("brandHome.widget.campaign.count", { count: campaigns.length }) : "",
      href: `#/brand/${brandId}/campaigns`,
      editHref: `#/brand/${brandId}/campaigns`,
      cta: t("beginner.step.campaign.cta"),
    },
    {
      key: "content",
      app: "content-os",
      title: t("beginner.step.content.title"),
      desc: t("beginner.step.content.desc"),
      done: hasPublished,
      doneNote: hasPublished ? t("brandHome.widget.contentOs.sub", { total: content.length, published: content.filter((c) => c.status === "published").length }) : "",
      href: unpublished[0] ? `#/brand/${brandId}/content/creator/${unpublished[0].id}` : `#/brand/${brandId}/content/creator`,
      editHref: `#/brand/${brandId}/content`,
      cta: unpublished[0] ? t("beginner.step.content.ctaContinue") : t("beginner.step.content.ctaWrite"),
    },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);
  return { steps, currentIndex, doneCount: steps.filter((s) => s.done).length, identityDone };
}

// ---------- Companion / Teman Brand ----------
// A real chat with the brand, not a log. Three layers, on purpose:
//
//   1. The chat itself — a rolling per-brand thread in the brainstorms/
//      collection (js/store.js getCompanionThread). Raw, deletable per
//      message, and read by exactly one AI call: companionChat, the
//      Companion's own reply. Nothing else in the app ever sees it, so an
//      offhand vent stays between the owner and this card.
//   2. Moments — what a recap (js/ai.js recapCompanion) pulls out of that
//      chat: the few brand-relevant things that happened (a sales spike,
//      an offer, a VIP customer…), each ticked by the owner on the recap
//      card before it enters brand.developmentLog (source "moment").
//   3. Brand memory — moments + auto signals, the only thing
//      js/brand-pulse.js buildPulseText renders into every other AI
//      feature's context. "Kelola" opens it for deleting.
//
// The recap is never triggered silently: a nudge bubble when the owner
// comes back to un-recapped chat, and a "Rangkum" button — one tap, one AI
// call, and the owner sees exactly what would be remembered before it is.

// Which signal kinds get a quick-action button, in priority order — same
// four the brief calls out, first match wins for the greeting's "yang aku
// lihat" line too so the two never disagree about what's most notable.
const COMPANION_ACTION_KINDS = ["viral", "follower-jump", "sales-down", "streak-break"];
const GREETING_PRIORITY = ["viral", "sales-down", "follower-jump", "follower-drop", "engagement-drop", "streak-break", "top-format", "sales-up", "stale-campaign", "overdue", "cross"];
const HISTORY_FOR_MODEL = 16;
const MOMENTS_SHOWN = 3;
const RECAP_MAX_MOMENTS = 6;
const MEMORY_MODAL_LIMIT = 40;

function pickTopSignal(signals) {
  for (const kind of GREETING_PRIORITY) {
    const hit = signals.find((s) => s.kind === kind);
    if (hit) return hit;
  }
  return null;
}

function greetingSentence(brand, now) {
  const h = now.getHours();
  const key = h < 11 ? "companion.greeting.morning" : h < 17 ? "companion.greeting.afternoon" : "companion.greeting.evening";
  return t(key, { brand: esc(brand.name) });
}

const dayKey = (ms) => localISODate(new Date(ms));
function dayLabel(iso, todayIso) {
  if (iso === todayIso) return t("companion.day.today");
  const y = new Date(todayIso + "T00:00:00");
  y.setDate(y.getDate() - 1);
  if (iso === localISODate(y)) return t("companion.day.yesterday");
  return formatDate(iso);
}
const daySeparatorHTML = (label) => `<div class="companion-day">${esc(label)}</div>`;

function bubbleHTML(role, inner, { msgId = "", extraClass = "" } = {}) {
  const del = role === "user" && msgId
    ? `<button type="button" class="companion-msg-del" data-companion-msg-delete="${msgId}" aria-label="${t("companion.msg.delete")}" title="${t("companion.msg.delete")}">${icon("trash", { size: 11 })}</button>`
    : "";
  return `<div class="consultant-msg consultant-msg-${role}${extraClass ? ` ${extraClass}` : ""}"${msgId ? ` data-companion-msg="${msgId}"` : ""}>${inner}${del}</div>`;
}

const typingHTML = () => bubbleHTML("assistant", `<span class="typing-dots" aria-label="${t("companion.typing")}"><i></i><i></i><i></i></span>`, { extraClass: "consultant-msg-pending" });

// [[idea:…]] from a reply → a card with a real way to act on it. Once
// "Bikin di Creator" has run, the card remembers the draft it made
// (idea.contentId, patched into the message) so a reload doesn't offer to
// create it twice.
function ideaCardsHTML(ideas, msgId) {
  return (ideas || [])
    .map((idea, i) => {
      const seed = t("companion.moment.seed", { title: idea.title, detail: idea.why });
      const create = idea.contentId
        ? `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content/creator/${esc(idea.contentId)}">${icon("check", { size: 12 })}${t("companion.idea.openDraft")}</a>`
        : `<button type="button" class="btn btn-secondary btn-sm" data-companion-idea-create="${msgId}:${i}">${icon("edit", { size: 12 })}${t("companion.idea.create")}</button>`;
      return `
        <div class="companion-idea">
          <div>💡 <b>${esc(idea.title)}</b> — ${esc(idea.why)}</div>
          <div class="companion-actions" style="margin-top:8px;">
            ${create}
            <button type="button" class="btn btn-ghost btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 12 })}${t("companion.idea.brainstorm")}</button>
          </div>
        </div>`;
    })
    .join("");
}

function asksHTML(asks) {
  if (!asks?.length) return "";
  return `<div class="consultant-starters" style="margin-top:8px;">${asks.map((q) => `<button type="button" class="consultant-starter" data-companion-followup="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
}

// The recap card: what the model thinks is worth remembering, as a
// checklist the owner decides on. Undecided → checkboxes + Simpan/Buang;
// decided → a one-line record of what happened, so the thread keeps its
// history without offering the same choice twice.
function recapCardHTML(recap, msgId) {
  const moments = recap.moments || [];
  if (recap.decided) {
    const line = moments.length === 0 ? t("companion.recap.empty") : recap.savedCount ? t("companion.recap.decidedSaved", { n: recap.savedCount }) : t("companion.recap.decidedNone");
    return `<div class="companion-recap is-decided"><span class="text-faint" style="font-size:11.5px;">${icon("check", { size: 11 })} ${esc(line)}</span></div>`;
  }
  return `
    <div class="companion-recap">
      <p class="companion-recap-pick">${t("companion.recap.pick")}</p>
      ${moments
        .map(
          (m, i) => `
        <label class="companion-recap-item">
          <input type="checkbox" checked data-recap-pick="${i}" />
          <span class="companion-recap-body">
            <span class="tag">${t(`companion.moment.kind.${m.kind}`)}</span>
            <b>${esc(m.title)}</b>${m.detail ? `<span class="text-muted"> — ${esc(m.detail)}</span>` : ""}
          </span>
        </label>`
        )
        .join("")}
      <div class="companion-actions" style="margin-top:10px;">
        <button type="button" class="btn btn-primary btn-sm" data-companion-recap-save="${msgId}">${icon("check", { size: 12 })}${t("companion.recap.save")}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-companion-recap-discard="${msgId}">${t("companion.recap.discard")}</button>
      </div>
    </div>`;
}

function messageHTML(m, { isLast }) {
  if (m.role === "user") return bubbleHTML("user", `<span class="companion-user-text">${esc(m.text)}</span>`, { msgId: m.id });
  const blocks = m.blocks || {};
  const inner = [
    m.text ? `<div class="consultant-md">${renderLightMarkdown(m.text)}</div>` : "",
    blocks.recap ? recapCardHTML(blocks.recap, m.id) : "",
    ideaCardsHTML(blocks.ideas, m.id),
    isLast ? asksHTML(blocks.asks) : "",
  ].join("");
  return bubbleHTML("assistant", inner, { msgId: m.id });
}

function threadHTML({ brand, thread, signals, now, state }) {
  const todayIso = localISODate(now);
  const msgs = [...(thread?.messages || [])].sort((a, b) => a.at - b.at);
  const older = msgs.filter((m) => dayKey(m.at) !== todayIso);
  const todayMsgs = msgs.filter((m) => dayKey(m.at) === todayIso);
  const lastId = msgs[msgs.length - 1]?.id;
  const parts = [];

  if (older.length) {
    if (!state.companionShowAll) {
      parts.push(`<button type="button" class="companion-older-toggle" data-companion-toggle-older>${icon("chevronDown", { size: 12 })}${t("companion.showOlder", { n: older.length })}</button>`);
    } else {
      parts.push(`<button type="button" class="companion-older-toggle" data-companion-toggle-older>${icon("chevronDown", { size: 12 })}${t("companion.hideOlder")}</button>`);
      let day = "";
      older.forEach((m) => {
        const d = dayKey(m.at);
        if (d !== day) { day = d; parts.push(daySeparatorHTML(dayLabel(d, todayIso))); }
        parts.push(messageHTML(m, { isLast: m.id === lastId }));
      });
    }
  }

  parts.push(daySeparatorHTML(dayLabel(todayIso, todayIso)));

  // Deterministic, never persisted: today's "hey, what happened?" plus the
  // single most notable auto signal. Disappears once the owner has said
  // something today (companion.lastAskedAt).
  if (brand.companion?.lastAskedAt !== todayIso) {
    const top = pickTopSignal(signals);
    parts.push(bubbleHTML("assistant", `${greetingSentence(brand, now)} ${esc(top ? top.title : t("companion.observation.quiet"))}`));
  }

  // Also deterministic: chat since the last recap that the owner hasn't
  // come back to yet → offer the recap, one tap. Only when there's nothing
  // from today, so it never interrupts a conversation in progress.
  const since = brand.companion?.lastRecapAt || 0;
  const unrecapped = msgs.filter((m) => m.role === "user" && m.at > since).length;
  if (unrecapped && !todayMsgs.some((m) => m.role === "user") && !state.companionPending) {
    parts.push(
      bubbleHTML(
        "assistant",
        `${esc(t("companion.recap.nudge", { n: unrecapped }))}<div class="companion-actions" style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-sm" data-companion-recap>${icon("sparkle", { size: 12 })}${t("companion.recap.button")}</button></div>`
      )
    );
  }

  todayMsgs.forEach((m) => parts.push(messageHTML(m, { isLast: m.id === lastId })));
  if (state.companionNotice) parts.push(bubbleHTML("assistant", esc(state.companionNotice)));
  if (state.companionPending) parts.push(typingHTML());
  return parts.join("");
}

function companionActionsHTML(signals, content, brandId) {
  const picks = COMPANION_ACTION_KINDS.map((kind) => signals.find((s) => s.kind === kind)).filter(Boolean).slice(0, 2);
  if (!picks.length) return "";
  const buttons = picks.map((s) => {
    if (s.kind === "viral") {
      const c = content.find((x) => x.id === s.refs.contentId);
      const seed = t("companion.seed.viral", { title: c?.title || t("pulse.untitledContent") });
      return `<button type="button" class="btn btn-secondary btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 13 })}${t("companion.action.similarContent")}</button>`;
    }
    if (s.kind === "follower-jump") {
      const seed = t("companion.seed.followerJump", { platform: s.refs.platform || "" });
      return `<button type="button" class="btn btn-secondary btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 13 })}${t("companion.action.rideMomentum")}</button>`;
    }
    if (s.kind === "sales-down") {
      return `<a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/sales">${icon("chart", { size: 13 })}${t("companion.action.openSales")}</a>`;
    }
    // streak-break
    return `<a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/content/creator">${icon("edit", { size: 13 })}${t("companion.action.openCreator")}</a>`;
  });
  return `<div class="companion-actions">${buttons.join("")}</div>`;
}

// The newest saved moments, each with its action (if the recap gave it one)
// and a real delete — plus "Kelola" for the full brand memory.
function momentActionHTML(m, brandId) {
  const action = m.refs?.action;
  if (!action) return "";
  const label = t(`companion.moment.action.${action}`);
  if (action === "brainstorm") {
    const seed = t("companion.moment.seed", { title: m.title, detail: m.detail || "" });
    return `<button type="button" class="companion-moment-action" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${label}${icon("arrowRight", { size: 11 })}</button>`;
  }
  const href = action === "sales" ? `#/brand/${brandId}/sales` : `#/brand/${brandId}/content/creator`;
  return `<a class="companion-moment-action" href="${href}">${label}${icon("arrowRight", { size: 11 })}</a>`;
}

function momentsStripHTML(log, brandId) {
  const moments = (log || []).filter((e) => e.source === "moment").sort((a, b) => b.at - a.at).slice(0, MOMENTS_SHOWN);
  const rows = moments
    .map(
      (m) => `
      <div class="companion-moment-row">
        <span class="tag">${t(`companion.moment.kind.${m.kind}`)}</span>
        <span class="companion-moment-text" title="${esc(m.detail || m.title)}">${esc(m.title)}</span>
        ${momentActionHTML(m, brandId)}
        <button type="button" class="chip-icon-btn" data-companion-delete="${m.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
      </div>`
    )
    .join("");
  return `
    <div class="companion-moments">
      <div class="companion-moments-head">
        <p class="companion-moments-title">${t("companion.moments.title")}</p>
        <button type="button" class="link" id="companion-manage" style="font-size:11px;">${t("companion.moments.manage")}</button>
      </div>
      ${rows || `<p class="text-faint" style="font-size:12px;margin:0;">${t("companion.memory.empty")}</p>`}
    </div>`;
}

function companionWidgetHTML(brand, { thread, signals, content, now, state }) {
  const log = brand.developmentLog || [];
  const since = brand.companion?.lastRecapAt || 0;
  const unrecapped = (thread?.messages || []).filter((m) => m.role === "user" && m.at > since).length;
  const quotaOut = aiLimitReached();
  const busy = !!state.companionPending;
  const weekAgo = now.getTime() - 7 * 86400000;
  const momentsThisWeek = log.filter((e) => e.source === "moment" && e.at >= weekAgo).length;

  const thread_ = threadHTML({ brand, thread, signals, now, state }).replaceAll("__BRAND__", brand.id);
  return {
    extraHead: unrecapped && !busy ? `<button type="button" class="btn btn-secondary btn-sm" data-companion-recap>${icon("sparkle", { size: 12 })}${t("companion.recap.button")}</button>` : "",
    bodyHTML: `
      <div class="companion-thread" id="companion-thread">${thread_}</div>
      ${state.companionError ? `<p class="companion-error">${esc(state.companionError)}</p>` : ""}
      ${quotaOut ? `<p class="companion-error">${t("companion.quotaReached")}</p>` : ""}
      <div class="companion-composer">
        <input type="text" class="input" id="companion-input" placeholder="${esc(t("companion.placeholder"))}" value="${esc(state.companionDraft || "")}" ${busy || quotaOut ? "disabled" : ""} />
        <button type="button" class="chip-icon-btn" id="companion-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}" ${busy || quotaOut ? "disabled" : ""}>${icon("mic", { size: 15 })}</button>
        <button type="button" class="btn btn-primary btn-sm" id="companion-send" ${busy || quotaOut ? "disabled" : ""}>${t("companion.send")}</button>
      </div>
      ${companionActionsHTML(signals, content, brand.id)}
      ${momentsStripHTML(log, brand.id)}
    `,
    summary: momentsThisWeek ? t("companion.moments.summary", { n: momentsThisWeek }) : t("companion.observation.quiet"),
  };
}

// What the model returned → what we're willing to store. Unknown kinds
// become "other", unknown actions are dropped, strings are cut to the
// lengths the prompt promised, empties vanish. Nothing here is trusted
// past this point.
function validateRecap(moments) {
  return (Array.isArray(moments) ? moments : [])
    .map((m) => ({
      kind: MOMENT_KINDS.includes(m?.kind) ? m.kind : "other",
      title: String(m?.title || "").trim().slice(0, 80),
      detail: String(m?.detail || "").trim().slice(0, 160),
      action: MOMENT_ACTIONS.includes(m?.action) ? m.action : null,
    }))
    .filter((m) => m.title)
    .slice(0, RECAP_MAX_MOMENTS);
}

function wireCompanion(root, { brandId, brand, content, signals, state, refresh }) {
  const threadEl = qs("#companion-thread", root);
  if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  const input = qs("#companion-input", root);
  const sendBtn = qs("#companion-send", root);
  const micBtn = qs("#companion-mic", root);
  if (micBtn && input) wireMic(micBtn, input);
  // A Firestore snapshot mid-sentence repaints the card; keep what's typed.
  input?.addEventListener("input", () => { state.companionDraft = input.value; });

  const pulseNow = () => pulseTextFor(getBrand(brandId), { content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });

  const send = async (textArg) => {
    const text = (textArg ?? input?.value ?? "").trim();
    if (!text || state.companionPending) return;
    state.companionPending = true;
    state.companionError = "";
    state.companionNotice = "";
    state.companionDraft = "";
    refresh();
    const thread = ensureCompanionThread(brandId);
    appendBrainstormMessage(thread.id, { role: "user", text });
    updateBrand(brandId, { companion: { ...(brand.companion || {}), lastAskedAt: localISODate() } });
    try {
      const ai = getSettings().ai || {};
      if (!hasAiKey(ai)) {
        state.companionNotice = t("companion.aiUnavailable");
        return;
      }
      const msgs = getCompanionThread(brandId)?.messages || [];
      // Everything before the message just appended, most recent first cut.
      const history = msgs.slice(0, -1).filter((m) => m.text).slice(-HISTORY_FOR_MODEL).map((m) => ({ role: m.role, text: m.text }));
      const raw = await companionChat(ai, { brand: getBrand(brandId), pulseText: pulseNow(), history, message: text });
      const { cleanText, ideas, asks } = parseDirectives(raw.trim());
      appendBrainstormMessage(thread.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas, asks } });
    } catch (e) {
      state.companionError = e instanceof AiApiError ? e.message : t("companion.saveFailed");
    } finally {
      state.companionPending = false;
      refresh();
    }
  };

  const recap = async () => {
    if (state.companionPending) return;
    const thread = getCompanionThread(brandId);
    const since = getBrand(brandId)?.companion?.lastRecapAt || 0;
    const slice = (thread?.messages || []).filter((m) => m.at > since && !m.blocks?.recap && m.text);
    if (!slice.some((m) => m.role === "user")) return;
    state.companionPending = true;
    state.companionError = "";
    state.companionNotice = "";
    refresh();
    try {
      const ai = getSettings().ai || {};
      if (!hasAiKey(ai)) throw new AiApiError(t("companion.aiUnavailable"));
      const { summary, moments } = await recapCompanion(ai, {
        brand: getBrand(brandId),
        pulseText: pulseNow(),
        messages: slice.map((m) => ({ role: m.role, text: m.text })),
        today: localISODate(),
        kinds: MOMENT_KINDS,
        actions: MOMENT_ACTIONS,
      });
      const valid = validateRecap(moments);
      // Covered messages count as recapped from here on, whatever the owner
      // decides on the card — the nudge shouldn't keep asking about them.
      const now = Date.now();
      appendBrainstormMessage(thread.id, { role: "assistant", text: summary, at: now, blocks: { recap: { moments: valid, decided: valid.length === 0, savedCount: 0 } } });
      updateBrand(brandId, { companion: { ...(getBrand(brandId)?.companion || {}), lastRecapAt: now } });
    } catch (e) {
      state.companionError = e instanceof AiApiError ? e.message : t("companion.recap.failed");
    } finally {
      state.companionPending = false;
      refresh();
    }
  };

  const decideRecap = (msgId, save) => {
    const thread = getCompanionThread(brandId);
    const msg = thread?.messages?.find((m) => m.id === msgId);
    const recapBlock = msg?.blocks?.recap;
    if (!recapBlock || recapBlock.decided) return;
    let picked = [];
    if (save) {
      const bubble = qs(`[data-companion-msg="${msgId}"]`, root);
      const checked = new Set(qsa("[data-recap-pick]", bubble).filter((el) => el.checked).map((el) => Number(el.dataset.recapPick)));
      picked = recapBlock.moments.filter((_, i) => checked.has(i));
      if (picked.length) addBrandMoments(brandId, picked);
    }
    updateBrainstormMessage(thread.id, msgId, { blocks: { ...msg.blocks, recap: { ...recapBlock, decided: true, savedCount: picked.length } } });
    toast(picked.length ? t("companion.recap.saved", { n: picked.length }) : t("companion.recap.discarded"));
    refresh();
  };

  sendBtn?.addEventListener("click", () => send());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });
  qsa("[data-companion-followup]", root).forEach((btn) => btn.addEventListener("click", () => send(btn.dataset.companionFollowup)));
  qsa("[data-companion-recap]", root).forEach((btn) => btn.addEventListener("click", recap));
  qsa("[data-companion-recap-save]", root).forEach((btn) => btn.addEventListener("click", () => decideRecap(btn.dataset.companionRecapSave, true)));
  qsa("[data-companion-recap-discard]", root).forEach((btn) => btn.addEventListener("click", () => decideRecap(btn.dataset.companionRecapDiscard, false)));
  qsa("[data-companion-toggle-older]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.companionShowAll = !state.companionShowAll;
      refresh();
    })
  );
  qsa("[data-companion-msg-delete]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const thread = getCompanionThread(brandId);
      if (thread) removeBrainstormMessage(thread.id, btn.dataset.companionMsgDelete);
      refresh();
    })
  );
  qsa("[data-companion-idea-create]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const [msgId, idx] = btn.dataset.companionIdeaCreate.split(":");
      const thread = getCompanionThread(brandId);
      const msg = thread?.messages?.find((m) => m.id === msgId);
      const idea = msg?.blocks?.ideas?.[Number(idx)];
      if (!idea || idea.contentId) return;
      // Linked to the brand's active campaign so it counts there right away
      // (same as the Consultant FAB's "Buatkan draft").
      const active = listCampaigns(brandId).find((c) => c.status !== "archived");
      const item = createContent(brandId, { title: idea.title, funnel: "TOFU", campaignId: active?.id || "", idea: t("companion.idea.fromChat", { why: idea.why }) });
      const ideas = msg.blocks.ideas.map((x, i) => (i === Number(idx) ? { ...x, contentId: item.id } : x));
      updateBrainstormMessage(thread.id, msgId, { blocks: { ...msg.blocks, ideas } });
      toast(t("companion.idea.created", { title: idea.title }));
      refresh();
    })
  );
  qsa("[data-companion-delete]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      removeBrandLogEntry(brandId, btn.dataset.companionDelete);
      refresh();
    })
  );
  qs("#companion-manage", root)?.addEventListener("click", () => openBrandMemoryModal(brandId, { refresh }));
  qsa("[data-companion-go]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      go(`#/brand/${brandId}/brainstorm`, { seed: btn.dataset.companionSeed, fromLabel: brand.name });
    })
  );
}

// Brand memory in full: every moment and auto signal past the 3 the card
// shows, each deletable, plus the chat's own "delete everything" — kept
// apart on purpose so it's clear which one AI features read (memory) and
// which one only the Companion does (chat).
function openBrandMemoryModal(brandId, { refresh }) {
  const sourceTag = (e) => {
    if (e.source === "moment") return t(`companion.moment.kind.${MOMENT_KINDS.includes(e.kind) ? e.kind : "other"}`);
    if (e.source === "auto") return t("pulse.log.auto");
    return t("pulse.log.legacy");
  };
  const paintList = () => {
    const brand = getBrand(brandId);
    const log = [...(brand?.developmentLog || [])].sort((a, b) => b.at - a.at).slice(0, MEMORY_MODAL_LIMIT);
    const msgCount = getCompanionThread(brandId)?.messages?.length || 0;
    return `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("companion.memory.intro")}</p>
      ${
        log.length
          ? log
              .map(
                (e) => `
              <div class="companion-moment-row" data-memory-row="${e.id}">
                <div style="min-width:0;flex:1;">
                  <span class="tag" style="margin-right:6px;">${sourceTag(e)}</span>
                  <span class="companion-moment-text" style="white-space:normal;">${esc(e.title || "")}${e.source === "moment" && e.detail ? `<span class="text-muted"> — ${esc(e.detail)}</span>` : ""}</span>
                  <div class="text-faint" style="font-size:11px;margin-top:2px;">${esc(formatDate(new Date(e.at).toISOString().slice(0, 10)))}</div>
                </div>
                <button type="button" class="icon-btn" data-memory-delete="${e.id}" aria-label="${t("common.delete")}" style="width:28px;height:28px;flex:none;">${icon("trash", { size: 13 })}</button>
              </div>`
              )
              .join("")
          : `<div class="table-empty" style="padding:20px;">${t("companion.memory.empty")}</div>`
      }
      <div class="companion-moments" style="margin-top:18px;">
        <p class="companion-moments-title">${t("companion.memory.chatSection")}</p>
        <p class="text-muted" style="font-size:12.5px;margin:0 0 10px;">${t("companion.memory.chatNote", { n: msgCount })}</p>
        <button type="button" class="btn btn-secondary btn-sm" id="memory-clear-chat" ${msgCount ? "" : "disabled"}>${icon("trash", { size: 12 })}${t("companion.chat.clear")}</button>
      </div>
    `;
  };

  const overlay = openModal({
    title: t("companion.memory.title"),
    wide: true,
    bodyHTML: paintList(),
    footHTML: `<button type="button" class="btn btn-secondary" id="memory-clear-all">${icon("trash", { size: 13 })}${t("companion.memory.clearAll")}</button>`,
  });

  const wireBody = () => {
    qsa("[data-memory-delete]", overlay).forEach((btn) =>
      btn.addEventListener("click", () => {
        removeBrandLogEntry(brandId, btn.dataset.memoryDelete);
        overlay.querySelector(".modal-body").innerHTML = paintList();
        wireBody();
        refresh();
      })
    );
    overlay.querySelector("#memory-clear-chat")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: t("companion.chat.clearConfirm.title"),
        message: t("companion.chat.clearConfirm.body"),
        confirmLabel: t("companion.chat.clear"),
        danger: true,
      });
      if (!ok) return;
      const thread = getCompanionThread(brandId);
      if (thread) updateBrainstorm(thread.id, { messages: [] });
      overlay.querySelector(".modal-body").innerHTML = paintList();
      wireBody();
      refresh();
      toast(t("companion.chat.cleared"));
    });
  };
  wireBody();

  overlay.querySelector("#memory-clear-all")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("companion.memory.clearConfirm.title"),
      message: t("companion.memory.clearConfirm.body"),
      confirmLabel: t("companion.memory.clearAll"),
      danger: true,
    });
    if (!ok) return;
    clearBrandLog(brandId);
    closeOverlay(overlay);
    refresh();
    toast(t("companion.memory.cleared"));
  });
}

// The Teman Brand chat on its own, for the floating chat panel
// (js/consultant-panel.js). Same thread, same recap and moments as the Home
// widget — just without the page around it.
export function renderCompanionPane(root, { brandId, onNavigate = null, onBrainstorm = null }) {
  const state = {};
  // "Bahas di Brainstorm" buttons switch the panel's tab (with the seed
  // sentence) instead of navigating to the Brainstorm page.
  const grab = (e) => {
    const b = e.target.closest('[data-companion-go="brainstorm"]');
    if (!b || !onBrainstorm) return;
    e.stopPropagation();
    onBrainstorm(b.dataset.companionSeed || "");
  };
  root.addEventListener("click", grab, true);
  const refresh = () => {
    const brand = getBrand(brandId);
    if (!brand) return;
    const content = listContent(brandId);
    const campaigns = listCampaigns(brandId);
    const signals = computeSignals({ brand, content, campaigns, settings: getSettings() });
    const c = companionWidgetHTML(brand, { thread: getCompanionThread(brandId), signals, content, now: new Date(), state });
    root.innerHTML = `<div class="cp-companion">${c.extraHead ? `<div class="cp-companion-actions">${c.extraHead}</div>` : ""}${c.bodyHTML}</div>`;
    wireCompanion(root, { brandId, brand, content, signals, state, refresh });
    if (onNavigate) root.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener("click", onNavigate));
  };
  refresh();
  const off = onChange(refresh);
  return () => { off?.(); root.removeEventListener("click", grab, true); };
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const cfg = config();
  // Both one-shot flags consumed separately (not `||` short-circuited) so
  // either one left set still gets cleared even when both fire the same visit.
  const wholeBuilderJustCompleted = celebrateBuilderCompleteIfFlagged(brandId);
  const visualBasicsJustDone = consumeVisualBasicsJustDone(brandId);
  const identityJustDone = wholeBuilderJustCompleted || visualBasicsJustDone;
  if (consumeDnaJustCompleted(brandId)) toast(t("dna.celebrate.done"));

  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);
  const journey = buildSteps(brandId, brand, campaigns, content);
  const identityDone = journey.identityDone;
  const brandOverdue = listOverdueAndDueSoon().overdue.filter((x) => x.brand.id === brandId);
  const upNext = content
    .filter((c) => c.status === "scheduled")
    .sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999"))
    .slice(0, 5);
  const scheduleRows = scheduleRowsHTML(brandOverdue, upNext);
  const collapsed = new Set(brand.homeCollapsed || []);
  // Computed once per paint, reused by both the greeting/action buttons
  // below and — a beat later — the buildFullContext of anything the
  // Companion's own reply triggers (js/brand-pulse.js pulseTextFor).
  const signals = computeSignals({ brand, content, campaigns, settings: getSettings() });
  const companion = companionWidgetHTML(brand, { thread: getCompanionThread(brandId), signals, content, now: new Date(), state });
  const goal = goalWidget({ brandId, brand, campaigns, content, identityDone });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("home.eyebrow")}${helpButtonHTML("home")}${guideVideoButtonHTML("home")}</div>
        <h1>${esc(brand.name)}</h1>
        <p class="page-sub">${identityDone ? t("beginner.sub.allDone") : t("home.sub.identity")}</p>
      </div>
      ${avatarHTML(brand, "width:64px;height:64px;border-radius:16px;font-size:24px;flex:none;")}
    </div>

    ${identityDone ? todayHeroHTML(brandId, brand, campaigns, content) : identityHeroHTML(brandId, brand)}

    ${
      goal
        ? collapsed.has(goal.key)
          ? widgetCollapsedHTML(goal.key, goal.iconName, goal.title, goal.summary)
          : widgetCardHTML(goal.key, goal.iconName, goal.title, goal.bodyHTML, { extraHead: goal.extraHead })
        : ""
    }

    ${
      collapsed.has("companion")
        ? widgetCollapsedHTML("companion", "chat", t("home.companion.title"), companion.summary)
        : widgetCardHTML("companion", "chat", t("home.companion.title"), companion.bodyHTML, { extraHead: companion.extraHead })
    }

    ${stepsHTML(journey, cfg.lockNext, identityJustDone)}

    ${
      scheduleRows
        ? collapsed.has("todo")
          ? widgetCollapsedHTML("todo", "calendar", t("brandHome.upNext.title"), t("beginner.todo.summary", { count: Math.min(brandOverdue.length, 3) + upNext.length }))
          : widgetCardHTML("todo", "calendar", t("brandHome.upNext.title"), `<div class="card card-tight guided-checklist" style="margin-bottom:0;">${scheduleRows}</div>`, {
              extraHead: `<a class="link" href="#/brand/${brandId}/content/calendar">${t("brandHome.upNext.calendarLink")}</a>`,
            })
        : ""
    }

    ${cfg.analytics ? analyticsSectionHTML(content, getSettings(), state, `<button type="button" class="btn btn-secondary btn-sm" id="home-report">${icon("download", { size: 13 })}${t("home.report")}</button>`) : ""}
  `;

  wireHelpButtons(root);
  wireGoalCard(root, { brandId });
  wireWidgetToggle(root, { collapsedList: brand.homeCollapsed, save: (next) => updateBrand(brandId, { homeCollapsed: next }), refresh });
  if (!collapsed.has("companion")) wireCompanion(root, { brandId, brand, content, signals, state, refresh });
  if (cfg.analytics) {
    wireAnalyticsSection(root, state, refresh);
    qs("#home-report", root)?.addEventListener("click", () => openReportModal(brandId));
  }
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));

  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });
  qsa("[data-locked-step]", root).forEach((el) => {
    el.addEventListener("click", () => toast(t("home.next.lockedToast")));
  });

  // The exact moment Campaign/Konten unlock is the one time a small callout
  // on the hero is worth it, so the change of "what to do now" isn't missed.
  if (identityJustDone) {
    const hero = qs("#journey-hero", root);
    if (hero) showCalloutBubble(hero, t("beginner.callout.builderDone"));
  }
}

// ---- Hero ------------------------------------------------------------------

function progressRowHTML(label, filled, total, done) {
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return `
    <div class="identity-row ${done ? "is-done" : ""}">
      <span class="identity-row-icon">${icon(done ? "check" : "target", { size: 13 })}</span>
      <span class="identity-row-label">${esc(label)}</span>
      <span class="identity-row-bar"><span style="width:${pct}%"></span></span>
      <span class="identity-row-value">${done ? t("home.identity.done") : `${filled}/${total}`}</span>
    </div>`;
}

function identityHeroHTML(brandId, brand) {
  const dna = brandDnaCompleteness(brand.brandDNA);
  const dnaDone = brandDnaDone(brand);
  const basicsDone = visualBasicsDone(brand);
  const pro = getMode() === "advanced";
  const book = pro ? brandBookProgress(brand) : { filled: basicsDone ? 2 : 0, total: 2 };
  const cta = !dnaDone
    ? { label: dna.filled ? t("home.identity.ctaContinue") : t("home.identity.ctaStart"), href: `#/brand/${brandId}/dna` }
    : { label: t("home.identity.ctaBook"), href: `#/brand/${brandId}/guidelines/color` };
  return `
    <section class="card glass-card journey-hero" id="journey-hero">
      <div class="journey-hero-eyebrow">
        <span class="journey-hero-step">${t("beginner.hero.step", { n: 1, total: 3 })}</span>
        <span class="journey-hero-time">${icon("clock", { size: 12 })}${t("beginner.minutes", { n: 15 })}</span>
      </div>
      <h2>${t("home.identity.title")}</h2>
      <p>${t("home.identity.desc")}</p>
      <div class="identity-rows">
        ${progressRowHTML(t("home.identity.dna"), dna.filled, dna.total, dnaDone)}
        ${progressRowHTML(pro ? t("home.identity.book") : t("home.identity.bookBasics"), book.filled, book.total, pro ? book.filled === book.total : basicsDone)}
      </div>
      <a class="btn btn-primary journey-hero-cta" href="${cta.href}">${esc(cta.label)}${icon("arrowRight", { size: 15 })}</a>
      <div class="journey-hero-note">${t("beginner.hero.note")}</div>
    </section>
  `;
}

function todayHeroHTML(brandId, brand, campaigns, content) {
  const top = brandTopAction({ brand, campaigns, content, settings: getSettings() });
  let title, why, href, cta;
  if (top && top.action.cta.type !== "info") {
    const a = top.action;
    title = a.label;
    why = a.why;
    cta = a.cta.label || t("beginner.today.doIt");
    href = ctaHref(brandId, top.campaign, a.cta);
  } else if (top) {
    title = top.action.label;
    why = top.action.why;
    cta = "";
    href = "";
  } else if (!campaigns.length) {
    title = t("beginner.step.campaign.title");
    why = t("beginner.step.campaign.desc");
    cta = t("beginner.step.campaign.cta");
    href = `#/brand/${brandId}/campaigns`;
  } else if (!brand.brandGuidelines?.logo?.dataUrl) {
    // No campaign action right now — offer the next visual section one at
    // a time. Logo first: business cards and social templates need it.
    title = t("beginner.today.logo.title");
    why = t("beginner.today.logo.why");
    cta = t("beginner.today.logo.cta");
    href = `#/brand/${brandId}/guidelines/logo`;
  } else {
    title = t("beginner.today.fallbackTitle");
    why = t("beginner.today.fallbackWhy");
    cta = t("beginner.step.content.ctaWrite");
    href = `#/brand/${brandId}/content/creator`;
  }
  return `
    <section class="card glass-card journey-hero journey-hero-today" id="journey-hero">
      <div class="journey-hero-eyebrow"><span class="journey-hero-step">${t("beginner.today.eyebrow")}</span>${top ? `<span class="journey-hero-time">${icon("bulb", { size: 12 })}${esc(top.campaign.name || "Campaign")}</span>` : ""}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(why)}</p>
      ${cta && href ? `<a class="btn btn-primary journey-hero-cta" href="${href}">${esc(cta)}${icon("arrowRight", { size: 15 })}</a>` : ""}
    </section>
  `;
}

// next-action.js CTAs are routed by type; the campaign detail page owns the
// ones that need a modal (insights/manual/performance/brainstorm), so those
// land there — it highlights the matching row and button itself.
function ctaHref(brandId, campaign, cta) {
  switch (cta.type) {
    case "creator":
      return `#/brand/${brandId}/content/creator/${cta.contentId}`;
    case "new-content":
      return `#/brand/${brandId}/content/creator`;
    case "calendar":
      return `#/brand/${brandId}/content/calendar`;
    default:
      return `#/brand/${brandId}/campaigns/${campaign.id}`;
  }
}

// ---- Steps ---------------------------------------------------------------------

function stepsHTML(journey, lockNext, celebrateIdentity) {
  const total = journey.steps.length;
  const rows = journey.steps.map((s, i) => stepRowHTML(s, i, journey, lockNext, celebrateIdentity)).join("");
  if (journey.currentIndex === -1) {
    return `
      <details class="card glass-card card-tight journey journey-collapsed" id="beginner-journey">
        <summary>
          <span class="journey-summary-check">${icon("check", { size: 14 })}</span>
          <span class="t">${t("beginner.journey.collapsed", { done: journey.doneCount, total })}</span>
          <span class="m">${t("beginner.journey.viewEdit")}</span>
        </summary>
        <div class="journey-list">${rows}</div>
      </details>
    `;
  }
  return `
    <div class="section-title" style="margin-top:28px;">
      <h2>${t("home.next.title")}</h2>
      <span class="text-faint" style="font-size:12px;">${t("beginner.journey.count", { done: journey.doneCount, total })}</span>
    </div>
    <div class="card glass-card card-tight journey" id="beginner-journey">
      <div class="journey-list">${rows}</div>
    </div>
  `;
}

function stepRowHTML(s, i, journey, lockNext, celebrateIdentity) {
  // Pemula: steps after the identity step stay locked until it's done. Pro:
  // every step is open — "current" is just the first unfinished one.
  const locked = lockNext && s.key !== "identity" && !journey.identityDone;
  const state = s.done ? "done" : locked ? "upcoming" : i === journey.currentIndex ? "current" : "open";
  const celebrate = celebrateIdentity && s.key === "identity" ? " journey-step-celebrate" : "";
  const marker = s.done ? icon("check", { size: 13 }) : `<span>${i + 1}</span>`;
  const inner = `
    <span class="journey-marker">${marker}</span>
    <span class="journey-text">
      <span class="t">${esc(s.title)}</span>
      <span class="m">${s.done ? esc(s.doneNote || t("beginner.journey.done")) : locked ? t("beginner.journey.locked") : esc(s.desc)}</span>
    </span>
    ${s.done ? `<span class="journey-edit">${t("beginner.journey.edit")}${icon("arrowRight", { size: 12 })}</span>` : ""}
    ${!s.done && !locked ? `<span class="journey-edit journey-go">${esc(s.cta)}${icon("arrowRight", { size: 12 })}</span>` : ""}
    ${locked ? `<span class="journey-lock">${icon("lock", { size: 13 })}</span>` : ""}
  `;
  const href = s.done ? s.editHref : locked ? "" : s.href;
  const appAttr = s.app ? ` data-app="${s.app}"` : "";
  return href
    ? `<a class="journey-step journey-step-${state === "open" ? "current" : state}${celebrate}" href="${href}"${appAttr}>${inner}</a>`
    : `<div class="journey-step journey-step-upcoming" data-locked-step${appAttr}>${inner}</div>`;
}

// ---- Schedule ------------------------------------------------------------------

function scheduleRowsHTML(overdue, upNext) {
  const rows = [];
  overdue.slice(0, 3).forEach((x) => {
    rows.push(`
      <div class="top-content-row" data-open-content="${x.content.id}" style="cursor:pointer;">
        <div class="ti">
          <div class="t">${esc(x.content.title || t("beginner.untitled"))}</div>
          <div class="m" style="color:var(--health-poor);">${t("beginner.todo.overdue", { date: formatDate(x.content.scheduleDate) })}</div>
        </div>
        <span class="tag" style="background:var(--health-poor-soft);color:var(--health-poor);">${t("beginner.todo.late")}</span>
      </div>
    `);
  });
  upNext.forEach((c) => {
    rows.push(`
      <div class="top-content-row" data-open-content="${c.id}" style="cursor:pointer;">
        <div class="ti">
          <div class="t">${esc(c.title || t("beginner.untitled"))}</div>
          <div class="m">${c.platform || "—"} · ${formatDate(c.scheduleDate)}</div>
        </div>
        <span class="tag tag-${(c.funnel || "").toLowerCase()}">${funnelLabel(c.funnel)}</span>
      </div>
    `);
  });
  return rows.join("");
}
