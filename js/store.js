// Shared data layer — Firestore-backed, synced live across every logged-in
// teammate. Every exported function below stays SYNCHRONOUS on purpose: an
// in-memory `db` mirror is the source of truth for all reads, updated
// instantly (optimistically) on local writes and kept in sync with
// Firestore in the background via onSnapshot listeners in initStore().
// This means none of the view files calling these functions need to change
// — only this file's internals talk to the network.
import { toast } from "./dom.js";
import { t, getLang } from "./i18n.js";
import CAMPAIGN_DICT from "./i18n/campaigns.js";
import { db as fdb, auth, loadFirestore } from "./firebase.js";
import { BLOB_FIELDS, isDataUrl, isAssetRef, assetIdOf, assetRefsOf, hasInlineBlobs, dehydrateBlobs, hydrateBlobs, blobValues, mapBlobSlots } from "./brand-assets.js";
import { brandLimitOf } from "./account.js";

// The Firestore SDK is loaded on first use (js/firebase.js loadFirestore),
// not with this module: the login screen imports store.js through the app
// shell but never touches the cloud. initStore() — and every write, via
// persist() — waits for it; until then these stay unset. `fdb` above is a
// live binding to the instance, set by the same load.
let collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, getDocs, arrayUnion, arrayRemove, serverTimestamp, getDoc, getDocFromCache, getDocFromServer, runTransaction;
let sdkReady = null;
function ensureSdk() {
  if (!sdkReady) {
    sdkReady = loadFirestore().then((fs) => {
      ({ collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, writeBatch, getDocs, arrayUnion, arrayRemove, serverTimestamp, getDoc, getDocFromCache, getDocFromServer, runTransaction } = fs);
      return fs;
    });
    sdkReady.catch(() => { sdkReady = null; });
  }
  return sdkReady;
}

export const METRIC_KEYS = [
  "views", "reach", "likes", "comments", "shares", "saves", "profileVisits", "followersGained",
].map((key) => ({ key, label: t(`store.metric.${key}`) }));

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

// Resolves this brand's actual Platform/Format entries (both user-editable
// lists, not fixed ids) that correspond to "Reels" (Instagram + Reels
// format) and "TikTok" (TikTok platform). Matched by name, case-insensitive,
// with a fallback chain — a brand that renamed/removed the expected entry
// degrades to null instead of silently mislabeling content. Shared by the
// New Content quick-pick and the dashboard's Reels-vs-TikTok widget so both
// always agree on what counts as which.
function findByName(list, candidates) {
  for (const name of candidates) {
    const hit = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.name;
  }
  return null;
}
export function resolveContentBuckets(settings) {
  const igPlatform = findByName(settings.platforms, ["Instagram"]);
  const reelsFormat = findByName(settings.formats, ["Reels"]);
  const tiktokPlatform = findByName(settings.platforms, ["TikTok", "Tik Tok"]);
  const tiktokFormat = findByName(settings.formats, ["Short Video", "Reels"]);
  return {
    reels: igPlatform && reelsFormat ? { platform: igPlatform, format: reelsFormat } : null,
    tiktok: tiktokPlatform ? { platform: tiktokPlatform, format: tiktokFormat } : null,
  };
}

function hasPlatformBreakdown(byPlatform) {
  return !!byPlatform && Object.values(byPlatform).some((p) => p && Object.keys(p).length);
}
// Organic views only — combined across whatever platforms were fetched,
// falling back to the flat (manual/OCR) figure for content with no
// per-platform breakdown yet, e.g. TikTok.
export function organicViews(content) {
  return hasPlatformBreakdown(content.performanceByPlatform)
    ? combinePlatformMetrics(content.performanceByPlatform).views
    : content.performance?.views ?? null;
}
// Instagram's own views only, excluding any Facebook crosspost number — for
// showing "without Facebook" alongside organicViews()'s "with Facebook"
// combined figure. Falls back to the flat performance.views for content
// with no per-platform breakdown at all (manual entry, no crosspost data).
export function instagramOnlyViews(content) {
  return hasPlatformBreakdown(content.performanceByPlatform)
    ? content.performanceByPlatform.instagram?.views ?? null
    : content.performance?.views ?? null;
}
// "editing" sits between production (shooting) and scheduled — Creator has
// a checkbox that moves a card production → editing → scheduled as footage
// gets shot and then cut, instead of only being changeable from the Status
// dropdown.
export const STATUSES = ["idea", "draft", "production", "editing", "scheduled", "published", "archived"];
export const STATUS_LABELS = Object.fromEntries(STATUSES.map((s) => [s, t(`store.status.${s}`)]));
export const FUNNELS = ["TOFU", "MOFU", "BOFU"];
export const FUNNEL_LABELS = {
  TOFU: "Top of Funnel", MOFU: "Middle of Funnel", BOFU: "Bottom of Funnel",
};

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export const CAMPAIGN_OBJECTIVES = ["personal-branding", "awareness", "launch", "sales", "event", "engagement", "community", "custom"];
export const CAMPAIGN_OBJECTIVE_LABELS = {
  "personal-branding": t("store.objective.personalBranding"),
  awareness: t("store.objective.awareness"), launch: t("store.objective.launch"), sales: t("store.objective.sales"), event: t("store.objective.event"),
  engagement: t("store.objective.engagement"), community: t("store.objective.community"), custom: t("store.objective.custom"),
};
// Which optional phases make sense for each objective — picking an
// objective already drives the AI prompt and the campaign's label; this
// extends it to also drive sensible phase defaults, so choosing a goal is
// enough to get the right journey shape without a separate "pick a
// template" step. Only the 3 genuinely optional phases (Website/Event/
// Community) ever need defaulting — the other 4 are always on regardless.
// Still just a default — every checkbox stays editable. `custom` is null
// on purpose: no override, leave whatever's already checked.
export const CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES = {
  "personal-branding": [],
  awareness: [],
  engagement: ["Community"],
  community: ["Community"],
  event: ["Website", "Event"],
  launch: ["Website", "Event"],
  sales: ["Website"],
  custom: null,
};
export const CAMPAIGN_STATUSES = ["planning", "active", "completed", "archived"];
export const CAMPAIGN_STATUS_LABELS = Object.fromEntries(CAMPAIGN_STATUSES.map((s) => [s, t(`store.campaignStatus.${s}`)]));

export function defaultBrandDNA() {
  return {
    tagline: "", oneLiner: "", purpose: "", vision: "", mission: "",
    targetAudience: "", problemSolved: "", positioning: "", differentiation: "",
    // StoryBrand-style narrative fields — what the customer gets if they say
    // yes (the win) and what they're risking if they don't (the stakes).
    callToAction: "", successOutcome: "", failureOutcome: "",
    personality: [], values: [], productsServices: [],
  };
}

// Series DNA — the same idea as Brand DNA above, one level down: instead
// of "who is this brand", it's "what does every episode of THIS recurring
// series have in common". Read by buildSeriesContext (ai.js) and injected
// as the middle layer between Brand Context and the current topic whenever
// a piece of content is linked to a series. Mirrors defaultBrandDNA's
// shape/fallback pattern on purpose — same read-time default-merge in
// getSeries() below for docs saved before a field existed.
export function defaultSeriesDNA() {
  return {
    // Basic information
    description: "", mainTopic: "", objective: "", targetAudience: "",
    platform: "", format: "",
    // Content style memory
    tone: "", writingStyle: "", typicalHook: "", storytellingStyle: "",
    structure: "", averageLength: "", ctaStyle: "", visualStyle: "",
    thingsToAvoid: "", additionalInstructions: "",
  };
}

export function defaultBrandGuidelines() {
  return {
    // dataUrl is the Main logo; secondary/logotype are optional variants
    // (a simplified mark, a text-only wordmark) — only shown/exported when
    // actually uploaded.
    logo: { hasLogo: null, dataUrl: "", secondaryDataUrl: "", logotypeDataUrl: "" },
    // Entirely optional, independent of hasLogo — a brand can have zero,
    // one, or several: { name, description, dataUrl }.
    mascots: [],
    colorFeelings: [],
    colorFormula: "",
    colors: { primary: "", secondary: "", accent: "", background: "", text: "" },
    typographyFeelings: [],
    fonts: { primary: "", secondary: "", accent: "" },
    // Uploaded font files, keyed by the display name the user gave them —
    // { [name]: dataUrl }. `fonts.*` can hold either a FONT_LIBRARY (Google
    // Fonts) family name or one of these custom names; either way it's just
    // a font-family string everywhere else in the app.
    customFonts: {},
    // Beyond the fixed Primary/Secondary/Accent roles — any extra typeface
    // someone wants documented (a decorative font, a second script accent,
    // etc). Each entry's `family` is a name in `customFonts` above (or a
    // FONT_LIBRARY family); `label` is whatever the user called it.
    extraFonts: [],
    // Line spacing (CSS line-height) and letter spacing (CSS letter-spacing,
    // in em) per font role — starts at a sane typographic default per role
    // (see TYPE_SPACING_DEFAULTS in brand-guidelines.js) and is editable
    // from the Typography step's "Tracking, Kerning & Leading" panel.
    typeSpacing: {
      primary: { lineHeight: 1.15, letterSpacing: 0 },
      secondary: { lineHeight: 1.6, letterSpacing: 0 },
      accent: { lineHeight: 1.3, letterSpacing: 0 },
    },
    visualDirection: [],
    // Reference photos for the Imagery Style page — separate from the
    // deterministic lighting/subject/treatment copy already derived from
    // Visual Direction, this is actual example images the brand wants to
    // point to. Entirely optional.
    moodboard: [],
    applications: [],
    // The Brand Book PDF's only AI-written content (Value Proposition,
    // Colour Essence) — generated once on demand from the Review screen
    // and cached here so it's stable across renders/exports instead of
    // re-calling the API (and drifting) every time the page repaints.
    aiCopy: { valueProposition: null, colorEssence: null },
  };
}

// Tracks progress + a couple of guided-flow-only decisions across the
// Brand Builder hub (js/views/brand-builder.js) — separate from brandDNA/
// brandGuidelines since those already have their own established shape and
// are read-only inputs here, not owned by this wizard. "personality" is the
// one genuinely new decision Phase 1 introduces: a primary/secondary/avoid
// trait triad recommended from the same feeling vocabulary color/typography
// already use, so a brand's character stays one shared decision instead of
// three disconnected chip-selects. `source` distinguishes an accepted
// recommendation from a hand-edited one — not a full decision-log (that's
// bigger scope, deferred), just enough for the Consistency Engine to know
// there's an established direction to check against.
// Split out so a "reset just this one stage" action (see
// js/views/brand-builder.js's Reset Brand DNA / Reset Brand Guidelines)
// can rebuild a single field back to its default without touching its
// siblings inside brandBuilder — Personality and Naming belong to the
// Brand DNA group, Tone of Voice to Brand Guidelines, even though all
// three live on this one object.
export function defaultPersonality() {
  return { feeling: "", primary: [], secondary: [], avoid: [], source: "" };
}
// 4 slider positions (0-100) across the e-book's Tone of Voice spectrums —
// see TONE_AXES in brandbook-data.js. 50 = dead center on every axis until
// the user actually moves one.
export function defaultToneOfVoice() {
  return { formal: 50, language: 50, character: 50, emotion: 50, avoidWords: [], source: "" };
}
// The one place a brand's "voice" should be read from: Brand DNA's
// personality traits + tone-of-voice sliders (brand.brandBuilder — the
// structured source brand-guidelines.js's voiceColumn already prefers),
// falling back to the old free-text aiVoiceGuide field for a brand that
// only ever has that (its own editable textarea in js/views/brands.js was
// removed — Brand DNA is the only way to set voice going forward, so old
// brands keep reading their old value here rather than losing it outright).
// Just the tone-of-voice slice (no personality traits) — a series' own
// dna.tone is a single free-text field, not a full voice guide, so it
// starts from this narrower text (see js/views/series.js openSeriesModal).
export function brandToneText(brand) {
  const tone = brand?.brandBuilder?.toneOfVoice;
  if (!tone?.source) return "";
  const lean = (key, left, right) => {
    const v = Number(tone[key]);
    if (!Number.isFinite(v)) return "";
    return v <= 35 ? left : v >= 65 ? right : `between ${left} and ${right}`;
  };
  const bits = [lean("formal", "casual", "formal"), lean("language", "plain", "technical"), lean("character", "serious", "playful"), lean("emotion", "reserved", "expressive")].filter(Boolean);
  if (!bits.length) return "";
  return `Tone of voice: ${bits.join(", ")}.${tone.avoidWords?.length ? ` Avoid: ${tone.avoidWords.join(", ")}.` : ""}`;
}
export function brandVoiceText(brand) {
  const personality = brand?.brandBuilder?.personality;
  const parts = [];
  const traits = [...(personality?.primary || []), ...(personality?.secondary || [])];
  if (traits.length) parts.push(`Personality: ${traits.join(", ")}.`);
  const toneText = brandToneText(brand);
  if (toneText) parts.push(toneText);
  if (parts.length) return parts.join(" ");
  return brand?.aiVoiceGuide || "";
}
function defaultBrandBuilder() {
  return {
    stage: "foundation",
    completedStages: [],
    personality: defaultPersonality(),
    toneOfVoice: defaultToneOfVoice(),
    consistencyDismissed: [],
  };
}

function defaultDB() {
  return {
    version: 1,
    brands: [],
    content: [],
    campaigns: [],
    // Standing weekly routine on the home page — brand + day of week +
    // activity + optional time. Recurs every week (not tied to one date);
    // shooting/editing/upload entries auto-confirm from real content
    // activity that day, "custom" ones are checked off by hand each day.
    routineTemplate: [],
    // Chat threads with their own doc each (see "Brainstorm threads" below):
    // the Home Companion's per-brand thread now, Brainstorm partner threads
    // next. Never inside the brand doc — a message shouldn't rewrite a doc
    // that carries the logo dataUrl.
    brainstorms: [],
    // Recurring Content Series ("Content Series Memory") — a reusable AI
    // context the owner defines once (e.g. "Bedah Brand": its tone,
    // structure, hooks, CTA) and every future episode reads from instead of
    // re-explaining the concept. Flat top-level collection scoped by
    // brandId, same shape as campaigns/content — never nested inside the
    // brand doc. See defaultSeriesDNA / buildSeriesContext (ai.js).
    series: [],
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
      // Starting assumptions for a SMALL account (< ~5K followers), rated on
      // ER-by-reach (the default formula above). 2025–26 reach-based
      // medians sit around 4–6% on Instagram Reels and 5–8% on TikTok, and
      // small accounts usually run higher — so TOFU 8% "good" is fair
      // there, while the MOFU/BOFU "average" bars are set closer to the
      // actual medians. Follower conversion (new followers ÷ reach) is
      // typically 0.1–0.5%; 1% is already a strong result, so "good" is 1%
      // and "average" 0.3% rather than the old 1–2% floors. Per-platform
      // overrides live in thresholdsByPlatform below.
      thresholds: {
        TOFU: {
          engagementRate: { good: 8, average: 4 },
          followerConversionRate: { good: 1, average: 0.3 },
        },
        MOFU: {
          engagementRate: { good: 6, average: 2.5 },
          followerConversionRate: { good: 1.5, average: 0.5 },
        },
        BOFU: {
          engagementRate: { good: 4, average: 2 },
          followerConversionRate: { good: 2, average: 0.7 },
        },
      },
      // Optional per-platform overrides, keyed by platform name exactly as
      // it appears on content (e.g. "TikTok"), same shape as `thresholds`.
      // Empty = every platform uses the defaults above. formulas.js
      // resolves content.platform → this map → thresholds.
      thresholdsByPlatform: {},
      // Global, not per-brand — which AI provider api/ai.js calls for every
      // brand and every teammate, and whether AI is switched on at all. No
      // key fields here anymore: the actual provider key lives in a Vercel
      // env var the server-side proxy reads (see api/ai.js) and never
      // reaches Firestore or the browser.
      ai: { provider: "", enabled: true },
      // "guided" is the default for every account that never picked a
      // mode: a brand owner opening Brandlab for the first time lands on the
      // simplified step-by-step Home (js/views/home.js), not the
      // widget/analytics dashboard. "advanced" is today's full app and is
      // one topbar click away (js/mode.js) — the choice is stored
      // account-wide, so the internal team only ever flips it once.
      experienceMode: "guided",
      // Which analytics widgets Advanced-mode Home shows, and in what order —
      // see js/views/brand-home-analytics.js's WIDGET_CATALOG for the full
      // key list. Global (like experienceMode above), not per-brand: this is
      // a display preference for whoever's looking, not brand data. Missing
      // entirely (older settings docs) falls back to "show everything" in
      // brand-home-analytics.js rather than needing a migration here.
      homeWidgets: ["growthViews", "growthEngagement", "retention", "topContent", "platformBreakdown", "formatBreakdown", "funnelBreakdown", "contentHealth"],
    },
  };
}

let db = defaultDB();

// Every write function above mutates `db` in place synchronously, so a
// caller reading getBrand()/getContent()/etc. right after calling one of
// them (in the same tick, before any listener runs) already sees the new
// data — dispatchDbChange below only tells OTHER already-mounted views to
// repaint, it is not what makes a write "visible". Coalesced through
// requestAnimationFrame so a burst of writes in one tick (installing a
// goal, a cascading trash delete, an import) triggers one repaint per view
// per frame instead of one per write — every current onChange() subscriber
// (grepped across the app) is a plain "repaint when something changed"
// listener, not a one-shot handler expecting a specific dispatch, so
// collapsing bursts into the next frame changes nothing it depends on.
let dbChangeScheduled = false;
function dispatchDbChange() {
  if (dbChangeScheduled) return;
  dbChangeScheduled = true;
  requestAnimationFrame(() => {
    dbChangeScheduled = false;
    window.dispatchEvent(new CustomEvent("db:change"));
  });
}

// Runs `sync` (a Firestore write) in the background and schedules the
// coalesced db:change dispatch above. A failed cloud sync doesn't roll back
// the local optimistic state — it surfaces as a toast so the change isn't
// silently lost, matching this app's existing never-silently-discard-data
// conventions.
function persist(sync) {
  dispatchDbChange();
  if (!sync) return;
  ensureSdk()
    .then(sync)
    .catch((e) => {
      console.error("Cloud sync failed", e);
      toast(t("store.syncSaveFailed"), "error");
    });
}

// Firestore's hard cap is 500 ops/batch — chunking at 400 leaves headroom
// (the trash cascades below sit right at that margin) without needing a
// second, riskier constant just for those.
// A batch request is also capped at 10 MiB — asset docs (uploaded files,
// up to ~1 MB each) can reach that long before 400 ops, so a chunk also
// closes at ~8 MB of data.
const BATCH_MAX_CHARS = 8_000_000;
// An entry may be `{ group: [op, …] }`: ops that must land in the same
// batch (a brand and the brand-count move that goes with it).
async function commitInChunks(ops) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  ops.filter(Boolean).forEach((entry) => {
    const group = (entry.group || [entry]).filter(Boolean);
    let size = 0;
    try { size = group.reduce((n, op) => n + (op.data ? JSON.stringify(op.data).length : 0), 0); } catch { /* unsized: counts as small */ }
    if (cur.length && (cur.length + group.length > 400 || chars + size > BATCH_MAX_CHARS)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(...group);
    chars += size;
  });
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const batch = writeBatch(fdb);
    chunk.forEach((op) => {
      if (op.type === "delete") batch.delete(op.ref);
      else if (op.type === "update") batch.update(op.ref, op.data);
      else if (op.options) batch.set(op.ref, op.data, op.options);
      else batch.set(op.ref, op.data);
    });
    await batch.commit();
  }
}

// ---------- Partial writes ----------
// An update writes only the top-level fields it changed, each replacing the
// stored field whole (an `undefined` field is deleted) — not the whole doc.
// A stale tab, or a device coming back online with an old copy, can then no
// longer overwrite fields it never touched, and a small edit to a brand no
// longer re-uploads every other field with it. Creates still write the whole
// doc (setDoc). A field name that isn't a plain identifier can't be written
// as a field path (a dot would read as nesting), so that rare case falls
// back to the old whole-doc setDoc.
const PLAIN_FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function fieldPatch(item, fields) {
  const out = {};
  fields.forEach((k) => { out[k] = item[k] === undefined ? deleteField() : item[k]; });
  return out;
}
function updateFields(col, id, item, fields) {
  const keys = [...new Set(fields)].filter(Boolean);
  if (!keys.length) return Promise.resolve();
  if (!keys.every((k) => PLAIN_FIELD.test(k))) return setDoc(doc(fdb, col, id), item);
  return updateDoc(doc(fdb, col, id), fieldPatch(item, keys));
}
// The same as one batch op, for the cascades that go through commitInChunks.
function updateOp(col, item, fields) {
  const keys = [...new Set(fields)].filter(Boolean);
  if (!keys.every((k) => PLAIN_FIELD.test(k))) return { type: "set", ref: doc(fdb, col, item.id), data: item };
  return { type: "update", ref: doc(fdb, col, item.id), data: fieldPatch(item, keys) };
}

// The signed-in account's uid — every collection below is queried filtered
// to `where("ownerId","==", ownerUid)` (required for Firestore to accept an
// unconstrained-looking listener under per-owner security rules: rules are
// evaluated per-document, but a *query* additionally has to be provably
// scoped to only-my-docs at the query level, or Firestore rejects it
// client-side before rules even run). Every write below stamps `ownerId`
// with this same value so it round-trips through that filter.
let ownerUid = null;

// Attaches realtime listeners for every collection (scoped to this account)
// and resolves once the first snapshot of each has arrived — main.js awaits
// this once, after login + account/plan check, before the first render, so
// the app never flashes empty state. Every snapshot after that (including
// this client's own writes echoing back, and every other teammate on the
// same account's writes) re-populates `db` and fires `db:change` — this is
// what makes the app feel live/shared.
// With the persistent cache (js/firebase.js) the first snapshot of every
// listener usually comes from this device's cache — the app paints from it
// at once — and the server's copy follows a moment later. Anything that
// WRITES on its own, without the owner asking (the 30-day Trash sweep, the
// one-time idea fold-in, a lazy blob/sales migration, Brand Pulse), must
// not act on a cache that may be a day old: it waits for this promise,
// which resolves once brands/content/campaigns/series have each had a
// server-confirmed snapshot.
let serverSyncedResolve = null;
let serverSyncedNow = false;
const serverSyncedPromise = new Promise((r) => { serverSyncedResolve = r; });
export function whenServerSynced() {
  return serverSyncedPromise;
}
export function isServerSynced() {
  return serverSyncedNow;
}

