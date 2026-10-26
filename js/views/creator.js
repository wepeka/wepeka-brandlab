import { getBrand, listContent, getContent, createContent, updateContent as storeUpdateContent, deleteContent, getSettings, updateSettings, onChange, listCampaigns, listSeries, getSeries, STATUS_LABELS, STATUSES, FUNNELS, localISODate, TRASH_DAYS, campaignHasOwnPhases } from "../store.js";
import { campaignStages, activeStageIndex } from "../campaign-metrics.js";
import { icon, platformIcon } from "../icons.js";
import { escapeHtml, formatDate, formatNumber, toast, qs, qsa, wireClickableCards, openMenu, closeMenu } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openTeleprompter } from "./teleprompter.js";
import { consumeNavContext, go } from "../nav-context.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { generateScript, AiApiError, hasAiKey, buildFullContext, buildSeriesContext, seriesEpisodeTitles, campaignSummaryLine, durationToSeconds } from "../ai.js";
import { HOOK_TYPES, SCRIPT_STRUCTURES, orderedHookTypes, recommendedHookTypes, recommendedStructures, hookTypeByKey } from "../knowledge/hook-types.js";
import { applyHook, parseSlides, serializeSlides, hookText, hookOf, scriptBeatsHTML, scriptLength, spokenText, plainScript, applyPlainScript, isCarouselContent } from "../script-format.js";
import { openScriptPdfPreview } from "../script-pdf.js";
import { openScriptFocus } from "../script-focus.js";
import { mountScriptCards } from "../script-cards.js";
import { weekStart, addDays } from "../goal-roadmap.js";
import { getLang } from "../i18n.js";
import { pulseTextFor } from "../brand-pulse.js";
import { openBrandMemoryModal, savedMoments } from "../brand-memory.js";
import { basisHTML } from "../brand-learning.js";
import { writingRulesOf, writingRulesRowHTML, wireWritingRules, applyFixedHashtags } from "../writing-rules.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { getMode } from "../mode.js";
import { t, campaignDisplayName } from "../i18n.js";
import { funnelFieldHTML, wireFunnelField, statusLabel, funnelShort } from "../funnel-field.js";
import { setPageGuide } from "../section-guide.js";
import { openWeekPlanMenu, openScriptChat, openContentChat, dockChat, undockChat } from "../consultant-panel.js";
import { startCreatorGuide, startCreatorGuideOnMount } from "../guides/creator-guide.js";
import { isTourDemo, demoGenerateScript, DEMO_TOAST } from "../tour-demo.js";
import { wireMic } from "../voice-input.js";
import { openHookTemplatePicker } from "../hook-template-picker.js";
import { appCharacterSVG } from "../app-characters.js";

// Mirror twins (one idea posted to Instagram + TikTok, see
// the content drawer) share their writing: whatever gets written
// on one — title, idea, script, caption, goal, campaign — is copied onto
// the other, so the TikTok half never sits blank. This used to happen only
// once, when the old edit drawer saved. Platform-specific fields (status,
// upload checkboxes, thumbnail) stay per record.
const MIRROR_SHARED_FIELDS = ["title", "idea", "script", "caption", "cta", "reference", "notes", "funnel", "campaignId", "campaignPhaseId", "seriesId"];
function updateContent(id, patch) {
  // An idea that gets a script is being written now: "Ide" → "Naskah". It
  // used to stay "Ide" however much was written, so Beranda's work-in-progress
  // list (which reads Naskah/Syuting/Editing) never showed it.
  if (typeof patch.script === "string" && patch.script.trim() && !patch.status && getContent(id)?.status === "idea") patch = { ...patch, status: "draft" };
  storeUpdateContent(id, patch);
  const item = getContent(id);
  if (!item?.mirrorGroupId) return;
  const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => MIRROR_SHARED_FIELDS.includes(k)));
  if (!Object.keys(shared).length) return;
  listContent(item.brandId)
    .filter((c) => c.mirrorGroupId === item.mirrorGroupId && c.id !== id)
    .forEach((c) => storeUpdateContent(c.id, shared));
}

// Best-effort desktop notification — always toasts too, since Notification
// permission can be denied/unsupported and the in-app confirmation should
// never depend on it.
function notify(title, body) {
  toast(`${title} — ${body}`);
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") new Notification(title, { body });
    });
  }
}

// Generates hooks, a shoot-ready beat script (js/script-format.js) and a
// caption — onInsert receives { hook } / { script } / { caption } depending
// on which button was clicked, and the caller decides which field to drop it
// into. `val` is what goes into the AI prompt (js/ai.js durationToSeconds
// turns it into a word budget); `label` is the chip text. Real lengths, not
// "<1 menit": a 15-second and a 55-second video are different scripts.
const DURATION_OPTIONS = [
  { val: "15 dtk", label: t("cr.ai.dur.15") },
  { val: "30 dtk", label: t("cr.ai.dur.30") },
  { val: "60 dtk", label: t("cr.ai.dur.60") },
  { val: "90 dtk", label: t("cr.ai.dur.90") },
  { val: "2-3 menit", label: t("cr.ai.dur.long") },
  { val: "Custom", label: t("cr.ai.dur.custom") },
];
const defaultDuration = (format) => (/long|panjang|youtube/i.test(format || "") ? "2-3 menit" : /story/i.test(format || "") ? "15 dtk" : "30 dtk");
const HOOK_CHIPS_SHOWN = 6;
// The last "Template hook" line put into each piece this visit, so the next
// one replaces it instead of stacking on top in a plain-text script.
const lastTemplateHook = new Map();
const MAX_HOOK_TYPES = 3;

// "Tipe hook": the owner picks up to three kinds of opening (or leaves it
// on Campur and the AI tries three different ones). The ones that suit this
// piece's funnel come first with a dot — recommended, never pre-picked.
function hookTypePickerHTML(funnel, picked, showAll) {
  const rec = recommendedHookTypes(funnel);
  const ordered = orderedHookTypes(funnel);
  const chip = (h, i) => {
    const on = picked.includes(h.key);
    const hidden = !showAll && i >= HOOK_CHIPS_SHOWN && !on;
    return `<button type="button" class="hook-chip${on ? " active" : ""}${rec.includes(h.key) ? " is-rec" : ""}" data-hook-type="${h.key}" aria-pressed="${on}" ${hidden ? "hidden" : ""}>${t(`hook.type.${h.key}.label`)}${rec.includes(h.key) ? `<span class="hook-rec-dot" aria-hidden="true"></span>` : ""}</button>`;
  };
  const hiddenCount = ordered.filter((h, i) => i >= HOOK_CHIPS_SHOWN && !picked.includes(h.key)).length;
  return `
    <div class="field hook-type-field" id="hook-type-field">
      <div class="creator-field-head">
        <label style="margin-bottom:0;">${t("cr.ai.hookType")}</label>
        <span class="hook-rec-legend"><span class="hook-rec-dot" aria-hidden="true"></span>${escapeHtml(t("cr.ai.recommendedTitle", { funnel: funnelShort(funnel) }))}</span>
      </div>
      <div class="hook-chips" role="group" aria-label="${escapeHtml(t("cr.ai.hookType"))}">
        <button type="button" class="hook-chip hook-chip-mix${picked.length ? "" : " active"}" data-hook-mix aria-pressed="${!picked.length}">${icon("sparkle", { size: 12 })}${t("cr.ai.hookMix")}</button>
        ${ordered.map(chip).join("")}
        ${hiddenCount ? `<button type="button" class="hook-chip hook-chip-more" data-hook-more>${t("cr.ai.hookMore", { n: hiddenCount })}</button>` : ""}
      </div>
      <div class="hook-type-help">${picked.length
        ? picked.map((k) => `<p><b>${t(`hook.type.${k}.label`)}</b> — ${escapeHtml(t(`hook.type.${k}.desc`))} <span class="text-faint">${escapeHtml(t(`hook.type.${k}.ex`))}</span></p>`).join("")
        : `<p class="text-faint">${t("cr.ai.hookTypeHint")}</p>`}</div>
    </div>`;
}

// "Alur isi": one choice, so a dropdown (the hook chips are already a row).
function structurePickerHTML(funnel, picked) {
  const rec = recommendedStructures(funnel);
  return `
    <div class="field">
      <label for="ai-structure">${t("cr.ai.structure")}</label>
      <select class="select" id="ai-structure">
        ${SCRIPT_STRUCTURES.map((s) => `<option value="${s.key}" ${s.key === picked ? "selected" : ""}>${escapeHtml(t(`script.struct.${s.key}.label`))}${rec.includes(s.key) ? ` · ${escapeHtml(t("cr.ai.recommended"))}` : ""}</option>`).join("")}
      </select>
      <p class="hook-type-help text-faint" id="ai-structure-help" style="margin-top:6px;">${escapeHtml(t(`script.struct.${picked}.desc`))}</p>
    </div>`;
}

// One hook as a card: its type, the line to say, and — for a video — what
// goes on screen and what the first second shows, plus why it should work.
// `inScript`: the script preview opens with this hook; `used`: the owner
// put it into the piece ("Pakai") — two different things.
function hookCardHTML(h, i, { inScript = false, used = false, restore = false, carousel = false } = {}) {
  const o = typeof h === "string" ? { say: h } : h || {};
  const badge = o.type && hookTypeByKey(o.type) ? `<span class="hook-type-badge">${t(`hook.type.${o.type}.label`)}</span>` : "";
  const flag = inScript ? `<span class="hook-in-script">${icon("check", { size: 11 })}${t("cr.ai.inScript")}</span>` : "";
  return `
    <div class="card card-tight hook-card${inScript ? " is-in-script" : ""}">
      <div class="hook-card-main">
        ${badge || flag ? `<div class="hook-card-tags">${badge}${flag}</div>` : ""}
        <div class="hook-say">${escapeHtml(hookText(o))}</div>
        ${o.onScreen ? `<div class="hook-layer"><span>${t("cr.ai.hookOnScreen")}</span>${escapeHtml(o.onScreen)}</div>` : ""}
        ${o.visual ? `<div class="hook-layer"><span>${carousel ? t("cr.ai.hookCover") : t("cr.ai.hookVisual")}</span>${escapeHtml(o.visual)}</div>` : ""}
        ${o.why ? `<div class="hook-why">${escapeHtml(o.why)}</div>` : ""}
      </div>
      <button type="button" class="btn btn-secondary btn-sm${used ? " is-used" : ""}" ${restore ? `data-restore-hook="${i}"` : `data-insert-hook="${i}"`} style="flex:none;">${used ? t("cr.ai.hookUsed") : t("cr.ai.use")}</button>
    </div>`;
}

// The script as beat cards (what to film / screen text / what to say) with
// its real length, instead of one grey block of text.
function scriptPreviewHTML(text, targetSec = null) {
  const beats = scriptBeatsHTML(text, escapeHtml);
  const { words, seconds } = scriptLength(text);
  const over = targetSec && seconds > targetSec * 1.25;
  return `
    ${beats ? `<div class="ai-length${over ? " is-over" : ""}">${icon("clock", { size: 12 })}${t("cr.ai.lengthBadge", { s: seconds, w: words })}${over ? ` · ${escapeHtml(t("cr.ai.lengthOver", { t: targetSec }))}` : ""}</div>` : ""}
    <div class="card card-tight ai-script-preview${beats ? " has-beats" : ""}">${beats || escapeHtml(text)}</div>
    ${beats ? `<p class="text-faint ai-script-hint">${t("cr.ai.scriptHint")}</p>` : ""}`;
}

