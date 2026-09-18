// Curated, deterministic reference data for the Brand Book builder
// (js/views/brand-guidelines.js). No AI calls — every palette/font/style
// pairing here is hand-authored from the brand's own e-book (Quest 2: Brand
// System — color psychology, the 4 color formulas, font categories, and
// visual direction), so the builder works instantly and with no API key.
//
// i18n: object keys and English `description`/`left`/`right` strings below
// are stored in Firestore and/or read by AI prompts (js/ai.js), so they
// stay stable. Everything the user SEES goes through the display helpers
// (feelingLabel, directionLabel, directionDescription, toneAxisDisplayLabel,
// toneExampleDisplay, personalityProfile) or the getter-based labels, all
// backed by js/i18n/brand-guidelines.js (prefix "bbdata.").
import { t } from "./i18n.js";

// Display label for any feeling key (COLOR_FEELINGS / TYPOGRAPHY_FEELINGS /
// personality feeling). Unknown keys fall back to the raw key.
export function feelingLabel(key) {
  if (!key) return "";
  const k = `bbdata.feeling.${key}`;
  const v = t(k);
  return v === k ? key : v;
}

export const COLOR_FEELINGS = [
  "Trustworthy", "Premium", "Energetic", "Natural", "Creative",
  "Minimal", "Playful", "Powerful", "Elegant",
];

// Each palette demonstrates one of the 4 formulas from the e-book:
// monochromatic (one hue, light→dark), analogous (neighboring hues),
// complementary (opposite hues, high contrast), triadic (3 evenly-spaced hues).
export const COLOR_PALETTES = {
  Trustworthy: [
    { formula: "analogous", primary: "#1e5fbf", secondary: "#2f7fd6", accent: "#5aa9ff", background: "#f5f8fc", text: "#101828" },
  ],
  Premium: [
    { formula: "monochromatic", primary: "#161616", secondary: "#3a3a3a", accent: "#c9a24b", background: "#faf9f6", text: "#161616" },
  ],
  Energetic: [
    { formula: "complementary", primary: "#e0332b", secondary: "#1fae6b", accent: "#ffb703", background: "#fffaf4", text: "#1c1610" },
  ],
  Natural: [
    { formula: "analogous", primary: "#3f7d4d", secondary: "#7fa650", accent: "#c9d16b", background: "#f6f8ef", text: "#1f2a1c" },
  ],
  Creative: [
    { formula: "triadic", primary: "#7b3fe4", secondary: "#e4b93f", accent: "#3fc7e4", background: "#faf7ff", text: "#1c1626" },
  ],
  Minimal: [
    { formula: "monochromatic", primary: "#1a1a1a", secondary: "#6b6b6b", accent: "#1a1a1a", background: "#ffffff", text: "#1a1a1a" },
  ],
  Playful: [
    { formula: "triadic", primary: "#ff5c8a", secondary: "#ffd23f", accent: "#3fb8ff", background: "#fffdf7", text: "#231a1e" },
  ],
  Powerful: [
    { formula: "complementary", primary: "#101828", secondary: "#d6491f", accent: "#f2f2f2", background: "#0c0b0a", text: "#f6f4f1" },
  ],
  Elegant: [
    { formula: "monochromatic", primary: "#2a1f3d", secondary: "#5b4b7a", accent: "#c9a24b", background: "#f8f6fa", text: "#211a2e" },
  ],
};

