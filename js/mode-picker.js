// First-login choice screen: "who are you?" before anything else. Two big
// cards, one decision, no jargon — the whole point of Pemula mode is that
// a brand owner with zero marketing background never has to figure out
// which of the app's many features to touch first, so the very first
// screen they see can't be a feature grid either.
//
// Renders INTO #app (full screen, like the pricing/login screens), not as
// a modal on top of the app — there's nothing useful behind it yet, and a
// modal invites "close it and see what's under there". Resolves once a
// card is picked; js/main.js then renders the normal route.
import { icon } from "./icons.js";
import { setMode, MODE_LABELS } from "./mode.js";
import { updateSettings } from "./store.js";
import { t } from "./i18n.js";

export function renderModePicker(root) {
  return new Promise((resolve) => {
    root.innerHTML = `
      <div class="mode-pick">
        <div class="mode-pick-inner">
          <div class="brand-mark" style="justify-content:center;margin-bottom:28px;">
            <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
            <span class="brand-mark-divider"></span>
            Brandlab
          </div>
          <h1 class="mode-pick-title">${t("modes.pick.title")}</h1>
          <p class="mode-pick-pitch">${t("intro.pitch")}</p>
          <p class="mode-pick-sub">${t("modes.pick.sub")}</p>
          <div class="mode-pick-grid">
            <button type="button" class="mode-pick-card is-reco" data-mode="guided">
              <span class="mode-pick-badge">${t("modes.pick.badge")}</span>
              <div class="mode-pick-icon">${icon("target", { size: 26 })}</div>
              <h2>${t("modes.pick.guided.title")}</h2>
              <p>${t("modes.pick.guided.body")}</p>
              <span class="mode-pick-cta">${t("modes.pick.cta", { mode: MODE_LABELS.guided.label })}${icon("arrowRight", { size: 14 })}</span>
            </button>
            <button type="button" class="mode-pick-card" data-mode="advanced">
              <div class="mode-pick-icon">${icon("sparkle", { size: 26 })}</div>
              <h2>${t("modes.pick.advanced.title")}</h2>
              <p>${t("modes.pick.advanced.body")}</p>
              <span class="mode-pick-cta">${t("modes.pick.cta", { mode: MODE_LABELS.advanced.label })}${icon("arrowRight", { size: 14 })}</span>
            </button>
          </div>
        </div>
      </div>
    `;
    root.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setMode(btn.dataset.mode);
        // This screen already carries the intro pitch above the cards, so
        // the welcome modal never needs to repeat it right after — same
        // effect as having "seen" it.
        try {
          updateSettings({ introSeenAt: new Date().toISOString() });
        } catch (e) {
          console.warn("Could not save introSeenAt", e);
        }
        resolve(btn.dataset.mode);
      });
    });
  });
}
