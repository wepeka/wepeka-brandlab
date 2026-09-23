import { backLinkHTML } from "../back-link.js";
import { getBrand, updateBrand, getSettings } from "../store.js";
import { qs, qsa, escapeHtml, resizeImageFile, fileToDataURL, toast, pickTintTextColor } from "../dom.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, promptDialog } from "../modals.js";
import {
  COLOR_FEELINGS, COLOR_PALETTES, COLOR_FORMULA_INFO, generatePaletteFromBase, hexToRgb, hexToCmyk, contrastRatio,
  TYPOGRAPHY_FEELINGS, FONT_LIBRARY, PREMIUM_FONT_LINK, FONT_CATEGORIES, FONT_CATEGORY_SECTORS, FONT_CATEGORY_PAIRINGS,
  VISUAL_DIRECTIONS, APPLICATION_TYPES, IMAGERY_STYLE_COPY,
  TONE_AXES, toneAxisDisplayLabel, toneExampleDisplay,
  feelingLabel, directionLabel, directionDescription,
} from "../brandbook-data.js";
import { isBrandBuilderComplete, markBuilderJustCompleted, markVisualBasicsJustDone } from "./brand-builder.js";
import { generateValueProposition, generateColorEssence, detectToneOfVoice, hasAiKey, AiApiError } from "../ai.js";
import { wireMic } from "../voice-input.js";
import { t } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { getMode } from "../mode.js";
import { getCachedAccount, currentUid, isAdmin, LIFETIME_PLANS } from "../account.js";
import { payPlan } from "./pricing.js";

const TOUR_STEPS = [
  { selector: ".bb-tab-row", title: t("bg.tour.title"), body: t("bg.tour.body") },
];

// A guided, two-pane Brand Book builder (questions left, live preview
// right) built on top of Brand DNA rather than re-asking brand name/
// audience/personality — per the user's confirmed direction, every brand
// builds this fresh (no upload-and-extract path), and every
// recommendation below is a deterministic lookup from brandbook-data.js,
// not an AI call, so this works with no API key configured.
// Section labels come from i18n (getter, so the language switch applies).
// Tone of Voice now lives here too, next to the visual sections, instead of
// only as a separate Brand Builder stage.
const STEPS = ["foundation", "logo", "color", "typography", "direction", "tone", "applications"].map((key) => ({
  key,
  get title() {
    return t(`guidelines.step.${key}`);
  },
}));

// Sane typographic defaults per role — Heading tight and dense (a big
// headline gets cramped/awkward at body-text line spacing), Body roomy
// enough to actually read comfortably, Accent in between. Shown as the
// "Recommended" value next to each slider in the Tracking/Kerning/Leading
// panel; editable from there, not enforced.
const TYPE_SPACING_DEFAULTS = {
  primary: { lineHeight: 1.15, letterSpacing: 0 },
  secondary: { lineHeight: 1.6, letterSpacing: 0 },
  accent: { lineHeight: 1.3, letterSpacing: 0 },
};

const MOCKUP_RENDERERS = {
  social: socialPostMockup,
  "business-card": businessCardMockup,
};

const BOOK_W = 1123;
const BOOK_H = 794;
const BOOK_ROLES = ["primary", "secondary", "accent", "background", "text"];
const BOOK_INK = "#1a1816";

// The book's art styles. "classic" is free; the rest are one-time Rp 20rb
// unlocks per account (api/_plans.js BOOK_STYLE_ADDONS — keep in sync; the
// price here is display only, the charge is looked up server-side). Every
// style renders the SAME page sequence and content — a style is a CSS skin
// (.bbk-style-<key> on the sheet) plus its own display typeface, so a
// locked style can be previewed with the brand's real data before buying.
// `fonts` is a Google Fonts css2 family query; `photo` = takes a background
// photo (a.bookPhoto).
const BOOK_STYLES = [
  { key: "classic", free: true },
  { key: "pop", payKey: "bookstyle-pop", price: 20000, fonts: "Barlow+Condensed:wght@600;800" },
  { key: "scrap", payKey: "bookstyle-scrap", price: 20000, fonts: "Archivo:ital,wght@1,800&family=Caveat:wght@700" },
  { key: "photo", payKey: "bookstyle-photo", price: 20000, fonts: "DM+Serif+Display:ital@0;1", photo: true },
];
const BOOK_STYLE_KEYS = BOOK_STYLES.map((s) => s.key);

const loadedFonts = new Set();
function ensureGoogleFont(family) {
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

// Kept well under Firestore's 1MiB per-document limit — the brand doc also
// carries a logo image and everything else, so one uploaded font file
// (base64 already costs ~33% overhead over its raw size) can't eat that
// whole budget alone. WOFF2 comfortably fits this for a single weight;
// TTF/OTF exports from some foundries won't, hence the friendly nudge.
const MAX_CUSTOM_FONT_BYTES = 500 * 1024;

const loadedCustomFonts = new Set();
function ensureCustomFont(name, dataUrl) {
  if (!name || !dataUrl || loadedCustomFonts.has(name)) return;
  loadedCustomFonts.add(name);
  const style = document.createElement("style");
  style.textContent = `@font-face{ font-family:'${name.replace(/['\\]/g, "")}'; src:url(${dataUrl}); font-display:swap; }`;
  document.head.appendChild(style);
}
// Registers every uploaded font a brand's answers currently reference —
// called from wherever fonts get rendered (the Typography step, and the
// shared typographySectionContent used by live preview/review/PDF) so a
// custom font shows up correctly regardless of which surface renders first
// in a given session.
function ensureCustomFontsFor(a) {
  [a.fonts.primary, a.fonts.secondary, a.fonts.accent].forEach((name) => {
    if (name && a.customFonts[name]) ensureCustomFont(name, a.customFonts[name]);
  });
}

function suggestedApplications(brand) {
  const ids = ["social", "business-card", "website"];
  if ((brand.brandDNA.productsServices || []).length) ids.push("packaging");
  return ids;
}

// Maps the URL section a stage card in brand-builder.js links to (e.g.
// `#/brand/:id/guidelines/logo`) onto a STEPS index — "review" is the one
// virtual step past the end of STEPS. Landing on the bare `/guidelines`
// URL with no section (or an unrecognized one) defaults to Foundation,
// same as before this became independently addressable.
function stepIndexForSection(section) {
  if (section === "review") return STEPS.length;
  const i = STEPS.findIndex((s) => s.key === section);
  return i === -1 ? 0 : i;
}

export function render(root, { brandId, section }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }

  const bg = brand.brandGuidelines || {};
  const state = {
    stepIndex: stepIndexForSection(section),
    // Guided mode opens the Typography step on the ready-made
    // recommendations; downloading fonts elsewhere is the Advanced path.
    showFontRecommender: getMode() === "guided",
    answers: {
      logo: { hasLogo: bg.logo?.hasLogo ?? null, dataUrl: bg.logo?.dataUrl || "", secondaryDataUrl: bg.logo?.secondaryDataUrl || "", logotypeDataUrl: bg.logo?.logotypeDataUrl || "" },
      mascots: bg.mascots || [],
      colorFeelings: bg.colorFeelings || [],
      colorFormula: bg.colorFormula || "",
      colors: { primary: "", secondary: "", accent: "", background: "", text: "", ...(bg.colors || {}) },
      typographyFeelings: bg.typographyFeelings || [],
      fonts: { primary: "", secondary: "", accent: "", ...(bg.fonts || {}) },
      customFonts: { ...(bg.customFonts || {}) },
      extraFonts: bg.extraFonts || [],
      typeSpacing: {
        primary: { ...TYPE_SPACING_DEFAULTS.primary, ...(bg.typeSpacing?.primary || {}) },
        secondary: { ...TYPE_SPACING_DEFAULTS.secondary, ...(bg.typeSpacing?.secondary || {}) },
        accent: { ...TYPE_SPACING_DEFAULTS.accent, ...(bg.typeSpacing?.accent || {}) },
      },
      visualDirection: bg.visualDirection || [],
      moodboard: bg.moodboard || [],
      applications: bg.applications?.length ? bg.applications : suggestedApplications(brand),
      aiCopy: { valueProposition: null, colorEssence: null, ...(bg.aiCopy || {}) },
      bookStyle: BOOK_STYLE_KEYS.includes(bg.bookStyle) ? bg.bookStyle : "classic",
      bookPhoto: bg.bookPhoto || "",
    },
    tone: (() => {
      const tv = brand.brandBuilder?.toneOfVoice || {};
      return { formal: tv.formal ?? 50, language: tv.language ?? 50, character: tv.character ?? 50, emotion: tv.emotion ?? 50, avoidWords: [...(tv.avoidWords || [])], source: tv.source || "" };
    })(),
    toneSample: "",
  };
  const refresh = () => paint(root, brandId, brand, state, refresh);
  refresh();
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
  return () => {};
}

// Every section is independently reachable now (no lock, matching the
// Brand Guidelines hub — see brand-builder.js's `noLock` on that group),
// so this row of tabs is the primary way to move around; Back/Next inside
// each step is just a linear-browsing convenience on top of it, never a
// gate. Keeps the URL hash in sync too, so a direct link from the hub
// (or a page reload) lands on the exact section clicked instead of always
// restarting at Foundation.
// Pemula sees only the two sections the identity gate needs (Warna, Font)
// plus Review; Pro sees the whole book. Every section stays reachable by
// URL in both modes — this only decides which tabs are advertised and
// where Back/Next go.
const GUIDED_STEPS = ["color", "typography"];
function visibleStepIndexes() {
  return STEPS.map((s, i) => i).filter((i) => getMode() !== "guided" || GUIDED_STEPS.includes(STEPS[i].key));
}

function sectionTabsHTML(state, a) {
  const isReview = state.stepIndex >= STEPS.length;
  const visible = visibleStepIndexes();
  const tabs = [
    ...STEPS.filter((s, i) => visible.includes(i)).map((s) => ({ key: s.key, label: s.title, index: STEPS.indexOf(s), done: isStepFilled(s.key, a, state) })),
    { key: "review", label: t("guidelines.step.review"), index: STEPS.length, done: false },
  ];
  return `
    <div class="bb-tab-row">
      ${tabs
        .map((t) => {
          const active = isReview ? t.index === STEPS.length : t.index === state.stepIndex;
          return `
        <button type="button" class="bb-tab ${t.done ? "done" : ""} ${active ? "active" : ""}" data-bb-tab="${t.index}">
          ${t.done ? icon("check", { size: 11 }) : ""}${escapeHtml(t.label)}
        </button>
      `;
        })
        .join("")}
    </div>
  `;
}

// Filled/total across the 6 real steps (Review isn't a "fill this in"
// step, so it's excluded) — same isStepFilled() the tab checkmarks use,
// so this bar and the checkmarks never disagree with each other.
// Only the sections the owner actually fills in count — Foundation is
// copied from Brand DNA and Applications comes pre-suggested, so counting
// them showed "2/6 selesai" before anyone had touched this page.
const PROGRESS_STEP_KEYS = ["logo", "color", "typography", "direction", "tone"];
function guidelinesProgressHTML(state) {
  const keys = PROGRESS_STEP_KEYS;
  const done = keys.filter((k) => isStepFilled(k, state.answers, state)).length;
  const pct = Math.round((done / keys.length) * 100);
  return `
    <div class="bb-progress">
      <div class="bb-progress-bar"><span style="width:${pct}%;"></span></div>
      <span class="bb-progress-label">${t("guidelines.progress", { done, total: keys.length })}</span>
    </div>
  `;
}

function paint(root, brandId, brand, state, refresh) {
  const isReview = state.stepIndex >= STEPS.length;
  const step = isReview ? null : STEPS[state.stepIndex];
  const sectionKey = isReview ? "review" : step.key;
  const url = `#/brand/${brand.id}/guidelines/${sectionKey}`;
  if (location.hash !== url) history.replaceState(null, "", url);

  // 4.2: back goes to whichever page actually leads here now — Pro's hub
  // (the group page it used to point at is gone from the link graph, still
  // reachable by URL only), Pemula's Beranda (the map every step returns
  // to, same as Brand DNA's own back link).
  const backHref = getMode() === "guided" ? `#/brand/${brand.id}` : `#/brand/${brand.id}/builder`;
  const backLabel = getMode() === "guided" ? t("nav.home") : "Brand Builder";
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(backHref, backLabel)} · ${isReview ? t("bg.review.eyebrow") : step.title}${helpButtonHTML("brand-guidelines")}${guideVideoButtonHTML("brand-guidelines")}</div>
        <h1>${brand.name}</h1>
      </div>
      ${guidelinesProgressHTML(state)}
    </div>
    ${sectionTabsHTML(state, state.answers)}
    ${
      isReview
        ? reviewHTML(brand, state)
        : `<div class="brandbook-layout">
             <div class="brandbook-left">${stepHTML(step, state, brand)}</div>
             <div class="brandbook-right">${progressivePreviewHTML(brand, state.answers)}</div>
           </div>`
    }
  `;

  wireHelpButtons(root);
  wireTabs(root, state, refresh);
  if (!isReview) wireStep(root, brandId, brand, state, refresh);
  else wireReview(root, brandId, brand, state, refresh);
}

function wireTabs(root, state, refresh) {
  qsa("[data-bb-tab]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.stepIndex = Number(btn.dataset.bbTab);
      refresh();
    });
  });
}

function isStepFilled(stepKey, a, state) {
  switch (stepKey) {
    // "Belum punya logo" no longer counts as done — the section stays open
    // until a logo (e.g. one generated with ChatGPT) is actually uploaded.
    case "logo": return !!a.logo.dataUrl;
    case "tone": return !!state?.tone?.source;
    case "color": return !!a.colors.primary && !!a.colors.secondary && !!a.colors.accent;
    case "typography": return !!a.fonts.primary && !!a.fonts.secondary;
    case "direction": return a.visualDirection.length > 0;
    case "applications": return a.applications.length > 0;
    default: return true;
  }
}

// Every section here is independently accessible (see sectionTabsHTML) —
// Back/Next are just a convenience for browsing in order, never a gate,
// so unlike the old version there's no "answer this to continue" disabled
// state. The 2nd param is accepted (unused) purely so every existing call
// site below didn't need touching when the gate was removed.
// Saves whatever is on screen, tells Beranda the visual basics just landed
// (that's what unlocks the next journey card there), and goes home. Shared
// by the per-step button and the one on Review so both behave identically.
function goHomeFromGuidelines(brandId, state) {
  updateBrand(brandId, { brandGuidelines: { ...state.answers } });
  markVisualBasicsJustDone(brandId);
  toast(t("guidelines.finishVisual.done"));
  location.hash = `#/brand/${brandId}`;
}

function navHTML(state) {
  // Revisi: "Balik ke Beranda" shows up on every step the moment the
  // essentials (warna + font) are actually filled in — same in both modes.
  // Before this, Pemula's only exit was a Finish button bolted onto the
  // Font step and Pro had none at all, so finishing early meant clicking
  // Lanjut through sections you didn't need yet just to escape. Everything
  // here already persists on change, and this button marks the visual
  // basics done on the way out, so taking it never costs anything.
  const homeReady = isStepFilled("color", state.answers, state) && isStepFilled("typography", state.answers, state);
  return `
    <div class="flex items-center justify-between" style="margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="wiz-back" ${state.stepIndex <= visibleStepIndexes()[0] ? "disabled" : ""}>${icon("chevronLeft", { size: 14 })}${t("common.back")}</button>
      <div class="flex gap-8">
        ${homeReady ? `<button type="button" class="btn btn-secondary" id="wiz-home">${icon("check", { size: 14 })}${t("guidelines.backHome")}</button>` : ""}
        <button type="button" class="btn btn-primary" id="wiz-next">${t("guidelines.next")}${icon("chevronRight", { size: 14 })}</button>
      </div>
    </div>
  `;
}

function chipHTML(value, label, checked, attr) {
  return `<label class="checkbox-chip"><input type="checkbox" ${attr}="${escapeHtml(value)}" ${checked ? "checked" : ""} />${escapeHtml(label)}</label>`;
}

function reviewRow(label, value) {
  if (!value) return "";
  return `<div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0;"><span class="k" style="font-weight:700;">${label}</span><span class="v" style="font-weight:400;text-align:left;">${escapeHtml(value)}</span></div>`;
}

function stepHTML(step, state, brand) {
  switch (step.key) {
    case "foundation": return foundationStepHTML(brand, state);
    case "logo": return logoStepHTML(state, brand);
    case "color": return colorStepHTML(state, brand);
    case "typography": return typographyStepHTML(state, brand);
    case "direction": return directionStepHTML(state, brand);
    case "tone": return toneStepHTML(state);
    case "applications": return applicationsStepHTML(state, brand);
    default: return "";
  }
}

function wireStep(root, brandId, brand, state, refresh) {
  const step = STEPS[state.stepIndex];
  // Back/Next walk the visible sections only (Pemula: Warna → Font → Review).
  qs("#wiz-back", root)?.addEventListener("click", () => {
    const prev = visibleStepIndexes().filter((i) => i < state.stepIndex).pop();
    state.stepIndex = prev ?? state.stepIndex;
    refresh();
  });
  qs("#wiz-next", root)?.addEventListener("click", () => {
    if (qs("#wiz-next", root).disabled) return;
    const next = visibleStepIndexes().find((i) => i > state.stepIndex);
    state.stepIndex = next ?? STEPS.length;
    refresh();
  });
  qs("#wiz-home", root)?.addEventListener("click", () => goHomeFromGuidelines(brandId, state));


  // Sections are now visited independently (no forced order, no single
  // continuous session ending in one Review "Save") — so every field
  // change persists to Firestore immediately instead of buffering until
  // Review, or leaving Logo would silently lose an upload nobody saved.
  // Passed in place of the plain `refresh` each wireXStep below already
  // calls after a mutation, so no change was needed inside any of them.
  const commit = () => {
    updateBrand(brandId, { brandGuidelines: { ...state.answers } });
    refresh();
  };

  if (step.key === "logo") wireLogoStep(root, state, commit);
  if (step.key === "color") wireColorStep(root, state, commit);
  if (step.key === "typography") wireTypographyStep(root, state, commit);
  if (step.key === "direction") wireDirectionStep(root, state, commit);
  if (step.key === "tone") wireToneStep(root, brandId, state, refresh);
  if (step.key === "applications") wireApplicationsStep(root, state, commit);
}

