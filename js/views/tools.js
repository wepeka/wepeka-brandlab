// Tools hub (R2, Brief Revisi 2 fase 2): the front door for the app-shaped
// features that used to hide inside the ⋯ menu — Copy Studio and the Sales
// Tracker — plus the front door of the Brainstorm partner
// (js/views/brainstorm.js). Never gated by mode
// or by brand identity — unlike Campaign/Konten, there's nothing here that
// needs the brand's DNA filled in first.
import { backLinkHTML } from "../back-link.js";
import { getBrand } from "../store.js";
import { getTracker, trackerTotals, monthRange } from "../sales-tracker.js";
import { escapeHtml, formatNumber } from "../dom.js";
import { icon } from "../icons.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { t } from "../i18n.js";

const rp = (n) => `Rp ${formatNumber(Math.round(n || 0))}`;

const TOUR_STEPS = [
  { selector: ".tool-card:nth-child(1)", title: t("tools.card.brainstorm.title"), body: t("tools.tour.brainstorm") },
  { selector: ".tool-card:nth-child(2)", title: t("tools.card.copy.title"), body: t("tools.tour.copy") },
  { selector: ".tool-card:nth-child(3)", title: t("tools.card.sales.title"), body: t("tools.tour.sales") },
];

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  paint(root, brand);
  return () => {};
}

function toolCardHTML({ href, iconName, label, helpKey, desc, badge, primary, statusLine }) {
  return `
    <a class="card dark-surface tool-card ${primary ? "is-next" : ""}" href="${href}">
      ${badge ? `<span class="tool-card-badge">${escapeHtml(badge)}</span>` : ""}
      <div class="bb-hub-icon">${icon(iconName, { size: 28 })}</div>
      <h2 class="flex items-center gap-6">${label}${helpKey ? helpButtonHTML(helpKey) : ""}</h2>
      <p>${desc}</p>
      ${statusLine ? `<div class="tool-card-status">${statusLine}</div>` : ""}
    </a>
  `;
}

function paint(root, brand) {
  const tracker = getTracker(brand);
  const totals = trackerTotals(tracker, monthRange());
  const salesStatus = t("tools.card.sales.status", { count: totals.rangeCount, revenue: rp(totals.rangeRevenue) });

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${backLinkHTML(`#/brand/${brand.id}`, t("nav.home"))} · ${t("tools.eyebrow")}${helpButtonHTML("tools")}${guideVideoButtonHTML("tools")}</div>
        <h1>${escapeHtml(brand.name)}</h1>
        <p class="text-muted" style="font-size:13px;margin-top:4px;max-width:640px;">${t("tools.sub")}</p>
      </div>
    </div>
    <div class="tools-grid">
      ${toolCardHTML({
        href: `#/brand/${brand.id}/brainstorm`,
        iconName: "chat",
        label: t("tools.card.brainstorm.title"),
        desc: t("tools.card.brainstorm.desc"),
        primary: true,
      })}
      ${toolCardHTML({
        href: `#/brand/${brand.id}/copy`,
        iconName: "edit",
        label: t("tools.card.copy.title"),
        helpKey: "copy-studio",
        desc: t("tools.card.copy.desc"),
      })}
      ${toolCardHTML({
        href: `#/brand/${brand.id}/sales`,
        iconName: "chart",
        label: t("tools.card.sales.title"),
        helpKey: "sales",
        desc: t("tools.card.sales.desc"),
        statusLine: salesStatus,
      })}
    </div>
  `;
  wireHelpButtons(root);
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
}
