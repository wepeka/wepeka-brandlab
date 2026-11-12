// #/undangan/<token> — the page a team invite link opens (Kerja Tim). Shows
// who invites, which brands and which role (api/team.js "preview"), then
// lets the invited person in: Google, email + password, or a new account
// made with a 6-digit code sent to the invited email. Accepting is the
// server's job and only works for that email, verified. Once accepted the
// person goes straight into the brand (main.js "team:joined") — no page in
// between. Same card as the login screen (css/auth.css).
//
// The state lives here, per token, outside the DOM: signing in in the
// middle of the flow makes main.js render this page again into a new
// element, which then shows where the flow is (flow.root is always the
// element on screen, so a sign-in that finishes later paints there too).
import { auth } from "../firebase.js";
import { login, loginWithGoogle, logout } from "../auth.js";
import { teamApi } from "../team.js";
import { icon } from "../icons.js";
import { qs, escapeHtml, passwordFieldHTML, wirePasswordToggles } from "../dom.js";
import { t } from "../i18n.js";
import { GOOGLE_G_SVG } from "./login.js";

const flows = new Map();
export function inviteTokenFromHash(hash = location.hash) {
  const m = /^#\/undangan\/([^/?#]+)/.exec(hash || "");
  return m ? decodeURIComponent(m[1]) : null;
}

function errorText(code, flow) {
  const key = `invite.err.${code}`;
  const text = t(key, { email: flow.preview?.emailMasked || "", me: escapeHtml(auth.currentUser?.email || "") });
  return text === key ? t("team.err.generic") : text;
}

