// Founder Circle in the app — the human part of Lifetime (api/_founderCircle.js
// says what it is and where it lives): the next live session with the
// Wepeka team, recordings of past ones, the one Brand Book review, and a
// sign-up to have your brand taken apart ("dibedah") in a Founder session.
// A session is either a public Instagram live (every account sees it) or
// a closed Founder session (Lifetime accounts only) — owner, 2026-10-16.
//   mountCircle(body)     the circle itself, in whatever holds it: the
//                         Update page's "Sesi Founder" tab (#/updates/sesi,
//                         js/views/announcements.js — where ⋯ → Founder
//                         Circle takes a Lifetime account) and the sheet.
//   openFounderCircle()   the sheet, from the Brand Book's "Minta review tim
//                         Wepeka", and from ⋯ → Founder Circle for an
//                         account without Lifetime: what's in it instead,
//                         plus the next public live.
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

// "Simpan ke HP" — the same event as a calendar file (.ics): iPhone and
// Android open it in their own calendar app, with a reminder 30 minutes
// before. Times in UTC, so the phone shows them on its own clock. Long
// lines folded, as the format asks.
export function icsFor(s, now = Date.now()) {
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line) => line.match(/.{1,60}/gu).join("\r\n ");
  const title = text(t(`circle.cal.${kindOf(s)}`));
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wepeka//Brandlab//ID", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:brandlab-session-${s.at}@wepeka.com`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(s.at)}`,
    `DTEND:${stamp(s.at + s.minutes * MINUTE)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${text([s.topic, s.note, s.link].filter(Boolean).join("\n"))}`,
    ...(s.link ? [`URL:${s.link}`, `LOCATION:${text(s.link)}`] : []),
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${title}`, "TRIGGER:-PT30M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}
function saveIcs(s) {
  const url = URL.createObjectURL(new Blob([icsFor(s)], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "sesi-brandlab.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// "3 hari lagi" / "5 jam lagi" / "20 menit lagi" until the room opens; ""
// once it's live.
export function startsIn(s, now = Date.now()) {
  if (!s || isLive(s, now) || s.at <= now) return "";
  const minutes = Math.max(1, Math.round((s.at - now) / MINUTE));
  if (minutes < 60) return t("circle.in.minutes", { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24 ? t("circle.in.hours", { n: hours }) : t("circle.in.days", { n: Math.round(hours / 24) });
}

const brandOptions = (selected = "") => listBrands().map((b) => `<option value="${esc(b.id)}" ${b.id === selected ? "selected" : ""}>${esc(b.name)}</option>`).join("");

// The next session: when, what, the team's note about it (the week's
// announcement), "Join meeting", and — until it starts — the two ways to
// put it in a calendar: Google Calendar, or the phone's own (owner,
// 2026-10-21: "join meeting", "add to calendar" / "add to your phone").
export function sessionHTML(s, now = Date.now()) {
  if (!s) return `<p class="circle-empty">${t("circle.session.none")}</p>`;
  const live = isLive(s, now);
  const kind = kindOf(s);
  const soon = startsIn(s, now);
  const join = kind === "public" ? (live ? "circle.session.joinNow" : "circle.session.joinPublic") : "circle.session.joinMeeting";
  return `
    <div class="circle-session${live ? " is-live" : ""}">
      <div class="circle-chips">
        <span class="circle-kind is-${kind}">${icon(kind === "public" ? "instagram" : "lock", { size: 12 })}${t(`circle.kind.${kind}`)}</span>
        ${live ? `<span class="circle-live">${t("circle.session.live")}</span>` : soon ? `<span class="circle-soon">${icon("clock", { size: 12 })}${esc(soon)}</span>` : ""}
      </div>
      <b class="circle-when">${esc(sessionWhen(s.at))}</b>
      ${s.topic ? `<p class="circle-topic">${esc(s.topic)}</p>` : ""}
      ${s.note ? `<p class="circle-note">${icon("megaphone", { size: 14 })}<span>${esc(s.note)}</span></p>` : ""}
      <div class="circle-actions">
        ${s.link ? `<a class="btn ${live || kind === "founder" ? "btn-primary" : "btn-secondary"} btn-sm${live ? " is-live" : ""}" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer" data-circle-join data-kind="${kind}">${icon("play", { size: 13 })}${t(join)}</a>` : `<span class="circle-muted">${t("circle.session.linkLater")}</span>`}
      </div>
      ${live ? "" : `
      <div class="circle-cal">
        <span>${t("circle.session.addTo")}</span>
        <a class="btn btn-secondary btn-sm" href="${esc(calendarUrl(s))}" target="_blank" rel="noopener noreferrer" data-circle-cal="google">${icon("calendar", { size: 13 })}${t("circle.session.google")}</a>
        <button type="button" class="btn btn-secondary btn-sm" data-circle-cal="phone">${icon("download", { size: 13 })}${t("circle.session.phone")}</button>
      </div>`}
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

