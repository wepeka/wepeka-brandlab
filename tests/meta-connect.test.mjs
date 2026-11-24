// "Hubungkan akun Meta" (api/instagram/[action].js): Facebook Login for
// Business and Instagram Login, the vault, picking accounts per brand,
// roles, the nightly sync (Instagram, Page, ad spend → Sales), Meta's
// callbacks, and posting from the vault (api/instagram/post.js,
// api/_igPostRun.js). In-memory Firestore and a fake Meta: no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import * as V from "../api/_metaVault.js";
import * as IG from "../api/_instagram.js";
import * as FB from "../api/_facebookLogin.js";
import { route, canManage, canSync } from "../api/instagram/[action].js";
import { postingAccounts } from "../api/_metaConnection.js";
import { pieceFor, postersOf } from "../api/instagram/post.js";
import { postersFor } from "../api/_igPostRun.js";
import { presetPerms } from "../api/_permissions.js";
import { METRIC_KEYS as CLIENT_METRIC_KEYS } from "../js/store.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 24, 5); // 24 Nov 2026, 12:00 WIB
const KEY = crypto.randomBytes(32).toString("base64");
const FB_SECRET = "fb-secret";
const IG_SECRET = "ig-secret";
const IG_ID = "17841400000000001";
const IG_ID2 = "17841400000000002";
const ADMIN = "iSwfTtIQm6VkYoHFbI6wl7BzBF53";

