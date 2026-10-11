// "Laporkan masalah": what a problem report may contain (api/_report.js),
// the day's limit, the push the team gets, and what the app attaches by
// itself (js/report-problem.js, js/error-log.js). No network, no Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeReport, tooManyReports, composeReportPush, REPORT_KINDS, REPORT_LIMITS, REPORT_STATES } from "../api/_report.js";
import { REPORT_KINDS as CLIENT_KINDS, reportContext } from "../js/report-problem.js";
import { noteError, recentErrors } from "../js/error-log.js";
import { __i18nSources } from "../js/i18n.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("normalizeReport", () => {
  test("keeps what the form sends, in the shapes the admin reads", () => {
    const r = normalizeReport({
      kind: "payment", message: "  Sudah bayar tapi paket belum aktif  ", contact: "0812-3456 7890", page: "#/brand/b1/content/creator/c9?x=1",
      brandName: "Kopi Pagi", mode: "advanced", lang: "en", ua: "Mozilla/5.0", viewport: "390x844", app: "main-ABC123.js",
      errors: [{ at: 1760000000000, msg: "error: x is not a function @ at a (main.js:1:2)" }], screenshot: PNG,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.report, {
      kind: "payment", message: "Sudah bayar tapi paket belum aktif", contact: "0812-3456 7890", page: "#/brand/b1/content/creator/c9",
      brandName: "Kopi Pagi", mode: "advanced", lang: "en", ua: "Mozilla/5.0", viewport: "390x844", app: "main-ABC123.js",
      errors: [{ at: 1760000000000, msg: "error: x is not a function @ at a (main.js:1:2)" }], screenshot: PNG,
    });
  });
  test("a message is required; everything else has a safe default", () => {
    assert.deepEqual(normalizeReport({ message: "  hm " }), { ok: false, error: "message" });
    assert.deepEqual(normalizeReport(null), { ok: false, error: "message" });
    const r = normalizeReport({ message: "Tombol Simpan tidak jalan", kind: "apa-saja", mode: "x", lang: "fr", viewport: "besar", errors: "bukan daftar" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.report, { kind: "bug", message: "Tombol Simpan tidak jalan", contact: "", page: "", brandName: "", mode: "guided", lang: "id", ua: "", viewport: "", app: "", errors: [], screenshot: "" });
  });
  test("nothing the body claims about who sent it survives", () => {
    const r = normalizeReport({ message: "halo halo", uid: "orang-lain", email: "x@y.z", plan: "founder", state: "done", adminNote: "beres" });
    for (const k of ["uid", "email", "plan", "state", "adminNote"]) assert.equal(k in r.report, false, k);
  });
  test("long text is cut, only the last few errors are kept", () => {
    const r = normalizeReport({
      message: "a".repeat(5000), contact: "x".repeat(10) + "0812" + "9".repeat(60),
      errors: Array.from({ length: 9 }, (_, i) => ({ at: i, msg: `e${i} ` + "z".repeat(900) })),
    });
    assert.equal(r.report.message.length, REPORT_LIMITS.message);
    assert.ok(r.report.contact.length <= REPORT_LIMITS.contact);
    assert.doesNotMatch(r.report.contact, /x/);
    assert.equal(r.report.errors.length, REPORT_LIMITS.errors);
    assert.match(r.report.errors[0].msg, /^e4 /);
    assert.equal(r.report.errors[0].msg.length, REPORT_LIMITS.errorChars);
  });
  test("a screenshot must be a small image data URL", () => {
    assert.deepEqual(normalizeReport({ message: "ada gambar", screenshot: "https://evil.example/x.png" }), { ok: false, error: "screenshot" });
    assert.deepEqual(normalizeReport({ message: "ada gambar", screenshot: "data:text/html;base64,PHNjcmlwdD4=" }), { ok: false, error: "screenshot" });
    assert.deepEqual(normalizeReport({ message: "ada gambar", screenshot: "data:image/svg+xml;base64,PHN2Zz4=" }), { ok: false, error: "screenshot" });
    assert.deepEqual(normalizeReport({ message: "ada gambar", screenshot: "data:image/jpeg;base64," + "A".repeat(REPORT_LIMITS.screenshotChars) }), { ok: false, error: "screenshot" });
    assert.equal(normalizeReport({ message: "ada gambar", screenshot: "data:image/jpeg;base64,/9j/4AAQ" }).ok, true);
  });
});

