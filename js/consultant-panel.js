// "Tanya Brandlab" — THE chat of the app. One component per brand, shown at
// two sizes by this one module:
//
//   • small  — the floating panel behind the round chat button, on every
//              page inside a brand (mounted into document.body by
//              js/layout.js's wireShell, so it survives page changes).
//   • page   — its own page, "Tanya Brandlab" (#/brand/:id/chat[/:id],
//              js/views/chat.js is only its frame): the same chat with its
//              conversations on the left and what it saved (ideas, brand
//              memory) on the right. "Perbesar" in the small panel opens
//              it; "Kecilkan" goes back.
//
// Inside are THREE TABS, each its own conversation with its own log and its
// own kind of result — never one mixed transcript:
//
//   • Konsultan  — askBrandConsultant: real-time advice from THIS brand's
//                  live data. Its log is one rolling thread per brand
//                  (brainstorms/ mode "consult") so the same conversation
//                  is there on the phone, but it writes nothing else: no
//                  ideas, no drafts, no memory. Points at screens ([[goto]]).
//   • Brainstorm — chatBrainstorm: content ideas. Many threads, each
//                  optionally about a campaign, series, goal or piece of
//                  content; idea cards save to the idea list or become
//                  drafts in Creator. On the page: the thread list on the
//                  left, saved ideas on the right.
//   • Teman      — companionChat: the owner tells it what is happening to
//                  the brand. One rolling thread per brand (mode
//                  "companion"). Whatever matters becomes a MOMENT the
//                  owner approves (a card right after the message, or a
//                  recap of several) and enters brand memory
//                  (brand.developmentLog → js/brand-pulse.js), which every
//                  other AI feature reads when it writes scripts, copy or
//                  plans. The brand changes; this is how the AI keeps up.
//
// OTOMATIS is the default view, and in Pemula mode the only one the owner
// ever sees: one box, no modes to choose. Each message is routed to the
// right engine (free keyword rules first, then one tiny model call) and is
// still written to THAT engine's own log, so the three logs never mix; the
// Otomatis view shows them merged by time, one "Obrolan" (session,
// brand.chatSessions) at a time — every message carries its sessionId.
// The AI steers the saving: it offers "Simpan ke Tersimpan?" for an idea
// the owner liked and "Catat ke Memori Brand?" for something that happened;
// the owner only taps. "Bukan ini maksudmu?"
// moves a misrouted question to another engine. In Pro mode a row of
// Otomatis / Konsultan / Brainstorm / Teman lets the owner open one log on
// its own; there a one-line chip offers another tab when a message clearly
// belongs there (keyword rules, or the model's [[handoff:…]]).
import { t, getLang } from "./i18n.js";
import {
  getBrand, getSettings, listContent, listCampaigns, listOverdueAndDueSoon, createContent, addBrandIdea, updateBrand, updateBrandIdea, removeBrandIdea, listBrandIdeas, localISODate,
  listBrainstorms, getBrainstorm, createBrainstorm, appendBrainstormMessage, updateBrainstormMessage, removeBrainstormMessage, updateBrainstorm, deleteBrainstorm,
  getCompanionThread, ensureCompanionThread, getConsultThread, ensureConsultThread, ROLLING_THREAD_MODES, addBrandMoments, removeBrandLogEntry, MOMENT_KINDS, MOMENT_ACTIONS,
  getCampaign, updateCampaign, getContent, updateContent, getSeries, listSeries, findSeriesByNameInText, getGoal, listGoals, formatEventDate, phaseNameLabel, onChange,
} from "./store.js";
import { eventCampaignFor, openEventPhases, addEventMilestone } from "./goal-actions.js";
import { aiLimitReached, aiQuotaPeriod } from "./ai-usage.js";
import { isAdmin, currentUid, getCachedAccount, isReadOnly } from "./account.js";
import { confirmDialog, openModal, closeOverlay } from "./modals.js";
import { campaignStages, activeStageIndex, readStage, campaignHeadline } from "./campaign-metrics.js";
import { nextActions } from "./next-action.js";
import { computeContentMetrics } from "./formulas.js";
import { brandDnaCompleteness } from "./brand-progress.js";
import { askBrandConsultant, chatBrainstorm, companionChat, recapCompanion, classifyChatIntent, summarizeConcept, generateWeekPlan, discussScript, buildSeriesOverview, seriesEpisodeTitles, hasAiKey, aiCanSeeImages, AiApiError } from "./ai.js";
import { addDays, weekdayOf } from "./goal-roadmap.js";
import { planWeek, normalizePlanItems, activeCampaignsFor, defaultWeeklyCount, currentPlanEntry, seriesDays, seriesForDate, missingEpisodes } from "./week-plan.js";
import { analyzeScreenshot } from "./ocr.js";
import { mergeInsightsIntoPerformance, retentionSnapshotText } from "./retention.js";
import { getMode } from "./mode.js";
import { pulseTextFor, computeSignals, topSignal } from "./brand-pulse.js";
import { parseDirectives, renderLightMarkdown } from "./ai-directives.js";
import { openBrandMemoryModal, validateRecap, unrecappedMessages, savedMoments, momentKindLabel, saveMemoryText, isInMemory, memoryAddFormHTML, wireMemoryAddForm, memoryDiffHTML } from "./brand-memory.js";
import { go } from "./nav-context.js";
import { icon } from "./icons.js";
import { qs, escapeHtml, formatPercent, formatDate, toast, openMenu, closeMenu, resizeImageFile, thumbnailFromDataUrl } from "./dom.js";
import { mountAiFeedback } from "./ai-feedback.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { wireMic } from "./voice-input.js";
import { funnelShort } from "./funnel-field.js";

export const MODES = ["consultant", "brainstorm", "companion"];
const VIEWS = ["auto", ...MODES];
const MODE_ICON = { auto: "chat", consultant: "bot", brainstorm: "bulb", companion: "heart" };
const DEFAULT_MODE = "auto";
const AUTO_VIEW_MAX = 60; // messages the merged Otomatis view shows
const SHORT_FOLLOW_UP = 25; // "iya", "yang kedua": stays with the last engine
// Pemula mode never shows the mode row: one box, Otomatis.
const isGuided = () => getMode() !== "advanced";
const HISTORY_FOR_MODEL = 12;
const COMPANION_HISTORY_FOR_MODEL = 16;
const THREAD_TITLE_MAX = 60;
const MEMORY_ASIDE_LIMIT = 8;
const SESSIONS_CAP = 40;
const SESSIONS_MENU_LIMIT = 8;
const esc = escapeHtml;

// ---- State ------------------------------------------------------------------
//
// Per brand, shared by both sizes — the small panel and the page are the
// same conversations, never two copies.

// brandId -> the view that is open ("auto" or one engine's log).
const activeMode = new Map();
// Every transcript is read straight from the stored threads at render time
// (see historyFor), so two devices — the laptop and the phone — always
// agree. brandId -> the Brainstorm thread Brainstorm messages go to.
const brainstormThread = new Map();
// brandId -> engine a starter chip ("Hari ini ada yang beli…") picked for
// the message being typed in Otomatis.
const seedEngine = new Map();
// brandId -> the open Obrolan of the Otomatis view: a session id, or null
// for "Obrolan baru" (the session is made by its first message). Absent =
// the most recent one.
const currentSession = new Map();
const restored = new Set();
// brandId -> scope picked before the thread exists ({ campaignId, stageId,
// contentId, goalId, seriesId }). Once the first Brainstorm message makes the
// thread, the thread carries the scope.
const pendingScope = new Map();
// "brandId:view" -> entries that are shown but never stored: the question
// while its engine is being picked, an error bubble. Cleared on the next
// message.
const tails = new Map();
// brandId -> { mode, to, question }: "this looks like a job for another
// tab", shown once under the newest reply of that tab.
const hints = new Map();

// Mirrored to localStorage per brand, so a reload (or tomorrow, same
// browser) opens the same view and the same Brainstorm conversation. The
// messages themselves live in Firestore threads.
const CHAT_KEY = (brandId) => `brandlab:chat:${brandId}`;
function persistChat(brandId) {
  try {
    localStorage.setItem(CHAT_KEY(brandId), JSON.stringify({ v: 3, mode: activeMode.get(brandId) || null, threadId: brainstormThread.get(brandId) || null, session: currentSession.has(brandId) ? currentSession.get(brandId) : undefined, scope: pendingScope.get(brandId) || null, at: Date.now() }));
  } catch { /* private mode / quota */ }
}
function restoreChat(brandId) {
  if (restored.has(brandId)) return;
  restored.add(brandId);
  try {
    const s = JSON.parse(localStorage.getItem(CHAT_KEY(brandId)) || "null");
    if (!s) return;
    // Before v3 the tabs had no Otomatis; start everyone on it once.
    if (s.v === 3 && VIEWS.includes(s.mode)) activeMode.set(brandId, s.mode);
    // The thread may not have arrived from Firestore yet; kept as an id.
    if (s.threadId) brainstormThread.set(brandId, s.threadId);
    if (s.session !== undefined) currentSession.set(brandId, s.session);
    if (s.scope && typeof s.scope === "object") pendingScope.set(brandId, s.scope);
  } catch { /* corrupt entry: start clean */ }
}

const modeOf = (brandId) => activeMode.get(brandId) || DEFAULT_MODE;
function setMode(brandId, mode) {
  if (!VIEWS.includes(mode) || modeOf(brandId) === mode) return;
  activeMode.set(brandId, mode);
  noKeyNotice = false;
  answerHint = false;
  renderedCount = -1;
}

// Where the chat is drawn right now: the page when it is open, else the
// floating panel. Only one of them holds the chat's DOM at a time.
let mountedBrandId = null; // brand of the floating panel
let isOpen = false; // floating panel open
let page = null; // { el, brandId, wantThread, off }
let panelOff = null; // small panel's store subscription while open
let expandedFrom = ""; // the hash "Perbesar" left from — "Kecilkan" goes back there
let expanding = false; // the page is opening because of "Perbesar"
let reopenSmall = false; // "Kecilkan": reopen the panel once the page is gone
let ideasFocus = false; // page: saved ideas blown up into a focused view
let flashIdeas = false; // page: light up the saved ideas after a save
let carryDraft = ""; // typed text carried across a size switch / navigation
// Screenshots attached to the message being typed (an insight page, a
// retention graph): the full image goes to the model once, in memory only;
// the thumbnail is what the sent bubble keeps. brandId -> [{ full, thumb }]
const attachments = new Map();
const MAX_IMAGES = 3;
let answerHint = false; // "Jawab dulu": placeholder asks for their answer
let pending = false;
let noKeyNotice = false; // "AI belum diatur" shown inside the chat
let streamShown = ""; // the answer so far, kept across a re-render mid-answer
let renderedCount = -1; // messages drawn last time (new one => scroll down)
let lastHTML = ""; // chat markup drawn last time (a store sync that changes nothing skips the redraw)
let syncTimer = null;

// A store sync (any Firestore snapshot, even one about another brand)
// used to redraw the whole chat via innerHTML. On a phone that kills the
// scroll gesture in progress, and when the reader was near the bottom it
// yanked them straight back down, so the chat read as "won't scroll".
// Syncs now wait while a finger is on the transcript or it is still
// moving, and redraw only when the markup actually changed.
let touching = false;
let scrollingUntil = 0;
const inChat = (el) => !!el?.closest?.("#consultant-messages");
document.addEventListener("touchstart", (e) => { if (inChat(e.target)) touching = true; }, { capture: true, passive: true });
const touchOff = () => { if (touching) { touching = false; scrollingUntil = Date.now() + 700; } };
document.addEventListener("touchend", touchOff, { capture: true, passive: true });
document.addEventListener("touchcancel", touchOff, { capture: true, passive: true });
document.addEventListener("scroll", (e) => { if (e.target?.id === "consultant-messages") scrollingUntil = Math.max(scrollingUntil, Date.now() + 250); }, { capture: true, passive: true });

function syncRender(brandId, ok) {
  clearTimeout(syncTimer);
  const wait = scrollingUntil - Date.now();
  if (touching || wait > 0) { syncTimer = setTimeout(() => syncRender(brandId, ok), Math.max(wait, 150)); return; }
  if (ok()) renderPanel(brandId, { sync: true });
}
let docKeydown = null;

const hostBrand = () => (page ? page.brandId : isOpen ? mountedBrandId : null);
const isTouch = () => window.matchMedia?.("(pointer: coarse)").matches;

// ---- Scope (Brainstorm) -------------------------------------------------------

