// "Already shown this once" marks kept in localStorage — scoped to the
// signed-in account.
//
// Every one of these flags answers a per-PERSON question ("has this user
// seen the intro video / this page's guide / the onboarding tour?"), but
// localStorage answers a per-BROWSER one. Unscoped, the second account to
// sign in on the same laptop was born having "already seen" everything: no
// intro video, no section guides, no tour offer — the exact bug reported
// against a freshly registered account on a browser that had run the flow
// before. Namespacing by uid keeps one person's history out of another's.
//
// The account-level mirror (settings.guideSeen in Firestore) is still the
// authoritative copy and is what carries a flag across devices; this is
// only the local fast path, and for readonly accounts the only one.
import { currentUid } from "./account.js";

// Signed out (or auth not settled yet) still needs somewhere to write, so
// those marks land in their own bucket instead of leaking into whoever
// signs in next.
const scope = () => currentUid() || "anon";

function store() {
  try {
    return window.localStorage;
  } catch {
    return null; // private window, storage blocked — callers fall back to the account flag
  }
}

// `prefix` keeps the old "contentos:<what>:" shape; `key` is optional so a
// single global flag (the onboarding tour) can use this too.
export function flagKey(prefix, key = "") {
  return `${prefix}${scope()}${key ? `:${key}` : ""}`;
}

export function readFlag(prefix, key) {
  try {
    return !!store()?.getItem(flagKey(prefix, key));
  } catch {
    return false;
  }
}

export function writeFlag(prefix, key) {
  try {
    store()?.setItem(flagKey(prefix, key), "1");
  } catch {
    /* ignore */
  }
}

export function clearFlag(prefix, key) {
  try {
    store()?.removeItem(flagKey(prefix, key));
  } catch {
    /* ignore */
  }
}
