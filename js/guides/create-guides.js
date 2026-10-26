// Page tours for two parts of Create that had none (2026-10-27, owner: "guide
// nya juga rusak gabisa dipake ya?"): the Create landing's colour cards
// (js/views/content-os.js) and Daftar Konten (js/views/content-list.js).
// Short, look-only tours; the "Panduan" button on each page starts them.
import { runSpotlightTour } from "../tour.js";
import { qs } from "../dom.js";
import { t } from "../i18n.js";
import { getMode } from "../mode.js";
import { markTourSeen } from "./common.js";

const CATS = ["creator", "calendar", "list", "copy", "series"];

export function buildCreateLandingSteps() {
  return [
    ...CATS.map((key, i) => ({
      selector: `.cl-card[data-cat="${key}"]`,
      title: t(`contentOs.tab.${key}`),
      body: i === 0 ? `${t(`cg.land.${key}`)} ${t("cg.land.hover")}` : t(`cg.land.${key}`),
    })),
    { selector: "#cl-new", title: t("cl.new"), body: t("cg.land.new") },
  ];
}

export function startCreateLandingGuide() {
  return runSpotlightTour(buildCreateLandingSteps(), { onFinish: () => markTourSeen("create-landing") });
}

export function buildContentListSteps() {
  return [
    // Pro still has the tab row above the list.
    { selector: ".cos-tabs", showIf: () => getMode() !== "guided" && !!qs(".cos-tabs"), title: t("cnt.os.tour.title"), body: t("cnt.os.tour.body") },
    { selector: ".toolbar .segmented", title: t("cg.list.views.title"), body: t("cg.list.views.body") },
    { selector: ".toolbar .search-box", title: t("cg.list.search.title"), body: t("cg.list.search.body") },
    { selector: "#filter-toggle", title: t("cg.list.filter.title"), body: t("cg.list.filter.body") },
    { selector: ".data-table tbody tr[data-id]", showIf: () => !!qs(".data-table tbody tr[data-id]"), title: t("cg.list.row.title"), body: t("cg.list.row.body") },
    { selector: "[data-quick-fill]", showIf: () => !!qs("[data-quick-fill]"), title: t("cg.list.stats.title"), body: t("cg.list.stats.body") },
    { selector: "#more-actions", title: t("cg.list.more.title"), body: t("cg.list.more.body") },
    { selector: "#new-content", title: t("cl.new"), body: t("cg.list.new.body") },
  ];
}

export function startContentListGuide() {
  return runSpotlightTour(buildContentListSteps(), { onFinish: () => markTourSeen("content-list") });
}
