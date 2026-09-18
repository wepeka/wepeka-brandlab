import { getBrand, listContent, getSettings, onChange, updateBrand, addBrandLogo, removeBrandLogo, resolveContentBuckets, instagramOnlyViews, organicViews, combinedViewsWithAds, FUNNELS } from "../store.js";
import { getBrandInsights } from "../store.js";
import { ageLabel, STALE_DAYS } from "../campaign-metrics.js";
import { openInsightsModal } from "./insights-modal.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon } from "../icons.js";
import { formatNumber, formatPercent, formatDate, resizeImageFile, qs, qsa, toast, escapeHtml as escapeText, escapeHtml as escapeAttr } from "../dom.js";
import { promptDialog } from "../modals.js";
import { openContentEditor } from "./content-editor.js";
import { openQuickFillModal } from "./content-list.js";
import { getAccountProfile, getAccountInsights } from "../instagram.js";
import { canUseInstagramApi } from "../account.js";
import { openReportModal } from "./report.js";
import { t } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";

export function render(root, { brandId }) {
  const state = { accountData: null, accountLoading: false };
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const igConfigured = canUseInstagramApi() && !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
  const collapsed = new Set(brand.dashboardCollapsed || []);
  const settings = getSettings();
  const all = listContent(brandId);
  const withMetrics = all.map((c) => ({ c, m: computeContentMetrics(c, settings) }));

  const published = all.filter((c) => c.status === "published");
  const scheduled = all.filter((c) => c.status === "scheduled");
  const drafts = all.filter((c) => ["idea", "draft", "production", "editing"].includes(c.status));

  const views = published.map((c) => c.performance.views).filter((v) => v !== null && v !== undefined);
  const totalViews = views.reduce((a, b) => a + b, 0);
  const avgViews = views.length ? totalViews / views.length : null;

  const ers = withMetrics.map((x) => x.m.engagementRate).filter((v) => v !== null);
  const fcrs = withMetrics.map((x) => x.m.followerConversionRate).filter((v) => v !== null);
  const avgER = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : null;
  const avgFCR = fcrs.length ? fcrs.reduce((a, b) => a + b, 0) / fcrs.length : null;

  const healthCounts = { good: 0, average: 0, poor: 0, none: 0 };
  withMetrics.forEach((x) => {
    if (x.c.status !== "published") return;
    healthCounts[x.m.health || "none"]++;
  });
  const evaluated = healthCounts.good + healthCounts.average + healthCounts.poor;

  const upNext = [...scheduled]
    .sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999"))
    .slice(0, 5);

  const top = withMetrics
    .filter((x) => x.c.status === "published" && x.c.performance.views)
    .sort((a, b) => (b.c.performance.views || 0) - (a.c.performance.views || 0))
    .slice(0, 5);

  // Organic winners not already boosted — the simplest honest signal for
  // "worth spending ad budget on" available without real ads history to
  // learn from: it's already proven itself without any spend behind it.
  const boostCandidates = withMetrics
    .filter((x) => x.c.status === "published" && x.m.engagementRate !== null && x.m.health === "good" && !x.c.adsPerformance?.found)
    .sort((a, b) => (b.m.engagementRate || 0) - (a.m.engagementRate || 0))
    .slice(0, 5);

  const boosted = all.filter((c) => c.adsPerformance?.found);
  const adsTotals = boosted.reduce(
    (sum, c) => ({
      spend: sum.spend + (c.adsPerformance.spend || 0),
      impressions: sum.impressions + (c.adsPerformance.impressions || 0),
      clicks: sum.clicks + (c.adsPerformance.clicks || 0),
    }),
    { spend: 0, impressions: 0, clicks: 0 }
  );

  const platformStats = {};
  withMetrics.forEach((x) => {
    if (x.m.engagementRate === null) return;
    const p = x.c.platform || t("cnt.dash.otherPlatform");
    platformStats[p] = platformStats[p] || [];
    platformStats[p].push(x.m.engagementRate);
  });
  const platformRows = Object.entries(platformStats)
    .map(([platform, list]) => ({ platform, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);
  const maxPlatformAvg = Math.max(1, ...platformRows.map((r) => r.avg));

  const formatStats = {};
  withMetrics.forEach((x) => {
    if (x.m.engagementRate === null) return;
    const f = x.c.format || t("cnt.dash.unspecifiedFormat");
    formatStats[f] = formatStats[f] || [];
    formatStats[f].push(x.m.engagementRate);
  });
  const formatRows = Object.entries(formatStats)
    .map(([format, list]) => ({ format, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);
  const maxFormatAvg = Math.max(1, ...formatRows.map((r) => r.avg));

  const buckets = resolveContentBuckets(settings);
  const reelsItems = buckets.reels ? published.filter((c) => c.platform === buckets.reels.platform && c.format === buckets.reels.format) : [];
  const tiktokItems = buckets.tiktok ? published.filter((c) => c.platform === buckets.tiktok.platform) : [];
  const reelsTiktokStats = (items) => ({
    count: items.length,
    instagramOnly: items.reduce((s, c) => s + (instagramOnlyViews(c) || 0), 0),
    organic: items.reduce((s, c) => s + (organicViews(c) || 0), 0),
    ads: items.reduce((s, c) => s + (c.adsPerformance?.found ? c.adsPerformance.videoViews || 0 : 0), 0),
    combined: items.reduce((s, c) => s + (combinedViewsWithAds(c) || 0), 0),
  });

  const poorPct = evaluated ? (healthCounts.poor / evaluated) * 100 : null;

  const funnelStats = {};
  FUNNELS.forEach((f) => {
    const items = withMetrics.filter((x) => x.c.funnel === f);
    const erList = items.map((x) => x.m.engagementRate).filter((v) => v !== null);
    const fcrList = items.map((x) => x.m.followerConversionRate).filter((v) => v !== null);
    funnelStats[f] = {
      count: items.length,
      avgER: erList.length ? erList.reduce((a, b) => a + b, 0) / erList.length : null,
      avgFCR: fcrList.length ? fcrList.reduce((a, b) => a + b, 0) / fcrList.length : null,
    };
  });

  const insights = buildInsights({ funnelStats, platformRows, formatRows, poorPct });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("dashboard.eyebrow")}${helpButtonHTML("dashboard")}</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="generate-report">${icon("download", { size: 15 })}${t("dashboard.generateReport")}</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("dashboard.newContent")}</button>
      </div>
    </div>

    ${collapsed.has("assets") ? widgetCollapsedHTML("assets", "folder", t("dashboard.brandAssets"), t("dashboard.summary.assets", { logos: (brand.logoAssets || []).length, links: [brand.driveLink, brand.brandbookLink].filter(Boolean).length })) : widgetCardHTML("assets", "folder", t("dashboard.brandAssets"), `
    ${
      !(brand.logoAssets || []).length
        ? `<p class="text-muted" style="font-size:12.5px;margin:-6px 0 12px;">${icon("info", { size: 12 })} ${t("dashboard.brandAssetsHint")}</p>`
        : ""
    }
    <div class="logo-gallery" style="margin-bottom:14px;">
      ${(brand.logoAssets || []).map(logoThumb).join("")}
      <button class="logo-add-tile" id="add-logo" aria-label="${t("dashboard.addLogo")}" title="${t("dashboard.addLogo")}">${icon("plus", { size: 16 })}</button>
      <input type="file" id="logo-file" accept="image/*" multiple style="display:none;" />
    </div>
    <div class="row-2" style="align-items:start;">
      ${assetPanel(brand, "driveLink", t("dashboard.drive"), "folder")}
      ${assetPanel(brand, "brandbookLink", t("dashboard.brandbook"), "book")}
    </div>
    `)}

    ${profileCardHTML(brand, collapsed.has("profile"))}
    ${igConfigured ? accountOverviewHTML(state, collapsed.has("accountOverview")) : ""}

    ${
      !published.length
        ? `<div class="card guided-next-card" style="margin-bottom:24px;">
             <div class="page-eyebrow" style="margin-bottom:6px;">${t("cnt.dash.empty.eyebrow")}</div>
             <h3 style="margin:0 0 6px;">${t("cnt.dash.empty.title")}</h3>
             <p class="text-muted" style="font-size:13px;margin:0 0 14px;max-width:560px;">${t("cnt.dash.empty.body")}</p>
             <div class="flex gap-8" style="flex-wrap:wrap;">
               <a class="btn btn-primary btn-sm" href="#/brand/${brandId}/content-os/creator">${icon("edit", { size: 13 })}${t("cnt.dash.empty.openCreator")}</a>
               <a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/content-os/list">${icon("layers", { size: 13 })}${t("cnt.dash.empty.fillData")}</a>
             </div>
           </div>`
        : ""
    }

    ${collapsed.has("keyStats") ? widgetCollapsedHTML("keyStats", "grid", t("dashboard.keyStats"), t("dashboard.summary.keyStats", { published: published.length, total: all.length, views: formatNumber(totalViews) })) : widgetCardHTML("keyStats", "grid", t("dashboard.keyStats"), `
    <div class="stat-grid" style="margin-bottom:14px;">
      ${stat(t("dashboard.stat.totalContent"), all.length)}
      ${stat(t("dashboard.stat.published"), published.length)}
      ${stat(t("dashboard.stat.scheduled"), scheduled.length)}
      ${stat(t("dashboard.stat.draftsIdeas"), drafts.length)}
    </div>
    <div class="stat-grid" style="margin-bottom:0;">
      ${stat(t("dashboard.stat.totalViews"), formatNumber(totalViews))}
      ${stat(t("dashboard.stat.avgViewsPerPost"), avgViews === null ? "—" : formatNumber(Math.round(avgViews)))}
      ${stat(t("dashboard.stat.avgER"), formatPercent(avgER))}
      ${stat(t("dashboard.stat.avgFCR"), formatPercent(avgFCR))}
    </div>
    `)}

    ${insights.length ? (collapsed.has("insights") ? widgetCollapsedHTML("insights", "bulb", t("dashboard.whatDataTells"), t("dashboard.summary.insights", { count: insights.length })) : widgetCardHTML("insights", "bulb", t("dashboard.whatDataTells"), `
      <div class="card card-tight">
        ${insights.map((i) => `<div class="top-content-row"><span class="icon-btn" style="width:30px;height:30px;color:var(--accent);background:var(--accent-soft);border:none;">${icon("bulb", { size: 15 })}</span><div class="ti"><div class="t" style="white-space:normal;font-weight:600;">${i}</div></div></div>`).join("")}
      </div>
    `)) : ""}

    <div class="row-2" style="align-items:start;">
      <div>
        ${collapsed.has("upNext") ? widgetCollapsedHTML("upNext", "calendar", t("dashboard.upNext"), t("dashboard.summary.upNext", { count: upNext.length })) : widgetCardHTML("upNext", "calendar", t("dashboard.upNext"), `
        <div class="card card-tight" style="margin-bottom:0;">
          ${
            upNext.length
              ? upNext.map((c) => upNextRow(c)).join("")
              : `<div class="table-empty" style="padding:28px;">${t("dashboard.nothingScheduled")}</div>`
          }
        </div>
        `, { extraHead: `<a class="link" href="#/brand/${brand.id}/content-os/calendar">${t("dashboard.calendarLink")}</a>` })}
      </div>
      <div>
        ${collapsed.has("contentHealth") ? widgetCollapsedHTML("contentHealth", "heart", t("dashboard.contentHealth"), t("dashboard.summary.contentHealth", { good: healthCounts.good, poor: healthCounts.poor })) : widgetCardHTML("contentHealth", "heart", t("dashboard.contentHealth"), `
        <div class="card card-tight" style="margin-bottom:0;">
          ${
            evaluated
              ? healthBar(healthCounts, evaluated)
              : `<div class="table-empty" style="padding:28px;">${t("dashboard.publishToSeeHealth")}</div>`
          }
        </div>
        `)}
      </div>
    </div>

    ${collapsed.has("perfByFunnel") ? widgetCollapsedHTML("perfByFunnel", "layers", t("dashboard.perfByFunnel"), t("dashboard.summary.perfByFunnel")) : widgetCardHTML("perfByFunnel", "layers", t("dashboard.perfByFunnel"), `
    <div class="funnel-compare">
      ${FUNNELS.map((f) => funnelCard(f, funnelStats[f])).join("")}
    </div>
    `)}

    ${collapsed.has("topPerforming") ? widgetCollapsedHTML("topPerforming", "target", t("dashboard.topPerforming"), t("dashboard.summary.topPerforming", { count: top.length })) : widgetCardHTML("topPerforming", "target", t("dashboard.topPerforming"), `
    <div class="card card-tight" style="margin-bottom:0;">
      ${
        top.length
          ? top.map((x, i) => topRow(x, i)).join("")
          : `<div class="table-empty" style="padding:28px;">${t("dashboard.noPublishedViews")}</div>`
      }
    </div>
    `, { extraHead: `<a class="link" href="#/brand/${brand.id}/content-os/list">${t("dashboard.viewAllContent")}</a>` })}

    ${
      boosted.length
        ? (collapsed.has("adsPerformance") ? widgetCollapsedHTML("adsPerformance", "chart", t("dashboard.adsPerformance"), t("dashboard.summary.adsPerformance", { count: boosted.length })) : widgetCardHTML("adsPerformance", "chart", t("dashboard.adsPerformance"), `
      <div class="stat-grid" style="margin-bottom:0;">
        ${stat(t("dashboard.stat.boostedPosts"), boosted.length)}
        ${stat(t("dashboard.stat.totalSpend"), `$${formatNumber(adsTotals.spend)}`)}
        ${stat(t("dashboard.stat.totalImpressions"), formatNumber(adsTotals.impressions))}
        ${stat(t("dashboard.stat.totalClicks"), formatNumber(adsTotals.clicks))}
      </div>`))
        : ""
    }

    ${
      boostCandidates.length
        ? (collapsed.has("worthBoosting") ? widgetCollapsedHTML("worthBoosting", "sparkle", t("dashboard.worthBoosting"), t("dashboard.summary.worthBoosting", { count: boostCandidates.length })) : widgetCardHTML("worthBoosting", "sparkle", t("dashboard.worthBoosting"), `
      <p class="text-muted" style="font-size:12.5px;margin:-4px 0 12px;">${t("dashboard.worthBoostingHint")}</p>
      <div class="card card-tight" style="margin-bottom:0;">
        ${boostCandidates.map(boostRow).join("")}
      </div>`))
        : ""
    }

    <div class="row-2" style="align-items:start;">
      <div>
        ${collapsed.has("perfByPlatform") ? widgetCollapsedHTML("perfByPlatform", "chart", t("dashboard.perfByPlatform"), t("dashboard.summary.perfByPlatform", { count: platformRows.length })) : widgetCardHTML("perfByPlatform", "chart", t("dashboard.perfByPlatform"), `
        <div class="card card-tight" style="margin-bottom:0;">
          ${
            platformRows.length
              ? platformRows.map((r) => barRow(r.platform, r.avg, maxPlatformAvg)).join("")
              : `<div class="table-empty" style="padding:28px;">${t("dashboard.noEngagementData")}</div>`
          }
        </div>
        `)}
      </div>
      <div>
        ${collapsed.has("perfByFormat") ? widgetCollapsedHTML("perfByFormat", "grid", t("dashboard.perfByFormat"), t("dashboard.summary.perfByFormat", { count: formatRows.length })) : widgetCardHTML("perfByFormat", "grid", t("dashboard.perfByFormat"), `
        <div class="card card-tight" style="margin-bottom:0;">
          ${
            formatRows.length
              ? formatRows.map((r) => barRow(r.format, r.avg, maxFormatAvg)).join("")
              : `<div class="table-empty" style="padding:28px;">${t("dashboard.noEngagementData")}</div>`
          }
        </div>
        `)}
      </div>
    </div>

    ${collapsed.has("reelsVsTiktok") ? widgetCollapsedHTML("reelsVsTiktok", "play", t("dashboard.reelsVsTiktok"), t("dashboard.summary.reelsVsTiktok", { reels: reelsItems.length, tiktok: tiktokItems.length })) : widgetCardHTML("reelsVsTiktok", "play", t("dashboard.reelsVsTiktok"), `
    <div class="row-2" style="align-items:start;">
      ${reelsTiktokCard(t("dashboard.reels"), buckets.reels, reelsTiktokStats(reelsItems), true)}
      ${reelsTiktokCard("TikTok", buckets.tiktok, reelsTiktokStats(tiktokItems), false)}
    </div>
    `)}
  `;

  qs("#open-insights", root)?.addEventListener("click", () => openInsightsModal({ brandId, onSaved: refresh }));
  qs("#new-content").addEventListener("click", () => {
    openContentEditor({ brandId, onSaved: refresh });
  });
  wireHelpButtons(root);

  qs("#generate-report").addEventListener("click", () => openReportModal(brandId));
  wireWidgetToggle(root, { collapsedList: brand.dashboardCollapsed, save: (next) => updateBrand(brandId, { dashboardCollapsed: next }), refresh });
  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.openContent;
      const item = all.find((c) => c.id === id);
      // Top Performing / Worth Boosting are always published — same
      // "fill in performance, not metadata" default as Content List.
      if (item?.status === "published") openQuickFillModal({ c: item, onSaved: refresh });
      else openContentEditor({ brandId, contentId: id, onSaved: refresh });
    });
  });


  const loadBtn = qs("#load-account-overview");
  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      state.accountLoading = true;
      paint(root, brandId, state, refresh);
      try {
        const ig = brand.instagram;
        const until = new Date();
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const [profile, insightsResult] = await Promise.all([getAccountProfile(ig), getAccountInsights(ig, { since, until })]);
        state.accountData = { profile, ...insightsResult };
      } catch (e) {
        toast(t("dashboard.couldntLoadOverview", { msg: e.message }), "error");
      }
      state.accountLoading = false;
      paint(root, brandId, state, refresh);
    });
  }

  qs("#add-logo", root)?.addEventListener("click", () => qs("#logo-file", root).click());
  qs("#logo-file", root)?.addEventListener("change", async (e) => {
    const files = [...e.target.files];
    for (const file of files) {
      const dataUrl = await resizeImageFile(file, { maxDimension: 500 });
      addBrandLogo(brandId, { dataUrl, name: file.name });
    }
  });
  qsa("[data-remove-logo]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeBrandLogo(brandId, btn.dataset.removeLogo);
      toast(t("dashboard.logoRemoved"));
    });
  });
  qsa(".logo-thumb img", root).forEach((img) => {
    img.addEventListener("click", () => window.open(img.src, "_blank"));
  });

  qsa("[data-edit-resource]", root).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const field = btn.dataset.editResource;
      const label = btn.dataset.label;
      const url = await promptDialog({ title: t("dashboard.linkLabel", { label }), label: t("dashboard.linkUrlLabel", { label }), placeholder: "https://...", value: brand[field] || "" });
      if (!url) return;
      updateBrand(brandId, { [field]: url });
      toast(t("dashboard.linkSaved", { label }));
    });
  });
  qsa("[data-remove-resource]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      updateBrand(brandId, { [btn.dataset.removeResource]: "" });
      toast(t("dashboard.linkRemoved", { label: btn.dataset.label }));
    });
  });
}

// Turns a Google Drive folder/file share link into its embeddable preview
// URL, so files show up right on the dashboard instead of a bare link out.
// Needs the file/folder's sharing set to "Anyone with the link".
function driveEmbedUrl(url) {
  const folder = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return `https://drive.google.com/embeddedfolderview?id=${folder[1]}#grid`;
  const file =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (file) return `https://drive.google.com/file/d/${file[1]}/preview`;
  return null;
}

function assetPanel(brand, field, label, iconName) {
  const url = brand[field];
  if (!url) {
    return `
      <div class="asset-panel empty">
        <button class="resource-chip empty" data-edit-resource="${field}" data-label="${label}">${icon("plus", { size: 13 })}${t("dashboard.addLinkBtn", { label })}</button>
        <div class="hint" style="margin:10px 0 0;">${t("dashboard.driveHint")}</div>
      </div>`;
  }
  const embedUrl = driveEmbedUrl(url);
  return `
    <div class="asset-panel">
      <div class="asset-panel-head">
        <span class="flex items-center gap-8" style="font-weight:700;font-size:13.5px;">${icon(iconName, { size: 15 })}${label}</span>
        <div class="flex items-center gap-8">
          <a class="btn btn-ghost btn-sm" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${icon("arrowRight", { size: 12 })}${t("dashboard.open")}</a>
          <button class="chip-icon-btn" data-edit-resource="${field}" data-label="${label}" aria-label="${t("dashboard.editLink", { label })}">${icon("edit", { size: 12 })}</button>
          <button class="chip-icon-btn" data-remove-resource="${field}" data-label="${label}" aria-label="${t("dashboard.removeLink", { label })}">${icon("x", { size: 12 })}</button>
        </div>
      </div>
      ${
        embedUrl
          ? `<iframe class="asset-embed" src="${embedUrl}" loading="lazy" title="${label}"></iframe>`
          : `<div class="asset-embed-fallback">${t("dashboard.previewUnavailable")}</div>`
      }
    </div>`;
}

function logoThumb(logo) {
  return `
    <div class="logo-thumb" title="${escapeAttr(logo.name)}">
      <img src="${logo.dataUrl}" alt="${escapeAttr(logo.name)}" />
      <a class="logo-download" href="${logo.dataUrl}" download="${escapeAttr(logo.name || "logo")}" aria-label="${t("dashboard.downloadLogo", { name: escapeAttr(logo.name) })}">${icon("download", { size: 10 })}</a>
      <button class="logo-remove" data-remove-logo="${logo.id}" aria-label="${t("dashboard.removeLogo", { name: escapeAttr(logo.name) })}">${icon("x", { size: 10 })}</button>
    </div>
  `;
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

// widgetCardHTML/widgetCollapsedHTML now live in js/widget-card.js, shared
// with Beranda (brands.js, beginner-home.js, brand-home.js) and the
// campaign detail widgets — see that file for the full picture.

// Ads views are display-only here — added on top of organic for a "how many
// people actually saw this, total" figure, never fed back into engagement
// rate math (that stays organic-only, computed elsewhere from
// content.performance directly).
function reelsTiktokCard(label, bucket, stats, showFacebookSplit) {
  if (!bucket) {
    return `<div><div class="section-title" style="margin-top:0;"><h2>${label}</h2></div><div class="card card-tight"><p class="text-muted" style="font-size:12.5px;margin:0;padding:14px;">${t("dashboard.notSetUp", { label, extra: label.includes("Reels") ? t("cnt.dash.formatsSuffix") : "" })}</p></div></div>`;
  }
  // Reels can crosspost to Facebook, so "without Facebook" (Instagram's own
  // number) and "with Facebook" (combined) are both worth seeing side by
  // side — TikTok has no Facebook angle, so it only needs the simpler
  // Organic/Ads/Combined set.
  const statsRow = showFacebookSplit
    ? `${stat(t("dashboard.stat.igOnly"), formatNumber(stats.instagramOnly))}${stat(t("dashboard.stat.plusFacebook"), formatNumber(stats.organic))}${stat(t("dashboard.stat.plusAds"), formatNumber(stats.ads))}${stat(t("dashboard.stat.combinedViews"), formatNumber(stats.combined))}`
    : `${stat(t("dashboard.stat.organicViews"), formatNumber(stats.organic))}${stat(t("dashboard.stat.adsViews"), formatNumber(stats.ads))}${stat(t("dashboard.stat.combinedViews"), formatNumber(stats.combined))}`;
  return `
    <div>
      <div class="section-title" style="margin-top:0;">
        <h2>${label}</h2>
        <span class="text-muted" style="font-size:12px;">${t("dashboard.publishedCount", { count: stats.count })}</span>
      </div>
      <div class="card card-tight">
        <div class="stat-grid">${statsRow}</div>
      </div>
    </div>`;
}

function upNextRow(c) {
  return `
    <div class="top-content-row" data-open-content="${c.id}" style="cursor:pointer;">
      <div class="ti">
        <div class="t">${escapeText(c.title || t("common.untitled"))}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(c.scheduleDate)}</div>
      </div>
      <span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span>
    </div>
  `;
}

function topRow(x, i) {
  return `
    <div class="top-content-row" data-open-content="${x.c.id}" style="cursor:pointer;">
      <div class="rank">${i + 1}</div>
      <div class="ti">
        <div class="t">${escapeText(x.c.title || t("common.untitled"))}</div>
        <div class="m">${formatNumber(x.c.performance.views)} views · ${x.m.engagementRate !== null ? formatPercent(x.m.engagementRate) + " ER" : "—"}</div>
      </div>
      ${x.m.health ? `<span class="health-badge health-${x.m.health}"><span class="health-dot"></span></span>` : ""}
    </div>
  `;
}


function boostRow(x) {
  return `
    <div class="top-content-row" data-open-content="${x.c.id}" style="cursor:pointer;">
      <span class="health-badge health-good" style="padding:6px 10px;"><span class="health-dot"></span></span>
      <div class="ti">
        <div class="t">${escapeText(x.c.title || t("common.untitled"))}</div>
        <div class="m">${formatPercent(x.m.engagementRate)} ER · ${formatNumber(x.c.performance.views)} views</div>
      </div>
      <span class="tag tag-${x.c.funnel.toLowerCase()}">${x.c.funnel}</span>
    </div>
  `;
}

function barRow(label, value, max) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return `
    <div class="bar-row">
      <div class="bl">${escapeText(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-val">${formatPercent(value)}</div>
    </div>
  `;
}

function healthBar(counts, total) {
  const seg = (key, color) => {
    const pct = Math.round((counts[key] / total) * 100);
    return `<div style="width:${pct}%;background:var(--health-${color});height:100%;"></div>`;
  };
  return `
    <div style="display:flex;height:14px;border-radius:999px;overflow:hidden;margin-bottom:16px;">
      ${seg("good", "good")}${seg("average", "average")}${seg("poor", "poor")}
    </div>
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-good);display:inline-block;margin-right:6px;"></span>${t("dashboard.healthy")}</span><span class="v">${counts.good}</span></div>
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-average);display:inline-block;margin-right:6px;"></span>${t("dashboard.average")}</span><span class="v">${counts.average}</span></div>
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-poor);display:inline-block;margin-right:6px;"></span>${t("dashboard.underperforming")}</span><span class="v">${counts.poor}</span></div>
  `;
}

function funnelCard(funnel, stats) {
  return `
    <div class="funnel-card">
      <div class="fh">
        <span class="tag tag-${funnel.toLowerCase()}">${funnel}</span>
        <span class="text-muted" style="font-size:12.5px;">${t("dashboard.funnelContentCount", { count: stats.count })}</span>
      </div>
      <div class="metric-row"><span class="text-muted" style="font-size:13px;">${t("dashboard.stat.avgER")}</span><span class="v">${formatPercent(stats.avgER)}</span></div>
      <div class="metric-row"><span class="text-muted" style="font-size:13px;">${t("dashboard.stat.avgFCR")}</span><span class="v">${formatPercent(stats.avgFCR)}</span></div>
    </div>
  `;
}

// Account-level numbers the user records themselves (or the API fills):
// the home of followers/reach/profile visits for every campaign milestone
// that reads profile.*. Always shown — with or without the Instagram API.
function profileCardHTML(brand, collapsed) {
  const ins = getBrandInsights(brand, "instagram");
  if (collapsed) return widgetCollapsedHTML("profile", "users", t("cnt.dash.profile.title"), ins?.followers != null ? t("dashboard.summary.profile", { followers: formatNumber(ins.followers) }) : t("dashboard.summary.profileEmpty"));
  const hist = (brand.insightsHistory || []).filter((h) => h.platform === "instagram" && Number.isFinite(h.followers));
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const delta = ins && prev ? ins.followers - prev.followers : null;
  const spark = hist.length > 1 ? sparklineHTML(hist.slice(-12).map((h) => h.followers)) : "";
  const sub = ins?.updatedAt
    ? `${t("cnt.dash.profile.recorded", { age: escapeText(ageLabel(ins.updatedAt)) })}${ins.source === "instagram" ? t("cnt.dash.profile.fromApi") : ""}${ins.updatedAt < Date.now() - STALE_DAYS * 86400000 ? ` · <span class="cd-stale">${t("cnt.dash.profile.stale")}</span>` : ""}`
    : t("cnt.dash.profile.never");
  return widgetCardHTML("profile", "users", t("cnt.dash.profile.title"), `
      <div class="stat-grid" style="margin-bottom:0;">
        ${stat(t("cnt.dash.profile.followers"), ins?.followers != null ? formatNumber(ins.followers) : "—")}
        ${stat(t("cnt.dash.profile.change"), delta === null ? "—" : `${delta >= 0 ? "+" : ""}${formatNumber(delta)}`)}
        ${stat(t("cnt.dash.profile.reach30"), ins?.reach30d != null ? formatNumber(ins.reach30d) : "—")}
        ${stat(t("cnt.dash.profile.visits"), ins?.profileVisits30d != null ? formatNumber(ins.profileVisits30d) : "—")}
      </div>
      ${spark}
    `, { sub, extraHead: `<button class="btn btn-secondary btn-sm" id="open-insights">${icon("refresh", { size: 13 })}${ins ? t("cnt.dash.profile.update") : t("cnt.dash.profile.fill")}</button>` });
}
function sparklineHTML(values) {
  const w = 240;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - (max === min ? h / 2 : ((v - min) / (max - min)) * (h - 8))}`).join(" ");
  return `<svg class="cd-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="margin-top:12px;display:block;max-width:100%;"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts}"/></svg>`;
}

function accountOverviewHTML(state, collapsed) {
  if (collapsed) return widgetCollapsedHTML("accountOverview", "chart", t("dashboard.accountOverview"), state.accountData ? t("dashboard.summary.accountOverview") : t("dashboard.summary.accountOverviewEmpty"));
  if (state.accountLoading) {
    return widgetCardHTML("accountOverview", "chart", t("dashboard.accountOverview"), `<div class="ocr-status" style="margin:0;"><div class="spinner"></div><span>${t("dashboard.loadingOverview")}</span></div>`);
  }
  if (!state.accountData) {
    return widgetCardHTML("accountOverview", "chart", t("dashboard.accountOverview"), `
        <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("dashboard.accountOverviewHint")}</p>
        <button class="btn btn-secondary btn-sm" id="load-account-overview">${icon("refresh", { size: 13 })}${t("dashboard.loadAccountOverview")}</button>
      `);
  }
  const { profile, metrics, warnings } = state.accountData;
  return widgetCardHTML("accountOverview", "chart", t("dashboard.accountOverview"), `
      <div class="stat-grid" style="margin-bottom:0;">
        ${stat(t("dashboard.stat.followers"), formatNumber(profile.followers_count))}
        ${stat(t("dashboard.stat.followerGrowth"), metrics.followerGrowth !== undefined ? `${metrics.followerGrowth >= 0 ? "+" : ""}${formatNumber(metrics.followerGrowth)}` : "—")}
        ${stat(t("dashboard.stat.reach"), metrics.reach !== undefined ? formatNumber(metrics.reach) : "—")}
        ${stat(t("dashboard.stat.profileViews"), metrics.profileViews !== undefined ? formatNumber(metrics.profileViews) : "—")}
        ${stat(t("dashboard.stat.accountsEngaged"), metrics.accountsEngaged !== undefined ? formatNumber(metrics.accountsEngaged) : "—")}
      </div>
      ${warnings?.length ? `<p class="text-faint" style="font-size:11.5px;margin:12px 0 0;">${warnings.join(" · ")}</p>` : ""}
    `, { sub: t("dashboard.last30Days", { username: profile.username || "?" }), extraHead: `<button class="btn btn-ghost btn-sm" id="load-account-overview">${icon("refresh", { size: 13 })}${t("dashboard.refresh")}</button>` });
}

function buildInsights({ funnelStats, platformRows, formatRows, poorPct }) {
  const out = [];
  const withData = FUNNELS.map((f) => ({ funnel: f, ...funnelStats[f] })).filter((f) => f.avgER !== null);
  if (withData.length >= 2) {
    const best = [...withData].sort((a, b) => b.avgER - a.avgER)[0];
    const worst = [...withData].sort((a, b) => a.avgER - b.avgER)[0];
    if (best.funnel !== worst.funnel) {
      out.push(t("dashboard.insight.bestWorst", { best: best.funnel, bestPct: formatPercent(best.avgER), worst: worst.funnel, worstPct: formatPercent(worst.avgER) }));
    }
  }
  withData.forEach((f) => {
    if (f.avgER !== null && f.avgFCR !== null && f.avgER > 6 && f.avgFCR < 1.5) {
      out.push(t("dashboard.insight.highErLowFcr", { funnel: f.funnel }));
    }
  });
  if (formatRows.length >= 2) {
    out.push(t("dashboard.insight.strongestFormat", { format: formatRows[0].format, pct: formatPercent(formatRows[0].avg) }));
  }
  if (platformRows.length >= 2) {
    out.push(t("dashboard.insight.outperformingPlatform", { platform: platformRows[0].platform, pct: formatPercent(platformRows[0].avg) }));
  }
  if (poorPct !== null && poorPct >= 40) {
    out.push(t("dashboard.insight.poorPct", { pct: formatPercent(poorPct, 0) }));
  }
  return out.slice(0, 4);
}