const EMPTY_SCOPE = { campaignId: null, stageId: null, contentId: null, goalId: null, seriesId: null };
// ---- Obrolan (sessions of the Otomatis view) ----------------------------------
//
// brand.chatSessions = [{ id, title, createdAt, updatedAt, threadId }]:
// small, capped, on the brand doc so the phone lists the same ones.
// `threadId` is the session's own Brainstorm thread (made the first time a
// message of it goes to Brainstorm), so ideas stay with their conversation.
const sessionUid = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export function listSessions(brandId) {
  return [...(getBrand(brandId)?.chatSessions || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
const getSession = (brandId, id) => (id ? (getBrand(brandId)?.chatSessions || []).find((x) => x.id === id) || null : null);
function currentSessionOf(brandId) {
  if (currentSession.has(brandId)) return getSession(brandId, currentSession.get(brandId));
  return listSessions(brandId)[0] || null;
}
function patchSession(brandId, id, patch) {
  const list = getBrand(brandId)?.chatSessions || [];
  updateBrand(brandId, { chatSessions: list.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}
// The open session, or a new one named after its first message.
function ensureSession(brandId, title) {
  const cur = currentSessionOf(brandId);
  if (cur) { patchSession(brandId, cur.id, { updatedAt: Date.now() }); return cur; }
  const now = Date.now();
  const sess = { id: sessionUid(), title: String(title || "").slice(0, THREAD_TITLE_MAX), createdAt: now, updatedAt: now, threadId: null };
  const list = [...(getBrand(brandId)?.chatSessions || []), sess].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, SESSIONS_CAP);
  updateBrand(brandId, { chatSessions: list });
  currentSession.set(brandId, sess.id);
  return sess;
}
// Deleting an Obrolan takes its messages out of every log it wrote to and
// its Brainstorm thread with it. Saved ideas and brand memory stay.
function deleteSession(brandId, id) {
  const sess = getSession(brandId, id);
  [getConsultThread(brandId), getCompanionThread(brandId)].forEach((th) => {
    if (th && (th.messages || []).some((m) => m.sessionId === id)) updateBrainstorm(th.id, { messages: th.messages.filter((m) => m.sessionId !== id) });
  });
  if (sess?.threadId) deleteBrainstorm(sess.threadId);
  updateBrand(brandId, { chatSessions: (getBrand(brandId)?.chatSessions || []).filter((x) => x.id !== id) });
  if (currentSessionOf(brandId)?.id === id || currentSession.get(brandId) === id) currentSession.set(brandId, null);
}

// The Brainstorm thread in play: the open Obrolan's in Otomatis, the one
// picked in the Brainstorm log otherwise.
function currentThread(brandId) {
  if (modeOf(brandId) === "auto") {
    const id = currentSessionOf(brandId)?.threadId;
    return id ? getBrainstorm(id) : null;
  }
  return brainstormThread.get(brandId) ? getBrainstorm(brainstormThread.get(brandId)) : null;
}
const threadScope = (th) => ({ campaignId: th.campaignId || null, stageId: th.stageId || null, contentId: th.contentId || null, goalId: th.goalId || null, seriesId: th.seriesId || null });
const hasScope = (s) => !!(s && (s.campaignId || s.contentId || s.goalId || s.seriesId));
function activeScope(brandId) {
  const th = currentThread(brandId);
  return th ? threadScope(th) : { ...EMPTY_SCOPE, ...(pendingScope.get(brandId) || {}) };
}

// Everything the AI and the cards need to know about a scope.
export function scopeInfo(brandId, scope) {
  const goal = scope.goalId ? getGoal(brandId, scope.goalId) : null;
  // A goal's conversation reads its Event campaign too, so the countdown and
  // phases ride along in the prompt.
  const campaign = scope.campaignId ? getCampaign(scope.campaignId) : goal?.installed?.campaigns?.event?.id ? getCampaign(goal.installed.campaigns.event.id) : null;
  const content = scope.contentId ? getContent(scope.contentId) : null;
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
export const chatScopeInfo = (brandId) => scopeInfo(brandId, activeScope(brandId));

// Saved ideas follow the scope: a campaign (or goal) conversation reads and
// writes that campaign's slice of the one ideas inbox (brand.ideas — see
// listBrandIdeas), everything else the brand-level slice.
function savedIdeasFor(brandId) {
  const camp = chatScopeInfo(brandId).campaign;
  return { camp, items: listBrandIdeas(brandId, { campaignId: camp?.id || null }) };
}
function saveIdeaScoped(brandId, { title, why = "", notes = "", hooks = null }) {
  const th = currentThread(brandId);
  const { camp } = savedIdeasFor(brandId);
  const extra = { ...(notes ? { notes } : {}), ...(hooks ? { hooks } : {}) };
  addBrandIdea(brandId, { text: title, description: why, source: "chat", campaignId: camp?.id || null, ...extra, threadId: th?.id || null });
}
function patchSavedScoped(brandId, id, patch) {
  updateBrandIdea(brandId, id, patch);
}
function removeSavedScoped(brandId, id) {
  removeBrandIdea(brandId, id);
}
// A draft made from this conversation lands where the conversation is:
// the campaign (and its current phase), the series.
// Opened from an empty series day in the Calendar: the first draft of that
// series lands on that date (once — the next one is undated as usual).
const episodeDate = new Map(); // seriesId -> ISO date
function draftFromScope(brandId, { title, idea = "", funnel = "TOFU", notes = "" }) {
  const info = chatScopeInfo(brandId);
  const date = info.series ? episodeDate.get(info.series.id) : "";
  if (date) episodeDate.delete(info.series.id);
  return createContent(brandId, {
    ...(date && date >= localISODate() ? { scheduleDate: date } : {}),
    title, funnel, idea, status: "idea", ...(notes ? { notes } : {}),
    campaignId: info.campaign?.id || "",
    campaignPhaseId: info.stage && info.stage.kind !== "level" ? info.stage.id : "",
    seriesId: info.series?.id || "",
  });
}

// A clean Brainstorm conversation, optionally about something (a campaign,
// a saved idea's campaign…). The old thread stays in the list. In Otomatis
// it is a new Obrolan (made by its first message); the old one stays listed.
function startConversation(brandId, { scope = null, auto = modeOf(brandId) === "auto" } = {}) {
  if (auto) currentSession.set(brandId, null);
  else brainstormThread.delete(brandId);
  if (hasScope(scope)) pendingScope.set(brandId, { ...EMPTY_SCOPE, ...scope });
  else pendingScope.delete(brandId);
  hints.delete(brandId);
  noKeyNotice = false;
  answerHint = false;
}

// ---- The three transcripts ----------------------------------------------------

const tailKey = (brandId, mode) => `${brandId}:${mode}`;
const rollingThread = (brandId, mode) => (mode === "consultant" ? getConsultThread(brandId) : mode === "companion" ? getCompanionThread(brandId) : null);

// A stored thread's messages as transcript entries. The blocks a message
// carries (cards, buttons) come back exactly as saved, so a moment already
// filed or an idea already drafted is never offered twice.
function threadEntries(th, engine) {
  const out = [];
  let lastQuestion = "";
  let lastQuestionId = null;
  (th?.messages || []).forEach((m) => {
    if (m.role === "user") {
      lastQuestion = m.text;
      lastQuestionId = m.id;
      out.push({ role: "user", text: m.text, images: m.blocks?.images || [], msgId: m.id, threadId: th.id, at: m.at, sessionId: m.sessionId || null, engine: engine === "companion" ? "companion" : undefined, deletable: engine === "companion" });
      return;
    }
    const b = m.blocks || {};
    out.push({
      role: "assistant", engine, text: m.text || "", at: m.at,
      nav: b.nav || [], drafts: b.drafts || [], asks: b.asks || [], ideas: b.ideas || [], tasks: b.tasks || [], revisions: b.revisions || [],
      moments: b.moments || [], saves: b.saves || [], scripts: b.scripts || [], recap: b.recap || null, handoff: b.handoff || null, metrics: b.metrics || null,
      weekPlan: b.weekPlan || null, planTalk: !!b.planTalk, sessionId: m.sessionId || null,
      question: lastQuestion, questionId: lastQuestionId, threadId: th.id, msgId: m.id, rated: !!m.rated,
    });
  });
  return out;
}

const dayKey = (ms) => localISODate(new Date(ms));
function dayLabel(iso, todayIso) {
  if (iso === todayIso) return t("companion.day.today");
  const y = new Date(todayIso + "T00:00:00");
  y.setDate(y.getDate() - 1);
  if (iso === localISODate(y)) return t("companion.day.yesterday");
  return formatDate(iso);
}
function greetingSentence(brand, now) {
  const h = now.getHours();
  const key = h < 11 ? "companion.greeting.morning" : h < 17 ? "companion.greeting.afternoon" : "companion.greeting.evening";
  return t(key, { brand: esc(brand.name) });
}
function signalsNow(brandId) {
  return computeSignals({ brand: getBrand(brandId), content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
}
// "Hey, what happened today?" plus the single most notable auto signal —
// deterministic, never stored, gone once the owner has said something today.
function companionGreeting(brandId, now = new Date()) {
  const brand = getBrand(brandId);
  const top = topSignal(signalsNow(brandId));
  return `${greetingSentence(brand, now)} ${esc(top ? top.title : t("companion.observation.quiet"))}`;
}

// The Teman transcript is a diary: messages under day headings, today's
// greeting when nothing has been said yet, and — when there is un-recapped
// chat from before today — the offer to recap it, so nothing the owner
// told the Teman is left out of brand memory by accident.
function companionEntries(brandId, th) {
  const entries = threadEntries(th, "companion");
  if (!entries.length) return entries; // the empty state greets instead
  const now = new Date();
  const todayIso = localISODate(now);
  const out = [];
  let day = "";
  entries.forEach((e) => {
    const d = dayKey(e.at || Date.now());
    if (d !== day) { day = d; out.push({ role: "day", label: dayLabel(d, todayIso) }); }
    out.push(e);
  });
  const brand = getBrand(brandId);
  const saidToday = entries.some((e) => e.role === "user" && dayKey(e.at || 0) === todayIso);
  if (day !== todayIso && (brand.companion?.lastAskedAt !== todayIso || unrecappedMessages(brandId).some((m) => m.role === "user"))) out.push({ role: "day", label: dayLabel(todayIso, todayIso) });
  if (brand.companion?.lastAskedAt !== todayIso) out.push({ role: "assistant", engine: "companion", text: companionGreeting(brandId, now), ephemeral: true });
  const unrecapped = unrecappedMessages(brandId).filter((m) => m.role === "user").length;
  if (unrecapped && !saidToday && !pending) out.push({ role: "assistant", engine: "companion", text: t("companion.recap.nudge", { n: unrecapped }), nudge: unrecapped, ephemeral: true });
  return out;
}

// Otomatis: one Obrolan's messages from the three logs, merged by time —
// its Konsultan and Teman messages (by sessionId) plus its own Brainstorm
// thread. Each message is still stored only in its own log.
function autoEntries(brandId) {
  const sess = currentSessionOf(brandId);
  if (!sess) return [];
  const mine = (e) => e.sessionId === sess.id;
  const all = [
    ...threadEntries(getConsultThread(brandId), "consultant").filter(mine),
    ...threadEntries(getCompanionThread(brandId), "companion").filter(mine),
    ...threadEntries(sess.threadId ? getBrainstorm(sess.threadId) : null, "brainstorm"),
  ];
  // Stable sort: a question and its answer share a thread, so ties keep
  // their order.
  return all.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-AUTO_VIEW_MAX);
}

// The transcript of one view, read from the stored threads, plus any
// un-stored tail (a question still being routed, an error bubble).
function historyFor(brandId, mode = modeOf(brandId)) {
  let base;
  if (mode === "auto") base = autoEntries(brandId);
  else if (mode === "brainstorm") base = threadEntries(currentThread(brandId), "brainstorm");
  else if (mode === "companion") base = companionEntries(brandId, getCompanionThread(brandId));
  else base = threadEntries(getConsultThread(brandId), "consultant");
  return [...base, ...(tails.get(tailKey(brandId, mode)) || [])];
}
const hasMessages = (brandId, mode = modeOf(brandId)) => historyFor(brandId, mode).some((h) => h.role !== "day" && !h.ephemeral);

// ---- "This belongs to another tab" ---------------------------------------------

// Word-boundary keyword rules, Indonesian + English — free, no model call.
// They used to route every message; now they only power the hint chip
// under a reply when the message clearly reads like another tab's job.
// Teman wins when it matches at all (feelings first); Brainstorm and
// Konsultan only decide when exactly one of them matches.
const RULES = {
  companion: /\b(capek|cape|lelah|males|malas|bosan|bosen|stres|stress|pusing|semangat|takut|khawatir|nyerah|menyerah|sedih|senang|seneng|curhat|kesel|kesal|overwhelmed|tired|burnout|exhausted|frustrated|nggak tahu mulai|gak tau mulai|bingung mulai|cerita|tadi ada|barusan|hari ini ada)\b/i,
  brainstorm: /\b(ide|idea|ideas|brainstorm|inspirasi|konten apa|bikin apa|posting apa|post apa|topik|angle|hook|mentok|buntu|stuck|kasih ide|script|scriptnya|skrip|naskah|narasi|voice ?over)\b/i,
  consultant: /\b(performa|performance|engagement|data|angka|statistik|follower|followers|reach|views|campaign|jadwal|schedule|kalender|calendar|overdue|level|milestone|strategi|strategy|analisa|analisis|berapa|how many|kenapa konten|why is|di mana|dimana|gimana caranya|cara|benchmark|target)\b/i,
};
const HINT_MIN_LENGTH = 25; // a short follow-up ("iya", "yang kedua") is never a hint

function routeByRules(text) {
  if (RULES.companion.test(text)) return "companion";
  const idea = RULES.brainstorm.test(text);
  const data = RULES.consultant.test(text);
  if (idea && !data) return "brainstorm";
  if (data && !idea) return "consultant";
  return null;
}

function lastEngine(history) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "assistant" && history[i].engine && !history[i].ephemeral) return history[i].engine;
  return "";
}

// Otomatis: obvious keywords first (free), a short follow-up stays with
// whoever answered last, else one tiny uncounted model call.
async function decideEngine(ai, text, history) {
  const byRules = routeByRules(text);
  if (byRules) return byRules;
  const prev = lastEngine(history);
  if (prev && text.length < SHORT_FOLLOW_UP) return prev;
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
    retentionSnapshotText(published),
    campaigns.length ? `Campaign aktif:\n${coverageLines.join("\n")}` : "Belum ada campaign aktif.",
  ].join("\n");
}

// What the model should read as "the conversation so far". In Otomatis
// that is the Obrolan on screen — whichever engine answered each turn — so
// a follow-up to a Brainstorm answer still makes sense to the Konsultan.
// In a single log it is that log. `lastId` is the question just stored.
function historyForModel(brandId, cur, logMessages, lastId, max = HISTORY_FOR_MODEL) {
  const rows = cur === "auto"
    ? autoEntries(brandId).filter((e) => (e.role === "user" || e.role === "assistant") && e.text && e.msgId !== lastId)
    : logMessages.filter((m) => m.text && m.id !== lastId).map((m) => ({ role: m.role, text: m.text, ...(m.blocks || {}) }));
  // The cards are part of what the owner saw: "yang pertama" means the
  // first idea card, so their titles ride along with the reply's text.
  const withCards = (m) => {
    const cards = [...(m.ideas || []), ...(m.saves || [])].map((x, i) => `${i + 1}. ${x.title}`);
    return cards.length ? `${m.text}\n${cards.join("\n")}` : m.text;
  };
  return rows.slice(-max).map((m) => ({ role: m.role, text: m.role === "assistant" ? withCards(m) : m.text }));
}

// A destination button must be about what the answer talks about: a
// campaign button only for a campaign that exists and is named in the text.
const campaignOfNav = (n) => (n?.key?.startsWith("campaign:") ? getCampaign(n.key.slice(9)) : null);
function relevantNav(nav, text) {
  const lower = String(text || "").toLowerCase();
  return (nav || []).filter((n) => {
    if (!n?.key?.startsWith("campaign:")) return true;
    const c = campaignOfNav(n);
    return !!c && !!c.name && lower.includes(c.name.toLowerCase());
  });
}

// Every engine reads the pulse, so the series days ride along here: the
// weekly pairing plus which of the next 7 days still lack their episode.
function pulseNow(brandId) {
  const brand = getBrand(brandId);
  const content = listContent(brandId);
  const pulse = pulseTextFor(brand, { content, campaigns: listCampaigns(brandId), settings: getSettings() });
  const days = seriesDays(brand?.contentCadence, listSeries(brandId));
  if (!days.size) return pulse;
  const today = localISODate();
  const missing = missingEpisodes(days, content, { start: today, end: addDays(today, 6), todayISO: today });
  const line = [
    `Series schedule (Work Schedule): ${[...days].map(([d, s]) => `${WEEKDAY_NAME[d]} = "${s.name}"`).join(", ")}.`,
    missing.length ? `Coming series days with no episode yet: ${missing.map((m) => `${m.date} (${WEEKDAY_NAME[weekdayOf(m.date)]}) "${m.series.name}"`).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return [pulse, line].filter(Boolean).join("\n");
}
const WEEKDAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

// ---- Message rendering ----------------------------------------------------

const starterChip = (q, mode = "") => `<button type="button" class="consultant-starter" data-chat-ask="${esc(q)}" ${mode ? `data-chat-engine="${mode}"` : ""}>${esc(q)}</button>`;

// An idea offered in the chat. "Pakai ini" makes a draft right here, "Buatkan
// script" makes one and opens Creator's AI writer, "Simpan" keeps it in the
// saved ideas. In a conversation about one piece of content, the idea goes
// into that content instead.
function ideaCardHTML(idea, ref, info, full) {
  let use;
  if (idea.contentId) use = `<a class="btn btn-primary btn-sm" href="#/brand/__BRAND__/content/creator/${esc(idea.contentId)}">${icon("check", { size: 12 })}${t("bs.idea.openDraft")}</a>`;
  else if (idea.usedHere) use = `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.idea.usedHere")}</span>`;
  else if (info.content) use = `<button type="button" class="btn btn-primary btn-sm" data-chat-idea-use="${ref}">${icon("check", { size: 12 })}${t("bs.idea.useHere")}</button>`;
  else use = `<button type="button" class="btn btn-primary btn-sm" data-chat-idea-draft="${ref}">${icon("check", { size: 12 })}${t("bs.idea.use")}</button><button type="button" class="btn btn-secondary btn-sm" data-chat-idea-script="${ref}" title="${esc(t("bs.idea.scriptTitle"))}">${icon("bot", { size: 12 })}${t("bs.idea.script")}</button>`;
  const save = idea.saved
    ? full
      ? `<button type="button" class="bs-done bs-see-saved" data-chat-see-saved>${icon("check", { size: 12 })} ${t("bs.idea.savedSee")}</button>`
      : `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.idea.saved")}</span>`
    : `<button type="button" class="btn btn-secondary btn-sm" data-chat-idea-save="${ref}">${icon("bookmark", { size: 12 })}${t("bs.idea.save")}</button>`;
  return `
    <div class="cp-idea">
      <div class="cp-idea-title">${esc(idea.title)}</div>
      ${idea.why ? `<div class="cp-idea-why">${esc(idea.why)}</div>` : ""}
      <div class="cp-idea-actions">${use}${save}</div>
    </div>`;
}

// A real-world step for an event ("find 6 alumni") — it goes to a milestone of
// the Event campaign, in the phase the owner picks, not to a content draft.
function taskCardHTML(task, ref) {
  const camp = task.campaignId ? getCampaign(task.campaignId) : null;
  const phases = camp ? openEventPhases(camp) : [];
  const want = (task.phase || "").toLowerCase();
  const pick = phases.find((p) => p.name.toLowerCase() === want)?.id || phases[0]?.id || "";
  const target = task.target ? t("bs.task.target", { n: task.target, unit: task.unit || "" }).trim() : t("bs.task.check");
  let actions;
  if (task.added) actions = `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.task.added", { phase: esc(task.phaseName || "") })}</span><a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/campaigns/${esc(task.campaignId || "")}">${t("bs.task.open")}</a>`;
  else if (!phases.length) actions = `<span class="text-faint" style="font-size:12px;">${t("bs.task.noPhase")}</span>`;
  else actions = `<select class="input bs-task-phase" data-chat-task-phase="${ref}" aria-label="${t("bs.task.phase")}">${phases.map((p) => `<option value="${esc(p.id)}" ${p.id === pick ? "selected" : ""}>${esc(phaseNameLabel(p.name))} · ${esc(formatEventDate(p.dateFrom))}–${esc(formatEventDate(p.dateTo))}</option>`).join("")}</select>
      <button type="button" class="btn btn-primary btn-sm" data-chat-task-add="${ref}">${icon("check", { size: 12 })}${t("bs.task.add")}</button>
      ${task.saved ? `<span class="bs-done">${icon("check", { size: 12 })} ${t("bs.idea.saved")}</span>` : `<button type="button" class="btn btn-secondary btn-sm" data-chat-task-save="${ref}">${icon("bookmark", { size: 12 })}${t("bs.idea.save")}</button>`}`;
  return `
    <div class="cp-idea bs-task">
      <div class="bs-task-tag">${icon("target", { size: 11 })}${t("bs.task.tag")}</div>
      <div class="cp-idea-title">${esc(task.title)}</div>
      ${task.why ? `<div class="cp-idea-why">${esc(task.why)}</div>` : ""}
      <div class="bs-task-target">${esc(target)}</div>
      <div class="cp-idea-actions">${actions}</div>
    </div>`;
}

// Something the owner just told the Teman that happened to the brand — one
// tap puts it in brand memory, where every AI feature reads it from then
// on. "Jadikan konten" hands it to Brainstorm as a seed.
function momentCardHTML(m, ref) {
  let actions;
  if (m.saved) actions = `<span class="bs-done">${icon("check", { size: 12 })} ${t("chat.moment.saved")}</span><button type="button" class="btn btn-secondary btn-sm" data-chat-moment-bs="${ref}">${icon("bulb", { size: 12 })}${t("chat.moment.brainstorm")}</button>`;
  else if (m.skipped) actions = `<span class="text-faint" style="font-size:12px;">${t("chat.moment.skipped")}</span>`;
  else actions = `<button type="button" class="btn btn-primary btn-sm" data-chat-moment-save="${ref}">${icon("heart", { size: 12 })}${t("chat.moment.save")}</button><button type="button" class="btn btn-ghost btn-sm" data-chat-moment-skip="${ref}">${t("chat.moment.skip")}</button>`;
  return `
    <div class="cp-idea cp-moment">
      <div class="cp-moment-tag">${icon("heart", { size: 11 })}${t("chat.moment.pick")}</div>
      <div class="cp-idea-title"><span class="tag">${momentKindLabel(m.kind)}</span> ${esc(m.title)}</div>
      ${m.detail ? `<div class="cp-idea-why">${esc(m.detail)}</div>` : ""}
      <div class="cp-idea-actions">${actions}</div>
    </div>`;
}

// An idea the owner liked, offered by the AI for the saved list.
function saveOfferCardHTML(o, ref) {
  let actions;
  if (o.saved) actions = `<span class="bs-done">${icon("check", { size: 12 })} ${t("chat.save.saved")}</span>`;
  else if (o.skipped) actions = `<span class="text-faint" style="font-size:12px;">${t("chat.moment.skipped")}</span>`;
  else actions = `<button type="button" class="btn btn-primary btn-sm" data-chat-offer-save="${ref}">${icon("bookmark", { size: 12 })}${t("chat.save.save")}</button><button type="button" class="btn btn-ghost btn-sm" data-chat-offer-skip="${ref}">${t("chat.moment.skip")}</button>`;
  return `
    <div class="cp-idea cp-offer">
      <div class="cp-moment-tag cp-offer-tag">${icon("bookmark", { size: 11 })}${t("chat.save.pick")}</div>
      <div class="cp-idea-title">${esc(o.title)}</div>
      ${o.why ? `<div class="cp-idea-why">${esc(o.why)}</div>` : ""}
      <div class="cp-idea-actions">${actions}</div>
    </div>`;
}

// The recap card: what the model thinks is worth remembering from a stretch
// of Teman chat, as a checklist the owner decides on. Undecided → checkboxes
// + Simpan/Buang; decided → a one-line record, so the thread keeps its
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
            <span class="tag">${momentKindLabel(m.kind)}</span>
            <b>${esc(m.title)}</b>${m.detail ? `<span class="text-muted"> — ${esc(m.detail)}</span>` : ""}
          </span>
        </label>`
        )
        .join("")}
      <div class="cp-idea-actions" style="margin-top:10px;">
        <button type="button" class="btn btn-primary btn-sm" data-chat-recap-save="${msgId}">${icon("check", { size: 12 })}${t("companion.recap.save")}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-chat-recap-discard="${msgId}">${t("companion.recap.discard")}</button>
      </div>
    </div>`;
}

// "Ask this in another tab": from the model ([[handoff]]) or from the
// keyword rules (a hint). One chip, one tap, same question over there.
function switchChipHTML(to, question, { fromModel }) {
  if (!MODES.includes(to) || !question) return "";
  const label = fromModel ? t("chat.switch.handoff", { mode: t(`chat.mode.${to}`) }) : t("chat.switch.hint", { mode: t(`chat.mode.${to}`) });
  return `<div class="cp-switch"><span>${esc(label)}</span><button type="button" class="consultant-starter" data-chat-switch="${to}" data-chat-q="${esc(question)}">${icon(MODE_ICON[to], { size: 11 })}${t("chat.switch.go", { mode: t(`chat.mode.${to}`) })}${icon("arrowRight", { size: 11 })}</button></div>`;
}

// Numbers the Konsultan read off a sent photo ([[metrics:…]]) — shown back
// so the owner can check them, with one tap to file them on the post.
const METRIC_CARD_KEYS = ["views", "reach", "likes", "comments", "shares", "saves", "profileVisits", "followersGained"];
function metricsCardHTML(mx, index) {
  const chips = [
    ...METRIC_CARD_KEYS.filter((k) => mx.metrics?.[k] !== undefined).map((k) => `<span><b>${Number(mx.metrics[k]).toLocaleString(getLang() === "en" ? "en-US" : "id-ID")}</b> ${esc(t(`store.metric.${k}`))}</span>`),
    ...["videoLengthSec", "avgWatchTimeSec", "hookPct", "completionPct"].filter((k) => mx.retention?.[k] !== undefined).map((k) => `<span><b>${k.endsWith("Pct") ? `${Math.round(mx.retention[k])}%` : `${Math.round(mx.retention[k] * 10) / 10}s`}</b> ${esc(t(`ret.field.${k}`).replace(/\s*\([^)]*\)\s*$/, ""))}</span>`),
  ];
  if (!chips.length) return "";
  const action = mx.saved
    ? `<span>${icon("check", { size: 12 })} ${esc(t("chat.metrics.saved", { title: mx.saved.title }))}</span>`
    : `<button type="button" class="btn btn-secondary btn-sm" data-chat-metrics-save="${index}">${icon("bookmark", { size: 12 })}${t("chat.metrics.save")}</button>`;
  return `<div class="cp-metrics"><div class="cp-metrics-title">${t("chat.metrics.title")}</div><div class="cp-metrics-list">${chips.join("")}</div><div class="cp-metrics-actions">${action}</div></div>`;
}

// "Rencanakan minggu ini": one row per date js/week-plan.js already decided
// is free to post on. Campaign linking is automatic (the AI tags a row to
// an active campaign when it genuinely fits) but never silent — every row
// keeps its own campaign picker, defaulted to the AI's guess and always
// visible/changeable before anything is saved, same as the funnel/format
// tags next to it. Only the newest, still-open plan in the thread is
// interactive; an older one (superseded by a revision or "Ganti semua")
// renders as a collapsed one-line summary via weekPlanSummaryHTML instead.
function weekPlanCardHTML(entry, index, campaigns, formats) {
  const wp = entry.weekPlan;
  const items = wp.items || [];
  const saved = !!wp.savedAt;
  const closed = !!wp.closed;
  const campaignOptions = (selectedId) => [
    `<option value="" ${selectedId ? "" : "selected"}>${esc(t("chat.week.noCampaign"))}</option>`,
    ...campaigns.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)}</option>`),
  ].join("");
  const formatOptions = (selected) => [
    `<option value="" ${selected ? "" : "selected"}>${esc(t("chat.week.formatNone"))}</option>`,
    ...formats.map((f) => `<option value="${esc(f.name)}" ${f.name === selected ? "selected" : ""}>${esc(f.name)}</option>`),
  ].join("");
  const rows = items.map((it, j) => {
    const ref = `${index}:${j}`;
    const locked = saved || closed;
    const done = !!it.contentId;
    return `
    <div class="cp-week-row ${done ? "is-done" : ""}">
      <input type="checkbox" data-week-pick="${ref}" ${done ? "checked disabled" : locked ? "disabled" : it.picked === false ? "" : "checked"} />
      <input class="input cp-week-date" type="date" data-week-date="${ref}" value="${esc(it.date)}" min="${esc(localISODate())}" ${locked ? "disabled" : ""} />
      <span class="cp-plan-body">
        <span class="cp-week-title-row">
          <b>${esc(it.title)}</b>
          ${!done && !locked ? `<button type="button" class="cp-week-item-regen" data-week-regen-item="${ref}" aria-label="${esc(t("chat.week.regenItem"))}" title="${esc(t("chat.week.regenItemTitle"))}">${icon("refresh", { size: 12 })}</button>` : ""}
        </span>
        ${it.angle ? `<span class="text-muted">${esc(it.angle)}</span>` : ""}
        <span class="cp-plan-tags">
          <span class="tag tag-${it.funnel.toLowerCase()}">${esc(funnelShort(it.funnel))}</span>
          ${it.seriesName ? `<span class="tag cp-week-series">${icon("sparkle", { size: 10 })}${esc(it.seriesName)}</span>` : ""}
          ${done
            ? `${it.format ? `<span class="tag">${esc(it.format)}</span>` : ""}${it.campaignName ? `<span class="tag">${esc(it.campaignName)}</span>` : ""}`
            : `${formats.length ? `<select class="input cp-week-select" data-week-format="${ref}" aria-label="${esc(t("chat.week.formatLabel"))}">${formatOptions(it.format)}</select>` : ""}${campaigns.length ? `<select class="input cp-week-select" data-week-campaign="${ref}" aria-label="${esc(t("chat.week.campaignLabel"))}">${campaignOptions(it.campaignId)}</select>` : ""}`}
        </span>
      </span>
      ${done ? `<a class="btn btn-secondary btn-sm" href="#/brand/__BRAND__/content/creator/${esc(it.contentId)}">${icon("check", { size: 12 })}${t("chat.week.open")}</a>` : ""}
    </div>`;
  }).join("");
  const pickedCount = items.filter((it) => !it.contentId && it.picked !== false).length;
  const savedCount = items.filter((it) => it.contentId).length;
  const footer = closed
    ? `<p class="cp-week-status">${t("chat.week.closedNote")}</p>`
    : saved
      ? `<p class="cp-week-status">${icon("check", { size: 12 })} ${t("chat.week.savedNote", { n: savedCount })}</p>`
      : `
    <div class="cp-week-foot">
      <select class="input cp-week-count" data-week-count aria-label="${esc(t("chat.week.countLabel"))}">
        ${[3, 5, 7, 10, 14].map((n) => `<option value="${n}" ${n === items.length ? "selected" : ""}>${t("chat.week.countN", { n })}</option>`).join("")}
      </select>
      ${campaigns.length ? `<select class="input cp-week-count" data-week-scope aria-label="${esc(t("chat.week.scopeLabel"))}">
        <option value="" ${wp.campaignId ? "" : "selected"}>${esc(t("chat.week.scopeGeneral"))}</option>
        ${campaigns.map((c) => `<option value="${esc(c.id)}" ${c.id === wp.campaignId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>` : ""}
      <button type="button" class="btn btn-secondary btn-sm" data-week-regen="${index}" title="${esc(t("chat.week.creditNote"))}">${icon("refresh", { size: 13 })}${t("chat.week.regen")}</button>
      <button type="button" class="btn btn-primary btn-sm" data-week-save="${index}" ${pickedCount ? "" : "disabled"}>${icon("calendar", { size: 14 })}${t("chat.week.save", { n: pickedCount })}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-week-close="${index}">${t("chat.week.close")}</button>
    </div>`;
  return `<div class="cp-week">${rows}${footer}</div>`;
}

// A weekPlan entry that is no longer the newest one in the thread — a
// revision or "Ganti semua" replaced it. Kept for the record, but flat: no
// checkboxes, no pickers, nothing to act on twice.
function weekPlanSummaryHTML(entry) {
  const wp = entry.weekPlan;
  const items = wp.items || [];
  const savedCount = items.filter((it) => it.contentId).length;
  const label = wp.closed ? t("chat.week.summaryClosed", { n: items.length }) : savedCount ? t("chat.week.summarySaved", { n: savedCount }) : t("chat.week.summaryReplaced", { n: items.length });
  return `<div class="cp-week-summary text-faint">${icon("calendar", { size: 12 })}${esc(label)}</div>`;
}

function attachStripHTML(brandId) {
  const list = attachments.get(brandId) || [];
  if (!list.length) return "";
  return `<div class="cp-attach">${list.map((a, i) => `<div class="cp-attach-item"><img src="${esc(a.thumb)}" alt="" /><button type="button" data-attach-remove="${i}" aria-label="${t("chat.image.remove")}" title="${t("chat.image.remove")}">${icon("x", { size: 10 })}</button></div>`).join("")}</div>`;
}

// "Script siap syuting": a script the AI wrote ([[script:…]], see
// js/ai-directives.js), shown whole and readable, with one button that
// approves it into a real draft in Creator — script and caption filled in.
function scriptCardHTML(sc, ref) {
  const meta = [sc.format, funnelShort(sc.funnel)].filter(Boolean).join(" · ");
  return `
    <div class="cp-script">
      <div class="cp-script-head">${icon("teleprompter", { size: 14 })}<span>${t("chat.script.label")}</span>${meta ? `<small>${esc(meta)}</small>` : ""}</div>
      <div class="cp-script-title">${esc(sc.title)}</div>
      <div class="cp-script-body">${renderLightMarkdown(sc.script)}</div>
      ${sc.caption ? `<div class="cp-script-caption"><b>${t("chat.script.caption")}</b><p>${esc(sc.caption)}</p></div>` : ""}
      <div class="cp-script-actions">
        ${sc.contentId
          ? `<button type="button" class="btn btn-secondary btn-sm" data-script-open="${esc(sc.contentId)}">${icon("check", { size: 13 })}${t("chat.script.saved")}${icon("arrowRight", { size: 12 })}</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-script-approve="${ref}">${icon("check", { size: 13 })}${t("chat.script.approve")}</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-script-copy="${ref}">${icon("copy", { size: 13 })}${t("chat.script.copy")}</button>
      </div>
    </div>`;
}

// The AI's format name ("Reels", "short video", "Reels/TikTok") → one of this
// account's own formats; the platform follows when the name says it.
function matchFormat(name) {
  const formats = getSettings().formats || [];
  const n = String(name || "").toLowerCase();
  const hit = formats.find((f) => n && n.includes(f.name.toLowerCase())) || formats.find((f) => /reel/i.test(f.name)) || formats[0];
  const platform = /tiktok/.test(n) ? "TikTok" : /youtube|shorts/.test(n) ? "YouTube" : /facebook/.test(n) ? "Facebook" : "Instagram";
  return { format: hit?.name || "", platform };
}

function messageHTML(h, index, { isLast, info, full, hint, auto, brand, isLatestPlan }) {
  if (h.role === "day") return `<div class="companion-day">${esc(h.label)}</div>`;
  if (h.role === "user") {
    const del = h.deletable && h.msgId ? `<button type="button" class="companion-msg-del" data-chat-msg-del="${esc(h.msgId)}" aria-label="${t("companion.msg.delete")}" title="${t("companion.msg.delete")}">${icon("trash", { size: 11 })}</button>` : "";
    // ♡ = "save what I just said to Brand memory" — the direct way in,
    // without waiting for the AI to offer a moment card.
    const inMem = isInMemory(brand, h.text);
    // A question ("gimana biar rame?") isn't something that happened to the
    // brand — no ♡ on it, so Memori Brand stays facts and events.
    const isQuestion = /\?\s*$/.test(h.text || "");
    const mem = (h.text || "").trim().length >= 6 && !isQuestion
      ? `<button type="button" class="cp-msg-mem ${inMem ? "is-saved" : ""} ${del ? "has-del" : ""}" data-chat-msg-mem="${index}" ${inMem ? "disabled" : ""} aria-label="${esc(inMem ? t("chat.memory.msgSaved") : t("chat.memory.msgSave"))}" title="${esc(inMem ? t("chat.memory.msgSaved") : t("chat.memory.msgSave"))}">${icon("heart", { size: 11 })}</button>`
      : "";
    const imgs = (h.images || []).length ? `<div class="cp-msg-images">${h.images.map((src) => `<img src="${esc(src)}" alt="" />`).join("")}</div>` : "";
    return `<div class="consultant-msg consultant-msg-user" data-consultant-msg="${index}">${imgs}${esc(h.text)}${mem}${del}</div>`;
  }

  const isBs = h.engine === "brainstorm";
  const ideas = h.ideas || [];
  const tasks = h.tasks || [];
  const moments = h.moments || [];
  const engineHTML = h.engine ? `<span class="cp-engine cp-engine-${h.engine}">${icon(MODE_ICON[h.engine], { size: 11 })}${t(`chat.engine.${h.engine}`)}</span>` : "";
  // Only what matters under an answer: one place to go (a campaign by its
  // name), at most two follow-ups, and the rest tucked into the tools line.
  const nav = relevantNav(h.nav, h.text)[0];
  const navLabel = campaignOfNav(nav) ? t("cons.nav.campaignNamed", { name: campaignOfNav(nav).name }) : nav?.label;
  const navHTML = nav
    ? `<div class="consultant-nav-buttons"><button type="button" class="consultant-nav-btn" data-consultant-nav="${nav.open === "insights" ? "__insights" : nav.path}">${esc(navLabel)}${icon("arrowRight", { size: 12 })}</button></div>`
    : "";
  const draftsHTML = h.drafts?.length
    ? `<div class="consultant-nav-buttons">${h.drafts
        .map((d, j) =>
          d.contentId
            ? `<button type="button" class="consultant-nav-btn" data-consultant-open-draft="${esc(d.contentId)}">${icon("check", { size: 12 })}${t("cons.draftCreated", { title: esc(d.title) })}</button>`
            : `<button type="button" class="consultant-nav-btn" data-consultant-draft="${index}:${j}" title="${t("cons.draftCreateTitle", { funnel: d.funnel })}">${icon("plus", { size: 12 })}${t("cons.draftCreate", { title: esc(d.title) })}</button>`
        )
        .join("")}</div>`
    : "";
  const scriptsHTML = (h.scripts || []).map((sc, j) => scriptCardHTML(sc, `${index}:${j}`)).join("");
  const weekPlanHTML = h.weekPlan
    ? isLatestPlan
      ? weekPlanCardHTML(h, index, activeCampaignsFor(listCampaigns(brand.id)), getSettings().formats || [])
      : weekPlanSummaryHTML(h)
    : "";
  // A rewrite proposed in Creator's script discussion — shown for reference;
  // applying it happens in Creator.
  const revisionsHTML = (h.revisions || []).map((r, i) => {
    const key = `${h.threadId}|${h.msgId}|${i}`;
    const action = !h.threadId || !h.msgId
      ? ""
      : r.applied
        ? scriptUndo.has(key)
          ? `<button type="button" class="btn btn-ghost btn-sm" data-rev-undo="${esc(key)}">${t("cr.disc.undo")}</button>`
          : `<span class="text-faint" style="font-size:12px;">${icon("check", { size: 12 })} ${t("cr.disc.applied")}</span>`
        : `<button type="button" class="btn btn-primary btn-sm" data-rev-apply="${esc(key)}">${r.target === "caption" ? t("cr.disc.applyCaption") : t("cr.disc.applyScript")}</button>`;
    return `<div class="cp-idea"><div class="cp-idea-title">${esc(r.target === "caption" ? t("cr.disc.revCaption") : t("cr.disc.revScript"))}</div><div class="cp-idea-why" style="white-space:pre-wrap;">${esc(r.text)}</div>${action ? `<div style="margin-top:8px;">${action}</div>` : ""}</div>`;
  }).join("") + (isLast && h.threadId && scriptHosts.get(h.threadId)?.onRegenerate && getBrainstorm(h.threadId)?.mode === "script"
    ? `<div class="disc-regen"><button type="button" class="btn btn-primary btn-sm" data-script-regen="script">${icon("refresh", { size: 12 })}${t("cr.disc.regenScript")}</button><button type="button" class="btn btn-secondary btn-sm" data-script-regen="hook">${icon("refresh", { size: 12 })}${t("cr.disc.regenHook")}</button></div>`
    : "");
  const cardsHTML =
    tasks.map((task, j) => taskCardHTML(task, `${index}:${j}`)).join("") +
    ideas.map((idea, j) => ideaCardHTML(idea, `${index}:${j}`, info, full)).join("") +
    moments.map((m, j) => momentCardHTML(m, `${index}:${j}`)).join("") +
    (h.saves || []).map((o, j) => saveOfferCardHTML(o, `${index}:${j}`)).join("") +
    (h.metrics ? metricsCardHTML(h.metrics, index) : "") +
    (h.recap ? recapCardHTML(h.recap, h.msgId) : "");
  // Under the newest idea list: more ideas, or keep them all at once.
  const replyActions = isLast && isBs && (ideas.length || tasks.length)
    ? `<div class="bs-reply-actions"><button type="button" class="btn btn-ghost btn-sm" data-chat-more>${icon("refresh", { size: 12 })}${t("bs.opt.more")}</button>${ideas.filter((x) => !x.saved).length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-chat-save-all="${index}">${icon("bookmark", { size: 12 })}${t("bs.opt.saveAll")}</button>` : ""}</div>`
    : "";
  // Otomatis steers the saving: under fresh idea cards, one line says what
  // keeping one does.
  const guideHTML = auto && isLast && ideas.some((x) => !x.saved && !x.contentId)
    ? `<p class="cp-guide">${icon("bookmark", { size: 12 })}${t("chat.guide.ideas")}</p>`
    : "";
  // Follow-ups only under the newest answer — older chips would re-ask
  // questions the conversation has already moved past.
  const asksHTML = isLast && h.asks?.length
    ? `<div class="consultant-followups cp-asks"><div class="consultant-starters">${h.asks.slice(0, 2).map((q) => starterChip(q, h.engine)).join("")}</div></div>`
    : "";
  // A Brainstorm question with nothing to pick yet: skip to ideas, or answer.
  const forkHTML = isLast && isBs && h.question && !ideas.length && !tasks.length && !h.drafts?.length && !h.scripts?.length && !h.weekPlan
    ? `<div class="bs-fork"><button type="button" class="btn btn-primary btn-sm" data-chat-go-ideas>${icon("sparkle", { size: 13 })}${t("bs.go.ideas")}</button><button type="button" class="btn btn-secondary btn-sm" data-chat-answer>${icon("chat", { size: 13 })}${t("bs.go.answer")}</button></div>`
    : "";
  // The recap offer (Teman, un-recapped chat from before today).
  const nudgeHTML = h.nudge ? `<div class="cp-idea-actions" style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-sm" data-chat-recap>${icon("sparkle", { size: 12 })}${t("companion.recap.button")}</button></div>` : "";
  // Otomatis: the model's handoff, or "Bukan ini maksudmu?" — either moves
  // the question to another engine. A tab: the handoff or the keyword hint
  // offers the same question in another tab.
  let switchHTML = "";
  let retryToggle = "";
  if (isLast && h.question && h.engine && !h.ephemeral) {
    if (auto) {
      const handoff = h.handoff && h.handoff !== h.engine;
      const others = handoff ? [h.handoff] : MODES.filter((e) => e !== h.engine);
      switchHTML = `<div class="cp-switch" ${handoff ? "" : "hidden"}>${handoff ? `<span>${esc(t("chat.switch.handoff", { mode: t(`chat.mode.${h.handoff}`) }))}</span>` : ""}${others
        .map((e) => `<button type="button" class="consultant-starter" data-chat-retry="${e}">${icon(MODE_ICON[e], { size: 11 })}${t(`chat.retry.${e}`)}</button>`)
        .join("")}</div>`;
      if (!handoff) retryToggle = `<button type="button" class="cp-copy cp-retry-toggle" data-chat-retry-toggle>${t("chat.retry.toggle")}</button>`;
    } else if (h.handoff && h.handoff !== h.engine) switchHTML = switchChipHTML(h.handoff, h.question, { fromModel: true });
    else if (hint && hint.question === h.question) switchHTML = switchChipHTML(hint.to, h.question, { fromModel: false });
  }
  const body = h.text ? `<div class="consultant-md">${renderLightMarkdown(h.text)}</div>` : "";
  const toolsHTML = h.engine && !h.ephemeral
    ? `<div class="cp-msg-tools"><button type="button" class="cp-copy" data-chat-copy="${index}" title="${t("chat.copy")}">${icon("copy", { size: 12 })}<span>${t("chat.copy")}</span></button>${retryToggle}</div>`
    : "";
  const retryHTML = h.retry ? `<div class="consultant-nav-buttons"><button type="button" class="consultant-nav-btn" data-chat-resend="${index}">${icon("refresh", { size: 12 })}${t("chat.retry")}</button></div>` : "";
  return `<div class="consultant-msg consultant-msg-assistant" data-consultant-msg="${index}" data-engine="${h.engine || ""}">${engineHTML}${body}${scriptsHTML}${retryHTML}${revisionsHTML}${navHTML}${draftsHTML}${cardsHTML}${weekPlanHTML}${guideHTML}${replyActions}${asksHTML}${forkHTML}${nudgeHTML}${switchHTML}${toolsHTML}</div>`;
}

// Brainstorm openers read from what is happening in the brand right now.
function brainstormStarters(brandId, info) {
  if (info.goal) return [t("roadmap.bs.starter1"), t("roadmap.bs.starter2"), t("roadmap.bs.starter3")];
  const chips = [];
  const signals = signalsNow(brandId);
  const viral = signals.find((s) => s.kind === "viral");
  const jump = signals.find((s) => s.kind === "follower-jump");
  const down = signals.find((s) => s.kind === "sales-down");
  if (viral) chips.push(t("bs.starter.viral", { title: listContent(brandId).find((x) => x.id === viral.refs?.contentId)?.title || t("pulse.untitledContent") }));
  if (jump) chips.push(t("bs.starter.followerJump", { platform: jump.refs?.platform || "" }));
  if (down) chips.push(t("bs.starter.salesDown"));
  if (!info.campaign && !info.content) chips.push(t("bs.starter.campaign"));
  chips.push(t("bs.starter.content"), t("bs.starter.stuck"));
  return chips.slice(0, 4);
}

// Each tab greets with what it is for and what comes out of it, then a
// few openers pre-routed to that tab.
// First-message nudges in Otomatis, each pre-routed so the first answer
// never misfires.
const AUTO_STARTERS = [
  { key: "consultant.starter.performance", engine: "consultant" },
  { key: "consultant.starter.week", engine: "consultant" },
  { key: "chat.starter.ideas", engine: "brainstorm" },
  { key: "chat.starter.today", engine: "companion" },
];

function emptyStateHTML(brandId, info, full) {
  const mode = modeOf(brandId);
  const name = esc(getBrand(brandId)?.name || t("cons.thisBrand"));
  if (currentThread(brandId)?.mode === "script") {
    return `<div class="consultant-msg consultant-msg-assistant">${esc(t("cr.disc.intro"))}</div>
      <div class="consultant-starters">${SCRIPT_CHIPS.map((k) => starterChip(t(`cr.disc.chip.${k}`), "brainstorm")).join("")}</div>`;
  }
  if (mode === "auto") {
    return `<div class="consultant-msg consultant-msg-assistant">${t("chat.greeting.auto", { brand: name })}</div>
      <div class="consultant-starters">${AUTO_STARTERS.map((s) => starterChip(t(s.key), s.engine)).join("")}</div>`;
  }
  if (mode === "consultant") {
    const starters = ["consultant.starter.performance", "consultant.starter.week", "consultant.starter.quiet"];
    return `<div class="consultant-msg consultant-msg-assistant">${t("chat.greeting", { brand: name })}</div>
      <div class="consultant-starters">${starters.map((k) => starterChip(t(k), "consultant")).join("")}</div>`;
  }
  if (mode === "companion") {
    const starters = ["chat.starter.today", "chat.starter.sale", "chat.starter.complaint"];
    return `<div class="consultant-msg consultant-msg-assistant">${companionGreeting(brandId)} ${t("chat.companion.intro")}</div>
      <div class="consultant-starters">${starters.map((k) => starterChip(t(k), "companion")).join("")}</div>`;
  }
  return `${full ? `<div class="bs-how"><div class="bs-how-title">${t("bs.how.title")}</div><ol class="bs-how-steps"><li>${t("bs.how.1")}</li><li>${t("bs.how.2")}</li><li>${t("bs.how.3")}</li></ol></div>` : ""}
    <div class="consultant-msg consultant-msg-assistant">${esc(t("bs.intro"))}</div>
    <div class="consultant-starters">${brainstormStarters(brandId, info).map((q) => starterChip(q, "brainstorm")).join("")}</div>`;
}

// ---- Layout -------------------------------------------------------------------

// One compact row above the chat instead of two rows of pills:
//   [mode ▾]  — the open view; its menu lists all four with what each is for
//               (Pro only — Pemula never picks a mode, only gets a link back
//               to Otomatis when a button elsewhere opened one log)
//   [Tersimpan ▾] — Ide Konten, Memori Brand, earlier conversations (small
//               panel only; the page shows those as its own columns)
//   [+]       — a new conversation (Otomatis / Brainstorm; the Konsultan and
//               Teman logs are single rolling threads, cleared from the head)
function toolbarHTML(brandId, full) {
  const mode = modeOf(brandId);
  const guided = isGuided();
  const back = guided && mode !== "auto"
    ? `<button type="button" class="link cp-tool-back" data-chat-mode="auto" ${pending ? "disabled" : ""}>${icon("chevronLeft", { size: 12 })}${t("chat.mode.back")}</button><span class="cp-back-here">${icon(MODE_ICON[mode], { size: 12 })}${t(`chat.mode.${mode}`)}</span>`
    : "";
  const modeBtn = guided
    ? ""
    : `<button type="button" class="cp-tool cp-tool-mode" data-chat-modes data-engine="${mode}" aria-haspopup="menu" aria-label="${esc(t("chat.mode.aria"))}" title="${esc(t(`chat.mode.tip.${mode}`))}" ${pending ? "disabled" : ""}>${icon(MODE_ICON[mode], { size: 13 })}<span>${t(`chat.mode.${mode}`)}</span>${icon("chevronDown", { size: 11 })}</button>`;
  const savedN = savedIdeasFor(brandId).items.length + savedMoments(getBrand(brandId)).length;
  const savedBtn = full
    ? ""
    : `<button type="button" class="cp-tool" data-chat-saved-menu aria-haspopup="menu">${icon("bookmark", { size: 13 })}<span>${t("chat.saved.menu")}</span>${savedN ? `<span class="cp-tool-count">${savedN}</span>` : ""}${icon("chevronDown", { size: 11 })}</button>`;
  const newBtn = !full && (mode === "auto" || mode === "brainstorm")
    ? `<button type="button" class="cp-tool cp-tool-icon" data-chat-new aria-label="${esc(t("chat.scope.new"))}" title="${esc(t("chat.scope.new"))}" ${!hasMessages(brandId, mode) || pending ? "disabled" : ""}>${icon("plus", { size: 15 })}</button>`
    : "";
  if (!back && !modeBtn && !savedBtn && !newBtn) return "";
  return `<div class="cp-toolbar">${back}${modeBtn}${savedBtn}<span class="cp-toolbar-spacer"></span>${newBtn}</div>`;
}

// [mode ▾]: every view with the one line that says what it is for — the
// tooltips the old pill row showed on hover, now readable on touch too.
function openModesMenu(brandId, btn) {
  if (pending) return;
  const r = btn.getBoundingClientRect();
  const menu = openMenu(btn, { className: "cp-menu", top: r.bottom + 6, left: r.left });
  if (!menu) return;
  const current = modeOf(brandId);
  menu.innerHTML = VIEWS.map((m) => `
    <button type="button" class="cp-menu-mode ${m === current ? "is-active" : ""}" data-engine="${m}" data-pick-mode="${m}">
      ${icon(MODE_ICON[m], { size: 15 })}
      <span class="cp-menu-mode-text"><b>${t(`chat.mode.${m}`)}</b><small>${t(`chat.mode.tip.${m}`)}</small></span>
      ${m === current ? icon("check", { size: 13 }) : ""}
    </button>`).join("");
  menu.querySelectorAll("[data-pick-mode]").forEach((b) => b.addEventListener("click", () => {
    closeMenu();
    if (pending) return;
    setMode(brandId, b.dataset.pickMode);
    renderPanel(brandId, { focus: !isTouch() });
  }));
}

// [Tersimpan ▾]: what the chat keeps, plus the conversations to go back to.
function openSavedMenu(brandId, btn) {
  const r = btn.getBoundingClientRect();
  const menu = openMenu(btn, { className: "cp-menu", top: r.bottom + 6, left: r.left });
  if (!menu) return;
  const ideas = savedIdeasFor(brandId).items.length;
  const memory = savedMoments(getBrand(brandId)).length;
  const sessions = listSessions(brandId).length;
  menu.innerHTML = `
    <button type="button" data-saved-ideas>${icon("bookmark", { size: 14 })}${t("chat.saved.button", { n: ideas })}</button>
    <button type="button" data-saved-memory>${icon("heart", { size: 14 })}${t("chat.memory.short", { n: memory })}</button>
    <button type="button" data-saved-sessions ${sessions ? "" : "disabled"}>${icon("chat", { size: 14 })}${t("chat.saved.sessions", { n: sessions })}${icon("chevronRight", { size: 12 })}</button>`;
  menu.querySelector("[data-saved-ideas]").addEventListener("click", () => { closeMenu(); openSavedIdeasModal(brandId); });
  menu.querySelector("[data-saved-memory]").addEventListener("click", () => { closeMenu(); openBrandMemoryModal(brandId, { refresh: () => renderPanel(brandId) }); });
  menu.querySelector("[data-saved-sessions]").addEventListener("click", () => { closeMenu(); openSessionsMenu(brandId, btn); });
}

// Page-only tail of the row under the tabs: the ⋯ menu (Brainstorm) and
// "Kecilkan" when the page was opened from the small panel.
function rowTailHTML(brandId, full, { menu = false } = {}) {
  if (!full) return "";
  return `<span class="cp-scope-spacer"></span>
    ${menu ? `<button type="button" class="icon-btn" data-chat-menu aria-label="${t("common.more")}" title="${t("common.more")}">${icon("dots", { size: 14 })}</button>` : ""}
    ${expandedFrom ? `<button type="button" class="icon-btn" data-chat-shrink aria-label="${t("chat.shrink")}" title="${t("chat.shrink")}">${icon("chevronDown", { size: 14 })}</button>` : ""}`;
}

// Brainstorm: what the conversation is about. Always shown on the page
// (with "ganti"); in the small panel only when it is about something specific.
function scopeRowHTML(brandId, info, full) {
  const scope = activeScope(brandId);
  if (!full && !hasScope(scope)) return "";
  const savedCount = savedIdeasFor(brandId).items.length;
  return `
    <div class="cp-scope">
      <span class="bs-scope-chip">${icon(info.content ? "edit" : info.series ? "sparkle" : info.campaign ? "bulb" : "target", { size: 12 })}${esc(info.label)}</span>
      <button type="button" class="link" data-chat-scope>${t("bs.scope.change")}</button>
      ${full ? `<span class="cp-scope-spacer"></span>
        <button type="button" class="btn btn-secondary btn-sm cp-saved-jump" data-chat-see-saved title="${esc(t("bs.saved.openTitle"))}">${icon("bookmark", { size: 12 })}${t("bs.saved.open", { n: savedCount })}</button>
        <button type="button" class="icon-btn" data-chat-menu aria-label="${t("common.more")}" title="${t("common.more")}">${icon("dots", { size: 14 })}</button>
        ${expandedFrom ? `<button type="button" class="icon-btn" data-chat-shrink aria-label="${t("chat.shrink")}" title="${t("chat.shrink")}">${icon("chevronDown", { size: 14 })}</button>` : ""}` : ""}
    </div>`;
}

// Konsultan: one line that says what this tab is (and isn't).
function consultantRowHTML(brandId, full) {
  return `
    <div class="cp-scope cp-info">
      <span class="cp-info-text">${icon("bot", { size: 12 })}${t("chat.consultant.note")}</span>
      ${rowTailHTML(brandId, full)}
    </div>`;
}

// Teman: the way into brand memory, and "Rangkum" when there is chat the
// owner hasn't turned into moments yet.
function companionRowHTML(brandId, full) {
  const n = savedMoments(getBrand(brandId)).length;
  const unrecapped = unrecappedMessages(brandId).filter((m) => m.role === "user").length;
  return `
    <div class="cp-scope cp-info">
      <button type="button" class="bs-scope-chip cp-memory-chip" data-chat-memory title="${esc(t("chat.memory.sub"))}">${icon("heart", { size: 12 })}${t("chat.memory.button", { n })}</button>
      ${unrecapped && !pending ? `<button type="button" class="btn btn-secondary btn-sm" data-chat-recap title="${esc(t("companion.recap.nudge", { n: unrecapped }))}">${icon("sparkle", { size: 12 })}${t("chat.recap.button", { n: unrecapped })}</button>` : ""}
      ${rowTailHTML(brandId, full)}
    </div>`;
}

// "Come back tomorrow" is only true for a daily quota. A trial spends one
// pool for the whole 7 days, Founder plans are capped per month, and a
// read-only account has no AI at all — each gets its own line, and the two
// that won't refill on their own get a way forward. The button opens the
// same top-up / upgrade dialog as everywhere else (js/ai-topup.js).
function quotaNoticeHTML() {
  const readOnly = isReadOnly(getCachedAccount());
  const period = aiQuotaPeriod();
  const key = readOnly ? "bs.quotaReached.readonly" : period === "total" ? "bs.quotaReached.total" : period === "month" ? "bs.quotaReached.month" : "bs.quotaReached";
  const more = readOnly || period === "total" ? t("ai.topup.seePlans") : t("ai.topup.button");
  return `<p class="companion-error cp-quota">${t(key)} <button type="button" class="link cp-topup" data-ai-topup>${more}</button></p>`;
}

// The chat itself — identical in both sizes.
function chatCoreHTML(brandId, full) {
  const mode = modeOf(brandId);
  const history = historyFor(brandId, mode);
  const quotaOut = aiLimitReached();
  const info = chatScopeInfo(brandId);
  const last = history[history.length - 1];
  const forkShown = last?.role === "assistant" && last.engine === "brainstorm" && last.question && !(last.ideas || []).length && !(last.tasks || []).length && !last.drafts?.length && !last.scripts?.length;
  const placeholder = answerHint ? t("bs.answer.ph") : t(`chat.placeholder.${mode}`);
  // Only the Wepeka admin can fix the shared AI key (Settings → AI is an
  // admin-only panel) — anyone else would land on a page without it.
  const setupLink = isAdmin(currentUid()) ? ` <a href="#/settings/ai">${t("chat.setupAi")} ${icon("arrowRight", { size: 11 })}</a>` : "";
  const noticeHTML = noKeyNotice ? `<div class="consultant-msg consultant-msg-assistant cp-notice">${t("bs.noKey")}${setupLink}</div>` : "";
  // "Langsung kasih ide" — Brainstorm only, and not twice when the fork
  // under the last question already offers it.
  const ideasNow = (mode === "brainstorm" || mode === "auto") && !forkShown;
  const hint = hints.get(brandId)?.mode === mode ? hints.get(brandId) : null;
  const autoRow = hasScope(activeScope(brandId)) ? scopeRowHTML(brandId, info, full) : full && expandedFrom ? `<div class="cp-scope cp-info">${rowTailHTML(brandId, full)}</div>` : "";
  // Konsultan's one-line "what this tab is" note now lives in the mode
  // menu; on the page the row still carries ⋯ / Kecilkan.
  const row = mode === "auto" ? autoRow : mode === "brainstorm" ? scopeRowHTML(brandId, info, full) : mode === "companion" ? companionRowHTML(brandId, full) : full ? consultantRowHTML(brandId, full) : "";
  return `
    ${toolbarHTML(brandId, full)}
    ${row}
    <div class="consultant-panel-body" id="consultant-messages" aria-live="polite">
      ${history.length ? (() => {
        // Only the newest weekPlan card in this transcript is interactive;
        // any earlier one (superseded by a revision or "Ganti semua")
        // collapses to a one-line summary (weekPlanSummaryHTML).
        const latestPlanIndex = history.reduce((acc, h, i) => (h.weekPlan ? i : acc), -1);
        return history.map((h, i) => messageHTML(h, i, { isLast: i === history.length - 1, info, full, hint, auto: mode === "auto", brand: getBrand(brandId), isLatestPlan: i === latestPlanIndex })).join("");
      })() : emptyStateHTML(brandId, info, full)}
      ${noticeHTML}
    </div>
    ${quotaOut ? quotaNoticeHTML() : ""}
    ${attachStripHTML(brandId)}
    <div class="consultant-panel-input">
      <button type="button" class="chip-icon-btn cp-image" id="consultant-image" aria-label="${t("chat.image.attach")}" title="${t("chat.image.attach")}" ${pending || quotaOut ? "disabled" : ""}>${icon("image", { size: 15 })}</button>
      <input type="file" id="consultant-image-file" accept="image/*" multiple hidden />
      <textarea id="consultant-input" placeholder="${esc(placeholder)}" rows="1" ${pending || quotaOut ? "disabled" : ""}></textarea>
      <button type="button" class="chip-icon-btn cp-mic" id="consultant-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}" ${pending || quotaOut ? "disabled" : ""}>${icon("mic", { size: 15 })}</button>
      <button type="button" class="icon-btn" id="consultant-send" aria-label="${t("cons.send")}" ${pending || quotaOut ? "disabled" : ""}>${icon("send", { size: 15 })}</button>
    </div>
    ${full || ideasNow ? `<div class="cp-foot">
      ${full && !isTouch() ? `<span class="cp-foot-hint">${t("bs.composer.hint")}</span>` : ""}
      ${ideasNow ? `<button type="button" class="btn btn-ghost btn-sm" id="chat-ideas-now" title="${esc(t("chat.ideasNow.title"))}" ${pending || quotaOut ? "disabled" : ""}>${icon("sparkle", { size: 12 })}${t("chat.ideasNow")}</button>` : ""}
    </div>` : ""}`;
}

function panelHTML(brandId) {
  const mode = modeOf(brandId);
  const has = hasMessages(brandId, mode);
  return `
    <div class="consultant-panel-head cp-head">
      <div class="cp-head-main">
        <span class="cp-head-icon">${icon(MODE_ICON[mode], { size: 16 })}</span>
        <div><b>${t("chat.title")}</b><small>${t(`chat.mode.tip.${mode}`)}</small></div>
      </div>
      <div class="cp-head-actions">
        ${has && mode !== "auto" ? `<button type="button" class="icon-btn" data-chat-clear aria-label="${t(`chat.clear.${mode}`)}" title="${t(`chat.clear.${mode}`)}" ${pending ? "disabled" : ""}>${icon("trash", { size: 14 })}</button>` : ""}
        <button type="button" class="icon-btn" data-chat-expand aria-label="${t("chat.expand")}" title="${t("chat.expand")}">${icon("expand", { size: 14 })}</button>
        <button type="button" class="icon-btn" data-chat-close aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
      </div>
    </div>
    ${chatCoreHTML(brandId, false)}`;
}

// Page, left (Brainstorm): every saved conversation, with its scope. The
// two rolling threads (Konsultan, Teman) are tabs, not conversations.
function railHTML(brandId) {
  const current = brainstormThread.get(brandId) || null;
  const threads = listBrainstorms(brandId).filter((th) => !ROLLING_THREAD_MODES.includes(th.mode) && (th.messages || []).length);
  const tag = (th) => (th.mode === "script" ? t("bs.scope.scriptDisc") : th.contentId ? t("ai.route.creator") : th.campaignId ? t("ai.route.campaigns") : t("bs.scope.brand"));
  const date = (th) => new Date(th.updatedAt || th.createdAt || Date.now()).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "short" });
  const has = hasMessages(brandId, "brainstorm");
  return `
    <details class="bs-threads" ${window.innerWidth > 1100 ? "open" : ""}>
      <summary class="bs-threads-head">
        <span class="bs-threads-title">${icon("chat", { size: 13 })}${t("bs.threads.title")}${threads.length ? ` <span class="text-faint">(${threads.length})</span>` : ""}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-chat-new ${!has || pending ? "disabled" : ""}>${icon("plus", { size: 12 })}${t("bs.threads.new")}</button>
      </summary>
      <div class="bs-thread-list">
        ${threads.length
          ? threads.map((th) => `<div class="bs-thread-row"><button type="button" class="bs-thread-item ${th.id === current ? "is-active" : ""}" data-chat-thread="${th.id}">
              <span class="bs-thread-title">${esc(th.title || t("bs.threads.untitled"))}</span>
              <span class="bs-thread-meta"><span class="tag">${esc(tag(th))}</span>${esc(date(th))}</span>
            </button><button type="button" class="chip-icon-btn bs-thread-del" data-chat-thread-del="${th.id}" aria-label="${t("bs.ideas.deleteThread")}" title="${t("bs.ideas.deleteThread")}">${icon("trash", { size: 12 })}</button></div>`).join("")
          : `<p class="text-faint" style="font-size:12px;margin:6px 0;">${t("bs.threads.empty")}</p>`}
      </div>
    </details>`;
}

// Page, left (Otomatis): the Obrolan list — every conversation, newest
// first, open to carry on, deletable.
function sessionsRailHTML(brandId) {
  const current = currentSessionOf(brandId)?.id || null;
  const list = listSessions(brandId);
  const date = (x) => new Date(x.updatedAt || x.createdAt || Date.now()).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "short" });
  return `
    <details class="bs-threads" ${window.innerWidth > 1100 ? "open" : ""}>
      <summary class="bs-threads-head">
        <span class="bs-threads-title">${icon("chat", { size: 13 })}${t("chat.sessions.title")}${list.length ? ` <span class="text-faint">(${list.length})</span>` : ""}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-chat-new ${!current || pending ? "disabled" : ""}>${icon("plus", { size: 12 })}${t("bs.threads.new")}</button>
      </summary>
      <div class="bs-thread-list">
        ${list.length
          ? list.map((x) => `<div class="bs-thread-row"><button type="button" class="bs-thread-item ${x.id === current ? "is-active" : ""}" data-chat-session="${x.id}">
              <span class="bs-thread-title">${esc(x.title || t("bs.threads.untitled"))}</span>
              <span class="bs-thread-meta">${esc(date(x))}</span>
            </button><button type="button" class="chip-icon-btn bs-thread-del" data-chat-session-del="${x.id}" aria-label="${t("chat.sessions.delete")}" title="${t("chat.sessions.delete")}">${icon("trash", { size: 12 })}</button></div>`).join("")
          : `<p class="text-faint" style="font-size:12px;margin:6px 0;">${t("chat.sessions.empty")}</p>`}
      </div>
    </details>`;
}

// Page, right (Brainstorm): the saved ideas this conversation feeds. Click
// the header for a roomy focused view; click an idea's title to edit it.
function ideasPanelHTML(brandId) {
  const { camp, items } = savedIdeasFor(brandId);
  const rows = [...items].reverse().map((i) => {
    const used = i.status === "used" && i.contentId && getContent(i.contentId);
    return `
    <div class="bs-saved-idea ${used ? "is-used" : ""}">
      <div class="bs-saved-text" data-chat-saved-open="${i.id}" title="${esc(t("bs.concept.open"))}"><b>${esc(i.text)}</b>${used ? ` <span class="tag">${t("bs.concept.used")}</span>` : ""}${i.description ? `<span class="text-muted"> — ${esc(i.description)}</span>` : ""}</div>
      ${ideasFocus
        ? `${i.notes ? `<div class="bs-saved-notes">${esc(i.notes)}</div>` : ""}${i.hooks?.length ? `<ul class="bs-saved-hooks">${i.hooks.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}`
        : i.hooks?.length ? `<div class="text-faint" style="font-size:11.5px;margin-top:3px;">${t("bs.concept.hooksLabel")}: ${i.hooks.length}</div>` : ""}
      <div class="bs-card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-chat-saved-discuss="${i.id}">${icon("chat", { size: 12 })}${t("bs.concept.discuss")}</button>
        ${used
          ? `<button type="button" class="btn btn-secondary btn-sm" data-chat-saved-opendraft="${esc(i.contentId)}">${icon("check", { size: 12 })}${t("bs.concept.openDraft")}</button>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-chat-saved-draft="${i.id}">${icon("edit", { size: 12 })}${t("bs.concept.toCreator")}</button>`}
        <button type="button" class="chip-icon-btn" data-chat-saved-delete="${i.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
      </div>
    </div>`;
  }).join("");
  return `
    ${ideasFocus ? `<div class="bs-ideas-backdrop" data-chat-ideas-focus></div>` : ""}
    <aside class="card glass-card bs-ideas ${ideasFocus ? "is-focus" : ""} ${flashIdeas ? "is-flash" : ""}">
      <div class="bs-ideas-head">
        <button type="button" class="bs-ideas-toggle" data-chat-ideas-focus title="${esc(ideasFocus ? t("bs.ideas.shrink") : t("bs.ideas.expand"))}">
          <h2>${icon("bookmark", { size: 14 })}${t("bs.ideas.title")} <span class="text-faint" style="font-weight:600;">${items.length || ""}</span></h2>
          <span class="bs-ideas-expand">${icon(ideasFocus ? "x" : "expand", { size: 14 })}</span>
        </button>
        <p class="text-faint" style="font-size:11.5px;margin:2px 0 0;">${esc(camp ? t("bs.ideas.sub.campaign") : t("bs.ideas.sub.brand"))}</p>
      </div>
      <div class="bs-saved-list">${rows || `<p class="text-faint" style="font-size:12px;margin:8px 0 0;">${t("bs.ideas.empty")}</p>`}</div>
    </aside>`;
}

// Page, right (Teman): brand memory — the moments this chat has produced,
// newest first, each deletable, so what AI reads is never out of sight.
function memoryPanelHTML(brandId) {
  const brand = getBrand(brandId);
  const all = savedMoments(brand);
  const rows = all.slice(0, MEMORY_ASIDE_LIMIT).map((m) => `
    <div class="companion-moment-row">
      <span class="tag">${momentKindLabel(m.kind)}</span>
      <span class="companion-moment-text" style="white-space:normal;" title="${esc(m.detail || m.title)}">${esc(m.title)}</span>
      <button type="button" class="chip-icon-btn" data-chat-moment-del="${m.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
    </div>`).join("");
  return `
    <aside class="card glass-card bs-ideas cp-memory">
      <div class="bs-ideas-head">
        <h2>${icon("heart", { size: 14 })}${t("chat.memory.title")} <span class="text-faint" style="font-weight:600;">${all.length || ""}</span></h2>
        <p class="text-faint" style="font-size:11.5px;margin:2px 0 0;">${esc(t("chat.memory.sub"))}</p>
      </div>
      ${memoryAddFormHTML()}
      <div class="bs-saved-list" style="margin-top:8px;">${rows || `<p class="text-faint" style="font-size:12px;margin:8px 0 0;">${t("chat.memory.empty")}</p>`}</div>
      <div class="bs-card-actions"><button type="button" class="btn btn-secondary btn-sm" data-chat-memory>${icon("expand", { size: 12 })}${t("chat.memory.manage")}</button></div>
    </aside>`;
}

// Phones: the chat page is one column, and the side cards used to pile up
// under the chat (a long scroll to reach Ide Konten / Memori Brand). There
// they become tabs above the chat instead — .cp-mtabs, hidden on wider
// screens where the three columns sit side by side as before.
let mobileTab = "chat";

function pageHTML(brandId) {
  const mode = modeOf(brandId);
  const left = mode === "auto" ? sessionsRailHTML(brandId) : mode === "brainstorm" ? railHTML(brandId) : "";
  const ideas = mode === "auto" || mode === "brainstorm" ? ideasPanelHTML(brandId).replace('<aside class="card glass-card bs-ideas ', '<aside data-pane="ideas" class="card glass-card bs-ideas ') : "";
  const memory = mode === "auto" || mode === "companion" ? memoryPanelHTML(brandId).replace('<aside class="card glass-card bs-ideas cp-memory', '<aside data-pane="memory" class="card glass-card bs-ideas cp-memory') : "";
  // Otomatis shows both things the chat saves into, stacked.
  const right = mode === "auto" ? `<div class="cp-side">${memoryDiffHTML()}${ideas}${memory}</div>` : ideas || memory;
  const tabs = [["chat", t("chat.mtab.chat")], ...(ideas ? [["ideas", t("bs.ideas.title")]] : []), ...(memory ? [["memory", t("chat.memory.title")]] : [])];
  if (!tabs.some(([k]) => k === mobileTab)) mobileTab = "chat";
  const tabsHTML = tabs.length > 1
    ? `<div class="cp-mtabs segmented" role="tablist">${tabs.map(([k, label]) => `<button type="button" role="tab" data-cp-mtab="${k}" class="${k === mobileTab ? "active" : ""}" aria-selected="${k === mobileTab}">${esc(label)}</button>`).join("")}</div>`
    : "";
  return `
    ${tabsHTML}
    <div class="bs-layout cp-page" data-mode="${mode}" data-mtab="${mobileTab}">
      ${left}
      <section class="card glass-card cp-page-chat" data-mode="${mode}">${chatCoreHTML(brandId, true)}</section>
      ${right}
    </div>`;
}

// ---- Render + wire ----------------------------------------------------------

function scrollToBottom() {
  const el = qs("#consultant-messages");
  if (el) el.scrollTop = el.scrollHeight;
}

// Reveals a freshly rendered assistant bubble word-by-word — purely cosmetic
// (the full reply is already in). Skipped when the OS asks for reduced motion.
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
    if (shown >= total) { typewriterRaf = null; el.classList.remove("is-typing"); return; }
    typewriterRaf = requestAnimationFrame(frame);
  };
  typewriterRaf = requestAnimationFrame(frame);
}

// The page's address follows the open Brainstorm conversation (without a
// hashchange, which would re-render mid-answer).
function syncPageUrl(brandId) {
  if (!page || page.brandId !== brandId) return;
  const mode = modeOf(brandId);
  const id = mode === "auto" ? currentSessionOf(brandId)?.id : mode === "brainstorm" && brainstormThread.get(brandId) && getBrainstorm(brainstormThread.get(brandId)) ? brainstormThread.get(brandId) : null;
  const url = id ? `#/brand/${brandId}/chat/${id}` : `#/brand/${brandId}/chat`;
  if (location.hash !== url) history.replaceState(null, "", url);
}

// Every change redraws the chat (innerHTML), so what the owner was in the
// middle of is carried across: the text in the box (unless `keep` is off —
// right after sending), the reading position (a new message scrolls down,
// anything else stays put), the answer still being written, and the caret.
function renderPanel(brandId, { seed = "", keep = true, focus = null, sync = false } = {}) {
  if (hostBrand() !== brandId) return;
  const host = page ? page.el : qs("#consultant-panel");
  if (!host) return;
  const prevInput = qs("#consultant-input", host);
  const typed = seed || carryDraft || (keep ? prevInput?.value || "" : "");
  carryDraft = "";
  const hadFocus = !!prevInput && document.activeElement === prevInput;
  const prevBody = qs("#consultant-messages", host);
  const nearBottom = prevBody ? prevBody.scrollHeight - prevBody.scrollTop - prevBody.clientHeight < 48 : true;
  const prevScroll = prevBody?.scrollTop || 0;
  const history = historyFor(brandId);
  const newMessage = history.length !== renderedCount;

  // The panel takes the open tab's colour (css: --cp-accent).
  if (!page) host.dataset.mode = modeOf(brandId);
  const html = (page ? pageHTML(brandId) : panelHTML(brandId)).replaceAll("__BRAND__", brandId);
  if (sync && html === lastHTML && qs("#consultant-messages", host)) return;
  lastHTML = html;
  renderedCount = history.length;
  host.innerHTML = html;
  if (page) {
    flashIdeas = false;
    syncPageUrl(brandId);
  }
  if (pending) pendingBubble(streamShown);
  // A background sync keeps the reading position; only a new message (or
  // the owner's own action while at the bottom) follows the tail down.
  if (newMessage || pending || (nearBottom && !sync)) scrollToBottom();
  else { const body = qs("#consultant-messages", host); if (body) body.scrollTop = prevScroll; }

  const input = qs("#consultant-input", host);
  if (typed) input.value = typed;
  const autosize = () => {
    input.style.height = "auto";
    if (input.value) input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    input.style.overflowY = input.value && input.scrollHeight > 140 ? "auto" : "hidden";
  };
  autosize();
  input.addEventListener("input", autosize);
  const wantFocus = focus === true || hadFocus || (focus !== false && !isTouch() && !page);
  if (!pending && wantFocus) {
    input.focus();
    if (typed) input.setSelectionRange(input.value.length, input.value.length);
  }
  wire(host, brandId, input, history);
  if (!pending) persistChat(brandId);
}

function wire(host, brandId, input, history) {
  const $ = (sel) => host.querySelectorAll(sel);
  const on = (sel, fn) => $(sel).forEach((el) => el.addEventListener("click", (e) => fn(el, e)));
  const mode = modeOf(brandId);
  const rerender = (opts) => renderPanel(brandId, opts);
  const refAt = (ref) => { const [mi, j] = ref.split(":").map(Number); return { h: history[mi], j }; };

  // Sending: Enter from a physical keyboard; on a touch keyboard Enter is a
  // new line and the round button sends, as in every chat app there.
  const send = () => sendMessage(brandId, input.value.trim());
  qs("#consultant-send", host).addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isTouch()) { e.preventDefault(); send(); }
  });
  const mic = qs("#consultant-mic", host);
  if (mic) wireMic(mic, input);

  // Screenshots: the image button, pasting into the box, or dropping
  // anywhere on the chat. Kept in `attachments` until the message is sent.
  const fileInput = qs("#consultant-image-file", host);
  qs("#consultant-image", host)?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => { addImages(brandId, e.target.files); e.target.value = ""; });
  input.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); addImages(brandId, files); }
  });
  let dragDepth = 0;
  host.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); dragDepth++; host.classList.add("is-dragging"); } });
  host.addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  host.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) host.classList.remove("is-dragging"); });
  host.addEventListener("drop", (e) => { dragDepth = 0; host.classList.remove("is-dragging"); if (e.dataTransfer?.files?.length) { e.preventDefault(); addImages(brandId, e.dataTransfer.files); } });
  on("[data-attach-remove]", (el) => {
    const list = attachments.get(brandId) || [];
    list.splice(Number(el.dataset.attachRemove), 1);
    attachments.set(brandId, list);
    rerender({ focus: true });
  });
  on("[data-chat-metrics-save]", (el) => openMetricsPicker(brandId, history[Number(el.dataset.chatMetricsSave)]));
  qs("#chat-ideas-now", host)?.addEventListener("click", () => sendMessage(brandId, input.value.trim() || t("chat.ideasNow.message"), { engine: "brainstorm", bsMode: "ideas" }));

  // Size, close, new, delete.
  on("[data-chat-close]", () => togglePanel(brandId, false));
  on("[data-chat-expand]", () => expandToPage(brandId));
  on("[data-chat-shrink]", () => shrinkToPanel());
  on("[data-chat-new]", () => { startConversation(brandId, { auto: mode === "auto" }); tails.delete(tailKey(brandId, mode)); rerender({ focus: true }); });
  const confirmDelete = () => confirmDialog({ title: t("bs.ideas.deleteThreadConfirm.title"), message: t("bs.ideas.deleteThreadConfirm.body"), confirmLabel: t("bs.ideas.deleteThread"), danger: true });
  // Each tab clears its own log: Brainstorm deletes the conversation,
  // Konsultan empties its thread, Teman empties its chat — brand memory
  // (the moments) stays, that is the whole point of it.
  const clearCurrent = async () => {
    if (mode === "brainstorm") {
      if (!(await confirmDelete())) return;
      const th = currentThread(brandId);
      if (th && !ROLLING_THREAD_MODES.includes(th.mode)) deleteBrainstorm(th.id);
      startConversation(brandId);
      toast(t("bs.ideas.deleted"));
    } else {
      const ok = await confirmDialog({ title: t(`chat.clear.${mode}`), message: t(`chat.clearConfirm.${mode}`), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      const th = rollingThread(brandId, mode);
      if (th) updateBrainstorm(th.id, { messages: [] });
      tails.delete(tailKey(brandId, mode));
      hints.delete(brandId);
      toast(t("companion.chat.cleared"));
    }
    rerender();
  };
  on("[data-chat-clear]", clearCurrent);

  // The toolbar's two menus.
  on("[data-chat-modes]", (btn) => openModesMenu(brandId, btn));
  on("[data-chat-saved-menu]", (btn) => openSavedMenu(brandId, btn));
  // Pemula's "back to Otomatis" link.
  on("[data-chat-mode]", (btn) => {
    if (pending) return;
    setMode(brandId, btn.dataset.chatMode);
    rerender({ focus: !isTouch() });
  });
  // "Ask this in another tab" — same question, other tab, no retyping.
  on("[data-chat-switch]", (btn) => {
    hints.delete(brandId);
    sendMessage(brandId, btn.dataset.chatQ, { view: btn.dataset.chatSwitch });
  });
  // Otomatis, "Bukan ini maksudmu?": the question leaves the log it landed
  // in (with its answer) and is asked again in the other one.
  on("[data-chat-retry-toggle]", (btn) => btn.closest(".consultant-msg")?.querySelector(".cp-switch")?.toggleAttribute("hidden"));
  on("[data-chat-retry]", (btn) => {
    const last = [...history].reverse().find((h) => h.role === "assistant" && h.question && h.engine && !h.ephemeral);
    if (!last) return;
    if (last.threadId) {
      if (last.msgId) removeBrainstormMessage(last.threadId, last.msgId);
      if (last.questionId) removeBrainstormMessage(last.threadId, last.questionId);
    }
    sendMessage(brandId, last.question, { engine: btn.dataset.chatRetry });
  });

  // Starters and follow-up chips: a real message, pre-routed when the chip
  // knows where it came from. Open-ended ones ("…") go into the box.
  on("[data-chat-ask]", (btn) => {
    const q = btn.dataset.chatAsk;
    const engine = btn.dataset.chatEngine || null;
    if (q.endsWith("…")) {
      if (engine && mode === "auto") seedEngine.set(brandId, engine);
      else if (engine) setMode(brandId, engine);
      rerender({ seed: `${q} `, focus: true });
      return;
    }
    sendMessage(brandId, q, { engine });
  });
  on("[data-chat-more]", () => sendMessage(brandId, t("bs.opt.moreMsg"), { engine: "brainstorm", bsMode: "ideas" }));
  on("[data-chat-go-ideas]", () => sendMessage(brandId, t("bs.ideasNow.message"), { engine: "brainstorm", bsMode: "ideas" }));
  on("[data-chat-answer]", () => { answerHint = true; if (mode === "auto") seedEngine.set(brandId, "brainstorm"); else setMode(brandId, "brainstorm"); rerender({ focus: true }); });

  // "Salin": the answer's text, without the buttons under it.
  on("[data-chat-copy]", async (btn) => {
    const h = history[Number(btn.dataset.chatCopy)];
    if (!h?.text) return;
    try {
      await navigator.clipboard.writeText(h.text);
      btn.classList.add("is-done");
      const label = btn.querySelector("span");
      if (label) label.textContent = t("chat.copied");
      setTimeout(() => { btn.classList.remove("is-done"); if (label) label.textContent = t("chat.copy"); }, 1600);
    } catch {
      toast(t("chat.copyFailed"), "error");
    }
  });

  // Drafts ([[draft:FUNNEL|Title]], Brainstorm): into the conversation's scope.
  on("[data-rev-apply]", (btn) => {
    const [threadId, msgId, i] = btn.dataset.revApply.split("|");
    const th = getBrainstorm(threadId);
    if (!th) return;
    const rev = setRevisionApplied(threadId, msgId, Number(i), true);
    if (!rev) return;
    scriptUndo.set(btn.dataset.revApply, scriptPiece(th)[rev.target] || "");
    putRevision(th, rev.target, rev.text);
    toast(t("cr.disc.appliedToast"));
    renderPanel(brandId);
  });
  on("[data-rev-undo]", (btn) => {
    const key = btn.dataset.revUndo;
    const [threadId, msgId, i] = key.split("|");
    const th = getBrainstorm(threadId);
    const rev = th && setRevisionApplied(threadId, msgId, Number(i), false);
    if (!rev) return;
    putRevision(th, rev.target, scriptUndo.get(key) ?? "");
    scriptUndo.delete(key);
    toast(t("cr.disc.undone"));
    renderPanel(brandId);
  });
  on("[data-script-regen]", (btn) => {
    const th = currentThread(brandId);
    const host = th && scriptHosts.get(th.id);
    if (!host?.onRegenerate) return;
    // Guidance = the owner's last ask + the AI's newest reply, trimmed.
    const msgs = (th.messages || []).filter((x) => x.text);
    const guidance = msgs.slice(-2).map((x) => `${x.role === "user" ? "Owner" : "AI"}: ${x.text}`).join("\n").slice(0, 900);
    togglePanel(brandId, false);
    host.onRegenerate(btn.dataset.scriptRegen, guidance);
  });
  on("[data-consultant-draft]", (btn) => {
    const { h, j } = refAt(btn.dataset.consultantDraft);
    const d = h?.drafts?.[j];
    if (!d || d.contentId) return;
    const item = draftFromScope(brandId, { title: d.title, funnel: d.funnel, idea: h.question ? t("cons.draftIdea", { question: h.question }) : "" });
    d.contentId = item.id;
    syncThreadBlocks(h);
    toast(t("cons.draftSaved", { title: d.title }));
    rerender();
  });
  // Scripts ([[script:…]]): "Setujui" makes the draft — script, caption,
  // format and funnel filled in, placed in the conversation's scope — and
  // the card turns into a link to it.
  on("[data-script-approve]", (btn) => {
    const { h, j } = refAt(btn.dataset.scriptApprove);
    const sc = h?.scripts?.[j];
    if (!sc || sc.contentId) return;
    const item = draftFromScope(brandId, { title: sc.title, funnel: sc.funnel, idea: h.question ? t("cons.draftIdea", { question: h.question }) : "" });
    updateContent(item.id, { ...matchFormat(sc.format), script: sc.script, caption: sc.caption || "", status: "draft" });
    sc.contentId = item.id;
    syncThreadBlocks(h);
    toast(t("chat.script.savedToast", { title: sc.title }));
    rerender();
  });
  on("[data-script-open]", (btn) => { leaveTo(brandId, `#/brand/${brandId}/content/creator/${btn.dataset.scriptOpen}`); });
  on("[data-script-copy]", async (btn) => {
    const { h, j } = refAt(btn.dataset.scriptCopy);
    const sc = h?.scripts?.[j];
    if (!sc) return;
    try {
      await navigator.clipboard.writeText([sc.title, "", sc.script, sc.caption ? `\nCaption:\n${sc.caption}` : ""].join("\n").trim());
      toast(t("chat.script.copied"));
    } catch {
      toast(t("chat.copyFailed"), "error");
    }
  });
  on("[data-consultant-open-draft]", (btn) => { leaveTo(brandId, `#/brand/${brandId}/content/creator/${btn.dataset.consultantOpenDraft}`); });

  // Idea cards.
  on("[data-chat-idea-draft]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatIdeaDraft);
    const idea = h?.ideas?.[j];
    if (!idea || idea.contentId) return;
    idea.contentId = draftFromScope(brandId, { title: idea.title, idea: t("bs.idea.fromChat", { why: idea.why || "" }) }).id;
    syncThreadBlocks(h);
    toast(t("bs.idea.draftToast", { title: idea.title }));
    rerender();
  });
  on("[data-chat-idea-script]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatIdeaScript);
    const idea = h?.ideas?.[j];
    if (!idea) return;
    if (!idea.contentId) { idea.contentId = draftFromScope(brandId, { title: idea.title, idea: t("bs.idea.fromChat", { why: idea.why || "" }) }).id; syncThreadBlocks(h); }
    persistChat(brandId);
    if (!page) togglePanel(brandId, false);
    go(`#/brand/${brandId}/content/creator/${idea.contentId}`, { fromLabel: t("bs.eyebrow"), campaignId: chatScopeInfo(brandId).campaign?.id || null, contentId: idea.contentId, intent: "script" });
  });
  on("[data-chat-idea-use]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatIdeaUse);
    const idea = h?.ideas?.[j];
    const content = chatScopeInfo(brandId).content;
    if (!idea || !content) return;
    const existing = getContent(content.id)?.idea || "";
    updateContent(content.id, { idea: [existing, `${idea.title}${idea.why ? ` — ${idea.why}` : ""}`].filter(Boolean).join("\n\n") });
    idea.usedHere = true;
    syncThreadBlocks(h);
    toast(t("bs.idea.usedToast"));
    rerender();
  });
  on("[data-chat-idea-save]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatIdeaSave);
    const idea = h?.ideas?.[j];
    if (!idea || idea.saved) return;
    saveIdeaScoped(brandId, { title: idea.title, why: idea.why || "" });
    idea.saved = true;
    syncThreadBlocks(h);
    toast(t("bs.idea.savedToast", { title: idea.title }));
    flashIdeas = true;
    rerender();
  });
  on("[data-chat-save-all]", (btn) => {
    const h = history[Number(btn.dataset.chatSaveAll)];
    const todo = (h?.ideas || []).filter((i) => !i.saved);
    if (!todo.length) return;
    todo.forEach((idea) => { saveIdeaScoped(brandId, { title: idea.title, why: idea.why || "" }); idea.saved = true; });
    syncThreadBlocks(h);
    toast(t("bs.idea.savedManyToast", { n: todo.length }));
    flashIdeas = true;
    rerender();
  });
  on("[data-chat-see-saved]", () => {
    const el = page?.el.querySelector(".bs-ideas");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash");
  });

  // "Rencanakan minggu ini" — the weekPlan card. Every row edit (tick, date,
  // campaign) is a plain in-memory change written straight back through
  // syncThreadBlocks, same as ticking an idea card; nothing touches
  // js/store.js content until "Masukkan ke kalender" actually saves.
  on("[data-week-pick]", (cb) => {
    const { h, j } = refAt(cb.dataset.weekPick);
    const it = h?.weekPlan?.items?.[j];
    if (!it || it.contentId) return;
    it.picked = cb.checked;
    syncThreadBlocks(h);
    rerender();
  });
  // Date and campaign are edited via "change", not a click — `on()` above
  // only ever listens for clicks, so these two are wired directly.
  $("[data-week-date]").forEach((input) => input.addEventListener("change", () => {
    const { h, j } = refAt(input.dataset.weekDate);
    const it = h?.weekPlan?.items?.[j];
    if (!it || it.contentId) return;
    const today = localISODate();
    if (!input.value || input.value < today) { toast(t("chat.week.pastDate"), "error"); input.value = it.date; return; }
    it.date = input.value;
    syncThreadBlocks(h);
  }));
  $("[data-week-campaign]").forEach((sel) => sel.addEventListener("change", () => {
    const { h, j } = refAt(sel.dataset.weekCampaign);
    const it = h?.weekPlan?.items?.[j];
    if (!it || it.contentId) return;
    const campaign = sel.value ? getCampaign(sel.value) : null;
    it.campaignId = campaign?.id || "";
    it.campaignName = campaign?.name || "";
    syncThreadBlocks(h);
  }));
  $("[data-week-format]").forEach((sel) => sel.addEventListener("change", () => {
    const { h, j } = refAt(sel.dataset.weekFormat);
    const it = h?.weekPlan?.items?.[j];
    if (!it || it.contentId) return;
    it.format = sel.value || "";
    syncThreadBlocks(h);
  }));
  on("[data-week-regen]", (btn) => {
    const card = btn.closest(".cp-week");
    const count = Number(card?.querySelector("[data-week-count]")?.value) || null;
    const scopeId = card?.querySelector("[data-week-scope]")?.value || null;
    sendMessage(brandId, t("chat.week.regenMsg"), { engine: "brainstorm", bsMode: "week", weekCount: count, campaignId: scopeId });
  });
  // One row, not the whole week: a plain revision message scoped to that
  // date — reuses the exact same "a plan is open" path as typing in chat,
  // just phrased for the model automatically instead of asking the owner
  // to type it (js/ai.js generateWeekPlan only touches what's asked).
  on("[data-week-regen-item]", (btn) => {
    const { h, j } = refAt(btn.dataset.weekRegenItem);
    const it = h?.weekPlan?.items?.[j];
    if (!it || it.contentId) return;
    sendMessage(brandId, t("chat.week.regenItemMsg", { date: formatDate(it.date), title: it.title }), { engine: "brainstorm", bsMode: "chat" });
  });
  on("[data-week-close]", (btn) => {
    const h = history[Number(btn.dataset.weekClose)];
    if (!h?.weekPlan) return;
    h.weekPlan.closed = true;
    syncThreadBlocks(h);
    rerender();
  });
  on("[data-week-save]", (btn) => {
    const h = history[Number(btn.dataset.weekSave)];
    const wp = h?.weekPlan;
    if (!wp || wp.savedAt) return;
    const todo = wp.items.filter((it) => !it.contentId && it.picked !== false);
    if (!todo.length) return;
    const platform = getSettings().platforms?.[0]?.name || "";
    const weekTag = wp.items[0]?.date || localISODate();
    todo.forEach((it) => {
      const created = createContent(brandId, {
        title: it.title, idea: it.angle, funnel: it.funnel, format: it.format || "", platform,
        status: "idea", scheduleDate: it.date, campaignId: it.campaignId || "", seriesId: it.seriesId || "", fromWeekPlan: weekTag,
      });
      it.contentId = created.id;
    });
    wp.savedAt = Date.now();
    syncThreadBlocks(h);
    toast(t("chat.week.savedToast", { n: todo.length }));
    rerender();
  });

  // Event steps.
  on("[data-chat-task-add]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatTaskAdd);
    const task = h?.tasks?.[j];
    if (!task || task.added) return;
    const phaseId = host.querySelector(`[data-chat-task-phase="${btn.dataset.chatTaskAdd}"]`)?.value || null;
    const res = addEventMilestone(task.campaignId, { title: task.title, why: task.why, target: task.target, unit: task.unit, phaseId });
    if (!res.ok) { toast(t("bs.failed"), "error"); return; }
    task.added = true;
    task.phaseName = phaseNameLabel(res.phase.name);
    syncThreadBlocks(h);
    toast(t("bs.task.toast", { title: task.title, phase: task.phaseName }));
    rerender();
  });
  on("[data-chat-task-save]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatTaskSave);
    const task = h?.tasks?.[j];
    if (!task || task.saved) return;
    saveIdeaScoped(brandId, { title: task.title, why: task.why || "" });
    task.saved = true;
    syncThreadBlocks(h);
    toast(t("bs.idea.savedToast", { title: task.title }));
    flashIdeas = true;
    rerender();
  });

  // An idea the AI offered to keep ([[save:…]]).
  on("[data-chat-offer-save]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatOfferSave);
    const o = h?.saves?.[j];
    if (!o || o.saved) return;
    saveIdeaScoped(brandId, { title: o.title, why: o.why || "" });
    o.saved = true;
    o.skipped = false;
    syncThreadBlocks(h);
    toast(t("bs.idea.savedToast", { title: o.title }));
    flashIdeas = true;
    rerender();
  });
  on("[data-chat-offer-skip]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatOfferSkip);
    const o = h?.saves?.[j];
    if (!o || o.saved) return;
    o.skipped = true;
    syncThreadBlocks(h);
    rerender();
  });

  // Obrolan (Otomatis): the page's rail. (The small panel reaches the list
  // through Tersimpan ▾ → openSavedMenu → openSessionsMenu.)
  on("[data-chat-session]", (btn) => { openSession(brandId, btn.dataset.chatSession); rerender(); });
  on("[data-chat-session-del]", async (btn, e) => { e.preventDefault(); if (await confirmDeleteSession(brandId, btn.dataset.chatSessionDel)) rerender(); });

  // Teman: moments, recap, brand memory, per-message delete.
  on("[data-chat-moment-save]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatMomentSave);
    const m = h?.moments?.[j];
    if (!m || m.saved) return;
    addBrandMoments(brandId, [{ kind: m.kind, title: m.title, detail: m.detail || "", action: null }]);
    m.saved = true;
    m.skipped = false;
    syncThreadBlocks(h);
    toast(t("chat.moment.toast", { title: m.title }));
    rerender();
  });
  on("[data-chat-moment-skip]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatMomentSkip);
    const m = h?.moments?.[j];
    if (!m || m.saved) return;
    m.skipped = true;
    syncThreadBlocks(h);
    rerender();
  });
  // A moment as a content seed: a fresh brand-wide Brainstorm conversation.
  on("[data-chat-moment-bs]", (btn) => {
    const { h, j } = refAt(btn.dataset.chatMomentBs);
    const m = h?.moments?.[j];
    if (!m) return;
    startConversation(brandId);
    if (mode === "auto") seedEngine.set(brandId, "brainstorm");
    else setMode(brandId, "brainstorm");
    rerender({ seed: t("companion.moment.seed", { title: m.title, detail: m.detail || "" }).replace(/ — $/, ""), focus: true });
  });
  on("[data-chat-recap]", () => runRecap(brandId));
  on("[data-cp-mtab]", (btn) => {
    mobileTab = btn.dataset.cpMtab;
    const pageEl = host.querySelector(".cp-page");
    if (pageEl) pageEl.dataset.mtab = mobileTab;
    host.querySelectorAll("[data-cp-mtab]").forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
  });
  on("[data-chat-resend]", (btn) => {
    const h = history[Number(btn.dataset.chatResend)];
    if (!h?.retry || pending) return;
    tails.delete(tailKey(brandId, modeOf(brandId)));
    sendMessage(brandId, h.retry, { engine: h.retryEngine || null });
  });
  on("[data-chat-recap-save]", (btn) => decideRecap(brandId, btn.dataset.chatRecapSave, true, host));
  on("[data-chat-recap-discard]", (btn) => decideRecap(brandId, btn.dataset.chatRecapDiscard, false, host));
  on("[data-chat-memory]", () => openBrandMemoryModal(brandId, { refresh: () => renderPanel(brandId) }));
  on("[data-chat-msg-mem]", (btn) => {
    const h = history[Number(btn.dataset.chatMsgMem)];
    if (!h?.text) return;
    const entry = saveMemoryText(brandId, h.text);
    if (entry) toast(t("chat.moment.toast", { title: entry.title }));
    rerender();
  });
  // Scoped to the side column: the modal wires its own copy of this form.
  host.querySelectorAll(".cp-memory").forEach((panel) => wireMemoryAddForm(panel, brandId, { onSaved: () => rerender() }));
  on("[data-chat-moment-del]", (btn) => { removeBrandLogEntry(brandId, btn.dataset.chatMomentDel); rerender(); });
  on("[data-chat-msg-del]", (btn) => {
    const th = getCompanionThread(brandId);
    if (th) removeBrainstormMessage(th.id, btn.dataset.chatMsgDel);
    rerender();
  });

  // 👍/👎 under the newest real answer only.
  const lastIdx = history.length - 1;
  const last = history[lastIdx];
  if (last?.role === "assistant" && last.question && last.engine && !last.rated && !last.ephemeral) {
    const lastEl = host.querySelector(`[data-consultant-msg="${lastIdx}"]`);
    mountAiFeedback(lastEl?.querySelector(".cp-msg-tools") || lastEl, {
      brandId,
      feature: last.engine,
      prompt: { question: last.question, history: history.filter((x) => x.role === "user" || x.role === "assistant").slice(0, -2).map((x) => ({ role: x.role, text: x.text })) },
      output: last.text,
      onRated: (rating) => {
        last.rated = rating;
        if (last.threadId && last.msgId) updateBrainstormMessage(last.threadId, last.msgId, { rated: true });
        persistChat(brandId);
      },
    });
  }

  on("[data-consultant-nav]", async (btn) => {
    const path = btn.dataset.consultantNav;
    if (path === "__insights") {
      const { openInsightsModal } = await import("./views/insights-modal.js");
      if (!page) togglePanel(brandId, false);
      openInsightsModal({ brandId });
      return;
    }
    leaveTo(brandId, path ? `#/brand/${brandId}/${path}` : `#/brand/${brandId}`);
  });
  // Any link out of the chat (an open draft, a campaign) tucks the small
  // panel away so the destination is visible.
  $('a[href^="#/"]').forEach((a) => a.addEventListener("click", () => { if (!page) togglePanel(brandId, false); }));

  wireScope(host, brandId, on);
  if (page) wirePage(host, brandId, on, confirmDelete);
}

