import { backLinkHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import * as dashboardView from "./dashboard.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import { openContentEditor } from "./content-editor.js";
import { icon } from "../icons.js";
import { t } from "../i18n.js";
import { sectionGuideButtonHTML, wireSectionGuideButton } from "../section-guide.js";
import { maybeAutoPlayVideo, videoKeyForGuide } from "../guide-videos.js";
import { getMode } from "../mode.js";

// Creator and Kalender each have their own dedicated Panduan button and tour
// now (js/guides/creator-guide.js, js/guides/calendar-guide.js) — this hub
// tour is just a one-step orientation to the tab bar itself, for whoever
// lands on Dashboard/Konten first.
// Computed at use time (not a static array) so the tab count in the body
// copy always matches what's actually in the row — Pro still has 4
// (Ringkasan/Daftar Konten/Creator/Kalender), Pemula 3 since 6.5 dropped
// Ringkasan.
function tourSteps() {
  return [
    { selector: ".cos-tabs", title: t("cnt.os.tour.title"), body: getMode() === "guided" ? t("cnt.os.tour.bodyGuided") : t("cnt.os.tour.body") },
  ];
}

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

// Pemula mode: verbs instead of product names ("Creator" → "Tulis konten",
// "Calendar" → "Jadwal"), and the doing tabs first — the landing/summary
// tab is the least useful one for someone whose job right now is to
// write and post. Same routes, same screens, only the label and order.
// 6.5: "Ringkasan" (dashboard) dropped entirely — three tabs, not four.
const GUIDED_SUB_TABS = [
  { key: "creator", labelKey: "cnt.os.guidedTab.creator", path: (id) => `#/brand/${id}/content-os/creator` },
  { key: "calendar", labelKey: "cnt.os.guidedTab.calendar", path: (id) => `#/brand/${id}/content-os/calendar` },
  { key: "list", labelKey: "cnt.os.guidedTab.list", path: (id) => `#/brand/${id}/content-os/list` },
];

export function render(root, { brandId, sub, contentId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const activeSub = sub || "dashboard";
  // 6.5: Pemula's tab row has no "Ringkasan" to land on anymore — the bare
  // URL (or an old /dashboard link) redirects straight to Creator, the
  // actual first tab now, instead of falling through to the retired
  // beginner-content-os.js.
  if (getMode() === "guided" && activeSub === "dashboard") {
    location.hash = `#/brand/${brandId}/content-os/creator`;
    return () => {};
  }

  // The Jadwal Kerja (cadence) modal used to pop up here on a brand's first
  // visit — and then the Kalender tour asked for the same schedule again.
  // It now lives only where it's used: Kalender shows a "set your schedule"
  // card until it's configured, and the tour's Jadwal Kerja steps skip
  // themselves once it is.

  // Creator and Kalender own their own Panduan button/tour in their own
  // page-head — showing this hub's on top of that would just be a second,
  // redundant Panduan button on those two tabs.
  const hubGuideOwnsThisTab = activeSub !== "creator" && activeSub !== "calendar";

  root.innerHTML = `
    <div class="page-eyebrow" style="margin-bottom:14px;">${backLinkHTML(`#/brand/${brandId}`, t("nav.home"))} · ${getMode() === "guided" ? t("cnt.os.guidedCrumb") : "Content OS"}</div>
    <div class="flex items-center justify-between" style="margin:-4px 0 20px;">
      <div class="tabs cos-tabs" style="margin:0;">
        ${
          getMode() === "guided"
            ? GUIDED_SUB_TABS.map((tab) => `<a class="tab ${activeSub === tab.key ? "active" : ""}" href="${tab.path(brandId)}">${t(tab.labelKey)}</a>`).join("")
            : SUB_TABS.map((tab) => `<a class="tab ${activeSub === tab.key ? "active" : ""}" href="${tab.path(brandId)}">${t(tab.labelKey)}</a>`).join("")
        }
      </div>
      ${hubGuideOwnsThisTab ? sectionGuideButtonHTML("content-os") : ""}
    </div>
    <div id="cos-mount"></div>
  `;
  const mount = document.getElementById("cos-mount");

  if (hubGuideOwnsThisTab) {
    wireSectionGuideButton(root, "content-os", tourSteps());
  }

  let cleanup;
  if (activeSub === "list") {
    cleanup = contentListView.render(mount, { brandId });
    if (contentId) openContentEditor({ brandId, contentId, onSaved: () => {} });
  } else if (activeSub === "creator") {
    cleanup = creatorView.render(mount, { brandId, initialContentId: contentId });
  } else if (activeSub === "calendar") {
    cleanup = calendarView.render(mount, { brandId });
  } else {
    // Guided + "dashboard" already redirected to Creator above — only Pro
    // ever reaches this branch now.
    cleanup = dashboardView.render(mount, { brandId });
  }

  // Plays the explainer for whichever screen opening "Konten" actually lands
  // on — Creator in Pemula, the dashboard in Pro, or Kalender/Daftar konten
  // when the sub-tab is opened directly. The sub-view's own tour holds off
  // while it's up (js/tour.js) and is one of the video's own three answers.
  maybeAutoPlayVideo(videoKeyForGuide("content-os"));

  return () => cleanup?.();
}

