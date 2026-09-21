// Roadmap ke Tujuan — the engine. A "goal" (today: one event with a date)
// sits above campaigns: this file reads the brand's own numbers and works
// BACKWARD from the goal's date to a dated plan of lanes (campaigns), weekly
// content slots and milestone deadlines. Pure: plain data in, plain data
// out, no DOM and no writes (installing a plan is js/goal-actions.js).
//
// Rules first, AI never: every date, capacity and target below is computed
// deterministically from data already in the app (insights, cadence,
// published history, the running campaigns, Brand Pulse). A number the app
// doesn't have is reported as `unknown` and asked for once — never guessed.
// The constants are working rules of thumb, same caveat as js/goal-plan.js:
// tune them against real Wepeka client data.
//
// Lanes:
//   event     the Event campaign itself (js/store.js buildEventPhases) — its
//             phases keep their template names, and its "check" milestones
//             get real due dates.
//   audience  a Social Growth campaign that builds the audience the event
//             needs, only when the runway is long enough AND followers are
//             short of what the crowd needs.
//   community a goal-owned lane (tasks + slots, no new Grow campaign): invite
//             the existing community first, before the public hears of it.
//   rhythm    only when Brand Pulse sees the posting streak broke and no
//             audience lane already keeps the account moving.
import {
  buildEventPhases, eventPhaseTemplatesForRole, nominalEventRunway, eventScaleFor, eventLeanLevel, daysBetween, localISODate,
  getBrandInsights, EVENT_SHOW_UP_RATE,
} from "./store.js";
import { assessGoal, brandBaseline } from "./goal-plan.js";
import { identityDone } from "./brand-progress.js";
import { computeSignals } from "./brand-pulse.js";
import { getTracker } from "./sales-tracker.js";
import { t } from "./i18n.js";

// ---------- Rules of thumb ----------
export const AUDIENCE_PER_SEAT = 15; // followers needed per seat: ~1 in 15 of an audience shows up to a first onsite event
export const DEFAULT_CAPACITY = 2; // posts/week when the brand has neither a cadence nor a history
export const PRE_LANE_MIN_DAYS = 14; // a lane before the event needs at least two weeks to mean anything
export const MIN_RUNWAY_DAYS = 14; // below this an event is plotted anyway, but flagged as too tight
export const LONG_RUNWAY_DAYS = 180; // beyond this only the next HORIZON_DAYS get slots; the rest is "not yet time"
export const HORIZON_DAYS = 56;
export const BUFFER_DAYS = 2; // deadline = end of window minus this…
export const FIRST_EVENT_BUFFER_DAYS = 3; // …one day more for a brand's first event
const FOLLOWERS_STALE_DAYS = 30;
const HISTORY_WINDOW_DAYS = 56;
const COMMUNITY_WINDOW_BEFORE = 14; // the community hears about it this long before the public does
const COMMUNITY_WINDOW_AFTER = 13;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_UPLOAD_ORDER = ["tue", "thu", "sat", "mon", "wed", "fri", "sun"];