// Brand Personality — the same "feeling" vocabulary as COLOR_FEELINGS below
// (and TYPOGRAPHY_FEELINGS further down), so a brand's chosen character is
// one shared decision instead of three disconnected chip-selects across
// Color/Typography/Personality. Each feeling recommends a primary/secondary/
// avoid trait triad — "primary" is who the brand mostly is, "secondary"
// rounds it out, "avoid" is what would actively undercut the direction.
export const PERSONALITY_PROFILES = {
  Trustworthy: { primary: ["Reliable", "Honest", "Steady"], secondary: ["Calm", "Clear"], avoid: ["Flashy", "Unpredictable", "Vague"] },
  Premium: { primary: ["Confident", "Refined", "Exclusive"], secondary: ["Calm", "Polished"], avoid: ["Loud", "Cluttered", "Cheap-feeling"] },
  Energetic: { primary: ["Bold", "Dynamic", "Upbeat"], secondary: ["Confident", "Fast-moving"], avoid: ["Slow", "Quiet", "Overly formal"] },
  Natural: { primary: ["Warm", "Grounded", "Honest"], secondary: ["Calm", "Approachable"], avoid: ["Artificial", "Aggressive", "Corporate"] },
  Creative: { primary: ["Original", "Expressive", "Curious"], secondary: ["Playful", "Bold"], avoid: ["Rigid", "Generic", "Predictable"] },
  Minimal: { primary: ["Calm", "Clear", "Confident"], secondary: ["Quiet", "Precise"], avoid: ["Cluttered", "Loud", "Excessive"] },
  Playful: { primary: ["Fun", "Warm", "Energetic"], secondary: ["Approachable", "Spontaneous"], avoid: ["Overly serious", "Rigid", "Cold"] },
  Powerful: { primary: ["Bold", "Confident", "Decisive"], secondary: ["Serious", "Direct"], avoid: ["Timid", "Soft", "Indecisive"] },
  Elegant: { primary: ["Refined", "Graceful", "Calm"], secondary: ["Confident", "Quiet"], avoid: ["Loud", "Rough", "Cluttered"] },
};

// The same recommended triad in the current UI language (what gets shown
// and, once the user saves, stored as their own trait text).
export function personalityProfile(feeling) {
  if (!PERSONALITY_PROFILES[feeling]) return null;
  const list = (part) => t(`bbdata.personality.${feeling}.${part}`).split(",").map((x) => x.trim()).filter(Boolean);
  return { primary: list("primary"), secondary: list("secondary"), avoid: list("avoid") };
}

// Which broad character cluster each feeling belongs to — lets the
// Consistency Engine (js/consistency-engine.js) classify any pair of
// feelings (e.g. a Personality choice vs. a later Color/Typography choice)
// without hand-authoring a full 9x9 pairwise table. Same axis the e-book
// itself uses to talk about brand character (calm vs. energetic, refined
// vs. playful) — distance 0 = same cluster (compatible), 1 = adjacent
// (potential conflict, worth a gentle nudge), 2 = opposite (strong
// conflict, worth a clearer warning).
const FEELING_CLUSTER = {
  Trustworthy: "calm", Premium: "calm", Minimal: "calm", Elegant: "calm",
  Natural: "warm",
  Creative: "expressive",
  Energetic: "bold", Playful: "bold", Powerful: "bold",
};
const CLUSTER_DISTANCE = {
  calm: { calm: 0, warm: 1, expressive: 2, bold: 2 },
  warm: { calm: 1, warm: 0, expressive: 1, bold: 1 },
  expressive: { calm: 2, warm: 1, expressive: 0, bold: 1 },
  bold: { calm: 2, warm: 1, expressive: 1, bold: 0 },
};
// "compatible" | "potential" | "strong". Same feeling (or either side
// missing) is always compatible — nothing to warn about yet.
export function compatibilityLevel(feelingA, feelingB) {
  if (!feelingA || !feelingB || feelingA === feelingB) return "compatible";
  const ca = FEELING_CLUSTER[feelingA];
  const cb = FEELING_CLUSTER[feelingB];
  const d = CLUSTER_DISTANCE[ca]?.[cb] ?? 1;
  return d === 0 ? "compatible" : d === 1 ? "potential" : "strong";
}

export const COLOR_FORMULA_LABELS = {
  monochromatic: "Monochromatic — one color, light to dark. Reads clean, minimal, premium.",
  analogous: "Analogous — neighboring hues. Reads calm, natural, cohesive.",
  complementary: "Complementary — opposite hues. Reads bold, high-contrast, attention-grabbing.",
  triadic: "Triadic — three evenly-spaced hues. Reads playful, varied, energetic.",
};

// The e-book's own framing of the 4 formulas — asked as its own explicit
// "which type of palette do you want" step, before the user locks a base
// color, matching the book's Langkah 1 (pick the formula) → Langkah 2 (pick
// & lock the hex) sequence rather than one combined pick.
export const COLOR_FORMULA_INFO = [
  { key: "monochromatic", examples: "Apple, Spotify" },
  { key: "analogous", examples: "Mastercard, BP" },
  { key: "complementary", examples: "IKEA, LA Lakers" },
  { key: "triadic", examples: "Burger King, Google" },
].map((f) => ({
  ...f,
  get label() { return t(`bbdata.formula.${f.key}.label`); },
  get desc() { return t(`bbdata.formula.${f.key}.desc`); },
  get kesan() { return t(`bbdata.formula.${f.key}.impression`); },
}));

