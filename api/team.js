// /api/team — Kerja Tim: a brand owner shares brands with their own team.
// The only writer of membership (brand.members / brand.memberIds,
// memberships/{uid}) and of invites: firestore.rules let no client touch
// them. One function for every action (the project is past Vercel Hobby's
// function count; one file keeps it there).
//
//   GET  ?action=preview&token=…            who invites, which brands, for which (masked) email — no sign-in
//   POST {action:"invite", brandIds, email, role}   owner → { link, emailSent }
//   POST {action:"rotate", inviteId, send?}         owner: a fresh link (old one stops working), optionally re-emailed
//   POST {action:"revoke", inviteId}                owner
//   POST {action:"accept", token}                   signed in with the invited, verified email
//   POST {action:"code-start", token}               6-digit code to the invited email (sign-up / unverified email)
//   POST {action:"code-finish", token, code, name?, password?}
//        signed in: marks the email verified and accepts;
//        signed out: creates the account (verified) and accepts — the app then signs in.
//        An unverified account already on that email is taken over the way
//        a password reset would (new password, old sign-ins ended); a
//        verified one is left alone (409 account-exists).
//   POST {action:"role", brandId, memberUid, role}  owner
//   POST {action:"access", brandId, memberUid, enabled}  owner: a member's access to one brand on/off
//        (off = can't open it, stays on the list and keeps their seat, chats and work)
//   POST {action:"remove", memberUid, brandIds?}    owner (all their brands when brandIds is left out)
//   POST {action:"leave", brandIds?}                a member leaves (all of that owner's… every shared brand when left out)
//   POST {action:"sync"}                            owner: rebuild the memberships index from the brands
//                                                    and pause/unpause members against the seats
//
// Errors: { error: code } with 400 bad-request/self/weak-password,
// 401 auth, 403 not-owner/email-mismatch/unverified/code-wrong,
// 404 not-found, 409 seats-full/already-member/owner-inactive/account-exists,
// 410 expired/revoked/used/code-expired, 429 too-soon/too-many/code-locked/
// code-limit (5 codes a day per email)/code-locked-day (10 wrong a day)/
// mail-limit (the day's team emails are used up — share the link instead).
import { FieldValue, FieldPath } from "firebase-admin/firestore";
import { adminDb, adminAuth, adminRtdb, requireAuth } from "./_firebaseAdmin.js";
import { accountCanWrite, isActiveBrand } from "./brands/recount.js";
import { teamSeatsFor } from "./_plans.js";
import { isAdminUid } from "./_aiQuota.js";
import { sendEmail } from "./_email.js";
import { APP_URL } from "./_reminders.js";
import {
  ROLES, INVITE_TTL_MS, CODE_TTL_MS, RESEND_GAP_MS, MAX_PENDING_INVITES, TEAM_EMAIL_FROM_DEFAULT, CODE_DAY_SENDS, CODE_DAY_WRONG,
  teamMailDay, takeMailSlot, normalizeEmail, maskEmail, newToken, hashToken, newCode, hashCode, codeCheck, codeGuardId, guardToday, inviteState, seatsUsed,
  pausedMembers, inviteLink, composeInviteEmail, composeCodeEmail,
} from "./_team.js";

