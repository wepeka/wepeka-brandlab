// Client review links (owner, 2026-11-02: "clientku bisa lihat juga preview
// videonya, tapi setelah di-approve videonya kehapus dan berupa link
// Instagram"). One link per brand, brandlab.wepeka.com/review/<token>, that
// the client opens without an account: the cuts Wepeka sent them, to watch
// and approve or send back with a note at a moment of the video.
//
// The cut itself lives on the Mac (js/outbox.js), so "Kirim ke klien" copies
// it to Cloud Storage for a while: review/<owner>/<piece>/<cut>/<file>. Only
// the server touches Storage (no client SDK, no storage rules): it hands the
// owner's browser a resumable upload URL and the client page short-lived
// signed URLs. Copies go as soon as they're not needed — other cuts when one
// is approved, the approved one when the post is up (js/posting.js "clean");
// from then on the client sees the Instagram post instead.
//
// Data: reviewLinks/{token} = { ownerId, brandId, createdAt } (server only,
// no rules match = closed to browsers); on the piece, posting.previews =
// { [cutId]: { paths, kind, at } } and posting.client = { versionId, code,
// status: "waiting"|"revision"|"approved", sentAt, decidedAt, name }.
// Plain Web Crypto (Node 18+ and browsers alike), so the preview harness can
// run these same functions.
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const MAX_FILE = 300 * 1048576; // Instagram's Reels limit
export const SIGNED_FOR = 12 * 3600 * 1000;
export const newToken = () => btoa(String.fromCharCode(...rand(18))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
export const prefixOf = (uid, contentId, versionId) => `review/${uid}/${contentId}/${versionId}/`;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);
const safeName = (s) => clean(s, 80).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "file";

export function fail(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

// Where each file of a cut goes in Storage.
export function uploadPaths(uid, contentId, versionId, files) {
  if (!Array.isArray(files) || !files.length || files.length > 20) throw fail(400, "files");
  return files.map((f, i) => {
    if (!(Number(f?.size) > 0) || Number(f.size) > MAX_FILE) throw fail(400, "size");
    const type = String(f.type || "");
    if (!/^(video|image)\//.test(type)) throw fail(400, "type");
    return { path: `${prefixOf(uid, contentId, versionId)}${String(i + 1).padStart(2, "0")}-${safeName(f.name)}`, type };
  });
}

// The piece after a cut is sent: that cut's copies recorded, every other
// cut's copies to delete, the client waiting on it.
export function applySend(c, { uid, versionId, paths, kind, code, now = Date.now() }) {
  const p = c.posting || {};
  if (!(p.versions || []).some((v) => v.id === versionId)) throw fail(404, "version");
  const want = prefixOf(uid, c.id, versionId);
  if (!Array.isArray(paths) || !paths.length || !paths.every((x) => typeof x === "string" && x.startsWith(want) && !x.includes(".."))) throw fail(400, "paths");
  const removePaths = Object.entries(p.previews || {}).filter(([vid]) => vid !== versionId).flatMap(([, pv]) => pv.paths || []);
  const next = {
    ...p,
    previews: { [versionId]: { paths, kind: ["video", "set", "image"].includes(kind) ? kind : "video", at: now } },
    client: { versionId, code: clean(code, 16), status: "waiting", sentAt: now, decidedAt: 0, name: "" },
  };
  return { patch: { posting: next }, removePaths };
}

// The client's answer on the cut they were sent.
export function applyDecision(c, { versionId, verdict, note, name, now = Date.now() }) {
  const p = c.posting || {};
  const cl = p.client;
  if (!cl || cl.versionId !== versionId) throw fail(409, "stale"); // a newer cut went out meanwhile
  if (!["approve", "revise"].includes(verdict)) throw fail(400, "verdict");
  if (p.ig?.state === "published" || c.status === "published") throw fail(409, "posted");
  const text = clean(note?.text, 800);
  if (verdict === "revise" && !text) throw fail(400, "note");
  const who = clean(name, 60);
  const ok = verdict === "approve";
  const next = {
    ...p,
    versions: (p.versions || []).map((v) => (v.id === versionId ? { ...v, status: ok ? "approved" : "revision" } : v)),
    notes: [...(p.notes || []), ...(text ? [{ id: `c${now.toString(36)}${hex(rand(2))}`, versionId, t: Math.max(0, Math.floor(Number(note?.t) || 0)), text, at: now, done: false, by: "client", ...(who ? { name: who } : {}) }] : [])],
    client: { ...cl, status: ok ? "approved" : "revision", decidedAt: now, name: who },
  };
  let removePaths = [];
  if (ok) {
    next.finalId = versionId;
    // Only the approved cut stays viewable, until the post is up.
    next.previews = Object.fromEntries(Object.entries(p.previews || {}).filter(([vid]) => vid === versionId));
    removePaths = Object.entries(p.previews || {}).filter(([vid]) => vid !== versionId).flatMap(([, pv]) => pv.paths || []);
  } else if (p.finalId === versionId) next.finalId = null;
  return { patch: { posting: next }, removePaths };
}

// The post is up: every copy goes, the Instagram link takes their place.
export function applyClean(c) {
  const p = c.posting || {};
  return { patch: { posting: { ...p, previews: {} } }, removePaths: Object.values(p.previews || {}).flatMap((pv) => pv.paths || []) };
}

const ORDER = { waiting: 0, revision: 1, approved: 2, posted: 3 };
const isPosted = (c) => c.posting?.ig?.state === "published" || c.status === "published";

// What the client page shows: the brand, and every piece sent to them —
// waiting first. `sign(path)` turns a stored copy into a URL to play.
export async function clientView({ brand, contents, sign }) {
  const items = [];
  for (const c of contents) {
    if (c.deletedAt || c.archived) continue;
    const p = c.posting || {};
    const cl = p.client;
    const v = cl && (p.versions || []).find((x) => x.id === cl.versionId);
    if (!v) continue;
    const posted = isPosted(c);
    const permalink = posted ? clean(p.ig?.permalink || c.publishedUrl, 300) : "";
    const copy = p.previews?.[v.id];
    items.push({
      id: c.id,
      code: cl.code || "",
      title: clean(c.title, 200),
      date: c.scheduleDate || "",
      time: p.time || "",
      type: p.type || "reels",
      caption: clean(c.caption, 2200),
      state: posted ? "posted" : cl.status,
      version: { id: v.id, n: v.n || 0, kind: copy?.kind || v.kind || "video", changeNote: clean(v.changeNote, 600) },
      // The video until the Instagram post replaces it.
      files: !permalink && copy?.paths?.length ? await Promise.all(copy.paths.map(sign)) : [],
      notes: (p.notes || []).filter((n) => n.by === "client" && n.versionId === v.id).map((n) => ({ t: n.t || 0, text: n.text, name: n.name || "", done: !!n.done })),
      permalink,
      sentAt: cl.sentAt || 0,
      decidedAt: cl.decidedAt || 0,
      name: cl.name || "",
    });
  }
  items.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.state === "posted" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || b.sentAt - a.sentAt);
  return {
    brand: { name: clean(brand?.name, 80), color: /^#[0-9a-f]{3,8}$/i.test(brand?.color || "") ? brand.color : "", handle: clean(brand?.instagram?.username, 40).replace(/^@/, "") },
    items,
  };
}

// The checks every signed-in action shares: the piece is the caller's own.
export function ownPiece(c, uid) {
  if (!c) throw fail(404, "content");
  if (c.ownerId !== uid) throw fail(403, "owner");
  return c;
}
