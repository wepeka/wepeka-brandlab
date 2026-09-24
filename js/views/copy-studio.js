// Copy Studio ("Bikin Tulisan" in Guided): short marketing copy on demand —
// Threads posts and threads, Story captions, WhatsApp broadcasts, feed
// captions, or any format the user names. Three questions (format, goal,
// what to say) produce three variants, each previewed in the shape of the
// real thing. Nothing is saved (user's call, 14 Sep 2026): state lives only
// while this page is open, which is also why it never repaints on db:change.
import { getBrand, listCampaigns, listContent, getSettings } from "../store.js";
import { icon } from "../icons.js";
import { escapeHtml, toast, qs, qsa, avatarHTML } from "../dom.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { getMode } from "../mode.js";
import { generateCopy, rewriteCopy, hasAiKey, buildFullContext, campaignSummaryLine, AiApiError } from "../ai.js";
import { pulseTextFor } from "../brand-pulse.js";
import { basisHTML } from "../brand-learning.js";
import { writingRulesOf, writingRulesRowHTML, wireWritingRules, applyFixedHashtags } from "../writing-rules.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { wireMic } from "../voice-input.js";
import { isTourDemo, demoGenerateCopy, demoRewriteCopy, DEMO_TOAST } from "../tour-demo.js";
import { COPY_FORMATS, COPY_GOALS, COPY_LENGTHS, COPY_REWRITES, goalByKey, missingRequired, formatLimit, formatByKey, knownCustomFormat } from "../knowledge/copy-formats.js";
import { t } from "../i18n.js";

const THREADS_LIMIT = formatByKey("threads").limit;
const FEED_PREVIEW_CHARS = formatByKey("feed").previewChars; // Instagram's "… lainnya" fold

// Display text for the copy vocabulary. copy-formats.js keeps the keys and
// the prompt rules; everything shown to the user comes from the dictionary.
const FORMAT_OPTIONS = COPY_FORMATS.map((f) => ({ key: f.key, icon: f.icon, label: t(`copy.format.${f.key}.label`), desc: t(`copy.format.${f.key}.desc`) }));
const GOAL_OPTIONS = COPY_GOALS.map((g) => ({ key: g.key, icon: g.icon, label: t(`copy.goal.${g.key}.label`), desc: t(`copy.goal.${g.key}.desc`) }));
const LENGTH_OPTIONS = COPY_LENGTHS.map((l) => ({ key: l.key, label: t(`copy.lengthOpt.${l.key}`) }));
const formatName = (key) => (formatByKey(key) ? t(`copy.format.${key}.label`) : "");
const goalName = (key) => (goalByKey(key) ? t(`copy.goal.${key}.label`) : "");
const fieldLabel = (goalKey, fieldKey) => t(`copy.goal.${goalKey}.field.${fieldKey}.label`);
const fieldPlaceholder = (goalKey, fieldKey) => t(`copy.goal.${goalKey}.field.${fieldKey}.ph`);
const rewriteLabel = (key) => t(`copy.rewrite.${key}`);

// What makes the chosen format different, in the user's words. For
// "other" it's the known limit if the wording matches one, else nothing.
function formatSpec(formatKey, customFormat = "") {
  if (formatKey === "other") {
    const known = knownCustomFormat(customFormat);
    return known ? [t("copy.known.spec", { label: t(`copy.known.${known.key}`), limit: known.limit })] : [];
  }
  if (!formatByKey(formatKey)) return [];
  return [1, 2, 3].map((n) => t(`copy.format.${formatKey}.spec${n}`));
}

