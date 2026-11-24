// Facebook Login for Business — the main way a brand connects (owner,
// 2026-11-24): one login gives the brand its Instagram professional
// account, its Facebook Page and its Meta ad account. Pure helpers over an
// injected fetch; api/instagram/[action].js wires them.
//
// Which token (developers.facebook.com/docs/facebook-login/facebook-login-
// for-business, "Supported access tokens", read 2026-11-24):
// - Business integration system user (BISU) token — "if your app performs
//   programmatic, automated actions on your business clients' assets
//   without having to rely on input from an app user, or require
//   re-authentication at a future date"; Tech Providers only; defaults to
//   never expire; the client picks the exact assets in Meta's dialog.
// - User access token — "if your app takes actions in real time, based on
//   input from the user"; short-lived, 60 days once exchanged.
// Brandlab posts at the hour from a cron and syncs every night without the
// owner there, and Wepeka is a Tech Provider, so the configuration asks for
// a BISU token ("System-user access token", expiry Never). A configuration
// set to user tokens still works here (the code tells them apart by
// /me?fields=client_business_id): the user token is exchanged for a 60-day
// one and the Pages' own tokens, which don't expire, do the Page work.
// The full reasoning is in .claude/rencana-9-objektif/META-APP-REVIEW.md.
import { graphGet, graphList, GraphError, FB_GRAPH, GRAPH_VERSION } from "./_metaVault.js";

export const FB_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
// What the configuration (config_id) asks for — the App Review list
// (owner, 2026-11-24). The dialog takes them from the configuration, not
// from a scope parameter; kept here for the docs and the tests.
export const FB_PERMISSIONS = [
  "instagram_basic", "instagram_manage_insights", "instagram_content_publish",
  "pages_show_list", "pages_read_engagement", "business_management",
  "pages_manage_posts", "read_insights", "ads_read",
];

const get = (api, path, params) => graphGet(api.fetch, api.base || FB_GRAPH, path, params, api.token);
const list = (api, path, params, opts) => graphList(api.fetch, api.base || FB_GRAPH, path, params, api.token, opts);
const DAY = 24 * 60 * 60 * 1000;

// Meta's login dialog for this app's configuration. config_id replaces
// `scope`; a BISU configuration needs override_default_response_type.
export function dialogUrl({ appId, configId, redirectUri, state }) {
  const u = new URL(FB_DIALOG);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("config_id", configId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

// code → token, then what kind it is, how long it lives and what it may do.
export async function exchangeCode(fetchImpl, { appId, appSecret, redirectUri, code }) {
  const base = { fetch: fetchImpl, base: FB_GRAPH };
  const first = await graphGet(fetchImpl, FB_GRAPH, "/oauth/access_token", { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }, null);
  if (!first?.access_token) throw new GraphError("token exchange: no token", { status: 400 });
  let token = first.access_token;
  const me = await get({ ...base, token }, "/me", { fields: "id" });
  // Only a BISU token may read client_business_id; Meta refuses the whole
  // request for a user token (code 190, "can only be accessed using a
  // Business Integration System User access token", seen live 2026-11-25),
  // so it's asked on its own and a refusal means "user token".
  let clientBusinessId = "";
  try {
    clientBusinessId = String((await get({ ...base, token }, "/me", { fields: "client_business_id" })).client_business_id || "");
  } catch {
    clientBusinessId = "";
  }
  const tokenType = clientBusinessId ? "system" : "user";
  let expiresIn = Number(first.expires_in) || 0;
  let name = "";
  if (tokenType === "user") {
    // 60 days instead of a couple of hours.
    const long = await graphGet(fetchImpl, FB_GRAPH, "/oauth/access_token", { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: token }, null);
    token = long.access_token || token;
    expiresIn = Number(long.expires_in) || 60 * 24 * 3600;
    try {
      name = String((await get({ ...base, token }, "/me", { fields: "name" })).name || "");
    } catch {
      name = "";
    }
  }
  const info = await debugToken(fetchImpl, { appId, appSecret, token });
  return {
    token, tokenType,
    // When it dies: Meta's own date (epoch seconds) if it gives one, else
    // the exchange's expires_in; neither = never (a BISU token from a
    // "Never" configuration). See tokenExpiry.
    expiresAt: info.expiresAt || 0,
    expiresIn: tokenType === "system" ? 0 : expiresIn,
    appUserId: String(me.id || ""),
    name,
    clientBusinessId,
    permissions: info.scopes,
  };
}

// /debug_token with the app token: scopes and expiry for any token type.
export async function debugToken(fetchImpl, { appId, appSecret, token }) {
  try {
    const json = await graphGet(fetchImpl, FB_GRAPH, "/debug_token", { input_token: token }, `${appId}|${appSecret}`);
    const d = json.data || {};
    return { scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [], expiresAt: Number(d.expires_at) || 0, valid: d.is_valid !== false };
  } catch (e) {
    if (e instanceof GraphError && e.needsReconnect) throw e;
    return { scopes: [], expiresAt: 0, valid: true };
  }
}

// What the login let Brandlab see. Pages come with their own tokens (Page
// work — posting a reel, Page numbers — runs on those); Instagram accounts
// come through their Page, and, for a BISU token, also straight from the
// business (Instagram API with unified login: no Page needed). Each edge
// that isn't granted just comes back empty.
export async function discoverAssets(fetchImpl, token, tokenType) {
  const api = { fetch: fetchImpl, base: FB_GRAPH, token };
  const soft = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GraphError && e.needsReconnect) throw e;
      return [];
    }
  };
  const rawPages = await soft(() => list(api, "/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}" }));
  const pages = [];
  for (const p of rawPages) {
    let pageToken = p.access_token || "";
    if (!pageToken) {
      const one = await soft(async () => [await get(api, `/${p.id}`, { fields: "access_token" })]);
      pageToken = one[0]?.access_token || "";
    }
    pages.push({ id: String(p.id), name: String(p.name || ""), token: pageToken, igId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : "" });
  }
  const instagram = [];
  const seen = new Set();
  for (const p of rawPages) {
    const ig = p.instagram_business_account;
    if (ig?.id && !seen.has(String(ig.id))) {
      seen.add(String(ig.id));
      instagram.push({ id: String(ig.id), username: String(ig.username || ""), pageId: String(p.id) });
    }
  }
  if (tokenType === "system") {
    for (const ig of await soft(() => list(api, "/me/assigned_instagram_accounts", { fields: "id,username" }))) {
      if (!ig?.id || seen.has(String(ig.id))) continue;
      seen.add(String(ig.id));
      instagram.push({ id: String(ig.id), username: String(ig.username || ""), pageId: "" });
    }
  }
  const adAccounts = (await soft(() => list(api, "/me/adaccounts", { fields: "id,account_id,name,currency,account_status" })))
    .filter((a) => a?.id)
    .map((a) => ({ id: String(a.id).startsWith("act_") ? String(a.id) : `act_${a.account_id || a.id}`, name: String(a.name || a.account_id || a.id), currency: String(a.currency || ""), status: Number(a.account_status) || 0 }));
  return { pages, instagram, adAccounts };
}