// ---------- a small Firestore fake ----------
function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([p, d]) => [p, structuredClone(d)]));
  const setDotted = (obj, path, val) => {
    const parts = path.split(".");
    let cur = obj;
    parts.slice(0, -1).forEach((p) => {
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    });
    cur[parts.at(-1)] = structuredClone(val);
  };
  const snapOf = (path) => ({ exists: docs.has(path), id: path.split("/").pop(), data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined) });
  const doc = (path) => ({
    path,
    id: path.split("/").pop(),
    get: async () => snapOf(path),
    set: async (data, opts) => void docs.set(path, opts?.merge && docs.has(path) ? { ...docs.get(path), ...structuredClone(data) } : structuredClone(data)),
    update: async (patch) => {
      if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`);
      const cur = docs.get(path);
      Object.entries(patch).forEach(([k, v]) => setDotted(cur, k, v));
    },
    delete: async () => void docs.delete(path),
  });
  const collection = (name) => {
    const filters = [];
    const depth = name.split("/").length + 1;
    const q = {
      doc: (id) => doc(`${name}/${id}`),
      where: (f, op, v) => (filters.push([f, op, v]), q),
      get: async () => ({
        docs: [...docs.entries()]
          .filter(([p]) => p.startsWith(`${name}/`) && p.split("/").length === depth)
          .filter(([, d]) => filters.every(([f, op, v]) => (op === "array-contains" ? (d[f] || []).includes(v) : op === "in" ? v.includes(d[f]) : d[f] === v)))
          .map(([p, d]) => ({ id: p.split("/").pop(), data: () => structuredClone(d) })),
      }),
    };
    return q;
  };
  const runTransaction = async (fn) => fn({ get: (ref) => ref.get(), set: (ref, data) => ref.set(data), update: (ref, patch) => ref.update(patch) });
  return { docs, doc, collection, runTransaction, get: (p) => (docs.has(p) ? structuredClone(docs.get(p)) : undefined) };
}

// ---------- a fake Meta ----------
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function fakeMeta({ tokenType = "system", media = [], insights = {}, dead = false, adCurrency = "IDR", ads = null, hiddenAssets = false, pageVideos = [] } = {}) {
  const calls = [];
  // A system user's /me/accounts hands out Page tokens too.
  const fbTokens = tokenType === "system" ? ["BISU", "PAGE1"] : ["FB-LONG", "PAGE1"];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const token = url.searchParams.get("access_token");
    const p = url.pathname;
    if (url.hostname === "api.instagram.com" && p === "/oauth/access_token") {
      const form = new URLSearchParams(init.body);
      if (form.get("code") !== "good-ig") return json({ error_message: "bad code" }, 400);
      return json({ data: [{ access_token: "IG-SHORT", user_id: "igapp1", permissions: IG.IG_SCOPES.join(",") }] });
    }
    if (url.hostname === "graph.instagram.com") {
      if (p === "/access_token") return json({ access_token: "IG-LONG", expires_in: (60 * DAY) / 1000 });
      if (p === "/refresh_access_token") return json({ access_token: "IG-LONG2", expires_in: (60 * DAY) / 1000 });
      if (dead) return json({ error: { message: "Error validating access token", code: 190 } }, 400);
      assert.ok(["IG-LONG", "IG-LONG2"].includes(token), `instagram host with ${token}`);
      const q = p.replace(/^\/v27\.0/, "");
      if (q === "/me") return json({ user_id: IG_ID, id: "igapp1", username: "kopipagi", account_type: "BUSINESS" });
      return igAnswer(q, url);
    }
    assert.equal(url.hostname, "graph.facebook.com", `unexpected host ${url}`);
    assert.ok(p.startsWith("/v27.0/"), `versioned: ${p}`);
    const q = p.slice("/v27.0".length);
    if (q === "/oauth/access_token") {
      if (url.searchParams.get("grant_type") === "fb_exchange_token") return json({ access_token: "FB-LONG", token_type: "bearer", expires_in: 5183944 });
      if (url.searchParams.get("code") !== "good-fb") return json({ error: { message: "bad code", code: 100 } }, 400);
      return json({ access_token: tokenType === "system" ? "BISU" : "FB-SHORT", token_type: "bearer" });
    }
    if (q === "/debug_token") {
      assert.equal(token, `fb-app|${FB_SECRET}`);
      // hiddenAssets: what happened live on 2026-11-25 — a Page (and its
      // Instagram) and an ad account ticked in Meta's window that the /me
      // lists leave out; only granular_scopes names them.
      const granular = hiddenAssets ? [
        { scope: "pages_show_list", target_ids: ["5550001", "5550009"] },
        { scope: "instagram_basic", target_ids: [IG_ID, "17841400000000099"] },
        { scope: "ads_read", target_ids: ["111", "222"] },
      ] : [];
      return json({ data: { is_valid: true, scopes: FB.FB_PERMISSIONS, granular_scopes: granular, expires_at: tokenType === "system" ? 0 : Math.floor((NOW + 60 * DAY) / 1000) } });
    }
    if (dead) return json({ error: { message: "Error validating access token", code: 190 } }, 400);
    if (q === "/me") {
      const fields = (url.searchParams.get("fields") || "").split(",");
      // What Meta really does (seen live 2026-11-25): a user token asking for
      // client_business_id gets the whole request refused.
      if (tokenType !== "system" && fields.includes("client_business_id")) {
        return json({ error: { message: "(#190) The client_business_id field can only be accessed using a Business Integration System User access token.", code: 190 } }, 400);
      }
      const all = tokenType === "system" ? { id: "sys1", client_business_id: "cb1" } : { id: "fbuser1", name: "Winson" };
      return json(Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k))));
    }
    if (q === "/me/accounts") return json({ data: [{ id: "5550001", name: "Kopi Pagi", access_token: "PAGE1", instagram_business_account: { id: IG_ID, username: "kopipagi" } }], paging: {} });
    if (q === "/me/assigned_instagram_accounts") return json({ data: [{ id: IG_ID2, username: "kopipagi.store" }], paging: {} });
    if (q === "/me/adaccounts") return json({ data: [{ id: "act_111", account_id: "111", name: "Iklan Kopi", currency: adCurrency, account_status: 1 }], paging: {} });
    assert.ok(fbTokens.includes(token), `facebook host with ${token} for ${q}`);
    if (q === "/5550001") return json({ name: "Kopi Pagi", followers_count: 800 });
    if (q === "/5550009") return json({ id: "5550009", name: "Kopi Pagi Store", access_token: "PAGE9", instagram_business_account: { id: "17841400000000099", username: "kopipagi.store2" } });
    if (q === "/act_222") return json({ id: "act_222", account_id: "222", name: "Iklan Store", currency: "IDR", account_status: 1 });
    if (q === "/5550001/insights") return url.searchParams.get("metric") === "page_total_media_view_unique" ? json({ data: [{ name: "page_total_media_view_unique", values: [{ value: 4000 }] }] }) : json({ error: { message: "bad metric", code: 100 } }, 400);
    if (q === "/5550001/video_reels") return json({ data: pageVideos, paging: {} });
    if (q === "/5550001/videos") return json({ data: [], paging: {} });
    if (/^\/fbv\d+$/.test(q)) return json(url.searchParams.get("fields") === "blue_reels_play_count" ? { blue_reels_play_count: 777 } : { likes: { summary: { total_count: 25 } }, comments: { summary: { total_count: 5 } } });
    if (q === "/9990001") return json(url.searchParams.get("fields") === "blue_reels_play_count" ? { blue_reels_play_count: 321 } : { likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } } });
    if (q === "/act_111/ads") return json({ data: [{ id: "ad1", name: "Promo", creative: { effective_instagram_media_id: "m1" } }, { id: "ad2", name: "Lain", creative: { effective_instagram_media_id: "zzz" } }], paging: {} });
    if (q === "/act_111/insights") {
      return json({ data: ads || [
        { ad_id: "ad1", spend: "150000.40", impressions: "10000", clicks: "300", actions: [{ action_type: "omni_purchase", value: "4" }], action_values: [{ action_type: "omni_purchase", value: "600000" }], date_start: "2026-11-01" },
        { ad_id: "ad1", spend: "50000", impressions: "4000", clicks: "90", date_start: "2026-10-01" },
        { ad_id: "ad2", spend: "9000", impressions: "100", clicks: "1", date_start: "2026-11-01" },
      ], paging: {} });
    }
    return igAnswer(q, url);
  };
  function igAnswer(q, url) {
    if (q === `/${IG_ID}/media` || q === `/${IG_ID2}/media`) return json({ data: media, paging: {} });
    if (q === `/${IG_ID}/insights`) return json({ data: [{ name: "reach", total_value: { value: 5000 } }] });
    if (q === `/${IG_ID}`) return json({ username: "kopipagi", followers_count: 1200, media_count: media.length });
    const m = q.match(/^\/(\w+)\/insights$/);
    if (m) {
      const names = url.searchParams.get("metric").split(",");
      const values = insights[m[1]] || {};
      return json({ data: names.filter((n) => n in values).map((n) => ({ name: n, values: [{ value: values[n] }] })) });
    }
    return json({ error: { message: `unknown ${q}`, code: 100 } }, 400);
  }
  return { fetch, calls };
}

function res() {
  const r = { statusCode: 200, headers: {}, body: undefined, location: null };
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.send = (b) => ((r.body = b), r);
  r.redirect = (c, url) => ((r.statusCode = c), (r.location = url), r);
  return r;
}
const ENV = { META_APP_ID: "fb-app", META_APP_SECRET: FB_SECRET, META_LOGIN_CONFIG_ID: "cfg-1", IG_APP_ID: "ig-app", IG_APP_SECRET: IG_SECRET, IG_TOKEN_KEY: KEY, CRON_SECRET: "cron" };
function deps(db, meta, { env = {}, now = NOW } = {}) {
  let n = 0;
  return {
    db, fetch: meta.fetch, now: () => now,
    env: { ...ENV, ...env },
    verify: async (req) => {
      if (!req.headers?.authorization) throw new Error("no auth");
      return { uid: req.headers.authorization.replace("Bearer ", "") };
    },
    newId: () => `new-${++n}`,
  };
}
const post = (action, body, uid = "owner1") => ({ method: "POST", query: { action }, headers: { authorization: `Bearer ${uid}` }, body });
const call = async (d, req) => {
  const r = res();
  await route(d, req, r);
  return r;
};
const ACTIVE = { status: "active", plan: "pro" };
const member = (preset, extra = {}) => ({ role: "editor", preset, p: presetPerms(preset), ...extra });
const BRAND = {
  id: "b1", name: "Kopi Pagi", ownerId: "owner1",
  memberIds: ["adm1", "smm1", "cc1", "kl1", "off1"],
  members: { adm1: member("admin"), smm1: member("smm"), cc1: member("creator"), kl1: { ...member("klien"), role: "viewer", klien: true }, off1: member("admin", { disabled: true }) },
  instagram: { igUserId: "", connected: false },
};
const seed = (extra = {}) => fakeDb({
  "brands/b1": BRAND,
  "accounts/owner1": { ...ACTIVE, metaBeta: true },
  "accounts/adm1": ACTIVE,
  ...extra,
});
function reel(id, code, atMs, extra = {}) {
  return { id, permalink: `https://www.instagram.com/reel/${code}/`, caption: `Caption ${code}`, timestamp: new Date(atMs).toISOString(), media_type: "VIDEO", media_product_type: "REELS", thumbnail_url: `https://scontent.cdninstagram.com/${code}.jpg`, like_count: 10, comments_count: 2, ...extra };
}
// Connect b1 through Facebook Login for Business all the way to a pick.
async function connectFb(db, meta, { uid = "owner1", pick = { igUserId: IG_ID, pageId: "5550001", adAccountId: "act_111" } } = {}) {
  const d = deps(db, meta);
  const r1 = await call(d, post("connect", { brandId: "b1", via: "facebook" }, uid));
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  const state = new URL(r1.body.url).searchParams.get("state");
  const r2 = await call(d, { method: "GET", query: { action: "callback", code: "good-fb", state } });
  assert.match(r2.location, /meta=pick/);
  if (!pick) return d;
  const r3 = await call(d, post("select", { brandId: "b1", ...pick }, uid));
  assert.equal(r3.statusCode, 200, JSON.stringify(r3.body));
  return d;
}

describe("vault", () => {
  test("tokens are sealed with IG_TOKEN_KEY and open only with it", () => {
    const key = V.tokenKey({ IG_TOKEN_KEY: KEY });
    const sealed = V.sealToken("EAAB-secret", key);
    assert.doesNotMatch(sealed, /EAAB/);
    assert.equal(V.openToken(sealed, key), "EAAB-secret");
    assert.throws(() => V.openToken(sealed, crypto.randomBytes(32)));
    assert.throws(() => V.tokenKey({ IG_TOKEN_KEY: "short" }), /32 bytes/);
  });
  test("Meta's signed requests verify with either app secret, nothing else", () => {
    const fromFb = V.signRequestForTest({ user_id: "u9" }, FB_SECRET);
    const fromIg = V.signRequestForTest({ user_id: "u8" }, IG_SECRET);
    assert.equal(V.parseSignedRequest(fromFb, [FB_SECRET, IG_SECRET]).user_id, "u9");
    assert.equal(V.parseSignedRequest(fromIg, [FB_SECRET, IG_SECRET]).user_id, "u8");
    assert.equal(V.parseSignedRequest(fromIg, [FB_SECRET]), null);
    assert.equal(V.parseSignedRequest("x.y", [FB_SECRET]), null);
  });
  test("server metric keys match the app's", () => {
    assert.deepEqual(IG.METRIC_KEYS, CLIENT_METRIC_KEYS.map((k) => k.key ?? k));
  });
});

describe("login links", () => {
  test("Facebook Login for Business: config_id and code, no scope", () => {
    const u = new URL(FB.dialogUrl({ appId: "fb-app", configId: "cfg-1", redirectUri: "https://brandlab.wepeka.com/api/instagram/callback", state: "s" }));
    assert.equal(u.origin + u.pathname, "https://www.facebook.com/v27.0/dialog/oauth");
    assert.equal(u.searchParams.get("config_id"), "cfg-1");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("override_default_response_type"), "true");
    assert.equal(u.searchParams.get("scope"), null);
  });
  test("Instagram Login asks for exactly the three App Review permissions", () => {
    const u = new URL(IG.authorizeUrl({ appId: "ig-app", redirectUri: "https://x/cb", state: "s" }));
    assert.deepEqual(u.searchParams.get("scope").split(","), ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"]);
    assert.equal(u.searchParams.get("enable_fb_login"), "0");
  });
  test("the Facebook configuration's permissions are the App Review list", () => {
    assert.deepEqual([...FB.FB_PERMISSIONS].sort(), ["ads_read", "business_management", "instagram_basic", "instagram_content_publish", "instagram_manage_insights", "pages_manage_posts", "pages_read_engagement", "pages_show_list", "read_insights"]);
  });
});

describe("who may connect", () => {
  test("roles: owner and Admin manage; Editor & Sosmed syncs; Creator syncs; Klien neither", () => {
    assert.equal(canManage(BRAND, "owner1"), true);
    assert.equal(canManage(BRAND, "adm1"), true);
    assert.equal(canManage(BRAND, "smm1"), false, "no My Brand edit");
    assert.equal(canManage(BRAND, "off1"), false, "access off");
    assert.equal(canSync(BRAND, "smm1"), true);
    assert.equal(canSync(BRAND, "cc1"), true);
    assert.equal(canSync(BRAND, "kl1"), false);
  });
  test("before App Review only flagged accounts and admins start a login", async () => {
    const meta = fakeMeta();
    const db = seed({ "accounts/owner1": ACTIVE });
    const d = deps(db, meta);
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }))).body.error, "not-allowed");
    db.docs.set("accounts/owner1", { ...ACTIVE, instagramBeta: true });
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }))).statusCode, 200);
    db.docs.set("accounts/owner1", ACTIVE);
    assert.equal((await call(deps(db, meta, { env: { META_OPEN: "1" } }), post("connect", { brandId: "b1", via: "instagram" }))).statusCode, 200);
  });
  test("a member: Admin yes (the owner's flag counts), Editor & Sosmed and strangers no", async () => {
    const d = deps(seed(), fakeMeta());
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }, "adm1"))).statusCode, 200);
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }, "smm1"))).body.error, "not-allowed");
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }, "nobody"))).statusCode, 404);
    assert.equal((await call(d, post("connect", { brandId: "b1", via: "facebook" }, "off1"))).statusCode, 404);
  });
  test("a lapsed owner can't connect; missing env says not-configured", async () => {
    const db = seed({ "accounts/owner1": { status: "active", plan: "trial", trialEndsAt: NOW - 1, metaBeta: true } });
    assert.equal((await call(deps(db, fakeMeta()), post("connect", { brandId: "b1" }))).body.error, "inactive");
    const r = await call(deps(seed(), fakeMeta(), { env: { META_LOGIN_CONFIG_ID: "" } }), post("connect", { brandId: "b1", via: "facebook" }));
    assert.deepEqual([r.statusCode, r.body.error], [503, "not-configured"]);
    const r2 = await call(deps(seed(), fakeMeta(), { env: { IG_TOKEN_KEY: "" } }), post("connect", { brandId: "b1", via: "instagram" }));
    assert.deepEqual([r2.statusCode, r2.body.error], [503, "not-configured"]);
  });
});

