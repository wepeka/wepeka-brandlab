import { getBrand, updateBrand } from "../store.js";
import { qs, qsa, escapeHtml, resizeImageFile, toast } from "../dom.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import {
  COLOR_FEELINGS, COLOR_PALETTES, COLOR_FORMULA_LABELS, hexToRgb, hexToCmyk,
  TYPOGRAPHY_FEELINGS, FONT_LIBRARY, FONT_PAIRINGS, PREMIUM_FONT_LINK,
  VISUAL_DIRECTIONS, APPLICATION_TYPES,
} from "../brandbook-data.js";
import { checkPersonalityConsistency } from "../consistency-engine.js";

// A guided, two-pane Brand Book builder (questions left, live preview
// right) built on top of Brand DNA rather than re-asking brand name/
// audience/personality — per the user's confirmed direction, every brand
// builds this fresh (no upload-and-extract path), and every
// recommendation below is a deterministic lookup from brandbook-data.js,
// not an AI call, so this works with no API key configured.
const STEPS = [
  { key: "foundation", title: "Brand Foundation" },
  { key: "logo", title: "Logo" },
  { key: "color", title: "Color System" },
  { key: "typography", title: "Typography" },
  { key: "direction", title: "Visual Direction" },
  { key: "applications", title: "Brand Applications" },
];

const MOCKUP_RENDERERS = {
  social: socialPostMockup,
  "business-card": businessCardMockup,
  website: websiteHeroMockup,
  packaging: packagingMockup,
  poster: posterMockup,
  ad: digitalAdMockup,
};

const loadedFonts = new Set();
function ensureGoogleFont(family) {
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

// Brand Book is explicitly built ON Brand DNA (tagline/audience/
// positioning) rather than re-asking those — this is the dependency gate.
function brandDnaReady(dna = {}) {
  return !!(dna.tagline?.trim() && dna.targetAudience?.trim() && dna.positioning?.trim());
}

function suggestedApplications(brand) {
  const ids = ["social", "business-card", "website"];
  if ((brand.brandDNA.productsServices || []).length) ids.push("packaging");
  return ids;
}

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }

  if (!brandDnaReady(brand.brandDNA)) {
    paintGate(root, brand);
    return () => {};
  }

  const bg = brand.brandGuidelines || {};
  const state = {
    stepIndex: 0,
    answers: {
      logo: { hasLogo: bg.logo?.hasLogo ?? null, dataUrl: bg.logo?.dataUrl || "" },
      colorFeelings: bg.colorFeelings || [],
      colorFormula: bg.colorFormula || "",
      colors: { primary: "", secondary: "", accent: "", background: "", text: "", ...(bg.colors || {}) },
      typographyFeelings: bg.typographyFeelings || [],
      fonts: { primary: "", secondary: "", accent: "", ...(bg.fonts || {}) },
      visualDirection: bg.visualDirection || [],
      applications: bg.applications?.length ? bg.applications : suggestedApplications(brand),
    },
  };
  const refresh = () => paint(root, brandId, brand, state, refresh);
  refresh();
  return () => {};
}

function paintGate(root, brand) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Brand Guidelines</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div class="content-view-card" style="max-width:480px;cursor:default;">
      <div class="icon-wrap">${icon("book", { size: 22 })}</div>
      <h3>Complete your Brand DNA first</h3>
      <p>Your Brand Book is built on top of your Brand DNA — tagline, audience, and positioning — so you never have to explain your brand twice.</p>
    </div>
    <a class="btn btn-primary" href="#/brand/${brand.id}/dna" style="margin-top:16px;display:inline-flex;">${icon("target", { size: 14 })}Go to Brand DNA</a>
  `;
}

function paint(root, brandId, brand, state, refresh) {
  const total = STEPS.length + 1; // +1 for Review
  const isReview = state.stepIndex >= STEPS.length;
  const step = isReview ? null : STEPS[state.stepIndex];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Brand Guidelines</div>
        <h1>${brand.name}</h1>
      </div>
    </div>
    <div class="brandbook-layout">
      <div class="brandbook-left">
        <div class="flex items-center justify-between" style="margin-bottom:6px;">
          <span class="text-faint" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">${isReview ? "Review" : `Step ${state.stepIndex + 1} of ${total - 1}`}</span>
        </div>
        <div style="height:5px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-bottom:24px;">
          <div style="height:100%;background:var(--accent);width:${Math.round(((state.stepIndex + 1) / total) * 100)}%;transition:width .2s;"></div>
        </div>
        ${isReview ? reviewHTML(brand, state) : stepHTML(step, state, brand)}
      </div>
      <div class="brandbook-right">${livePreviewHTML(brand, state.answers)}</div>
    </div>
  `;

  if (!isReview) wireStep(root, brandId, brand, state, refresh);
  else wireReview(root, brandId, brand, state, refresh);
}

