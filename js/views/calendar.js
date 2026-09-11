import { getBrand, listContent, listCampaigns, updateContent, getSettings, onChange, STATUS_LABELS, listRoutineTemplate, ROUTINE_DAY_LABELS, ROUTINE_ACTIVITY_LABELS } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { suggestSchedule, hasAiKey } from "../ai.js";
import { t } from "../i18n.js";

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dow = () => DOW_KEYS.map((k) => t(`calendar.dow.${k}`));
const months = () => Array.from({ length: 12 }, (_, i) => t(`calendar.month.${i}`));

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sameDay(a, b) { return iso(a) === iso(b); }
function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }

const FUNNEL_COLOR = { TOFU: "var(--tofu)", MOFU: "var(--mofu)", BOFU: "var(--bofu)" };

// Confirmed against the official SKB 3 Menteri 2026 announcement
// (setneg.go.id) — exact for 2026 only, since Islamic/lunar/Balinese
// holidays shift every year and aren't computed here. Other years fall
// back to just the fixed-date national holidays below.
const HOLIDAYS_ID_2026 = {
  "2026-01-01": "Tahun Baru Masehi",
  "2026-01-16": "Isra Mikraj",
  "2026-02-17": "Tahun Baru Imlek",
  "2026-03-19": "Hari Suci Nyepi",
  "2026-03-21": "Idulfitri",
  "2026-03-22": "Idulfitri",
  "2026-04-03": "Wafat Yesus Kristus",
  "2026-04-05": "Paskah",
  "2026-05-01": "Hari Buruh",
  "2026-05-14": "Kenaikan Yesus Kristus",
  "2026-05-27": "Iduladha",
  "2026-05-31": "Hari Raya Waisak",
  "2026-06-01": "Hari Lahir Pancasila",
  "2026-06-16": "Tahun Baru Islam",
  "2026-08-17": "HUT RI",
  "2026-08-25": "Maulid Nabi Muhammad",
  "2026-12-25": "Hari Natal",
};
const CUTI_BERSAMA_ID_2026 = {
  "2026-02-16": "Cuti Bersama Imlek",
  "2026-03-18": "Cuti Bersama Nyepi",
  "2026-03-20": "Cuti Bersama Idulfitri",
  "2026-03-23": "Cuti Bersama Idulfitri",
  "2026-03-24": "Cuti Bersama Idulfitri",
  "2026-05-15": "Cuti Bersama Kenaikan Isa Almasih",
  "2026-05-28": "Cuti Bersama Iduladha",
  "2026-12-24": "Cuti Bersama Natal",
};
function fixedHolidaysForYear(year) {
  return {
    [`${year}-01-01`]: "Tahun Baru Masehi",
    [`${year}-05-01`]: "Hari Buruh",
    [`${year}-06-01`]: "Hari Lahir Pancasila",
    [`${year}-08-17`]: "HUT RI",
    [`${year}-12-25`]: "Hari Natal",
  };
}
// { label, cuti: boolean } or null — cuti (joint leave) gets a lighter
// treatment than an actual libur nasional.
function holidayForDate(dateISO) {
  const year = dateISO.slice(0, 4);
  if (year === "2026") {
    if (HOLIDAYS_ID_2026[dateISO]) return { label: HOLIDAYS_ID_2026[dateISO], cuti: false };
    if (CUTI_BERSAMA_ID_2026[dateISO]) return { label: CUTI_BERSAMA_ID_2026[dateISO], cuti: true };
    return null;
  }
  const fixed = fixedHolidaysForYear(year)[dateISO];
  return fixed ? { label: fixed, cuti: false } : null;
}

