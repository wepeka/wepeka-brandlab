// /api/review/{upload|send|clean|keep} — Wepeka's own side (admin only,
// like the rest of Video & posting); /api/review/decide — a client invited
// as "Klien" (or an editor) on the brand, signed in to Brandlab, notes or
// approves the cut sent to them; view-key — the same people read the cuts
// from the client's Drive; /api/review/footage-{start|add|remove} — the crew (Klien or
// editor) sends the shoot's raw clips, footage-key — Wepeka's Mac copies
// them. The cuts and the clips live in the client's own Google Drive. See
// api/_review.js, api/_footage.js and api/_clientDrive.js.
import { adminDb, adminBucket, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { checkUploads, driveNames, finalName, applySend, applyDecision, applyClean, applyKeepFinal, ownPiece, clientOn, clientDriveOf, fail } from "../_review.js";
import { driveConfigured, refreshAccess } from "../_drive.js";
import { pieceFolder, ensureFolder, checkFiles, deleteFiles, renameFile } from "../_clientDrive.js";
import { FOOTAGE_FOLDER, footageMember, clipNames, applyFootageAdd, applyFootageRemove } from "../_footage.js";

async function readDoc(db, path) {
  const snap = await db.doc(path).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// A short-lived key to the client's Drive (driveConnections/{clientUid},
// connected by the client from their own Brandlab). Taken away in Google's
// settings: the brand forgets it, and both sides see it's off.
async function driveAccess(db, brand) {
  const cd = clientDriveOf(brand);
  if (!cd) throw fail(409, "drive-off");
  if (!driveConfigured()) throw fail(503, "setup");
  const conn = await readDoc(db, `driveConnections/${cd.uid}`);
  if (!conn?.refresh) throw fail(409, "drive-off");
  try {
    return { ...(await refreshAccess(conn.refresh)), clientUid: cd.uid };
  } catch (e) {
    if (e.code === "reconnect") {
      await db.doc(`driveConnections/${cd.uid}`).delete().catch(() => {});
      await db.doc(`brands/${brand.id}`).update({ clientDrive: null }).catch(() => {});
      throw fail(409, "drive-off");
    }
    throw fail(502, "google");
  }
}

// One piece, read and rewritten in a transaction.
async function changePiece(db, id, fn) {
  const ref = db.collection("content").doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const out = fn(snap.exists ? { id, ...snap.data() } : null);
    if (out.patch) tx.update(ref, { ...out.patch, updatedAt: Date.now() });
    return out;
  });
}

// After a change: old Storage copies go, old cuts leave the client's Drive,
// the approved cut is named FINAL. Never fails the change itself (a file
// that couldn't go only stays in their Drive).
async function tidy(db, brand, out) {
  if (out.removePaths?.length) {
    const bucket = await adminBucket();
    await Promise.all(out.removePaths.map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch((e) => console.warn("[review] delete", p, e.message))));
  }
  if (!(out.removeDrive?.length || out.finalize) || !clientDriveOf(brand)) return;
  try {
    const { accessToken } = await driveAccess(db, brand);
    if (out.removeDrive?.length) {
      const left = await deleteFiles(accessToken, out.removeDrive);
      if (left.length) console.warn("[review] drive files not deleted", left.length);
    }
    for (const f of out.finalize?.files || []) await renameFile(accessToken, f.id, finalName(out.finalize.code, f.name)).catch(() => {});
  } catch (e) {
    console.warn("[review] drive tidy", e.code || e.message);
  }
}

async function forClient(req, db, uid) {
  const b = req.body || {};
  const contentId = String(b.contentId || "");
  const c = await readDoc(db, `content/${contentId}`);
  if (!c) throw fail(404, "content");
  const brand = await readDoc(db, `brands/${c.brandId}`);
  const member = clientOn(brand, uid, isAdminUid);
  if (c.ownerId !== brand.ownerId) throw fail(404, "content");
  const out = await changePiece(db, contentId, (cur) => applyDecision(cur, { versionId: String(b.versionId || ""), verdict: b.verdict, note: b.note, name: member.name || member.email || "" }));
  await tidy(db, brand, out);
  return { ok: true };
}

// view-key: the brand's team member who isn't the one whose Drive holds
// the cuts (an editor, a second Klien) watches and downloads them through
// a short-lived key to that Drive — the same key the crew already gets to
// send footage, reaching only what Brandlab made there (scope drive.file).
async function forViewer(req, db, uid) {
  const brand = await readDoc(db, `brands/${String(req.body?.brandId || "")}`);
  if (!brand) throw fail(404, "brand");
  if (uid !== brand.ownerId) clientOn(brand, uid, isAdminUid);
  else if (!isAdminUid(uid)) throw fail(403, "private");
  const { accessToken, expiresIn } = await driveAccess(db, brand);
  return { accessToken, expiresIn };
}

