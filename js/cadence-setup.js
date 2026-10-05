import { updateBrand, listSeries, ROUTINE_DAYS } from "./store.js";
import { openModal, closeOverlay } from "./modals.js";
import { qs, qsa, escapeHtml as escapeText } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { getMode } from "./mode.js";

// Lives in its own module (not js/views/content-os.js, where this used to
// be) so js/views/calendar.js can open it too without the two view files
// importing each other — content-os.js already imports calendar.js as its
// Calendar sub-tab, so calendar.js importing back from content-os.js would
// be a circular import.
//
// One setup, one consumer: the AI Auto-Schedule constraints in calendar.js
// (which days are upload days, how many pieces a day) — this used to also
// mirror itself into the standalone My Routine editor's routineTemplate
// collection (store.js's syncCadenceRoutine), but that editor had no
// caller left anywhere in the app, so the mirroring write was removed;
// brand.contentCadence (set here) is the only copy of this now. Asked once
// per brand the first time anyone opens Content OS, and re-openable any
// time from Calendar's "Jadwal Kerja" button. Skippable on first run — a
// skip still records contentCadence (empty) so this doesn't reprompt every visit.
function dayChipsHTML(id, selectedDays) {
  return `
    <div class="chip-select" id="${id}" style="flex-wrap:wrap;">
      ${ROUTINE_DAYS.map((d) => `<button type="button" data-day="${d}" class="${selectedDays.has(d) ? "active" : ""}" aria-pressed="${selectedDays.has(d)}">${t(`calendar.dow.${d}`)}</button>`).join("")}
    </div>
  `;
}

export function openContentCadenceSetup(brand) {
  const existing = brand.contentCadence;
  const state = {
    shootDays: new Set(existing?.shootDays || []),
    editDays: new Set(existing?.editDays || []),
    uploadDays: new Set(existing?.uploadDays || []),
    seriesDays: { ...(existing?.seriesDays || {}) },
  };
  const allSeries = listSeries(brand.id);
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
      <div class="field cad-series" id="cadence-series" style="margin-bottom:16px;"></div>
      <div class="field" style="margin-bottom:4px;">
        <label>${t("contentOs.cadence.perDayLabel")}</label>
        <input class="input" type="number" id="cadence-per-day" min="1" value="${existing?.perDay || 1}" style="width:120px;" />
      </div>
      ${getMode() === "advanced" ? `<p class="text-faint" style="font-size:11.5px;margin:6px 0 0;">${t("contentOs.cadence.note")}</p>` : "" /* a funnel-stage rule; Pemula has no funnel words */}
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
        btn.setAttribute("aria-pressed", String(daySet.has(d)));
      });
    });
  };
  wireChips("cadence-shoot-chips", state.shootDays);
  wireChips("cadence-edit-chips", state.editDays);
  wireChips("cadence-upload-chips", state.uploadDays);
  // "Isi tiap hari": each upload day can air one series ("Rabu = Bedah
  // Brand"). Read by the weekly plan, the Calendar and the chat
  // (js/week-plan.js seriesDays). Hidden until the brand has a series.
  const paintSeries = () => {
    const box = qs("#cadence-series", overlay);
    const days = ROUTINE_DAYS.filter((d) => state.uploadDays.has(d));
    if (!allSeries.length || !days.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <label>${icon("sparkle", { size: 12 })} ${t("cadence.series.label")}</label>
      <p class="text-faint" style="font-size:11.5px;margin:0 0 8px;">${t("cadence.series.hint")}</p>
      <div class="cad-series-rows">
        ${days.map((d) => `
          <div class="cad-series-row">
            <span>${t(`store.day.${d}`)}</span>
            <select class="input" data-series-day="${d}">
              <option value="">${t("cadence.series.free")}</option>
              ${allSeries.map((s) => `<option value="${escapeText(s.id)}" ${state.seriesDays[d] === s.id ? "selected" : ""}>${escapeText(t("series.pick", { name: s.name }))}</option>`).join("")}
            </select>
          </div>`).join("")}
      </div>`;
    qsa("[data-series-day]", box).forEach((sel) => sel.addEventListener("change", () => {
      if (sel.value) state.seriesDays[sel.dataset.seriesDay] = sel.value;
      else delete state.seriesDays[sel.dataset.seriesDay];
    }));
  };
  paintSeries();
  qsa("#cadence-upload-chips button", overlay).forEach((btn) => btn.addEventListener("click", paintSeries));
  // The tip's example: one shooting day, one editing day, upload daily.
  qs("#cadence-apply-tip", overlay).addEventListener("click", () => {
    const apply = (chipsId, daySet, days) => {
      daySet.clear();
      days.forEach((d) => daySet.add(d));
      qsa(`#${chipsId} button`, overlay).forEach((b) => { b.classList.toggle("active", daySet.has(b.dataset.day)); b.setAttribute("aria-pressed", String(daySet.has(b.dataset.day))); });
    };
    apply("cadence-shoot-chips", state.shootDays, ["mon"]);
    apply("cadence-edit-chips", state.editDays, ["tue"]);
    apply("cadence-upload-chips", state.uploadDays, ROUTINE_DAYS);
    qs("#cadence-per-day", overlay).value = 1;
    paintSeries();
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
      // Only days still marked for upload keep their series.
      seriesDays: Object.fromEntries(Object.entries(state.seriesDays).filter(([d, id]) => state.uploadDays.has(d) && allSeries.some((s) => s.id === id))),
    };
    updateBrand(brand.id, { contentCadence: cadence });
    closeOverlay(overlay);
  });
}
