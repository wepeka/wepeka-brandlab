// "Kirim ke klien" (owner, 2026-11-02; Brandlab clients + their own Drive
// since 2026-11-09: "aku mau quatro buka lewat brandlab … datanya disimpan
// di google drive mereka"): a cut from the Mac folder goes into the brand
// client's own Google Drive — copied straight from this browser, the server
// only opens the folder and hands a short-lived key for it — and recorded on
// the piece (api/_review.js). The client, signed in to Brandlab as "Klien",
// notes or approves it through clientDecide; when a cut is approved the
// older ones are deleted from their Drive.
import { auth } from "./firebase.js";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

async function call(action, body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/review/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken || ""}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || "server");
    e.code = json.error || "server";
    e.status = res.status;
    throw e;
  }
  return json;
}

const typeOf = (f) => f.type || (/\.(mov|qt)$/i.test(f.name) ? "video/quicktime" : /\.png$/i.test(f.name) ? "image/png" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : "video/mp4");

// One file into the client's Drive: open a resumable session with the key,
// then send it in one request whose progress the browser reports.
async function driveUpload(file, { accessToken, folderId, name, onProgress }) {
  const type = typeOf(file);
  const init = await fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-upload-content-type": type, "x-upload-content-length": String(file.size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: type }),
  });
  const session = init.ok && init.headers.get("location");
  if (!session) throw Object.assign(new Error("drive"), { code: init.status === 403 ? "drive-full" : "drive", status: init.status });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", session);
    xhr.setRequestHeader("content-type", type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let id = "";
      try { id = JSON.parse(xhr.responseText).id; } catch { /* below */ }
      if (xhr.status >= 200 && xhr.status < 300 && id) resolve(id);
      else reject(Object.assign(new Error("drive"), { code: "drive", status: xhr.status }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("network"), { code: "network" }));
    xhr.send(file);
  });
}

// files: File[] of one cut (a video, or a carousel's slides in order);
// poster: a small JPEG Blob for the client's gallery (optional).
export async function sendToClient({ contentId, versionId, kind, code, files, poster, onProgress }) {
  const slot = await call("upload", { contentId, versionId, code, files: files.map((f) => ({ name: f.name, type: typeOf(f), size: f.size })) });
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  const ids = [];
  for (let i = 0; i < files.length; i++) {
    ids.push(await driveUpload(files[i], { ...slot, name: slot.names[i], onProgress: (f) => onProgress?.((done + f * files[i].size) / total) }));
    done += files[i].size;
  }
  let posterId = "";
  if (poster?.size) {
    try { posterId = await driveUpload(new File([poster], "sampul.jpg", { type: "image/jpeg" }), { ...slot, name: slot.poster }); } catch { /* the tile shows the title instead */ }
  }
  await call("send", { contentId, versionId, kind, code, drive: ids, poster: posterId });
}

// The post is up: the Instagram link shows on the client page.
export const cleanPreviews = (contentId) => call("clean", { contentId });
// Wepeka approved a cut here: older cuts leave the client's Drive too.
export const keepFinalOnly = (contentId) => call("keep", { contentId });
// The client's own answer on the cut sent to them: approve, or a note
// ({ t: second or null for the whole video, text }).
export const clientDecide = ({ contentId, versionId, verdict, note }) => call("decide", { contentId, versionId, verdict, note });
