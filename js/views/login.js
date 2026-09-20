import { login, loginWithGoogle, resetPassword, authErrorMessage, NEW_GOOGLE_ACCOUNT } from "../auth.js";
import { icon } from "../icons.js";
import { qs, toast, passwordFieldHTML, wirePasswordToggles } from "../dom.js";
import { unlockPaywall } from "../paywall.js";
import { t } from "../i18n.js";
import { WEPEKA_CONNECT_URL } from "../site-links.js";

const friendlyAuthError = (err) => authErrorMessage(err, "auth.err.generic");

const GOOGLE_G_SVG = `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.85-.08-1.67-.22-2.45H12v4.63h6.46c-.28 1.5-1.13 2.77-2.4 3.63v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1C3.24 21.3 7.27 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.3A7.2 7.2 0 014.9 12c0-.8.14-1.57.37-2.3v-3.1H1.27A12 12 0 000 12c0 1.94.46 3.77 1.27 5.4z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.27 0 3.24 2.7 1.27 6.6l4 3.1C6.22 6.86 8.87 4.75 12 4.75z"/></svg>`;

// Account creation happens exclusively on wepeka.com now (see auth.js) — this
// screen only signs people into a Brandlab account that already exists:
// the Wepeka SSO handoff (primary path), Google, or email + password for
// anyone whose credentials were mirrored from wepeka.com or set up before
// this change. There is no "mode" anymore — one screen, login only.
export function renderAuthScreen(root) {
  function paint() {
    root.innerHTML = `
      <div class="auth-shell">
        <div class="auth-card">
          <a class="icon-btn auth-close" href="https://wepeka.com" target="_blank" rel="noopener noreferrer" title="${t("auth.closeTitle")}" aria-label="${t("auth.closeTitle")}">${icon("x", { size: 15 })}</a>
          <div class="brand-mark" style="justify-content:center;margin-bottom:26px;">
            <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
            <span class="brand-mark-divider"></span>
            Brandlab
          </div>
          <h1 class="auth-title">${t("auth.login.title")}</h1>
          <p class="page-sub" style="margin:8px 0 22px;">${t("auth.login.sub")}</p>

          <a class="btn btn-primary btn-block auth-wepeka-btn" href="${WEPEKA_CONNECT_URL}">
            ${t("auth.wepeka.login")}
          </a>
          <p class="auth-wepeka-note">${t("auth.wepeka.note")}</p>
          <div class="auth-divider"><span>${t("auth.or")}</span></div>
          <button type="button" class="btn btn-secondary btn-block" id="google-btn" style="margin-bottom:14px;gap:8px;">${GOOGLE_G_SVG}${t("auth.google.login")}</button>

          <form id="auth-form" novalidate>
            <div class="field">
              <label for="auth-email">${t("auth.field.email")}</label>
              <input class="input" id="auth-email" type="email" autocomplete="username" />
            </div>
            <div class="field" style="margin-bottom:6px;">
              <label for="auth-password">${t("auth.field.password")}</label>
              ${passwordFieldHTML("auth-password", { autocomplete: "current-password" })}
            </div>
            <div id="auth-error" class="auth-error" style="display:none;"></div>
            <button type="submit" class="btn btn-secondary btn-block" style="margin-top:10px;">
              ${icon("arrowRight", { size: 15 })}${t("auth.login.cta")}
            </button>
          </form>
          <p class="hint" style="margin-top:18px;text-align:center;">
            ${t("auth.noAccount")} <a href="${WEPEKA_CONNECT_URL}" style="color:var(--accent);">${t("auth.wepeka.registerCta")}</a>
            · <a href="#" id="forgot-link" style="color:var(--accent);">${t("auth.forgot")}</a>
          </p>
        </div>
      </div>
    `;

    const form = qs("#auth-form", root);
    const errorEl = qs("#auth-error", root);
    const submitBtn = form.querySelector("button[type=submit]");
    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    };
    const hideError = () => { errorEl.style.display = "none"; };

    // Firebase collapses "no such user" and "wrong password" into the same
    // generic auth/invalid-credential code — this screen is also the ONLY
    // way in for someone whose real account lives on wepeka.com (Google, or
    // an email/password set up over there), so a plain "wrong password"
    // leaves them with no next step. Point at the other two ways in that
    // are already right there on this same screen.
    const AMBIGUOUS_CREDENTIAL_CODES = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"];

    async function runAuth(action) {
      submitBtn.disabled = true;
      try {
        await action();
        unlockPaywall();
        // onAuthChange in main.js picks up the new signed-in state and
        // re-renders (ensureAccountDoc() is a no-op for an existing account).
      } catch (err) {
        showError(AMBIGUOUS_CREDENTIAL_CODES.includes(err?.code) ? t("auth.err.wrongCredentialsHint") : friendlyAuthError(err));
      } finally {
        submitBtn.disabled = false;
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError();
      const email = qs("#auth-email", root).value.trim();
      const password = qs("#auth-password", root).value;
      if (!email || !password) return showError(t("auth.needBoth"));
      await runAuth(() => login(email, password));
    });

    qs("#google-btn", root).addEventListener("click", async () => {
      hideError();
      try {
        await loginWithGoogle();
        unlockPaywall();
      } catch (err) {
        if (err?.code === NEW_GOOGLE_ACCOUNT) {
          toast(t("auth.google.needWepeka"), "error");
          location.href = WEPEKA_CONNECT_URL;
          return;
        }
        showError(friendlyAuthError(err));
      }
    });

    qs("#forgot-link", root)?.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = qs("#auth-email", root).value.trim();
      if (!email) return showError(t("auth.forgotNeedEmail", { forgot: t("auth.forgot") }));
      try {
        await resetPassword(email);
        toast(t("auth.resetSent", { email }));
      } catch (err) {
        showError(friendlyAuthError(err));
      }
    });

    wirePasswordToggles(root);
    setTimeout(() => qs("#auth-email", root)?.focus(), 30);
  }

  paint();
}
