// Roadmap ke Tujuan — the writing side. js/goal-roadmap.js only PLANS; this
// file turns an approved plan into real campaigns, calendar slots and
// deadlines, and re-plots one that already went live.
//
// Two rules keep it safe:
//  1. Nothing is written until the owner presses "Pasang" (install) or
//     "Terapkan" (re-plot, which shows a diff first).
//  2. Everything written is recorded in goal.installed as it happens, so an
//     install that stops halfway (status "partial") resumes without
//     duplicating a single campaign or slot: campaigns and slots already
//     in `installed` (and still existing) are skipped.
import {
  getBrand, getGoal, updateGoal, listContent, listCampaigns, getCampaign, getContent, createCampaign, updateCampaign, createContent, updateContent, deleteContent,
  getSettings, localISODate, eventScaleFor, CAMPAIGN_PHASE_TEMPLATE, CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES,
} from "./store.js";
import { buildSocialGrowthPlan, placeStartSocialLevel } from "./goal-plan.js";
import { planRoadmap, diffPlans } from "./goal-roadmap.js";
import { t } from "./i18n.js";

const LEGACY_PHASES = (optionalDefaults = []) => CAMPAIGN_PHASE_TEMPLATE.map((tpl) => ({ id: tpl.name.toLowerCase(), name: tpl.name, goal: "", milestones: [], enabled: !tpl.optional || optionalDefaults.includes(tpl.name) }));

const EVENT_DEFAULT_OBJECTIVES = { organizer: ["Awareness", "Attendance"], tenant: ["Sales", "Brand awareness"], participant: [] };

// The Content OS platform whose name matches the plan's audience platform
// ("instagram" → "Instagram"); "" when the account doesn't list it.
function platformName(id) {
  const p = (getSettings().platforms || []).find((x) => x.id === id || (x.name || "").toLowerCase() === id);
  return p?.name || "";
}

// Builds the plan for a goal from live data. `over` = { targetDate?, inputs? }
// previews a change without saving it.
export function planForGoal(brandId, goal, over = {}) {
  const brand = getBrand(brandId);
  const live = goal.installed?.campaigns?.event?.id ? getCampaign(goal.installed.campaigns.event.id) : null;
  const next = { ...goal, targetDate: over.targetDate ?? goal.targetDate, inputs: { ...(goal.inputs || {}), ...(over.inputs || {}) } };
  // A follower count typed into the wizard is only a stand-in: once the owner
  // records a newer one in Insights, that one wins.
  const typedAt = next.inputs.followersAt || goal.createdAt || 0;
  if (Object.values(brand?.insights || {}).some((v) => v && Number(v.followers) > 0 && (v.updatedAt || 0) > typedAt)) next.inputs = { ...next.inputs, followers: null };
  return planRoadmap({
    goal: next, brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings(), today: localISODate(),
    prevPhases: live?.eventPlan?.phases || goal.roadmap?.eventPhases || null,
  });
}

// ---------- Install ----------

function createEventCampaign(brandId, brand, goal, plan) {
  const inputs = goal.inputs || {};
  const role = inputs.role || "organizer";
  const seats = Number(inputs.expectedAudience) || null;
  const name = String(inputs.eventName || goal.name || "").trim() || t("roadmap.defaultName");
  const objectives = (inputs.objectives || []).length ? inputs.objectives : EVENT_DEFAULT_OBJECTIVES[role] || [];
  const eventLane = plan.lanes.find((l) => l.id === "event");
  return createCampaign(brandId, {
    name, objective: "event", status: "planning",
    targetAudience: brand?.brandDNA?.targetAudience || "",
    startDate: eventLane.startDate, endDate: plan.target,
    phases: LEGACY_PHASES(CAMPAIGN_OBJECTIVE_DEFAULT_OPTIONAL_PHASES.event || []),
    autoLinkAllContent: false,
    goalId: goal.id, goalLaneId: "event",
    eventPlan: {
      role, participationType: inputs.participationType || "", eventDate: plan.target, scale: eventScaleFor(seats).id,
      setup: { eventName: name, eventDate: plan.target, campaignStartDate: eventLane.startDate, eventLocation: inputs.location || "", expectedAudience: seats },
      objectives, phases: plan.eventPhases,
    },
  });
}

