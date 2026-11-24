// /api/instagram/<action> — a brand's Meta connection, both ways in (owner,
// 2026-11-24): Facebook Login for Business (Instagram professional account
// + Facebook Page + Meta ad account in one login — the main way) and
// Instagram Login (an Instagram account without a Page). One function for
// every action; post.js and webhook.js next to it are their own functions.
//
//   POST connect     {brandId, via, reuseGrantId?}  → { url } to Meta's dialog,
//                                                     or { pick: true } reusing a login
//   GET  callback    ?code&state                     Meta sends the person back → app (?meta=pick|connected|…)
//   POST assets      {brandId}                       what the login shared, for the picker (names and ids only)
//   POST select      {brandId, igUserId, pageId, adAccountId}  the brand's accounts
//   POST disconnect  {brandId}
//   POST sync        {brandId, stream?}              one pass now (≥5 min apart); stream: true
//                                                     = one JSON line per step (NDJSON), the result last
//   POST graph       {brandId, path, params}         read-only Instagram GET through the server
//   GET  cron                                        nightly (CRON_SECRET): tokens, numbers, ad spend
//   POST deauthorize / data-deletion  signed_request  Meta's callbacks
//   GET  deletion-status ?code
//
// Who may: connecting, picking and disconnecting = the owner, or a member
// with My Brand edit AND Posting (the Admin role) — js/permissions.js;
// "Sinkron sekarang" = Posting or Create edit; reading through the proxy =
// anyone active on the brand. Until Meta's App Review passes only people
// with a role on the Meta app can log in at all, so connecting is open to
// admins and accounts with metaBeta (or instagramBeta) until META_OPEN=1.
//
// Env (Vercel, filled by the owner): META_APP_ID, META_APP_SECRET,
// META_LOGIN_CONFIG_ID (Facebook Login for Business), IG_APP_ID,
// IG_APP_SECRET (Instagram Login), IG_TOKEN_KEY (the vault key), CRON_SECRET,
// optional META_REDIRECT_URI (default APP_URL/api/instagram/callback — the
// one redirect both logins come back to) and META_OPEN=1.
//
// Errors: { error: code } — 400 bad-request, 401 auth, 403 not-allowed/
// inactive, 404 not-found/not-connected, 409 reconnect, 429 too-soon,
// 502 meta, 503 not-configured.
import crypto from "node:crypto";
import { adminDb, requireAuth } from "../_firebaseAdmin.js";
import { isAdminUid } from "../_aiQuota.js";
import { APP_URL } from "../_reminders.js";
import { accountCanWrite } from "../brands/recount.js";
import { can, memberPerms } from "../_permissions.js";
import * as V from "../_metaVault.js";
import * as IG from "../_instagram.js";
import * as FB from "../_facebookLogin.js";
import { igApi, pageApi, userTokenDead } from "../_metaConnection.js";

const idOk = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const graphIdOk = (v) => typeof v === "string" && /^(act_)?\d{3,40}$/.test(v);
class Fail extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new Fail(code, status);
};

export function liveDeps(env = process.env) {
  return { db: adminDb(), fetch: globalThis.fetch, now: () => Date.now(), env, verify: requireAuth, newId: () => crypto.randomUUID() };
}

export default async function handler(req, res) {
  return route(liveDeps(), req, res);
}

export async function route(d, req, res) {
  const action = String(req.query?.action || "");
  res.setHeader?.("Cache-Control", "private, no-store");
  try {
    if (action === "callback" && req.method === "GET") return await callback(d, req, res);
    if (action === "cron" && req.method === "GET") return await cron(d, req, res);
    if (action === "deauthorize" && req.method === "POST") return await deauthorize(d, req, res);
    if (action === "data-deletion" && req.method === "POST") return await dataDeletion(d, req, res);
    if (action === "deletion-status" && req.method === "GET") return await deletionStatus(d, req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    let uid;
    try {
      ({ uid } = await d.verify(req));
    } catch {
      return res.status(401).json({ error: "auth" });
    }
    const body = typeof req.body === "object" && req.body ? req.body : {};
    if (action === "connect") return res.status(200).json(await connect(d, uid, body));
    if (action === "assets") return res.status(200).json(await assets(d, uid, body));
    if (action === "select") return res.status(200).json(await select(d, uid, body));
    if (action === "disconnect") return res.status(200).json(await disconnect(d, uid, body));
    if (action === "sync") return body.stream && typeof res.write === "function" ? await streamSync(d, uid, body, res) : res.status(200).json(await manualSync(d, uid, body));
    if (action === "graph") return res.status(200).json(await proxy(d, uid, body));
    return res.status(404).json({ error: "not-found" });
  } catch (err) {
    const { status, body } = errorReply(err, action);
    return res.status(status).json(body);
  }
}
function errorReply(err, action) {
  if (err instanceof Fail) return { status: err.status, body: { error: err.code } };
  if (err?.code === "not-configured") return { status: 503, body: { error: "not-configured" } };
  if (err instanceof V.GraphError) return { status: err.needsReconnect ? 409 : 502, body: { error: err.needsReconnect ? "reconnect" : "meta", message: err.message } };
  console.error("[meta]", action, err?.message);
  return { status: 500, body: { error: "unknown" } };
}

// "Sinkron sekarang" with a progress bar (js/meta-connect.js syncMetaNow):
// one JSON line per step while the pass runs, then {done, result}. Nothing
// is sent before the first step, so a refusal (not allowed, too soon) still
// comes back as a plain JSON error. If the platform buffers the reply, the
// lines simply arrive together at the end.
async function streamSync(d, uid, body, res) {
  let open = false;
  const line = (obj) => {
    try {
      if (!open) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("X-Accel-Buffering", "no");
        open = true;
      }
      res.write(`${JSON.stringify(obj)}\n`);
    } catch {
      // The person closed the tab; the pass carries on.
    }
  };
  try {
    const result = await manualSync(d, uid, body, line);
    if (!open) return res.status(200).json(result);
    line({ done: true, result });
  } catch (err) {
    if (!open) throw err;
    line(errorReply(err, "sync").body);
  }
  res.end();
}