// ---------- Step 1: Foundation (read-only recap of Brand DNA) ----------
function foundationStepHTML(brand, state) {
  const dna = brand.brandDNA;
  return `
    <h2 style="margin-bottom:6px;">${t("guidelines.step.foundation")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 18px;">${t("bg.foundation.sub")}</p>
    <div class="card dark-surface card-tight" style="margin-bottom:14px;">
      ${reviewRow(t("bg.foundation.brandName"), brand.name)}
      ${reviewRow(t("bg.foundation.tagline"), dna.tagline)}
      ${reviewRow(t("bg.foundation.audience"), dna.targetAudience)}
      ${reviewRow(t("bg.foundation.positioning"), dna.positioning)}
      ${dna.personality?.length ? reviewRow(t("bg.foundation.personality"), dna.personality.join(", ")) : ""}
    </div>
    <a href="#/brand/${brand.id}/dna" style="font-size:12.5px;font-weight:700;color:var(--accent);">${t("bg.foundation.editInDna")}</a>
    ${navHTML(state, false)}
  `;
}

// ---------- Step 2: Logo ----------
function logoStepHTML(state, brand) {
  const { hasLogo, dataUrl } = state.answers.logo;
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("guidelines.logo.title")}${helpButtonHTML("term-logo")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("guidelines.logo.sub")}</p>
    <div class="flex gap-8" style="margin-bottom:18px;flex-wrap:wrap;">
      <button type="button" class="btn ${hasLogo === true ? "btn-primary" : "btn-secondary"}" id="logo-yes">${t("guidelines.logo.yes")}</button>
      <button type="button" class="btn ${hasLogo === false ? "btn-primary" : "btn-secondary"}" id="logo-no">${t("guidelines.logo.no")}</button>
    </div>
    ${hasLogo !== null && !dataUrl ? `<div class="warn-box">${icon("info", { size: 15 })}<div><b>${t("guidelines.logo.pending")}</b> ${t("guidelines.logo.uploadAiBody")}</div></div>` : ""}
    ${hasLogo === true ? `
      <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("guidelines.logo.main")}</div>
      <div class="logo-gallery" style="margin-bottom:10px;">
        ${dataUrl
          ? `<div class="logo-thumb"><img src="${dataUrl}" alt="Logo" /><button type="button" class="logo-remove" id="logo-remove">${icon("x", { size: 10 })}</button></div>`
          : `<button type="button" class="logo-add-tile" id="logo-add">${icon("upload", { size: 18 })}</button>`}
      </div>
      <input type="file" id="logo-file" accept="image/*" hidden />
      ${!dataUrl ? `<p class="text-faint" style="font-size:11.5px;">${t("guidelines.logo.pngHint")}</p>` : ""}
      ${dataUrl ? logoVariantSlotsHTML(state) : ""}
      ${logoColorSuggestionHTML(state)}
      ${logoContrastWarningHTML(state)}
    ` : ""}
    ${hasLogo === false ? noLogoGuideHTML(state, brand) : ""}
    ${hasLogo !== null ? mascotsHTML(state) : ""}
    ${navHTML(state, !isStepFilled("logo", state.answers))}
  `;
}

// Independent of hasLogo — a brand can have a mascot with no formal logo
// yet, or a logo with no mascot at all. Each entry is just an image, a
// name, and an optional one-line description; supports more than one
// (some brands run a small mascot family, not a single character).
function mascotsHTML(state) {
  const mascots = state.answers.mascots;
  return `
    <div style="margin-top:20px;">
      <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("bg.mascot.title")} <span class="text-faint" style="font-weight:400;">${t("bg.mascot.optional")}</span></div>
      ${mascots
        .map(
          (m, i) => `
        <div class="card dark-surface card-tight" style="display:flex;gap:12px;align-items:center;margin-bottom:8px;">
          <img src="${m.dataUrl}" alt="${escapeHtml(m.name)}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:var(--surface-2);flex:none;" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${escapeHtml(m.name)}</div>
            ${m.description ? `<div class="text-faint" style="font-size:11.5px;">${escapeHtml(m.description)}</div>` : ""}
          </div>
          <button type="button" class="icon-btn" data-remove-mascot="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 12 })}</button>
        </div>
      `
        )
        .join("")}
      <button type="button" class="btn btn-secondary btn-sm" id="add-mascot">${icon("plus", { size: 12 })}${t("bg.mascot.add")}</button>
      <input type="file" id="mascot-file" accept="image/*" hidden />
    </div>
  `;
}

// Secondary Logo (a simplified/alternate mark) and Logotype (text-only
// wordmark) are both entirely optional — only appear once Main is
// uploaded, and only turn into their own Brand Book page/section (see
// logoVariantsContent) if actually filled in. Skipping them costs nothing.
const LOGO_VARIANT_SLOTS = [
  { key: "secondary", get label() { return t("bg.logo.secondary"); } },
  { key: "logotype", get label() { return t("bg.logo.logotype"); } },
];
function logoVariantSlotsHTML(state) {
  const logo = state.answers.logo;
  return `
    <div class="flex gap-16" style="flex-wrap:wrap;margin:14px 0 10px;">
      ${LOGO_VARIANT_SLOTS.map((s) => {
        const url = logo[`${s.key}DataUrl`];
        return `
        <div>
          <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${s.label} <span class="text-faint" style="font-weight:400;">${t("guidelines.moodboard.optional")}</span></div>
          <div class="logo-gallery">
            ${url
              ? `<div class="logo-thumb"><img src="${url}" alt="${s.label}" /><button type="button" class="logo-remove" data-logo-variant-remove="${s.key}">${icon("x", { size: 10 })}</button></div>`
              : `<button type="button" class="logo-add-tile" data-logo-variant-add="${s.key}">${icon("upload", { size: 18 })}</button>`}
          </div>
          <input type="file" id="logo-variant-file-${s.key}" accept="image/*" hidden />
        </div>
      `;
      })
      .join("")}
    </div>
  `;
}

// A concrete "go make one yourself" path instead of just pointing at the
// paid WPK service — sketch on paper first (forces an actual idea to
// exist before asking AI to guess one), upload that sketch to ChatGPT
// along with a ready-made prompt, so there's a real starting point to
// react to instead of a blank "draw me a logo" request.
function logoAiPromptText(brand, a) {
  const personality = brand.brandBuilder?.personality?.primary?.length ? brand.brandBuilder.personality.primary.join(", ") : "";
  const desc = brand.businessDescription || brand.brandDNA?.positioning || "";
  const colorLine = a.colors.primary
    ? a.colors.secondary
      ? t("bg.logoPrompt.color2", { primary: a.colors.primary, secondary: a.colors.secondary })
      : t("bg.logoPrompt.color1", { primary: a.colors.primary })
    : "";
  return [
    desc ? t("bg.logoPrompt.introDesc", { name: brand.name, desc }) : t("bg.logoPrompt.intro", { name: brand.name }),
    personality ? t("bg.logoPrompt.personality", { traits: personality }) : "",
    t("bg.logoPrompt.style"),
    `${t("bg.logoPrompt.form")}${colorLine ? `\n${colorLine}` : ""}`,
    t("bg.logoPrompt.sketch"),
    t("bg.logoPrompt.variations"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// **bold** → <b>, everything else escaped.
const richText = (text) => escapeHtml(text || "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

// "Belum punya" doesn't end the section any more: generate one with
// ChatGPT (prompt + link), then upload it right here. Until a logo is
// uploaded the Logo section — and the Brand Builder stage — stay unfinished.
function noLogoGuideHTML(state, brand) {
  const prompt = logoAiPromptText(brand, state.answers);
  return `
    <div class="card dark-surface card-tight" style="font-size:12.5px;line-height:1.6;color:var(--text-muted);margin-bottom:12px;">
      <p style="margin:0 0 8px;">${richText(t("guidelines.logo.forms"))}</p>
      <p style="margin:0;">${t("guidelines.logo.flat")}</p>
    </div>
    <div class="card dark-surface" style="margin-bottom:12px;">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:12px;">${icon("bot", { size: 13 })} ${t("guidelines.logo.chatgptTitle")}</div>
      <ol style="margin:0 0 14px;padding-left:18px;font-size:12.5px;line-height:1.9;color:var(--text-muted);">
        <li>${t("guidelines.logo.chatgptS1")}</li>
        <li>${t("guidelines.logo.chatgptS2")}</li>
        <li>${t("guidelines.logo.chatgptS3")}</li>
        <li>${t("guidelines.logo.chatgptS4")}</li>
      </ol>
      <pre id="logo-ai-prompt" style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.6;background:var(--surface-2);border-radius:var(--radius-md);padding:14px;margin:0 0 10px;color:var(--text);">${escapeHtml(prompt)}</pre>
      <div class="flex gap-8" style="flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" id="copy-logo-prompt">${icon("copy", { size: 12 })}${t("guidelines.logo.copyPrompt")}</button>
        <a class="btn btn-primary btn-sm" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">${icon("bot", { size: 12 })}${t("guidelines.logo.openChatgpt")} ↗</a>
      </div>
    </div>
    <div class="card dark-surface logo-ai-upload">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:4px;">${icon("upload", { size: 13 })} ${t("guidelines.logo.uploadAiTitle")}</div>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">${t("guidelines.logo.uploadAiBody")} ${t("guidelines.logo.pngHint")}</p>
      <div class="logo-gallery"><button type="button" class="logo-add-tile" id="logo-add-ai" aria-label="${t("guidelines.logo.uploadAiTitle")}">${icon("upload", { size: 18 })}</button></div>
      <input type="file" id="logo-file-ai" accept="image/*" hidden />
    </div>
  `;
}

// Once a logo exists, offer the colors it's actually made of instead of
// making someone start the Color section from a blank hex field — reuses
// the same extractColorsFromImage() the Color step's own "Ekstrak dari
// foto" button already runs, just triggered automatically right here
// instead of requiring a second manual upload of the same image.
function logoColorSuggestionHTML(state) {
  if (!state.suggestedPaletteFromLogo?.length) return "";
  return `
    <div class="card dark-surface card-tight" style="margin-top:12px;">
      <div class="flex items-center justify-between" style="margin-bottom:10px;">
        <span style="font-size:12.5px;font-weight:700;">${icon("palette", { size: 13 })} ${t("bg.logo.fromLogoTitle")}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="use-logo-palette">${t("bg.logo.useForColor")}</button>
      </div>
      <div class="bb-palette-row" style="margin-bottom:0;">${state.suggestedPaletteFromLogo.map((c) => `<div class="bb-swatch" style="background:${c};" title="${c}"></div>`).join("")}</div>
    </div>
  `;
}

// Same contrastRatio() math the Color step's Accessibility check already
// uses, aimed at the logo instead of body text — a logo is graphic, not
// text, so this uses a looser bar (2.5:1, "visually distinct enough to
// not disappear") than the 4.5:1 WCAG-AA bar for readable text.
function logoContrastWarnings(a, palette) {
  if (!palette?.length) return [];
  const roles = [
    { key: "background", label: t("bg.role.background") },
    { key: "primary", label: t("bg.role.primary") },
  ].filter((r) => a.colors[r.key]);
  const warnings = [];
  for (const role of roles) {
    let worst = null;
    for (const logoHex of palette) {
      const ratio = contrastRatio(logoHex, a.colors[role.key]);
      if (ratio < 2.5 && (!worst || ratio < worst.ratio)) worst = { logoHex, ratio };
    }
    if (worst) warnings.push({ role: role.label, ...worst });
  }
  return warnings;
}

function logoContrastWarningHTML(state) {
  const a = state.answers;
  const warnings = logoContrastWarnings(a, state.suggestedPaletteFromLogo);
  if (!warnings.length) return "";
  return `
    <div style="display:flex;gap:8px;align-items:flex-start;background:var(--health-average-soft);color:var(--health-average);border-radius:var(--radius-md);padding:10px 12px;font-size:11.5px;line-height:1.6;margin-top:12px;">
      ${icon("info", { size: 14 })}
      <span>${warnings.map((w) => escapeHtml(t("bg.logo.contrastWarn", { role: w.role, ratio: w.ratio.toFixed(1) }))).join(" ")}</span>
    </div>
  `;
}

function wireLogoStep(root, state, refresh) {
  // Lazily (re)loads the logo's own color palette whenever a logo exists
  // but nothing's cached yet — covers both "just uploaded" (the upload
  // handler below also sets it directly) and "came back to this step in a
  // later session" (state.suggestedPaletteFromLogo is never persisted,
  // only the logo image itself is), so the contrast check further down
  // always has something to compare against once a logo exists.
  if (state.answers.logo.dataUrl && !state.suggestedPaletteFromLogo && !state.logoPaletteLoading) {
    state.logoPaletteLoading = true;
    extractColorsFromImage(state.answers.logo.dataUrl, 5)
      .then((palette) => { state.suggestedPaletteFromLogo = palette; state.logoPaletteLoading = false; refresh(); })
      .catch(() => { state.logoPaletteLoading = false; });
  }
  qs("#logo-yes", root)?.addEventListener("click", () => { state.answers.logo.hasLogo = true; refresh(); });
  qs("#logo-no", root)?.addEventListener("click", () => { state.answers.logo.hasLogo = false; state.answers.logo.dataUrl = ""; refresh(); });
  // Both the "Sudah punya" tile and the "upload hasil generate" tile land
  // here; an uploaded logo always means hasLogo = true from then on.
  const uploadMainLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.answers.logo.dataUrl = await resizeImageFile(file, { maxDimension: 600 });
    state.answers.logo.hasLogo = true;
    refresh();
    toast(t("guidelines.logo.saved"));
    try {
      state.suggestedPaletteFromLogo = await extractColorsFromImage(state.answers.logo.dataUrl, 5);
      refresh();
    } catch {
      // Logo still saved fine either way — the suggestion is a bonus, not
      // something worth blocking or erroring the whole step over.
    }
  };
  qs("#logo-add", root)?.addEventListener("click", () => qs("#logo-file", root).click());
  qs("#logo-file", root)?.addEventListener("change", uploadMainLogo);
  qs("#logo-add-ai", root)?.addEventListener("click", () => qs("#logo-file-ai", root).click());
  qs("#logo-file-ai", root)?.addEventListener("change", uploadMainLogo);
  qs("#logo-remove", root)?.addEventListener("click", () => { state.answers.logo.dataUrl = ""; state.suggestedPaletteFromLogo = null; refresh(); });
  LOGO_VARIANT_SLOTS.forEach((s) => {
    qs(`[data-logo-variant-add="${s.key}"]`, root)?.addEventListener("click", () => qs(`#logo-variant-file-${s.key}`, root).click());
    qs(`#logo-variant-file-${s.key}`, root)?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      state.answers.logo[`${s.key}DataUrl`] = await resizeImageFile(file, { maxDimension: 600 });
      refresh();
    });
    qs(`[data-logo-variant-remove="${s.key}"]`, root)?.addEventListener("click", () => {
      state.answers.logo[`${s.key}DataUrl`] = "";
      refresh();
    });
  });
  qs("#add-mascot", root)?.addEventListener("click", () => qs("#mascot-file", root).click());
  qs("#mascot-file", root)?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = await promptDialog({ title: t("bg.mascot.nameTitle"), label: t("bg.mascot.nameLabel"), placeholder: t("bg.mascot.namePlaceholder"), confirmLabel: t("guidelines.next") });
    if (!name) { e.target.value = ""; return; }
    const description = await promptDialog({ title: t("bg.mascot.descTitle", { name }), label: t("bg.mascot.descLabel"), placeholder: t("bg.mascot.descPlaceholder"), confirmLabel: t("bg.mascot.save") });
    e.target.value = "";
    const dataUrl = await resizeImageFile(file, { maxDimension: 500 });
    state.answers.mascots = [...state.answers.mascots, { name, description: description || "", dataUrl }];
    refresh();
    toast(t("bg.added", { name }));
  });
  qsa("[data-remove-mascot]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.answers.mascots = state.answers.mascots.filter((_, i) => i !== Number(btn.dataset.removeMascot));
      refresh();
    });
  });
  qs("#use-logo-palette", root)?.addEventListener("click", () => {
    const [primary, secondary, accent, background, text] = state.suggestedPaletteFromLogo;
    state.answers.colors = { primary, secondary: secondary || primary, accent: accent || primary, background: background || "#ffffff", text: text || "#1a1816" };
    refresh();
    toast(t("bg.logo.paletteApplied"));
  });
  qs("#copy-logo-prompt", root)?.addEventListener("click", async () => {
    const text = qs("#logo-ai-prompt", root)?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      toast(t("guidelines.logo.promptCopied"));
    } catch {
      toast(t("bg.copyFail"), "error");
    }
  });
}

