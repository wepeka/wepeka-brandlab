// The emails Brandlab sends about itself — the "pembayaran diterima" note
// after a payment (api/midtrans/webhook.js) and an announcement mailed to
// every active account (api/announcements/notify.js). Both carry the same
// community links as the app (js/community.js): the WhatsApp group and the
// two Instagram accounts. Everything here is pure (no Firestore, no fetch),
// so it is tested directly; api/_email.js does the sending.
import { APP_URL } from "./_reminders.js";

// Same values as js/site-links.js — kept equal by tests/community.test.mjs.
export const BRANDLAB_WA_GROUP_URL = "https://chat.whatsapp.com/CCk7zkSbXhrBxKyjG92Yt1";
export const FOLLOW_INSTAGRAM = ["winkhsin", "wepeka.id"];
export const SUPPORT_WA_NUMBER = "6285196627609";
export const instagramUrl = (handle) => `https://www.instagram.com/${String(handle).replace(/^@/, "")}`;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

const BUTTON = "display:inline-block;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:700;font-size:15px;";
const shell = (inner) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
<p style="margin:0 0 18px;font-weight:800;font-size:17px;">Wepeka <span style="color:#bbb;font-weight:400;">|</span> Brandlab</p>
${inner}
</div></body></html>`;

// The block every email ends on: join the group, follow the accounts.
function communityHTML() {
  const follow = FOLLOW_INSTAGRAM.map((h) => `<a href="${esc(instagramUrl(h))}" style="color:#c2185b;font-weight:700;text-decoration:none;">@${esc(h)}</a>`).join(" &nbsp;·&nbsp; ");
  return `<div style="margin:22px 0 0;padding:16px 18px;background:#f1fbf4;border:1px solid #cdeed8;border-radius:12px;">
<p style="margin:0 0 6px;font-weight:700;">Gabung grup WhatsApp Brandlab</p>
<p style="margin:0 0 12px;color:#444;font-size:14px;">Fitur baru, perbaikan, dan tips diumumkan di sana dulu — sekaligus tempat tanya langsung ke tim Wepeka.</p>
<p style="margin:0 0 12px;"><a href="${esc(BRANDLAB_WA_GROUP_URL)}" style="${BUTTON}background:#25D366;color:#062b14;">Gabung grup WhatsApp</a></p>
<p style="margin:0;color:#444;font-size:14px;">Follow juga di Instagram: ${follow}</p>
</div>`;
}
function communityText() {
  return [
    "Gabung grup WhatsApp Brandlab (fitur baru, perbaikan, dan tips diumumkan di sana dulu):",
    BRANDLAB_WA_GROUP_URL,
    "",
    `Follow juga di Instagram: ${FOLLOW_INSTAGRAM.map((h) => `@${h} (${instagramUrl(h)})`).join(" · ")}`,
  ].join("\n");
}

// After a payment. `isPlan`: a plan (welcome wording) or an add-on (AI
// credits, a brand slot — a plain receipt). → { subject, html, text }.
export function composePaidEmail({ name = "", label = "", amount = 0, orderId = "", isPlan = true, appUrl = APP_URL } = {}) {
  const hi = firstName(name) ? `Hai ${firstName(name)},` : "Hai,";
  const what = label || "Brandlab";
  const subject = isPlan ? "Pembayaran diterima — selamat datang di Brandlab" : `Pembayaran diterima — ${what}`;
  const lead = isPlan
    ? `Pembayaran kamu untuk ${what} sudah kami terima dan paketnya sudah aktif. Makasih sudah gabung di Brandlab.`
    : `Pembayaran kamu untuk ${what} sudah kami terima dan sudah masuk ke akunmu.`;
  const detail = `${what} · ${rupiah(amount)}${orderId ? ` · No. pesanan ${orderId}` : ""}`;
  const help = `Ada kendala? WhatsApp tim Wepeka: https://wa.me/${SUPPORT_WA_NUMBER}`;
  const html = shell(`<p style="margin:0 0 12px;">${esc(hi)}</p>
<p style="margin:0 0 12px;">${esc(lead)}</p>
<p style="margin:0 0 18px;color:#666;font-size:13px;">${esc(detail)}</p>
<p style="margin:0;"><a href="${esc(appUrl)}" style="${BUTTON}background:#111;color:#fff;">Buka Brandlab</a></p>
${communityHTML()}
<p style="margin:18px 0 0;color:#888;font-size:12px;">Ada kendala? <a href="https://wa.me/${SUPPORT_WA_NUMBER}" style="color:#888;">WhatsApp tim Wepeka</a>.</p>`);
  const text = [hi, "", lead, detail, "", `Buka Brandlab: ${appUrl}`, "", communityText(), "", help].join("\n");
  return { subject, html, text };
}

// **tebal** and line breaks only — the announcement body is the admin's own
// text, escaped first.
const bodyHTML = (body) => esc(body).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");

// One announcement, as an email. → { subject, html, text }.
export function composeAnnouncementEmail({ title = "", body = "", link = "", appUrl = APP_URL } = {}) {
  const subject = `Brandlab: ${String(title).trim()}`.slice(0, 190);
  const updatesUrl = `${appUrl}/#/updates`;
  const settingsUrl = `${appUrl}/#/settings/reminders`;
  const safeLink = /^https:\/\//i.test(String(link).trim()) ? String(link).trim() : "";
  const html = shell(`<p style="margin:0 0 6px;color:#888;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Pengumuman</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">${esc(title)}</h1>
${body ? `<p style="margin:0 0 18px;">${bodyHTML(body)}</p>` : ""}
<p style="margin:0;"><a href="${esc(safeLink || updatesUrl)}" style="${BUTTON}background:#111;color:#fff;">${safeLink ? "Buka" : "Lihat di Brandlab"}</a></p>
${communityHTML()}
<p style="margin:18px 0 0;color:#888;font-size:12px;">Kamu menerima email ini karena punya akun Brandlab. Nggak mau terima email pengumuman? Matikan di <a href="${esc(settingsUrl)}" style="color:#888;">Pengaturan → Pengingat</a>.</p>`);
  const text = [
    String(title).trim(), "", String(body || "").trim(), "",
    `${safeLink ? "Buka" : "Lihat di Brandlab"}: ${safeLink || updatesUrl}`, "",
    communityText(), "",
    `Nggak mau terima email pengumuman? Matikan di Pengaturan → Pengingat: ${settingsUrl}`,
  ].join("\n");
  return { subject, html, text };
}

const looksLikeEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(v);

// Who an announcement is mailed to: every account that can use Brandlab
// right now (paid or on a running trial), has an address, and hasn't turned
// these emails off (settings/{uid}.updatesEmailOff). One email per address.
//   accounts: [{ uid, email, status, plan, subscriptionExpiresAt, trialEndsAt }]
//   optedOut: Set of uids
export function announcementRecipients(accounts, optedOut = new Set(), now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const a of accounts || []) {
    if (!a || a.status !== "active" || optedOut.has(a.uid)) continue;
    const running = a.plan === "trial" ? Number(a.trialEndsAt) > now : a.plan !== "free" && (a.subscriptionExpiresAt == null || Number(a.subscriptionExpiresAt) > now);
    if (!running) continue;
    const email = String(a.email || "").trim().toLowerCase();
    if (!looksLikeEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ uid: a.uid, email });
  }
  return out;
}
