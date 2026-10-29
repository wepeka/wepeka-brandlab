// Brandlab's community doors: the WhatsApp group (announcements + a place
// to ask the Wepeka team), for Lifetime accounts their own group on top of
// it (the Founder Circle — its link comes from the server, api/community.js,
// never from this bundle) and a chat to ask the Wepeka team, and the
// two Instagram accounts to follow. Each
// door keeps its check once tapped, and says what would be missed until
// then (owner, 2026-10-13). Shown
//   - on the congratulations page right after an account becomes paid
//     (js/pay-thanks.js), before anything else of that boot,
//   - any time from the ⋯ menu → Komunitas, for every account,
//   - from the plans page's "Kamu sudah Lifetime" note, and
//   - the WhatsApp groups alone from the green button in the topbar
//     (waTopbarHTML below).
// The links themselves live in js/site-links.js (and api/_community.js for
// the email sent after payment — same values, checked by a test).
import { icon } from "./icons.js";
import { escapeHtml, openMenu, closeMenu } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly, isLifetime } from "./account.js";
import { auth } from "./firebase.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { gaEvent } from "./analytics.js";
import { BRANDLAB_WA_GROUP_URL, FOLLOW_INSTAGRAM, SUPPORT_WA_NUMBER, instagramUrl } from "./site-links.js";
import { t } from "./i18n.js";

const IG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/></svg>`;
const WA_ICON = `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 00-8.5 14.98L2 22l5.15-1.5A9.93 9.93 0 1012.04 2zm0 1.8a8.12 8.12 0 016.9 12.42 8.13 8.13 0 01-10.97 2.7l-.3-.17-3.06.9.9-2.98-.2-.31A8.12 8.12 0 0112.04 3.8zM8.6 7.3c-.2 0-.5.07-.75.35-.26.28-.99.96-.99 2.35 0 1.38 1.01 2.72 1.15 2.9.14.2 1.96 3.13 4.84 4.26 2.4.94 2.88.75 3.4.7.52-.04 1.68-.68 1.92-1.34.24-.66.24-1.23.17-1.35-.07-.11-.26-.18-.54-.32-.28-.14-1.68-.83-1.94-.92-.26-.1-.45-.14-.64.14-.19.28-.73.92-.9 1.11-.16.19-.33.21-.61.07-.28-.14-1.2-.44-2.28-1.4a8.56 8.56 0 01-1.58-1.97c-.17-.28-.02-.44.12-.58.13-.12.28-.33.42-.5.14-.16.19-.28.28-.47.1-.19.05-.35-.02-.5-.07-.14-.63-1.55-.88-2.12-.22-.52-.45-.45-.62-.46z"/></svg>`;

// What this account has already done, door by door ("wa", "wa-lifetime",
// "ig:<handle>"): a tap on a button counts, since nothing can tell us more.
// Kept like every other "seen" mark — the account's settings (so it follows
// them to another device) with a local copy for the fast path. A done door
// reads "Sudah join" / "Sudah follow" with a filled check and steps back, so
// the ones still open — and their "don't miss it" bubbles — stand out.
const DONE_PREFIX = "brandlab:community-done:";
const doneKey = (id) => `community:done:${id}`;
const isDone = (id) => !!getSettings()?.guideSeen?.[doneKey(id)] || readFlag(DONE_PREFIX, id);
function markDone(id) {
  writeFlag(DONE_PREFIX, id);
  const seen = getSettings()?.guideSeen || {};
  if (seen[doneKey(id)] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen, [doneKey(id)]: Date.now() } });
}

// One door: icon, what to do (or that it's done), the check, and the
// floating bubble that says why it's worth it. All text is ours.
function doorHTML({ id, cls, href, glyph, todo, did, bubble, attrs = "" }) {
  return `
    <a class="community-btn ${cls}${isDone(id) ? " is-done" : ""}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-done-id="${escapeHtml(id)}" ${attrs}>
      ${glyph}
      <span class="community-label"><span class="community-todo">${escapeHtml(todo)}</span><span class="community-did">${escapeHtml(did)}</span></span>
      <span class="community-tick" aria-hidden="true">${icon("check", { size: 14 })}</span>
      ${bubble ? `<span class="community-bubble" aria-hidden="true">${escapeHtml(bubble)}</span>` : ""}
    </a>`;
}