function isStepFilled(stepKey, a) {
  switch (stepKey) {
    case "logo": return a.logo.hasLogo === false || (a.logo.hasLogo === true && !!a.logo.dataUrl);
    case "color": return a.colorFeelings.length > 0 && !!a.colors.primary;
    case "typography": return a.typographyFeelings.length > 0 && !!a.fonts.primary && !!a.fonts.secondary;
    case "direction": return a.visualDirection.length > 0;
    case "applications": return a.applications.length > 0;
    default: return true;
  }
}

function navHTML(state, nextDisabled) {
  return `
    <div class="flex items-center justify-between" style="margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="wiz-back" ${state.stepIndex === 0 ? "disabled" : ""}>${icon("chevronLeft", { size: 14 })}Back</button>
      <div style="text-align:right;">
        <button type="button" class="btn btn-primary" id="wiz-next" ${nextDisabled ? "disabled" : ""}>Next${icon("chevronRight", { size: 14 })}</button>
        ${nextDisabled ? `<div class="text-faint" style="font-size:11px;margin-top:6px;">Answer this to continue</div>` : ""}
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
    case "logo": return logoStepHTML(state);
    case "color": return colorStepHTML(state, brand);
    case "typography": return typographyStepHTML(state, brand);
    case "direction": return directionStepHTML(state);
    case "applications": return applicationsStepHTML(state, brand);
    default: return "";
  }
}

function wireStep(root, brandId, brand, state, refresh) {
  const step = STEPS[state.stepIndex];
  qs("#wiz-back", root)?.addEventListener("click", () => {
    state.stepIndex = Math.max(0, state.stepIndex - 1);
    refresh();
  });
  qs("#wiz-next", root)?.addEventListener("click", () => {
    if (qs("#wiz-next", root).disabled) return;
    state.stepIndex += 1;
    refresh();
  });

  qs("[data-dismiss-consistency]", root)?.addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.dismissConsistency;
    const dismissed = new Set(brand.brandBuilder.consistencyDismissed || []);
    dismissed.add(id);
    updateBrand(brandId, { brandBuilder: { ...brand.brandBuilder, consistencyDismissed: [...dismissed] } });
    refresh();
  });

  if (step.key === "logo") wireLogoStep(root, state, refresh);
  if (step.key === "color") wireColorStep(root, state, refresh);
  if (step.key === "typography") wireTypographyStep(root, state, refresh);
  if (step.key === "direction") wireDirectionStep(root, state, refresh);
  if (step.key === "applications") wireApplicationsStep(root, state, refresh);
}

// ---------- Step 1: Foundation (read-only recap of Brand DNA) ----------
function foundationStepHTML(brand, state) {
  const dna = brand.brandDNA;
  return `
    <h2 style="margin-bottom:6px;">Brand Foundation</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 18px;">Pulled straight from your Brand DNA — no need to explain your brand twice.</p>
    <div class="card card-tight" style="margin-bottom:14px;">
      ${reviewRow("Brand name", brand.name)}
      ${reviewRow("Tagline", dna.tagline)}
      ${reviewRow("Target audience", dna.targetAudience)}
      ${reviewRow("Positioning", dna.positioning)}
      ${dna.personality?.length ? reviewRow("Personality", dna.personality.join(", ")) : ""}
    </div>
    <a href="#/brand/${brand.id}/dna" style="font-size:12.5px;font-weight:700;color:var(--accent);">Edit in Brand DNA →</a>
    ${navHTML(state, false)}
  `;
}

// ---------- Step 2: Logo ----------
function logoStepHTML(state) {
  const { hasLogo, dataUrl } = state.answers.logo;
  return `
    <h2 style="margin-bottom:6px;">Do you already have a logo?</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Your logo is your brand's face — every other page in this Brand Book builds around it.</p>
    <div class="flex gap-8" style="margin-bottom:18px;">
      <button type="button" class="btn ${hasLogo === true ? "btn-primary" : "btn-secondary"}" id="logo-yes">Yes, I have a logo</button>
      <button type="button" class="btn ${hasLogo === false ? "btn-primary" : "btn-secondary"}" id="logo-no">No, I don't have one</button>
    </div>
    ${hasLogo === true ? `
      <div class="logo-gallery" style="margin-bottom:10px;">
        ${dataUrl
          ? `<div class="logo-thumb"><img src="${dataUrl}" alt="Logo" /><button type="button" class="logo-remove" id="logo-remove">${icon("x", { size: 10 })}</button></div>`
          : `<button type="button" class="logo-add-tile" id="logo-add">${icon("upload", { size: 18 })}</button>`}
      </div>
      <input type="file" id="logo-file" accept="image/*" hidden />
      ${!dataUrl ? `<p class="text-faint" style="font-size:11.5px;">PNG with a transparent background works best.</p>` : ""}
    ` : ""}
    ${hasLogo === false ? `
      <div class="card card-tight" style="font-size:12.5px;line-height:1.6;color:var(--text-muted);margin-bottom:12px;">
        <p style="margin:0 0 8px;">A logo mostly comes in one of three forms: a <strong>wordmark</strong> (just your name, styled), an <strong>icon</strong> (a symbol on its own), or a <strong>combination</strong> of both — the safest choice when you're just starting out.</p>
        <p style="margin:0;">Keep it flat and simple — modern logos skip gradients and 3D effects so they still read clearly at the size of an app icon.</p>
      </div>
      <p class="text-faint" style="font-size:11.5px;">You can continue without one — logo creation is a separate WPK service. This Brand Book will simply skip the logo pages for now.</p>
    ` : ""}
    ${navHTML(state, !isStepFilled("logo", state.answers))}
  `;
}

function wireLogoStep(root, state, refresh) {
  qs("#logo-yes", root)?.addEventListener("click", () => { state.answers.logo.hasLogo = true; refresh(); });
  qs("#logo-no", root)?.addEventListener("click", () => { state.answers.logo.hasLogo = false; state.answers.logo.dataUrl = ""; refresh(); });
  qs("#logo-add", root)?.addEventListener("click", () => qs("#logo-file", root).click());
  qs("#logo-file", root)?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    state.answers.logo.dataUrl = await resizeImageFile(file, { maxDimension: 600 });
    refresh();
  });
  qs("#logo-remove", root)?.addEventListener("click", () => { state.answers.logo.dataUrl = ""; refresh(); });
}

// Non-blocking nudge from the Consistency Engine (js/consistency-engine.js):
// shown only once the Brand Builder Personality stage has established a
// character and one of the feeling(s) picked here (color allows more than
// one — the most severe conflict wins, not every one) drifts from it.
// Dismissible per exact combination via brand.brandBuilder.
// consistencyDismissed; never blocks picking whatever the user wants.
function worstConsistencyBannerHTML(brand, feelings, label) {
  const personalityFeeling = brand.brandBuilder?.personality?.feeling;
  if (!personalityFeeling) return "";
  const dismissed = brand.brandBuilder?.consistencyDismissed || [];
  const warnings = feelings
    .map((f) => checkPersonalityConsistency(personalityFeeling, f, label))
    .filter((w) => w && !dismissed.includes(w.id));
  if (!warnings.length) return "";
  const worst = warnings.find((w) => w.level === "strong") || warnings[0];
  return `<div class="hint" style="margin-bottom:14px;border-color:${worst.level === "strong" ? "var(--health-poor)" : "var(--border)"};" data-consistency-warning="${worst.id}">${icon("info", { size: 12 })}<span>${escapeHtml(worst.message)}</span><button type="button" class="icon-btn" data-dismiss-consistency="${worst.id}" title="Tutup" style="margin-left:auto;flex:none;">${icon("x", { size: 11 })}</button></div>`;
}

// ---------- Step 3: Color System ----------
function colorStepHTML(state, brand) {
  const a = state.answers;
  const chips = COLOR_FEELINGS.map((f) => chipHTML(f, f, a.colorFeelings.includes(f), "data-feeling")).join("");
  const recs = a.colorFeelings.flatMap((f) => (COLOR_PALETTES[f] || []).map((p) => ({ feeling: f, ...p })));
  return `
    <h2 style="margin-bottom:6px;">What feeling should your colors create?</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 14px;">Pick one or more — color is the fastest way a brand communicates before anyone reads a word.</p>
    <div class="bb-chip-row">${chips}</div>
    ${worstConsistencyBannerHTML(brand, a.colorFeelings, "warna")}
    ${recs.length ? recs.map((p, i) => `
      <div class="card card-tight" style="margin-bottom:10px;">
        <div class="flex items-center justify-between" style="margin-bottom:10px;">
          <span style="font-size:12.5px;font-weight:700;">Recommended for "${escapeHtml(p.feeling)}"</span>
          <button type="button" class="btn btn-secondary" data-use-palette="${i}" style="padding:6px 12px;font-size:11.5px;">Use this</button>
        </div>
        <div class="bb-palette-row">${["primary", "secondary", "accent", "background", "text"].map((k) => `<div class="bb-swatch" style="background:${p[k]};" title="${k}"></div>`).join("")}</div>
        <p class="bb-direction-desc">${COLOR_FORMULA_LABELS[p.formula] || ""}</p>
      </div>
    `).join("") : `<p class="text-faint" style="font-size:12px;margin-bottom:16px;">Pick a feeling above to see a recommended palette.</p>`}
    <div class="card card-tight" style="margin-bottom:8px;">
      <div style="font-size:12.5px;font-weight:700;margin-bottom:4px;">Customize</div>
      ${["primary", "secondary", "accent", "background", "text"].map((k) => colorFieldHTML(k, a.colors[k])).join("")}
    </div>
    ${navHTML(state, !isStepFilled("color", a))}
  `;
}

function colorFieldHTML(key, hex) {
  const value = hex || "#cccccc";
  const rgb = hexToRgb(value);
  const cmyk = hexToCmyk(value);
  return `
    <div class="bb-color-field">
      <input type="color" id="color-${key}" value="${value}" />
      <div>
        <div style="font-size:12.5px;font-weight:700;text-transform:capitalize;">${key}</div>
        <div class="bb-color-code">${value.toUpperCase()} · RGB ${rgb.r},${rgb.g},${rgb.b} · CMYK ${cmyk.c},${cmyk.m},${cmyk.y},${cmyk.k}</div>
      </div>
    </div>
  `;
}

function wireColorStep(root, state, refresh) {
  qsa("[data-feeling]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const f = el.dataset.feeling;
      const set = new Set(state.answers.colorFeelings);
      if (el.checked) set.add(f); else set.delete(f);
      state.answers.colorFeelings = [...set];
      refresh();
    });
  });
  qsa("[data-use-palette]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const recs = state.answers.colorFeelings.flatMap((f) => (COLOR_PALETTES[f] || []).map((p) => ({ feeling: f, ...p })));
      const p = recs[Number(btn.dataset.usePalette)];
      if (!p) return;
      state.answers.colors = { primary: p.primary, secondary: p.secondary, accent: p.accent, background: p.background, text: p.text };
      state.answers.colorFormula = p.formula;
      refresh();
    });
  });
  ["primary", "secondary", "accent", "background", "text"].forEach((k) => {
    qs(`#color-${k}`, root)?.addEventListener("change", (e) => {
      state.answers.colors[k] = e.target.value;
      refresh();
    });
  });
}

