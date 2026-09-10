import { getBrand, listContent, listCampaigns, onChange } from "../store.js";
import { icon } from "../icons.js";
import { formatDate, qs, qsa } from "../dom.js";
import { openContentEditor } from "./content-editor.js";

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
  const campaignCount = listCampaigns(brandId).length;
  const allContent = listContent(brandId);
  const published = allContent.filter((c) => c.status === "published").length;
  const scheduled = allContent.filter((c) => c.status === "scheduled");
  const upNext = [...scheduled].sort((a, b) => (a.scheduleDate || "9999").localeCompare(b.scheduleDate || "9999")).slice(0, 5);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Brand Home</div>
        <h1>${brand.name}</h1>
      </div>
    </div>

    <div class="content-view-grid" style="margin-bottom:28px;">
      <button type="button" class="content-view-card" data-go="dna">
        <div class="icon-wrap">${icon("target", { size: 22 })}</div>
        <h3>Brand DNA</h3>
        <p>${dnaProgress.filled ? `${dnaProgress.filled} of ${dnaProgress.total} fields filled` : "Start here — who this brand is"}</p>
      </button>
      <button type="button" class="content-view-card" data-go="campaigns">
        <div class="icon-wrap">${icon("bulb", { size: 22 })}</div>
        <h3>Create Campaign</h3>
        <p>${campaignCount ? `${campaignCount} campaign${campaignCount === 1 ? "" : "s"}` : "Give content a shared goal"}</p>
      </button>
      <button type="button" class="content-view-card" data-go="guidelines">
        <div class="icon-wrap">${icon("book", { size: 22 })}</div>
        <h3>Create Brand Guidelines</h3>
        <p>Typography, color & visual style</p>
      </button>
      <button type="button" class="content-view-card" data-go="content-os">
        <div class="icon-wrap">${icon("layers", { size: 22 })}</div>
        <h3>Content Operating System</h3>
        <p>${allContent.length} piece${allContent.length === 1 ? "" : "s"} · ${published} published</p>
      </button>
      <button type="button" class="content-view-card" data-go="sales">
        <div class="icon-wrap">${icon("folder", { size: 22 })}</div>
        <h3>Sales Tracker</h3>
        <p>Invoices & revenue</p>
      </button>
    </div>

    <div class="section-title" style="margin-top:0;">
      <h2>Up Next</h2>
      <a class="link" href="#/brand/${brandId}/content-os/calendar">Calendar →</a>
    </div>
    <div class="card card-tight">
      ${
        upNext.length
          ? upNext.map(upNextRow).join("")
          : `<div class="table-empty" style="padding:28px;">Nothing scheduled yet.</div>`
      }
    </div>
  `;

  qsa("[data-go]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      location.hash = target === "dna" || target === "campaigns" || target === "guidelines" || target === "sales" || target === "content-os"
        ? `#/brand/${brandId}/${target}`
        : `#/brand/${brandId}`;
    });
  });

  qsa("[data-open-content]", root).forEach((el) => {
    el.addEventListener("click", () => openContentEditor({ brandId, contentId: el.dataset.openContent, onSaved: refresh }));
  });
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
