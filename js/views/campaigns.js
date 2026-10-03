import {
  getBrand, listContent, createContent, onChange, getSettings,
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_PHASE_TEMPLATE,
  phaseNameLabel, TRASH_DAYS,
  daysBetween, formatEventDate, localISODate, listGoals, getGoal, settleFinishedEvents, planIdeasNote,
} from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { toast, formatNumber, linesToList, listToLines, qs, qsa, openMenu, closeMenu, escapeHtml as escapeText, escapeHtml as escapeAttr, wireClickableCards } from "../dom.js";
import { hasAiKey } from "../ai.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { startCampaignListGuide, startCampaignListGuideOnMount, startCampaignDetailGuideOnMount } from "../guides/campaign-guide.js";
import { t } from "../i18n.js";
import { getMode } from "../mode.js";
import { DEMO_TOAST } from "../tour-demo.js";
import { campaignStages, activeStageIndex, campaignHeadline, TRACK_ICON } from "../campaign-metrics.js";
import { crossCampaignInsights } from "../cross-campaign.js";
import { nextActions } from "../next-action.js";
import { paintDetail } from "./campaign-detail.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { openGoalWizard } from "./goal-wizard.js";
// The Event quick-template used to run its own standalone intake
// (openEventSetupWizard/finishEventCampaign, removed) that created a bare
// campaign with no goalId. Roadmap ke Tujuan's wizard is the one true event
// intake now — it carries goalId + dates through to the audience/community
// lanes too, so both entry points open the same flow.
import { openGoalWizard as openEventGoalWizard, openReplanDialog } from "./goal-roadmap.js";

// Reuses the existing status-pill color classes (defined for Content's own
// idea/draft/production/editing/scheduled/published/archived vocabulary)
// instead of adding new CSS for a second status vocabulary — the color
// association (grey/blue/gold/green) still reads sensibly for a campaign's
// own planning → active → completed → archived lifecycle.
const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

export function render(root, { brandId, campaignId }) {
  const state = { stageIndex: null, celebrateIndex: null, advancing: false };
  const refresh = () => { settleFinishedEvents(brandId); paint(root, brandId, campaignId, state, refresh); };
  refresh();
  // Once per mount (list and detail are separate routes/mounts) — paint()
  // runs again on every db:change.
  if (campaignId) startCampaignDetailGuideOnMount(brandId, campaignId);
  else startCampaignListGuideOnMount(brandId);
  return onChange(refresh);
}

function editCampaign(brandId, campaign, onSaved) {
  const goal = campaign.eventPlan && campaign.goalId ? getGoal(brandId, campaign.goalId) : null;
  if (goal) openReplanDialog({ brandId, goal });
  else openCampaignModal({ brandId, campaign, onSaved });
}

function paint(root, brandId, campaignId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  if (campaignId) {
    const campaign = getCampaign(campaignId);
    if (!campaign) {
      location.hash = `#/brand/${brandId}/campaigns`;
      return;
    }
    // An Event is edited through its plan (name, date, size, rhythm), which
    // moves the phases, deadlines and calendar together — the generic campaign
    // form would only change the campaign and leave the plan behind.
    paintDetail(root, brandId, brand, campaign, state, refresh, { openEdit: () => editCampaign(brandId, campaign, refresh) });
    return;
  }
  paintList(root, brandId, brand, refresh);
}

// ---------- List view ----------

