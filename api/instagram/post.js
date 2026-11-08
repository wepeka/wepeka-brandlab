// POST /api/instagram/post { action: upload | schedule | facebook | cancel, contentId, … }
// The owner's side of posting to Instagram from Brandlab (api/_igPost.js),
// and to the brand's Facebook Page with it ("facebook": true, or the
// "facebook" action for a piece already on Instagram).
// Admin only, and only the caller's own pieces.
import { adminDb, adminBucket, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { ownPiece } from "../_review.js";
import { uploadPaths, newJob, facebookJob, scheduledIg, accountFor, facebookFor, fail } from "../_igPost.js";
import { runJob, LIVE } from "../_igPostRun.js";

const ORIGINS = /^https:\/\/(brandlab\.wepeka\.com|[a-z0-9-]+\.vercel\.app)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

async function act(req, db, uid) {
  const b = req.body || {};
  const contentId = String(b.contentId || "");
  const ref = db.collection("content").doc(contentId);
  const snap = await ref.get();
  const c = ownPiece(snap.exists ? { id: contentId, ...snap.data() } : null, uid);
  const bucket = await adminBucket();
  const jobRef = db.collection("igJobs").doc(contentId);

  if (b.action === "upload") {
    const origin = ORIGINS.test(req.headers.origin || "") ? req.headers.origin : undefined;
    const files = await Promise.all(uploadPaths(uid, contentId, b.files).map(async ({ path, type }) => {
      const [uploadUrl] = await bucket.file(path).createResumableUpload({ origin, metadata: { contentType: type } });
      return { path, uploadUrl };
    }));
    return { files };
  }

  if (b.action === "schedule" || b.action === "facebook") {
    const brands = (await db.collection("brands").where("ownerId", "==", uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const account = accountFor(brands, c.brandId);
    const page = facebookFor(brands, c.brandId, account);
    const fbOnly = b.action === "facebook";
    if (fbOnly ? !page : !account) throw fail(409, fbOnly ? "page" : "account");
    const paths = [...(Array.isArray(b.paths) ? b.paths : []), ...(b.cover ? [b.cover] : [])];
    for (const p of paths) {
      const [exists] = await bucket.file(String(p)).exists();
      if (!exists) throw fail(400, "missing");
    }
    const old = await jobRef.get();
    if (old.exists && LIVE.includes(old.data().state) && old.data().state !== "waiting") throw fail(409, "busy"); // already going up
    const job = fbOnly
      ? facebookJob(c, { uid, paths: b.paths, cover: b.cover || "", kind: b.kind })
      : newJob(c, { uid, paths: b.paths, cover: b.cover || "", kind: b.kind, at: Number(b.at) || Date.now(), facebook: !!b.facebook && !!page });
    // A new copy replaces an older scheduled one.
    const stale = old.exists ? [...(old.data().paths || []), old.data().cover].filter((x) => x && !paths.includes(x)) : [];
    await jobRef.set(job);
    const fb = job.fb ? { state: fbOnly ? "waiting" : "scheduled", page: page.name } : null;
    await ref.update(fbOnly
      ? { posting: { ...(c.posting || {}), fb }, updatedAt: Date.now() }
      : { status: "scheduled", posting: { ...(c.posting || {}), ig: scheduledIg(job), fb }, updatedAt: Date.now() });
    await Promise.all(stale.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {})));
    // "Posting sekarang": go as far as this request allows; the cron finishes.
    const state = job.at <= Date.now() + 60 * 1000 ? await runJob(db, bucket, contentId, { budgetMs: 50 * 1000 }) : job.state;
    const after = (await jobRef.get()).data() || {};
    return { state, permalink: after.permalink || "", error: after.error || "", fb: after.fb || null };
  }

  if (b.action === "cancel") {
    const old = await jobRef.get();
    if (old.exists) {
      const j = old.data();
      if (j.state === "publishing") throw fail(409, "busy");
      await jobRef.delete();
      await Promise.all([...(j.paths || []), j.cover].filter(Boolean).map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {})));
    }
    await ref.update({ status: "editing", posting: { ...(c.posting || {}), ig: null, fb: null }, updatedAt: Date.now() });
    return { ok: true };
  }
  throw fail(404, "action");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let user;
  try {
    user = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  if (!isAdminUid(user.uid)) return res.status(403).json({ error: "private" });
  try {
    return res.status(200).json(await act(req, adminDb(), user.uid));
  } catch (err) {
    if (!err.status) console.warn("[ig-post]", req.body?.action, err.message);
    return res.status(err.status || 500).json({ error: err.code || "server" });
  }
}
