// Regression tests for the 2026-10-05 Tujuan/Grow Brand audit fixes:
//  1. Level 1 no longer finishes itself for an account already past its
//     follower checkpoint (placement + the followers shortcut).
//  2. Content counts toward a Social Media Growth campaign by platform —
//     including uploadedPlatforms, "Lainnya", and drafts made for it.
//  3. Performance asks: at most twice per post, never after ~30 days, and
//     an empty save is not a check.
//  4. Finishing the last level finishes the campaign, and Beranda's top
//     action skips it.
//  6. Pemula reads plain Grow Brand campaign names (display only).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { placeStartSocialLevel, buildSocialGrowthPlan } from "../js/goal-plan.js";
import { campaignStages, ladderAdvanceState, contentOnPlatform, poolFor, campaignPendingEngagement } from "../js/campaign-metrics.js";
import {
  initStore, createBrand, createCampaign, createContent, getCampaign, completeCampaignStage,
  performanceCheckDue, performanceHasNumbers, campaignContentPlatform,
} from "../js/store.js";
import { mergeInsightsIntoPerformance } from "../js/retention.js";
import { brandTopAction } from "../js/next-action.js";
import { campaignDisplayName, setPlainLanguageResolver, setLang } from "../js/i18n.js";

const DAY = 86400000;
const isoDaysAgo = (n, now = Date.now()) => {
  const d = new Date(now - n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const followersOf = (mission) => mission.milestones.find((m) => m.metric === "profile.followers");

// ---------- 1. Level 1 auto-complete ----------

describe("placeStartSocialLevel: start at the tier still ahead of today's followers", () => {
  test("below the first checkpoint stays on Level 1 (index 0)", () => {
    assert.equal(placeStartSocialLevel({ followers: 0 }).index, 0);
    assert.equal(placeStartSocialLevel({ followers: 999 }).index, 0);
  });
  test("a reached checkpoint drops that tier — 1,000 and 1,500 start on the 3K tier", () => {
    assert.equal(placeStartSocialLevel({ followers: 1000 }).index, 1);
    assert.equal(placeStartSocialLevel({ followers: 1500 }).index, 1);
    assert.equal(placeStartSocialLevel({ followers: 12000 }).index, 3);
  });
  test("past the last checkpoint the last tier is it", () => {
    assert.equal(placeStartSocialLevel({ followers: 150000 }).index, 5);
  });
});

describe("buildSocialGrowthPlan: Level 1's Followers target is above today's count", () => {
  test("placed plan: 1,500 followers → first target 3,000", () => {
    const startIndex = placeStartSocialLevel({ followers: 1500 }).index;
    const { missions } = buildSocialGrowthPlan({ platform: "instagram", current: { followers: 1500 }, target: 10000, months: 12, uploadsPerWeek: 3, startIndex, content: [] });
    const f = followersOf(missions[0]);
    assert.equal(f.target, 3000);
    assert.ok(f.baseline < f.target);
  });
  test("even with a stale startIndex whose checkpoint is behind, Level 1 is never pre-met", () => {
    const { missions } = buildSocialGrowthPlan({ platform: "instagram", current: { followers: 1500 }, target: 10000, months: 12, uploadsPerWeek: 3, startIndex: 0, content: [] });
    assert.ok(followersOf(missions[0]).target > 1500);
  });
});

describe("ladderAdvanceState: the followers shortcut needs real growth", () => {
  const now = Date.now();
  const makeCampaign = ({ startFollowers, followersTarget = 1000, notApplicable = false }) => ({
    id: "c1", brandId: "b1", status: "active", createdAt: now - 3 * DAY, autoLinkAllContent: true,
    goalPlan: { version: 3, track: "social", platform: "instagram", current: { followers: startFollowers } },
    missions: [
      {
        id: "m1", name: "Mulai Ditemukan", completedAt: null,
        milestones: [
          { id: "f", key: "followers", metric: "profile.followers", label: "Followers", unit: "followers", target: followersTarget, required: true, highlight: true, notApplicable },
          { id: "p", key: "published", metric: "content.published", label: "Konten terbit di level ini", unit: "konten", target: 10, required: true, sinceStart: true },
        ],
      },
      { id: "m2", name: "Mulai Dikenal", completedAt: null, milestones: [] },
    ],
  });
  const brand = { id: "b1", insights: { instagram: { followers: 1500, updatedAt: now } }, insightsHistory: [] };
  const advance = (campaign) => {
    const stage = campaignStages(campaign)[0];
    return ladderAdvanceState(campaign, stage, { brand, campaign, content: [], settings: { platforms: [] } });
  };

  test("a target already reached when the campaign began does NOT finish Level 1 (the bug)", () => {
    assert.equal(advance(makeCampaign({ startFollowers: 1500, followersTarget: 1500 })).ready, false);
    assert.equal(advance(makeCampaign({ startFollowers: 1500, followersTarget: 1000 })).ready, false);
  });
  test("followers that grew past the target still finish the level on their own (#8)", () => {
    assert.equal(advance(makeCampaign({ startFollowers: 800, followersTarget: 1000 })).ready, true);
  });
  test("a not-applicable Followers milestone never finishes a level", () => {
    assert.equal(advance(makeCampaign({ startFollowers: 800, followersTarget: 1000, notApplicable: true })).ready, false);
  });
});

// ---------- 2. Content counts by platform ----------

describe("contentOnPlatform", () => {
  test("own platform field, case-insensitive", () => {
    assert.equal(contentOnPlatform({ platform: "TikTok" }, "tiktok"), true);
    assert.equal(contentOnPlatform({ platform: "Instagram" }, "tiktok"), false);
  });
  test("a platform it was ticked as uploaded to counts too (Creator's Selesai)", () => {
    assert.equal(contentOnPlatform({ platform: "", uploadedPlatforms: { tiktok: true, instagram: false } }, "tiktok"), true);
    assert.equal(contentOnPlatform({ platform: "", uploadedPlatforms: { tiktok: false } }, "tiktok"), false);
  });
  test("'other' (Lainnya): platforms outside Instagram/TikTok/Facebook, plus untagged content", () => {
    assert.equal(contentOnPlatform({ platform: "YouTube" }, "other"), true);
    assert.equal(contentOnPlatform({ platform: "LinkedIn" }, "other"), true);
    assert.equal(contentOnPlatform({ platform: "" }, "other"), true);
    assert.equal(contentOnPlatform({ platform: "Instagram" }, "other"), false);
    assert.equal(contentOnPlatform({ platform: "", uploadedPlatforms: { instagram: true } }, "other"), false);
    assert.equal(contentOnPlatform({ platform: "Instagram", uploadedPlatforms: { instagram: true, youtube: true } }, "other"), true);
  });
  test("untagged content still counts toward no named-platform campaign", () => {
    assert.equal(contentOnPlatform({ platform: "" }, "instagram"), false);
  });
});

describe("poolFor: a TikTok campaign counts TikTok uploads", () => {
  test("content ticked as uploaded to TikTok is in the TikTok pool, Instagram-only is not", () => {
    const campaign = { id: "c", autoLinkAllContent: true, goalPlan: { version: 3, track: "social", platform: "tiktok" } };
    const content = [
      { id: "a", platform: "", uploadedPlatforms: { tiktok: true } },
      { id: "b", platform: "TikTok" },
      { id: "c", platform: "Instagram" },
    ];
    assert.deepEqual(poolFor({ campaign, content }, {}).map((c) => c.id), ["a", "b"]);
  });
});

describe("campaignContentPlatform + createContent: drafts made for a campaign carry its platform", () => {
  let brand;
  before(async () => {
    await initStore("test-uid-goal-ladder");
    brand = createBrand({ name: "Kopi Senja" });
  });
  test("spelled like Pengaturan; canonical name when Pengaturan doesn't list it; '' for Lainnya; null for non-social", () => {
    const social = (platform) => ({ goalPlan: { version: 3, track: "social", platform } });
    assert.equal(campaignContentPlatform(social("tiktok"), { platforms: [{ id: "x1", name: "TikTok" }] }), "TikTok");
    assert.equal(campaignContentPlatform(social("facebook"), { platforms: [] }), "Facebook");
    assert.equal(campaignContentPlatform(social("other"), { platforms: [] }), "");
    assert.equal(campaignContentPlatform({ goalPlan: { version: 3, track: "community" } }, { platforms: [] }), null);
    assert.equal(campaignContentPlatform({ eventPlan: {} }, { platforms: [] }), null);
  });
  test("a chat draft (no platform) for a TikTok campaign becomes TikTok and counts there", () => {
    const camp = createCampaign(brand.id, { name: "Social Media Growth (TikTok) Kopi Senja", autoLinkAllContent: true, goalPlan: { version: 3, track: "social", platform: "tiktok" } });
    const draft = createContent(brand.id, { title: "Ide", status: "idea", campaignId: camp.id });
    assert.equal(draft.platform, "TikTok");
    assert.ok(poolFor({ campaign: camp, content: [draft] }, {}).includes(draft));
  });
  test("an explicit platform is never overwritten; non-social campaigns are left alone", () => {
    const camp = createCampaign(brand.id, { goalPlan: { version: 3, track: "social", platform: "tiktok" } });
    assert.equal(createContent(brand.id, { platform: "Instagram", campaignId: camp.id }).platform, "Instagram");
    const community = createCampaign(brand.id, { goalPlan: { version: 3, track: "community" } });
    assert.equal(createContent(brand.id, { campaignId: community.id }).platform, "");
    const other = createCampaign(brand.id, { goalPlan: { version: 3, track: "social", platform: "other" } });
    const d = createContent(brand.id, { campaignId: other.id });
    assert.equal(d.platform, "");
    assert.ok(poolFor({ campaign: other, content: [d] }, {}).includes(d));
  });
});

// ---------- 3. Performance asks ----------

describe("performanceCheckDue: at most twice per post, never after ~30 days", () => {
  const now = new Date("2026-10-05T12:00:00").getTime();
  const pub = (daysAgo, confirmedDaysAfterPublish = null) => {
    const publishedDate = isoDaysAgo(daysAgo, now);
    const pubMs = new Date(publishedDate + "T00:00:00").getTime();
    return { status: "published", publishedDate, performance: { confirmedAt: confirmedDaysAfterPublish === null ? null : pubMs + confirmedDaysAfterPublish * DAY } };
  };
  test("not asked before ~2 days", () => {
    assert.equal(performanceCheckDue(pub(1), now), false);
  });
  test("first ask from day 2 until it's filled in", () => {
    assert.equal(performanceCheckDue(pub(3), now), true);
    assert.equal(performanceCheckDue(pub(5, 2.5), now), false);
  });
  test("second ask at day 7 when the last check was before it", () => {
    assert.equal(performanceCheckDue(pub(8, 3), now), true);
    assert.equal(performanceCheckDue(pub(8, 7.5), now), false);
  });
  test("checked after day 7 → never asked again, no weekly re-queue", () => {
    assert.equal(performanceCheckDue(pub(20, 8), now), false);
  });
  test("posts older than ~30 days are never asked, even if never filled", () => {
    assert.equal(performanceCheckDue(pub(31), now), false);
    assert.equal(performanceCheckDue(pub(60), now), false);
  });
  test("only published content is asked", () => {
    assert.equal(performanceCheckDue({ ...pub(3), status: "scheduled" }, now), false);
  });
});

describe("campaignPendingEngagement follows the same rule", () => {
  test("old and freshly-checked posts drop out of a campaign's 'Isi performa' list", () => {
    const now = Date.now();
    const campaign = { id: "c", autoLinkAllContent: true, goalPlan: { version: 3, track: "social", platform: "instagram" } };
    const content = [
      { id: "due", status: "published", platform: "Instagram", publishedDate: isoDaysAgo(3, now), performance: {} },
      { id: "old", status: "published", platform: "Instagram", publishedDate: isoDaysAgo(45, now), performance: {} },
      { id: "done", status: "published", platform: "Instagram", publishedDate: isoDaysAgo(10, now), performance: { confirmedAt: now - DAY } },
    ];
    assert.deepEqual(campaignPendingEngagement(campaign, { campaign, content }).map((c) => c.id), ["due"]);
  });
});

describe("an empty performance save is not a check", () => {
  test("performanceHasNumbers", () => {
    assert.equal(performanceHasNumbers({ views: null, likes: null, confirmedAt: null }), false);
    assert.equal(performanceHasNumbers({ views: "" }), false);
    assert.equal(performanceHasNumbers({ views: 0 }), true);
    assert.equal(performanceHasNumbers({ retention: { hookPct: 40 } }), true);
  });
  test("a screenshot reading that found nothing doesn't stamp confirmedAt", () => {
    assert.equal(mergeInsightsIntoPerformance({ views: null }, { metrics: {} }).confirmedAt, undefined);
    assert.ok(mergeInsightsIntoPerformance({}, { metrics: { views: 120 } }).confirmedAt > 0);
  });
});

// ---------- 4. Finished ladders ----------

describe("completeCampaignStage + brandTopAction: a finished ladder stops driving Beranda", () => {
  let brand;
  before(async () => {
    await initStore("test-uid-goal-ladder-complete");
    brand = createBrand({ name: "Kopi Senja" });
  });
  const ladder = () => createCampaign(brand.id, {
    name: "Social Media Growth (Instagram) Kopi Senja", status: "active", autoLinkAllContent: true,
    goalPlan: { version: 3, track: "social", platform: "instagram", current: { followers: 100 } },
    missions: [
      { id: "l1", name: "Mulai Ditemukan", completedAt: null, milestones: [{ id: "p1", metric: "content.published", label: "Konten terbit di level ini", target: 5, required: true }] },
      { id: "l2", name: "Mulai Dikenal", completedAt: null, milestones: [{ id: "p2", metric: "content.published", label: "Konten terbit di level ini", target: 5, required: true }] },
    ],
  });
  test("a middle level keeps the campaign running; the last one completes it", () => {
    const c = ladder();
    completeCampaignStage(c.id, 0);
    assert.equal(getCampaign(c.id).status, "active");
    completeCampaignStage(c.id, 1);
    assert.equal(getCampaign(c.id).status, "completed");
  });
  test("brandTopAction ignores a completed ladder", () => {
    const running = ladder();
    const settings = { platforms: [], formats: [], thresholds: {} };
    assert.ok(brandTopAction({ brand, campaigns: [running], content: [], settings }));
    completeCampaignStage(running.id, 0);
    completeCampaignStage(running.id, 1);
    assert.equal(brandTopAction({ brand, campaigns: [getCampaign(running.id)], content: [], settings }), null);
  });
  test("a ladder finished before this fix (every level done, status still active) is skipped too", () => {
    const old = ladder();
    old.missions.forEach((m) => (m.completedAt = Date.now()));
    assert.equal(old.status, "active");
    assert.equal(brandTopAction({ brand, campaigns: [old], content: [], settings: { platforms: [], formats: [], thresholds: {} } }), null);
  });
});

// ---------- 6. Plain campaign names in Pemula ----------

describe("campaignDisplayName", () => {
  after(() => setPlainLanguageResolver(() => false));
  test("Pemula (id): the Grow Brand prefix reads in Indonesian, the rest untouched", () => {
    setLang("id");
    setPlainLanguageResolver(() => true);
    assert.equal(campaignDisplayName("Social Media Growth (Instagram) Kopi Senja"), "Tumbuh di Sosmed (Instagram) Kopi Senja");
    assert.equal(campaignDisplayName("Community Growth Kopi Senja"), "Bangun Komunitas Kopi Senja");
    assert.equal(campaignDisplayName("Sales Growth Kopi Senja"), "Naikkan Penjualan Kopi Senja");
  });
  test("owner-typed names and Pro are left exactly as stored", () => {
    setPlainLanguageResolver(() => true);
    assert.equal(campaignDisplayName("Social Media Growthhack"), "Social Media Growthhack");
    assert.equal(campaignDisplayName("Promo Ramadan"), "Promo Ramadan");
    setPlainLanguageResolver(() => false);
    assert.equal(campaignDisplayName("Social Media Growth (Instagram) Kopi Senja"), "Social Media Growth (Instagram) Kopi Senja");
  });
});