export function render(root, { brandId }) {
  const state = { view: "month", cursor: new Date(), bankOpen: false };
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

// Overdue-and-still-unpublished content drops off the calendar entirely
// instead of sitting stale on a day that's already passed — it moves to
// the "Overdue" reminder on the home page instead, which is a clearer
// place to actually deal with it than a grid cell in the past.
function itemsForBrand(brandId) {
  const todayISO = new Date().toISOString().slice(0, 10);
  return listContent(brandId).filter((c) => {
    if (c.publishedDate) return true;
    if (!c.scheduleDate) return false;
    return c.scheduleDate >= todayISO;
  });
}

// Everything with no date yet, grouped by how far along it is — the
// "backlog" you drag out of and onto a day. Dropping just sets a date; it
// doesn't touch status, same as dragging an already-scheduled item.
const BANK_GROUPS = [
  { labelKey: "calendar.bank.drafting", statuses: ["idea", "draft"] },
  { labelKey: "calendar.bank.execution", statuses: ["production"] },
  { labelKey: "calendar.bank.editing", statuses: ["editing"] },
  { labelKey: "calendar.bank.readyToUpload", statuses: ["scheduled"] },
];

function contentBankHTML(brandId) {
  const unscheduled = listContent(brandId).filter((c) => !c.scheduleDate);
  const groups = BANK_GROUPS.map((g) => ({ ...g, items: unscheduled.filter((c) => g.statuses.includes(c.status)) })).filter((g) => g.items.length);
  return `
    <div class="content-bank" id="content-bank">
      <div class="content-bank-head">
        <span>${t("calendar.bank.title")}</span>
        <button class="icon-btn" id="close-bank" aria-label="${t("common.close")}" style="width:26px;height:26px;">${icon("x", { size: 13 })}</button>
      </div>
      <p class="text-faint" style="font-size:11.5px;padding:0 14px;margin:8px 0 12px;">${t("calendar.bank.hint")}</p>
      <div class="content-bank-list">
        ${
          groups.length
            ? groups
                .map(
                  (g) => `
          <div class="content-bank-group">
            <div class="content-bank-group-head">${t(g.labelKey)} <span class="text-faint">${g.items.length}</span></div>
            ${g.items
              .map(
                (c) => `
              <div class="cal-item bank-item" draggable="true" data-id="${c.id}" title="${escapeAttr(c.title)}">
                <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>${escapeText(c.title || t("common.untitled"))}
              </div>`
              )
              .join("")}
          </div>`
                )
                .join("")
            : `<div class="table-empty" style="padding:24px 16px;">${t("calendar.bank.empty")}</div>`
        }
      </div>
    </div>
  `;
}

// Turns this brand's standing weekly routine into plain-language rules the
// scheduler prompt can follow — "Editing every Tuesday", "Upload every day".
function routineNotesForBrand(brandId) {
  const routineNotes = listRoutineTemplate()
    .filter((item) => item.brandId === brandId)
    .map((item) => {
      const activity = item.activity === "custom" ? item.customLabel || "Custom task" : ROUTINE_ACTIVITY_LABELS[item.activity];
      const time = item.time ? ` at ${item.time}` : "";
      return `${activity} every ${ROUTINE_DAY_LABELS[item.day]}${time}`;
    });
  return [...routineNotes, ...cadenceNotesForBrand(brandId)];
}

// The one-time Content OS setup question (js/views/content-os.js) becomes
// hard constraints here — which days are actually upload days, the daily
// cap, and the standing rule that two pieces of the same funnel stage never
// share a day even when the cap allows more than one upload.
function cadenceNotesForBrand(brandId) {
  const cadence = getBrand(brandId)?.contentCadence;
  if (!cadence || !cadence.configured) return [];
  const notes = [];
  if (cadence.uploadDays?.length) {
    notes.push(`Only schedule on these days of the week: ${cadence.uploadDays.map((d) => ROUTINE_DAY_LABELS[d]).join(", ")}.`);
  }
  notes.push(`This brand can realistically post at most ${cadence.perDay} piece(s) of content per day.`);
  notes.push("Never schedule two items of the same funnel stage (TOFU/MOFU/BOFU) on the same day, even if the daily cap allows more than one upload that day.");
  return notes;
}

// Picks up everything still in progress with no date on it yet and lets
// the AI spread them across the next 3 weeks — a starting point to drag
// around afterward, not a final answer.
async function runAutoSchedule(brandId, refresh) {
  const ai = getSettings().ai || {};
  const hasKey = hasAiKey(ai);
  if (!hasKey) {
    toast(t("calendar.autoschedule.noKey"), "error");
    return;
  }
  const unscheduled = listContent(brandId).filter(
    (c) => !c.scheduleDate && ["idea", "draft", "production", "editing", "scheduled"].includes(c.status)
  );
  if (!unscheduled.length) {
    toast(t("calendar.autoschedule.nothingToSchedule"));
    return;
  }
  toast(t("calendar.autoschedule.asking", { count: unscheduled.length }));
  try {
    const startDate = new Date().toISOString().slice(0, 10);
    const brand = getBrand(brandId);
    const campaigns = listCampaigns(brandId);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    const schedule = await suggestSchedule(ai, {
      items: unscheduled.map((c) => {
        const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
        const phase = campaign?.phases?.find((p) => p.id === c.campaignPhaseId);
        return {
          id: c.id, title: c.title, funnel: c.funnel, status: c.status,
          campaignPhase: campaign ? `${campaign.name}${phase ? ` — ${phase.name}` : ""}` : "",
        };
      }),
      startDate,
      daysAhead: 21,
      routineNotes: routineNotesForBrand(brandId),
      brand,
      campaigns,
    });
    const proposed = unscheduled
      .filter((c) => schedule.has(c.id))
      .map((c) => ({ content: c, date: schedule.get(c.id) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!proposed.length) {
      toast(t("calendar.autoschedule.noResult"), "error");
      return;
    }
    openAutoScheduleConfirm(proposed, refresh);
  } catch (e) {
    toast(e.message || t("calendar.autoschedule.failed"), "error");
  }
}

// Nothing gets written to the calendar until this is explicitly confirmed —
// the AI's dates are a proposal to review (and adjust per-row) first, not
// an instant write.
function openAutoScheduleConfirm(proposed, refresh) {
  const overlay = openModal({
    title: t("calendar.autoschedule.reviewTitle"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">${t("calendar.autoschedule.reviewSub")}</p>
      <div class="auto-schedule-list">
        ${proposed
          .map(
            (p, i) => `
          <div class="auto-schedule-row">
            <span class="tag tag-${p.content.funnel.toLowerCase()}">${p.content.funnel}</span>
            <span class="auto-schedule-title">${escapeHtml(p.content.title || t("common.untitled"))}</span>
            <input class="input" type="date" data-schedule-index="${i}" value="${p.date}" style="width:auto;" />
          </div>`
          )
          .join("")}
      </div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="auto-schedule-cancel">${t("common.cancel")}</button>
      <button class="btn btn-primary" id="auto-schedule-confirm">${icon("check", { size: 15 })}${t("calendar.autoschedule.confirm")}</button>
    `,
  });
  overlay.querySelector("#auto-schedule-cancel").addEventListener("click", () => closeOverlay(overlay));
  qsa("[data-schedule-index]", overlay).forEach((input) => {
    input.addEventListener("change", () => {
      proposed[Number(input.dataset.scheduleIndex)].date = input.value;
    });
  });
  overlay.querySelector("#auto-schedule-confirm").addEventListener("click", () => {
    proposed.forEach((p) => updateContent(p.content.id, { scheduleDate: p.date }));
    toast(t("calendar.autoschedule.done", { count: proposed.length }));
    closeOverlay(overlay);
    refresh();
  });
}

// There's no Google Calendar account to push into from a zero-backend app
// with no OAuth — a standard .ics file is the no-auth-needed equivalent:
// Google Calendar imports it directly (Settings → Import & export), and so
// does every other calendar app.
function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
function icsDate(dateISO) {
  return dateISO.replace(/-/g, "");
}
function icsDateNext(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return iso(d).replace(/-/g, "");
}
function exportBrandICS(brandId, brandName, items) {
  if (!items.length) {
    toast(t("calendar.ics.empty"));
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const events = items
    .map((c) => {
      const dateISO = c.scheduleDate || c.publishedDate;
      const summary = `${c.funnel ? `[${c.funnel}] ` : ""}${c.title || t("common.untitled")}`;
      const desc = [c.platform, c.format, STATUS_LABELS[c.status]].filter(Boolean).join(" · ");
      return [
        "BEGIN:VEVENT",
        `UID:${c.id}@wepekabrandlab`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(dateISO)}`,
        `DTEND;VALUE=DATE:${icsDateNext(dateISO)}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wepeka Brandlab//Content Calendar//EN", "CALSCALE:GREGORIAN", events, "END:VCALENDAR"].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-calendar.ics`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("calendar.ics.done"));
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) { location.hash = "#/"; return; }
  const items = itemsForBrand(brandId);
  const campaigns = listCampaigns(brandId);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${t("calendar.eyebrow")}</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="toggle-bank">${icon("layers", { size: 15 })}${t("calendar.contentBankBtn")}</button>
        <button class="btn btn-secondary" id="ai-autoschedule">${icon("bot", { size: 15 })}${t("calendar.autoscheduleBtn")}</button>
        <button class="btn btn-secondary" id="export-gcal" title="${t("calendar.exportGcalTitle")}">${icon("download", { size: 15 })}${t("calendar.exportGcalBtn")}</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}${t("calendar.newContentBtn")}</button>
      </div>
    </div>
    <div class="cal-head">
      <div class="cal-nav">
        <button class="icon-btn" id="cal-prev" aria-label="${t("calendar.prevPeriod")}">${icon("chevronLeft", { size: 16 })}</button>
        <div class="cal-month-label">${periodLabel(state)}</div>
        <button class="icon-btn" id="cal-next" aria-label="${t("calendar.nextPeriod")}">${icon("chevronRight", { size: 16 })}</button>
        <button class="btn btn-secondary btn-sm" id="cal-today">${t("calendar.today")}</button>
      </div>
      <div class="segmented" style="width:220px;">
        ${["month", "week", "day"].map((v) => `<button data-view="${v}" class="${state.view === v ? "active" : ""}">${t(`calendar.view.${v}`)}</button>`).join("")}
      </div>
    </div>
    <div id="cal-body"></div>
    ${state.bankOpen ? contentBankHTML(brandId) : ""}
  `;

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  qs("#ai-autoschedule").addEventListener("click", () => runAutoSchedule(brandId, refresh));
  qs("#export-gcal").addEventListener("click", () => exportBrandICS(brandId, brand.name, items));
  qs("#toggle-bank").addEventListener("click", () => { state.bankOpen = !state.bankOpen; paint(root, brandId, state, refresh); });
  const closeBankBtn = qs("#close-bank");
  if (closeBankBtn) closeBankBtn.addEventListener("click", () => { state.bankOpen = false; paint(root, brandId, state, refresh); });
  qs("#cal-prev").addEventListener("click", () => { step(state, -1); paint(root, brandId, state, refresh); });
  qs("#cal-next").addEventListener("click", () => { step(state, 1); paint(root, brandId, state, refresh); });
  qs("#cal-today").addEventListener("click", () => { state.cursor = new Date(); paint(root, brandId, state, refresh); });
  qsa("[data-view]").forEach((btn) => btn.addEventListener("click", () => { state.view = btn.dataset.view; paint(root, brandId, state, refresh); }));

  const body = qs("#cal-body");
  if (state.view === "month") renderMonth(body, brandId, state, items, campaigns, campaignById, refresh);
  else renderAgenda(body, brandId, state, items, campaignById, refresh);

  qsa(".bank-item", root).forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openContentEditor({ brandId, contentId: el.dataset.id, onSaved: refresh });
    });
  });
}

function periodLabel(state) {
  const d = state.cursor;
  if (state.view === "month") return `${months()[d.getMonth()]} ${d.getFullYear()}`;
  if (state.view === "week") {
    const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${months()[s.getMonth()].slice(0,3)} ${s.getDate()} – ${months()[e.getMonth()].slice(0,3)} ${e.getDate()}`;
  }
  return `${months()[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function step(state, dir) {
  const d = new Date(state.cursor);
  if (state.view === "month") d.setMonth(d.getMonth() + dir);
  else if (state.view === "week") d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  state.cursor = d;
}

function renderMonth(body, brandId, state, items, campaigns, campaignById, refresh) {
  const d = state.cursor;
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = new Date();

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const outside = day.getMonth() !== d.getMonth();
    const dayItems = items.filter((c) => sameDay(new Date(c.scheduleDate || c.publishedDate), day));
    const shown = dayItems.slice(0, 3);
    const extra = dayItems.length - shown.length;
    const holiday = holidayForDate(iso(day));

    cells += `
      <div class="cal-cell ${outside ? "outside" : ""} ${sameDay(day, today) ? "today" : ""} ${holiday ? (holiday.cuti ? "cuti" : "holiday") : ""}" data-date="${iso(day)}" ${holiday ? `title="${escapeAttr(holiday.label)}"` : ""}>
        <div class="cal-date">${day.getDate()}</div>
        ${holiday ? `<div class="cal-holiday-label">${escapeText(holiday.label)}</div>` : ""}
        ${shown.map((c) => {
          const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
          const itemTitle = campaign ? `${c.title} · ${campaign.name}` : c.title;
          return `
          <div class="cal-item" draggable="true" data-id="${c.id}" title="${escapeAttr(itemTitle)}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>
            ${campaign ? `<span class="cal-item-campaign-dot" title="${escapeAttr(campaign.name)}"></span>` : ""}
            ${escapeText(c.title || t("common.untitled"))}
          </div>`;
        }).join("")}
        ${extra > 0 ? `<div class="cal-more">${t("calendar.more", { count: extra })}</div>` : ""}
      </div>
    `;
  }

  body.innerHTML = `
    ${campaignTimelineHTML(campaigns, d)}
    <div class="cal-grid">
      ${dow().map((dw) => `<div class="cal-dow">${dw}</div>`).join("")}
      ${cells}
    </div>
  `;

  wireDragAndOpen(body, brandId, refresh);
}

// A thin Gantt-lite strip above the month grid — one row per active
// campaign whose date window overlaps the visible month, positioned by
// day-of-month percentage. Scoped to the current month only (not the
// padded 42-cell grid, which spans into neighboring months) so the math
// stays simple: no row-wrapping across week boundaries to worry about.
function campaignTimelineHTML(campaigns, monthDate) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const monthStartISO = iso(monthStart);
  const monthEndISO = iso(monthEnd);
  const active = campaigns.filter((c) => c.status !== "archived" && c.startDate && c.endDate && c.startDate <= monthEndISO && c.endDate >= monthStartISO);
  if (!active.length) return "";
  const rows = active
    .map((c) => {
      const startDay = c.startDate > monthStartISO ? Number(c.startDate.slice(8, 10)) : 1;
      const endDay = c.endDate < monthEndISO ? Number(c.endDate.slice(8, 10)) : daysInMonth;
      const leftPct = ((startDay - 1) / daysInMonth) * 100;
      const widthPct = ((endDay - startDay + 1) / daysInMonth) * 100;
      return `
        <div class="cal-timeline-row">
          <span class="cal-timeline-label">${escapeText(c.name || t("calendar.untitledCampaign"))}</span>
          <div class="cal-timeline-track"><div class="cal-timeline-bar" style="left:${leftPct}%;width:${widthPct}%;"></div></div>
        </div>
      `;
    })
    .join("");
  return `<div class="cal-timeline">${rows}</div>`;
}

function renderAgenda(body, brandId, state, items, campaignById, refresh) {
  const d = state.cursor;
  let rangeStart, rangeEnd;
  if (state.view === "week") { rangeStart = startOfWeek(d); rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + 6); }
  else { rangeStart = new Date(d); rangeEnd = new Date(d); }
  rangeStart.setHours(0,0,0,0); rangeEnd.setHours(23,59,59,999);

  const filtered = items
    .filter((c) => {
      const dt = new Date(c.scheduleDate || c.publishedDate);
      return dt >= rangeStart && dt <= rangeEnd;
    })
    .sort((a, b) => (a.scheduleDate || a.publishedDate).localeCompare(b.scheduleDate || b.publishedDate));

  body.innerHTML = filtered.length
    ? `<div class="agenda-list">${filtered.map((c) => agendaRow(c, campaignById)).join("")}</div>`
    : `<div class="card"><div class="table-empty">${t("calendar.agendaEmpty", { view: t(`calendar.view.${state.view}`).toLowerCase() })}</div></div>`;

  qsa("[data-id]", body).forEach((el) => {
    el.addEventListener("click", () => openCalItemMenu(el, { brandId, contentId: el.dataset.id, refresh }));
  });
}

function agendaRow(c, campaignById) {
  const dt = new Date(c.scheduleDate || c.publishedDate);
  const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
  return `
    <div class="agenda-row" data-id="${c.id}">
      <div class="agenda-date"><div class="d">${dt.getDate()}</div><div class="m">${months()[dt.getMonth()].slice(0,3)}</div></div>
      <div class="ti" style="flex:1;min-width:0;">
        <div class="t" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || t("common.untitled"))}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${c.platform || "—"} · ${c.format || "—"}</div>
      </div>
      ${campaign ? `<span class="tag" style="background:color-mix(in srgb, var(--brand-tint) 14%, transparent);color:var(--brand-tint);">${escapeText(campaign.name)}</span>` : ""}
      <span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span>
      <span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span>
    </div>
  `;
}

function wireDragAndOpen(body, brandId, refresh) {
  qsa(".cal-item", body).forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openCalItemMenu(el, { brandId, contentId: el.dataset.id, refresh });
    });
  });

  qsa(".cal-cell", body).forEach((cell) => {
    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drag-over"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      assignToDate(brandId, id, cell.dataset.date);
    });
    cell.addEventListener("click", (e) => {
      if (e.target.closest(".cal-item")) return;
      openDateBankMenu(cell, { brandId, dateISO: cell.dataset.date, refresh });
    });
  });
}

// Same-funnel-same-day is the one rule the user wants actively enforced
// (a brand might publish 2 pieces in a day, but never two of the same
// TOFU/MOFU/BOFU stage) — informational only, never blocks the action.
function warnIfFunnelClash(brandId, contentId, dateISO) {
  const moving = listContent(brandId).find((c) => c.id === contentId);
  if (!moving) return;
  const clash = listContent(brandId).some(
    (c) => c.id !== contentId && c.scheduleDate === dateISO && c.funnel === moving.funnel
  );
  if (clash) toast(t("calendar.funnelClash", { date: dateISO, funnel: moving.funnel }), "error");
}

function assignToDate(brandId, contentId, dateISO) {
  updateContent(contentId, { scheduleDate: dateISO, status: "scheduled" });
  warnIfFunnelClash(brandId, contentId, dateISO);
  toast(t("common.scheduled"));
}

// Click on a placed item → a small Edit / Remove-from-calendar choice,
// instead of jumping straight into the editor — mirrors the row-menu
// pattern used in Content OS's table (content-list.js).
function openCalItemMenu(anchorEl, { brandId, contentId, refresh }) {
  qsa(".menu").forEach((m) => m.remove());
  const rect = anchorEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.top = rect.bottom + window.scrollY + 6 + "px";
  menu.style.left = Math.min(rect.left, window.innerWidth - 190) + window.scrollX + "px";
  menu.innerHTML = `
    <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
    <button data-act="remove" class="danger">${icon("x", { size: 15 })}${t("calendar.removeFromCalendar")}</button>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
  menu.addEventListener("click", async (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]")?.dataset.act;
    menu.remove();
    if (act === "edit") {
      openContentEditor({ brandId, contentId, onSaved: refresh });
    } else if (act === "remove") {
      const ok = await confirmDialog({
        title: t("calendar.removeConfirmTitle"),
        message: t("calendar.removeConfirmMsg"),
        confirmLabel: t("common.remove"),
      });
      if (!ok) return;
      updateContent(contentId, { scheduleDate: "" });
      toast(t("calendar.removedToast"));
      refresh();
    }
  });
}