export class TeamError extends Error {
  constructor(code, status, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
const fail = (code, status, extra) => {
  throw new TeamError(code, status, extra);
};

const idOk = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const idList = (v, max = 20) => (Array.isArray(v) && v.length && v.length <= max && v.every(idOk) ? [...new Set(v)] : null);
const SECRET_KEYS = { instagram: ["accessToken"], facebook: ["pageAccessToken"] };

// Brand fields that must not stay readable once members can read the brand
// doc: the Instagram/Facebook/ads tokens (→ private/integrations) and the
// owner's own chat sessions (→ people/{owner}). Returns the writes to make,
// or null when there is nothing to move.
export function firstShareScrub(brand) {
  const secrets = {};
  const brandPatch = {};
  for (const [field, keys] of Object.entries(SECRET_KEYS)) {
    const v = brand[field];
    if (!v || typeof v !== "object" || !keys.some((k) => v[k])) continue;
    secrets[field] = Object.fromEntries(keys.filter((k) => v[k]).map((k) => [k, v[k]]));
    brandPatch[field] = Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
  }
  if (brand.ads && typeof brand.ads === "object") {
    const tokens = Object.entries(brand.ads).filter(([k]) => /token/i.test(k));
    if (tokens.length) {
      secrets.ads = Object.fromEntries(tokens);
      brandPatch.ads = Object.fromEntries(Object.entries(brand.ads).filter(([k]) => !/token/i.test(k)));
    }
  }
  const personal = {};
  if (brand.chatSessions !== undefined) personal.chatSessions = brand.chatSessions;
  if (brand.companion !== undefined) personal.companion = brand.companion;
  const hasSecrets = Object.keys(secrets).length > 0;
  const hasPersonal = Object.keys(personal).length > 0;
  if (!hasSecrets && !hasPersonal) return null;
  if (hasPersonal) {
    brandPatch.chatSessions = FieldValue.delete();
    brandPatch.companion = FieldValue.delete();
  }
  return { secrets: hasSecrets ? secrets : null, personal: hasPersonal ? personal : null, brandPatch };
}

export function teamDeps(req = {}) {
  return {
    db: adminDb(),
    auth: adminAuth(),
    rtdb: adminRtdb(),
    send: (msg) => sendEmail({ ...msg, from: String(process.env.TEAM_EMAIL_FROM || "").trim() || TEAM_EMAIL_FROM_DEFAULT }),
    now: () => Date.now(),
    origin: String(req.headers?.origin || ""),
  };
}

async function optionalCaller(req) {
  if (!/^Bearer /.test(req.headers?.authorization || "")) return null;
  try {
    return await requireAuth(req);
  } catch {
    return null;
  }
}

const ownerBrandsQuery = (db, ownerId) => db.collection("brands").where("ownerId", "==", ownerId);
const ownerInvitesQuery = (db, ownerId) => db.collection("invites").where("ownerId", "==", ownerId);
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const seatLimit = (ownerId, account, now = Date.now()) => (isAdminUid(ownerId) ? Infinity : teamSeatsFor(account, now));
const displayNameOf = (user, account) => String(account?.displayName || user?.displayName || (user?.email || "").split("@")[0] || "Pemilik brand").slice(0, 80);

// The Realtime Database's copy of who is on a brand — teams/{brandId} =
// { uid: "owner" | "editor" | "viewer" } — which its rules read for the
// live layer (presence, cursors, the Script written together). Rebuilt
// from the brand docs after every team change; skipped where the database
// isn't set up. Best effort: the Firestore team is the truth.
export async function mirrorTeams(d, brandIds) {
  if (!d.rtdb || !brandIds?.length) return;
  for (const id of new Set(brandIds)) {
    try {
      const snap = await d.db.doc(`brands/${id}`).get();
      const b = snap.exists ? snap.data() : null;
      const members = Object.entries(b?.members || {});
      const ref = d.rtdb.ref(`teams/${id}`);
      if (!b || !members.length || b.deletedAt) await ref.remove();
      else await ref.set({ [b.ownerId]: "owner", ...Object.fromEntries(members.filter(([, m]) => !m?.disabled).map(([uid, m]) => [uid, m.role === "editor" && !m.seatPaused ? "editor" : "viewer"])) });
    } catch (e) {
      console.warn("[team] live team copy not updated", id, e?.message);
    }
  }
}

// Seats against the team (api/_team.js pausedMembers): sets or clears
// members.{uid}.seatPaused on the owner's brands where it changed — the
// rules and resolvePayer treat a paused editor as a viewer — and copies it
// to the live layer. Run after someone leaves or is removed, by `sync`
// (the owner's app runs it after buying a seat) and by the daily cron
// (api/cron/check-expiry.js: a smaller plan, a lapsed extra seat).
export async function reconcileSeats(d, ownerId) {
  const now = d.now();
  const out = await d.db.runTransaction(async (tx) => {
    const accSnap = await tx.get(d.db.doc(`accounts/${ownerId}`));
    const account = accSnap.exists ? accSnap.data() : null;
    const brands = docs(await tx.get(ownerBrandsQuery(d.db, ownerId)));
    const paused = pausedMembers(brands, seatLimit(ownerId, account, now));
    const changed = [];
    for (const b of brands) {
      const updates = [];
      for (const [uid, m] of Object.entries(b.members || {})) {
        const want = paused.has(uid);
        if (!!m?.seatPaused !== want) updates.push(new FieldPath("members", uid, "seatPaused"), want ? true : FieldValue.delete());
      }
      if (!updates.length) continue;
      tx.update(d.db.doc(`brands/${b.id}`), ...updates);
      changed.push(b.id);
    }
    return { changed, paused: paused.size };
  });
  if (out.changed.length) await mirrorTeams(d, out.changed);
  return out;
}

// One team email from `ownerId` within the day's allowance (api/_team.js
// takeMailSlot): true = send it, false = the link goes out another way.
export async function reserveTeamMail(d, ownerId) {
  const ref = d.db.doc(`teamMail/${teamMailDay(d.now())}`);
  return d.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = takeMailSlot(snap.exists ? snap.data() : null, ownerId);
    if (!next) return false;
    tx.set(ref, next);
    return true;
  });
}

