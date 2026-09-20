import { t, getLang } from "./i18n.js";

// <html lang> follows the chosen language (screen readers, hyphenation, spellcheck).
document.documentElement.lang = getLang();
import { shellHTML, wireShell, updateShellForRoute } from "./layout.js";
import { noteNavigation } from "./nav-context.js";
import { getBrand, initStore, listBrands, listContent, listCampaigns, getSettings, appendBrandEvents } from "./store.js";
import { identityDone } from "./brand-progress.js";
import { onAuthChange, logout, loginWithWepekaToken } from "./auth.js";
import { auth } from "./firebase.js";
import { renderAuthScreen } from "./views/login.js";
import { render as renderPricingScreen } from "./views/pricing.js";
import { isPaywallUnlocked, unlockPaywall } from "./paywall.js";
import { toast } from "./dom.js";
import { ensureAccountDoc, subscribeAccount, setCachedAccount, getCachedAccount, isDeactivated, isReadOnly, accessState } from "./account.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { clearPageGuide } from "./section-guide.js";
import { getMode, hasChosenMode } from "./mode.js";
import { renderModePicker } from "./mode-picker.js";
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
  if ((m = h.match(/^\/brand\/([^/]+)\/content-os\/?$/))) return { view: "content-os", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/([^/]+)\/?$/))) return { view: "campaigns", brandId: m[1], campaignId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/?$/))) return { view: "campaigns", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/builder\/([^/]+)\/?$/))) return { view: "builder", brandId: m[1], stage: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/builder\/?$/))) return { view: "builder", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/dna\/([^/]+)\/?$/))) return { view: "dna", brandId: m[1], step: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/dna\/?$/))) return { view: "dna", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/guidelines\/([^/]+)\/?$/))) return { view: "guidelines", brandId: m[1], section: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/guidelines\/?$/))) return { view: "guidelines", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/sales\/?$/))) return { view: "sales", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/copy\/?$/))) return { view: "copy", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/tools\/?$/))) return { view: "tools", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/brainstorm\/([^/]+)\/?$/))) return { view: "brainstorm", brandId: m[1], threadId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/brainstorm\/?$/))) return { view: "brainstorm", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/?$/))) return { view: "home", brandId: m[1] };
  if ((m = h.match(/^\/settings\/([^/]+)\/?$/))) return { view: "settings", panel: m[1] };
  if (h === "/settings") return { view: "settings" };
  return { view: "brands" };
}

let storeReady = false;
let accountUnsub = null;
let subscribedUid = null;

function showLoading() {
  app.innerHTML = `<div class="auth-shell"><div class="auth-card" style="text-align:center;">${t("app.loading")}</div></div>`;
}

function teardownApp() {
  storeReady = false;
  // Signing out and into another account in the same tab is a fresh first
  // open for that account — it gets its own picker.
  modePickerShown = false;
  pulsedBrands.clear();
  delete app.dataset.shellKey;
  clearPageGuide();
  if (cleanup) { cleanup(); cleanup = null; }
}

function lockedScreenHTML(email) {
  return `
    <div class="auth-shell"><div class="auth-card" style="text-align:center;">
      <div class="brand-mark" style="justify-content:center;margin-bottom:22px;">
        <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
        <span class="brand-mark-divider"></span>
        Brandlab
      </div>
      <h1 class="auth-title">${t("app.locked.title")}</h1>
      <p class="page-sub" style="margin:10px 0 22px;">${t("app.locked.body", { email: escapeHtml(email) })}</p>
      <button class="btn btn-secondary btn-block" id="locked-logout">${icon("logout", { size: 15 })}${t("topbar.logout")}</button>
    </div></div>
  `;
}

