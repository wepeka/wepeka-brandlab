// Instagram Graph API client — read-only. Pulls insights for a post you've
// already published, for the import picker, the Antrean feed, the
// followers button and the per-post fetch.
//
// Two kinds of connection reach it (owner, 2026-11-24: "Hubungkan akun
// Meta"): the brand connected through Facebook Login for Business or
// Instagram Login — the token stays on the server, so every read goes
// through /api/instagram/graph (read-only, this brand's account only) —
// and the older token Wepeka's account pasted into the brand form, still
// read straight from graph.instagram.com until that brand is connected the
// new way. igRef(brand) says which; every helper below takes what it returns.
import { t, getLang } from "./i18n.js";
import { auth } from "./firebase.js";

const API_BASE = "https://graph.instagram.com";

class InstagramApiError extends Error {
  constructor(message, code = "") {
    super(message);
    this.code = code;
  }
}

// { brandId, igUserId, username, accessToken? } for a brand whose Instagram
// this app can read, else null. `accessToken` only for the pasted kind.
export function igRef(brand) {
  const ig = brand?.instagram;
  if (!ig?.igUserId) return null;
  if (ig.connected === true) return { brandId: brand.id, igUserId: ig.igUserId, username: ig.username || "" };
  if (ig.accessToken) return { brandId: brand.id, igUserId: ig.igUserId, username: ig.username || "", accessToken: ig.accessToken };
  return null;
}
// Connected through "Hubungkan akun Meta" (the server holds the token).
export const igViaVault = (brand) => brand?.instagram?.connected === true && !!brand.instagram.igUserId;

async function viaServer(ref, path, params) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new InstagramApiError(t("integr.ig.apiFailed", { status: 401 }), "auth");
  const res = await fetch("/api/instagram/graph", {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ brandId: ref.brandId, path, params: Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, typeof v === "number" ? v : String(v)])) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const code = typeof json.error === "string" ? json.error : "";
    throw new InstagramApiError(code === "reconnect" ? t("meta.err.reconnect") : json.message || json.error?.message || t("integr.ig.apiFailed", { status: res.status }), code);
  }
  return json;
}

// `ref`: igRef(brand), or (older callers) a bare pasted token.
async function graphGet(path, params, ref) {
  if (ref && typeof ref === "object" && !ref.accessToken) return viaServer(ref, path, params);
  const accessToken = typeof ref === "string" ? ref : ref?.accessToken;
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", accessToken);
  // Rule out the browser serving a stale cached response as a source of
  // "why isn't this current" — every fetch always hits Instagram directly.
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new InstagramApiError(json.error?.message || t("integr.ig.apiFailed", { status: res.status }));
  }
  return json;
}

export async function testConnection(ig) {
  const json = await graphGet(`/${ig.igUserId}`, { fields: "username" }, ig);
  return json.username;
}

