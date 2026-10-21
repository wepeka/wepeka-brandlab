// Settings → Tim (Kerja Tim): the owner's team across their brands — seats,
// members and their role per brand, pending invites (new link, WhatsApp,
// email again, cancel) — and, for someone on other owners' teams, the
// brands shared with them with "Keluar dari tim". The invite dialog
// (openInviteModal) is also opened from a brand's ⋯ menu ("Bagikan").
// Everything that changes the team goes through /api/team (js/team.js);
// the brands' members come back through the store's own listeners.
import { listBrands, isOwnBrand, storeUid } from "../store.js";
import { getCachedAccount, accessState, isAdmin } from "../account.js";
import { teamApi, teamSeatsFor, getMemberships } from "../team.js";
import { auth, db as fdb, loadFirestore } from "../firebase.js";
import { icon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { t } from "../i18n.js";

const DAY = 86400000;
const ROLES = ["editor", "viewer"];

// Invites: read once per visit to the panel (rules let an owner read their
// own), and again after anything here changes them.
let invites = { uid: null, at: 0, list: [] };
async function loadInvites(force = false) {
  const uid = storeUid();
  if (!uid) return [];
  if (!force && invites.uid === uid && Date.now() - invites.at < 30_000) return invites.list;
  const { collection, query, where, getDocs } = await loadFirestore();
  try {
    const snap = await getDocs(query(collection(fdb, "invites"), where("ownerId", "==", uid)));
    invites = { uid, at: Date.now(), list: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.warn("Team invites unavailable", e);
    invites = { uid, at: Date.now(), list: [] };
  }
  return invites.list;
}
const pendingOf = (list, now = Date.now()) => list.filter((i) => i.status === "pending").sort((a, b) => b.createdAt - a.createdAt);

function ownSharedBrands() {
  return listBrands({ includeArchived: true }).filter((b) => isOwnBrand(b) && !b.deletedAt);
}
// One row per person across the owner's brands: { uid, name, email, brands: [{brand, role}] }
function teamPeople(brands) {
  const people = new Map();
  for (const b of brands) {
    for (const [uid, m] of Object.entries(b.members || {})) {
      if (!people.has(uid)) people.set(uid, { uid, name: m.name || m.email || uid, email: m.email || "", brands: [] });
      people.get(uid).brands.push({ brand: b, role: m.role });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function seatInfo(brands, pending) {
  const account = getCachedAccount();
  const people = teamPeople(brands);
  const emails = new Set(people.map((p) => p.email.toLowerCase()));
  const used = people.length + new Set(pending.filter((i) => !emails.has(String(i.email).toLowerCase())).map((i) => i.email)).size;
  const limit = isAdmin(storeUid()) ? Infinity : teamSeatsFor(account);
  return { used, limit, left: Math.max(0, limit - used) };
}
const initialOf = (name) => escapeHtml(String(name || "?").trim().charAt(0).toUpperCase() || "?");
const personDot = (name) => `<div class="avatar" style="flex:none;width:30px;height:30px;border-radius:50%;font-size:12px;">${initialOf(name)}</div>`;
const roleName = (role) => t(`team.role.${role}`);
function teamError(e) {
  const key = `team.err.${e?.code}`;
  const msg = t(key, { limit: e?.data?.limit ?? "" });
  return msg === key ? t("team.err.generic") : msg;
}

function waShare(link, brandNames) {
  const text = t("team.wa.message", { brands: brandNames.join(", "), link });
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("team.linkCopied"));
  } catch {
    window.prompt(t("team.copyLink"), text);
  }
}

export async function renderTeamPanel(content, { planName = (a) => a?.plan || "" } = {}) {
  const account = getCachedAccount();
  const ownPlan = ["paid", "trial"].includes(accessState(account));
  const brands = ownSharedBrands();
  const list = ownPlan ? await loadInvites() : [];
  const pending = pendingOf(list);
  const people = teamPeople(brands);
  const seats = seatInfo(brands, pending);
  const memberships = getMemberships();
  const owners = new Map();
  for (const [brandId, m] of Object.entries(memberships?.brands || {})) {
    if (!owners.has(m.ownerId)) owners.set(m.ownerId, { ownerId: m.ownerId, ownerName: m.ownerName || "", brands: [] });
    owners.get(m.ownerId).brands.push({ brandId, name: m.brandName || brandId, role: m.role });
  }

  const now = Date.now();
  const ownerName = account?.displayName || brands.find((b) => b.ownerName)?.ownerName || auth.currentUser?.displayName || (auth.currentUser?.email || "").split("@")[0] || t("team.role.owner");
  content.innerHTML = `
    ${ownPlan ? `
    <div class="card" style="margin-bottom:20px;">
      <div class="flex items-center gap-12" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;">
          <h3 style="font-size:16px;margin-bottom:6px;">${t("team.panel.title")}</h3>
          <p class="text-muted" style="font-size:13px;margin:0;">${t("team.panel.sub")}</p>
          <p style="font-size:13px;margin:10px 0 0;"><b>${Number.isFinite(seats.limit) ? t("team.seats", { used: seats.used, limit: seats.limit, plan: escapeHtml(planName(account)) }) : t("team.seatsUnlimited", { used: seats.used })}</b></p>
        </div>
        <button class="btn btn-primary" id="team-invite" ${brands.length ? "" : "disabled"}>${icon("plus", { size: 15 })}${t("team.invite")}</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("team.members")}</h3>
      <div class="list-editor-row">
        ${personDot(ownerName)}
        <span class="row-label">${escapeHtml(ownerName)} <span class="text-faint">· ${t("team.role.owner")} · ${t("team.you")}</span></span>
      </div>
      ${people.length ? people.map((p) => `
        <div class="list-editor-row" style="flex-wrap:wrap;">
          ${personDot(p.name)}
          <span class="row-label">${escapeHtml(p.name)} <span class="text-faint">· ${escapeHtml(p.email)}</span></span>
          <div class="flex items-center gap-8" style="flex-wrap:wrap;">
            ${p.brands.map(({ brand, role }) => `
              <label class="checkbox-chip" style="padding:6px 10px;gap:6px;white-space:nowrap;">${escapeHtml(brand.name)}
                <select class="select" data-role-brand="${escapeHtml(brand.id)}" data-role-member="${escapeHtml(p.uid)}" style="border:0;background:transparent;padding:0 2px;font-weight:700;color:inherit;" aria-label="${escapeHtml(t("team.inviteModal.role"))}">
                  ${ROLES.map((r) => `<option value="${r}" ${r === role ? "selected" : ""}>${roleName(r)}</option>`).join("")}
                </select>
              </label>`).join("")}
          </div>
          <button class="btn btn-secondary btn-sm" data-remove="${escapeHtml(p.uid)}" data-name="${escapeHtml(p.name)}">${t("team.remove")}</button>
        </div>`).join("") : `<p class="text-muted" style="font-size:13px;margin:10px 0 0;">${t("team.noMembers")}</p>`}
    </div>
    ${pending.length ? `
    <div class="card" style="margin-bottom:20px;">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("team.pending")}</h3>
      ${pending.map((i) => {
        const days = Math.ceil((Number(i.expiresAt) - now) / DAY);
        const left = days > 0 ? t("team.pending.daysLeft", { n: days }) : t("team.pending.expired");
        return `
        <div class="list-editor-row" style="flex-wrap:wrap;">
          ${personDot(i.email)}
          <span class="row-label">${escapeHtml(i.email)}<br><span class="text-faint" style="font-weight:500;">${escapeHtml(t("team.pending.meta", { role: roleName(i.role), brands: (i.brandNames || []).join(", "), left }))}</span></span>
          <div class="flex items-center gap-8" style="flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" data-newlink="${i.id}" title="${escapeHtml(t("team.newLink.hint"))}">${icon("copy", { size: 13 })}${t("team.copyLink")}</button>
            <button class="btn btn-secondary btn-sm" data-wa="${i.id}" title="${escapeHtml(t("team.newLink.hint"))}">${icon("send", { size: 13 })}${t("team.sendWa")}</button>
            <button class="btn btn-secondary btn-sm" data-resend="${i.id}">${t("team.resend")}</button>
            <button class="btn btn-ghost btn-sm" data-revoke="${i.id}">${t("team.revoke")}</button>
          </div>
        </div>`;
      }).join("")}
      <p class="hint" style="display:block;margin-top:10px;">${t("team.newLink.hint")}</p>
    </div>` : ""}
    <p class="text-muted" style="font-size:13px;margin:0 0 20px;">${t("team.how")}</p>
    ` : `<div class="card" style="margin-bottom:20px;"><p class="text-muted" style="font-size:13px;margin:0;">${t("team.noPlan")}</p></div>`}
    ${owners.size ? `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:6px;">${t("team.memberOf")}</h3>
      ${[...owners.values()].map((o) => `
        <div class="list-editor-row" style="flex-wrap:wrap;">
          ${personDot(o.ownerName)}
          <span class="row-label">${escapeHtml(t("team.sharedBy", { name: o.ownerName || "—" }))}<br><span class="text-faint" style="font-weight:500;">${o.brands.map((b) => `${escapeHtml(b.name)} · ${roleName(b.role)}`).join(" · ")}</span></span>
          <button class="btn btn-secondary btn-sm" data-leave="${escapeHtml(o.ownerId)}">${t("team.leave")}</button>
        </div>`).join("")}
    </div>` : ""}
  `;

  const rerender = (force = true) => {
    if (force) invites.at = 0;
    renderTeamPanel(content, { planName });
  };
  qs("#team-invite", content)?.addEventListener("click", () => openInviteModal({ onDone: () => rerender() }));
  qsa("[data-role-brand]", content).forEach((sel) => sel.addEventListener("change", async () => {
    try {
      await teamApi("role", { brandId: sel.dataset.roleBrand, memberUid: sel.dataset.roleMember, role: sel.value });
      toast(t("team.roleChanged"));
    } catch (e) {
      toast(teamError(e), "error");
      rerender(false);
    }
  }));
  qsa("[data-remove]", content).forEach((btn) => btn.addEventListener("click", async () => {
    const name = btn.dataset.name;
    const ok = await confirmDialog({ title: t("team.remove.title", { name: escapeHtml(name) }), message: t("team.remove.message", { name: escapeHtml(name) }), confirmLabel: t("team.remove"), danger: true });
    if (!ok) return;
    btn.disabled = true;
    try {
      await teamApi("remove", { memberUid: btn.dataset.remove });
      toast(t("team.removed.done", { name }));
    } catch (e) {
      toast(teamError(e), "error");
    }
    rerender();
  }));
  const inviteById = (id) => pending.find((i) => i.id === id);
  qsa("[data-newlink]", content).forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const out = await teamApi("rotate", { inviteId: btn.dataset.newlink });
      await copy(out.link);
    } catch (e) {
      toast(teamError(e), "error");
    }
    rerender();
  }));
  qsa("[data-wa]", content).forEach((btn) => btn.addEventListener("click", async () => {
    const inv = inviteById(btn.dataset.wa);
    // A window opened after an await is blocked as a popup: open it now.
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    try {
      const out = await teamApi("rotate", { inviteId: btn.dataset.wa });
      const text = t("team.wa.message", { brands: (inv?.brandNames || []).join(", "), link: out.link });
      if (win) win.location = `https://wa.me/?text=${encodeURIComponent(text)}`;
      else waShare(out.link, inv?.brandNames || []);
    } catch (e) {
      win?.close();
      toast(teamError(e), "error");
    }
    rerender();
  }));
  qsa("[data-resend]", content).forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await teamApi("rotate", { inviteId: btn.dataset.resend, send: true });
      toast(t("team.resent"));
    } catch (e) {
      toast(teamError(e), "error");
    }
    rerender();
  }));
  qsa("[data-revoke]", content).forEach((btn) => btn.addEventListener("click", async () => {
    try {
      await teamApi("revoke", { inviteId: btn.dataset.revoke });
      toast(t("team.revoked"));
    } catch (e) {
      toast(teamError(e), "error");
    }
    rerender();
  }));
  qsa("[data-leave]", content).forEach((btn) => btn.addEventListener("click", async () => {
    const o = owners.get(btn.dataset.leave);
    const ok = await confirmDialog({
      title: t("team.leave.title", { name: escapeHtml(o.ownerName || "") }),
      message: t("team.leave.message", { brands: escapeHtml(o.brands.map((b) => b.name).join(", ")) }),
      confirmLabel: t("team.leave"),
      danger: true,
    });
    if (!ok) return;
    try {
      await teamApi("leave", { brandIds: o.brands.map((b) => b.brandId) });
      toast(t("team.left"));
    } catch (e) {
      toast(teamError(e), "error");
    }
  }));
}

