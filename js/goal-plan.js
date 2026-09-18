// Grow Brand: clicking "Grow Brand" deploys up to three independent growth
// engines at once — Social Media Growth, Community Growth and Sales Growth.
// Each engine is its OWN campaign with its own onboarding, its own levels, and its own
// milestones — nothing here mixes a followers count with a member count
// into one number. What they share is this file's growth math (the same
// "how fast can an account this size realistically grow" model) and the
// ladder machinery in js/campaign-metrics.js (blocking levels, auto-advance,
// the mission tree) — both campaigns are stored as campaign.missions like
// any other level ladder.
//
// SOCIAL: six follower checkpoints (1K → 3K → 10K → 25K → 50K → 100K), the
// slice between today's followers and the user's target.
// COMMUNITY: five levels — design → join → activate → belong → member-led
// (Dunbar's circles for size, the 90-9-1 rule for what "active" means).
// SALES: three levels — first sales & proof → steady sales → repeat &
// referral (the buy → buy again → recommend end of the funnel). Every sales
// number is typed in by the user: there is no sales backend and no ads data
// anywhere in this file.
// WHERE THE NUMBERS COME FROM: the frameworks give the SHAPE; the constants
// below (growth bands, join rate, active shares) are working rules of
// thumb, not published research — tune them against real Wepeka client data.
//
// Milestone `label`/`unit` are literal canonical strings (not t() calls) —
// same pattern as the ladders in store.js: templates write fixed text into
// Firestore, and store.js's milestoneLabel()/unitLabel() map that text back
// to the current language at read time (see store.js's MS_LABEL_KEYS /
// UNIT_KEYS). A label here MUST stay byte-identical to a "store.ms.*" id
// string in js/i18n/campaigns.js — new ones added there are noted inline.
// Mission `description`/`tagline` are deliberately left blank: they're
// resolved from the level's `name` via store.js's missionText()
// (MISSION_KEYS → "store.mission.*"), not stored here.
// Pure — no DOM, no writes.
import { contentMetricTotal, getSettings } from "./store.js";
import { computeContentMetrics } from "./formulas.js";
import { t } from "./i18n.js";

const uid = () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const GOAL_DURATIONS = [6, 12];
// ---------- Rules of thumb (see the header: tune against real data) ----------
const COMMUNITY_JOIN_RATE = 0.1; // share of followers who'll join a group/channel — used only as a starting suggestion, never forced
const ER_GOOD_FALLBACK = 3; // % — "good" Instagram ER, social-media-analyzer benchmark
// Dunbar's circles: ~15 people you're close to, ~50 you know well, ~150 you
// can keep a real relationship with. A community's first stop is a founding
// circle, not an audience.
const DUNBAR_CIRCLES = [15, 50, 150];
// 90-9-1 participation (Nielsen): in a large group ~1% create, ~9% respond,
// 90% read — so "active" means ~10%. Small founding groups run far hotter.
const ACTIVE_SHARE_SMALL = 0.3;
const ACTIVE_SHARE_LARGE = 0.1;

export const COMMUNITY_PLATFORMS = ["whatsapp", "discord", "telegram", "igBroadcast", "facebookGroup", "offline", "other"].map((id) => ({ id, label: t(`goal.community.platform.${id}`) }));

