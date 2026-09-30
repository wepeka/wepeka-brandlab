// Meta Pixel (browser) for the Brandlab app (planner.wepeka.com).
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