// Tapping an empty spot on a day cell surfaces the same unscheduled backlog
// as the Content Bank sidebar, scoped to a single click-to-assign choice —
// no dragging required — with "create new" as the fallback underneath.
function openDateBankMenu(cell, { brandId, dateISO, refresh }) {
  qsa(".menu").forEach((m) => m.remove());
  const unscheduled = listContent(brandId).filter((c) => !c.scheduleDate);
  const rect = cell.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "menu date-bank-menu";
  menu.style.top = rect.bottom + window.scrollY + 6 + "px";
  menu.style.left = Math.min(rect.left, window.innerWidth - 260) + window.scrollX + "px";
  menu.innerHTML = `
    <div class="date-bank-menu-head">
      <span>${formatCellDate(dateISO)}</span>
      <button type="button" class="icon-btn" data-close aria-label="${t("common.close")}" style="width:22px;height:22px;">${icon("x", { size: 12 })}</button>
    </div>
    <div class="date-bank-menu-list">
      ${
        unscheduled.length
          ? unscheduled
              .map(
                (c) => `
          <button data-assign="${c.id}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>
            <span class="date-bank-menu-title">${escapeText(c.title || t("common.untitled"))}</span>
          </button>`
              )
              .join("")
          : `<div class="text-faint" style="font-size:12px;padding:8px 10px;">${t("calendar.dateBankEmpty")}</div>`
      }
    </div>
    <div class="menu-divider"></div>
    <button data-create>${icon("plus", { size: 15 })}${t("calendar.createNewContent")}</button>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-close]")) {
      menu.remove();
      return;
    }
    const assignId = e.target.closest("[data-assign]")?.dataset.assign;
    if (assignId) {
      menu.remove();
      assignToDate(brandId, assignId, dateISO);
      refresh();
      return;
    }
    if (e.target.closest("[data-create]")) {
      menu.remove();
      openContentEditor({ brandId, defaults: { scheduleDate: dateISO, status: "scheduled" }, onSaved: refresh });
    }
  });
}

function formatCellDate(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  return `${dow()[d.getDay()]}, ${months()[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function escapeText(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
function escapeAttr(s) { return (s || "").replace(/"/g, "&quot;"); }
