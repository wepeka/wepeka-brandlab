// Opt-in upload reminders (Settings → Pengingat, js/reminders.js) — the
// server half, shared by api/cron/reminders.js (daily push/email),
// api/push/test.js ("Kirim tes"), api/calendar/[token].js (iCalendar feed)
// and api/reminders/config.js (which channels the server can run).
//
// Everything here is plain functions over plain data; Firestore, web-push
// and the email sender are passed in, so tests run with stubs and nothing
// in this file ever talks to a real service by itself.
//
// Data: settings/{uid}.reminders (written by the owner's own browser, see
// firestore.rules' settings/{uid}) =
//   { push: [{ endpoint, keys: { p256dh, auth }, ua, createdAt }],  // ≤5 devices
//     calendarToken: "<random>",                                  // calendar on
//     email: { enabled, address },                                // address: display only
//     lang: "id" | "en",
//     lastSentDate: "YYYY-MM-DD" }                                // written by the cron
// Because the owner can write that doc, nothing in it is trusted as-is:
// push endpoints must belong to a known push service, the email always goes
// to the account's own address (accounts/{uid}.email), never a typed one.

// Public half of the VAPID pair — the same constant as js/reminders.js
// (tests/reminders.test.mjs checks they match). The private half lives only
// in Vercel's VAPID_PRIVATE_KEY.
export const VAPID_PUBLIC_KEY = "BBjaFC6ToYYCBjtjQ6STH9VyUmqMGR1BRR8A1QaLWtZWzZiY_nuKfgarsHaJYTfd6uLPh1QE_GcetWUjfcs0AZI";
export const DEFAULT_VAPID_SUBJECT = "mailto:wepekapparel@gmail.com";
export const APP_URL = String(process.env.APP_URL || "https://brandlab.wepeka.com").replace(/\/+$/, "");
export const MAX_PUSH_DEVICES = 5;
// 32+ url-safe chars (js/reminders.js makes 43 from 32 random bytes) — a
// shorter or odd-looking token is refused before any database read.
export const CALENDAR_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
// Only the fields the reminder needs — content docs carry whole scripts.
export const CONTENT_FIELDS = ["ownerId", "brandId", "title", "status", "scheduleDate", "deletedAt", "archived", "platform", "format", "updatedAt"];
export const BRAND_FIELDS = ["name", "archived", "deletedAt"];
const CALENDAR_PAST_DAYS = 60;
const CALENDAR_MAX_EVENTS = 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta, no daylight saving

export function pushConfigured(env = process.env) {
  return Boolean(String(env.VAPID_PRIVATE_KEY || "").trim());
}

