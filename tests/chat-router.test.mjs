import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { routeByRules } from "../js/chat-router.js";
import { parseDirectives, serializeDirectives } from "../js/ai-directives.js";

describe("routeByRules (Tanya Brandlab, Otomatis)", () => {
  const cases = [
    // A request to write wins over every other word in the message.
    ["bikin script cerita awal mula Kopi Senja", "brainstorm"],
    ["kasih ide konten buat campaign ramadan", "brainstorm"],
    ["tolong tuliskan caption buat promo akhir bulan", "brainstorm"],
    ["capek mikir, bikinin 3 ide reels dong", "brainstorm"],
    ["buatin hook yang lebih nendang", "brainstorm"],
    ["aku bingung mau posting apa minggu ini", "brainstorm"],
    ["hook yang bagus itu kayak gimana sih", "brainstorm"],
    ["ganti hooknya yang lebih berani", "brainstorm"],
    ["Jadikan script video siap syuting dari diskusi kita barusan", "brainstorm"],
    // "buat" also means "for": not a request on its own.
    ["tadi ada 3 mahasiswa nanya bisa reservasi buat rapat organisasi gak, menurutmu bisa jadi konten?", "companion"],
    ["aku capek kerja buat konten tiap hari", "companion"],
    // Feelings and news.
    ["capek banget hari ini, sepi pembeli", "companion"],
    ["tadi ada yang borong 20 cup buat acara kampus", "companion"],
    ["aku mau cerita nih", "companion"],
    ["gak tau harus mulai dari mana", "companion"],
    // Data / the app.
    ["kenapa reach aku turun terus?", "consultant"],
    ["campaign ramadan udah sampai mana", "consultant"],
    ["jadwal konten minggu depan apa aja", "consultant"],
    ["menu kalender ada di mana ya", "consultant"],
    // A discussion goes to the thinking partner.
    ["aku mau bikin konten bedah marketing Mixue, kita bahas dulu yuk", "brainstorm"],
    ["bedah strategi marketing Gojek dong", "brainstorm"],
    ["menurutmu harga Rp15rb kemahalan nggak?", "brainstorm"],
    // …unless it is about the owner's own numbers: the model decides.
    ["menurutmu kenapa reach aku turun?", null],
    ["", null],
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text)} → ${want}`, () => assert.equal(routeByRules(text), want));
  }
});

describe("parseDirectives — what models actually write", () => {
  test("[[/revise:script]] closes a revision too (it used to vanish)", () => {
    const p = parseDirectives("Oke, ini versi barunya.\n\n[[revise:script]]HOOK\nBaru\n[[/revise:script]]\n\nCatatan kecil.");
    assert.equal(p.revisions.length, 1);
    assert.equal(p.revisions[0].text, "HOOK\nBaru");
    assert.match(p.cleanText, /Catatan kecil/);
  });
  test("[[/revise]] still works, an unclosed one is hidden", () => {
    assert.equal(parseDirectives("[[revise:caption]]Caption baru[[/revise]]").revisions[0].target, "caption");
    const open = parseDirectives("Lagi nulis…\n[[revise:script]]HOOK\nsetengah");
    assert.equal(open.revisions.length, 0);
    assert.equal(open.cleanText, "Lagi nulis…");
  });
  test("[[/script:…]] closes a script block", () => {
    const p = parseDirectives("Ini dia.\n[[script:TOFU|Judul|Reels]]\n[0-3 dtk] HOOK\nNarasi: Halo.\nCAPTION: cap #a\n[[/script:TOFU]]");
    assert.equal(p.scripts.length, 1);
    assert.equal(p.scripts[0].caption, "cap #a");
    assert.equal(p.cleanText, "Ini dia.");
  });
  test("an idea with a third part keeps a clean 'why'", () => {
    const p = parseDirectives("[[idea:Nugas sambil ngabuburit|Buka jam 4 pas buat ngabuburit.|Reels]]");
    assert.equal(p.ideas[0].why, "Buka jam 4 pas buat ngabuburit.");
  });
  test("a handoff-only reply leaves no text (the panel reroutes it)", () => {
    const p = parseDirectives("[[handoff:brainstorm]]");
    assert.equal(p.cleanText, "");
    assert.equal(p.handoff, "brainstorm");
  });
});

describe("serializeDirectives (chat history sent back to the model)", () => {
  test("puts ideas and scripts back as directive lines that parse again", () => {
    const blocks = {
      ideas: [{ title: "Ide A", why: "karena" }],
      scripts: [{ funnel: "MOFU", title: "Judul", format: "Reels", script: "[0-3 dtk] HOOK\nNarasi: Halo.", caption: "cap" }],
    };
    const text = serializeDirectives("Ini dua hal.", blocks);
    const back = parseDirectives(text);
    assert.equal(back.cleanText, "Ini dua hal.");
    assert.equal(back.ideas[0].title, "Ide A");
    assert.equal(back.scripts[0].script, "[0-3 dtk] HOOK\nNarasi: Halo.");
    assert.equal(back.scripts[0].caption, "cap");
  });
  test("plain text stays plain", () => assert.equal(serializeDirectives("halo", {}), "halo"));
});
