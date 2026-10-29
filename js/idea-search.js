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
// Mounted/unmounted per render by js/layout.js; opened from the Coretan
// button's menu (js/notes-float.js) or Creator's Ide step.
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
// One column, top to bottom: the search bar, what people search (after a
// search), the result kind + "Buka di", the results, and a line to note an
// idea. Before a search there is only the bar and a short explainer.
const state = { q: "", tab: "web", suggest: [], suggestFor: "", menu: false, read: { phase: "idle", pct: 0, text: "", msg: "" }, readHot: false };
const SUGGEST_SHOWN = 4;

const chipsHTML = (list) => list.slice(0, SUGGEST_SHOWN).map((s) => `<button type="button" class="isr-chip" data-isr-q="${esc(s)}">${esc(s)}</button>`).join("");
const siteIcon = (s) => (s.platform ? platformIcon(s.key) : icon(s.icon, { size: 15 }));

// "Baca hasilnya ke chat": the results on screen are read (js/web-read.js)
// and handed to Tanya Brandlab, which answers from them. One strip under the
// tabs that changes with where the reading is.
function readHTML() {
  const r = state.read;
  if (r.phase === "ask") return `<div class="isr-read-status"><i class="isr-spin"></i><span>${t("isr.read.ask")}</span></div>`;
  if (r.phase === "ocr") return `<div class="isr-read-status"><i class="isr-spin"></i><span>${t("isr.read.ocr", { n: r.pct })}</span><b class="isr-read-bar"><i style="width:${r.pct}%"></i></b></div>`;
  if (r.phase === "preview") {
    return `<div class="isr-read-preview"><p>${t("isr.read.previewNote")}</p><textarea class="textarea" data-isr-read-text rows="5">${esc(r.text)}</textarea><div class="isr-read-actions"><button type="button" class="btn btn-primary btn-sm" data-isr-read-send>${t("isr.read.send")}</button><button type="button" class="btn btn-ghost btn-sm" data-isr-read-cancel>${t("common.cancel")}</button></div></div>`;
  }
  if (r.phase === "done") return `<div class="isr-read-status is-done">${icon("check", { size: 15 })}<span>${t("isr.read.sent")}</span></div>`;
  return `${r.phase === "error" ? `<p class="isr-read-err">${icon("info", { size: 13 })}<span>${esc(r.msg)}</span></p>` : ""}
    <button type="button" class="isr-read-btn${state.readHot ? " is-hot" : ""}" data-isr-read>${icon("eye", { size: 16 })}<span>${t(r.phase === "error" ? "isr.read.again" : "isr.read")}</span></button>
    <span class="isr-read-hint">${t("isr.readHint")}</span>`;
}

function setRead(patch) {
  Object.assign(state.read, patch);
  const wrap = mounted && qs("[data-isr-read-wrap]", mounted.panel);
  if (wrap) wrap.innerHTML = readHTML();
}

async function sendRead(text) {
  const { openConsultantPanel } = await import("./consultant-panel.js");
  openConsultantPanel({ seed: t("isr.read.msg", { q: state.q }), send: true, engine: "brainstorm", web: { q: state.q, text } });
  setRead({ phase: "done", text: "" });
  setTimeout(() => { if (state.read.phase === "done") setRead({ phase: "idle" }); }, 3500);
}

async function doRead() {
  if (!mounted || ["ask", "ocr"].includes(state.read.phase)) return;
  state.readHot = false;
  const { readScreenText, screenReadSupported } = await import("./web-read.js");
  if (!screenReadSupported()) return setRead({ phase: "error", msg: t("isr.read.err.unsupported") });
  try {
    const frame = qs(".isr-frame iframe", mounted.panel);
    const { text, whole } = await readScreenText(frame, { onStatus: (phase, pct = 0) => setRead({ phase, pct }) });
    if (text.length < 40) return setRead({ phase: "error", msg: t("isr.read.err.empty") });
    if (whole) return setRead({ phase: "preview", text });
    await sendRead(text);
  } catch (err) {
    setRead({ phase: "error", msg: t(`isr.read.err.${err?.code === "denied" || err?.code === "unsupported" ? err.code : "failed"}`) });
  }
}

