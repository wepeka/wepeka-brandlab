// Minimal stand-in for https://www.gstatic.com/firebasejs/*/firebase-auth.js
// Only what js/firebase.js actually imports: getAuth(). Nothing in the
// tested modules (store.js pure helpers + in-memory flow) drives real
// auth, so this just needs to exist and not throw.
export function getAuth(app) {
  return { app, currentUser: null };
}
