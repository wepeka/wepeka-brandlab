// Antrean Video → Footage: the bank of the shoot's raw clips (owner,
// 2026-11-12: "buat sistem di brandlab aku bisa view secara mudah video mana
// yang sudah ada footage2nya dan aku bisa lihat bank footage").
//
// The crew sends the clips on the Syuting step (js/footage.js) into the
// client's Google Drive, and Wepeka's Mac copies them into each piece's
// Outbox folder (js/footage-mac.js). This view shows them all for the brand
// open in the app, one block per piece (newest arrivals first), each clip a
// still you can tap to watch — played from the Mac copy, or straight from the
// client's Drive when it isn't on the Mac yet. On top: the video pieces that
// are already at Syuting or Edit and still have no footage, so nothing waits
// unnoticed. The Galeri tiles carry the clip count too.
import { listContent, getBrand, getContent, localISODate } from "./store.js";
import { canUsePosting, clientsOf, folderKeyOf, usesOutbox, outboxInfo, openPosting } from "./posting.js";
import { macName, macProgress, onMacProgress, footageDriveURL } from "./footage-mac.js";
import { outboxClipFile, FOOTAGE_DIR } from "./outbox.js";
import { videoCode, codedPiece } from "./video-codes.js";
import { icon } from "./icons.js";
import { qs, qsa, escapeHtml, toast } from "./dom.js";
import { t, getLang } from "./i18n.js";

// ---- plain helpers (tests/footage-bank.test.mjs) ------------------------------
const FORMAT_TYPE = { Reels: "reels", Carousel: "carousel", "Static Post": "foto", Story: "story" };
const typeOfPiece = (c) => c.posting?.type || FORMAT_TYPE[c.format] || "reels";
const clipsOf = (c) => (Array.isArray(c?.footage?.files) ? c.footage.files : []);
export const footageCount = (c) => clipsOf(c).length;

