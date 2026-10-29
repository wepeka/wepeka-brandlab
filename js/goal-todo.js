// "Yang perlu dikerjakan" — one goal's to-do in one list (owner, 2026-10-27:
// "pas orang mau ngerjain tinggal buka goalsnya dan liat listnya"):
//   • content linked to the goal that isn't out yet (Creator picks it up),
//   • the goal's checklist steps still open — an Event's steps in the phases
//     that aren't over, its plan's own tasks, a Grow Brand level's ticks,
//   • ideas kept for the goal that aren't pointed anywhere yet — each waits
//     for the owner to make it a piece of content or a task.
// Numbers (followers, reach, sales…) are not to-dos: they are the goal's
// performance and stay up top. Nothing here writes; the page does.
//
// "Rutin minggu ini" (owner, 2026-10-29: "kalau ada kegiatan rutin sistemnya
// juga bakal ingetin munculin 'lakuin ini' setiap minggunya jadi gak
// dicentang terus selesai"): what comes back every week sits apart, on top —
//   • a series' episode on each day it airs (Ritme Kerja seriesDays), done
//     once that week's episode is out,
//   • the goal's own weekly routines (campaign.routines — a community ritual
//     or any "+ Tugas" set to repeat), ticked per week: a tick only covers
//     this week's Monday, so next Monday the row asks again.
import { localISODate, listBrandIdeas, listSeries, ROUTINE_DAYS } from "./store.js";
import { campaignStages, readStage } from "./campaign-metrics.js";
import { addDays, weekStart } from "./goal-roadmap.js";
import { seriesDays } from "./week-plan.js";

const OPEN_CONTENT = ["idea", "draft", "production", "editing", "scheduled"];

// Which of the four kinds a goal is (js/goal-art.js GOAL_KINDS), or "other"
// for an older campaign that is neither a Grow Brand track nor an Event.
export function goalKind(campaign) {
  if (!campaign) return "other";
  if (campaign.eventPlan || campaign.objective === "event") return "event";
  const track = campaign.goalPlan?.version === 3 ? campaign.goalPlan.track : null;
  return ["social", "community", "sales"].includes(track) ? track : "other";
}

const isRunning = (c) => !["archived", "completed"].includes(c.status);

// The steps a goal asks the owner to tick: the current level of a Grow Brand
// ladder, every phase of an Event that isn't over yet. Each with the stage it
// sits in, so ticking it reaches the right milestone.
function checklist(campaign, ctx, today) {
  const stages = campaignStages(campaign);
  if (!stages.length) return [];
  const open = stages[0].kind === "level"
    ? stages.filter((s) => s.state === "current")
    : stages[0].kind === "window"
      ? stages.filter((s) => s.state !== "past" && (s.dateTo || "9999") >= today)
      : stages;
  return open.flatMap((stage) =>
    readStage(stage, ctx).readings
      .filter((r) => r.isCheck && !r.milestone.notApplicable && !r.milestone.delegatedTo)
      .map((r) => ({
        kind: "task", id: `ms:${stage.id}:${r.milestone.id}`, label: r.milestone.label, done: !!r.met,
        date: r.milestone.legacy?.dueDate || r.milestone.dueDate || "", stageId: stage.id, stageName: stage.name, stageKind: stage.kind,
        milestoneId: r.milestone.id, optional: r.milestone.required === false, custom: !!(r.milestone.custom || r.milestone.legacy?.custom),
        identity: r.milestone.key === "concept" && r.milestone.track === "community", msKey: r.milestone.key || "",
      }))
  );
}

// Weeks a community ritual has to have run before "Ritual mingguan komunitas
// berjalan" ticks itself.
export const RITUAL_WEEKS = 3;
const dateOfDay = (monday, day) => addDays(monday, Math.max(0, ROUTINE_DAYS.indexOf(day)));

// Weeks in a row a routine was done, counting back from this week (or from
// last week while this one is still open).
export function routineStreak(doneWeeks = [], monday) {
  const set = new Set(doneWeeks);
  let wk = set.has(monday) ? monday : addDays(monday, -7);
  let n = 0;
  while (set.has(wk) && n < 520) { n++; wk = addDays(wk, -7); }
  return n;
}

