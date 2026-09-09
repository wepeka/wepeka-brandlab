// Thin wrapper over Firebase Authentication. One shared login is enough for
// now (the whole team signs in with the same admin account) — this file
// doesn't care how many Firebase Auth users exist, it just reflects
// whatever account is currently signed in.
import { auth } from "./firebase.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Fires once immediately with the current auth state, then again on every
// sign-in/sign-out — main.js drives its whole boot sequence off this.
export function onAuthChange(fn) {
  return onAuthStateChanged(auth, fn);
}
export function isLoggedIn() {
  return !!auth.currentUser;
}
export function getUserEmail() {
  return auth.currentUser?.email || "";
}
export async function login(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function logout() {
  await signOut(auth);
}
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}
