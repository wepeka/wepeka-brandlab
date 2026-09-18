// Campaign metrics: the one place that knows, for every milestone, WHERE its
// number comes from, HOW to read it live, whether it's stale, and which
// button updates it (data action) versus which button moves it (growth
// action). Milestones no longer store numbers the app can read elsewhere —
// they point at a metric key in METRIC_SOURCES, and the reading is derived
// at paint time from content, brand insights, or the campaign's own
// manualMetrics. This module may import both store.js and formulas.js (the
// cycle that used to force a stub for the ER-count milestone lives in
// neither of them any more).
//
// Legacy campaigns (kind/label/value milestones, event plans, phase
// checklists) are normalised on read — nothing is migrated on disk until
// the campaign is next saved, same pattern as store.js's `phases` fallback.
import {
  listContent, listCampaigns, campaignContentPool, contentMetricTotal, consecutiveActiveWeeks, streakBreakInDays,
  getBrandInsights, insightsBaseline, getSettings, missionState, localISODate, daysBetween, cadenceComplianceWeeks,
  milestoneLabel, milestoneDescription, unitLabel, phaseNameLabel, missionText, eventPhaseDateLabel,
} from "./store.js";
import { computeContentMetrics } from "./formulas.js";
import { t } from "./i18n.js";

const DAY = 86400000;
export const STALE_DAYS = 7;
// "Good" Instagram engagement rate (social-media-analyzer benchmark table).
export const HEALTHY_ER = 3;
// Milestones whose number is a COUNT/AVERAGE over individual posts — the UI
// can show exactly which posts are behind it.
export const PER_POST_METRICS = ["content.erCount", "content.aboveAverage", "content.avgEr"];

const isPublished = (c) => c.status === "published";
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const lower = (s) => (s || "").toLowerCase();

// Content that counts for a milestone: the campaign's pool, then the
// milestone's own filter (phase, event window, format, tag).
export function poolFor(ctx, ms) {
  let pool = campaignContentPool(ctx.campaign, ctx.content);
  // Social Media Growth campaigns auto-link every piece of content, so two
  // concurrent social campaigns for different platforms (Instagram + TikTok)
  // would otherwise both count the brand's entire content list. Scope the
  // pool to the campaign's own platform; content with no platform tag counts
  // toward neither campaign rather than inflating both.
  const track = ctx.campaign.goalPlan?.track;
  const platform = ctx.campaign.goalPlan?.platform;
  if (track === "social" && platform) pool = pool.filter((c) => lower(c.platform) === lower(platform));
  const f = ms.filter || {};
  if (f.phaseId) pool = pool.filter((c) => c.campaignPhaseId === f.phaseId);
  if (f.dateFrom && f.dateTo) pool = pool.filter((c) => {
    const d = c.publishedDate || c.scheduleDate;
    return d && d >= f.dateFrom && d <= f.dateTo;
  });
  if (f.format) pool = pool.filter((c) => lower(c.format) === lower(f.format));
  if (f.platform) pool = pool.filter((c) => lower(c.platform) === lower(f.platform));
  if (f.tag) pool = pool.filter((c) => c.campaignTag === f.tag);
  if (f.funnel) pool = pool.filter((c) => (c.funnel || "").toUpperCase() === f.funnel);
  return pool;
}

// Published content in the pool whose performance was never confirmed, or
// was confirmed more than STALE_DAYS ago — the data action for every
// content.* metric is "fill these in".
function unconfirmedPublished(pool) {
  const cutoff = Date.now() - STALE_DAYS * DAY;
  return pool.filter(isPublished).filter((c) => {
    const at = c.performance?.confirmedAt;
    return !at || at < cutoff;
  });
}

const HOME_LABEL = Object.fromEntries(
  ["insights", "content", "performance", "calendar", "manual", "sales", "guidelines", "salesSum"].map((k) => [k, t(`camp.m.home.${k}`)])
);

function contentReading(ctx, ms, current, { staleList } = {}) {
  const pool = poolFor(ctx, ms);
  const stale = staleList || unconfirmedPublished(pool);
  return {
    current,
    available: true,
    auto: true,
    home: "performance",
    updatedAt: null,
    staleCount: stale.length,
    stale: stale.length > 0,
    update: stale.length ? { type: "performance", label: stale.length > 1 ? t("camp.m.fillPerformanceCount", { count: stale.length }) : t("camp.m.fillPerformance"), contentId: stale[0].id } : null,
    improve: { type: "new-content", label: t("camp.m.createContent") },
  };
}

