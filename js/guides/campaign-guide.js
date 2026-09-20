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
    // 3 — Syarat & Ketentuan (Grow Personal Branding and Event have one;
    // Grow Social Media goes straight to step 6). The tour only asks them to
    // actually read it; ticking "setuju" and pressing Lanjut is left to the
    // user, never prompted (user's call, 14 Sep 2026).
    {
      selector: "#terms-scroll",
      showIf: has("#terms-scroll"),
      title: t("guide.camp.terms.title"),
      body: t("guide.camp.terms.body"),
      nextLabel: t("guide.camp.terms.next"),
      placement: "top",
    },
    // …then the tour gets out of the way (no tooltip over the text) and
    // quietly resumes once the terms modal is gone, however it closed.
    {
      selector: "#terms-scroll",
      showIf: has("#terms-scroll"),
      title: t("guide.camp.reading.title"),
      body: "",
      interactive: { type: "until", predicate: () => !qs("#terms-scroll") },
      quiet: true,
    },
    // 6 — either button ends at the name prompt ("Sudah" goes through a
    // mission picker + Lanjut first), so wait for that prompt instead
    {
      selector: "#calib-fresh",
      showIf: has("#calib-fresh"),
      title: t("guide.camp.calib.title"),
      body: t("guide.camp.calib.body"),
      interactive: { type: "until", predicate: has("#prompt-input") },
      hint: t("guide.camp.calib.hint"),
    },
    // Cabang Event: peran → form setup → dibuat
    {
      selector: "[data-role]",
      showIf: has("[data-role]"),
      title: t("guide.camp.role.title"),
      body: t("guide.camp.role.body"),
      interactive: { type: "clickAny" },
    },
    {
      selector: ".ev-wizard",
      showIf: has(".ev-wizard"),
      beforeStep: goToDetail,
      title: t("guide.camp.wizard.title"),
      body: t("guide.camp.wizard.body"),
      interactive: { type: "until", predicate: () => !has(".ev-wizard")() },
      hint: t("guide.camp.wizard.hint"),
      write: true,
    },
    // 7
    {
      selector: "#prompt-input",
      showIf: has("#prompt-input"),
      title: t("guide.camp.name.title"),
      body: t("guide.camp.name.body"),
      interactive: { type: "input", minLength: 3 },
    },
    // 8
    {
      selector: ".overlay.center [data-confirm]",
      showIf: has("#prompt-input"),
      beforeStep: goToDetail,
      title: t("guide.camp.create.title"),
      body: t("guide.camp.create.body"),
      interactive: { type: "click" },
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
      selector: "#edit-campaign",
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