export function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Computes a full 5-role palette from ONE base hex + a chosen harmony
// formula via real HSL hue-rotation math, instead of a fixed lookup table —
// works for any base color (typed, eyedropped, or extracted from a photo),
// not just a small preset list.
export function generatePaletteFromBase(baseHex, formula) {
  const { h, s, l } = hexToHsl(baseHex);
  const bg = hslToHex(h, Math.max(4, s - 55), 97);
  const text = hslToHex(h, Math.min(100, s + 10), 12);
  if (formula === "monochromatic") {
    return { primary: baseHex, secondary: hslToHex(h, Math.max(10, s - 15), Math.min(85, l + 18)), accent: hslToHex(h, Math.min(100, s + 10), Math.max(15, l - 20)), background: bg, text };
  }
  if (formula === "analogous") {
    return { primary: baseHex, secondary: hslToHex(h + 30, s, l), accent: hslToHex(h - 30, s, l), background: bg, text };
  }
  if (formula === "complementary") {
    return { primary: baseHex, secondary: hslToHex(h + 180, s, l), accent: hslToHex(h, Math.min(100, s + 15), Math.min(88, l + 15)), background: bg, text };
  }
  // triadic
  return { primary: baseHex, secondary: hslToHex(h + 120, s, l), accent: hslToHex(h + 240, s, l), background: bg, text };
}

export function hexToRgb(hex) {
  const h = (hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function hexToCmyk(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const k = 1 - Math.max(rf, gf, bf);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rf - k) / (1 - k);
  const m = (1 - gf - k) / (1 - k);
  const y = (1 - bf - k) / (1 - k);
  return { c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100) };
}

// WCAG 2.1 relative-luminance contrast ratio between two hex colors — powers
// the Color System page's accessibility check (a 4.5:1 minimum for normal
// text is the AA bar every text/background pairing gets measured against).
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
export function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const TYPOGRAPHY_FEELINGS = [
  "Modern", "Elegant", "Bold", "Friendly", "Minimal", "Editorial", "Playful", "Professional",
];

// Real Google Fonts family names — loaded live via a dynamically-injected
// <link> tag so previews render in the actual typeface, not a label.
export const FONT_LIBRARY = [
  { family: "Inter", category: "Sans Serif", feelings: ["Modern", "Minimal", "Professional"] },
  { family: "Manrope", category: "Sans Serif", feelings: ["Modern", "Friendly", "Minimal"] },
  { family: "Space Grotesk", category: "Sans Serif", feelings: ["Modern", "Bold"] },
  { family: "Poppins", category: "Sans Serif", feelings: ["Friendly", "Playful", "Modern"] },
  { family: "Archivo Black", category: "Display", feelings: ["Bold", "Playful"] },
  { family: "Playfair Display", category: "Serif", feelings: ["Elegant", "Editorial"] },
  { family: "DM Serif Display", category: "Serif", feelings: ["Elegant", "Editorial", "Professional"] },
  { family: "Fraunces", category: "Serif", feelings: ["Editorial", "Elegant"] },
  { family: "Bricolage Grotesque", category: "Sans Serif", feelings: ["Modern", "Bold", "Editorial"] },
  { family: "Caveat", category: "Handwritten", feelings: ["Friendly", "Playful"] },
  { family: "Source Serif 4", category: "Serif", feelings: ["Professional", "Elegant"] },
  { family: "Work Sans", category: "Sans Serif", feelings: ["Minimal", "Modern", "Professional"] },
];

export const PREMIUM_FONT_LINK = "https://elements.envato.com/fonts";