function createAudienceCampaign(brandId, brand, goal, plan) {
  const a = plan.audience;
  const lane = plan.lanes.find((l) => l.id === "audience");
  const { missions, goalPlan } = buildSocialGrowthPlan({
    platform: a.platform, current: { followers: a.current }, target: a.target, months: a.months,
    uploadsPerWeek: a.uploadsPerWeek || plan.capacity.perWeek,
    startIndex: placeStartSocialLevel({ followers: a.current }).index,
    content: listContent(brandId), contentCadence: brand?.contentCadence,
  });
  const label = a.platform.charAt(0).toUpperCase() + a.platform.slice(1);
  return createCampaign(brandId, {
    name: `${t("roadmap.lane.audience")} · ${label} ${brand?.name || ""}`.trim(),
    objective: "awareness", status: "active",
    targetAudience: brand?.brandDNA?.targetAudience || "",
    startDate: lane.startDate, endDate: lane.endDate,
    phases: LEGACY_PHASES(),
    autoLinkAllContent: true,
    goalId: goal.id, goalLaneId: "audience",
    missions, missionProgressionNote: t("goal.rules.social"), goalPlan,
  });
}

// Which campaign a lane's slots are tagged with: its own, else the existing
// campaign it reuses, else the event campaign (the community lane has none).
function campaignForLane(installed, laneId) {
  return installed.campaigns?.[laneId]?.id || installed.campaigns?.event?.id || "";
}

// Installs (or resumes) a goal's plan. Returns { ok, status, made: { campaigns, slots }, total }.
export function installGoal(brandId, goalId) {
  const brand = getBrand(brandId);
  const goal = getGoal(brandId, goalId);
  if (!brand || !goal?.roadmap) return { ok: false, error: "noPlan" };
  const plan = goal.roadmap;
  if (plan.errors?.length) return { ok: false, error: plan.errors[0] };
  const made = { campaigns: 0, slots: 0 };
  let installed = { campaigns: { ...(goal.installed?.campaigns || {}) }, slots: { ...(goal.installed?.slots || {}) } };
  const save = (extra = {}) => updateGoal(brandId, goalId, { installed: { campaigns: { ...installed.campaigns }, slots: { ...installed.slots } }, ...extra });
  try {
    save({ status: "installing" });

    // Campaigns first — slots need their ids.
    if (!(installed.campaigns.event?.id && getCampaign(installed.campaigns.event.id))) {
      const c = createEventCampaign(brandId, brand, goal, plan);
      installed.campaigns.event = { id: c.id, created: true };
      made.campaigns += 1;
      save();
    }
    if (plan.audience && !(installed.campaigns.audience?.id && getCampaign(installed.campaigns.audience.id))) {
      if (plan.audience.reuseCampaignId && getCampaign(plan.audience.reuseCampaignId)) {
        installed.campaigns.audience = { id: plan.audience.reuseCampaignId, created: false };
      } else {
        const c = createAudienceCampaign(brandId, brand, goal, plan);
        installed.campaigns.audience = { id: c.id, created: true };
        made.campaigns += 1;
      }
      save();
    }
    const community = plan.lanes.find((l) => l.id === "community");
    if (community?.campaignId && getCampaign(community.campaignId) && !installed.campaigns.community?.id) {
      installed.campaigns.community = { id: community.campaignId, created: false };
      save();
    }

    // Slots — idempotent by slot id.
    const plat = platformName(plan.audience?.platform || "instagram");
    let sinceSave = 0;
    plan.slots.forEach((s) => {
      const rec = installed.slots[s.id];
      if (rec?.contentId && getContent(rec.contentId)) return;
      const item = createContent(brandId, {
        title: s.title, funnel: s.funnel, status: "idea", scheduleDate: s.date, platform: plat,
        campaignId: campaignForLane(installed, s.laneId), campaignPhaseId: "",
        fromGoal: goalId, goalLane: s.laneId, goalSlotId: s.id, goalPhaseId: s.phaseId,
      });
      installed.slots[s.id] = { contentId: item.id, date: s.date, title: s.title };
      made.slots += 1;
      if (++sinceSave >= 10) { save(); sinceSave = 0; }
    });

    const doneTasks = new Map((goal.tasks || []).map((tk) => [tk.id, tk.done]));
    save({ status: "active", tasks: (plan.tasks || []).map((tk) => ({ ...tk, done: !!doneTasks.get(tk.id) })), installedAt: goal.installedAt || Date.now() });
    return { ok: true, status: "active", made, total: { campaigns: Object.keys(installed.campaigns).length, slots: plan.slots.length } };
  } catch (e) {
    console.error("Goal install stopped", e);
    save({ status: "partial" });
    return { ok: false, error: "partial", made, done: Object.keys(installed.slots).length, total: { slots: plan.slots.length }, message: e?.message || "" };
  }
}

// ---------- Re-plot (with diff) ----------

// Previews a change to a live goal. Returns { plan, diff } — nothing written.
export function previewReplan(brandId, goalId, over = {}) {
  const goal = getGoal(brandId, goalId);
  if (!goal) return null;
  const plan = planForGoal(brandId, goal, over);
  if (plan.errors?.length) return { plan, diff: null, errors: plan.errors };
  const diff = diffPlans(goal.roadmap, plan, { installedSlots: goal.installed?.slots || {}, contentById: (id) => getContent(id) });
  return { plan, diff, errors: [] };
}

