// Meta Pixel (browser) for the Brandlab app (brandlab.wepeka.com).
//
// Paired with the Conversions API in api/_meta.js: a purchase is sent from
// here (Snap onSuccess) AND from the Midtrans webhook with the same event id
// (the order id), so Meta counts it once and still gets it when the browser
// one is blocked. Use the SAME pixel as www.wepeka.com (wpk-dp
// NEXT_PUBLIC_META_PIXEL_ID) and as META_PIXEL_ID in Vercel env for /api —
// one pixel = one funnel from ad click to payment. Pixel IDs are public.
//
// Empty = off (every export is a no-op), and only ever on *.wepeka.com so
// dev on localhost never pollutes ad data.
const META_PIXEL_ID = "";

const isOn = () => !!META_PIXEL_ID && /(^|\.)wepeka\.com$/.test(location.hostname);
// The Wepeka hand-off carries a sign-in token in the fragment (#/sso?t=…)
// and the pixel reports the full page URL — never fire while it's there.
const tokenInUrl = () => location.hash.startsWith("#/sso");

let loaded = false;
function load() {
  if (loaded || !isOn()) return;
  loaded = true;
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */
  window.fbq("init", META_PIXEL_ID);
}

export function metaTrack(name, params = {}, eventId) {
  if (!isOn() || tokenInUrl()) return;
  load();
  try {
    if (eventId) window.fbq("track", name, params, { eventID: eventId });
    else window.fbq("track", name, params);
  } catch { /* tracking must never break the app */ }
}

// Meta matches a browser event to the server's copy with the same event id
// only when the two arrive within 48 hours of each other. A browser twin
// sent later than that would count as a second conversion, so callers that
// may report late (js/trial-start.js, js/pending-orders.js) ask here first
// and leave a late one to the server's event alone. `serverEventAt`: when
// the server sent its copy, or any earlier moment (then this errs towards
// not sending); unknown counts as "just now".
export const META_DEDUP_MS = 48 * 60 * 60 * 1000;
export function withinMetaDedup(serverEventAt, now = Date.now()) {
  return !(Number.isFinite(serverEventAt) && Math.abs(now - serverEventAt) > META_DEDUP_MS);
}

let lastHash = null;
function pageView() {
  if (!isOn() || tokenInUrl() || location.hash === lastHash) return;
  lastHash = location.hash;
  metaTrack("PageView");
}

export function initMetaPixel() {
  if (!isOn()) return;
  pageView();
  window.addEventListener("hashchange", pageView);
}
