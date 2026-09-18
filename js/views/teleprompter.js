import { icon } from "../icons.js";
import { escapeHtml } from "../dom.js";
import { t } from "../i18n.js";

// Fill light for shooting: the backdrop around the script panel turns into
// a bright colour field (a phone/laptop screen is often the only light a
// small business has when filming a talking-head at a desk). Brightness
// mixes the chosen colour toward black; the presets are the usual ring-light
// temperatures plus a custom picker. Last settings are remembered per
// browser so the next take starts where the last one ended.
const LIGHT_KEY = "contentos:tp-light";
const LIGHT_PRESETS = [
  { key: "white", label: t("tp.color.white"), color: "#ffffff" },
  { key: "warm", label: t("tp.color.warm"), color: "#ffd8a8" },
  { key: "cool", label: t("tp.color.cool"), color: "#d6e6ff" },
  { key: "pink", label: t("tp.color.pink"), color: "#ffd2e4" },
  { key: "green", label: t("tp.color.green"), color: "#c9f5d6" },
];
const DEFAULT_LIGHT = { on: false, brightness: 100, color: "#ffffff" };

function loadLight() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIGHT_KEY) || "null");
    return saved && typeof saved === "object" ? { ...DEFAULT_LIGHT, ...saved } : { ...DEFAULT_LIGHT };
  } catch {
    return { ...DEFAULT_LIGHT };
  }
}
function saveLight(light) {
  try {
    localStorage.setItem(LIGHT_KEY, JSON.stringify(light));
  } catch {
    /* private mode etc. — the light still works for this session */
  }
}

// Centered, dimmed-backdrop overlay for reading a script aloud — adjustable
// scroll speed and text size, play/pause, restart, plus the fill light.
export function openTeleprompter(scriptText, { title = "" } = {}) {
  const hasScript = !!(scriptText && scriptText.trim());
  const light = loadLight();

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
        <button type="button" class="btn btn-secondary btn-sm tp-light-toggle" id="tp-light" aria-pressed="${light.on}" title="${t("tp.lightTitle")}">${icon("sun", { size: 14 })}<span>${t("tp.light")}</span></button>
      </div>
      <div class="tp-light-controls" id="tp-light-controls" ${light.on ? "" : "hidden"}>
        <label class="tp-slider">${t("tp.brightness")}<input type="range" id="tp-brightness" min="20" max="100" value="${light.brightness}" /><span class="tp-light-value" id="tp-brightness-value">${light.brightness}%</span></label>
        <div class="tp-light-colors" role="radiogroup" aria-label="${t("tp.lightColor")}">
          ${LIGHT_PRESETS.map(
            (p) =>
              `<button type="button" class="tp-swatch" data-light-color="${p.color}" role="radio" aria-checked="${light.color === p.color}" title="${p.label}" style="--swatch:${p.color}"><span class="sr-only">${p.label}</span></button>`
          ).join("")}
          <label class="tp-swatch tp-swatch-custom" title="${t("tp.customColor")}" style="--swatch:${escapeHtml(light.color)}">${icon("palette", { size: 13 })}<input type="color" id="tp-light-custom" value="${escapeHtml(light.color)}" aria-label="${t("tp.customColor")}" /></label>
        </div>
        <span class="tp-light-hint">${t("tp.lightHint")}</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const scrollEl = overlay.querySelector("#tp-scroll");
  const textEl = overlay.querySelector("#tp-text");
  const playBtn = overlay.querySelector("#tp-play");
  const speedInput = overlay.querySelector("#tp-speed");
  const sizeInput = overlay.querySelector("#tp-size");
  const lightBtn = overlay.querySelector("#tp-light");
  const lightControls = overlay.querySelector("#tp-light-controls");
  const brightnessInput = overlay.querySelector("#tp-brightness");
  const brightnessValue = overlay.querySelector("#tp-brightness-value");
  const customColor = overlay.querySelector("#tp-light-custom");
  const customSwatch = overlay.querySelector(".tp-swatch-custom");

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

  // ---- Fill light ----
  // Keeping the screen awake matters more with the light on: a take that
  // goes dark halfway is worse than no light at all. Best effort only —
  // the API needs HTTPS and a user gesture, and not every browser has it.
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === "visible" && light.on) keepAwake(true);
  };
  document.addEventListener("visibilitychange", onVisibility);

  function applyLight() {
    overlay.classList.toggle("tp-light-on", light.on);
    overlay.style.setProperty("--tp-light", `color-mix(in srgb, ${light.color} ${light.brightness}%, #000)`);
    lightBtn.setAttribute("aria-pressed", String(light.on));
    lightBtn.classList.toggle("is-on", light.on);
    lightControls.hidden = !light.on;
    brightnessValue.textContent = `${light.brightness}%`;
    const preset = LIGHT_PRESETS.some((p) => p.color === light.color);
    overlay.querySelectorAll("[data-light-color]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lightColor === light.color)));
    customSwatch.classList.toggle("is-active", !preset);
    customSwatch.style.setProperty("--swatch", light.color);
    keepAwake(light.on);
    saveLight(light);
  }

  lightBtn.addEventListener("click", () => {
    light.on = !light.on;
    applyLight();
  });
  brightnessInput.addEventListener("input", () => {
    light.brightness = Number(brightnessInput.value);
    applyLight();
  });
  overlay.querySelectorAll("[data-light-color]").forEach((b) =>
    b.addEventListener("click", () => {
      light.color = b.dataset.lightColor;
      applyLight();
    })
  );
  customColor.addEventListener("input", () => {
    light.color = customColor.value;
    applyLight();
  });
  applyLight();

  // Fullscreen hides the browser chrome so the whole display glows.
  const fsBtn = overlay.querySelector("#tp-fullscreen");
  fsBtn.addEventListener("click", () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  });
  if (!document.documentElement.requestFullscreen) fsBtn.hidden = true;

  function close() {
    pause();
    keepAwake(false);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("visibilitychange", onVisibility);
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    overlay.remove();
  }
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  overlay.querySelector("#tp-close").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    // With the light on, the backdrop IS the light — a stray tap on it must
    // not end the take.
    if (e.target === overlay && !light.on) close();
  });
  document.addEventListener("keydown", onKeydown);
}
