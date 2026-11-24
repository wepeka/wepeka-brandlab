// Waiting on a platform, made visible (2026-11-25): the platform's logo in
// the middle of a ring that spins in that platform's colours (Instagram,
// Facebook, TikTok, YouTube), a bar under it and the step it's on. When the
// data is in, the ring closes, a tick pops in and the counts roll up.
//
//   platformRingHTML(platform)        the ring alone (inline spots: the
//                                     Import list loading, a screenshot being read)
//   inlineLoaderHTML(platform, text)  ring + one line, for inside a modal
//   openFetchPanel({...})             the floating panel: step(), done(), fail()
import { icon, PLATFORM_ICON } from "./icons.js";
import { escapeHtml, formatNumber } from "./dom.js";
import { t } from "./i18n.js";

const KNOWN = ["instagram", "facebook", "tiktok", "youtube"];
export const platformKey = (p) => {
  const k = String(p || "").toLowerCase().replace(/\s+/g, "");
  return KNOWN.includes(k) ? k : k === "meta" ? "facebook" : "generic";
};
const logo = (k) => PLATFORM_ICON[k] || icon("refresh", { size: 22 });
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function platformRingHTML(platform, { size = 64, badge = "" } = {}) {
  const k = platformKey(platform);
  const b = badge ? platformKey(badge) : "";
  return `<span class="pl-ring pl-${k}" style="--pl-size:${size}px" aria-hidden="true">
    <span class="pl-face">${logo(k)}</span>
    <span class="pl-tick">${icon("check", { size: Math.round(size * 0.42) })}</span>
    <span class="pl-burst">${Array.from({ length: 8 }, (_, i) => `<i style="--a:${i * 45}deg"></i>`).join("")}</span>
    ${b && b !== k ? `<span class="pl-badge pl-${b}">${logo(b)}</span>` : ""}
  </span>`;
}

export function inlineLoaderHTML(platform, text, { pct = null } = {}) {
  return `<div class="pl-inline" role="status">
    ${platformRingHTML(platform, { size: 44 })}
    <span class="pl-inline-text">${escapeHtml(text)}${pct !== null ? ` <b>${Math.round(pct)}%</b>` : ""}</span>
  </div>`;
}

// The floating panel. `steps` maps a step key to its share of the bar
// ([from, to] in percent); step(key, text, frac) moves the bar inside that
// share. Without any step for a while the bar creeps on by itself (never
// past 90%), so a reply that arrives all at once still reads as moving.
export function openFetchPanel({ platform, badge = "", title, sub = "", firstStep = "" }) {
  const root = document.getElementById("fetch-root") || (() => {
    const r = document.createElement("div");
    r.id = "fetch-root";
    document.body.appendChild(r);
    return r;
  })();
  const k = platformKey(platform);
  const el = document.createElement("div");
  el.className = `fetch-panel pl-${k}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <button type="button" class="fetch-panel-x" aria-label="${escapeHtml(t("common.close"))}">${icon("x", { size: 15 })}</button>
    <div class="fetch-panel-top">
      ${platformRingHTML(platform, { size: 56, badge })}
      <div class="fetch-panel-head">
        <div class="fetch-panel-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="fetch-panel-sub">${escapeHtml(sub)}</div>` : ""}
      </div>
    </div>
    <div class="fetch-panel-bar"><i></i></div>
    <div class="fetch-panel-step"><span>${escapeHtml(firstStep)}</span><b>0%</b></div>
    <div class="fetch-panel-stats" hidden></div>`;
  root.appendChild(el);
  const ring = el.querySelector(".pl-ring");
  const fill = el.querySelector(".fetch-panel-bar i");
  const stepText = el.querySelector(".fetch-panel-step span");
  const pctText = el.querySelector(".fetch-panel-step b");
  let pct = 0;
  let finished = false;
  let lastMove = Date.now();
  const set = (p) => {
    pct = Math.max(pct, Math.min(100, p));
    fill.style.width = `${pct}%`;
    pctText.textContent = `${Math.round(pct)}%`;
  };
  const creep = setInterval(() => {
    if (finished) return;
    if (Date.now() - lastMove > 700 && pct < 90) set(pct + (90 - pct) * 0.035);
  }, 400);
  const close = () => {
    clearInterval(creep);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), reduced() ? 0 : 220);
  };
  el.querySelector(".fetch-panel-x").addEventListener("click", close);

  return {
    el,
    step(text, toPct) {
      if (finished) return;
      if (text) stepText.textContent = text;
      if (Number.isFinite(toPct)) set(toPct);
      lastMove = Date.now();
    },
    // stats: [{ n, label }] — counts that roll up under the tick.
    done({ title: doneTitle, stats = [], note = "", stayMs = 5200 } = {}) {
      finished = true;
      clearInterval(creep);
      set(100);
      el.classList.add("is-done");
      ring.classList.add("is-done");
      el.querySelector(".fetch-panel-title").textContent = doneTitle || title;
      stepText.textContent = note;
      pctText.textContent = "";
      const box = el.querySelector(".fetch-panel-stats");
      const shown = stats.filter((s) => s && s.label);
      if (shown.length) {
        box.hidden = false;
        box.innerHTML = shown.map((s) => `<div class="fetch-stat"><b data-n="${Number(s.n) || 0}">${Number.isFinite(Number(s.n)) ? formatNumber(Number(s.n)) : escapeHtml(String(s.n))}</b><span>${escapeHtml(s.label)}</span></div>`).join("");
        if (!reduced()) box.querySelectorAll("b[data-n]").forEach(rollUp);
      }
      if (stayMs) setTimeout(close, stayMs);
    },
    fail(message, failTitle = "") {
      finished = true;
      if (failTitle) el.querySelector(".fetch-panel-title").textContent = failTitle;
      clearInterval(creep);
      el.classList.add("is-fail");
      ring.classList.add("is-fail");
      stepText.textContent = message;
      pctText.textContent = "";
      setTimeout(close, 9000);
    },
    close,
  };
}

function rollUp(el) {
  const target = Number(el.dataset.n) || 0;
  if (!target) return;
  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / 900);
    el.textContent = formatNumber(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  el.textContent = "0";
  requestAnimationFrame(tick);
}