// One controller per invite token: its state and the functions that paint
// it, whichever element is on screen now.
function flowFor(token) {
  if (flows.has(token)) return flows.get(token);
  const flow = { step: "loading", preview: null, error: null, busy: false, email: "", name: "", password: "", root: null, loaded: false };
  flows.set(token, flow);

  const card = (inner) => `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="brand-mark" style="justify-content:center;margin-bottom:22px;">
          <span class="brand-logo" role="img" aria-label="Wepeka"></span><span class="brand-mark-divider"></span>Brandlab
        </div>
        ${inner}
      </div>
    </div>`;
  // The brands and the role on each ("Kopi Pagi · sebagai Editor").
  const brandsHTML = (p) => {
    const list = p.brands?.length ? p.brands : (p.brandNames || []).map((name) => ({ name, role: p.role }));
    return `<div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:4px 14px;margin-bottom:16px;">
      ${list.map((b) => `<div class="list-editor-row" style="border:0;padding:8px 0;"><span class="row-label">${escapeHtml(b.name)}<br><span class="text-faint" style="font-weight:500;">${t("invite.as", { role: t(`team.role.${b.role}`) })}</span></span></div>`).join("")}
    </div>`;
  };

  const paint = () => {
    const root = flow.root;
    if (!root?.isConnected) return;
    const p = flow.preview;
    const me = auth.currentUser;
    const err = flow.error ? `<div class="auth-error" style="margin:0 0 14px;">${flow.error}</div>` : "";
    const head = p ? `
      <h1 class="auth-title">${escapeHtml(t("invite.title", { owner: p.ownerName || "" }))}</h1>
      <p class="page-sub" style="margin:8px 0 16px;">${t("invite.sub")}</p>
      ${brandsHTML(p)}` : "";

    let html = "";
    if (flow.step === "loading") {
      html = card(`<p class="page-sub" style="text-align:center;">…</p>`);
    } else if (flow.step === "joining") {
      html = card(`
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:6px 0 4px;text-align:center;">
          <span class="spinner" style="width:26px;height:26px;border-width:3px;"></span>
          <h1 class="auth-title" style="margin:0;">${escapeHtml(t("invite.joining", { brand: p?.brandNames?.[0] || "Brandlab" }))}</h1>
          <p class="page-sub" style="margin:0;">${escapeHtml(t("invite.joiningSub", { owner: p?.ownerName || "" }))}</p>
        </div>`);
    } else if (flow.step === "dead") {
      // A used link is most often the invited person coming back through the
      // email's button: not an error, just the way in (signed out = the
      // login screen, which then opens their brands).
      const used = flow.deadCode === "used";
      html = used
        ? card(`<h1 class="auth-title">${t("invite.deadTitle")}</h1>
            <p class="page-sub" style="margin:8px 0 18px;">${escapeHtml(t(me ? "invite.usedSignedIn" : "invite.usedSignedOut"))}</p>
            <a class="btn btn-primary btn-block" href="${me ? "#/" : "#/login"}">${t(me ? "invite.openApp" : "invite.signInApp")}${icon("arrowRight", { size: 15 })}</a>`)
        : card(`<h1 class="auth-title">${t("invite.deadTitle")}</h1>${err}<a class="btn btn-secondary btn-block" href="#/">${t("invite.back")}</a>`);
    } else if (flow.step === "create") {
      html = card(`
        <h1 class="auth-title">${t("invite.create.title")}</h1>
        <p class="page-sub" style="margin:8px 0 18px;">${escapeHtml(t("invite.for", { email: p?.emailMasked || "" }))}</p>
        ${err}
        <form id="inv-create" novalidate>
          <div class="field"><label for="inv-name">${t("invite.create.name")}</label><input class="input" id="inv-name" autocomplete="name" value="${escapeHtml(flow.name)}" /></div>
          <div class="field"><label for="inv-pass">${t("invite.create.password")}</label>${passwordFieldHTML("inv-pass", { autocomplete: "new-password" })}</div>
          <button type="submit" class="btn btn-primary btn-block" ${flow.busy ? "disabled" : ""}>${t("invite.create.send")}</button>
        </form>
        <p class="hint" style="display:block;margin-top:14px;text-align:center;"><a href="#" id="inv-back" style="color:var(--accent);">${t("invite.back")}</a></p>`);
    } else if (flow.step === "code") {
      html = card(`
        <h1 class="auth-title">${t("invite.code.title")}</h1>
        <p class="page-sub" style="margin:8px 0 18px;">${escapeHtml(t("invite.code.sub", { email: p?.emailMasked || "" }))}</p>
        ${err}
        <form id="inv-code" novalidate>
          <div class="field"><label for="inv-code-input">${t("invite.code.label")}</label><input class="input" id="inv-code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="font-size:22px;letter-spacing:.3em;text-align:center;" /></div>
          <button type="submit" class="btn btn-primary btn-block" ${flow.busy ? "disabled" : ""}>${t("invite.code.join")}</button>
        </form>
        <p class="hint" style="display:block;margin-top:14px;text-align:center;">${t("invite.code.spam")} <a href="#" id="inv-resend" style="color:var(--accent);">${t("invite.code.resend")}</a></p>`);
    } else if (flow.step === "email") {
      html = card(`${head}${err}
        <form id="inv-login" novalidate>
          <div class="field"><label for="inv-email">Email</label><input class="input" id="inv-email" type="email" autocomplete="username" value="${escapeHtml(flow.email || "")}" /></div>
          <div class="field"><label for="inv-pw">Password</label>${passwordFieldHTML("inv-pw", { autocomplete: "current-password" })}</div>
          <button type="submit" class="btn btn-primary btn-block" ${flow.busy ? "disabled" : ""}>${icon("arrowRight", { size: 15 })}${t(flow.busy ? "invite.joiningShort" : "invite.emailLogin")}</button>
        </form>
        <p class="hint" style="display:block;margin-top:14px;text-align:center;"><a href="#" id="inv-back" style="color:var(--accent);">${t("invite.back")}</a></p>`);
    } else if (me) {
      html = card(`${head}${err}
        <p class="hint" style="display:block;margin:0 0 12px;">${escapeHtml(t("invite.signedInAs", { email: me.email || "" }))}</p>
        ${flow.step === "verify" ? `<p class="page-sub" style="margin:0 0 12px;">${t("invite.verify")}</p><button class="btn btn-primary btn-block" id="inv-verify" ${flow.busy ? "disabled" : ""}>${t("invite.verify.send")}</button>` : `<button class="btn btn-primary btn-block" id="inv-accept" ${flow.busy ? "disabled" : ""}>${icon("check", { size: 15 })}${t(flow.busy ? "invite.joiningShort" : "invite.accept")}</button>`}
        <p class="hint" style="display:block;margin-top:14px;text-align:center;"><a href="#" id="inv-switch" style="color:var(--accent);">${t("invite.switch")}</a></p>
        <p class="hint" style="display:block;margin-top:6px;text-align:center;">${escapeHtml(t("invite.for", { email: p?.emailMasked || "" }))}</p>`);
    } else {
      html = card(`${head}${err}
        <button type="button" class="btn btn-primary btn-block" id="inv-google" style="gap:8px;" ${flow.busy ? "disabled" : ""}>${GOOGLE_G_SVG}${t(flow.busy ? "invite.joiningShort" : "invite.google")}</button>
        <button type="button" class="btn btn-secondary btn-block" id="inv-email-btn" style="margin-top:10px;" ${flow.busy ? "disabled" : ""}>${t("invite.emailLogin")}</button>
        <p class="hint" style="display:block;margin-top:16px;text-align:center;">${t("invite.noAccount")} <a href="#" id="inv-create-link" style="color:var(--accent);">${t("invite.create")}</a></p>
        <p class="hint" style="display:block;margin-top:6px;text-align:center;">${escapeHtml(t("invite.for", { email: p?.emailMasked || "" }))}</p>`);
    }
    root.innerHTML = html;
    wirePasswordToggles?.(root);
    wire(root);
  };

  const go = (step, extra = {}) => {
    Object.assign(flow, { step, error: null, busy: false }, extra);
    paint();
  };
  const fail = (e) => {
    flow.busy = false;
    const code = e?.code || "generic";
    if (["not-found", "expired", "revoked", "used"].includes(code)) return go("dead", { error: errorText(code, flow), deadCode: code });
    if (code === "unverified") return go("verify");
    flow.error = errorText(code, flow);
    paint();
  };
  // Accepted: straight into the brand. main.js waits until this account's
  // access includes it, then leaves this page for the brand.
  const join = (out) => {
    go("joining");
    const leave = () => {
      if (location.hash.startsWith(`#/undangan/`)) return;
      flows.delete(token);
      window.removeEventListener("hashchange", leave);
    };
    window.addEventListener("hashchange", leave);
    window.dispatchEvent(new CustomEvent("team:joined", { detail: { brandIds: out?.brandIds || [], brandName: flow.preview?.brandNames?.[0] || "" } }));
  };
  const accept = async () => {
    flow.busy = true;
    flow.error = null;
    paint();
    try {
      join(await teamApi("accept", { token }));
    } catch (e) {
      fail(e);
    }
  };

  const wire = (root) => {
    qs("#inv-google", root)?.addEventListener("click", async () => {
      flow.busy = true;
      flow.error = null;
      paint();
      let signedIn = null;
      try {
        signedIn = await loginWithGoogle({ allowNew: true });
        join(await teamApi("accept", { token }));
      } catch (e) {
        // A Google account made just now for an invite that isn't its own
        // doesn't stay behind (js/auth.js loginWithGoogle).
        if (signedIn?.isNew && e?.code === "email-mismatch") {
          try {
            await signedIn.user.delete();
          } catch {
            await logout().catch(() => {});
          }
        }
        if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return go("start");
        fail(e);
      }
    });
    qs("#inv-email-btn", root)?.addEventListener("click", () => go("email"));
    qs("#inv-create-link", root)?.addEventListener("click", (e) => {
      e.preventDefault();
      go("create");
    });
    qs("#inv-back", root)?.addEventListener("click", (e) => {
      e.preventDefault();
      go("start");
    });
    qs("#inv-login", root)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = qs("#inv-email", root).value.trim();
      flow.email = email;
      const password = qs("#inv-pw", root).value;
      flow.busy = true;
      flow.error = null;
      paint();
      try {
        await login(email, password);
        await accept();
      } catch (err) {
        if (String(err?.code || "").startsWith("auth/")) {
          flow.busy = false;
          flow.error = t("auth.err.generic");
          paint();
        } else fail(err);
      }
    });
    qs("#inv-create", root)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      flow.name = qs("#inv-name", root).value.trim();
      flow.password = qs("#inv-pass", root).value;
      if (flow.password.length < 8) return fail({ code: "weak-password" });
      flow.busy = true;
      paint();
      try {
        await teamApi("code-start", { token });
        go("code");
      } catch (err) {
        if (err?.code === "too-soon") return go("code");
        fail(err);
      }
    });
    qs("#inv-verify", root)?.addEventListener("click", async () => {
      flow.busy = true;
      paint();
      try {
        await teamApi("code-start", { token });
        go("code", { verifying: true });
      } catch (err) {
        if (err?.code === "too-soon") return go("code", { verifying: true });
        fail(err);
      }
    });
    qs("#inv-resend", root)?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await teamApi("code-start", { token });
      } catch (err) {
        if (err?.code !== "too-soon") fail(err);
      }
    });
    qs("#inv-code", root)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = qs("#inv-code-input", root).value.replace(/\D/g, "");
      flow.busy = true;
      paint();
      try {
        const out = await teamApi("code-finish", { token, code, name: flow.name, password: flow.password });
        // A new account: sign in with what was just typed (the server made it, verified).
        if (out.created && !auth.currentUser) await login(out.email, flow.password);
        flow.password = "";
        join(out);
      } catch (err) {
        if (err?.code === "account-exists") return go("email", { error: errorText("account-exists", flow) });
        fail(err);
      }
    });
    qs("#inv-accept", root)?.addEventListener("click", accept);
    qs("#inv-switch", root)?.addEventListener("click", async (e) => {
      e.preventDefault();
      // A fresh page signed out, back on this same invite.
      await logout();
      location.reload();
    });
  };

  flow.paint = paint;
  flow.load = () => {
    teamApi("preview", { token })
      .then(async (p) => {
        flow.preview = p;
        // Already joined with this account (the email's button pressed
        // again): straight in, like the first time.
        if (p.state === "accepted" && auth.currentUser) {
          try {
            const out = await teamApi("accept", { token });
            if (out.already) return join(out);
          } catch {
            /* someone else's: the page below says it's used */
          }
        }
        if (p.state !== "pending") return go("dead", { error: errorText(p.state === "accepted" ? "used" : p.state, flow), deadCode: p.state === "accepted" ? "used" : p.state });
        go("start");
      })
      .catch(fail);
  };
  return flow;
}

export function renderInvite(root, token) {
  const flow = flowFor(token);
  flow.root = root;
  if (!flow.loaded) {
    flow.loaded = true;
    flow.load();
  }
  flow.paint();
}
