import { getCachedAccount, isLifetime } from "../account.js";
import { getBrand, listContent, listCampaigns, listOverdueAndDueSoon, onChange, getSettings, updateBrand } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, escapeHtml as escapeText, toast, showCalloutBubble } from "../dom.js";
import { brandDnaCompleteness, brandDnaDone } from "./brand-home.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { maybeShowSectionTour, sectionGuideButtonHTML, wireSectionGuideButton } from "../section-guide.js";
import { openContentEditor } from "./content-editor.js";
import { celebrateBuilderCompleteIfFlagged, consumeDnaJustCompleted, consumeVisualBasicsJustDone, visualBasicsDone } from "./brand-builder.js";
import { funnelLabel } from "../funnel-field.js";
import { brandTopAction } from "../next-action.js";
import { t } from "../i18n.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";

// Pemula mode's Beranda. One rule: the person never has to decide what to
// click. The page is a single "langkah kamu sekarang" card with one button,
// backed by a 4-step journey (buat akun brand → Brand DNA & Guidelines →
// rencana + campaign → konten pertama sampai upload) that unlocks in order.
// Steps unlock in order because the data genuinely flows downstream (Campaign
// reads Brand DNA, content links back to a Campaign) — not an arbitrary gate.
// Step 2 only ticks when BOTH Brand DNA and the visual basics are actually
// finished by the person; an AI draft that hasn't been reviewed leaves
// brandDNA.aiDraftPending set, so it does not count as done. Every app screen
// itself is unmodified; this is only the orchestration layer.
//
// Once all 4 are done the same hero card switches to "hari ini": the single
// most urgent thing across the brand's campaigns (js/next-action.js), so the
// page keeps answering "sekarang ngapain?" for as long as the brand lives.
const TOUR_STEPS = [
  {
    selector: "#journey-hero",
    title: t("beginner.tour.hero.title"),
    body: t("beginner.tour.hero.body"),
  },
  {
    selector: "#beginner-journey",
    title: t("beginner.tour.journey.title"),
    body: t("beginner.tour.journey.body"),
  },
  {
    selector: "#consultant-fab",
    title: t("beginner.tour.ai.title"),
    body: t("beginner.tour.ai.body"),
  },
];

export function render(root, { brandId }) {
  const refresh = () => paint(root, brandId, refresh);
  refresh();
  return onChange(refresh);
}

const TOTAL_STEPS = 4;

// Most-ready unfinished content first (same ordering idea as
// next-action.js's READINESS) so "lanjutkan konten" lands on the one
// closest to actually going out.
const READINESS = { scheduled: 0, editing: 1, production: 2, draft: 3, idea: 4 };

function buildJourney(brandId, brand, campaigns, content) {
  const dna = brandDnaCompleteness(brand.brandDNA);
  // Not the raw field count: an unreviewed AI draft fills all eight and used
  // to tick this step before the owner had read a word of it (brandDnaDone).
  const dnaDone = brandDnaDone(brand);
  const guidelinesDone = visualBasicsDone(brand);
  // One step, both halves — it's one job ("give this brand an identity"), and
  // it only gets a tick when both are genuinely finished.
  const identityDone = dnaDone && guidelinesDone;
  const hasCampaign = campaigns.length > 0;
  const unpublished = content.filter((c) => c.status !== "published").sort((a, b) => (READINESS[a.status] ?? 5) - (READINESS[b.status] ?? 5));
  const hasPublished = content.some((c) => c.status === "published");

  // Whichever half is still open is where the button goes, so the step never
  // needs the owner to work out which of the two pages it meant.
  const identityHref = dnaDone ? `#/brand/${brandId}/guidelines/color` : `#/brand/${brandId}/dna`;
  const identityCta = dnaDone ? t("beginner.step.identity.ctaGuidelines") : t("beginner.step.identity.ctaDna");
  const identityProgress = identityDone
    ? ""
    : dnaDone
      ? t("beginner.step.identity.progressDna")
      : guidelinesDone
        ? t("beginner.step.identity.progressGuidelines")
        : dna.filled
          ? t("beginner.step.identity.progressPartial", { filled: dna.filled, total: dna.total })
          : "";

  const steps = [
    {
      key: "brand",
      title: t("beginner.step.brand.title"),
      desc: t("beginner.step.brand.desc"),
      done: true,
      doneNote: brand.name,
    },
    {
      key: "identity",
      app: "builder",
      title: t("beginner.step.identity.title"),
      desc: t("beginner.step.identity.desc"),
      time: t("beginner.minutes", { n: 15 }),
      done: identityDone,
      href: identityHref,
      cta: identityCta,
      progress: identityProgress,
    },
    {
      key: "campaign",
      app: "campaigns",
      title: t("beginner.step.campaign.title"),
      desc: t("beginner.step.campaign.desc"),
      time: t("beginner.minutes", { n: 3 }),
      done: hasCampaign,
      href: `#/brand/${brandId}/campaigns`,
      cta: t("beginner.step.campaign.cta"),
    },
    {
      key: "content",
      app: "content-os",
      title: t("beginner.step.content.title"),
      desc: t("beginner.step.content.desc"),
      time: t("beginner.minutes", { n: 15 }),
      done: hasPublished,
      href: unpublished[0] ? `#/brand/${brandId}/content-os/creator/${unpublished[0].id}` : `#/brand/${brandId}/content-os/creator`,
      cta: unpublished[0] ? t("beginner.step.content.ctaContinue") : t("beginner.step.content.ctaWrite"),
      progress: unpublished[0] ? t("beginner.step.content.progress", { title: unpublished[0].title || t("beginner.untitled") }) : "",
    },
  ];

  // Where a finished step is re-opened from (the small "Ubah" link). The
  // identity step reopens on the Brand Builder hub, which holds both doors.
  const editHref = { identity: `#/brand/${brandId}/builder`, campaign: `#/brand/${brandId}/campaigns`, content: `#/brand/${brandId}/content-os` };
  steps.forEach((s) => { s.editHref = editHref[s.key] || ""; });

  const currentIndex = steps.findIndex((s) => !s.done);
  return { steps, currentIndex, doneCount: steps.filter((s) => s.done).length, dnaDone };
}