// ---------- config ----------
const redirectUri = (env) => String(env.META_REDIRECT_URI || env.IG_REDIRECT_URI || `${APP_URL}/api/instagram/callback`).trim();
function fbConfig(env) {
  const appId = String(env.META_APP_ID || "").trim();
  const appSecret = String(env.META_APP_SECRET || "").trim();
  const configId = String(env.META_LOGIN_CONFIG_ID || "").trim();
  if (!appId || !appSecret || !configId) fail("not-configured", 503);
  return { appId, appSecret, configId, redirectUri: redirectUri(env) };
}
function igConfig(env) {
  const appId = String(env.IG_APP_ID || "").trim();
  const appSecret = String(env.IG_APP_SECRET || "").trim();
  if (!appId || !appSecret) fail("not-configured", 503);
  return { appId, appSecret, redirectUri: redirectUri(env) };
}

// ---------- shared ----------
async function read(d, path) {
  const snap = await d.db.doc(path).get();
  return snap.exists ? snap.data() : null;
}
const flagged = (acc) => acc?.metaBeta === true || acc?.instagramBeta === true;
async function mayConnect(d, uid, brand) {
  if (d.env.META_OPEN === "1" || isAdminUid(uid) || isAdminUid(brand.ownerId)) return true;
  if (flagged(await read(d, `accounts/${uid}`))) return true;
  return brand.ownerId !== uid && flagged(await read(d, `accounts/${brand.ownerId}`));
}
// The brand, for someone on it: its owner or a member whose access is on.
async function brandFor(d, uid, brandId) {
  if (!idOk(brandId)) fail("bad-request", 400);
  const brand = await read(d, `brands/${brandId}`);
  if (!brand || brand.deletedAt) fail("not-found", 404);
  const member = (brand.memberIds || []).includes(uid) && Object.keys(memberPerms(brand.members?.[uid])).length > 0;
  if (brand.ownerId !== uid && !member) fail("not-found", 404);
  return { ...brand, id: brandId };
}
export const canManage = (brand, uid) => can(brand, uid, "brand", "edit") && can(brand, uid, "publish", "publish");
export const canSync = (brand, uid) => can(brand, uid, "publish", "publish") || can(brand, uid, "create", "edit");
async function ownerActive(d, brand) {
  if (!accountCanWrite(await read(d, `accounts/${brand.ownerId}`), d.now())) fail("inactive", 403);
}

// Back to where the login started: Pengaturan → Akun Meta (js/meta-connect.js).
const appLink = (query, brandId) => `${APP_URL}/?${new URLSearchParams({ ...query, ...(brandId ? { brand: brandId } : {}) })}#/settings/meta`;
export const DISCONNECTED = {
  instagram: { igUserId: "", username: "", connected: false, connectedAt: null, status: "" },
  facebook: { pageId: "", pageName: "", connected: false, connectedAt: null },
  ads: { adAccountId: "", name: "", currency: "", connected: false, connectedAt: null },
};

// ---------- connect ----------
async function setPending(d, brand, grantId, uid) {
  await d.db.doc(`metaConnections/${brand.id}`).set({ brandId: brand.id, ownerId: brand.ownerId, pendingGrantId: grantId, pendingBy: uid, pendingAt: d.now() }, { merge: true });
}
// A Facebook login this person made before (another brand), still alive:
// picking from it again needs no second trip to Meta.
async function reusableGrants(d, uid) {
  const snap = await d.db.collection("metaGrants").where("ownerUid", "==", uid).get();
  const now = d.now();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((g) => g.via === "facebook" && g.status !== "reconnect" && !userTokenDead(g, now) && ((g.instagram || []).length || (g.pages || []).length));
}
const grantLabel = (g) => [...(g.instagram || []).map((x) => `@${x.username}`), ...(g.pages || []).filter((p) => !(g.instagram || []).some((x) => x.pageId === p.id)).map((p) => p.name)].filter(Boolean).slice(0, 4).join(", ");

