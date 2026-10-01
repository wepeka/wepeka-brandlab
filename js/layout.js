import { icon } from "./icons.js";
import { listBrands, getBrand, listOverdueAndDueSoon } from "./store.js";
import { logout } from "./auth.js";
import { avatarHTML, escapeHtml, formatDate, getDominantColor, pickTintTextColor, pickTintForeground, pickTintForegroundLight, qs, qsa, openMenu, closeMenu, toast } from "./dom.js";
import { getTheme, toggleTheme } from "./theme.js";
import { getMode, toggleMode } from "./mode.js";
import { t, getLang } from "./i18n.js";
import { mountNotesFloat, unmountNotesFloat } from "./notes-float.js";
import { returnTo, clearNavContext } from "./nav-context.js";
import { getCachedAccount, isTrial, isReadOnly, trialDaysLeft, TRIAL_DAYS } from "./account.js";
import { aiDailyLimit, aiUsageToday, aiQuotaPeriod, aiExtras } from "./ai-usage.js";
import { identityDone } from "./brand-progress.js";
import { startAnnouncements, onAnnouncements, unreadCount, listAnnouncements, announcementsSeenAt, isAnnouncementAdmin } from "./announcements.js";
import { installTopUpNotice, canTopUp } from "./ai-topup.js";
import { rememberLastBrand } from "./back-link.js";
import { openModal, closeOverlay } from "./modals.js";

// consultant-panel.js (142 KB) drags in ai.js (133 KB) — by far the heaviest
// chunk in the app, and the whole reason the logged-out login/pricing
// screen used to have to wait on it: this file is a static import of
// main.js's own import graph, so anything imported here at the top used to
// load before the very first paint, brand or no brand. Loaded on first use
// instead — the moment a brand route actually mounts the floating panel, or
// someone opens it from the ⋯ menu — and cached after that so it only ever
// costs one fetch per session. Same story for tour.js and guide-videos.js:
// smaller, but neither is needed until someone opens the ⋯ menu, either.
let consultantPanelPromise = null;
function loadConsultantPanel() {
  if (!consultantPanelPromise) consultantPanelPromise = import("./consultant-panel.js");
  return consultantPanelPromise;
}
// Keeps the mountConsultantPanel/unmountConsultantPanel/openConsultantPanel
// call sites below unchanged — they used to be the imported bindings
// themselves; now they're thin wrappers that load-then-call, in order (each
// call chains off the same cached promise, so a mount immediately followed
// by an unmount on the next route still lands in the right order once the
// module resolves).
function mountConsultantPanel(brandId) {
  loadConsultantPanel().then((m) => m.mountConsultantPanel(brandId)).catch((e) => console.warn("[consultant panel] unavailable", e));
}
function unmountConsultantPanel() {
  if (!consultantPanelPromise) return; // never loaded — nothing mounted, nothing to tear down
  consultantPanelPromise.then((m) => m.unmountConsultantPanel()).catch(() => {});
}
function openConsultantPanel(opts) {
  loadConsultantPanel().then((m) => m.openConsultantPanel(opts)).catch((e) => console.warn("[consultant panel] unavailable", e));
}

function startOnboardingTour() {
  import("./tour.js").then((m) => m.startOnboardingTour()).catch((e) => console.warn("[tour] unavailable", e));
}

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
    document.body.style.removeProperty("--brand-tint-fg-light");
    return;
  }
  try {
    const cacheKey = brand.id + ":" + source;
    let tint = tintCache.get(cacheKey);
    if (!tint) {
      const color = brand.color || (await getDominantColor(brand.avatar));
      tint = { color, text: pickTintTextColor(color), fg: pickTintForeground(color), fgLight: pickTintForegroundLight(color) };
      tintCache.set(cacheKey, tint);
    }
    document.body.style.setProperty("--brand-tint", tint.color);
    document.body.style.setProperty("--brand-tint-text", tint.text);
    document.body.style.setProperty("--brand-tint-fg", tint.fg);
    document.body.style.setProperty("--brand-tint-fg-light", tint.fgLight);
    document.body.classList.add("has-brand-tint");
  } catch {
    document.body.classList.remove("has-brand-tint");
    document.body.style.removeProperty("--brand-tint");
    document.body.style.removeProperty("--brand-tint-text");
    document.body.style.removeProperty("--brand-tint-fg");
    document.body.style.removeProperty("--brand-tint-fg-light");
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
    const dot = qs("#app-menu-btn .app-menu-badge");
    if (dot) dot.hidden = !n;
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
        const label = t(tab.labelKey);
        return `<a class="tab ${tab.matches.includes(active) ? "active" : ""} ${locked ? "is-locked" : ""}" href="${locked ? "#" : tab.path(brand.id)}" title="${escapeHtml(locked ? t("nav.locked") : label)}" ${locked ? `data-locked-tab` : ""} data-tour="${tab.tour}" data-tab-key="${tab.key}">${icon(locked ? "lock" : tab.icon, { size: 16 })}${label}</a>`;
      }).join("")
    : "";

  const brandSwitchHTML = brand
    ? `<button class="brand-switch" id="brand-switch-btn" data-tour="brand-switch">
         ${avatarHTML(brand)}
         <span>${escapeHtml(brand.name)}</span>
         ${icon("chevronDown", { size: 14 })}
       </button>`
    : "";

  return `
    <header class="topbar">
      <a class="brand-mark" href="#/" title="${t("nav.allBrands")}">
        <span class="brand-logo" role="img" aria-label="Wepeka"></span>
        <span class="brand-mark-divider"></span>
        Brandlab
      </a>
      ${brand ? `<div class="topbar-sep"></div>${brandSwitchHTML}` : ""}
      ${brand ? `<nav class="tabs" aria-label="${t("nav.main")}">${tabsHTML}</nav>` : ""}
      <div class="topbar-right">
        ${planBadgeHTML()}
        ${modeConfig().bell ? bellHTML() : ""}
        ${updatesBtnHTML(active)}
        <button class="icon-btn" id="app-menu-btn" title="${t("topbar.menu")}" aria-label="${t("topbar.menu")}" data-tour="settings">${icon("dots", { size: 18 })}<span class="notif-badge app-menu-badge" ${unreadCount() ? "" : "hidden"}></span></button>
      </div>
    </header>
    ${brand ? `<nav class="bottom-nav" aria-label="${t("nav.main")}">${tabsHTML}</nav>` : ""}
    ${returnChipHTML()}
    <main class="view view-enter view-${active} ${active === "content-os" ? "wide" : ""}" id="view-root"></main>
  `;
}

