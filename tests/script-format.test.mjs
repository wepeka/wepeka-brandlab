import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderScript, parseScript, spokenText, hookOf, applyHook, scriptLength, hookText, parseSlides, plainScript, applyPlainScript, scriptToBeats, beatsToScript, beatTimeline, scriptBeatsHTML } from "../js/script-format.js";
import { HOOK_TYPES, SCRIPT_STRUCTURES, recommendedHookTypes, orderedHookTypes } from "../js/knowledge/hook-types.js";
import { t } from "../js/i18n.js";

const BEATS = [
  { label: "HOOK", visual: "Gula aren dituang ke gelas, close-up.", onScreen: "Ini bukan sirup.", say: "Kamu bisa bedain gula aren asli sama sirup dari warnanya." },
  { label: "BUKTI", visual: "Dua gelas berdampingan.", say: "Yang kiri sirup, yang kanan gula aren Blitar. Lihat bedanya pas diaduk." },
  { label: "CTA", visual: "Pintu kedai.", onScreen: "Buka sampai jam 1 malam", say: "Mampir malam ini." },
];

describe("renderScript / parseScript", () => {
  test("renders timed beat headers and the three layers (no stale length line)", () => {
    const s = renderScript(BEATS);
    assert.match(s, /^\[0-\d+ dtk\] HOOK\nVisual: Gula aren/);
    assert.ok(!s.includes("⏱"));
    assert.match(s, /Teks layar: Ini bukan sirup\./);
    assert.match(s, /Narasi: Mampir malam ini\./);
  });
  test("timings follow the narration and never overlap", () => {
    const s = renderScript(BEATS);
    const ranges = [...s.matchAll(/\[(\d+)-(\d+) dtk\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(ranges.length, 3);
    assert.equal(ranges[0][0], 0);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1]);
  });
  test("round-trips through parseScript", () => {
    const parsed = parseScript(renderScript(BEATS));
    assert.equal(parsed.beats.length, 3);
    assert.equal(parsed.beats[0].label, "HOOK");
    assert.equal(parsed.beats[1].say, BEATS[1].say);
    assert.equal(parsed.beats[2].onScreen, "Buka sampai jam 1 malam");
  });
  test("English labels render and parse too", () => {
    const s = renderScript(BEATS, { lang: "en" });
    assert.match(s, /Voice: Kamu bisa/);
    assert.match(s, /On-screen text: Ini bukan sirup/);
    assert.equal(parseScript(s).beats[0].say, BEATS[0].say);
  });
  test("reads a chat-written script ('[0-3 detik — HOOK]', 'Narasi (pelanggan):', quotes)", () => {
    const chat = 'Total durasi: 30 detik.\n\n[0-4 detik — HOOK]\nVisual: Kamera jalan ke meja.\nNarasi: "Kafe lain udah tutup."\nTeks layar: Kafe lain: tutup jam 10.\n\n[4-12 detik — SOLUSI]\nVisual: Pelanggan nugas.\nNarasi (pelanggan): "Colokannya nempel meja."';
    const p = parseScript(chat);
    assert.equal(p.beats.length, 2);
    assert.equal(p.beats[0].label, "HOOK");
    assert.equal(p.beats[0].say, "Kafe lain udah tutup.");
    assert.equal(p.preamble, "Total durasi: 30 detik.");
    assert.equal(spokenText(chat), "Kafe lain udah tutup.\n\nColokannya nempel meja.");
  });
  test("old and free-text scripts are not beat scripts", () => {
    assert.equal(parseScript("HOOK\nHalo\n\nISI PEMBAHASAN\nIsi"), null);
    assert.equal(parseScript("Slide 1\nCover\n\nSlide 2\nIsi"), null);
    assert.equal(parseScript("cuma teks biasa"), null);
  });
});

describe("Biasa: the script as plain writing (plainScript / applyPlainScript)", () => {
  const stored = renderScript(BEATS);
  const [HOOK, BUKTI, CTA] = BEATS.map((b) => b.say);

  test("shows only the words, one paragraph per part", () => {
    const { text, directed } = plainScript(stored);
    assert.equal(text, [HOOK, BUKTI, CTA].join("\n\n"));
    assert.ok(!/HOOK|dtk|Visual|Teks layar|Narasi/.test(text));
    assert.equal(directed, true);
  });
  test("free text is shown and stored exactly as typed", () => {
    const typed = "Halo semua.\n\n\nIni kopi kami.";
    assert.deepEqual(plainScript(typed), { text: typed, directed: false });
    assert.equal(applyPlainScript("", typed), typed);
    assert.equal(applyPlainScript("Halo", "Halo semua"), "Halo semua");
  });
  test("an old HOOK / ISI PEMBAHASAN script loses just its two labels", () => {
    const old = "HOOK\nHalo semua\n\nISI PEMBAHASAN\nIni isinya";
    assert.equal(plainScript(old).text, "Halo semua\n\nIni isinya");
    assert.equal(applyPlainScript(old, "Halo semua\n\nIni isinya"), old);
  });
  test("nothing typed, nothing changed", () => {
    assert.equal(applyPlainScript(stored, plainScript(stored).text), stored);
  });
  test("an edited paragraph goes back into its own part — name, Visual and Teks layar stay", () => {
    const next = applyPlainScript(stored, [HOOK, "Yang kanan gula aren asli dari Blitar.", CTA].join("\n\n"));
    const { beats } = parseScript(next);
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "BUKTI", "CTA"]);
    assert.equal(beats[1].say, "Yang kanan gula aren asli dari Blitar.");
    assert.equal(beats[1].visual, BEATS[1].visual);
    assert.equal(beats[0].onScreen, BEATS[0].onScreen);
    assert.equal(beats[2].visual, BEATS[2].visual);
  });
  test("a fully rewritten paragraph still keeps its place", () => {
    const { beats } = parseScript(applyPlainScript(stored, ["Pernah ketipu sirup?", BUKTI, CTA].join("\n\n")));
    assert.equal(beats[0].label, "HOOK");
    assert.equal(beats[0].say, "Pernah ketipu sirup?");
    assert.equal(beats[0].visual, BEATS[0].visual);
  });
  test("a new paragraph becomes a new part, where it was typed", () => {
    const { beats } = parseScript(applyPlainScript(stored, [HOOK, "Harganya sama aja.", BUKTI, CTA].join("\n\n")));
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "ISI", "BUKTI", "CTA"]);
    assert.equal(beats[1].say, "Harganya sama aja.");
    assert.equal(beats[1].visual, "");
    assert.equal(beats[2].visual, BEATS[1].visual);
  });
  test("a removed paragraph takes its part along; the others keep theirs", () => {
    const { beats } = parseScript(applyPlainScript(stored, [HOOK, CTA].join("\n\n")));
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "CTA"]);
    assert.equal(beats[1].visual, BEATS[2].visual);
  });
  test("a paragraph moved while another is edited is still found", () => {
    const { beats } = parseScript(applyPlainScript(stored, ["Baru nih.", "Yang kiri sirup, yang kanan gula aren Blitar. Lihat deh bedanya.", HOOK].join("\n\n")));
    assert.equal(beats.find((b) => /Yang kiri sirup/.test(b.say)).visual, BEATS[1].visual);
  });
  test("line breaks inside a paragraph stay in that part", () => {
    const next = applyPlainScript(stored, [`${HOOK}\nSerius.`, BUKTI, CTA].join("\n\n"));
    assert.equal(parseScript(next).beats.length, 3);
    assert.equal(plainScript(next).text, [`${HOOK}\nSerius.`, BUKTI, CTA].join("\n\n"));
  });
  test("an emptied box is an emptied script", () => {
    assert.equal(applyPlainScript(stored, "  \n"), "");
  });
  test("parts with no words (a shot, a title card) aren't shown and aren't lost", () => {
    const silent = renderScript([{ label: "BUKA", visual: "Logo." }, ...BEATS, { label: "TUTUP", onScreen: "Sampai besok" }]);
    assert.equal(plainScript(silent).text, [HOOK, BUKTI, CTA].join("\n\n"));
    const { beats } = parseScript(applyPlainScript(silent, [HOOK, "Lihat bedanya.", CTA].join("\n\n")));
    assert.deepEqual(beats.map((b) => b.label), ["BUKA", "HOOK", "BUKTI", "CTA", "TUTUP"]);
    const shotsOnly = renderScript([{ label: "BUKA", visual: "Logo." }]);
    assert.deepEqual(plainScript(shotsOnly), { text: "", directed: true });
    assert.equal(applyPlainScript(shotsOnly, " "), shotsOnly);
    assert.deepEqual(parseScript(applyPlainScript(shotsOnly, "Halo.")).beats.map((b) => b.label), ["ISI", "BUKA"]);
  });
  test("loose text under a header counts as that part's words", () => {
    const loose = "[0-3 dtk] HOOK\nKamu tau gak?\n\n[3-8 dtk] ISI\nVisual: Meja.\nNarasi: Ini dia.";
    assert.equal(plainScript(loose).text, "Kamu tau gak?\n\nIni dia.");
    const { beats } = parseScript(applyPlainScript(loose, "Kamu tau gak sih?\n\nIni dia."));
    assert.equal(beats[0].say, "Kamu tau gak sih?");
    assert.equal(beats[0].note, "");
    assert.equal(beats[1].visual, "Meja.");
  });
  test("a whole script with parts pasted in is taken as it is; English scripts stay English", () => {
    const other = renderScript([{ label: "HOOK", say: "Baru." }]);
    assert.equal(applyPlainScript(stored, other), other);
    const en = renderScript(BEATS, { lang: "en" });
    const next = applyPlainScript(en, [HOOK, "One more thing.", BUKTI, CTA].join("\n\n"));
    assert.match(next, /Voice: One more thing\./);
    assert.match(next, /s\] BODY\n/);
  });
});

