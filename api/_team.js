// Kerja Tim — the pure parts of api/team.js (no Firebase, no Resend), so
// tests/team.test.mjs runs them as they are: emails, tokens and codes, who
// counts against the seats, an invite's state, the invite link and the two
// emails (invite, 6-digit code).
//
// Data (all written by the server only — firestore.rules):
//   brands/{id}.members {uid: {role, name, email, addedAt}}, .memberIds [uid]
//   memberships/{uid} {ownerIds [owner], brands {brandId: {ownerId, role, brandName, ownerName}}}
//   invites/{sha256(token)} {ownerId, ownerName, email, brandIds, brandNames, role,
//                           status, createdAt, expiresAt, lastSentAt, acceptedBy}
//   inviteCodes/{inviteId} {hash, expiresAt, attempts, sentAt}
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const ROLES = ["editor", "viewer"];
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_GAP_MS = 60 * 1000;
export const MAX_PENDING_INVITES = 20;
export const TEAM_EMAIL_FROM_DEFAULT = "Wepeka Brandlab <akun@wepeka.com>";

export const looksLikeEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(v);
export function normalizeEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return looksLikeEmail(e) ? e : "";
}
// "sari@contoh.id" → "s***@contoh.id": the invite page shows who it is for
// without spelling out the address to whoever holds the link.
export function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!user || !domain) return "";
  return `${user[0]}***@${domain}`;
}

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token || "")).digest("hex");
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashCode = (inviteId, code) => createHash("sha256").update(`${inviteId}:${code}`).digest("hex");

function sameHash(a, b) {
  const x = Buffer.from(String(a || ""), "hex");
  const y = Buffer.from(String(b || ""), "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
// "ok" | "expired" | "locked" | "wrong" for a code typed against inviteCodes/{inviteId}.
export function codeCheck(stored, inviteId, code, now = Date.now()) {
  if (!stored) return "expired";
  if (Number(stored.attempts || 0) >= CODE_MAX_ATTEMPTS) return "locked";
  if (!(Number(stored.expiresAt) > now)) return "expired";
  return sameHash(stored.hash, hashCode(inviteId, String(code || "").trim())) ? "ok" : "wrong";
}

// "pending" | "accepted" | "revoked" | "expired"
export function inviteState(invite, now = Date.now()) {
  if (!invite) return "missing";
  if (invite.status === "accepted" || invite.status === "revoked") return invite.status;
  if (!(Number(invite.expiresAt) > now)) return "expired";
  return "pending";
}

// Who takes a seat: every person on any of the owner's brands (counted
// once, whatever their role), plus every still-pending invite for an email
// that isn't on the team yet. `exceptInviteId` leaves out the invite being
// accepted (its person is about to be counted as a member).
export function seatsUsed(brands, invites = [], { now = Date.now(), exceptInviteId = null } = {}) {
  const uids = new Set();
  const emails = new Set();
  for (const b of brands) {
    for (const [uid, m] of Object.entries(b?.members || {})) {
      uids.add(uid);
      if (m?.email) emails.add(normalizeEmail(m.email));
    }
  }
  const pending = new Set();
  for (const inv of invites) {
    if (inv.id === exceptInviteId || inviteState(inv, now) !== "pending") continue;
    const e = normalizeEmail(inv.email);
    if (e && !emails.has(e)) pending.add(e);
  }
  return uids.size + pending.size;
}

// The invite link points at the app the owner is using (the live one, or
// this Mac's dev server while testing on the emulator); anything else gets
// the live app.
const LINK_ORIGINS = ["https://brandlab.wepeka.com", "http://localhost:8743", "http://127.0.0.1:8743"];
export function inviteLink(token, origin, fallback = "https://brandlab.wepeka.com") {
  const base = LINK_ORIGINS.includes(origin) ? origin : fallback;
  return `${base}/#/undangan/${encodeURIComponent(token)}`;
}

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ROLE_TEXT = {
  editor: { name: "Editor", what: "bisa mengubah semua isi brand: Brand DNA, Brand Book, konten, campaign, dan ide" },
  viewer: { name: "Lihat saja", what: "bisa melihat semua isi brand tanpa mengubahnya" },
};
export function joinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} dan ${list[list.length - 1]}`;
}

function shell({ preheader, title, body, appUrl }) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
<p style="margin:0 0 4px;color:#888;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Wepeka Brandlab</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;">${esc(title)}</h1>
${body}
</div>
<p style="max-width:520px;margin:14px auto 0;text-align:center;color:#999;font-size:12px;">Wepeka Brandlab · <a href="${esc(appUrl)}" style="color:#999;">${esc(appUrl.replace(/^https?:\/\//, ""))}</a></p>
</body></html>`;
}

