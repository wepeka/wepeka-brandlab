import { getBrand, listContent, getSettings, onChange, archiveContent, deleteContent, updateContent, combinePlatformMetrics, STATUS_LABELS, FUNNELS } from "../store.js";
import { computeContentMetrics, HEALTH_LABEL } from "../formulas.js";
import { icon, platformIcon } from "../icons.js";
import { formatNumber, formatPercent, formatDate, debounce, qs, qsa, toast } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { confirmDialog, openModal, closeOverlay } from "../modals.js";
import { openInstagramImportPicker } from "./instagram-import.js";
import { openFacebookImportPicker } from "./facebook-import.js";
import { listRecentMedia, fetchMediaMetrics, shortcodeFromUrl } from "../instagram.js";

// Opening the Content tab asks "what do you want to check?" first (three
// big choices) instead of dropping straight into a raw table. Ideas/drafts
// are meant to be worked on in the Creator tab — this is where you check
// what's live vs. still in progress.
const VIEWS = [
  { key: "all", label: "All Content", icon: "grid", test: () => true },
  { key: "published", label: "Published", icon: "check", test: (s) => s === "published" },
  { key: "drafts", label: "Drafts & Ideas", icon: "edit", test: (s) => s !== "published" },
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
  const state = { view: null, selectMode: false, search: "", funnel: "", format: "", sort: "updated", dir: "desc", selected: new Set(), metricPlatforms: new Set(["instagram", "facebook"]) };
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
        <div class="page-eyebrow">Content Database</div>
        <h1>${brand.name}</h1>
      </div>
      <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}New Content</button>
    </div>
    <p class="page-sub" style="margin-bottom:24px;">What do you want to check?</p>
    <div class="content-view-grid">
      ${VIEWS.map(
        (v) => `
        <button class="content-view-card" data-view="${v.key}">
          <div class="icon-wrap">${icon(v.icon, { size: 24 })}</div>
          <h3>${v.label}</h3>
          <p>${counts[v.key]} piece${counts[v.key] === 1 ? "" : "s"}</p>
        </button>`
      ).join("")}
    </div>
  `;

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

  const activeFilters = (state.funnel ? 1 : 0) + (state.format ? 1 : 0);
  const igConfigured = !!(brand.instagram?.accessToken && brand.instagram?.igUserId);
  const fbConfigured = !!(brand.facebook?.pageId && brand.facebook?.pageAccessToken);
  const allContentCount = listContent(brandId, { includeArchived: true }).length;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow"><a href="#" id="back-to-chooser" style="color:inherit;">Content Database ←</a></div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="import-content">${icon("refresh", { size: 15 })}Import Content${icon("chevronDown", { size: 12 })}</button>
        <button class="icon-btn" id="more-actions" aria-label="More actions" title="More actions">${icon("dots", { size: 16 })}</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}New Content</button>
      </div>
    </div>

    <div class="flex items-center gap-10" style="margin-bottom:16px;">
      <div class="segmented" style="width:fit-content;">
        ${VIEWS.map((v) => `<button data-view="${v.key}" class="${state.view === v.key ? "active" : ""}">${v.label}</button>`).join("")}
      </div>
      <button class="btn ${state.selectMode ? "btn-primary" : "btn-secondary"} btn-sm" id="toggle-select">${icon("check", { size: 13 })}${state.selectMode ? "Done Selecting" : "Select"}</button>
    </div>

    <div class="toolbar">
      <div class="search-box">
        ${icon("search", { size: 16 })}
        <input class="input" id="search" placeholder="Search content..." value="${state.search}" />
      </div>
      <div class="chip-select">
        ${FUNNELS.map((f) => `<button data-funnel="${f}" class="${state.funnel === f ? "active" : ""}">${f}</button>`).join("")}
      </div>
      <select class="select" id="filter-format" style="width:auto;">
        <option value="">All formats</option>
        ${settings.formats.map((f) => `<option value="${f.name}" ${state.format === f.name ? "selected" : ""}>${f.name}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="metric-platform-toggle">${icon("layers", { size: 13 })}${metricPlatformLabel(state.metricPlatforms)}${icon("chevronDown", { size: 12 })}</button>
      ${activeFilters ? `<button class="btn btn-ghost btn-sm" id="clear-filters">${icon("x", { size: 13 })}Clear filters</button>` : ""}
      ${
        state.selectMode && state.selected.size
          ? `<div class="flex items-center gap-8" style="margin-left:auto;">
               <span class="text-muted" style="font-size:12.5px;">${state.selected.size} selected</span>
               <button class="btn btn-danger btn-sm" id="bulk-delete">${icon("trash", { size: 13 })}Delete Selected</button>
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
              <th data-sort="title">Title</th>
              <th>Platform / Format</th>
              <th>Funnel</th>
              <th>Status</th>
              <th data-sort="date">Date</th>
              <th data-sort="views">Views</th>
              <th data-sort="er">Engagement</th>
              <th>Follower Conv.</th>
              <th>Health</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map((x) => rowHTML(x, state.selected.has(x.c.id), state.selectMode)).join("") : ""}
          </tbody>
        </table>
      </div>
      ${items.length ? "" : `<div class="table-empty">No content matches — try adjusting filters, or create your first piece.</div>`}
    </div>
  `;

  qs("#back-to-chooser").addEventListener("click", (e) => {
    e.preventDefault();
    state.view = null;
    paint(root, brandId, state, refresh);
  });

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));

  qs("#import-content").addEventListener("click", (e) => {
    e.stopPropagation();
    qsa(".menu").forEach((m) => m.remove());
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.left = rect.left + "px";
    menu.innerHTML = `
      <button data-import="instagram" ${igConfigured ? "" : "disabled"}>${platformIcon("instagram")}Import from Instagram${igConfigured ? "" : ` <span class="text-faint" style="font-size:11px;">(connect in Edit Brand)</span>`}</button>
      <button data-import="facebook" ${fbConfigured ? "" : "disabled"}>${platformIcon("facebook")}Import from Facebook${fbConfigured ? "" : ` <span class="text-faint" style="font-size:11px;">(connect in Edit Brand)</span>`}</button>
      <button data-import="tiktok" disabled>${platformIcon("tiktok")}Import from TikTok <span class="text-faint" style="font-size:11px;">(Coming Soon)</span></button>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
    menu.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const target = ev.target.closest("[data-import]:not(:disabled)");
      if (!target) return;
      menu.remove();
      if (target.dataset.import === "instagram") openInstagramImportPicker(brandId, refresh);
      else if (target.dataset.import === "facebook") openFacebookImportPicker(brandId, refresh);
    });
  });

  qs("#toggle-select").addEventListener("click", () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selected.clear();
    paint(root, brandId, state, refresh);
  });

  qs("#more-actions").addEventListener("click", (e) => {
    e.stopPropagation();
    qsa(".menu").forEach((m) => m.remove());
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
    menu.innerHTML = `
      ${igConfigured ? `<button data-act="refresh-all">${icon("refresh", { size: 15 })}Refresh All Instagram Metrics</button><div class="menu-divider"></div>` : ""}
      <button data-act="delete-all" class="danger">${icon("trash", { size: 15 })}Delete All Content (${allContentCount})</button>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
    menu.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      menu.remove();
      if (ev.target.closest("[data-act='delete-all']")) {
        if (!allContentCount) { toast("There's no content to delete.", "error"); return; }
        const ok = await confirmDialog({
          title: "Delete ALL content for this brand?",
          message: `This permanently deletes all ${allContentCount} content record(s) for ${brand.name}, including archived ones. This cannot be undone.`,
          confirmLabel: "Delete Everything",
          danger: true,
        });
        if (ok) {
          listContent(brandId, { includeArchived: true }).forEach((c) => deleteContent(c.id));
          toast("All content deleted");
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
  qs("#metric-platform-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    qsa(".menu").forEach((m) => m.remove());
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.left = rect.left + "px";
    menu.innerHTML = `
      <div style="padding:6px 14px 8px;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--text-faint);">Combine views/engagement from</div>
      ${METRIC_PLATFORMS.map(
        (p) => `
        <label class="menu-checkbox-row ${p.disabled ? "disabled" : ""}">
          <input type="checkbox" data-metric-platform="${p.key}" ${state.metricPlatforms.has(p.key) ? "checked" : ""} ${p.disabled ? "disabled" : ""} />
          ${p.label}${p.disabled ? ` <span class="text-faint" style="font-size:11px;">(Coming Soon)</span>` : ""}
        </label>`
      ).join("")}
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
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
  qsa("[data-funnel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.funnel = state.funnel === btn.dataset.funnel ? "" : btn.dataset.funnel;
      paint(root, brandId, state, refresh);
    });
  });
  qs("#filter-format").addEventListener("change", (e) => {
    state.format = e.target.value;
    paint(root, brandId, state, refresh);
  });
  const clearBtn = qs("#clear-filters");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    state.funnel = "";
    state.format = "";
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
        title: `Delete ${count} content item${count === 1 ? "" : "s"}?`,
        message: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (ok) {
        state.selected.forEach((id) => deleteContent(id));
        toast(`${count} item${count === 1 ? "" : "s"} deleted`);
        state.selected.clear();
      }
    });
  }

  qsa("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-row-menu]") || e.target.closest(".menu") || e.target.closest("[data-row-checkbox]")) return;
      openContentEditor({ brandId, contentId: tr.dataset.id, onSaved: refresh });
    });
  });

  qsa("[data-row-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      qsa(".menu").forEach((m) => m.remove());
      const id = btn.dataset.id;
      const item = items.find((x) => x.c.id === id)?.c;
      const rect = btn.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.style.top = rect.bottom + 6 + "px";
      menu.style.left = Math.min(rect.left, window.innerWidth - 190) + "px";
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}Edit</button>
        <button data-act="archive">${icon("archive", { size: 15 })}${item.archived ? "Unarchive" : "Archive"}</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}Delete</button>
      `;
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        menu.remove();
        if (act === "edit") openContentEditor({ brandId, contentId: id, onSaved: refresh });
        else if (act === "archive") {
          const wasArchived = item.archived;
          archiveContent(id, !wasArchived);
          toast(wasArchived ? "Content restored" : "Content archived");
        } else if (act === "delete") {
          const ok = await confirmDialog({ title: "Delete this content?", message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
          if (ok) { deleteContent(id); toast("Content deleted"); }
        }
      });
    });
  });
}

