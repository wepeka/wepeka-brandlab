// Pulls fresh Instagram insights for every piece of content that already
// has a Published URL — shared by Content List's manual "refresh all"
// button and the automatic weekly pass kicked off from main.js.
//
// Writes the same shape the Content Editor's own "Fetch from Instagram"
// does: metrics merged into performanceByPlatform.instagram, then the
// combined cross-platform totals copied into `performance`. (The old bulk
// refresh wrote only the flat `performance`, which organicViews and
// friends ignore once a per-platform breakdown exists.)
import { getBrand, listBrands, listContent, updateContent, updateBrand, combinePlatformMetrics } from "./store.js";
import { listRecentMedia, fetchMediaMetrics, shortcodeFromUrl } from "./instagram.js";
import { getCachedAccount, isActive, canUseInstagramApi } from "./account.js";
import { toast } from "./dom.js";
import { t } from "./i18n.js";

export function instagramTrackedContent(brandId) {
  return listContent(brandId).filter((c) => c.platform === "Instagram" && c.publishedUrl);
}

function applyInstagramMetrics(content, metrics) {
  const byPlatform = { instagram: {}, facebook: {}, ...(content.performanceByPlatform || {}) };
  byPlatform.instagram = { ...byPlatform.instagram, ...metrics };
  const performance = {};
  Object.entries(combinePlatformMetrics(byPlatform)).forEach(([key, value]) => {
    if (value !== null) performance[key] = value;
  });
  updateContent(content.id, { performanceByPlatform: byPlatform, performance });
}

// Throws only when the account's media list can't be read at all (bad
// token, network) — per-post failures are reported through onRowDone and
// counted in `failed` instead.
export async function syncInstagramPerformance(brandId, ig, { onRowStart, onRowDone } = {}) {
  if (!canUseInstagramApi()) throw new Error(t("integr.ig.soon"));
  const targets = instagramTrackedContent(brandId);
  if (!targets.length) return { ok: 0, failed: 0, total: 0 };
  const media = await listRecentMedia(ig, { maxItems: 100 });
  let ok = 0;
  let failed = 0;
  for (const c of targets) {
    onRowStart?.(c);
    try {
      const code = shortcodeFromUrl(c.publishedUrl);
      const mediaObj = media.find((m) => shortcodeFromUrl(m.permalink) === code);
      if (!mediaObj) throw new Error(t("integr.ig.notInRecent"));
      const { metrics } = await fetchMediaMetrics(ig, mediaObj);
      applyInstagramMetrics(c, metrics);
      ok++;
      onRowDone?.(c, null);
    } catch (e) {
      failed++;
      onRowDone?.(c, e);
    }
  }
  return { ok, failed, total: targets.length };
}

const AUTO_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
let autoSyncStarted = false;

// Once per app session, for each brand with Instagram connected whose last
// automatic pass is a week old or more. Quiet on failure (console only) —
// the manual button in Content List is still there to see what went wrong.
// Readonly/deactivated accounts are skipped: their writes would be refused.
export async function maybeAutoSyncInstagram() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  if (!isActive(getCachedAccount()) || !canUseInstagramApi()) return;
  for (const brand of listBrands()) {
    const ig = brand.instagram;
    if (!ig?.accessToken || !ig?.igUserId) continue;
    if (ig.lastAutoSyncAt && Date.now() - ig.lastAutoSyncAt < AUTO_SYNC_INTERVAL_MS) continue;
    if (!instagramTrackedContent(brand.id).length) continue;
    try {
      const { ok } = await syncInstagramPerformance(brand.id, ig);
      const latest = getBrand(brand.id)?.instagram || ig;
      updateBrand(brand.id, { instagram: { ...latest, lastAutoSyncAt: Date.now() } });
      if (ok) toast(t("integr.ig.autoSynced", { count: ok, brand: brand.name }));
    } catch (e) {
      console.warn(`[Instagram auto-sync] ${brand.name}:`, e.message);
    }
  }
}
