// Opt-in reminders: api/_reminders.js (WIB dates, iCal feed, digest,
// push delivery, the daily cron run against a stubbed Firestore),
// api/_email.js, and the settings data-shape helpers in js/reminders.js.
// Nothing here talks to Firestore, a push service or Resend.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  VAPID_PUBLIC_KEY as SERVER_VAPID, CALENDAR_TOKEN_RE, wibToday, addDays, isMondayISO, normalizeReminders,
  pushEndpointAllowed, groupByOwner, buildDigest, composePush, composeEmail, deliverPush, deadEntries,
  runDailyReminders, icsEscape, foldLine, buildCalendar, pushConfigured,
} from "../api/_reminders.js";
import { sendEmail, emailConfigured } from "../api/_email.js";
import {
  VAPID_PUBLIC_KEY as CLIENT_VAPID, MAX_PUSH_DEVICES, withPushSub, withoutPushSub, newCalendarToken, calendarLinks,
  normalizeReminders as clientNormalize, deviceLabel, pushSupport, urlBase64ToUint8Array,
} from "../js/reminders.js";
import { __i18nSources } from "../js/i18n.js";

const TUE_0700_WIB = Date.parse("2026-10-06T00:00:00Z"); // Tuesday 6 Oct 2026, 07:00 WIB
const MON_0700_WIB = Date.parse("2026-10-05T00:00:00Z"); // Monday 5 Oct 2026, 07:00 WIB
const FCM = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const sub = (n, extra = {}) => ({ endpoint: FCM(n), keys: { p256dh: `p${n}`, auth: `a${n}` }, ua: "Chrome · Android", createdAt: n, ...extra });

describe("WIB dates", () => {
  test("today flips at 00:00 WIB (17:00 UTC), not at UTC midnight", () => {
    assert.equal(wibToday(Date.parse("2026-10-05T16:59:59Z")), "2026-10-05");
    assert.equal(wibToday(Date.parse("2026-10-05T17:00:00Z")), "2026-10-06");
    assert.equal(wibToday(TUE_0700_WIB), "2026-10-06");
    assert.equal(wibToday(Date.parse("2026-12-31T18:30:00Z")), "2027-01-01");
  });
  test("addDays crosses month and year ends", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-10-05", -7), "2026-09-28");
  });
  test("Monday detection", () => {
    assert.equal(isMondayISO("2026-10-05"), true);
    assert.equal(isMondayISO("2026-10-06"), false);
    assert.equal(isMondayISO(wibToday(MON_0700_WIB)), true);
  });
});

