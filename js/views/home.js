import { getBrand, listContent, listCampaigns, listOverdueAndDueSoon, onChange, getSettings, updateBrand, removeBrandLogEntry } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, escapeHtml as esc, toast, showCalloutBubble, qs, qsa } from "../dom.js";
import { brandDnaCompleteness, brandDnaDone, visualBasicsDone, brandBookProgress, identityDone as isIdentityDone, dnaResumeStep, missingDnaFields } from "../brand-progress.js";
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
import { openReportModal, reportDue, reportReminderHTML, snoozeReport } from "./report.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { computeSignals, topSignal } from "../brand-pulse.js";
import { openBrandMemoryModal, savedMoments, momentKindLabel, unrecappedMessages } from "../brand-memory.js";
import { openConsultantPanel } from "../consultant-panel.js";
import { postingLine } from "../brand-learning.js";

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
  const h = now.getHours();
  const key = h < 11 ? "companion.greeting.morning" : h < 17 ? "companion.greeting.afternoon" : "companion.greeting.evening";
  return t(key, { brand: esc(brand.name) });
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

function momentsStripHTML(brand) {
  const moments = savedMoments(brand).slice(0, MOMENTS_SHOWN);
  const rows = moments
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
      <div class="companion-moments-head">
        <p class="companion-moments-title">${t("companion.memory.title")}</p>
        <button type="button" class="link" id="companion-manage" style="font-size:11px;">${t("companion.moments.manage")}</button>
      </div>
      ${rows || `<p class="text-faint" style="font-size:12px;margin:0;">${t("companion.memory.empty")}</p>`}
    </div>`;
}

function companionCardHTML(brand, { signals, content, now }) {
  const top = topSignal(signals);
  const unrecapped = unrecappedMessages(brand.id).filter((m) => m.role === "user").length;
  const weekAgo = now.getTime() - 7 * 86400000;
  const momentsThisWeek = savedMoments(brand).filter((e) => e.at >= weekAgo).length;
  return {
    extraHead: unrecapped ? `<button type="button" class="btn btn-secondary btn-sm" data-companion-open="recap" title="${esc(t("home.companion.unrecapped", { n: unrecapped }))}">${icon("sparkle", { size: 12 })}${t("companion.recap.button")} (${unrecapped})</button>` : "",
    bodyHTML: `
      <p class="companion-greeting">${greetingSentence(brand, now)} <b>${esc(top ? top.title : t("companion.observation.quiet"))}</b></p>
      <p class="text-muted" style="font-size:12.5px;margin:6px 0 0;">${t("home.companion.sub")}</p>
      <div class="companion-actions">
        <button type="button" class="btn btn-primary btn-sm" data-companion-open="companion">${icon("heart", { size: 13 })}${t("home.companion.tell")}</button>
        ${companionActionsHTML(signals, content, brand.id)}
      </div>
      ${momentsStripHTML(brand)}
    `,
    summary: momentsThisWeek ? t("companion.moments.summary", { n: momentsThisWeek }) : t("home.companion.summary.empty"),
  };
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
  // Computed once per paint for the Teman card's greeting and action buttons.
  const signals = computeSignals({ brand, content, campaigns, settings: getSettings() });
  const companion = companionCardHTML(brand, { signals, content, now: new Date() });
  const goal = goalWidget({ brandId, brand, campaigns, content, identityDone });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("home.eyebrow")}${helpButtonHTML("home")}${guideVideoButtonHTML("home")}</div>
        <h1>${esc(brand.name)}</h1>
        <p class="page-sub">${!identityDone ? t("home.sub.identity") : journey.doneCount < journey.steps.length ? t("beginner.sub.identityDone", { n: journey.steps.length - journey.doneCount }) : t("beginner.sub.allDone")}</p>
      </div>
      <div class="home-head-side">
        <button type="button" class="btn btn-secondary btn-sm" id="home-report" title="${t("rep.btnTitle")}">${icon("download", { size: 13 })}${t("rep.btn")}</button>
        ${avatarHTML(brand, "width:64px;height:64px;border-radius:16px;font-size:24px;flex:none;")}
      </div>
    </div>

    ${identityDone ? todayHeroHTML(brandId, brand, campaigns, content) : identityHeroHTML(brandId, brand)}

    ${reportDue(brand, content) ? reportReminderHTML(brand) : ""}

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

    ${
      scheduleRows
        ? collapsed.has("todo")
          ? widgetCollapsedHTML("todo", "calendar", t("brandHome.upNext.title"), t("beginner.todo.summary", { count: Math.min(brandOverdue.length, 3) + upNext.length }))
          : widgetCardHTML("todo", "calendar", t("brandHome.upNext.title"), `<div class="card card-tight guided-checklist" style="margin-bottom:0;">${scheduleRows}</div>`, {
              extraHead: `<a class="link" href="#/brand/${brandId}/content/calendar">${t("brandHome.upNext.calendarLink")}</a>`,
            })
        : ""
    }

    ${stepsHTML(journey, cfg.lockNext, identityJustDone)}

    ${cfg.analytics ? analyticsSectionHTML(content, getSettings(), state, "") : ""}
  `;

  wireHelpButtons(root);
  wireGoalCard(root, { brandId });
  wireWidgetToggle(root, { collapsedList: brand.homeCollapsed, save: (next) => updateBrand(brandId, { homeCollapsed: next }), refresh });
  if (!collapsed.has("companion")) wireCompanionCard(root, { brandId, refresh });
  if (cfg.analytics) wireAnalyticsSection(root, state, refresh);
  // One report, for both modes: the page-head button and the weekly nudge.
  qs("#home-report", root)?.addEventListener("click", () => openReportModal(brandId));
  qsa("[data-report-open]", root).forEach((b) => b.addEventListener("click", () => openReportModal(brandId, { range: b.dataset.reportOpen })));
  qs("[data-report-snooze]", root)?.addEventListener("click", () => { snoozeReport(brandId); toast(t("rep.remind.snoozed")); refresh(); });
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
  const book = pro ? brandBookProgress(brand) : { filled: basicsDone ? 2 : 0, total: 2 };
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
    // What the brand's own numbers say (a posting gap and what it cost last
    // time, or the format that works) — not a generic pep line.
    why = postingLine(content, getSettings()) || t("beginner.today.fallbackWhy");
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

// Folded under everything else: the one action up top is what to do now;
// this is only the map, opened when someone wants it.
function stepsHTML(journey, lockNext, celebrateIdentity) {
  const total = journey.steps.length;
  const rows = journey.steps.map((s, i) => stepRowHTML(s, i, journey, lockNext, celebrateIdentity)).join("");
  return `
      <details class="card glass-card card-tight journey journey-collapsed" id="beginner-journey">
        <summary>
          <span class="journey-summary-check">${icon(journey.currentIndex === -1 ? "check" : "layers", { size: 14 })}</span>
          <span class="t">${t("beginner.journey.collapsed", { done: journey.doneCount, total })}</span>
          <span class="m">${t("beginner.journey.viewEdit")}</span>
        </summary>
        <div class="journey-list">${rows}</div>
      </details>
  `;
}

function stepRowHTML(s, i, journey, lockNext, celebrateIdentity) {
  // Pemula: the Campaign step stays locked until the identity is done;
  // Konten is open from day one (try first, sharpen with Brand DNA later).
  // Pro: every step is open — "current" is just the first unfinished one.
  const locked = lockNext && s.key === "campaign" && !journey.identityDone;
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