// ---- The weekly question queue -------------------------------------------
// Anything about branding and marketing, answered in the last 30 minutes of
// the weekly session in queue order. Everyone in the circle reads the open
// questions without who asked (the server never sends it); only the team
// sees senders, and can put the queue on screen for the room.

function queueItemHTML(q, { admin = false, done = false } = {}) {
  const who = admin ? [q.name, q.brandName].filter(Boolean).join(" · ") : "";
  return `<li class="circle-q${q.mine ? " is-mine" : ""}${done ? " is-done" : ""}" data-q="${esc(q.id)}">
    <span class="circle-q-n">${done ? icon("check", { size: 12 }) : `#${q.position}`}</span>
    <div class="circle-q-main">
      <p class="circle-q-text">${esc(q.text)}</p>
      <div class="circle-q-meta">
        ${q.mine ? `<span class="circle-q-mine">${t("circle.queue.mine")}</span>` : ""}
        ${who ? `<span class="circle-q-who">${esc(who)}</span>` : ""}
        ${q.mine && !done ? `<button type="button" class="btn btn-ghost btn-sm" data-circle-withdraw="${esc(q.id)}">${t("circle.queue.withdraw")}</button>` : ""}
        ${admin && !done ? `<button type="button" class="btn btn-ghost btn-sm" data-circle-stage-at="${esc(q.id)}">${icon("expand", { size: 12 })}${t("circle.stage.show")}</button>` : ""}
        ${admin && !done ? `<button type="button" class="btn btn-secondary btn-sm" data-circle-answer="${esc(q.id)}">${icon("check", { size: 12 })}${t("circle.queue.answer")}</button>` : ""}
        ${admin && done ? `<button type="button" class="btn btn-ghost btn-sm" data-circle-reopen="${esc(q.id)}">${t("circle.queue.reopen")}</button>` : ""}
      </div>
    </div>
  </li>`;
}

function askFormHTML(qs) {
  if (qs.mineOpen >= qs.max) return `<p class="circle-status is-scheduled">${icon("clock", { size: 14 })}<span>${t("circle.ask.limit", { max: qs.max })}</span></p>`;
  const brands = listBrands();
  return `
    <form class="circle-form" data-circle-ask novalidate>
      <div class="field"><label for="circle-ask-text">${t("circle.ask.label")}</label><textarea class="textarea" id="circle-ask-text" name="text" rows="3" placeholder="${esc(t("circle.ask.placeholder"))}"></textarea></div>
      ${brands.length ? `<div class="field"><label for="circle-ask-brand">${t("circle.ask.brand")}</label><select class="select" id="circle-ask-brand" name="brandId"><option value="">${t("circle.ask.noBrand")}</option>${brandOptions()}</select></div>` : ""}
      <p class="circle-muted">${t("circle.ask.hint")}</p>
      <button type="submit" class="btn btn-primary btn-sm">${icon("send", { size: 13 })}${t("circle.ask.submit")}</button>
    </form>`;
}

export function questionsHTML(view) {
  const qs = view?.questions || { open: [], answered: [], mineOpen: 0, max: 3 };
  const admin = !!view?.admin;
  return `
    ${askFormHTML(qs)}
    <div class="circle-queue-head">
      <b>${t("circle.queue.title", { n: qs.open.length })}</b>
      ${admin ? `<button type="button" class="btn btn-secondary btn-sm" data-circle-stage>${icon("expand", { size: 13 })}${t("circle.stage.open")}</button>` : ""}
    </div>
    ${admin ? `<p class="circle-muted">${t("circle.queue.team")}</p>` : ""}
    ${qs.open.length ? `<ol class="circle-queue">${qs.open.map((q) => queueItemHTML(q, { admin })).join("")}</ol>` : `<p class="circle-empty">${t("circle.queue.empty")}</p>`}
    ${qs.answered.length ? `<details class="circle-done"><summary>${t("circle.queue.done", { n: qs.answered.length })}</summary><ol class="circle-queue">${qs.answered.map((q) => queueItemHTML(q, { admin, done: true })).join("")}</ol></details>` : ""}`;
}

// The queue full-screen, for sharing the screen in the session: one question
// at a time, large. Sender names stay off unless the team switches them on
// (they live only in this tab's memory — the room sees the question alone).
function openStage(view, act, startId = "") {
  let v = view;
  let i = Math.max(0, (view.questions?.open || []).findIndex((q) => q.id === startId));
  let showWho = false;
  const el = document.createElement("div");
  el.className = "circle-stage";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  const close = () => { document.removeEventListener("keydown", onKey); el.remove(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const render = () => {
    const list = v.questions?.open || [];
    i = Math.min(Math.max(0, i), Math.max(0, list.length - 1));
    const q = list[i];
    const who = q && showWho ? [q.name, q.brandName].filter(Boolean).join(" · ") : "";
    el.innerHTML = `
      <div class="circle-stage-bar">
        <span>${list.length ? t("circle.stage.count", { n: i + 1, total: list.length }) : ""}</span>
        <label class="circle-stage-who"><input type="checkbox" data-stage-who ${showWho ? "checked" : ""}> ${t("circle.stage.who")}</label>
        <button type="button" class="btn btn-ghost btn-sm" data-stage-close>${icon("x", { size: 14 })}${t("circle.stage.close")}</button>
      </div>
      <div class="circle-stage-body">
        ${q ? `<span class="circle-stage-n">#${q.position}</span><p class="circle-stage-q">${esc(q.text)}</p>${who ? `<p class="circle-stage-sender">${esc(who)}</p>` : ""}` : `<p class="circle-stage-q">${t("circle.stage.empty")}</p>`}
      </div>
      ${q ? `<div class="circle-stage-foot">
        <button type="button" class="btn btn-secondary" data-stage-prev ${i === 0 ? "disabled" : ""}>${t("circle.stage.prev")}</button>
        <button type="button" class="btn btn-primary" data-stage-done>${icon("check", { size: 15 })}${t("circle.stage.done")}</button>
        <button type="button" class="btn btn-secondary" data-stage-skip ${i >= list.length - 1 ? "disabled" : ""}>${t("circle.stage.skip")}</button>
      </div>` : ""}`;
  };
  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-stage-close]")) return close();
    if (e.target.closest("[data-stage-prev]")) { i -= 1; return render(); }
    if (e.target.closest("[data-stage-skip]")) { i += 1; return render(); }
    const done = e.target.closest("[data-stage-done]");
    if (done) {
      const q = v.questions.open[i];
      done.disabled = true;
      try { v = await act({ action: "answer", id: q.id }); render(); } catch { done.disabled = false; toast(t("circle.error")); }
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.matches("[data-stage-who]")) { showWho = e.target.checked; render(); }
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
  render();
  el.querySelector("[data-stage-close]")?.focus();
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
      ? `<section class="circle-sec"><h3>${icon("instagram", { size: 15 })}${t("circle.publicTitle")}</h3><div data-circle-session>${sessionHTML(view.session, now)}</div></section>`
      : "";
    return `${live}<p class="community-lead">${t("circle.teaser.lead")}</p><ul class="circle-teaser">${items}</ul>`;
  }
  return `
    <p class="community-lead">${t("circle.lead")}</p>
    <section class="circle-sec"><h3>${icon("users", { size: 15 })}${t("circle.session.title")}</h3><div data-circle-session>${sessionHTML(view.session, now)}</div></section>
    <section class="circle-sec" id="circle-ask"><h3>${icon("chat", { size: 15 })}${t("circle.ask.title")}</h3><p class="circle-muted">${t("circle.ask.body")}</p>${questionsHTML(view)}</section>
    <section class="circle-sec"><h3>${icon("play", { size: 15 })}${t("circle.rec.title")}</h3>${recordingsHTML(view.recordings || [])}</section>
    <section class="circle-sec" id="circle-review"><h3>${icon("book", { size: 15 })}${t("circle.review.title")}</h3><p class="circle-muted">${t("circle.review.body")}</p>${reviewHTML(view.review)}</section>
    <section class="circle-sec"><h3>${icon("target", { size: 15 })}${t("circle.bedah.title")}</h3><p class="circle-muted">${t("circle.bedah.body")}</p>${bedahHTML(view.bedah)}</section>`;
}

// The circle inside `body` (the sheet below, or the "Sesi Founder" tab):
// loads it, paints it, and wires its buttons. `focus: "review"` scrolls to
// the review part (from the Brand Book). A non-member's body already holds
// the teaser; a public live, if any, is added to it. The session's
// countdown and "on now" keep themselves current while it's on screen.
export function mountCircle(body, { member = isLifetime(getCachedAccount()), focus = "" } = {}) {
  let current = null;
  const paint = (view) => {
    if (!body.isConnected) return;
    current = view;
    body.innerHTML = circleBodyHTML(view);
    if (focus === "review") body.querySelector("#circle-review")?.scrollIntoView({ block: "start" });
    if (focus === "ask") body.querySelector("#circle-ask")?.scrollIntoView({ block: "start" });
  };
  const tick = setInterval(() => {
    if (!body.isConnected) { clearInterval(tick); return; }
    const slot = body.querySelector("[data-circle-session]");
    if (slot && current?.session) slot.innerHTML = sessionHTML(current.session);
  }, 30 * 1000);
  body.addEventListener("click", (e) => {
    const join = e.target.closest("[data-circle-join]");
    if (join) gaEvent("founder_session_join", { kind: join.dataset.kind || "", member: member ? "yes" : "no" });
    const cal = e.target.closest("[data-circle-cal]");
    if (cal && current?.session) {
      if (cal.dataset.circleCal === "phone") saveIcs(current.session);
      gaEvent("founder_session_calendar", { via: cal.dataset.circleCal, kind: kindOf(current.session) });
    }
  });
  if (!member) {
    loadCircle({ fresh: true }).then((view) => { if (view?.session) paint({ member: false, session: view.session }); }).catch(() => {});
    return;
  }

  const fail = () => { if (body.isConnected) body.innerHTML = `<p class="circle-empty">${t("circle.error")}</p>`; };
  loadCircle({ fresh: true }).then(paint).catch(fail);

  body.addEventListener("submit", async (e) => {
    const askForm = e.target.closest("[data-circle-ask]");
    if (askForm) {
      e.preventDefault();
      const btn = askForm.querySelector('button[type="submit"]');
      const text = askForm.elements.text.value.trim();
      if (text.length < 8) { toast(t("circle.ask.short"), "error"); return; }
      btn.disabled = true;
      try {
        const view = await request("POST", { action: "ask", text, brandId: askForm.elements.brandId?.value || "" });
        paint(view);
        // 409: already at the cap — the view still comes back, so the page shows it.
        if (view?.error === "limit") toast(t("circle.ask.limit", { max: view.questions?.max || 1 }), "error");
        else { toast(t("circle.ask.sent")); gaEvent("founder_question_ask", {}); }
      } catch (err) {
        btn.disabled = false;
        toast(t(err.code === "short" ? "circle.ask.short" : "circle.error"), "error");
      }
      return;
    }
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
  const act = async (payload) => { const view = await request("POST", payload); paint(view); return view; };
  body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-circle-rec]")) gaEvent("founder_recording_open", {});
    if (e.target.closest("[data-circle-stage]") && current?.admin) { openStage(current, act); return; }
    const showOne = e.target.closest("[data-circle-stage-at]");
    if (showOne && current?.admin) { openStage(current, act, showOne.getAttribute("data-circle-stage-at")); return; }
    const qBtn = e.target.closest("[data-circle-withdraw],[data-circle-answer],[data-circle-reopen]");
    if (qBtn) {
      const action = qBtn.hasAttribute("data-circle-withdraw") ? "withdraw" : qBtn.hasAttribute("data-circle-answer") ? "answer" : "reopen";
      qBtn.disabled = true;
      try {
        await act({ action, id: qBtn.getAttribute(`data-circle-${action}`) });
        if (action === "withdraw") toast(t("circle.queue.withdrawn"));
      } catch { qBtn.disabled = false; toast(t("circle.error"), "error"); }
      return;
    }
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
}

// Where a Lifetime account's circle lives: the Update page's tab.
export const CIRCLE_ROUTE = "#/updates/sesi";

// The sheet.
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
  mountCircle(overlay.querySelector("[data-circle-body]"), { member, focus });
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
    // A Lifetime account goes to its tab; everyone else sees the public live in the sheet.
    el.querySelector("[data-circle-open]")?.addEventListener("click", () => {
      if (isLifetime(getCachedAccount())) location.hash = CIRCLE_ROUTE;
      else openFounderCircle({ focus: "notice" });
    });
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