function rowHTML({ c, perf, m }, selected, selectMode) {
  // Views/Engagement/Follower Conv./Health only mean anything once
  // something has actually been posted — showing them for an idea or draft
  // just implies data that doesn't exist yet.
  const isPublished = c.status === "published";
  return `
    <tr data-id="${c.id}">
      ${selectMode ? `<td onclick="event.stopPropagation()"><input type="checkbox" data-row-checkbox data-id="${c.id}" ${selected ? "checked" : ""} /></td>` : ""}
      <td class="cell-title">${escapeText(c.title || "Untitled")}</td>
      <td class="cell-muted"><span class="platform-pill">${platformIcon(c.platform)} ${c.platform || "—"}</span><div class="text-faint" style="font-size:11.5px;margin-top:2px;">${c.format || "—"}</div></td>
      <td><span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span></td>
      <td><span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span></td>
      <td class="cell-muted">${formatDate(c.scheduleDate || c.publishedDate)}</td>
      <td class="cell-muted">${isPublished ? formatNumber(perf.views) : "—"}</td>
      <td class="cell-muted">${isPublished ? formatPercent(m.engagementRate) : "—"}</td>
      <td class="cell-muted">${isPublished ? formatPercent(m.followerConversionRate) : "—"}</td>
      <td>${isPublished && m.health ? `<span class="health-badge health-${m.health}"><span class="health-dot"></span>${HEALTH_LABEL[m.health]}</span>` : `<span class="health-badge health-none">—</span>`}</td>
      <td><button class="icon-btn" data-row-menu data-id="${c.id}" aria-label="More actions" style="width:30px;height:30px;">${icon("dots", { size: 15 })}</button></td>
    </tr>
  `;
}

