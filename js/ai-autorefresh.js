// "Saran AI ter-update sendiri" — one rule for every saved piece of AI
// advice that can go stale (the Sales Tracker's advice, a campaign's
// Rencana playbook): when something important has happened since it was
// written, the page rewrites it on its own, and says why.
//
// The app starts these calls, so they never cost the owner a credit
// (js/ai.js callModel countUsage:false) — the API bill is Wepeka's, which is
// why the guards are strict:
//   - only for advice the owner already asked for once (never a first run),
//   - at most once per signal (the advice keeps `refreshedFor: [keys]`),
//   - at most once per page per day (`autoDay`),
//   - never for an account whose plan has ended, a tour demo, or without an
//     AI key.
import { getCachedAccount, accessState } from "./account.js";
import { hasAiKey } from "./ai.js";
import { computeSignals } from "./brand-pulse.js";
import { isTourDemo } from "./tour-demo.js";
import { localISODate } from "./store.js";

// What counts as "something happened": moves in sales, a post taking off
// or selling, engagement falling, followers jumping.
export const REFRESH_KINDS = ["sales-up", "sales-down", "viral", "content-sales", "engagement-drop", "follower-jump"];

// The newest important signal the advice hasn't seen yet, or null.
// `advice`: { at, refreshedFor?, autoDay? } as stored with it.
export function staleBecause(advice, { brand, content = [], campaigns = [], settings }) {
  if (!advice?.at || !brand || !settings) return null;
  const done = new Set(advice.refreshedFor || []);
  const fresh = computeSignals({ brand, content, campaigns, settings });
  // Signals already written to brand memory count too (the pulse persists
  // them, js/main.js), so a spike from last week isn't forgotten because
  // it no longer computes today.
  const logged = (brand.developmentLog || []).filter((e) => (e.source || "auto") === "auto");
  const byKey = new Map();
  [...logged, ...fresh].forEach((s) => { if (s?.key) byKey.set(s.key, s); });
  return [...byKey.values()]
    .filter((s) => REFRESH_KINDS.includes(s.kind) && (s.at || 0) > advice.at && !done.has(s.key))
    .sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
}

// May the app spend a free call on this advice right now?
export function mayAutoRefresh(advice, ai) {
  if (!advice?.at) return false;
  if (advice.autoDay === localISODate()) return false;
  if (isTourDemo()) return false;
  if (!hasAiKey(ai || {})) return false;
  const state = accessState(getCachedAccount());
  return state === "paid" || state === "trial";
}

// What to store with the rewritten advice.
export function refreshStamp(advice, signal) {
  return {
    autoReason: [signal.title, signal.detail].filter(Boolean).join(" — ").slice(0, 200),
    refreshedFor: [...(advice?.refreshedFor || []), signal.key].slice(-30),
    autoDay: localISODate(),
  };
}
