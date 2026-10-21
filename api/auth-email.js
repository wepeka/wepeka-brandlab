// POST { email } → mails a "lupa password" link from a wepeka.com address
// (see api/_authEmail.js for why not Firebase's own email). Always "ok" for
// a well-formed request, whether or not the email has an account. 503 while
// email isn't set up (RESEND_API_KEY + RESEND_FROM) or AUTH_EMAIL=off: the
// app then lets Firebase send its own email (js/auth.js resetPassword).
// AUTH_EMAIL_FROM changes the sender.
import { passwordResetLink } from "./_firebaseAdmin.js";
import { emailConfigured, sendEmail } from "./_email.js";
import { AUTH_EMAIL_FROM_DEFAULT, handleResetRequest, makeLimiter } from "./_authEmail.js";

const TEN_MINUTES = 10 * 60 * 1000;
const allowIp = makeLimiter({ limit: 10, windowMs: TEN_MINUTES });
const allowEmail = makeLimiter({ limit: 3, windowMs: TEN_MINUTES });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const off = String(process.env.AUTH_EMAIL || "").toLowerCase() === "off";
  const from = String(process.env.AUTH_EMAIL_FROM || "").trim() || AUTH_EMAIL_FROM_DEFAULT;
  const { status, body } = await handleResetRequest(
    { email: req.body?.email, ip },
    {
      configured: emailConfigured() && !off,
      allowIp,
      allowEmail,
      makeLink: (email, appUrl) => passwordResetLink(email, `${appUrl}/`),
      send: (to, mail, idempotencyKey) => sendEmail({ to, ...mail, idempotencyKey, from }),
    }
  );
  if (status === 502) console.error("[auth-email] reset failed");
  return res.status(status).json(body);
}
