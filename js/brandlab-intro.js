// One-time-ever welcome modal explaining what Wepeka Brandlab is. Gated on
// `settings.introSeenAt` (follows the account to any device), set the
// moment the modal closes — by any of its own buttons, the header's ✕, the
// backdrop, or Esc. Pass `{ force: true }` to show it again on purpose (FAB
// Panduan → "Kenalan dari awal"); that also refreshes `introSeenAt`.
//
// Until the onboarding tour has been taken it also recommends the tour,
// with the tour as the primary button — Brandlab has a lot of features and
// people who skipped it got lost. "Nanti aja" just closes the modal; this
// is the only tour invitation left (2.3), so there's nothing further to
// hand off to.
//
// No video in here any more: the "Kenalan sama Brandlab" explainer plays on
// its own right after the mode picker, once per account (js/guide-videos.js
// maybeAutoPlayVideo), and the FAB's "Tonton video" replays it. A copy
// embedded in this modal — let alone one gating the buttons — would just be
// the same video a second time.
import { openModal, closeOverlay } from "./modals.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { startOnboardingTour } from "./tour.js";
import { getSettings, updateSettings } from "./store.js";

function markIntroSeen() {
  try {
    updateSettings({ introSeenAt: new Date().toISOString() });
  } catch (e) {
    // Offline or a read-only account — worst case it shows again next time.
    console.warn("Could not save introSeenAt", e);
  }
}

export function maybeShowBrandlabIntro({ offerTour = false, force = false } = {}) {
  if (!force && getSettings()?.introSeenAt) return;

  // Just the pitch + buttons — the trademark-check note and the DNA/
  // Guidelines feature rows were cut (2.2): one screen, one message.
  const textHTML = `<p class="intro-pitch">${t("intro.pitch")}</p>`;

  const overlay = openModal({
    title: t("intro.title"),
    wide: true,
    bodyHTML: `
      ${textHTML}
      ${
        offerTour
          ? `<div class="intro-tour-offer">
               ${icon("sparkle", { size: 18 })}
               <div><b>${t("intro.tourTitle")}</b><span>${t("intro.tourBody")}</span></div>
             </div>`
          : ""
      }
    `,
    footHTML: offerTour
      ? `<button class="btn btn-secondary" data-later>${t("common.later")}</button>
         <button class="btn btn-primary" data-tour>${icon("play", { size: 14 })}${t("intro.tourCta")}</button>`
      : `<button class="btn btn-primary" data-ok>${t("intro.ok")}</button>`,
  });

  overlay.querySelector("[data-ok]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-tour]")?.addEventListener("click", () => {
    closeOverlay(overlay);
    startOnboardingTour();
  });
  overlay.querySelector("[data-later]")?.addEventListener("click", () => closeOverlay(overlay));

  // "Closed by any button" also covers the ✕ header button, the backdrop,
  // and Esc — all wired inside openModal() itself, so this listens for the
  // same triggers in parallel instead of duplicating that plumbing here.
  let seenMarked = false;
  const markOnce = () => {
    if (seenMarked) return;
    seenMarked = true;
    markIntroSeen();
  };
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) markOnce();
  });
  overlay.querySelector("[data-close]")?.addEventListener("click", markOnce);
  overlay.querySelectorAll("[data-ok], [data-tour], [data-later]").forEach((b) => b.addEventListener("click", markOnce));
  document.addEventListener("keydown", function escSeen(e) {
    if (e.key === "Escape") {
      markOnce();
      document.removeEventListener("keydown", escSeen);
    }
  });
}
