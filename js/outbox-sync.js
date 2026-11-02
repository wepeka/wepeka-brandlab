// Folder di Mac → Brandlab: every post folder in the Outbox (js/outbox.js)
// becomes, or updates, one piece of its brand — on the calendar, with its
// versions waiting in "Perlu dicek". The folder adds; Brandlab decides. A new
// cut Claude drops in shows up as the next revision; nothing in Brandlab is
// ever removed because a file went away. A folder named with a piece's code
// ("KP-12 …", js/video-codes.js) joins that piece from Creator instead of
// making a new one; "KP-12C …" with no such trial yet makes trial C of KP-12.
// "Send to editor" (posting.editor) rides along: every sync rewrites the
// queue for Claude (permintaan-editor.json) and closes a request once a
// newer cut is in the folder.
import { listBrands, listContent, createContent, updateContent } from "./store.js";
import { scanOutbox, outboxState, writeRootFile } from "./outbox.js";
import { ensureCodes, videoCode, parseCode, trialFields } from "./video-codes.js";

export const FORMAT_OF = { reels: "Reels", carousel: "Carousel", foto: "Static Post", story: "Story" };
const norm = (s) => String(s || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
const MAP_KEY = "posting:brandMap";

// Which brand a folder belongs to: its name (or post.json "brand") against
// brand names and Instagram handles, or a pick the person made once.
export function matchBrand(name, brands, picks = {}) {
  const n = norm(name);
  if (!n) return null;
  if (picks[n]) return brands.find((b) => b.id === picks[n]) || null;
  return brands.find((b) => norm(b.name) === n || norm(b.instagram?.username) === n)
    || brands.find((b) => norm(b.name).startsWith(n) || n.startsWith(norm(b.name)))
    || null;
}

function readPicks() {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) || "{}"); } catch { return {}; }
}
export function pickBrand(folderName, brandId) {
  const picks = readPicks();
  picks[norm(folderName)] = brandId;
  try { localStorage.setItem(MAP_KEY, JSON.stringify(picks)); } catch { /* asked again next time */ }
}

// Same file name → same id, so a re-scan never doubles a version.
export const versionIdOf = (file) => `l-${Array.from(file).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36)}`;

const toVersion = (v, n, changes = {}) => ({ id: versionIdOf(v.file), n, status: "pending", at: Date.now(), by: "editor", kind: v.kind, local: { file: v.file, ...(v.slides ? { slides: v.slides } : {}) }, ...(changes[v.file] ? { changeNote: changes[v.file] } : {}) });

// ---- Send to editor ------------------------------------------------------------
// A version as the editor request names it: the file ("v2.mp4", "01.jpg"),
// or a carousel's folder with a slash ("v2/"); "slides" = the images loose
// in the post folder itself.
export const editorVersionOf = (v) => (!v?.local ? "" : v.kind === "set" && v.local.file !== "slides" ? `${v.local.file}/` : v.local.file);
// Where in the list of cuts the requested one sits (-1: not there anymore).
export const editorVersionIndex = (versions, version) => versions.findIndex((v) => v.local?.file === String(version || "").replace(/\/$/, ""));

// A note as Claude reads it (brandlab.json, permintaan-editor.json): the
// file and second it is about, who wrote it. id goes into post.json "done".
const clock = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
export function noteForEditor(p, n) {
  const file = (p.versions || []).find((v) => v.id === n.versionId)?.local?.file || "";
  return { id: n.id, file, at: clock(n.t), seconds: n.t, text: n.text, done: !!n.done, from: n.by === "client" ? "klien" : "winson", ...(n.name ? { name: n.name } : {}) };
}

// permintaan-editor.json: every piece, across brands, sent to the editor and
// not delivered yet. entries = [{ c, brand: "Kopi Pagi", code: "KP-12" }].
export function editorQueue(entries) {
  return {
    requests: entries.filter(({ c }) => c.posting?.editor?.status === "requested").map(({ c, brand, code }) => {
      const p = { versions: [], notes: [], ...c.posting };
      const ed = p.editor;
      const ids = Array.isArray(ed.noteIds) ? ed.noteIds : [];
      return {
        code: code || "", brand: brand || "", folder: p.local?.key || "", type: p.type || "reels",
        version: ed.version || "", message: ed.message || "", noteIds: ids,
        notes: ids.map((id) => (p.notes || []).find((n) => n.id === id)).filter(Boolean).map((n) => noteForEditor(p, n)),
        requestedAt: ed.requestedAt || "",
      };
    }).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
  };
}

// Written at the top of the folder whenever the list changes — after every
// sync, so a request sent from the phone reaches Claude the next time the
// Antrean (or the Kalender) is open in Chrome on the Mac.
let lastQueue = "";
export async function writeEditorQueue() {
  if (!outboxState().connected) return;
  const data = editorQueue(listBrands().flatMap((b) => listContent(b.id).filter((c) => c.posting?.editor?.status === "requested").map((c) => ({ c, brand: b.name, code: videoCode(c) }))));
  const sig = JSON.stringify(data);
  if (sig === lastQueue) return;
  lastQueue = sig;
  try {
    await writeRootFile("permintaan-editor.json", JSON.stringify({ updatedAt: new Date().toISOString(), ...data }, null, 2));
  } catch (e) {
    lastQueue = "";
    console.warn("[outbox] permintaan-editor.json not written", e);
  }
}

