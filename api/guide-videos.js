// Public read of the in-app guide videos (js/guide-videos.js), set from
// wpk-dp's admin (Brandlab > Video Panduan), which writes Firestore
// `meta/guideVideos` with its own Admin SDK. Read here with the Admin SDK
// too, so no Firestore rule has to expose that doc. Nothing secret in it —
// just video URLs — and it's cached at the edge for a minute.
import { adminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const snap = await adminDb().doc("meta/guideVideos").get();
    const raw = snap.data()?.videos || {};
    const videos = {};
    for (const [key, v] of Object.entries(raw)) {
      const src = typeof v?.src === "string" ? v.src.trim() : "";
      if (/^https:\/\//i.test(src)) videos[key] = { src, seconds: Math.max(0, Math.round(Number(v.seconds) || 0)) };
    }
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ videos });
  } catch (err) {
    console.error("[guide-videos] read failed", err);
    return res.status(200).json({ videos: {} });
  }
}
