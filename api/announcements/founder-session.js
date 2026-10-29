// "Sesi Founder" reminder email (admin only, from the Pengumuman page): one
// email to every Lifetime account (Founder, Founder Ultimate, Lifetime, the
// team) with the Discord invite, the Lifetime WhatsApp group and the nudge
// to write a question (composeFounderSessionEmail in api/_community.js).
// Same list as an announcement email (api/_mailList.js) filtered to
// `circle`, so Pengaturan → Pengingat opt-outs are skipped.
//
//   GET                 → how far the real send got: { sent, total, remaining, updatedAt }
//   POST { test: true } → both versions to the admin's own address only,
//                         plus how many accounts the real send would reach
//   POST {}             → the real send. Resumable: every address that went
//                         out is kept on mailings/founder-session-1030, so a run
//                         cut short by Resend's daily limit (free plan: 100
//                         a day) sends only the rest when pressed again, and
//                         nobody gets it twice. A lock stops two runs at once.
import { adminDb, requireAuth, authUser } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { emailConfigured, sendEmail, sendEmailBatch } from "../_email.js";
import { composeFounderSessionEmail } from "../_community.js";
import { loadMailRecipients } from "../_mailList.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = { maxDuration: 60 };

const DOC = "mailings/founder-session-1030";
const LOCK_MS = 2 * 60 * 1000;

const founders = (list) => list.filter((r) => r.circle);

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
    const recipients = founders(await loadMailRecipients(db));
    const minute = Math.floor(Date.now() / 60000);
    const mail = composeFounderSessionEmail();
    const r = await sendEmail({ to, ...mail, subject: "[TES] " + mail.subject, idempotencyKey: `brandlab-founder-session-test-${uid}-${minute}` });
    if (!r.ok) return res.status(502).json({ error: "send-failed", message: r.error || "" });
    const d = (await ref.get()).data() || {};
    const done = new Set(d.sentTo || []);
    return res.status(200).json({ ok: true, test: true, to, total: recipients.length, alreadySent: recipients.filter((x) => done.has(x.email)).length });
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
    const recipients = founders(await loadMailRecipients(db));
    const done = new Set(lock.sentTo);
    const todo = recipients.filter((r) => !done.has(r.email));
    const mail = composeFounderSessionEmail();
    // Keyed on how many had already gone out: a retried request repeats the
    // same key (Resend answers it without sending again), a later resume doesn't.
    const result = todo.length
      ? await sendEmailBatch(todo.map((r) => ({ to: r.email, ...mail })), { idempotencyKey: `brandlab-founder-session-${done.size}` })
      : { ok: true, sent: 0 };
    const newlySent = todo.slice(0, result.sent).map((r) => r.email);
    const sentTotal = recipients.filter((r) => done.has(r.email)).length + newlySent.length;
    await ref.set({
      ...(newlySent.length ? { sentTo: FieldValue.arrayUnion(...newlySent) } : {}),
      total: recipients.length,
      updatedAt: Date.now(),
      runningAt: null,
      lastError: result.ok ? null : String(result.error || "").slice(0, 200),
    }, { merge: true });
    if (!result.sent && todo.length) return res.status(502).json({ error: "send-failed", message: result.error || "", total: recipients.length, remaining: todo.length });
    return res.status(200).json({ ok: true, sent: result.sent, total: recipients.length, sentTotal, remaining: recipients.length - sentTotal, partial: !result.ok, message: result.ok ? "" : result.error || "" });
  } catch (err) {
    console.error("[announcements/founder-session] failed", err?.message);
    await ref.set({ runningAt: null }, { merge: true }).catch(() => {});
    return res.status(500).json({ error: "failed" });
  }
}
