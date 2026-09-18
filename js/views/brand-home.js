import { getCachedAccount, isLifetime } from "../account.js";
import { getBrand, listContent, listCampaigns, campaignPhaseCoverage, listOverdueAndDueSoon, getSettings, onChange, updateBrand } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, formatNumber, qs, qsa, escapeHtml as escapeText } from "../dom.js";
import { getTracker, trackerTotals, monthRange } from "../sales-tracker.js";
import { openContentEditor } from "./content-editor.js";
import { t } from "../i18n.js";
import { helpButtonHTML, wireHelpButtons } from "../help.js";
import { analyticsSectionHTML, wireAnalyticsSection } from "./brand-home-analytics.js";
import { celebrateBuilderCompleteIfFlagged } from "./brand-builder.js";
import { brandTopAction } from "../next-action.js";
import { widgetCardHTML, widgetCollapsedHTML, wireWidgetToggle } from "../widget-card.js";

// The brand's command center — a "what do I do next" strip and shortcut
// widgets up top (unchanged from the original spec below), plus a
// customizable analytics section further down for the "grafik2 dan stats
// analytics" Advanced mode promises over Guided mode's bare 3-app view (see
// js/views/beginner-home.js's tour copy). The two concerns stay in separate
// files — brand-home-analytics.js owns the widget catalog and chart
// rendering — so this file's original "what to do next" job doesn't get
// buried under chart code.
export function render(root, { brandId }) {
  const state = { topContentPeriod: "all" };
  const refresh = () => paint(root, brandId, state, refresh);
  refresh();
  return onChange(refresh);
}

// Only the 8 fields the wizard's own steps (audience, problem, trust,
// plan, foundation, identity's tagline) treat as the real narrative —
// NOT personality/values/productsServices, which are the identity step's
// own chip lists and which that step's copy explicitly calls optional
// ("Boleh dilewatin dulu kalau belum kepikiran"). Counting them here used
// to mean someone who filled every field the wizard called required still
// saw "72%" instead of "100%" — a real bug a user hit and reported, not
// just a rounding quirk. This now matches brand-builder.js's own
// definition of "Brand DNA done" (its 5 DNA_STAGES never check these
// three either).
export function brandDnaCompleteness(dna = {}) {
  // One per wizard step (SB7 + identity) — purpose/vision/values are
  // optional extras on the Review screen, so they don't count here.
  const fields = [
    dna.targetAudience, dna.problemSolved, dna.differentiation, dna.mission,
    dna.callToAction, dna.successOutcome, dna.failureOutcome, dna.tagline,
  ];
  const filled = fields.filter(Boolean).length;
  return { filled, total: fields.length };
}

// "Brand DNA is finished" — every wizard field filled AND the person has
// saved it themselves. "Isi semua pakai AI" (js/views/brand-dna.js
// wireAiFill) can still fill all eight answers in one click, which fills the
// fields without anyone having read them; that draft carries aiDraftPending
// until a real save clears it. Anything that ticks a box or unlocks a next step has to go
// through here, never through the raw field count.
export function brandDnaDone(brand = {}) {
  const { filled, total } = brandDnaCompleteness(brand.brandDNA);
  return total > 0 && filled >= total && !brand.brandDNA?.aiDraftPending;
}

