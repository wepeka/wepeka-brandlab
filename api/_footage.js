// Raw footage from the shoot (owner, 2026-11-09: "clientku ini nanti di fase
// syuting ada suruh upload videonya nanti auto nyambung ke drive mereka …
// jadi otomatis ke grouping kan? nanti kamu tinggal buka drivenya di folder
// apa bisa langsung kamu edit").
//
// Wepeka writes the concept and edits; the client's crew shoots. On the
// Syuting step the crew (the brand's "Klien", or a Kerja Tim editor) picks
// the clips and they go straight from their browser into the CLIENT's own
// Google Drive (the one connected for the cuts, api/_clientDrive.js), one
// folder per piece:
//   Wepeka Brandlab / <brand> / <code · title> / Footage / IMG_0412.MOV
// The piece remembers what arrived:
//   footage { folderId, files: [{ id, name, size, type, at, by, who }] }
// (its own field, not inside `posting`, so the owner's browser writing
// `posting` can never drop a clip the server just recorded). Wepeka's Mac
// copies every clip into the piece's Outbox folder by itself
// (js/footage.js), where the edit starts.
//
// Plain functions, so the preview harness runs these same ones.
import { fail } from "./_review.js";
import { driveName } from "./_clientDrive.js";

export const FOOTAGE_FOLDER = "Footage";
export const MAX_CLIP = 20 * 1024 ** 3; // a long 4K take from a phone
export const MAX_BATCH = 50;
export const MAX_CLIPS = 300; // per piece
const MEDIA_RE = /\.(mov|mp4|m4v|mts|m2ts|avi|mkv|webm|3gp|hevc|heic|heif|jpe?g|png|webp|dng|wav|mp3|m4a|aac|aif|aiff|flac)$/i;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n);

// Who may add clips to a piece: Wepeka itself, or someone on the brand as
// "Klien" or editor (a paused seat reads like a viewer, so not that), on a
// brand of Wepeka's. A plain viewer only reads.
export function footageMember(brand, uid, isAdminUid) {
  if (!brand || !isAdminUid(brand.ownerId)) throw fail(403, "not-team");
  if (uid === brand.ownerId) return { name: "Wepeka", owner: true };
  const m = brand.members?.[uid];
  if (!m || m.disabled || !(m.klien || (m.role === "editor" && !m.seatPaused))) throw fail(403, "not-team");
  return m;
}

// The clips as the browser describes them before sending: video, photo or
// sound (a lavalier's own recorder), not too many, not too big.
export function checkClips(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_BATCH) throw fail(400, "files");
  for (const f of files) {
    const size = Number(f?.size);
    if (!(size > 0) || size > MAX_CLIP) throw fail(400, "size");
    const type = String(f.type || "");
    if (!(/^(video|image|audio)\//.test(type) || (!type && MEDIA_RE.test(String(f.name || ""))))) throw fail(400, "type");
  }
  return files;
}

// Names in the Drive folder: the camera's own (IMG_0412.MOV), so the crew
// recognises them; one already there gets " (2)", " (3)" …
export function clipNames(files, taken = []) {
  const used = new Set(taken.map((n) => String(n).toLowerCase()));
  return checkClips(files).map((f) => {
    const name = driveName(f.name || "Footage", 120);
    const m = /^(.*?)(\.[A-Za-z0-9]{2,5})?$/.exec(name);
    let out = name;
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${m[1]} (${i})${m[2] || ""}`;
    used.add(out.toLowerCase());
    return out;
  });
}

const footageOf = (c) => ({ folderId: c?.footage?.folderId || "", files: Array.isArray(c?.footage?.files) ? c.footage.files : [] });

// Clips that are really in the piece's Footage folder (checkFiles) join
// the list; one already listed is left as it was.
export function applyFootageAdd(c, { files, folderId, by, who, now = Date.now() }) {
  if (!c) throw fail(404, "content");
  const cur = footageOf(c);
  const have = new Set(cur.files.map((f) => f.id));
  const fresh = files.filter((f) => !have.has(f.id)).map((f) => ({ id: f.id, name: clean(f.name, 120), size: Number(f.size) || 0, type: clean(f.type, 60), at: now, by: clean(by, 128), who: clean(who, 60) }));
  if (cur.files.length + fresh.length > MAX_CLIPS) throw fail(400, "full");
  return { patch: { footage: { folderId: folderId || cur.folderId, files: [...cur.files, ...fresh] } }, added: fresh };
}

// One clip taken back (the wrong take): out of the list, and out of the
// client's Drive. The copy on Wepeka's Mac, if it got there, stays.
export function applyFootageRemove(c, id) {
  if (!c) throw fail(404, "content");
  const cur = footageOf(c);
  if (!cur.files.some((f) => f.id === id)) throw fail(404, "clip");
  return { patch: { footage: { ...cur, files: cur.files.filter((f) => f.id !== id) } }, removeDrive: [id] };
}
