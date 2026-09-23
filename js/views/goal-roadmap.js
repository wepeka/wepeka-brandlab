// Roadmap ke Tujuan — the screens. #/brand/:id/goals is the list (and where a
// new goal starts), #/brand/:id/goals/:goalId is one goal's roadmap: lanes on
// a timeline, week-by-week slots and deadlines, what the system read from the
// brand, and the one button that installs it all ("Pasang ke kalender").
// Planning is js/goal-roadmap.js, writing is js/goal-actions.js, "how is it
// going" is js/goal-progress.js — this file only draws and wires.
import {
  getBrand, listGoals, getGoal, createGoal, updateGoal, deleteGoal, listContent, listCampaigns, getSettings, onChange,
  localISODate, daysBetween, formatEventDate, phaseNameLabel, eventLeanLevel, milestoneLabel, unitLabel, EVENT_ROLES, EVENT_PARTICIPATION_TYPES,
} from "../store.js";
import { readCondition, addDays, weekStart, isISODate, AUDIENCE_PER_SEAT } from "../goal-roadmap.js";
import { planForGoal, installGoal, previewReplan, applyReplan, removeGoalMilestone, restoreGoalMilestones } from "../goal-actions.js";
import { goalProgress, relDate } from "../goal-progress.js";
import { backLinkHTML } from "../back-link.js";
import { go } from "../nav-context.js";
import { getMode } from "../mode.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay, confirmDialog } from "../modals.js";
import { qs, qsa, escapeHtml as esc, toast, openMenu, closeMenu, formatNumber } from "../dom.js";
import { t } from "../i18n.js";

const LANE_COLOR = { event: "var(--accent)", audience: "var(--track-social)", community: "var(--track-community)", rhythm: "var(--text-faint)" };
const laneColor = (id) => LANE_COLOR[id] || "var(--text-faint)";
const digits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const toNum = (v) => (digits(v) === "" ? null : Number(digits(v)));
const withYear = (d) => `${formatEventDate(d)} ${String(d).slice(0, 4)}`;
const weekdayShort = (d) => t(`roadmap.dow.${new Date(`${d}T00:00:00`).getDay()}`);
const dayRange = (from) => `${formatEventDate(from)}–${formatEventDate(addDays(from, 6))}`;

// ============================================================
// Route
// ============================================================

export function render(root, { brandId, goalId = null }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  const state = { openWeeks: null };
  const refresh = () => (goalId ? paintDetail(root, brandId, goalId, state, refresh) : paintList(root, brandId, refresh));
  refresh();
  // Installing writes dozens of docs in one tick; coalesce the repaints.
  let timer = null;
  const off = onChange(() => { clearTimeout(timer); timer = setTimeout(refresh, 60); });
  return () => { clearTimeout(timer); off?.(); };
}

// ============================================================
// List
// ============================================================

const statusPill = (s) => `<span class="rg-pill rg-pill-${s}">${esc(t(`roadmap.status.${s}`))}</span>`;

