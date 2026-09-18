// Tur A — Creator Studio (plan-guided-tour-content-os.md §3). One full
// "belajar sambil ngerjain" cycle: bikin konten → generate hook/script/
// caption pakai AI (dummy selama tur, lihat js/tour-demo.js) → syuting →
// editing → upload → Published. Ends by offering to chain into the
// Kalender guide, mirroring calendar-guide.js/campaign-guide.js.
import { runSpotlightTour } from "../tour.js";
import { listContent, listCampaigns } from "../store.js";
import { qs } from "../dom.js";
import { t } from "../i18n.js";
import { adaptForAccount, markTourSeen, tourSeen, offerNextTour, showTourRecap, startGuideOnMount } from "./common.js";

// ---------- Bab 1 · Bikin konten pertama (or jump straight in) ----------

function existingContentStep() {
  return [
    {
      selector: ".creator-item",
      title: t("guide.creator.existing.title"),
      body: t("guide.creator.existing.body"),
      interactive: { type: "clickAny" },
    },
  ];
}

// Content Editor's drawer shares ids (#f-title/#f-idea/#f-campaign) with
// Creator's own drafting panel underneath it — prefixed with the drawer
// container so the tour never spotlights the wrong copy of the field.
function newContentSteps(campaigns) {
  return [
    {
      selector: "#new-content",
      title: t("guide.creator.new.title"),
      body: t("guide.creator.new.body"),
      interactive: { type: "click", extraSelectors: ["#new-content-empty"] },
    },
    {
      selector: "[data-platform-pick]",
      title: t("guide.creator.platform.title"),
      body: t("guide.creator.platform.body"),
      interactive: { type: "clickAny" },
    },
    // Picking a platform creates the content and opens the AI hook/script/
    // caption generator straight away (no edit drawer) — Bab 2 picks up there.
  ];
}

// ---------- Bab 2 · Generate pakai AI ----------
// AI dummy selama tur (js/tour-demo.js, dipakai lewat isTourDemo() di
// creator.js) — tidak digate ke hasAiKey, sama seperti tur Kalender/Campaign.

function aiSteps() {
  return [
    {
      selector: "#ai-generate-all",
      // Coming from "Konten Baru" the generator is already open.
      showIf: () => !qs("#ai-prompt"),
      title: t("guide.creator.aiAll.title"),
      body: t("guide.creator.aiAll.body"),
      interactive: { type: "click" },
    },
    {
      selector: "#ai-prompt",
      title: t("guide.creator.prompt.title"),
      body: t("guide.creator.prompt.body"),
      interactive: { type: "input", minLength: 10 },
    },
    {
      selector: "#ai-funnel",
      title: t("guide.creator.funnel.title"),
      body: t("guide.creator.funnel.body"),
    },
    {
      selector: "#ai-generate",
      title: t("guide.creator.generate.title"),
      body: t("guide.creator.generate.body"),
      interactive: { type: "click" },
    },
    {
      selector: "#hooks-section [data-insert-hook]",
      title: t("guide.creator.wait.title"),
      body: t("guide.creator.wait.body"),
      interactive: { type: "until", predicate: () => !!qs("#hooks-section [data-insert-hook]") },
      hint: t("tour.hint.until"),
      skippable: true,
    },
    {
      selector: "[data-insert-hook]",
      showIf: () => !!qs("[data-insert-hook]"),
      title: t("guide.creator.hook.title"),
      body: t("guide.creator.hook.body"),
      interactive: { type: "clickAny" },
      skippable: true,
    },
    {
      selector: ".use-script-btn",
      showIf: () => !!qs(".use-script-btn"),
      title: t("guide.creator.script.title"),
      body: t("guide.creator.script.body"),
      interactive: { type: "click" },
      skippable: true,
    },
    {
      selector: ".use-caption-btn",
      showIf: () => !!qs(".use-caption-btn"),
      title: t("guide.creator.caption.title"),
      body: t("guide.creator.caption.body"),
      interactive: { type: "click" },
      skippable: true,
    },
    {
      selector: "#ai-close",
      title: t("common.close"),
      body: t("guide.creator.close.body"),
      interactive: { type: "click" },
    },
  ];
}

// ---------- Bab 3 · Lengkapi & serahkan ke syuting ----------

function scriptingSteps() {
  return [
    {
      selector: "#f-script",
      title: t("guide.creator.scriptEdit.title"),
      body: t("guide.creator.scriptEdit.body"),
    },
    {
      selector: "#open-teleprompter",
      title: t("guide.creator.tp.title"),
      body: t("guide.creator.tp.body"),
      interactive: { type: "click" },
    },
    {
      selector: "#tp-play",
      title: t("guide.creator.tpPlay.title"),
      body: t("guide.creator.tpPlay.body"),
    },
    {
      selector: "#tp-close",
      title: t("guide.creator.tpClose.title"),
      body: t("guide.creator.tpClose.body"),
      interactive: { type: "click" },
    },
    {
      selector: "#f-cta",
      title: t("guide.creator.cta.title"),
      body: t("guide.creator.cta.body"),
      skippable: true,
    },
    {
      selector: "#download-script-pdf",
      title: t("guide.creator.pdf.title"),
      body: t("guide.creator.pdf.body"),
    },
    {
      selector: "#mark-submitted input",
      title: t("guide.creator.submit.title"),
      body: t("guide.creator.submit.body"),
      interactive: { type: "change" },
      write: true,
    },
  ];
}

// ---------- Bab 4 · Syuting → Editing → Upload → Published ----------
// Info-only: no write/interactive gate after #mark-submitted (Bab 3). The
// content's real progress through Syuting/Editing/Siap upload/Terbit is
// left entirely to the user clicking the big buttons on their own time.

function executionSteps() {
  return [
    {
      selector: ".stage-script-display",
      title: t("guide.creator.shootMode.title"),
      body: t("guide.creator.shootMode.body"),
      waitTimeout: 6000,
      skipIfMissing: false,
    },
  ];
}

export function buildCreatorSteps({ brandId }) {
  const campaigns = listCampaigns(brandId);
  const unfinished = listContent(brandId).filter((c) => c.status !== "published");
  const intro = unfinished.length ? existingContentStep() : newContentSteps(campaigns);
  return adaptForAccount([...intro, ...aiSteps(), ...scriptingSteps(), ...executionSteps()]);
}

// ---------- Entry points ----------

function creatorTourOptions(brandId) {
  return {
    onFinish: (reason) => {
      markTourSeen("creator");
      if (reason !== "done") return;
      const recap = t("guide.creator.recap");
      if (!tourSeen("calendar")) {
        offerNextTour({
          title: t("guide.creator.offer.title"),
          body: t("guide.creator.offer.body", { recap }),
          ctaLabel: t("guide.creator.offer.cta"),
          hash: `#/brand/${brandId}/content-os/calendar`,
          startKey: "calendar",
        });
      } else {
        showTourRecap({ title: t("guide.creator.recapTitle"), body: recap });
      }
    },
  };
}

export function startCreatorGuide(brandId) {
  return runSpotlightTour(buildCreatorSteps({ brandId }), creatorTourOptions(brandId));
}

// Once per mount of the Creator page (not per repaint).
export function startCreatorGuideOnMount(brandId) {
  startGuideOnMount({
    pendingKey: "creator",
    autoplayKey: "creator",
    build: () => buildCreatorSteps({ brandId }),
    options: creatorTourOptions(brandId),
  });
}
