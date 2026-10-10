import { getBrand, listContent, listCampaigns, listOverdueAndDueSoon, onChange, getSettings, updateBrand, removeBrandLogEntry, updateContent, localISODate, listGoals, settleFinishedEvents, STATUS_LABELS, eventCampaignEnd, updateCampaign } from "../store.js";
import { icon } from "../icons.js";
import { initials, formatDate, escapeHtml as esc, toast, showCalloutBubble, qs, qsa, wireClickableCards, resizeImageFile } from "../dom.js";
import { brandDnaCompleteness, brandDnaDone, visualBasicsDone, brandBookProgress, guidelineSectionDone, identityDone as isIdentityDone, dnaResumeStep, missingDnaFields } from "../brand-progress.js";
import { goalWidget, wireGoalCard } from "../goal-card.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { openContentEditor } from "./content-editor.js";
import { celebrateBuilderCompleteIfFlagged, consumeDnaJustCompleted, consumeVisualBasicsJustDone } from "./brand-builder.js";
import { ensureGoogleFont, ensureCustomFont } from "./brand-guidelines.js";
import { getCachedAccount, isReadOnly, isTrial, trialDaysLeft } from "../account.js";
import { campaignStages, campaignPlatform } from "../campaign-metrics.js";
import { go } from "../nav-context.js";
import { statusLabel } from "../funnel-field.js";
import { brandTodayAction } from "../next-action.js";
import { getMode } from "../mode.js";
import { t, campaignDisplayName } from "../i18n.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";
import { analyticsSectionHTML, wireAnalyticsSection } from "./brand-home-analytics.js";
import { openReportModal, reportDue, snoozeReport } from "./report.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { computeSignals, topSignal, greetingKey } from "../brand-pulse.js";
import { openBrandMemoryModal, savedMoments, momentKindLabel, unrecappedMessages } from "../brand-memory.js";
import { openConsultantPanel, openWeekPlan } from "../consultant-panel.js";
import { postingLine } from "../brand-learning.js";
import { weekRecap, weekAhead, weekCardParts, finishedCampaignRecaps, recapCardHTML } from "../weekly-recap.js";
import { lowCreditNoteHTML, wireLowCreditNote, installLowCreditWatch } from "../ai-low-credit.js";
import { brandDocFits } from "../brand-doc-size.js";

// The brand's home, one file for both modes. A busy owner should get it in
// five seconds on a phone, so the page has one fixed shape (2026-10-06):
//
//   brand header   — cover photo, logo, tagline, palette, Panduan
//   notices        — trial countdown, low AI credit (only when true)
//   Hari ini       — ONE thing to do now, plus at most one quiet link:
//                    identity not done → Brand DNA / Warna & Font progress;
//                    otherwise the most urgent action (js/next-action.js
//                    brandTodayAction: campaign actions, and "Isi angka"
//                    two days after a post went up)
//   recap          — once, when an Event / Grow Brand ladder just finished
//   Minggu ini     — the weekly loop (js/weekly-recap.js): last 7 days,
//                    next 7 days, the report PDF, "Isi jadwal minggu ini"
//   Tujuan         — a running roadmap's own card, when there is one
//   Konten terbaru — the brand's actual work at a glance
//   Lainnya        — small quiet cards: Langkah dasar, Teman Brand, the
//                    roadmap invite, and (Pro) the one-tap action
//   Analitik       — Pro only, folded, below everything
//
// Phones read it top to bottom in that order. From 1080px the page splits
// into a main column (Hari ini, recap, Tujuan, Konten terbaru) and a side
// column (Minggu ini, Lainnya). Each piece of content shows in ONE block.
// The only mode-dependent bits are in HOME_CONFIG.
const HOME_CONFIG = {
  guided: { analytics: false, lockNext: true, oneTap: false },
  advanced: { analytics: true, lockNext: false, oneTap: true },
};
const config = () => HOME_CONFIG[getMode()] || HOME_CONFIG.guided;

// Panduan halaman ini. Blocks that aren't always there are skipped at once
// instead of making the tour wait for them.
const shown = (sel) => () => !!document.querySelector(sel);
const TOUR_STEPS = [
  { selector: "#journey-hero", title: t("beginner.tour.hero.title"), body: t("beginner.tour.hero.body") },
  { selector: "#home-week", showIf: shown("#home-week"), title: t("beranda.tour.week.title"), body: t("beranda.tour.week.body") },
  { selector: "#beginner-journey", showIf: shown("#beginner-journey"), title: t("beginner.tour.journey.title"), body: t("beginner.tour.journey.body") },
  { selector: "#consultant-fab", title: t("beginner.tour.ai.title"), body: t("beginner.tour.ai.body") },
];