async function boot(user) {
  if (!user && ssoPending) {
    showLoading();
    return;
  }
  if (!user) {
    teardownApp();
    if (accountUnsub) { accountUnsub(); accountUnsub = null; }
    subscribedUid = null;
    setCachedAccount(null);
    // startsWith, not ===, so a query string on the hash (there is none
    // today, but there was historically) still lands on the login screen
    // instead of falling through to the pricing screen.
    const showLogin = isPaywallUnlocked() || location.hash.startsWith("#/login");
    if (!showLogin) {
      app.innerHTML = `<main class="view" id="pricing-root" style="padding:0;max-width:none;"></main>`;
      renderPricingScreen(document.getElementById("pricing-root"));
      return;
    }
    app.innerHTML = `<main class="view" id="auth-root" style="padding:0;max-width:none;"></main>`;
    renderAuthScreen(document.getElementById("auth-root"));
    return;
  }

  if (subscribedUid === user.uid) return; // account listener already driving this user
  // Switching straight from one signed-in account to another (no null-user
  // boot in between — e.g. a Wepeka SSO token for a different person landing
  // while this tab was already signed in) must not let the new account reuse
  // the old one's already-`storeReady` render; force initStore() to run again
  // for the new uid below instead of falling into the `renderRoute()` only
  // branch in onAccountChange.
  if (subscribedUid !== null && subscribedUid !== user.uid) storeReady = false;
  subscribedUid = user.uid;
  if (accountUnsub) { accountUnsub(); accountUnsub = null; }
  showLoading();
  await ensureAccountDoc(user);
  accountUnsub = subscribeAccount(user.uid, (account) => onAccountChange(user, account));
}

// Fires once immediately with the current account doc, then again live on
// every plan/status change — a Midtrans webhook settling payment or an
// admin deactivating the account both land here without a page refresh.
function onAccountChange(user, account) {
  setCachedAccount(account);

  if (isDeactivated(account)) {
    teardownApp();
    app.innerHTML = lockedScreenHTML(user.email || "");
    document.getElementById("locked-logout")?.addEventListener("click", () => logout());
    return;
  }

  const state = accessState(account);
  // "none" (never claimed a trial / never paid — no accounts/{uid} doc at
  // all) and "expired" (a lapsed sub or ended trial) both get the same
  // locked pricing screen now — no more in-app read-only browsing for a
  // lapsed account (Fase 2 of .claude/handoff-satu-akun.md). Data is never
  // touched here; it's just not rendered until the account is paid/trial
  // again.
  if (state === "none" || state === "expired") {
    teardownApp();
    app.innerHTML = `<main class="view" id="pricing-root" style="padding:0;max-width:none;"></main>`;
    renderPricingScreen(document.getElementById("pricing-root"), { account, user, locked: true });
    return;
  }

  // state is "paid" or "trial" — the only two that ever render the app.
  if (!storeReady) {
    showLoading();
    initStore(user.uid).then(async () => {
      // Very first open of this account: one decision ("who are you?")
      // before anything else — no welcome modal, no tour banner stacked on
      // top of it. Those come back on the next boot as usual; the picker
      // itself never does once a card is chosen (js/mode.js hasChosenMode).
      // onAccountChange re-fires on every accounts/{uid} write, and right
      // after a signup there are several in a row — without this guard a
      // second run would wipe the picker the person is looking at, render a
      // fresh one, and leave the first run awaiting a click on buttons that
      // no longer exist (so its "play the Kenalan video" never ran).
      const firstEverOpen = !hasChosenMode() && !modePickerShown;
      if (firstEverOpen) {
        modePickerShown = true;
        app.innerHTML = `<main class="view" id="mode-root" style="padding:0;max-width:none;"></main>`;
        await renderModePicker(document.getElementById("mode-root"));
      }
      storeReady = true;
      firstRouteAfterBoot = true;
      // The mode picker and, once, the "Kenalan" explainer video are the
      // only things that ever interrupt a boot — no splash, no banners. The
      // route always paints first (the home hero says what to do next);
      // only a brand-new account then gets the video on top of it, and only
      // the one time (js/guide-videos.js playFirstRunIntro, videoSeen-gated).
      renderRoute();
      if (firstEverOpen) {
        import("./guide-videos.js")
          .then((m) => m.playFirstRunIntro())
          .catch((e) => console.warn("first-run video unavailable", e));
      }
      // Weekly Instagram insights refresh for published content. Loaded
      // lazily (same reason every view is) and a few seconds after first
      // paint so it never competes with the initial render.
      setTimeout(() => {
        import("./instagram-sync.js")
          .then((m) => m.maybeAutoSyncInstagram())
          .then(() => {
            // Fresh view/engagement numbers can flip a Brand Pulse signal —
            // re-run it for whichever brand is on screen now (the sync
            // itself may have touched several; only the visible one needs
            // its signals current right away).
            const brandId = parseRoute(location.hash).brandId;
            if (brandId) {
              pulsedBrands.delete(brandId);
              runPulseOnce(brandId);
            }
          })
          .catch((e) => console.warn("Instagram auto-sync unavailable", e));
      }, 8000);
    });
  } else {
    renderRoute();
  }
}