function paint(root, brandId, state, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  celebrateBuilderCompleteIfFlagged(brandId);
  const dnaProgress = brandDnaCompleteness(brand.brandDNA);
  const campaigns = listCampaigns(brandId);
  const campaignCount = campaigns.length;
  const allContent = listContent(brandId);
  const published = allContent.filter((c) => c.status === "published").length;
  const scheduled = allContent.filter((c) => c.status === "scheduled");
  const upNext = [...scheduled].sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999")).slice(0, 5);
  const brandOverdue = listOverdueAndDueSoon().overdue.filter((x) => x.brand.id === brandId);
  const collapsed = new Set(brand.homeCollapsed || []);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${t("brandHome.eyebrow")}${helpButtonHTML("brand-home")}</div>
        <h1>${brand.name}</h1>
      </div>
      ${avatarHTML(brand, "width:64px;height:64px;border-radius:16px;font-size:24px;flex:none;")}
    </div>

    ${overdueBannerHTML(brandOverdue)}

    ${healthStripHTML(brandId, dnaProgress, campaigns, allContent)}

    <div class="brand-widget-grid">
      ${brandBuilderWidgetHTML(dnaProgress, brand.brandGuidelines)}
      ${contentOsWidgetHTML(allContent.length, published)}
      ${campaignWidgetHTML(campaignCount, brandTopAction({ brand, campaigns, content: allContent, settings: getSettings() }))}
      ${copyWidgetHTML()}
      ${salesWidgetHTML(brand)}
    </div>

    ${
      collapsed.has("upNext")
        ? widgetCollapsedHTML("upNext", "calendar", t("brandHome.upNext.title"), t("brandHome.upNext.summary", { count: upNext.length }))
        : widgetCardHTML("upNext", "calendar", t("brandHome.upNext.title"), `
            <div class="card card-tight" style="margin-bottom:0;">
              ${
                upNext.length
                  ? upNext.map(upNextRow).join("")
                  : `<div class="table-empty" style="padding:28px;">${t("brandHome.upNext.empty")}</div>`
              }
            </div>
          `, { extraHead: `<a class="link" href="#/brand/${brandId}/content-os/calendar">${t("brandHome.upNext.calendarLink")}</a>` })
    }

    ${analyticsSectionHTML(allContent, getSettings(), state)}
  `;

  wireHelpButtons(root);
  wireAnalyticsSection(root, state, refresh);
  wireWidgetToggle(root, { collapsedList: brand.homeCollapsed, save: (next) => updateBrand(brandId, { homeCollapsed: next }), refresh });

  qsa("[data-go]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      location.hash = target === "campaigns" || target === "builder" || target === "content-os" || target === "copy" || target === "sales"
        ? `#/brand/${brandId}/${target}`
        : `#/brand/${brandId}`;
    });
  });

  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });
}

function copyWidgetHTML() {
  return `
    <button type="button" class="brand-widget glass-card widget-copy widget-featured" data-go="copy">
      <div class="copy-badge">${icon("chat", { size: 22 })}</div>
      <div>
        <h3>${t("brandHome.widget.copy.title")}${isLifetime(getCachedAccount()) ? "" : ` <span class="lifetime-tag">${icon("lock", { size: 11 })}${t("app.lifetimeOnly")}</span>`}</h3>
        <p>${t("brandHome.widget.copy.sub")}</p>
      </div>
    </button>
  `;
}

// Sales Tracker sits right next to Copy Studio. With sales logged it shows
// this month's real numbers; before that, what it's for.
function salesWidgetHTML(brand) {
  const tracker = getTracker(brand);
  const month = trackerTotals(tracker, monthRange());
  return `
    <button type="button" class="brand-widget glass-card widget-sales widget-featured" data-go="sales">
      <div class="folder-badge">${icon("target", { size: 22 })}</div>
      <div>
        <h3>${t("brandHome.widget.sales.title")}</h3>
        <p>${tracker.entries.length ? t("brandHome.widget.sales.month", { qty: formatNumber(month.rangeQty), revenue: `Rp ${formatNumber(month.rangeRevenue)}` }) : t("brandHome.widget.sales.empty")}</p>
      </div>
    </button>
  `;
}

// Hard to miss on purpose — this is the "you forgot to upload" surface,
// separate from (and louder than) the small bell-icon badge in the topbar,
// which is easy to just never notice. Sits right at the top of the page
// someone lands on when they open this brand.
function overdueBannerHTML(overdue) {
  if (!overdue.length) return "";
  const extra = overdue.length - 3;
  return `
    <div class="overdue-banner glass-card">
      <div class="overdue-banner-head">
        ${icon("bell", { size: 18 })}
        <div>
          <div class="overdue-banner-title">${t("brandHome.overdue.title", { count: overdue.length })}</div>
          <div class="overdue-banner-sub">${t("brandHome.overdue.sub")}</div>
        </div>
      </div>
      <div class="overdue-banner-list">
        ${overdue
          .slice(0, 3)
          .map(
            (x) => `
          <button type="button" class="overdue-banner-item" data-open-content="${x.content.id}">
            <span class="t">${escapeText(x.content.title || t("common.untitled"))}</span>
            <span class="d">${formatDate(x.content.scheduleDate)}</span>
          </button>`
          )
          .join("")}
        ${extra > 0 ? `<div class="text-faint" style="font-size:12px;padding:4px 2px;">${t("brandHome.overdue.more", { count: extra })}</div>` : ""}
      </div>
    </div>
  `;
}