// Scope picker ("ganti") — brand-wide, a series, a goal or a campaign.
// Changing it mid-conversation starts a new one; the old one stays listed.
function wireScope(host, brandId, on) {
  on("[data-chat-scope]", (btn) => {
    const r = btn.getBoundingClientRect();
    const menu = openMenu(btn, { top: r.bottom + 6, left: r.left });
    if (!menu) return;
    const scope = activeScope(brandId);
    const options = [
      { id: "", label: t("bs.scope.brand") },
      ...listSeries(brandId).map((s) => ({ id: `series:${s.id}`, label: t("series.pick", { name: s.name }) })),
      ...listGoals(brandId).filter((g) => g.status !== "completed").map((g) => ({ id: `goal:${g.id}`, label: t("roadmap.bs.scope", { name: g.name || t("roadmap.defaultName") }) })),
      ...listCampaigns(brandId).filter((c) => c.status !== "archived").map((c) => ({ id: c.id, label: t("bs.scope.campaign", { name: c.name }) })),
    ];
    const currentId = scope.seriesId ? `series:${scope.seriesId}` : scope.goalId ? `goal:${scope.goalId}` : scope.campaignId || "";
    menu.innerHTML = `<div class="text-faint" style="font-size:11px;padding:6px 10px 4px;">${t("bs.scope.pickTitle")}</div>` + options.map((o) => `<button type="button" data-scope="${esc(o.id)}">${o.id === currentId && !scope.contentId ? icon("check", { size: 12 }) : ""}${esc(o.label)}</button>`).join("");
    menu.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
      closeMenu();
      const pick = b.dataset.scope || "";
      if (pick === currentId && !scope.contentId) return;
      const next = pick.startsWith("goal:") ? { goalId: pick.slice(5) } : pick.startsWith("series:") ? { seriesId: pick.slice(7) } : { campaignId: pick || null };
      if (hasMessages(brandId, "brainstorm")) toast(t("bs.scope.changedNew"));
      startConversation(brandId, { scope: next });
      // A scope only shapes Brainstorm; Otomatis keeps it as the place ideas go.
      if (modeOf(brandId) !== "auto") setMode(brandId, "brainstorm");
      renderPanel(brandId, { focus: true });
    }));
  });
}

