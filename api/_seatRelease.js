// A Founder / Agency checkout closed without picking a way to pay gives its
// seat back right away instead of an hour later (owner, 2026-10-23: one
// hour to pay, plus this). The browser asks when Snap closes unanswered
// (js/views/pricing.js → api/midtrans/release-seat.js); everything that
// decides is here, with the Firestore refs and the Midtrans calls passed
// in, so tests/seat-release.test.mjs runs it against fakes. The leading
// underscore keeps Vercel from exposing this file as a route.
//
// A seat is never freed while its order can still be paid:
//  - the webhook marks an order the moment Midtrans reports any
//    transaction for it (`transactionAt`: a virtual account, a QR code, a
//    card under review) — a marked order is never released;
//  - the release first cancels the Snap token, so the closed checkout can't
//    start a payment any more (Midtrans refuses once one exists), then asks
//    Midtrans whether the order has a transaction — only "none" goes on;
//  - the order is closed and the seat freed in one Firestore transaction
//    that re-reads the order, so the webhook's mark and the release can't
//    both win.
// Only the account the order and its hold belong to can ask.
import { holdKeyFor, releaseSeat, seatFields } from "./_plans.js";

// Why this order's seat can't be released (null: it may be). `payment` is
// payments/{orderId}; `uid` is who asks.
export function releaseRefusal(payment, uid) {
  if (!payment) return "unknown-order";
  if (!uid || payment.uid !== uid) return "not-yours";
  if (!payment.hold?.slot || !payment.hold.key) return "no-hold";
  if (payment.hold.key !== holdKeyFor(uid)) return "not-yours";
  if (payment.status !== "pending") return "closed";
  if (payment.transactionAt) return "payable";
  if (!payment.snapToken) return "no-token";
  return null;
}

// The webhook's mark (any notification for a held seat's open order means
// Midtrans has a transaction for it). In a transaction, so it and a release
// in flight can't both pass.
export async function markTransaction(db, paymentRef, now = Date.now()) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(paymentRef);
    const payment = snap.exists ? snap.data() : null;
    if (payment?.status !== "pending" || payment.transactionAt) return false;
    tx.set(paymentRef, { transactionAt: now }, { merge: true });
    return true;
  });
}

// Releases the seat of `orderId` for `uid`. `cancelToken(token)` and
// `lookupOrder(orderId)` are api/_midtrans.js cancelSnapToken and
// orderTransaction. → { released: true } | { released: false, reason }.
export async function releaseUnpaidSeat({ db, paymentRef, slotsRef, orderId, uid, now = Date.now(), cancelToken, lookupOrder }) {
  const first = await paymentRef.get();
  const refusal = releaseRefusal(first.exists ? first.data() : null, uid);
  if (refusal) return { released: false, reason: refusal };
  const payment = first.data();
  // No new payment from this checkout from here on; refused when the buyer
  // already picked a way to pay.
  const cancelled = await cancelToken(payment.snapToken);
  if (!cancelled?.ok) return { released: false, reason: "midtrans-refused" };
  // And none was made before: Midtrans has no transaction for the order.
  const known = await lookupOrder(orderId);
  if (known !== "none") return { released: false, reason: known ? "payable" : "status-unknown" };
  return db.runTransaction(async (tx) => {
    const [paySnap, slotsSnap] = await Promise.all([tx.get(paymentRef), tx.get(slotsRef)]);
    const fresh = paySnap.exists ? paySnap.data() : null;
    const late = releaseRefusal(fresh, uid);
    if (late) return { released: false, reason: late };
    tx.set(paymentRef, { status: "abandoned", closedAt: now }, { merge: true });
    // Only the hold this order made (a newer checkout of the account's own
    // keeps its own); an older order of theirs that can still be paid gets
    // its hold back (`holdPrevious`, api/_plans.js releaseSeat).
    if (slotsSnap.exists) {
      const holds = releaseSeat(slotsSnap.data(), fresh.hold.slot, fresh.hold.key, fresh.hold.until, now, fresh.holdPrevious ?? null);
      tx.update(slotsRef, seatFields(fresh.hold.slot, { holds }).update);
    }
    return { released: true };
  });
}
