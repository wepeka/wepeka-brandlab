import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  validateFormula,
  evaluateFormula,
  rateValue,
  overallHealth,
  resolveThresholds,
  computeContentMetrics,
} from "../js/formulas.js";

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

  test("rejects an invalid/unknown-variable expression up front", () => {
    const check = validateFormula("likes + doesNotExist");
    assert.equal(check.valid, false);
  });
});

describe("rateValue / overallHealth (health rating thresholds)", () => {
  const threshold = { good: 8, average: 4 };

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
    assert.equal(rateValue(3.99, threshold), "poor");
  });

  test("null value or missing threshold yields null rating", () => {
    assert.equal(rateValue(null, threshold), null);
    assert.equal(rateValue(5, null), null);
    assert.equal(rateValue(5, undefined), null);
  });

  test("overallHealth takes the worse of the two available ratings", () => {
    assert.equal(overallHealth("good", "poor"), "poor");
    assert.equal(overallHealth("average", "good"), "average");
    assert.equal(overallHealth("good", "good"), "good");
  });

  test("overallHealth falls back to whichever single rating exists", () => {
    assert.equal(overallHealth("average", null), "average");
    assert.equal(overallHealth(null, "poor"), "poor");
  });

  test("overallHealth is null when neither rating is available", () => {
    assert.equal(overallHealth(null, null), null);
  });
});

describe("resolveThresholds / computeContentMetrics", () => {
  const settings = {
    formulas: {
      engagementRate: "(likes + comments + shares + saves) / reach * 100",
      followerConversionRate: "followersGained / reach * 100",
    },
    thresholds: {
      TOFU: { engagementRate: { good: 8, average: 4 }, followerConversionRate: { good: 1, average: 0.3 } },
    },
    thresholdsByPlatform: {
      TikTok: { TOFU: { engagementRate: { good: 10, average: 5 } } },
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

  test("computeContentMetrics rates a healthy piece of content 'good'", () => {
    const content = { platform: "Instagram", funnel: "TOFU", performance: { likes: 40, comments: 5, shares: 3, saves: 2, reach: 1000, followersGained: 10 } };
    const result = computeContentMetrics(content, settings);
    assert.equal(result.engagementRate, 5);
    assert.equal(result.erRating, "average"); // 5 is between average(4) and good(8)
    assert.equal(result.followerConversionRate, 1);
    assert.equal(result.fcrRating, "good");
    assert.equal(result.health, "average"); // worse of average/good
  });

  test("computeContentMetrics with no performance data yields null ratings/health", () => {
    const content = { platform: "Instagram", funnel: "TOFU", performance: {} };
    const result = computeContentMetrics(content, settings);
    assert.equal(result.engagementRate, null);
    assert.equal(result.erRating, null);
    assert.equal(result.health, null);
  });
});
