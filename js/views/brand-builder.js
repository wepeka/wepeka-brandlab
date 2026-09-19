import { backLinkHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import { qs, escapeHtml, toast } from "../dom.js";
import { icon } from "../icons.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { t } from "../i18n.js";
import { brandDnaCompleteness, brandDnaDone, visualBasicsDone, brandBookProgress } from "../brand-progress.js";
export { visualBasicsDone } from "../brand-progress.js";
import { getMode } from "../mode.js";

// The Brand Builder hub: two doors — Brand DNA (its own wizard,
// js/views/brand-dna.js) and Brand Book (js/views/brand-guidelines.js).
// Each door shows the same progress counter the home hero uses
// (js/brand-progress.js), so the two pages never disagree about how far
// along a brand is. Nothing else lives here any more.
const HUB_TOUR_STEPS = [
  { selector: ".bb-hub-door:nth-child(1)", title: "Brand DNA", body: t("builder.tour.dna.body") },
  { selector: ".bb-hub-door:nth-child(2)", title: "Brand Guidelines", body: t("builder.tour.guidelines.body") },
];

// Whole-Builder completeness — both doors done. Used to decide whether
// saving the Brand Book should send someone all the way back to Home
// (nothing left to set up) instead of just back to this hub.
export function isBrandBuilderComplete(brand) {
  const book = brandBookProgress(brand);
  return brandDnaDone(brand) && book.filled >= book.total;
}

// One-shot "just finished the whole Builder" flag — set right before
// navigating to Home from Guidelines' save, consumed (and turned into a
// celebratory toast) the first time Home paints afterward. sessionStorage
// rather than a store field since it's purely "play this once".
const BUILDER_JUST_COMPLETED_KEY = "contentos:builder-just-completed";

export function markBuilderJustCompleted(brandId) {
  sessionStorage.setItem(BUILDER_JUST_COMPLETED_KEY, brandId);
}

// Returns true the one time this fires so callers (home.js) can layer
// their own "what's newly unlocked" UI on top of the plain toast.
export function celebrateBuilderCompleteIfFlagged(brandId) {
  if (sessionStorage.getItem(BUILDER_JUST_COMPLETED_KEY) !== brandId) return false;
  sessionStorage.removeItem(BUILDER_JUST_COMPLETED_KEY);
  toast(t("builder.celebrate.all"));
  return true;
}

// Same one-shot pattern for visualBasicsDone specifically — the Brand
// Book's "Balik ke Beranda" sets this so Home can unlock the Campaign step
// right then, not only once every other visual section is filled too.
const VISUAL_BASICS_JUST_DONE_KEY = "contentos:visual-basics-just-done";

export function markVisualBasicsJustDone(brandId) {
  sessionStorage.setItem(VISUAL_BASICS_JUST_DONE_KEY, brandId);
}

export function consumeVisualBasicsJustDone(brandId) {
  if (sessionStorage.getItem(VISUAL_BASICS_JUST_DONE_KEY) !== brandId) return false;
  sessionStorage.removeItem(VISUAL_BASICS_JUST_DONE_KEY);
  return true;
}

// Brand DNA's wizard sets this right before navigating away on a save that
// pushed it to 100%; whichever page the account lands on (this hub in Pro,
// Home in Pemula) consumes it once.
const DNA_JUST_COMPLETED_KEY = "contentos:dna-just-completed";

export function markDnaJustCompleted(brandId) {
  sessionStorage.setItem(DNA_JUST_COMPLETED_KEY, brandId);
}

export function consumeDnaJustCompleted(brandId) {
  if (sessionStorage.getItem(DNA_JUST_COMPLETED_KEY) !== brandId) return false;
  sessionStorage.removeItem(DNA_JUST_COMPLETED_KEY);
  return true;
}

export function render(root, { brandId, stage }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  // Old deep links from before the stage grid went away still land somewhere useful.
  if (stage === "personality") location.replace(`#/brand/${brandId}/dna/identity`);
  else if (stage === "dna") location.replace(`#/brand/${brandId}/dna`);
  else if (stage === "toneOfVoice") location.replace(`#/brand/${brandId}/guidelines/tone`);
  else if (stage === "guidelines") location.replace(`#/brand/${brandId}/guidelines/color`);
  else paintHub(root, brand);
  return () => {};
}

function paintHub(root, brand) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brand.id}`, t("nav.home"))} · Brand Builder${helpButtonHTML("brand-builder-hub")}${guideVideoButtonHTML("brand-builder-hub")}</div>
        <h1>${escapeHtml(brand.name)}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${t("builder.hub.sub")}</p>
      </div>
    </div>
    <div class="intro-note" style="max-width:640px;">
      ${icon("sparkle", { size: 15 })}
      <span>${t("builder.hub.intro")}</span>
    </div>
    <div class="bb-hub-grid">
      ${dnaDoorHTML(brand)}
      ${bookDoorHTML(brand)}
    </div>
  `;
  wireHelpButtons(root);
  setPageGuide(() => runSpotlightTour(HUB_TOUR_STEPS));

  if (consumeDnaJustCompleted(brand.id)) celebrateDnaComplete(root);
}

function celebrateDnaComplete(root) {
  const dnaDoor = qs(`a.bb-hub-door[href$="/dna"]`, root);
  if (dnaDoor) {
    dnaDoor.classList.add("bb-hub-door-celebrate");
    dnaDoor.addEventListener("animationend", () => dnaDoor.classList.remove("bb-hub-door-celebrate"), { once: true });
  }
  toast(t("builder.celebrate.dna"));
}

function doorHTML({ href, iconName, label, helpKey, desc, pct, progressLabel, primary }) {
  return `
    <a class="card dark-surface bb-hub-door ${primary ? "is-next" : ""}" href="${href}">
      <div class="bb-hub-icon">${icon(iconName, { size: 30 })}</div>
      <h2 class="flex items-center gap-6">${label}${helpButtonHTML(helpKey)}</h2>
      <p>${desc}</p>
      <div class="bb-hub-progress">
        <div class="bb-hub-bar"><span style="width:${pct}%;"></span></div>
        <span>${progressLabel}</span>
      </div>
    </a>
  `;
}

function dnaDoorHTML(brand) {
  const { filled, total } = brandDnaCompleteness(brand.brandDNA);
  return doorHTML({
    href: `#/brand/${brand.id}/dna`,
    iconName: "target",
    label: "Brand DNA",
    helpKey: "term-brand-dna",
    desc: t("builder.group.dna.doorDesc"),
    pct: total ? Math.round((filled / total) * 100) : 0,
    progressLabel: t("builder.progress.dnaQuestions", { done: filled, total }),
    primary: !brandDnaDone(brand),
  });
}

// Pemula's promise for this door is exactly Warna+Font; Pro counts the
// whole book (logo, colour, type, direction, tone).
function bookDoorHTML(brand) {
  const pro = getMode() === "advanced";
  const basics = visualBasicsDone(brand);
  const book = brandBookProgress(brand);
  const pct = pro ? Math.round((book.filled / book.total) * 100) : basics ? 100 : 0;
  return doorHTML({
    href: `#/brand/${brand.id}/guidelines/color`,
    iconName: "book",
    label: "Brand Guidelines",
    helpKey: "term-brand-guidelines",
    desc: t("builder.group.guidelines.doorDesc"),
    pct,
    progressLabel: pro ? t("builder.progress.stages", { done: book.filled, total: book.total }) : basics ? t("builder.progress.visualDone") : t("builder.progress.visualPending"),
    primary: brandDnaDone(brand) && !(pro ? book.filled >= book.total : basics),
  });
}
