// The vocabulary of Creator's script writer: which KIND of hook opens the
// video, and which ALUR (structure) carries the middle. Shared by the AI
// modal in js/views/creator.js (the chips the owner picks from) and
// js/ai.js generateScript (the rule each pick adds to the prompt), so a new
// hook type or structure is added in one place. Plain data with no imports,
// same as js/knowledge/copy-formats.js.
//
// Everything the owner reads (label, one-line description, example) lives
// in js/i18n/creator-copy.js under hook.type.<key>.* and
// script.struct.<key>.* — add those keys too when adding an entry here.
// `rule` is English because it goes into the prompt, never on screen.
//
// `funnels`: the stages a type/structure suits best. Only used to put the
// recommended chips first with a small "cocok" mark — every chip stays
// pickable for every piece (the owner decides, Wepeka only recommends).

export const HOOK_TYPES = [
  {
    key: "curiosity",
    funnels: ["TOFU", "MOFU"],
    rule: "CURIOSITY GAP: reveal half of something surprising and specific — a consequence, a detail, a 'ternyata' — that the viewer only resolves by watching. The video must pay it off; no clickbait the body doesn't answer.",
  },
  {
    key: "contrarian",
    funnels: ["TOFU"],
    rule: "CONTRARIAN: bluntly challenge a habit or belief this audience holds ('Berhenti …', '… itu salah kaprah'), then the body proves why. It must be defensible with the brand's own facts — bold, never rude, never attacking a named competitor.",
  },
  {
    key: "mistake",
    funnels: ["MOFU", "TOFU"],
    rule: "COMMON MISTAKE: name a mistake the viewer is probably making right now, in the second person, and hint at what it costs them ('Kamu masih …? Pantes …').",
  },
  {
    key: "result",
    funnels: ["MOFU", "BOFU"],
    rule: "RESULT FIRST: open on the end result or the after-state — shown in the first frame and said in the first line — then the body rewinds to how it happened. Only results the brand context actually supports.",
  },
  {
    key: "number",
    funnels: ["BOFU", "MOFU"],
    rule: "SPECIFIC NUMBER: lead with one concrete figure taken ONLY from the brand facts or the owner's input (a price, opening hours, a count, a duration, years running). If no real number exists in the input, use the most concrete real detail instead — never invent a figure.",
  },
  {
    key: "story",
    funnels: ["TOFU", "MOFU"],
    rule: "STORY DROP-IN: start in the middle of a scene — a time, a place, an action — with no setup ('Jam 11 malam, meja ini masih penuh.'). The scene uses only the brand's real place, products, people and hours from the facts — something the owner can film tonight; never an invented process, customer or event presented as something that happened.",
  },
  {
    key: "callout",
    funnels: ["BOFU", "MOFU"],
    rule: "CALL-OUT: the very first words name the exact audience and a situation they instantly recognise ('Buat kamu yang …', 'Ayah Bunda yang …'), so the right people feel spoken to.",
  },
  {
    key: "pov",
    funnels: ["TOFU"],
    rule: "POV / RELATABLE: a 'POV: …' line on screen describing a moment this audience lives through, acted out in the first frame. Funny or painfully familiar, never mocking the viewer.",
  },
  {
    key: "secret",
    funnels: ["MOFU", "TOFU"],
    rule: "BEHIND THE SCENES: tease something the audience normally never sees — the process, the sourcing, a decision, the kitchen/workshop — framed as 'yang jarang orang tahu'. Only things the brand context supports or that can be filmed for real.",
  },
  {
    key: "versus",
    funnels: ["MOFU", "BOFU"],
    rule: "VERSUS: put two things side by side (A vs B, this vs that, before vs after) with the difference visible on screen in the first frame. Compare categories or approaches, never a named competitor.",
  },
  {
    key: "warning",
    funnels: ["BOFU", "MOFU"],
    rule: "WARNING: a direct, honest warning before a decision the viewer is about to make ('Jangan … sebelum …'). Helpful, not fear-mongering, and the body gives the thing to check.",
  },
  {
    key: "test",
    funnels: ["TOFU", "MOFU"],
    rule: "TEST / EXPERIMENT: set up a small test done on camera ('Kita tes …', 'Coba bandingin …') whose result is revealed near the end. It must be a test the owner can actually do with what the brand has.",
  },
];

// The structure of everything after the hook. `beats` is the order the
// prompt asks for (the CTA beat always comes last, added by the prompt).
export const SCRIPT_STRUCTURES = [
  { key: "auto", funnels: [], beats: "" },
  { key: "problem", funnels: ["TOFU", "MOFU"], beats: "PROBLEM (a specific, relatable detail of the pain) → WHY IT HAPPENS → THE FIX (the brand as the guide, not the hero) → PROOF (something visible or a real fact)" },
  { key: "story", funnels: ["TOFU", "MOFU"], beats: "SITUATION → CONFLICT → TURNING POINT → LESSON (what the viewer takes away)" },
  { key: "steps", funnels: ["MOFU"], beats: "STEP 1 → STEP 2 → STEP 3 (each one concrete action the viewer can copy) → THE RESULT" },
  { key: "list", funnels: ["TOFU", "MOFU"], beats: "POINT 1 → POINT 2 → POINT 3 (each one short, visual, different from the others; the strongest one last)" },
  { key: "myth", funnels: ["MOFU"], beats: "THE MYTH (what people believe) → WHY IT SOUNDS RIGHT → THE FACT (with proof) → WHAT TO DO INSTEAD" },
  { key: "beforeafter", funnels: ["MOFU", "BOFU"], beats: "BEFORE (the old state, specific) → WHAT CHANGED (the process or the product) → AFTER (the new state, shown)" },
  { key: "bts", funnels: ["TOFU", "MOFU"], beats: "THE PROCESS (what really happens, shown) → THE DETAIL MOST PEOPLE NEVER SEE → WHY WE DO IT THIS WAY" },
  { key: "versus", funnels: ["MOFU", "BOFU"], beats: "OPTION A → OPTION B → THE VERDICT (who each one is for, honestly)" },
  { key: "offer", funnels: ["BOFU"], beats: "THE PAIN IN ONE LINE → THE OFFER (exact product, price and period from the facts) → WHY TRUST IT (a real fact) → HOW TO GET IT" },
];

export const hookTypeByKey = (key) => HOOK_TYPES.find((h) => h.key === key) || null;
export const structureByKey = (key) => SCRIPT_STRUCTURES.find((s) => s.key === key) || SCRIPT_STRUCTURES[0];

// The types/structures that suit a funnel stage best, in catalog order —
// shown first, with a "cocok" mark. Never pre-selected.
export function recommendedHookTypes(funnel, n = 3) {
  return HOOK_TYPES.filter((h) => h.funnels[0] === funnel).concat(HOOK_TYPES.filter((h) => h.funnels[0] !== funnel && h.funnels.includes(funnel))).slice(0, n).map((h) => h.key);
}
export function recommendedStructures(funnel, n = 3) {
  return SCRIPT_STRUCTURES.filter((s) => s.funnels.includes(funnel)).slice(0, n).map((s) => s.key);
}

// The chips' order on screen: the recommended ones first, then the rest.
export function orderedHookTypes(funnel) {
  const rec = recommendedHookTypes(funnel);
  return [...rec.map(hookTypeByKey), ...HOOK_TYPES.filter((h) => !rec.includes(h.key))];
}