async function connect(d, uid, body) {
  const brand = await brandFor(d, uid, body.brandId);
  if (!canManage(brand, uid)) fail("not-allowed", 403);
  if (!(await mayConnect(d, uid, brand))) fail("not-allowed", 403);
  await ownerActive(d, brand);
  const via = body.via === "instagram" ? "instagram" : "facebook";
  if (via === "facebook" && body.reuseGrantId) {
    const g = (await reusableGrants(d, uid)).find((x) => x.id === body.reuseGrantId);
    if (!g) fail("not-found", 404);
    await setPending(d, brand, g.id, uid);
    return { pick: true };
  }
  const cfg = via === "facebook" ? fbConfig(d.env) : igConfig(d.env);
  V.tokenKey(d.env); // no vault key, no login: the token would have nowhere to go
  const state = V.newState();
  await d.db.doc(`metaOauthStates/${V.hashState(state)}`).set({ uid, brandId: brand.id, via, expiresAt: d.now() + V.STATE_TTL_MS });
  const url = via === "facebook"
    ? FB.dialogUrl({ appId: cfg.appId, configId: cfg.configId, redirectUri: cfg.redirectUri, state })
    : IG.authorizeUrl({ appId: cfg.appId, redirectUri: cfg.redirectUri, state });
  const reusable = via === "facebook" && body.offerReuse ? (await reusableGrants(d, uid)).map((g) => ({ grantId: g.id, label: grantLabel(g) })).slice(0, 3) : [];
  return { url, ...(reusable.length ? { reusable } : {}) };
}

async function callback(d, req, res) {
  const q = req.query || {};
  const stateRef = q.state ? d.db.doc(`metaOauthStates/${V.hashState(q.state)}`) : null;
  const saved = stateRef ? (await stateRef.get()).data?.() : null;
  if (stateRef && saved) await stateRef.delete();
  const back = (query) => res.redirect(302, appLink(query, saved?.brandId));
  if (!saved || saved.expiresAt < d.now()) return back({ meta: "error", reason: "expired" });
  if (q.error) return back({ meta: "error", reason: q.error === "access_denied" ? "denied" : "failed" });
  const brand = await read(d, `brands/${saved.brandId}`);
  if (!brand || brand.deletedAt || !canManage({ ...brand, id: saved.brandId }, saved.uid)) return back({ meta: "error", reason: "failed" });
  const b = { ...brand, id: saved.brandId };
  const now = d.now();
  const key = V.tokenKey(d.env);
  const grantId = d.newId();
  try {
    if (saved.via === "facebook") {
      const got = await FB.exchangeCode(d.fetch, { ...fbConfig(d.env), code: String(q.code || "") });
      const found = await FB.discoverAssets(d.fetch, got.token, got.tokenType, got.granted);
      const grant = {
        id: grantId, via: "facebook", ownerUid: saved.uid, tokenType: got.tokenType,
        token: V.sealToken(got.token, key), tokenExpiresAt: FB.tokenExpiry(got, now), tokenIssuedAt: now,
        appUserId: got.appUserId, name: got.name, clientBusinessId: got.clientBusinessId, permissions: got.permissions,
        instagram: found.instagram, igUserIds: found.instagram.map((x) => x.id),
        pages: found.pages.map((p) => ({ id: p.id, name: p.name, igId: p.igId, token: p.token ? V.sealToken(p.token, key) : "" })),
        adAccounts: found.adAccounts, brandIds: [], createdAt: now, status: "ok",
      };
      await d.db.doc(`metaGrants/${grantId}`).set(grant);
      if (!found.instagram.length && !found.pages.length && !found.adAccounts.length) {
        await d.db.doc(`metaGrants/${grantId}`).delete();
        return back({ meta: "error", reason: "nothing" });
      }
      await setPending(d, b, grantId, saved.uid);
      return back({ meta: "pick" });
    }
    const got = await IG.exchangeCode(d.fetch, { ...igConfig(d.env), code: q.code });
    const grant = {
      id: grantId, via: "instagram", ownerUid: saved.uid, tokenType: "instagram",
      token: V.sealToken(got.token, key), tokenExpiresAt: now + got.expiresIn * 1000, tokenIssuedAt: now,
      appUserId: got.appUserId, name: "", clientBusinessId: "", permissions: got.permissions, accountType: got.accountType,
      instagram: [{ id: got.igUserId, username: got.username, pageId: "" }], igUserIds: [got.igUserId],
      pages: [], adAccounts: [], brandIds: [], createdAt: now, status: "ok",
    };
    await d.db.doc(`metaGrants/${grantId}`).set(grant);
    await applySelection(d, b, saved.uid, grant, { igUserId: got.igUserId, pageId: "", adAccountId: "" });
    const insightsOk = got.permissions.length === 0 || got.permissions.includes("instagram_business_manage_insights");
    return back({ meta: insightsOk ? "connected" : "no-insights" });
  } catch (err) {
    console.error("[meta] callback", saved.via, err?.message);
    return back({ meta: "error", reason: "failed" });
  }
}

// ---------- picking ----------
async function grantInPlay(d, brandId) {
  const conn = await read(d, `metaConnections/${brandId}`);
  const gid = conn?.pendingGrantId || conn?.grantId;
  const grant = gid ? await read(d, `metaGrants/${gid}`) : null;
  if (!grant) fail("not-connected", 404);
  return { conn, grant: { ...grant, id: gid } };
}

