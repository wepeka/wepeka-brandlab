import { updateBrand, syncCadenceRoutine, ROUTINE_DAYS } from "./store.js";
import { openModal, closeOverlay } from "./modals.js";
import { qs, qsa, escapeHtml as escapeText } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

// Lives in its own module (not js/views/content-os.js, where this used to
// be) so js/views/calendar.js can open it too without the two view files
// importing each other — content-os.js already imports calendar.js as its
// Calendar sub-tab, so calendar.js importing back from content-os.js would
// be a circular import.
//
// One setup, three consumers: the AI Auto-Schedule constraints in
// calendar.js (which days are upload days, how many pieces a day), and the
// Shoot/Edit/Upload rows in My Routine on the Brands page
// (store.js's syncCadenceRoutine — see there for how those stay in sync
// without touching anything added to My Routine by hand). Asked once per
// brand the first time anyone opens Content OS, and re-openable any time
// from Calendar's "Jadwal Kerja" button. Skippable on first run — a skip
// still records contentCadence (empty) so this doesn't reprompt every visit.
function dayChipsHTML(id, selectedDays) {
  return `
    <div class="chip-select" id="${id}" style="flex-wrap:wrap;">
      ${ROUTINE_DAYS.map((d) => `<button type="button" data-day="${d}" class="${selectedDays.has(d) ? "active" : ""}">${t(`calendar.dow.${d}`)}</button>`).join("")}
    </div>
  `;
}

export function openContentCadenceSetup(brand) {
  const existing = brand.contentCadence;
  const state = {
    shootDays: new Set(existing?.shootDays || []),
    editDays: new Set(existing?.editDays || []),
    uploadDays: new Set(existing?.uploadDays || []),
  };
  const overlay = openModal({
    title: t("contentOs.cadence.title"),
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 16px;">${t("contentOs.cadence.sub", { brand: escapeText(brand.name) })}</p>
      <div class="cad-tip">
        <div class="cad-tip-head">${icon("bulb", { size: 15 })}<b>${t("contentOs.cadence.tipTitle")}</b></div>
        <p>${t("contentOs.cadence.tipBody")}</p>
        <button type="button" class="btn btn-secondary btn-sm" id="cadence-apply-tip">${icon("check", { size: 13 })}${t("contentOs.cadence.tipApply")}</button>
      </div>
      <div class="field" style="margin-bottom:16px;">
        <label>${icon("play", { size: 12 })} ${t("contentOs.cadence.shootLabel")}</label>
        ${dayChipsHTML("cadence-shoot-chips", state.shootDays)}
      </div>
      <div class="field" style="margin-bottom:16px;">
        <label>${icon("edit", { size: 12 })} ${t("contentOs.cadence.editLabel")}</label>
        ${dayChipsHTML("cadence-edit-chips", state.editDays)}
      </div>
      <div class="field" style="margin-bottom:16px;">
        <label>${icon("upload", { size: 12 })} ${t("contentOs.cadence.uploadLabel")}</label>
        ${dayChipsHTML("cadence-upload-chips", state.uploadDays)}
      </div>
      <div class="field" style="margin-bottom:4px;">
        <label>${t("contentOs.cadence.perDayLabel")}</label>
        <input class="input" type="number" id="cadence-per-day" min="1" value="${existing?.perDay || 1}" style="width:120px;" />
      </div>
      <p class="text-faint" style="font-size:11.5px;margin:6px 0 0;">${t("contentOs.cadence.note")}</p>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="cadence-skip">${t("contentOs.cadence.skip")}</button>
      <button class="btn btn-primary" id="cadence-save">${icon("check", { size: 15 })}${t("contentOs.cadence.save")}</button>
    `,
  });
  const wireChips = (chipsId, daySet) => {
    qsa(`#${chipsId} button`, overlay).forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = btn.dataset.day;
        if (daySet.has(d)) daySet.delete(d);
        else daySet.add(d);
        btn.classList.toggle("active", daySet.has(d));
      });
    });
  };
  wireChips("cadence-shoot-chips", state.shootDays);
  wireChips("cadence-edit-chips", state.editDays);
  wireChips("cadence-upload-chips", state.uploadDays);
  // The tip's example: one shooting day, one editing day, upload daily.
  qs("#cadence-apply-tip", overlay).addEventListener("click", () => {
    const apply = (chipsId, daySet, days) => {
      daySet.clear();
      days.forEach((d) => daySet.add(d));
      qsa(`#${chipsId} button`, overlay).forEach((b) => b.classList.toggle("active", daySet.has(b.dataset.day)));
    };
    apply("cadence-shoot-chips", state.shootDays, ["mon"]);
    apply("cadence-edit-chips", state.editDays, ["tue"]);
    apply("cadence-upload-chips", state.uploadDays, ROUTINE_DAYS);
    qs("#cadence-per-day", overlay).value = 1;
  });
  qs("#cadence-skip", overlay).addEventListener("click", () => {
    if (!existing) updateBrand(brand.id, { contentCadence: { shootDays: [], editDays: [], uploadDays: [], perDay: 1, configured: false } });
    closeOverlay(overlay);
  });
  qs("#cadence-save", overlay).addEventListener("click", () => {
    const perDay = Math.max(1, Number(qs("#cadence-per-day", overlay).value) || 1);
    const cadence = {
      shootDays: [...state.shootDays],
      editDays: [...state.editDays],
      uploadDays: [...state.uploadDays],
      perDay,
      configured: true,
    };
    updateBrand(brand.id, { contentCadence: cadence });
    syncCadenceRoutine(brand.id, cadence);
    closeOverlay(overlay);
  });
}