const TOUR_STEPS = [
  {
    selector: "[data-copy-format]",
    title: t("copy.tour.format.title"),
    body: t("copy.tour.format.body"),
    interactive: { type: "clickAny" },
  },
  {
    selector: "#copy-custom-format",
    showIf: () => !!qs("#copy-custom-format"),
    title: t("copy.tour.custom.title"),
    body: t("copy.tour.custom.body"),
    interactive: {
      type: "until",
      predicate: () => !!qs("[data-copy-goal]") && (!qs("#copy-custom-format") || qs("#copy-custom-format").value.trim().length > 1),
    },
    hint: t("copy.tour.custom.hint"),
    skippable: true,
  },
  {
    selector: "[data-copy-goal]",
    title: t("copy.tour.goal.title"),
    body: t("copy.tour.goal.body"),
    interactive: { type: "clickAny" },
  },
  {
    selector: "[data-copy-required]",
    showIf: () => !!qs("[data-copy-required]"),
    title: t("copy.tour.required.title"),
    body: t("copy.tour.required.body"),
    interactive: { type: "input", minLength: 2 },
  },
  {
    selector: "#copy-message",
    title: t("copy.tour.message.title"),
    body: t("copy.tour.message.body"),
    interactive: { type: "input", minLength: 5 },
    skippable: true,
  },
  {
    selector: "#copy-generate",
    title: t("copy.tour.generate.title"),
    body: t("copy.tour.generate.body"),
    interactive: { type: "until", predicate: () => !!qs(".copy-variant") },
    hint: t("copy.tour.generate.hint"),
    skippable: true,
  },
  {
    selector: ".copy-variant .copy-preview",
    showIf: () => !!qs(".copy-variant"),
    title: t("copy.tour.preview.title"),
    body: t("copy.tour.preview.body"),
  },
  {
    selector: "[data-copy-rewrite]",
    showIf: () => !!qs("[data-copy-rewrite]"),
    title: t("copy.tour.rewrite.title"),
    body: t("copy.tour.rewrite.body"),
  },
  {
    selector: "[data-copy-copy]",
    showIf: () => !!qs("[data-copy-copy]"),
    title: t("copy.tour.copy.title"),
    body: t("copy.tour.copy.body"),
  },
];

export function render(root, { brandId }) {
  if (!getBrand(brandId)) {
    location.hash = "#/";
    return () => {};
  }
  // Open to every plan (trial included) since 22 Sep 2026 — it used to be
  // Lifetime-only. Usage is metered by AI credits like every other AI feature.

  const ctx = {
    root,
    brandId,
    dead: false,
    state: {
      step: 1, // Guided wizard only
      format: "",
      customFormat: "",
      threadMode: "single",
      goal: "",
      details: {},
      message: "",
      length: "medium",
      campaignId: "",
      variants: [],
      generating: false,
      error: "",
      lastParams: null,
    },
  };
  paint(ctx);
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
  return () => {
    ctx.dead = true;
  };
}

// ---------- Form ----------

