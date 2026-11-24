// "Folder di Mac" — where Video & posting reads Wepeka's own work (owner,
// 2026-11-01: Claude edits the videos on his Mac and the results should land
// in Brandlab by themselves; decisions go back so Claude can revise). Chrome's
// File System Access: the folder is picked once, its handle kept in IndexedDB;
// after a reload Chrome asks again with one click (or remembers it).
//
// Folder shape (Claude writes it; .claude/social-hub/OUTBOX.md):
//   <Outbox>/daftar-video.json   written BY Brandlab: every coded piece (KP-12)
//   <Outbox>/<brand>/<[code] YYYY-MM-DD title>/
//     post.json        { code, title, date, time, type, caption, brand,  (all optional)
//                        changes: { "v2.mp4": "what Claude changed" }, done: [note ids fixed] }
//     *.mp4 / *.mov    video versions, oldest first by name (v1, v2 …)
//     cover*.jpg/png   cover options for a Reels
//     *.jpg / *.png    a photo, or carousel slides in name order (01, 02 …)
//     v1/, v2/ …       carousel versions: each folder is one set of slides
//     footage/         written BY Brandlab: the shoot's raw clips the client's
//                      crew sent (js/footage-mac.js) — never a cut
//     brandlab.json    written BY Brandlab: the decisions and notes for Claude
const DB = "brandlab-outbox";
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|heic)$/i;
const COVER_RE = /^(cover|thumb|thumbnail|sampul)/i;
const DATED_RE = /^(\d{4}-\d{2}-\d{2})\s*[·\-–]?\s*(.*)$/;
const CODED_RE = /^([A-Z][A-Z0-9]{0,5}-\d{1,4}[B-Z]?)(?:\s*[·\-–]\s*|\s+|$)(.*)$/;
export const FOOTAGE_DIR = "footage";
const FOOTAGE_RE = /^footage$/i;

export const outboxSupported = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

// ---- the handle, kept across reloads ----------------------------------------
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("h");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("h", mode);
        const req = fn(tx.objectStore("h"));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e); // e.g. a handle that can't be stored
      }
    };
  });
}

let root = null;
let state = { connected: false, name: "", needsPermission: false };
export const outboxState = () => ({ ...state });

// Chrome can stop answering for a saved folder (owner's Chrome 158 after a
// forced restart, 2026-11-24: queryPermission, listing, everything on the old
// handle hung for good, so Antrean waited forever with no folder button, no
// covers and no videos). No answer within `wait` = forget that handle and
// show "Hubungkan folder di Mac", which picks the folder afresh.
const ANSWER_MS = 5000;
export async function restoreOutbox({ wait = ANSWER_MS } = {}) {
  if (!outboxSupported()) return outboxState();
  let saved = null;
  try { saved = await idb("readonly", (s) => s.get("root")); } catch { /* no saved folder */ }
  if (!saved) return outboxState();
  let timer;
  try {
    const perm = await Promise.race([
      saved.queryPermission?.({ mode: "readwrite" }),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error("no answer")), wait); }),
    ]);
    root = saved;
    state = { connected: perm === "granted", name: saved.name, needsPermission: perm !== "granted" };
  } catch {
    root = null;
    state = { connected: false, name: saved.name, needsPermission: false };
  } finally {
    clearTimeout(timer);
  }
  return outboxState();
}

// Both need a click (Chrome only shows the picker or the prompt from one).
export async function connectOutbox() {
  const dir = await window.showDirectoryPicker({ id: "brandlab-outbox", mode: "readwrite", startIn: "documents" });
  root = dir;
  try { await idb("readwrite", (s) => s.put(dir, "root")); } catch { /* this tab still has it */ }
  state = { connected: true, name: dir.name, needsPermission: false };
  return outboxState();
}

export async function grantOutbox() {
  if (!root) return outboxState();
  const perm = await root.requestPermission?.({ mode: "readwrite" });
  state = { ...state, connected: perm === "granted", needsPermission: perm !== "granted" };
  return outboxState();
}