// The owner's other brands' accounts, so the picker can leave out what
// is already taken: { instagram: {id: brand name}, pages: {…}, ads: {…} }.
async function usedByOthers(d, brand) {
  const snap = await d.db.collection("metaConnections").where("ownerId", "==", brand.ownerId).get();
  const used = { instagram: {}, pages: {}, ads: {} };
  for (const doc of snap.docs) {
    const c = doc.data();
    if (doc.id === brand.id || !c.grantId) continue;
    const name = (await read(d, `brands/${doc.id}`))?.name || "";
    if (c.igUserId) used.instagram[c.igUserId] = name;
    if (c.pageId) used.pages[c.pageId] = name;
    if (c.adAccountId) used.ads[c.adAccountId] = name;
  }
  return used;
}

async function assets(d, uid, { brandId }) {
  const brand = await brandFor(d, uid, brandId);
  if (!canManage(brand, uid)) fail("not-allowed", 403);
  const { conn, grant } = await grantInPlay(d, brandId);
  return {
    brandName: brand.name || "",
    usedBy: await usedByOthers(d, brand),
    via: grant.via,
    pending: !!conn.pendingGrantId,
    who: grant.name || "",
    instagram: (grant.instagram || []).map(({ id, username, pageId }) => ({ id, username, pageId: pageId || "" })),
    pages: (grant.pages || []).map(({ id, name, igId }) => ({ id, name, igId: igId || "" })),
    adAccounts: (grant.adAccounts || []).map(({ id, name, currency, status }) => ({ id, name, currency, status })),
    current: conn.grantId === grant.id ? { igUserId: conn.igUserId || "", pageId: conn.pageId || "", adAccountId: conn.adAccountId || "" } : { igUserId: "", pageId: "", adAccountId: "" },
  };
}

async function select(d, uid, body) {
  const brand = await brandFor(d, uid, body.brandId);
  if (!canManage(brand, uid)) fail("not-allowed", 403);
  await ownerActive(d, brand);
  const { grant } = await grantInPlay(d, brand.id);
  const pick = { igUserId: String(body.igUserId || ""), pageId: String(body.pageId || ""), adAccountId: String(body.adAccountId || "") };
  if (Object.values(pick).some((v) => v && !graphIdOk(v))) fail("bad-request", 400);
  if (!pick.igUserId && !pick.pageId && !pick.adAccountId) fail("bad-request", 400);
  if (pick.igUserId && !(grant.instagram || []).some((x) => x.id === pick.igUserId)) fail("bad-request", 400);
  if (pick.pageId && !(grant.pages || []).some((x) => x.id === pick.pageId)) fail("bad-request", 400);
  if (pick.adAccountId && !(grant.adAccounts || []).some((x) => x.id === pick.adAccountId)) fail("bad-request", 400);
  const pub = await applySelection(d, brand, uid, grant, pick);
  return { ok: true, ...pub };
}

// Writes the brand's choice: the vault entry, the grant's list of brands,
// the public fields on the brand doc. A pasted token from before (the admin's
// brand.instagram.accessToken / facebook.pageAccessToken, maybe moved to
// brands/{id}/private/integrations) is dropped once the vault holds the same job.
async function applySelection(d, brand, uid, grant, pick) {
  const now = d.now();
  const prev = await read(d, `metaConnections/${brand.id}`);
  const ig = (grant.instagram || []).find((x) => x.id === pick.igUserId) || null;
  const page = (grant.pages || []).find((x) => x.id === pick.pageId) || null;
  const ad = (grant.adAccounts || []).find((x) => x.id === pick.adAccountId) || null;
  const sameIg = prev?.grantId && prev.igUserId && prev.igUserId === ig?.id;
  const conn = {
    brandId: brand.id, ownerId: brand.ownerId, grantId: grant.id, via: grant.via,
    igUserId: ig?.id || "", igUsername: ig?.username || "",
    pageId: page?.id || "", pageName: page?.name || "",
    adAccountId: ad?.id || "", adAccountName: ad?.name || "", currency: ad?.currency || "",
    // Posts published after this moment arrive by themselves (planSync).
    connectedAt: sameIg ? prev.connectedAt || now : now,
    connectedBy: uid, lastSyncAt: sameIg ? prev.lastSyncAt || null : null, status: "ok",
  };
  await d.db.doc(`metaConnections/${brand.id}`).set(conn);
  await d.db.doc(`metaGrants/${grant.id}`).update({ brandIds: [...new Set([...(grant.brandIds || []), brand.id])] });
  for (const gid of new Set([prev?.grantId, prev?.pendingGrantId].filter((x) => x && x !== grant.id))) await releaseGrant(d, gid, brand.id);

  const patch = {};
  patch.instagram = ig ? { igUserId: ig.id, username: ig.username, connected: true, via: grant.via, status: "ok", connectedAt: conn.connectedAt, lastSyncAt: conn.lastSyncAt } : DISCONNECTED.instagram;
  if (grant.via === "facebook" || brand.facebook?.connected) {
    patch.facebook = page ? { pageId: page.id, pageName: page.name, connected: true, via: "facebook", connectedAt: now } : DISCONNECTED.facebook;
    patch.ads = ad ? { adAccountId: ad.id, name: ad.name, currency: ad.currency, connected: true, connectedAt: now, status: "ok" } : DISCONNECTED.ads;
  }
  const priv = await read(d, `brands/${brand.id}/private/integrations`);
  if (priv) {
    const keep = { ...priv };
    if (ig) delete keep.instagram;
    if (page) delete keep.facebook;
    await d.db.doc(`brands/${brand.id}/private/integrations`).set(keep);
  }
  if (ig) {
    try {
      const numbers = await IG.fetchAccountNumbers(igApi(d, grant, conn, V.tokenKey(d.env)), ig.id, now);
      Object.assign(patch, IG.insightsPatch(brand, "instagram", numbers, now));
    } catch {
      // Followers come with the first nightly pass instead.
    }
  }
  await d.db.doc(`brands/${brand.id}`).update(patch);
  return { instagram: patch.instagram, facebook: patch.facebook ?? brand.facebook ?? null, ads: patch.ads ?? brand.ads ?? null };
}

