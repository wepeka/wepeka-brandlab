// Generic overlay helpers. Overlays mount to document.body (siblings of
// #app) so a background store-driven rerender never yanks them away mid-edit.
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { qsa, escapeHtml } from "./dom.js";

// Accessibility plumbing shared by openModal/openDrawer: each overlay is a
// dialog (role="dialog", aria-modal, aria-labelledby pointing at its own
// title), gets initial focus, traps Tab/Shift+Tab inside itself, and hands
// focus back to whatever had it before opening. Several overlays can be
// stacked (e.g. a confirmDialog on top of a drawer) — this stack is what
// makes Escape close only the topmost one, and what makes sure every close
// path (✕, backdrop click, requestClose, a bare closeOverlay() call from any
// of the ~80 call sites across the app) tears its own listener down instead
// of leaking it (the old code only removed the Escape listener when Escape
// itself was pressed, so a still-open earlier modal's leaked listener would
// also fire and close it on the next Escape meant for something else).
let overlaySeq = 0;
const overlayStack = []; // { el, dialogEl, keyHandler, previousFocus }

function focusableIn(container) {
  return qsa(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    container
  ).filter((el) => el.getClientRects().length > 0);
}

function activateOverlayA11y(overlay, dialogEl) {
  const previousFocus = document.activeElement;
  const keyHandler = (e) => {
    const isTop = overlayStack[overlayStack.length - 1]?.el === overlay;
    if (e.key === "Escape") {
      if (!isTop) return; // only the topmost overlay reacts to Escape
      e.stopPropagation();
      closeOverlay(overlay);
    } else if (e.key === "Tab" && isTop) {
      const focusable = focusableIn(dialogEl);
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", keyHandler);
  overlayStack.push({ el: overlay, dialogEl, keyHandler, previousFocus });
  const first = focusableIn(dialogEl)[0];
  (first || dialogEl).focus?.();
}

function deactivateOverlayA11y(overlay) {
  const idx = overlayStack.findIndex((o) => o.el === overlay);
  if (idx === -1) return;
  const { previousFocus, keyHandler } = overlayStack[idx];
  document.removeEventListener("keydown", keyHandler);
  overlayStack.splice(idx, 1);
  if (previousFocus && document.body.contains(previousFocus)) previousFocus.focus?.();
}

export function closeOverlay(el) {
  deactivateOverlayA11y(el);
  el.remove();
}

export function openModal({ title, bodyHTML, footHTML = "", onMount, wide = false, width }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay center";
  const titleId = `modal-title-${++overlaySeq}`;
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" style="${width ? `width:${width};` : wide ? "width:min(640px,92vw)" : ""}">
      <div class="drawer-head">
        <h2 id="${titleId}">${title}</h2>
        <button class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x", { size: 16 })}</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  const dialogEl = overlay.querySelector(".modal");
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeOverlay(overlay);
  });
  overlay.querySelector("[data-close]").addEventListener("click", () => closeOverlay(overlay));
  activateOverlayA11y(overlay, dialogEl);
  if (onMount) onMount(overlay);
  return overlay;
}

// `isDirty` (optional): when it returns true, closing without saving (✕,
// clicking outside, or overlay.requestClose() from a Cancel button) asks
// first instead of silently throwing the typing away.
export function openDrawer({ title, bodyHTML, footHTML = "", onMount, isDirty }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const titleId = `modal-title-${++overlaySeq}`;
  overlay.innerHTML = `
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
      <div class="drawer-head">
        <h2 id="${titleId}">${title}</h2>
        <button class="icon-btn" data-close aria-label="${t("common.close")}">${icon("x", { size: 16 })}</button>
      </div>
      <div class="drawer-body">${bodyHTML}</div>
      ${footHTML ? `<div class="drawer-foot">${footHTML}</div>` : ""}
    </div>
  `;
  document.body.appendChild(overlay);
  const dialogEl = overlay.querySelector(".drawer");
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
  activateOverlayA11y(overlay, dialogEl);
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

// `title` and `label` are markup, like every other dialog's (callers escape
// user text in them); `placeholder` and `value` are plain text — often the
// owner's own data, e.g. a milestone target or a font name — and go into
// attributes, so they are always escaped here (audit S-20).
export function promptDialog({ title, label, placeholder = "", value = "", confirmLabel = t("common.save") }) {
  return new Promise((resolve) => {
    const overlay = openModal({
      title,
      bodyHTML: `
        <div class="field" style="margin-bottom:0;">
          <label>${label}</label>
          <input class="input" id="prompt-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
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
