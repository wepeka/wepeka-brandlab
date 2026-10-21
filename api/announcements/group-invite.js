// "Gabung grup WhatsApp" email (admin only, from the Pengumuman page):
// every active account gets one email with the right door — a Lifetime
// account both groups (Founder Circle first), everyone else the general
// Brandlab group (composeGroupInviteEmail in api/_community.js). Same list
// as an announcement email (api/_mailList.js), so turning those off in
// Pengaturan → Pengingat also skips this one.
//
//   GET                 → how far the real send got: { sent, total, remaining, updatedAt }
//   POST { test: true } → both versions to the admin's own address only,
//                         plus how many accounts the real send would reach
//   POST {}             → the real send. Resumable: every address that went
//                         out is kept on mailings/wa-group-invite, so a run
//                         cut short by Resend's daily limit (free plan: 100
//                         a day) sends only the rest when pressed again, and
//                         nobody gets it twice. A lock stops two runs at once.
import { adminDb, requireAuth, authUser } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { emailConfigured, sendEmail, sendEmailBatch } from "../_email.js";
import { composeGroupInviteEmail } from "../_community.js";
import { loadMailRecipients } from "../_mailList.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = { maxDuration: 60 };

const DOC = "mailings/wa-group-invite";
const LOCK_MS = 2 * 60 * 1000;

const countCircle = (list) => list.filter((r) => r.circle).length;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method" });
  let decoded;
  try {
    decoded = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  const { uid } = decoded;
  if (!isAdminUid(uid)) return res.status(403).json({ error: "forbidden" });
  const db = adminDb();
  const ref = db.doc(DOC);

  if (req.method === "GET") {
    const d = (await ref.get()).data() || {};
    const sent = (d.sentTo || []).length;
    return res.status(200).json({ sent, total: d.total ?? null, remaining: d.total == null ? null : Math.max(0, d.total - sent), updatedAt: d.updatedAt || null });
  }

  if (!emailConfigured()) return res.status(503).json({ error: "email-off" });

  if (req.body?.test === true) {
    const to = decoded.email || (await authUser(uid).catch(() => null))?.email || "";
    if (!to) return res.status(400).json({ error: "no-email" });
    const recipients = await loadMailRecipients(db);
    const minute = Math.floor(Date.now() / 60000);
    const versions = [
      { tag: "[TES] ", mail: composeGroupInviteEmail({ circle: false }) },
      { tag: "[TES Lifetime] ", mail: composeGroupInviteEmail({ circle: true }) },
    ];
    const results = await Promise.all(versions.map(({ tag, mail }, i) => sendEmail({ to, ...mail, subject: tag + mail.subject, idempotencyKey: `brandlab-wa-invite-test-${uid}-${minute}-${i}` })));
    if (!results.some((r) => r.ok)) return res.status(502).json({ error: "send-failed", message: results[0]?.error || "" });
    const d = (await ref.get()).data() || {};
    const done = new Set(d.sentTo || []);
    return res.status(200).json({ ok: true, test: true, to, total: recipients.length, circle: countCircle(recipients), alreadySent: recipients.filter((r) => done.has(r.email)).length });
  }

  // ---- the real send ----
  const now = Date.now();
  const lock = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() || {};
    if (d.runningAt && now - d.runningAt < LOCK_MS) return { busy: true };
    tx.set(ref, { runningAt: now }, { merge: true });
    return { sentTo: d.sentTo || [] };
  });
  if (lock.busy) return res.status(409).json({ error: "busy" });

  try {
    const recipients = await loadMailRecipients(db);
    const done = new Set(lock.sentTo);
    const todo = recipients.filter((r) => !done.has(r.email));
    const versions = { plain: composeGroupInviteEmail({ circle: false }), circle: composeGroupInviteEmail({ circle: true }) };
    // Keyed on how many had already gone out: a retried request repeats the
    // same key (Resend answers it without sending again), a later resume doesn't.
    const result = todo.length
      ? await sendEmailBatch(todo.map((r) => ({ to: r.email, ...(r.circle ? versions.circle : versions.plain) })), { idempotencyKey: `brandlab-wa-invite-${done.size}` })
      : { ok: true, sent: 0 };
    const newlySent = todo.slice(0, result.sent).map((r) => r.email);
    const sentTotal = recipients.filter((r) => done.has(r.email)).length + newlySent.length;
    await ref.set({
      ...(newlySent.length ? { sentTo: FieldValue.arrayUnion(...newlySent) } : {}),
      total: recipients.length,
      circle: countCircle(recipients),
      updatedAt: Date.now(),
      runningAt: null,
      lastError: result.ok ? null : String(result.error || "").slice(0, 200),
    }, { merge: true });
    if (!result.sent && todo.length) return res.status(502).json({ error: "send-failed", message: result.error || "", total: recipients.length, remaining: todo.length });
    return res.status(200).json({ ok: true, sent: result.sent, total: recipients.length, sentTotal, remaining: recipients.length - sentTotal, partial: !result.ok, message: result.ok ? "" : result.error || "" });
  } catch (err) {
    console.error("[announcements/group-invite] failed", err?.message);
    await ref.set({ runningAt: null }, { merge: true }).catch(() => {});
    return res.status(500).json({ error: "failed" });
  }
}
