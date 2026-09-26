import { getBrand, listContent, getContent, listCampaigns, getSettings, onChange, archiveContent, deleteContent, updateContent, METRIC_KEYS, STATUS_LABELS, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon, platformIcon } from "../icons.js";
import { formatNumber, formatPercent, formatDate, debounce, resizeImageFile, qs, qsa, toast, openMenu, closeMenu, escapeHtml as escapeText } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { confirmDialog, openModal, closeOverlay } from "../modals.js";
import { openInstagramImportPicker } from "./instagram-import.js";
import { openReportModal } from "./report.js";
import { syncInstagramPerformance } from "../instagram-sync.js";
import { canUseInstagramApi } from "../account.js";
import { analyzeScreenshot } from "../ocr.js";
import { extractInsightsFromImage, aiCanSeeImages, AiApiError } from "../ai.js";
import { analyzeRetention, retentionVerdict, hasRetentionData, normalizeRetention, ratingLabel } from "../retention.js";
import { getMode } from "../mode.js";
import { t } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { consumeNavContext } from "../nav-context.js";
import { funnelShort } from "../funnel-field.js";

// One table, three quick views: everything, what's live, what's still in
// progress. Ideas/drafts are worked on in Creator — this is where you check
// what's out vs. still coming, and fill in how the live pieces performed.
const VIEWS = [
  { key: "all", labelKey: "contentList.views.all", test: () => true },
  { key: "published", labelKey: "contentList.views.published", test: (s) => s === "published" },
  { key: "drafts", labelKey: "contentList.views.drafts", test: (s) => s !== "published" },
];

