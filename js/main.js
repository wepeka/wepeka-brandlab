import { shellHTML, wireShell } from "./layout.js";
import { getBrand, initStore } from "./store.js";
import { onAuthChange } from "./auth.js";
import { renderAuthScreen } from "./views/login.js";
// Every other view is loaded lazily (dynamic import, inside renderRoute)
// instead of statically here. These used to be static imports — which
// meant the login screen couldn't paint until the browser had fetched and
// evaluated every view in the whole app (Creator, Calendar, AI, OCR,
// Instagram/Facebook, everything), since a static import graph is fully
// resolved before a module's own top-level code runs. Logged-out visitors
// never touch any of that, so there's no reason to make them wait for it.

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

// Bumped on every call so a slow dynamic import from a route the user has
// already navigated away from can't clobber whatever rendered after it —
// only the most recent renderRoute() call is allowed to touch the DOM/set
// cleanup once its import resolves.
let renderToken = 0;

async function renderRoute() {
  if (!storeReady) return;
  const token = ++renderToken;
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

  const view = await (
    {
      home: () => import("./views/brand-home.js"),
      dna: () => import("./views/brand-dna.js"),
      campaigns: () => import("./views/campaigns.js"),
      guidelines: () => import("./views/brand-guidelines.js"),
      sales: () => import("./views/sales.js"),
      "content-os": () => import("./views/content-os.js"),
      settings: () => import("./views/settings.js"),
    }[route.view] || (() => import("./views/brands.js"))
  )();
  if (token !== renderToken) return; // navigated again while this was loading

  switch (route.view) {
    case "home":
      cleanup = view.render(viewRoot, { brandId: route.brandId });
      break;
    case "dna":
      cleanup = view.render(viewRoot, { brandId: route.brandId });
      break;
    case "campaigns":
      cleanup = view.render(viewRoot, { brandId: route.brandId, campaignId: route.campaignId });
      break;
    case "guidelines":
      cleanup = view.render(viewRoot, { brandId: route.brandId });
      break;
    case "sales":
      cleanup = view.render(viewRoot, { brandId: route.brandId });
      break;
    case "content-os":
      cleanup = view.render(viewRoot, { brandId: route.brandId, sub: route.sub, contentId: route.contentId });
      break;
    case "settings":
      cleanup = view.render(viewRoot);
      break;
    default:
      cleanup = view.render(viewRoot);
  }
}

// Firebase Auth's first onAuthChange callback needs a network round-trip
// (checking/refreshing the persisted session) before it fires at all — on
// a slow or flaky connection that gap left #app completely empty (just the
// dark theme's background, i.e. a black screen) until it resolved. Painting
// the loading state synchronously here, before that listener is even
// registered, closes the gap instead of relying on boot()'s own
// showLoading() call, which only runs after a user is already known.
showLoading();
window.addEventListener("hashchange", renderRoute);
onAuthChange(boot);