function colorStepHTML(state, brand) {
  const a = state.answers;
  const formula = a.colorFormula || "";
  const baseHex = a.colors.primary || "";
  const computed = formula && baseHex ? generatePaletteFromBase(baseHex, formula) : null;
  const chips = COLOR_FEELINGS.map((f) => chipHTML(f, feelingLabel(f), a.colorFeelings.includes(f), "data-feeling")).join("");
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("bg.color.title")}${helpButtonHTML("term-color")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("bg.color.sub")}</p>

    <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">${t("bg.color.pickFeeling")}</div>
    <div class="bb-chip-row" style="margin-bottom:10px;">${chips}</div>

    <details class="mb-explain" style="margin-bottom:16px;">
      <summary>${icon("gear", { size: 14 })}${t("bg.color.manualDetails")}</summary>
      <div style="font-size:12.5px;font-weight:700;margin:12px 0 8px;">${t("bg.color.step1")}</div>
      <div class="flex gap-8" style="flex-wrap:wrap;margin-bottom:14px;">
        ${COLOR_FORMULA_INFO.map(
          (f) => `
          <label class="card dark-surface card-tight" style="cursor:pointer;flex:1;min-width:190px;${formula === f.key ? "border-color:var(--accent);" : ""}">
            <input type="radio" name="color-formula" value="${f.key}" data-formula ${formula === f.key ? "checked" : ""} style="position:absolute;opacity:0;" />
            <div style="font-weight:800;font-size:13px;margin-bottom:4px;">${f.label}</div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">${f.desc}</div>
            <div style="font-size:10.5px;color:var(--text-faint);">${f.kesan}</div>
          </label>
        `
        ).join("")}
      </div>

      <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">${t("bg.color.step2")}</div>
      <div class="flex gap-8 items-center" style="flex-wrap:wrap;margin-bottom:10px;">
        <input class="input" id="color-base-hex" placeholder="#161616" value="${escapeHtml(baseHex)}" style="width:120px;font-family:ui-monospace,monospace;" />
        ${window.EyeDropper ? `<button type="button" class="btn btn-secondary btn-sm" id="base-eyedrop">${icon("eye", { size: 12 })}${t("bg.color.sample")}</button>` : ""}
        <button type="button" class="btn btn-secondary btn-sm" id="btn-extract-photo">${icon("image", { size: 12 })}${t("bg.color.extract")}</button>
        <input type="file" id="photo-extract-file" accept="image/*" hidden />
      </div>
      ${
        state.extractedColors?.length
          ? `
        <div class="card dark-surface card-tight" style="margin-bottom:0;">
          <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("bg.color.fromPhoto")}</div>
          <div class="bb-palette-row" style="margin-bottom:10px;">${state.extractedColors.map((c, i) => `<div class="bb-swatch" data-extracted-swatch="${i}" title="${escapeHtml(t("bg.color.swatchUse", { hex: c }))}" style="background:${c};cursor:pointer;"></div>`).join("")}</div>
          <button type="button" class="btn btn-secondary" id="use-extracted-palette">${t("bg.color.useFive")}</button>
        </div>
      `
          : ""
      }
    </details>
    ${
      computed
        ? `
      <div class="card dark-surface card-tight" style="margin-bottom:16px;">
        <div class="flex items-center justify-between" style="margin-bottom:10px;">
          <span style="font-size:12.5px;font-weight:700;">${escapeHtml(t("bg.color.autoPalette", { formula: COLOR_FORMULA_INFO.find((f) => f.key === formula)?.label || formula }))}</span>
          <button type="button" class="btn btn-secondary" id="use-computed-palette" style="padding:6px 12px;font-size:11.5px;">${t("bg.color.usePalette")}</button>
        </div>
        <div class="bb-palette-row">${["primary", "secondary", "accent", "background", "text"].map((k) => `<div class="bb-swatch" style="background:${computed[k]};" title="${roleLabel(k)}"></div>`).join("")}</div>
      </div>
    `
        : `<p class="text-faint" style="font-size:12px;margin-bottom:16px;">${formula ? t("bg.color.hintBase") : t("bg.color.hintBoth")}</p>`
    }
    <div class="card dark-surface card-tight" style="margin-bottom:8px;">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:2px;">${t("bg.color.customize")}</div>
      <p class="text-faint" style="font-size:11px;margin:0 0 10px;">${t("bg.color.typeHexHint")}</p>
      <div class="bb-color-main-row">${["primary", "secondary", "accent"].map((k) => colorFieldHTML(k, a.colors[k], true)).join("")}</div>
      <div class="text-faint" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin:14px 0 8px;">${t("bg.color.supporting")}</div>
      ${["background", "text"].map((k) => colorFieldHTML(k, a.colors[k], false)).join("")}
    </div>
    <p class="text-faint" style="font-size:11px;margin:0 0 8px;">${t("bg.color.inspiration")} <a href="https://coolors.co" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700;">Coolors ↗</a> · <a href="https://colorhunt.co" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700;">Color Hunt ↗</a></p>
    ${navHTML(state, !isStepFilled("color", a))}
  `;
}

// Display name for a palette role key (primary/secondary/accent/background/text).
function roleLabel(key) {
  return t(`bg.role.${key}`);
}

// The hex is a text box, not a read-only caption: brands almost always
// arrive with the code already written down somewhere (a designer's note, a
// previous logo file, a Coolors link), and hunting for it on a color wheel
// is both slower and less exact than typing the six characters you have.
// Accepts #abc, #aabbcc or bare aabbcc — wireColorStep normalizes it.
function hexInputHTML(key, value) {
  return `<input class="input bb-hex-input" type="text" data-hex="${key}" value="${value.toUpperCase()}" maxlength="7" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${escapeHtml(t("bg.color.hexLabel", { role: roleLabel(key) }))}" />`;
}

function colorFieldHTML(key, hex, big) {
  const value = hex || "#cccccc";
  const rgb = hexToRgb(value);
  const cmyk = hexToCmyk(value);
  if (big) {
    return `
      <div class="bb-color-main-card">
        ${window.EyeDropper ? `<button type="button" class="icon-btn" data-eyedrop="${key}" title="${t("bg.color.eyedropTitle")}">${icon("eye", { size: 13 })}</button>` : ""}
        <input type="color" id="color-${key}" value="${value}" />
        <div class="bb-color-main-label">${roleLabel(key)}</div>
        ${hexInputHTML(key, value)}
      </div>
    `;
  }
  return `
    <div class="bb-color-field">
      <input type="color" id="color-${key}" value="${value}" />
      <div style="flex:1;min-width:0;">
        <div style="font-size:12.5px;font-weight:700;">${roleLabel(key)}</div>
        <div class="bb-color-code">RGB ${rgb.r},${rgb.g},${rgb.b} · CMYK ${cmyk.c},${cmyk.m},${cmyk.y},${cmyk.k}</div>
      </div>
      ${hexInputHTML(key, value)}
      ${window.EyeDropper ? `<button type="button" class="icon-btn" data-eyedrop="${key}" title="${t("bg.color.eyedropTitle")}">${icon("eye", { size: 14 })}</button>` : ""}
    </div>
  `;
}

// "#1a1816", "1a1816", "#abc", " #ABC " → "#1a1816" / "#aabbcc"; anything
// else → null, so the caller can restore instead of storing garbage.
function normalizeHex(raw) {
  const v = String(raw || "").trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return null;
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return `#${full.toLowerCase()}`;
}

function wireColorStep(root, state, refresh) {
  // Picking a feeling now just sets the base color (its anchor hex from
  // COLOR_PALETTES) — the formula is a separate, explicit choice above, per
  // the e-book's own two-step sequence (pick the formula, then lock a hex).
  qsa("[data-feeling]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const f = el.dataset.feeling;
      const set = new Set(state.answers.colorFeelings);
      if (el.checked) set.add(f); else set.delete(f);
      state.answers.colorFeelings = [...set];
      const anchor = COLOR_PALETTES[f]?.[0];
      if (el.checked && anchor) {
        state.answers.colors.primary = anchor.primary;
        if (!state.answers.colorFormula) state.answers.colorFormula = anchor.formula;
      }
      refresh();
    });
  });
  qsa("[data-formula]", root).forEach((el) => {
    el.addEventListener("change", () => {
      state.answers.colorFormula = el.value;
      refresh();
    });
  });
  qs("#color-base-hex", root)?.addEventListener("change", (e) => {
    const parsed = normalizeHex(e.target.value);
    if (parsed) state.answers.colors.primary = parsed;
    else if (e.target.value.trim()) toast(t("bg.color.hexInvalid"), "error");
    refresh();
  });
  qs("#base-eyedrop", root)?.addEventListener("click", async () => {
    try {
      const result = await new window.EyeDropper().open();
      state.answers.colors.primary = result.sRGBHex;
      refresh();
    } catch {
      // cancelled
    }
  });
  qs("#btn-extract-photo", root)?.addEventListener("click", () => qs("#photo-extract-file", root).click());
  qs("#photo-extract-file", root)?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await fileToDataURL(file);
      state.extractedColors = await extractColorsFromImage(dataUrl, 5);
      refresh();
    } catch {
      toast(t("bg.color.extractFail"), "error");
    }
  });
  qsa("[data-extracted-swatch]", root).forEach((el) => {
    el.addEventListener("click", () => {
      state.answers.colors.primary = state.extractedColors[Number(el.dataset.extractedSwatch)];
      refresh();
    });
  });
  qs("#use-extracted-palette", root)?.addEventListener("click", () => {
    const [primary, secondary, accent, background, text] = state.extractedColors;
    state.answers.colors = { primary, secondary: secondary || primary, accent: accent || primary, background: background || "#ffffff", text: text || "#1a1816" };
    refresh();
  });
  qs("#use-computed-palette", root)?.addEventListener("click", () => {
    if (!state.answers.colorFormula || !state.answers.colors.primary) return;
    const computed = generatePaletteFromBase(state.answers.colors.primary, state.answers.colorFormula);
    state.answers.colors = computed;
    refresh();
  });
  ["primary", "secondary", "accent", "background", "text"].forEach((k) => {
    qs(`#color-${k}`, root)?.addEventListener("change", (e) => {
      state.answers.colors[k] = e.target.value;
      refresh();
    });
  });
  // Typed hex codes. "change" (blur/Enter) rather than "input" on purpose:
  // repainting on every keystroke would rip the field out from under the
  // cursor halfway through typing "#1a1816". Enter commits early; anything
  // that isn't a valid hex is put back to the saved value rather than
  // silently wiping the color.
  qsa("[data-hex]", root).forEach((el) => {
    const commitHex = () => {
      const key = el.dataset.hex;
      const parsed = normalizeHex(el.value);
      if (!parsed) {
        el.value = (state.answers.colors[key] || "#cccccc").toUpperCase();
        toast(t("bg.color.hexInvalid"), "error");
        return;
      }
      state.answers.colors[key] = parsed;
      refresh();
    };
    el.addEventListener("change", commitHex);
    // Enter commits on the spot rather than going through blur() — a valid
    // code repaints the step, which detaches this node, so the "change"
    // above never double-fires.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      commitHex();
    });
  });
  // EyeDropper API — samples a real pixel color from anywhere on screen
  // (the uploaded logo, a reference image in another tab, etc.), not just
  // a color wheel. Chromium-only for now; the button only renders when
  // window.EyeDropper exists (see colorFieldHTML), so this never runs on
  // browsers without it.
  qsa("[data-eyedrop]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const result = await new window.EyeDropper().open();
        state.answers.colors[btn.dataset.eyedrop] = result.sRGBHex;
        refresh();
      } catch {
        // user pressed Escape / cancelled — nothing to do
      }
    });
  });
}

// Downsamples the image to a small grid, quantizes each pixel to a coarse
// color step, and returns the N most frequent distinct colors — a real
// (if simple) palette extraction rather than the single blended average
// getDominantColor() in dom.js returns elsewhere in the app.
function colorDistance(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
function extractColorsFromImage(dataUrl, count = 5) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const size = 80;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      let data;
      try {
        data = ctx.getImageData(0, 0, size, size).data;
      } catch (err) {
        reject(err);
        return;
      }
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue; // skip near-transparent pixels
        const r = Math.round(data[i] / 24) * 24;
        const g = Math.round(data[i + 1] / 24) * 24;
        const b = Math.round(data[i + 2] / 24) * 24;
        const key = `${r},${g},${b}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      const sorted = [...buckets.entries()].sort((x, y) => y[1] - x[1]);
      const hexes = [];
      for (const [key] of sorted) {
        const [r, g, b] = key.split(",").map(Number);
        const hex = `#${[r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("")}`;
        if (!hexes.some((h) => colorDistance(h, hex) < 40)) hexes.push(hex);
        if (hexes.length >= count) break;
      }
      resolve(hexes);
    };
    img.src = dataUrl;
  });
}

// ---------- Step 4: Typography ----------
const FONT_SOURCE_LINKS = [
  { label: "Google Fonts", url: "https://fonts.google.com/" },
  { label: "DaFont", url: "https://www.dafont.com/" },
  { label: "Envato Elements", url: PREMIUM_FONT_LINK },
];

// The old flow picked one "feeling" and immediately auto-filled a specific
// font pairing (Caveat/Poppins etc). Per the e-book's own approach, this
// now only ever recommends a TYPE of font (Serif, Sans Serif, ...) from a
// sector lookup — never a specific family — and it's tucked behind a
// "Wepeka Rekomendasi" toggle for whoever's stuck, not shown by default,
// since most people already know roughly what they want once they've
// browsed Google Fonts/DaFont/Envato (now the first thing on this step).
function typographyStepHTML(state, brand) {
  const a = state.answers;
  if (a.fonts.primary) ensureGoogleFont(a.fonts.primary);
  if (a.fonts.secondary) ensureGoogleFont(a.fonts.secondary);
  if (a.fonts.accent) ensureGoogleFont(a.fonts.accent);
  ensureCustomFontsFor(a);
  const fontOptions = (selected) => {
    const inLibrary = selected && FONT_LIBRARY.some((f) => f.family === selected);
    const isCustom = selected && !inLibrary && a.customFonts[selected];
    const isRecommended = selected && !inLibrary && !isCustom;
    return (
      FONT_LIBRARY.map((f) => `<option value="${f.family}" ${selected === f.family ? "selected" : ""}>${f.family} (${f.category})</option>`).join("") +
      (isCustom ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} ${t("bg.type.uploaded")}</option>` : "") +
      (isRecommended ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} ${t("bg.type.recommended")}</option>` : "")
    );
  };
  const uploadRow = (role, label) => `
    <div class="field">
      <label>${label}</label>
      <div class="flex gap-8">
        <select class="select" id="font-${role}" style="flex:1;">${role === "accent" ? `<option value="">${t("bg.type.none")}</option>` : `<option value="">${t("bg.type.choose")}</option>`}${fontOptions(a.fonts[role])}</select>
        <button type="button" class="btn btn-secondary" id="upload-font-${role}" title="${t("bg.type.uploadTitle")}" style="flex:none;padding:0 12px;">${icon("upload", { size: 13 })}</button>
        <input type="file" id="font-file-${role}" accept=".ttf,.otf,.woff,.woff2,font/*" hidden />
      </div>
    </div>
  `;
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("bg.type.title")}${helpButtonHTML("term-typography")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${t("bg.type.sub")}</p>

    ${fontRecommenderHTML(state, brand)}

    <p class="text-faint" style="font-size:11.5px;margin:0 0 8px;">${t("bg.type.moreFonts")}</p>
    <div class="flex gap-8" style="flex-wrap:wrap;margin-bottom:18px;">
      ${FONT_SOURCE_LINKS.map((s) => `<a href="${s.url}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="text-decoration:none;">${icon("link", { size: 12 })}${escapeHtml(s.label)}</a>`).join("")}
    </div>

    <p class="text-faint" style="font-size:11px;margin:20px 0 8px;">${t("bg.type.uploadHint", { icon: icon("upload", { size: 10 }) })}</p>
    ${uploadRow("primary", t("bg.type.primary"))}
    ${uploadRow("secondary", t("bg.type.secondary"))}
    ${uploadRow("accent", t("bg.type.accent"))}
    ${extraFontsHTML(a)}
    ${navHTML(state, !isStepFilled("typography", a))}
  `;
}

// Beyond the fixed Primary/Secondary/Accent roles — a decorative font, a
// second script, whatever the brand actually has. Each one just needs a
// label (what to call it) and a font file; it reuses the exact same
// customFonts registry the 3 fixed roles already use, and gets its own
// specimen page in the PDF (extraFontSpecimenPageHTML) the same shape as
// the others.
function extraFontsHTML(a) {
  return `
    <div style="margin-top:18px;">
      <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("bg.type.extraTitle")} <span class="text-faint" style="font-weight:400;">${t("bg.type.extraOptional")}</span></div>
      ${a.extraFonts
        .map(
          (f, i) => `
        <div class="flex items-center justify-between" style="padding:9px 12px;background:var(--surface-2);border-radius:var(--radius-md);margin-bottom:6px;">
          <span style="font-family:'${escapeHtml(f.family)}';font-size:13.5px;">${escapeHtml(f.label)} <span class="text-faint" style="font-family:inherit;font-size:11px;">— ${escapeHtml(f.family)}</span></span>
          <button type="button" class="icon-btn" data-remove-extra-font="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 12 })}</button>
        </div>
      `
        )
        .join("")}
      <button type="button" class="btn btn-secondary btn-sm" id="add-extra-font" style="margin-top:6px;">${icon("plus", { size: 12 })}${t("bg.type.addExtra")}</button>
      <input type="file" id="extra-font-file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden />
    </div>
  `;
}

function fontRecommenderHTML(state, brand) {
  const a = state.answers;
  if (!state.showFontRecommender) {
    return `<button type="button" class="btn btn-secondary" id="toggle-font-recommender" style="margin-bottom:18px;">${icon("bulb", { size: 13 })}${t("bg.type.recToggle")}</button>`;
  }
  const category = FONT_CATEGORIES.find((c) => c.key === state.fontRecommenderCategory);
  const chips = TYPOGRAPHY_FEELINGS.map((f) => chipHTML(f, feelingLabel(f), a.typographyFeelings.includes(f), "data-feeling")).join("");
  return `
    <div class="card dark-surface card-tight" style="margin-bottom:18px;">
      <div class="flex items-center justify-between" style="margin-bottom:12px;">
        <span style="font-size:12.5px;font-weight:700;">${t("bg.type.recTitle")}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="toggle-font-recommender">${icon("x", { size: 11 })}${t("common.close")}</button>
      </div>
      <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("bg.type.vibes")}</div>
      <div class="bb-chip-row">${chips}</div>
      <div style="font-size:11.5px;font-weight:700;margin:6px 0 8px;">${t("bg.type.sectorQ")}</div>
      <div class="bb-chip-row" style="margin-bottom:${category ? "14px" : "0"};">
        ${FONT_CATEGORY_SECTORS.map((s) => `<label class="checkbox-chip"><input type="radio" name="font-sector" data-sector value="${escapeHtml(s.sector)}" ${state.fontRecommenderSector === s.sector ? "checked" : ""} />${escapeHtml(s.sector)}</label>`).join("")}
      </div>
      ${category ? fontCategoryRecommendationHTML(category) : `<p class="text-faint" style="font-size:11.5px;margin:0;">${t("bg.type.sectorHint")}</p>`}
    </div>
  `;
}

// Once a category is picked, don't stop at the type name — point to where
// to actually pick a font of that type, and offer one ready-made
// primary+secondary combo (real Google Fonts, live-previewed) so there's
// something concrete to apply instead of a label to go research alone.
function fontCategoryRecommendationHTML(category) {
  const pairing = FONT_CATEGORY_PAIRINGS[category.key];
  if (pairing) { ensureGoogleFont(pairing.primary); ensureGoogleFont(pairing.secondary); }
  return `
    <div class="card dark-surface card-tight" style="background:var(--surface-2);">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:4px;">${escapeHtml(t("bg.type.catFit", { label: category.label }))}</div>
      <div class="text-muted" style="font-size:12px;margin-bottom:10px;">${escapeHtml(category.desc)}</div>
      <a href="${category.googleFontsUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="text-decoration:none;margin-bottom:${pairing ? "14px" : "0"};">${icon("link", { size: 12 })}${escapeHtml(t("bg.type.catBrowse", { label: category.label }))}</a>
      ${
        pairing
          ? `
        <div style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("bg.type.pairTitle")}</div>
        <div class="flex items-center justify-between" style="gap:10px;padding:10px 12px;background:var(--surface-1);border-radius:var(--radius-md);margin-bottom:8px;">
          <div>
            <div style="font-family:'${escapeHtml(pairing.primary)}';font-size:16px;">${escapeHtml(pairing.primary)}</div>
            <div style="font-family:'${escapeHtml(pairing.secondary)}';font-size:12.5px;color:var(--text-muted);margin-top:2px;">${escapeHtml(pairing.secondary)} — ${t("bg.type.forBody")}</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="apply-font-pairing" data-primary="${escapeHtml(pairing.primary)}" data-secondary="${escapeHtml(pairing.secondary)}">${t("bg.type.usePair")}</button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

function wireTypographyStep(root, state, refresh) {
  qs("#toggle-font-recommender", root)?.addEventListener("click", () => {
    state.showFontRecommender = !state.showFontRecommender;
    refresh();
  });
  qsa("[data-feeling]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const f = el.dataset.feeling;
      const set = new Set(state.answers.typographyFeelings);
      if (el.checked) set.add(f); else set.delete(f);
      state.answers.typographyFeelings = [...set];
      refresh();
    });
  });
  qsa("[data-sector]", root).forEach((el) => {
    el.addEventListener("change", () => {
      state.fontRecommenderSector = el.value;
      state.fontRecommenderCategory = FONT_CATEGORY_SECTORS.find((s) => s.sector === el.value)?.categoryKey || "";
      refresh();
    });
  });
  qs("#apply-font-pairing", root)?.addEventListener("click", (e) => {
    state.answers.fonts.primary = e.currentTarget.dataset.primary;
    state.answers.fonts.secondary = e.currentTarget.dataset.secondary;
    toast(t("bg.type.pairApplied"));
    refresh();
  });
  ["primary", "secondary", "accent"].forEach((role) => {
    qs(`#font-${role}`, root)?.addEventListener("change", (e) => { state.answers.fonts[role] = e.target.value; refresh(); });
    qs(`#upload-font-${role}`, root)?.addEventListener("click", () => qs(`#font-file-${role}`, root).click());
    qs(`#font-file-${role}`, root)?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > MAX_CUSTOM_FONT_BYTES) {
        toast(t("bg.type.tooBig", { size: Math.round(file.size / 1024) }), "error");
        e.target.value = "";
        return;
      }
      const defaultName = file.name.replace(/\.(ttf|otf|woff2?|)$/i, "").trim() || "Custom Font";
      const name = await promptDialog({ title: t("bg.type.nameTitle"), label: t("bg.type.nameLabel"), placeholder: defaultName, value: defaultName, confirmLabel: t("bg.type.useFont") });
      e.target.value = "";
      if (!name) return;
      const dataUrl = await fileToDataURL(file);
      state.answers.customFonts[name] = dataUrl;
      state.answers.fonts[role] = name;
      ensureCustomFont(name, dataUrl);
      refresh();
      toast(t("bg.added", { name }));
    });
  });
  qs("#add-extra-font", root)?.addEventListener("click", () => qs("#extra-font-file", root).click());
  qs("#extra-font-file", root)?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_CUSTOM_FONT_BYTES) {
      toast(t("bg.type.tooBig", { size: Math.round(file.size / 1024) }), "error");
      e.target.value = "";
      return;
    }
    const label = await promptDialog({ title: t("bg.type.extraKindTitle"), label: t("bg.type.extraKindLabel"), placeholder: t("bg.type.extraKindDefault"), value: t("bg.type.extraKindDefault"), confirmLabel: t("guidelines.next") });
    e.target.value = "";
    if (!label) return;
    const defaultName = file.name.replace(/\.(ttf|otf|woff2?|)$/i, "").trim() || label;
    const dataUrl = await fileToDataURL(file);
    state.answers.customFonts[defaultName] = dataUrl;
    state.answers.extraFonts = [...state.answers.extraFonts, { label, family: defaultName }];
    ensureCustomFont(defaultName, dataUrl);
    refresh();
    toast(t("bg.added", { name: label }));
  });
  qsa("[data-remove-extra-font]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.answers.extraFonts = state.answers.extraFonts.filter((_, i) => i !== Number(btn.dataset.removeExtraFont));
      refresh();
    });
  });
}

