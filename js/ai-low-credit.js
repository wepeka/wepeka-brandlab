// "Kredit AI sisa sedikit" — a gentle heads-up before the wall, so the
// owner isn't surprised mid-chat. js/ai-topup.js already handles the moment
// credits hit zero (its dialog); this covers the stretch just before it:
// 1..LOW_CREDIT_AT credits left in the current quota window.
//
// Never for an unmetered account: the admin, AI Sepuasnya while it runs, or
// a read-only account (no credits at all — the plan screen covers that).
//
// Two surfaces, both quiet and once per quota window (today / this month /
// the trial — js/ai-usage.js aiQuotaWindow):
//   - a toast the moment the count drops into the low zone, wherever the
//     owner is (installLowCreditWatch, installed by Beranda on first paint);
//   - a one-line note on Beranda until the owner closes it.
// The only link is the existing "Lihat paket" (#/pricing) — checkout is
// closed for now, so nothing here sells.
import { aiDailyLimit, aiUsageRemaining, aiQuotaPeriod, aiQuotaWindow, aiExtras } from "./ai-usage.js";
import { getCachedAccount, isAdmin, isReadOnly, currentUid } from "./account.js";
import { onChange } from "./store.js";
import { icon } from "./icons.js";
import { toast, escapeHtml as esc } from "./dom.js";
import { t } from "./i18n.js";

export const LOW_CREDIT_AT = 10;

// Pure: is this a "few credits left" moment? → { n, period } | null.
export function lowCreditState({ remaining, limit, period = "day", unlimited = false, admin = false, readOnly = false }) {
  if (admin || readOnly || unlimited) return null;
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return null;
  if (remaining <= 0 || remaining > LOW_CREDIT_AT) return null;
  return { n: Math.floor(remaining), period: ["day", "month", "total"].includes(period) ? period : "day" };
}

export function currentLowCredit() {
  try {
    return lowCreditState({
      remaining: aiUsageRemaining(),
      limit: aiDailyLimit(),
      period: aiQuotaPeriod(),
      unlimited: aiExtras().unlimited,
      admin: isAdmin(currentUid()),
      readOnly: isReadOnly(getCachedAccount()),
    });
  } catch {
    return null; // no account/usage loaded yet — say nothing rather than guess
  }
}

export function lowCreditText(state) {
  return t(`aiLow.${state.period}`, { n: state.n });
}

// Per quota window, per device. Storage can be blocked (private window):
// then the note simply shows again next time — never a crash.
const key = (what) => `brandlab:ai-low-${what}:${aiQuotaWindow()}`;
function flag(what) {
  try { return localStorage.getItem(key(what)) === "1"; } catch { return false; }
}
function setFlag(what) {
  try { localStorage.setItem(key(what), "1"); } catch { /* not remembered */ }
}

// Beranda's one-line note (empty string when there's nothing to say).
export function lowCreditNoteHTML() {
  const state = currentLowCredit();
  if (!state || flag("closed")) return "";
  setFlag("toasted"); // seen here — no toast for it later in this window
  return `
    <div class="ai-low-note" role="status">
      <span class="ai-low-icon">${icon("bot", { size: 15 })}</span>
      <p class="ai-low-text">${esc(lowCreditText(state))}</p>
      <a class="link ai-low-link" href="#/pricing">${esc(t("set.plan.see"))}</a>
      <button type="button" class="icon-btn ai-low-close" data-ai-low-close aria-label="${esc(t("common.close"))}" title="${esc(t("common.close"))}">${icon("x", { size: 13 })}</button>
    </div>`;
}
export function wireLowCreditNote(root) {
  root.querySelector("[data-ai-low-close]")?.addEventListener("click", () => {
    setFlag("closed");
    setFlag("toasted"); // closing it here counts as "seen" — no toast after
    root.querySelector(".ai-low-note")?.remove();
  });
}

// The moment it drops into the low zone: one toast per window. Installed
// once (idempotent) — Beranda is the first page of every brand, so it's in
// place before the chat is used.
let watching = false;
export function installLowCreditWatch() {
  if (watching) return;
  watching = true;
  const check = () => {
    const state = currentLowCredit();
    if (!state || flag("toasted")) return;
    if (typeof document !== "undefined") {
      if (document.body?.classList?.contains("tour-active")) return;
      // On Beranda the note itself says it (the repaint after this change).
      if (document.querySelector?.("main.view-home")) return;
    }
    setFlag("toasted");
    toast(lowCreditText(state), "info");
  };
  onChange(check);
}
