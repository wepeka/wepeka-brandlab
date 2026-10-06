// Settings → Pengingat: opt-in upload reminders, three independent channels.
//  - Notifikasi (Web Push): sw.js is registered and the browser's permission
//    asked ONLY when the owner taps "Nyalakan" here — never on its own.
//  - Langganan kalender: a private iCalendar link (api/calendar/[token].js)
//    the owner adds to Google Calendar / Kalender iPhone.
//  - Email: only offered when the server has a free-tier sender set up
//    (GET /api/reminders/config → { email }).
// Everything is stored in settings/{uid}.reminders (see api/_reminders.js
// for the shape and how the server uses it). An owner who never opens this
// panel gets no service worker, no permission prompt, nothing.
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, writableByRules } from "./account.js";
import { getUserEmail } from "./auth.js";
import { icon } from "./icons.js";
import { qs, qsa, toast, escapeHtml } from "./dom.js";
import { confirmDialog } from "./modals.js";
import { t, getLang } from "./i18n.js";

// Public half of the VAPID pair (same constant in api/_reminders.js — the
// private half is only in Vercel's VAPID_PRIVATE_KEY).
export const VAPID_PUBLIC_KEY = "BBjaFC6ToYYCBjtjQ6STH9VyUmqMGR1BRR8A1QaLWtZWzZiY_nuKfgarsHaJYTfd6uLPh1QE_GcetWUjfcs0AZI";
export const MAX_PUSH_DEVICES = 5;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

