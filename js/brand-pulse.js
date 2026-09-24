// Brand Pulse: "what's happening in this brand right now" — the signals
// that feed both the Home Companion card (js/views/home.js) and every AI
// feature's context (js/ai.js buildFullContext's pulseText). Pure module:
// every export takes plain data in and returns plain data out. The few
// imports below are themselves pure given their arguments (they read only
// what's passed in, never touch Firestore) — organicViews/
// consecutiveActiveWeeks/streakBreakInDays/localISODate operate on plain
// arrays/dates, getTracker/weeklySeries on a brand object already in
// memory, computeContentMetrics on one content item + settings, and
// campaignStages/activeStageIndex/campaignHeadline/crossCampaignInsights on
// the same ctx shape (brand, campaign(s), content, settings) this module
// already builds — none of them read or write Firestore themselves.
import { organicViews, consecutiveActiveWeeks, streakBreakInDays, localISODate } from "./store.js";
import { getTracker, weeklySeries } from "./sales-tracker.js";
import { computeContentMetrics } from "./formulas.js";
import { crossCampaignInsights } from "./cross-campaign.js";
import { campaignStages, activeStageIndex, campaignHeadline } from "./campaign-metrics.js";
import { t } from "./i18n.js";
import { learningText } from "./brand-learning.js";

const DAY = 86400000;

// ---------- Tunable thresholds (§5 of Brief Revisi 2) ----------
const VIRAL_WINDOW_DAYS = 14;
const VIRAL_MIN_VIEWS = 500;
const VIRAL_MULTIPLIER = 3;
const VIRAL_LOW_SAMPLE_MIN_VIEWS = 2000;
const VIRAL_LOW_SAMPLE_CUTOFF = 5;
const VIRAL_COMPARISON_POOL = 20;

const TOP_FORMAT_WINDOW_DAYS = 56; // 8 weeks
const TOP_FORMAT_MIN_POSTS = 3;
const TOP_FORMAT_MULTIPLIER = 1.5;

const ENGAGEMENT_DROP_RECENT_N = 5;
const ENGAGEMENT_DROP_PREV_N = 10;
const ENGAGEMENT_DROP_MULTIPLIER = 0.6;
const ENGAGEMENT_DROP_MIN_SAMPLE = 3;

const FOLLOWER_JUMP_PCT = 5;
const FOLLOWER_JUMP_ABS = 100;
const FOLLOWER_DROP_PCT = -3;

const SALES_CHANGE_PCT = 30;
const SALES_MIN_ENTRIES = 3;
const SALES_PREVIOUS_WEEKS = 4;

const STREAK_BREAK_MAX_DAYS = 2;

const CONTENT_SALES_WINDOW_DAYS = 30;
const CONTENT_SALES_MIN_QTY = 2;

