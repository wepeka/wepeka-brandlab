import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRefs, gearItems, weekGear, weekPieces, byDay, refSource, weekStart } from "../js/rencana.js";

// The Quatro reference field as it is in Brandlab (2026-11-09).
const QUATRO_REF = `Referensi video (pelajari polanya, jangan disalin):

1. jazzton.c — Mengheningkan Cipta (214 rb likes)
Instagram Reels
https://www.instagram.com/p/DcH29w8zp7j/
✅ Bisa diadaptasi: Penampilan anak direkam dari depan, apa adanya.
⛔ Jangan meniru lagu atau aransemennya.

2. Kids music class — first concert
YouTube Shorts
https://youtube.com/shorts/abcDEF12345?si=xyz
✅ Bisa diadaptasi: Anak main bareng.

Daftar lengkap + contoh viral: Quatro_Content_Plan_November.pdf`;

test("parseRefs: a paragraph with a link is one video, its first line the title", () => {
  const { refs, notes } = parseRefs(QUATRO_REF);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].title, "jazzton.c — Mengheningkan Cipta (214 rb likes)");
  assert.equal(refs[0].kind, "instagram");
  assert.equal(refs[0].url, "https://www.instagram.com/p/DcH29w8zp7j/");
  assert.deepEqual(refs[0].notes, ["✅ Bisa diadaptasi: Penampilan anak direkam dari depan, apa adanya.", "⛔ Jangan meniru lagu atau aransemennya."]);
  assert.equal(refs[1].kind, "youtube");
  assert.equal(refs[1].id, "abcDEF12345");
  assert.equal(notes.length, 2, "the intro and the closing line stay as text");
});

test("parseRefs: bare links (one per line or one line) are a card each", () => {
  assert.equal(parseRefs("https://youtu.be/AAA\nhttps://www.tiktok.com/@x/video/1").refs.length, 2);
  const one = parseRefs("https://youtu.be/AAA https://www.youtube.com/watch?v=BBB");
  assert.deepEqual(one.refs.map((r) => r.id), ["AAA", "BBB"]);
  assert.equal(parseRefs("Ref: https://youtu.be/AAA.").refs[0].title, "Ref");
  assert.equal(parseRefs("Ref: https://youtu.be/AAA.").refs[0].url, "https://youtu.be/AAA");
  assert.deepEqual(parseRefs(""), { refs: [], notes: [] });
  assert.equal(parseRefs("gaya Pinter Mandarin yang lucu").refs.length, 0);
});

test("refSource reads YouTube ids and the site", () => {
  assert.deepEqual(refSource("https://m.youtube.com/watch?v=XYZ&t=3"), { kind: "youtube", id: "XYZ" });
  assert.deepEqual(refSource("https://www.youtube.com/shorts/Q1"), { kind: "youtube", id: "Q1" });
  assert.equal(refSource("https://example.com/a").kind, "link");
  assert.equal(refSource("not a url").kind, "link");
});

test("gearItems: one per line or comma, bullets dropped, commas in brackets kept", () => {
  assert.deepEqual(gearItems("- HP + tripod\n• mic clip-on\n\nring light"), ["HP + tripod", "mic clip-on", "ring light"]);
  assert.deepEqual(gearItems("2 HP (satu di tripod, satu bebas), mic kecil"), ["2 HP (satu di tripod, satu bebas)", "mic kecil"]);
  assert.deepEqual(gearItems(""), []);
});

test("weekGear: each thing once, with the pieces that need it", () => {
  const pieces = [{ code: "QN-1", gear: "HP + tripod\nMic clip-on" }, { code: "QN-2", gear: "mic  clip-on" }, { code: "QN-3", gear: "" }];
  assert.deepEqual(weekGear(pieces, (c) => c.code), [{ name: "HP + tripod", codes: ["QN-1"] }, { name: "Mic clip-on", codes: ["QN-1", "QN-2"] }]);
});

test("weekPieces: Monday to Sunday, in order, no trials, mirror twins once", () => {
  const from = weekStart("2026-11-11"); // a Wednesday → Monday 9 Nov
  assert.equal(from, "2026-11-09");
  const content = [
    { id: "a", scheduleDate: "2026-11-12", createdAt: 1 },
    { id: "b", scheduleDate: "2026-11-09", posting: { time: "17:00" } },
    { id: "c", scheduleDate: "2026-11-09", posting: { time: "12:00" } },
    { id: "d", scheduleDate: "2026-11-16" },
    { id: "e", scheduleDate: "2026-11-15", trialOf: "a" },
    { id: "f", scheduleDate: "2026-11-13", mirrorGroupId: "m" },
    { id: "g", scheduleDate: "2026-11-13", mirrorGroupId: "m" },
    { id: "h", scheduleDate: "" },
    { id: "i", scheduleDate: "2026-11-10", deletedAt: 5 },
  ];
  const got = weekPieces(content, from);
  assert.deepEqual(got.map((c) => c.id), ["c", "b", "a", "f"]);
  assert.deepEqual(byDay(got).map((d) => [d.date, d.items.length]), [["2026-11-09", 2], ["2026-11-12", 1], ["2026-11-13", 1]]);
});
