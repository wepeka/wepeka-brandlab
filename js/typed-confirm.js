// A confirm for the few things that can't be undone (Pengaturan → Data →
// "Reset semua data"): the red button only wakes up once the owner has
// typed the word shown (HAPUS), so one stray tap on "Yakin?" can't wipe an
// account. Resolves true when confirmed, false when cancelled or closed.
import { openModal, closeOverlay } from "./modals.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";

// Case and surrounding spaces don't matter: "hapus " still counts.
export function typedWordMatches(typed, word) {
  return String(typed || "").trim().toUpperCase() === String(word || "").trim().toUpperCase();
}

export function typedConfirmDialog({ title, message = "", word, prompt = "", confirmLabel }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value, overlay) => {
      if (done) return;
      done = true;
      closeOverlay(overlay);
      resolve(value);
    };
    const overlay = openModal({
      title,
      bodyHTML: `
        ${message ? `<p class="text-muted" style="margin:0 0 14px;font-size:13.5px;">${message}</p>` : ""}
        <div class="field" style="margin-bottom:0;">
          <label for="typed-confirm-input">${prompt}</label>
          <input class="input" id="typed-confirm-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${escapeHtml(word)}" />
        </div>
      `,
      footHTML: `
        <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
        <button class="btn btn-danger" data-confirm disabled>${confirmLabel}</button>
      `,
      onMount: (el) => setTimeout(() => el.querySelector("#typed-confirm-input")?.focus(), 30),
    });
    const input = overlay.querySelector("#typed-confirm-input");
    const confirm = overlay.querySelector("[data-confirm]");
    input.addEventListener("input", () => {
      confirm.disabled = !typedWordMatches(input.value, word);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !confirm.disabled) finish(true, overlay);
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => finish(false, overlay));
    confirm.addEventListener("click", () => {
      if (!confirm.disabled) finish(true, overlay);
    });
    // Closed another way (✕, Escape, backdrop): treat as cancel.
    new MutationObserver((_, obs) => {
      if (!overlay.isConnected) {
        obs.disconnect();
        if (!done) { done = true; resolve(false); }
      }
    }).observe(document.body, { childList: true });
  });
}
