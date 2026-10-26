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
import { getMode } from "../mode.js";

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
    // "Konten baru" opens the small new-content drawer: a title, then Save —
    // the piece opens here in Creator, where Bab 2 picks up. (The old
    // platform picker this step pointed at no longer exists.)
    {
      selector: ".overlay .drawer #f-title",
      showIf: () => !!qs(".overlay .drawer #f-title"),
      title: t("guide.cal.title.title"),
      body: t("guide.cal.title.body"),
      interactive: { type: "input", minLength: 3 },
    },
    {
      selector: ".overlay .drawer [data-save]",
      showIf: () => !!qs(".overlay .drawer [data-save]"),
      title: t("common.save"),
      body: t("guide.creator.save.body"),
      interactive: { type: "until", predicate: () => !qs(".overlay .drawer") },
      hint: t("guide.cal.save.hint"),
      write: true,
    },
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
      // Only where the generator shows the choice — a step whose target
      // isn't there is skipped at once instead of waiting four seconds.
      showIf: () => !!qs("#ai-funnel"),
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
      // The script box: "Biasa" (plain) or "Pro" (cards), whichever is on.
      selector: ["#f-script-plain", "#script-cards"],
      title: t("guide.creator.scriptEdit.title"),
      body: t("guide.creator.scriptEdit.body"),
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
    {
      // The teleprompter lives on the Syuting screen (it used to sit next
      // to the script while writing). Pointed at, not opened: the tour's
      // own layer would sit on top of a full-screen teleprompter.
      selector: "#open-teleprompter",
      showIf: () => !!qs("#open-teleprompter"),
      title: t("guide.creator.tp.title"),
      body: t("guide.creator.tp.body"),
    },
  ];
}

// ---------- Pemula: the folders + steps workspace (js/views/creator.js) ----------
// The same cycle on Pemula's Creator: the two-step "Konten baru", the Ide
// step with the chat beside it, then the script with the AI writer (dummy
// during the tour) and on to shooting.

function pemulaIntroSteps(hasOpen) {
  if (hasOpen) {
    return [{ selector: ".cw-item", title: t("guide.creator.existing.title"), body: t("cg.list.body"), interactive: { type: "clickAny" } }];
  }
  return [
    { selector: "#new-content", title: t("guide.creator.new.title"), body: t("guide.creator.new.body"), interactive: { type: "click", extraSelectors: ["#new-content-empty"] } },
    { selector: ".nw-tiles", showIf: () => !!qs(".nw-tiles"), title: t("cg.wiz1.title"), body: t("cg.wiz1.body"), interactive: { type: "clickAny" } },
    { selector: "#nw-next", showIf: () => !!qs(".nw-tiles"), title: t("nw.next"), body: t("cg.wiz1.next"), interactive: { type: "click" } },
    { selector: "#nw-text", showIf: () => !!qs("#nw-text"), title: t("cg.wiz2.title"), body: t("cg.wiz2.body"), interactive: { type: "input", minLength: 3 }, skippable: true },
    { selector: "#nw-next", showIf: () => !!qs("#nw-text"), title: t("nw.start"), body: t("cg.wiz2.start"), interactive: { type: "click" }, write: true },
  ];
}

function pemulaWorkSteps() {
  return [
    { selector: ".cw-steps", title: t("cg.steps.title"), body: t("cg.steps.body") },
    { selector: "#f-idea", showIf: () => !!qs("#f-idea"), title: t("cw.idea.label"), body: t("cg.idea.body") },
    { selector: ["#consultant-panel.is-ws-docked", ".cw-chat-invite"], showIf: () => !!qs("#cw-to-script"), title: t("cw.idea.chatTitle"), body: t("cg.chat.body") },
    { selector: "#cw-to-script", showIf: () => !!qs("#cw-to-script"), title: t("cw.idea.next"), body: t("cg.toScript.body"), interactive: { type: "click" }, write: true },
    { selector: "#ai-generate-all", showIf: () => !qs("#ai-prompt"), title: t("cw.script.aiBtn"), body: t("guide.creator.aiAll.body"), interactive: { type: "click" }, waitTimeout: 6000 },
  ];
}

function pemulaAfterAiSteps() {
  return [
    { selector: ["#f-script-plain", "#script-cards", "#slide-editor"], title: t("guide.creator.scriptEdit.title"), body: t("guide.creator.scriptEdit.body") },
    { selector: "#cw-to-shoot", title: t("cw.script.next"), body: t("cg.toShoot.body"), interactive: { type: "click" }, write: true },
  ];
}

export function buildCreatorSteps({ brandId }) {
  const campaigns = listCampaigns(brandId);
  const unfinished = listContent(brandId).filter((c) => c.status !== "published");
  if (getMode() === "guided") {
    // aiSteps without its first one: Pemula's own step opens the writer.
    return adaptForAccount([...pemulaIntroSteps(unfinished.length > 0), ...pemulaWorkSteps(), ...aiSteps().slice(1), ...pemulaAfterAiSteps(), ...executionSteps()]);
  }
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
          hash: `#/brand/${brandId}/content/calendar`,
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
    build: () => buildCreatorSteps({ brandId }),
    options: creatorTourOptions(brandId),
  });
}
