// Brand DNA / Brand Book / onboarding clarity (audit 2026-10-05):
//  - the Tujuan gate names exactly what's missing and where to go
//    (js/brand-progress.js identityGate + identityGateCopy),
//  - every Brand Book upload is checked against the brand doc's 1 MiB cap
//    (js/brand-doc-size.js),
//  - a DNA "compose" step's combined answer follows edits in its boxes until
//    the owner writes in it themselves (js/views/brand-dna.js followComposed).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { identityGate, identityGateCopy } from "../js/brand-progress.js";
import { brandDocBytes, brandDocFits, guardBrandDocSize, BRAND_DOC_BUDGET, BRAND_DOC_LIMIT } from "../js/brand-doc-size.js";
import { followComposed } from "../js/views/brand-dna.js";
import { t, __i18nSources } from "../js/i18n.js";

const DNA_DONE = {
  targetAudience: "Ibu muda", problemSolved: "Nggak sempat masak", differentiation: "Resep rumahan",
  mission: "1) Chat 2) Pesan 3) Terima", callToAction: "Pesan sekarang", successOutcome: "Anak makan sehat",
  failureOutcome: "Jajan sembarangan", tagline: "Sehat tiap hari",
};
const brandWith = ({ dna = {}, colors = {}, fonts = {} } = {}) => ({
  id: "b1",
  brandDNA: { ...dna },
  brandGuidelines: { colors, fonts },
});

describe("identityGate: what still locks Tujuan, piece by piece", () => {
  test("a fresh brand misses all three and starts at Brand DNA's first step", () => {
    const g = identityGate(brandWith());
    assert.equal(g.done, false);
    assert.deepEqual(g.missing, ["dna", "color", "typography"]);
    assert.equal(g.first, "dna");
    assert.equal(g.href, "#/brand/b1/dna/audience");
  });
  test("DNA saved, no colours yet → Warna is next", () => {
    const g = identityGate(brandWith({ dna: DNA_DONE }));
    assert.deepEqual(g.missing, ["color", "typography"]);
    assert.equal(g.href, "#/brand/b1/guidelines/color");
  });
  test("only the fonts left → Tipografi", () => {
    const g = identityGate(brandWith({ dna: DNA_DONE, colors: { primary: "#112233" }, fonts: { primary: "Inter" } }));
    assert.deepEqual(g.missing, ["typography"]);
    assert.equal(g.href, "#/brand/b1/guidelines/typography");
  });
  test("an unsaved AI draft still counts as DNA missing, and lands on Review", () => {
    const g = identityGate(brandWith({ dna: { ...DNA_DONE, aiDraftPending: true }, colors: { primary: "#112233" }, fonts: { primary: "Inter", secondary: "Lora" } }));
    assert.deepEqual(g.missing, ["dna"]);
    assert.equal(g.href, "#/brand/b1/dna/review");
  });
  test("everything in → open, nothing to link to", () => {
    const g = identityGate(brandWith({ dna: DNA_DONE, colors: { primary: "#112233" }, fonts: { primary: "Inter", secondary: "Lora" } }));
    assert.equal(g.done, true);
    assert.equal(g.href, null);
    assert.equal(identityGateCopy(g, t), null);
  });
});

describe("identityGateCopy: the lock says exactly what's left (Indonesian)", () => {
  test("DNA done → 'Tinggal Warna & Font', button goes there", () => {
    const copy = identityGateCopy(identityGate(brandWith({ dna: DNA_DONE })), t);
    assert.match(copy.message, /^Tinggal Warna & Font/);
    assert.match(copy.message, /Tujuan/);
    assert.equal(copy.action, "Ke Warna & Font");
  });
  test("only fonts left names only Font", () => {
    const copy = identityGateCopy(identityGate(brandWith({ dna: DNA_DONE, colors: { primary: "#112233" } })), t);
    assert.match(copy.message, /^Tinggal Font/);
    assert.equal(copy.action, "Ke Font");
  });
  test("nothing done names both halves and starts at Brand DNA", () => {
    const copy = identityGateCopy(identityGate(brandWith()), t);
    assert.match(copy.message, /Brand DNA dan Warna & Font/);
    assert.equal(copy.action, "Ke Brand DNA");
  });
  test("the old vague line is gone", () => {
    assert.doesNotMatch(t("nav.locked"), /identitas brand/);
    assert.doesNotMatch(t("home.next.lockedToast"), /identitas brand/);
    assert.match(t("beginner.tour.journey.body"), /Warna & Font/);
  });
});