// The pure part: what to create and what to update for these posts.
// find = { byKey(folder key), byCode("KP-12") } — or one function for byKey.
export function planSync(posts, brands, find, picks = {}) {
  const { byKey, byCode = () => null } = typeof find === "function" ? { byKey: find } : find;
  const create = [], update = [], unmatched = [];
  for (const post of posts) {
    let c = byKey(post.key);
    const code = parseCode(post.code)?.code;
    if (!c && code) {
      const hit = byCode(code);
      if (hit?.posting?.local?.key) continue; // that piece already has its folder
      if (hit) c = hit;
      else {
        // A trial Claude started on its own: make it next to its piece.
        const want = parseCode(code);
        const parent = want?.letter ? byCode(want.base) : null;
        if (parent && !parent.trialOf) {
          create.push({ brandId: parent.brandId, data: {
            ...trialFields(parent, want.letter), status: "editing", caption: post.caption || parent.caption || "",
            posting: { local: { key: post.key }, type: post.type, covers: post.covers, cover: post.covers[0] || "", time: post.time || parent.posting?.time || "", trialReel: true, versions: post.versions.map((v, i) => toVersion(v, i, post.changes)), notes: [] },
          } });
          continue;
        }
      }
    }
    if (!c) {
      const brand = matchBrand(post.brand, brands, picks);
      if (!brand) { unmatched.push(post); continue; }
      create.push({ brandId: brand.id, data: {
        title: post.title, scheduleDate: post.date, status: "editing", platform: "Instagram", format: FORMAT_OF[post.type],
        caption: post.caption,
        posting: { local: { key: post.key }, type: post.type, covers: post.covers, cover: post.covers[0] || "", time: post.time || "19:00", versions: post.versions.map((v, i) => toVersion(v, i, post.changes)), notes: [] },
      } });
      continue;
    }
    const p = { versions: [], notes: [], ...(c.posting || {}) };
    const linking = p.local?.key !== post.key;
    const known = new Set(p.versions.map((v) => v.local?.file));
    const fresh = post.versions.filter((v) => !known.has(v.file));
    const coversChanged = JSON.stringify(post.covers) !== JSON.stringify(p.covers || []);
    // Claude wrote (or rewrote) what a cut changes, or ticked notes it fixed.
    const changes = post.changes || {};
    const noteChanged = p.versions.some((v) => changes[v.local?.file] && changes[v.local.file] !== v.changeNote);
    const fixed = new Set((post.done || []).filter((id) => (p.notes || []).some((n) => n.id === id && !n.done)));
    // Sent to the editor and a newer cut is in the folder: Claude delivered.
    const cuts = [...p.versions, ...fresh.map((v) => ({ local: { file: v.file } }))];
    const asked = p.editor?.status === "requested" ? editorVersionIndex(cuts, p.editor.version) : null;
    const delivered = asked !== null && (asked >= 0 ? asked < cuts.length - 1 : fresh.length > 0);
    if (!linking && !fresh.length && !coversChanged && !noteChanged && !fixed.size && !delivered && (c.caption || !post.caption)) continue;
    const versions = p.versions.map((v) => (changes[v.local?.file] && changes[v.local.file] !== v.changeNote ? { ...v, changeNote: changes[v.local.file] } : v));
    const patch = { posting: { ...p, versions: [...versions, ...fresh.map((v, i) => toVersion(v, p.versions.length + i, changes))], covers: post.covers, cover: p.cover || post.covers[0] || "" } };
    if (fixed.size) patch.posting.notes = p.notes.map((n) => (fixed.has(n.id) ? { ...n, done: true, doneBy: "editor" } : n));
    if (delivered) patch.posting.editor = { ...p.editor, status: "done", doneAt: new Date().toISOString() };
    // A piece from Creator meets its folder for the first time.
    if (linking) Object.assign(patch.posting, { local: { key: post.key }, type: p.type || post.type, time: p.time || post.time || "" });
    if (linking && post.type && !c.format) patch.format = FORMAT_OF[post.type];
    // A new cut waits for a fresh look; a booked slot is let go until then.
    if (fresh.length) {
      if (p.ig?.state === "scheduled") patch.posting.ig = null;
      if (["idea", "draft", "production", "scheduled"].includes(c.status)) patch.status = "editing";
    }
    if (!c.caption && post.caption) patch.caption = post.caption;
    update.push({ id: c.id, patch, added: fresh.length });
  }
  return { create, update, unmatched };
}

let running = null;
export function syncOutbox() {
  if (running) return running;
  running = (async () => {
    const posts = await scanOutbox();
    ensureCodes();
    const brands = listBrands();
    const pieces = brands.flatMap((b) => listContent(b.id));
    const byKey = new Map(pieces.filter((c) => c.posting?.local?.key).map((c) => [c.posting.local.key, c]));
    const byCode = new Map(pieces.filter((c) => c.videoNo).map((c) => [videoCode(c), c]));
    const plan = planSync(posts, brands, { byKey: (key) => byKey.get(key), byCode: (code) => byCode.get(code) }, readPicks());
    plan.create.forEach(({ brandId, data }) => createContent(brandId, data));
    plan.update.forEach(({ id, patch }) => updateContent(id, patch));
    if (plan.create.length) ensureCodes();
    await writeEditorQueue();
    return { created: plan.create.length, added: plan.update.reduce((n, u) => n + u.added, 0), unmatched: plan.unmatched, posts: posts.length };
  })().finally(() => { running = null; });
  return running;
}
