// /api/review/{get|decide} — the client's side of a review link, no account
// (the token in the link is the key); {link|upload|send|clean} — Wepeka's
// own side, admin only like the rest of Video & posting. See api/_review.js.
import { adminDb, adminBucket, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { TOKEN_RE, SIGNED_FOR, newToken, uploadPaths, applySend, applyDecision, applyClean, clientView, ownPiece, fail } from "../_review.js";

const ORIGINS = /^https:\/\/(brandlab\.wepeka\.com|[a-z0-9-]+\.vercel\.app)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

async function readLink(db, token) {
  if (!TOKEN_RE.test(String(token || ""))) throw fail(404, "link");
  const snap = await db.collection("reviewLinks").doc(token).get();
  if (!snap.exists || snap.data().revoked) throw fail(404, "link");
  return snap.data();
}

// One piece, read and rewritten in a transaction; copies that are no longer
// needed are deleted after it commits (a failed delete only leaves a file).
async function changePiece(db, id, fn) {
  const ref = db.collection("content").doc(id);
  const removePaths = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const out = fn(snap.exists ? { id, ...snap.data() } : null);
    tx.update(ref, { ...out.patch, updatedAt: Date.now() });
    return out.removePaths || [];
  });
  if (removePaths.length) {
    const bucket = await adminBucket();
    await Promise.all(removePaths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch((e) => console.warn("[review] delete", p, e.message))));
  }
}

async function forClient(action, req, db) {
  if (action === "get") {
    const link = await readLink(db, req.query?.t);
    const brandSnap = await db.collection("brands").doc(link.brandId).get();
    if (!brandSnap.exists) throw fail(404, "link");
    const snap = await db.collection("content").where("brandId", "==", link.brandId).get();
    const contents = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.ownerId === link.ownerId);
    const bucket = await adminBucket();
    const sign = async (path) => (await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + SIGNED_FOR }))[0];
    return clientView({ brand: brandSnap.data(), contents, sign });
  }
  if (action === "decide") {
    if (req.method !== "POST") throw fail(405, "method");
    const b = req.body || {};
    const link = await readLink(db, b.t);
    await changePiece(db, String(b.contentId || ""), (c) => {
      if (!c || c.brandId !== link.brandId || c.ownerId !== link.ownerId) throw fail(404, "content");
      return applyDecision(c, { versionId: String(b.versionId || ""), verdict: b.verdict, note: b.note, name: b.name });
    });
    return { ok: true };
  }
  throw fail(404, "action");
}

async function forOwner(action, req, db, uid) {
  if (req.method !== "POST") throw fail(405, "method");
  const b = req.body || {};
  if (action === "link") {
    const ref = db.collection("brands").doc(String(b.brandId || ""));
    const snap = await ref.get();
    if (!snap.exists || snap.data().ownerId !== uid) throw fail(404, "brand");
    const old = snap.data().clientReview?.token;
    if (old && !b.rotate) return { token: old };
    const token = newToken();
    await db.collection("reviewLinks").doc(token).set({ ownerId: uid, brandId: ref.id, createdAt: Date.now() });
    await ref.update({ clientReview: { token, at: Date.now() } });
    if (old) await db.collection("reviewLinks").doc(old).set({ revoked: true }, { merge: true });
    return { token };
  }
  const contentId = String(b.contentId || "");
  if (action === "upload") {
    const snap = await db.collection("content").doc(contentId).get();
    const c = ownPiece(snap.exists ? { id: contentId, ...snap.data() } : null, uid);
    const versionId = String(b.versionId || "");
    if (!(c.posting?.versions || []).some((v) => v.id === versionId)) throw fail(404, "version");
    const origin = ORIGINS.test(req.headers.origin || "") ? req.headers.origin : undefined;
    const bucket = await adminBucket();
    // Storage not switched on yet (Firebase console → Storage → Get started).
    const [ready] = await bucket.exists().catch(() => [false]);
    if (!ready) throw fail(503, "setup");
    const files = await Promise.all(uploadPaths(uid, contentId, versionId, b.files).map(async ({ path, type }) => {
      const [uploadUrl] = await bucket.file(path).createResumableUpload({ origin, metadata: { contentType: type } });
      return { path, uploadUrl };
    }));
    return { files };
  }
  if (action === "send") {
    const bucket = await adminBucket();
    const paths = Array.isArray(b.paths) ? b.paths : [];
    for (const p of paths) {
      const [exists] = await bucket.file(String(p)).exists();
      if (!exists) throw fail(400, "missing");
    }
    await changePiece(db, contentId, (c) => applySend(ownPiece(c, uid), { uid, versionId: String(b.versionId || ""), paths, kind: b.kind, code: b.code }));
    return { ok: true };
  }
  if (action === "clean") {
    await changePiece(db, contentId, (c) => applyClean(ownPiece(c, uid)));
    return { ok: true };
  }
  throw fail(404, "action");
}

export default async function handler(req, res) {
  const action = String(req.query?.action || "");
  res.setHeader("Cache-Control", "no-store");
  const db = adminDb();
  try {
    if (action === "get" || action === "decide") return res.status(200).json(await forClient(action, req, db));
    let user;
    try {
      user = await requireAuth(req);
    } catch (err) {
      return res.status(err.status || 401).json({ error: "auth" });
    }
    if (!isAdminUid(user.uid)) return res.status(403).json({ error: "private" });
    return res.status(200).json(await forOwner(action, req, db, user.uid));
  } catch (err) {
    if (!err.status) console.warn("[review]", action, err.message);
    return res.status(err.status || 500).json({ error: err.code || "server" });
  }
}
