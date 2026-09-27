// Minimal stand-in for https://www.gstatic.com/firebasejs/*/firebase-app.js
// Only what js/firebase.js actually imports: initializeApp().
export function initializeApp(config) {
  return { name: "[DEFAULT]", options: { ...config } };
}