describe("settings/{uid}.reminders shape", () => {
  test("missing or junk → everything off", () => {
    for (const raw of [undefined, null, "x", {}, { push: "nope", email: 5, calendarToken: "short" }]) {
      assert.deepEqual(normalizeReminders(raw), { push: [], calendarToken: "", email: { enabled: false, address: "" }, lang: "id", lastSentDate: "" });
      assert.deepEqual(clientNormalize(raw), { push: [], calendarToken: "", email: { enabled: false, address: "" }, lang: "id", lastSentDate: "" });
    }
  });
  test("malformed subscriptions are dropped, server keeps at most 5", () => {
    const raw = { push: [sub(1), { endpoint: FCM(2) }, null, sub(3), sub(4), sub(5), sub(6), sub(7)] };
    assert.deepEqual(normalizeReminders(raw).push.map((s) => s.createdAt), [3, 4, 5, 6, 7]);
  });
  test("withPushSub dedupes by endpoint and keeps the newest 5 devices", () => {
    let rem = {};
    for (let i = 1; i <= 7; i++) rem = withPushSub(rem, sub(i), { now: i * 10, ua: `Device ${i}` });
    assert.equal(rem.push.length, MAX_PUSH_DEVICES);
    assert.deepEqual(rem.push.map((s) => s.ua), ["Device 3", "Device 4", "Device 5", "Device 6", "Device 7"]);
    rem = withPushSub(rem, { ...sub(4), keys: { p256dh: "new", auth: "new" } }, { now: 999, ua: "Device 4b" });
    assert.equal(rem.push.length, 5);
    assert.equal(rem.push.filter((s) => s.endpoint === FCM(4)).length, 1);
    assert.deepEqual(rem.push.at(-1), { endpoint: FCM(4), keys: { p256dh: "new", auth: "new" }, ua: "Device 4b", createdAt: 999 });
  });
  test("withPushSub keeps the other channels as they were", () => {
    const rem = withPushSub({ calendarToken: "x".repeat(43), email: { enabled: true, address: "a@b.co" }, lastSentDate: "2026-10-05" }, sub(1), { now: 1 });
    assert.equal(rem.calendarToken, "x".repeat(43));
    assert.deepEqual(rem.email, { enabled: true, address: "a@b.co" });
    assert.equal(rem.lastSentDate, "2026-10-05");
  });
  test("withoutPushSub removes one device, or all with no endpoint", () => {
    const rem = { push: [sub(1), sub(2)] };
    assert.deepEqual(withoutPushSub(rem, FCM(1)).push.map((s) => s.endpoint), [FCM(2)]);
    assert.deepEqual(withoutPushSub(rem, "").push, []);
  });
  test("calendar token: 43 url-safe chars, accepted by the server, never repeats", () => {
    const a = newCalendarToken();
    const b = newCalendarToken();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(CALENDAR_TOKEN_RE.test(a));
    assert.notEqual(a, b);
    assert.equal(normalizeReminders({ calendarToken: a }).calendarToken, a);
  });
  test("calendar links: https feed, webcal for iPhone, Google's add-by-URL", () => {
    const l = calendarLinks("https://brandlab.wepeka.com/", "TOKEN");
    assert.equal(l.https, "https://brandlab.wepeka.com/api/calendar/TOKEN");
    assert.equal(l.webcal, "webcal://brandlab.wepeka.com/api/calendar/TOKEN");
    assert.equal(l.google, `https://calendar.google.com/calendar/r?cid=${encodeURIComponent("webcal://brandlab.wepeka.com/api/calendar/TOKEN")}`);
  });
  test("client and server carry the same VAPID public key (65-byte P-256 point)", () => {
    assert.equal(CLIENT_VAPID, SERVER_VAPID);
    const bytes = urlBase64ToUint8Array(CLIENT_VAPID);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
  });
  test("device labels", () => {
    assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36"), "Chrome · Android");
    assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "Safari · iPhone");
    assert.equal(deviceLabel(""), "Browser");
  });
  test("push support: iPhone in Safari must install to Home Screen first", () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", serviceWorker: {} };
    const safariTab = { navigator: {}, matchMedia: () => ({ matches: false }), PushManager: function () {}, Notification: function () {} };
    assert.equal(pushSupport(safariTab, iphone), "ios-install");
    const homeScreen = { ...safariTab, navigator: { standalone: true } };
    assert.equal(pushSupport(homeScreen, iphone), "ok");
    const desktop = { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0", serviceWorker: {} };
    assert.equal(pushSupport(safariTab, desktop), "ok");
    assert.equal(pushSupport({ navigator: {}, matchMedia: () => ({ matches: false }) }, { userAgent: "Old" }), "unsupported");
    // iPadOS Safari claims to be a Mac; an Android phone is never taken for an iPad.
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5, serviceWorker: {} };
    assert.equal(pushSupport(safariTab, ipad), "ios-install");
    const android = { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile", platform: "MacIntel", maxTouchPoints: 5, serviceWorker: {} };
    assert.equal(pushSupport(safariTab, android), "ok");
  });
});

