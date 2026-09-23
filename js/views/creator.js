import { getBrand, listContent, getContent, createContent, updateContent as storeUpdateContent, deleteContent, getSettings, onChange, listCampaigns, listSeries, getSeries, STATUS_LABELS, FUNNELS, localISODate } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { escapeHtml, formatDate, toast, avatarHTML, qs, qsa } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openTeleprompter } from "./teleprompter.js";
import { consumeNavContext } from "../nav-context.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { generateScript, AiApiError, hasAiKey, buildFullContext, buildSeriesContext, campaignSummaryLine } from "../ai.js";
import { pulseTextFor } from "../brand-pulse.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { getMode } from "../mode.js";
import { t } from "../i18n.js";
import { funnelFieldHTML, wireFunnelField, statusLabel } from "../funnel-field.js";
import { setPageGuide } from "../section-guide.js";
import { startCreatorGuide, startCreatorGuideOnMount } from "../guides/creator-guide.js";
import { isTourDemo, demoGenerateScript, DEMO_TOAST } from "../tour-demo.js";
import { wireMic } from "../voice-input.js";

// Mirror twins (one idea posted to Instagram + TikTok, see
// the content drawer) share their writing: whatever gets written
// on one — title, idea, script, caption, goal, campaign — is copied onto
// the other, so the TikTok half never sits blank. This used to happen only
// once, when the old edit drawer saved. Platform-specific fields (status,
// upload checkboxes, thumbnail) stay per record.
const MIRROR_SHARED_FIELDS = ["title", "idea", "script", "caption", "cta", "reference", "notes", "funnel", "campaignId", "campaignPhaseId", "seriesId"];
function updateContent(id, patch) {
  storeUpdateContent(id, patch);
  const item = getContent(id);
  if (!item?.mirrorGroupId) return;
  const shared = Object.fromEntries(Object.entries(patch).filter(([k]) => MIRROR_SHARED_FIELDS.includes(k)));
  if (!Object.keys(shared).length) return;
  listContent(item.brandId)
    .filter((c) => c.mirrorGroupId === item.mirrorGroupId && c.id !== id)
    .forEach((c) => storeUpdateContent(c.id, shared));
}

// Same window.print()-based PDF trick as the Report Card, reusing its
// .report-sheet styling — just title/idea/script, nothing else, for handing
// a script to someone who doesn't need the whole app (an editor, a client).
function openScriptPdfPreview(content, brand) {
  const overlay = openModal({
    title: t("cr.pdf.title"),
    wide: true,
    bodyHTML: `<div class="report-preview-wrap"><div class="report-sheet" id="script-pdf-sheet">${scriptSheetHTML(content, brand)}</div></div>`,
    footHTML: `
      <button class="btn btn-secondary" id="script-pdf-print">${icon("layers", { size: 14 })}${t("cr.pdf.print")}</button>
      <button class="btn btn-primary" id="script-pdf-download">${icon("download", { size: 14 })}${t("cr.pdf.download")}</button>
    `,
  });
  const doPrint = () => window.print();
  overlay.querySelector("#script-pdf-print").addEventListener("click", doPrint);
  overlay.querySelector("#script-pdf-download").addEventListener("click", () => {
    toast(t("cr.pdf.saveHint"));
    setTimeout(doPrint, 400);
  });
}