// Instagram permalinks can carry tracking query params or a trailing slash —
// compare by the shortcode segment (/p/, /reel/, /tv/) instead of exact string.
export function shortcodeFromUrl(url) {
  const m = (url || "").match(/\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Pulls the account's recent posts (paginated), for the "Import" flow that
// discovers everything already published on Instagram instead of requiring
// one manually-created Content entry per post first.
export async function listRecentMedia(ig, { maxItems = 100 } = {}) {
  const { igUserId } = ig;
  const results = [];
  let after;
  while (results.length < maxItems) {
    const json = await graphGet(
      `/${igUserId}/media`,
      { fields: "id,permalink,caption,timestamp,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count", limit: 50, ...(after ? { after } : {}) },
      ig
    );
    results.push(...(json.data || []));
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return results.slice(0, maxItems);
}

// Videos/Reels expose a poster frame via thumbnail_url; images/carousels
// use media_url directly as their own thumbnail.
export function thumbnailFromMedia(media) {
  return media.thumbnail_url || media.media_url || "";
}

export function formatFromMedia(media) {
  const pt = media.media_product_type || media.media_type;
  if (pt === "REELS") return "Reels";
  if (pt === "CAROUSEL_ALBUM") return "Carousel";
  if (pt === "VIDEO") return "Short Video";
  return "Static Post";
}

export function titleFromMedia(media) {
  const caption = (media.caption || "").trim();
  if (caption) {
    const firstLine = caption.split("\n")[0];
    return firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine;
  }
  return t("integr.ig.postTitle", { date: new Date(media.timestamp).toLocaleDateString(getLang() === "en" ? "en-US" : "id-ID") });
}

export async function findMediaByPermalink(ig, publishedUrl) {
  const { igUserId } = ig;
  const targetCode = shortcodeFromUrl(publishedUrl);
  if (!targetCode) {
    throw new InstagramApiError(t("integr.ig.badUrl"));
  }

  let after;
  for (let page = 0; page < 4; page++) {
    const json = await graphGet(
      `/${igUserId}/media`,
      { fields: "id,permalink,timestamp,media_type,media_product_type", limit: 50, ...(after ? { after } : {}) },
      ig
    );
    const match = (json.data || []).find((m) => shortcodeFromUrl(m.permalink) === targetCode);
    if (match) return match;
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after) break;
  }
  return null;
}

// Each entry lists candidate metric names to try in order for that field —
// Meta has renamed metrics across API versions more than once ("plays" vs.
// "video_views" vs. plain "views"), and which one an account/version accepts
// isn't knowable up front, so the first one that actually returns a value
// wins.
//
// "follows"/"profile_visits"/"profile_activity" are confirmed (via a real
// account's console log, not guesswork) to be flatly rejected by the Media
// Insights API for VIDEO/REELS — Instagram's own error message is explicit:
// "The Media Insights API does not support the profile_visits metric for
// this media product type." So those aren't attempted there anymore (no
// point in a request guaranteed to fail). They're still attempted for
// IMAGE/CAROUSEL_ALBUM, since that hasn't been disproven — Instagram's
// per-type support for these two is inconsistent enough that it's worth
// trying rather than assuming.
const COMMON_METRICS = [
  { key: "reach", names: ["reach"] },
  { key: "saves", names: ["saved"] },
  { key: "shares", names: ["shares"] },
  // Newer than the others: an API version or account without it just
  // leaves the box for the owner, no warning (quiet).
  { key: "reposts", names: ["reposts"], quiet: true },
];
const PROFILE_METRICS = [
  { key: "profileVisits", names: ["profile_visits", "profile_activity"] },
  { key: "followersGained", names: ["follows"] },
];
// Views: first name that returns a value wins (these are alternate names
// for the same thing across API versions, not additive). "facebook_views"
// and "crossposted_views" are accepted (no error) via graph.facebook.com
// with a Page access token — this file's graph.instagram.com/IGAA-token
// client flatly rejects both with a 400 — but confirmed against a real
// account that even the working endpoint doesn't return the true number
// (came back 0 for a Reel Instagram's own app reported 405 Facebook views
// on). See facebook.js's fetchCrosspostViews for the full story; it's not
// wired up anywhere right now. content-editor.js asks the user to read the
// Facebook views number off Instagram's own app and enter it manually.
const VIEWS_METRICS = {
  IMAGE: ["views", "impressions"],
  CAROUSEL_ALBUM: ["views", "impressions"],
  VIDEO: ["views", "plays", "video_views"],
  REELS: ["views", "plays", "video_views"],
};
const INSIGHT_METRICS = {
  IMAGE: [...COMMON_METRICS, ...PROFILE_METRICS],
  CAROUSEL_ALBUM: [...COMMON_METRICS, ...PROFILE_METRICS],
  VIDEO: [...COMMON_METRICS],
  REELS: [...COMMON_METRICS],
};

// One named metric, or null if Instagram doesn't return a value for it.
// Logs the raw response either way — this is what made the "views"/"follows"
// mysteries diagnosable from a real account instead of guesswork.
async function fetchOneMetric(mediaId, metricName, ig) {
  try {
    const insights = await graphGet(`/${mediaId}/insights`, { metric: metricName }, ig);
    // eslint-disable-next-line no-console
    console.log(`[Instagram] metric=${metricName} →`, JSON.stringify(insights));
    const val = insights.data?.[0]?.values?.[0]?.value;
    return val === undefined ? { value: null, error: null } : { value: val, error: null };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`[Instagram] metric=${metricName} → ERROR:`, e.message);
    return { value: null, error: e };
  }
}

// Returns { metrics: {ourKey: value, ...}, warnings: [string, ...] }
// Partial success is normal — whatever Instagram won't give us just gets
// left for the user to fill in manually, same as the OCR flow.
export async function fetchMediaMetrics(ig, media) {
  const metrics = {};
  const warnings = [];

  try {
    const basic = await graphGet(`/${media.id}`, { fields: "like_count,comments_count" }, ig);
    if (basic.like_count !== undefined) metrics.likes = basic.like_count;
    if (basic.comments_count !== undefined) metrics.comments = basic.comments_count;
  } catch (e) {
    warnings.push(t("integr.ig.countsFailed", { msg: e.message }));
  }

  const productType = media.media_product_type || media.media_type || "IMAGE";
  const wantedMetrics = INSIGHT_METRICS[productType] || INSIGHT_METRICS.IMAGE;

  // One metric per request — Graph API rejects the WHOLE call if any single
  // metric name in a combined request isn't supported for this media/account
  // (this varies by API version), which was silently wiping out every other
  // number too. Fetching independently means one bad metric name only costs
  // that one number, not all of them.
  for (const { key, names, quiet } of wantedMetrics) {
    let lastError = null;
    let found = false;
    for (const metricName of names) {
      const { value, error } = await fetchOneMetric(media.id, metricName, ig);
      if (error) { lastError = error; continue; }
      if (value === null) continue;
      metrics[key] = value;
      found = true;
      break;
    }
    if (!found && lastError && !quiet) warnings.push(`${key}: ${lastError.message}`);
  }

  {
    const viewNames = VIEWS_METRICS[productType] || VIEWS_METRICS.IMAGE;
    let lastError = null;
    let found = false;
    for (const metricName of viewNames) {
      const { value, error } = await fetchOneMetric(media.id, metricName, ig);
      if (error) { lastError = error; continue; }
      if (value === null) continue;
      metrics.views = value;
      found = true;
      break;
    }
    if (!found && lastError) warnings.push(`views: ${lastError.message}`);
  }

  const stillMissing = ["profileVisits", "followersGained"].filter((k) => metrics[k] === undefined);
  if (stillMissing.length) {
    const labels = stillMissing.map((k) => (k === "profileVisits" ? t("integr.ig.profileVisits") : t("integr.ig.followersGained")));
    warnings.push(t(labels.length > 1 ? "integr.ig.missingMany" : "integr.ig.missingOne", { labels: labels.join(` ${t("integr.and")} `) }));
  }

  return { metrics, warnings };
}

// Current snapshot (not date-ranged) — followers/media count right now.
export async function getAccountProfile(ig) {
  return graphGet(`/${ig.igUserId}`, { fields: "username,followers_count,media_count" }, ig);
}

// Same "try each candidate name, one at a time" defensiveness as media
// insights — Meta has reshuffled which account-level metrics are valid
// together more than once.
const ACCOUNT_METRICS = [
  { key: "reach", names: ["reach"] },
  { key: "profileViews", names: ["profile_views"] },
  { key: "accountsEngaged", names: ["accounts_engaged"] },
  { key: "totalInteractions", names: ["total_interactions"] },
  { key: "followerGrowth", names: ["follower_count"] }, // net new followers per day, summed over the range
];

// since/until: Date objects or anything `new Date()` accepts. Sums each
// metric's daily values across the range into one number for that period.
export async function getAccountInsights(ig, { since, until }) {
  const { igUserId } = ig;
  const sinceTs = Math.floor(new Date(since).getTime() / 1000);
  const untilTs = Math.floor(new Date(until).getTime() / 1000);
  const metrics = {};
  const warnings = [];

  for (const { key, names } of ACCOUNT_METRICS) {
    let found = false;
    let lastError = null;
    for (const metricName of names) {
      try {
        const json = await graphGet(`/${igUserId}/insights`, { metric: metricName, period: "day", since: sinceTs, until: untilTs }, ig);
        const rows = json.data?.[0]?.values || [];
        metrics[key] = rows.reduce((sum, r) => sum + (typeof r.value === "number" ? r.value : 0), 0);
        found = true;
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!found && lastError) warnings.push(`${key}: ${lastError.message}`);
  }

  return { metrics, warnings };
}

export { InstagramApiError };