function paint(ctx) {
  const { root, brandId, state } = ctx;
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const guided = getMode() === "guided";
  const campaigns = listCampaigns(brandId).filter((c) => c.status !== "archived");
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${guided ? t("copy.eyebrowGuided") : "Copy Studio"}${helpButtonHTML("copy-studio")}${guideVideoButtonHTML("copy-studio")}</div>
        <h1>${escapeHtml(brand.name)}</h1>
        <p class="page-sub">${t("copy.sub")}</p>
      </div>
    </div>
    ${voiceNudgeHTML(brand, brandId)}
    ${writingRulesRowHTML(brand)}
    <div class="copy-layout">
      <div class="card copy-form">${guided ? wizardHTML(state, campaigns) : formHTML(state, campaigns)}</div>
      <div class="copy-results" id="copy-results"></div>
    </div>
  `;
  wireHelpButtons(root);
  wireWritingRules(root, brandId, () => {
    const row = root.querySelector("[data-writing-rules]");
    if (row) { row.outerHTML = writingRulesRowHTML(getBrand(brandId)); wireWritingRules(root, brandId, () => {}); }
  });
  wireForm(ctx, guided);
  paintResults(ctx);
}

function voiceNudgeHTML(brand, brandId) {
  const dna = brand.brandDNA || {};
  if (dna.targetAudience || dna.positioning || dna.oneLiner || brand.brandBuilder?.toneOfVoice?.source) return "";
  return `
    <div class="hint copy-nudge">${icon("info", { size: 13 })}<span>${t("copy.nudge", { link: `<a class="link" href="#/brand/${brandId}/builder">${t("copy.nudgeLink")}</a>` })}</span></div>
  `;
}

function optionCardsHTML(items, attr, selected) {
  return `
    <div class="copy-option-grid">
      ${items
        .map(
          (it) => `
        <button type="button" class="copy-option ${selected === it.key ? "is-selected" : ""}" ${attr}="${it.key}">
          <span class="copy-option-icon">${icon(it.icon, { size: 18 })}</span>
          <strong>${escapeHtml(it.label)}</strong>
          <span>${escapeHtml(it.desc)}</span>
        </button>`
        )
        .join("")}
    </div>
  `;
}

function chipsHTML(items, attr, selected) {
  return `<div class="chip-select">${items.map((it) => `<button type="button" ${attr}="${it.key}" class="${selected === it.key ? "active" : ""}">${escapeHtml(it.label)}</button>`).join("")}</div>`;
}

function formatLabel(state) {
  if (state.format === "other") return state.customFormat.trim() || formatName("other");
  return formatName(state.format);
}

// What makes the chosen format different — the same facts the prompt
// enforces (js/knowledge/copy-formats.js rules), so the user sees why a
// Threads post and a feed caption won't look alike.
function specItemsHTML(state) {
  return formatSpec(state.format, state.customFormat)
    .map((s) => `<li>${icon("check", { size: 12 })}<span>${escapeHtml(s)}</span></li>`)
    .join("");
}

function specHTML(state) {
  if (!state.format) return "";
  return `<ul class="copy-spec" id="copy-spec" aria-label="${t("copy.specAria")}">${specItemsHTML(state)}</ul>`;
}

function wizardHTML(state, campaigns) {
  const { step } = state;
  const progress = `
    <div class="copy-steps">
      ${[1, 2, 3].map((n) => `<span class="copy-step-dot ${n === step ? "is-current" : n < step ? "is-done" : ""}"></span>`).join("")}
      <span class="copy-step-label">${t("copy.step", { n: step })}</span>
      ${step > 1 ? `<button type="button" class="btn btn-ghost btn-sm copy-back" data-copy-back>${icon("chevronLeft", { size: 13 })}${t("common.back")}</button>` : ""}
    </div>
  `;
  if (step === 1) {
    return `
      ${progress}
      <h2 class="copy-q">${t("copy.q.format")}</h2>
      ${optionCardsHTML(FORMAT_OPTIONS, "data-copy-format", state.format)}
      ${
        state.format === "other"
          ? `${customFormatHTML(state)}${specHTML(state)}<button type="button" class="btn btn-primary btn-block" data-copy-next ${state.customFormat.trim() ? "" : "disabled"}>${t("copy.next")}${icon("arrowRight", { size: 14 })}</button>`
          : ""
      }
    `;
  }
  if (step === 2) {
    return `
      ${progress}
      <h2 class="copy-q">${t("copy.q.goal")}</h2>
      ${optionCardsHTML(GOAL_OPTIONS, "data-copy-goal", state.goal)}
    `;
  }
  return `
    ${progress}
    <h2 class="copy-q">${t("copy.q.message")}</h2>
    <div class="copy-picked">
      <button type="button" class="copy-picked-chip" data-copy-change="1" title="${t("copy.changeFormat")}">${escapeHtml(formatLabel(state))}${icon("edit", { size: 12 })}</button>
      <button type="button" class="copy-picked-chip" data-copy-change="2" title="${t("copy.changeGoal")}">${escapeHtml(goalName(state.goal))}${icon("edit", { size: 12 })}</button>
    </div>
    ${specHTML(state)}
    ${detailsHTML(state)}
    ${messageHTML(state, true)}
    ${optionsHTML(state, campaigns)}
    ${generateButtonHTML(state)}
  `;
}

function formHTML(state, campaigns) {
  return `
    <div class="field"><label>${t("copy.formatLabel")}</label>${chipsHTML(FORMAT_OPTIONS, "data-copy-format", state.format)}</div>
    ${state.format === "other" ? customFormatHTML(state) : ""}
    ${specHTML(state)}
    <div class="field"><label>${t("copy.goalLabel")}</label>${chipsHTML(GOAL_OPTIONS, "data-copy-goal", state.goal)}</div>
    ${detailsHTML(state)}
    ${messageHTML(state, false)}
    ${optionsHTML(state, campaigns)}
    ${generateButtonHTML(state)}
  `;
}

function customFormatHTML(state) {
  return `
    <div class="field copy-custom-field">
      <label for="copy-custom-format">${t("copy.customFormatLabel")}</label>
      <input class="input" id="copy-custom-format" maxlength="80" value="${escapeHtml(state.customFormat)}" placeholder="${t("copy.customFormatPh")}" />
    </div>
  `;
}

function detailsHTML(state) {
  const goal = goalByKey(state.goal);
  if (!goal?.fields.length) return "";
  return `
    ${goal.key === "testimoni" ? `<div class="hint copy-guard">${icon("lock", { size: 12 })}<span>${t("copy.testimonialGuard")}</span></div>` : ""}
    ${goal.fields
      .map((f) => {
        const value = escapeHtml(state.details[f.key] || "");
        const attrs = `id="copy-detail-${f.key}" data-copy-detail="${f.key}" ${f.required ? "data-copy-required" : ""} placeholder="${escapeHtml(fieldPlaceholder(goal.key, f.key))}"`;
        return `
        <div class="field">
          <label for="copy-detail-${f.key}">${escapeHtml(fieldLabel(goal.key, f.key))}${f.required ? ` <span class="copy-required">*</span>` : ` <span class="copy-optional">${t("copy.optional")}</span>`}</label>
          ${f.type === "textarea" ? `<textarea class="textarea" ${attrs}>${value}</textarea>` : `<input class="input" ${attrs} value="${value}" />`}
        </div>`;
      })
      .join("")}
  `;
}

function messageHTML(state, guided) {
  const goal = goalByKey(state.goal);
  const label = guided ? t("copy.messageGuided") : t("copy.message");
  return `
    <div class="field">
      <div class="creator-field-head">
        <label for="copy-message" style="margin-bottom:0;">${label}${goal?.messageOptional ? ` <span class="copy-optional">${t("copy.optional")}</span>` : ` <span class="copy-required">*</span>`}</label>
        <button type="button" class="chip-icon-btn" id="copy-mic" aria-label="${t("copy.voice")}" title="${t("copy.voice")}">${icon("mic", { size: 15 })}</button>
      </div>
      <textarea class="textarea" id="copy-message" placeholder="${escapeHtml(goal ? t(`copy.goal.${goal.key}.messagePh`) : t("copy.messagePh"))}">${escapeHtml(state.message)}</textarea>
    </div>
  `;
}

function optionsHTML(state, campaigns) {
  return `
    ${
      state.format === "threads"
        ? `<div class="field">
             <label>${t("copy.threadShape")}</label>
             <div class="segmented">
               <button type="button" data-copy-thread-mode="single" class="${state.threadMode === "single" ? "active" : ""}">${t("copy.threadSingle")}</button>
               <button type="button" data-copy-thread-mode="chain" class="${state.threadMode === "chain" ? "active" : ""}">${t("copy.threadChain")}</button>
             </div>
           </div>`
        : ""
    }
    <div class="field">
      <label>${t("copy.length")}</label>
      <div class="segmented">
        ${LENGTH_OPTIONS.map((l) => `<button type="button" data-copy-length="${l.key}" class="${state.length === l.key ? "active" : ""}">${l.label}</button>`).join("")}
      </div>
    </div>
    ${
      campaigns.length
        ? `<div class="field">
             <label for="copy-campaign">${t("copy.campaignLabel")} <span class="copy-optional">${t("copy.optional")}</span></label>
             <select class="select" id="copy-campaign">
               <option value="">${t("copy.campaignNone")}</option>
               ${campaigns.map((c) => `<option value="${escapeHtml(c.id)}" ${state.campaignId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
             </select>
           </div>`
        : ""
    }
  `;
}

function generateBlocker(state) {
  if (!state.format) return t("copy.block.format");
  if (state.format === "other" && !state.customFormat.trim()) return t("copy.block.customFormat");
  const goal = goalByKey(state.goal);
  if (!goal) return t("copy.block.goal");
  const missing = missingRequired(state.goal, state.details);
  if (missing.length) return t("copy.block.missing", { fields: missing.map((f) => fieldLabel(goal.key, f.key)).join(", ") });
  if (!goal.messageOptional && state.message.trim().length < 5) return t("copy.block.message");
  return "";
}

const generateLabel = (state) => (state.generating ? t("copy.gen.busy") : state.variants.length ? t("copy.gen.again") : t("copy.gen.first"));

function generateButtonHTML(state) {
  const blocker = generateBlocker(state);
  return `
    <button type="button" class="btn btn-primary btn-block" id="copy-generate" ${blocker || state.generating ? "disabled" : ""}>${icon("bot", { size: 15 })}<span>${generateLabel(state)}</span></button>
    <p class="copy-generate-hint" id="copy-generate-hint">${escapeHtml(blocker)}</p>
  `;
}

// Typing must not repaint the form (it would drop focus), so the button's
// enabled state and hint are updated in place instead.
function syncGenerateButton(ctx) {
  const btn = qs("#copy-generate", ctx.root);
  if (!btn) return;
  const blocker = generateBlocker(ctx.state);
  btn.disabled = !!blocker || ctx.state.generating;
  btn.querySelector("span").textContent = generateLabel(ctx.state);
  const hint = qs("#copy-generate-hint", ctx.root);
  if (hint) hint.textContent = blocker;
}

function wireForm(ctx, guided) {
  const { root, state } = ctx;
  qsa("[data-copy-format]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.format = btn.dataset.copyFormat;
      if (guided && state.format !== "other") state.step = 2;
      paint(ctx);
      if (state.format === "other") qs("#copy-custom-format", root)?.focus();
    })
  );
  qsa("[data-copy-goal]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.goal = btn.dataset.copyGoal;
      if (guided) state.step = 3;
      paint(ctx);
    })
  );
  qs("[data-copy-back]", root)?.addEventListener("click", () => {
    state.step = Math.max(1, state.step - 1);
    paint(ctx);
  });
  qsa("[data-copy-change]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.step = Number(btn.dataset.copyChange);
      paint(ctx);
    })
  );
  qs("[data-copy-next]", root)?.addEventListener("click", () => {
    if (!state.customFormat.trim()) return;
    state.step = 2;
    paint(ctx);
  });
  qs("#copy-custom-format", root)?.addEventListener("input", (e) => {
    state.customFormat = e.target.value;
    const next = qs("[data-copy-next]", root);
    if (next) next.disabled = !state.customFormat.trim();
    // A known format ("bio Instagram") has a real limit; show it as typed.
    const spec = qs("#copy-spec", root);
    if (spec) spec.innerHTML = specItemsHTML(state);
    syncGenerateButton(ctx);
  });
  qsa("[data-copy-detail]", root).forEach((el) =>
    el.addEventListener("input", () => {
      state.details[el.dataset.copyDetail] = el.value;
      syncGenerateButton(ctx);
    })
  );
  const message = qs("#copy-message", root);
  message?.addEventListener("input", () => {
    state.message = message.value;
    syncGenerateButton(ctx);
  });
  const mic = qs("#copy-mic", root);
  if (mic && message) wireMic(mic, message);

  const segmented = (attr, key) =>
    qsa(`[${attr}]`, root).forEach((btn) =>
      btn.addEventListener("click", () => {
        state[key] = btn.getAttribute(attr);
        qsa(`[${attr}]`, root).forEach((b) => b.classList.toggle("active", b === btn));
      })
    );
  segmented("data-copy-thread-mode", "threadMode");
  segmented("data-copy-length", "length");
  qs("#copy-campaign", root)?.addEventListener("change", (e) => {
    state.campaignId = e.target.value;
  });
  qs("#copy-generate", root)?.addEventListener("click", () => runGenerate(ctx));
}

