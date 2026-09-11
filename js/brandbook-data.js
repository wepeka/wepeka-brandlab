// Curated, deterministic reference data for the Brand Book builder
// (js/views/brand-guidelines.js). No AI calls — every palette/font/style
// pairing here is hand-authored from the brand's own e-book (Quest 2: Brand
// System — color psychology, the 4 color formulas, font categories, and
// visual direction), so the builder works instantly and with no API key.

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

export const COLOR_FORMULA_LABELS = {
  monochromatic: "Monochromatic — one color, light to dark. Reads clean, minimal, premium.",
  analogous: "Analogous — neighboring hues. Reads calm, natural, cohesive.",
  complementary: "Complementary — opposite hues. Reads bold, high-contrast, attention-grabbing.",
  triadic: "Triadic — three evenly-spaced hues. Reads playful, varied, energetic.",
};

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

export const APPLICATION_TYPES = [
  { id: "social", label: "Social Media Post", renderer: "socialPostMockup" },
  { id: "website", label: "Website Hero", renderer: "websiteHeroMockup" },
  { id: "business-card", label: "Business Card", renderer: "businessCardMockup" },
  { id: "packaging", label: "Packaging Label", renderer: "packagingMockup" },
  { id: "poster", label: "Poster", renderer: "posterMockup" },
  { id: "ad", label: "Digital Ad", renderer: "digitalAdMockup" },
];