// ---------- Step 5: Visual Direction ----------

function directionStepHTML(state, brand) {
  const a = state.answers;
  const chips = Object.keys(VISUAL_DIRECTIONS).map((k) => chipHTML(k, directionLabel(k), a.visualDirection.includes(k), "data-direction")).join("");
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("guidelines.direction.title")}${helpButtonHTML("term-direction")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 6px;">${t("guidelines.direction.sub")}</p>
    <div class="bb-chip-row">${chips}</div>
    ${a.visualDirection.map((d) => `<p class="bb-direction-desc"><strong>${escapeHtml(directionLabel(d))}</strong> — ${escapeHtml(directionDescription(d))}</p>`).join("")}
    ${moodboardHTML(state, brand)}
    ${navHTML(state, !isStepFilled("direction", a))}
  `;
}

// Painted example tiles for a coffee shop (CSS gradients, no image files),
// so "moodboard" means something before anyone goes looking for photos.
const MOODBOARD_EXAMPLE_TILES = [
  { key: "ex1", bg: "radial-gradient(circle at 35% 40%, #a8744b 0 16%, #5b3a24 17% 34%, #34200f 35%)" },
  { key: "ex2", bg: "repeating-linear-gradient(90deg, #a06e45 0 16px, #86592f 16px 30px)" },
  { key: "ex3", bg: "radial-gradient(circle at 55% 52%, #f4e6d2 0 18%, #c79a6a 19% 27%, #6b4429 28%)" },
  { key: "ex4", bg: "linear-gradient(90deg, #4a2e1f 0 25%, #8a5a3b 25% 50%, #c79a6a 50% 75%, #e9d6bd 75%)" },
  { key: "ex5", bg: "linear-gradient(180deg, #f5c07a 0%, #cf7a3f 55%, #5a2f1c 100%)" },
  { key: "ex6", bg: "linear-gradient(135deg, #3a3531, #1e1b18)" },
];

// Separate from the deterministic Imagery Style copy (lighting/subject/
// treatment, derived from Visual Direction) — actual reference photos the
// brand wants to point to, entirely optional. Opens with a plain "what is
// a moodboard" explainer + example, since the word alone confused people.
// Search keywords per visual direction, in English on purpose: Pinterest,
// Unsplash and Envato all return far better moodboard results for English
// terms even when the brand itself is Indonesian. Deliberately concrete
// (lighting, texture, subject) rather than adjectives — "bold" alone
// returns typography posters, "bold ... high contrast, saturated color,
// poster energy" returns an actual moodboard.
const MOODBOARD_PROMPT_KEYWORDS = {
  Minimal: "lots of white space, muted palette, clean product shots, soft daylight",
  Editorial: "magazine layout, strong headlines, grid, editorial photography",
  Bold: "high contrast, oversized type, saturated color, poster energy",
  Luxury: "premium, serif type, deep shadows, marble and gold accents",
  Playful: "rounded shapes, bright color, candid people, fun props",
  Organic: "natural texture, linen and wood, handmade, warm daylight",
  Futuristic: "sharp edges, neon accents, dark background, 3d render",
  Street: "raw urban, film grain, concrete texture, flash photography",
  Corporate: "clean grid, restrained palette, office, professional portraits",
  Creative: "collage, unexpected color, mixed media, experimental layout",
};

// The "(sektor)" half of the prompt — what the business actually is, taken
// from the description they already wrote so nobody has to type it twice.
// First clause only: a whole paragraph pasted into Pinterest matches
// nothing.
function brandSectorLabel(brand) {
  const raw = (brand?.businessDescription || (brand?.brandDNA?.productsServices || [])[0] || brand?.name || "").trim();
  return raw.split(/[.,\n;]/)[0].trim().slice(0, 45);
}

// MOODBOARD_PROMPT_KEYWORDS alone is industry-blind — "Corporate" says
// "office, professional portraits" for EVERY sector, so a construction
// company (or a farm, a workshop, a clinic…) got back generic office stock
// photos that don't look anything like their actual world. This layers real
// subject matter for the industries SME brands here most often are ON TOP
// of the mood, matched against whatever they already typed as their
// business description — never replacing the mood, just grounding it in
// what the brand actually looks like day to day. English on purpose, same
// reason as MOODBOARD_PROMPT_KEYWORDS.
const MOODBOARD_INDUSTRY_HINTS = [
  { test: /konstruksi|kontraktor|bangunan|renovasi|arsitek(tur)?|sipil|tukang|proyek bangunan/i, hint: "construction site, architecture, blueprints, building materials, industrial texture" },
  { test: /kuliner|resto(ran)?|caf[eé]|makanan|catering|warung|kedai/i, hint: "food styling, restaurant interior, ingredients, table setting" },
  { test: /fashion|pakaian|busana|clothing|apparel|butik/i, hint: "fashion editorial, fabric texture, model styling, apparel flat lay" },
  { test: /kecantikan|skincare|kosmetik|salon|spa/i, hint: "beauty product, skin texture, soft studio lighting" },
  { test: /kesehatan|klinik|medis|dokter|rumah sakit|apotek/i, hint: "healthcare setting, clinical, calm professional" },
  { test: /pendidikan|kursus|sekolah|bimbel|\bles\b|training/i, hint: "classroom, learning materials, students, workshop" },
  { test: /teknologi|software|aplikasi|startup|\bIT\b|digital agency/i, hint: "tech workspace, screens, product UI, modern office" },
  { test: /otomotif|bengkel|mobil|motor|spare ?part/i, hint: "automotive workshop, vehicle detail, tools, garage" },
  { test: /pertanian|tani|kebun|perkebunan|agri/i, hint: "farmland, crops, agriculture, outdoor natural light" },
  { test: /logistik|ekspedisi|pengiriman|gudang|warehous/i, hint: "warehouse, logistics, shipping, industrial" },
  { test: /properti|real ?estate|perumahan|apartemen/i, hint: "real estate, architecture, interior, property exterior" },
  { test: /manufaktur|pabrik|produksi masal|industri/i, hint: "factory floor, manufacturing, machinery, production line" },
];
function moodboardIndustryHint(brand) {
  const text = [brand?.businessDescription, brand?.name, ...(brand?.brandDNA?.productsServices || [])].filter(Boolean).join(" ");
  return MOODBOARD_INDUSTRY_HINTS.find((h) => h.test.test(text))?.hint || "";
}

// One ready-to-paste search line for one mood: "<mood> moodboard for
// <sektor> brand, <industry subject>, <keywords>[, <warna>]".
function moodboardPromptText(direction, sector, a, brand) {
  const mood = String(direction || "").toLowerCase();
  const keywords = MOODBOARD_PROMPT_KEYWORDS[direction] || "";
  const industryHint = moodboardIndustryHint(brand);
  const feel = (a.colorFeelings || []).map((f) => feelingLabel(f).toLowerCase()).slice(0, 2).join(" ");
  const parts = [`${mood} moodboard for ${sector || "small business"} brand`, industryHint, keywords, feel ? `${feel} colors` : ""].filter(Boolean);
  return parts.join(", ");
}

function moodboardSearchLinksHTML(text) {
  const q = encodeURIComponent(text);
  const links = [
    { label: "Pinterest", url: `https://pinterest.com/search/pins/?q=${q}` },
    { label: "Unsplash", url: `https://unsplash.com/s/photos/${q}` },
    { label: "Envato Elements", url: `https://elements.envato.com/photos?terms=${q}` },
  ];
  return links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.label)} \u2197</a>`).join(" · ");
}

// Revisi: picking a mood above now produces the exact sentence to paste
// into Pinterest, per selected direction — "cari moodboard" used to be an
// instruction with no starting point, which is the step people actually
// got stuck on.
function moodboardPromptsHTML(state, brand) {
  const a = state.answers;
  if (!a.visualDirection.length) {
    return `
      <div class="mb-prompt-empty">
        ${icon("search", { size: 13 })}<span>${t("guidelines.moodboard.promptEmpty")}</span>
      </div>
    `;
  }
  const sector = brandSectorLabel(brand);
  return a.visualDirection
    .map((d) => {
      const text = moodboardPromptText(d, sector, a, brand);
      return `
        <div class="mb-prompt">
          <div class="mb-prompt-head">
            <span class="mb-prompt-mood">${escapeHtml(directionLabel(d))}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-copy-prompt="${escapeHtml(text)}">${icon("copy", { size: 12 })}${t("guidelines.moodboard.copyPrompt")}</button>
          </div>
          <div class="mb-prompt-text">${escapeHtml(text)}</div>
          <div class="mb-prompt-links">${t("guidelines.moodboard.searchWith")} ${moodboardSearchLinksHTML(text)}</div>
        </div>
      `;
    })
    .join("");
}

function moodboardHTML(state, brand) {
  const a = state.answers;
  return `
    <details class="mb-explain" ${a.moodboard.length ? "" : "open"}>
      <summary>${icon("info", { size: 14 })}${t("guidelines.moodboard.whatTitle")}</summary>
      <p>${t("guidelines.moodboard.whatBody")}</p>
      <div class="mb-example-title">${t("guidelines.moodboard.exampleTitle")}</div>
      <div class="mb-example">${MOODBOARD_EXAMPLE_TILES.map((x) => `<div class="mb-tile" style="background:${x.bg};"><span>${t(`guidelines.moodboard.${x.key}`)}</span></div>`).join("")}</div>
      <p class="text-faint" style="font-size:11.5px;margin:8px 0 0;">${t("guidelines.moodboard.how")}</p>
    </details>
    <div style="margin-top:16px;">
      <div class="flex items-center gap-6" style="font-size:11.5px;font-weight:700;margin-bottom:8px;">${t("guidelines.moodboard.label")} <span class="text-faint" style="font-weight:400;">${t("guidelines.moodboard.optional")}</span>${helpButtonHTML("term-moodboard")}</div>
      <div class="mb-prompt-block">
        <div class="mb-prompt-title">${t("guidelines.moodboard.promptTitle")}</div>
        ${moodboardPromptsHTML(state, brand)}
      </div>
      <div class="flex gap-8" style="flex-wrap:wrap;margin-bottom:8px;">
        ${a.moodboard
          .map(
            (m, i) => `
          <div class="logo-thumb">
            <img src="${m.dataUrl}" alt="Moodboard ${i + 1}" />
            <button type="button" class="logo-remove" data-remove-moodboard="${i}">${icon("x", { size: 10 })}</button>
          </div>
        `
          )
          .join("")}
        <button type="button" class="logo-add-tile" id="add-moodboard">${icon("upload", { size: 18 })}</button>
      </div>
      <input type="file" id="moodboard-file" accept="image/*" multiple hidden />
    </div>
  `;
}

function wireDirectionStep(root, state, refresh) {
  qsa("[data-direction]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const d = el.dataset.direction;
      let list = state.answers.visualDirection.filter((x) => x !== d);
      if (el.checked) {
        if (list.length >= 2) { toast(t("guidelines.direction.max2"), "error"); el.checked = false; return; }
        list = [...list, d];
      }
      state.answers.visualDirection = list;
      refresh();
    });
  });
  qsa("[data-copy-prompt]", root).forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyPrompt || "");
        toast(t("guidelines.moodboard.promptCopied"));
      } catch {
        toast(t("bg.copyFail"), "error");
      }
    });
  });
  qs("#add-moodboard", root)?.addEventListener("click", () => qs("#moodboard-file", root).click());
  qs("#moodboard-file", root)?.addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const added = await Promise.all(files.map((f) => resizeImageFile(f, { maxDimension: 700 }).then((dataUrl) => ({ dataUrl }))));
    state.answers.moodboard = [...state.answers.moodboard, ...added];
    refresh();
  });
  qsa("[data-remove-moodboard]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.answers.moodboard = state.answers.moodboard.filter((_, i) => i !== Number(btn.dataset.removeMoodboard));
      refresh();
    });
  });
}

// ---------- Step 6: Tone of Voice ----------
// Same 4 spectrums and worked example as before (brandbook-data.js), now
// inside Brand Guidelines. Each bar shows percentages for both ends, and an
// optional AI pass reads a few typed/dictated sentences and sets the bars.
// Saved to brand.brandBuilder.toneOfVoice, where the AI features and the
// Brand Book already read it.
function toneAxisRowHTML(axis, value) {
  const left = t(`guidelines.tone.axis.${axis.key}.left`);
  const right = t(`guidelines.tone.axis.${axis.key}.right`);
  return `
    <div class="tov-axis" data-tov-row="${axis.key}">
      <div class="tov-axis-head">
        <span>${left} <b class="tov-pct" data-tov-left>${100 - value}%</b></span>
        <span><b class="tov-pct" data-tov-right>${value}%</b> ${right}</span>
      </div>
      <input type="range" min="0" max="100" step="5" value="${value}" data-tov-axis="${axis.key}" aria-label="${escapeHtml(`${left} – ${right}`)}" />
    </div>`;
}

function toneStepHTML(state) {
  const tv = state.tone;
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("guidelines.tone.title")}${helpButtonHTML("term-tone")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("guidelines.tone.sub")}</p>
    <details class="card dark-surface tov-detect" ${tv.source && !state.toneDetectOpen ? "" : "open"}>
      <summary>${icon("bot", { size: 14 })}${t("guidelines.tone.detectTitle")}</summary>
      <p class="text-faint" style="font-size:12px;margin:8px 0 10px;">${t("guidelines.tone.detectBody")}</p>
      <div class="flex gap-8" style="align-items:flex-start;">
        <textarea class="textarea" id="tov-sample" style="min-height:80px;flex:1;" placeholder="${escapeHtml(t("guidelines.tone.detectPlaceholder"))}">${escapeHtml(state.toneSample)}</textarea>
        <button type="button" class="chip-icon-btn" id="tov-mic" aria-label="${t("brandForm.mic")}" title="${t("brandForm.mic")}">${icon("mic", { size: 15 })}</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="tov-detect" style="margin-top:8px;">${icon("bot", { size: 13 })}${t("guidelines.tone.detectBtn")}</button>
      <div id="tov-detect-status" class="text-faint" style="font-size:11.5px;margin-top:6px;"></div>
    </details>
    <div class="card dark-surface" style="margin:14px 0;">
      ${TONE_AXES.map((axis) => toneAxisRowHTML(axis, tv[axis.key])).join("")}
    </div>
    <div class="card dark-surface card-tight" style="margin-bottom:14px;">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">${t("guidelines.tone.exampleTitle")}</div>
      <p id="tov-example" style="font-size:13px;line-height:1.7;font-style:italic;margin:0;">${escapeHtml(toneExampleDisplay(tv.formal, tv.character))}</p>
    </div>
    <div class="card dark-surface">
      <div class="field" style="margin-bottom:0;">
        <label style="font-size:11.5px;">${t("guidelines.tone.avoidLabel")}</label>
        <div class="chip-list">
          ${tv.avoidWords.map((v, i) => `<span class="dna-chip">${escapeHtml(v)}<button type="button" data-tov-avoid-remove="${i}" aria-label="${t("common.remove")}">${icon("x", { size: 10 })}</button></span>`).join("")}
        </div>
        <div class="flex gap-8" style="margin-top:6px;">
          <input class="input" id="tov-avoid-new" placeholder="${escapeHtml(t("guidelines.tone.avoidPlaceholder"))}" style="flex:1;" />
          <button type="button" class="btn btn-secondary btn-sm" id="tov-avoid-add" aria-label="${t("guidelines.tone.add")}">${icon("plus", { size: 12 })}</button>
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between" style="margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}${t("common.back")}</button>
      <button type="button" class="btn btn-primary" id="tov-save-next">${icon("check", { size: 14 })}${t("guidelines.tone.saveNext")}</button>
    </div>
  `;
}

