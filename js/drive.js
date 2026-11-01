// Google Drive, browser side (Video & posting, js/posting.js). The video
// goes straight from this browser into the person's own Drive — it never
// passes through a Brandlab server — and is read back from there to play.
// Access tokens come from /api/drive/token (api/_drive.js keeps the long-
// lived one); they last an hour and are kept in memory only.
import { auth } from "./firebase.js";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export class DriveClientError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

let token = null; // { value, exp, email }

async function call(action, body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/drive/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken || ""}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new DriveClientError(json.error || "server", res.status);
  return json;
}

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const r = await call("token");
  token = { value: r.accessToken, exp: Date.now() + (r.expiresIn || 3600) * 1000, email: r.email || "" };
  return token.value;
}

// { connected, email } — or { connected: false, reason } ("not-connected",
// "setup" when the server has no Google keys yet, "reconnect").
export async function driveStatus() {
  try {
    await accessToken();
    return { connected: true, email: token.email };
  } catch (e) {
    token = null;
    return { connected: false, reason: e.code || "server" };
  }
}

// Off to Google's consent screen; Google sends the person back to `ret`.
export async function connectDrive(ret) {
  const { url } = await call("start", { ret });
  location.assign(url);
}

export async function disconnectDrive() {
  token = null;
  await call("disconnect");
}

async function drive(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401) token = null;
  if (!res.ok) throw new DriveClientError("drive", res.status);
  return res;
}

const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// One folder level: found by name under its parent (drive.file only lists
// what Brandlab made), or made. Remembered per tab; a folder someone deleted
// in Drive is simply made again on the next upload.
const folderIds = new Map();
async function folder(name, parent) {
  const key = `${parent || "root"}/${name}`;
  if (folderIds.has(key)) return folderIds.get(key);
  const query = `mimeType='${FOLDER}' and name='${q(name)}' and trashed=false and '${parent || "root"}' in parents`;
  const found = await (await drive(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&spaces=drive`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await (await drive(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent || "root"] }),
    })).json();
    id = made.id;
  }
  folderIds.set(key, id);
  return id;
}

export async function ensureFolders(path) {
  let parent = null;
  for (const name of path) parent = await folder(name, parent);
  return parent;
}

// Resumable upload: open a session, then send the file in one request whose
// progress the browser reports (fetch can't report upload progress yet).
export async function uploadToDrive(file, { name, folderId, onProgress }) {
  const init = await drive(`${UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-content-type": file.type || "video/mp4", "x-upload-content-length": String(file.size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: file.type || "video/mp4" }),
  });
  const session = init.headers.get("location");
  if (!session) throw new DriveClientError("session");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", session);
    xhr.setRequestHeader("content-type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new DriveClientError("drive", xhr.status)); }
      } else reject(new DriveClientError("drive", xhr.status));
    };
    xhr.onerror = () => reject(new DriveClientError("network"));
    xhr.send(file);
  });
}

// The whole file, for playing in the drawer (a <video> can't send the
// Authorization header Drive needs). Kept for the tab's life, last few only.
const blobs = new Map();
export async function driveVideoURL(fileId, { onProgress } = {}) {
  if (blobs.has(fileId)) return blobs.get(fileId);
  const res = await drive(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  const total = Number(res.headers.get("content-length")) || 0;
  let blob;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(got / total);
    }
    blob = new Blob(parts, { type: res.headers.get("content-type") || "video/mp4" });
  } else {
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  blobs.set(fileId, url);
  while (blobs.size > 6) {
    const [oldest, old] = blobs.entries().next().value;
    URL.revokeObjectURL(old);
    blobs.delete(oldest);
  }
  return url;
}

export async function renameDriveFile(fileId, name) {
  await drive(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