// lite: pass a field name ("script" or "caption") to show a stripped-down
// version — just the prompt box (pre-filled from that field) and Generate,
// skipping funnel/duration/goal/article. The results (hooks + script +
// caption, each with a Use button) are identical either way.
// opts.simple (Pemula): the prompt and the length only — the kinds of hook
// and the flow of the script stay on their automatic choice (Campur, Auto).
function openAiScriptModal(content, brand, onInsert, lite = null, opts = {}) {
  const ai = getSettings().ai || { provider: "anthropic" };
  const hasKey = hasAiKey(ai);
  const demo = isTourDemo(); // tur → contoh hasil, tanpa token (js/tour-demo.js)
  if (!hasKey && !demo) {
    toast(t("cr.ai.needKey"), "error");
    return;
  }

  const state = { funnel: content.funnel || "TOFU", duration: defaultDuration(content.format), hookTypes: [], structure: "auto", showAllHooks: false };
  const isCarouselPiece = isCarouselContent(content);
  // #6/#7: once every field this modal is for has a "used" click (any
  // batch — Generate More gives independent alternatives, not a pipeline,
  // so a script from batch 1 + a caption from batch 2 still counts), the
  // panel closes itself. `lite` modals only care about their one field.
  const used = { script: false, caption: false };
  // The hook the user last hit "Use" on — kept so a script they use *after*
  // picking a hook gets that hook, instead of overwriting it with its own.
  let pickedHook = "";
  function maybeAutoClose() {
    const ready = lite ? !!used[lite] : used.script && used.caption;
    if (!ready) return;
    setTimeout(() => closeOverlay(overlay), 1400);
  }
  // Pemula's piece may only have its working title yet: that's the brief.
  const prefill = opts.prompt ?? (lite ? content[lite] || content.idea || "" : content.idea || (opts.simple ? content.title || "" : ""));
  // What the writer reads besides the brand facts: the newest moments in
  // brand memory (js/brand-pulse.js buildPulseText keeps at most 8 entries).
  const memoryCount = Math.min(savedMoments(brand).length, 8);

  const overlay = openModal({
    title: lite ? t("cr.ai.quickTitle", { field: lite === "script" ? t("cr.f.script") : t("cr.f.caption") }) : t("cr.ai.title"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 6px;">${t("cr.ai.contextNote", { brand: escapeHtml(brand?.name || t("cr.ai.thisBrand")) })}</p>
      ${brand ? writingRulesRowHTML(brand) : ""}
      <p class="text-faint cr-ai-memory" style="font-size:12px;margin:0 0 14px;">${icon("heart", { size: 12 })}<span>${memoryCount ? t("cr.ai.memoryNote", { n: memoryCount }) : t("cr.ai.memoryEmpty")}</span> <button type="button" class="link cr-ai-memory-open" id="ai-memory-open">${t("cr.ai.memoryOpen")}</button></p>

      <div class="field" style="margin-bottom:14px;">
        <div class="creator-field-head">
          <label for="ai-prompt" style="margin-bottom:0;">${lite ? t("cr.ai.promptLabelLite") : t("cr.ai.promptLabel")}</label>
          <button type="button" class="chip-icon-btn" id="ai-mic" aria-label="${t("cr.ai.voiceInput")}" title="${t("cr.ai.voiceTitle")}">${icon("mic", { size: 15 })}</button>
        </div>
        <textarea class="textarea" id="ai-prompt" style="min-height:70px;" placeholder="${t("cr.ai.promptPh")}">${escapeHtml(prefill)}</textarea>
      </div>

      ${
        lite
          ? ""
          : `
      ${isCarouselPiece ? "" : `<div class="field" style="margin-bottom:14px;">
        <label id="ai-duration-label">${t("cr.ai.duration")}</label>
        <div class="chip-select" id="ai-duration-chips" role="group" aria-labelledby="ai-duration-label">
          ${DURATION_OPTIONS.map((d) => `<button type="button" data-val="${d.val}" class="${state.duration === d.val ? "active" : ""}" aria-pressed="${state.duration === d.val}">${d.label}</button>`).join("")}
        </div>
        <input class="input" id="ai-duration-custom" aria-label="${t("cr.ai.durationCustomAria")}" style="margin-top:8px;${state.duration === "Custom" ? "" : "display:none;"}" placeholder="${t("cr.ai.durationPh")}" />
      </div>`}
      ${opts.simple ? "" : `<div id="hook-type-wrap">${hookTypePickerHTML(state.funnel, state.hookTypes, state.showAllHooks)}</div>
      ${structurePickerHTML(state.funnel, state.structure)}`}`
      }

      <button type="button" class="btn btn-primary btn-block" id="ai-generate">${icon("bot", { size: 14 })}${t("cr.ai.generate")}</button>
      <div id="ai-result" style="margin-top:16px;">
        <div id="ai-current-batch"></div>
        <details class="ai-history" id="ai-history" hidden>
          <summary>${t("cr.ai.previousGenerated")} (<span id="ai-history-count">0</span>)</summary>
          <div id="ai-history-list"></div>
        </details>
      </div>
    `,
    footHTML: `<button class="btn btn-secondary" id="ai-close">${t("common.close")}</button>`,
  });
  overlay.querySelector("#ai-close").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("#ai-memory-open")?.addEventListener("click", () => { if (brand) openBrandMemoryModal(brand.id); });
  // Aturan tulisan: saved → redraw the row in place (the next generate reads it).
  const rulesRefresh = () => {
    const row = overlay.querySelector("[data-writing-rules]");
    if (!row || !brand) return;
    row.outerHTML = writingRulesRowHTML(getBrand(brand.id));
    wireWritingRules(overlay, brand.id, rulesRefresh);
  };
  if (brand) wireWritingRules(overlay, brand.id, rulesRefresh);

  const micBtn = overlay.querySelector("#ai-mic");
  if (micBtn) wireMic(micBtn, overlay.querySelector("#ai-prompt"));

  // Hook type chips: Campur clears the pick; a type toggles (max three).
  const hookWrap = overlay.querySelector("#hook-type-wrap");
  const redrawHookTypes = () => { if (hookWrap) hookWrap.innerHTML = hookTypePickerHTML(state.funnel, state.hookTypes, state.showAllHooks); };
  hookWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.hasAttribute("data-hook-mix")) state.hookTypes = [];
    else if (btn.hasAttribute("data-hook-more")) state.showAllHooks = true;
    else if (btn.dataset.hookType) {
      const k = btn.dataset.hookType;
      if (state.hookTypes.includes(k)) state.hookTypes = state.hookTypes.filter((x) => x !== k);
      else if (state.hookTypes.length >= MAX_HOOK_TYPES) { toast(t("cr.ai.hookMax"), "info"); return; }
      else state.hookTypes = [...state.hookTypes, k];
    }
    redrawHookTypes();
  });
  overlay.querySelector("#ai-structure")?.addEventListener("change", (e) => {
    state.structure = e.target.value;
    const help = overlay.querySelector("#ai-structure-help");
    if (help) help.textContent = t(`script.struct.${state.structure}.desc`);
  });

  const customDurationInput = overlay.querySelector("#ai-duration-custom");
  overlay.querySelectorAll("#ai-duration-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.duration = btn.dataset.val;
      overlay.querySelectorAll("#ai-duration-chips button").forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-pressed", String(b === btn)); });
      customDurationInput.style.display = state.duration === "Custom" ? "" : "none";
      if (state.duration === "Custom") customDurationInput.focus();
    });
  });

  // Each click adds a new batch below the last instead of replacing it —
  // not satisfied with what came back? Generate More just gives you
  // another set to compare against, every batch's own "Use" buttons still
  // work.
  // Shared by the main Generate button and the per-section "Regenerate"
  // buttons below, so a regenerate call sees the same prompt/funnel/duration
  // context instead of drifting from what actually produced this batch.
  function genParams(extra) {
    const prompt = overlay.querySelector("#ai-prompt").value.trim();
    return {
      title: content.title,
      idea: content.idea,
      platform: content.platform,
      format: content.format,
      funnel: state.funnel,
      prompt,
      duration: state.duration === "Custom" ? customDurationInput?.value.trim() : state.duration,
      hookTypes: state.hookTypes,
      structure: state.structure,
      audienceLanguage: brand?.audienceLanguage || "",
      // Full brand context (DNA + personality + tone of voice + visual
      // guidelines + active campaigns) instead of just the legacy
      // aiVoiceGuide string — see ai.js buildFullContext.
      brandContext: brand ? buildFullContext(brand, { campaigns: listCampaigns(brand.id), pulseText: pulseTextFor(brand, { content: listContent(brand.id), campaigns: listCampaigns(brand.id), settings: getSettings() }) }) : "",
      // Series Context: only present when this piece is linked to a
      // recurring series (content.seriesId) — sits between brandContext and
      // the topic-specific fields below, same seam campaignLine already uses.
      seriesContext: linkedSeriesContext(),
      campaignLine: linkedCampaignLine(),
      hashtags: writingRulesOf(brand && getBrand(brand.id)).hashtags,
      ...extra,
    };
  }

  function linkedCampaignLine() {
    if (!brand || !content.campaignId) return "";
    const c = listCampaigns(brand.id).find((x) => x.id === content.campaignId);
    return c ? campaignSummaryLine(c, brand) : "";
  }
  function linkedSeriesContext() {
    if (!content.seriesId) return "";
    const s = getSeries(content.seriesId);
    return s ? buildSeriesContext(s, { episodes: seriesEpisodeTitles(s, listContent(content.brandId)).filter((x) => x !== content.title) }) : "";
  }
  // The eval record keeps what the user asked for, not the (large,
  // reconstructible) brand context block.
  const feedbackPrompt = (p) => ({ ...p, brandContext: undefined, seriesContext: undefined });

  // "Simpan semua sebagai draf terpisah": one hook, one separate content
  // draft each — for when two or three of the hooks are worth trying
  // instead of committing to just one on this piece. Shared by fresh
  // batches and restored (persisted) ones below.
  function saveAllAsDrafts(hooksList, scriptText, captionText) {
    if (!hooksList?.length) return;
    hooksList.forEach((hook) => {
      createContent(content.brandId, {
        title: (hookText(hook).split("\n")[0] || "").trim().slice(0, 80) || content.title || t("next.untitled"),
        idea: content.idea || "",
        script: applyHook(scriptText || "", hook, ""),
        ...(hook?.type ? { hookType: hook.type } : {}),
        caption: captionText || "",
        funnel: state.funnel,
        platform: content.platform || "",
        campaignId: content.campaignId || "",
        campaignPhaseId: content.campaignPhaseId || "",
        seriesId: content.seriesId || "",
        status: "draft",
      });
    });
    toast(t("cr.ai.savedAllDrafts", { n: hooksList.length }));
  }

  // Persisted batches (content.aiDrafts, js/store.js updateContent — set by
  // runGenerate below) restored into the collapsed history so closing this
  // modal never throws a usable batch away. Every "Pakai" here works exactly
  // like a fresh batch's; only Regenerate/rating are skipped since those
  // need a live call tied to the params that produced the text.
  function restoredBatchHTML(draft, label) {
    const hooksList = draft.hooks || [];
    const slides = draft.slides || [];
    const isCarousel = slides.length > 0;
    const hooksHTML = hooksList.length
      ? `<div class="page-eyebrow" style="margin-bottom:8px;">${t("cr.ai.hookOptions")}${label}</div>
         ${hooksList.map((h, i) => hookCardHTML(h, i, { restore: true, carousel: isCarousel })).join("")}`
      : "";
    const scriptBody = isCarousel
      ? slides.map((s, i) => `
           <div class="card card-tight" style="margin-bottom:8px;">
             <div class="page-eyebrow" style="margin-bottom:4px;font-size:11px;">${escapeHtml(t("cr.ai.slideLabel", { n: s.slideNumber || i + 1 }))}</div>
             <div style="white-space:pre-wrap;font-size:13px;">${escapeHtml(s.text || "")}</div>
           </div>`).join("")
      : draft.script ? scriptPreviewHTML(draft.script) : "";
    const scriptHTML = draft.script || isCarousel
      ? `<div class="page-eyebrow" style="margin:14px 0 8px;">${isCarousel ? t("cr.ai.fullCarousel") : t("cr.ai.fullScript")}${label}</div>
         ${scriptBody}
         <button type="button" class="btn btn-primary" data-restore-script>${isCarousel ? t("cr.ai.useCarousel") : t("cr.ai.useScript")}</button>`
      : "";
    const captionHTML = draft.caption
      ? `<div class="page-eyebrow" style="margin:14px 0 8px;">${t("cr.ai.caption")}${label}</div>
         <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(draft.caption)}</div>
         <button type="button" class="btn btn-secondary btn-block" data-restore-caption>${t("cr.ai.useCaption")}</button>`
      : "";
    return `
      <div class="ai-batch">
        ${hooksHTML}
        ${scriptHTML}
        ${hooksList.length ? `<button type="button" class="btn btn-ghost btn-block save-all-drafts-btn" style="margin-top:6px;">${t("cr.ai.saveAllDrafts")}</button>` : ""}
        ${captionHTML}
      </div>
    `;
  }
  function mountRestoredBatch(draft, label) {
    const wrap = document.createElement("div");
    wrap.innerHTML = restoredBatchHTML(draft, label);
    const el = wrap.firstElementChild;
    if (!el) return null;
    qsa("[data-restore-hook]", el).forEach((b) => {
      b.addEventListener("click", () => {
        const hook = draft.hooks[Number(b.dataset.restoreHook)];
        if (hook === undefined) return;
        onInsert({ hook, prevHook: pickedHook });
        pickedHook = hook;
        toast(t("cr.ai.hookInserted"));
      });
    });
    qs("[data-restore-script]", el)?.addEventListener("click", () => {
      onInsert({ script: pickedHook ? applyHook(draft.script, pickedHook) : draft.script, hook: pickedHook || (draft.hooks || [])[0] || "", funnel: state.funnel });
      toast((draft.slides || []).length ? t("cr.ai.carouselInserted") : t("cr.ai.scriptInserted"));
      used.script = true;
      maybeAutoClose();
    });
    qs("[data-restore-caption]", el)?.addEventListener("click", () => {
      onInsert({ caption: draft.caption });
      toast(t("cr.ai.captionInserted"));
      used.caption = true;
      maybeAutoClose();
    });
    qs(".save-all-drafts-btn", el)?.addEventListener("click", () => saveAllAsDrafts(draft.hooks, draft.script, draft.caption));
    return el;
  }
  const persistedDrafts = getContent(content.id)?.aiDrafts || [];
  if (persistedDrafts.length) {
    const historyDetails = overlay.querySelector("#ai-history");
    const historyList = overlay.querySelector("#ai-history-list");
    persistedDrafts.forEach((draft, idx) => {
      const label = ` ${t("cr.ai.savedBatch", { n: persistedDrafts.length - idx })}`;
      const el = mountRestoredBatch(draft, label);
      if (el) historyList.appendChild(el);
    });
    historyDetails.hidden = false;
    overlay.querySelector("#ai-history-count").textContent = String(historyList.children.length);
  }

  let batchCount = 0;
  const runGenerate = async () => {
    const btn = overlay.querySelector("#ai-generate");
    const resultEl = overlay.querySelector("#ai-result");
    btn.disabled = true;
    const loadingEl = document.createElement("div");
    loadingEl.className = "ocr-status";
    loadingEl.innerHTML = `<div class="spinner"></div><span>${t("cr.ai.writing")}</span>`;
    resultEl.insertBefore(loadingEl, resultEl.firstChild);
    try {
      const params = genParams();
      if (demo) toast(DEMO_TOAST);
      const out = demo ? await demoGenerateScript(params) : await generateScript(ai, params);
      const { hooks, script, slides = [] } = out;
      // Fixed hashtags (Aturan tulisan) are put on by code, never guessed.
      const caption = applyFixedHashtags(out.caption, params.hashtags);
      loadingEl.remove();
      batchCount++;
      const suffix = batchCount > 1 ? ` ${t("cr.ai.batch", { n: batchCount })}` : "";
      // Persisted onto the content doc (content.aiDrafts, capped at 5,
      // newest first) — a demo/tour batch never is, same as it's never
      // rated. This is what makes the batch survive closing the modal:
      // reopening it restores this exact batch into the history above.
      if (!demo) {
        const existing = getContent(content.id)?.aiDrafts || [];
        const nextDrafts = [{ at: Date.now(), hooks, script, caption, slides }, ...existing].slice(0, 5);
        updateContent(content.id, { aiDrafts: nextDrafts });
      }
      const batchEl = document.createElement("div");
      batchEl.className = "ai-batch";
      // "Dibuat berdasarkan: …" — what the AI leaned on, so the owner sees it
      // remembered (js/brand-learning.js).
      batchEl.innerHTML = `
        ${demo || !brand ? "" : basisHTML(brand, { content: listContent(brand.id), settings: getSettings() })}
        <div id="hooks-section"></div>
        <div id="script-section"></div>
        ${hooks.length ? `<button type="button" class="btn btn-ghost btn-block save-all-drafts-btn" style="margin:6px 0 10px;">${t("cr.ai.saveAllDrafts")}</button>` : ""}
        ${
          caption
            ? `<div class="page-eyebrow" style="margin:14px 0 8px;">${t("cr.ai.caption")}${suffix}</div>
               <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(caption)}</div>
               <button type="button" class="btn btn-secondary btn-block use-caption-btn">${t("cr.ai.useCaption")}</button>
               <div class="caption-feedback"></div>`
            : ""
        }
      `;
      // Newest batch always sits expanded up top; whatever was there before
      // (still fully usable — its own Use/Regenerate buttons keep working
      // after being moved) drops into the collapsed "previous" history
      // instead of just piling up endlessly below. The batch itself is
      // persisted (above), but this DOM move is what keeps its listeners
      // working for the rest of this modal session.
      const currentWrap = overlay.querySelector("#ai-current-batch");
      const prevBatch = currentWrap.firstElementChild;
      if (prevBatch) {
        const historyDetails = overlay.querySelector("#ai-history");
        const historyList = overlay.querySelector("#ai-history-list");
        historyList.insertBefore(prevBatch, historyList.firstChild);
        historyDetails.hidden = false;
        overlay.querySelector("#ai-history-count").textContent = String(historyList.children.length);
      }
      currentWrap.appendChild(batchEl);
      batchEl.querySelector(".save-all-drafts-btn")?.addEventListener("click", () => saveAllAsDrafts(hooks, script, caption));
      if (caption && !demo) mountAiFeedback(batchEl.querySelector(".caption-feedback"), { brandId: brand?.id, feature: "creator-caption", prompt: feedbackPrompt(params), output: caption });

      // Hooks and script each get their own "Regenerate" — asking the AI to
      // redo a hook that isn't landing shouldn't also throw away a script
      // that's already fine, and vice versa.
      // What the script card was last drawn from, so picking a hook can redraw
      // it with that hook swapped in (what "Use script" will then insert).
      let scriptState = null;
      const eyebrowRegenBtn = (label) =>
        `<button type="button" class="icon-btn regen-btn" title="${label}" aria-label="${label}" style="width:22px;height:22px;">${icon("refresh", { size: 12 })}</button>`;

      // The hook the script on screen opens with: the one picked, else the
      // first (generateScript writes the script around hooks[0]).
      let hookList = hooks;
      const openerHook = () => pickedHook || hookList[0] || "";
      function renderHooksSection(list, usedParams) {
        hookList = list;
        const el = batchEl.querySelector("#hooks-section");
        const inScript = hookText(openerHook());
        el.innerHTML = list.length
          ? `<div class="creator-field-head" style="margin-bottom:8px;">
               <div class="page-eyebrow" style="margin-bottom:0;">${t("cr.ai.hookOptions")}${suffix}</div>
               ${eyebrowRegenBtn(t("cr.ai.regenHooks"))}
             </div>
             ${list.map((h, i) => hookCardHTML(h, i, { inScript: hookText(h) === inScript, used: !!pickedHook && hookText(h) === hookText(pickedHook), carousel: isCarouselPiece })).join("")}`
          : "";
        if (list.length && !demo) mountAiFeedback(el, { brandId: brand?.id, feature: "creator-hooks", prompt: feedbackPrompt(usedParams), output: list.map(hookText) });
        el.querySelectorAll("[data-insert-hook]").forEach((b) => {
          b.addEventListener("click", () => {
            const hook = list[Number(b.dataset.insertHook)];
            if (hookText(hook) === hookText(pickedHook)) return;
            // Every hook leads into the same body, so picking another just
            // swaps the HOOK beat — in the piece and in the preview below.
            onInsert({ hook, prevHook: pickedHook });
            pickedHook = hook;
            toast(t("cr.ai.hookInserted"));
            renderHooksSection(list, usedParams);
            if (scriptState?.text) renderScriptSection(scriptState.text, scriptState.params, scriptState.slides);
          });
        });
        el.querySelector(".regen-btn")?.addEventListener("click", async () => {
          const regenBtn = el.querySelector(".regen-btn");
          regenBtn.disabled = true;
          try {
            // New hooks of the types chosen now, written to lead into the
            // body already on screen, and not repeating the ones shown.
            const regenParams = genParams({ only: "hooks", body: scriptState?.text || "", avoidHooks: list.map(hookText) });
            const { hooks: newHooks } = demo ? await demoGenerateScript(regenParams) : await generateScript(ai, regenParams);
            renderHooksSection(newHooks, regenParams);
          } catch (e) {
            toast(e instanceof AiApiError ? e.message : t("cr.ai.regenHooksFail"), "error");
            regenBtn.disabled = false;
          }
        });
      }
      // #1: a Carousel shows its slides one by one (Slide 1, Slide 2, …)
      // instead of one flat script block — `slides` is only non-empty when
      // generateScript() was asked for a carousel format.
      function renderScriptSection(rawText, usedParams, rawSlides = []) {
        scriptState = { text: rawText, params: usedParams, slides: rawSlides };
        const text = pickedHook ? applyHook(rawText, pickedHook, "", { lang: getLang() }) : rawText;
        const slides = pickedHook && rawSlides.length ? parseSlides(text).map((s, i) => ({ ...s, slideNumber: i + 1 })) : rawSlides;
        const el = batchEl.querySelector("#script-section");
        const isCarousel = slides.length > 0;
        const label = isCarousel ? t("cr.ai.fullCarousel") : t("cr.ai.fullScript");
        const regenLabel = isCarousel ? t("cr.ai.regenCarousel") : t("cr.ai.regenScript");
        const useLabel = isCarousel ? t("cr.ai.useCarousel") : t("cr.ai.useScript");
        const body = isCarousel
          ? slides
              .map(
                (s) => `
             <div class="card card-tight" style="margin-bottom:8px;">
               <div class="page-eyebrow" style="margin-bottom:4px;font-size:11px;">${escapeHtml(t("cr.ai.slideLabel", { n: s.slideNumber }))}</div>
               <div style="white-space:pre-wrap;font-size:13px;">${escapeHtml(s.text)}</div>
             </div>`
              )
              .join("")
          : scriptPreviewHTML(text, out.targetSec);
        el.innerHTML = text
          ? `<div class="creator-field-head" style="margin:14px 0 8px;">
               <div class="page-eyebrow" style="margin-bottom:0;">${label}${suffix}</div>
               ${eyebrowRegenBtn(regenLabel)}
             </div>
             ${body}
             <div class="cr-ai-row">
               <button type="button" class="btn btn-primary use-script-btn">${useLabel}</button>
               ${demo ? "" : `<button type="button" class="btn btn-secondary discuss-script-btn" title="${escapeHtml(t("cr.disc.title"))}">${icon("chat", { size: 15 })}${t("cr.disc.short")}</button>`}
             </div>`
          : "";
        // Same discussion drawer as the editor's, but about the draft shown
        // here (hook swap included); "Apply" puts the revision straight into
        // the piece, like "Use script" would.
        let draft = text;
        el.querySelector(".discuss-script-btn")?.addEventListener("click", () =>
          openScriptChat({
            contentId: content.id,
            title: content.title || "",
            getCurrent: () => ({ ...content, script: draft }),
            onRegenerate: (kind, guidance) => {
              overlay.querySelector("#ai-prompt").value = regenPrompt(content.idea, kind, guidance);
              runGenerate();
            },
            applyRevision: (target, value) => {
              if (target === "script") draft = value;
              onInsert(target === "caption" ? { caption: value } : { script: value, funnel: state.funnel });
            },
          })
        );
        if (text && !demo) mountAiFeedback(el, { brandId: brand?.id, feature: isCarousel ? "creator-carousel" : "creator-script", prompt: feedbackPrompt(usedParams), output: text });
        el.querySelector(".use-script-btn")?.addEventListener("click", (e) => {
          onInsert({ script: text, hook: openerHook(), funnel: state.funnel });
          toast(isCarousel ? t("cr.ai.carouselInserted") : t("cr.ai.scriptInserted"));
          const b = e.currentTarget;
          b.classList.add("is-used");
          b.disabled = true;
          b.innerHTML = `${icon("check", { size: 14 })}${t("cr.ai.used")}`;
          used.script = true;
          maybeAutoClose();
        });
        el.querySelector(".regen-btn")?.addEventListener("click", async () => {
          const regenBtn = el.querySelector(".regen-btn");
          regenBtn.disabled = true;
          try {
            // A new body that pays off the hook on screen.
            const regenParams = genParams({ only: "script", hook: openerHook() });
            const { script: newScript, slides: newSlides } = demo ? await demoGenerateScript(regenParams) : await generateScript(ai, regenParams);
            renderScriptSection(newScript, regenParams, newSlides || []);
          } catch (e) {
            toast(e instanceof AiApiError ? e.message : isCarousel ? t("cr.ai.regenCarouselFail") : t("cr.ai.regenScriptFail"), "error");
            regenBtn.disabled = false;
          }
        });
      }
      renderHooksSection(hooks, params);
      renderScriptSection(script, params, slides);

      batchEl.querySelector(".use-caption-btn")?.addEventListener("click", (e) => {
        onInsert({ caption });
        toast(t("cr.ai.captionInserted"));
        const b = e.currentTarget;
        b.classList.add("is-used");
        b.disabled = true;
        b.innerHTML = `${icon("check", { size: 14 })}${t("cr.ai.used")}`;
        used.caption = true;
        maybeAutoClose();
      });
      btn.innerHTML = `${icon("bot", { size: 14 })}${t("cr.ai.generateAgain")}`;
    } catch (e) {
      loadingEl.outerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${escapeHtml(e.message)}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  };
  overlay.querySelector("#ai-generate").addEventListener("click", runGenerate);
  // Coming from the discussion ("Generate ulang…"): the prompt already holds
  // the guidance from the chat, so start right away.
  if (opts.autoRun) runGenerate();
}

// Creator is the "what still needs to be made" workspace — once something
// is published, its script/caption/etc. move here only if you deep-link to
// it directly (e.g. from the "Edit in Creator" button on a published item);
// otherwise this list only shows what's still in progress, sorted so the
// most time-sensitive piece is first.
export function render(root, { brandId, initialContentId }) {
  // Pemula's workspace adds: `viewStep` (an earlier step opened to look
  // back at), `phoneOpen` (phone: the piece instead of the list),
  // `folders` (folders opened/closed by hand), `arrive` (play the
  // "just opened" motion once) and `dockOff` (the chat column closed by ✕).
  const state = { selectedId: initialContentId || null, collapsedGroups: new Set(), expandedGroups: new Set(), revealEditor: !!initialContentId, viewStep: null, phoneOpen: !!initialContentId, folders: new Map(), arrive: !!initialContentId, dockOff: false, lastStep: null };
  // Konten Baru → the same content drawer every other screen uses; the
  // new piece is then selected here, opening straight on its drafting panel.
  state.startNewContent = (defaults = {}) =>
    openContentEditor({
      brandId,
      stay: true,
      defaults: { status: "idea", ...defaults },
      onSaved: (made) => {
        const newest = made || [...listContent(brandId)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (newest) {
          state.selectedId = newest.id;
          state.revealEditor = true;
          state.viewStep = null;
          state.phoneOpen = true;
          state.arrive = true;
          state.folders.clear();
        }
        refresh();
      },
    });
  const paintNow = () => paint(root, brandId, state, refresh);
  // Arriving from a campaign ("Buka di Creator", "Konten baru"): select
  // that piece, or open the new-content picker with the campaign already
  // attached — never an empty Creator.
  const applyNavContext = (ctx) => {
    if (!ctx) return;
    if (ctx.contentId) {
      state.selectedId = ctx.contentId;
      state.revealEditor = true;
      state.viewStep = null;
      state.phoneOpen = true;
      state.arrive = true;
    }
    if (ctx.intent === "new-content") setTimeout(() => state.startNewContent(ctx.defaults || {}), 0);
    // Coming from a Brainstorm idea ("Buatkan script"): open the AI writer.
    if (ctx.intent === "script" && ctx.contentId) {
      let tries = 0;
      const open = () => { const b = root.querySelector("#ai-generate-all"); if (b) b.click(); else if (++tries < 12) setTimeout(open, 150); };
      setTimeout(open, 200);
    }
  };
  applyNavContext(consumeNavContext());
  const onNavContext = () => {
    applyNavContext(consumeNavContext());
    refresh();
  };
  document.addEventListener("nav:context", onNavContext);

  // Every Firestore write (including this page's own autosave-on-blur)
  // fires onChange, which used to tear out and rebuild the whole sidebar
  // list on the spot. On a touch device that's a scroll killer: if a
  // repaint lands while a finger is still down and mid-swipe, the DOM node
  // the gesture is tracking gets replaced out from under it and the scroll
  // just stops dead — reported as the Drafting/Editing list "stuck, won't
  // scroll". Defer any repaint that arrives mid-touch and flush it once
  // the finger lifts, so a live scroll gesture is never interrupted.
  let touchActive = false;
  let repaintPending = false;
  const refresh = () => {
    if (touchActive) {
      repaintPending = true;
      return;
    }
    paintNow();
  };
  const onTouchStart = () => {
    touchActive = true;
  };
  const onTouchEnd = () => {
    touchActive = false;
    if (repaintPending) {
      repaintPending = false;
      paintNow();
    }
  };
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });

  // Pemula: the docked chat column follows its slot on the page, and ✕ on
  // it keeps it closed until "Buka chat".
  const onUndocked = () => { state.dockOff = true; paintNow(); };
  // Crossing the width where the chat fits beside the piece redraws it.
  let viewportQueued = false;
  const onViewport = () => {
    if (viewportQueued) return;
    viewportQueued = true;
    requestAnimationFrame(() => {
      viewportQueued = false;
      if (getMode() === "guided" && state.wasWide !== undefined && isWideDock() !== state.wasWide) paintNow();
      else placeDock(root);
    });
  };
  window.addEventListener("chat:undocked", onUndocked);
  window.addEventListener("resize", onViewport);
  window.addEventListener("scroll", onViewport, { passive: true });

  refresh();
  const unsubscribe = onChange(refresh);
  // Once per mount — paint() runs again on every db:change.
  startCreatorGuideOnMount(brandId);
  return () => {
    window.removeEventListener("chat:undocked", onUndocked);
    window.removeEventListener("resize", onViewport);
    window.removeEventListener("scroll", onViewport);
    undockChat();
    unsubscribe();
    document.removeEventListener("nav:context", onNavContext);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchEnd);
  };
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const all = listContent(brandId);
  const campaigns = listCampaigns(brandId);
  const series = listSeries(brandId);
  const items = all
    .filter((c) => c.status !== "published" || c.id === state.selectedId)
    .sort((a, b) => {
      const da = a.scheduleDate || "9999-99-99";
      const db = b.scheduleDate || "9999-99-99";
      if (da !== db) return da.localeCompare(db);
      return b.updatedAt - a.updatedAt;
    });

  if (!state.selectedId || !items.find((c) => c.id === state.selectedId)) {
    state.selectedId = items[0]?.id || null;
  }
  const selected = state.selectedId ? getContent(state.selectedId) : null;
  const groupBy = sidebarGroupBy(series);
  // Pemula: the list as folders + the piece as steps (simpleLayoutHTML).
  const guided = getMode() === "guided";
  if (guided && selected) {
    const cur = currentStep(selected);
    if (state.viewStep && STEP_KEYS.indexOf(state.viewStep) >= STEP_KEYS.indexOf(cur)) state.viewStep = null;
    state.stepChanged = state.stepChanged || (state.lastStep !== null && state.lastStep !== `${selected.id}:${cur}`);
    state.lastStep = `${selected.id}:${cur}`;
  }

  // Pemula: a store change that changes nothing on this page (the chat
  // beside it saving a message, a sync) leaves the page as it is — the
  // motion that's playing, the scroll, what's being typed.
  if (guided) {
    const html = simpleLayoutHTML({ brand, brandId, all, items, campaigns, series, selected, groupBy, state });
    const stable = html.replace(/ is-arriving| is-stepping| is-entering/g, "");
    if (stable === state.lastHTML && root.querySelector(".cw-layout")) {
      state.arrive = false;
      state.stepChanged = false;
      syncDock(root, state, selected);
      return;
    }
    state.lastHTML = stable;
    root.innerHTML = html;
  } else root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("cr.eyebrowGuided")}${helpButtonHTML("creator")}${guideVideoButtonHTML("creator")}</div>
        <h1>${t("contentOs.tab.creator")}</h1>
        <p class="page-head-brand">${escapeHtml(brand.name)}</p>
        ${getMode() === "guided" ? `<p class="page-what">${t("cr.whatGuided")}</p>` : ""}
      </div>
      <div class="flex gap-8" style="flex-wrap:wrap;">
        <button class="btn btn-secondary" id="cr-week-plan">${icon("sparkle", { size: 15 })}${t("chat.week.button")}<span class="btn-cost">${t("chat.week.cost")}</span></button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("cr.newContent")}</button>
      </div>
    </div>

    <div class="creator-layout">
      <div class="creator-sidebar">
        ${items.length ? groupByToggleHTML(groupBy, series.length > 0) : ""}
        <div class="creator-sidebar-list">
          ${
            items.length
              ? groupedSidebarHTML(items, state.selectedId, state.collapsedGroups, state.expandedGroups, { by: groupBy, series })
              : `<div class="table-empty" style="padding:32px 16px;">${t(all.length ? "cr.sidebarEmpty" : "cr.sidebarEmptyFirst")}</div>`
          }
        </div>
      </div>
      <div class="creator-main">
        ${selected ? `<button type="button" class="creator-back-list" data-back-to-list>${icon("arrowUp", { size: 14 })}${t("cr.backToList", { n: items.length })}</button>` : ""}
        ${selected ? mainPanel(selected, campaigns, series) : emptyPanel()}
        <a class="link" href="#/brand/${brandId}/content/calendar" style="display:block;text-align:center;font-size:12.5px;margin-top:4px;">${icon("calendar", { size: 13 })} ${t("cr.openCalendar")}</a>
      </div>
    </div>
  `;

  wireHelpButtons(root);
  setPageGuide(() => startCreatorGuide(brandId));

  qs("#new-content")?.addEventListener("click", () => state.startNewContent());
  qs("#cr-week-plan")?.addEventListener("click", (e) => openWeekPlanMenu(e.currentTarget, brandId));
  const emptyNewBtn = qs("#new-content-empty");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => state.startNewContent());

  qsa("[data-select]", root).forEach((row) => {
    row.addEventListener("click", () => {
      if (guided) {
        // A piece opens big, on the step it is at; on a phone it takes the
        // screen (the list comes back with "Semua konten").
        const same = state.selectedId === row.dataset.select;
        state.selectedId = row.dataset.select;
        state.phoneOpen = true;
        if (!same) { state.viewStep = null; state.arrive = true; state.folders.clear(); }
        paint(root, brandId, state, refresh);
        if (isPhone()) window.scrollTo({ top: 0 });
        return;
      }
      state.selectedId = row.dataset.select;
      paint(root, brandId, state, refresh);
      revealOnPhone(qs(".creator-main", root));
    });
  });
  wireClickableCards(root, "[data-select]");
  qs("[data-back-to-list]", root)?.addEventListener("click", () => {
    if (guided) {
      state.phoneOpen = false;
      paint(root, brandId, state, refresh);
      window.scrollTo({ top: 0 });
      return;
    }
    const list = qs(".creator-sidebar-list", root);
    const active = qs(".creator-item.active", root);
    // The list scrolls on its own; bring the open piece into its view too.
    if (list && active) list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
    revealOnPhone(qs(".creator-sidebar", root));
    active?.focus({ preventScroll: true });
  });
  if (state.revealEditor && selected) {
    state.revealEditor = false;
    if (guided) { if (isPhone()) window.scrollTo({ top: 0 }); }
    else requestAnimationFrame(() => revealOnPhone(qs(".creator-main", root), { instant: true }));
  }

  qsa("[data-delete-content]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteContent;
      const item = getContent(id);
      const ok = await confirmDialog({
        title: t("cr.delete.title", { title: escapeHtml(item?.title || t("common.untitled")) }),
        message: t("delete.toTrash.contentMessage", { days: TRASH_DAYS }),
        confirmLabel: t("delete.toTrash.confirm"),
        danger: true,
      });
      if (!ok) return;
      deleteContent(id);
      if (state.selectedId === id) state.selectedId = null;
      toast(t("delete.toTrash.contentDone"));
      refresh();
    });
  });

  qsa("[data-expand-group]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.expandGroup;
      if (state.expandedGroups.has(key)) state.expandedGroups.delete(key);
      else state.expandedGroups.add(key);
      paint(root, brandId, state, refresh);
    });
  });

  // Minggu / Tahap / Seri — remembered on the account like Biasa / Pro.
  qsa("[data-group-by]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.groupBy === groupBy) return;
      updateSettings({ creatorGroupBy: btn.dataset.groupBy });
    });
  });

  qsa("[data-toggle-group]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggleGroup;
      if (state.collapsedGroups.has(key)) state.collapsedGroups.delete(key);
      else state.collapsedGroups.add(key);
      paint(root, brandId, state, refresh);
    });
  });

  if (guided) wireSimple(root, brandId, state, refresh, selected);
  if (!selected) return;

  const pdfBtn = qs("#download-script-pdf", root);
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      const current = {
        ...selected,
        title: qs("#f-title", root)?.value ?? selected.title,
        idea: qs("#f-idea", root)?.value ?? selected.idea,
        script: qs("#f-script", root)?.value ?? selected.script,
      };
      openScriptPdfPreview(current, brand);
    });
  }

  // The script isn't here: its box (Biasa or Pro) saves through #f-script below.
  const fieldMap = { title: "f-title", idea: "f-idea", caption: "f-caption", cta: "f-cta", reference: "f-reference", notes: "f-notes" };
  const indicator = qs("#save-indicator", root);
  let flashTimer = null;
  const flashSaved = () => {
    if (!indicator) return;
    indicator.textContent = t("cr.saved");
    indicator.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => indicator.classList.remove("show"), 1400);
  };

  Object.entries(fieldMap).forEach(([key, id]) => {
    const el = qs(`#${id}`, root);
    if (!el) return;
    el.addEventListener("blur", () => {
      if (el.value === (selected[key] || "")) return;
      updateContent(selected.id, { [key]: el.value });
      flashSaved();
    });
  });

  // Carousel: the slide cards replace #f-script. Every edit is written back
  // as the same flat "Slide N" string, so nothing downstream changes.
  const slideEditor = qs("#slide-editor", root);
  if (slideEditor) {
    const readSlides = () => qsa("[data-slide-text]", root).map((el) => ({ text: el.value }));
    const commit = (slides, { repaint = false } = {}) => {
      const script = serializeSlides(slides);
      if (script !== (selected.script || "")) {
        updateContent(selected.id, { script });
        flashSaved();
      }
      if (repaint) refresh();
    };
    const autosize = (el) => { el.style.height = "auto"; el.style.height = `${Math.max(56, el.scrollHeight)}px`; };
    qsa("[data-slide-text]", root).forEach((el) => {
      autosize(el);
      el.addEventListener("input", () => autosize(el));
      el.addEventListener("blur", () => commit(readSlides()));
    });
    qsa("[data-slide-delete]", root).forEach((btn) =>
      btn.addEventListener("click", () => commit(readSlides().filter((_, i) => i !== Number(btn.dataset.slideDelete)), { repaint: true }))
    );
    qsa("[data-slide-up]", root).forEach((btn) =>
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.slideUp);
        const slides = readSlides();
        if (i <= 0) return;
        [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]];
        commit(slides, { repaint: true });
      })
    );
    qs("#slide-add", root)?.addEventListener("click", () => {
      const slides = [...readSlides(), { text: "" }];
      updateContent(selected.id, { script: serializeSlides(slides) });
      flashSaved();
      refresh();
      const all = qsa("[data-slide-text]", root);
      all[all.length - 1]?.focus();
    });
  }

  qs("#f-status", root)?.addEventListener("change", (e) => {
    const status = e.target.value;
    const patch = { status };
    if (status === "published" && !selected.publishedDate) patch.publishedDate = localISODate();
    updateContent(selected.id, patch);
    flashSaved();
    refresh();
  });
  ["platform", "format"].forEach((key) => qs(`#f-${key}`, root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { [key]: e.target.value });
    flashSaved();
    refresh();
  }));
  qs("#f-published", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { publishedDate: e.target.value });
    flashSaved();
  });
  qs("#f-url", root)?.addEventListener("blur", (e) => {
    const v = e.target.value.trim();
    if (v === (selected.publishedUrl || "")) return;
    updateContent(selected.id, { publishedUrl: v });
    flashSaved();
  });
  qs("#cr-fill-performance", root)?.addEventListener("click", () => {
    go(`#/brand/${brandId}/content/list`, { fromLabel: selected.title || t("common.untitled"), contentId: selected.id, intent: "performance" });
  });
  qs("#f-campaign", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { campaignId: e.target.value, campaignPhaseId: "" });
    flashSaved();
    refresh();
  });
  qs("#f-phase", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { campaignPhaseId: e.target.value });
    flashSaved();
  });
  qs("#f-series", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { seriesId: e.target.value });
    flashSaved();
  });
  const pickFunnel = (funnel) => {
    updateContent(selected.id, { funnel });
    flashSaved();
    refresh();
  };
  wireFunnelField(root, "f-funnel-picker", pickFunnel);
  // 6.2: reveal-in-place, not a refresh — a repaint right now would just
  // redraw the same one-line summary this link is trying to get past.
  qs("#funnel-goal-edit", root)?.addEventListener("click", (e) => {
    e.preventDefault();
    const wrap = qs("#funnel-goal-wrap", root);
    if (!wrap) return;
    wrap.innerHTML = funnelFieldHTML({ id: "f-funnel-picker", value: selected.funnel, fieldStyle: "margin-bottom:0;" });
    wireFunnelField(root, "f-funnel-picker", pickFunnel);
  });

  // Both ways of writing the script (scriptFieldHTML) write into the hidden
  // #f-script, and it's saved once focus leaves them, like every other
  // field here. Switching between Biasa and Pro saves first, then redraws
  // with the other one.
  const scriptField = qs("#f-script", root);
  const saveScriptField = () => {
    if (!scriptField || scriptField.value === (getContent(selected.id)?.script || "")) return;
    updateContent(selected.id, { script: scriptField.value });
    flashSaved();
  };
  // "Biasa": the box holds only the words; what's typed goes back into the
  // script it was filled from, so its parts keep their Visual / Teks layar.
  // The length under the box follows the text as it is typed.
  const plainBox = qs("#f-script-plain", root);
  if (plainBox && scriptField) {
    const filledFrom = scriptField.value;
    plainBox.addEventListener("input", () => {
      scriptField.value = applyPlainScript(filledFrom, plainBox.value, { lang: getLang() });
      const note = qs("#script-len-note", root);
      if (!note) return;
      note.hidden = !scriptField.value.trim();
      note.querySelector("span").textContent = t("cr.ai.lengthBadge", scriptLengthVars(scriptField.value));
    });
    plainBox.addEventListener("blur", saveScriptField);
  }
  // "Pro": one card per part.
  const cardsHost = qs("#script-cards", root);
  if (cardsHost && scriptField) {
    mountScriptCards(cardsHost, { value: scriptField.value, lang: getLang(), onInput: (text) => { scriptField.value = text; } });
    // Checked a tick later: a card redrawing itself (a line opened, a card
    // added) drops the focused box for a moment, which isn't leaving.
    cardsHost.addEventListener("focusout", () => setTimeout(() => {
      if (cardsHost.isConnected && !cardsHost.contains(document.activeElement)) saveScriptField();
    }, 0));
  }
  qsa("[data-script-mode]", root).forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      if (btn.dataset.scriptMode === scriptEditorMode()) return;
      saveScriptField();
      updateSettings({ scriptEditor: btn.dataset.scriptMode });
    });
  });
  // "Template hook": the picker builds the line and it goes where the hook
  // goes — the first part of the script (applyHook; the old hook's screen
  // text goes with it, its Visual stays), or slide 1 of a carousel. Using
  // another template replaces the one used before, also in a script typed
  // as plain text.
  const templateAi = () => {
    if (!hasAiKey(getSettings().ai || {}) || isTourDemo()) return null;
    return () => ({
      title: qs("#f-title", root)?.value ?? selected.title ?? "",
      idea: qs("#f-idea", root)?.value ?? selected.idea ?? "",
      funnel: getContent(selected.id)?.funnel || selected.funnel || "",
      platform: selected.platform || "",
      brandContext: brand ? buildFullContext(brand, { campaigns: listCampaigns(brand.id), pulseText: pulseTextFor(brand, { content: listContent(brand.id), campaigns: listCampaigns(brand.id), settings: getSettings() }) }) : "",
    });
  };
  // The lines are in the language the brand's videos are in.
  const templateLang = () => (brand?.audienceLanguage ? (brand.audienceLanguage === "en" ? "en" : "id") : getLang());
  const withTemplateHook = (script, line) => {
    if (isCarouselContent(getContent(selected.id) || selected)) {
      const slides = parseSlides(script);
      if (slides.length) slides[0] = { ...slides[0], text: line };
      else slides.push({ text: line });
      return serializeSlides(slides);
    }
    return applyHook(script, { say: line, onScreen: "" }, lastTemplateHook.get(selected.id) || "", { lang: getLang() });
  };
  const openTemplatePicker = (apply) =>
    openHookTemplatePicker({ funnel: getContent(selected.id)?.funnel || selected.funnel || "TOFU", brandId: brand?.id || null, lang: templateLang(), aiContext: templateAi(), onUse: apply });
  const templateBtn = qs("#hook-template-open", root);
  templateBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  templateBtn?.addEventListener("click", () => {
    saveScriptField();
    openTemplatePicker((line) => {
      const contentId = selected.id;
      const scriptEl = qs("#f-script", root);
      const next = withTemplateHook(scriptEl ? scriptEl.value : getContent(contentId)?.script || "", line);
      lastTemplateHook.set(contentId, line);
      if (scriptEl) scriptEl.value = next;
      const patch = { script: next };
      // A brand-new piece has no title yet — the hook is a good working one.
      const titleEl = qs("#f-title", root);
      if (titleEl && !titleEl.value.trim()) patch.title = titleEl.value = line.slice(0, 80);
      updateContent(contentId, patch);
      flashSaved();
      toast(t(scriptEl ? "hooktpl.used" : "hooktpl.usedSlide"));
      if (!scriptEl) refresh();
    });
  });

  // "Layar penuh": the script on one big page (js/script-focus.js), with the
  // script chat docked beside it. mousedown keeps the box's focus, so its
  // blur-save (and the repaint it triggers) can't swallow the click.
  const focusBtn = qs("#script-focus-open", root);
  focusBtn?.addEventListener("mousedown", (e) => e.preventDefault());
  focusBtn?.addEventListener("click", () => {
    const contentId = selected.id;
    const save = (text) => {
      const el = qs("#f-script", root);
      if (el && el.value !== text) el.value = text;
      if ((getContent(contentId)?.script || "") === text) return;
      updateContent(contentId, { script: text });
      flashSaved();
    };
    const focus = openScriptFocus({
      title: qs("#f-title", root)?.value || selected.title || "",
      value: qs("#f-script", root)?.value ?? selected.script ?? "",
      lang: getLang(),
      mode: scriptEditorMode(),
      onChange: save,
      onClose: (text) => save(text),
      onTeleprompter: (text) => openTeleprompter(spokenText(text), { title: selected.title || t("common.untitled") }),
      onHookTemplate: () =>
        openTemplatePicker((line) => {
          focus.setValue(withTemplateHook(focus.value, line));
          lastTemplateHook.set(contentId, line);
          toast(t("hooktpl.used"));
        }),
      onDiscuss: () =>
        openScriptChat({
          contentId,
          title: selected.title || "",
          docked: true,
          getCurrent: () => ({ ...(getContent(contentId) || selected), script: focus.value }),
          applyRevision: (target, text) => {
            if (target === "script") {
              focus.setValue(text);
              save(text);
              return;
            }
            const el = qs("#f-caption", root);
            if (el) el.value = text;
            updateContent(contentId, { caption: text });
            flashSaved();
          },
        }),
    });
  });

  const tpBtn = qs("#open-teleprompter", root);
  if (tpBtn) {
    tpBtn.addEventListener("click", () => {
      const currentScript = qs("#f-script", root)?.value ?? selected.script;
      // A beat script holds directions too (Visual / Teks layar): only the
      // lines to say go on the prompter.
      openTeleprompter(spokenText(currentScript), { title: selected.title || t("common.untitled") });
    });
  }

  const openAiFor = (opts = {}) => {
    const current = {
      ...selected,
      idea: qs("#f-idea", root)?.value ?? selected.idea,
      title: qs("#f-title", root)?.value ?? selected.title,
    };
    openAiScriptModal(current, brand, ({ hook, prevHook, script, caption, funnel }) => {
      if (caption !== undefined) {
        const captionEl = qs("#f-caption", root);
        if (!captionEl) return;
        captionEl.value = caption;
        updateContent(selected.id, { caption: captionEl.value });
      } else {
        const scriptEl = qs("#f-script", root);
        const current = scriptEl ? scriptEl.value : selected.script || "";
        const next = applyHook(script || current, hook, prevHook, { lang: getLang() });
        if (scriptEl) scriptEl.value = next;
        // hookType: which kind of opening this piece uses (js/knowledge/
        // hook-types.js) — kept so performance can later be read per type.
        updateContent(selected.id, { script: next, ...(funnel ? { funnel } : {}), ...(hook?.type ? { hookType: hook.type } : {}) });
        // A brand-new piece has no title yet — the chosen hook is a good
        // working title, so the sidebar doesn't fill up with t("common.untitled").
        const titleEl = qs("#f-title", root);
        if (titleEl && !titleEl.value.trim() && hookText(hook)) {
          titleEl.value = hookText(hook).split("\n")[0].trim().slice(0, 80);
          updateContent(selected.id, { title: titleEl.value });
        }
        // Carousel view has slide cards instead of the textarea — repaint them.
        if (!scriptEl) refresh();
      }
      flashSaved();
    }, null, { ...opts, simple: guided });
  };

  const aiBtn = qs("#ai-generate-all", root);
  if (aiBtn) aiBtn.addEventListener("click", () => openAiFor());

  const discussBtn = qs("#ai-discuss", root);
  if (discussBtn) {
    discussBtn.addEventListener("click", () => {
      const contentId = selected.id;
      openScriptChat({
        contentId,
        title: selected.title || "",
        getCurrent: () => ({
          ...(getContent(contentId) || selected),
          title: qs("#f-title", root)?.value ?? selected.title,
          idea: qs("#f-idea", root)?.value ?? selected.idea,
          script: qs("#f-script", root)?.value ?? getContent(contentId)?.script ?? selected.script,
          caption: qs("#f-caption", root)?.value ?? getContent(contentId)?.caption ?? selected.caption,
        }),
        onRegenerate: (kind, guidance) => openAiFor({ prompt: regenPrompt(qs("#f-idea", root)?.value ?? selected.idea, kind, guidance), autoRun: true }),
        applyRevision: (target, text) => {
          const el = qs(target === "caption" ? "#f-caption" : "#f-script", root);
          if (el) el.value = text;
          updateContent(contentId, { [target]: text });
          // Carousel scripts have slide cards, not a textarea — repaint them.
          if (!el) refresh();
          flashSaved();
        },
      });
    });
  }

  // Quick per-field generate — a stripped-down version of the same modal
  // (just a prompt box, pre-filled from that field), still with the full
  // hooks/script/caption results to pick from, not an instant silent swap.
  function quickGenerate(field) {
    const current = {
      ...selected,
      idea: qs("#f-idea", root)?.value ?? selected.idea,
      title: qs("#f-title", root)?.value ?? selected.title,
      script: qs("#f-script", root)?.value ?? selected.script,
      caption: qs("#f-caption", root)?.value ?? selected.caption,
    };
    openAiScriptModal(
      current,
      brand,
      ({ hook, prevHook, script, caption, funnel }) => {
        if (caption !== undefined) {
          const captionEl = qs("#f-caption", root);
          if (!captionEl) return;
          captionEl.value = caption;
          updateContent(selected.id, { caption: captionEl.value });
        } else {
          const scriptEl = qs("#f-script", root);
          const current = scriptEl ? scriptEl.value : selected.script || "";
          const next = applyHook(script || current, hook, prevHook, { lang: getLang() });
          if (scriptEl) scriptEl.value = next;
          updateContent(selected.id, { script: next, ...(funnel ? { funnel } : {}), ...(hook?.type ? { hookType: hook.type } : {}) });
          if (!scriptEl) refresh();
        }
        flashSaved();
      },
      field,
      { simple: guided }
    );
  }
  const quickScriptBtn = qs("#ai-quick-script", root);
  if (quickScriptBtn) quickScriptBtn.addEventListener("click", () => quickGenerate("script"));
  const quickCaptionBtn = qs("#ai-quick-caption", root);
  if (quickCaptionBtn) quickCaptionBtn.addEventListener("click", () => quickGenerate("caption"));

  const markSubmitted = qs("#mark-submitted", root);
  if (markSubmitted) {
    markSubmitted.addEventListener("change", () => {
      updateContent(selected.id, { status: "production" });
      notify(t("cr.notify.toShooting"), t("cr.notify.toShootingBody", { title: selected.title || t("common.untitled") }));
    });
  }
  const markShotBig = qs("#mark-shot-big", root);
  if (markShotBig) {
    markShotBig.addEventListener("click", () => {
      updateContent(selected.id, { status: "editing" });
      notify(t("cr.notify.toEditing"), t("cr.notify.toEditingBody", { title: selected.title || t("common.untitled") }));
    });
  }
  const markEditedBig = qs("#mark-edited-big", root);
  if (markEditedBig) {
    markEditedBig.addEventListener("click", () => {
      updateContent(selected.id, { status: "scheduled" });
      notify(t("cr.notify.ready"), t("cr.notify.readyBody", { title: selected.title || t("common.untitled") }));
    });
  }
  // 6.3: the schedule date field moved here from the Content Editor drawer
  // — same field, same past-date guard (calendar.pastDate), just where the
  // "Siap upload" work actually happens. The Calendar already reads
  // scheduleDate off the content itself, so nothing else needs to change
  // for it to show up there.
  const scheduleInput = qs("#f-schedule", root);
  if (scheduleInput) {
    // Native date pickers don't reliably fire `blur` on every OS/browser —
    // `change` is the one guaranteed to fire when a date is actually
    // picked, `blur` still catches someone typing the date by hand. The
    // no-op-if-unchanged check above makes listening to both safe.
    const commitSchedule = (e) => {
      const value = e.target.value;
      if (value === (selected.scheduleDate || "")) return;
      if (value && value < localISODate()) {
        toast(t("calendar.pastDate"), "error");
        e.target.value = selected.scheduleDate || "";
        return;
      }
      updateContent(selected.id, { scheduleDate: value });
      flashSaved();
    };
    scheduleInput.addEventListener("blur", commitSchedule);
    scheduleInput.addEventListener("change", commitSchedule);
  }
  // Whichever platform(s) got checked, then Done — publishing doesn't need
  // to wait for every platform, just at least one.
  const markUploadedDone = qs("#mark-uploaded-done", root);
  if (markUploadedDone) {
    markUploadedDone.addEventListener("click", () => {
      const uploadedPlatforms = { ...(selected.uploadedPlatforms || {}) };
      qsa("[data-uploaded]", root).forEach((cb) => { uploadedPlatforms[cb.dataset.uploaded] = cb.checked; });
      if (!Object.values(uploadedPlatforms).some(Boolean)) {
        toast(t("cr.pickPlatform"), "error");
        return;
      }
      // A piece with no platform of its own takes the one it was ticked as
      // uploaded to — campaign targets count content by platform, and an
      // untagged post used to count toward no Social Media Growth at all.
      const firstTicked = selected.platform ? null : uploadPlatformOptions(selected).find((p) => uploadedPlatforms[p.id]);
      updateContent(selected.id, {
        uploadedPlatforms,
        ...(firstTicked ? { platform: firstTicked.name } : {}),
        status: "published",
        publishedDate: selected.publishedDate || localISODate(),
      });
      notify(t("cr.notify.published"), t("cr.notify.publishedBody", { title: selected.title || t("common.untitled") }));
    });
  }

  qs("#copy-caption-ready", root)?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(selected.caption || "");
      toast(t("cr.captionCopied"));
    } catch {
      toast(t("cr.copyFail"), "error");
    }
  });

  const stageBackBtn = qs("#stage-back", root);
  if (stageBackBtn) {
    stageBackBtn.addEventListener("click", async () => {
      const prev = PREV_STATUS[selected.status];
      if (!prev) return;
      const ok = await confirmDialog({
        title: t("cr.back.title"),
        message: t("cr.back.message", { title: escapeHtml(selected.title || t("common.untitled")), from: statusLabel(selected.status, STATUS_LABELS), to: statusLabel(prev, STATUS_LABELS) }),
        confirmLabel: t("cr.back.confirm"),
      });
      if (!ok) return;
      updateContent(selected.id, { status: prev });
      toast(t("cr.back.done", { stage: statusLabel(prev, STATUS_LABELS) }));
    });
  }
}

