// ONE-TIME migration — run this yourself, once, before deploying the new
// firestore.rules. It backfills `ownerId` on every existing brands/content/
// campaigns/routineTemplate doc (today they have none — see js/store.js's
// history) so they don't become invisible/orphaned under the new per-owner
// security rules, and it copies the old shared settings/main doc to
// settings/{uid} for that same account.
//
// This does NOT run automatically and nobody but you should run it against
// production data. It only ever merges an `ownerId` field onto existing
// docs — it never rewrites or deletes any existing field, so brands like
// "Pinter Mandarin" that must stay untouched are not touched beyond gaining
// that one new field.
//
// Usage:
//   node scripts/migrate-ownerid.mjs path/to/serviceAccountKey.json [--dry-run] [--uid=<uid>]
//
// Get the service account key from Firebase Console → Project Settings →
// Service Accounts → Generate new private key (wepeka-ba996 project).
//
// If you don't pass --uid, the script lists every Firebase Auth user and
// only proceeds automatically if there is EXACTLY ONE (today's "whole team
// shares one login" setup) — otherwise it prints the list and asks you to
// re-run with --uid=<the internal team's uid>.

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
const keyPath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const uidArg = args.find((a) => a.startsWith("--uid="))?.split("=")[1];

if (!keyPath) {
  console.error("Usage: node scripts/migrate-ownerid.mjs path/to/serviceAccountKey.json [--dry-run] [--uid=<uid>]");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

// The existing internal team account should have no artificial brand cap —
// far above the default (3) new paying customers get.
const INTERNAL_BRAND_LIMIT = 999;

async function resolveUid() {
  if (uidArg) return uidArg;
  const list = await auth.listUsers(1000);
  if (list.users.length === 1) return list.users[0].uid;
  console.log(`Found ${list.users.length} Firebase Auth users — re-run with --uid=<one of these>:`);
  list.users.forEach((u) => console.log(`  ${u.uid}  ${u.email || "(no email)"}`));
  process.exit(1);
}

async function backfillCollection(name, uid) {
  const snap = await db.collection(name).get();
  let touched = 0;
  for (const doc of snap.docs) {
    if (doc.data().ownerId) continue; // already migrated, don't re-touch
    touched++;
    if (!dryRun) await doc.ref.update({ ownerId: uid });
  }
  console.log(`${name}: ${touched}/${snap.size} doc(s) ${dryRun ? "would be" : ""} tagged ownerId=${uid}`);
}

async function main() {
  const uid = await resolveUid();
  const user = await auth.getUser(uid);
  console.log(`Migrating existing data to uid=${uid} (${user.email || "no email"})${dryRun ? " [DRY RUN]" : ""}`);

  for (const col of ["brands", "content", "campaigns", "routineTemplate"]) {
    await backfillCollection(col, uid);
  }

  const accountRef = db.doc(`accounts/${uid}`);
  const accountSnap = await accountRef.get();
  if (!accountSnap.exists) {
    console.log(`accounts/${uid}: creating (plan=lifetime, brandLimit=${INTERNAL_BRAND_LIMIT})`);
    if (!dryRun) {
      await accountRef.set({
        uid, email: user.email || "", displayName: user.displayName || "",
        createdAt: Date.now(), plan: "lifetime", status: "active",
        brandLimit: INTERNAL_BRAND_LIMIT, subscriptionExpiresAt: null, paidAt: Date.now(),
      });
    }
  } else {
    console.log(`accounts/${uid}: already exists, leaving as-is`);
  }

  const oldSettingsRef = db.doc("settings/main");
  const oldSettingsSnap = await oldSettingsRef.get();
  const newSettingsRef = db.doc(`settings/${uid}`);
  const newSettingsSnap = await newSettingsRef.get();
  if (oldSettingsSnap.exists && !newSettingsSnap.exists) {
    console.log(`settings/${uid}: copying from settings/main`);
    if (!dryRun) await newSettingsRef.set(oldSettingsSnap.data());
  } else {
    console.log(`settings/${uid}: ${newSettingsSnap.exists ? "already exists" : "no settings/main to copy"}, leaving as-is`);
  }

  console.log(dryRun ? "\nDry run complete — nothing was written. Re-run without --dry-run to apply." : "\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
