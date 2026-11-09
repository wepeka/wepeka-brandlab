// "Footage syuting" on the Syuting step (owner, 2026-11-09: "clientku ini
// nanti di fase syuting ada suruh upload videonya nanti auto nyambung ke
// drive mereka … video yang di upload ini maksudnya raw footage, jadi
// otomatis ke grouping kan?").
//
// On a brand of Wepeka's that has a client, the crew (the "Klien", or a
// Kerja Tim editor — and Wepeka itself) picks the raw clips of a piece and
// they go straight from the browser into the client's own Google Drive,
// grouped per piece (Wepeka Brandlab / <brand> / <code · title> / Footage).
// The server opens the folder and hands a short-lived key for it
// (api/_footage.js); the clips are sent in pieces, so a phone on a shaky
// connection picks up where it stopped instead of starting over. On
// Wepeka's Mac they're then copied into the piece's Outbox folder by
// themselves (js/footage-mac.js), ready to edit.
import { auth } from "./firebase.js";
import { getBrand, getContent, brandRole, isClientMember } from "./store.js";
import { isAdmin, currentUid } from "./account.js";
import { clientsOf, clientDriveLine, connectOwnDrive, usesOutbox, outboxInfo, ensureOutbox } from "./posting.js";
import { macProgress, onMacProgress } from "./footage-mac.js";
import { FOOTAGE_DIR } from "./outbox.js";
import { videoCode } from "./video-codes.js";
import { confirmDialog } from "./modals.js";
import { icon } from "./icons.js";
import { qs, toast, escapeHtml } from "./dom.js";
import { t, getLang } from "./i18n.js";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const CHUNK = 16 * 1024 * 1024; // a multiple of 256 KiB, as Google asks
const ACCEPT = "video/*,image/*,audio/*,.mov,.mp4,.m4v,.mts,.wav,.m4a,.mp3";

// ---- who sees it --------------------------------------------------------------
// A brand of Wepeka's with a client on it; Wepeka, the client, or an editor.
export function canSendFootage(c) {
  const b = c && getBrand(c.brandId);
  if (!b || !isAdmin(b.ownerId) || !clientsOf(b).length) return false;
  return isAdmin(currentUid()) || isClientMember(b) || brandRole(b) === "editor";
}

// ---- the server ---------------------------------------------------------------
async function review(action, body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/review/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken || ""}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "server"), { code: json.error || "server", status: res.status });
  return json;
}

// ---- one clip into Drive, in pieces --------------------------------------------
const MIME = { mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", mts: "video/mp2t", wav: "audio/wav", m4a: "audio/mp4", mp3: "audio/mpeg", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic" };
export const typeOf = (f) => f.type || MIME[(/\.([A-Za-z0-9]+)$/.exec(f.name || "") || [])[1]?.toLowerCase()] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (code, status = 0) => Object.assign(new Error(code), { code, status });

// Google answers 308 with "Range: bytes=0-N" for the part it holds.
export const nextOffset = (range, fallback) => {
  const m = /-(\d+)\s*$/.exec(String(range || ""));
  return m ? Number(m[1]) + 1 : fallback;
};

function put(session, body, contentRange, onLoaded) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", session);
    xhr.setRequestHeader("content-range", contentRange);
    if (onLoaded) xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("range"), text: xhr.responseText });
    xhr.onerror = () => resolve({ status: 0 });
    xhr.ontimeout = () => resolve({ status: 0 });
    xhr.send(body);
  });
}
const idOf = (r) => { try { return JSON.parse(r.text).id || ""; } catch { return ""; } };

