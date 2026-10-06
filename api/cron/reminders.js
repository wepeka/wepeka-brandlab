// Daily upload reminders (see vercel.json's `crons`: 00:00 UTC = 07:00 WIB).
// For every owner who turned on push and/or email in Settings → Pengingat
// and has something scheduled today: ONE push (to each of their devices)
// and/or ONE email listing today's uploads. Mondays add last week's recap.
// settings/{uid}.reminders.lastSentDate keeps a retried run from sending
// twice. Owners who never opted in are never read past their settings doc.
// All logic lives in api/_reminders.js (tested); this file only wires the
// real Firestore, web-push and Resend into it.
//
// Same guard as check-expiry: CRON_SECRET must be set AND match. ?dryRun=1
// reports who would be notified without sending or writing anything.
import { FieldValue } from "firebase-admin/firestore";
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "../_firebaseAdmin.js";
import { isReadOnlyAccount } from "../_aiQuota.js";
import { runDailyReminders, webPushSender } from "../_reminders.js";
import { sendEmail, emailConfigured } from "../_email.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = adminDb();
  const sendPush = await webPushSender();
  const summary = await runDailyReminders({
    db,
    sendPush,
    sendEmail: emailConfigured() ? (msg) => sendEmail(msg) : null,
    accountActive: (account) => account?.status === "active" && !isReadOnlyAccount(account),
    // accounts/{uid}.email is written by the server (wpk-dp / the Midtrans
    // webhook), so it's the owner's real address; Firebase Auth is the fallback.
    accountEmail: async (uid, account) => account?.email || (await getAuth(getApps()[0]).getUser(uid).catch(() => null))?.email || "",
    arrayRemove: (...values) => FieldValue.arrayRemove(...values),
    dryRun: req.query?.dryRun === "1",
  });
  return res.status(200).json({ ok: true, ...summary });
}
