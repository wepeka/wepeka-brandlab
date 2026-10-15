import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { HOOK_TEMPLATES, HOOK_TEMPLATE_GROUPS, templateBlanks, templateParts, fillTemplate, blankLabel, isFactBlank, recommendedTemplateGroups, templatesInGroup } from "../js/knowledge/hook-templates.js";
import { applyHook, parseScript, plainScript, hookOf, renderScript } from "../js/script-format.js";
import { t } from "../js/i18n.js";

describe("hook templates catalog", () => {
  test("100 templates, ten per group, numbered 1–100 in order", () => {
    assert.equal(HOOK_TEMPLATES.length, 100);
    assert.deepEqual(HOOK_TEMPLATES.map((x) => x.n), Array.from({ length: 100 }, (_, i) => i + 1));
    HOOK_TEMPLATE_GROUPS.forEach((g) => assert.equal(templatesInGroup(g.key).length, 10, g.key));
  });

  test("every template has blanks, the same number in both languages", () => {
    HOOK_TEMPLATES.forEach((x) => {
      assert.ok(templateBlanks(x.id).length > 0, `#${x.n} id has no blank`);
      assert.equal(templateBlanks(x.id).length, templateBlanks(x.en).length, `#${x.n} blank count differs`);
      // No stray bracket the blank pattern missed.
      assert.equal(fillTemplate(x.id, Object.fromEntries(templateBlanks(x.id).map((b) => [b, "x"]))).includes("["), false, `#${x.n} id`);
      assert.equal(fillTemplate(x.en, Object.fromEntries(templateBlanks(x.en).map((b) => [b, "x"]))).includes("["), false, `#${x.n} en`);
    });
  });

  test("every group has a name and a description in both languages", () => {
    HOOK_TEMPLATE_GROUPS.forEach((g) => {
      ["label", "desc"].forEach((k) => {
        const key = `hooktpl.group.${g.key}.${k}`;
        assert.notEqual(t(key), key, key);
      });
    });
  });

  test("the two prices of #9 are two blanks", () => {
    assert.deepEqual(templateBlanks(HOOK_TEMPLATES[8].id), ["PRODUK", "HARGA PRODUK", "PRODUK PEMBANDING", "HARGA PEMBANDING"]);
  });

  test("recommended groups follow the funnel stage", () => {
    assert.deepEqual(recommendedTemplateGroups("TOFU"), ["curiosity", "interrupt", "contrarian"]);
    assert.deepEqual(recommendedTemplateGroups("MOFU"), ["pain", "proof", "feeling"]);
    assert.deepEqual(recommendedTemplateGroups("BOFU"), ["urgency", "sales", "proof"]);
  });

  test("fact blanks are the ones only real data can fill", () => {
    assert.ok(isFactBlank("HARGA"));
    assert.ok(isFactBlank("DEADLINE AKTUAL"));
    assert.ok(isFactBlank("JUMLAH"));
    assert.ok(isFactBlank("PRODUCT PRICE"));
    assert.ok(!isFactBlank("TARGET AUDIENS"));
    assert.ok(!isFactBlank("REAL PROBLEM"));
    assert.ok(!isFactBlank("KEBIASAAN"));
  });
});

describe("fillTemplate", () => {
  const tpl = "Stop [AKTIVITAS] kalau kamu masih [KESALAHAN].";

  test("fills the blanks as typed", () => {
    assert.equal(fillTemplate(tpl, { AKTIVITAS: "posting tiap hari", KESALAHAN: "nggak punya pilar konten" }), "Stop posting tiap hari kalau kamu masih nggak punya pilar konten.");
  });

  test("an empty blank stays as a marked placeholder", () => {
    assert.equal(fillTemplate(tpl, { AKTIVITAS: "posting" }), "Stop posting kalau kamu masih [isi: kesalahan].");
    assert.equal(fillTemplate("Stop [ACTIVITY].", {}, { lang: "en" }), "Stop [fill in: activity].");
  });

  test("a blank that opens the line gets a capital letter", () => {
    assert.equal(fillTemplate("[HAL POPULER] nggak selalu bikin [HASIL POSITIF].", { "HAL POPULER": "followers banyak", "HASIL POSITIF": "jualan laku" }), "Followers banyak nggak selalu bikin jualan laku.");
  });

  test("a blank used twice is filled once", () => {
    assert.deepEqual(templateBlanks("[A] dan [A] lagi [B]"), ["A", "B"]);
    assert.equal(fillTemplate("[A] dan [A]", { A: "kopi" }), "Kopi dan kopi");
  });

  test("parts and labels", () => {
    assert.deepEqual(templateParts("Hai [NAMA]!"), [{ text: "Hai " }, { blank: "NAMA" }, { text: "!" }]);
    assert.equal(blankLabel("TARGET AUDIENS"), "target audiens");
  });
});

// What Creator does with the line (js/views/creator.js withTemplateHook).
describe("a template line in the script", () => {
  const line = "Stop posting tiap hari kalau kamu masih nggak punya pilar konten.";
  const use = (script, prev = "") => applyHook(script, { say: line, onScreen: "" }, prev);

  test("an empty script gets a HOOK part that Biasa shows as plain words", () => {
    const s = use("");
    assert.equal(parseScript(s).beats[0].label, "HOOK");
    assert.equal(plainScript(s).text, line);
  });

  test("a script with parts gets its first part's words replaced, its screen text cleared, its visual kept", () => {
    const s = renderScript([
      { label: "HOOK", visual: "Close-up kopi.", onScreen: "Hook lama", say: "Hook lama." },
      { label: "ISI", say: "Isinya." },
    ]);
    const p = parseScript(use(s)).beats;
    assert.equal(p[0].say, line);
    assert.equal(p[0].onScreen, "");
    assert.equal(p[0].visual, "Close-up kopi.");
    assert.equal(p[1].say, "Isinya.");
  });

  test("a plain-text script gets the line on top, and the next template replaces it", () => {
    const first = use("Isi script yang diketik biasa.");
    assert.equal(first, `${line}\n\nIsi script yang diketik biasa.`);
    const next = applyHook(first, { say: "Hook kedua.", onScreen: "" }, line);
    assert.equal(next, "Hook kedua.\n\nIsi script yang diketik biasa.");
    assert.equal(hookOf(next), "Hook kedua.");
  });
});