// Followers (and gained) read from brand.insights; older campaigns that
// typed the number into a milestone still show it, flagged as legacy, until
// the user saves insights once.
function legacyFollowers(ctx) {
  let best = null;
  (ctx.campaign.missions || []).forEach((m) =>
    (m.milestones || []).forEach((ms) => {
      if (ms.kind === "number" && ms.label === "Followers" && num(ms.value) !== null && (!best || (ms.updatedAt || 0) > (best.updatedAt || 0))) best = ms;
    })
  );
  return best ? { followers: num(best.value), updatedAt: best.updatedAt || null, source: "legacy" } : null;
}
export function campaignPlatform(ctx) {
  return ctx.campaign?.goalPlan?.platform || "instagram";
}
function profileReading(ctx, field) {
  const ins = getBrandInsights(ctx.brand, campaignPlatform(ctx)) || legacyFollowers(ctx);
  const value = ins ? num(ins[field]) : null;
  const updatedAt = ins?.updatedAt || null;
  const ageDays = updatedAt ? Math.floor((Date.now() - updatedAt) / DAY) : null;
  const stale = value === null || ageDays === null || ageDays > STALE_DAYS;
  return {
    current: value ?? 0,
    available: true,
    logged: value !== null,
    auto: true,
    home: "insights",
    updatedAt,
    ageDays,
    stale,
    update: { type: "insights", label: value === null ? t("camp.m.fillInsights") : t("camp.m.updateInsights") },
    improve: { type: "new-content", label: t("camp.m.createContent") },
  };
}