// A brand stopped using a grant: the grant goes once no brand uses it.
async function releaseGrant(d, grantId, brandId) {
  const g = await read(d, `metaGrants/${grantId}`);
  if (!g) return;
  const brandIds = (g.brandIds || []).filter((x) => x !== brandId);
  if (brandIds.length) await d.db.doc(`metaGrants/${grantId}`).update({ brandIds });
  else await d.db.doc(`metaGrants/${grantId}`).delete();
}

async function disconnect(d, uid, { brandId }) {
  const brand = await brandFor(d, uid, brandId);
  if (!canManage(brand, uid)) fail("not-allowed", 403);
  const conn = await read(d, `metaConnections/${brandId}`);
  await d.db.doc(`metaConnections/${brandId}`).delete();
  for (const gid of new Set([conn?.grantId, conn?.pendingGrantId].filter(Boolean))) await releaseGrant(d, gid, brandId);
  const patch = { instagram: DISCONNECTED.instagram };
  if (brand.facebook?.connected) patch.facebook = DISCONNECTED.facebook;
  if (brand.ads?.connected) patch.ads = DISCONNECTED.ads;
  await d.db.doc(`brands/${brandId}`).update(patch);
  return { ok: true };
}

// ---------- reading ----------
async function proxy(d, uid, { brandId, path, params = {} }) {
  await brandFor(d, uid, brandId);
  const conn = await read(d, `metaConnections/${brandId}`);
  const grant = conn?.grantId ? await read(d, `metaGrants/${conn.grantId}`) : null;
  if (!grant || !conn.igUserId) fail("not-connected", 404);
  if (!IG.proxyRequestOk(path, params, conn.igUserId)) fail("bad-request", 400);
  const api = igApi(d, grant, conn, V.tokenKey(d.env));
  try {
    return await V.graphGet(api.fetch, api.base, path, params, api.token);
  } catch (err) {
    if (err instanceof V.GraphError && err.needsReconnect) await markReconnect(d, brandId);
    throw err;
  }
}

async function markReconnect(d, brandId) {
  await d.db.doc(`brands/${brandId}`).update({ "instagram.status": "reconnect" }).catch(() => null);
  await d.db.doc(`metaConnections/${brandId}`).update({ status: "reconnect" }).catch(() => null);
}

// ---------- sync ----------
async function manualSync(d, uid, { brandId }, progress) {
  const brand = await brandFor(d, uid, brandId);
  if (!canSync(brand, uid)) fail("not-allowed", 403);
  const conn = await read(d, `metaConnections/${brandId}`);
  if (!conn?.grantId) fail("not-connected", 404);
  if (conn.lastManualSyncAt && d.now() - conn.lastManualSyncAt < IG.MANUAL_SYNC_GAP_MS) fail("too-soon", 429);
  await d.db.doc(`metaConnections/${brandId}`).update({ lastManualSyncAt: d.now() });
  return syncBrand(d, brandId, conn, brand, progress);
}

// Most metric reads one pass makes for one brand; the rest wait a day.
const MAX_READS_PER_PASS = 80;
const MAX_FB_READS = 30;
const FB_RECENT_MS = 35 * 24 * 3600 * 1000;

