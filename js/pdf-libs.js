// html2canvas + jsPDF, loaded only when someone actually makes a PDF (the
// Brand Book, the brand report) — a real downloadable .pdf, no print dialog
// or "choose Save as PDF" step. One loader for the whole app.
const PDF_LIBS = [
  { ready: () => !!window.html2canvas, src: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" },
  { ready: () => !!window.jspdf?.jsPDF, src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" },
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