// A quick "what's due" signal — not a real notification system (there's no
// server to run one), just a visible cue while you're in here so the most
// urgent piece is easy to spot.
function dueBadge(c) {
  if (!c.scheduleDate) return "";
  const today = localISODate();
  if (c.scheduleDate < today) return `<span class="due-badge due-overdue">${t("cr.due.overdue")}</span>`;
  if (c.scheduleDate === today) return `<span class="due-badge due-today">${t("cr.due.today")}</span>`;
  return `<span class="due-badge due-soon">${t("cr.due.on", { date: formatDate(c.scheduleDate) })}</span>`;
}

// Below 860px the list sits above the editor, so picking a piece used to
// repaint something below the fold and look like nothing happened. On a
// narrow screen this brings the editor (or, from "Daftar konten", the list)
// to the top; no animation for people who asked for reduced motion.
function revealOnPhone(el, { instant = false } = {}) {
  if (!el || !window.matchMedia?.("(max-width: 860px)").matches) return;
  const calm = instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

// Separates "still drafting" from what's been submitted onward — each
// phase gets its own labeled folder in the sidebar instead of one flat
// list, so submitted content doesn't sit mixed in with raw ideas.
const SIDEBAR_GROUPS = [
  { key: "drafting", label: t("cr.group.drafting"), statuses: ["idea", "draft"] },
  { key: "execution", label: t("cr.group.execution"), statuses: ["production"] },
  { key: "editing", label: t("cr.group.editing"), statuses: ["editing"] },
  { key: "scheduled", label: t("cr.group.scheduled"), statuses: ["scheduled"] },
  { key: "other", label: t("cr.group.other"), statuses: ["published", "archived"] },
];

// The list can be grouped three ways (settings.creatorGroupBy): by WEEK
// (default — what's overdue, due this week, next week, later, not yet
// scheduled), by STAGE (the folders above) or by SERIES. Weeks run Monday
// to Sunday like the rest of the app (js/goal-roadmap.js weekStart).
// Published / archived pieces (only ever the one that's open) sit in
// "Lainnya" at the bottom whichever way it's grouped.
const GROUP_BY = ["week", "stage", "series"];
function sidebarGroupBy(series) {
  const by = getSettings()?.creatorGroupBy;
  if (by === "series" && !series.length) return "week";
  return GROUP_BY.includes(by) ? by : "week";
}

function groupByToggleHTML(by, hasSeries) {
  const btn = (key) => `<button type="button" class="${by === key ? "active" : ""}" data-group-by="${key}" aria-pressed="${by === key}">${t(`cr.groupBy.${key}`)}</button>`;
  return `<div class="segmented creator-group-by" role="group" aria-label="${escapeHtml(t("cr.groupBy.aria"))}">${btn("week")}${btn("stage")}${hasSeries ? btn("series") : ""}</div>`;
}

const isDone = (c) => c.status === "published" || c.status === "archived";

// "5–11 Okt", or "28 Sep – 4 Okt" across a month.
function weekRangeLabel(from) {
  const to = addDays(from, 6);
  const loc = getLang() === "en" ? "en-US" : "id-ID";
  const day = (s) => new Date(`${s}T00:00:00`).getDate();
  const month = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(loc, { month: "short" });
  return month(from) === month(to) ? `${day(from)}–${day(to)} ${month(to)}` : `${day(from)} ${month(from)} – ${day(to)} ${month(to)}`;
}

function sidebarGroups(items, by, series) {
  const other = { key: "other", label: t("cr.group.other"), items: items.filter(isDone) };
  const open = items.filter((c) => !isDone(c));
  if (by === "week") {
    const today = localISODate();
    const thisWeek = weekStart(today);
    const nextWeek = addDays(thisWeek, 7);
    const later = addDays(thisWeek, 14);
    const when = (test) => open.filter((c) => test(c.scheduleDate));
    return [
      { key: "overdue", label: t("cr.wk.overdue"), items: when((d) => d && d < today) },
      { key: "this", label: t("cr.wk.this", { range: weekRangeLabel(thisWeek) }), items: when((d) => d && d >= today && d < nextWeek) },
      { key: "next", label: t("cr.wk.next", { range: weekRangeLabel(nextWeek) }), items: when((d) => d && d >= nextWeek && d < later) },
      { key: "later", label: t("cr.wk.later"), items: when((d) => d && d >= later) },
      { key: "none", label: t("cr.wk.none"), items: when((d) => !d) },
      other,
    ];
  }
  if (by === "series") {
    const known = new Set(series.map((s) => s.id));
    return [
      ...series.map((s) => ({ key: `s-${s.id}`, label: escapeHtml(s.name || t("common.untitled")), items: open.filter((c) => c.seriesId === s.id) })),
      { key: "none", label: t("cr.sr.none"), items: open.filter((c) => !known.has(c.seriesId)) },
      other,
    ];
  }
  return SIDEBAR_GROUPS.map((g) => ({ ...g, items: items.filter((c) => g.statuses.includes(c.status)) }));
}

// Each group shows its first few rows; the rest sit behind "Show N more".
// Before, one long group (26 drafts) filled the whole scroll box and pushed
// Editing / Ready to upload / etc. out of sight — every group header now
// stays visible without scrolling inside the list.
const GROUP_PREVIEW = 5;
function groupedSidebarHTML(items, selectedId, collapsedGroups, expandedGroups = new Set(), { by = "stage", series = [] } = {}) {
  const seriesName = new Map(series.map((s) => [s.id, s.name]));
  return sidebarGroups(items, by, series)
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, key: `${by}:${g.key}` }))
    .map((g) => {
      const collapsed = collapsedGroups.has(g.key);
      const expanded = expandedGroups.has(g.key);
      let shown = g.items;
      if (!expanded && g.items.length > GROUP_PREVIEW) {
        shown = g.items.slice(0, GROUP_PREVIEW);
        // Never hide the row that's open on the right.
        const sel = g.items.find((c) => c.id === selectedId);
        if (sel && !shown.includes(sel)) shown = [...shown.slice(0, GROUP_PREVIEW - 1), sel];
      }
      const hidden = g.items.length - shown.length;
      const moreBtn = g.items.length > GROUP_PREVIEW
        ? `<button type="button" class="creator-group-more" data-expand-group="${g.key}">${expanded ? t("cr.group.showLess") : t("cr.group.showMore", { n: hidden })}</button>`
        : "";
      return `
    <div class="creator-sidebar-group ${collapsed ? "collapsed" : ""}">
      <button type="button" class="creator-sidebar-group-head" data-toggle-group="${g.key}">
        <span>${g.label} <span class="text-faint">${g.items.length}</span></span>
        ${icon("chevronDown", { size: 13, className: "creator-sidebar-group-chevron" })}
      </button>
      <div class="creator-sidebar-group-body">
        <div class="creator-sidebar-group-body-inner">
          ${shown.map((c) => sidebarRow(c, c.id === selectedId, { by, seriesName: by === "series" ? "" : seriesName.get(c.seriesId) || "" })).join("")}
          ${moreBtn}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

// The prompt for a regenerate that follows a discussion: the piece's own idea
// plus what the chat concluded, so the new script/hooks follow it.
function regenPrompt(idea, kind, guidance) {
  return [
    (idea || "").trim(),
    kind === "hook" ? t("cr.disc.regenPromptHook") : t("cr.disc.regenPromptScript"),
    guidance,
  ].filter(Boolean).join("\n\n");
}

// Two tiny "is it filled in?" marks — Script and Caption — lit when there's
// real text, dimmed when empty, so the sidebar shows what a piece still needs.
function fillMarks(c) {
  const mark = (ic, has, label) =>
    `<span class="fill-mark${has ? " on" : ""}" title="${escapeHtml(label + " · " + (has ? t("cr.fill.done") : t("cr.fill.empty")))}" aria-label="${escapeHtml(label)}">${icon(ic, { size: 12 })}</span>`;
  return `<span class="fill-marks">${mark("edit", !!(c.script || "").trim(), t("cr.fill.script"))}${mark("chat", !!(c.caption || "").trim(), t("cr.fill.caption"))}</span>`;
}

// Deleting is only offered on undrafted-anywhere-else stuff (idea/draft) —
// once a piece has moved into production/editing/scheduled/published, it
// likely has real work (shots, edits, a real publish) riding on it, so
// removing it stays a content-list-only action (js/views/content-list.js's
// row menu, which also has Archive) rather than a one-click trash icon
// right in Creator's own sidebar.
// Grouped by week or series, the row says its stage (the group no longer
// does) and, by week, which series it belongs to.
function sidebarRow(c, active, { by = "stage", seriesName = "" } = {}) {
  const deletable = c.status === "idea" || c.status === "draft";
  const meta = by === "stage"
    ? `${escapeHtml(c.platform || "—")} · ${formatDate(new Date(c.updatedAt))}`
    : [statusLabel(c.status, STATUS_LABELS), c.platform, seriesName].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <div class="creator-item ${active ? "active" : ""}" data-select="${c.id}">
      <span class="status-pill status-${c.status}" style="padding:3px 8px;"><span class="status-dot"></span></span>
      <div class="ti">
        <div class="t">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="m">${meta}${fillMarks(c)}</div>
        ${c.scheduleDate ? `<div class="creator-item-due">${dueBadge(c)}</div>` : ""}
      </div>
      ${
        deletable
          ? `<button type="button" class="icon-btn creator-item-delete" data-delete-content="${c.id}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 13 })}</button>`
          : ""
      }
    </div>
  `;
}

function emptyPanel() {
  return `
    <div class="empty-state card" style="margin:0;">
      <div class="icon-wrap">${icon("edit", { size: 22 })}</div>
      <h3>${t("cr.empty.title")}</h3>
      <p>${t("cr.empty.body")}</p>
      <button class="btn btn-primary" id="new-content-empty">${icon("plus", { size: 15 })}${t("cr.newContent")}</button>
    </div>
  `;
}

// Reverts a checkbox click that moved a card forward one stage too many —
// each key's value is where "Back" sends it.
const PREV_STATUS = { production: "draft", editing: "production", scheduled: "editing" };

// Submit Idea lives at the bottom of the drafting form — you finish
// writing, then submit, not the other way around. (Execution/Editing/Ready
// to Upload have their own dedicated single-purpose panels below, not this
// one, since by then there's nothing left to draft.)
function stageProgressHTML(c) {
  if (c.status !== "idea" && c.status !== "draft") return "";
  return `
    <div class="divider"></div>
    <div class="flex items-center justify-between" style="flex-wrap:wrap;gap:10px;">
      <span></span>
      <label class="checkbox-chip" id="mark-submitted"><input type="checkbox" />${t("cr.submitIdea")}</label>
    </div>
  `;
}

// Each stage past drafting gets its own minimal, single-purpose panel —
// once you're shooting or editing, you don't need the whole form, just the
// script to work from and one big action.
function mainPanel(c, campaigns, series) {
  if (c.status === "production") return executionPanel(c);
  if (c.status === "editing") return editingPanel(c);
  if (c.status === "scheduled") return readyToUploadPanel(c);
  return draftingPanel(c, campaigns, series);
}

// Campaign + Funnel Stage, editable right where the writing happens — this
// used to only live in Content Editor's Basic Info tab, so anyone working
// entirely from Creator (the natural place to "just start writing") could
// finish a piece without it ever being linked to a campaign, quietly
// undermining Home's Campaign Coverage metric. Scoped to the drafting stage
// only: once a piece is in production/editing/scheduled its goal shouldn't
// change out from under the person shooting/editing it.
function campaignFieldHTML(c, campaigns) {
  const campaign = campaigns.find((camp) => camp.id === c.campaignId);
  const guided = getMode() === "guided";
  // Only old phase-based campaigns have phases to pick. Level (Grow Brand)
  // and Event campaigns move through their stages by themselves — they
  // still carry the generic 7-phase list from creation, which used to show
  // up here as choices that meant nothing for them — so they get a line
  // saying which stage they're in instead.
  const showPhase = campaignHasOwnPhases(campaign);
  const autoStage = campaign && !showPhase ? currentStageName(campaign) : "";
  return `
    <div class="field">
      <label for="f-campaign">${guided ? t("cr.campaign.guidedLabel") : t("cr.campaign.label")}</label>
      <select class="select" id="f-campaign">
        <option value="">${guided ? t("cr.campaign.noneGuided") : t("cr.campaign.none")}</option>
        ${campaigns.map((camp) => `<option value="${camp.id}" ${c.campaignId === camp.id ? "selected" : ""}>${escapeHtml(campaignDisplayName(camp.name))}</option>`).join("")}
      </select>
      ${
        showPhase
          ? `<select class="select" id="f-phase" style="margin-top:8px;">
               <option value="">${guided ? t("cr.phase.guided") : t("cr.phase.none")}</option>
               ${campaign.phases.map((p) => `<option value="${p.id}" ${c.campaignPhaseId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
             </select>`
          : autoStage ? `<p class="text-faint" style="font-size:12px;margin:6px 0 0;">${t("cr.phase.auto", { stage: escapeHtml(autoStage) })}</p>` : ""
      }
    </div>
  `;
}

function currentStageName(campaign) {
  const stages = campaignStages(campaign);
  if (!stages.length) return "";
  return stages[activeStageIndex(campaign, stages, listContent(campaign.brandId))]?.name || "";
}

// Recurring Content Series link — optional, sits right under Campaign since
// it's the same kind of "what does this piece belong to" decision. Left
// empty by default (most content isn't part of a series); once picked, its
// saved DNA/context (js/ai.js buildSeriesContext) rides along on every
// generate/regenerate for this piece, alongside the brand's own voice.
function seriesFieldHTML(c, series) {
  if (!series.length) return "";
  return `
    <div class="field">
      <label for="f-series">${t("cr.series.label")}</label>
      <select class="select" id="f-series">
        <option value="">${t("cr.series.none")}</option>
        ${series.map((s) => `<option value="${s.id}" ${c.seriesId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
  `;
}

// Advanced mode keeps the compact TOFU/MOFU/BOFU chip row. Guided mode swaps
// the jargon for a plain question — same underlying funnel value either way,
// just asked as "what's this for" instead of assuming the acronyms mean
// anything to someone new to marketing funnels. Needs its own full-width row
// (the description text doesn't fit next to Campaign), so guided and
// advanced get different layouts around the same two fields.
function campaignFunnelFieldsHTML(c, campaigns, series = []) {
  const guided = getMode() === "guided";
  if (guided) {
    return `
      ${campaignFieldHTML(c, campaigns)}
      ${seriesFieldHTML(c, series)}
      <div id="funnel-goal-wrap">${funnelGoalFieldHTML(c)}</div>
    `;
  }
  return `
    <div class="row-2">
      ${campaignFieldHTML(c, campaigns)}
      ${funnelFieldHTML({ id: "f-funnel-picker", value: c.funnel })}
    </div>
    ${seriesFieldHTML(c, series)}
  `;
}

// 6.2: Pemula answers "what's this content for" once — in the AI modal, or
// here the first time. Once c.funnel is set, this collapses to a one-line
// summary with an "ubah" link that swaps the same picker back in, instead
// of asking again on every repaint of the drafting panel.
function funnelGoalFieldHTML(c) {
  if (!c.funnel) return funnelFieldHTML({ id: "f-funnel-picker", value: c.funnel, fieldStyle: "margin-bottom:0;" });
  return `
    <div class="field" style="margin-bottom:0;">
      <p class="text-muted" style="font-size:13px;margin:0;">
        ${t("cr.funnel.goalSummary", { label: escapeHtml(t(`creator.funnel.guided.${c.funnel}.title`)) })}
        <a href="#" id="funnel-goal-edit" style="color:var(--accent);font-weight:700;">${t("cr.funnel.change")}</a>
      </p>
    </div>
  `;
}

// Creator is the one place a piece is edited (the old side drawer now
// only creates new pieces). So everything the drawer used to hold lives
// here too: status (any direction — the stage buttons only ever move one
// step), platform, format, and the date it goes out.
function statusSelectHTML(c) {
  const guided = getMode() === "guided";
  return `<label class="cr-status-select" title="${escapeHtml(guided ? t("cnt.editor.guidedStatusLabel") : t("contentEditor.status.label"))}">
      <span class="status-dot status-${c.status}"></span>
      <select class="select" id="f-status" aria-label="${escapeHtml(t("contentEditor.status.label"))}">
        ${STATUSES.filter((s) => s !== "archived").map((s) => `<option value="${s}" ${c.status === s ? "selected" : ""}>${escapeHtml(statusLabel(s, STATUS_LABELS))}</option>`).join("")}
      </select>
    </label>`;
}
function withCurrent(list, current) {
  const names = list.map((x) => x.name);
  return current && !names.includes(current) ? [current, ...names] : names;
}
function channelFieldsHTML(c) {
  const settings = getSettings();
  const opt = (v, cur) => `<option value="${escapeHtml(v)}" ${v === cur ? "selected" : ""}>${escapeHtml(v)}</option>`;
  return `
    <div class="row-2">
      <div class="field">
        <label for="f-platform">${t("contentEditor.platform.label")}</label>
        <select class="select" id="f-platform">${c.platform ? "" : `<option value="">—</option>`}${withCurrent(settings.platforms || [], c.platform).map((v) => opt(v, c.platform)).join("")}</select>
      </div>
      <div class="field">
        <label for="f-format">${t("contentEditor.format.label")}</label>
        <select class="select" id="f-format">${c.format ? "" : `<option value="">—</option>`}${withCurrent(settings.formats || [], c.format).map((v) => opt(v, c.format)).join("")}</select>
      </div>
    </div>
    ${c.status === "published" ? "" : `<div class="field">
      <label for="f-schedule">${t("contentEditor.scheduleDate.label")}</label>
      <input class="input" type="date" id="f-schedule" value="${c.scheduleDate || ""}" min="${localISODate()}" />
    </div>`}`;
}
// After "Selesai": the piece is out — what's left is where it went and how
// it did. The link and the numbers used to live only in the side drawer and
// Daftar Konten, with nothing here pointing at them.
function publishedCardHTML(c) {
  const p = c.performance || {};
  const has = ["views", "likes", "comments", "shares", "saves", "reposts"].some((k) => p[k] !== null && p[k] !== undefined && p[k] !== "");
  return `
    <div class="card dark-surface card-tight cr-published">
      <div class="cr-published-head">${icon("check", { size: 14 })}<b>${t("cr.pub.title")}</b>${c.publishedDate ? `<span class="text-faint">${escapeHtml(formatDate(c.publishedDate))}</span>` : ""}</div>
      <div class="row-2">
        <div class="field" style="margin-bottom:0;">
          <label for="f-published">${t("contentEditor.publishedDate.label")}</label>
          <input class="input" type="date" id="f-published" value="${c.publishedDate || ""}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="f-url">${t("cr.pub.link")}</label>
          <input class="input" id="f-url" placeholder="https://..." value="${escapeHtml(c.publishedUrl || "")}" />
        </div>
      </div>
      <div class="flex items-center gap-8" style="flex-wrap:wrap;margin-top:12px;">
        <button type="button" class="btn ${has ? "btn-secondary" : "btn-primary"} btn-sm" id="cr-fill-performance">${icon("chart", { size: 13 })}${has ? t("cr.pub.updatePerf") : t("cr.pub.fillPerf")}</button>
        <span class="text-faint" style="font-size:12px;">${has ? t("cr.pub.perfSummary", { views: formatNumber(p.views ?? 0), likes: formatNumber(p.likes ?? 0), comments: formatNumber(p.comments ?? 0) }) : t("cr.pub.perfHint")}</span>
      </div>
    </div>`;
}

function phaseHead(c) {
  const back = PREV_STATUS[c.status]
    ? `<button type="button" class="btn btn-ghost btn-sm" id="stage-back">${icon("chevronLeft", { size: 13 })}${t("common.backTo", { label: statusLabel(PREV_STATUS[c.status], STATUS_LABELS) })}</button>`
    : "";
  return `
    <div class="creator-field-head" style="margin-bottom:18px;">
      ${statusSelectHTML(c)}
      ${back}
    </div>
  `;
}

function executionPanel(c) {
  return `
    <div class="card glass-card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:4px;">${escapeHtml(c.title || t("common.untitled"))}</div>
      <button type="button" class="tp-cta" id="open-teleprompter">${icon("teleprompter", { size: 20 })}<span>${t("creator.teleprompterCta")}<small>${t("creator.teleprompterHint")}</small></span>${icon("arrowRight", { size: 14 })}</button>
      ${isCarouselContent(c) ? slidesReadHTML(c.script) : stageScriptHTML(c.script)}
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-shot-big">${icon("check", { size: 20 })}${t("cr.doneShooting")}</button>
    </div>
  `;
}

// Pemula only. Editing is the one stage that assumes a skill the app never
// teaches: someone who just finished shooting their first video has no idea
// what to open next, and the panel used to be a title and a "done" button.
// Two free phone apps, one pick, and a nudge to watch a tutorial before
// wrestling with a timeline. Pro gets nothing — anyone there already has an
// editor they like, and a recommendation would just be noise.
const EDIT_APPS = ["capcut", "edits"];

function editingAppsHTML() {
  if (getMode() !== "guided") return "";
  return `
    <div class="card dark-surface card-tight" style="margin-bottom:18px;">
      <div class="page-eyebrow" style="margin-bottom:4px;">${t("cr.editApps.title")}</div>
      <p class="text-muted" style="font-size:13px;line-height:1.6;margin:0 0 14px;">${t("cr.editApps.body")}</p>
      ${EDIT_APPS.map(
        (app) => `
        <div class="card card-tight" style="background:var(--surface-2);margin-bottom:8px;">
          <div style="font-weight:800;font-size:13.5px;margin-bottom:3px;">${t(`cr.editApps.${app}.name`)}</div>
          <p class="text-muted" style="font-size:12.5px;line-height:1.6;margin:0 0 10px;">${t(`cr.editApps.${app}.desc`)}</p>
          <a class="btn btn-secondary btn-sm" href="https://www.youtube.com/results?search_query=${encodeURIComponent(t(`cr.editApps.${app}.query`))}" target="_blank" rel="noopener" style="text-decoration:none;">${icon("play", { size: 12 })}${t("cr.editApps.watch")}</a>
        </div>`
      ).join("")}
      <p class="hint" style="margin:10px 0 0;">${icon("bulb", { size: 12 })} ${t("cr.editApps.hint")}</p>
    </div>
  `;
}

function editingPanel(c) {
  return `
    <div class="card glass-card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:20px;">${escapeHtml(c.title || t("common.untitled"))}</div>
      ${editingAppsHTML()}
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-edited-big">${icon("check", { size: 20 })}${t("cr.doneEditing")}</button>
    </div>
  `;
}

// Every platform the account works with (Pengaturan → Platform), plus this
// piece's own platform if it isn't on that list (Copy Studio saves Threads /
// WhatsApp pieces) and anything already ticked — so a YouTube or Facebook
// post can be marked published without a false TikTok/Instagram tick.
function uploadPlatformOptions(c) {
  const out = new Map();
  const add = (id, name) => { const key = String(id || "").toLowerCase().trim(); if (key && !out.has(key)) out.set(key, name || id); };
  if (c.platform) add(c.platform, c.platform);
  (getSettings().platforms || []).forEach((p) => add(p.id || p.name, p.name));
  Object.keys(c.uploadedPlatforms || {}).forEach((k) => add(k, k === "tiktok" ? "TikTok" : k.charAt(0).toUpperCase() + k.slice(1)));
  return [...out].map(([id, name]) => ({ id, name }));
}

function readyToUploadPanel(c) {
  const up = c.uploadedPlatforms || {};
  return `
    <div class="card glass-card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:16px;">${escapeHtml(c.title || t("common.untitled"))}</div>

      ${c.thumbnail ? `<img class="thumb-preview" src="${c.thumbnail}" alt="" />` : ""}

      ${
        c.caption
          ? `<div class="field" style="margin-bottom:6px;">
               <div class="creator-field-head">
                 <label style="margin-bottom:0;">${t("cr.f.caption")}</label>
                 <button type="button" class="chip-icon-btn" id="copy-caption-ready" aria-label="${t("cr.copyCaption")}" title="${t("cr.copyCaption")}">${icon("copy", { size: 15 })}</button>
               </div>
               <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;">${escapeHtml(c.caption)}</div>
             </div>`
          : ""
      }

      <div class="divider"></div>

      <div class="field" style="margin-bottom:8px;">
        <label for="f-schedule">${t("contentEditor.scheduleDate.label")}</label>
        <input class="input" type="date" id="f-schedule" value="${c.scheduleDate || ""}" min="${localISODate()}" />
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label>${t("cr.uploadedWhere")}</label>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          ${uploadPlatformOptions(c).map((p) => `<label class="checkbox-chip"><input type="checkbox" data-uploaded="${escapeHtml(p.id)}" ${up[p.id] ? "checked" : ""} />${platformIcon(p.id)}${t("cr.onPlatform", { name: escapeHtml(p.name) })}</label>`).join("")}
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-block stage-big-action" id="mark-uploaded-done">${icon("check", { size: 20 })}${t("cr.done")}</button>
      <p class="text-faint" style="font-size:11px;margin:10px 0 0;">${t("cr.doneHint")}</p>
    </div>
  `;
}

// ---- Carousel slides --------------------------------------------------------
// A carousel is a stack of still slides, not a spoken script, so the Script
// textarea becomes one card per slide. Storage stays the flat
// content.script string in the exact "Slide N\n…" shape js/ai.js
// generateScript already writes for carousels — the teleprompter, the PDF
// sheet, and every AI prompt keep reading one string, and an AI-generated
// carousel parses straight back into cards.
// isCarouselContent / parseSlides / serializeSlides / applyHook live in js/script-format.js.
const scriptLengthVars = (text) => { const { words, seconds } = scriptLength(text); return { s: seconds, w: words }; };

function slidesFieldHTML(c) {
  const slides = parseSlides(c.script);
  const cards = slides
    .map(
      (s, i) => `
      <div class="slide-card" data-slide="${i}">
        <div class="slide-card-head">
          <span class="slide-num">${escapeHtml(t("cr.ai.slideLabel", { n: i + 1 }))}</span>
          <span class="text-faint" style="font-size:11px;">${i === 0 ? t("cr.f.slideCover") : i === slides.length - 1 && slides.length > 1 ? t("cr.f.slideClose") : ""}</span>
          <span style="flex:1;"></span>
          <button type="button" class="chip-icon-btn" data-slide-up="${i}" aria-label="${t("cr.f.slideUp")}" title="${t("cr.f.slideUp")}" ${i === 0 ? "disabled" : ""}>${icon("arrowUp", { size: 12 })}</button>
          <button type="button" class="chip-icon-btn" data-slide-delete="${i}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 12 })}</button>
        </div>
        <textarea class="textarea slide-text" data-slide-text="${i}" rows="2" aria-label="${escapeHtml(t("cr.f.slideAria", { n: i + 1 }))}" placeholder="${escapeHtml(t("cr.f.slidePh"))}">${escapeHtml(s.text)}</textarea>
      </div>`
    )
    .join("");
  return `
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.slides")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="ai-field-btn" id="ai-quick-script" aria-label="${t("cr.f.quickScriptAria")}" title="${t("cr.f.quickCarouselTitle")}">${icon("bot", { size: 15 })}<span>${t("cr.f.aiWrite")}</span></button>
          </div>
        </div>
        <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">${t("cr.f.slidesHint")}</p>
        ${hookTemplateButtonHTML()}
        <div class="slide-editor" id="slide-editor">
          ${cards || `<p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${t("cr.f.slidesEmpty")}</p>`}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="slide-add">${icon("plus", { size: 13 })}${t("cr.f.addSlide")}</button>
      </div>`;
}

// "Template hook" (js/hook-template-picker.js): one button above the
// script or the slides — the line it makes becomes the first part.
const hookTemplateButtonHTML = () =>
  `<div class="htpl-open-row"><button type="button" class="htpl-open" id="hook-template-open" title="${escapeHtml(t("hooktpl.openTitle"))}">${icon("layers", { size: 14 })}<span>${t("hooktpl.open")}</span></button></div>`;

// ---- Video script: "Biasa" or "Pro" ---------------------------------------
// Two ways to write the same script, remembered on the account
// (settings.scriptEditor): "Biasa" is one plain box that shows only the
// words — no part names, no Visual / Teks layar lines (plainScript); "Pro"
// is one card per part (js/script-cards.js). Until someone picks, it is
// Biasa — also in the app's Pro mode. #f-script stays in the page, hidden,
// with the stored text — everything that reads or writes the script goes
// through it.
const scriptEditorMode = () => {
  const picked = getSettings()?.scriptEditor;
  if (picked === "cards") return "cards";
  // Anything else — "plain", the old "text" ("Ketik biasa"), or nothing
  // picked yet — is Biasa: everyone starts there; Pro (parts) is one tap
  // away and stays once chosen.
  return "plain";
};

function scriptFieldHTML(c) {
  const mode = scriptEditorMode();
  const cards = mode === "cards";
  const shown = plainScript(c.script || "");
  const modeBtn = (key, label, title) =>
    `<button type="button" class="${mode === key ? "active" : ""}" data-script-mode="${key}" aria-pressed="${mode === key}" title="${escapeHtml(t(title))}">${t(label)}</button>`;
  // A textarea drops one leading line break of its content — hence the "\n".
  return `<div class="field" id="script-field">
        <div class="creator-field-head script-field-head">
          <label ${cards ? "" : `for="f-script-plain"`} style="margin-bottom:0;">${t("cr.f.script")}</label>
          <div class="flex items-center gap-6">
            <div class="segmented script-mode" role="group" aria-label="${escapeHtml(t("cr.cards.modeAria"))}">
              ${modeBtn("plain", "cr.cards.modePlain", "cr.cards.modePlainTitle")}${modeBtn("cards", "cr.cards.modePro", "cr.cards.modeProTitle")}
            </div>
            <button type="button" class="btn btn-ghost btn-sm script-focus-btn" id="script-focus-open" title="${escapeHtml(t("cr.focus.openTitle"))}">${icon("expand", { size: 13 })}<span>${t("cr.focus.open")}</span></button>
            <button type="button" class="ai-field-btn" id="ai-quick-script" aria-label="${t("cr.f.quickScriptAria")}" title="${t("cr.f.quickScriptTitle")}">${icon("bot", { size: 15 })}<span>${t("cr.f.aiWrite")}</span></button>
          </div>
        </div>
        ${hookTemplateButtonHTML()}
        ${cards ? `<div id="script-cards"></div>` : `<textarea class="textarea" id="f-script-plain" style="min-height:220px;" placeholder="${escapeHtml(t("cr.f.scriptPh"))}">\n${escapeHtml(shown.text)}</textarea>`}
        <textarea id="f-script" hidden>\n${escapeHtml(c.script || "")}</textarea>
        ${cards ? "" : `<p class="text-faint script-len-note" id="script-len-note" ${(c.script || "").trim() ? "" : "hidden"}>${icon("clock", { size: 11 })}<span>${t("cr.ai.lengthBadge", scriptLengthVars(c.script))}</span></p>
        ${shown.directed ? `<p class="text-faint script-plain-more">${t("cr.plain.moreShort")} <button type="button" data-script-mode="cards">${t("cr.plain.moreOpen")}</button></p>` : ""}`}
      </div>`;
}

// The script on the Syuting screen: a beat script as its parts (time, what
// to show, the screen text, what to say), anything else as plain text.
function stageScriptHTML(script) {
  const beats = scriptBeatsHTML(script, escapeHtml);
  if (beats) return `<div class="stage-script-display has-beats">${beats}</div>`;
  return `<div class="stage-script-display">${escapeHtml(script || t("cr.noScript")).replace(/\n/g, "<br>")}</div>`;
}

function slidesReadHTML(script) {
  const slides = parseSlides(script);
  if (!slides.length) return `<div class="stage-script-display">${escapeHtml(t("cr.noScript"))}</div>`;
  return `<div class="stage-script-display slide-read">${slides
    .map((s, i) => `<div class="slide-read-card"><span class="slide-num">${escapeHtml(t("cr.ai.slideLabel", { n: i + 1 }))}</span><div>${escapeHtml(s.text).replace(/\n/g, "<br>")}</div></div>`)
    .join("")}</div>`;
}

function draftingPanel(c, campaigns, series = []) {
  const publishedNote = c.status === "published" ? publishedCardHTML(c) : "";
  return `
    <div class="card glass-card">
      <div class="cr-ai-row">
        <button type="button" class="btn btn-primary" id="ai-generate-all">${icon("bot", { size: 15 })}${t("cr.aiAll")}</button>
        <button type="button" class="btn btn-secondary" id="ai-discuss" title="${escapeHtml(t("cr.disc.title"))}">${icon("chat", { size: 15 })}${t("cr.disc.short")}</button>
      </div>
      <p class="text-faint" style="font-size:11.5px;text-align:center;margin:6px 0 16px;">${icon("arrowUp", { size: 10 })} ${t("cr.aiAllHint")}</p>

      <div class="creator-field-head cr-status-row" style="margin-bottom:18px;">
        ${statusSelectHTML(c)}
        <div class="flex items-center gap-8">
          <span class="save-indicator" id="save-indicator">${t("cr.saved")}</span>
          <button class="btn btn-ghost btn-sm" id="download-script-pdf">${icon("download", { size: 13 })}${t("cr.pdf.download")}</button>
        </div>
      </div>
      ${publishedNote}

      <div class="field">
        <label for="f-title">${t("cr.f.title")}</label>
        <input class="input" id="f-title" value="${escapeHtml(c.title)}" placeholder="${t("cr.f.titlePh")}" />
      </div>
      <div class="field">
        <label for="f-idea">${t("cr.f.idea")}</label>
        <textarea class="textarea" id="f-idea" style="min-height:60px;" placeholder="${t("cr.f.ideaPh")}">${escapeHtml(c.idea || "")}</textarea>
      </div>
      ${channelFieldsHTML(c)}
      ${campaignFunnelFieldsHTML(c, campaigns, series)}
      ${isCarouselContent(c) ? slidesFieldHTML(c) : scriptFieldHTML(c)}
      <div class="field">
        <div class="creator-field-head">
          <label for="f-caption" style="margin-bottom:0;">${t("cr.f.caption")}</label>
          <button type="button" class="ai-field-btn" id="ai-quick-caption" aria-label="${t("cr.f.quickCaptionAria")}" title="${t("cr.f.quickCaptionTitle")}">${icon("bot", { size: 15 })}<span>${t("cr.f.aiWrite")}</span></button>
        </div>
        <textarea class="textarea" id="f-caption" placeholder="${t("cr.f.captionPh")}">${escapeHtml(c.caption || "")}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label for="f-cta">${t("cr.f.cta")}</label>
          <input class="input" id="f-cta" value="${escapeHtml(c.cta)}" placeholder="${t("cr.f.ctaPh")}" />
        </div>
        <div class="field">
          <label for="f-reference">${t("cr.f.reference")}</label>
          <input class="input" id="f-reference" value="${escapeHtml(c.reference)}" placeholder="${t("cr.f.referencePh")}" />
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="f-notes">${t("cr.f.notes")}</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;">${escapeHtml(c.notes || "")}</textarea>
      </div>
      ${stageProgressHTML(c)}
    </div>
  `;
}

// ============================================================================
// Pemula: Creator as folders + one piece taken a step at a time
// (owner's asks, 2026-10-26: "terlalu ribet").
//
//   • The list is folders (Minggu / Tahap / Seri, as before). The folder
//     with the open piece is open and the piece in it is a big colour card;
//     every other piece is one slim line and every other folder is closed —
//     so which one is open is obvious at a glance.
//   • The piece is five steps — Ide → Script → Syuting → Edit → Upload —
//     one screen each, with one big button to the next. A done step can be
//     opened again to look back (and edit); its status doesn't move back.
//   • Ide and Script have Tanya Brandlab docked beside them on a wide
//     screen (js/consultant-panel.js dockChat): the talk about this piece's
//     idea, then its script. The AI offers; the owner taps what goes in.
//
// Every field keeps the id the classic panel uses (#f-title, #f-idea,
// #f-script…), so the saving and the AI buttons above work unchanged.
// Pro keeps the classic layout.
// ============================================================================

const STEP_KEYS = ["idea", "script", "shoot", "edit", "upload", "done"];
const STEP_COLOR = { idea: "#FFC83D", script: "#3B9BFF", shoot: "#FF8A3D", edit: "#A974FF", upload: "#36D27F", done: "#E9E2D6" };
const STATUS_STEP = { idea: "idea", draft: "script", production: "shoot", editing: "edit", scheduled: "upload", published: "done", archived: "done" };
export const currentStep = (c) => STATUS_STEP[c?.status] || "idea";
const isPhone = () => !!window.matchMedia?.("(max-width: 860px)").matches;
// Room for the chat column beside the piece.
const isWideDock = () => !!window.matchMedia?.("(min-width: 1180px)").matches;
// A carousel or a photo is designed, not shot.
const isDesigned = (c) => isCarouselContent(c) || /static|post|foto|photo|image/i.test(c?.format || "");
const stepLabel = (key, c) => (key === "shoot" && isDesigned(c) ? t("cw.step.design") : t(`cw.step.${key}`));
const wantsDock = (step) => step === "idea" || step === "script";

const FOLDER_COLOR = {
  overdue: "#FF6B5B", this: "#3B9BFF", next: "#36D27F", later: "#A974FF", none: "#B9AFA2", other: "#B9AFA2",
  drafting: "#FFC83D", execution: "#FF8A3D", editing: "#A974FF", scheduled: "#36D27F",
};

function shortWhen(c) {
  if (!c.scheduleDate || isDone(c)) return "";
  const today = localISODate();
  if (c.scheduleDate < today) return `<span class="cw-when is-late">${t("cw.late")}</span>`;
  if (c.scheduleDate === today) return `<span class="cw-when is-today">${t("nw.when.today")}</span>`;
  const d = new Date(`${c.scheduleDate}T00:00:00`).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "short" });
  return `<span class="cw-when">${escapeHtml(d)}</span>`;
}

function stepBarsHTML(c) {
  const cur = STEP_KEYS.indexOf(currentStep(c));
  return `<span class="cw-bars" aria-hidden="true">${STEP_KEYS.slice(0, 5).map((k, i) => `<i class="${i < cur ? "is-done" : i === cur ? "is-current" : ""}"></i>`).join("")}</span>`;
}

function bigItemHTML(c, arrive) {
  const step = currentStep(c);
  const n = Math.min(STEP_KEYS.indexOf(step) + 1, 5);
  const meta = [c.platform, c.format].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <div class="cw-item is-selected${arrive ? " is-arriving" : ""}" data-select="${c.id}" aria-current="true" style="--stage:${STEP_COLOR[step]};">
      <div class="cw-item-top"><span class="cw-item-stage">${step === "done" ? t("cw.step.done") : `${stepLabel(step, c)} · ${n}/5`}</span>${shortWhen(c)}</div>
      <div class="cw-item-title">${escapeHtml(c.title || t("common.untitled"))}</div>
      ${stepBarsHTML(c)}
      ${meta ? `<div class="cw-item-meta">${meta}</div>` : ""}
    </div>`;
}

function smallItemHTML(c) {
  return `
    <div class="cw-item" data-select="${c.id}" style="--stage:${STEP_COLOR[currentStep(c)]};" title="${escapeHtml(stepLabel(currentStep(c), c))}">
      <span class="cw-item-dot" aria-hidden="true"></span>
      <span class="cw-item-name">${escapeHtml(c.title || t("common.untitled"))}</span>
      ${shortWhen(c)}
    </div>`;
}

function foldersHTML(items, selectedId, state, by, series) {
  return sidebarGroups(items, by, series)
    .filter((g) => g.items.length)
    .map((g, i) => {
      const key = `${by}:${g.key}`;
      const hasSel = g.items.some((c) => c.id === selectedId);
      const open = state.folders.has(key) ? state.folders.get(key) : hasSel;
      const expanded = state.expandedGroups.has(key);
      let shown = g.items;
      if (!expanded && g.items.length > GROUP_PREVIEW) {
        shown = g.items.slice(0, GROUP_PREVIEW);
        const sel = g.items.find((c) => c.id === selectedId);
        if (sel && !shown.includes(sel)) shown = [...shown.slice(0, GROUP_PREVIEW - 1), sel];
      }
      const more = g.items.length > GROUP_PREVIEW
        ? `<button type="button" class="cw-folder-more" data-expand-group="${key}">${expanded ? t("cr.group.showLess") : t("cr.group.showMore", { n: g.items.length - shown.length })}</button>`
        : "";
      const color = FOLDER_COLOR[g.key] || (g.key.startsWith("s-") ? "#E4B37E" : "#B9AFA2");
      return `
      <section class="cw-folder${open ? " is-open" : ""}${hasSel ? " has-selected" : ""}" style="--fold:${color};--i:${i};">
        <button type="button" class="cw-folder-tab" data-toggle-folder="${key}" aria-expanded="${open}">
          <span class="cw-folder-dot" aria-hidden="true"></span>
          <span class="cw-folder-name">${g.label}</span>
          <span class="cw-folder-count">${g.items.length}</span>
          ${icon("chevronDown", { size: 14, className: "cw-folder-chev" })}
        </button>
        <div class="cw-folder-body"><div class="cw-folder-inner">
          ${shown.map((c) => (c.id === selectedId ? bigItemHTML(c, state.arrive) : smallItemHTML(c))).join("")}
          ${more}
        </div></div>
      </section>`;
    })
    .join("");
}

function stepperHTML(c, step, state) {
  const cur = STEP_KEYS.indexOf(currentStep(c));
  return `<ol class="cw-steps" aria-label="${escapeHtml(t("cw.steps.aria"))}">${STEP_KEYS.slice(0, 5).map((k, i) => {
    const cls = i < cur ? "is-done" : i === cur ? "is-current" : "is-next";
    const viewing = k === step;
    // Done steps open to look back; the current one brings you back to it.
    const clickable = i < cur || (i === cur && !!state.viewStep);
    return `<li class="cw-step ${cls}${viewing ? " is-viewing" : ""}" style="--sc:${STEP_COLOR[k]};">
        <button type="button" ${clickable ? `data-view-step="${k}"` : "disabled"} ${viewing ? `aria-current="step"` : ""}>
          <span class="cw-step-dot">${i < cur ? icon("check", { size: 12 }) : i + 1}</span><span class="cw-step-name">${stepLabel(k, c)}</span>
        </button>
      </li>`;
  }).join("")}</ol>`;
}

function metaRowHTML(c, step) {
  const settings = getSettings();
  const opt = (v, cur) => `<option value="${escapeHtml(v)}" ${v === cur ? "selected" : ""}>${escapeHtml(v)}</option>`;
  const showDate = step !== "upload" && c.status !== "published";
  return `
    <div class="cw-meta">
      <label class="cw-pill" title="${escapeHtml(t("contentEditor.format.label"))}">${icon("layers", { size: 13 })}
        <select id="f-format" aria-label="${escapeHtml(t("contentEditor.format.label"))}">${c.format ? "" : `<option value="">—</option>`}${withCurrent(settings.formats || [], c.format).map((v) => opt(v, c.format)).join("")}</select>
      </label>
      <label class="cw-pill" title="${escapeHtml(t("contentEditor.platform.label"))}">${platformIcon(c.platform || "")}
        <select id="f-platform" aria-label="${escapeHtml(t("contentEditor.platform.label"))}">${c.platform ? "" : `<option value="">—</option>`}${withCurrent(settings.platforms || [], c.platform).map((v) => opt(v, c.platform)).join("")}</select>
      </label>
      ${showDate ? `<label class="cw-pill cw-pill-date${c.scheduleDate && c.scheduleDate < localISODate() ? " is-late" : ""}" title="${escapeHtml(t("contentEditor.scheduleDate.label"))}">${icon("calendar", { size: 13 })}
        <span>${c.scheduleDate ? escapeHtml(formatDate(c.scheduleDate)) : t("cw.when.none")}</span>
        <input type="date" id="f-schedule" value="${c.scheduleDate || ""}" min="${localISODate()}" aria-label="${escapeHtml(t("contentEditor.scheduleDate.label"))}" />
      </label>` : ""}
    </div>`;
}

function nextBtnHTML(id, label, nextStep, { check = false } = {}) {
  return `<div class="cw-next-row"><button type="button" class="cw-next" id="${id}" style="--next:${STEP_COLOR[nextStep]};"><span>${label}</span><span class="cw-next-dot">${icon(check ? "check" : "arrowRight", { size: 16 })}</span></button></div>`;
}

// No chat column (a narrow window, or ✕ closed it): one card that opens it.
function chatInviteHTML(kind, docked) {
  if (docked) return "";
  const script = kind === "script";
  const id = script && !isWideDock() ? "ai-discuss" : "cw-chat-open";
  return `
    <div class="cw-chat-invite">
      <span class="cw-chat-icon">${icon("chat", { size: 18 })}</span>
      <div class="cw-chat-text"><b>${t(script ? "cw.script.discussTitle" : "cw.idea.chatTitle")}</b><span>${t(script ? "cw.script.discussBody" : "cw.idea.chatBody")}</span></div>
      <button type="button" class="btn btn-secondary btn-sm" id="${id}">${icon("chat", { size: 13 })}${t("cw.chat.open")}</button>
    </div>`;
}

function ideaStepHTML(c, { campaigns, series, review, docked }) {
  return `
    <div class="cw-field">
      <label class="cw-label" for="f-idea">${t("cw.idea.label")}</label>
      <textarea class="textarea cw-idea" id="f-idea" placeholder="${escapeHtml(t("cw.idea.ph"))}">${escapeHtml(c.idea || "")}</textarea>
    </div>
    <div id="funnel-goal-wrap" class="cw-goal">${funnelGoalFieldHTML(c)}</div>
    ${campaigns.length ? campaignFieldHTML(c, campaigns) : ""}
    ${seriesFieldHTML(c, series)}
    <details class="cw-more" ${c.reference || c.notes || c.cta ? "open" : ""}>
      <summary>${icon("chevronDown", { size: 13 })}${t("cw.more")}</summary>
      <div class="field">
        <label for="f-reference">${t("cr.f.reference")}</label>
        <input class="input" id="f-reference" value="${escapeHtml(c.reference)}" placeholder="${t("cr.f.referencePh")}" />
      </div>
      <div class="field">
        <label for="f-cta">${t("cr.f.cta")}</label>
        <input class="input" id="f-cta" value="${escapeHtml(c.cta)}" placeholder="${t("cr.f.ctaPh")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label for="f-notes">${t("cr.f.notes")}</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;">${escapeHtml(c.notes || "")}</textarea>
      </div>
    </details>
    ${chatInviteHTML("idea", docked)}
    ${review ? "" : nextBtnHTML("cw-to-script", t("cw.idea.next"), "script")}`;
}

function captionFieldHTML(c) {
  return `
    <div class="field cw-caption">
      <div class="creator-field-head">
        <label for="f-caption" style="margin-bottom:0;">${t("cr.f.caption")}</label>
        <div class="flex items-center gap-6">
          <button type="button" class="chip-icon-btn" id="copy-caption-ready" aria-label="${t("cr.copyCaption")}" title="${t("cr.copyCaption")}">${icon("copy", { size: 15 })}</button>
          <button type="button" class="ai-field-btn" id="ai-quick-caption" aria-label="${t("cr.f.quickCaptionAria")}" title="${t("cr.f.quickCaptionTitle")}">${icon("bot", { size: 15 })}<span>${t("cr.f.aiWrite")}</span></button>
        </div>
      </div>
      <textarea class="textarea" id="f-caption" placeholder="${t("cr.f.captionPh")}">${escapeHtml(c.caption || "")}</textarea>
    </div>`;
}

function scriptStepHTML(c, { review, docked }) {
  const carousel = isCarouselContent(c);
  const empty = carousel ? !parseSlides(c.script).length : !(c.script || "").trim();
  return `
    ${empty ? `
    <div class="cw-ai-card">
      <span class="cw-ai-art">${appCharacterSVG("content-os")}</span>
      <div class="cw-ai-text"><b>${t("cw.script.aiTitle")}</b><span>${t("cw.script.aiBody")}</span></div>
      <button type="button" class="btn btn-primary" id="ai-generate-all">${icon("bot", { size: 15 })}${t("cw.script.aiBtn")}</button>
    </div>` : ""}
    ${carousel ? slidesFieldHTML(c) : scriptFieldHTML(c)}
    <details class="cw-more" ${(c.caption || "").trim() ? "open" : ""}>
      <summary>${icon("chevronDown", { size: 13 })}${t("cw.caption.later")}</summary>
      ${captionFieldHTML(c)}
    </details>
    ${chatInviteHTML("script", docked)}
    ${review ? "" : nextBtnHTML("cw-to-shoot", carousel ? t("cw.slides.next") : t("cw.script.next"), "shoot")}`;
}

function shootStepHTML(c, { review }) {
  const designed = isDesigned(c);
  return `
    ${designed ? "" : `<button type="button" class="tp-cta" id="open-teleprompter">${icon("teleprompter", { size: 20 })}<span>${t("creator.teleprompterCta")}<small>${t("creator.teleprompterHint")}</small></span>${icon("arrowRight", { size: 14 })}</button>`}
    ${isCarouselContent(c) ? slidesReadHTML(c.script) : stageScriptHTML(c.script)}
    ${review ? "" : nextBtnHTML("mark-shot-big", designed ? t("cw.doneDesign") : t("cr.doneShooting"), "edit", { check: true })}`;
}

// The two free editing apps (same words as the classic panel), as two
// flat colour blocks.
function editAppsSimpleHTML() {
  const colors = { capcut: "#FFC83D", edits: "#FF6FAE" };
  return `
    <p class="cw-lead"><b>${t("cr.editApps.title")}</b> ${t("cr.editApps.body")}</p>
    <div class="cw-apps">
      ${EDIT_APPS.map((app) => `
      <div class="cw-app" style="--app:${colors[app]};">
        <b>${t(`cr.editApps.${app}.name`)}</b>
        <span>${t(`cr.editApps.${app}.desc`)}</span>
        <a class="cw-app-go" href="https://www.youtube.com/results?search_query=${encodeURIComponent(t(`cr.editApps.${app}.query`))}" target="_blank" rel="noopener">${icon("play", { size: 12 })}${t("cr.editApps.watch")}</a>
      </div>`).join("")}
    </div>
    <p class="cw-hint">${icon("bulb", { size: 13 })}<span>${t("cr.editApps.hint")}</span></p>`;
}

function editStepHTML(c, { review }) {
  return `
    ${editAppsSimpleHTML()}
    ${review ? "" : nextBtnHTML("mark-edited-big", t("cr.doneEditing"), "upload", { check: true })}`;
}

function uploadStepHTML(c, { review }) {
  const up = c.uploadedPlatforms || {};
  return `
    ${c.thumbnail ? `<img class="thumb-preview" src="${c.thumbnail}" alt="" />` : ""}
    ${captionFieldHTML(c)}
    <div class="row-2">
      <div class="field">
        <label for="f-schedule">${t("contentEditor.scheduleDate.label")}</label>
        <input class="input" type="date" id="f-schedule" value="${c.scheduleDate || ""}" min="${localISODate()}" />
      </div>
      <div class="field">
        <label>${t("cr.uploadedWhere")}</label>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          ${uploadPlatformOptions(c).map((p) => `<label class="checkbox-chip"><input type="checkbox" data-uploaded="${escapeHtml(p.id)}" ${up[p.id] ? "checked" : ""} />${platformIcon(p.id)}${escapeHtml(p.name)}</label>`).join("")}
        </div>
      </div>
    </div>
    ${review ? "" : `${nextBtnHTML("mark-uploaded-done", t("cw.upload.next"), "done", { check: true })}<p class="text-faint cw-foot-hint">${t("cw.upload.hint")}</p>`}`;
}

function workspaceHTML(c, step, { campaigns, series, state, docked }) {
  const review = !!state.viewStep;
  const ctx = { campaigns, series, review, docked };
  const body = step === "idea" ? ideaStepHTML(c, ctx)
    : step === "script" ? scriptStepHTML(c, ctx)
    : step === "shoot" ? shootStepHTML(c, ctx)
    : step === "edit" ? editStepHTML(c, ctx)
    : step === "upload" ? uploadStepHTML(c, ctx)
    : publishedCardHTML(c);
  const cur = currentStep(c);
  return `
    <div class="cw-work${state.arrive ? " is-arriving" : ""}${state.stepChanged ? " is-stepping" : ""}" data-step="${step}" style="--step:${STEP_COLOR[step]};">
      <div class="cw-topbar">
        <button type="button" class="cw-back-list" data-back-to-list>${icon("chevronLeft", { size: 15 })}${t("cw.list.back")}</button>
        ${stepperHTML(c, step, state)}
        <div class="cw-tools">
          <span class="save-indicator" id="save-indicator">${t("cr.saved")}</span>
          <button type="button" class="icon-btn" id="cw-menu" aria-label="${escapeHtml(t("cw.menu"))}" title="${escapeHtml(t("cw.menu"))}">${icon("dots", { size: 16 })}</button>
        </div>
      </div>
      <div class="cw-card">
        <textarea class="cw-title" id="f-title" rows="1" maxlength="160" placeholder="${escapeHtml(t("cw.titlePh"))}" aria-label="${escapeHtml(t("cw.titleAria"))}">${escapeHtml(c.title || "")}</textarea>
        ${metaRowHTML(c, step)}
        ${review ? `<div class="cw-review">${icon("info", { size: 14 })}<span>${t("cw.review", { step: stepLabel(step, c) })}</span><button type="button" class="btn btn-secondary btn-sm" id="cw-review-back">${t("cw.review.back", { step: stepLabel(cur, c) })}${icon("arrowRight", { size: 13 })}</button></div>` : ""}
        <div class="cw-body">${body}</div>
      </div>
    </div>`;
}

function simpleEmptyHTML() {
  return `
    <div class="cw-empty">
      <span class="cw-empty-art">${appCharacterSVG("cos-creator")}</span>
      <h2>${t("cr.empty.title")}</h2>
      <p>${t("cr.empty.body")}</p>
      <button type="button" class="cl-cta" id="new-content-empty"><span>${t("cl.new")}</span><span class="cl-cta-dot">${icon("plus", { size: 18 })}</span></button>
    </div>`;
}

function simpleLayoutHTML({ brandId, all, items, campaigns, series, selected, groupBy, state }) {
  const step = selected ? state.viewStep || currentStep(selected) : null;
  state.wasWide = isWideDock();
  const docked = !!selected && wantsDock(step) && !state.dockOff && state.wasWide;
  const phoneOpen = state.phoneOpen || !items.length;
  return `
    <div class="cw-head">
      <div class="cw-head-title"><span class="cw-head-art">${appCharacterSVG("cos-creator")}</span><h1>${t("contentOs.tab.creator")}</h1></div>
      <div class="cw-head-actions">
        ${guideVideoButtonHTML("creator")}
        <button type="button" class="btn btn-secondary cw-week" id="cr-week-plan">${icon("sparkle", { size: 15 })}<span>${t("chat.week.button")}</span><span class="btn-cost">${t("chat.week.cost")}</span></button>
        <button type="button" class="cl-cta" id="new-content"><span>${t("cl.new")}</span><span class="cl-cta-dot">${icon("plus", { size: 18 })}</span></button>
      </div>
    </div>
    <div class="cw-layout${docked ? " has-dock" : ""}${phoneOpen ? " is-phone-open" : ""}" data-brand="${escapeHtml(brandId)}">
      <aside class="cw-side">
        ${items.length ? groupByToggleHTML(groupBy, series.length > 0) : ""}
        <div class="cw-folders">${items.length ? foldersHTML(items, selected?.id, state, groupBy, series) : `<div class="cw-side-empty">${t(all.length ? "cr.sidebarEmpty" : "cr.sidebarEmptyFirst")}</div>`}</div>
      </aside>
      <section class="cw-main">${selected ? workspaceHTML(selected, step, { campaigns, series, state, docked }) : simpleEmptyHTML()}</section>
      ${docked ? `<div class="cw-dock-slot" data-kind="${step}" aria-hidden="true"></div>` : ""}
    </div>`;
}

// The docked chat is the app's one chat panel (it lives in <body>, outside
// this page, so a repaint here never touches what's being typed in it);
// this keeps it lined up with its slot in the layout.
function placeDock(root) {
  const panel = document.getElementById("consultant-panel");
  const slot = root?.querySelector?.(".cw-dock-slot");
  if (!panel || !slot || !panel.classList.contains("is-ws-docked")) return;
  const bar = document.querySelector(".topbar");
  const barPos = bar ? getComputedStyle(bar).position : "";
  const minTop = (barPos === "sticky" || barPos === "fixed" ? bar.getBoundingClientRect().bottom : 0) + 12;
  root.style.setProperty("--cw-top", `${Math.round(minTop)}px`);
  const r = slot.getBoundingClientRect();
  const top = Math.max(r.top, minTop);
  const bottom = Math.min(r.bottom, window.innerHeight - 12);
  Object.assign(panel.style, { top: `${Math.round(top)}px`, left: `${Math.round(r.left)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(Math.max(260, bottom - top))}px` });
}

function syncDock(root, state, selected) {
  const slot = qs(".cw-dock-slot", root);
  if (!slot || !selected) { undockChat(); return; }
  const contentId = selected.id;
  const ok = slot.dataset.kind === "script"
    ? dockChat({
      contentId,
      kind: "script",
      title: selected.title || "",
      getCurrent: () => ({ ...(getContent(contentId) || selected), script: qs("#f-script", root)?.value ?? getContent(contentId)?.script ?? "" }),
      // The Biasa box, the Pro cards and the slides show it on the repaint
      // the save triggers.
      applyRevision: (target, text) => {
        const el = qs(target === "caption" ? "#f-caption" : "#f-script", root);
        if (el) el.value = text;
        updateContent(contentId, { [target]: text });
      },
    })
    : dockChat({ contentId, kind: "idea" });
  if (ok) requestAnimationFrame(() => placeDock(root));
}

function openStageMenu(root, brandId, state, selected, btn) {
  const r = btn.getBoundingClientRect();
  const menu = openMenu(btn, { top: r.bottom + 6, left: Math.max(8, r.right - 240) });
  if (!menu) return;
  const deletable = selected.status === "idea" || selected.status === "draft";
  menu.innerHTML = `
    ${isCarouselContent(selected) ? "" : `<button type="button" data-cw-act="pdf">${icon("download", { size: 15 })}${t("cr.pdf.download")}</button>`}
    <button type="button" data-cw-act="stage">${icon("layers", { size: 15 })}${t("cw.menu.stage")}</button>
    ${deletable ? `<button type="button" data-cw-act="delete">${icon("trash", { size: 15 })}${t("common.delete")}</button>` : ""}`;
  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-cw-act]")?.dataset.cwAct;
    if (!act) return;
    closeMenu();
    const brand = getBrand(brandId);
    if (act === "pdf") {
      openScriptPdfPreview({ ...selected, title: qs("#f-title", root)?.value ?? selected.title, idea: qs("#f-idea", root)?.value ?? selected.idea, script: qs("#f-script", root)?.value ?? selected.script }, brand);
    } else if (act === "stage") {
      const overlay = openModal({
        title: t("cw.stage.title"),
        bodyHTML: `<div class="cw-stage-pick">${STEP_KEYS.map((k) => `<button type="button" class="cw-stage-opt${currentStep(selected) === k ? " is-on" : ""}" data-to-step="${k}" style="--sc:${STEP_COLOR[k]};"><span class="cw-step-dot">${STEP_KEYS.indexOf(k) + 1}</span>${stepLabel(k, selected)}</button>`).join("")}</div>`,
      });
      overlay.querySelectorAll("[data-to-step]").forEach((b) => b.addEventListener("click", () => {
        const status = Object.keys(STATUS_STEP).find((s) => STATUS_STEP[s] === b.dataset.toStep);
        closeOverlay(overlay);
        if (!status || status === selected.status) return;
        updateContent(selected.id, { status, ...(status === "published" && !selected.publishedDate ? { publishedDate: localISODate() } : {}) });
        state.viewStep = null;
      }));
    } else if (act === "delete") {
      const ok = await confirmDialog({
        title: t("cr.delete.title", { title: escapeHtml(selected.title || t("common.untitled")) }),
        message: t("delete.toTrash.contentMessage", { days: TRASH_DAYS }),
        confirmLabel: t("delete.toTrash.confirm"),
        danger: true,
      });
      if (!ok) return;
      deleteContent(selected.id);
      state.selectedId = null;
      state.phoneOpen = false;
      toast(t("delete.toTrash.contentDone"));
    }
  });
}

