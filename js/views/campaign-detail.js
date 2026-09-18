// Campaign detail — one layout for every campaign shape (mission ladder,
// event windows, phase journey), in the order a beginner asks questions:
// where am I (headline) → what do I do now (next action) → which stage →
// what counts (milestones, each with its source and one button) → what
// content exists for it (activities). Numbers are never typed into the
// page: they're read through js/campaign-metrics.js, and the only manual
// entry is the "Catat angka" sheet for things the app can't observe.
import { howToHTML } from "../howto.js";
import { backLinkHTML } from "../back-link.js";
import {
  getBrand, listContent, createContent, getSettings, updateCampaign, deleteCampaign, completeCampaignStage, setCampaignManualMetric,
  formatEventDate, daysBetween, localISODate, EVENT_ROLES, EVENT_SCALE_TIERS,
  CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_STATUS_LABELS, STATUS_LABELS, missionProgressionNote,
} from "../store.js";
import { campaignStages, activeStageIndex, readStage, readMilestone, campaignHeadline, ladderAdvanceState, campaignActivities, PIPELINE, ageLabel, stageStartedAt, poolFor, PER_POST_METRICS, windowPlanKey, TRACK_ICON, campaignPendingEngagement, campaignPlatform } from "../campaign-metrics.js";
import { getTracker, productStats, trackerTotals } from "../sales-tracker.js";
import { computeContentMetrics } from "../formulas.js";
import { openCampaignReport } from "./campaign-share.js";
import { evaluateLevel, levelReminders } from "../goal-plan.js";
import { nextActions } from "../next-action.js";
import { go } from "../nav-context.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog, promptDialog } from "../modals.js";
import { openCelebration } from "../celebrate.js";
import { toast, formatNumber, qs, qsa, openMenu, closeMenu, escapeHtml as esc } from "../dom.js";
import { brainstormCampaignIdeas, suggestPhaseContent, generateCampaignPlaybook, generateIdeaBubbles, AiApiError, hasAiKey } from "../ai.js";
import { openInsightsModal } from "./insights-modal.js";
import { openQuickFillModal } from "./content-list.js";
import { sectionGuideButtonHTML } from "../section-guide.js";
import { wireGuideButton } from "../guides/common.js";
import { startCampaignDetailGuide } from "../guides/campaign-guide.js";
import { getMode } from "../mode.js";
import { isTourDemo, demoBrainstormIdeas, demoPhaseContent, DEMO_TOAST } from "../tour-demo.js";
import { STATUS_LABELS_GUIDED } from "../funnel-field.js";
import { t } from "../i18n.js";

const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

export function paintDetail(root, brandId, brand, campaign, state, refresh, { openEdit } = {}) {
  const content = listContent(brandId);
  const ctx = { brand, campaign, content, settings: getSettings() };
  const stages = campaignStages(campaign);
  const autoIndex = activeStageIndex(campaign, stages, content);
  if (state.stageIndex === null || state.stageIndex === undefined || state.stageIndex >= stages.length) state.stageIndex = autoIndex;
  const stage = stages[state.stageIndex];
  const guided = getMode() === "guided";
  const isLadder = stage?.kind === "level";
  const isWindow = stage?.kind === "window";

  // Ladder auto-advance: every required milestone met and the level's
  // minimum weeks elapsed → the level completes itself. Deferred so this
  // paint finishes; the resulting db:change repaints with the next level.
  if (isLadder && stage.state === "current" && !state.advancing) {
    const adv = ladderAdvanceState(campaign, stage, ctx);
    if (adv.ready) {
      state.advancing = true;
      state.celebrateIndex = stage.index;
      const doneStage = stage;
      const nextStage = stages[stage.index + 1] || null;
      queueMicrotask(() => {
        completeCampaignStage(campaign.id, stage.index);
        state.stageIndex = Math.min(stage.index + 1, stages.length - 1);
        state.advancing = false;
        toast(t("camp.detail.levelDone", { n: stage.index + 1, name: stage.name }));
        openCelebration(nextStage
          ? {
              eyebrow: esc(t("camp.detail.celebrateEyebrow", { n: doneStage.index + 1 })),
              title: esc(t("camp.detail.celebrateTitle", { name: doneStage.name })),
              sub: esc(`${t("camp.detail.celebrateNext", { n: nextStage.index + 1, name: nextStage.name })} ${nextStage.tagline || ""}`.trim()),
            }
          : {
              final: true,
              eyebrow: esc(t("celebrate.finalEyebrow")),
              title: esc(t("celebrate.finalTitle", { name: campaign.name || "" })),
              sub: esc(t("camp.detail.celebrateAll")),
            });
      });
    }
  }

  const headline = stage ? campaignHeadline(campaign, stages, state.stageIndex, ctx) : null;
  const stageRead = stage ? readStage(stage, ctx) : { readings: [], met: 0, total: 0 };
  const actions = nextActions(ctx);
  const acts = campaignActivities(campaign, content);
  const ctxLabel = t("camp.detail.ctxLabel", { name: campaign.name || "" }).trim();

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}/campaigns`, t("camp.detail.allCampaigns"))}${sectionGuideButtonHTML("campaign-detail")}</div>
        <h1>${esc(campaign.name || t("camp.untitled"))}</h1>
        <p class="page-sub cd-sub">${subLineHTML(campaign, stages, state.stageIndex, guided)}</p>
      </div>
      <div class="cd-head-actions" style="flex:none;">
        <button class="btn btn-secondary btn-sm" id="cd-pdf">${icon("download", { size: 14 })}${t("share.report.button")}</button>
        <button class="btn ${guided ? "btn-ghost btn-sm" : "btn-secondary btn-sm"}" id="edit-campaign">${icon("edit", { size: 14 })}${t("common.edit")}</button>
        <button class="icon-btn" id="cd-more" aria-label="${t("camp.detail.more")}" style="width:36px;height:36px;">${icon("dots", { size: 16 })}</button>
      </div>
    </div>

    ${state.celebrateIndex !== undefined && state.celebrateIndex !== null && stages[state.celebrateIndex]?.state === "completed" ? celebrateHTML(stages[state.celebrateIndex], stages[state.celebrateIndex + 1]) : ""}
    ${headline ? headlineHTML(headline, stageRead, stage) : ""}
    ${pendingEngagementHTML(campaignPendingEngagement(campaign, ctx))}
    ${isLadder ? levelGateHTML(campaign, stage, stageRead, ctx) : ""}
    ${brainstormBarHTML()}
    ${nextActionHTML(actions)}
    ${ideasWidgetHTML(campaign, state)}
    ${salesWidgetHTML(brandId, campaign, brand)}
    ${planRoadmapHTML(campaign, stages, ctx)}
    ${stageNavHTML(stages, state.stageIndex, acts, content, campaign)}

    <div class="mission-panel cd-panel">
      <div class="mission-panel-head">
        <div>
          <div class="page-eyebrow">${stageEyebrow(stage, stages.length)}</div>
          <h3 style="margin:2px 0 4px;">${esc(stage?.name || "")}</h3>
          ${stage?.description ? `<p class="text-muted" style="font-size:13px;margin:0;">${esc(stage.description)}</p>` : ""}
          ${stage?.mergedFrom?.length ? `<p class="text-faint" style="font-size:12px;margin:4px 0 0;">${esc(t("camp.detail.mergedHere", { names: stage.mergedFrom.join(" + ") }))}</p>` : ""}
        </div>
        <div class="cd-stage-progress-col">
          <div class="cd-stage-progress">${isLadder && stageRead.requiredTotal ? t("camp.detail.stageProgressRequired", { met: stageRead.requiredMet, total: stageRead.requiredTotal }) : stageRead.total ? t("camp.detail.stageProgress", { met: stageRead.met, total: stageRead.total }) : ""}</div>
          ${!guided && stage ? `<button type="button" class="btn btn-ghost btn-sm" id="cd-add-milestone">${icon("plus", { size: 13 })}${t("camp.detail.addMilestone")}</button>` : ""}
        </div>
      </div>
      ${
        // 5.3: Pemula seeing this campaign with zero content linked yet has
        // nothing to act on in the mission tree/milestones/rules — the
        // headline above still shows, this just isn't the first thing in
        // their face. Pro (and Pemula once content exists) unchanged.
        guided && acts.linked.length === 0
          ? `<details class="cd-optional">
               <summary>${t("camp.detail.optionalTargets", { n: stageRead.readings.filter((r) => !r.milestone.notApplicable).length })}</summary>
               ${isLadder ? missionTreeHTML(stage, stageRead.readings) : ""}
               ${milestoneListHTML(stageRead.readings, stage, guided)}
               ${ladderRulesHTML(campaign, stage, guided)}
             </details>`
          : `${isLadder ? missionTreeHTML(stage, stageRead.readings) : ""}
             ${milestoneListHTML(stageRead.readings, stage, guided)}
             ${ladderRulesHTML(campaign, stage, guided)}`
      }
    </div>

    ${(campaign.goalPlan?.version === 2 || campaign.goalPlan?.version === 3) && isLadder ? growBrandStatusHTML(campaign, stage, stageRead) : ""}
    ${activitiesHTML(acts, brandId, guided)}
    ${isWindow && campaign.eventPlan ? eventScoreHTML(campaign, stages, ctx) : ""}
  `;

  wireGuideButton(root, "campaign-detail", () => startCampaignDetailGuide(brandId, campaign.id));
  qs("#edit-campaign", root)?.addEventListener("click", () => openEdit?.());
  qs("#cd-pdf", root)?.addEventListener("click", () => openCampaignReport({ brand, campaign, stages, ctx }));
  qsa("[data-cd-delegated]", root).forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = `#/brand/${brandId}/campaigns/${a.dataset.cdDelegated}`;
    })
  );
  qsa("[data-cd-ms-posts]", root).forEach((btn) =>
    btn.addEventListener("click", () => openPostList(stageRead.readings[Number(btn.dataset.cdMsPosts)], { brandId, ctx, ctxLabel, campaign, stage }))
  );
  qs("#cd-more", root)?.addEventListener("click", (e) => openMoreMenu(e.currentTarget, { brandId, campaign, stage, ctx, refresh, state, guided }));
  qs("#cd-add-milestone", root)?.addEventListener("click", async () => {
    const isNumber = await confirmDialog({ title: t("camp.detail.addMilestone"), message: t("camp.detail.addMilestoneKindQ"), confirmLabel: t("camp.detail.addNumber"), cancelLabel: t("camp.detail.addCheck") });
    await addMilestoneFlow(isNumber ? "number" : "check", { campaign, stage, refresh });
  });
  qs("[data-cd-celebrate-close]", root)?.addEventListener("click", () => {
    state.celebrateIndex = null;
    refresh();
  });
  qsa("[data-cd-stage]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.stageIndex = Number(btn.dataset.cdStage);
      refresh();
    })
  );
  const run = (cta) => runAction(cta, { brandId, brand, campaign, stage, stages, ctx, refresh, ctxLabel });
  qsa("[data-cd-action]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const a = actions[Number(btn.dataset.cdAction)];
      if (a) run(a.cta);
    })
  );
  qsa("[data-cd-ms-action]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const r = stageRead.readings[Number(btn.dataset.cdMsAction)];
      // The community identity milestone stays editable after it's met —
      // unlike a checkbox, a name/nickname someone might want to revisit —
      // so it needs an action even once readMilestone() stops handing one out.
      if (r?.action) run({ ...r.action, milestoneId: r.milestone.id });
      else if (r?.milestone.key === "concept" && r.milestone.track === "community") run({ type: "manual", milestoneId: r.milestone.id });
    })
  );
  qsa("[data-cd-ms-menu]", root).forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMilestoneMenu(btn, stageRead.readings[Number(btn.dataset.cdMsMenu)], { campaign, stage, refresh });
    })
  );
  // Phone widths: the tree is wider than the screen (see .cd-tree
  // min-width) — start it scrolled to the middle so the trunk is centred
  // and both halves of the canopy peek in, instead of opening on branch 1.
  const treeScroll = qs(".cd-tree-scroll", root);
  if (treeScroll) treeScroll.scrollLeft = Math.max(0, (treeScroll.scrollWidth - treeScroll.clientWidth) / 2);
  qsa(".mission-node", root).forEach((node) =>
    node.addEventListener("click", () => {
      const row = qs(`.cd-row[data-milestone-index="${node.dataset.milestoneIndex}"]`, root);
      if (!row) return;
      qsa(".cd-row.is-highlight", root).forEach((r) => r.classList.remove("is-highlight"));
      row.classList.add("is-highlight");
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    })
  );
  qs("[data-cd-insights]", root)?.addEventListener("click", () => run({ type: "insights" }));
  qs("#cd-manual-all", root)?.addEventListener("click", () => openManualSheet({ campaign, stage, ctx, refresh }));
  qsa("[data-cd-brainstorm]", root).forEach((btn) => btn.addEventListener("click", () => openBrainstormModal({ brandId, brand, campaign, stage, refresh, ctxLabel })));
  qs("#cd-new-content", root)?.addEventListener("click", () => run({ type: "new-content" }));
  qsa("[data-cd-open-content]", root).forEach((row) =>
    row.addEventListener("click", () => run({ type: "creator", contentId: row.dataset.cdOpenContent, intent: "continue" }))
  );
  qsa("[data-cd-pipeline]", root).forEach((chip) =>
    chip.addEventListener("click", () => go(`#/brand/${brandId}/content-os/list`, { fromLabel: ctxLabel, campaignId: campaign.id, status: chip.dataset.cdPipeline }))
  );
  wirePlanRoadmap(root, { brand, campaign, stages, refresh });
  wireIdeasWidget(root, { brand, campaign, refresh, state });
  wireSalesWidget(root, { campaign, refresh });
  qsa("[data-cd-pending]", root).forEach((row) =>
    row.addEventListener("click", () => {
      const c = content.find((x) => x.id === row.dataset.cdPending);
      if (c) openQuickFillModal({ c, onSaved: refresh });
    })
  );
}

