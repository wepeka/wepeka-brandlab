// Brandlab's community doors: the WhatsApp group (announcements + a place
// to ask the Wepeka team), for Lifetime accounts their own group on top of
// it (the Founder Circle — its link comes from the server, api/community.js,
// never from this bundle), and the two Instagram accounts to follow. Each
// door keeps its check once tapped, and says what would be missed until
// then (owner, 2026-10-13). Shown
//   - right after an account becomes paid ("Makasih sudah gabung"), before
//     anything else of that boot (welcome video, mode picker) — once, and
//     once more when the account becomes Lifetime (its own group is new),
//   - any time from the ⋯ menu → Komunitas, for every account, and
//   - from the plans page's "Kamu sudah Lifetime" note.
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
      <span class="community-bubble" aria-hidden="true">${escapeHtml(bubble)}</span>
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

// The doors: join the group (a Lifetime account: its own group first), then
// follow each account.
export function communityLinksHTML({ lifetime = false } = {}) {
  const follow = FOLLOW_INSTAGRAM.map((handle) =>
    doorHTML({ id: `ig:${handle}`, cls: "community-ig", href: instagramUrl(handle), glyph: IG_ICON, todo: t("community.follow", { handle: `@${handle}` }), did: t("community.followed", { handle: `@${handle}` }), bubble: t("community.bubble.follow"), attrs: `data-community="instagram" data-handle="${escapeHtml(handle)}"` })
  ).join("");
  return `
    <div class="community-links">
      <p class="community-progress" data-community-progress></p>
      ${lifetime ? `<div class="community-slot" data-community-lifetime><p class="community-note community-wait"><span class="spinner" aria-hidden="true"></span>${t("community.lifetimeLoading")}</p></div>` : ""}
      ${doorHTML({ id: "wa", cls: "community-wa", href: BRANDLAB_WA_GROUP_URL, glyph: WA_ICON, todo: t("community.join"), did: t("community.joined"), bubble: t("community.bubble.group"), attrs: 'data-community="whatsapp" data-group="general"' })}
      <p class="community-note">${t("community.joinNote")}</p>
      <div class="community-sep"><span>${t("community.followHead")}</span></div>
      ${follow}
    </div>`;
}

function wireLinks(overlay) {
  paintProgress(overlay);
  overlay.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("[data-community]") : null;
    if (!a) return;
    a.classList.add("is-done");
    if (a.dataset.doneId) markDone(a.dataset.doneId);
    paintProgress(overlay);
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

// Which marks say "this account has been thanked". A Lifetime account
// answers to its own: someone thanked as a subscriber who then buys Founder
// is thanked again, because the Lifetime group is a door they have never
// been shown. Closing a Lifetime thank-you covers both. Exported for the test.
const LIFETIME_MARK = "lifetime";
export function welcomeMarks(lifetime) {
  const own = lifetime ? `${SEEN_KEY}:${LIFETIME_MARK}` : SEEN_KEY;
  return { check: own, write: lifetime ? [SEEN_KEY, own] : [SEEN_KEY] };
}
const welcomeSeen = (lifetime) => !!getSettings()?.guideSeen?.[welcomeMarks(lifetime).check] || readFlag(SEEN_PREFIX, lifetime ? LIFETIME_MARK : "");
function markWelcomeSeen(lifetime) {
  writeFlag(SEEN_PREFIX);
  if (lifetime) writeFlag(SEEN_PREFIX, LIFETIME_MARK);
  const seen = getSettings()?.guideSeen || {};
  const missing = welcomeMarks(lifetime).write.filter((key) => !seen[key]);
  if (!missing.length || isReadOnly(getCachedAccount())) return;
  const at = Date.now();
  updateSettings({ guideSeen: { ...seen, ...Object.fromEntries(missing.map((key) => [key, at])) } });
}

// Who gets the thank-you: an account on a paid plan (not a trial, not the
// Wepeka team) that hasn't been thanked yet. Exported for the test.
export function paidWelcomeDue(account, { seen = false, admin = false } = {}) {
  return !seen && !admin && accessState(account) === "paid" && hasPaidPlan(account);
}

// The first time the account is open on a paid plan (and again the first
// time on a Lifetime one). Resolves when the sheet closes — or right away
// when it isn't due — so a caller can hold the next thing (welcome video,
// mode picker) until then. Call only once the store is loaded: "seen" lives
// in settings.
//
// It counts as shown only once the buyer has closed it. It used to count the
// moment it opened, and a payment made outside the tab broke that: with
// GoPay the buyer is in the GoPay app while this tab, in the background and
// under Midtrans's window, opens the sheet for nobody — then comes back on
// a fresh page load that believed the thank-you was done (owner's report,
// 2026-10-13). A sheet nobody closed is offered again on the next boot.
let showing = null;
export function maybeShowPaidWelcome() {
  if (showing) return showing;
  const uid = currentUid();
  const lifetime = isLifetime(getCachedAccount());
  if (!paidWelcomeDue(getCachedAccount(), { seen: welcomeSeen(lifetime), admin: isAdmin(uid) })) return Promise.resolve(false);
  showing = openCommunityModal({ paid: true }).then(() => {
    showing = null;
    if (currentUid() === uid) markWelcomeSeen(lifetime);
    return true;
  });
  return showing;
}
