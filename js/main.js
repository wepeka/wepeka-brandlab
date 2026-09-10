import { shellHTML, wireShell } from "./layout.js";
import { getBrand, initStore } from "./store.js";
import { onAuthChange } from "./auth.js";
import { renderAuthScreen } from "./views/login.js";
import * as brandsView from "./views/brands.js";
import * as brandHomeView from "./views/brand-home.js";
import * as brandDnaView from "./views/brand-dna.js";
import * as brandGuidelinesView from "./views/brand-guidelines.js";
import * as salesView from "./views/sales.js";
import * as campaignsView from "./views/campaigns.js";
import * as contentOsView from "./views/content-os.js";
import * as settingsView from "./views/settings.js";

const app = document.getElementById("app");
let cleanup = null;

function parseRoute(hash) {
  const h = (hash || "").replace(/^#/, "") || "/";
  let m;
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/creator\/([^/]+)\/?$/))) return { view: "content-os", brandId: m[1], sub: "creator", contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/creator\/?$/))) return { view: "content-os", brandId: m[1], sub: "creator" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/list\/([^/]+)\/?$/))) return { view: "content-os", brandId: m[1], sub: "list", contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/list\/?$/))) return { view: "content-os", brandId: m[1], sub: "list" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/calendar\/?$/))) return { view: "content-os", brandId: m[1], sub: "calendar" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/?$/))) return { view: "content-os", brandId: m[1], sub: "dashboard" };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/([^/]+)\/?$/))) return { view: "campaigns", brandId: m[1], campaignId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/?$/))) return { view: "campaigns", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/dna\/?$/))) return { view: "dna", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/guidelines\/?$/))) return { view: "guidelines", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/sales\/?$/))) return { view: "sales", brandId: m[1] };
  // Analytics was folded into Content OS's Dashboard sub-tab — old links still land somewhere useful.
  if ((m = h.match(/^\/brand\/([^/]+)\/analytics\/?$/))) return { view: "content-os", brandId: m[1], sub: "dashboard" };
  if ((m = h.match(/^\/brand\/([^/]+)\/?$/))) return { view: "home", brandId: m[1] };
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
    case "home":
      cleanup = brandHomeView.render(viewRoot, { brandId: route.brandId });
      break;
    case "dna":
      cleanup = brandDnaView.render(viewRoot, { brandId: route.brandId });
      break;
    case "campaigns":
      cleanup = campaignsView.render(viewRoot, { brandId: route.brandId, campaignId: route.campaignId });
      break;
    case "guidelines":
      cleanup = brandGuidelinesView.render(viewRoot, { brandId: route.brandId });
      break;
    case "sales":
      cleanup = salesView.render(viewRoot, { brandId: route.brandId });
      break;
    case "content-os":
      cleanup = contentOsView.render(viewRoot, { brandId: route.brandId, sub: route.sub, contentId: route.contentId });
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
