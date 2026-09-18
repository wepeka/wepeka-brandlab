import { getContent, createContent, updateContent, getSettings, getBrand, localISODate, combinePlatformMetrics, resolveContentBuckets, listCampaigns, listContent, campaignPhaseContentCounts, METRIC_KEYS, STATUSES, STATUS_LABELS, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon, platformIcon } from "../icons.js";
import { openDrawer, closeOverlay, confirmDialog } from "../modals.js";
import { toast, formatPercent, formatNumber, resizeImageFile, escapeHtml, qs, qsa } from "../dom.js";
import { analyzeScreenshot } from "../ocr.js";
import { findMediaByPermalink, fetchMediaMetrics } from "../instagram.js";
import { canUseInstagramApi } from "../account.js";
import { findAdsForPost, fetchAdInsights } from "../ads.js";
import { generateThumbnail, classifyFunnel, suggestCampaignFit, hasAiKey } from "../ai.js";
import { t } from "../i18n.js";
import { howToHTML } from "../howto.js";
import { getMode } from "../mode.js";
import { funnelFieldHTML, wireFunnelField, setFunnelFieldValue, statusLabel } from "../funnel-field.js";

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
  if (!draft.performanceByPlatform) draft.performanceByPlatform = { instagram: {}, facebook: {} };
  if (draft.campaignId === undefined) draft.campaignId = "";
  if (draft.campaignPhaseId === undefined) draft.campaignPhaseId = "";

  const brand = getBrand(brandId);
  const igConfig = brand?.instagram || { accessToken: "", igUserId: "" };
  const fbConfig = brand?.facebook || { pageId: "", pageAccessToken: "" };
  const adsConfig = brand?.ads || { adAccountId: "", adsAccessToken: "" };
  const campaigns = listCampaigns(brandId);

  const overlay = openDrawer({
    title: existing ? t("contentEditor.editTitle") : t("contentEditor.newTitle"),
    bodyHTML: bodyTemplate(draft, settings, igConfig, fbConfig, adsConfig, campaigns),
    footHTML: `
      <div class="flex items-center gap-8">
        ${existing ? `<button class="btn btn-ghost btn-sm" data-archive>${icon("archive", { size: 14 })}${existing.archived ? t("contentEditor.unarchive") : t("contentEditor.archive")}</button>` : ""}
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" data-cancel>${t("contentEditor.cancel")}</button>
        <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}${t("contentEditor.save")}</button>
      </div>
    `,
    onMount: (el) => wire(el, draft, settings, brandId, contentId, onSaved, igConfig, fbConfig, adsConfig, brand, campaigns),
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
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

function bodyTemplate(draft, settings, igConfig, fbConfig, adsConfig, campaigns) {
  const buckets = resolveContentBuckets(settings);
  // Script/caption/etc are Creator Studio's job once a piece has moved past
  // idea/draft — locking them here (not just once "published") is what
  // stops the same field from being edited from two unsynced places at
  // once, which used to mean whichever screen saved last silently won.
  const devLocked = !["idea", "draft"].includes(draft.status);
  return `
    <div class="editor-tabs">
      <div class="editor-tab active" data-tab="basic">${t("contentEditor.tab.basic")}</div>
      <div class="editor-tab" data-tab="dev">${t("contentEditor.tab.dev")}</div>
      <div class="editor-tab" data-tab="perf">${t("contentEditor.tab.perf")}</div>
    </div>

    <div class="flex items-center gap-8" style="margin-bottom:20px;" id="status-row">
      ${statusPill(draft.status)}${funnelTag(draft.funnel)}
    </div>

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
      <label class="checkbox-chip" style="margin-bottom:16px;">
        <input type="checkbox" id="f-trial-reel" ${draft.trialReel ? "checked" : ""} />${t("contentEditor.trialReel")}
      </label>
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
      ${funnelFieldHTML({
        id: "f-funnel",
        value: draft.funnel,
        extraHead: `<button type="button" class="chip-icon-btn" id="ai-detect-funnel" aria-label="${t("contentEditor.funnel.aiDetect")}" title="${t("contentEditor.funnel.aiDetect")}">${icon("bot", { size: 14 })}</button>`,
      })}
      <div id="ai-funnel-status" style="margin:-10px 0 14px;"></div>
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
      <div class="field" style="margin-bottom:0;">
        <label>${t("contentEditor.publishedUrl.label")}</label>
        <input class="input" id="f-url" placeholder="https://..." value="${attr(draft.publishedUrl)}" />
        <div class="hint" style="margin-top:8px;">${icon("info", { size: 12 })} ${t("contentEditor.publishedUrl.hint")}</div>
      </div>
    </div>

    <div class="editor-pane" data-pane="dev">
      ${
        devLocked
          ? `<div class="hint" style="margin:-4px 0 16px;background:var(--surface-2);padding:12px 14px;border-radius:var(--radius-md);">
               ${icon("info", { size: 12 })} ${t("contentEditor.publishedLocked")}
               <button type="button" class="btn btn-secondary btn-sm" id="goto-creator" style="margin-top:8px;">${icon("edit", { size: 13 })}${t("contentEditor.editInCreator")}</button>
             </div>`
          : ""
      }
      <div class="field">
        <label>${t("contentEditor.script.label")}</label>
        <textarea class="textarea" id="f-script" style="min-height:120px;" placeholder="${t("contentEditor.script.placeholder")}" ${devLocked ? "disabled" : ""}>${draft.script || ""}</textarea>
      </div>
      <div class="field">
        <label>${t("contentEditor.caption.label")}</label>
        <textarea class="textarea" id="f-caption" placeholder="${t("contentEditor.caption.placeholder")}" ${devLocked ? "disabled" : ""}>${draft.caption || ""}</textarea>
      </div>
      <div class="field">
        <label>${t("contentEditor.reference.label")}</label>
        <textarea class="textarea" id="f-reference" style="min-height:60px;" placeholder="${t("contentEditor.reference.placeholder")}" ${devLocked ? "disabled" : ""}>${draft.reference || ""}</textarea>
      </div>
      <div class="field">
        <label>${t("contentEditor.cta.label")}</label>
        <input class="input" id="f-cta" placeholder="${t("contentEditor.cta.placeholder")}" value="${attr(draft.cta)}" ${devLocked ? "disabled" : ""} />
      </div>
      <div class="field">
        <label>${t("contentEditor.notes.label")}</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;" ${devLocked ? "disabled" : ""}>${draft.notes || ""}</textarea>
      </div>
      <div class="field" style="margin-bottom:0;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">${t("contentEditor.thumbnail.label")}</label>
          ${
            // 6.4: the AI-generate button always failed without a Gemini
            // key configured — hide it in that case instead of offering a
            // button that can't work. Manual upload below is unaffected.
            ["scheduled", "published", "archived"].includes(draft.status)
              ? settings.ai?.provider === "gemini" && settings.ai?.geminiApiKey
                ? `<button type="button" class="chip-icon-btn" id="ai-thumb-gen" aria-label="${t("contentEditor.thumbnail.aiCreate")}" title="${t("contentEditor.thumbnail.aiCreate")}">${icon("bot", { size: 15 })}</button>`
                : ""
              : `<span class="text-faint" style="font-size:11px;" title="${t("contentEditor.thumbnail.availableAfterEditing")}">${icon("bot", { size: 13 })} ${t("contentEditor.thumbnail.afterEditing")}</span>`
          }
        </div>
        ${draft.thumbnail ? `<img class="thumb-preview" id="thumb-img" src="${draft.thumbnail}" />` : `<img class="thumb-preview" id="thumb-img" style="display:none;" />`}
        <input type="file" id="f-thumb-file" accept="image/*" style="margin-top:8px;font-size:12.5px;" />
        <div id="ai-thumb-status" style="margin-top:6px;"></div>
      </div>
    </div>

    <div class="editor-pane" data-pane="perf">
      <div id="perf-fetch-area">${platformFetchHTML(draft, igConfig, fbConfig)}</div>
      <div class="field">
        <label>${t("contentEditor.screenshot.label")}</label>
        <div id="dropzone" class="dropzone" style="${draft.performance.insightScreenshot ? "display:none;" : ""}">
          ${icon("upload")}
          <div><strong>${t("contentEditor.screenshot.drop")}</strong> ${t("contentEditor.screenshot.dropSub")}</div>
          <div class="text-faint" style="font-size:12px;margin-top:4px;">${t("contentEditor.screenshot.browseHint")}</div>
          <input type="file" id="f-screenshot-file" accept="image/*" style="display:none;" />
        </div>
        <div id="screenshot-wrap" style="${draft.performance.insightScreenshot ? "" : "display:none;"}">
          <div class="screenshot-preview">
            <img id="screenshot-img" src="${draft.performance.insightScreenshot || ""}" />
            <button class="icon-btn remove" id="remove-screenshot" aria-label="${t("contentEditor.screenshot.remove")}" style="background:rgba(12,11,10,.7);">${icon("x", { size: 14 })}</button>
          </div>
        </div>
        <div id="ocr-status"></div>
      </div>

      ${howToHTML("post")}
      <div class="hint" style="margin:-6px 0 14px;">${t("contentEditor.perf.reviewHint")}</div>

      <div class="metric-grid">
        ${METRIC_KEYS.map(
          (m) => `
          <div class="field metric-field" style="margin-bottom:0;">
            <label>${m.label} <span class="found" id="found-${m.key}" style="display:none;">${icon("check", { size: 12 })}</span></label>
            <input class="input" type="number" min="0" id="f-metric-${m.key}" value="${draft.performance[m.key] ?? ""}" placeholder="—" />
          </div>`
        ).join("")}
      </div>

      <div class="divider"></div>
      <div id="computed-preview"></div>

      <div class="divider"></div>
      <div id="ads-area">${adsAreaHTML(draft, adsConfig)}</div>
    </div>
  `;
}

function attr(v) {
  return (v || "").replace(/"/g, "&quot;");
}

// Only meaningful once a campaign is chosen — that campaign's own 4 fixed
// phases (Attention/Engagement/Action/Retention), re-rendered whenever the
// Campaign select changes so it never shows a phase from a different
// campaign.
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

function adsAreaHTML(draft, ads) {
  const adsConnected = !!(ads.adAccountId && ads.adsAccessToken);
  if (!adsConnected) {
    return `<div class="hint" style="margin:0;">${icon("info", { size: 12 })} ${t("contentEditor.ads.connectHint")}</div>`;
  }
  if (!draft.publishedUrl) {
    return `<div class="hint" style="margin:0;">${icon("info", { size: 12 })} ${t("contentEditor.ads.needsUrlHint")}</div>`;
  }
  return `
    <div class="page-eyebrow" style="margin-bottom:10px;">${t("contentEditor.ads.eyebrow")}</div>
    <button type="button" class="btn btn-secondary btn-block" id="check-ads">${icon("refresh", { size: 14 })}${t("contentEditor.ads.check")}</button>
    <div id="ads-status"></div>
    <div id="ads-result">${adsResultHTML(draft.adsPerformance)}</div>
  `;
}

function adsResultHTML(ap) {
  if (!ap) return "";
  if (!ap.found) return `<p class="text-faint" style="font-size:12.5px;margin:10px 0 0;">${t("contentEditor.ads.noneFound")}</p>`;
  return `
    <div class="card card-tight" style="margin-top:12px;">
      ${ap.spend !== null ? kv(t("contentEditor.ads.spend"), `$${formatNumber(ap.spend)}`) : ""}
      ${ap.impressions !== null ? kv(t("contentEditor.ads.impressions"), formatNumber(ap.impressions)) : ""}
      ${ap.reach !== null ? kv(t("contentEditor.ads.reach"), formatNumber(ap.reach)) : ""}
      ${ap.clicks !== null ? kv(t("contentEditor.ads.clicks"), formatNumber(ap.clicks)) : ""}
      ${ap.videoViews !== null ? kv(t("contentEditor.ads.videoViews"), formatNumber(ap.videoViews)) : ""}
      ${ap.cpm !== null ? kv(t("contentEditor.ads.cpm"), `$${formatNumber(ap.cpm)}`) : ""}
    </div>
  `;
}

function kv(label, value) {
  return `<div class="kv"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}

function platformFetchHTML(draft, ig, fb) {
  if (draft.platform !== "Instagram") return "";
  if (!canUseInstagramApi()) {
    return `<div class="hint" style="margin:-4px 0 16px;">${icon("info", { size: 12 })} ${t("contentEditor.ig.comingSoon")}</div>`;
  }
  const igConnected = !!(ig.accessToken && ig.igUserId);
  const fbConnected = !!(fb.pageId && fb.pageAccessToken);

  if (!igConnected) {
    return `<div class="hint" style="margin:-4px 0 16px;">${icon("info", { size: 12 })} ${t("contentEditor.ig.connectHint")}</div>`;
  }
  if (!draft.publishedUrl) {
    return `<div class="hint" style="margin:-4px 0 16px;">${icon("info", { size: 12 })} ${t("contentEditor.ig.needsUrlHint")}</div>`;
  }
  return `
    <div class="field">
      <button type="button" class="btn btn-secondary btn-block" id="fetch-instagram">${icon("refresh", { size: 14 })}${t("contentEditor.ig.fetch")}${fbConnected ? t("contentEditor.ig.fetchWithFb") : ""}</button>
      <div id="ig-fetch-status"></div>
      ${!fbConnected ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">${t("contentEditor.ig.connectFbHint")}</div>` : ""}
    </div>
    <div id="platform-breakdown">${platformBreakdownHTML(draft)}</div>
    ${fbConnected ? manualFacebookHTML(draft) : ""}
  `;
}

// Facebook doesn't expose a reliable way to list a Page's Reels via the
// Graph API (confirmed against a real account: /videos comes back empty and
// /video_reels isn't a valid edge at all — not a permission problem, the
// data just isn't reachable this way), so auto-fetch above is best-effort
// only. This lets the Facebook side of the total be typed in directly
// instead — same combine-on-top behavior as the automatic version.
function manualFacebookHTML(draft) {
  const fbViews = draft.performanceByPlatform?.facebook?.views;
  return `
    <div class="field">
      <label>${t("contentEditor.fb.manualViewsLabel")}</label>
      <input class="input" type="number" min="0" id="f-fb-views-manual" value="${fbViews ?? ""}" placeholder="${t("contentEditor.fb.manualViewsPlaceholder")}" />
      <div class="text-faint" style="font-size:11.5px;margin-top:4px;">${t("contentEditor.fb.manualViewsHint")}</div>
    </div>
  `;
}

function platformBreakdownHTML(draft) {
  const ig = draft.performanceByPlatform?.instagram || {};
  const fb = draft.performanceByPlatform?.facebook || {};
  const hasIg = ig.views !== undefined && ig.views !== null;
  const hasFb = fb.views !== undefined && fb.views !== null;
  if (!hasIg && !hasFb) return "";
  return `
    <div class="hint" style="margin:-4px 0 16px;background:var(--surface-2);flex-direction:column;align-items:flex-start;gap:4px;">
      <strong style="font-size:12px;">${t("contentEditor.platformViews.title")}</strong>
      ${hasIg ? `<div>${platformIcon("instagram")} ${t("contentEditor.platformViews.instagram")} ${formatNumber(ig.views)}</div>` : ""}
      ${hasFb ? `<div>${platformIcon("facebook")} ${t("contentEditor.platformViews.facebook")} ${formatNumber(fb.views)}</div>` : ""}
    </div>
  `;
}

function computedPreviewHTML(draft, settings) {
  const metrics = computeContentMetrics(draft, settings);
  const row = (label, value, rating) => `
    <div class="kv">
      <span class="k">${label}</span>
      <span class="v flex items-center gap-8">
        ${value === null ? "—" : formatPercent(value)}
        ${rating ? `<span class="health-badge health-${rating}" style="padding:3px 9px;">${HEALTH_LABEL[rating]}</span>` : ""}
      </span>
    </div>`;
  return `
    <div class="card card-tight">
      <div class="page-eyebrow" style="margin-bottom:12px;">${t("contentEditor.computed.eyebrow")}</div>
      ${row(t("contentEditor.computed.engagementRate"), metrics.engagementRate, metrics.erRating)}
      ${row(t("contentEditor.computed.followerConversion"), metrics.followerConversionRate, metrics.fcrRating)}
      <div class="kv">
        <span class="k">${t("contentEditor.computed.contentHealth")}</span>
        <span class="v">${metrics.health ? `<span class="health-badge health-${metrics.health}"><span class="health-dot"></span>${HEALTH_LABEL[metrics.health]}</span>` : `<span class="health-badge health-none">${t("contentEditor.computed.noDataYet")}</span>`}</span>
      </div>
    </div>
  `;
}

function wire(el, draft, settings, brandId, contentId, onSaved, igConfig, fbConfig, adsConfig, brand, campaigns) {
  const gotoCreatorBtn = qs("#goto-creator", el);
  if (gotoCreatorBtn && contentId) {
    gotoCreatorBtn.addEventListener("click", () => {
      location.hash = `#/brand/${brandId}/content-os/creator/${contentId}`;
    });
  }

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

  const suggestCampaignBtn = qs("#ai-suggest-campaign", el);
  if (suggestCampaignBtn) {
    suggestCampaignBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-campaign-status", el);
      const hasKey = hasAiKey(ai);
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("contentEditor.ai.needsKey")}</div>`;
        return;
      }
      suggestCampaignBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ai.thinking")}</span></div>`;
      try {
        // Phase counts are computed fresh here (not stored on the shared
        // `campaigns` array used elsewhere in this drawer) so the AI can
        // prefer whichever phase is still empty over one that's already
        // full — "which campaign fits" becomes "which campaign AND phase
        // actually needs this content."
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
        const applyBtn = qs("#apply-campaign-suggestion", el);
        if (applyBtn) {
          applyBtn.addEventListener("click", () => {
            draft.campaignId = suggestion.campaignId;
            draft.campaignPhaseId = suggestion.phaseId || "";
            qs("#f-campaign", el).value = suggestion.campaignId;
            refreshPhaseSelect();
            toast(t("contentEditor.ai.campaignApplied"));
          });
        }
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
    refreshPreview();
  });

  const detectFunnelBtn = qs("#ai-detect-funnel", el);
  if (detectFunnelBtn) {
    detectFunnelBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-funnel-status", el);
      const hasKey = hasAiKey(ai);
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("contentEditor.ai.needsKey")}</div>`;
        return;
      }
      detectFunnelBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ai.detecting")}</span></div>`;
      try {
        const funnel = await classifyFunnel(ai, {
          caption: qs("#f-caption", el)?.value ?? draft.caption,
          idea: qs("#f-idea", el)?.value ?? draft.idea,
          title: qs("#f-title", el)?.value ?? draft.title,
        });
        draft.funnel = funnel;
        setFunnelFieldValue(el, "f-funnel", funnel);
        updateStatusRow();
        refreshPreview();
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

  function refreshPreview() {
    METRIC_KEYS.forEach((m) => {
      const v = qs(`#f-metric-${m.key}`, el).value;
      draft.performance[m.key] = v === "" ? null : Number(v);
    });
    qs("#computed-preview", el).innerHTML = computedPreviewHTML(draft, settings);
  }
  refreshPreview();
  METRIC_KEYS.forEach((m) => {
    qs(`#f-metric-${m.key}`, el).addEventListener("input", refreshPreview);
  });

  // thumbnail
  qs("#f-thumb-file", el).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file, { maxDimension: 800, format: "image/jpeg" });
    draft.thumbnail = dataUrl;
    const img = qs("#thumb-img", el);
    img.src = dataUrl;
    img.style.display = "block";
  });

  const aiThumbBtn = qs("#ai-thumb-gen", el);
  if (aiThumbBtn) {
    aiThumbBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-thumb-status", el);
      if (ai.provider !== "gemini" || !ai.geminiApiKey) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${t("contentEditor.ai.needsGemini")}</span></div>`;
        return;
      }
      aiThumbBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ai.generating")}</span></div>`;
      try {
        const title = qs("#f-title", el)?.value || draft.title;
        const idea = qs("#f-idea", el)?.value || draft.idea;
        const dataUrl = await generateThumbnail(ai, { title, idea, brandGuidelines: brand?.aiVoiceGuide || "", logoDataUrl: brand?.logoAssets?.[0]?.dataUrl });
        draft.thumbnail = dataUrl;
        const img = qs("#thumb-img", el);
        img.src = dataUrl;
        img.style.display = "block";
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>${t("contentEditor.ai.generated")}</span></div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || t("contentEditor.ai.thumbGenericError")}${/quota|billing|429/i.test(err.message || "") ? t("contentEditor.ai.thumbBillingHint") : ""}</span></div>`;
      } finally {
        aiThumbBtn.disabled = false;
      }
    });
  }

  // screenshot dropzone + OCR
  const dropzone = qs("#dropzone", el);
  const fileInput = qs("#f-screenshot-file", el);
  dropzone.addEventListener("click", () => fileInput.click());
  ["dragover", "dragenter"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    })
  );
  dropzone.addEventListener("drop", (e) => handleScreenshotFile(e.dataTransfer.files[0]));
  fileInput.addEventListener("change", (e) => handleScreenshotFile(e.target.files[0]));

  qs("#remove-screenshot", el).addEventListener("click", () => {
    draft.performance.insightScreenshot = "";
    qs("#screenshot-wrap", el).style.display = "none";
    dropzone.style.display = "";
    qs("#ocr-status", el).innerHTML = "";
  });

  async function handleScreenshotFile(file) {
    if (!file) return;
    const dataUrl = await resizeImageFile(file, { maxDimension: 1400, format: "image/jpeg", quality: 0.88 });
    draft.performance.insightScreenshot = dataUrl;
    dropzone.style.display = "none";
    const wrap = qs("#screenshot-wrap", el);
    wrap.style.display = "";
    qs("#screenshot-img", el).src = dataUrl;

    const statusEl = qs("#ocr-status", el);
    statusEl.innerHTML = `<div class="spinner"></div><span>${t("contentEditor.ocr.analyzing")}</span>`;
    try {
      const { metrics } = await analyzeScreenshot(dataUrl, (pct) => {
        statusEl.innerHTML = `<div class="spinner"></div><span>${t("contentEditor.ocr.analyzingPct", { pct })}</span>`;
      });
      const matched = Object.keys(metrics);
      matched.forEach((key) => {
        const input = qs(`#f-metric-${key}`, el);
        if (input) input.value = metrics[key];
        const found = qs(`#found-${key}`, el);
        if (found) found.style.display = "inline-flex";
      });
      refreshPreview();
      statusEl.innerHTML = matched.length
        ? `${icon("check", { size: 15 })}<span>${t("contentEditor.ocr.foundMetrics", { count: matched.length, metricWord: t(matched.length === 1 ? "cnt.metric.one" : "cnt.metric.many") })}</span>`
        : `${icon("info", { size: 15 })}<span>${t("contentEditor.ocr.noneFound")}</span>`;
    } catch (err) {
      statusEl.innerHTML = `${icon("info", { size: 15 })}<span>${err.message || t("contentEditor.ocr.genericError")}</span>`;
    }
  }

  // Platform fetch (Instagram always; Facebook only for crossposted content) —
  // each one writes into its own slot in performanceByPlatform, then the
  // visible metric fields are set to the COMBINED total across platforms, so
  // fetching Facebook after Instagram adds its views on top instead of
  // overwriting them.
  function applyCombinedMetrics() {
    const totals = combinePlatformMetrics(draft.performanceByPlatform);
    METRIC_KEYS.forEach((m) => {
      if (totals[m.key] === null) return; // leave fields no platform reported alone
      const input = qs(`#f-metric-${m.key}`, el);
      if (input) input.value = totals[m.key];
      const found = qs(`#found-${m.key}`, el);
      if (found) found.style.display = "inline-flex";
    });
    refreshPreview();
  }

  function updateBreakdown() {
    const area = qs("#platform-breakdown", el);
    if (area) area.innerHTML = platformBreakdownHTML(draft);
  }

  function wirePerfFetchArea() {
    const fbViewsInput = qs("#f-fb-views-manual", el);
    if (fbViewsInput) {
      fbViewsInput.addEventListener("input", () => {
        const v = fbViewsInput.value;
        draft.performanceByPlatform.facebook = { ...draft.performanceByPlatform.facebook, views: v === "" ? null : Number(v) };
        applyCombinedMetrics();
        updateBreakdown();
      });
    }

    const fetchIgBtn = qs("#fetch-instagram", el);
    if (!fetchIgBtn) return;
    fetchIgBtn.addEventListener("click", async () => {
      const statusEl = qs("#ig-fetch-status", el);
      const fbConnected = !!(fbConfig.pageId && fbConfig.pageAccessToken);
      fetchIgBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ig.looking")}</span></div>`;
      try {
        const media = await findMediaByPermalink(igConfig, draft.publishedUrl);
        if (!media) {
          statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${t("contentEditor.ig.notFound")}</span></div>`;
          return;
        }
        statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ig.fetchingInsights")}</span></div>`;
        const { metrics, warnings } = await fetchMediaMetrics(igConfig, media);
        draft.performanceByPlatform.instagram = { ...draft.performanceByPlatform.instagram, ...metrics };

        // If this brand has a Facebook Page connected, pull how many of
        // this same Reel's plays came from Facebook — this is the SAME
        // Instagram media's own insight data (field facebook_views), not a
        // separate Facebook post to go find, so there's nothing to match by
        // caption/date and nothing to miss.
        // Confirmed against a real account: the Graph API's facebook_views/
        // crossposted_views fields do NOT reliably return the real
        // Instagram-vs-Facebook split shown in Instagram's own app (Reel
        // Insights) — they came back 0 for a reel the app itself reported
        // 405 Facebook views on. Meta doesn't expose this breakdown through
        // the public API, so this is never auto-written anymore — surface
        // it as a prompt to check the app and enter it manually instead of
        // silently writing a number that might be wrong.
        let fbFoundCount = 0;
        if (fbConnected) {
          warnings.push(t("contentEditor.ig.fbCrosspostHint"));
        }

        applyCombinedMetrics();
        updateBreakdown();
        const foundCount = Object.keys(metrics).length;
        statusEl.innerHTML = `
          <div class="ocr-status" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <div class="flex items-center gap-8">${icon("check", { size: 15 })}<span>${t("contentEditor.ig.pulledMetrics", {
              count: foundCount,
              metricWord: t(foundCount === 1 ? "cnt.metric.one" : "cnt.metric.many"),
              fbPart: fbFoundCount ? t("contentEditor.ig.fbCrosspostDetected", { n: fbFoundCount }) : "",
            })}</span></div>
            ${warnings.map((w) => `<div class="text-faint" style="font-size:12px;">${w}</div>`).join("")}
          </div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || t("contentEditor.ig.genericError")}</span></div>`;
      } finally {
        fetchIgBtn.disabled = false;
      }
    });
  }
  wirePerfFetchArea();

  // Switching Platform (via the quick-pick or the raw dropdown) needs the
  // Performance tab's fetch-vs-manual-entry controls to match — they used
  // to only ever reflect whatever platform the drawer opened with.
  const buckets = resolveContentBuckets(settings);
  function refreshPlatformDependentUI() {
    draft.platform = qs("#f-platform", el).value;
    draft.format = qs("#f-format", el).value;
    qs("#perf-fetch-area", el).innerHTML = platformFetchHTML(draft, igConfig, fbConfig);
    wirePerfFetchArea();
    qsa("#f-quickpick button", el).forEach((btn) => {
      const combo = btn.dataset.quickpick === "reels" ? buckets.reels : buckets.tiktok;
      btn.classList.toggle("active", quickPickActive(draft, combo));
    });
  }
  qs("#f-platform", el).addEventListener("change", refreshPlatformDependentUI);
  qs("#f-format", el).addEventListener("change", refreshPlatformDependentUI);
  qsa("[data-quickpick]", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      const combo = btn.dataset.quickpick === "reels" ? buckets.reels : buckets.tiktok;
      if (!combo) return;
      qs("#f-platform", el).value = combo.platform;
      qs("#f-format", el).value = combo.format;
      refreshPlatformDependentUI();
    });
  });

  const checkAdsBtn = qs("#check-ads", el);
  if (checkAdsBtn) {
    checkAdsBtn.addEventListener("click", async () => {
      const statusEl = qs("#ads-status", el);
      checkAdsBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentEditor.ads.checking")}</span></div>`;
      try {
        const matches = await findAdsForPost(adsConfig, draft.publishedUrl);
        if (!matches.length) {
          draft.adsPerformance = { found: false, checkedAt: Date.now() };
          statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>${t("contentEditor.ads.checkedNone")}</span></div>`;
        } else {
          const insights = await fetchAdInsights(adsConfig, matches[0].id);
          draft.adsPerformance = { found: true, adId: matches[0].id, ...insights, checkedAt: Date.now() };
          statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>${matches.length > 1 ? t("contentEditor.ads.foundMultiple", { count: matches.length }) : t("contentEditor.ads.foundOne")}</span></div>`;
        }
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || t("contentEditor.ads.genericError")}</span></div>`;
      } finally {
        checkAdsBtn.disabled = false;
        qs("#ads-result", el).innerHTML = adsResultHTML(draft.adsPerformance);
      }
    });
  }

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

  // save
  el.closest(".overlay").querySelector("[data-save]").addEventListener("click", () => {
    const title = qs("#f-title", el).value.trim();
    if (!title) {
      toast(t("contentEditor.needTitle"), "error");
      qs("#f-title", el).focus();
      return;
    }
    // Same rule as the calendar: a new schedule can't be in the past. An
    // unchanged old date (e.g. editing an overdue piece's caption) is left alone.
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
      platform: qs("#f-platform", el).value,
      format: qs("#f-format", el).value,
      trialReel: qs("#f-trial-reel", el).checked,
      funnel: draft.funnel,
      status: qs("#f-status", el).value,
      scheduleDate: qs("#f-schedule", el).value,
      publishedDate: qs("#f-published", el).value,
      publishedUrl: qs("#f-url", el).value.trim(),
      script: qs("#f-script", el).value,
      caption: qs("#f-caption", el).value,
      reference: qs("#f-reference", el).value,
      cta: qs("#f-cta", el).value,
      notes: qs("#f-notes", el).value,
      thumbnail: draft.thumbnail,
      performanceByPlatform: draft.performanceByPlatform,
      adsPerformance: draft.adsPerformance,
      performance: {
        ...draft.performance,
        confirmedAt: Date.now(),
      },
    };
    METRIC_KEYS.forEach((m) => {
      const v = qs(`#f-metric-${m.key}`, el).value;
      patch.performance[m.key] = v === "" ? null : Number(v);
    });

    if (contentId) {
      updateContent(contentId, patch);
      toast(t("contentEditor.updated"));
    } else {
      createContent(brandId, patch);
      toast(t("contentEditor.created"));
    }
    closeOverlay(el.closest(".overlay"));
    onSaved?.();
  });
}
