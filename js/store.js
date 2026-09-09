// Shared data layer — Firestore-backed, synced live across every logged-in
// teammate. Every exported function below stays SYNCHRONOUS on purpose: an
// in-memory `db` mirror is the source of truth for all reads, updated
// instantly (optimistically) on local writes and kept in sync with
// Firestore in the background via onSnapshot listeners in initStore().
// This means none of the view files calling these functions need to change
// — only this file's internals talk to the network.
import { toast } from "./dom.js";
import { db as fdb } from "./firebase.js";
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export const METRIC_KEYS = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
  { key: "profileVisits", label: "Profile Visits" },
  { key: "followersGained", label: "Followers Gained" },
];

// Sums each metric across whatever platforms have a number for it (e.g. IG
// views + Facebook views = one combined total) — platforms with nothing yet
// just don't contribute. Returns null for a metric no platform has at all,
// so it still reads as "no data" instead of a misleading 0.
export function combinePlatformMetrics(performanceByPlatform = {}) {
  const totals = {};
  METRIC_KEYS.forEach(({ key }) => {
    const vals = Object.values(performanceByPlatform)
      .map((p) => p?.[key])
      .filter((v) => v !== undefined && v !== null && v !== "");
    totals[key] = vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  });
  return totals;
}

// "editing" sits between production (shooting) and scheduled — Creator has
// a checkbox that moves a card production → editing → scheduled as footage
// gets shot and then cut, instead of only being changeable from the Status
// dropdown.
export const STATUSES = ["idea", "draft", "production", "editing", "scheduled", "published", "archived"];
export const STATUS_LABELS = {
  idea: "Idea", draft: "Scripting", production: "Execution", editing: "Editing",
  scheduled: "Ready to Upload", published: "Published", archived: "Archived",
};
export const FUNNELS = ["TOFU", "MOFU", "BOFU"];
export const FUNNEL_LABELS = {
  TOFU: "Top of Funnel", MOFU: "Middle of Funnel", BOFU: "Bottom of Funnel",
};

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function defaultDB() {
  return {
    version: 1,
    brands: [],
    content: [],
    // Standing weekly routine on the home page — brand + day of week +
    // activity + optional time. Recurs every week (not tied to one date);
    // shooting/editing/upload entries auto-confirm from real content
    // activity that day, "custom" ones are checked off by hand each day.
    routineTemplate: [],
    settings: {
      platforms: [
        { id: "instagram", name: "Instagram" },
        { id: "facebook", name: "Facebook" },
        { id: "tiktok", name: "TikTok" },
        { id: "youtube", name: "YouTube" },
      ],
      formats: [
        { id: "reels", name: "Reels" },
        { id: "short-video", name: "Short Video" },
        { id: "carousel", name: "Carousel" },
        { id: "story", name: "Story" },
        { id: "long-video", name: "Long Video" },
        { id: "static-post", name: "Static Post" },
      ],
      formulas: {
        engagementRate: "(likes + comments + shares + saves) / reach * 100",
        followerConversionRate: "followersGained / reach * 100",
      },
      thresholds: {
        TOFU: {
          engagementRate: { good: 8, average: 4 },
          followerConversionRate: { good: 2, average: 1 },
        },
        MOFU: {
          engagementRate: { good: 6, average: 3 },
          followerConversionRate: { good: 3, average: 1.5 },
        },
        BOFU: {
          engagementRate: { good: 4, average: 2 },
          followerConversionRate: { good: 4, average: 2 },
        },
      },
      // Global, not per-brand — one shared Anthropic/Gemini key drives AI
      // Script & Hook Generation for every brand and every teammate, same
      // as the app's other credentials (stored in Firestore, used directly
      // from the browser).
      ai: { provider: "anthropic", anthropicApiKey: "", geminiApiKey: "" },
    },
  };
}

let db = defaultDB();

// Fires the `db:change` event synchronously (unchanged optimistic-UI
// behavior — every view still sees local writes instantly), then optionally
// runs `sync` (a Firestore write) in the background. A failed cloud sync
// doesn't roll back the local optimistic state — it surfaces as a toast so
// the change isn't silently lost, matching this app's existing
// never-silently-discard-data conventions.
function persist(sync) {
  window.dispatchEvent(new CustomEvent("db:change"));
  if (!sync) return;
  Promise.resolve()
    .then(sync)
    .catch((e) => {
      console.error("Cloud sync failed", e);
      toast("Couldn't save that change to the cloud — it may not appear for teammates.", "error");
    });
}

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 500) {
    const batch = writeBatch(fdb);
    ops.slice(i, i + 500).forEach((op) => {
      if (op.type === "delete") batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    });
    await batch.commit();
  }
}