// The shoot's raw clips (api/_footage.js). start: the piece's Footage
// folder in the client's Drive, the names, and a key for this browser to
// send the clips straight there; add: the ones that arrived; remove: a
// wrong take; key (Wepeka only): to copy them to the Mac. The key only
// reaches what Brandlab made in that Drive (scope drive.file).
async function forFootage(action, req, db, uid) {
  const b = req.body || {};
  const contentId = String(b.contentId || "");
  const c = await readDoc(db, `content/${contentId}`);
  if (!c) throw fail(404, "content");
  const brand = await readDoc(db, `brands/${c.brandId}`);
  if (!brand || c.ownerId !== brand.ownerId) throw fail(404, "content");
  if (action === "footage-key") {
    if (!isAdminUid(uid) || uid !== brand.ownerId) throw fail(403, "private");
    const { accessToken, expiresIn } = await driveAccess(db, brand);
    return { accessToken, expiresIn, folderId: c.footage?.folderId || "" };
  }
  const member = footageMember(brand, uid, isAdminUid);
  const who = member.name || member.email || "";
  if (action === "footage-start") {
    const taken = (c.footage?.files || []).map((f) => f.name);
    const names = clipNames(b.files, taken);
    const access = await driveAccess(db, brand);
    const cache = brand.clientDrive.folders || {};
    const code = String(b.code || "").slice(0, 16);
    const folders = await pieceFolder(access.accessToken, { brandName: brand.name, code, title: c.title, cache: { ...cache, folderId: c.posting?.clientFolder } });
    const folderId = await ensureFolder(access.accessToken, { name: FOOTAGE_FOLDER, parent: folders.folderId, known: c.footage?.folderId });
    if (folders.rootId !== cache.rootId || folders.brandFolderId !== cache.brandFolderId) {
      await db.doc(`brands/${brand.id}`).update({ "clientDrive.folders": { rootId: folders.rootId, brandFolderId: folders.brandFolderId } });
    }
    const patch = {};
    if (folders.folderId !== c.posting?.clientFolder) patch["posting.clientFolder"] = folders.folderId;
    if (folderId !== c.footage?.folderId) patch["footage.folderId"] = folderId;
    if (Object.keys(patch).length) await db.doc(`content/${contentId}`).update(patch);
    return { accessToken: access.accessToken, expiresIn: access.expiresIn, folderId, names };
  }
  if (action === "footage-add") {
    const folderId = c.footage?.folderId;
    if (!folderId) throw fail(400, "missing");
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length || ids.length > 50) throw fail(400, "files");
    const { accessToken } = await driveAccess(db, brand);
    const files = await checkFiles(accessToken, ids, folderId);
    const out = await changePiece(db, contentId, (cur) => applyFootageAdd(cur, { files, folderId, by: uid, who }));
    return { ok: true, added: out.added.length };
  }
  if (action === "footage-remove") {
    const out = await changePiece(db, contentId, (cur) => applyFootageRemove(cur, String(b.id || "")));
    await tidy(db, brand, out);
    return { ok: true };
  }
  throw fail(404, "action");
}

async function forOwner(action, req, db, uid) {
  const b = req.body || {};
  const contentId = String(b.contentId || "");
  const c = ownPiece(await readDoc(db, `content/${contentId}`), uid);
  const brand = await readDoc(db, `brands/${c.brandId}`);
  if (!brand) throw fail(404, "brand");
  if (action === "upload") {
    // The piece's folder in the client's Drive, the file names, and a key
    // for this browser to upload into it straight from the Mac folder.
    const version = (c.posting?.versions || []).find((v) => v.id === String(b.versionId || ""));
    if (!version) throw fail(404, "version");
    checkUploads(b.files);
    const access = await driveAccess(db, brand);
    const code = String(b.code || "").slice(0, 16);
    const cache = brand.clientDrive.folders || {};
    const folders = await pieceFolder(access.accessToken, { brandName: brand.name, code, title: c.title, cache: { ...cache, folderId: c.posting?.clientFolder } });
    if (folders.rootId !== cache.rootId || folders.brandFolderId !== cache.brandFolderId) {
      await db.doc(`brands/${brand.id}`).update({ "clientDrive.folders": { rootId: folders.rootId, brandFolderId: folders.brandFolderId } });
    }
    if (folders.folderId !== c.posting?.clientFolder) await db.doc(`content/${contentId}`).update({ "posting.clientFolder": folders.folderId });
    return { accessToken: access.accessToken, expiresIn: access.expiresIn, folderId: folders.folderId, ...driveNames({ code, version, files: b.files }) };
  }
  if (action === "send") {
    const { accessToken } = await driveAccess(db, brand);
    const folderId = c.posting?.clientFolder;
    if (!folderId) throw fail(400, "missing");
    const ids = Array.isArray(b.drive) ? b.drive.map(String) : [];
    if (!ids.length || ids.length > 20) throw fail(400, "files");
    const files = await checkFiles(accessToken, ids, folderId);
    const poster = b.poster ? (await checkFiles(accessToken, [String(b.poster)], folderId))[0].id : "";
    const out = await changePiece(db, contentId, (cur) => applySend(ownPiece(cur, uid), { versionId: String(b.versionId || ""), drive: files, poster, kind: b.kind, code: b.code }));
    await tidy(db, brand, out);
    return { ok: true };
  }
  if (action === "clean" || action === "keep") {
    // clean: the post is up. keep: Wepeka approved a cut in Brandlab.
    const out = await changePiece(db, contentId, (cur) => (action === "clean" ? applyClean : applyKeepFinal)(ownPiece(cur, uid)));
    await tidy(db, brand, out);
    return { ok: true };
  }
  throw fail(404, "action");
}

export default async function handler(req, res) {
  const action = String(req.query?.action || "");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let user;
  try {
    user = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  const db = adminDb();
  try {
    if (action === "decide") return res.status(200).json(await forClient(req, db, user.uid));
    if (action === "view-key") return res.status(200).json(await forViewer(req, db, user.uid));
    if (action.startsWith("footage-")) return res.status(200).json(await forFootage(action, req, db, user.uid));
    if (!isAdminUid(user.uid)) return res.status(403).json({ error: "private" });
    return res.status(200).json(await forOwner(action, req, db, user.uid));
  } catch (err) {
    if (!err.status) console.warn("[review]", action, err.message);
    return res.status(err.status || 500).json({ error: err.code || "server" });
  }
}