function paintList(root, brandId, brand, refresh) {
  const campaigns = listCampaigns(brandId);
  const content = listContent(brandId);
  // Grow Brand's own tracks (Social Media Growth / Community Growth) get
  // their own grouped section — each still its own card with its own
  // progress, never combined into one number — plus, when both are
  // running with enough fresh data, a cross-campaign insight banner
  // (js/cross-campaign.js). Everything else (Event, legacy campaigns)
  // stays in the regular grid below.
  const growBrand = campaigns.filter((c) => c.goalPlan?.version === 3 && !["archived", "completed"].includes(c.status));
  // Events are their own section too: a date-bound push reads very
  // differently from an open-ended growth ladder, and mixed in one grid the
  // two kinds were hard to tell apart.
  const events = campaigns.filter((c) => !growBrand.includes(c) && (c.objective === "event" || c.eventPlan));
  const rest = campaigns.filter((c) => !growBrand.includes(c) && !events.includes(c));
  // An event plan that isn't installed yet has no campaign — it used to be
  // findable only under the separate "Rencana menuju tanggal" list, so a
  // Pemula account locked on "one plan at a time" couldn't see what was
  // holding the lock. It sits with the other events now.
  const draftPlans = listGoals(brandId).filter((g) => ["draft", "installing", "partial"].includes(g.status) && !campaigns.some((c) => c.goalId === g.id));
  const eventCards = [...draftPlans.map((g) => draftPlanCard(brandId, g)), ...events.map((c) => campaignCard(brandId, c, content, brand))];
  const insights = growBrand.length ? crossCampaignInsights({ campaigns, content, brand, settings: getSettings() }) : [];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${helpButtonHTML("campaigns")}${guideVideoButtonHTML("campaigns")}</div>
        <h1>${t("camp.list.eyebrow")}</h1>
        <p class="page-head-brand">${escapeText(brand.name)}</p>
      </div>
      <button class="btn btn-primary" id="new-campaign">${icon("plus", { size: 16 })}${t("camp.newCampaign")}</button>
    </div>
    <p class="page-sub" style="margin-bottom:14px;">${
      getMode() === "guided"
        ? t("camp.list.subGuided")
        : t("camp.list.subPro")
    }</p>
    <!-- Pelacak Penjualan used to be a second header button next to "new",
         which read as another kind of goal. It's a tool the goals read from
         (Sales Growth counts what's logged there), so it sits here as a
         labelled link that says what it is for. -->
    <a class="camp-sales-link" href="#/brand/${brandId}/sales" id="open-sales">
      <span class="camp-sales-link-icon">${icon("money", { size: 16 })}</span>
      <span class="camp-sales-link-text"><b>${t("camp.list.salesTracker")}</b><small>${t("camp.list.salesTrackerSub")}</small></span>
      ${icon("arrowRight", { size: 14 })}
    </a>
    ${growBrand.length ? growBrandSectionHTML(growBrand, insights) : ""}
    ${eventCards.length ? `<section class="camp-section">${sectionHeadHTML("event", t("camp.section.events"), t("camp.section.eventsSub"), eventCards.length)}<div class="brand-grid">${eventCards.join("")}</div></section>` : ""}
    ${
      rest.length
        ? campSectionHTML("other", growBrand.length || events.length ? t("camp.section.other") : "", "", rest)
        : !campaigns.length && !draftPlans.length
        ? `<div class="empty-state" style="max-width:460px;margin:0 auto;">
             <div class="icon-wrap">${icon("target", { size: 22 })}</div>
             <h3>${t("camp.list.emptyTitle")}</h3>
             <p>${
               getMode() === "guided"
                 ? t("camp.list.emptyGuided")
                 : t("camp.list.emptyPro")
             }</p>
             <button type="button" class="btn btn-primary" id="empty-new-campaign">${icon("plus", { size: 15 })}${t("camp.newCampaign")}</button>
           </div>`
        : ""
    }
  `;

  function sectionHeadHTML(kind, title, sub, count) {
    if (!title) return "";
    return `
      <div class="camp-section-head camp-section-head--${kind}">
        <span class="camp-section-icon">${icon(kind === "event" ? "calendar" : kind === "grow" ? "sparkle" : "layers", { size: 18 })}</span>
        <div><h2>${title} <span class="camp-section-count">${count}</span></h2>${sub ? `<p>${sub}</p>` : ""}</div>
      </div>`;
  }
  function campSectionHTML(kind, title, sub, list) {
    return `
      <section class="camp-section">
        ${sectionHeadHTML(kind, title, sub, list.length)}
        <div class="brand-grid">${list.map((c) => campaignCard(brandId, c, content, brand)).join("")}</div>
      </section>`;
  }
  function growBrandSectionHTML(list, ins) {
    return `
      <section class="camp-section">
        ${sectionHeadHTML("grow", t("goal.launch.title"), t("camp.section.growSub"), list.length)}
        ${ins.length ? ins.map(insightBannerHTML).join("") : ""}
        <div class="brand-grid">${list.map((c) => campaignCard(brandId, c, content, brand)).join("")}</div>
      </section>
    `;
  }
  function insightBannerHTML(insight) {
    return `
      <div class="card glass-card cross-insight">
        <div class="cross-insight-head"><span class="page-eyebrow">${t("cross.title")}</span><span class="tag" style="font-size:10.5px;">${t(`cross.confidence.${insight.confidence}`)}</span></div>
        <p style="margin:4px 0 0;font-size:13px;">${escapeText(insight.text)}</p>
        <details class="cross-insight-advanced"><summary>${t("cross.advancedLabel")}</summary>
          <p class="text-faint" style="font-size:12px;margin:6px 0 4px;">${escapeText(insight.detail)}</p>
          ${insight.areas?.length ? `<ul class="text-faint" style="font-size:12px;margin:0;padding-left:16px;">${insight.areas.map((a) => `<li>${escapeText(a)}</li>`).join("")}</ul>` : ""}
        </details>
      </div>`;
  }

  wireHelpButtons(root);
  setPageGuide(() => startCampaignListGuide(brandId));

  qs("#new-campaign").addEventListener("click", () => openNewCampaignFlow({ brandId, onSaved: refresh }));
  qs("#empty-new-campaign")?.addEventListener("click", () => openNewCampaignFlow({ brandId, onSaved: refresh }));
  qsa("[data-open-campaign]", root).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-menu-toggle]") || e.target.closest(".menu") || e.target.closest("[data-delete-campaign]")) return;
      // An event opens on its plan (its "Target & checklist" is the next tab
      // there); every other campaign opens on itself.
      location.hash = card.dataset.openGoal ? `#/brand/${brandId}/goals/${card.dataset.openGoal}` : `#/brand/${brandId}/campaigns/${card.dataset.openCampaign}`;
    });
  });
  qsa("[data-open-plan]", root).forEach((card) => card.addEventListener("click", () => { location.hash = `#/brand/${brandId}/goals/${card.dataset.openPlan}`; }));
  wireClickableCards(root, "[data-open-campaign], [data-open-plan]", { role: "link" });
  qsa("[data-delete-campaign]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteCampaign;
      const linkedCount = content.filter((c) => c.campaignId === id).length;
      const ok = await confirmDialog({
        title: t("camp.list.deleteTitle"),
        message: `${linkedCount ? t("camp.list.deleteLinked", { count: linkedCount }) + " " : ""}${planIdeasNote(getCampaign(id))}${t("delete.toTrash.suffix", { days: TRASH_DAYS })}`,
        confirmLabel: t("delete.toTrash.confirm"),
        danger: true,
      });
      if (!ok) return;
      deleteCampaign(id);
      toast(t("camp.list.deleted"));
      refresh();
    });
  });
  qsa("[data-menu-toggle]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rect = btn.getBoundingClientRect();
      const menu = openMenu(btn, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 190) });
      if (!menu) return;
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}${t("common.delete")}</button>
      `;
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        closeMenu();
        const campaign = getCampaign(id);
        if (act === "edit") {
          editCampaign(brandId, campaign, refresh);
        } else if (act === "delete") {
          const linkedCount = content.filter((c) => c.campaignId === id).length;
          const ok = await confirmDialog({
            title: t("camp.list.deleteTitle"),
            message: `${linkedCount ? t("camp.list.deleteLinked", { count: linkedCount }) + " " : ""}${planIdeasNote(getCampaign(id))}${t("delete.toTrash.suffix", { days: TRASH_DAYS })}`,
            confirmLabel: t("delete.toTrash.confirm"),
            danger: true,
          });
          if (ok) {
            deleteCampaign(id);
            toast(t("camp.list.deleted"));
          }
        }
      });
    });
  });
}

function campaignCard(brandId, campaign, allContent, brand) {
  const ctx = { brand, campaign, content: allContent, settings: getSettings() };
  const stages = campaignStages(campaign);
  const idx = activeStageIndex(campaign, stages, allContent);
  const stage = stages[idx];
  const head = stage ? campaignHeadline(campaign, stages, idx, ctx) : null;
  const action = nextActions({ ...ctx, limit: 1 })[0];
  const where =
    stage?.kind === "level" ? `${t("camp.levelOf", { n: idx + 1, total: stages.length })} · ${escapeText(stage.name)}` : stage?.kind === "window" ? `${escapeText(stage.name)} · ${escapeText(stage.dateLabel)}` : stage ? t("camp.phaseNamed", { name: escapeText(stage.name) }) : "";
  const pct = head ? Math.round(head.reading.pct * 100) : 0;
  // Pemula: no objective/status tag row and no ⋯ menu (edit lives on the
  // detail page instead) — the name, where you are, the one number and the
  // next step are the card. Delete stays reachable right here too, though,
  // as its own trash icon — going into a campaign just to delete it was the
  // extra hop Pemula kept getting stuck on.
  const guided = getMode() === "guided";
  // Grow Brand track (social/community/sales) gets its own accent + badge
  // so the three widget kinds are tellable apart at a glance in the list —
  // see .campaign-card--track-* in css/campaign.css.
  const track = campaign.goalPlan?.version === 3 ? campaign.goalPlan.track : null;
  const kind = campaignKind(campaign, track);
  return `
    <div class="brand-card glass-card campaign-card campaign-card--kind-${kind.key} ${track ? `campaign-card--track-${track}` : ""}" data-open-campaign="${campaign.id}" ${kind.key === "event" && campaign.goalId && listGoals(brandId, { includeArchived: true }).some((g) => g.id === campaign.goalId) ? `data-open-goal="${campaign.goalId}"` : ""} style="cursor:pointer;">
      <div class="camp-kind">
        <span class="camp-kind-icon camp-kind-icon--${kind.key}">${kind.svg}</span>
        <span class="camp-kind-label">${escapeText(kind.label)}</span>
        ${kind.chip ? `<span class="camp-kind-chip ${kind.chipClass || ""}">${escapeText(kind.chip)}</span>` : ""}
      </div>
      ${
        guided
          ? `<button class="icon-btn card-menu" data-delete-campaign="${campaign.id}" aria-label="${t("common.delete")}" style="width:30px;height:30px;">${icon("trash", { size: 15 })}</button>`
          : `<button class="icon-btn card-menu" data-menu-toggle data-id="${campaign.id}" aria-label="${t("camp.list.actions")}" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button>
      <div class="flex items-center gap-8" style="margin-bottom:12px;">
        <span class="status-pill ${CAMPAIGN_STATUS_PILL_CLASS[campaign.status] || ""}"><span class="status-dot"></span>${CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}</span>
      </div>`
      }
      <h3>${escapeText(campaign.name || t("camp.untitled"))}</h3>
      <div class="meta" style="margin-bottom:10px;">${where}</div>
      ${
        head && head.reading.target && !head.reading.isCheck
          ? `<div class="campaign-card-headline"><b>${formatNumber(head.reading.current)}</b> / ${formatNumber(head.reading.target)} ${escapeText(head.reading.unit)} <span class="text-faint">· ${escapeText(head.milestone.label)}</span></div>
             <div class="cd-bar" style="margin:6px 0 10px;"><span style="width:${pct}%"></span></div>`
          : ""
      }
      ${action ? `<div class="campaign-card-next">${icon("arrowRight", { size: 12 })}<span>${escapeText(action.label)}</span></div>` : ""}
    </div>
  `;
}

// An event plan that hasn't been put on the calendar yet — same card shape
// as an event campaign, but it says plainly that nothing runs until it's
// installed, and opens the plan where the install button is.
function draftPlanCard(brandId, goal) {
  const date = goal.targetDate || "";
  const days = date ? daysBetween(localISODate(), date) : null;
  const chip = days === null ? "" : days > 1 ? t("camp.kind.daysLeft", { n: days }) : days === 1 ? t("camp.kind.tomorrow") : days === 0 ? t("camp.kind.today") : t("camp.kind.past");
  return `
    <div class="brand-card glass-card campaign-card campaign-card--kind-event" data-open-plan="${goal.id}" style="cursor:pointer;">
      <div class="camp-kind">
        <span class="camp-kind-icon camp-kind-icon--event">${icon("calendar", { size: 22 })}</span>
        <span class="camp-kind-label">${escapeText(date ? `${t("camp.kind.event")} · ${formatEventDate(date)}` : t("camp.kind.event"))}</span>
        ${chip ? `<span class="camp-kind-chip ${days !== null && days >= 0 && days <= 7 ? "is-soon" : ""}">${escapeText(chip)}</span>` : ""}
      </div>
      <div class="flex items-center gap-8" style="margin-bottom:12px;"><span class="status-pill status-draft"><span class="status-dot"></span>${t("camp.draftPlan.pill")}</span></div>
      <h3>${escapeText(goal.name || t("roadmap.defaultName"))}</h3>
      <div class="meta" style="margin-bottom:10px;">${t("camp.draftPlan.meta")}</div>
      <div class="campaign-card-next">${icon("arrowRight", { size: 12 })}<span>${t("camp.draftPlan.next")}</span></div>
    </div>`;
}

// What a card is, at a glance: a big tinted icon + a plain label. Social
// growth shows its platform's own logo, sales a banknote, community people,
// an event its calendar plus how many days are left.
function campaignKind(campaign, track) {
  if (track === "social") {
    const platform = campaign.goalPlan?.platform || "instagram";
    const name = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" }[platform] || platform;
    return { key: "social", svg: platformIcon(platform), label: `${t("goal.track.social")} · ${name}` };
  }
  if (track === "sales") return { key: "sales", svg: icon("money", { size: 22 }), label: t("goal.track.sales") };
  if (track === "community") return { key: "community", svg: icon("users", { size: 22 }), label: t("goal.track.community") };
  if (campaign.objective === "event" || campaign.eventPlan) {
    const date = campaign.eventPlan?.eventDate || campaign.endDate || "";
    const days = date ? daysBetween(localISODate(), date) : null;
    const chip = days === null ? "" : days > 1 ? t("camp.kind.daysLeft", { n: days }) : days === 1 ? t("camp.kind.tomorrow") : days === 0 ? t("camp.kind.today") : t("camp.kind.past");
    return { key: "event", svg: icon("calendar", { size: 22 }), label: date ? `${t("camp.kind.event")} · ${formatEventDate(date)}` : t("camp.kind.event"), chip, chipClass: days !== null && days >= 0 && days <= 7 ? "is-soon" : "" };
  }
  return { key: "other", svg: icon("target", { size: 22 }), label: CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || t("camp.kind.campaign") };
}

// ---------- New campaign intake (AI-first, manual fallback) ----------

// The 3 goals almost everyone actually starts with — pick one, name it,
// done. No goal essay, no AI call: the phase set is decided deterministically
// (reusing CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, the same map the
// detailed flow's objective picker uses) the instant the campaign is
// created. AI's job starts one step later — inside a phase, helping write
// content ideas that actually match this brand's voice — not drafting the
// campaign's own strategy copy nobody asked for.
const campaignQuickTemplates = () => [
  // Two templates only. "Grow Brand" is the Goal Plan (js/goal-plan.js):
  // growing social media, building a community and getting sales are the
  // same journey with a different main number, so they're one template whose
  // first question picks that number — and whose targets are computed from
  // the brand's own figures. The old fixed ladders (grow-social /
  // grow-personal ladders, removed from js/store.js) are no longer offered for new
  // campaigns; existing ones keep working unchanged.
  { id: "goal", label: t("camp.new.tpl.goal"), objective: "awareness", icon: "sparkle", description: t("camp.new.goalDesc"), recommended: t("camp.new.goalReco") },
  { id: "event", label: t("camp.new.tpl.event"), objective: "event", icon: "calendar", description: t("camp.new.eventDesc") },
];

function openNewCampaignFlow({ brandId, onSaved }) {
  const brand = getBrand(brandId);
  const templates = campaignQuickTemplates();
  // is shown as "Segera hadir" in every mode until it's ready — the flow
  // itself is kept, just not reachable from here.
  const overlay = openModal({
    title: t("camp.newCampaign"),
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("camp.new.intro")}</p>
      <div class="content-view-grid">
        ${templates.map((tpl) => `
          <button type="button" class="content-view-card${tpl.recommended ? " is-recommended" : ""}" data-quick-template="${tpl.id}">
            ${tpl.recommended ? `<span class="campaign-reco-badge">${icon("sparkle", { size: 12 })}${tpl.recommended}</span>` : ""}
            <div class="icon-wrap">${icon(tpl.icon, { size: 20 })}</div>
            <h3>${tpl.label}</h3>
            <p>${tpl.description}</p>
          </button>
        `).join("")}
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:12px 0 0;">${t("camp.new.termsNote")}</p>
    `,
  });

  qsa("[data-quick-template]", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      const template = templates.find((t) => t.id === btn.dataset.quickTemplate);
      closeOverlay(overlay);
      if (template.id === "goal") {
        openGoalWizard({ brandId, brand, onSaved });
        return;
      }
      // Event campaigns are created through the same Roadmap ke Tujuan
      // wizard the Goals section uses (js/views/goal-roadmap.js) — it's the
      // one intake that carries goalId + dates through to the
      // audience/community lanes, so both entry points share one flow.
      openEventGoalWizard({ brandId });
    });
  });
}