// The Typography step's "Wepeka Rekomendasi" panel — deliberately stops at
// recommending a TYPE of font (Serif, Sans Serif, ...), never a specific
// family, so it stays a deterministic lookup instead of pretending to know
// someone's exact taste. Sector list is the e-book's own examples per
// type; `flatSectors` is just that same data reshaped into one flat pick
// list (sector -> category) for the chip UI.
export const FONT_CATEGORIES = [
  { key: "serif", sectorKeys: ["law", "finance", "hotel", "luxury", "print"], googleFontsUrl: "https://fonts.google.com/?category=Serif" },
  { key: "sans-serif", sectorKeys: ["tech", "apps", "cosmetics", "casualFashion", "agency"], googleFontsUrl: "https://fonts.google.com/?category=Sans+Serif" },
  { key: "script", sectorKeys: ["wedding", "premiumBeauty", "cosmetics", "jewelry", "highFashion"], googleFontsUrl: "https://fonts.google.com/?category=Handwriting" },
  { key: "blackletter", sectorKeys: ["barber", "streetwear", "metal", "alcohol"], googleFontsUrl: "https://fonts.google.com/?category=Display" },
  { key: "display", sectorKeys: ["eventPoster", "socialTitles", "standOut"], googleFontsUrl: "https://fonts.google.com/?category=Display" },
  { key: "monospace", sectorKeys: ["devTech", "graphicDesign", "retroDigital"], googleFontsUrl: "https://fonts.google.com/?category=Monospace" },
  { key: "handwritten", sectorKeys: ["cafe", "organicFood", "kidsToys", "journals", "ecoBrands"], googleFontsUrl: "https://fonts.google.com/?category=Handwriting" },
].map((c) => ({
  ...c,
  get label() { return t(`bbdata.fontCat.${c.key}.label`); },
  get desc() { return t(`bbdata.fontCat.${c.key}.desc`); },
  get sectors() { return c.sectorKeys.map((s) => t(`bbdata.fontCat.${c.key}.sector.${s}`)); },
}));
export const FONT_CATEGORY_SECTORS = FONT_CATEGORIES.flatMap((c) => c.sectors.map((sector) => ({ sector, categoryKey: c.key })));

// A ready-to-use primary (heading) + secondary (body) combo for each font
// category above — real Google Fonts family names, contrasting where the
// e-book's own pairing rule calls for it (a decorative/characterful heading
// needs a plain, highly-readable body next to it). Shown in the "Wepeka
// Rekomendasi" panel next to the category so picking a type of font doesn't
// dead-end at just a label — there's an actual pair someone can apply.
export const FONT_CATEGORY_PAIRINGS = {
  serif: { primary: "Playfair Display", secondary: "Work Sans" },
  "sans-serif": { primary: "Space Grotesk", secondary: "Inter" },
  script: { primary: "Dancing Script", secondary: "Source Serif 4" },
  blackletter: { primary: "UnifrakturMaguntia", secondary: "Work Sans" },
  display: { primary: "Archivo Black", secondary: "Work Sans" },
  monospace: { primary: "Space Mono", secondary: "Inter" },
  handwritten: { primary: "Caveat", secondary: "Manrope" },
};

// feeling -> {primary (heading), secondary (body)} — contrasting where the
// e-book's own pairing rule calls for it (Serif heading + Sans body etc.).
export const FONT_PAIRINGS = {
  Modern: { primary: "Space Grotesk", secondary: "Inter" },
  Elegant: { primary: "Playfair Display", secondary: "Source Serif 4" },
  Bold: { primary: "Archivo Black", secondary: "Work Sans" },
  Friendly: { primary: "Poppins", secondary: "Manrope" },
  Minimal: { primary: "Work Sans", secondary: "Inter" },
  Editorial: { primary: "Fraunces", secondary: "Source Serif 4" },
  Playful: { primary: "Caveat", secondary: "Poppins" },
  Professional: { primary: "DM Serif Display", secondary: "Inter" },
};

// A visual-direction choice re-skins the live mockups (spacing/radius/type
// scale) so the pick is visibly felt, not just a label on the PDF.
export const VISUAL_DIRECTIONS = {
  Minimal: { radius: "2px", spacingScale: 1.15, typeScale: 1, description: "Lots of white space, restrained color, quiet typography." },
  Editorial: { radius: "0px", spacingScale: 1.3, typeScale: 1.1, description: "Magazine-like structure — strong headlines, generous margins." },
  Bold: { radius: "6px", spacingScale: 0.9, typeScale: 1.15, description: "High contrast, oversized type, confident and loud." },
  Luxury: { radius: "0px", spacingScale: 1.4, typeScale: 1.05, description: "Maximum whitespace, restrained palette, serif-led." },
  Playful: { radius: "20px", spacingScale: 0.85, typeScale: 1, description: "Rounded shapes, tighter spacing, energetic color use." },
  Organic: { radius: "24px", spacingScale: 1.05, typeScale: 0.95, description: "Soft shapes, natural tones, handmade feel." },
  Futuristic: { radius: "4px", spacingScale: 0.9, typeScale: 1.05, description: "Sharp edges, tight tracking, tech-forward." },
  Street: { radius: "0px", spacingScale: 0.8, typeScale: 1.2, description: "Raw, high-contrast, poster-like energy." },
  Corporate: { radius: "4px", spacingScale: 1.1, typeScale: 0.95, description: "Structured grid, conservative color, professional." },
  Creative: { radius: "14px", spacingScale: 1, typeScale: 1.05, description: "Expressive, varied shapes, unexpected combinations." },
};
// `description` above is English on purpose (AI prompt context); these are
// the UI-language versions.
export function directionLabel(key) {
  if (!key) return "";
  const k = `bbdata.direction.${key}.label`;
  const v = t(k);
  return v === k ? key : v;
}
export function directionDescription(key) {
  const k = `bbdata.direction.${key}.desc`;
  const v = t(k);
  return v === k ? VISUAL_DIRECTIONS[key]?.description || "" : v;
}

