// /api/papan — Papan guest links: a board opened by people outside the
// brand's team, without a Brandlab account ("siapa pun yang punya link").
//
//   POST {action:"share", brandId, boardId, on, role, rotate?}   owner or editor
//        → { share: {on, role, t} }. Turns the board's guest link on or off,
//          sets what guests may do ("edit" = coret-coret, "view" = lihat saja);
//          rotate makes a new link and the old one stops working at once.
//   POST {action:"join", brandId, boardId, t, name?, key}        no sign-in
//        → { token, uid, name, role, ownerId, board, brand, people }: a
//          Firebase custom token for a guest uid (pg-…, from the browser's own
//          random key) whose "papan" claim names this brand, board and link
//          secret. No name = straight in as "Tamu N" (or the name this browser
//          had before); joining again with a name renames the guest.
//
// The secret lives on the board doc (share.t, which the team can read) and in
// the Realtime Database at papanShare/{brandId}/{boardId} (server-only), and
// firestore.rules / database.rules.json compare the guest's claim with it on
// every read and write — so turning the link off locks guests out right away.
// Guests never see the brand's data: the board's Brandlab components stay
// blank for them. Their AI (api/ai.js, papanGuestPayer) is paid from the
// owner's credits, GUEST_AI_PER_DAY answers per guest per day.
//
// Errors: { error } 400 bad-request, 401 auth, 403 not-editor, 404 not-found,
// 409 owner-inactive, 410 link-off.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { adminDb, adminAuth, adminRtdb, requireAuth } from "./_firebaseAdmin.js";
import { accountCanWrite, isActiveBrand } from "./brands/recount.js";
import { isAdminUid } from "./_aiQuota.js";

export class PapanError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new PapanError(code, status);
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET = /^[A-Za-z0-9_-]{20,64}$/;

export const newLinkSecret = () => randomBytes(18).toString("base64url");
// One guest id per browser (its random key), the same on every board.
export const guestUid = (key) => "pg-" + createHash("sha256").update(String(key)).digest("hex").slice(0, 24);
export function cleanGuestName(v) {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}
export function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
// Who may change a board's guest link: the owner, or an editor whose seat
// isn't paused (the same people firestore.rules let write the board).
export function canShareBoard(brand, uid) {
  if (!brand || !uid) return false;
  if (brand.ownerId === uid) return true;
  const m = brand.members?.[uid];
  return m?.role === "editor" && !m.seatPaused;
}

export function papanDeps() {
  return { db: adminDb(), auth: adminAuth(), rtdb: adminRtdb(), now: () => Date.now() };
}

async function loadBoard(d, brandId, boardId) {
  if (!ID.test(String(brandId || "")) || !ID.test(String(boardId || ""))) fail("bad-request", 400);
  const boardRef = d.db.doc(`brands/${brandId}/boards/${boardId}`);
  const [brandSnap, boardSnap] = await Promise.all([d.db.doc(`brands/${brandId}`).get(), boardRef.get()]);
  const brand = brandSnap.exists ? { id: brandSnap.id, ...brandSnap.data() } : null;
  if (!brand || !isActiveBrand(brand) || !boardSnap.exists) fail("not-found", 404);
  const acc = (await d.db.doc(`accounts/${brand.ownerId}`).get()).data();
  if (!isAdminUid(brand.ownerId) && !accountCanWrite(acc, d.now())) fail("owner-inactive", 409);
  return { brand, board: boardSnap.data(), boardRef };
}

export async function share(d, caller, body) {
  const { brandId, boardId } = body;
  const { brand, board, boardRef } = await loadBoard(d, brandId, boardId);
  if (!canShareBoard(brand, caller.uid)) fail("not-editor", 403);
  const cur = board.share || {};
  const role = body.role === "view" ? "view" : "edit";
  const t = !cur.t || body.rotate ? newLinkSecret() : cur.t;
  const on = !!body.on;
  await boardRef.update({ share: { on, role, t, by: caller.uid, at: d.now() } });
  if (d.rtdb) await d.rtdb.ref(`papanShare/${brandId}/${boardId}`).set({ on, role, t, owner: brand.ownerId });
  return { share: { on, role, t } };
}

