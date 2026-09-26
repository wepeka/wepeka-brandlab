// Pengumuman page (#/updates) — every update and fix the Wepeka team has
// posted, newest first. Admins also get the composer at the top (post,
// edit, delete); everyone else just reads. Data and rules: js/announcements.js.
import {
  KINDS, listAnnouncements, announcementsStatus, onAnnouncements, startAnnouncements, announcementsSeenAt, markAnnouncementsSeen,
  isAnnouncementAdmin, publishAnnouncement, editAnnouncement, removeAnnouncement,
} from "../announcements.js";
import { renderLightMarkdown } from "../ai-directives.js";
import { backLinkHTML } from "../back-link.js";
import { confirmDialog } from "../modals.js";
import { icon } from "../icons.js";
import { qs, escapeHtml as esc, toast } from "../dom.js";
import { t, getLang } from "../i18n.js";

const KIND_ICON = { feature: "sparkle", fix: "check", info: "bell" };

function dateLabel(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID", { day: "numeric", month: "long", year: "numeric" });
}

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
      <div class="ann-composer-actions">
        ${editing ? `<button type="button" class="btn btn-secondary" id="ann-cancel">${t("common.cancel")}</button>` : ""}
        <button type="button" class="btn btn-primary" id="ann-send">${icon(editing ? "check" : "send", { size: 14 })}${editing ? t("ann.save") : t("ann.send")}</button>
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
      ${a.link ? `<a class="btn btn-secondary btn-sm ann-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${t("ann.open")}${icon("arrowRight", { size: 12 })}</a>` : ""}
    </article>`;
}

export function render(root) {
  startAnnouncements();
  // "Baru" marks what arrived since the last visit — read before marking,
  // so this visit still shows them.
  let seenAt = announcementsSeenAt();
  let editingId = null;
  let marked = false;
  // A connection that never answers (offline, blocked network) used to
  // leave "Memuat…" up forever. After a while, say so and offer a retry.
  let slow = false;
  const slowTimer = setTimeout(() => { slow = true; paint(); }, 12000);

  const paint = () => {
    const admin = isAnnouncementAdmin();
    const items = listAnnouncements();
    const status = announcementsStatus();
    const editing = editingId ? items.find((a) => a.id === editingId) : null;
    // Keep what the admin is typing across a live repaint.
    const draft = qs("#ann-composer") ? { title: qs("#ann-title")?.value, body: qs("#ann-body")?.value, link: qs("#ann-link")?.value, kind: qs('input[name="ann-kind"]:checked')?.value } : null;
    const hadFocus = document.activeElement?.id;
    root.innerHTML = `
      <div class="page-head">
        <div>
          <div class="page-eyebrow">${backLinkHTML("#/", t("nav.allBrands"))}</div>
          <h1>${t("ann.title")}</h1>
          <p class="page-sub">${t("ann.sub")}</p>
        </div>
      </div>
      <div class="ann-wrap">
        ${admin ? composerHTML(editing) : ""}
        <div class="ann-list">
          ${status === "error"
            ? `<div class="card ann-empty">${t("ann.error")}</div>`
            : status !== "ready" && !items.length
              ? slow
                ? `<div class="card ann-empty"><p>${t("ann.slow")}</p><button type="button" class="btn btn-secondary btn-sm" data-ann-retry>${icon("refresh", { size: 13 })}${t("chat.retry")}</button></div>`
                : `<div class="card ann-empty">${t("app.loading")}</div>`
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
    }
    if (hadFocus && qs(`#${hadFocus}`)) qs(`#${hadFocus}`).focus();
    wire();
    // Opened = read. Once the list is in, so "Baru" counts are right.
    if (!marked && status === "ready") { marked = true; markAnnouncementsSeen(); }
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
      if (fields.link.trim() && !/^https:\/\//i.test(fields.link.trim())) { toast(t("ann.badLink"), "error"); qs("#ann-link").focus(); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (editingId) {
          const id = editingId;
          editingId = null;
          await editAnnouncement(id, fields);
          toast(t("ann.saved"));
        } else {
          const p = publishAnnouncement(fields);
          // The new post is already in the list; clear the form for the next.
          ["#ann-title", "#ann-body", "#ann-link"].forEach((s) => { const el = qs(s); if (el) el.value = ""; });
          await p;
          toast(t("ann.sent"));
        }
      } catch (err) {
        console.warn("[announcements] write failed", err);
        toast(t("ann.failed"), "error");
      } finally {
        paint();
      }
    });
    qs("#ann-cancel", root)?.addEventListener("click", () => { editingId = null; paint(); });
    root.querySelectorAll("[data-ann-edit]").forEach((b) => b.addEventListener("click", () => {
      editingId = b.dataset.annEdit;
      paint();
      qs("#ann-composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
      qs("#ann-title")?.focus();
    }));
    root.querySelectorAll("[data-ann-del]").forEach((b) => b.addEventListener("click", async () => {
      const a = listAnnouncements().find((x) => x.id === b.dataset.annDel);
      if (!a) return;
      const ok = await confirmDialog({ title: t("ann.delete.title"), message: t("ann.delete.body", { title: a.title }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try { await removeAnnouncement(a.id); toast(t("ann.deleted")); } catch { toast(t("ann.failed"), "error"); }
    }));
  };

  paint();
  const off = onAnnouncements(paint);
  root.addEventListener("click", (e) => { if (e.target.closest("[data-ann-retry]")) location.reload(); });
  return () => { clearTimeout(slowTimer); off(); };
}
