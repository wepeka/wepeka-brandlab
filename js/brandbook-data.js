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

// Imagery Style ("Gaya Gambar") — one of the 7 components the e-book lists
// as mandatory in a Brand Guidelines document (pencahayaan, filter warna,
// penggunaan model/ilustrasi), keyed by the same Visual Direction the
// brand already picked, so it's a deterministic derivation rather than yet
// another question to ask.
export const IMAGERY_STYLE_COPY = {
  Minimal: { lighting: "Cahaya natural, terang merata, minim bayangan.", subject: "Fokus satu objek, banyak negative space.", treatment: "Warna natural, kontras rendah, tanpa filter berlebihan." },
  Editorial: { lighting: "Cahaya dramatis, kontras tinggi ala majalah.", subject: "Komposisi terstruktur, banyak white space di margin.", treatment: "Warna tajam, editing rapi dan konsisten." },
  Bold: { lighting: "Cahaya kuat, kontras tinggi, warna berani.", subject: "Objek besar mengisi frame, close-up.", treatment: "Saturasi tinggi, warna brand dominan." },
  Luxury: { lighting: "Cahaya lembut, shadow terkontrol.", subject: "Detail produk, komposisi simetris.", treatment: "Warna netral/monokrom, editing halus." },
  Playful: { lighting: "Cahaya terang, ceria.", subject: "Ekspresi natural, dinamis, candid.", treatment: "Warna cerah, sedikit oversaturate, energik." },
  Organic: { lighting: "Cahaya alami, golden hour.", subject: "Tekstur natural, bahan asli, suasana hangat.", treatment: "Warna hangat, tone earthy." },
  Futuristic: { lighting: "Cahaya tajam, kontras kuat, aksen neon/gradient.", subject: "Garis tegas, komposisi geometris.", treatment: "Warna dingin, editing modern/tech." },
  Street: { lighting: "Cahaya raw, apa adanya.", subject: "Suasana jalanan, candid, tanpa setup berlebihan.", treatment: "Kontras tinggi, sedikit grain/texture, kesan mentah." },
  Corporate: { lighting: "Cahaya studio rata dan profesional.", subject: "Komposisi rapi dan terstruktur.", treatment: "Warna konservatif, editing bersih dan konsisten." },
  Creative: { lighting: "Cahaya eksperimental, bisa campur warna.", subject: "Komposisi tak terduga, kombinasi unik.", treatment: "Warna ekspresif, editing berani." },
};

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

export const APPLICATION_TYPES = [
  { id: "social", label: "Social Media Post", renderer: "socialPostMockup" },
  { id: "website", label: "Website Hero", renderer: "websiteHeroMockup" },
  { id: "business-card", label: "Business Card", renderer: "businessCardMockup" },
  { id: "packaging", label: "Packaging Label", renderer: "packagingMockup" },
  { id: "poster", label: "Poster", renderer: "posterMockup" },
  { id: "ad", label: "Digital Ad", renderer: "digitalAdMockup" },
];
