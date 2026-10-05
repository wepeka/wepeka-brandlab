// The single definition of "how far along is this brand's identity" — read
// by the home hero, the Brand Builder hub, the locked nav tabs (Pemula) and
// the AI consultant. Pure functions over the brand document; no imports
// from any view, so the shell can use it without pulling a view in.

// Only the 8 fields the Brand DNA wizard's own steps treat as the real
// narrative — NOT personality/values/productsServices, which the identity
// step's copy explicitly calls optional.
export function brandDnaCompleteness(dna = {}) {
  const fields = [
    dna.targetAudience, dna.problemSolved, dna.differentiation, dna.mission,
    dna.callToAction, dna.successOutcome, dna.failureOutcome, dna.tagline,
  ];
  const filled = fields.filter(Boolean).length;
  return { filled, total: fields.length };
}

// Which wizard step each counted field lives in (keys of STEPS in
// js/views/brand-dna.js), in wizard order.
const DNA_FIELD_STEPS = [
  ["targetAudience", "audience"], ["problemSolved", "problem"], ["differentiation", "guide"],
  ["mission", "plan"], ["callToAction", "cta"], ["successOutcome", "stakes"],
  ["failureOutcome", "stakes"], ["tagline", "identity"],
];

// The fields still blank, in wizard order — Beranda names them ("Tinggal:
// tagline") instead of a bare "7/8" nobody can act on.
export function missingDnaFields(dna = {}) {
  return DNA_FIELD_STEPS.filter(([f]) => !String(dna[f] || "").trim()).map(([f]) => f);
}

// Where "Lanjutkan Brand DNA" should land: the first step that still has a
// blank field, or Review when everything is filled but it's only an AI
// draft nobody saved yet. Null when there's nothing to resume.
export function dnaResumeStep(brand = {}) {
  const missing = missingDnaFields(brand.brandDNA);
  if (missing.length) return DNA_FIELD_STEPS.find(([f]) => f === missing[0])[1];
  return brand.brandDNA?.aiDraftPending ? "review" : null;
}

// "Brand DNA is finished" — every wizard field filled AND the person has
// saved it themselves. "Isi semua pakai AI" can fill all eight in one click
// without anyone having read them; that draft carries aiDraftPending until
// a real save clears it. Anything that ticks a box or unlocks a next step
// goes through here, never through the raw field count.
export function brandDnaDone(brand = {}) {
  const { filled, total } = brandDnaCompleteness(brand.brandDNA);
  return total > 0 && filled >= total && !brand.brandDNA?.aiDraftPending;
}

// The visual minimum: a primary colour plus a font pairing. This is what
// Pemula's Warna → Font flow asks for, and the one definition of "done" for
// the visual half everywhere (home hero, builder hub, guidelines save).
export function visualBasicsDone(brand = {}) {
  return guidelineSectionDone("color", brand) && guidelineSectionDone("typography", brand);
}

// The ONE rule for "this Brand Guidelines section is done" — the section
// tabs' ticks, the bar at the top of that page, Beranda and the Brand hub
// all read it. They used to carry three rules of their own (the page wanted
// three colours, Home only the main one; Fondasi and Penerapan were ticked
// on a brand nobody had touched), so the same brand could read "done" in
// one place and "2/6" in the next. A colour counts from the main colour on,
// the same line the Tujuan gate has always used (so no one gets re-locked);
// picking a feeling or a formula fills the rest of the palette anyway.
export function guidelineSectionDone(key, brand = {}) {
  const g = brand.brandGuidelines || {};
  switch (key) {
    case "foundation": return brandDnaDone(brand);
    case "logo": return !!g.logo?.dataUrl;
    case "color": return !!g.colors?.primary;
    case "typography": return !!(g.fonts?.primary && g.fonts?.secondary);
    case "direction": return !!g.visualDirection?.length;
    case "tone": return !!brand.brandBuilder?.toneOfVoice?.source;
    case "applications": return !!g.applications?.length;
    case "copy": return hasValueProposition(brand) && !!(g.aiCopy?.colorEssence?.primary || "").trim();
    default: return false;
  }
}

