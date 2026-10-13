// The congratulations page after a payment: "Selamat, kamu sudah Lifetime",
// the community doors (js/community.js: WhatsApp group, Instagram), and one
// button into the app. Nothing else — no plans, no prices.
//
// It used to be a sheet over whatever was on screen, and what was on screen
// after a payment was the plans page the checkout started from: a buyer back
// from GoPay read "Kamu sudah Lifetime" next to every price, with no obvious
// way on (owner's report, 2026-10-13). Now the page covers everything from
// the moment the payment is on the account until its button is pressed.
//
// main.js decides when (js/paid-welcome.js isPaidWelcomeDue) and puts the
// page's empty shell up itself, in the same breath as whatever it paints
// underneath, so nothing shows through while this module downloads.
//
// It counts as shown only once the buyer has pressed the button. With GoPay
// the buyer is in the GoPay app while the tab they left opens this for
// nobody; a page nobody answered is simply there again on the next boot.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { getCachedAccount, isLifetime, currentUid } from "./account.js";
import { communityLinksHTML, mountCommunityLinks } from "./community.js";
import { markPaidWelcomeSeen } from "./paid-welcome.js";

// The plan's name as the plans page writes it; the pre-subscription
// all-in-one Lifetime never had one of its own.
const PLAN_NAMES = ["founder", "founder-ultimate", "starter", "pro", "studio"];
export function planLabel(account) {
  const plan = account?.plan;
  if (PLAN_NAMES.includes(plan)) return t(`pricing.planName.${plan}`);
  return plan === "lifetime" ? "Lifetime" : "";
}

// A burst of paper around the check, once. Fixed pieces (angle, distance,
// colour) so it looks the same every time; hidden from reduced motion.
const CONFETTI = [
  [-78, 96, "#ec4899"], [-52, 118, "#fbbf24"], [-24, 92, "#818cf8"], [4, 124, "#34d399"],
  [30, 98, "#ec4899"], [58, 116, "#a78bfa"], [84, 90, "#fbbf24"], [112, 120, "#818cf8"],
  [140, 96, "#34d399"], [168, 118, "#ec4899"], [196, 92, "#a78bfa"], [224, 122, "#fbbf24"],
  [250, 100, "#818cf8"], [-104, 114, "#34d399"],
];
const confettiHTML = () => CONFETTI.map(([angle, far, color], i) =>
  `<i style="--a:${angle}deg;--d:${far}px;--c:${color};--t:${(i % 4) * 40}ms"></i>`).join("");

// Exported for the test: what the page says for this account.
export function payThanksHTML(account) {
  const lifetime = isLifetime(account);
  const label = planLabel(account);
  const kind = lifetime ? "lifetime" : "plan";
  return `
    <div class="pay-thanks-inner">
      <div class="brand-mark pay-thanks-mark">
        <span class="brand-logo" role="img" aria-label="Wepeka"></span>
        <span class="brand-mark-divider"></span>
        Brandlab
      </div>
      <header class="pay-thanks-hero">
        <span class="pay-thanks-badge" aria-hidden="true">
          <span class="pay-thanks-confetti">${confettiHTML()}</span>
          ${icon("check", { size: 40 })}
        </span>
        ${label ? `<span class="pricing-pill pricing-pill--pink pay-thanks-pill">${escapeHtml(label)}</span>` : ""}
        <h1 class="pay-thanks-title" id="pay-thanks-title">${t(`pay.thanks.title.${kind}`)}</h1>
        <p class="pay-thanks-sub">${t(`pay.thanks.sub.${kind}`)}</p>
      </header>
      <section class="pay-thanks-card">
        <h2>${t("pay.thanks.doors.title")}</h2>
        <p class="community-lead">${t("pay.thanks.doors.body")}</p>
        ${communityLinksHTML({ lifetime })}
      </section>
      <div class="pay-thanks-foot">
        <button type="button" class="btn btn-primary pricing-cta--pink pay-thanks-go" data-pay-thanks-go>${t("community.paid.cta")}${icon("arrowRight", { size: 16 })}</button>
      </div>
    </div>`;
}

// Fills `page` (the shell main.js put up) and resolves once the button is
// pressed. Whoever takes the shell away before that (main.js, on sign-out)
// leaves this unanswered: nothing is marked, nothing after it runs.
export function showPayThanks(page) {
  const uid = currentUid();
  const lifetime = isLifetime(getCachedAccount());
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-modal", "true");
  page.setAttribute("aria-labelledby", "pay-thanks-title");
  page.innerHTML = payThanksHTML(getCachedAccount());
  mountCommunityLinks(page);
  // Keyboard and screen reader start here, not in the app underneath.
  page.tabIndex = -1;
  page.focus({ preventScroll: true });
  return new Promise((resolve) => {
    page.querySelector("[data-pay-thanks-go]").addEventListener("click", () => {
      if (currentUid() === uid) markPaidWelcomeSeen(lifetime);
      page.remove();
      resolve();
    }, { once: true });
  });
}
