// "start_trial" for GA4 (+ Meta's StartTrial): once per account, the first
// time a NEW trial account opens the app.
//
// The trial is claimed on www.wepeka.com (wpk-dp claimTrialAction), which
// redirects straight into the app — no page is left there for a browser
// event, so the site only sends a server-side Meta StartTrial (event id
// `trial-<uid>`) and GA4 never heard of it: the funnel went sign_up →
// (nothing) → purchase. The app reports it on arrival instead, with the same
// Meta event id so Meta counts the server's and the browser's as one.
//
// "New" is what keeps this from firing for every trial that already existed
// when this shipped: the account doc must have been created within the last
// TRIAL_START_WINDOW_MS. "Once" lives where the other shown-once marks do —
// settings.guideSeen on the account (follows the person to another device)
// plus the per-account browser flag (js/seen-flags.js).
import { gaEvent } from "./analytics.js";
import { metaTrack, withinMetaDedup } from "./meta-pixel.js";
import { getSettings, updateSettings, whenServerSynced } from "./store.js";
import { getCachedAccount, accessState, currentUid } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";

export const TRIAL_START_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SEEN_PREFIX = "brandlab:trial-start:";
const SEEN_KEY = "analytics:start-trial";

// A running trial whose account doc is at most three days old (createdAt is
// written by wpk-dp createTrialAccount together with plan "trial"; a little
// clock difference either way still counts). Exported for the test.
export function trialStartDue(account, { seen = false, now = Date.now() } = {}) {
  if (seen || accessState(account) !== "trial") return false;
  const createdAt = account.createdAt;
  return typeof createdAt === "number" && createdAt > 0 && Math.abs(now - createdAt) <= TRIAL_START_WINDOW_MS;
}

const startSeen = () => !!getSettings()?.guideSeen?.[SEEN_KEY] || readFlag(SEEN_PREFIX);
function markStartSeen() {
  writeFlag(SEEN_PREFIX);
  const seen = getSettings()?.guideSeen || {};
  if (seen[SEEN_KEY]) return;
  updateSettings({ guideSeen: { ...seen, [SEEN_KEY]: Date.now() } });
}

// The Wepeka hand-off carries a sign-in token in the fragment (#/sso?t=…);
// nothing is reported while it's there (main.js wipes it before signing in).
const tokenInUrl = () => location.hash.startsWith("#/sso");

// Sends the event if it's due — at most once per page, whatever storage
// says. Call only once the store is loaded: "seen" lives in settings.
// Nothing personal goes to GA4; the uid is only Meta's de-duplication id,
// the same one the server already sent.
let sent = false;
export function sendTrialStartIfDue() {
  try {
    if (sent) return false;
    if (tokenInUrl()) {
      window.addEventListener("hashchange", sendTrialStartIfDue, { once: true });
      return false;
    }
    const uid = currentUid();
    const account = getCachedAccount();
    if (!uid || !trialStartDue(account, { seen: startSeen() })) return false;
    sent = true;
    markStartSeen();
    gaEvent("start_trial", { plan: "trial" });
    // The server's StartTrial went out when the account was created; past
    // Meta's matching window the browser's would be a second conversion.
    if (withinMetaDedup(account.createdAt)) metaTrack("StartTrial", { content_name: "brandlab", currency: "IDR", value: 0 }, `trial-${uid}`);
    return true;
  } catch {
    return false; // analytics must never break the app
  }
}

// main.js calls this when an account's store has loaded and never waits for
// it. The check itself waits for the server's copy of this account's data,
// so a mark set on another device isn't missed because this one painted from
// an older cache first.
export function trackTrialStart() {
  try {
    const uid = currentUid();
    if (!uid) return;
    whenServerSynced()
      .then(() => { if (currentUid() === uid) sendTrialStartIfDue(); })
      .catch(() => {});
  } catch {
    /* analytics must never break the boot */
  }
}