export function initStore(uid) {
  ownerUid = uid;
  return ensureSdk().then(() => new Promise((resolve) => {
    const ready = { brands: false, content: false, campaigns: false, routineTemplate: false, series: false, settings: false };
    const checkReady = () => {
      if (!Object.values(ready).every(Boolean)) return;
      resolve();
    };
    const synced = { brands: false, content: false, campaigns: false, series: false };
    const noteServer = (key, snap) => {
      if (serverSyncedNow || !(key in synced) || snap?.metadata?.fromCache) return;
      synced[key] = true;
      if (!Object.values(synced).every(Boolean)) return;
      serverSyncedNow = true;
      serverSyncedResolve();
      // Fire-and-forget: everything this account owns is confirmed by the
      // server now, so Trash rows older than TRASH_DAYS are safe to sweep
      // (a cached row could have been restored on another device since).
      // Never blocks the app's first render on it.
      try { purgeOldTrash(); } catch (e) { console.error("Trash auto-purge failed", e); }
    };
    // A permission-denied (e.g. a momentarily stale auth token right after a
    // network blip) or any other listener error used to leave `ready[key]`
    // false forever — checkReady() would then never see every collection
    // ready, so initStore()'s promise never resolved and the app stayed on
    // main.js's "Loading…" screen permanently, even once the underlying
    // problem (network, token) had already recovered. Marking it ready
    // anyway lets the app proceed with whatever did load; onSnapshot keeps
    // retrying in the background and repopulates `db` the moment it
    // reconnects, same as it already does for a listener that succeeds late.
    const onErr = (key, label) => (e) => {
      console.error(`Cloud sync (${label}) failed`, e);
      toast(t("store.syncLoadFailed", { what: t(`store.sync.${key}`) }), "error");
      ready[key] = true;
      checkReady();
    };
    const mine = (col) => query(collection(fdb, col), where("ownerId", "==", uid));

    // One listener per collection. includeMetadataChanges so the moment the
    // server confirms a cached snapshot is seen (see whenServerSynced) — a
    // metadata-only event (cache → server with nothing changed, or a local
    // write being acknowledged) doesn't rebuild the mirror or repaint.
    const watch = (key, label, apply = (snap) => { db[key] = snap.docs.map((d) => d.data()); }, onEvery = null) => {
      let seen = false;
      onSnapshot(mine(key), { includeMetadataChanges: true }, (snap) => {
        const changed = !seen || typeof snap.docChanges !== "function" || snap.docChanges().length > 0;
        seen = true;
        if (changed) {
          apply(snap);
          dispatchDbChange();
        }
        if (onEvery) onEvery(snap);
        ready[key] = true;
        checkReady();
        noteServer(key, snap);
      }, onErr(key, label));
    };
    watch("brands", "brands", (snap) => {
      db.brands = withPendingCreates(snap.docs.map((d) => {
        const raw = d.data();
        noteStoredBrand(raw);
        return overlayHeld(hydrateBrand(raw));
      }));
      // A new file ref (uploaded on another device) on the brand on screen.
      if (scope.brandId) loadBrandAssets(scope.brandId);
    }, noteBrandConfirmations);
    watch("content", "content");
    watch("campaigns", "campaigns");
    watch("routineTemplate", "routine");
    // Chat threads: per brand, see watchBrandScope.
    watch("series", "series");

    // One settings doc per account (not shared globally) — platforms,
    // formats, thresholds etc. are this account's own, never visible to
    // another customer. The AI provider + keys are the one exception: they
    // come from the shared settings/main doc (see applySettings), so both
    // listeners below rebuild db.settings whenever either doc changes.
    let personalData = {};
    const applySettings = () => {
      const fresh = defaultDB();
      personalAi = { ...fresh.settings.ai, ...(personalData.ai || {}) };
      db.settings = {
        ...fresh.settings,
        ...personalData,
        formulas: { ...fresh.settings.formulas, ...(personalData.formulas || {}) },
        thresholds: { ...fresh.settings.thresholds, ...(personalData.thresholds || {}) },
        thresholdsByPlatform: { ...(personalData.thresholdsByPlatform || {}) },
        ai: isGlobalAiActive() ? { ...personalAi, ...globalAi } : personalAi,
      };
      dispatchDbChange();
    };
    onSnapshot(doc(fdb, "settings", uid), (snap) => {
      personalData = snap.exists() ? snap.data() : {};
      applySettings();
      ready.settings = true;
      checkReady();
    }, onErr("settings", "settings"));

    // Wepeka-provided AI config shared by every account — a customer never
    // has to bring their own API key. Not part of `ready`: if this read
    // fails the app still loads, AI buttons just stay hidden (hasAiKey is
    // false) until the listener recovers.
    onSnapshot(doc(fdb, "settings", "main"), (snap) => {
      globalAi = snap.exists() ? (snap.data().ai || null) : null;
      globalBrandsBg = snap.exists() ? (snap.data().brandsBg || null) : null;
      applySettings();
    }, (e) => console.error("Cloud sync (shared AI config) failed", e));

    // The AI quota counter api/ai.js keeps for this account (see
    // firestore.rules: the client can read its own, never write it). Not
    // part of `ready` — js/ai-usage.js just shows 0 used until the first
    // snapshot lands, same as it always showed 0 before any call was made.
    onSnapshot(doc(fdb, "aiUsage", uid), (snap) => {
      aiUsageDoc = snap.exists() ? snap.data() : null;
      dispatchDbChange();
    }, (e) => console.error("Cloud sync (AI usage) failed", e));

    // This account's active-brand count (see "Brand count" below). Only a
    // server-confirmed value counts; missing → the server recounts it once.
    // Not part of `ready`: brand writes wait for it themselves.
    onSnapshot(doc(fdb, "brandCounts", uid), { includeMetadataChanges: true }, (snap) => {
      if (snap.metadata?.fromCache) return;
      brandCountDoc = snap.exists() ? snap.data() : null;
      if (brandCountDoc) settleBrandCount();
      else recountOnce();
    }, (e) => {
      // Unreadable (rules not deployed yet, …): write as an account without
      // a counter; a denied brand write still triggers the recount + retry.
      console.warn("Brand count unavailable", e);
      brandCountDoc = null;
      settleBrandCount();
    });
  }));
}

// ---------- Brand count: the plan's brand limit, enforced by the server ----------
// brandCounts/{uid} = { count, op, at, lastRecountAt? } — how many of this
// account's brands are ACTIVE (not archived, not in Trash): the same number
// js/account.js canCreateBrand/lockedBrandIds count. Only the server creates
// it (POST /api/brands/recount counts the brands with the Admin SDK — also
// the repair path). The client never creates or deletes it: every brand
// write that turns a brand active or inactive moves it by one IN THE SAME
// BATCH, naming the brand (`op`) and stamped with the server's time (`at`);
// firestore.rules check the two together and refuse any inactive → active
// move (create, unarchive, restore) past the plan's limit. An account with
// no counter is not limited — as before this release.
//
// WHEN COUNTING STARTS: the app only asks the server to create counters
// from BRAND_COUNT_START on (WIB). Before that, a tab still running the
// previous release — which never moves a counter — would get its brand
// create/archive/trash refused the moment the new app created one; by that
// date those tabs are gone. Until then: no recount, no counter writes, and
// brand writes don't wait for anything (an account that somehow already
// has a counter still gets its moves, or the rules would refuse them).
// To change the date, change this one line.
const BRAND_COUNT_START = "2026-10-14";
let brandCountStartMs = Date.parse(`${BRAND_COUNT_START}T00:00:00+07:00`);
// For tests (and a manual early start): an ISO date, WIB midnight.
export function setBrandCountStart(isoDate) {
  brandCountStartMs = Date.parse(`${isoDate}T00:00:00+07:00`);
}
const brandCountStarted = () => Date.now() >= brandCountStartMs;

let brandCountDoc; // undefined: not known yet · null: none on the server · else { count, op }
let brandCountReady = false;
let brandCountResolve = null;
const brandCountPromise = new Promise((r) => { brandCountResolve = r; });
function settleBrandCount() {
  if (brandCountReady) return;
  brandCountReady = true;
  brandCountResolve();
}
// Brand-activity writes wait for a known counter (a server snapshot, or
// none after the recount) — capped, so a dead connection can't hold them
// forever (they then go out as for an account without one). Nothing waits
// before BRAND_COUNT_START.
const BRAND_COUNT_WAIT_MS = 10_000;
function whenBrandCountSettled() {
  if (brandCountKnown()) return Promise.resolve();
  return Promise.race([brandCountPromise, new Promise((r) => setTimeout(r, BRAND_COUNT_WAIT_MS))]);
}
// True once brand create/archive/trash/restore can be sent with the right
// count (the UI may show "menyiapkan…" until then; the writes wait anyway).
export function brandCountKnown() {
  return brandCountReady || !ownerUid || !brandCountStarted();
}
// Asks the server to count this account's active brands and (re)write
// brandCounts/{uid}. Resolves to the count, or rejects (offline, no auth,
// before BRAND_COUNT_START).
export async function recountBrands() {
  if (!brandCountStarted()) throw new Error("recount: brand counting hasn't started yet");
  const token = await auth?.currentUser?.getIdToken?.();
  if (!token || typeof fetch !== "function") throw new Error("recount: not signed in");
  const res = await fetch("/api/brands/recount", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`recount failed (${res.status})`);
  const { count } = await res.json();
  // What the server just stored — the listener will say the same shortly.
  if (Number.isInteger(count) && count >= 0) brandCountDoc = { count, op: "recount" };
  return count;
}
let recountTried = false;
function recountOnce() {
  if (recountTried || !brandCountStarted()) {
    settleBrandCount();
    return;
  }
  recountTried = true;
  recountBrands()
    .catch((e) => console.warn("Brand recount unavailable", e))
    .finally(settleBrandCount);
}
// The one definition of an active brand, shared with firestore.rules
// (brandActive) and api/brands/recount.js — the rules only let deletedAt be
// null/absent or a timestamp and archived a boolean, so the app's own
// truthiness checks (listBrands, account.js) agree on every stored value.
export function brandIsActive(b) {
  return !!b && b.archived !== true && (b.deletedAt === undefined || b.deletedAt === null);
}
// The counter write that must go with a brand whose activeness changes, or
// null (no change, or no counter on the server — then none is needed).
// Merged, so the server's lastRecountAt stays.
function countOp(brandId, wasActive, isActive) {
  if (wasActive === isActive || !ownerUid || !brandCountDoc) return null;
  const count = Math.max(0, (Number(brandCountDoc.count) || 0) + (isActive ? 1 : -1));
  brandCountDoc = { ...brandCountDoc, count, op: brandId };
  return { type: "set", ref: doc(fdb, "brandCounts", ownerUid), data: { count, op: brandId, at: serverTimestamp() }, options: { merge: true } };
}
const isDenied = (e) => e?.code === "permission-denied" || /permission/i.test(String(e?.message || ""));
// The brand's activeness as the server holds it (for the retry below).
async function storedBrandActive(brandId, fallback) {
  try {
    const snap = await getDocFromServer(doc(fdb, "brands", brandId));
    return snap.exists() ? brandIsActive(snap.data()) : false;
  } catch {
    return fallback;
  }
}
// Hands a brand write — with the count move it needs — to Firestore at
// once (no waiting for the server: Firestore's own queue keeps the order
// and survives a reload), and returns the server's answer. Refused — the
// server's count moved meanwhile (another device, a recount, a counter that
// just appeared) or was simply wrong — then: recount on the server, re-read
// the brand's stored state, retry once. Still refused: an error with code
// "brand-limit" (over the plan's limit, as far as the client can tell), for
// the caller to explain. `buildOps(counterOp)` returns the commitInChunks
// ops. The first batch is handed over synchronously, before this returns.
function commitBrandMove(brandId, wasActive, isActive, buildOps) {
  const first = commitInChunks(buildOps(countOp(brandId, wasActive, isActive)));
  return first.catch(async (e) => {
    if (!isDenied(e) || !brandCountStarted()) throw e;
    await recountBrands().catch(() => {});
    const was = await storedBrandActive(brandId, wasActive);
    try {
      return await commitInChunks(buildOps(countOp(brandId, was, isActive)));
    } catch (e2) {
      if (!isDenied(e2)) throw e2;
      const err = new Error("Brand write refused by the server (brand count / plan limit)");
      err.code = "brand-limit";
      err.activating = isActive && !was;
      err.cause = e2;
      throw err;
    }
  });
}
// A brand write that can't be handed over yet — a brand-activity write
// waiting for the count, or any write behind its brand's own pending
// create — keeps its fields here, and every snapshot that rebuilds the
// brand meanwhile (another tab, a cached copy) puts them back on top, so
// the screen — and the next edit built from it — never sees them revert.
// Brands created but not handed over yet stay in the list the same way.
const heldFields = new Map(); // brandId → Map(field → value)
const pendingCreates = new Map(); // brandId → { brand, issued: Promise }
function holdBrandFields(brandId, values) {
  const held = heldFields.get(brandId) || new Map();
  Object.entries(values).forEach(([k, v]) => held.set(k, v));
  heldFields.set(brandId, held);
  return () => {
    const cur = heldFields.get(brandId);
    if (!cur) return;
    Object.entries(values).forEach(([k, v]) => { if (cur.get(k) === v) cur.delete(k); });
    if (!cur.size) heldFields.delete(brandId);
  };
}
// Closing or reloading the tab while a brand write still waits (≤10 s for
// the brand count, or behind its brand's create) would lose it — ask first.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", (e) => {
    if (!pendingCreates.size && !heldFields.size) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
function overlayHeld(brand) {
  heldFields.get(brand.id)?.forEach((v, k) => { brand[k] = v; });
  return brand;
}
function withPendingCreates(brands) {
  if (!pendingCreates.size) return brands;
  const ids = new Set(brands.map((b) => b.id));
  return [...brands, ...[...pendingCreates.values()].map((p) => p.brand).filter((b) => !ids.has(b.id))];
}
// A refused move is undone locally, with a message that says why.
function brandMoveFailed(e, revert) {
  if (e?.code !== "brand-limit") throw e;
  try { revert?.(); } catch { /* best effort */ }
  dispatchDbChange();
  toast(e.activating ? t("brands.offer.lockedTitle", { limit: brandLimitOf() }) : t("store.syncSaveFailed"), "error");
}

// ---------- Brand scope: loaded only for the brand on screen ----------
// What only a brand's own pages read is not loaded for every brand at
// startup. main.js calls watchBrandScope(brandId) for each brand route and
// waits for what it returns: the brand's chat threads, and — only for a
// brand that uses the Sales Tracker — its sales log (a few month docs; both
// queries run in parallel). Uploaded files load WITHOUT blocking (see
// loadBrandAssets): pages render, and fill them in when they arrive.
// Switching brands swaps the listeners.
let scope = { brandId: null, unsubs: [], ready: null };
export function watchBrandScope(brandId) {
  if (!brandId || !ownerUid) return Promise.resolve();
  if (!onSnapshot) return ensureSdk().then(() => watchBrandScope(brandId));
  if (scope.brandId === brandId && scope.ready) return scope.ready;
  scope.unsubs.forEach((u) => { try { u(); } catch { /* already stopped */ } });
  const unsubs = [];
  scope = { brandId, unsubs, ready: null };
  salesListenFor = null;
  detachThreads(brandId);
  ensureAssetPlaceholderStyle();
  // Resolves on the first snapshot (cache or server) — or on an error, so a
  // failed listener never leaves a page waiting forever (same rule as
  // initStore's onErr).
  const listen = (ref, onData, opts = {}) => new Promise((resolve) => {
    unsubs.push(onSnapshot(ref, opts, (snap) => {
      if (scope.brandId !== brandId) return;
      onData(snap);
      dispatchDbChange();
      resolve();
    }, (e) => {
      console.error(`Cloud sync (brand ${brandId}) failed`, e);
      toast(t("store.syncLoadFailed", { what: t("store.sync.brands") }), "error");
      resolve();
    }));
  });
  const mineIn = (col) => query(collection(fdb, col), where("ownerId", "==", ownerUid), where("brandId", "==", brandId));
  const waits = [
    // includeMetadataChanges: a thread counts as confirmed (safe to rewrite
    // its whole log) only once a server snapshot has carried it.
    listen(mineIn("brainstorms"), (snap) => applyThreadSnapshot(brandId, snap), { includeMetadataChanges: true }),
  ];
  if (brandUsesSales(brandId)) waits.push(ensureBrandSales(brandId));
  scope.ready = Promise.all(waits).then(() => {});
  loadBrandAssets(brandId);
  setTimeout(() => {
    if (scope.brandId === brandId) sweepBrandAssets(brandId).catch((e) => console.warn("Brand file sweep skipped", e));
  }, ASSET_SWEEP_DELAY_MS);
  return scope.ready;
}
// The brand whose scope is loaded right now (null before any brand route).
export function scopeBrandId() {
  return scope.brandId;
}

// ---------- Brand assets (uploaded files, js/brand-assets.js) ----------
// Asset docs are content-addressed and never change, so they're read once
// — this device's cache first (free), the server only for what isn't there
// — instead of through a live listener that re-bills them on every reopen.
// assetData: brandId → Map(assetId → dataUrl), every file seen this session.
// serverBlobs: brandId → { refs, inline } of the stored brand doc, and
// confirmedBrands: ids whose last snapshot came from the server with no
// pending write of this tab — the only state the sweep below trusts.
const assetData = new Map();
const serverBlobs = new Map();
const confirmedBrands = new Set();
// Asset ids the last SERVER-CONFIRMED brand doc references, and the ones
// this tab handed to Firestore itself: a save re-sends neither.
const confirmedRefs = new Map();
// "Sent by this tab" only counts for a day: a tab left open longer may
// hold a file another device's sweep has since deleted, so after that it
// re-sends rather than trusting the old mark.
const UPLOADED_MARK_MS = 24 * 60 * 60 * 1000;
const uploadedAssets = new Map(); // brandId → Map(assetId → sentAt)
function sentRecently(brandId) {
  const marks = uploadedAssets.get(brandId);
  if (!marks) return new Set();
  const now = Date.now();
  return new Set([...marks].filter(([, at]) => now - at < UPLOADED_MARK_MS).map(([id]) => id));
}
function assetOnServer(brandId, id) {
  return !!(confirmedRefs.get(brandId)?.has(id) || sentRecently(brandId).has(id));
}
// Returns an undo, for a write the server then refuses.
function noteUploaded(brandId, list) {
  const marks = uploadedAssets.get(brandId) || new Map();
  const now = Date.now();
  const added = list.map((u) => u.id).filter((id) => !marks.has(id) || now - marks.get(id) >= UPLOADED_MARK_MS);
  added.forEach((id) => marks.set(id, now));
  uploadedAssets.set(brandId, marks);
  return () => added.forEach((id) => marks.delete(id));
}
const assetLoading = new Map(); // brandId → the load in progress (loads queue per brand)
function rememberAssets(brandId, list) {
  const map = assetData.get(brandId) || new Map();
  list.forEach((a) => { if (a?.id && typeof a.dataUrl === "string") map.set(a.id, a.dataUrl); });
  assetData.set(brandId, map);
}
function noteStoredBrand(raw) {
  serverBlobs.set(raw.id, { refs: assetRefsOf(raw), inline: hasInlineBlobs(raw) });
  serverSales.set(raw.id, Array.isArray(raw.salesTracker?.entries) ? raw.salesTracker.entries : []);
}
function noteBrandConfirmations(snap) {
  const fromServer = !snap.metadata?.fromCache;
  snap.docs.forEach((d) => {
    if (fromServer && !d.metadata?.hasPendingWrites) {
      confirmedBrands.add(d.id);
      confirmedRefs.set(d.id, assetRefsOf(d.data()));
    } else confirmedBrands.delete(d.id);
  });
}
function hydrateBrand(brand) {
  const map = assetData.get(brand?.id);
  const out = map ? hydrateBlobs(brand, (id) => map.get(id)) : brand;
  return hydrateSales(out);
}
function hydrateInPlace(brandId) {
  const b = db.brands.find((x) => x.id === brandId);
  if (!b) return;
  // In place: a view holding this brand object sees the files too.
  const h = hydrateBrand(b);
  [...BLOB_FIELDS, "salesTracker"].forEach((k) => { if (h[k] !== b[k]) b[k] = h[k]; });
  overlayHeld(b);
}
// The Brand Book's own state (state.answers, a brandGuidelines-shaped copy
// taken when the page opened) with any refs that have loaded since swapped
// for their files — same values as stored, so saving it changes nothing.
// The same, but INTO that object (Brand Book handlers hold it — replacing it
// would let a pick made while files load be overwritten). True if changed.
export function fillGuidelinesFiles(brandId, a) {
  const map = assetData.get(brandId);
  if (!map || !a) return false;
  let changed = false;
  const fill = (obj, key) => {
    const v = obj?.[key];
    if (isAssetRef(v) && map.has(assetIdOf(v))) {
      obj[key] = map.get(assetIdOf(v));
      changed = true;
    }
  };
  if (a.logo) ["dataUrl", "secondaryDataUrl", "logotypeDataUrl"].forEach((k) => fill(a.logo, k));
  ["mascots", "moodboard"].forEach((k) => (Array.isArray(a[k]) ? a[k] : []).forEach((item) => fill(item, "dataUrl")));
  if (a.customFonts && typeof a.customFonts === "object") Object.keys(a.customFonts).forEach((k) => fill(a.customFonts, k));
  return changed;
}
export function hydrateGuidelines(brandId, guidelines) {
  const map = assetData.get(brandId);
  return map ? hydrateBlobs({ brandGuidelines: guidelines }, (id) => map.get(id)).brandGuidelines : guidelines;
}
async function fetchAsset(brandId, id, strict) {
  const ref = doc(fdb, "brands", brandId, "assets", id);
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) return { id, dataUrl: cached.data()?.dataUrl };
  } catch {
    /* not on this device yet */
  }
  try {
    const snap = await getDoc(ref);
    // Read fine, but not there (a dangling ref): `missing`, not an error.
    return snap.exists() ? { id, dataUrl: snap.data()?.dataUrl } : { id, missing: true };
  } catch (e) {
    if (strict) throw e;
    console.warn("Brand file not loaded", e);
    return null;
  }
}
// Loads whatever files the brand references that aren't in memory yet,
// fills them into the brand (in place) and repaints. Resolves when done;
// `strict` (backup export): rejects if a file couldn't be READ (network,
// permission) — a file that simply isn't there is no error.
export function loadBrandAssets(brandOrId, opts = {}) {
  const brandId = typeof brandOrId === "string" ? brandOrId : brandOrId?.id;
  if (!brandId) return Promise.resolve();
  // One load at a time per brand: a second call waits, then fetches only
  // what the first didn't bring.
  const run = (assetLoading.get(brandId) || Promise.resolve()).catch(() => {}).then(() => loadBrandAssetsNow(brandOrId, opts));
  assetLoading.set(brandId, run);
  run.catch(() => {}).finally(() => { if (assetLoading.get(brandId) === run) assetLoading.delete(brandId); });
  return run;
}
async function loadBrandAssetsNow(brandOrId, { strict = false } = {}) {
  const brand = typeof brandOrId === "string" ? db.brands.find((b) => b.id === brandOrId) : brandOrId;
  if (!brand?.id) return;
  const map = assetData.get(brand.id);
  const ids = [...assetRefsOf(brand)].filter((id) => !map?.has(id));
  if (!ids.length) return;
  try {
    await ensureSdk();
    const found = await Promise.all(ids.map((id) => fetchAsset(brand.id, id, strict)));
    rememberAssets(brand.id, found.filter((f) => f?.dataUrl));
    hydrateInPlace(brand.id);
    dispatchDbChange();
  } catch (e) {
    if (strict) throw e;
    console.warn("Brand files not loaded", e);
  }
}
// While a file is still loading its <img> holds an "asset:" ref: keep it
// invisible instead of a broken-image icon (filled in on the repaint).
let placeholderStyled = false;
function ensureAssetPlaceholderStyle() {
  if (placeholderStyled || typeof document === "undefined" || !document.head?.appendChild) return;
  placeholderStyled = true;
  const style = document.createElement("style");
  style.textContent = 'img[src^="asset:"]{visibility:hidden}';
  document.head.appendChild(style);
}
// THE one way to read a stored file value, whichever shape it has: an old
// inline data URL (returned as is), an "asset:<id>" ref (its data URL once
// loaded, else ""), or anything else (""). Brands in memory are already
// hydrated through this lookup; this is for code holding a raw value.
export function resolveAsset(brandId, value) {
  if (isDataUrl(value)) return value;
  if (!isAssetRef(value)) return "";
  return assetData.get(brandId)?.get(assetIdOf(value)) || "";
}
// A brand with its files swapped in — for one that isn't the brand on
// screen: the locked pricing screen's read-only Brand Book (raw docs read
// straight from Firestore) and the PDF. Works before initStore.
export async function withBrandAssets(brand, { strict = false } = {}) {
  if (!brand?.id || !assetRefsOf(brand).size) return brand;
  await loadBrandAssets(brand, { strict });
  return hydrateBrand(brand);
}

