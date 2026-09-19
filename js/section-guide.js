// Per-page guidance registry. A view that has a spotlight walkthrough
// registers it here in render() (`setPageGuide(() => runSpotlightTour(steps))`
// or `setPageGuide(() => startCreatorGuide(brandId))`); the topbar's "?"
// popover (js/layout.js helpMenuHTML) shows a "Panduan halaman ini" row
// while one is registered. main.js clears the registry on every route
// change, so a page that doesn't register simply has no such row.
//
// Nothing here ever starts a tour on its own — the only auto-interruption
// left in the app is the first-run mode picker (js/mode-picker.js).
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";

const SEEN_KEY_PREFIX = "contentos:section-guide-seen:";

let pageGuide = null;

export function setPageGuide(start) {
  pageGuide = typeof start === "function" ? start : null;
}

export function clearPageGuide() {
  pageGuide = null;
}

export function getPageGuide() {
  return pageGuide;
}

// "Already seen" lives on the account (settings.guideSeen, Firestore) as
// well as in this browser, so the chained page guides (js/guides/common.js
// tourSeen) know on every device which tours a person has already taken.
// Readonly accounts can't write settings, so for them it stays browser-local.
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