// key → how to read it. `read(ctx, ms)` returns the reading fields that
// differ per source; readMilestone() fills in the rest.
export const METRIC_SOURCES = {
  "profile.followers": { label: t("camp.m.src.followers"), unit: "followers", read: (ctx) => profileReading(ctx, "followers") },
  "profile.reach": { label: t("camp.m.src.reach"), unit: "orang", read: (ctx) => profileReading(ctx, "reach30d") },
  "profile.profileVisits": { label: t("camp.m.src.profileVisits"), unit: "kunjungan", read: (ctx) => profileReading(ctx, "profileVisits30d") },
  "profile.followersGained": {
    label: t("camp.m.src.followersGained"),
    unit: "followers",
    read: (ctx) => {
      const r = profileReading(ctx, "followers");
      const base = insightsBaseline(ctx.brand, campaignPlatform(ctx), ctx.campaign.createdAt || 0);
      const gained = r.logged && base ? Math.max(0, (r.current || 0) - (base.followers || 0)) : 0;
      return { ...r, current: gained, logged: r.logged && !!base, note: base ? t("camp.m.note.since", { date: localISODate(new Date(base.at)) }) : t("camp.m.note.needsTwoInsights") };
    },
  },
  "content.published": {
    label: t("camp.m.src.published"),
    unit: "konten",
    read: (ctx, ms) => ({ ...contentReading(ctx, ms, poolFor(ctx, ms).filter(isPublished).length, { staleList: [] }), home: "content" }),
  },
  "content.scheduled": {
    label: t("camp.m.src.scheduled"),
    unit: "konten",
    read: (ctx, ms) => ({ ...contentReading(ctx, ms, poolFor(ctx, ms).filter((c) => c.scheduleDate && ["scheduled", "published"].includes(c.status)).length, { staleList: [] }), home: "calendar", improve: { type: "calendar", label: t("camp.m.schedule") } }),
  },
  "content.streakWeeks": {
    label: t("camp.m.src.streak"),
    unit: "minggu",
    read: (ctx, ms) => {
      const pool = poolFor(ctx, ms);
      const brk = streakBreakInDays(pool, 2);
      return { ...contentReading(ctx, ms, consecutiveActiveWeeks(pool), { staleList: [] }), home: "content", streakBreak: brk, improve: { type: "new-content", label: t("camp.m.publishThisWeek") } };
    },
  },
  "content.erCount": {
    label: t("camp.m.src.erCount"),
    unit: "konten",
    read: (ctx, ms) => {
      const pool = poolFor(ctx, ms);
      const settings = ctx.settings || getSettings();
      const threshold = ms.threshold ?? 10;
      const current = pool.filter(isPublished).filter((c) => {
        const er = computeContentMetrics(c, settings).engagementRate;
        return er !== null && er >= threshold;
      }).length;
      return { ...contentReading(ctx, ms, current), note: `ER ≥ ${threshold}%` };
    },
  },
  // Average engagement rate of the published content that has numbers —
  // replaces the old "is your ER healthy?" tick-box: the app can work that
  // out itself from performance data already filled in.
  "content.avgEr": {
    label: t("camp.m.src.avgEr"),
    unit: "%",
    read: (ctx, ms) => {
      const pool = poolFor(ctx, ms);
      const settings = ctx.settings || getSettings();
      const ers = pool.filter(isPublished).map((c) => computeContentMetrics(c, settings).engagementRate).filter((v) => v !== null && Number.isFinite(v));
      const avg = ers.length ? Math.round((ers.reduce((a, b) => a + b, 0) / ers.length) * 10) / 10 : 0;
      return { ...contentReading(ctx, ms, avg), logged: ers.length > 0, note: ers.length ? t("camp.m.note.avgErFrom", { count: ers.length }) : t("camp.m.note.needsPerformance") };
    },
  },
  // How many weeks actually hit every one of the brand's real cadence
  // upload days (js/cadence-setup.js), not just an abstract weekly count.
  // Degrades gracefully (available but never "logged") when the brand
  // skipped cadence setup — the plain `published`/`streak` milestones still
  // cover that case.
  "content.cadenceCompliance": {
    label: t("camp.m.src.cadenceCompliance"),
    unit: "%",
    read: (ctx, ms) => {
      const cadence = ctx.brand?.contentCadence;
      if (!cadence?.configured || !(cadence.uploadDays || []).length) {
        return { current: 0, available: true, auto: true, logged: false, home: "content", updatedAt: null, stale: false, update: null, improve: { type: "cadence", label: t("camp.m.setCadence") }, note: t("camp.m.note.cadenceNotSet") };
      }
      const pool = poolFor(ctx, ms);
      const sinceMs = ms.filter?.dateFrom ? new Date(ms.filter.dateFrom + "T00:00:00").getTime() : ctx.campaign.createdAt || Date.now();
      const { compliantWeeks, totalWeeks } = cadenceComplianceWeeks(pool, cadence, sinceMs);
      const pct = totalWeeks ? Math.round((compliantWeeks / totalWeeks) * 100) : 0;
      return { ...contentReading(ctx, ms, pct), home: "content", note: t("camp.m.note.cadenceWeeks", { done: compliantWeeks, total: totalWeeks }) };
    },
  },
  "content.aboveAverage": {
    label: t("camp.m.src.aboveAverage"),
    unit: "konten",
    read: (ctx, ms) => {
      const pool = poolFor(ctx, ms).filter(isPublished);
      const views = pool.map((c) => num(c.performance?.views)).filter((v) => v !== null);
      const avg = views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0;
      const current = views.length >= 3 ? views.filter((v) => v > avg).length : 0;
      return { ...contentReading(ctx, ms, current), note: views.length >= 3 ? t("camp.m.note.avgViews", { count: Math.round(avg) }) : t("camp.m.note.needsThreeViews") };
    },
  },
  "manual.number": {
    label: t("camp.m.src.number"),
    unit: "",
    read: (ctx, ms) => {
      // `valueKey`: one running number shared by the same milestone in every
      // stage (a goal plan's community-member count) instead of one per stage.
      const rec = ctx.campaign.manualMetrics?.[ms.valueKey || ms.id] || (ms.legacy && num(ms.legacy.value) !== null ? { value: num(ms.legacy.value), updatedAt: ms.legacy.updatedAt || null } : null);
      const value = rec ? num(rec.value) : null;
      return {
        current: value ?? 0,
        logged: value !== null,
        available: true,
        auto: false,
        home: "manual",
        updatedAt: rec?.updatedAt || null,
        stale: value === null || !rec?.updatedAt || Date.now() - rec.updatedAt > 14 * DAY,
        update: { type: "manual", label: value === null ? t("camp.m.log") : t("camp.m.update") },
        improve: null,
      };
    },
  },
  "manual.check": {
    label: t("camp.m.src.check"),
    unit: "",
    read: (ctx, ms) => {
      const rec = ctx.campaign.manualMetrics?.[ms.id] || (ms.legacy && ms.legacy.done !== undefined ? { done: !!ms.legacy.done, updatedAt: ms.legacy.updatedAt || null } : null);
      const done = !!rec?.done;
      return { current: done ? 1 : 0, logged: !!rec, available: true, auto: false, home: "manual", updatedAt: rec?.updatedAt || null, stale: false, update: { type: "manual", label: done ? t("camp.m.change") : t("camp.m.markDone") }, improve: null };
    },
  },
  // Sales Tracker doesn't exist yet: these read as manual numbers with a
  // note, so the milestone keeps working and the day the tracker lands
  // only this entry changes.
  "sales.leads": { label: t("camp.m.src.leads"), unit: "leads", read: (ctx, ms) => ({ ...METRIC_SOURCES["manual.number"].read(ctx, ms), home: "sales", note: t("camp.m.note.salesSoon") }) },
  "sales.revenue": { label: t("camp.m.src.revenue"), unit: "Rp", read: (ctx, ms) => ({ ...METRIC_SOURCES["manual.number"].read(ctx, ms), home: "sales", note: t("camp.m.note.salesSoon") }) },
  // Sales Growth with 2+ products (js/goal-plan.js buildSalesGrowthPlan): the
  // like-for-like sum of each product's own manually logged "sold" number —
  // same counting unit for every product, so it's a real total, not a blend.
  // Derived (`auto`), so it never shows up as its own field on the manual
  // sheet: the user logs the products, this just adds them up. It counts as
  // logged only once EVERY product has a number, and is as old as the
  // oldest of them.
  "sales.totalSold": {
    label: t("camp.m.src.totalSold"),
    unit: "",
    read: (ctx) => {
      const recs = (ctx.campaign.goalPlan?.products || []).map((p) => ctx.campaign.manualMetrics?.[`sold:${p.id}`]);
      const values = recs.map((r) => (r ? num(r.value) : null));
      const logged = values.length > 0 && values.every((v) => v !== null);
      const times = recs.map((r) => r?.updatedAt || 0);
      const updatedAt = logged ? Math.min(...times) || null : null;
      return {
        current: values.reduce((a, v) => a + (v || 0), 0),
        logged,
        available: true,
        auto: true,
        home: "salesSum",
        updatedAt,
        stale: !logged || !updatedAt || Date.now() - updatedAt > 14 * DAY,
        update: { type: "manual", label: logged ? t("camp.m.update") : t("camp.m.log") },
        improve: null,
      };
    },
  },
};
// content.metric:<key> — any per-content performance number summed over the pool.
const CONTENT_METRIC_LABELS = Object.fromEntries(["shares", "saves", "comments", "views", "likes", "reach"].map((k) => [k, t(`store.metric.${k}`)]));
export function metricSource(key) {
  if (METRIC_SOURCES[key]) return METRIC_SOURCES[key];
  const m = /^content\.metric:(\w+)$/.exec(key || "");
  if (!m) return null;
  const field = m[1];
  return {
    label: CONTENT_METRIC_LABELS[field] || field,
    unit: field,
    read: (ctx, ms) => contentReading(ctx, ms, contentMetricTotal(poolFor(ctx, ms), field)),
  };
}