function scriptSheetHTML(c, brand) {
  const section = (label, text) => `
    <div class="report-section-title">${label}</div>
    <p style="white-space:pre-wrap;font-size:13.5px;line-height:1.65;color:#33302c;margin:0 0 4px;">${escapeHtml(text) || "—"}</p>
  `;
  return `
    <div class="report-header">
      ${avatarHTML(brand || { name: "?" }, "width:44px;height:44px;border-radius:10px;font-size:16px;")}
      <div>
        <div class="report-brand">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="report-title">${escapeHtml(brand?.name || "")}</div>
      </div>
      <div class="report-range">
        <div class="report-generated">${t("cr.pdf.generated", { date: formatDate(new Date().toISOString()) })}</div>
      </div>
    </div>
    ${section(t("cr.pdf.idea"), c.idea)}
    ${section(t("cr.pdf.script"), c.script)}
    <div class="report-footer">Wepeka Brandlab — ${escapeHtml(brand?.name || "")}</div>
  `;
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

// Generates hooks, a HOOK/ISI PEMBAHASAN-format script, and a caption —
// onInsert receives { hook } / { script } / { caption } depending on which
// button was clicked, and the caller decides which field to drop it into.
// `val` is what goes into the AI prompt (unchanged); `label` is the chip text.
const DURATION_OPTIONS = [
  { val: "<1 menit", label: t("cr.ai.dur.lt1") },
  { val: "1:30 menit", label: t("cr.ai.dur.90s") },
  { val: "2 menit", label: t("cr.ai.dur.2m") },
  { val: ">2 menit", label: t("cr.ai.dur.gt2") },
  { val: "Custom", label: t("cr.ai.dur.custom") },
];

// lite: pass a field name ("script" or "caption") to show a stripped-down
// version — just the prompt box (pre-filled from that field) and Generate,
// skipping funnel/duration/goal/article. The results (hooks + script +
// caption, each with a Use button) are identical either way.
function openAiScriptModal(content, brand, onInsert, lite = null) {
  const ai = getSettings().ai || { provider: "anthropic" };
  const hasKey = hasAiKey(ai);
  const demo = isTourDemo(); // tur → contoh hasil, tanpa token (js/tour-demo.js)
  if (!hasKey && !demo) {
    toast(t("cr.ai.needKey"), "error");
    return;
  }

  const state = { funnel: content.funnel || "TOFU", duration: DURATION_OPTIONS[0].val };
  // #6/#7: once every field this modal is for has a "used" click (any
  // batch — Generate More gives independent alternatives, not a pipeline,
  // so a script from batch 1 + a caption from batch 2 still counts), the
  // panel closes itself. `lite` modals only care about their one field.
  const used = { script: false, caption: false };
  function maybeAutoClose() {
    const ready = lite ? !!used[lite] : used.script && used.caption;
    if (!ready) return;
    setTimeout(() => closeOverlay(overlay), 1400);
  }
  const prefill = lite ? content[lite] || content.idea || "" : content.idea || "";

  const overlay = openModal({
    title: lite ? t("cr.ai.quickTitle", { field: lite === "script" ? t("cr.f.script") : t("cr.f.caption") }) : t("cr.ai.title"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("cr.ai.contextNote", { brand: escapeHtml(brand?.name || t("cr.ai.thisBrand")) })}</p>

      <div class="field" style="margin-bottom:14px;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${lite ? t("cr.ai.promptLabelLite") : t("cr.ai.promptLabel")}</label>
          <button type="button" class="chip-icon-btn" id="ai-mic" aria-label="${t("cr.ai.voiceInput")}" title="${t("cr.ai.voiceTitle")}">${icon("mic", { size: 15 })}</button>
        </div>
        <textarea class="textarea" id="ai-prompt" style="min-height:70px;" placeholder="${t("cr.ai.promptPh")}">${escapeHtml(prefill)}</textarea>
      </div>

      ${
        lite
          ? ""
          : `
      <div class="field" style="margin-bottom:14px;">
        <label>${t("cr.ai.duration")}</label>
        <div class="chip-select" id="ai-duration-chips">
          ${DURATION_OPTIONS.map((d) => `<button type="button" data-val="${d.val}" class="${state.duration === d.val ? "active" : ""}">${d.label}</button>`).join("")}
        </div>
        <input class="input" id="ai-duration-custom" style="margin-top:8px;${state.duration === "Custom" ? "" : "display:none;"}" placeholder="${t("cr.ai.durationPh")}" />
      </div>`
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

  const micBtn = overlay.querySelector("#ai-mic");
  if (micBtn) wireMic(micBtn, overlay.querySelector("#ai-prompt"));

  const customDurationInput = overlay.querySelector("#ai-duration-custom");
  overlay.querySelectorAll("#ai-duration-chips button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.duration = btn.dataset.val;
      overlay.querySelectorAll("#ai-duration-chips button").forEach((b) => b.classList.toggle("active", b === btn));
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
      // Full brand context (DNA + personality + tone of voice + visual
      // guidelines + active campaigns) instead of just the legacy
      // aiVoiceGuide string — see ai.js buildFullContext.
      brandContext: brand ? buildFullContext(brand, { campaigns: listCampaigns(brand.id), pulseText: pulseTextFor(brand, { content: listContent(brand.id), campaigns: listCampaigns(brand.id), settings: getSettings() }) }) : "",
      // Series Context: only present when this piece is linked to a
      // recurring series (content.seriesId) — sits between brandContext and
      // the topic-specific fields below, same seam campaignLine already uses.
      seriesContext: linkedSeriesContext(),
      campaignLine: linkedCampaignLine(),
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
    return s ? buildSeriesContext(s) : "";
  }
  // The eval record keeps what the user asked for, not the (large,
  // reconstructible) brand context block.
  const feedbackPrompt = (p) => ({ ...p, brandContext: undefined, seriesContext: undefined });

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
      const { hooks, script, caption, slides = [] } = demo ? await demoGenerateScript(params) : await generateScript(ai, params);
      loadingEl.remove();
      batchCount++;
      const suffix = batchCount > 1 ? ` ${t("cr.ai.batch", { n: batchCount })}` : "";
      const batchEl = document.createElement("div");
      batchEl.className = "ai-batch";
      batchEl.innerHTML = `
        <div id="hooks-section"></div>
        <div id="script-section"></div>
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
      // instead of just piling up endlessly below. Nothing here is ever
      // persisted, so closing the modal drops every batch that wasn't used.
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
      if (caption && !demo) mountAiFeedback(batchEl.querySelector(".caption-feedback"), { brandId: brand?.id, feature: "creator-caption", prompt: feedbackPrompt(params), output: caption });

      // Hooks and script each get their own "Regenerate" — asking the AI to
      // redo a hook that isn't landing shouldn't also throw away a script
      // that's already fine, and vice versa.
      const eyebrowRegenBtn = (label) =>
        `<button type="button" class="icon-btn regen-btn" title="${label}" aria-label="${label}" style="width:22px;height:22px;">${icon("refresh", { size: 12 })}</button>`;

      function renderHooksSection(list, usedParams) {
        const el = batchEl.querySelector("#hooks-section");
        el.innerHTML = list.length
          ? `<div class="creator-field-head" style="margin-bottom:8px;">
               <div class="page-eyebrow" style="margin-bottom:0;">${t("cr.ai.hookOptions")}${suffix}</div>
               ${eyebrowRegenBtn(t("cr.ai.regenHooks"))}
             </div>
             ${list
               .map(
                 (h, i) => `
               <div class="card card-tight" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:10px;align-items:center;">
                 <span style="font-size:13px;">${escapeHtml(h)}</span>
                 <button type="button" class="btn btn-secondary btn-sm" data-insert-hook="${i}" style="flex:none;">${t("cr.ai.use")}</button>
               </div>`
               )
               .join("")}`
          : "";
        if (list.length && !demo) mountAiFeedback(el, { brandId: brand?.id, feature: "creator-hooks", prompt: feedbackPrompt(usedParams), output: list });
        const cards = el.querySelectorAll("[data-insert-hook]");
        cards.forEach((b) => {
          b.addEventListener("click", () => {
            onInsert({ hook: list[Number(b.dataset.insertHook)] });
            toast(t("cr.ai.hookInserted"));
            // Once one hook's picked, the other alternatives for that same
            // slot are moot — script/caption stay untouched, separate choices.
            cards.forEach((c) => c.closest(".card")?.remove());
          });
        });
        el.querySelector(".regen-btn")?.addEventListener("click", async () => {
          const regenBtn = el.querySelector(".regen-btn");
          regenBtn.disabled = true;
          try {
            const regenParams = genParams({ only: "hooks" });
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
      function renderScriptSection(text, usedParams, slides = []) {
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
          : `<div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(text)}</div>`;
        el.innerHTML = text
          ? `<div class="creator-field-head" style="margin:14px 0 8px;">
               <div class="page-eyebrow" style="margin-bottom:0;">${label}${suffix}</div>
               ${eyebrowRegenBtn(regenLabel)}
             </div>
             ${body}
             <button type="button" class="btn btn-primary btn-block use-script-btn">${useLabel}</button>`
          : "";
        if (text && !demo) mountAiFeedback(el, { brandId: brand?.id, feature: isCarousel ? "creator-carousel" : "creator-script", prompt: feedbackPrompt(usedParams), output: text });
        el.querySelector(".use-script-btn")?.addEventListener("click", (e) => {
          onInsert({ script: text, funnel: state.funnel });
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
            const regenParams = genParams({ only: "script" });
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
      loadingEl.outerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${e.message}</span></div>`;
    } finally {
      btn.disabled = false;
    }
  };
  overlay.querySelector("#ai-generate").addEventListener("click", runGenerate);
}

// Creator is the "what still needs to be made" workspace — once something
// is published, its script/caption/etc. move here only if you deep-link to
// it directly (e.g. from the "Edit in Creator" button on a published item);
// otherwise this list only shows what's still in progress, sorted so the
// most time-sensitive piece is first.
export function render(root, { brandId, initialContentId }) {
  const state = { selectedId: initialContentId || null, collapsedGroups: new Set() };
  // Konten Baru → the same content drawer every other screen uses; the
  // new piece is then selected here, opening straight on its drafting panel.
  state.startNewContent = (defaults = {}) =>
    openContentEditor({
      brandId,
      defaults: { status: "idea", ...defaults },
      onSaved: () => {
        const newest = [...listContent(brandId)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (newest) state.selectedId = newest.id;
        refresh();
      },
    });
  const paintNow = () => paint(root, brandId, state, refresh);
  // Arriving from a campaign ("Buka di Creator", "Konten baru"): select
  // that piece, or open the new-content picker with the campaign already
  // attached — never an empty Creator.
  const applyNavContext = (ctx) => {
    if (!ctx) return;
    if (ctx.contentId) state.selectedId = ctx.contentId;
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

  refresh();
  const unsubscribe = onChange(refresh);
  // Once per mount — paint() runs again on every db:change.
  startCreatorGuideOnMount(brandId);
  return () => {
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

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${getMode() === "guided" ? t("cr.eyebrowGuided") : "Creator Studio — Mission"}${helpButtonHTML("creator")}${guideVideoButtonHTML("creator")}</div>
        <h1>${brand.name}</h1>
      </div>
      <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("cr.newContent")}</button>
    </div>

    <div class="creator-layout">
      <div class="creator-sidebar">
        <div class="creator-sidebar-list">
          ${
            items.length
              ? groupedSidebarHTML(items, state.selectedId, state.collapsedGroups)
              : `<div class="table-empty" style="padding:32px 16px;">${t("cr.sidebarEmpty")}</div>`
          }
        </div>
      </div>
      <div class="creator-main">
        ${selected ? mainPanel(selected, campaigns, series) : emptyPanel()}
        <a class="link" href="#/brand/${brandId}/content/calendar" style="display:block;text-align:center;font-size:12.5px;margin-top:4px;">${icon("calendar", { size: 13 })} ${t("cr.openCalendar")}</a>
      </div>
    </div>
  `;

  wireHelpButtons(root);
  setPageGuide(() => startCreatorGuide(brandId));

  qs("#new-content").addEventListener("click", () => state.startNewContent());
  const emptyNewBtn = qs("#new-content-empty");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => state.startNewContent());

  qsa("[data-select]", root).forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.select;
      paint(root, brandId, state, refresh);
    });
  });

  qsa("[data-delete-content]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteContent;
      const item = getContent(id);
      const ok = await confirmDialog({
        title: t("cr.delete.title", { title: escapeHtml(item?.title || t("common.untitled")) }),
        message: t("common.noUndo"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      deleteContent(id);
      if (state.selectedId === id) state.selectedId = null;
      toast(t("cr.delete.done"));
      refresh();
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

  const fieldMap = { title: "f-title", idea: "f-idea", caption: "f-caption", script: "f-script", cta: "f-cta", reference: "f-reference", notes: "f-notes" };
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

  const tpBtn = qs("#open-teleprompter", root);
  if (tpBtn) {
    tpBtn.addEventListener("click", () => {
      const currentScript = qs("#f-script", root)?.value ?? selected.script;
      openTeleprompter(currentScript, { title: selected.title || t("common.untitled") });
    });
  }

  const openAiFor = () => {
    const current = {
      ...selected,
      idea: qs("#f-idea", root)?.value ?? selected.idea,
      title: qs("#f-title", root)?.value ?? selected.title,
    };
    openAiScriptModal(current, brand, ({ hook, script, caption, funnel }) => {
      if (caption !== undefined) {
        const captionEl = qs("#f-caption", root);
        if (!captionEl) return;
        captionEl.value = caption;
        updateContent(selected.id, { caption: captionEl.value });
      } else {
        const scriptEl = qs("#f-script", root);
        const current = scriptEl ? scriptEl.value : selected.script || "";
        const next = script ? script : hook + (current ? "\n\n" + current : "");
        if (scriptEl) scriptEl.value = next;
        updateContent(selected.id, { script: next, ...(funnel ? { funnel } : {}) });
        // A brand-new piece has no title yet — the chosen hook is a good
        // working title, so the sidebar doesn't fill up with t("common.untitled").
        const titleEl = qs("#f-title", root);
        if (titleEl && !titleEl.value.trim() && hook) {
          titleEl.value = hook.split("\n")[0].trim().slice(0, 80);
          updateContent(selected.id, { title: titleEl.value });
        }
        // Carousel view has slide cards instead of the textarea — repaint them.
        if (!scriptEl) refresh();
      }
      flashSaved();
    });
  };

  const aiBtn = qs("#ai-generate-all", root);
  if (aiBtn) aiBtn.addEventListener("click", openAiFor);

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
      ({ hook, script, caption, funnel }) => {
        if (caption !== undefined) {
          const captionEl = qs("#f-caption", root);
          if (!captionEl) return;
          captionEl.value = caption;
          updateContent(selected.id, { caption: captionEl.value });
        } else {
          const scriptEl = qs("#f-script", root);
          const current = scriptEl ? scriptEl.value : selected.script || "";
          const next = script ? script : hook + (current ? "\n\n" + current : "");
          if (scriptEl) scriptEl.value = next;
          updateContent(selected.id, { script: next, ...(funnel ? { funnel } : {}) });
          if (!scriptEl) refresh();
        }
        flashSaved();
      },
      field
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
      const uploadedPlatforms = {
        tiktok: !!qs("#uploaded-tiktok", root)?.checked,
        instagram: !!qs("#uploaded-instagram", root)?.checked,
      };
      if (!uploadedPlatforms.tiktok && !uploadedPlatforms.instagram) {
        toast(t("cr.pickPlatform"), "error");
        return;
      }
      updateContent(selected.id, {
        uploadedPlatforms,
        status: "published",
        publishedDate: selected.publishedDate || new Date().toISOString().slice(0, 10),
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
  const today = new Date().toISOString().slice(0, 10);
  if (c.scheduleDate < today) return `<span class="due-badge due-overdue">${t("cr.due.overdue")}</span>`;
  if (c.scheduleDate === today) return `<span class="due-badge due-today">${t("cr.due.today")}</span>`;
  return `<span class="due-badge due-soon">${t("cr.due.on", { date: formatDate(c.scheduleDate) })}</span>`;
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

function groupedSidebarHTML(items, selectedId, collapsedGroups) {
  return SIDEBAR_GROUPS.map((g) => ({ ...g, items: items.filter((c) => g.statuses.includes(c.status)) }))
    .filter((g) => g.items.length)
    .map((g) => {
      const collapsed = collapsedGroups.has(g.key);
      return `
    <div class="creator-sidebar-group ${collapsed ? "collapsed" : ""}">
      <button type="button" class="creator-sidebar-group-head" data-toggle-group="${g.key}">
        <span>${g.label} <span class="text-faint">${g.items.length}</span></span>
        ${icon("chevronDown", { size: 13, className: "creator-sidebar-group-chevron" })}
      </button>
      <div class="creator-sidebar-group-body">
        <div class="creator-sidebar-group-body-inner">
          ${g.items.map((c) => sidebarRow(c, c.id === selectedId)).join("")}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

// Deleting is only offered on undrafted-anywhere-else stuff (idea/draft) —
// once a piece has moved into production/editing/scheduled/published, it
// likely has real work (shots, edits, a real publish) riding on it, so
// removing it stays a content-list-only action (js/views/content-list.js's
// row menu, which also has Archive) rather than a one-click trash icon
// right in Creator's own sidebar.
function sidebarRow(c, active) {
  const deletable = c.status === "idea" || c.status === "draft";
  return `
    <div class="creator-item ${active ? "active" : ""}" data-select="${c.id}">
      <span class="status-pill status-${c.status}" style="padding:3px 8px;"><span class="status-dot"></span></span>
      <div class="ti">
        <div class="t">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(new Date(c.updatedAt))}</div>
      </div>
      ${dueBadge(c)}
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
  // Mission-ladder campaigns count every piece automatically — no phase to
  // pick, so the second select is only for phase-based campaigns.
  const showPhase = campaign && !campaign.autoLinkAllContent && campaign.phases?.length;
  return `
    <div class="field">
      <label>${guided ? t("cr.campaign.guidedLabel") : t("cr.campaign.label")}</label>
      <select class="select" id="f-campaign">
        <option value="">${guided ? t("cr.campaign.noneGuided") : t("cr.campaign.none")}</option>
        ${campaigns.map((camp) => `<option value="${camp.id}" ${c.campaignId === camp.id ? "selected" : ""}>${escapeHtml(camp.name)}</option>`).join("")}
      </select>
      ${
        showPhase
          ? `<select class="select" id="f-phase" style="margin-top:8px;">
               <option value="">${guided ? t("cr.phase.guided") : t("cr.phase.none")}</option>
               ${campaign.phases.map((p) => `<option value="${p.id}" ${c.campaignPhaseId === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
             </select>`
          : ""
      }
    </div>
  `;
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
      <label>${t("cr.series.label")}</label>
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

function phaseHead(c) {
  const back = PREV_STATUS[c.status]
    ? `<button type="button" class="btn btn-ghost btn-sm" id="stage-back">${icon("chevronLeft", { size: 13 })}${t("common.backTo", { label: statusLabel(PREV_STATUS[c.status], STATUS_LABELS) })}</button>`
    : "";
  return `
    <div class="creator-field-head" style="margin-bottom:18px;">
      <span class="status-pill status-${c.status}"><span class="status-dot"></span>${statusLabel(c.status, STATUS_LABELS)}</span>
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
      ${isCarouselContent(c) ? slidesReadHTML(c.script) : `<div class="stage-script-display">${escapeHtml(c.script || t("cr.noScript")).replace(/\n/g, "<br>")}</div>`}
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
        <label>${t("contentEditor.scheduleDate.label")}</label>
        <input class="input" type="date" id="f-schedule" value="${c.scheduleDate || ""}" min="${localISODate()}" />
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label>${t("cr.uploadedWhere")}</label>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <label class="checkbox-chip"><input type="checkbox" id="uploaded-tiktok" ${up.tiktok ? "checked" : ""} />${platformIcon("tiktok")}${t("cr.onTiktok")}</label>
          <label class="checkbox-chip"><input type="checkbox" id="uploaded-instagram" ${up.instagram ? "checked" : ""} />${platformIcon("instagram")}${t("cr.onInstagram")}</label>
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
const isCarouselContent = (c) => (c?.format || "").toLowerCase().includes("carousel");
const SLIDE_MARKER = /^\s*Slide\s+(\d+)\s*:?\s*$/i;

function parseSlides(script) {
  const text = (script || "").replace(/\r/g, "");
  if (!text.trim()) return [];
  const slides = [];
  let current = null;
  text.split("\n").forEach((line) => {
    if (SLIDE_MARKER.test(line)) {
      current = { text: "" };
      slides.push(current);
      return;
    }
    if (!current) {
      current = { text: "" };
      slides.push(current);
    }
    current.text += (current.text ? "\n" : "") + line;
  });
  return slides.map((s) => ({ text: s.text.replace(/^\n+|\n+$/g, "") }));
}
const serializeSlides = (slides) => slides.map((s, i) => `Slide ${i + 1}\n${(s.text || "").trim()}`).join("\n\n");

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
        <textarea class="textarea slide-text" data-slide-text="${i}" rows="2" placeholder="${escapeHtml(t("cr.f.slidePh"))}">${escapeHtml(s.text)}</textarea>
      </div>`
    )
    .join("");
  return `
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.slides")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="ai-quick-script" aria-label="${t("cr.f.quickScriptAria")}" title="${t("cr.f.quickCarouselTitle")}">${icon("bot", { size: 15 })}</button>
          </div>
        </div>
        <p class="text-faint" style="font-size:11.5px;margin:0 0 10px;">${t("cr.f.slidesHint")}</p>
        <div class="slide-editor" id="slide-editor">
          ${cards || `<p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${t("cr.f.slidesEmpty")}</p>`}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="slide-add">${icon("plus", { size: 13 })}${t("cr.f.addSlide")}</button>
      </div>`;
}

function slidesReadHTML(script) {
  const slides = parseSlides(script);
  if (!slides.length) return `<div class="stage-script-display">${escapeHtml(t("cr.noScript"))}</div>`;
  return `<div class="stage-script-display slide-read">${slides
    .map((s, i) => `<div class="slide-read-card"><span class="slide-num">${escapeHtml(t("cr.ai.slideLabel", { n: i + 1 }))}</span><div>${escapeHtml(s.text).replace(/\n/g, "<br>")}</div></div>`)
    .join("")}</div>`;
}

function draftingPanel(c, campaigns, series = []) {
  const publishedNote =
    c.status === "published"
      ? `<div class="hint" style="margin:0 0 16px;">${icon("info", { size: 12 })} ${t("cr.publishedNote")}</div>`
      : "";
  return `
    <div class="card glass-card">
      <button type="button" class="btn btn-primary btn-block" id="ai-generate-all">${icon("bot", { size: 15 })}${t("cr.aiAll")}</button>
      <p class="text-faint" style="font-size:11.5px;text-align:center;margin:6px 0 16px;">${icon("arrowUp", { size: 10 })} ${t("cr.aiAllHint")}</p>

      <div class="creator-field-head" style="margin-bottom:18px;">
        <span class="status-pill status-${c.status}"><span class="status-dot"></span>${statusLabel(c.status, STATUS_LABELS)}</span>
        <div class="flex items-center gap-8">
          <span class="save-indicator" id="save-indicator">${t("cr.saved")}</span>
          <button class="btn btn-ghost btn-sm" id="download-script-pdf">${icon("download", { size: 13 })}${t("cr.pdf.download")}</button>
        </div>
      </div>
      ${publishedNote}

      <div class="field">
        <label>${t("cr.f.title")}</label>
        <input class="input" id="f-title" value="${escapeHtml(c.title)}" placeholder="${t("cr.f.titlePh")}" />
      </div>
      <div class="field">
        <label>${t("cr.f.idea")}</label>
        <textarea class="textarea" id="f-idea" style="min-height:60px;" placeholder="${t("cr.f.ideaPh")}">${c.idea || ""}</textarea>
      </div>
      ${campaignFunnelFieldsHTML(c, campaigns, series)}
      ${isCarouselContent(c) ? slidesFieldHTML(c) : `<div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.script")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="ai-quick-script" aria-label="${t("cr.f.quickScriptAria")}" title="${t("cr.f.quickScriptTitle")}">${icon("bot", { size: 15 })}</button>
          </div>
        </div>
        <textarea class="textarea" id="f-script" style="min-height:220px;" placeholder="${t("cr.f.scriptPh")}">${c.script || ""}</textarea>
      </div>`}
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.caption")}</label>
          <button type="button" class="chip-icon-btn" id="ai-quick-caption" aria-label="${t("cr.f.quickCaptionAria")}" title="${t("cr.f.quickCaptionTitle")}">${icon("bot", { size: 15 })}</button>
        </div>
        <textarea class="textarea" id="f-caption" placeholder="${t("cr.f.captionPh")}">${c.caption || ""}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("cr.f.cta")}</label>
          <input class="input" id="f-cta" value="${escapeHtml(c.cta)}" placeholder="${t("cr.f.ctaPh")}" />
        </div>
        <div class="field">
          <label>${t("cr.f.reference")}</label>
          <input class="input" id="f-reference" value="${escapeHtml(c.reference)}" placeholder="${t("cr.f.referencePh")}" />
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>${t("cr.f.notes")}</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;">${c.notes || ""}</textarea>
      </div>
      ${stageProgressHTML(c)}
    </div>
  `;
}
