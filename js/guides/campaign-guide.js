// Tur C — Campaign (plan-guided-tour-content-os.md §5). Two page-scoped
// parts because list and detail are different routes:
//   C1 (#/brand/:id/campaigns)      — create a campaign, ends by navigating
//                                     to the new campaign's detail page
//   C2 (#/brand/:id/campaigns/:cid) — work a level; starts automatically
//                                     there via the "campaign-detail" flag.
// C2 has three shapes: mission ladder (Grow templates), event plan, and the
// phase journey (Custom).
import { runSpotlightTour } from "../tour.js";
import { listCampaigns, getCampaign, getSettings } from "../store.js";
import { hasAiKey } from "../ai.js";
import { qs } from "../dom.js";
import { t } from "../i18n.js";
import {
  adaptForAccount,
  markTourSeen,
  tourSeen,
  setPendingTour,
  clearPendingTour,
  showTourRecap,
  startGuideOnMount,
} from "./common.js";

const has = (sel) => () => !!qs(sel);

// ---------- C1 · Bikin campaign (list) ----------

export function buildCampaignListSteps({ brandId }) {
  const campaigns = listCampaigns(brandId);
  const goToDetail = () => setPendingTour("campaign-detail");

  if (campaigns.length) {
    return adaptForAccount([
      {
        selector: "[data-open-campaign]",
        beforeStep: goToDetail,
        title: t("guide.camp.open.title"),
        body: t("guide.camp.open.body"),
        interactive: { type: "clickAny" },
      },
    ]);
  }

  return adaptForAccount([
    // 1
    {
      selector: "#new-campaign",
      title: t("guide.camp.new.title"),
      body: t("guide.camp.new.body"),
      interactive: { type: "click" },
    },
    // 2
    {
      selector: "[data-quick-template]",
      title: t("guide.camp.template.title"),
      body: t("guide.camp.template.body"),
      interactive: { type: "clickAny" },
    },
    // 3a — Grow Brand: tick the tracks, answer a few numbers, launch.
    // (The old templates' terms sheet, level calibration and name prompt
    // are gone; so are the steps that pointed at them.)
    {
      selector: ".goal-wizard",
      showIf: has(".goal-wizard"),
      beforeStep: goToDetail,
      title: t("guide.camp.wizard.title"),
      body: t("guide.camp.wizard.body"),
      interactive: { type: "until", predicate: () => !has(".goal-wizard")() },
      hint: t("guide.camp.wizard.hint"),
      write: true,
    },
    // 3b — Event: name, date and size, then a draft plan to install.
    {
      selector: ".rg-wizard",
      showIf: has(".rg-wizard"),
      title: t("guide.camp.eventWizard.title"),
      body: t("guide.camp.eventWizard.body"),
      interactive: { type: "until", predicate: () => !has(".rg-wizard")() },
      hint: t("guide.camp.eventWizard.hint"),
      write: true,
    },
  ]);
}

// ---------- C2 · Kerjakan level (detail) ----------

// Shared by the mission and event shapes — both have "Brainstorm Konten".
// The button leaves this page (it opens the Brainstorm partner scoped to
// this campaign), so the tour only points at the door — no gating on what
// happens inside.
function brainstormSteps() {
  return [
    // 7
    {
      selector: "#cd-brainstorm",
      title: t("guide.camp.brainstorm.title"),
      body: t("guide.camp.brainstorm.body"),
      skippable: true,
    },
  ];
}

// One detail layout for every campaign shape (js/views/campaign-detail.js):
// headline → next action → stages → milestones with sources → activities.
function buildDetailSteps(campaign) {
  const isEvent = !!campaign.eventPlan;
  const isLadder = !!campaign.missions?.length;
  return [
    {
      selector: ".cd-headline",
      showIf: has(".cd-headline"),
      title: t("guide.camp.headline.title"),
      body: t("guide.camp.headline.body"),
    },
    {
      selector: "#cd-next",
      showIf: has("#cd-next"),
      title: t("guide.camp.next.title"),
      body: t("guide.camp.next.body"),
    },
    {
      selector: "#cd-stages",
      showIf: has("#cd-stages"),
      title: isEvent ? t("guide.camp.stages.event.title") : isLadder ? t("guide.camp.stages.ladder.title") : t("guide.camp.stages.phase.title"),
      body: isEvent
        ? t("guide.camp.stages.event.body")
        : isLadder
        ? t("guide.camp.stages.ladder.body")
        : t("guide.camp.stages.phase.body"),
    },
    {
      selector: "#cd-milestones .cd-row:nth-child(1)",
      showIf: has("#cd-milestones .cd-row"),
      title: t("guide.camp.milestones.title"),
      body: t("guide.camp.milestones.body"),
    },
    {
      selector: "#cd-manual-all",
      showIf: has("#cd-manual-all"),
      title: t("guide.camp.manualAll.title"),
      body: t("guide.camp.manualAll.body"),
    },
    ...brainstormSteps(),
    {
      selector: "#cd-more",
      title: t("guide.camp.edit.title"),
      body: t("guide.camp.edit.body"),
    },
  ];
}

export function buildCampaignDetailSteps({ campaignId }) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return [];
  return adaptForAccount(buildDetailSteps(campaign));
}

// ---------- Entry points ----------

function listTourOptions() {
  return {
    onFinish: (reason) => {
      markTourSeen("campaign-list");
      if (reason === "closed") clearPendingTour("campaign-detail");
    },
  };
}

function detailTourOptions(brandId, campaignId) {
  const detailHash = `#/brand/${brandId}/campaigns/${campaignId}`;
  return {
    onFinish: (reason) => {
      markTourSeen("campaigns");
      if (location.hash === detailHash) clearPendingTour("creator");
      if (reason !== "done") return;
      showTourRecap({
        title: t("guide.camp.recapTitle"),
        body: t("guide.camp.recap"),
      });
    },
  };
}

export function startCampaignListGuide(brandId) {
  return runSpotlightTour(buildCampaignListSteps({ brandId }), listTourOptions());
}

export function startCampaignDetailGuide(brandId, campaignId) {
  return runSpotlightTour(buildCampaignDetailSteps({ brandId, campaignId }), detailTourOptions(brandId, campaignId));
}

// Once per mount of each page (not per repaint).
export function startCampaignListGuideOnMount(brandId) {
  startGuideOnMount({
    pendingKey: "campaigns",
    build: () => buildCampaignListSteps({ brandId }),
    options: listTourOptions(),
  });
}

export function startCampaignDetailGuideOnMount(brandId, campaignId) {
  startGuideOnMount({
    pendingKey: "campaign-detail",
    build: () => buildCampaignDetailSteps({ brandId, campaignId }),
    options: detailTourOptions(brandId, campaignId),
  });
}
