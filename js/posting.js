// Video & posting (private preview, 2026-11-01): a piece on the Kalender can
// carry its video versions, the review decision and its Instagram slot, all
// in one drawer. Owner's ask: "di kalender brandlab di click bisa langsung
// upload, ada tanda mana yang sudah ter-upload", "UI se-simpel dan sejelas
// mungkin", and only his own account may use it for now. So every hook in
// js/views/calendar.js asks canUsePosting() first and adds nothing otherwise.
//
// Stored on the content doc itself (no second calendar, no second list):
//   posting = {
//     versions: [{ id, n, status: "pending"|"revision"|"approved", at, by, drive: { id, link, folderId, ext }, name, size, w, h, dur }],
//     finalId,                 // the approved version that gets posted
//     notes: [{ id, versionId, t, text, at, done }],
//     time: "19:00",           // WIB, the day is the piece's scheduleDate
//     ig: { state: "scheduled"|"published"|"failed", at, error, permalink },
//   }
// The files live in the person's OWN Google Drive (js/drive.js), in
// Brandlab / brand / month / piece folders — Brandlab keeps no copy (owner
// picked "yang hemat", 2026-11-01). They are read back from Drive to play.
// Scheduling still only marks the piece until the server worker exists; that
// worker will copy the final cut to a short-lived spot for Instagram to
// fetch (.claude/social-hub/ARSITEKTUR.md).
import { listBrands, getBrand, listContent, getContent, createContent, updateContent, localISODate } from "./store.js";
import { isAdmin, currentUid } from "./account.js";
import { driveStatus, connectDrive, ensureFolders, uploadToDrive, driveVideoURL, renameDriveFile } from "./drive.js";
import { icon } from "./icons.js";
import { qs, qsa, toast, escapeHtml, openMenu, closeMenu } from "./dom.js";
import { openDrawer, confirmDialog } from "./modals.js";
import { t, getLang } from "./i18n.js";

export const canUsePosting = () => isAdmin(currentUid());

// Instagram publishing by itself needs the server worker (Fase 2). Until it
// exists, "schedule" only books the slot on the calendar and says so, and
// the person marks the piece posted after posting it by hand.
const AUTO_POST = false;

// Is this person's Google Drive connected? Asked once, then kept for the tab.
const DRIVE = { checked: false, connected: false, email: "", reason: "" };
let driveCheck = null;
function checkDrive(force = false) {
  if (!driveCheck || force) {
    driveCheck = driveStatus().then((s) => {
      Object.assign(DRIVE, { checked: true, connected: s.connected, email: s.email || "", reason: s.reason || "" });
      return DRIVE;
    });
  }
  return driveCheck;
}

// Connecting leaves the page for Google's consent screen; this note says
// which piece to reopen when Google sends the person back.
const AFTER_DRIVE = "posting:afterDrive";
async function goConnect(contentId) {
  try { sessionStorage.setItem(AFTER_DRIVE, JSON.stringify({ contentId: contentId || "", at: Date.now() })); } catch { /* still connects */ }
  try {
    await connectDrive(location.hash);
  } catch (e) {
    toast(e.code === "setup" ? t("post.drive.setup") : t("post.toast.uploadFailed"), "error");
  }
}
async function askConnect(contentId) {
  const ok = await confirmDialog({ title: t("post.drive.askTitle"), message: t("post.drive.body"), confirmLabel: t("post.drive.cta") });
  if (ok) goConnect(contentId);
}

// Uploads running in this tab, by piece: { label, pct }. A big video takes
// minutes, so the drawer can be closed meanwhile; closing the TAB would cut
// it off, hence the leave warning.
const UPLOADS = new Map();
const uploadWatchers = new Set();
const tellWatchers = (contentId, done) => uploadWatchers.forEach((fn) => fn(contentId, done));
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!UPLOADS.size) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

const STATE_COLOR = {
  none: "var(--text-faint)", review: "#3B9BFF", revision: "#FF9F3D", ready: "#A974FF",
  scheduled: "#FFC83D", published: "#36D27F", failed: "#FF5F57",
};
const STATE_ICON = { none: "upload", review: "eye", revision: "refresh", ready: "check", scheduled: "clock", published: "instagram", failed: "x" };

const postingOf = (c) => c?.posting || { versions: [], notes: [] };
const latestOf = (p) => p.versions[p.versions.length - 1] || null;
const versionLabel = (v) => (v.n ? t("post.v.revision", { n: v.n }) : t("post.v.original"));

export function postingState(c) {
  const p = postingOf(c);
  if (p.ig?.state === "published" || (c.status === "published" && p.versions.length)) return "published";
  if (p.ig?.state === "failed") return "failed";
  if (p.ig?.state === "scheduled") return "scheduled";
  const last = latestOf(p);
  if (!last) return "none";
  if (last.status === "pending") return "review";
  if (p.finalId && p.versions.some((v) => v.id === p.finalId && v.status === "approved")) return "ready";
  return "revision";
}

function stateLabel(c, key = postingState(c)) {
  return t(`post.state.${key}`, { time: postingOf(c).time || "" }).trim();
}