export function render(root, { brandId }) {
  const state = { topContentPeriod: "all" };
  installLowCreditWatch();
  const refresh = () => { settleFinishedEvents(brandId); paint(root, brandId, state, refresh); };
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
      href: dnaDone ? `#/brand/${brandId}/guidelines/color` : dnaHref(brandId, brand),
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

// ---- Progress feel: step dots, one-time celebration, posting streak ------
// (Tugas C — "rasa kemajuan + perayaan kecil".) All deterministic, no AI.

// Small "N of 3" dots next to the journey summary — the always-visible
// line (a <summary>, not hidden behind expanding the details), so the
// progress reads at a glance without opening anything.
function stepDotsHTML(doneCount, total) {
  const dots = Array.from({ length: total }, (_, i) => `<span class="step-dot${i < doneCount ? " is-done" : ""}"></span>`).join("");
  return `<span class="step-dots" aria-hidden="true">${dots}</span>`;
}

// Compares this paint's done step keys against the last-seen set for this
// brand (localStorage, try/catch'd — a private window or blocked storage
// just means no celebration, never a crash). Identity already has its own
// celebration (celebrateBuilderCompleteIfFlagged), so it's excluded here;
// this only catches "campaign" and "content" turning done for the first
// time on this device.
function stepsSeenKey(brandId) {
  return `wpk-home-steps-seen-${brandId}`;
}
function detectNewlyDoneSteps(brandId, steps) {
  const doneKeys = steps.filter((s) => s.done).map((s) => s.key);
  let prev = null;
  try {
    const raw = localStorage.getItem(stepsSeenKey(brandId));
    prev = raw ? JSON.parse(raw) : null;
  } catch {
    prev = null;
  }
  try {
    localStorage.setItem(stepsSeenKey(brandId), JSON.stringify(doneKeys));
  } catch {
    /* storage unavailable — celebration just won't fire, no crash */
  }
  if (!prev) return []; // first time this brand is seen on this device — no fake celebration
  return doneKeys.filter((k) => k !== "identity" && !prev.includes(k));
}

// The posting streak (Minggu ini, js/weekly-recap.js) is store.js's
// consecutiveActiveWeeks — the same count (rolling 7-day windows on the
// owner's local dates) the "minggu aktif" milestones and the streak-break
// nudge use (audit-1005), with one allowance: Beranda passes { grace: true },
// so the current week may still be empty without the 🔥 disappearing on
// upload morning.

// ---------- "Geser ke hari upload kosong" (Minggu ini's late bar) ----------
function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}
// The next `count` upload days (Jadwal Kerja; weekdays if none are set)
// not already carrying a scheduled piece for this brand — spread out instead
// of stacking two items onto the same day.
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function nextFreeUploadDays(usedDates, count, cadence) {
  const used = new Set(usedDates);
  const uploadDays = cadence?.configured && cadence.uploadDays?.length ? new Set(cadence.uploadDays) : null;
  const dates = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() + 1);
  while (dates.length < count) {
    if (uploadDays ? uploadDays.has(DOW_KEYS[cursor.getDay()]) : !isWeekend(cursor)) {
      const iso = localISODate(cursor);
      if (!used.has(iso)) {
        dates.push(iso);
        used.add(iso);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
// The last day a late piece may move to, or null for no limit: a piece made
// for a dated stage (an event's pre-event promo, a dated goal phase) belongs
// inside that stage's window — moving it past the event would post a promo
// for something that already happened.
export function shiftLimitFor(c, campaigns) {
  const campaign = c.campaignId ? campaigns.find((x) => x.id === c.campaignId) : null;
  if (!campaign) return null;
  const stage = c.campaignPhaseId ? campaignStages(campaign).find((s) => s.kind === "window" && s.id === c.campaignPhaseId) : null;
  if (stage?.dateTo) return stage.dateTo;
  return campaign.eventPlan ? eventCampaignEnd(campaign) || null : null;
}
// "Geser ke hari upload kosong": pairs each late piece with one of `dates`
// (free upload days, ascending). Pieces with a limit (shiftLimitFor) go
// first and take the earliest free day inside it — or tomorrow when no
// upload day fits but the window is still open; a window that has already
// closed keeps its piece where it is (`kept`), for the owner to decide.
// Everything else takes the remaining days in order.
export function planOverdueShift(late, dates, campaigns, tomorrow = null) {
  if (!tomorrow) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    tomorrow = localISODate(d);
  }
  const pool = [...dates];
  const moves = [];
  const kept = [];
  const items = late.map((c) => ({ c, limit: shiftLimitFor(c, campaigns) }));
  items
    .filter((x) => x.limit)
    .sort((a, b) => a.limit.localeCompare(b.limit))
    .forEach(({ c, limit }) => {
      if (pool.length && pool[0] <= limit) moves.push({ c, date: pool.shift() });
      else if (tomorrow <= limit) moves.push({ c, date: tomorrow });
      else kept.push(c);
    });
  items.filter((x) => !x.limit).forEach(({ c }) => {
    if (pool.length) moves.push({ c, date: pool.shift() });
  });
  return { moves, kept };
}

// ---- "Lainnya" cards ----------------------------------------------------------------
// Same glowing widget card as Minggu ini (the owner likes the glow — a flat
// "quiet" version was rejected on 2026-10-07), just without a collapse button.
function miniCardHTML({ iconName, title, bodyHTML, extraHead = "", cls = "" }) {
  return `
    <article class="dash-widget-card home-mini-card${cls ? ` ${cls}` : ""}">
      <div class="dash-widget-backdrop" aria-hidden="true"><div class="dash-widget-glow"></div></div>
      <div class="dash-widget-card-head">
        <div class="dash-widget-card-icon">${icon(iconName, { size: 18 })}</div>
        <div class="dash-widget-card-title"><h2>${title}</h2></div>
        ${extraHead ? `<div class="dash-widget-card-actions">${extraHead}</div>` : ""}
      </div>
      <div class="dash-widget-card-body">${bodyHTML}</div>
    </article>`;
}

function moreSectionHTML(items) {
  if (!items.length) return "";
  return `
    <section class="home-more home-b-more" aria-labelledby="home-more-title">
      <h2 class="home-section-title" id="home-more-title">${t("beranda.more.title")}</h2>
      <div class="home-more-list">${items.join("")}</div>
    </section>`;
}

// No roadmap yet: the invite to make one (js/goal-card.js has the copy;
// it used to be a full widget of its own).
function goalPromoMiniHTML(brandId) {
  return miniCardHTML({
    iconName: "target",
    title: t("roadmap.home.promo.title"),
    bodyHTML: `<p class="home-mini-text">${t("roadmap.home.promo.body")}</p>
      <div class="home-mini-actions"><a class="btn btn-primary btn-sm" href="#/brand/${brandId}/goals" data-rg-promo>${icon("target", { size: 13 })}${t("roadmap.home.promo.cta")}</a></div>`,
  });
}

// <details> on Beranda (Langkah dasar, Memori brand) stay open across the
// repaint every store change triggers — per brand, for this session.
const openDetails = new Map(); // brandId -> Set(key)
const isOpen = (brandId, key) => !!openDetails.get(brandId)?.has(key);
function wireKeepOpen(root, brandId) {
  qsa("details[data-keep-open]", root).forEach((d) =>
    d.addEventListener("toggle", () => {
      const set = openDetails.get(brandId) || new Set();
      if (d.open) set.add(d.dataset.keepOpen);
      else set.delete(d.dataset.keepOpen);
      openDetails.set(brandId, set);
    })
  );
}

// ---- One-tap action (Pro, in "Lainnya") ------------------------------------------
// A format that's clearly outperforming (js/brand-pulse.js signalTopFormat)
// → follow-up ideas in the chat's Brainstorm. Ideas come back as cards the
// owner picks and saves; nothing is created straight into Konten. The old
// "minggu ini masih kosong" action is Minggu ini's "Isi jadwal minggu ini"
// now, so the two never say the same thing twice.
function buildInsightActions({ content, signals }) {
  const actions = [];
  const topFormat = signals.find((s) => s.kind === "top-format" && s.refs?.contentId);
  const bestPost = topFormat ? content.find((c) => c.id === topFormat.refs.contentId) : null;
  if (topFormat && bestPost) {
    actions.push({
      id: "top-format",
      icon: "sparkle",
      text: t("home.action.topFormat.text", { format: bestPost.format || topFormat.refs.format, mult: topFormat.refs.multiplier }),
      cta: t("home.action.topFormat.cta"),
      run: () =>
        openConsultantPanel({
          engine: "brainstorm",
          bsMode: "ideas",
          send: true,
          fresh: true,
          seed: t("home.action.topFormat.seed", { format: bestPost.format || topFormat.refs.format || "", title: bestPost.title || t("beginner.untitled") }),
        }),
    });
  }
  return actions;
}

function insightMiniHTML(a) {
  return miniCardHTML({
    iconName: a.icon,
    title: t("home.action.title"),
    bodyHTML: `<p class="home-mini-text">${esc(a.text)}</p>
      <div class="home-mini-actions"><button type="button" class="btn btn-primary btn-sm" data-insight-action="${a.id}">${icon("bulb", { size: 13 })}${esc(a.cta)}</button></div>`,
  });
}

function wireInsightActions(root, actions) {
  qsa("[data-insight-action]", root).forEach((btn) => {
    btn.addEventListener("click", () => actions.find((a) => a.id === btn.dataset.insightAction)?.run());
  });
}

// ---------- Teman Brand (the Home card) ----------
// The chat itself lives in the Teman tab of "Tanya Brandlab"
// (js/consultant-panel.js) — one chat component, never a second copy here.
// This card is the way in from Home: today's greeting with the one signal
// that stands out, the quick actions those signals earn, the newest moments
// in brand memory, and the button that opens the chat on the Teman tab.
// Brand memory (brand.developmentLog, source "moment") is what every AI
// feature reads; "Kelola" opens it in full (js/brand-memory.js).

// Which signal kinds get a quick-action button, in priority order.
const COMPANION_ACTION_KINDS = ["content-sales", "viral", "follower-jump", "sales-down", "streak-break"];
const MOMENTS_SHOWN = 3;

function greetingSentence(brand, now) {
  return t(greetingKey(now.getHours()), { brand: esc(brand.name) });
}

// Quick actions the current signals earn (at most two), as buttons only —
// the card puts them beside "Cerita ke Teman Brand".
function companionActionsHTML(signals, content, brandId) {
  const picks = COMPANION_ACTION_KINDS.map((kind) => signals.find((s) => s.kind === kind)).filter(Boolean).slice(0, 2);
  if (!picks.length) return "";
  return picks.map((s) => {
    if (s.kind === "content-sales") {
      const c = content.find((x) => x.id === s.refs.contentId);
      const seed = t("companion.seed.contentSales", { title: c?.title || t("pulse.untitledContent") });
      return `<button type="button" class="btn btn-secondary btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 13 })}${t("companion.action.moreLikeThis")}</button>`;
    }
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
  }).join("");
}

// The newest saved moments, each with its action (if the recap gave it one)
// and a real delete — plus "Kelola" for the full brand memory. Folded under
// "Memori brand · N" on the card.
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

function momentsListHTML(brand) {
  const rows = savedMoments(brand)
    .slice(0, MOMENTS_SHOWN)
    .map(
      (m) => `
      <div class="companion-moment-row">
        <span class="tag">${momentKindLabel(m.kind)}</span>
        <span class="companion-moment-text" title="${esc(m.detail || m.title)}">${esc(m.title)}</span>
        ${momentActionHTML(m, brand.id)}
        <button type="button" class="chip-icon-btn" data-companion-delete="${m.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
      </div>`
    )
    .join("");
  return `
    <div class="companion-moments">
      ${rows || `<p class="text-faint" style="font-size:12px;margin:0;">${t("companion.memory.empty")}</p>`}
      <button type="button" class="link home-mini-manage" id="companion-manage">${t("companion.moments.manage")}</button>
    </div>`;
}

// The way into the Teman tab of the one chat (js/consultant-panel.js),
// never a second copy of it: today's greeting with the one signal that
// stands out, "Cerita ke Teman Brand", the quick actions those signals earn,
// and brand memory (brand.developmentLog, what every AI feature reads).
function companionMiniHTML(brand, { signals, content, now, guided }) {
  const top = topSignal(signals);
  // A brand that's never posted and has nothing in brand memory yet hasn't
  // had a "quiet week" — it's had no week at all. Greet it as day one.
  const isFirstDay = !content.length && !(brand.developmentLog || []).length;
  const unrecapped = unrecappedMessages(brand.id).filter((m) => m.role === "user").length;
  const moments = savedMoments(brand);
  const recapBtn = unrecapped ? `<button type="button" class="btn btn-ghost btn-sm" data-companion-open="recap" title="${esc(t("home.companion.unrecapped", { n: unrecapped }))}">${icon("sparkle", { size: 12 })}${t("companion.recap.button")} (${unrecapped})</button>` : "";
  return miniCardHTML({
    iconName: "chat",
    title: t("home.companion.title"),
    extraHead: recapBtn,
    cls: "home-mini-companion",
    bodyHTML: `
      <p class="companion-greeting">${greetingSentence(brand, now)} <b>${esc(top ? top.title : t(isFirstDay ? "companion.observation.firstDay" : "companion.observation.quiet"))}</b></p>
      ${guided ? `<p class="home-mini-text">${t("home.companion.sub")}</p>` : ""}
      <div class="companion-actions">
        <button type="button" class="btn btn-primary btn-sm" data-companion-open="companion">${icon("heart", { size: 13 })}${t("home.companion.tell")}</button>
        ${companionActionsHTML(signals, content, brand.id)}
      </div>
      <details class="home-mini-details" data-keep-open="memory"${isOpen(brand.id, "memory") ? " open" : ""}>
        <summary>${icon("bookmark", { size: 13 })}<span>${moments.length ? t("beranda.companion.memory", { n: moments.length }) : t("beranda.companion.memoryEmpty")}</span>${icon("chevronDown", { size: 13 })}</summary>
        ${momentsListHTML(brand)}
      </details>`,
  });
}

function wireCompanionCard(root, { brandId, refresh }) {
  // Into the chat: tell the Teman (Otomatis stays on screen, the Teman
  // answers), recap, or Brainstorm with a seed.
  qsa("[data-companion-open]", root).forEach((btn) => btn.addEventListener("click", () => openConsultantPanel(btn.dataset.companionOpen === "recap" ? { recap: true } : { engine: "companion" })));
  qsa("[data-companion-go]", root).forEach((btn) => btn.addEventListener("click", () => openConsultantPanel({ engine: "brainstorm", seed: btn.dataset.companionSeed || "" })));
  qsa("[data-companion-delete]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      removeBrandLogEntry(brandId, btn.dataset.companionDelete);
      refresh();
    })
  );
  qs("#companion-manage", root)?.addEventListener("click", () => openBrandMemoryModal(brandId, { refresh }));
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const cfg = config();
  const guided = getMode() !== "advanced";
  // Both one-shot flags consumed separately (not `||` short-circuited) so
  // either one left set still gets cleared even when both fire the same visit.
  const wholeBuilderJustCompleted = celebrateBuilderCompleteIfFlagged(brandId);
  const visualBasicsJustDone = consumeVisualBasicsJustDone(brandId);
  const identityJustDone = wholeBuilderJustCompleted || visualBasicsJustDone;
  if (consumeDnaJustCompleted(brandId)) toast(t("dna.celebrate.done"));

  const now = new Date();
  const settings = getSettings();
  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);
  const journey = buildSteps(brandId, brand, campaigns, content);
  const identityDone = journey.identityDone;
  // Each piece shows up in ONE Home block. The hero's piece and the pieces a
  // running plan's own card (Tujuan · Minggu ini) already lists stay out of
  // Minggu ini's rows — one overdue post used to appear in up to four cards
  // (hero, Tujuan, Aksi siap dipakai, Jadwal) at once.
  const top = identityDone ? brandTodayAction({ brand, campaigns, content, settings, now: now.getTime() }) : null;
  const shownElsewhere = new Set([
    top?.action?.cta?.contentId,
    ...listGoals(brandId).filter((g) => g.status === "active" || g.status === "partial").flatMap((g) => Object.values(g.installed?.slots || {}).map((x) => x.contentId)),
  ].filter(Boolean));
  const allOverdue = listOverdueAndDueSoon().overdue.filter((x) => x.brand.id === brandId);
  const late = allOverdue.map((x) => x.content).filter((c) => !shownElsewhere.has(c.id));
  const hasPublished = content.some((c) => c.status === "published");
  const recap = weekRecap({ brand, content, now, exclude: shownElsewhere });
  const ahead = weekAhead({ content, now, exclude: shownElsewhere });
  // "Konten terbaru" skips whatever Hari ini or Minggu ini already shows.
  const shownAbove = new Set([...shownElsewhere, ...late.slice(0, 3).map((c) => c.id), ...ahead.rows.map((c) => c.id), recap.best?.content.id].filter(Boolean));
  const collapsed = new Set(brand.homeCollapsed || []);
  // Computed once per paint for the Teman card's greeting and action buttons.
  const signals = computeSignals({ brand, content, campaigns, settings });
  const insightActions = cfg.oneTap ? buildInsightActions({ content, signals }) : [];
  const goal = goalWidget({ brandId, brand, campaigns, content, identityDone });
  // No plan yet → goalWidget returns the invite, which is a small card now.
  const goalIsInvite = !!goal && !listGoals(brandId).some((g) => g.status !== "completed");
  const recaps = finishedCampaignRecaps({ brand, campaigns, content, now });
  const newlyDoneSteps = detectNewlyDoneSteps(brandId, journey.steps);
  if (newlyDoneSteps.length) toast(t(`beginner.step.${newlyDoneSteps[0]}.celebrate`));
  // The week plan reads Brand DNA (who, what problem, what changes) and
  // spends one AI credit, so it's offered once there's something to read.
  const dna = brand.brandDNA || {};
  const hasDna = [dna.targetAudience, dna.problemSolved, dna.successOutcome].some((x) => (x || "").trim());
  // A brand on day one has no week to show yet.
  const week = identityDone || content.length
    ? weekCardParts({ brandId, recap, ahead, late, lateTotal: allOverdue.length, reportIsDue: reportDue(brand, content), hasPublished, canPlan: hasDna && !isReadOnly(getCachedAccount()), guided })
    : null;
  // All three basic steps done: the checklist has nothing left to say (each
  // step lives on its own tab) — unless one of them was just finished.
  const showSteps = journey.currentIndex !== -1 || identityJustDone || newlyDoneSteps.length > 0;

  const weekHTML = week
    ? `<div class="home-b-week" id="home-week">${
        collapsed.has("week")
          ? widgetCollapsedHTML("week", "calendar", t("beranda.week.title"), week.summary)
          : widgetCardHTML("week", "calendar", t("beranda.week.title"), week.bodyHTML, {
              sub: week.sub,
              extraHead: `<a class="link" href="#/brand/${brandId}/content/calendar">${t("brandHome.upNext.calendarLink")}</a>`,
            })
      }</div>`
    : "";
  const goalHTML = goal && !goalIsInvite
    ? `<div class="home-b-goal">${
        collapsed.has(goal.key)
          ? widgetCollapsedHTML(goal.key, goal.iconName, goal.title, goal.summary)
          : widgetCardHTML(goal.key, goal.iconName, goal.title, goal.bodyHTML, { extraHead: goal.extraHead })
      }</div>`
    : "";
  const moreItems = [
    showSteps ? stepsHTML(journey, cfg.lockNext, identityJustDone, newlyDoneSteps, isOpen(brandId, "steps")) : "",
    companionMiniHTML(brand, { signals, content, now, guided }),
    goalIsInvite ? goalPromoMiniHTML(brandId) : "",
    ...insightActions.map(insightMiniHTML),
  ].filter(Boolean);
  const notices = [trialReminderHTML(), lowCreditNoteHTML()].filter(Boolean);

  root.innerHTML = `
    ${brandHeroHTML(brand, {
      sub: !identityDone ? t("home.sub.identity") : journey.doneCount < journey.steps.length ? t("beginner.sub.identityDone", { n: journey.steps.length - journey.doneCount }) : t("beginner.sub.allDone"),
    })}

    ${notices.length ? `<div class="home-notices">${notices.join("")}</div>` : ""}

    <div class="home-layout">
      <div class="home-col home-col-main">
        <div class="home-b-today">${identityDone ? todayHeroHTML(brandId, brand, campaigns, content, top) : identityHeroHTML(brandId, brand)}</div>
        ${recaps[0] ? `<div class="home-b-recap">${recapCardHTML(recaps[0], { brandId })}</div>` : ""}
        ${goalHTML}
        ${recentContentHTML(brandId, content, shownAbove)}
        ${moreSectionHTML(moreItems)}
      </div>
      <div class="home-col home-col-side">
        ${weekHTML}
      </div>
    </div>

    ${cfg.analytics ? `<div class="home-analytics">${analyticsSectionHTML(content, settings, state, "")}</div>` : ""}
  `;

  wireHelpButtons(root);
  wireBrandHero(root, brandId);
  wireGoalCard(root, { brandId });
  wireWidgetToggle(root, { collapsedList: brand.homeCollapsed, save: (next) => updateBrand(brandId, { homeCollapsed: next }), refresh });
  wireCompanionCard(root, { brandId, refresh });
  wireKeepOpen(root, brandId);
  if (insightActions.length) wireInsightActions(root, insightActions);
  if (cfg.analytics) wireAnalyticsSection(root, state, refresh);
  // One report, for both modes: Minggu ini's link and its weekly nudge.
  qs("#home-report", root)?.addEventListener("click", () => openReportModal(brandId));
  qsa("[data-report-open]", root).forEach((b) => b.addEventListener("click", () => openReportModal(brandId, { range: b.dataset.reportOpen })));
  qs("[data-report-snooze]", root)?.addEventListener("click", () => { snoozeReport(brandId); toast(t("rep.remind.snoozed")); refresh(); });
  // "Isi jadwal minggu ini": the chat's week plan (ideas the owner ticks).
  qs("[data-week-plan]", root)?.addEventListener("click", () => openWeekPlan());
  wireRecapCard(root, { brandId, refresh });
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));

  qs("[data-today-cta]", root)?.addEventListener("click", () => { if (top) runTodayAction(top, { brandId, brand, content, refresh }); });
  const dropEmptyNotices = () => { const box = qs(".home-notices", root); if (box && !box.children.length) box.remove(); };
  qs("[data-trial-dismiss]", root)?.addEventListener("click", () => {
    dismissTrialReminder();
    qs(".trial-remind", root)?.remove();
    dropEmptyNotices();
  });
  wireLowCreditNote(root);
  qs("[data-ai-low-close]", root)?.addEventListener("click", () => setTimeout(dropEmptyNotices, 0));
  qs("[data-shift-overdue]", root)?.addEventListener("click", () => {
    const lateAll = allOverdue.map((x) => x.content);
    const usedDates = content.filter((c) => c.scheduleDate).map((c) => c.scheduleDate);
    const { moves, kept } = planOverdueShift(lateAll, nextFreeUploadDays(usedDates, lateAll.length, brand.contentCadence), campaigns);
    moves.forEach(({ c, date }) => updateContent(c.id, { scheduleDate: date }));
    if (moves.length) toast(t("home.action.overdue.done", { n: moves.length }));
    if (kept.length) toast(t("home.action.overdue.kept", { n: kept.length }), "info");
    refresh();
  });
  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });
  qsa("[data-locked-step]", root).forEach((el) => {
    // Same "what's left + go there" dialog as the locked Tujuan tab.
    el.addEventListener("click", () => import("../layout.js").then((m) => m.explainIdentityGate(brandId)).catch(() => toast(t("home.next.lockedToast"))));
  });
  // Schedule rows and the analytics lists (top/retention posts) are divs.
  wireClickableCards(root, "div[data-open-content], [data-locked-step]");

  // The exact moment Campaign/Konten unlock is the one time a small callout
  // on the hero is worth it, so the change of "what to do now" isn't missed.
  if (identityJustDone) {
    const hero = qs("#journey-hero", root);
    if (hero) showCalloutBubble(hero, t("beginner.callout.builderDone"));
  }
}

