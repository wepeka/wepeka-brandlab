// Papan (whiteboard) ↔ Brandlab. The canvas is its own small app in /papan/
// (built from papan/src by papan/build.mjs) and runs in an iframe on
// #/brand/:id/papan (js/views/papan.js). Everything it stores, reads or asks
// goes through the object built here, so it uses this brand's data, the
// team's rules (firestore.rules "Papan"), the owner's AI credits and the
// existing Tanya Brandlab chat — there is no second backend and no second chat.
//
// Storage: brands/{brandId}/boards/{boardId} + subcollections objects,
// comments, versions, recaps, decks. Every doc carries ownerId (the brand
// owner, so members' writes count against the owner like everything else),
// brandId and, below a board, boardId. The canvas speaks the small
// document API it also has inside claude.ai (doc/collection/onSnapshot/
// set/update/delete); this file maps it onto Firestore:
//  - Firestore refuses arrays inside arrays (pen strokes, table rows), so
//    they're wrapped as {_a:[…]} on the way in and unwrapped on the way out;
//  - update() is a deep merge in the canvas's API, so a patch becomes
//    FieldPath updates (null = deleteField).
// Live cursors on the canvas: Realtime Database papanLive/{brandId}/{boardId}
// (database.rules.json) — for the team, and for guests who opened the board's
// guest link (api/papan.js; their side is papan/src/host/guest.js).
import { auth, db as liveDb, loadFirestore, loadDatabase } from "../firebase.js";
import {
  getBrand, docOwnerFor, canEditBrand, brandRole, onChange, listCampaigns, listContent, listGoals, updateGoal,
  createContent, updateContent, createCampaign, getBrandInsights, getSettings, STATUSES, STATUS_LABELS, CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS, brandVoiceText, hydrateGuidelines,
} from "../store.js";
import { getTracker, weeklySeries, trackerTotals, monthRange } from "../sales-tracker.js";
import { computeContentMetrics } from "../formulas.js";
import { goalItems } from "../goal-progress.js";
import { colorFor } from "../collab/live.js";
import { papanJson, buildBrandContext } from "../ai.js";

const SUBS = ["objects", "comments", "versions", "recaps", "decks", "guests"];
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function encode(v) {
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? { _a: encode(x) } : encode(x)));
  if (isPlain(v)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = encode(x); return o; }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map((x) => (isPlain(x) && Object.keys(x).length === 1 && Array.isArray(x._a) ? decode(x._a) : decode(x)));
  if (isPlain(v)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o; }
  return v;
}
export const __test = { encode, decode };
const STAMPS = ["ownerId", "brandId", "boardId"];
const unstamp = (d) => { if (!d) return d; const o = { ...d }; STAMPS.forEach((k) => delete o[k]); return decode(o); };