describe("Facebook Login for Business", () => {
  test("BISU login: sealed in the vault, picker next, nothing secret in the brand", async () => {
    const db = seed();
    const meta = fakeMeta({ tokenType: "system" });
    const d = await connectFb(db, meta, { pick: null });
    const [grantPath, grant] = [...db.docs.entries()].find(([p]) => p.startsWith("metaGrants/"));
    assert.equal(grant.tokenType, "system");
    assert.equal(grant.tokenExpiresAt, null, "BISU: never expires");
    assert.equal(grant.clientBusinessId, "cb1");
    assert.deepEqual(grant.instagram.map((x) => x.id), [IG_ID, IG_ID2], "Page-linked + assigned to the business");
    assert.doesNotMatch(JSON.stringify([...db.docs.values()]), /"BISU"|"PAGE1"/, "no plain token anywhere");
    assert.equal(V.openToken(grant.token, V.tokenKey(d.env)), "BISU");
    assert.equal(db.get("metaConnections/b1").pendingGrantId, grantPath.split("/")[1]);
    assert.equal([...db.docs.keys()].filter((p) => p.startsWith("metaOauthStates/")).length, 0, "state used once");

    const a = await call(d, post("assets", { brandId: "b1" }));
    assert.equal(a.statusCode, 200);
    assert.doesNotMatch(JSON.stringify(a.body), /token|BISU|PAGE1/i);
    assert.deepEqual(a.body.pages, [{ id: "5550001", name: "Kopi Pagi", igId: IG_ID }]);
    assert.deepEqual(a.body.adAccounts.map((x) => x.id), ["act_111"]);
    assert.equal((await call(d, post("assets", { brandId: "b1" }, "smm1"))).body.error, "not-allowed");
  });

  test("picking: only what the login shared; the brand shows names and ids", async () => {
    const db = seed({ "brands/b1/private/integrations": { ownerId: "owner1", instagram: { accessToken: "IGAA-old" }, facebook: { pageAccessToken: "EAA-old" } } });
    const meta = fakeMeta();
    const d = await connectFb(db, meta, { pick: null });
    assert.equal((await call(d, post("select", { brandId: "b1", igUserId: "17841499999999999" }))).statusCode, 400);
    assert.equal((await call(d, post("select", { brandId: "b1", adAccountId: "act_222" }))).statusCode, 400);
    assert.equal((await call(d, post("select", { brandId: "b1" }))).statusCode, 400, "something must be picked");
    const r = await call(d, post("select", { brandId: "b1", igUserId: IG_ID, pageId: "5550001", adAccountId: "act_111" }));
    assert.equal(r.statusCode, 200);
    const b = db.get("brands/b1");
    assert.deepEqual([b.instagram.username, b.instagram.connected, b.instagram.via], ["kopipagi", true, "facebook"]);
    assert.deepEqual([b.facebook.pageName, b.ads.name, b.ads.currency], ["Kopi Pagi", "Iklan Kopi", "IDR"]);
    assert.equal(b.insights.instagram.followers, 1200, "followers right away");
    const conn = db.get("metaConnections/b1");
    assert.equal(conn.pendingGrantId, undefined);
    assert.equal(db.get(`metaGrants/${conn.grantId}`).brandIds[0], "b1");
    assert.deepEqual(db.get("brands/b1/private/integrations"), { ownerId: "owner1" }, "pasted tokens dropped");
  });

  test("a user-token configuration also works: 60-day token, Page tokens do the Page work", async () => {
    const db = seed();
    const meta = fakeMeta({ tokenType: "user" });
    await connectFb(db, meta);
    const grant = [...db.docs.entries()].find(([p]) => p.startsWith("metaGrants/"))[1];
    assert.equal(grant.tokenType, "user");
    assert.equal(grant.name, "Winson", "the person's name, asked separately");
    assert.equal(grant.clientBusinessId, "");
    assert.equal(grant.tokenExpiresAt, NOW + 60 * DAY);
    assert.ok(meta.calls.some((c) => c.url.searchParams.get("grant_type") === "fb_exchange_token"));
    assert.equal(grant.instagram.length, 1, "no business-assigned list for a user token");
    const acc = await postingAccounts({ db, env: ENV, fetch: meta.fetch }, "b1");
    assert.deepEqual([acc.account.token, acc.page.token, acc.account.base], ["PAGE1", "PAGE1", V.FB_GRAPH]);
  });

  test("what was ticked in Meta's window but left out of /me lists is read by id", async () => {
    const db = seed();
    await connectFb(db, fakeMeta({ tokenType: "user", hiddenAssets: true }), { pick: null });
    const grant = [...db.docs.entries()].find(([p]) => p.startsWith("metaGrants/"))[1];
    assert.deepEqual(grant.pages.map((p) => p.id), ["5550001", "5550009"]);
    assert.deepEqual(grant.instagram.map((x) => [x.id, x.username, x.pageId]), [[IG_ID, "kopipagi", "5550001"], ["17841400000000099", "kopipagi.store2", "5550009"]]);
    assert.deepEqual(grant.adAccounts.map((a) => a.id), ["act_111", "act_222"]);
    assert.doesNotMatch(JSON.stringify(grant), /PAGE9/, "its Page token sealed too");
  });

  test("a second brand reuses the login without another trip to Meta", async () => {
    const db = seed({ "brands/b2": { ...BRAND, id: "b2", name: "Kopi Sore" } });
    const meta = fakeMeta();
    const d = await connectFb(db, meta);
    const r = await call(d, post("connect", { brandId: "b2", via: "facebook", offerReuse: true }));
    assert.equal(r.body.reusable.length, 1);
    assert.match(r.body.reusable[0].label, /@kopipagi/);
    const r2 = await call(d, post("connect", { brandId: "b2", via: "facebook", reuseGrantId: r.body.reusable[0].grantId }));
    assert.deepEqual(r2.body, { pick: true });
    const offered = await call(d, post("assets", { brandId: "b2" }));
    assert.deepEqual(offered.body.usedBy.instagram, { [IG_ID]: "Kopi Pagi" }, "b1's account is marked, by name");
    assert.equal(offered.body.usedBy.pages["5550001"], "Kopi Pagi");
    assert.equal(offered.body.brandName, "Kopi Sore");
    await call(d, post("select", { brandId: "b2", igUserId: IG_ID2 }));
    const g = db.get(`metaGrants/${r.body.reusable[0].grantId}`);
    assert.deepEqual(g.brandIds.sort(), ["b1", "b2"]);
    assert.equal(db.get("brands/b2").instagram.username, "kopipagi.store");
    assert.equal(db.get("brands/b2").facebook.connected, false, "no Page picked");
  });

  test("denied, expired and empty logins go back to the app with a reason", async () => {
    const db = seed();
    const meta = fakeMeta();
    const d = deps(db, meta);
    const { body } = await call(d, post("connect", { brandId: "b1", via: "facebook" }));
    const state = new URL(body.url).searchParams.get("state");
    const r = await call(d, { method: "GET", query: { action: "callback", error: "access_denied", state } });
    assert.match(r.location, /\?meta=error&reason=denied&brand=b1#\/settings\/meta$/);
    const r2 = await call(d, { method: "GET", query: { action: "callback", code: "good-fb", state } });
    assert.match(r2.location, /reason=expired/, "a state works once");
    const { body: b2 } = await call(d, post("connect", { brandId: "b1", via: "facebook" }));
    const late = deps(db, meta, { now: NOW + 11 * 60 * 1000 });
    assert.match((await call(late, { method: "GET", query: { action: "callback", code: "good-fb", state: new URL(b2.url).searchParams.get("state") } })).location, /reason=expired/);
  });

  test("disconnect: the connection and its grant go, the brand says not connected", async () => {
    const db = seed();
    const d = await connectFb(db, fakeMeta());
    assert.equal((await call(d, post("disconnect", { brandId: "b1" }, "smm1"))).body.error, "not-allowed");
    assert.equal((await call(d, post("disconnect", { brandId: "b1" }, "adm1"))).statusCode, 200);
    assert.equal(db.get("metaConnections/b1"), undefined);
    assert.equal([...db.docs.keys()].filter((p) => p.startsWith("metaGrants/")).length, 0);
    const b = db.get("brands/b1");
    assert.deepEqual([b.instagram.connected, b.facebook.connected, b.ads.connected], [false, false, false]);
  });
});

describe("Instagram Login", () => {
  test("one account, connected straight away, 60-day token in the vault", async () => {
    const db = seed();
    const meta = fakeMeta();
    const d = deps(db, meta);
    const { body } = await call(d, post("connect", { brandId: "b1", via: "instagram" }));
    assert.match(body.url, /^https:\/\/www\.instagram\.com\/oauth\/authorize/);
    const state = new URL(body.url).searchParams.get("state");
    const r = await call(d, { method: "GET", query: { action: "callback", code: "good-ig#_", state } });
    assert.match(r.location, /\?meta=connected&brand=b1#\/settings\/meta$/);
    const conn = db.get("metaConnections/b1");
    const grant = db.get(`metaGrants/${conn.grantId}`);
    assert.deepEqual([grant.via, grant.tokenExpiresAt, conn.igUserId], ["instagram", NOW + 60 * DAY, IG_ID]);
    assert.equal(V.openToken(grant.token, V.tokenKey(d.env)), "IG-LONG");
    const b = db.get("brands/b1");
    assert.deepEqual([b.instagram.username, b.instagram.via], ["kopipagi", "instagram"]);
    assert.equal(b.facebook, undefined, "a Page is not touched by Instagram Login");
    const acc = await postingAccounts({ db, env: d.env, fetch: meta.fetch }, "b1");
    assert.deepEqual([acc.account.base, acc.page], [V.IG_GRAPH, undefined]);
  });
});

describe("sync", () => {
  const thisMonth = NOW - 2 * DAY;
  const media = [reel("m1", "AAA", thisMonth), reel("m2", "BBB", NOW - DAY), reel("m0", "OLD", NOW - 90 * DAY)];
  const insights = { m1: { views: 900, reach: 700, saved: 5, shares: 4, reposts: 1 }, m2: { views: 100, reach: 80 } };

  test("Instagram (via Facebook), Page and ad spend in one pass; roles and spacing", async () => {
    const db = seed({
      "content/c1": { brandId: "b1", ownerId: "owner1", platform: "Instagram", publishedUrl: "https://www.instagram.com/reel/AAA/", status: "published", performanceByPlatform: { tiktok: { views: 50 } } },
      "content/c3": { brandId: "b1", ownerId: "owner1", platform: "Instagram", status: "published", posting: { fb: { state: "done", id: "9990001", at: NOW - 3 * DAY } }, performanceByPlatform: {} },
      "brands/b1/sales/2026-11": { ownerId: "owner1", brandId: "b1", month: "2026-11", entries: [{ id: "s1", kind: "sale", amount: 100000, date: "2026-11-02" }] },
    });
    const meta = fakeMeta({ media, insights });
    const d = await connectFb(db, meta);
    db.docs.get("metaConnections/b1").connectedAt = NOW - 1.5 * DAY;
    assert.equal((await call(d, post("sync", { brandId: "b1" }, "kl1"))).body.error, "not-allowed");
    const r = await call(d, post("sync", { brandId: "b1" }, "smm1"));
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.updated, r.body.added], [1, 1]);
    const c1 = db.get("content/c1");
    assert.equal(c1.performanceByPlatform.instagram.views, 900);
    assert.equal(c1.performance.views, 950, "Instagram + TikTok");
    assert.equal(c1.igMediaId, "m1");
    assert.ok([...db.docs.values()].some((x) => x.igMediaId === "m2" && x.ownerId === "owner1"), "posted since connecting → new card");
    assert.ok(!meta.calls.some((c) => c.url.pathname.endsWith("/m0/insights")), "older posts left alone");
    assert.ok(meta.calls.every((c) => c.url.hostname !== "graph.instagram.com"), "a Facebook login reads Instagram on graph.facebook.com");

    const b = db.get("brands/b1");
    assert.deepEqual([b.insights.facebook.followers, b.insights.facebook.reach30d, b.insights.facebook.source], [800, 4000, "facebook"]);
    assert.equal(db.get("content/c3").performanceByPlatform.facebook.views, 321);
    assert.deepEqual(b.ads.lastSync.matched, 2);
    assert.equal(b.ads.lastSync.unmatched, 1, "an ad for a post Brandlab doesn't know");
    assert.doesNotMatch(JSON.stringify(b), /150000|spend/, "no money on the brand doc");

    const nov = db.get("brands/b1/sales/2026-11").entries;
    const auto = nov.find((e) => e.id === "meta-ads-c1-2026-11");
    assert.deepEqual([auto.amount, auto.category, auto.attribution, auto.contentId, auto.date], [150000, "ads", "auto", "c1", "2026-11-24"]);
    assert.deepEqual([auto.meta.reportedPurchases, auto.meta.reportedValue], [4, 600000]);
    assert.ok(nov.some((e) => e.id === "s1"), "the owner's own entries stay");
    assert.equal(db.get("brands/b1/sales/2026-10").entries[0].date, "2026-10-31");

    assert.equal((await call(d, post("sync", { brandId: "b1" }))).body.error, "too-soon");
    // Next night: the same numbers rewrite nothing twice.
    await call(deps(db, meta, { now: NOW + DAY }), { method: "GET", query: { action: "cron" }, headers: { authorization: "Bearer cron" } });
    assert.equal(db.get("brands/b1/sales/2026-11").entries.filter((e) => e.id === "meta-ads-c1-2026-11").length, 1);
  });

  test("stream: true sends one line per step, then the result; a refusal stays a plain error", async () => {
    const db = seed({ "content/c1": { brandId: "b1", ownerId: "owner1", platform: "Instagram", publishedUrl: "https://www.instagram.com/reel/AAA/", status: "published" } });
    const d = await connectFb(db, fakeMeta({ media, insights }));
    db.docs.get("metaConnections/b1").connectedAt = NOW - 1.5 * DAY;
    const streamRes = () => {
      const r = { statusCode: 0, headers: {}, chunks: [], ended: false, body: null };
      r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
      r.status = (c) => { r.statusCode = c; return r; };
      r.json = (b) => { r.body = b; return r; };
      r.write = (chunk) => { r.chunks.push(String(chunk)); return true; };
      r.end = () => { r.ended = true; };
      return r;
    };
    const refused = streamRes();
    await route(d, post("sync", { brandId: "b1", stream: true }, "kl1"), refused);
    assert.deepEqual([refused.statusCode, refused.body?.error, refused.chunks.length], [403, "not-allowed", 0]);

    const r = streamRes();
    await route(d, post("sync", { brandId: "b1", stream: true }), r);
    assert.match(r.headers["content-type"], /ndjson/);
    assert.ok(r.ended);
    const lines = r.chunks.join("").trim().split("\n").map((l) => JSON.parse(l));
    const steps = lines.filter((l) => l.step).map((l) => l.step);
    assert.deepEqual([...new Set(steps)], ["posts", "numbers", "account", "page", "ads", "save"]);
    const reads = lines.filter((l) => l.step === "numbers");
    assert.deepEqual([reads[0].done, reads.at(-1).done, reads.at(-1).total], [0, 2, 2]);
    const last = lines.at(-1);
    assert.equal(last.done, true);
    assert.deepEqual([last.result.updated, last.result.added, last.result.followers], [1, 1, 1200]);
  });

  test("through Facebook: organic and ads apart per post (total − organic); through Instagram: organic only", async () => {
    const withAds = { m1: { views: 900, reach: 700, total_views: 1500, total_likes: 40, total_comments: 6 } };
    const db = seed({ "content/c1": { brandId: "b1", ownerId: "owner1", platform: "Instagram", publishedUrl: "https://www.instagram.com/reel/AAA/", status: "published" } });
    const meta = fakeMeta({ media: [reel("m1", "AAA", NOW - DAY)], insights: withAds });
    const d = await connectFb(db, meta);
    await call(d, post("sync", { brandId: "b1" }));
    const c1 = db.get("content/c1");
    assert.deepEqual([c1.igPaid.views, c1.igPaid.likes, c1.igPaid.comments], [600, 30, 4], "likes 10 and comments 2 are organic");
    assert.deepEqual([c1.igPaid.totalViews, c1.igPaid.totalLikes], [1500, 40]);
    assert.equal(c1.performance.views, 900, "reports keep the organic number");

    const db2 = seed({ "content/c1": { brandId: "b1", ownerId: "owner1", platform: "Instagram", publishedUrl: "https://www.instagram.com/reel/AAA/", status: "published" } });
    const meta2 = fakeMeta({ media: [reel("m1", "AAA", NOW - DAY)], insights: withAds });
    const d2 = deps(db2, meta2);
    const { body } = await call(d2, post("connect", { brandId: "b1", via: "instagram" }));
    await call(d2, { method: "GET", query: { action: "callback", code: "good-ig", state: new URL(body.url).searchParams.get("state") } });
    await call(d2, post("sync", { brandId: "b1" }));
    assert.equal(db2.get("content/c1").igPaid, undefined);
    assert.ok(!meta2.calls.some((c) => (c.url.searchParams.get("metric") || "").includes("total_")), "Instagram Login has no totals");
  });

  test("a reel posted straight on the Page joins the Instagram post with the same caption", async () => {
    const cap = "Pagi tenang, kopi di tangan. Pesan lewat WA.";
    const db = seed({
      "content/c1": { brandId: "b1", ownerId: "owner1", platform: "Instagram", publishedUrl: "https://www.instagram.com/reel/AAA/", status: "published", caption: cap },
      "content/c2": { brandId: "b1", ownerId: "owner1", platform: "Instagram", status: "published", caption: "Lain sama sekali, bukan ini" },
    });
    const pageVideos = [
      { id: "fbv1", description: `  ${cap.toUpperCase()} `, created_time: new Date(NOW - DAY).toISOString() },
      { id: "fbv2", description: "Video Facebook saja", created_time: new Date(NOW - DAY).toISOString() },
      { id: "fbv3", description: cap, created_time: new Date(NOW - 90 * DAY).toISOString() },
    ];
    const d = await connectFb(db, fakeMeta({ media: [reel("m1", "AAA", NOW - DAY)], insights: { m1: { views: 900 } }, pageVideos }));
    await call(d, post("sync", { brandId: "b1" }));
    const c1 = db.get("content/c1");
    assert.equal(c1.fbVideoId, "fbv1");
    assert.deepEqual([c1.performanceByPlatform.facebook.views, c1.performanceByPlatform.facebook.likes, c1.performanceByPlatform.instagram.views], [777, 25, 900]);
    assert.equal(db.get("content/c2").performanceByPlatform, undefined, "no twin, no numbers");
  });

  test("an ad account not in Rupiah is left out of Sales", async () => {
    const db = seed({ "content/c1": { brandId: "b1", ownerId: "owner1", igMediaId: "m1", platform: "Instagram", status: "published" } });
    const d = await connectFb(db, fakeMeta({ adCurrency: "USD" }));
    await call(d, post("sync", { brandId: "b1" }));
    assert.equal(db.get("brands/b1/sales/2026-11"), undefined);
    assert.equal(db.get("brands/b1").ads.lastSync.currencySkipped, true);
  });

  test("a dead token marks the brand to reconnect", async () => {
    const db = seed();
    await connectFb(db, fakeMeta());
    const r = await call(deps(db, fakeMeta({ dead: true })), post("sync", { brandId: "b1" }));
    assert.deepEqual(r.body, { reconnect: true });
    assert.equal(db.get("brands/b1").instagram.status, "reconnect");
    assert.equal(await postingAccounts({ db, env: ENV, fetch: fakeMeta().fetch }, "b1"), null, "no posting on a dead connection");
  });

  test("Instagram Login tokens are refreshed with 20 days left", async () => {
    const db = seed();
    const meta = fakeMeta({ media: [] });
    const d = deps(db, meta);
    const { body } = await call(d, post("connect", { brandId: "b1", via: "instagram" }));
    await call(d, { method: "GET", query: { action: "callback", code: "good-ig", state: new URL(body.url).searchParams.get("state") } });
    const later = NOW + 45 * DAY;
    await call(deps(db, meta, { now: later }), { method: "GET", query: { action: "cron" }, headers: { authorization: "Bearer cron" } });
    const grant = db.get(`metaGrants/${db.get("metaConnections/b1").grantId}`);
    assert.equal(V.openToken(grant.token, V.tokenKey(d.env)), "IG-LONG2");
    assert.equal(grant.tokenExpiresAt, later + 60 * DAY);
  });

  test("cron: secret, sweeps half-done logins", async () => {
    const db = seed({
      "metaOauthStates/old": { uid: "x", brandId: "b1", expiresAt: NOW - 1 },
      "metaGrants/orphan": { via: "facebook", brandIds: [], createdAt: NOW - 2 * DAY },
    });
    const d = deps(db, fakeMeta());
    assert.equal((await call(d, { method: "GET", query: { action: "cron" }, headers: {} })).statusCode, 401);
    const r = await call(d, { method: "GET", query: { action: "cron" }, headers: { authorization: "Bearer cron" } });
    assert.equal(r.body.swept, 2);
  });
});