describe("push endpoints", () => {
  test("only real push services", () => {
    for (const ok of [FCM(1), "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/QH", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.ok(pushEndpointAllowed(ok), ok);
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com:8443/x", "not a url", ""]) assert.equal(pushEndpointAllowed(bad), false, bad);
  });
  test("404/410 → dead, other errors kept, one failure never stops the rest", async () => {
    const sent = [];
    const send = async (s) => {
      sent.push(s.endpoint);
      if (s.endpoint === FCM(2)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint === FCM(3)) throw Object.assign(new Error("nf"), { statusCode: 404 });
      if (s.endpoint === FCM(4)) throw Object.assign(new Error("busy"), { statusCode: 503 });
    };
    const evil = { endpoint: "https://evil.example/hook", keys: { p256dh: "p", auth: "a" } };
    const r = await deliverPush([sub(1), sub(2), sub(3), sub(4), evil, sub(5)], { title: "x" }, send);
    assert.equal(r.delivered, 2);
    assert.equal(r.failed, 1);
    assert.deepEqual(r.dead.sort(), [FCM(2), FCM(3), "https://evil.example/hook"].sort());
    assert.ok(!sent.includes("https://evil.example/hook"), "never sends to a non-push-service URL");
    assert.deepEqual(deadEntries([sub(1), sub(2), sub(3)], r.dead), [sub(2), sub(3)]);
  });
});

// ---------- digest ----------
const brandsById = new Map([
  ["b1", { id: "b1", name: "Kopi Senja" }],
  ["b2", { id: "b2", name: "Batik Ayu" }],
  ["bx", { id: "bx", name: "Old", archived: true }],
  ["bd", { id: "bd", name: "Gone", deletedAt: 1 }],
]);
const c = (id, extra) => ({ id, ownerId: "u1", brandId: "b1", title: `Konten ${id}`, status: "draft", scheduleDate: "2026-10-06", ...extra });

describe("digest", () => {
  test("today's pending uploads only — not published, trashed, archived or of a dead brand", () => {
    const items = [
      c("a"), c("b", { brandId: "b2", title: "Reels batik" }), c("pub", { status: "published" }), c("trash", { deletedAt: 5 }),
      c("arch", { archived: true }), c("arch2", { status: "archived" }), c("oldbrand", { brandId: "bx" }), c("delbrand", { brandId: "bd" }),
      c("tomorrow", { scheduleDate: "2026-10-07" }), c("nobrand", { brandId: "zz" }),
    ];
    const d = buildDigest({ items, brandsById, today: "2026-10-06" });
    assert.deepEqual(d.todayItems.map((i) => i.id), ["b", "a"]); // by brand name: Batik Ayu, Kopi Senja
    assert.equal(d.recap, null);
  });
  test("Monday recap: last week's published-of-planned, this week's count", () => {
    const items = [
      c("w1", { scheduleDate: "2026-09-28", status: "published" }), c("w2", { scheduleDate: "2026-10-01", status: "published" }),
      c("w3", { scheduleDate: "2026-10-04", status: "draft" }), c("w4", { scheduleDate: "2026-10-02", deletedAt: 1 }),
      c("old", { scheduleDate: "2026-09-27", status: "published" }),
      c("t1", { scheduleDate: "2026-10-05" }), c("t2", { scheduleDate: "2026-10-11" }), c("next", { scheduleDate: "2026-10-12" }),
    ];
    const d = buildDigest({ items, brandsById, today: "2026-10-05" });
    assert.deepEqual(d.recap, { published: 2, planned: 3, upcoming: 2 });
    assert.deepEqual(d.todayItems.map((i) => i.id), ["t1"]);
    assert.match(composePush(d).body, /Minggu lalu: 2 terbit dari 3 rencana, minggu ini 2 terjadwal\./);
  });
  test("no recap when both weeks are empty", () => {
    assert.equal(buildDigest({ items: [], brandsById, today: "2026-10-05" }).recap, null);
  });
  test("push copy and where a tap lands", () => {
    const one = buildDigest({ items: [c("a")], brandsById, today: "2026-10-06" });
    const p1 = composePush(one, { appUrl: "https://app.test" });
    assert.equal(p1.title, "Hari ini upload: Konten a");
    assert.equal(p1.body, "Kopi Senja");
    assert.equal(p1.url, "https://app.test/#/brand/b1/content/creator/a");

    const sameBrand = buildDigest({ items: [c("a"), c("b")], brandsById, today: "2026-10-06" });
    const p2 = composePush(sameBrand, { appUrl: "https://app.test" });
    assert.equal(p2.title, "Hari ini ada 2 konten untuk di-upload");
    assert.equal(p2.url, "https://app.test/#/brand/b1/content/calendar");

    const many = buildDigest({ items: ["a", "b", "c", "d", "e", "f"].map((id, i) => c(id, { brandId: i % 2 ? "b2" : "b1" })), brandsById, today: "2026-10-06" });
    const p3 = composePush(many, { appUrl: "https://app.test", lang: "en" });
    assert.equal(p3.title, "6 pieces of content to upload today");
    assert.match(p3.body, /\+2 more$/);
    assert.equal(p3.url, "https://app.test/#/");

    const recapOnly = { today: "2026-10-05", todayItems: [], recap: { published: 1, planned: 2, upcoming: 0 } };
    assert.equal(composePush(recapOnly).title, "Rekap mingguan Brandlab");
  });
  test("email escapes what the owner typed", () => {
    const d = buildDigest({ items: [c("a", { title: '<img src=x onerror="1">' })], brandsById, today: "2026-10-06" });
    const mail = composeEmail(d, { appUrl: "https://app.test" });
    assert.doesNotMatch(mail.html, /<img src=x/);
    assert.match(mail.html, /&lt;img src=x onerror=&quot;1&quot;&gt;/);
    assert.match(mail.text, /https:\/\/app\.test\/#\/brand\/b1\/content\/creator\/a/);
    assert.match(mail.html, /Pengaturan → Pengingat/);
  });
  test("groupByOwner skips rows without an owner", () => {
    const g = groupByOwner([{ ownerId: "u1" }, { ownerId: "u2" }, { ownerId: "u1" }, {}, null]);
    assert.deepEqual([...g.keys()], ["u1", "u2"]);
    assert.equal(g.get("u1").length, 2);
  });
});

// ---------- iCalendar ----------
describe("iCalendar feed", () => {
  test("TEXT escaping: backslash, semicolon, comma, newline; control chars dropped", () => {
    assert.equal(icsEscape("a,b;c\\d\ne\r\nf"), "a\\,b\\;c\\\\d\\ne\\nf");
    assert.equal(icsEscape("x\u0007y"), "xy");
    assert.equal(icsEscape(null), "");
  });
  test("folding at 75 octets, never inside a multi-byte character, unfolds back", () => {
    const line = `SUMMARY:${"Ngopi santai ☕ di Kediri · ".repeat(8)}`;
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) assert.ok(Buffer.byteLength(part, "utf8") <= 75, part);
    assert.equal(folded.replace(/\r\n /g, ""), line);
    assert.ok(!folded.includes("�"));
    assert.equal(foldLine("SHORT:1"), "SHORT:1");
  });
  test("one all-day VEVENT per pending upload, with an 08:00 alarm", () => {
    const items = [
      c("a", { title: "Promo, diskon; 50%", scheduleDate: "2026-10-31", platform: "Instagram", format: "Reels", updatedAt: Date.parse("2026-10-01T03:04:05Z") }),
      c("pub", { status: "published" }), c("trash", { deletedAt: 1 }), c("oldbrand", { brandId: "bx" }),
      c("past", { scheduleDate: "2026-06-01" }), c("bad", { scheduleDate: "besok" }),
    ];
    const ics = buildCalendar({ items, brandsById, now: TUE_0700_WIB, appUrl: "https://brandlab.wepeka.com" });
    assert.ok(ics.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(ics), "every line ends in CRLF");
    const unfolded = ics.replace(/\r\n /g, "");
    assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.match(unfolded, /\r\nDTSTART;VALUE=DATE:20261031\r\n/);
    assert.match(unfolded, /\r\nDTEND;VALUE=DATE:20261101\r\n/);
    assert.match(unfolded, /\r\nSUMMARY:Upload: Promo\\, diskon\\; 50% · Kopi Senja\r\n/);
    assert.match(unfolded, /\r\nURL:https:\/\/brandlab\.wepeka\.com\/#\/brand\/b1\/content\/creator\/a\r\n/);
    assert.match(unfolded, /\r\nDESCRIPTION:Instagram · Reels\\nBuka di Brandlab: https:\/\/brandlab/);
    assert.match(unfolded, /\r\nUID:content-a@brandlab\.wepeka\.com\r\n/);
    assert.match(unfolded, /\r\nLAST-MODIFIED:20261001T030405Z\r\n/);
    assert.match(unfolded, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]+\r\nTRIGGER:PT8H\r\nEND:VALARM/);
    assert.match(unfolded, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(unfolded, /X-WR-TIMEZONE:Asia\/Jakarta/);
    assert.match(unfolded, /END:VCALENDAR\r\n$/);
  });
  test("an empty schedule is still a valid calendar", () => {
    const ics = buildCalendar({ items: [], brandsById, now: TUE_0700_WIB });
    assert.match(ics, /^BEGIN:VCALENDAR[\s\S]*END:VCALENDAR\r\n$/);
    assert.doesNotMatch(ics, /VEVENT/);
  });
});

// ---------- the daily run, against a stubbed Firestore ----------
function fakeDb({ content = [], settings = {}, accounts = {}, brands = [] } = {}) {
  const store = {
    content: new Map(content.map((d) => [d.id, d])),
    settings: new Map(Object.entries(settings)),
    accounts: new Map(Object.entries(accounts)),
    brands: new Map(brands.map((b) => [b.id, b])),
  };
  const queries = [];
  const writes = [];
  const snap = (col, id) => {
    const d = store[col].get(id);
    return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)) };
  };
  const apply = (col, id, patch) => {
    writes.push({ col, id, patch });
    const doc = store[col].get(id);
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.split(".");
      let o = doc;
      for (const p of parts.slice(0, -1)) o = o[p] ||= {};
      const last = parts.at(-1);
      if (v && v.__arrayRemove) o[last] = (o[last] || []).filter((x) => !v.__arrayRemove.some((r) => JSON.stringify(r) === JSON.stringify(x)));
      else o[last] = v;
    }
  };
  const ref = (col, id) => ({ col, id, get: async () => snap(col, id), update: async (p) => apply(col, id, p) });
  const query = (col, filters) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]]),
    select: function () { return this; },
    get: async () => {
      queries.push({ col, filters });
      const docs = [...store[col].entries()]
        .filter(([, d]) => filters.every(([f, op, v]) => {
          const x = f.split(".").reduce((o, k) => o?.[k], d);
          return op === "==" ? x === v : op === ">=" ? x >= v : op === "<=" ? x <= v : false;
        }))
        .map(([id]) => snap(col, id));
      return { docs, size: docs.length };
    },
  });
  return {
    store, queries, writes,
    collection: (col) => ({ ...query(col, []), doc: (id) => ref(col, id) }),
    getAll: async (...refs) => refs.map((r) => snap(r.col, r.id)),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, p) => apply(r.col, r.id, p) }),
  };
}

