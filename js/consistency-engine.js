// Phase 1 of the Consistency Engine — one concrete scenario: the brand
// character established in the Personality stage (js/views/brand-builder.js)
// vs. a feeling picked later in Brand Guidelines' Color/Typography steps.
// Deterministic (compatibilityLevel is a rule lookup, not an AI call), and
// always non-blocking — this only ever returns something to *show*, never
// something that stops the user from picking whatever they want. Wider
// coverage (audience/niche changes flagging other stages, etc.) is future
// scope — see the "Explicitly deferred" section of the Brand Builder plan.
import { compatibilityLevel } from "./brandbook-data.js";

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
    message:
      level === "strong"
        ? `Arah brand kamu sekarang "${personalityFeeling}". Pilihan ${laterLabel} "${laterFeeling}" ini cukup bertentangan sama arah itu — nggak salah, tapi bisa bikin kesannya nggak nyambung. Tetap pakai, atau lihat arah yang lebih align?`
        : `Arah brand kamu sekarang "${personalityFeeling}". Pilihan ${laterLabel} "${laterFeeling}" ini sedikit beda arah — nggak salah, tapi bisa melemahkan kesan yang udah dibangun. Tetap pakai, atau coba arah yang lebih align?`,
  };
}