// ---------- Step 4: Typography ----------
function typographyStepHTML(state, brand) {
  const a = state.answers;
  const chips = TYPOGRAPHY_FEELINGS.map((f) => chipHTML(f, f, a.typographyFeelings.includes(f), "data-feeling")).join("");
  const rec = a.typographyFeelings.length ? FONT_PAIRINGS[a.typographyFeelings[0]] : null;
  if (rec) { ensureGoogleFont(rec.primary); ensureGoogleFont(rec.secondary); }
  if (a.fonts.primary) ensureGoogleFont(a.fonts.primary);
  if (a.fonts.secondary) ensureGoogleFont(a.fonts.secondary);
  if (a.fonts.accent) ensureGoogleFont(a.fonts.accent);
  const fontOptions = (selected) => FONT_LIBRARY.map((f) => `<option value="${f.family}" ${selected === f.family ? "selected" : ""}>${f.family} (${f.category})</option>`).join("");
  return `
    <h2 style="margin-bottom:6px;">What should your typography feel like?</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 14px;">Type isn't just about being readable — it's the "tone of voice" of your visuals.</p>
    <div class="bb-chip-row">${chips}</div>
    ${worstConsistencyBannerHTML(brand, a.typographyFeelings, "typography")}
    ${rec ? `
      <div class="card card-tight" style="margin-bottom:16px;">
        <div class="flex items-center justify-between" style="margin-bottom:10px;">
          <span style="font-size:12.5px;font-weight:700;">Recommended for "${escapeHtml(a.typographyFeelings[0])}"</span>
          <button type="button" class="btn btn-secondary" id="use-font-pairing" style="padding:6px 12px;font-size:11.5px;">Use this pairing</button>
        </div>
        <div class="bb-font-preview" style="font-family:'${rec.primary}';">${escapeHtml(rec.primary)}</div>
        <div class="bb-font-meta" style="font-family:'${rec.secondary}';">${escapeHtml(rec.secondary)} — body text<span class="bb-font-badge">Free</span></div>
      </div>
    ` : `<p class="text-faint" style="font-size:12px;margin-bottom:16px;">Pick a feeling above to see a recommended pairing.</p>`}
    <div class="field">
      <label>Primary Font (headings)</label>
      <select class="select" id="font-primary"><option value="">Choose a font…</option>${fontOptions(a.fonts.primary)}</select>
    </div>
    <div class="field">
      <label>Secondary Font (body text)</label>
      <select class="select" id="font-secondary"><option value="">Choose a font…</option>${fontOptions(a.fonts.secondary)}</select>
    </div>
    <div class="field">
      <label>Accent Font (optional)</label>
      <select class="select" id="font-accent"><option value="">None</option>${fontOptions(a.fonts.accent)}</select>
    </div>
    <p class="text-faint" style="font-size:11.5px;">All fonts above are free (Google Fonts). Looking for something more exclusive? <a href="${PREMIUM_FONT_LINK}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:700;">Browse premium fonts on Envato Elements ↗</a></p>
    ${navHTML(state, !isStepFilled("typography", a))}
  `;
}