// "2 of 4 done — don't miss the rest", from the doors on screen.
export function progressText(done, total) {
  if (total <= 0) return "";
  if (done >= total) return t("community.progress.all");
  return done <= 0 ? t("community.progress.none", { total }) : t("community.progress.some", { done, total });
}
function paintProgress(scope) {
  const line = scope.querySelector("[data-community-progress]");
  if (!line) return;
  const doors = [...scope.querySelectorAll("[data-done-id]")];
  const done = doors.filter((a) => a.classList.contains("is-done")).length;
  line.textContent = progressText(done, doors.length);
  line.classList.toggle("is-complete", doors.length > 0 && done >= doors.length);
}

// A Lifetime account's own group. The server decides who gets the link; a
// failed or empty answer simply leaves the button out. A link once given is
// kept for the session, so the topbar's popover opens with it in place.
let lifetimeUrlKnown = null;
async function lifetimeGroupUrl() {
  if (lifetimeUrlKnown) return lifetimeUrlKnown;
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;
    const res = await fetch("/api/community", { headers: { Authorization: `Bearer ${idToken}` } });
    const url = res.ok ? (await res.json())?.lifetimeGroupUrl : null;
    if (typeof url !== "string" || !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(url)) return null;
    lifetimeUrlKnown = url;
    return url;
  } catch {
    return null;
  }
}
const lifetimeDoorHTML = (url) => `
  ${doorHTML({ id: "wa-lifetime", cls: "community-wa community-lifetime", href: url, glyph: WA_ICON, todo: t("community.joinLifetime"), did: t("community.joinedLifetime"), bubble: t("community.bubble.group"), attrs: 'data-community="whatsapp" data-group="lifetime"' })}
  <p class="community-note">${t("community.joinLifetimeNote")}</p>`;
function loadLifetimeGroup(overlay) {
  const slot = overlay.querySelector("[data-community-lifetime]");
  if (!slot) return;
  lifetimeGroupUrl().then((url) => {
    if (!slot.isConnected) return;
    if (url) slot.innerHTML = lifetimeDoorHTML(url);
    else slot.remove();
    paintProgress(overlay);
  });
}

// A Lifetime account is guided by the Wepeka team until Brandlab runs, over
// chat: Brand DNA + Brand Book checked, the first goal and week planned (the
// promise on /founder, owner 2026-10-18; no 1-on-1 sessions, owner 2026-10-24). It starts with a
// WhatsApp chat to the team, so this door comes first.
const guideDoorHTML = () => `
  ${doorHTML({ id: "guide", cls: "community-wa community-guide", href: `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(t("community.guideText"))}`, glyph: WA_ICON, todo: t("community.guide"), did: t("community.guided"), bubble: t("community.bubble.guide"), attrs: 'data-community="guide"' })}
  <p class="community-note">${t("community.guideNote")}</p>`;

// The doors: a Lifetime account's guidance and its own group first, then
// the general group, then follow each account.
export function communityLinksHTML({ lifetime = false } = {}) {
  const follow = FOLLOW_INSTAGRAM.map((handle) =>
    doorHTML({ id: `ig:${handle}`, cls: "community-ig", href: instagramUrl(handle), glyph: IG_ICON, todo: t("community.follow", { handle: `@${handle}` }), did: t("community.followed", { handle: `@${handle}` }), bubble: t("community.bubble.follow"), attrs: `data-community="instagram" data-handle="${escapeHtml(handle)}"` })
  ).join("");
  return `
    <div class="community-links">
      <p class="community-progress" data-community-progress></p>
      ${lifetime ? guideDoorHTML() : ""}
      ${lifetime ? `<div class="community-slot" data-community-lifetime><p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("community.lifetimeLoading")}</p></div>` : ""}
      ${doorHTML({ id: "wa", cls: "community-wa", href: BRANDLAB_WA_GROUP_URL, glyph: WA_ICON, todo: t("community.join"), did: t("community.joined"), bubble: t("community.bubble.group"), attrs: 'data-community="whatsapp" data-group="general"' })}
      <p class="community-note">${t("community.joinNote")}</p>
      <div class="community-sep"><span>${t("community.followHead")}</span></div>
      ${follow}
    </div>`;
}

