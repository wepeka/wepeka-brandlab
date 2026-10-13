// The wait between pressing a pay button and the payment window: checking
// the account, loading Midtrans, opening the transaction takes a second or
// three, and without this the page just sat there as if nothing had been
// pressed. One full-screen sheet, also used while a signed-out visitor's
// "buy" click travels to wepeka.com to sign in. It blocks a second click
// (a second checkout) until it is taken down.
import { t } from "./i18n.js";

let sheet = null;

export function showPayLoading(titleKey = "pricing.pay.preparing", noteKey = "pricing.pay.preparingNote") {
  if (typeof document === "undefined" || !document.body) return;
  if (!sheet || sheet.isConnected === false) {
    sheet = document.createElement("div");
    sheet.className = "pay-loading";
    sheet.setAttribute("role", "status");
    sheet.setAttribute("aria-live", "polite");
    document.body.appendChild(sheet);
  }
  sheet.innerHTML = `
    <div class="pay-loading-card">
      <span class="pay-loading-ring" aria-hidden="true"></span>
      <strong>${t(titleKey)}</strong>
      <span>${t(noteKey)}</span>
    </div>`;
}

export function hidePayLoading() {
  sheet?.remove();
  sheet = null;
}

// Midtrans Snap draws its own window (an iframe) a moment after it is asked
// to: the sheet stays until that window is there, never longer than a few
// seconds — Snap sits above it either way.
export function hidePayLoadingWhenSnapShows(maxMs = 6000) {
  const startedAt = Date.now();
  const tick = () => {
    const frame = document.querySelector?.("iframe#snap-midtrans");
    const showing = frame && frame.style.display !== "none" && frame.offsetHeight > 0;
    if (showing || Date.now() - startedAt > maxMs) {
      // Snap fades in: don't flash the page between the two.
      setTimeout(hidePayLoading, showing ? 350 : 0);
      return;
    }
    setTimeout(tick, 120);
  };
  tick();
}
