// Meta Marketing API client — read-only, same spirit as instagram.js and
// facebook.js: pull numbers for ads that already exist, never create or
// change one. Needs an access token with the ads_read permission (the same
// EAA Facebook token you already generated for the Page can usually be
// re-generated with ads_read added — no separate app needed) and the Ad
// Account ID for the account that ran the boost/campaign.
import { t } from "./i18n.js";

const API_BASE = "https://graph.facebook.com/v19.0";

class AdsApiError extends Error {}

async function graphGet(path, params, accessToken) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new AdsApiError(json.error?.message || t("integr.ads.apiFailed", { status: res.status }));
  }
  return json;
}

function normalizeAccountId(id) {
  return id.startsWith("act_") ? id : `act_${id}`;
}

function normalizeUrl(u) {
  return (u || "").replace(/\/$/, "").split("?")[0].toLowerCase();
}

export async function testAdsConnection({ adAccountId, adsAccessToken }) {
  const json = await graphGet(`/${normalizeAccountId(adAccountId)}`, { fields: "name,account_status" }, adsAccessToken);
  return json.name;
}

// Finds any ad(s) whose creative promotes this exact published post —
// matched via the creative's instagram_permalink_url (how Meta links an ad
// back to the Instagram post it's boosting), not by ad name, since names are
// whatever the person who made the ad typed and don't reliably reference
// the post at all. Logs what came back either way — the field name an
// account/API version actually returns for this hasn't been confirmed
// against a real ad yet, so this is deliberately visible for diagnosis.
export async function findAdsForPost({ adAccountId, adsAccessToken }, publishedUrl) {
  const target = normalizeUrl(publishedUrl);
  const matches = [];
  let after;
  for (let page = 0; page < 5; page++) {
    const json = await graphGet(
      `/${normalizeAccountId(adAccountId)}/ads`,
      {
        fields: "id,name,effective_status,creative{instagram_permalink_url,effective_object_story_id}",
        limit: 100,
        ...(after ? { after } : {}),
      },
      adsAccessToken
    );
    // eslint-disable-next-line no-console
    console.log(`[Ads] /ads page ${page} →`, JSON.stringify(json.data));
    (json.data || []).forEach((ad) => {
      const igUrl = ad.creative?.instagram_permalink_url;
      if (igUrl && normalizeUrl(igUrl) === target) matches.push(ad);
    });
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return matches;
}

// Returns null for any figure Meta didn't return for this ad rather than 0
// — an ad with no spend yet and an ad whose field genuinely wasn't returned
// shouldn't look the same.
export async function fetchAdInsights({ adsAccessToken }, adId) {
  const json = await graphGet(
    `/${adId}/insights`,
    { fields: "spend,impressions,reach,clicks,cpm,ctr,actions,video_play_actions" },
    adsAccessToken
  );
  // eslint-disable-next-line no-console
  console.log(`[Ads] /${adId}/insights →`, JSON.stringify(json));
  const row = json.data?.[0] || {};
  const actionValue = (list, type) => {
    const found = list?.find((a) => a.action_type === type);
    return found ? Number(found.value) : null;
  };
  return {
    spend: row.spend !== undefined ? Number(row.spend) : null,
    impressions: row.impressions !== undefined ? Number(row.impressions) : null,
    reach: row.reach !== undefined ? Number(row.reach) : null,
    clicks: row.clicks !== undefined ? Number(row.clicks) : null,
    cpm: row.cpm !== undefined ? Number(row.cpm) : null,
    videoViews: actionValue(row.video_play_actions, "video_view") ?? actionValue(row.actions, "video_view"),
  };
}

export { AdsApiError };
