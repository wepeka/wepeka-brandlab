// Thin wrapper over Firebase Authentication. Originally one shared login
// for the whole internal team; account creation now happens exclusively on
// wepeka.com (Community signup, mirrored into Firebase, or the SSO custom
// token minted by /brandlab/connect) — this file only signs people into
// Firebase Auth users that already exist, it never creates new ones.
import { auth } from "./firebase.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup, getAdditionalUserInfo, signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { t } from "./i18n.js";

// Firebase Auth error code -> i18n key for a message worth showing a user.
const AUTH_ERROR_KEYS = {
  "auth/wrong-password": "auth.err.wrongCredentials",
  "auth/invalid-credential": "auth.err.wrongCredentials",
  "auth/user-not-found": "auth.err.wrongCredentials",
  "auth/invalid-email": "auth.err.invalidEmail",
  "auth/missing-email": "auth.err.invalidEmail",
  "auth/too-many-requests": "auth.err.tooMany",
  "auth/user-disabled": "auth.err.disabled",
  "auth/network-request-failed": "auth.err.network",
  "auth/popup-closed-by-user": "auth.err.popupClosed",
  "auth/cancelled-popup-request": "auth.err.popupClosed",
  "auth/popup-blocked": "auth.err.popupBlocked",
};
// Not a Firebase code — our own marker for loginWithGoogle() rejecting a
// Google account that has no matching Brandlab account yet (see below).
export const NEW_GOOGLE_ACCOUNT = "brandlab/new-google-account";
// Localized message for a Firebase Auth error. Unknown codes fall back to
// `fallbackKey` with the raw code appended, so support can still tell what
// went wrong without showing Firebase's English text.
export function authErrorMessage(err, fallbackKey = "auth.err.generic") {
  const key = AUTH_ERROR_KEYS[err?.code];
  if (key) return t(key);
  return err?.code ? `${t(fallbackKey)} (${err.code})` : t(fallbackKey);
}

// Fires once immediately with the current auth state, then again on every
// sign-in/sign-out — main.js drives its whole boot sequence off this.
export function onAuthChange(fn) {
  return onAuthStateChanged(auth, fn);
}
export function getUserEmail() {
  return auth.currentUser?.email || "";
}
export async function login(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
// Signing in with a token minted by wepeka.com for the same person (see
// js/site-links.js). Firebase verifies the signature against the Brandlab
// project's own service account, so only the site can issue these.
export async function loginWithWepekaToken(token) {
  await signInWithCustomToken(auth, token);
}

const googleProvider = new GoogleAuthProvider();
// Google sign-in normally creates a brand-new Firebase user the first time
// a given Google account is seen — that would let anyone skip wepeka.com
// registration entirely by just picking "Log in with Google" here. So: if
// the popup just created a new user, undo it and reject with
// NEW_GOOGLE_ACCOUNT instead of letting it through. Existing accounts
// (created via wepeka.com SSO, or a Google sign-in from before this check
// existed) are unaffected.
export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  if (getAdditionalUserInfo(result)?.isNewUser) {
    // Delete, not just sign out — a bare signOut would leave an orphan
    // Firebase user permanently squatting this email with no matching
    // account, forever. That would break wepeka.com's own sign-up for the
    // same address later (getUserByEmail finds this dead user instead of
    // creating the real one) and any later Google sign-in attempt here.
    await result.user.delete();
    const err = new Error("New Google account, no matching Brandlab account");
    err.code = NEW_GOOGLE_ACCOUNT;
    throw err;
  }
}
export async function logout() {
  await signOut(auth);
}
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}
