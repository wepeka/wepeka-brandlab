// html2canvas + jsPDF, loaded only when someone actually makes a PDF (the
// Brand Book, the brand report) — a real downloadable .pdf, no print dialog
// or "choose Save as PDF" step. One loader for the whole app.
//
// Pinned versions with Subresource Integrity (audit S-25): the browser
// refuses the file if the CDN ever serves different bytes. The hashes are
// sha384 of these exact files (checked against cdnjs's own published SRI);
// changing a version means changing its hash. jsPDF stays on 2.5.1: cdnjs
// has no UMD build of 2.5.2, and 3.x is a major version nobody has
// re-tested the Brand Book / report PDFs against yet.
// js/views/campaign-share.js loads the same jsPDF file with the same hash.
const JSPDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const JSPDF_INTEGRITY = "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk";
const PDF_LIBS = [
  { ready: () => !!window.html2canvas, src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", integrity: "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H" },
  { ready: () => !!window.jspdf?.jsPDF, src: JSPDF_SRC, integrity: JSPDF_INTEGRITY },
];
let pdfLibsLoading = null;
export function ensurePdfLibs() {
  if (PDF_LIBS.every((l) => l.ready())) return Promise.resolve();
  if (pdfLibsLoading) return pdfLibsLoading;
  pdfLibsLoading = Promise.all(
    PDF_LIBS.filter((l) => !l.ready()).map(
      (l) =>
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = l.src;
          script.integrity = l.integrity;
          script.crossOrigin = "anonymous";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        })
    )
  ).catch((err) => {
    pdfLibsLoading = null; // let the next click retry instead of caching the failure
    throw err;
  });
  return pdfLibsLoading;
}

// A4 portrait at 96 dpi — the size the off-screen pages are laid out at.
const A4_W = 794;
const A4_H = 1123;

// Lays `blocks` (HTML strings) onto fixed A4 portrait pages off-screen — a
// block never splits across two pages — writes `footer(n, total)` at the
// bottom of each, rasterizes them and saves `filename`. The pages use
// `pageClass` on top of .rp-page (css/styles.css), so they look like the
// on-screen preview sheet.
export async function downloadPagedPdf({ blocks = [], pageClass = "report-sheet", footer = null, filename = "document.pdf" } = {}) {
  await ensurePdfLibs();
  const host = document.createElement("div");
  host.className = "rp-pdf-host";
  document.body.appendChild(host);
  try {
    const pages = [];
    let body = null;
    const newPage = () => {
      const page = document.createElement("div");
      page.className = `${pageClass} rp-page`;
      page.style.position = "relative";
      body = document.createElement("div");
      page.appendChild(body);
      host.appendChild(page);
      pages.push(page);
    };
    newPage();
    const limit = A4_H - 96 - 40; // page padding + footer line
    blocks.forEach((html) => {
      const block = document.createElement("div");
      block.className = "rp-block";
      block.innerHTML = html;
      body.appendChild(block);
      if (body.offsetHeight > limit && body.children.length > 1) {
        body.removeChild(block);
        newPage();
        body.appendChild(block);
      }
    });
    if (footer) {
      pages.forEach((pg, i) => {
        const foot = document.createElement("div");
        foot.className = "report-footer";
        foot.style.cssText = "position:absolute;left:52px;right:52px;bottom:28px;margin:0;";
        foot.textContent = footer(i + 1, pages.length);
        pg.appendChild(foot);
      });
    }
    await Promise.all([...host.querySelectorAll("img")].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    if (document.fonts?.ready) await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", width: A4_W, height: A4_H, windowWidth: A4_W, logging: false, useCORS: true });
      if (i > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }
    pdf.save(filename);
  } finally {
    host.remove();
  }
}
