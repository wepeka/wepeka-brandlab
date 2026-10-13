// The guide-video player picks YouTube / Vimeo / plain file from whatever
// link the admin pasted (js/guide-videos.js parseVideoSrc, embedUrl).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVideoSrc, embedUrl, GUIDE_VIDEOS, PLACEHOLDER_SRC, videoRefForGuide, libraryVideoKeys, pageVideoDue, isNewAccount, PAGE_VIDEO_SINCE } from "../js/guide-videos.js";

const ID = "dQw4w9WgXcQ";

test("every common YouTube link shape resolves to the same video", () => {
  const links = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?si=abc123&v=${ID}`,
    `https://www.youtube.com/watch?feature=shared&v=${ID}&list=PL1`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=Xy_9-z`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=10`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://studio.youtube.com/video/${ID}/edit`,
    `  https://youtu.be/${ID}  `,
  ];
  for (const link of links) assert.deepEqual(parseVideoSrc(link), { kind: "youtube", id: ID }, link);
});

test("non-video YouTube pages and broken IDs are not treated as a video", () => {
  assert.equal(parseVideoSrc("https://www.youtube.com/@wepeka").kind, "file");
  assert.equal(parseVideoSrc("https://www.youtube.com/watch?v=short").kind, "file");
  assert.equal(parseVideoSrc(`https://www.youtube.com/watch?v=${ID}EXTRA`).kind, "file");
});

test("Vimeo, files and empty values keep their kinds", () => {
  assert.deepEqual(parseVideoSrc("https://vimeo.com/76979871"), { kind: "vimeo", id: "76979871" });
  assert.deepEqual(parseVideoSrc("https://x.supabase.co/storage/v1/object/public/site-images/a.mp4"), { kind: "file", id: "" });
  assert.deepEqual(parseVideoSrc(""), { kind: "none", id: "" });
  assert.deepEqual(parseVideoSrc(null), { kind: "none", id: "" });
});

test("YouTube embed enables the IFrame API and carries start/autoplay", () => {
  const url = embedUrl(`https://youtu.be/${ID}`, 75.6, true);
  assert.ok(url.startsWith(`https://www.youtube.com/embed/${ID}?`), url);
  assert.match(url, /[?&]enablejsapi=1/);
  assert.match(url, /[?&]fs=0/);
  assert.match(url, /[?&]autoplay=1/);
  assert.match(url, /[?&]start=75(?!\d)/);
  assert.doesNotMatch(embedUrl(`https://youtu.be/${ID}`), /autoplay|start=/);
  assert.equal(embedUrl("https://cdn.example.com/a.mp4"), null);
});

// Which video (and which part of it) each page's Panduan → "Tonton video
// penjelasan" opens. Part titles are the ones set in the admin (Kenalan
// Fitur series), matched by GUIDE_TO_VIDEO's `part` patterns.
const PART_TITLES = {
  beranda: ["Beranda", "Mode, menu & pengaturan"],
  "brand-builder": ["Brand DNA", "Brand Book"],
  campaign: ["Tujuan: Grow Brand", "Halaman tujuan: level, target & brainstorm", "Event: persiapan menuju tanggal"],
  "content-os": ["Creator: nulis script", "Creator: syuting sampai terbit", "Kalender & jadwal", "Daftar Konten & hasil", "Seri konten"],
};
// The titles as they were actually typed into the admin on 12 Oct 2026 —
// shorter than the scripts'. Pages must land on the right part with these too.
const ADMIN_TITLES = {
  "brand-builder": ["Brand DNA"],
  campaign: ["Grow Brand", "Tujuan", "Event"],
  "content-os": ["Creator", "Flow Creator", "Kalender", "Draft Konten", "Series"],
};
const partFor = (guideKey, set = PART_TITLES) => {
  const ref = videoRefForGuide(guideKey);
  const titles = set[ref.video] || [];
  const i = ref.part ? titles.findIndex((title) => ref.part.test(title)) : -1;
  return `${ref.video} › ${titles[Math.max(0, i)] || "(satu video)"}`;
};
const publish = (key, fn) => {
  const before = GUIDE_VIDEOS[key].src;
  GUIDE_VIDEOS[key].src = "https://youtu.be/dQw4w9WgXcQ";
  try { return fn(); } finally { GUIDE_VIDEOS[key].src = before; }
};

