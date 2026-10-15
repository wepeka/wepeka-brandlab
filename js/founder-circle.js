// Founder Circle in the app — the human part of Lifetime (api/_founderCircle.js
// says what it is and where it lives): the next live session with the
// Wepeka team, recordings of past ones, the one Brand Book review, and a
// sign-up to have your brand taken apart ("dibedah") in a Founder session.
// A session is either a public Instagram live (every account sees it) or
// a closed Founder session (Lifetime accounts only) — owner, 2026-10-16.
//   openFounderCircle()   the sheet, from ⋯ → Founder Circle and from the
//                         Brand Book's "Minta review tim Wepeka". An account
//                         without Lifetime sees what's in it instead, plus
//                         the next public live.
//   mountCircleNotice()   Beranda's line from the day before a session —
//                         for every account when it's a public live.
// Everything goes through api/founder-circle.js with the sign-in token; the
// answer is kept for a few minutes so Beranda and the sheet share one read.
import { icon } from "./icons.js";
import { escapeHtml as esc, toast } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { listBrands } from "./store.js";
import { getCachedAccount, isLifetime } from "./account.js";
import { auth } from "./firebase.js";
import { gaEvent } from "./analytics.js";
import { t, getLang } from "./i18n.js";

const MINUTE = 60 * 1000;
const FRESH_MS = 5 * MINUTE;
let cache = null; // { at, view }

