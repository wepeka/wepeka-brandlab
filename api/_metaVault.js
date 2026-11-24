// The server-only vault for Meta connections (Instagram, Facebook Pages,
// Meta Ads), ported from feature/instagram-auto-sync (1e9f5da) and widened
// to the two ways a brand connects (owner, 2026-11-24): Facebook Login for
// Business (Instagram + Page + ad account in one go) and Instagram Login
// (an Instagram professional account without a Page).
//
// Tokens never reach a browser. They sit AES-256-GCM sealed in Firestore
// docs no client rule opens (firestore.rules: metaGrants, metaConnections,
// metaOauthStates, metaDeletions):
//
//   metaGrants/{grantId}       one login = one grant: its sealed token(s),
//                              what Meta let us see (Instagram accounts,
//                              Pages with their sealed Page tokens, ad
//                              accounts), who logged in, which brands use it.
//   metaConnections/{brandId}  what a brand uses from a grant: one Instagram
//                              account, at most one Page and one ad account,
//                              plus sync bookkeeping.
//   metaOauthStates/{sha256}   a login in flight (10 minutes).
//   metaDeletions/{code}       Meta's data-deletion receipts.
//
// The brand doc only carries what the app shows: brand.instagram,
// brand.facebook and brand.ads with `connected: true`, names and ids.
//
// Plain functions over injected data, so tests run without Firestore or
// the network.
import crypto from "node:crypto";

// Graph API version for everything this connection calls (developers.
// facebook.com changelog: v27.0, 4 Nov 2026). The older posting code keeps
// its own (api/_igPost.js).
export const GRAPH_VERSION = "v27.0";
export const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const IG_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

export const STATE_TTL_MS = 10 * 60 * 1000;

// ---------- tokens at rest ----------
// IG_TOKEN_KEY: 32 random bytes, base64 (openssl rand -base64 32). One key
// for every Meta token; rotating it means everyone connects again.
export function tokenKey(env = process.env) {
  const key = Buffer.from(String(env.IG_TOKEN_KEY || ""), "base64");
  if (key.length !== 32) throw Object.assign(new Error("IG_TOKEN_KEY must be 32 bytes, base64"), { status: 500, code: "not-configured" });
  return key;
}
export function sealToken(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}
export function openToken(sealed, key) {
  const [v, iv, tag, body] = String(sealed || "").split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("bad sealed token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- OAuth state ----------
export function newState() {
  return crypto.randomBytes(24).toString("base64url");
}
// Only the hash is stored: a leaked states collection can't finish anyone's login.
export function hashState(state) {
  return crypto.createHash("sha256").update(String(state)).digest("hex");
}

// ---------- Meta's signed callbacks ----------
// Deauthorize / data-deletion POST signed_request =
// "<base64url HMAC-SHA256 of payload>.<base64url JSON payload>", signed with
// the app secret: the Meta app's for Facebook Login, the Instagram app's
// for Instagram Login. Anything no secret verifies is null.
export function parseSignedRequest(signedRequest, secrets) {
  const [sig, payload] = String(signedRequest || "").split(".");
  if (!sig || !payload) return null;
  const given = Buffer.from(sig, "base64url");
  for (const secret of [].concat(secrets).filter(Boolean)) {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest();
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) continue;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return data && String(data.algorithm || "").toUpperCase() === "HMAC-SHA256" ? data : null;
    } catch {
      return null;
    }
  }
  return null;
}
export function signRequestForTest(data, appSecret) {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...data })).toString("base64url");
  return `${crypto.createHmac("sha256", appSecret).update(payload).digest("base64url")}.${payload}`;
}

// ---------- Graph calls ----------
export class GraphError extends Error {
  constructor(message, { status = 502, code = null, subcode = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
  // Token gone (expired, revoked, password changed, app removed from the
  // business): the owner has to connect again — retrying won't help.
  get needsReconnect() {
    return this.code === 190 || this.status === 401;
  }
}

// GET `${base}${path}` with the token; Meta's error answer throws GraphError.
export async function graphGet(fetchImpl, base, path, params, token) {
  const url = new URL(`${base}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && url.searchParams.set(k, String(v)));
  if (token) url.searchParams.set("access_token", token);
  const res = await fetchImpl(url.toString(), { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new GraphError(e.message || json.error_message || `Meta API ${res.status}`, { status: res.status, code: e.code ?? null, subcode: e.error_subcode ?? null });
  }
  return json;
}

// Every page of a list edge, up to maxItems.
export async function graphList(fetchImpl, base, path, params, token, { maxItems = 200 } = {}) {
  const out = [];
  let after;
  while (out.length < maxItems) {
    const json = await graphGet(fetchImpl, base, path, { ...params, limit: params?.limit || 100, after }, token);
    out.push(...(json.data || []));
    after = json.paging?.cursors?.after;
    if (!json.paging?.next || !after || !json.data?.length) break;
  }
  return out.slice(0, maxItems);
}
