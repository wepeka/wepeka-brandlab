import { getBrand, listContent, updateContent, getSettings, onChange, STATUS_LABELS, listRoutineTemplate, ROUTINE_DAY_LABELS, ROUTINE_ACTIVITY_LABELS } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { suggestSchedule } from "../ai.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

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
  { label: "Drafting", statuses: ["idea", "draft"] },
  { label: "Execution", statuses: ["production"] },
  { label: "Editing", statuses: ["editing"] },
  { label: "Ready to Upload", statuses: ["scheduled"] },
];

function contentBankHTML(brandId) {
  const unscheduled = listContent(brandId).filter((c) => !c.scheduleDate);
  const groups = BANK_GROUPS.map((g) => ({ ...g, items: unscheduled.filter((c) => g.statuses.includes(c.status)) })).filter((g) => g.items.length);
  return `
    <div class="content-bank" id="content-bank">
      <div class="content-bank-head">
        <span>Content Bank</span>
        <button class="icon-btn" id="close-bank" aria-label="Close" style="width:26px;height:26px;">${icon("x", { size: 13 })}</button>
      </div>
      <p class="text-faint" style="font-size:11.5px;padding:0 14px;margin:8px 0 12px;">Drag any of these onto a day to schedule it.</p>
      <div class="content-bank-list">
        ${
          groups.length
            ? groups
                .map(
                  (g) => `
          <div class="content-bank-group">
            <div class="content-bank-group-head">${g.label} <span class="text-faint">${g.items.length}</span></div>
            ${g.items
              .map(
                (c) => `
              <div class="cal-item bank-item" draggable="true" data-id="${c.id}" title="${escapeAttr(c.title)}">
                <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>${escapeText(c.title || "Untitled")}
              </div>`
              )
              .join("")}
          </div>`
                )
                .join("")
            : `<div class="table-empty" style="padding:24px 16px;">Nothing unscheduled — everything's on the calendar already.</div>`
        }
      </div>
    </div>
  `;
}

// Turns this brand's standing weekly routine into plain-language rules the
// scheduler prompt can follow — "Editing every Tuesday", "Upload every day".
function routineNotesForBrand(brandId) {
  return listRoutineTemplate()
    .filter((t) => t.brandId === brandId)
    .map((t) => {
      const activity = t.activity === "custom" ? t.customLabel || "Custom task" : ROUTINE_ACTIVITY_LABELS[t.activity];
      const time = t.time ? ` at ${t.time}` : "";
      return `${activity} every ${ROUTINE_DAY_LABELS[t.day]}${time}`;
    });
}

// Picks up everything still in progress with no date on it yet and lets
// the AI spread them across the next 3 weeks — a starting point to drag
// around afterward, not a final answer.
async function runAutoSchedule(brandId, refresh) {
  const ai = getSettings().ai || {};
  const hasKey = ai.provider === "gemini" ? !!ai.geminiApiKey : !!ai.anthropicApiKey;
  if (!hasKey) {
    toast("Add your AI API key in Settings → AI first.", "error");
    return;
  }
  const unscheduled = listContent(brandId).filter(
    (c) => !c.scheduleDate && ["idea", "draft", "production", "editing", "scheduled"].includes(c.status)
  );
  if (!unscheduled.length) {
    toast("Nothing unscheduled to auto-schedule right now.");
    return;
  }
  toast(`Asking AI for a schedule for ${unscheduled.length} item(s)…`);
  try {
    const startDate = new Date().toISOString().slice(0, 10);
    const schedule = await suggestSchedule(ai, {
      items: unscheduled.map((c) => ({ id: c.id, title: c.title, funnel: c.funnel, status: c.status })),
      startDate,
      daysAhead: 21,
      routineNotes: routineNotesForBrand(brandId),
    });
    const proposed = unscheduled
      .filter((c) => schedule.has(c.id))
      .map((c) => ({ content: c, date: schedule.get(c.id) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!proposed.length) {
      toast("AI didn't return a usable schedule — try again.", "error");
      return;
    }
    openAutoScheduleConfirm(proposed, refresh);
  } catch (e) {
    toast(e.message || "Couldn't auto-schedule.", "error");
  }
}

// Nothing gets written to the calendar until this is explicitly confirmed —
// the AI's dates are a proposal to review (and adjust per-row) first, not
// an instant write.
function openAutoScheduleConfirm(proposed, refresh) {
  const overlay = openModal({
    title: "Review AI Schedule",
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:12.5px;margin:0 0 14px;">Nothing is scheduled yet — review the dates below (or adjust any of them), then confirm.</p>
      <div class="auto-schedule-list">
        ${proposed
          .map(
            (p, i) => `
          <div class="auto-schedule-row">
            <span class="tag tag-${p.content.funnel.toLowerCase()}">${p.content.funnel}</span>
            <span class="auto-schedule-title">${escapeHtml(p.content.title || "Untitled")}</span>
            <input class="input" type="date" data-schedule-index="${i}" value="${p.date}" style="width:auto;" />
          </div>`
          )
          .join("")}
      </div>
    `,
    footHTML: `
      <button class="btn btn-secondary" id="auto-schedule-cancel">Cancel</button>
      <button class="btn btn-primary" id="auto-schedule-confirm">${icon("check", { size: 15 })}Confirm & Add to Calendar</button>
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
    toast(`Scheduled ${proposed.length} item(s) — drag any of them to adjust further.`);
    closeOverlay(overlay);
    refresh();
  });
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) { location.hash = "#/"; return; }
  const items = itemsForBrand(brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Content Calendar</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="toggle-bank">${icon("layers", { size: 15 })}Content Bank</button>
        <button class="btn btn-secondary" id="ai-autoschedule">${icon("bot", { size: 15 })}AI Auto-Schedule</button>
        <button class="btn btn-primary" id="new-content">${icon("plus", { size: 16 })}New Content</button>
      </div>
    </div>
    <div class="cal-head">
      <div class="cal-nav">
        <button class="icon-btn" id="cal-prev" aria-label="Previous period">${icon("chevronLeft", { size: 16 })}</button>
        <div class="cal-month-label">${periodLabel(state)}</div>
        <button class="icon-btn" id="cal-next" aria-label="Next period">${icon("chevronRight", { size: 16 })}</button>
        <button class="btn btn-secondary btn-sm" id="cal-today">Today</button>
      </div>
      <div class="segmented" style="width:220px;">
        ${["month", "week", "day"].map((v) => `<button data-view="${v}" class="${state.view === v ? "active" : ""}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}
      </div>
    </div>
    <div id="cal-body"></div>
    ${state.bankOpen ? contentBankHTML(brandId) : ""}
  `;

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  qs("#ai-autoschedule").addEventListener("click", () => runAutoSchedule(brandId, refresh));
  qs("#toggle-bank").addEventListener("click", () => { state.bankOpen = !state.bankOpen; paint(root, brandId, state, refresh); });
  const closeBankBtn = qs("#close-bank");
  if (closeBankBtn) closeBankBtn.addEventListener("click", () => { state.bankOpen = false; paint(root, brandId, state, refresh); });
  qs("#cal-prev").addEventListener("click", () => { step(state, -1); paint(root, brandId, state, refresh); });
  qs("#cal-next").addEventListener("click", () => { step(state, 1); paint(root, brandId, state, refresh); });
  qs("#cal-today").addEventListener("click", () => { state.cursor = new Date(); paint(root, brandId, state, refresh); });
  qsa("[data-view]").forEach((btn) => btn.addEventListener("click", () => { state.view = btn.dataset.view; paint(root, brandId, state, refresh); }));

  const body = qs("#cal-body");
  if (state.view === "month") renderMonth(body, brandId, state, items, refresh);
  else renderAgenda(body, brandId, state, items, refresh);

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
  if (state.view === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  if (state.view === "week") {
    const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${MONTHS[s.getMonth()].slice(0,3)} ${s.getDate()} – ${MONTHS[e.getMonth()].slice(0,3)} ${e.getDate()}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function step(state, dir) {
  const d = new Date(state.cursor);
  if (state.view === "month") d.setMonth(d.getMonth() + dir);
  else if (state.view === "week") d.setDate(d.getDate() + dir * 7);
  else d.setDate(d.getDate() + dir);
  state.cursor = d;
}

function renderMonth(body, brandId, state, items, refresh) {
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
        ${shown.map((c) => `
          <div class="cal-item" draggable="true" data-id="${c.id}" title="${escapeAttr(c.title)}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>${escapeText(c.title || "Untitled")}
            ${c.scheduleDate ? `<button type="button" class="cal-item-remove" data-unschedule="${c.id}" aria-label="Remove from calendar" title="Remove from calendar">${icon("x", { size: 9 })}</button>` : ""}
          </div>`).join("")}
        ${extra > 0 ? `<div class="cal-more">+${extra} more</div>` : ""}
      </div>
    `;
  }

  body.innerHTML = `
    <div class="cal-grid">
      ${DOW.map((dw) => `<div class="cal-dow">${dw}</div>`).join("")}
      ${cells}
    </div>
  `;

  wireDragAndOpen(body, brandId, refresh);
}

