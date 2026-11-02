// "Kirim ke klien" (owner, 2026-11-02): a cut from the Mac folder goes to the
// brand's client review link (api/_review.js). The file is copied straight
// from this browser to Cloud Storage through an upload URL the server opens;
// the server then records it and points the link at it. Copies are deleted
// again once they're not needed (approval, then the post going up).
import { auth } from "./firebase.js";

export const reviewURL = (token) => `${location.origin}/review/${token}`;

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

function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error("upload"), { code: "upload", status: xhr.status })));
    xhr.onerror = () => reject(Object.assign(new Error("network"), { code: "network" }));
    xhr.send(file);
  });
}

// The brand's link (made the first time it's needed).
export async function brandReviewLink(brandId, { rotate = false } = {}) {
  return (await call("link", { brandId, rotate })).token;
}

// files: File[] of one cut (a video, or a carousel's slides in order).
export async function sendToClient({ contentId, versionId, kind, code, files, onProgress }) {
  const { files: slots } = await call("upload", { contentId, versionId, files: files.map((f) => ({ name: f.name, type: f.type || (/\.(mov|qt)$/i.test(f.name) ? "video/quicktime" : /\.(png)$/i.test(f.name) ? "image/png" : /\.(jpe?g)$/i.test(f.name) ? "image/jpeg" : "video/mp4"), size: f.size })) });
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    await put(slots[i].uploadUrl, files[i], (f) => onProgress?.((done + f * files[i].size) / total));
    done += files[i].size;
  }
  await call("send", { contentId, versionId, kind, code, paths: slots.map((s) => s.path) });
}

// The post is up: the copies go, the Instagram link stays.
export const cleanPreviews = (contentId) => call("clean", { contentId });