// ---------- Blocks ----------

function subLineHTML(campaign, stages, index, guided) {
  const stage = stages[index];
  const parts = [];
  if (stage?.kind === "level") parts.push(t("camp.levelOf", { n: index + 1, total: stages.length }));
  if (stage?.kind === "window" && !campaign.eventPlan) {
    // First-generation Grow Brand plan: dated stages toward one target.
    const plan = campaign.goalPlan;
    const days = daysBetween(localISODate(), plan.deadline);
    parts.push(`${t("goal.detail.sub", { target: formatNumber(plan.target), unit: esc(plan.unit || "") })} · ${days > 0 ? t("camp.detail.daysToGo", { days }) : days === 0 ? t("camp.m.today") : t("camp.m.daysAgo", { count: -days })}`);
  } else if (stage?.kind === "window") {
    const ev = campaign.eventPlan;
    const days = daysBetween(localISODate(), ev.eventDate);
    parts.push(`${t("camp.detail.eventOn", { date: formatEventDate(ev.eventDate) })} · ${days > 0 ? t("camp.detail.daysToGo", { days }) : days === 0 ? t("camp.m.today") : t("camp.m.daysAgo", { count: -days })}`);
    const role = EVENT_ROLES.find((r) => r.id === ev.role)?.label;
    if (role && !guided) parts.push(role.split(" / ")[0]);
    const scale = EVENT_SCALE_TIERS.find((tier) => tier.id === ev.scale)?.label;
    if (scale && !guided) parts.push(t("camp.detail.scale", { scale }));
  }
  if (stage?.kind === "phase") parts.push(t("camp.detail.phaseCount", { count: stages.length }));
  if (!guided) parts.push(`<span class="tag">${esc(CAMPAIGN_OBJECTIVE_LABELS[campaign.objective] || campaign.objective)}</span> <span class="status-pill ${CAMPAIGN_STATUS_PILL_CLASS[campaign.status] || ""}" style="padding:2px 8px;"><span class="status-dot"></span>${esc(CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status)}</span>`);
  return parts.join(" · ");
}

function stageEyebrow(stage, total) {
  if (!stage) return "";
  if (stage.kind === "level") return `${t("camp.levelOf", { n: stage.index + 1, total })}${stage.state === "completed" ? ` · ${t("camp.detail.done")}` : stage.state === "locked" ? ` · ${t("camp.detail.notUnlocked")}` : ""}${stage.tagline ? ` · ${esc(stage.tagline)}` : ""}`;
  if (stage.kind === "window") return `${esc(stage.dateLabel)} · ${stage.state === "current" ? t("camp.detail.inProgress") : stage.state === "past" ? t("camp.detail.past") : t("camp.detail.upcoming")}`;
  return t("camp.detail.phase");
}

function celebrateHTML(done, next) {
  return `
    <div class="card cd-celebrate">
      <div>
        <div class="page-eyebrow" style="margin-bottom:4px;">${t("camp.detail.celebrateEyebrow", { n: done.index + 1 })}</div>
        <h3 style="margin:0 0 4px;">${esc(t("camp.detail.celebrateTitle", { name: done.name }))}</h3>
        <p class="text-muted" style="font-size:13px;margin:0;">${next ? `${esc(t("camp.detail.celebrateNext", { n: next.index + 1, name: next.name }))} ${esc(next.tagline || "")}` : t("camp.detail.celebrateAll")}</p>
      </div>
      <button type="button" class="icon-btn" data-cd-celebrate-close aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>`;
}

function headlineHTML({ milestone, reading }, stageRead, stage) {
  const pct = Math.round(reading.pct * 100);
  const hasTarget = !!reading.target && !reading.isCheck;
  // 7: "milestone" reads as jargon in Pemula copy — "target" everywhere
  // this jargon-free mode is the one actually looking at it.
  const guided = getMode() === "guided";
  const big = hasTarget
    ? `${formatNumber(reading.current)} <span class="cd-headline-target">/ ${formatNumber(reading.target)} ${esc(reading.unit)}</span>`
    : `${stageRead.met} <span class="cd-headline-target">${t(guided ? "camp.detail.milestonesReachedGuided" : "camp.detail.milestonesReached", { total: stageRead.total })}</span>`;
  // Without a single numeric target, "X%" here would read as a precise
  // metric when it's really a milestone-count ratio — the big number above
  // already says that honestly ("3 of 5 targets reached"). The bar still
  // fills to the same proportion (a fair rough visual), but the foot line
  // only prints a bare percentage when it's backed by one real number.
  const barPct = hasTarget ? pct : stageRead.total ? Math.round((stageRead.met / stageRead.total) * 100) : 0;
  const footPct = hasTarget ? `${barPct}% · ` : "";
  const source = reading.auto
    ? `${esc(reading.sourceLabel)}${reading.updatedAt ? ` · <span class="${reading.stale ? "cd-stale" : ""}">${esc(t("camp.detail.updatedAgo", { age: ageLabel(reading.updatedAt) }))}</span>` : reading.home === "insights" ? ` · <span class="cd-stale">${t("camp.detail.neverLogged")}</span>` : ` · ${t("camp.m.auto")}`}`
    : `${t("camp.m.home.manual")}${reading.updatedAt ? ` · ${esc(ageLabel(reading.updatedAt))}` : ""}`;
  const remaining = hasTarget && reading.current < reading.target ? esc(t("camp.detail.remaining", { count: formatNumber(reading.target - reading.current), unit: reading.unit })) : hasTarget ? t("camp.detail.targetReached") : "";
  return `
    <div class="card cd-headline">
      <div class="cd-headline-label">${esc(milestone.label)}${stage?.kind === "window" && stage.state === "past" ? ` · ${t("camp.detail.phaseOver")}` : ""}</div>
      <div class="cd-headline-big">${big}</div>
      <div class="cd-bar"><span style="width:${barPct}%"></span></div>
      <div class="cd-headline-foot">
        <span>${footPct}${source}${remaining ? ` · ${remaining}` : ""}</span>
        ${reading.home === "insights" ? `<button type="button" class="btn btn-secondary btn-sm" data-cd-insights>${icon("refresh", { size: 12 })}${reading.logged ? t("camp.m.update") : t("camp.m.fillInsights")}</button>` : ""}
      </div>
    </div>`;
}

// #8: published content in this campaign that still has no engagement
// numbers — surfaced right under the headline (not buried in a details
// menu) so filling them in is a one-click affair instead of a hunt through
// Content OS. Click opens the same Quick Fill modal content-list.js uses.
function pendingEngagementHTML(pending) {
  if (!pending.length) return "";
  const shown = pending.slice(0, 5);
  return `
    <div class="card cd-pending-engagement">
      <div class="cd-pending-head">
        <div>
          <b>${t("camp.detail.pendingEngagementTitle", { count: pending.length })}</b>
          <p class="text-muted" style="font-size:12.5px;margin:2px 0 0;">${t("camp.detail.pendingEngagementSub")}</p>
        </div>
      </div>
      <div class="cd-pending-list">
        ${shown.map((c) => `<button type="button" class="cd-pending-row" data-cd-pending="${c.id}"><span>${esc(c.title || t("common.untitled"))}</span>${icon("arrowRight", { size: 13 })}</button>`).join("")}
      </div>
    </div>`;
}

