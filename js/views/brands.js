import {
  listBrands, createBrand, updateBrand, archiveBrand, deleteBrand, listContent, updateContent,
  listRoutineTemplate, addRoutineItem, removeRoutineItem, markRoutineDoneToday, listOverdueAndDueSoon,
  ROUTINE_DAYS, ROUTINE_DAY_LABELS, ROUTINE_ACTIVITIES, ROUTINE_ACTIVITY_LABELS,
} from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, resizeImageFile, formatDate, qs, qsa, toast, pickTintTextColor, pickTintForeground } from "../dom.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { testConnection } from "../instagram.js";
import { testFacebookConnection } from "../facebook.js";
import { testAdsConnection } from "../ads.js";
import { startOnboardingTour } from "../tour.js";

export function render(root) {
  const state = { routineManageOpen: false, addActivity: "shooting", addDays: new Set() };
  const refresh = () => paint(root, state, refresh);
  refresh();
  return () => {}; // no store subscription needed — actions here re-render locally
}

const ONBOARDING_DISMISSED_KEY = "contentos:onboarding-dismissed";

function paint(root, state, refresh) {
  const brands = listBrands();
  const showOnboarding = !localStorage.getItem(ONBOARDING_DISMISSED_KEY);

  root.innerHTML = `
    <div class="brands-bg"><span class="bg-blob bg-blob-1"></span><span class="bg-blob bg-blob-2"></span><span class="bg-blob bg-blob-3"></span></div>
    <div class="hero-strip">
      <div class="kicker">Wepeka Brandlab</div>
      <h1>Choose a brand to plan, publish, and track.</h1>
      <p class="page-sub">Every brand gets its own dashboard, calendar, and content database. Add as many as you manage.</p>
    </div>
    <div class="brand-row-head">
      <button class="brand-quick-add" id="add-brand-quick" aria-label="Add New Brand" title="Add New Brand">${icon("plus", { size: 15 })}</button>
    </div>
    <div class="brand-grid" id="brand-grid">
      ${brands.map(brandCard).join("")}
      <button class="brand-tile brand-tile-add" id="add-brand">
        <div class="brand-tile-avatar brand-tile-avatar-add">${icon("plus", { size: 28 })}</div>
        <h3>Add New Brand</h3>
      </button>
    </div>
    ${showOnboarding ? onboardingCardHTML() : ""}
    ${setupVideoCardHTML()}
    ${overdueRemindersHTML()}
    ${weeklyWorkHTML(brands)}
    ${myRoutineHTML(state, brands)}
  `;

  const dragState = wireBrandGridDrag(qs("#brand-grid"));

  qs("#add-brand").addEventListener("click", () => {
    if (dragState.wasDragged) return;
    openBrandModal({ onSaved: refresh });
  });
  qs("#add-brand-quick").addEventListener("click", () => {
    openBrandModal({ onSaved: refresh });
  });

  const dismissBtn = qs("#dismiss-onboarding");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
      refresh();
    });
  }
  qs("#start-tour")?.addEventListener("click", () => startOnboardingTour());

  // Read-only reflection of real progress — clicking opens the content in
  // Creator to actually do the work there. It's not a shortcut to instantly
  // flip status from the home page; it just confirms itself and drops off
  // this list once you've genuinely advanced it.
  qsa(".weekly-work-row", root).forEach((row) => {
    row.addEventListener("click", () => {
      location.hash = `#/brand/${row.dataset.brandId}/content-os/creator/${row.dataset.taskId}`;
    });
  });

  qsa("[data-overdue-work]", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      location.hash = `#/brand/${btn.dataset.brandId}/content-os/creator/${btn.dataset.overdueWork}`;
    });
  });

  wireMyRoutine(root, state, refresh);

  qsa(".brand-tile:not(.brand-tile-add)").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (dragState.wasDragged) return;
      if (e.target.closest("[data-menu-toggle]") || e.target.closest(".menu")) return;
      location.hash = `#/brand/${card.dataset.id}`;
    });
  });

  qsa("[data-menu-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      qsa(".menu").forEach((m) => m.remove());
      const id = btn.dataset.id;
      const rect = btn.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.style.top = rect.bottom + 6 + "px";
      menu.style.left = Math.min(rect.left, window.innerWidth - 190) + "px";
      menu.innerHTML = `
        <button data-act="edit">${icon("edit", { size: 15 })}Edit</button>
        <button data-act="archive">${icon("archive", { size: 15 })}Archive</button>
        <div class="menu-divider"></div>
        <button data-act="delete" class="danger">${icon("trash", { size: 15 })}Delete</button>
      `;
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
      menu.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        menu.remove();
        const brand = brands.find((b) => b.id === id);
        if (act === "edit") {
          openBrandModal({ brand, onSaved: refresh });
        } else if (act === "archive") {
          const ok = await confirmDialog({
            title: "Archive brand?",
            message: "You can restore it later from Settings → Brand Management. Its content is kept.",
            confirmLabel: "Archive",
          });
          if (ok) {
            archiveBrand(id, true);
            toast("Brand archived");
            refresh();
          }
        } else if (act === "delete") {
          const count = listContent(id, { includeArchived: true }).length;
          const ok = await confirmDialog({
            title: "Delete brand permanently?",
            message: `This removes the brand and all ${count} piece(s) of content inside it. This cannot be undone.`,
            confirmLabel: "Delete Forever",
            danger: true,
          });
          if (ok) {
            deleteBrand(id);
            toast("Brand deleted");
            refresh();
          }
        }
      });
    });
  });
}

