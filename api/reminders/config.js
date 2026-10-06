// Which reminder channels this deployment can actually run, so Settings →
// Pengingat only offers those: push needs VAPID_PRIVATE_KEY, email needs
// RESEND_API_KEY + RESEND_FROM. Booleans only — no key, not even a hint of
// one, ever leaves the server. The calendar feed needs nothing extra.
import { pushConfigured } from "../_reminders.js";
import { emailConfigured } from "../_email.js";

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.status(200).json({ push: pushConfigured(), email: emailConfigured() });
}
