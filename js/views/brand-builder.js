import { backLinkHTML } from "../back-link.js";
import { getBrand, updateBrand, getSettings, defaultBrandGuidelines, defaultBrandDNA, defaultPersonality, defaultToneOfVoice, defaultNaming } from "../store.js";
import { qs, qsa, escapeHtml, toast } from "../dom.js";
import { icon } from "../icons.js";
import { confirmDialog } from "../modals.js";
import { NAME_EXTENSION_CATEGORIES, NAMING_STRATEGIES } from "../brandbook-data.js";
import { suggestBrandNames, checkBrandNameLength, hasAiKey, AiApiError } from "../ai.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { sectionGuideButtonHTML, wireSectionGuideButton } from "../section-guide.js";
import { t } from "../i18n.js";
import { brandDnaCompleteness, brandDnaDone } from "./brand-home.js";
import { getMode } from "../mode.js";

const HUB_TOUR_STEPS = [
  { selector: ".bb-hub-door:nth-child(1)", title: "Brand DNA", body: t("builder.tour.dna.body") },
  { selector: ".bb-hub-door:nth-child(2)", title: "Brand Guidelines", body: t("builder.tour.guidelines.body") },
];

// The Brand Builder hub. Top level (no `stage`) shows just two big doors —
// Brand DNA and Brand Guidelines — instead of one flat 12-card grid, so
// someone opening this for the first time isn't confronted with all 12
// stages at once. The Brand DNA door opens its wizard (`#/brand/:id/dna`);
// the Guidelines door leads to
// `/builder/guidelines`, a group page that still shows the 12 stages' own
// stage-by-stage stepper (see GROUPS below) — the lock-sequencing itself
// didn't change, only which stages it's scoped to at a time (each group
// locks independently: e.g. Naming/Tagline don't block Logo, since Logo
// lives in the other group entirely).
// Order in STAGES IS the required sequence within its group — each stage
// unlocks only once every real (non-"soon") stage before it, in the same
// group, is "done". This matches the e-book's own step-by-step philosophy:
// no jumping ahead to Color before Personality is set, no Typography before
// Logo, etc. The split point below (index 5) matches brand-guidelines.js's
// actual internal wizard order (foundation → logo → color → typography →
// direction → applications) so the lock progression reads the same as what
// happens once you're inside.
// Labels/descriptions are getters so they always read the current language.
const STAGE_DEFS = [
  // Brand DNA's five old stages (Foundation, Personality, Positioning,
  // Naming, Tagline) are gone from this grid: they are the Brand DNA
  // wizard's own steps now (js/views/brand-dna.js), so nobody gets asked
  // for their brand's personality again right after finishing Brand DNA.
  { key: "logo", labelKey: "guidelines.step.logo", href: (id) => `#/brand/${id}/guidelines/logo`, status: logoStatus },
  { key: "color", labelKey: "guidelines.step.color", href: (id) => `#/brand/${id}/guidelines/color`, status: colorStatus },
  { key: "typography", labelKey: "guidelines.step.typography", href: (id) => `#/brand/${id}/guidelines/typography`, status: typographyStatus },
  { key: "visualDirection", labelKey: "guidelines.step.direction", href: (id) => `#/brand/${id}/guidelines/direction`, status: visualDirectionStatus },
  { key: "toneOfVoice", labelKey: "guidelines.step.tone", href: (id) => `#/brand/${id}/guidelines/tone`, status: toneOfVoiceStatus },
  { key: "imagery", href: (id) => `#/brand/${id}/guidelines/direction`, status: visualDirectionStatus },
  { key: "guidelines", href: (id) => `#/brand/${id}/guidelines/review`, status: guidelinesDocStatus },
];
const STAGES = STAGE_DEFS.map(({ labelKey, ...s }) => ({
  ...s,
  get label() { return t(labelKey || `builder.stage.${s.key}.label`); },
  get desc() { return t(`builder.stage.${s.key}.desc`); },
}));

// The two doors on the hub — DNA covers the first 5 stages (foundation
// through tagline), Guidelines the remaining 7 (logo through the doc).
const GUIDELINES_STAGES = STAGES;
const GROUPS = {
  dna: {
    label: "Brand DNA",
    icon: "target",
    get doorDesc() { return t("builder.group.dna.doorDesc"); },
    get pageDesc() { return t("builder.group.dna.pageDesc"); },
    stages: [],
    get resetMessage() { return t("builder.group.dna.resetMessage"); },
    // Personality and Naming live on brandBuilder, not brandDNA — a
    // "reset just DNA" has to reach into both objects, and must NOT touch
    // brandBuilder.toneOfVoice (that one belongs to the Guidelines group
    // below even though it's stored right next to these two).
    reset: (brand) => ({
      brandDNA: defaultBrandDNA(),
      brandBuilder: {
        ...brand.brandBuilder,
        personality: defaultPersonality(),
        naming: defaultNaming(),
        completedStages: (brand.brandBuilder.completedStages || []).filter((s) => !["personality", "naming"].includes(s)),
      },
    }),
  },
  guidelines: {
    label: "Brand Guidelines",
    icon: "book",
    get doorDesc() { return t("builder.group.guidelines.doorDesc"); },
    get pageDesc() { return t("builder.group.guidelines.pageDesc"); },
    stages: GUIDELINES_STAGES,
    // Brand DNA is a story that has to build in order (you can't write a
    // Positioning that depends on a Problem you haven't named yet); Brand
    // Guidelines is a kit of mostly-independent pieces (a logo doesn't
    // need typography to exist first) — so this group skips the lock
    // entirely instead of forcing the same order-dependency DNA has.
    noLock: true,
    get resetMessage() { return t("builder.group.guidelines.resetMessage"); },
    // Tone of Voice is a Guidelines-group stage but, like Personality/
    // Naming above, actually lives on brandBuilder — earlier this reset
    // only cleared brandGuidelines itself, silently leaving Tone of Voice
    // showing "Selesai" after a reset. Both objects now reset together.
    reset: (brand) => ({
      brandGuidelines: defaultBrandGuidelines(),
      brandBuilder: {
        ...brand.brandBuilder,
        toneOfVoice: defaultToneOfVoice(),
        completedStages: (brand.brandBuilder.completedStages || []).filter((s) => s !== "toneOfVoice"),
      },
    }),
  },
};

