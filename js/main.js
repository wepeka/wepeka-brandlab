import { t, getLang } from "./i18n.js";

// Small, self-contained fallback strings for the two failure paths below
// (a route's own view module/render throwing, and anything else uncaught
// anywhere in the app). Not part of js/i18n.js's dictionary on purpose —
// this file only owns main.js, and these two messages are simple enough
// not to need a shared key.
const APP_ERROR_TEXT = {
  id: {
    routeTitle: "Halaman gagal dimuat",
    routeBody: "Sambungan mungkin terputus, atau ada versi baru yang belum termuat penuh.",
    reload: "Muat ulang",
    genericToast: "Ada yang tidak berjalan semestinya. Coba muat ulang halaman.",
  },
  en: {
    routeTitle: "This page failed to load",
    routeBody: "Your connection may have dropped, or a new version hasn't fully loaded yet.",
    reload: "Reload",
    genericToast: "Something went wrong. Try reloading the page.",
  },
};
const appErrorText = () => APP_ERROR_TEXT[getLang() === "en" ? "en" : "id"];

// <html lang> follows the chosen language (screen readers, hyphenation, spellcheck).
document.documentElement.lang = getLang();
import { shellHTML, wireShell, updateShellForRoute } from "./layout.js";
import { noteNavigation } from "./nav-context.js";
import { initAnalytics, setUser } from "./analytics.js";
import { initMetaPixel } from "./meta-pixel.js";
import { trackTrialStart } from "./trial-start.js";
import { checkPendingOrders } from "./pending-orders.js";
import { getBrand, initStore, listBrands, listContent, listCampaigns, getSettings, appendBrandEvents, whenServerSynced, watchBrandScope, isBrandSalesReady, ensureBrandSales } from "./store.js";
import { identityDone } from "./brand-progress.js";
import { onAuthChange, logout, loginWithWepekaToken } from "./auth.js";
import { auth, wipeLocalFirestore, claimLocalCache } from "./firebase.js";
import { renderAuthScreen } from "./views/login.js";
import { render as renderPricingScreen } from "./views/pricing.js";
import { isPaywallUnlocked, unlockPaywall } from "./paywall.js";
import { rememberBuyIntent } from "./buy-intent.js";
import { rememberPromo } from "./promo-code.js";
import { consumePayReturn } from "./pay-return.js";
import { isPaidWelcomeDue } from "./paid-welcome.js";
import { showPayLoading, hidePayLoading } from "./pay-loading.js";
import { WEPEKA_CONNECT_URL } from "./site-links.js";
import { toast, showWelcomeBumper } from "./dom.js";
import { subscribeAccount, setCachedAccount, getCachedAccount, isDeactivated, isReadOnly, accessState, isBrandLocked } from "./account.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { clearPageGuide } from "./section-guide.js";
import { getMode, hasChosenMode } from "./mode.js";
import { setPlainLanguageResolver } from "./i18n.js";
import { renderModePicker } from "./mode-picker.js";
import { noteError } from "./error-log.js";

// Pemula reads plain words everywhere (js/i18n.js plainWords).
setPlainLanguageResolver(() => getMode() === "guided");
// Every other view is loaded lazily (dynamic import, inside renderRoute)
// instead of statically here. These used to be static imports — which
// meant the login screen couldn't paint until the browser had fetched and
// evaluated every view in the whole app (Creator, Calendar, AI, OCR,
// Instagram/Facebook, everything), since a static import graph is fully
// resolved before a module's own top-level code runs. Logged-out visitors
// never touch any of that, so there's no reason to make them wait for it.

const app = document.getElementById("app");

