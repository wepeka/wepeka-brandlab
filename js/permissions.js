// Kerja Tim roles & permissions (owner, 2026-11-24: "aku mau ada rolenya
// banyak" — Owner, Admin, Content Creator, Video Editor, Social Media
// Manager, Sales, Viewer; per module and per action; "Video Editor tidak
// perlu akses Sales dan informasi keuangan"; enforced in the database, the
// server, Report, Board and Tanya Brandlab, not only by hiding menus).
// Later that day: "editor sama sosmed manager jadikan 1 aja rolenya" — the
// Video Editor and the Social Media Manager are one role, "Editor &
// Sosmed" (key smm); and a Klien for every owner, who sees a video only
// once the team approved it and sent it to them.
//
// Pure: no store, no Firebase — the app (js/store.js, views), the server
// (api/team.js, api/ai.js) and the tests read the same table.
//
// On the brand doc each member keeps (written by the server only):
//   members[uid] = { role: "editor"|"viewer", preset, p: {module: [action]}, custom?, klien?, seatPaused?, disabled? }
// `role` stays the old two-way switch every older reader (and the Realtime
// Database scripts) understands: "editor" when the member writes content
// (create.edit), else "viewer". `p` is what the rules, the server and the
// app check. A member from before roles (no `p`) reads as the preset its
// old role maps to — except that a plain viewer no longer reads Sales.

export const MODULES = ["brand", "goals", "create", "video", "publish", "report", "sales", "board", "chat", "team"];
export const ACTIONS = ["view", "edit", "upload", "comment", "revise", "approve", "publish", "delete"];

// What each module can be set to in the "Atur akses" panel: a few plain
// levels instead of 8 checkboxes, each one a set of actions.
export const LEVELS = {
  brand: { none: [], view: ["view"], edit: ["view", "edit"] },
  goals: { none: [], view: ["view"], edit: ["view", "edit", "delete"] },
  create: { none: [], view: ["view"], comment: ["view", "comment"], edit: ["view", "edit", "comment", "delete"] },
  video: { none: [], view: ["view"], comment: ["view", "comment"], upload: ["view", "upload", "comment"], approve: ["view", "comment", "revise", "approve"], editor: ["view", "upload", "comment", "revise", "approve"], all: ["view", "upload", "comment", "revise", "approve", "delete"] },
  publish: { none: [], publish: ["view", "publish"] },
  report: { none: [], view: ["view"] },
  sales: { none: [], view: ["view"], edit: ["view", "edit", "delete"] },
  board: { none: [], view: ["view"], comment: ["view", "comment"], edit: ["view", "edit", "comment", "delete"] },
  chat: { none: [], use: ["view"] },
  team: { none: [] },
};

const L = (mod, level) => LEVELS[mod][level];
// The presets (owner, 2026-11-24, from the plan's table). Team management
// stays the owner's own for now (api/team.js checks ownerId).
export const PRESETS = {
  admin: { brand: L("brand", "edit"), goals: L("goals", "edit"), create: L("create", "edit"), video: L("video", "all"), publish: L("publish", "publish"), report: L("report", "view"), sales: L("sales", "edit"), board: L("board", "edit"), chat: L("chat", "use") },
  creator: { brand: L("brand", "view"), goals: L("goals", "view"), create: L("create", "edit"), video: L("video", "upload"), report: L("report", "view"), board: L("board", "edit"), chat: L("chat", "use") },
  // Editor & Sosmed: cuts the videos, reviews and approves them, posts.
  smm: { brand: L("brand", "view"), goals: L("goals", "edit"), create: L("create", "edit"), video: L("video", "editor"), publish: L("publish", "publish"), report: L("report", "view"), board: L("board", "edit"), chat: L("chat", "use") },
  sales: { brand: L("brand", "view"), goals: L("goals", "edit"), create: L("create", "view"), report: L("report", "view"), sales: L("sales", "edit"), board: L("board", "view"), chat: L("chat", "use") },
  viewer: { brand: L("brand", "view"), goals: L("goals", "view"), create: L("create", "view"), video: L("video", "view"), report: L("report", "view"), board: L("board", "view") },
  // Wepeka's clients (only Wepeka's own account invites them, api/team.js).
  klien: { brand: L("brand", "view"), create: L("create", "view"), video: L("video", "approve"), board: L("board", "view") },
  klienEdit: { brand: L("brand", "edit"), goals: L("goals", "edit"), create: L("create", "edit"), video: L("video", "editor"), report: L("report", "view"), board: L("board", "edit"), chat: L("chat", "use") },
};
// The roles an owner picks from, in this order; the klien ones are Wepeka's.
export const ROLE_KEYS = ["admin", "creator", "smm", "sales", "viewer"];
// "klien" is every owner's (2026-11-24); "klienEdit" stays Wepeka's own.
export const CLIENT_KEYS = ["klien", "klienEdit"];
export const ALL_ROLE_KEYS = [...ROLE_KEYS, ...CLIENT_KEYS];
// Invites made before roles said "editor" / "viewer".
export const LEGACY = { editor: "admin", viewer: "viewer", video: "smm" };
export const presetKey = (role) => (Object.hasOwn(PRESETS, role) ? role : LEGACY[role] || null);

