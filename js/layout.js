import { icon } from "./icons.js";
import { listBrands, getBrand, listOverdueAndDueSoon } from "./store.js";
import { logout } from "./auth.js";
import { avatarHTML, escapeHtml, formatDate, getDominantColor, pickTintTextColor, pickTintForeground, qs, qsa, openMenu, closeMenu, toast } from "./dom.js";
import { getTheme, toggleTheme } from "./theme.js";
import { getMode, toggleMode } from "./mode.js";
import { t } from "./i18n.js";
import { mountConsultantPanel, unmountConsultantPanel, openConsultantPanel } from "./consultant-panel.js";
import { mountNotesFloat, unmountNotesFloat } from "./notes-float.js";
import { returnTo, clearNavContext } from "./nav-context.js";
import { getCachedAccount, isTrial, isReadOnly, trialDaysLeft } from "./account.js";
import { aiDailyLimit, aiUsageToday, aiQuotaPeriod } from "./ai-usage.js";
import { getPageGuide } from "./section-guide.js";
import { identityDone } from "./brand-progress.js";
import { startOnboardingTour } from "./tour.js";
import { startAnnouncements, onAnnouncements, unreadCount, listAnnouncements, announcementsSeenAt, isAnnouncementAdmin } from "./announcements.js";
import { canShowVideo, openIntroVideo } from "./guide-videos.js";

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

// The only place the shell reads the experience mode. Everything else in
// this file is identical for Pemula and Pro.
const MODE_CONFIG = {
  guided: { bell: false, lockTabs: true },
  advanced: { bell: true, lockTabs: false },
};
const modeConfig = () => MODE_CONFIG[getMode()] || MODE_CONFIG.guided;