// When the camera took it, read from the name the camera gave it:
// DJI_20261111182103_0456_D.MP4, PXL_20261111_182103123.mp4,
// VID_20261111_182103.mp4, "2026-11-11 18.21.03.mov". IMG_0412.MOV says
// nothing: null.
export function shotAt(name) {
  const s = String(name || "");
  const m = /(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[_-]?([01]\d|2[0-3])([0-5]\d)([0-5]\d)/.exec(s)
    || /(?:^|\D)(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ _T]([01]\d|2[0-3])[.:-]([0-5]\d)[.:-]([0-5]\d)/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const at = new Date(y, mo - 1, d, h, mi, se);
  return at.getMonth() === mo - 1 ? at.getTime() : null;
}

// The clips of a piece in the order they were shot (the camera's time, else
// when they arrived), the name breaking a tie.
export function clipsInOrder(c) {
  const when = (f) => shotAt(f.name) ?? (Number(f.at) || 0);
  return clipsOf(c).slice().sort((a, b) => when(a) - when(b) || String(a.name).localeCompare(String(b.name)));
}

const lastArrival = (c) => clipsOf(c).reduce((m, f) => Math.max(m, Number(f.at) || 0), 0);
// The pieces that have footage, the newest arrival first.
export const footagePieces = (contents) => contents.filter((c) => footageCount(c)).sort((a, b) => lastArrival(b) - lastArrival(a));

export function footageTotals(pieces) {
  const clips = pieces.flatMap(clipsOf);
  return { pieces: pieces.length, clips: clips.length, bytes: clips.reduce((s, f) => s + (Number(f.size) || 0), 0) };
}

// A video piece waiting on the shoot: at Syuting or Edit, no clip and no cut
// yet (a trial or a carousel needs no shoot of its own).
export function needsFootage(c) {
  if (!c || c.trialOf || !codedPiece(c)) return false;
  if (!["reels", "story"].includes(typeOfPiece(c))) return false;
  if (!["production", "editing"].includes(c.status)) return false;
  return !footageCount(c) && !(c.posting?.versions || []).length;
}
export const waitingForFootage = (contents) => contents.filter(needsFootage)
  .sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999") || (a.videoNo || 0) - (b.videoNo || 0));

// The view is there for Wepeka on a brand whose client's crew shoots (or
// that already has footage).
export function showsFootage(brandId) {
  const b = getBrand(brandId);
  return canUsePosting() && !!b && (clientsOf(b).length > 0 || listContent(b.id).some(footageCount));
}

// ---- numbers on screen --------------------------------------------------------
const loc = () => (getLang() === "en" ? "en-US" : "id-ID");
export function sizeLabel(n) {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toLocaleString(loc(), { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(0.1, v / 1024 ** 2).toLocaleString(loc(), { maximumFractionDigits: v >= 100 * 1024 ** 2 ? 0 : 1 })} MB`;
}
const two = (n) => String(n).padStart(2, "0");
export const durLabel = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${two(Math.round(s % 60) === 60 ? 59 : Math.round(s % 60))}` : "");
const hm = (ms) => new Date(ms).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
const dayLabel = (ms) => new Date(ms).toLocaleDateString(loc(), { day: "numeric", month: "short" });
const stamp = (ms) => new Date(ms).toLocaleString(loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const kindOf = (f) => (/^audio\//.test(f.type || "") || /\.(wav|m4a|mp3|aac|aiff?|flac)$/i.test(f.name || "") ? "audio"
  : /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|heic|heif|dng)$/i.test(f.name || "") ? "image" : "video");
const KIND_ICON = { audio: "mic", image: "image", video: "film" };

// The days the shoot spans, from the cameras' clocks: "11 Nov", "10–11 Nov".
function shootDays(c) {
  const days = [...new Set(clipsOf(c).map((f) => shotAt(f.name)).filter(Boolean).map((ms) => localISODate(new Date(ms))))].sort();
  if (!days.length) return "";
  const d = (iso) => new Date(`${iso}T00:00:00`);
  if (days.length === 1) return dayLabel(d(days[0]).getTime());
  return `${dayLabel(d(days[0]).getTime())} – ${dayLabel(d(days[days.length - 1]).getTime())}`;
}

// ---- the page -------------------------------------------------------------------
const FIRST = 24; // clips shown per piece before "see all"

function clipHTML(c, f, i) {
  const shot = shotAt(f.name);
  const kind = kindOf(f);
  const base = String(f.name || "").replace(/\.[A-Za-z0-9]+$/, "");
  return `<button type="button" class="fb-clip is-${kind}" data-fb-clip="${escapeHtml(c.id)}" data-i="${i}" title="${escapeHtml(f.name)}">
      <span class="fb-clip-img" data-fb-thumb="${escapeHtml(f.id)}">${icon(KIND_ICON[kind], { size: 20 })}</span>
      <span class="fb-clip-dur" data-fb-dur="${escapeHtml(f.id)}"></span>
      <span class="fb-clip-cap">${shot ? `${icon("clock", { size: 11 })}${hm(shot)}` : escapeHtml(base.length > 14 ? `…${base.slice(-12)}` : base)}</span>
    </button>`;
}

// A shoot over more than one day: the day's name before its first clip.
const dayOf = (f) => { const ms = shotAt(f.name); return ms ? localISODate(new Date(ms)) : ""; };
function gridHTML(c, shown) {
  const multi = new Set(clipsOf(c).map(dayOf).filter(Boolean)).size > 1;
  let day = null;
  return shown.map((f, i) => {
    const d = dayOf(f);
    const head = multi && d && d !== day ? `<div class="fb-day">${escapeHtml(new Date(`${d}T00:00:00`).toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" }))}</div>` : "";
    if (d) day = d;
    return head + clipHTML(c, f, i);
  }).join("");
}

function macLine(c) {
  if (!usesOutbox() || !outboxInfo().connected) return "";
  const p = macProgress(c.id);
  if (!p) return "";
  if (p.name) return `<span class="fb-mac is-busy" data-fb-mac="${escapeHtml(c.id)}">${icon("download", { size: 13 })}${t("pq.ft.macCopying", { done: p.done, total: p.total })}</span>`;
  if (p.done < p.total) return `<span class="fb-mac is-off" data-fb-mac="${escapeHtml(c.id)}">${icon("cloud", { size: 13 })}${t("pq.ft.macPart", { done: p.done, total: p.total })}</span>`;
  return `<span class="fb-mac is-on" data-fb-mac="${escapeHtml(c.id)}">${icon("check", { size: 13 })}${t("pq.ft.macAll", { n: p.total })}</span>`;
}

function pieceHTML(c, ui, whenLabel) {
  const clips = clipsInOrder(c);
  const code = videoCode(c);
  const bytes = clips.reduce((s, f) => s + (Number(f.size) || 0), 0);
  const last = clips.reduce((m, f) => ((Number(f.at) || 0) > (Number(m?.at) || 0) ? f : m), null);
  const days = shootDays(c);
  const all = ui.fbOpen?.has(c.id);
  const shown = all ? clips : clips.slice(0, FIRST);
  const bits = [
    t("pq.ft.clips", { n: clips.length }),
    sizeLabel(bytes),
    days ? t("pq.ft.shot", { day: days }) : "",
  ].filter(Boolean).join(" · ");
  return `<section class="fb-piece" data-fb-piece="${escapeHtml(c.id)}">
      <header class="fb-head">
        ${code ? `<button type="button" class="fb-code" data-copy="${escapeHtml(code)}" title="${escapeHtml(t("post.code.copy"))}">${escapeHtml(code)}</button>` : ""}
        <div class="fb-head-txt">
          <b>${escapeHtml(c.title || t("common.untitled"))}</b>
          <small>${icon("calendar", { size: 12 })}${escapeHtml(c.scheduleDate ? whenLabel(c) : t("pq.noDate"))}<span class="fb-dot">·</span>${escapeHtml(bits)}</small>
          ${last?.at ? `<small class="fb-last">${icon("upload", { size: 12 })}${escapeHtml(t(last.who ? "pq.ft.lastBy" : "pq.ft.last", { when: stamp(last.at), who: last.who || "" }))}</small>` : ""}
        </div>
        <div class="fb-head-end">
          ${macLine(c)}
          <button type="button" class="btn btn-secondary btn-sm" data-fb-open="${escapeHtml(c.id)}">${icon("play", { size: 13 })}${t("pq.ft.openPiece")}</button>
        </div>
      </header>
      <div class="fb-grid">${gridHTML(c, shown)}</div>
      ${clips.length > shown.length ? `<button type="button" class="fb-more" data-fb-more="${escapeHtml(c.id)}">${t("pq.ft.seeAll", { n: clips.length })}${icon("chevronDown", { size: 15 })}</button>` : ""}
    </section>`;
}

function waitHTML(list, whenLabel) {
  if (!list.length) return "";
  const today = localISODate();
  return `<section class="fb-wait">
      <div class="fb-wait-head"><b>${icon("clock", { size: 15 })}${t("pq.ft.waitTitle")}</b><span class="fb-n">${list.length}</span><small>${t("pq.ft.waitLead")}</small></div>
      <div class="fb-wait-list">${list.map((c) => {
        const soon = c.scheduleDate && c.scheduleDate <= addDaysISO(today, 2);
        const late = c.scheduleDate && c.scheduleDate < today;
        return `<button type="button" class="fb-wait-chip ${late ? "is-late" : soon ? "is-soon" : ""}" data-fb-open="${escapeHtml(c.id)}" data-fb-step="shoot">
          ${videoCode(c) ? `<em>${escapeHtml(videoCode(c))}</em>` : ""}<span>${escapeHtml(c.title || t("common.untitled"))}</span><small>${escapeHtml(c.scheduleDate ? whenLabel(c) : t("pq.noDate"))}</small>
        </button>`;
      }).join("")}</div>
    </section>`;
}
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

export function bankHTML(brandId, ui, { whenLabel }) {
  const contents = listContent(brandId);
  const pieces = footagePieces(contents);
  const waiting = waitingForFootage(contents);
  const sum = footageTotals(pieces);
  const o = outboxInfo();
  const mac = !usesOutbox() ? "" : o.connected
    ? `<span class="fb-sum-src">${icon("folder", { size: 13 })}${t("pq.ft.srcMac", { name: escapeHtml(o.name) })}</span>`
    : `<span class="fb-sum-src is-off">${icon("cloud", { size: 13 })}${t("pq.ft.srcDrive")}</span>`;
  return `<div class="fb">
      <div class="fb-sum">
        <span class="fb-sum-ic">${icon("film", { size: 20 })}</span>
        <span class="fb-sum-txt"><b>${t("pq.ft.sum", { n: sum.clips, size: sizeLabel(sum.bytes) })}</b><small>${t("pq.ft.sumPieces", { n: sum.pieces })}</small></span>
        ${mac}
      </div>
      ${waitHTML(waiting, whenLabel)}
      ${pieces.length ? pieces.map((c) => pieceHTML(c, ui, whenLabel)).join("") : `<div class="pq-empty">${icon("film", { size: 20 })}<span>${t("pq.ft.empty")}</span></div>`}
    </div>`;
}

// ---- stills: a frame of each clip, made once and kept --------------------------
// In memory for the tab, and in IndexedDB so the next visit is instant.
const MEM = new Map(); // clip id → { src, dur, wide } | null (not on the Mac)
const IDB = "brandlab-footage-stills";
function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(IDB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("s");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction("s", mode);
          const req = fn(tx.objectStore("s"));
          tx.oncomplete = () => resolve(req?.result);
          tx.onerror = () => resolve(undefined);
        } catch { resolve(undefined); }
      };
    } catch { resolve(undefined); }
  });
}

