// "Batas brand penuh" — what the locked "+" (new brand) opens once the
// account holds as many brands as its plan allows. Pay-once plans buy
// permanent slots (or rent one); subscribers rent one for 30 days, move up
// a plan, or move to Lifetime — they can't buy permanent slots (owner's
// decision, 2026-09-29). A trial picks a plan. Paid on the spot
// (js/purchase.js); once the webhook adds the slot, the new-brand form
// opens by itself (`onUnlocked`). openBrandRenew is the same card for a
// brand gone preview-only after its monthly slot lapsed.
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { openModal, closeOverlay } from "./modals.js";
import { getCachedAccount, accessState, isReadOnly, brandLimitOf, LIFETIME_PLANS } from "./account.js";
import { BRAND_ADDONS, SUPPORT_WA_NUMBER } from "./site-links.js";
import { rp, buyAddon, offerOptionHTML } from "./purchase.js";

const SUBSCRIPTION_PLANS = ["starter", "pro", "studio"];
// Moving up instead of renting: the next plan's brand count.
const NEXT_PLAN = { starter: { brands: 3, price: 99000 }, pro: { brands: 10, price: 249000 } };
// Founder Lifetime's opening price (js/views/pricing.js FOUNDER.tiers).
const LIFETIME_FROM = 499000;

function kindOf(account) {
  if (accessState(account) !== "paid" || isReadOnly(account)) return "trial";
  if (LIFETIME_PLANS.includes(account.plan)) return "lifetime";
  if (SUBSCRIPTION_PLANS.includes(account.plan)) return "sub";
  return "other"; // pre-subscription plans: handled by hand over WhatsApp
}

const monthlyHTML = (featured) => {
  const a = BRAND_ADDONS.sub[0];
  return `
    ${offerOptionHTML({ payKey: a.payKey, title: t("brands.offer.subTitle"), sub: t("brands.offer.subSub", { days: a.days }), price: rp(a.price), per: t("ai.offer.perDays", { days: a.days }), featured })}
    <p class="offer-note">${icon("clock", { size: 12 })}${t("brands.offer.subNote", { days: a.days })}</p>`;
};
const planLinkHTML = (title, sub, price, per) =>
  `<a class="offer-opt offer-opt-link" href="#/pricing" data-offer-plans><span class="offer-opt-main"><b>${title}</b><small>${sub}</small></span><span class="offer-opt-price"><strong>${price}</strong>${per ? `<small>${per}</small>` : ""}</span></a>`;

function optionsHTML(kind, account) {
  if (kind === "lifetime") {
    return BRAND_ADDONS.lifetime.map((a, i) => offerOptionHTML({
      payKey: a.payKey,
      title: t("brands.offer.lifeTitle", { n: a.n }),
      sub: t("brands.offer.lifeSub"),
      price: rp(a.price),
      badge: a.save ? t("brands.offer.save", { amount: rp(a.save) }) : "",
      featured: i === 0,
    })).join("") + `<div class="offer-divider"><span>${t("brands.offer.orMonthly")}</span></div>` + monthlyHTML(false);
  }
  if (kind === "sub") {
    const next = NEXT_PLAN[account.plan];
    return `
      ${monthlyHTML(true)}
      ${next ? planLinkHTML(t("brands.offer.upgradeTitle", { n: next.brands }), t("brands.offer.upgradeSub"), rp(next.price), t("brands.offer.perMonth")) : ""}
      ${planLinkHTML(t("brands.offer.lifetimeTitle"), t("brands.offer.lifetimeSub"), t("brands.offer.lifetimeFrom", { price: rp(LIFETIME_FROM) }), t("brands.offer.payOnce"))}`;
  }
  return "";
}

export function openBrandOffer({ onUnlocked } = {}) {
  const account = getCachedAccount();
  const kind = kindOf(account);
  const limit = brandLimitOf(account);
  const footHTML = kind === "trial"
    ? `<button type="button" class="btn btn-ghost" data-offer-close>${t("ai.topup.later")}</button><a class="btn btn-primary" href="#/pricing" data-offer-plans>${icon("arrowUp", { size: 14 })}${t("ai.topup.seePlans")}</a>`
    : kind === "other"
      ? `<a class="btn btn-primary" href="https://wa.me/${SUPPORT_WA_NUMBER}" target="_blank" rel="noopener noreferrer">${t("brands.limit.wa")}</a>`
      : `<button type="button" class="btn btn-secondary" data-offer-close>${t("common.close")}</button>`;
  const overlay = openModal({
    title: t("brands.offer.title"),
    width: "min(480px,94vw)",
    bodyHTML: `
      <div class="brand-offer-modal">
        <p class="text-muted" style="margin:0 0 14px;font-size:13.5px;">${t(kind === "trial" ? "brands.offer.bodyTrial" : "brands.offer.body", { limit })}</p>
        ${kind === "lifetime" || kind === "sub" ? `<div class="offer-card"><div class="offer-group">${optionsHTML(kind, account)}</div></div>` : ""}
      </div>`,
    footHTML,
  });
  overlay.querySelectorAll("[data-offer-close], [data-offer-plans]").forEach((el) => el.addEventListener("click", () => closeOverlay(overlay)));
  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-offer-pay]");
    if (!btn) return;
    buyAddon(btn.dataset.offerPay, {
      isDone: (acc) => brandLimitOf(acc) > limit,
      onDone: () => { closeOverlay(overlay); onUnlocked?.(); },
    });
  });
}

// A brand that went preview-only: pay to renew the monthly slot ending
// soonest (it opens again the moment the webhook lands), or archive it /
// another brand to free a place.
export function openBrandRenew(brand) {
  const account = getCachedAccount();
  const a = BRAND_ADDONS.sub[0];
  const limit = brandLimitOf(account);
  const overlay = openModal({
    title: t("brands.locked.renewTitle", { name: brand.name }),
    width: "min(480px,94vw)",
    bodyHTML: `
      <p class="text-muted" style="margin:0 0 14px;font-size:13.5px;">${t("brands.locked.renewBody")}</p>
      <div class="offer-card"><div class="offer-group">
        ${offerOptionHTML({ payKey: a.renewKey, title: t("brands.locked.renewOpt"), sub: t("brands.offer.subSub", { days: a.days }), price: rp(a.price), per: t("ai.offer.perDays", { days: a.days }), featured: true })}
        <p class="offer-note">${icon("info", { size: 12 })}${t("brands.locked.archiveTip")}</p>
      </div></div>`,
    footHTML: `<button type="button" class="btn btn-secondary" data-offer-close>${t("common.close")}</button>`,
  });
  overlay.querySelector("[data-offer-close]").addEventListener("click", () => closeOverlay(overlay));
  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-offer-pay]");
    if (!btn) return;
    buyAddon(btn.dataset.offerPay, { isDone: (acc) => brandLimitOf(acc) > limit, onDone: () => closeOverlay(overlay) });
  });
}
