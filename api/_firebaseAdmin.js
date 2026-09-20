// Shared Firebase Admin SDK init for every function under /api. Unlike the
// client's js/firebase.js, this holds real elevated credentials (a service
// account) and must never be imported by anything shipped to the browser —
// only files under /api (Vercel serverless, server-only) import this.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function adminApp() {
  if (getApps().length) return getApps()[0];
  return initializeApp({
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
