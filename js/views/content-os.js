import { getBrand } from "../store.js";
import * as dashboardView from "./dashboard.js";
import * as contentListView from "./content-list.js";
import * as creatorView from "./creator.js";
import * as calendarView from "./calendar.js";
import { openContentEditor } from "./content-editor.js";

// Umbrella for everything the user's own model calls "Content Operating
// System" — the analytics dashboard, the content database, Creator Studio,
// and Calendar all live inside here as sub-tabs instead of separate
// top-level nav items. Each sub-view keeps its existing render(root, {...})
// signature and internal logic completely unchanged; this just decides
// which one gets mounted based on the URL's sub-route.
const SUB_TABS = [
  { key: "dashboard", label: "Dashboard", path: (id) => `#/brand/${id}/content-os` },
  { key: "list", label: "Content", path: (id) => `#/brand/${id}/content-os/list` },
  { key: "creator", label: "Creator", path: (id) => `#/brand/${id}/content-os/creator` },
  { key: "calendar", label: "Calendar", path: (id) => `#/brand/${id}/content-os/calendar` },
];

export function render(root, { brandId, sub, contentId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const activeSub = sub || "dashboard";

  root.innerHTML = `
    <div class="tabs" style="margin:-4px 0 20px;">
      ${SUB_TABS.map((t) => `<a class="tab ${activeSub === t.key ? "active" : ""}" href="${t.path(brandId)}">${t.label}</a>`).join("")}
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