// ---------- Sales Tracker widget (Sales Growth campaigns only) ----------
// A read-only mirror of js/views/sales.js for this campaign's own products —
// same numbers as the Sales Tracker page (js/sales-tracker.js keeps them in
// sync both ways already), so nobody has to leave the campaign to see "what
// sold how much", with one button straight to the full tracker to log a sale
// or manage products. Closable, same pattern as Rencana/Ide Campaign above.
function salesWidgetHTML(brandId, campaign, brand) {
  if (campaign.goalPlan?.track !== "sales") return "";
  if (campaign.salesWidgetCollapsed) {
    return `
      <div class="card cd-plan-collapsed" id="cd-sales-collapsed">
        <span>${icon("target", { size: 14 })}${t("camp.sales.collapsedTitle")}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="cd-sales-expand">${t("camp.sales.expand")}</button>
      </div>`;
  }
  const tracker = getTracker(brand);
  const stats = productStats(tracker).filter((s) => !s.product.archived);
  const totals = trackerTotals(tracker);
  const targetOf = (id) => campaign.goalPlan?.products?.find((p) => p.id === id)?.target || null;
  const row = (s) => {
    const target = targetOf(s.product.id);
    const pct = target ? Math.min(100, Math.round((s.sold / target) * 100)) : 0;
    return `
      <div class="cd-sales-row">
        <span class="cd-sales-name">${esc(s.product.name)}</span>
        <span class="cd-sales-sold">${formatNumber(s.sold)}${target ? ` <span class="text-faint">/ ${formatNumber(target)}</span>` : ""}</span>
        ${target ? `<div class="cd-bar"><span style="width:${pct}%"></span></div>` : ""}
      </div>`;
  };
  return `
    <div class="section-title" style="margin-top:24px;"><h2>${t("camp.sales.title")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.sales.sub")}</span></div>
    <div class="card cd-sales-widget" id="cd-sales-widget">
      <button type="button" class="icon-btn cd-plan-close-btn" id="cd-sales-close" aria-label="${t("camp.plan.close")}" title="${t("camp.plan.close")}">${icon("x", { size: 13 })}</button>
      ${stats.length
        ? `<div class="cd-sales-list">${stats.map(row).join("")}</div>
           <div class="cd-sales-total"><span>${t("camp.sales.totalSold")}</span><b>${formatNumber(totals.sold)}</b></div>`
        : `<p class="text-muted" style="font-size:13px;margin:0 0 10px;">${t("camp.sales.empty")}</p>`}
      <a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/sales" style="margin-top:12px;">${icon("arrowRight", { size: 13 })}${t("camp.sales.openTracker")}</a>
    </div>`;
}
function wireSalesWidget(root, { campaign, refresh }) {
  qs("#cd-sales-close", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { salesWidgetCollapsed: true });
    refresh();
  });
  qs("#cd-sales-expand", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { salesWidgetCollapsed: false });
    refresh();
  });
}

// ---------- Ide Campaign (bubble idea board) ----------
// A persistent, always-visible board so the ideas someone already had for
// this campaign don't live only inside a modal they have to reopen —
// type one, or generate a batch with AI, and it stays here as a small
// pill. Kept ideas also flow into every OTHER AI call for this campaign
// (js/ai.js campaignSummaryLine) so later content/plan generation stays
// aligned with what was already decided, not just what's on this page.
const IDEA_TRACK_COPY = { social: "social", community: "community", sales: "sales" };
function ideasWidgetHTML(campaign, state) {
  const track = IDEA_TRACK_COPY[campaign.goalPlan?.track] || "";
  // Closable, same pattern as the Rencana widget just above it — collapses
  // to a one-line bar so the page doesn't stay crowded once the ideas are
  // captured and the user's back to just executing.
  if (campaign.ideasCollapsed) {
    return `
      <div class="card cd-ideas-collapsed" id="cd-ideas-collapsed">
        <span>${icon("bulb", { size: 14 })}${t(`camp.ideas.title.${track || "default"}`)}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="cd-ideas-expand">${t("camp.ideas.expand")}</button>
      </div>`;
  }
  const ideas = campaign.ideas || [];
  const suggestions = state.ideaSuggestions || [];
  const trackCls = track ? `cd-idea-bubble--${track}` : "";
  // Kept ideas open like a folder on click — the description (AI's "why",
  // or a note the user adds) stays out of the way until someone wants it,
  // instead of crowding every bubble at a glance.
  const bubble = (idea) => {
    const open = state.expandedIdeaId === idea.id;
    return `
    <div class="cd-idea-bubble ${trackCls} ${open ? "is-open" : ""}" data-idea-id="${idea.id}">
      <button type="button" class="cd-idea-bubble-head" data-idea-toggle="${idea.id}">
        ${idea.source === "ai" ? icon("sparkle", { size: 11 }) : icon("folder", { size: 11 })}
        <span>${esc(idea.text)}</span>
        ${icon("chevronDown", { size: 12 })}
      </button>
      <button type="button" class="cd-idea-x" data-idea-remove="${idea.id}" aria-label="${t("common.delete")}">${icon("x", { size: 11 })}</button>
      ${open ? `
        <div class="cd-idea-desc">
          ${idea.description ? `<p>${esc(idea.description)}</p>` : `<p class="text-faint">${t("camp.ideas.noDesc")}</p>`}
          <textarea class="textarea" id="cd-idea-desc-input" placeholder="${esc(t("camp.ideas.descPh"))}">${esc(idea.description || "")}</textarea>
          <button type="button" class="btn btn-secondary btn-sm" data-idea-save-desc="${idea.id}">${t("camp.ideas.saveDesc")}</button>
        </div>` : ""}
    </div>`;
  };
  const suggestionBubble = (idea, i) => `
    <div class="cd-idea-bubble cd-idea-bubble--suggestion ${trackCls}">
      <div class="cd-idea-suggestion-row">
        <div class="cd-idea-bubble-head" style="cursor:default;">${icon("sparkle", { size: 11 })}<span>${esc(idea.text)}</span></div>
        <button type="button" class="cd-idea-add-suggestion" data-suggestion-add="${i}" aria-label="${t("camp.ideas.keepOne")}">${icon("plus", { size: 12 })}</button>
      </div>
      ${idea.description ? `<p class="cd-idea-suggestion-desc">${esc(idea.description)}</p>` : ""}
    </div>`;
  return `
    <div class="section-title" style="margin-top:24px;"><h2>${t(`camp.ideas.title.${track || "default"}`)}</h2><span class="text-faint" style="font-size:12px;">${t(`camp.ideas.sub.${track || "default"}`)}</span></div>
    <div class="card cd-ideas">
      <button type="button" class="icon-btn cd-ideas-close-btn" id="cd-ideas-close" aria-label="${t("camp.plan.close")}" title="${t("camp.plan.close")}">${icon("x", { size: 13 })}</button>
      <div class="cd-ideas-input">
        <input class="input" id="cd-idea-input" maxlength="140" placeholder="${esc(t(`camp.ideas.placeholder.${track || "default"}`))}" />
        <button type="button" class="btn btn-primary btn-sm" id="cd-idea-add">${icon("plus", { size: 13 })}${t("camp.ideas.add")}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="cd-idea-ai">${icon("sparkle", { size: 13 })}${t(`camp.ideas.aiBtn.${track || "default"}`)}</button>
      </div>
      <div id="cd-idea-status"></div>
      ${suggestions.length ? `<div class="cd-idea-bubbles cd-idea-suggestions" id="cd-idea-suggestions">${suggestions.map(suggestionBubble).join("")}</div>` : `<div id="cd-idea-suggestions"></div>`}
      <div class="cd-idea-bubbles" id="cd-idea-kept">
        ${ideas.length ? ideas.map(bubble).join("") : `<p class="text-faint cd-idea-empty">${t(`camp.ideas.empty.${track || "default"}`)}</p>`}
      </div>
    </div>`;
}
function wireIdeasWidget(root, { brand, campaign, refresh, state }) {
  qs("#cd-ideas-close", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { ideasCollapsed: true });
    refresh();
  });
  qs("#cd-ideas-expand", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { ideasCollapsed: false });
    refresh();
  });
  const input = qs("#cd-idea-input", root);
  if (!input) return;
  const addIdea = (text, source, description = "") => {
    const clean = text.trim();
    if (!clean) return;
    const ideas = [...(campaign.ideas || []), { id: `idea-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: clean, description, source, createdAt: Date.now() }];
    updateCampaign(campaign.id, { ideas });
    refresh();
  };
  const submit = () => {
    if (!input.value.trim()) return;
    addIdea(input.value, "manual");
  };
  qs("#cd-idea-add", root).addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  qsa("[data-idea-toggle]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.ideaToggle;
      state.expandedIdeaId = state.expandedIdeaId === id ? null : id;
      refresh();
    })
  );
  qsa("[data-idea-remove]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      updateCampaign(campaign.id, { ideas: (campaign.ideas || []).filter((i) => i.id !== btn.dataset.ideaRemove) });
      if (state.expandedIdeaId === btn.dataset.ideaRemove) state.expandedIdeaId = null;
      refresh();
    })
  );
  qsa("[data-idea-save-desc]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.ideaSaveDesc;
      const description = qs("#cd-idea-desc-input", root)?.value.trim() || "";
      updateCampaign(campaign.id, { ideas: (campaign.ideas || []).map((i) => (i.id === id ? { ...i, description } : i)) });
      toast(t("camp.ideas.saveDesc"));
      refresh();
    })
  );
  qsa("[data-suggestion-add]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.suggestionAdd);
      const idea = (state.ideaSuggestions || [])[i];
      if (!idea) return;
      state.ideaSuggestions = state.ideaSuggestions.filter((_, n) => n !== i);
      addIdea(idea.text, "ai", idea.description || "");
    })
  );
  qs("#cd-idea-ai", root).addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const btn = qs("#cd-idea-ai", root);
    const statusEl = qs("#cd-idea-status", root);
    if (isTourDemo()) return toast(DEMO_TOAST);
    if (!hasAiKey(ai)) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin:6px 0;">${t("camp.bs.noKey")}</div>`;
      return;
    }
    btn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status" style="margin:6px 0;"><div class="spinner"></div><span>${t("camp.ideas.thinking")}</span></div>`;
    try {
      const { ideas } = await generateIdeaBubbles(ai, { brand, campaign, track: campaign.goalPlan?.track, existingIdeas: (campaign.ideas || []).map((i) => i.text) });
      state.ideaSuggestions = ideas;
      statusEl.innerHTML = "";
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status" style="margin:6px 0;">${icon("info", { size: 14 })}<span>${esc(e instanceof AiApiError ? e.message : t("camp.aiFailed"))}</span></div>`;
    } finally {
      btn.disabled = false;
      refresh();
    }
  });
}