describe("spokenText / scriptLength", () => {
  test("beat scripts read narration only", () => {
    const said = spokenText(renderScript(BEATS));
    assert.ok(!/Visual|Teks layar|dtk/.test(said));
    assert.match(said, /^Kamu bisa bedain/);
  });
  test("old scripts lose only their section labels", () => {
    assert.equal(spokenText("HOOK\nKalimat pembuka.\n\nISI PEMBAHASAN\nIsinya."), "Kalimat pembuka.\n\nIsinya.");
  });
  test("length counts narration words", () => {
    const { words, seconds } = scriptLength(renderScript(BEATS));
    assert.equal(words, BEATS.reduce((a, b) => a + b.say.split(/\s+/).length, 0));
    assert.ok(seconds > 0);
  });
});

// Scripts written with "[HOOK]" part names and no seconds (pasted, or from
// another chat): Biasa and the teleprompter show only what's said.
describe("parts named in brackets, without seconds", () => {
  const NAMED = '[HOOK]\nVisual: Foto kaleng Pringles.\nTeks layar: CHIPS GRATIS 200 TAHUN\nNarasi: Pringles mau ngasih chips gratis.\n\nHook B (kalau mau lebih pendek): "Ini strategi paling gelap."\n\n[PENUTUP]\nVisual: Wajahmu.\nNarasi: Stay sharp.';

  test("they are parts: Biasa, the teleprompter, the hook and the length see only the narration", () => {
    const { beats } = parseScript(NAMED);
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "PENUTUP"]);
    assert.match(beats[0].note, /^Hook B/);
    assert.equal(spokenText(NAMED), "Pringles mau ngasih chips gratis.\n\nStay sharp.");
    assert.deepEqual(plainScript(NAMED), { text: "Pringles mau ngasih chips gratis.\n\nStay sharp.", directed: true });
    assert.equal(hookOf(NAMED), "Pringles mau ngasih chips gratis.");
    assert.equal(scriptLength(NAMED).words, 7);
    assert.deepEqual(scriptToBeats(NAMED).beats.map((b) => b.label), ["HOOK", "PENUTUP"]);
  });
  test("typing in Biasa keeps each part's name and Visual", () => {
    assert.equal(applyPlainScript(NAMED, plainScript(NAMED).text), NAMED);
    const { beats } = parseScript(applyPlainScript(NAMED, "Pringles mau ngasih chips gratis.\n\nStay sharp, guys."));
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "PENUTUP"]);
    assert.equal(beats[1].say, "Stay sharp, guys.");
    assert.equal(beats[1].visual, "Wajahmu.");
  });
  test("a direction as the part name, the words under it", () => {
    const show = '**[OPENING — Kamera ke kamu, lalu arahkan HP ke laptop]**\n\n"Sumpah, kalian wajib punya ini.\n\nCoba lihat ini...\n\n**[TUNJUKIN CONTENT PLANNER]**\n\nKalian bisa planning konten **sebulan penuh**.\n\nLink-nya ada di bio aku!"';
    const { beats } = parseScript(show);
    assert.deepEqual(beats.map((b) => b.label), ["OPENING", "TUNJUKIN CONTENT PLANNER"]);
    assert.equal(beats[0].visual, "Kamera ke kamu, lalu arahkan HP ke laptop");
    assert.equal(spokenText(show), "Sumpah, kalian wajib punya ini.\nCoba lihat ini...\n\nKalian bisa planning konten sebulan penuh.\nLink-nya ada di bio aku!");
    assert.doesNotMatch(plainScript(show).text, /\[|\*\*/);
  });
  test("words before the first part name are the first part; a note above a directed script stays a note", () => {
    const loose = "Sumpah, ini gila.\n\n[TUNJUKIN APP]\nKalian bisa planning.";
    assert.deepEqual(parseScript(loose).beats.map((b) => b.label), ["HOOK", "TUNJUKIN APP"]);
    assert.equal(spokenText(loose), "Sumpah, ini gila.\n\nKalian bisa planning.");
    const noted = "Total: 30 detik\n\n[HOOK]\nNarasi: Halo.";
    assert.equal(parseScript(noted).preamble, "Total: 30 detik");
    assert.equal(spokenText(noted), "Halo.");
  });
  test("a bracket inside a sentence is not a part name", () => {
    assert.equal(parseScript("Halo [nama talent], apa kabar?\nJadi gini."), null);
  });
});

