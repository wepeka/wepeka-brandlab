// Report — one of the five apps (js/apps.js). The brand report that used to
// live only in a modal (Minggu ini's link, the weekly nudge) gets its own
// page: pick the period, read the numbers, download the PDF. The panel is
// the modal's own (js/views/report.js renderReportPanel), so the page and
// the modal can never show different numbers.
import { getBrand } from "../store.js";
import { renderReportPanel } from "./report.js";
import { guideVideoButtonHTML } from "../guide-videos.js";
import { setPageGuide } from "../section-guide.js";
import { runSpotlightTour } from "../tour.js";
import { escapeHtml as esc, qs } from "../dom.js";
import { t } from "../i18n.js";

const TOUR_STEPS = [
  { selector: ".rp-range", title: t("rpage.tour.range.title"), body: t("rpage.tour.range.body") },
  { selector: "#report-sheet", title: t("rpage.tour.sheet.title"), body: t("rpage.tour.sheet.body") },
  { selector: "#report-download", title: t("rep.downloadPdf"), body: t("rpage.tour.pdf.body") },
];

export function render(root, { brandId }) {
  const brand = getBrand(brandId);
  if (!brand) {
    location.hash = "#/";
    return () => {};
  }
  root.innerHTML = `
    <div class="page-head rpage-head">
      <div>
        <div class="page-eyebrow flex items-center gap-6">${guideVideoButtonHTML("report")}</div>
        <h1>${t("rpage.title")}</h1>
        <p class="page-sub">${esc(t("rpage.sub"))}</p>
      </div>
    </div>
    <section class="rpage" id="rpage-panel"></section>`;
  renderReportPanel(qs("#rpage-panel", root), brandId);
  setPageGuide(() => runSpotlightTour(TOUR_STEPS));
  return () => {};
}