export function render(root, { brandId }) {
  const state = { view: "all", search: "", funnel: "", format: "", platform: "", age: "", campaignId: "", sort: "updated", dir: "desc" };
  // Arriving from a campaign: filter to that campaign, and for "Isi
  // performa" open Quick Fill on the piece straight away.
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
  const settings = getSettings();
  let items = listContent(brandId).map((c) => ({ c, perf: c.performance, m: computeContentMetrics(c, settings) }));

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

  const campaignsById = new Map(listCampaigns(brandId).map((c) => [c.id, c]));
  // "Filter" badge only counts what's inside that panel (Funnel/Format/
  // Platform/Age) — Campaign has its own always-visible dropdown.
  const panelFilterCount = (state.funnel ? 1 : 0) + (state.format ? 1 : 0) + (state.platform ? 1 : 0) + (state.age ? 1 : 0);
  const activeFilters = panelFilterCount + (state.campaignId ? 1 : 0);
  const igAllowed = canUseInstagramApi();
  const igConfigured = igAllowed && !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
  const igUnavailableNote = t("contentList.connectInEditBrand");
  const allContentCount = listContent(brandId, { includeArchived: true }).length;
  const isPublishedView = state.view === "published";
  const staleQueue = listContent(brandId).filter(needsEngagementUpdate).sort((a, b) => (a.publishedDate || "").localeCompare(b.publishedDate || ""));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("contentList.eyebrow")}${helpButtonHTML("content-list")}${guideVideoButtonHTML("content-list")}</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="icon-btn" id="more-actions" aria-label="${t("contentList.moreActions")}" title="${t("contentList.moreActions")}">${icon("dots", { size: 16 })}${staleQueue.length ? `<span class="notif-badge">${staleQueue.length}</span>` : ""}</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("contentList.newContent")}</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" style="width:fit-content;flex:none;">
        ${VIEWS.map((v) => `<button data-view="${v.key}" class="${state.view === v.key ? "active" : ""}">${t(v.labelKey)}</button>`).join("")}
      </div>
      <div class="search-box">
        ${icon("search", { size: 16 })}
        <input class="input" id="search" placeholder="${t("contentList.searchPlaceholder")}" value="${state.search}" />
      </div>
      <select class="select" id="filter-campaign" style="width:auto;">
        <option value="">${t("contentList.allCampaigns")}</option>
        ${[...campaignsById.values()].map((c) => `<option value="${c.id}" ${state.campaignId === c.id ? "selected" : ""}>${escapeText(c.name || t("common.untitled"))}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="filter-toggle">${icon("filter", { size: 13 })}${t("contentList.filter")}${panelFilterCount ? ` <span class="notif-badge" style="position:static;margin-left:2px;">${panelFilterCount}</span>` : ""}${icon("chevronDown", { size: 12 })}</button>
      ${activeFilters ? `<button class="btn btn-ghost btn-sm" id="clear-filters">${icon("x", { size: 13 })}${t("contentList.clearFilters")}</button>` : ""}
    </div>

    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table cl-cards">
          <thead>
            <tr>
              <th data-sort="title">${t("contentList.th.title")}</th>
              <th>${t("contentList.th.platformFormat")}</th>
              <th>${t("contentList.th.campaign")}</th>
              <th>${t("contentList.th.status")}</th>
              <th data-sort="date">${t("contentList.th.date")}</th>
              <th data-sort="views">${t("contentList.th.views")}</th>
              <th data-sort="er">${t("contentList.th.engagement")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((x) => rowHTML(x, campaignsById)).join("") : ""}
          </tbody>
        </table>
      </div>
      ${items.length ? "" : `<div class="table-empty">${t("contentList.emptyTable")}</div>`}
    </div>
  `;

  wireHelpButtons(root);
  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));

  // The ⋯ menu: the occasional jobs — refresh numbers, import, report,
  // wipe — out of the way of the everyday "find it and open it".
  qs("#more-actions").addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 260) });
    if (!menu) return;
    menu.innerHTML = `
      <button data-act="update-engagement">${icon("chart", { size: 15 })}${t("contentList.updateEngagement")}${staleQueue.length ? ` <span class="notif-badge" style="position:static;margin-left:auto;">${staleQueue.length}</span>` : ""}</button>
      ${igAllowed ? `
      <button data-act="import-ig" ${igConfigured ? "" : "disabled"}>${platformIcon("instagram")}${t("contentList.importInstagram")}${igConfigured ? "" : ` <span class="text-faint" style="font-size:11px;">${igUnavailableNote}</span>`}</button>
      <button data-act="refresh-all" ${igConfigured ? "" : "disabled"}>${icon("refresh", { size: 15 })}${t("contentList.refreshAllIg")}</button>` : ""}
      <button data-act="report">${icon("download", { size: 15 })}${t("home.report")}</button>
      <div class="menu-divider"></div>
      <button data-act="delete-all" class="danger">${icon("trash", { size: 15 })}${t("contentList.deleteAllContent", { count: allContentCount })}</button>
    `;
    menu.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const act = ev.target.closest("[data-act]:not(:disabled)")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "update-engagement") openEngagementQueueList({ brandId, allQueue: staleQueue, refresh });
      else if (act === "import-ig") openInstagramImportPicker(brandId, refresh);
      else if (act === "refresh-all") await refreshExistingInstagram(brandId, brand.instagram, refresh);
      else if (act === "report") openReportModal(brandId);
      else if (act === "delete-all") {
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
  qs("#clear-filters")?.addEventListener("click", () => {
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

  qsa("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-row-menu]") || e.target.closest(".menu")) return;
      const item = items.find((x) => x.c.id === tr.dataset.id)?.c;
      if (!item) return;
      if (item.status === "published") {
        // Once a piece is published there's nothing left to write — the one
        // thing someone clicking it almost always wants is to fill in how it
        // performed. Metadata is one click away via the row's "..." menu.
        openQuickFillModal({ c: item, onSaved: refresh });
      } else if (item.status !== "archived") {
        // Still-in-progress content is written and moved forward in Creator.
        location.hash = `#/brand/${brandId}/content/creator/${tr.dataset.id}`;
      } else {
        openContentEditor({ brandId, contentId: tr.dataset.id, onSaved: refresh });
      }
    });
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

