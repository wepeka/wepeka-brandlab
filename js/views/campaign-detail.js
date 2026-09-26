// Campaign detail — one layout for every campaign shape (mission ladder,
// event windows, phase journey), in the order a beginner asks questions:
// where am I (headline) → what do I do now (next action) → which stage →
// what counts (milestones, each with its source and one button) → what
// content exists for it (activities). Numbers are never typed into the
// page: they're read through js/campaign-metrics.js, and the only manual
// entry is the "Catat angka" sheet for things the app can't observe.
import { backLinkHTML } from "../back-link.js";
import {
  getBrand, getGoal, updateGoal, listContent, listCampaigns, getSettings, updateCampaign, createContent, deleteCampaign, completeCampaignStage, setCampaignManualMetric,
  formatEventDate, daysBetween, localISODate, EVENT_ROLES, EVENT_SCALE_TIERS, campaignContentPool,
  CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_STATUS_LABELS, STATUS_LABELS, missionProgressionNote,
} from "../store.js";
import { campaignStages, activeStageIndex, readStage, readMilestone, campaignHeadline, ladderAdvanceState, campaignActivities, PIPELINE, ageLabel, stageStartedAt, poolFor, PER_POST_METRICS, windowPlanKey, TRACK_ICON, campaignPendingEngagement, campaignPlatform } from "../campaign-metrics.js";
import { getTracker, productStats, trackerTotals, eventSalesStats, campaignSalesStats, contentSalesStats } from "../sales-tracker.js";
import { computeContentMetrics } from "../formulas.js";
import { openCampaignReport } from "./campaign-share.js";
import { evaluateLevel, levelReminders } from "../goal-plan.js";
import { nextActions } from "../next-action.js";
import { go } from "../nav-context.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog, promptDialog } from "../modals.js";
import { toast, formatNumber, formatDate, qs, qsa, openMenu, closeMenu, escapeHtml as esc } from "../dom.js";
import { generateCampaignPlaybook, generateIdeaBubbles, generateCampaignContentPlan, AiApiError, hasAiKey } from "../ai.js";
import { staleBecause, mayAutoRefresh, refreshStamp } from "../ai-autorefresh.js";
import { postingLine, bestPostsLine } from "../brand-learning.js";
import { pulseTextFor } from "../brand-pulse.js";
import { openInsightsModal } from "./insights-modal.js";
import { openQuickFillModal } from "./content-list.js";
import { setPageGuide } from "../section-guide.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { startCampaignDetailGuide } from "../guides/campaign-guide.js";
import { getMode } from "../mode.js";
import { isTourDemo, DEMO_TOAST } from "../tour-demo.js";
import { STATUS_LABELS_GUIDED, funnelShort } from "../funnel-field.js";
import { t } from "../i18n.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";

const CAMPAIGN_STATUS_PILL_CLASS = { planning: "status-draft", active: "status-scheduled", completed: "status-published", archived: "status-archived" };

