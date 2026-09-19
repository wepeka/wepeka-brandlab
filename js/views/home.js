import { getBrand, listContent, listCampaigns, listOverdueAndDueSoon, onChange, getSettings, updateBrand, addBrandNote, addBrandLogEntry, ackBrandEvent, localISODate } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, escapeHtml as esc, toast, showCalloutBubble, qs, qsa } from "../dom.js";
import { brandDnaCompleteness, brandDnaDone, visualBasicsDone, brandBookProgress, identityDone as isIdentityDone } from "../brand-progress.js";
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
import { companionReply, hasAiKey, AiApiError } from "../ai.js";
import { wireMic } from "../voice-input.js";
import { go } from "../nav-context.js";

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
      href: unpublished[0] ? `#/brand/${brandId}/content-os/creator/${unpublished[0].id}` : `#/brand/${brandId}/content-os/creator`,
      editHref: `#/brand/${brandId}/content-os`,
      cta: unpublished[0] ? t("beginner.step.content.ctaContinue") : t("beginner.step.content.ctaWrite"),
    },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);
  return { steps, currentIndex, doneCount: steps.filter((s) => s.done).length, identityDone };
}

// ---------- Companion (R5, Brief Revisi 2 fase 4) ----------
// A daily "what happened today?" — not a report, a friend checking in.
// Greets once a day (brand.companion.lastAskedAt), then every reply the
// owner types becomes a brand.developmentLog note (js/store.js
// addBrandNote) plus one short AI reply (js/ai.js companionReply) that
// every other AI feature's context picks up through js/brand-pulse.js
// pulseText from then on.

// Which signal kinds get a quick-action button, in priority order — same
// four the brief calls out, first match wins for the greeting's "yang aku
// lihat" line too so the two never disagree about what's most notable.
const COMPANION_ACTION_KINDS = ["viral", "follower-jump", "sales-down", "streak-break"];
const GREETING_PRIORITY = ["viral", "sales-down", "follower-jump", "follower-drop", "engagement-drop", "streak-break", "top-format", "sales-up", "stale-campaign", "overdue", "cross"];

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

// [[idea:Title|why]] and [[ask:Question]] — the two directives
// companionReply's system prompt is allowed to use (js/ai.js). A minimal,
// self-contained parser rather than importing consultant-panel.js's
// (that generalizes into its own js/ai-directives.js in fase 5, shared with
// the Brainstorm chat — not built yet).
function parseCompanionReply(raw) {
  let text = raw || "";
  let idea = null;
  let ask = null;
  text = text.replace(/\[\[idea:([^|\]]+)\|([^\]]+)\]\]/i, (_, title, why) => {
    idea = { title: title.trim(), why: why.trim() };
    return "";
  });
  text = text.replace(/\[\[ask:([^\]]+)\]\]/i, (_, q) => {
    ask = q.trim();
    return "";
  });
  return { text: text.trim(), idea, ask };
}

function companionBubbleHTML(role, html) {
  return `<div class="consultant-msg consultant-msg-${role}">${html}</div>`;
}

function companionActionsHTML(signals, content, brandId) {
  const picks = COMPANION_ACTION_KINDS.map((kind) => signals.find((s) => s.kind === kind)).filter(Boolean).slice(0, 2);
  if (!picks.length) return "";
  const buttons = picks.map((s) => {
    if (s.kind === "viral") {
      const c = content.find((x) => x.id === s.refs.contentId);
      const seed = t("companion.seed.viral", { title: esc(c?.title || t("pulse.untitledContent")) });
      return `<button type="button" class="btn btn-secondary btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 13 })}${t("companion.action.similarContent")}</button>`;
    }
    if (s.kind === "follower-jump") {
      const seed = t("companion.seed.followerJump", { platform: esc(s.refs.platform || "") });
      return `<button type="button" class="btn btn-secondary btn-sm" data-companion-go="brainstorm" data-companion-seed="${esc(seed)}">${icon("bulb", { size: 13 })}${t("companion.action.rideMomentum")}</button>`;
    }
    if (s.kind === "sales-down") {
      return `<a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/sales">${icon("chart", { size: 13 })}${t("companion.action.openSales")}</a>`;
    }
    // streak-break
    return `<a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/content-os/creator">${icon("edit", { size: 13 })}${t("companion.action.openCreator")}</a>`;
  });
  return `<div class="companion-actions">${buttons.join("")}</div>`;
}

function companionLogHTML(log) {
  const recent = [...(log || [])].sort((a, b) => b.at - a.at).slice(0, 3);
  if (!recent.length) return "";
  const rows = recent
    .map(
      (e) => `
      <div class="companion-log-row" data-companion-log-row="${e.id}">
        <span class="companion-log-text">${esc(e.title || "")}</span>
        ${!e.ack ? `<button type="button" class="chip-icon-btn" data-companion-ack="${e.id}" aria-label="${t("common.close")}" title="${t("common.close")}">${icon("x", { size: 12 })}</button>` : ""}
      </div>`
    )
    .join("");
  return `<div class="companion-log"><p class="companion-log-title">${t("companion.log.title")}</p>${rows}</div>`;
}