describe("read-only proxy", () => {
  test("anyone active on the brand, only this account's paths", async () => {
    const db = seed();
    const d = await connectFb(db, fakeMeta({ media: [reel("m1", "AAA", NOW)] }));
    const ok = await call(d, post("graph", { brandId: "b1", path: `/${IG_ID}/media`, params: { fields: "id" } }, "kl1"));
    assert.equal(ok.body.data[0].id, "m1");
    assert.equal((await call(d, post("graph", { brandId: "b1", path: `/${IG_ID2}/media` }))).statusCode, 400, "another account");
    assert.equal((await call(d, post("graph", { brandId: "b1", path: `/${IG_ID}`, params: { access_token: "x" } }))).statusCode, 400);
    assert.equal((await call(d, post("graph", { brandId: "b1", path: `/${IG_ID}` }, "off1"))).statusCode, 404);
  });
});

describe("Meta's callbacks", () => {
  test("deauthorize and data deletion drop every grant of that person", async () => {
    const db = seed();
    const d = await connectFb(db, fakeMeta({ tokenType: "user" }));
    const bad = await call(d, { method: "POST", query: { action: "deauthorize" }, body: { signed_request: V.signRequestForTest({ user_id: "fbuser1" }, "nope") } });
    assert.equal(bad.statusCode, 400);
    const r = await call(d, { method: "POST", query: { action: "data-deletion" }, body: `signed_request=${encodeURIComponent(V.signRequestForTest({ user_id: "fbuser1" }, FB_SECRET))}` });
    assert.equal(r.statusCode, 200);
    assert.match(r.body.url, /\/api\/instagram\/deletion-status\?code=/);
    assert.equal(db.get("metaConnections/b1"), undefined);
    assert.equal(db.get("brands/b1").instagram.status, "removed");
    const page = await call(d, { method: "GET", query: { action: "deletion-status", code: r.body.confirmation_code } });
    assert.match(page.body, /sudah selesai/);
  });
  test("a deletion request also removes what came from Meta; the owner's own plans and numbers stay", async () => {
    const card = {
      brandId: "b1", ownerId: "owner1", platform: "Instagram", title: "Promo", caption: "Promo pagi",
      igMediaId: "m1", igSyncedAt: NOW - DAY, thumbnail: "https://scontent.cdninstagram.com/v/t51/abc.jpg",
      performanceByPlatform: { instagram: { views: 900, reach: 700 }, facebook: { views: 50 }, tiktok: { views: 300 } },
      performance: { views: 1250, reach: 700, reposts: 4, insightScreenshot: "s.png", confirmedAt: NOW - DAY },
    };
    const db = seed({
      "content/c1": card,
      "content/c2": { brandId: "b1", ownerId: "owner1", platform: "TikTok", thumbnail: "https://example.com/t.jpg", performance: { views: 80 } },
      "brands/b1/sales/2026-11": { ownerId: "owner1", brandId: "b1", month: "2026-11", entries: [
        { id: "s1", kind: "sale", amount: 100000, date: "2026-11-02" },
        { id: "meta-ads-c1-2026-11", kind: "expense", amount: 150000, date: "2026-11-24", attribution: "auto", category: "ads" },
      ] },
    });
    const d = await connectFb(db, fakeMeta({ tokenType: "user" }));
    Object.assign(db.docs.get("brands/b1"), {
      insights: { instagram: { followers: 1200, source: "instagram" }, tiktok: { followers: 90, source: "manual" } },
      insightsHistory: [{ platform: "instagram", followers: 1100, at: NOW - 2 * DAY, source: "instagram" }, { platform: "tiktok", followers: 80, at: NOW - 2 * DAY, source: "manual" }],
    });

    // Removing the app without a deletion request leaves the numbers.
    await call(d, { method: "POST", query: { action: "deauthorize" }, body: { signed_request: V.signRequestForTest({ user_id: "nobody" }, FB_SECRET) } });
    assert.equal(db.get("content/c1").performanceByPlatform.instagram.views, 900);

    const r = await call(d, { method: "POST", query: { action: "data-deletion" }, body: `signed_request=${encodeURIComponent(V.signRequestForTest({ user_id: "fbuser1" }, FB_SECRET))}` });
    assert.equal(r.statusCode, 200);
    const c1 = db.get("content/c1");
    assert.deepEqual([c1.performanceByPlatform.instagram, c1.performanceByPlatform.facebook, c1.performanceByPlatform.tiktok], [{}, {}, { views: 300 }]);
    assert.deepEqual([c1.performance.views, c1.performance.reach, c1.performance.reposts], [300, null, 4], "TikTok and hand-typed numbers stay");
    assert.deepEqual([c1.igMediaId, c1.thumbnail, c1.title, c1.performance.insightScreenshot], ["", "", "Promo", "s.png"]);
    assert.equal(db.get("content/c2").thumbnail, "https://example.com/t.jpg", "other cards untouched");
    const b = db.get("brands/b1");
    assert.equal(b.insights.instagram, null);
    assert.equal(b.insights.tiktok.followers, 90);
    assert.deepEqual(b.insightsHistory.map((h) => h.platform), ["tiktok"]);
    assert.deepEqual(db.get("brands/b1/sales/2026-11").entries.map((e) => e.id), ["s1"]);
    const page = await call(d, { method: "GET", query: { action: "deletion-status", code: r.body.confirmation_code } });
    assert.match(page.body, /angka, gambar, dan biaya iklan/);
  });
  test("an Instagram Login account is found by its Instagram id too", async () => {
    const db = seed();
    const d = deps(db, fakeMeta());
    const { body } = await call(d, post("connect", { brandId: "b1", via: "instagram" }));
    await call(d, { method: "GET", query: { action: "callback", code: "good-ig", state: new URL(body.url).searchParams.get("state") } });
    await call(d, { method: "POST", query: { action: "deauthorize" }, body: { signed_request: V.signRequestForTest({ user_id: IG_ID }, IG_SECRET) } });
    assert.equal(db.get("brands/b1").instagram.connected, false);
  });
});