function wireToneStep(root, brandId, state, refresh) {
  const persist = () => {
    const bb = getBrand(brandId)?.brandBuilder || {};
    const completedStages = new Set(bb.completedStages || []);
    completedStages.add("toneOfVoice");
    state.tone.source = "user";
    const { formal, language, character, emotion, avoidWords } = state.tone;
    updateBrand(brandId, { brandBuilder: { ...bb, completedStages: [...completedStages], toneOfVoice: { formal, language, character, emotion, avoidWords, source: "user" } } });
  };
  const paintAxis = (key) => {
    const row = qs(`[data-tov-row="${key}"]`, root);
    if (!row) return;
    const v = state.tone[key];
    row.querySelector("[data-tov-left]").textContent = `${100 - v}%`;
    row.querySelector("[data-tov-right]").textContent = `${v}%`;
    row.querySelector("input").value = v;
  };
  const paintExample = () => {
    const el = qs("#tov-example", root);
    if (el) el.textContent = toneExampleDisplay(state.tone.formal, state.tone.character);
  };

  // Live while dragging (no full repaint, so the drag isn't interrupted);
  // saved + tab checkmark refreshed on release.
  qsa("[data-tov-axis]", root).forEach((el) => {
    el.addEventListener("input", () => {
      state.tone[el.dataset.tovAxis] = Number(el.value);
      paintAxis(el.dataset.tovAxis);
      paintExample();
    });
    el.addEventListener("change", () => {
      const wasDone = !!state.tone.source;
      persist();
      if (!wasDone) refresh();
    });
  });

  const detectEl = qs(".tov-detect", root);
  detectEl?.addEventListener("toggle", () => { state.toneDetectOpen = detectEl.open; });
  const sampleEl = qs("#tov-sample", root);
  sampleEl?.addEventListener("input", () => { state.toneSample = sampleEl.value; });
  const micBtn = qs("#tov-mic", root);
  if (micBtn && sampleEl) wireMic(micBtn, sampleEl);
  qs("#tov-detect", root)?.addEventListener("click", async (e) => {
    const text = (sampleEl?.value || "").trim();
    state.toneSample = text;
    const sentences = text.split(/[.!?\n]+/).filter((x) => x.trim().length > 2).length;
    if (sentences < 2 && text.length < 60) {
      toast(t("guidelines.tone.needText"), "error");
      sampleEl?.focus();
      return;
    }
    const ai = getSettings().ai || {};
    if (!hasAiKey(ai)) {
      toast(t("brandForm.aiNoKey"), "error");
      return;
    }
    const btn = e.currentTarget;
    const statusEl = qs("#tov-detect-status", root);
    btn.disabled = true;
    statusEl.textContent = t("guidelines.tone.detecting");
    try {
      Object.assign(state.tone, await detectToneOfVoice(ai, { brand: getBrand(brandId), text }));
      persist();
      state.toneDetectOpen = true;
      refresh();
      toast(t("guidelines.tone.detected"));
    } catch (err) {
      statusEl.textContent = "";
      btn.disabled = false;
      toast(err.message || t("bg.aiError"), "error");
    }
  });

  const addWord = () => {
    const input = qs("#tov-avoid-new", root);
    const v = input?.value.trim();
    if (!v) return;
    state.tone.avoidWords.push(v);
    persist();
    refresh();
  };
  qs("#tov-avoid-add", root)?.addEventListener("click", addWord);
  qs("#tov-avoid-new", root)?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addWord(); }
  });
  qsa("[data-tov-avoid-remove]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.tone.avoidWords.splice(Number(btn.dataset.tovAvoidRemove), 1);
      persist();
      refresh();
    })
  );

  // Saving moves on to the next section instead of leaving them on the
  // same screen wondering whether it worked.
  qs("#tov-save-next", root)?.addEventListener("click", () => {
    persist();
    toast(t("guidelines.tone.saved"));
    state.stepIndex += 1;
    refresh();
  });
}

// ---------- Step 7: Brand Applications ----------
function applicationsStepHTML(state, brand) {
  const a = state.answers;
  const chips = APPLICATION_TYPES.map((type) => chipHTML(type.id, type.label, a.applications.includes(type.id), "data-app")).join("");
  return `
    <h2 style="margin-bottom:6px;" class="flex items-center gap-6">${t("bg.apps.title")}${helpButtonHTML("term-applications")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">${t("bg.apps.sub")}</p>
    <div class="bb-chip-row" style="margin-bottom:20px;">${chips}</div>
    <div class="bb-mockup-stage" style="${mockupStageStyle(a)}">${a.applications.map((id) => renderMockup(id, a, brand)).join("")}</div>
    ${navHTML(state, !isStepFilled("applications", a))}
  `;
}

function wireApplicationsStep(root, state, refresh) {
  qsa("[data-app]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.app;
      const set = new Set(state.answers.applications);
      if (el.checked) set.add(id); else set.delete(id);
      state.answers.applications = [...set];
      refresh();
    });
  });
}

function mockupStageStyle(a) {
  const c = a.colors;
  const dir = VISUAL_DIRECTIONS[a.visualDirection[0]] || { radius: "12px" };
  return `--bb-primary:${c.primary || "#333"};--bb-secondary:${c.secondary || "#666"};--bb-accent:${c.accent || "#999"};--bb-bg:${c.background || "#fff"};--bb-text:${c.text || "#222"};--bb-font-primary:'${a.fonts.primary || "Inter"}';--bb-font-secondary:'${a.fonts.secondary || "Inter"}';--bb-radius:${dir.radius};`;
}

function renderMockup(id, answers, brand) {
  const fn = MOCKUP_RENDERERS[id];
  return fn ? fn(answers, brand) : "";
}

function socialPostMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">${t("bbdata.app.social")}</div>
      <div class="bb-mockup bb-mockup-social">
        ${answers.logo.dataUrl ? `<img src="${answers.logo.dataUrl}" style="height:22px;object-fit:contain;" alt="" />` : `<div class="bb-mockup-body" style="font-weight:700;">${escapeHtml(brand.name)}</div>`}
        <div class="bb-mockup-headline">${escapeHtml(brand.brandDNA.tagline || t("bg.mock.headline"))}</div>
        <div class="bb-mockup-chip">${t("bg.mock.shopNow")}</div>
      </div>
    </div>
  `;
}

function businessCardMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">${t("bbdata.app.business-card")}</div>
      <div class="bb-mockup bb-mockup-card" style="background:var(--bb-primary);">
        ${answers.logo.dataUrl ? `<img src="${answers.logo.dataUrl}" style="height:26px;object-fit:contain;filter:brightness(0) invert(1);" alt="" />` : `<div class="bb-mockup-headline" style="color:var(--bb-bg);">${escapeHtml(brand.name)}</div>`}
        <div class="bb-mockup-body" style="color:var(--bb-bg);opacity:.85;">${escapeHtml(brand.brandDNA.tagline || "")}</div>
      </div>
    </div>
  `;
}

function bookStyleOf(a) {
  return BOOK_STYLES.find((s) => s.key === a.bookStyle) || BOOK_STYLES[0];
}

// accounts/{uid}.bookStyles is only ever written by the Midtrans webhook
// (firestore.rules lets a user edit nothing but displayName/username), so
// reading it client-side is safe to gate the download on. Pay-once plans
// own every style as part of the bundle (the webhook writes them too; this
// covers accounts granted by hand from the admin).
function ownsBookStyle(style) {
  if (style.free || isAdmin(currentUid())) return true;
  const account = getCachedAccount();
  if (LIFETIME_PLANS.includes(account?.plan)) return true;
  return (account?.bookStyles || []).includes(style.key);
}