// ---------- documents ----------
function makeDb(brandId) {
  let fs = null;
  const ready = loadFirestore().then((m) => (fs = m));
  const base = `brands/${brandId}/`;
  const boardIdOf = (path) => { const s = path.split("/"); return s[0] === "boards" && s.length >= 4 ? s[1] : null; };
  const snapDoc = (s) => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? unstamp(s.data()) : undefined), metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } });
  const snapQuery = (s) => ({
    docs: s.docs.map(snapDoc), size: s.size, empty: s.empty,
    docChanges: () => s.docChanges().map((c) => ({ type: c.type, doc: snapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })),
    metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites },
  });
  const err = (e) => ({ code: e?.code === "permission-denied" ? "permission_denied" : e?.code === "resource-exhausted" ? "resource_exhausted" : "unavailable", message: String(e?.message || e) });
  function toUpdates(patch, prefix = [], out = []) {
    for (const [k, v] of Object.entries(patch)) {
      const p = [...prefix, k];
      if (isPlain(v) && Object.keys(v).length) toUpdates(v, p, out);
      else out.push(new fs.FieldPath(...p), v === null ? fs.deleteField() : encode(v));
    }
    return out;
  }
  async function deleteBoard(boardId) {
    for (const sub of SUBS) {
      const snap = await fs.getDocs(fs.collection(liveDb, `${base}boards/${boardId}/${sub}`));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const b = fs.writeBatch(liveDb);
        snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }
    await fs.deleteDoc(fs.doc(liveDb, `${base}boards/${boardId}`));
  }
  function docRef(path) {
    const id = path.split("/").pop();
    const isBoard = /^boards\/[^/]+$/.test(path);
    const ref = () => fs.doc(liveDb, base + path);
    return {
      id, path,
      async get() { await ready; try { return snapDoc(await fs.getDoc(ref())); } catch (e) { throw err(e); } },
      async set(data) {
        await ready;
        const stamp = { ownerId: docOwnerFor(brandId), brandId, ...(boardIdOf(path) ? { boardId: boardIdOf(path) } : {}) };
        try { await fs.setDoc(ref(), { ...encode(clean(data) || {}), ...stamp }); } catch (e) { throw err(e); }
      },
      async update(patch) {
        await ready;
        const p = clean(patch) || {};
        STAMPS.forEach((k) => delete p[k]);
        const args = toUpdates(p);
        if (!args.length) return;
        try { await fs.updateDoc(ref(), ...args); } catch (e) { throw err(e); }
      },
      async delete() { await ready; try { if (isBoard) await deleteBoard(id); else await fs.deleteDoc(ref()); } catch (e) { throw err(e); } },
      onSnapshot(next, onErr) {
        let un = null, dead = false;
        ready.then(() => { if (!dead) un = fs.onSnapshot(ref(), (s) => next(snapDoc(s)), (e) => onErr && onErr(err(e))); });
        return () => { dead = true; un && un(); };
      },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path, q = {}) {
    const api = {
      path,
      doc: (id) => docRef(`${path}/${id || Math.random().toString(36).slice(2, 12)}`),
      async add(data) { const d = api.doc(); await d.set(data); return d; },
      where: () => api,
      orderBy: (field, dir = "asc") => collRef(path, { ...q, field, dir }),
      limit: (n) => collRef(path, { ...q, n }),
      build() {
        const c = fs.collection(liveDb, base + path);
        const parts = [];
        if (q.field) parts.push(fs.orderBy(q.field, q.dir));
        if (q.n) parts.push(fs.limit(q.n));
        return parts.length ? fs.query(c, ...parts) : c;
      },
      async get() { await ready; try { return snapQuery(await fs.getDocs(api.build())); } catch (e) { throw err(e); } },
      onSnapshot(next, onErr) {
        let un = null, dead = false;
        ready.then(() => { if (!dead) un = fs.onSnapshot(api.build(), (s) => next(snapQuery(s)), (e) => onErr && onErr(err(e))); });
        return () => { dead = true; un && un(); };
      },
    };
    return api;
  }
  return { doc: docRef, collection: (p) => collRef(p), cascadeDelete: true };
}