describe("what the teleprompter and Biasa leave out", () => {
  test("part names pasted inside the words; a note to the writer stays in Biasa only", () => {
    const pasted = "[0-4 dtk] HOOK\nNarasi: **[HOOK]**\nBranding itu beda.\n\n[4-8 dtk] ISI\nNarasi: [isi: contoh dari minggu ini]\nJadi gini.";
    assert.equal(plainScript(pasted).text, "Branding itu beda.\n\n[isi: contoh dari minggu ini]\nJadi gini.");
    assert.equal(spokenText(pasted), "Branding itu beda.\n\nJadi gini.");
    assert.equal(applyPlainScript(pasted, plainScript(pasted).text), pasted);
  });
  test("a dialogue keeps who says each line; one voice doesn't", () => {
    const dialog = "[0-3 dtk] HOOK\nNarasi (FIO): Kapan balikin duitku?\nNarasi (TALENT): Tīng bu dǒng.\n\n[3-6 dtk] BALIK\nNarasi (FIO): Oke, kamu yang traktir.";
    assert.equal(spokenText(dialog), "FIO: Kapan balikin duitku?\nTALENT: Tīng bu dǒng.\n\nFIO: Oke, kamu yang traktir.");
    const solo = "[0-3 dtk] HOOK\nNarasi (pelan): Halo.\n\n[3-5 dtk] ISI\nNarasi (WINSON): Jadi gini.";
    assert.equal(spokenText(solo), "Halo.\n\nJadi gini.");
  });
  test("free text: a line that is only a (direction) isn't read but stays in Biasa; **bold** marks go from both", () => {
    const typed = "Halo semua.\n(Tunjukkan layar)\nIni **fiturnya**.\n\nSampai jumpa.";
    assert.equal(spokenText(typed), "Halo semua.\nIni fiturnya.\n\nSampai jumpa.");
    assert.equal(plainScript(typed).text, "Halo semua.\n(Tunjukkan layar)\nIni fiturnya.\n\nSampai jumpa.");
  });
  test("in a timed script a pasted [NAME] line is neither a new part nor shown", () => {
    const stored = "[0-4 dtk] ISI\nNarasi: Kalimat satu.\n[CTA]\nIkuti ya.";
    assert.equal(parseScript(stored).beats.length, 1);
    assert.equal(plainScript(stored).text, "Kalimat satu.\nIkuti ya.");
    assert.equal(spokenText(stored), "Kalimat satu.\nIkuti ya.");
    assert.equal(applyPlainScript(stored, "Kalimat satu.\nIkuti ya."), stored);
  });
});