function still(file, kind) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (out) => { if (done) return; done = true; clearTimeout(timer); URL.revokeObjectURL(url); resolve(out); };
    const timer = setTimeout(() => finish(null), 20_000);
    const draw = (src, w, h, dur) => {
      const cv = document.createElement("canvas");
      const W = 200;
      cv.width = W;
      cv.height = Math.max(1, Math.round((W * (h || 16)) / (w || 9)));
      try {
        cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
        finish({ src: cv.toDataURL("image/jpeg", 0.7), dur: dur || 0, wide: (w || 9) > (h || 16) });
      } catch { finish(null); }
    };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => draw(img, img.naturalWidth, img.naturalHeight, 0);
      img.onerror = () => finish(null);
      img.src = url;
      return;
    }
    const m = document.createElement(kind === "audio" ? "audio" : "video");
    m.muted = true;
    m.preload = "metadata";
    m.onerror = () => finish(null);
    if (kind === "audio") {
      m.onloadedmetadata = () => finish({ src: "", dur: m.duration || 0, wide: false });
    } else {
      m.playsInline = true;
      m.onloadedmetadata = () => { m.currentTime = Math.min(1, (m.duration || 3) / 4); };
      m.onseeked = () => draw(m, m.videoWidth, m.videoHeight, m.duration);
    }
    m.src = url;
  });
}

