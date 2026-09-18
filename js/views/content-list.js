import { getBrand, listContent, getContent, listCampaigns, getSettings, onChange, archiveContent, deleteContent, updateContent, combinePlatformMetrics, METRIC_KEYS, STATUS_LABELS, FUNNELS } from "../store.js";
import { getMode } from "../mode.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon, platformIcon } from "../icons.js";
import { formatNumber, formatPercent, formatDate, debounce, resizeImageFile, qs, qsa, toast, openMenu, closeMenu, escapeHtml as escapeText } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { confirmDialog, openModal, closeOverlay } from "../modals.js";
import { openCelebration } from "../celebrate.js";
import { openInstagramImportPicker } from "./instagram-import.js";
import { openFacebookImportPicker } from "./facebook-import.js";
import { syncInstagramPerformance } from "../instagram-sync.js";
import { canUseInstagramApi } from "../account.js";
import { analyzeScreenshot } from "../ocr.js";
import { t } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { consumeNavContext } from "../nav-context.js";

// Opening the Content tab asks "what do you want to check?" first (three
// big choices) instead of dropping straight into a raw table. Ideas/drafts
// are meant to be worked on in the Creator tab — this is where you check
// what's live vs. still in progress.
const VIEWS = [
  { key: "all", labelKey: "contentList.views.all", icon: "grid", test: () => true },
  { key: "published", labelKey: "contentList.views.published", icon: "check", test: (s) => s === "published" },
  { key: "drafts", labelKey: "contentList.views.drafts", icon: "edit", test: (s) => s !== "published" },
];

// Which platforms' numbers get summed into the Views/Engagement columns —
// separate from row filtering. Defaults to every platform that can actually
// report numbers today (TikTok has no fetch integration yet, so it stays
// out of the default combine even though it's listed for the future).
const METRIC_PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok", disabled: true },
];