function wireTypographyStep(root, state, refresh) {
  qsa("[data-feeling]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const f = el.dataset.feeling;
      const set = new Set(state.answers.typographyFeelings);
      if (el.checked) set.add(f); else set.delete(f);
      state.answers.typographyFeelings = [...set];
      refresh();
    });
  });
  qs("#use-font-pairing", root)?.addEventListener("click", () => {
    const rec = FONT_PAIRINGS[state.answers.typographyFeelings[0]];
    if (!rec) return;
    state.answers.fonts.primary = rec.primary;
    state.answers.fonts.secondary = rec.secondary;
    refresh();
  });
  qs("#font-primary", root)?.addEventListener("change", (e) => { state.answers.fonts.primary = e.target.value; refresh(); });
  qs("#font-secondary", root)?.addEventListener("change", (e) => { state.answers.fonts.secondary = e.target.value; refresh(); });
  qs("#font-accent", root)?.addEventListener("change", (e) => { state.answers.fonts.accent = e.target.value; refresh(); });
}

// ---------- Step 5: Visual Direction ----------
function directionStepHTML(state) {
  const a = state.answers;
  const chips = Object.keys(VISUAL_DIRECTIONS).map((k) => chipHTML(k, k, a.visualDirection.includes(k), "data-direction")).join("");
  return `
    <h2 style="margin-bottom:6px;">Which visual direction feels closest to your brand?</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 6px;">Pick up to 2 — this shapes the spacing, shapes, and energy of everything below.</p>
    <div class="bb-chip-row">${chips}</div>
    ${a.visualDirection.map((d) => `<p class="bb-direction-desc"><strong>${escapeHtml(d)}</strong> — ${VISUAL_DIRECTIONS[d].description}</p>`).join("")}
    ${navHTML(state, !isStepFilled("direction", a))}
  `;
}