function wireSimple(root, brandId, state, refresh, selected) {
  const repaint = () => paint(root, brandId, state, refresh);
  // The motion that says "this one just opened" plays once.
  state.arrive = false;
  state.stepChanged = false;

  qsa("[data-toggle-folder]", root).forEach((btn) => btn.addEventListener("click", () => {
    const key = btn.dataset.toggleFolder;
    state.folders.set(key, btn.getAttribute("aria-expanded") !== "true");
    const folder = btn.closest(".cw-folder");
    // Open/close in place first so it animates, then settle the state.
    folder?.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(folder?.classList.contains("is-open")));
  }));

  if (!selected) { undockChat(); return; }

  qsa("[data-view-step]", root).forEach((btn) => btn.addEventListener("click", () => {
    state.viewStep = btn.dataset.viewStep === currentStep(selected) ? null : btn.dataset.viewStep;
    state.stepChanged = true;
    repaint();
  }));
  qs("#cw-review-back", root)?.addEventListener("click", () => { state.viewStep = null; state.stepChanged = true; repaint(); });
  qs("#cw-to-script", root)?.addEventListener("click", () => {
    updateContent(selected.id, { status: "draft" });
  });
  qs("#cw-to-shoot", root)?.addEventListener("click", () => {
    updateContent(selected.id, { status: "production" });
    notify(t("cr.notify.toShooting"), t("cr.notify.toShootingBody", { title: selected.title || t("common.untitled") }));
  });
  qs("#cw-menu", root)?.addEventListener("click", (e) => openStageMenu(root, brandId, state, selected, e.currentTarget));
  qs("#cw-chat-open", root)?.addEventListener("click", () => {
    if (isWideDock()) { state.dockOff = false; repaint(); return; }
    openContentChat({ contentId: selected.id });
  });
  // The date pill: the whole pill opens the date picker.
  const datePill = qs(".cw-pill-date input", root);
  datePill?.addEventListener("click", () => { try { datePill.showPicker?.(); } catch { /* not allowed here */ } });
  // The title wraps instead of running off; Enter finishes it (one line).
  const autoFit = (el, min) => {
    if (!el) return;
    const fit = () => { el.style.height = "auto"; el.style.height = `${Math.max(min, el.scrollHeight + 2)}px`; };
    fit();
    el.addEventListener("input", fit);
  };
  const titleEl = qs("#f-title", root);
  autoFit(titleEl, 0);
  titleEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); } });
  autoFit(qs("#f-idea", root), 120);
  syncDock(root, state, selected);
}
