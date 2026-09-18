// Grow Brand launcher: one flow that deploys up to THREE independent
// campaigns — Social Media Growth, Community Growth and Sales Growth — each
// with its own questions, its own levels, and its own targets.
//   Screen 0 — Select: tick which of the 3 to deploy THIS run (selectStepHTML).
//            Already-running tracks show as a disabled row instead of a
//            checkbox (Social Media Growth is the exception — it can run
//            once per platform, so a brand with an Instagram campaign still
//            sees a tickable "add another platform" row). This replaces an
//            earlier auto-stepping design that silently walked through every
//            not-yet-running track — which meant skipping Sales once and
//            reopening the wizard later kept re-asking for Social Media
//            Growth again, since "not yet running for every platform" was
//            being read as "ask about it". Explicit selection every time
//            fixes that.
//   Then, for each ticked track in order (social → community → sales):
//   Social Media Growth: platform, followers today/target, upload
//            frequency, planning horizon.
//   Community Growth: do you have one yet, members today/target, where it lives.
//   Sales Growth: what you sell (one or more products/services), price,
//            sold so far, target — counted in the unit that fits the
//            business (units / projects / subscribers / students / orders).
//            Everything is typed in by hand and the step says so: there is
//            no sales backend, and nothing here asks about ads (no ROAS /
//            CPC / CPM / ad spend). Can still be skipped mid-flow if it
//            isn't the only track ticked.
//   Finally — the ticked plans previewed side by side, one disclaimer, one
//            button that creates the campaigns together.
import { getBrand, listContent, listCampaigns, createCampaign, getBrandInsights, milestoneLabel, unitLabel, missionText, CAMPAIGN_PHASE_TEMPLATE } from "../store.js";
import {
  GOAL_DURATIONS, COMMUNITY_PLATFORMS, SOCIAL_CHECKPOINTS, assessGoal, suggestCommunityTarget, brandBaseline,
  placeStartSocialLevel, placeStartCommunityLevel, buildSocialGrowthPlan, buildCommunityGrowthPlan,
  SALES_DURATIONS, SALES_MODELS, salesModel, assessSalesGoal, placeStartSalesLevel, buildSalesGrowthPlan,
} from "../goal-plan.js";
import { getTracker, productStats, mergeProductsFromWizard, syncSalesCampaign } from "../sales-tracker.js";
import { icon } from "../icons.js";
import { openModal, closeOverlay } from "../modals.js";
import { toast, formatNumber, qs, qsa, escapeHtml as esc } from "../dom.js";
import { t } from "../i18n.js";

const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook", "other"];
const onlyDigits = (v) => String(v ?? "").replace(/[^\d]/g, "");
const toNum = (v) => (onlyDigits(v) === "" ? null : Number(onlyDigits(v)));
const newProduct = () => ({ id: `p-${Math.random().toString(36).slice(2, 8)}`, name: "", price: null, sold: null, target: null, cost: null });

