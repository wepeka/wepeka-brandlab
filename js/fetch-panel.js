// Pulling data from a platform, made visible (2026-11-25): the platform's
// logo inside a ring that fills as the work goes (Instagram, Facebook,
// TikTok, YouTube colours), the steps ticking off one by one, the posts'
// pictures dropping into a strip as their numbers are read, and a finish
// (the ring closes, a tick pops, dots fly out, the counts roll up). The
// panel can be tucked away into a small round icon and opened again.
//
//   platformRingHTML(platform, opts)  the ring alone (spinning) — e.g. while
//                                     Import dari Instagram loads the posts
//   openFetchPanel({...})             the floating panel (see below)
import { icon, PLATFORM_ICON } from "./icons.js";
import { escapeHtml, formatNumber, toast } from "./dom.js";
import { t } from "./i18n.js";

const KNOWN = ["instagram", "facebook", "tiktok", "youtube"];
export const platformKey = (p) => {
  const k = String(p || "").toLowerCase().replace(/\s+/g, "");
  return KNOWN.includes(k) ? k : k === "meta" ? "facebook" : "generic";
};
const STOPS = {
  instagram: ["#feda75", "#fa7e1e", "#d62976", "#962fbf", "#4f5bd5"],
  facebook: ["#4c9bff", "#1877f2"],
  tiktok: ["#25f4ee", "#fe2c55"],
  youtube: ["#ff6b81", "#ff0033"],
  generic: ["var(--accent)", "var(--accent)"],
};
const logo = (k) => PLATFORM_ICON[k] || icon("refresh", { size: 22 });
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let seq = 0;

