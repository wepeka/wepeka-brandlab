// "Kirim juga lewat email": mails one announcement (announcements/{id},
// written by the admin in the app — js/announcements.js) to every active
// account that hasn't turned announcement emails off. Admin only, and once
// per announcement: announcements/{id}.emailedAt is claimed in a transaction
// before anything is sent, so a double click or a retry can't mail it twice.
//
// Needs RESEND_API_KEY + RESEND_FROM (api/_email.js). Resend's free tier
// stops at 100 emails a day: when the list is longer than what went out,
// the answer says how many were sent, and the claim is kept (sending the
// rest is a manual decision, not an automatic second run to the same people).
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { emailConfigured, sendEmailBatch } from "../_email.js";
import { composeAnnouncementEmail, announcementRecipients } from "../_community.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  if (!isAdminUid(uid)) return res.status(403).json({ error: "forbidden" });
  if (!emailConfigured()) return res.status(503).json({ error: "email-off" });

  const id = String(req.body?.id || "").trim();
  if (!id || id.includes("/")) return res.status(400).json({ error: "id" });
  const db = adminDb();
  const ref = db.doc(`announcements/${id}`);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: "not-found" };
    const a = snap.data();
    if (a.emailedAt) return { error: "already", emailedAt: a.emailedAt, sent: a.emailed?.sent || 0 };
    tx.update(ref, { emailedAt: Date.now() });
    return { announcement: a };
  });
  if (claimed.error === "not-found") return res.status(404).json({ error: "not-found" });
  if (claimed.error === "already") return res.status(409).json({ error: "already", sent: claimed.sent });

  try {
    const [accountsSnap, offSnap] = await Promise.all([
      db.collection("accounts").where("status", "==", "active").get(),
      db.collection("settings").where("updatesEmailOff", "==", true).get(),
    ]);
    const optedOut = new Set(offSnap.docs.map((d) => d.id));
    const accounts = accountsSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    // accounts/{uid}.email is written by the server; an account without one
    // (older docs) falls back to its Firebase Auth address.
    const missing = accounts.filter((a) => !a.email && !optedOut.has(a.uid)).slice(0, 300);
    if (missing.length) {
      const auth = getAuth(getApps()[0]);
      for (let i = 0; i < missing.length; i += 100) {
        const found = await auth.getUsers(missing.slice(i, i + 100).map((a) => ({ uid: a.uid }))).catch(() => ({ users: [] }));
        const byUid = new Map(found.users.map((u) => [u.uid, u.email || ""]));
        missing.slice(i, i + 100).forEach((a) => { a.email = byUid.get(a.uid) || ""; });
      }
    }
    const recipients = announcementRecipients(accounts, optedOut);
    const mail = composeAnnouncementEmail(claimed.announcement);
    const result = await sendEmailBatch(recipients.map((r) => ({ to: r.email, ...mail })), { idempotencyKey: `brandlab-ann-${id}` });
    await ref.update({ emailed: { sent: result.sent, total: recipients.length, at: Date.now(), ...(result.ok ? {} : { error: String(result.error || "").slice(0, 200) }) } });
    // Nothing went out at all: hand the claim back so it can be tried again.
    if (!result.sent && recipients.length) {
      await ref.update({ emailedAt: null });
      return res.status(502).json({ error: "send-failed", message: result.error || "", total: recipients.length });
    }
    return res.status(200).json({ ok: true, sent: result.sent, total: recipients.length, partial: !result.ok, message: result.ok ? "" : result.error || "" });
  } catch (err) {
    console.error("[announcements/notify] failed", id, err?.message);
    await ref.update({ emailedAt: null }).catch(() => {});
    return res.status(500).json({ error: "failed" });
  }
}
