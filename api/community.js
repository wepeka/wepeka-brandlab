// The community door that isn't public: the Lifetime WhatsApp group
// (Founder Circle). Its link never ships in the browser bundle — an account
// asks here with its sign-in token, and only a Lifetime account (Founder,
// Agency Lifetime, the old Lifetime plan) or Wepeka's own team gets it
// (api/_community.js lifetimeGroupFor). The general Brandlab group is public
// and lives in js/site-links.js.
import { adminDb, requireAuth } from "./_firebaseAdmin.js";
import { lifetimeGroupFor } from "./_community.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const snap = await adminDb().doc(`accounts/${uid}`).get();
    return res.status(200).json({ lifetimeGroupUrl: lifetimeGroupFor(uid, snap.exists ? snap.data() : null) });
  } catch (err) {
    console.error("[community] account read failed", err);
    return res.status(500).json({ error: "Gagal memuat." });
  }
}
