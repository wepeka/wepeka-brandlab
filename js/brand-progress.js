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
  const colors = brand.brandGuidelines?.colors || {};
  const fonts = brand.brandGuidelines?.fonts || {};
  return !!(colors.primary && fonts.primary && fonts.secondary);
}

// The full Brand Book, section by section, for Pro's "x/5" progress line.
export function brandBookProgress(brand = {}) {
  const g = brand.brandGuidelines || {};
  const parts = [
    !!g.colors?.primary,
    !!(g.fonts?.primary && g.fonts?.secondary),
    !!g.logo?.dataUrl,
    !!g.visualDirection?.length,
    !!brand.brandBuilder?.toneOfVoice?.source,
  ];
  return { filled: parts.filter(Boolean).length, total: parts.length };
}

// The gate for everything downstream (Campaign, Konten): Brand DNA saved
// and the visual basics set. Both halves, because "give this brand an
// identity" is one job.
export function identityDone(brand = {}) {
  return brandDnaDone(brand) && visualBasicsDone(brand);
}