// A stage is locked until every real stage before it, in the same group,
// is "done" — "soon" stages don't count, since they can never become
// "done". Naming gets one deliberate exception: if its opening question
// ("udah punya nama brand?") was answered "sudah", there's nothing left to
// wait for — it unlocks immediately regardless of where Foundation/
// Personality/Positioning are at. Everything else, Naming included when
// the answer is "belum", still waits its normal turn. Groups flagged
// noLock (Brand Guidelines) skip all of this — every stage in them is
// always open.
function computeLocks(stages, brand, noLock) {
  const locked = {};
  if (noLock) {
    for (const s of stages) locked[s.key] = false;
    return locked;
  }
  let blocking = false;
  for (const s of stages) {
    if (s.soon) { locked[s.key] = false; continue; }
    locked[s.key] = blocking;
    if (s.key === "naming" && brand.brandBuilder?.naming?.hasName === true) locked[s.key] = false;
    if (s.status(brand) !== "done") blocking = true;
  }
  return locked;
}

function groupSummary(stages, brand) {
  const real = stages.filter((s) => !s.soon);
  return { done: real.filter((s) => s.status(brand) === "done").length, total: real.length };
}

// Whole-Builder completeness — both doors (DNA + Guidelines) at 100%, not
// just one. Used to decide whether saving Guidelines should send someone
// all the way back to the brand's Home (nothing left to set up) instead of
// just back to this hub (see js/views/brand-guidelines.js's wiz-save).
export function isBrandBuilderComplete(brand) {
  return brandDnaDone(brand) && STAGES.filter((s) => !s.soon).every((s) => s.status(brand) === "done");
}

// 4.4: one definition of "done" for the visual side, matching exactly what
// Pemula's two-tab Warna → Font flow (js/views/brand-guidelines.js) asks
// for — not the Pro hub's full 5-stage count, which also wants Logo/
// Direction/Tone. Everything else (Logo/Direction/Tone/Applications) is
// still offered later through the "Hari ini" engine, not required up front.
export function visualBasicsDone(brand) {
  const colors = brand.brandGuidelines?.colors || {};
  const fonts = brand.brandGuidelines?.fonts || {};
  return !!(colors.primary && fonts.primary && fonts.secondary);
}

// One-shot "just finished the whole Builder" flag — set right before
// navigating to Home from Guidelines' save, consumed (and turned into a
// celebratory toast) the first time Home paints afterward. sessionStorage
// rather than a store field since it's purely "play this once," nothing any
// other part of the app needs to read.
const BUILDER_JUST_COMPLETED_KEY = "contentos:builder-just-completed";

export function markBuilderJustCompleted(brandId) {
  sessionStorage.setItem(BUILDER_JUST_COMPLETED_KEY, brandId);
}

// Returns true the one time this fires (right after Home first paints
// following the save that completed everything) so callers — beginner-home's
// paint() — can layer their own extra "what's newly unlocked" UI on top of
// the plain toast, instead of duplicating this consume-once check.
export function celebrateBuilderCompleteIfFlagged(brandId) {
  if (sessionStorage.getItem(BUILDER_JUST_COMPLETED_KEY) !== brandId) return false;
  sessionStorage.removeItem(BUILDER_JUST_COMPLETED_KEY);
  toast(t("builder.celebrate.all"));
  return true;
}

// 4.4: same one-shot pattern as BUILDER_JUST_COMPLETED_KEY, but for
// visualBasicsDone specifically — Pemula's "Selesai, balik ke Beranda" on
// the Font step (js/views/brand-guidelines.js) sets this, so Beranda can
// unlock the Campaign step's callout right then instead of only once every
// other visual section (Logo/Direction/Tone/Applications) is also filled.
const VISUAL_BASICS_JUST_DONE_KEY = "contentos:visual-basics-just-done";

export function markVisualBasicsJustDone(brandId) {
  sessionStorage.setItem(VISUAL_BASICS_JUST_DONE_KEY, brandId);
}

