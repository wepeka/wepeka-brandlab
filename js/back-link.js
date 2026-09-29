// The "‹ Kembali" pill at the top of a page. It used to be a tiny chevron
// inside the uppercase eyebrow text, which people didn't recognize as a
// button at all. Now it's a bordered button that says "Kembali"/"Back",
// followed by the breadcrumb label it leads to.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";

export function backLinkHTML(href, label) {
  const title = label ? t("common.backTo", { label }) : t("common.back");
  return `<a class="page-back-btn" href="${escapeHtml(href)}" title="${escapeHtml(title)}">${icon("chevronLeft", { size: 14 })}<span>${t("common.back")}</span></a>${label ? `<span class="page-back-crumb">${escapeHtml(label)}</span>` : ""}`;
}

// Pengaturan and Update belong to no brand, so opening them used to drop the
// brand's tabs with no way back but "Semua Brand". The shell remembers the
// last brand opened (js/layout.js wireShell) and these pages lead back to it.
const LAST_BRAND_KEY = "brandlab:last-brand";
export function rememberLastBrand(brandId) {
  try { if (brandId) sessionStorage.setItem(LAST_BRAND_KEY, brandId); } catch { /* storage off: falls back to Semua Brand */ }
}
export function backToLastBrandHTML(getBrand) {
  let id = null;
  try { id = sessionStorage.getItem(LAST_BRAND_KEY); } catch { /* ignore */ }
  const brand = id ? getBrand(id) : null;
  return brand ? backLinkHTML(`#/brand/${brand.id}`, brand.name) : backLinkHTML("#/", t("nav.allBrands"));
}
