import { getContent, createContent, updateContent, getSettings, getBrand, combinePlatformMetrics, resolveContentBuckets, listCampaigns, METRIC_KEYS, STATUSES, STATUS_LABELS, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon, platformIcon } from "../icons.js";
import { openDrawer, closeOverlay, confirmDialog } from "../modals.js";
import { toast, formatPercent, formatNumber, resizeImageFile, escapeHtml, qs, qsa } from "../dom.js";
import { analyzeScreenshot } from "../ocr.js";
import { findMediaByPermalink, fetchMediaMetrics } from "../instagram.js";
import { findAdsForPost, fetchAdInsights } from "../ads.js";
import { generateThumbnail, classifyFunnel, suggestCampaignFit } from "../ai.js";

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
    title: existing ? "Edit Content" : "New Content",
    bodyHTML: bodyTemplate(draft, settings, igConfig, fbConfig, adsConfig, campaigns),
    footHTML: `
      <div class="flex items-center gap-8">
        ${existing ? `<button class="btn btn-ghost btn-sm" data-archive>${icon("archive", { size: 14 })}${existing.archived ? "Unarchive" : "Archive"}</button>` : ""}
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" data-cancel>Cancel</button>
        <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}Save</button>
      </div>
    `,
    onMount: (el) => wire(el, draft, settings, brandId, contentId, onSaved, igConfig, fbConfig, adsConfig, brand, campaigns),
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
}

function statusPill(status) {
  return `<span class="status-pill status-${status}"><span class="status-dot"></span>${STATUS_LABELS[status]}</span>`;
}
function funnelTag(funnel) {
  return `<span class="tag tag-${funnel.toLowerCase()}">${funnel}</span>`;
}

