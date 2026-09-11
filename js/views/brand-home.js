import { getBrand, listContent, listCampaigns, campaignPhaseCoverage, listOverdueAndDueSoon, onChange } from "../store.js";
import { icon } from "../icons.js";
import { avatarHTML, formatDate, qs, qsa } from "../dom.js";
import { openContentEditor } from "./content-editor.js";
import { t } from "../i18n.js";

// The brand's command center — five clear choices, nothing else. Explicitly
// NOT the stats-heavy analytics page (that lives inside Content OS now) —
// per the user's own product spec, this page should tell someone exactly
// what to do next, not show them numbers.
export function render(root, { brandId }) {
  const refresh = () => paint(root, brandId, refresh);
  refresh();
  return onChange(refresh);
}

function brandDnaCompleteness(dna = {}) {
  const fields = [
    dna.tagline, dna.purpose, dna.vision, dna.mission, dna.targetAudience,
    dna.problemSolved, dna.positioning, dna.differentiation,
    dna.personality?.length, dna.values?.length, dna.productsServices?.length,
  ];
  const filled = fields.filter(Boolean).length;
  return { filled, total: fields.length };
}

function paint(root, brandId, refresh) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return;
  }
  const dnaProgress = brandDnaCompleteness(brand.brandDNA);
  const campaigns = listCampaigns(brandId);
  const campaignCount = campaigns.length;
  const allContent = listContent(brandId);
  const published = allContent.filter((c) => c.status === "published").length;
  const scheduled = allContent.filter((c) => c.status === "scheduled");
  const upNext = [...scheduled].sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999")).slice(0, 5);
  const brandOverdue = listOverdueAndDueSoon().overdue.filter((x) => x.brand.id === brandId);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">${t("brandHome.eyebrow")}</div>
        <h1>${brand.name}</h1>
      </div>
      ${avatarHTML(brand, "width:64px;height:64px;border-radius:16px;font-size:24px;flex:none;")}
    </div>

    ${overdueBannerHTML(brandOverdue)}

    ${healthStripHTML(brandId, dnaProgress, campaigns, allContent)}

    <div class="brand-widget-grid">
      ${dnaWidgetHTML(dnaProgress)}
      ${campaignWidgetHTML(campaignCount)}
      ${guidelinesWidgetHTML(brand.brandGuidelines)}
      ${contentOsWidgetHTML(allContent.length, published)}
      ${salesWidgetHTML()}
    </div>

    <div class="section-title" style="margin-top:0;">
      <h2>${t("brandHome.upNext.title")}</h2>
      <a class="link" href="#/brand/${brandId}/content-os/calendar">${t("brandHome.upNext.calendarLink")}</a>
    </div>
    <div class="card card-tight">
      ${
        upNext.length
          ? upNext.map(upNextRow).join("")
          : `<div class="table-empty" style="padding:28px;">${t("brandHome.upNext.empty")}</div>`
      }
    </div>
  `;

  qsa("[data-go]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      location.hash = target === "campaigns" || target === "builder" || target === "sales" || target === "content-os"
        ? `#/brand/${brandId}/${target}`
        : `#/brand/${brandId}`;
    });
  });

  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });
}

// Hard to miss on purpose — this is the "you forgot to upload" surface,
// separate from (and louder than) the small bell-icon badge in the topbar,
// which is easy to just never notice. Sits right at the top of the page
// someone lands on when they open this brand.
function overdueBannerHTML(overdue) {
  if (!overdue.length) return "";
  const extra = overdue.length - 3;
  return `
    <div class="overdue-banner">
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
            <span class="t">${escapeText(x.content.title || "Untitled")}</span>
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
    { label: t("brandHome.health.calendarWindow"), tier: uncovered === 0 ? "good" : "poor", value: uncovered === 0 ? t("brandHome.health.allCovered") : t("brandHome.health.uncovered", { count: uncovered }), href: `#/brand/${brandId}/content-os/calendar` },
  ];

  return `
    <div class="brand-health-strip">
      ${items.map((it) => `
        <a class="brand-health-item" href="${it.href}">
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
function dnaWidgetHTML(progress) {
  const pct = progress.total ? progress.filled / progress.total : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  return `
    <button type="button" class="brand-widget widget-dna" data-go="builder">
      <div class="ring-wrap">
        <svg viewBox="0 0 72 72">
          <circle class="ring-track" cx="36" cy="36" r="${r}"></circle>
          <circle class="ring-fill" cx="36" cy="36" r="${r}" stroke-dasharray="${pct * c} ${c}"></circle>
        </svg>
        <div class="ring-pct">${Math.round(pct * 100)}%</div>
      </div>
      <div>
        <h3>${t("brandHome.widget.dna.title")}</h3>
        <p>${progress.filled ? t("brandHome.widget.dna.filled", { filled: progress.filled, total: progress.total }) : t("brandHome.widget.dna.empty")}</p>
      </div>
    </button>
  `;
}

function campaignWidgetHTML(count) {
  const slots = 5;
  const filled = Math.min(count, slots);
  let dots = "";
  for (let i = 0; i < slots; i++) {
    if (i > 0) dots += `<span class="mj-line ${i < filled ? "filled" : ""}"></span>`;
    dots += `<span class="mj-dot ${i < filled ? "filled" : ""}"></span>`;
  }
  return `
    <button type="button" class="brand-widget widget-campaign" data-go="campaigns">
      <div class="icon-wrap">${icon("bulb", { size: 20 })}</div>
      <h3>${t("brandHome.widget.campaign.title")}</h3>
      <p>${count ? t("brandHome.widget.campaign.count", { count }) : t("brandHome.widget.campaign.empty")}</p>
      <div class="mini-journey">${dots}</div>
    </button>
  `;
}

function guidelinesWidgetHTML(guidelines) {
  const hasColors = !!guidelines?.colors?.primary;
  const colors = hasColors
    ? ["primary", "secondary", "accent", "background", "text"].map((k) => guidelines.colors[k])
    : ["var(--surface-2)", "var(--surface-2)", "var(--surface-2)", "var(--surface-2)", "var(--surface-2)"];
  const fontFamily = guidelines?.fonts?.primary ? `'${guidelines.fonts.primary}', ` : "";
  return `
    <button type="button" class="brand-widget widget-guidelines" data-go="builder">
      <div class="aa-preview" style="font-family:${fontFamily}var(--font-display);">Aa</div>
      <h3>${t("brandHome.widget.guidelines.title")}</h3>
      <p>${t("brandHome.widget.guidelines.sub")}</p>
      <div class="swatch-row">${colors.map((c) => `<span class="swatch" style="background:${c};"></span>`).join("")}</div>
    </button>
  `;
}

function contentOsWidgetHTML(total, published) {
  return `
    <button type="button" class="brand-widget widget-content-os" data-go="content-os">
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

function salesWidgetHTML() {
  return `
    <button type="button" class="brand-widget widget-sales" data-go="sales">
      <div class="folder-badge">${icon("folder", { size: 22 })}</div>
      <div>
        <h3>${t("brandHome.widget.sales.title")}</h3>
        <p>${t("brandHome.widget.sales.sub")}</p>
      </div>
    </button>
  `;
}

function upNextRow(c) {
  return `
    <div class="top-content-row" data-open-content="${c.id}" style="cursor:pointer;">
      <div class="ti">
        <div class="t">${escapeText(c.title || "Untitled")}</div>
        <div class="m">${c.platform || "—"} · ${formatDate(c.scheduleDate)}</div>
      </div>
      <span class="tag tag-${c.funnel.toLowerCase()}">${c.funnel}</span>
    </div>
  `;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