// The finished-goal card (js/weekly-recap.js): "Pasang tujuan berikutnya"
// opens the Grow Brand goal wizard (the one Tujuan's "+ Tujuan baru"
// recommends); closing it — or saving a new goal from it — is remembered on
// the campaign (recapSeenAt), so it shows once on every device.
function wireRecapCard(root, { brandId, refresh }) {
  const markSeen = (id) => updateCampaign(id, { recapSeenAt: Date.now() });
  qsa("[data-recap-dismiss]", root).forEach((b) =>
    b.addEventListener("click", () => {
      markSeen(b.dataset.recapDismiss);
      refresh();
    })
  );
  qsa("[data-recap-next]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.recapNext;
      try {
        const { openGoalWizard } = await import("./goal-wizard.js");
        openGoalWizard({ brandId, brand: getBrand(brandId), onSaved: () => { markSeen(id); refresh(); } });
      } catch {
        location.hash = `#/brand/${brandId}/campaigns`;
      }
    })
  );
}

// ---- Trial reminder (audit-1005) --------------------------------------------
// On phones the topbar's trial badge is hidden, so the countdown lives here
// too, in both modes: a small strip once 7, 3 and 1 day(s) are left. Closing
// it hides it for the rest of the day only (per-device, try/catch'd).
const TRIAL_REMIND_KEY = "wpk-trial-remind-dismissed";
function trialReminderDismissedToday() {
  try {
    return localStorage.getItem(TRIAL_REMIND_KEY) === localISODate();
  } catch {
    return false;
  }
}
function dismissTrialReminder() {
  try {
    localStorage.setItem(TRIAL_REMIND_KEY, localISODate());
  } catch {
    /* storage unavailable — it just shows again next paint */
  }
}
export function trialReminderTier(account) {
  if (!isTrial(account) || isReadOnly(account)) return null;
  const days = trialDaysLeft(account);
  if (days < 1 || days > 7) return null;
  return days <= 1 ? "last" : days <= 3 ? "soon" : "week";
}
function trialReminderHTML() {
  const account = getCachedAccount();
  const tier = trialReminderTier(account);
  if (!tier || trialReminderDismissedToday()) return "";
  const days = trialDaysLeft(account);
  return `
    <div class="trial-remind is-${tier}" role="status">
      <span class="trial-remind-icon">${icon("clock", { size: 15 })}</span>
      <p class="trial-remind-text"><b>${esc(t(`home.trial.${tier}`, { n: days }))}</b> ${esc(t("home.trial.body"))}</p>
      <a class="btn btn-secondary btn-sm trial-remind-cta" href="#/pricing">${esc(t("home.trial.cta"))}</a>
      <button type="button" class="icon-btn trial-remind-close" data-trial-dismiss aria-label="${esc(t("common.close"))}" title="${esc(t("home.trial.dismiss"))}">${icon("x", { size: 13 })}</button>
    </div>`;
}