// ---------- Rencana (Grow Brand campaigns) ----------
// The whole campaign as one readable roadmap: every level, what it's
// aiming at, and the non-content activities planned for it. The AI button
// writes campaign.aiPlan (js/ai.js generateCampaignPlaybook): what the
// community should be / how this brand should sell, plus activity ideas per
// level — each can be pushed into that level as an (optional) checklist
// target, so it's tracked like everything else instead of staying a note.
function planRoadmapHTML(campaign, stages, ctx) {
  if (campaign.goalPlan?.version !== 3 || stages[0]?.kind !== "level") return "";
  const track = campaign.goalPlan.track;
  // Closable: a widget the user has to look past every time they open the
  // campaign gets closed once they don't need it any more — collapses to a
  // one-line bar with a way back, instead of disappearing for good.
  if (campaign.planCollapsed) {
    return `
      <div class="card cd-plan-collapsed" id="cd-plan-collapsed">
        <span>${icon("layers", { size: 14 })}${t("camp.plan.collapsedTitle")}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="cd-plan-expand">${t("camp.plan.expand")}</button>
      </div>`;
  }
  const plan = campaign.aiPlan || null;
  const levelHTML = (s) => {
    const read = readStage(s, ctx);
    const head = s.milestones.find((m) => m.highlight && !m.notApplicable) || s.milestones.find((m) => m.target && !m.notApplicable);
    const acts = plan?.levels?.find((l) => l.index === s.index)?.activities || [];
    const cls = s.state === "completed" ? "is-done" : s.state === "locked" ? "is-locked" : "is-current";
    const stateLabel = s.state === "completed" ? t("camp.detail.done") : s.state === "locked" ? t("camp.detail.locked") : t("camp.detail.now");
    return `
      <li class="cd-plan-level ${cls}">
        <span class="cd-plan-dot">${s.state === "completed" ? icon("check", { size: 13 }) : s.index + 1}</span>
        <div class="cd-plan-body">
          <div class="cd-plan-head"><b>${esc(s.name)}</b><span class="cd-plan-state">${esc(stateLabel)}</span></div>
          <p class="cd-plan-target">${head ? `${esc(head.label)}${head.target ? `: <b>${formatNumber(head.target)}</b> ${esc(head.unit || "")}` : ""} · ` : ""}${t("camp.plan.req", { met: read.requiredMet, total: read.requiredTotal })}</p>
          ${acts.length ? `<div class="cd-plan-acts">${acts.map((a, n) => `
            <div class="cd-plan-act">
              <div><b>${esc(a.title)}</b>${a.type ? ` <span class="tag">${esc(a.type)}</span>` : ""}<p>${esc(a.how)}</p></div>
              ${a.added ? `<span class="cd-plan-added">${icon("check", { size: 12 })}${t("camp.plan.added")}</span>` : `<button type="button" class="btn btn-secondary btn-sm" data-plan-add="${s.index}:${n}">${icon("plus", { size: 12 })}${t("camp.plan.add")}</button>`}
            </div>`).join("")}</div>` : ""}
        </div>
      </li>`;
  };
  return `
    <div class="section-title" style="margin-top:24px;"><h2>${t("camp.plan.title")}</h2><span class="text-faint" style="font-size:12px;">${t(`camp.plan.sub.${track}`)}</span></div>
    <div class="card cd-plan" id="cd-plan">
      <button type="button" class="icon-btn cd-plan-close-btn" id="cd-plan-close" aria-label="${t("camp.plan.close")}" title="${t("camp.plan.close")}">${icon("x", { size: 13 })}</button>
      ${plan?.concept?.title ? `
        <div class="cd-plan-concept">
          <div class="page-eyebrow" style="margin-bottom:4px;">${t(`camp.plan.concept.${track}`)}</div>
          <h3>${esc(plan.concept.title)}</h3>
          <p>${esc(plan.concept.summary)}</p>
          ${plan.concept.howToRun?.length ? `<details open><summary>${t("camp.plan.howToRun")}</summary><ul>${plan.concept.howToRun.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></details>` : ""}
        </div>` : `<p class="text-muted" style="font-size:13px;margin:0 0 12px;">${t(`camp.plan.empty.${track}`)}</p>`}
      <div class="cd-plan-ai">
        <input class="input" id="cd-plan-context" placeholder="${esc(t("camp.plan.contextPh"))}" />
        <button type="button" class="btn ${plan ? "btn-secondary" : "btn-primary"}" id="cd-plan-ai">${icon("sparkle", { size: 14 })}${plan ? t("camp.plan.aiAgain") : t("camp.plan.aiBtn")}</button>
      </div>
      <div id="cd-plan-status"></div>
      <ol class="cd-plan-levels">${stages.map(levelHTML).join("")}</ol>
    </div>`;
}

function wirePlanRoadmap(root, { brand, campaign, stages, refresh }) {
  qs("#cd-plan-close", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { planCollapsed: true });
    refresh();
  });
  qs("#cd-plan-expand", root)?.addEventListener("click", () => {
    updateCampaign(campaign.id, { planCollapsed: false });
    refresh();
  });
  const btn = qs("#cd-plan-ai", root);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const statusEl = qs("#cd-plan-status", root);
    if (isTourDemo()) return toast(DEMO_TOAST);
    if (!hasAiKey(ai)) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;margin-bottom:10px;">${t("camp.bs.noKey")}</div>`;
      return;
    }
    btn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status" style="margin-bottom:10px;"><div class="spinner"></div><span>${t("camp.plan.thinking")}</span></div>`;
    try {
      const levels = stages.map((s) => ({ index: s.index, name: s.name, description: s.description, targets: s.milestones.filter((m) => m.required !== false && !m.notApplicable).map((m) => `${m.label}${m.target ? ` ${m.target} ${m.unit || ""}` : ""}`) }));
      const result = await generateCampaignPlaybook(ai, { brand, campaign, track: campaign.goalPlan.track, levels, extra: qs("#cd-plan-context", root)?.value.trim() || "" });
      updateCampaign(campaign.id, { aiPlan: { ...result, generatedAt: Date.now() } });
      toast(t("camp.plan.saved"));
      refresh();
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status" style="margin-bottom:10px;">${icon("info", { size: 14 })}<span>${esc(e instanceof AiApiError ? e.message : t("camp.plan.failed"))}</span></div>`;
      btn.disabled = false;
    }
  });
  qsa("[data-plan-add]", root).forEach((b) =>
    b.addEventListener("click", () => {
      const [li, ai] = b.dataset.planAdd.split(":").map(Number);
      const stage = stages.find((s) => s.index === li);
      const act = campaign.aiPlan?.levels?.find((l) => l.index === li)?.activities?.[ai];
      if (!stage || !act) return;
      // Optional on purpose: an idea the user liked shouldn't start blocking the level.
      addCustomMilestone(campaign, stage, { label: act.title, kind: "check", description: act.how, required: false });
      updateCampaign(campaign.id, { aiPlan: { ...campaign.aiPlan, levels: campaign.aiPlan.levels.map((l) => (l.index === li ? { ...l, activities: l.activities.map((a, n) => (n === ai ? { ...a, added: true } : a)) } : l)) } });
      toast(t("camp.plan.addedToast", { n: li + 1 }));
      refresh();
    })
  );
}

// The one AI helper of this page, where nobody has to hunt for it: right
// under the headline number, full width, in the accent colour.
function brainstormBarHTML() {
  return `
    <button type="button" class="cd-brainstorm-bar" id="cd-brainstorm" data-cd-brainstorm>
      <span class="cd-brainstorm-icon">${icon("bulb", { size: 20 })}</span>
      <span class="cd-brainstorm-text"><b>${t("camp.detail.brainstorm")}</b><small>${t("camp.detail.brainstormSub")}</small></span>
      <span class="cd-brainstorm-go">${icon("sparkle", { size: 13 })}${t("camp.detail.brainstormGo")}${icon("arrowRight", { size: 14 })}</span>
    </button>`;
}

function nextActionHTML(actions) {
  if (!actions.length) return "";
  const [first, ...rest] = actions;
  return `
    <div class="card cd-next" id="cd-next">
      <div class="page-eyebrow" style="margin-bottom:6px;">${t("camp.detail.nextStep")}</div>
      <h3 class="cd-next-title">${esc(first.label)}</h3>
      <p class="cd-next-why">${esc(first.why)}</p>
      <div class="cd-next-actions">
        ${first.cta.type !== "info" ? `<button type="button" class="btn btn-primary" data-cd-action="0">${esc(first.cta.label)}${icon("arrowRight", { size: 14 })}</button>` : ""}
        ${rest.length ? `<span class="cd-next-rest">${t("camp.detail.then")} ${rest.map((a, i) => (a.cta.type !== "info" ? `<button type="button" class="cd-next-chip" data-cd-action="${i + 1}">${esc(a.cta.label || a.label)}</button>` : `<span class="cd-next-chip is-info">${esc(a.label)}</span>`)).join(" · ")}</span>` : ""}
      </div>
    </div>`;
}

function stageNavHTML(stages, index, acts, content, campaign) {
  if (stages.length <= 1) return "";
  return `
    <div class="event-timeline cd-stages" id="cd-stages">
      ${stages
        .map((s, i) => {
          const sub =
            s.kind === "level" ? (s.state === "completed" ? t("camp.detail.done") : s.state === "locked" ? t("camp.detail.locked") : t("camp.detail.now")) : s.kind === "window" ? s.dateLabel : t("camp.detail.contentCount", { count: content.filter((c) => c.campaignId === campaign.id && c.campaignPhaseId === s.id).length });
          const cls = s.kind === "level" ? (s.state === "completed" ? "status-completed" : s.state === "locked" ? "is-locked" : "status-in_progress") : s.kind === "window" ? (s.state === "past" ? "is-past" : s.state === "current" ? "status-in_progress" : "") : "";
          return `<button type="button" class="event-phase-pill ${cls} ${i === index ? "active" : ""}" data-cd-stage="${i}">
            <span class="event-phase-name">${s.kind === "level" ? `${i + 1}. ` : ""}${esc(s.name)}</span>
            <span class="event-phase-date">${esc(sub)}</span>
          </button>`;
        })
        .join("")}
    </div>`;
}