// Page-only tools: the conversation list, saved ideas, the ⋯ menu.
function wirePage(host, brandId, on, confirmDelete) {
  const rerender = (opts) => renderPanel(brandId, opts);
  on("[data-chat-thread]", (btn) => { loadThread(brandId, btn.dataset.chatThread); rerender(); });
  on("[data-chat-thread-del]", async (btn, e) => {
    e.preventDefault();
    const id = btn.dataset.chatThreadDel;
    if (!(await confirmDelete())) return;
    deleteBrainstorm(id);
    if (brainstormThread.get(brandId) === id) startConversation(brandId);
    toast(t("bs.ideas.deleted"));
    rerender();
  });
  host.querySelector(".bs-threads summary [data-chat-new]")?.addEventListener("click", (e) => e.preventDefault(), { capture: true });

  // Saved ideas.
  on("[data-chat-ideas-focus]", () => { ideasFocus = !ideasFocus; rerender(); });
  wireSavedIdeas(host, brandId, { rerender });

  // ⋯ — the less-used Brainstorm actions, so the chat header stays calm.
  on("[data-chat-menu]", (btn) => {
    const r = btn.getBoundingClientRect();
    const menu = openMenu(btn, { top: r.bottom + 6, right: window.innerWidth - r.right });
    if (!menu) return;
    const th = currentThread(brandId);
    const has = hasMessages(brandId, "brainstorm");
    const info = chatScopeInfo(brandId);
    menu.innerHTML = [
      th && (th.messages || []).length >= 2 ? `<button type="button" data-m="idea" title="${esc(t("bs.concept.saveHint"))}">${icon("bookmark", { size: 13 })}${t("bs.concept.save")}</button>` : "",
      !info.series ? `<button type="button" data-m="series" title="${esc(t("series.saveFromChat.hint"))}">${icon("sparkle", { size: 13 })}${t("series.saveFromChat")}</button>` : "",
      has ? `<button type="button" class="danger" data-m="delete">${icon("trash", { size: 13 })}${t("bs.ideas.deleteThread")}</button>` : "",
    ].join("") || `<span class="text-faint" style="padding:8px 12px;font-size:12px;">${t("bs.menu.empty")}</span>`;
    menu.querySelector('[data-m="idea"]')?.addEventListener("click", () => { closeMenu(); saveChatAsIdea(brandId); });
    menu.querySelector('[data-m="series"]')?.addEventListener("click", () => { closeMenu(); saveAsSeries(brandId); });
    menu.querySelector('[data-m="delete"]')?.addEventListener("click", async () => {
      closeMenu();
      if (!(await confirmDelete())) return;
      const cur = currentThread(brandId);
      if (cur && !ROLLING_THREAD_MODES.includes(cur.mode)) deleteBrainstorm(cur.id);
      startConversation(brandId);
      toast(t("bs.ideas.deleted"));
      rerender();
    });
  });
}

