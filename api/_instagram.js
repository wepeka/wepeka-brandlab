// Instagram, the server half: Instagram Login (the path for an Instagram
// professional account without a Page) and everything the sync does with
// an account however it was connected. Ported from feature/instagram-
// auto-sync (1e9f5da + c3db5b2); the vault itself is api/_metaVault.js.
//
// Every Graph call takes an `api` = { fetch, base, token }: base is
// graph.instagram.com for an Instagram Login token, graph.facebook.com for
// a Facebook Login for Business one (the same paths and metric names on
// both hosts: /{ig-user-id}/media, /{media-id}/insights …).
//
// Only Business/Creator accounts can connect — Meta shut the personal-
// account API on 2024-12-04. Insights can lag up to 48 h, so a daily pass
// is as fresh as the data gets.
import { graphGet, GraphError, IG_GRAPH } from "./_metaVault.js";

export const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
export const OAUTH_TOKEN = "https://api.instagram.com/oauth/access_token";
// Token exchange and refresh live on the host's unversioned root.
export const IG_ROOT = "https://graph.instagram.com";
// The three Instagram Login permissions in the App Review list (owner,
// 2026-11-24): profile + posts, their numbers, and posting from Brandlab.
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"];

const DAY = 24 * 60 * 60 * 1000;
// A long-lived token lasts 60 days and can be refreshed once it is a day
// old. The daily cron refreshes anything with under 20 days left, so one
// missed week of cron runs still can't let a token die.
export const REFRESH_WHEN_LEFT_MS = 20 * DAY;
// One snapshot a week in insightsHistory: it is capped (store.js
// INSIGHTS_HISTORY_CAP = 60) and campaigns read their follower baseline
// from it, so a daily entry would push a campaign's start out within two months.
export const HISTORY_EVERY_MS = 6.5 * DAY;
// The app's "Sinkron sekarang" can't hammer Meta.
export const MANUAL_SYNC_GAP_MS = 5 * 60 * 1000;

// Same list and order as js/store.js METRIC_KEYS (tests/instagram.test.mjs
// checks they agree).
export const METRIC_KEYS = ["views", "reach", "likes", "comments", "shares", "saves", "reposts", "profileVisits", "followersGained"];

const get = (api, path, params) => graphGet(api.fetch, api.base, path, params, api.token);

// ---------- Instagram Login ----------
export function authorizeUrl({ appId, redirectUri, state }) {
  const u = new URL(OAUTH_AUTHORIZE);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  // Straight to the Instagram login, not "continue with Facebook" — that
  // is the other button, Facebook Login for Business.
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_reauth", "true");
  return u.toString();
}
// Instagram appends "#_" to the code in the redirect.
export const cleanCode = (code) => String(code || "").replace(/#_$/, "");

// code → short-lived token → 60-day token → the account behind it.
export async function exchangeCode(fetchImpl, { appId, appSecret, redirectUri, code }) {
  const form = new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: cleanCode(code) });
  const res = await fetchImpl(OAUTH_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const json = await res.json().catch(() => ({}));
  const first = Array.isArray(json.data) ? json.data[0] : json;
  if (!res.ok || !first?.access_token) {
    throw new GraphError(json.error_message || json.error?.message || `token exchange ${res.status}`, { status: 400 });
  }
  const long = await graphGet(fetchImpl, IG_ROOT, "/access_token", { grant_type: "ig_exchange_token", client_secret: appSecret }, first.access_token);
  const me = await graphGet(fetchImpl, IG_GRAPH, "/me", { fields: "user_id,username,account_type" }, long.access_token);
  const permissions = typeof first.permissions === "string" ? first.permissions.split(",") : Array.isArray(first.permissions) ? first.permissions : [];
  return {
    token: long.access_token,
    expiresIn: Number(long.expires_in) || 60 * 24 * 3600,
    // /me's user_id is the professional account id that /media and
    // /insights take; `id` is the app-scoped one Meta's deauthorize and
    // data-deletion callbacks name. Both are kept to match either.
    igUserId: String(me.user_id || me.id || first.user_id || ""),
    appUserId: String(me.id || first.user_id || ""),
    username: me.username || "",
    accountType: me.account_type || "",
    permissions: permissions.map((p) => p.trim()).filter(Boolean),
  };
}

