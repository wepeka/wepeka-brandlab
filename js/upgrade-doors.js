// The two doors a trial is shown when it hits one of its walls — the brand
// limit (js/brand-offer.js) or the day's AI credits (js/ai-topup.js): Pro,
// recommended, and Founder Lifetime with its normal price struck through.
// Both lead to the plans page; Pro opens it on the 3-brand size
// (js/pricing-pick.js). Display numbers only — what is charged and what a
// plan grants live in api/_plans.js and api/_aiQuota.js; keep in step with
// js/views/pricing.js (SUBSCRIPTIONS[3], FOUNDER, LIFETIME_NORMAL_PRICE).
import { t } from "./i18n.js";
import { rp } from "./purchase.js";
import { askPricingBrands } from "./pricing-pick.js";

export const PRO_PLAN = { brands: 3, price: 99000, credits: 100 };
// Founder Lifetime's opening price and Lifetime's normal price.
export const LIFETIME_FROM = 499000;
export const LIFETIME_NORMAL = 3000000;
export const LIFETIME_CREDITS = 100;

// One door: a card that opens the plans page. `pick`: the subscription size
// the page should open on; `was`: a normal price, struck through above the
// price. Every text here comes from i18n or rp(), never from the owner.
export const planDoorHTML = (title, sub, price, per, { featured = false, badge = "", pick = 0, was = "" } = {}) =>
  `<a class="offer-opt offer-opt-link ${featured ? "is-featured" : ""}" href="#/pricing" data-offer-plans${pick ? ` data-offer-pick="${pick}"` : ""}>${badge ? `<span class="offer-badge">${badge}</span>` : ""}<span class="offer-opt-main"><b>${title}</b><small>${sub}</small></span><span class="offer-opt-price">${was ? `<s class="offer-opt-was">${was}</s>` : ""}<strong>${price}</strong>${per ? `<small>${per}</small>` : ""}</span></a>`;

// Pro + Founder Lifetime. `proSub` / `lifeSub`: the line under each name,
// which says what matters for the wall that was hit (brands, or credits).
export function upgradeDoorsHTML({ proSub, lifeSub }) {
  return `
    ${planDoorHTML(t("brands.offer.trialProTitle", { n: PRO_PLAN.brands }), proSub, rp(PRO_PLAN.price), t("brands.offer.perMonth"), { featured: true, badge: t("brands.offer.trialProBadge"), pick: PRO_PLAN.brands })}
    ${planDoorHTML(t("brands.offer.trialLifeTitle", { n: PRO_PLAN.brands }), lifeSub, t("brands.offer.lifetimeFrom", { price: rp(LIFETIME_FROM) }), t("brands.offer.payOnce"), { was: rp(LIFETIME_NORMAL) })}`;
}

// A click on a door closes the dialog it sits in and, for Pro, leaves the
// size wish for the plans page.
export function wireUpgradeDoors(overlay, close) {
  overlay.querySelectorAll("[data-offer-plans]").forEach((el) => el.addEventListener("click", () => {
    if (el.dataset.offerPick) askPricingBrands(el.dataset.offerPick);
    close();
  }));
}