const ACTIVE = { status: "active", plan: "pro", email: "owner@kopi.id" };
function world() {
  return fakeDb({
    content: [
      c("a1"), c("a2", { brandId: "b2", ownerId: "u1" }),
      c("p1", { ownerId: "u2", brandId: "b3" }),
      c("n1", { ownerId: "u3", brandId: "b4" }),
      c("x1", { ownerId: "u4", brandId: "b5" }),
      c("q1", { ownerId: "u5", brandId: "b6" }),
      c("later", { scheduleDate: "2026-10-09" }),
    ],
    settings: {
      u1: { platforms: [], reminders: { push: [sub(1), sub(2)], email: { enabled: true, address: "someone-else@evil.example" }, lang: "id" } },
      u2: { reminders: { push: [sub(3)] } },
      u3: { platforms: [] }, // never opted in
      u4: { reminders: { push: [sub(4)] } }, // lapsed account
      u5: { reminders: { push: [sub(5)], lastSentDate: "2026-10-06" } }, // already sent today
    },
    accounts: { u1: ACTIVE, u2: { ...ACTIVE, email: "two@x.id" }, u3: ACTIVE, u4: { status: "readonly", plan: "pro" }, u5: ACTIVE },
    brands: [
      { id: "b1", ownerId: "u1", name: "Kopi Senja" }, { id: "b2", ownerId: "u1", name: "Batik Ayu" },
      { id: "b3", ownerId: "u2", name: "Two" }, { id: "b4", ownerId: "u3", name: "Three" }, { id: "b5", ownerId: "u4", name: "Four" }, { id: "b6", ownerId: "u5", name: "Five" },
    ],
  });
}

