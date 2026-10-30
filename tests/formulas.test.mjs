import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateFormula,
  evaluateFormula,
  rateValue,
  isHealthy,
  resolveThresholds,
  computeContentMetrics,
} from "../js/formulas.js";
import { DEFAULT_ER_FORMULA, upgradeFormulas } from "../js/store.js";

describe("evaluateFormula", () => {
  const engagementRate = "(likes + comments + shares + saves) / reach * 100";
  const followerConversionRate = "followersGained / reach * 100";

  test("known-input engagement rate", () => {
    const metrics = { likes: 40, comments: 5, shares: 3, saves: 2, reach: 1000 };
    assert.equal(evaluateFormula(engagementRate, metrics), 5);
  });

  test("known-input follower conversion rate", () => {
    const metrics = { followersGained: 10, reach: 2000 };
    assert.equal(evaluateFormula(followerConversionRate, metrics), 0.5);
  });

  test("division by zero (reach = 0) yields null, not Infinity", () => {
    const metrics = { likes: 10, comments: 0, shares: 0, saves: 0, reach: 0 };
    assert.equal(evaluateFormula(engagementRate, metrics), null);
  });

  test("a missing metric the formula depends on yields null", () => {
    const metrics = { likes: 10, comments: 5, shares: 0 /* saves, reach missing */ };
    assert.equal(evaluateFormula(engagementRate, metrics), null);
  });

  test("an empty-string metric counts as missing", () => {
    const metrics = { likes: 10, comments: 5, shares: 0, saves: 0, reach: "" };
    assert.equal(evaluateFormula(engagementRate, metrics), null);
  });

  test("reposts are part of the default engagement rate", () => {
    const metrics = { likes: 40, comments: 5, shares: 3, saves: 2, reposts: 10, reach: 1000 };
    assert.equal(evaluateFormula(DEFAULT_ER_FORMULA, metrics), 6);
  });

  test("a post without a reposts number keeps its engagement rate (reposts = 0)", () => {
    for (const reposts of [undefined, null, ""]) {
      const metrics = { likes: 40, comments: 5, shares: 3, saves: 2, reposts, reach: 1000 };
      assert.equal(evaluateFormula(DEFAULT_ER_FORMULA, metrics), 5);
    }
    // ...but the numbers that are not optional still have to be there.
    assert.equal(evaluateFormula(DEFAULT_ER_FORMULA, { likes: 40, comments: 5, shares: 3, reposts: 4, reach: 1000 }), null);
  });

  test("accounts that saved the old default ER formula get the one with reposts", () => {
    const fcr = "followersGained / reach * 100";
    assert.equal(upgradeFormulas({ engagementRate: "(likes + comments + shares + saves) / reach * 100", followerConversionRate: fcr }).engagementRate, DEFAULT_ER_FORMULA);
    assert.equal(upgradeFormulas({ engagementRate: "(likes+comments+shares+saves)/reach*100" }).engagementRate, DEFAULT_ER_FORMULA);
    // A formula someone wrote themselves is left alone.
    assert.equal(upgradeFormulas({ engagementRate: "likes / reach * 100" }).engagementRate, "likes / reach * 100");
    assert.equal(upgradeFormulas({ engagementRate: "(likes + comments + shares + saves) / views * 100" }).engagementRate, "(likes + comments + shares + saves) / views * 100");
  });

  test("rejects an invalid/unknown-variable expression up front", () => {
    const check = validateFormula("likes + doesNotExist");
    assert.equal(check.valid, false);
  });
});

describe("rateValue (health rating thresholds)", () => {
  const threshold = { good: 8, average: 4 };
  const erScale = { excellent: 10, good: 8, average: 4 };

  test("at or above 'good' floor rates good", () => {
    assert.equal(rateValue(8, threshold), "good");
    assert.equal(rateValue(20, threshold), "good");
  });

  test("between 'average' and 'good' floors rates average", () => {
    assert.equal(rateValue(4, threshold), "average");
    assert.equal(rateValue(7.9, threshold), "average");
  });

  test("below 'average' floor rates poor", () => {
    assert.equal(rateValue(0, threshold), "poor");
    assert.equal(rateValue(3.9, threshold), "poor");
  });

  test("null value or missing threshold yields null rating", () => {
    assert.equal(rateValue(null, threshold), null);
    assert.equal(rateValue(5, null), null);
    assert.equal(rateValue(5, undefined), null);
  });

  test("the ER scale: 10%+ excellent, 8–10 good, 4–8 average, under 4 poor", () => {
    assert.equal(rateValue(10, erScale), "excellent");
    assert.equal(rateValue(25, erScale), "excellent");
    assert.equal(rateValue(9.9, erScale), "good");
    assert.equal(rateValue(8, erScale), "good");
    assert.equal(rateValue(7.9, erScale), "average");
    assert.equal(rateValue(4, erScale), "average");
    assert.equal(rateValue(3.9, erScale), "poor");
  });

  test("rates the value as shown: 9.96% reads 10.0% and rates excellent", () => {
    assert.equal(rateValue(9.96, erScale), "excellent");
    assert.equal(rateValue(9.94, erScale), "good");
  });

  test("isHealthy counts good and excellent", () => {
    assert.equal(isHealthy("excellent"), true);
    assert.equal(isHealthy("good"), true);
    assert.equal(isHealthy("average"), false);
    assert.equal(isHealthy(null), false);
  });
});

