// Facebook Graph API client — read-only, same spirit as instagram.js: pull
// numbers for a Reel that's already been crossposted from Instagram to a
// Facebook Page, never post anything.
//
// Needs a Page Access Token (not a personal/user token) for the specific
// Page this brand's Instagram account is linked to, with the
// pages_read_engagement and read_insights permissions.
//
// Unlike instagram.js, the exact field/metric names here are NOT yet
// confirmed against a real account — Meta has moved Facebook Reels view
// counts between a plain field on the video object and the /video_insights
// edge more than once, and earlier guesses ("facebook_views",
// "crossposted_views") turned out not to exist at all. So every attempt
// below is logged to the console, on purpose, so the first real run's log
// can be used to lock in whichever name actually works for this account
// instead of guessing again.
const API_BASE = "https://graph.facebook.com/v19.0";

class FacebookApiError extends Error {}

async function graphGet(path, params, accessToken) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new FacebookApiError(json.error?.message || `Facebook API request failed (${res.status}).`);
  }
  return json;
}

export async function testFacebookConnection({ pageId, pageAccessToken }) {
  const json = await graphGet(`/${pageId}`, { fields: "name" }, pageAccessToken);
  return json.name;
}

async function listFromEdge(edge, { pageId, pageAccessToken }, maxItems) {
  const results = [];
  let after;
  while (results.length < maxItems) {
    const json = await graphGet(
      `/${pageId}/${edge}`,
      { fields: "id,description,created_time,permalink_url,format,picture", limit: 50, ...(after ? { after } : {}) },
      pageAccessToken
    );
    results.push(...(json.data || []));
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return results.slice(0, maxItems);
}

// Confirmed via a real account's console log: "video_reels" isn't a valid
// edge on a Page at all — Graph API rejects it outright ("Tried accessing
// nonexisting field"), not just an empty result. A crossposted Instagram
// Reel actually lands as a normal entry in the Page's own feed (/posts)
// with a video attachment, same as any other video post — there's no
// Reels-specific read edge for this, so this reads the feed and keeps only
// the entries that have a video attached, then reshapes each into the same
// {id, description, created_time, permalink_url, picture} shape /videos
// items already have so nothing downstream needs to know the difference.
async function listVideoPostsFromFeed({ pageId, pageAccessToken }, maxItems) {
  const results = [];
  let after;
  while (results.length < maxItems) {
    const json = await graphGet(
      `/${pageId}/posts`,
      { fields: "id,message,created_time,permalink_url,attachments{media_type,media,url}", limit: 50, ...(after ? { after } : {}) },
      pageAccessToken
    );
    const videoPosts = (json.data || []).filter((p) => p.attachments?.data?.some((a) => a.media_type === "video"));
    results.push(...videoPosts.map(normalizePost));
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return results.slice(0, maxItems);
}

function normalizePost(post) {
  const att = post.attachments?.data?.[0];
  return {
    id: post.id,
    description: post.message || "",
    created_time: post.created_time,
    permalink_url: post.permalink_url,
    picture: att?.media?.image?.src || "",
  };
}

// Pulls the Page's recent videos, same "browse and pick" idea as
// listRecentMedia in instagram.js. Two sources are combined (by id, so
// nothing shows up twice): the dedicated /videos edge (regular uploads) and
// the Page feed filtered to video posts (crossposted Reels land here). One
// source failing doesn't block the other.
//
// Returns { videos, warnings } instead of throwing on a partial failure —
// zero videos because the account genuinely has none is a different
// situation from zero videos because one source errored out, and the
// caller needs to be able to tell those apart instead of both looking like
// a silent empty result.
export async function listRecentVideos({ pageId, pageAccessToken }, { maxItems = 100 } = {}) {
  const [videosResult, feedResult] = await Promise.allSettled([
    listFromEdge("videos", { pageId, pageAccessToken }, maxItems),
    listVideoPostsFromFeed({ pageId, pageAccessToken }, maxItems),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    "[Facebook] /videos →",
    videosResult.status === "fulfilled" ? `${videosResult.value.length} item(s)` : `ERROR: ${videosResult.reason?.message}`
  );
  // eslint-disable-next-line no-console
  console.log(
    "[Facebook] /posts (video only) →",
    feedResult.status === "fulfilled" ? `${feedResult.value.length} item(s)` : `ERROR: ${feedResult.reason?.message}`
  );

  const warnings = [];
  if (videosResult.status === "rejected") warnings.push(`Videos: ${videosResult.reason?.message}`);
  if (feedResult.status === "rejected") warnings.push(`Feed: ${feedResult.reason?.message}`);

  if (videosResult.status === "rejected" && feedResult.status === "rejected") {
    throw new FacebookApiError(videosResult.reason?.message || feedResult.reason?.message || "Couldn't reach Facebook.");
  }

  const byId = new Map();
  [videosResult, feedResult].forEach((r) => {
    if (r.status === "fulfilled") r.value.forEach((v) => byId.set(v.id, v));
  });
  const videos = [...byId.values()]
    .sort((a, b) => new Date(b.created_time) - new Date(a.created_time))
    .slice(0, maxItems);
  return { videos, warnings };
}

// The `format` edge returns thumbnails at several sizes when present —
// falls back to the flatter `picture` field some API versions return instead.
export function thumbnailFromVideo(video) {
  return video.format?.[0]?.picture || video.picture || "";
}

export function titleFromVideo(video) {
  const desc = (video.description || "").trim();
  if (desc) {
    const firstLine = desc.split("\n")[0];
    return firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine;
  }
  return `Facebook video — ${new Date(video.created_time).toLocaleDateString()}`;
}

// Facebook has no "find by permalink" the way Instagram does, so a
// crossposted video is matched back to its Instagram post the same way
// Instagram imports are deduplicated elsewhere in this app: by caption text,
// falling back to whichever video was published closest to the post's date.
export async function findFacebookVideoByCaption({ pageId, pageAccessToken }, { caption, aroundDate } = {}) {
  const { videos } = await listRecentVideos({ pageId, pageAccessToken }, { maxItems: 100 });
  const snippet = (caption || "").trim().slice(0, 60).toLowerCase();

  if (snippet) {
    const captionMatch = videos.find((v) => (v.description || "").toLowerCase().includes(snippet));
    if (captionMatch) return captionMatch;
  }
  if (aroundDate) {
    const target = new Date(aroundDate).getTime();
    const withDelta = videos
      .map((v) => ({ v, delta: Math.abs(new Date(v.created_time).getTime() - target) }))
      .filter((x) => x.delta < 1000 * 60 * 60 * 24 * 3) // within 3 days
      .sort((a, b) => a.delta - b.delta);
    if (withDelta[0]) return withDelta[0].v;
  }
  return null;
}

async function fetchOneField(videoId, fieldName, accessToken) {
  try {
    const json = await graphGet(`/${videoId}`, { fields: fieldName }, accessToken);
    // eslint-disable-next-line no-console
    console.log(`[Facebook] field=${fieldName} →`, JSON.stringify(json));
    const val = json[fieldName];
    return val === undefined ? { value: null, error: null } : { value: val, error: null };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`[Facebook] field=${fieldName} → ERROR:`, e.message);
    return { value: null, error: e };
  }
}

async function fetchOneInsight(videoId, metricName, accessToken) {
  try {
    const json = await graphGet(`/${videoId}/video_insights`, { metric: metricName }, accessToken);
    // eslint-disable-next-line no-console
    console.log(`[Facebook] metric=${metricName} →`, JSON.stringify(json));
    const val = json.data?.[0]?.values?.[0]?.value;
    return val === undefined ? { value: null, error: null } : { value: val, error: null };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`[Facebook] metric=${metricName} → ERROR:`, e.message);
    return { value: null, error: e };
  }
}

// Reels' play count is exposed directly as a field on the video object, not
// through /video_insights — try that first, then fall back to the insights
// edge's own candidate names in case this account/version differs.
const VIEW_FIELD_CANDIDATES = ["blue_reels_play_count", "total_video_views"];
const VIEW_INSIGHT_CANDIDATES = ["total_video_views", "post_video_views"];

// Returns { metrics: {ourKey: value, ...}, warnings: [string, ...] } — same
// partial-success shape as fetchMediaMetrics in instagram.js, so whatever
// Facebook won't give back just gets left for manual entry.
export async function fetchFacebookVideoMetrics({ pageAccessToken }, videoId) {
  const metrics = {};
  const warnings = [];

  try {
    const basic = await graphGet(`/${videoId}`, { fields: "likes.summary(true),comments.summary(true),shares" }, pageAccessToken);
    if (basic.likes?.summary?.total_count !== undefined) metrics.likes = basic.likes.summary.total_count;
    if (basic.comments?.summary?.total_count !== undefined) metrics.comments = basic.comments.summary.total_count;
    if (basic.shares?.count !== undefined) metrics.shares = basic.shares.count;
  } catch (e) {
    warnings.push(`Couldn't read like/comment/share counts: ${e.message}`);
  }

  let lastError = null;
  let viewsFound = false;
  for (const fieldName of VIEW_FIELD_CANDIDATES) {
    const { value, error } = await fetchOneField(videoId, fieldName, pageAccessToken);
    if (error) { lastError = error; continue; }
    if (value === null) continue;
    metrics.views = value;
    viewsFound = true;
    break;
  }
  if (!viewsFound) {
    for (const metricName of VIEW_INSIGHT_CANDIDATES) {
      const { value, error } = await fetchOneInsight(videoId, metricName, pageAccessToken);
      if (error) { lastError = error; continue; }
      if (value === null) continue;
      metrics.views = value;
      viewsFound = true;
      break;
    }
  }
  if (!viewsFound && lastError) warnings.push(`views: ${lastError.message}`);

  return { metrics, warnings };
}

export { FacebookApiError };
