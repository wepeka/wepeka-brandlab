// Phase 1 of the Consistency Engine — one concrete scenario: the brand
// character established in the Personality stage (js/views/brand-builder.js)
// vs. a feeling picked later in Brand Guidelines' Color/Typography steps.
// Deterministic (compatibilityLevel is a rule lookup, not an AI call), and
// always non-blocking — this only ever returns something to *show*, never
// something that stops the user from picking whatever they want. Wider
// coverage (audience/niche changes flagging other stages, etc.) is future
// scope — see the "Explicitly deferred" section of the Brand Builder plan.
import { compatibilityLevel, feelingLabel } from "./brandbook-data.js";
import { t } from "./i18n.js";

// laterLabel is part of the stored dismissal id, so it stays as the caller
// passes it ("warna" / "typography"); only the message shows a translated word.
const LATER_LABEL_KEY = { warna: "dna.consistency.color", color: "dna.consistency.color", typography: "dna.consistency.typography" };

// laterLabel: what to call the later decision in the message, e.g. "warna"
// or "typography". Returns null when there's nothing worth flagging (no
// personality set yet, no later feeling picked yet, or they already match/
// are compatible).
export function checkPersonalityConsistency(personalityFeeling, laterFeeling, laterLabel) {
  if (!personalityFeeling || !laterFeeling) return null;
  const level = compatibilityLevel(personalityFeeling, laterFeeling);
  if (level === "compatible") return null;
  return {
    id: `personality-${laterLabel}-${personalityFeeling}-${laterFeeling}`,
    level,
    message: t(level === "strong" ? "dna.consistency.strong" : "dna.consistency.potential", {
      feeling: feelingLabel(personalityFeeling),
      label: LATER_LABEL_KEY[laterLabel] ? t(LATER_LABEL_KEY[laterLabel]) : laterLabel,
      later: feelingLabel(laterFeeling),
    }),
  };
}