// ---------- invite / rotate / revoke ----------
export async function invite(d, caller, body) {
  const brandIds = idList(body?.brandIds);
  const email = normalizeEmail(body?.email);
  const role = body?.role;
  if (!brandIds || !email || !ROLES.includes(role)) fail("bad-request", 400);
  const owner = await d.auth.getUser(caller.uid);
  if (normalizeEmail(owner.email) === email) fail("self", 400);
  const now = d.now();
  const token = newToken();
  const inviteId = hashToken(token);
  const result = await d.db.runTransaction(async (tx) => {
    const accSnap = await tx.get(d.db.doc(`accounts/${caller.uid}`));
    const account = accSnap.exists ? accSnap.data() : null;
    if (!accountCanWrite(account, now)) fail("owner-inactive", 409);
    const brands = docs(await tx.get(ownerBrandsQuery(d.db, caller.uid)));
    const invites = docs(await tx.get(ownerInvitesQuery(d.db, caller.uid)));
    const picked = brandIds.map((id) => brands.find((b) => b.id === id));
    if (picked.some((b) => !b || !isActiveBrand(b))) fail("not-found", 404);
    const memberEmails = (b) => Object.values(b.members || {}).map((m) => normalizeEmail(m?.email));
    if (picked.every((b) => memberEmails(b).includes(email))) fail("already-member", 409);
    const pending = invites.filter((inv) => inviteState(inv, now) === "pending");
    if (pending.length >= MAX_PENDING_INVITES) fail("too-many", 429);
    // One live invite per email: inviting again replaces the old link.
    const previous = pending.filter((inv) => inv.email === email);
    const onTeam = brands.some((b) => memberEmails(b).includes(email));
    const limit = seatLimit(caller.uid, account, now);
    const used = seatsUsed(brands, invites.filter((inv) => inv.email !== email), { now });
    if (!onTeam && used + 1 > limit) fail("seats-full", 409, { limit });
    previous.forEach((inv) => tx.update(d.db.doc(`invites/${inv.id}`), { status: "revoked", revokedAt: now }));
    const ownerName = displayNameOf(owner, account);
    const record = {
      ownerId: caller.uid, ownerName, email, brandIds, brandNames: picked.map((b) => String(b.name || "").slice(0, 80)), role,
      status: "pending", createdAt: now, expiresAt: now + INVITE_TTL_MS, lastSentAt: now,
    };
    tx.set(d.db.doc(`invites/${inviteId}`), record);
    return { record, limit, used: onTeam ? used : used + 1 };
  });
  const link = inviteLink(token, d.origin);
  const canMail = await reserveTeamMail(d, caller.uid);
  const mail = composeInviteEmail({ ...result.record, link, appUrl: APP_URL });
  const sent = canMail ? await d.send({ to: email, ...mail, idempotencyKey: `team-invite-${inviteId}` }) : null;
  return { inviteId, link, emailSent: !!sent?.ok, ...(canMail ? {} : { mailLimit: true }), seats: { used: result.used, limit: Number.isFinite(result.limit) ? result.limit : null } };
}