// The "everything talks to everything" proof — four diagnosis-and-action
// indicators reusing the existing .health-badge good/average/poor language
// (js/views/dashboard.js) instead of inventing a new visual system. Each
// one links to where you'd actually go fix it, same "tell someone what to
// do next" spirit as the widgets below, just zoomed out to brand-wide.
function healthTier(pct) {
  if (pct >= 70) return "good";
  if (pct >= 40) return "average";
  return "poor";
}

function campaignCoveragePct(campaigns, content) {
  const active = campaigns.filter((c) => c.status !== "archived");
  if (!active.length) return null;
  const ratios = active.map((c) => {
    const { filled, total } = campaignPhaseCoverage(c, content);
    return total ? filled / total : 0;
  });
  return Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100);
}

function contentGapCount(content) {
  const scheduledDates = new Set(content.filter((c) => c.scheduleDate).map((c) => c.scheduleDate));
  let gap = 0;
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (!scheduledDates.has(d.toISOString().slice(0, 10))) gap++;
  }
  return gap;
}

function uncoveredCampaignCount(campaigns, content) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const active = campaigns.filter((c) => c.status !== "archived" && c.startDate && c.endDate && c.endDate >= todayISO);
  return active.filter((c) => !content.some((ct) => ct.campaignId === c.id && ct.scheduleDate && ct.scheduleDate >= c.startDate && ct.scheduleDate <= c.endDate)).length;
}

function healthStripHTML(brandId, dnaProgress, campaigns, content) {
  const dnaPct = dnaProgress.total ? Math.round((dnaProgress.filled / dnaProgress.total) * 100) : 0;
  const coveragePct = campaignCoveragePct(campaigns, content);
  const gap = contentGapCount(content);
  const uncovered = uncoveredCampaignCount(campaigns, content);

  const items = [
    { label: t("brandHome.health.dna"), tier: healthTier(dnaPct), value: `${dnaPct}%`, href: `#/brand/${brandId}/builder` },
    coveragePct === null
      ? { label: t("brandHome.health.coverage"), tier: "poor", value: t("brandHome.health.noCampaigns"), href: `#/brand/${brandId}/campaigns` }
      : { label: t("brandHome.health.coverage"), tier: healthTier(coveragePct), value: `${coveragePct}%`, href: `#/brand/${brandId}/campaigns` },
    { label: t("brandHome.health.gap"), tier: gap === 0 ? "good" : gap <= 3 ? "average" : "poor", value: gap === 0 ? t("brandHome.health.fullyBooked") : t("brandHome.health.emptyDays", { count: gap }), href: `#/brand/${brandId}/content-os/calendar` },
    // With no campaigns at all, "0 uncovered" is vacuously true — showing
    // it green next to a red "no campaigns" badge read as a contradiction,
    // so it's a neutral "nothing to cover yet" instead.
    !campaigns.length
      ? { label: t("brandHome.health.calendarWindow"), tier: "none", value: t("brandHome.health.noCampaigns"), href: `#/brand/${brandId}/campaigns` }
      : { label: t("brandHome.health.calendarWindow"), tier: uncovered === 0 ? "good" : "poor", value: uncovered === 0 ? t("brandHome.health.allCovered") : t("brandHome.health.uncovered", { count: uncovered }), href: `#/brand/${brandId}/content-os/calendar` },
  ];

  return `
    <div class="brand-health-strip">
      ${items.map((it) => `
        <a class="brand-health-item glass-card" href="${it.href}">
          <span class="health-badge health-${it.tier}">${it.value}</span>
          <span class="brand-health-label">${it.label}</span>
        </a>
      `).join("")}
    </div>
  `;
}