// Files no save deletes (a tab with an unacknowledged write, or a device
// offline with an old copy, may still point at the previous one). Instead,
// at most once a week per brand and device, a deferred sweep works in two
// phases against the SERVER-CONFIRMED brand doc (never while a backup
// import/export runs):
//   - a file neither that doc nor this tab references gets marked
//     unusedSince (server time);
//   - a file still marked and unreferenced 14+ days after its mark is
//     deleted; one that's referenced again loses its mark.
// So a file is only deleted after two weeks of nobody using it.
const ASSET_SWEEP_DELAY_MS = 20_000;
const ASSET_UNUSED_MS = 14 * 86400000;
const ASSET_SWEEP_EVERY_MS = 7 * 86400000;
let bulkBusy = 0;
const millisOf = (v) => (typeof v?.toMillis === "function" ? v.toMillis() : Number(v) || 0);
export async function sweepBrandAssets(brandId, { now = Date.now(), force = false } = {}) {
  const result = { marked: 0, cleared: 0, deleted: 0 };
  if (bulkBusy || !ownerUid || !serverSyncedNow || !confirmedBrands.has(brandId)) return result;
  const key = `brandlab:assetSweep:${brandId}`;
  if (!force) {
    try {
      if (now - Number(localStorage.getItem(key) || 0) < ASSET_SWEEP_EVERY_MS) return result;
    } catch {
      /* storage off: sweep anyway */
    }
  }
  await ensureSdk();
  const snap = await getDocs(query(collection(fdb, "brands", brandId, "assets"), where("ownerId", "==", ownerUid)));
  // Re-checked after the await: the brand may have changed meanwhile.
  if (bulkBusy || !confirmedBrands.has(brandId)) return result;
  const local = db.brands.find((b) => b.id === brandId);
  const keep = new Set([...(confirmedRefs.get(brandId) || []), ...(local ? assetRefsOf(dehydrateBlobs(local).stored) : []), ...sentRecently(brandId)]);
  const writes = snap.docs.map((d) => {
    const ref = doc(fdb, "brands", brandId, "assets", d.id);
    const mark = d.data()?.unusedSince;
    if (keep.has(d.id)) {
      if (mark == null) return null;
      result.cleared += 1;
      return updateDoc(ref, { unusedSince: deleteField() });
    }
    if (mark == null) {
      result.marked += 1;
      return updateDoc(ref, { unusedSince: serverTimestamp() });
    }
    if (now - millisOf(mark) < ASSET_UNUSED_MS) return null;
    result.deleted += 1;
    return deleteDoc(ref);
  });
  await Promise.all(writes.filter(Boolean).map((p) => p.catch((e) => console.warn("Brand file sweep step skipped", e))));
  try {
    localStorage.setItem(key, String(now));
  } catch {
    /* storage off */
  }
  return result;
}