// The "Selamat datang" video (admin slot `akun-baru`): once per account,
// after the account exists and before the Pemula/Pro picker. Silent when it
// isn't published; never blocks the picker if anything fails. "Tur website"
// there can't run yet (no app on screen), so it's remembered and started
// once the picked mode's first page has painted (tourAfterPicker).
let welcomeTourPending = false;
function playWelcomeVideo() {
  return import("./guide-videos.js")
    .then((m) => m.playVideoGate("akun-baru", { tourNow: false }))
    .then((r) => { if (r?.tour) welcomeTourPending = true; })
    .catch((e) => console.warn("welcome video unavailable", e));
}
// True (once) when the welcome video asked for the tour; starts it.
function tourAfterPicker(delay = 600) {
  if (!welcomeTourPending) return false;
  welcomeTourPending = false;
  screenHeldUntil = Date.now() + delay + 1500;
  setTimeout(() => import("./guide-videos.js").then((m) => m.startTour()), delay);
  return true;
}
// A new account's first open of a page plays that page's video by itself
// (js/guide-videos.js offerPageVideo) — but never on top of what a boot puts
// up one after another (greeting, first-run video, the congratulations page)
// or just ahead of a tour that is about to start. Those hold the screen here.
let bootHoldsScreen = false;
let screenHeldUntil = 0;
function offerPageVideo(token) {
  const hash = location.hash;
  import("./guide-videos.js")
    .then((m) => m.offerPageVideo({ stillHere: () => token === renderToken && location.hash === hash, busy: () => bootHoldsScreen || Date.now() < screenHeldUntil }))
    .catch((e) => console.warn("page video unavailable", e));
}
// The congratulations page after a payment (js/pay-thanks.js): "Selamat,
// kamu sudah Lifetime", the WhatsApp group and Instagram doors, one button
// into the app — once per account, the first time it is open on a paid plan
// (and once more when it becomes Lifetime; js/paid-welcome.js). It covers
// the whole screen from the moment it is due: its empty shell goes up here,
// in the same breath as whatever is painted underneath, and the page itself
// (downloaded on demand) fills it. Midtrans's own window, if it is still
// open over a payment that has landed, is put away so the page is what the
// buyer comes back to (snap.hide() only closes it: no onClose, and the next
// checkout opens as usual). Resolves when the button is pressed (at once when the
// page isn't due), so whatever comes next — welcome video, mode picker —
// waits its turn. Needs the store.
const THANKS_LOAD_MS = 10_000;
let thanksPage = null;
let thanksUp = null;
function paidWelcome() {
  if (thanksUp) return thanksUp;
  if (!isPaidWelcomeDue()) return Promise.resolve(false);
  const page = document.createElement("div");
  page.className = "pay-thanks pricing-page";
  document.body.appendChild(page);
  thanksPage = page;
  app.inert = true;
  try { window.snap?.hide?.(); } catch { /* not open, or already closing */ }
  // The page's code is a download: failed, or still not here after a while
  // (a stalled connection), the shell comes down and the app is not kept
  // waiting — the account is still owed the page, on its next open.
  const stalled = new Promise((resolve) => setTimeout(() => { if (!page.firstChild) resolve(false); }, THANKS_LOAD_MS));
  const answered = import("./pay-thanks.js")
    .then((m) => m.showPayThanks(page))
    .then(() => true);
  const mine = Promise.race([answered, stalled])
    .catch((e) => { console.warn("congratulations page unavailable", e); return false; })
    .then((pressed) => {
      if (thanksUp !== mine) return false; // taken down meanwhile (teardownApp)
      closeThanks();
      // Whatever was under it, it is never the plans.
      if (pressed && storeReady && location.hash.startsWith("#/pricing")) location.hash = "#/";
      return pressed;
    });
  thanksUp = mine;
  return mine;
}
function closeThanks() {
  thanksPage?.remove();
  thanksPage = null;
  thanksUp = null;
  app.inert = false;
}
// A payment that has just landed is never answered with the plans page it
// was made on (owner, 2026-10-13: back from GoPay, the buyer was looking at
// the prices again). Called before a route is painted for an account that
// is owed the congratulations page: the app's home goes underneath instead.
function leavePlansIfThanksDue() {
  if (!location.hash.startsWith("#/pricing") || !isPaidWelcomeDue()) return;
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);
}
// Back from a payment made in another app (js/pay-return.js): what Midtrans
// said happened, read once and already gone from the address bar. Used up by
// whichever comes first — the account's first snapshot, or the front page
// when this browser isn't signed in.
let payReturn = consumePayReturn();
// Back from the payment app a moment before the webhook has written the
// account: a full-screen "setting up" (js/pay-loading.js) instead of the
// plans page this account would otherwise still get, until the payment is
// on the account — or, after a while, whatever the account really says.
const PAID_WAIT_MS = 30_000;
let paidWait = null;
function endPaidWait() {
  if (!paidWait) return;
  clearTimeout(paidWait);
  paidWait = null;
  hidePayLoading();
}
// The Gojek app opens the way back in the phone's default browser. A buyer
// who checked out somewhere else (Instagram's built-in browser, another
// browser) arrives here signed out, on the front page: say that the plan is
// on their account and that signing in opens it.
async function tellPaidSignedOut() {
  try {
    const { openModal } = await import("./modals.js");
    openModal({
      title: t("pay.return.signedOut.title"),
      bodyHTML: `<p style="margin:0;line-height:1.6;">${t("pay.return.signedOut.body")}</p>`,
      footHTML: `<a class="btn btn-primary" href="${WEPEKA_CONNECT_URL}">${t("auth.wepeka.login")}</a>`,
    });
  } catch (e) {
    console.warn("pay-return notice unavailable", e);
  }
}
let cleanup = null;