test("every one of the 19 Kenalan Fitur videos has a slot", () => {
  for (const key of ["akun-baru", "kenalan", "beranda", "brand-builder", "campaign", "sales", "content-os", "copy", "tanya-brandlab"]) {
    assert.ok(GUIDE_VIDEOS[key], key);
    assert.equal(GUIDE_VIDEOS[key].src, PLACEHOLDER_SRC, `${key} ships as a placeholder until the admin uploads it`);
    assert.ok(GUIDE_VIDEOS[key].title, key);
  }
});

test("each page opens the part made for it", () => {
  const at = (hash, fn) => { const prev = globalThis.location; globalThis.location = { hash, origin: "https://brandlab.wepeka.com" }; try { return fn(); } finally { globalThis.location = prev; } };
  publish("beranda", () => {
    assert.equal(partFor("home"), "beranda › Beranda");
    assert.equal(partFor("settings"), "beranda › Mode, menu & pengaturan");
  });
  assert.equal(partFor("brand-dna"), "brand-builder › Brand DNA");
  assert.equal(partFor("brand-guidelines"), "brand-builder › Brand Book");
  assert.equal(partFor("campaigns"), "campaign › Tujuan: Grow Brand");
  assert.equal(partFor("campaign-detail"), "campaign › Halaman tujuan: level, target & brainstorm");
  assert.equal(partFor("event"), "campaign › Event: persiapan menuju tanggal");
  assert.equal(partFor("creator"), "content-os › Creator: nulis script");
  assert.equal(partFor("calendar"), "content-os › Kalender & jadwal");
  assert.equal(at("#/brand/b1/content/list", () => partFor("content-list")), "content-os › Daftar Konten & hasil");
  assert.equal(at("#/brand/b1/content/series", () => partFor("content-os")), "content-os › Seri konten");
  assert.equal(at("#/brand/b1/content/calendar", () => partFor("content-os")), "content-os › Kalender & jadwal");
  assert.equal(videoRefForGuide("copy-studio").video, "copy");
  assert.equal(videoRefForGuide("sales").video, "sales");
  assert.equal(videoRefForGuide("chat").video, "tanya-brandlab");
  assert.equal(videoRefForGuide("nope"), null);
});

test("the shorter titles used in the admin open the right part too", () => {
  const at = (hash, fn) => { const prev = globalThis.location; globalThis.location = { hash, origin: "https://brandlab.wepeka.com" }; try { return fn(); } finally { globalThis.location = prev; } };
  const p = (key) => partFor(key, ADMIN_TITLES);
  assert.equal(p("campaigns"), "campaign › Grow Brand");
  assert.equal(p("campaign-detail"), "campaign › Tujuan");
  assert.equal(p("brainstorm"), "campaign › Tujuan");
  assert.equal(p("event"), "campaign › Event");
  assert.equal(p("creator"), "content-os › Creator");
  assert.equal(p("calendar"), "content-os › Kalender");
  assert.equal(at("#/brand/b1/content/list", () => p("content-list")), "content-os › Draft Konten");
  assert.equal(at("#/brand/b1/content/series", () => p("content-os")), "content-os › Series");
  assert.equal(p("brand-dna"), "brand-builder › Brand DNA");
  // Only one part up so far: Brand Book opens it rather than nothing.
  assert.equal(p("brand-guidelines"), "brand-builder › Brand DNA");
  // The scripts' long titles still resolve the same way.
  assert.equal(partFor("brainstorm"), "campaign › Halaman tujuan: level, target & brainstorm");
});

test("Beranda keeps offering the intro until its own video is published", () => {
  // Not published, not admin: Beranda's own video can't be shown yet.
  publish("kenalan", () => assert.equal(videoRefForGuide("home").video, "kenalan"));
  publish("kenalan", () => publish("beranda", () => assert.equal(videoRefForGuide("home").video, "beranda")));
  // Neither is up: the ref still names Beranda's slot (its button stays hidden).
  assert.equal(videoRefForGuide("home").video, "beranda");
});

test("the video library lists only what is published, Beranda right after the intro", () => {
  assert.deepEqual(libraryVideoKeys(), []);
  publish("sales", () => publish("beranda", () => publish("kenalan", () => assert.deepEqual(libraryVideoKeys(), ["kenalan", "beranda", "sales"]))));
});

// A new account's first open of a page plays that page's video by itself
// (js/guide-videos.js pageVideoDue / offerPageVideo).
const NEW = { createdAt: PAGE_VIDEO_SINCE + 60_000 };
const OLD = { createdAt: PAGE_VIDEO_SINCE - 60_000 };
const withParts = (key, titles, fn) => {
  const v = GUIDE_VIDEOS[key];
  const before = v.parts;
  v.parts = titles.map((title) => ({ title, src: "https://youtu.be/dQw4w9WgXcQ", seconds: 60 }));
  try { return publish(key, fn); } finally { v.parts = before; }
};
const nothingSeen = () => false;

