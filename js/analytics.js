// Google Analytics 4 for the Brandlab app (planner.wepeka.com).
//
// Same measurement ID as www.wepeka.com (wpk-dp NEXT_PUBLIC_GA_ID): both
// hosts sit under wepeka.com, so gtag's automatic cookie domain shares one
// _ga cookie and a visitor who reads /brandlab, signs up on wepeka.com and
// pays here stays ONE user in ONE funnel. Measurement IDs are public by
// design (they ship in every page's HTML) — this is not a secret.
//
// Empty GA_ID = analytics off: every export below becomes a no-op, so dev
// (serve.py on localhost) never pollutes production data.
const GA_ID = "";

// The app is hash-routed and the Wepeka sign-in hand-off carries a Firebase
// token in the fragment (#/sso?t=…). Page views are therefore sent by hand
// with a sanitised path — the route name only, never the fragment, a query
// or an id — instead of letting gtag read location.href.
const isOn = () => !!GA_ID && /(^|\.)wepeka\.com$/.test(location.hostname);

let loaded = false;
function load() {
  if (loaded || !isOn()) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { send_page_view: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

// "#/brand/abc123/content?x=1" → "/app/brand/content". Ids (anything with a
// digit and 8+ chars) and query strings are dropped so no uid/brand id or
// token ever reaches GA.
export function routePath(hash) {
  const route = String(hash || "").replace(/^#\/?/, "").split("?")[0];
  const parts = route.split("/").filter((p) => p && /^[a-z-]+$/i.test(p) && !(p.length >= 8 && /\d/.test(p)));
  return "/app" + (parts.length ? "/" + parts.join("/") : "");
}

export function gaEvent(name, params = {}) {
  if (!isOn()) return;
  load();
  try { window.gtag("event", name, params); } catch { /* analytics must never break the app */ }
}

let lastPath = null;
export function trackPageView() {
  if (!isOn() || location.hash.startsWith("#/sso")) return;
  const path = routePath(location.hash);
  if (path === lastPath) return;
  lastPath = path;
  gaEvent("page_view", {
    page_location: `${location.origin}${path}`,
    page_path: path,
    page_title: document.title,
  });
}

// Signed-in user id (Firebase uid) so GA can join sessions across devices.
// A uid is an opaque pseudonymous id, allowed by GA's user-id policy (no
// email/name is ever sent).
export function setUser(uid) {
  if (!isOn()) return;
  load();
  try { window.gtag("set", { user_id: uid || null }); } catch { /* ignore */ }
}

export function initAnalytics() {
  if (!isOn()) return;
  load();
  trackPageView();
  window.addEventListener("hashchange", trackPageView);
}
