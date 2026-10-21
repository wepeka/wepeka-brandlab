// The emails Brandlab sends about itself — the invoice after a payment
// (api/midtrans/webhook.js) and an announcement mailed to
// every active account (api/announcements/notify.js). Both carry the same
// community links as the app (js/community.js): the WhatsApp group and the
// two Instagram accounts. Everything here is pure (no Firestore, no fetch),
// so it is tested directly; api/_email.js does the sending.
import { APP_URL } from "./_reminders.js";
import { isLifetimePlan } from "./_plans.js";
import { isAdminUid } from "./_aiQuota.js";
import { paidAtLabel } from "./_invoice.js";

// Brandlab's own WhatsApp groups (owner, 2026-10-13 — until then this
// pointed at Wepeka Community's group, wepeka.com/gabung, by mistake):
//   general   everyone with a Brandlab account: news, fixes, tips, questions.
//             Same value as js/site-links.js — kept equal by
//             tests/community.test.mjs.
//   Lifetime  the Founder Circle: Founder, Agency Lifetime and the old
//             Lifetime plan only. It exists on the server alone, never in
//             the browser bundle: api/community.js hands it to a Lifetime
//             account, and the email after a Lifetime payment carries it.
export const BRANDLAB_WA_GROUP_URL = "https://chat.whatsapp.com/G3QM3TVztrH5jkFcoULjdu";
export const LIFETIME_WA_GROUP_URL = "https://chat.whatsapp.com/JsLekzEXFU616x24nItGX4";

// The Lifetime group's link for this account, or null: a Lifetime plan
// (whatever its status but an admin's "deactivated"), or Wepeka's team.
export function lifetimeGroupFor(uid, account) {
  if (isAdminUid(uid)) return LIFETIME_WA_GROUP_URL;
  return account && account.status !== "deactivated" && isLifetimePlan(account.plan) ? LIFETIME_WA_GROUP_URL : null;
}
export const FOLLOW_INSTAGRAM = ["winkhsin", "wepeka.id"];
export const SUPPORT_WA_NUMBER = "6285196627609";
// The terms (their #refund section is the refund policy) and the privacy
// policy on wepeka.com — same values as js/site-links.js, kept equal by
// tests/community.test.mjs.
export const TERMS_URL = "https://www.wepeka.com/syarat-ketentuan";
export const PRIVACY_URL = "https://www.wepeka.com/kebijakan-privasi";
export const REFUND_URL = `${TERMS_URL}#refund`;
export const instagramUrl = (handle) => `https://www.instagram.com/${String(handle).replace(/^@/, "")}`;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

const BUTTON = "display:inline-block;text-decoration:none;padding:11px 20px;border-radius:999px;font-weight:700;font-size:15px;";
const MARK = `Wepeka <span style="color:#bbb;font-weight:400;">|</span> Brandlab`;
// `aside`: what sits right of the mark (the word INVOICE). Tables, not
// flex — mail clients.
const shell = (inner, aside = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
${aside
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;"><tr><td style="font-weight:800;font-size:17px;vertical-align:middle;white-space:nowrap;">${MARK}</td><td align="right" style="vertical-align:middle;white-space:nowrap;">${aside}</td></tr></table>`
    : `<p style="margin:0 0 18px;font-weight:800;font-size:17px;">${MARK}</p>`}
${inner}
</div></body></html>`;

// A Lifetime buyer is guided by the Wepeka team until Brandlab runs (the
// promise on /founder, owner 2026-10-18); it starts with this chat. The
// app's door (js/community.js) opens the same chat.
export const GUIDE_WA_TEXT = "Halo Wepeka, aku baru jadi Founder Brandlab. Mau mulai sesi bimbingan.";
export const GUIDE_WA_URL = `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(GUIDE_WA_TEXT)}`;

// The block every email ends on: join the group, follow the accounts.
// `lifetime`: the buyer just got a Lifetime plan, so the guided setup and
// their own group come first (never in an announcement, which goes to
// everyone). `circle`: the Lifetime group's door alone, for an email that
// is composed per recipient (composeGroupInviteEmail).
function communityHTML({ lifetime = false, circle = lifetime } = {}) {
  const follow = FOLLOW_INSTAGRAM.map((h) => `<a href="${esc(instagramUrl(h))}" style="color:#c2185b;font-weight:700;text-decoration:none;">@${esc(h)}</a>`).join(" &nbsp;·&nbsp; ");
  const guide = lifetime ? `<div style="margin:22px 0 0;padding:16px 18px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;">
