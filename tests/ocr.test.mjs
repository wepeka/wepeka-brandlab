import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseNumber, parseMetricsFromText, parseRetentionFromText } from "../js/ocr.js";

describe("parseNumber — Indonesian and English number formats", () => {
  const cases = [
    // thousands: a separator followed by exactly 3 digits
    ["12.345", 12345],
    ["12,345", 12345],
    ["1.234.567", 1234567],
    ["1,234,567", 1234567],
    ["1 234", 1234],
    ["1 234 567", 1234567],
    ["1 234", 1234],
    // decimals: anything else
    ["1,2 rb", 1200],
    ["10,5 rb", 10500],
    ["1,2rb", 1200],
    ["2 ribu", 2000],
    ["1.2K", 1200],
    ["12.3k", 12300],
    ["3,4 jt", 3400000],
    ["3 juta", 3000000],
    ["1.2M", 1200000],
    ["1,25 jt", 1250000],
    // both kinds: the last one is the decimal
    ["1.234,5", 1235],
    ["1,234.5", 1235],
    // plain
    ["987", 987],
    ["0", 0],
    ["+120", 120],
    ["12.345.", 12345],
  ];
  for (const [raw, want] of cases) {
    test(`${JSON.stringify(raw)} → ${want}`, () => assert.equal(parseNumber(raw), want));
  }
  test("not a number → null", () => {
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber(null), null);
    assert.equal(parseNumber("abc"), null);
    assert.equal(parseNumber("12 34"), null);
  });
});

describe("parseMetricsFromText — Instagram in Indonesian", () => {
  test("post insights, label then number on the same line", () => {
    const text = [
      "Wawasan kiriman",
      "Ringkasan",
      "Tayangan 12.345",
      "Akun yang dijangkau 8.765",
      "Interaksi 1.024",
      "Kunjungan profil 312",
      "Interaksi kiriman",
      "Suka 1.234",
      "Komentar 56",
      "Dibagikan 78",
      "Disimpan 90",
      "Pengikut baru 45",
    ].join("\n");
    assert.deepEqual(parseMetricsFromText(text), {
      views: 12345, reach: 8765, profileVisits: 312, likes: 1234, comments: 56, shares: 78, saves: 90, followersGained: 45,
    });
  });

  test("label above its number, compact rb/jt numbers", () => {
    const text = "Tayangan\n1,2 rb\nJangkauan\n987\nSuka\n3,4 jt\nKomentar\n12";
    assert.deepEqual(parseMetricsFromText(text), { views: 1200, reach: 987, likes: 3400000, comments: 12 });
  });

  test("a percentage breakdown is never read as a count", () => {
    const text = [
      "Tayangan",
      "12.345",
      "Pengikut 34,7%",
      "Bukan pengikut 65,3%",
      "Akun yang dijangkau 4.321",
      "+12,5%",
    ].join("\n");
    const got = parseMetricsFromText(text);
    assert.equal(got.views, 12345);
    assert.equal(got.reach, 4321);
    assert.equal(got.followersGained, undefined);
  });

  test("several labels on one OCR line each take the number after them", () => {
    const got = parseMetricsFromText("Suka 1.234 Komentar 56 Dibagikan 7 Disimpan 8");
    assert.deepEqual(got, { likes: 1234, comments: 56, shares: 7, saves: 8 });
  });

  test("several labels on one line, number before each label", () => {
    const r = parseMetricsFromText("1,234 Views 56 Likes 7 Comments");
    assert.equal(r.views, 1234);
    assert.equal(r.likes, 56);
    assert.equal(r.comments, 7);
    const id = parseMetricsFromText("12.345 Tayangan 678 Suka");
    assert.equal(id.views, 12345);
    assert.equal(id.likes, 678);
  });
  test("number before the label", () => {
    assert.deepEqual(parseMetricsFromText("12.345 Tayangan\n56 komentar"), { views: 12345, comments: 56 });
  });

  test("Reels: plays and follows", () => {
    const text = "Pemutaran 23.456\nIkuti 15\nSimpan 1,1 rb";
    assert.deepEqual(parseMetricsFromText(text), { views: 23456, followersGained: 15, saves: 1100 });
  });

  test("TikTok Indonesian: Favorit = saves, Bagikan = shares", () => {
    const text = "Total penayangan video\n45,6 rb\nSuka 3.210\nKomentar 98\nBagikan 120\nFavorit 340\nKunjungan profil 77";
    assert.deepEqual(parseMetricsFromText(text), { views: 45600, likes: 3210, comments: 98, shares: 120, saves: 340, profileVisits: 77 });
  });

  test("a label line never borrows another label's number", () => {
    // "Simpan" has no number of its own; the line under it belongs to Komentar.
    assert.deepEqual(parseMetricsFromText("Simpan\nKomentar 4"), { comments: 4 });
  });

  test("minutes are not millions", () => {
    assert.deepEqual(parseMetricsFromText("Tayangan 12 menit"), { views: 12 });
  });
});

describe("parseMetricsFromText — Instagram in English", () => {
  test("post insights", () => {
    const text = [
      "Post insights",
      "Views 12,345",
      "Accounts reached 8,765",
      "Profile activity 312",
      "Likes 1,234",
      "Comments 56",
      "Shares 78",
      "Saves 90",
      "Follows 45",
    ].join("\n");
    assert.deepEqual(parseMetricsFromText(text), {
      views: 12345, reach: 8765, profileVisits: 312, likes: 1234, comments: 56, shares: 78, saves: 90, followersGained: 45,
    });
  });
  test("compact K / M numbers and a breakdown", () => {
    const text = "Plays\n1.2M\nReach 45.6K\nFollowers 34.7%\nNon-followers 65.3%\nLikes 12.3K";
    assert.deepEqual(parseMetricsFromText(text), { views: 1200000, reach: 45600, likes: 12300 });
  });
  test("empty / junk text", () => {
    assert.deepEqual(parseMetricsFromText(""), {});
    assert.deepEqual(parseMetricsFromText("Instagram\n10:42\nlorem ipsum"), {});
  });
});

describe("parseRetentionFromText", () => {
  test("Indonesian labels", () => {
    const got = parseRetentionFromText("Rata-rata waktu tonton 0:07\nRasio lewati 38,5%\nDitonton penuh 12%");
    assert.deepEqual(got, { avgWatchTimeSec: 7, skipRatePct: 38.5, completionPct: 12 });
  });
  test("hours as j (jam)", () => {
    assert.deepEqual(parseRetentionFromText("Waktu tonton rata-rata 1j 2m"), { avgWatchTimeSec: 3720 });
  });
});