// ---------- Small pure helpers ----------
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
// ISO week (Mon–Sun), e.g. "2026-W38" — used only to dedupe a signal within
// the same week so a still-true condition doesn't re-fire every render.
function isoWeekKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((d - week1) / DAY - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
function daysAgoLabel(atMs, now) {
  const days = Math.max(0, Math.floor((now.getTime() - atMs) / DAY));
  if (days <= 0) return t("camp.m.today");
  if (days === 1) return t("camp.m.yesterday");
  return t("camp.m.daysAgo", { count: days });
}
function publishedMs(c) {
  return c.publishedDate ? new Date(c.publishedDate + "T12:00:00").getTime() : null;
}
function erOf(c, settings) {
  const v = computeContentMetrics(c, settings).engagementRate;
  return v === null || v === undefined ? null : Number(v);
}
function contentTitle(c) {
  return c.title || t("pulse.untitledContent");
}

// ---------- Signal builders, one per kind ----------
function signalViral(content, now) {
  const published = content.filter((c) => c.status === "published" && publishedMs(c) !== null).sort((a, b) => publishedMs(b) - publishedMs(a));
  const comparisonViews = published.slice(0, VIRAL_COMPARISON_POOL).map((c) => organicViews(c)).filter((v) => v !== null);
  const med = median(comparisonViews);
  const enoughSample = comparisonViews.length >= VIRAL_LOW_SAMPLE_CUTOFF;
  const out = [];
  for (const c of published) {
    const at = publishedMs(c);
    if (now.getTime() - at > VIRAL_WINDOW_DAYS * DAY) break; // sorted desc — nothing further qualifies
    const views = organicViews(c);
    if (views === null) continue;
    const qualifies = enoughSample ? views >= VIRAL_MIN_VIEWS && med && views >= med * VIRAL_MULTIPLIER : views >= VIRAL_LOW_SAMPLE_MIN_VIEWS;
    if (!qualifies) continue;
    out.push({
      kind: "viral",
      severity: "good",
      title: t("pulse.viral.title", { title: contentTitle(c) }),
      detail: enoughSample ? t("pulse.viral.detailMedian", { views, median: Math.round(med) }) : t("pulse.viral.detailLow", { views }),
      refs: { contentId: c.id },
      at,
      key: `viral:${c.id}:${isoWeekKey(at)}`,
    });
  }
  return out;
}

function signalTopFormat(content, settings, now) {
  const cutoff = now.getTime() - TOP_FORMAT_WINDOW_DAYS * DAY;
  const recent = content.filter((c) => c.status === "published" && publishedMs(c) !== null && publishedMs(c) >= cutoff);
  const brandEr = mean(recent.map((c) => erOf(c, settings)).filter((v) => v !== null));
  if (!brandEr || brandEr <= 0) return [];
  const groups = new Map();
  recent.forEach((c) => {
    if (!c.format || !c.funnel) return;
    const key = `${c.format}::${c.funnel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  const out = [];
  for (const [key, posts] of groups) {
    if (posts.length < TOP_FORMAT_MIN_POSTS) continue;
    const groupEr = mean(posts.map((c) => erOf(c, settings)).filter((v) => v !== null));
    if (!groupEr || groupEr < brandEr * TOP_FORMAT_MULTIPLIER) continue;
    const [format, funnel] = key.split("::");
    const at = Math.max(...posts.map((c) => publishedMs(c)));
    out.push({
      kind: "top-format",
      severity: "good",
      title: t("pulse.topFormat.title", { format, funnel }),
      detail: t("pulse.topFormat.detail", { count: posts.length, er: groupEr.toFixed(1), brandEr: brandEr.toFixed(1) }),
      refs: {},
      at,
      key: `top-format:${key}:${isoWeekKey(now.getTime())}`,
    });
  }
  return out;
}

function signalEngagementDrop(content, settings, now) {
  const published = content.filter((c) => c.status === "published" && publishedMs(c) !== null).sort((a, b) => publishedMs(b) - publishedMs(a));
  const recent = published.slice(0, ENGAGEMENT_DROP_RECENT_N).map((c) => erOf(c, settings)).filter((v) => v !== null);
  const prev = published.slice(ENGAGEMENT_DROP_RECENT_N, ENGAGEMENT_DROP_RECENT_N + ENGAGEMENT_DROP_PREV_N).map((c) => erOf(c, settings)).filter((v) => v !== null);
  if (recent.length < ENGAGEMENT_DROP_MIN_SAMPLE || prev.length < ENGAGEMENT_DROP_MIN_SAMPLE) return [];
  const recentMean = mean(recent);
  const prevMean = mean(prev);
  if (!prevMean || recentMean > prevMean * ENGAGEMENT_DROP_MULTIPLIER) return [];
  const at = now.getTime();
  return [{
    kind: "engagement-drop",
    severity: "warn",
    title: t("pulse.engagementDrop.title"),
    detail: t("pulse.engagementDrop.detail", { recent: recentMean.toFixed(1), prev: prevMean.toFixed(1) }),
    refs: {},
    at,
    key: `engagement-drop::${isoWeekKey(at)}`,
  }];
}

function signalFollowers(brand, now) {
  const history = brand?.insightsHistory || [];
  const byPlatform = new Map();
  history.forEach((h) => {
    if (!h.platform || h.followers === null || h.followers === undefined) return;
    if (!byPlatform.has(h.platform)) byPlatform.set(h.platform, []);
    byPlatform.get(h.platform).push(h);
  });
  const out = [];
  for (const [platform, list] of byPlatform) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    if (sorted.length < 2) continue;
    const prev = sorted[sorted.length - 2];
    const latest = sorted[sorted.length - 1];
    if (!prev.followers) continue;
    const delta = latest.followers - prev.followers;
    const pct = (delta / prev.followers) * 100;
    if (pct >= FOLLOWER_JUMP_PCT || delta >= FOLLOWER_JUMP_ABS) {
      out.push({
        kind: "follower-jump",
        severity: "good",
        title: t("pulse.followerJump.title", { platform }),
        detail: t("pulse.followerJump.detail", { delta, pct: pct.toFixed(1) }),
        refs: { platform },
        at: latest.at,
        key: `follower-jump:${platform}:${isoWeekKey(latest.at)}`,
      });
    } else if (pct <= FOLLOWER_DROP_PCT) {
      out.push({
        kind: "follower-drop",
        severity: "warn",
        title: t("pulse.followerDrop.title", { platform }),
        detail: t("pulse.followerDrop.detail", { delta, pct: pct.toFixed(1) }),
        refs: { platform },
        at: latest.at,
        key: `follower-drop:${platform}:${isoWeekKey(latest.at)}`,
      });
    }
  }
  return out;
}

function signalSales(brand, now) {
  const tracker = getTracker(brand);
  // weeklySeries's last entry is the current (possibly unfinished) week —
  // ask for one extra week and drop it, so "minggu penuh terakhir" really
  // is a completed Mon–Sun week, with SALES_PREVIOUS_WEEKS full weeks
  // before it to average.
  const weeks = weeklySeries(tracker, SALES_PREVIOUS_WEEKS + 2, now);
  const lastFull = weeks[weeks.length - 2];
  const previous = weeks.slice(0, weeks.length - 2);
  if (!lastFull || previous.length < SALES_PREVIOUS_WEEKS) return [];
  const entryCount = tracker.entries.filter((e) => e.date >= previous[0].from && e.date <= lastFull.to).length;
  if (entryCount < SALES_MIN_ENTRIES) return [];
  const prevAvg = mean(previous.map((w) => w.revenue));
  if (!prevAvg) return [];
  const pct = ((lastFull.revenue - prevAvg) / prevAvg) * 100;
  const at = new Date(lastFull.to + "T12:00:00").getTime();
  if (pct >= SALES_CHANGE_PCT) {
    return [{
      kind: "sales-up",
      severity: "good",
      title: t("pulse.salesUp.title"),
      detail: t("pulse.salesUp.detail", { pct: Math.round(pct) }),
      refs: {},
      at,
      key: `sales-up::${isoWeekKey(at)}`,
    }];
  }
  if (pct <= -SALES_CHANGE_PCT) {
    return [{
      kind: "sales-down",
      severity: "warn",
      title: t("pulse.salesDown.title"),
      detail: t("pulse.salesDown.detail", { pct: Math.round(Math.abs(pct)) }),
      refs: {},
      at,
      key: `sales-down::${isoWeekKey(at)}`,
    }];
  }
  return [];
}

// A post the owner tagged sales to (Sales Tracker "Dari mana penjualan
// ini?") — the strongest "make more like this" hint the app has.
function signalContentSales(brand, content, now) {
  const since = localISODate(new Date(now.getTime() - CONTENT_SALES_WINDOW_DAYS * DAY));
  const byContent = new Map();
  getTracker(brand).entries.forEach((e) => {
    const id = e.source?.contentId;
    if (!id || e.date < since) return;
    const row = byContent.get(id) || { qty: 0, revenue: 0, last: "" };
    row.qty += e.qty; row.revenue += e.amount; if (e.date > row.last) row.last = e.date;
    byContent.set(id, row);
  });
  const out = [];
  for (const [id, row] of byContent) {
    if (row.qty < CONTENT_SALES_MIN_QTY) continue;
    const c = content.find((x) => x.id === id);
    if (!c) continue;
    const at = new Date(row.last + "T12:00:00").getTime();
    out.push({
      kind: "content-sales",
      severity: "good",
      title: t("pulse.contentSales.title", { title: contentTitle(c) }),
      detail: t("pulse.contentSales.detail", { qty: row.qty, revenue: Math.round(row.revenue).toLocaleString("id-ID"), days: CONTENT_SALES_WINDOW_DAYS }),
      refs: { contentId: id },
      at,
      key: `content-sales:${id}:${isoWeekKey(at)}`,
    });
  }
  return out;
}

function signalStreakBreak(content, now) {
  const streak = streakBreakInDays(content, STREAK_BREAK_MAX_DAYS);
  if (!streak) return [];
  const at = now.getTime();
  return [{
    kind: "streak-break",
    severity: "warn",
    title: t("pulse.streakBreak.title", { weeks: streak.weeks }),
    detail: t("pulse.streakBreak.detail", { days: streak.days }),
    refs: {},
    at,
    key: `streak-break::${isoWeekKey(at)}`,
  }];
}

// Overdue count defaults to a same-brand count from `content` (scheduled,
// past its date, not yet published) — the caller only needs to pass its own
// `overdueCount` when it already has one handy (e.g. the topbar bell's
// cross-brand scan, js/store.js listOverdueAndDueSoon) and wants to avoid
// computing it twice.
function computeOverdueCount(content, now) {
  const today = localISODate(now);
  return content.filter((c) => c.scheduleDate && c.scheduleDate < today && c.status !== "published").length;
}
function signalOverdue(overdueCount, now) {
  if (!overdueCount || overdueCount < 1) return [];
  const at = now.getTime();
  return [{
    kind: "overdue",
    severity: "warn",
    title: t("pulse.overdue.title", { count: overdueCount }),
    detail: t("pulse.overdue.detail"),
    refs: {},
    at,
    key: `overdue::${isoWeekKey(at)}`,
  }];
}

// campaignReadings: [{ campaign, headline }], headline being the result of
// js/campaign-metrics.js campaignHeadline(...) for that campaign's active
// stage. Built here by default from `campaigns`/`content`/`settings`/
// `brand` (all pure, ctx-in data already on hand); a caller that already
// computed these for something else (e.g. js/next-action.js brandTopAction)
// may pass its own to skip the recompute.
function buildCampaignReadings({ brand, content, campaigns, settings }) {
  return campaigns
    .filter((c) => !["archived", "completed"].includes(c.status))
    .map((campaign) => {
      const stages = campaignStages(campaign);
      const idx = activeStageIndex(campaign, stages, content);
      const headline = stages[idx] ? campaignHeadline(campaign, stages, idx, { brand, campaign, content, settings }) : null;
      return { campaign, headline };
    });
}
function signalStaleCampaigns(campaignReadings, now) {
  const out = [];
  (campaignReadings || []).forEach(({ campaign, headline }) => {
    if (!headline?.reading?.stale) return;
    const at = now.getTime();
    out.push({
      kind: "stale-campaign",
      severity: "info",
      title: t("pulse.staleCampaign.title", { name: campaign.name || t("camp.untitled") }),
      detail: t("pulse.staleCampaign.detail"),
      refs: { campaignId: campaign.id },
      at,
      key: `stale-campaign:${campaign.id}:${isoWeekKey(at)}`,
    });
  });
  return out;
}

function signalCross({ brand, content, campaigns, settings }, now) {
  const insights = crossCampaignInsights({ campaigns, content, brand, settings }) || [];
  const at = now.getTime();
  return insights.map((insight) => ({
    kind: "cross",
    severity: "info",
    title: insight.text,
    detail: insight.detail,
    refs: {},
    at,
    key: `cross:${insight.id}:${isoWeekKey(at)}`,
  }));
}

// ---------- Public API ----------
export function computeSignals({ brand, content = [], campaigns = [], settings, overdueCount = null, campaignReadings = null, now = new Date() }) {
  if (!brand || !settings) return [];
  const overdue = overdueCount === null ? computeOverdueCount(content, now) : overdueCount;
  const readings = campaignReadings === null ? buildCampaignReadings({ brand, content, campaigns, settings }) : campaignReadings;
  return [
    ...signalViral(content, now),
    ...signalTopFormat(content, settings, now),
    ...signalEngagementDrop(content, settings, now),
    ...signalFollowers(brand, now),
    ...signalSales(brand, now),
    ...signalContentSales(brand, content, now),
    ...signalStreakBreak(content, now),
    ...signalOverdue(overdue, now),
    ...signalStaleCampaigns(readings, now),
    ...signalCross({ brand, content, campaigns, settings }, now),
  ].sort((a, b) => b.at - a.at);
}

// Merges freshly computed `signals` (may not be persisted yet) with the
// brand's persisted `log` (brand.developmentLog — past auto signals plus
// the moments the owner confirmed from Companion recaps), dedupes by `key`
// (the fresher copy of a repeated signal wins), sorts newest first, and
// renders a short block ready to paste into an AI prompt. Only `auto` and
// `moment` sources are rendered: the raw Companion chat never goes through
// here (it lives in its own thread), and any leftover `note`/`ai` entries
// from the earlier design are skipped so they stop reaching AI features
// even before the owner deletes them from Brand memory. "" when there's
// nothing to say — callers skip the section entirely then.
const PULSE_SOURCES = new Set(["auto", "moment"]);
export function buildPulseText(signals = [], log = [], { limit = 8 } = {}) {
  const byKey = new Map();
  (log || []).forEach((entry) => { if (entry?.key && PULSE_SOURCES.has(entry.source || "auto")) byKey.set(entry.key, entry); });
  (signals || []).forEach((s) => { if (s?.key) byKey.set(s.key, { ...s, source: s.source || "auto" }); });
  const merged = [...byKey.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
  if (!merged.length) return "";
  const now = new Date();
  const lines = merged.map((entry) => {
    if ((entry.source || "auto") === "auto") {
      const when = daysAgoLabel(entry.at, now);
      return `[${t("pulse.log.auto")}] ${when}: ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`;
    }
    const iso = new Date(entry.at).toISOString().slice(0, 10);
    return `[${t("pulse.log.moment")}] ${iso}: ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`;
  });
  return [t("pulse.header"), ...lines, t("pulse.footer")].join("\n");
}

// One-call convenience for the many AI call sites that just want "this
// brand's pulse text, right now" without wiring computeSignals + the
// developmentLog lookup + buildPulseText themselves every time. Each caller
// still computes this once per action (never cached) — the whole pass is
// synchronous array work over data already in memory, not a network call.
// Also carries what the brand has learned (js/brand-learning.js: best
// posts with their hooks, the owner's 👍/👎 taste, monthly lessons), so
// every AI feature that reads the pulse writes with it.
export function pulseTextFor(brand, { content = [], campaigns = [], settings } = {}) {
  if (!brand || !settings) return "";
  const pulse = buildPulseText(computeSignals({ brand, content, campaigns, settings }), brand.developmentLog || []);
  const learned = learningText(brand, { content, settings });
  return [pulse, learned].filter(Boolean).join("\n\n");
}

// The single most notable signal right now — what the Teman tab's greeting
// and the Home card's one-liner both mention, in the same order, so the two
// never disagree about what stands out.
const TOP_SIGNAL_PRIORITY = ["viral", "content-sales", "sales-down", "follower-jump", "follower-drop", "engagement-drop", "streak-break", "top-format", "sales-up", "stale-campaign", "overdue", "cross"];
export function topSignal(signals = []) {
  for (const kind of TOP_SIGNAL_PRIORITY) {
    const hit = signals.find((s) => s.kind === kind);
    if (hit) return hit;
  }
  return null;
}
