// A bold, self-appearing reminder banner — unlike the bell icon's dropdown
// (js/layout.js, opt-in, only shown when clicked), this slides down from
// the top of the screen on its own once per app-open/login, the same
// "module-level flag reset on every boot()" pattern js/brandlab-intro.js
// already uses. Deliberately not shown more than once a session (and not
// on every hashchange) so it stays a nudge, not spam. Only ever reports
// what's real: overdue content, brands whose Brand DNA is still
// incomplete, and mission-ladder campaigns that need attention (an
// active-weeks streak about to break, milestone numbers gone stale).
import { listBrands, listContent, listCampaigns, listOverdueAndDueSoon, campaignContentPool, streakBreakInDays } from "./store.js";
import { icon } from "./icons.js";
import { qs, escapeHtml } from "./dom.js";
import { brandDnaCompleteness } from "./views/brand-home.js";
import { t } from "./i18n.js";

let shownThisSession = false;

// Warn this many days ahead of a streak break — enough time to publish one
// piece, short enough not to nag all week.
const STREAK_WARN_DAYS = 2;
const STALE_MILESTONE_MS = 14 * 24 * 60 * 60 * 1000;

function dnaIncompleteBrands() {
  return listBrands().filter((b) => {
    const { filled, total } = brandDnaCompleteness(b.brandDNA);
    return filled < total;
  });
}

// One entry per campaign problem, streaks first (time-critical).
function campaignAlerts() {
  const streaks = [];
  const stale = [];
  const now = Date.now();
  listBrands().forEach((brand) => {
    const content = listContent(brand.id);
    listCampaigns(brand.id)
      .filter((c) => c.status !== "archived" && c.missions?.length)
      .forEach((campaign) => {
        const idx = campaign.missions.findIndex((m) => !m.completedAt);
        if (idx === -1) return;
        const mission = campaign.missions[idx];
        if (mission.milestones.some((m) => m.kind === "auto-weeks")) {
          const brk = streakBreakInDays(campaignContentPool(campaign, content), STREAK_WARN_DAYS);
          if (brk) streaks.push({ type: "streak", brand, campaign, ...brk });
        }
        // A level that just started isn't stale: fall back to when this
        // mission began (previous level's completion, or campaign creation).
        const startedAt = idx > 0 ? campaign.missions[idx - 1].completedAt : campaign.createdAt;
        const count = mission.milestones.filter((m) => {
          if (m.kind !== "number") return false;
          const at = m.updatedAt || startedAt;
          return at && now - at > STALE_MILESTONE_MS;
        }).length;
        if (count) stale.push({ type: "stale", brand, campaign, count });
      });
  });
  return [...streaks, ...stale];
}

// Returns true when the banner actually showed — main.js (7) uses this to
// cap each boot at one banner: maybeShowModeReminder only runs when this
// returns false, so the two never stack on top of each other.
export function maybeShowProactiveNotif() {
  if (shownThisSession) return false;
  shownThisSession = true;

  const { overdue } = listOverdueAndDueSoon();
  const incompleteBrands = dnaIncompleteBrands();
  const alerts = campaignAlerts();
  if (!overdue.length && !incompleteBrands.length && !alerts.length) return false;

  const parts = [];
  if (overdue.length) parts.push(t("proactiveNotif.overdue", { count: overdue.length }));
  // At most two campaign lines — the banner is a nudge, not a report.
  alerts.slice(0, 2).forEach((a) => {
    parts.push(
      a.type === "streak"
        ? t("proactiveNotif.streak", { name: a.campaign.name || "Campaign", weeks: a.weeks, days: a.days })
        : t("proactiveNotif.staleMilestones", { name: a.campaign.name || "Campaign", count: a.count })
    );
  });
  if (incompleteBrands.length) parts.push(t("proactiveNotif.dnaIncomplete", { count: incompleteBrands.length }));

  // One button, pointed at the most urgent thing on the list.
  const first = alerts[0];
  const cta = overdue.length
    ? { href: `#/brand/${overdue[0].brand.id}/content-os`, label: t("proactiveNotif.cta") }
    : first?.type === "streak"
    ? { href: `#/brand/${first.brand.id}/content-os`, label: t("proactiveNotif.ctaPublish") }
    : first?.type === "stale"
    ? { href: `#/brand/${first.brand.id}/campaigns/${first.campaign.id}`, label: t("proactiveNotif.ctaMilestones") }
    : null;

  const bar = document.createElement("div");
  bar.className = "proactive-notif";
  bar.innerHTML = `
    <div class="proactive-notif-inner">
      ${icon("bell", { size: 16 })}
      <span>${parts.map(escapeHtml).join(" · ")}</span>
      ${cta ? `<button type="button" class="btn btn-sm proactive-notif-cta" data-go="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</button>` : ""}
      <button type="button" class="icon-btn proactive-notif-close" aria-label="${t("proactiveNotif.dismiss")}">${icon("x", { size: 14 })}</button>
    </div>
  `;
  // Prepended as the first element in body (before #app), in normal
  // document flow — NOT appendChild — so it pushes the sticky topbar down
  // instead of overlaying it. It briefly used position:fixed, which made it
  // occupy the exact same screen rect as .topbar (both anchored at top:0)
  // and, being the higher z-index, silently swallowed every click meant
  // for the topbar's own nav links/icons underneath it until dismissed.
  document.body.insertBefore(bar, document.body.firstChild);
  requestAnimationFrame(() => bar.classList.add("in"));

  const dismiss = () => {
    bar.classList.remove("in");
    setTimeout(() => bar.remove(), 250);
  };
  qs(".proactive-notif-close", bar).addEventListener("click", dismiss);
  qs(".proactive-notif-cta", bar)?.addEventListener("click", (e) => {
    location.hash = e.currentTarget.dataset.go;
    dismiss();
  });
  return true;
}
