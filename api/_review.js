// The client's side of a piece's video (owner, 2026-11-09: "aku mau quatro
// buka lewat brandlab … gabisa upload langsung ke instagram cuma bisa
// preview aja … datanya disimpan di google drive mereka … aku yang take
// control … kalau disetujui yang revisian sebelumnya auto kehapus").
//
// A client is a team member Wepeka invited as "Klien" (api/team.js): they
// open Brandlab, read the brand like "Lihat saja", and in Antrean Video they
// watch the cuts sent to them, write notes and approve — through the server
// (api/review/[action].js), since they can't write a piece themselves.
// Posting stays Wepeka's.
//
// The cuts live in the client's OWN Google Drive (api/_clientDrive.js),
// not in Brandlab's storage: "Kirim ke klien" copies a cut from Wepeka's
// Mac folder into Wepeka Brandlab / <brand> / <code · title>. On the piece:
//   posting.previews  { [cutId]: { drive: [{ id, name }], poster, kind, at } }
//   posting.client    { versionId, code, status: "waiting"|"revision"|"approved",
//                       sentAt, decidedAt, name }
//   posting.clientFolder  the piece's folder id in the client's Drive
// Every cut sent stays there to compare until one is approved; then the
// others are deleted from the client's Drive and the approved one is named
// FINAL. Older pieces may still carry a Cloud Storage copy ({ paths }, the
// 11-02 review link): those are cleaned up the same way.
//
// Plain Web Crypto (Node 18+ and browsers alike), so the preview harness can
// run these same functions.
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const MAX_FILE = 300 * 1048576; // Instagram's Reels limit
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