describe("daily run", () => {
  test("one push per device and one email per opted-in owner; nobody else is touched", async () => {
    const db = world();
    const pushes = [];
    const emails = [];
    const summary = await runDailyReminders({
      db, now: TUE_0700_WIB, appUrl: "https://app.test",
      sendPush: async (s, body) => { pushes.push({ endpoint: s.endpoint, payload: JSON.parse(body) }); },
      sendEmail: async (m) => { emails.push(m); return { ok: true }; },
      accountActive: (a) => a?.status === "active",
      log: { error() {} },
    });
    // One equality query on scheduleDate — no composite index.
    assert.deepEqual(db.queries[0], { col: "content", filters: [["scheduleDate", "==", "2026-10-06"]] });
    assert.deepEqual(pushes.map((p) => p.endpoint).sort(), [FCM(1), FCM(2), FCM(3)].sort());
    const u1 = pushes.find((p) => p.endpoint === FCM(1)).payload;
    assert.equal(u1.title, "Hari ini ada 2 konten untuk di-upload");
    assert.equal(u1.url, "https://app.test/#/");
    // Email goes to the account's own address, never the one typed into settings.
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, "owner@kopi.id");
    assert.equal(emails[0].idempotencyKey, "brandlab-reminder-u1-2026-10-06");
    assert.equal(db.store.settings.get("u1").reminders.lastSentDate, "2026-10-06");
    assert.equal(db.store.settings.get("u2").reminders.lastSentDate, "2026-10-06");
    assert.equal(db.store.settings.get("u3").reminders, undefined, "never opted in → never written");
    assert.equal(db.store.settings.get("u4").reminders.lastSentDate, undefined, "lapsed account → skipped");
    assert.equal(summary.notified, 2);
    assert.equal(summary.alreadySent, 1);
    assert.equal(summary.inactive, 1);
    assert.equal(db.queries.filter((q) => q.col === "brands").length, 2, "brands only read for owners who get something");
  });

  test("a second (retried) run the same day sends nothing", async () => {
    const db = world();
    let count = 0;
    const deps = { db, now: TUE_0700_WIB, sendPush: async () => { count++; }, sendEmail: async () => { count++; return { ok: true }; }, log: { error() {} } };
    await runDailyReminders(deps);
    const first = count;
    const again = await runDailyReminders(deps);
    assert.ok(first > 0);
    assert.equal(count, first);
    assert.equal(again.notified, 0);
  });

  test("a gone device is removed; one broken device doesn't stop the other", async () => {
    const db = world();
    const delivered = [];
    await runDailyReminders({
      db, now: TUE_0700_WIB,
      sendPush: async (s) => {
        if (s.endpoint === FCM(1)) throw Object.assign(new Error("gone"), { statusCode: 410 });
        delivered.push(s.endpoint);
      },
      log: { error() {} },
    });
    assert.ok(delivered.includes(FCM(2)));
    assert.deepEqual(db.store.settings.get("u1").reminders.push.map((s) => s.endpoint), [FCM(2)]);
  });

  test("when every channel fails for a passing reason, the day is handed back for a re-run", async () => {
    const db = world();
    await runDailyReminders({
      db, now: TUE_0700_WIB,
      sendPush: async () => { throw Object.assign(new Error("down"), { statusCode: 503 }); },
      sendEmail: async () => ({ ok: false, status: 500 }),
      log: { error() {} },
    });
    assert.equal(db.store.settings.get("u1").reminders.lastSentDate, "");
    assert.equal(db.store.settings.get("u1").reminders.push.length, 2, "kept: not a 404/410");
  });

  test("Monday: one bounded scheduleDate range query, recap included", async () => {
    const db = fakeDb({
      content: [
        c("w1", { scheduleDate: "2026-09-29", status: "published" }), c("w2", { scheduleDate: "2026-10-01" }),
        c("t1", { scheduleDate: "2026-10-08" }),
      ],
      settings: { u1: { reminders: { push: [sub(1)] } } },
      accounts: { u1: ACTIVE },
      brands: [{ id: "b1", ownerId: "u1", name: "Kopi Senja" }],
    });
    const pushes = [];
    await runDailyReminders({ db, now: MON_0700_WIB, sendPush: async (_s, body) => pushes.push(JSON.parse(body)), log: { error() {} } });
    assert.deepEqual(db.queries[0].filters, [["scheduleDate", ">=", "2026-09-28"], ["scheduleDate", "<=", "2026-10-11"]]);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].title, "Rekap mingguan Brandlab");
    assert.match(pushes[0].body, /Minggu lalu: 1 terbit dari 2 rencana, minggu ini 1 terjadwal\./);
  });

  test("dry run writes and sends nothing", async () => {
    const db = world();
    let sent = 0;
    const summary = await runDailyReminders({ db, now: TUE_0700_WIB, dryRun: true, sendPush: async () => { sent++; }, log: { error() {} } });
    assert.equal(sent, 0);
    assert.equal(db.writes.length, 0);
    assert.equal(summary.wouldNotify, 2);
  });

  test("with neither push nor email configured, nothing is even queried", async () => {
    const db = world();
    await runDailyReminders({ db, now: TUE_0700_WIB });
    assert.equal(db.queries.length, 0);
  });
});