// ---------- Dates (WIB) ----------
export const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// Today's calendar date in WIB — the cron runs at 00:00 UTC (07:00 WIB), so
// a plain UTC date would still be right then, but not for a manual run
// between 17:00 and 24:00 UTC.
export function wibToday(now = Date.now()) {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function isMondayISO(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
}

// ---------- settings/{uid}.reminders ----------
function validSub(s) {
  return Boolean(s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string");
}
export function normalizeReminders(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const push = Array.isArray(r.push) ? r.push.filter(validSub) : [];
  const email = r.email && typeof r.email === "object" ? r.email : {};
  return {
    push: push.slice(-MAX_PUSH_DEVICES),
    calendarToken: typeof r.calendarToken === "string" && CALENDAR_TOKEN_RE.test(r.calendarToken) ? r.calendarToken : "",
    email: { enabled: email.enabled === true, address: typeof email.address === "string" ? email.address : "" },
    lang: r.lang === "en" ? "en" : "id",
    lastSentDate: isISODate(r.lastSentDate) ? r.lastSentDate : "",
  };
}

// Push services the browsers actually use (Chrome/Edge-on-Android/Opera/
// Samsung → FCM, Firefox → Mozilla, Safari/iOS → Apple, Edge desktop →
// WNS). Anything else in a settings doc was not put there by a browser,
// and the server never sends a request to it.
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export function pushEndpointAllowed(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.port) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// ---------- Which content counts ----------
// Mirrors what the app itself shows as due (js/store.js listContent +
// listOverdueAndDueSoon): not in Sampah, not archived, of a brand that is
// itself live.
function brandLive(brand) {
  return Boolean(brand && !brand.deletedAt && !brand.archived);
}
export function isLiveContent(c, brandsById) {
  return Boolean(c && isISODate(c.scheduleDate) && !c.deletedAt && !c.archived && c.status !== "archived" && brandLive(brandsById.get(c.brandId)));
}
export function isPendingUpload(c, brandsById) {
  return isLiveContent(c, brandsById) && c.status !== "published";
}

export function groupByOwner(rows) {
  const out = new Map();
  for (const row of rows) {
    if (!row || typeof row.ownerId !== "string" || !row.ownerId) continue;
    if (!out.has(row.ownerId)) out.set(row.ownerId, []);
    out.get(row.ownerId).push(row);
  }
  return out;
}

// One owner's day: what to upload today, and on Mondays last week's
// published-vs-planned plus this week's count (null when both are empty).
export function buildDigest({ items, brandsById, today, monday = isMondayISO(today) }) {
  const brandName = (id) => String(brandsById.get(id)?.name || "").trim();
  const todayItems = items
    .filter((c) => c.scheduleDate === today && isPendingUpload(c, brandsById))
    .map((c) => ({ id: c.id, brandId: c.brandId, title: String(c.title || "").trim(), brand: brandName(c.brandId), platform: String(c.platform || ""), format: String(c.format || "") }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
  let recap = null;
  if (monday) {
    const weekAgo = addDays(today, -7);
    const nextWeek = addDays(today, 6);
    const live = items.filter((c) => isLiveContent(c, brandsById));
    const lastWeek = live.filter((c) => c.scheduleDate >= weekAgo && c.scheduleDate < today);
    const planned = lastWeek.length;
    const published = lastWeek.filter((c) => c.status === "published").length;
    const upcoming = live.filter((c) => c.scheduleDate >= today && c.scheduleDate <= nextWeek).length;
    if (planned || upcoming) recap = { published, planned, upcoming };
  }
  return { today, todayItems, recap };
}

// ---------- Copy (server-side; the owner's app language is saved as reminders.lang) ----------
const STR = {
  id: {
    untitled: "(tanpa judul)",
    oneTitle: "Hari ini upload: {title}",
    manyTitle: "Hari ini ada {n} konten untuk di-upload",
    more: "+{n} lainnya",
    recap: "Minggu lalu: {x} terbit dari {y} rencana, minggu ini {z} terjadwal.",
    recapTitle: "Rekap mingguan Brandlab",
    open: "Buka Brandlab",
    emailIntro: "Jadwal upload hari ini:",
    emailFoot: "Kamu dapat email ini karena menyalakan pengingat email di Brandlab. Matikan kapan saja di Pengaturan → Pengingat.",
    testTitle: "Tes pengingat Brandlab",
    testBody: "Notifikasi sudah nyala. Pengingat upload datang tiap pagi sekitar jam 7.",
    calName: "Brandlab · jadwal upload",
    calDesc: "Jadwal upload kontenmu dari Brandlab. Hanya kamu yang punya link ini.",
    calOpen: "Buka di Brandlab: {url}",
  },
  en: {
    untitled: "(untitled)",
    oneTitle: "Upload today: {title}",
    manyTitle: "{n} pieces of content to upload today",
    more: "+{n} more",
    recap: "Last week: {x} published out of {y} planned, this week {z} scheduled.",
    recapTitle: "Brandlab weekly recap",
    open: "Open Brandlab",
    emailIntro: "Today's uploads:",
    emailFoot: "You're getting this because you turned on email reminders in Brandlab. Turn them off any time in Settings → Reminders.",
    testTitle: "Brandlab reminder test",
    testBody: "Notifications are on. Upload reminders arrive every morning around 7.",
    calName: "Brandlab · upload schedule",
    calDesc: "Your content upload schedule from Brandlab. Only you have this link.",
    calOpen: "Open in Brandlab: {url}",
  },
};
function s(lang, key, vars) {
  let str = (STR[lang] || STR.id)[key] ?? STR.id[key];
  if (vars) for (const k in vars) str = str.split(`{${k}}`).join(String(vars[k]));
  return str;
}
const clip = (str, n) => (str.length > n ? `${str.slice(0, n - 1).trimEnd()}…` : str);
const itemLabel = (it, lang, n = 80) => clip(it.title || s(lang, "untitled"), n) + (it.brand ? ` · ${clip(it.brand, 40)}` : "");
const enc = encodeURIComponent;
export const contentUrl = (appUrl, it) => `${appUrl}/#/brand/${enc(it.brandId)}/content/creator/${enc(it.id)}`;

// Where a tap lands: one piece → that piece in Creator; one brand → its
// Kalender; several brands (or the Monday recap alone) → the all-brands home.
export function digestUrl(digest, appUrl = APP_URL) {
  const items = digest.todayItems;
  if (items.length === 1) return contentUrl(appUrl, items[0]);
  const brands = new Set(items.map((i) => i.brandId));
  if (brands.size === 1) return `${appUrl}/#/brand/${enc(items[0].brandId)}/content/calendar`;
  return `${appUrl}/#/`;
}
function recapLine(recap, lang) {
  return recap ? s(lang, "recap", { x: recap.published, y: recap.planned, z: recap.upcoming }) : "";
}

export function composePush(digest, { lang = "id", appUrl = APP_URL } = {}) {
  const items = digest.todayItems;
  const lines = items.slice(0, 4).map((it) => `• ${itemLabel(it, lang, 60)}`);
  if (items.length > 4) lines.push(s(lang, "more", { n: items.length - 4 }));
  if (digest.recap) lines.push(recapLine(digest.recap, lang));
  const title = items.length === 1
    ? s(lang, "oneTitle", { title: clip(items[0].title || s(lang, "untitled"), 60) })
    : items.length ? s(lang, "manyTitle", { n: items.length }) : s(lang, "recapTitle");
  // One piece → its brand reads in the body; the title already names it.
  const body = items.length === 1 ? [items[0].brand, ...lines.slice(1)].filter(Boolean).join("\n") : lines.join("\n");
  return { title, body, url: digestUrl(digest, appUrl), tag: `brandlab-${digest.today}` };
}

export function composeTestPush({ lang = "id", appUrl = APP_URL } = {}) {
  return { title: s(lang, "testTitle"), body: s(lang, "testBody"), url: `${appUrl}/#/settings/reminders`, tag: "brandlab-test" };
}

const escHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function composeEmail(digest, { lang = "id", appUrl = APP_URL } = {}) {
  const push = composePush(digest, { lang, appUrl });
  const items = digest.todayItems;
  const recap = recapLine(digest.recap, lang);
  const text = [
    items.length ? s(lang, "emailIntro") : "",
    ...items.map((it) => `- ${itemLabel(it, lang, 120)}${[it.platform, it.format].filter(Boolean).length ? ` (${[it.platform, it.format].filter(Boolean).join(" · ")})` : ""}\n  ${contentUrl(appUrl, it)}`),
    recap,
    `${s(lang, "open")}: ${push.url}`,
    "",
    s(lang, "emailFoot"),
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
  const list = items.length
    ? `<p style="margin:0 0 8px;font-weight:600;">${escHtml(s(lang, "emailIntro"))}</p><ul style="margin:0 0 16px;padding-left:20px;">${items
        .map((it) => `<li style="margin:0 0 6px;"><a href="${escHtml(contentUrl(appUrl, it))}" style="color:#111;">${escHtml(clip(it.title || s(lang, "untitled"), 120))}</a>${it.brand ? ` <span style="color:#666;">· ${escHtml(it.brand)}</span>` : ""}${[it.platform, it.format].filter(Boolean).length ? `<br><span style="color:#888;font-size:13px;">${escHtml([it.platform, it.format].filter(Boolean).join(" · "))}</span>` : ""}</li>`)
        .join("")}</ul>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px;line-height:1.5;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;">
${list}${recap ? `<p style="margin:0 0 16px;">${escHtml(recap)}</p>` : ""}
<p style="margin:0 0 20px;"><a href="${escHtml(push.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600;">${escHtml(s(lang, "open"))}</a></p>
<p style="margin:0;color:#888;font-size:12px;">${escHtml(s(lang, "emailFoot"))}</p>
</div></body></html>`;
  return { subject: push.title, html, text };
}

// ---------- Web Push ----------
// Sends one payload to each device. 404/410 = the browser dropped that
// subscription (uninstalled, permission revoked) → reported in `dead` so the
// caller removes it; a non-push-service endpoint is dropped the same way.
// Any other failure is counted and the device kept. One bad device never
// stops the others.
export async function deliverPush(subs, payload, send) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const out = { delivered: 0, failed: 0, dead: [] };
  await Promise.all((subs || []).map(async (sub) => {
    if (!validSub(sub) || !pushEndpointAllowed(sub.endpoint)) {
      if (sub && typeof sub.endpoint === "string") out.dead.push(sub.endpoint);
      return;
    }
    try {
      await send(sub, body);
      out.delivered++;
    } catch (err) {
      const code = Number(err?.statusCode);
      if (code === 404 || code === 410) out.dead.push(sub.endpoint);
      else out.failed++;
    }
  }));
  return out;
}

// The exact stored entries to arrayRemove() for a set of dead endpoints —
// arrayRemove matches whole values, so these must be the raw objects as
// read from Firestore, not normalized copies.
export function deadEntries(rawPush, deadEndpoints) {
  const dead = new Set(deadEndpoints || []);
  return (Array.isArray(rawPush) ? rawPush : []).filter((s) => s && dead.has(s.endpoint));
}

// web-push bound to this deployment's VAPID keys; null when
// VAPID_PRIVATE_KEY isn't set (push is then simply off).
export async function webPushSender(env = process.env) {
  const privateKey = String(env.VAPID_PRIVATE_KEY || "").trim();
  if (!privateKey) return null;
  const { default: webpush } = await import("web-push");
  const subject = String(env.VAPID_SUBJECT || "").trim() || DEFAULT_VAPID_SUBJECT;
  return (sub, body, { ttl = 12 * 60 * 60, topic } = {}) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, body, {
      vapidDetails: { subject, publicKey: VAPID_PUBLIC_KEY, privateKey },
      TTL: ttl,
      urgency: "normal",
      timeout: 10000,
      ...(topic ? { topic } : {}),
    });
}

// ---------- Daily cron ----------
async function getAllChunked(db, refs) {
  const out = [];
  for (let i = 0; i < refs.length; i += 100) {
    const part = refs.slice(i, i + 100);
    if (part.length) out.push(...(await db.getAll(...part)));
  }
  return out;
}
async function mapLimit(list, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]);
  });
  await Promise.all(workers);
}

