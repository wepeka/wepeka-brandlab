import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { contentOnPlatform, platformLink, platformCard } from "../js/platforms.js";

const reel = {
  id: "a", platform: "Instagram", status: "published",
  uploadedPlatforms: { instagram: true, tiktok: true },
  performance: { views: 1000, likes: 50 },
  crossPostPerformance: { tiktok: { views: 400, likes: 20, confirmedAt: 1 } },
};
const igOnly = { id: "b", platform: "Instagram", status: "published", uploadedPlatforms: { instagram: true, tiktok: false }, performance: { views: 300 } };
const tickedNoNumbers = { id: "c", platform: "Instagram", status: "published", uploadedPlatforms: { tiktok: true }, performance: { views: 10 } };
const tt = { id: "d", platform: "TikTok", status: "published", performance: { views: 90 } };

describe("platforms", () => {
  test("a ticked upload puts a piece on that card", () => {
    assert.equal(platformLink(reel, platformCard("tiktok")), "tiktok");
    assert.equal(platformLink(reel, platformCard("reels")), "");
    assert.equal(platformLink(igOnly, platformCard("tiktok")), null);
  });

  test("one platform: that platform's numbers only", () => {
    const list = contentOnPlatform([reel, igOnly, tickedNoNumbers, tt], "tiktok");
    assert.deepEqual(list.map((c) => c.id), ["a", "c", "d"]);
    assert.equal(list[0].performance.views, 400);
    assert.equal(list[0].platform, "TikTok");
    assert.deepEqual(list[1].performance, {});
  });

  test("Gabungan adds a crosspost with numbers, once per platform", () => {
    const list = contentOnPlatform([reel, igOnly, tickedNoNumbers, tt], "all");
    const views = list.reduce((a, c) => a + (c.performance.views || 0), 0);
    assert.equal(views, 1000 + 400 + 300 + 10 + 90);
    assert.equal(list.filter((c) => c.id === "a").length, 2);
    assert.equal(list.filter((c) => c.id === "c").length, 1);
  });
});
