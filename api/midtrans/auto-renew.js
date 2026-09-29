// "Berhenti perpanjang otomatis" (Settings → Paket): disables one of the
// account's Midtrans subscriptions. The paid time already running is kept;
// it just won't be charged again. The midtransSubs/<name> record stays (a
// charge Midtrans was already retrying still has to be credited if it lands).
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { disableSubscription } from "../_midtrans.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }
  const { slot } = req.body || {};
  if (!/^[A-Za-z0-9_]{1,40}$/.test(String(slot || ""))) return res.status(400).json({ error: "Data tidak valid." });

  const db = adminDb();
  const accountRef = db.doc(`accounts/${uid}`);
  const entry = (await accountRef.get()).data()?.autoRenew?.[slot];
  if (!entry) return res.status(404).json({ error: "Perpanjang otomatis ini sudah tidak aktif." });
  try {
    await disableSubscription(entry.subscriptionId);
  } catch (err) {
    console.error("auto-renew: disable failed", uid, entry.subscriptionId, err?.message);
    return res.status(502).json({ error: "Gagal menghentikan di Midtrans — coba lagi sebentar." });
  }
  await accountRef.update({ [`autoRenew.${slot}`]: FieldValue.delete() });
  if (entry.name) await db.doc(`midtransSubs/${entry.name}`).set({ disabledAt: Date.now() }, { merge: true });
  return res.status(200).json({ ok: true });
}
