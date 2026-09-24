import { getContent, createContent, updateContent, getSettings, getBrand, localISODate, resolveContentBuckets, listCampaigns, listContent, campaignPhaseContentCounts, listSeries, STATUSES, STATUS_LABELS } from "../store.js";
import { icon } from "../icons.js";
import { openDrawer, closeOverlay, confirmDialog } from "../modals.js";
import { toast, escapeHtml, qs, qsa, formatNumber } from "../dom.js";
import { contentSalesStats } from "../sales-tracker.js";
import { classifyFunnel, suggestCampaignFit, hasAiKey } from "../ai.js";
import { t } from "../i18n.js";
import { getMode } from "../mode.js";
import { funnelFieldHTML, wireFunnelField, setFunnelFieldValue, statusLabel } from "../funnel-field.js";

// The content drawer: what a piece IS (title, idea, platform, campaign,
// goal) and WHEN it goes out (status, dates, link). Only the title is
// required. Writing the piece (script, caption, thumbnail) happens in
// Creator Studio; filling in how it performed happens in Quick Fill on the
// content list — this drawer never touches either, so nothing is edited
// from two places at once.
export function openContentEditor({ brandId, contentId = null, defaults = {}, onSaved }) {
  const settings = getSettings();
  const existing = contentId ? getContent(contentId) : null;
  const draft = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        title: "", idea: "", format: settings.formats[0]?.name || "", platform: settings.platforms[0]?.name || "",
        campaignId: "", campaignPhaseId: "",
        funnel: "TOFU", status: "idea", scheduleDate: "", publishedDate: "", publishedUrl: "",
        script: "", caption: "", reference: "", cta: "", notes: "", thumbnail: "",
        performanceByPlatform: { instagram: {}, facebook: {} },
        performance: { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, profileVisits: null, followersGained: null, insightScreenshot: "", confirmedAt: null },
        adsPerformance: null,
        ...defaults,
      };
  if (draft.campaignId === undefined) draft.campaignId = "";
  if (draft.campaignPhaseId === undefined) draft.campaignPhaseId = "";
  if (draft.seriesId === undefined) draft.seriesId = "";

  const brand = getBrand(brandId);
  const campaigns = listCampaigns(brandId);
  const series = listSeries(brandId);

  const overlay = openDrawer({
    title: existing ? t("contentEditor.editTitle") : t("contentEditor.newTitle"),
    bodyHTML: bodyTemplate(draft, settings, campaigns, series),
    footHTML: `
      <div class="flex items-center gap-8">
        ${existing ? `<button class="btn btn-ghost btn-sm" data-archive>${icon("archive", { size: 14 })}${existing.archived ? t("contentEditor.unarchive") : t("contentEditor.archive")}</button>` : ""}
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" data-cancel>${t("contentEditor.cancel")}</button>
        <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}${t("contentEditor.save")}</button>
      </div>
    `,
    onMount: (el) => wire(el, draft, settings, brandId, contentId, onSaved, brand, campaigns),
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
}

// Sales the owner tagged with this post when logging them (Sales Tracker's
// "Dari mana penjualan ini?"). Nothing when there are none.
function salesLineHTML(draft) {
  if (!draft.id || !draft.brandId) return "";
  const s = contentSalesStats(getBrand(draft.brandId), draft.id);
  if (!s.count) return "";
  return `<div class="st-source-line">${icon("target", { size: 13 })}<span>${t("sales.source.contentLine", { qty: formatNumber(s.qty), revenue: `Rp ${formatNumber(Math.round(s.revenue))}`, count: s.count })}</span></div>`;
}

function statusPill(status) {
  return `<span class="status-pill status-${status}"><span class="status-dot"></span>${statusLabel(status, STATUS_LABELS)}</span>`;
}
// Guided mode reads the funnel tag as the plain-language goal ("Ngenalin
// brand ke orang baru") instead of the acronym.
function funnelTag(funnel) {
  const label = getMode() === "guided" ? t(`creator.funnel.guided.${funnel}.title`) : funnel;
  return `<span class="tag tag-${funnel.toLowerCase()}">${label}</span>`;
}

function bodyTemplate(draft, settings, campaigns, series = []) {
  const buckets = resolveContentBuckets(settings);
  return `
    <div class="editor-tabs">
      <div class="editor-tab active" data-tab="basic">${t("contentEditor.tab.basic")}</div>
      <div class="editor-tab" data-tab="schedule">${t("contentEditor.tab.schedule")}</div>
    </div>

    <div class="flex items-center gap-8" style="margin-bottom:20px;" id="status-row">
      ${statusPill(draft.status)}${funnelTag(draft.funnel)}
    </div>
    ${salesLineHTML(draft)}

    <div class="editor-pane active" data-pane="basic">
      <div class="field">
        <label>${t("contentEditor.title.label")}</label>
        <input class="input" id="f-title" placeholder="${t("contentEditor.title.placeholder")}" value="${attr(draft.title)}" />
      </div>
      <div class="field">
        <label>${t("contentEditor.idea.label")}</label>
        <textarea class="textarea" id="f-idea" placeholder="${t("contentEditor.idea.placeholder")}">${draft.idea || ""}</textarea>
      </div>
      <div class="field">
        <label>${t("contentEditor.contentFor.label")}</label>
        <div class="chip-select" id="f-quickpick">
          <button type="button" data-quickpick="reels" ${buckets.reels ? "" : "disabled"} class="${quickPickActive(draft, buckets.reels) ? "active" : ""}">${t("contentEditor.quickpick.reels")}</button>
          <button type="button" data-quickpick="tiktok" ${buckets.tiktok ? "" : "disabled"} class="${quickPickActive(draft, buckets.tiktok) ? "active" : ""}">${t("contentEditor.quickpick.tiktok")}</button>
        </div>
        <div class="text-faint" style="font-size:11px;margin-top:6px;">${t("contentEditor.quickpick.hint")}</div>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("contentEditor.platform.label")}</label>
          <select class="select" id="f-platform">
            ${settings.platforms.map((p) => `<option value="${p.name}" ${draft.platform === p.name ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>${t("contentEditor.format.label")}</label>
          <select class="select" id="f-format">
            ${settings.formats.map((f) => `<option value="${f.name}" ${draft.format === f.name ? "selected" : ""}>${f.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${getMode() === "guided" ? t("cnt.editor.guidedCampaignLabel") : t("contentEditor.campaign.label")}</label>
          <button type="button" class="chip-icon-btn" id="ai-suggest-campaign" aria-label="${t("contentEditor.campaign.aiSuggest")}" title="${campaigns.length ? t("contentEditor.campaign.aiSuggest") : t("contentEditor.campaign.aiSuggestDisabled")}" ${campaigns.length ? "" : "disabled"}>${icon("bot", { size: 14 })}</button>
        </div>
        <select class="select" id="f-campaign">
          <option value="">${t("contentEditor.campaign.none")}</option>
          ${campaigns.map((c) => `<option value="${c.id}" ${draft.campaignId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        <div id="phase-select-wrap">${phaseSelectHTML(campaigns, draft)}</div>
        ${!campaigns.length ? `<div class="text-faint" style="font-size:11px;margin-top:6px;">${t("contentEditor.campaign.noneYet")}</div>` : ""}
        <div id="ai-campaign-status" style="margin-top:6px;"></div>
      </div>
      ${
        series.length
          ? `<div class="field">
               <label>${t("contentEditor.series.label")}</label>
               <select class="select" id="f-series">
                 <option value="">${t("contentEditor.series.none")}</option>
                 ${series.map((s) => `<option value="${s.id}" ${draft.seriesId === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
               </select>
               <div class="text-faint" style="font-size:11px;margin-top:6px;">${t("contentEditor.series.hint")}</div>
             </div>`
          : ""
      }
      ${funnelFieldHTML({
        id: "f-funnel",
        value: draft.funnel,
        extraHead: `<button type="button" class="chip-icon-btn" id="ai-detect-funnel" aria-label="${t("contentEditor.funnel.aiDetect")}" title="${t("contentEditor.funnel.aiDetect")}">${icon("bot", { size: 14 })}</button>`,
      })}
      <div id="ai-funnel-status" style="margin:-10px 0 0;"></div>
    </div>

    <div class="editor-pane" data-pane="schedule">
      <div class="field">
        <label>${getMode() === "guided" ? t("cnt.editor.guidedStatusLabel") : t("contentEditor.status.label")}</label>
        <select class="select" id="f-status">
          ${STATUSES.map((s) => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${statusLabel(s, STATUS_LABELS)}</option>`).join("")}
        </select>
      </div>
      <div class="row-2">
        <div class="field">
          <label>${t("contentEditor.scheduleDate.label")}</label>
          <input class="input" type="date" id="f-schedule" value="${draft.scheduleDate || ""}" ${draft.status === "published" ? "" : `min="${localISODate()}"`} />
        </div>
        <div class="field">
          <label>${t("contentEditor.publishedDate.label")}</label>
          <input class="input" type="date" id="f-published" value="${draft.publishedDate || ""}" />
        </div>
      </div>
      <details class="dna-extras" ${draft.publishedUrl ? "open" : ""}>
        <summary>${t("contentEditor.advanced")}</summary>
        <div class="field" style="margin:10px 0 0;">
          <label>${t("contentEditor.publishedUrl.label")}</label>
          <input class="input" id="f-url" placeholder="https://..." value="${attr(draft.publishedUrl)}" />
          <div class="hint" style="margin-top:8px;">${icon("info", { size: 12 })} ${t("contentEditor.publishedUrl.hint")}</div>
        </div>
      </details>
    </div>
  `;
}

function attr(v) {
  return (v || "").replace(/"/g, "&quot;");
}

// Only meaningful once a campaign is chosen — that campaign's own phases,
// re-rendered whenever the Campaign select changes so it never shows a
// phase from a different campaign.
function phaseSelectHTML(campaigns, draft) {
  const campaign = campaigns.find((c) => c.id === draft.campaignId);
  // Mission-ladder campaigns count every piece automatically — no phase to pick.
  if (!campaign || campaign.autoLinkAllContent || !campaign.phases?.length) return "";
  return `
    <select class="select" id="f-phase" style="margin-top:8px;">
      <option value="">${t("contentEditor.phase.none")}</option>
      ${campaign.phases.map((p) => `<option value="${p.id}" ${draft.campaignPhaseId === p.id ? "selected" : ""}>${p.name}</option>`).join("")}
    </select>
  `;
}

function quickPickActive(draft, combo) {
  return !!combo && draft.platform === combo.platform && draft.format === combo.format;
}

function wire(el, draft, settings, brandId, contentId, onSaved, brand, campaigns) {
  // tabs
  qsa(".editor-tab", el).forEach((tab) => {
    tab.addEventListener("click", () => {
      qsa(".editor-tab", el).forEach((t) => t.classList.remove("active"));
      qsa(".editor-pane", el).forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      el.querySelector(`[data-pane="${tab.dataset.tab}"]`).classList.add("active");
    });
  });

  function wirePhaseSelect() {
    qs("#f-phase", el)?.addEventListener("change", (e) => {
      draft.campaignPhaseId = e.target.value;
    });
  }
  function refreshPhaseSelect() {
    qs("#phase-select-wrap", el).innerHTML = phaseSelectHTML(campaigns, draft);
    wirePhaseSelect();
  }
  wirePhaseSelect();

  qs("#f-campaign", el).addEventListener("change", (e) => {
    draft.campaignId = e.target.value;
    draft.campaignPhaseId = "";
    refreshPhaseSelect();
  });

  qs("#f-series", el)?.addEventListener("change", (e) => {
    draft.seriesId = e.target.value;
  });

  const suggestCampaignBtn = qs("#ai-suggest-campaign", el);
  if (suggestCampaignBtn) {
    suggestCampaignBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-campaign-status", el);
      if (!hasAiKey(ai)) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("contentEditor.ai.needsKey")}</div>`;
        return;
      }
      suggestCampaignBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ai.thinking")}</span></div>`;
      try {
        // Phase counts are computed fresh so the AI can prefer whichever
        // phase is still empty over one that's already full.
        const allContent = listContent(brandId);
        const campaignsWithCoverage = campaigns.map((c) => ({ ...c, phaseCounts: campaignPhaseContentCounts(c, allContent) }));
        const suggestion = await suggestCampaignFit(ai, {
          brand,
          campaigns: campaignsWithCoverage,
          idea: qs("#f-idea", el)?.value ?? draft.idea,
          title: qs("#f-title", el)?.value ?? draft.title,
        });
        const suggestedCampaign = campaigns.find((c) => c.id === suggestion.campaignId);
        const suggestedPhase = suggestedCampaign?.phases.find((p) => p.id === suggestion.phaseId);
        statusEl.innerHTML = suggestion.campaignId
          ? `<div class="ocr-status" style="flex-direction:column;align-items:flex-start;gap:4px;">
               ${icon("check", { size: 14 })}<strong style="font-size:12.5px;">${t("contentEditor.ai.suggested", { campaign: escapeHtml(suggestedCampaign?.name || "") + (suggestedPhase ? ` — ${escapeHtml(suggestedPhase.name)}` : "") })}</strong>
               ${suggestion.angle ? `<span style="font-size:12px;">${t("contentEditor.ai.angle", { angle: escapeHtml(suggestion.angle) })}</span>` : ""}
               ${suggestion.rationale ? `<span class="text-faint" style="font-size:11.5px;">${escapeHtml(suggestion.rationale)}</span>` : ""}
               <button type="button" class="btn btn-secondary btn-sm" id="apply-campaign-suggestion" style="margin-top:4px;">${t("contentEditor.ai.useThisCampaign")}</button>
             </div>`
          : `<div class="ocr-status">${icon("info", { size: 14 })}<span>${suggestion.rationale || t("contentEditor.ai.noCampaignFit")}</span></div>`;
        qs("#apply-campaign-suggestion", el)?.addEventListener("click", () => {
          draft.campaignId = suggestion.campaignId;
          draft.campaignPhaseId = suggestion.phaseId || "";
          qs("#f-campaign", el).value = suggestion.campaignId;
          refreshPhaseSelect();
          toast(t("contentEditor.ai.campaignApplied"));
        });
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e.message}</span></div>`;
      } finally {
        suggestCampaignBtn.disabled = false;
      }
    });
  }

  // funnel picker (shared component — chips in Advanced, plain question in Guided)
  wireFunnelField(el, "f-funnel", (funnel) => {
    draft.funnel = funnel;
    updateStatusRow();
  });

  const detectFunnelBtn = qs("#ai-detect-funnel", el);
  if (detectFunnelBtn) {
    detectFunnelBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-funnel-status", el);
      if (!hasAiKey(ai)) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("contentEditor.ai.needsKey")}</div>`;
        return;
      }
      detectFunnelBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ai.detecting")}</span></div>`;
      try {
        const funnel = await classifyFunnel(ai, {
          caption: draft.caption,
          idea: qs("#f-idea", el)?.value ?? draft.idea,
          title: qs("#f-title", el)?.value ?? draft.title,
        });
        draft.funnel = funnel;
        setFunnelFieldValue(el, "f-funnel", funnel);
        updateStatusRow();
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 14 })}<span>${t("contentEditor.ai.detected", { funnel })}</span></div>`;
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e.message}</span></div>`;
      } finally {
        detectFunnelBtn.disabled = false;
      }
    });
  }

  qs("#f-status", el).addEventListener("change", (e) => {
    draft.status = e.target.value;
    updateStatusRow();
  });

  function updateStatusRow() {
    qs("#status-row", el).innerHTML = `${statusPill(draft.status)}${funnelTag(draft.funnel)}`;
  }

  // Platform quick-pick ↔ the raw platform/format dropdowns stay in sync.
  const buckets = resolveContentBuckets(settings);
  function syncQuickPick() {
    draft.platform = qs("#f-platform", el).value;
    draft.format = qs("#f-format", el).value;
    qsa("#f-quickpick button", el).forEach((btn) => {
      const combo = btn.dataset.quickpick === "reels" ? buckets.reels : buckets.tiktok;
      btn.classList.toggle("active", quickPickActive(draft, combo));
    });
  }
  qs("#f-platform", el).addEventListener("change", syncQuickPick);
  qs("#f-format", el).addEventListener("change", syncQuickPick);
  qsa("[data-quickpick]", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      const combo = btn.dataset.quickpick === "reels" ? buckets.reels : buckets.tiktok;
      if (!combo) return;
      qs("#f-platform", el).value = combo.platform;
      qs("#f-format", el).value = combo.format;
      syncQuickPick();
    });
  });

  // archive
  const archiveBtn = qs("[data-archive]", el.closest(".overlay"));
  if (archiveBtn) {
    archiveBtn.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: draft.archived ? t("contentEditor.archive.unarchiveTitle") : t("contentEditor.archive.archiveTitle"),
        message: draft.archived ? t("contentEditor.archive.unarchiveMessage") : t("contentEditor.archive.archiveMessage"),
        confirmLabel: draft.archived ? t("contentEditor.unarchive") : t("contentEditor.archive"),
      });
      if (!ok) return;
      updateContent(contentId, { archived: !draft.archived });
      toast(draft.archived ? t("contentEditor.archive.restored") : t("contentEditor.archive.archived"));
      closeOverlay(el.closest(".overlay"));
      onSaved?.();
    });
  }

  // save — only the fields this drawer shows; script/caption/performance
  // belong to Creator and Quick Fill and are left exactly as they are.
  el.closest(".overlay").querySelector("[data-save]").addEventListener("click", () => {
    const title = qs("#f-title", el).value.trim();
    if (!title) {
      toast(t("contentEditor.needTitle"), "error");
      qs("#f-title", el).focus();
      return;
    }
    // Same rule as the calendar: a new schedule can't be in the past. An
    // unchanged old date (e.g. editing an overdue piece's idea) is left alone.
    const scheduleValue = qs("#f-schedule", el).value;
    if (scheduleValue && scheduleValue < localISODate() && scheduleValue !== (draft.scheduleDate || "") && qs("#f-status", el).value !== "published") {
      toast(t("calendar.pastDate"), "error");
      qs("#f-schedule", el).focus();
      return;
    }
    const patch = {
      title,
      idea: qs("#f-idea", el).value,
      campaignId: draft.campaignId || "",
      campaignPhaseId: draft.campaignPhaseId || "",
      seriesId: draft.seriesId || "",
      platform: qs("#f-platform", el).value,
      format: qs("#f-format", el).value,
      funnel: draft.funnel,
      status: qs("#f-status", el).value,
      scheduleDate: qs("#f-schedule", el).value,
      publishedDate: qs("#f-published", el).value,
      publishedUrl: qs("#f-url", el).value.trim(),
    };

    if (contentId) {
      updateContent(contentId, patch);
      toast(t("contentEditor.updated"));
    } else {
      createContent(brandId, { ...draft, ...patch });
      toast(t("contentEditor.created"));
    }
    closeOverlay(el.closest(".overlay"));
    onSaved?.();
  });
}
