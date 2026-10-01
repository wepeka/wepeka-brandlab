// Minimal stand-in for https://www.gstatic.com/firebasejs/*/firebase-auth.js
// js/firebase.js only needs getAuth(); the rest are the names js/auth.js
// imports, so modules that pull it in (js/views/pricing.js, for the
// pricing-page render test) can load. Nothing here drives real auth — the
// sign-in calls just refuse.
export function getAuth(app) {
  return { app, currentUser: null };
}
const offline = async () => {
  throw new Error("firebase-auth stub: no sign-in in tests");
};
export const signInWithEmailAndPassword = offline;
export const signInWithPopup = offline;
export const signInWithCustomToken = offline;
export const sendPasswordResetEmail = offline;
export async function signOut() {}
export function onAuthStateChanged(_auth, fn) {
  fn(null);
  return () => {};
}
export function getAdditionalUserInfo() {
  return null;
}
export class GoogleAuthProvider {}