// ---------- live cursors ----------
// Any brand: a solo owner's board may have guests (the rules let the owner
// in through papanShare/{brandId}/{boardId}). Before a board is shared the
// writes are simply refused; refresh() listens again once it is.
async function makeRoom(brandId, uid) {
  const live = await loadDatabase().catch(() => null);
  if (!live) return null;
  const { sdk: D, db: rdb } = live;
  let mine = {}, board = null, peers = Object.freeze([]), offset = 0, connected = false;
  let nodeRef = null, unBoard = null, unEvents = null, flushT = null;
  const peerHandlers = new Set(), topicHandlers = new Map(), connHandlers = new Set();
  const unOffset = D.onValue(D.ref(rdb, ".info/serverTimeOffset"), (s) => (offset = s.val() || 0));
  const unConn = D.onValue(D.ref(rdb, ".info/connected"), (s) => {
    connected = !!s.val(); connHandlers.forEach((f) => f(connected));
    if (connected && nodeRef) { D.onDisconnect(nodeRef).remove().catch(() => {}); writeNow(); }
  });
  const writeNow = () => { flushT = null; if (nodeRef) D.set(nodeRef, { by: uid, p: clean(mine), at: D.serverTimestamp() }).catch(() => {}); };
  const schedule = () => { if (!flushT) flushT = setTimeout(writeNow, 90); };
  const emitPeers = (joined, left, updated) => { const c = { peers, joined, left, updated }; peerHandlers.forEach((f) => f(c)); };
  function switchBoard(b) {
    if (nodeRef) { D.onDisconnect(nodeRef).cancel().catch(() => {}); D.remove(nodeRef).catch(() => {}); }
    unBoard && unBoard(); unEvents && unEvents(); unBoard = unEvents = null;
    const left = peers; peers = Object.freeze([]); board = b; nodeRef = null;
    if (left.length) emitPeers([], left, []);
    if (!b) return;
    nodeRef = D.ref(rdb, `papanLive/${brandId}/${b}/peers/${uid}`);
    D.onDisconnect(nodeRef).remove().catch(() => {});
    let prev = new Map();
    unBoard = D.onValue(D.ref(rdb, `papanLive/${brandId}/${b}/peers`), (s) => {
      const val = s.val() || {}, list = [], joined = [], updated = [], gone = [];
      for (const [k, v] of Object.entries(val)) {
        const old = prev.get(k), pj = JSON.stringify(v.p || {});
        const peer = old && old._pj === pj ? old : Object.freeze({ peer: k, by: v.by || k, isMe: k === uid, sameTab: k === uid, kind: "viewer", guest: false, presence: Object.freeze(v.p || {}), updatedAt: Date.now(), _pj: pj });
        list.push(peer); if (!old) joined.push(peer); else if (old !== peer) updated.push(peer);
      }
      const cur = new Map(list.map((p) => [p.peer, p]));
      for (const [k, p] of prev) if (!cur.has(k)) gone.push(p);
      prev = cur; peers = Object.freeze(list);
      emitPeers(joined, gone, updated);
    }, () => {});
    const t0 = Date.now() + offset - 1500;
    unEvents = D.onChildAdded(D.query(D.ref(rdb, `papanLive/${brandId}/${b}/events`), D.orderByChild("at"), D.startAt(t0)), (c) => {
      const v = c.val(); if (!v) return;
      const msg = { topic: v.topic, data: v.data, peer: v.by, by: v.by, isMe: v.by === uid, sameTab: v.by === uid, kind: "viewer", guest: false };
      (topicHandlers.get(v.topic) || []).forEach((f) => { try { f(msg); } catch (e) { console.error(e); } });
    });
    writeNow();
  }
  return {
    presence(patch) {
      for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete mine[k]; else mine[k] = v; }
      if ("b" in patch && (patch.b || null) !== board) switchBoard(patch.b || null); else schedule();
      return Promise.resolve();
    },
    peers: () => peers,
    onPeers(fn) { peerHandlers.add(fn); setTimeout(() => fn({ peers, joined: peers, left: [], updated: [] }), 0); return () => peerHandlers.delete(fn); },
    on(topic, fn) { if (!topicHandlers.has(topic)) topicHandlers.set(topic, []); topicHandlers.get(topic).push(fn); return () => { const a = topicHandlers.get(topic); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; },
    async emit(topic, data) {
      if (!board) return;
      const r = D.push(D.ref(rdb, `papanLive/${brandId}/${board}/events`));
      await D.set(r, { topic, data: clean(data ?? null), by: uid, at: D.serverTimestamp() });
      setTimeout(() => D.remove(r).catch(() => {}), 20000);
    },
    connected: () => connected,
    refresh() { if (board) switchBoard(board); },
    onConnection(fn) { connHandlers.add(fn); setTimeout(() => fn(connected), 0); return () => connHandlers.delete(fn); },
    async canSendToClaudeSession() { return "off"; },
    close() { switchBoard(null); unOffset(); unConn(); },
  };
}