describe("server config", () => {
  test("push needs VAPID_PRIVATE_KEY; email needs both Resend vars", () => {
    assert.equal(pushConfigured({}), false);
    assert.equal(pushConfigured({ VAPID_PRIVATE_KEY: "k" }), true);
    assert.equal(emailConfigured({}), false);
    assert.equal(emailConfigured({ RESEND_API_KEY: "k" }), false);
    assert.equal(emailConfigured({ RESEND_API_KEY: "k", RESEND_FROM: "Brandlab <a@b.co>" }), true);
  });
  test("sendEmail: skipped when off; Resend call shape when on; never throws", async () => {
    assert.deepEqual(await sendEmail({ to: "a@b.co" }, { env: {} }), { ok: false, skipped: true });
    const env = { RESEND_API_KEY: "test-key", RESEND_FROM: "Brandlab <a@b.co>" };
    let call;
    const ok = await sendEmail({ to: "o@k.id", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "k1" }, {
      env, fetchImpl: async (url, init) => { call = { url, init }; return { ok: true, status: 200, json: async () => ({ id: "e1" }) }; },
    });
    assert.deepEqual(ok, { ok: true, id: "e1" });
    assert.equal(call.url, "https://api.resend.com/emails");
    assert.equal(call.init.headers.Authorization, "Bearer test-key");
    assert.equal(call.init.headers["Idempotency-Key"], "k1");
    assert.deepEqual(JSON.parse(call.init.body), { from: "Brandlab <a@b.co>", to: ["o@k.id"], subject: "S", html: "<p>h</p>", text: "t" });
    const bad = await sendEmail({ to: "o@k.id", subject: "S" }, { env, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ message: "invalid" }) }) });
    assert.deepEqual(bad, { ok: false, status: 422, error: "invalid" });
    const down = await sendEmail({ to: "o@k.id", subject: "S" }, { env, fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(down.ok, false);
    assert.equal((await sendEmail({ to: "not an email" }, { env })).error, "bad-address");
  });
});