export async function refreshLongLivedToken(fetchImpl, token) {
  const json = await graphGet(fetchImpl, IG_ROOT, "/refresh_access_token", { grant_type: "ig_refresh_token" }, token);
  return { token: json.access_token, expiresIn: Number(json.expires_in) || 60 * 24 * 3600 };
}

export function needsRefresh(grant, now) {
  return !!grant?.tokenExpiresAt && grant.tokenExpiresAt - now < REFRESH_WHEN_LEFT_MS && now - (grant.tokenIssuedAt || 0) > DAY;
}

// What the app's own read-only helpers (js/instagram.js) may ask the proxy
// for: this account, its media list and insights, and a single media
// object or its insights/children. GET only; never a write.
const PARAM_KEYS = new Set(["fields", "metric", "period", "since", "until", "limit", "after", "before", "metric_type", "breakdown", "timeframe"]);
export function proxyRequestOk(path, params, igUserId) {
  const p = String(path || "");
  const own = `/${igUserId}`;
  const ok = p === own || p === `${own}/media` || p === `${own}/insights`
    || /^\/\d{5,30}(\/(insights|children))?$/.test(p);
  if (!ok || !igUserId) return false;
  return Object.keys(params || {}).every((k) => PARAM_KEYS.has(k)) && Object.values(params || {}).every((v) => ["string", "number"].includes(typeof v) && String(v).length <= 500);
}