describe("limits and notices", () => {
  const now = Date.parse("2026-10-13T05:00:00Z");
  const H = 3600000;
  test("ten reports in 24 hours is the ceiling; older ones don't count", () => {
    assert.equal(tooManyReports([], now), false);
    assert.equal(tooManyReports(Array.from({ length: 9 }, (_, i) => now - i * H), now), false);
    assert.equal(tooManyReports(Array.from({ length: 10 }, (_, i) => now - i * H), now), true);
    assert.equal(tooManyReports(Array.from({ length: 30 }, (_, i) => now - (25 + i) * H), now), false);
  });
  test("the team's push says who and what, in one line", () => {
    const p = composeReportPush({ kind: "payment", message: "Sudah bayar\n\ntapi paket belum aktif " + "x".repeat(300), email: "rani@contoh.test" }, "https://brandlab.wepeka.com");
    assert.equal(p.title, "Laporan baru · Pembayaran");
    assert.match(p.body, /^rani@contoh\.test: Sudah bayar tapi paket belum aktif x+$/);
    assert.ok(p.body.length <= "rani@contoh.test: ".length + 140);
    assert.equal(p.url, "https://brandlab.wepeka.com/");
    assert.equal(composeReportPush({ kind: "??", message: "m" }, "https://x").title, "Laporan baru · Error / tidak jalan");
  });
  test("app, server and admin agree on kinds and states", () => {
    assert.deepEqual(CLIENT_KINDS, REPORT_KINDS);
    assert.deepEqual(REPORT_STATES, ["new", "progress", "done"]);
    const { core, extra } = __i18nSources();
    const keys = new Set([core, ...Object.values(extra)].flatMap((src) => Object.keys(src)));
    for (const k of REPORT_KINDS) assert.ok(keys.has(`lapor.kind.${k}`), `lapor.kind.${k}`);
  });
});

describe("what the app attaches", () => {
  test("the route only — never a query string or an SSO token", () => {
    assert.equal(reportContext({ hash: "#/brand/b1/campaigns/c2" }).page, "#/brand/b1/campaigns/c2");
    assert.equal(reportContext({ hash: "#/sso?t=eyJhbGciOi.rahasia&to=pricing" }).page, "#/");
    assert.equal(reportContext({ hash: "#/settings?token=abc" }).page, "#/settings");
    assert.equal(reportContext({ hash: "" }).page, "#/");
    const c = reportContext({ hash: "#/", brandName: "Kopi Pagi" });
    assert.equal(c.brandName, "Kopi Pagi");
    assert.ok(["guided", "advanced"].includes(c.mode));
    assert.ok(Array.isArray(c.errors));
  });
  test("the error log keeps the last five, short, with where it happened", () => {
    for (let i = 0; i < 8; i++) {
      const e = new Error(`gagal ${i} ` + "y".repeat(600));
      noteError("error", e);
    }
    noteError("unhandledrejection", "teks biasa");
    const list = recentErrors();
    assert.equal(list.length, 5);
    assert.match(list[0].msg, /^error: gagal 4 /);
    assert.ok(list.every((e) => e.msg.length <= 400 && typeof e.at === "number"));
    assert.equal(list[4].msg, "unhandledrejection: teks biasa");
    // A copy: the caller can't empty the log.
    list.length = 0;
    assert.equal(recentErrors().length, 5);
  });
});