export function openGoalWizard({ brandId, brand, onSaved }) {
  const running = listCampaigns(brandId).filter((c) => c.goalPlan?.version === 3 && !["archived", "completed"].includes(c.status));
  // Social Media Growth is the one track that can run more than once at a
  // time — one per platform (Instagram + TikTok side by side, say). Every
  // other track (community, sales) still runs at most one campaign.
  const socialCampaigns = running.filter((c) => c.goalPlan.track === "social");
  const socialTaken = new Set(socialCampaigns.map((c) => c.goalPlan.platform || "instagram"));
  const socialAvailable = SOCIAL_PLATFORMS.some((p) => !socialTaken.has(p));
  const oldestSocialRunning = socialCampaigns.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
  const communityRunning = running.find((c) => c.goalPlan.track === "community") || null;
  const salesRunning = running.find((c) => c.goalPlan.track === "sales") || null;
  if (!socialAvailable && communityRunning && salesRunning) {
    toast(t("goal.launch.alreadyBoth"));
    return;
  }

  const cad = brand?.contentCadence;
  const cadenceUploads = cad?.configured && cad.uploadDays?.length ? cad.uploadDays.length * (Number(cad.perDay) || 1) : null;
  const insightsFollowers = getBrandInsights(brand, "instagram")?.followers ?? null;
  const content = listContent(brandId);
  const baseline = brandBaseline(content);

  // Sales Tracker's product list is the same list this step edits: what's
  // already there pre-fills the step (with its tracked "sold" total, which
  // stays read-only here), and whatever is typed here lands back in the
  // tracker on deploy.
  const tracker = getTracker(getBrand(brandId) || brand);
  const trackedProducts = productStats(tracker).filter((s) => !s.product.archived).map((s) => ({ id: s.product.id, name: s.product.name, price: s.product.price || null, cost: s.product.cost ?? null, sold: s.sold, target: null, fromTracker: true }));

  const state = {
    // "select" — pick which of the 3 to deploy; "wizard" — walk the
    // per-track questions for what was picked (state.order).
    phase: "select",
    selected: {
      // Pre-ticked only for tracks that have never been launched at all —
      // an already-running Social Media Growth campaign (on some platform)
      // starts UNticked, so reopening the wizard doesn't silently re-offer
      // it; the user explicitly ticks it again to add another platform.
      social: socialAvailable && socialCampaigns.length === 0,
      community: !communityRunning,
      sales: !salesRunning,
    },
    order: [],
    stepIdx: 0,
    platform: SOCIAL_PLATFORMS.find((p) => !socialTaken.has(p)) || SOCIAL_PLATFORMS[0], followers: insightsFollowers, followersTarget: null, uploadsPerWeek: cadenceUploads || 3,
    months: 12,
    hasExisting: null, members: null, membersTarget: null, platformWhere: new Set(),
    salesSkipped: false, salesModel: tracker.model, products: trackedProducts.length ? trackedProducts : [newProduct()], salesMonths: 6,
    monthlySales: null, revenueNow: null, revenueTarget: null, salesMoreOpen: false,
    agreed: false, error: "",
    name: "",
  };
  const overlay = openModal({ title: t("goal.launch.title"), wide: true, bodyHTML: `<div class="ev-wizard goal-wizard"></div>` });
  const root = qs(".goal-wizard", overlay);
  const stepKind = () => state.order[state.stepIdx];
  // Sales can be skipped mid-flow ("I don't sell anything yet") — but only
  // when that still leaves another ticked track to deploy.
  const salesSkippable = () => state.order.length > 2;

  const progress = () => `
    <div class="copy-steps">
      ${state.order.map((_, n) => `<span class="copy-step-dot ${n === state.stepIdx ? "is-current" : n < state.stepIdx ? "is-done" : ""}"></span>`).join("")}
      <span class="copy-step-label">${t("goal.launch.step", { n: state.stepIdx + 1, total: state.order.length })}</span>
      <button type="button" class="btn btn-ghost btn-sm copy-back" data-goal-back>${icon("chevronLeft", { size: 13 })}${t("common.back")}</button>
    </div>`;
  const numberField = (id, label, value, { hint = "", placeholder = "0" } = {}) => `
    <div class="field">
      <label for="${id}">${label}</label>
      <input class="input" id="${id}" inputmode="numeric" autocomplete="off" value="${value === null || value === undefined ? "" : formatNumber(value)}" placeholder="${esc(placeholder)}" />
      ${hint ? `<p class="ev-field-hint">${hint}</p>` : ""}
    </div>`;
  const nextBtn = (label = t("camp.next")) => `${state.error ? `<p class="ev-error">${esc(state.error)}</p>` : ""}<button type="button" class="btn btn-primary btn-block" data-goal-next>${label}${icon("arrowRight", { size: 14 })}</button>`;

  function assessmentHTML(current, target) {
    const a = assessGoal({ current, target, months: state.months, uploadsPerWeek: state.uploadsPerWeek });
    if (a.verdict === "invalid") return { cls: "", html: esc(t("goal.assess.empty")) };
    const cls = a.verdict === "realistic" ? "is-ok" : a.verdict === "ambitious" ? "is-warn" : "is-bad";
    return { cls, html: esc(t(`goal.assess.${a.verdict}`, { pct: a.monthlyPct, realistic: formatNumber(a.realistic), ambitious: formatNumber(a.ambitious), months: state.months })) };
  }

  function durationChipsHTML(id, options, current) {
    const isCustom = !options.includes(current);
    return `
      <div class="chip-select" id="${id}">
        ${options.map((m) => `<button type="button" data-val="${m}" class="${!isCustom && current === m ? "active" : ""}">${t("goal.wizard.months", { n: m })}</button>`).join("")}
        <button type="button" data-val="custom" class="${isCustom ? "active" : ""}">${t("goal.wizard.monthsCustom")}</button>
      </div>
      ${isCustom ? `<div class="field" style="margin-top:8px;"><input class="input" id="${id}-custom" inputmode="numeric" autocomplete="off" value="${current}" placeholder="${esc(t("goal.wizard.monthsCustomPh"))}" /></div>` : ""}`;
  }

  // ---------- Screen 0: which campaigns to deploy this run ----------
  function selectStepHTML() {
    const row = (key, title, available, sub) => `
      <label class="goal-select-row ${available ? "" : "is-disabled"}">
        <input type="checkbox" data-select="${key}" ${state.selected[key] ? "checked" : ""} ${available ? "" : "disabled"} />
        <div class="goal-select-row-body"><b>${esc(title)}</b><p>${sub}</p></div>
      </label>`;
    const socialSub = socialCampaigns.length === 0
      ? t("goal.select.socialSub")
      : socialAvailable
        ? t("goal.select.socialAddPlatform", { platforms: socialCampaigns.map((c) => t(`goal.launch.platform.${c.goalPlan.platform || "instagram"}`)).join(", ") })
        : t("goal.select.socialAllTaken");
    return `
      <h3 class="copy-q">${t("goal.select.title")}</h3>
      <p class="text-muted" style="font-size:13px;margin:-6px 0 16px;">${t("goal.select.sub")}</p>
      <div class="goal-select-list">
        ${row("social", t("goal.launch.socialTitle"), socialAvailable, socialSub)}
        ${row("community", t("goal.launch.communityTitle"), !communityRunning, communityRunning ? t("goal.select.communityRunning") : t("goal.select.communitySub"))}
        ${row("sales", t("goal.launch.salesTitle"), !salesRunning, salesRunning ? t("goal.select.salesRunning") : t("goal.select.salesSub"))}
      </div>
      <button type="button" class="btn btn-primary btn-block" id="goal-select-next" ${Object.values(state.selected).some(Boolean) ? "" : "disabled"}>${t("camp.next")}${icon("arrowRight", { size: 14 })}</button>`;
  }
  function wireSelect() {
    qsa("[data-select]", root).forEach((cb) =>
      cb.addEventListener("change", () => {
        state.selected[cb.dataset.select] = cb.checked;
        const btn = qs("#goal-select-next", root);
        if (btn) btn.disabled = !Object.values(state.selected).some(Boolean);
      })
    );
    qs("#goal-select-next", root)?.addEventListener("click", () => {
      if (!Object.values(state.selected).some(Boolean)) return;
      state.order = [state.selected.social ? "social" : null, state.selected.community ? "community" : null, state.selected.sales ? "sales" : null, "preview"].filter(Boolean);
      state.phase = "wizard";
      state.stepIdx = 0;
      paint();
    });
  }

  function socialStepHTML() {
    const a = assessmentHTML(state.followers, state.followersTarget);
    return `
      ${progress()}
      <h3 class="copy-q">${t("goal.launch.socialTitle")}</h3>
      <div class="field">
        <label>${t("goal.launch.platformQ")}</label>
        <div class="chip-select" id="goal-platform">${SOCIAL_PLATFORMS.map((p) => `<button type="button" data-val="${p}" class="${state.platform === p ? "active" : ""} ${socialTaken.has(p) ? "is-taken" : ""}" ${socialTaken.has(p) ? "disabled" : ""}>${esc(t(`goal.launch.platform.${p}`))}${socialTaken.has(p) ? ` <small>${t("goal.launch.platformTaken")}</small>` : ""}</button>`).join("")}</div>
        <p class="ev-field-hint">${t("goal.launch.platformHint")}</p>
      </div>
      ${numberField("goal-followers", t("goal.launch.followersQ"), state.followers, { hint: insightsFollowers !== null && state.followers === insightsFollowers ? t("goal.wizard.fromInsights") : t("goal.launch.followersHint") })}
      ${numberField("goal-followers-target", t("goal.launch.followersTargetQ"), state.followersTarget, { hint: t("goal.launch.checkpointHint") })}
      <div class="goal-suggest"><span>${t("goal.suggest.label")}</span>${SOCIAL_CHECKPOINTS.filter((cp) => cp > (state.followers || 0)).map((cp) => `<button type="button" class="goal-suggest-chip" data-goal-use-followers="${cp}"><b>${formatNumber(cp)}</b></button>`).join("")}</div>
      <p class="ev-runway ${a.cls}" id="goal-assess">${icon(a.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${a.html}</span></p>
      <div class="field">
        <label>${t("goal.launch.horizonQ")}</label>
        ${durationChipsHTML("goal-months", GOAL_DURATIONS, state.months)}
      </div>
      ${numberField("goal-uploads", t("goal.launch.freqQ"), state.uploadsPerWeek, { hint: cadenceUploads ? t("goal.wizard.uploadsFromCadence") : t("goal.launch.freqHint") })}
      ${nextBtn()}`;
  }

  function communityStepHTML() {
    const suggested = suggestCommunityTarget(state.order.includes("social") ? state.followersTarget : oldestSocialRunning?.goalPlan?.target?.followers ?? null);
    const a = state.hasExisting !== null ? assessmentHTML(state.members || 0, state.membersTarget) : null;
    return `
      ${progress()}
      <h3 class="copy-q">${t("goal.launch.communityTitle")}</h3>
      <div class="field">
        <label>${t("goal.launch.hasQ")}</label>
        <div class="chip-select" id="goal-has">
          <button type="button" data-val="yes" class="${state.hasExisting === true ? "active" : ""}">${t("goal.launch.hasYes")}</button>
          <button type="button" data-val="no" class="${state.hasExisting === false ? "active" : ""}">${t("goal.launch.hasNo")}</button>
        </div>
      </div>
      ${state.hasExisting ? numberField("goal-members", t("goal.launch.membersQ"), state.members) : ""}
      ${numberField("goal-members-target", t("goal.launch.membersTargetQ"), state.membersTarget)}
      ${suggested ? `<div class="goal-suggest"><span>${t("goal.suggest.label")}</span><button type="button" class="goal-suggest-chip" data-goal-use-members="${suggested}"><b>${formatNumber(suggested)}</b></button></div><p class="ev-field-hint" style="margin-top:-6px;">${t("goal.launch.suggestTarget", { n: formatNumber(suggested) })}</p>` : ""}
      ${a ? `<p class="ev-runway ${a.cls}" id="goal-assess">${icon(a.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${a.html}</span></p>` : ""}
      <div class="field">
        <label>${t("goal.launch.whereQ")}</label>
        <p class="ev-field-hint" style="margin-top:-2px;">${t("goal.launch.whereMultiHint")}</p>
        <div class="chip-select" id="goal-where" style="flex-wrap:wrap;">${COMMUNITY_PLATFORMS.map((p) => `<button type="button" data-val="${p.id}" class="${state.platformWhere.has(p.id) ? "active" : ""}">${esc(p.label)}</button>`).join("")}</div>
      </div>
      ${nextBtn(state.order[state.stepIdx + 1] === "preview" ? t("goal.wizard.seePlan") : undefined)}`;
  }

  // ---------- Sales Growth ----------
  const namedProducts = () => state.products.filter((p) => (p.name || "").trim());
  const salesTotals = () => namedProducts().reduce((a, p) => ({ sold: a.sold + (p.sold || 0), target: a.target + (p.target || 0) }), { sold: 0, target: 0 });
  function salesAssessment() {
    const unit = unitLabel(salesModel(state.salesModel).unit);
    const { sold, target } = salesTotals();
    const a = assessSalesGoal({ sold, target, months: state.salesMonths, monthlySales: state.monthlySales });
    if (a.verdict === "invalid") return { cls: "", html: esc(t("goal.sales.assess.empty")) };
    const cls = a.verdict === "realistic" ? "is-ok" : a.verdict === "ambitious" ? "is-warn" : a.verdict === "aggressive" ? "is-bad" : "";
    return { cls, html: esc(t(`goal.sales.assess.${a.verdict}`, { perMonth: formatNumber(a.perMonth), pace: formatNumber(a.pace || 0), realistic: formatNumber(a.realistic || 0), months: state.salesMonths, unit })) };
  }
  const marginHint = (p) => (p.price && p.cost && p.cost < p.price ? t("goal.sales.marginHint", { n: formatNumber(p.price - p.cost) }) : "");
  function productCardHTML(p, n) {
    const m = state.salesModel;
    const field = (key, label, value, { money = false, optional = false, hint = "", readonly = false } = {}) => `
      <div class="field">
        <label for="gp-${key}-${p.id}">${label}${optional ? ` <span class="copy-optional">${t("goal.sales.optional")}</span>` : ""}</label>
        <input class="input" id="gp-${key}-${p.id}" data-gp="${key}" data-num inputmode="numeric" autocomplete="off" value="${value === null || value === undefined ? "" : formatNumber(value)}" placeholder="${money ? "Rp" : "0"}" ${readonly ? "readonly" : ""} />
        ${hint ? `<p class="ev-field-hint" data-gp-hint="${key}">${esc(hint)}</p>` : optional ? `<p class="ev-field-hint" data-gp-hint="${key}"></p>` : ""}
      </div>`;
    return `
      <div class="goal-product" data-product="${p.id}">
        <div class="goal-product-head"><b>${t("goal.sales.productN", { n: n + 1 })}</b>${state.products.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-gp-remove="${p.id}">${icon("trash", { size: 12 })}${t("common.delete")}</button>` : ""}</div>
        <div class="field">
          <label for="gp-name-${p.id}">${t("goal.sales.nameQ")}</label>
          <input class="input" id="gp-name-${p.id}" data-gp="name" autocomplete="off" maxlength="60" value="${esc(p.name || "")}" placeholder="${esc(t(`goal.sales.namePh.${m}`))}" />
        </div>
        <div class="goal-product-grid">
          ${field("price", t(`goal.sales.priceQ.${m}`), p.price, { money: true, hint: t("goal.sales.priceHint") })}
          ${field("cost", t("goal.sales.costQ"), p.cost, { money: true, optional: true, hint: marginHint(p) })}
          ${field("sold", t(`goal.sales.soldQ.${m}`), p.sold, { hint: t(p.fromTracker ? "goal.sales.soldFromTracker" : "goal.sales.soldHint"), readonly: p.fromTracker })}
          ${field("target", t(`goal.sales.targetQ.${m}`), p.target)}
        </div>
      </div>`;
  }
  function salesStepHTML() {
    const a = salesAssessment();
    const estRevenue = namedProducts().reduce((sum, p) => sum + (p.price || 0) * (p.sold || 0), 0);
    return `
      ${progress()}
      <h3 class="copy-q">${t("goal.launch.salesTitle")}</h3>
      <p class="ev-runway">${icon("info", { size: 12 })}<span>${t("goal.sales.manualNote")}</span></p>
      <div class="field">
        <label>${t("goal.sales.modelQ")}</label>
        <div class="chip-select" id="goal-sales-model" style="flex-wrap:wrap;">${SALES_MODELS.map((m) => `<button type="button" data-val="${m.id}" class="${state.salesModel === m.id ? "active" : ""}">${esc(t(`goal.sales.model.${m.id}`))}</button>`).join("")}</div>
        <p class="ev-field-hint">${t("goal.sales.modelHint", { unit: unitLabel(salesModel(state.salesModel).unit) })}</p>
      </div>
      <label class="goal-products-label">${t("goal.sales.productsQ")}</label>
      ${state.products.map(productCardHTML).join("")}
      <button type="button" class="btn btn-secondary btn-sm" data-gp-add style="margin-bottom:14px;">${icon("plus", { size: 13 })}${t("goal.sales.addProduct")}</button>
      <div class="field">
        <label>${t("goal.sales.horizonQ")}</label>
        ${durationChipsHTML("goal-sales-months", SALES_DURATIONS, state.salesMonths)}
      </div>
      <p class="ev-runway ${a.cls}" id="goal-assess">${icon(a.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${a.html}</span></p>
      <details class="goal-sales-more" id="goal-sales-more" ${state.salesMoreOpen ? "open" : ""}>
        <summary>${t("goal.sales.moreTitle")}</summary>
        <p class="ev-field-hint" style="margin:8px 0 12px;">${t("goal.sales.moreHint")}</p>
        ${numberField("goal-monthly-sales", t("goal.sales.monthlyQ", { unit: unitLabel(salesModel(state.salesModel).unit) }), state.monthlySales, { hint: t("goal.sales.monthlyHint") })}
        ${numberField("goal-revenue-now", t("goal.sales.revenueNowQ"), state.revenueNow, { placeholder: "Rp", hint: estRevenue ? t("goal.sales.revenueNowHint", { n: formatNumber(estRevenue) }) : "" })}
        ${numberField("goal-revenue-target", t("goal.sales.revenueTargetQ"), state.revenueTarget, { placeholder: "Rp", hint: t("goal.sales.revenueTargetHint") })}
      </details>
      ${nextBtn(state.order[state.stepIdx + 1] === "preview" ? t("goal.wizard.seePlan") : undefined)}
      ${salesSkippable() ? `<button type="button" class="btn btn-ghost btn-block" data-goal-skip-sales style="margin-top:8px;">${t("goal.sales.skip")}</button>` : ""}`;
  }
  const salesInput = () => ({
    model: state.salesModel, products: namedProducts(), months: state.salesMonths, monthlySales: state.monthlySales,
    revenue: { current: state.revenueNow, target: state.revenueTarget },
    startIndex: placeStartSalesLevel({ model: state.salesModel, products: namedProducts() }).index,
  });
  const salesActive = () => state.order.includes("sales") && !state.salesSkipped;

  function planColumnHTML(title, plan, placement) {
    if (!plan) return "";
    const estimated = plan.missions.some((m) => m.milestones.some((ms) => ms.estimated));
    // Levels behind the starting point are dropped from the plan entirely
    // (js/goal-plan.js) — the ladder's own first mission IS the start level,
    // rebased to wherever the brand genuinely stands today.
    return `
      <div class="goal-preview-col">
        <h4>${esc(title)}</h4>
        ${placement ? `<p class="text-muted" style="font-size:12.5px;margin:-4px 0 10px;">${esc(t(`goal.place.${placement.reason}`, { n: 1, name: missionText(plan.missions[0]).name }))}</p>` : ""}
        <div class="goal-preview">
          ${plan.missions.map((m, i) => {
            // Sales Growth's per-product rows aren't gating, but they ARE the
            // targets the user just typed — show them next to the total.
            const focus = m.milestones.filter((ms) => ms.required || ms.key === "product");
            return `
              <div class="goal-preview-stage">
                <div class="goal-preview-head"><span class="goal-preview-n">${i + 1}</span><div><b>${esc(missionText(m).name)}</b><span>${esc(t("goal.wizard.estWeeks", { n: m.estWeeks }))}</span></div></div>
                <ul>${focus.map((ms) => `<li>${esc(milestoneLabel(ms.label))}${ms.target ? ` — <b>${formatNumber(ms.target)}</b> ${esc(unitLabel(ms.unit))}${ms.estimated ? "*" : ""}` : ""}</li>`).join("")}</ul>
              </div>`;
          }).join("")}
        </div>
        ${estimated ? `<p class="ev-field-hint">* ${esc(t("goal.wizard.estimatedNote"))}</p>` : ""}
      </div>`;
  }

  function previewStepHTML() {
    const cols = [];
    if (state.order.includes("social")) {
      const socialPlacement = placeStartSocialLevel({ followers: state.followers, baseline });
      const socialPlan = buildSocialGrowthPlan({ platform: state.platform, current: { followers: state.followers || 0 }, target: state.followersTarget, months: state.months, uploadsPerWeek: state.uploadsPerWeek, startIndex: socialPlacement.index, content, contentCadence: cad });
      cols.push(planColumnHTML(`${t("goal.launch.socialTitle")} (${t(`goal.launch.platform.${state.platform}`)})`, socialPlan, socialPlacement));
    }
    if (state.order.includes("community")) {
      const communityPlacement = placeStartCommunityLevel({ hasExisting: state.hasExisting, members: state.members });
      const communityPlan = buildCommunityGrowthPlan({ hasExisting: state.hasExisting, platformWhere: [...state.platformWhere], current: { members: state.hasExisting ? state.members || 0 : 0 }, target: state.membersTarget, months: state.months, startIndex: communityPlacement.index, content });
      cols.push(planColumnHTML(t("goal.launch.communityTitle"), communityPlan, communityPlacement));
    }
    if (salesActive()) {
      const salesPlacement = placeStartSalesLevel({ model: state.salesModel, products: namedProducts() });
      const salesPlan = buildSalesGrowthPlan(salesInput());
      cols.push(planColumnHTML(t("goal.launch.salesTitle"), salesPlan, salesPlacement));
    }
    const gridClass = cols.length === 1 ? "is-one" : cols.length === 2 ? "is-two" : "is-three";
    return `
      ${progress()}
      <h3 class="copy-q">${t("goal.launch.previewTitle")}</h3>
      <div class="goal-preview-grid ${gridClass}">${cols.join("")}</div>
      <div class="goal-disclaimer-box">
        <div class="goal-disclaimer-title">${icon("info", { size: 13 })}${t("goal.disclaimer.title")}</div>
        ${[1, 2, 3, 4].map((n) => `<p>${esc(t(`goal.disclaimer.${n}`))}</p>`).join("")}
        <label class="checkbox-chip"><input type="checkbox" id="goal-agree" ${state.agreed ? "checked" : ""} />${t("goal.disclaimer.agree")}</label>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="goal-create" ${state.agreed ? "" : "disabled"}>${icon("check", { size: 14 })}${t("goal.launch.deploy")}</button>`;
  }

  function paint() {
    if (state.phase === "select") {
      root.innerHTML = selectStepHTML();
      wireSelect();
      return;
    }
    const kind = stepKind();
    root.innerHTML = kind === "social" ? socialStepHTML() : kind === "community" ? communityStepHTML() : kind === "sales" ? salesStepHTML() : previewStepHTML();
    wire();
  }

  function readInputs() {
    const kind = stepKind();
    if (kind === "social") {
      state.followers = toNum(qs("#goal-followers", root)?.value);
      state.followersTarget = toNum(qs("#goal-followers-target", root)?.value);
      state.uploadsPerWeek = Math.min(21, Math.max(1, toNum(qs("#goal-uploads", root)?.value) || 3));
    } else if (kind === "community") {
      state.members = toNum(qs("#goal-members", root)?.value);
      state.membersTarget = toNum(qs("#goal-members-target", root)?.value);
    } else if (kind === "sales") {
      state.products.forEach((p) => {
        const card = qs(`[data-product="${p.id}"]`, root);
        if (!card) return;
        p.name = qs('[data-gp="name"]', card).value.trim();
        ["price", "cost", "sold", "target"].forEach((k) => (p[k] = toNum(qs(`[data-gp="${k}"]`, card).value)));
      });
      state.monthlySales = toNum(qs("#goal-monthly-sales", root)?.value);
      state.revenueNow = toNum(qs("#goal-revenue-now", root)?.value);
      state.revenueTarget = toNum(qs("#goal-revenue-target", root)?.value);
      state.salesMoreOpen = !!qs("#goal-sales-more", root)?.open;
    }
  }
  function validate() {
    const kind = stepKind();
    if (kind === "social") {
      if (socialTaken.has(state.platform)) return t("goal.launch.err.platformTaken");
      if (state.followers === null || !state.followersTarget || state.followersTarget <= (state.followers || 0)) return t("goal.launch.err.followers");
    }
    if (kind === "community") {
      if (state.hasExisting === null) return t("goal.launch.err.hasQ");
      const cur = state.hasExisting ? state.members || 0 : 0;
      if ((state.hasExisting && state.members === null) || !state.membersTarget || state.membersTarget <= cur) return t("goal.launch.err.members");
    }
    if (kind === "sales") {
      // Only what a beginner is sure to know is required: a name, a price,
      // and a target above what's already sold (sold left empty = 0).
      // Rows with no name at all are ignored, not errors.
      const list = namedProducts();
      if (!list.length) return t("goal.sales.err.noProduct");
      const bad = list.find((p) => !p.price || !p.target || p.target <= (p.sold || 0));
      if (bad) return t("goal.sales.err.product", { name: bad.name });
      if (new Set(list.map((p) => p.name.toLowerCase())).size !== list.length) return t("goal.sales.err.duplicate");
      if (state.revenueTarget !== null && state.revenueTarget <= (state.revenueNow || 0)) return t("goal.sales.err.revenue");
    }
    return "";
  }
  function refreshLive() {
    const el = qs("#goal-assess", root);
    if (!el) return;
    const kind = stepKind();
    if (kind === "sales") readInputs();
    const a = kind === "sales" ? salesAssessment() : kind === "social" ? assessmentHTML(state.followers, state.followersTarget) : assessmentHTML(state.hasExisting ? state.members || 0 : 0, state.membersTarget);
    el.className = `ev-runway ${a.cls}`;
    el.innerHTML = `${icon(a.cls === "is-ok" ? "check" : "info", { size: 12 })}<span>${a.html}</span>`;
  }
  function wireNumberFormat(sel, onInput) {
    const el = qs(sel, root);
    el?.addEventListener("input", () => {
      const n = toNum(el.value);
      el.value = n === null ? "" : formatNumber(n);
      onInput?.();
    });
  }

  function wire() {
    qs("[data-goal-back]", root)?.addEventListener("click", () => {
      readInputs();
      state.error = "";
      if (state.stepIdx === 0) {
        state.phase = "select";
      } else {
        state.stepIdx -= 1;
      }
      paint();
    });
    const chips = (sel, apply, repaint = false) =>
      qsa(`${sel} button`, root).forEach((b) =>
        b.addEventListener("click", () => {
          readInputs();
          apply(b.dataset.val);
          if (repaint) paint();
          else qsa(`${sel} button`, root).forEach((x) => x.classList.toggle("active", x === b));
        })
      );
    chips("#goal-platform", (v) => (state.platform = v));
    chips("#goal-months", (v) => (state.months = v === "custom" ? (GOAL_DURATIONS.includes(state.months) ? 9 : state.months) : Number(v)), true);
    wireNumberFormat("#goal-months-custom", () => {
      state.months = Math.min(24, Math.max(2, toNum(qs("#goal-months-custom", root)?.value) || 2));
      refreshLive();
    });
    chips("#goal-has", (v) => (state.hasExisting = v === "yes"), true);
    // Community platform is multi-select: toggle membership in the Set
    // instead of swapping a single active chip.
    qsa("#goal-where button", root).forEach((b) =>
      b.addEventListener("click", () => {
        readInputs();
        if (state.platformWhere.has(b.dataset.val)) state.platformWhere.delete(b.dataset.val);
        else state.platformWhere.add(b.dataset.val);
        b.classList.toggle("active", state.platformWhere.has(b.dataset.val));
      })
    );
    ["#goal-followers", "#goal-followers-target", "#goal-members", "#goal-members-target"].forEach((sel) =>
      wireNumberFormat(sel, sel.includes("target") || sel === "#goal-followers" || sel === "#goal-members" ? refreshLive : undefined)
    );
    wireNumberFormat("#goal-uploads", refreshLive);
    // Sales step: product cards + the optional block.
    chips("#goal-sales-model", (v) => (state.salesModel = v), true);
    chips("#goal-sales-months", (v) => (state.salesMonths = v === "custom" ? (SALES_DURATIONS.includes(state.salesMonths) ? 9 : state.salesMonths) : Number(v)), true);
    wireNumberFormat("#goal-sales-months-custom", () => {
      state.salesMonths = Math.min(24, Math.max(2, toNum(qs("#goal-sales-months-custom", root)?.value) || 2));
      refreshLive();
    });
    ["#goal-monthly-sales", "#goal-revenue-now", "#goal-revenue-target"].forEach((sel) => wireNumberFormat(sel, refreshLive));
    qsa("[data-product] [data-num]", root).forEach((el) =>
      el.addEventListener("input", () => {
        const n = toNum(el.value);
        el.value = n === null ? "" : formatNumber(n);
        refreshLive();
        const card = el.closest("[data-product]");
        const hint = qs('[data-gp-hint="cost"]', card);
        if (hint) hint.textContent = marginHint(state.products.find((p) => p.id === card.dataset.product) || {});
      })
    );
    qs("[data-gp-add]", root)?.addEventListener("click", () => {
      readInputs();
      state.products.push(newProduct());
      paint();
      qs(`#gp-name-${state.products[state.products.length - 1].id}`, root)?.focus();
    });
    qsa("[data-gp-remove]", root).forEach((b) =>
      b.addEventListener("click", () => {
        readInputs();
        state.products = state.products.filter((p) => p.id !== b.dataset.gpRemove);
        paint();
      })
    );
    qs("[data-goal-skip-sales]", root)?.addEventListener("click", () => {
      readInputs();
      state.salesSkipped = true;
      state.error = "";
      state.stepIdx += 1;
      paint();
    });
    qsa("[data-goal-use-followers]", root).forEach((b) =>
      b.addEventListener("click", () => {
        readInputs();
        state.followersTarget = Number(b.dataset.goalUseFollowers);
        paint();
      })
    );
    qsa("[data-goal-use-members]", root).forEach((b) =>
      b.addEventListener("click", () => {
        readInputs();
        state.membersTarget = Number(b.dataset.goalUseMembers);
        paint();
      })
    );
    qs("#goal-agree", root)?.addEventListener("change", (e) => {
      state.agreed = e.target.checked;
      qs("#goal-create", root).disabled = !state.agreed;
    });
    qs("[data-goal-next]", root)?.addEventListener("click", () => {
      readInputs();
      state.error = validate();
      if (state.error) {
        paint();
        return;
      }
      if (stepKind() === "sales") state.salesSkipped = false;
      state.stepIdx += 1;
      paint();
    });
    qs("#goal-create", root)?.addEventListener("click", () => {
      if (!state.agreed) return;
      closeOverlay(overlay);
      finish();
    });
  }

  function finish() {
    const created = [];
    const namesCreated = [];
    if (state.order.includes("social")) {
      const placement = placeStartSocialLevel({ followers: state.followers, baseline });
      const { missions, goalPlan } = buildSocialGrowthPlan({ platform: state.platform, current: { followers: state.followers || 0 }, target: state.followersTarget, months: state.months, uploadsPerWeek: state.uploadsPerWeek, startIndex: placement.index, content, contentCadence: cad });
      created.push(createCampaign(brandId, {
        name: `${t("goal.launch.socialTitle")} (${t(`goal.launch.platform.${state.platform}`)}) ${brand?.name || ""}`.trim(),
        objective: "awareness", status: "active",
        targetAudience: brand?.brandDNA?.targetAudience || "",
        phases: CAMPAIGN_PHASE_TEMPLATE.map((tpl) => ({ id: tpl.name.toLowerCase(), name: tpl.name, goal: "", milestones: [], enabled: !tpl.optional })),
        autoLinkAllContent: true,
        missions,
        missionProgressionNote: t("goal.rules.social"),
        goalPlan,
      }));
      namesCreated.push(t("goal.launch.socialTitle"));
    }
    if (state.order.includes("community")) {
      const placement = placeStartCommunityLevel({ hasExisting: state.hasExisting, members: state.members });
      const { missions, goalPlan } = buildCommunityGrowthPlan({ hasExisting: state.hasExisting, platformWhere: [...state.platformWhere], current: { members: state.hasExisting ? state.members || 0 : 0 }, target: state.membersTarget, months: state.months, startIndex: placement.index, content });
      created.push(createCampaign(brandId, {
        name: `${t("goal.launch.communityTitle")} ${brand?.name || ""}`.trim(),
        objective: "community", status: "active",
        targetAudience: brand?.brandDNA?.targetAudience || "",
        phases: CAMPAIGN_PHASE_TEMPLATE.map((tpl) => ({ id: tpl.name.toLowerCase(), name: tpl.name, goal: "", milestones: [], enabled: !tpl.optional })),
        autoLinkAllContent: false,
        missions,
        missionProgressionNote: t("goal.rules.community"),
        goalPlan,
      }));
      namesCreated.push(t("goal.launch.communityTitle"));
    }
    if (salesActive()) {
      // Products go into Sales Tracker first (a name that already exists
      // there keeps the tracker's id), so the campaign and the tracker
      // share product ids and the tracker can keep the campaign up to date.
      const input = salesInput();
      const idMap = mergeProductsFromWizard(brandId, { model: input.model, products: input.products, openingRevenue: state.revenueNow });
      input.products = input.products.map((p) => ({ ...p, id: idMap[p.id] || p.id }));
      const { missions, goalPlan, manualMetrics } = buildSalesGrowthPlan(input);
      created.push(createCampaign(brandId, {
        name: `${t("goal.launch.salesTitle")} ${brand?.name || ""}`.trim(),
        objective: "sales", status: "active",
        targetAudience: brand?.brandDNA?.targetAudience || "",
        phases: CAMPAIGN_PHASE_TEMPLATE.map((tpl) => ({ id: tpl.name.toLowerCase(), name: tpl.name, goal: "", milestones: [], enabled: !tpl.optional })),
        autoLinkAllContent: false,
        missions,
        manualMetrics,
        missionProgressionNote: t("goal.rules.sales"),
        goalPlan,
      }));
      namesCreated.push(t("goal.launch.salesTitle"));
      syncSalesCampaign(brandId);
    }
    toast(created.length > 1 ? t("goal.launch.deployedToastMany", { names: namesCreated.join(", ") }) : t("goal.launch.deployedToastOne", { name: created[0].name }));
    onSaved?.();
    if (created.length === 1) location.hash = `#/brand/${brandId}/campaigns/${created[0].id}`;
    else location.hash = `#/brand/${brandId}/campaigns`;
  }

  paint();
}