// ---------- Feasibility ----------
// Rule-of-thumb monthly organic growth by account size — small accounts can
// compound fast, big ones can't. Simulated month by month so a plan that
// crosses from one band into the next slows down the way a real account does.
// Heuristics, not platform data: they only decide the wording of a hint and
// the "realistic version" suggestion, never block anything.
const GROWTH_BANDS = [
  { max: 1000, real: 0.25, amb: 0.45 },
  { max: 10000, real: 0.12, amb: 0.25 },
  { max: 100000, real: 0.06, amb: 0.12 },
  { max: Infinity, real: 0.03, amb: 0.07 },
];
function cadenceFactor(uploadsPerWeek) {
  const u = Number(uploadsPerWeek) || 0;
  if (u < 2) return 0.6;
  if (u < 4) return 0.85;
  if (u < 7) return 1;
  return 1.15;
}
function simulate(start, months, level, { uploadsPerWeek = 3 } = {}) {
  let v = start;
  const k = cadenceFactor(uploadsPerWeek);
  for (let m = 0; m < months; m++) {
    const band = GROWTH_BANDS.find((b) => v < b.max);
    v *= 1 + band[level] * k;
  }
  return v;
}
function niceRound(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 20) return Math.round(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

// verdict: "realistic" | "ambitious" | "aggressive" | "invalid"
export function assessGoal({ current, target, months, uploadsPerWeek }) {
  const cur = Number(current) || 0;
  const tgt = Number(target) || 0;
  if (!tgt || tgt <= cur) return { verdict: "invalid" };
  const base = Math.max(cur, 100);
  const realistic = niceRound(simulate(base, months, "real", { uploadsPerWeek }));
  const ambitious = niceRound(simulate(base, months, "amb", { uploadsPerWeek }));
  const monthlyPct = Math.round((Math.pow(tgt / base, 1 / months) - 1) * 100);
  const verdict = tgt <= realistic ? "realistic" : tgt <= ambitious ? "ambitious" : "aggressive";
  return { verdict, monthlyPct, realistic, ambitious };
}

// A starting suggestion for the community target — never forced, just a
// chip next to the field: roughly what share of an audience this size
// typically joins a group/channel.
export function suggestCommunityTarget(socialFollowerTarget) {
  const f = Number(socialFollowerTarget) || 0;
  return f > 0 ? Math.max(15, niceRound(f * COMMUNITY_JOIN_RATE)) : null;
}

// ---------- The curve ----------
// Halfway between a straight line and pure compounding: real accounts grow
// slower at the start than a line suggests, but nowhere near as back-loaded
// as a constant-percentage curve.
function curvePoint(from, to, f) {
  const lin = from + (to - from) * f;
  const geo = from > 0 ? from * Math.pow(to / from, f) : to * f * f;
  return (lin + geo) / 2;
}

// ---------- Brand baseline (from its own published content) ----------

function hasPerformance(c) {
  return c.status === "published" && contentMetricTotal([c], "views") > 0;
}
export function brandBaseline(content, settings = getSettings()) {
  const withData = (content || []).filter(hasPerformance);
  const n = withData.length;
  const perPost = (key) => (n >= 5 ? contentMetricTotal(withData, key) / n : null);
  const ers = withData.map((c) => computeContentMetrics(c, settings).engagementRate).filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  return {
    posts: n,
    enough: n >= 5,
    shares: perPost("shares"),
    saves: perPost("saves"),
    comments: perPost("comments"),
    medianEr: ers.length >= 5 ? ers[Math.floor(ers.length / 2)] : null,
  };
}

// ============================================================
// SOCIAL MEDIA GROWTH — a checkpoint ladder (store.mission.sm1..sm6).
// ============================================================

// Six fixed checkpoints, the shape of the original Grow Social Media ladder
// (1K → 3K → 10K → 25K → 50K) extended to 100K. The ladder a campaign gets
// is the slice between where the account is today and the user's own
// target: tiers already fully behind the account are dropped entirely (never
// shown as a pre-completed "Level 1"), Level 1 is rebased to the account's
// real current followers so it always reads as "where you are now", and the
// level that contains the target ends AT the target (so a 5,000 target ends
// inside the 10K level, at 5,000).
export const SOCIAL_LEVELS = [
  { name: "Mulai Ditemukan", focus: "discover", checkpoint: 1000 },
  { name: "Mulai Dikenal", focus: "known", checkpoint: 3000 },
  { name: "Mulai Dipercaya", focus: "trust", checkpoint: 10000 },
  { name: "Punya Pengaruh", focus: "influence", checkpoint: 25000 },
  { name: "Jadi Rujukan", focus: "authority", checkpoint: 50000 },
  { name: "Top of Mind", focus: "topOfMind", checkpoint: 100000 },
];
export const SOCIAL_CHECKPOINTS = SOCIAL_LEVELS.map((l) => l.checkpoint);

// Which tier the account is CURRENTLY working within — never the tier past
// it. Reaching a checkpoint (even landing exactly on it) means that tier
// becomes Level 1, not "already done": its other required milestones
// (published content, streak, shares…) still have to happen for real. Only
// tiers fully behind THAT one drop off the ladder — nothing is ever shown as
// pre-completed just because a follower count already got there.
export function placeStartSocialLevel({ followers }) {
  const f = Number(followers) || 0;
  const idx = SOCIAL_LEVELS.findIndex((l) => f < l.checkpoint);
  const reached = idx === -1 ? SOCIAL_LEVELS.length - 1 : idx;
  return { index: Math.max(0, reached - 1), reason: "checkpoint" };
}

// input: { platform, current: { followers }, target, months, uploadsPerWeek, startIndex, content, contentCadence }
export function buildSocialGrowthPlan(input) {
  const months = Number(input.months) || 12;
  const uploads = Number(input.uploadsPerWeek) || 3;
  const current = Math.max(0, Number(input.current?.followers) || 0);
  const target = Math.max(current + 1, Number(input.target) || current + 1);
  const baseline = brandBaseline(input.content);
  const cadenceConfigured = !!input.contentCadence?.configured && (input.contentCadence.uploadDays || []).length > 0;
  const startIndex = Math.min(SOCIAL_LEVELS.length - 1, Math.max(0, Number(input.startIndex) || 0));
  // Last level = the one whose checkpoint reaches the target (a target past
  // 100K just stretches the final level).
  const reach = SOCIAL_LEVELS.findIndex((l) => l.checkpoint >= target);
  const endIndex = Math.max(startIndex, reach === -1 ? SOCIAL_LEVELS.length - 1 : reach);
  // The ladder is the slice from startIndex onward — tiers before it are
  // dropped entirely (never shown, never "skipped"), and the first surviving
  // tier's follower checkpoint is rebased to the account's real current
  // count, so "Level 1" always reads as where the account genuinely stands
  // today, not a number already passed or one still far ahead.
  const levels = SOCIAL_LEVELS.slice(startIndex, endIndex + 1);
  const remaining = levels.length;
  const estWeeks = Math.max(6, Math.round((months * 4.345) / remaining));
  const planned = Math.max(6, Math.round(uploads * estWeeks));
  const DM_TARGETS = [30, 80, 150, 300, 500, 800];
  const COLLAB_TARGETS = [1, 2, 3, 5, 8, 10];

  const missions = levels.map((lvl, i) => {
    const abs = startIndex + i; // absolute tier index — keeps DM/collab targets tied to the tier's real depth, not its position in the (possibly shorter) ladder
    const last = i === levels.length - 1;
    const cp = last ? target : i === 0 ? Math.max(current, lvl.checkpoint) : lvl.checkpoint;
    const prevCp = i === 0 ? current : levels[i - 1].checkpoint;
    const lift = 1 + 0.2 * i;
    const seed = Math.max(1, prevCp * 0.002);
    const engagement = (key, label, unit, descKey) => {
      const own = baseline[key];
      const estimated = own === null || own === undefined;
      return { track: "social", label, unit, metric: `content.metric:${key}`, sinceStart: true, target: Math.max(5, niceRound((estimated ? seed : Math.max(own, seed)) * planned * lift)), estimated, description: `${t(descKey)} ${estimated ? t("goal.ms.estimatedDesc") : t("goal.ms.fromHistoryDesc", { n: Math.round(own * 10) / 10 })}` };
    };
    const M = {
      followers: { track: "social", label: "Followers", unit: "followers", metric: "profile.followers", target: cp, baseline: Math.min(prevCp, cp - 1), description: t("goal.ms.followersDesc") },
      published: { track: "social", label: "Konten terbit di level ini", unit: "konten", metric: "content.published", sinceStart: true, target: planned, description: t("goal.ms.publishedDesc", { perWeek: uploads, weeks: estWeeks }) },
      streak: { track: "social", label: "Minggu aktif konsisten", unit: "minggu", metric: "content.streakWeeks", sinceStart: true, target: Math.max(4, Math.round(estWeeks / 2)), description: t("goal.ms.streakDesc") },
      cadence: { track: "social", label: "Kepatuhan jadwal upload", unit: "%", metric: "content.cadenceCompliance", sinceStart: true, target: 70, description: t("goal.ms.cadenceDesc") },
      shares: engagement("shares", "Shares di level ini", "share", "goal.ms.sharesDesc"),
      saves: engagement("saves", "Saves di level ini", "save", "goal.ms.savesDesc"),
      comments: engagement("comments", "Komentar di level ini", "komentar", "goal.ms.commentsDesc"),
      er: { track: "social", label: "Konten dengan engagement di atas standar akunmu", unit: "konten", metric: "content.erCount", sinceStart: true, threshold: baseline.medianEr !== null ? Math.max(1, Math.round(baseline.medianEr * 10) / 10) : ER_GOOD_FALLBACK, target: Math.max(3, Math.round(planned * (0.2 + 0.05 * Math.min(abs, 4)))), description: t("goal.ms.erDesc") },
      dm: { track: "social", label: "DM bermakna", unit: "DM", metric: "manual.number", target: DM_TARGETS[abs], description: t("goal.ms.dmDesc") },
      collabs: { track: "social", label: "Kolaborasi bermakna", unit: "kolaborasi", metric: "manual.number", target: COLLAB_TARGETS[abs], description: t("goal.ms.collabsDesc") },
    };
    const cad = cadenceConfigured ? ["cadence"] : [];
    const SETS = {
      discover: { required: ["followers", "published", "streak", "shares"], optional: [...cad, "saves", "comments", "collabs"] },
      known: { required: ["followers", "published", "streak", "shares", "saves"], optional: [...cad, "comments", "er", "collabs"] },
      trust: { required: ["followers", "saves", "comments", "er", "published", "streak"], optional: [...cad, "shares", "dm", "collabs"] },
      influence: { required: ["followers", "er", "shares", "saves", "collabs", "published", "streak"], optional: [...cad, "comments", "dm"] },
      authority: { required: ["followers", "er", "shares", "saves", "dm", "collabs", "published", "streak"], optional: [...cad, "comments"] },
      topOfMind: { required: ["followers", "er", "shares", "saves", "comments", "dm", "collabs", "published", "streak"], optional: [...cad] },
    };
    const set = SETS[lvl.focus];
    const make = (k, required, first) => ({
      id: uid(), key: k, role: required ? "focus" : "support", required, highlight: first, notApplicable: false, custom: false,
      threshold: null, filter: null, baseline: null, valueKey: null, sinceStart: false, estimated: false, description: "", ...M[k],
    });
    return {
      id: uid(), name: lvl.name, focus: lvl.focus, description: "", tagline: "",
      minWeeks: 0, estWeeks,
      completedAt: null,
      milestones: [...set.required.map((k, n) => make(k, true, n === 0)), ...set.optional.map((k) => make(k, false, false))],
    };
  });

  return {
    missions,
    goalPlan: {
      version: 3, track: "social", platform: input.platform || "instagram", months, uploadsPerWeek: uploads, startIndex,
      current: { followers: current }, target: { followers: target }, baselinePosts: baseline.posts,
      disclaimerAcceptedAt: Date.now(),
    },
  };
}

// ============================================================
// COMMUNITY GROWTH — five levels: Rancang (design the community before
// inviting anyone) → Bergabung (join) → Partisipasi Aktif (activate) →
// Rasa Memiliki (belong/contribute) → Mandiri (member-led). Member count is
// asked directly in onboarding — never inferred from followers.
// ============================================================

export const COMMUNITY_LEVELS = [
  { name: "Rancang", focus: "design" },
  { name: "Bergabung", focus: "join" },
  { name: "Partisipasi Aktif", focus: "activate" },
  { name: "Rasa Memiliki", focus: "belong" },
  { name: "Mandiri", focus: "lead" },
];

// Same rule as Social: never skip straight past the level the community is
// actually working within just because a member count crossed a threshold —
// that level's other required milestones (rules, rituals, cross-posting…)
// still have to happen for real. Only levels fully behind that one drop off
// the ladder.
export function placeStartCommunityLevel({ hasExisting, members }) {
  const m = Number(members) || 0;
  if (!hasExisting) return { index: 0, reason: "design" };
  const REASONS = ["design", "join", "activate", "belong", "lead"];
  const raw = m < DUNBAR_CIRCLES[0] ? 1 : m < DUNBAR_CIRCLES[1] ? 2 : m < DUNBAR_CIRCLES[2] ? 3 : 4;
  const index = Math.max(0, raw - 1);
  return { index, reason: REASONS[index] };
}

// input: { hasExisting, platformWhere, current: { members }, target, months, startIndex, content }
export function buildCommunityGrowthPlan(input) {
  const months = Number(input.months) || 12;
  const hasExisting = !!input.hasExisting;
  const current = Math.max(0, Number(input.current?.members) || 0);
  const target = Math.max(current + 1, Number(input.target) || current + 1);
  const startIndex = Math.min(COMMUNITY_LEVELS.length - 1, Math.max(0, Number(input.startIndex) || 0));
  // Levels before startIndex are dropped entirely — never shown as a
  // pre-completed "Level 1".
  const levels = COMMUNITY_LEVELS.slice(startIndex);
  const remaining = levels.length;
  const estWeeks = Math.max(4, Math.round((months * 4.345) / remaining));

  // Member checkpoints: Level 1 always reflects the community's real size
  // today — never a further-out number, so it never reads as "already basically
  // there" or "impossible on day one". Past it, the ACTIVE levels that still
  // fit follow Dunbar's circles (15 → 50 → 150) — a founding circle, a group
  // where everyone knows each other, a real community — then the brand's own
  // curve takes over up to the user's target. Always strictly rising.
  const checkpoints = [];
  levels.forEach((_, i) => {
    // Level 1 is never bumped by the "strictly higher than before" guard
    // below — it's allowed to equal current exactly, because it IS current.
    if (i === 0) {
      checkpoints.push(current);
      return;
    }
    const prev = Math.max(current, checkpoints[i - 1]);
    const last = i === levels.length - 1;
    const j = i + 1;
    const circle = DUNBAR_CIRCLES[startIndex + i];
    const want = circle && circle > current ? circle : niceRound(curvePoint(current, target, j / remaining));
    checkpoints.push(last ? target : Math.min(target, Math.max(prev + 1, want)));
  });

  const missions = levels.map((lvl, i) => {
    const abs = startIndex + i;
    const cp = checkpoints[i];
    const prevCp = i === 0 ? current : Math.min(checkpoints[i - 1], cp - 1);
    const check = (label, descKey) => ({ track: "community", label, unit: "", metric: "manual.check", target: null, description: t(descKey) });
    const M = {
      concept: check("Nama komunitas & panggilan untuk member", "goal.ms.identityDesc"),
      rules: check("Tulis aturan main & pesan sambutan", "goal.ms.rulesDesc"),
      ritualPlan: check("Tentukan ritual mingguan komunitas", "goal.ms.ritualPlanDesc"),
      waGroup: check("Buat grup atau channel komunitas", "goal.ms.createGroupDesc"),
      members: { track: "community", label: "Member komunitas", unit: "member", metric: "manual.number", valueKey: "members", target: cp, baseline: Math.min(prevCp, cp - 1), description: t(`goal.ms.membersDesc.${abs}`) },
      ritual: check("Ritual mingguan komunitas berjalan", "goal.ms.ritualDesc"),
      activeMembers: { track: "community", label: "Member komunitas yang aktif", unit: "member aktif", metric: "manual.number", target: Math.max(5, niceRound(cp * (cp < 100 ? ACTIVE_SHARE_SMALL : ACTIVE_SHARE_LARGE))), description: t("goal.ms.activeMembersDesc") },
      activity: check("Adakan aktivitas komunitas di level ini", "goal.ms.communityActivityDesc"),
      ugc: { track: "community", label: "UGC asli dari komunitas", unit: "UGC", metric: "manual.number", target: Math.max(4, niceRound(cp * 0.08)), description: t("goal.ms.ugcDesc") },
      advocates: { track: "community", label: "Member yang aktif merekomendasikanmu", unit: "orang", metric: "manual.number", target: Math.max(3, niceRound(cp * 0.15)), description: t("goal.ms.advocatesDesc") },
      testimonials: { track: "community", label: "Testimoni member dikumpulkan & diposting", unit: "testimoni", metric: "manual.number", target: Math.max(3, niceRound(cp * 0.1)), description: t("goal.ms.communityTestimonialsDesc") },
      crossPost: { track: "community", label: "Konten dari komunitas diposting ke channel utama (IG/Threads/dst)", unit: "postingan", metric: "manual.number", target: abs <= 1 ? 2 : abs === 2 ? 4 : 6, description: t("goal.ms.crossPostDesc") },
      memberLed: { track: "community", label: "Aktivitas yang dijalankan member sendiri", unit: "aktivitas", metric: "manual.number", target: 2, description: t("goal.ms.memberLedDesc") },
      referred: { track: "community", label: "Member baru dari ajakan member", unit: "member", metric: "manual.number", target: Math.max(5, niceRound((cp - prevCp) * 0.3)), description: t("goal.ms.referredDesc") },
      events: { track: "community", label: "Event komunitas (online/offline)", unit: "event", metric: "manual.number", target: 1, description: t("goal.ms.communityEventDesc") },
    };
    const SETS = {
      design: { required: ["concept", "rules", "ritualPlan", ...(hasExisting ? [] : ["waGroup"]), "members"], optional: [] },
      join: { required: ["members", "ritual", "crossPost"], optional: ["activity"] },
      activate: { required: ["activeMembers", "activity", "members", "crossPost"], optional: ["ugc"] },
      belong: { required: ["ugc", "members", "advocates", "testimonials"], optional: ["activeMembers", "events"] },
      lead: { required: ["memberLed", "referred", "members", "advocates"], optional: ["events", "testimonials"] },
    };
    const set = SETS[lvl.focus];
    // Naming the community (concept.js item 1) is never optional and never
    // skippable by starting further up the ladder — a campaign whose Level 1
    // isn't "Rancang" (a sizeable existing community) still has to name
    // itself for real, so it's added to whichever level ends up first.
    const required = i === 0 && !set.required.includes("concept") ? ["concept", ...set.required] : set.required;
    const make = (k, required, first) => ({
      id: uid(), key: k, role: required ? "focus" : "support", required, highlight: first, notApplicable: false, custom: false,
      threshold: null, filter: null, baseline: null, valueKey: null, sinceStart: false, estimated: false, description: "", ...M[k],
    });
    // The member count headlines every level, even where it isn't listed first.
    return {
      id: uid(), name: lvl.name, focus: lvl.focus, description: "", tagline: "",
      minWeeks: 0, estWeeks,
      completedAt: null,
      milestones: [...required.map((k) => make(k, true, k === "members")), ...set.optional.map((k) => make(k, false, false))],
    };
  });

  return {
    missions,
    goalPlan: {
      version: 3, track: "community", platformWhere: Array.isArray(input.platformWhere) && input.platformWhere.length ? input.platformWhere : ["other"], hasExisting, months, startIndex,
      current: { members: current }, target: { members: target },
      disclaimerAcceptedAt: Date.now(),
    },
  };
}

// ============================================================
// SALES GROWTH — three levels: Penjualan Pertama (first sales + proof) →
// Penjualan Rutin (steady sales) → Pelanggan Setia (repeat + referral).
// Beginner wording of the funnel: people discover you → get interested →
// consider → buy (levels 1–2) → buy again → recommend you (level 3).
//
// WHERE THE NUMBERS GET TYPED: Sales Tracker (js/sales-tracker.js). Logging
// a sale there pushes each product's "sold", revenue, repeat buyers and
// referrals into this campaign's manualMetrics under the valueKeys used
// below (`sold:<productId>`, `revenue`, `repeatBuyers`, `referrals`) — the
// campaign page never needs them re-typed.
// EVERY number here is manual entry. BrandLab has no sales backend, and no
// ads/attribution data is read or asked for — nothing in this track may
// depend on ROAS/CPC/CPM/CPA/ad spend. The only ratio used is the
// inquiry→sale rule of thumb below, and only to size a target, never
// displayed as a measured conversion rate.
//
// MULTIPLE PRODUCTS: one counting unit per campaign (units / projects /
// subscribers / students / orders — SALES_MODELS), so the products can be
// summed like-for-like. With 2+ products the headline is "Total terjual"
// (metric sales.totalSold = the sum of each product's own logged number)
// and that total is what opens the next level; every product still gets
// its own row with its own target, never blended into a percentage. With
// one product, that product IS the headline. Revenue (optional) is its own
// Rp row — never mixed with the unit count.
// ============================================================

export const SALES_DURATIONS = [3, 6, 12];
// `proof`: how many sales count as "has proof it sells" for placement — a
// rule of thumb per business model (3 finished client projects say as much
// as 10 product sales). `inquiry`: whether people normally ask before they
// buy (a restaurant order rarely starts with a DM) — decides whether the
// optional inquiries row exists at all.
export const SALES_MODELS = [
  { id: "product", unit: "unit", proof: 10, inquiry: true },
  { id: "agency", unit: "proyek", proof: 3, inquiry: true },
  { id: "saas", unit: "subscriber", proof: 10, inquiry: true },
  { id: "course", unit: "siswa", proof: 10, inquiry: true },
  { id: "restaurant", unit: "pesanan", proof: 30, inquiry: false },
];
export const salesModel = (id) => SALES_MODELS.find((m) => m.id === id) || SALES_MODELS[0];
// Rules of thumb (same caveat as the header: tune against real data).
const SALES_PACE_GROWTH = { real: 0.08, amb: 0.18 }; // how fast a monthly sales pace can compound
const INQUIRY_TO_SALE = 0.25; // ~1 in 4 serious inquiries buys (see goal.ms.inquiryDesc)
const TESTIMONIAL_SHARE = 0.2; // ~1 in 5 buyers gives a testimonial when asked
const REPEAT_SHARE = 0.25; // a healthy small brand: ~a quarter of orders from repeat buyers
const REFERRAL_SHARE = 0.1;

export const SALES_LEVELS = [
  { name: "Penjualan Pertama", focus: "first" },
  { name: "Penjualan Rutin", focus: "steady" },
  { name: "Pelanggan Setia", focus: "loyal" },
];

const cleanProducts = (products) =>
  (products || [])
    .map((p) => ({ ...p, name: String(p.name || "").trim(), price: Number(p.price) || 0, sold: Math.max(0, Number(p.sold) || 0), target: Number(p.target) || 0, cost: Number(p.cost) || null }))
    .filter((p) => p.name);

// Placement: always Level 1 ("Penjualan Pertama"). A sales count past the
// model's "proof" threshold used to jump straight to "steady" — but that
// silently marked the first level done without ever checking its OTHER
// required milestones (a clear offer, testimonials), the same skip-ahead bug
// fixed for Social and Community. Level 1's own `sold` target is rebased to
// the brand's real current count (see buildSalesGrowthPlan below), so it
// never asks for sales that already happened — only for the offer/testimonial
// work that hadn't. Level 3 is never suggested — onboarding doesn't ask
// about repeat buyers, so there's nothing to justify skipping to it either.
export function placeStartSalesLevel() {
  return { index: 0, reason: "firstSales" };
}

// Feasibility for a sales target. Unlike followers there is no size-based
// growth band to lean on — the only honest yardstick is the brand's own
// current monthly pace, and that field is optional. Without it the verdict
// is "unknown" and the hint just states the pace the target implies.
// verdict: "invalid" | "unknown" | "realistic" | "ambitious" | "aggressive"
export function assessSalesGoal({ sold, target, months, monthlySales }) {
  const cur = Math.max(0, Number(sold) || 0);
  const tgt = Number(target) || 0;
  const n = Number(months) || 6;
  if (!tgt || tgt <= cur) return { verdict: "invalid" };
  const perMonth = Math.max(1, Math.ceil((tgt - cur) / n));
  const pace = Number(monthlySales) || 0;
  if (pace <= 0) return { verdict: "unknown", perMonth };
  const reach = (g) => {
    let total = cur;
    for (let m = 1; m <= n; m++) total += pace * Math.pow(1 + g, m);
    return niceRound(total);
  };
  const realistic = reach(SALES_PACE_GROWTH.real);
  const ambitious = reach(SALES_PACE_GROWTH.amb);
  const verdict = tgt <= realistic ? "realistic" : tgt <= ambitious ? "ambitious" : "aggressive";
  return { verdict, perMonth, pace, realistic, ambitious };
}

// input: { model, products: [{ id, name, price, sold, target, cost? }], months, startIndex,
//          monthlySales?, revenue?: { current, target } }
// Also returns `manualMetrics`: the numbers the user just typed in the
// wizard, pre-logged so the campaign doesn't open asking for them again.
export function buildSalesGrowthPlan(input) {
  const months = Number(input.months) || 6;
  const model = salesModel(input.model);
  const products = cleanProducts(input.products).map((p) => ({ ...p, id: p.id || uid(), target: Math.max(p.sold + 1, p.target) }));
  const multi = products.length > 1;
  const startIndex = Math.min(SALES_LEVELS.length - 1, Math.max(0, Number(input.startIndex) || 0));
  const remaining = SALES_LEVELS.length - startIndex;
  const estWeeks = Math.max(4, Math.round((months * 4.345) / remaining));
  const soldNow = products.reduce((a, p) => a + p.sold, 0);
  const revNow = Math.max(0, Number(input.revenue?.current) || 0);
  const revTarget = Number(input.revenue?.target) > revNow ? Number(input.revenue.target) : null;
  const soldKey = (p) => `sold:${p.id}`;

  const missions = SALES_LEVELS.map((lvl, i) => {
    const j = Math.max(0, i - startIndex + 1);
    const last = i === SALES_LEVELS.length - 1;
    // Each product climbs its own curve; the total checkpoint is the SUM of
    // the product checkpoints (not a separately rounded curve), so "every
    // product on track" always means "total on track".
    const point = (from, to, f) => (f >= 1 ? to : f <= 0 ? from : Math.min(to, Math.max(from + 1, niceRound(curvePoint(from, to, f)))));
    // Level 1's own sold target is the brand's real current count (f=0) —
    // never a number already passed or a curve-step already ahead of where
    // it stands — so "offer" and "testimonials" are what actually gates it.
    const cps = products.map((p) => point(p.sold, p.target, last ? 1 : i === 0 ? 0 : j / remaining));
    const prevCps = products.map((p) => point(p.sold, p.target, (j - 1) / remaining));
    const cpTotal = cps.reduce((a, b) => a + b, 0);
    const prevTotal = prevCps.reduce((a, b) => a + b, 0);
    const newSales = Math.max(1, cpTotal - prevTotal);
    const productRow = (p, n) => ({ track: "sales", label: p.name, unit: model.unit, metric: "manual.number", valueKey: soldKey(p), target: Math.max(1, cps[n]), baseline: Math.min(prevCps[n], cps[n] - 1), description: t("goal.ms.soldDesc") });
    const M = {
      offer: { track: "sales", label: "Penawaran jelas: harga, cara order, dan bukti", unit: "", metric: "manual.check", target: null, description: t("goal.ms.offerClearDesc") },
      sold: multi
        ? { track: "sales", label: "Total terjual", unit: model.unit, metric: "sales.totalSold", target: Math.max(1, cpTotal), baseline: Math.min(prevTotal, cpTotal - 1), description: t("goal.ms.totalSoldDesc") }
        : productRow(products[0], 0),
      testimonials: { track: "sales", label: "Testimoni dari customer terkumpul", unit: "testimoni", metric: "manual.number", valueKey: "testimonials", target: Math.min(50, Math.max(Math.min(3, cpTotal), niceRound((cpTotal - soldNow) * TESTIMONIAL_SHARE))), description: t("goal.ms.askTestimonialsDesc") },
      inquiries: { track: "sales", label: "Inquiry / DM tanya produk", unit: "inquiry", metric: "sales.leads", target: Math.max(4, niceRound(newSales / INQUIRY_TO_SALE)), description: t("goal.ms.inquiryDesc") },
      repeat: { track: "sales", label: "Pembeli yang beli lagi (repeat)", unit: "orang", metric: "manual.number", valueKey: "repeatBuyers", target: Math.max(Math.min(3, newSales), niceRound(newSales * REPEAT_SHARE)), description: t("goal.ms.repeatDesc") },
      referrals: { track: "sales", label: "Pelanggan dari rekomendasi orang lain", unit: "orang", metric: "manual.number", valueKey: "referrals", target: Math.max(Math.min(2, newSales), niceRound(newSales * REFERRAL_SHARE)), description: t("goal.ms.referralsDesc") },
      ...(revTarget ? { revenue: { track: "sales", label: "Omzet", unit: "Rp", metric: "sales.revenue", valueKey: "revenue", target: last ? revTarget : Math.min(revTarget, Math.max(revNow + 1, niceRound(curvePoint(revNow, revTarget, j / remaining)))), baseline: j <= 1 ? revNow : niceRound(curvePoint(revNow, revTarget, (j - 1) / remaining)), description: t("goal.ms.revenueDesc") } } : {}),
    };
    if (multi) products.forEach((p, n) => (M[`product:${p.id}`] = productRow(p, n)));
    const rows = [...(multi ? products.map((p) => `product:${p.id}`) : []), ...(revTarget ? ["revenue"] : [])];
    // Inquiries never gate a level: their target comes from a rule of thumb
    // (1 in 4 buys), and a brand that converts better than that shouldn't be
    // held back by it. Left out entirely where people don't ask before buying.
    const inq = model.inquiry ? ["inquiries"] : [];
    const SETS = {
      first: { required: ["sold", "offer", "testimonials"], optional: [...rows, ...inq] },
      steady: { required: ["sold", "testimonials"], optional: [...rows, ...inq, "repeat"] },
      loyal: { required: ["sold", "repeat", "referrals"], optional: [...rows, "testimonials"] },
    };
    const set = SETS[lvl.focus];
    const make = (k, required, first) => ({
      id: uid(), key: k.startsWith("product:") ? "product" : k, role: required ? "focus" : "support", required, highlight: first, notApplicable: false, custom: false,
      threshold: null, filter: null, baseline: null, valueKey: null, sinceStart: false, estimated: false, description: "", ...M[k],
    });
    return {
      id: uid(), name: lvl.name, focus: lvl.focus, description: "", tagline: "",
      minWeeks: Math.max(4, Math.round(estWeeks / 2)), estWeeks,
      completedAt: null,
      milestones: [...set.required.map((k, n) => make(k, true, n === 0)), ...set.optional.map((k) => make(k, false, false))],
    };
  });

  const now = Date.now();
  const manualMetrics = Object.fromEntries(products.map((p) => [soldKey(p), { value: p.sold, updatedAt: now }]));
  if (revTarget && input.revenue?.current !== null && input.revenue?.current !== undefined) manualMetrics.revenue = { value: revNow, updatedAt: now };

  return {
    missions,
    manualMetrics,
    goalPlan: {
      version: 3, track: "sales", model: model.id, unit: model.unit, months, startIndex,
      products: products.map((p) => ({ id: p.id, name: p.name, price: p.price, cost: p.cost, sold: p.sold, target: p.target })),
      monthlySales: Number(input.monthlySales) || null,
      current: { sold: soldNow, revenue: revTarget ? revNow : null },
      target: { sold: products.reduce((a, p) => a + p.target, 0), revenue: revTarget },
      disclaimerAcceptedAt: now,
    },
  };
}

// ---------- Evaluation ----------
// Why isn't this level done? Read straight off the level's own milestone
// readings (campaign-metrics readStage) — no guessing, every reason points
// at a number the user can see on the same page. Returns reason keys in
// priority order; the view turns them into copy. Shared by both tracks —
// a reason whose milestone key doesn't exist in a given track's readings
// (e.g. "members" in a Social campaign) simply never fires.
export function evaluateLevel({ readings, startedAt, estWeeks, uploadsPerWeek, now = Date.now() }) {
  const weeks = Math.max(0, Math.floor((now - startedAt) / (7 * 86400000)));
  const overdue = weeks >= estWeeks;
  const by = (key) => readings.find((r) => r.milestone.key === key && !r.milestone.notApplicable) || null;
  const behind = (r, share = 1) => r && r.milestone.required !== false && !r.met && r.pct < share;
  const reasons = [];
  const pub = by("published");
  const expectedPub = pub ? Math.min(pub.target, Math.round((Number(uploadsPerWeek) || 3) * Math.max(1, weeks))) : 0;
  const uploadsBehind = pub && !pub.met && pub.current < expectedPub * 0.8;
  if (uploadsBehind) reasons.push({ key: "uploads", vars: { done: pub.current, expected: expectedPub, actual: Math.round((pub.current / Math.max(1, weeks)) * 10) / 10, planned: Number(uploadsPerWeek) || 3 } });
  const streak = by("streak");
  if (streak && !streak.met && weeks >= 2 && streak.current < Math.min(streak.target, weeks)) reasons.push({ key: "gaps", vars: { weeks: streak.current } });
  const stale = readings.find((r) => r.staleCount > 0 && !r.met);
  if (stale) reasons.push({ key: "noPerformance", vars: { count: stale.staleCount } });
  const profile = readings.find((r) => r.home === "insights" && r.stale && r.milestone.required !== false);
  if (profile) reasons.push({ key: "staleInsights", vars: {} });
  const unlogged = readings.filter((r) => !r.auto && !r.isCheck && !r.logged && r.milestone.required !== false && !r.milestone.notApplicable);
  if (unlogged.length) reasons.push({ key: "notLogged", vars: { list: unlogged.map((r) => r.milestone.label).join(", ") } });
  if (!uploadsBehind) {
    if ([by("er"), by("shares"), by("saves"), by("comments")].some((r) => behind(r, 0.7))) reasons.push({ key: "lowResponse", vars: {} });
    if (behind(by("followers"), 0.7)) reasons.push({ key: "reach", vars: {} });
  }
  if ([by("members"), by("activeMembers"), by("ugc")].some((r) => r && r.logged && behind(r, 0.7)) || (by("activity") && by("activity").milestone.required !== false && !by("activity").met)) reasons.push({ key: "communityIdle", vars: {} });
  // Sales Growth: the sold headline is logged but well behind its checkpoint.
  if (by("sold")?.logged && behind(by("sold"), 0.7)) reasons.push({ key: "noOffer", vars: {} });
  if (!reasons.length) reasons.push({ key: "almost", vars: {} });
  return { overdue, weeks, estWeeks, reasons };
}

// levelReminders is a no-op for track-pure (v3) campaigns — kept only so
// js/next-action.js and js/views/campaign-detail.js (which call it
// generically for every level-kind campaign) don't need a special case.
// A track-pure campaign's readings never carry another track's milestones,
// so this always returns []. Legacy v2 Grow Brand campaigns (one campaign
// carrying all three tracks) are the only ones this ever had real work to
// do for.
export function levelReminders() {
  return [];
}