describe("resolveThresholds / computeContentMetrics", () => {
  const settings = {
    formulas: {
      engagementRate: "(likes + comments + shares + saves) / reach * 100",
      followerConversionRate: "followersGained / reach * 100",
    },
    thresholds: {
      TOFU: { followerConversionRate: { good: 1, average: 0.3 } },
    },
    thresholdsByPlatform: {
      TikTok: { TOFU: { followerConversionRate: { good: 2, average: 1 } } },
    },
  };

  test("falls back to shared defaults when no per-platform override exists", () => {
    const th = resolveThresholds(settings, "TOFU", "Instagram");
    assert.deepEqual(th, settings.thresholds.TOFU);
  });

  test("a matching per-platform override wins over the shared default", () => {
    const th = resolveThresholds(settings, "TOFU", "TikTok");
    assert.deepEqual(th, settings.thresholdsByPlatform.TikTok.TOFU);
  });

  test("computeContentMetrics: health follows the ER rating", () => {
    const content = { platform: "Instagram", funnel: "TOFU", performance: { likes: 40, comments: 5, shares: 3, saves: 2, reach: 1000, followersGained: 10 } };
    const result = computeContentMetrics(content, settings);
    assert.equal(result.engagementRate, 5);
    assert.equal(result.erRating, "average"); // 5 is between average(4) and good(8)
    assert.equal(result.followerConversionRate, 1);
    assert.equal(result.fcrRating, "good");
    assert.equal(result.health, "average");
  });

  test("a 12% ER stays excellent even with zero followers gained", () => {
    const content = { platform: "Instagram", funnel: "BOFU", performance: { likes: 100, comments: 10, shares: 5, saves: 5, reach: 1000, followersGained: 0 } };
    const result = computeContentMetrics(content, settings);
    assert.equal(result.engagementRate, 12);
    assert.equal(result.erRating, "excellent");
    assert.equal(result.health, "excellent");
  });

  test("TikTok without reach divides by views; other platforms don't", () => {
    const perf = { likes: 70, comments: 5, shares: 3, saves: 2, views: 1000, followersGained: 5 };
    const tt = computeContentMetrics({ platform: "TikTok", funnel: "TOFU", performance: perf }, settings);
    assert.equal(tt.engagementRate, 8);
    assert.equal(tt.followerConversionRate, 0.5);
    const ig = computeContentMetrics({ platform: "Instagram", funnel: "TOFU", performance: perf }, settings);
    assert.equal(ig.engagementRate, null);
    // A reach number, when there is one, still wins.
    const withReach = computeContentMetrics({ platform: "TikTok", funnel: "TOFU", performance: { ...perf, reach: 500 } }, settings);
    assert.equal(withReach.engagementRate, 16);
  });

  test("the ER scale is the same for every funnel and platform", () => {
    const perf = { likes: 70, comments: 5, shares: 3, saves: 2, reach: 1000 }; // 8%
    for (const funnel of ["TOFU", "MOFU", "BOFU", undefined]) {
      for (const platform of ["Instagram", "TikTok"]) {
        assert.equal(computeContentMetrics({ platform, funnel, performance: perf }, settings).erRating, "good");
      }
    }
  });

  test("an account's own erScale wins over the default", () => {
    const perf = { likes: 70, comments: 5, shares: 3, saves: 2, reach: 1000 }; // 8%
    const custom = { ...settings, erScale: { excellent: 8, good: 6, average: 3 } };
    assert.equal(computeContentMetrics({ funnel: "TOFU", performance: perf }, custom).erRating, "excellent");
  });

  test("computeContentMetrics with no performance data yields null ratings/health", () => {
    const content = { platform: "Instagram", funnel: "TOFU", performance: {} };
    const result = computeContentMetrics(content, settings);
    assert.equal(result.engagementRate, null);
    assert.equal(result.erRating, null);
    assert.equal(result.health, null);
  });
});
