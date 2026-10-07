import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { routeByRules, isWriteRequest, movesToBrainstorm } from "../js/chat-router.js";
import { parseDirectives, serializeDirectives, isEmptyReply } from "../js/ai-directives.js";

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
    // A clear ask for ideas outranks the mood (Teman would only hand it
    // on — a second AI credit); a vent or news stays with Teman.
    ["capek banget, kasih ide konten dong", "brainstorm"],
    ["lagi galau nih, tolong bantu cari hook", "brainstorm"],
    ["kesel, pelanggan minta konten gratis terus", "companion"],
    ["tadi ada yang borong, capek tapi seneng, kasih ide konten dari situ?", "companion"],
    // "How do I…" in the app isn't a request to write.
    ["gimana cara bikin konten di kalender?", "consultant"],
    ["gimana caranya bikin hook yang bagus", "brainstorm"],
    // …but a food menu or a how-to topic still is.
    ["bikinin caption buat menu baru", "brainstorm"],
  ];
  for (const [text, want] of cases) {
    test(`${JSON.stringify(text)} → ${want}`, () => assert.equal(routeByRules(text), want));
  }
});

describe("isWriteRequest (Konsultan / Teman tab → straight to Brainstorm)", () => {
  test("plain requests to write", () => {
    assert.equal(isWriteRequest("bikinin caption promo akhir bulan"), true);
    assert.equal(isWriteRequest("tolong tuliskan script cerita awal mula brand"), true);
    assert.equal(isWriteRequest("buatkan 3 hook buat reels"), true);
  });
  test("not a request to write", () => {
    assert.equal(isWriteRequest("kenapa reach aku turun?"), false);
    assert.equal(isWriteRequest("gimana cara bikin konten di kalender?"), false);
    assert.equal(isWriteRequest("di mana menu bikin konten?"), false);
    assert.equal(isWriteRequest("aku capek"), false);
    assert.equal(isWriteRequest(""), false);
  });
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
  test("a script cut off mid-way is kept as `partial`, not dropped", () => {
    const p = parseDirectives("Ini script-nya:\n[[script:MOFU|Cerita Awal|Reels]]\n[0-3 dtk] HOOK\nNarasi: Dulu aku jualan dari gerobak");
    assert.equal(p.cleanText, "Ini script-nya:");
    assert.equal(p.scripts.length, 0);
    assert.deepEqual(p.partial, { kind: "script", target: "script", title: "Cerita Awal", format: "Reels", funnel: "MOFU", text: "[0-3 dtk] HOOK\nNarasi: Dulu aku jualan dari gerobak" });
  });
  test("a partial ending inside a closing tag loses the tag", () => {
    const p = parseDirectives("[[script:TOFU|Judul]]\nNarasi: Halo [[/scr");
    assert.equal(p.partial.text, "Narasi: Halo");
  });
  test("an unclosed revision is kept as `partial` too", () => {
    const p = parseDirectives("Versi baru:\n[[revise:caption]]Caption baru yang lebih");
    assert.equal(p.revisions.length, 0);
    assert.equal(p.partial.kind, "revise");
    assert.equal(p.partial.text, "Caption baru yang lebih");
  });
  test("a complete reply has no partial", () => {
    assert.equal(parseDirectives("Ini dia.\n[[script:TOFU|J]]\nNarasi: A\n[[/script]]").partial, null);
  });
  test("raw tags never reach the text: unknown, stray or half-written", () => {
    assert.equal(parseDirectives("Oke [[unknown:apa]] siap.").cleanText, "Oke  siap.");
    assert.equal(parseDirectives("Siap.\n[[/script]]").cleanText, "Siap.");
    assert.equal(parseDirectives("Bentar ya [[scr").cleanText, "Bentar ya");
    assert.equal(parseDirectives("Lihat [[catatan ini]] ya").cleanText, "Lihat [[catatan ini]] ya");
  });
  test("isEmptyReply: nothing to see or use", () => {
    assert.equal(isEmptyReply(parseDirectives("")), true);
    assert.equal(isEmptyReply(parseDirectives("[[unknown:x]]")), true);
    assert.equal(isEmptyReply(parseDirectives("[[handoff:brainstorm]]")), false);
    assert.equal(isEmptyReply(parseDirectives("[[idea:Judul|kenapa]]")), false);
    assert.equal(isEmptyReply(parseDirectives("Halo")), false);
    assert.equal(isEmptyReply(parseDirectives("[[script:TOFU|J]]\nNarasi: A")), false);
  });
});

// Mid-conversation the panel keeps the same partner; only a request to
// write moves a Konsultan/Teman talk over to Brainstorm.
describe("movesToBrainstorm (moves an ongoing talk to Brainstorm)", () => {
  const cases = [
    ["oke bikinin script yang itu", true],
    ["kasih ide konten buat minggu depan", true],
    ["tolong tuliskan caption promo", true],
    ["hmm tapi aku takut kalau ikut-ikutan murah malah rugi", false],
    ["kenapa gak dua-duanya aja?", false],
    ["terus engagement aku kan masih kecil, mulai dari mana?", false],
    ["reservasi buat rapat besok", false],
  ];
  for (const [text, want] of cases) test(`${want ? "write" : "talk"}: ${text}`, () => assert.equal(movesToBrainstorm(text), want));
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