// The saved-idea actions, shared by the page's column and the small
// panel's "Tersimpan" window: edit, discuss again, into Creator, delete.
function wireSavedIdeas(root, brandId, { rerender, close = () => {} }) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener("click", (e) => fn(el, e)));
  const ideaById = (id) => savedIdeasFor(brandId).items.find((i) => i.id === id);
  on("[data-chat-saved-open]", (el) => {
    const i = ideaById(el.dataset.chatSavedOpen);
    if (!i) return;
    openConceptModal({ title: i.text, angle: i.description || "", notes: i.notes || "", hooks: i.hooks || [] }, {
      isNew: false,
      onSave: (v) => { patchSavedScoped(brandId, i.id, { text: v.title, description: v.angle, notes: v.notes, hooks: v.hooks }); toast(t("bs.concept.updated")); rerender(); },
    });
  });
  // "Bahas lagi": a fresh conversation about the idea, in the same campaign.
  on("[data-chat-saved-discuss]", (btn) => {
    const i = ideaById(btn.dataset.chatSavedDiscuss);
    if (!i) return;
    const { camp } = savedIdeasFor(brandId);
    close();
    startConversation(brandId, { scope: camp ? { campaignId: camp.id } : null });
    if (modeOf(brandId) === "auto") seedEngine.set(brandId, "brainstorm");
    else setMode(brandId, "brainstorm");
    ideasFocus = false;
    const seed = t("bs.concept.discussSeed", { title: i.text, angle: i.description || "-", notes: (i.notes || "-").replace(/\n+/g, "; ") });
    if (hostBrand() === brandId) renderPanel(brandId, { seed, focus: true });
    else openConsultantPanel({ seed });
  });
  on("[data-chat-saved-draft]", (btn) => {
    const i = ideaById(btn.dataset.chatSavedDraft);
    if (!i) return;
    // Notes and hook candidates travel with the idea into the draft.
    const notes = [i.notes, i.hooks?.length ? `${t("bs.concept.hooksLabel")}:\n${i.hooks.map((h) => `- ${h}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
    const c = draftFromScope(brandId, { title: i.text, idea: i.description || "", notes });
    patchSavedScoped(brandId, i.id, { status: "used", contentId: c.id });
    ideasFocus = false;
    close();
    if (!page) togglePanel(brandId, false);
    go(`#/brand/${brandId}/content/creator/${c.id}`, { fromLabel: t("chat.title"), campaignId: chatScopeInfo(brandId).campaign?.id || null, contentId: c.id, intent: "continue" });
  });
  on("[data-chat-saved-opendraft]", (btn) => {
    ideasFocus = false;
    close();
    if (!page) togglePanel(brandId, false);
    go(`#/brand/${brandId}/content/creator/${btn.dataset.chatSavedOpendraft}`, { fromLabel: t("chat.title"), contentId: btn.dataset.chatSavedOpendraft, intent: "continue" });
  });
  on("[data-chat-saved-delete]", async (btn) => {
    const i = ideaById(btn.dataset.chatSavedDelete);
    if (!i) return;
    const ok = await confirmDialog({ title: t("bs.ideas.deleteIdeaConfirm.title"), message: t("bs.ideas.deleteIdeaConfirm.body", { title: esc(i.text) }), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    removeSavedScoped(brandId, i.id);
    rerender();
  });
}

// Small panel "Tersimpan": the same list as the page's column, in a window.
function openSavedIdeasModal(brandId) {
  const body = () => {
    const { camp, items } = savedIdeasFor(brandId);
    const rows = [...items].reverse().map((i) => {
      const used = i.status === "used" && i.contentId && getContent(i.contentId);
      return `
      <div class="bs-saved-idea ${used ? "is-used" : ""}">
        <div class="bs-saved-text" data-chat-saved-open="${i.id}" title="${esc(t("bs.concept.open"))}"><b>${esc(i.text)}</b>${used ? ` <span class="tag">${t("bs.concept.used")}</span>` : ""}${i.description ? `<span class="text-muted"> — ${esc(i.description)}</span>` : ""}</div>
        <div class="bs-card-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-chat-saved-discuss="${i.id}">${icon("chat", { size: 12 })}${t("bs.concept.discuss")}</button>
          ${used
            ? `<button type="button" class="btn btn-secondary btn-sm" data-chat-saved-opendraft="${esc(i.contentId)}">${icon("check", { size: 12 })}${t("bs.concept.openDraft")}</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-chat-saved-draft="${i.id}">${icon("edit", { size: 12 })}${t("bs.concept.toCreator")}</button>`}
          <button type="button" class="chip-icon-btn" data-chat-saved-delete="${i.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
        </div>
      </div>`;
    }).join("");
    return `<p class="text-muted" style="font-size:12.5px;margin:0 0 6px;">${esc(camp ? t("bs.ideas.sub.campaign") : t("bs.ideas.sub.brand"))}</p>${memoryDiffHTML()}${rows || `<div class="table-empty" style="padding:20px;">${t("bs.ideas.empty")}</div>`}`;
  };
  const overlay = openModal({ title: t("bs.ideas.title"), wide: true, bodyHTML: body(), footHTML: `<button type="button" class="btn btn-secondary" id="saved-close">${t("common.close")}</button>` });
  const close = () => closeOverlay(overlay);
  const paint = () => {
    overlay.querySelector(".modal-body").innerHTML = body();
    wireSavedIdeas(overlay, brandId, { rerender: () => { paint(); if (hostBrand() === brandId) renderPanel(brandId); }, close });
  };
  overlay.querySelector("#saved-close").addEventListener("click", close);
  wireSavedIdeas(overlay, brandId, { rerender: () => { paint(); if (hostBrand() === brandId) renderPanel(brandId); }, close });
}

// Small panel "Obrolan": the newest conversations and "Obrolan baru".
function openSessionsMenu(brandId, btn) {
  const r = btn.getBoundingClientRect();
  const menu = openMenu(btn, { className: "cp-menu", top: r.bottom + 6, left: r.left });
  if (!menu) return;
  const current = currentSessionOf(brandId)?.id || null;
  const list = listSessions(brandId).slice(0, SESSIONS_MENU_LIMIT);
  menu.innerHTML = `<button type="button" data-s-new>${icon("plus", { size: 13 })}${t("chat.scope.new")}</button>`
    + (list.length ? `<div class="text-faint" style="font-size:11px;padding:6px 10px 4px;">${t("chat.sessions.recent")}</div>` : "")
    + list.map((x) => `<button type="button" data-s-open="${x.id}">${x.id === current ? icon("check", { size: 12 }) : ""}${esc(x.title || t("bs.threads.untitled"))}</button>`).join("")
    + (listSessions(brandId).length > SESSIONS_MENU_LIMIT ? `<button type="button" data-s-all>${icon("expand", { size: 12 })}${t("chat.sessions.all")}</button>` : "");
  menu.querySelector("[data-s-new]")?.addEventListener("click", () => { closeMenu(); startConversation(brandId, { auto: true }); renderPanel(brandId, { focus: true }); });
  menu.querySelectorAll("[data-s-open]").forEach((b) => b.addEventListener("click", () => { closeMenu(); openSession(brandId, b.dataset.sOpen); renderPanel(brandId); }));
  menu.querySelector("[data-s-all]")?.addEventListener("click", () => { closeMenu(); expandToPage(brandId); });
}

function openSession(brandId, id) {
  if (!getSession(brandId, id)) return;
  currentSession.set(brandId, id);
  pendingScope.delete(brandId);
  hints.delete(brandId);
  tails.delete(tailKey(brandId, "auto"));
  setMode(brandId, "auto");
  noKeyNotice = false;
  answerHint = false;
  renderedCount = -1;
}

async function confirmDeleteSession(brandId, id) {
  const ok = await confirmDialog({ title: t("chat.sessions.deleteConfirm.title"), message: t("chat.sessions.deleteConfirm.body"), confirmLabel: t("common.delete"), danger: true });
  if (!ok) return false;
  deleteSession(brandId, id);
  toast(t("bs.ideas.deleted"));
  return true;
}

// Edit-before-save form for an idea: the AI's summary of a chat, or a saved
// idea being opened. Hooks are one per line.
function openConceptModal(f, { isNew, onSave }) {
  const overlay = openModal({
    title: isNew ? t("bs.concept.modalNew") : t("bs.concept.modalEdit"),
    wide: true,
    bodyHTML: `
      <div class="field"><label>${t("bs.concept.title")}</label><input class="input" id="cm-title" maxlength="140" value="${esc(f.title || "")}" /></div>
      <div class="field"><label>${t("bs.concept.angle")}</label><textarea class="textarea" id="cm-angle" style="min-height:64px;">${esc(f.angle || "")}</textarea></div>
      <div class="field"><label>${t("bs.concept.notes")}</label><textarea class="textarea" id="cm-notes" style="min-height:90px;">${esc(f.notes || "")}</textarea></div>
      <div class="field"><label>${t("bs.concept.hooks")}</label><textarea class="textarea" id="cm-hooks" style="min-height:90px;">${esc((f.hooks || []).join("\n"))}</textarea></div>`,
    footHTML: `<button type="button" class="btn btn-secondary" id="cm-cancel">${t("common.cancel")}</button><button type="button" class="btn btn-primary" id="cm-save">${t("bs.concept.saveBtn")}</button>`,
  });
  overlay.querySelector("#cm-cancel").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("#cm-save").addEventListener("click", () => {
    const title = overlay.querySelector("#cm-title").value.trim();
    if (!title) { toast(t("bs.concept.needTitle"), "error"); return; }
    onSave({
      title,
      angle: overlay.querySelector("#cm-angle").value.trim(),
      notes: overlay.querySelector("#cm-notes").value.trim(),
      hooks: overlay.querySelector("#cm-hooks").value.split("\n").map((h) => h.trim()).filter(Boolean).slice(0, 6),
    });
    closeOverlay(overlay);
  });
}

// "Simpan diskusi ini jadi ide": AI summary → editable → saved.
async function saveChatAsIdea(brandId) {
  const ai = getSettings().ai || {};
  if (!hasAiKey(ai)) { toast(t("bs.noKey"), "error"); return; }
  const th = currentThread(brandId);
  if (!th) return;
  toast(t("bs.concept.saving"));
  try {
    const f = await summarizeConcept(ai, { brand: getBrand(brandId), messages: th.messages || [], scopeText: chatScopeInfo(brandId).label });
    openConceptModal(f, {
      isNew: true,
      onSave: (v) => { saveIdeaScoped(brandId, { title: v.title, why: v.angle, notes: v.notes, hooks: v.hooks }); toast(t("bs.concept.saved")); flashIdeas = true; renderPanel(brandId); },
    });
  } catch (err) {
    toast(err instanceof AiApiError ? err.message : t("bs.concept.fail"), "error");
  }
}

// "Simpan sebagai Content Series": the same form as the Series tab; this
// conversation then continues as that series.
async function saveAsSeries(brandId) {
  const { openSeriesModal } = await import("./views/series.js");
  openSeriesModal({
    brandId,
    onSaved: (saved) => {
      if (!saved) return;
      const th = currentThread(brandId);
      if (th) updateBrainstorm(th.id, { ...EMPTY_SCOPE, seriesId: saved.id });
      else pendingScope.set(brandId, { ...EMPTY_SCOPE, seriesId: saved.id });
      renderPanel(brandId);
    },
  });
}

// Loads a saved Brainstorm thread into the transcript, so it carries on
// right here.
function loadThread(brandId, threadId) {
  const th = getBrainstorm(threadId);
  if (!th || ROLLING_THREAD_MODES.includes(th.mode)) return false;
  brainstormThread.set(brandId, threadId);
  pendingScope.delete(brandId);
  hints.delete(brandId);
  setMode(brandId, "brainstorm");
  noKeyNotice = false;
  answerHint = false;
  return true;
}

// A reply's cards also live in its stored thread; keep that copy in step
// (saved / drafted / filed / moment kept) so no list offers the same thing
// twice — and so the Konsultan/Teman transcripts, which are read from the
// thread, show the card's new state on the next render.
function syncThreadBlocks(h) {
  const b = hostBrand() || mountedBrandId;
  if (b) persistChat(b);
  if (!h?.threadId || !h.msgId) return;
  const th = getBrainstorm(h.threadId);
  const msg = th?.messages?.find((m) => m.id === h.msgId);
  if (!msg) return;
  const copy = (list) => (list || []).map((x) => ({ ...x }));
  updateBrainstormMessage(h.threadId, h.msgId, {
    blocks: { ...(msg.blocks || {}), ideas: copy(h.ideas), drafts: copy(h.drafts), ...(h.tasks ? { tasks: copy(h.tasks) } : {}), ...(h.moments ? { moments: copy(h.moments) } : {}), ...(h.saves ? { saves: copy(h.saves) } : {}), ...(h.scripts?.length ? { scripts: copy(h.scripts) } : {}), ...(h.weekPlan ? { weekPlan: { ...h.weekPlan, items: copy(h.weekPlan.items) } } : {}) },
  });
}

// ---- Sending ----------------------------------------------------------------

// The "typing" bubble — dots until the first words arrive, then the answer
// so far (`shown`, already cleaned of directives).
function pendingBubble(shown = "") {
  const messagesEl = qs("#consultant-messages");
  if (!messagesEl || qs("#consultant-pending", messagesEl)) return;
  const inner = shown ? `<div class="consultant-md">${renderLightMarkdown(shown)}</div>` : `<span class="typing-dots" aria-label="${t("cons.typing")}"><i></i><i></i><i></i></span>`;
  messagesEl.insertAdjacentHTML("beforeend", `<div class="consultant-msg consultant-msg-assistant consultant-msg-pending is-new" id="consultant-pending">${inner}</div>`);
  scrollToBottom();
}

// The AI is set up and has quota left — else say so in the chat and stop.
function aiReady(brandId) {
  const ai = getSettings().ai || { provider: "anthropic" };
  if (!hasAiKey(ai)) {
    // Said in the chat, what was typed stays, Settings is one tap away.
    noKeyNotice = true;
    renderPanel(brandId);
    return null;
  }
  if (aiLimitReached()) { renderPanel(brandId); return null; }
  noKeyNotice = false;
  return ai;
}

// After a reply: redraw, reveal the newest bubble.
function finishReply(brandId, { streamed }) {
  pending = false;
  streamShown = "";
  persistChat(brandId);
  // Closed mid-answer, or moved to another brand: the answer waits in the
  // history — nothing to draw now.
  if (hostBrand() !== brandId) return;
  renderPanel(brandId, { focus: isTouch() ? false : null });
  const history = historyFor(brandId);
  const newest = qs(`[data-consultant-msg="${history.length - 1}"]`);
  if (newest) {
    newest.classList.add("is-new");
    // Already visible if it streamed in — only retype a reply that arrived whole.
    if (!streamed) typewriterReveal(newest, { onTick: scrollToBottom });
  }
  scrollToBottom();
}

async function addImages(brandId, fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith("image/"));
  if (!files.length || pending) return;
  const list = attachments.get(brandId) || [];
  if (list.length >= MAX_IMAGES) { toast(t("chat.image.max", { n: MAX_IMAGES }), "info"); return; }
  for (const file of files.slice(0, MAX_IMAGES - list.length)) {
    try {
      const full = await resizeImageFile(file, { maxDimension: 1400, format: "image/jpeg", quality: 0.86 });
      const thumb = await thumbnailFromDataUrl(full, { maxDimension: 160 });
      list.push({ full, thumb: thumb || full });
    } catch {
      toast(t("chat.image.tooBig"), "info");
    }
  }
  attachments.set(brandId, list);
  if (files.length > MAX_IMAGES - (list.length - files.length)) toast(t("chat.image.max", { n: MAX_IMAGES }), "info");
  renderPanel(brandId, { focus: true });
}

// "Simpan ke konten…" under a metrics card: pick the published post these
// numbers belong to; the reading is merged into its performance
// (js/retention.js mergeInsightsIntoPerformance) — the same place Quick
// Fill writes to, so Home's widgets pick it up at once.
function openMetricsPicker(brandId, h) {
  if (!h?.metrics || h.metrics.saved) return;
  const all = listContent(brandId).filter((c) => c.status === "published").sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""));
  const overlay = openModal({
    title: t("chat.metrics.pickTitle"),
    bodyHTML: `<input class="input" id="cp-pick-search" placeholder="${esc(t("chat.metrics.pickSearch"))}" /><div class="cp-pick-list" id="cp-pick-list"></div>`,
  });
  const listEl = qs("#cp-pick-list", overlay);
  const draw = (q = "") => {
    const rows = all.filter((c) => !q || (c.title || "").toLowerCase().includes(q));
    listEl.innerHTML = rows.length
      ? rows.slice(0, 40).map((c) => `<button type="button" class="cp-pick-row" data-pick="${esc(c.id)}"><span class="t">${esc(c.title || t("common.untitled"))}</span><span class="m">${esc(c.platform || "")}${c.publishedDate ? ` · ${esc(formatDate(c.publishedDate))}` : ""}</span></button>`).join("")
      : `<div class="text-faint" style="padding:12px 4px;font-size:13px;">${t("chat.metrics.pickEmpty")}</div>`;
    listEl.querySelectorAll("[data-pick]").forEach((btn) => btn.addEventListener("click", () => {
      const c = getContent(btn.dataset.pick);
      if (!c) return;
      updateContent(c.id, { performance: mergeInsightsIntoPerformance(c.performance || {}, h.metrics, "ai") });
      const th = getBrainstorm(h.threadId);
      const msg = th?.messages?.find((m) => m.id === h.msgId);
      if (msg) updateBrainstormMessage(h.threadId, h.msgId, { blocks: { ...(msg.blocks || {}), metrics: { ...h.metrics, saved: { id: c.id, title: c.title || t("common.untitled") } } } });
      closeOverlay(overlay);
      toast(t("chat.metrics.saved", { title: c.title || t("common.untitled") }));
      renderPanel(brandId);
    }));
  };
  qs("#cp-pick-search", overlay).addEventListener("input", (e) => draw(e.target.value.trim().toLowerCase()));
  draw();
}