function parseRoute(hash) {
  let h = (hash || "").replace(/^#/, "") || "/";
  // Pre-23 Sep 2026 addresses used "content-os" for the Konten tab. Rewrite
  // in place so bookmarks, notifications and shared links keep working, and
  // fix the address bar without adding a history entry.
  const modern = h.replace(/\/content-os(?=\/|$)/, "/content");
  if (modern !== h) {
    h = modern;
    if (location.hash !== "#" + h) location.replace("#" + h);
  }
  let m;
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/creator\/([^/]+)\/?$/))) return { view: "content-os", brandId: m[1], sub: "creator", contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/creator\/?$/))) return { view: "content-os", brandId: m[1], sub: "creator" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/list\/([^/]+)\/?$/))) return { view: "content-os", brandId: m[1], sub: "list", contentId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/list\/?$/))) return { view: "content-os", brandId: m[1], sub: "list" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/calendar\/?$/))) return { view: "content-os", brandId: m[1], sub: "calendar" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/copy\/?$/))) return { view: "content-os", brandId: m[1], sub: "copy" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/series\/?$/))) return { view: "content-os", brandId: m[1], sub: "series" };
  if ((m = h.match(/^\/brand\/([^/]+)\/content\/?$/))) return { view: "content-os", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/([^/]+)\/?$/))) return { view: "campaigns", brandId: m[1], campaignId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/campaigns\/?$/))) return { view: "campaigns", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/builder\/([^/]+)\/?$/))) return { view: "builder", brandId: m[1], stage: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/builder\/?$/))) return { view: "builder", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/dna\/([^/]+)\/?$/))) return { view: "dna", brandId: m[1], step: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/dna\/?$/))) return { view: "dna", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/guidelines\/([^/]+)\/?$/))) return { view: "guidelines", brandId: m[1], section: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/guidelines\/?$/))) return { view: "guidelines", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/sales\/?$/))) return { view: "sales", brandId: m[1] };
  // Pre-22 Sep 2026 addresses: Copy Studio moved under Konten and the Tools
  // hub is gone (its other two doors, Sales Tracker and Brainstorm, kept
  // their own routes under Tujuan).
  if ((m = h.match(/^\/brand\/([^/]+)\/copy\/?$/))) return { view: "content-os", brandId: m[1], sub: "copy" };
  if ((m = h.match(/^\/brand\/([^/]+)\/tools\/?$/))) return { view: "home", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/goals\/([^/]+)\/?$/))) return { view: "goals", brandId: m[1], goalId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/goals\/?$/))) return { view: "goals", brandId: m[1] };
  // The chat's own page. Its old address (under Brainstorm) still works.
  if ((m = h.match(/^\/brand\/([^/]+)\/(?:chat|brainstorm)\/([^/]+)\/?$/))) return { view: "chat", brandId: m[1], threadId: m[2] };
  if ((m = h.match(/^\/brand\/([^/]+)\/(?:chat|brainstorm)\/?$/))) return { view: "chat", brandId: m[1] };
  if ((m = h.match(/^\/brand\/([^/]+)\/?$/))) return { view: "home", brandId: m[1] };
  if ((m = h.match(/^\/settings\/([^/]+)\/?$/))) return { view: "settings", panel: m[1] };
  if (h === "/settings") return { view: "settings" };
  if (h === "/updates") return { view: "announcements" };
  return { view: "brands" };
}

let storeReady = false;
let accountUnsub = null;
let subscribedUid = null;

// Boot loader — the same "Wepeka loading" as wepeka.com's route curtain
// (wpk-dp page-transition-flash.tsx): a dark sheet with the Wepeka |
// Brandlab mark and a sliding orange→pink line, which carries on out the
// top (brand-gradient sheet trailing) once the first real screen replaces
// it. index.html ships the same markup inside #app, so the very first
// paint already shows it instead of a black screen while modules load.
const LOADER_SLOW_MS = 12_000;

function loaderMarkHTML() {
  return `<div class="wl-loader-mark"><img src="assets/wepeka-logo.png" alt="Wepeka" /><span class="wl-loader-divider"></span><span>Brandlab</span></div>`;
}

function showLoading() {
  let loader = app.querySelector(":scope > .wl-loader");
  if (loader) {
    // Already up (index.html's static copy, or an earlier call this boot):
    // keep it so the animation doesn't restart, just make sure the screen
    // reader text is in the chosen language.
    loader.querySelector(".sr-only").textContent = t("app.loading");
  } else {
    // Replacing a real screen (login → app, account switch): sweep in like
    // wepeka.com's curtain instead of cutting.
    const covering = app.childElementCount > 0;
    app.innerHTML = `
      <div class="wl-loader${covering ? " is-covering" : ""}" role="status" aria-live="polite">
        <div class="wl-loader-sheet wl-loader-color"></div>
        <div class="wl-loader-sheet wl-loader-dark"><div class="wl-loader-logo">${loaderMarkHTML()}<span class="wl-loader-line"></span></div></div>
        <span class="sr-only">${t("app.loading")}</span>
      </div>`;
    loader = app.querySelector(":scope > .wl-loader");
  }
  // Firebase blocked / a dead connection used to leave "Memuat…" up
  // forever with nothing to do — after a while, say so and offer a reload.
  if (!loader.querySelector(".wl-loader-slow")) {
    loader.querySelector(".wl-loader-logo").insertAdjacentHTML("beforeend", `
      <div class="wl-loader-slow">
        <p>${t("app.loading.slow")}</p>
        <button type="button" class="wl-loader-reload">${appErrorText().reload}</button>
      </div>`);
    loader.querySelector(".wl-loader-reload").addEventListener("click", () => location.reload());
  }
  clearTimeout(loader._slowTimer);
  loader._slowTimer = setTimeout(() => loader.classList.add("is-slow"), LOADER_SLOW_MS);
}

