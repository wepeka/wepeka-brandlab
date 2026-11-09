// The client's own Google Drive (owner, 2026-11-09: "nanti mereka datanya
// disimpan di google drive mereka jadi gak makan storage brandlab … kalau
// disetujui yang revisian sebelumnya auto kehapus"). A brand's client
// ("Klien" in Kerja Tim) connects their Drive once from their own Brandlab
// (api/_drive.js, driveConnections/{uid}); every cut Wepeka sends lands
// there, in folders Brandlab makes:
//   Wepeka Brandlab / <brand> / <code · title> / <code · Revisi 2>.mp4
// Scope drive.file: Brandlab only ever sees the files and folders it made.
//
// Plain fetch with an access token passed in — no Node imports — so the
// preview harness runs these same functions in the browser.
const API = "https://www.googleapis.com/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
export const ROOT_FOLDER = "Wepeka Brandlab";
export const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

export class ClientDriveError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function call(token, path, init = {}, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}${path}`, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  // 401: the access token died mid-request; 403: the client took Brandlab's
  // access away or their Drive is full. Either way the owner must hear it.
  if (res.status === 401 || res.status === 403) throw new ClientDriveError(409, "drive-off");
  if (!res.ok) throw new ClientDriveError(502, "google");
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
// A folder or file name: one line, no slashes, not too long for a phone.
export const driveName = (s, n = 90) => String(s ?? "").replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n).replace(/[.\s]+$/, "") || "Video";

// One folder: the one remembered (if the client didn't delete it), else the
// one with that name under its parent, else a new one.
export async function ensureFolder(token, { name, parent = "root", known = "" }, fetchImpl = fetch) {
  if (known && FILE_ID_RE.test(known)) {
    const f = await call(token, `/files/${encodeURIComponent(known)}?fields=id,trashed`, {}, fetchImpl);
    if (f && !f.trashed) return known;
  }
  const query = `mimeType='${FOLDER}' and name='${q(name)}' and trashed=false and '${q(parent)}' in parents`;
  const found = await call(token, `/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&spaces=drive`, {}, fetchImpl);
  if (found?.files?.[0]?.id) return found.files[0].id;
  const made = await call(token, "/files?fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) }, fetchImpl);
  if (!made?.id) throw new ClientDriveError(502, "google");
  return made.id;
}

// The piece's folder, and the ids worth remembering for next time.
export async function pieceFolder(token, { brandName, code, title, cache = {} }, fetchImpl = fetch) {
  const rootId = await ensureFolder(token, { name: ROOT_FOLDER, known: cache.rootId }, fetchImpl);
  const brandFolderId = await ensureFolder(token, { name: driveName(brandName, 60), parent: rootId, known: cache.brandFolderId }, fetchImpl);
  const folderId = await ensureFolder(token, { name: driveName([code, title].filter(Boolean).join(" · ")), parent: brandFolderId, known: cache.folderId }, fetchImpl);
  return { rootId, brandFolderId, folderId };
}

// The files the owner's browser says it uploaded: really there, in the
// piece's folder, not in the bin.
export async function checkFiles(token, ids, folderId, fetchImpl = fetch) {
  const out = [];
  for (const id of ids) {
    if (!FILE_ID_RE.test(String(id || ""))) throw new ClientDriveError(400, "files");
    const f = await call(token, `/files/${encodeURIComponent(id)}?fields=id,name,size,mimeType,parents,trashed`, {}, fetchImpl);
    if (!f || f.trashed || !(f.parents || []).includes(folderId)) throw new ClientDriveError(400, "missing");
    out.push({ id: f.id, name: driveName(f.name, 120), size: Number(f.size) || 0, type: String(f.mimeType || "") });
  }
  return out;
}

// Deleted for good (not the bin, which still counts against the client's
// storage). The master files stay in Wepeka's own folder on the Mac. Gone
// already = fine; a file that couldn't go is returned to try again later.
export async function deleteFiles(token, ids, fetchImpl = fetch) {
  const left = [];
  for (const id of new Set(ids)) {
    if (!FILE_ID_RE.test(String(id || ""))) continue;
    try {
      await call(token, `/files/${encodeURIComponent(id)}`, { method: "DELETE" }, fetchImpl);
    } catch (e) {
      left.push(id);
    }
  }
  return left;
}

export async function renameFile(token, id, name, fetchImpl = fetch) {
  if (!FILE_ID_RE.test(String(id || ""))) return;
  await call(token, `/files/${encodeURIComponent(id)}?fields=id`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }, fetchImpl);
}
