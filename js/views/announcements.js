// Pengumuman page (#/updates) — every update and fix the Wepeka team has
// posted, newest first. Admins also get the composer at the top (post,
// edit, delete); everyone else just reads. Data and rules: js/announcements.js.
// A Lifetime account gets a second tab, "Sesi Founder" (#/updates/sesi):
// the next live session — when, the team's note about it, "Join meeting",
// Google Calendar or the phone's own calendar — and the rest of Founder
// Circle (js/founder-circle.js mountCircle). Everyone else sees the posts
// only (owner, 2026-10-21).
import {
  KINDS, listAnnouncements, announcementsStatus, onAnnouncements, startAnnouncements, announcementsSeenAt, markAnnouncementsSeen,
  isAnnouncementAdmin, publishAnnouncement, editAnnouncement, removeAnnouncement, announcementEmailReady, emailAnnouncement,
  groupInviteStatus, sendGroupInvite, trialComebackStatus, sendTrialComeback,
} from "../announcements.js";
import { renderLightMarkdown } from "../ai-directives.js";
import { backToLastBrandHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import { getCachedAccount, isLifetime } from "../account.js";
import { mountCircle, loadCircle, isSoon, CIRCLE_ROUTE } from "../founder-circle.js";
import { gaEvent } from "../analytics.js";
import { confirmDialog } from "../modals.js";
import { icon } from "../icons.js";
import { qs, escapeHtml as esc, toast, skeletonHTML } from "../dom.js";
import { t, getLang } from "../i18n.js";

const KIND_ICON = { feature: "sparkle", fix: "check", info: "bell" };

function dateLabel(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "long", year: "numeric" });
}

// Whether email can be sent at all — known a moment after the page opens
// (announcementEmailReady); the composer and the rows repaint when it is.
let emailOn = false;

function composerHTML(editing) {
  const a = editing || {};
  return `
    <section class="card ann-composer" id="ann-composer">
      <div class="ann-composer-head">
        <b>${editing ? t("ann.edit.title") : t("ann.compose.title")}</b>
        <span class="tag">${t("ann.adminOnly")}</span>
      </div>
      <div class="ann-kinds" role="radiogroup" aria-label="${t("ann.kind.label")}">
        ${KINDS.map((k) => `<label class="ann-kind"><input type="radio" name="ann-kind" value="${k}" ${(a.kind || "feature") === k ? "checked" : ""}/><span>${icon(KIND_ICON[k], { size: 13 })}${t(`ann.kind.${k}`)}</span></label>`).join("")}
      </div>
      <div class="field"><label for="ann-title">${t("ann.field.title")}</label><input class="input" id="ann-title" maxlength="140" placeholder="${esc(t("ann.field.titlePh"))}" value="${esc(a.title || "")}" /></div>
      <div class="field"><label for="ann-body">${t("ann.field.body")}</label><textarea class="textarea" id="ann-body" rows="5" placeholder="${esc(t("ann.field.bodyPh"))}">${esc(a.body || "")}</textarea><p class="field-hint">${t("ann.field.bodyHint")}</p></div>
      <div class="field"><label for="ann-link">${t("ann.field.link")}</label><input class="input" id="ann-link" placeholder="https://" value="${esc(a.link || "")}" /></div>
      ${editing ? "" : emailOn
        ? `<label class="ann-email-opt"><input type="checkbox" id="ann-email" /><span>${t("ann.email.also")}</span></label>`
        : `<p class="field-hint ann-email-off">${t("ann.email.off")}</p>`}
      <div class="ann-composer-actions">
        ${editing ? `<button type="button" class="btn btn-secondary" id="ann-cancel">${t("common.cancel")}</button>` : ""}
        <button type="button" class="btn btn-primary" id="ann-send">${icon(editing ? "check" : "send", { size: 14 })}${editing ? t("ann.save") : t("ann.send")}</button>
      </div>
    </section>`;
}