// ---------- Create/edit modal ----------

function phaseTemplateInfo(phaseId) {
  return CAMPAIGN_PHASE_TEMPLATE.find((tpl) => tpl.name.toLowerCase() === phaseId) || { description: "", optional: false };
}

function openCampaignModal({ brandId, campaign = null, objective = null, aiDraft = null, aiPrompt = null, initialEnabled = null, onSaved } = {}) {
  const draft = {
    name: campaign?.name ?? aiDraft?.name ?? "",
    objective: campaign?.objective ?? objective ?? "awareness",
    targetAudience: campaign?.targetAudience ?? aiDraft?.targetAudience ?? "",
    problemOrOpportunity: campaign?.problemOrOpportunity ?? aiDraft?.problemOrOpportunity ?? "",
    insight: campaign?.insight ?? aiDraft?.insight ?? "",
    bigIdea: campaign?.bigIdea ?? aiDraft?.bigIdea ?? "",
    keyMessage: campaign?.keyMessage ?? aiDraft?.keyMessage ?? "",
    offer: campaign?.offer ?? aiDraft?.offer ?? "",
    cta: campaign?.cta ?? aiDraft?.cta ?? "",
    channels: campaign?.channels ?? aiDraft?.channels ?? [],
    status: campaign?.status || "planning",
    startDate: campaign?.startDate || "",
    endDate: campaign?.endDate || "",
    phases:
      campaign?.phases ||
      CAMPAIGN_PHASE_TEMPLATE.map((tpl) => {
        const aiGoal = aiDraft?.phases?.find((p) => p.name.toLowerCase() === tpl.name.toLowerCase())?.goal || "";
        const enabled = !tpl.optional || !!initialEnabled?.[tpl.name];
        return { id: tpl.name.toLowerCase(), name: tpl.name, goal: aiGoal, enabled, milestones: [] };
      }),
  };

  const overlay = openModal({
    title: campaign ? t("camp.edit.title") : t("camp.newCampaign"),
    bodyHTML: `
      ${aiDraft ? `<div class="hint" style="margin:0 0 16px;">${icon("bot", { size: 12 })} ${t("camp.edit.aiHint")}</div><div id="ai-draft-feedback" style="margin:-8px 0 12px;"></div>` : ""}
      <div class="field">
        <label for="c-name">${t("camp.edit.name")}</label>
        <input class="input" id="c-name" placeholder="${escapeAttr(t("camp.edit.namePh"))}" value="${escapeAttr(draft.name)}" />
      </div>
      <div class="row-2">
        <div class="field">
          <label for="c-objective">${t("camp.custom.objective")}</label>
          <select class="select" id="c-objective">
            ${CAMPAIGN_OBJECTIVES.map((o) => `<option value="${o}" ${draft.objective === o ? "selected" : ""}>${CAMPAIGN_OBJECTIVE_LABELS[o]}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="c-status">${t("camp.edit.status")}</label>
          <select class="select" id="c-status">
            ${CAMPAIGN_STATUSES.map((s) => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${CAMPAIGN_STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="c-audience">${t("camp.edit.audience")} <span class="text-faint" style="font-weight:400;">${t("camp.edit.audienceHint")}</span></label>
        <textarea class="textarea" id="c-audience" style="min-height:60px;">${escapeText(draft.targetAudience)}</textarea>
      </div>
      <div class="field">
        <label for="c-problem">${t("camp.edit.problem")}</label>
        <textarea class="textarea" id="c-problem" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.problemPh"))}">${escapeText(draft.problemOrOpportunity)}</textarea>
      </div>
      <div class="field">
        <label for="c-insight">${t("camp.edit.insight")}</label>
        <textarea class="textarea" id="c-insight" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.insightPh"))}">${escapeText(draft.insight)}</textarea>
      </div>
      <div class="field">
        <label for="c-bigidea">${t("camp.edit.bigIdea")}</label>
        <textarea class="textarea" id="c-bigidea" style="min-height:60px;">${escapeText(draft.bigIdea)}</textarea>
      </div>
      <div class="field">
        <label for="c-message">${t("camp.edit.keyMessage")}</label>
        <textarea class="textarea" id="c-message" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.keyMessagePh"))}">${escapeText(draft.keyMessage)}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label for="c-offer">${t("camp.edit.offer")}</label>
          <input class="input" id="c-offer" value="${escapeAttr(draft.offer)}" />
        </div>
        <div class="field">
          <label for="c-cta">${t("camp.edit.cta")}</label>
          <input class="input" id="c-cta" placeholder="${escapeAttr(t("camp.edit.ctaPh"))}" value="${escapeAttr(draft.cta)}" />
          <div class="hint" style="margin-top:4px;">${icon("info", { size: 12 })}<span>${t("camp.edit.ctaHint")}</span></div>
        </div>
      </div>
      <div class="field">
        <label for="c-channels">${t("camp.edit.channels")}</label>
        <textarea class="textarea" id="c-channels" style="min-height:60px;" placeholder="${t("camp.edit.channelsPh")}">${escapeText(listToLines(draft.channels))}</textarea>
      </div>
      <div class="row-2">
        <div class="field" style="margin-bottom:0;">
          <label for="c-start">${t("camp.edit.startDate")}</label>
          <input class="input" type="date" id="c-start" value="${escapeAttr(draft.startDate)}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="c-end">${t("camp.edit.endDate")}</label>
          <input class="input" type="date" id="c-end" value="${escapeAttr(draft.endDate)}" />
        </div>
      </div>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("camp.edit.journey")}</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("camp.edit.journeySub")}</p>
      ${draft.phases
        .map((p, i) => {
          const info = phaseTemplateInfo(p.id);
          return `
        <div class="field">
          <div class="creator-field-head">
            <label style="margin-bottom:0;">${t("camp.edit.phaseN", { n: i + 1 })} <input class="input" id="phase-name-${i}" style="display:inline;width:auto;padding:4px 8px;font-size:13px;" value="${escapeAttr(phaseNameLabel(p.name))}" /></label>
            ${
              info.optional
                ? `<label class="checkbox-chip" style="padding:4px 10px;font-size:11px;"><input type="checkbox" id="phase-enabled-${i}" ${p.enabled ? "checked" : ""} />${t("camp.edit.includePhase")}</label>`
                : `<span class="text-faint" style="font-size:11px;">${t("camp.edit.alwaysIncluded")}</span>`
            }
          </div>
          <div class="text-faint" style="font-size:11.5px;margin-bottom:6px;">${escapeText(info.description)}</div>
          <textarea class="textarea" id="phase-goal-${i}" style="min-height:50px;" placeholder="${escapeAttr(t("camp.edit.phaseGoalPh"))}">${escapeText(p.goal)}</textarea>
        </div>`;
        })
        .join("")}
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
      <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}${t("common.save")}</button>
    `,
    onMount: (el) => {
      setTimeout(() => el.querySelector("#c-name").focus(), 30);
    },
  });
  if (aiDraft && !aiDraft.demo) mountAiFeedback(qs("#ai-draft-feedback", overlay), { brandId, feature: "campaign-plan", prompt: aiPrompt || {}, output: aiDraft });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-save]").addEventListener("click", () => {
    const nameInput = overlay.querySelector("#c-name");
    const name = nameInput.value.trim();
    if (!name) {
      toast(t("camp.edit.nameRequired"), "error");
      nameInput.focus();
      return;
    }
    const patch = {
      name,
      objective: overlay.querySelector("#c-objective").value,
      status: overlay.querySelector("#c-status").value,
      targetAudience: overlay.querySelector("#c-audience").value.trim(),
      problemOrOpportunity: overlay.querySelector("#c-problem").value.trim(),
      insight: overlay.querySelector("#c-insight").value.trim(),
      bigIdea: overlay.querySelector("#c-bigidea").value.trim(),
      keyMessage: overlay.querySelector("#c-message").value.trim(),
      offer: overlay.querySelector("#c-offer").value.trim(),
      cta: overlay.querySelector("#c-cta").value.trim(),
      channels: linesToList(overlay.querySelector("#c-channels").value),
      startDate: overlay.querySelector("#c-start").value,
      endDate: overlay.querySelector("#c-end").value,
      phases: draft.phases.map((p, i) => {
        const info = phaseTemplateInfo(p.id);
        const enabledInput = overlay.querySelector(`#phase-enabled-${i}`);
        return {
          id: p.id,
          name: ((v) => (!v || v === phaseNameLabel(p.name) ? p.name : v))(overlay.querySelector(`#phase-name-${i}`).value.trim()),
          goal: overlay.querySelector(`#phase-goal-${i}`).value.trim(),
          enabled: info.optional ? !!enabledInput?.checked : true,
          milestones: p.milestones || [],
        };
      }),
    };
    if (campaign) {
      updateCampaign(campaign.id, patch);
      toast(t("camp.edit.updated"));
    } else {
      createCampaign(brandId, patch);
      toast(t("camp.edit.created", { name }));
    }
    closeOverlay(overlay);
    onSaved?.();
  });
}

// ---------- Detail view — interactive journey ----------
