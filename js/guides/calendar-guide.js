// Tur B — Kalender (plan-guided-tour-content-os.md §4). Page-scoped guide
// for #/brand/:id/content-os/calendar, gated on the real actions: open the
// Content Bank, drag (or tap a date) to schedule, open/save Jadwal Kerja,
// run AI Auto-Schedule, switch Bulan/Minggu/Hari.
import { runSpotlightTour } from "../tour.js";
import { listContent, getContent, getBrand } from "../store.js";
import { qs } from "../dom.js";
import { t } from "../i18n.js";
import { adaptForAccount, markTourSeen, showTourRecap, startGuideOnMount } from "./common.js";

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// Same set the Content Bank lists (no date yet), minus published pieces,
// which the bank's stage groups never show.
function unscheduledOpen(brandId) {
  return listContent(brandId).filter((c) => !c.scheduleDate && c.status !== "published");
}

async function ensureMonthView() {
  const monthBtn = qs('[data-view="month"]');
  if (monthBtn && !monthBtn.classList.contains("active")) {
    monthBtn.click();
    await tick();
  }
}


export function buildCalendarSteps({ brandId }) {
  const drawerOpen = () => !!qs(".overlay .drawer");

  const steps = [
    // Prasyarat: Bank Konten kosong → bikin satu konten dulu (sama seperti
    // Bab 1 Tur Creator, tapi lewat tombol Konten Baru di kalender).
    {
      selector: "#new-content",
      showIf: () => unscheduledOpen(brandId).length === 0,
      title: t("guide.cal.bankEmpty.title"),
      body: t("guide.cal.bankEmpty.body"),
      interactive: { type: "click" },
      write: true,
    },
    {
      selector: ".overlay .drawer #f-title",
      showIf: drawerOpen,
      title: t("guide.cal.title.title"),
      body: t("guide.cal.title.body"),
      interactive: { type: "input", minLength: 3 },
    },
    {
      selector: ".overlay .drawer [data-save]",
      showIf: drawerOpen,
      title: t("common.save"),
      body: t("guide.cal.save.body"),
      interactive: { type: "until", predicate: () => !drawerOpen() },
      hint: t("guide.cal.save.hint"),
      write: true,
    },

    // 1
    {
      selector: ".cal-grid",
      beforeStep: async () => {
        await ensureMonthView();
      },
      title: t("guide.cal.grid.title"),
      body: t("guide.cal.grid.body"),
      placement: "top",
    },
    // 4 — click a date → the Bank menu for that day
    {
      selector: [".cal-cell.today", ".cal-cell:not(.outside)"],
      beforeStep: async () => {
        await ensureMonthView();
        if (!qs(".cal-cell.today")) {
          qs("#cal-today")?.click();
          await tick();
        }
      },
      title: t("guide.cal.clickDate.title"),
      body: t("guide.cal.clickDate.body"),
      interactive: { type: "until", predicate: () => !!qs(".date-bank-menu") },
      hint: t("guide.cal.clickDate.hint"),
      skippable: true,
    },
    // 5
    {
      selector: ".date-bank-menu",
      title: t("guide.cal.menu.title"),
      body: t("guide.cal.menu.body"),
      skippable: true,
      waitTimeout: 1500,
    },
    // 6
    {
      selector: ".cal-grid .cal-item",
      showIf: () => !!qs(".cal-grid .cal-item"),
      title: t("guide.cal.move.title"),
      body: t("guide.cal.move.body"),
      waitTimeout: 1500,
    },
    // 7 — already configured: just point at it, don't make them redo it
    {
      selector: "#edit-cadence",
      showIf: () => !!getBrand(brandId)?.contentCadence?.configured,
      title: t("guide.cal.cadenceSet.title"),
      body: t("guide.cal.cadenceSet.body"),
    },
    {
      selector: "#edit-cadence",
      showIf: () => !getBrand(brandId)?.contentCadence?.configured,
      title: t("guide.cal.cadence.title"),
      body: t("guide.cal.cadence.body"),
      interactive: { type: "click" },
    },
    // 8
    {
      selector: "#cadence-upload-chips",
      showIf: () => !!qs("#cadence-upload-chips"),
      title: t("guide.cal.chips.title"),
      body: t("guide.cal.chips.body"),
    },
    // 9
    {
      selector: "#cadence-save",
      showIf: () => !!qs("#cadence-save"),
      title: t("common.save"),
      body: t("guide.cal.cadenceSave.body"),
      interactive: { type: "click", extraSelectors: ["#cadence-skip", ".overlay.center [data-close]"] },
      write: true,
    },
    // 10 — gate waits for the review modal. While a tour runs, Auto-Schedule
    // uses sample output (js/tour-demo.js), so no API key or tokens needed.
    {
      selector: "#ai-autoschedule",
      showIf: () => unscheduledOpen(brandId).length > 0,
      title: t("guide.cal.auto.title"),
      body: t("guide.cal.auto.body"),
      interactive: { type: "until", predicate: () => !!qs(".auto-schedule-list") },
      hint: t("guide.cal.auto.hint"),
      skippable: true,
    },
    // 11
    {
      selector: ".auto-schedule-list",
      showIf: () => !!qs(".auto-schedule-list"),
      title: t("guide.cal.review.title"),
      body: t("guide.cal.review.body"),
      skippable: true,
    },
    // 12
    {
      selector: "#auto-schedule-confirm",
      showIf: () => !!qs("#auto-schedule-confirm"),
      title: t("guide.cal.confirm.title"),
      body: t("guide.cal.confirm.body"),
      interactive: { type: "click", extraSelectors: ["#auto-schedule-cancel"] },
      skippable: true,
      write: true,
    },
    // 14
    {
      selector: '[data-view="week"]',
      title: t("guide.cal.week.title"),
      body: t("guide.cal.week.body"),
      interactive: { type: "click" },
    },
    // 16
    {
      selector: ".cal-nav",
      title: t("guide.cal.nav.title"),
      body: t("guide.cal.nav.body"),
    },
    // 17
    {
      selector: '[data-view="month"]',
      title: t("guide.cal.month.title"),
      body: t("guide.cal.month.body"),
      interactive: { type: "click" },
    },
    // 18
    {
      selector: ".cal-timeline",
      showIf: () => !!qs(".cal-timeline"),
      title: t("guide.cal.timeline.title"),
      body: t("guide.cal.timeline.body"),
      waitTimeout: 1500,
    },
    // 19
    {
      selector: "#new-content",
      title: t("guide.cal.newHere.title"),
      body: t("guide.cal.newHere.body"),
    },
  ];
  return adaptForAccount(steps);
}

function calendarTourOptions(brandId) {
  return {
    onFinish: (reason) => {
      markTourSeen("calendar");
      if (reason !== "done") return;
      // Stays inside Content OS — no "lanjut ke Campaign?" hand-off. Campaign
      // has its own Panduan for when someone actually opens it.
      const recap = t("guide.cal.recap");
      showTourRecap({ title: t("guide.cal.recapTitle"), body: recap });
    },
  };
}

export function startCalendarGuide(brandId) {
  return runSpotlightTour(buildCalendarSteps({ brandId }), calendarTourOptions(brandId));
}

// Once per mount of the Calendar page (not per repaint).
export function startCalendarGuideOnMount(brandId) {
  startGuideOnMount({
    pendingKey: "calendar",
    build: () => buildCalendarSteps({ brandId }),
    options: calendarTourOptions(brandId),
  });
}
