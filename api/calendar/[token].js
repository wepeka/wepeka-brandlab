// Calendar subscription (Settings → Pengingat → Langganan kalender): an
// iCalendar feed of the owner's pending uploads, at
// /api/calendar/<settings/{uid}.reminders.calendarToken>. The long random
// token IS the access check — anyone with the link can read the feed, which
// is why the owner can make a new one ("Buat link baru") and the old one
// then stops working right away. Built by buildCalendar() in
// api/_reminders.js.
//
// Reads: one single-field query on settings (reminders.calendarToken ==),
// then the owner's content + brands by ownerId (the same single-field
// queries the app itself uses) — no composite index.
import { adminDb } from "../_firebaseAdmin.js";
import { CALENDAR_TOKEN_RE, CONTENT_FIELDS, BRAND_FIELDS, normalizeReminders, buildCalendar } from "../_reminders.js";

function notFound(res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).send("Not found");
}

const OPEN_STATUSES = ["idea", "draft", "production", "editing", "scheduled"];

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).send("Method not allowed");
  // Some calendar apps like a file name on the end — accept /<token>.ics too.
  const token = String(req.query?.token || "").replace(/\.ics$/i, "");
  if (!CALENDAR_TOKEN_RE.test(token)) return notFound(res);

  try {
    const db = adminDb();
    const found = await db.collection("settings").where("reminders.calendarToken", "==", token).limit(2).get();
    // Two docs with one token can only come from a copied settings doc
    // (e.g. a backup imported into another account) — serve neither.
    if (found.size !== 1) return notFound(res);
    const settingsDoc = found.docs[0];
    const uid = settingsDoc.id;
    const rem = normalizeReminders(settingsDoc.data()?.reminders);
    if (rem.calendarToken !== token) return notFound(res);

    // Only pieces that can still be on the schedule — published/archived
    // posts never are, and an owner with years of posts would otherwise be
    // re-read on every calendar poll. Equality + `in` needs no composite
    // index; if Firestore ever asks for one, fall back to the owner filter.
    const contentQuery = async () => {
      const base = db.collection("content").where("ownerId", "==", uid);
      try {
        return await base.where("status", "in", OPEN_STATUSES).select(...CONTENT_FIELDS).get();
      } catch (err) {
        if (err?.code !== 9 && !/FAILED_PRECONDITION|index/i.test(String(err?.message))) throw err;
        console.warn("calendar feed: status filter needs an index, using owner-only query");
        return base.select(...CONTENT_FIELDS).get();
      }
    };
    const [contentSnap, brandsSnap] = await Promise.all([
      contentQuery(),
      db.collection("brands").where("ownerId", "==", uid).select(...BRAND_FIELDS).get(),
    ]);
    const brandsById = new Map(brandsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    const items = contentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ics = buildCalendar({ items, brandsById, lang: rem.lang });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="brandlab.ics"');
    // Vercel's CDN answers repeat polls for 15 minutes (the secret token is
    // part of the path, so each owner's feed is its own cache entry) — a
    // calendar set to refresh every few minutes can't run up reads. A rotated
    // link stops within those 15 minutes.
    res.setHeader("Cache-Control", "public, max-age=900, s-maxage=900");
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(200).send(req.method === "HEAD" ? "" : ics);
  } catch (err) {
    console.error("calendar feed failed", err?.message);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send("Error");
  }
}