// ---------- who is who ----------
function nameFor(brand, uid) {
  if (!uid) return "";
  const m = brand?.members?.[uid];
  if (m?.name) return m.name;
  if (uid === brand?.ownerId) return brand.ownerName || (uid === auth.currentUser?.uid ? (auth.currentUser.displayName || (auth.currentUser.email || "").split("@")[0]) : "Pemilik");
  if (uid === auth.currentUser?.uid) return auth.currentUser.displayName || (auth.currentUser.email || "").split("@")[0];
  return "";
}
// Guests (pg-…) aren't on the brand: their names sit next to the board
// (boards/{id}/guests/{uid}, written by api/papan.js when they join).
const guestNames = new Map();
async function guestName(brandId, boardId, id) {
  const key = `${boardId}/${id}`;
  if (!guestNames.has(key)) {
    guestNames.set(key, (async () => {
      try {
        const fs = await loadFirestore();
        const s = await fs.getDoc(fs.doc(liveDb, `brands/${brandId}/boards/${boardId}/guests/${id}`));
        return s.exists() ? String(s.data().name || "") : "";
      } catch { return ""; }
    })());
  }
  return guestNames.get(key);
}
function makeUser(brandId, boardOf) {
  const uid = auth.currentUser?.uid || null;
  return {
    id: async () => uid,
    me: async () => ({ id: uid, name: nameFor(getBrand(brandId), uid), avatarUrl: auth.currentUser?.photoURL || "", color: colorFor(uid), email: auth.currentUser?.email || "", isOwner: brandRole(brandId) === "owner", canEdit: canEditBrand(brandId) }),
    name: async () => nameFor(getBrand(brandId), uid),
    isOwner: async () => brandRole(brandId) === "owner",
    canEdit: async () => canEditBrand(brandId),
    can: async () => canEditBrand(brandId),
    async profiles(ids) {
      const b = getBrand(brandId), out = {};
      for (const id of [].concat(ids || [])) {
        const guest = String(id).startsWith("pg-");
        const name = guest && boardOf() ? `${(await guestName(brandId, boardOf(), id)) || "Tamu"} (tamu)` : nameFor(b, id);
        out[id] = { id, name, avatarUrl: "", color: colorFor(id), email: null, isMe: id === uid, guest };
      }
      return out;
    },
    search: async () => [],
  };
}