function wireDirectionStep(root, state, refresh) {
  qsa("[data-direction]", root).forEach((el) => {
    el.addEventListener("change", () => {
      const d = el.dataset.direction;
      let list = state.answers.visualDirection.filter((x) => x !== d);
      if (el.checked) {
        if (list.length >= 2) { toast("Pick up to 2 — remove one first", "error"); el.checked = false; return; }
        list = [...list, d];
      }
      state.answers.visualDirection = list;
      refresh();
    });
  });
}

// ---------- Step 6: Brand Applications ----------
function applicationsStepHTML(state, brand) {
  const a = state.answers;
  const chips = APPLICATION_TYPES.map((t) => chipHTML(t.id, t.label, a.applications.includes(t.id), "data-app")).join("");
  return `
    <h2 style="margin-bottom:6px;">Where should this brand show up?</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 16px;">Pick the touchpoints relevant to your business — each one gets its own live mockup below.</p>
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
      <div class="bb-mockup-label">Social Media Post</div>
      <div class="bb-mockup bb-mockup-social">
        ${answers.logo.dataUrl ? `<img src="${answers.logo.dataUrl}" style="height:22px;object-fit:contain;" alt="" />` : `<div class="bb-mockup-body" style="font-weight:700;">${escapeHtml(brand.name)}</div>`}
        <div class="bb-mockup-headline">${escapeHtml(brand.brandDNA.tagline || "Your headline here")}</div>
        <div class="bb-mockup-chip">Shop now</div>
      </div>
    </div>
  `;
}

function businessCardMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">Business Card</div>
      <div class="bb-mockup bb-mockup-card" style="background:var(--bb-primary);">
        ${answers.logo.dataUrl ? `<img src="${answers.logo.dataUrl}" style="height:26px;object-fit:contain;filter:brightness(0) invert(1);" alt="" />` : `<div class="bb-mockup-headline" style="color:var(--bb-bg);">${escapeHtml(brand.name)}</div>`}
        <div class="bb-mockup-body" style="color:var(--bb-bg);opacity:.85;">${escapeHtml(brand.brandDNA.tagline || "")}</div>
      </div>
    </div>
  `;
}

function websiteHeroMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">Website Hero</div>
      <div class="bb-mockup bb-mockup-website">
        <div class="bb-mockup-browser-bar"><span class="bb-mockup-browser-dot"></span><span class="bb-mockup-browser-dot"></span><span class="bb-mockup-browser-dot"></span></div>
        <div class="bb-mockup-website-body">
          <div class="bb-mockup-headline" style="font-size:17px;">${escapeHtml(brand.brandDNA.tagline || brand.name)}</div>
          <div class="bb-mockup-body">${escapeHtml((brand.brandDNA.positioning || "").slice(0, 70))}</div>
          <div class="bb-mockup-cta">Get started</div>
        </div>
      </div>
    </div>
  `;
}

function packagingMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">Packaging Label</div>
      <div class="bb-mockup bb-mockup-packaging" style="background:var(--bb-bg);">
        ${answers.logo.dataUrl ? `<img src="${answers.logo.dataUrl}" style="height:30px;object-fit:contain;" alt="" />` : ""}
        <div class="bb-mockup-headline" style="font-size:14px;">${escapeHtml(brand.name)}</div>
        <div class="bb-mockup-body">${escapeHtml((brand.brandDNA.productsServices || [])[0] || "")}</div>
      </div>
    </div>
  `;
}

function posterMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">Poster</div>
      <div class="bb-mockup bb-mockup-poster" style="background:var(--bb-primary);">
        <div class="bb-mockup-headline" style="font-size:24px;color:var(--bb-bg);">${escapeHtml(brand.brandDNA.tagline || brand.name)}</div>
        <div class="bb-mockup-chip">${escapeHtml(brand.brandDNA.callToAction || "Learn more")}</div>
      </div>
    </div>
  `;
}

function digitalAdMockup(answers, brand) {
  return `
    <div>
      <div class="bb-mockup-label">Digital Ad</div>
      <div class="bb-mockup bb-mockup-ad" style="background:var(--bb-bg);">
        <div class="bb-mockup-headline" style="font-size:14px;">${escapeHtml(brand.brandDNA.tagline || brand.name)}</div>
        <div class="bb-mockup-cta">${escapeHtml(brand.brandDNA.callToAction || "Order now")}</div>
      </div>
    </div>
  `;
}

// ---------- Shared section content (live preview, review, PDF) ----------
function foundationSectionContent(brand) {
  const dna = brand.brandDNA;
  return `
    ${dna.tagline ? `<p style="font-size:14px;font-style:italic;margin:0 0 12px;">"${escapeHtml(dna.tagline)}"</p>` : ""}
    ${dna.targetAudience ? `<p style="font-size:12.5px;line-height:1.6;margin:0 0 8px;"><strong>For:</strong> ${escapeHtml(dna.targetAudience)}</p>` : ""}
    ${dna.positioning ? `<p style="font-size:12.5px;line-height:1.6;margin:0;"><strong>Why us:</strong> ${escapeHtml(dna.positioning)}</p>` : ""}
  `;
}