const queue = [];
let running = 0;
function pump() {
  while (running < 3 && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

async function stillFor(c, f) {
  if (MEM.has(f.id) && MEM.get(f.id)) return MEM.get(f.id);
  const kept = await idb("readonly", (s) => s.get(f.id));
  if (kept) { MEM.set(f.id, kept); return kept; }
  if (!usesOutbox() || !outboxInfo().connected) return null;
  const file = await outboxClipFile(folderKeyOf(c), macName(f.name));
  // Still being copied (or not yet): the size isn't the clip's yet.
  if (!file || (f.size && file.size !== f.size)) { MEM.set(f.id, null); return null; }
  const made = await still(file, kindOf(f));
  if (made) { MEM.set(f.id, made); idb("readwrite", (s) => s.put(made, f.id)); }
  return made;
}

function paintStill(el, out) {
  const tile = el.closest(".fb-clip");
  // Not on the Mac (yet): it still plays, from the client's Drive.
  if (!out) {
    tile?.classList.add("is-cloud");
    if (!el.classList.contains("has-img")) el.innerHTML = `${icon("cloud", { size: 20 })}<small>${t("pq.ft.onDrive")}</small>`;
    return;
  }
  tile?.classList.remove("is-cloud");
  if (out.src) {
    el.style.backgroundImage = `url("${out.src}")`;
    el.classList.add("has-img");
    el.classList.toggle("is-wide", !!out.wide);
  }
  const dur = tile && qs("[data-fb-dur]", tile);
  if (dur && out.dur) dur.textContent = durLabel(out.dur);
}

let seen = null;
function loadStills(root) {
  seen?.disconnect();
  const look = (el) => {
    const tile = el.closest("[data-fb-clip]");
    const c = getContent(tile?.dataset.fbClip);
    const f = c && clipsInOrder(c)[Number(tile.dataset.i)];
    if (!f) return;
    if (MEM.get(f.id)) { paintStill(el, MEM.get(f.id)); return; }
    queue.push(() => stillFor(c, f).then((out) => { if (el.isConnected) paintStill(el, out); }).catch(() => {}));
    pump();
  };
  const els = qsa("[data-fb-thumb]", root);
  if (typeof IntersectionObserver === "undefined") { els.forEach(look); return; }
  seen = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    seen.unobserve(e.target);
    look(e.target);
  }), { rootMargin: "400px 0px" });
  els.forEach((el) => {
    const id = el.dataset.fbThumb;
    if (MEM.get(id)) paintStill(el, MEM.get(id));
    else seen.observe(el);
  });
}

