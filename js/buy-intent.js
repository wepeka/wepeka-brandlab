// What a "buy" button asked for before its visitor was signed in. A Founder
// or plan button on the front page (or on www.wepeka.com/brandlab) sends a
// signed-out visitor through wepeka.com to sign in or register; the plan
// rides along (`plan=` on /brandlab/connect, then on the #/sso hand-off,
// js/main.js consumeWepekaToken) and is kept here until the plans page is
// on screen with someone signed in, which opens that plan's checkout
// straight away (js/views/pricing.js) instead of asking for the same click
// twice. One tab, one use, and only for a while: a stale wish never opens a
// payment out of nowhere. Nothing here can buy anything — the server still
// decides what the plan costs and whether this account may have it.
const KEY = "brandlab:buy-intent";
export const BUY_INTENT_FRESH_MS = 30 * 60 * 1000;

// Plan keys as api/_plans.js PLANS names them.
export const isBuyablePlanKey = (key) => /^(founder|founder-ultimate|(starter|pro|studio)-(monthly|yearly))$/.test(String(key ?? ""));

const store = () => {
  try { return globalThis.sessionStorage || null; } catch { return null; }
};

export function rememberBuyIntent(planKey, now = Date.now()) {
  if (!isBuyablePlanKey(planKey)) return false;
  try { store()?.setItem(KEY, JSON.stringify({ planKey, at: now })); } catch { /* storage off: the plans page still opens, one click more */ }
  return true;
}

// The remembered plan, once: reading it forgets it.
export function takeBuyIntent(now = Date.now()) {
  let raw = null;
  try {
    raw = store()?.getItem(KEY) || null;
    if (raw) store().removeItem(KEY);
  } catch { return null; }
  if (!raw) return null;
  try {
    const { planKey, at } = JSON.parse(raw);
    return isBuyablePlanKey(planKey) && now - Number(at) >= 0 && now - Number(at) < BUY_INTENT_FRESH_MS ? planKey : null;
  } catch { return null; }
}