// This week's recurring rows for one goal, by date. Series show on a Sosmed
// Growth goal (every post grows the account) and on any goal that already
// has an episode of that series pointed at it.
export function routinesThisWeek({ brand, campaign, content = [], today = localISODate() }) {
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const rows = [];
  let seriesWithoutDay = 0;
  if (brand) {
    const allSeries = listSeries(brand.id);
    const days = seriesDays(brand.contentCadence, allSeries);
    const linkedSeries = new Set(content.filter((c) => c.campaignId === campaign.id && c.seriesId).map((c) => c.seriesId));
    const social = goalKind(campaign) === "social";
    // A Sosmed Growth goal whose series have no day yet: the page offers to
    // set one (Ritme Kerja), since only a day makes a series come back weekly.
    if (social) seriesWithoutDay = allSeries.filter((s) => ![...days.values()].some((x) => x.id === s.id)).length;
    const bySeries = new Map();
    ROUTINE_DAYS.forEach((day) => {
      const s = days.get(day);
      if (!s || (!social && !linkedSeries.has(s.id))) return;
      if (!bySeries.has(s.id)) bySeries.set(s.id, { series: s, dates: [] });
      bySeries.get(s.id).dates.push({ day, date: dateOfDay(monday, day) });
    });
    for (const { series, dates } of bySeries.values()) {
      // This week's episodes of the series, wherever they're pointed: each
      // air date takes the one on its own date, else the next one left.
      const eps = content
        .filter((c) => c.seriesId === series.id && !c.archived && !c.deletedAt && c.status !== "archived")
        .map((c) => ({ c, date: c.status === "published" ? c.publishedDate || c.scheduleDate || "" : c.scheduleDate || "" }))
        .filter((e) => e.date >= monday && e.date <= sunday)
        .sort((a, b) => a.date.localeCompare(b.date));
      const used = new Set();
      const pick = (date) => eps.find((e) => !used.has(e.c.id) && e.date === date) || eps.find((e) => !used.has(e.c.id));
      dates.forEach(({ day, date }) => {
        const e = pick(date);
        if (e) used.add(e.c.id);
        const done = e?.c.status === "published";
        rows.push({
          kind: "series", id: `sr:${series.id}:${date}`, seriesId: series.id, label: series.name || "", day, date, done, late: !done && date < today,
          episode: e ? { id: e.c.id, title: e.c.title || "", status: e.c.status } : null,
        });
      });
    }
  }
  (campaign.routines || []).forEach((r) => {
    const date = dateOfDay(monday, r.day);
    const done = (r.doneWeeks || []).includes(monday);
    // Made after this week's day had passed: it starts next week — not late,
    // not waiting.
    const fresh = !done && !!r.createdAt && localISODate(new Date(r.createdAt)) > date;
    rows.push({
      kind: "routine", id: `rt:${r.id}`, routineId: r.id, label: r.label || "", ritual: r.kind === "ritual", day: r.day || "mon", date, done, fresh,
      late: !done && !fresh && date < today, streak: routineStreak(r.doneWeeks, monday), weeks: (r.doneWeeks || []).length,
    });
  });
  // What still waits first (by day), what's done this week after it.
  rows.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1) || a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "series" ? -1 : 1));
  return { monday, sunday, rows, seriesWithoutDay };
}

// { items, ideas, done, routine } — `items` sorted: late first, then by date, undated
// last (newest first); `done` newest first.
export function goalTodo({ brand, campaign, content = [], settings = null, goal = null, today = localISODate() }) {
  if (!campaign) return { items: [], ideas: [], done: [], routine: { monday: "", sunday: "", rows: [], seriesWithoutDay: 0 } };
  const ctx = { brand, campaign, content, settings };
  const routine = routinesThisWeek({ brand, campaign, content, today });
  // This week's episodes already sit in the routine block — not twice.
  const inRoutine = new Set(routine.rows.map((r) => r.episode?.id).filter(Boolean));
  const seriesName = new Map(brand ? listSeries(brand.id).map((s) => [s.id, s.name || ""]) : []);
  const linked = content.filter((c) => c.campaignId === campaign.id && !c.archived && !inRoutine.has(c.id));
  const pieces = linked.map((c) => {
    const date = c.status === "published" ? c.publishedDate || "" : c.scheduleDate || "";
    return { kind: "content", id: c.id, label: c.title || "", status: c.status, format: c.format || "", date, done: !OPEN_CONTENT.includes(c.status), late: OPEN_CONTENT.includes(c.status) && !!date && date < today, at: c.updatedAt || c.createdAt || 0, seriesId: c.seriesId && seriesName.has(c.seriesId) ? c.seriesId : "", seriesName: seriesName.get(c.seriesId) || "" };
  });
  // "Ritual mingguan komunitas berjalan" counts the weeks the goal's ritual
  // actually ran (it ticks itself at RITUAL_WEEKS, js/views/campaign-detail.js).
  const ritual = routine.rows.find((r) => r.kind === "routine" && r.ritual);
  const ticks = checklist(campaign, ctx, today).map((x) => ({
    ...x, late: !x.done && !!x.date && x.date < today,
    ...(x.msKey === "ritual" && ritual ? { ritualWeeks: Math.min(ritual.weeks, RITUAL_WEEKS), ritualNeed: RITUAL_WEEKS } : {}),
  }));
  // An Event plan's own tasks (the community lane: invite members, presale…),
  // ticked on the plan page too — the same `goal.tasks` either way.
  const planTasks = goal && campaign.eventPlan && goal.installed?.campaigns?.event?.id === campaign.id
    ? (goal.tasks || []).map((tk) => ({ kind: "goalTask", id: `gt:${tk.id}`, taskId: tk.id, goalId: goal.id, label: tk.label, date: tk.dueDate || "", done: !!tk.done, late: !tk.done && !!tk.dueDate && tk.dueDate < today }))
    : [];
  const all = [...pieces, ...ticks, ...planTasks];
  const order = (a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    return (b.at || 0) - (a.at || 0);
  };
  const items = all.filter((x) => !x.done && !(x.kind === "content" && x.status === "archived")).sort(order);
  const done = all.filter((x) => x.done).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.at || 0) - (a.at || 0));
  // Kept ideas that haven't become anything yet (a used idea is content now).
  const ideas = brand ? listBrandIdeas(brand.id, { campaignId: campaign.id }).filter((i) => i.status !== "used" && i.status !== "tasked") : [];
  return { items, ideas, done, routine };
}

// What still waits this week: the list's own count plus the routine rows
// not done yet (the landing cards' "N perlu dikerjakan").
export const openCount = (todo) => todo.items.length + todo.routine.rows.filter((r) => !r.done && !r.fresh).length;

// The goals of one kind that are still running, for the landing cards.
export function runningGoalsOfKind(campaigns, kind) {
  return campaigns.filter((c) => isRunning(c) && goalKind(c) === kind);
}