// The admin's one-off emails (once email works), one card each:
//   invite  "Email: gabung grup WhatsApp" (every active account)
//   trial   "Email: ajak balik akun trial" (trial accounts, running or ended)
// Their texts are the `ann.<key>.*` keys. `st`: what the real send reached
// so far ({ status: { sent, total, remaining } }) and, after a test, how
// many it would reach (`reach`, from the endpoint's counts).
const MAILINGS = [
  { key: "invite", status: groupInviteStatus, send: sendGroupInvite, reach: (r) => ({ total: r.total ?? 0, circle: r.circle ?? 0 }) },
  { key: "trial", status: trialComebackStatus, send: sendTrialComeback, reach: (r) => ({ total: r.total ?? 0, ended: r.ended ?? 0 }) },
];
function mailingHTML(key, st) {
  const done = st.status;
  const line = done?.total != null
    ? done.remaining > 0 ? t(`ann.${key}.progress`, { sent: done.sent, total: done.total, remaining: done.remaining }) : t(`ann.${key}.done`, { sent: done.sent })
    : t(`ann.${key}.never`);
  const reach = st.reach && !(done?.total != null && done.remaining === 0) ? ` ${t(`ann.${key}.reach`, st.reach)}` : "";
  return `
    <section class="card ann-composer ann-mailing ann-${key}" id="ann-${key}">
      <div class="ann-composer-head">
        <b>${t(`ann.${key}.title`)}</b>
        <span class="tag">${t("ann.adminOnly")}</span>
      </div>
      <p class="field-hint">${t(`ann.${key}.hint`)}</p>
      <p class="field-hint ann-mailing-status" id="ann-${key}-status">${esc(line + reach)}</p>
      <div class="ann-composer-actions">
        <button type="button" class="btn btn-secondary" id="ann-${key}-test" ${st.busy ? "disabled" : ""}>${icon("send", { size: 14 })}${t(`ann.${key}.test`)}</button>
        <button type="button" class="btn btn-primary" id="ann-${key}-send" ${st.busy ? "disabled" : ""}>${icon("send", { size: 14 })}${t(`ann.${key}.send`)}</button>
      </div>
    </section>`;
}

