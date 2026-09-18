// Next Action engine: given a brand, a campaign and the brand's content,
// what should the user do NOW, and where? Pure — no DOM, no writes — so
// every surface (campaign detail, beginner home, proactive banner,
// Consultant snapshot, campaign cards) reads the same answer.
//
// Each action: { id, priority, label, why, cta: { type, label, contentId?,
// milestoneId?, stageIndex? } }. `type` is what the UI routes on:
//   creator      → Creator on contentId (intent: "publish" | "continue")
//   calendar     → Calendar, highlight contentId
//   performance  → Quick Fill for contentId
//   insights     → Perbarui Insights modal
//   manual       → Catat angka sheet (milestoneId)
//   brainstorm   → Brainstorm modal for the active stage
//   new-content  → new content picker with campaign context
//   info         → no button
import { campaignStages, activeStageIndex, readStage, ladderAdvanceState, campaignActivities, STALE_DAYS } from "./campaign-metrics.js";
import { localISODate, daysBetween } from "./store.js";
import { getMode } from "./mode.js";
import { levelReminders } from "./goal-plan.js";
import { t } from "./i18n.js";

const STATUS_VERB = { draft: t("next.verb.draft"), production: t("next.verb.production"), editing: t("next.verb.editing") };
const READINESS = { scheduled: 0, editing: 1, production: 2, draft: 3, idea: 4 };

function title(c) {
  return c.title || t("next.untitled");
}

function affects(readings, filterFn) {
  const hit = readings.filter((r) => !r.met && filterFn(r.milestone)).slice(0, 2);
  return hit.map((r) => `${r.milestone.label} ${r.current}/${r.target ?? "—"}`).join(" · ");
}

