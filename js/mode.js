// Two-state experience mode, persisted account-wide via Firestore settings
// (js/store.js) rather than per-device localStorage like js/theme.js — the
// point is a brand owner sees the same mode on every device, unlike theme
// which is a per-screen preference.
//
// Internal keys stay "guided" / "advanced" (they're stored in every
// account's settings doc and checked all over the views). What the user
// SEES is "Pemula" / "Pro" — see MODE_LABELS. Anything that isn't an
// explicit "advanced" (including a settings doc written before this field
// existed) resolves to guided — the safe default for someone who has never
// seen the app before.
import { getSettings, updateSettings } from "./store.js";
import { t } from "./i18n.js";

export const MODE_LABELS = {
  guided: { label: t("mode.guided.name"), tagline: t("modes.guided.tagline") },
  advanced: { label: t("mode.advanced.name"), tagline: t("modes.advanced.tagline") },
};

export function getMode() {
  return getSettings().experienceMode === "advanced" ? "advanced" : "guided";
}

// Has this account ever picked a mode on purpose? Either through the
// first-login picker (js/mode-picker.js) or the topbar toggle. An account
// that explicitly sits on "advanced" has obviously toggled at some point,
// so it counts as chosen even without the flag (older settings docs).
export function hasChosenMode() {
  const s = getSettings();
  return s.experienceModeChosen === true || s.experienceMode === "advanced";
}

export function setMode(mode) {
  updateSettings({ experienceMode: mode, experienceModeChosen: true });
  window.dispatchEvent(new CustomEvent("mode:change"));
}

export function toggleMode() {
  const next = getMode() === "guided" ? "advanced" : "guided";
  setMode(next);
  return next;
}
