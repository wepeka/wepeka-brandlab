import { login, resetPassword } from "../auth.js";
import { icon } from "../icons.js";
import { qs, toast } from "../dom.js";

const ERROR_MESSAGES = {
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/too-many-requests": "Too many attempts — wait a bit and try again.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/network-request-failed": "Couldn't reach the server — check your connection.",
};
function friendlyAuthError(err) {
  return ERROR_MESSAGES[err?.code] || err?.message || "Couldn't log in.";
}

export function renderAuthScreen(root) {
  root.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <a class="icon-btn auth-close" href="https://wepeka.com" target="_blank" rel="noopener noreferrer" title="Back to wepeka.com" aria-label="Back to wepeka.com">${icon("x", { size: 15 })}</a>
        <div class="brand-mark" style="justify-content:center;margin-bottom:26px;">
          <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
          <span class="brand-mark-divider"></span>
          Brandlab
        </div>
        <h1 class="auth-title">Welcome back</h1>
        <p class="page-sub" style="margin:8px 0 26px;">Log in to continue to your brands.</p>
        <form id="auth-form" novalidate>
          <div class="field">
            <label>Email</label>
            <input class="input" id="auth-email" type="email" autocomplete="username" />
          </div>
          <div class="field" style="margin-bottom:6px;">
            <label>Password</label>
            <input class="input" id="auth-password" type="password" autocomplete="current-password" />
          </div>
          <div id="auth-error" class="auth-error" style="display:none;"></div>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:10px;">
            ${icon("arrowRight", { size: 15 })}Log In
          </button>
        </form>
        <p class="hint" style="margin-top:18px;text-align:center;">
          <a href="#" id="forgot-link" style="color:var(--accent);">Forgot password?</a>
        </p>
      </div>
    </div>
  `;

  const form = qs("#auth-form");
  const errorEl = qs("#auth-error");

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    const email = qs("#auth-email").value.trim();
    const password = qs("#auth-password").value;
    if (!email || !password) return showError("Enter your email and password.");

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await login(email, password);
      // onAuthChange in main.js picks up the new signed-in state and
      // re-renders — nothing else to do here on success.
    } catch (err) {
      showError(friendlyAuthError(err));
    } finally {
      btn.disabled = false;
    }
  });

  qs("#forgot-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const email = qs("#auth-email").value.trim();
    if (!email) return showError("Enter your email above first, then click \"Forgot password?\" again.");
    try {
      await resetPassword(email);
      toast(`Password reset email sent to ${email}`);
    } catch (err) {
      showError(friendlyAuthError(err));
    }
  });

  setTimeout(() => qs("#auth-email")?.focus(), 30);
}