// js/ai.js fillHookTemplate: what the model sends back is cleaned before
// the picker shows it.
describe("fillHookTemplate (AI ideas for the blanks)", async () => {
  const { auth } = await import("../js/firebase.js");
  const { fillHookTemplate } = await import("../js/ai.js");
  let realFetch;
  let reply;
  let sent;
  const answer = (obj) => () => new Response(JSON.stringify({ text: JSON.stringify(obj) }), { status: 200, headers: { "content-type": "application/json" } });
  const { before, after } = await import("node:test");
  before(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return reply(); };
    auth.currentUser = { getIdToken: async () => "test-token" };
  });
  after(() => {
    globalThis.fetch = realFetch;
    auth.currentUser = null;
  });
  const CONTEXT = "BRAND: Kopi Pagi. Buka 05.00–11.00. Menu: kopi susu gula aren Rp18.000. Pesan dari motor sekitar 2 menit.";

  test("a real-data blank keeps only what was given; other blanks keep their ideas", async () => {
    reply = answer({ note: "", options: [
      { line: "", values: { STRATEGI: "buka sebelum subuh", DURASI: "2 minggu" } },
      { line: "", values: { STRATEGI: "jualan ke ojol", DURASI: "beberapa bulan" } },
    ] });
    const tpl = "Aku sudah mencoba [STRATEGI] selama [DURASI], dan ini hasilnya.";
    const { options } = await fillHookTemplate({ provider: "deepseek" }, { template: tpl, blanks: templateBlanks(tpl), brandContext: CONTEXT });
    assert.deepEqual(options, [{ STRATEGI: "buka sebelum subuh", DURASI: "" }, { STRATEGI: "jualan ke ojol", DURASI: "" }]);
    assert.match(sent.system, /REAL-DATA BLANKS: \[DURASI\]/);
    assert.equal(sent.feature, "hook-template");
  });

  test("a price from the brand facts stays; an invented one goes", async () => {
    reply = answer({ options: [{ values: { HARGA: "Rp18.000", PRODUK: "kopi susu gula aren" } }, { values: { HARGA: "tiga puluh ribu", PRODUK: "paket sarapan" } }, { values: { HARGA: "18rb", PRODUK: "kopi susu" } }] });
    const tpl = "Ini yang kamu dapatkan dengan [HARGA] untuk [PRODUK].";
    const { options } = await fillHookTemplate({ provider: "deepseek" }, { template: tpl, blanks: templateBlanks(tpl), brandContext: CONTEXT });
    assert.deepEqual(options.map((o) => o.HARGA), ["Rp18.000", "", ""]);
  });

  test("what the owner typed is kept and sent as given; a note with every box filled is dropped", async () => {
    reply = answer({ note: "Rp27.000 itu harga gabungan…", options: [{ values: { HARGA: "Rp99.000", PRODUK: "kopi susu plus roti" } }] });
    const tpl = "Ini yang kamu dapatkan dengan [HARGA] untuk [PRODUK].";
    const { options, note } = await fillHookTemplate({ provider: "deepseek" }, { template: tpl, blanks: templateBlanks(tpl), filled: { HARGA: "Rp27.000" }, brandContext: CONTEXT });
    assert.deepEqual(options, [{ HARGA: "Rp27.000", PRODUK: "kopi susu plus roti" }]);
    assert.equal(note, "");
    assert.match(sent.user, /\[HARGA\] = Rp27\.000/);
    assert.doesNotMatch(sent.system, /REAL-DATA BLANKS/);
  });

  test("a value repeating the word next to its blank loses the repeat; punctuation and brackets go", async () => {
    reply = answer({ options: [{ values: { BRAND: "Kopi Pagi", "HASIL MENGEJUTKAN": "bisa bikin antre pindah ke jendela", "FAKTA KONTRADIKTIF": "[tempatnya kecil]." } }] });
    const tpl = "Kenapa [BRAND] bisa [HASIL MENGEJUTKAN], padahal [FAKTA KONTRADIKTIF]?";
    const { options } = await fillHookTemplate({ provider: "deepseek" }, { template: tpl, blanks: templateBlanks(tpl), brandContext: CONTEXT });
    assert.equal(fillTemplate(tpl, options[0]), "Kenapa Kopi Pagi bisa bikin antre pindah ke jendela, padahal tempatnya kecil?");
  });

  test("the values follow the template's language", async () => {
    reply = answer({ options: [{ values: { ACTIVITY: "posting daily", MISTAKE: "guessing" } }] });
    const tpl = "Stop [ACTIVITY] if you're still [MISTAKE].";
    await fillHookTemplate({ provider: "deepseek" }, { template: tpl, lang: "en", blanks: templateBlanks(tpl), brandContext: CONTEXT });
    assert.match(sent.system, /OUTPUT LANGUAGE: every value and the note are in natural, friendly US English/);
  });

  test("nothing usable is an error the picker can show", async () => {
    reply = answer({ options: [] });
    const tpl = "Stop [AKTIVITAS].";
    await assert.rejects(fillHookTemplate({ provider: "deepseek" }, { template: tpl, blanks: templateBlanks(tpl) }));
  });
});
