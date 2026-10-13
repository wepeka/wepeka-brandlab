// Brandlab's community doors: the WhatsApp group (announcements + a place
// to ask the Wepeka team), for Lifetime accounts their own group on top of
// it (the Founder Circle — its link comes from the server, api/community.js,
// never from this bundle), and the two Instagram accounts to follow. Shown
//   - once, right after an account becomes paid ("Makasih sudah gabung"),
//     before anything else of that boot (welcome video, mode picker), and
//   - any time from the ⋯ menu → Komunitas, for every account.
// The links themselves live in js/site-links.js (and api/_community.js for
// the email sent after payment — same values, checked by a test).
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { openModal, closeOverlay } from "./modals.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly, accessState, hasPaidPlan, isAdmin, isLifetime, currentUid } from "./account.js";
import { auth } from "./firebase.js";
import { readFlag, writeFlag } from "./seen-flags.js";
import { gaEvent } from "./analytics.js";
import { BRANDLAB_WA_GROUP_URL, FOLLOW_INSTAGRAM, instagramUrl } from "./site-links.js";
import { t } from "./i18n.js";

const SEEN_PREFIX = "brandlab:community-welcome:";
const SEEN_KEY = "community:welcome";

const IG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/></svg>`;
const WA_ICON = `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 00-8.5 14.98L2 22l5.15-1.5A9.93 9.93 0 1012.04 2zm0 1.8a8.12 8.12 0 016.9 12.42 8.13 8.13 0 01-10.97 2.7l-.3-.17-3.06.9.9-2.98-.2-.31A8.12 8.12 0 0112.04 3.8zM8.6 7.3c-.2 0-.5.07-.75.35-.26.28-.99.96-.99 2.35 0 1.38 1.01 2.72 1.15 2.9.14.2 1.96 3.13 4.84 4.26 2.4.94 2.88.75 3.4.7.52-.04 1.68-.68 1.92-1.34.24-.66.24-1.23.17-1.35-.07-.11-.26-.18-.54-.32-.28-.14-1.68-.83-1.94-.92-.26-.1-.45-.14-.64.14-.19.28-.73.92-.9 1.11-.16.19-.33.21-.61.07-.28-.14-1.2-.44-2.28-1.4a8.56 8.56 0 01-1.58-1.97c-.17-.28-.02-.44.12-.58.13-.12.28-.33.42-.5.14-.16.19-.28.28-.47.1-.19.05-.35-.02-.5-.07-.14-.63-1.55-.88-2.12-.22-.52-.45-.45-.62-.46z"/></svg>`;

// A Lifetime account's own group. The server decides who gets the link; a
// failed or empty answer simply leaves the button out.
async function lifetimeGroupUrl() {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;
    const res = await fetch("/api/community", { headers: { Authorization: `Bearer ${idToken}` } });
    const url = res.ok ? (await res.json())?.lifetimeGroupUrl : null;
    return typeof url === "string" && /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(url) ? url : null;
  } catch {
    return null;
  }
}
const lifetimeButtonHTML = (url) => `
  <a class="community-btn community-wa community-lifetime" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-community="whatsapp" data-group="lifetime">
    ${WA_ICON}<span>${t("community.joinLifetime")}</span>${icon("check", { size: 15 })}
  </a>
  <p class="community-note">${t("community.joinLifetimeNote")}</p>`;
function loadLifetimeGroup(overlay) {
  const slot = overlay.querySelector("[data-community-lifetime]");
  if (!slot) return;
  lifetimeGroupUrl().then((url) => {
    if (!slot.isConnected) return;
    if (url) slot.innerHTML = lifetimeButtonHTML(url);
    else slot.remove();
  });
}

