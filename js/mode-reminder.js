// "Udah seminggu — mau coba mode Pro?" A one-time banner for accounts that
// have been on Pemula for at least 7 days. Answering either way (or closing
// it) records settings.proModeReminderAt so it never asks again on any
// device. Reuses the .tour-prompt/.tour-prompt-* CSS classes (a plain
// dismissible top banner look), not the tour-offer banner itself.
import { getMode, setMode } from "./mode.js";
import { getSettings, updateSettings } from "./store.js";
import { getCachedAccount, isReadOnly } from "./account.js";
import { icon } from "./icons.js";
import { qs, toast } from "./dom.js";
import { t } from "./i18n.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let shownThisSession = false;

function accountAgeMs(account) {
  const raw = account?.createdAt;
  const ms = typeof raw?.toMillis === "function" ? raw.toMillis() : Number(raw);
  return Number.isFinite(ms) && ms > 0 ? Date.now() - ms : 0;
}

export function maybeShowModeReminder() {
  if (shownThisSession) return;
  shownThisSession = true;
  const account = getCachedAccount();
  if (getMode() !== "guided" || isReadOnly(account)) return;
  if (getSettings().proModeReminderAt) return;
  if (accountAgeMs(account) < WEEK_MS) return;

  const bar = document.createElement("div");
  bar.className = "tour-prompt mode-reminder";
  bar.innerHTML = `
    <div class="tour-prompt-inner">
      ${icon("sparkle", { size: 16 })}
      <span>${t("modeReminder.text")}</span>
      <button type="button" class="btn btn-sm tour-prompt-secondary" data-stay>${t("modeReminder.stay")}</button>
      <button type="button" class="btn btn-sm btn-primary tour-prompt-cta" data-pro>${t("modeReminder.cta")}</button>
      <button type="button" class="icon-btn tour-prompt-close" aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>
  `;
  document.body.insertBefore(bar, document.body.firstChild);
  requestAnimationFrame(() => bar.classList.add("in"));

  const answer = () => {
    updateSettings({ proModeReminderAt: Date.now() });
    bar.classList.remove("in");
    setTimeout(() => bar.remove(), 250);
  };
  qs("[data-stay]", bar).addEventListener("click", answer);
  qs(".tour-prompt-close", bar).addEventListener("click", answer);
  qs("[data-pro]", bar).addEventListener("click", () => {
    answer();
    setMode("advanced");
    toast(t("modeReminder.switched"));
  });
}
