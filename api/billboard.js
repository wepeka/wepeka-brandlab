// GET /api/billboard — the WPK Billboard cards for Brandlab's page
// (js/views/billboard.js). Public stories from wepeka.com, read server-side
// so the browser needs no cross-site call; cached at the edge 10 minutes.
// Read-only — see api/_billboard.js.
import { loadBillboard } from "./_billboard.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  try {
    const lang = req.query?.lang === "en" ? "en" : "id";
    const out = await loadBillboard({ lang });
    res.setHeader("Cache-Control", out.posts.length ? "public, s-maxage=600, stale-while-revalidate=3600" : "public, s-maxage=60");
    return res.status(200).json(out);
  } catch (err) {
    console.error("[billboard]", err?.message || err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ source: "none", posts: [], wallUrl: "https://www.wepeka.com/community/billboard" });
  }
}
