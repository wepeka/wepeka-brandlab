// "Laporkan masalah" (js/report-problem.js → api/report.js): what a user's
// problem report may contain, before it is stored in Firestore
// `problemReports/{id}` and read in the Wepeka admin (wpk-dp, Brandlab →
// Laporan Masalah). Pure — no Firestore, no fetch — so it is tested directly.
export const REPORT_KINDS = ["bug", "confused", "payment", "idea"];
export const REPORT_STATES = ["new", "progress", "done"];
export const REPORT_LIMITS = {
  messageMin: 5,
  message: 2000,
  contact: 40,
  page: 200,
  ua: 300,
  app: 80,
  errors: 5,
  errorChars: 400,
  // A compressed screenshot as a data URL (the app sends ~100–300 KB). The
  // whole report must stay well under Firestore's 1 MB per document.
  screenshotChars: 700_000,
  perDay: 10,
};

const str = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");
const SCREENSHOT_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

// → { ok: true, report } | { ok: false, error: "message" | "screenshot" }.
// Anything not listed here is dropped; who sent it (uid, email, plan) is
// added by the endpoint from the verified token and the account doc, never
// taken from the body.
export function normalizeReport(body) {
  const b = body && typeof body === "object" ? body : {};
  const message = str(b.message, REPORT_LIMITS.message);
  if (message.length < REPORT_LIMITS.messageMin) return { ok: false, error: "message" };
  let screenshot = "";
  if (typeof b.screenshot === "string" && b.screenshot) {
    if (b.screenshot.length > REPORT_LIMITS.screenshotChars || !SCREENSHOT_RE.test(b.screenshot)) return { ok: false, error: "screenshot" };
    screenshot = b.screenshot;
  }
  const errors = (Array.isArray(b.errors) ? b.errors : [])
    .slice(-REPORT_LIMITS.errors)
    .map((e) => ({ at: Number.isFinite(Number(e?.at)) ? Math.round(Number(e.at)) : 0, msg: str(e?.msg, REPORT_LIMITS.errorChars) }))
    .filter((e) => e.msg);
  const viewport = str(b.viewport, 20);
  return {
    ok: true,
    report: {
      kind: REPORT_KINDS.includes(b.kind) ? b.kind : "bug",
      message,
      contact: str(b.contact, REPORT_LIMITS.contact).replace(/[^\d+\-\s()]/g, "").trim(),
      // Where they were: the hash route only — never a query string or a token.
      page: str(b.page, REPORT_LIMITS.page).replace(/[?].*$/, ""),
      brandName: str(b.brandName, 80),
      mode: b.mode === "advanced" ? "advanced" : "guided",
      lang: b.lang === "en" ? "en" : "id",
      ua: str(b.ua, REPORT_LIMITS.ua),
      viewport: /^\d{2,5}x\d{2,5}$/.test(viewport) ? viewport : "",
      app: str(b.app, REPORT_LIMITS.app),
      errors,
      screenshot,
    },
  };
}

// A person, not a script, files reports: at most `perDay` in any 24 hours.
export function tooManyReports(createdAts, now = Date.now(), perDay = REPORT_LIMITS.perDay) {
  const since = now - 24 * 60 * 60 * 1000;
  return (createdAts || []).filter((t) => Number(t) > since).length >= perDay;
}

const KIND_LABEL = { bug: "Error / tidak jalan", confused: "Bingung", payment: "Pembayaran", idea: "Saran" };
// The push the Wepeka team's own devices get when a report comes in.
export function composeReportPush({ kind, message, email }, appUrl) {
  const who = String(email || "").trim() || "Pengguna";
  return {
    title: `Laporan baru · ${KIND_LABEL[kind] || KIND_LABEL.bug}`,
    body: `${who}: ${String(message || "").replace(/\s+/g, " ").slice(0, 140)}`,
    url: `${appUrl}/`,
    tag: "brandlab-report",
  };
}