describe("hookOf", () => {
  test("beat script → the HOOK narration", () => assert.equal(hookOf(renderScript(BEATS)), BEATS[0].say));
  test("old script → text under HOOK", () => assert.equal(hookOf("HOOK\nPembuka lama\n\nISI PEMBAHASAN\nisi"), "Pembuka lama"));
  test("carousel → slide 1", () => assert.equal(hookOf("Slide 1\nCover\n\nSlide 2\nIsi"), "Cover"));
  test("free text → first line", () => assert.equal(hookOf("Baris satu\nBaris dua"), "Baris satu"));
});

describe("applyHook", () => {
  const hook = { type: "contrarian", say: "Berhenti beli kopi susu pakai sirup.", onScreen: "Stop sirup.", visual: "Botol sirup digeser keluar frame." };
  test("swaps the whole HOOK beat and keeps the body", () => {
    const next = applyHook(renderScript(BEATS), hook);
    const p = parseScript(next);
    assert.equal(p.beats[0].say, hook.say);
    assert.equal(p.beats[0].onScreen, hook.onScreen);
    assert.equal(p.beats[0].visual, hook.visual);
    assert.equal(p.beats[1].say, BEATS[1].say);
    assert.equal(p.beats.length, 3);
  });
  test("a plain-string hook on a beat script keeps the old visual", () => {
    const p = parseScript(applyHook(renderScript(BEATS), "Hook baru."));
    assert.equal(p.beats[0].say, "Hook baru.");
    assert.equal(p.beats[0].visual, BEATS[0].visual);
  });
  test("old script: replaces the text under HOOK", () => {
    assert.equal(applyHook("HOOK\nlama\n\nISI PEMBAHASAN\nisi", hook), `HOOK\n${hook.say}\n\nISI PEMBAHASAN\nisi`);
  });
  test("carousel: replaces slide 1", () => {
    assert.equal(parseSlides(applyHook("Slide 1\nCover\n\nSlide 2\nIsi", hook))[0].text, hook.say);
  });
  test("free text: re-picking replaces the previous hook instead of stacking", () => {
    const once = applyHook("Isi video.", "Hook A");
    assert.equal(applyHook(once, "Hook B", "Hook A"), "Hook B\n\nIsi video.");
  });
  test("empty script + hook object → a one-beat script", () => {
    assert.equal(parseScript(applyHook("", hook)).beats[0].say, hook.say);
  });
  test("hookText reads strings and objects", () => {
    assert.equal(hookText("  a  "), "a");
    assert.equal(hookText(hook), hook.say);
    assert.equal(hookText({ onScreen: "x" }), "x");
  });
});