// The buttons: join the group (a Lifetime account: its own group first),
// then follow each account. A tapped button gets a check, so someone working
// down the list sees what's left.
export function communityLinksHTML({ lifetime = false } = {}) {
  const follow = FOLLOW_INSTAGRAM.map(
    (handle) => `
      <a class="community-btn community-ig" href="${escapeHtml(instagramUrl(handle))}" target="_blank" rel="noopener noreferrer" data-community="instagram" data-handle="${escapeHtml(handle)}">
        ${IG_ICON}<span>${escapeHtml(t("community.follow", { handle: `@${handle}` }))}</span>${icon("check", { size: 15 })}
      </a>`
  ).join("");
  return `
    <div class="community-links">
      ${lifetime ? `<div class="community-slot" data-community-lifetime><p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("community.lifetimeLoading")}</p></div>` : ""}
      <a class="community-btn community-wa" href="${escapeHtml(BRANDLAB_WA_GROUP_URL)}" target="_blank" rel="noopener noreferrer" data-community="whatsapp" data-group="general">
        ${WA_ICON}<span>${t("community.join")}</span>${icon("check", { size: 15 })}
      </a>
      <p class="community-note">${t("community.joinNote")}</p>
      <div class="community-sep"><span>${t("community.followHead")}</span></div>
      ${follow}
    </div>`;
}

function wireLinks(overlay) {
  overlay.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("[data-community]") : null;
    if (!a) return;
    a.classList.add("is-done");
    if (a.dataset.community === "whatsapp") gaEvent("join_group", { method: "whatsapp", location: "brandlab_app", group: a.dataset.group || "general" });
    else gaEvent("social_click", { network: "instagram", handle: a.dataset.handle || "", location: "brandlab_app" });
  });
}

// `paid`: the thank-you after a payment; otherwise the plain "Komunitas"
// sheet from the menu. Resolves when the sheet closes.
export function openCommunityModal({ paid = false } = {}) {
  const lifetime = isLifetime(getCachedAccount());
  return new Promise((resolve) => {
    const overlay = openModal({
      title: paid ? t("community.paid.title") : t("community.title"),
      bodyHTML: `
        <p class="community-lead">${paid ? t("community.paid.body") : t("community.body")}</p>
        ${communityLinksHTML({ lifetime })}
      `,
      footHTML: `<button type="button" class="btn btn-primary" data-community-done>${paid ? t("community.paid.cta") : t("common.close")}</button>`,
    });
    overlay.setAttribute("data-community-modal", paid ? "paid" : "menu");
    wireLinks(overlay);
    loadLifetimeGroup(overlay);
    overlay.querySelector("[data-community-done]").addEventListener("click", () => closeOverlay(overlay));
    const obs = new MutationObserver(() => {
      if (overlay.isConnected) return;
      obs.disconnect();
      resolve();
    });
    obs.observe(document.body, { childList: true });
  });
}

const welcomeSeen = () => !!getSettings()?.guideSeen?.[SEEN_KEY] || readFlag(SEEN_PREFIX);
function markWelcomeSeen() {
  writeFlag(SEEN_PREFIX);
  const seen = getSettings()?.guideSeen || {};
  if (seen[SEEN_KEY] || isReadOnly(getCachedAccount())) return;
  updateSettings({ guideSeen: { ...seen, [SEEN_KEY]: Date.now() } });
}

// Who gets the thank-you: an account on a paid plan (not a trial, not the
// Wepeka team), once. Exported for the test.
export function paidWelcomeDue(account, { seen = false, admin = false } = {}) {
  return !seen && !admin && accessState(account) === "paid" && hasPaidPlan(account);
}

// Once per account, the first time it is open on a paid plan. Resolves when
// the sheet closes — or right away when it isn't due — so a caller can hold
// the next thing (welcome video, mode picker) until then. Call only once the
// store is loaded: "seen" lives in settings.
let showing = null;
export function maybeShowPaidWelcome() {
  if (showing) return showing;
  if (!paidWelcomeDue(getCachedAccount(), { seen: welcomeSeen(), admin: isAdmin(currentUid()) })) return Promise.resolve(false);
  markWelcomeSeen();
  showing = openCommunityModal({ paid: true }).then(() => {
    showing = null;
    return true;
  });
  return showing;
}