// mode "spin": a comet going round (no percentage known);
// mode "progress": an arc that fills with --pct, a bright dot at its head.
export function platformRingHTML(platform, { size = 64, badge = "", mode = "spin" } = {}) {
  const k = platformKey(platform);
  const b = badge ? platformKey(badge) : "";
  const gid = `pl-g-${++seq}`;
  const stops = STOPS[k] || STOPS.generic;
  const arc = mode === "progress"
    ? `<svg class="pl-arc" viewBox="0 0 48 48">
        <defs><linearGradient id="${gid}" x1="0" y1="1" x2="1" y2="0">${stops.map((c, i) => `<stop offset="${Math.round((i / (stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join("")}</linearGradient></defs>
        <circle class="pl-arc-fill" cx="24" cy="24" r="21.6" pathLength="100" stroke="url(#${gid})"/>
      </svg>
      <span class="pl-orbit"><i></i></span>`
    : "";
  return `<span class="pl-ring pl-${k} ${mode === "progress" ? "is-progress" : ""}" style="--pl-size:${size}px" aria-hidden="true">
    ${arc}
    <span class="pl-face">${logo(k)}</span>
    <span class="pl-tick">${icon("check", { size: Math.round(size * 0.42) })}</span>
    <span class="pl-burst">${Array.from({ length: 10 }, (_, i) => `<i style="--a:${i * 36}deg"></i>`).join("")}</span>
    ${b && b !== k ? `<span class="pl-badge pl-${b}">${logo(b)}</span>` : ""}
  </span>`;
}

// openFetchPanel({ platform, badge, title, sub, steps: [{ key, label }] })
//   step(key, state, value)  state "active" | "done" | "skip"; value = short text on the right
//   progress(pct)            the ring and the bar (never goes back)
//   thumb(url)               a post's picture into the strip
//   done({ title, note, stats: [{ n, label }] })
//   fail(message, title)
// Without news for a while the ring creeps on by itself (never past 90%),
// so a reply that arrives all at once still reads as moving.
export function openFetchPanel({ platform, badge = "", title, sub = "", steps = [] }) {
  const root = document.getElementById("fetch-root") || (() => {
    const r = document.createElement("div");
    r.id = "fetch-root";
    document.body.appendChild(r);
    return r;
  })();
  const k = platformKey(platform);
  const el = document.createElement("section");
  el.className = `fetch-panel pl-${k}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <button type="button" class="fp-bubble" aria-label="${escapeHtml(t("fetch.open"))}">
      ${platformRingHTML(platform, { size: 56, badge, mode: "progress" })}
      <span class="fp-bubble-pct">0%</span>
    </button>
    <button type="button" class="fp-hide-all" aria-label="${escapeHtml(t("common.close"))}">${icon("x", { size: 12 })}</button>
    <div class="fp-full">
      <div class="fp-head">
        ${platformRingHTML(platform, { size: 58, badge, mode: "progress" })}
        <div class="fp-titles">
          <div class="fp-title">${escapeHtml(title)}</div>
          ${sub ? `<div class="fp-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
        <div class="fp-actions">
          <button type="button" class="fp-btn fp-min" aria-label="${escapeHtml(t("fetch.hide"))}" title="${escapeHtml(t("fetch.hide"))}">${icon("chevronDown", { size: 16 })}</button>
          <button type="button" class="fp-btn fp-x" aria-label="${escapeHtml(t("common.close"))}">${icon("x", { size: 15 })}</button>
        </div>
      </div>
      <div class="fp-bar"><i></i><b>0%</b></div>
      ${steps.length ? `<ol class="fp-steps">${steps.map((s) => `<li data-step="${escapeHtml(s.key)}" class="is-wait"><span class="fp-dot">${icon("check", { size: 11 })}</span><span class="fp-label">${escapeHtml(s.label)}</span><span class="fp-val"></span></li>`).join("")}</ol>` : ""}
      <div class="fp-thumbs" hidden></div>
      <p class="fp-note" hidden></p>
      <div class="fp-stats" hidden></div>
    </div>`;
  root.appendChild(el);
  // A timer rather than a frame: a tab in the background still shows it.
  setTimeout(() => el.classList.add("is-in"), 30);

  const rings = [...el.querySelectorAll(".pl-ring")];
  const barFill = el.querySelector(".fp-bar i");
  const barText = el.querySelector(".fp-bar b");
  const bubblePct = el.querySelector(".fp-bubble-pct");
  const thumbs = el.querySelector(".fp-thumbs");
  let pct = 0;
  let finished = false;
  let gone = false;
  let lastMove = Date.now();
  let shown = 0;
  let extra = 0;

  const set = (p) => {
    pct = Math.max(pct, Math.min(100, p));
    const r = Math.round(pct);
    rings.forEach((ring) => ring.style.setProperty("--pct", pct.toFixed(1)));
    barFill.style.width = `${pct}%`;
    barText.textContent = `${r}%`;
    bubblePct.textContent = `${r}%`;
  };
  const creep = setInterval(() => {
    if (finished) return;
    if (Date.now() - lastMove > 900 && pct < 90) set(pct + (90 - pct) * 0.03);
  }, 400);
  const remove = () => {
    if (gone) return;
    gone = true;
    clearInterval(creep);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), reduced() ? 0 : 260);
  };
  const minimize = (on) => el.classList.toggle("is-min", on);
  el.querySelector(".fp-min").addEventListener("click", () => minimize(true));
  el.querySelector(".fp-bubble").addEventListener("click", () => minimize(false));
  // Closing while it still works only takes it off the screen; the result
  // still comes as a short message.
  let silent = false;
  const hideAll = () => {
    if (!finished) silent = true;
    remove();
  };
  el.querySelector(".fp-x").addEventListener("click", hideAll);
  el.querySelector(".fp-hide-all").addEventListener("click", hideAll);

  const stepEl = (key) => el.querySelector(`.fp-steps li[data-step="${key}"]`);
  const api = {
    el,
    step(key, state, value) {
      const li = stepEl(key);
      if (!li) return;
      if (state === "active") {
        // Everything before an active step is done.
        let prev = li.previousElementSibling;
        while (prev) {
          if (prev.classList.contains("is-wait") || prev.classList.contains("is-active")) api.step(prev.dataset.step, "done");
          prev = prev.previousElementSibling;
        }
      }
      li.classList.remove("is-wait", "is-active", "is-done", "is-skip");
      li.classList.add(`is-${state}`);
      if (value !== undefined) li.querySelector(".fp-val").textContent = value;
      lastMove = Date.now();
    },
    progress(p) {
      if (finished) return;
      set(p);
      lastMove = Date.now();
    },
    thumb(url) {
      if (!url) return;
      thumbs.hidden = false;
      if (shown >= 7) {
        extra++;
        let more = thumbs.querySelector(".fp-more");
        if (!more) {
          more = document.createElement("span");
          more.className = "fp-more";
          thumbs.appendChild(more);
        }
        more.textContent = `+${extra}`;
        return;
      }
      shown++;
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => img.classList.add("is-broken");
      img.src = url;
      img.style.setProperty("--tilt", `${(shown % 2 ? -1 : 1) * (2 + (shown % 3))}deg`);
      thumbs.insertBefore(img, thumbs.querySelector(".fp-more"));
    },
    done({ title: doneTitle, note = "", stats = [], stayMs = 6500 } = {}) {
      if (finished) return;
      finished = true;
      clearInterval(creep);
      set(100);
      el.querySelectorAll(".fp-steps li:not(.is-skip)").forEach((li) => {
        li.classList.remove("is-wait", "is-active");
        li.classList.add("is-done");
      });
      el.classList.add("is-done");
      rings.forEach((r) => r.classList.add("is-done"));
      if (doneTitle) el.querySelector(".fp-title").textContent = doneTitle;
      const noteEl = el.querySelector(".fp-note");
      if (note) {
        noteEl.hidden = false;
        noteEl.textContent = note;
      }
      const box = el.querySelector(".fp-stats");
      const list = stats.filter((s) => s && s.label);
      if (list.length) {
        box.hidden = false;
        box.innerHTML = list.map((s) => `<div class="fp-stat"><b data-n="${Number(s.n) || 0}">${formatNumber(Number(s.n) || 0)}</b><span>${escapeHtml(s.label)}</span></div>`).join("");
        if (!reduced()) box.querySelectorAll("b[data-n]").forEach(rollUp);
      }
      if (silent) {
        toast(doneTitle || title);
        return;
      }
      if (stayMs) setTimeout(remove, el.classList.contains("is-min") ? Math.min(stayMs, 3500) : stayMs);
    },
    fail(message, failTitle = "") {
      if (finished) return;
      finished = true;
      clearInterval(creep);
      el.classList.add("is-fail");
      rings.forEach((r) => r.classList.add("is-fail"));
      minimize(false);
      if (failTitle) el.querySelector(".fp-title").textContent = failTitle;
      el.querySelector(".fp-steps li.is-active")?.classList.replace("is-active", "is-failed");
      const noteEl = el.querySelector(".fp-note");
      noteEl.hidden = false;
      noteEl.textContent = message;
      if (silent) toast(message, "error");
      else setTimeout(remove, 12000);
    },
    close: remove,
  };
  return api;
}

function rollUp(el) {
  const target = Number(el.dataset.n) || 0;
  if (!target) return;
  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / 1100);
    el.textContent = formatNumber(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  el.textContent = "0";
  requestAnimationFrame(tick);
}
