// The guide-video player picks YouTube / Vimeo / plain file from whatever
// link the admin pasted (js/guide-videos.js parseVideoSrc, embedUrl).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVideoSrc, embedUrl } from "../js/guide-videos.js";

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
