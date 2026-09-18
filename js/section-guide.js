// Per-section contextual guidance — a short (1-3 step) spotlight walkthrough
// that plays automatically the FIRST time a Guided-mode user opens a major
// section (Content OS, Brand Builder, Campaigns), so the mode toggle has a
// felt effect everywhere in the app, not just on Home. Reuses tour.js's
// existing generic spotlight engine instead of a new overlay component —
// this is deliberately NOT the same thing as the one-time global onboarding
// tour (js/tour.js's startOnboardingTour, offered via a prompt banner) or
// the silent "?" help icons (js/help.js) — it's the middle layer: short,
// automatic, but scoped to one section and shown only once ever.
import { runSpotlightTour } from "./tour.js";
import { getMode } from "./mode.js";
import { icon } from "./icons.js";
import { qs } from "./dom.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { guideVideoButtonHTML } from "./guide-videos.js";
import { t } from "./i18n.js";

const SEEN_KEY_PREFIX = "contentos:section-guide-seen:";

// "Already seen" lives on the account (settings.guideSeen, Firestore) as
// well as in this browser, so someone who already had a page's tour never
// gets it auto-played again on another device or after clearing storage —
// from then on it only plays when they press Panduan. Readonly accounts
// can't write settings, so for them it stays browser-local.
export function guideSeen(key) {
  const onAccount = !!getSettings()?.guideSeen?.[key];
  const local = readFlag(SEEN_KEY_PREFIX, key);
  // Seen in this browser before the flag moved to the account: copy it up
  // once (deferred, never mid-render) so other devices respect it too.
  if (local && !onAccount) queueMicrotask(() => markGuideSeen(key));
  return local || onAccount;
}

export function markGuideSeen(key) {
  writeFlag(SEEN_KEY_PREFIX, key);
  const seen = getSettings()?.guideSeen || {};
  if (seen[key] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen, [key]: Date.now() } });
}

const hasSeenSection = guideSeen;
const markSectionSeen = markGuideSeen;

// Call once from a section's render(), after its DOM is painted. No-op in
// Advanced mode, and no-op after the first time it's actually shown — this
// is the quiet, automatic half. The other half is the always-visible button
// below, so the guide is never a one-shot someone can miss and lose access
// to (same "click here for the guide, anytime" pattern as wepeka.com's own
// compass-icon banner).
export function maybeShowSectionTour(key, steps, options) {
  if (getMode() !== "guided") return;
  if (hasSeenSection(key)) return;
  // A fresh section's DOM may still be settling (images/avatars) — a tiny
  // delay avoids spotlighting the wrong position on the very first frame.
  // Only counts as "seen" if the guide actually got to play — when the
  // onboarding tour is mid-flight, runSpotlightTour declines and this
  // section keeps its one-time guide for the next visit.
  setTimeout(() => {
    if (runSpotlightTour(steps, options)) markSectionSeen(key);
  }, 150);
}

// A persistent, always-clickable "Guide" button — replay this section's
// walkthrough on demand, in either mode, as many times as wanted. Pair with
// wireSectionGuideButton(root, key, steps) after the button's HTML is in the
// DOM.
export function sectionGuideButtonHTML(key) {
  // Icon + a visible label, not an icon-only circle — a hover-only title
  // attribute is too easy to miss (same discoverability problem as the
  // original silent onboarding tour this section-guide system replaced).
  // Wrapped with the page's "Video" button (js/guide-videos.js) so it stays
  // one flex child wherever a page places it.
  return `<span class="section-guide-actions"><button type="button" class="section-guide-btn" data-section-guide-btn="${key}" title="${t("guide.btnTitle")}" aria-label="${t("guide.btn")}">${icon("target", { size: 14 })}<span>${t("guide.btn")}</span></button>${guideVideoButtonHTML(key)}</span>`;
}

export function wireSectionGuideButton(root, key, steps) {
  qs(`[data-section-guide-btn="${key}"]`, root)?.addEventListener("click", () => runSpotlightTour(steps));
}
