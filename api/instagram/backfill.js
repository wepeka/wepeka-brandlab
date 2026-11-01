// Comment → DM for comments the webhook never answered (posted before the
// automation existed, or while it was down). Admin only.
//   GET   → the list: keyword comments from the last 7 days with no reply
//           from the owner and no DM from the bot. Sends nothing.
//   POST  { commentIds: [...] } → message 1 + public reply for exactly those
//           ids, re-checked against a fresh scan (so nothing outside the list
//           the admin saw, and nothing already answered since).
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { findMissedComments, answerMissedComments, graphClient, currentToken } from "../_igAutoDm.js";
import { firestoreDeps } from "./webhook.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();
  try {
    const { uid } = await requireAuth(req);
    if (!isAdminUid(uid)) return res.status(403).json({ error: "admin-only" });
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }

  const db = adminDb();
  const token = await currentToken(db);
  if (!token) return res.status(503).json({ error: "no-token" });
  const graph = graphClient(token);
  const deps = { graph, ...firestoreDeps(db) };
  const isClaimed = async (id) => (await db.doc(`igAutoDmComments/${id}`).get()).exists;

  let found;
  try {
    found = await findMissedComments({ graph, isClaimed });
  } catch (err) {
    console.error("[ig-auto-dm] backfill scan failed:", err?.message);
    return res.status(502).json({ error: "scan", message: err?.message });
  }
  const list = found.comments.map(({ commentId, username, text, at, permalink, caption }) => ({ commentId, username, text, at: new Date(at).toISOString(), permalink, caption }));
  if (req.method === "GET") return res.status(200).json({ ok: true, count: list.length, comments: list });

  const wanted = new Set((Array.isArray(req.body?.commentIds) ? req.body.commentIds : []).map(String));
  const pick = { ...found, comments: found.comments.filter((c) => wanted.has(c.commentId)) };
  const results = await answerMissedComments(pick, deps);
  console.log("[ig-auto-dm] backfill sent", JSON.stringify(results));
  return res.status(200).json({ ok: true, asked: wanted.size, sent: pick.comments.length, results });
}
