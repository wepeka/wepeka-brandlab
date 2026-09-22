import { backLinkHTML } from "../back-link.js";
import {
  getBrand, listContent, createContent, onChange, getSettings, getBrandInsights,
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_PHASE_TEMPLATE,
  MISSION_LADDERS, createMissionsForTemplate,
  EVENT_ROLES, EVENT_PARTICIPATION_TYPES, EVENT_OBJECTIVES, EVENT_OBJECTIVE_LABELS, EVENT_SCALE_TIERS,
  phaseNameLabel, missionText,
  eventPhaseTemplatesForRole, buildEventPhases, eventScaleFor, nominalEventRunway, daysBetween, formatEventDate, localISODate,
} from "../store.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog, promptDialog } from "../modals.js";
import { toast, formatNumber, linesToList, listToLines, qs, qsa, openMenu, closeMenu, escapeHtml as escapeText, escapeHtml as escapeAttr } from "../dom.js";
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

// Reuses the existing status-pill color classes (defined for Content's own
// idea/draft/production/editing/scheduled/published/archived vocabulary)
// instead of adding new CSS for a second status vocabulary — the color
// association (grey/blue/gold/green) still reads sensibly for a campaign's
// own planning → active → completed → archived lifecycle.
const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

export function render(root, { brandId, campaignId }) {
  const state = { stageIndex: null, celebrateIndex: null, advancing: false };
  const refresh = () => paint(root, brandId, campaignId, state, refresh);
  refresh();
  // Once per mount (list and detail are separate routes/mounts) — paint()
  // runs again on every db:change.
  if (campaignId) startCampaignDetailGuideOnMount(brandId, campaignId);
  else startCampaignListGuideOnMount(brandId);
  return onChange(refresh);
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
    paintDetail(root, brandId, brand, campaign, state, refresh, { openEdit: () => openCampaignModal({ brandId, campaign, onSaved: refresh }) });
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
  const rest = campaigns.filter((c) => !growBrand.includes(c));
  const insights = growBrand.length ? crossCampaignInsights({ campaigns, content, brand, settings: getSettings() }) : [];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}`, t("nav.home"))} · ${t("camp.list.eyebrow")}${helpButtonHTML("campaigns")}${guideVideoButtonHTML("campaigns")}</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8" style="flex-wrap:wrap;">
        <a class="btn btn-secondary" href="#/brand/${brandId}/sales" id="open-sales">${icon("chart", { size: 16 })}${t("camp.list.salesTracker")}</a>
        <a class="btn btn-secondary" href="#/brand/${brandId}/goals" id="open-goals">${icon("target", { size: 16 })}${t("roadmap.camp.open")}</a>
        <button class="btn btn-primary" id="new-campaign">${icon("plus", { size: 16 })}${t("camp.newCampaign")}</button>
      </div>
    </div>
    <p class="page-sub" style="margin-bottom:24px;">${
      getMode() === "guided"
        ? t("camp.list.subGuided")
        : t("camp.list.subPro")
    }</p>
    ${growBrand.length ? growBrandSectionHTML(growBrand, insights) : ""}
    ${
      rest.length
        ? `<div class="brand-grid">${rest.map((c) => campaignCard(brandId, c, content, brand)).join("")}</div>`
        : !campaigns.length
        ? `<div class="content-view-card glass-card" style="max-width:420px;cursor:default;">
             <div class="icon-wrap">${icon("target", { size: 22 })}</div>
             <h3>${t("camp.list.emptyTitle")}</h3>
             <p>${
               getMode() === "guided"
                 ? t("camp.list.emptyGuided")
                 : t("camp.list.emptyPro")
             }</p>
           </div>`
        : ""
    }
  `;

  function growBrandSectionHTML(list, ins) {
    return `
      <div class="section-title" style="margin-bottom:10px;"><h2>${t("goal.launch.title")}</h2></div>
      ${ins.length ? ins.map(insightBannerHTML).join("") : ""}
      <div class="brand-grid" style="margin-bottom:24px;">${list.map((c) => campaignCard(brandId, c, content, brand)).join("")}</div>
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
  qsa("[data-open-campaign]", root).forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-menu-toggle]") || e.target.closest(".menu")) return;
      location.hash = `#/brand/${brandId}/campaigns/${card.dataset.openCampaign}`;
    });
  });
  qsa("[data-delete-campaign]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteCampaign;
      const linkedCount = content.filter((c) => c.campaignId === id).length;
      const ok = await confirmDialog({
        title: t("camp.list.deleteTitle"),
        message: linkedCount ? `${t("camp.list.deleteLinked", { count: linkedCount })} ${t("common.noUndo")}` : t("common.noUndo"),
        confirmLabel: t("common.delete"),
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
          openCampaignModal({ brandId, campaign, onSaved: refresh });
        } else if (act === "delete") {
          const linkedCount = content.filter((c) => c.campaignId === id).length;
          const ok = await confirmDialog({
            title: t("camp.list.deleteTitle"),
            message: linkedCount
              ? `${t("camp.list.deleteLinked", { count: linkedCount })} ${t("common.noUndo")}`
              : t("common.noUndo"),
            confirmLabel: t("common.delete"),
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
  return `
    <div class="brand-card glass-card campaign-card ${track ? `campaign-card--track-${track}` : ""}" data-open-campaign="${campaign.id}" style="cursor:pointer;">
      ${
        guided
          ? `<button class="icon-btn card-menu" data-delete-campaign="${campaign.id}" aria-label="${t("common.delete")}" style="width:30px;height:30px;">${icon("trash", { size: 15 })}</button>`
          : `<button class="icon-btn card-menu" data-menu-toggle data-id="${campaign.id}" aria-label="${t("camp.list.actions")}" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button>
      <div class="flex items-center gap-8" style="margin-bottom:12px;">
        ${track ? `<span class="campaign-track-badge campaign-track-badge--${track}">${icon(TRACK_ICON[track], { size: 12 })}${t(`goal.track.${track}`)}</span>` : `<span class="tag">${CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || campaign.objective}</span>`}
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

// ---------- New campaign intake (AI-first, manual fallback) ----------

// The 3 optional phases (Website/Event/Community) depend on infrastructure
// not every brand has — asked fresh for every campaign (not remembered on
// the brand) since a brand's situation can change between campaigns.
const OPTIONAL_PHASE_QUESTIONS = [
  { key: "website", phaseName: "Website", question: t("camp.new.optWebsite") },
  { key: "event", phaseName: "Event", question: t("camp.new.optEvent") },
  { key: "community", phaseName: "Community", question: t("camp.new.optCommunity") },
];

// The 3 goals almost everyone actually starts with — pick one, name it,
// done. No goal essay, no AI call: the phase set is decided deterministically
// (reusing CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES, the same map the
// detailed flow's objective picker uses) the instant the campaign is
// created. AI's job starts one step later — inside a phase, helping write
// content ideas that actually match this brand's voice — not drafting the
// campaign's own strategy copy nobody asked for.
const CAMPAIGN_QUICK_TEMPLATES = [
  // Two templates only. "Grow Brand" is the Goal Plan (js/goal-plan.js):
  // growing social media, building a community and getting sales are the
  // same journey with a different main number, so they're one template whose
  // first question picks that number — and whose targets are computed from
  // the brand's own figures. The old fixed ladders (grow-social /
  // grow-personal in MISSION_LADDERS) are no longer offered for new
  // campaigns; existing ones keep working unchanged.
  { id: "goal", label: t("camp.new.tpl.goal"), objective: "awareness", icon: "sparkle", description: t("camp.new.goalDesc"), recommended: t("camp.new.goalReco") },
  { id: "event", label: t("camp.new.tpl.event"), objective: "event", icon: "calendar", description: t("camp.new.eventDesc") },
];

function openNewCampaignFlow({ brandId, onSaved }) {
  const brand = getBrand(brandId);
  // is shown as "Segera hadir" in every mode until it's ready — the flow
  // itself is kept, just not reachable from here.
  const overlay = openModal({
    title: t("camp.newCampaign"),
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("camp.new.intro")}</p>
      <div class="content-view-grid">
        ${CAMPAIGN_QUICK_TEMPLATES.map((tpl) => `
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
      const template = CAMPAIGN_QUICK_TEMPLATES.find((t) => t.id === btn.dataset.quickTemplate);
      closeOverlay(overlay);
      if (template.id === "goal") {
        openGoalWizard({ brandId, brand, onSaved });
        return;
      }
      // Event doesn't fit the Mission ladder contract at all (role-branching
      // setup, date-anchored non-blocking phases, dynamic targets) — it's a
      // separate intake entirely, only sharing the Terms gate mechanism.
      if (template.id === "event") {
        openEventSetupWizard({ brandId, brand, template, onSaved });
        return;
      }
      const ladder = MISSION_LADDERS[template.id];
      // 5.1: Pemula gets a one-click campaign from the template card —
      // the "have you covered this ground?" calibration question and the
      // name prompt (finishQuickCampaign already has a sensible default
      // name ready) are both skipped, straight to Mission 1. Terms still
      // gate Grow Personal Branding in every mode — that's a real
      // agreement to read, not a setup question. Pro is unchanged.
      const toCalibration = () => {
        if (getMode() === "guided") {
          finishQuickCampaign({ brandId, brand, template, onSaved });
        } else if (ladder?.calibration) {
          openMissionCalibration({
            template,
            ladder,
            onContinue: ({ startIndex }) => finishQuickCampaign({ brandId, brand, template, startIndex, onSaved }),
          });
        } else {
          finishQuickCampaign({ brandId, brand, template, onSaved });
        }
      };
      toCalibration();
    });
  });
}

// One quick question before a Quick Template creates its campaign: has
// this ground already been covered? "Belum" skips straight to Mission 1
// (the default, still the recommended path even for "Sudah" — see
// skipNote). "Sudah" reveals the mission list itself as the picker, so
// someone genuinely further along doesn't have to re-clear early rungs —
// but nothing here scales targets; the ladder is one fixed staircase.
function openMissionCalibration({ template, ladder, onContinue }) {
  const { calibration } = ladder;
  const missionPreviews = ladder.missions();
  const overlay = openModal({
    title: template.label,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${escapeText(calibration.question)}</p>
      <div class="flex gap-8" id="calib-step1" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" id="calib-fresh">${t("camp.new.calibFresh")}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="calib-pick-open">${t("camp.new.calibPick")}</button>
      </div>
      <div id="calib-step2" style="display:none;margin-top:18px;">
        <div class="hint" style="margin-bottom:12px;">${icon("info", { size: 12 })}<span>${escapeText(calibration.skipNote)}</span></div>
        <div class="chip-select" id="calib-mission-pick" style="flex-wrap:wrap;">
          ${missionPreviews.map((m, i) => `<button type="button" data-val="${i}">${escapeText(missionText(m).name)}</button>`).join("")}
        </div>
      </div>
    `,
    footHTML: `<button class="btn btn-primary" id="calib-continue" style="display:none;" disabled>${t("camp.next")}</button>`,
  });

  let startIndex = 0;
  qs("#calib-fresh", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    onContinue({ startIndex: 0 });
  });
  qs("#calib-pick-open", overlay).addEventListener("click", () => {
    qs("#calib-step1", overlay).style.display = "none";
    qs("#calib-step2", overlay).style.display = "block";
    qs("#calib-continue", overlay).style.display = "inline-flex";
  });
  qsa("#calib-mission-pick button", overlay).forEach((b) => {
    b.addEventListener("click", () => {
      startIndex = Number(b.dataset.val);
      qsa("#calib-mission-pick button", overlay).forEach((x) => x.classList.toggle("active", x === b));
      qs("#calib-continue", overlay).disabled = false;
    });
  });
  qs("#calib-continue", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    onContinue({ startIndex });
  });
}

// Pemula gets a ready-made name so the prompt is "press Enter", not a
// question to think about. (The prompt itself stays — the campaign tour
// waits on it — it's just pre-filled.)
const GUIDED_DEFAULT_NAMES = { "grow-social": t("camp.new.defaultNameSocial"), "grow-personal": t("camp.new.defaultNamePersonal"), event: t("camp.new.defaultNameEvent") };

async function finishQuickCampaign({ brandId, brand, template, startIndex, onSaved }) {
  const guided = getMode() === "guided";
  const defaultName = `${GUIDED_DEFAULT_NAMES[template.id] || template.label} ${brand?.name || ""}`.trim();
  // 5.1: Pemula never sees this dialog at all — the default name (already
  // good enough that Pro's version of this same dialog pre-fills it too)
  // is used as-is, one less decision between "pick a template" and "have
  // a campaign". Pro keeps naming it themselves.
  const name = guided
    ? defaultName
    : await promptDialog({
        title: template.label,
        label: t("camp.new.nameLabel"),
        placeholder: template.label,
        value: "",
        confirmLabel: t("camp.createCampaign"),
      });
  if (!name) return;
  const optionalDefaults = CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES[template.objective] || [];
  const phases = CAMPAIGN_PHASE_TEMPLATE.map((tpl) => ({
    id: tpl.name.toLowerCase(), name: tpl.name, goal: "", milestones: [],
    enabled: !tpl.optional || optionalDefaults.includes(tpl.name),
  }));
  const ladder = MISSION_LADDERS[template.id];
  // "Atur Jadwal Kerja" (cadence-setup.js) already asked how often this
  // brand uploads — reuse it so the ladder's content targets match the
  // pace the owner actually committed to, instead of one fixed number.
  const cad = brand?.contentCadence;
  const uploadsPerWeek = cad?.configured && cad.uploadDays?.length ? cad.uploadDays.length * (Number(cad.perDay) || 1) : null;
  // #7: the starting mission's Followers target is rebased to whatever the
  // brand already has tracked — reaching "1000 followers" at Tahap 1 no
  // longer means starting a fresh countdown from 0 for someone who already
  // has 1000+; they still start at Tahap 1, just with a target that reflects
  // where they actually stand.
  const currentFollowers = getBrandInsights(brand, "instagram")?.followers ?? null;
  const missions = createMissionsForTemplate(template.id, { startIndex, uploadsPerWeek, currentFollowers });
  const created = createCampaign(brandId, {
    name, objective: template.objective, status: "planning",
    targetAudience: brand?.brandDNA?.targetAudience || "",
    phases,
    ...(missions ? { missions } : {}),
    ...(ladder?.autoLinkAllContent ? { autoLinkAllContent: true } : {}),
    ...(ladder?.progressionNote ? { missionProgressionNote: ladder.progressionNote } : {}),
  });
  toast(missions ? t("camp.new.createdLadder", { name }) : t("camp.new.createdPhases", { name }));
  onSaved?.();
  location.hash = `#/brand/${brandId}/campaigns/${created.id}`;
}

// ---------- Event Campaign intake (role → setup → generate) ----------
// The one question that decides everything downstream — which setup form
// shows next, and which whole milestone catalog the campaign gets.
// Event setup: three short steps instead of one 13-field form. Only what
// the system actually uses is asked — role (which phase set), name + event
// date (timeline), campaign start (runway), scale tier (target multiplier)
// and objectives (context for AI). Everything the old form also collected
// (budget, booth size, promotion platform, previous performance, social
// audience…) was stored in eventPlan.setup and never read by anything.
const EVENT_SCALE_HINTS = { small: t("camp.event.hintSmall"), medium: t("camp.event.hintMedium"), large: t("camp.event.hintLarge"), major: t("camp.event.hintMajor") };

function openEventSetupWizard({ brandId, brand, template, onSaved }) {
  const today = localISODate();
  const state = {
    step: 1,
    role: "",
    participationType: EVENT_PARTICIPATION_TYPES[0].id,
    eventName: "",
    eventDate: "",
    campaignStartDate: today,
    eventLocation: "",
    scale: "medium",
    // Optional real head-count — when given, targets scale from it
    // continuously instead of from the four-tier guess (see buildEventPhases).
    expectedAudience: null,
    objectives: new Set(),
    error: "",
  };
  const overlay = openModal({ title: template.label, wide: true, bodyHTML: `<div class="ev-wizard"></div>` });
  const root = qs(".ev-wizard", overlay);

  const progress = () => `
    <div class="copy-steps">
      ${[1, 2, 3].map((n) => `<span class="copy-step-dot ${n === state.step ? "is-current" : n < state.step ? "is-done" : ""}"></span>`).join("")}
      <span class="copy-step-label">${t("camp.event.step", { n: state.step })}</span>
      ${state.step > 1 ? `<button type="button" class="btn btn-ghost btn-sm copy-back" data-ev-back>${icon("chevronLeft", { size: 13 })}${t("common.back")}</button>` : ""}
    </div>`;

  const templatesFor = () => eventPhaseTemplatesForRole(state.role, state.participationType);

  // Step 2's live line under the dates: is there enough runway for the
  // role's phases, or will they be compressed (buildEventPhases handles
  // the compression; this only tells the user before they commit).
  function runwayHint() {
    if (!state.eventDate) return { cls: "", text: t("camp.event.runwayNoDate") };
    if (state.eventDate < today) return { cls: "is-bad", text: t("camp.event.runwayPast") };
    const days = Math.max(0, daysBetween(state.campaignStartDate || today, state.eventDate));
    const nominal = nominalEventRunway(templatesFor());
    if (days === 0) return { cls: "is-warn", text: t("camp.event.runwayToday") };
    if (days < nominal) return { cls: "is-warn", text: t("camp.event.runwayTight", { days }) };
    return { cls: "is-ok", text: t("camp.event.runwayOk", { days }) };
  }

  function step1HTML() {
    return `
      ${progress()}
      <h3 class="copy-q">${t("camp.event.roleQ")}</h3>
      <div class="content-view-grid ev-roles">
        ${EVENT_ROLES.map(
          (r) => `
          <button type="button" class="content-view-card ${state.role === r.id ? "is-selected" : ""}" data-role="${r.id}">
            <h3>${escapeText(r.label)}</h3>
            <p>${escapeText(r.description)}</p>
          </button>`
        ).join("")}
      </div>
      ${
        state.role === "participant"
          ? `<div class="field" style="margin-top:16px;">
               <label for="ef-participationType">${t("camp.event.participationQ")}</label>
               <select class="select" id="ef-participationType">
                 ${EVENT_PARTICIPATION_TYPES.map((pt) => `<option value="${pt.id}" ${state.participationType === pt.id ? "selected" : ""}>${escapeText(pt.label)}</option>`).join("")}
               </select>
             </div>
             <button type="button" class="btn btn-primary btn-block" data-ev-next>${t("camp.next")}${icon("arrowRight", { size: 14 })}</button>`
          : ""
      }
    `;
  }

  function step2HTML() {
    const hint = runwayHint();
    return `
      ${progress()}
      <h3 class="copy-q">${t("camp.event.whatQ")}</h3>
      <div class="field">
        <label for="ef-eventName">${t("camp.event.name")} <span class="copy-required">*</span></label>
        <input class="input" id="ef-eventName" maxlength="120" value="${escapeAttr(state.eventName)}" placeholder="${escapeAttr(t("camp.event.namePh"))}" />
      </div>
      <div class="ev-row">
        <div class="field">
          <label for="ef-eventDate">${t("camp.event.date")} <span class="copy-required">*</span></label>
          <input class="input" id="ef-eventDate" type="date" min="${today}" value="${escapeAttr(state.eventDate)}" />
        </div>
        <div class="field">
          <label for="ef-campaignStartDate">${t("camp.event.promoStart")}</label>
          <input class="input" id="ef-campaignStartDate" type="date" min="${today}" value="${escapeAttr(state.campaignStartDate)}" ${state.eventDate ? `max="${escapeAttr(state.eventDate)}"` : ""} />
        </div>
      </div>
      <p class="ev-runway ${hint.cls}" id="ef-runway">${icon(hint.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${escapeText(hint.text)}</span></p>
      <div class="field">
        <label for="ef-eventLocation">${t("camp.event.location")} <span class="copy-optional">${t("camp.optional")}</span></label>
        <input class="input" id="ef-eventLocation" maxlength="120" value="${escapeAttr(state.eventLocation)}" placeholder="${escapeAttr(t("camp.event.locationPh"))}" />
      </div>
      ${state.error ? `<p class="ev-error">${escapeText(state.error)}</p>` : ""}
      <button type="button" class="btn btn-primary btn-block" data-ev-next>${t("camp.next")}${icon("arrowRight", { size: 14 })}</button>
    `;
  }

  function step3HTML() {
    const objectives = EVENT_OBJECTIVES[state.role] || [];
    const preview = buildEventPhases(templatesFor(), { eventDate: state.eventDate, campaignStartDate: state.campaignStartDate, scaleId: state.scale, expectedAudience: state.expectedAudience });
    const merged = preview.filter((p) => p.mergedFrom?.length);
    return `
      ${progress()}
      <h3 class="copy-q">${t("camp.event.sizeQ")}</h3>
      <div class="field">
        <label>${t("camp.event.audience")}</label>
        <div class="ev-tier-grid">
          ${EVENT_SCALE_TIERS.map(
            (tier) => `
            <button type="button" class="ev-tier ${state.scale === tier.id ? "is-selected" : ""}" data-ev-scale="${tier.id}">
              <strong>${escapeText(tier.range)}</strong>
              <span>${escapeText(EVENT_SCALE_HINTS[tier.id] || tier.label)}</span>
            </button>`
          ).join("")}
        </div>
        <p class="ev-field-hint">${t(getMode() === "guided" ? "camp.event.audienceHintGuided" : "camp.event.audienceHint")}</p>
      </div>
      <div class="field">
        <label for="ef-expected">${t("camp.event.expected")} <span class="copy-optional">${t("camp.optional")}</span></label>
        <input class="input" id="ef-expected" type="number" min="1" inputmode="numeric" value="${state.expectedAudience ?? ""}" placeholder="${escapeAttr(t("camp.event.expectedPh"))}" style="max-width:220px;" />
        <p class="ev-field-hint">${t("camp.event.expectedHint")}</p>
      </div>
      ${
        objectives.length
          ? `<div class="field">
               <label>${t("camp.event.goals")} <span class="copy-optional">${t("camp.event.goalsHint")}</span></label>
               <div class="chip-select" id="ef-objectives">
                 ${objectives.map((o) => `<button type="button" data-ev-objective="${escapeAttr(o)}" class="${state.objectives.has(o) ? "active" : ""}">${escapeText(EVENT_OBJECTIVE_LABELS[o] || o)}</button>`).join("")}
               </div>
             </div>`
          : ""
      }
      <div class="ev-summary">
        <div class="ev-summary-title">${icon("calendar", { size: 13 })}${t("camp.event.timeline")}</div>
        <div class="ev-summary-phases">
          ${preview.map((p) => `<span class="ev-summary-phase"><b>${escapeText(phaseNameLabel(p.name))}</b> ${escapeText(p.dateLabel)}</span>`).join("")}
        </div>
        ${merged.length ? `<p class="ev-field-hint">${escapeText(t("camp.event.mergedReason", { list: merged.map((p) => t("camp.event.mergedInto", { from: p.mergedFrom.map(phaseNameLabel).join(" + "), to: phaseNameLabel(p.name) })).join("; ") }))}</p>` : ""}
      </div>
      <button type="button" class="btn btn-primary btn-block" id="ef-submit">${icon("check", { size: 14 })}${t("camp.createCampaign")}</button>
    `;
  }

  function paint() {
    root.innerHTML = state.step === 1 ? step1HTML() : state.step === 2 ? step2HTML() : step3HTML();
    wire();
  }

  function readStep2() {
    state.eventName = qs("#ef-eventName", root)?.value.trim() ?? state.eventName;
    state.eventDate = qs("#ef-eventDate", root)?.value ?? state.eventDate;
    state.campaignStartDate = qs("#ef-campaignStartDate", root)?.value || today;
    state.eventLocation = qs("#ef-eventLocation", root)?.value.trim() ?? state.eventLocation;
    if (state.eventDate && state.campaignStartDate > state.eventDate) state.campaignStartDate = state.eventDate;
  }

  function validateStep2() {
    if (state.eventName.length < 2) return t("camp.event.errName");
    if (!state.eventDate) return t("camp.event.errDate");
    if (state.eventDate < today) return t("camp.event.errPast");
    return "";
  }

  function wire() {
    qs("[data-ev-back]", root)?.addEventListener("click", () => {
      // Step 3 has no inputs for step 2's values, so only read them back
      // when leaving step 2 itself.
      if (state.step === 2) readStep2();
      state.step = Math.max(1, state.step - 1);
      state.error = "";
      paint();
    });
    qsa("[data-role]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        state.role = btn.dataset.role;
        if (state.role === "participant") {
          paint();
          qs("#ef-participationType", root)?.focus();
        } else {
          state.step = 2;
          paint();
          qs("#ef-eventName", root)?.focus();
        }
      })
    );
    qs("#ef-participationType", root)?.addEventListener("change", (e) => {
      state.participationType = e.target.value;
    });
    qs("[data-ev-next]", root)?.addEventListener("click", () => {
      if (state.step === 1) {
        state.step = 2;
        paint();
        qs("#ef-eventName", root)?.focus();
        return;
      }
      readStep2();
      state.error = validateStep2();
      if (state.error) {
        paint();
        return;
      }
      state.step = 3;
      paint();
    });
    // Typing must not repaint (it would drop focus); only the runway line
    // and the start-date max update in place.
    ["#ef-eventDate", "#ef-campaignStartDate"].forEach((sel) =>
      qs(sel, root)?.addEventListener("input", () => {
        readStep2();
        const startEl = qs("#ef-campaignStartDate", root);
        if (startEl) {
          if (state.eventDate) startEl.max = state.eventDate;
          if (startEl.value !== state.campaignStartDate) startEl.value = state.campaignStartDate;
        }
        const hint = runwayHint();
        const el = qs("#ef-runway", root);
        if (el) {
          el.className = `ev-runway ${hint.cls}`;
          el.innerHTML = `${icon(hint.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${escapeText(hint.text)}</span>`;
        }
      })
    );
    qsa("[data-ev-scale]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        state.scale = btn.dataset.evScale;
        // Picking a tier by hand means the typed number no longer applies.
        state.expectedAudience = null;
        paint();
      })
    );
    qs("#ef-expected", root)?.addEventListener("change", (e) => {
      const n = Math.round(Number(e.target.value) || 0);
      state.expectedAudience = n > 0 ? n : null;
      if (state.expectedAudience) state.scale = eventScaleFor(state.expectedAudience).id;
      paint();
    });
    qsa("[data-ev-objective]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const o = btn.dataset.evObjective;
        if (state.objectives.has(o)) state.objectives.delete(o);
        else state.objectives.add(o);
        btn.classList.toggle("active", state.objectives.has(o));
      })
    );
    qs("#ef-submit", root)?.addEventListener("click", () => {
      closeOverlay(overlay);
      finishEventCampaign({
        brandId, brand, template,
        role: state.role,
        participationType: state.role === "participant" ? state.participationType : "",
        eventName: state.eventName,
        eventDate: state.eventDate,
        campaignStartDate: state.campaignStartDate,
        eventLocation: state.eventLocation,
        scaleId: state.scale,
        expectedAudience: state.expectedAudience,
        objectives: [...state.objectives],
        onSaved,
      });
    });
  }
  paint();
}

