// "Yang perlu dikerjakan" — one goal's to-do in one list (owner, 2026-10-27:
// "pas orang mau ngerjain tinggal buka goalsnya dan liat listnya"):
//   • content linked to the goal that isn't out yet (Creator picks it up),
//   • the goal's checklist steps still open — an Event's steps in the phases
//     that aren't over, its plan's own tasks, a Grow Brand level's ticks,
//   • ideas kept for the goal that aren't pointed anywhere yet — each waits
//     for the owner to make it a piece of content or a task.
// Numbers (followers, reach, sales…) are not to-dos: they are the goal's
// performance and stay up top. Nothing here writes; the page does.
import { localISODate, listBrandIdeas } from "./store.js";
import { campaignStages, readStage } from "./campaign-metrics.js";

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
        identity: r.milestone.key === "concept" && r.milestone.track === "community",
      }))
  );
}

// { items, ideas, done } — `items` sorted: late first, then by date, undated
// last (newest first); `done` newest first.
export function goalTodo({ brand, campaign, content = [], settings = null, goal = null, today = localISODate() }) {
  if (!campaign) return { items: [], ideas: [], done: [] };
  const ctx = { brand, campaign, content, settings };
  const linked = content.filter((c) => c.campaignId === campaign.id && !c.archived);
  const pieces = linked.map((c) => {
    const date = c.status === "published" ? c.publishedDate || "" : c.scheduleDate || "";
    return { kind: "content", id: c.id, label: c.title || "", status: c.status, format: c.format || "", date, done: !OPEN_CONTENT.includes(c.status), late: OPEN_CONTENT.includes(c.status) && !!date && date < today, at: c.updatedAt || c.createdAt || 0 };
  });
  const ticks = checklist(campaign, ctx, today).map((x) => ({ ...x, late: !x.done && !!x.date && x.date < today }));
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
  return { items, ideas, done };
}

// The goals of one kind that are still running, for the landing cards.
export function runningGoalsOfKind(campaigns, kind) {
  return campaigns.filter((c) => isRunning(c) && goalKind(c) === kind);
}
