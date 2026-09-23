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
import { db as fdb } from "./firebase.js";
import {
  collection, doc, query, where, onSnapshot, setDoc, deleteDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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
// Display-only: organic + ad-boosted views on top. Deliberately NOT fed back
// into content.performance or computeContentMetrics — engagement-rate math
// must stay organic-only, since paid reach behaves completely differently
// and would dilute the percentage meaninglessly.
export function combinedViewsWithAds(content) {
  const organic = organicViews(content);
  const adsViews = content.adsPerformance?.found ? content.adsPerformance.videoViews : null;
  if (organic === null && adsViews === null) return null;
  return (organic ?? 0) + (adsViews ?? 0);
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
// hasName is null until the Naming stage's opening question ("udah punya
// nama brand?") is answered — true skips straight to confirming the name
// they already have, false opens the AI brainstorm tool.
export function defaultNaming() {
  return { hasName: null, name: "", source: "" };
}

function defaultBrandBuilder() {
  return {
    stage: "foundation",
    completedStages: [],
    personality: defaultPersonality(),
    toneOfVoice: defaultToneOfVoice(),
    naming: defaultNaming(),
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
      // Global, not per-brand — one shared Anthropic/Gemini/DeepSeek key
      // drives AI Script & Hook Generation for every brand and every
      // teammate, same as the app's other credentials (stored in Firestore,
      // used directly from the browser).
      ai: { provider: "anthropic", anthropicApiKey: "", geminiApiKey: "", deepseekApiKey: "" },
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
      homeWidgets: ["growthViews", "growthEngagement", "topContent", "platformBreakdown", "formatBreakdown", "funnelBreakdown", "contentHealth"],
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
      toast(t("store.syncSaveFailed"), "error");
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
export function initStore(uid) {
  ownerUid = uid;
  return new Promise((resolve) => {
    const ready = { brands: false, content: false, campaigns: false, routineTemplate: false, brainstorms: false, series: false, settings: false };
    const checkReady = () => {
      if (Object.values(ready).every(Boolean)) resolve();
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

    onSnapshot(mine("brands"), (snap) => {
      db.brands = snap.docs.map((d) => d.data());
      ready.brands = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("brands", "brands"));

    onSnapshot(mine("content"), (snap) => {
      db.content = snap.docs.map((d) => d.data());
      ready.content = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("content", "content"));

    onSnapshot(mine("campaigns"), (snap) => {
      db.campaigns = snap.docs.map((d) => d.data());
      ready.campaigns = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("campaigns", "campaigns"));

    onSnapshot(mine("routineTemplate"), (snap) => {
      db.routineTemplate = snap.docs.map((d) => d.data());
      ready.routineTemplate = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("routineTemplate", "routine"));

    onSnapshot(mine("brainstorms"), (snap) => {
      db.brainstorms = snap.docs.map((d) => d.data());
      ready.brainstorms = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("brainstorms", "brainstorms"));

    onSnapshot(mine("series"), (snap) => {
      db.series = snap.docs.map((d) => d.data());
      ready.series = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("series", "series"));

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
      window.dispatchEvent(new CustomEvent("db:change"));
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
  });
}

// Shared AI config lives in settings/main (written only by the Wepeka team
// account, see firestore.rules). `globalAi` is that doc's `ai` block or null;
// `personalAi` is this account's own `ai` block, kept separately so
// persistSettings() never copies the shared keys into settings/{uid}.
let globalAi = null;
let personalAi = null;
// Seasonal background of the all-brands home, also in settings/main
// (admin-written, read by everyone) — see js/brands-bg.js.
let globalBrandsBg = null;
const AI_KEY_FIELD = { anthropic: "anthropicApiKey", gemini: "geminiApiKey", deepseek: "deepseekApiKey" };
// True when settings/main holds a usable key for its own provider — then it
// overrides whatever the account set for itself.
export function isGlobalAiActive() {
  return !!globalAi && !!globalAi[AI_KEY_FIELD[globalAi.provider] || "anthropicApiKey"];
}
export function getGlobalAiSettings() {
  return globalAi ? { ...globalAi } : null;
}
export function updateGlobalAiSettings(patch) {
  const next = { ...(globalAi || {}), ...patch };
  persist(() => setDoc(doc(fdb, "settings", "main"), { ai: next }, { merge: true }));
}

export function getGlobalBrandsBg() {
  return globalBrandsBg ? { ...globalBrandsBg } : null;
}
export function updateGlobalBrandsBg(next) {
  globalBrandsBg = next;
  persist(() => setDoc(doc(fdb, "settings", "main"), { brandsBg: next }, { merge: true }));
  window.dispatchEvent(new CustomEvent("db:change"));
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
  if (b && !b.ads) b.ads = { adAccountId: "", adsAccessToken: "", accountName: "", connectedAt: null };
  return b;
}
export function createBrand({ name, avatar = "", color = "", driveLink = "", brandbookLink = "", logoAssets = [], instagram, facebook, ads, aiVoiceGuide = "", businessDescription = "", brandDNA, brandGuidelines, brandBuilder } = {}) {
  const brand = {
    id: uid(), ownerId: ownerUid, name: name.trim(), avatar,
    // Manually-picked brand essence color (hex) — takes priority over the
    // auto-sampled avatar color everywhere --brand-tint is used (hover
    // glow on brand cards, the tab/scrollbar/button tint inside that
    // brand's own lab). Empty until the user sets one in Edit Brand.
    color,
    driveLink, brandbookLink, logoAssets,
    // A plain-language "what does this brand do" paragraph, captured right
    // at creation so every AI feature has at least basic business context
    // from day one — before anyone's gone through the full (optional,
    // multi-step) Brand DNA wizard. See ai.js's buildBrandContext.
    businessDescription,
    // Plain text, not the Drive link above — this is what actually gets fed
    // into the AI prompt, since the generator can't read a linked document.
    aiVoiceGuide,
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

// ---------- Brand ideas (brand.ideas[]) ----------
// Ideas the Brainstorm partner produced outside any campaign — same shape
// as campaign.ideas ({ id, text, description, source, createdAt }) so the
// two lists read the same everywhere. Capped so the brand doc stays small.
export const BRAND_IDEAS_CAP = 100;
export function addBrandIdea(brandId, { text, description = "", source = "brainstorm" }) {
  const b = getBrand(brandId);
  const clean = String(text || "").trim();
  if (!b || !clean) return null;
  const idea = { id: uid(), text: clean.slice(0, 140), description: String(description || "").trim().slice(0, 400), source, createdAt: Date.now() };
  updateBrand(brandId, { ideas: [...(b.ideas || []), idea].slice(-BRAND_IDEAS_CAP) });
  return idea;
}
export function removeBrandIdea(brandId, id) {
  const b = getBrand(brandId);
  if (!b) return;
  updateBrand(brandId, { ideas: (b.ideas || []).filter((i) => i.id !== id) });
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
export function listGoals(brandId, { includeArchived = false } = {}) {
  const b = getBrand(brandId);
  return (b?.goals || []).filter((g) => includeArchived || g.status !== "archived").sort((a, b2) => (a.targetDate || "").localeCompare(b2.targetDate || ""));
}
export function getGoal(brandId, id) {
  return (getBrand(brandId)?.goals || []).find((g) => g.id === id) || null;
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
export function deleteGoal(brandId, id) {
  const b = getBrand(brandId);
  if (!b) return;
  updateBrand(brandId, { goals: (b.goals || []).filter((g) => g.id !== id) });
}

// ---------- Brainstorm threads (brainstorms/ collection) ----------
// One doc per chat thread: { id, ownerId, brandId, campaignId, contentId,
// title, mode, messages, ideas, proposal, createdAt, updatedAt }. `mode`
// is "companion" for the Home Companion's single rolling thread per brand
// (id = companionThreadId(brandId), so no lookup table is needed) and
// "chat" | "plan" for Brainstorm partner threads (R4, next). messages are
// { id, role: "user"|"assistant", text, at, blocks? } — `blocks` keeps the
// parsed directive output (ideas, asks, a recap card…) so the cards survive
// a reload without re-parsing or re-asking the model. Capped: the oldest
// messages drop off; anything worth keeping past that has become a moment.
export const THREAD_MESSAGE_CAP = 80;

export function listBrainstorms(brandId) {
  return (db.brainstorms || []).filter((b) => b.brandId === brandId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export function getBrainstorm(id) {
  return (db.brainstorms || []).find((b) => b.id === id) || null;
}
export function createBrainstorm(brandId, { id = uid(), mode = "chat", title = "", campaignId = null, stageId = null, contentId = null, goalId = null, seriesId = null } = {}) {
  const now = Date.now();
  const thread = { id, ownerId: ownerUid, brandId, campaignId, stageId, contentId, goalId, seriesId, title, mode, messages: [], ideas: [], proposal: null, createdAt: now, updatedAt: now };
  db.brainstorms = [...(db.brainstorms || []).filter((b) => b.id !== id), thread];
  persist(() => setDoc(doc(fdb, "brainstorms", id), thread));
  return thread;
}
function saveBrainstorm(next) {
  db.brainstorms = (db.brainstorms || []).map((b) => (b.id === next.id ? next : b));
  persist(() => setDoc(doc(fdb, "brainstorms", next.id), next));
  return next;
}
export function updateBrainstorm(id, patch) {
  const cur = getBrainstorm(id);
  if (!cur) return null;
  return saveBrainstorm({ ...cur, ...patch, updatedAt: Date.now() });
}
export function appendBrainstormMessage(id, { role, text, at = Date.now(), blocks = null }) {
  const cur = getBrainstorm(id);
  if (!cur) return null;
  const msg = { id: uid(), role, text, at, ...(blocks ? { blocks } : {}) };
  saveBrainstorm({ ...cur, messages: [...(cur.messages || []), msg].slice(-THREAD_MESSAGE_CAP), updatedAt: at });
  return msg;
}
// Patches one message in place (e.g. marking a recap card as decided).
export function updateBrainstormMessage(id, msgId, patch) {
  const cur = getBrainstorm(id);
  if (!cur) return null;
  return saveBrainstorm({ ...cur, messages: (cur.messages || []).map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updatedAt: Date.now() });
}
export function removeBrainstormMessage(id, msgId) {
  const cur = getBrainstorm(id);
  if (!cur) return null;
  return saveBrainstorm({ ...cur, messages: (cur.messages || []).filter((m) => m.id !== msgId), updatedAt: Date.now() });
}
export function deleteBrainstorm(id) {
  db.brainstorms = (db.brainstorms || []).filter((b) => b.id !== id);
  persist(() => deleteDoc(doc(fdb, "brainstorms", id)));
}
export function companionThreadId(brandId) {
  return `companion-${brandId}`;
}
export function getCompanionThread(brandId) {
  return getBrainstorm(companionThreadId(brandId));
}
export function ensureCompanionThread(brandId) {
  return getCompanionThread(brandId) || createBrainstorm(brandId, { id: companionThreadId(brandId), mode: "companion", title: "" });
}
export function archiveBrand(id, archived = true) {
  return updateBrand(id, { archived });
}
export function deleteBrand(id) {
  const removedContentIds = db.content.filter((c) => c.brandId === id).map((c) => c.id);
  const removedCampaignIds = (db.campaigns || []).filter((c) => c.brandId === id).map((c) => c.id);
  const removedThreadIds = (db.brainstorms || []).filter((b) => b.brandId === id).map((b) => b.id);
  db.brands = db.brands.filter((b) => b.id !== id);
  db.content = db.content.filter((c) => c.brandId !== id);
  db.campaigns = (db.campaigns || []).filter((c) => c.brandId !== id);
  db.brainstorms = (db.brainstorms || []).filter((b) => b.brandId !== id);
  persist(async () => {
    await deleteDoc(doc(fdb, "brands", id));
    await Promise.all(removedContentIds.map((cid) => deleteDoc(doc(fdb, "content", cid))));
    await Promise.all(removedCampaignIds.map((cid) => deleteDoc(doc(fdb, "campaigns", cid))));
    await Promise.all(removedThreadIds.map((tid) => deleteDoc(doc(fdb, "brainstorms", tid))));
  });
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
    trialReel: false,
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

// Read-time fallback for content saved before `performance` was always
// guaranteed (or written through a path that omitted it) — several views
// read `c.performance.views` directly instead of through
// computeContentMetrics()'s safe `content.performance || {}`, so a missing
// object here crashed Dashboard/Reports outright. Same pattern as
// campaign.phases above.
export function listContent(brandId, { includeArchived = false } = {}) {
  return db.content
    .filter((c) => c.brandId === brandId && (includeArchived || !c.archived))
    .map((c) => { if (!c.performance) c.performance = {}; return c; })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
export function getContent(id) {
  const c = db.content.find((c) => c.id === id) || null;
  if (c && !c.performance) c.performance = {};
  return c;
}
export function createContent(brandId, data = {}) {
  const item = { ...emptyContent(brandId), ...data, id: uid(), brandId, ownerId: ownerUid };
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
export function listCampaigns(brandId) {
  return (db.campaigns || [])
    .filter((c) => c.brandId === brandId)
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
// across all 5 levels of a ladder, and again across ladders) — looked up by
// createMissionsForTemplate, shown as the tree node's hover tooltip and as
// a caption under its row in the milestone list.
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
function milestoneDescriptionSource(label) {
  const k = MS_LABEL_KEYS.get(label);
  return (k && CAMPAIGN_DICT[`store.msd.${k}`]?.id) || "";
}

// ---------- Display-time localisation of stored template text ----------
// Templates are copied into Firestore when a campaign is created, so stored
// campaigns carry the template's canonical text (milestone labels/units in
// Indonesian, level and phase names in English). These map that text back to
// its i18n key when painting, so old and new campaigns both render in the
// current language. Anything not from a template (user-typed) passes through.
export function milestoneLabel(label) {
  const k = MS_LABEL_KEYS.get(label);
  return k ? t(`store.ms.${k}`) : label;
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

export const MISSION_LADDERS = {
  "grow-social": {
    // No time limit and no explicit per-content linking — every piece of
    // content the brand publishes counts toward this ladder automatically
    // (see milestoneStatus's autoLinkAllContent branch). The calibration
    // question asks directly whether this ground has already been covered
    // — not a proxy like "how many followers do you have" (that only
    // speaks to one of sixteen milestones) — and lets the user jump to a
    // specific mission if so, while still steering them toward starting
    // at Level 1 by default.
    autoLinkAllContent: true,
    calibration: {
      question: t("store.ladder.growSocial.question"),
      skipNote: t("store.ladder.skipNote"),
    },
    // The framework itself: numbers are cumulative (total to date, not a
    // monthly delta) but quality/consistency must hold throughout — a viral
    // spike or bought engagement can't be used to skip a level.
    progressionNote: t("store.ladder.growSocial.progression"),
    missions: () => [
      {
        name: "Get Discovered", description: t("store.mission.gs1.desc"), tagline: t("store.mission.gs1.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 1000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten orisinal terbit", target: 50, unit: "konten", highlight: true },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 8, unit: "minggu" },
          { kind: "number", label: "Shares", target: 150, unit: "share" },
          { kind: "number", label: "Saves", target: 150, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 50, unit: "DM" },
          { kind: "auto-er-count", label: "Video dengan engagement rate di atas 10%", target: 5, unit: "video", threshold: 10 },
          { kind: "check", label: "Engagement rate sehat dibanding rata-rata platform", highlight: true },
        ],
      },
      {
        name: "Build Trust", description: t("store.mission.gs2.desc"), tagline: t("store.mission.gs2.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 3000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 100, unit: "konten", highlight: true },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 12, unit: "minggu" },
          { kind: "number", label: "Shares", target: 500, unit: "share" },
          { kind: "number", label: "Saves", target: 500, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 150, unit: "DM" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 100, unit: "orang" },
          { kind: "number", label: "Post yang tampil di atas rata-rata akun", target: 10, unit: "post" },
          { kind: "check", label: "Engagement tetap sehat sepanjang periode", highlight: true },
        ],
      },
      {
        name: "Build Community", description: t("store.mission.gs3.desc"), tagline: t("store.mission.gs3.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 10000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 150, unit: "konten", highlight: true },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 16, unit: "minggu" },
          { kind: "number", label: "Shares", target: 1500, unit: "share" },
          { kind: "number", label: "Saves", target: 1500, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 300, unit: "DM" },
          { kind: "number", label: "Member komunitas", target: 300, unit: "member" },
          { kind: "number", label: "Member komunitas yang aktif", target: 100, unit: "member aktif" },
          { kind: "number", label: "UGC asli dari komunitas", target: 50, unit: "UGC", highlight: true },
          { kind: "number", label: "Community event / activation", target: 1, unit: "event" },
          { kind: "number", label: "Peserta event komunitas", target: 50, unit: "peserta" },
          { kind: "number", label: "Kolaborasi bermakna", target: 5, unit: "kolaborasi" },
        ],
      },
      {
        name: "Activate Community", description: t("store.mission.gs4.desc"), tagline: t("store.mission.gs4.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 25000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 250, unit: "konten", highlight: true },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 20, unit: "minggu" },
          { kind: "number", label: "Shares", target: 5000, unit: "share" },
          { kind: "number", label: "Saves", target: 5000, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 750, unit: "DM" },
          { kind: "number", label: "Member komunitas", target: 1000, unit: "member" },
          { kind: "number", label: "Member komunitas yang aktif", target: 200, unit: "member aktif" },
          { kind: "number", label: "Brand advocates", target: 20, unit: "advocate", highlight: true },
          { kind: "number", label: "UGC asli dari komunitas", target: 150, unit: "UGC" },
          { kind: "number", label: "Community activations", target: 3, unit: "activation" },
          { kind: "number", label: "Total peserta kumulatif", target: 300, unit: "peserta" },
          { kind: "number", label: "Kolaborasi strategis", target: 10, unit: "kolaborasi" },
          { kind: "number", label: "Qualified leads", target: 50, unit: "leads", highlight: true },
        ],
      },
      {
        name: "Build Advocacy", description: t("store.mission.gs5.desc"), tagline: t("store.mission.gs5.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 50000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 400, unit: "konten", highlight: true },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 24, unit: "minggu" },
          { kind: "number", label: "Shares", target: 15000, unit: "share" },
          { kind: "number", label: "Saves", target: 15000, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 1500, unit: "DM" },
          { kind: "number", label: "Member komunitas", target: 3000, unit: "member" },
          { kind: "number", label: "Member komunitas yang aktif", target: 500, unit: "member aktif" },
          { kind: "number", label: "Brand advocates", target: 100, unit: "advocate", highlight: true },
          { kind: "number", label: "UGC asli dari komunitas", target: 300, unit: "UGC" },
          { kind: "number", label: "Community activations", target: 10, unit: "activation" },
          { kind: "number", label: "Total peserta kumulatif", target: 1000, unit: "peserta" },
          { kind: "number", label: "Kolaborasi strategis", target: 20, unit: "kolaborasi" },
          { kind: "number", label: "Qualified leads", target: 100, unit: "leads" },
          { kind: "number", label: "Community-led activation (komunitas yang gerakin sendiri)", target: 1, unit: "activation", highlight: true },
        ],
      },
    ],
  },
  "grow-personal": {
    autoLinkAllContent: true,
    // A scroll-to-read, check-to-agree gate shown once before the first
    // mission — same idea as a real app's Terms & Conditions screen. Only
    // rendered when a ladder declares `terms`; MISSION_LADDERS entries
    // without it (grow-social, event) skip straight to calibration.
    terms: {
      intro: t("store.ladder.growPersonal.termsIntro"),
      rules: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ title: t(`store.terms.gp.${n}.title`), body: t(`store.terms.gp.${n}.body`) })),
    },
    calibration: {
      question: t("store.ladder.growPersonal.question"),
      skipNote: t("store.ladder.skipNote"),
    },
    progressionNote: t("store.ladder.growPersonal.progression"),
    missions: () => [
      {
        name: "Find Your Voice", description: t("store.mission.gp1.desc"), tagline: t("store.mission.gp1.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 1000, unit: "followers" },
          { kind: "auto", label: "Konten orisinal terbit", target: 20, unit: "konten" },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 8, unit: "minggu" },
          { kind: "number", label: "Komentar bermakna", target: 100, unit: "komentar" },
          { kind: "number", label: "DM bermakna", target: 50, unit: "DM" },
          { kind: "number", label: "Shares", target: 100, unit: "share" },
          { kind: "number", label: "Saves", target: 100, unit: "save" },
          { kind: "number", label: "Konten tembus 5K+ views", target: 5, unit: "konten" },
          { kind: "check", label: "Niche/keahlian/positioning yang jelas" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 20, unit: "orang" },
        ],
      },
      {
        name: "Build Credibility", description: t("store.mission.gp2.desc"), tagline: t("store.mission.gp2.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 3000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 100, unit: "konten" },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 12, unit: "minggu" },
          { kind: "number", label: "Komentar bermakna", target: 300, unit: "komentar" },
          { kind: "number", label: "DM bermakna", target: 150, unit: "DM" },
          { kind: "number", label: "Shares", target: 500, unit: "share" },
          { kind: "number", label: "Saves", target: 500, unit: "save" },
          { kind: "number", label: "Konten performa tinggi", target: 10, unit: "konten" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 100, unit: "orang" },
          { kind: "number", label: "Kolaborasi bermakna", target: 3, unit: "kolaborasi" },
          { kind: "number", label: "Kemunculan eksternal (podcast/webinar/event/dll)", target: 1, unit: "kemunculan" },
        ],
      },
      {
        name: "Become an Authority", description: t("store.mission.gp3.desc"), tagline: t("store.mission.gp3.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 10000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 200, unit: "konten" },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 16, unit: "minggu" },
          { kind: "number", label: "Komentar bermakna", target: 750, unit: "komentar" },
          { kind: "number", label: "DM bermakna", target: 300, unit: "DM" },
          { kind: "number", label: "Shares", target: 1500, unit: "share" },
          { kind: "number", label: "Saves", target: 1500, unit: "save" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 200, unit: "orang" },
          { kind: "number", label: "Kolaborasi bermakna", target: 10, unit: "kolaborasi" },
          { kind: "number", label: "Kemunculan eksternal (podcast/webinar/event/dll)", target: 5, unit: "kemunculan" },
          { kind: "number", label: "Inbound opportunities/inquiries", target: 50, unit: "peluang" },
          { kind: "number", label: "Audience-generated content/mention/diskusi", target: 50, unit: "mention" },
        ],
      },
      {
        name: "Lead the Conversation", description: t("store.mission.gp4.desc"), tagline: t("store.mission.gp4.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 25000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 300, unit: "konten" },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 20, unit: "minggu" },
          { kind: "number", label: "Komentar bermakna", target: 2000, unit: "komentar" },
          { kind: "number", label: "DM bermakna", target: 750, unit: "DM" },
          { kind: "number", label: "Shares", target: 5000, unit: "share" },
          { kind: "number", label: "Saves", target: 5000, unit: "save" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 500, unit: "orang" },
          { kind: "number", label: "Kolaborasi strategis", target: 20, unit: "kolaborasi" },
          { kind: "number", label: "Kemunculan eksternal (podcast/webinar/event/dll)", target: 10, unit: "kemunculan" },
          { kind: "number", label: "Qualified inbound opportunities", target: 100, unit: "peluang" },
          { kind: "number", label: "Mention/UGC organik", target: 100, unit: "mention" },
          { kind: "check", label: "Signature content series/framework/IP" },
          { kind: "check", label: "Komunitas/event/workshop/inisiatif yang kamu pimpin" },
        ],
      },
      {
        name: "Become a Recognized Voice", description: t("store.mission.gp5.desc"), tagline: t("store.mission.gp5.tagline"),
        milestones: [
          { kind: "number", label: "Followers", target: 50000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 500, unit: "konten" },
          { kind: "auto-weeks", label: "Minggu aktif konsisten", target: 24, unit: "minggu" },
          { kind: "number", label: "Komentar bermakna", target: 5000, unit: "komentar" },
          { kind: "number", label: "DM bermakna", target: 1500, unit: "DM" },
          { kind: "number", label: "Shares", target: 15000, unit: "share" },
          { kind: "number", label: "Saves", target: 15000, unit: "save" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 1000, unit: "orang" },
          { kind: "number", label: "Kolaborasi strategis", target: 30, unit: "kolaborasi" },
          { kind: "number", label: "Kemunculan eksternal (podcast/webinar/event/dll)", target: 20, unit: "kemunculan" },
          { kind: "number", label: "Qualified inbound opportunities", target: 200, unit: "peluang" },
          { kind: "number", label: "Mention/UGC organik", target: 250, unit: "mention" },
          { kind: "check", label: "Personal framework/IP yang dikenali" },
          { kind: "check", label: "Komunitas atau ekosistem aktif" },
          { kind: "check", label: "Dampak profesional yang terbukti" },
        ],
      },
    ],
  },
  // "event" used to live here too, but its real shape (role-branching setup,
  // date-anchored non-blocking phases, dynamic targets) doesn't fit this
  // fixed-ladder/soft-lock contract at all — it's EVENT_PLAN_CONFIG below,
  // a parallel system with its own campaign.eventPlan data shape instead of
  // campaign.missions.
};

// Turns a MISSION_LADDERS entry into real, saveable mission objects with
// generated ids — called once at campaign creation (openNewCampaignFlow),
// never re-derived, so editing a milestone later never gets silently
// overwritten by a ladder change. `tier` (a calibration.tiers[].id) decides
// a starting rung via that tier's `startIndex` — missions below it are
// marked already-complete instead of making someone re-prove ground
// they've already covered before this campaign existed.
// Each level's minimum active period, in weeks — the same numbers the
// ladder's progressionNote states. Used to scale the "konten terbit"
// targets to the cadence the brand actually committed to in "Atur Jadwal
// Kerja" (uploads/week × minimum weeks), so a 3-posts-a-week café isn't
// handed the same 50-piece Level 1 as a daily-posting media brand.
export const MISSION_MIN_WEEKS = [8, 12, 16, 20, 24];

export function createMissionsForTemplate(templateId, { startIndex = 0, uploadsPerWeek = null, currentFollowers = null } = {}) {
  const ladder = MISSION_LADDERS[templateId];
  if (!ladder) return undefined;
  const scaledContentTarget = (ms, i) => {
    if (ms.kind !== "auto" || !uploadsPerWeek) return ms.target ?? null;
    return Math.max(8, Math.round(uploadsPerWeek * (MISSION_MIN_WEEKS[i] || 8)));
  };
  // #7: the mission the account actually starts on (startIndex) keeps its
  // rung — Tahap 1 stays Tahap 1 — but if the brand already has more
  // followers than that rung's flat catalog target, the target is raised to
  // match reality instead of asking them to "reach" a number they're
  // already past.
  const resolvedTarget = (ms, i) => {
    if (ms.label === "Followers" && i === startIndex && currentFollowers !== null && ms.target != null) {
      return Math.max(ms.target, currentFollowers);
    }
    return scaledContentTarget(ms, i);
  };
  return ladder.missions().map((m, i) => ({
    id: uid(),
    name: m.name,
    description: m.description,
    tagline: m.tagline || "",
    completedAt: i < startIndex ? Date.now() : null,
    // Firestore's setDoc rejects `undefined` anywhere in the document, so
    // every field is always present with a concrete value (null where a
    // kind genuinely has none) rather than only set conditionally.
    milestones: m.milestones.map((ms) => ({
      id: uid(),
      kind: ms.kind,
      phaseId: ms.phaseId || null,
      label: ms.label,
      description: ms.description || milestoneDescriptionSource(ms.label),
      unit: ms.unit || "",
      target: resolvedTarget(ms, i),
      threshold: ms.threshold ?? null,
      highlight: !!ms.highlight,
      custom: false,
      value: null,
      done: false,
    })),
  }));
}

export function consecutiveActiveWeeks(content, offsetDays = 0) {
  const DAY = 86400000;
  const days = content
    .filter((c) => c.status === "published" && c.publishedDate)
    .map((c) => Math.floor(new Date(c.publishedDate + "T12:00:00").getTime() / DAY))
    .filter((d) => Number.isFinite(d));
  if (!days.length) return 0;
  // offsetDays > 0 asks "what would the streak be N days from now if
  // nothing new gets published" — see streakBreakInDays.
  const today = Math.floor(Date.now() / DAY) + offsetDays;
  let weeks = 0;
  // Week 0 = the last 7 days including today, week 1 = the 7 before, ...
  // Keep counting while each successive window has at least one publish.
  for (let w = 0; w < 260; w++) {
    const end = today - w * 7;
    const start = end - 6;
    if (!days.some((d) => d >= start && d <= end)) break;
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
      dateTo = addDays(eventDate, Math.min(0, Math.round(p.offsetTo * factor)));
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
      dateFrom = p.offsetFrom === null ? start : addDays(eventDate, p.offsetFrom);
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
  persist(() => setDoc(doc(fdb, "campaigns", item.id), item));
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
  return updateCampaign(campaignId, { missions });
}
export function deleteCampaign(id) {
  db.campaigns = (db.campaigns || []).filter((c) => c.id !== id);
  const affectedContentIds = db.content.filter((c) => c.campaignId === id).map((c) => c.id);
  db.content.forEach((c) => { if (c.campaignId === id) { c.campaignId = ""; c.campaignPhaseId = ""; } });
  persist(async () => {
    await deleteDoc(doc(fdb, "campaigns", id));
    await Promise.all(affectedContentIds.map((cid) => setDoc(doc(fdb, "content", cid), getContent(cid))));
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
export function listSeries(brandId) {
  return (db.series || [])
    .filter((s) => s.brandId === brandId)
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
  persist(() => setDoc(doc(fdb, "series", item.id), item));
  return item;
}
export function deleteSeries(id) {
  db.series = (db.series || []).filter((s) => s.id !== id);
  // Content linked to a deleted series keeps its script/history, it just
  // stops reading that series' context on future regenerations — same
  // unlink-not-delete behavior as deleteCampaign above.
  const affectedContentIds = db.content.filter((c) => c.seriesId === id).map((c) => c.id);
  db.content.forEach((c) => { if (c.seriesId === id) c.seriesId = ""; });
  persist(async () => {
    await deleteDoc(doc(fdb, "series", id));
    await Promise.all(affectedContentIds.map((cid) => setDoc(doc(fdb, "content", cid), getContent(cid))));
  });
}

// ---------- Settings ----------
export function getSettings() {
  return db.settings;
}
function persistSettings() {
  // db.settings.ai may carry the shared settings/main keys merged in —
  // write back only this account's own ai block so the shared keys never
  // get duplicated into a per-account doc.
  persist(() => setDoc(doc(fdb, "settings", ownerUid), { ...db.settings, ai: personalAi || db.settings.ai }));
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
  personalAi = { ...(personalAi || db.settings.ai), ...patch };
  db.settings.ai = isGlobalAiActive() ? { ...personalAi, ...globalAi } : personalAi;
  persistSettings();
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
export const ROUTINE_DAY_LABELS = Object.fromEntries(ROUTINE_DAYS.map((d) => [d, t(`store.day.${d}`)]));
export const ROUTINE_ACTIVITIES = ["shooting", "editing", "upload", "custom"];
export const ROUTINE_ACTIVITY_LABELS = Object.fromEntries(ROUTINE_ACTIVITIES.map((a) => [a, t(`store.activity.${a}`)]));

export function listRoutineTemplate() {
  return db.routineTemplate || [];
}
export function addRoutineItem({ brandId, day, activity, customLabel = "", time = "", source = "manual" }) {
  const item = { id: uid(), ownerId: ownerUid, brandId, day, activity, customLabel: customLabel.trim(), time, doneDates: [], source };
  db.routineTemplate = [...(db.routineTemplate || []), item];
  persist(() => setDoc(doc(fdb, "routineTemplate", item.id), item));
  return item;
}
export function removeRoutineItem(id) {
  db.routineTemplate = (db.routineTemplate || []).filter((t) => t.id !== id);
  persist(() => deleteDoc(doc(fdb, "routineTemplate", id)));
}

// Content OS's cadence setup (Shoot/Edit/Upload days) IS this brand's My
// Routine for those three activities — saving the setup regenerates exactly
// those entries so the two are never out of sync. Only ever touches entries
// this same sync created before (source:"cadence"); anything someone added
// by hand in My Routine (source:"manual", or undefined from before this
// existed) is left alone no matter how the setup is re-saved.
export function syncCadenceRoutine(brandId, cadence) {
  const untouched = (db.routineTemplate || []).filter((t) => !(t.brandId === brandId && t.source === "cadence"));
  const fresh = [];
  const addDays = (days, activity) => {
    (days || []).forEach((day) => fresh.push({ id: uid(), ownerId: ownerUid, brandId, day, activity, customLabel: "", time: "", doneDates: [], source: "cadence" }));
  };
  addDays(cadence.shootDays, "shooting");
  addDays(cadence.editDays, "editing");
  addDays(cadence.uploadDays, "upload");

  const removedIds = (db.routineTemplate || [])
    .filter((t) => t.brandId === brandId && t.source === "cadence")
    .map((t) => t.id);
  db.routineTemplate = [...untouched, ...fresh];
  persist(() =>
    commitInChunks([
      ...removedIds.map((id) => ({ type: "delete", ref: doc(fdb, "routineTemplate", id) })),
      ...fresh.map((item) => ({ type: "set", ref: doc(fdb, "routineTemplate", item.id), data: item })),
    ])
  );
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
  // Stamp ownerId on every imported doc regardless of what the backup file
  // says — otherwise an imported doc with no/stale ownerId would be
  // invisible to this account's own filtered queries (or worse, rejected
  // outright by firestore.rules) right after import.
  next.brands = (next.brands || []).map((b) => ({ ...b, ownerId: ownerUid }));
  next.content = (next.content || []).map((c) => ({ ...c, ownerId: ownerUid }));
  next.campaigns = (next.campaigns || []).map((c) => ({ ...c, ownerId: ownerUid }));
  next.routineTemplate = (next.routineTemplate || []).map((r) => ({ ...r, ownerId: ownerUid }));
  next.brainstorms = (next.brainstorms || []).map((b) => ({ ...b, ownerId: ownerUid }));
  await commitInChunks([
    ...next.brands.map((b) => ({ type: "set", ref: doc(fdb, "brands", b.id), data: b })),
    ...next.content.map((c) => ({ type: "set", ref: doc(fdb, "content", c.id), data: c })),
    ...next.campaigns.map((c) => ({ type: "set", ref: doc(fdb, "campaigns", c.id), data: c })),
    ...next.routineTemplate.map((r) => ({ type: "set", ref: doc(fdb, "routineTemplate", r.id), data: r })),
    ...next.brainstorms.map((b) => ({ type: "set", ref: doc(fdb, "brainstorms", b.id), data: b })),
    { type: "set", ref: doc(fdb, "settings", ownerUid), data: next.settings },
  ]);
  db = next;
  window.dispatchEvent(new CustomEvent("db:change"));
}
export function resetAll() {
  const brandIds = db.brands.map((b) => b.id);
  const contentIds = db.content.map((c) => c.id);
  const campaignIds = (db.campaigns || []).map((c) => c.id);
  const routineIds = (db.routineTemplate || []).map((r) => r.id);
  db = defaultDB();
  persist(() => commitInChunks([
    ...brandIds.map((id) => ({ type: "delete", ref: doc(fdb, "brands", id) })),
    ...contentIds.map((id) => ({ type: "delete", ref: doc(fdb, "content", id) })),
    ...campaignIds.map((id) => ({ type: "delete", ref: doc(fdb, "campaigns", id) })),
    ...routineIds.map((id) => ({ type: "delete", ref: doc(fdb, "routineTemplate", id) })),
    { type: "set", ref: doc(fdb, "settings", ownerUid), data: db.settings },
  ]));
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
  setDoc(doc(fdb, "aiFeedback", id), item).catch((e) => console.error("AI feedback save failed", e));
  return id;
}