async function finishEventCampaign({ brandId, brand, template, role, participationType, eventName, eventDate, campaignStartDate, eventLocation, scaleId, expectedAudience = null, objectives, onSaved }) {
  const scale = EVENT_SCALE_TIERS.find((tier) => tier.id === scaleId) || EVENT_SCALE_TIERS[1];
  const phaseTemplates = eventPhaseTemplatesForRole(role, participationType);
  const phases = buildEventPhases(phaseTemplates, { eventDate, campaignStartDate, scaleId: scale.id, expectedAudience });

  const optionalDefaults = CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES[template.objective] || [];
  const legacyPhases = CAMPAIGN_PHASE_TEMPLATE.map((t) => ({
    id: t.name.toLowerCase(), name: t.name, goal: "", milestones: [],
    enabled: !t.optional || optionalDefaults.includes(t.name),
  }));

  const created = createCampaign(brandId, {
    name: eventName || template.label, objective: template.objective, status: "planning",
    targetAudience: brand?.brandDNA?.targetAudience || "",
    startDate: campaignStartDate, endDate: eventDate,
    phases: legacyPhases,
    // Unlike Social Growth (where every post on the platform genuinely
    // counts toward follower growth), an event's milestones should only
    // reflect content actually made FOR this event — brainstormed/created
    // through it, or linked to it by hand. autoLinkAllContent:true here
    // was sweeping in the brand's entire content list (any campaign, any
    // status), so a brand-new event could open already showing milestones
    // "done" from unrelated already-published posts.
    autoLinkAllContent: false,
    eventPlan: {
      role, participationType: participationType || "", eventDate, scale: scale.id,
      setup: { eventName, eventDate, campaignStartDate, eventLocation, expectedAudience: expectedAudience ?? null },
      objectives, phases,
    },
  });
  const days = daysBetween(localISODate(), eventDate);
  toast(t("camp.event.created", { name: eventName || template.label, count: phases.length, date: formatEventDate(eventDate), left: days > 0 ? t("camp.event.daysLeft", { days }) : "" }));
  onSaved?.();
  location.hash = `#/brand/${brandId}/campaigns/${created.id}`;
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
        <label>${t("camp.edit.name")}</label>
        <input class="input" id="c-name" placeholder="${escapeAttr(t("camp.edit.namePh"))}" value="${escapeAttr(draft.name)}" />
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("camp.custom.objective")}</label>
          <select class="select" id="c-objective">
            ${CAMPAIGN_OBJECTIVES.map((o) => `<option value="${o}" ${draft.objective === o ? "selected" : ""}>${CAMPAIGN_OBJECTIVE_LABELS[o]}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>${t("camp.edit.status")}</label>
          <select class="select" id="c-status">
            ${CAMPAIGN_STATUSES.map((s) => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${CAMPAIGN_STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>${t("camp.edit.audience")} <span class="text-faint" style="font-weight:400;">${t("camp.edit.audienceHint")}</span></label>
        <textarea class="textarea" id="c-audience" style="min-height:60px;">${draft.targetAudience}</textarea>
      </div>
      <div class="field">
        <label>${t("camp.edit.problem")}</label>
        <textarea class="textarea" id="c-problem" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.problemPh"))}">${draft.problemOrOpportunity}</textarea>
      </div>
      <div class="field">
        <label>${t("camp.edit.insight")}</label>
        <textarea class="textarea" id="c-insight" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.insightPh"))}">${draft.insight}</textarea>
      </div>
      <div class="field">
        <label>${t("camp.edit.bigIdea")}</label>
        <textarea class="textarea" id="c-bigidea" style="min-height:60px;">${draft.bigIdea}</textarea>
      </div>
      <div class="field">
        <label>${t("camp.edit.keyMessage")}</label>
        <textarea class="textarea" id="c-message" style="min-height:60px;" placeholder="${escapeAttr(t("camp.edit.keyMessagePh"))}">${draft.keyMessage}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("camp.edit.offer")}</label>
          <input class="input" id="c-offer" value="${escapeAttr(draft.offer)}" />
        </div>
        <div class="field">
          <label>${t("camp.edit.cta")}</label>
          <input class="input" id="c-cta" placeholder="${escapeAttr(t("camp.edit.ctaPh"))}" value="${escapeAttr(draft.cta)}" />
          <div class="hint" style="margin-top:4px;">${icon("info", { size: 12 })}<span>${t("camp.edit.ctaHint")}</span></div>
        </div>
      </div>
      <div class="field">
        <label>${t("camp.edit.channels")}</label>
        <textarea class="textarea" id="c-channels" style="min-height:60px;" placeholder="${t("camp.edit.channelsPh")}">${listToLines(draft.channels)}</textarea>
      </div>
      <div class="row-2">
        <div class="field" style="margin-bottom:0;">
          <label>${t("camp.edit.startDate")}</label>
          <input class="input" type="date" id="c-start" value="${draft.startDate}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>${t("camp.edit.endDate")}</label>
          <input class="input" type="date" id="c-end" value="${draft.endDate}" />
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
          <textarea class="textarea" id="phase-goal-${i}" style="min-height:50px;" placeholder="${escapeAttr(t("camp.edit.phaseGoalPh"))}">${p.goal}</textarea>
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