// ---------- AI ----------

async function runGenerate(ctx) {
  const { state, brandId } = ctx;
  if (state.generating || generateBlocker(state)) return;
  const ai = getSettings().ai || {};
  const demo = isTourDemo(); // tur → contoh hasil, tanpa token (js/tour-demo.js)
  if (!hasAiKey(ai) && !demo) {
    state.error = t("copy.err.noKey");
    paintResults(ctx);
    return;
  }
  const brand = getBrand(brandId);
  const campaigns = listCampaigns(brandId);
  const campaign = campaigns.find((c) => c.id === state.campaignId);
  const goal = goalByKey(state.goal);
  const params = {
    format: state.format,
    customFormat: state.customFormat.trim(),
    threadMode: state.threadMode,
    goal: state.goal,
    details: Object.fromEntries(
      (goal?.fields || []).map((f) => [f.key, (state.details[f.key] || "").trim()]).filter(([, v]) => v)
    ),
    message: state.message.trim(),
    length: state.length,
    campaignLine: campaign ? campaignSummaryLine(campaign, brand) : "",
  };

  state.generating = true;
  state.error = "";
  paintResults(ctx);
  syncGenerateButton(ctx);
  try {
    if (demo) toast(DEMO_TOAST);
    const { variants } = demo
      ? await demoGenerateCopy({ brand, ...params })
      : await generateCopy(ai, { ...params, brandContext: buildFullContext(brand, { campaigns, pulseText: pulseTextFor(brand, { content: listContent(brandId), campaigns, settings: getSettings() }) }) });
    if (ctx.dead) return;
    // A feed caption ends with the brand's fixed hashtags (Aturan tulisan),
    // put on by code — never guessed.
    const fixed = params.format === "feed" ? writingRulesOf(getBrand(brandId)).hashtags : [];
    state.variants = variants.map((v) => ({ parts: fixed.length ? v.parts.map((p) => applyFixedHashtags(p, fixed)) : v.parts, note: v.note || "", demo, rated: false, editing: false, busy: false }));
    state.lastParams = params;
  } catch (e) {
    if (ctx.dead) return;
    state.error = e instanceof AiApiError ? e.message : t("copy.err.generate");
  } finally {
    if (!ctx.dead) {
      state.generating = false;
      paintResults(ctx);
      syncGenerateButton(ctx);
    }
  }
}