export function consumeVisualBasicsJustDone(brandId) {
  if (sessionStorage.getItem(VISUAL_BASICS_JUST_DONE_KEY) !== brandId) return false;
  sessionStorage.removeItem(VISUAL_BASICS_JUST_DONE_KEY);
  return true;
}

function filledCount(fields) {
  return fields.filter((v) => (Array.isArray(v) ? v.length : !!v)).length;
}
function toneOfVoiceStatus(brand) {
  return brand.brandBuilder?.toneOfVoice?.source ? "done" : "todo";
}
function colorStatus(brand) {
  const g = brand.brandGuidelines || {};
  return g.colors?.primary ? "done" : g.colorFeelings?.length ? "progress" : "todo";
}
function typographyStatus(brand) {
  const g = brand.brandGuidelines || {};
  return g.fonts?.primary && g.fonts?.secondary ? "done" : g.typographyFeelings?.length ? "progress" : "todo";
}
function logoStatus(brand) {
  const l = brand.brandGuidelines?.logo || {};
  // Done only once a logo is actually uploaded — "belum punya" is progress.
  if (l.dataUrl) return "done";
  return l.hasLogo === true || l.hasLogo === false ? "progress" : "todo";
}
function visualDirectionStatus(brand) {
  return brand.brandGuidelines?.visualDirection?.length ? "done" : "todo";
}
function guidelinesDocStatus(brand) {
  const all = [colorStatus, typographyStatus, logoStatus, visualDirectionStatus].map((f) => f(brand));
  if (all.every((s) => s === "done")) return "done";
  return all.some((s) => s !== "todo") ? "progress" : "todo";
}

const statusLabel = (status) => t(`builder.status.${status}`);

export function render(root, { brandId, stage }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  // Personality is a step inside the Brand DNA wizard now; Brand DNA has
  // no stage grid any more. Old links land in the right place.
  if (stage === "personality") location.replace(`#/brand/${brandId}/dna/identity`);
  else if (stage === "dna") location.replace(`#/brand/${brandId}/dna`);
  // Tone of Voice moved into Brand Guidelines — old links still land there.
  else if (stage === "toneOfVoice") location.replace(`#/brand/${brandId}/guidelines/tone`);
  else if (stage === "naming") paintNaming(root, brandId, brand);
  else if (stage === "guidelines") paintGroup(root, brand, stage);
  else paintHub(root, brand);
  return () => {};
}

// Brand DNA's wizard sets this right before navigating away on a save that
// pushed it to 100% — a one-shot sessionStorage flag rather than a URL param
// or store field, since it's purely "just play the celebration once."
// Pro still lands here (paintHub) and gets the fuller door-glow animation;
// Pemula (3.3) goes to Beranda instead and beginner-home.js reads the same
// flag for a plain toast — whichever of the two the account actually lands
// on consumes it, the other never sees it.
const DNA_JUST_COMPLETED_KEY = "contentos:dna-just-completed";

export function markDnaJustCompleted(brandId) {
  sessionStorage.setItem(DNA_JUST_COMPLETED_KEY, brandId);
}

// Consumes the flag (true only the one time it matches) so callers can
// layer their own celebration UI on top without duplicating the read/clear.
export function consumeDnaJustCompleted(brandId) {
  if (sessionStorage.getItem(DNA_JUST_COMPLETED_KEY) !== brandId) return false;
  sessionStorage.removeItem(DNA_JUST_COMPLETED_KEY);
  return true;
}

function paintHub(root, brand) {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brand.id}`, t("nav.home"))} · Brand Builder${helpButtonHTML("brand-builder-hub")}${sectionGuideButtonHTML("brand-builder")}</div>
        <h1>${escapeHtml(brand.name)}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${t("builder.hub.sub")}</p>
      </div>
    </div>
    <div class="intro-note" style="max-width:640px;">
      ${icon("sparkle", { size: 15 })}
      <span>${t("builder.hub.intro")}</span>
    </div>
    <div class="bb-hub-grid">
      ${hubDoorHTML(brand, "dna")}
      ${hubDoorHTML(brand, "guidelines")}
    </div>
  `;
  wireHelpButtons(root);
  wireSectionGuideButton(root, "brand-builder", HUB_TOUR_STEPS);

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

// The DNA wizard reports "100% selesai" on its own 8 fields, while this
// hub counts 5 stages (two of which — Personality, Naming — live outside
// the wizard). Saying both numbers next to each other read as a
// contradiction, so once the wizard part is complete the label says so
// and names what's left as optional extras.
function progressLabel(key, brand, done, total) {
  if (key === "dna") {
    const { filled, total: dnaTotal } = brandDnaCompleteness(brand.brandDNA);
    if (dnaTotal && filled >= dnaTotal && done < total) return total - done === 1 ? t("builder.progress.dnaDoneExtrasOne") : t("builder.progress.dnaDoneExtras", { n: total - done });
  }
  return t("builder.progress.stages", { done, total });
}

