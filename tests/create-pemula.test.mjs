// Create for Pemula (2026-10-26): the two-step "Konten baru"
// (js/views/new-content-wizard.js) turns a kind of piece + where it goes out
// into the account's own format names, and the words typed into a working
// title + idea. Plus: every new string has both languages, and the new
// pictures draw.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { formatForKind, kindOfFormat, titleAndIdea } = await import("../js/views/new-content-wizard.js");
const { createArtSVG } = await import("../js/create-art.js");
const create = (await import("../js/i18n/create.js")).default;

const FORMATS = ["Reels", "Short Video", "Carousel", "Story", "Long Video", "Static Post"].map((name) => ({ name }));

describe("Konten baru: kind → the account's format", () => {
  test("a short video is Reels on Instagram, Short Video on TikTok/YouTube", () => {
    assert.equal(formatForKind("video", "Instagram", FORMATS), "Reels");
    assert.equal(formatForKind("video", "TikTok", FORMATS), "Short Video");
    assert.equal(formatForKind("video", "YouTube", FORMATS), "Short Video");
  });
  test("falls back to whichever short format the account kept", () => {
    assert.equal(formatForKind("video", "TikTok", [{ name: "Reels" }]), "Reels");
    assert.equal(formatForKind("video", "Instagram", [{ name: "Short Video" }]), "Short Video");
  });
  test("the other kinds, and a renamed/missing one", () => {
    assert.equal(formatForKind("carousel", "Instagram", FORMATS), "Carousel");
    assert.equal(formatForKind("photo", "Instagram", FORMATS), "Static Post");
    assert.equal(formatForKind("story", "Instagram", FORMATS), "Story");
    assert.equal(formatForKind("long", "YouTube", FORMATS), "Long Video");
    assert.equal(formatForKind("story", "Instagram", [{ name: "Reels" }]), "");
  });
  test("an owner's own format is stored as itself", () => {
    assert.equal(formatForKind("Podcast", "YouTube", [...FORMATS, { name: "Podcast" }]), "Podcast");
  });
  test("a stored format reads back as its kind", () => {
    assert.equal(kindOfFormat("Reels"), "video");
    assert.equal(kindOfFormat("Short Video"), "video");
    assert.equal(kindOfFormat("Carousel"), "carousel");
    assert.equal(kindOfFormat("Static Post"), "photo");
    assert.equal(kindOfFormat("Podcast"), "");
  });
});

describe("Konten baru: the words → title + idea", () => {
  test("one line is the title; the lines after it are the idea", () => {
    assert.deepEqual(titleAndIdea("Cara pesan 2 menit"), { title: "Cara pesan 2 menit", idea: "" });
    assert.deepEqual(titleAndIdea("  Cara pesan 2 menit\nDari WA sampai kopi di tangan\n"), { title: "Cara pesan 2 menit", idea: "Dari WA sampai kopi di tangan" });
  });
  test("nothing typed → an untitled piece the AI helps find an idea for", () => {
    assert.deepEqual(titleAndIdea("   "), { title: "", idea: "" });
  });
  test("a first line too long for a title is cut at a word and kept whole as the idea", () => {
    const long = "Kenapa pelanggan kantoran di Surabaya lebih milih kopi drive-thru daripada kafe biasa padahal harganya sama";
    const { title, idea } = titleAndIdea(long);
    assert.ok(title.length <= 80);
    assert.ok(long.startsWith(title));
    assert.ok(!title.endsWith(" "));
    assert.equal(idea, long);
  });
});

describe("Create for Pemula: strings and characters", () => {
  test("every new string has English and Indonesian", () => {
    for (const [key, v] of Object.entries(create)) {
      assert.ok(v.en && v.id, `${key} needs en + id`);
    }
  });
  test("the five parts of Create and the five kinds each have a picture in the card's colours", () => {
    for (const key of ["creator", "calendar", "list", "copy", "series", "video", "carousel", "photo", "story", "long"]) {
      const svg = createArtSVG(key);
      assert.match(svg, /^<svg[^>]*viewBox="0 0 120 120"/, key);
      assert.ok(/class="i-main/.test(svg) && /class="i-ink/.test(svg), `${key} uses the tint + shade`);
      assert.ok(!/fill="#|stroke=/.test(svg), `${key} takes its colours from the card (CSS), none of its own`);
    }
  });
});
