// One friendly character per app (js/apps.js), drawn as flat shapes — no
// outlines, no gradients — so a beginner recognises an app by its little
// figure before reading its name (owner's references, 2026-10-26: bold
// flat colour blocks with cute shape-characters). Every face is the same
// two eyes and a small open smile; `mood: "sleep"` closes the eyes for an
// app that isn't open yet (Pemula's My Goals before the identity is done).
const INK = "#1b1a17";

function face(cx, cy, { mood = "happy", scale = 1 } = {}) {
  const s = scale;
  const dx = 13 * s;
  if (mood === "sleep") {
    return `
      <rect x="${cx - dx - 7 * s}" y="${cy - 2 * s}" width="${14 * s}" height="${4.5 * s}" rx="${2.25 * s}" fill="${INK}"/>
      <rect x="${cx + dx - 7 * s}" y="${cy - 2 * s}" width="${14 * s}" height="${4.5 * s}" rx="${2.25 * s}" fill="${INK}"/>
      <rect x="${cx - 6 * s}" y="${cy + 12 * s}" width="${12 * s}" height="${4.5 * s}" rx="${2.25 * s}" fill="${INK}"/>`;
  }
  return `
    <ellipse cx="${cx - dx}" cy="${cy}" rx="${5.5 * s}" ry="${7.5 * s}" fill="${INK}"/>
    <ellipse cx="${cx + dx}" cy="${cy}" rx="${5.5 * s}" ry="${7.5 * s}" fill="${INK}"/>
    <circle cx="${cx - dx + 1.8 * s}" cy="${cy - 2.6 * s}" r="${1.9 * s}" fill="#fff"/>
    <circle cx="${cx + dx + 1.8 * s}" cy="${cy - 2.6 * s}" r="${1.9 * s}" fill="#fff"/>
    <path d="M${cx - 9 * s} ${cy + 11 * s} Q${cx} ${cy + 24 * s} ${cx + 9 * s} ${cy + 11 * s} Z" fill="${INK}"/>`;
}

const zz = (x, y) => `<text x="${x}" y="${y}" font-family="var(--font-display), sans-serif" font-size="20" font-weight="900" fill="${INK}" opacity=".55">z</text><text x="${x + 13}" y="${y - 12}" font-family="var(--font-display), sans-serif" font-size="14" font-weight="900" fill="${INK}" opacity=".4">z</text>`;

// Each drawing sits in a 160×160 box; the card decides how big it shows.
const DRAW = {
  // My Brand: a soft four-leaf blob — the brand's own shape.
  builder: (mood) => `
    <g fill="#fff4e4">
      <circle cx="80" cy="52" r="34"/><circle cx="80" cy="108" r="34"/>
      <circle cx="52" cy="80" r="34"/><circle cx="108" cy="80" r="34"/>
      <circle cx="80" cy="80" r="36"/>
    </g>
    ${face(80, 78, { mood })}`,
  // My Goals: a little mountain with a flag on top.
  campaigns: (mood) => `
    <path d="M18 146 L66 60 Q80 36 94 60 L142 146 Z" fill="#d6fbe5" stroke="#d6fbe5" stroke-width="14" stroke-linejoin="round"/>
    <rect x="77" y="12" width="6" height="40" rx="3" fill="${INK}"/>
    <path d="M83 14 L114 24 L83 35 Z" fill="#ff5a4d"/>
    ${face(80, 108, { mood })}
    ${mood === "sleep" ? zz(118, 70) : ""}`,
  // Create: a pencil, tilted, ready to write.
  "content-os": (mood) => `
    <g transform="rotate(-28 80 80)">
      <rect x="52" y="6" width="56" height="30" rx="14" fill="#ff8fb1"/>
      <rect x="52" y="26" width="56" height="14" fill="#e6e0d6"/>
      <rect x="52" y="38" width="56" height="78" fill="#ffd23f"/>
      <path d="M52 116 L108 116 L80 156 Z" fill="#ffe8c4"/>
      <path d="M71 143 L89 143 L80 156 Z" fill="${INK}"/>
      ${face(80, 76, { mood })}
    </g>`,
  // Report: three bars, the tallest one proud of the numbers.
  report: (mood) => `
    <rect x="16" y="88" width="38" height="58" rx="12" fill="#efe6ff"/>
    <rect x="61" y="30" width="38" height="116" rx="12" fill="#ffffff"/>
    <rect x="106" y="64" width="38" height="82" rx="12" fill="#ffd3ea"/>
    ${face(80, 66, { mood, scale: 0.78 })}`,
  // Board: a sticky note with a strip of tape.
  papan: (mood) => `
    <g transform="rotate(7 80 80)">
      <path d="M26 30 Q26 22 34 22 L126 22 Q134 22 134 30 L134 104 L104 134 L34 134 Q26 134 26 126 Z" fill="#ffe066"/>
      <path d="M134 104 L104 134 L104 112 Q104 104 112 104 Z" fill="#f2c230"/>
      <rect x="58" y="12" width="44" height="18" rx="4" fill="#fff" opacity=".75"/>
      ${face(80, 74, { mood })}
    </g>`,
};

export function appCharacterSVG(appKey, { mood = "happy", className = "" } = {}) {
  const draw = DRAW[appKey];
  if (!draw) return "";
  return `<svg class="${className}" viewBox="0 0 160 160" aria-hidden="true" focusable="false">${draw(mood)}</svg>`;
}
