// "Rencanakan minggu ini" — the dates and slot maths behind the weekly plan
// card in chat (js/consultant-panel.js). Pure: plain data in, plain data
// out, no DOM and no Firestore reads/writes, so it can be unit-tested and
// run from Node directly.
//
// Rule: the AI never invents a date. This module decides which real
// calendar dates are actually free to post on; the AI only fills a title,
// angle, format and funnel into each one (js/ai.js generateWeekPlan). That
// keeps "don't schedule on a day the owner can't shoot" and "don't double
// up a day that's already got something on it" true no matter what the
// model returns.
import { addDays, weekStart, weekdayOf, isISODate, DEFAULT_UPLOAD_ORDER } from "./goal-roadmap.js";

const FUNNELS = ["TOFU", "MOFU", "BOFU"];
const MAX_COUNT = 14; // a hard ceiling regardless of cadence — this is a week's plan, not a quarter's
const MAX_WEEKS_SPAN = 3; // how far planWeek will reach if a thin cadence can't fill `count` in two weeks

export const normTitle = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");

// Ritme Kerja → how many posts a week is "normal" for this brand. Not
// configured yet: 3, same fallback the campaign content plan uses.
export function defaultWeeklyCount(cadence) {
  if (cadence?.configured && cadence.uploadDays?.length) {
    return Math.max(1, Math.min(MAX_COUNT, cadence.uploadDays.length * Math.max(1, Number(cadence.perDay) || 1)));
  }
  return 3;
}

// Which weekdays are allowed to carry a post. A configured cadence is
// authoritative even if it only names one day. Unconfigured: as many of
// DEFAULT_UPLOAD_ORDER's preferred days as `count` calls for (never fewer
// than 3, so a 1-2 post week still spreads out instead of bunching).
function uploadDaySet(cadence, count) {
  if (cadence?.configured && cadence.uploadDays?.length) return new Set(cadence.uploadDays);
  const need = Math.min(7, Math.max(3, count));
  return new Set(DEFAULT_UPLOAD_ORDER.slice(0, need));
}

// Everything a date already carries, from real content (including goal
// slots — those are ordinary content with `fromGoal`, so one pass over
// `listContent` covers both). Archived and soft-deleted items don't hold a
// day; the day is free again.
function occupancy(content) {
  const map = new Map();
  const bump = (d) => { if (d) map.set(d, (map.get(d) || 0) + 1); };
  for (const c of content || []) {
    if (!c || c.archived || c.deletedAt) continue;
    bump(c.scheduleDate);
    bump(c.publishedDate);
  }
  return map;
}

// The free dates in [start, end] (inclusive), never before `todayISO`,
// respecting the cadence's own upload days and per-day cap. Chronological
// order, capped at `count`.
export function planSlots({ cadence, content = [], start, end, todayISO, count }) {
  if (!isISODate(start) || !isISODate(end)) return [];
  const allowed = uploadDaySet(cadence, count);
  const perDay = cadence?.configured ? Math.max(1, Number(cadence.perDay) || 1) : 1;
  const used = occupancy(content);
  const slots = [];
  for (let d = start; d <= end && slots.length < count; d = addDays(d, 1)) {
    if (todayISO && d < todayISO) continue;
    if (!allowed.has(weekdayOf(d))) continue;
    if ((used.get(d) || 0) >= perDay) continue;
    slots.push(d);
  }
  return slots;
}

// The week to plan, plus its slots. This week if it still has room for at
// least 2 posts (or `count`, if asking for fewer) from today onward;
// otherwise next week. If a thin cadence still can't fill `count` inside
// that one week, keeps reaching into the following week(s) — capped at
// MAX_WEEKS_SPAN so a nearly-unconfigured brand never gets a month-long ask.
export function planWeek({ todayISO, cadence, content = [], count } = {}) {
  const n = Math.max(1, Math.min(MAX_COUNT, Math.round(count) || defaultWeeklyCount(cadence)));
  const mondayThis = weekStart(todayISO);
  const thisEnd = addDays(mondayThis, 6);
  const thisSlots = planSlots({ cadence, content, start: todayISO, end: thisEnd, todayISO, count: n });
  // "Still worth using this week" is relative to what this week could ever
  // give (ignoring the today-floor) — a brand on a genuine 1-post/week
  // cadence shouldn't be bumped to next week just for not clearing a
  // hard-coded "2", when its one weekly slot is still sitting right there.
  const fullWeekCap = planSlots({ cadence, content, start: mondayThis, end: thisEnd, todayISO: mondayThis, count: n }).length;
  const threshold = Math.min(2, fullWeekCap);

  let label, rangeStart, rangeEnd, slots;
  if (thisSlots.length >= threshold) {
    label = "thisWeek"; rangeStart = mondayThis; rangeEnd = thisEnd; slots = thisSlots;
  } else {
    label = "nextWeek";
    rangeStart = addDays(mondayThis, 7);
    rangeEnd = addDays(rangeStart, 6);
    slots = planSlots({ cadence, content, start: rangeStart, end: rangeEnd, todayISO, count: n });
  }

  let weeksUsed = 1;
  while (slots.length < n && weeksUsed < MAX_WEEKS_SPAN) {
    const moreStart = addDays(rangeEnd, 1);
    const moreEnd = addDays(moreStart, 6);
    slots = slots.concat(planSlots({ cadence, content, start: moreStart, end: moreEnd, todayISO, count: n - slots.length }));
    rangeEnd = moreEnd;
    weeksUsed++;
  }
  return { label, start: rangeStart, end: rangeEnd, slots, count: n };
}