describe("hook types & structures catalog", () => {
  test("every type and structure has its copy in the dictionary", () => {
    for (const h of HOOK_TYPES) for (const part of ["label", "desc", "ex"]) assert.notEqual(t(`hook.type.${h.key}.${part}`), `hook.type.${h.key}.${part}`, `${h.key}.${part}`);
    for (const s of SCRIPT_STRUCTURES) for (const part of ["label", "desc"]) assert.notEqual(t(`script.struct.${s.key}.${part}`), `script.struct.${s.key}.${part}`, `${s.key}.${part}`);
  });
  test("each funnel gets three distinct recommended hook types, listed first", () => {
    for (const f of ["TOFU", "MOFU", "BOFU"]) {
      const rec = recommendedHookTypes(f);
      assert.equal(new Set(rec).size, 3, f);
      assert.deepEqual(orderedHookTypes(f).slice(0, 3).map((h) => h.key), rec);
      assert.equal(orderedHookTypes(f).length, HOOK_TYPES.length);
    }
  });
});

describe("script cards (scriptToBeats / beatsToScript / beatTimeline)", () => {
  test("a beat script comes back as its beats and round-trips", () => {
    const text = renderScript(BEATS);
    const { beats, fromText, lang } = scriptToBeats(text);
    assert.equal(fromText, false);
    assert.equal(lang, "id");
    assert.deepEqual(beats.map((b) => b.label), ["HOOK", "BUKTI", "CTA"]);
    assert.equal(beatsToScript(beats, { lang }), text);
  });
  test("free text becomes one part per paragraph, the first one the HOOK", () => {
    const { beats, fromText } = scriptToBeats("Kalimat pertama.\n\nKalimat kedua.\nmasih kedua.\n\n\nKetiga.");
    assert.equal(fromText, true);
    assert.deepEqual(beats.map((b) => [b.label, b.say]), [["HOOK", "Kalimat pertama."], ["ISI", "Kalimat kedua.\nmasih kedua."], ["ISI", "Ketiga."]]);
  });
  test("an old HOOK / ISI PEMBAHASAN script loses only its two labels", () => {
    const { beats } = scriptToBeats("HOOK\nBuka dengan ini.\n\nISI PEMBAHASAN\nLalu ini.");
    assert.deepEqual(beats.map((b) => b.say), ["Buka dengan ini.", "Lalu ini."]);
  });
  test("an empty script starts with one empty HOOK", () => {
    const { beats, fromText } = scriptToBeats("  ");
    assert.equal(fromText, false);
    assert.equal(beats.length, 1);
    assert.equal(beats[0].label, "HOOK");
  });
  test("times follow the narration; the timeline matches the saved headers", () => {
    const beats = [{ label: "HOOK", say: "satu dua tiga empat lima" }, { label: "ISI", visual: "B-roll saja" }, { label: "CTA", say: "a b c d e f g h i j k l" }];
    const tl = beatTimeline(beats);
    assert.deepEqual(tl, [{ from: 0, to: 2 }, { from: 2, to: 4 }, { from: 4, to: 9 }]);
    const text = beatsToScript(beats);
    assert.deepEqual([...text.matchAll(/\[(\d+)-(\d+) dtk\]/g)].map((m) => [Number(m[1]), Number(m[2])]), tl.map((r) => [r.from, r.to]));
  });
  test("the read view names each part and shows no seconds per part", () => {
    const html = scriptBeatsHTML(renderScript(BEATS), (x) => x);
    assert.match(html, /beat-label">HOOK</);
    assert.match(html, /beat-label">CTA</);
    assert.doesNotMatch(html, /\d+\s*[-–]\s*\d+ dtk/);
  });
  test("a blank line typed inside a narration stays inside it", () => {
    const text = beatsToScript([{ label: "HOOK", say: "Baris satu.\n\n\nBaris dua." }]);
    const back = parseScript(text);
    assert.equal(back.beats[0].say, "Baris satu.\nBaris dua.");
    assert.equal(back.beats[0].note, "");
  });
  test("empty cards are left out of the saved text; a preamble is kept", () => {
    const text = beatsToScript([{ label: "HOOK", say: "Halo." }, { label: "ISI" }], { preamble: "Catatan syuting: outdoor" });
    assert.match(text, /^Catatan syuting: outdoor\n\n\[0-2 dtk\] HOOK\nNarasi: Halo\.$/);
  });
  test("an English script keeps English labels", () => {
    const en = renderScript(BEATS, { lang: "en" });
    const { beats, lang } = scriptToBeats(en);
    assert.equal(lang, "en");
    assert.match(beatsToScript(beats, { lang }), /Voice: Mampir malam ini\./);
  });
});
