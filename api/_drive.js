// Google Drive for Video & posting (js/posting.js, js/drive.js). Each person
// connects their OWN Drive once and their videos live there, in folders
// Brandlab makes (Brandlab / brand / month / piece) — so the files are theirs
// and Brandlab keeps no permanent copy (owner, 2026-11-01: "jadi gak makan
// storage brandlabku, makan storage per user"). Scope drive.file only:
// Brandlab sees the files and folders it created, never the rest of a Drive.
//
// The refresh token is the one secret. It never reaches the browser: it is
// sealed (AES-256-GCM with TOKEN_VAULT_KEY) into driveConnections/{uid}, a
// collection firestore.rules has no match for (= closed to every client),
// and the browser only ever gets short-lived access tokens (`token`).
//
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, TOKEN_VAULT_KEY
// (32 random bytes, base64). Missing any → "setup" (503), nothing breaks.
import crypto from "crypto";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_RE = /^#\/[A-Za-z0-9_\-/]*$/;

export class DriveError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function vaultKey(env = process.env) {
  const raw = String(env.TOKEN_VAULT_KEY || "").trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function driveConfigured(env = process.env) {
  return !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && vaultKey(env));
}

export function seal(text, env = process.env) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", vaultKey(env), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function unseal(box, env = process.env) {
  const [iv, tag, enc] = String(box || "").split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", vaultKey(env), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// The OAuth `state`: who started connecting and where to land afterwards,
// signed — the callback comes from Google, not from a signed-in Brandlab tab.
export function signState({ uid, ret = "" }, { now = Date.now(), env = process.env } = {}) {
  const body = Buffer.from(JSON.stringify({ u: uid, r: RETURN_RE.test(ret) ? ret : "", x: now + STATE_TTL_MS, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  const mac = crypto.createHmac("sha256", vaultKey(env)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readState(state, { now = Date.now(), env = process.env } = {}) {
  const [body, mac] = String(state || "").split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", vaultKey(env)).update(body).digest("base64url");
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!s.u || !(s.x > now)) return null;
    return { uid: s.u, ret: RETURN_RE.test(s.r || "") ? s.r : "" };
  } catch {
    return null;
  }
}

// Google only sends people back to a redirect URI registered on the OAuth
// client, so this may follow the host the request came in on.
export function redirectUri(req) {
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? "http" : "https";
  return `${proto}://${host}/api/drive/callback`;
}

export function authUrl({ uid, ret, email, redirect }, { env = process.env } = {}) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState({ uid, ret }, { env }),
  });
  if (email) q.set("login_hint", email);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function googleToken(params, { fetchImpl = fetch, env = process.env } = {}) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, ...params }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json.error === "invalid_grant" ? new DriveError(409, "reconnect") : new DriveError(502, "google");
  return json;
}

// A fresh access token from a stored (sealed) refresh token — the server
// uploading into a client's Drive (api/review/[action].js).
export async function refreshAccess(sealed, { env = process.env, fetchImpl = fetch } = {}) {
  const tok = await googleToken({ refresh_token: unseal(sealed, env), grant_type: "refresh_token" }, { fetchImpl, env });
  return { accessToken: tok.access_token, expiresIn: tok.expires_in || 3600 };
}

// A client (owner, 2026-11-09: Quatro opens Brandlab itself) is a team
// member invited as "Klien" on a brand of Wepeka's (memberships/{uid}
// brands[id].klien). Their own Drive keeps the cuts sent to them, so the
// brands they're a client on say whose Drive that is: clientDrive
// { uid, email, at } on the brand doc (no secret in it).
export function clientBrandIds(membership, isAdminUid) {
  return Object.entries(membership?.brands || {}).filter(([, m]) => m?.klien && !m.disabled && isAdminUid(m.ownerId)).map(([id]) => id);
}
export async function markClientBrands(db, uid, info, isAdminUid) {
  const snap = await db.doc(`memberships/${uid}`).get();
  for (const id of clientBrandIds(snap.exists ? snap.data() : null, isAdminUid)) {
    const ref = db.doc(`brands/${id}`);
    if (info) await ref.update({ clientDrive: { uid, email: info.email || "", at: info.at } });
    else {
      const b = await ref.get();
      if (b.exists && b.data().clientDrive?.uid === uid) await ref.update({ clientDrive: null });
    }
  }
}

// Read straight off Google's token response over TLS, so the id_token's
// signature needs no second check here.
export function emailFromIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8")).email || "";
  } catch {
    return "";
  }
}

// Google → /api/drive/callback. Always ends in a redirect back into the app;
// the app asks `token` afterwards whether it worked.
export async function finishConnect({ code, state, error, redirect, db, env = process.env, fetchImpl = fetch, now = Date.now(), isAdminUid = () => false }) {
  const s = readState(state, { now, env });
  const back = `/${s?.ret || "#/"}`;
  if (!s || error || !code) return { location: back, result: !s ? "expired" : "cancelled" };
  const tok = await googleToken({ code, redirect_uri: redirect, grant_type: "authorization_code" }, { fetchImpl, env });
  // Google's consent screen lets people untick Drive and still continue.
  if (!String(tok.scope || "").split(" ").includes(DRIVE_SCOPE) || !tok.refresh_token) return { location: back, result: "scope" };
  const email = emailFromIdToken(tok.id_token);
  await db.doc(`driveConnections/${s.uid}`).set({ refresh: seal(tok.refresh_token, env), email, scope: tok.scope, connectedAt: now });
  await markClientBrands(db, s.uid, { email, at: now }, isAdminUid);
  return { location: back, result: "ok" };
}

// The signed-in person's own actions: start / token / disconnect.
export async function runDrive({ action, uid, email, ret, redirect, db, env = process.env, fetchImpl = fetch, isAdminUid = () => false }) {
  const ref = db.doc(`driveConnections/${uid}`);
  if (action === "start") return { url: authUrl({ uid, ret, email, redirect }, { env }) };
  if (action === "token") {
    const snap = await ref.get();
    if (!snap.exists) throw new DriveError(404, "not-connected");
    const data = snap.data();
    try {
      const tok = await googleToken({ refresh_token: unseal(data.refresh, env), grant_type: "refresh_token" }, { fetchImpl, env });
      return { accessToken: tok.access_token, expiresIn: tok.expires_in || 3600, email: data.email || "" };
    } catch (e) {
      // Revoked in Google's settings, or expired: start over cleanly.
      if (e.code === "reconnect") { await ref.delete(); await markClientBrands(db, uid, null, isAdminUid); }
      throw e;
    }
  }
  if (action === "disconnect") {
    const snap = await ref.get();
    if (snap.exists) {
      try {
        await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(snap.data().refresh, env))}`, { method: "POST" });
      } catch { /* Google forgets it on its own; the stored copy goes either way */ }
      await ref.delete();
    }
    await markClientBrands(db, uid, null, isAdminUid);
    return { ok: true };
  }
  throw new DriveError(404, "action");
}