// ---------- Normalisation of legacy milestone shapes ----------

function guessMetricFromLabel(label, kind) {
  const l = lower(label);
  if (/engagement rate sehat|engagement tetap sehat/.test(l)) return "content.avgEr";
  if (kind === "check") return "manual.check";
  if (l === "followers") return "profile.followers";
  if (/followers baru/.test(l)) return "profile.followersGained";
  if (/\bshares?\b/.test(l)) return "content.metric:shares";
  if (/\bsaves?\b/.test(l)) return "content.metric:saves";
  if (/komentar/.test(l)) return "content.metric:comments";
  if (/\bviews\b/.test(l) && /dapatkan/.test(l)) return "content.metric:views";
  if (/\breach\b|jangkau/.test(l) && !/booth/.test(l)) return "content.metric:reach";
  if (/kunjungan profil/.test(l)) return "profile.profileVisits";
  if (/di atas rata-rata|performa tinggi/.test(l)) return "content.aboveAverage";
  if (/\bleads?\b/.test(l)) return "sales.leads";
  if (/revenue|penjualan|transaksi/.test(l) && !/konversi|rata-rata nilai/.test(l)) return "sales.revenue";
  return "manual.number";
}

// One shape for every milestone the app has ever stored. `legacy` keeps
// the original object so manual values typed before this existed still
// read back. Never mutates the input.
export function normalizeMilestone(ms, { campaign, stage } = {}) {
  if (ms.metric) return { ...ms, label: ms.custom ? ms.label : milestoneLabel(ms.label), description: ms.custom || !ms.description ? ms.description || "" : milestoneDescription(ms.label, ms.description), unit: unitLabel(ms.unit), legacy: ms.legacy || null };
  // Phase checklists: { id, text, done }
  if (ms.text !== undefined && ms.kind === undefined) {
    return { id: ms.id, metric: "manual.check", label: ms.text, description: "", target: null, unit: "", highlight: false, required: true, custom: true, filter: null, legacy: ms };
  }
  const base = {
    id: ms.id,
    label: ms.custom ? ms.label : milestoneLabel(ms.label),
    description: ms.custom || !ms.description ? ms.description || "" : milestoneDescription(ms.label, ms.description),
    unit: unitLabel(ms.unit),
    target: ms.kind === "check" ? null : ms.target ?? null,
    threshold: ms.threshold ?? null,
    highlight: !!ms.highlight,
    required: ms.required !== false,
    notApplicable: !!ms.notApplicable,
    category: ms.category || null,
    custom: !!ms.custom,
    filter: null,
    legacy: ms,
  };
  const isEvent = !!stage?.dateFrom && !!stage?.dateTo;
  const windowFilter = isEvent ? { dateFrom: stage.dateFrom, dateTo: stage.dateTo } : null;
  if (ms.kind === "auto") return { ...base, metric: "content.published", filter: isEvent ? windowFilter : !campaign?.autoLinkAllContent && ms.phaseId ? { phaseId: ms.phaseId } : null };
  if (ms.kind === "auto-weeks") return { ...base, metric: "content.streakWeeks" };
  if (ms.kind === "auto-er-count") return { ...base, metric: "content.erCount", threshold: ms.threshold ?? 10 };
  if (ms.kind === "check" && guessMetricFromLabel(ms.label, ms.kind) === "content.avgEr") return { ...base, metric: "content.avgEr", target: HEALTHY_ER, unit: "%" };
  if (ms.kind === "check") return { ...base, metric: "manual.check" };
  const metric = guessMetricFromLabel(ms.label, ms.kind);
  return { ...base, metric, filter: metric.startsWith("content.") ? windowFilter : null };
}