function onboardingCardHTML() {
  return `
    <div class="card onboarding-card">
      <button class="icon-btn" id="dismiss-onboarding" aria-label="Dismiss" style="position:absolute;top:14px;right:14px;width:28px;height:28px;">${icon("x", { size: 14 })}</button>
      <div class="onboarding-video-placeholder">
        ${icon("sparkle", { size: 22 })}
        <span>Guided tour</span>
      </div>
      <div class="onboarding-copy">
        <h3 style="font-size:15px;margin-bottom:4px;">New here? Start with the basics</h3>
        <p class="text-muted" style="font-size:13px;margin:0 0 12px;">A quick walkthrough of where everything lives — brands, Creator Studio, Calendar, notifications, and Settings.</p>
        <button type="button" class="btn btn-primary btn-sm" id="start-tour">${icon("play", { size: 13 })}Take the Tour</button>
      </div>
    </div>
  `;
}

// The real explainer video is being produced separately — this is a
// deliberately nice-looking placeholder standing in for it until an actual
// video file/link exists. Swap the .setup-video-placeholder inner markup for
// a real <video>/<iframe> embed once it's ready; nothing else here needs to
// change.
function setupVideoCardHTML() {
  return `
    <div class="card setup-video-card">
      <div class="setup-video-placeholder">
        <div class="setup-video-play">${icon("play", { size: 20 })}</div>
        <span class="setup-video-badge">Coming soon</span>
      </div>
      <div class="onboarding-copy">
        <h3 style="font-size:15px;margin-bottom:4px;">Setup walkthrough video</h3>
        <p class="text-muted" style="font-size:13px;margin:0;">A short video covering brand setup, connecting Instagram/Facebook, and the Creator workflow end-to-end — being recorded now, it'll drop in right here.</p>
      </div>
    </div>
  `;
}

// Derived straight from real content status across every brand — not a
// separate task list to keep in sync by hand. No checkbox: this is a
// read-only mirror of real progress, and it drops off the list on its own
// once the actual status is advanced from Creator — not from clicking here.
// Same content the Calendar just stopped showing (scheduleDate passed,
// still not published) — surfaced here instead, front and center, so it
// doesn't just quietly disappear.
function overdueRemindersHTML() {
  const { overdue } = listOverdueAndDueSoon();
  if (!overdue.length) return "";
  return `
    <div class="card overdue-card" style="margin-bottom:28px;">
      <div class="page-eyebrow" style="margin-bottom:14px;color:var(--health-poor);">${icon("info", { size: 13 })} Overdue</div>
      <div>${overdue.map(overdueRow).join("")}</div>
    </div>
  `;
}

function overdueRow(t) {
  return `
    <div class="overdue-row">
      <div class="ti" style="flex:1;min-width:0;">
        <div class="t">${escapeText(t.content.title || "Untitled")} <span class="text-faint">— ${escapeText(t.brand.name)}</span></div>
        <div class="m">Konten ini belum kamu upload — dijadwalkan ${formatDate(t.content.scheduleDate)}</div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-overdue-work="${t.content.id}" data-brand-id="${t.brand.id}" style="flex:none;">Kerjakan Sekarang</button>
    </div>
  `;
}