function itemHTML(a, { seenAt, admin }) {
  const isNew = (a.createdAt || 0) > seenAt;
  return `
    <article class="card ann-item ${isNew ? "is-new" : ""}" data-ann="${esc(a.id)}">
      <div class="ann-meta">
        <span class="ann-kind-tag ann-kind-${esc(a.kind || "info")}">${icon(KIND_ICON[a.kind] || "bell", { size: 12 })}${t(`ann.kind.${KINDS.includes(a.kind) ? a.kind : "info"}`)}</span>
        <span class="text-faint">${esc(dateLabel(a.createdAt))}</span>
        ${isNew ? `<span class="ann-new">${t("ann.new")}</span>` : ""}
        ${admin ? `<span class="ann-admin-actions">
          <button type="button" class="chip-icon-btn" data-ann-edit="${esc(a.id)}" aria-label="${t("ann.editBtn")}" title="${t("ann.editBtn")}">${icon("edit", { size: 13 })}</button>
          <button type="button" class="chip-icon-btn" data-ann-del="${esc(a.id)}" aria-label="${t("common.delete")}" title="${t("common.delete")}">${icon("trash", { size: 13 })}</button>
        </span>` : ""}
      </div>
      <h2 class="ann-title">${esc(a.title || "")}</h2>
      ${a.body ? `<div class="ann-body consultant-md">${renderLightMarkdown(a.body)}</div>` : ""}
      ${shotsHTML(a)}
      ${a.link ? (/^#\//.test(a.link)
        // A page inside Brandlab ("#/papan", "#/settings/team"): same tab.
        ? `<a class="btn btn-primary btn-sm ann-link" href="${esc(a.link)}">${esc(a.linkLabel || t("ann.open"))}${icon("arrowRight", { size: 12 })}</a>`
        : `<a class="btn btn-secondary btn-sm ann-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.linkLabel || t("ann.open"))}${icon("arrowRight", { size: 12 })}</a>`) : ""}
      ${admin && a.emailedAt ? `<p class="ann-emailed text-faint">${icon("send", { size: 12 })}${esc(t("ann.email.done", { n: a.emailed?.sent ?? 0 }))}</p>` : ""}
      ${admin && !a.emailedAt && emailOn ? `<button type="button" class="btn btn-ghost btn-sm ann-email-btn" data-ann-email="${esc(a.id)}">${icon("send", { size: 12 })}${t("ann.email.send")}</button>` : ""}
    </article>`;
}

// Screenshots under a post, each with a line saying where to find it:
// images: [{ src: "/assets/announcements/…" or https, alt, caption }].
function shotsHTML(a) {
  const shots = (Array.isArray(a.images) ? a.images : []).filter((x) => x && /^(\/[^/]|https:\/\/)/.test(String(x.src || ""))).slice(0, 6);
  if (!shots.length) return "";
  return `<div class="ann-shots${shots.length === 1 ? " one" : ""}">${shots.map((x) => `<figure class="ann-shot"><a href="${esc(x.src)}" target="_blank" rel="noopener"><img src="${esc(x.src)}" alt="${esc(x.alt || x.caption || "")}" loading="lazy" decoding="async"></a>${x.caption ? `<figcaption>${renderLightMarkdown(x.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`;
}

// The two tabs, for a Lifetime account. A dot on "Sesi Founder" from the
// day before a session until it's over.
function tabsHTML(active) {
  const tab = (key, href, glyph, label) => `<a class="tab ${active === key ? "active" : ""}" href="${href}" ${active === key ? 'aria-current="page"' : ""}>${icon(glyph, { size: 15 })}${label}</a>`;
  return `<nav class="tabs ann-tabs" aria-label="${esc(t("ann.title"))}">
    ${tab("updates", "#/updates", "megaphone", t("ann.tab.updates"))}
    ${tab("sesi", CIRCLE_ROUTE, "users", `${t("ann.tab.sessions")}<span class="ann-tab-dot" data-sesi-dot hidden></span>`)}
  </nav>`;
}
const sessionSoon = () => loadCircle().then((view) => isSoon(view?.session)).catch(() => false);
function showSessionDot(root, soon) {
  soon.then((on) => { if (on) root.querySelectorAll("[data-sesi-dot]").forEach((d) => d.removeAttribute("hidden")); });
}

const headHTML = (tab) => `
  <div class="page-head">
    <div>
      <div class="page-eyebrow">${backToLastBrandHTML(getBrand)}</div>
      <h1>${t("ann.title")}</h1>
      <p class="page-sub">${t(tab === "sesi" ? "ann.sessions.sub" : "ann.sub")}</p>
    </div>
  </div>`;

function renderSessions(root) {
  root.innerHTML = `
    ${headHTML("sesi")}
    ${tabsHTML("sesi")}
    <div class="ann-wrap">
      <section class="card circle-page" data-circle-body><p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("circle.loading")}</p></section>
    </div>`;
  gaEvent("founder_circle_open", { member: "yes", focus: "tab" });
  mountCircle(root.querySelector("[data-circle-body]"), { member: true });
}

export function render(root, { tab } = {}) {
  const lifetime = isLifetime(getCachedAccount());
  if (tab === "sesi") {
    if (lifetime) return renderSessions(root);
    location.replace("#/updates");
    return;
  }
  startAnnouncements();
  const soon = lifetime ? sessionSoon() : null;
  // "Baru" marks what arrived since the last visit — read before marking,
  // so this visit still shows them.
  let seenAt = announcementsSeenAt();
  let editingId = null;
  let marked = false;
  // A connection that never answers (offline, blocked network) used to
  // leave "Memuat…" up forever. After a while, say so and offer a retry.
  let slow = false;
  const mailing = Object.fromEntries(MAILINGS.map((m) => [m.key, { status: null, reach: null, busy: false }]));
  const slowTimer = setTimeout(() => { slow = true; paint(); }, 12000);

  const paint = () => {
    const admin = isAnnouncementAdmin();
    const items = listAnnouncements();
    const status = announcementsStatus();
    const editing = editingId ? items.find((a) => a.id === editingId) : null;
    // Keep what the admin is typing across a live repaint.
    const draft = qs("#ann-composer") ? { title: qs("#ann-title")?.value, body: qs("#ann-body")?.value, link: qs("#ann-link")?.value, kind: qs('input[name="ann-kind"]:checked')?.value, email: !!qs("#ann-email")?.checked } : null;
    const hadFocus = document.activeElement?.id;
    root.innerHTML = `
      ${headHTML("updates")}
      ${lifetime ? tabsHTML("updates") : ""}
      <div class="ann-wrap">
        ${admin ? composerHTML(editing) : ""}
        ${admin && emailOn && !editing ? MAILINGS.map((m) => mailingHTML(m.key, mailing[m.key])).join("") : ""}
        <div class="ann-list">
          ${status === "error"
            ? `<div class="card ann-empty">${t("ann.error")}</div>`
            : status !== "ready" && !items.length
              ? slow
                ? `<div class="card ann-empty"><p>${t("ann.slow")}</p><button type="button" class="btn btn-secondary btn-sm" data-ann-retry>${icon("refresh", { size: 13 })}${t("chat.retry")}</button></div>`
                : `<div class="ann-loading-skel" aria-busy="true">${skeletonHTML({ rows: 3 })}${skeletonHTML({ rows: 2 })}</div>`
              : items.length
                ? items.map((a) => itemHTML(a, { seenAt, admin })).join("")
                : `<div class="card ann-empty">${icon("bell", { size: 18 })}<p>${t("ann.empty")}</p></div>`}
        </div>
      </div>`;
    if (draft && !editing) {
      if (draft.title != null) qs("#ann-title").value = draft.title;
      if (draft.body != null) qs("#ann-body").value = draft.body;
      if (draft.link != null) qs("#ann-link").value = draft.link;
      if (draft.kind) { const r = qs(`input[name="ann-kind"][value="${draft.kind}"]`); if (r) r.checked = true; }
      if (draft.email && qs("#ann-email")) qs("#ann-email").checked = true;
    }
    if (hadFocus && qs(`#${hadFocus}`)) qs(`#${hadFocus}`).focus();
    wire();
    if (soon) showSessionDot(root, soon);
    // Opened = read. Once the list is in, so "Baru" counts are right.
    if (!marked && status === "ready") { marked = true; markAnnouncementsSeen(); }
  };

  // Mails a posted announcement and says how it went. Never throws.
  const sendByEmail = async (id) => {
    toast(t("ann.email.sending"));
    const r = await emailAnnouncement(id).catch(() => ({ ok: false, error: "network" }));
    if (r.ok) toast(t(r.partial ? "ann.email.partial" : "ann.email.sent", { n: r.sent ?? 0, total: r.total ?? 0 }));
    else if (r.error === "already") toast(t("ann.email.already"));
    else toast(t(r.error === "email-off" ? "ann.email.off" : "ann.email.failed"), "error");
  };

  const wire = () => {
    qs("#ann-send", root)?.addEventListener("click", async (e) => {
      const fields = {
        title: qs("#ann-title").value,
        body: qs("#ann-body").value,
        link: qs("#ann-link").value,
        kind: qs('input[name="ann-kind"]:checked')?.value || "info",
      };
      if (!fields.title.trim()) { toast(t("ann.needTitle"), "error"); qs("#ann-title").focus(); return; }
      if (fields.link.trim() && !/^https:\/\//i.test(fields.link.trim()) && !/^#\//.test(fields.link.trim())) { toast(t("ann.badLink"), "error"); qs("#ann-link").focus(); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (editingId) {
          const id = editingId;
          editingId = null;
          await editAnnouncement(id, fields);
          toast(t("ann.saved"));
        } else {
          const alsoEmail = !!qs("#ann-email")?.checked;
          const p = publishAnnouncement(fields);
          // The new post is already in the list; clear the form for the next.
          ["#ann-title", "#ann-body", "#ann-link"].forEach((s) => { const el = qs(s); if (el) el.value = ""; });
          // Never carried over to the next post: emailing is a choice per post.
          if (qs("#ann-email")) qs("#ann-email").checked = false;
          const id = await p;
          toast(t("ann.sent"));
          if (alsoEmail && id) await sendByEmail(id);
        }
      } catch (err) {
        console.warn("[announcements] write failed", err);
        toast(t("ann.failed"), "error");
      } finally {
        paint();
      }
    });
    qs("#ann-cancel", root)?.addEventListener("click", () => { editingId = null; paint(); });
    for (const m of MAILINGS) {
      const st = mailing[m.key];
      qs(`#ann-${m.key}-test`, root)?.addEventListener("click", async () => {
        st.busy = true;
        paint();
        const r = await m.send({ test: true }).catch(() => ({ ok: false, error: "network" }));
        st.busy = false;
        if (r.ok) {
          st.reach = m.reach(r);
          toast(t(`ann.${m.key}.testSent`, { to: r.to || "" }));
        } else toast(t(r.error === "email-off" ? "ann.email.off" : `ann.${m.key}.failed`), "error");
        paint();
      });
      qs(`#ann-${m.key}-send`, root)?.addEventListener("click", async () => {
        const ok = await confirmDialog({ title: t(`ann.${m.key}.confirmTitle`), message: t(`ann.${m.key}.confirmBody`), confirmLabel: t(`ann.${m.key}.send`) });
        if (!ok) return;
        st.busy = true;
        paint();
        toast(t("ann.email.sending"));
        const r = await m.send().catch(() => ({ ok: false, error: "network" }));
        st.busy = false;
        if (r.ok) {
          st.status = { sent: r.sentTotal ?? 0, total: r.total ?? 0, remaining: r.remaining ?? 0 };
          if (!r.sent && !r.partial) toast(t(`ann.${m.key}.nothing`));
          else toast(t(r.partial ? `ann.${m.key}.partial` : `ann.${m.key}.sent`, { sent: r.sent ?? 0, remaining: r.remaining ?? 0 }));
        } else toast(t(r.error === "busy" ? `ann.${m.key}.busy` : r.error === "email-off" ? "ann.email.off" : `ann.${m.key}.failed`), "error");
        paint();
      });
    }
    root.querySelectorAll("[data-ann-email]").forEach((b) => b.addEventListener("click", async () => {
      const a = listAnnouncements().find((x) => x.id === b.dataset.annEmail);
      if (!a) return;
      const ok = await confirmDialog({ title: t("ann.email.confirmTitle"), message: t("ann.email.confirmBody", { title: esc(a.title) }), confirmLabel: t("ann.email.send") });
      if (!ok) return;
      b.disabled = true;
      await sendByEmail(a.id);
      paint();
    }));
    root.querySelectorAll("[data-ann-edit]").forEach((b) => b.addEventListener("click", () => {
      editingId = b.dataset.annEdit;
      paint();
      qs("#ann-composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
      qs("#ann-title")?.focus();
    }));
    root.querySelectorAll("[data-ann-del]").forEach((b) => b.addEventListener("click", async () => {
      const a = listAnnouncements().find((x) => x.id === b.dataset.annDel);
      if (!a) return;
      const ok = await confirmDialog({ title: t("ann.delete.title"), message: t("ann.delete.body", { title: esc(a.title) }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try { await removeAnnouncement(a.id); toast(t("ann.deleted")); } catch { toast(t("ann.failed"), "error"); }
    }));
  };

  paint();
  const off = onAnnouncements(paint);
  // Admin: once we know email can be sent, the composer gets its checkbox.
  if (isAnnouncementAdmin()) announcementEmailReady().then((on) => { if (on && !emailOn && root.isConnected) { emailOn = true; paint(); } });
  // Admin: how far each one-off email got (one small read each).
  if (isAnnouncementAdmin()) {
    for (const m of MAILINGS) m.status().then((r) => { if (r.ok && root.isConnected) { mailing[m.key].status = r; paint(); } }).catch(() => {});
  }
  root.addEventListener("click", (e) => { if (e.target.closest("[data-ann-retry]")) location.reload(); });
  return () => { clearTimeout(slowTimer); off(); };
}
