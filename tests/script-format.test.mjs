import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderScript, parseScript, spokenText, hookOf, applyHook, scriptLength, hookText, parseSlides, scriptLineKind, scriptToBeats, beatsToScript, beatTimeline, scriptBeatsHTML } from "../js/script-format.js";
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

describe("scriptLineKind (the full-screen page styles line by line)", () => {
  test("headers and the three labels, label length includes the space after it", () => {
    assert.deepEqual(scriptLineKind("[0-6 dtk] HOOK"), { kind: "head", labelLength: 0 });
    assert.deepEqual(scriptLineKind("Visual: Cuplikan selebrasi"), { kind: "visual", labelLength: 8 });
    assert.deepEqual(scriptLineKind("Teks layar: 35 tahun nunggu."), { kind: "onScreen", labelLength: 12 });
    assert.deepEqual(scriptLineKind("Narasi: Timnas juara."), { kind: "say", labelLength: 8 });
    assert.deepEqual(scriptLineKind("Voice: Hi"), { kind: "say", labelLength: 7 });
    assert.deepEqual(scriptLineKind("On-screen text: Hi"), { kind: "onScreen", labelLength: 16 });
  });
  test("an empty field is all label; anything else is plain", () => {
    assert.deepEqual(scriptLineKind("Narasi: "), { kind: "say", labelLength: 8 });
    assert.equal(scriptLineKind("Timnas juara setelah 35 tahun.").kind, "");
    assert.equal(scriptLineKind("").kind, "");
    assert.equal(scriptLineKind("Narasinya nanti").kind, "");
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