// ---- Brand header ----------------------------------------------------------
// The one picture on the page, made from what the owner already put in the
// Brand Book: logo, tagline (set in the brand's own font), palette and font
// names, over a soft wash of the brand color (--brand-tint, js/layout.js) —
// or over the owner's own cover photo when they've added one. The fuller the
// Brand Book, the more the page looks like their brand.

const HEX = /^#[0-9a-f]{3,8}$/i;
const isImageUrl = (u) => typeof u === "string" && (u.startsWith("data:image/") || u.startsWith("https://"));

// The posting streak and the report PDF used to sit here too; they're part
// of Minggu ini now (js/weekly-recap.js), so the header is only the brand.
function brandHeroHTML(brand, { sub }) {
  const bg = brand.brandGuidelines || {};
  const logo = bg.logo?.dataUrl || brand.avatar || "";
  const cover = isImageUrl(brand.coverPhoto) ? brand.coverPhoto : "";
  const canEdit = !isReadOnly(getCachedAccount());
  const tagline = (brand.brandDNA?.tagline || "").trim();
  const font = (bg.fonts?.primary || "").trim();
  // An uploaded font is registered from its own file (same helper the Brand
  // Book uses); every other name loads from Google Fonts.
  const customFont = font ? bg.customFonts?.[font] : "";
  if (font && tagline) {
    if (!customFont) ensureGoogleFont(font);
    else if (typeof customFont === "string" && customFont.startsWith("data:")) ensureCustomFont(font, customFont);
  }
  const swatches = ["primary", "secondary", "accent"].map((k) => bg.colors?.[k]).filter((c) => c && HEX.test(c));
  const fonts = [bg.fonts?.primary, bg.fonts?.secondary].filter(Boolean);
  const identity = swatches.length || fonts.length
    ? `<div class="brand-hero-identity">
        ${swatches.map((c) => `<span class="brand-hero-swatch" style="background:${c}" title="${c}"></span>`).join("")}
        ${fonts.length ? `<span class="brand-hero-fonts">${fonts.map(esc).join(" · ")}</span>` : ""}
      </div>`
    : "";
  const coverButtons = !canEdit
    ? ""
    : cover
      ? `<button type="button" class="btn btn-secondary btn-sm brand-hero-btn" data-cover-pick title="${t("home.cover.change")}">${icon("image", { size: 13 })}<span>${t("home.cover.change")}</span></button>
         <button type="button" class="btn btn-secondary btn-sm brand-hero-btn" data-cover-remove title="${t("home.cover.remove")}" aria-label="${t("home.cover.remove")}">${icon("trash", { size: 13 })}</button>`
      : `<button type="button" class="btn btn-secondary btn-sm brand-hero-btn" data-cover-pick title="${t("home.cover.addTitle")}">${icon("image", { size: 13 })}<span>${t("home.cover.add")}</span></button>`;
  return `
    <section class="glass-card brand-hero${cover ? " has-cover" : ""}">
      <div class="brand-hero-art" aria-hidden="true">
        ${cover ? `<img class="brand-hero-cover" src="${esc(cover)}" alt="" /><span class="brand-hero-shade"></span>` : "<span></span><span></span>"}
      </div>
      <div class="brand-hero-top">
        <div class="page-eyebrow flex items-center gap-6">${t("home.eyebrow")}${helpButtonHTML("home")}${guideVideoButtonHTML("home")}</div>
        <div class="brand-hero-actions">
          ${coverButtons}
          ${canEdit ? `<input type="file" accept="image/*" data-cover-input hidden />` : ""}
        </div>
      </div>
      <div class="brand-hero-main">
        ${isImageUrl(logo) ? `<img class="brand-hero-logo is-image" src="${esc(logo)}" alt="" />` : `<div class="brand-hero-logo">${esc(initials(brand.name))}</div>`}
        <div class="brand-hero-text">
          <h1>${esc(brand.name)}</h1>
          ${tagline ? `<p class="brand-hero-tagline"${font ? ` style="font-family:'${esc(font)}', var(--font-display), serif"` : ""}>${esc(tagline)}</p>` : ""}
          <p class="brand-hero-sub">${sub}</p>
          ${identity}
        </div>
      </div>
    </section>`;
}