export function fail(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const driveIdsOf = (pv) => [...(pv?.drive || []).map((f) => f.id), ...(pv?.poster ? [pv.poster] : [])];
const pathsOf = (pv) => pv?.paths || [];
export const versionName = (v) => (v?.n ? `Revisi ${v.n}` : "Versi pertama");

// The files of one cut as the owner's browser describes them before upload.
export function checkUploads(files) {
  if (!Array.isArray(files) || !files.length || files.length > 20) throw fail(400, "files");
  for (const f of files) {
    if (!(Number(f?.size) > 0) || Number(f.size) > MAX_FILE) throw fail(400, "size");
    if (!/^(video|image)\//.test(String(f.type || ""))) throw fail(400, "type");
  }
  return files;
}

// Names in the client's Drive: "QN-01 · Revisi 2.mp4", a carousel's slides
// "QN-03 · Revisi 1 · 02.jpg", and the gallery's still "… · sampul.jpg".
export function driveNames({ code, version, files }) {
  const base = [clean(code, 16), versionName(version)].filter(Boolean).join(" · ");
  const ext = (f) => (/\.([A-Za-z0-9]{2,5})$/.exec(String(f?.name || "")) || [])[1]?.toLowerCase() || (/image/.test(f?.type || "") ? "jpg" : "mp4");
  return {
    names: checkUploads(files).map((f, i) => (files.length > 1 ? `${base} · ${String(i + 1).padStart(2, "0")}.${ext(f)}` : `${base}.${ext(f)}`)),
    poster: `${base} · sampul.jpg`,
  };
}
// The approved cut, renamed in the client's Drive so the keeper is obvious.
export const finalName = (code, name) => {
  const ext = (/\.([A-Za-z0-9]{2,5})$/.exec(String(name || "")) || [])[1] || "mp4";
  const slide = (/ · (\d{2})\.[A-Za-z0-9]{2,5}$/.exec(String(name || "")) || [])[1];
  return `${[clean(code, 16), "FINAL", slide].filter(Boolean).join(" · ")}.${ext}`;
};

// The piece after a cut is sent: its Drive copy recorded, the client
// waiting on it. Older cuts stay (to compare) until one is approved; an old
// Storage copy goes now; a cut sent again replaces its own copy.
export function applySend(c, { versionId, drive, poster = "", kind, code, now = Date.now() }) {
  const p = c.posting || {};
  if (!(p.versions || []).some((v) => v.id === versionId)) throw fail(404, "version");
  if (!Array.isArray(drive) || !drive.length || drive.length > 20 || !drive.every((f) => ID_RE.test(String(f?.id || "")))) throw fail(400, "files");
  if (poster && !ID_RE.test(String(poster))) throw fail(400, "files");
  const copy = { drive: drive.map((f) => ({ id: f.id, name: clean(f.name, 120) })), ...(poster ? { poster } : {}) };
  const prev = p.previews || {};
  const keep = Object.fromEntries(Object.entries(prev).filter(([vid, pv]) => vid !== versionId && pv.drive));
  const removePaths = Object.entries(prev).filter(([vid]) => !keep[vid]).flatMap(([, pv]) => pathsOf(pv));
  const fresh = new Set(driveIdsOf(copy));
  const removeDrive = driveIdsOf(prev[versionId]).filter((id) => !fresh.has(id));
  const next = {
    ...p,
    previews: { ...keep, [versionId]: { ...copy, kind: ["video", "set", "image"].includes(kind) ? kind : "video", at: now } },
    client: { versionId, code: clean(code, 16), status: "waiting", sentAt: now, decidedAt: 0, name: "" },
  };
  return { patch: { posting: next }, removePaths, removeDrive };
}

// Everything but `keepId`'s copy goes (Storage paths and Drive files).
function keepOnly(previews, keepId) {
  const all = Object.entries(previews || {});
  return {
    previews: Object.fromEntries(all.filter(([vid]) => vid === keepId)),
    removePaths: all.filter(([vid]) => vid !== keepId).flatMap(([, pv]) => pathsOf(pv)),
    removeDrive: all.filter(([vid]) => vid !== keepId).flatMap(([, pv]) => driveIdsOf(pv)),
  };
}

// The client's answer on the cut they were sent: approve it, or a note — at
// a second of the video, or for the whole video (t: null) — any number of
// times until the next cut comes.
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
  const t = note?.t === null ? null : Math.max(0, Math.floor(Number(note?.t) || 0));
  const next = {
    ...p,
    versions: (p.versions || []).map((v) => (v.id === versionId ? { ...v, status: ok ? "approved" : "revision" } : v)),
    notes: [...(p.notes || []), ...(text ? [{ id: `c${now.toString(36)}${hex(rand(2))}`, versionId, t, text, at: now, done: false, by: "client", ...(who ? { name: who } : {}) }] : [])],
    client: { ...cl, status: ok ? "approved" : "revision", decidedAt: now, name: who || cl.name || "" },
  };
  let removePaths = [];
  let removeDrive = [];
  let finalize = null;
  if (ok) {
    next.finalId = versionId;
    // Only the approved cut stays: older ones leave the client's Drive.
    ({ previews: next.previews, removePaths, removeDrive } = keepOnly(p.previews, versionId));
    const kept = next.previews[versionId];
    if (kept?.drive) finalize = { versionId, files: kept.drive, code: cl.code || "" };
  } else if (p.finalId === versionId) next.finalId = null;
  return { patch: { posting: next }, removePaths, removeDrive, finalize };
}

// Wepeka approved a cut in Brandlab itself: the same clean-up in the
// client's Drive as when the client approves.
export function applyKeepFinal(c) {
  const p = c.posting || {};
  const keepId = p.finalId;
  if (!keepId) return { patch: null, removePaths: [], removeDrive: [] };
  const out = keepOnly(p.previews, keepId);
  const kept = out.previews[keepId];
  return { patch: { posting: { ...p, previews: out.previews } }, removePaths: out.removePaths, removeDrive: out.removeDrive, finalize: kept?.drive ? { versionId: keepId, files: kept.drive, code: p.client?.code || "" } : null };
}

// The post is up: old Storage copies go; in the client's Drive the posted
// cut stays (it's their file), every other cut goes.
export function applyClean(c) {
  const p = c.posting || {};
  const keepId = p.finalId || p.client?.versionId || "";
  const out = keepOnly(p.previews, keepId);
  const kept = out.previews[keepId];
  const previews = kept?.drive ? { [keepId]: { drive: kept.drive, ...(kept.poster ? { poster: kept.poster } : {}), kind: kept.kind, at: kept.at } } : {};
  return { patch: { posting: { ...p, previews } }, removePaths: [...out.removePaths, ...pathsOf(kept)], removeDrive: out.removeDrive };
}

// Remembering the piece's folder in the client's Drive. A piece with no cut
// yet has no `posting`; a bare "posting.clientFolder" would make one holding
// only the folder, with no versions or notes (2026-11-10: footage started on
// QKC-30 and the owner's Create page stopped loading).
export const clientFolderPatch = (c, folderId) => (c?.posting
  ? { "posting.clientFolder": folderId }
  : { posting: { versions: [], notes: [], clientFolder: folderId } });

// The checks every owner action shares: the piece is the caller's own.
export function ownPiece(c, uid) {
  if (!c) throw fail(404, "content");
  if (c.ownerId !== uid) throw fail(403, "owner");
  return c;
}

// A client acting on a piece: they're on its brand as "Klien" or as an
// editor (owner, 2026-11-10: "editor bisa lihat antrean video juga … kaya
// client, bedanya editor bisa edit brand dna dll"; a seat paused over the
// team's limit reads like a viewer, so not that), their access is on, and
// the brand is Wepeka's (Video & posting is private).
export const reviewsCuts = (m) => !!m && !m.disabled && (!!m.klien || (m.role === "editor" && !m.seatPaused));
export function clientOn(brand, uid, isAdminUid) {
  const m = brand?.members?.[uid];
  if (!brand || !reviewsCuts(m) || !isAdminUid(brand.ownerId)) throw fail(403, "not-client");
  return m;
}

// Whose Drive receives a brand's cuts: the client who connected theirs,
// while they're still a client there.
export function clientDriveOf(brand) {
  const cd = brand?.clientDrive;
  const m = cd?.uid ? brand.members?.[cd.uid] : null;
  return m?.klien && !m.disabled ? cd : null;
}