async function ownInvite(tx, d, caller, inviteId) {
  if (!/^[a-f0-9]{64}$/.test(String(inviteId || ""))) fail("bad-request", 400);
  const snap = await tx.get(d.db.doc(`invites/${inviteId}`));
  if (!snap.exists) fail("not-found", 404);
  const inv = { id: snap.id, ...snap.data() };
  if (inv.ownerId !== caller.uid) fail("not-owner", 403);
  return inv;
}

export async function rotate(d, caller, body) {
  const now = d.now();
  const token = newToken();
  const newId = hashToken(token);
  const record = await d.db.runTransaction(async (tx) => {
    const inv = await ownInvite(tx, d, caller, body?.inviteId);
    const state = inviteState(inv, now);
    if (state === "accepted" || state === "revoked") fail(state === "accepted" ? "used" : "revoked", 410);
    const accSnap = await tx.get(d.db.doc(`accounts/${caller.uid}`));
    if (!accountCanWrite(accSnap.exists ? accSnap.data() : null, now)) fail("owner-inactive", 409);
    if (body?.send && now - Number(inv.lastSentAt || 0) < RESEND_GAP_MS) fail("too-soon", 429);
    const { id, ...rest } = inv;
    const next = { ...rest, status: "pending", createdAt: now, expiresAt: now + INVITE_TTL_MS, lastSentAt: body?.send ? now : inv.lastSentAt || null };
    tx.set(d.db.doc(`invites/${newId}`), next);
    tx.delete(d.db.doc(`invites/${id}`));
    return next;
  });
  const link = inviteLink(token, d.origin);
  let emailSent = false;
  let mailLimit = false;
  if (body?.send) {
    if (await reserveTeamMail(d, caller.uid)) {
      const sent = await d.send({ to: record.email, ...composeInviteEmail({ ...record, link, appUrl: APP_URL }), idempotencyKey: `team-invite-${newId}` });
      emailSent = !!sent?.ok;
    } else mailLimit = true;
  }
  return { inviteId: newId, link, emailSent, ...(mailLimit ? { mailLimit } : {}) };
}

export async function revoke(d, caller, body) {
  await d.db.runTransaction(async (tx) => {
    const inv = await ownInvite(tx, d, caller, body?.inviteId);
    tx.update(d.db.doc(`invites/${inv.id}`), { status: "revoked", revokedAt: d.now() });
  });
  return {};
}

// ---------- the invitee's side ----------
async function inviteByToken(d, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) fail("bad-request", 400);
  const id = hashToken(token);
  const snap = await d.db.doc(`invites/${id}`).get();
  if (!snap.exists) fail("not-found", 404);
  return { id, ...snap.data() };
}
const STATE_ERROR = { expired: ["expired", 410], revoked: ["revoked", 410], accepted: ["used", 410] };

export async function preview(d, body) {
  const inv = await inviteByToken(d, body?.token);
  const state = inviteState(inv, d.now());
  return { state, ownerName: inv.ownerName, brandNames: inv.brandNames || [], role: inv.role, emailMasked: maskEmail(inv.email), expiresAt: inv.expiresAt };
}