export async function sendClip(file, { accessToken, folderId, name, onProgress }) {
  const type = typeOf(file) || "application/octet-stream";
  const init = await fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-upload-content-type": type, "x-upload-content-length": String(file.size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: type }),
  }).catch(() => null);
  const session = init?.ok && init.headers.get("location");
  if (!session) throw fail(init?.status === 403 ? "drive-full" : init ? "drive" : "network", init?.status || 0);
  const total = file.size;
  let off = 0;
  let tries = 0;
  for (;;) {
    const end = Math.min(off + CHUNK, total);
    const r = await put(session, file.slice(off, end), `bytes ${off}-${end - 1}/${total}`, (n) => onProgress?.((off + n) / total));
    if ((r.status === 200 || r.status === 201) && idOf(r)) return idOf(r);
    if (r.status === 308) { off = nextOffset(r.range, end); tries = 0; onProgress?.(off / total); continue; }
    if (r.status === 403) throw fail("drive-full", 403);
    if (r.status === 404 || r.status === 410) throw fail("expired", r.status);
    if (r.status && r.status < 500 && r.status !== 408 && r.status !== 429) throw fail("drive", r.status);
    // Cut off or Google busy: wait, ask how much arrived, carry on from there.
    if (++tries > 7) throw fail("network");
    await sleep(Math.min(30_000, 1000 * 2 ** tries));
    const s = await put(session, null, `bytes */${total}`);
    if ((s.status === 200 || s.status === 201) && idOf(s)) return idOf(s);
    if (s.status === 308) off = nextOffset(s.range, 0);
    else if (s.status === 404 || s.status === 410) throw fail("expired", s.status);
  }
}

// ---- the queue, per piece (kept while the tab lives) ---------------------------
// { items: [{ file, size, name, pct, state: "wait"|"up"|"done"|"fail", error }], running }
const JOBS = new Map();
const busy = () => [...JOBS.values()].some((j) => j.running);
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!busy()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function addClips(c, files) {
  const job = JOBS.get(c.id) || { items: [], running: false };
  JOBS.set(c.id, job);
  for (const file of files) job.items.push({ file, size: file.size, name: file.name, pct: 0, state: "wait", error: "" });
  paint(c.id);
  if (!job.running) run(c.id);
}

async function run(contentId) {
  const job = JOBS.get(contentId);
  if (!job || job.running) return;
  job.running = true;
  try {
    for (;;) {
      const waiting = job.items.filter((x) => x.state === "wait");
      if (!waiting.length) break;
      const c = getContent(contentId);
      let key;
      try {
        key = await review("footage-start", { contentId, code: videoCode(c), files: waiting.map((x) => ({ name: x.file.name, size: x.size, type: typeOf(x.file) })) });
      } catch (e) {
        waiting.forEach((x) => { x.state = "fail"; x.error = e.code; });
        toast(errorText(e.code), "error");
        break;
      }
      const exp = Date.now() + (key.expiresIn || 3600) * 1000;
      for (const [i, item] of waiting.entries()) {
        // The key lasts an hour: past ~50 minutes, ask for a new one first.
        if (Date.now() > exp - 10 * 60_000) break;
        item.name = key.names[i] || item.name;
        item.state = "up";
        paint(contentId);
        try {
          const id = await sendClip(item.file, { accessToken: key.accessToken, folderId: key.folderId, name: item.name, onProgress: (p) => { item.pct = p; paintRow(contentId, item); } });
          await review("footage-add", { contentId, ids: [id] });
          item.state = "done";
          item.file = null; // let the memory go
        } catch (e) {
          item.state = "fail";
          item.error = e.code || "network";
        }
        paint(contentId);
      }
    }
  } finally {
    job.running = false;
    const left = job.items.filter((x) => x.state !== "done");
    const sent = job.items.length - left.length;
    if (!left.length) {
      JOBS.delete(contentId);
      if (sent) toast(t(sent === 1 ? "ft.toast.sentOne" : "ft.toast.sent", { n: sent }));
    } else job.items = left;
    paint(contentId);
  }
}

function errorText(code) {
  return t({
    "drive-off": "ft.err.driveOff", "drive-full": "ft.err.full", "not-team": "ft.err.notTeam", size: "ft.err.size", type: "ft.err.type",
    full: "ft.err.tooMany", network: "ft.err.network", expired: "ft.err.network", setup: "post.drive.setup",
  }[code] || "ft.err.other");
}

