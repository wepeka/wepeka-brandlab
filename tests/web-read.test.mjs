import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirectives, isEmptyReply, serializeDirectives } from "../js/ai-directives.js";
import { cleanReadText, webAugment } from "../js/web-read.js";
import { stripHashtags, captionStyleRule, getCaptionStyle, setCaptionStyle } from "../js/caption-style.js";

test("[[search:…]] becomes a search card and nothing else shows", () => {
  const p = parseDirectives("Fore itu aku belum yakin, cari dulu yuk.\n[[search:Fore Coffee strategi marketing|biar nggak nebak]]");
  assert.equal(p.cleanText, "Fore itu aku belum yakin, cari dulu yuk.");
  assert.deepEqual(p.searches, [{ q: "Fore Coffee strategi marketing", why: "biar nggak nebak" }]);
  assert.equal(isEmptyReply(parseDirectives("[[search:Fore Coffee]]")), false);
  assert.match(serializeDirectives("x", { searches: p.searches }), /\[\[search:Fore Coffee strategi marketing\]\]/);
});

test("only one search card per reply", () => {
  assert.equal(parseDirectives("[[search:a b]] [[search:c d]]").searches.length, 1);
});

test("OCR text keeps real lines, once, and drops page clutter", () => {
  const raw = "Semua\nGambar\n|||| ___\nFore Coffee adalah kedai kopi asal Jakarta\nFore Coffee adalah kedai kopi asal Jakarta\n~~ -- ..\nstrategi harga dan promo lewat aplikasi";
  assert.equal(cleanReadText(raw), "Fore Coffee adalah kedai kopi asal Jakarta\nstrategi harga dan promo lewat aplikasi");
  assert.ok(cleanReadText("kata ".repeat(2000), 100).length <= 100);
});

test("the results travel with the question as a fenced source", () => {
  assert.equal(webAugment("hai", null), "hai");
  const out = webAugment("hai", { q: "fore", text: "isi" });
  assert.match(out, /^hai\n\nSEARCH RESULTS/);
  assert.match(out, /isi\nEND OF SEARCH RESULTS$/);
});

test("captions: hashtags can be stripped, style rule follows the switches", () => {
  assert.equal(stripHashtags("Halo ✨\n\nCek sekarang 👇\n\n#fore #kopi"), "Halo ✨\n\nCek sekarang 👇");
  assert.equal(stripHashtags("Halo #fore kopi enak #kopi"), "Halo #fore kopi enak");
  assert.match(captionStyleRule({ emoji: true, hashtags: true }), /Instagram/);
  assert.match(captionStyleRule({ emoji: false, hashtags: false }), /Plain text.*NO hashtags/s);
});

test("caption style defaults to on and is remembered", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  assert.deepEqual(getCaptionStyle(), { emoji: true, hashtags: true });
  setCaptionStyle({ hashtags: false });
  assert.deepEqual(getCaptionStyle(), { emoji: true, hashtags: false });
});