export async function accept(d, caller, body) {
  const id = hashToken(body?.token || "");
  if (typeof body?.token !== "string") fail("bad-request", 400);
  const user = await d.auth.getUser(caller.uid);
  const now = d.now();
  return d.db.runTransaction(async (tx) => {
    const invSnap = await tx.get(d.db.doc(`invites/${id}`));
    if (!invSnap.exists) fail("not-found", 404);
    const inv = { id, ...invSnap.data() };
    const state = inviteState(inv, now);
    if (state === "accepted" && inv.acceptedBy === caller.uid) return { brandIds: inv.brandIds, ownerName: inv.ownerName, already: true };
    if (STATE_ERROR[state]) fail(...STATE_ERROR[state]);
    if (caller.uid === inv.ownerId) fail("self", 400);
    if (normalizeEmail(user.email) !== inv.email) fail("email-mismatch", 403);
    if (!user.emailVerified) fail("unverified", 403);
    const accSnap = await tx.get(d.db.doc(`accounts/${inv.ownerId}`));
    const account = accSnap.exists ? accSnap.data() : null;
    if (!accountCanWrite(account, now)) fail("owner-inactive", 409);
    const brands = docs(await tx.get(ownerBrandsQuery(d.db, inv.ownerId)));
    const invites = docs(await tx.get(ownerInvitesQuery(d.db, inv.ownerId)));
    const onTeam = brands.some((b) => b.members?.[caller.uid]);
    if (!onTeam && seatsUsed(brands, invites, { now, exceptInviteId: id }) + 1 > seatLimit(inv.ownerId, account, now)) fail("seats-full", 409);
    const targets = inv.brandIds.map((bid) => brands.find((b) => b.id === bid)).filter((b) => b && isActiveBrand(b));
    if (!targets.length) fail("not-found", 404);
    const name = String(user.displayName || inv.email.split("@")[0]).slice(0, 80);
    const memberEntry = { role: inv.role, name, email: inv.email, addedAt: now };
    const membershipBrands = {};
    for (const b of targets) {
      const ref = d.db.doc(`brands/${b.id}`);
      const scrub = !(b.memberIds || []).length ? firstShareScrub(b) : null;
      if (scrub?.secrets) tx.set(d.db.doc(`brands/${b.id}/private/integrations`), { ownerId: inv.ownerId, ...scrub.secrets }, { merge: true });
      if (scrub?.personal) {
        tx.set(d.db.doc(`brands/${b.id}/people/${inv.ownerId}`), { uid: inv.ownerId, brandId: b.id, ...scrub.personal, updatedAt: now }, { merge: true });
      }
      const updates = [new FieldPath("members", caller.uid), memberEntry, "memberIds", FieldValue.arrayUnion(caller.uid), "ownerName", inv.ownerName];
      for (const [k, v] of Object.entries(scrub?.brandPatch || {})) updates.push(k, v);
      tx.update(ref, ...updates);
      // Invited again after their access was turned off: back on.
      membershipBrands[b.id] = { ownerId: inv.ownerId, role: inv.role, brandName: String(b.name || "").slice(0, 80), ownerName: inv.ownerName, disabled: FieldValue.delete() };
    }
    tx.set(d.db.doc(`memberships/${caller.uid}`), { ownerIds: FieldValue.arrayUnion(inv.ownerId), brands: membershipBrands }, { merge: true });
    tx.update(d.db.doc(`invites/${id}`), { status: "accepted", acceptedBy: caller.uid, acceptedAt: now });
    return { brandIds: targets.map((b) => b.id), ownerName: inv.ownerName };
  }).then(async (out) => {
    if (!out.already) await mirrorTeams(d, out.brandIds);
    return out;
  });
}

export async function codeStart(d, body) {
  const inv = await inviteByToken(d, body?.token);
  const now = d.now();
  const state = inviteState(inv, now);
  if (STATE_ERROR[state]) fail(...STATE_ERROR[state]);
  const ref = d.db.doc(`inviteCodes/${inv.id}`);
  const guardRef = d.db.doc(`codeGuards/${codeGuardId(inv.email)}`);
  const code = newCode();
  await d.db.runTransaction(async (tx) => {
    const [prev, guardSnap] = await Promise.all([tx.get(ref), tx.get(guardRef)]);
    if (prev.exists && now - Number(prev.data().sentAt || 0) < RESEND_GAP_MS) fail("too-soon", 429);
    // However many links or owners ask: 5 codes a day to one email.
    const guard = guardToday(guardSnap.exists ? guardSnap.data() : null, now);
    if (guard.sends >= CODE_DAY_SENDS) fail("code-limit", 429);
    tx.set(guardRef, { ...guard, sends: guard.sends + 1 });
    tx.set(ref, { hash: hashCode(inv.id, code), expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now });
  });
  // Counted against the inviting owner's team emails for the day.
  if (!(await reserveTeamMail(d, inv.ownerId))) fail("mail-limit", 429);
  const sent = await d.send({ to: inv.email, ...composeCodeEmail({ code, ownerName: inv.ownerName, brandNames: inv.brandNames, appUrl: APP_URL }) });
  return { emailMasked: maskEmail(inv.email), emailSent: !!sent?.ok };
}

