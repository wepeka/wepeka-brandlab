// "AI credit habis" — the one place that tells someone their AI credits ran
// out and how to get more. Paid accounts get the offer card: AI Sepuasnya
// (no credit limit for 30 days) and one-off top-ups that never expire,
// both paid on the spot through Midtrans (js/purchase.js). A trial or a
// read-only account gets the plans instead, since extras are only sold on
// top of a plan (same rule as the pricing page's add-ons, and enforced in
// api/midtrans/create-transaction.js).
//
// It opens by itself once per quota window (today / this month / the
// trial), the moment an AI call hits the wall (js/ai.js dispatches
// "ai:quota-out") or the meter flips to empty after a successful call.
// After that it only opens on request: any element with [data-ai-topup]
// (the chat's quota line, the ⋯ menu's AI meter) opens it again.
import { t, getLang } from "./i18n.js";
import { icon } from "./icons.js";
import { openModal, closeOverlay } from "./modals.js";
import { escapeHtml, closeMenu } from "./dom.js";
import { onChange } from "./store.js";
import { aiLimitReached, aiDailyLimit, aiQuotaPeriod, aiQuotaWindow, aiExtras, aiPlanUsedUp } from "./ai-usage.js";
import { getCachedAccount, accessState, isReadOnly } from "./account.js";
import { AI_TOPUPS, AI_UNLIMITED } from "./site-links.js";
import { rp, buyAddon, offerOptionHTML } from "./purchase.js";

const num = (n) => Number(n).toLocaleString(getLang() === "en" ? "en-US" : "id-ID");
const dateLabel = (ts) => new Date(ts).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long" });

// Top-ups are sold to accounts that already pay; everyone else upgrades.
export function canTopUp(account = getCachedAccount()) {
  return accessState(account) === "paid" && !isReadOnly(account);
}

function bodyKey(readOnly, period) {
  if (readOnly) return "ai.topup.bodyReadonly";
  if (period === "total") return "ai.topup.bodyTotal";
  return period === "month" ? "ai.topup.bodyMonth" : "ai.topup.bodyDay";
}

// What's left on top of the plan, one line — so a buyer sees the credits land.
function balanceHTML(x) {
  const parts = [];
  if (x.unlimited) parts.push(t("ai.offer.balanceUnlimited", { date: dateLabel(x.unlimitedUntil) }));
  if (x.credits) parts.push(t("ai.offer.balanceCredits", { n: num(x.credits) }));
  return parts.length ? `<p class="offer-balance">${icon("bot", { size: 13 })}${parts.join(" · ")}</p>` : "";
}

export function offerHTML() {
  const x = aiExtras();
  const daily = offerOptionHTML({
    payKey: AI_UNLIMITED.payKey,
    title: t("ai.offer.unlimitedTitle"),
    sub: x.unlimited ? t("ai.offer.unlimitedExtend", { date: dateLabel(x.unlimitedUntil) }) : t("ai.offer.unlimitedSub", { days: AI_UNLIMITED.days }),
    price: rp(AI_UNLIMITED.price),
    per: t("ai.offer.perDays", { days: AI_UNLIMITED.days }),
    badge: t("ai.offer.unlimitedBadge"),
    featured: true,
  });
  const packs = AI_TOPUPS.map((p) => offerOptionHTML({
    payKey: p.payKey,
    title: t("ai.topup.credits", { n: num(p.credits) }),
    sub: t("ai.offer.perCredit", { price: rp(Math.round(p.price / p.credits)) }),
    price: rp(p.price),
    badge: p.best ? t("ai.offer.best") : "",
  })).join("");
  return `
    ${balanceHTML(x)}
    <div class="offer-group">
      ${daily}
      <p class="offer-note">${icon("check", { size: 12 })}${t("ai.offer.unlimitedNote")}</p>
    </div>
    <div class="offer-divider"><span>${t("ai.offer.or")}</span></div>
    <div class="offer-group">
      ${packs}
      <p class="offer-note">${icon("check", { size: 12 })}${t("ai.offer.topupNote")}</p>
    </div>`;
}

export function openTopUpDialog() {
  if (document.querySelector(".ai-topup-modal")) return;
  const account = getCachedAccount();
  const readOnly = isReadOnly(account);
  const period = aiQuotaPeriod();
  const limit = aiDailyLimit();
  const out = aiLimitReached();
  const topUp = canTopUp(account);
  const body = out
    ? t(bodyKey(readOnly, period), { limit })
    : aiPlanUsedUp() && topUp
      ? t("ai.offer.bodyOnExtras")
      : t(topUp ? "ai.topup.bodyAnytime" : "ai.topup.bodyTrialAnytime");
  const overlay = openModal({
    title: out ? t("ai.topup.title") : t("ai.topup.titleMore"),
    width: "min(480px,94vw)",
    bodyHTML: `
      <div class="ai-topup-modal">
        <p class="text-muted" style="margin:0 0 14px;font-size:13.5px;">${body}</p>
        ${topUp ? `<div class="offer-card" data-offer-body>${offerHTML()}</div>` : ""}
      </div>`,
    footHTML: topUp
      ? `<a class="btn btn-ghost" href="#/pricing" data-topup-plans>${t("ai.topup.seePlans")}</a><button type="button" class="btn btn-secondary" data-close-topup>${t("common.close")}</button>`
      : `<button type="button" class="btn btn-ghost" data-close-topup>${t("ai.topup.later")}</button><a class="btn btn-primary" href="#/pricing" data-topup-plans>${icon("arrowUp", { size: 14 })}${t("ai.topup.seePlans")}</a>`,
  });
  overlay.querySelector("[data-close-topup]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-topup-plans]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-offer-pay]");
    if (!btn) return;
    const key = btn.dataset.offerPay;
    const before = aiExtras();
    buyAddon(key, {
      isDone: () => { const now = aiExtras(); return key === AI_UNLIMITED.payKey ? now.unlimitedUntil > before.unlimitedUntil : now.credits > before.credits; },
      onDone: () => closeOverlay(overlay),
    });
  });
}

// Once per quota window, per browser tab session — enough to be noticed,
// never a popup on every failed click. The chat and the ⋯ menu keep a
// button for opening it again.
function shownKey() {
  return `brandlab:ai-topup-shown:${aiQuotaWindow()}`;
}
function alreadyShown() {
  try { return sessionStorage.getItem(shownKey()) === "1"; } catch { return false; }
}
function markShown() {
  try { sessionStorage.setItem(shownKey(), "1"); } catch { /* private mode: show again next time, harmless */ }
}
function autoOpen() {
  if (aiDailyLimit() === Infinity || alreadyShown()) return;
  markShown();
  openTopUpDialog();
}

let installed = false;
export function installTopUpNotice() {
  if (installed) return;
  installed = true;
  // An AI call that was refused (client pre-check or the server's 429).
  window.addEventListener("ai:quota-out", autoOpen);
  // The meter going from "some left" to "none left" — the last credit was
  // just spent by a call that succeeded, so no error ever fires; the chat
  // would simply lock its input without saying why.
  let wasOut = aiLimitReached();
  onChange(() => {
    const out = aiLimitReached();
    if (out && !wasOut && !document.body.classList.contains("tour-active")) autoOpen();
    wasOut = out;
  });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-ai-topup]");
    if (!btn) return;
    e.preventDefault();
    closeMenu(); // the ⋯ menu's AI popover, if that's where it was clicked
    openTopUpDialog();
  });
}
