// Shared Firebase Admin SDK init for every function under /api. Unlike the
// client's js/firebase.js, this holds real elevated credentials (a service
// account) and must never be imported by anything shipped to the browser —
// only files under /api (Vercel serverless, server-only) import this.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

// Local dev only (scripts/dev-api.mjs): the Admin SDK talks to the Firebase
// Emulator Suite on its own once FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST are set, and needs no service account there.
// All three conditions must hold — an explicit flag, both emulator hosts and
// a demo-* project (never a real one) — so a stray variable on Vercel can't
// switch production to it.
export function emulatorProjectId(env = process.env) {
  if (env.BRANDLAB_EMULATOR !== "1") return null;
  const project = env.GCLOUD_PROJECT || env.FIREBASE_ADMIN_PROJECT_ID || "";
  if (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST || !project.startsWith("demo-")) {
    throw new Error("BRANDLAB_EMULATOR=1 needs FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST and a demo-* project");
  }
  return project;
}

function adminApp() {
  if (getApps().length) return getApps()[0];
  const emulatorProject = emulatorProjectId();
  if (emulatorProject) {
    const rtdbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    return initializeApp({ projectId: emulatorProject, ...(rtdbHost ? { databaseURL: `http://${rtdbHost}?ns=${emulatorProject}` } : {}) });
  }
  return initializeApp({
    // Kerja Tim (Realtime Database): set once the database exists.
    ...(process.env.FIREBASE_DATABASE_URL ? { databaseURL: process.env.FIREBASE_DATABASE_URL } : {}),
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      // Vercel env vars can't hold real newlines — the key is stored with
      // literal "\n" sequences and unescaped here.
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

export function adminDb() {
  return getFirestore(adminApp());
}

export function adminAuth() {
  return getAuth(adminApp());
}

// Kerja Tim: the Realtime Database, or null where it isn't set up (the live
// project until it's created) — callers then skip what they'd write there.
export function adminRtdb() {
  const app = adminApp();
  if (!app.options?.databaseURL) return null;
  return getDatabase(app);
}

// The Firebase Auth record behind a uid (email, display name), for when a
// sign-in token doesn't carry them itself.
export function authUser(uid) {
  return getAuth(adminApp()).getUser(uid);
}

// A "lupa password" link for this email (api/auth-email.js mails it itself).
// Throws auth/email-not-found when no account has it.
export function passwordResetLink(email, continueUrl) {
  return getAuth(adminApp()).generatePasswordResetLink(email, { url: continueUrl });
}

// Verifies the caller's Firebase ID token from the Authorization header and
// returns its decoded claims (including `uid`). Endpoints that must act on
// behalf of a specific account (payments, above all) call this instead of
// trusting a uid the client put in the request body — a body field is just
// something the browser typed, not proof of who is asking.
export async function requireAuth(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!match) {
    const err = new Error("Missing bearer token");
    err.status = 401;
    throw err;
  }
  try {
    return await getAuth(adminApp()).verifyIdToken(match[1]);
  } catch (cause) {
    const err = new Error("Invalid or expired token");
    err.status = 401;
    err.cause = cause;
    throw err;
  }
}
