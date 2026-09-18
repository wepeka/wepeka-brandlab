import { getBrand, listContent, getContent, createContent, updateContent as storeUpdateContent, getSettings, onChange, listCampaigns, STATUS_LABELS, FUNNELS, localISODate } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { escapeHtml, formatDate, toast, avatarHTML, qs, qsa } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openTeleprompter } from "./teleprompter.js";
import { consumeNavContext } from "../nav-context.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { generateScript, generateThumbnail, AiApiError, hasAiKey, buildFullContext, buildBrandContext, campaignSummaryLine } from "../ai.js";
import { mountAiFeedback } from "../ai-feedback.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { getMode } from "../mode.js";
import { t } from "../i18n.js";
import { funnelFieldHTML, wireFunnelField, statusLabel } from "../funnel-field.js";
import { sectionGuideButtonHTML } from "../section-guide.js";
import { wireGuideButton } from "../guides/common.js";
import { startCreatorGuide, startCreatorGuideOnMount } from "../guides/creator-guide.js";
import { isTourDemo, demoGenerateScript, DEMO_TOAST } from "../tour-demo.js";
import { wireMic } from "../voice-input.js";

// Mirror twins (one idea posted to Instagram + TikTok, see
// openNewContentPlatformPicker) share their writing: whatever gets written
// on one — title, idea, script, caption, goal, campaign — is copied onto
// the other, so the TikTok half never sits blank. This used to happen only
// once, when the old edit drawer saved. Platform-specific fields (status,
// upload checkboxes, thumbnail) stay per record.
const MIRROR_SHARED_FIELDS = ["title", "idea", "script", "caption", "cta", "reference", "notes", "funnel", "campaignId", "campaignPhaseId"];
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
      ${funnelFieldHTML({ id: "ai-funnel", value: state.funnel, fieldStyle: "margin-bottom:14px;" })}
      <div class="field" style="margin-bottom:14px;" id="ai-funnel-followup"></div>
      ${
        // 6.1: Pemula gets prompt + funnel (+ its MOFU/BOFU follow-up) only
        // — Duration/Goal/Article are Pro-only detail fields from here on.
        // genParams() below already reads all three with `?.`, so leaving
        // them out of the DOM entirely (not just visually hidden) needs no
        // other change.
        getMode() !== "guided"
          ? `
      <div class="field" style="margin-bottom:14px;">
        <label>${t("cr.ai.duration")}</label>
        <div class="chip-select" id="ai-duration-chips">
          ${DURATION_OPTIONS.map((d) => `<button type="button" data-val="${d.val}" class="${state.duration === d.val ? "active" : ""}">${d.label}</button>`).join("")}
        </div>
        <input class="input" id="ai-duration-custom" style="margin-top:8px;${state.duration === "Custom" ? "" : "display:none;"}" placeholder="${t("cr.ai.durationPh")}" />
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label>${t("cr.ai.goal")}</label>
        <input class="input" id="ai-goal" placeholder="${t("cr.ai.goalPh")}" />
      </div>

      <div class="field" style="margin-bottom:14px;">
        <label>${t("cr.ai.article")}</label>
        <textarea class="textarea" id="ai-article" style="min-height:70px;" placeholder="${t("cr.ai.articlePh")}"></textarea>
      </div>`
          : ""
      }`
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

  function renderFunnelFollowup() {
    const el = overlay.querySelector("#ai-funnel-followup");
    if (!el) return;
    if (state.funnel === "MOFU") {
      el.innerHTML = `<label>${t("cr.ai.mofuLabel")}</label><input class="input" id="ai-mofu-goal" placeholder="${t("cr.ai.mofuPh")}" />`;
    } else if (state.funnel === "BOFU") {
      el.innerHTML = `<label>${t("cr.ai.bofuLabel")}</label><input class="input" id="ai-bofu-offer" placeholder="${t("cr.ai.bofuPh")}" />`;
    } else {
      el.innerHTML = "";
    }
  }
  renderFunnelFollowup();
  wireFunnelField(overlay, "ai-funnel", (funnel) => {
    state.funnel = funnel;
    renderFunnelFollowup();
  });

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
      goal: overlay.querySelector("#ai-goal")?.value.trim(),
      mofuGoal: overlay.querySelector("#ai-mofu-goal")?.value.trim(),
      bofuOffer: overlay.querySelector("#ai-bofu-offer")?.value.trim(),
      articleText: overlay.querySelector("#ai-article")?.value.trim(),
      // Full brand context (DNA + personality + tone of voice + visual
      // guidelines + active campaigns) instead of just the legacy
      // aiVoiceGuide string — see ai.js buildFullContext.
      brandContext: brand ? buildFullContext(brand, { campaigns: listCampaigns(brand.id) }) : "",
      campaignLine: linkedCampaignLine(),
      ...extra,
    };
  }

  function linkedCampaignLine() {
    if (!brand || !content.campaignId) return "";
    const c = listCampaigns(brand.id).find((x) => x.id === content.campaignId);
    return c ? campaignSummaryLine(c, brand) : "";
  }
  // The eval record keeps what the user asked for, not the (large,
  // reconstructible) brand context block.
  const feedbackPrompt = (p) => ({ ...p, brandContext: undefined });

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
      const { hooks, script, caption } = demo ? await demoGenerateScript(params) : await generateScript(ai, params);
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
      function renderScriptSection(text, usedParams) {
        const el = batchEl.querySelector("#script-section");
        el.innerHTML = text
          ? `<div class="creator-field-head" style="margin:14px 0 8px;">
               <div class="page-eyebrow" style="margin-bottom:0;">${t("cr.ai.fullScript")}${suffix}</div>
               ${eyebrowRegenBtn(t("cr.ai.regenScript"))}
             </div>
             <div class="card card-tight" style="white-space:pre-wrap;font-size:13px;margin-bottom:10px;">${escapeHtml(text)}</div>
             <button type="button" class="btn btn-primary btn-block use-script-btn">${t("cr.ai.useScript")}</button>`
          : "";
        if (text && !demo) mountAiFeedback(el, { brandId: brand?.id, feature: "creator-script", prompt: feedbackPrompt(usedParams), output: text });
        el.querySelector(".use-script-btn")?.addEventListener("click", (e) => {
          onInsert({ script: text, funnel: state.funnel });
          toast(t("cr.ai.scriptInserted"));
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
            const { script: newScript } = demo ? await demoGenerateScript(regenParams) : await generateScript(ai, regenParams);
            renderScriptSection(newScript, regenParams);
          } catch (e) {
            toast(e instanceof AiApiError ? e.message : t("cr.ai.regenScriptFail"), "error");
            regenBtn.disabled = false;
          }
        });
      }
      renderHooksSection(hooks, params);
      renderScriptSection(script, params);

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
// Asked once, right before the blank editor opens — which platform is this
// for? "Mirror" is the one case that isn't just a pre-filled field: it
// creates two linked content records (Instagram + TikTok) up front from the
// same idea, sharing a mirrorGroupId, instead of making the user duplicate
// the piece by hand after the fact.
function openNewContentPlatformPicker({ brandId, onCreated, defaults = {} }) {
  const overlay = openModal({
    title: t("cr.picker.title"),
    bodyHTML: `
      <div class="content-view-grid">
        <button type="button" class="content-view-card" data-platform-pick="Instagram">
          <div class="icon-wrap">${platformIcon("instagram")}</div>
          <h3>Instagram</h3>
          <p>${t("cr.picker.igDesc")}</p>
        </button>
        <button type="button" class="content-view-card" data-platform-pick="TikTok">
          <div class="icon-wrap">${platformIcon("tiktok")}</div>
          <h3>TikTok</h3>
          <p>${t("cr.picker.ttDesc")}</p>
        </button>
        <button type="button" class="content-view-card" data-platform-pick="mirror">
          <div class="icon-wrap">${icon("layers", { size: 20 })}</div>
          <h3>${t("cr.picker.mirror")}</h3>
          <p>${t("cr.picker.mirrorDesc")}</p>
        </button>
      </div>
    `,
  });
  qsa("[data-platform-pick]", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      closeOverlay(overlay);
      const pick = btn.dataset.platformPick;
      // No edit drawer any more: the piece is created right away and Creator
      // opens the AI hook/script/caption generator on it (see paint()) —
      // people didn't know what to do with a blank form. The full edit
      // drawer is still reachable from published content in the Konten tab.
      if (pick === "mirror") {
        const mirrorGroupId = `mirror-${Date.now()}`;
        const igItem = createContent(brandId, { ...defaults, platform: "Instagram", mirrorGroupId, status: "idea" });
        createContent(brandId, { ...defaults, platform: "TikTok", mirrorGroupId, status: "idea" });
        toast(t("cr.picker.mirrorCreated"));
        onCreated?.(igItem.id);
      } else {
        const item = createContent(brandId, { ...defaults, platform: pick, status: "idea" });
        onCreated?.(item.id);
      }
    });
  });
}

export function render(root, { brandId, initialContentId }) {
  const state = { selectedId: initialContentId || null, collapsedGroups: new Set(), openAiFor: null };
  // Konten Baru → pick platform → content is created, selected, and the AI
  // generator opens on it straight away (paint() handles state.openAiFor).
  state.startNewContent = (defaults = {}) =>
    openNewContentPlatformPicker({
      brandId,
      defaults,
      onCreated: (id) => {
        state.selectedId = id;
        state.openAiFor = id;
        toast(t("creator.newContentAi"));
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
        <div class="page-eyebrow flex items-center gap-6">${getMode() === "guided" ? t("cr.eyebrowGuided") : "Creator Studio — Mission"}${helpButtonHTML("creator")}${sectionGuideButtonHTML("creator")}</div>
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
        ${selected ? mainPanel(selected, campaigns) : emptyPanel()}
        <a class="link" href="#/brand/${brandId}/content-os/calendar" style="display:block;text-align:center;font-size:12.5px;margin-top:4px;">${icon("calendar", { size: 13 })} ${t("cr.openCalendar")}</a>
      </div>
    </div>
  `;

  wireHelpButtons(root);
  wireGuideButton(root, "creator", () => startCreatorGuide(brandId));

  qs("#new-content").addEventListener("click", () => state.startNewContent());
  const emptyNewBtn = qs("#new-content-empty");
  if (emptyNewBtn) emptyNewBtn.addEventListener("click", () => state.startNewContent());

  qsa("[data-select]", root).forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.select;
      paint(root, brandId, state, refresh);
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

  qs("#f-campaign", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { campaignId: e.target.value, campaignPhaseId: "" });
    flashSaved();
    refresh();
  });
  qs("#f-phase", root)?.addEventListener("change", (e) => {
    updateContent(selected.id, { campaignPhaseId: e.target.value });
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
        if (!scriptEl) return;
        scriptEl.value = script ? script : hook + (scriptEl.value ? "\n\n" + scriptEl.value : "");
        updateContent(selected.id, { script: scriptEl.value, ...(funnel ? { funnel } : {}) });
        // A brand-new piece has no title yet — the chosen hook is a good
        // working title, so the sidebar doesn't fill up with t("common.untitled").
        const titleEl = qs("#f-title", root);
        if (titleEl && !titleEl.value.trim() && hook) {
          titleEl.value = hook.split("\n")[0].trim().slice(0, 80);
          updateContent(selected.id, { title: titleEl.value });
        }
      }
      flashSaved();
    });
  };

  const aiBtn = qs("#ai-generate-all", root);
  if (aiBtn) aiBtn.addEventListener("click", openAiFor);
  if (state.openAiFor && state.openAiFor === selected.id) {
    state.openAiFor = null;
    if (aiBtn) setTimeout(openAiFor, 0);
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
      ({ hook, script, caption, funnel }) => {
        if (caption !== undefined) {
          const captionEl = qs("#f-caption", root);
          if (!captionEl) return;
          captionEl.value = caption;
          updateContent(selected.id, { caption: captionEl.value });
        } else {
          const scriptEl = qs("#f-script", root);
          if (!scriptEl) return;
          scriptEl.value = script ? script : hook + (scriptEl.value ? "\n\n" + scriptEl.value : "");
          updateContent(selected.id, { script: scriptEl.value, ...(funnel ? { funnel } : {}) });
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

  const aiThumbGenReady = qs("#ai-thumb-gen-ready", root);
  if (aiThumbGenReady) {
    aiThumbGenReady.addEventListener("click", async () => {
      const ai = getSettings().ai || {};
      const statusEl = qs("#ready-thumb-status", root);
      if (ai.provider !== "gemini" || !ai.geminiApiKey) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${t("cr.thumb.needGemini")}</span></div>`;
        return;
      }
      aiThumbGenReady.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("cr.thumb.generating")}</span></div>`;
      try {
        const dataUrl = await generateThumbnail(ai, {
          title: selected.title,
          idea: selected.idea,
          brandGuidelines: buildBrandContext(brand),
          logoDataUrl: brand?.logoAssets?.[0]?.dataUrl,
        });
        updateContent(selected.id, { thumbnail: dataUrl });
        const img = qs("#ready-thumb-img", root);
        if (img) {
          img.src = dataUrl;
          img.style.display = "block";
        }
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>${t("cr.thumb.done")}</span></div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${escapeHtml(err.message || t("cr.thumb.fail"))}${/quota|billing|429/i.test(err.message || "") ? ` ${t("cr.thumb.billing")}` : ""}</span></div>`;
      } finally {
        aiThumbGenReady.disabled = false;
      }
    });
  }

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

function sidebarRow(c, active) {
  return `
    <div class="creator-item ${active ? "active" : ""}" data-select="${c.id}">
      <span class="status-pill status-${c.status}" style="padding:3px 8px;"><span class="status-dot"></span></span>
      <div class="ti">
        <div class="t">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(new Date(c.updatedAt))}</div>
      </div>
      ${dueBadge(c)}
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
function mainPanel(c, campaigns) {
  if (c.status === "production") return executionPanel(c);
  if (c.status === "editing") return editingPanel(c);
  if (c.status === "scheduled") return readyToUploadPanel(c);
  return draftingPanel(c, campaigns);
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

// Advanced mode keeps the compact TOFU/MOFU/BOFU chip row. Guided mode swaps
// the jargon for a plain question — same underlying funnel value either way,
// just asked as "what's this for" instead of assuming the acronyms mean
// anything to someone new to marketing funnels. Needs its own full-width row
// (the description text doesn't fit next to Campaign), so guided and
// advanced get different layouts around the same two fields.
function campaignFunnelFieldsHTML(c, campaigns) {
  const guided = getMode() === "guided";
  if (guided) {
    return `
      ${campaignFieldHTML(c, campaigns)}
      <div id="funnel-goal-wrap">${funnelGoalFieldHTML(c)}</div>
    `;
  }
  return `
    <div class="row-2">
      ${campaignFieldHTML(c, campaigns)}
      ${funnelFieldHTML({ id: "f-funnel-picker", value: c.funnel })}
    </div>
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
      <div class="stage-script-display">${escapeHtml(c.script || t("cr.noScript")).replace(/\n/g, "<br>")}</div>
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
  // 6.4: same gate as content-editor.js's #ai-thumb-gen — the button
  // always failed without a Gemini key configured.
  const ai = getSettings().ai || {};
  const canGenThumb = ai.provider === "gemini" && !!ai.geminiApiKey;
  return `
    <div class="card glass-card">
      ${phaseHead(c)}
      <div class="page-eyebrow" style="margin-bottom:16px;">${escapeHtml(c.title || t("common.untitled"))}</div>

      <div class="field" style="margin-bottom:6px;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.thumbnail")}</label>
          ${canGenThumb ? `<button type="button" class="chip-icon-btn" id="ai-thumb-gen-ready" aria-label="${t("cr.thumb.aria")}" title="${t("cr.thumb.aria")}">${icon("bot", { size: 15 })}</button>` : ""}
        </div>
        ${c.thumbnail ? `<img class="thumb-preview" id="ready-thumb-img" src="${c.thumbnail}" />` : `<img class="thumb-preview" id="ready-thumb-img" style="display:none;" />`}
        <div id="ready-thumb-status" style="margin-top:6px;"></div>
      </div>

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

function draftingPanel(c, campaigns) {
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
      ${campaignFunnelFieldsHTML(c, campaigns)}
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("cr.f.script")}</label>
          <div class="flex items-center gap-6">
            <button type="button" class="chip-icon-btn" id="ai-quick-script" aria-label="${t("cr.f.quickScriptAria")}" title="${t("cr.f.quickScriptTitle")}">${icon("bot", { size: 15 })}</button>
          </div>
        </div>
        <textarea class="textarea" id="f-script" style="min-height:220px;" placeholder="${t("cr.f.scriptPh")}">${c.script || ""}</textarea>
        <button type="button" class="tp-cta" id="open-teleprompter">${icon("teleprompter", { size: 20 })}<span>${t("creator.teleprompterCta")}<small>${t("creator.teleprompterHint")}</small></span>${icon("arrowRight", { size: 14 })}</button>
      </div>
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