function logoSectionContent(a) {
  if (a.logo.hasLogo && a.logo.dataUrl) return `<img src="${a.logo.dataUrl}" style="max-height:90px;max-width:220px;object-fit:contain;" alt="Logo" />`;
  return `<p style="font-size:12.5px;color:#8a8580;">No logo added yet.</p>`;
}

const COLOR_ROLE_COPY = {
  primary: "used for headlines and primary actions.",
  secondary: "supports the primary color across larger surfaces.",
  accent: "highlights calls-to-action and key details.",
  background: "the base surface color across every application.",
  text: "used for body copy and default text.",
};

function colorSectionContent(a) {
  if (!a.colors.primary) return `<p style="font-size:12.5px;color:#8a8580;">No colors chosen yet.</p>`;
  const keys = ["primary", "secondary", "accent", "background", "text"];
  return `<div style="display:flex;gap:14px;flex-wrap:wrap;">${keys.map((k) => `
    <div style="width:92px;">
      <div style="width:92px;height:92px;border-radius:8px;background:${a.colors[k]};border:1px solid #e4e0da;margin-bottom:6px;"></div>
      <div style="font-size:10.5px;font-weight:700;text-transform:capitalize;">${k}</div>
      <div style="font-size:10px;color:#8a8580;">${(a.colors[k] || "").toUpperCase()}</div>
    </div>
  `).join("")}</div>`;
}

function colorUsageContent(a) {
  if (!a.colors.primary) return "";
  return `<div style="margin-top:16px;">${["primary", "secondary", "accent", "background", "text"].map((k) => `<p style="font-size:11.5px;line-height:1.6;margin:0 0 4px;"><strong style="text-transform:capitalize;">${k}</strong> — ${COLOR_ROLE_COPY[k]}</p>`).join("")}</div>`;
}

function typographySectionContent(a) {
  if (!a.fonts.primary) return `<p style="font-size:12.5px;color:#8a8580;">No typefaces chosen yet.</p>`;
  return `
    <div style="font-family:'${a.fonts.primary}';font-size:28px;font-weight:700;margin-bottom:6px;">${escapeHtml(a.fonts.primary)}</div>
    <div style="font-family:'${a.fonts.secondary}';font-size:14px;color:#5b564f;">${escapeHtml(a.fonts.secondary)} — used for body text and captions.</div>
  `;
}

function directionSectionContent(a) {
  if (!a.visualDirection.length) return `<p style="font-size:12.5px;color:#8a8580;">No visual direction chosen yet.</p>`;
  return a.visualDirection.map((d) => `<p style="font-size:12.5px;margin:0 0 6px;"><strong>${escapeHtml(d)}</strong> — ${VISUAL_DIRECTIONS[d]?.description || ""}</p>`).join("");
}

function applicationsSectionContent(a, brand) {
  if (!a.applications.length) return `<p style="font-size:12.5px;color:#8a8580;">No applications chosen yet.</p>`;
  return `<div class="bb-mockup-stage" style="${mockupStageStyle(a)}">${a.applications.map((id) => renderMockup(id, a, brand)).join("")}</div>`;
}

// ---------- Live preview (right pane) ----------
function livePreviewHTML(brand, a) {
  return `
    <div class="brandbook-sheet">
      <div class="brandbook-page" style="min-height:0;padding:24px 26px 60px;">
        <img src="assets/wepeka-logo.png" class="brandbook-wpk-mark" style="width:54px;top:18px;right:20px;" alt="WPK Brand Lab" />
        <div class="brandbook-page-eyebrow">Live Preview</div>
        <div class="brandbook-cover-name" style="font-size:22px;">${escapeHtml(brand.name)}</div>
        ${foundationSectionContent(brand)}
        <div class="brandbook-page-eyebrow" style="margin-top:18px;">Logo</div>
        ${logoSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:18px;">Colors</div>
        ${colorSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:18px;">Typography</div>
        ${typographySectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:18px;">Visual Direction</div>
        ${directionSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:18px;">Brand Applications</div>
        ${applicationsSectionContent(a, brand)}
        <div class="brandbook-page-footer" style="position:static;margin-top:24px;padding-top:14px;border-top:1px solid #e4e0da;">
          <span>${escapeHtml(brand.name)} Brand Book</span>
          <span>Made by WPK Brand Lab</span>
        </div>
      </div>
    </div>
  `;
}

