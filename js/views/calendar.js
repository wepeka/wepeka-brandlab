import { getBrand, listContent, getContent, listCampaigns, updateContent, getSettings, onChange, STATUS_LABELS, listRoutineTemplate, ROUTINE_DAY_LABELS, ROUTINE_ACTIVITY_LABELS, localISODate, phaseNameLabel, eventPhaseDateLabel } from "../store.js";
import { icon, platformIcon } from "../icons.js";
import { qs, qsa, toast, escapeHtml, openMenu, closeMenu } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { suggestSchedule, hasAiKey } from "../ai.js";
import { t, getLang } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { openContentCadenceSetup } from "../cadence-setup.js";
import { consumeNavContext } from "../nav-context.js";
import { isTourDemo, demoSuggestSchedule, DEMO_TOAST } from "../tour-demo.js";
import { setPageGuide } from "../section-guide.js";
import { startCalendarGuide, startCalendarGuideOnMount } from "../guides/calendar-guide.js";

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dow = () => DOW_KEYS.map((k) => t(`calendar.dow.${k}`));
const months = () => Array.from({ length: 12 }, (_, i) => t(`calendar.month.${i}`));

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sameDay(a, b) { return iso(a) === iso(b); }
function startOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }

const FUNNEL_COLOR = { TOFU: "var(--tofu)", MOFU: "var(--mofu)", BOFU: "var(--bofu)" };

// Confirmed against the official SKB 3 Menteri 2026 announcement
// (setneg.go.id) — exact for 2026 only, since Islamic/lunar/Balinese
// holidays shift every year and aren't computed here. Other years fall
// back to just the fixed-date national holidays below.
// Values are i18n key suffixes (cal.holiday.* / cal.cuti.*), resolved when shown.
const HOLIDAYS_ID_2026 = {
  "2026-01-01": "newYear",
  "2026-01-16": "israMiraj",
  "2026-02-17": "chineseNewYear",
  "2026-03-19": "nyepi",
  "2026-03-21": "eidFitr",
  "2026-03-22": "eidFitr",
  "2026-04-03": "goodFriday",
  "2026-04-05": "easter",
  "2026-05-01": "labor",
  "2026-05-14": "ascension",
  "2026-05-27": "eidAdha",
  "2026-05-31": "vesak",
  "2026-06-01": "pancasila",
  "2026-06-16": "islamicNewYear",
  "2026-08-17": "independence",
  "2026-08-25": "mawlid",
  "2026-12-25": "christmas",
};
const CUTI_BERSAMA_ID_2026 = {
  "2026-02-16": "chineseNewYear",
  "2026-03-18": "nyepi",
  "2026-03-20": "eidFitr",
  "2026-03-23": "eidFitr",
  "2026-03-24": "eidFitr",
  "2026-05-15": "ascension",
  "2026-05-28": "eidAdha",
  "2026-12-24": "christmas",
};
function fixedHolidaysForYear(year) {
  return {
    [`${year}-01-01`]: "newYear",
    [`${year}-05-01`]: "labor",
    [`${year}-06-01`]: "pancasila",
    [`${year}-08-17`]: "independence",
    [`${year}-12-25`]: "christmas",
  };
}
// { label, cuti: boolean } or null — cuti (joint leave) gets a lighter
// treatment than an actual libur nasional.
function holidayForDate(dateISO) {
  const year = dateISO.slice(0, 4);
  if (year === "2026") {
    if (HOLIDAYS_ID_2026[dateISO]) return { label: t(`cal.holiday.${HOLIDAYS_ID_2026[dateISO]}`), cuti: false };
    if (CUTI_BERSAMA_ID_2026[dateISO]) return { label: t(`cal.cuti.${CUTI_BERSAMA_ID_2026[dateISO]}`), cuti: true };
    return null;
  }
  const fixed = fixedHolidaysForYear(year)[dateISO];
  return fixed ? { label: t(`cal.holiday.${fixed}`), cuti: false } : null;
}

export function render(root, { brandId }) {
  const state = { view: "month", cursor: new Date(), highlightId: null };
  // Arriving from a campaign ("Jadwalkan …"): jump to that piece's month,
  // or — when it has no date yet — open its editor so the date can be set.
  const navCtx = consumeNavContext();
  const refresh = () => paint(root, brandId, state, refresh);
  if (navCtx) {
    const c = navCtx.contentId ? getContent(navCtx.contentId) : null;
    state.highlightId = navCtx.contentId || null;
    if (c?.scheduleDate || c?.publishedDate) state.cursor = new Date((c.scheduleDate || c.publishedDate) + "T00:00:00");
    else if (c) setTimeout(() => openContentEditor({ brandId, contentId: c.id, onSaved: refresh }), 0);
  }
  refresh();
  // Once per mount — paint() runs again on every db:change.
  startCalendarGuideOnMount(brandId);
  return onChange(refresh);
}