test("only an account made since the videos went up counts as new", () => {
  assert.equal(isNewAccount(NEW), true);
  assert.equal(isNewAccount({ createdAt: PAGE_VIDEO_SINCE }), true);
  assert.equal(isNewAccount(OLD), false);
  assert.equal(isNewAccount({}), false);
  assert.equal(isNewAccount(null), false);
});

test("a new account's first open of a page plays that page's video", () => {
  publish("sales", () => {
    assert.deepEqual(pageVideoDue("sales", { account: NEW, seen: nothingSeen }), { video: "sales", part: 0, start: 0 });
    // An older account keeps finding it under Panduan instead.
    assert.equal(pageVideoDue("sales", { account: OLD, seen: nothingSeen }), null);
    // Already played once: never by itself again.
    assert.equal(pageVideoDue("sales", { account: NEW, seen: () => true }), null);
  });
  // Not uploaded yet: nothing opens (no "video lagi disiapkan" panel).
  assert.equal(pageVideoDue("sales", { account: NEW, seen: nothingSeen }), null);
  // A page without a video.
  assert.equal(pageVideoDue("nope", { account: NEW, seen: nothingSeen }), null);
});

test("each page plays its own part, and a part two pages share plays once", () => {
  withParts("campaign", ADMIN_TITLES.campaign, () => {
    assert.deepEqual(pageVideoDue("campaigns", { account: NEW, seen: nothingSeen }), { video: "campaign", part: 0, start: 0 });
    assert.deepEqual(pageVideoDue("campaign-detail", { account: NEW, seen: nothingSeen }), { video: "campaign", part: 1, start: 0 });
    assert.deepEqual(pageVideoDue("event", { account: NEW, seen: nothingSeen }), { video: "campaign", part: 2, start: 0 });
    // The list's part was watched; the goal page's part is still due.
    const seen = (video, part) => video === "campaign" && part === 0;
    assert.equal(pageVideoDue("campaigns", { account: NEW, seen }), null);
    assert.equal(pageVideoDue("campaign-detail", { account: NEW, seen })?.part, 1);
  });
  // The Brand hub and Brand DNA both open "Brand DNA": seen on one means
  // seen on the other.
  withParts("brand-builder", ADMIN_TITLES["brand-builder"], () => {
    const seen = (video, part) => video === "brand-builder" && part === 0;
    for (const key of ["brand-builder-hub", "brand-dna"]) {
      assert.deepEqual(pageVideoDue(key, { account: NEW, seen: nothingSeen }), { video: "brand-builder", part: 0, start: 0 }, key);
      assert.equal(pageVideoDue(key, { account: NEW, seen }), null, key);
    }
    // Brand Book's own part is not up: it does not play "Brand DNA" at people.
    assert.equal(pageVideoDue("brand-guidelines", { account: NEW, seen: nothingSeen }), null);
  });
  withParts("brand-builder", PART_TITLES["brand-builder"], () => {
    assert.deepEqual(pageVideoDue("brand-guidelines", { account: NEW, seen: (video, part) => part === 0 }), { video: "brand-builder", part: 1, start: 0 });
  });
});

test("one recording for a whole app plays at the page's chapter", () => {
  // No parts named in the admin: the entry itself is the video.
  publish("brand-builder", () => {
    assert.deepEqual(pageVideoDue("brand-dna", { account: NEW, seen: nothingSeen }), { video: "brand-builder", part: 0, start: 0 });
    assert.deepEqual(pageVideoDue("brand-guidelines", { account: NEW, seen: nothingSeen }), { video: "brand-builder", part: 0, start: 80 });
  });
});

test("Beranda does not repeat the intro a new account already watched", () => {
  // Beranda's own video is not up, so the page falls back to the intro —
  // which the first boot already played.
  publish("kenalan", () => {
    assert.equal(pageVideoDue("home", { account: NEW, seen: (video) => video === "kenalan" }), null);
    assert.equal(pageVideoDue("home", { account: NEW, seen: nothingSeen })?.video, "kenalan");
  });
  publish("kenalan", () => publish("beranda", () => {
    assert.equal(pageVideoDue("home", { account: NEW, seen: (video) => video === "kenalan" })?.video, "beranda");
  }));
});
