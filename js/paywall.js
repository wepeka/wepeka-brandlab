// Soft paywall gate for logged-out visitors — there's no real payment
// verification yet (no gateway, no self-serve signup), this just remembers
// that whoever is sitting at this browser has logged in successfully
// before, so returning team/customer accounts don't get stuck behind the
// pricing page again after signing out or their session expiring.
const PAYWALL_UNLOCK_KEY = "wepekaPaywallUnlocked";

export function unlockPaywall() {
  try { localStorage.setItem(PAYWALL_UNLOCK_KEY, "1"); } catch {}
}

export function isPaywallUnlocked() {
  try { return localStorage.getItem(PAYWALL_UNLOCK_KEY) === "1"; } catch { return false; }
}
