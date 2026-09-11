import { icon } from "./icons.js";
import { listBrands, getBrand, listOverdueAndDueSoon } from "./store.js";
import { logout } from "./auth.js";
import { avatarHTML, escapeHtml, formatDate, getDominantColor, pickTintTextColor, pickTintForeground, qs, qsa } from "./dom.js";
import { getTheme, toggleTheme } from "./theme.js";
import { t } from "./i18n.js";

// Avoid re-sampling the same logo's color every navigation — it's not
// going to change until the avatar itself does.
const tintCache = new Map();
async function applyBrandTint(brand) {
  // A manually-picked brand color (Edit Brand → Brand Color) always wins —
  // it's instant (no image sampling) and is what the user explicitly chose
  // as this brand's essence color. Falls back to auto-sampling the logo's
  // dominant color only when no manual color has been set yet.
  const source = brand?.color || brand?.avatar;
  if (!source) {
    document.body.classList.remove("has-brand-tint");
    document.body.style.removeProperty("--brand-tint");
    document.body.style.removeProperty("--brand-tint-text");
    document.body.style.removeProperty("--brand-tint-fg");
    return;
  }
  try {
    const cacheKey = brand.id + ":" + source;
    let tint = tintCache.get(cacheKey);
    if (!tint) {
      const color = brand.color || (await getDominantColor(brand.avatar));
      tint = { color, text: pickTintTextColor(color), fg: pickTintForeground(color) };
      tintCache.set(cacheKey, tint);
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
  { key: "home", labelKey: "nav.home", icon: "grid", path: (id) => `#/brand/${id}`, tour: "tab-home" },
  { key: "dna", labelKey: "nav.dna", icon: "target", path: (id) => `#/brand/${id}/dna`, tour: "tab-dna" },
  { key: "campaigns", labelKey: "nav.campaigns", icon: "bulb", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns" },
  { key: "guidelines", labelKey: "nav.guidelines", icon: "book", path: (id) => `#/brand/${id}/guidelines`, tour: "tab-guidelines" },
  { key: "content-os", labelKey: "nav.contentOs", icon: "layers", path: (id) => `#/brand/${id}/content-os`, tour: "tab-content-os" },
  { key: "sales", labelKey: "nav.sales", icon: "folder", path: (id) => `#/brand/${id}/sales`, tour: "tab-sales" },
];

function notifRowHTML({ content, brand }, tone) {
  return `
    <button type="button" class="notif-row" data-go="${brand.id}/content-os/creator/${content.id}">
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
    return `<div class="notif-empty">${icon("check", { size: 15 })}${t("notif.allCaughtUp")}</div>`;
  }
  const section = (label, items, tone) =>
    items.length
      ? `<div class="notif-section-head">${label}</div>${items.map((x) => notifRowHTML(x, tone)).join("")}`
      : "";
  return `
    ${section(t("notif.overdue"), overdue, "overdue")}
    ${section(t("notif.dueToday"), dueToday, "today")}
    ${section(t("notif.dueSoon"), dueSoon, "soon")}
  `;
}

export function shellHTML({ brandId, active }) {
  const brand = brandId ? getBrand(brandId) : null;

  const tabsHTML = brand
    ? TABS.map(
        (tab) => `<a class="tab ${active === tab.key ? "active" : ""}" href="${tab.path(brand.id)}" data-tour="${tab.tour}">${icon(tab.icon, { size: 16 })}${t(tab.labelKey)}</a>`
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
        <a class="back-to-site" href="https://wepeka.com" target="_blank" rel="noopener noreferrer">${icon("chevronLeft", { size: 13 })}${t("topbar.backToSite")}</a>
        <button class="icon-btn" id="theme-toggle-btn" title="${t("topbar.toggleTheme")}" aria-label="${t("topbar.toggleTheme")}">
          ${icon(getTheme() === "light" ? "sun" : "moon", { size: 17 })}
        </button>
        <button class="icon-btn ${overdue.length ? "has-overdue" : ""}" id="notif-bell-btn" data-tour="notif-bell" title="${t("topbar.notifications")}" aria-label="${t("topbar.notifications")}">
          ${icon("bell", { size: 17 })}
          ${overdue.length ? `<span class="notif-badge">${overdue.length > 9 ? "9+" : overdue.length}</span>` : ""}
        </button>
        <a class="icon-btn" href="#/settings" title="${t("topbar.settings")}" aria-label="${t("topbar.settings")}" data-tour="settings">${icon("gear", { size: 18 })}</a>
        <button class="icon-btn" id="logout-btn" title="${t("topbar.logout")}" aria-label="${t("topbar.logout")}">${icon("logout", { size: 17 })}</button>
      </div>
    </header>
    <main class="view view-${active} ${active === "content-os" ? "wide" : ""}" id="view-root"></main>
  `;
}

export function wireShell({ brandId }) {
  qs("#logout-btn")?.addEventListener("click", async () => {
    await logout();
    location.hash = "";
    location.reload();
  });

  applyBrandTint(brandId ? getBrand(brandId) : null);

  qs("#theme-toggle-btn")?.addEventListener("click", (e) => {
    const next = toggleTheme();
    e.currentTarget.innerHTML = icon(next === "light" ? "sun" : "moon", { size: 17 });
  });

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
      <button data-go="all">${icon("grid", { size: 15 })}${t("nav.allBrands")}</button>
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