// ---------- Stages: one shape for levels, event windows, and phases ----------

// ---------- One target, one campaign (Grow Brand — legacy shapes) ----------
// Only the OLD Grow Brand shapes need this: a version-1 (goalPlan.phases) or
// version-2 (goalPlan.goal, one campaign carrying all three tracks) plan
// could end up with the same target ("content published", "create a
// WhatsApp group"…) showing up in more than one running campaign. Every
// track has ONE home there — the campaign whose goal IS that track, or when
// nobody owns it, the oldest running one — and the milestone is marked
// delegated everywhere else: it doesn't gate, isn't reminded, and the UI
// just points at the campaign that tracks it. Nothing is rewritten on disk,
// so archiving the owner hands the targets straight back.
// Version 3 (js/goal-plan.js buildSocialGrowthPlan / buildCommunityGrowthPlan
// — Social Media Growth and Community Growth as separate campaigns) never
// needs this: each is track-pure from the start, so delegationFor() below
// is a no-op for it.
// social/community/sales are the old (version 2) goalPlan.goal ids; "social"
// and "community" are also the version 3 goalPlan.track ids (buildSocialGrowthPlan
// / buildCommunityGrowthPlan) — this map covers both without caring which.
const TRACK_OF_GOAL = { audience: "social", community: "community", sales: "sales", social: "social" };
const isRunning = (c) => !["archived", "completed"].includes(c.status);
function delegationFor(campaign) {
  if (!campaign.goalPlan || !isRunning(campaign)) return () => null;
  // Version 3 (Social Media Growth / Community Growth) campaigns are
  // track-pure by construction — each only ever carries its own track's
  // milestones, so there's never a duplicate target to delegate away. Skip
  // the whole family-matching dance below, which assumes the version 1/2
  // shapes (goalPlan.phases / goalPlan.goal) this campaign doesn't have.
  if (campaign.goalPlan.version === 3) return () => null;
  const v2 = campaign.goalPlan.version === 2;
  const ownVersion = campaign.goalPlan.version || 1;
  // Only campaigns of the EXACT same goalPlan shape delegate to each
  // other — a version-1 phase-based campaign never delegates with a
  // version-2 one (the old boolean-of-"is v2" check would have matched
  // them loosely).
  const family = listCampaigns(campaign.brandId)
    .filter((c) => c.goalPlan && isRunning(c) && (c.goalPlan.version || 1) === ownVersion)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (family.length < 2) return () => null;
  if (v2) {
    const owners = Object.fromEntries(family.map((c) => [TRACK_OF_GOAL[c.goalPlan.goal], c]));
    return (ms) => {
      if (!ms.track || ms.custom) return null;
      const owner = owners[ms.track] || family[0];
      return owner.id === campaign.id ? null : owner;
    };
  }
  // First-generation plans have no tracks: a supporting target with the same
  // label lives in the oldest campaign that has it. Main numbers never move.
  const older = family.filter((c) => (c.createdAt || 0) < (campaign.createdAt || 0) && c.id !== campaign.id);
  return (ms) => {
    if (ms.role !== "support" || ms.custom) return null;
    return older.find((c) => c.goalPlan.phases.some((p) => (p.milestones || []).some((m) => m.role === "support" && m.label === ms.label))) || null;
  };
}
// Applies the delegation to one stage's raw milestones. A blocking level
// must keep something to finish: if delegation would leave it without a
// single required target, its own-track optional targets become required —
// and if even that is empty, the level keeps its original list.
function delegateMilestones(list, campaign, delegate, { blocking = false } = {}) {
  const out = list.map((ms) => {
    const owner = delegate(ms);
    return owner ? { ...ms, notApplicable: true, delegatedTo: { id: owner.id, name: owner.name || "" } } : ms;
  });
  if (!blocking) return out;
  const live = out.filter((ms) => !ms.notApplicable);
  if (live.some((ms) => ms.required !== false)) return out;
  const own = TRACK_OF_GOAL[campaign.goalPlan?.goal];
  if (live.some((ms) => ms.track === own)) return out.map((ms) => (!ms.notApplicable && ms.track === own ? { ...ms, required: true } : ms));
  return list;
}