function panelHTML() {
  const q = state.q;
  return `
    <div class="isr-head" data-drag>
      <span class="isr-title"><span class="isr-title-dot">${icon("search", { size: 13 })}</span>${t("isr.title")}</span>
      <button type="button" class="isr-x" data-isr-close aria-label="${esc(t("common.close"))}" title="${esc(t("common.close"))}">${icon("x", { size: 15 })}</button>
    </div>
    <form class="isr-bar" data-isr-form role="search">
      ${icon("search", { size: 15 })}
      <input class="isr-q" name="q" value="${esc(q)}" placeholder="${esc(t("isr.ph"))}" autocomplete="off" aria-label="${esc(t("isr.title"))}" />
      <button type="submit" class="isr-go">${t("isr.go")}</button>
    </form>
    ${q ? `
    <div class="isr-suggest" ${state.suggest.length ? "" : "hidden"}>
      <span class="isr-k">${icon("flame", { size: 12 })}${t("isr.people")}</span>
      <div class="isr-chips">${chipsHTML(state.suggest)}</div>
    </div>
    <div class="isr-toolbar">
      <div class="isr-tabs" role="tablist" aria-label="${esc(t("isr.title"))}">
        ${FRAME_TABS.map((f) => `<button type="button" role="tab" class="${state.tab === f.key ? "is-on" : ""}" aria-selected="${state.tab === f.key}" data-isr-tab="${f.key}">${t(`isr.tab.${f.key}`)}</button>`).join("")}
      </div>
      <div class="isr-open">
        <button type="button" class="isr-open-btn" data-isr-menu aria-haspopup="menu" aria-expanded="${state.menu}" title="${esc(t("isr.frameNote"))}">${t("isr.openIn")}${icon("chevronDown", { size: 13 })}</button>
        <div class="isr-menu" role="menu" ${state.menu ? "" : "hidden"}>
          <p class="isr-menu-note">${t("isr.menuNote")}</p>
          ${SITES.map((s) => `<button type="button" role="menuitem" data-isr-site="${s.key}">${siteIcon(s)}<span>${t(`isr.site.${s.key}`)}</span>${icon("arrowRight", { size: 12 })}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="isr-read" data-isr-read-wrap>${readHTML()}</div>
    <div class="isr-frame">
      <iframe title="${esc(t("isr.title"))}" src="${esc(FRAME_TABS.find((f) => f.key === state.tab).url(q))}" referrerpolicy="no-referrer"></iframe>
    </div>
    <form class="isr-save" data-isr-save>
      <input class="input" name="idea" placeholder="${esc(t("isr.notePh"))}" autocomplete="off" aria-label="${esc(t("isr.notePh"))}" />
      <button type="submit" class="btn btn-primary btn-sm" title="${esc(t("isr.saveTitle"))}">${t("isr.save")}</button>
      <button type="button" class="isr-chat" data-isr-chat aria-label="${esc(t("isr.chatTitle"))}" title="${esc(t("isr.chatTitle"))}">${icon("chat", { size: 15 })}</button>
    </form>` : `
    <div class="isr-empty">
      <div class="isr-empty-art">${icon("bulb", { size: 26 })}</div>
      <b>${t("isr.emptyTitle")}</b>
      <span>${t("isr.emptyBody")}</span>
      <div class="isr-empty-sites">${SITES.slice(0, 5).map((s) => `<span title="${esc(t(`isr.site.${s.key}`))}">${siteIcon(s)}</span>`).join("")}</div>
    </div>`}`;
}

function paint() {
  if (!mounted || mounted.panel.hidden) return;
  mounted.panel.innerHTML = panelHTML();
}

function setMenu(open) {
  state.menu = open;
  const menu = mounted && qs(".isr-menu", mounted.panel);
  if (!menu) return;
  menu.hidden = !open;
  qs("[data-isr-menu]", mounted.panel)?.setAttribute("aria-expanded", String(open));
}

async function search(q) {
  state.q = String(q || "").trim();
  state.menu = false;
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
  box.querySelector(".isr-chips").innerHTML = chipsHTML(list);
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
    if (!b?.hasAttribute("data-isr-menu") && !e.target.closest(".isr-menu")) setMenu(false);
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-isr-close")) return setOpen(false);
    if (b.hasAttribute("data-isr-menu")) return setMenu(!state.menu);
    if (b.hasAttribute("data-isr-read")) return doRead();
    if (b.hasAttribute("data-isr-read-cancel")) return setRead({ phase: "idle", text: "" });
    if (b.hasAttribute("data-isr-read-send")) {
      const text = qs("[data-isr-read-text]", panel)?.value.trim() || "";
      return text ? sendRead(text.slice(0, 3500)) : setRead({ phase: "idle" });
    }
    if (b.dataset.isrQ) return search(b.dataset.isrQ);
    if (b.dataset.isrTab) { state.tab = b.dataset.isrTab; state.menu = false; return paint(); }
    if (b.dataset.isrSite) {
      setMenu(false);
      return openSideWindow(SITES.find((s) => s.key === b.dataset.isrSite).url(state.q));
    }
    if (b.hasAttribute("data-isr-chat")) {
      const note = qs("[data-isr-save] input", panel)?.value.trim() || "";
      const seed = note ? t("isr.chatSeed", { idea: note }) : state.q ? t("isr.chatSeedQ", { q: state.q }) : "";
      const { openConsultantPanel } = await import("./consultant-panel.js");
      openConsultantPanel({ seed });
    }
  });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (state.menu) setMenu(false); else setOpen(false); } });
  dragAndKeep(panel);
}

// The header drags the panel; where it was left (and its size, CSS resize)
// is kept for next time.
function dragAndKeep(panel) {
  const saved = (() => { try { return JSON.parse(store.get(BOX_KEY) || "null"); } catch { return null; } })();
  const place = (box) => {
    if (!box || window.matchMedia?.("(max-width: 720px)").matches) return;
    const w = Math.min(box.w || 460, window.innerWidth - 16);
    const h = Math.min(box.h || 640, window.innerHeight - 16);
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

// No button of its own: it opens from the Coretan button's menu
// (js/notes-float.js) and Creator's Ide step. Opening one floating panel
// closes the other — "brandlab:tools" says which one is open.
export const TOOLS_EVENT = "brandlab:tools";
const announce = (open) => window.dispatchEvent(new CustomEvent(TOOLS_EVENT, { detail: { tool: "search", open } }));

function setOpen(open) {
  if (!mounted) return;
  const { panel } = mounted;
  if (panel.hidden === !open) return;
  panel.hidden = !open;
  store.set(OPEN_KEY, open ? "1" : "0");
  announce(open);
  if (!open) { state.menu = false; return; }
  paint();
  const input = qs(".isr-q", panel);
  input?.focus();
  input?.select();
  if (state.q && state.suggestFor !== state.q) search(state.q);
}

export const isIdeaSearchOpen = () => !!mounted && !mounted.panel.hidden;
export const closeIdeaSearch = () => setOpen(false);

// Opens the panel, optionally on a keyword (Creator's Ide step).
export function openIdeaSearch(q = "", { read = false } = {}) {
  if (!mounted) return;
  if (q) state.q = String(q).trim();
  // Opened from a chat card: the reading button is the next thing to press.
  state.readHot = read;
  if (state.read.phase !== "ask" && state.read.phase !== "ocr") state.read = { phase: "idle", pct: 0, text: "", msg: "" };
  setOpen(true);
  if (q) search(state.q);
}

export function mountIdeaSearch(brandId) {
  if (mounted?.brandId === brandId) return;
  unmountIdeaSearch();
  const panel = document.createElement("div");
  panel.className = "isr-float";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("isr.title"));
  document.body.append(panel);
  const onTools = (e) => { if (e.detail?.tool !== "search" && e.detail?.open) setOpen(false); };
  window.addEventListener(TOOLS_EVENT, onTools);
  mounted = { brandId, panel, onTools };
  wire(panel);
  state.q = store.get(QUERY_KEY);
  if (store.get(OPEN_KEY) === "1") setOpen(true);
}

export function unmountIdeaSearch() {
  if (!mounted) return;
  window.removeEventListener(TOOLS_EVENT, mounted.onTools);
  mounted.panel.remove();
  mounted = null;
}
