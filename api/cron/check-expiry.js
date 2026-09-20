// Daily job (see vercel.json's `crons` entry) — flips anything whose paid
// time has run out from "active" to "readonly" (can still view existing
// data, can't create/edit — see firestore.rules' accountActive()):
//  - a lapsed subscription (starter/pro/studio, or the legacy "monthly"
//    plan): subscriptionExpiresAt in the past;
//  - a finished 7-day trial: trialEndsAt in the past.
// Lifetime plans carry neither field, so they never match. Vercel calls
// this with a GET request; CRON_SECRET guards it from being triggered by
// anyone who finds the URL.
//
// Each query filters on its one timestamp field only and checks `status`
// here in code — a single-field inequality needs no composite index, and
// the rows it re-reads (already-readonly accounts) are few and cheap.
import { adminDb } from "../_firebaseAdmin.js";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = adminDb();
  const now = Date.now();
  const accounts = db.collection("accounts");
  const [lapsedSubs, endedTrials] = await Promise.all([
    accounts.where("subscriptionExpiresAt", "<", now).get(),
    accounts.where("trialEndsAt", "<", now).get(),
  ]);

  const toFlip = new Map();
  lapsedSubs.docs.forEach((doc) => {
    const acc = doc.data();
    // subscriptionExpiresAt is only meaningful for a non-trial plan with a
    // real (numeric) deadline — a trial account or one with a stray/legacy
    // non-number value here must never be flipped off this query alone.
    if (acc.status === "active" && acc.plan !== "trial" && typeof acc.subscriptionExpiresAt === "number") {
      toFlip.set(doc.id, doc.ref);
    }
  });
  endedTrials.docs.forEach((doc) => {
    const acc = doc.data();
    if (acc.status === "active" && acc.plan === "trial") toFlip.set(doc.id, doc.ref);
  });

  if (!toFlip.size) return res.status(200).json({ ok: true, flipped: 0 });

  // Dry run: report who would flip without writing anything, so a change to
  // this query can be checked against production data before the next
  // scheduled run actually touches it.
  if (req.query?.dryRun === "1") {
    return res.status(200).json({ ok: true, dryRun: true, wouldFlip: [...toFlip.keys()] });
  }

  // Firestore batches cap at 500 writes.
  const refs = [...toFlip.values()];
  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();
    refs.slice(i, i + 450).forEach((ref) => batch.update(ref, { status: "readonly" }));
    await batch.commit();
  }

  return res.status(200).json({ ok: true, flipped: refs.length });
}
