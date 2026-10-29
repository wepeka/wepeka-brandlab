// How a caption is dressed (owner's ask, 2026-10-30: "caption instagramnya
// kasih emoticon, jangan plain tulisan aja, ada opsi matikan hashtag").
// Two switches, remembered in this browser: emoji + line breaks, and
// hashtags. Both default to on. Used by the writer prompt (js/ai.js), the
// caption field and the AI writer's panel (js/views/creator.js).
import { t } from "./i18n.js";

const KEY = "brandlab:caption-style";
const DEFAULTS = { emoji: true, hashtags: true };

export function getCaptionStyle() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? { emoji: saved.emoji !== false, hashtags: saved.hashtags !== false } : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setCaptionStyle(patch) {
  const next = { ...getCaptionStyle(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: this session only */ }
  return next;
}

// The instruction that goes into a caption prompt.
export function captionStyleRule({ emoji = true, hashtags = true } = {}) {
  const look = emoji
    ? "Dress it for Instagram, never plain text: a first line that stops the scroll, then short lines with a blank line between them (not one block), an emoji where it adds meaning (at most one per line, at the start or the end, such as ✨ 📍 👉 ✅ 🔥 💬), and a last line with one clear ask that ends on 👇 or a similar pointer. Keep the emojis fitting for the brand's tone, no emoji chains."
    : "Plain text without any emoji, short lines with a blank line between them.";
  return `${look}${hashtags ? "" : " NO hashtags at all, anywhere in the caption."}`;
}

// A caption the model dressed with hashtags although they are off.
export function stripHashtags(text) {
  const lines = String(text || "").replace(/\s+$/, "").split("\n");
  while (lines.length && /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(lines[lines.length - 1])) lines.pop();
  return lines.join("\n").replace(/(\s+#[\p{L}\p{N}_]+)+\s*$/u, "").replace(/\s+$/, "");
}

// The two switches as small pills. `data-cap-style` carries the key.
export function captionStyleToggleHTML() {
  const s = getCaptionStyle();
  const pill = (key, label, emoji) => `<button type="button" class="cap-style-pill${s[key] ? " is-on" : ""}" data-cap-style="${key}" aria-pressed="${s[key]}" title="${t(`cap.style.${key}.title`)}"><span aria-hidden="true">${emoji}</span>${label}</button>`;
  return `<div class="cap-style" role="group" aria-label="${t("cap.style.aria")}">${pill("emoji", t("cap.style.emoji"), "😀")}${pill("hashtags", t("cap.style.hashtags"), "#")}</div>`;
}

// Wire every switch under `root`; they stay in step with each other.
export function wireCaptionStyleToggles(root, onChange) {
  root.querySelectorAll("[data-cap-style]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.capStyle;
    const next = setCaptionStyle({ [key]: !getCaptionStyle()[key] });
    document.querySelectorAll(`[data-cap-style="${key}"]`).forEach((x) => {
      x.classList.toggle("is-on", next[key]);
      x.setAttribute("aria-pressed", String(next[key]));
    });
    onChange?.(next);
  }));
}
