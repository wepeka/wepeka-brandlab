import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";

// Centered, dimmed-backdrop overlay for reading a script aloud — adjustable
// scroll speed and text size, play/pause, restart.
export function openTeleprompter(scriptText, { title = "" } = {}) {
  const hasScript = !!(scriptText && scriptText.trim());

  const overlay = document.createElement("div");
  overlay.className = "tp-overlay";
  overlay.innerHTML = `
    <div class="tp-panel">
      <div class="tp-head">
        <span class="tp-title">${icon("teleprompter", { size: 16 })}${title ? escapeHtml(title) : "Teleprompter"}</span>
        <button class="icon-btn" id="tp-close" aria-label="Close teleprompter">${icon("x", { size: 18 })}</button>
      </div>
      <div class="tp-scroll" id="tp-scroll">
        <div class="tp-text" id="tp-text" style="font-size:32px;">${
          hasScript ? escapeHtml(scriptText) : `<span class="text-faint">No script written yet — add one in the Script field first.</span>`
        }</div>
      </div>
      <div class="tp-controls">
        <button class="btn btn-secondary btn-sm" id="tp-restart" aria-label="Restart from top">${icon("refresh", { size: 14 })}</button>
        <button class="btn btn-primary" id="tp-play" ${hasScript ? "" : "disabled"}>${icon("play", { size: 16 })}<span>Play</span></button>
        <label class="tp-slider">Speed<input type="range" id="tp-speed" min="1" max="10" value="4" /></label>
        <label class="tp-slider">Text Size<input type="range" id="tp-size" min="18" max="64" value="32" /></label>
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
    playBtn.innerHTML = playing ? `${icon("pause", { size: 16 })}<span>Pause</span>` : `${icon("play", { size: 16 })}<span>Play</span>`;
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

  function close() {
    pause();
    document.removeEventListener("keydown", onKeydown);
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