// A piece's copy to the Mac moving on: its header line, and the clips that
// weren't there yet get looked at again.
let offMac = null;
function followMac(root) {
  offMac?.();
  const last = new Map();
  offMac = onMacProgress((id) => {
    if (!root.isConnected) { offMac?.(); offMac = null; return; }
    const sec = qs(`[data-fb-piece="${CSS.escape(id)}"]`, root);
    const c = getContent(id);
    if (!sec || !c) return;
    const line = qs("[data-fb-mac]", sec);
    const html = macLine(c);
    if (line) line.outerHTML = html || "<span data-fb-mac></span>";
    else if (html) qs(".fb-head-end", sec)?.insertAdjacentHTML("afterbegin", html);
    const done = macProgress(id)?.done || 0;
    if (done !== last.get(id)) {
      last.set(id, done);
      qsa(".fb-clip.is-cloud [data-fb-thumb]", sec).forEach((el) => { MEM.delete(el.dataset.fbThumb); });
      if (qs(".fb-clip.is-cloud", sec)) loadStills(root);
    }
  });
}

export function wireBank(root, ui, repaint) {
  qsa("[data-fb-open]", root).forEach((b) => b.addEventListener("click", () => {
    openPosting({ contentId: b.dataset.fbOpen, step: b.dataset.fbStep || "edit", from: t("pq.title") });
  }));
  qsa("[data-fb-more]", root).forEach((b) => b.addEventListener("click", () => {
    ui.fbOpen ||= new Set();
    ui.fbOpen.add(b.dataset.fbMore);
    repaint();
  }));
  qsa("[data-fb-clip]", root).forEach((b) => b.addEventListener("click", () => openClip(b.dataset.fbClip, Number(b.dataset.i))));
  loadStills(root);
  followMac(root);
}

