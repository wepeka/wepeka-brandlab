import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  combinePlatformMetrics,
  organicViews,
  instagramOnlyViews,
  resolveContentBuckets,
  brandVoiceText,
  brandToneText,
  initStore,
  createBrand,
  createContent,
  listContent,
  deleteContent,
  restoreContent,
  updateBrand,
  exportJSON,
  getSettings,
} from "../js/store.js";

describe("combinePlatformMetrics", () => {
  test("sums a metric across platforms that both have it", () => {
    const totals = combinePlatformMetrics({
      instagram: { views: 100, likes: 10 },
      facebook: { views: 50 },
    });
    assert.equal(totals.views, 150);
    assert.equal(totals.likes, 10);
  });

  test("a metric no platform reports at all comes back null, not 0", () => {
    const totals = combinePlatformMetrics({ instagram: { views: 100 } });
    assert.equal(totals.saves, null);
  });

  test("an empty breakdown yields all-null totals", () => {
    const totals = combinePlatformMetrics({});
    assert.equal(totals.views, null);
  });
});

describe("organicViews / instagramOnlyViews", () => {
  test("organicViews combines across platforms when a breakdown exists", () => {
    const content = { performanceByPlatform: { instagram: { views: 100 }, facebook: { views: 50 } } };
    assert.equal(organicViews(content), 150);
  });

  test("organicViews falls back to the flat performance.views with no breakdown", () => {
    const content = { performance: { views: 42 } };
    assert.equal(organicViews(content), 42);
  });

  test("instagramOnlyViews excludes the Facebook crosspost number", () => {
    const content = { performanceByPlatform: { instagram: { views: 100 }, facebook: { views: 50 } } };
    assert.equal(instagramOnlyViews(content), 100);
  });

  test("instagramOnlyViews falls back to flat performance.views with no breakdown", () => {
    const content = { performance: { views: 42 } };
    assert.equal(instagramOnlyViews(content), 42);
  });
});

describe("resolveContentBuckets", () => {
  test("resolves Reels (Instagram + Reels format) and TikTok from the default settings", () => {
    const settings = getSettings ? getSettings() : null;
    const fallbackSettings = settings || {
      platforms: [{ id: "instagram", name: "Instagram" }, { id: "tiktok", name: "TikTok" }],
      formats: [{ id: "reels", name: "Reels" }, { id: "short-video", name: "Short Video" }],
    };
    const buckets = resolveContentBuckets(fallbackSettings);
    assert.deepEqual(buckets.reels, { platform: "Instagram", format: "Reels" });
    assert.equal(buckets.tiktok.platform, "TikTok");
  });

  test("degrades to null instead of mislabeling when a platform/format is missing", () => {
    const settings = { platforms: [{ id: "x", name: "Something Else" }], formats: [] };
    const buckets = resolveContentBuckets(settings);
    assert.equal(buckets.reels, null);
    assert.equal(buckets.tiktok, null);
  });
});

describe("brandVoiceText / brandToneText", () => {
  test("prefers Brand DNA personality + tone sliders when set", () => {
    const brand = {
      brandBuilder: {
        personality: { primary: ["Bold"], secondary: ["Warm"] },
        toneOfVoice: { source: "user", formal: 80, language: 20, character: 50, emotion: 90, avoidWords: ["cheap"] },
      },
      aiVoiceGuide: "legacy free-text guide",
    };
    const voice = brandVoiceText(brand);
    assert.match(voice, /Personality: Bold, Warm\./);
    assert.match(voice, /formal/);
    assert.match(voice, /Avoid: cheap\./);
    assert.doesNotMatch(voice, /legacy free-text guide/);
  });

  test("falls back to the legacy aiVoiceGuide when Brand DNA voice is empty", () => {
    const brand = { brandBuilder: { personality: { primary: [], secondary: [] }, toneOfVoice: {} }, aiVoiceGuide: "legacy free-text guide" };
    assert.equal(brandVoiceText(brand), "legacy free-text guide");
  });

  test("brandToneText is empty until the tone sliders have a source", () => {
    assert.equal(brandToneText({ brandBuilder: { toneOfVoice: {} } }), "");
  });

  test("brandToneText describes a lean towards one side of each axis", () => {
    const brand = { brandBuilder: { toneOfVoice: { source: "user", formal: 10, language: 90, character: 50, emotion: 50 } } };
    const text = brandToneText(brand);
    assert.match(text, /casual/);
    assert.match(text, /technical/);
    assert.match(text, /between serious and playful/);
  });
});

describe("in-memory store flow (initStore -> createBrand -> createContent -> listContent -> soft delete -> restore)", () => {
  test("full round trip against the stubbed Firestore listeners", async () => {
    await initStore("test-uid-store-flow");

    const brand = createBrand({ name: "Acme Brand" });
    assert.ok(brand.id);
    assert.equal(brand.name, "Acme Brand");

    const content = createContent(brand.id, { title: "Launch post" });
    assert.ok(content.id);

    let list = listContent(brand.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, content.id);

    // Soft delete hides it from the default list...
    deleteContent(content.id);
    list = listContent(brand.id);
    assert.equal(list.length, 0);

    // ...but it's still there with includeDeleted: true.
    const trashed = listContent(brand.id, { includeDeleted: true });
    assert.equal(trashed.length, 1);
    assert.ok(trashed[0].deletedAt);

    // Restore brings it back into the default list.
    restoreContent(content.id);
    list = listContent(brand.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].deletedAt, null);
  });
});

describe("exportJSON never leaks secrets/AI usage", () => {
  test("strips settings.ai, aiUsage, and brand social tokens", async () => {
    await initStore("test-uid-export");
    const brand = createBrand({
      name: "Secret Brand",
      instagram: { accessToken: "IG_SECRET_TOKEN", igUserId: "123", username: "acme", connectedAt: null },
      facebook: { pageId: "456", pageAccessToken: "FB_SECRET_TOKEN", pageName: "Acme", connectedAt: null },
    });
    updateBrand(brand.id, { ads: { metaAdsToken: "ADS_SECRET_TOKEN", spend: 100 } });

    const json = exportJSON();
    assert.doesNotMatch(json, /IG_SECRET_TOKEN/);
    assert.doesNotMatch(json, /FB_SECRET_TOKEN/);
    assert.doesNotMatch(json, /ADS_SECRET_TOKEN/);
    assert.doesNotMatch(json, /accessToken/);
    assert.doesNotMatch(json, /"aiUsage"/);

    const parsed = JSON.parse(json);
    assert.equal(parsed.settings.ai, undefined);
    assert.equal(parsed.settings.aiUsage, undefined);
  });
});
