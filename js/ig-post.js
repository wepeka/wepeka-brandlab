// Posting to Instagram from Brandlab (owner, 2026-11-02: "jadi aku tinggal
// click2 dari brandlab"): the approved cut is copied from this browser to
// Cloud Storage through upload URLs the server opens, then the server posts
// it at the hour (or right away) and writes the Instagram link back on the
// piece. See api/_igPost.js.
import { auth } from "./firebase.js";

async function call(body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/instagram/post", {
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

const typeOf = (f) => (/\.(mov|qt)$/i.test(f.name) ? "video/quicktime" : /\.(jpe?g)$/i.test(f.name) ? "image/jpeg" : /\.png$/i.test(f.name) ? "image/png" : f.type || "video/mp4");

// files: the cut (a video, or the slides in order); cover: the picked cover
// image for a reel, or null. Copied to Storage; returns their paths.
async function upload({ contentId, files, cover, onProgress }) {
  const all = [...files, ...(cover ? [cover] : [])];
  const { files: slots } = await call({ action: "upload", contentId, files: all.map((f) => ({ name: f.name, type: typeOf(f), size: f.size })) });
  const total = all.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  for (let i = 0; i < all.length; i++) {
    await put(slots[i].uploadUrl, all[i], (f) => onProgress?.((done + f * all[i].size) / total));
    done += all[i].size;
  }
  const paths = slots.map((s) => s.path);
  return { paths: cover ? paths.slice(0, -1) : paths, cover: cover ? paths[paths.length - 1] : "" };
}

// at: epoch ms (now = post right away). facebook: also share to the brand's
// Facebook Page once it's on Instagram.
export async function postToInstagram({ contentId, kind, files, cover, at, facebook = false, onProgress }) {
  const up = await upload({ contentId, files, cover, onProgress });
  return call({ action: "schedule", contentId, kind, at, facebook: !!facebook, ...up });
}

// A piece already on Instagram, to the Facebook Page only.
export async function shareToFacebook({ contentId, kind, files, cover, onProgress }) {
  const up = await upload({ contentId, files, cover, onProgress });
  return call({ action: "facebook", contentId, kind, ...up });
}

export const cancelInstagramPost = (contentId) => call({ action: "cancel", contentId });