// The campaign's closable widgets (Rencana/Ide Campaign/Sales Tracker) share
// one collapse-state array (campaign.widgetsCollapsed). The three old
// per-widget booleans (planCollapsed/ideasCollapsed/salesWidgetCollapsed)
// are read as a fallback so a campaign collapsed before this existed stays
// collapsed — the first toggle on any of them migrates it onto the array.
const WIDGET_LEGACY_FIELD = { plan: "planCollapsed", ideas: "ideasCollapsed", sales: "salesWidgetCollapsed" };
// "eventSales" is new (no legacy boolean field to fall back to — it never
// existed before the shared array), so it isn't a WIDGET_LEGACY_FIELD key.
const CAMPAIGN_WIDGET_KEYS = [...Object.keys(WIDGET_LEGACY_FIELD), "eventSales"];
// Rencana starts collapsed on a campaign nobody has toggled yet — the
// mission panel below is the working surface, the plan is reference.
function effectiveCollapsed(campaign) {
  return campaign.widgetsCollapsed || ["plan"];
}
function isWidgetCollapsed(campaign, key) {
  // Inside the Pro tabs the tab itself is the "close" — a widget that is
  // the whole tab (Ide, Rencana) always renders open there. Sales widgets
  // share the Aktivitas tab with other cards, so they keep their toggle.
  if (key === "plan" || key === "ideas") return false;
  return effectiveCollapsed(campaign).includes(key) || !!campaign[WIDGET_LEGACY_FIELD[key]];
}

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
        toast(nextStage ? t("camp.detail.levelDone", { n: stage.index + 1, name: stage.name }) : t("celebrate.finalTitle", { name: campaign.name || "" }));
      });
    }
  }

  const headline = stage ? campaignHeadline(campaign, stages, state.stageIndex, ctx) : null;
  const stageRead = stage ? readStage(stage, ctx) : { readings: [], met: 0, total: 0 };
  const actions = nextActions(ctx);
  const acts = campaignActivities(campaign, content);
  const ctxLabel = t("camp.detail.ctxLabel", { name: campaign.name || "" }).trim();

  // Pro layout (user ask, 2026-09-26: "simpler, but add something cooler"):
  // headline → Pulse strip (pace, 8-week rhythm, content & ideas, next
  // step) → one toolbar (Brainstorm / content plan / new content) → tabs.
  // Only one tab's widgets are on screen at a time: Target (levels +
  // milestones + pace), Ide, Rencana (v3 ladders only), Aktivitas
  // (pipeline, recent content, sales, unfilled engagement). Pemula has no
  // tabs — its whole page is the Target tab plus the Brainstorm card.
  const tabs = proTabList(campaign, stages);
  const tab = guided ? "target" : tabs.includes(state.proTab) ? state.proTab : "target";

  // Pemula layout (user ask, 2026-09-25: "too many buttons"): headline
  // number → level strip → milestones → one Brainstorm card. Everything
  // else on this page (next-step card, idea bubbles, sales widgets, AI
  // plan, pace/rules, activity pipeline + content buttons) is Pro-only.
  // Milestone rows keep their own action (Isi Insights / Catat / Bikin
  // konten), so a beginner still has exactly one way to move each target.
  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brandId}/campaigns`, t("camp.detail.allCampaigns"))}${helpButtonHTML("campaign-detail")}${guideVideoButtonHTML("campaign-detail")}</div>
        <h1>${esc(campaign.name || t("camp.untitled"))}</h1>
        <p class="page-sub cd-sub">${subLineHTML(campaign, stages, state.stageIndex, guided)}${campaign.goalId ? ` · <a class="link" href="#/brand/${brandId}/goals/${campaign.goalId}">${icon("target", { size: 12 })} ${t("roadmap.camp.link")}</a>` : ""}</p>
      </div>
      <div class="cd-head-actions" style="flex:none;">
        <button class="icon-btn" id="cd-more" aria-label="${t("camp.detail.more")}" style="width:36px;height:36px;">${icon("dots", { size: 16 })}</button>
      </div>
    </div>

    ${guided ? guidedIntroHTML() : ""}
    ${state.celebrateIndex !== undefined && state.celebrateIndex !== null && stages[state.celebrateIndex]?.state === "completed" ? celebrateHTML(stages[state.celebrateIndex], stages[state.celebrateIndex + 1]) : ""}
    ${headline ? headlineHTML(headline, stageRead, stage) : ""}
    ${guided ? "" : pulseHTML({ campaign, stage, stages, stageRead, ctx, acts, actions })}
    ${guided ? "" : proToolbarHTML()}
    ${guided ? "" : proTabsHTML(campaign, stages, acts, tab)}
    ${tab === "ideas" ? ideasWidgetHTML(campaign, state) : ""}
    ${tab === "plan" ? planRoadmapHTML(campaign, stages, ctx) : ""}
    ${tab === "activity" ? `${pendingEngagementHTML(campaignPendingEngagement(campaign, ctx))}${salesWidgetHTML(brandId, campaign, brand)}${eventSalesWidgetHTML(brandId, campaign, brand)}${sourceSalesHTML(brandId, campaign, brand)}${activitiesHTML(acts, brandId, guided)}` : ""}
    ${tab !== "target" ? "" : `
    ${isLadder ? levelGateHTML(campaign, stage, stageRead, ctx) : ""}
    ${stageNavHTML(stages, state.stageIndex, acts, content, campaign)}

    ${guided ? `<div class="section-title" style="margin-top:20px;"><h2>${t("camp.guided.msTitle")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.guided.msSub")}</span></div>` : ""}
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
        // Pemula: the milestone list IS the page (see the guided layout
        // note above), so it's always open — the rules/pace/disclaimer
        // paragraphs stay Pro-only. Pro unchanged.
        `${isLadder ? missionTreeHTML(stage, stageRead.readings) : ""}
         ${milestoneListHTML(stageRead.readings, stage, guided)}
         ${guided ? "" : ladderRulesHTML(campaign, stage, guided)}`
      }
    </div>

    ${!guided && (campaign.goalPlan?.version === 2 || campaign.goalPlan?.version === 3) && isLadder ? growBrandStatusHTML(campaign, stage, stageRead, ctx) : ""}
    ${guided ? brainstormCardHTML(campaign, state) : ""}`}
  `;

  setPageGuide(() => startCampaignDetailGuide(brandId, campaign.id));
  wireHelpButtons(root);
  qsa("[data-cd-delegated]", root).forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = `#/brand/${brandId}/campaigns/${a.dataset.cdDelegated}`;
    })
  );
  qsa("[data-cd-ms-posts]", root).forEach((btn) =>
    btn.addEventListener("click", () => openPostList(stageRead.readings[Number(btn.dataset.cdMsPosts)], { brandId, ctx, ctxLabel, campaign, stage }))
  );
  qsa("[data-cd-tab]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      state.proTab = btn.dataset.cdTab;
      refresh();
    })
  );
  qs("#cd-more", root)?.addEventListener("click", (e) => openMoreMenu(e.currentTarget, { brandId, brand, campaign, stage, stages, ctx, refresh, state, guided, openEdit }));
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
  // Beginner mode has no options menu, so a milestone that doesn't fit this
  // event gets its own delete button.
  qsa("[data-cd-ms-del]", root).forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const m = stageRead.readings[Number(btn.dataset.cdMsDel)]?.milestone;
      if (!m) return;
      const ok = await confirmDialog({ title: t("camp.detail.deleteMilestoneTitle"), message: t("camp.detail.deleteMilestoneMsg", { name: m.label }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      patchMilestone(campaign, stage, m.id, null);
      refresh();
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
  qsa("[data-cd-brainstorm]", root).forEach((btn) => btn.addEventListener("click", () => goBrainstorm({ brandId, campaign, stage, ctxLabel })));
  qs("#cd-new-content", root)?.addEventListener("click", () => run({ type: "new-content" }));
  qs("#cd-content-plan", root)?.addEventListener("click", () => openContentPlanModal({ brand, campaign, stages, refresh }));
  qsa("[data-cd-open-content]", root).forEach((row) =>
    row.addEventListener("click", () => run({ type: "creator", contentId: row.dataset.cdOpenContent, intent: "continue" }))
  );
  qsa("[data-cd-pipeline]", root).forEach((chip) =>
    chip.addEventListener("click", () => go(`#/brand/${brandId}/content/list`, { fromLabel: ctxLabel, campaignId: campaign.id, status: chip.dataset.cdPipeline }))
  );
  wirePlanRoadmap(root, { brand, campaign, stages, refresh });
  wireIdeasWidget(root, { brand, campaign, refresh, state });
  wireWidgetToggle(root, {
    collapsedList: CAMPAIGN_WIDGET_KEYS.filter((k) => isWidgetCollapsed(campaign, k)),
    save: (next) => updateCampaign(campaign.id, { widgetsCollapsed: next, planCollapsed: false, ideasCollapsed: false, salesWidgetCollapsed: false }),
    refresh,
  });
  qsa("[data-cd-pending]", root).forEach((row) =>
    row.addEventListener("click", () => {
      const c = content.find((x) => x.id === row.dataset.cdPending);
      if (c) openQuickFillModal({ c, onSaved: refresh });
    })
  );
  autoRefreshPlan(root, { brand, campaign, stages, state, refresh });
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
    <div class="card glass-card cd-celebrate">
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
    <div class="card glass-card cd-headline">
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
    <div class="card glass-card cd-pending-engagement">
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
  const tracker = getTracker(brand);
  const stats = productStats(tracker).filter((s) => !s.product.archived);
  const totals = trackerTotals(tracker);
  if (isWidgetCollapsed(campaign, "sales")) return widgetCollapsedHTML("sales", "target", t("camp.sales.title"), t("camp.sales.summary", { count: stats.length, sold: formatNumber(totals.sold) }));
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
  return widgetCardHTML("sales", "target", t("camp.sales.title"), `
      ${stats.length
        ? `<div class="cd-sales-list">${stats.map(row).join("")}</div>
           <div class="cd-sales-total"><span>${t("camp.sales.totalSold")}</span><b>${formatNumber(totals.sold)}</b></div>`
        : `<p class="text-muted" style="font-size:13px;margin:0 0 10px;">${t("camp.sales.empty")}</p>`}
      <a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/sales" style="margin-top:12px;">${icon("arrowRight", { size: 13 })}${t("camp.sales.openTracker")}</a>
    `, { sub: t("camp.sales.sub") });
}

// ---------- Sales at this event (Event campaigns only) ----------
// Same shape as the Sales Tracker widget above, but scoped to sales tagged
// with THIS event (js/sales-tracker.js logSale's optional eventId) instead
// of every product — for a brand that sells at bazaars/launches/pop-ups,
// "how much did we sell here" lives on the event's own page too, not just
// buried in the Sales Tracker's full log.
function eventSalesWidgetHTML(brandId, campaign, brand) {
  if (!campaign.eventPlan) return "";
  const stats = eventSalesStats(brand, campaign.id);
  if (isWidgetCollapsed(campaign, "eventSales")) return widgetCollapsedHTML("eventSales", "target", t("camp.eventSales.title"), t("camp.eventSales.summary", { count: stats.products.length, sold: formatNumber(stats.qty) }));
  return widgetCardHTML("eventSales", "target", t("camp.eventSales.title"), `
      ${stats.products.length
        ? `<div class="cd-sales-list">${stats.products.map((p) => `
            <div class="cd-sales-row">
              <span class="cd-sales-name">${esc(p.product.name)}</span>
              <span class="cd-sales-sold">${formatNumber(p.qty)}</span>
            </div>`).join("")}</div>
           <div class="cd-sales-total"><span>${t("camp.eventSales.total")}</span><b>${formatNumber(stats.qty)}</b></div>`
        : `<p class="text-muted" style="font-size:13px;margin:0 0 10px;">${t("camp.eventSales.empty")}</p>`}
      <a class="btn btn-secondary btn-sm" href="#/brand/${brandId}/sales" style="margin-top:12px;">${icon("arrowRight", { size: 13 })}${t("camp.eventSales.openTracker")}</a>
    `, { sub: t("camp.eventSales.sub") });
}

// ---------- Sales tagged with this campaign ----------
// One quiet line (not another widget) once the owner has tagged a sale with
// this campaign — or with one of its posts — in the Sales Tracker. Events
// already show theirs in the widget above.
function sourceSalesHTML(brandId, campaign, brand) {
  if (campaign.eventPlan) return "";
  const s = campaignSalesStats(brand, campaign.id);
  if (!s.count) return "";
  return `<a class="card glass-card card-tight st-campaign cd-source-sales" href="#/brand/${brandId}/sales">${icon("target", { size: 16 })}<span>${t("sales.source.campaignLine", { qty: formatNumber(s.qty), revenue: `Rp ${formatNumber(Math.round(s.revenue))}`, count: s.count })}</span>${icon("arrowRight", { size: 14 })}</a>`;
}

// ---------- Ide Campaign (bubble idea board) ----------
// A persistent, always-visible board so the ideas someone already had for
// this campaign don't live only inside a modal they have to reopen —
// type one, or generate a batch with AI, and it stays here as a small
// pill. Kept ideas also flow into every OTHER AI call for this campaign
// (js/ai.js campaignSummaryLine) so later content/plan generation stays
// aligned with what was already decided, not just what's on this page.
const IDEA_TRACK_COPY = { social: "social", community: "community", sales: "sales" };
const ideaTrack = (campaign) => (campaign.eventPlan ? "event" : IDEA_TRACK_COPY[campaign.goalPlan?.track] || "");
const ideaTrackClass = (campaign) => (ideaTrack(campaign) ? `cd-idea-bubble--${ideaTrack(campaign)}` : "");
// One kept idea (campaign.ideas[]) — shared by the Pro ideas widget and
// the Pemula Brainstorm card. Opens like a folder on click: the
// description (AI's "why", or a note the user adds) stays out of the way
// until someone wants it, instead of crowding every bubble at a glance.
function ideaBubbleHTML(idea, state, trackCls) {
  const open = state.expandedIdeaId === idea.id;
  return `
    <div class="cd-idea-bubble ${trackCls} ${open ? "is-open" : ""}" data-idea-id="${idea.id}">
      <button type="button" class="cd-idea-bubble-head" data-idea-toggle="${idea.id}">
        ${idea.source === "ai" || idea.source === "brainstorm" ? icon("sparkle", { size: 11 }) : icon("folder", { size: 11 })}
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
}
function ideasWidgetHTML(campaign, state) {
  // Events don't carry a goalPlan (js/store.js buildEventPhases is a
  // separate, date-anchored system) — treat them as their own idea track
  // so the widget's copy/AI framing talks about the event, not a generic
  // "campaign" nobody asked for.
  const track = campaign.eventPlan ? "event" : IDEA_TRACK_COPY[campaign.goalPlan?.track] || "";
  // Closable, same pattern as the Rencana widget just above it — collapses
  // to a one-line bar so the page doesn't stay crowded once the ideas are
  // captured and the user's back to just executing.
  const ideas = campaign.ideas || [];
  if (isWidgetCollapsed(campaign, "ideas")) return widgetCollapsedHTML("ideas", "bulb", t(`camp.ideas.title.${track || "default"}`), t("camp.ideas.summary", { count: ideas.length }));
  const suggestions = state.ideaSuggestions || [];
  const trackCls = ideaTrackClass(campaign);
  const bubble = (idea) => ideaBubbleHTML(idea, state, trackCls);
  // `scope` disambiguates the add button across batches ("cur" for the
  // live one, "h0"/"h1"/… for a history batch) since each batch re-starts
  // its own item indices — without it, adding idea #0 from an older batch
  // could pick up whatever now sits at index 0 in a newer one.
  const suggestionBubble = (idea, i, scope = "cur") => `
    <div class="cd-idea-bubble cd-idea-bubble--suggestion ${trackCls}">
      <div class="cd-idea-suggestion-row">
        <div class="cd-idea-bubble-head" style="cursor:default;">${icon("sparkle", { size: 11 })}<span>${esc(idea.text)}</span></div>
        <button type="button" class="cd-idea-add-suggestion" data-suggestion-add="${scope}:${i}" aria-label="${t("camp.ideas.keepOne")}">${icon("plus", { size: 12 })}</button>
      </div>
      ${idea.description ? `<p class="cd-idea-suggestion-desc">${esc(idea.description)}</p>` : ""}
    </div>`;
  const history = state.ideaSuggestionHistory || [];
  return `<div class="cd-tab-widget">` + widgetCardHTML("ideas", "bulb", t(`camp.ideas.title.${track || "default"}`), `
      <div class="cd-ideas-input">
        <input class="input" id="cd-idea-input" maxlength="140" placeholder="${esc(t(`camp.ideas.placeholder.${track || "default"}`))}" />
        <button type="button" class="btn btn-primary btn-sm" id="cd-idea-add">${icon("plus", { size: 13 })}${t("camp.ideas.add")}</button>
        <button type="button" class="btn btn-secondary btn-sm" id="cd-idea-ai">${icon("sparkle", { size: 13 })}${t(`camp.ideas.aiBtn.${track || "default"}`)}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="cd-idea-discuss" title="${esc(t("camp.ideas.discussTitle"))}">${icon("chat", { size: 13 })}${t("camp.ideas.discuss")}</button>
      </div>
      <div id="cd-idea-status"></div>
      ${suggestions.length ? `<div class="cd-idea-bubbles cd-idea-suggestions" id="cd-idea-suggestions">${suggestions.map((idea, i) => suggestionBubble(idea, i)).join("")}</div>` : `<div id="cd-idea-suggestions"></div>`}
      ${
        history.length
          ? `<details class="ai-history">
               <summary>${t("cr.ai.previousGenerated")} (${history.length})</summary>
               <div id="ai-history-list">${history.map((batch, bi) => `<div class="ai-batch cd-idea-bubbles">${batch.map((idea, i) => suggestionBubble(idea, i, `h${bi}`)).join("")}</div>`).join("")}</div>
             </details>`
          : ""
      }
      <div class="cd-idea-bubbles" id="cd-idea-kept">
        ${ideas.length ? ideas.map(bubble).join("") : `<p class="text-faint cd-idea-empty">${t(`camp.ideas.empty.${track || "default"}`)}</p>`}
      </div>
    `, { sub: t(`camp.ideas.sub.${track || "default"}`) }) + `</div>`;
}
function wireIdeasWidget(root, { brand, campaign, refresh, state }) {
  // Kept-idea bubbles (open / delete / note) exist in both modes — the
  // Pemula Brainstorm card lists them too. The input, AI and suggestion
  // handlers below only exist on the Pro widget.
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
  qsa("[data-suggestion-add]", root).forEach((btn) =>
    btn.addEventListener("click", () => {
      const [scope, idxStr] = btn.dataset.suggestionAdd.split(":");
      const i = Number(idxStr);
      const batch = scope === "cur" ? state.ideaSuggestions : (state.ideaSuggestionHistory || [])[Number(scope.slice(1))];
      const idea = batch?.[i];
      if (!idea) return;
      if (scope === "cur") state.ideaSuggestions = state.ideaSuggestions.filter((_, n) => n !== i);
      else state.ideaSuggestionHistory[Number(scope.slice(1))] = batch.filter((_, n) => n !== i);
      addIdea(idea.text, "ai", idea.description || "");
    })
  );
  qs("#cd-idea-discuss", root)?.addEventListener("click", () => go(`#/brand/${brand.id}/chat`, { fromLabel: campaign.name, campaignId: campaign.id, mode: "chat" }));
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
      const pulseText = pulseTextFor(brand, { content: listContent(brand.id), campaigns: listCampaigns(brand.id), settings: getSettings() });
      const { ideas } = await generateIdeaBubbles(ai, { brand, campaign, track: campaign.eventPlan ? "event" : campaign.goalPlan?.track, existingIdeas: (campaign.ideas || []).map((i) => i.text), pulseText });
      // Whatever was still showing (not yet kept) drops into the collapsed
      // history instead of being silently replaced — same pattern as the
      // brainstorm modal and Creator's AI panel.
      if (state.ideaSuggestions?.length) state.ideaSuggestionHistory = [state.ideaSuggestions, ...(state.ideaSuggestionHistory || [])];
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
  if (isWidgetCollapsed(campaign, "plan")) {
    const summary = t("camp.plan.summary", { done: stages.filter((s) => s.state === "completed").length, total: stages.length });
    const autoToday = campaign.aiPlan?.autoReason && campaign.aiPlan.autoDay === localISODate();
    return widgetCollapsedHTML("plan", "layers", t("camp.plan.title"), autoToday ? `${summary} · ${t("ai.auto.today")}` : summary);
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
  return `<div class="cd-tab-widget">` + widgetCardHTML("plan", "layers", t("camp.plan.title"), `
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
      <div id="cd-plan-status">${campaign.aiPlan?.autoReason ? `<p class="ai-auto-note">${icon("refresh", { size: 12 })}${esc(t("ai.auto.reason", { reason: campaign.aiPlan.autoReason }))}</p>` : ""}</div>
      <ol class="cd-plan-levels">${stages.map(levelHTML).join("")}</ol>
    `, { sub: t(`camp.plan.sub.${track}`) }) + `</div>`;
}

function wirePlanRoadmap(root, { brand, campaign, stages, refresh }) {
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
      const pulseText = pulseTextFor(brand, { content: listContent(brand.id), campaigns: listCampaigns(brand.id), settings: getSettings() });
      const extra = qs("#cd-plan-context", root)?.value.trim() || "";
      const result = await generateCampaignPlaybook(ai, { brand, campaign, track: campaign.goalPlan.track, levels, extra, pulseText });
      updateCampaign(campaign.id, { aiPlan: { ...keepAdded(result, campaign.aiPlan), extra, refreshedFor: campaign.aiPlan?.refreshedFor || [], generatedAt: Date.now() } });
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

// Activities already pushed into a level stay marked after a rewrite.
function keepAdded(next, prev) {
  const added = new Set((prev?.levels || []).flatMap((l) => (l.activities || []).filter((a) => a.added).map((a) => `${l.index}:${a.title}`)));
  if (!added.size) return next;
  return { ...next, levels: (next.levels || []).map((l) => ({ ...l, activities: (l.activities || []).map((a) => (added.has(`${l.index}:${a.title}`) ? { ...a, added: true } : a)) })) };
}

// The Rencana playbook, rewritten on its own — free — when an important
// signal arrived after it was written (js/ai-autorefresh.js: rules and
// guards). Once per page visit, only for a plan the owner already made.
async function autoRefreshPlan(root, { brand, campaign, stages, state, refresh }) {
  const plan = campaign.aiPlan;
  if (state.autoPlanTried || !plan || campaign.goalPlan?.version !== 3 || stages[0]?.kind !== "level") return;
  state.autoPlanTried = true;
  const ai = getSettings().ai || {};
  const advice = { at: plan.generatedAt, refreshedFor: plan.refreshedFor, autoDay: plan.autoDay };
  if (!mayAutoRefresh(advice, ai)) return;
  const content = listContent(brand.id);
  const campaigns = listCampaigns(brand.id);
  const signal = staleBecause(advice, { brand, content, campaigns, settings: getSettings() });
  if (!signal) return;
  const statusEl = qs("#cd-plan-status", root);
  if (statusEl) statusEl.innerHTML = `<div class="ocr-status" style="margin-bottom:10px;"><div class="spinner"></div><span>${esc(t("ai.auto.busy", { reason: signal.title }))}</span></div>`;
  try {
    const levels = stages.map((s) => ({ index: s.index, name: s.name, description: s.description, targets: s.milestones.filter((m) => m.required !== false && !m.notApplicable).map((m) => `${m.label}${m.target ? ` ${m.target} ${m.unit || ""}` : ""}`) }));
    const pulseText = pulseTextFor(brand, { content, campaigns, settings: getSettings() });
    const result = await generateCampaignPlaybook(ai, { brand, campaign, track: campaign.goalPlan.track, levels, extra: plan.extra || "", pulseText, free: true });
    updateCampaign(campaign.id, { aiPlan: { ...keepAdded(result, plan), extra: plan.extra || "", ...refreshStamp(advice, signal), generatedAt: Date.now() } });
  } catch {
    // Keep the old plan quietly; the button still rewrites it by hand.
  }
  refresh();
}

// ---------- "Buat rencana konten" ----------
// The campaign's next weeks of content in one go: the owner picks how many
// weeks and posts per week, the AI writes the list in the order the
// campaign's stages run, the owner unticks what they don't want, and the
// rest lands in the calendar as ideas on their dates — linked to this
// campaign (and its phase when the date falls in one). Running it again
// never duplicates: titles already in this campaign are shown as "sudah
// ada" and skipped. One credit (the owner clicked).
const PLAN_PER_WEEK = [2, 3, 4];
const PLAN_MAX_WEEKS = 12;
const normTitle = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localISODate(d);
}
// Post i of the plan: week by week, the week's posts spread over its 7 days.
const planDate = (start, i, perWeek) => addDays(start, Math.floor(i / perWeek) * 7 + Math.round(((i % perWeek) * 7) / perWeek));
// The stage a date belongs to: a window stage by its dates; a named phase
// by what the AI wrote; a level has no phase id.
function stageFor(stages, date, phaseName) {
  const byDate = stages.find((s) => s.kind === "window" && s.dateFrom && date >= s.dateFrom && date <= s.dateTo);
  if (byDate) return byDate;
  const byName = phaseName ? stages.find((s) => s.kind !== "level" && s.name.toLowerCase() === phaseName.toLowerCase()) : null;
  return byName || null;
}

function openContentPlanModal({ brand, campaign, stages, refresh }) {
  const today = localISODate();
  const start = campaign.startDate && campaign.startDate > today ? campaign.startDate : today;
  const daysLeft = campaign.endDate && campaign.endDate > start ? (new Date(campaign.endDate) - new Date(start)) / 86400000 : 0;
  const st = { weeks: daysLeft ? Math.min(PLAN_MAX_WEEKS, Math.max(1, Math.ceil(daysLeft / 7))) : 4, perWeek: 3, start, items: null, busy: false, error: "" };
  const settings = getSettings();
  const existing = () => new Set(listContent(brand.id).filter((c) => c.campaignId === campaign.id).map((c) => normTitle(c.title)));

  const formHTML = () => `
    <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${t("camp.cplan.intro")}</p>
    <div class="row-2">
      <div class="field"><label for="cp-weeks">${t("camp.cplan.weeks")}</label><input class="input" id="cp-weeks" type="number" min="1" max="${PLAN_MAX_WEEKS}" value="${st.weeks}" /></div>
      <div class="field"><label for="cp-start">${t("camp.cplan.start")}</label><input class="input" id="cp-start" type="date" value="${st.start}" /></div>
    </div>
    <div class="field"><label>${t("camp.cplan.perWeek")}</label>
      <div class="chip-select" id="cp-per">${PLAN_PER_WEEK.map((n) => `<button type="button" data-val="${n}" class="${n === st.perWeek ? "active" : ""}">${t("camp.cplan.perWeekN", { n })}</button>`).join("")}</div>
    </div>
    ${st.error ? `<p class="ev-error">${esc(st.error)}</p>` : ""}
    ${st.busy ? `<div class="ocr-status"><div class="spinner"></div><span>${t("camp.cplan.busy")}</span></div>` : ""}`;

  const listHTML = () => {
    const have = existing();
    const rows = st.items.map((it, i) => {
      const dup = have.has(normTitle(it.title));
      const stage = stageFor(stages, it.date, it.phase);
      return `
      <label class="cp-plan-row ${dup ? "is-dup" : ""}">
        <input type="checkbox" data-cp-pick="${i}" ${dup ? "disabled" : it.picked === false ? "" : "checked"} />
        <span class="cp-plan-date">${esc(formatDate(it.date, { year: undefined }))}</span>
        <span class="cp-plan-body">
          <b>${esc(it.title)}</b>${dup ? ` <span class="tag">${t("camp.cplan.dup")}</span>` : ""}
          ${it.angle ? `<span class="text-muted">${esc(it.angle)}</span>` : ""}
          <span class="cp-plan-tags"><span class="tag tag-${it.funnel.toLowerCase()}">${esc(funnelShort(it.funnel))}</span>${it.format ? `<span class="tag">${esc(it.format)}</span>` : ""}${stage ? `<span class="tag">${esc(stage.name)}</span>` : ""}</span>
        </span>
      </label>`;
    }).join("");
    return `<p class="text-muted" style="font-size:12.5px;margin:0 0 10px;">${t("camp.cplan.review", { n: st.items.length })}</p><div class="cp-plan-list">${rows}</div>`;
  };

  const picked = () => st.items ? st.items.filter((it, i) => it.picked !== false && !existing().has(normTitle(it.title))) : [];
  const footHTML = () => st.items
    ? `<button type="button" class="btn btn-ghost" id="cp-back">${icon("refresh", { size: 13 })}${t("camp.cplan.again")}</button><button type="button" class="btn btn-primary" id="cp-add" ${picked().length ? "" : "disabled"}>${icon("calendar", { size: 14 })}${t("camp.cplan.add", { n: picked().length })}</button>`
    : `<span class="text-faint" style="font-size:11.5px;margin-right:auto;">${t("camp.cplan.credit")}</span><button type="button" class="btn btn-primary" id="cp-go" ${st.busy ? "disabled" : ""}>${icon("sparkle", { size: 14 })}${t("camp.cplan.go")}</button>`;

  const overlay = openModal({ title: t("camp.cplan.title", { name: campaign.name || "" }), wide: true, bodyHTML: formHTML(), footHTML: footHTML() });
  const body = overlay.querySelector(".modal-body");
  const foot = overlay.querySelector(".modal-foot");
  const paint = () => {
    body.innerHTML = st.items ? listHTML() : formHTML();
    if (foot) foot.innerHTML = footHTML();
    wireIt();
  };
  const readForm = () => {
    st.weeks = Math.min(PLAN_MAX_WEEKS, Math.max(1, Math.round(Number(qs("#cp-weeks", overlay)?.value)) || st.weeks));
    st.start = qs("#cp-start", overlay)?.value || st.start;
  };
  const go = async () => {
    readForm();
    const ai = settings.ai || {};
    if (isTourDemo()) { toast(DEMO_TOAST); return; }
    if (!hasAiKey(ai)) { st.error = t("camp.bs.noKey"); paint(); return; }
    st.busy = true; st.error = ""; paint();
    try {
      const content = listContent(brand.id);
      // What already worked: posts the owner tagged sales to, then the
      // best-engaging published posts.
      const sold = content.map((c) => ({ c, s: contentSalesStats(brand, c.id) })).filter((x) => x.s.qty).sort((a, b) => b.s.revenue - a.s.revenue).slice(0, 3)
        .map(({ c, s }) => `"${c.title}" (${c.format || "?"}, ${c.funnel || "?"}) — ${s.qty} sold`);
      const engaged = content.filter((c) => c.status === "published").map((c) => ({ c, er: computeContentMetrics(c, settings).engagementRate })).filter((x) => x.er !== null && x.er !== undefined).sort((a, b) => b.er - a.er).slice(0, 3)
        .map(({ c, er }) => `"${c.title}" (${c.format || "?"}, ${c.funnel || "?"}) — engagement ${Number(er).toFixed(1)}%`);
      const items = await generateCampaignContentPlan(ai, {
        brand, campaign, weeks: st.weeks, perWeek: st.perWeek, startDate: st.start,
        stages: stages.map((s) => ({ name: s.name, dateFrom: s.dateFrom, dateTo: s.dateTo, goal: s.description })),
        formats: (settings.formats || []).map((f) => f.name).filter(Boolean),
        existingTitles: content.filter((c) => c.campaignId === campaign.id).map((c) => c.title).filter(Boolean),
        proven: [...sold, ...engaged],
        pulseText: pulseTextFor(brand, { content, campaigns: listCampaigns(brand.id), settings }),
      });
      st.items = items.map((it, i) => ({ ...it, date: planDate(st.start, i, st.perWeek) }));
    } catch (e) {
      st.error = e instanceof AiApiError ? e.message : t("camp.cplan.failed");
    }
    st.busy = false;
    paint();
  };
  const add = () => {
    const list = picked();
    if (!list.length) return;
    const platform = settings.platforms?.[0]?.name || "";
    list.forEach((it) => {
      const stage = stageFor(stages, it.date, it.phase);
      createContent(brand.id, {
        title: it.title, idea: it.angle, funnel: it.funnel, format: it.format || "", platform, status: "idea", scheduleDate: it.date,
        campaignId: campaign.id, campaignPhaseId: stage && stage.kind !== "level" ? stage.id : "", fromCampaignPlan: campaign.id,
      });
    });
    closeOverlay(overlay);
    toast(t("camp.cplan.added", { n: list.length }));
    refresh();
  };
  const wireIt = () => {
    qsa("#cp-per button", overlay).forEach((b) => b.addEventListener("click", () => { readForm(); st.perWeek = Number(b.dataset.val); paint(); }));
    qs("#cp-go", overlay)?.addEventListener("click", go);
    qs("#cp-back", overlay)?.addEventListener("click", () => { st.items = null; paint(); });
    qs("#cp-add", overlay)?.addEventListener("click", add);
    qsa("[data-cp-pick]", overlay).forEach((cb) => cb.addEventListener("change", () => {
      st.items[Number(cb.dataset.cpPick)].picked = cb.checked;
      const btn = qs("#cp-add", overlay);
      if (btn) { btn.disabled = !picked().length; btn.innerHTML = `${icon("calendar", { size: 14 })}${t("camp.cplan.add", { n: picked().length })}`; }
    }));
  };
  wireIt();
}

// The stage/level strip as a connected path rather than loose buttons —
// each node gets a numbered/checked/locked badge and the gap between two
// nodes lights up once you've moved past it, so the whole row reads at a
// glance as "how far along this campaign's roadmap is", not just a set of
// tabs to click through.
function stageNavHTML(stages, index, acts, content, campaign) {
  if (stages.length <= 1) return "";
  return `
    <div class="event-timeline cd-stages" id="cd-stages">
      ${stages
        .map((s, i) => {
          const sub =
            s.kind === "level" ? (s.state === "completed" ? t("camp.detail.done") : s.state === "locked" ? t("camp.detail.locked") : t("camp.detail.now")) : s.kind === "window" ? s.dateLabel : t("camp.detail.contentCount", { count: content.filter((c) => c.campaignId === campaign.id && c.campaignPhaseId === s.id).length });
          const isDone = s.kind === "level" ? s.state === "completed" : s.kind === "window" ? s.state === "past" : false;
          const isLocked = s.kind === "level" && s.state === "locked";
          const cls = s.kind === "level" ? (isDone ? "status-completed" : isLocked ? "is-locked" : "status-in_progress") : s.kind === "window" ? (isDone ? "is-past" : s.state === "current" ? "status-in_progress" : "") : "";
          const badge = isDone ? icon("check", { size: 12 }) : isLocked ? icon("lock", { size: 11 }) : `${i + 1}`;
          const connector = i > 0 ? `<span class="epp-connector ${i <= index ? "is-lit" : ""}"></span>` : "";
          return `${connector}<button type="button" class="event-phase-pill ${cls} ${i === index ? "active" : ""}" data-cd-stage="${i}">
            <span class="epp-badge">${badge}</span>
            <span class="epp-body">
              <span class="event-phase-name">${esc(s.name)}</span>
              <span class="event-phase-date">${esc(sub)}</span>
            </span>
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
    return `<div class="card glass-card cd-gate is-wait"><h3>${esc(t("camp.gate.waitTitle", { weeks: adv.weeksLeft }))}</h3><p>${esc(t("camp.gate.waitBody", { min: adv.minWeeks, weeks: adv.weeks }))}</p></div>`;
  }
  if (adv.targetsMet) return "";
  const open = stageRead.readings.filter((r) => r.milestone.required !== false && !r.milestone.notApplicable && !r.met);
  const head = stageRead.readings.find((r) => r.milestone.highlight);
  // Only worth saying when the headline number is done but the level isn't.
  if (!head?.met || !open.length) return "";
  return `<div class="card glass-card cd-gate is-wait"><h3>${esc(t("camp.gate.openTitle", { count: open.length }))}</h3><p>${esc(open.map((r) => r.milestone.label).join(" · "))}</p></div>`;
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
      go(`#/brand/${brandId}/content/list`, { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null, contentId: b.dataset.post, intent: "performance" });
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
        ${m.legacy?.dueDate && !r.met ? (() => { const late = m.legacy.dueDate < localISODate(); return `<div class="cd-row-due ${late ? "is-overdue" : ""}">${esc(t(late ? "roadmap.ms.overdue" : "roadmap.ms.due", { date: formatEventDate(m.legacy.dueDate) }))}</div>`; })() : ""}
        ${m.description && !guided ? `<div class="cd-row-desc">${esc(m.description)}</div>` : m.description && guided && !r.auto ? `<div class="cd-row-desc">${esc(m.description)}</div>` : ""}
        <div class="cd-row-source">${source}${r.note ? ` · ${esc(r.note)}` : ""}</div>
      </div>
      <div class="cd-row-value mono">${value}</div>
      <div class="cd-row-action">${action}${guided ? (!locked && stage.kind !== "level" ? `<button type="button" class="icon-btn cd-ms-del" data-cd-ms-del="${i}" aria-label="${t("roadmap.ms.remove")}" title="${t("roadmap.ms.remove")}" style="width:26px;height:26px;">${icon("trash", { size: 13 })}</button>` : "") : `<button type="button" class="icon-btn cd-ms-menu" data-cd-ms-menu="${i}" aria-label="${t("camp.detail.msOptions")}" style="width:26px;height:26px;">${icon("dots", { size: 13 })}</button>`}</div>
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

// Pemula's one door out of this page: the Brainstorm partner scoped to
// this campaign (same chat as Pro's "Diskusi dulu" / "Brainstorm konten"
// buttons — js/views/chat.js is one component, this is just the entry).
// Keeps #cd-brainstorm so the campaign tour step still finds it.
// ---------- Pro: Pulse strip, toolbar, tabs ----------
// Weekly published count for the campaign's content pool over the last
// `weeks` weeks (oldest → this week). Week buckets end today, so the last
// bar is the running week.
function weeklyRhythm(campaign, content, weeks = 8) {
  const DAY = 86400000;
  const today = Math.floor(new Date(localISODate() + "T12:00:00").getTime() / DAY);
  const counts = new Array(weeks).fill(0);
  campaignContentPool(campaign, content)
    .filter((c) => c.status === "published" && c.publishedDate && !c.archived)
    .forEach((c) => {
      const d = Math.floor(new Date(c.publishedDate + "T12:00:00").getTime() / DAY);
      const back = today - d;
      if (back < 0) return;
      const slot = weeks - 1 - Math.floor(back / 7);
      if (slot >= 0) counts[slot] += 1;
    });
  return counts;
}

function pulseHTML({ campaign, stage, stages, stageRead, ctx, acts, actions }) {
  if (!stage) return "";
  // Pace tile: levels know a rough duration, events know a date, plain
  // phase campaigns only know where they are in the sequence.
  let pace;
  if (stage.kind === "level" && campaign.goalPlan) {
    const ev = evaluateLevel({ readings: stageRead.readings, startedAt: stageStartedAt(campaign, stage), estWeeks: stage.raw?.estWeeks || 12, uploadsPerWeek: campaign.goalPlan.uploadsPerWeek });
    pace = { value: `${t("camp.pulse.week", { n: ev.weeks })} <small>${t("camp.pulse.ofEst", { est: ev.estWeeks })}</small>`, sub: "", status: ev.overdue ? "bad" : "ok", statusLabel: ev.overdue ? t("camp.pulse.overdue") : t("camp.pulse.onTime") };
  } else if (stage.kind === "window") {
    const endISO = campaign.eventPlan?.eventDate || campaign.goalPlan?.deadline;
    const days = endISO ? daysBetween(localISODate(), endISO) : null;
    pace = { value: days === null ? "—" : days >= 0 ? t("camp.pulse.days", { n: days }) : t("camp.m.daysAgo", { count: -days }), sub: esc(stage.dateLabel || ""), status: days !== null && days < 0 ? "bad" : "ok", statusLabel: stage.state === "current" ? t("camp.detail.inProgress") : stage.state === "past" ? t("camp.detail.past") : t("camp.detail.upcoming") };
  } else {
    pace = { value: t("camp.pulse.phase", { n: stage.index + 1, total: stages.length }), sub: esc(stage.name || ""), status: "ok", statusLabel: t("camp.detail.now") };
  }

  // Rhythm tile: 8 tiny bars, the weekly upload target drawn as a line.
  const rhythm = weeklyRhythm(campaign, ctx.content);
  const target = Number(campaign.goalPlan?.uploadsPerWeek) || 0;
  const max = Math.max(1, target, ...rhythm);
  const avg = Math.round((rhythm.reduce((a, b) => a + b, 0) / rhythm.length) * 10) / 10;
  const bars = rhythm.map((n, i) => `<span class="cd-spark-bar ${target && n >= target ? "is-hit" : ""} ${i === rhythm.length - 1 ? "is-now" : ""}" style="height:${Math.max(8, Math.round((n / max) * 100))}%" title="${n}"></span>`).join("");
  const targetLine = target ? `<span class="cd-spark-target" style="bottom:${Math.round((target / max) * 100)}%"></span>` : "";

  // Content & ideas tile.
  const published = acts.counts.published || 0;
  const inProgress = acts.linked.length - published;
  const ideas = (campaign.ideas || []).length;

  const first = actions[0] || null;
  return `
    <div class="cd-pulse">
      <div class="cd-pulse-tile">
        <div class="cd-pulse-label">${t("camp.pulse.pace")}</div>
        <div class="cd-pulse-value">${pace.value}</div>
        <div class="cd-pulse-sub"><span class="cd-pulse-dot is-${pace.status}"></span>${pace.statusLabel}${pace.sub ? ` · ${pace.sub}` : ""}</div>
      </div>
      <div class="cd-pulse-tile">
        <div class="cd-pulse-label">${t("camp.pulse.rhythm")}</div>
        <div class="cd-spark" aria-label="${esc(t("camp.pulse.rhythmAria"))}">${targetLine}${bars}</div>
        <div class="cd-pulse-sub">${target ? t("camp.pulse.rhythmSub", { avg, target }) : t("camp.pulse.rhythmSubNoTarget", { avg })}</div>
      </div>
      <div class="cd-pulse-tile">
        <div class="cd-pulse-label">${t("camp.pulse.content")}</div>
        <div class="cd-pulse-value">${published} <small>${t("camp.pulse.published")}</small></div>
        <div class="cd-pulse-sub">${t("camp.pulse.contentSub", { progress: Math.max(0, inProgress), ideas })}</div>
      </div>
      ${first ? `
      <div class="cd-pulse-tile cd-pulse-next" id="cd-next">
        <div class="cd-pulse-label">${t("camp.detail.nextStep")}</div>
        <div class="cd-pulse-next-title">${esc(first.label)}</div>
        ${first.cta.type !== "info" ? `<button type="button" class="btn btn-primary btn-sm" data-cd-action="0">${esc(first.cta.label)}${icon("arrowRight", { size: 13 })}</button>` : `<div class="cd-pulse-sub">${esc(first.why || "")}</div>`}
      </div>` : ""}
    </div>`;
}

// The three ways to make something, in one row — they used to sit at the
// bottom of the Activity card. Ids unchanged (cd-brainstorm is a tour
// stop; cd-content-plan / cd-new-content are wired in paintDetail).
function proToolbarHTML() {
  return `
    <div class="cd-toolbar">
      <button type="button" class="btn btn-primary glow" id="cd-brainstorm" data-cd-brainstorm style="--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);">${icon("bulb", { size: 14 })}${t("camp.toolbar.brainstorm")}</button>
      <button type="button" class="btn btn-secondary" id="cd-content-plan" title="${esc(t("camp.cplan.btnTitle"))}">${icon("calendar", { size: 14 })}${t("camp.cplan.btn")}</button>
      <button type="button" class="btn btn-secondary" id="cd-new-content">${icon("plus", { size: 14 })}${t("camp.detail.newContent")}</button>
    </div>`;
}

function proTabList(campaign, stages) {
  const tabs = ["target", "ideas"];
  if (campaign.goalPlan?.version === 3 && stages[0]?.kind === "level") tabs.push("plan");
  tabs.push("activity");
  return tabs;
}
function proTabsHTML(campaign, stages, acts, current) {
  const count = { ideas: (campaign.ideas || []).length, activity: acts.linked.length };
  return `
    <div class="segmented cd-tabs" role="tablist">
      ${proTabList(campaign, stages).map((k) => `<button type="button" role="tab" aria-selected="${k === current}" class="${k === current ? "active" : ""}" data-cd-tab="${k}">${t(`camp.tabs.${k}`)}${count[k] ? `<span class="cd-tab-count">${count[k]}</span>` : ""}</button>`).join("")}
    </div>`;
}

// The card also lists the ideas kept for this campaign (campaign.ideas —
// what "Simpan" in that chat writes, see js/consultant-panel.js
// saveIdeaScoped), so the loop closes on this page: brainstorm → save →
// see it here next to the milestones.
function brainstormCardHTML(campaign, state) {
  const ideas = campaign.ideas || [];
  const trackCls = ideaTrackClass(campaign);
  return `
    <div class="section-title" style="margin-top:28px;"><h2>${t("camp.guided.bsTitle")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.guided.bsSub")}</span></div>
    <div class="card glass-card cd-next cd-brainstorm-card" id="cd-brainstorm-card">
      <h3 class="cd-next-title">${t("camp.bsCard.title")}</h3>
      <p class="cd-next-why">${t("camp.bsCard.body")}</p>
      <div class="cd-next-actions">
        <button type="button" class="btn btn-primary glow" id="cd-brainstorm" data-cd-brainstorm style="--glow-color: color-mix(in srgb, var(--accent) 55%, transparent);">${icon("bulb", { size: 14 })}${t("camp.bsCard.btn")}${icon("arrowRight", { size: 14 })}</button>
      </div>
      <div class="cd-bs-ideas">
        <div class="cd-bs-ideas-head">${icon("bookmark", { size: 13 })}<b>${t("camp.bsCard.ideasTitle")}</b><span class="text-faint">${ideas.length ? t("camp.ideas.summary", { count: ideas.length }) : ""}</span></div>
        <div class="cd-idea-bubbles" id="cd-idea-kept">
          ${ideas.length ? ideas.map((idea) => ideaBubbleHTML(idea, state, trackCls)).join("") : `<p class="text-faint cd-idea-empty">${t("camp.bsCard.ideasEmpty")}</p>`}
        </div>
      </div>
    </div>`;
}

// Pemula's "what is this page for" strip, right under the title: two
// things and only two — follow the milestones, brainstorm ideas — so the
// page's purpose is never a guess.
function guidedIntroHTML() {
  return `
    <div class="cd-guided-intro">
      <div class="cd-guided-intro-item">
        <span class="cd-guided-intro-n">1</span>
        <div><b>${t("camp.guided.intro1Title")}</b><p>${t("camp.guided.intro1Body")}</p></div>
      </div>
      <div class="cd-guided-intro-item">
        <span class="cd-guided-intro-n">2</span>
        <div><b>${t("camp.guided.intro2Title")}</b><p>${t("camp.guided.intro2Body")}</p></div>
      </div>
    </div>`;
}

function activitiesHTML(acts, brandId, guided) {
  const { linked, counts } = acts;
  const recent = [...linked].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  return `
    <div class="section-title" style="margin-top:24px;"><h2>${t("camp.detail.activity")}</h2><span class="text-faint" style="font-size:12px;">${t("camp.detail.activitySub")}</span></div>
    <div class="card glass-card cd-activities">
      ${guided ? "" : `<div class="cd-pipeline">
        ${PIPELINE.map((p) => `<button type="button" class="cd-pipe ${counts[p.key] ? "" : "is-zero"}" data-cd-pipeline="${p.key}"><b>${counts[p.key]}</b>${p.label}</button>`).join("")}
      </div>`}
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
              .join("")}${linked.length > 5 ? `<a class="link" href="#/brand/${brandId}/content/list" style="font-size:12.5px;">${t("camp.detail.seeAll", { count: linked.length })}</a>` : ""}</div>`
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
// Under a generic fix, the brand's own numbers that back it up.
function evalDataLine(key, ctx) {
  if (!ctx) return "";
  if (key === "lowResponse") return bestPostsLine(ctx.content, ctx.settings) || "";
  if (key === "reach") return bestPostsLine(ctx.content, ctx.settings, { one: true }) || "";
  if (key === "gaps" || key === "uploads") return postingLine(ctx.content, ctx.settings) || "";
  return "";
}

function growBrandStatusHTML(campaign, stage, stageRead, ctx = null) {
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
    <div class="card glass-card goal-pace ${ev.overdue ? "is-bad" : "is-ok"}">
      ${
        ev.overdue
          ? `<div class="goal-pace-status"><span class="goal-pace-dot"></span>${esc(t("goal.status.overdueTitle"))}</div>
             <p class="goal-pace-line">${esc(t("goal.status.overdueBody", { name: stage.name, est: ev.estWeeks, weeks: ev.weeks }))}</p>
             <div class="goal-eval">
               <div class="goal-pace-vision-label">${t("goal.status.evalLabel")}</div>
               ${ev.reasons.map((r) => { const data = evalDataLine(r.key, ctx); return `<div class="goal-eval-item"><b>${esc(t(`goal.eval.${r.key}.title`, r.vars))}</b><span>${esc(t(`goal.eval.${r.key}.fix`, r.vars))}</span>${data ? `<span class="goal-eval-data">${icon("chart", { size: 11 })}${esc(data)}</span>` : ""}</div>`; }).join("")}
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
// Every "brainstorm" door on this page opens the Brainstorm partner
// (js/consultant-panel.js) scoped to this campaign and stage — a
// conversation first, ideas once they've been talked through, instead of
// the old modal that generated a list on the spot.
function goBrainstorm({ brandId, campaign, stage, ctxLabel, seed = "" }) {
  go(`#/brand/${brandId}/chat`, { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null, mode: "chat", seed });
}

function runAction(cta, { brandId, brand, campaign, stage, stages, ctx, refresh, ctxLabel }) {
  const base = { fromLabel: ctxLabel, campaignId: campaign.id, stageId: stage?.id || null };
  switch (cta.type) {
    case "creator":
      go(`#/brand/${brandId}/content/creator/${cta.contentId}`, { ...base, contentId: cta.contentId, intent: cta.intent || "continue" });
      return;
    case "new-content":
      go(`#/brand/${brandId}/content/creator`, { ...base, intent: "new-content", defaults: { campaignId: campaign.id, campaignPhaseId: stage?.kind !== "level" ? stage?.id || "" : "", ...(cta.defaults || {}) } });
      return;
    case "calendar":
      go(`#/brand/${brandId}/content/calendar`, { ...base, contentId: cta.contentId || null, intent: "schedule" });
      return;
    case "performance":
      go(`#/brand/${brandId}/content/list`, { ...base, contentId: cta.contentId, intent: "performance" });
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
      goBrainstorm({ brandId, campaign, stage: stages[cta.stageIndex ?? stage?.index] || stage, ctxLabel });
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
  // A template milestone deleted from a campaign that belongs to a goal is
  // remembered on the goal, so re-plotting the roadmap never brings it back.
  if (patch === null && campaign.goalId) {
    const gone = (stage.kind === "window" ? campaign[windowPlanKey(campaign)]?.phases?.find((p) => p.id === stage.id)?.milestones : [])?.find((x) => x.id === milestoneId);
    const g = gone && !gone.custom ? getGoal(campaign.brandId, campaign.goalId) : null;
    if (g) updateGoal(campaign.brandId, g.id, { inputs: { ...(g.inputs || {}), removedMilestones: [...new Set([...(g.inputs?.removedMilestones || []), gone.label])] } });
  }
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

function openMoreMenu(btn, { brandId, brand, campaign, stage, stages, ctx, refresh, state, guided, openEdit }) {
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
    <button data-act="edit">${icon("edit", { size: 14 })}${t("common.edit")}</button>
    <button data-act="pdf">${icon("download", { size: 14 })}${t("share.report.button")}</button>
    <div class="menu-divider"></div>
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
    if (act === "edit") {
      openEdit?.();
      return;
    } else if (act === "pdf") {
      openCampaignReport({ brand, campaign, stages, ctx });
      return;
    } else if (act === "add-check" || act === "add-number") {
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