// Imagery Style ("Gaya Gambar") — one of the 7 components the e-book lists
// as mandatory in a Brand Guidelines document (pencahayaan, filter warna,
// penggunaan model/ilustrasi), keyed by the same Visual Direction the
// brand already picked, so it's a deterministic derivation rather than yet
// another question to ask.
export const IMAGERY_STYLE_COPY = Object.fromEntries(
  ["Minimal", "Editorial", "Bold", "Luxury", "Playful", "Organic", "Futuristic", "Street", "Corporate", "Creative"].map((d) => [
    d,
    {
      get lighting() { return t(`bbdata.imagery.${d}.lighting`); },
      get subject() { return t(`bbdata.imagery.${d}.subject`); },
      get treatment() { return t(`bbdata.imagery.${d}.treatment`); },
    },
  ])
);

// Tone of Voice — the e-book's 4 spectrums (Formal↔Casual, Sederhana↔
// Kompleks, Serius↔Playful, Reserved↔Ekspresif). Values are 0-100 slider
// positions; toneAxisLabel turns a raw position into a human label, and
// toneExampleMessage rewrites the e-book's OWN worked example — a store
// closing early for renovations — using the two axes it actually
// demonstrates (formal/casual × serious/playful), so this stage produces
// something concrete to react to instead of an abstract label.
export const TONE_AXES = [
  { key: "formal", left: "Formal", right: "Casual" },
  { key: "language", left: "Sederhana", right: "Kompleks" },
  { key: "character", left: "Serius", right: "Playful" },
  { key: "emotion", left: "Reserved", right: "Ekspresif" },
];

function toneBucket(v) {
  return v < 35 ? "low" : v > 65 ? "high" : "mid";
}
export function toneAxisLabel(axis, value) {
  const b = toneBucket(value);
  return b === "low" ? axis.left : b === "high" ? axis.right : `${axis.left}/${axis.right} seimbang`;
}
// toneAxisLabel above feeds AI prompts (js/ai.js) and stays as-is; this is
// the same bucket label in the UI language, for screens and the Brand Book.
export function toneAxisDisplayLabel(axis, value) {
  const b = toneBucket(value);
  const left = t(`guidelines.tone.axis.${axis.key}.left`);
  const right = t(`guidelines.tone.axis.${axis.key}.right`);
  return b === "low" ? left : b === "high" ? right : t("bbdata.tone.balanced", { left, right });
}