function companionWidgetHTML(brand, { signals, content, now, pending, error }) {
  const today = localISODate(now);
  const askedToday = brand.companion?.lastAskedAt === today;
  const log = brand.developmentLog || [];
  const lastEntry = [...log].sort((a, b) => b.at - a.at)[0];

  let threadHTML;
  if (!askedToday) {
    const top = pickTopSignal(signals);
    const observation = top ? top.title : t("companion.observation.quiet");
    threadHTML = companionBubbleHTML("assistant", `${greetingSentence(brand, now)} ${esc(observation)}`);
  } else if (lastEntry) {
    const html = lastEntry.source === "note" ? esc(lastEntry.title) : esc(lastEntry.title);
    threadHTML = companionBubbleHTML(lastEntry.source === "note" ? "user" : "assistant", html);
  } else {
    threadHTML = "";
  }
  if (pending) threadHTML += companionBubbleHTML("assistant", `<span class="typing-dots" aria-label="${t("cons.typing")}"><i></i><i></i><i></i></span>`);

  const weekAgo = now.getTime() - 7 * 86400000;
  const newThisWeek = log.filter((e) => e.at >= weekAgo).length;

  return {
    bodyHTML: `
      <div class="companion-thread">${threadHTML}</div>
      ${error ? `<p class="companion-error">${esc(error)}</p>` : ""}
      <div class="companion-composer">
        <input type="text" class="input" id="companion-input" placeholder="${esc(askedToday ? t("companion.askAgain") : t("companion.placeholder"))}" ${pending ? "disabled" : ""} />
        <button type="button" class="chip-icon-btn" id="companion-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}">${icon("mic", { size: 15 })}</button>
        <button type="button" class="btn btn-primary btn-sm" id="companion-send" ${pending ? "disabled" : ""}>${t("companion.send")}</button>
      </div>
      ${companionActionsHTML(signals, content, brand.id)}
      ${companionLogHTML(log)}
    `,
    summary: newThisWeek ? t("companion.log.summary", { n: newThisWeek }) : t("companion.observation.quiet"),
  };
}

function wireCompanion(root, { brandId, brand, content, signals, state, refresh }) {
  const input = qs("#companion-input", root);
  const sendBtn = qs("#companion-send", root);
  const micBtn = qs("#companion-mic", root);
  if (micBtn && input) wireMic(micBtn, input);

  const send = async (textArg) => {
    const text = (textArg ?? input?.value ?? "").trim();
    if (!text || state.companionPending) return;
    state.companionPending = true;
    state.companionError = "";
    refresh();
    addBrandNote(brandId, text);
    updateBrand(brandId, { companion: { ...(brand.companion || {}), lastAskedAt: localISODate() } });
    try {
      const ai = getSettings().ai || {};
      if (!hasAiKey(ai)) throw new AiApiError(t("companion.aiUnavailable"));
      const fresh = getBrand(brandId);
      const pulseText = pulseTextFor(fresh, { content, campaigns: listCampaigns(brandId), settings: getSettings() });
      const raw = await companionReply(ai, { brand: fresh, pulseText, note: text });
      const { text: cleanText, idea, ask } = parseCompanionReply(raw);
      const pieces = [cleanText];
      if (idea) pieces.push(`💡 <b>${esc(idea.title)}</b> — ${esc(idea.why)}`);
      if (ask) pieces.push(`<button type="button" class="consultant-starter" data-companion-followup="${esc(ask)}">${esc(ask)}</button>`);
      addBrandLogEntry(brandId, { kind: "companion-reply", source: "ai", title: cleanText || raw, detail: cleanText || raw });
    } catch (e) {
      state.companionError = e instanceof AiApiError ? e.message : t("companion.saveFailed");
    } finally {
      state.companionPending = false;
      refresh();
    }
  };

  sendBtn?.addEventListener("click", () => send());
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });
  qsa("[data-companion-followup]", root).forEach((btn) =>
    btn.addEventListener("click", () => send(btn.dataset.companionFollowup))
  );
  qsa("[data-companion-ack]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      ackBrandEvent(brandId, btn.dataset.companionAck);
      refresh();
    })
  );
  qsa("[data-companion-go]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      go(`#/brand/${brandId}/brainstorm`, { seed: btn.dataset.companionSeed, fromLabel: brand.name });
    })
  );
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
  const companion = companionWidgetHTML(brand, { signals, content, now: new Date(), pending: !!state.companionPending, error: state.companionError });

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
      collapsed.has("companion")
        ? widgetCollapsedHTML("companion", "chat", t("home.companion.title"), companion.summary)
        : widgetCardHTML("companion", "chat", t("home.companion.title"), companion.bodyHTML)
    }

    ${stepsHTML(journey, cfg.lockNext, identityJustDone)}

    ${
      scheduleRows
        ? collapsed.has("todo")
          ? widgetCollapsedHTML("todo", "calendar", t("brandHome.upNext.title"), t("beginner.todo.summary", { count: Math.min(brandOverdue.length, 3) + upNext.length }))
          : widgetCardHTML("todo", "calendar", t("brandHome.upNext.title"), `<div class="card card-tight guided-checklist" style="margin-bottom:0;">${scheduleRows}</div>`, {
              extraHead: `<a class="link" href="#/brand/${brandId}/content-os/calendar">${t("brandHome.upNext.calendarLink")}</a>`,
            })
        : ""
    }

    ${cfg.analytics ? analyticsSectionHTML(content, getSettings(), state, `<button type="button" class="btn btn-secondary btn-sm" id="home-report">${icon("download", { size: 13 })}${t("home.report")}</button>`) : ""}
  `;

  wireHelpButtons(root);
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
    href = `#/brand/${brandId}/content-os/creator`;
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
      return `#/brand/${brandId}/content-os/creator/${cta.contentId}`;
    case "new-content":
      return `#/brand/${brandId}/content-os/creator`;
    case "calendar":
      return `#/brand/${brandId}/content-os/calendar`;
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
