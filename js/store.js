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

export const CAMPAIGN_OBJECTIVES = ["personal-branding", "awareness", "launch", "sales", "event", "engagement", "community", "custom"];
export const CAMPAIGN_OBJECTIVE_LABELS = {
  "personal-branding": "Personal Branding",
  awareness: "Awareness", launch: "Product Launch", sales: "Sales", event: "Event",
  engagement: "Engagement", community: "Community", custom: "Custom",
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
export const CAMPAIGN_STATUS_LABELS = { planning: "Planning", active: "Active", completed: "Completed", archived: "Archived" };

function defaultBrandDNA() {
  return {
    tagline: "", oneLiner: "", purpose: "", vision: "", mission: "",
    targetAudience: "", problemSolved: "", positioning: "", differentiation: "",
    // StoryBrand-style narrative fields — what the customer gets if they say
    // yes (the win) and what they're risking if they don't (the stakes).
    callToAction: "", successOutcome: "", failureOutcome: "",
    personality: [], values: [], productsServices: [],
  };
}

function defaultBrandGuidelines() {
  return {
    logo: { hasLogo: null, dataUrl: "" },
    colorFeelings: [],
    colorFormula: "",
    colors: { primary: "", secondary: "", accent: "", background: "", text: "" },
    typographyFeelings: [],
    fonts: { primary: "", secondary: "", accent: "" },
    visualDirection: [],
    applications: [],
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
function defaultBrandBuilder() {
  return {
    stage: "foundation",
    completedStages: [],
    personality: { feeling: "", primary: [], secondary: [], avoid: [], source: "" },
    // 4 slider positions (0-100) across the e-book's Tone of Voice spectrums
    // — see TONE_AXES in brandbook-data.js. 50 = dead center on every axis
    // until the user actually moves one.
    toneOfVoice: { formal: 50, language: 50, character: 50, emotion: 50, avoidWords: [], source: "" },
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
      // Global, not per-brand — one shared Anthropic/Gemini/DeepSeek key
      // drives AI Script & Hook Generation for every brand and every
      // teammate, same as the app's other credentials (stored in Firestore,
      // used directly from the browser).
      ai: { provider: "anthropic", anthropicApiKey: "", geminiApiKey: "", deepseekApiKey: "" },
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
    const ready = { brands: false, content: false, campaigns: false, routineTemplate: false, settings: false };
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

    onSnapshot(collection(fdb, "campaigns"), (snap) => {
      db.campaigns = snap.docs.map((d) => d.data());
      ready.campaigns = true;
      checkReady();
      window.dispatchEvent(new CustomEvent("db:change"));
    }, onErr("campaigns"));

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
    id: uid(), name: name.trim(), avatar,
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
export function archiveBrand(id, archived = true) {
  return updateBrand(id, { archived });
}
export function deleteBrand(id) {
  const removedContentIds = db.content.filter((c) => c.brandId === id).map((c) => c.id);
  const removedCampaignIds = (db.campaigns || []).filter((c) => c.brandId === id).map((c) => c.id);
  db.brands = db.brands.filter((b) => b.id !== id);
  db.content = db.content.filter((c) => c.brandId !== id);
  db.campaigns = (db.campaigns || []).filter((c) => c.brandId !== id);
  persist(async () => {
    await deleteDoc(doc(fdb, "brands", id));
    await Promise.all(removedContentIds.map((cid) => deleteDoc(doc(fdb, "content", cid))));
    await Promise.all(removedCampaignIds.map((cid) => deleteDoc(doc(fdb, "campaigns", cid))));
  });
}

// ---------- Content ----------
function emptyContent(brandId) {
  return {
    id: uid(),
    brandId,
    campaignId: "",
    campaignPhaseId: "",
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
  { name: "Awareness", description: "Membuat audiens baru sadar brand kamu ada — biasanya lewat konten organik atau ads yang menarik perhatian.", optional: false },
  { name: "Website", description: "Mengarahkan audiens ke website untuk info lebih lengkap dan membangun kepercayaan.", optional: true },
  { name: "WhatsApp", description: "Percakapan langsung dengan calon pelanggan — tempat pertanyaan dijawab dan closing terjadi.", optional: false },
  { name: "Event", description: "Pertemuan langsung (online/offline) yang mempererat hubungan dan mendorong keputusan.", optional: true },
  { name: "UGC", description: "Konten buatan pelanggan sendiri — bukti sosial yang lebih dipercaya dibanding promosi brand.", optional: false },
  { name: "Community", description: "Ruang berkumpul untuk pelanggan, memperkuat loyalitas jangka panjang.", optional: true },
  { name: "Retargeting", description: "Menjangkau ulang orang yang sudah pernah berinteraksi tapi belum konversi.", optional: false },
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
const MILESTONE_DESCRIPTIONS = {
  "Followers": "Total followers akun ini sekarang — cek langsung dari profil platform utama kamu.",
  "Konten orisinal terbit": "Jumlah konten asli yang udah kamu terbitkan sejak campaign ini mulai — dihitung otomatis dari Content OS, nggak perlu diisi manual.",
  "Konten kumulatif": "Total konten asli sejak campaign ini mulai — dihitung otomatis dari Content OS, nggak perlu diisi manual.",
  "Minggu aktif konsisten": "Berapa minggu berturut-turut kamu tetap posting — jangan sampai vakum lebih dari 14 hari.",
  "Engagement bermakna total": "Total interaksi asli (like, komentar, share, save, DM) dari orang beneran — bukan bot atau engagement pod.",
  "Shares": "Berapa kali kontenmu di-share/repost orang lain — sinyal paling kuat kalau kontenmu worth di-pass ke orang lain.",
  "Saves": "Berapa kali orang nyimpen kontenmu — biasanya nandain konten itu genuinely berguna, bukan cuma lucu sekilas.",
  "DM bermakna": "Pesan langsung dari orang yang beneran nanya, curhat, atau nawarin sesuatu — bukan spam atau pesan template.",
  "Komentar bermakna": "Komentar yang isinya beneran nanggepin konten kamu — bukan cuma emoji atau \"nice post\".",
  "Video dengan engagement rate di atas 10%": "Video yang engagement rate-nya (like+komen+share dibagi reach) tembus 10%+ — tanda kontennya resonate kuat.",
  "Engagement rate sehat dibanding rata-rata platform": "Bandingin engagement rate akun kamu sama rata-rata di platform itu — jangan cuma followers yang naik tapi engagement-nya malah turun.",
  "Engagement tetap sehat sepanjang periode": "Engagement rate-nya nggak boleh jatuh biarpun followers naik — kualitas harus ikut naik, bukan cuma kuantitas.",
  "Orang yang balik lagi engage (recurring engagers)": "Orang yang engage ke lebih dari satu konten kamu — nunjukkin mereka beneran ngikutin, bukan cuma numpang lewat.",
  "Post yang tampil di atas rata-rata akun": "Konten yang hasilnya jauh di atas rata-rata konten kamu yang lain — biasanya nandain kamu nemu \"format yang kena\".",
  "Member komunitas": "Orang yang gabung ke ruang komunitas kamu (grup WA, Discord, Circle, dll) — bukan cuma follow doang.",
  "Member komunitas yang aktif": "Dari member yang ada, berapa yang beneran aktif — nge-chat, komentar, dateng ke acara.",
  "UGC asli dari komunitas": "Konten yang dibikin sendiri sama audiens/komunitas kamu — bukti sosial paling kuat karena bukan kamu yang ngomong sendiri.",
  "Community event / activation": "Acara atau aktivasi yang kamu bikin khusus buat komunitas — offline atau online.",
  "Peserta event komunitas": "Berapa orang yang beneran dateng/ikut acara komunitas kamu.",
  "Kolaborasi bermakna": "Kerja bareng brand/kreator lain yang beneran nambah value — bukan cuma saling follow.",
  "Brand advocates": "Orang yang aktif promosiin brand kamu tanpa diminta atau dibayar — followers paling loyal.",
  "Community activations": "Aktivasi/acara yang kamu bikin buat komunitas — dihitung berapa kali, bukan cuma sekali terus berhenti.",
  "Total peserta kumulatif": "Total orang yang pernah ikut semua aktivasi komunitas kamu, dijumlahin dari awal campaign.",
  "Kolaborasi strategis": "Kolaborasi yang dipilih sengaja buat nyampein ke audiens baru atau nguatin posisi brand/personal brand kamu.",
  "Qualified leads": "Orang yang nunjukkin minat serius buat beli/pakai produk kamu — bukan cuma nanya-nanya doang.",
  "Community-led activation (komunitas yang gerakin sendiri)": "Momen dimana komunitas kamu yang inisiatif bikin sesuatu sendiri, tanpa kamu yang mulai duluan — tanda komunitasnya udah hidup sendiri.",
  "Niche/keahlian/positioning yang jelas": "Orang bisa jelasin dalam satu kalimat kamu ahlinya di bidang apa — kalau belum jelas, orang gampang lupa kamu.",
  "Konten tembus 5K+ views": "Konten yang reach-nya jauh di atas biasanya — bukti formatnya nemu momentum.",
  "Konten performa tinggi": "Konten yang hasilnya jauh di atas rata-rata konten kamu yang lain — biasanya nandain kamu nemu \"format yang kena\".",
  "Kemunculan eksternal (podcast/webinar/event/dll)": "Muncul di platform orang lain — jadi bintang tamu podcast, ngisi webinar, jadi pembicara, dll — bukti orang lain juga percaya kamu.",
  "Inbound opportunities/inquiries": "Peluang yang datang ke kamu duluan (tawaran kerja sama, job, project) — bukan kamu yang ngejar.",
  "Audience-generated content/mention/diskusi": "Orang lain nulis/ngomongin kamu tanpa diminta — tag, repost, atau nyebut nama kamu di diskusi mereka sendiri.",
  "Qualified inbound opportunities": "Peluang masuk yang levelnya makin besar/strategis — bukan sekadar tanya-tanya.",
  "Mention/UGC organik": "Orang nyebut atau bikin konten soal kamu tanpa kamu minta — sinyal reputasi udah nyebar sendiri.",
  "Signature content series/framework/IP": "Kamu punya \"ciri khas\" — format konten, kerangka berpikir, atau istilah yang orang asosiasikan sama kamu.",
  "Komunitas/event/workshop/inisiatif yang kamu pimpin": "Kamu yang mulai dan mimpin sendiri — bukan cuma ikut acara orang lain.",
  "Personal framework/IP yang dikenali": "Kerangka atau metode yang kamu ciptain dan udah dikenal luas orang di niche kamu.",
  "Komunitas atau ekosistem aktif": "Ruang yang kamu bangun dan masih hidup/aktif dengan sendirinya.",
  "Dampak profesional yang terbukti": "Bisnis, karier, partnership, atau kesempatan nyata yang lahir karena personal brand kamu — bukan cuma angka di layar.",
  "Acara terlaksana": "Centang setelah acaranya beneran jalan — dokumentasinya bisa dipakai sebagai bukti.",
};

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
      question: "Kamu (atau brand ini) udah pernah jalanin proses growth kaya gini sebelumnya?",
      skipNote: "Kalau ragu, tetap disarankan mulai dari Level 1 — progress di level awal jadi fondasi buat level berikutnya. Kamu selalu bisa balik ke mission manapun nanti.",
    },
    // The framework itself: numbers are cumulative (total to date, not a
    // monthly delta) but quality/consistency must hold throughout — a viral
    // spike or bought engagement can't be used to skip a level.
    progressionNote:
      "Angka di tiap level itu kumulatif (total sejak awal), bukan target bulanan — tapi kualitas & konsistensi engagement harus tetap terjaga sepanjang periode. Lonjakan viral, followers, atau engagement yang dibeli nggak bisa dipakai buat lompat level (followers beli tetap dihitung mulai dari kisaran di bawah 1.000). Minimal aktif: Level 1 → 8 minggu, Level 2 → 12 minggu, Level 3 → 16 minggu, Level 4 → 20 minggu, Level 5 → 24 minggu. Maksimal vakum 14 hari berturut-turut.",
    missions: () => [
      {
        name: "Get Discovered", description: "Buktikan brand kamu bisa narik perhatian secara organik.", tagline: "Bisa narik perhatian?",
        milestones: [
          { kind: "number", label: "Followers", target: 1000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten orisinal terbit", target: 50, unit: "konten", highlight: true },
          { kind: "number", label: "Minggu aktif konsisten", target: 8, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 1000, unit: "engagement", highlight: true },
          { kind: "number", label: "Shares", target: 150, unit: "share" },
          { kind: "number", label: "Saves", target: 150, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 50, unit: "DM" },
          { kind: "auto-er-count", label: "Video dengan engagement rate di atas 10%", target: 5, unit: "video", threshold: 10 },
          { kind: "check", label: "Engagement rate sehat dibanding rata-rata platform", highlight: true },
        ],
      },
      {
        name: "Build Trust", description: "Ubah perhatian jadi hubungan yang beneran — bukan cuma angka.", tagline: "Bisa bikin orang peduli?",
        milestones: [
          { kind: "number", label: "Followers", target: 3000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 100, unit: "konten", highlight: true },
          { kind: "number", label: "Minggu aktif konsisten", target: 12, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 3000, unit: "engagement", highlight: true },
          { kind: "number", label: "Shares", target: 500, unit: "share" },
          { kind: "number", label: "Saves", target: 500, unit: "save" },
          { kind: "number", label: "DM bermakna", target: 150, unit: "DM" },
          { kind: "number", label: "Orang yang balik lagi engage (recurring engagers)", target: 100, unit: "orang" },
          { kind: "number", label: "Post yang tampil di atas rata-rata akun", target: 10, unit: "post" },
          { kind: "check", label: "Engagement tetap sehat sepanjang periode", highlight: true },
        ],
      },
      {
        name: "Build Community", description: "Ubah followers jadi orang yang aktif ikut serta.", tagline: "Bisa bikin orang betah?",
        milestones: [
          { kind: "number", label: "Followers", target: 10000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 150, unit: "konten", highlight: true },
          { kind: "number", label: "Minggu aktif konsisten", target: 16, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 10000, unit: "engagement", highlight: true },
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
        name: "Activate Community", description: "Bikin komunitas kamu ikut nyumbang ke growth brand.", tagline: "Bisa bikin orang ikut serta?",
        milestones: [
          { kind: "number", label: "Followers", target: 25000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 250, unit: "konten", highlight: true },
          { kind: "number", label: "Minggu aktif konsisten", target: 20, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 30000, unit: "engagement", highlight: true },
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
        name: "Build Advocacy", description: "Bangun komunitas yang bisa aktif gerakin brand kamu sendiri.", tagline: "Orang lain bisa bantu brand kamu?",
        milestones: [
          { kind: "number", label: "Followers", target: 50000, unit: "followers", highlight: true },
          { kind: "auto", label: "Konten kumulatif", target: 400, unit: "konten", highlight: true },
          { kind: "number", label: "Minggu aktif konsisten", target: 24, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 75000, unit: "engagement", highlight: true },
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
      intro: "Sebelum mulai, baca dan setujui aturan main campaign ini dulu.",
      rules: [
        { title: "Keaslian Dulu", body: "Personal branding harus merepresentasikan orang asli — keahlian, pengalaman, opini, dan values kamu yang beneran, bukan karakter fiktif." },
        { title: "Growth Organik Aja", body: "Beli followers, likes, komentar, views, akun palsu, bot, engagement pod, follow-for-follow, atau cara growth artifisial lainnya nggak boleh." },
        { title: "Harus Konsisten", body: "Growth harus kebukti sepanjang waktu. Maksimal vakum 14 hari berturut-turut." },
        { title: "Konten yang Ada Value-nya", body: "Konten harus kasih value asli — lewat ilmu, pengalaman, sudut pandang, edukasi, cerita, atau insight yang berguna. Promosi diri doang nggak dihitung sebagai konten thought-leadership." },
        { title: "Kualitas di Atas Jumlah Followers", body: "Followers doang nggak nentuin kamu naik level. Otoritas, kualitas engagement, percakapan, pertumbuhan network, dan peluang juga harus ikut naik." },
        { title: "Nggak Boleh Otoritas Palsu", body: "Nggak boleh ngarang kredensial, pencapaian, testimoni, klien, keahlian, atau pengalaman profesional." },
        { title: "Perlu Bukti", body: "Kamu mungkin diminta nunjukkin analytics, link konten, catatan kolaborasi, catatan event, atau bukti lain." },
        { title: "Semua Milestone Wajib", body: "Nyampe target followers doang nggak otomatis buka level berikutnya — semua milestone di level itu harus kelar dulu." },
      ],
    },
    calibration: {
      question: "Kamu udah pernah jalanin proses bangun personal branding kaya gini sebelumnya?",
      skipNote: "Kalau ragu, tetap disarankan mulai dari Level 1 — progress di level awal jadi fondasi buat level berikutnya. Kamu selalu bisa balik ke mission manapun nanti.",
    },
    progressionNote:
      "Tujuannya bukan cuma \"nambah followers\" — tapi Visibility → Credibility → Authority → Influence → Opportunity. Personal brand dianggap berhasil kalau perhatian berubah jadi kepercayaan, hubungan, pengaruh, dan peluang nyata. Angka tiap level kumulatif (total sejak awal). Minimal aktif: Level 1 → 8 minggu, Level 2 → 12 minggu, Level 3 → 16 minggu, Level 4 → 20 minggu, Level 5 → 24 minggu. Maksimal vakum 14 hari berturut-turut — lonjakan viral sesaat nggak dihitung sebagai growth yang berkelanjutan.",
    missions: () => [
      {
        name: "Find Your Voice", description: "Bangun kehadiran personal yang dikenali.", tagline: "Orang-orang nemuin kamu.",
        milestones: [
          { kind: "number", label: "Followers", target: 1000, unit: "followers" },
          { kind: "auto", label: "Konten orisinal terbit", target: 20, unit: "konten" },
          { kind: "number", label: "Minggu aktif konsisten", target: 8, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 1500, unit: "engagement" },
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
        name: "Build Credibility", description: "Dikenal buat topik atau keahlian tertentu.", tagline: "Orang-orang ngerti apa yang kamu tahu.",
        milestones: [
          { kind: "number", label: "Followers", target: 3000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 100, unit: "konten" },
          { kind: "number", label: "Minggu aktif konsisten", target: 12, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 5000, unit: "engagement" },
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
        name: "Become an Authority", description: "Bangun otoritas yang dikenali di niche kamu.", tagline: "Orang-orang percaya keahlian kamu.",
        milestones: [
          { kind: "number", label: "Followers", target: 10000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 200, unit: "konten" },
          { kind: "number", label: "Minggu aktif konsisten", target: 16, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 15000, unit: "engagement" },
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
        name: "Lead the Conversation", description: "Jadi orang yang idenya mempengaruhi percakapan di niche kamu.", tagline: "Orang-orang nyari perspektif kamu.",
        milestones: [
          { kind: "number", label: "Followers", target: 25000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 300, unit: "konten" },
          { kind: "number", label: "Minggu aktif konsisten", target: 20, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 40000, unit: "engagement" },
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
        name: "Become a Recognized Voice", description: "Bangun personal brand yang nyiptain pengaruh, peluang, dan ekosistem sekitar kamu.", tagline: "Orang-orang share, rekomendasiin, dan nyiptain peluang di sekitar nama kamu.",
        milestones: [
          { kind: "number", label: "Followers", target: 50000, unit: "followers" },
          { kind: "auto", label: "Konten kumulatif", target: 500, unit: "konten" },
          { kind: "number", label: "Minggu aktif konsisten", target: 24, unit: "minggu" },
          { kind: "number", label: "Engagement bermakna total", target: 100000, unit: "engagement" },
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
export function createMissionsForTemplate(templateId, { startIndex = 0 } = {}) {
  const ladder = MISSION_LADDERS[templateId];
  if (!ladder) return undefined;
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
      description: ms.description || MILESTONE_DESCRIPTIONS[ms.label] || "",
      unit: ms.unit || "",
      target: ms.target ?? null,
      threshold: ms.threshold ?? null,
      highlight: !!ms.highlight,
      custom: false,
      value: null,
      done: false,
    })),
  }));
}

// "logged" gates advancement — has this milestone been recorded at all.
// "metTarget" only drives the visual (full glow vs dim) — missing a target
// doesn't block you forever, it just shows. Number-kind milestones must
// have a real figure typed in before Next Mission, but hitting the target
// itself isn't a hard gate — you log what actually happened and decide to
// move on, same as real marketing reporting.
export function milestoneStatus(milestone, campaign, content) {
  if (milestone.kind === "auto") {
    // autoLinkAllContent campaigns (Grow Social Media) have no per-content
    // linking step at all — every piece of content the brand makes counts,
    // full stop, since the whole point of this campaign is total output.
    const current = campaign.autoLinkAllContent
      ? content.length
      : content.filter((c) => c.campaignId === campaign.id && c.campaignPhaseId === milestone.phaseId).length;
    return { current, logged: true, metTarget: current >= milestone.target };
  }
  if (milestone.kind === "check") {
    return { current: milestone.done ? 1 : 0, logged: !!milestone.done, metTarget: !!milestone.done };
  }
  if (milestone.kind === "auto-er-count") {
    // Real engagement-rate math lives in formulas.js, which this module
    // can't import without a cycle back here — the view layer
    // (campaigns.js) computes the real current/metTarget for display and
    // gating. This stub only needs to be safe: always "logged" so a
    // milestone this module can't evaluate never blocks mission advancement.
    return { current: 0, logged: true, metTarget: false };
  }
  const has = milestone.value !== null && milestone.value !== undefined && milestone.value !== "";
  return { current: has ? milestone.value : 0, logged: has, metTarget: has && milestone.value >= milestone.target };
}
export function missionCanAdvance(mission, campaign, content) {
  return mission.milestones.every((m) => milestoneStatus(m, campaign, content).logged);
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
  { id: "small", label: "Small", range: "< 100 orang", max: 100, mult: 0.4 },
  { id: "medium", label: "Medium", range: "100 – 500 orang", max: 500, mult: 1 },
  { id: "large", label: "Large", range: "500 – 2.000 orang", max: 2000, mult: 2.5 },
  { id: "major", label: "Major", range: "2.000+ orang", max: Infinity, mult: 6 },
];
export function eventScaleFor(expectedAudience) {
  const n = Number(expectedAudience) || 0;
  return EVENT_SCALE_TIERS.find((t) => n <= t.max) || EVENT_SCALE_TIERS[EVENT_SCALE_TIERS.length - 1];
}

export const EVENT_STATUS_LABELS = {
  not_started: "Belum Mulai",
  in_progress: "Berjalan",
  completed: "Selesai",
  partially_completed: "Sebagian Selesai",
  missed: "Terlewat",
  not_applicable: "Nggak Relevan",
};

export const EVENT_ROLES = [
  { id: "organizer", label: "Event Organizer / Event Owner", description: "Saya membuat atau menyelenggarakan event sendiri." },
  { id: "tenant", label: "Tenant / Booth", description: "Saya membuka tenant, booth, atau berjualan di event milik pihak lain." },
  { id: "participant", label: "Event Participant / Brand Participant", description: "Saya jadi bagian dari sebuah event — sponsor, speaker, performer, partner, exhibitor, komunitas, dll." },
];

export const EVENT_PARTICIPATION_TYPES = [
  { id: "speaker", label: "Speaker" },
  { id: "sponsor", label: "Sponsor" },
  { id: "performer", label: "Performer" },
  { id: "community-partner", label: "Community Partner" },
  { id: "brand-partner", label: "Brand Partner" },
  { id: "exhibitor", label: "Exhibitor" },
  { id: "supporting-partner", label: "Supporting Partner" },
  { id: "workshop-provider", label: "Workshop Provider" },
];

export const EVENT_SETUP_FIELDS = {
  organizer: [
    { key: "eventName", label: "Nama event", type: "text" },
    { key: "eventDate", label: "Tanggal event", type: "date" },
    { key: "campaignStartDate", label: "Campaign mulai tanggal", type: "date" },
    { key: "eventLocation", label: "Lokasi event", type: "text" },
    { key: "eventCategory", label: "Kategori event", type: "text" },
    { key: "expectedAudience", label: "Perkiraan jumlah audiens / kapasitas venue", type: "number" },
    { key: "targetAudience", label: "Target audiens", type: "text" },
    { key: "ticketed", label: "Berbayar atau gratis?", type: "select", options: [{ id: "free", label: "Gratis" }, { id: "ticketed", label: "Berbayar" }] },
    { key: "registrationTarget", label: "Target pendaftaran", type: "number" },
    { key: "currentFollowers", label: "Jumlah audiens media sosial sekarang", type: "number" },
    { key: "mainPlatform", label: "Platform promosi utama", type: "text" },
    { key: "budget", label: "Budget marketing", type: "number", optional: true },
    { key: "previousPerformance", label: "Performa event sebelumnya (kalau ada)", type: "textarea", optional: true },
  ],
  tenant: [
    { key: "eventName", label: "Nama event", type: "text" },
    { key: "eventDate", label: "Tanggal event", type: "date" },
    { key: "eventOrganizer", label: "Penyelenggara event", type: "text" },
    { key: "eventLocation", label: "Lokasi event", type: "text" },
    { key: "expectedVisitors", label: "Perkiraan pengunjung event", type: "number" },
    { key: "boothSize", label: "Ukuran booth", type: "text" },
    { key: "productsOffered", label: "Produk/jasa yang ditawarkan", type: "text" },
    { key: "targetBoothVisitors", label: "Target pengunjung booth", type: "number" },
    { key: "targetSales", label: "Target penjualan", type: "number" },
    { key: "targetLeads", label: "Target leads", type: "number" },
    { key: "socialAudience", label: "Jumlah audiens media sosial sekarang", type: "number" },
    { key: "promotionPlatform", label: "Platform promosi", type: "text" },
    { key: "budget", label: "Budget marketing", type: "number", optional: true },
  ],
  participant: [
    { key: "eventName", label: "Nama event", type: "text" },
    { key: "eventDate", label: "Tanggal event", type: "date" },
    { key: "eventOrganizer", label: "Penyelenggara event", type: "text" },
    { key: "exposureReceived", label: "Exposure yang didapat (slot, sesi, booth, dll)", type: "text" },
    { key: "targetAudience", label: "Target audiens", type: "text" },
    { key: "expectedExposure", label: "Perkiraan jangkauan exposure", type: "number" },
    { key: "targetLeads", label: "Target leads", type: "number" },
    { key: "targetNetworking", label: "Target peluang networking", type: "number" },
    { key: "socialAudience", label: "Jumlah audiens media sosial sekarang", type: "number" },
    { key: "promotionPlatform", label: "Platform promosi", type: "text" },
  ],
};

export const EVENT_OBJECTIVES = {
  organizer: ["Awareness", "Attendance", "Community building", "Lead generation", "Sales / revenue", "Education", "Product launch", "Networking", "Brand positioning", "Community activation"],
  tenant: ["Sales", "Brand awareness", "Lead generation", "Product sampling", "Community building", "New followers", "Networking", "Product launch", "Customer acquisition"],
};

function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Turns one role's phase templates into real, saveable phases+milestones —
// called once at campaign creation. `base` is each milestone's target at
// "medium" scale; every numeric target scales from there by the event's
// EVENT_SCALE_TIERS multiplier, exactly the "input variables decide the
// target" rule from the spec — never the same numbers for every event.
export function buildEventPhases(phaseTemplates, { eventDate, campaignStartDate, scaleId }) {
  const tier = EVENT_SCALE_TIERS.find((t) => t.id === scaleId) || EVENT_SCALE_TIERS[1];
  return phaseTemplates.map((p, pi) => ({
    id: `phase-${pi}`,
    name: p.name,
    dateLabel: p.dateLabel,
    dateFrom: p.offsetFrom === null ? campaignStartDate || eventDate : addDays(eventDate, p.offsetFrom),
    dateTo: addDays(eventDate, p.offsetTo),
    milestones: p.milestones.map((m) => ({
      id: uid(),
      label: m.label,
      description: m.description || "",
      category: m.category,
      kind: m.kind,
      unit: m.unit || "",
      target: m.kind === "check" ? null : Math.max(1, Math.round((m.base || 1) * tier.mult)),
      isSystemTarget: m.kind !== "check",
      required: m.required !== false,
      notApplicable: false,
      measurementMethod: m.measurementMethod || "",
      value: null,
      done: false,
      custom: false,
    })),
  }));
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
      { kind: "number", label: "Dapatkan X pendaftaran", base: 50, unit: "pendaftar", category: "CONVERSION" },
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
      { kind: "number", label: "Dapatkan X pendaftaran", base: 100, unit: "pendaftar", category: "CONVERSION" },
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
      { kind: "number", label: "Dapatkan X pendaftaran final", base: 80, unit: "pendaftar", category: "CONVERSION" },
      { kind: "number", label: "Jangkau X orang", base: 2500, unit: "orang", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X views", base: 4000, unit: "views", category: "AWARENESS" },
      { kind: "number", label: "Dapatkan X kunjungan halaman event", base: 400, unit: "kunjungan", category: "AWARENESS" },
      { kind: "number", label: "Kirim X reminder langsung", base: 200, unit: "reminder", category: "ENGAGEMENT" },
      { kind: "number", label: "Capai X% target registrasi sebelum hari-H", base: 80, unit: "%", category: "CONVERSION" },
    ],
  },
  {
    name: "Event Day", dateLabel: "Hari-H", offsetFrom: 0, offsetTo: 0,
    milestones: [
      { kind: "number", label: "Capai X attendee", base: 300, unit: "orang", category: "ATTENDANCE" },
      { kind: "number", label: "Capai X% attendance rate", base: 70, unit: "%", category: "ATTENDANCE" },
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
      { kind: "number", label: "Konversi pengunjung booth → lead (%)", base: 25, unit: "%", category: "CONVERSION", required: false },
      { kind: "number", label: "Konversi pengunjung booth → pembelian (%)", base: 12, unit: "%", category: "CONVERSION", required: false },
      { kind: "number", label: "Rata-rata nilai transaksi", base: 100000, unit: "Rp", category: "IMPACT", required: false },
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

// Never gates navigation (no missionCanAdvance equivalent) — status is
// informational so the timeline stays fully clickable per rule 9.
export function eventMilestoneStatus(milestone, phase, content) {
  if (milestone.notApplicable) return { current: 0, achievementPct: null, status: "not_applicable" };
  const current =
    milestone.kind === "auto"
      ? content.filter((c) => {
          const t = c.createdAt;
          return t >= new Date(phase.dateFrom + "T00:00:00").getTime() && t <= new Date(phase.dateTo + "T23:59:59").getTime();
        }).length
      : milestone.kind === "check"
      ? milestone.done
        ? 1
        : 0
      : milestone.value ?? 0;
  const logged = milestone.kind === "check" ? milestone.done : milestone.kind === "auto" || (milestone.value !== null && milestone.value !== undefined);
  const achievementPct = milestone.target ? Math.round((current / milestone.target) * 100) : logged ? 100 : 0;
  const deadlinePassed = Date.now() > new Date(phase.dateTo + "T23:59:59").getTime();
  let status;
  if (logged && achievementPct >= 100) status = "completed";
  else if (!logged) status = deadlinePassed ? "missed" : "not_started";
  else status = deadlinePassed ? "partially_completed" : "in_progress";
  return { current, achievementPct, status };
}

export const EVENT_PLAN_TERMS = {
  intro: "Sebelum campaign event ini mulai, baca dan setujui aturan mainnya dulu.",
  rules: [
    { title: "Autentik", body: "Seluruh campaign harus dilakukan secara autentik dan nggak boleh pakai manipulasi data." },
    { title: "No Fake Engagement", body: "Dilarang beli followers, likes, views, komentar, registrasi, atau engagement palsu buat memenuhi milestone." },
    { title: "Data Asli Aja", body: "Progress harus berdasarkan data yang beneran terjadi." },
    { title: "Target Bukan Jaminan", body: "Target yang dikasih sistem itu rekomendasi, bukan jaminan hasil campaign." },
    { title: "Target Bisa Diubah", body: "Kamu bisa ubah target dari sistem atau tambahin milestone sendiri sesuai kondisi campaign kamu." },
    { title: "Target Dinamis", body: "Target bisa beda-beda antar campaign tergantung role, skala, audiens, objective, durasi, platform, dan performa sebelumnya." },
    { title: "Tanggal Event Fixed", body: "Campaign event punya deadline berdasarkan tanggal event. Campaign tetap jalan ke fase berikutnya meskipun milestone sebelumnya belum tercapai." },
    { title: "Milestone Terlewat", body: "Milestone yang nggak tercapai bukan berarti campaign gagal — sistem catat sebagai MISSED atau SEBAGIAN SELESAI buat bahan evaluasi." },
    { title: "Nggak Boleh Manipulasi Mundur", body: "Kamu nggak boleh ubah data aktual setelah deadline cuma buat naikin angka achievement." },
    { title: "Measurement Jelas", body: "Setiap milestone harus punya cara pengukuran yang jelas." },
    { title: "Wajib vs Opsional", body: "Milestone wajib dipakai buat objective utama campaign. Milestone opsional cuma tambahan dan nggak mempengaruhi penyelesaian campaign inti." },
    { title: "Campaign Selesai", body: "Campaign dianggap selesai kalau udah lewatin semua fase yang ditentukan (Pre-Event → Event Day → Post-Event) — bukan berdasarkan jumlah milestone yang berhasil." },
    { title: "Evaluasi Berdasarkan Objective", body: "Campaign harus dievaluasi berdasarkan objective yang dipilih dari awal — nggak semua metric punya bobot yang sama buat tiap jenis campaign." },
    { title: "Beda Platform Beda Benchmark", body: "Benchmark dan performa bisa beda tiap platform — Instagram, TikTok, YouTube, LinkedIn, dll nggak bisa dianggap sama." },
    { title: "Perbaikan Berkelanjutan", body: "Hasil campaign sebelumnya bisa dipakai jadi baseline buat bikin target campaign berikutnya lebih relevan." },
  ],
};

export function createCampaign(brandId, data = {}) {
  const item = { ...emptyCampaign(brandId), ...data, id: uid(), brandId };
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
export function deleteCampaign(id) {
  db.campaigns = (db.campaigns || []).filter((c) => c.id !== id);
  const affectedContentIds = db.content.filter((c) => c.campaignId === id).map((c) => c.id);
  db.content.forEach((c) => { if (c.campaignId === id) { c.campaignId = ""; c.campaignPhaseId = ""; } });
  persist(async () => {
    await deleteDoc(doc(fdb, "campaigns", id));
    await Promise.all(affectedContentIds.map((cid) => setDoc(doc(fdb, "content", cid), getContent(cid))));
  });
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
    ...(next.campaigns || []).map((c) => ({ type: "set", ref: doc(fdb, "campaigns", c.id), data: c })),
    ...(next.routineTemplate || []).map((r) => ({ type: "set", ref: doc(fdb, "routineTemplate", r.id), data: r })),
    { type: "set", ref: doc(fdb, "settings", "main"), data: next.settings },
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
    { type: "set", ref: doc(fdb, "settings", "main"), data: db.settings },
  ]));
}
