// Reminder email through Resend's HTTP API (free tier: 3,000/month,
// 100/day). Off unless BOTH env vars are set in Vercel:
//   RESEND_API_KEY  — the API key
//   RESEND_FROM     — a sender on a domain verified in Resend, e.g.
//                     "Brandlab <pengingat@wepeka.com>"
// While either is missing, emailConfigured() is false, /api/reminders/config
// says { email: false } and the Settings → Pengingat email card is hidden.
const RESEND_URL = "https://api.resend.com/emails";

export function emailConfigured(env = process.env) {
  return Boolean(String(env.RESEND_API_KEY || "").trim() && String(env.RESEND_FROM || "").trim());
}

const looksLikeEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(v);

// → { ok: true, id } | { ok: false, skipped?, status?, error? }. Never throws.
// `idempotencyKey` (Resend keeps it 24 h) makes a retried cron send the
// same day's email only once even if our own lastSentDate write was lost.
export async function sendEmail({ to, subject, html, text, idempotencyKey }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!emailConfigured(env)) return { ok: false, skipped: true };
  if (!looksLikeEmail(to)) return { ok: false, error: "bad-address" };
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: String(env.RESEND_FROM).trim(), to: [to], subject: String(subject || "").slice(0, 200), html, text }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: data?.message || data?.name || `HTTP ${res.status}` };
    return { ok: true, id: data?.id || null };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}