function metricPlatformLabel(metricPlatforms) {
  const active = METRIC_PLATFORMS.filter((p) => !p.disabled && metricPlatforms.has(p.key));
  const allSelectable = METRIC_PLATFORMS.filter((p) => !p.disabled);
  if (active.length === allSelectable.length) return "All platforms";
  if (active.length === 0) return "No platforms";
  return active.map((p) => p.label).join(" + ");
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// Re-fetches metrics for content already tracked here (platform Instagram +
// a Published URL) — no new imports, just refreshed numbers on what you
// already have.
async function refreshExistingInstagram(brandId, ig, refresh) {
  const targets = listContent(brandId).filter((c) => c.platform === "Instagram" && c.publishedUrl);
  if (!targets.length) {
    toast("No Instagram content is being tracked yet — use Import from Instagram first.", "error");
    return;
  }

  const overlay = openModal({
    title: "Refresh Instagram Metrics",
    bodyHTML: `<div style="display:flex;flex-direction:column;gap:2px;max-height:360px;overflow-y:auto;">
      ${targets
        .map(
          (c) => `
        <div class="flex items-center gap-10" data-row="${c.id}" style="padding:9px 0;border-bottom:1px solid var(--border-soft);">
          <span class="sync-status" style="width:18px;flex:none;display:flex;color:var(--text-faint);">${icon("clock", { size: 14 })}</span>
          <span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || "Untitled")}</span>
        </div>`
        )
        .join("")}
    </div>`,
    footHTML: `<button class="btn btn-secondary" id="refresh-close" disabled>Refreshing…</button>`,
  });
  const closeBtn = overlay.querySelector("#refresh-close");
  closeBtn.addEventListener("click", () => closeOverlay(overlay));

  let media;
  try {
    media = await listRecentMedia(ig, { maxItems: 100 });
  } catch (e) {
    toast(`Couldn't reach Instagram: ${e.message}`, "error");
    closeBtn.disabled = false;
    closeBtn.textContent = "Close";
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const c of targets) {
    const statusEl = overlay.querySelector(`[data-row="${c.id}"] .sync-status`);
    statusEl.innerHTML = `<div class="spinner"></div>`;
    try {
      const code = shortcodeFromUrl(c.publishedUrl);
      const mediaObj = media.find((m) => shortcodeFromUrl(m.permalink) === code);
      if (!mediaObj) throw new Error("not found in recent posts");
      const { metrics } = await fetchMediaMetrics(ig, mediaObj);
      updateContent(c.id, { performance: metrics });
      statusEl.style.color = "var(--health-good)";
      statusEl.innerHTML = icon("check", { size: 14 });
      ok++;
    } catch (e) {
      statusEl.style.color = "var(--health-poor)";
      statusEl.innerHTML = icon("x", { size: 14 });
      statusEl.setAttribute("title", e.message);
      failed++;
    }
  }

  closeBtn.disabled = false;
  closeBtn.textContent = `Done — ${ok} refreshed${failed ? `, ${failed} failed` : ""}`;
  refresh();
}
