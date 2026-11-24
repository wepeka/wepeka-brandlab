// How each Kerja Tim role looks (owner, 2026-11-24: "aku mau ada iconnya di
// rolenya jadi orang bisa tahu"): one icon and one colour per role, the
// same everywhere a role shows — the "Bagikan" dialog, Pengaturan → Tim,
// and a member's own Beranda ("Kamu di sini sebagai …"). A native <select>
// can't carry icons, so the picker is a small menu: icon, name and one line
// of what the role may do.
import { icon } from "./icons.js";
import { qs, escapeHtml, openMenu, closeMenu } from "./dom.js";
import { t } from "./i18n.js";
import { presetKey } from "./permissions.js";

export const ROLE_LOOK = {
  owner: { icon: "sparkle", color: "#FFA52B" },
  admin: { icon: "shield", color: "#FF6B3D" },
  creator: { icon: "edit", color: "#3B9BFF" },
  smm: { icon: "film", color: "#A974FF" },
  sales: { icon: "wallet", color: "#2BC96B" },
  viewer: { icon: "eye", color: "#8A8479" },
  klien: { icon: "users", color: "#2EC4B6" },
  klienEdit: { icon: "users", color: "#0FA3A3" },
  custom: { icon: "gear", color: "#6B7280" },
};
// Old invites say "editor"/"viewer": shown as their preset.
export const roleKey = (role) => (role === "owner" || role === "custom" ? role : presetKey(role) || role || "viewer");
export const roleLook = (role) => ROLE_LOOK[roleKey(role)] || ROLE_LOOK.viewer;
export const roleLabel = (role) => t(`team.role.${roleKey(role)}`);

// The role as a coloured chip: icon + name (or the icon alone).
export function roleChipHTML(role, { label = true, size = 13 } = {}) {
  const look = roleLook(role);
  const name = roleLabel(role);
  return `<span class="role-chip ${label ? "" : "is-icon"}" style="--rc:${look.color}" title="${escapeHtml(name)}">${icon(look.icon, { size })}${label ? `<span>${escapeHtml(name)}</span>` : ""}</span>`;
}

// The picker: a button showing the chosen role; a tap opens the roles with
// their icon and what each may do. `custom` shows while a member's boxes
// differ from every preset (it can't be picked).
export function rolePickerHTML({ id = "", value, attrs = "", label = "" } = {}) {
  return `<button type="button" class="role-pick" ${id ? `id="${id}"` : ""} data-role-value="${escapeHtml(roleKey(value))}" aria-haspopup="menu" aria-label="${escapeHtml(label || t("team.inviteModal.role"))}" ${attrs}>${roleChipHTML(value)}${icon("chevronDown", { size: 13 })}</button>`;
}
export function wireRolePicker(btn, { roles, hint = (r) => "", onPick } = {}) {
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    const menu = openMenu(btn, { className: "role-menu", top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    if (!menu) return;
    menu.style.width = `${width}px`;
    const current = btn.dataset.roleValue;
    menu.innerHTML = roles.map((role) => {
      const look = roleLook(role);
      return `<button type="button" class="role-opt ${role === current ? "is-on" : ""}" data-pick="${escapeHtml(role)}" style="--rc:${look.color}">
          <span class="role-opt-ic">${icon(look.icon, { size: 16 })}</span>
          <span class="role-opt-text"><b>${escapeHtml(roleLabel(role))}</b><small>${escapeHtml(hint(role) || "")}</small></span>
          ${role === current ? icon("check", { size: 15 }) : ""}
        </button>`;
    }).join("") + `<button type="button" class="role-opt role-opt-guide" data-guide>${icon("help", { size: 15 })}<span class="role-opt-text"><b>${escapeHtml(t("rg.link"))}</b></span></button>`;
    // The whole guide, opened on the role shown (js/role-guide.js).
    menu.querySelector("[data-guide]")?.addEventListener("click", () => {
      closeMenu();
      import("./role-guide.js").then((m) => m.openRoleGuide({ role: current })).catch(() => {});
    });
    menu.querySelectorAll("[data-pick]").forEach((o) => o.addEventListener("click", () => {
      const role = o.dataset.pick;
      closeMenu();
      if (role === current) return;
      btn.dataset.roleValue = role;
      btn.innerHTML = `${roleChipHTML(role)}${icon("chevronDown", { size: 13 })}`;
      onPick?.(role, btn);
    }));
  });
}
export const pickedRole = (root, sel) => qs(sel, root)?.dataset.roleValue || "";