// One tab row for both modes. `matches` = which route views light a tab up
// (Brand DNA / Guidelines live under Brand; the Sales Tracker and goal
// roadmap light up Tujuan; Copy Studio is a sub-tab of Konten). The chat's
// own page (#/brand/:id/chat) belongs to no tab. The Tools tab was removed on 22 Sep 2026 — four tabs, no drawer.
const TABS = [
  { key: "home", labelKey: "nav.home", icon: "grid", path: (id) => `#/brand/${id}`, tour: "tab-home", matches: ["home"] },
  { key: "builder", labelKey: "nav.brand", icon: "target", path: (id) => `#/brand/${id}/builder`, tour: "tab-builder", matches: ["builder", "dna", "guidelines"] },
  { key: "campaigns", labelKey: "nav.campaigns", icon: "bulb", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns", matches: ["campaigns", "goals", "sales"], gated: true },
  // Konten is open from day one — try it first; the Konten page itself
  // asks for Brand DNA to sharpen the results (js/views/content-os.js).
  { key: "content-os", labelKey: "nav.content", icon: "layers", path: (id) => `#/brand/${id}/content`, tour: "tab-content-os", matches: ["content-os"], gated: false },
];

function notifRowHTML({ content, brand }, tone) {
  return `
    <button type="button" class="notif-row" data-go="${brand.id}/content/creator/${content.id}">
      ${avatarHTML(brand, "width:26px;height:26px;border-radius:7px;font-size:11px;flex:none;")}
      <div class="ti">
        <div class="t">${escapeHtml(content.title || t("common.untitled"))}</div>
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

function bellHTML() {
  const { overdue } = listOverdueAndDueSoon();
  return `
    <button class="icon-btn ${overdue.length ? "has-overdue" : ""}" id="notif-bell-btn" data-tour="notif-bell" title="${t("topbar.notifications")}" aria-label="${t("topbar.notifications")}">
      ${icon("bell", { size: 17 })}
      ${overdue.length ? `<span class="notif-badge">${overdue.length > 9 ? "9+" : overdue.length}</span>` : ""}
    </button>`;
}

// "Update" — the Pengumuman page (js/views/announcements.js), with a count
// of what's new since this account last opened it.
function updatesBtnHTML(active) {
  const n = unreadCount();
  return `<a class="icon-btn updates-btn ${active === "announcements" ? "is-active" : ""}" id="updates-btn" href="#/updates" data-tour="updates" title="${t("ann.topbarTitle")}" aria-label="${t("ann.topbarTitle")}">
      ${icon("megaphone", { size: 17 })}<span class="updates-label">${t("ann.topbar")}</span>
      <span class="notif-badge updates-badge" ${n ? "" : "hidden"}>${n > 9 ? "9+" : n || ""}</span>
    </a>`;
}

// One listener for the whole session: keeps the badge current, and says
// "Update baru: …" once when a post lands while the app is open.
let annWired = false;
const annToasted = new Set();
const sessionStart = Date.now();
function wireAnnouncements() {
  startAnnouncements();
  if (annWired) return;
  annWired = true;
  onAnnouncements(() => {
    const n = unreadCount();
    const badge = qs("#updates-btn .updates-badge");
    if (badge) { badge.hidden = !n; badge.textContent = n > 9 ? "9+" : n ? String(n) : ""; }
    if (location.hash.startsWith("#/updates") || isAnnouncementAdmin()) return;
    const seen = announcementsSeenAt();
    listAnnouncements()
      .filter((a) => (a.createdAt || 0) > Math.max(seen, sessionStart) && !annToasted.has(a.id))
      .slice(0, 1)
      .forEach((a) => { annToasted.add(a.id); toast(t("ann.toast", { title: a.title || "" })); });
  });
}

export function shellHTML({ brandId, active }) {
  const brand = brandId ? getBrand(brandId) : null;

  // Pemula: Campaign stays visible but locked until the brand identity is
  // done — the tab is a promise of what comes next, the lock says why it
  // isn't open yet. Konten is open from the start.
  const lock = brand && modeConfig().lockTabs && !identityDone(brand);
  const tabsHTML = brand
    ? TABS.map((tab) => {
        const locked = lock && tab.gated;
        return `<a class="tab ${tab.matches.includes(active) ? "active" : ""} ${locked ? "is-locked" : ""}" href="${locked ? "#" : tab.path(brand.id)}" ${locked ? `data-locked-tab title="${t("nav.locked")}"` : ""} data-tour="${tab.tour}" data-tab-key="${tab.key}">${icon(locked ? "lock" : tab.icon, { size: 16 })}${t(tab.labelKey)}</a>`;
      }).join("")
    : "";

  const brandSwitchHTML = brand
    ? `<button class="brand-switch" id="brand-switch-btn" data-tour="brand-switch">
         ${avatarHTML(brand)}
         <span>${brand.name}</span>
         ${icon("chevronDown", { size: 14 })}
       </button>`
    : "";

  return `
    <header class="topbar">
      <a class="brand-mark" href="#/" title="${t("nav.allBrands")}">
        <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
        <span class="brand-mark-divider"></span>
        Brandlab
      </a>
      ${brand ? `<div class="topbar-sep"></div>${brandSwitchHTML}` : ""}
      ${brand ? `<nav class="tabs">${tabsHTML}</nav>` : ""}
      <div class="topbar-right">
        ${planBadgeHTML()}
        ${modeConfig().bell ? bellHTML() : ""}
        ${updatesBtnHTML(active)}
        <button class="icon-btn" id="help-btn" title="${t("topbar.help")}" aria-label="${t("topbar.help")}">${icon("help", { size: 18 })}</button>
        <button class="icon-btn" id="app-menu-btn" title="${t("topbar.menu")}" aria-label="${t("topbar.menu")}" data-tour="settings">${icon("dots", { size: 18 })}</button>
      </div>
    </header>
    ${returnChipHTML()}
    <main class="view view-enter view-${active} ${active === "content-os" ? "wide" : ""}" id="view-root"></main>
  `;
}

// Route changed but the shell stayed (same brand, same mode — see
// main.js renderRoute): re-point the active tab and refresh the
// "← Kembali ke ..." chip without touching the rest of the topbar.
export function updateShellForRoute({ active }) {
  qsa(".topbar .tabs .tab").forEach((a) => {
    const tab = TABS.find((x) => x.key === a.dataset.tabKey);
    a.classList.toggle("active", !!tab?.matches.includes(active));
  });
  const oldChip = qs(".nav-return");
  const html = returnChipHTML();
  if (oldChip) oldChip.remove();
  if (html) {
    qs(".topbar")?.insertAdjacentHTML("afterend", html);
    qs("#nav-return-btn")?.addEventListener("click", () => {
      const r = returnTo();
      clearNavContext();
      if (r) location.hash = r.hash;
    });
  }
}