// The invite dialog: email, the brands to share (all of the owner's open
// brands, `brandId` ticked first), the role, then the link to copy or send
// over WhatsApp once it's made.
export async function openInviteModal({ brandId = null, onDone = null } = {}) {
  const brands = ownSharedBrands().filter((b) => !b.archived);
  const pending = pendingOf(await loadInvites());
  const seats = seatInfo(ownSharedBrands(), pending);
  const picked = new Set(brandId ? [brandId] : brands.length === 1 ? [brands[0].id] : []);
  const overlay = openModal({
    title: t("team.inviteModal.title"),
    width: "min(560px,92vw)",
    bodyHTML: `
      <form id="inv-form" novalidate>
        <div class="field">
          <label for="inv-email">${t("team.inviteModal.email")}</label>
          <input class="input" id="inv-email" type="email" autocomplete="off" />
          <p class="hint" style="display:block;margin-top:6px;">${t("team.inviteModal.emailHint")}</p>
        </div>
        <div class="field">
          <label>${t("team.inviteModal.brands")}</label>
          <div class="flex gap-8" style="flex-wrap:wrap;">
            ${brands.map((b) => `<label class="checkbox-chip"><input type="checkbox" name="inv-brand" value="${escapeHtml(b.id)}" ${picked.has(b.id) ? "checked" : ""} />${escapeHtml(b.name)}</label>`).join("")}
          </div>
        </div>
        <div class="field" style="margin-bottom:6px;">
          <label>${t("team.inviteModal.role")}</label>
          <div class="flex gap-8" style="flex-wrap:wrap;">
            ${ROLES.map((r, i) => `<label class="checkbox-chip"><input type="radio" name="inv-role" value="${r}" ${i === 0 ? "checked" : ""} />${roleName(r)}</label>`).join("")}
          </div>
          <p class="hint" id="inv-role-hint" style="display:block;margin-top:8px;">${t("team.role.editorHint")}</p>
        </div>
        ${Number.isFinite(seats.limit) ? `<p class="hint" style="display:block;">${t("team.inviteModal.seatsLeft", { n: seats.left })}</p>` : ""}
        <div class="auth-error" id="inv-error" style="display:none;"></div>
      </form>
    `,
    footHTML: `
      <button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button>
      <button class="btn btn-primary" id="inv-send">${icon("send", { size: 15 })}${t("team.inviteModal.send")}</button>
    `,
  });
  const body = qs(".modal-body", overlay);
  const foot = qs(".modal-foot", overlay);
  const err = qs("#inv-error", overlay);
  const showErr = (msg) => {
    err.textContent = msg;
    err.style.display = msg ? "" : "none";
  };
  qs("[data-cancel]", overlay).addEventListener("click", () => closeOverlay(overlay));
  qsa("input[name=inv-role]", overlay).forEach((r) => r.addEventListener("change", () => {
    qs("#inv-role-hint", overlay).textContent = t(r.value === "viewer" ? "team.role.viewerHint" : "team.role.editorHint");
  }));
  qs("#inv-email", overlay).focus();
  const send = async () => {
    const email = qs("#inv-email", overlay).value.trim();
    const brandIds = qsa("input[name=inv-brand]:checked", overlay).map((i) => i.value);
    const role = qs("input[name=inv-role]:checked", overlay)?.value || "editor";
    if (!brandIds.length) return showErr(t("team.inviteModal.pickBrand"));
    showErr("");
    const btn = qs("#inv-send", overlay);
    btn.disabled = true;
    try {
      const out = await teamApi("invite", { email, brandIds, role });
      const names = brands.filter((b) => brandIds.includes(b.id)).map((b) => b.name);
      body.innerHTML = `
        <h3 style="font-size:17px;margin:0 0 6px;">${icon("check", { size: 17 })} ${escapeHtml(t("team.inviteModal.sent", { email }))}</h3>
        <p class="text-muted" style="font-size:13.5px;margin:0 0 14px;">${out.emailSent ? t("team.inviteModal.sentSub") : t("team.inviteModal.notSent")}</p>
        <input class="input" id="inv-link" readonly value="${escapeHtml(out.link)}" />
        <div class="flex gap-8" style="margin-top:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="inv-copy">${icon("copy", { size: 13 })}${t("team.copyLink")}</button>
          <button class="btn btn-secondary btn-sm" id="inv-wa">${icon("send", { size: 13 })}${t("team.sendWa")}</button>
        </div>
        <p class="hint" style="display:block;margin-top:12px;">${escapeHtml(t("team.inviteModal.linkNote", { email }))}</p>
      `;
      foot.innerHTML = `<button class="btn btn-primary" data-close-done>${t("common.close")}</button>`;
      qs("#inv-copy", overlay).addEventListener("click", () => copy(out.link));
      qs("#inv-wa", overlay).addEventListener("click", () => waShare(out.link, names));
      qs("[data-close-done]", overlay).addEventListener("click", () => closeOverlay(overlay));
      invites.at = 0;
      onDone?.(out);
    } catch (e) {
      btn.disabled = false;
      showErr(teamError(e));
    }
  };
  qs("#inv-send", overlay).addEventListener("click", send);
  qs("#inv-form", overlay).addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  return overlay;
}