function rowHTML({ c, perf, m }, campaignsById) {
  // Views/Engagement only mean anything once something has actually been
  // posted — showing them for an idea or draft implies data that isn't there.
  const isPublished = c.status === "published";
  const campaign = c.campaignId ? campaignsById.get(c.campaignId) : null;
  return `
    <tr data-id="${c.id}">
      <td class="cell-title">${escapeText(c.title || t("common.untitled"))}</td>
      <td class="cell-muted" data-label="${escapeText(t("contentList.th.platformFormat"))}"><span class="platform-pill">${platformIcon(c.platform)} ${c.platform || "—"}</span><div class="text-faint" style="font-size:11.5px;margin-top:2px;">${c.format || "—"}</div></td>
      <td class="cell-muted" data-label="${escapeText(t("contentList.th.campaign"))}">${campaign ? `<span class="tag" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(campaign.name || t("common.untitled"))}</span>` : "—"}</td>
      <td data-label="${escapeText(t("contentList.th.status"))}"><span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span></td>
      <td class="cell-muted" data-label="${escapeText(t("contentList.th.date"))}">${formatDate(c.scheduleDate || c.publishedDate)}</td>
      <td class="cell-muted" data-label="${escapeText(t("contentList.th.views"))}">${isPublished ? formatNumber(perf.views) : "—"}</td>
      <td data-label="${escapeText(t("contentList.th.engagement"))}">${isPublished && m.health ? `<span class="health-badge health-${m.health}"><span class="health-dot"></span>${formatPercent(m.engagementRate)}</span>` : `<span class="cell-muted">${isPublished ? formatPercent(m.engagementRate) : "—"}</span>`}</td>
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
// Pro adds the retention section (js/retention.js) under the numbers:
// the same screenshot drop reads Instagram's / TikTok's retention graph,
// the four figures stay editable, and a verdict line says what it means.
const RET_INPUTS = ["videoLengthSec", "avgWatchTimeSec", "hookPct", "completionPct"];
function retentionSectionHTML(ret) {
  return `
    <div class="qe-ret" id="qe-ret">
      <div class="qe-ret-head">
        <div>
          <div class="qe-ret-title">${t("ret.qf.section")}</div>
          <div class="text-faint" style="font-size:12px;">${t("ret.qf.sectionSub")}</div>
        </div>
      </div>
      <div class="metric-grid" style="margin-top:10px;">
        ${RET_INPUTS.map((k) => `
          <div class="field metric-field" style="margin-bottom:0;">
            <label for="qe-ret-${k}">${t(`ret.field.${k}`)}</label>
            <input class="input" type="number" min="0" step="${k.endsWith("Pct") ? "1" : "0.1"}" id="qe-ret-${k}" value="${ret[k] ?? ""}" placeholder="—" />
          </div>`).join("")}
      </div>
      <div id="qe-ret-verdict" class="qe-ret-verdict"></div>
    </div>`;
}

export function openQuickFillModal({ c, onSaved, onBack }) {
  const perf = c.performance || {};
  const isPro = getMode() === "advanced";
  const savedRet = normalizeRetention(perf.retention || {});
  // The curve read off a graph screenshot (not editable by hand) rides
  // along with the typed numbers on save.
  let readCurve = savedRet.curve;
  let readSource = perf.retention?.source || "manual";
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
          <div>${t("ret.qf.dropTitle")}</div>
          <div class="text-faint" style="font-size:12px;margin-top:4px;">${isPro ? t("ret.qf.dropSub") : t("contentList.qf.dropSub")}</div>
          <input type="file" id="qe-screenshot-file" accept="image/*" multiple style="display:none;" />
        </div>
        <div id="qe-ocr-status" style="margin-top:8px;"></div>
      </div>
      <div class="metric-grid">
        ${METRIC_KEYS.map(
          (m) => `
          <div class="field metric-field" style="margin-bottom:0;">
            <label for="qe-metric-${m.key}">${m.label}</label>
            <input class="input" type="number" min="0" id="qe-metric-${m.key}" value="${perf[m.key] ?? ""}" placeholder="—" />
          </div>`
        ).join("")}
      </div>
      ${isPro ? retentionSectionHTML(savedRet) : ""}
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
  dropzone.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
  fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });

  // The retention verdict follows the four inputs live (typed or read).
  const retInput = (k) => qs(`#qe-ret-${k}`, overlay);
  const readRetention = () => {
    if (!isPro) return null;
    const raw = { curve: readCurve, source: readSource };
    RET_INPUTS.forEach((k) => { const v = retInput(k)?.value; raw[k] = v === "" || v === undefined ? null : Number(v); });
    return raw;
  };
  const renderVerdict = () => {
    const box = qs("#qe-ret-verdict", overlay);
    if (!box) return;
    const raw = readRetention();
    const a = analyzeRetention(raw);
    if (a.diagnosis === "none") { box.innerHTML = `<div class="text-faint" style="font-size:12.5px;">${t("ret.qf.noVerdict")}</div>`; return; }
    const chip = (key, value, rating) => `<span class="qe-ret-chip ${rating ? `health-${rating}` : ""}"><b>${value}</b>${t(`ret.kpi.${key}`)}${rating ? ` · ${ratingLabel(rating)}` : ""}</span>`;
    const chips = [
      a.hookPct !== null ? chip("hook", formatPercent(a.hookPct, 0), a.ratings.hook) : "",
      a.avgWatchPct !== null ? chip("watch", formatPercent(a.avgWatchPct, 0), a.ratings.watch) : "",
      a.completionPct !== null ? chip("completion", formatPercent(a.completionPct, 0), a.ratings.completion) : "",
    ].filter(Boolean).join("");
    const lines = retentionVerdict(a, computeContentMetrics({ ...c, performance: readPerformance() }, getSettings()));
    box.innerHTML = `<div class="qe-ret-chips">${chips}</div>${lines.map((l) => `<p>${escapeText(l)}</p>`).join("")}`;
  };
  RET_INPUTS.forEach((k) => retInput(k)?.addEventListener("input", renderVerdict));
  METRIC_KEYS.forEach((m) => qs(`#qe-metric-${m.key}`, overlay)?.addEventListener("input", renderVerdict));
  renderVerdict();

  function readPerformance() {
    const performance = { ...perf };
    METRIC_KEYS.forEach((m) => {
      const v = qs(`#qe-metric-${m.key}`, overlay).value;
      performance[m.key] = v === "" ? null : Number(v);
    });
    return performance;
  }

  // Each screenshot is read by the AI when the picked provider can see
  // images (numbers AND the retention graph), otherwise by OCR (numbers
  // and the labelled retention figures only). Every number found lands
  // in its box; nothing typed is overwritten with a blank.
  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith("image/")).slice(0, 6);
    if (!files.length) return;
    const statusEl = qs("#qe-ocr-status", overlay);
    const ai = getSettings().ai || {};
    const useAi = aiCanSeeImages(ai);
    let metricsFound = 0;
    let retFound = false;
    let lastError = "";
    for (let i = 0; i < files.length; i++) {
      statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${files.length > 1 ? t("ret.qf.reading", { n: i + 1, total: files.length }) : t("contentList.qf.analyzing")}</span></div>`;
      try {
        const dataUrl = await resizeImageFile(files[i], { maxDimension: 1400, format: "image/jpeg", quality: 0.88 });
        const result = useAi
          ? await extractInsightsFromImage(ai, dataUrl)
          : await analyzeScreenshot(dataUrl, (pct) => { statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("contentList.qf.analyzingPct", { pct })}</span></div>`; });
        Object.entries(result.metrics || {}).forEach(([key, val]) => {
          const input = qs(`#qe-metric-${key}`, overlay);
          if (input && val !== null && val !== undefined) { input.value = val; metricsFound++; }
        });
        if (isPro && hasRetentionData(result.retention)) {
          const r = normalizeRetention(result.retention);
          RET_INPUTS.forEach((k) => { if (r[k] !== null && retInput(k)) retInput(k).value = k.endsWith("Pct") ? Math.round(r[k]) : Math.round(r[k] * 10) / 10; });
          if (r.curve.length) readCurve = r.curve;
          readSource = result.source || (useAi ? "ai" : "ocr");
          retFound = true;
        }
      } catch (err) {
        lastError = err instanceof AiApiError ? err.message : err?.message || t("contentList.qf.analyzeFailed");
      }
    }
    renderVerdict();
    const how = useAi ? t("ret.qf.readAi") : t("ret.qf.readOcr");
    const summary = isPro ? t("ret.qf.found", { metrics: metricsFound, ret: retFound ? t("ret.qf.foundRet") : t("ret.qf.noRet") }) : metricsFound ? t("contentList.qf.foundMetrics", { count: metricsFound, metricWord: t(metricsFound === 1 ? "cnt.metric.one" : "cnt.metric.many") }) : t("contentList.qf.noMetricsFound");
    statusEl.innerHTML = lastError && !metricsFound && !retFound
      ? `<div class="ocr-status">${icon("info", { size: 14 })}<span>${escapeText(lastError)}</span></div>`
      : `<div class="ocr-status">${icon(metricsFound || retFound ? "check" : "info", { size: 14 })}<span>${escapeText(summary)} · ${escapeText(how)}</span></div>`;
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
    const performance = readPerformance();
    if (isPro) {
      const raw = readRetention();
      if (hasRetentionData(raw)) performance.retention = { ...normalizeRetention(raw), analyzedAt: Date.now() };
      else if (perf.retention) performance.retention = null;
    }
    performance.confirmedAt = Date.now();
    updateContent(c.id, { performance });
    closeOverlay(overlay);
    toast(t("contentList.qf.updatedToast", { title: c.title || t("common.untitled") }));
    const updated = computeContentMetrics({ ...c, performance }, settings);
    if (!wasGood && updated.erRating === "good") {
      toast(t("celebrate.erWinTitle"));
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
        ${FUNNELS.map((f) => `<button type="button" data-val="${f}" class="${state.funnel === f ? "active" : ""}">${funnelShort(f)}</button>`).join("")}
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
