// Shared full-screen "big win" celebration — mission level-ups and a whole
// campaign finishing (js/views/campaign-detail.js), plus ad-hoc performance
// wins like a piece of content crossing into a healthy ER
// (js/views/content-list.js). No confetti library in this app: the confetti
// is plain CSS (css/styles.css .celebrate-*), pieces falling across the
// whole viewport. `final: true` = the campaign-finished variant (trophy,
// longer confetti). title/sub are trusted HTML — callers esc() user data.
import { icon } from "./icons.js";
import { t } from "./i18n.js";

const COLORS = ["#ffa52b", "#3ddc84", "#5b9bf0", "#c08af5", "#ff6a5c", "#ffc94a"];

export function openCelebration({ eyebrow = "", title, sub = "", final = false }) {
  const count = final ? 90 : 60;
  const confetti = Array.from({ length: count }, (_, i) => {
    const left = Math.round(Math.random() * 100);
    const delay = (Math.random() * (final ? 1.6 : 0.9)).toFixed(2);
    const dur = (2.2 + Math.random() * 1.8).toFixed(2);
    const size = 6 + Math.round(Math.random() * 6);
    const drift = Math.round((Math.random() - 0.5) * 160);
    return `<span class="celebrate-confetti" style="left:${left}%;width:${size}px;height:${Math.round(size * (i % 3 === 0 ? 0.45 : 1))}px;background:${COLORS[i % COLORS.length]};border-radius:${i % 4 === 0 ? "50%" : "2px"};animation-delay:${delay}s;animation-duration:${dur}s;--drift:${drift}px;"></span>`;
  }).join("");
  const overlay = document.createElement("div");
  overlay.className = `celebrate-overlay ${final ? "is-final" : ""}`;
  overlay.innerHTML = `
    <div class="celebrate-rain" aria-hidden="true">${confetti}</div>
    <div class="celebrate-card" role="dialog" aria-modal="true">
      <div class="celebrate-badge">${icon(final ? "target" : "check", { size: 34 })}</div>
      ${eyebrow ? `<div class="celebrate-eyebrow">${eyebrow}</div>` : ""}
      <h2 class="celebrate-title">${title}</h2>
      ${sub ? `<p class="celebrate-sub">${sub}</p>` : ""}
      <button type="button" class="btn btn-primary btn-block" data-celebrate-close>${t("camp.next")}</button>
    </div>`;
  const close = () => {
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 220);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
  overlay.querySelector("[data-celebrate-close]").addEventListener("click", close);
  document.body.appendChild(overlay);
  return overlay;
}
