// Founder Circle for a signed-in Lifetime account (api/_founderCircle.js
// says what it is and where it lives). Same door as api/community.js: the
// sign-in token in, and only a member gets anything back.
//   GET                               → the view (session, recordings, own review/bedah)
//   POST { action: "review", brandId, note?, wa? }
//                                     → asks for the one Brand Book review;
//                                       mails Wepeka's team; 409 if asked before
//   POST { action: "bedah", on, brandId? }
//                                     → signs a brand up to be taken apart in
//                                       a live session (or takes it off)
// A non-member gets { member: false } (the app then shows what Lifetime
// includes instead).
import { adminDb, requireAuth } from "./_firebaseAdmin.js";
import { CIRCLE_DOC, MEMBER_COLLECTION, isCircleMember, circleView, reviewRequest, composeReviewNote } from "./_founderCircle.js";
import { sendEmail, emailConfigured } from "./_email.js";
import { ownerEmails } from "./_ownerNotify.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method" });
  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    return await handleCircleRequest(req, res, { db: adminDb(), uid });
  } catch (err) {
    console.error("[founder-circle] failed", uid, err?.message);
    return res.status(500).json({ error: "unknown" });
  }
}

// The team gets an email per review request (best effort: a failed email
// never fails the request — the admin page lists every request anyway).
async function mailTeam(note, key) {
  const to = emailConfigured() ? ownerEmails() : [];
  await Promise.all(to.map((address, i) => sendEmail({ to: address, ...note, idempotencyKey: `${key}-${i}` }).catch(() => null)));
}

// Everything after the token check — tests drive it with a fake Firestore.
export async function handleCircleRequest(req, res, { db, uid, now = Date.now(), notify = mailTeam }) {
  const accountSnap = await db.doc(`accounts/${uid}`).get();
  const account = accountSnap.exists ? accountSnap.data() : null;
  if (!isCircleMember(uid, account)) return res.status(200).json({ member: false });

  const memberRef = db.doc(`${MEMBER_COLLECTION}/${uid}`);
  const view = async () => {
    const [config, mine] = await Promise.all([db.doc(CIRCLE_DOC).get(), memberRef.get()]);
    return circleView(config.exists ? config.data() : null, mine.exists ? mine.data() : null, now);
  };
  if (req.method === "GET") return res.status(200).json(await view());

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const who = { name: String(account?.displayName || "").slice(0, 80), email: String(account?.email || "").slice(0, 254) };

  // A brand this account owns (its name goes along so the team knows which one).
  const ownBrand = async (brandId) => {
    if (typeof brandId !== "string" || !brandId || brandId.length > 128 || brandId.includes("/")) return null;
    const snap = await db.doc(`brands/${brandId}`).get();
    return snap.exists && snap.data()?.ownerId === uid ? { id: brandId, name: String(snap.data()?.name || "") } : null;
  };

  if (body.action === "review") {
    const brand = await ownBrand(body.brandId);
    if (!brand) return res.status(404).json({ error: "brand" });
    const mine = await memberRef.get();
    if (mine.exists && mine.data()?.review?.status) return res.status(409).json({ error: "already", ...(await view()) });
    const review = reviewRequest({ brandId: brand.id, brandName: brand.name, note: body.note, wa: body.wa }, now);
    await memberRef.set({ review, ...who, updatedAt: now }, { merge: true });
    await notify(composeReviewNote({ ...who, brandName: review.brandName, note: review.note, wa: review.wa, uid }), `brandlab-review-${uid}`);
    return res.status(200).json(await view());
  }

  if (body.action === "bedah") {
    const on = body.on === true;
    const brand = on ? await ownBrand(body.brandId) : null;
    if (on && !brand) return res.status(404).json({ error: "brand" });
    const bedah = on ? { on: true, brandId: brand.id, brandName: brand.name || "Tanpa nama", at: now } : { on: false, at: now };
    await memberRef.set({ bedah, ...who, updatedAt: now }, { merge: true });
    return res.status(200).json(await view());
  }

  return res.status(400).json({ error: "action" });
}
