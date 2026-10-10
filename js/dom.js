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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Exact figures with thousand separators — never abbreviated to K/M, so a
// number here always matches what you'd see counting it out on Instagram.
export function formatNumber(n) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  return num.toLocaleString(locale());
}

// Decimal separator follows the app language like formatNumber does — ID
// screens read "4,5%" next to "1.234", not "4.5%".
export function formatPercent(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return Number(n).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
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
        const isSvg = file.type === "image/svg+xml";
        // An SVG may have no intrinsic size at all; it's a vector, so it is
        // drawn at the full maxDimension either way.
        let width = img.width || maxDimension;
        let height = img.height || maxDimension;
        if (isSvg || width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        // Anything that can carry transparency stays PNG — a transparent
        // logo saved as JPEG came back on a black box.
        const keepsAlpha = file.type === "image/png" || isSvg;
        const outFormat = format || (keepsAlpha ? "image/png" : "image/jpeg");
        resolve(canvas.toDataURL(outFormat, quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Shrinks an existing data: URL (a screenshot already resized for the
// model) to a small JPEG thumbnail — what a chat message keeps in Firestore
// as "this is the photo you sent" (a few KB) while the full image only ever
// lives in memory for the one model call.
export function thumbnailFromDataUrl(dataUrl, { maxDimension = 120, quality = 0.6 } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve("");
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// Renders a brand's photo if it has one, otherwise its initials — same
// markup shape (class="avatar") so existing size/radius rules keep working.
export function avatarHTML(brand, extraStyle = "") {
  const avatar = brand.avatar;
  if (avatar && (avatar.startsWith("data:image/") || avatar.startsWith("https://"))) {
    return `<img class="avatar" style="${extraStyle}" src="${escapeHtml(avatar)}" alt="" />`;
  }
  return `<div class="avatar" style="${extraStyle}">${escapeHtml(initials(brand.name))}</div>`;
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

// A soft shimmering placeholder for "this is still loading" content areas —
// replaces a bare t("app.loading") sitting alone as page/card content with
// something that shows the shape of what's coming. Visually decorative
// (aria-hidden on the bars themselves); the actual "Memuat…" lives in a
// visually-hidden span so screen readers still hear it. Callers wrap this
// in a container with aria-busy="true" (or pass it straight in — the
// wrapper below already sets that) so assistive tech knows to wait.
export function skeletonHTML({ rows = 3, card = true } = {}) {
  const bars = Array.from({ length: rows }, (_, i) => `<div class="skeleton-line" style="width:${i === rows - 1 ? "60%" : "100%"};"></div>`).join("");
  return `<div class="skeleton${card ? " skeleton-card" : ""}" role="status" aria-busy="true"><span class="sr-only">${t("app.loading")}</span>${bars}</div>`;
}

// "Working on it" for an AI call or other wait inside a card: spinner plus
// one line of text ("Lagi …"), announced to screen readers. Same markup the
// app has always used inline (.ocr-status + .spinner), in one place.
export function loadingHTML(text, { style = "" } = {}) {
  return `<div class="ocr-status" role="status" aria-live="polite"${style ? ` style="${style}"` : ""}><div class="spinner" aria-hidden="true"></div><span>${text}</span></div>`;
}

// "Nothing here yet" inside a card or widget, one look everywhere: what's
// empty and why (`text`, may hold markup the caller already escaped), plus
// — when there's something to do about it — one button or link.
export function emptyInlineHTML(text, { ctaLabel = "", ctaHref = "", ctaAttrs = "", compact = false } = {}) {
  const cta = !ctaLabel
    ? ""
    : ctaHref
    ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(ctaHref)}">${ctaLabel}${icon("arrowRight", { size: 12 })}</a>`
    : `<button type="button" class="btn btn-secondary btn-sm" ${ctaAttrs}>${ctaLabel}</button>`;
  return `<div class="empty-inline${compact ? " is-compact" : ""}"><p>${text}</p>${cta}</div>`;
}

// A wizard's next step is painted where the previous one was left — down at
// its "Lanjut" button. On a phone that meant the new step opened on a
// disabled button and "Isi dulu jawabannya", with the question itself off
// screen above. Brings `el` (the step's own heading row) to just under the
// sticky topbar, only when it isn't already comfortably in view; no
// animation, so it reads as "the next page", not as the page sliding.
export function revealStepTop(el, margin = 12) {
  if (!el) return;
  const bar = document.querySelector(".topbar");
  const barRect = bar?.getBoundingClientRect();
  // The topbar only covers the page while it is stuck to the top (on phones
  // it sits in the normal flow at the very top of the document too).
  const offset = (barRect && barRect.top <= 0 && barRect.bottom > 0 ? barRect.bottom : 0) + margin;
  const top = el.getBoundingClientRect().top;
  if (top >= offset && top <= window.innerHeight * 0.5) return;
  window.scrollTo(0, Math.max(0, window.scrollY + top - offset));
}

export function toast(message, type = "success") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const glyph = type === "success"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>';
  el.innerHTML = `${glyph}<span>${escapeHtml(message)}</span>`;
  // An error is announced at once (role=alert, on top of #toast-root's
  // polite live region) and stays up twice as long — it usually says what
  // to do next, which takes longer to read than "Tersimpan".
  const isError = type === "error";
  if (isError) el.setAttribute("role", "alert");
  root.appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3200);
}

// Full-screen black "welcome" bumper, shown once right after someone lands
// inside Brandlab (main.js, on first successful boot of a session — fresh
// login, Google, or the wepeka.com SSO hand-off). Big greeting line + the
// actual Wepeka Brandlab logo mark (not the word spelled out), like a splash
// bumper. Auto-dismisses; a click/tap/Escape/any key skips it early so it
// never blocks someone in a hurry. Resolves once the bumper is gone, so the
// caller can put something right after it (main.js: the "kenalan" video).
export function showWelcomeBumper(name) {
  return new Promise((resolve) => {
  const el = document.createElement("div");
  el.className = "brandlab-bumper";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="brandlab-bumper-inner">
      <p class="brandlab-bumper-line">${t("app.welcome.line1", { name: `<b>${escapeHtml(name)}</b>` })}</p>
      <div class="brandlab-bumper-mark">
        <img src="assets/wepeka-logo.png" alt="Wepeka" />
        <span class="brandlab-bumper-mark-divider"></span>
        <span>Brandlab</span>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600); // safety net if the animation never fires
    document.removeEventListener("keydown", onKey);
    setTimeout(resolve, 350); // after the leave animation, so the next thing doesn't pop under it
  };
  const onKey = () => close();
  el.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  setTimeout(close, 2600);
  });
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

// WCAG 2.x relative luminance (0 = black, 1 = white) and contrast ratio.
function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a, b) {
  const pa = parseRgb(a);
  const pb = parseRgb(b);
  if (!pa || !pb) return 1;
  const la = relativeLuminance(pa);
  const lb = relativeLuminance(pb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A sampled logo color can land anywhere from near-black to near-white —
// pick whichever existing text color (the same two already used everywhere
// else) actually reads on top of it, rather than assuming one direction.
// Decided by real WCAG contrast, not a YIQ brightness cut-off: the old
// "YIQ > 140 → dark text" rule put light text on mid-bright colours like
// #00bcd4 / #4caf50 / #2196f3 (2.1–2.9:1), where dark text reads far better.
const TINT_TEXT_DARK = "#1c1610";
const TINT_TEXT_LIGHT = "#f6f4f1";
export function pickTintTextColor(rgb) {
  if (!parseRgb(rgb)) return TINT_TEXT_DARK;
  return contrastRatio(TINT_TEXT_DARK, rgb) >= contrastRatio(TINT_TEXT_LIGHT, rgb) ? TINT_TEXT_DARK : TINT_TEXT_LIGHT;
}

// The Brand Book keeps the original YIQ cut-off on purpose: it is the owner's
// design document (swatches, chapter pages, logo-on-primary tile), and
// switching rules would silently change books people already shared/printed.
export function pickBookTextColor(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return TINT_TEXT_DARK;
  const [r, g, b] = parsed;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? TINT_TEXT_DARK : TINT_TEXT_LIGHT;
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

// The light-mode twin of pickTintForeground: the brand color used as text/
// a mark on a pale background (the Wepeka logo's "We"). Kept as-is unless it
// is too pale to read on near-white (a yellow, a pastel), then darkened.
export function pickTintForegroundLight(rgb) {
  const parsed = parseRgb(rgb);
  if (!parsed) return rgb;
  let [r, g, b] = parsed;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance > 185) {
    const keep = 0.55;
    r = Math.round(r * keep);
    g = Math.round(g * keep);
    b = Math.round(b * keep);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// Clickable cards and rows that are a <div> (brand tiles, campaign/series
// cards, Creator's list, Home's schedule rows) because they hold their own
// buttons inside, which a real <button>/<a> can't. This makes them what
// they look like to a keyboard or screen reader: reachable with Tab,
// announced as a link/button, and Enter or Space does what a click does
// (the view's existing click handler — nothing is wired twice). Keys
// pressed on a nested control are left to that control. Call after
// rendering; `role` is "link" for cards that open a page.
export function wireClickableCards(root, selector, { role = "button" } = {}) {
  qsa(selector, root).forEach((el) => {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (!el.hasAttribute("role")) el.setAttribute("role", role);
    el.addEventListener("keydown", (e) => {
      if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      el.click();
    });
  });
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
let openMenuState = null; // { el, anchor, outsideClickHandler, keyHandler, resizeObserver }

function animateMenuOut(el) {
  const finish = () => el.remove();
  el.classList.add("menu-closing");
  el.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 200); // safety net if the animation never fires (e.g. reduced motion)
}

export function closeMenu() {
  if (!openMenuState) return;
  const { el, anchor, outsideClickHandler, keyHandler, resizeObserver } = openMenuState;
  if (typeof anchor?.setAttribute === "function") anchor.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", outsideClickHandler);
  document.removeEventListener("keydown", keyHandler, true);
  resizeObserver?.disconnect();
  openMenuState = null;
  animateMenuOut(el);
}

// Callers place a menu right under its trigger, which runs off the bottom
// of the screen (or under the phone's bottom bar) for a trigger low on the
// page, and off the right edge for one near it. Once the menu has its
// content: pull it back inside horizontally, flip it above the trigger when
// it doesn't fit below, and if it fits neither way pin it to the visible
// area and let it scroll.
const MENU_MARGIN = 8;
function fitMenuToViewport(menu, anchor) {
  if (!menu.isConnected) return;
  menu.style.maxHeight = "";
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const nav = document.querySelector(".bottom-nav");
  const navTop = nav && nav.getClientRects().length ? nav.getBoundingClientRect().top : window.innerHeight;
  const floor = Math.min(window.innerHeight, navTop) - MENU_MARGIN;
  if (r.right > vw - MENU_MARGIN || r.left < MENU_MARGIN) {
    menu.style.left = `${Math.max(MENU_MARGIN, Math.min(r.left, vw - MENU_MARGIN - r.width))}px`;
    menu.style.right = "auto";
  }
  if (r.bottom <= floor) return;
  const a = anchor?.getBoundingClientRect?.();
  const above = a ? a.top - 6 - r.height : -1;
  if (above >= MENU_MARGIN) {
    menu.style.top = `${above}px`;
    return;
  }
  const top = Math.max(MENU_MARGIN, Math.min(r.top, floor - r.height));
  menu.style.top = `${top}px`;
  if (top + r.height > floor) {
    menu.style.maxHeight = `${Math.max(120, floor - top)}px`;
    menu.style.overflowY = "auto";
  }
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
  // Screen readers: the trigger says it opens a popup and whether it's open
  // (set here once, so no caller has to remember; closeMenu resets it).
  if (typeof anchor?.setAttribute === "function") {
    if (!anchor.hasAttribute?.("aria-haspopup")) anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
  }

  const outsideClickHandler = (e) => {
    if (!menu.contains(e.target)) closeMenu();
  };
  setTimeout(() => document.addEventListener("click", outsideClickHandler));
  // Escape closes just the menu (capture + stop, so a modal or the chat
  // panel underneath doesn't also close) and hands focus back.
  const keyHandler = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeMenu();
    anchor?.focus?.();
  };
  document.addEventListener("keydown", keyHandler, true);
  // The caller fills the menu after this returns (sometimes later still):
  // fit it whenever its size changes, before it's painted.
  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => fitMenuToViewport(menu, anchor));
    resizeObserver.observe(menu);
  } else {
    requestAnimationFrame(() => fitMenuToViewport(menu, anchor));
  }
  openMenuState = { el: menu, anchor, outsideClickHandler, keyHandler, resizeObserver };
  return menu;
}