// ---------- Sales log (brands/{brandId}/sales/{YYYY-MM}) ----------
// brand.salesTracker.entries used to grow inside the brand doc without
// bound. Entries now live in one doc per month —
//   brands/{brandId}/sales/{YYYY-MM} = { ownerId, brandId, month, entries: [...] }
// — far below 1 MiB each, so a cold open reads one doc per month of
// history. The brand doc keeps the rest of salesTracker (products, opening
// numbers, last advice). In memory nothing changes: salesTracker.entries is
// the merge of what the brand doc still holds inline (old brands) and the
// month docs, so js/sales-tracker.js, campaign metrics, the AI's sales
// snapshot and reports read the same array as before.
// Writes never rewrite a month: a new entry is arrayUnion'ed into its
// month, a removed one arrayRemove'd — safe from a stale cache or a second
// device, and idempotent. Old inline entries move to their months when the
// owner next saves the Sales Tracker (never from an unrelated save).
// salesData: brandId → Map(entryId → entry) from the month docs.
// serverSales: brandId → entries the stored brand doc still holds inline.
const salesData = new Map();
const serverSales = new Map();
const salesLoads = new Map();
export const salesMonthOf = (entry) => (/^\d{4}-\d{2}-\d{2}/.test(String(entry?.date || "")) ? String(entry.date).slice(0, 7) : "undated");
function rememberSalesDocs(brandId, docs) {
  const entries = new Map();
  docs.forEach((d) => (d.data()?.entries || []).forEach((e, i) => { if (e) entries.set(e.id || `${d.id}#${i}`, e); }));
  salesData.set(brandId, entries);
  hydrateInPlace(brandId);
}
function mergedEntries(brandId, inline) {
  const sub = salesData.get(brandId);
  if (!sub) return inline;
  const byId = new Map();
  (inline || []).forEach((e, i) => { if (e) byId.set(e.id || `inline#${i}`, e); });
  sub.forEach((e, id) => byId.set(id, e));
  // Stable sort: the log stays in the order sales were logged.
  return [...byId.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}
function hydrateSales(brand) {
  if (!brand?.id || !salesData.has(brand.id)) return brand;
  const inline = serverSales.get(brand.id) || [];
  return { ...brand, salesTracker: { ...(brand.salesTracker || {}), entries: mergedEntries(brand.id, inline) } };
}
// A brand whose sales log is worth loading: it has products (no sale can be
// logged without one) or entries still inline. Others cost nothing.
function brandUsesSales(brandId) {
  const b = db.brands.find((x) => x.id === brandId);
  return !!(b?.salesTracker?.products?.length || b?.salesTracker?.entries?.length || serverSales.get(brandId)?.length);
}
// True once this brand's sales log is in memory — js/sales-tracker.js only
// mirrors totals into a campaign (and shows totals as final) from a full log.
export function isBrandSalesReady(brandId) {
  return !ownerUid || salesData.has(brandId) || !brandUsesSales(brandId);
}
// Loads a brand's month docs: a live listener for the brand on screen (set
// up again whenever the brand is opened again — a copy left from an earlier
// visit isn't trusted as final), a one-time read for any other brand or a
// backup (`strict`: always read, and reject on failure). Resolves once
// they're in memory.
let salesListenFor = null;
let salesLive = null;
export function ensureBrandSales(brandId, { strict = false } = {}) {
  if (!brandId || !ownerUid) return Promise.resolve();
  const live = !strict && scope.brandId === brandId;
  if (live && salesListenFor === brandId) return salesLive;
  if (!live && !strict && salesData.has(brandId)) return Promise.resolve();
  if (!live && !strict && salesLoads.has(brandId)) return salesLoads.get(brandId);
  const run = ensureSdk().then(() => {
    const ref = query(collection(fdb, "brands", brandId, "sales"), where("ownerId", "==", ownerUid));
    if (!live) return getDocs(ref).then((snap) => rememberSalesDocs(brandId, snap.docs));
    return new Promise((resolve) => {
      if (scope.brandId !== brandId) return resolve();
      scope.unsubs.push(onSnapshot(ref, (snap) => {
        if (scope.brandId !== brandId) return;
        rememberSalesDocs(brandId, snap.docs);
        dispatchDbChange();
        resolve();
      }, (e) => {
        console.error(`Cloud sync (sales ${brandId}) failed`, e);
        toast(t("store.syncLoadFailed", { what: t("store.sync.brands") }), "error");
        resolve();
      }));
    });
  });
  if (live) {
    salesListenFor = brandId;
    salesLive = run.catch(() => {});
    return salesLive;
  }
  salesLoads.set(brandId, run);
  run.catch(() => {}).finally(() => { if (salesLoads.get(brandId) === run) salesLoads.delete(brandId); });
  return run;
}
// The writes that store a Sales Tracker save. `prev` = the entries before
// the change (updateBrand captures them): added → arrayUnion into their
// month, removed → arrayRemove from it, and every entry the stored brand
// doc still holds inline moves to its month (lazy migration) — so the
// brand's own salesTracker is written without entries. `fresh` (a backup
// being restored): every entry goes to its month, nothing is removed.
function salesWritePlan(b, prev, { fresh = false } = {}) {
  const tracker = b.salesTracker || {};
  const next = (Array.isArray(tracker.entries) ? tracker.entries : []).filter((e) => e && typeof e === "object");
  const before = (fresh ? [] : Array.isArray(prev) ? prev : next).filter((e) => e && typeof e === "object");
  const nextIds = new Set(next.map((e) => e.id));
  const beforeIds = new Set(before.map((e) => e.id));
  const inline = fresh ? [] : serverSales.get(b.id) || [];
  const add = [...inline.filter((e) => e && nextIds.has(e.id)), ...next.filter((e) => fresh || !beforeIds.has(e.id))];
  const remove = before.filter((e) => !nextIds.has(e.id));
  const ownerId = b.ownerId || ownerUid;
  const byMonth = (list) => list.reduce((m, e) => m.set(salesMonthOf(e), [...(m.get(salesMonthOf(e)) || []), e]), new Map());
  const ref = (month) => doc(fdb, "brands", b.id, "sales", month);
  const ops = [
    ...[...byMonth(add)].map(([month, list]) => ({ type: "set", ref: ref(month), data: { ownerId, brandId: b.id, month, entries: arrayUnion(...list) }, options: { merge: true } })),
    ...[...byMonth(remove)].map(([month, list]) => ({ type: "set", ref: ref(month), data: { ownerId, brandId: b.id, month, entries: arrayRemove(...list) }, options: { merge: true } })),
  ];
  const { entries, ...rest } = tracker;
  return { ops, stored: rest };
}

// Shared AI config lives in settings/main (written only by the Wepeka team
// account, see firestore.rules). `globalAi` is that doc's `ai` block or null;
// `personalAi` is this account's own `ai` block, kept separately so
// persistSettings() never copies the shared config into settings/{uid}.
let globalAi = null;
let personalAi = null;
// Seasonal background of the all-brands home, also in settings/main
// (admin-written, read by everyone) — see js/brands-bg.js.
let globalBrandsBg = null;
// api/ai.js's own quota counter for this account (aiUsage/{uid} — see
// js/ai-usage.js's getAiUsageDoc()). No API keys live in settings/main.ai
// anymore (see api/ai.js) — it only ever carries { provider, enabled }.
let aiUsageDoc = null;
// True when the shared config actually turns AI on: a provider is picked
// and it wasn't explicitly switched off. Whether a key exists for that
// provider is the server's problem now (api/ai.js), not the browser's.
export function isGlobalAiActive() {
  return !!globalAi?.provider && globalAi.enabled !== false;
}
export function getGlobalAiSettings() {
  return globalAi ? { ...globalAi } : null;
}
export function updateGlobalAiSettings(patch) {
  const next = { ...(globalAi || {}), ...patch };
  persist(() => setDoc(doc(fdb, "settings", "main"), { ai: next }, { merge: true }));
}
// One-time cleanup for accounts still carrying the pre-server-proxy key
// fields (anthropicApiKey/geminiApiKey/deepseekApiKey) in settings/main.ai —
// see the "Hapus kunci lama" button in js/views/settings.js. Safe to call
// more than once; deleting a field that's already gone is just a no-op.
export function deleteLegacyGlobalAiKeys() {
  return ensureSdk().then(() => updateDoc(doc(fdb, "settings", "main"), {
    "ai.anthropicApiKey": deleteField(),
    "ai.geminiApiKey": deleteField(),
    "ai.deepseekApiKey": deleteField(),
  }));
}

// The live aiUsage/{uid} doc api/ai.js writes after every counted AI call —
// js/ai-usage.js reads this instead of the old client-side settings.aiUsage.
export function getAiUsageDoc() {
  return aiUsageDoc ? { ...aiUsageDoc } : null;
}

export function getGlobalBrandsBg() {
  return globalBrandsBg ? { ...globalBrandsBg } : null;
}
export function updateGlobalBrandsBg(next) {
  globalBrandsBg = next;
  persist(() => setDoc(doc(fdb, "settings", "main"), { brandsBg: next }, { merge: true }));
  dispatchDbChange();
}

export function onChange(fn) {
  window.addEventListener("db:change", fn);
  return () => window.removeEventListener("db:change", fn);
}

// ---------- Trash (soft delete) ----------
// "Delete" on a brand/campaign/content/series no longer hard-deletes it —
// it stamps `deletedAt` instead. The doc keeps its place in `db` (the
// Firestore listeners that populate db.brands/content/campaigns/series stay
// exactly as tolerant as they already were of any field, deletedAt
// included — no listener change needed) and every list* helper below
// hides it unless called with `{ includeDeleted: true }`. Settings → Data's
// Trash section (js/views/settings.js) lists everything still carrying
// deletedAt across every brand, with Restore (clears the field) or Hapus
// permanen (a real deleteDoc via purge*By Id below). purgeOldTrash() below
// best-effort hard-deletes anything past TRASH_DAYS, called once data is
// loaded (see initStore).
export const TRASH_DAYS = 30;
const notDeleted = (x) => !x.deletedAt;

// ---------- Brands ----------
export function listBrands({ includeArchived = false, includeDeleted = false } = {}) {
  return db.brands
    .filter((b) => (includeArchived || !b.archived) && (includeDeleted || notDeleted(b)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
// Read-time fallback for brands created before Brand DNA existed — no
// migration script needed, they just get the empty-field defaults merged in
// the moment they're read.
export function getBrand(id) {
  const b = db.brands.find((b) => b.id === id) || null;
  if (b && !b.brandDNA) b.brandDNA = defaultBrandDNA();
  if (b && !b.brandGuidelines) b.brandGuidelines = defaultBrandGuidelines();
  if (b && !b.brandBuilder) b.brandBuilder = defaultBrandBuilder();
  // Every current call site already guards these locally (brand?.instagram
  // || {...}, etc.) — defaulting here too so that stays true by
  // construction instead of by every future caller remembering to guard.
  if (b && !b.instagram) b.instagram = { accessToken: "", igUserId: "", username: "", connectedAt: null };
  if (b && !b.facebook) b.facebook = { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null };
  return b;
}
export function createBrand({ name, avatar = "", color = "", instagram, facebook, aiVoiceGuide = "", businessDescription = "", audienceLanguage = "", brandDNA, brandGuidelines, brandBuilder } = {}) {
  const brand = {
    id: uid(), ownerId: ownerUid, name: name.trim(), avatar,
    // Manually-picked brand essence color (hex) — takes priority over the
    // auto-sampled avatar color everywhere --brand-tint is used (hover
    // glow on brand cards, the tab/scrollbar/button tint inside that
    // brand's own lab). Empty until the user sets one in Edit Brand.
    color,
    // A plain-language "what does this brand do" paragraph, captured right
    // at creation so every AI feature has at least basic business context
    // from day one — before anyone's gone through the full (optional,
    // multi-step) Brand DNA wizard. See ai.js's buildBrandContext.
    businessDescription,
    // Plain text, not the Drive link above — this is what actually gets fed
    // into the AI prompt, since the generator can't read a linked document.
    aiVoiceGuide,
    // "" = every AI feature writes in the app's own UI language (default);
    // "id"/"en" forces that language for this brand's audience-facing
    // content regardless of which language the owner runs the app in — see
    // outputLanguageRule() in js/ai.js.
    audienceLanguage,
    // Structured brand identity — the foundation Campaign/Content/AI read
    // from instead of every feature re-asking the user the same questions.
    brandDNA: { ...defaultBrandDNA(), ...(brandDNA || {}) },
    // The visual system (colors/fonts/logo/visual direction) built on top of
    // brandDNA — the Brand Book builder reads brandDNA for its foundation
    // section rather than re-asking, then writes here.
    brandGuidelines: { ...defaultBrandGuidelines(), ...(brandGuidelines || {}) },
    brandBuilder: { ...defaultBrandBuilder(), ...(brandBuilder || {}) },
    instagram: instagram || { accessToken: "", igUserId: "", username: "", connectedAt: null },
    facebook: facebook || { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null },
    createdAt: Date.now(), archived: false,
  };
  db.brands.push(brand);
  // The brand (with the count move) goes first — its files can only be
  // written under a brand that exists (firestore.rules ownsBrandAfter).
  // Handed to Firestore as soon as the count is known; until then it stays
  // in the list (pendingCreates) and later saves of it wait behind it.
  let issued;
  pendingCreates.set(brand.id, { brand, issued: new Promise((r) => { issued = r; }) });
  persist(async () => {
    let undoUploads = null;
    try {
      if (brandIsActive(brand)) await whenBrandCountSettled();
      const { stored, uploads } = dehydrateBlobs(brand);
      rememberAssets(brand.id, uploads);
      undoUploads = noteUploaded(brand.id, uploads);
      const assetOps = uploads.map((u) => ({ type: "set", ref: doc(fdb, "brands", brand.id, "assets", u.id), data: assetDoc(brand, u) }));
      const answer = commitBrandMove(brand.id, false, brandIsActive(brand), (counter) => [{ group: [{ type: "set", ref: doc(fdb, "brands", brand.id), data: stored }, counter] }, ...assetOps]);
      pendingCreates.delete(brand.id);
      issued();
      await answer;
    } catch (e) {
      pendingCreates.delete(brand.id);
      issued();
      undoUploads?.();
      brandMoveFailed(e, () => { db.brands = db.brands.filter((x) => x.id !== brand.id); });
    }
  });
  return brand;
}

export function updateBrand(id, patch) {
  const b = getBrand(id);
  if (!b) return null;
  // What a refused move must restore, and the sales log as it was (the
  // Sales Tracker save is written as what it added/removed — salesWritePlan).
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, b[k]]));
  const wasActive = brandIsActive(b);
  const prevEntries = b.salesTracker?.entries;
  Object.assign(b, patch);
  writeBrand(b, Object.keys(patch), { wasActive, prevEntries, revert: () => Object.assign(b, before) });
  return b;
}
// Every write of an existing brand doc goes through here: only `fields`
// (top-level) are sent, with their values as they are NOW (a snapshot that
// rebuilds the brand before the write goes out can't change what's sent).
// Files in them become their own asset docs (the brand gets "asset:<id>"
// refs, js/brand-assets.js) and a Sales Tracker save sends its entries to
// the month docs — files/sales first, the brand last, one batch normally.
// Old inline files/entries move out ONLY when this save writes that very
// field (the owner saving the Brand Book, the cover, the Sales Tracker).
// Handed to Firestore at once, with no waiting for earlier writes to be
// acknowledged; only a brand-activity write (archived/deletedAt) waits for
// the count to be known, and any write waits behind its brand's own
// pending create. A refusal is handled when its answer comes back.
function writeBrand(b, fields, { wasActive = brandIsActive(b), prevEntries, revert } = {}) {
  const keys = new Set(fields);
  // A field name that can't be a field path means a whole-doc write
  // (updateFields' fallback): files and entries must then be split out too.
  if (![...keys].every((k) => PLAIN_FIELD.test(k))) {
    BLOB_FIELDS.forEach((k) => { if (k in b) keys.add(k); });
    if (b.salesTracker) keys.add("salesTracker");
  }
  const values = Object.fromEntries([...keys].map((k) => [k, b[k]]));
  const isActive = brandIsActive(b);
  const activity = wasActive !== isActive || keys.has("archived") || keys.has("deletedAt");
  const behind = pendingCreates.get(b.id)?.issued;
  const release = (activity && !brandCountKnown()) || behind ? holdBrandFields(b.id, values) : null;
  persist(async () => {
    try {
      if (behind) await behind;
      if (activity) await whenBrandCountSettled();
    } finally {
      release?.();
    }
    const out = { ...b, ...values };
    const subOps = [];
    let undoUploads = null;
    if (BLOB_FIELDS.some((k) => keys.has(k))) {
      const { stored, uploads } = dehydrateBlobs(Object.fromEntries(BLOB_FIELDS.filter((k) => keys.has(k) && k in values).map((k) => [k, values[k]])));
      Object.assign(out, stored);
      // Known before the write's own snapshot arrives, so it hydrates at once.
      rememberAssets(b.id, uploads);
      // Only files the server doesn't have yet: the Brand Book saves on
      // every change, and each set would resend the whole file.
      const fresh = uploads.filter((u) => !assetOnServer(b.id, u.id));
      undoUploads = noteUploaded(b.id, fresh);
      subOps.push(...fresh.map((u) => ({ type: "set", ref: doc(fdb, "brands", b.id, "assets", u.id), data: assetDoc(b, u) })));
    }
    if (keys.has("salesTracker") && values.salesTracker) {
      const plan = salesWritePlan({ ...b, salesTracker: values.salesTracker }, prevEntries);
      out.salesTracker = plan.stored;
      subOps.push(...plan.ops);
    }
    if (wasActive === isActive && !subOps.length) return updateFields("brands", b.id, out, [...keys]);
    try {
      await commitBrandMove(b.id, wasActive, isActive, (counter) => [...subOps, { group: [updateOp("brands", out, [...keys]), counter] }]);
    } catch (e) {
      undoUploads?.();
      brandMoveFailed(e, revert);
    }
  });
}
function assetDoc(b, u) {
  return { ownerId: b.ownerId || ownerUid, brandId: b.id, kind: u.kind, dataUrl: u.dataUrl, ...(u.name ? { name: String(u.name).slice(0, 200) } : {}), createdAt: Date.now() };
}
// ---------- Brand Insights (account-level numbers) ----------
// The one home for profile numbers (followers, reach, profile visits) —
// campaigns read them from here instead of storing their own copy inside
// a milestone. Entered by hand in the "Perbarui Insights" modal, or from
// the Instagram API for accounts that have it. Every update is appended
// to a small history so "gained since campaign start" and a trend can be
// derived without anyone retyping old numbers.
export const INSIGHTS_HISTORY_CAP = 60;
export function getBrandInsights(brand, platform = "instagram") {
  const ins = brand?.insights?.[platform];
  return ins && typeof ins === "object" ? ins : null;
}
export function updateBrandInsights(brandId, platform, { followers = null, reach30d = null, profileVisits30d = null, at = Date.now(), source = "manual" } = {}) {
  const b = getBrand(brandId);
  if (!b) return null;
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const entry = { platform, followers: num(followers), reach30d: num(reach30d), profileVisits30d: num(profileVisits30d), at, source };
  const insights = { ...(b.insights || {}) };
  const prev = insights[platform] || {};
  insights[platform] = {
    followers: entry.followers ?? prev.followers ?? null,
    reach30d: entry.reach30d ?? prev.reach30d ?? null,
    profileVisits30d: entry.profileVisits30d ?? prev.profileVisits30d ?? null,
    updatedAt: at,
    source,
  };
  const history = [...(b.insightsHistory || []), entry].sort((x, y) => x.at - y.at).slice(-INSIGHTS_HISTORY_CAP);
  return updateBrand(brandId, { insights, insightsHistory: history });
}
// Follower count closest to (at or before) `atMs`, else the earliest one
// after it — the baseline for "followers gained since this campaign began".
export function insightsBaseline(brand, platform, atMs) {
  const hist = (brand?.insightsHistory || []).filter((h) => h.platform === platform && Number.isFinite(h.followers));
  if (!hist.length) return null;
  const before = hist.filter((h) => h.at <= atMs);
  return before.length ? before[before.length - 1] : hist[0];
}

// ---------- Brand Pulse: development log (js/brand-pulse.js) ----------
// A short, capped timeline of "what's happening" — auto-detected signals
// plus the "moments" the owner confirmed from a Companion recap (a sales
// spike, an offer, a VIP customer…). Feeds js/brand-pulse.js
// buildPulseText, which every AI feature reads so recommendations stay
// aware of what's actually going on, not just static brand facts. What is
// deliberately NOT here: the raw Companion chat — that lives in its own
// brainstorms/ thread (below) and only the Companion itself reads it, so
// an offhand vent never reaches Creator or Copy Studio unless the owner
// turned it into a moment on purpose. Short strings only, no content
// bodies or dataUrls — the whole log stays a tiny fraction of the brand
// doc. `brand.companion = { lastAskedAt: "YYYY-MM-DD", lastRecapAt: ms }`
// is written straight through updateBrand.
export const DEVELOPMENT_LOG_CAP = 80;
// What a recap is allowed to file a moment under (js/ai.js recapCompanion
// is told the same list; js/views/home.js validates against it).
export const MOMENT_KINDS = ["sales-spike", "offer", "vip", "collab", "launch", "complaint", "event", "other"];
export const MOMENT_ACTIONS = ["content", "brainstorm", "sales"];
export function addBrandLogEntry(brandId, { kind, source = "auto", title, detail = "", refs = {}, key = null, at = Date.now() }) {
  const b = getBrand(brandId);
  if (!b) return null;
  const entry = { id: uid(), at, kind, source, title, detail, refs, key: key || `${kind}:${uid()}`, ack: false };
  const log = [...(b.developmentLog || []), entry].slice(-DEVELOPMENT_LOG_CAP);
  updateBrand(brandId, { developmentLog: log });
  return entry;
}
// Bulk version for js/brand-pulse.js computeSignals() output: dedupes by
// `key` (a freshly computed signal for the same key replaces the stale
// logged one instead of piling up every time the pulse runs), sorts by
// `at`, caps at 80. Entries not carrying a `key` from computeSignals are
// never produced here — this is for automatic signals only, not notes.
export function appendBrandEvents(brandId, events) {
  const b = getBrand(brandId);
  if (!b || !events?.length) return b?.developmentLog || [];
  const existingKeys = new Set((b.developmentLog || []).map((e) => e.key).filter(Boolean));
  // A still-true condition (e.g. the same streak-break) recomputes with a
  // brand-new `at` (now) and `key` (same isoWeek) on every pulse run — if
  // that replaced the already-logged entry, it would keep jumping back to
  // "most recent", undoing an owner's ack and crowding out real
  // conversation (notes/AI replies) from the top of the log. Once a key is
  // logged this week, leave it alone; only a genuinely new key gets added.
  const fresh = events.filter((s) => s.key && !existingKeys.has(s.key));
  if (!fresh.length) return b.developmentLog || [];
  const additions = fresh.map((s) => ({ id: uid(), at: s.at, kind: s.kind, source: "auto", title: s.title, detail: s.detail || "", refs: s.refs || {}, key: s.key, ack: false }));
  const log = [...(b.developmentLog || []), ...additions].sort((a, b2) => a.at - b2.at).slice(-DEVELOPMENT_LOG_CAP);
  updateBrand(brandId, { developmentLog: log });
  return log;
}
// The moments an owner ticked on a Companion recap card, in one write so
// the brand doc is rewritten once per recap, not once per moment. Each
// `{ kind, title, detail, action }` is already validated by the caller.
export function addBrandMoments(brandId, moments) {
  const b = getBrand(brandId);
  if (!b || !moments?.length) return [];
  const at = Date.now();
  const additions = moments.map((m, i) => ({
    id: uid(),
    at: at + i,
    kind: m.kind,
    source: "moment",
    title: m.title,
    detail: m.detail || "",
    refs: { action: m.action || null },
    key: `moment:${uid()}`,
    ack: false,
  }));
  const log = [...(b.developmentLog || []), ...additions].slice(-DEVELOPMENT_LOG_CAP);
  updateBrand(brandId, { developmentLog: log });
  return additions;
}
// Takes one entry out of developmentLog for good, so it's also gone from
// js/brand-pulse.js buildPulseText the very next time any AI feature reads
// this brand's pulse. Does not un-send anything already sent to an AI
// provider in a past request — only stops it being sent again.
export function removeBrandLogEntry(brandId, id) {
  const b = getBrand(brandId);
  if (!b) return;
  const log = (b.developmentLog || []).filter((e) => e.id !== id);
  updateBrand(brandId, { developmentLog: log });
}
// Wipes the whole development log for this brand — the "forget everything"
// escape hatch. Auto-detected signals (streak breaks, overdue content, …)
// can reappear on the next Brand Pulse run if the underlying condition is
// still true; notes and AI replies never regenerate, so those are gone for
// good.
export function clearBrandLog(brandId) {
  updateBrand(brandId, { developmentLog: [] });
}

// ---------- Ideas inbox (brand.ideas[]) ----------
// The one place every "content idea" lands, wherever it was made: the
// Companion/Brainstorm chat (source:"chat"), the scratch pad's "save as
// idea" (source:"scratch"), or a campaign's own idea-bubbles widget
// (source:"campaign", tagged with that campaign's id). `campaignId` is
// optional/null for a brand-level idea; set it to scope an idea to one
// campaign the way campaign.ideas[] (now retired) used to. Shape:
// { id, text, description, source, campaignId, createdAt, status }.
export const BRAND_IDEAS_CAP = 100;
export function addBrandIdea(brandId, { text, description = "", source = "brainstorm", campaignId = null, notes = "", hooks = [], threadId = null }) {
  const b = getBrand(brandId);
  const clean = String(text || "").trim();
  if (!b || !clean) return null;
  // A "concept": the plain idea plus optional notes, candidate hooks and the
  // chat/campaign it came from. Old ideas simply lack these fields.
  const idea = { id: uid(), text: clean.slice(0, 140), description: String(description || "").trim().slice(0, 400), source, campaignId: campaignId || null, createdAt: Date.now(), status: "concept", ...(notes ? { notes: String(notes).trim().slice(0, 1200) } : {}), ...(hooks.length ? { hooks: hooks.map((h) => String(h).trim().slice(0, 200)).filter(Boolean).slice(0, 6) } : {}), ...(threadId ? { threadId } : {}) };
  updateBrand(brandId, { ideas: [...(b.ideas || []), idea].slice(-BRAND_IDEAS_CAP) });
  return idea;
}
export function updateBrandIdea(brandId, id, patch) {
  const b = getBrand(brandId);
  if (!b) return;
  updateBrand(brandId, { ideas: (b.ideas || []).map((i) => (i.id === id ? { ...i, ...patch, updatedAt: Date.now() } : i)) });
}
export function removeBrandIdea(brandId, id) {
  const b = getBrand(brandId);
  if (!b) return;
  updateBrand(brandId, { ideas: (b.ideas || []).filter((i) => i.id !== id) });
}
// One-time, idempotent fold-in of ideas that used to live somewhere else:
// a campaign's own `ideas[]` (the old per-campaign idea-bubbles widget).
// Guarded by `ideasMigratedAt` so it runs at most once per brand — cheap
// enough to call from every listBrandIdeas() read. A chat thread's own
// `ideas[]` (a save-time "don't re-suggest this" copy) is NOT migrated
// here: every entry it ever held was written in the same action that also
// wrote a brand/campaign idea, so its content already exists in `b.ideas`
// (or gets folded in below via the campaign it was scoped to) — nothing
// unique would be gained by copying it too.
function migrateLegacyIdeasOnce(b) {
  // Never from a cached copy that may predate a migration made elsewhere.
  if (b.ideasMigratedAt || !serverSyncedNow) return;
  const fromCampaigns = (db.campaigns || []).filter((c) => c.brandId === b.id && c.ideas?.length);
  if (fromCampaigns.length) {
    const existingIds = new Set((b.ideas || []).map((i) => i.id));
    const migrated = fromCampaigns.flatMap((c) =>
      (c.ideas || [])
        .filter((i) => i?.id && !existingIds.has(i.id))
        .map((i) => ({ ...i, campaignId: i.campaignId || c.id, source: i.source || "campaign" }))
    );
    if (migrated.length) b.ideas = [...(b.ideas || []), ...migrated].slice(-BRAND_IDEAS_CAP);
  }
  b.ideasMigratedAt = Date.now();
  writeBrand(b, ["ideas", "ideasMigratedAt"]);
}
// The one read every idea-list UI (chat's saved ideas, a campaign's idea
// widget) should call instead of touching brand.ideas or campaign.ideas
// directly. `campaignId: null` (default) reads brand-level ideas only;
// pass a campaign's id to read that campaign's own.
export function listBrandIdeas(brandId, { campaignId = null } = {}) {
  const b = getBrand(brandId);
  if (!b) return [];
  migrateLegacyIdeasOnce(b);
  return (b.ideas || []).filter((i) => (campaignId ? i.campaignId === campaignId : !i.campaignId));
}

// ---------- Goals (brand.goals[]) — Roadmap ke Tujuan ----------
// A goal sits above campaigns: { id, type: "event", name, targetDate,
// startDate, status, inputs, roadmap, installed, tasks, createdAt,
// updatedAt }. It lives on the brand doc (like brand.ideas) rather than in
// its own collection so it needs no Firestore rules change; the roadmap is
// a few KB. `installed` records which campaigns/content the goal created,
// so installing again after a failure never duplicates anything (see
// js/goal-actions.js). Status: draft | installing | partial | active |
// completed | archived.
export const GOALS_CAP = 20;
export const GOAL_STATUSES = ["draft", "installing", "partial", "active", "completed", "archived"];

// The last day a goal still asks anything of the owner: the end of its last
// phase (post-event included), else the event date itself.
export function goalEndDate(goal) {
  const ends = (goal?.roadmap?.eventPhases || []).map((p) => p.dateTo).filter(Boolean).sort();
  return ends[ends.length - 1] || goal?.targetDate || "";
}
// What a goal's status really is today. Nobody had to press "Tandai selesai"
// for an event that is over: once its last phase has passed, a running plan
// reads as completed, and a draft that was never installed as archived — so
// neither keeps Pemula's one-plan-at-a-time lock shut or sits on Home. Only
// derived, never written, so a plan whose date gets moved later comes back.
export function effectiveGoalStatus(goal, today = localISODate()) {
  const s = goal?.status;
  if (!goal || s === "completed" || s === "archived") return s;
  const end = goalEndDate(goal);
  if (!end || end >= today) return s;
  return s === "draft" ? "archived" : "completed";
}
function withEffectiveStatus(g, today) {
  const s = effectiveGoalStatus(g, today);
  return s === g.status ? g : { ...g, status: s, autoStatus: true };
}
export function listGoals(brandId, { includeArchived = false } = {}) {
  const b = getBrand(brandId);
  const today = localISODate();
  return (b?.goals || []).map((g) => withEffectiveStatus(g, today)).filter((g) => includeArchived || g.status !== "archived").sort((a, b2) => (a.targetDate || "").localeCompare(b2.targetDate || ""));
}
export function getGoal(brandId, id) {
  const g = (getBrand(brandId)?.goals || []).find((x) => x.id === id);
  return g ? withEffectiveStatus(g, localISODate()) : null;
}
export function createGoal(brandId, data = {}) {
  const b = getBrand(brandId);
  if (!b) return null;
  const now = Date.now();
  const goal = { id: uid(), type: "event", name: "", targetDate: "", startDate: "", status: "draft", inputs: {}, roadmap: null, installed: { campaigns: {}, slots: {} }, tasks: [], createdAt: now, updatedAt: now, ...data };
  updateBrand(brandId, { goals: [...(b.goals || []), goal].slice(-GOALS_CAP) });
  return goal;
}
export function updateGoal(brandId, id, patch) {
  const b = getBrand(brandId);
  const cur = (b?.goals || []).find((g) => g.id === id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  updateBrand(brandId, { goals: b.goals.map((g) => (g.id === id ? next : g)) });
  return next;
}
// Deleting a goal must never leave a campaign pointing at a goalId that no
// longer exists (campaign-detail.js's "Lihat roadmap" link and the mission
// milestone-removal path both read `getGoal(brandId, campaign.goalId)`).
// Every campaign this goal installed gets its goalId/goalLaneId cleared
// unconditionally; archiveCampaigns additionally archives them instead of
// leaving them active with no goal behind them — the caller asks the user
// which they want (see js/views/goal-roadmap.js's delete menu action).
export function deleteGoal(brandId, id, { archiveCampaigns = false } = {}) {
  const b = getBrand(brandId);
  if (!b) return;
  const linked = (db.campaigns || []).filter((c) => c.brandId === brandId && c.goalId === id);
  linked.forEach((c) => {
    c.goalId = "";
    c.goalLaneId = "";
    if (archiveCampaigns) c.status = "archived";
    c.updatedAt = Date.now();
  });
  b.goals = (b.goals || []).filter((g) => g.id !== id);
  writeBrand(b, ["goals"]);
  persist(() => Promise.all(linked.map((c) => updateFields("campaigns", c.id, c, ["goalId", "goalLaneId", "status", "updatedAt"]))));
}

// ---------- Brainstorm threads (brainstorms/ collection) ----------
// One doc per chat thread: { id, ownerId, brandId, campaignId, contentId,
// title, mode, messages, ideas, proposal, createdAt, updatedAt }. `mode`
// is "companion" / "consult" for the chat's two rolling threads per brand
// (fixed ids, see companionThreadId / consultThreadId below) and "chat" |
// "script" for Brainstorm conversations. messages are
// { id, role: "user"|"assistant", text, at, blocks? } — `blocks` keeps the
// parsed directive output (ideas, asks, a recap card…) so the cards survive
// a reload without re-parsing or re-asking the model. Capped: the oldest
// messages drop off; anything worth keeping past that has become a moment.
export const THREAD_MESSAGE_CAP = 80;

// Threads are loaded for the brand on screen only (watchBrandScope below,
// started by main.js for every brand route) — a chat log can be long, and
// nothing outside a brand's own pages ever reads another brand's threads.
// So these stay synchronous for the active brand; for any other brand they
// return what happens to be in memory (normally nothing).
//
// Writes must survive a brand switch and a stale cache: an AI reply that
// finishes after the owner moved to another brand (consultant-panel keeps
// going in the background) is still appended — on the server, by id — and
// a whole-log rewrite (edit/remove a message, trim to the cap) only goes
// out blind for a thread whose log a SERVER snapshot has carried
// (confirmedThreads); otherwise it's applied to the server's own copy in a
// transaction, keeping messages this tab never saw.
const threadMeta = new Map(); // id → { brandId, ownerId } for every thread seen this session
let confirmedThreads = new Set();
function rememberThread(th) {
  if (th?.id && th.brandId) threadMeta.set(th.id, { brandId: th.brandId, ownerId: th.ownerId || ownerUid });
}
function threadMetaOf(id) {
  const th = getBrainstorm(id);
  if (th?.brandId) return { brandId: th.brandId, ownerId: th.ownerId || ownerUid };
  if (threadMeta.has(id)) return threadMeta.get(id);
  // The rolling threads carry their brand in the id.
  const m = /^(?:companion|consult)-(.+)$/.exec(String(id));
  return m ? { brandId: m[1], ownerId: ownerUid } : null;
}
function applyThreadSnapshot(brandId, snap) {
  db.brainstorms = snap.docs.map((d) => normalizeThread(d.data()));
  db.brainstorms.forEach(rememberThread);
  if (!snap.metadata?.fromCache) confirmedThreads = new Set(db.brainstorms.map((th) => th.id));
}
// Switching brands: the previous brand's threads leave memory (their ids
// stay known in threadMeta, so a late reply still finds its thread).
function detachThreads(brandId) {
  db.brainstorms = (db.brainstorms || []).filter((th) => th.brandId === brandId);
  confirmedThreads = new Set();
}
export function listBrainstorms(brandId) {
  return (db.brainstorms || []).filter((b) => b.brandId === brandId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export function getBrainstorm(id) {
  return (db.brainstorms || []).find((b) => b.id === id) || null;
}
// A thread as the views expect it, whatever the stored doc lacks (a thread
// created by the merge below has no messages field until its first one).
function normalizeThread(th) {
  return { ...th, messages: th.messages || [], ideas: th.ideas || [], proposal: th.proposal ?? null };
}
export function createBrainstorm(brandId, { id = null, mode = "chat", title = "", campaignId = null, stageId = null, contentId = null, goalId = null, seriesId = null } = {}) {
  const now = Date.now();
  const fixedId = !!id;
  id = id || uid();
  const thread = { id, ownerId: ownerUid, brandId, campaignId, stageId, contentId, goalId, seriesId, title, mode, messages: [], ideas: [], proposal: null, createdAt: now, updatedAt: now };
  db.brainstorms = [...(db.brainstorms || []).filter((b) => b.id !== id), thread];
  rememberThread(thread);
  if (fixedId) {
    // A fixed id (the rolling companion/consult threads, one script thread
    // per content) can already exist on the server while this device hasn't
    // seen it yet — e.g. a cached snapshot from before another device made
    // it. Merge the thread's details in without messages/ideas, so an
    // existing log is never replaced by an empty one.
    const { messages, ideas, proposal, ...meta } = thread;
    persist(() => setDoc(doc(fdb, "brainstorms", id), meta, { merge: true }));
  } else {
    // A brand-new id: nobody else has this thread, its log is ours.
    confirmedThreads.add(id);
    persist(() => setDoc(doc(fdb, "brainstorms", id), thread));
  }
  return thread;
}
// `messages` rewritten on the server's own copy, for a thread this tab
// can't vouch for: `edit(serverMessages)` returns the new list.
function rewriteMessagesOnServer(id, meta, edit) {
  return runTransaction(fdb, async (tx) => {
    const ref = doc(fdb, "brainstorms", id);
    const snap = await tx.get(ref);
    const base = snap.exists() ? snap.data()?.messages || [] : [];
    tx.set(ref, { id, ownerId: meta.ownerId, brandId: meta.brandId, messages: edit(base).slice(-THREAD_MESSAGE_CAP), updatedAt: Date.now() }, { merge: true });
  });
}
// The change from `before` to `after` as an edit of any list: messages
// removed by id dropped, edited ones replaced, new ones appended — messages
// only the server has are kept.
function messagesEdit(before, after) {
  const afterById = new Map(after.map((m) => [m.id, m]));
  const beforeIds = new Set(before.map((m) => m.id));
  const removed = new Set(before.filter((m) => !afterById.has(m.id)).map((m) => m.id));
  const added = after.filter((m) => !beforeIds.has(m.id));
  return (base) => {
    const seen = new Set();
    const out = base.filter((m) => !removed.has(m?.id)).map((m) => {
      seen.add(m?.id);
      return afterById.get(m?.id) || m;
    });
    added.forEach((m) => { if (!seen.has(m.id)) out.push(m); });
    return out;
  };
}
// Writes a thread's new `messages` (plus `fields`): straight out for a
// confirmed thread, through the server's copy otherwise.
function writeThreadMessages(cur, next, fields = []) {
  const others = fields.filter((k) => k !== "messages");
  persist(async () => {
    if (confirmedThreads.has(cur.id)) return updateFields("brainstorms", cur.id, next, ["messages", ...others]);
    if (others.length) await updateFields("brainstorms", cur.id, next, others);
    return rewriteMessagesOnServer(cur.id, threadMetaOf(cur.id) || { brandId: cur.brandId, ownerId: cur.ownerId || ownerUid }, messagesEdit(cur.messages || [], next.messages || []));
  });
}
function saveBrainstorm(cur, next, fields) {
  db.brainstorms = (db.brainstorms || []).map((b) => (b.id === next.id ? next : b));
  if (fields.includes("messages")) writeThreadMessages(cur, next, fields);
  else persist(() => updateFields("brainstorms", next.id, next, fields));
  return next;
}
export function updateBrainstorm(id, patch) {
  const cur = getBrainstorm(id);
  if (!cur) {
    // Not in memory (another brand's thread): its other fields can still
    // be set by name; a messages patch can't be applied without the log.
    const meta = threadMetaOf(id);
    const { messages, ...rest } = patch || {};
    if (meta && Object.keys(rest).length) persist(() => setDoc(doc(fdb, "brainstorms", id), { ...rest, id, ownerId: meta.ownerId, brandId: meta.brandId, updatedAt: Date.now() }, { merge: true }));
    return null;
  }
  return saveBrainstorm(cur, { ...cur, ...patch, updatedAt: Date.now() }, [...Object.keys(patch), "updatedAt"]);
}
// `sessionId` ties a message to one "Obrolan" of the chat's Otomatis view
// (brand.chatSessions) — the same conversation can write to several logs.
export function appendBrainstormMessage(id, { role, text, at = Date.now(), blocks = null, sessionId = null }) {
  const cur = getBrainstorm(id);
  const meta = threadMetaOf(id);
  if (!cur && !meta) return null;
  const msg = { id: uid(), role, text, at, ...(blocks ? { blocks } : {}), ...(sessionId ? { sessionId } : {}) };
  if (cur) {
    const all = [...(cur.messages || []), msg];
    if (all.length > THREAD_MESSAGE_CAP && confirmedThreads.has(id)) {
      saveBrainstorm(cur, { ...cur, messages: all.slice(-THREAD_MESSAGE_CAP), updatedAt: at }, ["messages", "updatedAt"]);
      return msg;
    }
    db.brainstorms = (db.brainstorms || []).map((b) => (b.id === id ? { ...cur, messages: all, updatedAt: at } : b));
  }
  // Appended on the server (arrayUnion), not the whole log rewritten — two
  // devices, a tab that painted from an older cache, or a reply landing
  // after a brand switch all keep their messages. Merge + ownerId/brandId:
  // also lands if the thread doc isn't there yet. (Over the cap on a thread
  // not yet confirmed: trimmed by a later append.)
  const owner = cur?.ownerId || meta.ownerId || ownerUid;
  const brandId = cur?.brandId || meta.brandId;
  persist(() => setDoc(doc(fdb, "brainstorms", id), { id, ownerId: owner, brandId, messages: arrayUnion(msg), updatedAt: at }, { merge: true }));
  return msg;
}
// Patches one message in place (e.g. marking a recap card as decided).
export function updateBrainstormMessage(id, msgId, patch) {
  const cur = getBrainstorm(id);
  if (!cur) {
    const meta = threadMetaOf(id);
    if (meta) persist(() => rewriteMessagesOnServer(id, meta, (base) => base.map((m) => (m?.id === msgId ? { ...m, ...patch } : m))));
    return null;
  }
  return saveBrainstorm(cur, { ...cur, messages: (cur.messages || []).map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updatedAt: Date.now() }, ["messages", "updatedAt"]);
}
export function removeBrainstormMessage(id, msgId) {
  const cur = getBrainstorm(id);
  if (!cur) {
    const meta = threadMetaOf(id);
    if (meta && msgId) persist(() => rewriteMessagesOnServer(id, meta, (base) => base.filter((m) => m?.id !== msgId)));
    return null;
  }
  return saveBrainstorm(cur, { ...cur, messages: (cur.messages || []).filter((m) => m.id !== msgId), updatedAt: Date.now() }, ["messages", "updatedAt"]);
}
export function deleteBrainstorm(id) {
  db.brainstorms = (db.brainstorms || []).filter((b) => b.id !== id);
  persist(() => deleteDoc(doc(fdb, "brainstorms", id)));
}
// The chat's two rolling threads per brand (js/consultant-panel.js), one per
// tab that keeps a single continuous log: "companion" (the Teman tab, whose
// recaps become brand memory) and "consult" (the Konsultan tab, saved only
// so the same conversation is there on the phone and tomorrow — nothing
// else in the app reads it). Fixed ids, so no lookup table is needed and
// two devices never make two of them. ROLLING_THREAD_MODES keeps them out
// of the Brainstorm conversation list.
export const ROLLING_THREAD_MODES = ["companion", "consult"];
export function companionThreadId(brandId) {
  return `companion-${brandId}`;
}
export function getCompanionThread(brandId) {
  return getBrainstorm(companionThreadId(brandId));
}
export function ensureCompanionThread(brandId) {
  return getCompanionThread(brandId) || createBrainstorm(brandId, { id: companionThreadId(brandId), mode: "companion", title: "" });
}
export function consultThreadId(brandId) {
  return `consult-${brandId}`;
}
export function getConsultThread(brandId) {
  return getBrainstorm(consultThreadId(brandId));
}
export function ensureConsultThread(brandId) {
  return getConsultThread(brandId) || createBrainstorm(brandId, { id: consultThreadId(brandId), mode: "consult", title: "" });
}
export function archiveBrand(id, archived = true) {
  return updateBrand(id, { archived });
}
// Soft delete: the brand and everything it owns (campaigns, content,
// series) move to Trash together — restoreBrand brings all of it back.
// Brainstorm threads are the one exception, hard-deleted same as before:
// a chat thread isn't one of the trashed entities this cleanup covers, and
// nothing shows a "restore this conversation" affordance for it.
export function deleteBrand(id) {
  const b = getBrand(id);
  if (!b) return;
  const now = Date.now();
  const contentItems = db.content.filter((c) => c.brandId === id && notDeleted(c));
  const campaignItems = (db.campaigns || []).filter((c) => c.brandId === id && notDeleted(c));
  const seriesItems = (db.series || []).filter((s) => s.brandId === id && notDeleted(s));
  const removedThreadIds = (db.brainstorms || []).filter((t) => t.brandId === id).map((t) => t.id);
  const wasActive = brandIsActive(b);
  b.deletedAt = now;
  contentItems.forEach((c) => { c.deletedAt = now; });
  campaignItems.forEach((c) => { c.deletedAt = now; });
  seriesItems.forEach((s) => { s.deletedAt = now; });
  db.brainstorms = (db.brainstorms || []).filter((t) => t.brandId !== id);
  const behind = pendingCreates.get(id)?.issued;
  const release = !brandCountKnown() || behind ? holdBrandFields(id, { deletedAt: now }) : null;
  persist(async () => {
    try {
      if (behind) await behind;
      await whenBrandCountSettled();
    } finally {
      release?.();
    }
    try {
      await commitBrandMove(id, wasActive, false, (counter) => [
        { group: [updateOp("brands", b, ["deletedAt"]), counter] },
        ...contentItems.map((c) => updateOp("content", c, ["deletedAt"])),
        ...campaignItems.map((c) => updateOp("campaigns", c, ["deletedAt"])),
        ...seriesItems.map((s) => updateOp("series", s, ["deletedAt"])),
      ]);
    } catch (e) {
      brandMoveFailed(e, () => [b, ...contentItems, ...campaignItems, ...seriesItems].forEach((x) => { x.deletedAt = null; }));
      return;
    }
    // Threads load per brand (watchBrandScope), so a brand deleted from the
    // brand list usually has none in memory: ask the server for its ids.
    const threadIds = new Set(removedThreadIds);
    try {
      const snap = await getDocs(query(collection(fdb, "brainstorms"), where("ownerId", "==", ownerUid), where("brandId", "==", id)));
      snap.docs.forEach((d) => threadIds.add(d.id));
    } catch (e) {
      console.warn("Could not list this brand's chat threads", e);
    }
    await Promise.all([...threadIds].map((tid) => deleteDoc(doc(fdb, "brainstorms", tid))));
  });
}
export function restoreBrand(id) {
  const b = getBrand(id);
  if (!b || !b.deletedAt) return;
  const was = b.deletedAt;
  b.deletedAt = null;
  writeBrand(b, ["deletedAt"], { wasActive: false, revert: () => { b.deletedAt = was; } });
}
// "Hapus permanen" in Trash — a real, unrecoverable delete. Cascades to
// whatever the soft delete above already trashed alongside this brand, so
// nothing is left orphaned in Trash with no brand to show it under.
export function purgeBrand(id) {
  const wasActive = brandIsActive(db.brands.find((b) => b.id === id));
  const contentIds = db.content.filter((c) => c.brandId === id).map((c) => c.id);
  const campaignIds = (db.campaigns || []).filter((c) => c.brandId === id).map((c) => c.id);
  const seriesIds = (db.series || []).filter((s) => s.brandId === id).map((s) => s.id);
  db.brands = db.brands.filter((b) => b.id !== id);
  db.content = db.content.filter((c) => c.brandId !== id);
  db.campaigns = (db.campaigns || []).filter((c) => c.brandId !== id);
  db.series = (db.series || []).filter((s) => s.brandId !== id);
  assetData.delete(id);
  const behind = pendingCreates.get(id)?.issued;
  persist(async () => {
    if (behind) await behind;
    if (wasActive) await whenBrandCountSettled();
    // Its uploaded files and sales log go first — listed from the server,
    // since they're only loaded for the brand on screen. If they can't be
    // listed nothing is deleted, and the brand stays in Trash to try again.
    const subRefs = await brandSubDocRefs(id);
    try {
      await commitBrandMove(id, wasActive, false, (counter) => [
        ...subRefs.map((ref) => ({ type: "delete", ref })),
        { group: [{ type: "delete", ref: doc(fdb, "brands", id) }, counter] },
        ...contentIds.map((cid) => ({ type: "delete", ref: doc(fdb, "content", cid) })),
        ...campaignIds.map((cid) => ({ type: "delete", ref: doc(fdb, "campaigns", cid) })),
        ...seriesIds.map((sid) => ({ type: "delete", ref: doc(fdb, "series", sid) })),
      ]);
    } catch (e) {
      brandMoveFailed(e, null);
    }
  });
}
// A brand's own subcollections: brands/{id}/assets (js/brand-assets.js) and
// brands/{id}/sales (js/sales-tracker.js).
const BRAND_SUBCOLLECTIONS = ["assets", "sales"];
async function brandSubDocRefs(brandId) {
  const refs = [];
  for (const sub of BRAND_SUBCOLLECTIONS) {
    const snap = await getDocs(query(collection(fdb, "brands", brandId, sub), where("ownerId", "==", ownerUid)));
    snap.docs.forEach((d) => refs.push(doc(fdb, "brands", brandId, sub, d.id)));
  }
  return refs;
}

// ---------- Content ----------
function emptyContent(brandId) {
  return {
    id: uid(),
    brandId,
    campaignId: "",
    campaignPhaseId: "",
    // Links this piece to a recurring Content Series (see "Content Series"
    // above) — when set, Creator injects that series' saved DNA/context
    // into the AI prompt alongside (not instead of) the brand context.
    seriesId: "",
    title: "",
    idea: "",
    format: "",
    platform: "",
    // Set when this content was created via Creator's "Mirror" pick — the
    // matching id shared with its twin on the other platform, so the two
    // stay traceable as "the same idea, posted to both" without merging
    // the data model into a multi-platform content record.
    mirrorGroupId: "",
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
    // Manually confirmed at the Ready to Upload stage — checking both moves
    // status to published.
    uploadedPlatforms: { tiktok: false, instagram: false },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  };
}

// Read-time fallback for content saved before `performance` was always
// guaranteed (or written through a path that omitted it) — several views
// read `c.performance.views` directly instead of through
// computeContentMetrics()'s safe `content.performance || {}`, so a missing
// object here crashed Dashboard/Reports outright. Same pattern as
// campaign.phases above.
export function listContent(brandId, { includeArchived = false, includeDeleted = false } = {}) {
  return db.content
    .filter((c) => c.brandId === brandId && (includeArchived || !c.archived) && (includeDeleted || notDeleted(c)))
    .map((c) => { if (!c.performance) c.performance = {}; return c; })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getContent(id) {
  const c = db.content.find((c) => c.id === id) || null;
  if (c && !c.performance) c.performance = {};
  return c;
}
// The `platform` a piece made FOR this campaign should carry. A Social
// Media Growth campaign only counts content on its own platform
// (campaign-metrics.js poolFor), so a chat draft or a weekly-plan idea made
// for "Social Media Growth (TikTok)" has to say TikTok — spelled the way
// Pengaturan → Platform spells it. "" for a "Lainnya" campaign (untagged
// content counts there), null for a campaign with no platform of its own
// (the caller keeps whatever default it uses).
const PLATFORM_CANON = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube" };
export function campaignContentPlatform(campaign, settings = db.settings) {
  const gp = campaign?.goalPlan;
  if (gp?.track !== "social") return null;
  const id = String(gp.platform || "instagram").toLowerCase();
  if (id === "other") return "";
  const hit = (settings?.platforms || []).find((p) => String(p.id || "").toLowerCase() === id || String(p.name || "").toLowerCase() === id);
  return hit?.name || PLATFORM_CANON[id] || id;
}
export function createContent(brandId, data = {}) {
  const item = { ...emptyContent(brandId), ...data, id: uid(), brandId, ownerId: ownerUid };
  // Made for a Social Media Growth campaign without a platform of its own
  // (chat drafts, plan ideas): it takes the campaign's, so it counts there.
  if (!item.platform && item.campaignId) item.platform = campaignContentPlatform(getCampaign(item.campaignId)) || "";
  db.content.push(item);
  persist(() => setDoc(doc(fdb, "content", item.id), item));
  return item;
}
export function updateContent(id, patch) {
  const item = getContent(id);
  if (!item) return null;
  const fields = [...Object.keys(patch), "updatedAt"];
  if (patch.performance) {
    item.performance = { ...item.performance, ...patch.performance };
    delete patch.performance;
  }
  Object.assign(item, patch, { updatedAt: Date.now() });
  persist(() => updateFields("content", item.id, item, fields));
  return item;
}
export function archiveContent(id, archived = true) {
  return updateContent(id, { archived });
}
// Soft delete — content moves to Trash instead of vanishing outright.
export function deleteContent(id) {
  const item = getContent(id);
  if (!item) return;
  item.deletedAt = Date.now();
  // trashedWithCampaign rides along: deleteCampaign/restoreCampaign set it
  // on the item right before calling these.
  persist(() => updateFields("content", item.id, item, ["deletedAt", ..."trashedWithCampaign" in item ? ["trashedWithCampaign"] : []]));
}
export function restoreContent(id) {
  const item = getContent(id);
  if (!item || !item.deletedAt) return;
  item.deletedAt = null;
  persist(() => updateFields("content", item.id, item, ["deletedAt", ..."trashedWithCampaign" in item ? ["trashedWithCampaign"] : []]));
}
// "Hapus permanen" — the real, unrecoverable delete Trash offers.
export function purgeContent(id) {
  db.content = db.content.filter((c) => c.id !== id);
  persist(() => deleteDoc(doc(fdb, "content", id)));
}
// One batch, not N single deletes — content-list.js's "Delete all content".
export function purgeContentBatch(ids) {
  const set = new Set(ids);
  db.content = db.content.filter((c) => !set.has(c.id));
  persist(() => commitInChunks(ids.map((id) => ({ type: "delete", ref: doc(fdb, "content", id) }))));
}
// Soft-delete a whole batch in one call — content-list.js's "Delete all
// content" now trashes rather than purges outright (see its confirm copy).
export function trashContentBatch(ids) {
  const now = Date.now();
  const items = db.content.filter((c) => ids.includes(c.id));
  items.forEach((c) => { c.deletedAt = now; });
  persist(() => commitInChunks(items.map((c) => updateOp("content", c, ["deletedAt"]))));
}

// Cross-brand scan for the notification bell — the shared source of truth
// for "what's due/overdue" so this comparison doesn't get re-derived a
// third time (dueBadge() in creator.js and overdueRemindersHTML() in
// brands.js each already had their own copy of it). Local calendar date,
// not toISOString() — that shifts across the day boundary in any timezone
// ahead of UTC (e.g. WIB), quietly misclassifying items right at midnight.
export function localISODate(d = new Date()) {
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

// ---------- Campaigns ----------
// Sits above Content in the user's own model: a campaign is the goal a
// batch of content works toward. Deliberately doesn't cascade-delete its
// content when removed — an ended campaign shouldn't take its posts with it,
// so deleteCampaign() below only clears the back-reference.
// Every campaign runs through the same 7-step funnel — a simple map of
// what needs to happen, not a fully custom workflow builder. `optional`
// phases (Website/Event/Community) depend on infrastructure not every
// brand has yet, so a campaign can turn them off (`phase.enabled=false`)
// without losing the phase itself — it stays visible, muted, re-enable-able
// any time instead of being deleted from the array. The non-optional phases
// (Awareness/WhatsApp/UGC/Retargeting) are always enabled. Names/count/order
// of the template itself aren't user-editable, so content can reliably
// bucket by campaignPhaseId without ever pointing at a phase that no longer
// exists. `description` here is looked up by consumers (not duplicated into
// every campaign document) so wording updates apply to old campaigns too.
export const CAMPAIGN_PHASE_TEMPLATE = [
  { name: "Awareness", description: t("store.phaseDesc.awareness"), optional: false },
  { name: "Website", description: t("store.phaseDesc.website"), optional: true },
  { name: "WhatsApp", description: t("store.phaseDesc.whatsapp"), optional: false },
  { name: "Event", description: t("store.phaseDesc.event"), optional: true },
  { name: "UGC", description: t("store.phaseDesc.ugc"), optional: false },
  { name: "Community", description: t("store.phaseDesc.community"), optional: true },
  { name: "Retargeting", description: t("store.phaseDesc.retargeting"), optional: false },
];

// Deterministic ids (slugified name), not uid() — the template is fixed,
// so a stable id lets AI-drafted phase goals and manually edited phase
// rows both just match by name without ever needing to invent or look up
// a random id first. `milestones` are the user's own checkable sub-goals
// for that phase — separate from the AI/manual `goal` description text.
function defaultCampaignPhases() {
  return CAMPAIGN_PHASE_TEMPLATE.map((t) => ({ id: t.name.toLowerCase(), name: t.name, goal: "", enabled: !t.optional, milestones: [] }));
}

function emptyCampaign(brandId) {
  return {
    id: uid(),
    brandId,
    name: "",
    objective: "awareness",
    targetAudience: "",
    problemOrOpportunity: "",
    insight: "",
    bigIdea: "",
    keyMessage: "",
    offer: "",
    cta: "",
    channels: [],
    phases: defaultCampaignPhases(),
    status: "planning",
    startDate: "",
    endDate: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Read-time fallback for campaigns created before the phases/journey
// feature existed (or saved through a path that skipped it) — no
// migration script, they just get the default template phases merged in
// the moment they're read, same pattern as brand.brandDNA above.
// Whether a campaign's content is sorted into phases the owner picks. Only
// the old phase-based campaigns: Grow Brand levels (missions) and Event
// windows (eventPlan) advance on their own and ignore campaignPhaseId.
export function campaignHasOwnPhases(campaign) {
  return !!campaign && !campaign.autoLinkAllContent && !!campaign.phases?.length && !campaign.missions?.length && !campaign.eventPlan;
}
export function listCampaigns(brandId, { includeDeleted = false } = {}) {
  return (db.campaigns || [])
    .filter((c) => c.brandId === brandId && (includeDeleted || notDeleted(c)))
    .map((c) => { if (!c.phases) c.phases = defaultCampaignPhases(); return c; })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getCampaign(id) {
  const c = (db.campaigns || []).find((c) => c.id === id) || null;
  if (c && !c.phases) c.phases = defaultCampaignPhases();
  return c;
}
// Shared with js/views/campaigns.js's own campaign card (which used to
// compute this inline) and the Brand Home health strip — one definition
// of "how far along is this campaign" instead of two copies drifting.
export function campaignPhaseCoverage(campaign, content) {
  const linked = content.filter((c) => c.campaignId === campaign.id);
  const enabledPhases = campaign.phases.filter((p) => p.enabled);
  const filled = enabledPhases.filter((p) => linked.some((c) => c.campaignPhaseId === p.id)).length;
  return { filled, total: enabledPhases.length };
}
// Per-phase detail (not just the filled/total ratio) — which enabled
// phases already have linked content and how much, vs. which are still
// empty. The signal that turns "which campaign fits" into "which campaign
// AND phase actually needs this content" for suggestCampaignFit.
export function campaignPhaseContentCounts(campaign, content) {
  const linked = content.filter((c) => c.campaignId === campaign.id);
  return campaign.phases
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.id, name: p.name, count: linked.filter((c) => c.campaignPhaseId === p.id).length }));
}
// --- Missions: a leveling system layered on top of the phases above ---
// A mission never duplicates or re-creates a phase — its milestones just
// reference an existing phase by id (for "auto" kind) and carry their own
// target for that stage. Content linking (content.campaignPhaseId) never
// needs to know which mission is currently active; targets are cumulative
// by design, read against the same running content count as the campaign
// grows. Only the 3 Quick Templates get a mission ladder — Custom/legacy
// campaigns simply have no `campaign.missions`, and every consumer treats
// that as "flat journey, no mission chrome" rather than an error.
//
// Three milestone kinds:
//  - "auto"   verified live from content already linked to `phaseId` — the
//             user never touches it.
//  - "check"  a real-world event the app can't observe — plain checkbox.
//  - "number" a metric the app can't observe (followers, reach, engagement
//             — no platform API integration exists) — the user types the
//             real figure in.
//
// One shared description per label instead of repeating it at every level a
// metric appears in (the same "Followers"/"Shares"/etc. milestone recurs
// across all 5 levels of a ladder, and again across ladders) — shown as the
// tree node's hover tooltip and as a caption under its row in the list.
// Labels and descriptions live in js/i18n/campaigns.js ("store.ms.*" /
// "store.msd.*"); the dictionary's `id` text is the canonical label the
// templates below write into Firestore.
const MS_LABEL_KEYS = new Map();
Object.keys(CAMPAIGN_DICT).forEach((k) => {
  if (!k.startsWith("store.ms.")) return;
  const suffix = k.slice("store.ms.".length);
  MS_LABEL_KEYS.set(CAMPAIGN_DICT[k].id, suffix);
  if (!MS_LABEL_KEYS.has(CAMPAIGN_DICT[k].en)) MS_LABEL_KEYS.set(CAMPAIGN_DICT[k].en, suffix);
});

// ---------- Display-time localisation of stored template text ----------
// Templates are copied into Firestore when a campaign is created, so stored
// campaigns carry the template's canonical text (milestone labels/units in
// Indonesian, level and phase names in English). These map that text back to
// its i18n key when painting, so old and new campaigns both render in the
// current language. Anything not from a template (user-typed) passes through.
// Template labels keep a literal "X" where the number goes ("Minimal X
// konten promosi terbit") — the target itself is stored next to it. Pass the
// target and the X becomes the number; without one (a removed-milestone chip)
// the X is dropped so nobody reads a raw placeholder.
export function milestoneLabel(label, target) {
  const k = MS_LABEL_KEYS.get(label);
  const text = k ? t(`store.ms.${k}`) : label;
  if (!k || !/\bX\b/.test(text)) return text;
  const n = Number(target);
  if (target !== null && target !== undefined && target !== "" && Number.isFinite(n)) {
    return text.replace(/\bX\b/g, n.toLocaleString(getLang() === "en" ? "en-US" : "id-ID"));
  }
  return text.replace(/\bX%?\s+/g, "").replace(/\s{2,}/g, " ").trim();
}
export function milestoneDescription(label, fallback = "") {
  const k = MS_LABEL_KEYS.get(label);
  return k && CAMPAIGN_DICT[`store.msd.${k}`] ? t(`store.msd.${k}`) : fallback;
}
const UNIT_KEYS = new Map(Object.entries({
  followers: "followers", konten: "konten", minggu: "minggu", share: "share", shares: "share", save: "save", saves: "save",
  DM: "dm", video: "video", orang: "orang", post: "post", member: "member", "member aktif": "memberAktif", UGC: "ugc",
  event: "event", peserta: "peserta", kolaborasi: "kolaborasi", advocate: "advocate", activation: "activation", leads: "leads",
  komentar: "komentar", comments: "komentar", kemunculan: "kemunculan", peluang: "peluang", mention: "mention", views: "views",
  kunjungan: "kunjungan", pendaftar: "pendaftar", reminder: "reminder", interaksi: "interaksi", response: "response",
  testimoni: "testimoni", stories: "stories", inquiry: "inquiry", demo: "demo", sample: "sample", transaksi: "transaksi",
  feedback: "feedback", impresi: "impresi", likes: "likes", reach: "reach",
  // Sales Growth counting units (js/goal-plan.js SALES_MODELS)
  unit: "unit", proyek: "proyek", subscriber: "subscriber", siswa: "siswa", pesanan: "pesanan",
}));
export function unitLabel(unit) {
  const k = UNIT_KEYS.get(unit);
  return k ? t(`store.unit.${k}`) : unit || "";
}
const PHASE_NAME_KEYS = new Map(Object.entries({
  Awareness: "awareness", Website: "website", WhatsApp: "whatsapp", Event: "event", UGC: "ugc", Community: "community",
  Retargeting: "retargeting", Foundation: "foundation", Consideration: "consideration", Conversion: "conversion",
  "Event Day": "eventDay", "Post-Event": "postEvent", Prepare: "prepare", Attract: "attract", "Pre-Event": "preEvent",
}));
export function phaseNameLabel(name) {
  const k = PHASE_NAME_KEYS.get(name);
  return k ? t(`store.phaseName.${k}`) : name;
}
const MISSION_KEYS = new Map(Object.entries({
  "Get Discovered": "gs1", "Build Trust": "gs2", "Build Community": "gs3", "Activate Community": "gs4", "Build Advocacy": "gs5",
  // Grow Brand — legacy single-campaign ladder (pre-Sep 2026), kept only so
  // already-created campaigns still render: Komunitas/Penjualan are no
  // longer produced by js/goal-plan.js (Social Media Growth and Community
  // Growth are separate campaigns now, and so is Sales Growth — sal1..3 below).
  // Dikenal/Dipercaya are reused as-is by the new Social Media Growth track.
  Dikenal: "gb1", Dipercaya: "gb2", Komunitas: "gb3", Penjualan: "gb4",
  // Community Growth levels (js/goal-plan.js COMMUNITY_LEVELS)
  Rancang: "com0", Bergabung: "com1", "Partisipasi Aktif": "com2", "Rasa Memiliki": "com3", Mandiri: "com4", Advokasi: "com5", Ekosistem: "com6",
  // Social Media Growth checkpoint ladder (js/goal-plan.js SOCIAL_LEVELS)
  "Mulai Ditemukan": "sm1", "Mulai Dikenal": "sm2", "Mulai Dipercaya": "sm3", "Punya Pengaruh": "sm4", "Jadi Rujukan": "sm5", "Top of Mind": "sm6",
  // Sales Growth levels (js/goal-plan.js SALES_LEVELS)
  "Penjualan Pertama": "sal1", "Penjualan Rutin": "sal2", "Pelanggan Setia": "sal3",
  "Find Your Voice": "gp1", "Build Credibility": "gp2", "Become an Authority": "gp3", "Lead the Conversation": "gp4", "Become a Recognized Voice": "gp5",
}));
// { name, description, tagline } of a stored (or template) mission.
export function missionText(mission) {
  const k = MISSION_KEYS.get(mission?.name);
  if (!k) return { name: mission?.name || "", description: mission?.description || "", tagline: mission?.tagline || "" };
  return { name: t(`store.mission.${k}.name`), description: t(`store.mission.${k}.desc`), tagline: t(`store.mission.${k}.tagline`) };
}
export function missionProgressionNote(campaign) {
  if (!campaign?.missionProgressionNote) return "";
  const k = MISSION_KEYS.get(campaign.missions?.[0]?.name) || "";
  if (k.startsWith("gs")) return t("store.ladder.growSocial.progression");
  if (k.startsWith("gp")) return t("store.ladder.growPersonal.progression");
  // "gb" (Dikenal/Dipercaya) is shared between the legacy single-campaign
  // Grow Brand ladder (goalPlan.version 2, all three tracks per level — the
  // note explains that) and the new track-pure Social Media Growth
  // campaign (version 3, this track only) — only the legacy one gets the
  // dynamic re-localized note; v3 campaigns fall through to their own
  // literal note set at creation (js/goal-plan.js).
  if (k.startsWith("gb") && campaign.goalPlan?.version !== 3) return t("goal.rules");
  return campaign.missionProgressionNote;
}

// The one posting-streak definition (audit-1005): Beranda's header and the
// content.streakWeeks milestones both read this, so they never disagree.
// Day numbers come from the plain YYYY-MM-DD strings — the owner's own
// calendar day (localISODate), never the UTC day, so a post published
// before 07:00 WIB still counts for today.
const DAY_MS = 86400000;
const isoDayNumber = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS);
// { grace: true } lets the current 7-day window still be empty (the week
// isn't over yet) and counts from the window before it — for the Beranda
// header, so a weekly poster's 🔥 doesn't vanish on the morning of upload
// day. Milestones and streakBreakInDays keep the strict count.
export function consecutiveActiveWeeks(content, offsetDays = 0, now = new Date(), { grace = false } = {}) {
  const days = content
    .filter((c) => c.status === "published" && c.publishedDate)
    .map((c) => isoDayNumber(c.publishedDate))
    .filter((d) => Number.isFinite(d));
  if (!days.length) return 0;
  // offsetDays > 0 asks "what would the streak be N days from now if
  // nothing new gets published" — see streakBreakInDays.
  const today = isoDayNumber(localISODate(now)) + offsetDays;
  let weeks = 0;
  const hasPublish = (w) => days.some((d) => d >= today - w * 7 - 6 && d <= today - w * 7);
  // Week 0 = the last 7 days including today, week 1 = the 7 before, ...
  // Keep counting while each successive window has at least one publish.
  const first = grace && !hasPublish(0) ? 1 : 0;
  for (let w = first; w < 260; w++) {
    if (!hasPublish(w)) break;
    weeks++;
  }
  return weeks;
}
// The content a mission-ladder campaign counts: everything the brand makes
// for autoLinkAllContent ladders, only linked content otherwise. Same rule
// milestoneStatus applies inline.
export function campaignContentPool(campaign, content) {
  return campaign.autoLinkAllContent ? content : content.filter((c) => c.campaignId === campaign.id);
}
// How many weeks (since `sinceMs`) actually hit every one of the brand's
// real cadence.uploadDays — not just "N pieces this week" but "published on
// the days you said you'd publish on". Returns { compliantWeeks, totalWeeks }
// so the reading can show "3 dari 5 minggu". No cadence configured yet →
// zero of zero, so the milestone can fall back gracefully.
const DOW_ID = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function cadenceComplianceWeeks(content, cadence, sinceMs) {
  const days = cadence?.uploadDays || [];
  if (!cadence?.configured || !days.length) return { compliantWeeks: 0, totalWeeks: 0 };
  const DAY = 86400000;
  const published = content
    .filter((c) => c.status === "published" && c.publishedDate)
    .map((c) => {
      const d = new Date(c.publishedDate + "T12:00:00");
      return { time: d.getTime(), dow: DOW_ID[d.getDay()] };
    });
  const start = Math.floor((sinceMs || Date.now()) / DAY) * DAY;
  const now = Date.now();
  let compliantWeeks = 0;
  let totalWeeks = 0;
  for (let weekStart = start; weekStart < now; weekStart += 7 * DAY) {
    const weekEnd = weekStart + 7 * DAY;
    totalWeeks++;
    if (days.every((dow) => published.some((p) => p.dow === dow && p.time >= weekStart && p.time < weekEnd))) compliantWeeks++;
  }
  return { compliantWeeks, totalWeeks };
}
// First day (1..maxDays) on which the current active-weeks streak drops if
// nothing else gets published, or null when it's safe for that long (or
// there's no streak to lose). Returns { days, weeks }.
export function streakBreakInDays(content, maxDays = 2) {
  const weeks = consecutiveActiveWeeks(content);
  if (!weeks) return null;
  for (let d = 1; d <= maxDays; d++) {
    if (consecutiveActiveWeeks(content, d) < weeks) return { days: d, weeks };
  }
  return null;
}
// Does this published post still need its performance numbers asked for?
// At most twice per post: once ~2 days after it went up (first numbers),
// once ~7 days after (they've settled) — and never again after ~30 days.
// It used to re-ask every post every 7 days forever, so an active account
// got "Isi performa 40 konten" each week. A check counts only when it
// happened on/after the checkpoint it answers; one filled in on day 3
// still gets the day-7 ask, one filled in on day 8 is done for good.
export const PERF_CHECK_DAYS = [2, 7];
export const PERF_CHECK_MAX_AGE_DAYS = 30;
export function performanceCheckDue(c, now = Date.now()) {
  if (c?.status !== "published") return false;
  const DAY = 86400000;
  const pubMs = c.publishedDate ? new Date(c.publishedDate + "T00:00:00").getTime() : Number(c.createdAt) || 0;
  if (!Number.isFinite(pubMs) || !pubMs) return false;
  const age = (now - pubMs) / DAY;
  if (age < PERF_CHECK_DAYS[0] || age > PERF_CHECK_MAX_AGE_DAYS) return false;
  const mark = [...PERF_CHECK_DAYS].reverse().find((d) => age >= d);
  const at = Number(c.performance?.confirmedAt) || 0;
  return !at || at < pubMs + mark * DAY;
}
// At least one real number (or a retention reading) in a performance
// object — saving an empty "Isi performa" form is not a check, so it must
// not stamp confirmedAt and silence the asks above.
export function performanceHasNumbers(p) {
  if (!p) return false;
  const has = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  return METRIC_KEYS.some(({ key }) => has(p[key])) || !!p.retention;
}
// Sum of one performance metric (e.g. "shares", "saves") across published
// content — per-platform breakdown when the item has one, flat
// `performance` otherwise, same precedence as organicViews above.
export function contentMetricTotal(content, key) {
  return content
    .filter((c) => c.status === "published")
    .reduce((sum, c) => {
      const v = hasPlatformBreakdown(c.performanceByPlatform) ? combinePlatformMetrics(c.performanceByPlatform)[key] : c.performance?.[key];
      if (v === null || v === undefined || v === "") return sum;
      const n = Number(v);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
}
// index 0 is always at least "current". Soft-lock: locked missions still
// render (just inert) — the user can always see what's coming next.
export function missionState(campaign, index) {
  const missions = campaign.missions || [];
  if (index === 0) return missions[0]?.completedAt ? "completed" : "current";
  if (!missions[index - 1]?.completedAt) return "locked";
  return missions[index]?.completedAt ? "completed" : "current";
}

// --- Event Campaigns: role-branching, date-anchored, non-blocking ---
// Everything above (Missions) is a blocking ladder with fixed targets and
// no deadline. An event has a real date that doesn't wait for anyone, so
// this is the opposite on every axis: which role you play changes the
// whole setup and milestone set, phases are calendar windows (not levels
// you clear in order), targets scale from the event's own inputs instead
// of being fixed, and a milestone you miss just gets recorded as MISSED —
// the campaign keeps moving toward the event date regardless.
export const EVENT_SCALE_TIERS = [
  { id: "small", max: 100, mult: 0.4 },
  { id: "medium", max: 500, mult: 1 },
  { id: "large", max: 2000, mult: 2.5 },
  { id: "major", max: Infinity, mult: 6 },
].map((tier) => ({ ...tier, label: t(`store.scale.${tier.id}.label`), range: t(`store.scale.${tier.id}.range`) }));
export function eventScaleFor(expectedAudience) {
  const n = Number(expectedAudience) || 0;
  return EVENT_SCALE_TIERS.find((t) => n <= t.max) || EVENT_SCALE_TIERS[EVENT_SCALE_TIERS.length - 1];
}

export const EVENT_STATUS_LABELS = Object.fromEntries(
  ["not_started", "in_progress", "completed", "partially_completed", "missed", "not_applicable"].map((k) => [k, t(`store.eventStatus.${k}`)])
);

export const EVENT_ROLES = [
  "organizer", "tenant", "participant",
].map((id) => ({ id, label: t(`store.role.${id}.label`), description: t(`store.role.${id}.desc`) }));

export const EVENT_PARTICIPATION_TYPES = [
  { id: "speaker", label: t("store.participation.speaker") },
  { id: "sponsor", label: t("store.participation.sponsor") },
  { id: "performer", label: t("store.participation.performer") },
  { id: "community-partner", label: t("store.participation.communityPartner") },
  { id: "brand-partner", label: t("store.participation.brandPartner") },
  { id: "exhibitor", label: t("store.participation.exhibitor") },
  { id: "supporting-partner", label: t("store.participation.supportingPartner") },
  { id: "workshop-provider", label: t("store.participation.workshopProvider") },
];

export const EVENT_OBJECTIVES = {
  organizer: ["Awareness", "Attendance", "Community building", "Lead generation", "Sales / revenue", "Education", "Product launch", "Networking", "Brand positioning", "Community activation"],
  tenant: ["Sales", "Brand awareness", "Lead generation", "Product sampling", "Community building", "New followers", "Networking", "Product launch", "Customer acquisition"],
};
// The values above are what gets stored on eventPlan.objectives (and fed to
// the AI as context); this is only how a chip reads in the current language.
export const EVENT_OBJECTIVE_LABELS = Object.fromEntries(
  Object.entries({
    Awareness: "awareness", Attendance: "attendance", "Community building": "communityBuilding", "Lead generation": "leadGeneration",
    "Sales / revenue": "salesRevenue", Education: "education", "Product launch": "productLaunch", Networking: "networking",
    "Brand positioning": "brandPositioning", "Community activation": "communityActivation", Sales: "sales", "Brand awareness": "brandAwareness",
    "Product sampling": "productSampling", "New followers": "newFollowers", "Customer acquisition": "customerAcquisition",
  }).map(([value, key]) => [value, t(`store.evObj.${key}`)])
);

// Local-calendar date maths. `toISOString()` is UTC, so in Asia/Jakarta
// (+7) a local midnight formats as the previous day — every date offset
// used to come out one day early, and "today" before 07:00 was yesterday.
function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return localISODate(d);
}

const EVENT_MONTHS = getLang() === "en"
  ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  : ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function formatEventDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  return isNaN(d.getTime()) ? isoDate : `${d.getDate()} ${EVENT_MONTHS[d.getMonth()]}`;
}
export function formatEventRange(from, to) {
  if (!from || !to) return "";
  if (from === to) return formatEventDate(from);
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${EVENT_MONTHS[a.getMonth()]}`;
  return `${formatEventDate(from)} – ${formatEventDate(to)}`;
}
// A stored event phase's date label in the current language, rebuilt from
// its dates (the stored dateLabel is in whatever language created it).
export function eventPhaseDateLabel(phase, eventDate) {
  if (!phase?.dateFrom || !phase?.dateTo) return phase?.dateLabel || "";
  const eventDay = phase.preEvent === false
    ? phase.dateFrom === phase.dateTo && phase.dateTo === eventDate
    : !phase.preEvent && /^(Hari-H|Event day)/i.test(phase.dateLabel || "");
  return eventDay ? t("store.eventDayLabel", { date: formatEventDate(phase.dateTo) }) : formatEventRange(phase.dateFrom, phase.dateTo);
}
// The window a stored event phase really covers. Campaigns built before the
// fix above stored pre-event phases ending ON the event date and Post-Event
// starting on it, so H-day belonged to three phases; read them as if the
// event date were Event Day's alone. Only trims — never widens.
export function eventPhaseWindow(phase, eventDate) {
  let { dateFrom, dateTo } = phase || {};
  if (!eventDate || !dateFrom || !dateTo) return { dateFrom, dateTo };
  const isDay = dateFrom === dateTo && dateTo === eventDate;
  if (!isDay && dateFrom < eventDate && dateTo >= eventDate && phase.preEvent !== false) dateTo = addDays(eventDate, -1);
  else if (!isDay && dateFrom === eventDate && dateTo > eventDate) dateFrom = addDays(eventDate, 1);
  return { dateFrom, dateTo };
}
// Whole days from `fromISO` to `toISO` (negative when `to` is earlier).
export function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO + "T00:00:00").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}
// The pre-event runway a role's template was written for: the first
// phase's end offset plus ~2 weeks for the first phase itself (it starts at
// "campaign start", which the template leaves open-ended).
export function nominalEventRunway(phaseTemplates) {
  const first = phaseTemplates.find((p) => p.offsetFrom === null);
  return first ? Math.abs(first.offsetTo) + 14 : 0;
}
const isPreEventPhase = (p) => p.offsetTo <= 0 && !(p.offsetFrom === 0 && p.offsetTo === 0);

// Turns one role's phase templates into real, saveable phases+milestones —
// called once at campaign creation. `base` is each milestone's target at
// "medium" scale; every numeric target scales from there by the event's
// EVENT_SCALE_TIERS multiplier, exactly the "input variables decide the
// target" rule from the spec — never the same numbers for every event.
//
// Dates: the templates assume ~44 days (organizer) / ~28 (tenant) before
// the event. A campaign created closer than that used to get phases whose
// window had already passed the moment it was made ("Terlewat" on day one).
// Now the pre-event offsets are scaled to the real runway (campaign start →
// event day); a phase that ends up with no days at all folds its milestones
// into the next one (or the previous one for the last pre-event phase), and
// `mergedFrom` records that so the UI can say so. `dateLabel` is the real
// date range, not "T-30 → T-14".
// Template flags that change how a target is derived (audit, Sep 2026):
//  - `fixed`      a rate or an average (%, average order value) — a bigger
//                 event doesn't make "70% attendance" become 175%, so these
//                 never scale.
//  - `attendance` the headline crowd number: the user's own expected
//                 audience when they typed one, not a tier guess.
//  - `regShare`   registrations are derived from that crowd number so the
//                 funnel adds up (attendees ÷ EVENT_SHOW_UP_RATE, split
//                 across the phases) instead of three unrelated constants.
export const EVENT_SHOW_UP_RATE = 0.7;
const EVENT_REFERENCE_AUDIENCE = 300; // what every `base` was written for ("medium")
// Continuous multiplier from a real head-count; slightly sub-linear because
// reach/mentions don't grow as fast as the crowd does. Lands on the old tier
// values at their midpoints (100 → 0.4, 300 → 1, 1000 → 2.8).
export function eventScaleMultiplier(expectedAudience) {
  const n = Number(expectedAudience) || 0;
  if (n <= 0) return null;
  return Math.min(30, Math.max(0.1, Math.pow(n / EVENT_REFERENCE_AUDIENCE, 0.85)));
}

// ---- Event size decides how much there is to track ----
// A 20-person alumni gathering does not need reach, views and mention targets
// the way a 500-seat launch does. `lean` trims the template to what the size
// of the event justifies; the owner can still delete or add any milestone.
//   0  full template (about 100+ attendees, or no size known)
//   1  small  (31–100): no views / profile-visit / mention / save / comment /
//      interaction / UGC / feedback numbers, and no optional rate rows
//   2  tiny   (≤30): only the checklist, registrations, attendance, posts
//      published, testimonials — plus heavy set-up steps (landing page,
//      ticketing system, social profile refresh, promo content plan) dropped
export function eventLeanLevel(expectedAudience, scaleId) {
  const n = Number(expectedAudience) || 0;
  if (n > 0) return n <= 30 ? 2 : n <= 100 ? 1 : 0;
  return scaleId === "small" ? 1 : 0;
}
const LEAN1_DROP_UNITS = new Set(["views", "kunjungan", "mention", "save", "komentar", "interaksi", "UGC", "response", "feedback"]);
const LEAN2_KEEP_UNITS = new Set(["konten", "testimoni", "transaksi", "pendaftar"]);
const LEAN2_DROP_CHECKS = /landing page|ticketing|profil media sosial|rencana konten/i;
function leanKeep(m, level) {
  if (level <= 0) return true;
  if (m.kind === "check") return level >= 2 ? m.required !== false && !LEAN2_DROP_CHECKS.test(m.label) : true;
  if (level >= 2 && m.required === false) return false;
  if (m.attendance || m.regShare || m.category === "ATTENDANCE" || LEAN2_KEEP_UNITS.has(m.unit)) return true;
  if (level >= 2) return false;
  return !LEAN1_DROP_UNITS.has(m.unit) && !(m.required === false && m.fixed);
}
// Tiny events also skip the funnel: the three middle pre-event phases
// (Awareness → Consideration → Conversion) fold into one "Pre-event" stretch,
// with their post count and sign-up target added together.
function foldMiddlePhases(templates) {
  const mid = templates.filter((p) => p.offsetFrom !== null && p.offsetTo <= 0 && p.offsetFrom < 0);
  if (mid.length < 2) return templates;
  const all = mid.flatMap((p) => p.milestones);
  const content = all.filter((m) => m.unit === "konten");
  const regs = all.filter((m) => m.regShare);
  const merged = [
    ...all.filter((m) => m.kind === "check"),
    ...(content.length ? [{ kind: "auto", label: "Terbitkan X konten terkait event", base: content.reduce((a, m) => a + (m.base || 0), 0), unit: "konten", category: "CONTENT" }] : []),
    ...(regs.length ? [{ kind: "number", label: "Dapatkan X pendaftaran", base: regs.reduce((a, m) => a + (m.base || 0), 0), unit: "pendaftar", category: "CONVERSION", regShare: regs.reduce((a, m) => a + m.regShare, 0) }] : []),
    ...all.filter((m) => m.kind !== "check" && !m.regShare && m.unit !== "konten"),
  ];
  const fold = { name: "Pre-Event", dateLabel: "Pre-Event", offsetFrom: mid[0].offsetFrom, offsetTo: mid[mid.length - 1].offsetTo, milestones: merged };
  const out = [];
  templates.forEach((p) => { if (p === mid[0]) out.push(fold); else if (!mid.includes(p)) out.push(p); });
  return out;
}
export function leanEventTemplates(phaseTemplates, level) {
  if (!level) return phaseTemplates;
  const trimmed = phaseTemplates.map((p) => ({ ...p, milestones: p.milestones.filter((m) => leanKeep(m, level)) })).filter((p) => p.milestones.length);
  return level >= 2 ? foldMiddlePhases(trimmed) : trimmed;
}

export function buildEventPhases(phaseTemplatesFull, { eventDate, campaignStartDate, scaleId, expectedAudience = null }) {
  const phaseTemplates = leanEventTemplates(phaseTemplatesFull, eventLeanLevel(expectedAudience, scaleId));
  const tier = EVENT_SCALE_TIERS.find((t) => t.id === scaleId) || EVENT_SCALE_TIERS[1];
  const mult = eventScaleMultiplier(expectedAudience) ?? tier.mult;
  const crowd = Number(expectedAudience) > 0 ? Math.round(Number(expectedAudience)) : null;
  const targetFor = (m) => {
    if (m.kind === "check") return null;
    if (m.fixed) return m.base;
    if (m.attendance) return crowd ?? Math.max(1, Math.round(m.base * mult));
    if (m.regShare) return Math.max(1, Math.round(((crowd ?? EVENT_REFERENCE_AUDIENCE * mult) / EVENT_SHOW_UP_RATE) * m.regShare));
    return Math.max(1, Math.round((m.base || 1) * mult));
  };
  const start = campaignStartDate && campaignStartDate <= eventDate ? campaignStartDate : eventDate;
  const runway = Math.max(0, daysBetween(start, eventDate));
  const nominal = nominalEventRunway(phaseTemplates);
  const factor = nominal && runway < nominal ? runway / nominal : 1;
  const makeMilestone = (m) => ({
    id: uid(),
    label: m.label,
    description: m.description || "",
    category: m.category,
    kind: m.kind,
    unit: m.unit || "",
    target: targetFor(m),
    isSystemTarget: m.kind !== "check",
    required: m.required !== false,
    notApplicable: false,
    measurementMethod: m.measurementMethod || "",
    value: null,
    done: false,
    custom: false,
  });
  const phases = [];
  let cursor = start;
  let carry = [];
  let carryNames = [];
  phaseTemplates.forEach((p, pi) => {
    let dateFrom;
    let dateTo;
    if (isPreEventPhase(p)) {
      dateFrom = cursor;
      // Pre-event phases stop the day BEFORE the event: the event date itself
      // belongs to Event Day alone (a phase window that also contained it made
      // H-day open on "Conversion" and count one post twice).
      dateTo = addDays(eventDate, Math.min(-1, Math.round(p.offsetTo * factor)));
      if (dateTo < dateFrom) {
        // No days left for this phase: fold into the last pre-event phase
        // that did fit, or carry forward when none has yet.
        const prev = [...phases].reverse().find((ph) => ph.preEvent);
        if (prev) {
          prev.milestones.push(...p.milestones.map(makeMilestone));
          prev.mergedFrom = [...(prev.mergedFrom || []), p.name];
        } else {
          carry.push(...p.milestones);
          carryNames.push(p.name);
        }
        return;
      }
      cursor = addDays(dateTo, 1);
    } else {
      // Post-event starts the day AFTER the event (see the note above).
      dateFrom = p.offsetFrom === null ? start : addDays(eventDate, p.offsetFrom === 0 && p.offsetTo > 0 ? 1 : p.offsetFrom);
      dateTo = addDays(eventDate, p.offsetTo);
    }
    const eventDay = p.offsetFrom === 0 && p.offsetTo === 0;
    phases.push({
      id: `phase-${pi}`,
      name: p.name,
      preEvent: isPreEventPhase(p),
      dateLabel: eventDay ? t("store.eventDayLabel", { date: formatEventDate(dateTo) }) : formatEventRange(dateFrom, dateTo),
      dateFrom,
      dateTo,
      ...(carryNames.length ? { mergedFrom: carryNames.slice() } : {}),
      milestones: [...carry, ...p.milestones].map(makeMilestone),
    });
    carry = [];
    carryNames = [];
  });
  return phases;
}

// Every milestone the app can't literally count from Content OS is
// "number" (manual entry) — this app has no content-*type* taxonomy
// (promotional vs. value vs. short-form video), so only the genuinely
// generic "content published" milestones are "auto".
const ORGANIZER_PHASES = [
  {
    name: "Foundation", dateLabel: "Campaign Start → T-30", offsetFrom: null, offsetTo: -30,
    milestones: [
      { kind: "check", label: "Event identity / key visual selesai", category: "CONTENT" },
      { kind: "check", label: "Informasi event lengkap", category: "CONTENT" },
      { kind: "check", label: "Sistem registrasi/ticketing siap", category: "CONVERSION" },
      { kind: "check", label: "Landing page / halaman registrasi siap", category: "CONVERSION" },
      { kind: "check", label: "Rencana konten promosi selesai", category: "CONTENT" },
      { kind: "auto", label: "Minimal X konten promosi terbit", base: 5, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Minimal X konten value/edukasi terbit", base: 3, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Minimal X video short-form terbit", base: 3, unit: "video", category: "CONTENT" },
      { kind: "check", label: "Profil media sosial event ter-update", category: "CONTENT" },
      { kind: "check", label: "Pengumuman awal terbit", category: "AWARENESS" },
    ],
  },
  {
    name: "Awareness", dateLabel: "T-30 → T-14", offsetFrom: -30, offsetTo: -14,
    milestones: [
      { kind: "auto", label: "Terbitkan X konten terkait event", base: 8, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Jangkau X orang (reach)", base: 3000, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X video views", base: 5000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X kunjungan profil/halaman event", base: 500, unit: "kunjungan", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X shares", base: 100, unit: "share", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X saves", base: 100, unit: "save", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X komentar", base: 150, unit: "komentar", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X mention event", base: 30, unit: "mention", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X pendaftaran", base: 50, unit: "pendaftar", category: "CONVERSION", regShare: 0.2 },
    ],
  },
  {
    name: "Consideration", dateLabel: "T-14 → T-7", offsetFrom: -14, offsetTo: -7,
    milestones: [
      { kind: "auto", label: "Terbitkan X konten promosi", base: 6, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Terbitkan X konten benefit/value event", base: 4, unit: "konten", category: "CONTENT" },
      { kind: "check", label: "Terbitkan konten speaker/performer/tenant/experience", category: "CONTENT", required: false },
      { kind: "number", label: "Dapatkan tambahan X reach", base: 2000, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan tambahan X views", base: 3000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X pendaftaran", base: 100, unit: "pendaftar", category: "CONVERSION", regShare: 0.45 },
      { kind: "number", label: "Dapatkan X inquiries/DM", base: 40, unit: "DM", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X kolaborasi/partner", base: 5, unit: "kolaborasi", category: "IMPACT" },
      { kind: "check", label: "Terbitkan social proof/testimoni (kalau ada)", category: "IMPACT", required: false },
    ],
  },
  {
    name: "Conversion", dateLabel: "T-7 → Event Day", offsetFrom: -7, offsetTo: 0,
    milestones: [
      { kind: "auto", label: "Terbitkan X konten countdown", base: 7, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Terbitkan X konten reminder", base: 3, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X pendaftaran final", base: 80, unit: "pendaftar", category: "CONVERSION", regShare: 0.35 },
      { kind: "number", label: "Jangkau X orang", base: 2500, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X views", base: 4000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X kunjungan halaman event", base: 400, unit: "kunjungan", category: "AWARENESS" },
      { kind: "number", label: "Kirim X reminder langsung", base: 200, unit: "reminder", category: "ENGAGEMENT" },
      { kind: "number", label: "Capai X% target registrasi sebelum hari-H", base: 80, unit: "%", category: "CONVERSION", fixed: true, required: false },
    ],
  },
  {
    name: "Event Day", dateLabel: "Hari-H", offsetFrom: 0, offsetTo: 0,
    milestones: [
      { kind: "number", label: "Capai X attendee", base: 300, unit: "orang", category: "ATTENDANCE", attendance: true },
      { kind: "number", label: "Capai X% attendance rate", base: 70, unit: "%", category: "ATTENDANCE", fixed: true, required: false },
      { kind: "number", label: "Dapatkan X interaksi dengan attendee", base: 300, unit: "interaksi", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X social mention", base: 60, unit: "mention", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X UGC posts/stories", base: 30, unit: "UGC", category: "CONTENT" },
      { kind: "number", label: "Kumpulkan X feedback response", base: 90, unit: "response", category: "CONVERSION" },
      { kind: "number", label: "Dapatkan X leads", base: 60, unit: "leads", category: "CONVERSION" },
      { kind: "number", label: "Capai X penjualan/revenue (kalau ada)", base: 5000000, unit: "Rp", category: "IMPACT", required: false },
    ],
  },
  {
    name: "Post-Event", dateLabel: "Event Day → T+14", offsetFrom: 0, offsetTo: 14,
    milestones: [
      { kind: "check", label: "Terbitkan recap event", category: "CONTENT" },
      { kind: "auto", label: "Terbitkan X konten pasca-event", base: 3, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X views", base: 6000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X reach", base: 4500, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X shares", base: 150, unit: "share", category: "ENGAGEMENT" },
      { kind: "number", label: "Kumpulkan X testimoni", base: 15, unit: "testimoni", category: "IMPACT" },
      { kind: "number", label: "Dapatkan X UGC", base: 30, unit: "UGC", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X leads/peluang baru", base: 30, unit: "leads", category: "IMPACT" },
      { kind: "number", label: "Follow up X leads", base: 30, unit: "leads", category: "CONVERSION" },
      { kind: "check", label: "Ukur dampak pasca-event", category: "IMPACT" },
    ],
  },
];

const TENANT_PHASES = [
  {
    name: "Prepare", dateLabel: "Campaign Start → T-14", offsetFrom: null, offsetTo: -14,
    milestones: [
      { kind: "check", label: "Konsep booth selesai", category: "CONTENT" },
      { kind: "check", label: "Visual booth selesai", category: "CONTENT" },
      { kind: "check", label: "Penawaran produk/jasa final", category: "CONVERSION" },
      { kind: "check", label: "Promo khusus event final", category: "CONVERSION" },
      { kind: "auto", label: "Terbitkan X konten pra-event", base: 5, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Terbitkan X video short-form", base: 3, unit: "video", category: "CONTENT" },
      { kind: "number", label: "Terbitkan X stories", base: 6, unit: "stories", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X reach", base: 1500, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X views", base: 2500, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X kunjungan profil", base: 200, unit: "kunjungan", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X inquiry terkait event", base: 20, unit: "inquiry", category: "ENGAGEMENT" },
    ],
  },
  {
    name: "Attract", dateLabel: "T-14 → T-1", offsetFrom: -14, offsetTo: -1,
    milestones: [
      { kind: "auto", label: "Terbitkan X konten promosi", base: 6, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X views", base: 3500, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X reach", base: 2500, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X shares", base: 60, unit: "share", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X saves", base: 60, unit: "save", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X mention booth/event", base: 20, unit: "mention", category: "ENGAGEMENT" },
      { kind: "number", label: "Dapatkan X orang tertarik mampir ke booth", base: 150, unit: "orang", category: "CONVERSION" },
      { kind: "number", label: "Dapatkan X kolaborasi", base: 3, unit: "kolaborasi", category: "IMPACT" },
      { kind: "number", label: "Dapatkan X leads pra-event", base: 30, unit: "leads", category: "CONVERSION" },
    ],
  },
  {
    name: "Event Day", dateLabel: "Hari-H", offsetFrom: 0, offsetTo: 0,
    milestones: [
      { kind: "number", label: "X pengunjung booth", base: 150, unit: "orang", category: "ATTENDANCE" },
      { kind: "number", label: "X interaksi bermakna", base: 80, unit: "interaksi", category: "ENGAGEMENT" },
      { kind: "number", label: "X demo produk/jasa", base: 30, unit: "demo", category: "CONVERSION" },
      { kind: "number", label: "X sample/trial dibagikan", base: 40, unit: "sample", category: "CONVERSION" },
      { kind: "number", label: "X leads terkumpul", base: 25, unit: "leads", category: "CONVERSION" },
      { kind: "number", label: "X followers baru", base: 30, unit: "followers", category: "AWARENESS" },
      { kind: "number", label: "X transaksi penjualan", base: 15, unit: "transaksi", category: "IMPACT" },
      { kind: "number", label: "X revenue", base: 3000000, unit: "Rp", category: "IMPACT", required: false },
      { kind: "number", label: "X UGC posts/stories", base: 8, unit: "UGC", category: "CONTENT" },
      { kind: "number", label: "X brand mention", base: 10, unit: "mention", category: "ENGAGEMENT" },
      { kind: "number", label: "Konversi pengunjung booth → lead (%)", base: 25, unit: "%", category: "CONVERSION", required: false, fixed: true },
      { kind: "number", label: "Konversi pengunjung booth → pembelian (%)", base: 12, unit: "%", category: "CONVERSION", required: false, fixed: true },
      { kind: "number", label: "Rata-rata nilai transaksi", base: 100000, unit: "Rp", category: "IMPACT", required: false, fixed: true },
      { kind: "number", label: "Leads → peluang follow-up", base: 10, unit: "peluang", category: "IMPACT", required: false },
    ],
  },
  {
    name: "Post-Event", dateLabel: "Event Day → T+14", offsetFrom: 0, offsetTo: 14,
    milestones: [
      { kind: "number", label: "Follow up X leads", base: 20, unit: "leads", category: "CONVERSION" },
      { kind: "auto", label: "Terbitkan X konten recap", base: 2, unit: "konten", category: "CONTENT" },
      { kind: "number", label: "Dapatkan X views pasca-event", base: 2000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X followers baru", base: 20, unit: "followers", category: "AWARENESS" },
      { kind: "number", label: "Konversi X leads", base: 10, unit: "leads", category: "CONVERSION" },
      { kind: "number", label: "Dapatkan X repeat purchase/peluang", base: 8, unit: "peluang", category: "IMPACT", required: false },
      { kind: "number", label: "Kumpulkan X feedback pelanggan", base: 15, unit: "feedback", category: "ENGAGEMENT" },
    ],
  },
];

const PARTICIPANT_PRE_EVENT = [
  { kind: "auto", label: "Terbitkan X konten pengumuman", base: 3, unit: "konten", category: "CONTENT" },
  { kind: "number", label: "Terbitkan X konten terkait event", base: 4, unit: "konten", category: "CONTENT" },
  { kind: "number", label: "Dapatkan X reach", base: 1500, unit: "orang", category: "AWARENESS" },
  { kind: "number", label: "Dapatkan X views", base: 2500, unit: "views", category: "AWARENESS" },
  { kind: "number", label: "Dapatkan X kunjungan profil", base: 150, unit: "kunjungan", category: "AWARENESS" },
  { kind: "number", label: "Dapatkan X mention event", base: 15, unit: "mention", category: "ENGAGEMENT" },
  { kind: "number", label: "Dapatkan X shares", base: 40, unit: "share", category: "ENGAGEMENT" },
  { kind: "number", label: "Dapatkan X saves", base: 30, unit: "save", category: "ENGAGEMENT" },
  { kind: "number", label: "Dapatkan X inbound inquiry", base: 15, unit: "inquiry", category: "ENGAGEMENT" },
  { kind: "number", label: "Dapatkan X kolaborasi/tukar konten", base: 2, unit: "kolaborasi", category: "IMPACT" },
];
const PARTICIPANT_POST_EVENT = [
  { kind: "auto", label: "Terbitkan X konten recap", base: 2, unit: "konten", category: "CONTENT" },
  { kind: "number", label: "Dapatkan X views", base: 1500, unit: "views", category: "AWARENESS" },
  { kind: "number", label: "Dapatkan X reach", base: 1200, unit: "orang", category: "AWARENESS" },
  { kind: "number", label: "Dapatkan X mention", base: 15, unit: "mention", category: "ENGAGEMENT" },
  { kind: "number", label: "Follow up X leads", base: 10, unit: "leads", category: "CONVERSION" },
  { kind: "number", label: "Dapatkan X peluang kolaborasi", base: 5, unit: "peluang", category: "IMPACT", required: false },
  { kind: "number", label: "Dapatkan X followers baru", base: 20, unit: "followers", category: "AWARENESS" },
  { kind: "number", label: "Kumpulkan X testimoni/feedback", base: 8, unit: "testimoni", category: "IMPACT", required: false },
];
// Event Day milestones are the one part of the ladder that genuinely
// differs by *participation type*, not just scale — a speaker and a
// sponsor are measured on different things even at the same event.
const PARTICIPANT_EVENT_DAY_BY_TYPE = {
  speaker: [
    { kind: "number", label: "X attendee terjangkau", base: 150, unit: "orang", category: "ATTENDANCE" },
    { kind: "number", label: "X interaksi bermakna", base: 40, unit: "interaksi", category: "ENGAGEMENT" },
    { kind: "number", label: "X pertanyaan/interaksi sesi", base: 15, unit: "interaksi", category: "ENGAGEMENT" },
    { kind: "number", label: "X mention", base: 10, unit: "mention", category: "ENGAGEMENT" },
    { kind: "number", label: "X UGC", base: 8, unit: "UGC", category: "CONTENT" },
    { kind: "number", label: "X followers baru", base: 25, unit: "followers", category: "AWARENESS" },
    { kind: "number", label: "X leads", base: 10, unit: "leads", category: "CONVERSION" },
  ],
  sponsor: [
    { kind: "number", label: "X brand mention", base: 15, unit: "mention", category: "ENGAGEMENT" },
    { kind: "number", label: "X impresi logo/exposure (kalau terukur)", base: 2000, unit: "impresi", category: "AWARENESS", required: false },
    { kind: "number", label: "X social mention", base: 12, unit: "mention", category: "ENGAGEMENT" },
    { kind: "number", label: "X leads", base: 15, unit: "leads", category: "CONVERSION" },
    { kind: "number", label: "X interaksi", base: 50, unit: "interaksi", category: "ENGAGEMENT" },
    { kind: "number", label: "X UGC", base: 6, unit: "UGC", category: "CONTENT" },
  ],
  performer: [
    { kind: "number", label: "X audiens terjangkau", base: 200, unit: "orang", category: "AWARENESS" },
    { kind: "number", label: "X social mention", base: 15, unit: "mention", category: "ENGAGEMENT" },
    { kind: "number", label: "X UGC", base: 10, unit: "UGC", category: "CONTENT" },
    { kind: "number", label: "X kunjungan profil", base: 100, unit: "kunjungan", category: "AWARENESS" },
    { kind: "number", label: "X followers baru", base: 30, unit: "followers", category: "AWARENESS" },
    { kind: "number", label: "X peluang kolaborasi", base: 5, unit: "peluang", category: "IMPACT", required: false },
  ],
  "community-partner": [
    { kind: "number", label: "X member ikut serta", base: 50, unit: "orang", category: "ATTENDANCE" },
    { kind: "number", label: "X member komunitas baru", base: 20, unit: "member", category: "AWARENESS" },
    { kind: "number", label: "X interaksi", base: 60, unit: "interaksi", category: "ENGAGEMENT" },
    { kind: "number", label: "X kolaborasi", base: 5, unit: "kolaborasi", category: "IMPACT" },
    { kind: "number", label: "X leads/peluang", base: 10, unit: "peluang", category: "CONVERSION", required: false },
  ],
};
function participantEventDayMilestones(participationType) {
  return PARTICIPANT_EVENT_DAY_BY_TYPE[participationType] || PARTICIPANT_EVENT_DAY_BY_TYPE.sponsor;
}
function participantPhases(participationType) {
  return [
    { name: "Pre-Event", dateLabel: "Campaign Start → Event Day", offsetFrom: null, offsetTo: 0, milestones: PARTICIPANT_PRE_EVENT },
    { name: "Event Day", dateLabel: "Hari-H", offsetFrom: 0, offsetTo: 0, milestones: participantEventDayMilestones(participationType) },
    { name: "Post-Event", dateLabel: "Event Day → T+14", offsetFrom: 0, offsetTo: 14, milestones: PARTICIPANT_POST_EVENT },
  ];
}

// The role-keyed entry point: pass a role id (+ participationType for
// "participant") to get that role's ready-to-build phase templates.
export function eventPhaseTemplatesForRole(role, participationType) {
  if (role === "organizer") return ORGANIZER_PHASES;
  if (role === "tenant") return TENANT_PHASES;
  if (role === "participant") return participantPhases(participationType);
  return [];
}

export const EVENT_PLAN_TERMS = {
  intro: t("store.terms.ev.intro"),
  rules: Array.from({ length: 15 }, (_, i) => ({ title: t(`store.terms.ev.${i + 1}.title`), body: t(`store.terms.ev.${i + 1}.body`) })),
};

export function createCampaign(brandId, data = {}) {
  const item = { ...emptyCampaign(brandId), ...data, id: uid(), brandId, ownerId: ownerUid };
  db.campaigns = [...(db.campaigns || []), item];
  persist(() => setDoc(doc(fdb, "campaigns", item.id), item));
  return item;
}
export function updateCampaign(id, patch) {
  const item = getCampaign(id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: Date.now() });
  persist(() => updateFields("campaigns", item.id, item, [...Object.keys(patch), "updatedAt"]));
  return item;
}
// Numbers the app genuinely can't observe (DMs, collaborations, community
// members…) live here, once per campaign, keyed by milestone id — not per
// level, so the same figure is never copied forward between levels.
export function setCampaignManualMetric(campaignId, milestoneId, patch) {
  const c = getCampaign(campaignId);
  if (!c) return null;
  const manualMetrics = { ...(c.manualMetrics || {}) };
  manualMetrics[milestoneId] = { ...(manualMetrics[milestoneId] || {}), ...patch, updatedAt: Date.now() };
  return updateCampaign(campaignId, { manualMetrics });
}
// Marks a mission-ladder level done (auto-advance, or a Pro "force").
export function completeCampaignStage(campaignId, index, { completedAt = Date.now() } = {}) {
  const c = getCampaign(campaignId);
  if (!c?.missions?.[index]) return null;
  const missions = c.missions.map((m, i) => (i === index ? { ...m, completedAt } : m));
  // Finishing the last level finishes the campaign: a done Grow Brand ladder
  // stops showing up as "running" (Beranda's top action, the pulse, the
  // weekly plan, the Grow Brand wizard's "already running" check).
  const finished = missions.every((m) => m.completedAt);
  return updateCampaign(campaignId, { missions, ...(finished && ["planning", "active"].includes(c.status || "active") ? { status: "completed" } : {}) });
}
// Soft delete: the campaign moves to Trash as-is, content still linked to
// it (campaignId untouched) so Restore below undoes this completely.
// Unlinking content only happens on the permanent purge, matching what a
// hard delete used to do immediately.
// An event's plan (brand.goals[]) and its Event campaign are one thing to
// the owner: trashing the campaign archives the plan with it, and restoring
// the campaign brings the plan back to where it was. Without this a Pemula
// account stayed locked on "one plan at a time" by a plan whose campaign
// was already gone.
function goalOwningEventCampaign(c) {
  if (!c?.goalId) return null;
  const g = (getBrand(c.brandId)?.goals || []).find((x) => x.id === c.goalId);
  return g && g.installed?.campaigns?.event?.id === c.id ? g : null;
}
// The ideas an Event plan put on the calendar that nobody has touched yet
// (still an idea, same day, same title). They are the plan's, not the owner's
// work, so they go to Trash with the event and come back with it.
export function untouchedPlanIdeaIds(c) {
  const g = goalOwningEventCampaign(c);
  if (!g) return [];
  return Object.values(g.installed?.slots || {})
    .map((rec) => ({ rec, item: rec?.contentId ? getContent(rec.contentId) : null }))
    .filter(({ rec, item }) => item && !item.deletedAt && item.status === "idea" && item.scheduleDate === rec.date && (item.title || "") === (rec.title || ""))
    .map(({ item }) => item.id);
}
// One sentence for the delete dialog when an Event's own ideas go with it.
export function planIdeasNote(c) {
  const n = untouchedPlanIdeaIds(c).length;
  return n ? `${t("camp.list.deletePlanIdeas", { count: n })} ` : "";
}
export function deleteCampaign(id) {
  const c = getCampaign(id);
  if (!c) return;
  untouchedPlanIdeaIds(c).forEach((cid) => {
    const item = getContent(cid);
    item.trashedWithCampaign = c.id;
    deleteContent(cid);
  });
  c.deletedAt = Date.now();
  persist(() => updateFields("campaigns", c.id, c, ["deletedAt"]));
  const g = goalOwningEventCampaign(c);
  if (g && g.status !== "archived") updateGoal(c.brandId, g.id, { status: "archived", archivedWithCampaign: c.id, statusBeforeArchive: g.status });
}
export function restoreCampaign(id) {
  const c = getCampaign(id);
  if (!c || !c.deletedAt) return;
  c.deletedAt = null;
  persist(() => updateFields("campaigns", c.id, c, ["deletedAt"]));
  (db.content || []).filter((x) => x.trashedWithCampaign === c.id && x.deletedAt).forEach((x) => { x.trashedWithCampaign = null; restoreContent(x.id); });
  const g = goalOwningEventCampaign(c);
  if (g && g.archivedWithCampaign === c.id) updateGoal(c.brandId, g.id, { status: g.statusBeforeArchive || "active", archivedWithCampaign: null, statusBeforeArchive: null });
}
// An Event campaign whose last phase has passed is over. Nobody had to press
// anything for its PLAN to read as completed (effectiveGoalStatus); this does
// the same for the campaign, so it stops nagging from Home and drops out of the
// pulse/calendar lists that only look at running campaigns. `autoCompleted`
// remembers it was us, so moving the date later (applyReplan) can reopen it.
export function eventCampaignEnd(c) {
  if (!c?.eventPlan) return "";
  const ends = (c.eventPlan.phases || []).map((p) => p.dateTo).filter(Boolean).sort();
  return ends[ends.length - 1] || c.eventPlan.eventDate || c.endDate || "";
}
export function settleFinishedEvents(brandId, today = localISODate()) {
  listCampaigns(brandId).forEach((c) => {
    if (!c.eventPlan || !["planning", "active"].includes(c.status)) return;
    const end = eventCampaignEnd(c);
    if (end && end < today) updateCampaign(c.id, { status: "completed", autoCompleted: true });
  });
}
// Archiving an event plan archives the campaigns it created with it (their
// content stays where it is, same as Trash); un-archiving brings both back.
export function archiveGoal(brandId, id) {
  const g = (getBrand(brandId)?.goals || []).find((x) => x.id === id);
  if (!g || g.status === "archived") return false;
  const created = Object.values(g.installed?.campaigns || {}).filter((x) => x?.created !== false).map((x) => x.id);
  created.forEach((cid) => {
    const c = getCampaign(cid);
    if (c && c.status !== "archived") updateCampaign(cid, { status: "archived", statusBeforeArchive: c.status });
  });
  updateGoal(brandId, id, { status: "archived", statusBeforeArchive: g.status });
  return true;
}
export function unarchiveGoal(brandId, id) {
  const g = (getBrand(brandId)?.goals || []).find((x) => x.id === id);
  if (!g || g.status !== "archived") return false;
  (db.campaigns || []).filter((c) => c.brandId === brandId && c.goalId === id && c.status === "archived" && c.statusBeforeArchive).forEach((c) => updateCampaign(c.id, { status: c.statusBeforeArchive, statusBeforeArchive: null }));
  const back = g.statusBeforeArchive && g.statusBeforeArchive !== "archived" ? g.statusBeforeArchive : g.installed?.campaigns?.event?.id ? "active" : "draft";
  updateGoal(brandId, id, { status: back, statusBeforeArchive: null, archivedWithCampaign: null });
  return true;
}
// "Hapus permanen" — unlinks its content (same as the old hard delete did)
// then actually removes the campaign doc.
export function purgeCampaign(id) {
  db.campaigns = (db.campaigns || []).filter((c) => c.id !== id);
  const affectedContentIds = db.content.filter((c) => c.campaignId === id).map((c) => c.id);
  db.content.forEach((c) => { if (c.campaignId === id) { c.campaignId = ""; c.campaignPhaseId = ""; } });
  persist(async () => {
    await deleteDoc(doc(fdb, "campaigns", id));
    await Promise.all(affectedContentIds.map((cid) => getContent(cid) && updateFields("content", cid, getContent(cid), ["campaignId", "campaignPhaseId"])));
  });
}

// ---------- Content Series (recurring content memory) ----------
// A saved, reusable "episode format" — see defaultSeriesDNA above. Same
// CRUD shape as Campaigns: flat collection, brandId foreign key, no
// nesting inside the brand doc.
function emptySeries(brandId) {
  return {
    id: uid(),
    brandId,
    name: "",
    dna: defaultSeriesDNA(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
export function listSeries(brandId, { includeDeleted = false } = {}) {
  return (db.series || [])
    .filter((s) => s.brandId === brandId && (includeDeleted || notDeleted(s)))
    .map((s) => { if (!s.dna) s.dna = defaultSeriesDNA(); return s; })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getSeries(id) {
  const s = (db.series || []).find((s) => s.id === id) || null;
  if (s && !s.dna) s.dna = defaultSeriesDNA();
  return s;
}
// Matches a series by name against free text (e.g. a brainstorm message)
// so "Buat Bedah Brand tentang Nike" resolves to the "Bedah Brand" series
// without the owner having to pick it from a menu first. Whole-word,
// case-insensitive; the longest matching name wins when more than one
// series name appears in the text (avoids a short name accidentally
// matching inside a longer one).
export function findSeriesByNameInText(brandId, text) {
  if (!text) return null;
  const norm = text.toLowerCase();
  const matches = listSeries(brandId).filter((s) => s.name && norm.includes(s.name.toLowerCase()));
  if (!matches.length) return null;
  return matches.sort((a, b) => b.name.length - a.name.length)[0];
}
export function createSeries(brandId, data = {}) {
  const item = { ...emptySeries(brandId), ...data, id: uid(), brandId, ownerId: ownerUid, dna: { ...defaultSeriesDNA(), ...(data.dna || {}) } };
  db.series = [...(db.series || []), item];
  persist(() => setDoc(doc(fdb, "series", item.id), item));
  return item;
}
export function updateSeries(id, patch) {
  const item = getSeries(id);
  if (!item) return null;
  if (patch.dna) { item.dna = { ...item.dna, ...patch.dna }; patch = { ...patch, dna: item.dna }; }
  Object.assign(item, patch, { updatedAt: Date.now() });
  persist(() => updateFields("series", item.id, item, [...Object.keys(patch), "updatedAt"]));
  return item;
}
// Soft delete: content stays linked (seriesId untouched) while the series
// sits in Trash, so Restore below brings the whole thing back exactly as
// it was. Unlinking only happens on the permanent purge.
export function deleteSeries(id) {
  const s = getSeries(id);
  if (!s) return;
  s.deletedAt = Date.now();
  persist(() => updateFields("series", s.id, s, ["deletedAt"]));
}
export function restoreSeries(id) {
  const s = getSeries(id);
  if (!s || !s.deletedAt) return;
  s.deletedAt = null;
  persist(() => updateFields("series", s.id, s, ["deletedAt"]));
}
// "Hapus permanen". Content linked to it keeps its script/history, it just
// stops reading that series' context on future regenerations — same
// unlink-not-delete behavior purgeCampaign above uses for its content.
export function purgeSeries(id) {
  db.series = (db.series || []).filter((s) => s.id !== id);
  const affectedContentIds = db.content.filter((c) => c.seriesId === id).map((c) => c.id);
  db.content.forEach((c) => { if (c.seriesId === id) c.seriesId = ""; });
  persist(async () => {
    await deleteDoc(doc(fdb, "series", id));
    await Promise.all(affectedContentIds.map((cid) => getContent(cid) && updateFields("content", cid, getContent(cid), ["seriesId"])));
  });
}

// Everything currently in Trash, across every brand — Settings → Data's
// Trash section (js/views/settings.js) reads this. `kind` tells it which
// restore*/purge* pair to call; `brandName` is resolved once here so the
// UI doesn't need a getBrand lookup per row (and still shows something
// sane for a brand that is itself in Trash or already gone).
export function listTrash() {
  const brandName = (id) => getBrand(id)?.name || t("trash.unknownBrand");
  const rows = [
    ...db.brands.filter((b) => b.deletedAt).map((b) => ({ kind: "brand", id: b.id, name: b.name, brandName: b.name, deletedAt: b.deletedAt })),
    ...db.content.filter((c) => c.deletedAt).map((c) => ({ kind: "content", id: c.id, name: c.title || t("beginner.untitled"), brandName: brandName(c.brandId), deletedAt: c.deletedAt })),
    ...(db.campaigns || []).filter((c) => c.deletedAt).map((c) => ({ kind: "campaign", id: c.id, name: c.name || t("camp.untitled"), brandName: brandName(c.brandId), deletedAt: c.deletedAt })),
    ...(db.series || []).filter((s) => s.deletedAt).map((s) => ({ kind: "series", id: s.id, name: s.name, brandName: brandName(s.brandId), deletedAt: s.deletedAt })),
  ];
  return rows.sort((a, b) => b.deletedAt - a.deletedAt);
}
const TRASH_RESTORE = { brand: restoreBrand, content: restoreContent, campaign: restoreCampaign, series: restoreSeries };
const TRASH_PURGE = { brand: purgeBrand, content: purgeContent, campaign: purgeCampaign, series: purgeSeries };
export function restoreTrashItem(kind, id) {
  TRASH_RESTORE[kind]?.(id);
}
export function purgeTrashItem(kind, id) {
  TRASH_PURGE[kind]?.(id);
}
// Best-effort client-side sweep of anything past TRASH_DAYS — called once
// from initStore() after the first snapshot of everything has landed.
// Never awaited by its caller and never throws: a purge that fails (a
// permission blip, e.g.) just leaves those rows for the next load to try
// again, same "never block on cleanup" spirit as everything else in this
// file that fires a persist() and moves on.
export function purgeOldTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  try {
    listTrash()
      .filter((row) => row.deletedAt < cutoff)
      .forEach((row) => TRASH_PURGE[row.kind]?.(row.id));
  } catch (e) {
    console.error("Trash auto-purge failed", e);
  }
}

// ---------- Settings ----------
export function getSettings() {
  return db.settings;
}
// `fields`: the top-level settings this change touched. Only those are
// written (setDoc + mergeFields: each replaced whole, the doc created if
// this account never had one) — never the rest of a possibly stale copy.
function persistSettings(fields) {
  // db.settings.ai may carry the shared settings/main keys merged in —
  // write back only this account's own ai block so the shared keys never
  // get duplicated into a per-account doc.
  const data = { ...db.settings, ai: personalAi || db.settings.ai };
  const keys = [...new Set(fields || [])].filter(Boolean);
  if (!keys.length || !keys.every((k) => PLAIN_FIELD.test(k))) {
    persist(() => setDoc(doc(fdb, "settings", ownerUid), data));
    return;
  }
  persist(() => setDoc(doc(fdb, "settings", ownerUid), fieldPatch(data, keys), { mergeFields: keys }));
}
export function updateSettings(patch) {
  db.settings = { ...db.settings, ...patch };
  persistSettings(Object.keys(patch));
  return db.settings;
}
export function updateFormulas(patch) {
  db.settings.formulas = { ...db.settings.formulas, ...patch };
  persistSettings(["formulas"]);
}
export function updateAiSettings(patch) {
  personalAi = { ...(personalAi || db.settings.ai), ...patch };
  db.settings.ai = isGlobalAiActive() ? { ...personalAi, ...globalAi } : personalAi;
  persistSettings(["ai"]);
}
// Per-platform override — starts as a copy of the current defaults for
// that funnel so the settings form always has real numbers to show, then
// applies the patch. Passing `null` as the patch removes the platform's
// override entirely (back to defaults).
export function updatePlatformThresholds(platform, funnel, patch) {
  const all = { ...(db.settings.thresholdsByPlatform || {}) };
  if (patch === null) {
    delete all[platform];
  } else {
    const base = all[platform] || {};
    const current = base[funnel] || db.settings.thresholds[funnel];
    all[platform] = {
      ...base,
      [funnel]: {
        engagementRate: { ...current.engagementRate, ...(patch.engagementRate || {}) },
        followerConversionRate: { ...current.followerConversionRate, ...(patch.followerConversionRate || {}) },
      },
    };
  }
  db.settings.thresholdsByPlatform = all;
  persistSettings(["thresholdsByPlatform"]);
}
export function updateThresholds(funnel, patch) {
  db.settings.thresholds[funnel] = {
    engagementRate: { ...db.settings.thresholds[funnel].engagementRate, ...(patch.engagementRate || {}) },
    followerConversionRate: { ...db.settings.thresholds[funnel].followerConversionRate, ...(patch.followerConversionRate || {}) },
  };
  persistSettings(["thresholds"]);
}
export function addPlatform(name) {
  const p = { id: uid(), name: name.trim() };
  db.settings.platforms.push(p);
  persistSettings(["platforms"]);
  return p;
}
export function removePlatform(id) {
  db.settings.platforms = db.settings.platforms.filter((p) => p.id !== id);
  persistSettings(["platforms"]);
}
export function addFormat(name) {
  const f = { id: uid(), name: name.trim() };
  db.settings.formats.push(f);
  persistSettings(["formats"]);
  return f;
}
export function removeFormat(id) {
  db.settings.formats = db.settings.formats.filter((f) => f.id !== id);
  persistSettings(["formats"]);
}

// ---------- Routine Template (standing weekly schedule, home page) ----------
export const ROUTINE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const ROUTINE_DAY_LABELS = Object.fromEntries(ROUTINE_DAYS.map((d) => [d, t(`store.day.${d}`)]));

// ---------- Uploads per week: one number, kept in Jadwal Kerja ----------
// brand.contentCadence (Kalender → Jadwal Kerja) is the only place the
// owner's posting rhythm lives. The Grow Brand and Event wizards both ask
// "how many a week can you really do?" — they read it from here and, when
// the owner types a different number, write it back here, so the next
// wizard, the auto-scheduler and the weekly plan all see the same rhythm.
export function cadenceUploadsPerWeek(brand) {
  const c = brand?.contentCadence;
  return c?.configured && c.uploadDays?.length ? c.uploadDays.length * (Number(c.perDay) || 1) : null;
}
// A rhythm spread over the week (3 a week lands Mon/Wed/Fri, not Mon/Tue/Wed).
const UPLOAD_SPREAD = {
  1: ["wed"], 2: ["tue", "fri"], 3: ["mon", "wed", "fri"], 4: ["mon", "wed", "fri", "sun"],
  5: ["mon", "tue", "wed", "thu", "fri"], 6: ["mon", "tue", "wed", "thu", "fri", "sat"], 7: ROUTINE_DAYS,
};
// Returns the new cadence when something changed, else null. Days the owner
// already picked are kept where the new count allows it.
export function setCadenceUploadsPerWeek(brandId, perWeek) {
  const n = Math.min(21, Math.round(Number(perWeek)));
  const b = getBrand(brandId);
  if (!b || !(n > 0) || cadenceUploadsPerWeek(b) === n) return null;
  const perDay = Math.max(1, Math.ceil(n / 7));
  const dayCount = Math.min(7, Math.ceil(n / perDay));
  const spread = UPLOAD_SPREAD[dayCount];
  const had = ROUTINE_DAYS.filter((d) => (b.contentCadence?.uploadDays || []).includes(d));
  let days = had.filter((d) => spread.includes(d));
  had.forEach((d) => { if (days.length < dayCount && !days.includes(d)) days.push(d); });
  [...spread, ...ROUTINE_DAYS].forEach((d) => { if (days.length < dayCount && !days.includes(d)) days.push(d); });
  days = ROUTINE_DAYS.filter((d) => days.slice(0, dayCount).includes(d));
  // seriesDays rides along: a day that stops being an upload day simply
  // stops airing its series (js/week-plan.js seriesDays ignores it).
  const cadence = { shootDays: b.contentCadence?.shootDays || [], editDays: b.contentCadence?.editDays || [], uploadDays: days, perDay, configured: true, seriesDays: b.contentCadence?.seriesDays || {} };
  updateBrand(brandId, { contentCadence: cadence });
  return cadence;
}
// listRoutineTemplate/addRoutineItem/removeRoutineItem/markRoutineDoneToday
// (a standalone "My Routine" editor) were removed — they had no caller left
// anywhere in the app. syncCadenceRoutine, which used to mirror Content
// OS's cadence setup into this collection as a mechanical copy of
// brand.contentCadence, was removed for the same reason: nothing read
// those mirrored docs either (js/views/calendar.js reads contentCadence
// directly). The routineTemplate Firestore listener in initStore() is left
// in place and stays tolerant of whatever old docs still exist, and backup/
// restore/account-deletion still cover the collection so old data isn't
// stranded — it just has no writer left.

// ---------- Backup ----------
// Fields a backup must never carry: the shared AI config (no secrets in it
// anymore, but still not this account's data to export) and per-brand
// social tokens. `settings.aiUsage` is legacy — recordAiUsage() no longer
// writes it (see js/ai-usage.js / aiUsage/{uid}), but an old cached `db`
// could still have one lying around.
function stripBrandSecrets(b) {
  const clean = { ...b };
  if (clean.instagram) {
    const { accessToken, ...rest } = clean.instagram;
    clean.instagram = rest;
  }
  if (clean.facebook) {
    const { pageAccessToken, ...rest } = clean.facebook;
    clean.facebook = rest;
  }
  if (clean.ads) {
    clean.ads = Object.fromEntries(Object.entries(clean.ads).filter(([k]) => !/token/i.test(k)));
  }
  return clean;
}
// A backup carries every brand's files inline (the pre-assets shape, so an
// older app version can still restore it) and every brand's chat threads —
// both are loaded per brand only, so prepareExport() fetches whatever isn't
// in memory yet. Call it (await) right before exportJSON().
let exportThreads = null;
// Rejects if any of it can't be read — a backup must never silently miss
// files, sales or chats (js/views/settings.js shows the error, no file).
// Resolves to the files that were referenced but don't exist (a dangling
// ref): [{ brandName, kind }] — the backup goes ahead without them, and the
// caller says which were skipped.
export async function prepareExport() {
  await ensureSdk();
  bulkBusy++;
  try {
    exportThreads = null;
    for (const b of db.brands || []) await loadBrandAssets(b, { strict: true });
    await Promise.all((db.brands || []).map((b) => ensureBrandSales(b.id, { strict: true })));
    const snap = await getDocs(query(collection(fdb, "brainstorms"), where("ownerId", "==", ownerUid)));
    exportThreads = snap.docs.map((d) => d.data());
    return (db.brands || []).flatMap((b) => blobValues(hydrateBrand(b)).filter((v) => isAssetRef(v.value)).map((v) => ({ brandName: b.name || "", kind: v.kind })));
  } finally {
    bulkBusy--;
  }
}
export function exportJSON() {
  // `reminders` holds this account's private calendar-feed token and push
  // endpoints — device-bound secrets that must not travel in a backup file
  // (imported into another account, two accounts would share one token).
  const { ai, aiUsage, reminders, ...settingsRest } = db.settings || {};
  const brainstorms = exportThreads || db.brainstorms;
  exportThreads = null;
  // A file that couldn't be found leaves its slot empty, not a dead ref.
  const brands = (db.brands || []).map((b) => stripBrandSecrets(mapBlobSlots(hydrateBrand(b), (v) => (isAssetRef(v) ? "" : v))));
  return JSON.stringify({ ...db, brainstorms, brands, settings: settingsRest }, null, 2);
}
// The one-time (or occasional) bulk migration path — e.g. moving an
// existing local backup into this shared cloud database. Unlike every
// other write above, this is deliberately awaited by its caller rather than
// fire-and-forget, since it's a big batch operation the UI should wait on.
export async function importJSON(json) {
  // Size, doc ids, brand colors and the plan's brand limit are checked
  // before anything is written (js/account.js checkImport; audit S-16/S-20).
  const { checkImport } = await import("./account.js");
  const parsed = checkImport(json, db.brands);
  await ensureSdk();
  const next = { ...defaultDB(), ...parsed };
  // Stamp ownerId on every imported doc regardless of what the backup file
  // says — otherwise an imported doc with no/stale ownerId would be
  // invisible to this account's own filtered queries (or worse, rejected
  // outright by firestore.rules) right after import. Brand social tokens
  // and the shared AI config never belong in a backup (see exportJSON
  // above) — strip them here too, in case an older backup still has them.
  next.brands = (next.brands || []).map((b) => ({ ...stripBrandSecrets(b), ownerId: ownerUid }));
  next.content = (next.content || []).map((c) => ({ ...c, ownerId: ownerUid }));
  next.campaigns = (next.campaigns || []).map((c) => ({ ...c, ownerId: ownerUid }));
  next.routineTemplate = (next.routineTemplate || []).map((r) => ({ ...r, ownerId: ownerUid }));
  next.brainstorms = (next.brainstorms || []).map((b) => ({ ...b, ownerId: ownerUid }));
  {
    const { ai, aiUsage, reminders, ...settingsRest } = next.settings || {};
    next.settings = settingsRest;
  }
  // Each brand is written first — on its own, with the brand-count move it
  // needs — and only then its files (asset docs; the brand doc gets refs)
  // and its sales log (month docs, merged in, never replacing one): rules
  // only accept those under a brand that already exists.
  bulkBusy++;
  try {
    await whenBrandCountSettled();
    const wasActive = new Map(db.brands.map((b) => [b.id, brandIsActive(b)]));
    for (const b of next.brands) {
      const { stored, uploads } = dehydrateBlobs(b);
      rememberAssets(b.id, uploads);
      const sales = stored.salesTracker ? salesWritePlan(stored, null, { fresh: true }) : null;
      const brandOp = { type: "set", ref: doc(fdb, "brands", b.id), data: sales ? { ...stored, salesTracker: sales.stored } : stored };
      try {
        await commitBrandMove(b.id, wasActive.get(b.id) || false, brandIsActive(b), (counter) => [{ group: [brandOp, counter] }]);
      } catch (e) {
        if (e?.code === "brand-limit") throw new Error(t("brands.offer.lockedTitle", { limit: brandLimitOf() }));
        throw e;
      }
      await commitInChunks([
        ...uploads.map((u) => ({ type: "set", ref: doc(fdb, "brands", b.id, "assets", u.id), data: assetDoc(b, u) })),
        ...(sales ? sales.ops : []),
      ]);
    }
  } finally {
    bulkBusy--;
  }
  await commitInChunks([
    ...next.content.map((c) => ({ type: "set", ref: doc(fdb, "content", c.id), data: c })),
    ...next.campaigns.map((c) => ({ type: "set", ref: doc(fdb, "campaigns", c.id), data: c })),
    ...next.routineTemplate.map((r) => ({ type: "set", ref: doc(fdb, "routineTemplate", r.id), data: r })),
    ...next.brainstorms.map((b) => ({ type: "set", ref: doc(fdb, "brainstorms", b.id), data: b })),
    { type: "set", ref: doc(fdb, "settings", ownerUid), data: next.settings },
  ]);
  db = next;
  dispatchDbChange();
}
export function resetAll() {
  const brandIds = db.brands.map((b) => b.id);
  const activeIds = db.brands.filter(brandIsActive).map((b) => b.id);
  const contentIds = db.content.map((c) => c.id);
  const campaignIds = (db.campaigns || []).map((c) => c.id);
  const routineIds = (db.routineTemplate || []).map((r) => r.id);
  db = defaultDB();
  persist(async () => {
    await whenBrandCountSettled();
    const subRefs = (await Promise.all(brandIds.map(brandSubDocRefs))).flat();
    // Active brands one batch each, with the brand count going down by one
    // (a delete of a doc already gone would fail the rules, so they're left
    // out of the bulk below).
    const done = new Set();
    for (const id of activeIds) {
      await commitBrandMove(id, true, false, (counter) => [{ group: [{ type: "delete", ref: doc(fdb, "brands", id) }, counter] }]);
      done.add(id);
    }
    return commitInChunks([
    ...subRefs.map((ref) => ({ type: "delete", ref })),
    ...brandIds.filter((id) => !done.has(id)).map((id) => ({ type: "delete", ref: doc(fdb, "brands", id) })),
    ...contentIds.map((id) => ({ type: "delete", ref: doc(fdb, "content", id) })),
    ...campaignIds.map((id) => ({ type: "delete", ref: doc(fdb, "campaigns", id) })),
    ...routineIds.map((id) => ({ type: "delete", ref: doc(fdb, "routineTemplate", id) })),
    { type: "set", ref: doc(fdb, "settings", ownerUid), data: db.settings },
    ]);
  });
}

// ---------- AI feedback ----------
// One 👍/👎 (+ optional reason) per AI result, written straight to
// Firestore's aiFeedback collection — the seed of an eval set for prompt
// changes (and, much later, fine-tuning). Deliberately NOT routed through
// persist(): that fires db:change, which repaints the current view and
// would wipe the very AI result the user is rating. Nothing in the app
// reads this collection back, so there's no local mirror to update either.
export function recordAiFeedback({ brandId = null, feature, prompt = "", output = "", rating, note = "" }) {
  if (!ownerUid || !feature || !["up", "down"].includes(rating)) return null;
  const id = uid();
  const item = {
    id,
    uid: ownerUid,
    brandId: brandId || null,
    feature,
    prompt: String(prompt).slice(0, 8000),
    output: String(output).slice(0, 12000),
    rating,
    note: String(note || "").slice(0, 1000),
    createdAt: Date.now(),
  };
  ensureSdk().then(() => setDoc(doc(fdb, "aiFeedback", id), item)).catch((e) => console.error("AI feedback save failed", e));
  return id;
}