// A permission map cleaned to known modules and actions, each list in table
// order, empty modules dropped — what the server stores.
export function cleanPerms(p) {
  const out = {};
  for (const mod of MODULES) {
    const want = Array.isArray(p?.[mod]) ? p[mod] : [];
    const acts = ACTIONS.filter((a) => want.includes(a));
    // Anything beyond looking needs looking.
    if (acts.length && !acts.includes("view")) acts.unshift("view");
    if (acts.length) out[mod] = acts;
  }
  return out;
}
export const presetPerms = (key) => cleanPerms(PRESETS[presetKey(key)] || {});

// Old two-way role on the brand doc from a permission map.
export const coarseRole = (p) => ((p?.create || []).includes("edit") ? "editor" : "viewer");

// The member's level per module (for the panel) from a permission map.
export function levelOf(p, mod) {
  const have = new Set(p?.[mod] || []);
  const levels = Object.entries(LEVELS[mod] || {});
  // The richest level fully covered.
  let best = "none";
  for (const [name, acts] of levels) if (acts.length && acts.every((a) => have.has(a))) best = name;
  return best;
}
export function withLevel(p, mod, level) {
  if (!LEVELS[mod] || !Object.hasOwn(LEVELS[mod], level)) return cleanPerms(p);
  return cleanPerms({ ...p, [mod]: LEVELS[mod][level] });
}

// What a member record can do: its `p`, or the preset its old role maps to.
// A viewer from before roles keeps everything a viewer saw except Sales.
export function memberPerms(m) {
  if (!m || m.disabled) return {};
  let p = m.p && typeof m.p === "object" ? cleanPerms(m.p) : presetPerms(m.klien ? (m.role === "editor" ? "klienEdit" : "klien") : LEGACY[m.role] || "viewer");
  // A paused seat (more members than seats) only looks.
  if (m.seatPaused) p = Object.fromEntries(Object.entries(p).map(([mod, acts]) => [mod, acts.includes("view") ? ["view"] : []]).filter(([, a]) => a.length));
  return p;
}

// The question every gate asks. `brand` = the brand doc, `uid` = who asks.
export function can(brand, uid, mod, act = "view") {
  if (!brand || !uid) return false;
  if (!brand.ownerId || brand.ownerId === uid) return true;
  return (memberPerms(brand.members?.[uid])[mod] || []).includes(act);
}

// The role shown for a member: a preset name, "custom" once the owner
// changed a box, or the old role's preset.
export function roleOfMember(m) {
  if (!m) return null;
  if (m.preset && Object.hasOwn(PRESETS, m.preset)) return m.custom ? "custom" : m.preset;
  if (m.klien) return m.role === "editor" ? "klienEdit" : "klien";
  return LEGACY[m.role] || "viewer";
}