// Attaches realtime listeners for every collection and resolves once the
// first snapshot of each has arrived — main.js awaits this once, after
// login, before the first render, so the app never flashes empty state.
// Every snapshot after that (including this client's own writes echoing
// back, and every other teammate's writes) re-populates `db` and fires
// `db:change` — this is what makes the app feel live/shared.
export function initStore() {
  return new Promise((resolve) => {
    const ready = { brands: false, content: false, routineTemplate: false, settings: false };
    const checkReady = () => {
      if (Object.values(ready).every(Boolean)) resolve();
    };
    const onErr = (label) => (e) => {
      console.error(`Cloud sync (${label}) failed`, e);
      toast(`Couldn't sync ${label} from the cloud.`, "error");
    };

    onSnapshot(collection(fdb, "brands"), (snap) => {
      db.brands = snap.docs.map((d) => d.data());
      ready.brands = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("brands"));

    onSnapshot(collection(fdb, "content"), (snap) => {
      db.content = snap.docs.map((d) => d.data());
      ready.content = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("content"));

    onSnapshot(collection(fdb, "routineTemplate"), (snap) => {
      db.routineTemplate = snap.docs.map((d) => d.data());
      ready.routineTemplate = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("routine"));

    onSnapshot(doc(fdb, "settings", "main"), (snap) => {
      const fresh = defaultDB();
      const data = snap.exists() ? snap.data() : {};
      db.settings = {
        ...fresh.settings,
        ...data,
        formulas: { ...fresh.settings.formulas, ...(data.formulas || {}) },
        thresholds: { ...fresh.settings.thresholds, ...(data.thresholds || {}) },
        ai: { ...fresh.settings.ai, ...(data.ai || {}) },
      };
      ready.settings = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("settings"));
  });
}

export function onChange(fn) {
  window.addEventListener("db:change", fn);
  return () => window.removeEventListener("db:change", fn);
}

// ---------- Brands ----------
export function listBrands({ includeArchived = false } = {}) {
  return db.brands
    .filter((b) => includeArchived || !b.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function getBrand(id) {
  return db.brands.find((b) => b.id === id) || null;
}
export function createBrand({ name, avatar = "", driveLink = "", brandbookLink = "", logoAssets = [], instagram, facebook, ads, aiVoiceGuide = "" } = {}) {
  const brand = {
    id: uid(), name: name.trim(), avatar,
    driveLink, brandbookLink, logoAssets,
    // Plain text, not the Drive link above — this is what actually gets fed
    // into the AI prompt, since the generator can't read a linked document.
    aiVoiceGuide,
    instagram: instagram || { accessToken: "", igUserId: "", username: "", connectedAt: null },
    facebook: facebook || { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null },
    ads: ads || { adAccountId: "", adsAccessToken: "", accountName: "", connectedAt: null },
    createdAt: Date.now(), archived: false,
  };
  db.brands.push(brand);
  persist(() => setDoc(doc(fdb, "brands", brand.id), brand));
  return brand;
}

export function addBrandLogo(brandId, { dataUrl, name }) {
  const b = getBrand(brandId);
  if (!b) return null;
  if (!b.logoAssets) b.logoAssets = [];
  const logo = { id: uid(), name: name || "Logo", dataUrl };
  b.logoAssets.push(logo);
  persist(() => setDoc(doc(fdb, "brands", b.id), b));
  return logo;
}
export function removeBrandLogo(brandId, logoId) {
  const b = getBrand(brandId);
  if (!b) return;
  b.logoAssets = (b.logoAssets || []).filter((l) => l.id !== logoId);
  persist(() => setDoc(doc(fdb, "brands", b.id), b));
}
export function updateBrand(id, patch) {
  const b = getBrand(id);
  if (!b) return null;
  Object.assign(b, patch);
  persist(() => setDoc(doc(fdb, "brands", b.id), b));
  return b;
}
export function archiveBrand(id, archived = true) {
  return updateBrand(id, { archived });
}
export function deleteBrand(id) {
  const removedContentIds = db.content.filter((c) => c.brandId === id).map((c) => c.id);
  db.brands = db.brands.filter((b) => b.id !== id);
  db.content = db.content.filter((c) => c.brandId !== id);
  persist(async () => {
    await deleteDoc(doc(fdb, "brands", id));
    await Promise.all(removedContentIds.map((cid) => deleteDoc(doc(fdb, "content", cid))));
  });
}

// ---------- Content ----------
function emptyContent(brandId) {
  return {
    id: uid(),
    brandId,
    title: "",
    idea: "",
    format: "",
    platform: "",
    funnel: "TOFU",
    status: "idea",
    scheduleDate: "",
    publishedDate: "",
    publishedUrl: "",
    script: "",
    caption: "",
    reference: "",
    cta: "",
    notes: "",
    thumbnail: "",
    // Raw per-platform numbers behind the combined `performance` total below —
    // kept so a future per-platform breakdown view doesn't need new data.
    performanceByPlatform: { instagram: {}, facebook: {} },
    performance: {
      views: null, reach: null, likes: null, comments: null,
      shares: null, saves: null, profileVisits: null, followersGained: null,
      insightScreenshot: "", confirmedAt: null,
    },
    // Paid ad results for this post, separate from organic performance above
    // — spend/impressions from a boost shouldn't get mixed into the
    // engagement-rate math, which assumes organic reach.
    adsPerformance: null,
    // Manually confirmed at the Ready to Upload stage — checking both moves
    // status to published.
    uploadedPlatforms: { tiktok: false, instagram: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  };
}

export function listContent(brandId, { includeArchived = false } = {}) {
  return db.content
    .filter((c) => c.brandId === brandId && (includeArchived || !c.archived))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getContent(id) {
  return db.content.find((c) => c.id === id) || null;
}
export function createContent(brandId, data = {}) {
  const item = { ...emptyContent(brandId), ...data, id: uid(), brandId };
  db.content.push(item);
  persist(() => setDoc(doc(fdb, "content", item.id), item));
  return item;
}
export function updateContent(id, patch) {
  const item = getContent(id);
  if (!item) return null;
  if (patch.performance) {
    item.performance = { ...item.performance, ...patch.performance };
    delete patch.performance;
  }
  Object.assign(item, patch, { updatedAt: Date.now() });
  persist(() => setDoc(doc(fdb, "content", item.id), item));
  return item;
}
export function archiveContent(id, archived = true) {
  return updateContent(id, { archived });
}
export function deleteContent(id) {
  db.content = db.content.filter((c) => c.id !== id);
  persist(() => deleteDoc(doc(fdb, "content", id)));
}

// Cross-brand scan for the notification bell — the shared source of truth
// for "what's due/overdue" so this comparison doesn't get re-derived a
// third time (dueBadge() in creator.js and overdueRemindersHTML() in
// brands.js each already had their own copy of it). Local calendar date,
// not toISOString() — that shifts across the day boundary in any timezone
// ahead of UTC (e.g. WIB), quietly misclassifying items right at midnight.
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function listOverdueAndDueSoon({ dueSoonDays = 3 } = {}) {
  const todayStr = localISODate(new Date());
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + dueSoonDays);
  const soonStr = localISODate(soonDate);

  const overdue = [];
  const dueToday = [];
  const dueSoon = [];
  listBrands().forEach((brand) => {
    listContent(brand.id).forEach((content) => {
      if (!content.scheduleDate || content.status === "published") return;
      if (content.scheduleDate < todayStr) overdue.push({ content, brand });
      else if (content.scheduleDate === todayStr) dueToday.push({ content, brand });
      else if (content.scheduleDate <= soonStr) dueSoon.push({ content, brand });
    });
  });
  const byDate = (a, b) => a.content.scheduleDate.localeCompare(b.content.scheduleDate);
  overdue.sort(byDate);
  dueToday.sort(byDate);
  dueSoon.sort(byDate);
  return { overdue, dueToday, dueSoon };
}

// ---------- Settings ----------
export function getSettings() {
  return db.settings;
}
function persistSettings() {
  persist(() => setDoc(doc(fdb, "settings", "main"), db.settings));
}
export function updateSettings(patch) {
  db.settings = { ...db.settings, ...patch };
  persistSettings();
  return db.settings;
}
export function updateFormulas(patch) {
  db.settings.formulas = { ...db.settings.formulas, ...patch };
  persistSettings();
}
export function updateAiSettings(patch) {
  db.settings.ai = { ...db.settings.ai, ...patch };
  persistSettings();
}
export function updateThresholds(funnel, patch) {
  db.settings.thresholds[funnel] = {
    engagementRate: { ...db.settings.thresholds[funnel].engagementRate, ...(patch.engagementRate || {}) },
    followerConversionRate: { ...db.settings.thresholds[funnel].followerConversionRate, ...(patch.followerConversionRate || {}) },
  };
  persistSettings();
}
export function addPlatform(name) {
  const p = { id: uid(), name: name.trim() };
  db.settings.platforms.push(p);
  persistSettings();
  return p;
}
export function removePlatform(id) {
  db.settings.platforms = db.settings.platforms.filter((p) => p.id !== id);
  persistSettings();
}
export function addFormat(name) {
  const f = { id: uid(), name: name.trim() };
  db.settings.formats.push(f);
  persistSettings();
  return f;
}
export function removeFormat(id) {
  db.settings.formats = db.settings.formats.filter((f) => f.id !== id);
  persistSettings();
}

// ---------- Routine Template (standing weekly schedule, home page) ----------
export const ROUTINE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const ROUTINE_DAY_LABELS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const ROUTINE_ACTIVITIES = ["shooting", "editing", "upload", "custom"];
export const ROUTINE_ACTIVITY_LABELS = { shooting: "Shooting", editing: "Editing", upload: "Upload", custom: "Custom" };

export function listRoutineTemplate() {
  return db.routineTemplate || [];
}
export function addRoutineItem({ brandId, day, activity, customLabel = "", time = "" }) {
  const item = { id: uid(), brandId, day, activity, customLabel: customLabel.trim(), time, doneDates: [] };
  db.routineTemplate = [...(db.routineTemplate || []), item];
  persist(() => setDoc(doc(fdb, "routineTemplate", item.id), item));
  return item;
}
export function removeRoutineItem(id) {
  db.routineTemplate = (db.routineTemplate || []).filter((t) => t.id !== id);
  persist(() => deleteDoc(doc(fdb, "routineTemplate", id)));
}
// Only meaningful for "custom" activity items — shooting/editing/upload
// confirm themselves from real content activity instead of being toggled.
export function markRoutineDoneToday(id, done) {
  const todayISO = new Date().toISOString().slice(0, 10);
  db.routineTemplate = (db.routineTemplate || []).map((t) => {
    if (t.id !== id) return t;
    const doneDates = done ? [...new Set([...(t.doneDates || []), todayISO])] : (t.doneDates || []).filter((d) => d !== todayISO);
    return { ...t, doneDates };
  });
  const updated = db.routineTemplate.find((t) => t.id === id);
  if (updated) persist(() => setDoc(doc(fdb, "routineTemplate", id), updated));
}

// ---------- Backup ----------
export function exportJSON() {
  return JSON.stringify(db, null, 2);
}
// The one-time (or occasional) bulk migration path — e.g. moving an
// existing local backup into this shared cloud database. Unlike every
// other write above, this is deliberately awaited by its caller rather than
// fire-and-forget, since it's a big batch operation the UI should wait on.
export async function importJSON(json) {
  const parsed = JSON.parse(json);
  const next = { ...defaultDB(), ...parsed };
  await commitInChunks([
    ...(next.brands || []).map((b) => ({ type: "set", ref: doc(fdb, "brands", b.id), data: b })),
    ...(next.content || []).map((c) => ({ type: "set", ref: doc(fdb, "content", c.id), data: c })),
    ...(next.routineTemplate || []).map((r) => ({ type: "set", ref: doc(fdb, "routineTemplate", r.id), data: r })),
    { type: "set", ref: doc(fdb, "settings", "main"), data: next.settings },
  ]);
  db = next;
  window.dispatchEvent(new CustomEvent("db:change"));
}
export function resetAll() {
  const brandIds = db.brands.map((b) => b.id);
  const contentIds = db.content.map((c) => c.id);
  const routineIds = (db.routineTemplate || []).map((r) => r.id);
  db = defaultDB();
  persist(() => commitInChunks([
    ...brandIds.map((id) => ({ type: "delete", ref: doc(fdb, "brands", id) })),
    ...contentIds.map((id) => ({ type: "delete", ref: doc(fdb, "content", id) })),
    ...routineIds.map((id) => ({ type: "delete", ref: doc(fdb, "routineTemplate", id) })),
    { type: "set", ref: doc(fdb, "settings", "main"), data: db.settings },
  ]));
}
