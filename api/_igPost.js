// Posting to Instagram from Brandlab (owner, 2026-11-02: "bisa upload dari
// brandlab ke akunku aja … jadi aku tinggal click2 dari brandlab"). Admin
// only, like the rest of Video & posting.
//
// The approved cut lives on the Mac (js/outbox.js), and Instagram only takes
// a URL it can fetch. So "Jadwalkan" / "Posting sekarang" copies the cut from
// the owner's browser to Cloud Storage (igpost/<owner>/<piece>/…, resumable
// upload URL from the server, as api/_review.js does), and a job waits in
// igJobs/{contentId} (server only, no rules match). The minute cron
// (api/cron/ig-post.js) — or the request itself when it's "now" — walks it:
//   waiting → children (carousel items) → container → publishing → done | failed
// Instagram has no scheduling of its own: a container is made at the hour,
// published once Instagram says FINISHED, then the copies are deleted and the
// piece gets its permalink. Graph calls go through an injected `graph` so the
// tests (and the preview harness) never reach Instagram.
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ").trim().slice(0, n);
const safeName = (s) => clean(s, 80).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "file";

export const MAX_FILE = 300 * 1048576; // Reels: 300 MB
export const SIGNED_FOR = 24 * 3600 * 1000; // a container may wait up to a day
export const GRAPH = "https://graph.instagram.com/v23.0";
export const STUCK_MS = 30 * 60 * 1000; // Instagram still "IN_PROGRESS" after this = give up
export const EARLY_MS = 5 * 60 * 1000; // the container is made this early, so the post goes up on the minute
export const FB_GRAPH = "https://graph.facebook.com/v23.0";
export const FB_VIDEO = "https://graph-video.facebook.com/v23.0"; // video uploads go to this host

