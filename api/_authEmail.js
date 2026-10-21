// "Lupa password" email sent by Brandlab itself instead of by Firebase.
//
// Firebase's own email comes from noreply@wepeka-ba996.firebaseapp.com with
// a template this project can no longer edit, and Gmail files it under Spam.
// Here Firebase only makes the link (Admin SDK, api/_firebaseAdmin.js); the
// email goes out through Resend from a wepeka.com address, DKIM-signed like
// the invoice. The link still opens Firebase's own reset page (in Indonesian),
// which then sends the person back to Brandlab.
//
// Pure parts only (template, link, limiter, the request logic with its
// side effects passed in), so tests/auth-email.test.mjs runs them without
// Firebase or Resend. api/auth-email.js wires the real ones.
import { APP_URL } from "./_reminders.js";

export const AUTH_EMAIL_FROM_DEFAULT = "Wepeka Brandlab <akun@wepeka.com>";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const looksLikeEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(v);

// Firebase's hosted page reads `lang`; the Admin SDK leaves it on English.
export function resetLinkInIndonesian(firebaseLink) {
  const url = new URL(firebaseLink);
  url.searchParams.set("lang", "id");
  return url.toString();
}

export function composeResetEmail({ link, appUrl = APP_URL } = {}) {
  const subject = "Atur ulang password Brandlab kamu";
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Link untuk membuat password baru akun Brandlab kamu.</div>
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
<p style="margin:0 0 4px;color:#888;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Wepeka Brandlab</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;">Atur ulang password</h1>
<p style="margin:0 0 12px;">Halo, ada permintaan untuk mengatur ulang password akun Brandlab dengan email ini.</p>
<p style="margin:0 0 18px;">Klik tombol di bawah untuk membuat password baru. Setelah itu kamu bisa masuk lagi ke Brandlab.</p>
<p style="margin:0 0 18px;"><a href="${esc(link)}" style="display:inline-block;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:15px;background:#111;color:#fff;">Buat password baru</a></p>
<p style="margin:0 0 14px;color:#666;font-size:13px;">Tombolnya tidak bisa diklik? Salin link ini ke browser:<br><a href="${esc(link)}" style="color:#444;word-break:break-all;">${esc(link)}</a></p>
<p style="margin:0;color:#888;font-size:13px;">Tidak merasa meminta ini? Abaikan saja email ini. Password kamu tidak berubah.</p>
</div>
<p style="max-width:520px;margin:14px auto 0;text-align:center;color:#999;font-size:12px;">Wepeka Brandlab · <a href="${esc(appUrl)}" style="color:#999;">${esc(appUrl.replace(/^https?:\/\//, ""))}</a></p>
</body></html>`;
  const text = [
    "Halo, ada permintaan untuk mengatur ulang password akun Brandlab dengan email ini.",
    "",
    `Buat password baru: ${link}`,
    "",
    "Tidak merasa meminta ini? Abaikan saja email ini. Password kamu tidak berubah.",
    "",
    `Wepeka Brandlab · ${appUrl}`,
  ].join("\n");
  return { subject, html, text };
}

// In-memory, per server instance: enough to stop one person (or one script)
// from flooding an inbox; Firebase and Resend have their own limits on top.
export function makeLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

// The whole request, side effects passed in. Never says whether the email
// has an account: "sent" either way, so the form can't be used to find out.
// → { status, body }. 503 makes the browser fall back to Firebase's email.
export async function handleResetRequest({ email, ip }, { configured, allowIp, allowEmail, makeLink, send, appUrl = APP_URL, now = Date.now() }) {
  if (!allowIp(`ip:${ip}`, now)) return { status: 429, body: { error: "too-many" } };
  if (!configured) return { status: 503, body: { error: "email-off" } };
  const address = String(email || "").trim().toLowerCase();
  if (!looksLikeEmail(address)) return { status: 200, body: { ok: true } };
  if (!allowEmail(`email:${address}`, now)) return { status: 429, body: { error: "too-many" } };
  let link;
  try {
    link = await makeLink(address, appUrl);
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code || "";
    if (code === "auth/user-not-found" || code === "auth/email-not-found") return { status: 200, body: { ok: true } };
    return { status: 502, body: { error: "failed" } };
  }
  const result = await send(address, composeResetEmail({ link: resetLinkInIndonesian(link), appUrl }), `brandlab-reset-${address}-${Math.floor(now / 60000)}`);
  // 409 = the same tap already sent one this minute.
  if (!result?.ok && result?.status !== 409) return { status: 502, body: { error: "failed" } };
  return { status: 200, body: { ok: true } };
}