function paint(root, brandId, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  // 4.4: the same "just unlocked the next step" treatment (callout bubble +
  // the journey row's celebrate animation) now also fires the moment
  // visualBasicsDone flips true (Warna+Font saved), not only once every
  // other visual section is done too — that's the same half-step the
  // identity step reads in buildJourney. Both flags computed separately (not
  // `||` short-circuited) so either one left set still gets consumed even
  // when both happen to fire the same visit.
  const wholeBuilderJustCompleted = celebrateBuilderCompleteIfFlagged(brandId);
  const visualBasicsJustDone = consumeVisualBasicsJustDone(brandId);
  const builderJustCompleted = wholeBuilderJustCompleted || visualBasicsJustDone;
  // 3.3: Brand DNA's own Save now sends Pemula straight back here (instead
  // of the Brand Builder hub, which still reads the same flag for Pro) —
  // this is where the "Brand DNA selesai" confirmation has to live instead.
  if (consumeDnaJustCompleted(brandId)) toast(t("dna.celebrate.done"));
  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);
  const journey = buildJourney(brandId, brand, campaigns, content);
  const allDone = journey.currentIndex === -1;
  const dnaDone = journey.dnaDone;
  const brandOverdue = listOverdueAndDueSoon().overdue.filter((x) => x.brand.id === brandId);
  const scheduled = content.filter((c) => c.status === "scheduled");
  const upNext = [...scheduled].sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999")).slice(0, 3);
  const productionTasks = productionTaskList(content);
  const todoRows = todoRowsHTML(brandOverdue, upNext);
  const collapsed = new Set(brand.homeCollapsed || []);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("beginner.eyebrow")}${helpButtonHTML("beginner-home")}${sectionGuideButtonHTML("beginner-home")}</div>
        <h1>${escapeText(brand.name)}</h1>
        <p class="page-sub">${allDone ? t("beginner.sub.allDone") : t("beginner.sub.oneStep")}</p>
      </div>
      ${avatarHTML(brand, "width:64px;height:64px;border-radius:16px;font-size:24px;flex:none;")}
    </div>

    ${allDone ? todayHeroHTML(brandId, brand, campaigns, content) : stepHeroHTML(journey)}

    ${journeyHTML(journey, builderJustCompleted)}

    ${
      productionTasks.length
        ? (collapsed.has("production")
            ? widgetCollapsedHTML("production", "layers", t("beginner.production.title"), t("beginner.production.summary", { count: productionTasks.length }))
            : widgetCardHTML("production", "layers", t("beginner.production.title"), `
                <div class="card card-tight guided-checklist" style="margin-bottom:0;">${productionTasks.map(productionTaskRow).join("")}</div>
              `, { sub: t("beginner.production.hint") }))
        : ""
    }

    ${
      todoRows
        ? (collapsed.has("todo")
            ? widgetCollapsedHTML("todo", "bell", t("beginner.todo.title"), t("beginner.todo.summary", { count: Math.min(brandOverdue.length, 3) + upNext.length }))
            : widgetCardHTML("todo", "bell", t("beginner.todo.title"), `
                <div class="card card-tight guided-checklist" style="margin-bottom:0;">${todoRows}</div>
              `))
        : ""
    }

    ${
      dnaDone
        ? `
      <div class="section-title" style="margin-top:32px;">
        <h2>${t("beginner.quick.title")}</h2>
      </div>
      <a class="card glass-card card-tight beginner-quick-tool" href="#/brand/${brandId}/copy" data-app="copy">
        <div class="beginner-quick-tool-icon">${icon("chat", { size: 20 })}</div>
        <div class="ti">
          <div class="t">${t("beginner.quick.tool")}${isLifetime(getCachedAccount()) ? "" : ` <span class="lifetime-tag">${icon("lock", { size: 11 })}${t("app.lifetimeOnly")}</span>`}</div>
          <div class="m">${t("beginner.quick.desc")}</div>
        </div>
        <span class="beginner-app-done-edit">${t("beginner.quick.open")}${icon("arrowRight", { size: 12 })}</span>
      </a>
      <a class="card glass-card card-tight beginner-quick-tool" href="#/brand/${brandId}/sales" data-app="sales" style="margin-top:10px;">
        <div class="beginner-quick-tool-icon" style="color:var(--health-good);background:color-mix(in srgb, var(--health-good) 14%, transparent);">${icon("target", { size: 20 })}</div>
        <div class="ti">
          <div class="t">${t("beginner.quick.sales")}</div>
          <div class="m">${t("beginner.quick.salesDesc")}</div>
        </div>
        <span class="beginner-app-done-edit">${t("beginner.quick.open")}${icon("arrowRight", { size: 12 })}</span>
      </a>`
        : ""
    }
  `;

  wireHelpButtons(root);
  wireWidgetToggle(root, { collapsedList: brand.homeCollapsed, save: (next) => updateBrand(brandId, { homeCollapsed: next }), refresh });
  wireSectionGuideButton(root, "beginner-home", TOUR_STEPS);
  maybeShowSectionTour("beginner-home", TOUR_STEPS);

  root.querySelectorAll("[data-open-content]").forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });

  root.querySelectorAll("[data-work-content]").forEach((el) => {
    el.addEventListener("click", () => { location.hash = `#/brand/${brandId}/content-os/creator/${el.dataset.workContent}`; });
  });

  // The exact moment the Campaign step unlocks (Brand Builder just hit
  // 100%) is the one time it's worth a small callout on top of the hero
  // card, so the change of "what to do now" doesn't go unnoticed.
  if (builderJustCompleted) {
    const hero = root.querySelector("#journey-hero");
    if (hero) showCalloutBubble(hero, t("beginner.callout.builderDone"));
  }
}

