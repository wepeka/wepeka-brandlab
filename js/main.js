import { shellHTML, wireShell } from "./layout.js";
import { getBrand, initStore } from "./store.js";
import { onAuthChange } from "./auth.js";
import { renderAuthScreen } from "./views/login.js";
import { openContentEditor } from "./views/content-editor.js";
import * as brandsView from "./views/brands.js";
import * as dashboardView from "./views/dashboard.js";
import * as contentListView from "./views/content-list.js";
import * as creatorView from "./views/creator.js";
import * as calendarView from "./views/calendar.js";
import * as settingsView from "./views/settings.js";

const app = document.getElementById("app");
let cleanup = null;

function parseRoute(hash) {
  const h = (hash || "").replace(/^#/, "") || "/";
  let m;
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/([^/]+)\/?$/))) return { view: "content", brandId: m[1], contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/?$/))) return { view: "content", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/creator\/([^/]+)\/?$/))) return { view: "creator", brandId: m[1], contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/creator\/?$/))) return { view: "creator", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/calendar\/?$/))) return { view: "calendar", brandId: m[1] };
  // Analytics was folded into the Dashboard — old links still land somewhere useful.
  if ((m = h.match(/^\/brand\/([^/]+)\/analytics\/?$/))) return { view: "dashboard", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/?$/))) return { view: "dashboard", brandId: m[1] };
  if (h === "/settings") return { view: "settings" };
  return { view: "brands" };
}

let storeReady = false;

function showLoading() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card" style="text-align:center;">Loading…</div></div>`;
}

async function boot(user) {
  if (!user) {
    storeReady = false;
    if (cleanup) { cleanup(); cleanup = null; }
    app.innerHTML = `<main class="view" id="auth-root" style="padding:0;max-width:none;"></main>`;
    renderAuthScreen(document.getElementById("auth-root"));
    return;
  }
  if (!storeReady) {
    showLoading();
    await initStore();
    storeReady = true;
  }
  renderRoute();
}

function renderRoute() {
  if (!storeReady) return;
  if (cleanup) { cleanup(); cleanup = null; }
  const route = parseRoute(location.hash);

  if (route.brandId && !getBrand(route.brandId)) {
    location.hash = "#/";
    return;
  }

  app.innerHTML = shellHTML({ brandId: route.brandId, active: route.view });
  wireShell({ brandId: route.brandId });
  const viewRoot = document.getElementById("view-root");
  window.scrollTo(0, 0);

  switch (route.view) {
    case "dashboard":
      cleanup = dashboardView.render(viewRoot, { brandId: route.brandId });
      break;
    case "content":
      cleanup = contentListView.render(viewRoot, { brandId: route.brandId });
      if (route.contentId) openContentEditor({ brandId: route.brandId, contentId: route.contentId });
      break;
    case "creator":
      cleanup = creatorView.render(viewRoot, { brandId: route.brandId, initialContentId: route.contentId });
      break;
    case "calendar":
      cleanup = calendarView.render(viewRoot, { brandId: route.brandId });
      break;
    case "settings":
      cleanup = settingsView.render(viewRoot);
      break;
    default:
      cleanup = brandsView.render(viewRoot);
  }
}

window.addEventListener("hashchange", renderRoute);
onAuthChange(boot);