// Marks today as sent for this owner inside a transaction, so two runs
// racing (a retried or doubled cron) can't both send. Returns the previous
// value so a run that reached nobody can hand the day back.
export async function claimDay(db, uid, today) {
  const ref = db.collection("settings").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data()?.reminders?.lastSentDate || "" : "";
    if (prev === today) return null;
    tx.update(ref, { "reminders.lastSentDate": today });
    return { prev };
  });
}

// The whole daily run. deps:
//   db            admin Firestore (or a stub with the same small surface)
//   sendPush      (sub, body) => Promise — null when push is off
//   sendEmail     ({ to, subject, html, text, idempotencyKey }) => Promise<{ ok }> — null when email is off
//   accountActive (account) => boolean — paid & not read-only
//   accountEmail  (uid, account) => Promise<string>
//   arrayRemove   (...values) => FieldValue sentinel
// One query on content.scheduleDate (equality, or a 14-day range on Mondays
// for the recap) — a single-field index, no composite one; owners are
// grouped in memory.
export async function runDailyReminders({
  db, now = Date.now(), appUrl = APP_URL, sendPush = null, sendEmail = null,
  accountActive = (a) => a?.status === "active", accountEmail = async (_uid, a) => a?.email || "",
  arrayRemove = (...v) => ({ __arrayRemove: v }), dryRun = false, log = console, concurrency = 6,
}) {
  const today = wibToday(now);
  const monday = isMondayISO(today);
  const summary = { today, monday, dryRun, owners: 0, optedIn: 0, alreadySent: 0, inactive: 0, nothingToday: 0, notified: 0, wouldNotify: 0, errors: 0, push: { delivered: 0, failed: 0, removed: 0 }, email: { sent: 0, failed: 0 } };
  if (!sendPush && !sendEmail) return summary;

  let q = db.collection("content");
  q = monday ? q.where("scheduleDate", ">=", addDays(today, -7)).where("scheduleDate", "<=", addDays(today, 6)) : q.where("scheduleDate", "==", today);
  if (typeof q.select === "function") q = q.select(...CONTENT_FIELDS);
  const snap = await q.get();
  const byOwner = groupByOwner(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  summary.owners = byOwner.size;
  if (!byOwner.size) return summary;

  const settingsCol = db.collection("settings");
  const settingsSnaps = await getAllChunked(db, [...byOwner.keys()].map((uid) => settingsCol.doc(uid)));
  const candidates = [];
  for (const snapS of settingsSnaps) {
    if (!snapS?.exists) continue;
    const raw = snapS.data()?.reminders;
    const rem = normalizeReminders(raw);
    const wantsPush = Boolean(sendPush) && rem.push.length > 0;
    const wantsEmail = Boolean(sendEmail) && rem.email.enabled;
    if (!wantsPush && !wantsEmail) continue;
    summary.optedIn++;
    if (rem.lastSentDate === today) { summary.alreadySent++; continue; }
    candidates.push({ uid: snapS.id, rem, rawPush: raw?.push, wantsPush, wantsEmail });
  }
  if (!candidates.length) return summary;

  const accountSnaps = await getAllChunked(db, candidates.map((c) => db.collection("accounts").doc(c.uid)));
  const accounts = new Map(accountSnaps.map((a) => [a.id, a.exists ? a.data() : null]));

  await mapLimit(candidates, concurrency, async (c) => {
    try {
      const account = accounts.get(c.uid);
      // A lapsed/free/deactivated account can't change its settings (the
      // rules need an active plan), so it couldn't turn this off either.
      if (!account || !accountActive(account)) { summary.inactive++; return; }
      let bq = db.collection("brands").where("ownerId", "==", c.uid);
      if (typeof bq.select === "function") bq = bq.select(...BRAND_FIELDS);
      const brandsById = new Map((await bq.get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      const digest = buildDigest({ items: byOwner.get(c.uid), brandsById, today, monday });
      if (!digest.todayItems.length && !digest.recap) { summary.nothingToday++; return; }
      if (dryRun) { summary.wouldNotify++; return; }

      const claim = await claimDay(db, c.uid, today);
      if (!claim) { summary.alreadySent++; return; }
      const ref = settingsCol.doc(c.uid);
      let reached = 0;
      let failed = 0;
      if (c.wantsPush) {
        const r = await deliverPush(c.rem.push, composePush(digest, { lang: c.rem.lang, appUrl }), sendPush);
        reached += r.delivered;
        failed += r.failed;
        summary.push.delivered += r.delivered;
        summary.push.failed += r.failed;
        const dead = deadEntries(c.rawPush, r.dead);
        if (dead.length) {
          await ref.update({ "reminders.push": arrayRemove(...dead) }).catch((e) => log.error?.("reminders: remove dead push failed", c.uid, e?.message));
          summary.push.removed += dead.length;
        }
      }
      if (c.wantsEmail) {
        const to = String((await accountEmail(c.uid, account)) || "").trim();
        if (to) {
          const mail = composeEmail(digest, { lang: c.rem.lang, appUrl });
          const r = await sendEmail({ to, ...mail, idempotencyKey: `brandlab-reminder-${c.uid}-${today}` }).catch((e) => ({ ok: false, error: e?.message }));
          if (r?.ok) { reached++; summary.email.sent++; } else { failed++; summary.email.failed++; }
        }
      }
      if (reached) summary.notified++;
      // Reached no one but something failed for a reason that may pass (push
      // service down, email API error) → give the day back so a re-run can try.
      else if (failed) await ref.update({ "reminders.lastSentDate": claim.prev || "" }).catch(() => {});
    } catch (err) {
      summary.errors++;
      log.error?.("reminders: owner failed", c.uid, err?.message);
    }
  });
  return summary;
}

// ---------- iCalendar feed ----------
// RFC 5545 TEXT escaping: backslash, semicolon, comma, newlines; other
// control characters are dropped.
export function icsEscape(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}
// Lines are folded at 75 octets (UTF-8 bytes, not characters), never inside
// a multi-byte character; continuation lines start with one space.
export function foldLine(line) {
  const parts = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + b > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const icsDate = (iso) => iso.replace(/-/g, "");
const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

// One all-day VEVENT per pending upload (not published, not in Sampah, of
// a live brand), from 60 days back onward. All-day = DTSTART;VALUE=DATE
// with an exclusive DTEND the next day. The alarm is TRIGGER:PT8H — 8 hours
// after the start of that day in the calendar's own time zone, i.e. 08:00
// for a phone set to WIB (Apple Calendar's own "on the day at 9:00" is
// written the same way, PT9H). Google Calendar ignores alarms in subscribed
// feeds and uses that calendar's own notification setting instead.
export function buildCalendar({ items, brandsById, now = Date.now(), appUrl = APP_URL, lang = "id" }) {
  const from = addDays(wibToday(now), -CALENDAR_PAST_DAYS);
  const host = (() => { try { return new URL(appUrl).hostname; } catch { return "brandlab.wepeka.com"; } })();
  const stamp = icsStamp(now);
  const events = items
    .filter((c) => isPendingUpload(c, brandsById) && c.scheduleDate >= from)
    .sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate) || String(a.id).localeCompare(String(b.id)))
    .slice(0, CALENDAR_MAX_EVENTS);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wepeka//Brandlab//ID",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(s(lang, "calName"))}`,
    `X-WR-CALDESC:${icsEscape(s(lang, "calDesc"))}`,
    "X-WR-TIMEZONE:Asia/Jakarta",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const c of events) {
    const brand = String(brandsById.get(c.brandId)?.name || "").trim();
    const title = String(c.title || "").trim() || s(lang, "untitled");
    const summary = `Upload: ${title}${brand ? ` · ${brand}` : ""}`;
    const url = contentUrl(appUrl, { id: c.id, brandId: c.brandId });
    const meta = [c.platform, c.format].filter((v) => typeof v === "string" && v.trim()).join(" · ");
    const desc = [meta, s(lang, "calOpen", { url })].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:content-${String(c.id).replace(/[^A-Za-z0-9_-]/g, "")}@${host}`,
      `DTSTAMP:${stamp}`,
      ...(Number.isFinite(Number(c.updatedAt)) && Number(c.updatedAt) > 0 ? [`LAST-MODIFIED:${icsStamp(Number(c.updatedAt))}`] : []),
      `DTSTART;VALUE=DATE:${icsDate(c.scheduleDate)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(c.scheduleDate, 1))}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      `URL:${url}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(summary)}`,
      "TRIGGER:PT8H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