function paintList(root, brandId, refresh) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const goals = listGoals(brandId);
  const archived = listGoals(brandId, { includeArchived: true }).filter((g) => g.status === "archived");
  const content = listContent(brandId);
  const campaigns = listCampaigns(brandId);
  const canAdd = !(getMode() === "guided" && goals.some((g) => g.status !== "completed"));
  const today = localISODate();

  const card = (g) => {
    const days = g.targetDate ? daysBetween(today, g.targetDate) : null;
    const pr = g.roadmap && g.status !== "draft" ? goalProgress({ goal: g, brand, content, campaigns, settings: getSettings(), today }) : null;
    const meta = [
      g.targetDate ? withYear(g.targetDate) : "",
      days === null ? "" : days > 0 ? t("roadmap.days.left", { n: days }) : days === 0 ? t("roadmap.days.today") : t("roadmap.days.passed"),
      g.roadmap?.lanes?.length ? t("roadmap.list.lanes", { n: g.roadmap.lanes.length }) : "",
    ].filter(Boolean).join(" · ");
    return `
      <a class="rg-goal-card" href="#/brand/${brandId}/goals/${g.id}">
        <div class="rg-goal-top"><b>${esc(g.name || t("roadmap.defaultName"))}</b>${statusPill(g.status)}</div>
        <div class="rg-goal-meta">${esc(meta)}</div>
        ${pr ? `<div class="rg-mini-bar" aria-hidden="true">${miniBar(pr.counts)}</div><div class="rg-goal-foot">${esc(t("roadmap.list.onTrack", { ok: pr.onTrack, total: pr.lanesActive }))}${pr.counts.overdue ? ` · <span class="rg-bad">${esc(t("roadmap.list.overdue", { n: pr.counts.overdue }))}</span>` : ""}</div>` : ""}
      </a>`;
  };

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${backLinkHTML(`#/brand/${brandId}/campaigns`, t("nav.campaigns"))}</div>
        <h1>${t("roadmap.title")}</h1>
        <p class="page-sub">${t("roadmap.sub")}</p>
      </div>
      <button class="btn btn-primary" id="rg-new" ${canAdd ? "" : "disabled"} title="${canAdd ? "" : esc(t("roadmap.guidedOne"))}">${icon("plus", { size: 16 })}${t("roadmap.new")}</button>
    </div>
    ${!canAdd ? `<p class="rg-note">${icon("info", { size: 13 })}${t("roadmap.guidedOne")}</p>` : ""}
    ${goals.length
      ? `<div class="rg-goal-grid">${goals.map(card).join("")}</div>`
      : `<div class="card rg-empty">
          <h3>${t("roadmap.empty.title")}</h3>
          <p>${t("roadmap.empty.body")}</p>
          <ol class="rg-empty-steps">${[1, 2, 3, 4].map((n) => `<li>${t(`roadmap.empty.step${n}`)}</li>`).join("")}</ol>
          <button class="btn btn-primary" id="rg-new-2">${icon("plus", { size: 16 })}${t("roadmap.new")}</button>
        </div>`}
    ${archived.length ? `<details class="rg-archived"><summary>${t("roadmap.list.archived", { n: archived.length })}</summary><div class="rg-goal-grid">${archived.map(card).join("")}</div></details>` : ""}
  `;
  qsa("#rg-new, #rg-new-2", root).forEach((b) => b.addEventListener("click", () => openGoalWizard({ brandId })));
}

function miniBar(c) {
  const total = Math.max(1, c.total);
  const seg = (n, cls) => (n ? `<i class="${cls}" style="width:${(n / total) * 100}%"></i>` : "");
  return seg(c.done, "is-done") + seg(c.soon, "is-soon") + seg(c.overdue, "is-overdue") + seg(c.later, "is-later");
}

// ============================================================
// Wizard: 1 the goal · 2 what the system read → then the roadmap page
// ============================================================

export function openGoalWizard({ brandId }) {
  const brand = getBrand(brandId);
  if (!brand) return;
  const goals = listGoals(brandId);
  if (getMode() === "guided" && goals.some((g) => g.status !== "completed")) {
    toast(t("roadmap.guidedOne"));
    return;
  }
  const today = localISODate();
  const st = {
    step: 1, name: "", date: "", role: "organizer", ptype: "", seats: null, location: "", ticketed: null, price: null,
    followers: "", members: "", capacity: "", error: "",
  };
  const overlay = openModal({ title: t("roadmap.wizard.title"), wide: true, bodyHTML: `<div class="rg-wizard"></div>` });
  const root = qs(".rg-wizard", overlay);

  const inputs = () => ({
    eventName: st.name.trim(), role: st.role, participationType: st.ptype, expectedAudience: st.seats, location: st.location.trim(),
    ticketed: st.ticketed, ticketPrice: st.price, followers: st.followers === "" ? null : toNum(st.followers), followersAt: st.followers === "" ? null : Date.now(), members: st.members === "" ? null : toNum(st.members),
    capacityPerWeek: st.capacity === "" ? null : toNum(st.capacity),
    objectives: [],
  });
  const dots = () => `<div class="copy-steps">${[1, 2].map((n) => `<span class="copy-step-dot ${n === st.step ? "is-current" : n < st.step ? "is-done" : ""}"></span>`).join("")}<span class="copy-step-label">${t("roadmap.wizard.step", { n: st.step, total: 2 })}</span>${st.step > 1 ? `<button type="button" class="btn btn-ghost btn-sm copy-back" id="rw-back">${icon("chevronLeft", { size: 13 })}${t("common.back")}</button>` : ""}</div>`;
  const err = () => (st.error ? `<p class="ev-error">${esc(st.error)}</p>` : "");
  const numField = (id, label, val, { hint = "", ph = "0" } = {}) => `
    <div class="field"><label for="${id}">${label}</label>
      <input class="input" id="${id}" inputmode="numeric" autocomplete="off" value="${val === null || val === undefined || val === "" ? "" : formatNumber(val)}" placeholder="${esc(ph)}" />
      ${hint ? `<p class="ev-field-hint">${hint}</p>` : ""}</div>`;

  function step1() {
    const minDate = addDays(today, 1);
    return `
      ${dots()}
      <h3 class="copy-q">${t("roadmap.wizard.q1")}</h3>
      <div class="field"><label for="rw-name">${t("roadmap.wizard.name")}</label><input class="input" id="rw-name" maxlength="80" autocomplete="off" value="${esc(st.name)}" placeholder="${esc(t("roadmap.wizard.namePh"))}" /></div>
      <div class="field"><label for="rw-date">${t("roadmap.wizard.date")}</label><input class="input" id="rw-date" type="date" min="${minDate}" value="${esc(st.date)}" />
        <p class="ev-field-hint" id="rw-date-hint">${dateHint()}</p></div>
      <div class="field"><label>${t("roadmap.wizard.role")}</label>
        <div class="chip-select" id="rw-role">${EVENT_ROLES.map((r) => `<button type="button" data-val="${r.id}" class="${st.role === r.id ? "active" : ""}" title="${esc(r.description)}">${esc(r.label)}</button>`).join("")}</div></div>
      ${st.role === "participant" ? `<div class="field"><label for="rw-ptype">${t("roadmap.wizard.ptype")}</label><select class="input" id="rw-ptype">${EVENT_PARTICIPATION_TYPES.map((p) => `<option value="${p.id}" ${st.ptype === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></div>` : ""}
      ${numField("rw-seats", t("roadmap.wizard.seats"), st.seats, { hint: `<span id="rw-scale-hint">${scaleHint(st.seats)}</span>`, ph: "150" })}
      <div class="field"><label for="rw-loc">${t("roadmap.wizard.location")} <span class="copy-optional">${t("goal.sales.optional")}</span></label><input class="input" id="rw-loc" maxlength="80" autocomplete="off" value="${esc(st.location)}" /></div>
      <div class="field"><label>${t("roadmap.wizard.ticketed")}</label>
        <div class="chip-select" id="rw-ticketed"><button type="button" data-val="yes" class="${st.ticketed === true ? "active" : ""}">${t("roadmap.wizard.ticketYes")}</button><button type="button" data-val="no" class="${st.ticketed === false ? "active" : ""}">${t("roadmap.wizard.ticketNo")}</button></div></div>
      ${st.ticketed ? numField("rw-price", t("roadmap.wizard.price"), st.price, { ph: "Rp" }) : ""}
      ${err()}
      <button type="button" class="btn btn-primary btn-block" id="rw-next">${t("camp.next")}${icon("arrowRight", { size: 14 })}</button>`;
  }
  function scaleHint(seats) {
    if (!seats) return t("roadmap.wizard.seatsHint");
    const lvl = eventLeanLevel(seats, null);
    return `<b>${t(`roadmap.scale.${lvl}`)}</b> — ${t(`roadmap.scale.${lvl}.sub`)}`;
  }
  function dateHint() {
    if (!isISODate(st.date)) return t("roadmap.wizard.dateHint");
    const d = daysBetween(today, st.date);
    if (d <= 0) return `<span class="rg-bad">${t("roadmap.err.pastDate")}</span>`;
    if (d < 14) return `<span class="rg-warn">${t("roadmap.warn.tooShort", { days: d })}</span>`;
    return t("roadmap.wizard.dateOk", { n: d, weeks: Math.round(d / 7) });
  }

  function step2() {
    const cond = readCondition({ brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings(), today, inputs: inputs() });
    const rows = cond.rows.map((r) => condRowHTML(r)).join("");
    const needFollowers = cond.followers === null;
    return `
      ${dots()}
      <h3 class="copy-q">${t("roadmap.wizard.q2")}</h3>
      <p class="text-muted" style="font-size:13px;margin:-6px 0 14px;">${t("roadmap.wizard.q2Sub")}</p>
      <div class="rg-cond">${rows}</div>
      <div class="rg-cond-fields">
        ${numField("rw-followers", t("roadmap.wizard.followers", { platform: cond.platform }), st.followers, { hint: needFollowers ? `<span class="rg-warn">${t("roadmap.wizard.followersNeed")}</span>` : t("roadmap.wizard.followersHint"), ph: cond.followers !== null ? formatNumber(cond.followers) : "0" })}
        ${cond.community.campaignId ? "" : numField("rw-members", t("roadmap.wizard.members"), st.members, { hint: t("roadmap.wizard.membersHint"), ph: "0" })}
        ${numField("rw-capacity", t("roadmap.wizard.capacity"), st.capacity, { hint: t("roadmap.wizard.capacityHint", { src: t(`roadmap.read.rhythm.src.${cond.capacity.source}`, { n: cond.capacity.realized !== null ? Math.round(cond.capacity.realized * 10) / 10 : "" }) }), ph: String(cond.capacity.perWeek) })}
      </div>
      ${err()}
      <button type="button" class="btn btn-primary btn-block" id="rw-create">${icon("target", { size: 15 })}${t("roadmap.wizard.create")}</button>`;
  }

  function paint() {
    root.innerHTML = st.step === 1 ? step1() : step2();
    wire();
  }
  function keepFields() {
    if (st.step === 1) {
      st.name = qs("#rw-name", root)?.value ?? st.name;
      st.date = qs("#rw-date", root)?.value ?? st.date;
      st.seats = toNum(qs("#rw-seats", root)?.value);
      st.location = qs("#rw-loc", root)?.value ?? st.location;
      st.price = toNum(qs("#rw-price", root)?.value);
      st.ptype = qs("#rw-ptype", root)?.value ?? st.ptype;
    } else {
      st.followers = digits(qs("#rw-followers", root)?.value);
      st.members = digits(qs("#rw-members", root)?.value ?? st.members);
      st.capacity = digits(qs("#rw-capacity", root)?.value);
    }
  }
  function wire() {
    qsa("[data-val]", qs("#rw-role", root) || root).forEach((b) => b.addEventListener("click", () => {
      if (!b.closest("#rw-role")) return;
      keepFields(); st.role = b.dataset.val; if (st.role === "participant" && !st.ptype) st.ptype = EVENT_PARTICIPATION_TYPES[0].id; paint();
    }));
    qsa("#rw-ticketed [data-val]", root).forEach((b) => b.addEventListener("click", () => { keepFields(); st.ticketed = b.dataset.val === "yes"; paint(); }));
    qs("#rw-seats", root)?.addEventListener("input", () => { const h = qs("#rw-scale-hint", root); if (h) h.innerHTML = scaleHint(toNum(qs("#rw-seats", root).value)); });
    qs("#rw-date", root)?.addEventListener("input", () => { st.date = qs("#rw-date", root).value; const h = qs("#rw-date-hint", root); if (h) h.innerHTML = dateHint(); });
    qsa("input[inputmode=numeric]", root).forEach((inp) => inp.addEventListener("input", () => {
      const d = digits(inp.value);
      inp.value = d === "" ? "" : formatNumber(Number(d));
    }));
    qs("#rw-back", root)?.addEventListener("click", () => { keepFields(); st.error = ""; st.step = 1; paint(); });
    qs("#rw-next", root)?.addEventListener("click", () => {
      keepFields();
      if (!isISODate(st.date)) st.error = t("roadmap.err.noDate");
      else if (st.date <= today) st.error = t("roadmap.err.pastDate");
      else if (!st.seats) st.error = t("roadmap.err.noSeats");
      else if (st.ticketed === null) st.error = t("roadmap.err.noTicket");
      else { st.error = ""; st.step = 2; }
      paint();
    });
    qs("#rw-create", root)?.addEventListener("click", () => {
      keepFields();
      const cond = readCondition({ brand, content: listContent(brandId), campaigns: listCampaigns(brandId), settings: getSettings(), today, inputs: inputs() });
      if (cond.followers === null) { st.error = t("roadmap.wizard.followersNeed"); paint(); return; }
      const name = st.name.trim() || t("roadmap.defaultName");
      const goal = createGoal(brandId, { name, targetDate: st.date, startDate: today, status: "draft", inputs: { ...inputs(), eventName: name } });
      if (!goal) { st.error = t("roadmap.err.generic"); paint(); return; }
      const plan = planForGoal(brandId, goal);
      updateGoal(brandId, goal.id, { roadmap: plan });
      closeOverlay(overlay);
      location.hash = `#/brand/${brandId}/goals/${goal.id}`;
    });
  }
  paint();
}