function hubDoorHTML(brand, key) {
  const group = GROUPS[key];
  // Brand DNA is a single wizard now, so its door opens the wizard itself
  // and its progress is the wizard's own answered-questions count.
  const isDna = key === "dna";
  const { done, total } = isDna ? (({ filled, total: n }) => ({ done: filled, total: n }))(brandDnaCompleteness(brand.brandDNA)) : groupSummary(group.stages, brand);
  const pct = total ? Math.round((done / total) * 100) : 0;
  // 4.2: the Guidelines door skips the group page (paintGroup, still
  // reachable by URL for anyone with the old link) and opens straight on
  // Color — Brand Guidelines is one page of independently-tabbed sections
  // now, not a locked stage sequence that needs a landing page of its own.
  const href = isDna ? `#/brand/${brand.id}/dna` : `#/brand/${brand.id}/guidelines/color`;
  return `
    <a class="card bb-hub-door" href="${href}">
      <div class="bb-hub-icon">${icon(group.icon, { size: 30 })}</div>
      <h2 class="flex items-center gap-6">${group.label}${helpButtonHTML(key === "dna" ? "term-brand-dna" : "term-brand-guidelines")}</h2>
      <p>${group.doorDesc}</p>
      <div class="bb-hub-progress">
        <div class="bb-hub-bar"><span style="width:${pct}%;"></span></div>
        <span>${
          key === "dna"
            ? t("builder.progress.dnaQuestions", { done, total })
            : // 4.4: Pemula's promise for this door is exactly Warna+Font, not
              // "n/5 tahap" — Logo/Direction/Tone/Applications are offered
              // later through the "Hari ini" engine, not part of this count.
              key === "guidelines" && getMode() === "guided"
              ? visualBasicsDone(brand)
                ? t("builder.progress.visualDone")
                : t("builder.progress.visualPending")
              : progressLabel(key, brand, done, total)
        }</span>
      </div>
    </a>
  `;
}

function paintGroup(root, brand, key) {
  const group = GROUPS[key];
  const locks = computeLocks(group.stages, brand, group.noLock);
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${backLinkHTML(`#/brand/${brand.id}/builder`, "Brand Builder")} · ${group.label}</div>
        <h1 class="flex items-center gap-8">${group.label}${helpButtonHTML(key === "dna" ? "term-brand-dna" : "term-brand-guidelines")}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${group.pageDesc}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="reset-group">${icon("refresh", { size: 12 })}${t("builder.group.reset", { group: group.label })}</button>
    </div>
    <div class="bb-stage-grid">
      ${group.stages.map((s, i) => stageCardHTML(s, i, brand, locks[s.key])).join("")}
    </div>
  `;
  wireHelpButtons(root);
  qsa("[data-soon]", root).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      toast(t("builder.toast.soon"));
    });
  });
  qsa("[data-locked]", root).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      toast(t("builder.toast.locked"));
    });
  });
  qs("#reset-group", root)?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("builder.group.resetTitle", { group: group.label }),
      message: group.resetMessage,
      confirmLabel: t("builder.group.resetConfirm"),
      danger: true,
    });
    if (!ok) return;
    updateBrand(brand.id, group.reset(brand));
    toast(t("builder.group.resetDone", { group: group.label }));
    paintGroup(root, brand, key);
  });
}

function stageCardHTML(s, i, brand, locked) {
  const status = s.soon ? "soon" : locked ? "locked" : s.status(brand);
  const clickable = !s.soon && !locked;
  const href = clickable ? (s.internal ? `#/brand/${brand.id}/builder/${s.key}` : s.href(brand.id)) : "#";
  return `
    <a class="card card-tight bb-stage-card bb-stage-${status}" href="${href}" ${s.soon ? "data-soon" : ""} ${locked ? "data-locked" : ""}>
      <div class="bb-stage-num">${status === "done" ? icon("check", { size: 13 }) : locked ? icon("lock", { size: 12 }) : i + 1}</div>
      <div class="bb-stage-body">
        <div class="bb-stage-label">${escapeHtml(s.label)}</div>
        <div class="bb-stage-desc">${escapeHtml(s.desc)}</div>
      </div>
      <div class="bb-stage-status bb-stage-status-${status}">${statusLabel(status)}</div>
    </a>
  `;
}

