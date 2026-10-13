// A note to Wepeka's own team every time a payment lands (owner,
// 2026-10-13: "kasih aku notifikasi kalau ada yang beli brandlab"): an
// email, plus a push to the team account's own devices when it has turned
// Notifikasi on (Settings → Pengingat). api/midtrans/webhook.js sends both
// once per order, next to the buyer's invoice.
//
// Where the email goes: OWNER_NOTIFY_EMAIL in Vercel (several addresses
// separated by commas; "off" = no email), or OWNER_EMAIL below while that
// isn't set. Everything here is pure (no Firestore, no fetch), tested in
// tests/owner-notify.test.mjs.
import { APP_URL } from "./_reminders.js";
import { paidAtLabel } from "./_invoice.js";

export const OWNER_EMAIL = "wepekapparel@gmail.com";
export const ADMIN_URL = "https://www.wepeka.com/admin/brandlab";

const looksLikeEmail = (v) => v.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(v);
export function ownerEmails(env = process.env) {
  const raw = String(env.OWNER_NOTIFY_EMAIL || "").trim();
  if (/^(off|none|false|0)$/i.test(raw)) return [];
  const list = (raw || OWNER_EMAIL).split(",").map((s) => s.trim().toLowerCase()).filter(looksLikeEmail);
  return [...new Set(list)].slice(0, 5);
}

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const rupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;

// What the webhook's review flags (accounts/{uid}.paymentIssue.status) mean
// for the team. `applied: false` = the money came in but nothing was changed
// on the account (api/_plans.js settlePlanPurchase's `issue`).
const REVIEW = {
  "unknown-plan": { applied: false, text: "Paketnya tidak dikenali, jadi belum ada yang diaktifkan." },
  "lifetime-conflict": { applied: false, text: "Akun ini sudah Lifetime, jadi paket yang dibeli tidak diterapkan." },
  "schedule-conflict": { applied: false, text: "Akun ini sudah punya paket yang antre, jadi paket ini tidak diterapkan." },
  "lifetime-overpaid": { applied: true, text: "Founder yang naik ke Agency membayar harga penuh, bukan harga upgrade." },
  "over-cap": { applied: true, text: "Kursi ini terjual melewati batas kursi." },
};
export function reviewNote(code) {
  if (!code) return null;
  return REVIEW[code] || { applied: true, text: `Ditandai untuk dicek (${String(code).slice(0, 40)}).` };
}

// One sale → the email and the push about it.
//   label, amount       what was bought and what was paid
//   buyerName/Email     who (accounts/{uid}, or Firebase Auth)
//   renewal             an auto-renew charge
//   newAccount          bought without ever claiming the trial
//   seat                { sold, cap } after this sale, for a capped plan
//   review              accounts/{uid}.paymentIssue.status for this order
//   sandbox             Midtrans is on sandbox keys (a tester's "payment")
// → { subject, html, text, push: { title, body, url, tag } }
export function composeSaleNote({ label = "", amount = 0, buyerName = "", buyerEmail = "", uid = "", orderId = "", invoiceNo = "", paidAt = Date.now(), method = "", renewal = false, newAccount = false, seat = null, review = "", sandbox = false, appUrl = APP_URL } = {}) {
  const what = String(label || "Brandlab").replace(/^Brandlab\s*(—\s*)?/, "") || "Brandlab";
  const paid = rupiah(amount);
  const note = reviewNote(review);
  const who = [String(buyerName || "").trim(), String(buyerEmail || "").trim()].filter(Boolean);
  const whoLine = who.length === 2 ? `${who[0]} (${who[1]})` : who[0] || "Tidak diketahui";
  const kind = note && !note.applied ? "Pembayaran masuk, perlu dicek" : renewal ? "Perpanjangan otomatis" : "Ada yang beli Brandlab";
  const subject = `${sandbox ? "[SANDBOX] " : ""}${kind}: ${what} · ${paid}`.slice(0, 190);
  const seatLine = seat && Number(seat.cap) > 0 ? `${Number(seat.sold) || 0} dari ${Number(seat.cap)} terjual, sisa ${Math.max(0, Number(seat.cap) - (Number(seat.sold) || 0))}` : "";
  // Label → value, in reading order; an empty value is left out. The item
  // and the money are the heading, so they aren't repeated here.
  const facts = [
    ["Pembeli", whoLine],
    ["Metode bayar", method],
    ["Waktu", paidAtLabel(paidAt)],
    ["Kursi", seatLine],
    ["Akun", newAccount ? "Baru, beli tanpa trial" : ""],
    ["No. invoice", invoiceNo],
    ["No. pesanan", orderId],
  ].filter(([, v]) => v);
  const accountUrl = uid ? `${ADMIN_URL}/accounts/${encodeURIComponent(uid)}` : `${ADMIN_URL}/accounts`;
  const paymentsUrl = `${ADMIN_URL}/payments`;
  const lead = sandbox ? "Ini pembayaran uji (Midtrans sandbox), bukan uang sungguhan."
    : renewal ? "Satu perpanjangan otomatis baru saja masuk."
    : "Satu pembayaran Brandlab baru saja masuk.";

  const row = "padding:3px 0;vertical-align:top;font-size:14px;";
  const button = "display:inline-block;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700;font-size:14px;";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
<p style="margin:0 0 4px;color:#888;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">${esc(kind)}</p>
<h1 style="margin:0 0 4px;font-size:26px;line-height:1.2;">${esc(paid)}</h1>
<p style="margin:0 0 16px;font-weight:700;">${esc(what)}</p>
<p style="margin:0 0 14px;color:#666;font-size:13.5px;">${esc(lead)}</p>
${note ? `<p style="margin:0 0 14px;padding:10px 14px;border-radius:10px;background:#fff4e5;border:1px solid #f6d7a8;color:#7a4a00;font-size:14px;"><b>Perlu dicek.</b> ${esc(note.text)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">
${facts.map(([k, v]) => `<tr><td width="108" style="${row}color:#888;">${esc(k)}</td><td style="${row}color:#111;word-break:break-word;">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:0;"><a href="${esc(accountUrl)}" style="${button}background:#111;color:#fff;">Buka akunnya di admin</a> &nbsp; <a href="${esc(paymentsUrl)}" style="${button}background:#f1f0ee;color:#111;">Semua pembayaran</a></p>
<p style="margin:18px 0 0;color:#888;font-size:12px;">Email ini hanya untuk tim Wepeka, dikirim otomatis setiap ada pembayaran Brandlab yang masuk.</p>
</div></body></html>`;
  const text = [
    `${kind}: ${what} · ${paid}`, "", lead,
    ...(note ? ["", `PERLU DICEK. ${note.text}`] : []), "",
    ...facts.map(([k, v]) => `${k}: ${v}`), "",
    `Akunnya di admin: ${accountUrl}`,
    `Semua pembayaran: ${paymentsUrl}`,
  ].join("\n");
  // The lock screen gets the item, the money and who; the tap opens the app
  // (sw.js only ever opens this same site, so not the admin).
  const push = {
    title: `${sandbox ? "[SANDBOX] " : ""}${kind}`,
    body: [`${what} · ${paid}`, who[0] || "", seatLine ? `Kursi: ${seatLine}` : "", note ? "Perlu dicek, lihat email." : ""].filter(Boolean).join("\n"),
    url: `${String(appUrl).replace(/\/+$/, "")}/`,
    tag: `brandlab-sale-${String(orderId).slice(-24) || "x"}`,
  };
  return { subject, html, text, push };
}