// ---- on screen -----------------------------------------------------------------
const mb = (n) => {
  const v = Number(n) || 0;
  const loc = getLang() === "en" ? "en-US" : "id-ID";
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toLocaleString(loc, { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(0.1, v / 1024 ** 2).toLocaleString(loc, { maximumFractionDigits: v >= 100 * 1024 ** 2 ? 0 : 1 })} MB`;
};
const when = (ms) => new Date(ms).toLocaleString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const kindIcon = (type, name) => (/^audio\//.test(type) || /\.(wav|m4a|mp3|aac)$/i.test(name) ? "mic" : /^image\//.test(type) ? "image" : "play");

function rowHTML(item, i) {
  const pct = Math.round((item.pct || 0) * 100);
  const state = item.state === "fail"
    ? `<span class="ft-err">${escapeHtml(errorText(item.error))}</span><button type="button" class="btn btn-ghost btn-sm" data-ft-retry="${i}">${icon("refresh", { size: 13 })}${t("ft.retry")}</button>`
    : item.state === "wait" ? `<span class="ft-muted">${t("ft.waiting")}</span>`
    : `<span class="ft-pct" data-ft-pct>${pct}%</span>`;
  return `
      <li class="ft-row is-${item.state}" data-ft-row="${i}">
        <span class="ft-ico">${icon(kindIcon(typeOf(item.file || {}), item.name), { size: 15 })}</span>
        <span class="ft-name"><b>${escapeHtml(item.name)}</b><small>${mb(item.size)}</small>
          ${item.state === "up" || item.state === "wait" ? `<span class="ft-bar"><i data-ft-bar style="width:${pct}%"></i></span>` : ""}</span>
        <span class="ft-state">${state}</span>
      </li>`;
}

function macLineHTML(c) {
  if (!usesOutbox()) return "";
  const o = outboxInfo();
  if (!o.connected) return `<p class="ft-mac is-off">${icon("folder", { size: 14 })}<span>${t("ft.mac.off")}</span></p>`;
  const p = macProgress(c.id);
  if (!p) return `<p class="ft-mac">${icon("folder", { size: 14 })}<span>${t("ft.mac.checking")}</span></p>`;
  const where = `<code>${escapeHtml(`${p.key}/${FOOTAGE_DIR}`)}</code>`;
  if (p.name) return `<p class="ft-mac is-busy">${icon("download", { size: 14 })}<span>${t("ft.mac.copying", { done: p.done, total: p.total, name: escapeHtml(p.name), pct: Math.round(p.pct * 100) })}</span></p>`;
  if (p.error && p.done < p.total) return `<p class="ft-mac is-off">${icon("info", { size: 14 })}<span>${t("ft.mac.failed", { done: p.done, total: p.total })}</span></p>`;
  return `<p class="ft-mac is-on">${icon("check", { size: 14 })}<span>${t("ft.mac.done", { done: p.done, total: p.total, where })}</span></p>`;
}

function innerHTML(c) {
  const b = getBrand(c.brandId);
  const files = c.footage?.files || [];
  const total = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  const drive = clientDriveLine(b);
  const on = drive.tone === "on";
  const amClient = isClientMember(b);
  const job = JOBS.get(c.id);
  const cd = b.clientDrive || {};
  const folder = ["Wepeka Brandlab", b.name, [videoCode(c), c.title].filter(Boolean).join(" · "), "Footage"].map((x) => escapeHtml(x)).join(" › ");
  const pick = on ? `
      <label class="ft-drop" data-ft-drop>
        <input type="file" multiple accept="${ACCEPT}" data-ft-input hidden />
        ${icon("upload", { size: 20 })}
        <span><b>${t("ft.pick")}</b><small>${t("ft.pickHint")}</small></span>
      </label>` : amClient ? `
      <div class="ft-connect">
        <p>${t("ft.connect.body")}</p>
        <button type="button" class="btn btn-primary btn-sm" data-ft-connect>${icon("link", { size: 14 })}${t("post.drive.cta")}</button>
      </div>` : `<p class="ft-muted ft-wait">${icon("info", { size: 14 })}<span>${t("ft.connect.wait")}</span></p>`;
  return `
      <div class="ft-head">
        <b>${icon("play", { size: 15 })}${t("ft.title")}</b>
        ${files.length ? `<span class="ft-count">${t(files.length === 1 ? "ft.countOne" : "ft.count", { n: files.length, size: mb(total) })}</span>` : ""}
      </div>
      <p class="ft-lead">${t(amClient ? "ft.lead.client" : "ft.lead.team")}</p>
      ${pick}
      ${job?.items.some((x) => x.state !== "done") ? `<ul class="ft-list ft-jobs">${job.items.map((x, i) => (x.state === "done" ? "" : rowHTML(x, i))).join("")}</ul>${job.running ? `<p class="ft-muted ft-keep">${icon("info", { size: 13 })}<span>${t("ft.keepOpen")}</span></p>` : ""}` : ""}
      ${files.length ? `
      <ul class="ft-list">
        ${files.slice().reverse().map((f) => `
        <li class="ft-row is-done">
          <span class="ft-ico">${icon(kindIcon(f.type, f.name), { size: 15 })}</span>
          <span class="ft-name"><b>${escapeHtml(f.name)}</b><small>${mb(f.size)} · ${escapeHtml(f.who || "")}${f.at ? ` · ${when(f.at)}` : ""}</small></span>
          <span class="ft-state">${icon("check", { size: 14 })}<button type="button" class="icon-btn ft-del" data-ft-del="${escapeHtml(f.id)}" aria-label="${escapeHtml(t("ft.remove"))}" title="${escapeHtml(t("ft.remove"))}">${icon("trash", { size: 14 })}</button></span>
        </li>`).join("")}
      </ul>` : ""}
      ${on ? `<p class="ft-where">${icon("folder", { size: 13 })}<span>${t("ft.where", { email: escapeHtml(cd.email || ""), folder })}</span></p>` : ""}
      ${files.length ? macLineHTML(c) : ""}`;
}

export function footageBoxHTML(c) {
  if (!canSendFootage(c)) return "";
  return `<section class="cw-foot-box" data-ft="${escapeHtml(c.id)}">${innerHTML(c)}</section>`;
}

// Progress moves many times a second: only the row's bar and number.
function paintRow(contentId, item) {
  const box = document.querySelector(`[data-ft="${CSS.escape(contentId)}"]`);
  const job = JOBS.get(contentId);
  const i = job?.items.indexOf(item);
  const row = box && i >= 0 ? qs(`[data-ft-row="${i}"]`, box) : null;
  if (!row) return;
  const pct = Math.round((item.pct || 0) * 100);
  const bar = qs("[data-ft-bar]", row);
  if (bar) bar.style.width = `${pct}%`;
  const num = qs("[data-ft-pct]", row);
  if (num) num.textContent = `${pct}%`;
}
function paint(contentId) {
  const box = document.querySelector(`[data-ft="${CSS.escape(contentId)}"]`);
  const c = getContent(contentId);
  if (box && c) box.innerHTML = innerHTML(c);
}
if (typeof window !== "undefined") onMacProgress((id) => paint(id));

// One listener per box, on the box itself (its insides are redrawn).
export function wireFootage(root, getPiece) {
  const box = qs("[data-ft]", root);
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  if (usesOutbox() && !outboxInfo().checked) ensureOutbox().then(() => paint(box.dataset.ft));
  const take = (list) => {
    const files = [...(list || [])].filter((f) => f.size > 0);
    if (files.length) addClips(getPiece(), files);
  };
  box.addEventListener("change", (e) => {
    if (!e.target.matches("[data-ft-input]")) return;
    take(e.target.files);
    e.target.value = "";
  });
  box.addEventListener("dragover", (e) => {
    const drop = e.target.closest("[data-ft-drop]");
    if (!drop) return;
    e.preventDefault();
    drop.classList.add("is-over");
  });
  box.addEventListener("dragleave", (e) => e.target.closest("[data-ft-drop]")?.classList.remove("is-over"));
  box.addEventListener("drop", (e) => {
    const drop = e.target.closest("[data-ft-drop]");
    if (!drop) return;
    e.preventDefault();
    drop.classList.remove("is-over");
    take(e.dataTransfer?.files);
  });
  box.addEventListener("click", async (e) => {
    const c = getPiece();
    if (e.target.closest("[data-ft-connect]")) { connectOwnDrive(); return; }
    const retry = e.target.closest("[data-ft-retry]");
    if (retry) {
      const job = JOBS.get(c.id);
      const item = job?.items[Number(retry.dataset.ftRetry)];
      if (item?.file) { item.state = "wait"; item.error = ""; item.pct = 0; paint(c.id); run(c.id); }
      return;
    }
    const del = e.target.closest("[data-ft-del]");
    if (del) {
      const f = (c.footage?.files || []).find((x) => x.id === del.dataset.ftDel);
      if (!f) return;
      const ok = await confirmDialog({ title: t("ft.remove.title"), message: t("ft.remove.body", { name: escapeHtml(f.name) }), confirmLabel: t("ft.remove"), danger: true });
      if (!ok) return;
      del.disabled = true;
      try {
        await review("footage-remove", { contentId: c.id, id: f.id });
        toast(t("ft.removed"));
      } catch (err) {
        del.disabled = false;
        toast(errorText(err.code), "error");
      }
    }
  });
}