async function request(method, body) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw Object.assign(new Error("auth"), { code: "auth" });
  const res = await fetch("/api/founder-circle", {
    method,
    headers: { Authorization: `Bearer ${idToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => null);
  // 409 "already": the review was asked for before; the answer still carries the view.
  if (!res.ok && !(res.status === 409 && data?.member)) throw Object.assign(new Error(data?.error || `http ${res.status}`), { code: data?.error || "network" });
  cache = data?.member !== undefined ? { at: Date.now(), view: data } : cache;
  return data;
}

export async function loadCircle({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < FRESH_MS) return cache.view;
  return request("GET");
}

// "Kamis, 23 Oktober · 20.00 WIB" — sessions are set in Jakarta time.
export function sessionWhen(at, lang = getLang()) {
  const d = new Date(at);
  const loc = lang === "en" ? "en-GB" : "id-ID";
  const day = d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" });
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return `${day} · ${time} WIB`;
}
const dateOnly = (at, lang = getLang()) => new Date(at).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

// The room opens 15 minutes early and stays "live" until an hour after the end.
export const isLive = (s, now = Date.now()) => !!s && now >= s.at - 15 * MINUTE && now <= s.at + (s.minutes + 60) * MINUTE;
// Beranda's notice: from 24 hours before until it's over.
export const isSoon = (s, now = Date.now()) => !!s && now >= s.at - 24 * 60 * MINUTE && now <= s.at + (s.minutes + 60) * MINUTE;

// "public" (an Instagram live for everyone) or "founder" (closed).
export const kindOf = (s) => (s?.kind === "public" ? "public" : "founder");

// "Simpan ke kalender" — a Google Calendar event with the room link in it.
export function calendarUrl(s) {
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: t(`circle.cal.${kindOf(s)}`),
    dates: `${stamp(s.at)}/${stamp(s.at + s.minutes * MINUTE)}`,
    details: [s.topic, s.link].filter(Boolean).join("\n"),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const brandOptions = (selected = "") => listBrands().map((b) => `<option value="${esc(b.id)}" ${b.id === selected ? "selected" : ""}>${esc(b.name)}</option>`).join("");

function sessionHTML(s, now) {
  if (!s) return `<p class="circle-empty">${t("circle.session.none")}</p>`;
  const live = isLive(s, now);
  const kind = kindOf(s);
  return `
    <div class="circle-session${live ? " is-live" : ""}">
      <div class="circle-chips">
        <span class="circle-kind is-${kind}">${icon(kind === "public" ? "instagram" : "lock", { size: 12 })}${t(`circle.kind.${kind}`)}</span>
        ${live ? `<span class="circle-live">${t("circle.session.live")}</span>` : ""}
      </div>
      <b class="circle-when">${esc(sessionWhen(s.at))}</b>
      ${s.topic ? `<p class="circle-topic">${esc(s.topic)}</p>` : ""}
      ${s.note ? `<p class="circle-muted">${esc(s.note)}</p>` : ""}
      <div class="circle-actions">
        ${s.link ? `<a class="btn ${live ? "btn-primary" : "btn-secondary"} btn-sm" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" data-circle-join data-kind="${kind}">${icon("play", { size: 13 })}${t(live ? "circle.session.joinNow" : kind === "public" ? "circle.session.joinPublic" : "circle.session.join")}</a>` : `<span class="circle-muted">${t("circle.session.linkLater")}</span>`}
        <a class="btn btn-ghost btn-sm" href="${esc(calendarUrl(s))}" target="_blank" rel="noopener noreferrer">${icon("calendar", { size: 13 })}${t("circle.session.calendar")}</a>
      </div>
    </div>`;
}

function recordingsHTML(list) {
  if (!list.length) return `<p class="circle-empty">${t("circle.rec.none")}</p>`;
  return `<ul class="circle-recs">${list.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-circle-rec>${icon("play", { size: 13 })}<span>${esc(r.title)}</span>${r.at ? `<small>${esc(dateOnly(r.at))}</small>` : ""}</a></li>`).join("")}</ul>`;
}

function reviewHTML(review) {
  if (review) {
    const line = review.status === "done" ? t("circle.review.done", { date: dateOnly(review.doneAt || review.requestedAt) })
      : review.status === "scheduled" && review.scheduledAt ? t("circle.review.scheduled", { when: sessionWhen(review.scheduledAt) })
      : t("circle.review.requested", { date: dateOnly(review.requestedAt) });
    return `<p class="circle-status is-${esc(review.status)}">${icon(review.status === "done" ? "check" : "clock", { size: 14 })}<span>${esc(line)}${review.brandName ? ` · <b>${esc(review.brandName)}</b>` : ""}</span></p>`;
  }
  const brands = listBrands();
  if (!brands.length) return `<p class="circle-empty">${t("circle.review.noBrand")}</p>`;
  return `
    <form class="circle-form" data-circle-review novalidate>
      ${brands.length > 1 ? `<div class="field"><label for="circle-review-brand">${t("circle.review.brand")}</label><select class="select" id="circle-review-brand" name="brandId">${brandOptions()}</select></div>` : `<input type="hidden" name="brandId" value="${esc(brands[0].id)}">`}
      <div class="field"><label for="circle-review-wa">${t("circle.review.wa")} <span class="copy-optional">${t("lapor.optional")}</span></label><input class="input" id="circle-review-wa" name="wa" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="08…"></div>
      <div class="field"><label for="circle-review-note">${t("circle.review.note")} <span class="copy-optional">${t("lapor.optional")}</span></label><textarea class="textarea" id="circle-review-note" name="note" rows="2" maxlength="500" placeholder="${esc(t("circle.review.notePh"))}"></textarea></div>
      <button type="submit" class="btn btn-primary btn-sm">${icon("send", { size: 13 })}${t("circle.review.submit")}</button>
    </form>`;
}

function bedahHTML(bedah) {
  if (bedah) {
    return `<p class="circle-status is-scheduled">${icon("check", { size: 14 })}<span>${t("circle.bedah.on", { brand: esc(bedah.brandName) })}</span></p>
      <button type="button" class="btn btn-ghost btn-sm" data-circle-bedah-off>${t("circle.bedah.off")}</button>`;
  }
  const brands = listBrands();
  if (!brands.length) return "";
  return `
    <div class="circle-inline">
      ${brands.length > 1 ? `<select class="select" data-circle-bedah-brand aria-label="${esc(t("circle.review.brand"))}">${brandOptions()}</select>` : `<input type="hidden" data-circle-bedah-brand value="${esc(brands[0].id)}">`}
      <button type="button" class="btn btn-secondary btn-sm" data-circle-bedah-on>${t("circle.bedah.join")}</button>
    </div>`;
}

export function circleBodyHTML(view, now = Date.now()) {
  if (!view?.member) {
    const items = ["mentoring", "recordings", "review", "bedah"].map((k) => `<li>${icon(k === "review" ? "book" : k === "bedah" ? "target" : k === "recordings" ? "play" : "users", { size: 15 })}<span><b>${t(`circle.teaser.${k}`)}</b> ${t(`circle.teaser.${k}Body`)}</span></li>`).join("");
    // The next public live is open to everyone — it leads, when there is one.
    const live = view?.session && kindOf(view.session) === "public"
      ? `<section class="circle-sec"><h3>${icon("instagram", { size: 15 })}${t("circle.publicTitle")}</h3>${sessionHTML(view.session, now)}</section>`
      : "";
    return `${live}<p class="community-lead">${t("circle.teaser.lead")}</p><ul class="circle-teaser">${items}</ul>`;
  }
  return `
    <p class="community-lead">${t("circle.lead")}</p>
    <section class="circle-sec"><h3>${icon("users", { size: 15 })}${t("circle.session.title")}</h3>${sessionHTML(view.session, now)}</section>
    <section class="circle-sec"><h3>${icon("play", { size: 15 })}${t("circle.rec.title")}</h3>${recordingsHTML(view.recordings || [])}</section>
    <section class="circle-sec" id="circle-review"><h3>${icon("book", { size: 15 })}${t("circle.review.title")}</h3><p class="circle-muted">${t("circle.review.body")}</p>${reviewHTML(view.review)}</section>
    <section class="circle-sec"><h3>${icon("target", { size: 15 })}${t("circle.bedah.title")}</h3><p class="circle-muted">${t("circle.bedah.body")}</p>${bedahHTML(view.bedah)}</section>`;
}

// The sheet. `focus: "review"` scrolls to the review part (from the Brand Book).
export function openFounderCircle({ focus = "" } = {}) {
  const member = isLifetime(getCachedAccount());
  const overlay = openModal({
    title: t("circle.title"),
    bodyHTML: `<div data-circle-body>${member ? `<p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("circle.loading")}</p>` : circleBodyHTML({ member: false })}</div>`,
    footHTML: member
      ? `<button type="button" class="btn btn-primary" data-circle-close>${t("common.close")}</button>`
      : `<button type="button" class="btn btn-secondary" data-circle-close>${t("common.close")}</button><a class="btn btn-primary" href="#/pricing" data-circle-pricing>${t("circle.teaser.cta")}</a>`,
  });
  overlay.setAttribute("data-circle-modal", "");
  gaEvent("founder_circle_open", { member: member ? "yes" : "no", focus: focus || "menu" });
  overlay.querySelector("[data-circle-close]").addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-circle-pricing]")?.addEventListener("click", () => closeOverlay(overlay));

  const body = overlay.querySelector("[data-circle-body]");
  const paint = (view) => {
    if (!body.isConnected) return;
    body.innerHTML = circleBodyHTML(view);
    if (focus === "review") body.querySelector("#circle-review")?.scrollIntoView({ block: "start" });
  };
  body.addEventListener("click", (e) => {
    const join = e.target.closest("[data-circle-join]");
    if (join) gaEvent("founder_session_join", { kind: join.dataset.kind || "", member: member ? "yes" : "no" });
  });
  if (!member) {
    // The teaser is on screen already; a public live, if any, is added to it.
    loadCircle({ fresh: true }).then((view) => { if (view?.session) paint({ member: false, session: view.session }); }).catch(() => {});
    return overlay;
  }

  const fail = () => { if (body.isConnected) body.innerHTML = `<p class="circle-empty">${t("circle.error")}</p>`; };
  loadCircle({ fresh: true }).then(paint).catch(fail);

  body.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-circle-review]");
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const view = await request("POST", { action: "review", brandId: form.elements.brandId.value, wa: form.elements.wa.value, note: form.elements.note.value });
      paint(view);
      toast(t(view?.error === "already" ? "circle.review.already" : "circle.review.sent"));
      gaEvent("founder_review_request", {});
    } catch {
      btn.disabled = false;
      toast(t("circle.error"));
    }
  });
  body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-circle-rec]")) gaEvent("founder_recording_open", {});
    const on = e.target.closest("[data-circle-bedah-on]");
    const off = e.target.closest("[data-circle-bedah-off]");
    if (!on && !off) return;
    (on || off).disabled = true;
    try {
      const brandId = body.querySelector("[data-circle-bedah-brand]")?.value || "";
      paint(await request("POST", { action: "bedah", on: !!on, brandId }));
      toast(t(on ? "circle.bedah.joined" : "circle.bedah.left"));
      if (on) gaEvent("founder_bedah_join", {});
    } catch {
      (on || off).disabled = false;
      toast(t("circle.error"));
    }
  });
  return overlay;
}