describe("wiring", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("sw.js handles push + notificationclick only — no fetch handler, no caching", () => {
    const sw = read("sw.js");
    assert.match(sw, /addEventListener\("push"/);
    assert.match(sw, /addEventListener\("notificationclick"/);
    assert.doesNotMatch(sw, /addEventListener\(\s*["']fetch/);
    assert.doesNotMatch(sw, /caches\./);
  });
  test("the permission prompt and service worker registration only happen in the 'Nyalakan' handler", () => {
    const src = read("js/reminders.js");
    assert.equal(src.match(/Notification\.requestPermission\(/g)?.length, 1);
    assert.equal(src.match(/serviceWorker\.register\(/g)?.length, 1);
    const enable = src.slice(src.indexOf("async function enablePush"), src.indexOf("async function disablePush"));
    assert.match(enable, /requestPermission/);
    assert.match(enable, /serviceWorker\.register/);
  });
  test("the cron is scheduled at 00:00 UTC (07:00 WIB) and the build ships sw.js", () => {
    const vercel = JSON.parse(read("vercel.json"));
    assert.ok(vercel.crons.some((c2) => c2.path === "/api/cron/reminders" && c2.schedule === "0 0 * * *"));
    assert.match(read("scripts/build.mjs"), /copyFile\(path\.join\(ROOT, "sw\.js"\), path\.join\(DIST, "sw\.js"\)\)/);
  });
  test("every reminders.* string the panel uses exists in both languages", () => {
    const { core, extra } = __i18nSources();
    const all = Object.assign({}, core, ...Object.values(extra));
    const keys = new Set([...read("js/reminders.js").matchAll(/"(reminders\.[\w.]+)"/g)].map((m) => m[1]));
    keys.add("settings.panel.reminders");
    assert.ok(keys.size > 30);
    for (const k of keys) {
      assert.ok(all[k]?.en?.trim(), `${k} en`);
      assert.ok(all[k]?.id?.trim(), `${k} id`);
    }
  });
});
