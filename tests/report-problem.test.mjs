// "Laporkan masalah": what a problem report may contain (api/_report.js),
// the day's limit, the push the team gets, and what the app attaches by
// itself (js/report-problem.js, js/error-log.js). No network, no Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeReport, tooManyReports, composeReportPush, REPORT_KINDS, REPORT_LIMITS, REPORT_STATES, REPORT_SOURCES } from "../api/_report.js";
import { REPORT_KINDS as CLIENT_KINDS, reportContext, aiAttachment } from "../js/report-problem.js";
import { noteAiAnswer, lastAiAnswer, readableAnswer, pageOf } from "../js/ai-last.js";
import { noteError, recentErrors } from "../js/error-log.js";
import { __i18nSources } from "../js/i18n.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("normalizeReport", () => {
  test("keeps what the form sends, in the shapes the admin reads", () => {
    const r = normalizeReport({
      kind: "payment", message: "  Sudah bayar tapi paket belum aktif  ", contact: "0812-3456 7890", page: "#/brand/b1/content/creator/c9?x=1",
      brandName: "Kopi Pagi", mode: "advanced", lang: "en", ua: "Mozilla/5.0", viewport: "390x844", app: "main-ABC123.js",
      errors: [{ at: 1760000000000, msg: "error: x is not a function @ at a (main.js:1:2)" }], screenshot: PNG,
      source: "page", feature: "calendar",
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.report, {
      kind: "payment", message: "Sudah bayar tapi paket belum aktif", contact: "0812-3456 7890", page: "#/brand/b1/content/creator/c9",
      brandName: "Kopi Pagi", mode: "advanced", lang: "en", ua: "Mozilla/5.0", viewport: "390x844", app: "main-ABC123.js",
      errors: [{ at: 1760000000000, msg: "error: x is not a function @ at a (main.js:1:2)" }],
      source: "page", feature: "calendar", aiOutput: "", aiPrompt: "", screenshot: PNG,
    });
  });
  test("a message is required; everything else has a safe default", () => {
    assert.deepEqual(normalizeReport({ message: "  hm " }), { ok: false, error: "message" });
    assert.deepEqual(normalizeReport(null), { ok: false, error: "message" });
    const r = normalizeReport({ message: "Tombol Simpan tidak jalan", kind: "apa-saja", mode: "x", lang: "fr", viewport: "besar", errors: "bukan daftar" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.report, { kind: "bug", message: "Tombol Simpan tidak jalan", contact: "", page: "", brandName: "", mode: "guided", lang: "id", ua: "", viewport: "", app: "", errors: [], source: "menu", feature: "", aiOutput: "", aiPrompt: "", screenshot: "" });
  });
  test("a report about an AI answer carries the answer and the question, cut to size", () => {
    const r = normalizeReport({
      kind: "ai", source: "ai", feature: "chat-brainstorm", message: "Jawabannya nggak nyambung",
      aiOutput: "  Ide 1: bikin giveaway.\nIde 2: " + "z".repeat(9000), aiPrompt: "kasih ide konten " + "q".repeat(5000),
    });
    assert.equal(r.ok, true);
    assert.equal(r.report.kind, "ai");
    assert.equal(r.report.source, "ai");
    assert.equal(r.report.feature, "chat-brainstorm");
    assert.match(r.report.aiOutput, /^Ide 1: bikin giveaway\.\nIde 2: z+$/);
    assert.equal(r.report.aiOutput.length, REPORT_LIMITS.aiOutput);
    assert.equal(r.report.aiPrompt.length, REPORT_LIMITS.aiPrompt);
  });
  test("where it came from is one of four places; the feature is a short key, never markup", () => {
    assert.deepEqual(REPORT_SOURCES, ["menu", "page", "ai", "error"]);
    const r = normalizeReport({ message: "ada yang aneh", source: "di mana saja", feature: '<img src=x onerror="1"> kalender ' + "k".repeat(200), aiOutput: 42, aiPrompt: { a: 1 } });
    assert.equal(r.report.source, "menu");
    assert.doesNotMatch(r.report.feature, /[<>"=\s]/);
    assert.ok(r.report.feature.length <= REPORT_LIMITS.feature);
    assert.equal(r.report.aiOutput, "");
    assert.equal(r.report.aiPrompt, "");
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
    assert.equal(composeReportPush({ kind: "ai", message: "m" }, "https://x").title, "Laporan baru · Jawaban AI");
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

describe("the AI answer a report can carry", () => {
  const T = Date.parse("2026-10-13T05:00:00Z");
  const MIN = 60000;
  test("the newest fresh answer, by kind and by page; plumbing calls are never kept", () => {
    noteAiAnswer({ feature: "dna", output: "Tagline lama", prompt: "p1", page: "#/brand/b1/dna", at: T });
    noteAiAnswer({ feature: "guidelines", output: '{"pillars":["Cepat","Ramah"]}', page: "#/brand/b1/guidelines", at: T + MIN });
    noteAiAnswer({ feature: "dna", output: "Tagline baru", prompt: "p2", page: "#/brand/b1/dna", at: T + 2 * MIN });
    noteAiAnswer({ feature: "route", output: "brainstorm", page: "#/brand/b1/dna", at: T + 3 * MIN });
    noteAiAnswer({ feature: "test", output: "OK", page: "#/brand/b1/dna", at: T + 3 * MIN });
    noteAiAnswer({ feature: "sales", output: "   ", page: "#/brand/b1/dna", at: T + 3 * MIN });
    const now = T + 4 * MIN;
    assert.equal(lastAiAnswer({ feature: "dna", now }).output, "Tagline baru");
    assert.equal(lastAiAnswer({ page: "#/brand/b1/dna", now }).prompt, "p2");
    assert.equal(lastAiAnswer({ page: "#/brand/b1/guidelines", now }).feature, "guidelines");
    assert.equal(lastAiAnswer({ feature: "dna", page: "#/brand/b1/guidelines", now }), null);
    assert.equal(lastAiAnswer({ feature: "route", now }), null);
    // Old answers are not offered: the page has moved on.
    assert.equal(lastAiAnswer({ feature: "dna", now: T + 30 * MIN }), null);
  });
  test("only the last few are kept, each cut to what the server accepts", () => {
    for (let i = 0; i < 12; i++) noteAiAnswer({ feature: `f${i}`, output: "x".repeat(9000), prompt: "y".repeat(9000), page: "#/", at: T + i });
    assert.equal(lastAiAnswer({ feature: "f0", now: T + 20 }), null);
    const a = lastAiAnswer({ feature: "f11", now: T + 20 });
    assert.equal(a.output.length, REPORT_LIMITS.aiOutput);
    assert.equal(a.prompt.length, REPORT_LIMITS.aiPrompt);
  });
  test("a JSON answer is turned into lines a person can read", () => {
    assert.equal(readableAnswer("Halo, ini jawaban biasa."), "Halo, ini jawaban biasa.");
    assert.equal(readableAnswer('{"summary":"Penjualan naik","actions":[{"title":"Promo bundel","why":"stok banyak"},{"title":"Live IG"}],"tags":["a","b"]}'),
      "summary: Penjualan naik\nactions:\ntitle: Promo bundel\nwhy: stok banyak\n\ntitle: Live IG\n\ntags:\n• a\n• b");
    assert.equal(readableAnswer(["satu", "dua"]), "• satu\n• dua");
    assert.equal(readableAnswer("{bukan json"), "{bukan json");
    assert.equal(readableAnswer(null), "");
  });
  test("what the form attaches: nothing without an answer, and never more than the server keeps", () => {
    assert.equal(aiAttachment(null), null);
    assert.equal(aiAttachment({ output: "   ", prompt: "tanya" }), null);
    const a = aiAttachment({ output: "j".repeat(9000), prompt: "t".repeat(9000) });
    assert.equal(a.output.length, REPORT_LIMITS.aiOutput);
    assert.equal(a.prompt.length, REPORT_LIMITS.aiPrompt);
    assert.equal(pageOf("#/brand/b1/content?x=1"), "#/brand/b1/content");
  });
});