export async function codeFinish(d, caller, body) {
  const inv = await inviteByToken(d, body?.token);
  const now = d.now();
  const state = inviteState(inv, now);
  if (STATE_ERROR[state]) fail(...STATE_ERROR[state]);
  // Signed out: is there an account for this email already? If not, the
  // password must be usable BEFORE the code is spent on it.
  let existing = null;
  if (!caller) {
    try {
      existing = await d.auth.getUserByEmail(inv.email);
    } catch (e) {
      if (e?.code !== "auth/user-not-found") throw e;
    }
  }
  const password = String(body?.password || "");
  // A new account — or an unverified one the code will take over — gets
  // this password, so it must be usable before the code is spent.
  const settingPassword = !caller && !existing?.emailVerified;
  if (settingPassword && (password.length < 8 || password.length > 128)) fail("weak-password", 400);
  const ref = d.db.doc(`inviteCodes/${inv.id}`);
  const guardRef = d.db.doc(`codeGuards/${codeGuardId(inv.email)}`);
  const verdict = await d.db.runTransaction(async (tx) => {
    const [snap, guardSnap] = await Promise.all([tx.get(ref), tx.get(guardRef)]);
    const guard = guardToday(guardSnap.exists ? guardSnap.data() : null, now);
    if (guard.wrong >= CODE_DAY_WRONG) return "locked-day";
    const stored = snap.exists ? snap.data() : null;
    const v = codeCheck(stored, inv.id, body?.code, now);
    if (v === "wrong") {
      tx.update(ref, { attempts: FieldValue.increment(1) });
      tx.set(guardRef, { ...guard, wrong: guard.wrong + 1 });
    }
    if (v === "ok") tx.delete(ref);
    return v;
  });
  if (verdict === "locked-day") fail("code-locked-day", 429);
  if (verdict === "locked") fail("code-locked", 429);
  if (verdict === "expired") fail("code-expired", 410);
  if (verdict === "wrong") fail("code-wrong", 403);
  if (caller) {
    const user = await d.auth.getUser(caller.uid);
    if (normalizeEmail(user.email) !== inv.email) fail("email-mismatch", 403);
    if (!user.emailVerified) await d.auth.updateUser(caller.uid, { emailVerified: true });
    return { ...(await accept(d, caller, body)), verified: true };
  }
  // A verified account: its owner signs in with it as usual — nothing about
  // it changes here.
  if (existing?.emailVerified) fail("account-exists", 409);
  const name = String(body?.name || "").trim().slice(0, 80) || inv.email.split("@")[0];
  if (existing) {
    // Unverified: whoever set its password never proved the email; the
    // code holder just did. Like a password reset: their password, every
    // other way in unlinked, every old sign-in ended — so an account made
    // on someone else's email ahead of time can't be kept by its maker.
    const others = (existing.providerData || []).map((p) => p.providerId).filter((id) => id && id !== "password");
    await d.auth.updateUser(existing.uid, { password, emailVerified: true, displayName: name, ...(others.length ? { providersToUnlink: others } : {}) });
    await d.auth.revokeRefreshTokens(existing.uid);
    const accepted = await accept(d, { uid: existing.uid }, body);
    return { ...accepted, created: true, email: inv.email };
  }
  const created = await d.auth.createUser({ email: inv.email, password, displayName: name, emailVerified: true });
  const accepted = await accept(d, { uid: created.uid }, body);
  return { ...accepted, created: true, email: inv.email };
}

