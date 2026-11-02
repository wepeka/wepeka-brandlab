// Every minute (vercel.json `crons`): Instagram posts scheduled from Brandlab
// (api/_igPost.js) — make the container a few minutes before the hour,
// publish on it, write the permalink back. Same guard as the other crons:
// CRON_SECRET must be set AND match.
import { adminDb, adminBucket } from "../_firebaseAdmin.js";
import { runJob, LIVE } from "../_igPostRun.js";
import { EARLY_MS } from "../_igPost.js";

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "auth" });
  const db = adminDb();
  const snap = await db.collection("igJobs").where("state", "in", LIVE).get();
  const now = Date.now();
  const due = snap.docs.filter((d) => d.data().state !== "waiting" || d.data().at - EARLY_MS <= now).map((d) => d.id);
  if (!due.length) return res.status(200).json({ due: 0 });
  const bucket = await adminBucket();
  const out = {};
  for (const id of due.slice(0, 10)) {
    try { out[id] = await runJob(db, bucket, id, { budgetMs: 20 * 1000 }); } catch (e) { console.warn("[ig-post] cron", id, e.message); out[id] = "error"; }
  }
  return res.status(200).json({ due: due.length, out });
}