// Bumped on every call so a slow dynamic import from a route the user has
// already navigated away from can't clobber whatever rendered after it —
// only the most recent renderRoute() call is allowed to touch the DOM/set
// cleanup once its import resolves.
let renderToken = 0;

// Pemula mode with exactly one brand: the "pick a brand" page is a
// decision with only one answer, so the first route after boot skips it
// and lands straight inside that brand. Only the FIRST route — once the
// user deliberately navigates to "Semua Brand" (to add a second one, say)
// it has to stay put.
let firstRouteAfterBoot = false;
// One mode picker per boot, no matter how many account snapshots land.
let modePickerShown = false;

// Brand Pulse (js/brand-pulse.js): computed once per brand per session (this
// Set guards repeats — every AI feature reads the result through
// brand.developmentLog, not by recomputing it itself, so re-running this on
// every navigation would be pure waste), then again after the weekly
// Instagram auto-sync updates this brand's content performance — fresh
// view/engagement numbers can flip a "viral" or "engagement-drop" signal
// that wasn't true a moment ago. Skipped for read-only accounts, which
// can't write the result anywhere (js/store.js updateBrand would no-op
// against Firestore rules anyway).
const pulsedBrands = new Set();
async function runPulseOnce(brandId) {
  if (pulsedBrands.has(brandId) || isReadOnly(getCachedAccount())) return;
  pulsedBrands.add(brandId);
  const brand = getBrand(brandId);
  if (!brand) return;
  try {
    const { computeSignals } = await import("./brand-pulse.js");
    const signals = computeSignals({ brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
    if (signals.length) appendBrandEvents(brandId, signals);
  } catch (e) {
    console.warn("[brand pulse] unavailable", e);
  }
}

async function renderRoute() {
  if (!storeReady) return;
  const token = ++renderToken;
  if (cleanup) { cleanup(); cleanup = null; }
  clearPageGuide();

  // Pricing, reached from inside the app (trial/read-only pill, or an
  // upgrade). The store stays loaded — leaving this hash just rebuilds the
  // shell, no second boot.
  if (location.hash.startsWith("#/pricing")) {
    delete app.dataset.shellKey;
    app.innerHTML = `<main class="view" id="pricing-root" style="padding:0;max-width:none;"></main>`;
    renderPricingScreen(document.getElementById("pricing-root"), { account: getCachedAccount(), user: lastUser, backHref: "#/" });
    window.scrollTo(0, 0);
    return;
  }

  const route = parseRoute(location.hash);
  noteNavigation(location.hash);

  if (firstRouteAfterBoot) {
    firstRouteAfterBoot = false;
    const brands = listBrands();
    if (route.view === "brands" && getMode() === "guided" && brands.length === 1) {
      location.hash = `#/brand/${brands[0].id}`;
      return;
    }
  }

  if (route.brandId && !getBrand(route.brandId)) {
    location.hash = "#/";
    return;
  }
  if (route.brandId) runPulseOnce(route.brandId);

  // Same brand + same mode + same lock state = same topbar: keep it in
  // place and only swap the page underneath (short fade-out, then the new
  // page fades in), so a tab click doesn't flash the whole chrome. Anything
  // else (entering a brand, leaving it, switching mode, the Pemula tabs
  // unlocking after the identity is done) rebuilds the shell.
  const brandForShell = route.brandId ? getBrand(route.brandId) : null;
  const shellKey = `${route.brandId || ""}|${getMode()}|${brandForShell && identityDone(brandForShell) ? 1 : 0}`;
  let viewRoot = document.getElementById("view-root");
  if (viewRoot && app.dataset.shellKey === shellKey) {
    viewRoot.classList.add("view-leave");
    await new Promise((r) => setTimeout(r, 110));
    if (token !== renderToken) return;
    updateShellForRoute({ brandId: route.brandId, active: route.view });
    viewRoot.className = `view view-${route.view} ${route.view === "content-os" || route.view === "brainstorm" ? "wide" : ""}`;
    viewRoot.innerHTML = "";
    void viewRoot.offsetWidth;
    viewRoot.classList.add("view-enter");
  } else {
    app.innerHTML = shellHTML({ brandId: route.brandId, active: route.view });
    app.dataset.shellKey = shellKey;
    wireShell({ brandId: route.brandId });
    viewRoot = document.getElementById("view-root");
  }
  window.scrollTo(0, 0);

  const view = await (
    {
      home: () => import("./views/home.js"),
      dna: () => import("./views/brand-dna.js"),
      builder: () => import("./views/brand-builder.js"),
      campaigns: () => import("./views/campaigns.js"),
      guidelines: () => import("./views/brand-guidelines.js"),
      sales: () => import("./views/sales.js"),
      copy: () => import("./views/copy-studio.js"),
      tools: () => import("./views/tools.js"),
      brainstorm: () => import("./views/brainstorm.js"),
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
      cleanup = view.render(viewRoot, { brandId: route.brandId, step: route.step });
      break;
    case "builder":
      cleanup = view.render(viewRoot, { brandId: route.brandId, stage: route.stage });
      break;
    case "campaigns":
      cleanup = view.render(viewRoot, { brandId: route.brandId, campaignId: route.campaignId });
      break;
    case "guidelines":
      cleanup = view.render(viewRoot, { brandId: route.brandId, section: route.section });
      break;
    case "sales":
    case "copy":
    case "tools":
      cleanup = view.render(viewRoot, { brandId: route.brandId });
      break;
    case "brainstorm":
      cleanup = view.render(viewRoot, { brandId: route.brandId, threadId: route.threadId || null });
      break;
    case "content-os":
      cleanup = view.render(viewRoot, { brandId: route.brandId, sub: route.sub, contentId: route.contentId });
      break;
    case "settings":
      cleanup = view.render(viewRoot, { panel: route.panel });
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
// Arriving from wepeka.com with a one-time Wepeka token. Handled before the
// auth listener starts so the app never flashes the login screen first, and
// the token is wiped from the URL immediately either way — nothing to
// copy-paste out of the address bar, nothing left in history.
// True from the moment a Wepeka token is spotted until the sign-in with it
// settles — boot() waits instead of painting the login screen in between,
// which would otherwise flash for a second on every arrival from the site.
let ssoPending = false;

// Firebase custom tokens are JWTs with an unencrypted `uid` claim in the
// payload — reading it here (without verifying the signature, which only
// the server can do) is enough to notice "this token is for someone else"
// before we sign in with it; the actual sign-in is still verified server-side
// by signInWithCustomToken.
function decodeWepekaTokenUid(token) {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).uid || null;
  } catch {
    return null;
  }
}

async function consumeWepekaToken() {
  const m = location.hash.match(/^#\/sso\?t=([^&]+)(?:&to=([a-z]+))?/);
  if (!m) return;
  ssoPending = true;
  const token = decodeURIComponent(m[1]);
  // Only "pricing" today — an expired/lapsed account sent back in from
  // /brandlab/connect?to=pricing (wpk-dp) so it lands straight on the
  // pricing screen instead of the locked app shell. No authority on its
  // own; accessState() still decides what actually renders.
  const to = m[2] === "pricing" ? "pricing" : null;
  history.replaceState(null, "", location.pathname + location.search);
  location.hash = "#/";
  try {
    // A token minted for a different account than the one already signed
    // into this tab: tear down that session before switching, so its store
    // doesn't briefly keep rendering under the new uid.
    const incomingUid = decodeWepekaTokenUid(token);
    if (auth.currentUser && incomingUid && auth.currentUser.uid !== incomingUid) {
      await logout();
      teardownApp();
      storeReady = false;
      subscribedUid = null;
    }
    await loginWithWepekaToken(token);
    unlockPaywall();
    if (to === "pricing") location.hash = "#/pricing";
  } catch (err) {
    console.warn("[sso] Wepeka token rejected", err);
    toast(t("auth.wepeka.failed"), "error");
    location.hash = "#/login";
  } finally {
    ssoPending = false;
    if (!lastUser) boot(lastUser);
  }
}

let lastUser = null;
showLoading();
consumeWepekaToken();
window.addEventListener("hashchange", () => {
  if (!lastUser) { boot(lastUser); return; } // toggle pricing <-> login while logged out
  renderRoute();
});
// Guided/Advanced toggle changes which view "home" resolves to — repaint
// the current route immediately instead of waiting for the next navigation.
window.addEventListener("mode:change", () => { if (storeReady) renderRoute(); });
onAuthChange((user) => { lastUser = user; boot(user); });