// The full Brand Book, section by section, for Pro's "x/6" progress line.
// Includes the book's copy pages (Value Proposition + Colour Essence) —
// those pages render a bare "not generated" empty state when
// g.aiCopy is missing, so a brand that skipped them was still showing
// 100% everywhere this counts (home hero, Builder hub card,
// isBrandBuilderComplete) even though the reader would immediately hit an
// empty page. Fixed here, once, since every caller reads off this same
// function — see brand-guidelines.js's own PROGRESS_STEP_KEYS bar for the
// matching in-page counter.
// Value Proposition is connected to Brand DNA: until the owner writes (or
// asks AI for) their own pillars, the book builds them straight from the
// DNA answers below — see dnaValuePillars in js/views/brand-guidelines.js.
// So either source counts as "filled".
export const VALUE_PROP_DNA_FIELDS = ["differentiation", "problemSolved", "successOutcome"];
export function hasValueProposition(brand = {}) {
  const own = (brand.brandGuidelines?.aiCopy?.valueProposition || []).some((p) => (p?.title || "").trim() && (p?.desc || "").trim());
  return own || VALUE_PROP_DNA_FIELDS.some((k) => String(brand.brandDNA?.[k] || "").trim());
}

// The sections the owner fills in themselves. Fondasi is copied from Brand
// DNA and Penerapan comes pre-suggested, so neither counts toward "x/6".
export const BOOK_PROGRESS_SECTIONS = ["logo", "color", "typography", "direction", "tone", "copy"];
export function brandBookProgress(brand = {}) {
  const filled = BOOK_PROGRESS_SECTIONS.filter((k) => guidelineSectionDone(k, brand)).length;
  return { filled, total: BOOK_PROGRESS_SECTIONS.length };
}

// The gate for the Tujuan tab (Konten is open from day one, not gated by
// this): Brand DNA saved and the visual basics set. Both halves, because
// "give this brand an identity" is one job.
export function identityDone(brand = {}) {
  return brandDnaDone(brand) && visualBasicsDone(brand);
}

// The same gate, piece by piece: what still stands between this brand and
// an open Tujuan tab, in the order the owner does it ("dna", "color",
// "typography"), and where to go for the first one. The lock used to say
// only "selesaikan identitas brand dulu" — which read as "Brand DNA" to
// someone who had just finished it and was still locked out by Warna & Font.
export function identityGate(brand = {}) {
  const missing = [];
  if (!brandDnaDone(brand)) missing.push("dna");
  if (!guidelineSectionDone("color", brand)) missing.push("color");
  if (!guidelineSectionDone("typography", brand)) missing.push("typography");
  const first = missing[0] || null;
  const id = brand.id || "";
  const step = first === "dna" ? dnaResumeStep(brand) : null;
  const href = !first ? null : first === "dna" ? `#/brand/${id}/dna${step ? `/${step}` : ""}` : `#/brand/${id}/guidelines/${first}`;
  return { done: !first, missing, first, href };
}

// The words for that gate (the locked tab's dialog, Beranda's locked step):
// names exactly what's left — "Tinggal Warna & Font" — and labels the button
// that goes there. `t` is passed in so this file stays import-free.
export function identityGateCopy(gate, t) {
  if (!gate || gate.done) return null;
  const visual = gate.missing.filter((k) => k !== "dna");
  const visualLabel = visual.length > 1 ? t("gate.visual.both") : visual[0] === "color" ? t("gate.visual.color") : visual[0] === "typography" ? t("gate.visual.typography") : "";
  const dna = gate.missing.includes("dna");
  const message = dna && visual.length
    ? t("gate.msg.dnaAndVisual", { visual: visualLabel })
    : dna
      ? t("gate.msg.dna")
      : t("gate.msg.visual", { visual: visualLabel, min: visual.length > 1 ? 5 : 2 });
  const action = gate.first === "dna" ? t("gate.go.dna") : t("gate.go.visual", { visual: visualLabel });
  return { message, action };
}
