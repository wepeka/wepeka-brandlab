// Buying an add-on from inside the app (AI credits, brand slots) — the one
// path both offers (js/ai-topup.js, js/brand-offer.js) share. Pays through
// Midtrans Snap (js/views/pricing.js payPlan, loaded only when someone
// actually clicks buy), then waits for the webhook to land on accounts/{uid}
// (main.js fires "account:change") before saying it worked: Snap's own
// "success" only means the payment went through, not that it's applied.
import { t, getLang } from "./i18n.js";
import { toast, escapeHtml } from "./dom.js";
import { currentUid, getCachedAccount } from "./account.js";

export const rp = (n) => `Rp ${Number(n).toLocaleString(getLang() === "en" ? "en-US" : "id-ID")}`;

// `isDone(account)`: true once the purchase shows on the account doc.
export async function buyAddon(payKey, { isDone, onDone } = {}) {
  const { payPlan } = await import("./views/pricing.js");
  await payPlan(payKey, currentUid(), { onSuccess: () => waitUntilApplied(isDone, onDone) });
}

function waitUntilApplied(isDone, onDone) {
  if (!isDone) return;
  toast(t("offer.activating"));
  let timer = null;
  const check = () => {
    if (!isDone(getCachedAccount())) return;
    window.removeEventListener("account:change", check);
    clearTimeout(timer);
    toast(t("offer.applied"));
    onDone?.();
  };
  window.addEventListener("account:change", check);
  timer = setTimeout(() => {
    window.removeEventListener("account:change", check);
    toast(t("pricing.pay.pending"));
  }, 120_000);
  check();
}

// One buyable row in an offer card. `featured` = the one we'd pick for them.
export function offerOptionHTML({ payKey, title, sub = "", price, per = "", badge = "", featured = false }) {
  return `
    <button type="button" class="offer-opt ${featured ? "is-featured" : ""}" data-offer-pay="${escapeHtml(payKey)}">
      ${badge ? `<span class="offer-badge">${escapeHtml(badge)}</span>` : ""}
      <span class="offer-opt-main"><b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}</span>
      <span class="offer-opt-price"><strong>${escapeHtml(price)}</strong>${per ? `<small>${escapeHtml(per)}</small>` : ""}</span>
    </button>`;
}