// ---- watching a clip, full screen ------------------------------------------------
function openClip(contentId, start) {
  const c = getContent(contentId);
  const clips = c ? clipsInOrder(c) : [];
  if (!clips.length) return;
  let i = Math.max(0, Math.min(start, clips.length - 1));
  let url = "";
  let turn = 0;
  const el = document.createElement("div");
  el.className = "pq-review fb-player";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", t("pq.ft.player"));
  document.body.appendChild(el);
  document.body.classList.add("pq-review-open");
  const drop = () => { if (url) { URL.revokeObjectURL(url); url = ""; } };
  const close = () => { drop(); el.remove(); document.body.classList.remove("pq-review-open"); document.removeEventListener("keydown", onKey); };
  const key = folderKeyOf(c);
  const brand = getBrand(c.brandId);

  const show = async () => {
    const me = ++turn;
    drop();
    const f = clips[i];
    const kind = kindOf(f);
    const shot = shotAt(f.name);
    const where = `${outboxInfo().name || "Outbox"}/${key}/${FOOTAGE_DIR}/${macName(f.name)}`;
    const facts = [sizeLabel(f.size), shot ? stamp(shot) : "", f.at ? t(f.who ? "pq.ft.upBy" : "pq.ft.up", { when: stamp(f.at), who: f.who || "" }) : ""].filter(Boolean);
    el.innerHTML = `
      <div class="pq-rv-top">
        <span class="pq-rv-av" style="background:${escapeHtml(brand?.color || "var(--accent)")}">${escapeHtml((brand?.name || "?")[0])}</span>
        <span class="pq-rv-what"><b>${videoCode(c) ? `<em class="pq-rv-code">${escapeHtml(videoCode(c))}</em>` : ""}${escapeHtml(f.name)}</b><small>${escapeHtml(c.title || "")}</small></span>
        <span class="pq-rv-n">${i + 1}/${clips.length}</span>
        <button type="button" class="pq-rv-x" data-x aria-label="${escapeHtml(t("common.close"))}">${icon("x", { size: 18 })}</button>
      </div>
      <div class="pq-rv-stage fb-stage">
        <div class="fb-load" data-load>${icon("film", { size: 26 })}<span>${t("pq.ft.loading")}</span></div>
        <button type="button" class="pq-rv-nav is-prev" data-prev ${i ? "" : "disabled"} aria-label="${escapeHtml(t("pq.prev"))}">${icon("chevronLeft", { size: 22 })}</button>
        <button type="button" class="pq-rv-nav is-next" data-next ${i < clips.length - 1 ? "" : "disabled"} aria-label="${escapeHtml(t("pq.ft.next"))}">${icon("chevronRight", { size: 22 })}</button>
      </div>
      <div class="fb-facts"><span>${facts.map(escapeHtml).join(" · ")}<span data-dur></span></span>
        <button type="button" class="fb-copy" data-where="${escapeHtml(where)}" hidden>${icon("copy", { size: 14 })}${t("pq.ft.copyWhere")}</button>
      </div>`;
    qs("[data-x]", el).addEventListener("click", close);
    qs("[data-prev]", el).addEventListener("click", () => { if (i) { i--; show(); } });
    qs("[data-next]", el).addEventListener("click", () => { if (i < clips.length - 1) { i++; show(); } });
    const copyBtn = qs("[data-where]", el);
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(copyBtn.dataset.where); } catch { /* shown on the button anyway */ }
      toast(t("pq.ft.copied"));
    });

    // The Mac copy first; else straight from the client's Drive.
    // (A Mac file's URL is ours to let go; a Drive copy is kept by footage-mac.)
    let src = "";
    let own = false;
    try {
      const file = usesOutbox() && outboxInfo().connected ? await outboxClipFile(key, macName(f.name)) : null;
      if (file && (!f.size || file.size === f.size)) {
        src = URL.createObjectURL(file);
        own = true;
      } else if (canUsePosting()) {
        const load = qs("[data-load] span", el);
        src = await footageDriveURL(c, f, (p) => { if (me === turn && load) load.textContent = t("pq.ft.fromDrive", { pct: Math.round(p * 100) }); });
      }
    } catch (e) {
      console.warn("[footage] play", f.name, e.code || e.message);
    }
    if (me !== turn || !el.isConnected) { if (own) URL.revokeObjectURL(src); return; }
    const stage = qs(".fb-stage", el);
    const load = qs("[data-load]", el);
    if (!src) { load.innerHTML = `${icon("info", { size: 22 })}<span>${t("pq.ft.cantPlay")}</span>`; return; }
    if (own) { url = src; copyBtn.hidden = false; }
    load.remove();
    const tag = kind === "image" ? `<img src="${escapeHtml(src)}" alt="">` : kind === "audio" ? `<audio controls autoplay src="${escapeHtml(src)}"></audio>` : `<video controls autoplay playsinline src="${escapeHtml(src)}"></video>`;
    stage.insertAdjacentHTML("afterbegin", tag);
    const m = qs("video, audio", stage);
    m?.addEventListener("loadedmetadata", () => { const d = qs("[data-dur]", el); if (d && m.duration) d.textContent = ` · ${durLabel(m.duration)}`; });
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" && i < clips.length - 1) { i++; show(); }
    else if (e.key === "ArrowLeft" && i) { i--; show(); }
  };
  document.addEventListener("keydown", onKey);
  show();
}