// Only Instagram pieces, and not old posts that went out before this existed.
const tracked = (c) => canUsePosting() && (!c.platform || /instagram/i.test(c.platform)) && !(c.status === "published" && !postingOf(c).versions.length);

// Calendar card (week view, a phone's picked day): one line under the step.
export function postingBadgeHTML(c) {
  if (!tracked(c)) return "";
  if (UPLOADS.has(c.id)) return `<span class="pst-badge is-uploading" style="--pst:${STATE_COLOR.review}">${icon("upload", { size: 11 })}${t("post.state.uploading")}</span>`;
  const key = postingState(c);
  const n = postingOf(c).versions.length;
  return `<span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}${n > 1 ? `<b>${n}</b>` : ""}</span>`;
}

// Month grid chip: just the coloured mark, the title says the rest.
export function postingDotHTML(c) {
  if (!tracked(c)) return "";
  const key = postingState(c);
  if (key === "none") return "";
  return `<span class="pst-dot" style="--pst:${STATE_COLOR[key]}" title="${escapeHtml(stateLabel(c, key))}">${icon(STATE_ICON[key], { size: 9 })}</span>`;
}

// Menu rows the calendar adds to its own menus.
export const postingMenuItemHTML = () => (canUsePosting() ? `<button data-act="posting">${icon("play", { size: 15 })}${t("post.menu.open")}</button>` : "");
export const uploadMenuItemHTML = () => (canUsePosting() ? `<button data-posting-upload>${icon("upload", { size: 15 })}${t("post.menu.upload")}</button>` : "");

// ---------------------------------------------------------------- review

export function reviewQueue() {
  if (!canUsePosting()) return [];
  return listBrands().flatMap((b) => listContent(b.id).filter((c) => postingState(c) === "review").map((c) => ({ brand: b, c })));
}

export function reviewButtonHTML() {
  const n = reviewQueue().length;
  return n ? `<button type="button" class="btn btn-secondary pst-review-btn" id="pst-review" aria-label="${escapeHtml(t("post.review.btn", { n }))}">${icon("eye", { size: 15 })}<b>${n}</b><span class="pst-review-l">${t("post.review.label")}</span></button>` : "";
}

// The calendar's hook: the review list, and — once per page load — picking
// up where the person was after Google's Drive consent screen.
let resumed = false;
export function wirePosting(root, { brandId, onChange } = {}) {
  if (!canUsePosting()) return;
  if (!resumed) {
    resumed = true;
    let note = null;
    try { note = JSON.parse(sessionStorage.getItem(AFTER_DRIVE) || "null"); sessionStorage.removeItem(AFTER_DRIVE); } catch { /* nothing to resume */ }
    if (note && Date.now() - note.at < 30 * 60 * 1000) {
      checkDrive(true).then((d) => {
        toast(d.connected ? t("post.drive.connected", { email: d.email }) : t("post.drive.notConnected"), d.connected ? "success" : "error");
        if (d.connected && note.contentId && getContent(note.contentId)) openPosting({ contentId: note.contentId, onChange });
      });
    }
  }
  const btn = qs("#pst-review", root);
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    const menu = openMenu(btn, { className: "pst-review-menu", top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 320)) });
    if (!menu) return;
    const list = reviewQueue().sort((a, b) => (a.brand.id === brandId ? -1 : 0) - (b.brand.id === brandId ? -1 : 0));
    menu.innerHTML = `<div class="pst-review-head">${t("post.review.head")}</div>${list.length ? list.map(({ brand, c }) => {
      const last = latestOf(postingOf(c));
      return `<button data-pst-open="${escapeHtml(c.id)}">
        <span class="pst-review-av" style="background:${escapeHtml(brand.color || "var(--accent)")}">${escapeHtml((brand.name || "?")[0])}</span>
        <span class="pst-review-text"><b>${escapeHtml(c.title || t("common.untitled"))}</b><small>${escapeHtml(brand.name)} · ${escapeHtml(versionLabel(last))} · ${escapeHtml(dayLabel(c.scheduleDate))}</small></span>
      </button>`;
    }).join("") : `<div class="pst-review-empty">${t("post.review.empty")}</div>`}`;
    menu.addEventListener("click", (ev) => {
      const id = ev.target.closest("[data-pst-open]")?.dataset.pstOpen;
      if (!id) return;
      closeMenu();
      const c = getContent(id);
      if (c && c.brandId !== brandId) location.hash = `#/brand/${c.brandId}/content/calendar`;
      openPosting({ contentId: id, onChange });
    });
  });
}

// ---------------------------------------------------------------- upload

