// Public read of the in-app guide videos (js/guide-videos.js), set from
// wpk-dp's admin (Brandlab > Video Panduan), which writes Firestore
// `meta/guideVideos` with its own Admin SDK. Read here with the Admin SDK
// too, so no Firestore rule has to expose that doc. Nothing secret in it —
// just video URLs and titles — and it's cached at the edge for a minute.
import { adminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const snap = await adminDb().doc("meta/guideVideos").get();
    const raw = snap.data()?.videos || {};
    const videos = {};
    const okSrc = (src) => typeof src === "string" && /^https:\/\//i.test(src.trim());
    const secs = (n) => Math.max(0, Math.round(Number(n) || 0));
    for (const [key, v] of Object.entries(raw)) {
      // `parts`: the admin can split one guide into several titled videos;
      // `src`/`seconds` stay the first part, for older app builds.
      const parts = (Array.isArray(v?.parts) ? v.parts : [])
        .filter((p) => okSrc(p?.src))
        .slice(0, 20)
        .map((p) => ({ title: String(p.title || "").trim().slice(0, 120), src: p.src.trim(), seconds: secs(p.seconds) }));
      if (parts.length) videos[key] = { src: parts[0].src, seconds: secs(v.seconds) || parts[0].seconds, parts };
      else if (okSrc(v?.src)) videos[key] = { src: v.src.trim(), seconds: secs(v.seconds) };
    }
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ videos });
  } catch (err) {
    console.error("[guide-videos] read failed", err);
    return res.status(200).json({ videos: {} });
  }
}
