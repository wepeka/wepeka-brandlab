// /api/drive/{start|token|disconnect|callback} — see api/_drive.js. Video &
// posting is private to Wepeka's own account for now, so every signed-in
// action checks the admin uid too (the same list as js/account.js) — or a
// client Wepeka invited as "Klien" on one of its brands (2026-11-09), who
// connects their own Drive to keep the videos sent to them.
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { driveConfigured, finishConnect, runDrive, redirectUri, clientBrandIds } from "../_drive.js";

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
  if (!isAdminUid(user.uid)) {
    const m = await db.doc(`memberships/${user.uid}`).get().catch(() => null);
    if (!clientBrandIds(m?.exists ? m.data() : null, isAdminUid).length) return res.status(403).json({ error: "private" });
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