function pickFile(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/mp4,video/quicktime,video/*";
  input.addEventListener("change", () => { if (input.files[0]) onPick(input.files[0]); });
  input.click();
}

const isVideoFile = (f) => !!f && (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || ""));

// What the browser can read about the file before anything is sent.
function probe(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    const done = (meta) => { URL.revokeObjectURL(url); resolve(meta); };
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight, dur: v.duration });
    v.onerror = () => done({ w: 0, h: 0, dur: 0 });
    v.src = url;
  });
}

const MAX_BYTES = 300 * 1048576; // Instagram's Reels limit
const extOf = (name) => ((name || "").match(/\.([a-z0-9]{2,4})$/i)?.[1] || "mp4").toLowerCase();

// Where a piece's videos sit in Drive: Brandlab / brand / "2026-11 November"
// / "04 Nov · title". Names Drive can't hold (slashes and the like) become "-".
export function driveFolderPath(brand, c, lang = getLang()) {
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);
  const d = c?.scheduleDate ? new Date(`${c.scheduleDate}T00:00:00`) : null;
  const loc = lang === "en" ? "en-US" : "id-ID";
  const month = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")} ${d.toLocaleDateString(loc, { month: "long" })}` : t("post.drive.noDate");
  const day = d ? `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString(loc, { month: "short" }).replace(".", "")} · ` : "";
  return ["Brandlab", clean(brand?.name) || "Brand", month, clean(`${day}${c?.title || t("common.untitled")}`)];
}
// "Revisi 2.mp4", and "Revisi 2 (FINAL).mp4" for the cut that gets posted.
export const driveFileName = (v, ext = "mp4", final = false) => `${versionLabel(v)}${final ? " (FINAL)" : ""}.${ext}`;

async function storeVideo(file, { content, n, onProgress }) {
  const meta = await probe(file);
  const ext = extOf(file.name);
  const folderId = await ensureFolders(driveFolderPath(getBrand(content.brandId), content));
  const up = await uploadToDrive(file, { name: driveFileName({ n }, ext), folderId, onProgress });
  return { ...meta, drive: { id: up.id, link: up.webViewLink || "", folderId, ext }, name: file.name, size: file.size, type: file.type };
}

// Keeps "(FINAL)" on the one file that gets posted. Best effort: a name
// that didn't change in Drive never blocks a decision here.
function markFinalInDrive(p, oldId, newId) {
  const name = (v, final) => driveFileName(v, v.drive?.ext || "mp4", final);
  const was = p.versions.find((x) => x.id === oldId);
  const now = p.versions.find((x) => x.id === newId);
  if (was?.drive?.id && oldId !== newId) renameDriveFile(was.drive.id, name(was, false)).catch(() => {});
  if (now?.drive?.id && oldId !== newId) renameDriveFile(now.drive.id, name(now, true)).catch(() => {});
}

export function formatIssues(v) {
  const out = [];
  if (v.w && v.h && Math.abs(v.w / v.h - 9 / 16) > 0.02) out.push(t("post.check.ratio", { w: v.w, h: v.h }));
  if (v.dur > 900) out.push(t("post.check.long"));
  if (v.size > 300 * 1048576) out.push(t("post.check.big"));
  if (v.type && !/mp4|quicktime/.test(v.type)) out.push(t("post.check.type", { type: v.type.replace("video/", "").toUpperCase() }));
  return out;
}

const fileProblem = (f) => (!isVideoFile(f) ? t("post.toast.notVideo") : f.size > MAX_BYTES ? t("post.check.big") : "");

async function addVersion(contentId, file, onChange) {
  const problem = fileProblem(file);
  if (problem) { toast(problem, "error"); return null; }
  if (UPLOADS.has(contentId)) { toast(t("post.toast.busy"), "error"); return null; }
  const c = getContent(contentId);
  if (!c) return null;
  if (!(await checkDrive()).connected) { askConnect(contentId); return null; }
  const n = postingOf(c).versions.length;
  const versionId = `v${Date.now().toString(36)}`;
  const label = versionLabel({ n });
  UPLOADS.set(contentId, { label, pct: 0 });
  tellWatchers(contentId, true);
  onChange?.();
  try {
    const stored = await storeVideo(file, {
      content: c, n,
      onProgress: (f) => { const u = UPLOADS.get(contentId); if (u) { u.pct = f; tellWatchers(contentId, false); } },
    });
    const v = { id: versionId, n, status: "pending", at: Date.now(), by: "you", ...stored };
    // Re-read: notes or a decision may have landed while this uploaded.
    const fresh = getContent(contentId);
    const p = postingOf(fresh);
    // A new video means the piece is at least being edited (Creator's "Edit"
    // step), and a new version always waits for a fresh look — a slot
    // already booked on Instagram is let go until it's approved again.
    const status = ["idea", "draft", "production", "scheduled"].includes(fresh.status) ? "editing" : fresh.status;
    updateContent(contentId, { status, posting: { ...p, versions: [...p.versions, v], ig: p.ig?.state === "scheduled" ? null : p.ig } });
    toast(t("post.toast.uploaded", { label }));
    return v;
  } catch (e) {
    console.warn("[posting] upload failed", e);
    toast(t("post.toast.uploadFailed"), "error");
    return null;
  } finally {
    UPLOADS.delete(contentId);
    tellWatchers(contentId, true);
    onChange?.();
  }
}

// "Upload video" on a day: a new piece named after the file, on that day.
// The drawer opens right away so the upload's progress is in view.
export function uploadForDate({ brandId, dateISO, file, onChange }) {
  if (!canUsePosting()) return;
  if (dateISO < localISODate()) { toast(t("post.toast.past"), "error"); return; }
  const go = async (f) => {
    const problem = fileProblem(f);
    if (problem) { toast(problem, "error"); return; }
    if (!(await checkDrive()).connected) { askConnect(""); return; }
    const title = (f.name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || t("common.untitled");
    const c = createContent(brandId, { title, scheduleDate: dateISO, status: "editing", platform: "Instagram", format: "Reels" });
    if (!c) return;
    openPosting({ contentId: c.id, onChange });
    addVersion(c.id, f, onChange);
  };
  file ? go(file) : pickFile(go);
}

// A video file dragged from the desktop onto a calendar day.
export function handleFileDrop(e, { brandId, dateISO, onChange }) {
  if (!canUsePosting()) return false;
  const file = [...(e.dataTransfer?.files || [])].find(isVideoFile);
  if (!file) return false;
  e.preventDefault();
  uploadForDate({ brandId, dateISO, file, onChange });
  return true;
}

// ---------------------------------------------------------------- drawer

const two = (n) => String(n).padStart(2, "0");
const clock = (s) => `${Math.floor((s || 0) / 60)}:${two(Math.floor((s || 0) % 60))}`;
function dayLabel(dateISO) {
  if (!dateISO) return "";
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { weekday: "short", day: "numeric", month: "short" });
}
const igHandleOf = (brand) => (brand?.instagram?.username || "").replace(/^@/, "");

export function openPosting({ contentId, onChange }) {
  if (!canUsePosting() || !getContent(contentId)) return;
  const c0 = getContent(contentId);
  const ui = { vid: (postingOf(c0).versions.find((v) => v.id === postingOf(c0).finalId) || latestOf(postingOf(c0)))?.id || null, compare: false, noteOpen: false, t: 0, onChange };
  const overlay = openDrawer({ title: t("post.title"), bodyHTML: `<div class="pst" id="pst-root"></div>` });
  overlay.classList.add("pst-overlay");
  const root = qs("#pst-root", overlay);
  const repaint = () => { if (overlay.isConnected) paint(root, contentId, ui, repaint); onChange?.(); };
  // Upload progress: the bar moves in place (a playing video keeps playing);
  // start and finish repaint, and a finished upload is shown next to the
  // one before it.
  let count = postingOf(c0).versions.length;
  const watch = (id, done) => {
    if (!overlay.isConnected) { uploadWatchers.delete(watch); return; }
    if (id !== contentId) return;
    if (!done) {
      const u = UPLOADS.get(contentId);
      const pct = Math.round((u?.pct || 0) * 100);
      const fill = qs("#pst-progress-fill", root), num = qs("#pst-progress-pct", root);
      if (fill) fill.style.width = `${pct}%`;
      if (num) num.textContent = `${pct}%`;
      return;
    }
    const p = postingOf(getContent(contentId));
    if (p.versions.length > count) { ui.vid = latestOf(p).id; ui.compare = p.versions.length > 1; }
    count = p.versions.length;
    paint(root, contentId, ui, repaint);
  };
  uploadWatchers.add(watch);
  paint(root, contentId, ui, repaint);
  if (!DRIVE.checked) checkDrive().then(() => { if (overlay.isConnected) paint(root, contentId, ui, repaint); });
  return overlay;
}

function progressHTML(up) {
  const pct = Math.round((up.pct || 0) * 100);
  return `<div class="pst-progress" role="status">
      <div class="pst-progress-row">${icon("upload", { size: 14 })}<span>${t("post.up.progress", { label: escapeHtml(up.label) })}</span><b id="pst-progress-pct">${pct}%</b></div>
      <div class="pst-progress-bar"><i id="pst-progress-fill" style="width:${pct}%"></i></div>
      <small>${t("post.up.keepOpen")}</small>
    </div>`;
}

function paint(root, contentId, ui, repaint) {
  const c = getContent(contentId);
  if (!c) return;
  const brand = getBrand(c.brandId);
  const p = postingOf(c);
  const key = postingState(c);
  const v = p.versions.find((x) => x.id === ui.vid) || latestOf(p);
  if (v) ui.vid = v.id;
  const idx = v ? p.versions.indexOf(v) : -1;
  const prev = idx > 0 ? p.versions[idx - 1] : null;
  if (!prev) ui.compare = false;
  const stepNow = key === "none" ? 0 : ["review", "revision"].includes(key) ? 1 : 2;
  const handle = igHandleOf(brand);
  const up = UPLOADS.get(contentId);

  root.innerHTML = `
    <header class="pst-head">
      <div class="pst-head-text">
        <h3>${escapeHtml(c.title || t("common.untitled"))}</h3>
        <div class="pst-head-meta">${icon("calendar", { size: 12 })}${escapeHtml(dayLabel(c.scheduleDate))}${p.time ? ` · ${escapeHtml(p.time)}` : ""}<span class="pst-badge is-${key}" style="--pst:${STATE_COLOR[key]}">${icon(STATE_ICON[key], { size: 11 })}${escapeHtml(stateLabel(c, key))}</span></div>
      </div>
    </header>
    <ol class="pst-steps" aria-label="${escapeHtml(t("post.title"))}">
      ${["video", "check", "post"].map((s, i) => `<li class="${i < stepNow ? "is-done" : i === stepNow ? "is-now" : ""}"><span>${i < stepNow ? icon("check", { size: 12 }) : i + 1}</span>${t(`post.step.${s}`)}</li>`).join("")}
    </ol>

    <section class="pst-block pst-video" id="pst-drop">
      ${DRIVE.checked && !DRIVE.connected && !up ? connectHTML() : v ? `
        <div class="pst-players ${ui.compare ? "is-compare" : ""}">
          ${ui.compare ? playerHTML(prev, "A") : ""}${playerHTML(v, ui.compare ? "B" : "")}
        </div>
        <div class="pst-ctl">
          <button type="button" class="pst-play" id="pst-play" aria-label="${t("post.play")}">${icon("play", { size: 16 })}</button>
          <input type="range" id="pst-seek" min="0" max="${Math.max(1, v.dur || 10)}" step="0.05" value="0" aria-label="${t("post.play")}">
          <span class="pst-time" id="pst-time">0:00 / ${clock(v.dur)}</span>
        </div>
        ${formatIssues(v).length ? `<p class="pst-warn">${icon("info", { size: 13 })}${formatIssues(v).map(escapeHtml).join(" · ")}</p>` : `<p class="pst-ok">${icon("check", { size: 13 })}${t("post.check.ok")} · ${clock(v.dur)} · 9:16</p>`}
        ${up ? progressHTML(up) : ""}
        <div class="pst-versions" role="list">
          ${p.versions.map((x) => `<button type="button" role="listitem" class="pst-v ${x.id === v.id ? "is-on" : ""}" data-vid="${x.id}" style="--pst:${STATE_COLOR[x.status === "pending" ? "review" : x.status === "revision" ? "revision" : "ready"]}">
              <i aria-hidden="true"></i><span>${escapeHtml(versionLabel(x))}</span>${x.id === p.finalId ? `<em>${icon("instagram", { size: 10 })}</em>` : ""}
            </button>`).join("")}
          <button type="button" class="pst-v is-add" id="pst-add" ${up ? "disabled" : ""}>${icon("plus", { size: 13 })}${t("post.v.upload")}</button>
        </div>
        ${prev ? `<button type="button" class="pst-link" id="pst-compare">${icon(ui.compare ? "x" : "layers", { size: 13 })}${ui.compare ? t("post.compare.off") : t("post.compare.on", { label: versionLabel(prev) })}</button>` : ""}
        ${v.drive ? whereHTML(brand, c, v) : ""}
      ` : up ? progressHTML(up) : `
        <div class="pst-empty">
          <span class="pst-empty-art">${icon("upload", { size: 26 })}</span>
          <b>${t("post.empty.title")}</b>
          <span>${t("post.empty.body")}</span>
          <button type="button" class="cl-cta pst-cta" id="pst-add"><span>${t("post.empty.pick")}</span><span class="cl-cta-dot">${icon("upload", { size: 16 })}</span></button>
        </div>`}
    </section>

    ${v ? decideHTML(p, v, prev, ui) : ""}
    ${postHTML(c, p, key, handle)}
  `;
  wire(root, contentId, ui, repaint);
}

// A Drive video is fetched into the tab first (js/drive.js driveVideoURL);
// the player says so while it loads.
function playerHTML(v, tag) {
  const fromDrive = !v.url && v.drive?.id;
  return `<div class="pst-player" ${fromDrive ? `data-drive="${escapeHtml(v.drive.id)}"` : ""}>${tag ? `<span class="pst-tag">${tag} · ${escapeHtml(versionLabel(v))}</span>` : ""}<video ${v.url ? `src="${escapeHtml(v.url)}"` : ""} playsinline preload="metadata" ${tag === "A" ? "muted" : ""}></video>${fromDrive ? `<span class="pst-loading">${icon("folder", { size: 16 })}<span>${t("post.load")}</span><b>0%</b></span>` : ""}</div>`;
}

function connectHTML() {
  const setup = DRIVE.reason === "setup";
  return `<div class="pst-empty pst-connect">
      <span class="pst-empty-art is-drive">${icon("folder", { size: 26 })}</span>
      <b>${t("post.drive.title")}</b>
      <span>${t("post.drive.body")}</span>
      ${setup ? `<span class="pst-hint">${icon("info", { size: 13 })}${t("post.drive.setup")}</span>` : ""}
      <button type="button" class="cl-cta pst-cta" id="pst-connect" ${setup ? "disabled" : ""}><span>${t("post.drive.cta")}</span><span class="cl-cta-dot pst-dot-drive">${icon("link", { size: 16 })}</span></button>
    </div>`;
}

function whereHTML(brand, c, v) {
  return `<p class="pst-where">${icon("folder", { size: 13 })}<span><b>${t("post.drive.where")}</b> ${driveFolderPath(brand, c).map(escapeHtml).join(" › ")}</span>${v.drive.link ? `<a href="${escapeHtml(v.drive.link)}" target="_blank" rel="noopener">${t("post.drive.open")}</a>` : ""}</p>`;
}

function decideHTML(p, v, prev, ui) {
  const label = versionLabel(v);
  const mine = p.notes.filter((n) => n.versionId === v.id).sort((a, b) => a.t - b.t);
  const older = prev ? p.notes.filter((n) => n.versionId === prev.id && !n.done) : [];
  const note = (n) => `<div class="pst-note ${n.done ? "is-done" : ""}"><button type="button" class="pst-note-t" data-seek="${n.t}">${clock(n.t)}</button><span>${escapeHtml(n.text)}</span><label><input type="checkbox" data-note="${n.id}" ${n.done ? "checked" : ""}>${t("post.note.done")}</label></div>`;
  const final = p.versions.find((x) => x.id === p.finalId);
  let head;
  if (v.status === "pending") {
    head = `<h4>${t("post.decide.title", { label: escapeHtml(label) })}</h4>
      <div class="pst-decide">
        <button type="button" class="cl-cta pst-cta" id="pst-ok"><span>${t("post.decide.ok")}</span><span class="cl-cta-dot pst-dot-ok">${icon("check", { size: 16 })}</span></button>
        <button type="button" class="btn btn-secondary" id="pst-revise">${icon("refresh", { size: 15 })}${t("post.decide.revise")}</button>
      </div>`;
  } else if (v.status === "approved") {
    head = v.id === p.finalId
      ? `<p class="pst-result is-ok">${icon("check", { size: 15 })}<span>${t("post.decide.approved")}</span></p>`
      : `<p class="pst-result is-ok">${icon("check", { size: 15 })}<span>${t("post.decide.approvedOther", { label: escapeHtml(final ? versionLabel(final) : "") })} <button type="button" class="pst-link" id="pst-use">${t("post.decide.useThis")}</button></span></p>`;
  } else {
    head = `<p class="pst-result is-rev">${icon("refresh", { size: 15 })}<span>${t("post.decide.revising")} <button type="button" class="pst-link" id="pst-undo">${t("post.decide.undo")}</button></span></p>`;
  }
  return `
    <section class="pst-block">
      ${head}
      ${older.length ? `<div class="pst-notes"><div class="pst-sub">${t("post.note.prev", { label: escapeHtml(versionLabel(prev)) })}</div>${older.map(note).join("")}</div>` : ""}
      ${mine.length ? `<div class="pst-notes">${mine.map(note).join("")}</div>` : ""}
      ${ui.noteOpen || v.status === "revision" ? `
        <div class="pst-note-new">
          <label class="pst-sub" for="pst-note-text">${t("post.note.label")}</label>
          <div class="pst-note-row"><input class="input" id="pst-note-text" placeholder="${escapeHtml(t("post.note.ph"))}"><button type="button" class="btn btn-primary btn-sm" id="pst-note-send">${t("post.note.send", { time: clock(ui.t) })}</button></div>
        </div>` : ""}
    </section>`;
}

function postHTML(c, p, key, handle) {
  const acct = `<div class="pst-acct">${icon("instagram", { size: 18 })}<b>${handle ? `@${escapeHtml(handle)}` : escapeHtml(getBrand(c.brandId)?.name || "")}</b><span class="pst-pill ${handle ? "is-on" : ""}">${handle ? t("post.ig.connected") : t("post.ig.notConnected")}</span></div>`;
  if (key === "scheduled") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live"><span class="pst-live-ic">${icon("clock", { size: 20 })}</span><div><b>${t(AUTO_POST ? "post.ig.scheduledTitle" : "post.ig.markedTitle", { when: `${escapeHtml(dayLabel(c.scheduleDate))}, ${escapeHtml(p.time || "")}` })}</b><small>${t(AUTO_POST ? "post.ig.scheduledBody" : "post.ig.markedBody")}</small></div></div>
      <div class="pst-decide">
        ${AUTO_POST ? "" : `<button type="button" class="cl-cta pst-cta" id="pst-posted"><span>${t("post.ig.postedByHand")}</span><span class="cl-cta-dot pst-dot-ok">${icon("check", { size: 16 })}</span></button>`}
        <button type="button" class="btn btn-ghost btn-sm" id="pst-unschedule">${t("post.ig.cancel")}</button>
      </div></section>`;
  }
  if (key === "published") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live is-pub"><span class="pst-live-ic">${icon("check", { size: 20 })}</span><div><b>${t("post.ig.publishedTitle", { when: escapeHtml(dayLabel(c.publishedDate || c.scheduleDate)) })}</b>${p.ig?.permalink ? `<small>${escapeHtml(p.ig.permalink)}</small>` : ""}</div></div></section>`;
  }
  if (key === "failed") {
    return `<section class="pst-block pst-post">${acct}
      <div class="pst-live is-fail"><span class="pst-live-ic">${icon("x", { size: 20 })}</span><div><b>${t("post.ig.failedTitle")}</b><small>${escapeHtml(p.ig?.error || "")}</small></div></div>
      <button type="button" class="btn btn-secondary btn-sm" id="pst-retry">${icon("refresh", { size: 14 })}${t("post.ig.retry")}</button></section>`;
  }
  // Until a video is approved and the account is connected, this step is
  // one line saying what unlocks it — no greyed-out form to puzzle over.
  if (key !== "ready" || !handle) {
    return `<section class="pst-block pst-post is-locked">${acct}<p class="pst-hint">${icon("lock", { size: 13 })}${!handle ? t("post.ig.connectHint") : t("post.ig.needApproval")}</p></section>`;
  }
  return `
    <section class="pst-block pst-post">
      ${acct}
      <div class="pst-when">
        <div class="field"><label for="pst-date">${t("post.ig.date")}</label><input class="input" type="date" id="pst-date" value="${escapeHtml(c.scheduleDate || localISODate())}" min="${localISODate()}"></div>
        <div class="field"><label for="pst-time-in">${t("post.ig.time")}</label><input class="input" type="time" id="pst-time-in" value="${escapeHtml(p.time || "19:00")}"></div>
      </div>
      <div class="field"><label for="pst-caption">${t("post.ig.caption")} <span class="pst-count" id="pst-count">${(c.caption || "").length}/2200</span></label><textarea class="textarea" id="pst-caption" rows="4" maxlength="2200" placeholder="${escapeHtml(t("post.ig.captionPh"))}">${escapeHtml(c.caption || "")}</textarea></div>
      ${AUTO_POST ? "" : `<p class="pst-hint">${icon("info", { size: 13 })}${t("post.ig.manualNote")}</p>`}
      <button type="button" class="cl-cta pst-cta pst-go" id="pst-schedule"><span>${t(AUTO_POST ? "post.ig.cta" : "post.ig.ctaMark")}</span><span class="cl-cta-dot pst-dot-ig">${icon(AUTO_POST ? "instagram" : "calendar", { size: 16 })}</span></button>
    </section>`;
}

function wire(root, contentId, ui, repaint) {
  const c = getContent(contentId);
  const p = postingOf(c);
  const save = (patch) => updateContent(contentId, { posting: { ...postingOf(getContent(contentId)), ...patch } });
  const setV = (fn) => save({ versions: postingOf(getContent(contentId)).versions.map((x) => (x.id === ui.vid ? fn(x) : x)) });

  // Players: the newest drives, the older one follows (compare view).
  const vids = qsa("video", root);
  const main = vids[vids.length - 1];
  const play = qs("#pst-play", root), seek = qs("#pst-seek", root), time = qs("#pst-time", root);
  if (main) {
    const sync = () => {
      ui.t = main.currentTime;
      seek.value = main.currentTime;
      time.textContent = `${clock(main.currentTime)} / ${clock(main.duration || 0)}`;
      vids.forEach((x) => { if (x !== main && Math.abs(x.currentTime - main.currentTime) > 0.25) x.currentTime = Math.min(main.currentTime, x.duration || 0); });
      const send = qs("#pst-note-send", root);
      if (send) send.textContent = t("post.note.send", { time: clock(main.currentTime) });
    };
    main.addEventListener("loadedmetadata", () => { seek.max = main.duration || 1; sync(); });
    main.addEventListener("timeupdate", sync);
    main.addEventListener("ended", () => { vids.forEach((x) => x.pause()); play.innerHTML = icon("play", { size: 16 }); });
    play.addEventListener("click", () => {
      const go = main.paused;
      vids.forEach((x) => (go ? x.play().catch(() => {}) : x.pause()));
      play.innerHTML = icon(go ? "pause" : "play", { size: 16 });
      play.setAttribute("aria-label", go ? t("post.pause") : t("post.play"));
    });
    seek.addEventListener("input", () => { vids.forEach((x) => { x.currentTime = Math.min(+seek.value, x.duration || +seek.value); }); });
    vids.forEach((x) => x.addEventListener("click", () => play.click()));
  }
  qsa(".pst-player[data-drive]", root).forEach((box) => {
    const video = qs("video", box), loading = qs(".pst-loading", box), pct = qs(".pst-loading b", box);
    driveVideoURL(box.dataset.drive, { onProgress: (f) => { if (pct) pct.textContent = `${Math.round(f * 100)}%`; } })
      .then((url) => { video.src = url; loading?.remove(); })
      .catch(() => { if (loading) loading.innerHTML = `${icon("info", { size: 16 })}<span>${t("post.loadFailed")}</span>`; });
  });
  qs("#pst-connect", root)?.addEventListener("click", () => goConnect(contentId));
  qsa("[data-seek]", root).forEach((b) => b.addEventListener("click", () => { vids.forEach((x) => { x.currentTime = +b.dataset.seek; }); }));

  qsa("[data-vid]", root).forEach((b) => b.addEventListener("click", () => { ui.vid = b.dataset.vid; ui.noteOpen = false; paint(root, contentId, ui, repaint); }));
  qs("#pst-compare", root)?.addEventListener("click", () => { ui.compare = !ui.compare; paint(root, contentId, ui, repaint); });
  // The drawer follows the upload through its watcher (openPosting).
  qs("#pst-add", root)?.addEventListener("click", () => pickFile((f) => addVersion(contentId, f, ui.onChange)));

  // Drop a new version anywhere on the video block.
  const drop = qs("#pst-drop", root);
  drop.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); drop.classList.add("is-over"); } });
  drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
  drop.addEventListener("drop", (e) => {
    drop.classList.remove("is-over");
    const f = [...(e.dataTransfer?.files || [])][0];
    if (!f) return;
    e.preventDefault();
    addVersion(contentId, f, ui.onChange);
  });

  // Approving a version makes it the one that gets posted.
  qs("#pst-ok", root)?.addEventListener("click", () => {
    const v = p.versions.find((x) => x.id === ui.vid);
    setV((x) => ({ ...x, status: "approved" }));
    markFinalInDrive(p, p.finalId, ui.vid);
    save({ finalId: ui.vid });
    ui.noteOpen = false;
    toast(t("post.toast.approved", { label: versionLabel(v) }));
    repaint();
  });
  qs("#pst-use", root)?.addEventListener("click", () => { markFinalInDrive(p, p.finalId, ui.vid); save({ finalId: ui.vid }); repaint(); });
  qs("#pst-revise", root)?.addEventListener("click", () => {
    setV((x) => ({ ...x, status: "revision" }));
    if (postingOf(getContent(contentId)).finalId === ui.vid) {
      const was = p.versions.find((x) => x.id === ui.vid);
      if (was?.drive?.id) renameDriveFile(was.drive.id, driveFileName(was, was.drive.ext, false)).catch(() => {});
      save({ finalId: null });
    }
    ui.noteOpen = true;
    toast(t("post.toast.revise"));
    repaint();
    setTimeout(() => qs("#pst-note-text", root)?.focus(), 30);
  });
  qs("#pst-undo", root)?.addEventListener("click", () => { setV((x) => ({ ...x, status: "pending" })); ui.noteOpen = false; repaint(); });
  const sendNote = () => {
    const input = qs("#pst-note-text", root);
    const text = input?.value.trim();
    if (!text) { input?.focus(); return; }
    const at = Math.floor(ui.t || 0);
    save({ notes: [...postingOf(getContent(contentId)).notes, { id: `n${Date.now().toString(36)}`, versionId: ui.vid, t: at, text, at: Date.now(), done: false }] });
    toast(t("post.note.added", { time: clock(at) }));
    repaint();
  };
  qs("#pst-note-send", root)?.addEventListener("click", sendNote);
  qs("#pst-note-text", root)?.addEventListener("keydown", (e) => { if (e.key === "Enter") sendNote(); });
  qsa("[data-note]", root).forEach((box) => box.addEventListener("change", () => {
    save({ notes: postingOf(getContent(contentId)).notes.map((n) => (n.id === box.dataset.note ? { ...n, done: box.checked } : n)) });
    repaint();
  }));

  const cap = qs("#pst-caption", root);
  cap?.addEventListener("input", () => { qs("#pst-count", root).textContent = `${cap.value.length}/2200`; });
  cap?.addEventListener("change", () => updateContent(contentId, { caption: cap.value }));

  // Seam: Fase 2 sends this to the server worker (it creates the Instagram
  // container a few minutes early and publishes on the minute).
  qs("#pst-schedule", root)?.addEventListener("click", () => {
    const date = qs("#pst-date", root).value;
    const hhmm = qs("#pst-time-in", root).value || "19:00";
    if (!date || new Date(`${date}T${hhmm}:00`) <= new Date()) { toast(t("post.ig.past"), "error"); return; }
    updateContent(contentId, {
      scheduleDate: date, caption: cap?.value ?? c.caption, status: "scheduled",
      posting: { ...postingOf(getContent(contentId)), time: hhmm, ig: { state: "scheduled", at: `${date}T${hhmm}:00+07:00` } },
    });
    toast(t(AUTO_POST ? "post.toast.scheduled" : "post.toast.marked", { when: `${dayLabel(date)}, ${hhmm}` }));
    repaint();
  });
  qs("#pst-posted", root)?.addEventListener("click", () => {
    updateContent(contentId, { status: "published", publishedDate: localISODate(), posting: { ...postingOf(getContent(contentId)), ig: { ...(p.ig || {}), state: "published", byHand: true, postedAt: Date.now() } } });
    toast(t("post.toast.posted"));
    repaint();
  });
  qs("#pst-unschedule", root)?.addEventListener("click", () => {
    updateContent(contentId, { status: "editing", posting: { ...postingOf(getContent(contentId)), ig: null } });
    toast(t("post.toast.unscheduled"));
    repaint();
  });
  qs("#pst-retry", root)?.addEventListener("click", () => {
    updateContent(contentId, { status: "scheduled", posting: { ...postingOf(getContent(contentId)), ig: { ...p.ig, state: "scheduled", error: "" } } });
    repaint();
  });
}
