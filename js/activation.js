// Activation steps → GA4: how far an account gets after signing up, so the
// owner can see where trial accounts stop (Brand DNA, Warna & Font, a goal,
// a week plan, a first post, numbers filled in) and how long it takes.
//
//   dna_done          Brand DNA saved complete for the first time (brand-dna.js)
//   identity_done     Brand DNA + Warna & Font both done (once per brand)
//   goal_created      any campaign/goal created (store.js createCampaign)
//   week_plan_saved   Rencanakan minggu ini put into the calendar (chat)
//   content_published a piece turned "published" (store.js updateContent)
//   numbers_logged    content numbers, followers, sales or a manual metric
//                     typed in (store.js / sales-tracker.js) — once per
//                     brand + kind per day, it's about "does this person
//                     fill numbers in", not how many times they press Save
//
// The data layer never talks to analytics: store.js only dispatches
// `app:step` (emitStep) and this module, started from main.js, forwards it.
// Every event carries the mode (pemula/pro) and the plan, never a brand
// name, an id or anything typed. Wepeka's own admin account sends nothing.
import { gaEvent } from "./analytics.js";
import { getMode } from "./mode.js";
import { getCachedAccount, isAdmin, currentUid } from "./account.js";
import { getBrand } from "./store.js";
import { identityDone } from "./brand-progress.js";

const ONCE_KEY = "brandlab:activation-once";

function onceSeen(key) {
  try {
    const seen = JSON.parse(localStorage.getItem(ONCE_KEY) || "{}");
    if (seen[key]) return true;
    seen[key] = Date.now();
    // Old keys out, so the list never grows without end.
    const keep = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 300);
    localStorage.setItem(ONCE_KEY, JSON.stringify(Object.fromEntries(keep)));
    return false;
  } catch {
    return false;
  }
}

// The params every step carries. Exported for the tests.
export function stepParams(extra = {}) {
  const plan = getCachedAccount()?.plan || "unknown";
  return { mode: getMode() === "advanced" ? "pro" : "pemula", plan, ...extra };
}

// `once`: a key that makes the step fire one time only on this device
// (e.g. the brand id for identity_done).
export function trackStep(step, params = {}, { once = "" } = {}) {
  try {
    if (isAdmin(currentUid())) return;
    if (once && onceSeen(`${step}:${once}`)) return;
    gaEvent(step, stepParams(params));
  } catch { /* analytics must never break the app */ }
}

// identity_done, from whichever save finishes the second half (Brand DNA
// or Warna & Font) — one event per brand.
export function trackIdentityIfDone(brandId) {
  const brand = getBrand(brandId);
  if (brand && identityDone(brand)) trackStep("identity_done", {}, { once: brandId });
}

const today = () => new Date().toISOString().slice(0, 10);

let started = false;
export function initActivation() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("app:step", (e) => {
    const { step, brandId = "", kind = "", objective = "", track = "" } = e.detail || {};
    if (step === "numbers_logged") trackStep(step, { kind }, { once: `${brandId}:${kind}:${today()}` });
    else if (step === "goal_created") trackStep(step, { objective: objective || "none", track: track || "none" });
    else if (step === "content_published") trackStep(step);
  });
}