// Plan status in the topbar, only when there's a decision to make: a
// running trial (days left) or a read-only account (ended trial / lapsed
// plan). Paid and lifetime accounts see nothing here — the plan is in
// Settings → Akun.
function planBadgeHTML() {
  const account = getCachedAccount();
  if (!account) return "";
  const readOnly = isReadOnly(account);
  const trial = isTrial(account);
  if (!readOnly && !trial) return "";
  const label = readOnly
    ? t(trial ? "app.plan.trialEnded" : "app.plan.readonly")
    : t("app.plan.trialShort", { days: trialDaysLeft(account) });
  return `<a class="plan-badge ${readOnly ? "is-readonly" : ""}" href="#/pricing" title="${t("app.plan.badgeTitle")}">
    ${icon("arrowUp", { size: 13 })}<span>${label}</span><strong>${t("app.plan.upgrade")}</strong>
  </a>`;
}

// Daily AI meter — one row inside the ⋯ menu, so people see how much of
// today's quota is used before they hit the wall mid-task.
function aiUsageRowHTML() {
  const used = aiUsageToday();
  const limit = aiDailyLimit();
  if (limit === Infinity) return `${icon("bot", { size: 15 })}<span>AI · ${used}</span>`;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 100 ? "is-out" : pct >= 80 ? "is-low" : "";
  return `${icon("bot", { size: 15 })}<span>AI · ${used}/${limit}</span><span class="ai-usage-bar ${tone}"><span style="width:${pct}%"></span></span>`;
}

function aiUsagePopoverHTML() {
  const used = aiUsageToday();
  const limit = aiDailyLimit();
  const left = limit === Infinity ? null : Math.max(0, limit - used);
  // Founder lifetime plans are capped per month, the trial is one pool for
  // the whole 7 days, everything else is per day.
  const period = aiQuotaPeriod();
  const m = period === "month" ? "Month" : period === "total" ? "Total" : "";
  return `
    <div class="help-popover-title">${t(`app.aiUsage.title${m}`)}</div>
    <p class="help-popover-body">${limit === Infinity ? t("app.aiUsage.unlimited", { used }) : left ? t(`app.aiUsage.left${m}`, { used, limit, left }) : t(`app.aiUsage.out${m}`, { used, limit })}</p>
    <p class="help-popover-body">${t(`app.aiUsage.explain${m}`)}${limit === Infinity ? "" : ` ${t("app.aiUsage.more")}`}</p>
  `;
}

// The ⋯ menu: everything that used to be its own topbar button (mode,
// theme, AI meter, settings, logout). Copy Studio lives under Konten and the
// Sales Tracker under Tujuan — neither is listed here.
function appMenuHTML() {
  const mode = getMode();
  const other = mode === "guided" ? "advanced" : "guided";
  return `
    <button type="button" data-act="mode">${icon(other === "guided" ? "target" : "sparkle", { size: 15 })}${t("menu.modeSwitch", { current: t(`mode.${mode}.name`), other: t(`mode.${other}.name`) })}</button>
    <button type="button" data-act="theme">${icon(getTheme() === "light" ? "moon" : "sun", { size: 15 })}${t("topbar.toggleTheme")}</button>
    <button type="button" class="menu-ai-row" data-act="ai">${aiUsageRowHTML()}</button>
    <div class="menu-divider"></div>
    <button type="button" data-go="#/settings/brands">${icon("users", { size: 15 })}${t("settings.panel.brands")}</button>
    <button type="button" data-go="#/settings">${icon("gear", { size: 15 })}${t("topbar.settings")}</button>
    <button type="button" data-act="logout">${icon("logout", { size: 15 })}${t("topbar.logout")}</button>
  `;
}

// The ? popover: the single entry point to every kind of help — this
// page's guide (when the view registered one, see js/section-guide.js
// setPageGuide), the AI chat, the intro video (once it is published), the
// website tour.
function helpMenuHTML(brandId) {
  return `
    ${getPageGuide() ? `<button type="button" data-act="page">${icon("target", { size: 15 })}${t("help.pageGuide")}</button>` : ""}
    ${brandId ? `<button type="button" data-act="consultant">${icon("chat", { size: 15 })}${t("help.askAi")}</button>` : ""}
    ${canShowVideo("kenalan") ? `<button type="button" data-act="intro">${icon("play", { size: 15 })}${t("help.introVideo")}</button>` : ""}
    <button type="button" data-act="tour">${icon("target", { size: 15 })}${t("help.tour")}</button>
  `;
}

