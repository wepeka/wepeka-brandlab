// Panduan Peran (owner, 2026-11-24: "aku mau jelas bener2 ada guide dan
// penjelasannya dalam tabel yang mudah dipahami soal role, userku bisa
// click dan lihat role bisa apa aja"). One dialog, opened from wherever a
// role shows (Bagikan, the role picker, Pengaturan → Tim, Atur akses, a
// member's Beranda): tap a role to read what it can and can't do, a table
// comparing every role, and how videos go to a client.
// Built from the permission table itself (js/permissions.js), so the guide
// can never say something the rules don't do.
import { PRESETS, LEVELS, ROLE_KEYS, presetPerms, levelOf } from "./permissions.js";
import { roleLook, roleLabel } from "./role-look.js";
import { icon } from "./icons.js";
import { escapeHtml as esc } from "./dom.js";
import { openModal } from "./modals.js";
import { t } from "./i18n.js";

// The modules in the order people meet them; "team" is the owner's alone.
const ROWS = ["brand", "goals", "create", "video", "publish", "report", "sales", "board", "chat", "team"];
// The roles the guide shows: the owner, the five team roles, the client.
const GUIDE_ROLES = ["owner", ...ROLE_KEYS, "klien"];

// A role's level per module; the owner has the richest of each.
function levelFor(role, mod) {
  if (role === "owner") {
    const lv = Object.keys(LEVELS[mod] || {});
    return mod === "team" ? "manage" : lv[lv.length - 1] || "none";
  }
  if (mod === "team") return "none";
  return levelOf(presetPerms(role), mod);
}
// How strong a level reads in the table (its colour).
const TONE = { none: "none", view: "view", comment: "comment", upload: "upload", approve: "upload", editor: "upload", edit: "edit", all: "edit", publish: "edit", use: "edit", manage: "edit" };

function cellHTML(role, mod) {
  const lv = levelFor(role, mod);
  if (lv === "none") return `<td class="rg-cell is-none" aria-label="${esc(t("rg.lv.none"))}">—</td>`;
  return `<td class="rg-cell is-${TONE[lv] || "view"}"><span>${icon(lv === "view" ? "eye" : TONE[lv] === "edit" ? "check" : TONE[lv] === "comment" ? "comment" : "upload", { size: 12 })}${esc(t(`rg.lv.${lv}`))}</span></td>`;
}

function tableHTML() {
  return `
    <div class="rg-table-wrap" role="region" aria-label="${esc(t("rg.tableTitle"))}" tabindex="0">
      <table class="rg-table">
        <thead><tr><th scope="col">${t("rg.part")}</th>${GUIDE_ROLES.map((r) => `<th scope="col" style="--rc:${roleLook(r).color}"><span class="rg-th">${icon(roleLook(r).icon, { size: 14 })}${esc(roleLabel(r))}</span></th>`).join("")}</tr></thead>
        <tbody>${ROWS.map((mod) => `<tr><th scope="row"><b>${esc(t(`perm.mod.${mod}`))}</b><small>${esc(t(`rg.mod.${mod}Hint`))}</small></th>${GUIDE_ROLES.map((r) => cellHTML(r, mod)).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

// One role in words: who it's for, what it can do, what it can't.
function roleCardHTML(role) {
  const look = roleLook(role);
  const can = [];
  const cant = [];
  for (const mod of ROWS) {
    const lv = levelFor(role, mod);
    if (lv === "none") cant.push(t(`rg.no.${mod}`));
    else can.push(t(`rg.can.${mod}.${lv}`));
  }
  return `
    <div class="rg-card" style="--rc:${look.color}">
      <div class="rg-card-head">
        <span class="rg-card-ic">${icon(look.icon, { size: 22 })}</span>
        <div><b>${esc(roleLabel(role))}</b><small>${esc(t(`rg.for.${role}`))}</small></div>
      </div>
      ${t(`rg.note.${role}`) !== `rg.note.${role}` ? `<p class="rg-note">${icon("info", { size: 13 })}${esc(t(`rg.note.${role}`))}</p>` : ""}
      <div class="rg-lists">
        <div class="rg-list is-can"><span class="rg-list-title">${icon("check", { size: 14 })}${t("rg.can")}</span><ul>${can.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        ${cant.length ? `<div class="rg-list is-cant"><span class="rg-list-title">${icon("x", { size: 14 })}${t("rg.cant")}</span><ul>${cant.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      </div>
    </div>`;
}

const pickHTML = (current) => `<div class="rg-pick" role="tablist" aria-label="${esc(t("rg.pickLabel"))}">${GUIDE_ROLES.map((r) => `<button type="button" role="tab" class="rg-pick-btn ${r === current ? "is-on" : ""}" aria-selected="${r === current}" data-rg-role="${r}" style="--rc:${roleLook(r).color}">${icon(roleLook(r).icon, { size: 14 })}<span>${esc(roleLabel(r))}</span></button>`).join("")}</div>`;

const flowHTML = () => `
  <ol class="rg-flow">${[1, 2, 3, 4, 5].map((n) => `<li><b>${t(`rg.flow.${n}.title`)}</b><span>${t(`rg.flow.${n}.body`)}</span></li>`).join("")}</ol>
  <p class="rg-foot">${icon("info", { size: 13 })}${t("rg.flow.note")}</p>`;

// `role`: the role to open on (a picker's current choice, the member's own).
export function openRoleGuide({ role = "admin" } = {}) {
  let current = GUIDE_ROLES.includes(role) ? role : Object.hasOwn(PRESETS, role) && role !== "klienEdit" ? role : "admin";
  const overlay = openModal({
    title: t("rg.title"),
    width: "min(880px, 96vw)",
    bodyHTML: `
      <p class="rg-lead">${t("rg.lead")}</p>
      ${pickHTML(current)}
      <div id="rg-card">${roleCardHTML(current)}</div>
      <h3 class="rg-h">${icon("grid", { size: 16 })}${t("rg.tableTitle")}</h3>
      <p class="rg-sub">${t("rg.tableSub")}</p>
      ${tableHTML()}
      <h3 class="rg-h">${icon("users", { size: 16 })}${t("rg.flowTitle")}</h3>
      ${flowHTML()}`,
  });
  overlay.querySelector(".modal")?.classList.add("rg-modal");
  overlay.querySelectorAll("[data-rg-role]").forEach((b) => b.addEventListener("click", () => {
    current = b.dataset.rgRole;
    overlay.querySelectorAll("[data-rg-role]").forEach((x) => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-selected", String(on)); });
    overlay.querySelector("#rg-card").innerHTML = roleCardHTML(current);
    centerChip(b);
  }));
  // On a phone the chips scroll sideways: the one shown sits in view.
  centerChip(overlay.querySelector(".rg-pick-btn.is-on"));
  return overlay;
}
function centerChip(chip) {
  const row = chip?.parentElement;
  if (!row || row.scrollWidth <= row.clientWidth) return;
  row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
}

// The small link next to a role picker or a role chip.
export const roleGuideLinkHTML = (role = "") => `<button type="button" class="rg-link" data-role-guide="${esc(role)}">${icon("help", { size: 14 })}${t("rg.link")}</button>`;
export function wireRoleGuideLinks(root, current = () => "") {
  root?.querySelectorAll?.("[data-role-guide]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRoleGuide({ role: current() || b.dataset.roleGuide || "admin" });
  }));
}
// For tests and for the guide's own table.
export const guideLevel = levelFor;