<p style="margin:0 0 6px;font-weight:700;">Mulai dibimbing tim Wepeka</p>
<p style="margin:0 0 12px;color:#444;font-size:14px;">Chat kami di WhatsApp. Kita atur sesi kenalan 1-on-1, lalu kami temani sampai Brand DNA, Brand Book, dan rencana minggu pertamamu jadi.</p>
<p style="margin:0;"><a href="${esc(GUIDE_WA_URL)}" style="${BUTTON}background:#f97316;color:#fff;">Mulai dibimbing</a></p>
</div>` : "";
  const circleBlock = circle ? `<div style="margin:${lifetime ? "12px" : "22px"} 0 0;padding:16px 18px;background:#fff4f9;border:1px solid #f6c7dd;border-radius:12px;">
<p style="margin:0 0 6px;font-weight:700;">Grup WhatsApp Lifetime (Founder Circle)</p>
<p style="margin:0 0 12px;color:#444;font-size:14px;">Khusus akun Lifetime: bareng tim Wepeka dan Founder lain. Link ini khusus buat kamu, jangan dibagikan ya.</p>
<p style="margin:0;"><a href="${esc(LIFETIME_WA_GROUP_URL)}" style="${BUTTON}background:#25D366;color:#062b14;">Gabung grup Lifetime</a></p>
</div>` : "";
  return `${guide}${circleBlock}<div style="margin:${lifetime || circle ? "12px" : "22px"} 0 0;padding:16px 18px;background:#f1fbf4;border:1px solid #cdeed8;border-radius:12px;">