const loadedBookStyleFonts = new Set();
function ensureBookStyleFonts(style) {
  if (!style.fonts || loadedBookStyleFonts.has(style.key)) return;
  loadedBookStyleFonts.add(style.key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${style.fonts}&display=swap`;
  document.head.appendChild(link);
}

// class + style attributes for a .brandbook-sheet wrapping this book.
function bookSheetAttrs(a, extraClass = "") {
  const style = bookStyleOf(a);
  ensureBookStyleFonts(style);
  return `class="brandbook-sheet bbk-style-${style.key} ${ownsBookStyle(style) ? "" : "bbk-locked"} ${extraClass}" style="${brandThemeVars(a)}"`;
}

// amount = how much of `other` is mixed in (0..1). Plain hex math rather
// than CSS color-mix(): html2canvas (the PDF path) can't parse color-mix.
function mixHex(hex, other, amount) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  const ch = (x, y) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `#${ch(a.r, b.r)}${ch(a.g, b.g)}${ch(a.b, b.b)}`;
}

function bookPrimary(a) {
  return a.colors.primary || BOOK_INK;
}

// Sets --bb-* custom properties (color/font/radius) from the brand's own
// chosen palette on the wrapping .brandbook-sheet — the same variables the
// Applications mockups already use (mockupStageStyle), plus the derived
// ones only the book needs (readable text color on each brand color, and
// two soft tints of the primary for panels).
function brandThemeVars(a) {
  const p = bookPrimary(a);
  return `${mockupStageStyle(a)}--bb-primary:${p};--bb-on-primary:${pickTintTextColor(p)};--bb-on-secondary:${pickTintTextColor(a.colors.secondary || "#666666")};--bb-on-accent:${pickTintTextColor(a.colors.accent || "#999999")};--bb-tint:${mixHex(p, "#ffffff", 0.93)};--bb-tint-2:${mixHex(p, "#ffffff", 0.84)};${bookStyleOf(a).photo && a.bookPhoto ? `--bbk-photo:url('${a.bookPhoto}');` : ""}`;
}

// Picks a font size from the text's own length so a one-line tagline sets
// big and a three-sentence one still fits its fixed-height panel.
// steps = [[maxChars, px], ...] ascending; `min` is used past the last step.
function fitSize(text, steps, min) {
  const len = (text || "").length;
  for (const [max, px] of steps) if (len <= max) return px;
  return min;
}

function stripColon(label) {
  return label.replace(/\s*:\s*$/, "");
}

function bookEmpty(message) {
  return `<div class="bbk-empty">${escapeHtml(message)}</div>`;
}

// The palette "spine" — the brand's own colors stacked in their usage
// proportions. Vertical down the left edge of content pages, horizontal
// along the bottom of cover/divider pages.
function spineHTML(a, cls) {
  const cols = BOOK_ROLES.map((k) => a.colors[k]).filter(Boolean);
  const flex = [5, 3, 2, 1, 1];
  return `<div class="${cls}">${(cols.length ? cols : [BOOK_INK]).map((c, i) => `<span style="flex:${flex[i] || 1};background:${c};"></span>`).join("")}</div>`;
}

// Last word of a title gets its own span — classic ignores it, the premium
// styles use it for their highlight (marker box, second color…).
function bookTitleHTML(title) {
  const words = String(title).trim().split(/\s+/);
  if (words.length < 2) return `<span class="bbk-hl">${escapeHtml(title)}</span>`;
  const last = words.pop();
  return `${escapeHtml(words.join(" "))} <span class="bbk-hl">${escapeHtml(last)}</span>`;
}

// Tiled "PREVIEW" mark laid over every page of a style the account hasn't
// bought. It can't stop an OS screenshot — nothing in a browser can — it
// makes the screenshot worthless as a deliverable. Never emitted for owned
// styles, and the PDF/print paths refuse locked styles outright.
const WATERMARK_HTML = `<div class="bbk-wm" aria-hidden="true">${`<div>${"PREVIEW · WEPEKA BRANDLAB &nbsp;&nbsp; ".repeat(8)}</div>`.repeat(16)}</div>`;

function bookFooterHTML(brand, left) {
  return `
    <div class="bbk-foot">
      <span>${escapeHtml(left || t("bg.book.footerBook", { name: brand.name }))}</span>
      <span class="bbk-foot-pn">{{PN}}</span>
      <span>${t("bg.book.madeBy")}</span>
    </div>
  `;
}

// Default content page: spine, chapter label, big title in the brand's
// heading font, optional lead sentence, then a body region that fills the
// rest of the artboard (each section lays itself out inside it).
function brandbookPageHTML({ chapter, title, lead, body, brand, a }) {
  return `
    <div class="brandbook-page brandbook-print-page bbk-page bbk-content">
      ${spineHTML(a, "bbk-spine")}
      <div class="bbk-inner">
        <div class="bbk-head">
          <div class="bbk-chapter">${chapter ? `<b>${chapter.num}</b><span>${escapeHtml(chapter.title)}</span>` : `<span>${escapeHtml(brand.name)}</span>`}</div>
          <img src="assets/wepeka-logo.png" class="bbk-wpk" alt="Wepeka Brandlab" />
        </div>
        <div class="bbk-title">${bookTitleHTML(title)}</div>
        ${lead ? `<div class="bbk-lead">${escapeHtml(lead)}</div>` : ""}
        <div class="bbk-body">${body}</div>
        ${bookFooterHTML(brand)}
      </div>
    </div>
  `;
}

// Full-bleed, brand-colored chapter opener. The chapter number is set
// huge and faint behind the title — text color is --bb-on-primary, picked
// at render time so it reads on any primary, light or dark.
function dividerPageHTML(chapter, brand, a) {
  return `
    <div class="brandbook-page brandbook-print-page bbk-page bbk-divider bbk-fill-${(Number(chapter.num) - 1) % 3} ${pickTintTextColor(bookPrimary(a)) === "#1c1610" ? "" : "bbk-on-dark"}">
      <div class="bbk-inner">
        <div class="bbk-divider-num">${escapeHtml(chapter.num)}</div>
        <div class="bbk-head">
          <div class="bbk-chapter"><span>${escapeHtml(brand.name)}</span></div>
          <img src="assets/wepeka-logo.png" class="bbk-wpk" alt="Wepeka Brandlab" />
        </div>
        <div class="bbk-divider-main">
          <div class="bbk-divider-bar"></div>
          <div class="bbk-divider-title" style="font-size:${fitSize(chapter.title, [[14, 92], [24, 76]], 62)}px;">${bookTitleHTML(chapter.title)}</div>
          ${chapter.sub ? `<div class="bbk-divider-sub">${escapeHtml(chapter.sub)}</div>` : ""}
        </div>
        ${bookFooterHTML(brand)}
      </div>
      ${spineHTML(a, "bbk-strip")}
    </div>
  `;
}

// Cover and closing page share one split layout: brand-color field with
// the headline on the left, the palette spine as the seam, the logo on a
// light panel on the right. The panel uses the brand's own background
// color when that's light enough to keep any logo legible, else white.
function splitCoverHTML(brand, a, { eyebrow, headline, sub, footLeft }) {
  const hasLogo = a.logo.hasLogo === true && !!a.logo.dataUrl;
  const bg = a.colors.background;
  const panel = bg && pickTintTextColor(bg) === "#1c1610" ? bg : "#ffffff";
  return `
    <div class="brandbook-page brandbook-print-page bbk-page bbk-cover">
      <div class="bbk-cover-field">
        <div class="bbk-head">
          <div class="bbk-chapter"><span>${escapeHtml(eyebrow)}</span></div>
        </div>
        <div class="bbk-cover-main">
          <div class="bbk-divider-bar"></div>
          <div class="bbk-cover-title" style="font-size:${fitSize(headline.replace(/<[^>]+>/g, " "), [[18, 98], [30, 68]], 54)}px;">${headline}</div>
          ${sub ? `<div class="bbk-cover-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
        ${bookFooterHTML(brand, footLeft)}
      </div>
      ${spineHTML(a, "bbk-cover-seam")}
      <div class="bbk-cover-panel" style="background:${panel};">
        <img src="assets/wepeka-logo.png" class="bbk-wpk" alt="Wepeka Brandlab" />
        ${
          hasLogo
            ? `<div class="bbk-cover-logo-wrap"><img src="${a.logo.dataUrl}" class="bbk-cover-logo" alt="${escapeHtml(t("bg.cover.logoAlt", { name: brand.name }))}" /><span class="bbk-cover-caption">${escapeHtml(brand.name)}</span></div>`
            : `<div class="bbk-cover-logo-wrap"><div class="bbk-cover-monogram">${escapeHtml((brand.name || "?").trim().charAt(0).toUpperCase())}</div><span class="bbk-cover-caption">${escapeHtml(brand.name)}</span></div>`
        }
      </div>
    </div>
  `;
}

function coverPageHTML(brand, a, year) {
  return splitCoverHTML(brand, a, {
    eyebrow: `${brand.name} · ${year}`,
    headline: "Brand<br/>Guidelines",
    sub: brand.brandDNA.tagline || "",
    footLeft: t("bg.cover.preparedFor", { name: brand.name }),
  });
}

function closingPageHTML(brand, a, year) {
  return splitCoverHTML(brand, a, {
    eyebrow: t("bg.divider.thanks.index"),
    headline: escapeHtml(t("bg.divider.thanks.title")),
    sub: `${brand.name} × Wepeka Brandlab, ${year}.`,
  });
}

// Contents lists the book's real chapters with the page each one opens
// on — built after the page sequence exists (see buildBrandBookPages), so
// it can never drift from what's actually in the book.
function tocBody(chapters) {
  return `
    <div class="bbk-toc">
      ${chapters
        .map(
          (c) => `
        <div class="bbk-toc-row">
          <div class="bbk-toc-num">${c.num}</div>
          <div class="bbk-toc-text">
            <div class="bbk-toc-label">${escapeHtml(c.title)}</div>
            <div class="bbk-toc-desc">${escapeHtml(c.sub || "")}</div>
          </div>
          <div class="bbk-toc-page">${String(c.startPage).padStart(2, "0")}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// ---------- Section bodies ----------

function foundationBody(brand) {
  const dna = brand.brandDNA;
  const cards = [
    { label: stripColon(t("bg.book.purpose")), text: dna.purpose },
    { label: stripColon(t("bg.book.vision")), text: dna.vision },
    { label: stripColon(t("bg.book.for")), text: dna.targetAudience },
    { label: stripColon(t("bg.book.whyUs")), text: dna.positioning },
  ].filter((c) => c.text);
  if (!cards.length && !dna.tagline) return bookEmpty(t("bg.book.foundationEmpty"));
  return `
    <div class="bbk-cols">
      ${
        dna.tagline
          ? `<div class="bbk-quote" style="flex:0 0 38%;">
               <div class="bbk-quote-mark">“</div>
               <div class="bbk-quote-text" style="font-size:${fitSize(dna.tagline, [[28, 40], [60, 32], [110, 25]], 20)}px;">${escapeHtml(dna.tagline)}</div>
               <div class="bbk-label" style="margin-top:auto;">${t("bg.foundation.tagline")}</div>
             </div>`
          : ""
      }
      <div class="bbk-grid" style="flex:1;grid-template-columns:repeat(${cards.length > 1 ? 2 : 1},1fr);">
        ${cards
          .map(
            (c) => `
          <div class="bbk-card">
            <div class="bbk-label bbk-label-brand">${escapeHtml(c.label)}</div>
            <div class="bbk-card-text" style="font-size:${fitSize(c.text, [[120, 19], [220, 16.5], [340, 14]], 12.5)}px;">${escapeHtml(c.text)}</div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

// Prefers the Brand Builder Personality stage's rule-based triad
// (brand.brandBuilder.personality — see js/views/brand-builder.js), shown
// as a "we are / we are not" chart (the voice-chart pattern real brand
// guideline docs use) since that reads sharper than a flat adjective list.
// Falls back to Brand DNA's free-typed personality chips for brands that
// haven't been through that stage yet, so this column is never just empty.
function personalityColumn(brand) {
  const pb = brand.brandBuilder?.personality;
  const dnaTraits = brand.brandDNA?.personality || [];
  if (pb?.primary?.length) {
    const rows = [];
    for (let i = 0; i < Math.max(pb.primary.length, pb.avoid.length); i++) {
      if (!pb.primary[i] && !pb.avoid[i]) continue;
      rows.push(`<div class="bbk-trait-row"><span class="bbk-trait-yes">${pb.primary[i] ? escapeHtml(pb.primary[i]) : ""}</span><span class="bbk-trait-no">${pb.avoid[i] ? escapeHtml(pb.avoid[i]) : ""}</span></div>`);
    }
    return `
      ${pb.feeling ? `<div class="bbk-label">${stripColon(t("bg.book.coreCharacter"))}</div><div class="bbk-bigword">${escapeHtml(feelingLabel(pb.feeling))}</div>` : ""}
      <div class="bbk-trait-head"><span>${t("bg.book.weAre")}</span><span>${t("bg.book.weAreNot")}</span></div>
      ${rows.join("")}
      ${pb.secondary?.length ? `<div class="bbk-chips" style="margin-top:18px;">${pb.secondary.map((s) => `<span class="bbk-chip">${escapeHtml(s)}</span>`).join("")}</div>` : ""}
    `;
  }
  if (dnaTraits.length) return `<div class="bbk-label">${stripColon(t("bg.book.coreCharacter"))}</div><div class="bbk-chips" style="margin-top:12px;">${dnaTraits.map((s) => `<span class="bbk-chip bbk-chip-lg">${escapeHtml(s)}</span>`).join("")}</div>`;
  return bookEmpty(t("bg.book.personalityEmpty"));
}

// Prefers the Tone of Voice stage's 4 sliders (structured) over the plain
// aiVoiceGuide free-text field — each axis is drawn as the actual spectrum
// with the brand's position marked on it, plus the same live example the
// stage itself generates, so the book carries a concrete "here's how we
// sound" instead of just a paragraph.
function voiceColumn(brand) {
  const tov = brand.brandBuilder?.toneOfVoice;
  const guide = brand.aiVoiceGuide;
  const cta = brand.brandDNA?.callToAction;
  if (!tov?.source && !guide && !cta) return "";
  const axes = tov?.source
    ? TONE_AXES.map((axis) => {
        const v = Math.max(0, Math.min(100, Number(tov[axis.key]) || 0));
        return `
        <div class="bbk-axis">
          <div class="bbk-axis-ends"><span>${escapeHtml(t(`guidelines.tone.axis.${axis.key}.left`))}</span><span>${escapeHtml(t(`guidelines.tone.axis.${axis.key}.right`))}</span></div>
          <div class="bbk-axis-track"><span class="bbk-axis-dot" style="left:${v}%;"></span></div>
        </div>`;
      }).join("")
    : "";
  return `
    <div class="bbk-panel bbk-voice">
      <div class="bbk-label bbk-label-brand">${t("guidelines.step.tone")}</div>
      ${axes}
      ${tov?.source ? `<div class="bbk-example"><div class="bbk-label">${t("bg.book.example")}</div><div class="bbk-example-text">${escapeHtml(toneExampleDisplay(tov.formal, tov.character))}</div></div>` : ""}
      ${!tov?.source && guide ? `<div class="bbk-card-text" style="font-size:${fitSize(guide, [[200, 15], [400, 13]], 11.5)}px;margin-top:12px;">${escapeHtml(guide)}</div>` : ""}
      <div class="bbk-voice-meta">
        ${tov?.avoidWords?.length ? `<div><span class="bbk-label">${stripColon(t("bg.book.avoid"))}</span><div class="bbk-chips">${tov.avoidWords.map((w) => `<span class="bbk-chip bbk-chip-no">${escapeHtml(w)}</span>`).join("")}</div></div>` : ""}
        ${cta ? `<div><span class="bbk-label">${stripColon(t("bg.book.cta"))}</span><div class="bbk-chips"><span class="bbk-chip bbk-chip-cta">${escapeHtml(cta)}</span></div></div>` : ""}
      </div>
    </div>
  `;
}

function personalityBody(brand) {
  const voice = voiceColumn(brand);
  return `<div class="bbk-cols"><div style="flex:1;min-width:0;">${personalityColumn(brand)}</div>${voice ? `<div style="flex:0 0 50%;display:flex;">${voice}</div>` : ""}</div>`;
}

// Tagline placement rules — the e-book explicitly separates "the tagline
// itself" from "how it must be placed with the logo", so the page shows
// both: the line set large, and the logo + tagline lockup next to the rule.
function taglineBody(brand, a) {
  const tagline = brand.brandDNA?.tagline;
  if (!tagline) return bookEmpty(t("bg.book.noTagline"));
  return `
    <div class="bbk-cols">
      <div class="bbk-tagline-stage" style="flex:1;">
        <div class="bbk-tagline-text" style="font-size:${fitSize(tagline, [[26, 60], [48, 48], [90, 36]], 28)}px;">${escapeHtml(tagline)}</div>
      </div>
      <div style="flex:0 0 34%;display:flex;flex-direction:column;gap:18px;">
        <div class="bbk-card bbk-lockup">
          ${a.logo.dataUrl ? `<img src="${a.logo.dataUrl}" alt="" />` : `<div class="bbk-lockup-name">${escapeHtml(brand.name)}</div>`}
          <div class="bbk-lockup-line">${escapeHtml(tagline)}</div>
        </div>
        <div class="bbk-note">${escapeHtml(t("bg.book.taglineRule"))}</div>
      </div>
    </div>
  `;
}

// Value Proposition — 3 pillars explaining concretely why someone picks
// this brand. There's no deterministic source for this the way Color/
// Typography have brandbook-data.js lookups, so it's the AI-written
// exception (generateValueProposition in ai.js) — this only ever lays out
// whatever's cached in a.aiCopy.valueProposition, never calls AI itself.
function valuePropositionBody(a) {
  const pillars = a.aiCopy?.valueProposition;
  if (!pillars?.length) return bookEmpty(t("bg.book.notGenerated"));
  return `
    <div class="bbk-cols">
      ${pillars
        .map(
          (p, i) => `
        <div class="bbk-pillar ${i === 0 ? "bbk-pillar-lead" : ""}">
          <div class="bbk-pillar-num">0${i + 1}</div>
          <div class="bbk-pillar-title">${escapeHtml(p.title)}</div>
          <div class="bbk-pillar-desc" style="font-size:${fitSize(p.desc, [[140, 15], [240, 13.5]], 12)}px;">${escapeHtml(p.desc)}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function logoHasVariants(a) {
  return !!(a.logo.secondaryDataUrl || a.logo.logotypeDataUrl);
}
function bookHasLogo(a) {
  return a.logo.hasLogo !== false && !!a.logo.dataUrl;
}

// Clear space/minimum size don't need a vector logo — just the raster
// image's own rendered box, inset with a dashed guide and "x" markers.
function logoBody(a) {
  if (!bookHasLogo(a)) return bookEmpty(t("bg.book.noLogo"));
  return `
    <div class="bbk-cols">
      <div class="bbk-stage" style="flex:1;"><img src="${a.logo.dataUrl}" style="max-width:56%;max-height:52%;" alt="Logo" /></div>
      <div style="flex:0 0 38%;display:flex;flex-direction:column;gap:18px;">
        <div class="bbk-card" style="flex:1;">
          <div class="bbk-label bbk-label-brand">Clear space</div>
          <div class="bbk-clearspace">
            <i style="top:6px;left:50%;">x</i><i style="bottom:6px;left:50%;">x</i><i style="left:8px;top:50%;">x</i><i style="right:8px;top:50%;">x</i>
            <img src="${a.logo.dataUrl}" alt="" />
          </div>
          <div class="bbk-note">${escapeHtml(t("bg.book.clearSpace"))}</div>
        </div>
        <div class="bbk-card bbk-minsize">
          <div style="flex:none;"><img src="${a.logo.dataUrl}" style="width:80px;max-height:44px;object-fit:contain;display:block;" alt="" /><div class="bbk-minsize-rule"><span>80px · 25mm</span></div></div>
          <div class="bbk-note" style="margin:0;">${escapeHtml(t("bg.book.minSize"))}</div>
        </div>
      </div>
    </div>
  `;
}

// The brightness/invert filter shows the SAME uploaded logo readable on
// light, dark, and the brand's own primary color — no separate logo files
// needed. (The PDF path bakes these CSS filters into the image first, see
// bakeImageFilters — html2canvas ignores `filter`.)
function logoUsageBody(a) {
  const p = bookPrimary(a);
  const bgs = [
    { label: t("bg.book.bgLight"), bg: "#ffffff", invert: false },
    { label: t("bg.book.bgDark"), bg: BOOK_INK, invert: true },
    { label: t("bg.role.primary"), bg: p, invert: pickTintTextColor(p) !== "#1c1610" },
  ];
  const donts = [
    { label: t("bg.book.dontStretch"), img: "transform:scaleX(1.55);" },
    { label: t("bg.book.dontRecolor"), img: "filter:saturate(0) sepia(1) hue-rotate(280deg) saturate(4);" },
    { label: t("bg.book.dontLowContrast"), img: "opacity:.28;", bg: mixHex(p, "#ffffff", 0.72) },
  ];
  return `
    <div class="bbk-rows">
      <div class="bbk-cols" style="flex:1.15;">
        ${bgs.map((b) => `<div class="bbk-tile" style="background:${b.bg};color:${pickTintTextColor(b.bg)};"><img src="${a.logo.dataUrl}" style="${b.invert ? "filter:brightness(0) invert(1);" : ""}" alt="${escapeHtml(t("bg.book.logoOn", { bg: b.label }))}" /><span class="bbk-tile-label">${escapeHtml(b.label)}</span></div>`).join("")}
      </div>
      <div class="bbk-cols" style="flex:1;">
        ${donts.map((d) => `<div class="bbk-tile bbk-tile-dont" style="${d.bg ? `background:${d.bg};` : ""}"><span class="bbk-x">✕</span><img src="${a.logo.dataUrl}" style="${d.img}" alt="" /><span class="bbk-tile-label">${escapeHtml(d.label)}</span></div>`).join("")}
      </div>
    </div>
  `;
}

// Its own page, only when there's actually a Secondary Logo or Logotype
// to show — a brand with just the one Main logo never gets this page.
function logoVariantsBody(a) {
  const variants = LOGO_VARIANT_SLOTS.map((s) => ({ label: s.label, dataUrl: a.logo[`${s.key}DataUrl`] })).filter((v) => v.dataUrl);
  return `<div class="bbk-cols">${variants.map((v) => `<div class="bbk-figure"><div class="bbk-stage"><img src="${v.dataUrl}" style="max-width:60%;max-height:50%;" alt="${escapeHtml(v.label)}" /></div><div class="bbk-figure-cap"><b>${escapeHtml(v.label)}</b></div></div>`).join("")}</div>`;
}

// Independent of the logo — a brand with zero mascots never gets this page.
function mascotsBody(a) {
  return `<div class="bbk-cols">${a.mascots
    .slice(0, 4)
    .map((m) => `<div class="bbk-figure"><div class="bbk-stage"><img src="${m.dataUrl}" style="max-width:70%;max-height:74%;" alt="${escapeHtml(m.name)}" /></div><div class="bbk-figure-cap"><b>${escapeHtml(m.name)}</b>${m.description ? `<span>${escapeHtml(m.description)}</span>` : ""}</div></div>`)
    .join("")}</div>`;
}

// Full-height color columns, widest = most used, each carrying the three
// codes a designer/printer actually asks for (HEX, RGB, CMYK).
function colorPaletteBody(a) {
  if (!a.colors.primary) return bookEmpty(t("bg.book.noColors"));
  const flex = { primary: 3, secondary: 2, accent: 1.5, background: 1.25, text: 1.25 };
  return `
    <div class="bbk-palette">
      ${BOOK_ROLES.filter((k) => a.colors[k])
        .map((k) => {
          const hex = a.colors[k];
          const rgb = hexToRgb(hex), cmyk = hexToCmyk(hex);
          return `
          <div class="bbk-swatch" style="flex:${flex[k]};background:${hex};color:${pickTintTextColor(hex)};">
            <div class="bbk-swatch-role">${roleLabel(k)}</div>
            <div class="bbk-swatch-codes">
              <div class="bbk-swatch-hex">${hex.toUpperCase()}</div>
              <div>RGB ${rgb.r} ${rgb.g} ${rgb.b}</div>
              <div>CMYK ${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}</div>
            </div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

// Colour Essence — one sentence per role on what that exact color is
// meant to evoke for THIS brand. Same AI-cache pattern as Value
// Proposition: this only lays out a.aiCopy.colorEssence, never calls AI.
function colorEssenceBody(a) {
  const essence = a.aiCopy?.colorEssence;
  if (!essence?.primary) return bookEmpty(t("bg.book.notGenerated"));
  const roles = ["primary", "secondary", "accent"].filter((k) => essence[k] && a.colors[k]);
  return `
    <div class="bbk-cols">
      ${roles
        .map(
          (k) => `
        <div class="bbk-essence">
          <div class="bbk-essence-fill" style="background:${a.colors[k]};color:${pickTintTextColor(a.colors[k])};"><span>${roleLabel(k)}</span><span>${a.colors[k].toUpperCase()}</span></div>
          <div class="bbk-essence-text" style="font-size:${fitSize(essence[k], [[110, 20], [200, 16.5]], 14)}px;">${escapeHtml(essence[k])}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// Usage = how much of each color (the 60/30/10 bar + role copy), and which
// role combos are actually safe to put text on — a real, computed WCAG
// check (contrastRatio() is plain hex-to-luminance math, no service).
// 4.5:1 is the AA bar for normal text.
function colorUsageBody(a) {
  if (!a.colors.primary) return bookEmpty(t("bg.book.noColors"));
  const roles = BOOK_ROLES.filter((k) => a.colors[k]);
  const share = { primary: 62, secondary: 28, accent: 10 };
  const pairs = [];
  for (const fg of roles) for (const bg of roles) {
    if (fg === bg) continue;
    const ratio = contrastRatio(a.colors[fg], a.colors[bg]);
    if (ratio >= 4.5) pairs.push({ fg, bg, ratio });
  }
  pairs.sort((x, y) => y.ratio - x.ratio);
  return `
    <div class="bbk-cols">
      <div style="flex:0 0 44%;display:flex;flex-direction:column;">
        <div class="bbk-ratio">${["primary", "secondary", "accent"].filter((k) => a.colors[k]).map((k) => `<span style="flex:${share[k]};background:${a.colors[k]};color:${pickTintTextColor(a.colors[k])};">${share[k]}%</span>`).join("")}</div>
        <div class="bbk-roles">
          ${roles.map((k) => `<div class="bbk-role"><i style="background:${a.colors[k]};"></i><div><b>${roleLabel(k)}</b> — ${escapeHtml(t(`bg.book.roleCopy.${k}`))}</div></div>`).join("")}
        </div>
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
        <div class="bbk-label bbk-label-brand">${t("bg.book.a11y")}</div>
        ${
          pairs.length
            ? `<div class="bbk-pairs">${pairs
                .slice(0, 8)
                .map((p) => `<div class="bbk-pair" style="background:${a.colors[p.bg]};color:${a.colors[p.fg]};"><span class="bbk-pair-aa">Aa</span><span class="bbk-pair-label">${escapeHtml(t("bg.book.onBg", { fg: roleLabel(p.fg), bg: roleLabel(p.bg) }))}</span><span class="bbk-pair-ratio">${p.ratio.toFixed(1)}:1 · ${t("bg.book.pass")}</span></div>`)
                .join("")}</div>`
            : `<div class="bbk-note">${t("bg.book.lowContrast")}</div>`
        }
      </div>
    </div>
  `;
}

// Font category description ("Sans Serif — modern, kasual, efisien...")
// is a plain lookup against FONT_CATEGORIES (see js/brandbook-data.js) via
// whichever category FONT_LIBRARY already tags that family with —
// deterministic, no AI needed. Custom-uploaded fonts aren't in
// FONT_LIBRARY, so they simply get no line here.
function fontCategoryLine(family) {
  const entry = FONT_LIBRARY.find((f) => f.family === family);
  if (!entry) return "";
  const catKey = entry.category.toLowerCase().replace(/\s+/g, "-");
  const cat = FONT_CATEGORIES.find((c) => c.key === catKey);
  return cat ? `${cat.label} — ${cat.desc}` : "";
}

const ALPHABET_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHABET_LOWER = "abcdefghijklmnopqrstuvwxyz";
const NUMERALS = "0123456789 !@#$%&*";
const SPECIMEN_ROLE_KEY = { primary: "primary", secondary: "secondary", accent: "accent" };

// One full page per font role — the way a real type specimen sheet reads
// one typeface at a time: brand-colored sidebar (role + the plain-language
// reason this font is used) next to the specimen itself (a huge "Aa", the
// full character set, both weights, and the brand's own tagline set in it
// at the brand's chosen leading/tracking). Same shape for every role and
// any extraFonts entry — only title/description/family change per call.
function typeSpecimenSplitPageHTML(brand, a, chapter, { title, desc, family, lineHeight, letterSpacing }) {
  const phrase = brand.brandDNA?.tagline || brand.name;
  const category = fontCategoryLine(family);
  const fam = `font-family:'${family}';`;
  return `
    <div class="brandbook-page brandbook-print-page bbk-page bbk-type">
      <div class="bbk-type-side">
        <div class="bbk-chapter"><b>${chapter.num}</b><span>${escapeHtml(chapter.title)}</span></div>
        <div class="bbk-type-role">${escapeHtml(title)}</div>
        <div class="bbk-type-desc">${escapeHtml(desc)}</div>
        ${category ? `<div class="bbk-type-cat">${escapeHtml(category)}</div>` : ""}
      </div>
      <div class="bbk-type-main">
        <img src="assets/wepeka-logo.png" class="bbk-wpk" alt="Wepeka Brandlab" />
        <div class="bbk-type-hero">
          <div class="bbk-type-aa" style="${fam}">Aa</div>
          <div>
            <div class="bbk-label">Typeface</div>
            <div class="bbk-type-name" style="${fam}font-size:${fitSize(family, [[12, 44], [20, 34]], 26)}px;">${escapeHtml(family)}</div>
            <div class="bbk-type-weights" style="${fam}"><span style="font-weight:400;">Regular</span><span style="font-weight:700;">Bold</span></div>
          </div>
        </div>
        <div class="bbk-type-glyphs" style="${fam}letter-spacing:${letterSpacing}em;">${ALPHABET_UPPER}<br/>${ALPHABET_LOWER}<br/>${NUMERALS}</div>
        <div class="bbk-type-sample">
          <div class="bbk-label">${t("bg.book.example")} · leading ${Number(lineHeight).toFixed(2)} · tracking ${Number(letterSpacing).toFixed(2)}em</div>
          <div style="${fam}font-weight:700;font-size:${fitSize(phrase, [[30, 40], [60, 30]], 22)}px;line-height:${lineHeight};letter-spacing:${letterSpacing}em;">${escapeHtml(phrase)}</div>
        </div>
        ${bookFooterHTML(brand)}
      </div>
    </div>
  `;
}

function typeSpecimenPageHTML(brand, a, chapter, role) {
  const family = a.fonts[role];
  if (!family) return "";
  ensureCustomFontsFor(a);
  return typeSpecimenSplitPageHTML(brand, a, chapter, {
    title: t(`bg.book.specimen.${SPECIMEN_ROLE_KEY[role]}Title`),
    desc: t(`bg.book.specimen.${SPECIMEN_ROLE_KEY[role]}Desc`),
    family,
    lineHeight: a.typeSpacing[role].lineHeight,
    letterSpacing: a.typeSpacing[role].letterSpacing,
  });
}

function extraFontSpecimenPageHTML(brand, a, chapter, extra) {
  ensureCustomFont(extra.family, a.customFonts[extra.family]);
  return typeSpecimenSplitPageHTML(brand, a, chapter, {
    title: extra.label,
    desc: t("bg.book.specimen.extraDesc", { label: extra.label }),
    family: extra.family,
    lineHeight: 1.2,
    letterSpacing: 0,
  });
}

// The good/bad comparison the e-book itself uses — same sample text at
// the chosen line-height vs. visibly too tight (1.0) and too loose (2.2),
// side by side, so "1.6 is the right call" is something you can actually
// see instead of just a number in a table.
function typographySpacingBody(a, brand) {
  const family = a.fonts.secondary || a.fonts.primary;
  if (!family) return "";
  ensureCustomFontsFor(a);
  const sp = a.typeSpacing.secondary || a.typeSpacing.primary;
  const base = brand.brandDNA?.purpose || brand.brandDNA?.tagline || "";
  const sample = base.length > 60 ? base : t("bg.book.spacingSample");
  const variants = [
    { label: t("bg.book.tooTight"), lineHeight: 1.0, ok: false },
    { label: t("bg.book.justRight", { value: sp.lineHeight.toFixed(2) }), lineHeight: sp.lineHeight, ok: true },
    { label: t("bg.book.tooLoose"), lineHeight: 2.2, ok: false },
  ];
  return `
    <div class="bbk-cols">
      ${variants
        .map(
          (v) => `
        <div class="bbk-leading ${v.ok ? "bbk-leading-ok" : ""}">
          <div class="bbk-leading-head"><span class="${v.ok ? "bbk-ok" : "bbk-x"}">${v.ok ? "✓" : "✕"}</span>${escapeHtml(v.label)}</div>
          <div class="bbk-leading-text" style="font-family:'${family}';line-height:${v.lineHeight};letter-spacing:${sp.letterSpacing}em;">${escapeHtml(sample)}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

// Each chosen direction gets a card whose corner shape IS that direction's
// own radius token (VISUAL_DIRECTIONS in brandbook-data.js) — the same
// value the Applications mockups are drawn with.
function directionBody(a) {
  if (!a.visualDirection.length) return bookEmpty(t("bg.book.noDirection"));
  return `
    <div class="bbk-cols">
      ${a.visualDirection
        .slice(0, 3)
        .map((d, i) => {
          const dir = VISUAL_DIRECTIONS[d] || { radius: "12px" };
          return `
          <div class="bbk-direction ${i === 0 ? "bbk-direction-lead" : ""}">
            <div class="bbk-direction-shape" style="border-radius:${dir.radius};"></div>
            <div class="bbk-direction-name">${escapeHtml(directionLabel(d))}</div>
            <div class="bbk-direction-desc">${escapeHtml(directionDescription(d))}</div>
            <div class="bbk-label" style="margin-top:auto;">Radius ${escapeHtml(dir.radius)}</div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

// Imagery Style ("Gaya Gambar") — one of the e-book's 7 mandatory Brand
// Guidelines components. Deterministic: derived from whichever Visual
// Direction the brand already picked (IMAGERY_STYLE_COPY in
// brandbook-data.js) instead of asking yet another question. The brand's
// own moodboard uploads sit beside it as a mosaic when there are any.
function imageryBody(a) {
  if (!a.visualDirection.length) return bookEmpty(t("bg.book.imageryEmpty"));
  const hasBoard = a.moodboard.length > 0;
  const styles = a.visualDirection
    .slice(0, hasBoard ? 2 : 3)
    .map((d) => {
      const style = IMAGERY_STYLE_COPY[d];
      if (!style) return "";
      return `
      <div class="bbk-imagery">
        <div class="bbk-imagery-name">${escapeHtml(directionLabel(d))}</div>
        ${[["lighting", style.lighting], ["subject", style.subject], ["treatment", style.treatment]].map(([k, v]) => `<div class="bbk-imagery-row"><span class="bbk-label">${escapeHtml(stripColon(t(`bg.book.${k}`)))}</span><span>${escapeHtml(v)}</span></div>`).join("")}
      </div>`;
    })
    .join("");
  return `
    <div class="bbk-cols">
      <div style="flex:1;min-width:0;display:flex;flex-direction:${hasBoard ? "column" : "row"};gap:22px;">${styles}</div>
      ${hasBoard ? `<div class="bbk-mosaic bbk-mosaic-${Math.min(a.moodboard.length, 6)}" style="flex:0 0 48%;">${a.moodboard.slice(0, 6).map((m, i) => `<div style="background-image:url('${m.dataUrl}');" role="img" aria-label="Moodboard ${i + 1}"></div>`).join("")}</div>` : ""}
    </div>
  `;
}

// General visual pantangan beyond the logo-specific ones — the e-book's
// "Pantangan Visual (Do's & Don'ts)" component, applied brand-wide.
const GENERAL_DONT_KEYS = ["bg.book.dont1", "bg.book.dont2", "bg.book.dont3", "bg.book.dont4", "bg.book.dont5"];
function generalDontsBody() {
  return `<div class="bbk-donts">${GENERAL_DONT_KEYS.map((k) => `<div class="bbk-dont"><span class="bbk-x">✕</span><div>${escapeHtml(t(k))}</div></div>`).join("")}</div>`;
}

function applicationsBody(a, brand) {
  if (!a.applications.length) return bookEmpty(t("bg.book.noApps"));
  return `<div class="bbk-apps bb-mockup-stage ${a.applications.length <= 3 ? "bbk-apps-few" : ""}">${a.applications.slice(0, 6).map((id) => renderMockup(id, a, brand)).join("")}</div>`;
}

// ---------- The page sequence: one source of truth for Review + PDF ----------
// The book is a list of chapters; every chapter opens on its own full-
// bleed divider (the way an agency-made brand book reads — a chapter
// opener you flip past, then the substance) followed by its content
// pages. Pages with nothing to show (no accent font, no mascots, no logo
// variants…) are simply not emitted, and chapter numbers / Contents page
// numbers / footers are all derived from what's actually left.
function buildBrandBookPages(brand, a) {
  const year = new Date().getFullYear();
  const page = (chapter, title, body, lead) => brandbookPageHTML({ chapter, title, lead, body, brand, a });
  const defs = [
    { title: t("guidelines.step.foundation"), sub: t("bg.divider.foundation.sub"), pages: (c) => [page(c, t("guidelines.step.foundation"), foundationBody(brand))] },
    {
      title: t("bg.toc.personality.label"),
      sub: t("bg.divider.personality.sub"),
      pages: (c) => [page(c, t("bg.toc.personality.label"), personalityBody(brand)), page(c, t("bg.foundation.tagline"), taglineBody(brand, a))],
    },
    { title: t("bg.toc.valueProp.label"), sub: t("bg.divider.valueProp.sub"), pages: (c) => [page(c, t("bg.toc.valueProp.label"), valuePropositionBody(a), t("bg.toc.valueProp.desc"))] },
    {
      title: t("bg.divider.identity.title"),
      sub: t("bg.divider.identity.sub"),
      pages: (c) => [
        page(c, t("guidelines.step.logo"), logoBody(a)),
        bookHasLogo(a) ? page(c, t("bg.page.logoUsage"), logoUsageBody(a)) : "",
        logoHasVariants(a) ? page(c, t("bg.page.logoVariants"), logoVariantsBody(a)) : "",
        a.mascots.length ? page(c, t("bg.mascot.title"), mascotsBody(a)) : "",
      ],
    },
    {
      title: t("bg.divider.color.title"),
      sub: t("bg.divider.color.sub"),
      pages: (c) => [
        page(c, t("guidelines.step.color"), colorPaletteBody(a)),
        page(c, t("bg.page.colorEssence"), colorEssenceBody(a)),
        page(c, t("bg.page.colorUsage"), colorUsageBody(a)),
      ],
    },
    {
      title: t("guidelines.step.typography"),
      sub: t("bg.divider.typography.sub"),
      pages: (c) => [
        typeSpecimenPageHTML(brand, a, c, "primary"),
        typeSpecimenPageHTML(brand, a, c, "secondary"),
        a.fonts.accent ? typeSpecimenPageHTML(brand, a, c, "accent") : "",
        ...a.extraFonts.map((f) => extraFontSpecimenPageHTML(brand, a, c, f)),
        a.fonts.primary ? page(c, t("bg.page.tkl"), typographySpacingBody(a, brand), t("bg.book.spacingIntro")) : "",
      ],
    },
    {
      title: t("bg.divider.direction.title"),
      sub: t("bg.divider.direction.sub"),
      pages: (c) => [
        page(c, t("guidelines.step.direction"), directionBody(a)),
        page(c, t("bg.toc.imagery.label"), imageryBody(a)),
        page(c, t("bg.toc.donts.label"), generalDontsBody()),
      ],
    },
    { title: t("bg.divider.action.title"), sub: t("bg.divider.action.sub"), pages: (c) => [page(c, t("guidelines.step.applications"), applicationsBody(a, brand))] },
  ];

  // Cover + Contents are pages 1 and 2, so the first chapter opens on 3.
  let next = 3;
  const chapters = defs
    .map((d, i) => {
      const chapter = { num: String(i + 1).padStart(2, "0"), title: d.title, sub: d.sub };
      chapter.html = [dividerPageHTML(chapter, brand, a), ...d.pages(chapter).filter(Boolean)];
      return chapter;
    })
    .map((c) => {
      c.startPage = next;
      next += c.html.length;
      return c;
    });

  const pages = [
    coverPageHTML(brand, a, year),
    brandbookPageHTML({ title: t("bg.page.contents"), body: tocBody(chapters), brand, a }),
    ...chapters.flatMap((c) => c.html),
    closingPageHTML(brand, a, year),
  ];
  // Page numbers are injected as a post-pass (a {{PN}} placeholder each
  // page builder leaves in its footer) — the total only exists once every
  // page above is already built.
  const total = pages.length;
  // Every page's root element ends in the same "\n    </div>\n  " tail, so
  // the watermark is spliced in as that root's last child.
  const locked = !ownsBookStyle(bookStyleOf(a));
  return pages.map((html, i) => {
    const numbered = html.replace("{{PN}}", `${String(i + 1).padStart(2, "0")} / ${total}`);
    if (!locked) return numbered;
    const end = numbered.lastIndexOf("</div>");
    return `${numbered.slice(0, end)}${WATERMARK_HTML}${numbered.slice(end)}`;
  });
}

// Scales every artboard in `sheet` to the sheet's own width (CSS `zoom`
// via --bbk-zoom) and keeps it in sync on resize. Call after inserting a
// .brandbook-sheet into the DOM.
function fitBrandBook(sheet) {
  if (!sheet) return;
  const apply = () => sheet.style.setProperty("--bbk-zoom", String(Math.min(1, sheet.clientWidth / BOOK_W)));
  apply();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(apply).observe(sheet);
}

// The editing view's right-pane preview — deliberately NOT the full,
// always-populated brand book (that's buildBrandBookPages, reserved for
// Review/PDF where seeing the finished product matters). This one starts
// as a genuinely blank sheet and only shows a section once it actually
// has data — logo appears the moment it's uploaded, colors the moment
// one's picked, etc. — instead of a skeleton full of placeholder content.
function progressivePreviewHTML(brand, a) {
  const hasLogo = a.logo.hasLogo === true && !!a.logo.dataUrl;
  const hasColors = !!a.colors.primary;
  const hasTypography = !!a.fonts.primary;
  const hasDirection = a.visualDirection.length > 0;
  const anything = hasLogo || hasColors || hasTypography || hasDirection;

  if (!anything) {
    return `
      <div class="bb-preview-sheet bb-preview-blank">
        <span>${t("bg.preview.blank")}</span>
      </div>
    `;
  }

  if (a.fonts.primary) ensureGoogleFont(a.fonts.primary);
  if (a.fonts.secondary) ensureGoogleFont(a.fonts.secondary);
  ensureCustomFontsFor(a);

  return `
    <div class="bb-preview-sheet">
      ${
        hasLogo
          ? `<div class="bb-preview-logo"><img src="${a.logo.dataUrl}" alt="Logo" /></div>`
          : `<div class="bb-preview-name" style="${hasTypography ? `font-family:'${escapeHtml(a.fonts.primary)}';` : ""}${hasColors ? `color:${a.colors.primary};` : ""}">${escapeHtml(brand.name)}</div>`
      }
      ${
        hasColors
          ? `<div class="bb-preview-block">
               <div class="bb-preview-label">${t("bg.preview.colors")}</div>
               <div class="bb-palette-row" style="margin-bottom:0;">${["primary", "secondary", "accent", "background", "text"].filter((k) => a.colors[k]).map((k) => `<div class="bb-swatch" style="background:${a.colors[k]};" title="${roleLabel(k)}"></div>`).join("")}</div>
             </div>`
          : ""
      }
      ${
        hasTypography
          ? `<div class="bb-preview-block">
               <div class="bb-preview-label">${t("guidelines.step.typography")}</div>
               <div style="font-family:'${escapeHtml(a.fonts.primary)}';font-size:21px;font-weight:700;">${escapeHtml(a.fonts.primary)}</div>
               ${a.fonts.secondary ? `<div style="font-family:'${escapeHtml(a.fonts.secondary)}';font-size:13px;color:#8a8580;">${escapeHtml(a.fonts.secondary)}</div>` : ""}
             </div>`
          : ""
      }
      ${
        hasDirection
          ? `<div class="bb-preview-block">
               <div class="bb-preview-label">${t("guidelines.step.direction")}</div>
               <div style="font-size:12.5px;">${a.visualDirection.map((d) => escapeHtml(directionLabel(d))).join(" · ")}</div>
             </div>`
          : ""
      }
    </div>
  `;
}

// ---------- Review step ----------
// Value Proposition and Colour Essence are the only two pages in this
// whole book without a deterministic source, so they're the only reason
// this button exists — everything else (Color/Typography/Logo/etc.) is
// already computed straight from brandbook-data.js, no AI or key needed.
function needsAiCopy(a) {
  return (!a.aiCopy?.valueProposition?.length && true) || (!a.aiCopy?.colorEssence?.primary && !!a.colors.primary);
}

// The style picker above the Review sheet: Classic (free) + the paid art
// styles. Picking a locked one still previews the whole book in it, with
// this brand's real data — watermarked, and with Download/Print swapped
// for the unlock button. The Photo style adds its background uploader.
const rpShort = (n) => `Rp ${n.toLocaleString("id-ID")}`;
function bookStylePickerHTML(a) {
  const current = bookStyleOf(a);
  const cards = BOOK_STYLES.map((s) => {
    const owned = ownsBookStyle(s);
    const badge = s.free ? t("bg.style.free") : owned ? t("bg.style.owned") : rpShort(s.price);
    return `
      <button type="button" class="bbk-style-card ${s.key === current.key ? "active" : ""}" data-book-style="${s.key}" aria-pressed="${s.key === current.key}">
        <span class="bbk-style-thumb bbk-style-thumb-${s.key}" style="${brandThemeVars({ ...a, bookPhoto: "" })}"><i></i><b>Aa</b></span>
        <span class="bbk-style-name">${!owned ? icon("lock", { size: 11 }) : ""}${escapeHtml(t(`bg.style.${s.key}.name`))}</span>
        <span class="bbk-style-desc">${escapeHtml(t(`bg.style.${s.key}.desc`))}</span>
        <span class="bbk-style-badge ${owned ? "" : "paid"}">${escapeHtml(badge)}</span>
      </button>`;
  }).join("");
  const locked = !ownsBookStyle(current);
  return `
    <div class="bbk-style-picker">
      <div class="bbk-style-picker-head">
        <strong>${t("bg.style.title")}</strong>
        <span>${t("bg.style.sub")}</span>
      </div>
      <div class="bbk-style-row">${cards}</div>
      ${
        current.photo
          ? `<div class="bbk-style-photo-row">
               <span>${icon("image", { size: 13 })} ${t(a.bookPhoto ? "bg.style.photoSet" : "bg.style.photoHint")}</span>
               <span class="flex gap-8">
                 ${a.bookPhoto ? `<button type="button" class="btn btn-ghost btn-sm" id="book-photo-remove">${t("bg.style.photoRemove")}</button>` : ""}
                 <button type="button" class="btn btn-secondary btn-sm" id="book-photo-pick">${icon("upload", { size: 12 })}${t(a.bookPhoto ? "bg.style.photoChange" : "bg.style.photoAdd")}</button>
                 <input type="file" id="book-photo-file" accept="image/*" style="display:none;" />
               </span>
             </div>`
          : ""
      }
      ${
        locked
          ? `<div class="bbk-style-lock">
               <span>${icon("lock", { size: 13 })} ${escapeHtml(t("bg.style.lockedNote", { name: t(`bg.style.${current.key}.name`) }))}</span>
               <button type="button" class="btn btn-primary btn-sm" data-book-unlock="${current.key}">${t("bg.style.unlock", { price: rpShort(current.price) })}</button>
             </div>`
          : ""
      }
    </div>
  `;
}

function reviewHTML(brand, state) {
  const a = state.answers;
  const homeReady = isStepFilled("color", a, state) && isStepFilled("typography", a, state);
  return `
    <h2 style="margin-bottom:6px;">${t("bg.review.title")}</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${t("bg.review.sub")}</p>
    ${
      needsAiCopy(a)
        ? `<div class="card dark-surface card-tight" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
             <div style="font-size:12.5px;color:var(--text-muted);max-width:480px;">${icon("bot", { size: 13 })} ${escapeHtml(t("bg.review.aiNote"))}</div>
             <button type="button" class="btn btn-secondary btn-sm" id="generate-ai-copy">${icon("bot", { size: 13 })}${t("bg.review.generate")}</button>
           </div>
           <div id="ai-copy-status"></div>`
        : `<button type="button" class="btn btn-ghost btn-sm" id="generate-ai-copy" style="margin-bottom:16px;">${icon("refresh", { size: 12 })}${t("bg.review.regenerate")}</button><div id="ai-copy-status"></div>`
    }
    ${bookStylePickerHTML(a)}
    <div ${bookSheetAttrs(a, "bbk-review-sheet")}>
      ${buildBrandBookPages(brand, a).join("")}
    </div>
    <div class="flex items-center justify-between">
      <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}${t("common.back")}</button>
      <div class="flex gap-8">
        ${homeReady ? `<button type="button" class="btn btn-secondary" id="wiz-home">${icon("check", { size: 14 })}${t("guidelines.backHome")}</button>` : ""}
        ${
          ownsBookStyle(bookStyleOf(a))
            ? `<button type="button" class="btn btn-secondary" id="wiz-pdf">${icon("download", { size: 14 })}${t("bg.review.downloadPdf")}</button>`
            : `<button type="button" class="btn btn-secondary" data-book-unlock="${bookStyleOf(a).key}">${icon("lock", { size: 14 })}${t("bg.style.unlock", { price: rpShort(bookStyleOf(a).price) })}</button>`
        }
        <button type="button" class="btn btn-primary" id="wiz-save">${icon("check", { size: 15 })}${t("guidelines.saveBook")}</button>
      </div>
    </div>
  `;
}

function wireReview(root, brandId, brand, state, refresh) {
  fitBrandBook(qs(".brandbook-sheet", root));
  qs("#wiz-home", root)?.addEventListener("click", () => goHomeFromGuidelines(brandId, state));
  qs("#wiz-back", root).addEventListener("click", () => {
    state.stepIndex = STEPS.length - 1;
    refresh();
  });
  qs("#wiz-save", root).addEventListener("click", () => {
    updateBrand(brandId, { brandGuidelines: { ...state.answers } });
    toast(t("guidelines.bookSaved"));
    // Same "take them back to where the progress actually shows" pattern as
    // Brand DNA's own save: the hub, so anything still unfinished (sections
    // can be visited out of order — see the comment above navHTML) stays
    // visible — except one level further out to Home when this save is what
    // finishes the WHOLE Builder (both doors), since there's nothing left to
    // do on the hub at that point. Applies in both modes: sending a guided
    // user straight to Beranda from an incomplete book (previously the
    // "guided → always Beranda" rule below) made it look finished when it
    // wasn't.
    const wholeBuilderDone = isBrandBuilderComplete(brand);
    if (wholeBuilderDone) markBuilderJustCompleted(brandId);
    location.hash = wholeBuilderDone ? `#/brand/${brandId}` : `#/brand/${brandId}/builder`;
  });
  qs("#wiz-pdf", root)?.addEventListener("click", () => openBrandBookPdf(brand, state.answers));
  wireBookStylePicker(root, brandId, state, refresh);
  qs("#generate-ai-copy", root)?.addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const statusEl = qs("#ai-copy-status", root);
    if (!hasAiKey(ai)) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin-bottom:12px;">${t("bg.review.noKey")}</div>`;
      return;
    }
    const btn = qs("#generate-ai-copy", root);
    btn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status" style="margin-bottom:12px;"><div class="spinner"></div><span>${escapeHtml(t("bg.review.writing"))}</span></div>`;
    try {
      const [pillars, essence] = await Promise.all([
        generateValueProposition(ai, { brand }),
        state.answers.colors.primary
          ? generateColorEssence(ai, { brand, colors: state.answers.colors, colorFeelings: state.answers.colorFeelings })
          : Promise.resolve(null),
      ]);
      state.answers.aiCopy = { valueProposition: pillars, colorEssence: essence || state.answers.aiCopy.colorEssence };
      updateBrand(brandId, { brandGuidelines: { ...state.answers } });
      toast(t("bg.review.generated"));
      refresh();
    } catch (err) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin-bottom:12px;">${escapeHtml(err instanceof AiApiError ? err.message : t("bg.review.generateFail"))}</div>`;
      btn.disabled = false;
    }
  });
}

function wireBookStylePicker(root, brandId, state, refresh) {
  const a = state.answers;
  // The pick (and the photo) persist right away, like the AI copy does —
  // they're presentation choices, not answers someone would want to discard
  // by leaving Review without pressing Save.
  const persist = () => updateBrand(brandId, { brandGuidelines: { ...a } });
  qsa("[data-book-style]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      if (a.bookStyle === btn.dataset.bookStyle) return;
      a.bookStyle = btn.dataset.bookStyle;
      persist();
      refresh();
    })
  );
  qsa("[data-book-unlock]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const style = BOOK_STYLES.find((s) => s.key === btn.dataset.bookUnlock);
      if (!style?.payKey) return;
      // The unlock lands via the webhook → accounts/{uid} snapshot →
      // getCachedAccount(); poll that briefly so the watermark drops on its
      // own once the payment settles, no reload needed.
      payPlan(style.payKey, currentUid(), {
        onSuccess: () => {
          let tries = 0;
          const timer = setInterval(() => {
            if (!root.isConnected || ++tries > 45) return clearInterval(timer);
            if (!ownsBookStyle(style)) return;
            clearInterval(timer);
            toast(t("bg.style.unlocked", { name: t(`bg.style.${style.key}.name`) }));
            refresh();
          }, 2000);
        },
      });
    })
  );
  const file = qs("#book-photo-file", root);
  qs("#book-photo-pick", root)?.addEventListener("click", () => file.click());
  file?.addEventListener("change", async () => {
    if (!file.files?.[0]) return;
    try {
      // Sized for a 1123px-wide artboard at the PDF's 2x, and JPEG so it
      // stays a small slice of the brand doc's 1MiB Firestore budget.
      a.bookPhoto = await resizeImageFile(file.files[0], { maxDimension: 1600, quality: 0.72, format: "image/jpeg" });
      persist();
      refresh();
    } catch {
      toast(t("bg.style.photoFail"), "error");
    }
  });
  qs("#book-photo-remove", root)?.addEventListener("click", () => {
    a.bookPhoto = "";
    persist();
    refresh();
  });
  // Deterrents on a locked preview (the watermark is the real protection).
  const sheet = qs(".brandbook-sheet.bbk-locked", root);
  sheet?.addEventListener("contextmenu", (e) => e.preventDefault());
  sheet?.addEventListener("dragstart", (e) => e.preventDefault());
}

// ---------- PDF (A4 landscape, one artboard per page) ----------
// Lazy-loaded — most brand-guidelines sessions never open the PDF modal at
// all, so this shouldn't cost anything on every page load. html2canvas
// rasterizes each artboard, jsPDF assembles them into a real downloadable
// .pdf directly, no print dialog / "choose Save as PDF" step required.
const PDF_LIBS = [
  { ready: () => !!window.html2canvas, src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" },
  { ready: () => !!window.jspdf?.jsPDF, src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" },
];
let pdfLibsLoading = null;
function ensurePdfLibs() {
  if (PDF_LIBS.every((l) => l.ready())) return Promise.resolve();
  if (pdfLibsLoading) return pdfLibsLoading;
  pdfLibsLoading = Promise.all(
    PDF_LIBS.filter((l) => !l.ready()).map(
      (l) =>
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = l.src;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        })
    )
  ).catch((err) => {
    pdfLibsLoading = null; // let the next click retry instead of caching the failure
    throw err;
  });
  return pdfLibsLoading;
}

// Resolves once an <img> has loaded (or failed). Deliberately not
// img.decode(): that promise never settles while the tab is in the
// background, which would hang the whole export.
function imageReady(img) {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
}

// html2canvas ignores CSS `filter`, which the book relies on to show the
// one uploaded logo in white on dark/primary tiles (and the "don't
// recolor" example) — so before capture, every filtered <img> is redrawn
// through a canvas with that same filter and swapped for the baked result.
// SVG logos go through the same redraw (filtered or not): html2canvas
// drops SVG images that carry no intrinsic width/height.
async function bakeImageFilters(host) {
  const imgs = qsa("img", host).filter((img) => getComputedStyle(img).filter !== "none" || /^data:image\/svg/i.test(img.src));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        await imageReady(img);
        const canvas = document.createElement("canvas");
        // SVGs report a tiny (or no) natural size — rasterize at 4x the
        // displayed box instead so they stay crisp at the PDF's 2x scale.
        const isSvg = /^data:image\/svg/i.test(img.src);
        canvas.width = (isSvg ? img.offsetWidth * 4 : img.naturalWidth) || 600;
        canvas.height = (isSvg ? img.offsetHeight * 4 : img.naturalHeight) || 600;
        const ctx = canvas.getContext("2d");
        if (!("filter" in ctx)) return; // browser can't bake it; leave the plain logo
        const w = img.offsetWidth, h = img.offsetHeight;
        ctx.filter = getComputedStyle(img).filter;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.style.width = `${w}px`;
        img.style.height = `${h}px`;
        img.src = canvas.toDataURL("image/png");
        img.style.filter = "none";
        await imageReady(img);
      } catch {
        /* a logo that fails to decode just renders unfiltered */
      }
    })
  );
}

// Renders the book into an off-screen, unscaled (zoom 1) copy of the sheet
// and captures it one artboard at a time — a single tall canvas of ~30
// pages blows past the browser's max canvas height and comes out blank.
async function downloadBrandBookPdf(brand, a, onProgress) {
  if (!ownsBookStyle(bookStyleOf(a))) throw new Error("locked book style");
  await ensurePdfLibs();
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div ${bookSheetAttrs(a, "bbk-export-host")}>${buildBrandBookPages(brand, a).join("")}</div>`;
  const host = wrap.firstElementChild;
  host.style.setProperty("--bbk-zoom", "1");
  document.body.appendChild(host);
  try {
    await Promise.all(qsa("img", host).map(imageReady));
    if (document.fonts?.ready) await document.fonts.ready;
    await bakeImageFilters(host);
    const pages = qsa(".bbk-page", host);
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i + 1, pages.length);
      const canvas = await window.html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff", width: BOOK_W, height: BOOK_H, windowWidth: BOOK_W, logging: false });
      if (i > 0) pdf.addPage("a4", "landscape");
      pdf.addImage(canvas.toDataURL("image/jpeg", bookStyleOf(a).photo ? 0.86 : 0.93), "JPEG", 0, 0, 297, 210, undefined, "FAST");
    }
    pdf.save(`${brand.name.replace(/[^a-z0-9]+/gi, "-")}-brand-guidelines.pdf`);
  } finally {
    host.remove();
  }
}

function openBrandBookPdf(brand, a) {
  if (!ownsBookStyle(bookStyleOf(a))) return;
  const pages = buildBrandBookPages(brand, a).join("");

  const overlay = openModal({
    title: t("bg.pdf.title"),
    width: "min(1100px,94vw)",
    bodyHTML: `<div class="report-preview-wrap"><div id="bb-report-sheet" ${bookSheetAttrs(a)}>${pages}</div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="bb-pdf-close">${t("common.close")}</button>
      <button class="btn btn-secondary" id="bb-pdf-print">${icon("download", { size: 14 })}${t("bg.pdf.print")}</button>
      <button class="btn btn-primary" id="bb-pdf-download">${icon("download", { size: 14 })}${t("bg.review.downloadPdf")}</button>
    `,
  });
  fitBrandBook(qs("#bb-report-sheet", overlay));
  qs("#bb-pdf-close", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#bb-pdf-print", overlay).addEventListener("click", () => {
    toast(t("bg.pdf.printHint"));
    setTimeout(() => window.print(), 400);
  });
  qs("#bb-pdf-download", overlay).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = t("bg.pdf.preparing");
    try {
      await downloadBrandBookPdf(brand, a, (n, total) => {
        btn.textContent = `${t("bg.pdf.preparing")} ${n}/${total}`;
      });
    } catch (err) {
      console.error("PDF generation failed", err);
      toast(t("bg.pdf.fail"), "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}
