// Founder Circle — the human part of a Lifetime plan, inside the app
// (owner picked no. 18 of the 2026-10-15 "biar orang mau beli" analysis):
// the next live session with the Wepeka team — a public Instagram live, or
// the closed monthly Founder session — the recordings of past ones
// (wepeka.com/brandlab promises "direkam kalau kamu nggak sempat"), the one
// Brand Book review every Founder gets, and a sign-up to have your brand
// taken apart ("dibedah") in a Founder session.
//
// Where it lives (Brandlab's Firestore, Admin SDK only — no client rule
// opens either path, so the browser only ever sees it through
// api/founder-circle.js):
//   meta/founderCircle    { nextSession: { at, minutes, kind, topic, link, note },
//                           recordings: [{ title, url, at }] }
//                         written by wepeka.com /admin/brandlab/founder-circle
//   founderCircle/{uid}   { review: { brandId, brandName, note, wa, status,
//                           requestedAt, scheduledAt, doneAt },
//                           bedah: { on, brandId, brandName, at },
//                           name, email, updatedAt }
//                         the member writes through the API; the admin moves
//                         the review along (requested → scheduled → done)
//   founderQuestions/{id} { uid, name, email, brandId, brandName, text,
//                           status: open | answered | withdrawn,
//                           createdAt, answeredAt }
//                         the weekly "ask anything" queue: members write
//                         through the API, everyone in the circle reads the
//                         open queue WITHOUT who asked (questionView); only
//                         Wepeka's team gets name, email and brand.
// Everything here is pure (no Firestore, no fetch), tested in
// tests/founder-circle.test.mjs.
import { isLifetimePlan } from "./_plans.js";
import { isAdminUid } from "./_aiQuota.js";
import { ADMIN_URL } from "./_ownerNotify.js";

export const CIRCLE_DOC = "meta/founderCircle";
export const MEMBER_COLLECTION = "founderCircle";
export const REVIEW_STATES = ["requested", "scheduled", "done"];
// What the next session is (owner, 2026-10-16: a 2-person team runs one
// slot a week — a public Instagram live most weeks, the closed Founder
// session once a month): "public" is shown to every account, "founder"
// (and anything unknown — the safe side) only to Lifetime accounts.
export const SESSION_KINDS = ["public", "founder"];
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
  const kind = raw.kind === "public" ? "public" : "founder";
  return { at, minutes, kind, topic: str(raw.topic, 140), link: httpsUrl(raw.link), note: str(raw.note, 280) };
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

// The session still worth showing: it stays "next" until an hour after it
// ends, so the room link still works for someone who joins late.
function upcomingSession(config, now) {
  const session = sessionOf(config?.nextSession);
  return session && session.at + (session.minutes + 60) * MINUTE > now ? session : null;
}

// What a member's app gets.
export function circleView(config, mine, now = Date.now(), extra = {}) {
  return { member: true, session: upcomingSession(config, now), recordings: recordingsOf(config?.recordings), review: reviewOf(mine?.review), bedah: bedahOf(mine?.bedah), ...extra };
}

// ---- The weekly question queue -------------------------------------------
// Owner, 2026-10-29: Founders may ask anything about branding and marketing
// (their brand, what blocks them); the team answers in the last 30 minutes
// of the weekly session, in queue order; the team can share the screen and
// everyone sees the questions anonymously; only the admin sees who sent it.
export const QUESTION_COLLECTION = "founderQuestions";
export const QUESTION_STATES = ["open", "answered", "withdrawn"];
export const MAX_OPEN_QUESTIONS = 1; // per member: one short question at a time, so a few hundred Founders still fit the half hour
export const MIN_QUESTION = 8;
export const MAX_QUESTION = 2000; // only a safety net against abuse; the form shows no limit (owner, 2026-10-29)
export const MAX_QUEUE_READ = 150; // newest documents read per request
const MAX_ANSWERED_SHOWN = 12;

// Keeps line breaks (a question may have paragraphs) but nothing wilder.
const questionText = (v) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_QUESTION);

// What a member writes: the text (too short is refused by the caller), and
// the brand it is about if it is one of theirs (the caller checks).
export function newQuestion({ text, brandId = "", brandName = "", name = "", email = "", uid = "" }, now = Date.now()) {
  return {
    uid: str(uid, 128),
    name: str(name, 80),
    email: str(email, 254),
    brandId: str(brandId, 128),
    brandName: str(brandName, 120),
    text: questionText(text),
    status: "open",
    createdAt: now,
    answeredAt: null,
  };
}
export const questionTextOk = (text) => questionText(text).length >= MIN_QUESTION;

// The queue as a person sees it. `docs` = [{ id, ...data }] in any order.
//  - open questions oldest first, each with its place in line;
//  - `mine`: this account's own (only it gets the flag, nobody gets a uid);
//  - answered: the newest few, for "sudah dibahas";
//  - name / email / brand only when `admin`.
export function questionView(docs, uid, { admin = false } = {}) {
  const rows = (Array.isArray(docs) ? docs : [])
    .filter((d) => d && QUESTION_STATES.includes(d.status) && d.status !== "withdrawn" && str(d.text, MAX_QUESTION))
    .map((d) => ({ ...d, createdAt: time(d.createdAt) || 0 }));
  const shape = (d, position = 0) => ({
    id: String(d.id),
    text: questionText(d.text),
    at: d.createdAt,
    status: d.status,
    position,
    mine: !!uid && d.uid === uid,
    ...(admin ? { name: str(d.name, 80), email: str(d.email, 254), brandName: str(d.brandName, 120) } : {}),
  });
  const open = rows.filter((d) => d.status === "open").sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
  const done = rows.filter((d) => d.status === "answered").sort((a, b) => (time(b.answeredAt) || 0) - (time(a.answeredAt) || 0)).slice(0, MAX_ANSWERED_SHOWN);
  return {
    open: open.map((d, i) => shape(d, i + 1)),
    answered: done.map((d) => shape(d)),
    mineOpen: open.filter((d) => d.uid === uid).length,
    max: MAX_OPEN_QUESTIONS,
  };
}

// What every other account gets: a public live only — never a Founder
// session's room link, the recordings or anyone's requests.
export function publicView(config, now = Date.now()) {
  const session = upcomingSession(config, now);
  return { member: false, session: session?.kind === "public" ? session : null };
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