const WEEKLY_STAGE_VERB = { production: "Shoot", editing: "Edit", scheduled: "Upload" };

function weeklyWorkHTML(brands) {
  const tasks = [];
  brands.forEach((b) => {
    listContent(b.id).forEach((c) => {
      const verb = WEEKLY_STAGE_VERB[c.status];
      if (verb) tasks.push({ verb, content: c, brand: b });
    });
  });
  if (!tasks.length) return "";
  tasks.sort((a, b) => (a.content.scheduleDate || "9999").localeCompare(b.content.scheduleDate || "9999"));
  return `
    <div class="card" style="margin-bottom:28px;">
      <div class="page-eyebrow" style="margin-bottom:14px;">This Week's Work <span class="text-faint" style="text-transform:none;letter-spacing:0;">— click one to work on it in Creator</span></div>
      <div>${tasks.map(weeklyWorkRow).join("")}</div>
    </div>
  `;
}

function weeklyWorkRow(t) {
  return `
    <div class="weekly-work-row" data-task-id="${t.content.id}" data-brand-id="${t.brand.id}">
      <span class="weekly-work-verb">${t.verb}</span>
      <span class="weekly-work-title">${escapeText(t.content.title || "Untitled")}</span>
      <span class="weekly-work-brand">${escapeText(t.brand.name)}</span>
    </div>
  `;
}

// A standing weekly schedule — Brand / Day / Activity / Time — not a
// one-off to-do list. Shooting/Editing/Upload confirm themselves by
// checking whether matching content actually moved today (same status
// vocabulary as This Week's Work); only "Custom" needs a manual check since
// there's no content signal to read it from.
function todayDayKey() {
  return ROUTINE_DAYS[(new Date().getDay() + 6) % 7];
}

const ROUTINE_AUTO_STATUS_PAST = {
  shooting: ["editing", "scheduled", "published"],
  editing: ["scheduled", "published"],
  upload: ["published"],
};

function isRoutineAutoDoneToday(item) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const passed = ROUTINE_AUTO_STATUS_PAST[item.activity] || [];
  return listContent(item.brandId).some((c) => passed.includes(c.status) && new Date(c.updatedAt).toISOString().slice(0, 10) === todayISO);
}

function myRoutineHTML(state, brands) {
  const today = todayDayKey();
  const allItems = listRoutineTemplate();
  const todayItems = allItems.filter((t) => t.day === today);
  const brandName = (id) => brands.find((b) => b.id === id)?.name || "?";

  return `
    <div class="card" style="margin-bottom:28px;">
      <div class="creator-field-head" style="margin-bottom:14px;">
        <div class="page-eyebrow" style="margin-bottom:0;">My Routine — Today (${ROUTINE_DAY_LABELS[today]})</div>
        <button type="button" class="btn btn-ghost btn-sm" id="toggle-routine-manage">${icon("gear", { size: 13 })}${state.routineManageOpen ? "Done" : "Manage"}</button>
      </div>
      ${
        todayItems.length
          ? `<div>${todayItems.map((t) => routineTodayRow(t, brandName(t.brandId))).join("")}</div>`
          : `<p class="text-muted" style="font-size:12.5px;margin:0;">Nothing set for today — click Manage to build your weekly routine (Brand, Day, Activity, optional Time).</p>`
      }
      ${state.routineManageOpen ? routineManageHTML(state, brands, allItems) : ""}
    </div>
  `;
}

function routineTodayRow(t, brandLabel) {
  const activityLabel = t.activity === "custom" ? t.customLabel || "Custom" : ROUTINE_ACTIVITY_LABELS[t.activity];
  const time = t.time || "Flexible";
  if (t.activity === "custom") {
    const done = (t.doneDates || []).includes(new Date().toISOString().slice(0, 10));
    return `
      <label class="routine-task-row ${done ? "done" : ""}" data-custom-task-id="${t.id}">
        <input type="checkbox" ${done ? "checked" : ""} />
        <span class="routine-task-text">${escapeText(activityLabel)} — ${escapeText(brandLabel)}</span>
        <span class="text-faint" style="font-size:11.5px;flex:none;">${escapeText(time)}</span>
      </label>
    `;
  }
  const done = isRoutineAutoDoneToday(t);
  return `
    <div class="routine-task-row ${done ? "done" : ""}" style="cursor:default;">
      <span class="routine-auto-badge ${done ? "done" : ""}">${icon(done ? "check" : "clock", { size: 12 })}</span>
      <span class="routine-task-text">${escapeText(activityLabel)} — ${escapeText(brandLabel)}</span>
      <span class="text-faint" style="font-size:11.5px;flex:none;">${escapeText(time)}</span>
    </div>
  `;
}