export async function join(d, body) {
  const { brandId, boardId, t, key } = body;
  if (!SECRET.test(String(t || "")) || !SECRET.test(String(key || ""))) fail("bad-request", 400);
  const { brand, board, boardRef } = await loadBoard(d, brandId, boardId);
  const s = board.share || {};
  if (!s.on || !sameSecret(s.t, t)) fail("link-off", 410);
  const role = s.role === "view" ? "view" : "edit";
  const uid = guestUid(key);
  // Names the team sees next to what the guest made (js/papan/bridge.js profiles).
  const guests = boardRef.collection("guests");
  const before = await guests.doc(uid).get();
  let name = cleanGuestName(body.name) || (before.exists ? before.data().name : "");
  if (!name) name = `Tamu ${((await guests.count().get()).data().count || 0) + 1}`;
  await guests.doc(uid).set({ name, at: d.now(), ownerId: brand.ownerId, brandId, boardId }, { merge: true });
  const token = await d.auth.createCustomToken(uid, { papan: { b: brandId, k: boardId, t: s.t, r: role } });
  let ownerName = brand.ownerName || "";
  if (!ownerName) {
    try {
      ownerName = (await d.auth.getUser(brand.ownerId)).displayName || "";
    } catch {
      /* the owner keeps the generic name */
    }
  }
  const people = { [brand.ownerId]: ownerName || "Pemilik" };
  for (const [id, m] of Object.entries(brand.members || {})) if (m?.name) people[id] = m.name;
  return {
    token, uid, name, role, ownerId: brand.ownerId,
    board: { name: board.name || "Papan" },
    brand: { name: brand.name || "", color: brand.color || "" },
    people,
  };
}

// ---------- guests' AI (api/ai.js) ----------
export const GUEST_AI_PER_DAY = 10;
// Who pays for a guest's AI call: the brand owner, while the guest's link
// (the papan claim on their token) is still the board's current one.
export async function papanGuestPayer(db, claim) {
  const { b, k, t } = claim || {};
  if (!ID.test(String(b || "")) || !ID.test(String(k || ""))) return { error: "link-off" };
  const snap = await db.doc(`brands/${b}/boards/${k}`).get();
  const s = snap.exists ? snap.data().share || {} : {};
  if (!s.on || !sameSecret(s.t, t)) return { error: "link-off" };
  return { payerUid: snap.data().ownerId, team: true, guest: true };
}
// One of today's GUEST_AI_PER_DAY answers for this guest, or false. A call
// that brings no answer gives it back (releaseGuestAi).
export async function reserveGuestAi(db, uid, day) {
  const ref = db.doc(`papanGuestAi/${uid}`);
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    const used = cur.day === day ? cur.used || 0 : 0;
    if (used >= GUEST_AI_PER_DAY) return false;
    tx.set(ref, { day, used: used + 1 });
    return true;
  });
}
export async function releaseGuestAi(db, uid, day) {
  const ref = db.doc(`papanGuestAi/${uid}`);
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    if (cur.day === day && cur.used > 0) tx.set(ref, { day, used: cur.used - 1 });
  });
}

export async function runPapan(d, action, caller, body) {
  if (action === "join") return join(d, body);
  if (action === "share") {
    if (!caller) fail("auth", 401);
    return share(d, caller, body);
  }
  fail("bad-request", 400);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const action = String(body.action || "");
  try {
    let caller = null;
    if (action === "share") {
      try {
        caller = await requireAuth(req);
      } catch {
        fail("auth", 401);
      }
    }
    const out = await runPapan(papanDeps(), action, caller, body);
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    if (err instanceof PapanError) return res.status(err.status).json({ error: err.code });
    console.error("[papan]", action, err);
    return res.status(500).json({ error: "unknown" });
  }
}