// `view` opens that view first (a "Tanya di X" chip); `engine` answers with
// that engine (a chip, "Langsung kasih ide", a retry) — in a single-engine
// view a different engine opens its view, in Otomatis it just answers.
// ---- Script discussion (Creator's "Diskusi") -----------------------------------
// It used to be a second chat of its own inside Creator (own drawer, own
// renderer, own send loop). It is this chat now, in the piece's own thread
// (`script-<contentId>`, mode "script"): Creator registers how to read the
// piece, put a revision into it and restart the AI writer; the chat does the
// talking. A revision can be applied (and undone) straight from the reply —
// with no Creator open, it goes into the saved piece directly.
const SCRIPT_CHIPS = ["critique", "hook", "angle", "shorter", "brand"];
const SCRIPT_HISTORY = 12;
const scriptHosts = new Map(); // threadId -> { contentId, getCurrent, applyRevision, onRegenerate }
const scriptUndo = new Map(); // "threadId|msgId|i" -> text before the revision went in
// A script talk is about one piece; closing the chat hands it back to
// whatever it showed before, so the next ordinary question doesn't land in
// that piece's thread.
const modeBeforeScript = new Map();
function leaveScriptThread(brandId) {
  if (currentThread(brandId)?.mode !== "script") return;
  brainstormThread.delete(brandId);
  setMode(brandId, modeBeforeScript.get(brandId) || "auto");
  modeBeforeScript.delete(brandId);
  qs("#consultant-panel")?.classList.remove("is-above-modal");
}

