// Instagram Graph API client — read-only. Pulls insights for a post you've
// already published (via Instagram itself), using a long-lived access token
// you generate once in Meta's developer tools and paste into Settings.
//
// This can only ever be "fetch data for a post that already exists" — the
// Graph API does not accept direct file uploads from a browser, so posting
// content from this app isn't something this integration can do.
//
// Tokens from the newer "Instagram API with Instagram Login" setup start
// with "IGAA" and only work against graph.instagram.com — NOT
// graph.facebook.com (that's only for classic "EAA"-prefixed Facebook
// tokens tied to a linked Page). This client targets the IGAA/Instagram
// Login style, since that's the simpler, current onboarding path.
const API_BASE = "https://graph.instagram.com";

class InstagramApiError extends Error {}

async function graphGet(path, params, accessToken) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", accessToken);
  // Rule out the browser serving a stale cached response as a source of
  // "why isn't this current" — every fetch always hits Instagram directly.
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new InstagramApiError(json.error?.message || `Instagram API request failed (${res.status}).`);
  }
  return json;
}

export async function testConnection({ igUserId, accessToken }) {
  const json = await graphGet(`/${igUserId}`, { fields: "username" }, accessToken);
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
export async function listRecentMedia({ igUserId, accessToken }, { maxItems = 100 } = {}) {
  const results = [];
  let after;
  while (results.length < maxItems) {
    const json = await graphGet(
      `/${igUserId}/media`,
      { fields: "id,permalink,caption,timestamp,media_type,media_product_type,media_url,thumbnail_url", limit: 50, ...(after ? { after } : {}) },
      accessToken
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
  return `Instagram post — ${new Date(media.timestamp).toLocaleDateString()}`;
}

export async function findMediaByPermalink({ igUserId, accessToken }, publishedUrl) {
  const targetCode = shortcodeFromUrl(publishedUrl);
  if (!targetCode) {
    throw new InstagramApiError("That doesn't look like an Instagram post URL (expected a /p/, /reel/, or /tv/ link).");
  }

  let after;
  for (let page = 0; page < 4; page++) {
    const json = await graphGet(
      `/${igUserId}/media`,
      { fields: "id,permalink,timestamp,media_type,media_product_type", limit: 50, ...(after ? { after } : {}) },
      accessToken
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
];
const PROFILE_METRICS = [
  { key: "profileVisits", names: ["profile_visits", "profile_activity"] },
  { key: "followersGained", names: ["follows"] },
];
// Views: first name that returns a value wins (these are alternate names
// for the same thing across API versions, not additive). Confirmed via a
// real account's console log that Instagram has no separate metric name
// for "Facebook crosspost views" — "facebook_views" and "crossposted_views"
// both come back as a flat 400 error, so the combined figure the Instagram
// app shows for crossposted content simply isn't exposed by this API. If
// you need that exact number, type it in manually on that post.
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
async function fetchOneMetric(mediaId, metricName, accessToken) {
  try {
    const insights = await graphGet(`/${mediaId}/insights`, { metric: metricName }, accessToken);
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
export async function fetchMediaMetrics({ accessToken }, media) {
  const metrics = {};
  const warnings = [];

  try {
    const basic = await graphGet(`/${media.id}`, { fields: "like_count,comments_count" }, accessToken);
    if (basic.like_count !== undefined) metrics.likes = basic.like_count;
    if (basic.comments_count !== undefined) metrics.comments = basic.comments_count;
  } catch (e) {
    warnings.push(`Couldn't read like/comment counts: ${e.message}`);
  }

  const productType = media.media_product_type || media.media_type || "IMAGE";
  const wantedMetrics = INSIGHT_METRICS[productType] || INSIGHT_METRICS.IMAGE;

  // One metric per request — Graph API rejects the WHOLE call if any single
  // metric name in a combined request isn't supported for this media/account
  // (this varies by API version), which was silently wiping out every other
  // number too. Fetching independently means one bad metric name only costs
  // that one number, not all of them.
  for (const { key, names } of wantedMetrics) {
    let lastError = null;
    let found = false;
    for (const metricName of names) {
      const { value, error } = await fetchOneMetric(media.id, metricName, accessToken);
      if (error) { lastError = error; continue; }
      if (value === null) continue;
      metrics[key] = value;
      found = true;
      break;
    }
    if (!found && lastError) warnings.push(`${key}: ${lastError.message}`);
  }

  {
    const viewNames = VIEWS_METRICS[productType] || VIEWS_METRICS.IMAGE;
    let lastError = null;
    let found = false;
    for (const metricName of viewNames) {
      const { value, error } = await fetchOneMetric(media.id, metricName, accessToken);
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
    const labels = stillMissing.map((k) => (k === "profileVisits" ? "Profile Visits" : "Followers Gained"));
    warnings.push(`${labels.join(" and ")} weren't returned for this post — Instagram may only track ${labels.length > 1 ? "these" : "it"} at the account level for this media type. Fill in manually if you have the numbers.`);
  }

  return { metrics, warnings };
}

// Current snapshot (not date-ranged) — followers/media count right now.
export async function getAccountProfile({ igUserId, accessToken }) {
  return graphGet(`/${igUserId}`, { fields: "username,followers_count,media_count" }, accessToken);
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
export async function getAccountInsights({ igUserId, accessToken }, { since, until }) {
  const sinceTs = Math.floor(new Date(since).getTime() / 1000);
  const untilTs = Math.floor(new Date(until).getTime() / 1000);
  const metrics = {};
  const warnings = [];

  for (const { key, names } of ACCOUNT_METRICS) {
    let found = false;
    let lastError = null;
    for (const metricName of names) {
      try {
        const json = await graphGet(`/${igUserId}/insights`, { metric: metricName, period: "day", since: sinceTs, until: untilTs }, accessToken);
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
