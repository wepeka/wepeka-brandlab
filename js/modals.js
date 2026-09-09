// Generic overlay helpers. Overlays mount to document.body (siblings of
// #app) so a background store-driven rerender never yanks them away mid-edit.
import { icon } from "./icons.js";

export function closeOverlay(el) {
  el.remove();
}

export function openModal({ title, bodyHTML, footHTML = "", onMount, wide = false }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay center";
  overlay.innerHTML = `
    <div class="modal" style="${wide ? "width:min(640px,92vw)" : ""}">
      <div class="drawer-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-close aria-label="Close">${icon("x", { size: 16 })}</button>
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

export function openDrawer({ title, bodyHTML, footHTML = "", onMount }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-close aria-label="Close">${icon("x", { size: 16 })}</button>
      </div>
      <div class="drawer-body">${bodyHTML}</div>
      ${footHTML ? `<div class="drawer-foot">${footHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeOverlay(overlay);
  });
  overlay.querySelector("[data-close]").addEventListener("click", () => closeOverlay(overlay));
  if (onMount) onMount(overlay);
  return overlay;
}

export function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const overlay = openModal({
      title,
      bodyHTML: `<p class="text-muted" style="margin:0;font-size:13.5px;">${message}</p>`,
      footHTML: `
        <button class="btn btn-secondary" data-cancel>Cancel</button>
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

export function promptDialog({ title, label, placeholder = "", value = "", confirmLabel = "Save" }) {
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
        <button class="btn btn-secondary" data-cancel>Cancel</button>
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