<p style="margin:0 0 6px;font-weight:700;">Gabung grup WhatsApp Brandlab</p>
<p style="margin:0 0 12px;color:#444;font-size:14px;">Fitur baru, perbaikan, dan tips diumumkan di sana dulu — sekaligus tempat tanya langsung ke tim Wepeka.</p>
<p style="margin:0 0 12px;"><a href="${esc(BRANDLAB_WA_GROUP_URL)}" style="${BUTTON}background:#25D366;color:#062b14;">Gabung grup WhatsApp</a></p>
<p style="margin:0;color:#444;font-size:14px;">Follow juga di Instagram: ${follow}</p>
</div>`;
}
function communityText({ lifetime = false, circle = lifetime } = {}) {
  return [
    ...(lifetime ? ["Mulai dibimbing tim Wepeka (sesi kenalan 1-on-1, lalu kami temani sampai Brand DNA, Brand Book, dan rencana minggu pertamamu jadi):", GUIDE_WA_URL, ""] : []),
    ...(circle ? ["Grup WhatsApp Lifetime (Founder Circle), khusus akun Lifetime. Link ini jangan dibagikan ya:", LIFETIME_WA_GROUP_URL, ""] : []),
    "Gabung grup WhatsApp Brandlab (fitur baru, perbaikan, dan tips diumumkan di sana dulu):",
    BRANDLAB_WA_GROUP_URL,
    "",
    `Follow juga di Instagram: ${FOLLOW_INSTAGRAM.map((h) => `@${h} (${instagramUrl(h)})`).join(" · ")}`,
  ].join("\n");
}

// After a payment: the invoice. `isPlan`: a plan (welcome wording) or an
// add-on (AI credits, a brand slot); `renewal`: an auto-renew charge.
// `price`/`credit`: the plan's own price and what was left of the old plan
// (an upgrade, api/_plans.js creditQuote) — `amount` is what was paid.
// `invoiceNo`, `paidAt`, `method` come from api/_invoice.js; a missing
// method just leaves its row out. `lifetime`: the plan bought is a Lifetime
// one, so the Lifetime group's link is included. → { subject, html, text }.
const SELLER = "Wepeka";
const localNumber = (intl) => String(intl).replace(/^62/, "0").replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
export function composePaidEmail({ name = "", email = "", label = "", amount = 0, price = 0, credit = 0, discount = 0, discountLabel = "", orderId = "", invoiceNo = "", paidAt = Date.now(), method = "", isPlan = true, renewal = false, lifetime = false, appUrl = APP_URL } = {}) {
  const hi = firstName(name) ? `Hai ${firstName(name)},` : "Hai,";
  const what = label || "Brandlab";
  const no = invoiceNo ? ` ${invoiceNo}` : "";
  const subject = renewal ? `Invoice${no} — perpanjangan ${what}`
    : isPlan ? `Invoice${no} — selamat datang di Brandlab`
    : `Invoice${no} — ${what}`;
  const lead = renewal ? `Perpanjangan otomatis ${what} sudah kami terima, dan masa aktifnya sudah bertambah.`
    : isPlan ? `Pembayaran kamu untuk ${what} sudah kami terima dan paketnya sudah aktif. Makasih sudah gabung di Brandlab.`
    : `Pembayaran kamu untuk ${what} sudah kami terima dan sudah masuk ke akunmu.`;
  const keep = "Invoice-nya ada di bawah. Simpan email ini sebagai bukti pembayaran.";
  const billedTo = [String(name || "").trim(), String(email || "").trim()].filter(Boolean);
  // Label → value, in reading order; an empty value is left out.
  const facts = [
    ["No. invoice", invoiceNo],
    ["Tanggal bayar", paidAtLabel(paidAt)],
    ["Ditagihkan ke", billedTo.length === 2 ? `${billedTo[0]} (${billedTo[1]})` : billedTo[0] || ""],
    ["Metode bayar", method],
  ].filter(([, v]) => v);
  // The order's own id (long) sits in the small print: what the team looks
  // a payment up by.
  const ref = orderId ? `No. pesanan ${orderId}` : "";
  // The credit and discount lines only when the numbers add up to what was
  // charged. `price` is the plan's price after a community code (`discount`,
  // api/_promo.js), so the list price is the two together.
  const paid = Math.round(Number(amount) || 0);
  const off = Math.round(Number(credit) || 0);
  const cut = Math.round(Number(discount) || 0);
  const list = Math.round(Number(price) || 0) + cut;
  const showBreakdown = (off > 0 || cut > 0) && list - cut - off === paid;
  const lines = showBreakdown
    ? [[what, rupiah(list)], ...(cut > 0 ? [[discountLabel || "Diskon", `− ${rupiah(cut)}`]] : []), ...(off > 0 ? [["Sisa nilai paket sebelumnya", `− ${rupiah(off)}`]] : [])]
    : [[what, rupiah(paid)]];
  const site = String(appUrl).replace(/^https?:\/\//, "");
  const issuer = `Diterbitkan oleh ${SELLER} · ${site} · WhatsApp ${localNumber(SUPPORT_WA_NUMBER)}`;
  const help = `Ada kendala? WhatsApp tim Wepeka: https://wa.me/${SUPPORT_WA_NUMBER}`;

  const row = "padding:3px 0;vertical-align:top;font-size:13.5px;";
  const aside = `<span style="font-weight:800;font-size:12px;letter-spacing:.16em;color:#c96a00;">INVOICE</span>`;
  const html = shell(`<p style="margin:0 0 12px;">${esc(hi)}</p>
<p style="margin:0 0 6px;">${esc(lead)}</p>
<p style="margin:0 0 18px;color:#666;font-size:13.5px;">${esc(keep)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #e9e7e3;border-radius:12px;margin:0 0 18px;">
<tr><td style="padding:16px 18px 4px;"><span style="display:inline-block;padding:3px 11px;border-radius:999px;background:#e6f7ed;color:#0a7a3d;font-weight:800;font-size:11.5px;letter-spacing:.1em;">LUNAS</span></td></tr>
<tr><td style="padding:8px 18px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${facts.map(([k, v]) => `<tr><td width="108" style="${row}color:#888;">${esc(k)}</td><td style="${row}color:#111;word-break:break-word;">${esc(v)}</td></tr>`).join("\n")}
</table></td></tr>
<tr><td style="padding:14px 18px 16px;border-top:1px solid #e9e7e3;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${lines.map(([k, v]) => `<tr><td style="padding:3px 0;font-size:14px;">${esc(k)}</td><td align="right" style="padding:3px 0;font-size:14px;white-space:nowrap;">${esc(v)}</td></tr>`).join("\n")}
<tr><td style="padding:10px 0 0;font-weight:800;font-size:15px;border-top:1px solid #e9e7e3;">Total dibayar</td><td align="right" style="padding:10px 0 0;font-weight:800;font-size:17px;white-space:nowrap;border-top:1px solid #e9e7e3;">${esc(rupiah(paid))}</td></tr>
</table></td></tr>
</table>
<p style="margin:0;"><a href="${esc(appUrl)}" style="${BUTTON}background:#111;color:#fff;">Buka Brandlab</a></p>
${communityHTML({ lifetime: isPlan && lifetime })}
<p style="margin:18px 0 0;color:#888;font-size:12px;word-break:break-word;">${esc(issuer)}${ref ? `<br>${esc(ref)}` : ""}<br>Invoice ini dibuat otomatis, jadi tidak perlu tanda tangan. Ada kendala? <a href="https://wa.me/${SUPPORT_WA_NUMBER}" style="color:#888;">WhatsApp tim Wepeka</a>.<br><a href="${TERMS_URL}" style="color:#888;">Syarat &amp; Ketentuan</a> · <a href="${REFUND_URL}" style="color:#888;">Kebijakan refund</a> · <a href="${PRIVACY_URL}" style="color:#888;">Kebijakan Privasi</a></p>`, aside);
  const text = [
    hi, "", lead, keep, "",
    "INVOICE — LUNAS",
    ...facts.map(([k, v]) => `${k}: ${v}`), "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    `Total dibayar: ${rupiah(paid)}`, "",
    issuer, ...(ref ? [ref] : []), "",
    `Buka Brandlab: ${appUrl}`, "", communityText({ lifetime: isPlan && lifetime }), "", help, "",
    `Syarat & Ketentuan: ${TERMS_URL}`, `Kebijakan refund: ${REFUND_URL}`, `Kebijakan Privasi: ${PRIVACY_URL}`,
  ].join("\n");
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