async function runRewrite(ctx, index, rewriteKey) {
  const { state, brandId } = ctx;
  const v = state.variants[index];
  const params = state.lastParams;
  const rewrite = COPY_REWRITES.find((r) => r.key === rewriteKey);
  if (!v || v.busy || !params || !rewrite) return;
  const ai = getSettings().ai || {};
  const demo = isTourDemo();
  if (!hasAiKey(ai) && !demo) {
    toast(t("copy.err.noKey"), "error");
    return;
  }
  v.busy = true;
  paintResults(ctx);
  try {
    if (demo) toast(DEMO_TOAST);
    const brand = getBrand(brandId);
    const next = demo
      ? await demoRewriteCopy({ parts: v.parts, note: v.note, label: rewriteLabel(rewrite.key).toLowerCase() })
      : await rewriteCopy(ai, {
          brandContext: buildFullContext(brand, {
            campaigns: listCampaigns(brandId),
            pulseText: pulseTextFor(brand, { content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() }),
          }),
          format: params.format,
          customFormat: params.customFormat,
          threadMode: params.threadMode,
          parts: v.parts,
          note: v.note,
          rewrite: rewrite.key,
        });
    if (ctx.dead) return;
    const fixed = params.format === "feed" && !demo ? writingRulesOf(getBrand(brandId)).hashtags : [];
    v.parts = fixed.length ? next.parts.map((p) => applyFixedHashtags(p, fixed)) : next.parts;
    v.note = next.note ?? v.note;
    v.demo = v.demo || demo;
    v.rated = false;
  } catch (e) {
    if (!ctx.dead) toast(e instanceof AiApiError ? e.message : t("copy.err.rewrite"), "error");
  } finally {
    if (!ctx.dead) {
      v.busy = false;
      paintResults(ctx);
    }
  }
}