export function nextActions({ brand, campaign, content, settings, limit = 3 }) {
  const ctx = { brand, campaign, content, settings };
  const stages = campaignStages(campaign);
  const stageIndex = activeStageIndex(campaign, stages, content);
  const stage = stages[stageIndex];
  if (!stage) return [];
  const { readings } = readStage(stage, ctx);
  const { linked } = campaignActivities(campaign, content);
  const today = localISODate();
  const out = [];
  const push = (a) => {
    if (out.length < limit && !out.some((x) => x.id === a.id)) out.push(a);
  };
  const contentWhy = affects(readings, (m) => m.metric === "content.published" || m.metric === "content.streakWeeks") || t("next.contentWhy");

  // 1. Scheduled date passed, still not published.
  const overdue = linked.filter((c) => c.scheduleDate && c.scheduleDate < today && c.status !== "published").sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  if (overdue[0]) {
    push({ id: "overdue", priority: 1, label: t("next.overdue.label", { title: title(overdue[0]) }), why: t("next.overdue.why", { date: overdue[0].scheduleDate, why: contentWhy }), cta: { type: "creator", label: t("next.overdue.cta"), contentId: overdue[0].id, intent: "publish" } });
  }

  // 2. Profile numbers the campaign depends on are stale or missing.
  const profile = readings.find((r) => r.milestone.metric.startsWith("profile.") && r.stale);
  if (profile) {
    push({
      id: "insights",
      // Already past target: still worth refreshing, but not ahead of real work.
      priority: profile.met ? 8 : 2,
      label: profile.logged ? t("next.insights.labelUpdate", { age: profile.ageLabel }) : t("next.insights.labelFill"),
      // 7: "milestone" reads as jargon in Pemula copy — "target" instead.
      why: t(getMode() === "guided" ? "next.insights.whyGuided" : "next.insights.why", { milestone: profile.milestone.label, days: STALE_DAYS }),
      cta: { type: "insights", label: profile.logged ? t("next.insights.ctaUpdate") : t("next.insights.ctaFill"), milestoneId: profile.milestone.id },
    });
  }

  // 3. Ready to upload within 3 days.
  const soon = linked.filter((c) => c.status === "scheduled" && c.scheduleDate && c.scheduleDate >= today && daysBetween(today, c.scheduleDate) <= 3).sort((a, b) => a.scheduleDate.localeCompare(b.scheduleDate));
  if (soon[0]) {
    push({ id: `upload-${soon[0].id}`, priority: 3, label: t("next.upload.label", { title: title(soon[0]) }), why: t("next.upload.why", { when: soon[0].scheduleDate === today ? t("next.today") : soon[0].scheduleDate, why: contentWhy }), cta: { type: "creator", label: t("next.upload.cta"), contentId: soon[0].id, intent: "publish" } });
  }

  // 4. Streak about to break.
  const streak = readings.find((r) => r.milestone.metric === "content.streakWeeks" && r.streakBreak);
  if (streak) {
    const ready = linked.filter((c) => c.status !== "published").sort((a, b) => (READINESS[a.status] ?? 5) - (READINESS[b.status] ?? 5))[0];
    push({
      id: "streak",
      priority: 4,
      label: t("next.streak.label", { days: streak.streakBreak.days }),
      why: t("next.streak.why", { weeks: streak.streakBreak.weeks }),
      cta: ready ? { type: "creator", label: t("next.streak.ctaContinue", { title: title(ready) }), contentId: ready.id, intent: "continue" } : { type: "new-content", label: t("next.streak.ctaNew") },
    });
  }

  // Grow Brand: the tracks that aren't this level's focus still need their
  // groundwork ("don't forget to start your community").
  if (stage.kind === "level" && campaign.goalPlan && stage.state === "current") {
    const group = levelReminders(readings, stage.raw.focus, campaign.goalPlan?.goal)[0];
    const r = group?.items[0];
    if (r) {
      push({
        id: `remind-${group.track}`,
        priority: r.milestone.required === false ? 7.5 : 4.5,
        label: t(`goal.remind.${group.track}.title`),
        why: `${r.milestone.label} — ${t(`goal.remind.${group.track}.${stage.raw.focus}`)}`,
        cta: r.auto ? { type: "new-content", label: t("camp.m.createContent") } : { type: "manual", label: r.isCheck ? t("camp.m.markDone") : t("camp.m.log"), milestoneId: r.milestone.id },
      });
    }
  }

  // 5. Work in progress, most ready first.
  const wip = linked.filter((c) => ["draft", "production", "editing"].includes(c.status)).sort((a, b) => (READINESS[a.status] ?? 5) - (READINESS[b.status] ?? 5) || (a.scheduleDate || "9").localeCompare(b.scheduleDate || "9"));
  if (wip[0]) {
    push({ id: `wip-${wip[0].id}`, priority: 5, label: `${STATUS_VERB[wip[0].status]} "${title(wip[0])}"`, why: contentWhy, cta: { type: "creator", label: t("next.wip.cta"), contentId: wip[0].id, intent: "continue" } });
  }

  // 6. Ideas with no date yet.
  const unscheduled = linked.filter((c) => c.status === "idea" && !c.scheduleDate);
  if (unscheduled[0]) {
    push({ id: `schedule-${unscheduled[0].id}`, priority: 6, label: t("next.schedule.label", { title: title(unscheduled[0]) }), why: t("next.schedule.why", { count: unscheduled.length }), cta: { type: "calendar", label: t("next.schedule.cta"), contentId: unscheduled[0].id } });
  }

  // 7. Nothing in the pipeline at all.
  const pipeline = linked.filter((c) => c.status !== "published");
  if (!pipeline.length) {
    const hasContentMilestone = readings.some((r) => r.milestone.metric.startsWith("content.") && !r.met);
    // 5.2: genuinely zero content ever linked to this campaign (not just
    // zero unpublished — a campaign whose only content is already
    // published still has "real work" priorities below) outranks
    // Insights — nothing to update the numbers with yet, so making the
    // first piece is the only real next step. Pemula also gets a plainer
    // label for this exact case instead of the stage-name-dropping copy.
    // (Campaigns that count everything the brand makes aren't "empty" just
    // because nothing was linked by hand.)
    const noContentYet = (campaign.autoLinkAllContent ? content : linked).length === 0;
    push({
      id: "brainstorm",
      priority: noContentYet ? 1.5 : 7,
      label:
        noContentYet && getMode() === "guided"
          ? t("next.brainstorm.labelFirstGuided")
          : stage.kind === "window"
          ? t("next.brainstorm.labelWindow", { stage: stage.name })
          : t("next.brainstorm.labelLevel"),
      why: hasContentMilestone ? contentWhy : t("next.brainstorm.whyEmpty"),
      cta: { type: "brainstorm", label: t("next.brainstorm.cta"), stageIndex },
    });
  }

  // 8. Published without performance data.
  const perf = readings.find((r) => r.staleCount && r.update?.type === "performance" && !r.met);
  if (perf) {
    push({ id: "performance", priority: 8, label: perf.staleCount > 1 ? t("next.performance.labelMany", { count: perf.staleCount }) : t("next.performance.labelOne"), why: t("next.performance.why", { milestone: perf.milestone.label }), cta: { type: "performance", label: t("next.performance.cta"), contentId: perf.update.contentId } });
  }

  // 9. Manual numbers never recorded.
  // (Grow Brand: the other tracks' numbers are surfaced by their own reminder below.)
  const reminded = stage.kind === "level" && campaign.goalPlan ? new Set(levelReminders(readings, stage.raw.focus, campaign.goalPlan?.goal).flatMap((g) => g.items.map((r) => r.milestone.id))) : new Set();
  const manual = readings.find((r) => !r.auto && !r.logged && !r.milestone.notApplicable && !reminded.has(r.milestone.id));
  if (manual) {
    push({ id: "manual", priority: 9, label: t("next.manual.label", { milestone: manual.milestone.label }), why: t("next.manual.why"), cta: { type: "manual", label: t("next.manual.cta"), milestoneId: manual.milestone.id } });
  }

  // 10/11. Ladder: all targets met.
  if (stage.kind === "level") {
    const adv = ladderAdvanceState(campaign, stage, ctx);
    if (adv.targetsMet && !adv.ready) push({ id: "min-weeks", priority: 10, label: t("next.minWeeks.label", { weeks: adv.weeksLeft }), why: t("next.minWeeks.why", { level: stage.index + 1, min: adv.minWeeks }), cta: { type: "info", label: "" } });
    if (adv.ready) push({ id: "advance", priority: 11, label: t("next.advance.label"), why: t(getMode() === "guided" ? "next.advance.whyGuided" : "next.advance.why"), cta: { type: "info", label: "" } });
  }

  // Event: window ending soon with required milestones open.
  if (stage.kind === "window" && stage.state === "current") {
    const left = daysBetween(today, stage.dateTo);
    const open = readings.filter((r) => r.milestone.required !== false && !r.met && !r.milestone.notApplicable).length;
    if (left <= 3 && open) push({ id: "window-end", priority: 3, label: t(getMode() === "guided" ? "next.windowEnd.labelGuided" : "next.windowEnd.label", { stage: stage.name, when: left === 0 ? t("next.today") : t("next.windowEnd.inDays", { days: left }), open }), why: t("next.windowEnd.why"), cta: { type: "info", label: "" } });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, limit);
}

// The single most urgent action across a brand's active campaigns —
// what the beginner home card and the proactive banner show.
export function brandTopAction({ brand, campaigns, content, settings }) {
  let best = null;
  campaigns
    .filter((c) => c.status !== "archived")
    .forEach((campaign) => {
      const a = nextActions({ brand, campaign, content, settings, limit: 1 })[0];
      if (a && (!best || a.priority < best.action.priority)) best = { campaign, action: a };
    });
  return best;
}
