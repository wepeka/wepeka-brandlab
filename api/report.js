// "Laporkan masalah": a signed-in user tells the Wepeka team what went wrong
// (js/report-problem.js). Stored in Firestore `problemReports/{id}` (plus
// `…/files/screenshot` when one was attached) with the
// Admin SDK — the client never reads or writes that collection, so no
// Firestore rule exposes it — and handled in the Wepeka admin (wpk-dp →
// Brandlab → Laporan Masalah). Who sent it comes from the verified ID token
// and the account doc, never from the body.
import { adminDb, requireAuth } from "./_firebaseAdmin.js";
import { ADMIN_UIDS } from "./_aiQuota.js";
import { normalizeReport, tooManyReports, composeReportPush } from "./_report.js";
import { APP_URL, normalizeReminders, deliverPush, webPushSender } from "./_reminders.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  let token;
  try {
    token = await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  const uid = token.uid;
  const parsed = normalizeReport(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const db = adminDb();
  const col = db.collection("problemReports");
  try {
    // One equality filter (no composite index); the day's count is worked
    // out here from the timestamps.
    const mine = await col.where("uid", "==", uid).select("createdAt").limit(200).get();
    if (tooManyReports(mine.docs.map((d) => d.data().createdAt))) return res.status(429).json({ error: "too-many" });

    const account = (await db.doc(`accounts/${uid}`).get()).data() || {};
    const now = Date.now();
    const ref = col.doc();
    // The screenshot lives in its own small doc (problemReports/{id}/files/
    // screenshot), so listing reports in the admin never drags images along.
    const { screenshot, ...fields } = parsed.report;
    const report = {
      ...fields,
      hasScreenshot: Boolean(screenshot),
      id: ref.id,
      uid,
      email: String(account.email || token.email || "").slice(0, 254),
      name: String(account.displayName || token.name || "").slice(0, 120),
      plan: String(account.plan || "").slice(0, 40),
      accountStatus: String(account.status || "").slice(0, 40),
      state: "new",
      adminNote: "",
      createdAt: now,
      updatedAt: now,
    };
    const batch = db.batch();
    batch.set(ref, report);
    if (screenshot) batch.set(ref.collection("files").doc("screenshot"), { data: screenshot, createdAt: now });
    await batch.commit();
    // The team's own devices hear about it at once (when they turned push
    // reminders on). Never fails the report.
    await notifyTeam(db, report).catch((err) => console.error("[report] push failed", err?.message));
    return res.status(200).json({ ok: true, id: ref.id });
  } catch (err) {
    console.error("[report] save failed", uid, err?.message);
    return res.status(500).json({ error: "failed" });
  }
}

async function notifyTeam(db, report) {
  const send = await webPushSender();
  if (!send) return;
  const payload = composeReportPush(report, APP_URL);
  for (const adminUid of ADMIN_UIDS) {
    if (adminUid === report.uid) continue;
    const rem = normalizeReminders((await db.doc(`settings/${adminUid}`).get()).data()?.reminders);
    if (rem.push.length) await deliverPush(rem.push, payload, (sub, body) => send(sub, body, { ttl: 6 * 60 * 60 }));
  }
}
