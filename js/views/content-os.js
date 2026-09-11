import { getBrand, updateBrand, ROUTINE_DAYS } from "../store.js";
import * as dashboardView from "./dashboard.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import { openContentEditor } from "./content-editor.js";
import { openModal, closeOverlay } from "../modals.js";
import { qs, qsa } from "../dom.js";
import { icon } from "../icons.js";
import { t } from "../i18n.js";

// Umbrella for everything the user's own model calls "Content Operating
// System" — the analytics dashboard, the content database, Creator Studio,
// and Calendar all live inside here as sub-tabs instead of separate
// top-level nav items. Each sub-view keeps its existing render(root, {...})
// signature and internal logic completely unchanged; this just decides
// which one gets mounted based on the URL's sub-route.
const SUB_TABS = [
  { key: "dashboard", labelKey: "contentOs.tab.dashboard", path: (id) => `#/brand/${id}/content-os` },
  { key: "list", labelKey: "contentOs.tab.list", path: (id) => `#/brand/${id}/content-os/list` },
  { key: "creator", labelKey: "contentOs.tab.creator", path: (id) => `#/brand/${id}/content-os/creator` },
  { key: "calendar", labelKey: "contentOs.tab.calendar", path: (id) => `#/brand/${id}/content-os/calendar` },
];

export function render(root, { brandId, sub, contentId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const activeSub = sub || "dashboard";

  if (!brand.contentCadence) openContentCadenceSetup(brand);

  root.innerHTML = `
    <div class="tabs" style="margin:-4px 0 20px;">
      ${SUB_TABS.map((tab) => `<a class="tab ${activeSub === tab.key ? "active" : ""}" href="${tab.path(brandId)}">${t(tab.labelKey)}</a>`).join("")}
    </div>
    <div id="cos-mount"></div>
  `;
  const mount = document.getElementById("cos-mount");

  let cleanup;
  if (activeSub === "list") {
    cleanup = contentListView.render(mount, { brandId });
    if (contentId) openContentEditor({ brandId, contentId, onSaved: () => {} });
  } else if (activeSub === "creator") {
    cleanup = creatorView.render(mount, { brandId, initialContentId: contentId });
  } else if (activeSub === "calendar") {
    cleanup = calendarView.render(mount, { brandId });
  } else {
    cleanup = dashboardView.render(mount, { brandId });
  }

  return () => cleanup?.();
}

// Asked once per brand, the first time anyone opens Content OS — feeds the
// AI Auto-Schedule constraints in calendar.js (which days are in play, how
// many pieces a day this brand can realistically produce) instead of the
// scheduler guessing a generic cadence. Skippable — a skip still records
// contentCadence (empty) so this doesn't reprompt on every visit.
function openContentCadenceSetup(brand) {
  const state = { days: new Set() };
  const overlay = openModal({
    title: t("contentOs.cadence.title"),
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 16px;">${t("contentOs.cadence.sub", { brand: escapeText(brand.name) })}</p>
      <div class="field" style="margin-bottom:14px;">
        <label>${t("contentOs.cadence.daysLabel")}</label>
        <div class="chip-select" id="cadence-day-chips" style="flex-wrap:wrap;">
          ${ROUTINE_DAYS.map((d) => `<button type="button" data-day="${d}">${t(`calendar.dow.${d}`)}</button>`).join("")}
        </div>
      </div>
      <div class="field" style="margin-bottom:4px;">
        <label>${t("contentOs.cadence.perDayLabel")}</label>
        <input class="input" type="number" id="cadence-per-day" min="1" value="1" style="width:120px;" />
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:6px 0 0;">${t("contentOs.cadence.note")}</p>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="cadence-skip">${t("contentOs.cadence.skip")}</button>
      <button class="btn btn-primary" id="cadence-save">${icon("check", { size: 15 })}${t("contentOs.cadence.save")}</button>
    `,
  });
  qsa("#cadence-day-chips button", overlay).forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = btn.dataset.day;
      if (state.days.has(d)) state.days.delete(d);
      else state.days.add(d);
      btn.classList.toggle("active", state.days.has(d));
    });
  });
  qs("#cadence-skip", overlay).addEventListener("click", () => {
    updateBrand(brand.id, { contentCadence: { uploadDays: [], perDay: 1, configured: false } });
    closeOverlay(overlay);
  });
  qs("#cadence-save", overlay).addEventListener("click", () => {
    const perDay = Math.max(1, Number(qs("#cadence-per-day", overlay).value) || 1);
    updateBrand(brand.id, { contentCadence: { uploadDays: [...state.days], perDay, configured: true } });
    closeOverlay(overlay);
  });
}

function escapeText(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
