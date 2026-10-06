// "Kirim tes" (Settings → Pengingat): sends one test notification to the
// signed-in owner's own devices (settings/{uid}.reminders.push), or to just
// the one `endpoint` in the body when it's one of them. Same Firebase ID
// token check as api/ai.js — the uid comes from the token, never the body.
// Devices the push service no longer knows (404/410) are removed.
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { normalizeReminders, deliverPush, deadEntries, composeTestPush, webPushSender, pushConfigured } from "../_reminders.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!pushConfigured()) return res.status(503).json({ error: "push-off" });

  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }

  const db = adminDb();
  const ref = db.doc(`settings/${uid}`);
  const raw = (await ref.get()).data()?.reminders;
  const rem = normalizeReminders(raw);
  const only = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  const subs = only ? rem.push.filter((s) => s.endpoint === only) : rem.push;
  if (!subs.length) return res.status(404).json({ error: "no-device" });

  const send = await webPushSender();
  const result = await deliverPush(subs, composeTestPush({ lang: rem.lang }), (sub, body) => send(sub, body, { ttl: 600 }));
  const dead = deadEntries(raw?.push, result.dead);
  if (dead.length) await ref.update({ "reminders.push": FieldValue.arrayRemove(...dead) }).catch(() => {});
  return res.status(200).json({ ok: true, sent: result.delivered, failed: result.failed, removed: dead.length });
}
