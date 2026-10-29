// Floating "Cari ide" — a small browser beside the work, for hunting content
// ideas without leaving Brandlab (owner's ask, 2026-10-29: "web search yang
// kalau dibuka kaya ada panel buat buka browser, widget on screen").
//
// Three things, none of them costing a server call or a database row:
//   - "Lagi dicari orang": what people type into YouTube and Google after the
//     keyword (Google's public autocomplete, read as JSONP — it sends no CORS
//     header, so a fetch can't read it).
//   - Google inside the panel (web / video / image results). Google allows
//     this one frame (igu=1); almost every other site refuses to be framed,
//     so a result link opens in…
//   - …the side window: a real browser window docked on the right of the
//     screen (TikTok, Instagram, YouTube, Pinterest, Trends — logged in as
//     the owner already is). One named window, reused on every click. On a
//     phone it is a new tab.
// What's found goes into Ide Tersimpan (addBrandIdea) or to the chat, typed
// by the owner — nothing is created by itself.
//
// Mounted/unmounted per render by js/layout.js, beside the Coretan button.
import { addBrandIdea } from "./store.js";
import { icon, platformIcon } from "./icons.js";
import { escapeHtml as esc, qs, toast } from "./dom.js";
import { t, getLang } from "./i18n.js";

const OPEN_KEY = "brandlab:idea-search-open";
const QUERY_KEY = "brandlab:idea-search-q";
const BOX_KEY = "brandlab:idea-search-box";
const SIDE_WINDOW = "brandlab-cari-ide";
let mounted = null; // { brandId, fab, panel }

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const enc = encodeURIComponent;
const hl = () => (getLang() === "en" ? "en" : "id");

// Inside the panel: Google results, three kinds.
export const FRAME_TABS = [
  { key: "web", url: (q) => `https://www.google.com/search?igu=1&hl=${hl()}&gl=id&q=${enc(q)}` },
  { key: "video", url: (q) => `https://www.google.com/search?igu=1&hl=${hl()}&gl=id&udm=7&q=${enc(q)}` },
  { key: "image", url: (q) => `https://www.google.com/search?igu=1&hl=${hl()}&gl=id&udm=2&q=${enc(q)}` },
];