// Applies a previewed re-plot. Slots the owner already touched stay exactly
// where they are; only untouched ones move, appear or go away.
export function applyReplan(brandId, goalId, { plan, diff, over = {} }) {
  const goal = getGoal(brandId, goalId);
  if (!goal || !plan || plan.errors?.length) return { ok: false };
  const installed = { campaigns: { ...(goal.installed?.campaigns || {}) }, slots: { ...(goal.installed?.slots || {}) } };
  const live = installed.campaigns.event?.id ? getCampaign(installed.campaigns.event.id) : null;

  // Event campaign: new dates + the new phases, keeping every milestone the
  // owner added by hand (custom) and the state carried by planRoadmap.
  if (live?.eventPlan) {
    const phases = plan.eventPhases.map((p) => ({ ...p, milestones: [...p.milestones] }));
    (live.eventPlan.phases || []).forEach((old) => {
      const mine = (old.milestones || []).filter((m) => m.custom && !phases.some((np) => np.milestones.some((m2) => m2.id === m.id)));
      if (!mine.length) return;
      const home = phases.find((np) => np.name === old.name) || phases[phases.length - 1];
      home.milestones.push(...mine);
    });
    const eventLane = plan.lanes.find((l) => l.id === "event");
    updateCampaign(live.id, {
      startDate: eventLane.startDate, endDate: plan.target,
      eventPlan: { ...live.eventPlan, eventDate: plan.target, setup: { ...(live.eventPlan.setup || {}), eventDate: plan.target, campaignStartDate: eventLane.startDate, expectedAudience: over.inputs?.expectedAudience ?? live.eventPlan.setup?.expectedAudience ?? null }, phases },
    });
    plan.eventPhases = phases;
  }
  const audCamp = installed.campaigns.audience;
  const audLane = plan.lanes.find((l) => l.id === "audience");
  if (audCamp?.created && getCampaign(audCamp.id) && audLane) updateCampaign(audCamp.id, { startDate: audLane.startDate, endDate: audLane.endDate });

  // Slots.
  const plat = platformName(plan.audience?.platform || "instagram");
  (diff?.moved || []).forEach((s) => {
    const rec = installed.slots[s.id];
    if (rec?.contentId && getContent(rec.contentId)) {
      updateContent(rec.contentId, { scheduleDate: s.date, title: s.title });
      installed.slots[s.id] = { ...rec, date: s.date, title: s.title };
    }
  });
  (diff?.removed || []).forEach((s) => {
    const rec = installed.slots[s.id];
    if (rec?.contentId && getContent(rec.contentId)) deleteContent(rec.contentId);
    delete installed.slots[s.id];
  });
  (diff?.added || []).forEach((s) => {
    const item = createContent(brandId, {
      title: s.title, funnel: s.funnel, status: "idea", scheduleDate: s.date, platform: plat,
      campaignId: installed.campaigns?.[s.laneId]?.id || installed.campaigns?.event?.id || "", campaignPhaseId: "",
      fromGoal: goalId, goalLane: s.laneId, goalSlotId: s.id, goalPhaseId: s.phaseId,
    });
    installed.slots[s.id] = { contentId: item.id, date: s.date, title: s.title };
  });
  // Plan slots that still exist but were kept by the owner's own edits: leave
  // installed.slots as is. Slots in the plan with no content (deleted by the
  // owner from the calendar) are NOT recreated — their absence is a decision.

  const doneTasks = new Map((goal.tasks || []).map((tk) => [tk.id, tk.done]));
  updateGoal(brandId, goalId, {
    targetDate: plan.target, inputs: { ...(goal.inputs || {}), ...(over.inputs || {}) }, roadmap: plan, installed,
    tasks: (plan.tasks || []).map((tk) => ({ ...tk, done: !!doneTasks.get(tk.id) })), status: goal.status === "draft" ? "draft" : "active",
  });
  return { ok: true };
}

// ---------- Milestones the owner shapes by hand ----------

const labelKey = (m) => m.label;

