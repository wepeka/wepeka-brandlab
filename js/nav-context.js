// Cross-feature navigation that carries context. Routes stay plain hashes
// (js/main.js parses no query strings); the context rides in a single
// sessionStorage slot the destination consumes on mount — the same
// mechanism the guided tours already use for their pending-tour key.
//
//   go("#/brand/x/content/creator", { fromLabel: "Campaign Kopi Senja",
//       campaignId, stageId, contentId, intent: "publish" })
//
// While the slot is alive, layout.js shows a "← Kembali ke {fromLabel}"
// chip; it clears when clicked, when the user navigates somewhere that is
// neither the destination nor the origin, or after TTL.
const KEY = "contentos:nav-ctx";
const TTL_MS = 10 * 60 * 1000;

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || Date.now() - (ctx.at || 0) > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}
function write(ctx) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* private mode: navigation still works, just without the context */
  }
}

export function go(hash, ctx = {}) {
  write({ ...ctx, from: ctx.from || location.hash, to: hash, at: Date.now(), consumed: false });
  if (location.hash === hash) {
    // Same route: no hashchange fires, so tell the mounted view directly.
    document.dispatchEvent(new CustomEvent("nav:context"));
  } else {
    location.hash = hash;
  }
}

export function peekNavContext() {
  return read();
}

// The destination reads its context once; the return chip keeps working
// afterwards because only `consumed` flips, not the slot.
export function consumeNavContext() {
  const ctx = read();
  if (!ctx || ctx.consumed) return null;
  write({ ...ctx, consumed: true });
  return ctx;
}

export function clearNavContext() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Called by main.js on every route render: a third location ends the trip.
export function noteNavigation(hash) {
  const ctx = read();
  if (!ctx) return;
  if (hash !== ctx.to && hash !== ctx.from) clearNavContext();
}

export function returnTo() {
  const ctx = read();
  if (!ctx?.from || location.hash === ctx.from) return null;
  return { hash: ctx.from, label: ctx.fromLabel || "" };
}