// ---------- Data shape (pure, tested) ----------
export function normalizeReminders(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const push = Array.isArray(r.push) ? r.push.filter((s) => s && typeof s.endpoint === "string" && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string") : [];
  const email = r.email && typeof r.email === "object" ? r.email : {};
  return {
    push,
    calendarToken: typeof r.calendarToken === "string" && TOKEN_RE.test(r.calendarToken) ? r.calendarToken : "",
    email: { enabled: email.enabled === true, address: typeof email.address === "string" ? email.address : "" },
    lang: r.lang === "en" ? "en" : "id",
    lastSentDate: typeof r.lastSentDate === "string" ? r.lastSentDate : "",
  };
}

// Adds (or refreshes) one device. Same endpoint = same device, so it's
// replaced, not duplicated; past MAX_PUSH_DEVICES the oldest one goes.
export function withPushSub(rem, sub, { now = Date.now(), ua = "" } = {}) {
  const base = normalizeReminders(rem);
  const entry = { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, ua: String(ua || "").slice(0, 60), createdAt: now };
  const others = base.push.filter((s) => s.endpoint !== entry.endpoint);
  const push = [...others, entry].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)).slice(-MAX_PUSH_DEVICES);
  return { ...base, push };
}
export function withoutPushSub(rem, endpoint) {
  const base = normalizeReminders(rem);
  return { ...base, push: endpoint ? base.push.filter((s) => s.endpoint !== endpoint) : [] };
}

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// 32 random bytes → 43 url-safe characters. Unguessable; it IS the access
// check for the calendar feed.
export function newCalendarToken(cryptoImpl = globalThis.crypto) {
  return toBase64Url(cryptoImpl.getRandomValues(new Uint8Array(32)));
}
export function calendarLinks(origin, token) {
  const https = `${String(origin).replace(/\/+$/, "")}/api/calendar/${token}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

export function urlBase64ToUint8Array(b64) {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// "Chrome · Android" — just enough to tell the owner's devices apart.
export function deviceLabel(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" · ") || "Browser";
}

export function isIOS(nav = globalThis.navigator) {
  const ua = nav?.userAgent || "";
  // iPadOS Safari says "Macintosh" — only a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav?.platform === "MacIntel" && Number(nav?.maxTouchPoints) > 1);
}
function isStandalone(win = globalThis.window) {
  return Boolean(win?.navigator?.standalone) || Boolean(win?.matchMedia?.("(display-mode: standalone)")?.matches);
}
// "ok" | "ios-install" (iPhone/iPad: web push only from the Home Screen
// app) | "unsupported".
export function pushSupport(win = globalThis.window, nav = globalThis.navigator) {
  const capable = Boolean(nav && "serviceWorker" in nav && win && "PushManager" in win && "Notification" in win);
  if (isIOS(nav) && !isStandalone(win)) return "ios-install";
  return capable ? "ok" : "unsupported";
}

// ---------- Browser + server state ----------
let serverConfig = null; // { push, email } once known
let configPromise = null;
function loadConfig() {
  if (!configPromise) {
    configPromise = fetch("/api/reminders/config", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c) => (serverConfig = { push: c?.push === true, email: c?.email === true }))
      .catch(() => {
        configPromise = null; // try again next time the panel opens
        return (serverConfig = serverConfig || { push: false, email: false });
      });
  }
  return configPromise;
}

let localEndpoint = null; // this browser's push subscription, once looked up
async function existingRegistration() {
  if (pushSupport() !== "ok") return null;
  // getRegistration() only looks — it never registers anything.
  return (await navigator.serviceWorker.getRegistration("/").catch(() => null)) || null;
}
async function readLocalEndpoint() {
  const reg = await existingRegistration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  localEndpoint = sub?.endpoint || "";
  return localEndpoint;
}

function currentReminders() {
  return normalizeReminders(getSettings()?.reminders);
}
function saveReminders(next) {
  updateSettings({ reminders: { ...normalizeReminders(next), lang: getLang() } });
}
function canWrite() {
  const acc = getCachedAccount();
  return !acc || writableByRules(acc);
}

async function idToken() {
  const { auth } = await import("./firebase.js");
  return auth.currentUser?.getIdToken();
}

function sameKey(sub) {
  const key = sub?.options?.applicationServerKey;
  if (!key) return true;
  const a = new Uint8Array(key);
  const b = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function enablePush() {
  // The ONE place the browser permission prompt can appear — straight from the tap.
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    toast(t(perm === "denied" ? "reminders.push.blockedToast" : "reminders.push.notAllowed"), "error");
    return;
  }
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  localEndpoint = json.endpoint;
  saveReminders(withPushSub(currentReminders(), json, { ua: deviceLabel(navigator.userAgent) }));
  toast(t("reminders.push.onToast"));
}

async function disablePush({ everywhere = false } = {}) {
  const reg = await existingRegistration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  const endpoint = sub?.endpoint || localEndpoint || "";
  if (sub) await sub.unsubscribe().catch(() => {});
  // Nothing else uses the worker — take it away so this browser is back to
  // exactly how it was before the owner turned this on.
  if (reg) await reg.unregister().catch(() => {});
  localEndpoint = "";
  saveReminders(everywhere ? withoutPushSub(currentReminders(), "") : withoutPushSub(currentReminders(), endpoint));
  toast(t("reminders.push.offToast"));
}

async function sendTestPush() {
  const token = await idToken();
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: localEndpoint || "" }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 404) throw new Error(t("reminders.push.testNoDevice"));
  if (!res.ok) throw new Error(t("reminders.push.testFailed"));
  if (!data?.sent) throw new Error(data?.removed ? t("reminders.push.testGone") : t("reminders.push.testFailed"));
  toast(t("reminders.push.testSent"));
}

// ---------- Panel ----------
const SECTION = "font-size:16px;margin:0;";
function headHTML(iconName, titleKey, subKey, on) {
  return `
    <div class="rem-head">
      <span class="rem-icon">${icon(iconName, { size: 18 })}</span>
      <div class="rem-head-text">
        <div class="rem-title-row">
          <h3 style="${SECTION}">${t(titleKey)}</h3>
          <span class="status-pill${on ? " status-published" : ""}">${t(on ? "reminders.on" : "reminders.off")}</span>
        </div>
        <p class="text-muted" style="font-size:13px;margin:4px 0 0;">${t(subKey)}</p>
      </div>
    </div>`;
}

function pushCardHTML(rem, writable) {
  const support = pushSupport();
  const thisOn = Boolean(localEndpoint) && rem.push.some((s) => s.endpoint === localEndpoint);
  const others = rem.push.filter((s) => s.endpoint !== localEndpoint);
  let body = "";
  if (support === "ios-install") {
    body = `<p class="hint">${icon("info", { size: 14 })}<span>${t("reminders.push.iosInstall")}</span></p>`;
  } else if (support === "unsupported") {
    body = `<p class="hint">${icon("info", { size: 14 })}<span>${t("reminders.push.unsupported")}</span></p>`;
  } else if (!thisOn && Notification.permission === "denied") {
    body = `<p class="hint">${icon("lock", { size: 14 })}<span>${t(isIOS() ? "reminders.push.deniedIos" : "reminders.push.denied")}</span></p>`;
  } else if (thisOn) {
    body = `
      <div class="rem-actions">
        <button class="btn btn-secondary btn-sm" data-rem="push-test">${icon("send", { size: 14 })}${t("reminders.push.test")}</button>
        <button class="btn btn-secondary btn-sm" data-rem="push-off" ${writable ? "" : "disabled"}>${t("reminders.turnOff")}</button>
      </div>`;
  } else {
    body = `
      <p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${t("reminders.push.askNote")}</p>
      <div class="rem-actions">
        <button class="btn btn-primary btn-sm" data-rem="push-on" ${writable ? "" : "disabled"}>${icon("bell", { size: 14 })}${t("reminders.turnOn")}</button>
      </div>`;
  }
  const othersHTML = others.length
    ? `<p class="text-faint" style="font-size:12.5px;margin:12px 0 0;">${escapeHtml(t("reminders.push.otherDevices", { n: others.length, list: others.map((s) => s.ua || "Browser").join(", ") }))}
        <button class="btn btn-ghost btn-sm" data-rem="push-off-all" ${writable ? "" : "disabled"} style="margin-left:4px;">${t("reminders.push.offAll")}</button></p>`
    : "";
  return `<div class="card rem-card" style="margin-bottom:20px;">${headHTML("bell", "reminders.push.title", "reminders.push.sub", thisOn)}${body}${othersHTML}</div>`;
}

function calendarCardHTML(rem, writable) {
  const on = Boolean(rem.calendarToken);
  let body;
  if (!on) {
    body = `
      <p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${t("reminders.cal.private")}</p>
      <div class="rem-actions">
        <button class="btn btn-primary btn-sm" data-rem="cal-on" ${writable ? "" : "disabled"}>${icon("calendar", { size: 14 })}${t("reminders.turnOn")}</button>
      </div>`;
  } else {
    const links = calendarLinks(location.origin, rem.calendarToken);
    body = `
      <p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${t("reminders.cal.private")}</p>
      <div class="flex gap-8 rem-link-row">
        <input class="input" id="rem-cal-url" readonly value="${escapeHtml(links.https)}" aria-label="${escapeHtml(t("reminders.cal.linkLabel"))}" />
        <button class="btn btn-secondary btn-sm" data-rem="cal-copy" style="flex:none;">${icon("copy", { size: 14 })}${t("reminders.cal.copy")}</button>
      </div>
      <div class="rem-actions">
        <a class="btn btn-secondary btn-sm" href="${escapeHtml(links.google)}" target="_blank" rel="noopener">${icon("calendar", { size: 14 })}${t("reminders.cal.google")}</a>
        <a class="btn btn-secondary btn-sm" href="${escapeHtml(links.webcal)}">${icon("calendar", { size: 14 })}${t("reminders.cal.iphone")}</a>
      </div>
      <p class="text-faint" style="font-size:12px;margin:10px 0 0;">${t("reminders.cal.googleSlow")}</p>
      <div class="rem-actions rem-actions-quiet">
        <button class="btn btn-ghost btn-sm" data-rem="cal-rotate" ${writable ? "" : "disabled"}>${icon("refresh", { size: 14 })}${t("reminders.cal.rotate")}</button>
        <button class="btn btn-ghost btn-sm" data-rem="cal-off" ${writable ? "" : "disabled"}>${t("reminders.turnOff")}</button>
      </div>`;
  }
  return `<div class="card rem-card" style="margin-bottom:20px;">${headHTML("calendar", "reminders.cal.title", "reminders.cal.sub", on)}${body}</div>`;
}

function emailCardHTML(rem, writable) {
  const on = rem.email.enabled;
  const address = getUserEmail() || rem.email.address;
  const body = `
    <p class="text-faint" style="font-size:12.5px;margin:0 0 10px;">${escapeHtml(t("reminders.email.to", { email: address || "—" }))}</p>
    <div class="rem-actions">
      ${on
        ? `<button class="btn btn-secondary btn-sm" data-rem="email-off" ${writable ? "" : "disabled"}>${t("reminders.turnOff")}</button>`
        : `<button class="btn btn-primary btn-sm" data-rem="email-on" ${writable && address ? "" : "disabled"}>${icon("send", { size: 14 })}${t("reminders.turnOn")}</button>`}
    </div>`;
  return `<div class="card rem-card" style="margin-bottom:20px;">${headHTML("send", "reminders.email.title", "reminders.email.sub", on)}${body}</div>`;
}

function panelHTML() {
  const rem = currentReminders();
  const writable = canWrite();
  return `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("reminders.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:0;">${t("reminders.sub")}</p>
      ${writable ? "" : `<p class="hint" style="margin-top:10px;">${icon("lock", { size: 14 })}<span>${t("reminders.needActive")}</span></p>`}
    </div>
    ${serverConfig?.push ? pushCardHTML(rem, writable) : ""}
    ${calendarCardHTML(rem, writable)}
    ${serverConfig?.email ? emailCardHTML(rem, writable) : ""}`;
}

// Runs one button's action with the button disabled; errors become a toast.
async function run(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    console.error("reminders:", err);
    toast(err?.message || t("reminders.failed"), "error");
  } finally {
    btn.disabled = false;
  }
}

function wire(content) {
  const on = (name, fn) => qsa(`[data-rem="${name}"]`, content).forEach((btn) => btn.addEventListener("click", () => run(btn, async () => { await fn(); if (content.isConnected) paint(content); })));
  on("push-on", enablePush);
  on("push-off", () => disablePush());
  on("push-off-all", () => disablePush({ everywhere: true }));
  on("push-test", sendTestPush);
  on("cal-on", () => {
    saveReminders({ ...currentReminders(), calendarToken: newCalendarToken() });
    toast(t("reminders.cal.onToast"));
  });
  on("cal-copy", async () => {
    const input = qs("#rem-cal-url", content);
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand?.("copy");
    }
    toast(t("reminders.cal.copied"));
  });
  on("cal-rotate", async () => {
    const ok = await confirmDialog({ title: t("reminders.cal.rotateTitle"), message: t("reminders.cal.rotateMsg"), confirmLabel: t("reminders.cal.rotate") });
    if (!ok) return;
    saveReminders({ ...currentReminders(), calendarToken: newCalendarToken() });
    toast(t("reminders.cal.rotated"));
  });
  on("cal-off", async () => {
    const ok = await confirmDialog({ title: t("reminders.cal.offTitle"), message: t("reminders.cal.offMsg"), confirmLabel: t("reminders.turnOff"), danger: true });
    if (!ok) return;
    saveReminders({ ...currentReminders(), calendarToken: "" });
    toast(t("reminders.cal.offToast"));
  });
  on("email-on", () => {
    saveReminders({ ...currentReminders(), email: { enabled: true, address: getUserEmail() } });
    toast(t("reminders.email.onToast"));
  });
  on("email-off", () => {
    saveReminders({ ...currentReminders(), email: { enabled: false, address: currentReminders().email.address } });
    toast(t("reminders.email.offToast"));
  });
}

function paint(content) {
  content.innerHTML = panelHTML();
  wire(content);
}

// js/views/settings.js calls this on every repaint of the Pengingat panel.
// It paints straight away from what's known, then once the server config
// and this browser's subscription are looked up, repaints if that changed
// anything.
export function renderRemindersPanel(content) {
  paint(content);
  const before = `${JSON.stringify(serverConfig)}|${localEndpoint}`;
  Promise.all([loadConfig(), readLocalEndpoint().catch(() => "")]).then(() => {
    if (content.isConnected && `${JSON.stringify(serverConfig)}|${localEndpoint}` !== before) paint(content);
  });
}