// Overdue-and-still-unpublished content drops off the calendar entirely
// instead of sitting stale on a day that's already passed — it moves to
// the "Overdue" reminder on the home page instead, which is a clearer
// place to actually deal with it than a grid cell in the past.
function itemsForBrand(brandId) {
  const todayISO = localISODate();
  return listContent(brandId).filter((c) => {
    if (c.publishedDate) return true;
    if (!c.scheduleDate) return false;
    return c.scheduleDate >= todayISO;
  });
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
  // During a tour this runs on sample data (js/tour-demo.js) — no key
  // needed, no tokens spent.
  const demo = isTourDemo();
  if (!hasKey && !demo) {
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
  toast(demo ? DEMO_TOAST : t("calendar.autoschedule.asking", { count: unscheduled.length }));
  try {
    const startDate = localISODate();
    const brand = getBrand(brandId);
    const campaigns = listCampaigns(brandId);
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    const schedule = demo
      ? await demoSuggestSchedule({ items: unscheduled.map((c) => ({ id: c.id, funnel: c.funnel, status: c.status })), startDate, daysAhead: 21, cadence: brand?.contentCadence })
      : await suggestSchedule(ai, {
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

function visibleRangeISO(state) {
  const d = state.cursor;
  if (state.view === "month") {
    const gridStart = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 41);
    return { start: iso(gridStart), end: iso(gridEnd) };
  }
  if (state.view === "week") {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return { start: iso(s), end: iso(e) };
  }
  return { start: iso(d), end: iso(d) };
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
        <div class="page-eyebrow flex items-center gap-6">${t("calendar.eyebrow")}${helpButtonHTML("calendar")}</div>
        <h1>${brand.name}</h1>
      </div>
      <div class="flex gap-8">
        <button class="icon-btn" id="cal-more" aria-label="${t("common.more")}" title="${t("common.more")}">${icon("dots", { size: 16 })}</button>
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
      <div class="segmented" style="width:150px;">
        ${["month", "week"].map((v) => `<button data-view="${v}" class="${state.view === v ? "active" : ""}">${t(`calendar.view.${v}`)}</button>`).join("")}
      </div>
    </div>
    <div id="cal-body"></div>
  `;

  qs("#new-content").addEventListener("click", () => openContentEditor({ brandId, onSaved: refresh }));
  // The ⋯ menu: the two setup-ish jobs (AI auto-schedule, the weekly work
  // rhythm) — used once in a while, not every visit.
  qs("#cal-more").addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 240) });
    if (!menu) return;
    menu.innerHTML = `
      <button data-act="autoschedule" id="ai-autoschedule">${icon("bot", { size: 15 })}${t("calendar.autoscheduleBtn")}</button>
      <button data-act="cadence" id="edit-cadence">${icon("gear", { size: 15 })}${t("calendar.editCadenceBtn")}</button>
    `;
    menu.addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "autoschedule") runAutoSchedule(brandId, refresh);
      else if (act === "cadence") openContentCadenceSetup(brand);
    });
  });
  wireHelpButtons(root);
  setPageGuide(() => startCalendarGuide(brandId));
  qs("#cal-prev").addEventListener("click", () => { step(state, -1); paint(root, brandId, state, refresh); });
  qs("#cal-next").addEventListener("click", () => { step(state, 1); paint(root, brandId, state, refresh); });
  qs("#cal-today").addEventListener("click", () => { state.cursor = new Date(); paint(root, brandId, state, refresh); });
  qsa("[data-view]").forEach((btn) => btn.addEventListener("click", () => { state.view = btn.dataset.view; paint(root, brandId, state, refresh); }));

  const body = qs("#cal-body");
  if (state.view === "month") renderMonth(body, brandId, state, items, campaigns, campaignById, refresh);
  else renderAgenda(body, brandId, state, items, campaignById, refresh);

}

function periodLabel(state) {
  const d = state.cursor;
  const dayFirst = getLang() === "id";
  const md = (x, full) => {
    const m = full ? months()[x.getMonth()] : months()[x.getMonth()].slice(0, 3);
    return dayFirst ? `${x.getDate()} ${m}` : `${m} ${x.getDate()}`;
  };
  if (state.view === "month") return `${months()[d.getMonth()]} ${d.getFullYear()}`;
  if (state.view === "week") {
    const s = startOfWeek(d); const e = new Date(s); e.setDate(e.getDate() + 6);
    return `${md(s)} – ${md(e)}`;
  }
  return dayFirst ? `${md(d, true)} ${d.getFullYear()}` : `${md(d, true)}, ${d.getFullYear()}`;
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
  const todayISO = localISODate();
  const eventDays = eventDayMarkers(campaigns);

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    const outside = day.getMonth() !== d.getMonth();
    const dayItems = items.filter((c) => sameDay(new Date(c.scheduleDate || c.publishedDate), day));
    const shown = dayItems.slice(0, 3);
    const extra = dayItems.length - shown.length;
    const holiday = holidayForDate(iso(day));
    const eventNames = eventDays.get(iso(day));

    cells += `
      <div class="cal-cell ${outside ? "outside" : ""} ${sameDay(day, today) ? "today" : ""} ${iso(day) < todayISO ? "is-past" : ""} ${holiday ? (holiday.cuti ? "cuti" : "holiday") : ""} ${eventNames ? "event-day" : ""}" data-date="${iso(day)}" ${holiday ? `title="${escapeHtml(holiday.label)}"` : eventNames ? `title="${t("cal.eventDayTitle", { names: escapeHtml(eventNames.join(", ")) })}"` : ""}>
        <div class="cal-date">${day.getDate()}${eventNames ? `<span class="cal-event-star" aria-label="${t("cal.eventDay")}">★</span>` : ""}</div>
        ${holiday ? `<div class="cal-holiday-label">${escapeHtml(holiday.label)}</div>` : ""}
        ${shown.map((c) => {
          const campaign = c.campaignId ? campaignById.get(c.campaignId) : null;
          const itemTitle = campaign ? `${c.title} · ${campaign.name}` : c.title;
          return `
          <div class="cal-item ${state.highlightId === c.id ? "is-highlight" : ""}" draggable="true" data-id="${c.id}" title="${escapeHtml(itemTitle)}">
            <span class="swatch" style="background:${FUNNEL_COLOR[c.funnel]}"></span>
            ${campaign ? `<span class="cal-item-campaign-dot" title="${escapeHtml(campaign.name)}"></span>` : ""}
            ${escapeHtml(c.title || t("common.untitled"))}
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
  // Percent position of a day-of-month range inside this month's track.
  const span = (fromISO, toISO) => {
    const startDay = fromISO > monthStartISO ? Number(fromISO.slice(8, 10)) : 1;
    const endDay = toISO < monthEndISO ? Number(toISO.slice(8, 10)) : daysInMonth;
    return { left: ((startDay - 1) / daysInMonth) * 100, width: ((endDay - startDay + 1) / daysInMonth) * 100 };
  };
  const rows = active
    .map((c) => {
      // Event campaigns show their phases as segments (each with a name)
      // and a marker on event day, instead of one flat bar.
      const phases = (c.eventPlan?.phases || []).filter((p) => p.dateFrom && p.dateTo && p.dateFrom <= monthEndISO && p.dateTo >= monthStartISO);
      let bar;
      if (phases.length) {
        bar = phases
          .map((p, i) => {
            const { left, width } = span(p.dateFrom, p.dateTo);
            return `<div class="cal-timeline-seg seg-${i % 4}" style="left:${left}%;width:${width}%;" title="${escapeHtml(phaseNameLabel(p.name))} · ${escapeHtml(eventPhaseDateLabel(p, c.eventPlan.eventDate))}"><span>${escapeHtml(phaseNameLabel(p.name))}</span></div>`;
          })
          .join("");
        const ev = c.eventPlan.eventDate;
        if (ev && ev >= monthStartISO && ev <= monthEndISO) {
          const { left } = span(ev, ev);
          bar += `<div class="cal-timeline-event" style="left:${left}%;" title="${t("cal.eventDay")} · ${escapeHtml(ev)}">★</div>`;
        }
      } else {
        const { left, width } = span(c.startDate, c.endDate);
        bar = `<div class="cal-timeline-bar" style="left:${left}%;width:${width}%;"></div>`;
      }
      return `
        <div class="cal-timeline-row ${phases.length ? "has-phases" : ""}">
          <a class="cal-timeline-label" href="#/brand/${c.brandId}/campaigns/${c.id}" title="${escapeHtml(c.name || "")}">${escapeHtml(c.name || t("calendar.untitledCampaign"))}</a>
          <div class="cal-timeline-track">${bar}</div>
        </div>
      `;
    })
    .join("");
  return `<div class="cal-timeline">${rows}</div>`;
}

// Event-day cells get a marker so the day itself stands out on the grid.
function eventDayMarkers(campaigns) {
  const map = new Map();
  campaigns.forEach((c) => {
    const d = c.eventPlan?.eventDate;
    if (d && c.status !== "archived") map.set(d, [...(map.get(d) || []), c.name || t("cal.eventFallback")]);
  });
  return map;
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
    : `<div class="card glass-card"><div class="table-empty">${t("calendar.agendaEmpty", { view: t(`calendar.view.${state.view}`).toLowerCase() })}</div></div>`;

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
        <div class="t" style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.title || t("common.untitled"))}</div>
        <div class="text-muted" style="font-size:12.5px;margin-top:2px;">${c.platform || "—"} · ${c.format || "—"}</div>
      </div>
      ${campaign ? `<span class="tag" style="background:color-mix(in srgb, var(--brand-tint) 14%, transparent);color:var(--brand-tint);">${escapeHtml(campaign.name)}</span>` : ""}
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
    // Past days never accept a drop: skipping preventDefault on dragover is
    // what makes the browser show "not allowed" and refuse the drop.
    const isPast = () => cell.dataset.date < localISODate();
    cell.addEventListener("dragover", (e) => {
      if (isPast()) return;
      e.preventDefault();
      cell.classList.add("drag-over");
    });
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
      if (isPast()) {
        toast(t("calendar.pastDate"), "error");
        return;
      }
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
  if (clash) toast(t("calendar.funnelClash", { date: formatCellDate(dateISO), funnel: moving.funnel }), "error");
}

function assignToDate(brandId, contentId, dateISO) {
  // A scheduled date in the past used to be accepted, then the item was
  // hidden from both the grid and the Bank — looked like it was deleted.
  if (!dateISO || dateISO < localISODate()) {
    toast(t("calendar.pastDate"), "error");
    return;
  }
  updateContent(contentId, { scheduleDate: dateISO, status: "scheduled" });
  warnIfFunnelClash(brandId, contentId, dateISO);
  toast(t("common.scheduled"));
}

// Click on a placed item → a small Edit / Remove-from-calendar choice,
// instead of jumping straight into the editor — mirrors the row-menu
// pattern used in Content OS's table (content-list.js).
function openCalItemMenu(anchorEl, { brandId, contentId, refresh }) {
  const rect = anchorEl.getBoundingClientRect();
  const menu = openMenu(anchorEl, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 190) });
  if (!menu) return;
  menu.innerHTML = `
    <button data-act="edit">${icon("edit", { size: 15 })}${t("common.edit")}</button>
    <button data-act="remove" class="danger">${icon("x", { size: 15 })}${t("calendar.removeFromCalendar")}</button>
  `;
  menu.addEventListener("click", async (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-act]")?.dataset.act;
    closeMenu();
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
  const unscheduled = listContent(brandId).filter((c) => !c.scheduleDate);
  const rect = cell.getBoundingClientRect();
  const menu = openMenu(cell, { className: "date-bank-menu", top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 260) });
  if (!menu) return;
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
            <span class="date-bank-menu-title">${escapeHtml(c.title || t("common.untitled"))}</span>
          </button>`
              )
              .join("")
          : `<div class="text-faint" style="font-size:12px;padding:8px 10px;">${t("calendar.dateBankEmpty")}</div>`
      }
    </div>
    <div class="menu-divider"></div>
    <button data-create>${icon("plus", { size: 15 })}${t("calendar.createNewContent")}</button>
  `;
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest("[data-close]")) {
      closeMenu();
      return;
    }
    const assignId = e.target.closest("[data-assign]")?.dataset.assign;
    if (assignId) {
      closeMenu();
      assignToDate(brandId, assignId, dateISO);
      refresh();
      return;
    }
    if (e.target.closest("[data-create]")) {
      closeMenu();
      openContentEditor({ brandId, defaults: { scheduleDate: dateISO, status: "scheduled" }, onSaved: refresh });
    }
  });
}

function formatCellDate(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const mon = months()[d.getMonth()].slice(0, 3);
  return getLang() === "id" ? `${dow()[d.getDay()]}, ${d.getDate()} ${mon}` : `${dow()[d.getDay()]}, ${mon} ${d.getDate()}`;
}