// ---------- Results ----------

function paintResults(ctx) {
  const el = qs("#copy-results", ctx.root);
  if (!el) return;
  el.innerHTML = resultsHTML(ctx);
  wireResults(ctx, el);
}

function resultsHTML(ctx) {
  const { state, brandId } = ctx;
  if (state.generating) {
    return `<div class="card copy-results-empty"><div class="spinner"></div><h3>${t("copy.loading.title")}</h3><p>${t("copy.loading.body")}</p></div>`;
  }
  const error = state.error ? `<div class="ocr-status copy-error">${icon("info", { size: 15 })}<span>${escapeHtml(state.error)}</span></div>` : "";
  if (!state.variants.length) {
    return `
      ${error}
      <div class="card copy-results-empty">
        <div class="copy-results-empty-icon">${icon("sparkle", { size: 22 })}</div>
        <h3>${t("copy.empty.title")}</h3>
        <p>${t("copy.empty.body")}</p>
      </div>
    `;
  }
  const brand = getBrand(brandId);
  const params = state.lastParams;
  const resultsFormat = params.format === "other" ? params.customFormat || formatName("other") : formatName(params.format);
  return `
    ${error}
    <div class="copy-results-head">
      <h2>${t("copy.results.count", { n: state.variants.length })}</h2>
      <span class="tag copy-format-tag">${escapeHtml(resultsFormat)}</span>
      ${state.variants.some((v) => v.demo) ? `<span class="tag copy-demo-tag">${t("copy.results.sample")}</span>` : ""}
    </div>
    <p class="copy-results-sub">${t("copy.results.sub")}</p>
    ${state.variants.some((v) => v.demo) ? "" : basisHTML(brand, { content: listContent(brandId), settings: getSettings() })}
    ${state.variants.map((v, i) => variantHTML(v, i, params, brand)).join("")}
  `;
}

// "412/500 karakter" against the format's real limit; red when over. A
// Threads chain counts per post (each post has its own 500), the rest
// count the whole text. No limit known → plain count.
function charMetaHTML(v, params) {
  const text = v.parts.join("\n\n");
  const { limit, perPart } = formatLimit(params.format, params.customFormat);
  if (!limit) return t("copy.chars", { n: text.length });
  if (perPart) {
    const longest = Math.max(...v.parts.map((p) => p.length));
    const label = v.parts.length > 1 ? t("copy.longestPost", { n: longest, limit }) : t("copy.charsOf", { n: longest, limit });
    return `<span class="${longest > limit ? "is-over" : ""}">${label}</span>`;
  }
  return `<span class="${text.length > limit ? "is-over" : ""}">${t("copy.charsOf", { n: text.length, limit })}</span>`;
}