// progress (optional): told each step, for the bar on "Sinkron sekarang".
export async function syncBrand(d, brandId, conn, brand = null, progress = null) {
  const now = d.now();
  const tell = (step) => {
    try {
      progress?.(step);
    } catch {
      // A progress line never stops the pass.
    }
  };
  brand = brand || (await read(d, `brands/${brandId}`));
  if (!brand || brand.deletedAt) return { skipped: "no-brand" };
  brand = { ...brand, id: brandId };
  if (!accountCanWrite(await read(d, `accounts/${brand.ownerId}`), now)) return { skipped: "inactive" };
  const grantDoc = await read(d, `metaGrants/${conn.grantId}`);
  if (!grantDoc) return { skipped: "no-grant" };
  const grant = { ...grantDoc, id: conn.grantId };
  const key = V.tokenKey(d.env);
  const counts = { updated: 0, linked: 0, added: 0, failed: 0 };
  let igFollowers = null;
  const brandPatch = {};
  try {
    // Instagram Login tokens live 60 days: refreshed with 20 left.
    if (grant.via === "instagram" && IG.needsRefresh(grant, now)) {
      const fresh = await IG.refreshLongLivedToken(d.fetch, V.openToken(grant.token, key));
      const tokenPatch = { token: V.sealToken(fresh.token, key), tokenExpiresAt: now + fresh.expiresIn * 1000, tokenIssuedAt: now };
      await d.db.doc(`metaGrants/${grant.id}`).update(tokenPatch);
      Object.assign(grant, tokenPatch);
    }
    tell({ step: "posts" });
    const contentSnap = await d.db.collection("content").where("brandId", "==", brandId).get();
    const allContent = contentSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((c) => c.ownerId === brand.ownerId && !c.deletedAt);

    if (conn.igUserId) {
      const api = igApi(d, grant, conn, key);
      const media = await IG.listMedia(api, conn.igUserId);
      tell({ step: "posts", found: media.length });
      const content = allContent.filter((c) => !c.platform || c.platform === "Instagram");
      const plan = IG.planSync({ media, content, connectedAt: conn.connectedAt, now });
      const total = Math.min(MAX_READS_PER_PASS, plan.link.length + plan.refresh.length + plan.create.length);
      tell({ step: "numbers", done: 0, total });
      let reads = 0;
      const metricsOf = async (m) => {
        reads++;
        try {
          return await IG.fetchMediaMetrics(api, m);
        } catch (err) {
          if (err instanceof V.GraphError && err.needsReconnect) throw err;
          counts.failed++;
          return null;
        } finally {
          // The post's picture, for the strip on the progress panel.
          tell({ step: "numbers", done: Math.min(reads, total), total, thumb: String(m.thumbnail_url || m.media_url || "").slice(0, 1000) });
        }
      };
      for (const { content: c, media: m } of [...plan.link, ...plan.refresh]) {
        if (reads >= MAX_READS_PER_PASS) break;
        const metrics = await metricsOf(m);
        if (!metrics) continue;
        const linking = !c.publishedUrl;
        const patch = { ...(linking ? IG.publishPatch(m) : {}), ...IG.metricsPatch(c, metrics, m, now) };
        await d.db.doc(`content/${c.id}`).update(patch);
        Object.assign(c, patch);
        counts[linking ? "linked" : "updated"]++;
      }
      for (const m of plan.create) {
        if (reads >= MAX_READS_PER_PASS) break;
        const metrics = (await metricsOf(m)) || {};
        const id = d.newId();
        const doc = IG.newContentDoc({ id, brandId, ownerId: brand.ownerId, media: m, metrics, now });
        await d.db.doc(`content/${id}`).set(doc);
        allContent.push(doc);
        counts.added++;
      }
      tell({ step: "account" });
      try {
        const numbers = await IG.fetchAccountNumbers(api, conn.igUserId, now);
        igFollowers = Number.isFinite(numbers.followers) ? numbers.followers : null;
        Object.assign(brandPatch, IG.insightsPatch(brand, "instagram", numbers, now));
        // The Page's entry below builds on this history, not the stored one.
        if (brandPatch.insightsHistory) brand.insightsHistory = brandPatch.insightsHistory;
        if (numbers.username) brandPatch["instagram.username"] = numbers.username;
      } catch (err) {
        if (err instanceof V.GraphError && err.needsReconnect) throw err;
      }
      Object.assign(brandPatch, { "instagram.status": "ok", "instagram.lastSyncAt": now, "instagram.lastSync": counts });
    }

    const out = { ok: true, ...counts, ...(igFollowers !== null ? { followers: igFollowers } : {}) };
    if (conn.pageId) {
      tell({ step: "page" });
      out.facebook = await syncPage(d, brand, grant, conn, key, allContent, brandPatch, now);
    }
    if (conn.adAccountId) {
      tell({ step: "ads" });
      out.ads = await syncAds(d, brand, grant, conn, key, allContent, brandPatch, now);
    }
    tell({ step: "save" });

    if (Object.keys(brandPatch).length) await d.db.doc(`brands/${brandId}`).update(brandPatch);
    await d.db.doc(`metaConnections/${brandId}`).update({ lastSyncAt: now, status: "ok" });
    return out;
  } catch (err) {
    if (err instanceof V.GraphError && err.needsReconnect) {
      await markReconnect(d, brandId);
      return { reconnect: true };
    }
    throw err;
  }
}

// The Page's followers and 28-day reach, and the numbers of the videos
// Brandlab put on it (posting.fb, api/_igPost.js) in the last five weeks.
async function syncPage(d, brand, grant, conn, key, contents, brandPatch, now) {
  const api = pageApi(d, grant, conn, key);
  if (!api) return { skipped: "no-page-token" };
  const res = { updated: 0, failed: 0 };
  try {
    const n = await FB.fetchPageNumbers(api, conn.pageId);
    Object.assign(brandPatch, IG.insightsPatch(brand, "facebook", n, now));
    if (n.name) brandPatch["facebook.pageName"] = n.name;
  } catch (err) {
    if (err instanceof V.GraphError && err.needsReconnect) {
      brandPatch["facebook.status"] = "reconnect";
      return { reconnect: true };
    }
    res.failed++;
  }
  const videos = contents.filter((c) => c.posting?.fb?.state === "done" && /^\d{5,}$/.test(String(c.posting.fb.id || "")) && now - (Number(c.posting.fb.at) || 0) < FB_RECENT_MS).slice(0, MAX_FB_READS);
  for (const c of videos) {
    try {
      const metrics = await FB.fetchPageVideoMetrics(api, c.posting.fb.id);
      if (!Object.keys(metrics).length) continue;
      await d.db.doc(`content/${c.id}`).update(IG.platformMetricsPatch(c, "facebook", metrics, now));
      res.updated++;
    } catch {
      res.failed++;
    }
  }
  brandPatch["facebook.lastSyncAt"] = now;
  return res;
}

