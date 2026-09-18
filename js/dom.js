import { icon } from "./icons.js";
import { t, getLang } from "./i18n.js";

// Number/date formatting follows the app language, not the browser locale.
const locale = () => (getLang() === "en" ? "en-US" : "id-ID");

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Exact figures with thousand separators — never abbreviated to K/M, so a
// number here always matches what you'd see counting it out on Instagram.
export function formatNumber(n) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(locale());
}

export function formatPercent(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toFixed(digits) + "%";
}

export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(locale(), { month: "short", day: "numeric", year: "numeric", ...opts });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function initials(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Everything gets stored as a data URL inside one localStorage slot (5-10MB
// browser cap, shared across all brands). A couple of full-resolution phone
// photos can fill that on their own, so every image upload is downscaled
// through a canvas first — this is what keeps that quota from being hit.
export function resizeImageFile(file, { maxDimension = 800, quality = 0.85, format } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const outFormat = format || (file.type === "image/png" ? "image/png" : "image/jpeg");
        resolve(canvas.toDataURL(outFormat, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Renders a brand's photo if it has one, otherwise its initials — same
// markup shape (class="avatar") so existing size/radius rules keep working.
export function avatarHTML(brand, extraStyle = "") {
  if (brand.avatar) {
    return `<img class="avatar" style="${extraStyle}" src="${brand.avatar}" alt="" />`;
  }
  return `<div class="avatar" style="${extraStyle}">${initials(brand.name)}</div>`;
}

// A password/token input with a show/hide toggle — same .input markup plus
// a wrapper + button, so every existing attribute (id, placeholder, value,
// autocomplete) still lands on the real <input> and every existing
// qs("#id").value read/write call site keeps working untouched.
export function passwordFieldHTML(id, { placeholder = "", value = "", autocomplete } = {}) {
  return `
    <div class="password-field">
      <input class="input" type="password" id="${id}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" ${autocomplete ? `autocomplete="${autocomplete}"` : ""} />
      <button type="button" class="password-toggle-btn" data-password-toggle tabindex="-1" aria-label="${t("app.showPassword")}">${icon("eye", { size: 16 })}</button>
    </div>
  `;
}

// Call once after rendering any passwordFieldHTML() markup into `root`.
export function wirePasswordToggles(root = document) {
  qsa("[data-password-toggle]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      if (!input) return;
      const nowShowing = input.type === "password";
      input.type = nowShowing ? "text" : "password";
      btn.innerHTML = icon(nowShowing ? "eyeOff" : "eye", { size: 16 });
      btn.setAttribute("aria-label", nowShowing ? t("app.hidePassword") : t("app.showPassword"));
    });
  });
}

export function toast(message, type = "success") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const glyph = type === "success"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>';
  el.innerHTML = `${glyph}<span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// A small speech bubble pinned above one element, with an arrow pointing at
// it — for "the thing you just unlocked is over here" moments, where a toast
// would say it without showing where. Self-closing after 9s, or on the ✕.
export function showCalloutBubble(targetEl, text) {
  if (!targetEl?.getBoundingClientRect) return null;
  const bubble = document.createElement("div");
  bubble.className = "app-callout-bubble";
  bubble.innerHTML = `<span>${escapeHtml(text)}</span><button type="button" data-close aria-label="${t("common.close")}">${icon("x", { size: 12 })}</button><div class="app-callout-arrow"></div>`;
  document.body.appendChild(bubble);

  const targetRect = targetEl.getBoundingClientRect();
  const bubbleRect = bubble.getBoundingClientRect();
  const left = Math.max(12, Math.min(targetRect.left + targetRect.width / 2 - bubbleRect.width / 2, window.innerWidth - bubbleRect.width - 12));
  bubble.style.top = `${Math.max(8, targetRect.top - bubbleRect.height - 14)}px`;
  bubble.style.left = `${left}px`;
  bubble.style.setProperty("--arrow-left", `${targetRect.left + targetRect.width / 2 - left}px`);

  const remove = () => bubble.remove();
  bubble.querySelector("[data-close]").addEventListener("click", remove);
  setTimeout(remove, 9000);
  return bubble;
}

// A floating progress bar (bottom-right, survives the modal that started it
// closing) for anything long-running — importing a batch from Instagram,
// refreshing metrics, etc. — so it doesn't have to hold a blocking modal
// open, and multiple can stack if more than one thing is running.
export function showProgressBar(label) {
  const root = document.getElementById("progress-root") || (() => {
    const r = document.createElement("div");
    r.id = "progress-root";
    document.body.appendChild(r);
    return r;
  })();
  const el = document.createElement("div");
  el.className = "floating-progress";
  el.innerHTML = `
    <div class="floating-progress-label">${escapeHtml(label)}</div>
    <div class="floating-progress-track"><div class="floating-progress-fill" style="width:0%;"></div></div>
    <div class="floating-progress-sub"></div>
  `;
  root.appendChild(el);
  const fill = el.querySelector(".floating-progress-fill");
  const sub = el.querySelector(".floating-progress-sub");
  return {
    update(current, total, subLabel = "") {
      const pct = total ? Math.round((current / total) * 100) : 0;
      fill.style.width = `${pct}%`;
      sub.textContent = subLabel || `${current} / ${total}`;
    },
    done(message) {
      fill.style.width = "100%";
      el.classList.add("done");
      sub.textContent = message || t("app.done");
      setTimeout(() => el.remove(), 2600);
    },
    remove() {
      el.remove();
    },
  };
}

// Samples a logo/avatar image down to a handful of pixels and averages
// them — cheap, no library, good enough for a background tint (not trying
// to find the *most representative* color, just *a* plausible one).
export function getDominantColor(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const size = 12;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      let r = 0, g = 0, b = 0, n = 0;
      try {
        const data = ctx.getImageData(0, 0, size, size).data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 40) continue; // skip near-transparent pixels
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      } catch (e) {
        reject(e);
        return;
      }
      if (!n) { reject(new Error("Image had no opaque pixels to sample.")); return; }
      resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
    };
    img.src = imageUrl;
  });
}

// Accepts either "rgb(r, g, b)" (from getDominantColor) or "#rrggbb"/"#rgb"
// (from a manual <input type=color>) — one parser so pickTintTextColor/
// pickTintForeground work with a brand's manually-picked color too.
function parseRgb(rgb) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(rgb || "");
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const num = parseInt(h, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// A sampled logo color can land anywhere from near-black to near-white —
// pick whichever existing text color (the same two already used everywhere
// else) actually reads on top of it, rather than assuming one direction.
export function pickTintTextColor(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return "#1c1610";
  const [r, g, b] = parsed;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? "#1c1610" : "#f6f4f1";
}

// For using the tint itself as small text/icon color directly on the app's
// near-black page background — a dark-logo brand would otherwise produce
// near-invisible text, so blend toward white once luminance drops too low.
export function pickTintForeground(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return rgb;
  let [r, g, b] = parsed;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 90) {
    const mix = 0.55;
    r = Math.round(r + (255 - r) * mix);
    g = Math.round(g + (255 - g) * mix);
    b = Math.round(b + (255 - b) * mix);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// One-item-per-line textarea <-> plain string array — the encoding shared by
// Brand DNA's personality/values/productsServices and Campaign's channels,
// so multi-value fields don't need a dedicated add/remove list-editor UI.
export function linesToList(text) {
  return (text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
export function listToLines(list) {
  return (list || []).join("\n");
}

// Shared anchored-popup-menu helper — every ad-hoc dropdown/context menu in
// this app (brand switcher, settings, notif bell, row "..." actions, filter
// panels, etc.) used to hand-roll its own version of this, which is how the
// same three bugs kept recurring in different files: (1) positioning with
// raw getBoundingClientRect() values on a position:absolute element anchored
// to <body> — wrong the moment the page is scrolled, and wrong in the
// OPPOSITE direction for a trigger that lives inside a position:sticky/fixed
// header, since that button's rect is already viewport-correct and doesn't
// need a scroll offset added; (2) clicking the same toggle button while its
// menu was open just destroyed and immediately recreated an identical menu
// instead of actually closing it; (3) no open/close animation. Fixed once
// here: .menu is position:fixed in CSS (so top/left/right below are plain
// viewport coordinates straight from getBoundingClientRect(), no scrollY/
// scrollX math, correct whether `anchor` is sticky, fixed, or normal flow),
// this function itself handles the toggle-closes-if-already-open check, and
// the entrance/exit animations are plain CSS driven off .menu / .menu-closing.
let openMenuState = null; // { el, anchor, outsideClickHandler }

function animateMenuOut(el) {
  const finish = () => el.remove();
  el.classList.add("menu-closing");
  el.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 200); // safety net if the animation never fires (e.g. reduced motion)
}

export function closeMenu() {
  if (!openMenuState) return;
  const { el, outsideClickHandler } = openMenuState;
  document.removeEventListener("click", outsideClickHandler);
  openMenuState = null;
  animateMenuOut(el);
}

// Opens a new anchored menu, closing whatever menu was previously open first.
// If `anchor` is the same element whose menu is already open, this just
// closes it (a real toggle) and returns null — callers should bail out in
// that case instead of populating a menu that's about to be thrown away.
// `top`/`left`/`right` are plain viewport-pixel numbers (no unit, no
// window.scrollY/scrollX applied by the caller) since .menu is position:fixed.
export function openMenu(anchor, { className = "", top, left, right } = {}) {
  const reopening = openMenuState?.anchor === anchor;
  closeMenu();
  if (reopening) return null;

  const menu = document.createElement("div");
  menu.className = `menu ${className}`.trim();
  if (top !== undefined) menu.style.top = `${top}px`;
  if (left !== undefined) menu.style.left = `${left}px`;
  if (right !== undefined) menu.style.right = `${right}px`;
  document.body.appendChild(menu);

  const outsideClickHandler = (e) => {
    if (!menu.contains(e.target)) closeMenu();
  };
  setTimeout(() => document.addEventListener("click", outsideClickHandler));
  openMenuState = { el: menu, anchor, outsideClickHandler };
  return menu;
}
