// "Masih belum paham? Mau tur website?" — the floating pill a brand-new
// account is left with after its autoplay video.
//
// That video (js/guide-videos.js playFirstRunIntro) ends on three answers,
// and "Sudah paham" is one tap. From then on the tour lives only in the ⋯
// menu, which someone who pressed it too fast has never opened. So that
// answer leaves this pill behind, bottom-left: one tap starts the website
// tour from wherever they are.
//
// Three states, kept like every other "seen once" mark (account first,
// browser as a mirror, js/seen-flags.js):
//   armed   — the first-run video opened. Nothing on screen yet.
//   shown   — the video closed without the tour: the pill is up, and comes
//             back on every boot (a reload mid-video counts too).
//   retired — the website tour started, from here or from anywhere else
//             (js/tour.js startOnboardingTour), or the pill's own ✕ was
//             pressed. The ✕ points at the ⋯ menu, where the tour stays.
import { icon } from "./icons.js";
import { toast, showCalloutBubble } from "./dom.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { t } from "./i18n.js";

const LOCAL_PREFIX = "contentos:tour-offer:";
const ARMED_KEY = "tour:offer";
const RETIRED_KEY = "tour:offer-closed";
const PILL_ID = "tour-pill";

const seen = () => getSettings()?.guideSeen || {};
const armed = () => !!seen()[ARMED_KEY] || readFlag(LOCAL_PREFIX, "armed");
const retired = () => !!seen()[RETIRED_KEY] || readFlag(LOCAL_PREFIX, "retired");

function mark(accountKey, localKey) {
  writeFlag(LOCAL_PREFIX, localKey);
  if (seen()[accountKey] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen(), [accountKey]: Date.now() } });
}

// True while the pill is owed to this account.
export const tourOfferDue = () => armed() && !retired();

export function armTourOffer() {
  if (!armed()) mark(ARMED_KEY, "armed");
}

function unmount() {
  if (typeof document !== "undefined") document.getElementById(PILL_ID)?.remove();
}

// Called by the tour itself, so the pill goes for good however the tour was
// reached. An account that was never offered the pill is left untouched.
export function retireTourOffer() {
  unmount();
  if (armed() && !retired()) mark(RETIRED_KEY, "retired");
}

// Puts the pill on screen when it is due. Safe to call on every boot.
export function showTourOffer() {
  if (typeof document === "undefined" || !tourOfferDue() || document.getElementById(PILL_ID)) return null;
  const el = document.createElement("div");
  el.id = PILL_ID;
  el.className = "tour-pill";
  el.innerHTML = `
    <button type="button" class="tour-pill-main" data-tp="go">
      <span class="tour-pill-ico" aria-hidden="true">${icon("compass", { size: 18 })}</span>
      <span class="tour-pill-text"><b>${t("tour.offer.title")}</b><span>${t("tour.offer.sub")}</span></span>
    </button>
    <button type="button" class="tour-pill-x" data-tp="close" title="${t("common.close")}" aria-label="${t("common.close")}">${icon("x", { size: 12 })}</button>`;
  el.addEventListener("click", (e) => {
    const what = e.target instanceof Element ? e.target.closest("[data-tp]")?.dataset.tp : null;
    if (!what) return;
    retireTourOffer();
    if (what === "go") {
      import("./tour.js").then((m) => m.startOnboardingTour()).catch((err) => console.warn("[tour] unavailable", err));
      return;
    }
    // Closed without taking it: say where the tour lives from now on.
    const menuBtn = document.getElementById("app-menu-btn");
    const text = t("tour.offer.where");
    if (menuBtn?.getClientRects().length) showCalloutBubble(menuBtn, text);
    else toast(text);
  });
  document.body.appendChild(el);
  return el;
}
