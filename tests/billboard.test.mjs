import { test } from "node:test";
import assert from "node:assert/strict";
import { cardOf, cardsOf, loadBillboard } from "../api/_billboard.js";

const post = (slug, at, extra = {}) => ({ id: slug, slug, title: `Judul ${slug}`, excerpt: "Ringkas", coverImageUrl: "https://cdn.test/a.jpg", category: "news", publishedAt: at, readMinutes: 2, ...extra });

test("a Billboard card keeps plain fields and links to the story on wepeka.com", () => {
  const c = cardOf(post("unilever-moty", "2026-11-24T00:00:00+00:00"));
  assert.equal(c.url, "https://www.wepeka.com/community/billboard/unilever-moty");
  assert.equal(c.cover, "https://cdn.test/a.jpg");
  assert.equal(c.publishedAt, "2026-11-24T00:00:00.000Z");
  // A cover that isn't https, a slug that could leave the path, a missing title: refused.
  assert.equal(cardOf(post("x", "2026-11-24", { coverImageUrl: "javascript:alert(1)" })).cover, "");
  assert.equal(cardOf(post("../admin", "2026-11-24")), null);
  assert.equal(cardOf(post("ok", "2026-11-24", { title: "  " })), null);
});

test("cards come newest first, once each, at most 12", () => {
  const many = Array.from({ length: 15 }, (_, i) => post(`s-${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
  const out = cardsOf({ posts: [...many, many[3]] });
  assert.equal(out.length, 12);
  assert.equal(out[0].id, "s-14");
  assert.equal(new Set(out.map((c) => c.id)).size, 12);
  assert.deepEqual(cardsOf(null), []);
});

test("reads the live wall first, the archive while /latest isn't on wepeka.com yet, and never throws", async () => {
  const calls = [];
  const fake = (routes) => async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  };
  const live = await loadBillboard({ fetchImpl: fake({ "/api/billboard/latest": { posts: [post("a", "2026-11-24")] } }) });
  assert.equal(live.source, "latest");
  assert.equal(live.posts.length, 1);
  const old = await loadBillboard({ fetchImpl: fake({ "/api/billboard/feed": { posts: [post("b", "2026-10-20")] } }) });
  assert.equal(old.source, "archive");
  const none = await loadBillboard({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual([none.source, none.posts.length], ["none", 0]);
});