// In the side window: the places where content ideas actually live.
export const SITES = [
  { key: "tiktok", platform: true, url: (q) => `https://www.tiktok.com/search?q=${enc(q)}` },
  { key: "instagram", platform: true, url: (q) => `https://www.instagram.com/explore/search/keyword/?q=${enc(q)}` },
  { key: "youtube", platform: true, url: (q) => `https://www.youtube.com/results?search_query=${enc(`${q} #shorts`)}` },
  { key: "pinterest", icon: "image", url: (q) => `https://id.pinterest.com/search/pins/?q=${enc(q)}` },
  { key: "trends", icon: "chart", url: (q) => `https://trends.google.com/trends/explore?geo=ID&hl=${hl()}&q=${enc(q)}` },
  { key: "google", icon: "search", url: (q) => `https://www.google.com/search?hl=${hl()}&q=${enc(q)}` },
];

// A real browser window on the right side of the screen, beside the app.
export function openSideWindow(url) {
  const phone = window.matchMedia?.("(max-width: 720px)").matches;
  if (phone) return window.open(url, "_blank", "noopener");
  const sw = window.screen || {};
  const availW = sw.availWidth || window.outerWidth || 1280;
  const availH = sw.availHeight || window.outerHeight || 800;
  const w = Math.round(Math.min(560, Math.max(400, availW * 0.34)));
  const left = (sw.availLeft || 0) + availW - w;
  const top = sw.availTop || 0;
  const win = window.open(url, SIDE_WINDOW, `popup=yes,width=${w},height=${availH},left=${left},top=${top}`);
  // A blocked popup: fall back to a plain new tab.
  if (!win) return window.open(url, "_blank", "noopener");
  try { win.focus(); } catch { /* cross-origin already */ }
  return win;
}

// ---- "Lagi dicari orang" ------------------------------------------------------
// Google's autocomplete as JSONP (client=youtube answers with a callback).
// ds=yt = what people search on YouTube; without it, on Google.
let jsonpSeq = 0;
function jsonp(url, timeout = 5000) {
  return new Promise((resolve) => {
    const cb = `__ideaSuggest${++jsonpSeq}`;
    const s = document.createElement("script");
    const done = (val) => { delete window[cb]; s.remove(); clearTimeout(timer); resolve(val); };
    const timer = setTimeout(() => done(null), timeout);
    window[cb] = (data) => done(data);
    s.onerror = () => done(null);
    s.src = `${url}&callback=${cb}`;
    document.head.append(s);
  });
}

// Up to `max` phrases, YouTube first, without the keyword itself.
export function mergeSuggestions(q, lists, max = 10) {
  const seen = new Set([q.trim().toLowerCase()]);
  const out = [];
  const rows = lists.map((l) => (Array.isArray(l?.[1]) ? l[1].map((x) => String(Array.isArray(x) ? x[0] : x)) : []));
  for (let i = 0; out.length < max && rows.some((r) => i < r.length); i++) {
    for (const r of rows) {
      const v = (r[i] || "").trim();
      const k = v.toLowerCase();
      if (v && !seen.has(k)) { seen.add(k); out.push(v); }
      if (out.length >= max) break;
    }
  }
  return out;
}

async function suggestions(q) {
  const base = `https://suggestqueries.google.com/complete/search?client=youtube&hl=${hl()}&gl=id&q=${enc(q)}`;
  const [yt, web] = await Promise.all([jsonp(`${base}&ds=yt`), jsonp(base)]);
  return mergeSuggestions(q, [yt, web]);
}

// ---- The panel -----------------------------------------------------------------
const state = { q: "", tab: "web", suggest: [], suggestFor: "" };

function panelHTML() {
  const q = state.q;
  return `
    <div class="isr-head" data-drag>
      <span class="isr-title">${icon("search", { size: 14 })}${t("isr.title")}</span>
      <span class="isr-head-actions">
        <button type="button" class="icon-btn" data-isr-popout ${q ? "" : "disabled"} aria-label="${esc(t("isr.popout"))}" title="${esc(t("isr.popout"))}">${icon("expand", { size: 14 })}</button>
        <button type="button" class="icon-btn" data-isr-close aria-label="${esc(t("common.close"))}" title="${esc(t("common.close"))}">${icon("x", { size: 14 })}</button>
      </span>
    </div>
    <form class="isr-form" data-isr-form>
      <input class="input isr-q" name="q" value="${esc(q)}" placeholder="${esc(t("isr.ph"))}" autocomplete="off" aria-label="${esc(t("isr.title"))}" />
      <button type="submit" class="btn btn-primary btn-sm">${t("isr.go")}</button>
    </form>
    <div class="isr-suggest" ${state.suggest.length ? "" : "hidden"}>
      <span class="isr-k">${t("isr.people")}</span>
      <div class="isr-chips">${state.suggest.map((s) => `<button type="button" class="isr-chip" data-isr-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
    </div>
    <div class="isr-tabs" role="tablist">
      ${FRAME_TABS.map((f) => `<button type="button" role="tab" class="${state.tab === f.key ? "is-on" : ""}" aria-selected="${state.tab === f.key}" data-isr-tab="${f.key}">${t(`isr.tab.${f.key}`)}</button>`).join("")}
    </div>
    <div class="isr-frame">
      ${q
        ? `<iframe title="${esc(t("isr.title"))}" src="${esc(FRAME_TABS.find((f) => f.key === state.tab).url(q))}" referrerpolicy="no-referrer"></iframe>`
        : `<div class="isr-empty">${icon("bulb", { size: 22 })}<b>${t("isr.emptyTitle")}</b><span>${t("isr.emptyBody")}</span></div>`}
    </div>
    <p class="isr-note text-faint">${t("isr.frameNote")}</p>
    <div class="isr-sites">
      <span class="isr-k">${t("isr.openIn")}</span>
      <div class="isr-site-row">${SITES.map((s) => `<button type="button" class="isr-site" data-isr-site="${s.key}" ${q ? "" : "disabled"} title="${esc(t("isr.siteTitle", { site: t(`isr.site.${s.key}`) }))}">${s.platform ? platformIcon(s.key) : icon(s.icon, { size: 13 })}<span>${t(`isr.site.${s.key}`)}</span></button>`).join("")}</div>
    </div>
    <form class="isr-save" data-isr-save>
      <input class="input" name="idea" placeholder="${esc(t("isr.notePh"))}" autocomplete="off" aria-label="${esc(t("isr.notePh"))}" />
      <button type="submit" class="btn btn-secondary btn-sm" title="${esc(t("isr.saveTitle"))}">${icon("bookmark", { size: 13 })}${t("isr.save")}</button>
      <button type="button" class="btn btn-ghost btn-sm" data-isr-chat title="${esc(t("isr.chatTitle"))}">${icon("chat", { size: 13 })}${t("isr.chat")}</button>
    </form>`;
}

function paint() {
  if (!mounted || mounted.panel.hidden) return;
  mounted.panel.innerHTML = panelHTML();
}

async function search(q) {
  state.q = String(q || "").trim();
  store.set(QUERY_KEY, state.q);
  paint();
  if (!state.q || state.suggestFor === state.q) return;
  const asked = state.q;
  const list = await suggestions(asked);
  if (state.q !== asked) return;
  state.suggest = list;
  state.suggestFor = asked;
  if (!mounted || mounted.panel.hidden) return;
  // Only the chips: repainting would reload the Google frame.
  const box = qs(".isr-suggest", mounted.panel);
  if (!box) return;
  box.hidden = !list.length;
  box.querySelector(".isr-chips").innerHTML = list.map((s) => `<button type="button" class="isr-chip" data-isr-q="${esc(s)}">${esc(s)}</button>`).join("");
}

function wire(panel) {
  panel.addEventListener("submit", (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.matches("[data-isr-form]")) { search(form.q.value); return; }
    if (form.matches("[data-isr-save]")) {
      const text = form.idea.value.trim();
      if (!text) { form.idea.focus(); return; }
      if (addBrandIdea(mounted.brandId, { text, source: "web", notes: state.q ? t("isr.savedFrom", { q: state.q }) : "" })) {
        form.idea.value = "";
        toast(t("isr.saved"));
      }
    }
  });
  panel.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-isr-close")) return setOpen(false);
    if (b.dataset.isrQ) return search(b.dataset.isrQ);
    if (b.dataset.isrTab) { state.tab = b.dataset.isrTab; return paint(); }
    if (b.dataset.isrSite) return openSideWindow(SITES.find((s) => s.key === b.dataset.isrSite).url(state.q));
    if (b.hasAttribute("data-isr-popout")) return openSideWindow(FRAME_TABS.find((f) => f.key === state.tab).url(state.q).replace("igu=1&", ""));
    if (b.hasAttribute("data-isr-chat")) {
      const note = qs("[data-isr-save] input", panel)?.value.trim() || "";
      const seed = note ? t("isr.chatSeed", { idea: note }) : state.q ? t("isr.chatSeedQ", { q: state.q }) : "";
      const { openConsultantPanel } = await import("./consultant-panel.js");
      openConsultantPanel({ seed });
    }
  });
  dragAndKeep(panel);
}

// The header drags the panel; where it was left (and its size, CSS resize)
// is kept for next time.
function dragAndKeep(panel) {
  const saved = (() => { try { return JSON.parse(store.get(BOX_KEY) || "null"); } catch { return null; } })();
  const place = (box) => {
    if (!box || window.matchMedia?.("(max-width: 720px)").matches) return;
    const w = Math.min(box.w || 420, window.innerWidth - 16);
    const h = Math.min(box.h || 600, window.innerHeight - 16);
    Object.assign(panel.style, {
      width: `${w}px`, height: `${h}px`,
      left: `${Math.max(8, Math.min(box.x, window.innerWidth - w - 8))}px`,
      top: `${Math.max(8, Math.min(box.y, window.innerHeight - h - 8))}px`,
      right: "auto", bottom: "auto",
    });
  };
  place(saved);
  const keep = () => {
    const r = panel.getBoundingClientRect();
    if (r.width) store.set(BOX_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
  };
  panel.addEventListener("pointerdown", (e) => {
    const head = e.target.closest("[data-drag]");
    if (!head || e.target.closest("button") || window.matchMedia?.("(max-width: 720px)").matches) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    panel.classList.add("is-dragging");
    head.setPointerCapture(e.pointerId);
    const move = (ev) => place({ x: ev.clientX - dx, y: ev.clientY - dy, w: r.width, h: r.height });
    const up = () => {
      panel.classList.remove("is-dragging");
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      keep();
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });
  // A resize by the corner handle.
  if ("ResizeObserver" in window) {
    let t0 = 0;
    new ResizeObserver(() => { clearTimeout(t0); t0 = setTimeout(() => { if (!panel.hidden && panel.style.left) keep(); }, 300); }).observe(panel);
  }
}

function setOpen(open) {
  if (!mounted) return;
  const { panel, fab } = mounted;
  panel.hidden = !open;
  fab.classList.toggle("is-open", open);
  fab.setAttribute("aria-expanded", String(open));
  store.set(OPEN_KEY, open ? "1" : "0");
  if (!open) return;
  paint();
  const input = qs(".isr-q", panel);
  input?.focus();
  input?.select();
  if (state.q && state.suggestFor !== state.q) search(state.q);
}

// Opens the panel, optionally on a keyword (Creator's Ide step, the chat).
export function openIdeaSearch(q = "") {
  if (!mounted) return;
  if (q) state.q = String(q).trim();
  setOpen(true);
  if (q) search(state.q);
}

export function mountIdeaSearch(brandId) {
  if (mounted?.brandId === brandId) return;
  unmountIdeaSearch();
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "isr-fab";
  fab.setAttribute("aria-label", t("isr.title"));
  fab.setAttribute("aria-expanded", "false");
  fab.title = t("isr.fabTitle");
  fab.innerHTML = icon("search", { size: 18 });
  const panel = document.createElement("div");
  panel.className = "isr-float";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("isr.title"));
  document.body.append(fab, panel);
  fab.addEventListener("click", () => setOpen(panel.hidden));
  mounted = { brandId, fab, panel };
  wire(panel);
  state.q = store.get(QUERY_KEY);
  if (store.get(OPEN_KEY) === "1") setOpen(true);
}

export function unmountIdeaSearch() {
  if (!mounted) return;
  mounted.fab.remove();
  mounted.panel.remove();
  mounted = null;
}
