// Settings → Tim (Kerja Tim): the owner's team across their brands — seats,
// members and their role per brand, pending invites (new link, WhatsApp,
// email again, cancel) — and, for someone on other owners' teams, the
// brands shared with them with "Keluar dari tim". The invite dialog
// (openInviteModal) is also opened from a brand's ⋯ menu ("Bagikan").
// Everything that changes the team goes through /api/team (js/team.js);
// the brands' members come back through the store's own listeners. Extra
// seats (Rp 15rb / 30 days) are bought here; a team over its seats has its
// newest members paused (api/team.js reconcileSeats), shown on their row.
import { listBrands, isOwnBrand, storeUid, getBrand, onChange } from "../store.js";
import { getCachedAccount, accessState, isAdmin, isReadOnly } from "../account.js";
import { teamApi, teamSeatsFor, extraSeatEnds, getMemberships } from "../team.js";
import { TEAM_SEAT_ADDON } from "../site-links.js";
import { rp, buyAddon } from "../purchase.js";
import { auth, db as fdb, loadFirestore } from "../firebase.js";
import { icon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { t, getLang } from "../i18n.js";

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
      if (!people.has(uid)) people.set(uid, { uid, name: m.name || m.email || uid, email: m.email || "", brands: [], paused: false });
      people.get(uid).brands.push({ brand: b, role: m.role, off: !!m.disabled });
      if (m.seatPaused) people.get(uid).paused = true;
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
const shortDate = (ts) => new Date(ts).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short" });
// Extra seats: only a paid plan rents them (api/midtrans/create-transaction.js).
function seatShopHTML(account, seats, paused) {
  if (isAdmin(storeUid()) || accessState(account) !== "paid" || isReadOnly(account)) return "";
  const ends = extraSeatEnds(account);
  const a = TEAM_SEAT_ADDON;
  return `
    <div class="flex items-center gap-8" style="flex-wrap:wrap;margin-top:12px;">
      <button class="btn btn-secondary btn-sm" id="team-add-seat">${icon("plus", { size: 13 })}${t("team.seatAddon.add", { price: rp(a.price), days: a.days })}</button>
      ${ends.length ? `<span class="text-faint" style="font-size:12px;">${t("team.seatAddon.running", { n: ends.length, date: shortDate(ends[0]) })}</span>
      <button class="btn btn-ghost btn-sm" id="team-renew-seat">${t("team.seatAddon.renew")}</button>` : ""}
    </div>
    ${paused ? `<p class="hint" style="display:block;margin-top:10px;color:var(--bofu);">${t("team.pausedNote", { n: paused })}</p>` : ""}`;
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
          ${seatShopHTML(account, seats, people.filter((p) => p.paused).length)}
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
          <span class="row-label">${escapeHtml(p.name)} <span class="text-faint">· ${escapeHtml(p.email)}</span>${p.paused ? ` <span class="tag tag-bofu" style="text-transform:none;letter-spacing:0;">${t("team.pausedChip")}</span>` : ""}</span>
          <div class="flex items-center gap-8" style="flex-wrap:wrap;">
            ${p.brands.map(({ brand, role, off }) => `
              <label class="checkbox-chip ${off ? "is-access-off" : ""}" style="padding:6px 10px;gap:6px;white-space:nowrap;" ${off ? `title="${escapeHtml(t("share.accessOff"))}"` : ""}>${off ? icon("lock", { size: 12 }) : ""}${escapeHtml(brand.name)}
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
          <span class="row-label">${escapeHtml(t("team.sharedBy", { name: o.ownerName || "—" }))}<br><span class="text-faint" style="font-weight:500;">${o.brands.map((b) => `${escapeHtml(b.name)} · ${getBrand(b.brandId)?.members?.[storeUid()]?.seatPaused ? t("team.pausedShort") : roleName(b.role)}`).join(" · ")}</span></span>
          <button class="btn btn-secondary btn-sm" data-leave="${escapeHtml(o.ownerId)}">${t("team.leave")}</button>
        </div>`).join("")}
    </div>` : ""}
  `;

  const rerender = (force = true) => {
    if (force) invites.at = 0;
    renderTeamPanel(content, { planName });
  };
  qs("#team-invite", content)?.addEventListener("click", () => openInviteModal({ onDone: () => rerender() }));
  // After the webhook lands the seat: the server unpauses whoever it frees.
  const seatBought = async () => {
    await teamApi("sync").catch(() => {});
    rerender();
  };
  qs("#team-add-seat", content)?.addEventListener("click", () => {
    const before = teamSeatsFor(getCachedAccount());
    buyAddon(TEAM_SEAT_ADDON.payKey, { isDone: (acc) => teamSeatsFor(acc) > before, onDone: seatBought });
  });
  qs("#team-renew-seat", content)?.addEventListener("click", () => {
    const before = extraSeatEnds(getCachedAccount())[0] || 0;
    buyAddon(TEAM_SEAT_ADDON.renewKey, { isDone: (acc) => (Number((acc?.teamSeatSlotsUntil || []).map(Number).sort((a, b) => a - b)[0]) || 0) > before, onDone: seatBought });
  });
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
      const out = await teamApi("rotate", { inviteId: btn.dataset.resend, send: true });
      toast(t(out.mailLimit ? "team.mailLimit" : "team.resent"), out.mailLimit ? "error" : undefined);
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
        <p class="text-muted" style="font-size:13.5px;margin:0 0 14px;">${out.emailSent ? t("team.inviteModal.sentSub") : t(out.mailLimit ? "team.mailLimit" : "team.inviteModal.notSent")}</p>
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

// ---------- "Bagikan" (Docs-style, one brand) ----------
// The topbar's person+ button and a brand's ⋯ menu. The owner adds someone
// by email with a role (the invite link comes straight back to copy or
// send over WhatsApp) and sees everyone with access: role, an access
// switch (off = can't open this brand; stays on the list, keeps the seat,
// chats and work — api/team.js setAccess) and Keluarkan; invites still
// waiting, with their link. A teammate sees who's there and nothing to
// change. With no brand open, the owner picks one of their brands first.
const personRow = (name, sub, right = "", extra = "") => `
  <li class="share-row ${extra}">
    ${personDot(name)}
    <div class="share-who"><b>${escapeHtml(name)}</b>${sub ? `<small>${sub}</small>` : ""}</div>
    <div class="share-actions">${right}</div>
  </li>`;
const switchHTML = (on, uid, name) => `<button type="button" class="team-switch" role="switch" aria-checked="${on}" data-access="${escapeHtml(uid)}" aria-label="${escapeHtml(t("share.switchLabel", { name }))}" title="${escapeHtml(t(on ? "share.switchOn" : "share.switchOff"))}"><i></i></button>`;

export async function openShareDialog({ brandId = null } = {}) {
  const own = () => ownSharedBrands().filter((b) => !b.archived);
  let current = brandId || own()[0]?.id || null;
  let result = null; // the invite just made: { email, link, emailSent, mailLimit }
  const overlay = openModal({
    title: t("team.share"),
    width: "min(580px,94vw)",
    bodyHTML: `<div id="share-body"></div>`,
    footHTML: `
      <button class="btn btn-secondary btn-sm" id="share-copy-brand">${icon("link", { size: 14 })}${t("share.copyBrand")}</button>
      <span style="flex:1"></span>
      <button class="btn btn-primary" data-share-done>${t("share.done")}</button>`,
  });
  const body = qs("#share-body", overlay);
  qs("[data-share-done]", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("#share-copy-brand", overlay).addEventListener("click", async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/#/brand/${current}`);
      toast(t("share.brandCopied"));
    } catch {
      window.prompt(t("share.copyBrand"), `${location.origin}/#/brand/${current}`);
    }
  });

  const paint = async (force = false) => {
    if (!overlay.isConnected) return;
    const brand = current ? getBrand(current) : null;
    const title = qs(".modal h2", overlay);
    if (!brand) {
      title.textContent = t("team.share");
      body.innerHTML = `<p class="text-muted" style="margin:0;">${t("team.noPlan")}</p>`;
      return;
    }
    const mine = isOwnBrand(brand);
    title.textContent = t(mine ? "share.title" : "share.titleMember", { name: brand.name });
    const members = Object.entries(brand.members || {}).sort((a, b) => (Number(a[1]?.addedAt) || 0) - (Number(b[1]?.addedAt) || 0));
    const me = storeUid();
    const ownerName = brand.ownerName || (mine ? getCachedAccount()?.displayName || auth.currentUser?.displayName || "" : "") || t("team.role.owner");
    if (!mine) {
      body.innerHTML = `
        <ul class="share-list">
          ${personRow(ownerName, t("team.role.owner"))}
          ${members.filter(([, m]) => !m?.disabled).map(([uid, m]) => personRow(m.name || m.email || uid, `${escapeHtml(m.email || "")}${uid === me ? ` · ${t("share.you")}` : ""}`, `<span class="text-faint" style="font-size:12.5px;font-weight:700;">${roleName(m.role)}</span>`)).join("")}
        </ul>
        <p class="hint" style="display:block;margin-top:12px;">${t("share.memberNote")}</p>`;
      return;
    }
    const list = await loadInvites(force);
    const pending = pendingOf(list).filter((i) => (i.brandIds || []).includes(current));
    const seats = seatInfo(ownSharedBrands(), pendingOf(list));
    const now = Date.now();
    const brands = own();
    body.innerHTML = `
      ${!brandId && brands.length > 1 ? `
        <div class="field" style="margin-bottom:12px;">
          <label for="share-brand">${t("share.pickBrand")}</label>
          <select class="select" id="share-brand">${brands.map((b) => `<option value="${escapeHtml(b.id)}" ${b.id === current ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}</select>
        </div>` : ""}
      <form class="share-add" id="share-add" novalidate>
        <input class="input" id="share-email" type="email" autocomplete="off" placeholder="${escapeHtml(t("share.addPlaceholder"))}" aria-label="${escapeHtml(t("share.addPlaceholder"))}" />
        <select class="select" id="share-role" aria-label="${escapeHtml(t("team.inviteModal.role"))}">${ROLES.map((r) => `<option value="${r}">${roleName(r)}</option>`).join("")}</select>
        <button class="btn btn-primary" id="share-invite" type="submit">${t("share.invite")}</button>
      </form>
      <div class="auth-error" id="share-error" style="display:none;margin-top:8px;"></div>
      ${result ? `
        <div class="share-result">
          <p style="margin:0 0 8px;font-weight:700;">${icon("check", { size: 15 })} ${escapeHtml(t("share.invited", { email: result.email }))}</p>
          <p class="text-muted" style="font-size:13px;margin:0 0 10px;">${result.emailSent ? t("team.inviteModal.sentSub") : t(result.mailLimit ? "team.mailLimit" : "team.inviteModal.notSent")}</p>
          <div class="flex gap-8" style="flex-wrap:wrap;">
            <input class="input" readonly value="${escapeHtml(result.link)}" style="flex:1;min-width:200px;" />
            <button class="btn btn-secondary btn-sm" id="share-result-copy" type="button">${icon("copy", { size: 13 })}${t("team.copyLink")}</button>
            <button class="btn btn-secondary btn-sm" id="share-result-wa" type="button">${icon("send", { size: 13 })}${t("team.sendWa")}</button>
          </div>
        </div>` : ""}
      <div class="share-section">${t("share.people")}</div>
      <ul class="share-list">
        ${personRow(ownerName, `${t("share.you")}`, `<span class="text-faint" style="font-size:12.5px;font-weight:700;">${t("team.role.owner")}</span>`)}
        ${members.map(([uid, m]) => {
          const name = m.name || m.email || uid;
          const off = !!m.disabled;
          const sub = `${escapeHtml(m.email || "")}${off ? ` · <span class="share-off-note">${t("share.accessOff")}</span>` : m.seatPaused ? ` · <span class="share-off-note">${t("team.pausedChip")}</span>` : ""}`;
          return personRow(name, sub, `
            <select class="select share-role" data-role-member="${escapeHtml(uid)}" aria-label="${escapeHtml(t("team.inviteModal.role"))}">${ROLES.map((r) => `<option value="${r}" ${r === m.role ? "selected" : ""}>${roleName(r)}</option>`).join("")}</select>
            ${switchHTML(!off, uid, name)}
            <button class="icon-btn" data-remove-here="${escapeHtml(uid)}" data-name="${escapeHtml(name)}" title="${escapeHtml(t("team.remove"))}" aria-label="${escapeHtml(t("team.remove"))}">${icon("x", { size: 15 })}</button>`, off ? "is-off" : "");
        }).join("")}
        ${pending.map((i) => {
          const days = Math.ceil((Number(i.expiresAt) - now) / DAY);
          const left = days > 0 ? t("team.pending.daysLeft", { n: days }) : t("team.pending.expired");
          return personRow(i.email, escapeHtml(t("share.pending", { role: roleName(i.role), left })), `
            <button class="btn btn-secondary btn-sm" data-share-link="${i.id}" title="${escapeHtml(t("team.newLink.hint"))}">${icon("copy", { size: 13 })}${t("team.copyLink")}</button>
            <button class="btn btn-secondary btn-sm" data-share-wa="${i.id}" title="${escapeHtml(t("team.newLink.hint"))}">${icon("send", { size: 13 })}WA</button>
            <button class="icon-btn" data-share-revoke="${i.id}" title="${escapeHtml(t("team.revoke"))}" aria-label="${escapeHtml(t("team.revoke"))}">${icon("x", { size: 15 })}</button>`, "is-pending");
        }).join("")}
      </ul>
      <p class="hint" style="display:block;margin-top:12px;">
        ${Number.isFinite(seats.limit) ? t("share.seats", { used: seats.used, limit: seats.limit }) : t("team.seatsUnlimited", { used: seats.used })}
        · <a href="#/settings/team" data-share-team style="color:var(--accent);font-weight:700;">${t("share.manageTeam")}</a>
      </p>`;
    wire(brand);
  };

  const err = (msg) => {
    const el = qs("#share-error", overlay);
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "" : "none";
  };
  const wire = (brand) => {
    qs("#share-brand", overlay)?.addEventListener("change", (e) => {
      current = e.target.value;
      result = null;
      paint();
    });
    qs("[data-share-team]", overlay)?.addEventListener("click", () => closeOverlay(overlay));
    qs("#share-add", overlay)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = qs("#share-email", overlay).value.trim();
      if (!email) return err(t("team.err.bad-request"));
      const btn = qs("#share-invite", overlay);
      btn.disabled = true;
      err("");
      try {
        const out = await teamApi("invite", { email, brandIds: [current], role: qs("#share-role", overlay).value });
        result = { email, link: out.link, emailSent: out.emailSent, mailLimit: out.mailLimit };
        await paint(true);
      } catch (ex) {
        btn.disabled = false;
        err(teamError(ex));
      }
    });
    qs("#share-result-copy", overlay)?.addEventListener("click", () => copy(result.link));
    qs("#share-result-wa", overlay)?.addEventListener("click", () => waShare(result.link, [brand.name]));
    qsa("[data-role-member]", overlay).forEach((sel) => sel.addEventListener("change", async () => {
      try {
        await teamApi("role", { brandId: current, memberUid: sel.dataset.roleMember, role: sel.value });
        toast(t("team.roleChanged"));
      } catch (ex) {
        toast(teamError(ex), "error");
        paint();
      }
    }));
    qsa("[data-access]", overlay).forEach((sw) => sw.addEventListener("click", async () => {
      const uid = sw.dataset.access;
      const name = brand.members?.[uid]?.name || "";
      const enabled = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(enabled));
      sw.disabled = true;
      try {
        await teamApi("access", { brandId: current, memberUid: uid, enabled });
        toast(t(enabled ? "share.turnedOn" : "share.turnedOff", { name }));
      } catch (ex) {
        sw.setAttribute("aria-checked", String(!enabled));
        toast(teamError(ex), "error");
      }
      sw.disabled = false;
    }));
    qsa("[data-remove-here]", overlay).forEach((btn) => btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      const ok = await confirmDialog({
        title: t("share.removeHere.title", { name: escapeHtml(name), brand: escapeHtml(brand.name) }),
        message: t("share.removeHere.message", { name: escapeHtml(name), brand: escapeHtml(brand.name) }),
        confirmLabel: t("team.remove"),
        danger: true,
      });
      if (!ok) return;
      try {
        await teamApi("remove", { memberUid: btn.dataset.removeHere, brandIds: [current] });
        toast(t("team.removed.done", { name }));
      } catch (ex) {
        toast(teamError(ex), "error");
      }
    }));
    const inviteById = (id) => (invites.list || []).find((i) => i.id === id);
    qsa("[data-share-link]", overlay).forEach((btn) => btn.addEventListener("click", async () => {
      try {
        const out = await teamApi("rotate", { inviteId: btn.dataset.shareLink });
        await copy(out.link);
      } catch (ex) {
        toast(teamError(ex), "error");
      }
      paint(true);
    }));
    qsa("[data-share-wa]", overlay).forEach((btn) => btn.addEventListener("click", async () => {
      const inv = inviteById(btn.dataset.shareWa);
      const win = window.open("about:blank", "_blank");
      if (win) win.opener = null;
      try {
        const out = await teamApi("rotate", { inviteId: btn.dataset.shareWa });
        const text = t("team.wa.message", { brands: (inv?.brandNames || [brand.name]).join(", "), link: out.link });
        if (win) win.location = `https://wa.me/?text=${encodeURIComponent(text)}`;
        else waShare(out.link, inv?.brandNames || [brand.name]);
      } catch (ex) {
        win?.close();
        toast(teamError(ex), "error");
      }
      paint(true);
    }));
    qsa("[data-share-revoke]", overlay).forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await teamApi("revoke", { inviteId: btn.dataset.shareRevoke });
        toast(t("team.revoked"));
      } catch (ex) {
        toast(teamError(ex), "error");
      }
      paint(true);
    }));
  };

  // Members come back through the store's own brand listener: repaint the
  // list while the dialog is open (not while someone types an email).
  const stop = onChange(() => {
    if (!overlay.isConnected) return stop();
    if (document.activeElement?.id === "share-email" && qs("#share-email", overlay)?.value) return;
    paint();
  });
  await paint();
  qs("#share-email", overlay)?.focus();
  return overlay;
}
