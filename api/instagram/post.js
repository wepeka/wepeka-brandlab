// POST /api/instagram/post { action: upload | schedule | facebook | cancel, contentId, … }
// Posting to Instagram from Brandlab (api/_igPost.js), and to the brand's
// Facebook Page with it ("facebook": true, or the "facebook" action for a
// piece already on Instagram).
// Who: Wepeka's account on its own pieces (the cut from the Mac folder, the
// token pasted in the brand — as before), and since 2026-11-24 anyone with
// Posting on the brand (the owner, Admin, Editor & Sosmed — js/permissions.js)
// once the brand is connected through "Hubungkan akun Meta" (the vault).
// The copies sit under the brand OWNER's folder and the job runs as theirs.
import { adminDb, adminBucket, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { can } from "../_permissions.js";
import { accountCanWrite } from "../brands/recount.js";
import { uploadPaths, newJob, facebookJob, scheduledIg, accountFor, facebookFor, fail } from "../_igPost.js";
import { runJob, LIVE } from "../_igPostRun.js";
import { postingAccounts } from "../_metaConnection.js";

const ORIGINS = /^https:\/\/(brandlab\.wepeka\.com|[a-z0-9-]+\.vercel\.app)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// The piece, its brand, and whether this person may post it.
export async function pieceFor(db, uid, contentId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(contentId || ""))) throw fail(400, "content");
  const snap = await db.collection("content").doc(contentId).get();
  if (!snap.exists) throw fail(404, "content");
  const c = { id: contentId, ...snap.data() };
  const bSnap = await db.collection("brands").doc(String(c.brandId || "-")).get();
  const brand = bSnap.exists ? { id: bSnap.id, ...bSnap.data() } : null;
  if (!brand || brand.deletedAt || brand.ownerId !== c.ownerId) throw fail(404, "content");
  // Wepeka's own desk keeps posting its pieces as before; anyone else needs
  // Posting on the brand and the brand's Meta connection.
  const desk = isAdminUid(uid) && c.ownerId === uid;
  if (!desk && !can(brand, uid, "publish", "publish")) throw fail(403, "private");
  if (!desk) {
    const acc = (await db.collection("accounts").doc(brand.ownerId).get()).data?.();
    if (!accountCanWrite(acc, Date.now())) throw fail(403, "inactive");
  }
  return { c, brand, desk };
}

// The account and Page this brand posts to: the vault first, the pasted
// token (Wepeka's own brands) second.
export async function postersOf(db, brand, { env = process.env } = {}) {
  const vault = await postingAccounts({ db, env, fetch: globalThis.fetch }, brand.id);
  if (vault) return { account: vault.account || null, page: vault.page || null };
  if (!isAdminUid(brand.ownerId)) return { account: null, page: null };
  const brands = (await db.collection("brands").where("ownerId", "==", brand.ownerId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const account = accountFor(brands, brand.id);
  return { account, page: facebookFor(brands, brand.id, account) };
}

async function act(req, db, uid) {
  const b = req.body || {};
  const contentId = String(b.contentId || "");
  const ref = db.collection("content").doc(contentId);
  const { c, brand, desk } = await pieceFor(db, uid, contentId);
  const owner = brand.ownerId;
  const bucket = await adminBucket();
  const jobRef = db.collection("igJobs").doc(contentId);

  if (b.action === "upload") {
    // Copies only go up for a brand that can post them (Wepeka's desk, or a
    // brand connected through "Hubungkan akun Meta"): nobody parks files in
    // Storage that no job will ever post and clean up.
    if (!desk) {
      const { account, page } = await postersOf(db, brand);
      if (!account && !page) throw fail(409, "account");
    }
    const origin = ORIGINS.test(req.headers.origin || "") ? req.headers.origin : undefined;
    const files = await Promise.all(uploadPaths(owner, contentId, b.files).map(async ({ path, type }) => {
      const [uploadUrl] = await bucket.file(path).createResumableUpload({ origin, metadata: { contentType: type } });
      return { path, uploadUrl };
    }));
    return { files };
  }

  if (b.action === "schedule" || b.action === "facebook") {
    const { account, page } = await postersOf(db, brand);
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
      ? facebookJob(c, { uid: owner, by: uid, paths: b.paths, cover: b.cover || "", kind: b.kind })
      : newJob(c, { uid: owner, by: uid, paths: b.paths, cover: b.cover || "", kind: b.kind, at: Number(b.at) || Date.now(), facebook: !!b.facebook && !!page });
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
  try {
    return res.status(200).json(await act(req, adminDb(), user.uid));
  } catch (err) {
    if (!err.status) console.warn("[ig-post]", req.body?.action, err.message);
    return res.status(err.status || 500).json({ error: err.code || "server" });
  }
}