describe("brand doc size guard", () => {
  const big = (n) => "x".repeat(n);
  test("measures what would be written, in bytes", () => {
    assert.equal(brandDocBytes({ a: "é" }), JSON.stringify({ a: "é" }).length + 1);
  });
  test("a small upload on a small brand fits", () => {
    assert.equal(brandDocFits({ id: "b", name: "Kopi" }, { brandGuidelines: { logo: { dataUrl: big(50_000) } } }), true);
    assert.equal(guardBrandDocSize({ id: "b" }, { coverPhoto: big(10) }), true);
  });
  test("an upload that pushes the brand past the budget is refused", () => {
    const brand = { id: "b", brandGuidelines: { moodboard: [{ dataUrl: big(700 * 1024) }] } };
    assert.equal(brandDocFits(brand, { coverPhoto: big(250 * 1024) }), false);
  });
  test("replacing something big with something smaller is allowed even over budget", () => {
    const brand = { id: "b", coverPhoto: big(950 * 1024) };
    assert.ok(brandDocBytes(brand) > BRAND_DOC_BUDGET && brandDocBytes(brand) < BRAND_DOC_LIMIT);
    assert.equal(brandDocFits(brand, { coverPhoto: big(940 * 1024) }), true);
    assert.equal(brandDocFits(brand, { coverPhoto: big(960 * 1024) }), false);
  });
});

describe("DNA compose step: the combined answer follows its boxes", () => {
  test("still empty → takes what the boxes make", () => {
    assert.equal(followComposed("", "", "Ibu muda."), "Ibu muda.");
  });
  test("still exactly what Gabungkan made → follows the edit", () => {
    assert.equal(followComposed("Ibu muda.", "Ibu muda.", "Ibu muda di Kediri."), "Ibu muda di Kediri.");
    assert.equal(followComposed("  Ibu muda. ", "Ibu muda.", "Ibu muda di Kediri."), "Ibu muda di Kediri.");
  });
  test("written by the owner → left alone (null)", () => {
    assert.equal(followComposed("Ibu muda yang sibuk kerja.", "Ibu muda.", "Ibu muda di Kediri."), null);
  });
});

describe("new copy has both languages", () => {
  const { core, extra } = __i18nSources();
  const all = Object.assign({}, core, ...Object.values(extra));
  const keys = [
    "gate.title", "gate.msg.dnaAndVisual", "gate.msg.dna", "gate.msg.visual", "gate.visual.both", "gate.visual.color",
    "gate.visual.typography", "gate.go.dna", "gate.go.visual", "gate.later", "dna.compose.stale", "dna.done.laterToast",
    "ai.creditTag", "tour.onb.startDna.title", "tour.onb.startDna.body", "bg.reco.pickCharacter", "bg.reco.pickCharacterNote",
    "bg.reco.characterSaved", "bg.logo.useAvatar", "bg.logo.useAvatarTitle", "guidelines.progressMissing", "guidelines.progressAll",
    "guidelines.progressBasics", "brandDoc.tooBig",
  ];
  for (const k of keys) {
    test(k, () => {
      assert.ok(all[k]?.en?.trim(), `${k} en`);
      assert.ok(all[k]?.id?.trim(), `${k} id`);
    });
  }
  test("AI is framed as help, not a stand-in", () => {
    for (const k of ["dna.proBrief.title", "dna.aiFill.confirm.title", "brandForm.aiNeedNotes", "tour.onb.desc.body"]) {
      assert.doesNotMatch(all[k].id, /biar AI|AI yang rapiin|biar dirapiin/i, k);
    }
  });
});
