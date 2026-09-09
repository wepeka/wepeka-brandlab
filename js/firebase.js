// Shared cloud backend for Wepeka Brandlab — Firestore (data) + Auth (login).
// Images stay embedded as base64 directly in Firestore documents (no
// Firebase Storage) since Storage now requires a billing card attached,
// even for free-tier usage — this keeps setup 100% free/no-card-required.
// This config object is NOT a secret like the
// Anthropic/Gemini keys elsewhere in this app: Firebase's web config is a
// public client identifier by design. Real access control lives entirely in
// firestore.rules / storage.rules (requires a logged-in user), not in
// hiding this object — safe to commit as-is.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcApVGM0CyxfcTERsrwr7CK07YWlQT_vI",
  authDomain: "wepeka-ba996.firebaseapp.com",
  projectId: "wepeka-ba996",
  storageBucket: "wepeka-ba996.firebasestorage.app",
  messagingSenderId: "494668744644",
  appId: "1:494668744644:web:e4bdc9aea34800849f0691",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