// "← Kembali ke Campaign X" while a cross-feature trip (js/nav-context.js)
// is in progress — the way back after "Buka di Creator" from a campaign.
function returnChipHTML() {
  const r = returnTo();
  return r ? `<div class="nav-return"><button type="button" id="nav-return-btn">${icon("chevronLeft", { size: 13 })}${escapeHtml(r.label ? t("common.backTo", { label: r.label }) : t("common.back"))}</button></div>` : "";
}

function menuBelow(btn, { className = "", width = 240 } = {}) {
  const rect = btn.getBoundingClientRect();
  return openMenu(btn, { className, top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) });
}

export function wireShell({ brandId }) {
  wireAnnouncements();
  qs("#nav-return-btn")?.addEventListener("click", () => {
    const r = returnTo();
    clearNavContext();
    if (r) location.hash = r.hash;
  });

  applyBrandTint(brandId ? getBrand(brandId) : null);

  qsa("[data-locked-tab]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      toast(t("home.next.lockedToast"));
    })
  );

  if (brandId) mountConsultantPanel(brandId);
  else unmountConsultantPanel();
  if (brandId) mountNotesFloat(brandId);
  else unmountNotesFloat();

  const helpBtn = qs("#help-btn");
  helpBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = menuBelow(helpBtn, { width: 220 });
    if (!menu) return;
    menu.innerHTML = helpMenuHTML(brandId);
    menu.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-act]");
      if (!target) return;
      closeMenu();
      const act = target.dataset.act;
      if (act === "page") getPageGuide()?.();
      else if (act === "consultant") openConsultantPanel();
      else if (act === "intro") openIntroVideo();
      else if (act === "tour") startOnboardingTour();
    });
  });

  const menuBtn = qs("#app-menu-btn");
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = menuBelow(menuBtn, { className: "app-menu", width: 250 });
    if (!menu) return;
    menu.innerHTML = appMenuHTML();
    menu.addEventListener("click", async (ev) => {
      const go = ev.target.closest("[data-go]");
      if (go) {
        location.hash = go.dataset.go;
        closeMenu();
        return;
      }
      const target = ev.target.closest("[data-act]");
      if (!target) return;
      const act = target.dataset.act;
      closeMenu();
      if (act === "mode") toggleMode();
      else if (act === "theme") toggleTheme();
      else if (act === "ai") {
        const pop = menuBelow(menuBtn, { className: "help-popover", width: 280 });
        if (pop) pop.innerHTML = aiUsagePopoverHTML();
      } else if (act === "logout") {
        await logout();
        location.hash = "";
        location.reload();
      }
    });
  });

  const bellBtn = qs("#notif-bell-btn");
  bellBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = menuBelow(bellBtn, { className: "notif-panel", width: 360 });
    if (!panel) return;
    panel.innerHTML = notifPanelHTML(listOverdueAndDueSoon());
    panel.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-go]");
      if (!target) return;
      location.hash = `#/brand/${target.dataset.go}`;
      closeMenu();
    });
  });

  const btn = qs("#brand-switch-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    const menu = openMenu(btn, { top: rect.bottom + 8, left: rect.left });
    if (!menu) return;
    const others = listBrands().filter((b) => b.id !== brandId);
    menu.innerHTML = `
      ${others.map((b) => `<button data-go="${b.id}">${avatarHTML(b, "width:18px;height:18px;border-radius:5px;font-size:9px;flex:none;")}${b.name}</button>`).join("")}
      ${others.length ? '<div class="menu-divider"></div>' : ""}
      <button data-go="all">${icon("grid", { size: 15 })}${t("nav.allBrands")}</button>
    `;
    menu.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-go]");
      if (!target) return;
      const id = target.dataset.go;
      location.hash = id === "all" ? "#/" : `#/brand/${id}`;
      closeMenu();
    });
  });
}
