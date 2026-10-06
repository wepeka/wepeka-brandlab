// POST /api/brands/recount — the only writer that creates or repairs
// brandCounts/{uid}: counts the signed-in account's ACTIVE brands (not
// archived, not in Trash — what js/account.js canCreateBrand counts) with
// the Admin SDK and stores { count, op: "recount", at }. firestore.rules
// never let the client create, delete or freely set this doc; it can only
// move it by one in the same batch as a brand turning active/inactive, and
// any inactive → active move must stay within the plan's brand limit.
// js/store.js calls this once when the account has no counter yet, and
// again (then retries once) whenever a brand write is refused — so a wrong
// count can always be repaired from the brands themselves.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, requireAuth } from "../_firebaseAdmin.js";

// Active = not archived, not in Trash — the same definition as js/store.js
// brandIsActive and firestore.rules brandActive (which only let deletedAt be
// null/absent or a timestamp, and archived a boolean).
export const isActiveBrand = (b) => !!b && b.archived !== true && (b.deletedAt === undefined || b.deletedAt === null);

// Mirrors firestore.rules accountActive() / js/account.js writableByRules():
// only an account that may write brands gets a recount.
export function accountCanWrite(acc, now = Date.now()) {
  if (!acc || acc.status !== "active" || acc.plan === "free") return false;
  if (acc.plan === "trial") return Number(acc.trialEndsAt) > now;
  const ends = acc.subscriptionExpiresAt;
  return ends == null || typeof ends !== "number" || ends > now;
}

// At most one real recount per account every 30 s; in between, the stored
// count is returned (a refused write's retry, a reload loop, a script).
export const RECOUNT_EVERY_MS = 30_000;
const toMillis = (v) => (typeof v?.toMillis === "function" ? v.toMillis() : Number(v) || 0);

// In one transaction: the brands read and the counter write agree, and a
// brand write landing in between makes one of the two retry.
export async function recountBrandsFor(db, uid, { now = Date.now() } = {}) {
  const accountRef = db.doc(`accounts/${uid}`);
  const counterRef = db.doc(`brandCounts/${uid}`);
  const brands = db.collection("brands").where("ownerId", "==", uid).select("archived", "deletedAt");
  return db.runTransaction(async (tx) => {
    const account = await tx.get(accountRef);
    if (!account.exists || !accountCanWrite(account.data(), now)) {
      const err = new Error("Account can't write brands");
      err.status = 403;
      throw err;
    }
    const counter = await tx.get(counterRef);
    if (counter.exists && now - toMillis(counter.data().lastRecountAt) < RECOUNT_EVERY_MS) {
      return { count: counter.data().count, throttled: true };
    }
    const snap = await tx.get(brands);
    const count = snap.docs.filter((d) => isActiveBrand(d.data())).length;
    tx.set(counterRef, { count, op: "recount", at: FieldValue.serverTimestamp(), lastRecountAt: FieldValue.serverTimestamp() });
    return { count };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "Sesi tidak valid — coba login ulang." });
  }
  try {
    const { count, throttled } = await recountBrandsFor(adminDb(), uid);
    return res.status(200).json({ count, ...(throttled ? { throttled: true } : {}) });
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: "Akun ini tidak aktif." });
    console.error("[brands/recount]", err);
    return res.status(500).json({ error: "Gagal menghitung brand." });
  }
}