export function render(root, { brandId }) {
  const state = { view: null, selectMode: false, search: "", funnel: "", format: "", platform: "", age: "", campaignId: "", sort: "updated", dir: "desc", selected: new Set(), metricPlatforms: new Set(["instagram", "facebook"]) };
  // Arriving from a campaign: skip the chooser, filter to that campaign,
  // and for "Isi performa" open Quick Fill on the piece straight away.
  const navCtx = consumeNavContext();
  if (navCtx?.campaignId) {
    state.campaignId = navCtx.campaignId;
    state.view = navCtx.status === "published" ? "published" : navCtx.status ? "drafts" : "all";
  }
  if (navCtx?.intent === "performance" && navCtx.contentId) {
    state.view = "published";
    setTimeout(() => {
      const c = getContent(navCtx.contentId);
      if (c) openQuickFillModal({ c, onSaved: refresh });
    }, 0);
  }
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

// A row's performance, recombined from just the selected platforms — falls
// back to the saved combined total for content that has no per-platform
// breakdown yet (manual entry, OCR, or old data from before this existed),
// so switching the platform filter never blanks out numbers that just
// haven't been broken down.
function displayPerformance(c, metricPlatforms) {
  const byPlatform = c.performanceByPlatform;
  const hasBreakdown = byPlatform && Object.values(byPlatform).some((p) => p && Object.keys(p).length);
  if (!hasBreakdown) return c.performance;
  const subset = {};
  Object.entries(byPlatform).forEach(([key, val]) => { if (metricPlatforms.has(key)) subset[key] = val; });
  return { ...c.performance, ...combinePlatformMetrics(subset) };
}

// Groups Published content by how long ago it went live — a 60-item flat
// table of everything you've ever posted is hard to scan for "what needs a
// fresh look," a quick age cut isn't.
const AGE_BUCKETS = [
  { key: "week", labelKey: "contentList.age.week", maxDays: 7 },
  { key: "month", labelKey: "contentList.age.month", maxDays: 30 },
  { key: "old", labelKey: "contentList.age.old", maxDays: Infinity },
];
function ageBucket(c) {
  if (!c.publishedDate) return null;
  const days = (Date.now() - new Date(c.publishedDate + "T00:00:00").getTime()) / 86400000;
  return AGE_BUCKETS.find((b) => days <= b.maxDays)?.key || "old";
}

// The Quick Engagement Update queue: published, and either never confirmed
// or not re-checked in the last week — old numbers quietly going stale is
// the whole reason this widget exists.
const STALE_DAYS = 7;
function needsEngagementUpdate(c) {
  if (c.status !== "published") return false;
  if (!c.performance?.confirmedAt) return true;
  return (Date.now() - c.performance.confirmedAt) / 86400000 > STALE_DAYS;
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  if (!state.view) {
    renderChooser(root, brandId, state, refresh, brand);
    return;
  }
  renderTable(root, brandId, state, refresh, brand);
}

function renderChooser(root, brandId, state, refresh, brand) {
  const all = listContent(brandId);
  const counts = {
    all: all.length,
    published: all.filter((c) => c.status === "published").length,
    drafts: all.filter((c) => c.status !== "published").length,
  };

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("contentList.eyebrow")}${helpButtonHTML("content-list")}</div>
        <h1>${brand.name}</h1>
      </div>
      <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("contentList.newContent")}</button>
    </div>
    <p class="page-sub" style="margin-bottom:24px;">${t("contentList.chooserSub")}</p>
    <div class="content-view-grid">
      ${VIEWS.map(
        (v) => `
        <button class="content-view-card" data-view="${v.key}">
          <div class="icon-wrap">${icon(v.icon, { size: 24 })}</div>
          <h3>${t(v.labelKey)}</h3>
          <p>${t("contentList.pieceCount", { count: counts[v.key] })}</p>
        </button>`
      ).join("")}
    </div>
  `;

  wireHelpButtons(root);

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  qsa("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      paint(root, brandId, state, refresh);
    });
  });
}

function renderTable(root, brandId, state, refresh, brand) {
  const settings = getSettings();
  let items = listContent(brandId).map((c) => {
    const perf = displayPerformance(c, state.metricPlatforms);
    return { c, perf, m: computeContentMetrics({ ...c, performance: perf }, settings) };
  });

  const activeView = VIEWS.find((v) => v.key === state.view) || VIEWS[0];
  items = items.filter((x) => activeView.test(x.c.status));

  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    items = items.filter((x) => (x.c.title + " " + x.c.idea).toLowerCase().includes(q));
  }
  if (state.funnel) items = items.filter((x) => x.c.funnel === state.funnel);
  if (state.format) items = items.filter((x) => x.c.format === state.format);
  if (state.platform) items = items.filter((x) => x.c.platform === state.platform);
  if (state.view === "published" && state.age) items = items.filter((x) => ageBucket(x.c) === state.age);
  if (state.campaignId) items = items.filter((x) => x.c.campaignId === state.campaignId);

  items.sort((a, b) => {
    let av, bv;
    switch (state.sort) {
      case "title": av = a.c.title.toLowerCase(); bv = b.c.title.toLowerCase(); break;
      case "date": av = a.c.scheduleDate || a.c.publishedDate || ""; bv = b.c.scheduleDate || b.c.publishedDate || ""; break;
      case "views": av = a.perf.views || 0; bv = b.perf.views || 0; break;
      case "er": av = a.m.engagementRate ?? -1; bv = b.m.engagementRate ?? -1; break;
      default: av = a.c.updatedAt; bv = b.c.updatedAt;
    }
    if (av < bv) return state.dir === "asc" ? -1 : 1;
    if (av > bv) return state.dir === "asc" ? 1 : -1;
    return 0;
  });

  // Drop selections for items no longer visible/existing, so the bulk bar
  // count never lies about what's actually selectable right now.
  const visibleIds = new Set(items.map((x) => x.c.id));
  [...state.selected].forEach((id) => { if (!visibleIds.has(id)) state.selected.delete(id); });

  const campaignsById = new Map(listCampaigns(brandId).map((c) => [c.id, c]));
  // "Filter" button badge only counts what's inside that consolidated panel
  // (Funnel/Format/Platform/Age) — Campaign has its own always-visible
  // dropdown, so it isn't double-counted there, but it does still count
  // toward whether "Clear filters" shows up and what it resets.
  const panelFilterCount = (state.funnel ? 1 : 0) + (state.format ? 1 : 0) + (state.platform ? 1 : 0) + (state.age ? 1 : 0);
  const activeFilters = panelFilterCount + (state.campaignId ? 1 : 0);
  const igAllowed = canUseInstagramApi();
  const igConfigured = igAllowed && !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
  const igUnavailableNote = igAllowed ? t("contentList.connectInEditBrand") : t("contentList.comingSoon");
  const fbConfigured = !!(brand.facebook?.pageId && brand.facebook?.pageAccessToken);
  const allContentCount = listContent(brandId, { includeArchived: true }).length;
  const isPublishedView = state.view === "published";

  // Best performers + who needs a fresh number — both only mean anything
  // once something's actually published, so both stay scoped to that tab
  // rather than cluttering the Drafts/All views.
  const publishedAll = isPublishedView ? listContent(brandId).filter((c) => c.status === "published") : [];
  const topPerformers = publishedAll
    .map((c) => ({ c, m: computeContentMetrics(c, settings) }))
    .filter((x) => x.m.health === "good")
    .sort((a, b) => (b.m.engagementRate ?? 0) - (a.m.engagementRate ?? 0))
    .slice(0, 3);
  const staleQueue = publishedAll.filter(needsEngagementUpdate).sort((a, b) => (a.publishedDate || "").localeCompare(b.publishedDate || ""));

  // Pemula: the list is for finding and opening content. Import, bulk
  // select, metric-platform switch, top-performer tiles and the ⋯ menu are
  // Pro tooling — hidden here, unchanged there.
  const guided = getMode() === "guided";
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow"><a href="#" id="back-to-chooser" style="color:inherit;">${t("contentList.backToChooser")}</a></div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        ${
          isPublishedView
            ? `<button class="btn btn-secondary" id="update-engagement">${icon("chart", { size: 15 })}${t("contentList.updateEngagement")}${staleQueue.length ? ` <span class="notif-badge" style="position:static;margin-left:2px;">${staleQueue.length}</span>` : ""}</button>`
            : ""
        }
        ${guided ? "" : `<button class="btn btn-secondary" id="import-content">${icon("refresh", { size: 15 })}${t("contentList.importContent")}${icon("chevronDown", { size: 12 })}</button>
        <button class="icon-btn" id="more-actions" aria-label="${t("contentList.moreActions")}" title="${t("contentList.moreActions")}">${icon("dots", { size: 16 })}</button>`}
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("contentList.newContent")}</button>
      </div>
    </div>

    <div class="flex items-center gap-10" style="margin-bottom:16px;">
      <div class="segmented" style="width:fit-content;">
        ${VIEWS.map((v) => `<button data-view="${v.key}" class="${state.view === v.key ? "active" : ""}">${t(v.labelKey)}</button>`).join("")}
      </div>
      ${guided ? "" : `<button class="btn ${state.selectMode ? "btn-primary" : "btn-secondary"} btn-sm" id="toggle-select">${icon("check", { size: 13 })}${state.selectMode ? t("contentList.doneSelecting") : t("contentList.select")}</button>`}
    </div>

    ${
      topPerformers.length && !guided
        ? `<div class="page-eyebrow" style="margin-bottom:8px;">${t("contentList.topPerformers")}</div>
           <div class="flex gap-10" style="margin-bottom:20px;flex-wrap:wrap;">
             ${topPerformers
               .map(
                 ({ c, m }) => `
               <div class="card glass-card card-tight top-performer-card" data-open-content="${c.id}" style="cursor:pointer;flex:1;min-width:200px;">
                 <div class="flex items-center justify-between" style="margin-bottom:4px;">
                   <span class="platform-pill">${platformIcon(c.platform)} ${c.platform || "—"}</span>
                   <span class="health-badge health-good"><span class="health-dot"></span>${formatPercent(m.engagementRate)}</span>
                 </div>
                 <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || t("common.untitled"))}</div>
               </div>`
               )
               .join("")}
           </div>`
        : ""
    }

    <div class="toolbar">
      <div class="search-box">
        ${icon("search", { size: 16 })}
        <input class="input" id="search" placeholder="${t("contentList.searchPlaceholder")}" value="${state.search}" />
      </div>
      <select class="select" id="filter-campaign" style="width:auto;">
        <option value="">${t("contentList.allCampaigns")}</option>
        ${[...campaignsById.values()].map((c) => `<option value="${c.id}" ${state.campaignId === c.id ? "selected" : ""}>${escapeText(c.name || t("common.untitled"))}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="filter-toggle">${icon("filter", { size: 13 })}${t("contentList.filter")}${panelFilterCount ? ` <span class="notif-badge" style="position:static;margin-left:2px;">${panelFilterCount}</span>` : ""}${icon("chevronDown", { size: 12 })}</button>
      ${guided ? "" : `<button type="button" class="btn btn-secondary btn-sm" id="metric-platform-toggle">${icon("layers", { size: 13 })}${metricPlatformLabel(state.metricPlatforms)}${icon("chevronDown", { size: 12 })}</button>`}
      ${activeFilters ? `<button class="btn btn-ghost btn-sm" id="clear-filters">${icon("x", { size: 13 })}${t("contentList.clearFilters")}</button>` : ""}
      ${
        state.selectMode && state.selected.size
          ? `<div class="flex items-center gap-8" style="margin-left:auto;">
               <span class="text-muted" style="font-size:12.5px;">${t("contentList.selectedCount", { count: state.selected.size })}</span>
               <button class="btn btn-danger btn-sm" id="bulk-delete">${icon("trash", { size: 13 })}${t("contentList.deleteSelected")}</button>
             </div>`
          : ""
      }
    </div>

    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              ${state.selectMode ? `<th style="width:36px;"><input type="checkbox" id="select-all-rows" ${items.length && items.every((x) => state.selected.has(x.c.id)) ? "checked" : ""} /></th>` : ""}
              <th data-sort="title">${t("contentList.th.title")}</th>
              <th>${t("contentList.th.platformFormat")}</th>
              <th>${t("contentList.th.campaign")}</th>
              <th>${t("contentList.th.funnel")}</th>
              <th>${t("contentList.th.status")}</th>
              <th data-sort="date">${t("contentList.th.date")}</th>
              <th data-sort="views">${t("contentList.th.views")}</th>
              <th data-sort="er">${t("contentList.th.engagement")}</th>
              <th>${t("contentList.th.followerConv")}</th>
              <th>${t("contentList.th.health")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((x) => rowHTML(x, state.selected.has(x.c.id), state.selectMode, campaignsById)).join("") : ""}
          </tbody>
        </table>
      </div>
      ${items.length ? "" : `<div class="table-empty">${t("contentList.emptyTable")}</div>`}
    </div>
  `;

  qs("#back-to-chooser").addEventListener("click", (e) => {
    e.preventDefault();
    state.view = null;
    paint(root, brandId, state, refresh);
  });

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));

  qs("#import-content")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: rect.left });
    if (!menu) return;
    menu.innerHTML = `
      <button data-import="instagram" ${igConfigured ? "" : "disabled"}>${platformIcon("instagram")}${t("contentList.importInstagram")}${igConfigured ? "" : ` <span class="text-faint" style="font-size:11px;">${igUnavailableNote}</span>`}</button>
      <button data-import="facebook" ${fbConfigured ? "" : "disabled"}>${platformIcon("facebook")}${t("contentList.importFacebook")}${fbConfigured ? "" : ` <span class="text-faint" style="font-size:11px;">${t("contentList.connectInEditBrand")}</span>`}</button>
      <button data-import="tiktok" disabled>${platformIcon("tiktok")}${t("contentList.importTiktok")} <span class="text-faint" style="font-size:11px;">${t("contentList.comingSoon")}</span></button>
    `;
    menu.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const target = ev.target.closest("[data-import]:not(:disabled)");
      if (!target) return;
      closeMenu();
      if (target.dataset.import === "instagram") openInstagramImportPicker(brandId, refresh);
      else if (target.dataset.import === "facebook") openFacebookImportPicker(brandId, refresh);
    });
  });

  qs("#toggle-select")?.addEventListener("click", () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selected.clear();
    paint(root, brandId, state, refresh);
  });

  qs("#more-actions")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 220) });
    if (!menu) return;
    menu.innerHTML = `
      ${
        igConfigured
          ? `<button data-act="refresh-all">${icon("refresh", { size: 15 })}${t("contentList.refreshAllIg")}</button>`
          : `<button data-act="refresh-all-disabled" disabled title="${igAllowed ? t("contentList.connectIgFirst") : ""}">${icon("refresh", { size: 15 })}${t("contentList.refreshAllIg")} <span class="text-faint" style="font-size:11px;">${igUnavailableNote}</span></button>`
      }
      <div class="menu-divider"></div>
      <button data-act="delete-all" class="danger">${icon("trash", { size: 15 })}${t("contentList.deleteAllContent", { count: allContentCount })}</button>
    `;
    menu.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      closeMenu();
      if (ev.target.closest("[data-act='delete-all']")) {
        if (!allContentCount) { toast(t("contentList.nothingToDelete"), "error"); return; }
        const ok = await confirmDialog({
          title: t("contentList.deleteAllTitle"),
          message: t("contentList.deleteAllMsg", { count: allContentCount, brand: brand.name }),
          confirmLabel: t("contentList.deleteEverything"),
          danger: true,
        });
        if (ok) {
          listContent(brandId, { includeArchived: true }).forEach((c) => deleteContent(c.id));
          toast(t("contentList.allContentDeleted"));
        }
      } else if (ev.target.closest("[data-act='refresh-all']")) {
        await refreshExistingInstagram(brandId, brand.instagram, refresh);
      }
    });
  });

  qs("#search").addEventListener(
    "input",
    debounce((e) => {
      state.search = e.target.value;
      paint(root, brandId, state, refresh);
      qs("#search").focus();
      qs("#search").selectionStart = qs("#search").selectionEnd = state.search.length;
    }, 200)
  );
  qs("#metric-platform-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: rect.left });
    if (!menu) return;
    menu.innerHTML = `
      <div style="padding:6px 14px 8px;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--text-faint);">${t("contentList.combineFrom")}</div>
      ${METRIC_PLATFORMS.map(
        (p) => `
        <label class="menu-checkbox-row ${p.disabled ? "disabled" : ""}">
          <input type="checkbox" data-metric-platform="${p.key}" ${state.metricPlatforms.has(p.key) ? "checked" : ""} ${p.disabled ? "disabled" : ""} />
          ${p.label}${p.disabled ? ` <span class="text-faint" style="font-size:11px;">${t("contentList.comingSoon")}</span>` : ""}
        </label>`
      ).join("")}
    `;
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    qsa("[data-metric-platform]", menu).forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.metricPlatform;
        if (cb.checked) state.metricPlatforms.add(key);
        else state.metricPlatforms.delete(key);
        paint(root, brandId, state, refresh);
      });
    });
  });
  qsa("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      paint(root, brandId, state, refresh);
    });
  });
  qs("#filter-campaign")?.addEventListener("change", (e) => {
    state.campaignId = e.target.value;
    paint(root, brandId, state, refresh);
  });
  qs("#filter-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openFilterPanel(e.currentTarget, { state, isPublishedView, settings, onChange: () => paint(root, brandId, state, refresh) });
  });
  const clearBtn = qs("#clear-filters");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    state.funnel = "";
    state.format = "";
    state.platform = "";
    state.age = "";
    state.campaignId = "";
    paint(root, brandId, state, refresh);
  });

  qsa("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else { state.sort = key; state.dir = "desc"; }
      paint(root, brandId, state, refresh);
    });
  });

  const selectAllBox = qs("#select-all-rows");
  if (selectAllBox) {
    selectAllBox.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.checked) items.forEach((x) => state.selected.add(x.c.id));
      else items.forEach((x) => state.selected.delete(x.c.id));
      paint(root, brandId, state, refresh);
    });
  }

  qsa("[data-row-checkbox]").forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cb.checked) state.selected.add(cb.dataset.id);
      else state.selected.delete(cb.dataset.id);
      paint(root, brandId, state, refresh);
    });
  });

  const bulkDeleteBtn = qs("#bulk-delete");
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
      const count = state.selected.size;
      const ok = await confirmDialog({
        title: t("contentList.deleteItemsTitle", { count }),
        message: t("common.noUndo"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (ok) {
        state.selected.forEach((id) => deleteContent(id));
        toast(t("contentList.itemsDeleted", { count }));
        state.selected.clear();
      }
    });
  }

  qsa("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-row-menu]") || e.target.closest(".menu") || e.target.closest("[data-row-checkbox]")) return;
      const item = items.find((x) => x.c.id === tr.dataset.id)?.c;
      if (!item) return;
      if (item.status === "published") {
        // Once a piece is published there's nothing left to write — the one
        // thing someone clicking it almost always wants is to fill in how it
        // performed, not re-open the metadata form. Metadata (platform,
        // campaign, ads) is still one click away via the row's "..." menu.
        openQuickFillModal({ c: item, onSaved: refresh });
      } else if (item.status !== "archived") {
        // Still-in-progress content (idea/draft/production/editing/scheduled)
        // is written and moved forward in Creator Studio, not here — same
        // routing "This Week's Work" already uses elsewhere in the app.
        location.hash = `#/brand/${brandId}/content-os/creator/${tr.dataset.id}`;
      } else {
        openContentEditor({ brandId, contentId: tr.dataset.id, onSaved: refresh });
      }
    });
  });

  qsa("[data-open-content]").forEach((card) => {
    // Top-performer cards only ever show published content — same "fill in
    // performance, not metadata" default as a published row above.
    card.addEventListener("click", () => {
      const item = items.find((x) => x.c.id === card.dataset.openContent)?.c;
      if (item?.status === "published") openQuickFillModal({ c: item, onSaved: refresh });
      else openContentEditor({ brandId, contentId: card.dataset.openContent, onSaved: refresh });
    });
  });

  qs("#update-engagement")?.addEventListener("click", () => {
    openEngagementQueueList({ brandId, allQueue: staleQueue, refresh });
  });

  qsa("[data-quick-fill]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const c = items.find((x) => x.c.id === btn.dataset.quickFill)?.c;
      if (c) openQuickFillModal({ c, onSaved: refresh });
    });
  });

  qsa("[data-row-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = items.find((x) => x.c.id === id)?.c;
      const rect = btn.getBoundingClientRect();
      const menu = openMenu(btn, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 190) });
      if (!menu) return;
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
        <button data-act="archive">${icon("archive", { size: 15 })}${item.archived ? t("contentList.unarchive") : t("contentList.archive")}</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}${t("common.delete")}</button>
      `;
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        closeMenu();
        if (act === "edit") openContentEditor({ brandId, contentId: id, onSaved: refresh });
        else if (act === "archive") {
          const wasArchived = item.archived;
          archiveContent(id, !wasArchived);
          toast(wasArchived ? t("contentList.contentRestored") : t("contentList.contentArchived"));
        } else if (act === "delete") {
          const ok = await confirmDialog({ title: t("contentList.deleteContentTitle"), message: t("common.noUndo"), confirmLabel: t("common.delete"), danger: true });
          if (ok) { deleteContent(id); toast(t("contentList.contentDeleted")); }
        }
      });
    });
  });
}

function rowHTML({ c, perf, m }, selected, selectMode, campaignsById) {
  // Views/Engagement/Follower Conv./Health only mean anything once
  // something has actually been posted — showing them for an idea or draft
  // just implies data that doesn't exist yet.
  const isPublished = c.status === "published";
  const campaign = c.campaignId ? campaignsById.get(c.campaignId) : null;
  return `
    <tr data-id="${c.id}">
      ${selectMode ? `<td onclick="event.stopPropagation()"><input type="checkbox" data-row-checkbox data-id="${c.id}" ${selected ? "checked" : ""} /></td>` : ""}
      <td class="cell-title">${escapeText(c.title || t("common.untitled"))}</td>
      <td class="cell-muted"><span class="platform-pill">${platformIcon(c.platform)} ${c.platform || "—"}</span>${c.trialReel ? ` <span class="tag" style="font-size:10px;">${t("contentList.trialReel")}</span>` : ""}<div class="text-faint" style="font-size:11.5px;margin-top:2px;">${c.format || "—"}</div></td>
      <td class="cell-muted">${campaign ? `<span class="tag" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(campaign.name || t("common.untitled"))}</span>` : "—"}</td>
      <td><span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span></td>
      <td><span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span></td>
      <td class="cell-muted">${formatDate(c.scheduleDate || c.publishedDate)}</td>
      <td class="cell-muted">${isPublished ? formatNumber(perf.views) : "—"}</td>
      <td class="cell-muted">${isPublished ? formatPercent(m.engagementRate) : "—"}</td>
      <td class="cell-muted">${isPublished ? formatPercent(m.followerConversionRate) : "—"}</td>
      <td>${isPublished && m.health ? `<span class="health-badge health-${m.health}"><span class="health-dot"></span>${HEALTH_LABEL[m.health]}</span>` : `<span class="health-badge health-none">—</span>`}</td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap-4">
          ${isPublished ? `<button type="button" class="icon-btn" data-quick-fill="${c.id}" aria-label="${t("contentList.fillEngagement")}" title="${t("contentList.fillEngagement")}" style="width:30px;height:30px;">${icon("chart", { size: 15 })}</button>` : ""}
          <button class="icon-btn" data-row-menu data-id="${c.id}" aria-label="${t("contentList.moreActions")}" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button>
        </div>
      </td>
    </tr>
  `;
}

// "Update Engagement" opens this list first — every published piece that's
// due for a check, scannable at once, instead of forcing a fixed one-by-one
// march through them. Pick whichever one you actually want to update.
function openEngagementQueueList({ brandId, allQueue, refresh }) {
  const overlay = openModal({
    title: `${t("contentList.eq.title")}${allQueue.length ? ` (${allQueue.length})` : ""}`,
    wide: true,
    bodyHTML: allQueue.length
      ? `<div style="display:flex;flex-direction:column;gap:2px;max-height:420px;overflow-y:auto;">
           ${allQueue
             .map(
               (c) => `
             <div class="flex items-center gap-10" data-eq-row="${c.id}" style="padding:10px 0;border-bottom:1px solid var(--border-soft);">
               <span class="platform-pill">${platformIcon(c.platform)}</span>
               <div style="flex:1;min-width:0;">
                 <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || t("common.untitled"))}</div>
                 <div class="text-faint" style="font-size:11.5px;">${c.platform || "—"} · ${t("contentList.eq.published", { date: formatDate(c.publishedDate) })}${c.performance?.confirmedAt ? "" : t("contentList.eq.neverFilled")}</div>
               </div>
               <button type="button" class="btn btn-secondary btn-sm" data-eq-fill="${c.id}">${icon("chart", { size: 13 })}${t("contentList.eq.fill")}</button>
             </div>`
             )
             .join("")}
         </div>`
      : `<div style="text-align:center;padding:28px 0;">${icon("check", { size: 30 })}<p class="text-muted" style="margin-top:10px;">${t("contentList.eq.allDone")}</p></div>`,
    footHTML: `<button class="btn btn-secondary" id="eq-close">${t("contentList.eq.close")}</button>`,
  });
  qs("#eq-close", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    refresh();
  });
  qsa("[data-eq-fill]", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = allQueue.find((x) => x.id === btn.dataset.eqFill);
      closeOverlay(overlay);
      openQuickFillModal({
        c,
        onSaved: () => {
          const stillDue = listContent(brandId).filter(needsEngagementUpdate);
          openEngagementQueueList({ brandId, allQueue: stillDue, refresh });
        },
        onBack: () => openEngagementQueueList({ brandId, allQueue, refresh }),
      });
    });
  });
}

// The actual entry form — screenshot+OCR or manual numbers for exactly one
// piece of content. Reused from two places: the queue list above, and the
// per-row quick-fill icon in the table (rowHTML) for updating any post on
// the spot, not just ones that showed up as "due."
export function openQuickFillModal({ c, onSaved, onBack }) {
  const perf = c.performance || {};
  const overlay = openModal({
    title: t("contentList.qf.title"),
    wide: true,
    bodyHTML: `
      <div style="margin-bottom:14px;">
        <div style="font-weight:700;font-size:14px;">${escapeText(c.title || t("common.untitled"))}</div>
        <div class="text-faint" style="font-size:12px;"><span class="platform-pill">${platformIcon(c.platform)} ${c.platform || "—"}</span> · ${t("contentList.eq.published", { date: formatDate(c.publishedDate) })}</div>
      </div>
      <div class="field">
        <label>${t("contentList.qf.screenshotLabel")}</label>
        <div id="qe-dropzone" class="dropzone">
          ${icon("upload")}
          <div>${t("contentList.qf.dropTitle")}</div>
          <div class="text-faint" style="font-size:12px;margin-top:4px;">${t("contentList.qf.dropSub")}</div>
          <input type="file" id="qe-screenshot-file" accept="image/*" style="display:none;" />
        </div>
        <div id="qe-ocr-status" style="margin-top:8px;"></div>
      </div>
      <div class="metric-grid">
        ${METRIC_KEYS.map(
          (m) => `
          <div class="field metric-field" style="margin-bottom:0;">
            <label>${m.label}</label>
            <input class="input" type="number" min="0" id="qe-metric-${m.key}" value="${perf[m.key] ?? ""}" placeholder="—" />
          </div>`
        ).join("")}
      </div>
    `,
    footHTML: `
      ${onBack ? `<button class="btn btn-secondary" id="qe-back">${icon("chevronLeft", { size: 12 })}${t("contentList.qf.backToList")}</button>` : ""}
      <button class="btn btn-primary" id="qe-save">${t("common.save")}</button>
    `,
  });

  const dropzone = qs("#qe-dropzone", overlay);
  const fileInput = qs("#qe-screenshot-file", overlay);
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
  dropzone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
  fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  async function handleFile(file) {
    if (!file) return;
    const dataUrl = await resizeImageFile(file, { maxDimension: 1400, format: "image/jpeg", quality: 0.88 });
    const statusEl = qs("#qe-ocr-status", overlay);
    statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentList.qf.analyzing")}</span></div>`;
    try {
      const { metrics } = await analyzeScreenshot(dataUrl, (pct) => {
        statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentList.qf.analyzingPct", { pct })}</span></div>`;
      });
      const matched = Object.keys(metrics);
      matched.forEach((key) => {
        const input = qs(`#qe-metric-${key}`, overlay);
        if (input) input.value = metrics[key];
      });
      statusEl.innerHTML = matched.length
        ? `<div class="ocr-status">${icon("check", { size: 14 })}<span>${t("contentList.qf.foundMetrics", { count: matched.length, metricWord: t(matched.length === 1 ? "cnt.metric.one" : "cnt.metric.many") })}</span></div>`
        : `<div class="ocr-status">${icon("info", { size: 14 })}<span>${t("contentList.qf.noMetricsFound")}</span></div>`;
    } catch (err) {
      statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${err.message || t("contentList.qf.analyzeFailed")}</span></div>`;
    }
  }

  qs("#qe-back", overlay)?.addEventListener("click", () => {
    closeOverlay(overlay);
    onBack();
  });
  qs("#qe-save", overlay).addEventListener("click", () => {
    const settings = getSettings();
    // #12: an ad-hoc "big win" celebration when this save is what pushes
    // the content's ER rating into "good" — compare before/after so a
    // re-save of an already-good piece doesn't celebrate every time.
    const wasGood = computeContentMetrics(c, settings).erRating === "good";
    const performance = { ...perf };
    METRIC_KEYS.forEach((m) => {
      const v = qs(`#qe-metric-${m.key}`, overlay).value;
      performance[m.key] = v === "" ? null : Number(v);
    });
    performance.confirmedAt = Date.now();
    updateContent(c.id, { performance });
    closeOverlay(overlay);
    toast(t("contentList.qf.updatedToast", { title: c.title || t("common.untitled") }));
    const updated = computeContentMetrics({ ...c, performance }, settings);
    if (!wasGood && updated.erRating === "good") {
      openCelebration({
        title: escapeText(t("celebrate.erWinTitle")),
        sub: escapeText(t("celebrate.erWinSub", { title: c.title || t("common.untitled"), er: Math.round((updated.engagementRate || 0) * 10) / 10 })),
      });
    }
    onSaved?.();
  });
}

