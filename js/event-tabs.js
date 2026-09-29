// One event, one place. An event lives in two stores — its dated plan
// (brand.goals[], js/views/goal-roadmap.js) and the Event campaign that plan
// installs (campaigns/, js/views/campaign-detail.js) — but to the owner it is
// one thing. Both pages carry this same tab strip, so moving between "the
// plan" and "the targets and checklist" is a tab switch on one event, not a
// jump between two sections of the app.
import { listCampaigns, getGoal } from "./store.js";
import { escapeHtml as esc } from "./dom.js";
import { t } from "./i18n.js";

// The campaigns this plan created (not ones it merely borrowed, like an
// existing community campaign), Event campaign first.
export function goalCampaigns(brandId, goal) {
  if (!goal) return [];
  const created = new Set(Object.values(goal.installed?.campaigns || {}).filter((x) => x?.created !== false).map((x) => x.id));
  const eventId = goal.installed?.campaigns?.event?.id || null;
  return listCampaigns(brandId)
    .filter((c) => c.goalId === goal.id && (created.has(c.id) || c.id === eventId))
    .sort((a, b) => Number(b.id === eventId) - Number(a.id === eventId));
}

// The plan an Event campaign belongs to (null for a stand-alone campaign).
export function goalForCampaign(brandId, campaign) {
  return campaign?.goalId ? getGoal(brandId, campaign.goalId) : null;
}

// `active`: "plan" or a campaign id.
export function eventTabsHTML(brandId, goal, active) {
  if (!goal) return "";
  const eventId = goal.installed?.campaigns?.event?.id || null;
  const camps = goalCampaigns(brandId, goal);
  const tab = (href, label, on) => `<a class="tab ${on ? "active" : ""}" href="${href}">${esc(label)}</a>`;
  return `<div class="cos-tabs-wrap ev-tabs" style="margin:-4px 0 20px;">
      <div class="tabs cos-tabs" role="tablist" aria-label="${esc(goal.name || t("roadmap.defaultName"))}">
        ${tab(`#/brand/${brandId}/goals/${goal.id}`, t("evtabs.plan"), active === "plan")}
        ${camps.length
          ? camps.map((c) => tab(`#/brand/${brandId}/campaigns/${c.id}`, c.id === eventId ? t("evtabs.targets") : c.name || t("camp.untitled"), active === c.id)).join("")
          : `<span class="tab is-disabled" title="${esc(t("evtabs.targetsLater"))}" aria-disabled="true">${esc(t("evtabs.targets"))}</span>`}
      </div>
    </div>`;
}