// ---------- role / remove / leave / sync ----------
export async function changeRole(d, caller, body) {
  const { brandId, memberUid, role } = body || {};
  if (!idOk(brandId) || !idOk(memberUid) || !ROLES.includes(role)) fail("bad-request", 400);
  await d.db.runTransaction(async (tx) => {
    const ref = d.db.doc(`brands/${brandId}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", 404);
    const b = snap.data();
    if (b.ownerId !== caller.uid) fail("not-owner", 403);
    if (!b.members?.[memberUid]) fail("not-found", 404);
    tx.update(ref, new FieldPath("members", memberUid, "role"), role);
    tx.set(d.db.doc(`memberships/${memberUid}`), { brands: { [brandId]: { role } } }, { merge: true });
  });
  await mirrorTeams(d, [brandId]);
  return {};
}

// Docs-style access switch for one person on one brand (owner only). Off:
// they stay on the team list and keep their seat, chats and work, but
// can't open the brand — out of memberIds (their brand query, the brand
// doc's read rule, the live layer's team copy), members.{uid}.disabled
// for every other rule, and their memberships entry flagged so their
// brand list says why. On: everything back as it was.
export async function setAccess(d, caller, body) {
  const { brandId, memberUid } = body || {};
  if (!idOk(brandId) || !idOk(memberUid) || typeof body?.enabled !== "boolean") fail("bad-request", 400);
  const enabled = body.enabled;
  await d.db.runTransaction(async (tx) => {
    const ref = d.db.doc(`brands/${brandId}`);
    const mRef = d.db.doc(`memberships/${memberUid}`);
    const [snap, mSnap] = await Promise.all([tx.get(ref), tx.get(mRef)]);
    if (!snap.exists) fail("not-found", 404);
    const b = snap.data();
    if (b.ownerId !== caller.uid) fail("not-owner", 403);
    const m = b.members?.[memberUid];
    if (!m) fail("not-found", 404);
    tx.update(ref, new FieldPath("members", memberUid, "disabled"), enabled ? FieldValue.delete() : true,
      "memberIds", enabled ? FieldValue.arrayUnion(memberUid) : FieldValue.arrayRemove(memberUid));
    const entry = { ownerId: b.ownerId, role: m.role, brandName: String(b.name || "").slice(0, 80), ownerName: b.ownerName || "", ...(enabled ? {} : { disabled: true }) };
    const brands = { ...(mSnap.exists ? mSnap.data().brands || {} : {}), [brandId]: entry };
    tx.set(mRef, { brands, ownerIds: [...new Set(Object.values(brands).map((x) => x.ownerId))] });
  });
  await mirrorTeams(d, [brandId]);
  if (!enabled && d.rtdb) {
    await Promise.all([d.rtdb.ref(`presence/${brandId}/${memberUid}`).remove(), d.rtdb.ref(`cursors/${brandId}/${memberUid}`).remove()]).catch(() => {});
  }
  return { enabled };
}

// Takes `memberUid` off `ownerId`'s brands (all of them, or `brandIds`),
// fixes the index, then deletes what was theirs alone in those brands:
// their chat threads and their people/ doc.
async function removeMember(d, ownerId, memberUid, brandIds) {
  const removed = await d.db.runTransaction(async (tx) => {
    // By the members map, not memberIds: someone whose access is off isn't
    // in memberIds but is still on the team.
    const snap = await tx.get(ownerBrandsQuery(d.db, ownerId));
    const brands = docs(snap).filter((b) => b.members?.[memberUid] && (!brandIds || brandIds.includes(b.id)));
    const mRef = d.db.doc(`memberships/${memberUid}`);
    const mSnap = await tx.get(mRef);
    for (const b of brands) {
      tx.update(d.db.doc(`brands/${b.id}`), new FieldPath("members", memberUid), FieldValue.delete(), "memberIds", FieldValue.arrayRemove(memberUid));
    }
    const left = { ...(mSnap.exists ? mSnap.data().brands || {} : {}) };
    brands.forEach((b) => delete left[b.id]);
    if (!Object.keys(left).length) tx.delete(mRef);
    else tx.set(mRef, { brands: left, ownerIds: [...new Set(Object.values(left).map((x) => x.ownerId))] });
    return brands.map((b) => b.id);
  });
  if (removed.length) {
    await mirrorTeams(d, removed);
    // Their live marks there go too (presence, cursor).
    if (d.rtdb) {
      await Promise.all(removed.flatMap((bid) => [d.rtdb.ref(`presence/${bid}/${memberUid}`).remove(), d.rtdb.ref(`cursors/${bid}/${memberUid}`).remove()])).catch(() => {});
    }
    const threads = await d.db.collection("brainstorms").where("ownerId", "==", memberUid).get();
    const batch = d.db.batch();
    threads.docs.filter((t) => removed.includes(t.data().brandId)).forEach((t) => batch.delete(t.ref));
    removed.forEach((bid) => batch.delete(d.db.doc(`brands/${bid}/people/${memberUid}`)));
    await batch.commit();
    // A seat came free: a paused teammate gets it back.
    await reconcileSeats(d, ownerId);
  }
  return { brandIds: removed };
}

export async function remove(d, caller, body) {
  const memberUid = body?.memberUid;
  const brandIds = body?.brandIds == null ? null : idList(body.brandIds);
  if (!idOk(memberUid) || (body?.brandIds != null && !brandIds)) fail("bad-request", 400);
  if (memberUid === caller.uid) fail("self", 400);
  return removeMember(d, caller.uid, memberUid, brandIds);
}

export async function leave(d, caller, body) {
  const brandIds = body?.brandIds == null ? null : idList(body.brandIds);
  if (body?.brandIds != null && !brandIds) fail("bad-request", 400);
  const mSnap = await d.db.doc(`memberships/${caller.uid}`).get();
  const mine = mSnap.exists ? mSnap.data().brands || {} : {};
  const owners = new Set(Object.entries(mine).filter(([bid]) => !brandIds || brandIds.includes(bid)).map(([, x]) => x.ownerId));
  const out = [];
  for (const ownerId of owners) out.push(...(await removeMember(d, ownerId, caller.uid, brandIds)).brandIds);
  return { brandIds: out };
}

export async function sync(d, caller) {
  const brands = docs(await ownerBrandsQuery(d.db, caller.uid).get());
  const byMember = new Map();
  for (const b of brands) {
    for (const [uid, m] of Object.entries(b.members || {})) {
      if (!byMember.has(uid)) byMember.set(uid, {});
      byMember.get(uid)[b.id] = { ownerId: caller.uid, role: m.role, brandName: String(b.name || "").slice(0, 80), ownerName: b.ownerName || "", ...(m.disabled ? { disabled: true } : {}) };
    }
  }
  for (const [uid, own] of byMember) {
    await d.db.runTransaction(async (tx) => {
      const ref = d.db.doc(`memberships/${uid}`);
      const snap = await tx.get(ref);
      const others = Object.fromEntries(Object.entries(snap.exists ? snap.data().brands || {} : {}).filter(([, x]) => x.ownerId !== caller.uid));
      const all = { ...others, ...own };
      tx.set(ref, { brands: all, ownerIds: [...new Set(Object.values(all).map((x) => x.ownerId))] });
    });
  }
  const seats = await reconcileSeats(d, caller.uid);
  await mirrorTeams(d, brands.map((b) => b.id));
  return { members: byMember.size, paused: seats.paused };
}

// ---------- HTTP ----------
const SIGNED_IN = { invite, rotate, revoke, accept, role: changeRole, access: setAccess, remove, leave, sync };

export async function runAction(d, action, caller, body) {
  if (action === "preview") return preview(d, body);
  if (action === "code-start") return codeStart(d, body);
  if (action === "code-finish") return codeFinish(d, caller, body);
  const fn = SIGNED_IN[action];
  if (!fn) fail("bad-request", 400);
  if (!caller) fail("auth", 401);
  return fn(d, caller, body);
}

export default async function handler(req, res) {
  const isGet = req.method === "GET";
  if (!isGet && req.method !== "POST") return res.status(405).json({ error: "method" });
  const body = isGet ? req.query || {} : req.body && typeof req.body === "object" ? req.body : {};
  const action = String(body.action || "");
  if (isGet && action !== "preview") return res.status(405).json({ error: "method" });
  try {
    const caller = await optionalCaller(req);
    const out = await runAction(teamDeps(req), action, caller, body);
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    if (err instanceof TeamError) return res.status(err.status).json({ error: err.code, ...err.extra });
    console.error("[team]", action, err);
    return res.status(500).json({ error: "unknown" });
  }
}
