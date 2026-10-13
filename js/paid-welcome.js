// Who is owed the congratulations page after a payment (js/pay-thanks.js),
// and the mark that says they have had it. No DOM here: main.js asks this on
// every boot and every account change, before it decides what to paint, so
// someone who has just paid is never shown the plans page again — the page
// itself is only downloaded when it is due.
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly, accessState, hasPaidPlan, isAdmin, isLifetime, currentUid } from "./account.js";
import { readFlag, writeFlag } from "./seen-flags.js";

// The names date from when this was the "Makasih sudah gabung" sheet
// (js/community.js): accounts thanked by that sheet stay thanked.
const SEEN_PREFIX = "brandlab:community-welcome:";
const SEEN_KEY = "community:welcome";

// Which marks say "this account has been congratulated". A Lifetime account
// answers to its own: someone thanked as a subscriber who then buys Founder
// is congratulated again, because the Lifetime group is a door they have
// never been shown. Pressing the page's button as a Lifetime account covers
// both. Exported for the test.
const LIFETIME_MARK = "lifetime";
export function welcomeMarks(lifetime) {
  const own = lifetime ? `${SEEN_KEY}:${LIFETIME_MARK}` : SEEN_KEY;
  return { check: own, write: lifetime ? [SEEN_KEY, own] : [SEEN_KEY] };
}
const welcomeSeen = (lifetime) => !!getSettings()?.guideSeen?.[welcomeMarks(lifetime).check] || readFlag(SEEN_PREFIX, lifetime ? LIFETIME_MARK : "");

// Kept like every other "seen" mark: the account's settings (so it follows
// them to another device) with a local copy for the fast path.
export function markPaidWelcomeSeen(lifetime) {
  writeFlag(SEEN_PREFIX);
  if (lifetime) writeFlag(SEEN_PREFIX, LIFETIME_MARK);
  const seen = getSettings()?.guideSeen || {};
  const missing = welcomeMarks(lifetime).write.filter((key) => !seen[key]);
  if (!missing.length || isReadOnly(getCachedAccount())) return;
  const at = Date.now();
  updateSettings({ guideSeen: { ...seen, ...Object.fromEntries(missing.map((key) => [key, at])) } });
}

// Who gets the page: an account on a paid plan (not a trial, not the Wepeka
// team) that hasn't been congratulated yet. Exported for the test.
export function paidWelcomeDue(account, { seen = false, admin = false } = {}) {
  return !seen && !admin && accessState(account) === "paid" && hasPaidPlan(account);
}

// The signed-in account, right now. Ask only once the store is loaded:
// "seen" lives in settings.
export function isPaidWelcomeDue() {
  const account = getCachedAccount();
  return paidWelcomeDue(account, { seen: welcomeSeen(isLifetime(account)), admin: isAdmin(currentUid()) });
}
