// Generic overlay helpers. Overlays mount to document.body (siblings of
// #app) so a background store-driven rerender never yanks them away mid-edit.
import { icon } from "./icons.js";
import { t } from "./i18n.js";

export function closeOverlay(el) {
  el.remove();
}

export function openModal({ title, bodyHTML, footHTML = "", onMount, wide = false, width }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay center";
  overlay.innerHTML = `
    <div class="modal" style="${width ? `width:${width};` : wide ? "width:min(640px,92vw)" : ""}">
      <div class="drawer-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeOverlay(overlay);
  });
  overlay.querySelector("[data-close]").addEventListener("click", () => closeOverlay(overlay));
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      closeOverlay(overlay);
      document.removeEventListener("keydown", esc);
    }
  });
  if (onMount) onMount(overlay);
  return overlay;
}

// `isDirty` (optional): when it returns true, closing without saving (✕,
// clicking outside, or overlay.requestClose() from a Cancel button) asks
// first instead of silently throwing the typing away.
export function openDrawer({ title, bodyHTML, footHTML = "", onMount, isDirty }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x", { size: 16 })}</button>
      </div>
      <div class="drawer-body">${bodyHTML}</div>
      ${footHTML ? `<div class="drawer-foot">${footHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.requestClose = async () => {
    if (isDirty?.()) {
      const ok = await confirmDialog({ title: t("app.unsaved.title"), message: t("app.unsaved.message"), confirmLabel: t("app.unsaved.discard"), cancelLabel: t("app.unsaved.keep"), danger: true });
      if (!ok) return;
    }
    closeOverlay(overlay);
  };
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.requestClose();
  });
  overlay.querySelector("[data-close]").addEventListener("click", () => overlay.requestClose());
  if (onMount) onMount(overlay);
  return overlay;
}

export function confirmDialog({ title = t("app.confirm.title"), message = "", confirmLabel = t("app.confirm.cta"), cancelLabel = t("common.cancel"), danger = false }) {
  return new Promise((resolve) => {
    const overlay = openModal({
      title,
      bodyHTML: `<p class="text-muted" style="margin:0;font-size:13.5px;">${message}</p>`,
      footHTML: `
        <button class="btn btn-secondary" data-cancel>${cancelLabel}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${confirmLabel}</button>
      `,
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => {
      closeOverlay(overlay);
      resolve(false);
    });
    overlay.querySelector("[data-confirm]").addEventListener("click", () => {
      closeOverlay(overlay);
      resolve(true);
    });
  });
}

export function promptDialog({ title, label, placeholder = "", value = "", confirmLabel = t("common.save") }) {
  return new Promise((resolve) => {
    const overlay = openModal({
      title,
      bodyHTML: `
        <div class="field" style="margin-bottom:0;">
          <label>${label}</label>
          <input class="input" id="prompt-input" placeholder="${placeholder}" value="${value.replace(/"/g, "&quot;")}" />
        </div>
      `,
      footHTML: `
        <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
        <button class="btn btn-primary" data-confirm>${confirmLabel}</button>
      `,
      onMount: (el) => {
        const input = el.querySelector("#prompt-input");
        setTimeout(() => input.focus(), 30);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") el.querySelector("[data-confirm]").click();
        });
      },
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => {
      closeOverlay(overlay);
      resolve(null);
    });
    overlay.querySelector("[data-confirm]").addEventListener("click", () => {
      const val = overlay.querySelector("#prompt-input").value.trim();
      closeOverlay(overlay);
      resolve(val || null);
    });
  });
}