// ---------- Local-calendar date maths (never toISOString: UTC shifts a day in WIB) ----------
export function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return localISODate(d);
}
export const weekStart = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return addDays(dateStr, -((d.getDay() + 6) % 7)); // Monday
};
const weekdayOf = (dateStr) => WEEKDAYS[new Date(`${dateStr}T00:00:00`).getDay()];
function eachDay(from, to) {
  const out = [];
  for (let d = from; d && d <= to && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}
export const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00`).getTime());

// Largest-remainder split of `total` across `weights`, each at least 1 when
// there is room for that — keeps "sum of the parts = the whole" exact.
function apportion(total, weights) {
  const n = weights.length;
  if (!n) return [];
  if (total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0) || n;
  const raw = weights.map((w) => (total * (sum ? w : 1)) / (sum || n));
  const out = raw.map((r) => Math.floor(r));
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  if (total >= n) out.forEach((v, i) => { if (v === 0) { const j = out.indexOf(Math.max(...out)); out[j] -= 1; out[i] = 1; } });
  return out;
}

// ============================================================
// 1. Reading the brand
// ============================================================

// The platform the audience number comes from: the one with the most
// followers on record (Instagram when nothing is recorded yet).
function primaryPlatform(brand) {
  const ins = brand?.insights || {};
  const best = Object.entries(ins).filter(([, v]) => v && Number(v.followers) > 0).sort((a, b) => Number(b[1].followers) - Number(a[1].followers))[0];
  return best ? best[0] : "instagram";
}

const running = (c) => c && !["archived", "completed"].includes(c.status);

// input: { brand, content, campaigns, settings, today, inputs }
// Every row: { key, status: ok|warn|bad|unknown, label, value, source, effect }.
export function readCondition({ brand, content = [], campaigns = [], settings = null, today = localISODate(), inputs = {} }) {
  const rows = [];
  const platform = inputs.platform || primaryPlatform(brand);

  // -- Followers
  const ins = getBrandInsights(brand, platform);
  const typed = inputs.followers !== undefined && inputs.followers !== null && inputs.followers !== "" ? Math.max(0, Number(inputs.followers) || 0) : null;
  const recorded = ins && Number.isFinite(Number(ins.followers)) ? Number(ins.followers) : null;
  const followers = typed ?? recorded;
  const followersAt = typed !== null ? null : ins?.updatedAt || null;
  const followersAge = followersAt ? Math.max(0, daysBetween(localISODate(new Date(followersAt)), today)) : null;
  const followersStale = typed === null && recorded !== null && followersAge !== null && followersAge > FOLLOWERS_STALE_DAYS;
  rows.push({
    key: "followers", status: followers === null ? "unknown" : followersStale ? "warn" : "ok",
    stale: followersStale, age: followersAge, platform,
    value: followers === null ? t("roadmap.read.unknown") : Number(followers).toLocaleString(),
    source: followers === null ? t("roadmap.read.followers.src.none") : typed !== null ? t("roadmap.read.src.typed") : t("roadmap.read.followers.src.insights", { platform, days: followersAge ?? "?" }),
  });

  // -- Community (a running Community Growth campaign; else what was typed)
  const communityCampaign = campaigns.filter(running).find((c) => c.goalPlan?.track === "community") || null;
  let members = null;
  if (communityCampaign) {
    const logged = communityCampaign.manualMetrics?.members?.value;
    members = Math.max(0, Number(logged ?? communityCampaign.goalPlan?.current?.members ?? 0) || 0);
  } else if (inputs.members !== undefined && inputs.members !== null && inputs.members !== "") {
    members = Math.max(0, Number(inputs.members) || 0);
  }
  const hasCommunity = members !== null && members > 0;
  rows.push({
    key: "community", status: hasCommunity ? "ok" : "unknown", campaignId: communityCampaign?.id || null,
    value: hasCommunity ? t("roadmap.read.community.members", { n: members }) : t("roadmap.read.community.none"),
    source: communityCampaign ? t("roadmap.read.community.src.campaign") : hasCommunity ? t("roadmap.read.src.typed") : t("roadmap.read.followers.src.none"),
  });

  // -- Capacity: what this brand can really post per week
  const cad = brand?.contentCadence;
  const cadenceDays = cad?.configured && (cad.uploadDays || []).length ? cad.uploadDays.filter((d) => WEEKDAYS.includes(d)) : [];
  const perDay = Math.max(1, Number(cad?.perDay) || 1);
  const cadencePerWeek = cadenceDays.length ? cadenceDays.length * perDay : null;
  const since = addDays(today, -HISTORY_WINDOW_DAYS);
  const recentPublished = content.filter((c) => c.status === "published" && c.publishedDate && c.publishedDate >= since && c.publishedDate <= today).length;
  const historyTrusted = recentPublished >= 4;
  const realized = historyTrusted ? recentPublished / (HISTORY_WINDOW_DAYS / 7) : null;
  const typedCap = Number(inputs.capacityPerWeek) > 0 ? Math.min(21, Math.round(Number(inputs.capacityPerWeek))) : null;
  let capacity;
  if (typedCap) capacity = { perWeek: typedCap, source: "input" };
  else if (cadencePerWeek && realized !== null) capacity = { perWeek: Math.min(cadencePerWeek, Math.max(1, Math.round(realized))), source: "history" };
  else if (cadencePerWeek) capacity = { perWeek: cadencePerWeek, source: "cadence" };
  else if (realized !== null) capacity = { perWeek: Math.max(1, Math.round(realized)), source: "history" };
  else capacity = { perWeek: DEFAULT_CAPACITY, source: "default" };
  capacity.realized = realized;
  capacity.cadencePerWeek = cadencePerWeek;
  capacity.perDay = perDay;
  capacity.uploadDays = cadenceDays.length ? cadenceDays : DEFAULT_UPLOAD_ORDER.slice(0, Math.min(7, Math.max(3, capacity.perWeek)));
  rows.push({
    key: "rhythm", status: capacity.source === "default" ? "unknown" : "ok",
    value: t("roadmap.read.rhythm.value", { n: capacity.perWeek }),
    source: t(`roadmap.read.rhythm.src.${capacity.source}`, { n: realized !== null ? Math.round(realized * 10) / 10 : "" }),
  });

  // -- Engagement baseline
  const baseline = brandBaseline(content, settings || undefined);
  rows.push({
    key: "engagement", status: baseline.enough ? "ok" : "unknown",
    value: baseline.enough ? t("roadmap.read.engagement.value", { shares: Math.round(baseline.shares * 10) / 10, saves: Math.round(baseline.saves * 10) / 10 }) : t("roadmap.read.engagement.few", { n: baseline.posts }),
    source: baseline.enough ? t("roadmap.read.engagement.src", { n: baseline.posts }) : t("roadmap.read.engagement.srcFew"),
  });

  // -- Offer / ticket: from Sales Tracker when a product looks like one
  let ticket = null;
  try {
    ticket = (getTracker(brand)?.products || []).find((p) => !p.archived && /tiket|ticket|daftar|registr|seat|kursi|event/i.test(p.name || "")) || null;
  } catch { ticket = null; }
  const ticketPrice = Number(inputs.ticketPrice) > 0 ? Number(inputs.ticketPrice) : ticket?.price || null;
  const ticketed = inputs.ticketed === true || (inputs.ticketed !== false && !!ticket);
  rows.push({
    key: "offer", status: ticketed ? (ticketPrice ? "ok" : "warn") : "unknown",
    value: ticketed ? (ticketPrice ? `Rp ${Number(ticketPrice).toLocaleString()}` : t("roadmap.read.offer.noPrice")) : t("roadmap.read.offer.free"),
    source: ticket ? t("roadmap.read.offer.src.tracker") : ticketed ? t("roadmap.read.src.typed") : t("roadmap.read.offer.src.none"),
  });

  // -- Identity
  const identity = identityDone(brand);
  rows.push({ key: "identity", status: identity ? "ok" : "warn", value: identity ? t("roadmap.read.identity.done") : t("roadmap.read.identity.todo"), source: t("roadmap.read.identity.src") });

  // -- Pulse
  let signalKinds = [];
  try { signalKinds = computeSignals({ brand, content, campaigns, settings: settings || undefined }).map((s) => s.kind); } catch { signalKinds = []; }

  const priorEvents = campaigns.filter((c) => c.eventPlan && c.status === "completed").length;
  const socialCampaign = campaigns.filter(running).find((c) => c.goalPlan?.track === "social" && (c.goalPlan.platform || "instagram") === platform) || null;

  return {
    platform, followers, followersStale, followersAge,
    community: { exists: hasCommunity, members: members || 0, campaignId: communityCampaign?.id || null },
    capacity, baseline, identity, signalKinds, ticketed, ticketPrice,
    firstEvent: priorEvents === 0,
    socialCampaignId: socialCampaign?.id || null,
    rows,
  };
}

// ============================================================
// 2. Planning
// ============================================================

// Titles for slots. Cycled per (lane, funnel) so a phase doesn't read as one
// sentence repeated; `{event}` is the goal's own name.
const TITLE_VARIANTS = { "event.TOFU": 3, "event.MOFU": 3, "event.BOFU": 2, "audience.TOFU": 3, "audience.MOFU": 2, "audience.BOFU": 1, "community.MOFU": 2, "rhythm.TOFU": 1 };
function slotTitle(laneKind, funnel, n, name) {
  const key = `${laneKind}.${funnel}`;
  const variants = TITLE_VARIANTS[key] || TITLE_VARIANTS[`${laneKind}.MOFU`] || 1;
  const k = TITLE_VARIANTS[key] ? key : TITLE_VARIANTS[`${laneKind}.MOFU`] ? `${laneKind}.MOFU` : `${laneKind}.TOFU`;
  return t(`roadmap.slot.${k}.${(n % variants) + 1}`, { event: name });
}

// Which funnel stage a slot serves, from where it sits in the journey.
function funnelFor(phaseIdx, phaseCount, n) {
  const f = phaseCount <= 1 ? 0.5 : phaseIdx / (phaseCount - 1);
  if (f < 0.34) return ["TOFU", "MOFU", "TOFU"][n % 3];
  if (f < 0.67) return ["TOFU", "MOFU", "MOFU"][n % 3];
  return ["MOFU", "BOFU", "BOFU"][n % 3];
}

// Gives every "check" milestone a real due date inside its phase's window:
// spread evenly, the last one `buffer` days before the window closes.
function assignDueDates(phases, buffer) {
  phases.forEach((p) => {
    const checks = (p.milestones || []).filter((m) => m.kind === "check");
    if (!checks.length) return;
    const last = p.dateTo > addDays(p.dateFrom, buffer) ? addDays(p.dateTo, -buffer) : p.dateFrom;
    const span = Math.max(0, daysBetween(p.dateFrom, last));
    checks.forEach((m, i) => { m.dueDate = addDays(p.dateFrom, m.required === false ? span : Math.round((span * (i + 1)) / checks.length)); });
  });
}

// A phase's content demand: what the template asks in "konten" units. The
// "video" rows are a format of the same posts, not extra posts.
const contentDemand = (phase) => (phase.milestones || []).filter((m) => m.unit === "konten" && m.target).reduce((a, m) => a + m.target, 0);

// Keeps ids and state of milestones that already exist (a re-plot must not
// forget what was ticked): matched by label within the whole plan.
function carryMilestoneState(newPhases, oldPhases) {
  const old = new Map();
  (oldPhases || []).forEach((p) => (p.milestones || []).forEach((m) => { if (!old.has(m.label)) old.set(m.label, m); }));
  newPhases.forEach((p) => (p.milestones || []).forEach((m) => {
    const o = old.get(m.label);
    if (!o) return;
    m.id = o.id;
    m.done = !!o.done;
    m.value = o.value ?? null;
    if (o.notApplicable) m.notApplicable = true;
    if (o.custom) m.custom = true;
  }));
}

// input: { goal, brand, content, campaigns, settings, today, prevPhases }
// goal.inputs: { eventName, role, participationType, expectedAudience,
//   capacityPerWeek, followers, members, ticketed, ticketPrice, location, objectives }
export function planRoadmap({ goal, brand, content = [], campaigns = [], settings = null, today = localISODate(), prevPhases = null }) {
  // Milestones the owner deleted stay deleted through every re-plot.
  const skip = new Set((goal.inputs?.removedMilestones) || []);
  const inputs = goal.inputs || {};
  const warnings = [];
  const w = (code, level, vars = {}) => warnings.push({ code, level, vars });
  const target = goal.targetDate;
  const start = goal.startDate && goal.startDate > today ? goal.startDate : today;
  const errors = [];
  if (!isISODate(target)) errors.push("noDate");
  else if (target <= today) errors.push("pastDate");
  if (errors.length) return { errors, warnings, lanes: [], slots: [], tasks: [], conflicts: [] };

  const cond = readCondition({ brand, content, campaigns, settings, today, inputs });
  const name = String(inputs.eventName || goal.name || "").trim() || t("roadmap.defaultName");
  const role = inputs.role || "organizer";
  const templates = eventPhaseTemplatesForRole(role, inputs.participationType);
  if (!templates.length) return { errors: ["noRole"], warnings, lanes: [], slots: [], tasks: [], conflicts: [] };
  const seats = Math.max(0, Math.round(Number(inputs.expectedAudience) || 0));

  // ---- Timeline: the event lane keeps its nominal length; time before it
  // is for the lanes that build what the event needs.
  const runway = daysBetween(start, target);
  const nominal = nominalEventRunway(templates);
  const preSpan = runway > nominal + 28 ? runway - (nominal + 14) : 0;
  const eventStart = preSpan ? addDays(target, -(nominal + 14)) : start;
  if (runway < MIN_RUNWAY_DAYS) w("tooShort", "warn", { days: runway });
  if (runway > LONG_RUNWAY_DAYS) w("longRunway", "info", { weeks: Math.round(HORIZON_DAYS / 7) });
  if (cond.firstEvent) w("firstEvent", "info", { days: FIRST_EVENT_BUFFER_DAYS });
  if (cond.followersStale) w("staleFollowers", "warn", { days: cond.followersAge });
  if (cond.followers === null) w("noFollowers", "warn");
  if (!cond.identity) w("noIdentity", "info");
  const reachable = (cond.followers || 0) + (cond.community.members || 0);
  if (seats > 0 && cond.followers !== null && seats > reachable * 2) w("unrealisticSeats", "warn", { seats, followers: cond.followers, suggest: Math.max(10, Math.round(reachable / AUDIENCE_PER_SEAT / 5) * 5) });

  const horizonEnd = runway > LONG_RUNWAY_DAYS ? addDays(start, HORIZON_DAYS) : null;

  // ---- Event lane
  const phases = buildEventPhases(templates, { eventDate: target, campaignStartDate: eventStart, scaleId: eventScaleFor(seats).id, expectedAudience: seats || null });
  if (skip.size) phases.forEach((p) => { p.milestones = p.milestones.filter((m) => !skip.has(m.label)); });
  assignDueDates(phases, cond.firstEvent ? FIRST_EVENT_BUFFER_DAYS : BUFFER_DAYS);
  const lean = eventLeanLevel(seats || null, eventScaleFor(seats).id);
  if (lean) w("leanEvent", "info", { seats, n: phases.reduce((a, p) => a + p.milestones.length, 0), level: lean });
  if (prevPhases) carryMilestoneState(phases, prevPhases);
  const lanes = [{
    id: "event", kind: "event", name, startDate: eventStart, endDate: target, role,
    phases: phases.map((p) => ({ id: p.id, name: p.name, dateFrom: p.dateFrom, dateTo: p.dateTo, preEvent: p.preEvent, slots: 0, demand: contentDemand(p) })),
  }];

  // ---- Audience lane
  let audience = null;
  const needed = seats * AUDIENCE_PER_SEAT;
  const cadCap = cond.capacity.perWeek;
  if (preSpan >= PRE_LANE_MIN_DAYS && cond.followers !== null && seats > 0 && cond.followers < needed) {
    const growthMonths = Math.max(1, daysBetween(start, addDays(target, -14)) / 30.4);
    const a = assessGoal({ current: cond.followers, target: needed, months: growthMonths, uploadsPerWeek: cadCap });
    const feasible = a.verdict === "realistic" || a.verdict === "ambitious";
    const goalFollowers = feasible ? needed : Math.max(cond.followers + 1, a.realistic || cond.followers + 1);
    audience = { platform: cond.platform, current: cond.followers, needed, target: goalFollowers, verdict: a.verdict || "invalid", months: Math.max(1, Math.round(growthMonths)), reuseCampaignId: cond.socialCampaignId };
    if (!feasible) w("audienceGap", "warn", { needed, target: goalFollowers });
    lanes.push({ id: "audience", kind: "audience", name: t("roadmap.lane.audience"), startDate: start, endDate: addDays(eventStart, -1), platform: cond.platform, followersTarget: goalFollowers });
  }

  else if (preSpan >= PRE_LANE_MIN_DAYS && cond.followers !== null && seats > 0) w("audienceOk", "info", { seats, date: eventStart });

  // ---- Community lane (no new Grow campaign — tasks and slots)
  const tasks = [];
  if (cond.community.exists && runway >= 28) {
    const cStart = preSpan ? (addDays(eventStart, -COMMUNITY_WINDOW_BEFORE) > start ? addDays(eventStart, -COMMUNITY_WINDOW_BEFORE) : start) : start;
    const cEnd = addDays(preSpan ? eventStart : start, COMMUNITY_WINDOW_AFTER);
    lanes.push({ id: "community", kind: "community", name: t("roadmap.lane.community"), startDate: cStart, endDate: cEnd < target ? cEnd : addDays(target, -1), campaignId: cond.community.campaignId });
    tasks.push({ id: "community|invite", laneId: "community", label: t("roadmap.task.invite", { n: cond.community.members }), dueDate: addDays(cStart, 7) < target ? addDays(cStart, 7) : cStart, done: false });
    if (cond.ticketed) {
      const aw = phases.find((p) => p.preEvent && p !== phases[0]) || phases[0];
      tasks.push({ id: "community|presale", laneId: "community", label: t("roadmap.task.presale"), dueDate: aw ? addDays(aw.dateFrom, -1) : cStart, done: false });
    }
  } else if (!cond.community.exists && preSpan >= 28) {
    w("noCommunity", "info");
  }

  // ---- Rhythm lane (only when the streak broke and nothing else keeps the account moving)
  if (cond.signalKinds.includes("streak-break") && !audience) {
    lanes.push({ id: "rhythm", kind: "rhythm", name: t("roadmap.lane.rhythm"), startDate: start, endDate: addDays(start, 20) < target ? addDays(start, 20) : addDays(target, -1) });
  }

  // ---- Slots ----
  const cap = cond.capacity.perWeek;
  const perDay = cond.capacity.perDay;
  const uploadDays = new Set(cond.capacity.uploadDays);
  const weekUsed = new Map();
  const dayUsed = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  // Content already on the calendar (not this goal's own) takes capacity first.
  content.filter((c) => c.scheduleDate && c.status !== "published" && !c.archived && c.fromGoal !== goal.id && c.scheduleDate >= start).forEach((c) => {
    bump(weekUsed, weekStart(c.scheduleDate));
    bump(dayUsed, c.scheduleDate);
  });
  // The final push: the last two weeks may run a higher weekly cap than the
  // rest (the owner's choice, offered whenever the plan doesn't fit).
  const push = Number(inputs.pushPerWeek) > cap ? Math.min(21, Math.round(Number(inputs.pushPerWeek))) : 0;
  const pushFrom = addDays(target, -14);
  const capFor = (date) => (push && date >= pushFrom && date <= target ? push : cap);
  const weekFree = (date) => capFor(date) - (weekUsed.get(weekStart(date)) || 0);
  const dayFree = (date) => perDay - (dayUsed.get(date) || 0);
  const canPlace = (date) => weekFree(date) > 0 && dayFree(date) > 0;
  const slots = [];
  const conflicts = [];
  let deferred = 0;

  // Places up to `count` slots inside [from, to]; returns how many fit.
  function place({ laneId, phaseKey, from, to, count, kindForTitle, phaseIdx, phaseCount, titler, front = false }) {
    const lo = from < today ? today : from;
    const hi = horizonEnd && to > horizonEnd ? horizonEnd : to;
    if (horizonEnd && lo > horizonEnd) { deferred += count; return 0; }
    if (lo > hi || count <= 0) return 0;
    const days = eachDay(lo, hi);
    let cands = days.filter((d) => uploadDays.has(weekdayOf(d)));
    if (cands.length * perDay < count) cands = days;
    const chosen = [];
    if (count >= cands.length) chosen.push(...cands);
    else if (front) chosen.push(...cands.slice(0, count));
    else for (let i = 0; i < count; i++) chosen.push(cands[Math.floor(((i + 0.5) * cands.length) / count)]);
    let placed = 0;
    const used = new Set();
    const take = (date) => {
      const n = placed;
      const funnel = kindForTitle === "funnelByPhase" ? funnelFor(phaseIdx, phaseCount, n) : kindForTitle;
      slots.push({ id: `${laneId}|${phaseKey}|${n}`, laneId, phaseId: phaseKey, date, funnel, title: titler(funnel, n, date) });
      bump(weekUsed, weekStart(date));
      bump(dayUsed, date);
      used.add(date);
      placed += 1;
    };
    chosen.forEach((date) => {
      if (canPlace(date) && !used.has(date)) return take(date);
      const alt = cands.filter((d) => !used.has(d) && !chosen.includes(d) && canPlace(d)).sort((a, b) => Math.abs(daysBetween(date, a)) - Math.abs(daysBetween(date, b)))[0];
      if (alt) take(alt);
    });
    return placed;
  }

  // Event lane first — it has priority on capacity.
  const eventLane = lanes[0];
  const isDay = (p) => p.dateFrom === p.dateTo && !p.preEvent;
  // Event day is placed before everything else: its slot must never lose the
  // week to the countdown posts that precede it.
  const order = phases.map((_, i) => i).sort((a, b) => Number(isDay(phases[b])) - Number(isDay(phases[a])) || a - b);
  order.forEach((i) => {
    const p = phases[i];
    const lp = eventLane.phases[i];
    const dayPhase = isDay(p);
    const demand = dayPhase ? Math.max(1, contentDemand(p)) : contentDemand(p);
    const daysLeft = (date) => Math.max(0, daysBetween(date, target));
    const isConversion = p.preEvent && i === phases.filter((x) => x.preEvent).length - 1 && phases.filter((x) => x.preEvent).length > 1;
    lp.demand = demand;
    lp.slots = place({
      laneId: "event", phaseKey: p.id, from: p.dateFrom, to: p.dateTo, count: demand,
      kindForTitle: dayPhase ? "TOFU" : "funnelByPhase", phaseIdx: i, phaseCount: phases.length, front: !p.preEvent && !dayPhase,
      titler: (funnel, n, date) => {
        if (dayPhase) return t("roadmap.slot.event.live", { event: name });
        if (!p.preEvent) return n === 0 ? t("roadmap.slot.event.recap", { event: name }) : t(`roadmap.slot.event.thanks.${(n % 2) + 1}`, { event: name });
        if (isConversion) return t("roadmap.slot.event.countdown", { event: name, days: daysLeft(date) });
        return slotTitle("event", funnel, n, name);
      },
    });
    if (demand > 0 && lp.slots < demand && !(horizonEnd && p.dateFrom > horizonEnd)) conflicts.push({ laneId: "event", phaseId: p.id, phase: p.name, need: demand, fit: lp.slots });
  });
  // Content milestones follow the slots, so the campaign never asks for more
  // than the calendar can hold (see the header: sum of parts = the whole).
  phases.forEach((p, i) => {
    const lp = eventLane.phases[i];
    const ks = (p.milestones || []).filter((m) => m.unit === "konten" && m.target);
    if (!ks.length || lp.slots <= 0 || (horizonEnd && p.dateFrom > horizonEnd)) return;
    const split = apportion(lp.slots, ks.map((m) => m.target));
    ks.forEach((m, j) => { m.target = Math.max(1, split[j]); });
  });

  // Community: one slot a week inside its window.
  const comLane = lanes.find((l) => l.id === "community");
  if (comLane) {
    for (let ws = weekStart(comLane.startDate); ws <= comLane.endDate; ws = addDays(ws, 7)) {
      place({ laneId: "community", phaseKey: `w${ws}`, from: ws > comLane.startDate ? ws : comLane.startDate, to: addDays(ws, 6) < comLane.endDate ? addDays(ws, 6) : comLane.endDate, count: 1, kindForTitle: "MOFU", titler: (f, n) => slotTitle("community", "MOFU", slots.filter((s) => s.laneId === "community").length + n, name) });
    }
  }
  // Rhythm: one light post a week.
  const rhLane = lanes.find((l) => l.id === "rhythm");
  if (rhLane) {
    for (let ws = weekStart(rhLane.startDate); ws <= rhLane.endDate; ws = addDays(ws, 7)) {
      place({ laneId: "rhythm", phaseKey: `w${ws}`, from: ws > rhLane.startDate ? ws : rhLane.startDate, to: addDays(ws, 6) < rhLane.endDate ? addDays(ws, 6) : rhLane.endDate, count: 1, kindForTitle: "TOFU", titler: () => slotTitle("rhythm", "TOFU", 0, name) });
    }
  }
  // Audience: whatever capacity is left each week (the campaign's own
  // "published" target is derived from this rate, see goal-actions.js).
  const audLane = lanes.find((l) => l.id === "audience");
  if (audLane) {
    let idx = 0;
    for (let ws = weekStart(audLane.startDate); ws <= audLane.endDate; ws = addDays(ws, 7)) {
      const from = ws > audLane.startDate ? ws : audLane.startDate;
      const to = addDays(ws, 6) < audLane.endDate ? addDays(ws, 6) : audLane.endDate;
      const free = Math.max(0, Math.min(capFor(from), weekFree(from)));
      if (free > 0) place({ laneId: "audience", phaseKey: `w${ws}`, from, to, count: free, kindForTitle: "funnelByPhase", phaseIdx: idx % 3, phaseCount: 3, titler: (funnel, n) => slotTitle("audience", funnel, idx + n, name) });
      idx += 1;
    }
    const audSlots = slots.filter((s) => s.laneId === "audience").length;
    const audWeeks = Math.max(1, Math.round((daysBetween(audLane.startDate, audLane.endDate) + 1) / 7));
    audLane.slotsPerWeek = Math.max(1, Math.round((audSlots / audWeeks) * 10) / 10);
    if (audience) audience.uploadsPerWeek = Math.max(1, Math.round(audLane.slotsPerWeek));
  }
  if (deferred) w("deferredSlots", "info", { n: deferred });
  // What a final push would have to be to hold everything the last two weeks
  // ask for (the phases that start inside them, Event day included).
  const lateNeed = phases.reduce((a, p, i) => ((p.preEvent || isDay(p)) && p.dateFrom >= pushFrom ? a + eventLane.phases[i].demand : a), 0);
  const suggestPush = conflicts.length && !push && lateNeed ? Math.min(21, Math.max(cap + 1, Math.ceil(lateNeed / 2))) : null;
  if (conflicts.length) w("capacityConflict", "warn", { need: conflicts.reduce((a, c) => a + c.need, 0), fit: conflicts.reduce((a, c) => a + c.fit, 0), perWeek: cap, push: suggestPush || "" });

  slots.sort((a, b) => a.date.localeCompare(b.date) || a.laneId.localeCompare(b.laneId));
  const totalWeeks = Math.max(1, Math.ceil(daysBetween(start, addDays(target, 14)) / 7));
  return {
    version: 1, generatedAt: Date.now(), today, start, target, runwayDays: runway, eventStart, preSpan, horizonEnd,
    capacity: { perWeek: cap, source: cond.capacity.source, push: push || null, suggestPush },
    audience, lanes, slots, tasks, warnings, conflicts, errors: [],
    eventPhases: phases,
    summary: { slots: slots.length, weeks: totalWeeks, perWeekAvg: Math.round((slots.length / totalWeeks) * 10) / 10, fits: conflicts.length === 0 },
    scale: { level: lean, seats, milestones: phases.reduce((a, p) => a + p.milestones.length, 0), removed: skip.size },
    expected: { seats, registrations: seats ? Math.round(seats / EVENT_SHOW_UP_RATE) : null },
    condition: cond.rows,
  };
}

// ============================================================
// 3. Diff (re-plot)
// ============================================================

// old / next: two plans (goal.roadmap shapes). `installed`: goal.installed.
// Reports what would move, appear or go away — the UI shows this before a
// single thing is written.
export function diffPlans(oldPlan, nextPlan, { installedSlots = {}, contentById = () => null } = {}) {
  const oldSlots = new Map((oldPlan?.slots || []).map((s) => [s.id, s]));
  const nextSlots = new Map((nextPlan?.slots || []).map((s) => [s.id, s]));
  const moved = [];
  const added = [];
  const removed = [];
  const kept = [];
  nextSlots.forEach((s, id) => {
    const o = oldSlots.get(id);
    if (!o) return added.push(s);
    if (o.date !== s.date) {
      const rec = installedSlots[id];
      const c = rec?.contentId ? contentById(rec.contentId) : null;
      // A slot the owner already touched (moved by hand, written, published) is theirs — never re-dated.
      const touched = c && (c.status !== "idea" || c.scheduleDate !== rec.date || (c.title || "") !== (rec.title || ""));
      return touched ? kept.push({ ...s, reason: "touched" }) : moved.push({ ...s, from: o.date });
    }
    kept.push(s);
  });
  oldSlots.forEach((o, id) => {
    if (nextSlots.has(id)) return;
    const rec = installedSlots[id];
    const c = rec?.contentId ? contentById(rec.contentId) : null;
    if (c && (c.status !== "idea" || (c.title || "") !== (rec.title || ""))) kept.push({ ...o, reason: "touched" });
    else removed.push(o);
  });
  const dueChanges = [];
  const oldDue = new Map();
  (oldPlan?.eventPhases || []).forEach((p) => (p.milestones || []).forEach((m) => { if (m.dueDate) oldDue.set(m.label, m.dueDate); }));
  (nextPlan?.eventPhases || []).forEach((p) => (p.milestones || []).forEach((m) => { if (m.dueDate && oldDue.get(m.label) && oldDue.get(m.label) !== m.dueDate) dueChanges.push({ label: m.label, from: oldDue.get(m.label), to: m.dueDate }); }));
  const laneIds = (l) => new Set((l || []).map((x) => x.id));
  const before = laneIds(oldPlan?.lanes);
  const after = laneIds(nextPlan?.lanes);
  return {
    moved, added, removed, kept, dueChanges,
    lanesAdded: [...after].filter((x) => !before.has(x)),
    lanesRemoved: [...before].filter((x) => !after.has(x)),
    targetChanged: (oldPlan?.target || "") !== (nextPlan?.target || ""),
    empty: !moved.length && !added.length && !removed.length && !dueChanges.length && before.size === after.size,
  };
}