describe("moving a brand from Instagram Login to Facebook", () => {
  test("same account: no second set of cards, the old login is dropped, the numbers carry on", async () => {
    const media = [reel("m1", "AAA", NOW - DAY), reel("m2", "BBB", NOW - DAY / 2)];
    const insights = { m1: { views: 900, reach: 700 }, m2: { views: 100, reach: 80 } };
    const db = seed();
    const meta = fakeMeta({ media, insights });
    const d = deps(db, meta);
    const { body } = await call(d, post("connect", { brandId: "b1", via: "instagram" }));
    await call(d, { method: "GET", query: { action: "callback", code: "good-ig", state: new URL(body.url).searchParams.get("state") } });
    const igConn = db.get("metaConnections/b1");
    assert.equal(igConn.via, "instagram");
    db.docs.get("metaConnections/b1").connectedAt = NOW - 1.5 * DAY;
    const first = await call(d, post("sync", { brandId: "b1" }));
    assert.equal(first.body.added, 2, "both posts arrive as cards");
    const cards = () => [...db.docs.entries()].filter(([p, c]) => p.startsWith("content/") && c.brandId === "b1");
    assert.equal(cards().length, 2);

    // Later the owner adds the Facebook Page and ads: same Instagram account.
    const fb = await call(d, post("connect", { brandId: "b1", via: "facebook" }));
    await call(d, { method: "GET", query: { action: "callback", code: "good-fb", state: new URL(fb.body.url).searchParams.get("state") } });
    const offer = await call(d, post("assets", { brandId: "b1" }));
    assert.equal(offer.body.current.igUserId, IG_ID, "the account in use comes ticked");
    const picked = await call(d, post("select", { brandId: "b1", igUserId: IG_ID, pageId: "5550001" }));
    assert.equal(picked.statusCode, 200, JSON.stringify(picked.body));
    const fbConn = db.get("metaConnections/b1");
    assert.equal(fbConn.via, "facebook");
    assert.equal(fbConn.connectedAt, NOW - 1.5 * DAY, "same account: its start date stays");
    assert.equal(db.get(`metaGrants/${igConn.grantId}`), undefined, "the Instagram Login token is gone");
    assert.equal(db.get("brands/b1").instagram.via, "facebook");

    const again = await call(d, post("sync", { brandId: "b1" }));
    assert.equal(again.statusCode, 200, JSON.stringify(again.body));
    assert.deepEqual([again.body.added, again.body.updated], [0, 2], "the same posts are updated, not added twice");
    assert.equal(cards().length, 2);
    assert.equal(cards().find(([, c]) => c.igMediaId === "m1")[1].performanceByPlatform.instagram.views, 900);
  });
});

