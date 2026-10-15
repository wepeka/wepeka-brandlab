// A Wepeka Community code (the extra discount whose code sits in the
// community's WhatsApp group description), kept in this browser between
// the moment it is typed and the payment it is for: typed on the Founder's
// Deal page (founder/) or the plans page, or carried back through sign-in
// on the hand-off (#/sso?…&promo=, js/main.js). localStorage, not session:
// signing up can mean leaving for the email app and coming back in another
// tab. Only the code is kept — whether it is real and what it takes off is
// the server's call (api/_promo.js; create-transaction prices every
// checkout), so a tampered value can only fail to apply.
const KEY = "brandlab:promo";
export const PROMO_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

// Same rule as api/_promo.js normalizePromo.
export const normalizePromo = (raw) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);

const store = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};

// `off`: what the server said the code takes off Founder Lifetime
// (/api/offer?code=), for the "code applied" line only; unknown = 0.
export function rememberPromo(raw, now = Date.now(), off = 0) {
  const code = normalizePromo(raw);
  if (code.length < 3) return null;
  const save = Math.max(0, Math.round(Number(off) || 0));
  try { store()?.setItem(KEY, JSON.stringify({ code, at: now, ...(save ? { off: save } : {}) })); } catch { /* storage off: the code is typed again on the plans page */ }
  return code;
}

// The kept { code, off }, or null (none, or older than PROMO_FRESH_MS).
export function readPromoInfo(now = Date.now()) {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const { code, at, off } = JSON.parse(raw);
    const fresh = now - Number(at) >= 0 && now - Number(at) < PROMO_FRESH_MS;
    return fresh && code && normalizePromo(code) === code ? { code, off: Math.max(0, Math.round(Number(off) || 0)) } : null;
  } catch { return null; }
}
export const readPromo = (now = Date.now()) => readPromoInfo(now)?.code || null;

// Is this code real, and what does it take off? (api/offer.js) →
// { ok, code, off: { founder, "founder-ultimate" } }; throws when offline.
export async function checkPromo(raw, fetchImpl = globalThis.fetch) {
  const code = normalizePromo(raw);
  if (code.length < 3) return { ok: false, code };
  const res = await fetchImpl(`/api/offer?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(`offer ${res.status}`);
  const body = await res.json();
  return body?.promo?.ok ? { ok: true, code, off: body.promo.off || {} } : { ok: false, code };
}

export function forgetPromo() {
  try { store()?.removeItem(KEY); } catch { /* nothing kept */ }
}
