// The platforms content is counted under (owner, 2026-10-30): Reels
// (Instagram and Facebook together — the same reel usually goes to both),
// TikTok and YouTube, plus "Lainnya" for anything else. Shared by Daftar
// Konten's platform cards (js/views/content-list.js) and the Report's
// platform pick (js/views/report.js), so both count the same way.
//
// A piece is on a platform through its own `platform` or a "sudah
// diupload" tick in Creator (uploadedPlatforms, keyed by platform id) —
// one reel is often ticked as uploaded to Instagram AND TikTok rather than
// made into twins. Its numbers there: `performance` for its own platform,
// `crossPostPerformance[key]` for a ticked one.
import { t } from "./i18n.js";

const KNOWN_PLATFORM = /instagram|facebook|tik\s*tok|youtube/i;
export const PLATFORM_CARDS = [
  { key: "reels", name: "Reels", app: "#FF6F91", app2: "#9B3CF0", art: "reels", test: (p) => /instagram|facebook/i.test(p || "") },
  { key: "tiktok", name: "TikTok", app: "#3BE8E2", app2: "#FF3D6E", art: "tiktok", test: (p) => /tik\s*tok/i.test(p || "") },
  { key: "youtube", name: "YouTube", app: "#FF7A6B", app2: "#D42A2A", art: "youtube", test: (p) => /youtube/i.test(p || "") },
  { key: "other", app: "#F2C46D", app2: "#D9822B", art: "other-platforms", test: (p) => !KNOWN_PLATFORM.test(p || "") },
];
export const platformCard = (key) => PLATFORM_CARDS.find((x) => x.key === key) || null;
export const platformCardName = (card) => card.name || t("contentList.pf.other");

// The tick's key when the piece is on this card only through a tick, ""
// when it is the piece's own platform, null when it isn't on the card.
export function platformLink(c, card) {
  if (card.key === "other") return c.platform && card.test(c.platform) ? "" : null;
  if (card.test(c.platform)) return "";
  const ticks = Object.entries(c.uploadedPlatforms || {}).filter(([, on]) => on).map(([k]) => k);
  return ticks.find((k) => card.test(k)) ?? null;
}

// The name a ticked key stands for ("tiktok" → "TikTok").
export function crossPlatformName(key) {
  if (/tik\s*tok/i.test(key)) return "TikTok";
  if (/youtube/i.test(key)) return "YouTube";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// A piece as seen on one ticked platform: the same piece with that
// platform's name and numbers, so everything that reads `platform` /
// `performance` (organicViews, contentMetric, computeContentMetrics) works
// on it unchanged. `crossKey` marks it.
export function crossPostView(c, key) {
  return { ...c, platform: crossPlatformName(key), performance: c.crossPostPerformance?.[key] || {}, performanceByPlatform: {}, crossPostPerformance: {}, crossKey: key };
}

const hasNumbers = (perf) => Object.entries(perf || {}).some(([k, v]) => k !== "confirmedAt" && typeof v === "number" && Number.isFinite(v));

// The pieces to count for one platform card (`key`), or for all of them
// together ("all"): each piece once on its own platform, plus once per
// ticked platform that has its own numbers — so a reel on Instagram and
// TikTok adds both platforms' views to the combined total.
export function contentOnPlatform(content, key = "all") {
  if (key === "all") {
    return content.flatMap((c) => {
      const own = PLATFORM_CARDS.find((card) => card.key !== "other" && card.test(c.platform));
      const extra = Object.entries(c.uploadedPlatforms || {})
        .filter(([k, on]) => on && !(own && own.test(k)) && hasNumbers(c.crossPostPerformance?.[k]))
        .map(([k]) => crossPostView(c, k));
      return [c, ...extra];
    });
  }
  const card = platformCard(key);
  if (!card) return content;
  return content.flatMap((c) => {
    const link = platformLink(c, card);
    if (link === null) return [];
    return [link ? crossPostView(c, link) : c];
  });
}