function milestoneListHTML(readings, stage, guided) {
  if (!readings.length) return `<div class="table-empty" style="padding:20px;">${t(guided ? "camp.detail.noMilestonesGuided" : "camp.detail.noMilestones")}</div>`;
  const required = readings.filter((r) => r.milestone.required !== false && !r.milestone.notApplicable);
  const optional = readings.filter((r) => r.milestone.required === false && !r.milestone.notApplicable);
  const na = readings.filter((r) => r.milestone.notApplicable && !r.milestone.delegatedTo);
  // Targets another Grow Brand campaign already tracks: one line per
  // campaign with a link, instead of the same rows all over again.
  const delegated = readings.filter((r) => r.milestone.delegatedTo);
  const owners = [...new Map(delegated.map((r) => [r.milestone.delegatedTo.id, r.milestone.delegatedTo])).values()];
  const delegatedHTML = owners
    .map((o) => {
      const items = delegated.filter((r) => r.milestone.delegatedTo.id === o.id);
      return `<a class="cd-delegated" href="#" data-cd-delegated="${o.id}">${icon("link", { size: 13 })}<span>${esc(t("camp.detail.delegated", { count: items.length, name: o.name }))}<small>${esc(items.map((r) => r.milestone.label).join(" · "))}</small></span>${icon("arrowRight", { size: 13 })}</a>`;
    })
    .join("");
  // The community identity milestone never appears in the bulk manual sheet
  // (openManualSheet) — it has its own modal — so it's left out of this count too.
  const manualCount = readings.filter((r) => !r.auto && !r.milestone.notApplicable && !(r.milestone.key === "concept" && r.milestone.track === "community")).length;
  const row = (r) => milestoneRowHTML(r, readings.indexOf(r), stage, guided);
  return `
    <div class="cd-milestones" id="cd-milestones">
      ${groupedRowsHTML(required, row)}
      ${optional.length ? `<details class="cd-optional"><summary>${t("camp.detail.optionalCount", { count: optional.length })}</summary>${optional.map(row).join("")}</details>` : ""}
      ${delegatedHTML}
      ${na.length && !guided ? `<details class="cd-optional"><summary>${t("camp.detail.naCount", { count: na.length })}</summary>${na.map(row).join("")}</details>` : ""}
    </div>
    ${manualCount ? `<div class="cd-manual-foot"><button type="button" class="btn btn-secondary btn-sm" id="cd-manual-all">${icon("edit", { size: 13 })}${t("camp.detail.logManualCount", { count: manualCount })}</button></div>` : ""}
  `;
}

// Grow Brand milestones carry a `track`; a level's required list reads far
// easier as three short groups than as one flat column. Anything without a
// track (old ladders, custom milestones) keeps the flat list.
function groupedRowsHTML(readings, row) {
  if (!readings.some((r) => r.milestone.track)) return readings.map(row).join("");
  return ["social", "community", "sales", ""]
    .map((track) => {
      const items = readings.filter((r) => (r.milestone.track || "") === track);
      if (!items.length) return "";
      const head = track ? `<div class="cd-track-head">${icon(TRACK_ICON[track], { size: 13 })}${t(`goal.track.${track}`)}<span>${items.filter((r) => r.met).length}/${items.length}</span></div>` : "";
      return head + items.map(row).join("");
    })
    .join("");
}

// Why the next level is (or isn't) opening — the answer to "every bar is
// full, why am I still here?". Old ladders keep a minimum-weeks rule;
// Grow Brand has none (its consistency rule is a visible milestone).
function levelGateHTML(campaign, stage, stageRead, ctx) {
  if (stage.state !== "current") return "";
  const adv = ladderAdvanceState(campaign, stage, ctx);
  if (adv.targetsMet && !adv.ready) {
    return `<div class="card cd-gate is-wait"><h3>${esc(t("camp.gate.waitTitle", { weeks: adv.weeksLeft }))}</h3><p>${esc(t("camp.gate.waitBody", { min: adv.minWeeks, weeks: adv.weeks }))}</p></div>`;
  }
  if (adv.targetsMet) return "";
  const open = stageRead.readings.filter((r) => r.milestone.required !== false && !r.milestone.notApplicable && !r.met);
  const head = stageRead.readings.find((r) => r.milestone.highlight);
  // Only worth saying when the headline number is done but the level isn't.
  if (!head?.met || !open.length) return "";
  return `<div class="card cd-gate is-wait"><h3>${esc(t("camp.gate.openTitle", { count: open.length }))}</h3><p>${esc(open.map((r) => r.milestone.label).join(" · "))}</p></div>`;
}

// The posts behind a per-post milestone (ER count / above average / average
// ER): every published piece with numbers, its ER, and whether it counts.
function openPostList(reading, { brandId, ctx, ctxLabel, campaign, stage }) {
  if (!reading) return;
  const m = reading.milestone;
  const pool = poolFor(ctx, m).filter((c) => c.status === "published");
  const rows = pool
    .map((c) => ({ c, er: computeContentMetrics(c, ctx.settings).engagementRate, views: Number(c.performance?.views) || 0 }))
    .sort((a, b) => (b.er ?? -1) - (a.er ?? -1));
  const avgViews = rows.length ? rows.reduce((sum, x) => sum + x.views, 0) / rows.length : 0;
  const hit = (x) => (m.metric === "content.aboveAverage" ? x.views > avgViews : x.er !== null && x.er >= (m.threshold ?? m.target ?? 0));
  const overlay = openModal({
    title: m.label,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 12px;">${esc(t("camp.posts.intro"))}</p>
      ${
        rows.length
          ? `<div class="cd-post-list">${rows.map((x) => `<button type="button" class="cd-post ${hit(x) ? "is-hit" : ""}" data-post="${x.c.id}">${hit(x) ? icon("check", { size: 14 }) : ""}<b>${esc(x.c.title || t("next.untitled"))}</b><span>${x.er === null ? esc(t("camp.posts.noData")) : `ER ${Math.round(x.er * 10) / 10}%`}</span></button>`).join("")}</div>`
          : `<p class="text-faint" style="font-size:13px;">${esc(t("camp.posts.empty"))}</p>`
      }`,
  });
  qsa("[data-post]", overlay).forEach((b) =>
    b.addEventListener("click", () => {
      closeOverlay(overlay);
      go(`#/brand/${brandId}/content-os/list`, { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null, contentId: b.dataset.post, intent: "performance" });
    })
  );
}

function milestoneRowHTML(r, i, stage, guided) {
  const m = r.milestone;
  const locked = stage.kind === "level" && stage.state === "locked";
  const value = r.isCheck ? (r.met ? t("camp.detail.done") : t("camp.detail.notYet")) : `${formatNumber(r.current)}${r.target ? ` / ${formatNumber(r.target)}` : ""}${r.unit && r.unit !== "Rp" ? ` ${esc(r.unit)}` : ""}`;
  const source = r.auto
    ? `${esc(r.sourceLabel)} · ${r.updatedAt ? `<span class="${r.stale ? "cd-stale" : ""}">${esc(ageLabel(r.updatedAt))}</span>` : r.home === "insights" ? `<span class="cd-stale">${t("camp.m.notLogged")}</span>` : r.staleCount ? `<span class="cd-stale">${t("camp.detail.missingData", { count: r.staleCount })}</span>` : t("camp.m.auto")}`
    : `${t("camp.m.home.manual")}${r.updatedAt ? ` · ${esc(ageLabel(r.updatedAt))}` : ""}`;
  const posts = !locked && PER_POST_METRICS.includes(m.metric) ? `<button type="button" class="btn btn-ghost btn-sm cd-ms-btn" data-cd-ms-posts="${i}">${t("camp.posts.button")}</button>` : "";
  // The community's identity (name + member nickname) is real text, not a
  // checkbox — its action button reads as "name it" rather than "mark done".
  const isIdentity = m.key === "concept" && m.track === "community";
  const actionLabel = isIdentity ? t(r.met ? "camp.identity.editBtn" : "camp.identity.fillBtn") : r.action?.label;
  const showAction = !locked && ((r.action && r.action.type !== "info") || isIdentity);
  const action = posts || (showAction ? `<button type="button" class="btn btn-ghost btn-sm cd-ms-btn" data-cd-ms-action="${i}">${esc(actionLabel)}</button>` : "");
  return `
    <div class="cd-row cd-row-${r.status}" data-milestone-index="${i}">
      <span class="cd-dot" style="--pct:${Math.round(r.pct * 100)}%"><span></span></span>
      <div class="cd-row-main">
        <div class="cd-row-label">${esc(m.label)}${m.required === false ? ` <span class="text-faint" style="font-weight:500;">${t("camp.optional")}</span>` : ""}</div>
        ${m.description && !guided ? `<div class="cd-row-desc">${esc(m.description)}</div>` : m.description && guided && !r.auto ? `<div class="cd-row-desc">${esc(m.description)}</div>` : ""}
        <div class="cd-row-source">${source}${r.note ? ` · ${esc(r.note)}` : ""}</div>
      </div>
      <div class="cd-row-value mono">${value}</div>
      <div class="cd-row-action">${action}${guided ? "" : `<button type="button" class="icon-btn cd-ms-menu" data-cd-ms-menu="${i}" aria-label="${t("camp.detail.msOptions")}" style="width:26px;height:26px;">${icon("dots", { size: 13 })}</button>`}</div>
    </div>`;
}

// ---------- Mission tree ----------
// The "pohon" view of a level: one trunk, one branch per milestone, each
// branch filling from trunk to node in proportion to that milestone's
// progress (reading.pct), a green halo once it's met. Nodes carry only a
// rung number that matches the numbered row below (the list is the legend);
// hovering/tapping a node shows label + progress, clicking it highlights
// its row. Ported from the pre-rewrite campaigns.js mission tree so the
// level campaigns (Grow Social Media / Personal Branding, the ones
// recommended to beginners) keep their map, not just a list.
function missionNodePos(i, n) {
  const x = n === 1 ? 500 : 150 + (700 * i) / (n - 1);
  const t = n === 1 ? 0.5 : i / (n - 1);
  const y = 300 - Math.sin(Math.PI * t) * 150;
  return { x, y };
}

function missionProgressText(r) {
  const m = r.milestone;
  if (r.isCheck) return r.met ? t("camp.detail.done") : t("camp.detail.notHappened");
  if (r.target) return `${formatNumber(r.current)}/${formatNumber(r.target)}${r.unit && r.unit !== "Rp" ? " " + r.unit : ""}`;
  return r.logged ? `${formatNumber(r.current)}${r.unit ? " " + r.unit : ""}` : m.notApplicable ? t("camp.detail.notRelevant") : t("camp.detail.notLoggedCap");
}