function routineManageHTML(state, brands, allItems) {
  const showCustomField = state.addActivity === "custom";
  return `
    <div class="divider"></div>
    <div class="page-eyebrow" style="margin-bottom:10px;">Weekly Template</div>
    ${
      allItems.length
        ? `<div style="margin-bottom:16px;">${ROUTINE_DAYS.map((day) => routineManageDayGroup(day, allItems, brands)).join("")}</div>`
        : `<p class="text-muted" style="font-size:12.5px;margin:0 0 16px;">No routine items yet — add your first one below.</p>`
    }
    <div class="field" style="margin-bottom:8px;">
      <label>Brand</label>
      <select class="select" id="routine-brand">${brands.map((b) => `<option value="${b.id}">${escapeText(b.name)}</option>`).join("")}</select>
    </div>
    <div class="field" style="margin-bottom:8px;">
      <div class="creator-field-head">
        <label style="margin-bottom:0;">Day(s) — pick as many as you need</label>
        <label class="checkbox-chip" style="padding:4px 10px;font-size:11px;">
          <input type="checkbox" id="routine-day-everyday" ${ROUTINE_DAYS.every((d) => state.addDays.has(d)) ? "checked" : ""} />Everyday
        </label>
      </div>
      <div class="chip-select" id="routine-day-chips">
        ${ROUTINE_DAYS.map((d) => `<button type="button" data-day="${d}" class="${state.addDays.has(d) ? "active" : ""}">${ROUTINE_DAY_LABELS[d].slice(0, 3)}</button>`).join("")}
      </div>
    </div>
    <div class="row-2">
      <div class="field" style="margin-bottom:8px;">
        <label>Activity</label>
        <select class="select" id="routine-activity">${ROUTINE_ACTIVITIES.map((a) => `<option value="${a}" ${state.addActivity === a ? "selected" : ""}>${ROUTINE_ACTIVITY_LABELS[a]}</option>`).join("")}</select>
      </div>
      <div class="field" style="margin-bottom:8px;">
        <label>Time (optional)</label>
        <input class="input" type="time" id="routine-time" />
      </div>
    </div>
    ${showCustomField ? `<div class="field" style="margin-bottom:8px;"><label>Custom activity name</label><input class="input" id="routine-custom-label" placeholder="e.g. Cek analytics, Balas DM" /></div>` : ""}
    <button type="button" class="btn btn-primary btn-block" id="add-routine-item">${icon("plus", { size: 15 })}Add to Weekly Template</button>
  `;
}

function routineManageDayGroup(day, allItems, brands) {
  const items = allItems.filter((t) => t.day === day);
  if (!items.length) return "";
  const brandName = (id) => brands.find((b) => b.id === id)?.name || "?";
  return `
    <div style="margin-bottom:10px;">
      <div class="text-faint" style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">${ROUTINE_DAY_LABELS[day]}</div>
      ${items
        .map(
          (t) => `
        <div class="flex items-center gap-8" style="padding:6px 0;">
          <span style="flex:1;font-size:13px;">${escapeText(t.activity === "custom" ? t.customLabel || "Custom" : ROUTINE_ACTIVITY_LABELS[t.activity])} — ${escapeText(brandName(t.brandId))}${t.time ? ` <span class="text-faint">(${escapeText(t.time)})</span>` : ""}</span>
          <button type="button" class="icon-btn" data-remove-routine="${t.id}" aria-label="Remove" style="width:26px;height:26px;">${icon("x", { size: 12 })}</button>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function wireMyRoutine(root, state, refresh) {
  qs("#toggle-routine-manage")?.addEventListener("click", () => {
    state.routineManageOpen = !state.routineManageOpen;
    refresh();
  });

  qsa("[data-custom-task-id]", root).forEach((row) => {
    const checkbox = row.querySelector("input[type=checkbox]");
    checkbox.addEventListener("change", () => {
      markRoutineDoneToday(row.dataset.customTaskId, checkbox.checked);
      refresh();
    });
  });

  qs("#routine-activity")?.addEventListener("change", (e) => {
    state.addActivity = e.target.value;
    refresh();
  });

  qsa("#routine-day-chips button", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.addDays.has(btn.dataset.day)) state.addDays.delete(btn.dataset.day);
      else state.addDays.add(btn.dataset.day);
      refresh();
    });
  });
  qs("#routine-day-everyday")?.addEventListener("change", (e) => {
    state.addDays = e.target.checked ? new Set(ROUTINE_DAYS) : new Set();
    refresh();
  });

  qs("#add-routine-item")?.addEventListener("click", () => {
    const brandId = qs("#routine-brand")?.value;
    if (!brandId) {
      toast("Add a brand first.", "error");
      return;
    }
    if (!state.addDays.size) {
      toast("Pick at least one day.", "error");
      return;
    }
    const activity = qs("#routine-activity").value;
    const customLabel = qs("#routine-custom-label")?.value || "";
    const time = qs("#routine-time").value || "";
    state.addDays.forEach((day) => addRoutineItem({ brandId, day, activity, customLabel, time }));
    toast(`Added to ${state.addDays.size} day(s)`);
    state.addDays = new Set();
    refresh();
  });

  qsa("[data-remove-routine]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      removeRoutineItem(btn.dataset.removeRoutine);
      refresh();
    });
  });
}