function condRowHTML(r) {
  const label = t(`roadmap.read.${r.key}.label`);
  const eff = t(`roadmap.read.${r.key}.effect.${r.status}`, { n: AUDIENCE_PER_SEAT });
  return `
    <div class="rg-cond-row">
      <div class="rg-cond-main"><b>${esc(label)}</b><span class="rg-cond-src">${esc(r.source || "")}</span></div>
      <div class="rg-cond-val">${esc(r.value)}</div>
      <div class="rg-cond-eff">${esc(eff)}</div>
      <span class="rg-pill rg-pill-${r.status}">${esc(t(`roadmap.read.status.${r.status}`))}</span>
    </div>`;
}

// ============================================================
// Detail
// ============================================================

function warnHTML(w) {
  const vars = { ...w.vars };
  if (vars.date) vars.date = formatEventDate(vars.date);
  ["need", "fit", "target", "needed", "seats", "followers", "suggest"].forEach((k) => { if (typeof vars[k] === "number") vars[k] = formatNumber(vars[k]); });
  return t(`roadmap.warn.${w.code}`, vars);
}

function paintDetail(root, brandId, goalId, state, refresh) {
  const brand = getBrand(brandId);
  const goal = getGoal(brandId, goalId);
  if (!brand) { location.hash = "#/"; return; }
  if (!goal) { location.hash = `#/brand/${brandId}/goals`; return; }
  const today = localISODate();
  const content = listContent(brandId);
  const campaigns = listCampaigns(brandId);
  const plan = goal.roadmap;
  if (!plan) {
    root.innerHTML = `<div class="card rg-empty"><p>${t("roadmap.noPlan")}</p><button class="btn btn-primary" id="rg-replan-first">${t("roadmap.replan.cta")}</button></div>`;
    qs("#rg-replan-first", root)?.addEventListener("click", () => { const p = planForGoal(brandId, goal); updateGoal(brandId, goalId, { roadmap: p }); });
    return;
  }
  if (plan.errors?.length) {
    root.innerHTML = `<div class="page-head"><div><div class="page-eyebrow">${backLinkHTML(`#/brand/${brandId}/goals`, t("roadmap.title"))}</div><h1>${esc(goal.name)}</h1></div></div>
      <div class="card rg-empty"><p class="rg-bad">${esc(t(`roadmap.err.${plan.errors[0]}`))}</p><button class="btn btn-primary" id="rg-replan">${t("roadmap.replan.cta")}</button></div>`;
    qs("#rg-replan", root)?.addEventListener("click", () => openReplanDialog({ brandId, goal }));
    return;
  }
  const live = goal.status === "active" || goal.status === "completed";
  const installable = goal.status === "draft" || goal.status === "partial";
  const pr = goalProgress({ goal, brand, content, campaigns, settings: getSettings(), today });
  const days = daysBetween(today, goal.targetDate);
  const warns = (plan.warnings || []).filter((w) => w.level === "warn");
  const infos = (plan.warnings || []).filter((w) => w.level === "info");
  const cap = plan.capacity || {};

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${backLinkHTML(`#/brand/${brandId}/goals`, t("roadmap.title"))}</div>
        <h1>${esc(goal.name || t("roadmap.defaultName"))}</h1>
        <p class="page-sub">${esc(withYear(goal.targetDate))} · ${days > 0 ? t("roadmap.days.left", { n: days }) : days === 0 ? t("roadmap.days.today") : t("roadmap.days.passed")} ${statusPill(goal.status)} <span class="rg-pill" title="${esc(t(`roadmap.scale.${plan.scale?.level ?? 0}.sub`))}">${esc(t(`roadmap.scale.${plan.scale?.level ?? 0}`))}</span></p>
      </div>
      <div class="flex gap-8">
        <button class="btn btn-secondary" id="rg-chat">${icon("chat", { size: 15 })}${t("roadmap.chat")}</button>
        <button class="btn btn-secondary" id="rg-replan">${icon("refresh", { size: 15 })}${t("roadmap.replan.cta")}</button>
        <button class="icon-btn" id="rg-more" aria-label="${t("common.more")}">${icon("dots", { size: 16 })}</button>
      </div>
    </div>

    ${installable ? installBannerHTML(goal, plan) : ""}
    ${pr.needsRefresh ? `<div class="rg-callout rg-callout-info">${icon("info", { size: 14 })}<div><b>${t("roadmap.refresh.title")}</b> ${t("roadmap.refresh.body")}<div class="rg-callout-actions"><button class="btn btn-secondary btn-sm" id="rg-refresh">${t("roadmap.replan.cta")}</button></div></div></div>` : ""}
    ${warns.map((w) => `<div class="rg-callout rg-callout-warn">${icon("info", { size: 14 })}<div>${esc(warnHTML(w))}${w.code === "capacityConflict" ? conflictActionsHTML(plan) : ""}${w.code === "staleFollowers" ? `<div class="rg-callout-actions"><button type="button" class="btn btn-secondary btn-sm" data-rg-insights>${t("roadmap.updateFollowers")}</button></div>` : ""}</div></div>`).join("")}

    <div class="rg-tiles">
      <div class="rg-tile"><div class="rg-eyebrow">${t("roadmap.tile.ready")}</div>
        <div class="rg-ready-bar" aria-hidden="true">${miniBar(pr.counts)}</div>
        <div class="rg-legend">${legendHTML(pr.counts)}</div></div>
      <div class="rg-tile"><div class="rg-eyebrow">${t("roadmap.tile.lanes")}</div>
        <div class="rg-big">${pr.onTrack}<small> / ${pr.lanesActive}</small></div>
        <p class="rg-tile-sub">${live ? t("roadmap.tile.lanesSub") : t("roadmap.tile.lanesDraft")}</p></div>
      <div class="rg-tile"><div class="rg-eyebrow">${t("roadmap.tile.rhythm")}</div>
        <div class="rg-big">${plan.summary?.slots ?? 0}<small> ${t("roadmap.tile.slots")}</small></div>
        <p class="rg-tile-sub">${t("roadmap.tile.rhythmSub", { cap: cap.perWeek, avg: plan.summary?.perWeekAvg ?? 0 })} ${plan.summary?.fits ? `<span class="rg-pill rg-pill-ok">${t("roadmap.fits")}</span>` : `<span class="rg-pill rg-pill-warn">${t("roadmap.notFits")}</span>`}</p></div>
    </div>

    ${live && (pr.week.length || pr.weekSlots.total) ? weekBriefHTML(brandId, pr, today) : ""}

    <section class="card glass-card rg-section">
      <div class="rg-section-head"><h2>${t("roadmap.timeline.title")}</h2><span class="text-faint" style="font-size:12px;">${t("roadmap.timeline.sub")}</span></div>
      ${timelineHTML(goal, plan, pr, today)}
      <div class="rg-tl-legend">
        <span><i class="rg-dot"></i>${t("roadmap.legend.deadline")}</span><span><i class="rg-dot is-done"></i>${t("roadmap.legend.done")}</span><span><i class="rg-dot is-overdue"></i>${t("roadmap.legend.overdue")}</span>
        <span><i class="rg-tick"></i>${t("roadmap.legend.slot")}</span><span><i class="rg-hline"></i>${t("roadmap.legend.hday")}</span>
      </div>
    </section>

    ${milestonesSectionHTML(goal, plan, state)}

    <section class="card glass-card rg-section">
      <div class="rg-section-head"><h2>${t("roadmap.weeks.title")}</h2><span class="text-faint" style="font-size:12px;">${t("roadmap.weeks.sub")}</span></div>
      ${weeksHTML(brandId, goal, plan, pr, today)}
    </section>

    <section class="card glass-card rg-section">
      <div class="rg-section-head"><h2>${t("roadmap.read.title")}</h2><span class="text-faint" style="font-size:12px;">${t("roadmap.read.sub")}</span></div>
      <div class="rg-cond">${(plan.condition || []).map(condRowHTML).join("")}</div>
      ${infos.length ? `<ul class="rg-infos">${infos.map((w) => `<li>${esc(warnHTML(w))}</li>`).join("")}</ul>` : ""}
    </section>
  `;

  // ---- wiring
  qs("#rg-chat", root)?.addEventListener("click", () => go(`#/brand/${brandId}/brainstorm`, { fromLabel: goal.name, goalId: goal.id, mode: "chat", seed: t("roadmap.chat.seed", { name: goal.name || t("roadmap.defaultName") }) }));
  qsa("#rg-replan, #rg-refresh", root).forEach((b) => b.addEventListener("click", () => openReplanDialog({ brandId, goal })));
  qsa("[data-rg-push]", root).forEach((b) => b.addEventListener("click", () => openReplanDialog({ brandId, goal, preset: { pushPerWeek: Number(b.dataset.rgPush) } })));
  qs("#rg-cap", root)?.addEventListener("click", () => openReplanDialog({ brandId, goal }));
  qsa("[data-rg-insights]", root).forEach((b) => b.addEventListener("click", async (e) => {
    e.preventDefault();
    const { openInsightsModal } = await import("./insights-modal.js");
    openInsightsModal({ brandId, platform: goal.roadmap?.audience?.platform || "instagram", reason: t("roadmap.insightsReason"), onSaved: () => { toast(t("roadmap.insightsSaved")); refresh(); } });
  }));
  qs(".rg-ms", root)?.addEventListener("toggle", (e) => { state.msOpen = e.target.open; });
  qsa("[data-rg-ms-remove]", root).forEach((b) => b.addEventListener("click", async () => {
    const label = b.dataset.rgMsRemove;
    if (goal.status !== "draft") {
      const ok = await confirmDialog({ title: t("roadmap.ms.removeTitle"), message: t("roadmap.ms.removeMsg", { name: label }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
    }
    const res = removeGoalMilestone(brandId, goalId, label);
    if (res.ok) toast(res.replanned ? t("roadmap.ms.removedDraft") : t("roadmap.ms.removedLive"));
    refresh();
  }));
  qsa("[data-rg-ms-restore]", root).forEach((b) => b.addEventListener("click", () => {
    const res = restoreGoalMilestones(brandId, goalId, b.dataset.rgMsRestore === "*" ? null : [b.dataset.rgMsRestore]);
    if (res.ok && !res.replanned) openReplanDialog({ brandId, goal: getGoal(brandId, goalId) });
    refresh();
  }));
  qs("#rg-install", root)?.addEventListener("click", () => confirmInstall(brandId, goal, plan, refresh));
  qs("#rg-more", root)?.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menu = openMenu(e.currentTarget, { top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 240) });
    if (!menu) return;
    menu.innerHTML = `
      ${goal.status === "active" ? `<button data-act="complete">${icon("check", { size: 15 })}${t("roadmap.menu.complete")}</button>` : ""}
      <button data-act="archive">${icon("archive", { size: 15 })}${t("roadmap.menu.archive")}</button>
      <button data-act="delete">${icon("trash", { size: 15 })}${t("roadmap.menu.delete")}</button>`;
    menu.addEventListener("click", async (ev) => {
      const act = ev.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      closeMenu();
      if (act === "complete") { updateGoal(brandId, goalId, { status: "completed" }); toast(t("roadmap.menu.completed")); }
      else if (act === "archive") { updateGoal(brandId, goalId, { status: "archived" }); location.hash = `#/brand/${brandId}/goals`; }
      else if (act === "delete") {
        const ok = await confirmDialog({ title: t("roadmap.menu.deleteTitle"), message: t("roadmap.menu.deleteMsg"), confirmLabel: t("common.delete"), danger: true });
        if (ok) { deleteGoal(brandId, goalId); location.hash = `#/brand/${brandId}/goals`; }
      }
    });
  });
  qsa("[data-rg-task]", root).forEach((cb) => cb.addEventListener("change", () => {
    const g = getGoal(brandId, goalId);
    updateGoal(brandId, goalId, { tasks: (g.tasks || []).map((tk) => (tk.id === cb.dataset.rgTask ? { ...tk, done: cb.checked } : tk)) });
  }));
  qsa("[data-rg-week]", root).forEach((d) => d.addEventListener("toggle", () => {
    state.openWeeks = state.openWeeks || new Set();
    if (d.open) state.openWeeks.add(d.dataset.rgWeek); else state.openWeeks.delete(d.dataset.rgWeek);
  }));
}

// Every milestone the event carries, phase by phase — each one deletable, so a
// small event isn't stuck with tracking it doesn't need. Deleted ones are
// remembered (and listed, with a way back) through every re-plot.
function milestonesSectionHTML(goal, plan, state) {
  const phases = plan.eventPhases || [];
  if (!phases.length) return "";
  const removed = goal.inputs?.removedMilestones || [];
  const total = phases.reduce((a, p) => a + p.milestones.length, 0);
  const row = (m) => {
    const what = m.kind === "check" ? t("roadmap.ms.checklist") : `${m.target ? formatNumber(m.target) : ""} ${m.unit ? esc(unitLabel(m.unit)) : ""}`.trim();
    return `<div class="rg-ms-row"><span class="rg-ms-label">${esc(milestoneLabel(m.label))}${m.required === false ? ` <small class="text-faint">${t("camp.optional")}</small>` : ""}${m.custom ? ` <span class="rg-pill rg-pill-acc">${t("roadmap.ms.mine")}</span>` : ""}</span>
      <span class="rg-ms-what">${what}</span><span class="rg-ms-due">${m.dueDate ? esc(formatEventDate(m.dueDate)) : ""}</span>
      <button type="button" class="icon-btn" data-rg-ms-remove="${esc(m.label)}" aria-label="${esc(t("roadmap.ms.remove"))}" title="${esc(t("roadmap.ms.remove"))}">${icon("trash", { size: 13 })}</button></div>`;
  };
  return `
    <section class="card glass-card rg-section">
      <details class="rg-ms" ${state.msOpen ? "open" : ""}>
        <summary class="rg-section-head"><h2>${t("roadmap.ms.title")} <span class="text-faint" style="font-weight:500;">(${total})</span></h2><span class="text-faint" style="font-size:12px;">${t("roadmap.ms.sub")}</span></summary>
        ${phases.map((p) => `<div class="rg-ms-phase"><div class="rg-ms-phase-head"><b>${esc(phaseNameLabel(p.name))}</b><span class="text-faint">${esc(formatEventDate(p.dateFrom))}–${esc(formatEventDate(p.dateTo))}</span></div>${p.milestones.length ? p.milestones.map(row).join("") : `<p class="text-faint" style="font-size:12.5px;margin:4px 0;">${t("roadmap.ms.emptyPhase")}</p>`}</div>`).join("")}
        ${removed.length ? `<div class="rg-ms-removed"><div class="rg-eyebrow">${t("roadmap.ms.removed", { n: removed.length })}</div>${removed.map((l) => `<button type="button" class="rg-restore" data-rg-ms-restore="${esc(l)}" title="${esc(t("roadmap.ms.restore"))}">${icon("refresh", { size: 11 })}${esc(milestoneLabel(l))}</button>`).join("")}<button type="button" class="btn btn-ghost btn-sm" data-rg-ms-restore="*">${t("roadmap.ms.restoreAll")}</button></div>` : ""}
      </details>
    </section>`;
}

function installBannerHTML(goal, plan) {
  const partial = goal.status === "partial";
  const n = plan.slots.length;
  const blocked = plan.errors?.length;
  return `
    <div class="rg-install ${partial ? "is-partial" : ""}">
      <div><b>${partial ? t("roadmap.install.partialTitle") : t("roadmap.install.title")}</b>
        <p>${partial ? t("roadmap.install.partialBody", { done: Object.keys(goal.installed?.slots || {}).length, total: n }) : t("roadmap.install.body", { lanes: plan.lanes.length, slots: n, deadlines: countDeadlines(plan) })}</p></div>
      <button class="btn btn-primary" id="rg-install" ${blocked ? "disabled" : ""}>${icon("calendar", { size: 15 })}${partial ? t("roadmap.install.resume") : t("roadmap.install.cta")}</button>
    </div>`;
}
const countDeadlines = (plan) => (plan.eventPhases || []).reduce((a, p) => a + (p.milestones || []).filter((m) => m.dueDate).length, 0) + (plan.tasks || []).length;

function conflictActionsHTML(plan) {
  const push = plan.capacity?.suggestPush;
  return `<div class="rg-callout-actions">
    ${push ? `<button class="btn btn-secondary btn-sm" data-rg-push="${push}">${t("roadmap.conflict.push", { n: push })}</button>` : ""}
    <button class="btn btn-secondary btn-sm" id="rg-cap">${t("roadmap.conflict.capacity")}</button>
  </div>`;
}

function legendHTML(c) {
  return [["done", "is-done"], ["soon", "is-soon"], ["overdue", "is-overdue"], ["later", "is-later"]]
    .map(([k, cls]) => `<span><i class="rg-swatch ${cls}"></i>${t(`roadmap.ready.${k}`)} <b class="num">${c[k]}</b></span>`).join("");
}

// ---------- This week ----------
function weekBriefHTML(brandId, pr, today) {
  const rows = pr.week.map((i) => {
    const done = i.state === "done";
    const link = i.kind === "slot" ? `#/brand/${brandId}/content/creator/${i.contentId}` : i.kind === "milestone" ? `#/brand/${brandId}/campaigns/${i.campaignId}` : "";
    const check = i.kind === "task" ? `<input type="checkbox" data-rg-task="${esc(i.taskId)}" ${done ? "checked" : ""} aria-label="${esc(i.label)}" />` : `<span class="rg-box ${done ? "is-done" : ""}"></span>`;
    return `<div class="rg-task rg-task-${i.state}">${check}
      <span class="rg-task-main">${link ? `<a href="${link}">${esc(i.label)}</a>` : esc(i.label)}<small>${esc(t(`roadmap.kind.${i.kind}`))} · ${esc(laneName(pr, i.laneId))}</small></span>
      <span class="rg-task-when ${i.state === "overdue" ? "rg-bad" : ""}">${esc(relDate(i.date, today))}</span><i class="rg-laneline" style="background:${laneColor(i.laneId)}"></i></div>`;
  }).join("");
  const stale = pr.followersStale ? `<div class="rg-task rg-task-overdue"><span class="rg-box"></span><span class="rg-task-main"><a href="#" data-rg-insights>${t("roadmap.updateFollowers")}</a><small>${t("roadmap.followersAge", { n: pr.followersAge })}</small></span><span class="rg-pill rg-pill-warn">${t("roadmap.read.status.warn")}</span><i></i></div>` : "";
  return `
    <section class="card glass-card rg-section">
      <div class="rg-section-head"><h2>${t("roadmap.week.title")}</h2><span class="text-faint" style="font-size:12px;">${t("roadmap.week.sub", { done: pr.weekSlots.done, total: pr.weekSlots.total })}</span></div>
      ${stale}${rows || `<p class="text-faint" style="font-size:13px;">${t("roadmap.week.empty")}</p>`}
    </section>`;
}
const laneName = (pr, id) => pr.lanes.find((l) => l.id === id)?.name || t(`roadmap.lane.${id}`);

// ---------- Timeline (lanes on a date axis) ----------
function timelineHTML(goal, plan, pr, today) {
  const from = plan.start;
  const to = addDays(plan.target, 14);
  const span = Math.max(1, daysBetween(from, to) + 1);
  const pct = (d) => Math.max(0, Math.min(100, (daysBetween(from, d) / span) * 100));
  const width = (a, b) => Math.max(1.2, pct(addDays(b, 1)) - pct(a));
  // month ticks
  const months = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (d === from || d.endsWith("-01")) months.push(d);
  const stateById = new Map(pr.items.map((i) => [i.id, i.state]));
  const dueDots = [];
  (plan.eventPhases || []).forEach((p) => (p.milestones || []).forEach((m) => { if (m.dueDate) dueDots.push({ laneId: "event", date: m.dueDate, label: m.label, state: stateById.get(`ms:${m.id}`) || (m.dueDate < today && !m.done ? "overdue" : m.done ? "done" : "later") }); }));
  (goal.tasks?.length ? goal.tasks : plan.tasks || []).forEach((tk) => dueDots.push({ laneId: tk.laneId, date: tk.dueDate, label: tk.label, state: stateById.get(`task:${tk.id}`) || "later" }));
  const todayIn = today >= from && today <= to;

  const laneRow = (l) => {
    const color = laneColor(l.id);
    const bars = l.id === "event"
      ? (plan.eventPhases || []).map((p, i) => `<div class="rg-bar" style="left:${pct(p.dateFrom)}%;width:${width(p.dateFrom, p.dateTo)}%;background:${color};opacity:${0.5 + Math.min(4, i) * 0.1}" title="${esc(`${p.name} · ${formatEventDate(p.dateFrom)}–${formatEventDate(p.dateTo)}`)}"><span>${esc(phaseNameLabel(p.name))}</span></div>`).join("")
      : `<div class="rg-bar" style="left:${pct(l.startDate)}%;width:${width(l.startDate, l.endDate)}%;background:${color}" title="${esc(`${l.name} · ${formatEventDate(l.startDate)}–${formatEventDate(l.endDate)}`)}"><span>${esc(l.id === "audience" && plan.audience ? t("roadmap.tl.audience", { from: formatNumber(plan.audience.current), to: formatNumber(plan.audience.target) }) : l.name)}</span></div>`;
    const ticks = plan.slots.filter((s) => s.laneId === l.id).map((s) => `<i class="rg-tick" style="left:${pct(s.date)}%;background:${color}" title="${esc(`${formatEventDate(s.date)} · ${s.title}`)}"></i>`).join("");
    const dots = dueDots.filter((d) => d.laneId === l.id).map((d) => `<i class="rg-dot ${d.state === "done" ? "is-done" : d.state === "overdue" ? "is-overdue" : ""}" style="left:${pct(d.date)}%" title="${esc(`${formatEventDate(d.date)} · ${d.label}`)}"></i>`).join("");
    const status = pr.lanes.find((x) => x.id === l.id)?.status;
    return `<div class="rg-lane">
      <div class="rg-lane-name"><i class="rg-lanedot" style="background:${color}"></i><span><b>${esc(l.name)}</b><small>${esc(t(`roadmap.lane.${l.id}.sub`))}${status === "behind" ? ` · <span class="rg-bad">${t("roadmap.lane.behind")}</span>` : ""}</small></span></div>
      <div class="rg-track">${bars}${ticks}${dots}</div></div>`;
  };
  return `
    <div class="rg-tl-scroll"><div class="rg-tl">
      <div class="rg-lane rg-axis"><div></div><div class="rg-track rg-months">${months.map((m) => `<span style="left:${pct(m)}%">${esc(new Date(`${m}T00:00:00`).toLocaleDateString(undefined, { month: "short" }))}</span>`).join("")}</div></div>
      ${plan.lanes.map(laneRow).join("")}
      <div class="rg-overlay-lines" aria-hidden="true"><div class="rg-lane"><div></div><div class="rg-track">
        ${todayIn ? `<i class="rg-today" style="left:${pct(today)}%"><b>${t("roadmap.today")}</b></i>` : ""}
        <i class="rg-hday" style="left:${pct(plan.target)}%"><b>${t("roadmap.hday")}</b></i>
      </div></div></div>
    </div></div>`;
}

// ---------- Week-by-week list ----------
function weeksHTML(brandId, goal, plan, pr, today) {
  const entries = [];
  plan.slots.forEach((s) => entries.push({ kind: "slot", laneId: s.laneId, date: s.date, label: s.title, funnel: s.funnel, id: s.id }));
  const stateById = new Map(pr.items.map((i) => [i.id, i]));
  (plan.eventPhases || []).forEach((p) => (p.milestones || []).forEach((m) => { if (m.dueDate && m.kind === "check") entries.push({ kind: "milestone", laneId: "event", date: m.dueDate, label: m.label, id: `ms:${m.id}` }); }));
  (goal.tasks?.length ? goal.tasks : plan.tasks || []).forEach((tk) => entries.push({ kind: "task", laneId: tk.laneId, date: tk.dueDate, label: tk.label, id: `task:${tk.id}`, taskId: tk.id, done: tk.done }));
  const byWeek = new Map();
  entries.sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => { const w = weekStart(e.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(e); });
  const thisWeek = weekStart(today);
  const open = state_openDefault(byWeek, thisWeek);
  return [...byWeek.entries()].map(([w, list]) => {
    const slotN = list.filter((e) => e.kind === "slot").length;
    const dl = list.length - slotN;
    const isNow = w === thisWeek;
    return `<details class="rg-week ${isNow ? "is-now" : ""}" data-rg-week="${w}" ${open.has(w) ? "open" : ""}>
      <summary><b>${esc(dayRange(w))}</b>${isNow ? `<span class="rg-pill rg-pill-acc">${t("roadmap.thisWeek")}</span>` : ""}<span class="rg-week-sum">${t("roadmap.weeks.sum", { slots: slotN, deadlines: dl })}</span></summary>
      <div class="rg-week-body">${list.map((e) => {
        const live = stateById.get(e.kind === "slot" ? `slot:${e.id}` : e.id);
        const st = live?.state || "later";
        const link = live?.contentId ? `#/brand/${brandId}/content/creator/${live.contentId}` : "";
        const date = live?.date || e.date;
        return `<div class="rg-row rg-row-${e.kind}">
          <span class="rg-row-date"><b>${esc(weekdayShort(date))}</b> ${esc(formatEventDate(date))}</span>
          <i class="rg-lanedot" style="background:${laneColor(e.laneId)}" title="${esc(laneName(pr, e.laneId))}"></i>
          <span class="rg-row-main">${e.kind === "slot" ? `<span class="tag tag-${(e.funnel || "tofu").toLowerCase()}">${esc(e.funnel)}</span>` : `<span class="rg-kind">${esc(t(`roadmap.kind.${e.kind}`))}</span>`}${link ? `<a href="${link}">${esc(live?.label || e.label)}</a>` : esc(e.label)}</span>
          ${st === "done" ? `<span class="rg-pill rg-pill-ok">${t("roadmap.ready.done")}</span>` : st === "overdue" ? `<span class="rg-pill rg-pill-bad">${t("roadmap.ready.overdue")}</span>` : ""}
        </div>`;
      }).join("")}</div></details>`;
  }).join("") || `<p class="text-faint">${t("roadmap.weeks.empty")}</p>`;
}
// The current week and the next one start open; everything else is folded.
function state_openDefault(byWeek, thisWeek) {
  const keys = [...byWeek.keys()];
  const idx = Math.max(0, keys.findIndex((k) => k >= thisWeek));
  return new Set(keys.slice(idx, idx + 2));
}

// ============================================================
// Install / re-plot dialogs
// ============================================================

async function confirmInstall(brandId, goal, plan, refresh) {
  const partial = goal.status === "partial";
  const ok = await confirmDialog({
    title: partial ? t("roadmap.install.resume") : t("roadmap.install.cta"),
    message: t("roadmap.install.confirm", { campaigns: 1 + (plan.audience ? 1 : 0), slots: plan.slots.length, deadlines: countDeadlines(plan) }),
    confirmLabel: partial ? t("roadmap.install.resume") : t("roadmap.install.go"),
  });
  if (!ok) return;
  const res = installGoal(brandId, goal.id);
  if (res.ok) toast(t("roadmap.install.done", { campaigns: res.made.campaigns, slots: res.made.slots }));
  else if (res.error === "partial") toast(t("roadmap.install.partialToast", { done: res.done, total: res.total.slots }), "error");
  else toast(t("roadmap.err.generic"), "error");
  refresh();
}

export function openReplanDialog({ brandId, goal, preset = {} }) {
  const today = localISODate();
  const draft = goal.status === "draft";
  const st = {
    date: goal.targetDate, seats: goal.inputs?.expectedAudience ?? null, capacity: goal.inputs?.capacityPerWeek ?? null,
    push: preset.pushPerWeek ?? goal.inputs?.pushPerWeek ?? null,
  };
  const overlay = openModal({
    title: t("roadmap.replan.title"), wide: true,
    bodyHTML: `
      <p class="text-muted" style="font-size:13px;margin:0 0 14px;">${draft ? t("roadmap.replan.subDraft") : t("roadmap.replan.sub")}</p>
      <div class="rg-replan-fields">
        <div class="field"><label for="rp-date">${t("roadmap.wizard.date")}</label><input class="input" id="rp-date" type="date" min="${addDays(today, 1)}" value="${esc(st.date)}" /></div>
        <div class="field"><label for="rp-seats">${t("roadmap.wizard.seats")}</label><input class="input" id="rp-seats" inputmode="numeric" value="${st.seats ? formatNumber(st.seats) : ""}" /></div>
        <div class="field"><label for="rp-cap">${t("roadmap.replan.capacity")}</label><input class="input" id="rp-cap" inputmode="numeric" value="${st.capacity ? st.capacity : ""}" placeholder="${goal.roadmap?.capacity?.perWeek ?? ""}" /></div>
        <div class="field"><label for="rp-push">${t("roadmap.replan.push")}</label><input class="input" id="rp-push" inputmode="numeric" value="${st.push ? st.push : ""}" placeholder="${goal.roadmap?.capacity?.suggestPush ?? ""}" /><p class="ev-field-hint">${t("roadmap.replan.pushHint")}</p></div>
      </div>
      <div id="rp-diff" class="rg-diff"></div>`,
    footHTML: `<button class="btn btn-secondary" data-cancel>${t("common.cancel")}</button><button class="btn btn-primary" id="rp-apply">${icon("check", { size: 15 })}${t("roadmap.replan.apply")}</button>`,
  });
  let last = null;
  const read = () => {
    st.date = qs("#rp-date", overlay).value;
    st.seats = toNum(qs("#rp-seats", overlay).value);
    st.capacity = toNum(qs("#rp-cap", overlay).value);
    st.push = toNum(qs("#rp-push", overlay).value);
  };
  const over = () => ({ targetDate: st.date, inputs: { expectedAudience: st.seats ?? goal.inputs?.expectedAudience ?? null, capacityPerWeek: st.capacity, pushPerWeek: st.push } });
  const box = qs("#rp-diff", overlay);
  const apply = qs("#rp-apply", overlay);
  function recompute() {
    read();
    const prev = previewReplan(brandId, goal.id, over());
    last = prev;
    if (!prev || prev.errors?.length) {
      box.innerHTML = `<p class="rg-bad">${esc(t(`roadmap.err.${prev?.errors?.[0] || "generic"}`))}</p>`;
      apply.disabled = true;
      return;
    }
    const d = prev.diff;
    const ws = (prev.plan.warnings || []).filter((w) => w.level === "warn");
    const line = (n, key) => (n ? `<li>${esc(t(key, { n }))}</li>` : "");
    const lines = draft ? "" : [
      line(d.moved.length, "roadmap.diff.moved"), line(d.added.length, "roadmap.diff.added"), line(d.removed.length, "roadmap.diff.removed"),
      line(d.dueChanges.length, "roadmap.diff.due"), line(d.kept.filter((k) => k.reason === "touched").length, "roadmap.diff.kept"),
      d.lanesAdded.length ? `<li>${esc(t("roadmap.diff.lanesAdded", { n: d.lanesAdded.length }))}</li>` : "", d.lanesRemoved.length ? `<li>${esc(t("roadmap.diff.lanesRemoved", { n: d.lanesRemoved.length }))}</li>` : "",
    ].join("");
    box.innerHTML = `
      <div class="rg-eyebrow">${t("roadmap.diff.title")}</div>
      ${draft ? `<p style="font-size:13px;">${esc(t("roadmap.diff.draft", { slots: prev.plan.slots.length }))}</p>` : d.empty ? `<p class="text-faint" style="font-size:13px;">${t("roadmap.diff.empty")}</p>` : `<ul class="rg-diff-list">${lines}</ul>`}
      ${ws.map((w) => `<p class="rg-warn" style="font-size:12.5px;">${icon("info", { size: 12 })} ${esc(warnHTML(w))}</p>`).join("")}`;
    apply.disabled = !draft && d.empty && st.date === goal.targetDate;
  }
  ["#rp-date", "#rp-seats", "#rp-cap", "#rp-push"].forEach((sel) => qs(sel, overlay).addEventListener("input", () => { clearTimeout(recompute.t); recompute.t = setTimeout(recompute, 200); }));
  qs("[data-cancel]", overlay).addEventListener("click", () => closeOverlay(overlay));
  apply.addEventListener("click", () => {
    if (!last || last.errors?.length) return;
    if (draft) updateGoal(brandId, goal.id, { targetDate: st.date, inputs: { ...(goal.inputs || {}), ...over().inputs }, roadmap: last.plan });
    else applyReplan(brandId, goal.id, { plan: last.plan, diff: last.diff, over: over() });
    closeOverlay(overlay);
    toast(t("roadmap.replan.done"));
  });
  recompute();
}
