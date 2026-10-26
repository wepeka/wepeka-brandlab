// The top of My Brand's pages (js/views/brand-builder.js, brand-dna.js,
// brand-guidelines.js), in the same shape as Create's: on a part's page, a
// round back pill in My Brand's colours, then the part's own picture tile
// and title. One helper so the three pages can't drift apart.
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { appByKey } from "./apps.js";
import { appIconSVG } from "./app-icons.js";
import { brandArtSVG, BRAND_PARTS } from "./brand-art.js";

export function myBrandBackPillHTML(brandId) {
  const app = appByKey("builder");
  return `<a class="mb-backpill" href="#/brand/${brandId}/builder" style="--app:${app.color};--app2:${app.color2};" aria-label="${t("mb.back")}">
      ${icon("chevronLeft", { size: 16 })}
      <span class="mb-backpill-art lh-pic">${appIconSVG("builder")}</span>
      <span>${t("app.brand.name")}</span>
    </a>`;
}

// `helpHTML` = the page's Panduan (+ "?") buttons; `rightHTML` = anything the
// page keeps on the right of its title (the Brand Book's progress).
export function myBrandSubHeadHTML({ brandId, part, title, helpHTML = "", rightHTML = "" }) {
  const c = BRAND_PARTS[part] || BRAND_PARTS.dna;
  return `
    ${myBrandBackPillHTML(brandId)}
    <div class="mb-subhead">
      <div class="mb-subhead-title">
        <span class="mb-tile lh-pic" style="--app:${c.color};--app2:${c.color2};">${brandArtSVG(part)}</span>
        <h1>${title}</h1>
        ${helpHTML ? `<span class="page-eyebrow mb-help">${helpHTML}</span>` : ""}
      </div>
      ${rightHTML ? `<div class="mb-subhead-right">${rightHTML}</div>` : ""}
    </div>`;
}

// Cards and tiles: the light that follows the mouse (css .lh-card::before).
export function wirePointerLight(scope) {
  scope?.addEventListener("pointermove", (e) => {
    const block = e.target.closest?.(".lh-card, .mb-id");
    if (!block) return;
    const r = block.getBoundingClientRect();
    block.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
    block.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
  });
}