// ---------- the Facebook Page ----------
// Followers and the last 28 days of the Page, with whichever metric name
// this Page answers to (Meta renamed Page metrics on 2026-06-15:
// page_impressions* became *_media_view*).
export const PAGE_REACH_METRICS = ["page_total_media_view_unique", "page_impressions_unique"];
export async function fetchPageNumbers(api, pageId) {
  const profile = await get(api, `/${pageId}`, { fields: "name,followers_count,fan_count" });
  let reach30d = null;
  for (const metric of PAGE_REACH_METRICS) {
    try {
      const json = await get(api, `/${pageId}/insights`, { metric, period: "days_28" });
      const values = json.data?.[0]?.values || [];
      const v = values[values.length - 1]?.value;
      if (typeof v === "number") {
        reach30d = v;
        break;
      }
    } catch (e) {
      if (e instanceof GraphError && e.needsReconnect) throw e;
    }
  }
  const followers = profile.followers_count ?? profile.fan_count ?? null;
  return { name: String(profile.name || ""), followers, reach30d };
}

// A video Brandlab put on the Page: likes, comments, shares, views — the
// candidates js/facebook.js learned (a reel's plays are a field on the
// video; older videos answer through /video_insights).
const VIEW_FIELDS = ["blue_reels_play_count", "total_video_views"];
const VIEW_INSIGHTS = ["total_video_views", "post_video_views"];
export async function fetchPageVideoMetrics(api, videoId) {
  const metrics = {};
  const soft = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GraphError && e.needsReconnect) throw e;
      return null;
    }
  };
  const basic = await soft(() => get(api, `/${videoId}`, { fields: "likes.summary(true),comments.summary(true)" }));
  if (typeof basic?.likes?.summary?.total_count === "number") metrics.likes = basic.likes.summary.total_count;
  if (typeof basic?.comments?.summary?.total_count === "number") metrics.comments = basic.comments.summary.total_count;
  for (const f of VIEW_FIELDS) {
    const r = await soft(() => get(api, `/${videoId}`, { fields: f }));
    if (typeof r?.[f] === "number") {
      metrics.views = r[f];
      return metrics;
    }
  }
  for (const m of VIEW_INSIGHTS) {
    const r = await soft(() => get(api, `/${videoId}/video_insights`, { metric: m }));
    const v = r?.data?.[0]?.values?.[0]?.value;
    if (typeof v === "number") {
      metrics.views = v;
      break;
    }
  }
  return metrics;
}