// The loader leaves the moment anything else is written into #app (every
// screen in this file replaces app.innerHTML), so the exit lives here rather
// than at each call site: a short-lived copy plays the curtain's "carry on
// out the top" over the new screen, then removes itself.
function playLoaderReveal(old) {
  clearTimeout(old._slowTimer);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = document.createElement("div");
  el.className = "wl-loader is-revealing";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div class="wl-loader-sheet wl-loader-color"></div>
    <div class="wl-loader-sheet wl-loader-dark"><div class="wl-loader-logo">${loaderMarkHTML()}<span class="wl-loader-line"></span></div></div>`;
  document.body.appendChild(el);
  // animationend can be skipped (tab in the background) — never leave a
  // full-screen sheet over the app.
  setTimeout(() => el.remove(), 900);
}
new MutationObserver((records) => {
  for (const r of records) {
    for (const n of r.removedNodes) {
      if (n.nodeType === 1 && n.classList.contains("wl-loader") && !app.querySelector(":scope > .wl-loader")) playLoaderReveal(n);
    }
  }
}).observe(app, { childList: true });

function teardownApp() {
  storeReady = false;
  // Signing out and into another account in the same tab is a fresh first
  // open for that account — it gets its own picker and its own welcome toast.
  modePickerShown = false;
  welcomeShown = false;
  pulsedBrands.clear();
  delete app.dataset.shellKey;
  clearPageGuide();
  if (cleanup) { cleanup(); cleanup = null; }
  // The "Mau tur website?" pill (js/tour-offer.js) belongs to the app, not
  // to the pricing / locked / landing screens that replace it.
  document.getElementById("tour-pill")?.remove();
  // Likewise a congratulations page nobody answered: it is offered again
  // the next time this account is open on its paid plan.
  closeThanks();
  import("./announcements.js").then((m) => m.stopAnnouncements()).catch(() => {});
}

function lockedScreenHTML(email) {
  return `
    <div class="auth-shell"><div class="auth-card" style="text-align:center;">
      <div class="brand-mark" style="justify-content:center;margin-bottom:22px;">
        <span class="brand-logo" role="img" aria-label="Wepeka"></span>
        <span class="brand-mark-divider"></span>
        Brandlab
      </div>
      <h1 class="auth-title">${t("app.locked.title")}</h1>
      <p class="page-sub" style="margin:10px 0 22px;">${t("app.locked.body", { email: escapeHtml(email) })}</p>
      <button class="btn btn-secondary btn-block" id="locked-logout">${icon("logout", { size: 15 })}${t("topbar.logout")}</button>
    </div></div>
  `;
}

// Bumped on every boot(): a front page whose module is still downloading
// paints only if nothing else (the login screen, the app) has taken the
// screen since.
let landingToken = 0;
let landingView = null; // js/views/landing.js, once downloaded

async function boot(user) {
  // Signing into another account from an SSO link: the page reloads as soon
  // as that sign-in lands, onto a fresh Firestore client (consumeWepekaToken).
  if (switchingAccount) return;
  const token = ++landingToken;
  if (!user && ssoPending) {
    showLoading();
    return;
  }
  if (!user && subscribedUid !== null) {
    // Someone was signed in here a moment ago — logged out in this tab or
    // another one, or the session ended. Their data must not stay in this
    // tab's memory or in the Firestore cache on disk for whoever comes next:
    // wipe the cache and start over from a clean page.
    teardownApp();
    showLoading();
    await wipeLocalFirestore();
    location.reload();
    return;
  }
  if (!user) {
    teardownApp();
    if (accountUnsub) { accountUnsub(); accountUnsub = null; }
    subscribedUid = null;
    setCachedAccount(null);
    endPaidWait();
    if (payReturn === "success") tellPaidSignedOut();
    payReturn = null;
    // startsWith, not ===, so a query string on the hash (there is none
    // today, but there was historically) still lands on the login screen
    // instead of falling through to the front page.
    if (location.hash.startsWith("#/login")) {
      app.innerHTML = `<main class="view" id="auth-root" style="padding:0;max-width:none;"></main>`;
      renderAuthScreen(document.getElementById("auth-root"));
      return;
    }
    // Everyone else who is not signed in gets the front page: what Brandlab
    // is, the plans, the guide videos (js/views/landing.js). A browser that
    // has signed in before sees "Masuk ke Lab-mu" as its main button instead
    // of being dropped on the login screen. Loaded on demand — signed-in
    // sessions never download it — with the loader up until it arrives;
    // coming back from the login screen it is already here, so no loader.
    if (!landingView) {
      showLoading();
      try {
        landingView = await import("./views/landing.js");
      } catch (err) {
        // The page's own module didn't arrive (a dropped connection): the
        // plans alone, which are already in the main bundle.
        console.warn("[landing] unavailable, showing the plans only", err);
      }
      if (token !== landingToken || lastUser) return; // signed in, or the login screen, meanwhile
    }
    if (!landingView) {
      app.innerHTML = `<main class="view" id="pricing-root" style="padding:0;max-width:none;"></main>`;
      renderPricingScreen(document.getElementById("pricing-root"));
      return;
    }
    app.innerHTML = `<main class="view" id="landing-root" style="padding:0;max-width:none;"></main>`;
    landingView.render(document.getElementById("landing-root"), {
      returning: isPaywallUnlocked(),
      goto: location.hash.startsWith("#/pricing") ? "harga" : null,
    });
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
  // No separate account read first: the listener below delivers the cached
  // copy straight away (persistent cache) and the server's right after.
  await claimLocalCache(user.uid);
  if (subscribedUid !== user.uid) return; // signed out / switched meanwhile
  accountUnsub = subscribeAccount(user.uid, (account) => onAccountChange(user, account));
}

// Fires once immediately with the current account doc, then again live on
// every plan/status change — a Midtrans webhook settling payment or an
// admin deactivating the account both land here without a page refresh.
function onAccountChange(user, account) {
  setCachedAccount(account);
  // Views that show account-bound numbers (AI meter, brand slots) repaint
  // on this instead of waiting for the next navigation.
  window.dispatchEvent(new CustomEvent("account:change"));
  // A checkout paid after Snap closed (bank transfer, VA) shows up here as
  // the webhook's write: GA4 gets its "purchase" then, or on the next boot
  // (js/pending-orders.js). Nothing happens unless an order is remembered.
  checkPendingOrders(user.uid);

  if (isDeactivated(account)) {
    endPaidWait();
    teardownApp();
    app.innerHTML = lockedScreenHTML(user.email || "");
    document.getElementById("locked-logout")?.addEventListener("click", () => logout());
    return;
  }

  const state = accessState(account);
  // Just back from a payment made in another app: a failure is said; a
  // success that the webhook hasn't written yet waits under "setting up"
  // rather than on the plans page (a new buyer has no account for a second
  // or two), and the next snapshot — the webhook's — carries on from here.
  if (payReturn === "failure") toast(t("pricing.pay.error"), "error");
  if (state === "paid") endPaidWait();
  else if (payReturn === "success" && !paidWait) {
    app.innerHTML = ""; // the boot loader would sit over the sheet
    showPayLoading("pricing.pay.settingUp", "pricing.pay.settingUpNote");
    paidWait = setTimeout(() => {
      paidWait = null;
      hidePayLoading();
      toast(t("pricing.pay.pending"));
      if (lastUser?.uid === user.uid) onAccountChange(user, getCachedAccount());
    }, PAID_WAIT_MS);
  }
  payReturn = null;
  if (paidWait) return;
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
      // GA4 "start_trial", once per account, the first time a brand-new
      // trial opens the app (js/trial-start.js). Never waited for.
      trackTrialStart();
      // Very first open of this account: one decision ("who are you?")
      // before anything else — no welcome modal, no tour banner stacked on
      // top of it. Those come back on the next boot as usual; the picker
      // itself never does once a card is chosen (js/mode.js hasChosenMode).
      // onAccountChange re-fires on every accounts/{uid} write, and right
      // after a signup there are several in a row — without this guard a
      // second run would wipe the picker the person is looking at, render a
      // fresh one, and leave the first run awaiting a click on buttons that
      // no longer exist (so its "play the Kenalan video" never ran).
      // Arriving straight at pricing (wepeka.com's /brandlab/connect?to=
      // pricing — a "buy" CTA, or Midtrans's own reviewers) must land on
      // pricing, not on the picker: renderRoute() shows the picker instead
      // the moment they step from pricing into the app itself. Someone who
      // has just paid there doesn't stay on it: congratulations, then the
      // app, as if they had arrived at its front door.
      leavePlansIfThanksDue();
      const firstEverOpen = !hasChosenMode() && !modePickerShown && !location.hash.startsWith("#/pricing");
      if (firstEverOpen) {
        modePickerShown = true;
        app.innerHTML = `<main class="view" id="mode-root" style="padding:0;max-width:none;"></main>`;
        // Someone who just paid is congratulated first, before the welcome video.
        await paidWelcome();
        await playWelcomeVideo();
        await renderModePicker(document.getElementById("mode-root"));
      }
      storeReady = true;
      firstRouteAfterBoot = true;
      // The mode picker and, once, the "Kenalan" explainer video are the
      // only things that ever interrupt a boot — no splash, no banners. The
      // route always paints first (the home hero says what to do next);
      // only a brand-new account then gets the video on top of it, and only
      // the one time (js/guide-videos.js playFirstRunIntro, videoSeen-gated).
      bootHoldsScreen = true;
      const releaseScreen = () => { bootHoldsScreen = false; };
      renderRoute();
      // An account that already knows the app and is now on a paid plan
      // (paid while away, or in another app): the congratulations page goes
      // up with the route, and is that boot's greeting.
      const thanksDue = !firstEverOpen && isPaidWelcomeDue();
      if (thanksDue) paidWelcome();
      let bumper = Promise.resolve();
      if (!welcomeShown) {
        welcomeShown = true;
        const name = (user.displayName || user.email?.split("@")[0] || "").trim().split(/\s+/)[0];
        if (name && !thanksDue) bumper = showWelcomeBumper(name);
      }
      if (firstEverOpen) {
        // "Hi {nama}, welcome to Brandlab" first, then the kenalan video —
        // in that order, never both at once. Someone who already chose "Tur
        // website" on the welcome video gets the tour there instead.
        bumper
          .then(() => (tourAfterPicker(0) ? null : import("./guide-videos.js").then((m) => m.playFirstRunIntro())))
          .catch((e) => console.warn("first-run video unavailable", e))
          .finally(releaseScreen);
      } else {
        // The greeting (or the congratulations page in its place) has the
        // screen until it is gone.
        Promise.all([bumper, thanksDue ? paidWelcome() : null]).finally(releaseScreen);
        // A new account that answered "Sudah paham" keeps its floating
        // "Mau tur website?" pill until the tour is taken or it is closed.
        bumper
          .then(() => import("./tour-offer.js"))
          .then((m) => m.showTourOffer())
          .catch((e) => console.warn("tour offer unavailable", e));
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
    // The plan changed while the app is open — a payment just landed: the
    // congratulations page, over the app rather than over the plans.
    leavePlansIfThanksDue();
    renderRoute();
    paidWelcome();
  }
}

// Bumped on every call so a slow dynamic import from a route the user has
// already navigated away from can't clobber whatever rendered after it —
// only the most recent renderRoute() call is allowed to touch the DOM/set
// cleanup once its import resolves.
let renderToken = 0;
const BRAND_SCOPE_WAIT_MS = 10_000;

// Pemula mode with exactly one brand: the "pick a brand" page is a
// decision with only one answer, so the first route after boot skips it
// and lands straight inside that brand. Only the FIRST route — once the
// user deliberately navigates to "Semua Brand" (to add a second one, say)
// it has to stay put.
let firstRouteAfterBoot = false;
// One mode picker per boot, no matter how many account snapshots land.
let modePickerShown = false;
// One welcome toast per boot (fresh sign-in, SSO hand-off, or a reload that
// resumes a persisted session) — not on every account snapshot re-fire.
let welcomeShown = false;

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
  // Signals are written into the brand's log — computed from the server's
  // copy, never from a cache that may be a day old.
  await whenServerSynced();
  // Sales signals from the whole log, not the part loaded so far.
  if (!isBrandSalesReady(brandId)) await ensureBrandSales(brandId).catch(() => {});
  const brand = getBrand(brandId);
  if (!brand) return;
  try {
    const { computeSignals } = await import("./brand-pulse.js");
    const signals = computeSignals({ brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings() });
    if (signals.length) appendBrandEvents(brandId, signals);
  } catch (e) {
    console.warn("[brand pulse] unavailable", e);
  }
  // Once a month: last month's numbers → lessons kept in brand memory for
  // good (js/brand-learning.js). The app starts it, so it's free for the
  // owner — and never for an ended plan, a demo, or without an AI key.
  try {
    const [{ maybeMonthlyLessons }, { summarizeMonthLessons, hasAiKey }, { accessState }, { isTourDemo }] = await Promise.all([
      import("./brand-learning.js"), import("./ai.js"), import("./account.js"), import("./tour-demo.js"),
    ]);
    const ai = getSettings().ai || {};
    const state = accessState(getCachedAccount());
    await maybeMonthlyLessons(brandId, { ai, summarize: summarizeMonthLessons, allowed: hasAiKey(ai) && (state === "paid" || state === "trial") && !isTourDemo() });
  } catch (e) {
    console.warn("[monthly lessons] unavailable", e);
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

  // A first-ever open that skipped the mode picker at boot (it arrived at
  // pricing) gets it here, the first time it steps into the app proper.
  if (!hasChosenMode() && !modePickerShown) {
    modePickerShown = true;
    app.innerHTML = `<main class="view" id="mode-root" style="padding:0;max-width:none;"></main>`;
    await paidWelcome();
    if (token !== renderToken) return;
    await playWelcomeVideo();
    if (token !== renderToken) return;
    await renderModePicker(document.getElementById("mode-root"));
    if (token !== renderToken) return;
    tourAfterPicker(1200);
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
  // A brand whose monthly slot lapsed is preview-only: every address inside
  // it lands on the locked page (js/brand-locked.js) — no workspace, no
  // chat, nothing to edit — until the slot is renewed.
  if (route.brandId && isBrandLocked(route.brandId, listBrands())) {
    delete app.dataset.shellKey;
    import("./consultant-panel.js").then((m) => m.unmountConsultantPanel()).catch(() => {});
    const { renderLockedBrand } = await import("./brand-locked.js");
    if (token !== renderToken) return;
    cleanup = renderLockedBrand(app, getBrand(route.brandId));
    window.scrollTo(0, 0);
    return;
  }
  if (route.brandId) {
    // A brand's chat threads (and, for a brand using the Sales Tracker, its
    // month docs of sales — in parallel) load per brand (js/store.js
    // watchBrandScope); the page waits for them so every view still reads
    // them synchronously. Uploaded files don't hold the page: they fill in.
    // Instant from the local cache; capped so a dead connection can't hold
    // the page forever.
    await Promise.race([watchBrandScope(route.brandId), new Promise((r) => setTimeout(r, BRAND_SCOPE_WAIT_MS))]);
    if (token !== renderToken) return;
    runPulseOnce(route.brandId);
  }

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
    viewRoot.className = `view view-${route.view} ${route.view === "content-os" || route.view === "chat" ? "wide" : ""}`;
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

  // A view's chunk (dynamic import) or its own render() can both fail — most
  // often a stale service-worker/browser cache asking for a chunk from a
  // deploy that no longer exists, or a flaky connection right after one.
  // Either way this used to leave a blank page under an otherwise-normal
  // shell, with nothing telling the person why. Caught here and painted as
  // a small inline card instead, with a reload button (a fresh page load
  // always gets the current deploy's chunk names).
  let view;
  try {
    view = await (
      {
        home: () => import("./views/home.js"),
        dna: () => import("./views/brand-dna.js"),
        builder: () => import("./views/brand-builder.js"),
        campaigns: () => import("./views/campaigns.js"),
        guidelines: () => import("./views/brand-guidelines.js"),
        sales: () => import("./views/sales.js"),
        chat: () => import("./views/chat.js"),
        announcements: () => import("./views/announcements.js"),
        goals: () => import("./views/goal-roadmap.js"),
        "content-os": () => import("./views/content-os.js"),
        settings: () => import("./views/settings.js"),
      }[route.view] || (() => import("./views/brands.js"))
    )();
  } catch (err) {
    console.error("[route] failed to load", route.view, err);
    noteError(`route-load ${route.view}`, err);
    if (token === renderToken) paintRouteError(viewRoot);
    return;
  }
  if (token !== renderToken) return; // navigated again while this was loading

  try {
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
        cleanup = view.render(viewRoot, { brandId: route.brandId });
        break;
      case "chat":
        cleanup = view.render(viewRoot, { brandId: route.brandId, threadId: route.threadId || null });
        break;
      case "goals":
        cleanup = view.render(viewRoot, { brandId: route.brandId, goalId: route.goalId || null });
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
  } catch (err) {
    console.error("[route] failed to render", route.view, err);
    noteError(`route-render ${route.view}`, err);
    cleanup = null;
    if (token === renderToken) paintRouteError(viewRoot);
    return;
  }
  offerPageVideo(token);
}

function paintRouteError(root) {
  const tx = appErrorText();
  root.innerHTML = `
    <div style="max-width:420px;margin:15vh auto 0;text-align:center;padding:28px 22px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-raised);">
      <h2 style="margin:0 0 8px;font-size:16px;">${escapeHtml(tx.routeTitle)}</h2>
      <p class="text-muted" style="margin:0 0 18px;font-size:13.5px;">${escapeHtml(tx.routeBody)}</p>
      <button type="button" class="btn btn-primary" id="route-error-reload">${escapeHtml(tx.reload)}</button>
      <button type="button" class="btn btn-ghost" id="route-error-report" style="margin-top:8px;">${escapeHtml(t("lapor.fromError"))}</button>
    </div>
  `;
  root.querySelector("#route-error-reload")?.addEventListener("click", () => location.reload());
  // Reloading didn't help? One tap tells the team, with the error attached.
  root.querySelector("#route-error-report")?.addEventListener("click", () => {
    import("./report-problem.js").then((m) => m.openReportProblem({ kind: "bug", source: "error" })).catch((e) => console.warn("report form unavailable", e));
  });
}

// Last-resort net for anything that escapes every other try/catch in the
// app (a store write, an AI call, a chart render — anywhere) — logs it and
// says so once, instead of failing silently or spamming a toast per error
// (a single bug can throw many times in a row, e.g. inside a loop or a
// repeating timer). Cools down after a while so a later, unrelated failure
// still gets its own toast instead of being swallowed forever.
let globalErrorToastAt = 0;
function notifyUnexpectedError(kind, err) {
  console.error(`[${kind}]`, err);
  // Remembered (in memory) so a problem report can say what went wrong.
  noteError(kind, err);
  const now = Date.now();
  if (now - globalErrorToastAt < 15000) return;
  globalErrorToastAt = now;
  toast(appErrorText().genericToast, "error");
}
window.addEventListener("error", (e) => notifyUnexpectedError("error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => notifyUnexpectedError("unhandledrejection", e.reason));

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

// Strings for the account-switch question below — main.js's own, like
// APP_ERROR_TEXT above.
const SSO_TEXT = {
  id: {
    title: "Ganti akun?",
    body: (current, incoming) => `Kamu sedang masuk sebagai <b>${current}</b>. Link dari wepeka.com ini akan memasukkan kamu sebagai <b>${incoming}</b>.`,
    confirm: "Masuk sebagai akun itu",
    cancel: (current) => `Tetap sebagai ${current}`,
  },
  en: {
    title: "Switch accounts?",
    body: (current, incoming) => `You're signed in as <b>${current}</b>. This link from wepeka.com would sign you in as <b>${incoming}</b>.`,
    confirm: "Sign in as that account",
    cancel: (current) => `Stay as ${current}`,
  },
};