// Deletes one template milestone from a goal (by its label). The label goes on
// the goal's removed list so every later re-plot leaves it out; it is also cut
// from the live Event campaign and from the stored roadmap. A draft is
// re-planned on the spot (fewer content milestones = fewer slots); a live goal
// keeps its calendar until the owner re-plots.
export function removeGoalMilestone(brandId, goalId, label) {
  const goal = getGoal(brandId, goalId);
  if (!goal || !label) return { ok: false };
  const removed = [...new Set([...(goal.inputs?.removedMilestones || []), label])];
  const live = goal.installed?.campaigns?.event?.id ? getCampaign(goal.installed.campaigns.event.id) : null;
  if (live?.eventPlan) {
    updateCampaign(live.id, { eventPlan: { ...live.eventPlan, phases: (live.eventPlan.phases || []).map((p) => ({ ...p, milestones: (p.milestones || []).filter((m) => labelKey(m) !== label) })) } });
  }
  const inputs = { ...(goal.inputs || {}), removedMilestones: removed };
  if (goal.status === "draft") {
    updateGoal(brandId, goalId, { inputs });
    updateGoal(brandId, goalId, { roadmap: planForGoal(brandId, getGoal(brandId, goalId)) });
    return { ok: true, replanned: true };
  }
  const roadmap = goal.roadmap ? { ...goal.roadmap, eventPhases: (goal.roadmap.eventPhases || []).map((p) => ({ ...p, milestones: p.milestones.filter((m) => labelKey(m) !== label) })) } : goal.roadmap;
  updateGoal(brandId, goalId, { inputs, roadmap });
  return { ok: true, replanned: false };
}

// Brings back milestones deleted earlier. Draft: re-planned at once. Live: the
// caller opens the re-plot dialog, whose diff will re-add them.
export function restoreGoalMilestones(brandId, goalId, labels = null) {
  const goal = getGoal(brandId, goalId);
  if (!goal) return { ok: false };
  const left = labels ? (goal.inputs?.removedMilestones || []).filter((l) => !labels.includes(l)) : [];
  updateGoal(brandId, goalId, { inputs: { ...(goal.inputs || {}), removedMilestones: left } });
  if (goal.status === "draft") {
    updateGoal(brandId, goalId, { roadmap: planForGoal(brandId, getGoal(brandId, goalId)) });
    return { ok: true, replanned: true };
  }
  return { ok: true, replanned: false };
}

// The Event campaign a brainstorm suggestion can be filed under: the one in
// scope, else the goal's, else the soonest upcoming one the brand has.
export function eventCampaignFor(brandId, { campaignId = null, goalId = null } = {}) {
  const today = localISODate();
  const direct = campaignId ? getCampaign(campaignId) : null;
  if (direct?.eventPlan) return direct;
  const goal = goalId ? getGoal(brandId, goalId) : null;
  const viaGoal = goal?.installed?.campaigns?.event?.id ? getCampaign(goal.installed.campaigns.event.id) : null;
  if (viaGoal?.eventPlan) return viaGoal;
  return listCampaigns(brandId)
    .filter((c) => c.eventPlan?.eventDate && c.eventPlan.eventDate >= today && !["archived", "completed"].includes(c.status))
    .sort((a, b) => a.eventPlan.eventDate.localeCompare(b.eventPlan.eventDate))[0] || null;
}

// The phases of an event campaign a task may still land in (not already over).
export function openEventPhases(campaign) {
  const today = localISODate();
  return (campaign?.eventPlan?.phases || []).filter((p) => p.dateTo >= today).map((p) => ({ id: p.id, name: p.name, dateFrom: p.dateFrom, dateTo: p.dateTo }));
}

// Adds a real-world step ("find 6 alumni", "book the venue") to a phase of an
// Event campaign as a milestone. With a target it is a tracked number, without
// one a checklist tick. It gets a deadline just inside the phase window.
// { title, why, target, unit, phaseId } → { ok, milestone, phase }
export function addEventMilestone(campaignId, { title, why = "", target = null, unit = "", phaseId = null }) {
  const camp = getCampaign(campaignId);
  const phases = camp?.eventPlan?.phases || [];
  if (!phases.length || !String(title || "").trim()) return { ok: false };
  const today = localISODate();
  const open = phases.filter((p) => p.dateTo >= today);
  const phase = phases.find((p) => p.id === phaseId && p.dateTo >= today) || open[0] || phases[phases.length - 1];
  const n = Number(target);
  const numeric = Number.isFinite(n) && n > 0;
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const late = phase.dateTo > addDaysISO(phase.dateFrom, 2) ? addDaysISO(phase.dateTo, -2) : phase.dateTo;
  const milestone = {
    id, kind: numeric ? "number" : "check", label: String(title).trim().slice(0, 120), description: String(why || "").trim().slice(0, 300), unit: numeric ? String(unit || "").trim().slice(0, 24) : "",
    target: numeric ? Math.round(n) : null, highlight: false, custom: true, fromBrainstorm: true, value: null, done: false, required: true, notApplicable: false, category: "IMPACT",
    dueDate: late < today ? phase.dateTo : late,
  };
  updateCampaign(camp.id, { eventPlan: { ...camp.eventPlan, phases: phases.map((p) => (p.id === phase.id ? { ...p, milestones: [...(p.milestones || []), milestone] } : p)) } });
  return { ok: true, milestone, phase: { id: phase.id, name: phase.name } };
}
function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localISODate(d);
}