// Route changed but the shell stayed (same brand, same mode — see
// main.js renderRoute): re-point the active tab and refresh the
// "← Kembali ke ..." chip without touching the rest of the topbar.
export function updateShellForRoute({ active }) {
  qsa(".topbar .tabs .tab, .bottom-nav .tab").forEach((a) => {
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

// AI Sepuasnya / top-up balance under the plan's meter, when there is any.
function extrasLineHTML() {
  const x = aiExtras();
  const parts = [];
  if (x.unlimited) parts.push(t("ai.offer.balanceUnlimited", { date: new Date(x.unlimitedUntil).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long" }) }));
  if (x.credits) parts.push(t("ai.offer.balanceCredits", { n: x.credits.toLocaleString(getLang() === "en" ? "en-US" : "id-ID") }));
  return parts.length ? `<p class="help-popover-body"><b>${parts.join(" · ")}</b></p>` : "";
}

function aiUsagePopoverHTML() {
  const used = aiUsageToday();
  const limit = aiDailyLimit();
  const left = limit === Infinity ? null : Math.max(0, limit - used);
  // Founder lifetime plans are capped per month, the trial is one pool for
  // the whole trial (TRIAL_DAYS), everything else is per day.
  const period = aiQuotaPeriod();
  const m = period === "month" ? "Month" : period === "total" ? "Total" : "";
  return `
    <div class="help-popover-title">${t(`app.aiUsage.title${m}`)}</div>
    <p class="help-popover-body">${limit === Infinity ? t("app.aiUsage.unlimited", { used }) : left ? t(`app.aiUsage.left${m}`, { used, limit, left, days: TRIAL_DAYS }) : t(`app.aiUsage.out${m}`, { used, limit })}</p>
    <p class="help-popover-body">${t(`app.aiUsage.explain${m}`, { days: TRIAL_DAYS })}</p>
    ${extrasLineHTML()}
    ${limit === Infinity ? "" : `<button type="button" class="btn ${left ? "btn-secondary" : "btn-primary"} btn-sm btn-block" data-ai-topup style="margin-top:10px;">${icon(canTopUp() ? "plus" : "arrowUp", { size: 13 })}${t(canTopUp() ? "ai.topup.button" : "ai.topup.upgradeButton")}</button>`}
  `;
}

// The ⋯ menu: everything that used to be its own topbar button (mode,
// theme, AI meter, settings, logout). Copy Studio lives under Konten and the
// Sales Tracker under Tujuan — neither is listed here.
// On phones the topbar is one row (brand switcher + ⋯), so the trial badge
// and "Update" live at the top of this menu there (.menu-mobile-only). Help
// that isn't about the page on screen (ask the AI, intro video, website
// tour) is here too — the page's own help is its "Panduan" pill.
function appMenuHTML(brandId, canShowIntroVideo) {
  const mode = getMode();
  const other = mode === "guided" ? "advanced" : "guided";
  const account = getCachedAccount();
  const unread = unreadCount();
  const trialRow = account && (isTrial(account) || isReadOnly(account))
    ? `<button type="button" class="menu-mobile-only" data-go="#/pricing">${icon("arrowUp", { size: 15 })}${isReadOnly(account) ? t(isTrial(account) ? "app.plan.trialEnded" : "app.plan.readonly") : t("app.plan.trialShort", { days: trialDaysLeft(account) })} · ${t("app.plan.upgrade")}</button>`
    : "";
  return `
    ${trialRow}
    <button type="button" class="menu-mobile-only" data-go="#/updates">${icon("megaphone", { size: 15 })}${t("ann.topbar")}${unread ? `<span class="menu-count">${unread > 9 ? "9+" : unread}</span>` : ""}</button>
    <div class="menu-divider menu-mobile-only"></div>
    ${brandId ? `<button type="button" data-act="consultant">${icon("chat", { size: 15 })}${t("help.askAi")}</button>` : ""}
    ${canShowIntroVideo ? `<button type="button" data-act="intro">${icon("play", { size: 15 })}${t("help.introVideo")}</button>` : ""}
    <button type="button" data-act="tour">${icon("target", { size: 15 })}${t("help.tour")}</button>
    <div class="menu-divider"></div>
    <button type="button" data-act="mode">${icon(other === "guided" ? "target" : "sparkle", { size: 15 })}${t("menu.modeSwitch", { current: t(`mode.${mode}.name`), other: t(`mode.${other}.name`) })}</button>
    <button type="button" data-act="theme">${icon(getTheme() === "light" ? "moon" : "sun", { size: 15 })}${t("topbar.toggleTheme")}</button>
    <button type="button" class="menu-ai-row" data-act="ai">${aiUsageRowHTML()}</button>
    <div class="menu-divider"></div>
    <button type="button" data-go="#/settings">${icon("gear", { size: 15 })}${t("topbar.settings")}</button>
    <button type="button" data-act="logout">${icon("logout", { size: 15 })}${t("topbar.logout")}</button>
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

// Pemula ⇄ Pro used to switch silently: the page just looked different.
// Right after the switch, one small sheet says what changed and that the
// data is the same.
function showModeSwitched(mode) {
  const points = [1, 2, 3].map((i) => `<li>${escapeHtml(t(`mode.switched.${mode}.${i}`, { campaign: "campaign", funnel: "TOFU/MOFU/BOFU" }))}</li>`).join("");
  const overlay = openModal({
    title: t(`mode.switched.title.${mode}`),
    bodyHTML: `
      <ul class="mode-switched-list">${points}</ul>
      <p class="text-muted" style="margin:12px 0 0;font-size:13px;">${escapeHtml(t("mode.switched.same"))}</p>
    `,
    footHTML: `<button class="btn btn-primary" data-ok>${t("mode.switched.ok")}</button>`,
  });
  overlay.querySelector("[data-ok]").addEventListener("click", () => closeOverlay(overlay));
}

// Offline: a slim banner across the top while the connection is gone, so
// an edit that hasn't reached the cloud yet doesn't look lost or broken —
// Firestore keeps the writes and sends them when the connection is back.
let offlineWired = false;
function wireOfflineBanner() {
  if (offlineWired) return;
  offlineWired = true;
  const show = () => {
    if (document.getElementById("offline-banner")) return;
    const el = document.createElement("div");
    el.id = "offline-banner";
    el.className = "offline-banner";
    el.setAttribute("role", "status");
    el.innerHTML = `${icon("info", { size: 15 })}<span>${escapeHtml(t("app.offline"))}</span>`;
    document.body.appendChild(el);
    // The page (and the sticky header) move down by the banner's height.
    document.body.style.setProperty("--offline-h", `${el.offsetHeight}px`);
    document.body.classList.add("is-offline");
  };
  const hide = () => {
    const el = document.getElementById("offline-banner");
    if (!el) return;
    el.remove();
    document.body.classList.remove("is-offline");
    document.body.style.removeProperty("--offline-h");
    toast(t("app.backOnline"));
  };
  window.addEventListener("offline", show);
  window.addEventListener("online", hide);
  if (navigator.onLine === false) show();
}

export function wireShell({ brandId }) {
  wireAnnouncements();
  wireOfflineBanner();
  rememberLastBrand(brandId);
  installTopUpNotice();
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

  const menuBtn = qs("#app-menu-btn");
  menuBtn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    // guide-videos.js is only needed to decide whether "Video pengenalan"
    // belongs in this menu (canShowVideo) and to actually play it — loaded
    // here, on first ⋯ click, instead of statically at boot. Cached after
    // the first click, same as consultant-panel.js/tour.js above.
    const { canShowVideo, openIntroVideo } = await import("./guide-videos.js");
    if (menuBtn !== qs("#app-menu-btn")) return; // shell rebuilt while this awaited
    const menu = menuBelow(menuBtn, { className: "app-menu", width: 250 });
    if (!menu) return;
    menu.innerHTML = appMenuHTML(brandId, canShowVideo("kenalan"));
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
      if (act === "mode") showModeSwitched(toggleMode());
      else if (act === "consultant") openConsultantPanel();
      else if (act === "intro") openIntroVideo();
      else if (act === "tour") startOnboardingTour();
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
      ${others.map((b) => `<button data-go="${b.id}">${avatarHTML(b, "width:18px;height:18px;border-radius:5px;font-size:9px;flex:none;")}${escapeHtml(b.name)}</button>`).join("")}
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
