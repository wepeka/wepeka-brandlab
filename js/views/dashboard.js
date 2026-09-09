import { getBrand, listContent, getSettings, onChange, updateBrand, addBrandLogo, removeBrandLogo, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon } from "../icons.js";
import { formatNumber, formatPercent, formatDate, resizeImageFile, qs, qsa, toast } from "../dom.js";
import { promptDialog } from "../modals.js";
import { openContentEditor } from "./content-editor.js";
import { getAccountProfile, getAccountInsights } from "../instagram.js";
import { openReportModal } from "./report.js";

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
  const igConfigured = !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
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
    const p = x.c.platform || "Other";
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
    const f = x.c.format || "Unspecified";
    formatStats[f] = formatStats[f] || [];
    formatStats[f].push(x.m.engagementRate);
  });
  const formatRows = Object.entries(formatStats)
    .map(([format, list]) => ({ format, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);
  const maxFormatAvg = Math.max(1, ...formatRows.map((r) => r.avg));

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
        <div class="page-eyebrow">Brand Dashboard</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="generate-report">${icon("download", { size: 15 })}Generate Report</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}New Content</button>
      </div>
    </div>

    <div class="section-title" style="margin-top:0;"><h2>Brand Assets</h2></div>
    ${
      !(brand.logoAssets || []).length
        ? `<p class="text-muted" style="font-size:12.5px;margin:-6px 0 12px;">${icon("info", { size: 12 })} Add this brand's logo and mascot here if you have them — optional, but the AI Thumbnail Creator will use the first one to help keep generated thumbnails on-brand.</p>`
        : ""
    }
    <div class="logo-gallery" style="margin-bottom:14px;">
      ${(brand.logoAssets || []).map(logoThumb).join("")}
      <button class="logo-add-tile" id="add-logo" aria-label="Add logo asset" title="Add logo">${icon("plus", { size: 16 })}</button>
      <input type="file" id="logo-file" accept="image/*" multiple style="display:none;" />
    </div>
    <div class="row-2" style="align-items:start; margin-bottom:28px;">
      ${assetPanel(brand, "driveLink", "Drive", "folder")}
      ${assetPanel(brand, "brandbookLink", "Brandbook", "book")}
    </div>

    ${igConfigured ? accountOverviewHTML(state) : ""}

    <div class="stat-grid">
      ${stat("Total Content", all.length)}
      ${stat("Published", published.length)}
      ${stat("Scheduled", scheduled.length)}
      ${stat("Drafts & Ideas", drafts.length)}
    </div>
    <div class="stat-grid">
      ${stat("Total Views", formatNumber(totalViews))}
      ${stat("Avg. Views / Post", avgViews === null ? "—" : formatNumber(Math.round(avgViews)))}
      ${stat("Avg. Engagement Rate", formatPercent(avgER))}
      ${stat("Avg. Follower Conversion", formatPercent(avgFCR))}
    </div>

    ${insights.length ? `
      <div class="section-title" style="margin-top:8px;"><h2>What the data is telling you</h2></div>
      <div class="card card-tight" style="margin-bottom:28px;">
        ${insights.map((i) => `<div class="top-content-row"><span class="icon-btn" style="width:30px;height:30px;color:var(--accent);background:var(--accent-soft);border:none;">${icon("bulb", { size: 15 })}</span><div class="ti"><div class="t" style="white-space:normal;font-weight:600;">${i}</div></div></div>`).join("")}
      </div>
    ` : ""}

    <div class="row-2" style="align-items:start;">
      <div>
        <div class="section-title" style="margin-top:0;">
          <h2>Up Next</h2>
          <a class="link" href="#/brand/${brand.id}/calendar">Calendar →</a>
        </div>
        <div class="card card-tight">
          ${
            upNext.length
              ? upNext.map((c) => upNextRow(c)).join("")
              : `<div class="table-empty" style="padding:28px;">Nothing scheduled yet.</div>`
          }
        </div>
      </div>
      <div>
        <div class="section-title" style="margin-top:0;">
          <h2>Content Health</h2>
        </div>
        <div class="card card-tight">
          ${
            evaluated
              ? healthBar(healthCounts, evaluated)
              : `<div class="table-empty" style="padding:28px;">Publish content and add insights to see health.</div>`
          }
        </div>
      </div>
    </div>

    <div class="section-title">
      <h2>Performance by Funnel</h2>
    </div>
    <div class="funnel-compare">
      ${FUNNELS.map((f) => funnelCard(f, funnelStats[f])).join("")}
    </div>

    <div class="section-title"><h2>Top Performing Content</h2></div>
    <div class="card card-tight" style="margin-bottom:28px;">
      ${
        top.length
          ? top.map((x, i) => topRow(x, i)).join("")
          : `<div class="table-empty" style="padding:28px;">No published content with views yet.</div>`
      }
    </div>

    ${
      boosted.length
        ? `
      <div class="section-title"><h2>Ads Performance</h2></div>
      <div class="stat-grid" style="margin-bottom:28px;">
        ${stat("Boosted Posts", boosted.length)}
        ${stat("Total Spend", `$${formatNumber(adsTotals.spend)}`)}
        ${stat("Total Impressions", formatNumber(adsTotals.impressions))}
        ${stat("Total Clicks", formatNumber(adsTotals.clicks))}
      </div>`
        : ""
    }

    ${
      boostCandidates.length
        ? `
      <div class="section-title"><h2>Worth Boosting</h2></div>
      <p class="text-muted" style="font-size:12.5px;margin:-8px 0 12px;">Healthy organic performers not on ads yet — proven without spend, so a reasonable place to put budget first.</p>
      <div class="card card-tight" style="margin-bottom:28px;">
        ${boostCandidates.map(boostRow).join("")}
      </div>`
        : ""
    }

    <div class="row-2" style="align-items:start;">
      <div>
        <div class="section-title"><h2>Performance by Platform</h2></div>
        <div class="card card-tight">
          ${
            platformRows.length
              ? platformRows.map((r) => barRow(r.platform, r.avg, maxPlatformAvg)).join("")
              : `<div class="table-empty" style="padding:28px;">No engagement data yet.</div>`
          }
        </div>
      </div>
      <div>
        <div class="section-title"><h2>Performance by Format</h2></div>
        <div class="card card-tight">
          ${
            formatRows.length
              ? formatRows.map((r) => barRow(r.format, r.avg, maxFormatAvg)).join("")
              : `<div class="table-empty" style="padding:28px;">No engagement data yet.</div>`
          }
        </div>
      </div>
    </div>
  `;

  qs("#new-content").addEventListener("click", () => {
    openContentEditor({ brandId, onSaved: refresh });
  });
  qs("#generate-report").addEventListener("click", () => openReportModal(brandId));
  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
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
        toast(`Couldn't load account overview: ${e.message}`, "error");
      }
      state.accountLoading = false;
      paint(root, brandId, state, refresh);
    });
  }

  qs("#add-logo", root).addEventListener("click", () => qs("#logo-file", root).click());
  qs("#logo-file", root).addEventListener("change", async (e) => {
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
      toast("Logo removed");
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
      const url = await promptDialog({ title: `${label} Link`, label: `${label} URL`, placeholder: "https://...", value: brand[field] || "" });
      if (!url) return;
      updateBrand(brandId, { [field]: url });
      toast(`${label} link saved`);
    });
  });
  qsa("[data-remove-resource]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      updateBrand(brandId, { [btn.dataset.removeResource]: "" });
      toast(`${btn.dataset.label} link removed`);
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
        <button class="resource-chip empty" data-edit-resource="${field}" data-label="${label}">${icon("plus", { size: 13 })}Add ${label} Link</button>
        <div class="hint" style="margin:10px 0 0;">Paste a Google Drive share link (set to "Anyone with the link") and it'll preview right here.</div>
      </div>`;
  }
  const embedUrl = driveEmbedUrl(url);
  return `
    <div class="asset-panel">
      <div class="asset-panel-head">
        <span class="flex items-center gap-8" style="font-weight:700;font-size:13.5px;">${icon(iconName, { size: 15 })}${label}</span>
        <div class="flex items-center gap-8">
          <a class="btn btn-ghost btn-sm" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${icon("arrowRight", { size: 12 })}Open</a>
          <button class="chip-icon-btn" data-edit-resource="${field}" data-label="${label}" aria-label="Edit ${label} link">${icon("edit", { size: 12 })}</button>
          <button class="chip-icon-btn" data-remove-resource="${field}" data-label="${label}" aria-label="Remove ${label} link">${icon("x", { size: 12 })}</button>
        </div>
      </div>
      ${
        embedUrl
          ? `<iframe class="asset-embed" src="${embedUrl}" loading="lazy" title="${label}"></iframe>`
          : `<div class="asset-embed-fallback">Preview isn't available for this link — use Open to view it.</div>`
      }
    </div>`;
}

function logoThumb(logo) {
  return `
    <div class="logo-thumb" title="${escapeAttr(logo.name)}">
      <img src="${logo.dataUrl}" alt="${escapeAttr(logo.name)}" />
      <a class="logo-download" href="${logo.dataUrl}" download="${escapeAttr(logo.name || "logo")}" aria-label="Download ${escapeAttr(logo.name)}">${icon("download", { size: 10 })}</a>
      <button class="logo-remove" data-remove-logo="${logo.id}" aria-label="Remove ${escapeAttr(logo.name)}">${icon("x", { size: 10 })}</button>
    </div>
  `;
}

function escapeAttr(s) {
  return (s || "").replace(/"/g, "&quot;");
}

function stat(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function upNextRow(c) {
  return `
    <div class="top-content-row" data-open-content="${c.id}" style="cursor:pointer;">
      <div class="ti">
        <div class="t">${escapeText(c.title || "Untitled")}</div>
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
        <div class="t">${escapeText(x.c.title || "Untitled")}</div>
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
        <div class="t">${escapeText(x.c.title || "Untitled")}</div>
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
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-good);display:inline-block;margin-right:6px;"></span>Healthy</span><span class="v">${counts.good}</span></div>
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-average);display:inline-block;margin-right:6px;"></span>Average</span><span class="v">${counts.average}</span></div>
    <div class="kv"><span class="k"><span class="health-dot" style="color:var(--health-poor);display:inline-block;margin-right:6px;"></span>Underperforming</span><span class="v">${counts.poor}</span></div>
  `;
}

function funnelCard(funnel, stats) {
  return `
    <div class="funnel-card">
      <div class="fh">
        <span class="tag tag-${funnel.toLowerCase()}">${funnel}</span>
        <span class="text-muted" style="font-size:12.5px;">${stats.count} content</span>
      </div>
      <div class="metric-row"><span class="text-muted" style="font-size:13px;">Avg. Engagement Rate</span><span class="v">${formatPercent(stats.avgER)}</span></div>
      <div class="metric-row"><span class="text-muted" style="font-size:13px;">Avg. Follower Conversion</span><span class="v">${formatPercent(stats.avgFCR)}</span></div>
    </div>
  `;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function accountOverviewHTML(state) {
  if (state.accountLoading) {
    return `<div class="card" style="margin-bottom:28px;"><div class="ocr-status" style="margin:0;"><div class="spinner"></div><span>Loading account overview…</span></div></div>`;
  }
  if (!state.accountData) {
    return `
      <div class="card" style="margin-bottom:28px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <h3 style="font-size:15px;margin-bottom:4px;">Account Overview</h3>
          <p class="text-muted" style="font-size:12.5px;margin:0;">See this brand's whole Instagram account — not just the content you've tracked here.</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="load-account-overview">${icon("refresh", { size: 13 })}Load Account Overview</button>
      </div>
    `;
  }
  const { profile, metrics, warnings } = state.accountData;
  return `
    <div class="card" style="margin-bottom:28px;">
      <div class="flex items-center justify-between" style="margin-bottom:14px;">
        <h3 style="font-size:15px;">Account Overview <span class="text-faint" style="font-weight:400;font-size:12px;">— @${profile.username || "?"}, last 30 days</span></h3>
        <button class="btn btn-ghost btn-sm" id="load-account-overview">${icon("refresh", { size: 13 })}Refresh</button>
      </div>
      <div class="stat-grid">
        ${stat("Followers", formatNumber(profile.followers_count))}
        ${stat("Follower Growth (30d)", metrics.followerGrowth !== undefined ? `${metrics.followerGrowth >= 0 ? "+" : ""}${formatNumber(metrics.followerGrowth)}` : "—")}
        ${stat("Reach (30d)", metrics.reach !== undefined ? formatNumber(metrics.reach) : "—")}
        ${stat("Profile Views (30d)", metrics.profileViews !== undefined ? formatNumber(metrics.profileViews) : "—")}
        ${stat("Accounts Engaged (30d)", metrics.accountsEngaged !== undefined ? formatNumber(metrics.accountsEngaged) : "—")}
      </div>
      ${warnings?.length ? `<p class="text-faint" style="font-size:11.5px;margin:12px 0 0;">${warnings.join(" · ")}</p>` : ""}
    </div>
  `;
}

function buildInsights({ funnelStats, platformRows, formatRows, poorPct }) {
  const out = [];
  const withData = FUNNELS.map((f) => ({ funnel: f, ...funnelStats[f] })).filter((f) => f.avgER !== null);
  if (withData.length >= 2) {
    const best = [...withData].sort((a, b) => b.avgER - a.avgER)[0];
    const worst = [...withData].sort((a, b) => a.avgER - b.avgER)[0];
    if (best.funnel !== worst.funnel) {
      out.push(`${best.funnel} content is performing best right now, averaging ${formatPercent(best.avgER)} engagement — ${worst.funnel} trails at ${formatPercent(worst.avgER)}.`);
    }
  }
  withData.forEach((f) => {
    if (f.avgER !== null && f.avgFCR !== null && f.avgER > 6 && f.avgFCR < 1.5) {
      out.push(`${f.funnel} content has high engagement but low follower conversion — great reach, but it isn't turning viewers into followers yet.`);
    }
  });
  if (formatRows.length >= 2) {
    out.push(`"${formatRows[0].format}" is your strongest format, averaging ${formatPercent(formatRows[0].avg)} engagement.`);
  }
  if (platformRows.length >= 2) {
    out.push(`${platformRows[0].platform} is outperforming your other platforms, at ${formatPercent(platformRows[0].avg)} average engagement.`);
  }
  if (poorPct !== null && poorPct >= 40) {
    out.push(`${formatPercent(poorPct, 0)} of your published content is underperforming — worth revisiting format or topic choices.`);
  }
  return out.slice(0, 4);
}