export function openScriptChat({ contentId, title = "", getCurrent = null, applyRevision = null, onRegenerate = null } = {}) {
  const brandId = page ? page.brandId : mountedBrandId;
  if (!brandId || !contentId) return;
  const threadId = `script-${contentId}`;
  if (!getBrainstorm(threadId)) createBrainstorm(brandId, { id: threadId, mode: "script", contentId, title });
  scriptHosts.set(threadId, { contentId, getCurrent, applyRevision, onRegenerate });
  if (currentThread(brandId)?.mode !== "script") modeBeforeScript.set(brandId, modeOf(brandId));
  loadThread(brandId, threadId);
  togglePanel(brandId, true, { focus: true });
  // Opened from inside a dialog (Creator's AI writer): sit above it.
  qs("#consultant-panel")?.classList.toggle("is-above-modal", !!document.querySelector(".overlay"));
}

function scriptPiece(th) {
  const host = scriptHosts.get(th.id);
  return host?.getCurrent?.() || getContent(th.contentId) || {};
}

async function sendScriptMessage(brandId, th, text, ai) {
  if (pending) return;
  const history = (th.messages || []).slice(-SCRIPT_HISTORY);
  appendBrainstormMessage(th.id, { role: "user", text });
  pending = true;
  streamShown = "";
  renderPanel(brandId, { keep: false });
  pendingBubble();
  let streamed = false;
  try {
    const brand = getBrand(brandId);
    const piece = scriptPiece(th);
    const reply = await discussScript(ai, {
      brand,
      campaigns: listCampaigns(brandId),
      pulseText: pulseNow(brandId),
      content: piece,
      series: piece.seriesId ? getSeries(piece.seriesId) : null,
      seriesEpisodes: piece.seriesId ? seriesEpisodeTitles(getSeries(piece.seriesId), listContent(brandId)).filter((x) => x !== piece.title) : [],
      history,
      message: text,
      onText: (soFar) => {
        const shown = parseDirectives(soFar).cleanText;
        const bubble = qs("#consultant-pending");
        if (!shown || !bubble) return;
        streamed = true;
        bubble.innerHTML = `<div class="consultant-md">${renderLightMarkdown(shown)}</div>`;
        scrollToBottom();
      },
    });
    const parsed = parseDirectives(reply);
    appendBrainstormMessage(th.id, {
      role: "assistant",
      text: parsed.cleanText,
      blocks: parsed.revisions.length ? { revisions: parsed.revisions.map((r) => ({ ...r, applied: false })) } : null,
    });
  } catch (err) {
    toast(err instanceof AiApiError ? err.message : t("cr.disc.fail"), "error");
  } finally {
    finishReply(brandId, { streamed });
  }
}

function setRevisionApplied(threadId, msgId, index, applied) {
  const m = (getBrainstorm(threadId)?.messages || []).find((x) => x.id === msgId);
  if (!m?.blocks?.revisions?.[index]) return null;
  const revisions = m.blocks.revisions.map((r, i) => (i === index ? { ...r, applied } : r));
  updateBrainstormMessage(threadId, msgId, { blocks: { ...m.blocks, revisions } });
  return revisions[index];
}
function putRevision(th, target, text) {
  const host = scriptHosts.get(th.id);
  if (host?.applyRevision) host.applyRevision(target, text);
  else if (th.contentId) updateContent(th.contentId, { [target]: text });
}