export function fail(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

export const prefixOf = (uid, contentId) => `igpost/${uid}/${contentId}/`;

// Where each file goes: the cut first (video or slides in order), then the
// cover when it's a reel with one picked.
export function uploadPaths(uid, contentId, files) {
  if (!Array.isArray(files) || !files.length || files.length > 21) throw fail(400, "files");
  return files.map((f, i) => {
    if (!(Number(f?.size) > 0) || Number(f.size) > MAX_FILE) throw fail(400, "size");
    const type = String(f.type || "");
    if (!/^(video\/(mp4|quicktime)|image\/jpeg)$/.test(type)) throw fail(400, "type");
    return { path: `${prefixOf(uid, contentId)}${Date.now().toString(36)}-${String(i + 1).padStart(2, "0")}-${safeName(f.name)}`, type };
  });
}

// The Instagram account a brand posts to: its own connection, or — for a
// brand made later for the same account (winkhsin's pieces, while the
// connection sits on the older "wepeka" brand) — the owner's brand whose
// connected username is this brand's name or handle.
export function accountFor(brands, brandId) {
  const own = brands.find((b) => b.id === brandId);
  if (!own) return null;
  const ok = (b) => (b?.instagram?.accessToken && /^\d{5,}$/.test(String(b.instagram.igUserId || "")) ? { igUserId: String(b.instagram.igUserId), token: b.instagram.accessToken, username: String(b.instagram.username || "").replace(/^@/, ""), brandId: b.id } : null);
  if (ok(own)) return ok(own);
  const names = [own.name, own.instagram?.username].map((x) => String(x || "").replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
  const other = brands.find((b) => b.id !== brandId && b.ownerId === own.ownerId && ok(b) && names.includes(String(b.instagram.username || "").replace(/^@/, "").toLowerCase()));
  return ok(other);
}

// The Facebook Page a brand's posts are also shared to (owner, 2026-11-07:
// "tiap aku upload via brandlab … link ke facebook juga"). Instagram's API
// has no "share to Facebook" switch for posts made through it, so Brandlab
// posts the same cut to the Page itself, with the Page token saved in the
// brand's settings (Halaman Facebook). Its own, or — like accountFor — the
// owner's brand that holds the same Instagram (the "wepeka" brand holds
// @winkhsin and its Page).
const handleOf = (x) => String(x || "").replace(/^@/, "").trim().toLowerCase();
export function facebookFor(brands, brandId, account = null) {
  const own = brands.find((b) => b.id === brandId);
  if (!own) return null;
  const ok = (b) => (b?.facebook?.pageAccessToken && /^\d{5,}$/.test(String(b.facebook.pageId || "")) ? { pageId: String(b.facebook.pageId), token: b.facebook.pageAccessToken, name: clean(b.facebook.pageName, 80), brandId: b.id } : null);
  if (ok(own)) return ok(own);
  const names = [own.name, own.instagram?.username, account?.username].map(handleOf).filter(Boolean);
  const other = brands.find((b) => b.id !== brandId && b.ownerId === own.ownerId && ok(b) && names.includes(handleOf(b.instagram?.username)));
  return ok(other);
}

// "2026-11-03" + "19:00" in WIB → epoch ms.
export function atOf(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return NaN;
  const hhmm = /^\d{2}:\d{2}$/.test(String(time || "")) ? time : "19:00";
  return Date.parse(`${date}T${hhmm}:00+07:00`);
}
export const wibDate = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

// The job written when the owner schedules (or posts now).
export function newJob(c, { uid, paths, cover, kind, at, facebook = false, now = Date.now() }) {
  const want = prefixOf(uid, c.id);
  const okPath = (x) => typeof x === "string" && x.startsWith(want) && !x.includes("..");
  if (!Array.isArray(paths) || !paths.length || !paths.every(okPath)) throw fail(400, "paths");
  if (cover && !okPath(cover)) throw fail(400, "paths");
  const p = c.posting || {};
  if (p.ig?.state === "published" || c.status === "published") throw fail(409, "posted");
  const type = ["reels", "carousel", "foto", "story"].includes(p.type) ? p.type : "reels";
  const k = ["video", "set", "image"].includes(kind) ? kind : "video";
  if (type === "carousel" && (k !== "set" || paths.length < 2)) throw fail(400, "slides");
  if (!(at > 0)) throw fail(400, "at");
  return {
    ownerId: uid, brandId: c.brandId, contentId: c.id, type, kind: k, paths, cover: cover || "",
    trial: !!p.trialReel && type === "reels", at: Math.max(at, now), state: "waiting",
    children: [], creation: "", mediaId: "", permalink: "", error: "", createdAt: now, updatedAt: now, tries: 0,
    fb: facebook ? { state: "waiting" } : null,
  };
}

// Only to the Facebook Page, for a piece already on Instagram ("Bagikan ke
// Facebook" after the fact, or again after Facebook refused it).
export function facebookJob(c, { uid, paths, cover, kind, now = Date.now() }) {
  const job = newJob({ ...c, status: "editing", posting: { ...(c.posting || {}), ig: null } }, { uid, paths, cover, kind, at: now, facebook: true, now });
  return { ...job, state: "facebook", fbOnly: true, trial: false };
}

const isVideoPath = (x) => /\.(mp4|mov)$/i.test(x);

// The parameters of each container Instagram needs for this job.
export function containerParams(job, { urls, coverUrl = "", caption = "" }) {
  const cap = clean(caption, 2200);
  if (job.type === "carousel") {
    return {
      children: job.paths.map((x, i) => (isVideoPath(x) ? { media_type: "VIDEO", video_url: urls[i], is_carousel_item: "true" } : { image_url: urls[i], is_carousel_item: "true" })),
      parent: (ids) => ({ media_type: "CAROUSEL", children: ids.join(","), caption: cap }),
    };
  }
  const first = job.paths[0];
  if (job.type === "story") return { single: isVideoPath(first) ? { media_type: "STORIES", video_url: urls[0] } : { media_type: "STORIES", image_url: urls[0] } };
  if (job.type === "foto" || !isVideoPath(first)) return { single: { image_url: urls[0], caption: cap } };
  return {
    single: {
      media_type: "REELS", video_url: urls[0], caption: cap, share_to_feed: "true",
      ...(coverUrl ? { cover_url: coverUrl } : {}),
      // Trial reels go to non-followers first; Instagram shares it with followers if it does well (the app's default).
      ...(job.trial ? { trial_params: JSON.stringify({ graduation_strategy: "SS_PERFORMANCE" }) } : {}),
    },
  };
}

// Instagram's answer in a short line for the piece ("Instagram menolak …").
export function igError(e) {
  const m = e?.ig?.error_user_msg || e?.ig?.message || e?.message || "error";
  return clean(m, 300);
}

// One move of a job. `graph(method, path, params)` → JSON (throws with .ig on
// an Instagram error); `sign(path)` → a URL Instagram can fetch; `caption` is
// the piece's caption NOW (edits after scheduling count). Returns the job's
// new fields and, when it ends, what to write on the piece.
export async function step(job, { graph, sign, caption, account, fbGraph = null, page = null, now = Date.now() }) {
  const upd = (o) => ({ ...o, updatedAt: now });
  const failed = (error) => ({ job: upd({ state: "failed", error }), piece: { ig: { state: "failed", error, at: new Date(job.at).toISOString(), auto: true } } });
  if (job.state === "facebook") return fbStep(job, { fbGraph, sign, caption, page, now });
  if (!account) return failed("Instagram brand ini belum terhubung.");
  const ig = account.igUserId;
  const finish = async (mediaId) => {
    let permalink = "";
    try { permalink = String((await graph("GET", `/${mediaId}`, { fields: "permalink" })).permalink || ""); } catch { /* the post is up; the link can be added later */ }
    const piece = { ig: { state: "published", mediaId, permalink, postedAt: now, auto: true }, publishedDate: wibDate(now), permalink };
    // The Facebook Page next: the copies stay until Facebook has fetched them.
    if (job.fb?.state === "waiting") return { job: upd({ state: "facebook", mediaId, permalink }), piece: { ...piece, fb: { state: "waiting", page: page?.name || "" } } };
    return { job: upd({ state: "done", mediaId, permalink }), piece, removePaths: [...job.paths, ...(job.cover ? [job.cover] : [])] };
  };
  try {
    if (job.state === "waiting") {
      if (job.at - EARLY_MS > now) return { job: null };
      const urls = await Promise.all(job.paths.map(sign));
      const coverUrl = job.cover ? await sign(job.cover) : "";
      const plan = containerParams(job, { urls, coverUrl, caption });
      if (plan.children) {
        const ids = [];
        for (const params of plan.children) ids.push(String((await graph("POST", `/${ig}/media`, params)).id));
        return { job: upd({ state: "children", children: ids, tries: (job.tries || 0) + 1 }) };
      }
      const { id } = await graph("POST", `/${ig}/media`, plan.single);
      return { job: upd({ state: "container", creation: String(id), containerAt: now }) };
    }
    if (job.state === "children") {
      const sts = await Promise.all(job.children.map((id) => graph("GET", `/${id}`, { fields: "status_code,status" })));
      const bad = sts.find((s) => s.status_code === "ERROR" || s.status_code === "EXPIRED");
      if (bad) return failed(clean(bad.status || "Instagram menolak salah satu slide.", 300));
      if (sts.some((s) => s.status_code !== "FINISHED")) return now - job.updatedAt > STUCK_MS ? failed("Instagram terlalu lama memproses slide.") : { job: null };
      const plan = containerParams(job, { urls: [], caption });
      const { id } = await graph("POST", `/${ig}/media`, plan.parent(job.children));
      return { job: upd({ state: "container", creation: String(id), containerAt: now }) };
    }
    if (job.state === "container" || job.state === "publishing") {
      const s = await graph("GET", `/${job.creation}`, { fields: "status_code,status" });
      if (s.status_code === "PUBLISHED") {
        // Published by an earlier run that didn't get to write it down.
        const { data = [] } = await graph("GET", `/${ig}/media`, { fields: "id", limit: "1" });
        return data[0]?.id ? finish(String(data[0].id)) : failed("Sudah tayang, tapi link-nya tidak terbaca.");
      }
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") return failed(clean(s.status || `Instagram: ${s.status_code}`, 300));
      if (s.status_code !== "FINISHED") return now - (job.containerAt || job.updatedAt) > STUCK_MS ? failed("Instagram terlalu lama memproses video.") : { job: null };
      if (job.at > now) return { job: null }; // ready early: wait for the hour
      if (job.state === "publishing" && now - job.updatedAt < 2 * 60 * 1000) return { job: null }; // another run is on it
      return { job: upd({ state: "publishing" }), next: async () => finish(String((await graph("POST", `/${ig}/media_publish`, { creation_id: job.creation })).id)) };
    }
    return { job: null };
  } catch (e) {
    return failed(igError(e));
  }
}

// What goes to the Page for each kind of post: a video (Facebook shows a
// vertical one as a reel), a photo, or the photos of a carousel as one post.
// Stories, and carousels made of videos only, stay on Instagram.
export function facebookPlan(job, { urls, coverUrl = "", caption = "" }) {
  const cap = clean(caption, 5000);
  if (job.type === "story") return { skip: "Story tidak ikut ke Facebook." };
  if (job.type === "carousel") {
    const photos = job.paths.map((x, i) => (isVideoPath(x) ? "" : urls[i])).filter(Boolean);
    if (!photos.length) return { skip: "Carousel video belum bisa ke Facebook." };
    return { photos, message: cap };
  }
  if (job.type === "foto" || !isVideoPath(job.paths[0])) return { photo: { url: urls[0], caption: cap } };
  return { video: { file_url: urls[0], description: cap, published: "true" }, thumbUrl: coverUrl };
}

const fbLink = (x) => (!x ? "" : /^https?:/.test(x) ? x : `https://www.facebook.com${x.startsWith("/") ? "" : "/"}${x}`);

// One move on the Facebook side. Never touches the Instagram result: a
// refusal here only shows on the piece as Facebook's own words.
async function fbStep(job, { fbGraph, sign, caption, page, now }) {
  const upd = (o) => ({ ...o, updatedAt: now });
  const files = [...job.paths, ...(job.cover ? [job.cover] : [])];
  const end = (fb) => ({ job: upd({ state: "done", fb }), piece: { fb: { ...fb, page: page?.name || "", at: now } }, removePaths: files });
  const fb = job.fb || {};
  try {
    if (!page || !fbGraph) return end({ state: "failed", error: "Halaman Facebook brand ini belum terhubung." });
    if (fb.state !== "sent") {
      const urls = await Promise.all(job.paths.map(sign));
      const coverUrl = job.cover ? await sign(job.cover) : "";
      const plan = facebookPlan(job, { urls, coverUrl, caption });
      if (plan.skip) return end({ state: "skipped", error: plan.skip });
      if (plan.photo) {
        const r = await fbGraph("POST", `/${page.pageId}/photos`, plan.photo);
        return end({ state: "done", id: String(r.post_id || r.id || ""), permalink: fbLink(r.post_id ? `/${r.post_id}` : "") });
      }
      if (plan.photos) {
        const ids = [];
        for (const url of plan.photos) ids.push(String((await fbGraph("POST", `/${page.pageId}/photos`, { url, published: "false" })).id));
        const r = await fbGraph("POST", `/${page.pageId}/feed`, { message: plan.message, attached_media: JSON.stringify(ids.map((media_fbid) => ({ media_fbid }))) });
        return end({ state: "done", id: String(r.id || ""), permalink: fbLink(r.id ? `/${r.id}` : "") });
      }
      let r;
      try {
        r = await fbGraph("POST", `/${page.pageId}/videos`, plan.video, { video: true, thumbUrl: plan.thumbUrl });
      } catch (e) {
        if (!plan.thumbUrl) throw e;
        r = await fbGraph("POST", `/${page.pageId}/videos`, plan.video, { video: true }); // the cover was the trouble: let Facebook pick a frame
      }
      return { job: upd({ fb: { state: "sent", id: String(r.id || ""), sentAt: now } }) };
    }
    // Facebook fetches the video from the copy, then processes it.
    const v = await fbGraph("GET", `/${fb.id}`, { fields: "status,permalink_url" });
    const st = v.status || {};
    if (st.video_status === "error") return end({ state: "failed", id: fb.id, error: clean(st.processing_phase?.errors?.[0]?.message || st.uploading_phase?.errors?.[0]?.message || "Facebook gagal memproses video.", 300) });
    if (st.video_status === "ready") return end({ state: "done", id: fb.id, permalink: fbLink(v.permalink_url) });
    if (now - (fb.sentAt || job.updatedAt) > STUCK_MS) return end({ state: "done", id: fb.id, permalink: fbLink(v.permalink_url), slow: true }); // still processing on Facebook's side; it finishes by itself
    return { job: null };
  } catch (e) {
    return end({ state: "failed", id: fb.id || "", error: igError(e) });
  }
}

// The Graph API for the Page: same shape as graphClient. A video carries its
// cover as raw bytes (multipart "thumb"), fetched from the copy's URL.
export function fbClient(token, fetchImpl = globalThis.fetch) {
  return async (method, path, params = {}, { video = false, thumbUrl = "" } = {}) => {
    const base = video ? FB_VIDEO : FB_GRAPH;
    let res;
    if (method === "GET") {
      res = await fetchImpl(`${base}${path}?${new URLSearchParams({ ...params, access_token: token })}`);
    } else if (thumbUrl) {
      const img = await fetchImpl(thumbUrl);
      if (!img.ok) throw Object.assign(new Error("cover"), { ig: { message: "Cover tidak terbaca." } });
      const form = new FormData();
      for (const [k, v] of Object.entries({ ...params, access_token: token })) form.append(k, v);
      form.append("thumb", new Blob([await img.arrayBuffer()], { type: "image/jpeg" }), "cover.jpg");
      res = await fetchImpl(`${base}${path}`, { method, body: form });
    } else {
      res = await fetchImpl(`${base}${path}`, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, access_token: token }) });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const e = new Error(json.error?.message || `facebook ${res.status}`);
      e.ig = json.error || {};
      throw e;
    }
    return json;
  };
}

// The piece's posting.ig while the job waits.
export const scheduledIg = (job) => ({ state: "scheduled", at: new Date(job.at).toISOString(), auto: true });

// Instagram's Graph API over fetch: form-encoded POST, query GET, the token
// as access_token. An error answer throws with Instagram's own message.
export function graphClient(token, fetchImpl = globalThis.fetch) {
  return async (method, path, params = {}) => {
    const body = new URLSearchParams({ ...params, access_token: token });
    const res = method === "GET"
      ? await fetchImpl(`${GRAPH}${path}?${body}`)
      : await fetchImpl(`${GRAPH}${path}`, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const e = new Error(json.error?.message || `instagram ${res.status}`);
      e.ig = json.error || {};
      throw e;
    }
    return json;
  };
}