// Funnel/Format/Platform/Age used to be 4 separate toolbar controls —
// consolidated into one "Filter" popover instead. Appended to document.body
// (like the existing row/import menus) so it survives the table repaint
// each control triggers, instead of closing on every single change.
function openFilterPanel(anchorBtn, { state, isPublishedView, settings, onChange }) {
  const rect = anchorBtn.getBoundingClientRect();
  const panel = openMenu(anchorBtn, { className: "filter-panel", top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 280) });
  if (!panel) return;
  panel.innerHTML = `
    <div class="filter-panel-section">
      <div class="page-eyebrow" style="margin-bottom:8px;">${t("contentList.fp.funnel")}</div>
      <div class="chip-select" id="fp-funnel">
        ${FUNNELS.map((f) => `<button type="button" data-val="${f}" class="${state.funnel === f ? "active" : ""}">${f}</button>`).join("")}
      </div>
    </div>
    <div class="filter-panel-section">
      <div class="page-eyebrow" style="margin-bottom:8px;">${t("contentList.fp.format")}</div>
      <select class="select" id="fp-format">
        <option value="">${t("contentList.fp.allFormats")}</option>
        ${settings.formats.map((f) => `<option value="${f.name}" ${state.format === f.name ? "selected" : ""}>${f.name}</option>`).join("")}
      </select>
    </div>
    <div class="filter-panel-section">
      <div class="page-eyebrow" style="margin-bottom:8px;">${t("contentList.fp.platform")}</div>
      <select class="select" id="fp-platform">
        <option value="">${t("contentList.fp.allPlatforms")}</option>
        ${settings.platforms.map((p) => `<option value="${p.name}" ${state.platform === p.name ? "selected" : ""}>${p.name}</option>`).join("")}
      </select>
    </div>
    ${
      isPublishedView
        ? `<div class="filter-panel-section">
             <div class="page-eyebrow" style="margin-bottom:8px;">${t("contentList.fp.age")}</div>
             <select class="select" id="fp-age">
               <option value="">${t("contentList.fp.allAges")}</option>
               ${AGE_BUCKETS.map((b) => `<option value="${b.key}" ${state.age === b.key ? "selected" : ""}>${t(b.labelKey)}</option>`).join("")}
             </select>
           </div>`
        : ""
    }
  `;
  panel.addEventListener("click", (e) => e.stopPropagation());

  qsa("#fp-funnel button", panel).forEach((btn) => {
    btn.addEventListener("click", () => {
      state.funnel = state.funnel === btn.dataset.val ? "" : btn.dataset.val;
      qsa("#fp-funnel button", panel).forEach((b) => b.classList.toggle("active", b.dataset.val === state.funnel));
      onChange();
    });
  });
  qs("#fp-format", panel).addEventListener("change", (e) => {
    state.format = e.target.value;
    onChange();
  });
  qs("#fp-platform", panel).addEventListener("change", (e) => {
    state.platform = e.target.value;
    onChange();
  });
  qs("#fp-age", panel)?.addEventListener("change", (e) => {
    state.age = e.target.value;
    onChange();
  });
}

