import { icon } from "./icons.js";
import { listBrands, getBrand, listOverdueAndDueSoon } from "./store.js";
import { logout } from "./auth.js";
import { avatarHTML, escapeHtml, formatDate, getDominantColor, pickTintTextColor, pickTintForeground, qs, qsa, openMenu, closeMenu } from "./dom.js";
import { getTheme, toggleTheme } from "./theme.js";
import { getMode, toggleMode } from "./mode.js";
import { t } from "./i18n.js";
import { mountConsultantPanel, unmountConsultantPanel } from "./consultant-panel.js";
import { returnTo, clearNavContext } from "./nav-context.js";
import { getCachedAccount, isLifetime, isTrial, isReadOnly, trialDaysLeft } from "./account.js";
import { aiDailyLimit, aiUsageToday, aiQuotaPeriod } from "./ai-usage.js";
import { mountGuideFab } from "./guide-fab.js";

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

// Brand DNA and Brand Guidelines no longer get their own top-level tabs —
// both now live inside Brand Builder's stage hub (js/views/brand-builder.js
// links out to their existing routes/screens, which still work standalone,
// just aren't separately advertised in the nav anymore). See BUILDER_ABSORBED_VIEWS
// below for the "still highlight Brand Builder as active" handling.
// "sales" has no tab of its own: Sales Tracker (js/views/sales.js) is opened
// from its widget next to Copy Studio on the brand home (brand-home.js) and
// from "Alat cepat" on the Pemula home (beginner-home.js).
const TABS = [
  { key: "home", labelKey: "nav.home", icon: "grid", path: (id) => `#/brand/${id}`, tour: "tab-home" },
  { key: "builder", labelKey: "nav.builder", icon: "sparkle", path: (id) => `#/brand/${id}/builder`, tour: "tab-builder" },
  { key: "campaigns", labelKey: "nav.campaigns", icon: "bulb", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns" },
  { key: "content-os", labelKey: "nav.contentOs", icon: "layers", path: (id) => `#/brand/${id}/content-os`, tour: "tab-content-os" },
];

// Pemula mode gets four tabs, plain words, no product names: Beranda
// (the step-by-step journey), Campaign (#9: kept in the toolbar too, not
// only reachable through a Beranda journey card), Brand (Builder/DNA/
// Guidelines), Konten (Content OS). Sales Tracker isn't shown at all —
// it's "coming soon" and one more thing to wonder about. Everything is
// still reachable by URL; this only trims what's advertised in the nav.
// `matches` = which route views light this tab up (copy studio → Konten).
const GUIDED_TABS = [
  { key: "home", label: t("nav.home"), icon: "grid", path: (id) => `#/brand/${id}`, tour: "tab-home", matches: ["home"] },
  { key: "campaigns", label: t("app.tab.campaign"), icon: "bulb", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns", matches: ["campaigns"] },
  { key: "builder", label: t("app.tab.brand"), icon: "target", path: (id) => `#/brand/${id}/builder`, tour: "tab-builder", matches: ["builder", "dna", "guidelines"] },
  { key: "content-os", label: t("app.tab.content"), icon: "layers", path: (id) => `#/brand/${id}/content-os`, tour: "tab-content-os", matches: ["content-os", "copy"] },
];

// Shown as a dropdown (not a full page navigation) when the gear icon is
// clicked from inside a brand — the settings someone reaches for most
// often while working on a brand, plus one way out to everything else.
// Deep-links straight to that panel via #/settings/:panel (see
// parseRoute in main.js) instead of always landing on "benchmarks".
const SETTINGS_SHORTCUTS = [
  { panel: "ai", icon: "bot", labelKey: "settings.panel.ai" },
  { panel: "brands", icon: "users", labelKey: "settings.panel.brands" },
  { panel: "account", icon: "gear", labelKey: "settings.panel.account" },
];

function notifRowHTML({ content, brand }, tone) {
  return `
    <button type="button" class="notif-row" data-go="${brand.id}/content-os/creator/${content.id}">
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

// Brand DNA/Guidelines pages are reached through Brand Builder's stage
// cards now (no tab of their own) — keep the Builder tab visibly active
// while the user is on either, so the nav doesn't go blank.
const BUILDER_ABSORBED_VIEWS = ["dna", "guidelines"];

export function shellHTML({ brandId, active }) {
  const brand = brandId ? getBrand(brandId) : null;
  const guided = getMode() === "guided";
  const activeTabKey = BUILDER_ABSORBED_VIEWS.includes(active) ? "builder" : active;

  const tabsHTML = brand
    ? guided
      ? GUIDED_TABS.map(
          (tab) => `<a class="tab ${tab.matches.includes(active) ? "active" : ""}" href="${tab.path(brand.id)}" data-tour="${tab.tour}" data-tab-key="${tab.key}">${icon(tab.icon, { size: 16 })}${tab.label}</a>`
        ).join("")
      : TABS.map(
          (tab) => `<a class="tab ${activeTabKey === tab.key ? "active" : ""}" href="${tab.path(brand.id)}" data-tour="${tab.tour}" data-tab-key="${tab.key}">${icon(tab.icon, { size: 16 })}${t(tab.labelKey)}</a>`
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
        ${guided ? "" : `<a class="back-to-site" href="https://wepeka.com" target="_blank" rel="noopener noreferrer">${icon("chevronLeft", { size: 13 })}${t("topbar.backToSite")}</a>`}
        <button class="icon-btn" id="theme-toggle-btn" title="${t("topbar.toggleTheme")}" aria-label="${t("topbar.toggleTheme")}">
          ${icon(getTheme() === "light" ? "sun" : "moon", { size: 17 })}
        </button>
        <button class="brand-switch mode-toggle" id="mode-toggle-btn" title="${modeToggleTitle(getMode())}" aria-label="${t("mode.toggleTitle")}">
          ${modeToggleInnerHTML(getMode())}
        </button>
        ${planBadgeHTML()}
        <button class="ai-usage" id="ai-usage-btn" title="${t("app.aiUsage.title")}" aria-label="${t("app.aiUsage.title")}">${aiUsagePillInnerHTML()}</button>
        <button class="icon-btn ${overdue.length ? "has-overdue" : ""}" id="notif-bell-btn" data-tour="notif-bell" title="${t("topbar.notifications")}" aria-label="${t("topbar.notifications")}">
          ${icon("bell", { size: 17 })}
          ${overdue.length ? `<span class="notif-badge">${overdue.length > 9 ? "9+" : overdue.length}</span>` : ""}
        </button>
        ${
          brand
            ? `<button class="icon-btn" id="settings-menu-btn" title="${t("topbar.settings")}" aria-label="${t("topbar.settings")}" data-tour="settings">${icon("gear", { size: 18 })}</button>`
            : `<a class="icon-btn" href="#/settings" title="${t("topbar.settings")}" aria-label="${t("topbar.settings")}" data-tour="settings">${icon("gear", { size: 18 })}</a>`
        }
        <button class="icon-btn" id="logout-btn" title="${t("topbar.logout")}" aria-label="${t("topbar.logout")}">${icon("logout", { size: 17 })}</button>
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
  const guided = getMode() === "guided";
  const activeTabKey = BUILDER_ABSORBED_VIEWS.includes(active) ? "builder" : active;
  qsa(".topbar .tabs .tab").forEach((a) => {
    const key = a.dataset.tabKey;
    const on = guided ? !!GUIDED_TABS.find((tab) => tab.key === key)?.matches.includes(active) : key === activeTabKey;
    a.classList.toggle("active", on);
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

// Plan status in the topbar — always a link to the pricing page. Lifetime
// accounts just see what they own; everyone else sees their plan plus an
// "Upgrade" nudge (a trial shows its days left, read-only says so).
function planBadgeHTML() {
  const account = getCachedAccount();
  if (!account) return "";
  const lifetime = isLifetime(account);
  const plan = String(account.plan || "");
  const label = lifetime
    ? t("app.plan.lifetime")
    : isReadOnly(account)
      ? t("app.plan.viewOnly")
      : isTrial(account)
        ? t("app.plan.trialShort", { days: trialDaysLeft(account) })
        : t(`app.plan.name.${plan}`) === `app.plan.name.${plan}` ? plan : t(`app.plan.name.${plan}`);
  return `<a class="plan-badge ${lifetime ? "is-lifetime" : ""}" href="#/pricing" title="${t("app.plan.badgeTitle")}">
    ${icon(lifetime ? "sparkle" : "arrowUp", { size: 13 })}<span>${label}</span>${lifetime ? "" : `<strong>${t("app.plan.upgrade")}</strong>`}
  </a>`;
}

// Daily AI meter in the topbar — every account sees how much of today's
// quota is used, before they hit the wall mid-task. Re-rendered on every
// db:change (the count lives in settings, so each AI call bumps it live).
function aiUsagePillInnerHTML() {
  const used = aiUsageToday();
  const limit = aiDailyLimit();
  if (limit === Infinity) return `${icon("bot", { size: 13 })}<span class="ai-usage-text">AI ${used}</span>`;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 100 ? "is-out" : pct >= 80 ? "is-low" : "";
  return `${icon("bot", { size: 13 })}<span class="ai-usage-bar ${tone}"><span style="width:${pct}%"></span></span><span class="ai-usage-text">${used}/${limit}</span>`;
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

let aiUsageRefresh = null;

// The toggle shows the mode you're IN ("Pemula"). Clicking it no longer
// flips the mode on the spot — it opens a small explainer of both modes
// with the switch button inside, so people learn the difference (and that
// the switch exists at all).
function modeToggleTitle() {
  return t("mode.toggleTitle");
}
function openModeExplainer(btn) {
  const rect = btn.getBoundingClientRect();
  const pop = openMenu(btn, { className: "mode-pop", top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left - 120, window.innerWidth - 340)) });
  if (!pop) return;
  const current = getMode();
  const other = current === "guided" ? "advanced" : "guided";
  const card = (mode) => `
    <div class="mode-pop-card ${mode === current ? "is-current" : ""}">
      <div class="mode-pop-card-head">${icon(mode === "guided" ? "target" : "sparkle", { size: 13 })}<b>${t(`mode.${mode}.name`)}</b>${mode === current ? `<em>${t("mode.current")}</em>` : ""}</div>
      <p>${t(`mode.${mode}.desc`)}</p>
    </div>`;
  pop.innerHTML = `
    <div class="help-popover-title">${t("mode.popTitle")}</div>
    ${card("guided")}
    ${card("advanced")}
    <button type="button" class="mode-pop-switch" data-mode-switch>${t("mode.switchTo", { mode: t(`mode.${other}.name`) })}</button>
    <p class="mode-pop-note">${t("mode.note")}</p>
  `;
  pop.querySelector("[data-mode-switch]").addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeMenu();
    toggleMode();
  });
}
function modeToggleInnerHTML(mode) {
  return `${icon(mode === "guided" ? "target" : "sparkle", { size: 14 })}<span>${t(`mode.${mode}.name`)}</span>`;
}

// "← Kembali ke Campaign X" while a cross-feature trip (js/nav-context.js)
// is in progress — the way back after "Buka di Creator" from a campaign.
function returnChipHTML() {
  const r = returnTo();
  return r ? `<div class="nav-return"><button type="button" id="nav-return-btn">${icon("chevronLeft", { size: 13 })}${escapeHtml(r.label ? t("common.backTo", { label: r.label }) : t("common.back"))}</button></div>` : "";
}

export function wireShell({ brandId }) {
  qs("#nav-return-btn")?.addEventListener("click", () => {
    const r = returnTo();
    clearNavContext();
    if (r) location.hash = r.hash;
  });
  qs("#logout-btn")?.addEventListener("click", async () => {
    await logout();
    location.hash = "";
    location.reload();
  });

  applyBrandTint(brandId ? getBrand(brandId) : null);

  if (brandId) mountConsultantPanel(brandId);
  else unmountConsultantPanel();
  mountGuideFab();

  qs("#theme-toggle-btn")?.addEventListener("click", (e) => {
    const next = toggleTheme();
    e.currentTarget.innerHTML = icon(next === "light" ? "sun" : "moon", { size: 17 });
  });

  qs("#mode-toggle-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openModeExplainer(e.currentTarget);
  });

  const usageBtn = qs("#ai-usage-btn");
  if (aiUsageRefresh) window.removeEventListener("db:change", aiUsageRefresh);
  aiUsageRefresh = () => { if (usageBtn?.isConnected) usageBtn.innerHTML = aiUsagePillInnerHTML(); };
  window.addEventListener("db:change", aiUsageRefresh);
  usageBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = usageBtn.getBoundingClientRect();
    const pop = openMenu(usageBtn, { className: "help-popover", top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 300) });
    if (pop) pop.innerHTML = aiUsagePopoverHTML();
  });

  const bellBtn = qs("#notif-bell-btn");
  if (bellBtn) {
    bellBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = bellBtn.getBoundingClientRect();
      const panel = openMenu(bellBtn, { className: "notif-panel", top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 360) });
      if (!panel) return;
      const due = listOverdueAndDueSoon();
      panel.innerHTML = notifPanelHTML(due);
      panel.addEventListener("click", (ev) => {
        const target = ev.target.closest("[data-go]");
        if (!target) return;
        location.hash = `#/brand/${target.dataset.go}`;
        closeMenu();
      });
    });
  }

  const settingsBtn = qs("#settings-menu-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = settingsBtn.getBoundingClientRect();
      const menu = openMenu(settingsBtn, { top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 220) });
      if (!menu) return;
      // Pemula: no AI-key shortcut (the key is global and already active).
      const shortcuts = getMode() === "guided" ? SETTINGS_SHORTCUTS.filter((s) => s.panel !== "ai") : SETTINGS_SHORTCUTS;
      menu.innerHTML = `
        ${shortcuts.map((s) => `<button data-panel="${s.panel}">${icon(s.icon, { size: 15 })}${t(s.labelKey)}</button>`).join("")}
        <div class="menu-divider"></div>
        <button data-panel="">${icon("gear", { size: 15 })}${t("topbar.settings")}</button>
      `;
      menu.addEventListener("click", (ev) => {
        const target = ev.target.closest("[data-panel]");
        if (!target) return;
        location.hash = target.dataset.panel ? `#/settings/${target.dataset.panel}` : "#/settings";
        closeMenu();
      });
    });
  }

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
