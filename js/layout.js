import { icon } from "./icons.js";
import { listBrands, getBrand, listOverdueAndDueSoon } from "./store.js";
import { logout } from "./auth.js";
import { avatarHTML, escapeHtml, formatDate, getDominantColor, pickTintTextColor, pickTintForeground, qs, qsa } from "./dom.js";

// Avoid re-sampling the same logo's color every navigation — it's not
// going to change until the avatar itself does.
const tintCache = new Map();
async function applyBrandTint(brand) {
  if (!brand?.avatar) {
    document.body.classList.remove("has-brand-tint");
    document.body.style.removeProperty("--brand-tint");
    document.body.style.removeProperty("--brand-tint-text");
    document.body.style.removeProperty("--brand-tint-fg");
    return;
  }
  try {
    let tint = tintCache.get(brand.id);
    if (!tint) {
      const color = await getDominantColor(brand.avatar);
      tint = { color, text: pickTintTextColor(color), fg: pickTintForeground(color) };
      tintCache.set(brand.id, tint);
    }
    document.body.style.setProperty("--brand-tint", tint.color);
    document.body.style.setProperty("--brand-tint-text", tint.text);
    document.body.style.setProperty("--brand-tint-fg", tint.fg);
    document.body.classList.add("has-brand-tint");
  } catch {
    document.body.classList.remove("has-brand-tint");
    document.body.style.removeProperty("--brand-tint");
    document.body.style.removeProperty("--brand-tint-text");
    document.body.style.removeProperty("--brand-tint-fg");
  }
}

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: "grid", path: (id) => `#/brand/${id}`, tour: "tab-dashboard" },
  { key: "content", label: "Content", icon: "layers", path: (id) => `#/brand/${id}/content`, tour: "tab-content" },
  { key: "creator", label: "Creator", icon: "edit", path: (id) => `#/brand/${id}/creator`, tour: "tab-creator" },
  { key: "calendar", label: "Calendar", icon: "calendar", path: (id) => `#/brand/${id}/calendar`, tour: "tab-calendar" },
];

function notifRowHTML({ content, brand }, tone) {
  return `
    <button type="button" class="notif-row" data-go="${brand.id}/creator/${content.id}">
      ${avatarHTML(brand, "width:26px;height:26px;border-radius:7px;font-size:11px;flex:none;")}
      <div class="ti">
        <div class="t">${escapeHtml(content.title || "Untitled")}</div>
        <div class="m">${escapeHtml(brand.name)} · <span class="notif-${tone}">${formatDate(content.scheduleDate)}</span></div>
      </div>
    </button>
  `;
}

function notifPanelHTML({ overdue, dueToday, dueSoon }) {
  if (!overdue.length && !dueToday.length && !dueSoon.length) {
    return `<div class="notif-empty">${icon("check", { size: 15 })}You're all caught up.</div>`;
  }
  const section = (label, items, tone) =>
    items.length
      ? `<div class="notif-section-head">${label}</div>${items.map((x) => notifRowHTML(x, tone)).join("")}`
      : "";
  return `
    ${section("Overdue", overdue, "overdue")}
    ${section("Due today", dueToday, "today")}
    ${section("Due soon", dueSoon, "soon")}
  `;
}

export function shellHTML({ brandId, active }) {
  const brand = brandId ? getBrand(brandId) : null;

  const tabsHTML = brand
    ? TABS.map(
        (t) => `<a class="tab ${active === t.key ? "active" : ""}" href="${t.path(brand.id)}" data-tour="${t.tour}">${icon(t.icon, { size: 16 })}${t.label}</a>`
      ).join("")
    : "";

  const brandSwitchHTML = brand
    ? `<button class="brand-switch" id="brand-switch-btn" data-tour="brand-switch">
         ${avatarHTML(brand)}
         <span>${brand.name}</span>
         ${icon("chevronDown", { size: 14 })}
       </button>`
    : "";

  const { overdue } = listOverdueAndDueSoon();

  return `
    <header class="topbar">
      <a class="brand-mark" href="#/">
        <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
        <span class="brand-mark-divider"></span>
        Brandlab
      </a>
      ${brand ? `<div class="topbar-sep"></div>${brandSwitchHTML}` : ""}
      ${brand ? `<nav class="tabs">${tabsHTML}</nav>` : ""}
      <div class="topbar-right">
        <a class="back-to-site" href="https://wepeka.com" target="_blank" rel="noopener noreferrer">${icon("chevronLeft", { size: 13 })}wepeka.com</a>
        <button class="icon-btn ${overdue.length ? "has-overdue" : ""}" id="notif-bell-btn" data-tour="notif-bell" title="Notifications" aria-label="Notifications">
          ${icon("bell", { size: 17 })}
          ${overdue.length ? `<span class="notif-badge">${overdue.length > 9 ? "9+" : overdue.length}</span>` : ""}
        </button>
        <a class="icon-btn" href="#/settings" title="Settings" aria-label="Settings" data-tour="settings">${icon("gear", { size: 18 })}</a>
        <button class="icon-btn" id="logout-btn" title="Log out" aria-label="Log out">${icon("logout", { size: 17 })}</button>
      </div>
    </header>
    <main class="view ${["content", "creator", "calendar"].includes(active) ? "wide" : ""}" id="view-root"></main>
  `;
}

export function wireShell({ brandId }) {
  qs("#logout-btn")?.addEventListener("click", async () => {
    await logout();
    location.hash = "";
    location.reload();
  });

  applyBrandTint(brandId ? getBrand(brandId) : null);

  const bellBtn = qs("#notif-bell-btn");
  if (bellBtn) {
    bellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      qsa(".menu").forEach((m) => m.remove());
      const due = listOverdueAndDueSoon();
      const rect = bellBtn.getBoundingClientRect();
      const panel = document.createElement("div");
      panel.className = "menu notif-panel";
      panel.style.top = rect.bottom + 8 + "px";
      panel.style.left = Math.min(rect.left, window.innerWidth - 360) + "px";
      panel.innerHTML = notifPanelHTML(due);
      document.body.appendChild(panel);
      setTimeout(() => document.addEventListener("click", () => panel.remove(), { once: true }));
      panel.addEventListener("click", (ev) => {
        const target = ev.target.closest("[data-go]");
        if (!target) return;
        location.hash = `#/brand/${target.dataset.go}`;
        panel.remove();
      });
    });
  }

  const btn = qs("#brand-switch-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    qsa(".menu").forEach((m) => m.remove());
    const others = listBrands().filter((b) => b.id !== brandId);
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.style.top = rect.bottom + 8 + "px";
    menu.style.left = rect.left + "px";
    menu.innerHTML = `
      ${others.map((b) => `<button data-go="${b.id}">${avatarHTML(b, "width:18px;height:18px;border-radius:5px;font-size:9px;flex:none;")}${b.name}</button>`).join("")}
      ${others.length ? '<div class="menu-divider"></div>' : ""}
      <button data-go="all">${icon("grid", { size: 15 })}All Brands</button>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
    menu.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-go]");
      if (!target) return;
      const id = target.dataset.go;
      location.hash = id === "all" ? "#/" : `#/brand/${id}`;
      menu.remove();
    });
  });
}
