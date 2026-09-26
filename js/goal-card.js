// Roadmap ke Tujuan — the Home card. One glance answers: how close is the
// date, how ready is the brand, and what to do this week. Read-only over
// js/goal-progress.js; the only write is ticking a goal task. Returns the
// widget's pieces so js/views/home.js can wrap them in the same collapsible
// widget shell as its other cards (js/widget-card.js).
import { listGoals, getSettings, formatEventDate, localISODate, phaseNameLabel } from "./store.js";
import { goalProgress, relDate } from "./goal-progress.js";
import { updateGoal, getGoal } from "./store.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, qsa } from "./dom.js";
import { t } from "./i18n.js";

const LANE_COLOR = { event: "var(--accent)", audience: "var(--track-social)", community: "var(--track-community)", rhythm: "var(--text-faint)" };

function barHTML(c) {
  const total = Math.max(1, c.total);
  const seg = (n, cls) => (n ? `<i class="${cls}" style="width:${(n / total) * 100}%"></i>` : "");
  return `<div class="rg-ready-bar" aria-hidden="true">${seg(c.done, "is-done")}${seg(c.soon, "is-soon")}${seg(c.overdue, "is-overdue")}${seg(c.later, "is-later")}</div>`;
}

// input: { brandId, brand, campaigns, content, identityDone }
// → { key, iconName, title, bodyHTML, summary, extraHead } | null
export function goalWidget({ brandId, brand, campaigns, content, identityDone = true }) {
  const today = localISODate();
  const goals = listGoals(brandId).filter((g) => g.status !== "completed");
  const goal = goals.find((g) => g.status === "active" || g.status === "partial") || goals[0] || null;

  if (!goal) {
    // The dated-plan promo waits for the first campaign: before that, Home's
    // hero already asks "Pilih tujuan", and two big "make a plan" cards
    // stacked on top of each other left people unsure which one to press.
    if (!identityDone || !campaigns?.length) return null;
    return {
      key: "goal", iconName: "target", title: t("roadmap.home.promo.title"), summary: t("roadmap.home.promo.summary"), extraHead: "",
      bodyHTML: `<p class="text-muted" style="margin:0 0 12px;font-size:13.5px;">${t("roadmap.home.promo.body")}</p>
        <a class="btn btn-primary btn-sm" href="#/brand/${brandId}/goals" data-rg-promo>${icon("target", { size: 14 })}${t("roadmap.home.promo.cta")}</a>`,
    };
  }

  const draft = goal.status === "draft" || !goal.roadmap;
  const pr = goal.roadmap ? goalProgress({ goal, brand, content, campaigns, settings: getSettings(), today }) : null;
  const days = pr?.daysLeft ?? null;
  const href = `#/brand/${brandId}/goals/${goal.id}`;
  const name = goal.name || t("roadmap.defaultName");
  const meta = [
    goal.targetDate ? `${formatEventDate(goal.targetDate)} ${goal.targetDate.slice(0, 4)}` : "",
    pr?.eventPhaseNow ? t("roadmap.home.phase", { phase: phaseNameLabel(pr.eventPhaseNow.name) }) : "",
    pr && !draft ? t("roadmap.home.lanes", { ok: pr.onTrack, total: pr.lanesActive }) : "",
  ].filter(Boolean).join(" · ");

  const weekRows = pr && !draft
    ? pr.week.filter((i) => i.state !== "done" || i.kind === "task").slice(0, 4).map((i) => {
        const link = i.kind === "slot" ? `#/brand/${brandId}/content/creator/${i.contentId}` : i.kind === "milestone" ? `#/brand/${brandId}/campaigns/${i.campaignId}` : "";
        const check = i.kind === "task"
          ? `<input type="checkbox" data-rg-task="${esc(i.taskId)}" data-rg-goal="${goal.id}" ${i.state === "done" ? "checked" : ""} aria-label="${esc(i.label)}" />`
          : `<span class="rg-box ${i.state === "done" ? "is-done" : ""}"></span>`;
        return `<div class="rg-task rg-task-${i.state}">${check}<span class="rg-task-main">${link ? `<a href="${link}">${esc(i.label)}</a>` : esc(i.label)}<small>${esc(t(`roadmap.kind.${i.kind}`))}</small></span><span class="rg-task-when ${i.state === "overdue" ? "rg-bad" : ""}">${esc(relDate(i.date, today))}</span><i class="rg-laneline" style="background:${LANE_COLOR[i.laneId] || "var(--text-faint)"}"></i></div>`;
      }).join("")
    : "";
  const stale = pr?.followersStale ? `<div class="rg-task rg-task-overdue"><span class="rg-box"></span><span class="rg-task-main"><a href="#" data-rg-insights>${t("roadmap.updateFollowers")}</a><small>${t("roadmap.followersAge", { n: pr.followersAge })}</small></span><span class="rg-pill rg-pill-warn">${t("roadmap.read.status.warn")}</span><i></i></div>` : "";
  const next = pr?.nextDeadline && !weekRows ? `<p class="rg-home-meta">${esc(t("roadmap.home.next", { label: pr.nextDeadline.label, when: relDate(pr.nextDeadline.date, today) }))}</p>` : "";

  const bodyHTML = `
    <div class="rg-home-top">
      <div class="rg-home-days">${days !== null ? Math.max(0, days) : "–"}<small>${t("roadmap.home.daysLeft")}</small></div>
      <div>
        <b>${esc(name)}</b>
        <div class="rg-home-meta">${esc(meta)}</div>
        ${pr && !draft ? barHTML(pr.counts) : `<div class="rg-home-meta">${t("roadmap.home.draft")}</div>`}
      </div>
      <span class="rg-pill rg-pill-${goal.status}">${esc(t(`roadmap.status.${goal.status}`))}</span>
    </div>
    ${pr && !draft ? `<div class="rg-home-week"><h5>${t("roadmap.home.thisWeek")}</h5>${stale}${weekRows || `<p class="text-faint" style="font-size:13px;margin:4px 0;">${t("roadmap.home.nothing")}</p>`}${next}</div>` : ""}
    <div class="rg-home-actions">
      <a class="btn btn-primary btn-sm" href="${href}">${icon("target", { size: 14 })}${t("roadmap.home.open")}</a>
    </div>`;
  return {
    key: "goal", iconName: "target", title: `${t("roadmap.home.title")} · ${esc(name)}`,
    summary: t("roadmap.home.summary", { name: esc(name), days: days !== null ? Math.max(0, days) : "–" }),
    extraHead: goals.length > 1 ? `<a class="link" href="#/brand/${brandId}/goals">${esc(`+${goals.length - 1}`)}</a>` : "",
    bodyHTML,
  };
}

// Ticking a goal task on the Home card.
export function wireGoalCard(root, { brandId }) {
  qsa("[data-rg-insights]", root).forEach((a) => a.addEventListener("click", async (e) => {
    e.preventDefault();
    const { openInsightsModal } = await import("./views/insights-modal.js");
    openInsightsModal({ brandId, reason: t("roadmap.insightsReason") });
  }));
  qsa("[data-rg-task][data-rg-goal]", root).forEach((cb) => cb.addEventListener("change", () => {
    const g = getGoal(brandId, cb.dataset.rgGoal);
    if (!g) return;
    updateGoal(brandId, g.id, { tasks: (g.tasks || []).map((tk) => (tk.id === cb.dataset.rgTask ? { ...tk, done: cb.checked } : tk)) });
  }));
}