// The brand doc (logo, custom fonts, everything) has to stay under
// Firestore's 1 MiB per-document limit, so the photo is shrunk first and
// refused, with a reason, when it still wouldn't fit next to the rest —
// the same check every Brand Book upload uses (js/brand-doc-size.js).
function wireBrandHero(root, brandId) {
  const input = qs("[data-cover-input]", root);
  qs("[data-cover-pick]", root)?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const dataUrl = await resizeImageFile(file, { maxDimension: 1280, quality: 0.72, format: "image/jpeg" });
      const brand = getBrand(brandId);
      if (!brand) return;
      if (!brandDocFits(brand, { coverPhoto: dataUrl })) {
        toast(t("home.cover.tooBig"), "error");
        return;
      }
      updateBrand(brandId, { coverPhoto: dataUrl });
      toast(t("home.cover.saved"));
    } catch {
      toast(t("home.cover.failed"), "error");
    }
  });
  qs("[data-cover-remove]", root)?.addEventListener("click", () => {
    updateBrand(brandId, { coverPhoto: "" });
    toast(t("home.cover.removed"));
  });
}

// ---- Latest content --------------------------------------------------------
// A thin row of small text cards — format, title, stage, date — so the page
// shows the brand's actual work at a glance. Published first (newest),
// topped up with what's coming next.