// Ad spend per piece of content into Sales (an "Iklan" expense marked
// automatic), with what Meta reports beside it. Only counts go on the brand
// doc — every member reads that; money stays in Sales, which only people
// with Sales access read (firestore.rules).
async function syncAds(d, brand, grant, conn, key, contents, brandPatch, now) {
  if (userTokenDead(grant, now)) {
    brandPatch["ads.status"] = "reconnect";
    return { reconnect: true };
  }
  const win = FB.adsWindow(now);
  let rows;
  try {
    rows = await FB.fetchAdsByMonth({ fetch: d.fetch, base: V.FB_GRAPH, token: V.openToken(grant.token, key) }, conn.adAccountId, win);
  } catch (err) {
    if (err instanceof V.GraphError && err.needsReconnect) {
      brandPatch["ads.status"] = "reconnect";
      return { reconnect: true };
    }
    brandPatch["ads.lastError"] = String(err?.message || "error").slice(0, 200);
    return { failed: true };
  }
  const plan = FB.adsExpenseEntries(rows, { contents, adAccountId: conn.adAccountId, currency: conn.currency, now });
  if (!plan.currencySkipped) await writeAutoSales(d, brand, plan.entries, win.months, conn.adAccountId);
  const summary = { matched: plan.entries.length, unmatched: plan.unmatched, currencySkipped: plan.currencySkipped, at: now };
  Object.assign(brandPatch, { "ads.status": "ok", "ads.lastSyncAt": now, "ads.lastSync": summary, "ads.lastError": "" });
  return summary;
}

// Each month doc of the window, in a transaction (the app adds and removes
// entries with arrayUnion/arrayRemove meanwhile; a transaction re-reads).
async function writeAutoSales(d, brand, entries, months, adAccountId) {
  for (const month of months) {
    const ref = d.db.doc(`brands/${brand.id}/sales/${month}`);
    const fresh = entries.filter((e) => String(e.date).startsWith(month));
    await d.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data()?.entries || [] : [];
      if (!snap.exists && !fresh.length) return;
      const merged = FB.mergeAutoEntries(existing, fresh, [month], adAccountId);
      const strip = (list) => JSON.stringify(list.map(({ at, meta, ...e }) => ({ ...e, m: meta ? { ...meta, syncedAt: 0 } : null })));
      if (snap.exists && strip(merged) === strip(existing)) return;
      tx.set(ref, { ownerId: brand.ownerId, brandId: brand.id, month, entries: merged });
    });
  }
}