// Turns the AI's raw items into the plan's rows, one per slot, in slot
// (chronological) order. Titles are deduped, dates are forced onto a real
// slot (an item's own date wins when it names one of ours; leftovers fill
// whatever's left, in the order the model wrote them), formats that don't
// match this brand's own list are dropped rather than shown wrong, and a
// named campaign becomes campaignId only when it matches an active one by
// name — the owner can always change or clear it afterward in the card.
// `forceCampaign`: the plan was generated FOR one specific campaign (the
// owner picked it before generating, js/consultant-panel.js openWeekPlan) —
// every row belongs to it regardless of what the model wrote in "campaign".
export function normalizePlanItems(raw, slots, { campaigns = [], formats = [], forceCampaign = null } = {}) {
  const campaignByName = new Map((campaigns || []).map((c) => [normTitle(c.name), c]));
  const formatNames = new Set((formats || []).map((f) => normTitle(f)));

  const cleaned = (Array.isArray(raw) ? raw : [])
    .map((x) => ({
      date: isISODate(x?.date) ? x.date : "",
      title: String(x?.title || "").trim().slice(0, 140),
      angle: String(x?.angle || "").trim().slice(0, 300),
      format: String(x?.format || "").trim().slice(0, 40),
      funnel: FUNNELS.includes(String(x?.funnel || "").toUpperCase()) ? String(x.funnel).toUpperCase() : "TOFU",
      campaign: String(x?.campaign || "").trim(),
    }))
    .filter((x) => x.title);

  const seen = new Set();
  const deduped = [];
  for (const x of cleaned) {
    const key = normTitle(x.title);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(x);
  }

  const bySlot = new Map(slots.map((d) => [d, null]));
  const leftovers = [];
  for (const x of deduped) {
    if (x.date && bySlot.has(x.date) && !bySlot.get(x.date)) bySlot.set(x.date, x);
    else leftovers.push(x);
  }
  for (const d of slots) {
    if (!bySlot.get(d) && leftovers.length) bySlot.set(d, leftovers.shift());
  }

  return slots
    .filter((d) => bySlot.get(d))
    .map((d) => {
      const x = bySlot.get(d);
      const format = formatNames.size && !formatNames.has(normTitle(x.format)) ? "" : x.format;
      const campaign = forceCampaign || (x.campaign ? campaignByName.get(normTitle(x.campaign)) : null);
      return {
        date: d, title: x.title, angle: x.angle, format, funnel: x.funnel,
        campaignId: campaign ? campaign.id : "", campaignName: campaign ? campaign.name : "",
        picked: true, contentId: "",
      };
    });
}

// Active campaigns to hand the AI (and to populate each row's campaign
// picker in the card) — never a finished or archived one.
export function activeCampaignsFor(campaigns) {
  return (campaigns || []).filter((c) => c.status === "active" || c.status === "planning");
}

// The plan card still on the table in this transcript, if any: walk back
// from the newest entry, skipping the user's own messages, error bubbles
// (no engine) and plain plan chatter (`planTalk`, the model said nothing
// changed). The first assistant entry left holding an unsaved, unclosed
// weekPlan owns the next message.
export function currentPlanEntry(entries) {
  for (let i = (entries || []).length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.role === "user" || e.role === "day") continue;
    if (e.planTalk) continue;
    if (!e.engine) continue; // an error bubble has no engine
    if (e.weekPlan && !e.weekPlan.savedAt && !e.weekPlan.closed) return e;
    return null; // the most recent real answer isn't a plan — no plan is open
  }
  return null;
}