// ---------- the brand's own data, in the shapes the widgets draw ----------
const COLOR_ROLE = { primary: "Utama", secondary: "Kedua", accent: "Aksen", background: "Latar", text: "Teks" };
const CAMPAIGN_STATUS = { planning: "planning", active: "active", completed: "completed", archived: "archived" };
function labData(brandId) {
  const b = getBrand(brandId);
  if (!b) return null;
  const dna = b.brandDNA || {};
  const g = hydrateGuidelines(brandId, b.brandGuidelines || {}) || {};
  const tone = b.brandBuilder?.toneOfVoice || {};
  const personality = b.brandBuilder?.personality?.primary?.length ? b.brandBuilder.personality.primary : dna.personality || [];
  const content = listContent(brandId).filter((c) => !c.deletedAt && c.status !== "archived");
  const campaigns = listCampaigns(brandId).filter((c) => c.status !== "archived" && !c.deletedAt);
  const settings = getSettings();
  const goals = listGoals(brandId);
  const today = new Date().toISOString().slice(0, 10);
  // Instagram growth: only numbers the brand really logged.
  const ins = getBrandInsights(b, "instagram");
  const hist = (b.insightsHistory || []).filter((h) => h.platform === "instagram" && Number.isFinite(h.followers)).slice(-8);
  const published = content.filter((c) => c.status === "published" && c.performance && Object.keys(c.performance).length);
  const top = published.map((c) => { let er = null; try { er = computeContentMetrics(c, settings).engagementRate; } catch {} return { title: c.title || c.idea || "Konten", er }; })
    .filter((x) => Number.isFinite(x.er)).sort((x, y) => y.er - x.er).slice(0, 2);
  // Sales: weekly revenue of the last 8 weeks + this month.
  let sales = null;
  try {
    const tr = getTracker(b);
    if (tr && (tr.entries?.length || tr.openingRevenue)) {
      const weeks = weeklySeries(tr, 8);
      sales = { weeks: weeks.map((w) => w.from.slice(5).split("-").reverse().join("/")), values: weeks.map((w) => w.revenue), month: trackerTotals(tr, monthRange()).rangeRevenue, total: trackerTotals(tr).revenue };
    }
  } catch { sales = null; }
  const tasks = [], milestones = [];
  for (const goal of goals) {
    (goal.tasks || []).forEach((t) => tasks.push({ id: `${goal.id}:${t.id}`, title: t.label, due: t.dueDate || "", done: !!t.done, owner: "", priority: "sedang", goal: goal.name || goal.title || "", board: t.fromBoard || "" }));
    try {
      const items = goalItems(goal, today);
      if (items.length) milestones.push({ id: goal.id, title: goal.name || goal.title || "Tujuan", due: goal.targetDate || "", progress: Math.round((items.filter((i) => i.state === "done").length / items.length) * 100) });
    } catch {}
  }
  const people = [nameFor(b, b.ownerId) || "Pemilik", ...Object.entries(b.members || {}).map(([uid, m]) => m?.name || nameFor(b, uid)).filter(Boolean)];
  return {
    brandlab: true,
    brand: { id: b.id, name: b.name || "Brand", tagline: dna.tagline || dna.oneLiner || "", color: b.color || "" },
    dna: { positioning: dna.positioning || "", audiens: dna.targetAudience || "", kepribadian: personality, nilai: dna.values || [], vp: dna.oneLiner || dna.differentiation || "", visi: dna.vision || "", misi: dna.mission || "", empty: !(dna.positioning || dna.targetAudience || dna.vision || dna.mission) },
    book: {
      colors: Object.entries(g.colors || {}).filter(([, v]) => typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim())).map(([k, v]) => ({ name: COLOR_ROLE[k] || k, hex: (v.trim().startsWith("#") ? v.trim() : "#" + v.trim()).toUpperCase(), role: COLOR_ROLE[k] || k })),
      fonts: { display: g.fonts?.primary || "", body: g.fonts?.secondary || g.fonts?.primary || "" },
      logo: typeof g.logo?.dataUrl === "string" && g.logo.dataUrl.startsWith("data:") ? g.logo.dataUrl : "",
      voice: brandVoiceText(b) || "",
      tone: { do: [], dont: (tone.avoidWords || []).map((w) => `Hindari: ${w}`) },
      avoid: (tone.avoidWords || []).map((w) => String(w).toLowerCase()).filter(Boolean),
    },
    campaigns: campaigns.map((c) => {
      const mine = content.filter((x) => x.campaignId === c.id);
      return { id: c.id, name: c.name || "Campaign", status: CAMPAIGN_STATUS[c.status] || c.status || "planning", objective: [CAMPAIGN_OBJECTIVE_LABELS[c.objective], c.keyMessage].filter(Boolean).join(" · "), audience: c.targetAudience || "", strategy: c.bigIdea || c.insight || "", channels: c.channels || [], start: c.startDate || "", end: c.endDate || "", metrics: null, counts: { content: mine.length, published: mine.filter((x) => x.status === "published").length } };
    }),
    content: content.sort((a, b2) => String(a.scheduleDate || "9999").localeCompare(String(b2.scheduleDate || "9999"))).slice(0, 30)
      .map((c) => ({ id: c.id, title: c.title || c.idea || "Konten", platform: c.platform || "", date: c.scheduleDate || c.publishedDate || "", status: c.status, pic: "" })),
    contentStatuses: STATUSES.filter((s) => s !== "archived"),
    contentStatusLabels: STATUS_LABELS,
    tasks, milestones,
    goals: goals.map((x) => ({ id: x.id, name: x.name || x.title || "Tujuan" })),
    growth: ins || hist.length ? { weeks: hist.map((h) => new Date(h.at).toISOString().slice(5, 10).split("-").reverse().join("/")), followers: hist.map((h) => h.followers), er: [], top, latest: ins?.followers ?? hist.at(-1)?.followers ?? null, reach30d: ins?.reach30d ?? null, visits30d: ins?.profileVisits30d ?? null, updatedAt: ins?.updatedAt || hist.at(-1)?.at || null } : null,
    sales,
    people,
    objectives: CAMPAIGN_OBJECTIVES.map((k) => ({ id: k, label: CAMPAIGN_OBJECTIVE_LABELS[k] })),
  };
}