describe("posting from the vault", () => {
  const piece = { brandId: "b1", ownerId: "owner1", status: "editing", posting: { type: "reels" } };
  test("who may post a piece: Posting on the brand, or Wepeka's own desk", async () => {
    const db = seed({ "content/c1": piece, "brands/bw": { name: "wepeka", ownerId: ADMIN }, "content/cw": { ...piece, brandId: "bw", ownerId: ADMIN } });
    assert.equal((await pieceFor(db, "smm1", "c1")).brand.id, "b1");
    assert.equal((await pieceFor(db, "owner1", "c1")).c.id, "c1");
    await assert.rejects(pieceFor(db, "cc1", "c1"), /private/, "Content Creator has no Posting");
    await assert.rejects(pieceFor(db, "kl1", "c1"), /private/);
    assert.equal((await pieceFor(db, ADMIN, "cw")).desk, true);
    db.docs.set("accounts/owner1", { status: "active", plan: "trial", trialEndsAt: NOW - 1 });
    await assert.rejects(pieceFor(db, "smm1", "c1"), /inactive/);
  });
  test("copies go up only for a brand that can post them", async () => {
    const db = seed();
    assert.deepEqual(await postersOf(db, { ...BRAND }, { env: ENV }), { account: null, page: null }, "not connected: nothing to post with");
    await connectFb(db, fakeMeta());
    const p = await postersOf(db, { ...BRAND }, { env: ENV });
    assert.deepEqual([p.account.igUserId, p.page.pageId], [IG_ID, "5550001"]);
  });
  test("the posting job reads the vault: BISU on graph.facebook.com, Page for Facebook", async () => {
    const db = seed();
    const meta = fakeMeta();
    await connectFb(db, meta);
    const p = await postersFor(db, { brandId: "b1", ownerId: "owner1", fb: { state: "waiting" } }, { env: ENV, fetchImpl: meta.fetch });
    assert.deepEqual([p.account.igUserId, p.page.pageId], [IG_ID, "5550001"]);
    const before = meta.calls.length;
    const answer = await p.graph("GET", `/${IG_ID}`, { fields: "username" });
    assert.equal(answer.username, "kopipagi");
    assert.match(String(meta.calls[before].url), /^https:\/\/graph\.facebook\.com\/v27\.0\//);
  });
  test("a brand without a vault connection keeps the pasted token (Wepeka's)", async () => {
    const db = fakeDb({ "brands/bp": { ownerId: ADMIN, name: "wepeka", instagram: { username: "winkhsin", igUserId: "17841400566996586", accessToken: "IGAA-x" } } });
    const p = await postersFor(db, { brandId: "bp", ownerId: ADMIN }, { env: ENV });
    assert.equal(p.account.token, "IGAA-x");
  });
});

describe("ads → Sales, pure", () => {
  const rows = [{ adId: "a", month: "2026-11", spend: 1000.6, impressions: 1, clicks: 1, purchases: 1, purchaseValue: 50, igMediaId: "m1" }];
  test("one automatic Iklan expense per piece and month", () => {
    const { entries } = FB.adsExpenseEntries(rows, { contents: [{ id: "c1", posting: { ig: { mediaId: "m1" } } }], adAccountId: "act_1", currency: "IDR", now: NOW });
    assert.deepEqual([entries[0].id, entries[0].amount, entries[0].kind], ["meta-ads-c1-2026-11", 1001, "expense"]);
  });
  test("a pass replaces only its own automatic entries of its months", () => {
    const existing = [
      { id: "s1", kind: "sale" },
      { id: "meta-ads-c1-2026-11", attribution: "auto", date: "2026-11-20", amount: 5, at: 1, meta: { adAccountId: "act_1" } },
      { id: "meta-ads-c9-2026-11", attribution: "auto", date: "2026-11-20", amount: 7, at: 1, meta: { adAccountId: "act_1" } },
      { id: "manual-ads", kind: "expense", category: "ads", date: "2026-11-20" },
    ];
    const merged = FB.mergeAutoEntries(existing, [{ id: "meta-ads-c1-2026-11", date: "2026-11-24", amount: 9, at: 99, attribution: "auto" }], ["2026-11"], "act_1");
    assert.deepEqual(merged.map((e) => e.id), ["s1", "manual-ads", "meta-ads-c1-2026-11"]);
    assert.equal(merged.at(-1).at, 1, "keeps its place in the log");
  });
  test("the window is last month and this one, Jakarta time", () => {
    assert.deepEqual(FB.adsWindow(Date.UTC(2026, 0, 3)), { since: "2025-12-01", until: "2026-01-03", months: ["2025-12", "2026-01"] });
  });
});

describe("Sales reads the automatic ad spend", () => {
  test("ROAS uses it; what Meta reports stays beside revenue", async () => {
    const { contentMoney } = await import("../js/content-money.js");
    const { entries } = FB.adsExpenseEntries(
      [{ adId: "a", month: "2026-11", spend: 200000, impressions: 21000, clicks: 640, purchases: 3, purchaseValue: 900000, igMediaId: "m1" }],
      { contents: [{ id: "c1", igMediaId: "m1" }], adAccountId: "act_1", currency: "IDR", now: NOW },
    );
    const tracker = {
      entries: [{ id: "s1", kind: "sale", amount: 400000, date: "2026-11-10", channel: "ads", source: { contentId: "c1" } }],
      expenses: entries,
    };
    const [row] = contentMoney({ tracker, contents: [{ id: "c1", title: "Reel", status: "published" }] });
    assert.equal(row.adSpend, 200000);
    assert.equal(row.revenue, 400000, "Meta's 900.000 is not a sale");
    assert.deepEqual(row.reported, { purchases: 3, value: 900000, impressions: 21000, clicks: 640 }, "impressions and clicks shown too (ads_read)");
    assert.equal(row.roas, 2);
  });
});

// ---------- the account picker's order (js/meta-pick.js) ----------
import { looksLike, pageForIg, sortForBrand } from "../js/meta-pick.js";

test("picker: the brand's look-alike Instagram on top, other brands' accounts tucked away, the Page follows", () => {
  assert.equal(looksLike("Quatro Kids Club", "quatrokidsclub"), true);
  assert.equal(looksLike("Quatro Kids Club", "winkhsin"), false);
  assert.equal(looksLike("AB", "ab"), false, "too short to mean anything");
  const igs = [
    { id: "17841400566996586", username: "winkhsin", pageId: "" },
    { id: "17841438523032359", username: "quatrokidsclub", pageId: "" },
    { id: "17841400000000001", username: "kopipagi", pageId: "" },
  ];
  const sorted = sortForBrand(igs, { brandName: "Quatro Kids Club", usedBy: { "17841400566996586": "Winson" }, current: "", label: (x) => x.username });
  assert.deepEqual(sorted.free.map((x) => x.username), ["quatrokidsclub", "kopipagi"]);
  assert.equal(sorted.free[0].match, true);
  assert.deepEqual(sorted.used.map((x) => [x.username, x.usedBy]), [["winkhsin", "Winson"]]);
  // The brand's own saved choice is never hidden, even if another brand uses it too.
  const again = sortForBrand(igs, { brandName: "Quatro Kids Club", usedBy: { "17841400566996586": "Winson" }, current: "17841400566996586", label: (x) => x.username });
  assert.equal(again.free[0].username, "winkhsin");
  assert.equal(again.used.length, 0);

  const pages = [
    { id: "1493455100509166", name: "Quatrokidsclub", igId: "" },
    { id: "2000", name: "Quatro Kids Club", igId: "" },
    { id: "3000", name: "winkhsin", igId: "17841400566996586" },
  ];
  assert.equal(pageForIg({ id: "17841400566996586", username: "winkhsin", pageId: "" }, pages), "3000", "the Page Meta links it to");
  assert.equal(pageForIg({ id: "x", username: "kopipagi", pageId: "2000" }, pages), "2000", "pageId from /me/accounts wins");
  assert.equal(pageForIg({ id: "17841438523032359", username: "quatrokidsclub", pageId: "" }, pages), "", "two Pages share the name: no guess");
  assert.equal(pageForIg({ id: "17841438523032359", username: "quatrokidsclub", pageId: "" }, pages.slice(0, 1)), "1493455100509166", "one Page with the same name");
  assert.equal(pageForIg(null, pages), "");
});

// ---------- one post's breakdown (js/meta-breakdown.js) ----------
import { metaBreakdown } from "../js/meta-breakdown.js";
test("breakdown: Instagram organic, from ads and Facebook apart, with a total", () => {
  const c = {
    performanceByPlatform: { instagram: { views: 900, reach: 700, likes: 10, comments: 2 }, facebook: { views: 777, likes: 25, comments: 5 }, tiktok: { views: 50 } },
    igPaid: { views: 600, likes: 30, comments: 4 },
  };
  const b = metaBreakdown(c);
  assert.deepEqual([b.ig.views, b.ads.views, b.fb.views, b.total.views], [900, 600, 777, 2277], "TikTok isn't Meta's");
  assert.deepEqual([b.total.likes, b.total.comments], [65, 11]);
  assert.equal(metaBreakdown({ performance: { views: 10 } }), null, "numbers typed by hand only: no breakdown");
  assert.equal(metaBreakdown({ performanceByPlatform: { instagram: { views: 5 } } }).ads, null, "through Instagram: no ads column data");
});

// ---------- what the AI may read (js/meta-safe.js) ----------
import { contentForAi, brandForAi, trackerForAi } from "../js/meta-safe.js";
test("AI prompts get no numbers from Meta; the owner's own and TikTok's stay", () => {
  const c = {
    title: "Promo",
    performanceByPlatform: { instagram: { views: 900, likes: 10 }, facebook: { views: 70 }, tiktok: { views: 300 } },
    performance: { views: 1270, likes: 10, reposts: 4, insightScreenshot: "s.png" },
    igPaid: { views: 600 },
  };
  const safe = contentForAi(c);
  assert.deepEqual(safe.performanceByPlatform, { tiktok: { views: 300 } });
  assert.deepEqual([safe.performance.views, safe.performance.likes, safe.performance.reposts], [300, null, 4]);
  assert.equal(safe.igPaid, undefined);
  assert.equal(c.performanceByPlatform.instagram.views, 900, "the card itself is untouched");
  const typed = { performance: { views: 50 } };
  assert.equal(contentForAi(typed), typed);
  const b = brandForAi({ insights: { instagram: { followers: 1200, source: "instagram" }, tiktok: { followers: 90, source: "manual" } }, insightsHistory: [{ source: "instagram" }, { source: "manual" }] });
  assert.deepEqual([Object.keys(b.insights), b.insightsHistory.length], [["tiktok"], 1]);
  const tr = trackerForAi({ expenses: [{ id: "meta-ads-c1-2026-11", attribution: "auto", amount: 1 }, { id: "x1", amount: 2 }] });
  assert.deepEqual(tr.expenses.map((e) => e.id), ["x1"]);
});
