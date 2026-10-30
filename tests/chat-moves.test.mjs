import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseDirectives, serializeDirectives, isEmptyReply, renderLightMarkdown, renderMoves, movesAsText, MAX_MOVES } from "../js/ai-directives.js";

const REPLY = "Masalahnya bukan views.\n\nTiga hal konkret:\n[[move:Bikin seri jawab pertanyaan pembeli|Belum ada konten yang jawab harga, padahal orang butuh itu sebelum pesan|Bikin 3 Reels: harga, jam buka, cara pesan]]\n[[move:Jualan jangan cuma Senin|Promo cuma 1.200 views|Taruh WA di bio]]\n\nYang belum kebaca: asal penonton.";

describe("[[move:…]] — recommended moves as numbered cards", () => {
  test("each move is parsed and leaves a marker in its place", () => {
    const p = parseDirectives(REPLY);
    assert.equal(p.moves.length, 2);
    assert.deepEqual(p.moves[0], { title: "Bikin seri jawab pertanyaan pembeli", why: "Belum ada konten yang jawab harga, padahal orang butuh itu sebelum pesan", how: "Bikin 3 Reels: harga, jam buka, cara pesan" });
    assert.ok(!p.cleanText.includes("[[move"));
    assert.ok(p.cleanText.indexOf("Tiga hal") < p.cleanText.indexOf("⟦move:0⟧"));
    assert.ok(p.cleanText.indexOf("⟦move:1⟧") < p.cleanText.indexOf("Yang belum kebaca"));
  });

  test("cards render between the paragraphs, in order", () => {
    const p = parseDirectives(REPLY);
    const html = renderMoves(renderLightMarkdown(p.cleanText), p.moves, (m, i) => `<card ${i + 1}>`);
    assert.ok(/Tiga hal konkret:<\/p><card 1><card 2><p>Yang belum/.test(html));
    assert.ok(!html.includes("⟦"));
  });

  test("history gets the directive lines back; copy gets plain numbered text", () => {
    const p = parseDirectives(REPLY);
    const back = serializeDirectives(p.cleanText, { moves: p.moves });
    assert.equal(parseDirectives(back).moves.length, 2);
    const copy = movesAsText(p.cleanText, p.moves);
    assert.ok(copy.includes("1. Bikin seri jawab pertanyaan pembeli"));
    assert.ok(copy.includes("2. Jualan jangan cuma Senin"));
    assert.ok(!copy.includes("⟦"));
  });

  test("duplicates and extras are dropped; a reply of moves only is not empty", () => {
    const many = Array.from({ length: MAX_MOVES + 2 }, (_, i) => `[[move:Langkah ${i}|kenapa|caranya]]`).join("\n");
    assert.equal(parseDirectives(`${many}\n[[move:Langkah 0|lagi|lagi]]`).moves.length, MAX_MOVES);
    assert.equal(isEmptyReply(parseDirectives("[[move:Satu|a|b]]")), false);
  });

  test("a move cut off mid-stream never shows as raw text", () => {
    const p = parseDirectives("Intro.\n[[move:Bikin seri|Belum ada");
    assert.equal(p.moves.length, 0);
    assert.equal(p.cleanText, "Intro.");
  });
});