// ---- reading -----------------------------------------------------------------
async function list(dir) {
  const out = [];
  for await (const h of dir.values()) out.push(h);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function readJSON(dir, name) {
  try {
    const f = await (await dir.getFileHandle(name)).getFile();
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

// One post folder's entries → what it holds. Pure, so it is tested alone.
export function readPostEntries(folderName, entries, manifest = {}) {
  const files = entries.filter((e) => e.kind === "file").map((e) => e.name);
  const dirs = entries.filter((e) => e.kind === "directory");
  // "KP-12 2026-11-03 Judul": the code first, then the usual name.
  const coded = CODED_RE.exec(folderName);
  const code = String(manifest.code || (coded ? coded[1] : "")).trim().toUpperCase();
  const rest = coded ? coded[2] : folderName;
  const m = DATED_RE.exec(rest);
  const videos = files.filter((n) => VIDEO_RE.test(n));
  const images = files.filter((n) => IMAGE_RE.test(n));
  const covers = images.filter((n) => COVER_RE.test(n));
  const slides = images.filter((n) => !COVER_RE.test(n));
  const sets = dirs.filter((d) => d.slides?.length).map((d) => ({ dir: d.name, slides: d.slides }));
  let type = String(manifest.type || "").toLowerCase();
  if (!["reels", "carousel", "foto", "story"].includes(type)) type = videos.length ? "reels" : sets.length || slides.length > 1 ? "carousel" : "foto";
  const versions = type === "carousel"
    ? (sets.length ? sets : slides.length ? [{ dir: "", slides }] : []).map((s) => ({ file: s.dir || "slides", kind: "set", slides: s.slides }))
    : type === "foto" ? slides.map((n) => ({ file: n, kind: "image" }))
    : videos.map((n) => ({ file: n, kind: "video" }));
  return {
    code,
    title: String(manifest.title || (m ? m[2] : rest) || folderName).trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(manifest.date || "") ? manifest.date : m ? m[1] : "",
    time: /^\d{2}:\d{2}$/.test(manifest.time || "") ? manifest.time : "",
    caption: typeof manifest.caption === "string" ? manifest.caption : "",
    brand: typeof manifest.brand === "string" ? manifest.brand : "",
    // Claude's side of a revision: what changed in a cut, which notes it fixed.
    changes: Object.fromEntries(Object.entries(manifest.changes && typeof manifest.changes === "object" ? manifest.changes : {}).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 600)])),
    done: Array.isArray(manifest.done) ? manifest.done.filter((x) => typeof x === "string") : [],
    type,
    versions,
    covers,
  };
}

// Every post under every brand folder. Dot-folders and stray files are skipped.
export async function scanOutbox() {
  if (!root || !state.connected) return [];
  const posts = [];
  for (const brandDir of await list(root)) {
    if (brandDir.kind !== "directory" || brandDir.name.startsWith(".")) continue;
    for (const postDir of await list(brandDir)) {
      if (postDir.kind !== "directory" || postDir.name.startsWith(".")) continue;
      const entries = [];
      for (const e of await list(postDir)) {
        if (e.kind === "directory" && FOOTAGE_RE.test(e.name)) continue; // raw clips, not a cut
        if (e.kind === "directory") {
          const slides = (await list(e)).filter((x) => x.kind === "file" && IMAGE_RE.test(x.name)).map((x) => x.name);
          entries.push({ kind: "directory", name: e.name, slides });
        } else entries.push({ kind: "file", name: e.name });
      }
      const manifest = (await readJSON(postDir, "post.json")) || {};
      const post = readPostEntries(postDir.name, entries, manifest);
      if (!post.versions.length && !post.covers.length) continue;
      posts.push({ key: `${brandDir.name}/${postDir.name}`, brandFolder: brandDir.name, folder: postDir.name, ...post, brand: post.brand || brandDir.name });
    }
  }
  return posts;
}

async function postDir(key, { create = false } = {}) {
  const [b, p] = key.split("/");
  const brand = await root.getDirectoryHandle(b, { create });
  return brand.getDirectoryHandle(p, { create });
}

// A file of a post as a URL this tab can play or show: one per file, kept
// while the tab lives and never revoked, because a player may still be
// reading it. (Owner, 2026-11-24: "gabisa preview video di quatro". The old
// cap of 40 URLs revoked the oldest ones, so on a brand with more than 40
// pieces in the folder, opening a piece made thumbnails of its older cuts
// and that revoked the URL of the video on screen: it never started.)
// The File is the file on disk, not a copy in memory, so keeping them costs
// next to nothing. A file rewritten under the same name (a new cover-1.jpg)
// gets a fresh URL, since the old one can't read the new bytes.
const urls = new Map(); // id → { url, stamp }
export async function outboxFileURL(key, file) {
  const f = await outboxFile(key, file);
  const id = `${key}/${file}`;
  const stamp = `${f.size}:${f.lastModified}`;
  const had = urls.get(id);
  if (had?.stamp === stamp) return had.url;
  const url = URL.createObjectURL(f);
  urls.set(id, { url, stamp });
  return url;
}