async function sendMessage(brandId, text, { view = null, engine = null, bsMode = "chat", weekCount = null, campaignId = null } = {}) {
  // A photo always goes to the Konsultan: it is the engine that reads
  // numbers and has the brand's tracked data to compare them with.
  const images = attachments.get(brandId) || [];
  if (images.length) { engine = "consultant"; if (!text) text = t("chat.image.defaultQuestion"); }
  if (!text || pending) return;
  if (view) setMode(brandId, view);
  if (engine && modeOf(brandId) !== "auto" && modeOf(brandId) !== engine) setMode(brandId, engine);
  const cur = modeOf(brandId);
  const ai = aiReady(brandId);
  if (!ai) return;
  const scriptTh = currentThread(brandId);
  if (scriptTh?.mode === "script" && !images.length) return sendScriptMessage(brandId, scriptTh, text, ai);
  // Only now: with no AI key the photos stay in the composer, next to the notice.
  attachments.delete(brandId);
  answerHint = false;
  hints.delete(brandId);
  const tk = tailKey(brandId, cur);
  // Shown at once; stored in its engine's log once the engine is known.
  tails.set(tk, [{ role: "user", text, images: images.map((a) => a.thumb) }]);
  pending = true;
  streamShown = "";
  renderPanel(brandId, { keep: false });
  qs(`[data-consultant-msg="${historyFor(brandId).length - 1}"]`)?.classList.add("is-new");
  const sendBtn = qs("#consultant-send");
  if (sendBtn) { sendBtn.classList.add("is-sent"); setTimeout(() => sendBtn.classList.remove("is-sent"), 400); }

  // The answer fills in as it is written (js/ai.js callClaudeStream).
  let streamed = false;
  let streamTimer = 0;
  let streamRaw = "";
  const streamInto = (raw, { whole = false } = {}) => {
    // A provider that can't stream hands the finished reply over in one
    // piece — leave it to finishReply's typewriter instead of slapping the
    // whole answer on screen at once.
    if (whole) return;
    streamed = true;
    streamRaw = raw;
    if (streamTimer) return;
    streamTimer = setTimeout(() => {
      streamTimer = 0;
      let shown = parseDirectives(streamRaw).cleanText;
      const open = shown.lastIndexOf("[[");
      if (open !== -1 && !shown.slice(open).includes("]]")) shown = shown.slice(0, open);
      shown = shown.replace(/\[$/, "").trim();
      // A script block is still being written: say so instead of a stall.
      if (/\[\[script:/i.test(streamRaw) && !/\[\[\/script\]\]/i.test(streamRaw)) shown = `${shown}\n\n*${t("chat.script.writing")}*`.trim();
      if (!shown || !pending) return;
      streamShown = shown;
      const bubble = qs("#consultant-pending");
      if (!bubble) return;
      bubble.innerHTML = `<div class="consultant-md">${renderLightMarkdown(shown)}</div>`;
      scrollToBottom();
    }, 40);
  };

  // A weekPlan card still open in THIS transcript owns the next message —
  // in Otomatis as much as in the Pro Brainstorm tab — so a typed follow-up
  // ("yang Rabu ganti lebih jualan"), or a per-row "Ganti ide ini" (which
  // sends its own text with engine forced to "brainstorm", same as every
  // other button-triggered chat message), revises it instead of being
  // routed like a normal question. Never guessed from keywords (those
  // misroute real revisions); the model itself says whether the message
  // was even about the plan (generateWeekPlan's `changed`). Excluded: a
  // photo (forces "consultant") or an explicit non-brainstorm engine.
  const planEntry = (!engine || engine === "brainstorm") && !images.length && (cur === "auto" || cur === "brainstorm")
    ? currentPlanEntry(cur === "auto" ? autoEntries(brandId) : threadEntries(currentThread(brandId), "brainstorm"))
    : null;

  let picked = cur;
  let sessionId = null;
  try {
    if (cur === "auto") {
      sessionId = ensureSession(brandId, text).id;
      const seeded = seedEngine.get(brandId) || null;
      seedEngine.delete(brandId);
      picked = MODES.includes(engine) ? engine : planEntry || bsMode === "week" ? "brainstorm" : seeded || (await decideEngine(ai, text, historyFor(brandId, "auto")));
    }
    const brand = getBrand(brandId);
    const pulseText = pulseNow(brandId);

    if (picked === "brainstorm" && (bsMode === "week" || (bsMode === "chat" && planEntry))) {
      let th = currentThread(brandId);
      if (!th) {
        const scope = activeScope(brandId);
        th = createBrainstorm(brandId, { mode: "chat", title: text.slice(0, THREAD_TITLE_MAX), campaignId: scope.goalId ? null : scope.campaignId || null, stageId: scope.stageId || null, contentId: scope.contentId || null, goalId: scope.goalId || null, seriesId: scope.seriesId || null });
        if (sessionId) patchSession(brandId, sessionId, { threadId: th.id });
        else brainstormThread.set(brandId, th.id);
        pendingScope.delete(brandId);
        syncPageUrl(brandId);
      }
      appendBrainstormMessage(th.id, { role: "user", text, sessionId });
      tails.delete(tk);
      const isRevision = bsMode === "chat" && !!planEntry;
      const settings = getSettings();
      const formatNames = (settings.formats || []).map((f) => f.name).filter(Boolean);
      const contentAll = listContent(brandId);
      const campaigns = listCampaigns(brandId);
      const activeCampaigns = activeCampaignsFor(campaigns);
      // A campaign scope is "sticky" for this plan: pick one explicitly
      // (the entry menu, or the footer's scope select on "Ganti semua") and
      // every later revision — typed in chat, or a per-row "Ganti ide ini"
      // — keeps generating for that same campaign without having to say so
      // again. "Ganti semua" is the only way to change or clear it.
      const scopeCampaignId = bsMode === "week" ? campaignId : isRevision ? planEntry.weekPlan.campaignId || null : null;
      const scopeCampaign = scopeCampaignId ? getCampaign(scopeCampaignId) : null;
      let slots, currentItems = null;
      if (isRevision) {
        currentItems = planEntry.weekPlan.items;
        slots = currentItems.map((it) => it.date);
      } else {
        const plan = planWeek({ todayISO: localISODate(), cadence: brand?.contentCadence, content: contentAll, count: weekCount || undefined });
        slots = plan.slots;
      }
      // Ritme Kerja's series days ("Rabu = Bedah Brand"). A revision keeps
      // each row's own series, even if the owner moved its date.
      const allSeries = listSeries(brandId);
      const days = seriesDays(brand?.contentCadence, allSeries);
      const slotSeries = new Map();
      if (isRevision) currentItems.forEach((it) => { const s = it.seriesId ? getSeries(it.seriesId) : null; if (s) slotSeries.set(it.date, s); });
      else slots.forEach((d) => { const s = seriesForDate(days, d); if (s) slotSeries.set(d, s); });
      if (!slots.length) {
        appendBrainstormMessage(th.id, { role: "assistant", text: t("chat.week.noRoom"), blocks: {}, sessionId });
      } else {
        const result = await generateWeekPlan(ai, {
          brand, campaigns: activeCampaigns, campaign: scopeCampaign, slots, formats: formatNames,
          existingTitles: contentAll.filter((c) => !c.archived && !c.deletedAt).map((c) => c.title).filter(Boolean),
          pulseText, current: currentItems, request: isRevision ? text : "",
          seriesOverview: buildSeriesOverview(allSeries, contentAll, { days }),
          seriesSlots: [...slotSeries].map(([date, series]) => ({ date, series, episodes: seriesEpisodeTitles(series, contentAll) })),
        });
        if (!isRevision || result.changed) {
          const normalized = normalizePlanItems(result.items, slots, { campaigns: activeCampaigns, formats: formatNames, forceCampaign: scopeCampaign, slotSeries });
          appendBrainstormMessage(th.id, { role: "assistant", text: result.note || "", blocks: { weekPlan: { v: 1, campaignId: scopeCampaign?.id || "", items: normalized, savedAt: null, closed: false } }, sessionId });
        } else {
          appendBrainstormMessage(th.id, { role: "assistant", text: result.note || t("chat.week.talkFallback"), blocks: { planTalk: true }, sessionId });
        }
      }
    } else if (picked === "brainstorm") {
      let th = currentThread(brandId);
      if (!th) {
        const scope = activeScope(brandId);
        // "Buat Bedah Brand tentang Nike": naming an existing series in the
        // first message of a brand-wide conversation makes it that series'.
        if (!hasScope(scope)) {
          const detected = findSeriesByNameInText(brandId, text);
          if (detected) { scope.seriesId = detected.id; toast(t("series.autoDetected", { name: detected.name })); }
        }
        th = createBrainstorm(brandId, { mode: "chat", title: text.slice(0, THREAD_TITLE_MAX), campaignId: scope.goalId ? null : scope.campaignId || null, stageId: scope.stageId || null, contentId: scope.contentId || null, goalId: scope.goalId || null, seriesId: scope.seriesId || null });
        if (sessionId) patchSession(brandId, sessionId, { threadId: th.id });
        else brainstormThread.set(brandId, th.id);
        pendingScope.delete(brandId);
        syncPageUrl(brandId);
      } else if (!hasScope(threadScope(th))) {
        // Same, later on: "sekarang ide buat Bedah Brand" three messages
        // into a brand-wide chat turns it into that series' conversation.
        const detected = findSeriesByNameInText(brandId, text);
        if (detected) { th = updateBrainstorm(th.id, { seriesId: detected.id }) || getBrainstorm(th.id); toast(t("series.autoDetected", { name: detected.name })); }
      }
      const asked = appendBrainstormMessage(th.id, { role: "user", text, sessionId });
      tails.delete(tk);
      const scope = threadScope(th);
      const info = scopeInfo(brandId, scope);
      const eventCampaign = eventCampaignFor(brandId, { campaignId: scope.campaignId, goalId: scope.goalId });
      const all = getBrainstorm(th.id)?.messages || [];
      const threadHistory = historyForModel(brandId, cur, all, asked?.id);
      // Everything already put in front of the owner counts as "don't repeat".
      // (Used to also spread in this thread's own `ideas[]` — a save-time
      // copy of the exact same text savedIdeasFor already returns from the
      // one ideas inbox now, so that second copy is redundant.)
      const shown = all.flatMap((m) => (m.blocks?.ideas || []).map((i) => i.title));
      const savedIdeas = [...new Set([...shown, ...savedIdeasFor(brandId).items.map((i) => i.text)])];
      const campaigns = listCampaigns(brandId);
      const contentAll = listContent(brandId);
      const raw = await chatBrainstorm(ai, {
        brand, campaigns, pulseText, savedIdeas,
        campaign: info.campaign, stageText: info.stageText, content: info.content, series: info.series, goalId: scope.goalId || null, eventCampaign,
        seriesEpisodes: seriesEpisodeTitles(info.series, contentAll),
        seriesOverview: info.series ? "" : buildSeriesOverview(listSeries(brandId), contentAll, { days: seriesDays(brand?.contentCadence, listSeries(brandId)) }),
        history: threadHistory, message: text, mode: bsMode,
        turns: all.filter((m) => m.role === "user").length,
        onText: streamInto,
      });
      const { cleanText, ideas, drafts, asks, tasks, handoff, saves, scripts } = parseDirectives(raw.trim());
      // A step is filed under the event; without one it is kept as an idea.
      const filed = eventCampaign ? tasks.map((x) => ({ ...x, campaignId: eventCampaign.id })) : [];
      const allIdeas = [...ideas, ...(eventCampaign ? [] : tasks.map((x) => ({ title: x.title, why: x.why })))];
      appendBrainstormMessage(th.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { ideas: allIdeas, drafts, asks, tasks: filed, handoff, saves, ...(scripts.length ? { scripts } : {}) }, sessionId });
    } else if (picked === "companion") {
      const thread = ensureCompanionThread(brandId);
      const asked = appendBrainstormMessage(thread.id, { role: "user", text, sessionId });
      tails.delete(tk);
      updateBrand(brandId, { companion: { ...(brand.companion || {}), lastAskedAt: localISODate() } });
      const msgs = getCompanionThread(brandId)?.messages || [];
      const threadHistory = historyForModel(brandId, cur, msgs, asked?.id, COMPANION_HISTORY_FOR_MODEL);
      const raw = await companionChat(ai, { brand, pulseText, history: threadHistory, message: text, kinds: MOMENT_KINDS });
      const { cleanText, ideas, asks, moments, handoff } = parseDirectives(raw.trim());
      appendBrainstormMessage(thread.id, { role: "assistant", text: cleanText || raw.trim(), blocks: { asks, moments, handoff, ...(ideas.length ? { ideas } : {}) }, sessionId });
    } else {
      const thread = ensureConsultThread(brandId);
      const asked = appendBrainstormMessage(thread.id, { role: "user", text, sessionId, blocks: images.length ? { images: images.map((a) => a.thumb) } : null });
      tails.delete(tk);
      const msgs = getConsultThread(brandId)?.messages || [];
      const prior = historyForModel(brandId, cur, msgs, asked?.id);
      const snapshotText = buildSnapshot(brandId);
      // A provider that can't see pictures still gets the screenshot's text
      // (js/ocr.js) — the numbers, not the graph.
      let imageText = "";
      let modelImages = [];
      if (images.length) {
        if (aiCanSeeImages(ai)) modelImages = images.map((a) => a.full);
        else {
          const texts = [];
          for (const a of images) { try { texts.push((await analyzeScreenshot(a.full)).text.trim()); } catch { /* unreadable */ } }
          imageText = texts.filter(Boolean).join("\n---\n") || t("chat.image.ocrEmpty");
          toast(t("chat.image.ocrNote"), "info");
        }
      }
      const reply = await askBrandConsultant(ai, { brand, snapshotText, pulseText, history: prior, question: text, onText: streamInto, kinds: MOMENT_KINDS, images: modelImages, imageText });
      const parsed = parseDirectives(reply.trim());
      const { cleanText, asks, handoff, moments, metrics } = parsed;
      const nav = relevantNav(parsed.nav, cleanText);
      appendBrainstormMessage(thread.id, { role: "assistant", text: cleanText || reply.trim(), blocks: { nav, asks, handoff, moments, ...(metrics ? { metrics } : {}) }, sessionId });
    }

    // In a single-engine view: when the message plainly reads like another
    // tab's job, offer it there — free (keyword rules), never a model call.
    // Otomatis already routed it; "Bukan ini maksudmu?" covers the rest.
    if (sessionId) syncPageUrl(brandId);
    const to = cur !== "auto" && text.length >= HINT_MIN_LENGTH ? routeByRules(text) : null;
    if (to && to !== cur) hints.set(brandId, { mode: cur, to, question: text });
  } catch (err) {
    // The message itself, never a technical "Gagal: …" prefix, plus a
    // "Coba lagi" that resends the same question — no retyping.
    const entry = { role: "assistant", text: err instanceof AiApiError ? err.message : t("cons.errorGeneric"), retry: text, retryEngine: picked !== cur ? picked : null };
    // The question stays on screen if it never reached a log.
    const kept = (tails.get(tk) || []).filter((x) => x.role === "user");
    tails.set(tk, [...kept, entry]);
  } finally {
    // A finally, not a call after the try/catch: if anything above the
    // catch block itself ever threw synchronously before reaching it,
    // `pending` used to stay stuck true and the composer stayed disabled
    // for the rest of the session.
    finishReply(brandId, { streamed });
  }
}

// "Rangkum" (Teman): the chat since the last recap → a card of moments the
// owner ticks before they enter brand memory. Nothing is remembered
// silently: the owner sees exactly what would be kept, first.
async function runRecap(brandId) {
  if (pending) return;
  const slice = unrecappedMessages(brandId);
  if (!slice.some((m) => m.role === "user")) return;
  const ai = aiReady(brandId);
  if (!ai) return;
  setMode(brandId, "companion");
  tails.delete(tailKey(brandId, "companion"));
  pending = true;
  streamShown = "";
  renderPanel(brandId);
  try {
    const { summary, moments } = await recapCompanion(ai, {
      brand: getBrand(brandId),
      pulseText: pulseNow(brandId),
      messages: slice.map((m) => ({ role: m.role, text: m.text })),
      today: localISODate(),
      kinds: MOMENT_KINDS,
      actions: MOMENT_ACTIONS,
    });
    const valid = validateRecap(moments);
    // Covered messages count as recapped from here on, whatever the owner
    // decides on the card — the nudge shouldn't keep asking about them.
    const now = Date.now();
    const thread = ensureCompanionThread(brandId);
    appendBrainstormMessage(thread.id, { role: "assistant", text: summary, at: now, blocks: { recap: { moments: valid, decided: valid.length === 0, savedCount: 0 } } });
    updateBrand(brandId, { companion: { ...(getBrand(brandId)?.companion || {}), lastRecapAt: now } });
  } catch (err) {
    tails.set(tailKey(brandId, "companion"), [{ role: "assistant", text: err instanceof AiApiError ? err.message : t("companion.recap.failed") }]);
  } finally {
    finishReply(brandId, { streamed: false });
  }
}

function decideRecap(brandId, msgId, save, host) {
  const thread = getCompanionThread(brandId);
  const msg = thread?.messages?.find((m) => m.id === msgId);
  const recapBlock = msg?.blocks?.recap;
  if (!recapBlock || recapBlock.decided) return;
  let picked = [];
  if (save) {
    const card = host.querySelector(`[data-chat-recap-save="${msgId}"]`)?.closest(".companion-recap");
    const checked = new Set([...(card?.querySelectorAll("[data-recap-pick]") || [])].filter((el) => el.checked).map((el) => Number(el.dataset.recapPick)));
    picked = recapBlock.moments.filter((_, i) => checked.has(i));
    if (picked.length) addBrandMoments(brandId, picked);
  }
  updateBrainstormMessage(thread.id, msgId, { blocks: { ...msg.blocks, recap: { ...recapBlock, decided: true, savedCount: picked.length } } });
  toast(picked.length ? t("companion.recap.saved", { n: picked.length }) : t("companion.recap.discarded"));
  renderPanel(brandId);
}

// ---- Sizes: small panel <-> page ----------------------------------------------

// Leaving the chat for another page: the small panel tucks away; the page
// simply navigates (its unmount keeps the conversation).
function leaveTo(brandId, hash) {
  persistChat(brandId);
  if (!page) togglePanel(brandId, false);
  location.hash = hash;
}

function expandToPage(brandId) {
  carryDraft = qs("#consultant-input")?.value || "";
  expandedFrom = location.hash;
  expanding = true;
  togglePanel(brandId, false);
  const mode = modeOf(brandId);
  const id = mode === "auto" ? currentSessionOf(brandId)?.id : mode === "brainstorm" && getBrainstorm(brainstormThread.get(brandId)) ? brainstormThread.get(brandId) : null;
  location.hash = id ? `#/brand/${brandId}/chat/${id}` : `#/brand/${brandId}/chat`;
}

function shrinkToPanel() {
  if (!page || !expandedFrom) return;
  carryDraft = qs("#consultant-input")?.value || "";
  reopenSmall = true;
  location.hash = expandedFrom;
}

// While the small panel is open it follows the store like the page does
// (a Firestore sync landing, a moment deleted elsewhere) — never mid-answer.
function watchStore(brandId) {
  panelOff?.();
  let queued = false;
  panelOff = onChange(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncRender(brandId, () => isOpen && !page && !pending && mountedBrandId === brandId);
    });
  });
}

function togglePanel(brandId, open, { seed = "", focus = null } = {}) {
  // On the page the chat is already on screen: put the caret there instead.
  if (open && page) {
    if (seed) carryDraft = seed;
    renderPanel(page.brandId, { focus: true });
    return;
  }
  if (!open) leaveScriptThread(brandId);
  isOpen = open;
  const panel = qs("#consultant-panel");
  const fab = qs("#consultant-fab");
  if (panel) {
    panel.hidden = !open;
    if (open) { panel.classList.remove("is-opening"); void panel.offsetWidth; panel.classList.add("is-opening"); }
    // Only one place holds the chat's DOM (ids stay unique).
    else panel.innerHTML = "";
  }
  if (fab) fab.classList.toggle("is-open", open);
  renderedCount = -1;
  if (open) { watchStore(brandId); renderPanel(brandId, { seed, focus: seed || focus ? true : null }); }
  else { panelOff?.(); panelOff = null; }
}

// Opened from elsewhere — the topbar "?" popover (js/layout.js), the Home
// Teman card — the round button is still the everyday way in. `seed`
// pre-fills the box; `engine` says who should answer it (Otomatis stays
// on screen); `mode` opens one log (Pro); `recap` opens the Teman log and
// runs "Rangkum".
// `send` asks `seed` right away (with `bsMode`, e.g. "ideas" for three
// ideas at once); `fresh` starts a new Obrolan for it.
export function openConsultantPanel({ seed = "", mode = null, engine = null, recap = false, send = false, bsMode = "chat", fresh = false, weekCount = null, campaignId = null } = {}) {
  const brandId = page ? page.brandId : mountedBrandId;
  if (!brandId) return;
  if (recap) setMode(brandId, "companion");
  else if (mode) setMode(brandId, mode);
  // A double click (or the tour retriggering the same action) must not wipe
  // out a conversation that is already mid-reply.
  if (fresh && !pending) startConversation(brandId, { auto: modeOf(brandId) === "auto" });
  if (send && seed) {
    togglePanel(brandId, true);
    sendMessage(brandId, seed, { engine: MODES.includes(engine) ? engine : null, bsMode, weekCount, campaignId });
    return;
  }
  if (engine && MODES.includes(engine)) {
    if (modeOf(brandId) === "auto") seedEngine.set(brandId, engine);
    else setMode(brandId, engine);
  }
  togglePanel(brandId, true, { seed, focus: !!seed || !!engine });
  if (recap) runRecap(brandId);
}

// "Rencanakan minggu ini" — every entry point (Kalender, Creator, Beranda,
// a chat starter chip) calls this one function instead of hand-assembling
// openConsultantPanel's options, so they can never drift into slightly
// different behavior. Always a fresh Obrolan: reopening the button mid
// conversation starts a clean plan rather than accidentally "revising"
// whatever the owner was talking about a moment ago. `campaignId`: generate
// this week's plan FOR that one campaign instead of the default "tag
// opportunistically across whatever's active" — see openWeekPlanMenu.
export function openWeekPlan({ campaignId = null } = {}) {
  const campaign = campaignId ? getCampaign(campaignId) : null;
  openConsultantPanel({
    engine: "brainstorm", bsMode: "week", send: true, fresh: true, campaignId,
    seed: campaign ? t("chat.week.seedCampaign", { name: campaign.name }) : t("chat.week.seed"),
  });
}

// Calendar's "Bedah Brand: belum ada episode" on a series day: a fresh chat
// about that series, asking for its next episode for that date. Only ideas
// come back — nothing is created until the owner picks one.
export function openSeriesEpisodeChat({ seriesId, date }) {
  const brandId = page ? page.brandId : mountedBrandId;
  const series = getSeries(seriesId);
  if (!brandId || !series || pending) return;
  episodeDate.set(series.id, date);
  applyChatContext(brandId, { seriesId: series.id }, { render: false });
  openConsultantPanel({ engine: "brainstorm", send: true, bsMode: "ideas", seed: t("series.missingEpisodeSeed", { name: series.name, date: formatDate(date) }) });
}

// The button itself, wherever it appears (Calendar, Creator): with no
// active campaign to choose between, just generate — no point showing a
// one-item menu. With at least one, a small menu offers "Brand umum" (the
// default, opportunistic linking) plus each active campaign by name, so
// the owner decides the plan's whole focus before a single credit is
// spent, not after seeing a generic result and having to redo it.
export function openWeekPlanMenu(anchorEl, brandId) {
  const campaigns = activeCampaignsFor(listCampaigns(brandId));
  if (!campaigns.length) { openWeekPlan(); return; }
  const rect = anchorEl.getBoundingClientRect();
  const menu = openMenu(anchorEl, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 240) });
  if (!menu) return;
  menu.innerHTML = `
    <button type="button" data-week-menu="">${icon("bulb", { size: 15 })}${t("chat.week.menuGeneral")}</button>
    ${campaigns.map((c) => `<button type="button" data-week-menu="${esc(c.id)}">${icon("target", { size: 15 })}${esc(c.name)}</button>`).join("")}
  `;
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-week-menu]");
    if (!btn) return;
    closeMenu();
    openWeekPlan({ campaignId: btn.dataset.weekMenu || null });
  });
}

// ---- The page (js/views/chat.js) ------------------------------------------------

// Mounts the chat at page size into `el`. `threadId` opens that saved
// Brainstorm conversation; `ctx` is the navigation context from another
// screen (a campaign's "Brainstorm", a goal, "Setor ke chat"), which starts
// a conversation about that thing. Opened directly (not by "Perbesar") the
// page shows the Brainstorm tab — that is its name. Returns the unmount
// function.
export function mountChatPage(el, { brandId, threadId = null, ctx = null }) {
  restoreChat(brandId);
  if (isOpen) togglePanel(mountedBrandId, false);
  page = { el, brandId, wantThread: null, off: null };
  document.body.classList.add("chat-page-open");
  renderedCount = -1;
  ideasFocus = false;

  // Opened directly: Otomatis in Pemula, and in Pro unless a log was open.
  // `threadId` in the address is an Obrolan or a Brainstorm thread; an old
  // Brainstorm address whose thread belongs to an Obrolan opens that one.
  if (!expanding && isGuided()) setMode(brandId, "auto");
  if (ctx) applyChatContext(brandId, ctx, { render: false, threadId });
  else if (threadId) {
    const bySession = getSession(brandId, threadId) || (getBrand(brandId)?.chatSessions || []).find((x) => x.threadId === threadId);
    if (bySession) openSession(brandId, bySession.id);
    else if (!loadThread(brandId, threadId)) page.wantThread = threadId; // not synced yet
  }
  expanding = false;
  renderPanel(brandId, { focus: !isTouch() ? true : false });
  if (page?.autoPlot) { const text = page.autoPlot; page.autoPlot = null; sendMessage(brandId, text, { engine: "brainstorm", bsMode: "plot" }); }

  // Keep the list, the ideas, the threads and brand memory in step with the
  // store (another tab or device, a Firestore sync that lands late).
  let queued = false;
  page.off = onChange(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!page || page.brandId !== brandId) return;
      if (page.wantThread && loadThread(brandId, page.wantThread)) page.wantThread = null;
      syncRender(brandId, () => page && page.brandId === brandId && !pending);
    });
  });
  return () => unmountChatPage(brandId);
}

function unmountChatPage(brandId) {
  if (!page) return;
  page.off?.();
  persistChat(brandId);
  page = null;
  ideasFocus = false;
  renderedCount = -1;
  document.body.classList.remove("chat-page-open");
  expandedFrom = "";
  if (reopenSmall) {
    reopenSmall = false;
    // After the destination page has rendered.
    setTimeout(() => { if (mountedBrandId === brandId && !page) togglePanel(brandId, true); }, 150);
  }
}

// Context from another screen (a campaign's "Brainstorm", a goal, "Setor ke
// chat"): a new conversation about that thing, answered by Brainstorm — in
// Otomatis as a new Obrolan, in Pro's Brainstorm log otherwise. A seed goes
// in the box; "Setor ke chat" notes go out at once.
export function applyChatContext(brandId, ctx, { render = true, threadId = null } = {}) {
  if (!threadId) {
    const scope = { campaignId: ctx.campaignId || null, stageId: ctx.stageId || null, contentId: ctx.contentId || null, goalId: ctx.goalId || null, seriesId: ctx.seriesId || null };
    if (isGuided() || modeOf(brandId) === "auto") {
      setMode(brandId, "auto");
      startConversation(brandId, { scope, auto: true });
      seedEngine.set(brandId, "brainstorm");
    } else {
      setMode(brandId, "brainstorm");
      startConversation(brandId, { scope, auto: false });
    }
  } else if (threadId !== brainstormThread.get(brandId)) {
    loadThread(brandId, threadId);
  }
  if (ctx.intent === "plot" && ctx.seed) {
    if (page) page.autoPlot = ctx.seed;
  } else if (ctx.seed) {
    carryDraft = ctx.seed;
  }
  if (render && page?.brandId === brandId) {
    renderPanel(brandId, { focus: true });
    if (page.autoPlot) { const text = page.autoPlot; page.autoPlot = null; sendMessage(brandId, text, { engine: "brainstorm", bsMode: "plot" }); }
  }
}

// ---- Mount / unmount (small panel) --------------------------------------------

const HINT_SEEN_PREFIX = "contentos:fab-hint-seen:";

function wireDocument() {
  if (docKeydown) return;
  // Esc: the focused saved-ideas view closes, else the small panel closes
  // (a modal on top gets the key first).
  // Switching Pemula/Pro (topbar) redraws the chat: Pemula drops the mode
  // row and goes back to the one box.
  window.addEventListener("mode:change", () => {
    const b = hostBrand();
    if (!b) return;
    if (isGuided() && !page) setMode(b, "auto");
    renderPanel(b);
  });
  docKeydown = (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".overlay, .tp-overlay, .tour-overlay")) return;
    if (page && ideasFocus) { e.preventDefault(); ideasFocus = false; renderPanel(page.brandId); return; }
    if (isOpen && mountedBrandId) { e.preventDefault(); togglePanel(mountedBrandId, false); }
  };
  document.addEventListener("keydown", docKeydown);
}

export function mountConsultantPanel(brandId) {
  if (!brandId) return unmountConsultantPanel();
  if (mountedBrandId === brandId) return;
  unmountConsultantPanel();
  mountedBrandId = brandId;
  restoreChat(brandId);
  wireDocument();

  const fab = document.createElement("button");
  fab.type = "button";
  fab.id = "consultant-fab";
  fab.className = "consultant-fab";
  fab.setAttribute("aria-label", t("cons.fabLabel"));
  fab.innerHTML = icon("chat", { size: 22 });
  fab.addEventListener("click", () => {
    // Pemula: the round button always opens the one simple box.
    if (!isOpen && isGuided()) setMode(brandId, "auto");
    togglePanel(brandId, !isOpen);
  });
  document.body.appendChild(fab);

  // A speech bubble beside the round button, shown once per account so
  // people learn it is an AI they can ask — then it stays out of the way.
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
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("chat.title"));
  panel.hidden = true;
  document.body.appendChild(panel);

  isOpen = false;
  renderedCount = -1;
}

export function unmountConsultantPanel() {
  panelOff?.();
  panelOff = null;
  qs("#consultant-fab")?.remove();
  qs("#consultant-fab-hint")?.remove();
  qs("#consultant-panel")?.remove();
  mountedBrandId = null;
  isOpen = false;
}