function missionTreeHTML(stage, readings) {
  const all = readings.filter((r) => !r.milestone.notApplicable);
  if (!all.length) return "";
  const n = all.length;
  const trunk = { x: 500, y: 380 };
  const nodes = all.map((r, k) => ({ ...missionNodePos(k, n), r, i: readings.indexOf(r), pct: r.met ? 1 : r.pct }));

  const branchTracks = nodes
    .map((nd) => {
      const midY = (trunk.y + nd.y) / 2;
      return `<path d="M${trunk.x},${trunk.y} C ${trunk.x},${midY} ${nd.x},${midY} ${nd.x},${nd.y}" fill="none" stroke="var(--border)" stroke-width="6" stroke-linecap="round" opacity=".35"/>`;
    })
    .join("");
  const branchFills = nodes
    .map((nd) => {
      if (nd.pct <= 0) return "";
      const midY = (trunk.y + nd.y) / 2;
      const c = nd.pct >= 1 ? "var(--health-good)" : "var(--health-average)";
      const loading = nd.pct < 1 ? "mission-loading" : "";
      return `<path d="M${trunk.x},${trunk.y} C ${trunk.x},${midY} ${nd.x},${midY} ${nd.x},${nd.y}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 * (1 - nd.pct)).toFixed(1)}" class="${loading}"/>`;
    })
    .join("");
  const halos = nodes.map((nd) => (nd.pct >= 1 ? `<circle cx="${nd.x}" cy="${nd.y}" r="30" fill="var(--health-good)" class="mission-halo" opacity=".7"/>` : "")).join("");
  const RING_R = 17;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const cores = nodes
    .map((nd) => {
      if (nd.pct >= 1) {
        return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--health-good)"/>
      <g transform="translate(${nd.x - 9},${nd.y - 9}) scale(0.75)" fill="none" stroke="var(--bg)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></g>`;
      }
      if (nd.pct > 0) {
        const offset = RING_CIRC * (1 - nd.pct);
        return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--surface-2)" stroke="var(--border)" stroke-width="3"/>
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="none" stroke="var(--health-average)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${RING_CIRC.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 ${nd.x} ${nd.y})" class="mission-loading"/>
      <text x="${nd.x}" y="${nd.y}" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="800" fill="var(--text)">${nd.i + 1}</text>`;
      }
      return `
      <circle cx="${nd.x}" cy="${nd.y}" r="${RING_R}" fill="var(--border)"/>
      <text x="${nd.x}" y="${nd.y}" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="800" fill="var(--text-faint)">${nd.i + 1}</text>`;
    })
    .join("");
  const nodeButtons = nodes
    .map(
      (nd) => `
      <div class="mission-node" data-milestone-index="${nd.i}" tabindex="0" role="note" data-tooltip="${esc(`${nd.i + 1}. ${nd.r.milestone.label} — ${missionProgressText(nd.r)}${nd.r.milestone.description ? `\n${nd.r.milestone.description}` : ""}`)}" style="left:${(nd.x / 10).toFixed(1)}%;top:${((nd.y / 460) * 100).toFixed(1)}%;"></div>`
    )
    .join("");
  const met = nodes.filter((nd) => nd.pct >= 1).length;
  return `
    <div class="cd-tree-scroll"><div class="mission-tree cd-tree" aria-label="${esc(t("camp.detail.treeAria", { name: stage.name || "" }))}">
      <svg viewBox="0 0 1000 460" role="img" aria-label="${esc(t("camp.detail.treeSvgAria", { met, total: n }))}">
        <path d="M500,440 C 470,452 440,455 410,450" stroke="var(--border)" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M500,440 C 530,452 560,455 590,450" stroke="var(--border)" stroke-width="4" stroke-linecap="round" fill="none"/>
        <path d="M500,440 L500,380" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" opacity=".5"/>
        ${branchTracks}
        ${branchFills}
        ${halos}
        ${cores}
      </svg>
      ${nodeButtons}
    </div></div>
    <p class="cd-tree-legend">${t("camp.detail.treeLegend")}</p>
  `;
}

function ladderRulesHTML(campaign, stage, guided) {
  if (stage?.kind !== "level") return "";
  const rules = [campaign.autoLinkAllContent ? t("camp.detail.ruleAutoLink") : "", missionProgressionNote(campaign)].filter(Boolean);
  if (!rules.length) return "";
  return `<details class="cd-rules guided-rules"><summary>${t("camp.detail.rules")}</summary>${rules.map((r) => `<p>${esc(r)}</p>`).join("")}</details>`;
}

function activitiesHTML(acts, brandId, guided) {
  const { linked, counts } = acts;
  const recent = [...linked].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  return `
    <div class="section-title" style="margin-top:24px;"><h2>${t("camp.detail.activity")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.detail.activitySub")}</span></div>
    <div class="card cd-activities">
      ${guided ? "" : `<div class="cd-pipeline">
        ${PIPELINE.map((p) => `<button type="button" class="cd-pipe ${counts[p.key] ? "" : "is-zero"}" data-cd-pipeline="${p.key}"><b>${counts[p.key]}</b>${p.label}</button>`).join("")}
      </div>`}
      <div class="cd-activity-actions">
        <button type="button" class="btn btn-secondary btn-sm glow" data-cd-brainstorm style="--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);">${icon("bulb", { size: 13 })}${t("camp.detail.brainstorm")}</button>
        <button type="button" class="btn btn-primary btn-sm" id="cd-new-content">${icon("plus", { size: 13 })}${t("camp.detail.newContent")}</button>
      </div>
      ${
        recent.length
          ? `<div class="cd-activity-list">${recent
              .map(
                (c) => `<div class="cd-activity-row" data-cd-open-content="${c.id}">
                  <span class="cd-activity-title">${esc(c.title || t("common.untitled"))}</span>
                  <span class="text-faint" style="font-size:11.5px;">${c.scheduleDate || c.publishedDate || ""}</span>
                  <span class="status-pill status-${c.status}" style="padding:2px 8px;"><span class="status-dot"></span>${esc((guided ? STATUS_LABELS_GUIDED : STATUS_LABELS)[c.status] || c.status)}</span>
                </div>`
              )
              .join("")}${linked.length > 5 ? `<a class="link" href="#/brand/${brandId}/content-os/list" style="font-size:12.5px;">${t("camp.detail.seeAll", { count: linked.length })}</a>` : ""}</div>`
          : `<p class="text-faint" style="font-size:12.5px;margin:12px 0 0;">${t("camp.detail.noLinked")}</p>`
      }
    </div>`;
}

// ---------- Grow Brand: level status, evaluation, disclaimer ----------
// No dates anywhere — the level only knows roughly how long it should take.
// Inside that estimate this is one quiet line; past it, the card says the
// level has to be finished before the next one opens and lists, from the
// level's own numbers, why it isn't done yet (goal-plan.js evaluateLevel).
// The disclaimer the user agreed to in the wizard stays readable here.
function growBrandStatusHTML(campaign, stage, stageRead) {
  const plan = campaign.goalPlan;
  const v = plan.vision || {};
  const visionLine = [v.scale ? t(`goal.vision.${v.scale}`) : "", v.text || ""].filter(Boolean).join(" — ");
  const disclaimer = `
    <details class="cd-rules goal-disclaimer">
      <summary>${icon("info", { size: 12 })}${t("goal.disclaimer.title")}</summary>
      ${[1, 2, 3, 4].map((n) => `<p>${esc(t(`goal.disclaimer.${n}`))}</p>`).join("")}
    </details>`;
  // Finished and locked levels have nothing to evaluate or be reminded of.
  if (stage.state !== "current") return "";
  const ev = evaluateLevel({ readings: stageRead.readings, startedAt: stageStartedAt(campaign, stage), estWeeks: stage.raw.estWeeks || 12, uploadsPerWeek: plan.uploadsPerWeek });
  return `
    <div class="card goal-pace ${ev.overdue ? "is-bad" : "is-ok"}">
      ${
        ev.overdue
          ? `<div class="goal-pace-status"><span class="goal-pace-dot"></span>${esc(t("goal.status.overdueTitle"))}</div>
             <p class="goal-pace-line">${esc(t("goal.status.overdueBody", { name: stage.name, est: ev.estWeeks, weeks: ev.weeks }))}</p>
             <div class="goal-eval">
               <div class="goal-pace-vision-label">${t("goal.status.evalLabel")}</div>
               ${ev.reasons.map((r) => `<div class="goal-eval-item"><b>${esc(t(`goal.eval.${r.key}.title`, r.vars))}</b><span>${esc(t(`goal.eval.${r.key}.fix`, r.vars))}</span></div>`).join("")}
             </div>`
          : `<p class="goal-pace-line">${esc(t("goal.status.onTime", { est: ev.estWeeks, weeks: ev.weeks }))}</p>`
      }
      ${remindersHTML(stage, stageRead, plan.goal)}
      ${visionLine ? `<p class="goal-pace-line"><b>${t("goal.status.vision")}</b> ${esc(visionLine)}</p>` : ""}
      ${disclaimer}
    </div>`;
}
// The other two tracks' open work in this level, with the level-specific
// "why now" line for each (goal.remind.<track>.<focus>).
function remindersHTML(stage, stageRead, goal) {
  const groups = levelReminders(stageRead.readings, stage.raw.focus, goal);
  if (!groups.length) return "";
  return `
    <div class="goal-eval goal-remind">
      ${groups
        .map(
          (g) => `
        <details class="goal-eval-item" ${g.items.some((r) => r.milestone.required !== false) ? "open" : ""}>
          <summary>${icon("bell", { size: 12 })}${esc(t(`goal.remind.${g.track}.title`))}<small>${t("goal.remind.count", { count: g.items.length })}</small></summary>
          <span>${esc(t(`goal.remind.${g.track}.${stage.raw.focus}`))}</span>
          <ul>${g.items.slice(0, 3).map((r) => `<li>${esc(r.milestone.label)}${r.target && !r.isCheck ? ` — ${formatNumber(r.current)}/${formatNumber(r.target)}` : ""}${r.milestone.required === false ? "" : ` <em>${t("goal.remind.required")}</em>`}</li>`).join("")}</ul>
        </details>`
        )
        .join("")}
    </div>`;
}

const EVENT_CATEGORY_LABELS = Object.fromEntries(["AWARENESS", "CONTENT", "CONVERSION", "ENGAGEMENT", "ATTENDANCE", "IMPACT"].map((k) => [k, t(`camp.detail.cat.${k}`)]));
function eventScoreHTML(campaign, stages, ctx) {
  const totals = {};
  stages.forEach((stage) =>
    stage.milestones.forEach((m) => {
      if (m.notApplicable || !m.target || !m.category || !EVENT_CATEGORY_LABELS[m.category]) return;
      const r = readMilestone(m, ctx, stage);
      const total = (totals[m.category] ||= { target: 0, actual: 0 });
      total.target += m.target;
      total.actual += Math.min(r.current, m.target * 3);
    })
  );
  const tiles = Object.entries(totals).map(([cat, v]) => `<div class="stat"><div class="label">${EVENT_CATEGORY_LABELS[cat]}</div><div class="value">${v.target ? Math.round((v.actual / v.target) * 100) : 0}%</div><div class="text-faint" style="font-size:11px;">${formatNumber(v.actual)} / ${formatNumber(v.target)}</div></div>`);
  return tiles.length ? `<div class="section-title" style="margin-top:24px;"><h2>${t("camp.detail.eventScore")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.detail.eventScoreSub")}</span></div><div class="stat-grid">${tiles.join("")}</div>` : "";
}

// ---------- Actions ----------

function runAction(cta, { brandId, brand, campaign, stage, stages, ctx, refresh, ctxLabel }) {
  const base = { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null };
  switch (cta.type) {
    case "creator":
      go(`#/brand/${brandId}/content-os/creator/${cta.contentId}`, { ...base, contentId: cta.contentId, intent: cta.intent || "continue" });
      return;
    case "new-content":
      go(`#/brand/${brandId}/content-os/creator`, { ...base, intent: "new-content", defaults: { campaignId: campaign.id, campaignPhaseId: stage?.kind !== "level" ? stage?.id || "" : "", ...(cta.defaults || {}) } });
      return;
    case "calendar":
      go(`#/brand/${brandId}/content-os/calendar`, { ...base, contentId: cta.contentId || null, intent: "schedule" });
      return;
    case "performance":
      go(`#/brand/${brandId}/content-os/list`, { ...base, contentId: cta.contentId, intent: "performance" });
      return;
    case "insights":
      openInsightsModal({ brandId, onSaved: refresh, reason: t("camp.detail.insightsReason"), platform: campaignPlatform(ctx) });
      return;
    case "manual": {
      const m = cta.milestoneId ? stage?.milestones.find((x) => x.id === cta.milestoneId) : null;
      if (m?.key === "concept" && m?.track === "community") {
        openCommunityIdentityModal({ campaign, milestone: m, refresh });
        return;
      }
      openManualSheet({ campaign, stage, ctx, refresh, focusId: cta.milestoneId });
      return;
    }
    case "brainstorm":
      openBrainstormModal({ brandId, brand, campaign, stage: stages[cta.stageIndex ?? stage?.index] || stage, refresh, ctxLabel });
      return;
    default:
  }
}

// The only place numbers get typed: every manual.* milestone of this stage
// on one sheet, with an honest "app can't see this" line.
function openManualSheet({ campaign, stage, ctx, refresh, focusId = null }) {
  // The community identity milestone (name + member nickname) has its own
  // dedicated modal (openCommunityIdentityModal) — it never appears as a
  // plain checkbox in this bulk sheet.
  const readings = readStage(stage, ctx).readings.filter((r) => !r.auto && !r.milestone.notApplicable && !(r.milestone.key === "concept" && r.milestone.track === "community"));
  if (!readings.length) return;
  const overlay = openModal({
    title: t("camp.detail.sheetTitle"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${t("camp.detail.sheetIntro")}</p>
      ${howToHTML("insights")}
      ${howToHTML("post")}
      ${readings
        .map((r) => {
          const m = r.milestone;
          if (r.isCheck) {
            return `<label class="checkbox-chip cd-sheet-check"><input type="checkbox" data-sheet-check="${m.id}" ${r.met ? "checked" : ""} /><span><b>${esc(m.label)}</b>${m.description ? `<span class="cd-row-desc">${esc(m.description)}</span>` : ""}</span></label>`;
          }
          return `
            <div class="field cd-sheet-field">
              <label for="sheet-${m.id}">${esc(m.label)}${m.target ? ` <span class="copy-optional">${t("camp.detail.sheetTarget", { n: formatNumber(m.target) })}${m.unit ? " " + esc(m.unit) : ""}</span>` : ""}</label>
              ${m.description ? `<div class="cd-row-desc" style="margin:-2px 0 6px;">${esc(m.description)}</div>` : ""}
              <div class="flex items-center gap-8">
                <input class="input" id="sheet-${m.id}" data-sheet-number="${m.valueKey || m.id}" type="number" min="0" inputmode="numeric" value="${r.logged ? r.current : ""}" placeholder="${esc(t("camp.detail.sheetPh"))}" style="max-width:180px;" />
                <span class="text-faint" style="font-size:11.5px;">${r.updatedAt ? esc(t("camp.detail.sheetLast", { age: ageLabel(r.updatedAt) })) : t("camp.detail.neverLogged")}${r.note ? ` · ${esc(r.note)}` : ""}</span>
              </div>
            </div>`;
        })
        .join("")}
    `,
    footHTML: `<button type="button" class="btn btn-primary" id="sheet-save">${icon("check", { size: 14 })}${t("common.save")}</button>`,
  });
  qs("#sheet-save", overlay).addEventListener("click", () => {
    let changed = 0;
    qsa("[data-sheet-number]", overlay).forEach((input) => {
      const id = input.dataset.sheetNumber;
      const raw = input.value.trim();
      const prev = ctx.campaign.manualMetrics?.[id]?.value;
      if (raw === "" && (prev === undefined || prev === null)) return;
      const value = raw === "" ? null : Math.max(0, Number(raw) || 0);
      if (value === prev) return;
      setCampaignManualMetric(campaign.id, id, { value });
      changed++;
    });
    qsa("[data-sheet-check]", overlay).forEach((cb) => {
      const id = cb.dataset.sheetCheck;
      const prev = !!ctx.campaign.manualMetrics?.[id]?.done;
      if (cb.checked === prev && ctx.campaign.manualMetrics?.[id]) return;
      setCampaignManualMetric(campaign.id, id, { done: cb.checked });
      changed++;
    });
    closeOverlay(overlay);
    if (changed) toast(t("camp.detail.sheetSaved"));
    refresh();
  });
  const focus = focusId ? qs(`#sheet-${focusId}`, overlay) || qs(`[data-sheet-check="${focusId}"]`, overlay) : qs("input", overlay);
  focus?.focus();
}

// The community's "define concept & name" milestone used to be a plain
// checkbox — tick it and it counted as done, with nothing actually decided.
// This asks for the two things every real community needs: an actual name,
// and what members get called (like "Swifties" or "Wepekans") — stored on
// the campaign itself (campaign.community) so it flows into AI context and
// the campaign report, not just a checkmark.
function openCommunityIdentityModal({ campaign, milestone, refresh }) {
  const existing = campaign.community || {};
  const overlay = openModal({
    title: t("camp.identity.title"),
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${esc(t("camp.identity.intro"))}</p>
      <div class="field"><label>${t("camp.identity.nameLabel")}</label><input class="input" id="ci-name" placeholder="${esc(t("camp.identity.namePh"))}" value="${esc(existing.name || "")}" /></div>
      <div class="field" style="margin-bottom:0;"><label>${t("camp.identity.nicknameLabel")}</label><input class="input" id="ci-nickname" placeholder="${esc(t("camp.identity.nicknamePh"))}" value="${esc(existing.memberNickname || "")}" /></div>
    `,
    footHTML: `<button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button><button class="btn btn-primary" data-save>${t("common.save")}</button>`,
    onMount: (el) => setTimeout(() => el.querySelector("#ci-name")?.focus(), 30),
  });
  qs("[data-cancel]", overlay).addEventListener("click", () => closeOverlay(overlay));
  qs("[data-save]", overlay).addEventListener("click", () => {
    const name = qs("#ci-name", overlay).value.trim();
    const memberNickname = qs("#ci-nickname", overlay).value.trim();
    if (!name || !memberNickname) {
      toast(t("camp.identity.required"), "error");
      return;
    }
    updateCampaign(campaign.id, { community: { name, memberNickname, updatedAt: Date.now() } });
    setCampaignManualMetric(campaign.id, milestone.id, { done: true });
    closeOverlay(overlay);
    toast(t("camp.identity.saved"));
    refresh();
  });
}

// Pro-only per-milestone menu: change target, mark not relevant, remove custom.
function openMilestoneMenu(btn, reading, { campaign, stage, refresh }) {
  const m = reading?.milestone;
  if (!m) return;
  const rect = btn.getBoundingClientRect();
  const menu = openMenu(btn, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 220) });
  if (!menu) return;
  menu.innerHTML = `
    ${m.target !== null && !reading.isCheck ? `<button data-act="target">${icon("edit", { size: 14 })}${t("camp.detail.changeTarget")}</button>` : ""}
    <button data-act="na">${icon(m.notApplicable ? "refresh" : "eyeOff", { size: 14 })}${m.notApplicable ? t("camp.detail.markRelevant") : t("camp.detail.markNotRelevant")}</button>
    ${m.custom ? `<div class="menu-divider"></div><button data-act="remove" class="danger">${icon("trash", { size: 14 })}${t("camp.detail.deleteMilestone")}</button>` : ""}
  `;
  menu.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === "target") {
      const raw = await promptDialog({ title: t("camp.detail.changeTarget"), label: m.label, placeholder: String(m.target ?? ""), confirmLabel: t("common.save") });
      if (!raw) return;
      patchMilestone(campaign, stage, m.id, { target: Math.max(1, Math.round(Number(raw) || 0)) });
    } else if (act === "na") {
      patchMilestone(campaign, stage, m.id, { notApplicable: !m.notApplicable });
    } else if (act === "remove") {
      const ok = await confirmDialog({ title: t("camp.detail.deleteMilestoneTitle"), message: t("camp.detail.deleteMilestoneMsg", { name: m.label }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      patchMilestone(campaign, stage, m.id, null);
    }
    refresh();
  });
}

// Writes a milestone change back to whichever legacy container the stage
// came from (missions / eventPlan.phases / phases). `patch === null` removes.
function patchMilestone(campaign, stage, milestoneId, patch) {
  const apply = (list) => (patch === null ? list.filter((x) => x.id !== milestoneId) : list.map((x) => (x.id === milestoneId ? { ...x, ...patch } : x)));
  if (stage.kind === "level") {
    updateCampaign(campaign.id, { missions: campaign.missions.map((m, i) => (i === stage.index ? { ...m, milestones: apply(m.milestones) } : m)) });
  } else if (stage.kind === "window") {
    const key = windowPlanKey(campaign);
    updateCampaign(campaign.id, { [key]: { ...campaign[key], phases: campaign[key].phases.map((p) => (p.id === stage.id ? { ...p, milestones: apply(p.milestones) } : p)) } });
  } else {
    updateCampaign(campaign.id, { phases: campaign.phases.map((p) => (p.id === stage.id ? { ...p, milestones: apply(p.milestones || []) } : p)) });
  }
}

function addCustomMilestone(campaign, stage, { label, kind, target, description = "", required = true }) {
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ms = kind === "number"
    ? { id, kind: "number", label, description, unit: "", target: Math.max(1, Number(target) || 1), highlight: false, custom: true, value: null, done: false, required: true, notApplicable: false, category: "IMPACT" }
    : { id, kind: "check", label, description, unit: "", target: null, highlight: false, custom: true, value: null, done: false, required, notApplicable: false, category: "IMPACT" };
  if (stage.kind === "level") {
    updateCampaign(campaign.id, { missions: campaign.missions.map((m, i) => (i === stage.index ? { ...m, milestones: [...m.milestones, ms] } : m)) });
  } else if (stage.kind === "window") {
    const key = windowPlanKey(campaign);
    updateCampaign(campaign.id, { [key]: { ...campaign[key], phases: campaign[key].phases.map((p) => (p.id === stage.id ? { ...p, milestones: [...p.milestones, ms] } : p)) } });
  } else {
    updateCampaign(campaign.id, { phases: campaign.phases.map((p) => (p.id === stage.id ? { ...p, milestones: [...(p.milestones || []), { id, text: label, done: false }] } : p)) });
  }
}

// #14: promptDialog only takes one field — a custom "number" milestone
// needs a label AND a target the user picks, not a hardcoded 1 (which used
// to make it work like a checkbox in disguise). Small standalone dialog on
// the same openModal()/closeOverlay() primitive everything else here uses.
function promptAddMilestoneNumber() {
  return new Promise((resolve) => {
    const overlay = openModal({
      title: t("camp.detail.newNumber"),
      bodyHTML: `
        <div class="field"><label>${t("camp.detail.msName")}</label><input class="input" id="cam-label" placeholder="${t("camp.detail.newNumberPh")}" /></div>
        <div class="field" style="margin-bottom:0;"><label>${t("camp.detail.msTarget")}</label><input class="input" id="cam-target" type="number" min="1" inputmode="numeric" placeholder="1" /></div>
      `,
      footHTML: `<button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button><button class="btn btn-primary" data-confirm>${t("camp.detail.add")}</button>`,
      onMount: (el) => setTimeout(() => el.querySelector("#cam-label")?.focus(), 30),
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => { closeOverlay(overlay); resolve(null); });
    overlay.querySelector("[data-confirm]").addEventListener("click", () => {
      const label = overlay.querySelector("#cam-label").value.trim();
      const target = Number(overlay.querySelector("#cam-target").value) || 1;
      closeOverlay(overlay);
      resolve(label ? { label, target } : null);
    });
  });
}
async function addMilestoneFlow(kind, { campaign, stage, refresh }) {
  if (kind === "number") {
    const res = await promptAddMilestoneNumber();
    if (!res) return;
    addCustomMilestone(campaign, stage, { label: res.label, kind: "number", target: res.target });
  } else {
    const label = await promptDialog({ title: t("camp.detail.newCheck"), label: t("camp.detail.msName"), placeholder: t("camp.detail.newCheckPh"), confirmLabel: t("camp.detail.add") });
    if (!label?.trim()) return;
    addCustomMilestone(campaign, stage, { label: label.trim(), kind: "check" });
  }
  refresh();
}

function openMoreMenu(btn, { brandId, campaign, stage, ctx, refresh, state, guided }) {
  const rect = btn.getBoundingClientRect();
  const menu = openMenu(btn, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 260) });
  if (!menu) return;
  // Grow Brand levels can't be skipped — finishing the level is the point.
  const canForce = stage?.kind === "level" && stage.state === "current" && !campaign.goalPlan;
  // Delete lives here (not the campaign LIST's own "..." menu, which is
  // Pro-only by design) so it's reachable from every mode — the list menu
  // deliberately stays hidden in guided mode for a cleaner card, but this
  // page is the one place a campaign should always be deletable from.
  menu.innerHTML = `
    ${guided ? "" : `<button data-act="add-check">${icon("plus", { size: 14 })}${t("camp.detail.addCheck")}</button>
    <button data-act="add-number">${icon("plus", { size: 14 })}${t("camp.detail.addNumber")}</button>`}
    ${canForce ? `<button data-act="force">${icon("check", { size: 14 })}${t("camp.detail.forceNext")}</button>` : ""}
    <div class="menu-divider"></div>
    <button data-act="delete" class="danger">${icon("trash", { size: 14 })}${t("common.delete")}</button>
  `;
  menu.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === "add-check" || act === "add-number") {
      await addMilestoneFlow(act === "add-check" ? "check" : "number", { campaign, stage, refresh });
      return;
    } else if (act === "force") {
      const adv = ladderAdvanceState(campaign, stage, ctx);
      const ok = await confirmDialog({
        title: t("camp.detail.forceTitle"),
        message: adv.targetsMet ? t("camp.detail.forceWeeks", { min: adv.minWeeks, left: adv.weeksLeft }) : t("camp.detail.forceOpen"),
        confirmLabel: t("camp.next"),
      });
      if (!ok) return;
      completeCampaignStage(campaign.id, stage.index);
      state.stageIndex = stage.index + 1;
      toast(t("camp.detail.forced", { n: stage.index + 1 }));
    } else if (act === "delete") {
      const linkedCount = ctx.content.filter((c) => c.campaignId === campaign.id).length;
      const ok = await confirmDialog({
        title: t("camp.list.deleteTitle"),
        message: linkedCount ? `${t("camp.list.deleteLinked", { count: linkedCount })} ${t("common.noUndo")}` : t("common.noUndo"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      deleteCampaign(campaign.id);
      toast(t("camp.list.deleted"));
      location.hash = `#/brand/${brandId}/campaigns`;
      return;
    }
    refresh();
  });
}

// ---------- Brainstorm (ideas → linked content, straight to Creator) ----------

function openBrainstormModal({ brandId, brand, campaign, stage, refresh, ctxLabel }) {
  const saved = [];
  const isPhaseLike = stage && stage.kind !== "level";
  const overlay = openModal({
    title: t("camp.bs.title"),
    wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${esc(t("camp.bs.intro", { campaign: campaign.name || t("camp.untitled"), stage: stage ? `${t(stage.kind === "level" ? "camp.bs.stageLevel" : "camp.bs.stagePhase", { name: stage.name })}${stage.dateLabel ? ` (${stage.dateLabel})` : ""}` : "" }))}</p>
      <button type="button" class="btn btn-secondary btn-sm" id="brainstorm-ai">${icon("bot", { size: 13 })}${t("camp.bs.askAi")}</button>
      <div id="brainstorm-ai-status" style="margin-top:10px;"></div>
      <div id="brainstorm-ai-ideas" style="margin-top:4px;"></div>
      <div class="divider" style="margin:18px 0;"></div>
      <div class="page-eyebrow" style="margin-bottom:10px;">${t("camp.bs.ownIdea")}</div>
      <div class="field"><input class="input" id="bs-title" placeholder="${esc(t("camp.bs.titlePh"))}" /></div>
      <div class="field" style="margin-bottom:10px;"><textarea class="textarea" id="bs-idea" style="min-height:56px;" placeholder="${esc(t("camp.bs.notePh"))}"></textarea></div>
      <button type="button" class="btn btn-primary btn-sm" id="bs-add-manual">${icon("plus", { size: 13 })}${t("camp.bs.saveIdea")}</button>
    `,
    footHTML: `<button class="btn btn-secondary" id="brainstorm-done">${t("camp.bs.done")}</button>`,
  });
  const linkFields = { campaignId: campaign.id, campaignPhaseId: isPhaseLike ? stage.id : "", status: "idea" };
  const save = ({ title, idea }) => {
    const item = createContent(brandId, { ...linkFields, title, idea });
    saved.push(item.id);
    return item;
  };

  qs("#brainstorm-ai", overlay).addEventListener("click", async () => {
    const ai = getSettings().ai || {};
    const statusEl = qs("#brainstorm-ai-status", overlay);
    const demo = isTourDemo();
    if (!hasAiKey(ai) && !demo) {
      statusEl.innerHTML = `<div class="text-faint" style="font-size:11.5px;">${t("camp.bs.noKey")}</div>`;
      return;
    }
    const aiBtn = qs("#brainstorm-ai", overlay);
    aiBtn.disabled = true;
    statusEl.innerHTML = `<div class="ocr-status"><div class="spinner"></div><span>${t("camp.bs.thinking")}</span></div>`;
    try {
      const existingTitles = listContent(brandId).filter((c) => c.campaignId === campaign.id).map((c) => c.title).filter(Boolean);
      if (demo) toast(DEMO_TOAST);
      let ideas;
      if (demo) ({ ideas } = await demoBrainstormIdeas({ brand, campaign, mission: stage?.raw || null }));
      else if (stage?.kind === "phase") ideas = await suggestPhaseContent(ai, { brand, campaign, phase: stage.raw, existingTitles });
      else ({ ideas } = await brainstormCampaignIdeas(ai, { brand, campaign, mission: stage?.kind === "level" ? stage.raw : stage ? { name: stage.name, description: stage.dateLabel ? `Fase ${stage.name} (${stage.dateLabel})` : stage.description, tagline: "" } : null, existingTitles }));
      statusEl.innerHTML = "";
      qs("#brainstorm-ai-ideas", overlay).innerHTML = (ideas || [])
        .map(
          (idea, i) => `
        <div class="card card-tight" style="margin-bottom:8px;padding:12px;">
          <div style="font-weight:700;font-size:13.5px;margin-bottom:3px;">${esc(idea.title)}</div>
          <div class="text-muted" style="font-size:12.5px;margin-bottom:8px;">${esc(idea.angle)}${idea.format ? ` · ${esc(idea.format)}` : ""}</div>
          <button type="button" class="btn btn-secondary btn-sm" data-use-brainstorm-idea="${i}">${icon("plus", { size: 12 })}${t("camp.bs.saveIdea")}</button>
        </div>`
        )
        .join("");
      qsa("[data-use-brainstorm-idea]", overlay).forEach((btn) => {
        btn.addEventListener("click", () => {
          const idea = ideas[Number(btn.dataset.useBrainstormIdea)];
          save({ title: idea.title, idea: idea.angle });
          btn.textContent = t("camp.bs.saved");
          btn.disabled = true;
        });
      });
    } catch (e) {
      statusEl.innerHTML = `<div class="ocr-status">${icon("info", { size: 14 })}<span>${e instanceof AiApiError ? esc(e.message) : t("camp.aiFailed")}</span></div>`;
    } finally {
      aiBtn.disabled = false;
    }
  });

  qs("#bs-add-manual", overlay).addEventListener("click", () => {
    const titleEl = qs("#bs-title", overlay);
    const ideaEl = qs("#bs-idea", overlay);
    const title = titleEl.value.trim();
    if (!title) {
      toast(t("camp.bs.titleRequired"), "error");
      return;
    }
    save({ title, idea: ideaEl.value.trim() });
    toast(t("camp.bs.savedToIdeas", { title }));
    titleEl.value = "";
    ideaEl.value = "";
    titleEl.focus();
  });

  qs("#brainstorm-done", overlay).addEventListener("click", () => {
    closeOverlay(overlay);
    refresh?.();
    // Straight to the first idea just saved — not an empty Creator.
    if (saved.length) go(`#/brand/${brandId}/content-os/creator/${saved[0]}`, { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null, contentId: saved[0], intent: "continue" });
  });
}

export { openBrainstormModal };