// Which container a "window" campaign keeps its dated phases in: an Event
// plan, or a first-generation Grow Brand plan (goalPlan.phases — created
// before Grow Brand became levels; those campaigns keep running as they are).
export function windowPlanKey(campaign) {
  return campaign.eventPlan?.phases?.length ? "eventPlan" : campaign.goalPlan?.phases?.length ? "goalPlan" : null;
}

export function campaignStages(campaign) {
  const delegate = delegationFor(campaign);
  if (!campaign.eventPlan?.phases?.length && campaign.goalPlan?.phases?.length) {
    const today = localISODate();
    return campaign.goalPlan.phases.map((p, i) => {
      const state = today < p.dateFrom ? "upcoming" : today > p.dateTo ? "past" : "current";
      const dateLabel = eventPhaseDateLabel(p, null);
      const key = `goal.stage.${p.key}`;
      const own = t(`${key}.desc.${campaign.goalPlan.goal}`);
      const stage = { id: p.id, index: i, kind: "window", name: t(`${key}.name`), description: own === `${key}.desc.${campaign.goalPlan.goal}` ? t(`${key}.desc`) : own, tagline: dateLabel, dateFrom: p.dateFrom, dateTo: p.dateTo, dateLabel, mergedFrom: [], state, raw: p };
      stage.milestones = delegateMilestones(p.milestones || [], campaign, delegate).map((m) => normalizeMilestone(m, { campaign, stage }));
      return stage;
    });
  }
  if (campaign.eventPlan?.phases?.length) {
    const today = localISODate();
    return campaign.eventPlan.phases.map((p, i) => {
      const state = today < p.dateFrom ? "upcoming" : today > p.dateTo ? "past" : "current";
      const dateLabel = eventPhaseDateLabel(p, campaign.eventPlan.eventDate);
      const stage = { id: p.id, index: i, kind: "window", name: phaseNameLabel(p.name), description: "", tagline: dateLabel, dateFrom: p.dateFrom, dateTo: p.dateTo, dateLabel, mergedFrom: (p.mergedFrom || []).map(phaseNameLabel), state, raw: p };
      stage.milestones = (p.milestones || []).map((m) => normalizeMilestone(m, { campaign, stage }));
      return stage;
    });
  }
  if (campaign.missions?.length) {
    return campaign.missions.map((m, i) => {
      const text = missionText(m);
      const stage = { id: m.id, index: i, kind: "level", name: text.name, description: text.description, tagline: text.tagline, dateFrom: null, dateTo: null, dateLabel: "", mergedFrom: [], state: missionState(campaign, i), completedAt: m.completedAt || null, raw: m };
      // `sinceStart` (Grow Brand levels): count only content published since
      // this level began — the level has no dates of its own, its start is
      // whenever the previous one was completed.
      const since = localISODate(new Date(stageStartedAt(campaign, stage)));
      stage.milestones = delegateMilestones(m.milestones || [], campaign, delegate, { blocking: true }).map((ms) => normalizeMilestone(ms.sinceStart ? { ...ms, filter: { ...(ms.filter || {}), dateFrom: since, dateTo: "9999-12-31" } } : ms, { campaign, stage }));
      return stage;
    });
  }
  return (campaign.phases || [])
    .filter((p) => p.enabled)
    .map((p, i) => {
      const stage = { id: p.id, index: i, kind: "phase", name: phaseNameLabel(p.name), description: p.goal || "", tagline: "", dateFrom: null, dateTo: null, dateLabel: "", mergedFrom: [], state: "current", raw: p };
      stage.milestones = (p.milestones || []).map((m) => normalizeMilestone(m, { campaign, stage }));
      return stage;
    });
}

