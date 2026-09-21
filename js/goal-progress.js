// Roadmap ke Tujuan — how a live goal is doing. Read-only and derived on
// every call from the goal, its campaigns and its content: nothing here is
// stored, so it can never drift from what the owner actually did.
//
// One vocabulary for everything a goal asks of the owner — a content slot,
// a checklist milestone with a due date, a goal task — an ITEM in one of
// four states:
//   done     published / ticked
//   overdue  its date passed and it isn't done (never blocks anything)
//   soon     due within the next 7 days
//   later    not yet time
// The Home card's readiness bar, the lane "on track" flags and the weekly
// brief all read from these same items.
import { getContent, getCampaign, localISODate, daysBetween } from "./store.js";
import { addDays, weekStart, readCondition } from "./goal-roadmap.js";
import { t } from "./i18n.js";

const SOON_DAYS = 6;

function stateOf(date, done, today) {
  if (done) return "done";
  if (!date) return "later";
  if (date < today) return "overdue";
  if (date <= addDays(today, SOON_DAYS)) return "soon";
  return "later";
}

export function goalItems(goal, today = localISODate()) {
  const items = [];
  const inst = goal.installed || { campaigns: {}, slots: {} };
  // Content slots the plan put on the calendar.
  Object.entries(inst.slots || {}).forEach(([slotId, rec]) => {
    const c = rec?.contentId ? getContent(rec.contentId) : null;
    if (!c) return; // deleted by the owner: a decision, not a miss
    const date = c.scheduleDate || rec.date;
    items.push({ id: `slot:${slotId}`, kind: "slot", laneId: c.goalLane || slotId.split("|")[0], label: c.title || rec.title, date, state: stateOf(date, c.status === "published", today), contentId: c.id, funnel: c.funnel });
  });
  // Checklist milestones with a due date (event lane).
  const live = inst.campaigns?.event?.id ? getCampaign(inst.campaigns.event.id) : null;
  (live?.eventPlan?.phases || []).forEach((p) => (p.milestones || []).forEach((m) => {
    if (!m.dueDate || m.notApplicable) return;
    // Checklist steps are ticked; tracked-number steps ("find 6 alumni",
    // added from Brainstorm) are done once the logged number reaches the target.
    if (m.kind !== "check" && !(m.kind === "number" && m.custom)) return;
    const logged = Number(live.manualMetrics?.[m.id]?.value ?? m.value) || 0;
    const done = m.kind === "check" ? !!m.done : m.target ? logged >= m.target : !!m.done;
    items.push({ id: `ms:${m.id}`, kind: "milestone", laneId: "event", label: m.label, date: m.dueDate, state: stateOf(m.dueDate, done, today), campaignId: live.id, milestoneId: m.id, phaseId: p.id, optional: m.required === false });
  }));
  // Goal-owned tasks (community lane).
  (goal.tasks || []).forEach((tk) => items.push({ id: `task:${tk.id}`, kind: "task", laneId: tk.laneId, label: tk.label, date: tk.dueDate, state: stateOf(tk.dueDate, !!tk.done, today), taskId: tk.id }));
  return items.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
}

// input: { goal, brand, content, campaigns, settings, today }
export function goalProgress({ goal, brand, content = [], campaigns = [], settings = null, today = localISODate() }) {
  const plan = goal.roadmap;
  const items = goalItems(goal, today);
  const counts = { done: 0, soon: 0, overdue: 0, later: 0, total: items.length };
  items.forEach((i) => { counts[i.state] += 1; });
  const lanes = (plan?.lanes || []).map((l) => {
    const mine = items.filter((i) => i.laneId === l.id);
    const overdue = mine.filter((i) => i.state === "overdue" && !i.optional).length;
    const status = today > l.endDate ? "finished" : today < l.startDate ? "upcoming" : overdue ? "behind" : "onTrack";
    return { id: l.id, name: l.name, kind: l.kind, startDate: l.startDate, endDate: l.endDate, overdue, done: mine.filter((i) => i.state === "done").length, total: mine.length, status };
  });
  const daysLeft = goal.targetDate ? daysBetween(today, goal.targetDate) : null;
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  const week = items.filter((i) => i.state === "overdue" || (i.date && i.date >= ws && i.date <= we && i.state !== "later") || (i.date && i.date >= ws && i.date <= we));
  const weekSlots = items.filter((i) => i.kind === "slot" && i.date >= ws && i.date <= we);
  let cond = null;
  try { cond = readCondition({ brand, content, campaigns, settings, today, inputs: goal.inputs || {} }); } catch { cond = null; }
  const eventPhaseNow = (plan?.eventPhases || []).find((p) => today >= p.dateFrom && today <= p.dateTo) || null;
  const needsRefresh = !!plan?.horizonEnd && plan.horizonEnd < addDays(today, 14);
  const nextDeadline = items.find((i) => i.kind !== "slot" && i.state !== "done" && i.date >= today) || null;
  return {
    items, counts, lanes, daysLeft, week: sortWeek(week), weekSlots: { total: weekSlots.length, done: weekSlots.filter((s) => s.state === "done").length },
    followersStale: !!cond?.followersStale, followersAge: cond?.followersAge ?? null, eventPhaseNow, needsRefresh, nextDeadline,
    started: today >= (plan?.start || today), onTrack: lanes.filter((l) => l.status === "onTrack" || l.status === "upcoming" || l.status === "finished").length,
    lanesActive: lanes.length,
  };
}

const ORDER = { overdue: 0, soon: 1, later: 2, done: 3 };
function sortWeek(list) {
  return [...list].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.date || "").localeCompare(b.date || "")).slice(0, 8);
}

// Human label for a date relative to today, for the brief ("Hari ini", "Sel, 29 Sep", "3 hari lalu").
export function relDate(date, today = localISODate()) {
  if (!date) return "";
  const d = daysBetween(today, date);
  if (d === 0) return t("roadmap.rel.today");
  if (d === 1) return t("roadmap.rel.tomorrow");
  if (d < 0) return t("roadmap.rel.ago", { n: -d });
  return t("roadmap.rel.in", { n: d });
}