// Each widget below is shaped around what it actually represents (a ring
// for DNA completeness, a mini journey for campaigns, swatches for
// guidelines, a card stack for content) instead of reusing one identical
// icon-title-subtitle card five times — same nav behavior (data-go), just
// a shape that hints at the destination.
// One widget, not two — Brand DNA and Brand Guidelines both live inside
// Brand Builder now (no separate top-level entry for either, see
// js/layout.js), so the Home dashboard shouldn't offer two doors into the
// same place either. Shows both signals at once (DNA completeness ring +
// the chosen palette/font) since a single click leads to the same hub
// either way.
function brandBuilderWidgetHTML(progress, guidelines) {
  const pct = progress.total ? progress.filled / progress.total : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  const hasColors = !!guidelines?.colors?.primary;
  const colors = hasColors
    ? ["primary", "secondary", "accent", "background", "text"].map((k) => guidelines.colors[k])
    : ["var(--surface-2)", "var(--surface-2)", "var(--surface-2)", "var(--surface-2)", "var(--surface-2)"];
  return `
    <button type="button" class="brand-widget glass-card widget-dna widget-featured" data-go="builder">
      <div class="ring-wrap">
        <svg viewBox="0 0 72 72">
          <circle class="ring-track" cx="36" cy="36" r="${r}"></circle>
          <circle class="ring-fill" cx="36" cy="36" r="${r}" stroke-dasharray="${pct * c} ${c}"></circle>
        </svg>
        <div class="ring-pct">${Math.round(pct * 100)}%</div>
      </div>
      <div>
        <h3>${t("nav.builder")}</h3>
        <p>${progress.filled ? t("brandHome.widget.dna.filled", { filled: progress.filled, total: progress.total }) : t("brandHome.widget.dna.empty")}</p>
      </div>
      <div class="swatch-row">${colors.map((c) => `<span class="swatch" style="background:${c};"></span>`).join("")}</div>
    </button>
  `;
}

function campaignWidgetHTML(count, top = null) {
  const slots = 5;
  const filled = Math.min(count, slots);
  let dots = "";
  for (let i = 0; i < slots; i++) {
    if (i > 0) dots += `<span class="mj-line ${i < filled ? "filled" : ""}"></span>`;
    dots += `<span class="mj-dot ${i < filled ? "filled" : ""}"></span>`;
  }
  return `
    <button type="button" class="brand-widget glass-card widget-campaign widget-featured" data-go="campaigns">
      <div class="icon-wrap">${icon("bulb", { size: 20 })}</div>
      <h3>${t("brandHome.widget.campaign.title")}</h3>
      <p>${count ? t("brandHome.widget.campaign.count", { count }) : t("brandHome.widget.campaign.empty")}</p>
      ${top ? `<p class="campaign-card-next" style="margin:6px 0 0;">${icon("arrowRight", { size: 12 })}<span>${escapeText(top.campaign.name || "Campaign")}: ${escapeText(top.action.label)}</span></p>` : ""}
      <div class="mini-journey">${dots}</div>
    </button>
  `;
}

function contentOsWidgetHTML(total, published) {
  return `
    <button type="button" class="brand-widget glass-card widget-content-os widget-featured" data-go="content-os">
      <div class="stack">
        <span class="stack-card"></span>
        <span class="stack-card"></span>
        <span class="stack-card">${total}</span>
      </div>
      <div>
        <h3>${t("brandHome.widget.contentOs.title")}</h3>
        <p>${t("brandHome.widget.contentOs.sub", { total, published })}</p>
      </div>
    </button>
  `;
}


function upNextRow(c) {
  return `
    <div class="top-content-row" data-open-content="${c.id}" style="cursor:pointer;">
      <div class="ti">
        <div class="t">${escapeText(c.title || t("common.untitled"))}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(c.scheduleDate)}</div>
      </div>
      <span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span>
    </div>
  `;
}