// [formal bucket][character bucket] — low=Formal/Serius pole, high=Casual/
// Playful pole, same "toko tutup lebih awal karena renovasi" scenario
// throughout so only the tone changes, not the message.
const TONE_EXAMPLE_MATRIX = {
  low: {
    low: `"Pemberitahuan. Sehubungan dengan perbaikan fasilitas internal, operasional toko kami hari ini ditutup lebih awal pukul 17.00 WIB. Mohon maaf atas ketidaknyamanan yang ditimbulkan."`,
    mid: `"Kepada pelanggan yang terhormat, mohon maaf toko kami tutup lebih awal hari ini pukul 17.00 karena ada perbaikan. Terima kasih atas pengertiannya."`,
    high: `"Hari ini kami tutup sedikit lebih awal, jam 5 sore, karena ada perbaikan fasilitas. Mohon maaf atas ketidaknyamanannya, sampai jumpa besok!"`,
  },
  mid: {
    low: `"Halo, mohon maaf toko tutup lebih awal hari ini (jam 5 sore) karena ada perbaikan internal. Terima kasih sudah memahami."`,
    mid: `"Hai, hari ini kita tutup lebih awal ya jam 5 sore — lagi renovasi dikit. Makasih pengertiannya!"`,
    high: `"Hai! Hari ini kita cabut lebih cepat jam 5 sore soalnya lagi beberes toko. Makasih ya udah ngertiin, sampai besok!"`,
  },
  high: {
    low: `"Halo, mohon maaf ya, tokonya tutup lebih awal hari ini jam 5 sore karena ada perbaikan. Makasih sudah mengerti."`,
    mid: `"Gais, hari ini mimin tutup jam 5 sore ya, lagi renovasi dikit biar makin nyaman. Makasih pengertiannya!"`,
    high: `"Gais, maaf banget ya! Hari ini mimin terpaksa tutup warung jam 5 sore nih, soalnya lantai toko mau divermak dulu biar makin estetik pas kamu nongkrong besok. Sampai ketemu besok dengan wajah baru, ya!"`,
  },
};
export function toneExampleMessage(formalValue, characterValue) {
  return TONE_EXAMPLE_MATRIX[toneBucket(formalValue)][toneBucket(characterValue)];
}
// UI-language version of the same example (toneExampleMessage stays
// Indonesian for the AI prompt in js/ai.js).
export function toneExampleDisplay(formalValue, characterValue) {
  return t(`bbdata.toneExample.${toneBucket(formalValue)}.${toneBucket(characterValue)}`);
}

// Naming stage's "kamus ekstensi" — suffixes to tack onto a taken name for
// an Instagram/domain handle instead of giving up on it, grouped by the
// business category they read best for. `effect` is the one-line reason
// that category's suffixes work, shown next to the suffix chips.
export const NAME_EXTENSION_CATEGORIES = [
  { key: "fnb", suffixes: [".eats", ".kitchen", ".food", ".bakes", ".coffee", ".resto"] },
  { key: "fashion", suffixes: [".apparel", ".wear", ".cloth", ".label", ".goods", ".store"] },
  { key: "beauty", suffixes: [".beauty", ".skin", ".glow", ".cosmetics"] },
  { key: "creative", suffixes: [".studio", ".creative", ".design", ".media", ".works"] },
  { key: "services", suffixes: [".consulting", ".academy", ".coaching", ".project", ".care"] },
  { key: "tech", suffixes: [".tech", ".digital", ".app", ".hub", ".systems"] },
  { key: "trust", suffixes: [".official", ".id", ".co"] },
  { key: "global", suffixes: [".worldwide", ".global", ".company", ".corp"] },
].map((c) => ({
  ...c,
  get label() { return t(`bbdata.ext.${c.key}.label`); },
  get effect() { return t(`bbdata.ext.${c.key}.effect`); },
}));

// The 3 naming approaches the Naming stage's "belum punya nama" branch
// asks someone to pick BEFORE brainstorming — picking the angle first
// keeps the AI's suggestions focused on one strategy instead of a vague
// mixed bag. "self" skips AI brainstorming entirely (there's nothing to
// generate — it's literally their own name); "curiosity" and "descriptive"
// each steer suggestBrandNames' prompt toward that one angle only.
export const NAMING_STRATEGIES = [
  { key: "curiosity", examples: ["Erigo", "Janji Jiwa", "Fore", "Wepeka"] },
  { key: "self", examples: ["Ford", "Porsche", "Gucci", "Saint Laurent"] },
  { key: "descriptive", examples: ["Burger King", "Kopi Kenangan", "Traveloka"] },
].map((n) => ({
  ...n,
  get label() { return t(`bbdata.naming.${n.key}.label`); },
  get desc() { return t(`bbdata.naming.${n.key}.desc`); },
}));

export const APPLICATION_TYPES = [
  { id: "social", renderer: "socialPostMockup" },
  { id: "website", renderer: "websiteHeroMockup" },
  { id: "business-card", renderer: "businessCardMockup" },
  { id: "packaging", renderer: "packagingMockup" },
  { id: "poster", renderer: "posterMockup" },
  { id: "ad", renderer: "digitalAdMockup" },
].map((a) => ({
  ...a,
  get label() { return t(`bbdata.app.${a.id}`); },
}));