const FORMAT_ICON = { reels: "play", video: "play", story: "image", carousel: "layers", feed: "image", photo: "image" };

// `shownElsewhere`: pieces Hari ini or Minggu ini already show (the hero's
// own piece, this week's rows, the week's best post) — left out here so
// each piece is in one block only. Three tiles plus "Konten baru": a 2×2
// grid on phones (no sideways scrolling), one row on wider screens.
const RECENT_TILES = 3;
function recentContentHTML(brandId, content, shownElsewhere = new Set()) {
  const today = localISODate();
  const live = content.filter((c) => !c.archived && c.status !== "archived" && !shownElsewhere.has(c.id));
  const published = live.filter((c) => c.status === "published").sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""));
  // Coming = dated today or later, soonest first. Pieces whose date already
  // passed sit in Minggu ini's "lewat jadwal" rows, not here as "coming".
  const coming = live.filter((c) => c.status !== "published" && c.scheduleDate && c.scheduleDate >= today).sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  const items = [...published, ...coming].slice(0, RECENT_TILES);
  if (!items.length) return "";
  const cards = items
    .map((c) => {
      const date = c.status === "published" ? c.publishedDate : c.scheduleDate;
      const kind = [c.platform, c.format].filter(Boolean).join(" · ");
      return `
        <button type="button" class="recent-card" data-open-content="${c.id}">
          <span class="recent-card-top">
            <span class="recent-card-icon">${icon(FORMAT_ICON[(c.format || "").toLowerCase()] || "edit", { size: 14 })}</span>
            <span class="recent-card-format">${esc(kind || t("home.recent.noKind"))}</span>
          </span>
          <span class="recent-card-title">${esc(c.title || t("beginner.untitled"))}</span>
          <span class="recent-card-foot">
            <span class="status-pill status-${esc(c.status)}"><span class="status-dot"></span>${esc(statusLabel(c.status, STATUS_LABELS))}</span>
            ${date ? `<span class="recent-card-date">${formatDate(date)}</span>` : ""}
          </span>
        </button>`;
    })
    .join("");
  return `
    <section class="recent-strip home-b-recent">
      <div class="recent-strip-head">
        <h2 class="recent-strip-title">${t("home.recent.title")}</h2>
        <a class="link" href="#/brand/${brandId}/content/list">${t("home.recent.all")}</a>
      </div>
      <div class="recent-strip-row">
        ${cards}
        <a class="recent-card recent-card-new" href="#/brand/${brandId}/content/creator">${icon("plus", { size: 16 })}<span>${t("home.recent.new")}</span></a>
      </div>
    </section>`;
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

