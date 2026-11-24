// Wepeka Billboard inside Brandlab (owner, 2026-11-24: "Menampilkan update
// terbaru dari Wepeka Billboard … link menuju konten lengkap … jangan membuat
// sistem publikasi baru"). Brandlab only READS the Billboard that lives on
// wepeka.com (wpk-dp, Supabase `billboard_posts`): its public card feed,
// trimmed to what a card shows. Writing stays in wepeka.com's admin.
//
// Source order: /api/billboard/latest (the live wall, newest first) and,
// while that isn't deployed on wepeka.com yet, /api/billboard/feed page 1
// (stories that already left the wall) — the page says which it got.
export const WEPEKA_ORIGIN = "https://www.wepeka.com";
const MAX = 12;
const SLUG = /^[a-z0-9][a-z0-9-]{0,160}$/;
const https = (u) => (typeof u === "string" && /^https:\/\//i.test(u.trim()) ? u.trim() : "");
const text = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// One card: nothing but plain fields, the link always to the story's own
// page on wepeka.com, a bad row dropped instead of breaking the page.
export function cardOf(p, origin = WEPEKA_ORIGIN) {
  const slug = String(p?.slug || "");
  const title = text(p?.title, 200);
  if (!SLUG.test(slug) || !title) return null;
  const at = Date.parse(p?.publishedAt || "");
  return {
    id: text(p?.id, 64) || slug,
    title,
    excerpt: text(p?.excerpt, 400),
    cover: https(p?.coverImageUrl),
    category: text(p?.category, 24),
    readMinutes: Math.max(1, Math.min(60, Math.round(Number(p?.readMinutes) || 1))),
    publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    url: `${origin}/community/billboard/${slug}`,
  };
}

export function cardsOf(json, origin = WEPEKA_ORIGIN) {
  const list = Array.isArray(json?.posts) ? json.posts : [];
  const seen = new Set();
  return list.map((p) => cardOf(p, origin)).filter((c) => c && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""))
    .slice(0, MAX);
}

// Fetch with a timeout: wepeka.com being slow must not hang Brandlab's page.
async function getJSON(url, fetchImpl, ms = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return { status: res.status, json: null };
    return { status: res.status, json: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadBillboard({ fetchImpl = fetch, origin = WEPEKA_ORIGIN, lang = "id" } = {}) {
  const latest = await getJSON(`${origin}/api/billboard/latest?limit=${MAX}${lang === "en" ? "&lang=en" : ""}`, fetchImpl).catch(() => ({ status: 0, json: null }));
  if (latest.json) return { source: "latest", posts: cardsOf(latest.json, origin), wallUrl: `${origin}/community/billboard` };
  const feed = await getJSON(`${origin}/api/billboard/feed?page=1`, fetchImpl).catch(() => ({ status: 0, json: null }));
  if (feed.json) return { source: "archive", posts: cardsOf(feed.json, origin), wallUrl: `${origin}/community/billboard` };
  return { source: "none", posts: [], wallUrl: `${origin}/community/billboard` };
}