// The stage the user should be looking at: current level, the window that
// contains today (or the next one), or the first phase without content.
export function activeStageIndex(campaign, stages, content = []) {
  if (!stages.length) return 0;
  if (stages[0].kind === "level") {
    const idx = stages.findIndex((s) => s.state === "current");
    return idx === -1 ? stages.length - 1 : idx;
  }
  if (stages[0].kind === "window") {
    const idx = stages.findIndex((s) => s.state === "current");
    if (idx !== -1) return idx;
    const up = stages.findIndex((s) => s.state === "upcoming");
    return up !== -1 ? up : stages.length - 1;
  }
  const linked = content.filter((c) => c.campaignId === campaign.id);
  const idx = stages.findIndex((s) => !linked.some((c) => c.campaignPhaseId === s.id));
  return idx === -1 ? stages.length - 1 : idx;
}

export function stageStartedAt(campaign, stage) {
  if (stage.kind === "level") return stage.index > 0 ? campaign.missions[stage.index - 1]?.completedAt || campaign.createdAt : campaign.createdAt;
  if (stage.kind === "window") return new Date(stage.dateFrom + "T00:00:00").getTime();
  return campaign.createdAt;
}

// ---------- Reading ----------

// ctx = { brand, campaign, content, settings } — `content` is the brand's
// whole content list (the pool rule is applied here).
export function readMilestone(ms, ctx, stage = null) {
  const src = metricSource(ms.metric);
  if (!src) {
    return { ...emptyReading(ms), available: false, sourceLabel: ms.metric, status: "na" };
  }
  const r = src.read(ctx, ms);
  const target = ms.target ?? null;
  const logged = r.logged !== undefined ? r.logged : true;
  const isCheck = ms.metric === "manual.check";
  // `baseline`: where a running total stood when the stage began (a goal
  // plan's followers) — progress is the climb from there, not from zero,
  // or 1,200 of 3,000 reads as "40% done" on day one.
  const base = target && num(ms.baseline) !== null && num(ms.baseline) < target ? num(ms.baseline) : 0;
  const pct = isCheck ? (r.current ? 1 : 0) : target ? Math.max(0, Math.min(1, ((r.current || 0) - base) / (target - base))) : logged ? 1 : 0;
  const met = isCheck ? !!r.current : target ? (r.current || 0) >= target : logged && (r.current || 0) > 0;
  const started = isCheck ? !!r.current : (r.current || 0) > 0 || (!r.auto && logged);
  let status = ms.notApplicable ? "na" : met ? "done" : started ? "progress" : "empty";
  if (stage?.kind === "window" && stage.state === "past" && !met && !ms.notApplicable) status = started ? "partial" : "missed";
  const action = !ms.notApplicable && !met ? (r.stale && r.update ? r.update : r.update && !r.auto ? r.update : r.improve || r.update) : null;
  return {
    ...r,
    milestone: ms,
    target,
    unit: ms.unit || unitLabel(src.unit),
    logged,
    pct,
    met,
    status,
    isCheck,
    sourceLabel: HOME_LABEL[r.home] || r.home || "",
    action,
    ageLabel: r.updatedAt ? ageLabel(r.updatedAt) : r.auto ? t("camp.m.auto") : t("camp.m.notLogged"),
  };
}
function emptyReading(ms) {
  return { milestone: ms, current: 0, target: ms.target ?? null, unit: ms.unit || "", logged: false, pct: 0, met: false, auto: false, home: "", updatedAt: null, stale: false, action: null, ageLabel: "" };
}
export function ageLabel(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return t("camp.m.today");
  if (d === 1) return t("camp.m.yesterday");
  return t("camp.m.daysAgo", { count: d });
}