// Resume where the gap actually is (the first blank answer), not at step 1
// with six already-answered questions to click through first.
function dnaHref(brandId, brand) {
  const step = dnaResumeStep(brand);
  return step ? `#/brand/${brandId}/dna/${step}` : `#/brand/${brandId}/dna`;
}

// "Tinggal: tagline" — only once some answers exist and at most 3 are left,
// so a fresh brand isn't greeted by a list of eight missing things.
function dnaMissingNoteHTML(brand) {
  const dna = brand.brandDNA || {};
  const missing = missingDnaFields(dna);
  if (!missing.length) return dna.aiDraftPending ? `<div class="journey-hero-missing">${t("home.identity.draftPending")}</div>` : "";
  if (missing.length > 3) return "";
  return `<div class="journey-hero-missing">${icon("info", { size: 13 })}${t("home.identity.missing", { list: missing.map((f) => t(`home.identity.field.${f}`)).join(", ") })}</div>`;
}

function identityHeroHTML(brandId, brand) {
  const dna = brandDnaCompleteness(brand.brandDNA);
  const dnaDone = brandDnaDone(brand);
  const basicsDone = visualBasicsDone(brand);
  const pro = getMode() === "advanced";
  // Pemula's hero row is the gate itself — colour and fonts — counted one
  // by one (it used to jump 0/2 → 2/2) with the same rule as everywhere else.
  const book = pro ? brandBookProgress(brand) : { filled: ["color", "typography"].filter((k) => guidelineSectionDone(k, brand)).length, total: 2 };
  const cta = !dnaDone
    ? { label: dna.filled ? t("home.identity.ctaContinue") : t("home.identity.ctaStart"), href: dnaHref(brandId, brand) }
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
      ${dnaDone ? "" : dnaMissingNoteHTML(brand)}
      <a class="btn btn-primary journey-hero-cta" href="${cta.href}">${esc(cta.label)}${icon("arrowRight", { size: 15 })}</a>
      <div class="journey-hero-note">${t("beginner.hero.note")}</div>
    </section>
  `;
}

function todayHeroHTML(brandId, brand, campaigns, content, top) {
  let title, why, href, cta;
  let inPlace = false;
  let secondary = "";
  if (top) {
    const a = top.action;
    title = a.label;
    why = a.why;
    const route = todayRoute(brandId, top.campaign, a);
    cta = route.label || a.cta.label || t("beginner.today.doIt");
    href = route.href || "";
    inPlace = !!route.inPlace;
    // The one quiet link: the plan this step belongs to (the whole picture),
    // unless the button already goes there.
    const planHref = top.campaign ? `#/brand/${brandId}/campaigns/${top.campaign.id}` : "";
    if (planHref && href !== planHref) secondary = `<a class="link journey-hero-secondary" href="${planHref}">${t("beranda.today.seePlan")}</a>`;
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
    // What the brand's own numbers say (a posting gap and what it cost last
    // time, or the format that works) — not a generic pep line.
    why = postingLine(content, getSettings()) || t("beginner.today.fallbackWhy");
    cta = t("beginner.step.content.ctaWrite");
    href = `#/brand/${brandId}/content/creator`;
  }
  const button = cta && inPlace
    ? `<button type="button" class="btn btn-primary journey-hero-cta" data-today-cta>${esc(cta)}${icon("arrowRight", { size: 15 })}</button>`
    : cta && href
      ? `<a class="btn btn-primary journey-hero-cta" href="${href}">${esc(cta)}${icon("arrowRight", { size: 15 })}</a>`
      : "";
  return `
    <section class="card glass-card journey-hero journey-hero-today" id="journey-hero">
      <div class="journey-hero-eyebrow"><span class="journey-hero-step">${t("beginner.today.eyebrow")}</span>${top?.campaign ? `<span class="journey-hero-time">${icon("bulb", { size: 12 })}${esc(campaignDisplayName(top.campaign.name) || "Campaign")}</span>` : ""}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(why)}</p>
      ${button || secondary ? `<div class="journey-hero-actions">${button}${secondary}</div>` : ""}
    </section>
  `;
}

