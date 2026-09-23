import { backLinkHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import * as copyStudioView from "./copy-studio.js";
import * as seriesView from "./series.js";
import { openContentEditor } from "./content-editor.js";
import { t } from "../i18n.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";

// Umbrella for the content side: Creator Studio, the calendar, the content
// database and Copy Studio ("Tulisan Cepat": copy you need right now, not
// scheduled content) live here as sub-tabs — the same four, in the same
// order, for both modes. Each sub-view keeps its own render(root, {...})
// signature; this only decides which one mounts from the URL's sub-route.
const SUB_TABS = [
  { key: "creator", labelKey: "contentOs.tab.creator", path: (id) => `#/brand/${id}/content/creator` },
  { key: "calendar", labelKey: "contentOs.tab.calendar", path: (id) => `#/brand/${id}/content/calendar` },
  { key: "list", labelKey: "contentOs.tab.list", path: (id) => `#/brand/${id}/content/list` },
  { key: "copy", labelKey: "contentOs.tab.copy", path: (id) => `#/brand/${id}/content/copy` },
  { key: "series", labelKey: "contentOs.tab.series", path: (id) => `#/brand/${id}/content/series` },
];

// One-step orientation to the tab bar itself, offered from the topbar "?"
// on the Daftar tab (Creator and Kalender register their own guides).
function tourSteps() {
  return [{ selector: ".cos-tabs", title: t("cnt.os.tour.title"), body: t("cnt.os.tour.body") }];
}

export function render(root, { brandId, sub, contentId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  // The bare URL (and any old /dashboard link) lands on the first tab.
  const activeSub = SUB_TABS.some((x) => x.key === sub) ? sub : "creator";

  root.innerHTML = `
    <div class="page-eyebrow flex items-center gap-6" style="margin-bottom:14px;">${backLinkHTML(`#/brand/${brandId}`, t("nav.home"))} · ${t("nav.content")}${helpButtonHTML("content-os")}${guideVideoButtonHTML("content-os")}</div>
    <div class="tabs cos-tabs" style="margin:-4px 0 20px;">
      ${SUB_TABS.map((tab) => `<a class="tab ${activeSub === tab.key ? "active" : ""}" href="${tab.path(brandId)}">${t(tab.labelKey)}</a>`).join("")}
    </div>
    <div id="cos-mount"></div>
  `;
  wireHelpButtons(root);
  const mount = document.getElementById("cos-mount");

  let cleanup;
  if (activeSub === "list") {
    setPageGuide(() => runSpotlightTour(tourSteps()));
    cleanup = contentListView.render(mount, { brandId });
    if (contentId) openContentEditor({ brandId, contentId, onSaved: () => {} });
  } else if (activeSub === "calendar") {
    cleanup = calendarView.render(mount, { brandId });
  } else if (activeSub === "copy") {
    cleanup = copyStudioView.render(mount, { brandId });
  } else if (activeSub === "series") {
    cleanup = seriesView.render(mount, { brandId });
  } else {
    cleanup = creatorView.render(mount, { brandId, initialContentId: contentId });
  }

  return () => cleanup?.();
}