export function readStage(stage, ctx) {
  const readings = stage.milestones.map((ms) => readMilestone(ms, ctx, stage));
  const relevant = readings.filter((r) => !r.milestone.notApplicable);
  const required = relevant.filter((r) => r.milestone.required !== false);
  return {
    readings,
    met: relevant.filter((r) => r.met).length,
    total: relevant.length,
    requiredMet: required.filter((r) => r.met).length,
    requiredTotal: required.length,
    stale: readings.filter((r) => r.stale && !r.met && r.auto),
  };
}

// The number that headlines the campaign: the active stage's first
// highlighted milestone, else its first metric with a target.
export function campaignHeadline(campaign, stages, stageIndex, ctx) {
  const stage = stages[stageIndex];
  if (!stage) return null;
  const ms = stage.milestones.find((m) => m.highlight && !m.notApplicable) || stage.milestones.find((m) => m.target && !m.notApplicable && m.metric !== "manual.check") || stage.milestones[0];
  if (!ms) return null;
  return { milestone: ms, reading: readMilestone(ms, ctx, stage) };
}

// Ladder rule: a level is ready to advance the moment every required
// milestone is met — no separate minimum-weeks wait. `minWeeks`/`weeksLeft`
// are kept (always 0) only so levelGateHTML()'s older copy paths and the
// force-next dialog still have something to read.
export function ladderAdvanceState(campaign, stage, ctx) {
  if (stage.kind !== "level" || stage.state !== "current") return { ready: false, targetsMet: false, weeksLeft: 0 };
  const { requiredMet, requiredTotal } = readStage(stage, ctx);
  const targetsMet = requiredTotal > 0 && requiredMet === requiredTotal;
  // Every level's consistency rule already lives as a visible milestone
  // (active weeks / cadence), so there's no hidden wait once every required
  // bar is full — finishing every target IS finishing the level, for every
  // campaign kind (goal-plan and legacy mission ladders alike).
  const minWeeks = 0;
  const started = stageStartedAt(campaign, stage);
  const weeks = Math.floor((Date.now() - started) / (7 * DAY));
  const weeksLeft = Math.max(0, minWeeks - weeks);
  return { ready: targetsMet && weeksLeft === 0, targetsMet, weeksLeft, minWeeks, weeks };
}

// Content linked to this campaign grouped by pipeline stage — the
// "Aktivitas" block. For autoLink ladders the count metric uses every
// piece the brand makes, but this block shows only explicit links so the
// user can see what they planned for it.
export const PIPELINE = [
  "idea", "draft", "production", "editing", "scheduled", "published",
].map((key) => ({ key, label: t(`camp.m.pipe.${key}`), statuses: [key] }));
export function campaignActivities(campaign, content) {
  const linked = content.filter((c) => c.campaignId === campaign.id && !c.archived);
  const counts = Object.fromEntries(PIPELINE.map((p) => [p.key, linked.filter((c) => p.statuses.includes(c.status)).length]));
  return { linked, counts };
}

// Convenience for callers that only have ids.
export function campaignContext(brand, campaign) {
  return { brand, campaign, content: listContent(brand.id), settings: getSettings() };
}

// Shared per-track icon, used by both the campaign list cards and the
// detail header — one map so they can never drift apart.
export const TRACK_ICON = { social: "chart", community: "users", sales: "target" };

// Published content in this campaign's own pool that still needs its
// engagement numbers filled in — the same "stale/unconfirmed" rule every
// content.* milestone already uses, just exposed directly so campaign
// detail can surface it as its own list.
export function campaignPendingEngagement(campaign, ctx) {
  return unconfirmedPublished(poolFor(ctx, {}));
}

export { daysBetween };