// ---------- Meta Ads → Sales ----------
// What an ad account spent per ad and month, and what Meta SAYS it brought
// (its own purchase count and value — reported, never a sale).
const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const firstAction = (rows) => {
  for (const name of PURCHASE) {
    const hit = (rows || []).find((a) => a.action_type === name);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
};
export async function fetchAdsByMonth(api, adAccountId, { since, until }) {
  const ads = await list(api, `/${adAccountId}/ads`, { fields: "id,name,creative{effective_instagram_media_id,effective_object_story_id}" }, { maxItems: 1000 });
  const creative = new Map(ads.map((a) => [String(a.id), a]));
  const rows = await list(api, `/${adAccountId}/insights`, {
    level: "ad", fields: "ad_id,ad_name,spend,impressions,clicks,actions,action_values",
    time_range: JSON.stringify({ since, until }), time_increment: "monthly",
  }, { maxItems: 3000 });
  return rows.map((r) => {
    const ad = creative.get(String(r.ad_id)) || {};
    return {
      adId: String(r.ad_id || ""), adName: String(r.ad_name || ad.name || ""), month: String(r.date_start || "").slice(0, 7),
      spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
      purchases: firstAction(r.actions), purchaseValue: firstAction(r.action_values),
      igMediaId: String(ad.creative?.effective_instagram_media_id || ""), storyId: String(ad.creative?.effective_object_story_id || ""),
    };
  });
}

// The window each nightly pass re-reads: last month and this one (Meta
// restates ad numbers for 28 days), on the Jakarta calendar.
export function adsWindow(now) {
  const today = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  return { since: prev, until: today, months: [prev.slice(0, 7), today.slice(0, 7)] };
}
const lastDayOf = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Ad rows → one "Iklan" expense per piece of content and month, the way
// js/sales-tracker.js expenseEntry stores one (category "ads" + contentId,
// so js/content-money.js reads its ROAS), marked automatic. Spend only in
// Rupiah: Brandlab's Sales are in Rupiah and a foreign-currency account is
// left out rather than converted at a guessed rate. `contents` = the
// brand's content (igMediaId / posting.ig.mediaId name the post an ad
// promotes). Returns { entries, unmatched, currencySkipped }.
export function adsExpenseEntries(rows, { contents, adAccountId, currency, now }) {
  const byMedia = new Map();
  for (const c of contents || []) {
    for (const id of [c.igMediaId, c.posting?.ig?.mediaId]) if (id) byMedia.set(String(id), c);
  }
  if (String(currency || "").toUpperCase() !== "IDR") return { entries: [], unmatched: rows.length, currencySkipped: true };
  const sums = new Map();
  let unmatched = 0;
  for (const r of rows) {
    const c = byMedia.get(r.igMediaId);
    if (!c || !/^\d{4}-\d{2}$/.test(r.month)) {
      if (r.spend > 0) unmatched++;
      continue;
    }
    const key = `${c.id}|${r.month}`;
    const s = sums.get(key) || { contentId: c.id, title: c.title || "", month: r.month, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, ads: new Set() };
    s.spend += r.spend;
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.purchases += r.purchases;
    s.purchaseValue += r.purchaseValue;
    s.ads.add(r.adId);
    sums.set(key, s);
  }
  const today = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const entries = [...sums.values()].filter((s) => Math.round(s.spend) > 0).map((s) => ({
    id: `meta-ads-${s.contentId}-${s.month}`,
    kind: "expense", category: "ads",
    amount: Math.round(s.spend),
    date: today.startsWith(s.month) ? today : lastDayOf(s.month),
    note: `Meta Ads (otomatis) · ${String(s.title).slice(0, 80)}`.slice(0, 140),
    channelDetail: "Meta Ads",
    contentId: s.contentId,
    attribution: "auto",
    meta: {
      adAccountId, currency: "IDR", ads: s.ads.size,
      impressions: s.impressions, clicks: s.clicks,
      // What Meta reports — shown beside real sales, never added to them.
      reportedPurchases: s.purchases, reportedValue: Math.round(s.purchaseValue),
      syncedAt: now,
    },
    at: now,
  }));
  return { entries, unmatched, currencySkipped: false };
}

// One month doc's entries after a pass: the automatic entries of the
// months this pass read are replaced; everything the owner logged stays.
export function mergeAutoEntries(existing, fresh, months, adAccountId) {
  const mine = (e) => e?.attribution === "auto" && String(e?.id || "").startsWith("meta-ads-") && months.includes(String(e.date || "").slice(0, 7))
    && (!e.meta?.adAccountId || e.meta.adAccountId === adAccountId);
  const kept = (existing || []).filter((e) => !mine(e));
  const before = new Map((existing || []).filter(mine).map((e) => [e.id, e]));
  // An unchanged entry keeps its first "at" (the log's order).
  return [...kept, ...fresh.map((e) => (before.has(e.id) ? { ...e, at: before.get(e.id).at || e.at } : e))];
}

// Epoch ms the token stops working, or null for never.
export const tokenExpiry = ({ expiresAt, expiresIn }, now) => (expiresAt > 0 ? expiresAt * 1000 : expiresIn > 0 ? now + expiresIn * 1000 : null);

export const tokenDaysLeft =(grant, now) => (grant?.tokenExpiresAt ? Math.floor((grant.tokenExpiresAt - now) / DAY) : null);
