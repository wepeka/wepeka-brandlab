// The Founder's Deal page (founder/): what it tells GA4 about how far people
// read, and the WhatsApp question door next to the buy button. Reads the
// markup; no browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionEvent, faqEvent } from "../founder/founder.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = await readFile(path.join(ROOT, "founder/index.html"), "utf8");
const values = (attr) => [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => m[1]);

describe("Founder's Deal page: reading events", () => {
  test("every part and question has its own short, valid GA4 event name", () => {
    const parts = values("data-track");
    const faqs = values("data-faq");
    assert.ok(parts.length >= 8 && faqs.length >= 6);
    for (const list of [parts, faqs]) assert.equal(new Set(list).size, list.length, "no name twice");
    for (const name of [...parts.map(sectionEvent), ...faqs.map(faqEvent)]) {
      // GA4: letters, digits and underscores, starting with a letter, at most 40.
      assert.match(name, /^[a-z][a-z0-9_]{0,39}$/, name);
    }
  });

  test("the parts people decide on are all counted", () => {
    const parts = values("data-track");
    for (const part of ["fitur", "bimbing", "isi", "hitung", "faq", "akhir"]) assert.ok(parts.includes(part), part);
    assert.ok(values("data-faq").includes("bimbing"));
  });
});

describe("Founder's Deal page: asking before buying", () => {
  test("the hero has a WhatsApp question door right after the buy button", () => {
    const hero = html.slice(html.indexOf('class="fd-hero"'), html.indexOf("</section>"));
    const buy = hero.indexOf('data-buy="hero"');
    const ask = hero.indexOf('data-wa-at="hero"');
    assert.ok(buy > 0 && ask > buy);
  });

  test("every WhatsApp door says where it sits", () => {
    const doors = [...html.matchAll(/<a\b[^>]*\bdata-wa\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(doors.length >= 3);
    for (const a of doors) assert.match(a, /data-wa-at="[a-z-]+"/, a);
  });
});