// "Gabung grup WhatsApp" (admin, api/announcements/group-invite.js): one
// email per account, composed per recipient. `circle`: a Lifetime account
// (lifetimeGroupFor), which gets both doors, its own group first; everyone
// else gets the general group. Its own look (dark hero, brand gradient,
// big WhatsApp-green buttons), not the plain shell the invoice uses; tables
// and inline styles only, so Gmail and phone mail apps keep it.
// → { subject, html, text }.
const WA_GREEN = "#25D366";
const GOLD = "#f5b544";
const font = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";
// A button mail apps can't break: the colour sits on the cell, the link fills it.
const bigButton = (href, label, bg, fg) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;"><tr><td bgcolor="${bg}" style="border-radius:999px;background:${bg};"><a href="${esc(href)}" style="display:inline-block;padding:15px 26px;${font}font-size:16px;font-weight:800;line-height:1;color:${fg};text-decoration:none;border-radius:999px;">${label}</a></td></tr></table>`;
const groupCard = ({ step, tone, badge, title, body, href, cta }) => {
  const gold = tone === "gold";
  // Translucent over the hero's gradient; the solid colour is the fallback.
  const bg = gold ? "#1c1409" : "#0f2418";
  const glass = gold ? "rgba(40,26,8,.72)" : "rgba(10,40,24,.72)";
  const line = gold ? GOLD : WA_GREEN;
  return `<tr><td style="padding:0 28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${bg}" style="border-collapse:separate;background:${bg};background:${glass};border:1px solid ${line};border-radius:18px;"><tr><td style="padding:20px 22px 22px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="30" height="30" align="center" bgcolor="${line}" style="width:30px;height:30px;border-radius:999px;background:${line};${font}font-size:14px;font-weight:800;color:#0c0a09;">${step}</td>
<td style="padding-left:10px;${font}font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${line};">${esc(badge)}</td>
</tr></table>
<p style="margin:14px 0 6px;${font}font-size:20px;font-weight:800;line-height:1.25;color:#ffffff;">${esc(title)}</p>
<p style="margin:0 0 18px;${font}font-size:14.5px;line-height:1.6;color:#d6d3d1;">${esc(body)}</p>
${bigButton(href, cta, line, "#0c0a09")}
</td></tr></table>
</td></tr>`;
};
function groupInviteHTML({ circle, appUrl, settingsUrl }) {
  // The hero: brand purple/pink fading to near-black; a Lifetime email
  // starts warmer, toward its gold. Mail apps without gradients show #140d1f.
  const heroGradient = circle
    ? "linear-gradient(155deg,#4a2a0a 0%,#5b1747 42%,#1d0f2b 72%,#0c0a09 100%)"
    : "linear-gradient(155deg,#5b21b6 0%,#9d174d 38%,#2a0f2e 70%,#0c0a09 100%)";
  const preheader = circle
    ? "Founder Circle khusus akun Lifetime, plus grup Brandlab untuk semua pengguna."
    : "Fitur baru, tips, dan tanya langsung ke tim Wepeka. Gabung sekali klik.";
  const headline = circle
    ? `Kamu dapat akses<br><span style="color:${GOLD};">2 grup WhatsApp</span> &#10024;`
    : `Yuk gabung<br><span style="color:${WA_GREEN};">grup WhatsApp</span> Brandlab &#128172;`;
  const sub = circle
    ? "Sebagai pemilik akun Lifetime, kamu masuk ke Founder Circle (khusus Lifetime) dan ke grup Brandlab untuk semua pengguna."
    : "Biar nggak ketinggalan info, semua kabar Brandlab sekarang diumumkan di grup WhatsApp duluan.";
  const perks = [
    ["&#128640;", "Info fitur baru paling duluan"],
    ["&#128161;", "Tips konten dan branding dari tim Wepeka"],
    ["&#128172;", "Tanya langsung kalau ada yang bingung"],
  ];
  const perksHTML = `<tr><td style="padding:24px 28px 8px;">
<p style="margin:0 0 12px;${font}font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#78716c;">Di grup kamu dapat</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${perks.map(([emoji, label]) => `<tr><td width="44" valign="middle" style="padding:6px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="36" height="36" align="center" bgcolor="#f5f5f4" style="width:36px;height:36px;border-radius:12px;background:#f5f5f4;font-size:18px;line-height:36px;">${emoji}</td></tr></table></td><td valign="middle" style="padding:6px 0 6px 6px;${font}font-size:15px;font-weight:600;color:#1c1917;">${label}</td></tr>`).join("")}
</table>
</td></tr>`;
  const regularCTA = `<tr><td style="padding:4px 28px 30px;">
${bigButton(BRANDLAB_WA_GROUP_URL, "Gabung grup WhatsApp &rarr;", WA_GREEN, "#052e16")}
<p style="margin:12px 0 0;${font}font-size:12.5px;color:#a8a29e;">Gratis, sekali klik langsung masuk.</p>
</td></tr>`;
  const cards = circle
    ? `<tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
${groupCard({ step: 1, tone: "gold", badge: "Khusus Lifetime", title: "Founder Circle", body: "Bareng tim Wepeka dan Founder lain. Link ini khusus buat kamu, jangan dibagikan ya.", href: LIFETIME_WA_GROUP_URL, cta: "Gabung Founder Circle &rarr;" })}
${groupCard({ step: 2, tone: "green", badge: "Semua pengguna", title: "Grup Brandlab", body: "Fitur baru, perbaikan, dan tips diumumkan di sana duluan, sekaligus tempat tanya langsung ke tim Wepeka.", href: BRANDLAB_WA_GROUP_URL, cta: "Gabung grup Brandlab &rarr;" })}
<tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>`
    : regularCTA;
  const follow = FOLLOW_INSTAGRAM.map((h) => `<td style="padding:0 4px;"><a href="${esc(instagramUrl(h))}" style="display:inline-block;padding:9px 14px;border-radius:999px;background:#fdf2f8;border:1px solid #fbcfe8;${font}font-size:13.5px;font-weight:700;color:#be185d;text-decoration:none;">@${esc(h)}</a></td>`).join("");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Grup WhatsApp Brandlab</title></head>
<body style="margin:0;padding:0;background:#f6efe9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6efe9" style="background:#f6efe9;background-image:linear-gradient(180deg,#ffedd5 0%,#fce7f3 48%,#ede9fe 100%);"><tr><td align="center" style="padding:24px 12px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#140d1f" style="max-width:560px;border-collapse:separate;background:#140d1f;background-image:${heroGradient};border-radius:22px;overflow:hidden;">
<tr><td height="5" bgcolor="#ec4899" style="height:5px;line-height:5px;font-size:0;background:#ec4899;background-image:linear-gradient(90deg,#ffa52b,#ec4899,#8b5cf6);">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><img src="${esc(appUrl)}/assets/wepeka-logo.png" width="104" height="26" alt="Wepeka" style="display:block;border:0;outline:none;"></td>
<td valign="middle" style="padding:0 10px;${font}font-size:20px;color:#57534e;">|</td>
<td valign="middle" style="${font}font-size:19px;font-weight:800;color:#ffffff;">Brandlab</td>
</tr></table>
</td></tr>
<tr><td style="padding:26px 28px 0;">
<span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${circle ? "#2a1f0b" : "#0f2418"};background:rgba(0,0,0,.34);${font}font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${circle ? GOLD : "#4ade80"};">${circle ? "&#9733; Founder Brandlab" : "&#9679; Grup WhatsApp"}</span>
<h1 style="margin:16px 0 12px;${font}font-size:30px;font-weight:800;line-height:1.18;color:#ffffff;">${headline}</h1>
<p style="margin:0 0 22px;${font}font-size:16px;line-height:1.6;color:#d6d3d1;">${esc(sub)}</p>
</td></tr>
${cards}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin-top:14px;border-collapse:separate;background:#ffffff;border-radius:22px;">
${perksHTML}
<tr><td style="padding:10px 28px 26px;">
<p style="margin:0 0 10px;${font}font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#78716c;">Follow juga di Instagram</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-left:-4px;"><tr>${follow}</tr></table>
</td></tr>
</table>
<p style="max-width:520px;margin:18px auto 0;${font}font-size:12px;line-height:1.6;color:#6b6259;text-align:center;">Kamu menerima email ini karena punya akun Brandlab. Nggak mau terima email info seperti ini? Matikan di <a href="${esc(settingsUrl)}" style="color:#6b6259;">Pengaturan &rarr; Pengingat</a>.<br>Wepeka Brandlab &middot; <a href="${esc(appUrl)}" style="color:#6b6259;">${esc(appUrl.replace(/^https?:\/\//, ""))}</a></p>
</td></tr></table>
</body></html>`;
}
export function composeGroupInviteEmail({ circle = false, appUrl = APP_URL } = {}) {
  const settingsUrl = `${appUrl}/#/settings/reminders`;
  const subject = circle ? "2 grup WhatsApp untuk Founder Brandlab" : "Gabung grup WhatsApp Brandlab, biar nggak ketinggalan info";
  const intro = circle
    ? "Sebagai pemilik akun Lifetime, kamu masuk ke Founder Circle (khusus Lifetime) dan ke grup Brandlab untuk semua pengguna."
    : "Biar nggak ketinggalan info, semua kabar Brandlab sekarang diumumkan di grup WhatsApp duluan.";
  const text = [
    circle ? "Kamu dapat akses 2 grup WhatsApp" : "Yuk gabung grup WhatsApp Brandlab", "",
    intro, "",
    communityText({ circle }), "",
    `Nggak mau terima email info seperti ini? Matikan di Pengaturan → Pengingat: ${settingsUrl}`,
  ].join("\n");
  return { subject, html: groupInviteHTML({ circle, appUrl, settingsUrl }), text };
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
    out.push({ uid: a.uid, email, circle: Boolean(lifetimeGroupFor(a.uid, a)) });
  }
  return out;
}
