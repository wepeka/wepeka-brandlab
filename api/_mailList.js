// Who Brandlab's admin emails go to (an announcement, the WhatsApp group
// invite): announcementRecipients (api/_community.js) over every active
// account, minus those who turned these emails off. accounts/{uid}.email is
// written by the server; an older doc without one falls back to its
// Firebase Auth address. → [{ uid, email, circle }]
import { getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { announcementRecipients } from "./_community.js";

export async function loadMailRecipients(db) {
  const [accountsSnap, offSnap] = await Promise.all([
    db.collection("accounts").where("status", "==", "active").get(),
    db.collection("settings").where("updatesEmailOff", "==", true).get(),
  ]);
  const optedOut = new Set(offSnap.docs.map((d) => d.id));
  const accounts = accountsSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const missing = accounts.filter((a) => !a.email && !optedOut.has(a.uid)).slice(0, 300);
  if (missing.length) {
    const auth = getAuth(getApps()[0]);
    for (let i = 0; i < missing.length; i += 100) {
      const found = await auth.getUsers(missing.slice(i, i + 100).map((a) => ({ uid: a.uid }))).catch(() => ({ users: [] }));
      const byUid = new Map(found.users.map((u) => [u.uid, u.email || ""]));
      missing.slice(i, i + 100).forEach((a) => { a.email = byUid.get(a.uid) || ""; });
    }
  }
  return announcementRecipients(accounts, optedOut);
}
