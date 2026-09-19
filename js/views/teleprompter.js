import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";
import { t } from "../i18n.js";

// Centered, dimmed-backdrop overlay for reading a script aloud — play/pause,
// restart, scroll speed and text size. Nothing else.
export function openTeleprompter(scriptText, { title = "" } = {}) {
  const hasScript = !!(scriptText && scriptText.trim());

  const overlay = document.createElement("div");
  overlay.className = "tp-overlay";
  overlay.innerHTML = `
    <div class="tp-panel">
      <div class="tp-head">
        <span class="tp-title">${icon("teleprompter", { size: 16 })}${title ? escapeHtml(title) : t("tp.title")}</span>
        <div class="tp-head-actions">
          <button class="icon-btn" id="tp-fullscreen" aria-label="${t("tp.fullscreen")}" title="${t("tp.fullscreen")}">${icon("expand", { size: 16 })}</button>
          <button class="icon-btn" id="tp-close" aria-label="${t("tp.close")}">${icon("x", { size: 18 })}</button>
        </div>
      </div>
      <div class="tp-scroll" id="tp-scroll">
        <div class="tp-text" id="tp-text" style="font-size:32px;">${
          hasScript ? escapeHtml(scriptText) : `<span class="text-faint">${t("tp.noScript")}</span>`
        }</div>
      </div>
      <div class="tp-controls">
        <button class="btn btn-secondary btn-sm" id="tp-restart" aria-label="${t("tp.restart")}" title="${t("tp.restart")}">${icon("refresh", { size: 14 })}</button>
        <button class="btn btn-primary" id="tp-play" ${hasScript ? "" : "disabled"}>${icon("play", { size: 16 })}<span>${t("tp.play")}</span></button>
        <label class="tp-slider">${t("tp.speed")}<input type="range" id="tp-speed" min="1" max="10" value="4" /></label>
        <label class="tp-slider">${t("tp.size")}<input type="range" id="tp-size" min="18" max="64" value="32" /></label>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const scrollEl = overlay.querySelector("#tp-scroll");
  const textEl = overlay.querySelector("#tp-text");
  const playBtn = overlay.querySelector("#tp-play");
  const speedInput = overlay.querySelector("#tp-speed");
  const sizeInput = overlay.querySelector("#tp-size");

  let playing = false;
  let rafId = null;
  let lastTs = null;

  function setPlayButton() {
    playBtn.innerHTML = playing ? `${icon("pause", { size: 16 })}<span>${t("tp.pause")}</span>` : `${icon("play", { size: 16 })}<span>${t("tp.play")}</span>`;
  }

  function step(ts) {
    if (!playing) return;
    if (lastTs === null) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    const pxPerSec = Number(speedInput.value) * 18;
    scrollEl.scrollTop += pxPerSec * dt;
    if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2) {
      pause();
      return;
    }
    rafId = requestAnimationFrame(step);
  }

  function play() {
    if (!hasScript) return;
    playing = true;
    lastTs = null;
    setPlayButton();
    rafId = requestAnimationFrame(step);
  }
  function pause() {
    playing = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    setPlayButton();
  }

  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  overlay.querySelector("#tp-restart").addEventListener("click", () => {
    scrollEl.scrollTop = 0;
  });
  sizeInput.addEventListener("input", () => {
    textEl.style.fontSize = sizeInput.value + "px";
  });

  // Fullscreen hides the browser chrome so the script fills the display.
  const fsBtn = overlay.querySelector("#tp-fullscreen");
  fsBtn.addEventListener("click", () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  });
  if (!document.documentElement.requestFullscreen) fsBtn.hidden = true;

  function close() {
    pause();
    document.removeEventListener("keydown", onKeydown);
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  overlay.querySelector("#tp-close").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKeydown);
}
