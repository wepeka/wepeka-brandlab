// Founder Circle — the human part of a Lifetime plan, inside the app
// (owner picked no. 18 of the 2026-10-15 "biar orang mau beli" analysis):
// the next monthly live mentoring with the Wepeka team, the recordings of
// past ones (wepeka.com/brandlab promises "direkam kalau kamu nggak
// sempat"), the one Brand Book review every Founder gets, and a sign-up to
// have your brand taken apart ("dibedah") live in a session.
//
// Where it lives (Brandlab's Firestore, Admin SDK only — no client rule
// opens either path, so the browser only ever sees it through
// api/founder-circle.js):
//   meta/founderCircle    { nextSession: { at, minutes, topic, link, note },
//                           recordings: [{ title, url, at }] }
//                         written by wepeka.com /admin/brandlab/founder-circle
//   founderCircle/{uid}   { review: { brandId, brandName, note, wa, status,
//                           requestedAt, scheduledAt, doneAt },
//                           bedah: { on, brandId, brandName, at },
//                           name, email, updatedAt }
//                         the member writes through the API; the admin moves
//                         the review along (requested → scheduled → done)
// Everything here is pure (no Firestore, no fetch), tested in
// tests/founder-circle.test.mjs.
import { isLifetimePlan } from "./_plans.js";
import { isAdminUid } from "./_aiQuota.js";
import { ADMIN_URL } from "./_ownerNotify.js";

export const CIRCLE_DOC = "meta/founderCircle";
export const MEMBER_COLLECTION = "founderCircle";
export const REVIEW_STATES = ["requested", "scheduled", "done"];
export const MAX_RECORDINGS = 24;
const MINUTE = 60 * 1000;

// Same people as the Lifetime WhatsApp group (api/_community.js
// lifetimeGroupFor): a Lifetime plan not switched off by an admin, or
// Wepeka's own team.
export function isCircleMember(uid, account) {
  if (isAdminUid(uid)) return true;
  return !!account && account.status !== "deactivated" && isLifetimePlan(account.plan);
}

const str = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const httpsUrl = (v) => {
  const s = String(v ?? "").trim();
  return s.length <= 500 && /^https:\/\/[^\s<>"']+$/i.test(s) ? s : "";
};
const time = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export function sessionOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const at = time(raw.at);
  if (!at) return null;
  const minutes = Math.min(240, Math.max(15, Math.round(Number(raw.minutes) || 90)));
  return { at, minutes, topic: str(raw.topic, 140), link: httpsUrl(raw.link), note: str(raw.note, 280) };
}

export function recordingsOf(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => ({ title: str(r?.title, 140), url: httpsUrl(r?.url), at: time(r?.at) || 0 }))
    .filter((r) => r.title && r.url)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECORDINGS);
}

export function reviewOf(raw) {
  if (!raw || typeof raw !== "object" || !REVIEW_STATES.includes(raw.status)) return null;
  return {
    status: raw.status,
    brandId: str(raw.brandId, 128),
    brandName: str(raw.brandName, 120),
    requestedAt: time(raw.requestedAt),
    scheduledAt: time(raw.scheduledAt),
    doneAt: time(raw.doneAt),
  };
}

export function bedahOf(raw) {
  if (!raw || typeof raw !== "object" || raw.on !== true) return null;
  return { on: true, brandId: str(raw.brandId, 128), brandName: str(raw.brandName, 120), at: time(raw.at) };
}

// What a member's app gets. A session stays "next" until an hour after it
// ends, so the room link still works for someone who joins late.
export function circleView(config, mine, now = Date.now()) {
  const session = sessionOf(config?.nextSession);
  const upcoming = session && session.at + (session.minutes + 60) * MINUTE > now ? session : null;
  return { member: true, session: upcoming, recordings: recordingsOf(config?.recordings), review: reviewOf(mine?.review), bedah: bedahOf(mine?.bedah) };
}

// A WhatsApp number as wa.me wants it: digits only, 08… → 628…; "" when it
// doesn't look like a phone number.
export function waNumber(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  return d.length >= 9 && d.length <= 15 ? d : "";
}

// What a member sends when asking for the review: the brand (must be
// theirs — the caller checks), an optional note and WhatsApp number.
export function reviewRequest({ brandId, brandName, note, wa }, now = Date.now()) {
  return {
    status: "requested",
    brandId: str(brandId, 128),
    brandName: str(brandName, 120) || "Tanpa nama",
    note: str(note, 500),
    wa: waNumber(wa),
    requestedAt: now,
    scheduledAt: null,
    doneAt: null,
  };
}

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The note to Wepeka's team when a member asks for their review (same
// addresses as the sale note, api/_ownerNotify.js ownerEmails).
export function composeReviewNote({ name = "", email = "", brandName = "", note = "", wa = "", uid = "" } = {}) {
  const who = [str(name, 80), str(email, 120)].filter(Boolean).join(" · ") || "Founder";
  const subject = `Minta review Brand Book: ${str(brandName, 80) || "brand"} (${str(name, 60) || str(email, 80) || "Founder"})`.slice(0, 190);
  const accountUrl = uid ? `${ADMIN_URL}/accounts/${encodeURIComponent(uid)}` : `${ADMIN_URL}/accounts`;
  const circleUrl = `${ADMIN_URL}/founder-circle`;
  const facts = [
    ["Dari", who],
    ["Brand", str(brandName, 120)],
    ["WhatsApp", wa ? `+${wa}` : ""],
    ["Catatan", str(note, 500)],
  ].filter(([, v]) => v);
  const row = "padding:3px 0;vertical-align:top;font-size:14px;";
  const button = "display:inline-block;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700;font-size:14px;";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.6;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;">
<p style="margin:0 0 4px;color:#888;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Founder Circle</p>
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;">Ada yang minta review Brand Book</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">
${facts.map(([k, v]) => `<tr><td width="96" style="${row}color:#888;">${esc(k)}</td><td style="${row}color:#111;word-break:break-word;">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:0;"><a href="${esc(circleUrl)}" style="${button}background:#111;color:#fff;">Atur jadwalnya di admin</a> &nbsp; <a href="${esc(accountUrl)}" style="${button}background:#f1f0ee;color:#111;">Buka akunnya</a></p>
<p style="margin:18px 0 0;color:#888;font-size:12px;">Review ini termasuk paket Lifetime-nya (1× per akun). Begitu jadwalnya kamu isi di admin, statusnya di app ikut berubah.</p>
</div></body></html>`;
  const text = ["Ada yang minta review Brand Book", "", ...facts.map(([k, v]) => `${k}: ${v}`), "", `Atur jadwalnya: ${circleUrl}`, `Akunnya: ${accountUrl}`].join("\n");
  return { subject, html, text };
}