function renderAgenda(body, brandId, state, items, refresh) {
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
    ? `<div class="agenda-list">${filtered.map(agendaRow).join("")}</div>`
    : `<div class="card"><div class="table-empty">Nothing on the calendar for this ${state.view}.</div></div>`;

  qsa("[data-id]", body).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.id, onSaved: refresh }));
  });

  qsa("[data-unschedule]", body).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: "Remove from calendar?",
        message: "This just clears its scheduled date — the content itself stays, and it'll show back up in the Content Bank.",
        confirmLabel: "Remove",
      });
      if (!ok) return;
      updateContent(btn.dataset.unschedule, { scheduleDate: "" });
      toast("Removed from calendar");
      refresh();
    });
  });
}

function agendaRow(c) {
  const dt = new Date(c.scheduleDate || c.publishedDate);
  return `
    <div class="agenda-row" data-id="${c.id}">
      <div class="agenda-date"><div class="d">${dt.getDate()}</div><div class="m">${MONTHS[dt.getMonth()].slice(0,3)}</div></div>
      <div class="ti" style="flex:1;min-width:0;">
        <div class="t" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeText(c.title || "Untitled")}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${c.platform || "—"} · ${c.format || "—"}</div>
      </div>
      <span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span>
      <span class="status-pill status-${c.status}"><span class="status-dot"></span>${STATUS_LABELS[c.status]}</span>
      ${c.scheduleDate ? `<button type="button" class="icon-btn" data-unschedule="${c.id}" aria-label="Remove from calendar" title="Remove from calendar" style="width:28px;height:28px;">${icon("x", { size: 13 })}</button>` : ""}
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
      openContentEditor({ brandId, contentId: el.dataset.id, onSaved: refresh });
    });
  });

  qsa("[data-unschedule]", body).forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: "Remove from calendar?",
        message: "This just clears its scheduled date — the content itself stays, and it'll show back up in the Content Bank.",
        confirmLabel: "Remove",
      });
      if (!ok) return;
      updateContent(btn.dataset.unschedule, { scheduleDate: "" });
      toast("Removed from calendar");
      refresh();
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
      updateContent(id, { scheduleDate: cell.dataset.date });
      toast("Rescheduled");
    });
    cell.addEventListener("click", (e) => {
      if (e.target.closest(".cal-item")) return;
      openContentEditor({ brandId, defaults: { scheduleDate: cell.dataset.date, status: "scheduled" }, onSaved: refresh });
    });
  });
}

function escapeText(s) { const d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
function escapeAttr(s) { return (s || "").replace(/"/g, "&quot;"); }
