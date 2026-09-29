// "AI credit habis" — the one place that tells someone their AI credits ran
// out and how to get more. Paid accounts get the top-up packages (ordered
// over WhatsApp, added by the Wepeka team); a trial or a read-only account
// gets the plans instead, since top-ups are only sold on top of a plan
// (same rule as the pricing page's add-ons).
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
import { aiLimitReached, aiDailyLimit, aiQuotaPeriod, aiQuotaWindow } from "./ai-usage.js";
import { getCachedAccount, accessState, isReadOnly } from "./account.js";
import { SUPPORT_WA_NUMBER, AI_TOPUPS } from "./site-links.js";

const rp = (n) => `Rp ${Number(n).toLocaleString(getLang() === "en" ? "en-US" : "id-ID")}`;

// Top-ups are sold to accounts that already pay; everyone else upgrades.
export function canTopUp(account = getCachedAccount()) {
  return accessState(account) === "paid" && !isReadOnly(account);
}

function bodyKey(readOnly, period) {
  if (readOnly) return "ai.topup.bodyReadonly";
  if (period === "total") return "ai.topup.bodyTotal";
  return period === "month" ? "ai.topup.bodyMonth" : "ai.topup.bodyDay";
}

function packageHTML(p) {
  const name = t("ai.topup.credits", { n: p.credits.toLocaleString(getLang() === "en" ? "en-US" : "id-ID") });
  const text = encodeURIComponent(t("ai.topup.waMessage", { name, price: rp(p.price) }));
  return `<a class="pricing-addon ai-topup-pack" href="https://wa.me/${SUPPORT_WA_NUMBER}?text=${text}" target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(name)}</span><strong>${rp(p.price)}</strong><em>${icon("chat", { size: 12 })}${t("ai.topup.viaWa")}</em>
    </a>`;
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
    : t(topUp ? "ai.topup.bodyAnytime" : "ai.topup.bodyTrialAnytime");
  const overlay = openModal({
    title: out ? t("ai.topup.title") : t("ai.topup.titleMore"),
    width: "min(460px,92vw)",
    bodyHTML: `
      <div class="ai-topup-modal">
        <p class="text-muted" style="margin:0 0 16px;font-size:13.5px;">${body}</p>
        ${topUp
          ? `<div class="ai-topup-packs">${AI_TOPUPS.map(packageHTML).join("")}</div>
             <p class="text-faint" style="margin:12px 0 0;font-size:12px;">${t("ai.topup.how")}</p>`
          : ""}
      </div>`,
    footHTML: topUp
      ? `<a class="btn btn-ghost" href="#/pricing" data-topup-plans>${t("ai.topup.seePlans")}</a><button type="button" class="btn btn-secondary" data-close-topup>${t("common.close")}</button>`
      : `<button type="button" class="btn btn-ghost" data-close-topup>${t("ai.topup.later")}</button><a class="btn btn-primary" href="#/pricing" data-topup-plans>${icon("arrowUp", { size: 14 })}${t("ai.topup.seePlans")}</a>`,
  });
  overlay.querySelector("[data-close-topup]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelector("[data-topup-plans]")?.addEventListener("click", () => closeOverlay(overlay));
  overlay.querySelectorAll(".ai-topup-pack").forEach((a) => a.addEventListener("click", () => closeOverlay(overlay)));
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