// ---- Hero: the ONE thing to do now --------------------------------------

function stepHeroHTML(journey) {
  const step = journey.steps[journey.currentIndex];
  const n = journey.currentIndex + 1;
  return `
    <section class="card glass-card journey-hero" id="journey-hero">
      <div class="journey-hero-eyebrow">
        <span class="journey-hero-step">${t("beginner.hero.step", { n, total: TOTAL_STEPS })}</span>
        ${step.time ? `<span class="journey-hero-time">${icon("clock", { size: 12 })}${step.time}</span>` : ""}
      </div>
      <h2>${escapeText(step.title)}</h2>
      <p>${escapeText(step.desc)}</p>
      ${step.progress ? `<div class="journey-hero-progress">${icon("check", { size: 13 })}${escapeText(step.progress)}</div>` : ""}
      <a class="btn btn-primary journey-hero-cta" href="${step.href}">${escapeText(step.cta)}${icon("arrowRight", { size: 15 })}</a>
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
  } else if (!brand.brandGuidelines?.logo?.dataUrl) {
    // 4.4: no campaign action to do right now — Logo/Direction/Tone/
    // Applications aren't part of Pemula's required Warna+Font flow, so
    // they're offered here one at a time instead of all at once. Logo
    // first: every other visual section (business cards, social
    // templates) actually needs it. Just a link to the page that already
    // exists, not a new feature.
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
      <div class="journey-hero-eyebrow"><span class="journey-hero-step">${t("beginner.today.eyebrow")}</span>${top ? `<span class="journey-hero-time">${icon("bulb", { size: 12 })}${escapeText(top.campaign.name || "Campaign")}</span>` : ""}</div>
      <h2>${escapeText(title)}</h2>
      <p>${escapeText(why)}</p>
      ${cta && href ? `<a class="btn btn-primary journey-hero-cta" href="${href}">${escapeText(cta)}${icon("arrowRight", { size: 15 })}</a>` : ""}
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

// ---- Journey list ---------------------------------------------------------

function journeyHTML(journey, celebrateBuilder) {
  const rows = journey.steps.map((s, i) => journeyStepHTML(s, i, journey.currentIndex, celebrateBuilder)).join("");
  if (journey.currentIndex === -1) {
    return `
      <details class="card glass-card card-tight journey journey-collapsed" id="beginner-journey">
        <summary>
          <span class="journey-summary-check">${icon("check", { size: 14 })}</span>
          <span class="t">${t("beginner.journey.collapsed", { done: journey.doneCount, total: TOTAL_STEPS })}</span>
          <span class="m">${t("beginner.journey.viewEdit")}</span>
        </summary>
        <div class="journey-list">${rows}</div>
      </details>
    `;
  }
  return `
    <div class="section-title" style="margin-top:28px;">
      <h2>${t("beginner.journey.title")}</h2>
      <span class="text-faint" style="font-size:12px;">${t("beginner.journey.count", { done: journey.doneCount, total: TOTAL_STEPS })}</span>
    </div>
    <div class="card glass-card card-tight journey" id="beginner-journey">
      <div class="journey-list">${rows}</div>
    </div>
  `;
}

function journeyStepHTML(s, i, currentIndex, celebrateBuilder) {
  const state = s.done ? "done" : i === currentIndex ? "current" : "upcoming";
  const appAttr = s.app ? ` data-app="${s.app}"` : "";
  const celebrate = celebrateBuilder && s.key === "identity" ? " journey-step-celebrate" : "";
  const marker = s.done ? icon("check", { size: 13 }) : `<span>${i + 1}</span>`;
  const inner = `
    <span class="journey-marker">${marker}</span>
    <span class="journey-text">
      <span class="t">${escapeText(s.title)}</span>
      <span class="m">${s.done ? escapeText(s.doneNote || t("beginner.journey.done")) : state === "current" ? escapeText(s.desc) : t("beginner.journey.locked")}</span>
    </span>
    ${s.done && s.editHref ? `<span class="journey-edit">${t("beginner.journey.edit")}${icon("arrowRight", { size: 12 })}</span>` : ""}
    ${state === "current" ? `<span class="journey-edit journey-go">${escapeText(s.cta)}${icon("arrowRight", { size: 12 })}</span>` : ""}
    ${state === "upcoming" ? `<span class="journey-lock">${icon("lock", { size: 13 })}</span>` : ""}
  `;
  const href = s.done ? s.editHref : state === "current" ? s.href : "";
  // Upcoming steps are plain <div>s, not links — no href at all is what
  // actually makes them unreachable (pointer-events alone doesn't stop
  // keyboard Enter on a focusable link).
  return href
    ? `<a class="journey-step journey-step-${state}${celebrate}" href="${href}"${appAttr}>${inner}</a>`
    : `<div class="journey-step journey-step-${state}"${appAttr}>${inner}</div>`;
}

// ---- Small bits -----------------------------------------------------------

// The physical production pipeline, not app navigation — once a beginner has
// content actually moving (shot, being edited, queued to post), they need to
// be told "go do this next" the same direct way the journey does.
const PRODUCTION_STAGE_VERB = { production: t("beginner.verb.production"), editing: t("beginner.verb.editing"), scheduled: t("beginner.verb.scheduled") };

function productionTaskList(content) {
  return content
    .filter((c) => PRODUCTION_STAGE_VERB[c.status])
    .map((c) => ({ verb: PRODUCTION_STAGE_VERB[c.status], c }))
    .sort((a, b) => (a.c.scheduleDate || "9999").localeCompare(b.c.scheduleDate || "9999"));
}

function productionTaskRow(task) {
  return `
    <div class="top-content-row" data-work-content="${task.c.id}" style="cursor:pointer;">
      <span class="tag" style="flex:none;">${task.verb}</span>
      <div class="ti">
        <div class="t">${escapeText(task.c.title || t("beginner.untitled"))}</div>
        <div class="m">${task.c.platform || "—"}${task.c.scheduleDate ? ` · ${formatDate(task.c.scheduleDate)}` : ""}</div>
      </div>
      ${icon("arrowRight", { size: 14 })}
    </div>
  `;
}

function todoRowsHTML(overdue, upNext) {
  const rows = [];
  overdue.slice(0, 3).forEach((x) => {
    rows.push(`
      <div class="top-content-row" data-open-content="${x.content.id}" style="cursor:pointer;">
        <div class="ti">
          <div class="t">${escapeText(x.content.title || t("beginner.untitled"))}</div>
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
          <div class="t">${escapeText(c.title || t("beginner.untitled"))}</div>
          <div class="m">${c.platform || "—"} · ${formatDate(c.scheduleDate)}</div>
        </div>
        <span class="tag tag-${(c.funnel || "").toLowerCase()}">${funnelLabel(c.funnel)}</span>
      </div>
    `);
  });
  return rows.join("");
}
