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
//   codeGuards/{sha256("guard:" + email)} {windowStart, sends, wrong} — per
//                           email, across every invite and owner
//   teamMail/{YYYY-MM-DD WIB} {total, byOwner {uid: n}} — team emails sent that day
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const ROLES = ["editor", "viewer"];
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_GAP_MS = 60 * 1000;
export const MAX_PENDING_INVITES = 20;
// Per email per day, whichever invite or owner asks: a new link or a resend
// starts a fresh 5-try code, but never a fresh day.
export const CODE_DAY_MS = 24 * 60 * 60 * 1000;
export const CODE_DAY_SENDS = 5;
export const CODE_DAY_WRONG = 10;
// Team emails (invites, resends, codes) share Resend's free 100 a day with
// sign-in mails, invoices and reminders: at most 40 a day for every team
// together and 10 per owner, so they can never use up the rest. Past that
// an invite is still made — its link goes out by WhatsApp instead.
export const TEAM_MAIL_DAY_TOTAL = 40;
export const TEAM_MAIL_DAY_OWNER = 10;
export const teamMailDay = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
// The day's counter after one more email from `ownerId`, or null when a
// limit is reached.
export function takeMailSlot(day, ownerId, { total = TEAM_MAIL_DAY_TOTAL, perOwner = TEAM_MAIL_DAY_OWNER } = {}) {
  const sent = Number(day?.total) || 0;
  const mine = Number(day?.byOwner?.[ownerId]) || 0;
  if (sent >= total || mine >= perOwner) return null;
  return { total: sent + 1, byOwner: { ...(day?.byOwner || {}), [ownerId]: mine + 1 } };
}
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

// The day's count for one email (codeGuards/…): starts over 24 hours after
// its first code.
export const codeGuardId = (email) => createHash("sha256").update(`guard:${normalizeEmail(email)}`).digest("hex");
export function guardToday(guard, now = Date.now()) {
  const start = Number(guard?.windowStart) || 0;
  if (!(now - start < CODE_DAY_MS)) return { windowStart: now, sends: 0, wrong: 0 };
  return { windowStart: start, sends: Number(guard.sends) || 0, wrong: Number(guard.wrong) || 0 };
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

// Seats over the limit (a smaller plan, a lapsed extra seat): the people
// who joined first keep theirs, the newest beyond the limit are paused —
// they can still look, but not edit or use the owner's AI, until a seat
// frees up or is added. Nobody is removed. Returns the paused uids.
export function pausedMembers(brands, limit) {
  const firstAt = new Map();
  for (const b of brands || []) {
    for (const [uid, m] of Object.entries(b?.members || {})) {
      const at = Number(m?.addedAt) || 0;
      if (!firstAt.has(uid) || at < firstAt.get(uid)) firstAt.set(uid, at);
    }
  }
  const order = [...firstAt.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([uid]) => uid);
  const keep = Number.isFinite(limit) ? Math.max(0, limit) : order.length;
  return new Set(order.slice(keep));
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
  editor: { name: "Editor", what: "bisa mengubah semua isi brand (Brand DNA, Brand Book, konten, campaign, dan ide)" },
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
    `${who} mengundangmu bergabung ke tim ${brands} di Wepeka Brandlab sebagai ${r.name}. Kamu ${r.what}.`,
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
    body: `<p style="margin:0 0 12px;">${esc(who)} mengundangmu bergabung ke tim <b>${esc(brands)}</b> di Brandlab sebagai <b>${esc(r.name)}</b>. Kamu ${esc(r.what)}.</p>
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