// Who a Wepeka token signs in as — without touching this tab's session:
// the token is tried on a throwaway, in-memory Firebase Auth instance (a
// custom token stays valid for its hour, so the real sign-in can reuse it).
async function wepekaTokenIdentity(token) {
  const { app } = await import("./firebase.js");
  const { initializeApp, deleteApp } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js");
  const { initializeAuth, inMemoryPersistence, signInWithCustomToken, signOut } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js");
  const probe = initializeApp(app.options, `sso-probe-${Date.now()}`);
  try {
    const probeAuth = initializeAuth(probe, { persistence: inMemoryPersistence });
    const { user } = await signInWithCustomToken(probeAuth, token);
    const who = { uid: user.uid, email: user.email || user.uid };
    await signOut(probeAuth).catch(() => {});
    return who;
  } finally {
    await deleteApp(probe).catch(() => {});
  }
}

async function consumeWepekaToken() {
  const m = location.hash.match(/^#\/sso\?t=([^&]+)(?:&to=([a-z]+))?(?:&plan=([a-z-]+))?(?:&promo=([A-Za-z0-9]+))?/);
  if (!m) return;
  ssoPending = true;
  const token = decodeURIComponent(m[1]);
  // A "buy" button's plan (wepeka.com passes it through sign-in): kept for
  // the plans page, which opens its checkout as soon as it is on screen.
  // Ignored unless it names a plan; it carries no authority of its own.
  if (m[3]) rememberBuyIntent(m[3]);
  // A Wepeka Community code typed on the Founder's Deal page, carried
  // through sign-in the same way (js/promo-code.js) — for a sign-up that
  // came back in another browser, where the page's own copy isn't.
  if (m[4]) rememberPromo(m[4]);
  // Only "pricing" today — an expired/lapsed account sent back in from
  // /brandlab/connect?to=pricing (wpk-dp) so it lands straight on the
  // pricing screen instead of the locked app shell. No authority on its
  // own; accessState() still decides what actually renders.
  const to = m[2] === "pricing" ? "pricing" : null;
  history.replaceState(null, "", location.pathname + location.search);
  location.hash = "#/";
  try {
    // A token for a DIFFERENT account than the one already signed into this
    // tab is never applied silently (audit S-21: any page could link here
    // with its own token and quietly swap the visitor into the attacker's
    // account). The persisted session is restored first so "already signed
    // in" is known; then the visitor is asked, with both emails shown. No
    // one signed in, or the same account: as frictionless as before.
    await auth.authStateReady?.();
    const current = auth.currentUser;
    const incomingUid = decodeWepekaTokenUid(token);
    if (current && incomingUid !== current.uid) {
      const incoming = await wepekaTokenIdentity(token);
      if (incoming.uid !== current.uid) {
        const tx = SSO_TEXT[getLang() === "en" ? "en" : "id"];
        const currentEmail = escapeHtml(current.email || current.uid);
        const { confirmDialog } = await import("./modals.js");
        const ok = await confirmDialog({
          title: tx.title,
          message: tx.body(currentEmail, escapeHtml(incoming.email)),
          confirmLabel: tx.confirm,
          cancelLabel: tx.cancel(currentEmail),
        });
        if (!ok) return;
        // Tear the current session down before switching, so its store
        // doesn't briefly keep rendering under the new uid — and its
        // Firestore cache is wiped (logout) before the new account signs
        // in. The new account then starts on a freshly loaded page.
        switchingAccount = true;
        teardownApp();
        await logout();
        storeReady = false;
        subscribedUid = null;
      }
    }
    await loginWithWepekaToken(token);
    unlockPaywall();
    if (to === "pricing") location.hash = "#/pricing";
    if (switchingAccount) location.reload();
  } catch (err) {
    console.warn("[sso] Wepeka token rejected", err);
    toast(t("auth.wepeka.failed"), "error");
    location.hash = "#/login";
    // The old account is already signed out and its cache wiped: the login
    // screen comes up on a clean page.
    if (switchingAccount) location.reload();
  } finally {
    ssoPending = false;
    if (!lastUser && !switchingAccount) boot(lastUser);
  }
}
// True once an SSO switch has signed the previous account out (see above):
// boot() stands still until the page reloads for the new account.
let switchingAccount = false;

let lastUser = null;
showLoading();
consumeWepekaToken();
initAnalytics();
initMetaPixel();
window.addEventListener("hashchange", () => {
  if (!lastUser) { boot(lastUser); return; } // toggle pricing <-> login while logged out
  renderRoute();
});
// Guided/Advanced toggle changes which view "home" resolves to — repaint
// the current route immediately instead of waiting for the next navigation.
window.addEventListener("mode:change", () => { if (storeReady) renderRoute(); });
onAuthChange((user) => { lastUser = user; setUser(user?.uid); boot(user); });
