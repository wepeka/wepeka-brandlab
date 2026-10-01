// Firestore side of capped-seat holds (Founder / Agency Lifetime): what to
// hold, convert or give back is decided by the pure helpers in
// api/_plans.js (reserveSeat / convertSeat / releaseSeat); this only writes
// meta/founderSlots, always inside a transaction, so two checkouts can
// never both take the last seat — or the last seat of a price wave. The
// leading underscore keeps Vercel from exposing this file as a route.
import { SLOTS_DOC, holdKeyFor, reserveSeat, releaseSeat, seatFields } from "./_plans.js";

export function writeSeats(tx, ref, snap, fields) {
  if (snap?.exists) tx.update(ref, fields.update);
  else tx.set(ref, fields.set);
}

// Holds one seat of `plan.slot` for `uid` (refreshing the account's own
// hold if it has one). null = sold out; else the price wave the seat falls
// in and the hold to record on the pending payment.
export async function holdSeat(db, plan, uid, now = Date.now()) {
  const ref = db.doc(SLOTS_DOC);
  const key = holdKeyFor(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const held = reserveSeat(snap.exists ? snap.data() : {}, plan.slot, key, plan, now);
    if (!held) return null;
    writeSeats(tx, ref, snap, seatFields(plan.slot, { holds: held.holds }));
    return { price: held.price, hold: { slot: plan.slot, key, until: held.until } };
  });
}

// Gives a hold back (a checkout that failed to open, an order that expired
// or was cancelled). Never throws — at worst the hold lapses on its own.
export async function releaseHold(db, hold, now = Date.now()) {
  if (!hold?.slot || !hold.key) return;
  const ref = db.doc(SLOTS_DOC);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      tx.update(ref, seatFields(hold.slot, { holds: releaseSeat(snap.data(), hold.slot, hold.key, hold.until, now) }).update);
    });
  } catch (err) {
    console.error("seat hold release failed", hold.slot, err?.message);
  }
}
