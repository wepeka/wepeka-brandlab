// The buyer closed the checkout without picking a way to pay (js/views/
// pricing.js, Snap's onClose): the Founder / Agency seat it held goes back
// on sale now instead of when the hold runs out. Only the order's own
// account may ask, and nothing is freed while Midtrans has a transaction
// for the order — the rules are in api/_seatRelease.js. Every answer is a
// plain { released, reason? }; the browser doesn't wait for it.
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { ownOrderIds } from "../_payments.js";
import { SLOTS_DOC } from "../_plans.js";
import { releaseUnpaidSeat } from "../_seatRelease.js";
import { cancelSnapToken, orderTransaction } from "../_midtrans.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }
  // Only an id that carries the caller's own uid is looked up; the record's
  // uid and hold key are checked again on top.
  const [orderId] = ownOrderIds([req.body?.orderId], uid);
  if (!orderId) return res.status(200).json({ released: false, reason: "unknown-order" });
  try {
    const db = adminDb();
    const result = await releaseUnpaidSeat({
      db, paymentRef: db.doc(`payments/${orderId}`), slotsRef: db.doc(SLOTS_DOC), orderId, uid,
      cancelToken: cancelSnapToken, lookupOrder: orderTransaction,
    });
    return res.status(200).json(result);
  } catch (err) {
    // The hold simply runs out on its own.
    console.error("release-seat error", orderId, err?.message);
    return res.status(500).json({ released: false, reason: "error" });
  }
}