function makeLab(brandId) {
  let cache = null, version = 0;
  const listeners = new Set();
  const un = onChange(() => { cache = null; version++; listeners.forEach((f) => f()); });
  return {
    get() { if (!cache) cache = labData(brandId); return cache; },
    get version() { return version; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Simple actions done right on the board; returns the record (or null).
    save(kind, item) {
      if (!canEditBrand(brandId)) return null;
      if (kind === "tasks") {
        const [goalId, taskId] = String(item.id || "").includes(":") ? item.id.split(":") : [item.goalId, null];
        const goal = listGoals(brandId).find((x) => x.id === goalId);
        if (!goal) return null;
        if (taskId) { updateGoal(brandId, goalId, { tasks: (goal.tasks || []).map((t) => (t.id === taskId ? { ...t, ...("done" in item ? { done: !!item.done } : {}), ...(item.title ? { label: item.title } : {}), ...(item.due !== undefined ? { dueDate: item.due || "" } : {}) } : t)) }); return { id: item.id }; }
        // fromBoard: the board it came from, for the Papan home's task list
        const t = { id: Math.random().toString(36).slice(2, 10), laneId: "community", label: String(item.title || "Tugas").slice(0, 200), dueDate: item.due || "", done: false, ...(/^[A-Za-z0-9_-]{1,64}$/.test(item.boardId || "") ? { fromBoard: item.boardId } : {}) };
        updateGoal(brandId, goalId, { tasks: [...(goal.tasks || []), t] });
        return { id: `${goalId}:${t.id}` };
      }
      if (kind === "content") {
        if (item.id && listContent(brandId).some((c) => c.id === item.id)) { updateContent(item.id, { ...(item.status ? { status: item.status } : {}), ...(item.date !== undefined ? { scheduleDate: item.date } : {}) }); return { id: item.id }; }
        const c = createContent(brandId, { title: String(item.title || "Ide konten").slice(0, 200), idea: item.idea || item.title || "", status: "idea", platform: item.platform || "", ...(item.date ? { scheduleDate: item.date } : {}) });
        return c ? { id: c.id } : null;
      }
      if (kind === "campaigns") {
        const c = createCampaign(brandId, { name: String(item.name || "Campaign baru").slice(0, 120), objective: CAMPAIGN_OBJECTIVES.includes(item.objectiveId) ? item.objectiveId : "custom", targetAudience: item.audience || "", insight: item.insight || "", bigIdea: item.strategy || "", keyMessage: item.objective || "", channels: item.channels || [], startDate: item.start || "", endDate: item.end || "", status: "planning" });
        return c ? { id: c.id } : null;
      }
      return null;
    },
    close() { un(); listeners.clear(); },
  };
}

// ---------- the bridge object the iframe reads (window.parent.__papanBridge) ----------
export async function createBridge({ brandId, boardId, onBoard, openChat }) {
  const uid = auth.currentUser?.uid;
  const room = await makeRoom(brandId, uid).catch(() => null);
  const lab = makeLab(brandId);
  const bridge = {
    brandId, boardId: boardId || null, host: "brandlab",
    db: makeDb(brandId), user: makeUser(brandId, () => bridge.boardId), room, lab,
    canWrite: () => canEditBrand(brandId),
    theme: () => ({ theme: document.documentElement.dataset.theme || "dark", tint: getComputedStyle(document.documentElement).getPropertyValue("--brand-tint").trim() }),
    brandContext: () => { try { return buildBrandContext(getBrand(brandId)); } catch { return ""; } },
    ai: { json: (prompt) => papanJson(getSettings().ai, getBrand(brandId), prompt) },
    // Opens a Brandlab page for something on the board.
    go(target, id) {
      const map = { dna: `#/brand/${brandId}/dna`, brandbook: `#/brand/${brandId}/guidelines`, campaign: id ? `#/brand/${brandId}/campaigns/${id}` : `#/brand/${brandId}/campaigns`, content: id ? `#/brand/${brandId}/content/list/${id}` : `#/brand/${brandId}/content/calendar`, tasks: id ? `#/brand/${brandId}/goals/${id}` : `#/brand/${brandId}/goals`, goals: `#/brand/${brandId}/goals`, team: "#/settings/team", sales: `#/brand/${brandId}/sales`, growth: `#/brand/${brandId}` };
      if (map[target]) location.hash = map[target];
    },
    boardChanged(id) { bridge.boardId = id; onBoard && onBoard(id, keyOf(id)); watchBoard(id); },
    // The board's guest link (api/papan.js): {on, role: "edit"|"view", rotate}.
    async share(id, opts = {}) {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/papan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: "share", brandId, boardId: id, on: !!opts.on, role: opts.role === "view" ? "view" : "edit", rotate: !!opts.rotate }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(out.error || "share"), { code: out.error || "unknown" });
      room?.refresh();
      return out.share;
    },
    guestLink: (id, t) => `${location.origin}/papan/?tamu=${encodeURIComponent(`${brandId}.${id}.${t}`)}`,
    openChat(summaryFn) { openChat && openChat(summaryFn); },
    close() { boardUn?.(); boardUn = null; room?.close(); lab.close(); },
  };

  // The open board's link. Boards are open to anyone with the link by
  // default: the first time the owner or an editor opens a board that never
  // had one, it's switched on ("Bisa coret-coret"); Bagikan turns it off or
  // makes a new one. While it's on, the address carries its key (onBoard →
  // js/views/papan.js), so a copied address works like the Bagikan link.
  const keys = new Map(), asked = new Set();
  let boardUn = null;
  function keyOf(id) { return keys.get(id) || null; }
  function watchBoard(id) {
    boardUn?.(); boardUn = null;
    if (!id) return;
    loadFirestore().then((fs) => {
      if (bridge.boardId !== id || boardUn) return;
      boardUn = fs.onSnapshot(fs.doc(liveDb, `brands/${brandId}/boards/${id}`), { includeMetadataChanges: true }, (s) => {
        const sh = s.exists() ? s.data().share || null : null;
        const key = sh?.on && sh?.t ? sh.t : null;
        if (keys.get(id) !== key) {
          keys.set(id, key);
          if (bridge.boardId === id) onBoard && onBoard(id, key);
        }
        // Only on the server's copy: a board made a moment ago may not be
        // there yet, and the server refuses to share what it can't find.
        if (s.exists() && !sh && !s.metadata.fromCache && !s.metadata.hasPendingWrites && canEditBrand(brandId) && !asked.has(id)) {
          asked.add(id);
          bridge.share(id, { on: true, role: "edit" }).catch(() => {});
        }
      }, () => {});
    }).catch(() => {});
  }
  if (boardId) watchBoard(boardId);
  return bridge;
}