function variantHTML(v, i, params, brand) {
  const multi = v.parts.length > 1;
  const lock = v.busy ? "disabled" : "";
  return `
    <div class="card copy-variant" data-variant="${i}">
      <div class="copy-variant-head">
        <span class="copy-variant-num">${t("copy.option", { n: i + 1 })}</span>
        <span class="copy-variant-meta">${multi ? `${t("copy.postCount", { n: v.parts.length })} · ` : ""}${charMetaHTML(v, params)}</span>
      </div>
      ${v.editing ? editorHTML(v, i) : previewHTML(v, i, params, brand)}
      ${v.note ? `<div class="copy-note">${icon("sparkle", { size: 13 })}<span>${escapeHtml(v.note)}</span></div>` : ""}
      <div class="copy-actions">
        <button type="button" class="btn btn-primary btn-sm" data-copy-copy="${i}" ${lock}>${icon("copy", { size: 14 })}${multi ? t("copy.copyAll") : t("copy.copy")}</button>
        ${params.format === "wa" ? `<button type="button" class="btn btn-secondary btn-sm" data-copy-wa="${i}" ${lock}>${icon("send", { size: 14 })}${t("copy.openWa")}</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm" data-copy-edit="${i}" ${lock}>${icon(v.editing ? "check" : "edit", { size: 14 })}${v.editing ? t("copy.doneEditing") : t("common.edit")}</button>
      </div>
      <div class="copy-rewrites">
        ${COPY_REWRITES.map((r) => `<button type="button" class="copy-rewrite-chip" data-copy-rewrite="${r.key}" data-variant-index="${i}" ${v.busy || v.editing ? "disabled" : ""}>${escapeHtml(rewriteLabel(r.key))}</button>`).join("")}
        ${v.busy ? `<span class="copy-busy"><span class="spinner"></span>${t("copy.busy")}</span>` : ""}
      </div>
      <div class="copy-feedback-slot"></div>
    </div>
  `;
}

const handleFor = (brand) => (brand?.name || "brand").toLowerCase().replace(/[^a-z0-9._]/g, "") || "brand";
const nowTime = () => new Date().toTimeString().slice(0, 5);
const SMALL_AVATAR = "width:32px;height:32px;border-radius:50%;font-size:12px;flex:none;";

// WhatsApp's own markup: *tebal*, _miring_, ~coret~.
function waRichText(text) {
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,:;!?]|$)/gm, "$1<i>$2</i>")
    .replace(/~([^~\n]+)~/g, "<s>$1</s>");
}

function hashtagRichText(text) {
  return escapeHtml(text).replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, '$1<span class="cp-tag">$2</span>');
}

// Instagram shows only the first ~125 characters of a caption in the feed,
// then "… more". The preview folds at the same point so the user sees
// exactly which part of the hook survives; "more" expands it in place.
function feedCaptionHTML(text) {
  if (text.length <= FEED_PREVIEW_CHARS) return hashtagRichText(text);
  return `
    <span class="cp-fold-short">${hashtagRichText(text.slice(0, FEED_PREVIEW_CHARS).trimEnd())}<button type="button" class="cp-more" data-cp-more>${t("copy.preview.more")}</button></span>
    <span class="cp-fold-full">${hashtagRichText(text)}</span>
  `;
}

// The Story sticker suggestion drawn as a sticker on the frame, so the
// user sees that the call to action lives there, not in the text.
function storyStickerHTML(note) {
  if (!note) return "";
  // "Stiker polling: …" (what the AI writes) or "Sample poll sticker: …"
  // (English tour sample).
  const m = note.match(/^\s*(?:contoh\s+)?stiker\s+([^:]+):\s*(.+)$/i) || note.match(/^\s*(?:sample\s+)?([^:]+?)\s+sticker:\s*(.+)$/i);
  const kind = m ? m[1].trim() : "";
  const body = m ? m[2].trim() : note.trim();
  return `<div class="cp-story-sticker">${kind ? `<span class="cp-story-sticker-kind">${escapeHtml(kind)}</span>` : ""}<span>${escapeHtml(body)}</span></div>`;
}

function previewHTML(v, i, params, brand) {
  const handle = escapeHtml(handleFor(brand));
  const text = v.parts.join("\n\n");
  switch (params.format) {
    case "threads":
      return `
        <div class="copy-preview copy-preview-threads">
          ${v.parts
            .map(
              (p, idx) => `
            <div class="cp-th-post">
              <div class="cp-th-rail">${avatarHTML(brand, SMALL_AVATAR)}${idx < v.parts.length - 1 ? `<span class="cp-th-line"></span>` : ""}</div>
              <div class="cp-th-body">
                <div class="cp-th-name">${handle} <span>${t("copy.preview.justNow")}</span></div>
                <div class="cp-text">${escapeHtml(p)}</div>
                <div class="cp-th-meta">
                  <span class="${p.length > THREADS_LIMIT ? "is-over" : ""}">${p.length}/${THREADS_LIMIT}</span>
                  ${v.parts.length > 1 ? `<button type="button" class="cp-mini-copy" data-copy-part="${i}:${idx}">${icon("copy", { size: 12 })}${t("copy.preview.copyPost")}</button>` : ""}
                </div>
              </div>
            </div>`
            )
            .join("")}
        </div>
      `;
    case "wa":
      return `
        <div class="copy-preview copy-preview-wa">
          <div class="cp-wa-bubble"><div class="cp-text">${waRichText(text)}</div><span class="cp-wa-time">${nowTime()} ✓✓</span></div>
        </div>
      `;
    case "story":
      return `
        <div class="copy-preview copy-preview-story">
          <div class="cp-story-frame">
            <div class="cp-story-bar"><span></span></div>
            <div class="cp-story-head">${avatarHTML(brand, "width:24px;height:24px;border-radius:50%;font-size:10px;flex:none;")}<span>${handle}</span></div>
            <div class="cp-story-text">${escapeHtml(text)}</div>
            ${storyStickerHTML(v.note)}
          </div>
        </div>
      `;
    case "feed":
      return `
        <div class="copy-preview copy-preview-feed">
          <div class="cp-feed-head">${avatarHTML(brand, SMALL_AVATAR)}<b>${handle}</b></div>
          <div class="cp-feed-media">${icon("image", { size: 26 })}<span>${t("copy.preview.media")}</span></div>
          <div class="cp-text cp-feed-caption"><b>${handle}</b> ${feedCaptionHTML(text)}</div>
        </div>
      `;
    default:
      return `
        <div class="copy-preview copy-preview-plain">
          <div class="cp-plain-label">${escapeHtml(params.customFormat || t("copy.preview.plain"))}</div>
          <div class="cp-text">${escapeHtml(text)}</div>
        </div>
      `;
  }
}

function editorHTML(v, i) {
  return `
    <div class="copy-editor">
      ${v.parts
        .map(
          (p, idx) => `
        <div class="field" style="margin-bottom:10px;">
          ${v.parts.length > 1 ? `<label>${t("copy.post", { n: idx + 1 })}</label>` : ""}
          <textarea class="textarea" data-copy-edit-part="${i}:${idx}" rows="${Math.min(14, Math.max(4, p.split("\n").length + 1))}">${escapeHtml(p)}</textarea>
        </div>`
        )
        .join("")}
    </div>
  `;
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    toast(t("copy.copyFail"), "error");
  }
}

function wireResults(ctx, el) {
  const { state, brandId } = ctx;
  const at = (value) => state.variants[Number(value)];

  qsa("[data-copy-copy]", el).forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = at(btn.dataset.copyCopy);
      if (v) copyText(v.parts.join("\n\n"), v.parts.length > 1 ? t("copy.copiedAll") : t("copy.copied"));
    })
  );
  qsa("[data-copy-part]", el).forEach((btn) =>
    btn.addEventListener("click", () => {
      const [vi, pi] = btn.dataset.copyPart.split(":").map(Number);
      const part = state.variants[vi]?.parts[pi];
      if (part) copyText(part, t("copy.copiedPost", { n: pi + 1 }));
    })
  );
  qsa("[data-copy-wa]", el).forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = at(btn.dataset.copyWa);
      if (v) window.open(`https://wa.me/?text=${encodeURIComponent(v.parts.join("\n\n"))}`, "_blank", "noopener");
    })
  );
  qsa("[data-copy-edit]", el).forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = at(btn.dataset.copyEdit);
      if (!v) return;
      if (v.editing) {
        const kept = v.parts.map((p) => p.trim()).filter(Boolean);
        v.parts = kept.length ? kept : v.parts;
      }
      v.editing = !v.editing;
      paintResults(ctx);
    })
  );
  qsa("[data-copy-edit-part]", el).forEach((ta) =>
    ta.addEventListener("input", () => {
      const [vi, pi] = ta.dataset.copyEditPart.split(":").map(Number);
      const v = state.variants[vi];
      if (v) v.parts[pi] = ta.value;
    })
  );
  qsa("[data-copy-rewrite]", el).forEach((btn) =>
    btn.addEventListener("click", () => runRewrite(ctx, Number(btn.dataset.variantIndex), btn.dataset.copyRewrite))
  );
  qsa("[data-cp-more]", el).forEach((btn) =>
    btn.addEventListener("click", () => btn.closest(".cp-feed-caption")?.classList.add("is-expanded"))
  );

  // 👍/👎 per variant — never on tour sample output, so a sample never lands
  // in the aiFeedback eval set.
  const params = state.lastParams;
  if (!params) return;
  qsa(".copy-variant", el).forEach((card) => {
    const v = at(card.dataset.variant);
    if (!v || v.demo || v.rated || v.editing || v.busy) return;
    mountAiFeedback(qs(".copy-feedback-slot", card), {
      brandId,
      feature: `copy-${params.format}`,
      prompt: params,
      output: v.parts,
      onRated: () => {
        v.rated = true;
      },
    });
  });
}