export function composeInviteEmail({ ownerName, brandNames, role, link, email, appUrl = "https://brandlab.wepeka.com" }) {
  const brands = joinNames(brandNames);
  const r = ROLE_TEXT[role] || ROLE_TEXT.editor;
  const who = ownerName || "Pemilik brand";
  const subject = `${who} mengundangmu ke tim ${brands} di Brandlab`;
  const text = [
    `Halo!`,
    ``,
    `${who} mengundangmu bergabung ke tim ${brands} di Wepeka Brandlab sebagai ${r.name} (${r.what}).`,
    ``,
    `Buka link ini untuk bergabung:`,
    link,
    ``,
    `Link berlaku 7 hari dan hanya bisa dipakai dengan email ini (${email}).`,
    `Tidak kenal ${who}? Abaikan saja email ini.`,
  ].join("\n");
  const html = shell({
    preheader: `Kerjakan ${brands} bareng-bareng di Brandlab.`,
    title: `${who} mengundangmu ke timnya`,
    appUrl,
    body: `<p style="margin:0 0 12px;">${esc(who)} mengundangmu bergabung ke tim <b>${esc(brands)}</b> di Brandlab sebagai <b>${esc(r.name)}</b>: ${esc(r.what)}.</p>
<p style="margin:0 0 18px;"><a href="${esc(link)}" style="display:inline-block;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;font-size:15px;background:#111;color:#fff;">Gabung ke tim</a></p>
<p style="margin:0 0 14px;color:#666;font-size:13px;">Tombolnya tidak bisa diklik? Salin link ini ke browser:<br><a href="${esc(link)}" style="color:#444;word-break:break-all;">${esc(link)}</a></p>
<p style="margin:0;color:#888;font-size:13px;">Link berlaku 7 hari dan hanya bisa dipakai dengan email ini (${esc(email)}). Tidak kenal ${esc(who)}? Abaikan saja email ini.</p>`,
  });
  return { subject, text, html };
}

export function composeCodeEmail({ code, ownerName, brandNames, appUrl = "https://brandlab.wepeka.com" }) {
  const brands = joinNames(brandNames);
  const subject = `Kode masuk Brandlab: ${code}`;
  const text = `Kode untuk bergabung ke tim ${brands}${ownerName ? ` milik ${ownerName}` : ""}: ${code}\n\nKode berlaku 10 menit. Tidak merasa meminta kode ini? Abaikan saja email ini.`;
  const html = shell({
    preheader: `Kode kamu: ${code}`,
    title: "Kode masuk Brandlab",
    appUrl,
    body: `<p style="margin:0 0 12px;">Masukkan kode ini untuk bergabung ke tim <b>${esc(brands)}</b>${ownerName ? ` milik ${esc(ownerName)}` : ""}:</p>
<p style="margin:0 0 18px;font-size:32px;font-weight:800;letter-spacing:.18em;">${esc(code)}</p>
<p style="margin:0;color:#888;font-size:13px;">Kode berlaku 10 menit. Tidak merasa meminta kode ini? Abaikan saja email ini.</p>`,
  });
  return { subject, text, html };
}
