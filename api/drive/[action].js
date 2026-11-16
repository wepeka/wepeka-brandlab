// /api/drive/{start|token|disconnect|callback} — see api/_drive.js. Every
// Brandlab account keeps its cuts in its own Drive (2026-11-16); who may
// connect is api/_drive.js driveAllowed: an account still working in
// Brandlab, Wepeka's own, or a client Wepeka invited as "Klien".
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid, isReadOnlyAccount } from "../_aiQuota.js";
import { driveConfigured, finishConnect, runDrive, redirectUri, driveAllowed } from "../_drive.js";

export default async function handler(req, res) {
  const action = String(req.query?.action || "");

  if (action === "callback") {
    let location = "/#/";
    if (driveConfigured()) {
      try {
        ({ location } = await finishConnect({ code: req.query.code, state: req.query.state, error: req.query.error, redirect: redirectUri(req), db: adminDb(), isAdminUid }));
      } catch (err) {
        console.warn("[drive] connect failed", err.code || err.message);
      }
    }
    res.statusCode = 302;
    res.setHeader("Location", location);
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!driveConfigured()) return res.status(503).json({ error: "setup" });

  let user;
  try {
    user = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  const db = adminDb();
  if (action === "start" && !isAdminUid(user.uid)) {
    const [a, m] = await Promise.all([db.doc(`accounts/${user.uid}`).get(), db.doc(`memberships/${user.uid}`).get()].map((p) => p.catch(() => null)));
    const allowed = driveAllowed({ action, uid: user.uid, account: a?.exists ? a.data() : null, membership: m?.exists ? m.data() : null, isAdminUid, isReadOnlyAccount });
    if (!allowed) return res.status(403).json({ error: "inactive" });
  }

  try {
    const out = await runDrive({ action, uid: user.uid, email: user.email, ret: String(req.body?.ret || ""), redirect: redirectUri(req), db, isAdminUid });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (err) {
    if (!err.status) console.warn("[drive]", action, err.message);
    return res.status(err.status || 500).json({ error: err.code || "server" });
  }
}