// Click-and-drag panning for the brand row, for mouse users (touch/trackpad
// already scroll it natively via overflow-x). Returns a small state object
// so click handlers on the tiles can check `wasDragged` and skip navigating
// when the mouseup that ended the drag happened to land on a tile — without
// this, dragging left the row instead behaves like an accidental click.
//
// mousemove/mouseup have to live on `window` (a fast drag can leave the
// grid's own bounds), but `paint()` re-renders this whole page on every
// refresh() and would otherwise pile up a fresh pair of window-level
// listeners each time with nothing ever removing the previous pair — so
// the previous call's listeners are explicitly torn down before attaching
// the new ones.
let brandGridDragCleanup = null;
function wireBrandGridDrag(grid) {
  brandGridDragCleanup?.();
  brandGridDragCleanup = null;
  if (!grid) return { wasDragged: false };

  const state = { down: false, wasDragged: false, startX: 0, startScroll: 0 };
  grid.classList.add("draggable");

  const onDown = (e) => {
    if (e.button !== 0) return;
    state.down = true;
    state.wasDragged = false;
    state.startX = e.pageX;
    state.startScroll = grid.scrollLeft;
    grid.classList.add("pressing");
  };
  const onMove = (e) => {
    if (!state.down) return;
    const dx = e.pageX - state.startX;
    if (Math.abs(dx) > 5 && !state.wasDragged) {
      state.wasDragged = true;
      // Only now (a confirmed drag, not just a click) does pointer-events
      // get disabled on the tiles via the .dragging class — doing that
      // from mousedown instead would risk swallowing a plain click's own
      // click event before it has a chance to fire.
      grid.classList.add("dragging");
    }
    if (state.wasDragged) {
      e.preventDefault();
      grid.scrollLeft = state.startScroll - dx;
    }
  };
  const onUp = () => {
    if (!state.down) return;
    state.down = false;
    grid.classList.remove("pressing", "dragging");
  };

  grid.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  brandGridDragCleanup = () => {
    grid.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  return state;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function brandCard(brand) {
  const contents = listContent(brand.id);
  const published = contents.filter((c) => c.status === "published").length;
  // A brand's own picked color overrides --brand-tint just for this tile —
  // the existing .brand-tile-avatar:hover glow rule already reads
  // --brand-tint, so scoping it here (rather than only on document.body,
  // which only ever reflects the *currently open* brand) is what makes
  // each tile in this all-brands list glow in its own color instead of one
  // shared color.
  const tintStyle = brand.color
    ? `--brand-tint:${brand.color};--brand-tint-text:${pickTintTextColor(brand.color)};--brand-tint-fg:${pickTintForeground(brand.color)};`
    : "";
  return `
    <div class="brand-tile" data-id="${brand.id}" style="${tintStyle}">
      <div class="brand-tile-avatar">
        ${avatarHTML(brand)}
        <button class="icon-btn brand-tile-menu" data-menu-toggle data-id="${brand.id}" aria-label="Brand actions">${icon("dots", { size: 14 })}</button>
      </div>
      <h3>${brand.name}</h3>
      <div class="meta">${contents.length} pieces · ${published} published</div>
    </div>
  `;
}

const AVATAR_PREVIEW_STYLE = "width:64px;height:64px;border-radius:14px;font-size:22px;flex:none;";

// Shared create/edit modal (name + photo). Exported so Settings → Brand
// Management can reuse it too instead of duplicating the form.
export function openBrandModal({ brand = null, onSaved } = {}) {
  const draft = {
    name: brand?.name || "",
    avatar: brand?.avatar || "",
    color: brand?.color || "",
    instagram: brand?.instagram || { accessToken: "", igUserId: "", username: "", connectedAt: null },
    facebook: brand?.facebook || { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null },
    ads: brand?.ads || { adAccountId: "", adsAccessToken: "", accountName: "", connectedAt: null },
    aiVoiceGuide: brand?.aiVoiceGuide || "",
    businessDescription: brand?.businessDescription || "",
  };

  const overlay = openModal({
    title: brand ? "Edit Brand" : "New Brand",
    bodyHTML: `
      <div class="flex items-center gap-8" style="margin-bottom:22px;">
        <div id="avatar-preview">${avatarHTML({ name: draft.name || "?", avatar: draft.avatar }, AVATAR_PREVIEW_STYLE)}</div>
        <div class="flex" style="flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="upload-avatar">${icon("upload", { size: 14 })}<span id="upload-label">${draft.avatar ? "Change Photo" : "Upload Photo"}</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="remove-avatar" style="${draft.avatar ? "" : "display:none;"}">${icon("x", { size: 13 })}Remove Photo</button>
          <input type="file" id="avatar-file" accept="image/*" style="display:none;" />
        </div>
        <div class="flex items-center gap-8" style="margin-left:auto;">
          <div style="text-align:right;">
            <label style="display:block;font-size:11.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Brand Color</label>
            <input type="color" id="brand-color" value="${draft.color || "#ffa52b"}" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:none;padding:0;cursor:pointer;" />
          </div>
        </div>
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:-14px 0 18px;">This brand's essence color — used for the hover glow on its card, and as the accent throughout its Brand Lab (tabs, buttons, highlights) once you're inside it.</p>
      <div class="field">
        <label>Brand name</label>
        <input class="input" id="brand-name" placeholder="e.g. PINTER Mandarin" value="${(draft.name || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field">
        <label>What does this brand do?</label>
        <textarea class="textarea" id="brand-description" style="min-height:120px;" placeholder="Jelasin brand ini bergerak di bidang apa, layanan/produknya apa, dan buat siapa — misal: 'Kami lembaga kursus bahasa Mandarin di Kediri untuk anak-anak sampai dewasa, fokus ke percakapan praktis sehari-hari, bukan cuma teori tata bahasa...'">${(draft.businessDescription || "")}</textarea>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">Beberapa paragraf aja — ini jadi konteks dasar yang dipakai AI di seluruh aplikasi (Brand DNA, Script Generator, Auto-Schedule, dll) biar langsung ngerti bisnismu ini apa, dari brand pertama kali dibuat.</div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <div class="creator-field-head">
          <label style="margin-bottom:0;">AI Voice & Style Guide / Brandbook (optional)</label>
          <button type="button" class="btn btn-ghost btn-sm" id="upload-brandbook-text" style="flex:none;">${icon("upload", { size: 12 })}Upload .txt</button>
          <input type="file" id="brandbook-text-file" accept=".txt,.md" style="display:none;" />
        </div>
        <textarea class="textarea" id="brand-ai-voice" style="min-height:80px;" placeholder="e.g. Santai tapi informatif, pakai 'kamu', hindari jargon, banyak analogi sehari-hari...">${(draft.aiVoiceGuide || "")}</textarea>
        <div class="text-faint" style="font-size:11.5px;margin-top:4px;">Fed into the AI Script Generator so hooks/scripts/captions match this brand's tone, not a generic one. Upload a plain text file to fill this in instead of typing — PDF brandbooks aren't read automatically yet, so copy/paste the relevant text, or export it as .txt first.</div>
      </div>

      ${
        brand
          ? `
      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">Instagram (optional)</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Connects this brand's own Instagram account so views/likes/comments can be pulled in automatically instead of typed by hand — per post from the Content tab ("Fetch from Instagram"), or all at once from Content → ⋯ menu → "Refresh All Instagram Metrics". Still a manual click, not a background auto-sync — this app has no server to run one on its own.</p>
      <div class="field">
        <label>Instagram Business Account ID</label>
        <input class="input" id="ig-userid" placeholder="17841400..." value="${(draft.instagram.igUserId || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Long-Lived Access Token</label>
        <input class="input" type="password" id="ig-token" placeholder="IGAA..." value="${(draft.instagram.accessToken || "").replace(/"/g, "&quot;")}" />
      </div>
      <div id="ig-status" style="margin:10px 0;font-size:12.5px;">${draft.instagram.username ? `<span style="color:var(--health-good);">Connected as @${draft.instagram.username}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ig-test">${icon("refresh", { size: 13 })}Test Connection</button>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">Facebook Page (optional)</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Only needed if this brand's Reels get crossposted to a Facebook Page — once connected, "Fetch from Instagram" automatically checks for a matching crosspost and adds its views on top, no extra step needed.</p>
      <div class="field">
        <label>Facebook Page ID</label>
        <input class="input" id="fb-pageid" placeholder="e.g. 10015..." value="${(draft.facebook.pageId || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Page Access Token</label>
        <input class="input" type="password" id="fb-token" placeholder="EAA..." value="${(draft.facebook.pageAccessToken || "").replace(/"/g, "&quot;")}" />
      </div>
      <div id="fb-status" style="margin:10px 0;font-size:12.5px;">${draft.facebook.pageName ? `<span style="color:var(--health-good);">Connected to ${draft.facebook.pageName}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="fb-test">${icon("refresh", { size: 13 })}Test Connection</button>

      <div class="divider"></div>
      <div class="page-eyebrow" style="margin-bottom:12px;">Marketing / Ads (optional)</div>
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Only needed if you boost posts — lets the content editor show real spend/impressions/reach for a boosted post instead of it looking like organic performance.</p>
      <div class="field">
        <label>Ad Account ID</label>
        <input class="input" id="ads-account-id" placeholder="act_1234567890 (act_ prefix optional)" value="${(draft.ads.adAccountId || "").replace(/"/g, "&quot;")}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Access Token (needs ads_read)</label>
        <input class="input" type="password" id="ads-token" placeholder="EAA..." value="${(draft.ads.adsAccessToken || "").replace(/"/g, "&quot;")}" />
      </div>
      <div id="ads-status" style="margin:10px 0;font-size:12.5px;">${draft.ads.accountName ? `<span style="color:var(--health-good);">Connected to ${draft.ads.accountName}</span>` : ""}</div>
      <button type="button" class="btn btn-secondary btn-sm" id="ads-test">${icon("refresh", { size: 13 })}Test Connection</button>
      `
          : `
      <div class="divider"></div>
      <p class="text-faint" style="font-size:11.5px;margin:0;">Instagram/Facebook/Ads connections happen later — save this brand first, then reopen it and use Edit Brand to connect them.</p>
      `
      }
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-save>${icon("check", { size: 15 })}Save</button>
    `,
    onMount: (el) => {
      const nameInput = el.querySelector("#brand-name");
      setTimeout(() => nameInput.focus(), 30);

      const syncAvatarUI = () => {
        el.querySelector("#avatar-preview").innerHTML = avatarHTML({ name: nameInput.value || "?", avatar: draft.avatar }, AVATAR_PREVIEW_STYLE);
        el.querySelector("#upload-label").textContent = draft.avatar ? "Change Photo" : "Upload Photo";
        el.querySelector("#remove-avatar").style.display = draft.avatar ? "" : "none";
      };

      nameInput.addEventListener("input", syncAvatarUI);
      el.querySelector("#upload-avatar").addEventListener("click", () => el.querySelector("#avatar-file").click());
      el.querySelector("#avatar-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        draft.avatar = await resizeImageFile(file, { maxDimension: 400 });
        syncAvatarUI();
      });
      el.querySelector("#remove-avatar").addEventListener("click", () => {
        draft.avatar = "";
        syncAvatarUI();
      });
      el.querySelector("#upload-brandbook-text").addEventListener("click", () => el.querySelector("#brandbook-text-file").click());
      el.querySelector("#brandbook-text-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        el.querySelector("#brand-ai-voice").value = text;
        toast(`Loaded ${file.name}`);
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") overlay.querySelector("[data-save]").click();
      });

      el.querySelector("#ig-test")?.addEventListener("click", async () => {
        const igUserId = el.querySelector("#ig-userid").value.trim();
        const accessToken = el.querySelector("#ig-token").value.trim();
        const statusEl = el.querySelector("#ig-status");
        if (!igUserId || !accessToken) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">Both fields are required.</span>`;
          return;
        }
        statusEl.innerHTML = `<span class="text-muted">Testing…</span>`;
        try {
          const username = await testConnection({ igUserId, accessToken });
          draft.instagram = { igUserId, accessToken, username, connectedAt: Date.now() };
          statusEl.innerHTML = `<span style="color:var(--health-good);">Connected as @${username}</span>`;
        } catch (e) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${e.message}</span>`;
        }
      });

      el.querySelector("#fb-test")?.addEventListener("click", async () => {
        const pageId = el.querySelector("#fb-pageid").value.trim();
        const pageAccessToken = el.querySelector("#fb-token").value.trim();
        const statusEl = el.querySelector("#fb-status");
        if (!pageId || !pageAccessToken) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">Both fields are required.</span>`;
          return;
        }
        statusEl.innerHTML = `<span class="text-muted">Testing…</span>`;
        try {
          const pageName = await testFacebookConnection({ pageId, pageAccessToken });
          draft.facebook = { pageId, pageAccessToken, pageName, connectedAt: Date.now() };
          statusEl.innerHTML = `<span style="color:var(--health-good);">Connected to ${pageName}</span>`;
        } catch (e) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${e.message}</span>`;
        }
      });

      el.querySelector("#ads-test")?.addEventListener("click", async () => {
        const adAccountId = el.querySelector("#ads-account-id").value.trim();
        const adsAccessToken = el.querySelector("#ads-token").value.trim();
        const statusEl = el.querySelector("#ads-status");
        if (!adAccountId || !adsAccessToken) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">Both fields are required.</span>`;
          return;
        }
        statusEl.innerHTML = `<span class="text-muted">Testing…</span>`;
        try {
          const accountName = await testAdsConnection({ adAccountId, adsAccessToken });
          draft.ads = { adAccountId, adsAccessToken, accountName, connectedAt: Date.now() };
          statusEl.innerHTML = `<span style="color:var(--health-good);">Connected to ${accountName}</span>`;
        } catch (e) {
          statusEl.innerHTML = `<span style="color:var(--health-poor);">${e.message}</span>`;
        }
      });
    },
  });

  overlay.querySelector("[data-cancel]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-save]").addEventListener("click", () => {
    const nameInput = overlay.querySelector("#brand-name");
    const name = nameInput.value.trim();
    if (!name) {
      toast("Give this brand a name first.", "error");
      nameInput.focus();
      return;
    }
    // The Instagram/Facebook/Ads fields only exist in the DOM when editing
    // an existing brand (see bodyHTML above) — a brand new-created here has
    // no connections yet, so these just fall back to draft's empty defaults.
    const igUserIdEl = overlay.querySelector("#ig-userid");
    const instagram = igUserIdEl
      ? { ...draft.instagram, igUserId: igUserIdEl.value.trim(), accessToken: overlay.querySelector("#ig-token").value.trim() }
      : draft.instagram;
    const fbPageIdEl = overlay.querySelector("#fb-pageid");
    const facebook = fbPageIdEl
      ? { ...draft.facebook, pageId: fbPageIdEl.value.trim(), pageAccessToken: overlay.querySelector("#fb-token").value.trim() }
      : draft.facebook;
    const adsAccountIdEl = overlay.querySelector("#ads-account-id");
    const ads = adsAccountIdEl
      ? { ...draft.ads, adAccountId: adsAccountIdEl.value.trim(), adsAccessToken: overlay.querySelector("#ads-token").value.trim() }
      : draft.ads;
    const aiVoiceGuide = overlay.querySelector("#brand-ai-voice").value;
    const businessDescription = overlay.querySelector("#brand-description").value;
    const color = overlay.querySelector("#brand-color").value;
    if (brand) {
      updateBrand(brand.id, { name, avatar: draft.avatar, color, instagram, facebook, ads, aiVoiceGuide, businessDescription });
      toast("Brand updated");
    } else {
      createBrand({ name, avatar: draft.avatar, color, instagram, facebook, ads, aiVoiceGuide, businessDescription });
      toast(`${name} created`);
    }
    closeOverlay(overlay);
    onSaved?.();
  });
}