// ---------- Naming stage ----------
// Opens with one branching question instead of a blank "think of a name"
// prompt — a business that already has a name shouldn't have to do
// brainstorming homework, it should just confirm and move on. From there
// every path (typed, confirmed, or AI-brainstormed) runs through the same
// two checks before it counts as done: a length check — short names stick,
// so a long one gets AI-suggested shortened alternatives, the way big
// brands trim a long name into a tight nickname — and an optional handle
// suffix suggestion for when the plain name is already taken on
// Instagram. Nothing persists until that full run is finished; only the
// opening hasName answer saves immediately (see computeLocks' naming
// override) since the stage-card lock depends on it.
function paintNaming(root, brandId, brand) {
  const saved = brand.brandBuilder.naming || {};
  const state = {
    hasName: saved.hasName ?? null,
    name: saved.name || "",
    units: saved.units ?? null,
    breakdown: saved.breakdown || "",
    handleSuffix: saved.handleSuffix || "",
    handleCategory: saved.handleCategory || "",
    // ---- in-progress, not persisted until the flow completes ----
    strategy: "",
    pendingName: "",
    pendingSource: "",
    checked: false,
    checkLoading: false,
    checkResult: null, // null (not run yet) | "error" | { units, breakdown, tooLong, alternatives }
    checkErrorReason: "",
    extensionCategory: "",
    options: [],
    shown: [],
  };

  function persistHasName(v) {
    state.hasName = v;
    updateBrand(brandId, { brandBuilder: { ...brand.brandBuilder, naming: { hasName: v } } });
  }

  function persistFinal() {
    state.name = state.pendingName;
    // Mirror the check result into the same top-level fields doneHTML
    // reads, not just into the Firestore payload below — otherwise the
    // very next render (before any reload re-reads brand.brandBuilder)
    // would show a stale blank breakdown even though it saved correctly.
    if (state.checkResult && typeof state.checkResult === "object") {
      state.units = typeof state.checkResult.units === "number" ? state.checkResult.units : null;
      state.breakdown = state.checkResult.breakdown || "";
    }
    const namingObj = { hasName: state.hasName, name: state.name, source: state.pendingSource || (state.hasName ? "existing" : "user") };
    if (state.strategy) namingObj.strategy = state.strategy;
    if (typeof state.units === "number") namingObj.units = state.units;
    if (state.breakdown) namingObj.breakdown = state.breakdown;
    if (state.handleSuffix) { namingObj.handleSuffix = state.handleSuffix; namingObj.handleCategory = state.extensionCategory; }
    updateBrand(brandId, { brandBuilder: { ...brand.brandBuilder, naming: namingObj } });
    toast(t("builder.naming.saved"));
    location.hash = `#/brand/${brandId}/dna/identity`;
  }

  function resetAll() {
    Object.assign(state, {
      hasName: null, name: "", units: null, breakdown: "", handleSuffix: "", handleCategory: "",
      strategy: "", pendingName: "", pendingSource: "", checked: false, checkLoading: false, checkResult: null,
      checkErrorReason: "", extensionCategory: "", options: [], shown: [],
    });
    updateBrand(brandId, { brandBuilder: { ...brand.brandBuilder, naming: {} } });
  }

  // "sudah punya" skips straight to confirming the name they already have.
  // "belum" makes them pick one of the 3 naming angles first (see
  // NAMING_STRATEGIES) — "self" then goes straight to a plain name input
  // (there's nothing to brainstorm, it's their own name), "curiosity" and
  // "descriptive" open the AI brainstorm tool tuned to that one angle.
  function phase() {
    if (state.hasName !== true && state.hasName !== false) return "ask";
    if (state.name) return "done";
    if (!state.pendingName) {
      if (state.hasName) return "confirmInput";
      if (!state.strategy) return "strategy";
      return state.strategy === "self" ? "selfInput" : "brainstorm";
    }
    if (!state.checked) return "check";
    return "extension";
  }

  function subtitleFor(p) {
    const known = ["ask", "confirmInput", "strategy", "selfInput", "brainstorm", "check", "extension"];
    return t(`builder.naming.sub.${known.includes(p) ? p : "done"}`);
  }

  function refresh() {
    const p = phase();
    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-eyebrow">${backLinkHTML(`#/brand/${brand.id}/dna/identity`, "Brand DNA")} · ${t("builder.stage.naming.label")}</div>
          <h1>${t("builder.stage.naming.label")}</h1>
          <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${subtitleFor(p)}</p>
        </div>
      </div>
      ${
        p === "ask" ? askHTML()
        : p === "confirmInput" ? manualHTML({ label: t("builder.naming.currentLabel"), placeholder: t("builder.naming.currentPlaceholder"), source: "existing", cta: t("guidelines.next") })
        : p === "strategy" ? strategyHTML()
        : p === "selfInput" ? selfInputHTML()
        : p === "brainstorm" ? brainstormHTML()
        : p === "check" ? checkHTML()
        : p === "extension" ? extensionHTML()
        : doneHTML()
      }
    `;
    wire(p);
  }

  function askHTML() {
    return `
      <div class="card" style="max-width:480px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:14px;">${t("builder.naming.askQ")}</div>
        <div class="flex gap-8">
          <button type="button" class="btn btn-primary" id="naming-yes">${icon("check", { size: 14 })}${t("builder.naming.askYes")}</button>
          <button type="button" class="btn btn-secondary" id="naming-no">${t("builder.naming.askNo")}</button>
        </div>
      </div>
    `;
  }

  function manualHTML({ label, placeholder, source, cta }) {
    return `
      <div class="card" style="max-width:480px;">
        <div class="field" style="margin-bottom:10px;">
          <label style="font-size:11.5px;">${escapeHtml(label)}</label>
          <input class="input" id="naming-manual" data-source="${source}" placeholder="${escapeHtml(placeholder)}" />
        </div>
        <button type="button" class="btn btn-primary" id="naming-save-manual" data-source="${source}">${icon("check", { size: 14 })}${cta}</button>
      </div>
    `;
  }

  function strategyHTML() {
    return `
      <div style="display:grid;gap:12px;max-width:640px;">
        ${NAMING_STRATEGIES.map(
          (s) => `
          <button type="button" class="card card-tight" data-naming-strategy="${s.key}" style="text-align:left;cursor:pointer;">
            <div style="font-size:13.5px;font-weight:700;margin-bottom:4px;">${escapeHtml(s.label)}</div>
            <div class="text-muted" style="font-size:12px;margin-bottom:6px;">${escapeHtml(s.desc)}</div>
            <div class="text-faint" style="font-size:11px;">${s.examples.map(escapeHtml).join(" · ")}</div>
          </button>
        `
        ).join("")}
      </div>
    `;
  }

  function strategyBackLinkHTML() {
    return `<button type="button" class="btn btn-ghost btn-sm" id="naming-back-strategy" style="margin-bottom:10px;">${icon("chevronLeft", { size: 11 })}${t("builder.naming.changeApproach")}</button>`;
  }

  function selfInputHTML() {
    return `
      ${strategyBackLinkHTML()}
      <div class="card" style="max-width:520px;margin-bottom:12px;">
        <div class="text-faint" style="font-size:11.5px;">${t("builder.naming.selfNote")}</div>
      </div>
      ${manualHTML({ label: t("builder.naming.selfLabel"), placeholder: t("builder.naming.selfPlaceholder"), source: "self", cta: t("guidelines.next") })}
    `;
  }

  function brainstormHTML() {
    return `
      ${strategyBackLinkHTML()}
      <div class="card" style="max-width:560px;margin-bottom:16px;">
        <div class="field" style="margin-bottom:10px;">
          <label style="font-size:11.5px;">${t("builder.naming.keywordsLabel")}</label>
          <input class="input" id="naming-keywords" placeholder="${escapeHtml(t("builder.naming.keywordsPlaceholder"))}" />
        </div>
        <button type="button" class="btn btn-secondary btn-block" id="naming-generate">${icon("bot", { size: 14 })}${state.shown.length ? t("builder.naming.generateMore") : t("builder.naming.generate")}</button>
        <div id="naming-status" style="margin-top:8px;"></div>
      </div>
      ${state.options.length ? `<div style="max-width:560px;margin-bottom:16px;">${nameOptionsHTML(state.options)}</div>` : ""}
      ${manualHTML({ label: t("builder.naming.orType"), placeholder: t("builder.naming.orTypePlaceholder"), source: "user", cta: t("guidelines.next") })}
    `;
  }

  // withBreakdown=true also prints each option's pronunciation breakdown
  // (used for the check step's shortened alternatives) — the plain
  // brainstorm options from suggestBrandNames don't have one.
  function nameOptionsHTML(options, withBreakdown = false) {
    return options
      .map(
        (o, i) => `
      <div class="card card-tight" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-family:var(--font-display);font-weight:800;font-size:15px;">${escapeHtml(o.name)}</div>
          <div class="text-faint" style="font-size:11.5px;margin-top:2px;">${withBreakdown && o.breakdown ? `${escapeHtml(o.breakdown)} — ` : ""}${escapeHtml(o.reason || "")}</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-naming-pick="${i}" style="flex:none;">${t("builder.naming.use")}</button>
      </div>`
      )
      .join("");
  }

  function checkHTML() {
    if (state.checkLoading) {
      return `
        <div class="card" style="max-width:520px;">
          <div style="font-size:13px;margin-bottom:10px;">${t("builder.naming.nameToCheck")} <strong style="font-family:var(--font-display);">${escapeHtml(state.pendingName)}</strong></div>
          <div class="ocr-status"><div class="spinner"></div><span>${t("builder.naming.checking")}</span></div>
        </div>
      `;
    }
    if (!state.checkResult) {
      return `
        <div class="card" style="max-width:520px;">
          <div style="font-size:13px;margin-bottom:14px;">${t("builder.naming.nameToCheck")} <strong style="font-family:var(--font-display);font-size:17px;">${escapeHtml(state.pendingName)}</strong></div>
          <div class="text-faint" style="font-size:11.5px;margin-bottom:14px;">${t("builder.naming.idealHint")}</div>
          <div class="flex gap-8">
            <button type="button" class="btn btn-primary" id="naming-check-run">${icon("bot", { size: 14 })}${t("builder.naming.checkRun")}</button>
            <button type="button" class="btn btn-secondary" id="naming-check-skip">${t("builder.naming.checkSkip")}</button>
          </div>
        </div>
      `;
    }
    if (state.checkResult === "error") {
      return `
        <div class="card" style="max-width:520px;">
          <div style="font-size:13px;margin-bottom:14px;">${escapeHtml(t("builder.naming.checkError", { reason: state.checkErrorReason || t("builder.naming.aiNotReady") }))}</div>
          <button type="button" class="btn btn-primary" id="naming-check-skip">${escapeHtml(t("builder.naming.continueWith", { name: state.pendingName }))}</button>
        </div>
      `;
    }
    const r = state.checkResult;
    if (!r.tooLong) {
      return `
        <div class="card" style="max-width:520px;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:20px;margin-bottom:4px;">${escapeHtml(state.pendingName)}</div>
          <div class="text-faint" style="font-size:11.5px;margin-bottom:14px;">${escapeHtml(t("builder.naming.shortEnough", { units: r.units, breakdown: r.breakdown }))}</div>
          ${similarNoteHTML(r)}
          <button type="button" class="btn btn-primary" id="naming-check-continue">${icon("check", { size: 14 })}${t("guidelines.next")}</button>
        </div>
      `;
    }
    return `
      <div class="card" style="max-width:560px;">
        <div style="font-family:var(--font-display);font-weight:800;font-size:20px;margin-bottom:4px;">${escapeHtml(state.pendingName)}</div>
        <div class="text-faint" style="font-size:11.5px;margin-bottom:14px;">${escapeHtml(t("builder.naming.tooLong", { units: r.units, breakdown: r.breakdown }))}</div>
        ${similarNoteHTML(r)}
        ${r.alternatives.length ? nameOptionsHTML(r.alternatives, true) : ""}
        <button type="button" class="btn btn-secondary" id="naming-check-keep" style="margin-top:${r.alternatives.length ? "8px" : "0"};">${escapeHtml(t("builder.naming.keep", { name: state.pendingName }))}</button>
      </div>
    `;
  }

  // AI's own best-guess from training knowledge only — never a live
  // trademark/registry lookup, so it's always framed as "check manually",
  // never a definitive taken/available verdict.
  function similarNoteHTML(r) {
    if (!r.similarNote) return "";
    return `
      <div style="display:flex;gap:8px;align-items:flex-start;background:var(--health-average-soft);color:var(--health-average);border-radius:var(--radius-md);padding:10px 12px;font-size:11.5px;line-height:1.5;margin-bottom:14px;">
        ${icon("info", { size: 14 })}
        <span>${escapeHtml(r.similarNote)}</span>
      </div>
    `;
  }

  // Instagram has no public API this browser-only app can query for
  // handle availability (needs auth + a backend proxy this app doesn't
  // have), so "checking" here means the honest, actually-working version:
  // one click opens the real profile URL in a new tab — a real existing
  // account loads, an available handle shows Instagram's "Page Not Found".
  function instagramCheckLinkHTML(handle) {
    return `<a class="btn btn-ghost btn-sm" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener" style="flex:none;">${icon("link", { size: 12 })}${t("builder.naming.checkIg")}</a>`;
  }

  function suffixRowHTML(slug, sfx) {
    const handle = `${slug}${sfx}`;
    return `
      <div class="card card-tight" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="font-family:var(--font-display);font-weight:700;font-size:13.5px;">@${escapeHtml(handle)}</div>
        <div class="flex gap-8" style="flex:none;">
          ${instagramCheckLinkHTML(handle)}
          <button type="button" class="btn btn-secondary btn-sm" data-naming-suffix="${escapeHtml(sfx)}">${t("builder.naming.use")}</button>
        </div>
      </div>
    `;
  }

  function extensionHTML() {
    const slug = slugify(state.pendingName);
    const category = NAME_EXTENSION_CATEGORIES.find((c) => c.key === state.extensionCategory);
    return `
      <div class="card" style="max-width:560px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;">
          <div style="font-size:13px;">${t("builder.naming.extIntro", { slug: escapeHtml(slug) })}</div>
          ${instagramCheckLinkHTML(slug)}
        </div>
        <div class="bb-chip-row" style="margin-bottom:${category ? "14px" : "0"};">
          ${NAME_EXTENSION_CATEGORIES.map((c) => `<label class="checkbox-chip"><input type="radio" name="naming-category" data-naming-category value="${c.key}" ${state.extensionCategory === c.key ? "checked" : ""} />${escapeHtml(c.label)}</label>`).join("")}
        </div>
        ${
          category
            ? `
          <div class="text-faint" style="font-size:11.5px;margin-bottom:8px;">${escapeHtml(category.effect)}</div>
          ${category.suffixes.map((sfx) => suffixRowHTML(slug, sfx)).join("")}
        `
            : ""
        }
      </div>
      <div class="card" style="max-width:560px;margin-bottom:12px;">
        <div class="field" style="margin-bottom:10px;">
          <label style="font-size:11.5px;">${t("builder.naming.extCustomLabel")}</label>
          <div class="flex gap-8" style="align-items:center;">
            <span class="text-faint" style="font-size:13px;">@${escapeHtml(slug)}</span>
            <input class="input" id="naming-suffix-custom" placeholder="${escapeHtml(t("builder.naming.extCustomPlaceholder"))}" style="flex:1;" />
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="naming-suffix-custom-save">${icon("check", { size: 12 })}${t("builder.naming.extUseCustom")}</button>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="naming-skip-extension">${t("builder.naming.extSkip")}</button>
    `;
  }

  function doneHTML() {
    const handle = state.handleSuffix ? `${slugify(state.name)}${state.handleSuffix}` : "";
    return `
      <div class="card" style="max-width:480px;">
        <div class="flex items-center justify-between" style="margin-bottom:10px;">
          <span class="bb-stage-status bb-stage-status-done">${statusLabel("done")}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="naming-change">${icon("refresh", { size: 12 })}${t("builder.naming.changeAnswer")}</button>
        </div>
        <div style="font-family:var(--font-display);font-weight:800;font-size:24px;">${escapeHtml(state.name)}</div>
        ${state.breakdown ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${state.units ? `${t("builder.naming.units", { units: state.units })} — ` : ""}${escapeHtml(state.breakdown)}</div>` : ""}
        ${
          handle
            ? `<div class="flex items-center gap-8" style="margin-top:8px;">
                <span class="text-faint" style="font-size:11.5px;">${escapeHtml(t("builder.naming.backupHandle", { handle }))}</span>
                ${instagramCheckLinkHTML(handle)}
              </div>`
            : ""
        }
      </div>
    `;
  }

  function wire(p) {
    qs("#naming-yes", root)?.addEventListener("click", () => { persistHasName(true); refresh(); });
    qs("#naming-no", root)?.addEventListener("click", () => { persistHasName(false); refresh(); });
    qs("#naming-change", root)?.addEventListener("click", () => { resetAll(); refresh(); });

    qs("#naming-save-manual", root)?.addEventListener("click", (e) => {
      const v = qs("#naming-manual", root).value.trim();
      if (!v) return;
      state.pendingName = v;
      state.pendingSource = e.currentTarget.dataset.source;
      state.checked = false;
      state.checkResult = null;
      refresh();
    });
    qs("#naming-manual", root)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); qs("#naming-save-manual", root)?.click(); }
    });
    qs("#naming-back-strategy", root)?.addEventListener("click", () => {
      state.strategy = "";
      refresh();
    });

    if (p === "strategy") {
      qsa("[data-naming-strategy]", root).forEach((btn) =>
        btn.addEventListener("click", () => {
          state.strategy = btn.dataset.namingStrategy;
          refresh();
        })
      );
    }

    if (p === "brainstorm") {
      qsa("[data-naming-pick]", root).forEach((btn) =>
        btn.addEventListener("click", () => {
          const o = state.options[Number(btn.dataset.namingPick)];
          state.pendingName = o.name;
          state.pendingSource = "ai";
          state.checked = false;
          state.checkResult = null;
          refresh();
        })
      );
      qs("#naming-generate", root)?.addEventListener("click", async () => {
        const ai = getSettings().ai || {};
        const statusEl = qs("#naming-status", root);
        if (!hasAiKey(ai)) {
          statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("builder.naming.noKey")}</div>`;
          return;
        }
        const btn = qs("#naming-generate", root);
        btn.disabled = true;
        statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("builder.naming.searching")}</span></div>`;
        try {
          const keywords = qs("#naming-keywords", root)?.value.trim();
          const options = await suggestBrandNames(ai, { brand, keywords, strategy: state.strategy, avoid: state.shown, count: 6 });
          state.options = options;
          state.shown = [...state.shown, ...options.map((o) => o.name)];
          refresh();
        } catch (err) {
          statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${escapeHtml(err instanceof AiApiError ? err.message : t("builder.naming.suggestFail"))}</div>`;
          btn.disabled = false;
        }
      });
    }

    if (p === "check") {
      qs("#naming-check-skip", root)?.addEventListener("click", () => { state.checked = true; refresh(); });
      qs("#naming-check-continue", root)?.addEventListener("click", () => { state.checked = true; refresh(); });
      qs("#naming-check-keep", root)?.addEventListener("click", () => { state.checked = true; refresh(); });
      qs("#naming-check-run", root)?.addEventListener("click", async () => {
        const ai = getSettings().ai || {};
        if (!hasAiKey(ai)) {
          state.checkResult = "error";
          state.checkErrorReason = t("builder.naming.noKeyReason");
          refresh();
          return;
        }
        state.checkLoading = true;
        refresh();
        try {
          state.checkResult = await checkBrandNameLength(ai, { name: state.pendingName, brand });
        } catch (err) {
          state.checkResult = "error";
          state.checkErrorReason = err instanceof AiApiError ? err.message : t("builder.naming.checkFail");
        }
        state.checkLoading = false;
        refresh();
      });
      qsa("[data-naming-pick]", root).forEach((btn) =>
        btn.addEventListener("click", () => {
          const alt = state.checkResult.alternatives[Number(btn.dataset.namingPick)];
          state.pendingName = alt.name;
          state.checkResult = { units: null, breakdown: alt.breakdown, tooLong: false, alternatives: [] };
          state.checked = true;
          refresh();
        })
      );
    }

    if (p === "extension") {
      qsa("[data-naming-category]", root).forEach((el) =>
        el.addEventListener("change", () => {
          state.extensionCategory = el.value;
          refresh();
        })
      );
      qsa("[data-naming-suffix]", root).forEach((btn) =>
        btn.addEventListener("click", () => {
          state.handleSuffix = btn.dataset.namingSuffix;
          persistFinal();
          refresh();
        })
      );
      qs("#naming-skip-extension", root)?.addEventListener("click", () => {
        state.handleSuffix = "";
        persistFinal();
        refresh();
      });
      const saveCustomSuffix = () => {
        const v = qs("#naming-suffix-custom", root)?.value.trim();
        if (!v) return;
        state.handleSuffix = v.startsWith(".") ? v : `.${v}`;
        persistFinal();
        refresh();
      };
      qs("#naming-suffix-custom-save", root)?.addEventListener("click", saveCustomSuffix);
      qs("#naming-suffix-custom", root)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveCustomSuffix(); }
      });
    }
  }

  refresh();
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