// Beranda: a line from the day before a session until it's over. The server
// only ever hands a non-Lifetime account a public live, so a Founder session
// shows to Founders alone. Nothing when there's none, or the read fails.
export function mountCircleNotice(root) {
  loadCircle().then((view) => {
    const s = view?.session;
    if (!root.isConnected || !isSoon(s) || root.querySelector("[data-circle-notice]")) return;
    const live = isLive(s);
    const kind = kindOf(s);
    const el = document.createElement("div");
    el.className = "trial-remind is-circle";
    el.setAttribute("data-circle-notice", "");
    el.setAttribute("role", "status");
    el.innerHTML = `
      <span class="trial-remind-icon">${icon(kind === "public" ? "instagram" : "users", { size: 15 })}</span>
      <p class="trial-remind-text"><b>${esc(t(`circle.notice.${live ? "live" : "soon"}.${kind}`))}</b> ${esc(sessionWhen(s.at))}${s.topic ? ` · ${esc(s.topic)}` : ""}</p>
      ${live && s.link
        ? `<a class="btn btn-primary btn-sm trial-remind-cta" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" data-circle-notice-join>${esc(t("circle.session.joinNow"))}</a>`
        : `<button type="button" class="btn btn-secondary btn-sm trial-remind-cta" data-circle-open>${esc(t("circle.notice.open"))}</button>`}`;
    el.querySelector("[data-circle-open]")?.addEventListener("click", () => openFounderCircle({ focus: "notice" }));
    el.querySelector("[data-circle-notice-join]")?.addEventListener("click", () => gaEvent("founder_session_join", { kind, from: "beranda" }));
    let box = root.querySelector(".home-notices");
    if (!box) {
      box = document.createElement("div");
      box.className = "home-notices";
      const hero = root.firstElementChild;
      if (hero) hero.after(box);
      else root.prepend(box);
    }
    box.prepend(el);
  }).catch(() => {});
}
