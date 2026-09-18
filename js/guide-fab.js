// Floating "Panduan" button — same idea as wepeka.com's compass button:
// always on screen, so someone can call for help the moment they're lost
// instead of hunting for the small Panduan button in a page header. It
// doesn't own any tour itself; it just triggers whatever guide the current
// page already has (the page's own Panduan/Video buttons, the AI
// Consultant, or the app-wide onboarding tour as the fallback).
import { icon } from "./icons.js";
import { qs } from "./dom.js";
import { maybeShowBrandlabIntro } from "./brandlab-intro.js";
import { t } from "./i18n.js";

let menuEl = null;

function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  qs("#guide-fab")?.classList.remove("is-open");
  document.removeEventListener("click", onDocClick, true);
  document.removeEventListener("keydown", onKey);
}
function onDocClick(e) {
  if (menuEl && !menuEl.contains(e.target) && !e.target.closest("#guide-fab")) closeMenu();
}
function onKey(e) {
  if (e.key === "Escape") closeMenu();
}

function itemsHTML() {
  // 7: "Tur halaman ini" dropped — every page already has its own Panduan
  // button in its header (sectionGuideButtonHTML), so this FAB item was a
  // second, redundant way to trigger the exact same thing.
  const pageVideo = qs("[data-guide-video-btn]");
  const consultant = qs("#consultant-fab");
  const items = [];
  if (pageVideo) items.push({ act: "video", icon: "play", t: t("guide.fab.video.t"), m: t("guide.fab.video.m") });
  if (consultant) items.push({ act: "ai", icon: "chat", t: t("guide.fab.ai.t"), m: t("guide.fab.ai.m") });
  items.push({ act: "onboarding", icon: "sparkle", t: t("guide.fab.onboarding.t"), m: t("guide.fab.onboarding.m") });
  return items
    .map(
      (it) => `
      <button type="button" class="guide-fab-item" data-guide-act="${it.act}">
        <span class="guide-fab-item-icon">${icon(it.icon, { size: 15 })}</span>
        <span class="guide-fab-item-text"><b>${it.t}</b><span>${it.m}</span></span>
      </button>`
    )
    .join("");
}

function runAction(act) {
  closeMenu();
  if (act === "video") {
    qs("[data-guide-video-btn]")?.click();
  } else if (act === "ai") {
    qs("#consultant-fab")?.click();
  } else if (act === "onboarding") {
    // Re-opens the welcome modal on purpose (it only ever autoplays once
    // per account) — its own "Ikuti tur" button is what starts the tour.
    maybeShowBrandlabIntro({ offerTour: true, force: true });
  }
}

function openMenu(fab) {
  if (menuEl) return closeMenu();
  menuEl = document.createElement("div");
  menuEl.className = "guide-fab-menu";
  menuEl.setAttribute("role", "menu");
  menuEl.innerHTML = `<div class="guide-fab-menu-head">${t("guide.fab.head")}</div>${itemsHTML()}`;
  document.body.appendChild(menuEl);
  fab.classList.add("is-open");
  menuEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-guide-act]");
    if (b) runAction(b.dataset.guideAct);
  });
  setTimeout(() => {
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey);
  }, 0);
}

export function mountGuideFab() {
  if (qs("#guide-fab")) return;
  const fab = document.createElement("button");
  fab.type = "button";
  fab.id = "guide-fab";
  fab.className = "guide-fab";
  fab.setAttribute("aria-label", t("guide.btn"));
  fab.title = t("guide.btn");
  fab.innerHTML = `${icon("target", { size: 17 })}<span>${t("guide.btn")}</span>`;
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu(fab);
  });
  document.body.appendChild(fab);
}

export function unmountGuideFab() {
  closeMenu();
  qs("#guide-fab")?.remove();
}
