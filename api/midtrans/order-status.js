// What became of the caller's own orders: { orders: { <order_id>: "paid" |
// "pending" | "closed" | "unknown" } }. Read-only and for analytics alone —
// js/pending-orders.js asks so GA4 hears about a bank transfer / virtual
// account that was paid after Snap closed (Snap's onSuccess never runs for
// those). It never unlocks anything: that stays the webhook's job.
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { ownOrderIds, orderStatusFor } from "../_payments.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }
  // Only ids that carry the caller's own uid are ever looked up, and the
  // record's uid is checked again on top (api/_payments.js).
  const ids = ownOrderIds(req.body?.orderIds, uid);
  if (!ids.length) return res.status(200).json({ orders: {} });
  try {
    const db = adminDb();
    const snaps = await db.getAll(...ids.map((id) => db.doc(`payments/${id}`)));
    const orders = {};
    snaps.forEach((snap, i) => { orders[ids[i]] = orderStatusFor(snap.exists ? snap.data() : null, uid); });
    return res.status(200).json({ orders });
  } catch (err) {
    console.error("order-status error", err?.message);
    return res.status(500).json({ error: "Gagal membaca status pesanan." });
  }
}
