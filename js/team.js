// Kerja Tim on the client: the brands other owners shared with this account
// (memberships/{uid}, written by api/team.js), the access that gives, and
// the team API. Who may do what inside a brand lives in js/store.js
// (brandRole / canEditBrand / isSharedBrand), next to the data.
import { auth, db as fdb, loadFirestore } from "./firebase.js";
import { accessState } from "./account.js";

// Mirrors api/_plans.js TEAM_SEATS exactly (tests/team.test.mjs keeps the
// two equal): how many people an owner may invite, by plan. The owner is
// not a seat.
export const TEAM_SEATS = {
  trial: 3,
  starter: 3,
  pro: 3,
  studio: 3,
  founder: 3,
  "founder-ultimate": 3,
  lifetime: 3,
  builder: 3,
  "content-os": 3,
  monthly: 3,
  free: 0,
};
export const DEFAULT_TEAM_SEATS = 3;
// The plan's seats plus the extra seats still running (teamSeatSlotsUntil).
export function teamSeatsFor(account, now = Date.now()) {
  if (!account) return 0;
  const n = TEAM_SEATS[account.plan];
  const base = Number.isInteger(n) ? n : DEFAULT_TEAM_SEATS;
  return base + extraSeatEnds(account, now).length;
}
// End dates of the extra seats still running, soonest first.
export function extraSeatEnds(account, now = Date.now()) {
  return (account?.teamSeatSlotsUntil || []).map(Number).filter((ts) => ts > now).sort((a, b) => a - b);
}

let memberships = null;
export function getMemberships() {
  return memberships;
}
export function hasMemberships(m = memberships) {
  return !!m && Object.keys(m.brands || {}).length > 0;
}

// Live memberships/{uid}: fn(memberships | null) on every change, also once
// at once when there is none. Never throws: unreadable = no memberships.
export function subscribeMemberships(uid, fn) {
  let unsub = null;
  let stopped = false;
  loadFirestore().then(({ doc, onSnapshot }) => {
    if (stopped) return;
    unsub = onSnapshot(doc(fdb, "memberships", uid), (snap) => {
      memberships = snap.exists() ? snap.data() : null;
      fn(memberships);
    }, (e) => {
      console.warn("Team memberships unavailable", e);
      memberships = null;
      fn(null);
    });
  }).catch((e) => {
    console.warn("Team memberships unavailable", e);
    fn(null);
  });
  return () => {
    stopped = true;
    unsub?.();
  };
}

// What this account may open: its own plan's state, or "member" when it has
// no plan of its own (none / ended) but works on brands shared with it.
//   "paid" | "trial" | "member" | "expired" | "none"
export function effectiveAccess(account, m = memberships) {
  const own = accessState(account);
  if (own === "paid" || own === "trial") return own;
  return hasMemberships(m) ? "member" : own;
}

// POST /api/team (GET for "preview"). Resolves to the JSON on success;
// rejects with an Error whose .code is the server's error code.
export async function teamApi(action, body = {}) {
  const headers = { "content-type": "application/json" };
  const user = auth.currentUser;
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  let res;
  if (action === "preview") {
    res = await fetch(`/api/team?action=preview&token=${encodeURIComponent(body.token || "")}`, { headers });
  } else {
    res = await fetch("/api/team", { method: "POST", headers, body: JSON.stringify({ ...body, action }) });
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok || !json?.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.code = json?.error || "network";
    err.status = res.status;
    err.data = json || {};
    throw err;
  }
  return json;
}
