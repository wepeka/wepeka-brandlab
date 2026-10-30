// Pitch Deck (js/views/deck.js): the story in front of the step tour
// (2026-10-30). Every slide needs its words and speaker notes in both
// languages, and the Beranda card's slide count must match the deck.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window.scrollTo ??= () => {};
globalThis.location ??= { hash: "#/", href: "http://localhost/", pathname: "/" };

const { SLIDES, CHAPTERS } = await import("../js/views/deck.js");
const { DECK_SLIDE_COUNT } = await import("../js/apps.js");
const { default: DICT } = await import("../js/i18n/deck.js");

const both = (key) => DICT[key] && DICT[key].en && DICT[key].id;

test("the Beranda card counts the deck's real slides", () => {
  assert.equal(DECK_SLIDE_COUNT, SLIDES.length);
});

test("every slide has a title (or is the cover), notes and a known chapter", () => {
  for (const s of SLIDES) {
    assert.ok(CHAPTERS.includes(s.ch), `${s.key}: chapter ${s.ch}`);
    assert.ok(both(`dk.${s.key}.notes`), `${s.key}: notes`);
    if (s.key !== "cover") assert.ok(both(`dk.${s.key}.title`), `${s.key}: title`);
    for (let n = 1; n <= (s.how?.length || 0); n++) {
      assert.ok(both(`dk.${s.key}.h${n}.t`) && both(`dk.${s.key}.h${n}.d`), `${s.key}: how ${n}`);
    }
  }
  for (const ch of CHAPTERS) assert.ok(both(`dk.ch.${ch}`), `chapter ${ch}`);
});

test("each .lt (Founders) wording has the general wording next to it", () => {
  for (const key of Object.keys(DICT).filter((k) => k.endsWith(".lt"))) {
    assert.ok(both(key.slice(0, -3)), key);
  }
});

test("the story comes before the demo, and the map opens the demo", () => {
  const order = SLIDES.map((s) => CHAPTERS.indexOf(s.ch));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(SLIDES.find((s) => s.ch === "demo").key, "map");
  assert.deepEqual(SLIDES.filter((s) => s.step).map((s) => s.step), [1, 2, 3, 4, 5, 6, 7]);
});