// Brings the doors inside `scope` to life: the count above them, the checks,
// and a Lifetime account's own group once the server has answered. For
// whoever renders communityLinksHTML (the sheet below, js/pay-thanks.js).
export function mountCommunityLinks(scope) {
  paintProgress(scope);
  scope.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("[data-community]") : null;
    if (!a) return;
    a.classList.add("is-done");
    if (a.dataset.doneId) markDone(a.dataset.doneId);
    paintProgress(scope);
    if (a.dataset.community === "whatsapp") gaEvent("join_group", { method: "whatsapp", location: "brandlab_app", group: a.dataset.group || "general" });
    else if (a.dataset.community === "guide") gaEvent("guide_start", { method: "whatsapp", location: "brandlab_app" });
    else gaEvent("social_click", { network: "instagram", handle: a.dataset.handle || "", location: "brandlab_app" });
  });
  loadLifetimeGroup(scope);
}

// The "Komunitas" sheet. Resolves when it closes.
export function openCommunityModal() {
  const lifetime = isLifetime(getCachedAccount());
  return new Promise((resolve) => {
    const overlay = openModal({
      title: t("community.title"),
      bodyHTML: `
        <p class="community-lead">${t("community.body")}</p>
        ${communityLinksHTML({ lifetime })}
      `,
      footHTML: `<button type="button" class="btn btn-primary" data-community-done>${t("common.close")}</button>`,
    });
    overlay.setAttribute("data-community-modal", "menu");
    mountCommunityLinks(overlay);
    overlay.querySelector("[data-community-done]").addEventListener("click", () => closeOverlay(overlay));
    const obs = new MutationObserver(() => {
      if (overlay.isConnected) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(document.body, { childList: true });
  });
}

// The WhatsApp button in the topbar (owner, 2026-10-21: a button in the top
// corner to join the group; once joined it takes you to WhatsApp, so the
// group is one tap away and easy to spot — green, glowing).
//   Not joined yet  "Join grup Brandlab" (owner's words), pulsing. A tap opens a small popover:
//                   what the group is for and its button — two groups and
//                   two buttons for a Lifetime account (its own group, then
//                   the Brandlab group), one for everyone else.
//   Joined          "Buka grup Brandlab", a steady glow. With one group the button
//                   goes straight there; a Lifetime account picks one of its
//                   two in the same popover.
// "Joined" is the Komunitas sheet's own mark ("wa", "wa-lifetime"): a tap on
// either group's button, here or there, counts.
export const waGroupIds = (lifetime) => (lifetime ? ["wa-lifetime", "wa"] : ["wa"]);
export const waAllJoined = (lifetime, done = isDone) => waGroupIds(lifetime).every((id) => done(id));

const waState = (lifetime, joined) => `${lifetime ? "two" : "one"}:${joined ? "in" : "out"}`;

export function waTopbarHTML() {
  const lifetime = isLifetime(getCachedAccount());
  const joined = waAllJoined(lifetime);
  const name = escapeHtml(t(joined ? "wa.top.openTitle" : "wa.top.joinTitle"));
  const attrs = `id="wa-group-btn" class="wa-top${joined ? " is-joined" : ""}" data-wa-state="${waState(lifetime, joined)}" title="${name}" aria-label="${name}"`;
  // The words in full where the row has room, shortened where it's tight
  // (css/styles.css .wa-top).
  const inner = `${WA_ICON}<span class="wa-top-label"><span class="wa-top-long">${escapeHtml(t(joined ? "wa.top.open" : "wa.top.join"))}</span><span class="wa-top-short">${escapeHtml(t(joined ? "wa.top.openShort" : "wa.top.joinShort"))}</span></span>`;
  if (joined && !lifetime) return `<a ${attrs} href="${escapeHtml(BRANDLAB_WA_GROUP_URL)}" target="_blank" rel="noopener noreferrer" data-wa-direct>${inner}</a>`;
  return `<button type="button" ${attrs} aria-haspopup="dialog" aria-expanded="false">${inner}</button>`;
}

// What each group is for. Only what the groups really carry (owner,
// 2026-10-13/16): news, fixes and tips, questions to the team; for the
// Founder Circle, the Founder sessions' schedule and the Founders themselves.
const WA_PERKS = { wa: ["news", "tips", "ask"], "wa-lifetime": ["live", "founders"] };
const PERK_ICON = { news: "megaphone", tips: "bulb", ask: "chat", live: "calendar", founders: "users" };
const perksHTML = (id) => `<ul class="wa-pop-perks">${WA_PERKS[id].map((k) => `<li>${icon(PERK_ICON[k], { size: 15 })}<span>${escapeHtml(t(`wa.perk.${k}`))}</span></li>`).join("")}</ul>`;
const generalPopDoorHTML = () => doorHTML({ id: "wa", cls: "community-wa", href: BRANDLAB_WA_GROUP_URL, glyph: WA_ICON, todo: t("community.join"), did: t("wa.pop.openGeneral"), attrs: 'data-community="whatsapp" data-group="general"' });
const lifetimePopDoorHTML = (url) => doorHTML({ id: "wa-lifetime", cls: "community-wa community-lifetime", href: url, glyph: WA_ICON, todo: t("community.joinLifetime"), did: t("wa.pop.openLifetime"), attrs: 'data-community="whatsapp" data-group="lifetime"' });

export function waPopoverHTML({ lifetime = false } = {}) {
  const wait = `<p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("community.lifetimeLoading")}</p>`;
  return `
    <div class="wa-pop-head">
      <span class="wa-pop-glyph" aria-hidden="true">${WA_ICON}</span>
      <div>
        <p class="wa-pop-title">${t(lifetime ? "wa.pop.titleTwo" : "wa.pop.title")}</p>
        <p class="wa-pop-sub">${t(lifetime ? "wa.pop.subTwo" : "wa.pop.sub")}</p>
      </div>
    </div>
    ${lifetime ? `
    <section class="wa-pop-group is-lifetime" data-wa-group="lifetime">
      <p class="wa-pop-name">${t("wa.pop.lifetime")}<span class="wa-pop-tag">${t("community.bubble.guide")}</span></p>
      ${perksHTML("wa-lifetime")}
      <div class="wa-pop-door" data-wa-lifetime>${lifetimeUrlKnown ? lifetimePopDoorHTML(lifetimeUrlKnown) : wait}</div>
    </section>` : ""}
    <section class="wa-pop-group" data-wa-group="general">
      <p class="wa-pop-name">${t(lifetime ? "wa.pop.general" : "wa.pop.canDo")}</p>
      ${perksHTML("wa")}
      <div class="wa-pop-door">${generalPopDoorHTML()}</div>
    </section>
    <p class="wa-pop-foot">${t("community.joinNote")}</p>`;
}

// The button changes its words once every group of the account is tapped,
// and its groups when the plan changes with the app open (a Founder payment
// lands while the shell stays).
function repaintWaTopbar() {
  const old = document.getElementById("wa-group-btn");
  const lifetime = isLifetime(getCachedAccount());
  if (!old || old.dataset.waState === waState(lifetime, waAllJoined(lifetime))) return;
  old.insertAdjacentHTML("afterend", waTopbarHTML());
  old.remove();
  wireWaTopbar();
}
let accountWatched = false;

function openWaPopover(btn) {
  const lifetime = isLifetime(getCachedAccount());
  const width = 330;
  const rect = btn.getBoundingClientRect();
  const pop = openMenu(btn, { className: "wa-pop", top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) });
  if (!pop) return;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t(lifetime ? "wa.pop.titleTwo" : "wa.pop.title"));
  pop.innerHTML = waPopoverHTML({ lifetime });
  pop.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("[data-community]") : null;
    if (!a) return;
    const again = a.classList.contains("is-done");
    a.classList.add("is-done");
    markDone(a.dataset.doneId);
    gaEvent(again ? "wa_group_open" : "join_group", { method: "whatsapp", location: "brandlab_topbar", group: a.dataset.group || "general" });
    if (waAllJoined(lifetime)) closeMenu();
    repaintWaTopbar();
  });
  if (!lifetime || lifetimeUrlKnown) return;
  const slot = pop.querySelector("[data-wa-lifetime]");
  lifetimeGroupUrl().then((url) => {
    if (!slot?.isConnected) return;
    if (url) slot.innerHTML = lifetimePopDoorHTML(url);
    else slot.closest("[data-wa-group]")?.remove();
  });
}

// For js/layout.js wireShell, once the topbar is on the page.
export function wireWaTopbar() {
  if (!accountWatched) {
    accountWatched = true;
    window.addEventListener("account:change", repaintWaTopbar);
  }
  const btn = document.getElementById("wa-group-btn");
  btn?.addEventListener("click", (e) => {
    if (btn.hasAttribute("data-wa-direct")) {
      gaEvent("wa_group_open", { method: "whatsapp", location: "brandlab_topbar", group: "general" });
      return;
    }
    e.stopPropagation();
    openWaPopover(btn);
  });
}
