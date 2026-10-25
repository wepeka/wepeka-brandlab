// GA4 page views (js/analytics.js routePath) carry the route's names only:
// no ids, no query, and no board guest key — which can be all letters.
import { test } from "node:test";
import assert from "node:assert/strict";

const { routePath } = await import("../js/analytics.js");

test("page paths keep route names and drop ids, queries and board keys", () => {
  assert.equal(routePath("#/brand/abc123xyz9/content?x=1"), "/app/brand/content");
  assert.equal(routePath("#/brand/abc123xyz9/papan/b0ard12345"), "/app/brand/papan");
  assert.equal(routePath("#/brand/abc123xyz9/papan/b0ard12345/abcdefghijklmnopqrstuvwx"), "/app/brand/papan");
  assert.equal(routePath("#/settings/team"), "/app/settings/team");
});