function bodyTemplate(draft, settings, igConfig, fbConfig, adsConfig, campaigns) {
  const buckets = resolveContentBuckets(settings);
  return `
    <div class="editor-tabs">
      <div class="editor-tab active" data-tab="basic">Basic Info</div>
      <div class="editor-tab" data-tab="dev">Content Development</div>
      <div class="editor-tab" data-tab="perf">Performance</div>
    </div>

    <div class="flex items-center gap-8" style="margin-bottom:20px;" id="status-row">
      ${statusPill(draft.status)}${funnelTag(draft.funnel)}
    </div>

    <div class="editor-pane active" data-pane="basic">
      <div class="field">
        <label>Content Title</label>
        <input class="input" id="f-title" placeholder="e.g. 5 mistakes new founders make" value="${attr(draft.title)}" />
      </div>
      <div class="field">
        <label>Content Idea</label>
        <textarea class="textarea" id="f-idea" placeholder="What is this content about, and why now?">${draft.idea || ""}</textarea>
      </div>
      <div class="field">
        <label>Content For</label>
        <div class="chip-select" id="f-quickpick">
          <button type="button" data-quickpick="reels" ${buckets.reels ? "" : "disabled"} class="${quickPickActive(draft, buckets.reels) ? "active" : ""}">Reels (Instagram)</button>
          <button type="button" data-quickpick="tiktok" ${buckets.tiktok ? "" : "disabled"} class="${quickPickActive(draft, buckets.tiktok) ? "active" : ""}">TikTok</button>
        </div>
        <div class="text-faint" style="font-size:11px;margin-top:6px;">Shortcut for Platform + Format below — still fully editable for Facebook, YouTube, Carousel, etc.</div>
      </div>
      <div class="row-2">
        <div class="field">
          <label>Platform</label>
          <select class="select" id="f-platform">
            ${settings.platforms.map((p) => `<option value="${p.name}" ${draft.platform === p.name ? "selected" : ""}>${p.name}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Format</label>
          <select class="select" id="f-format">
            ${settings.formats.map((f) => `<option value="${f.name}" ${draft.format === f.name ? "selected" : ""}>${f.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Campaign</label>
          <button type="button" class="chip-icon-btn" id="ai-suggest-campaign" aria-label="AI suggest campaign & angle" title="${campaigns.length ? "Suggest campaign & angle using AI" : "Create a campaign first"}" ${campaigns.length ? "" : "disabled"}>${icon("bot", { size: 14 })}</button>
        </div>
        <select class="select" id="f-campaign">
          <option value="">No campaign</option>
          ${campaigns.map((c) => `<option value="${c.id}" ${draft.campaignId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        </select>
        <div id="phase-select-wrap">${phaseSelectHTML(campaigns, draft)}</div>
        ${!campaigns.length ? `<div class="text-faint" style="font-size:11px;margin-top:6px;">No campaigns yet — create one from the Campaigns tab to link content to a goal.</div>` : ""}
        <div id="ai-campaign-status" style="margin-top:6px;"></div>
      </div>
      <div class="field">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Funnel Stage</label>
          <button type="button" class="chip-icon-btn" id="ai-detect-funnel" aria-label="AI detect funnel stage from caption" title="Detect from caption/idea using AI">${icon("bot", { size: 14 })}</button>
        </div>
        <div class="chip-select" id="f-funnel">
          ${FUNNELS.map((f) => `<button type="button" data-val="${f}" class="${draft.funnel === f ? "active" : ""}">${f}</button>`).join("")}
        </div>
        <div id="ai-funnel-status" style="margin-top:6px;"></div>
      </div>
      <div class="field">
        <label>Status</label>
        <select class="select" id="f-status">
          ${STATUSES.map((s) => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
        </select>
      </div>
      <div class="row-2">
        <div class="field">
          <label>Schedule Date</label>
          <input class="input" type="date" id="f-schedule" value="${draft.scheduleDate || ""}" />
        </div>
        <div class="field">
          <label>Published Date</label>
          <input class="input" type="date" id="f-published" value="${draft.publishedDate || ""}" />
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Published URL</label>
        <input class="input" id="f-url" placeholder="https://..." value="${attr(draft.publishedUrl)}" />
        <div class="hint" style="margin-top:8px;">${icon("info", { size: 12 })} Direct Publishing straight from here is Coming Soon — paste the link manually for now once it's live.</div>
      </div>
    </div>

    <div class="editor-pane" data-pane="dev">
      ${
        draft.status === "published"
          ? `<div class="hint" style="margin:-4px 0 16px;background:var(--surface-2);padding:12px 14px;border-radius:var(--radius-md);">
               ${icon("info", { size: 12 })} This content is published — script, caption, and the fields below are locked here.
               <button type="button" class="btn btn-secondary btn-sm" id="goto-creator" style="margin-top:8px;">${icon("edit", { size: 13 })}Edit in Creator</button>
             </div>`
          : ""
      }
      <div class="field">
        <label>Script</label>
        <textarea class="textarea" id="f-script" style="min-height:120px;" placeholder="Hook, body, CTA..." ${draft.status === "published" ? "disabled" : ""}>${draft.script || ""}</textarea>
      </div>
      <div class="field">
        <label>Caption</label>
        <textarea class="textarea" id="f-caption" placeholder="Caption text for the post" ${draft.status === "published" ? "disabled" : ""}>${draft.caption || ""}</textarea>
      </div>
      <div class="field">
        <label>Reference</label>
        <textarea class="textarea" id="f-reference" style="min-height:60px;" placeholder="Links or notes on inspiration" ${draft.status === "published" ? "disabled" : ""}>${draft.reference || ""}</textarea>
      </div>
      <div class="field">
        <label>CTA</label>
        <input class="input" id="f-cta" placeholder="What should the viewer do next?" value="${attr(draft.cta)}" ${draft.status === "published" ? "disabled" : ""} />
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea class="textarea" id="f-notes" style="min-height:60px;" ${draft.status === "published" ? "disabled" : ""}>${draft.notes || ""}</textarea>
      </div>
      <div class="field" style="margin-bottom:0;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">Thumbnail</label>
          ${
            ["scheduled", "published", "archived"].includes(draft.status)
              ? `<button type="button" class="chip-icon-btn" id="ai-thumb-gen" aria-label="AI Thumbnail Creator" title="AI Thumbnail Creator">${icon("bot", { size: 15 })}</button>`
              : `<span class="text-faint" style="font-size:11px;" title="Available once editing is done">${icon("bot", { size: 13 })} after Editing</span>`
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
        <label>Insight Screenshot</label>
        <div id="dropzone" class="dropzone" style="${draft.performance.insightScreenshot ? "display:none;" : ""}">
          ${icon("upload")}
          <div><strong>Drop a screenshot</strong> of your platform insights here</div>
          <div class="text-faint" style="font-size:12px;margin-top:4px;">or click to browse — metrics are extracted automatically</div>
          <input type="file" id="f-screenshot-file" accept="image/*" style="display:none;" />
        </div>
        <div id="screenshot-wrap" style="${draft.performance.insightScreenshot ? "" : "display:none;"}">
          <div class="screenshot-preview">
            <img id="screenshot-img" src="${draft.performance.insightScreenshot || ""}" />
            <button class="icon-btn remove" id="remove-screenshot" aria-label="Remove screenshot" style="background:rgba(12,11,10,.7);">${icon("x", { size: 14 })}</button>
          </div>
        </div>
        <div id="ocr-status"></div>
      </div>

      <div class="hint" style="margin:-6px 0 14px;">Review and correct any extracted numbers before saving — nothing is saved automatically.</div>

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
  if (!campaign) return "";
  return `
    <select class="select" id="f-phase" style="margin-top:8px;">
      <option value="">No phase</option>
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
    return `<div class="hint" style="margin:0;">${icon("info", { size: 12 })} Connect this brand's Ad Account in Edit Brand to check if this post was boosted, and pull its spend/impressions.</div>`;
  }
  if (!draft.publishedUrl) {
    return `<div class="hint" style="margin:0;">${icon("info", { size: 12 })} Add the Published URL (Basic Info tab) to check this post for ads.</div>`;
  }
  return `
    <div class="page-eyebrow" style="margin-bottom:10px;">Paid / Ads (separate from organic above)</div>
    <button type="button" class="btn btn-secondary btn-block" id="check-ads">${icon("refresh", { size: 14 })}Check for Ads</button>
    <div id="ads-status"></div>
    <div id="ads-result">${adsResultHTML(draft.adsPerformance)}</div>
  `;
}

function adsResultHTML(ap) {
  if (!ap) return "";
  if (!ap.found) return `<p class="text-faint" style="font-size:12.5px;margin:10px 0 0;">No ad found promoting this post — looks organic-only.</p>`;
  return `
    <div class="card card-tight" style="margin-top:12px;">
      ${ap.spend !== null ? kv("Spend", `$${formatNumber(ap.spend)}`) : ""}
      ${ap.impressions !== null ? kv("Impressions", formatNumber(ap.impressions)) : ""}
      ${ap.reach !== null ? kv("Ad Reach", formatNumber(ap.reach)) : ""}
      ${ap.clicks !== null ? kv("Clicks", formatNumber(ap.clicks)) : ""}
      ${ap.videoViews !== null ? kv("Video Views (paid)", formatNumber(ap.videoViews)) : ""}
      ${ap.cpm !== null ? kv("CPM", `$${formatNumber(ap.cpm)}`) : ""}
    </div>
  `;
}

function kv(label, value) {
  return `<div class="kv"><span class="k">${label}</span><span class="v">${value}</span></div>`;
}

function platformFetchHTML(draft, ig, fb) {
  if (draft.platform !== "Instagram") return "";
  const igConnected = !!(ig.accessToken && ig.igUserId);
  const fbConnected = !!(fb.pageId && fb.pageAccessToken);

  if (!igConnected) {
    return `<div class="hint" style="margin:-4px 0 16px;">${icon("info", { size: 12 })} Connect this brand's Instagram in Edit Brand to fetch these numbers automatically instead of screenshotting them.</div>`;
  }
  if (!draft.publishedUrl) {
    return `<div class="hint" style="margin:-4px 0 16px;">${icon("info", { size: 12 })} Add the Published URL (Basic Info tab) to enable fetching this post's numbers from Instagram.</div>`;
  }
  return `
    <div class="field">
      <button type="button" class="btn btn-secondary btn-block" id="fetch-instagram">${icon("refresh", { size: 14 })}Fetch from Instagram${fbConnected ? " + Facebook" : ""}</button>
      <div id="ig-fetch-status"></div>
      ${!fbConnected ? `<div class="text-faint" style="font-size:11.5px;margin-top:6px;">Connect this brand's Facebook Page in Edit Brand to auto-detect and add crossposted views too.</div>` : ""}
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
      <label>Facebook Views (manual)</label>
      <input class="input" type="number" min="0" id="f-fb-views-manual" value="${fbViews ?? ""}" placeholder="Check this Reel's Insights in Instagram's app, enter its Facebook number here" />
      <div class="text-faint" style="font-size:11.5px;margin-top:4px;">Instagram app → this Reel → Insights → Overview → "Views" breakdown shows Instagram/Facebook split. Meta doesn't expose that split through the API, so it's typed in here — gets added to Instagram's views for the combined total.</div>
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
      <strong style="font-size:12px;">Views by platform</strong>
      ${hasIg ? `<div>${platformIcon("instagram")} Instagram: ${formatNumber(ig.views)}</div>` : ""}
      ${hasFb ? `<div>${platformIcon("facebook")} Facebook: ${formatNumber(fb.views)}</div>` : ""}
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
      <div class="page-eyebrow" style="margin-bottom:12px;">Automatically calculated</div>
      ${row("Engagement Rate", metrics.engagementRate, metrics.erRating)}
      ${row("Follower Conversion", metrics.followerConversionRate, metrics.fcrRating)}
      <div class="kv">
        <span class="k">Content Health</span>
        <span class="v">${metrics.health ? `<span class="health-badge health-${metrics.health}"><span class="health-dot"></span>${HEALTH_LABEL[metrics.health]}</span>` : `<span class="health-badge health-none">No data yet</span>`}</span>
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
      const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Add your AI API key in Settings → AI first.</div>`;
        return;
      }
      suggestCampaignBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Thinking…</span></div>`;
      try {
        const suggestion = await suggestCampaignFit(ai, {
          brand,
          campaigns,
          idea: qs("#f-idea", el)?.value ?? draft.idea,
          title: qs("#f-title", el)?.value ?? draft.title,
        });
        statusEl.innerHTML = suggestion.campaignId
          ? `<div class="ocr-status" style="flex-direction:column;align-items:flex-start;gap:4px;">
               ${icon("check", { size: 14 })}<strong style="font-size:12.5px;">Suggested: ${escapeHtml(campaigns.find((c) => c.id === suggestion.campaignId)?.name || "")}</strong>
               ${suggestion.angle ? `<span style="font-size:12px;">Angle: ${escapeHtml(suggestion.angle)}</span>` : ""}
               ${suggestion.rationale ? `<span class="text-faint" style="font-size:11.5px;">${escapeHtml(suggestion.rationale)}</span>` : ""}
               <button type="button" class="btn btn-secondary btn-sm" id="apply-campaign-suggestion" style="margin-top:4px;">Use this campaign</button>
             </div>`
          : `<div class="ocr-status">${icon("info", { size: 14 })}<span>${suggestion.rationale || "No campaign seemed like a clear fit for this idea."}</span></div>`;
        const applyBtn = qs("#apply-campaign-suggestion", el);
        if (applyBtn) {
          applyBtn.addEventListener("click", () => {
            draft.campaignId = suggestion.campaignId;
            draft.campaignPhaseId = "";
            qs("#f-campaign", el).value = suggestion.campaignId;
            refreshPhaseSelect();
            toast("Campaign applied — remember to save.");
          });
        }
      } catch (e) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e.message}</span></div>`;
      } finally {
        suggestCampaignBtn.disabled = false;
      }
    });
  }

  // funnel chip select
  qsa("#f-funnel button", el).forEach((btn) => {
    btn.addEventListener("click", () => {
      draft.funnel = btn.dataset.val;
      qsa("#f-funnel button", el).forEach((b) => b.classList.toggle("active", b === btn));
      updateStatusRow();
      refreshPreview();
    });
  });

  const detectFunnelBtn = qs("#ai-detect-funnel", el);
  if (detectFunnelBtn) {
    detectFunnelBtn.addEventListener("click", async () => {
      const ai = settings.ai || {};
      const statusEl = qs("#ai-funnel-status", el);
      const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
      if (!hasKey) {
        statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">Add your AI API key in Settings → AI first.</div>`;
        return;
      }
      detectFunnelBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Detecting…</span></div>`;
      try {
        const funnel = await classifyFunnel(ai, {
          caption: qs("#f-caption", el)?.value ?? draft.caption,
          idea: qs("#f-idea", el)?.value ?? draft.idea,
          title: qs("#f-title", el)?.value ?? draft.title,
        });
        draft.funnel = funnel;
        qsa("#f-funnel button", el).forEach((b) => b.classList.toggle("active", b.dataset.val === funnel));
        updateStatusRow();
        refreshPreview();
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 14 })}<span>Detected ${funnel}.</span></div>`;
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
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>Needs the Gemini provider connected in Settings → AI.</span></div>`;
        return;
      }
      aiThumbBtn.disabled = true;
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Generating…</span></div>`;
      try {
        const title = qs("#f-title", el)?.value || draft.title;
        const idea = qs("#f-idea", el)?.value || draft.idea;
        const dataUrl = await generateThumbnail(ai, { title, idea, brandGuidelines: brand?.aiVoiceGuide || "", logoDataUrl: brand?.logoAssets?.[0]?.dataUrl });
        draft.thumbnail = dataUrl;
        const img = qs("#thumb-img", el);
        img.src = dataUrl;
        img.style.display = "block";
        statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>Generated — review before saving.</span></div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || "Couldn't generate a thumbnail."}${/quota|billing|429/i.test(err.message || "") ? " Image generation needs billing enabled on your Google Cloud project — text generation stays free, but images don't." : ""}</span></div>`;
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
    statusEl.innerHTML = `<div class="spinner"></div><span>Analyzing screenshot…</span>`;
    try {
      const { metrics } = await analyzeScreenshot(dataUrl, (pct) => {
        statusEl.innerHTML = `<div class="spinner"></div><span>Analyzing screenshot… ${pct}%</span>`;
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
        ? `${icon("check", { size: 15 })}<span>Found ${matched.length} metric${matched.length > 1 ? "s" : ""} — double-check the numbers below, then save.</span>`
        : `${icon("info", { size: 15 })}<span>Couldn't confidently read any metrics — enter them manually below.</span>`;
    } catch (err) {
      statusEl.innerHTML = `${icon("info", { size: 15 })}<span>${err.message || "Couldn't analyze that image."}</span>`;
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
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Looking up this post on Instagram…</span></div>`;
      try {
        const media = await findMediaByPermalink(igConfig, draft.publishedUrl);
        if (!media) {
          statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>Couldn't find that post among your recent Instagram media — double-check the Published URL, or use the screenshot instead.</span></div>`;
          return;
        }
        statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Fetching insights…</span></div>`;
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
          warnings.push(`Facebook crosspost views aren't reliably exposed by the API — check this Reel's "Views over time" in Instagram's own app (Overview tab) and enter the Facebook number manually below.`);
        }

        applyCombinedMetrics();
        updateBreakdown();
        const foundCount = Object.keys(metrics).length;
        statusEl.innerHTML = `
          <div class="ocr-status" style="flex-direction:column;align-items:flex-start;gap:6px;">
            <div class="flex items-center gap-8">${icon("check", { size: 15 })}<span>Pulled ${foundCount} metric${foundCount === 1 ? "" : "s"} from Instagram${fbFoundCount ? ` — also detected a Facebook crosspost and added ${fbFoundCount} of its numbers on top` : ""}. Review below, then save.</span></div>
            ${warnings.map((w) => `<div class="text-faint" style="font-size:12px;">${w}</div>`).join("")}
          </div>`;
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || "Couldn't reach Instagram."}</span></div>`;
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
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>Checking for ads promoting this post…</span></div>`;
      try {
        const matches = await findAdsForPost(adsConfig, draft.publishedUrl);
        if (!matches.length) {
          draft.adsPerformance = { found: false, checkedAt: Date.now() };
          statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>Checked — no ad found for this post.</span></div>`;
        } else {
          const insights = await fetchAdInsights(adsConfig, matches[0].id);
          draft.adsPerformance = { found: true, adId: matches[0].id, ...insights, checkedAt: Date.now() };
          statusEl.innerHTML = `<div class="ocr-status">${icon("check", { size: 15 })}<span>Found ${matches.length > 1 ? `${matches.length} ads — showing the first` : "an ad"} for this post.</span></div>`;
        }
      } catch (err) {
        statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 15 })}<span>${err.message || "Couldn't reach the Marketing API."}</span></div>`;
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
        title: draft.archived ? "Unarchive content?" : "Archive content?",
        message: draft.archived ? "It will reappear in your content database." : "It stays in your database but is hidden from active views.",
        confirmLabel: draft.archived ? "Unarchive" : "Archive",
      });
      if (!ok) return;
      updateContent(contentId, { archived: !draft.archived });
      toast(draft.archived ? "Content restored" : "Content archived");
      closeOverlay(el.closest(".overlay"));
      onSaved?.();
    });
  }

  // save
  el.closest(".overlay").querySelector("[data-save]").addEventListener("click", () => {
    const title = qs("#f-title", el).value.trim();
    if (!title) {
      toast("Give this content a title first.", "error");
      qs("#f-title", el).focus();
      return;
    }
    const patch = {
      title,
      idea: qs("#f-idea", el).value,
      campaignId: draft.campaignId || "",
      campaignPhaseId: draft.campaignPhaseId || "",
      platform: qs("#f-platform", el).value,
      format: qs("#f-format", el).value,
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
      toast("Content updated");
    } else {
      createContent(brandId, patch);
      toast("Content created");
    }
    closeOverlay(el.closest(".overlay"));
    onSaved?.();
  });
}