// next-action.js CTAs, routed by type. The ones that are a modal or the
// chat open right here (`inPlace`, run by runTodayAction): insights →
// Perbarui Insights, performance → Quick Fill, manual → the campaign's own
// "Catat angka" sheet, brainstorm → the Brainstorm chat on this campaign.
// The "info" ones (level ready, waiting weeks, a phase about to end) get a
// button to the campaign page, where the level-up itself happens.
// `campaign` is null for a brand-level action ("Isi angka" after posting).
function todayRoute(brandId, campaign, action) {
  const cta = action.cta;
  const campaignHref = campaign ? `#/brand/${brandId}/campaigns/${campaign.id}` : "";
  switch (cta.type) {
    case "creator":
      return { href: `#/brand/${brandId}/content/creator/${cta.contentId}` };
    case "new-content":
      return { href: `#/brand/${brandId}/content/creator` };
    case "calendar":
      return { href: `#/brand/${brandId}/content/calendar` };
    case "insights":
    case "performance":
    case "brainstorm":
      return { inPlace: true };
    case "manual":
      return campaign ? { inPlace: true } : {};
    case "info":
      return { href: campaignHref, label: t(action.id === "advance" ? "home.today.cta.levelUp" : action.id === "min-weeks" ? "home.today.cta.progress" : action.id === "window-end" ? "home.today.cta.targets" : "home.today.cta.campaign") };
    default:
      return { href: campaignHref };
  }
}

async function runTodayAction(top, { brandId, brand, content, refresh }) {
  const { campaign, action } = top;
  const cta = action.cta;
  if (cta.type === "insights") {
    const { openInsightsModal } = await import("./insights-modal.js");
    openInsightsModal({ brandId, onSaved: refresh, reason: t("camp.detail.insightsReason"), platform: campaignPlatform({ brand, campaign, content }) });
  } else if (cta.type === "performance") {
    const c = content.find((x) => x.id === cta.contentId);
    if (!c) return;
    const { openQuickFillModal } = await import("./content-list.js");
    openQuickFillModal({ c, onSaved: refresh });
  } else if (cta.type === "manual" && campaign) {
    // The sheet itself, over Beranda — not a trip to the campaign page.
    const { openManualStepFromHome } = await import("./campaign-detail.js");
    if (!openManualStepFromHome({ brandId, campaignId: campaign.id, milestoneId: cta.milestoneId || null, onDone: refresh })) location.hash = `#/brand/${brandId}/campaigns/${campaign.id}`;
  } else if (cta.type === "brainstorm" && campaign) {
    // The same chat the campaign page's Brainstorm opens, on this campaign
    // and stage — ideas come back as cards the owner picks, nothing is made.
    // The button asks for ideas, so the request is sent on arrival (intent
    // "ideas", js/consultant-panel.js applyChatContext) — it used to open an
    // empty chat with the general starters and leave the owner to guess.
    const stage = campaignStages(campaign)[cta.stageIndex ?? 0] || null;
    go(`#/brand/${brandId}/chat`, { fromLabel: t("nav.home"), campaignId: campaign.id, stageId: stage?.id || null, mode: "chat", intent: "ideas", seed: t("next.brainstorm.seed", { name: campaignDisplayName(campaign.name) || "" }).trim() });
  }
}

// ---- Steps ---------------------------------------------------------------------

// Folded under everything else: the one action up top is what to do now;
// this is only the map, opened when someone wants it.
function stepsHTML(journey, lockNext, celebrateIdentity, celebrateKeys = [], open = false) {
  const total = journey.steps.length;
  const rows = journey.steps.map((s, i) => stepRowHTML(s, i, journey, lockNext, celebrateIdentity, celebrateKeys)).join("");
  return `
      <details class="card glass-card card-tight journey journey-collapsed" id="beginner-journey" data-keep-open="steps"${open ? " open" : ""}>
        <summary>
          <span class="journey-summary-check">${icon(journey.currentIndex === -1 ? "check" : "layers", { size: 14 })}</span>
          <span class="t">${t("beginner.journey.collapsed", { done: journey.doneCount, total })}</span>
          ${stepDotsHTML(journey.doneCount, total)}
          <span class="m">${t("beginner.journey.viewEdit")}</span>
        </summary>
        <div class="journey-list">${rows}</div>
      </details>
  `;
}

function stepRowHTML(s, i, journey, lockNext, celebrateIdentity, celebrateKeys = []) {
  // Pemula: the Campaign step stays locked until the identity is done;
  // Konten is open from day one (try first, sharpen with Brand DNA later).
  // Pro: every step is open — "current" is just the first unfinished one.
  const locked = lockNext && s.key === "campaign" && !journey.identityDone;
  const state = s.done ? "done" : locked ? "upcoming" : i === journey.currentIndex ? "current" : "open";
  const celebrate = (celebrateIdentity && s.key === "identity") || celebrateKeys.includes(s.key) ? " journey-step-celebrate" : "";
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
