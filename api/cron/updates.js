// Update Brandlab, posted and mailed by itself (api/_updates.js says why
// and how). Vercel calls this every 10 minutes (vercel.json `crons`, so
// production only — a preview deploy never posts); CRON_SECRET guards it.
//
//   1. Posts each new UPDATES entry to Pengumuman (announcements/upd-<id>)
//      and refreshes a post whose entry changed.
//   2. Between 09.00 and 20.00 WIB, at most once a day: one email with
//      every update post nobody was mailed yet, to every active account
//      that hasn't turned announcement emails off (api/_mailList.js).
//      Resumable like the WhatsApp invite: who got it is kept on
//      mailings/updates-digest, at most MAIL_DAILY a day, the rest the
//      next day; a lock stops two runs at once.
//
// GET ?dryRun=1 → what it would do, nothing written or sent.
import { adminDb } from "../_firebaseAdmin.js";
import { emailConfigured, sendEmailBatch } from "../_email.js";
import { composeUpdatesEmail } from "../_community.js";
import { loadMailRecipients } from "../_mailList.js";
import { UPDATES, docIdOf, planUpdatePosts, digestStep, wibDay } from "../_updates.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = { maxDuration: 60 };

const STATE = "mailings/updates-digest";
const LOCK_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dry = req.query?.dryRun === "1";
  const db = adminDb();
  const now = Date.now();
  const out = { posted: [], changed: [], mail: null };

  // ---- 1. Pengumuman ----
  try {
    const refs = UPDATES.map((u) => db.doc(`announcements/${docIdOf(u)}`));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    const existing = Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    const plan = planUpdatePosts(UPDATES, existing, now);
    out.posted = plan.create.map((x) => x.id);
    out.changed = plan.change.map((x) => x.id);
    if (!dry && (plan.create.length || plan.change.length)) {
      const batch = db.batch();
      // create() refuses a doc that appeared meanwhile: never posted twice.
      plan.create.forEach(({ id, data }) => batch.create(db.doc(`announcements/${id}`), data));
      plan.change.forEach(({ id, patch }) => batch.update(db.doc(`announcements/${id}`), patch));
      await batch.commit();
    }
  } catch (err) {
    console.error("[cron/updates] post failed", err?.message);
    return res.status(500).json({ error: "post-failed" });
  }

  // ---- 2. The email ----
  if (!emailConfigured()) return res.status(200).json({ ok: true, ...out, mail: "email-off" });
  const ref = db.doc(STATE);
  try {
    const unmailedSnap = await db.collection("announcements").where("source", "==", "updates").get();
    const unmailed = unmailedSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => !a.emailedAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const state = (await ref.get()).data() || {};
    const step = digestStep(state, unmailed, now);
    out.mail = step;
    if (step.mode === "none" || dry) return res.status(200).json({ ok: true, ...out, unmailed: unmailed.map((a) => a.id) });

    const lock = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data() || {};
      if (d.runningAt && now - d.runningAt < LOCK_MS) return { busy: true };
      tx.set(ref, { runningAt: now }, { merge: true });
      return { ok: true };
    });
    if (lock.busy) return res.status(200).json({ ok: true, ...out, mail: "busy" });

    const today = wibDay(now);
    let ids = state.ids || [];
    let sentTo = state.sentTo || [];
    if (step.mode === "start") {
      ids = unmailed.map((a) => a.id);
      sentTo = [];
      // Claimed: the admin's "Kirim lewat email" on these posts goes away.
      const batch = db.batch();
      ids.forEach((id) => batch.update(db.doc(`announcements/${id}`), { emailedAt: now }));
      await batch.commit();
      await ref.set({ day: today, ids, sentTo: [], total: null, startedAt: now, lastError: null }, { merge: true });
    }
    const posts = (await db.getAll(...ids.map((id) => db.doc(`announcements/${id}`)))).filter((s) => s.exists).map((s) => s.data());
    const recipients = await loadMailRecipients(db);
    const done = new Set(sentTo);
    const todo = recipients.filter((r) => !done.has(r.email));
    const sendNow = todo.slice(0, step.budget);
    const mail = composeUpdatesEmail(posts);
    // Keyed on the digest's day and how many already had it: a retry repeats
    // the key (Resend doesn't send again), the next day's resume doesn't.
    const digestDay = step.mode === "start" ? today : state.day;
    const result = sendNow.length && posts.length
      ? await sendEmailBatch(sendNow.map((r) => ({ to: r.email, ...mail })), { idempotencyKey: `brandlab-upd-${digestDay}-${done.size}` })
      : { ok: true, sent: 0 };
    const newly = sendNow.slice(0, result.sent).map((r) => r.email);
    const usedToday = state.sentToday?.day === today ? state.sentToday.n || 0 : 0;
    await ref.set({
      ...(newly.length ? { sentTo: FieldValue.arrayUnion(...newly) } : {}),
      // Who had it plus who is still on the list (someone who turned the
      // emails off meanwhile drops out, so the digest still finishes).
      total: done.size + todo.length,
      sentToday: { day: today, n: usedToday + newly.length },
      updatedAt: Date.now(),
      runningAt: null,
      lastError: result.ok ? null : String(result.error || "").slice(0, 200),
    }, { merge: true });
    // How far the email got, on each post it carries (the admin's line
    // "Sudah dikirim lewat email ke N pengguna" on Pengumuman).
    if (newly.length || step.mode === "start") {
      const batch = db.batch();
      ids.forEach((id) => batch.set(db.doc(`announcements/${id}`), { emailed: { sent: done.size + newly.length, total: done.size + todo.length, at: Date.now(), digest: true } }, { merge: true }));
      await batch.commit();
    }
    out.mail = { ...step, posts: posts.length, sent: result.sent, remaining: todo.length - newly.length, ...(result.ok ? {} : { error: String(result.error || "") }) };
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    console.error("[cron/updates] mail failed", err?.message);
    await ref.set({ runningAt: null }, { merge: true }).catch(() => {});
    return res.status(500).json({ error: "mail-failed", ...out });
  }
}
