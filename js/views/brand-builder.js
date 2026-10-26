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
import { appByKey } from "../apps.js";
import { appIconSVG } from "../app-icons.js";
import { brandArtSVG, BRAND_PARTS } from "../brand-art.js";
import { wirePointerLight } from "../my-brand-head.js";
import { ensureGoogleFont, ensureCustomFont } from "./brand-guidelines.js";

// The Brand Builder hub: two doors — Brand DNA (its own wizard,
// js/views/brand-dna.js) and Brand Book (js/views/brand-guidelines.js).
// Each door shows the same progress counter the home hero uses
// (js/brand-progress.js), so the two pages never disagree about how far
// along a brand is. Nothing else lives here any more.
const HUB_TOUR_STEPS = [
  { selector: ".mb-id", title: t("mb.id.eyebrow"), body: t("mb.tour.id.body") },
  { selector: '.mb-card[data-part="dna"]', title: "Brand DNA", body: t("builder.tour.dna.body") },
  { selector: '.mb-card[data-part="book"]', title: "Brand Book", body: t("builder.tour.guidelines.body") },
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

// My Brand (owner, 2026-10-27: "benerin My Brand, Brand DNA sama Brand Book
// buat jadi lebih menarik"): the brand's own card on top — logo, name,
// tagline, colours, fonts, filling in as the two parts are done — then
// Brand DNA and Brand Book as two big cards in the launcher's style.
function paintHub(root, brand) {
  const app = appByKey("builder");
  const pro = getMode() === "advanced";
  const dnaDone = brandDnaDone(brand);
  const book = brandBookProgress(brand);
  const bookDone = pro ? book.filled >= book.total : visualBasicsDone(brand);
  const current = !dnaDone ? "dna" : !bookDone ? "book" : "";
  root.innerHTML = `
    <div class="mb">
      <header class="mb-head">
        <div class="mb-head-title">
          <span class="mb-tile lh-pic" style="--app:${app.color};--app2:${app.color2};">${appIconSVG("builder")}</span>
          <div>
            <h1>${t("app.brand.name")}</h1>
            <p>${t("mb.sub")}</p>
          </div>
        </div>
        <div class="page-eyebrow mb-help">${helpButtonHTML("brand-builder-hub")}${guideVideoButtonHTML("brand-builder-hub")}</div>
      </header>
      ${idCardHTML(brand)}
      <div class="mb-grid">
        ${dnaCardHTML(brand, current === "dna")}
        ${bookCardHTML(brand, current === "book", { pro, book, bookDone })}
      </div>
    </div>
  `;
  wireHelpButtons(root);
  wirePointerLight(qs(".mb", root));
  setPageGuide(() => runSpotlightTour(HUB_TOUR_STEPS));

  if (consumeDnaJustCompleted(brand.id)) celebrateDnaComplete(root);
}

const HEX = /^#[0-9a-f]{3,8}$/i;
const isImageUrl = (u) => typeof u === "string" && (u.startsWith("data:image/") || u.startsWith("https://"));

// The brand's card: what the two parts have produced so far, in the brand's
// own colours and font — and a quiet placeholder for what's still missing.
function idCardHTML(brand) {
  const bg = brand.brandGuidelines || {};
  const dna = brand.brandDNA || {};
  const colors = ["primary", "secondary", "accent"].map((k) => bg.colors?.[k]).filter((c) => c && HEX.test(c));
  const font = (bg.fonts?.primary || "").trim();
  const font2 = (bg.fonts?.secondary || "").trim();
  const custom = font ? bg.customFonts?.[font] : "";
  if (font) {
    if (!custom) ensureGoogleFont(font);
    else if (typeof custom === "string" && custom.startsWith("data:")) ensureCustomFont(font, custom);
  }
  const logo = bg.logo?.dataUrl || brand.avatar || "";
  const tagline = (dna.tagline || "").trim();
  const line = (dna.oneLiner || "").trim();
  const c1 = colors[0] || "#FFA52B";
  const c2 = colors[1] || colors[2] || "#FF5F2E";
  const fontStyle = font ? ` style="font-family:'${escapeHtml(font)}', var(--font-display), sans-serif"` : "";
  return `
    <section class="mb-id" style="--b1:${c1};--b2:${c2};">
      <div class="mb-id-cover" aria-hidden="true">
        <span class="mb-id-logo${isImageUrl(logo) ? " is-image" : ""}">${isImageUrl(logo) ? `<img src="${escapeHtml(logo)}" alt="" />` : escapeHtml((brand.name || "?").trim().charAt(0).toUpperCase())}</span>
      </div>
      <div class="mb-id-body">
        <span class="mb-id-eyebrow">${t("mb.id.eyebrow")}</span>
        <h2${fontStyle}>${escapeHtml(brand.name)}</h2>
        ${tagline ? `<p class="mb-id-tagline">“${escapeHtml(tagline)}”</p>` : `<a class="mb-id-missing" href="#/brand/${brand.id}/dna">${icon("plus", { size: 13 })}${t("mb.id.noTagline")}</a>`}
        ${line ? `<p class="mb-id-line">${escapeHtml(line)}</p>` : ""}
        <div class="mb-id-meta">
          <div class="mb-id-group">
            <span class="mb-id-label">${t("mb.id.colors")}</span>
            ${colors.length
              ? `<span class="mb-id-swatches">${colors.map((c) => `<span class="mb-id-swatch" style="background:${c}" title="${c}"></span>`).join("")}</span>`
              : `<a class="mb-id-missing" href="#/brand/${brand.id}/guidelines/color">${icon("plus", { size: 13 })}${t("mb.id.noColors")}</a>`}
          </div>
          <div class="mb-id-group">
            <span class="mb-id-label">${t("mb.id.fonts")}</span>
            ${font
              ? `<span class="mb-id-font"><b${fontStyle}>Aa</b><span>${escapeHtml([font, font2].filter(Boolean).join(" · "))}</span></span>`
              : `<a class="mb-id-missing" href="#/brand/${brand.id}/guidelines/typography">${icon("plus", { size: 13 })}${t("mb.id.noFonts")}</a>`}
          </div>
        </div>
      </div>
    </section>`;
}

// One part of My Brand as a big card: its step, name, one line, how far it
// is, and the button — with its picture running off the corner.
function partCardHTML({ part, href, step, name, sub, pct, progress, done, current, cta }) {
  const c = BRAND_PARTS[part];
  return `
    <a class="lh-card mb-card${current ? " is-current" : ""}${done ? " is-done" : ""}" href="${href}" data-part="${part}" style="--app:${c.color};--app2:${c.color2};">
      <span class="mb-card-step">${step}</span>
      <span class="lh-card-name">${name}</span>
      <span class="lh-card-sub">${sub}</span>
      <span class="mb-card-progress"><span class="mb-bar"><i style="width:${pct}%"></i></span><b>${done ? icon("check", { size: 13 }) : ""}${progress}</b></span>
      <span class="mb-card-cta">${cta}<span class="mb-card-cta-dot">${icon("arrowRight", { size: 15 })}</span></span>
      ${current ? `<span class="lh-card-here">${t("lh.here")}</span>` : ""}
      <span class="lh-card-art">${brandArtSVG(part)}</span>
    </a>`;
}

function dnaCardHTML(brand, current) {
  const { filled, total } = brandDnaCompleteness(brand.brandDNA);
  const done = brandDnaDone(brand);
  return partCardHTML({
    part: "dna",
    href: `#/brand/${brand.id}/dna`,
    step: t("mb.step", { n: 1 }),
    name: "Brand DNA",
    sub: t("mb.dna.sub"),
    pct: total ? Math.round((filled / total) * 100) : 0,
    progress: t("builder.progress.dnaQuestions", { done: filled, total }),
    done,
    current,
    cta: done ? t("mb.cta.edit") : filled ? t("mb.cta.continue") : t("mb.cta.start"),
  });
}

// Same count as the Brand Book page's own bar and Beranda
// (brandBookProgress) in both modes. Pemula's "done" is colours + fonts —
// all My Goals waits for.
function bookCardHTML(brand, current, { book, bookDone }) {
  return partCardHTML({
    part: "book",
    href: `#/brand/${brand.id}/guidelines/color`,
    step: t("mb.step", { n: 2 }),
    name: "Brand Book",
    sub: t("mb.book.sub"),
    pct: Math.round((book.filled / book.total) * 100),
    progress: t("builder.progress.stages", { done: book.filled, total: book.total }),
    done: bookDone,
    current,
    cta: bookDone ? t("mb.cta.edit") : book.filled ? t("mb.cta.continue") : t("mb.cta.start"),
  });
}

function celebrateDnaComplete(root) {
  const dnaDoor = qs(`.mb-card[data-part="dna"]`, root);
  if (dnaDoor) {
    dnaDoor.classList.add("mb-card-celebrate");
    dnaDoor.addEventListener("animationend", () => dnaDoor.classList.remove("mb-card-celebrate"), { once: true });
  }
  toast(t("builder.celebrate.dna"));
}
