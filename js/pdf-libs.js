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