// Nightly. Least recently synced first; stops starting new brands near the
// function's time limit (the rest go first tomorrow). Also sweeps logins
// left half-way (states, grants no brand picked).
const CRON_BUDGET_MS = 240_000;
const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
const ORPHAN_GRANT_MS = 24 * 60 * 60 * 1000;
async function cron(d, req, res) {
  const secret = d.env.CRON_SECRET;
  if (!secret || (req.headers?.authorization || "") !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  const started = d.now();
  const out = { synced: 0, skipped: 0, reconnect: 0, failed: 0, swept: 0 };
  const states = await d.db.collection("metaOauthStates").get();
  for (const doc of states.docs) if ((doc.data().expiresAt || 0) < started) { await d.db.doc(`metaOauthStates/${doc.id}`).delete(); out.swept++; }
  const grants = await d.db.collection("metaGrants").get();
  const pending = new Set((await d.db.collection("metaConnections").get()).docs.map((doc) => doc.data().pendingGrantId).filter(Boolean));
  for (const doc of grants.docs) {
    const g = doc.data();
    if (!(g.brandIds || []).length && started - (g.createdAt || 0) > ORPHAN_GRANT_MS && !pending.has(doc.id)) {
      await d.db.doc(`metaGrants/${doc.id}`).delete();
      out.swept++;
    }
  }
  const snap = await d.db.collection("metaConnections").get();
  const conns = snap.docs.map((doc) => ({ ...doc.data(), brandId: doc.id }))
    .filter((c) => c.grantId && c.status !== "reconnect")
    .sort((a, b) => (a.lastSyncAt || 0) - (b.lastSyncAt || 0));
  for (const conn of conns) {
    if (d.now() - started > CRON_BUDGET_MS) break;
    if (conn.lastSyncAt && started - conn.lastSyncAt < SYNC_EVERY_MS) continue;
    try {
      const r = await syncBrand(d, conn.brandId, conn);
      if (r.reconnect) out.reconnect++;
      else if (r.skipped) out.skipped++;
      else out.synced++;
    } catch (err) {
      out.failed++;
      console.error("[meta cron]", conn.brandId, err?.message);
    }
  }
  return res.status(200).json(out);
}

// ---------- Meta callbacks ----------
function signedPayload(d, req) {
  const body = typeof req.body === "string" ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
  return V.parseSignedRequest(body.signed_request, [d.env.META_APP_SECRET, d.env.IG_APP_SECRET].map((s) => String(s || "").trim()));
}
// Every grant this Meta / Instagram person is behind.
async function grantsOf(d, metaId) {
  const id = String(metaId || "");
  if (!id) return [];
  const [a, b] = await Promise.all([
    d.db.collection("metaGrants").where("appUserId", "==", id).get(),
    d.db.collection("metaGrants").where("igUserIds", "array-contains", id).get(),
  ]);
  const byId = new Map([...a.docs, ...b.docs].map((doc) => [doc.id, doc.data()]));
  return [...byId.entries()].map(([gid, g]) => ({ ...g, id: gid }));
}
// The tokens and the account's identity leave Brandlab. Content the owner
// keeps in their own workspace (cards, numbers they logged) stays theirs.
// Returns the brands that were on those logins.
async function dropGrants(d, grants) {
  const brands = [];
  for (const g of grants) {
    for (const brandId of g.brandIds || []) {
      const conn = await read(d, `metaConnections/${brandId}`);
      if (conn?.grantId === g.id) {
        await d.db.doc(`metaConnections/${brandId}`).delete();
        const patch = { instagram: { ...DISCONNECTED.instagram, status: "removed" } };
        if (g.via === "facebook") Object.assign(patch, { facebook: DISCONNECTED.facebook, ads: DISCONNECTED.ads });
        await d.db.doc(`brands/${brandId}`).update(patch).catch(() => null);
        brands.push(brandId);
      }
    }
    await d.db.doc(`metaGrants/${g.id}`).delete();
  }
  return brands;
}
async function deauthorize(d, req, res) {
  const data = signedPayload(d, req);
  if (!data) return res.status(400).json({ error: "bad-signature" });
  await dropGrants(d, await grantsOf(d, data.user_id));
  return res.status(200).json({ ok: true });
}
// Removing the app with a deletion request: the logins go, and so does what
// Brandlab got from Meta for those brands (purgeMetaData).
async function dataDeletion(d, req, res) {
  const data = signedPayload(d, req);
  if (!data) return res.status(400).json({ error: "bad-signature" });
  const brands = await dropGrants(d, await grantsOf(d, data.user_id));
  let cards = 0;
  for (const brandId of brands) cards += await purgeMetaData(d, brandId);
  const code = crypto.randomBytes(9).toString("base64url");
  await d.db.doc(`metaDeletions/${code}`).set({ at: d.now(), status: "done", connections: brands.length, cards });
  return res.status(200).json({ url: `${APP_URL}/api/instagram/deletion-status?code=${code}`, confirmation_code: code });
}
// Per card: Instagram/Facebook figures, post ids, Meta thumbnails
// (IG.metaPurgePatch). The brand: follower/reach figures from Meta and their
// history. Sales: the automatic ad-spend expenses (meta-ads-…).
async function purgeMetaData(d, brandId) {
  const now = d.now();
  let cards = 0;
  const content = await d.db.collection("content").where("brandId", "==", brandId).get();
  for (const doc of content.docs) {
    const patch = IG.metaPurgePatch(doc.data(), now);
    if (!patch) continue;
    await d.db.doc(`content/${doc.id}`).update(patch);
    cards++;
  }
  const brand = await read(d, `brands/${brandId}`);
  const brandPatch = brand ? IG.brandPurgePatch(brand) : null;
  if (brandPatch) await d.db.doc(`brands/${brandId}`).update(brandPatch);
  const sales = await d.db.collection(`brands/${brandId}/sales`).get();
  for (const doc of sales.docs) {
    const entries = doc.data().entries || [];
    const kept = entries.filter((e) => !(e?.attribution === "auto" && String(e?.id || "").startsWith("meta-ads-")));
    if (kept.length !== entries.length) await d.db.doc(`brands/${brandId}/sales/${doc.id}`).update({ entries: kept });
  }
  return cards;
}
async function deletionStatus(d, req, res) {
  const code = String(req.query?.code || "");
  const row = /^[A-Za-z0-9_-]{6,40}$/.test(code) ? await read(d, `metaDeletions/${code}`) : null;
  const when = row ? new Date(row.at).toISOString().slice(0, 10) : "";
  const text = row
    ? `Permintaan penghapusan data Meta ${code} sudah selesai (${when}). Token akses, identitas akun Instagram/Facebook, serta angka, gambar, dan biaya iklan yang berasal dari Meta sudah dihapus dari Wepeka Brandlab.\n\nMeta data deletion request ${code} is complete (${when}). The access tokens, the Instagram/Facebook account identity, and the numbers, pictures and ad spend received from Meta were removed from Wepeka Brandlab.`
    : "Kode tidak ditemukan. / Code not found.";
  res.setHeader?.("Content-Type", "text/plain; charset=utf-8");
  return res.status(row ? 200 : 404).send(text);
}