// ---------- media → Brandlab content ----------
export function shortcodeFromUrl(url) {
  const m = String(url || "").match(/\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
export function formatFromMedia(media) {
  const pt = media.media_product_type || media.media_type;
  if (pt === "REELS") return "Reels";
  if (pt === "CAROUSEL_ALBUM" || media.media_type === "CAROUSEL_ALBUM") return "Carousel";
  if (pt === "VIDEO" || media.media_type === "VIDEO") return "Short Video";
  return "Static Post";
}
const normalizeCaption = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// Same date the app shows (js/store.js localISODate), in Indonesia's time.
export function jakartaDate(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
// "2026-10" for a moment, read on the Jakarta calendar (a post at 00:30 WIB
// on the 1st is already the new month, though UTC still says the last day).
export const jakartaMonth = (ms) => jakartaDate(ms).slice(0, 7);
export const inCurrentJakartaMonth = (ms, now) => Number.isFinite(ms) && ms > 0 && jakartaMonth(ms) === jakartaMonth(now);
export function titleFromMedia(media) {
  const caption = String(media.caption || "").trim();
  if (caption) {
    const firstLine = caption.split("\n")[0];
    return firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine;
  }
  return `Postingan Instagram — ${jakartaDate(Date.parse(media.timestamp) || Date.now())}`;
}
// Our own photo (a data URL or a brand asset) is never replaced; an empty
// one or an Instagram CDN link (those expire) gets the fresh link.
export const thumbnailReplaceable = (thumb) => !thumb || /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//.test(thumb);

// Insight names per kind of post. The Graph API rejects a whole request
// when one name isn't valid for that media, so the sync asks for the set
// in one call and falls back to one name per call on an error.
// Reels have no "follows" or "profile_visits" (Meta says so for that
// product type).
const COMMON = ["views", "reach", "saved", "shares"];
export const INSIGHTS_FOR = {
  REELS: [...COMMON, "reposts"],
  FEED: [...COMMON, "reposts", "follows", "profile_visits"],
};
const OUR_KEY = { views: "views", reach: "reach", saved: "saves", shares: "shares", reposts: "reposts", follows: "followersGained", profile_visits: "profileVisits" };
export function insightNamesFor(media) {
  if (media.media_product_type === "REELS") return INSIGHTS_FOR.REELS;
  return INSIGHTS_FOR.FEED;
}
export function metricsFromInsights(json) {
  const out = {};
  for (const row of json?.data || []) {
    const key = OUR_KEY[row.name];
    const v = row.values?.[0]?.value ?? row.total_value?.value;
    if (key && typeof v === "number") out[key] = v;
  }
  return out;
}
export async function fetchMediaMetrics(api, media) {
  const metrics = {};
  if (typeof media.like_count === "number") metrics.likes = media.like_count;
  if (typeof media.comments_count === "number") metrics.comments = media.comments_count;
  const names = insightNamesFor(media);
  try {
    Object.assign(metrics, metricsFromInsights(await get(api, `/${media.id}/insights`, { metric: names.join(",") })));
  } catch (e) {
    if (e instanceof GraphError && e.needsReconnect) throw e;
    for (const name of names) {
      try {
        Object.assign(metrics, metricsFromInsights(await get(api, `/${media.id}/insights`, { metric: name })));
      } catch (e2) {
        if (e2 instanceof GraphError && e2.needsReconnect) throw e2;
      }
    }
  }
  return metrics;
}

export const MEDIA_FIELDS = "id,permalink,caption,timestamp,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count";
export async function listMedia(api, igUserId, { maxItems = 100 } = {}) {
  const out = [];
  let after;
  while (out.length < maxItems) {
    const json = await get(api, `/${igUserId}/media`, { fields: MEDIA_FIELDS, limit: 50, after });
    out.push(...(json.data || []));
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return out.slice(0, maxItems);
}

// Which posts to touch this pass. `content` = the brand's Instagram content
// (not in Trash). A post already in Brandlab is re-read while it was
// published this month (Jakarta); a post published since the account was
// connected arrives on its own — linked to a planned card with the very
// same caption (what the import picker does) or added as a new card. Older
// posts stay the owner's pick (the import picker), and so do last month's numbers.
export function planSync({ media, content, connectedAt, now }) {
  const byCode = new Map();
  const byMediaId = new Map();
  const planned = new Map();
  for (const c of content) {
    if (c.igMediaId) byMediaId.set(c.igMediaId, c);
    const code = shortcodeFromUrl(c.publishedUrl);
    if (code) byCode.set(code, c);
    else if (c.caption && String(c.caption).trim()) planned.set(normalizeCaption(c.caption), c);
  }
  const refresh = [];
  const link = [];
  const create = [];
  for (const m of media) {
    const code = shortcodeFromUrl(m.permalink);
    const at = Date.parse(m.timestamp) || 0;
    const existing = byMediaId.get(m.id) || (code && byCode.get(code));
    if (existing) {
      if (inCurrentJakartaMonth(at, now)) refresh.push({ content: existing, media: m });
      continue;
    }
    if (!code || !connectedAt || at < connectedAt) continue;
    const match = planned.get(normalizeCaption(m.caption));
    if (match) {
      planned.delete(normalizeCaption(m.caption));
      link.push({ content: match, media: m });
    } else {
      create.push(m);
    }
  }
  return { refresh, link, create };
}

// js/store.js combinePlatformMetrics, for the server.
export function combinePlatformMetrics(byPlatform = {}) {
  const totals = {};
  for (const key of METRIC_KEYS) {
    const vals = Object.values(byPlatform).map((p) => p?.[key]).filter((v) => v !== undefined && v !== null && v !== "");
    totals[key] = vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  }
  return totals;
}

// The fields a sync writes on a content doc — the same shape the app's own
// Instagram fetch writes (js/instagram-sync.js): the platform's numbers in
// performanceByPlatform[platform], the cross-platform totals in performance.
export function platformMetricsPatch(content, platform, metrics, now) {
  const byPlatform = { instagram: {}, facebook: {}, ...(content.performanceByPlatform || {}) };
  byPlatform[platform] = { ...(byPlatform[platform] || {}), ...metrics };
  const performance = { ...(content.performance || {}) };
  for (const [k, v] of Object.entries(combinePlatformMetrics(byPlatform))) if (v !== null) performance[k] = v;
  return { performanceByPlatform: byPlatform, performance, updatedAt: now };
}
export function metricsPatch(content, metrics, media, now) {
  const patch = { ...platformMetricsPatch(content, "instagram", metrics, now), igMediaId: media.id, igSyncedAt: now };
  const thumb = media.thumbnail_url || media.media_url || "";
  if (thumb && thumbnailReplaceable(content.thumbnail)) patch.thumbnail = thumb;
  return patch;
}

// A planned card that just went out on Instagram.
export function publishPatch(media) {
  return {
    platform: "Instagram",
    format: formatFromMedia(media),
    status: "published",
    publishedUrl: media.permalink,
    publishedDate: jakartaDate(Date.parse(media.timestamp) || Date.now()),
  };
}

// A new card for a post made outside Brandlab — js/store.js emptyContent()
// filled the way the import picker fills it.
export function newContentDoc({ id, brandId, ownerId, media, metrics, now }) {
  const doc = {
    id, brandId, campaignId: "", campaignPhaseId: "", seriesId: "",
    title: titleFromMedia(media), idea: "", format: "", platform: "", mirrorGroupId: "",
    funnel: "TOFU", status: "idea", scheduleDate: "", publishedDate: "", publishedUrl: "",
    script: "", caption: media.caption || "", reference: "", cta: "", notes: "", thumbnail: "",
    performanceByPlatform: { instagram: {}, facebook: {} },
    performance: { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, reposts: null, profileVisits: null, followersGained: null, insightScreenshot: "", confirmedAt: null },
    uploadedPlatforms: { tiktok: false, instagram: false },
    createdAt: now, updatedAt: now, archived: false,
    ownerId,
    ...publishPatch(media),
  };
  return { ...doc, ...metricsPatch(doc, metrics, media, now) };
}

// Followers now + reach over the last 30 days, in the shape
// js/store.js updateBrandInsights writes (source = the platform).
export function insightsPatch(brand, platform, { followers, reach30d }, now) {
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  const prev = brand?.insights?.[platform] || {};
  const entryNow = {
    followers: num(followers) ?? prev.followers ?? null,
    reach30d: num(reach30d) ?? prev.reach30d ?? null,
    profileVisits30d: prev.profileVisits30d ?? null,
    updatedAt: now,
    source: platform,
  };
  const patch = { [`insights.${platform}`]: entryNow };
  const history = Array.isArray(brand?.insightsHistory) ? brand.insightsHistory : [];
  const lastAuto = history.filter((h) => h.platform === platform).reduce((a, h) => Math.max(a, h.at || 0), 0);
  if (num(followers) !== null && now - lastAuto >= HISTORY_EVERY_MS) {
    const entry = { platform, followers: num(followers), reach30d: num(reach30d), profileVisits30d: null, at: now, source: platform };
    patch.insightsHistory = [...history, entry].sort((x, y) => x.at - y.at).slice(-60);
  }
  return patch;
}

// A deletion request through Meta (the person removed the app and asked for
// their data to go; api/instagram/[action].js dataDeletion): what Brandlab
// got from Meta leaves the brand. On a card: the Instagram and Facebook
// figures (other platforms' and numbers typed by hand stay), the post id and
// a thumbnail from Instagram/Facebook. The card itself stays — it's the
// owner's plan.
const META_THUMB = /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//;
export function metaPurgePatch(content, now) {
  const by = content?.performanceByPlatform || {};
  const metaKeys = new Set([...Object.keys(by.instagram || {}), ...Object.keys(by.facebook || {})]);
  const thumb = META_THUMB.test(String(content?.thumbnail || ""));
  if (!metaKeys.size && !content?.igMediaId && !content?.igSyncedAt && !thumb) return null;
  const patch = { igMediaId: "", igSyncedAt: null, updatedAt: now };
  if (metaKeys.size) {
    const byPlatform = { ...by, instagram: {}, facebook: {} };
    const totals = combinePlatformMetrics(byPlatform);
    const performance = { ...(content.performance || {}) };
    for (const k of metaKeys) if (k in totals) performance[k] = totals[k];
    Object.assign(patch, { performanceByPlatform: byPlatform, performance });
  }
  if (thumb) patch.thumbnail = "";
  return patch;
}
// The brand's follower/reach figures that came from Meta (not the ones the
// owner typed) and their history.
export function brandPurgePatch(brand) {
  const fromMeta = (x) => x && ["instagram", "facebook"].includes(x.source);
  const patch = {};
  for (const p of ["instagram", "facebook"]) if (fromMeta(brand?.insights?.[p])) patch[`insights.${p}`] = null;
  const history = Array.isArray(brand?.insightsHistory) ? brand.insightsHistory : [];
  const kept = history.filter((h) => !fromMeta(h));
  if (kept.length !== history.length) patch.insightsHistory = kept;
  return Object.keys(patch).length ? patch : null;
}

export async function fetchAccountNumbers(api, igUserId, now) {
  const profile = await get(api, `/${igUserId}`, { fields: "username,followers_count,media_count" });
  let reach30d = null;
  try {
    const json = await get(api, `/${igUserId}/insights`, {
      metric: "reach", period: "day", metric_type: "total_value",
      since: Math.floor((now - 29 * DAY) / 1000), until: Math.floor(now / 1000),
    });
    const row = (json.data || []).find((r) => r.name === "reach");
    const v = row?.total_value?.value;
    if (typeof v === "number") reach30d = v;
  } catch (e) {
    if (e instanceof GraphError && e.needsReconnect) throw e;
  }
  return { username: profile.username || "", followers: profile.followers_count ?? null, reach30d };
}