function metricPlatformLabel(metricPlatforms) {
  const active = METRIC_PLATFORMS.filter((p) => !p.disabled && metricPlatforms.has(p.key));
  const allSelectable = METRIC_PLATFORMS.filter((p) => !p.disabled);
  if (active.length === allSelectable.length) return t("contentList.mp.allPlatforms");
  if (active.length === 0) return t("contentList.mp.noPlatforms");
  return active.map((p) => p.label).join(" + ");
}

// Re-fetches metrics for content already tracked here (platform Instagram +
// a Published URL) — no new imports, just refreshed numbers on what you
// already have.
async function refreshExistingInstagram(brandId, ig, refresh) {
  const targets = listContent(brandId).filter((c) => c.platform === "Instagram" && c.publishedUrl);
  if (!targets.length) {
    toast(t("contentList.ig.noneTracked"), "error");
    return;
  }

  const overlay = openModal({
    title: t("contentList.ig.refreshTitle"),
    bodyHTML: `<div style="display:flex;flex-direction:column;gap:2px;max-height:360px;overflow-y:auto;">
      ${targets
        .map(
          (c) => `
        <div class="flex items-center gap-10" data-row="${c.id}" style="padding:9px 0;border-bottom:1px solid var(--border-soft);">
          <span class="sync-status" style="width:18px;flex:none;display:flex;color:var(--text-faint);">${icon("clock", { size: 14 })}</span>
          <span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || t("common.untitled"))}</span>
        </div>`
        )
        .join("")}
    </div>`,
    footHTML: `<button class="btn btn-secondary" id="refresh-close" disabled>${t("contentList.ig.refreshing")}</button>`,
  });
  const closeBtn = overlay.querySelector("#refresh-close");
  closeBtn.addEventListener("click", () => closeOverlay(overlay));

  const rowStatus = (c) => overlay.querySelector(`[data-row="${c.id}"] .sync-status`);
  let ok = 0;
  let failed = 0;
  try {
    ({ ok, failed } = await syncInstagramPerformance(brandId, ig, {
      onRowStart: (c) => {
        const statusEl = rowStatus(c);
        if (statusEl) statusEl.innerHTML = `<div class="spinner"></div>`;
      },
      onRowDone: (c, err) => {
        const statusEl = rowStatus(c);
        if (!statusEl) return;
        statusEl.style.color = err ? "var(--health-poor)" : "var(--health-good)";
        statusEl.innerHTML = icon(err ? "x" : "check", { size: 14 });
        if (err) statusEl.setAttribute("title", err.message);
      },
    }));
  } catch (e) {
    toast(t("contentList.ig.unreachable", { msg: e.message }), "error");
    closeBtn.disabled = false;
    closeBtn.textContent = t("contentList.ig.close");
    return;
  }

  closeBtn.disabled = false;
  closeBtn.textContent = t("contentList.ig.done", { ok, failedPart: failed ? t("contentList.ig.failedPart", { count: failed }) : "" });
  refresh();
}
