// Shared plumbing for the "belajar sambil ngerjain" page guides (Creator,
// Kalender, Campaign). Each guide is a separate spotlight tour scoped to one
// route; they are chained by a small "lanjut ke …?" modal that stores which
// tour the next page should start (sessionStorage), since a route change
// always tears the current tour down.
import { runSpotlightTour, isTourActive, tourRichText } from "../tour.js";
import { maybeShowSectionTour, guideSeen, markGuideSeen } from "../section-guide.js";
import { openModal, closeOverlay } from "../modals.js";
import { listBrands } from "../store.js";
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml, toast } from "../dom.js";
import { getCachedAccount, isReadOnly } from "../account.js";
import { readFlag } from "../seen-flags.js";
import { t } from "../i18n.js";

const SEEN_PREFIX = "contentos:guide-seen:";
const PENDING_KEY = "contentos:start-tour";

// sessionStorage only — the one-tab handoff for "start this tour on the next
// page". The long-lived "already seen" marks live on the account, mirrored
// per-uid in localStorage by js/seen-flags.js.
function store() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Whether a guide has been shown/finished before (drives the chain offers:
// "offer Campaign after Kalender if they haven't had it"). Stored on the
// account via section-guide's guideSeen, namespaced "tour:<key>" so it never
// collides with the autoplay flags of the same page.
export function tourSeen(key) {
  return guideSeen(`tour:${key}`) || readFlag(SEEN_PREFIX, key);
}

export function markTourSeen(key) {
  markGuideSeen(`tour:${key}`);
}

export function setPendingTour(key) {
  try {
    store()?.setItem(PENDING_KEY, key);
  } catch {
    /* ignore */
  }
}

// Only clears when the pending flag is still the one this caller set, so a
// guide closing late never wipes a flag another page just requested.
export function clearPendingTour(key) {
  try {
    const s = store();
    if (!s) return;
    if (!key || s.getItem(PENDING_KEY) === key) s.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

// Called once when a page mounts: true (and the flag is removed) when the
// previous page asked for this tour to start here.
export function consumePendingTour(key) {
  try {
    const s = store();
    if (!s || s.getItem(PENDING_KEY) !== key) return false;
    s.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

// A guide never starts underneath an open modal/drawer/teleprompter (the
// cadence setup modal Content OS opens on a brand's first visit would sit
// between the spotlight and the button it points at, swallowing the click),
// nor on top of another tour that's still running. Resolves false when the
// user navigated away before the page went quiet.
export function waitForIdle(hash = location.hash) {
  return new Promise((resolve) => {
    const check = () => {
      if (location.hash !== hash) return resolve(false), true;
      if (!qs(".overlay") && !qs(".tp-overlay") && !isTourActive()) return resolve(true), true;
      return false;
    };
    if (check()) return;
    const id = setInterval(() => {
      if (check()) clearInterval(id);
    }, 300);
  });
}

// Mount-time entry: a pending chain request starts the tour in either mode;
// otherwise, when `autoplay` is true, it autoplays once, Guided only
// (section-guide's seen flag under `autoplayKey`). `build` is called at
// start time so steps read fresh data.
// `autoplay: false` (Kalender, Campaign) keeps only the forced path — the
// tour still opens from the pending-tour chain or the Panduan button
// (wireGuideButton), it just never pops up on its own when the page mounts.
export async function startGuideOnMount({ pendingKey, autoplayKey, build, options, autoplay = true }) {
  const forced = consumePendingTour(pendingKey);
  const hash = location.hash;
  // Let the page finish its first paint (and any modal it opens on mount)
  // before deciding the page is idle.
  await new Promise((r) => setTimeout(r, 200));
  if (!(await waitForIdle(hash))) {
    if (forced) setPendingTour(pendingKey);
    return;
  }
  if (forced) runSpotlightTour(build(), options);
  else if (autoplay) maybeShowSectionTour(autoplayKey, build(), options);
}

// Button half: the always-visible "Panduan" pill (sectionGuideButtonHTML)
// replays the guide in either mode, building steps at click time.
export function wireGuideButton(root, key, start) {
  qs(`[data-section-guide-btn="${key}"]`, root)?.addEventListener("click", () => start());
}

// Akun readonly (lapsed plan) can open every guide, but a step that needs a
// write (save, check, drag) can never be completed — make those skippable
// and say why, instead of leaving the user stuck on a gate.
export function adaptForAccount(steps) {
  if (!isReadOnly(getCachedAccount())) return steps;
  return steps.map((s) => (s.write && s.interactive ? { ...s, skippable: true, hint: t("guide.readOnlyHint") } : s));
}

function closingModal({ title, body, footHTML }) {
  return openModal({
    title,
    bodyHTML: `<p class="text-muted" style="font-size:13.5px;line-height:1.6;margin:0;">${tourRichText(body)}</p>`,
    footHTML,
  });
}

// End-of-tour offer to continue with the next guide on another page.
export function offerNextTour({ title, body, ctaLabel, hash, startKey, dismissLabel = t("common.later") }) {
  const overlay = closingModal({
    title,
    body,
    footHTML: `
      <button class="btn btn-secondary" data-tour-offer-dismiss>${escapeHtml(dismissLabel)}</button>
      <button class="btn btn-primary" data-tour-offer-go>${escapeHtml(ctaLabel)}${icon("arrowRight", { size: 14 })}</button>
    `,
  });
  qs("[data-tour-offer-dismiss]", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("[data-tour-offer-go]", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    setPendingTour(startKey);
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  });
  return overlay;
}

// End-of-tour recap when there's nothing to chain to.
export function showTourRecap({ title, body }) {
  const overlay = closingModal({ title, body, footHTML: `<button class="btn btn-primary" data-tour-recap-ok>${t("guide.recapOk")}</button>` });
  qs("[data-tour-recap-ok]", overlay).addEventListener("click", () => closeOverlay(overlay));
  return overlay;
}

// Settings → Akun: guides live on brand pages, so pick a brand first when
// there's more than one.
export function replayGuideForBrand({ startKey, path }) {
  const brands = listBrands();
  const go = (brandId) => {
    setPendingTour(startKey);
    const hash = path(brandId);
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = hash;
  };
  if (!brands.length) {
    toast(t("guide.needBrand"), "error");
    return;
  }
  if (brands.length === 1) {
    go(brands[0].id);
    return;
  }
  const overlay = openModal({
    title: t("guide.pickBrand.title"),
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 12px;">${t("guide.pickBrand.sub")}</p>
      <div class="flex" style="flex-direction:column;gap:8px;">
        ${brands.map((b) => `<button type="button" class="btn btn-secondary" data-guide-brand="${escapeHtml(b.id)}" style="justify-content:flex-start;">${escapeHtml(b.name || t("guide.noName"))}</button>`).join("")}
      </div>
    `,
  });
  qsa("[data-guide-brand]", overlay).forEach((btn) =>
    btn.addEventListener("click", () => {
      closeOverlay(overlay);
      go(btn.dataset.guideBrand);
    })
  );
}