// The file itself (to send a cut to the client's review link).
export async function outboxFile(key, file) {
  let dir = await postDir(key);
  const parts = file.split("/");
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
}

// A small still for cards and the feed: the cover, or a frame of the video.
// Takes a version as the piece stores it ({ kind, local: { file, slides } }).
// Covers and slides are the files themselves; a video's frame is drawn once
// and kept (a failed one is tried again next time).
const frames = new Map();
export async function outboxThumb(key, version, cover) {
  const file = version?.local?.file;
  if (cover) return outboxFileURL(key, cover);
  if (!file) return "";
  if (version.kind === "set") return outboxFileURL(key, `${file === "slides" ? "" : `${file}/`}${version.local.slides?.[0] || ""}`);
  if (version.kind === "image") return outboxFileURL(key, file);
  const id = `${key}/${file}`;
  if (frames.has(id)) return frames.get(id);
  const job = outboxFile(key, file).then((f) => frameSlot(() => videoFrame(f)));
  frames.set(id, job);
  const forget = () => { if (frames.get(id) === job) frames.delete(id); };
  job.then((src) => { if (!src) forget(); }, forget);
  return job;
}

// A frame from about a third in (at most 1 s), from a URL of its own that is
// let go as soon as the frame is drawn. A few at a time: a gallery of fifty
// pieces would otherwise open fifty hidden full-size players at once.
function videoFrame(f) {
  const src = URL.createObjectURL(f);
  const v = document.createElement("video");
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(""), 20000);
    const done = (x) => { clearTimeout(timer); resolve(x); };
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      c.width = 270;
      c.height = Math.round((270 * (v.videoHeight || 16)) / (v.videoWidth || 9));
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      done(c.toDataURL("image/jpeg", 0.72));
    };
    v.onerror = () => done("");
    v.src = src;
  }).finally(() => {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(src);
  });
}
const FRAME_SLOTS = 3;
let framesBusy = 0;
const frameQueue = [];
function frameSlot(fn) {
  // A finished job hands its slot straight to the next one waiting.
  const run = () => fn().finally(() => { const next = frameQueue.shift(); if (next) next(); else framesBusy--; });
  if (framesBusy < FRAME_SLOTS) { framesBusy++; return run(); }
  return new Promise((resolve) => frameQueue.push(() => resolve(run())));
}

// ---- writing -----------------------------------------------------------------
async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

// The list of every coded piece at the top of the folder (daftar-video.json),
// so "KP-12" in a chat with Claude is enough.
export async function writeRootFile(name, text) {
  if (!root || !state.connected) return;
  await writeFile(root, name, text);
}

// What Brandlab decided, for Claude to read before the next cut.
export async function writeDecisions(key, data) {
  if (!root || !state.connected) return;
  await writeFile(await postDir(key), "brandlab.json", JSON.stringify(data, null, 2));
}

// A video dropped into Brandlab (from the calendar or the drawer) goes into
// the folder too, so the folder stays the one place everything lives.
export async function addToOutbox({ brandFolder, folder, file, name, manifest }) {
  const brand = await root.getDirectoryHandle(brandFolder, { create: true });
  const dir = await brand.getDirectoryHandle(folder, { create: true });
  await writeFile(dir, name, file);
  if (manifest) await writeFile(dir, "post.json", JSON.stringify(manifest, null, 2));
  return `${brandFolder}/${folder}`;
}

// The shoot's raw clips (js/footage-mac.js): <post folder>/footage/<name>.
// Size of one already there (-1: not there), and a stream to write one.
// Chrome only puts the file in place when the stream closes, so a copy cut
// off halfway never shows up as a finished clip.
async function footageDir(key, create) {
  if (!root || !state.connected) throw new DOMException("no folder", "NotFoundError");
  return (await postDir(key, { create })).getDirectoryHandle(FOOTAGE_DIR, { create });
}
export async function outboxClipSize(key, name) {
  try {
    return (await (await (await footageDir(key, false)).getFileHandle(name)).getFile()).size;
  } catch {
    return -1;
  }
}
// The clip itself, to look at in Antrean → Footage (null: not on the Mac yet).
export async function outboxClipFile(key, name) {
  try {
    return await (await (await footageDir(key, false)).getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}
export async function outboxClipWriter(key, name) {
  return (await (await footageDir(key, true)).getFileHandle(name, { create: true })).createWritable();
}
