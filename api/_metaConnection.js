// Which token does which job for a brand's Meta connection (the vault in
// api/_metaVault.js): shared by api/instagram/[action].js (sync, proxy) and
// the posting side (api/instagram/post.js, api/_igPostRun.js).
//
// - Instagram Login: its own token on graph.instagram.com.
// - Facebook Login for Business, BISU token (the configuration's choice):
//   that token on graph.facebook.com, for Instagram, the Page and ads.
// - Facebook Login for Business, user token: Instagram and Page work on the
//   Page token (they don't expire), ads on the 60-day user token.
import { openToken, tokenKey, FB_GRAPH, IG_GRAPH } from "./_metaVault.js";

export function igApi(d, grant, conn, key) {
  if (grant.via === "instagram") return { fetch: d.fetch, base: IG_GRAPH, token: openToken(grant.token, key) };
  if (grant.tokenType !== "system") {
    const ig = (grant.instagram || []).find((x) => x.id === conn.igUserId);
    const page = (grant.pages || []).find((p) => p.id === ig?.pageId && p.token);
    if (page) return { fetch: d.fetch, base: FB_GRAPH, token: openToken(page.token, key) };
  }
  return { fetch: d.fetch, base: FB_GRAPH, token: openToken(grant.token, key) };
}

export function pageApi(d, grant, conn, key) {
  const page = (grant.pages || []).find((p) => p.id === conn.pageId);
  if (page?.token) return { fetch: d.fetch, base: FB_GRAPH, token: openToken(page.token, key) };
  return grant.tokenType === "system" ? { fetch: d.fetch, base: FB_GRAPH, token: openToken(grant.token, key) } : null;
}

export const userTokenDead = (grant, now) => grant.via === "facebook" && grant.tokenType !== "system" && !!grant.tokenExpiresAt && grant.tokenExpiresAt <= now;

async function read(d, path) {
  const snap = await d.db.doc(path).get();
  return snap.exists ? snap.data() : null;
}

// A brand's Instagram account and Facebook Page for posting, tokens opened:
// { via, account?: {igUserId, username, token, base, brandId}, page?: {pageId, name, token, brandId} },
// or null when the brand has no vault connection (the admin's pasted
// tokens are then api/_igPost.js accountFor/facebookFor's job).
export async function postingAccounts(d, brandId) {
  const conn = await read(d, `metaConnections/${brandId}`);
  if (!conn?.grantId || conn.status === "reconnect") return null;
  const grant = await read(d, `metaGrants/${conn.grantId}`);
  if (!grant) return null;
  const key = tokenKey(d.env);
  const out = { via: grant.via };
  if (conn.igUserId) {
    const api = igApi(d, grant, conn, key);
    out.account = { igUserId: conn.igUserId, username: conn.igUsername || "", token: api.token, base: api.base, brandId };
  }
  if (conn.pageId) {
    const api = pageApi(d, grant, conn, key);
    if (api) out.page = { pageId: conn.pageId, name: conn.pageName || "Facebook", token: api.token, brandId };
  }
  return out.account || out.page ? out : null;
}