// ---------- Review step ----------
function reviewHTML(brand, state) {
  const a = state.answers;
  return `
    <h2 style="margin-bottom:6px;">Your Brand Book is ready</h2>
    <p class="text-muted" style="font-size:13px;margin:0 0 20px;">Review everything below, then save it to this brand or download the PDF.</p>
    <div class="brandbook-sheet" style="margin-bottom:20px;">
      <div class="brandbook-page">
        <img src="assets/wepeka-logo.png" class="brandbook-wpk-mark" alt="WPK Brand Lab" />
        <div class="brandbook-cover-name">${escapeHtml(brand.name)}</div>
        <div class="brandbook-cover-tagline">${escapeHtml(brand.brandDNA.tagline || "")}</div>
        <div class="brandbook-page-eyebrow" style="margin-top:26px;">Foundation</div>
        ${foundationSectionContent(brand)}
        <div class="brandbook-page-eyebrow" style="margin-top:22px;">Logo</div>
        ${logoSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:22px;">Color System</div>
        ${colorSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:22px;">Typography</div>
        ${typographySectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:22px;">Visual Direction</div>
        ${directionSectionContent(a)}
        <div class="brandbook-page-eyebrow" style="margin-top:22px;">Brand Applications</div>
        ${applicationsSectionContent(a, brand)}
        <div class="brandbook-page-footer" style="position:static;margin-top:26px;padding-top:14px;border-top:1px solid #e4e0da;">
          <span>${escapeHtml(brand.name)} Brand Book</span><span>Made by WPK Brand Lab</span>
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <button type="button" class="btn btn-secondary" id="wiz-back">${icon("chevronLeft", { size: 14 })}Back</button>
      <div class="flex gap-8">
        <button type="button" class="btn btn-secondary" id="wiz-pdf">${icon("download", { size: 14 })}Download PDF</button>
        <button type="button" class="btn btn-primary" id="wiz-save">${icon("check", { size: 15 })}Save Brand Book</button>
      </div>
    </div>
  `;
}

function wireReview(root, brandId, brand, state, refresh) {
  qs("#wiz-back", root).addEventListener("click", () => {
    state.stepIndex = STEPS.length - 1;
    refresh();
  });
  qs("#wiz-save", root).addEventListener("click", () => {
    updateBrand(brandId, { brandGuidelines: { ...state.answers } });
    toast("Brand Book saved");
  });
  qs("#wiz-pdf", root).addEventListener("click", () => openBrandBookPdf(brand, state.answers));
}

// ---------- PDF (landscape, multi-page) ----------
function brandbookPageHTML(title, content, brand) {
  return `
    <div class="brandbook-page brandbook-print-page">
      <img src="assets/wepeka-logo.png" class="brandbook-wpk-mark" alt="WPK Brand Lab" />
      <div class="brandbook-page-eyebrow">${title}</div>
      ${content}
      <div class="brandbook-page-footer">
        <span>${escapeHtml(brand.name)} Brand Book</span>
        <span>Made by WPK Brand Lab</span>
      </div>
    </div>
  `;
}

function openBrandBookPdf(brand, a) {
  const pages = [
    brandbookPageHTML("Cover", `
      <div class="brandbook-cover-name">${escapeHtml(brand.name)}</div>
      <div class="brandbook-cover-tagline">${escapeHtml(brand.brandDNA.tagline || "")}</div>
    `, brand),
    brandbookPageHTML("Brand Foundation", foundationSectionContent(brand), brand),
    brandbookPageHTML("Logo", logoSectionContent(a), brand),
    brandbookPageHTML("Color System", colorSectionContent(a) + colorUsageContent(a), brand),
    brandbookPageHTML("Typography", typographySectionContent(a), brand),
    brandbookPageHTML("Visual Direction", directionSectionContent(a), brand),
    brandbookPageHTML("Brand Applications", applicationsSectionContent(a, brand), brand),
  ].join("");

  const overlay = openModal({
    title: "Brand Book — PDF Preview",
    width: "min(1100px,94vw)",
    bodyHTML: `<div class="report-preview-wrap"><div class="brandbook-sheet" id="bb-report-sheet">${pages}</div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="bb-pdf-close">Close</button>
      <button class="btn btn-primary" id="bb-pdf-download">${icon("download", { size: 14 })}Download PDF</button>
    `,
  });
  qs("#bb-pdf-close", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#bb-pdf-download", overlay).addEventListener("click", () => {
    toast('In the print dialog, choose "Save as PDF" and Landscape orientation.');
    setTimeout(() => window.print(), 400);
  });
}
