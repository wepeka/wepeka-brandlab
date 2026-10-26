// One friendly character per app (js/apps.js) — and, inside Create, one per
// part of it (cos-*) and per kind of piece (fmt-*) — drawn as flat shapes —
// no outlines, no gradients — so a beginner recognises an app by its little
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

  // ---- Inside Create (js/views/content-os.js): one figure per part. ----
  // Creator: a little video camera with two film reels on top.
  "cos-creator": (mood) => `
    <circle cx="48" cy="40" r="20" fill="#ff8fb1"/><circle cx="48" cy="40" r="6" fill="${INK}"/>
    <circle cx="92" cy="40" r="20" fill="#ff8fb1"/><circle cx="92" cy="40" r="6" fill="${INK}"/>
    <path d="M114 78 L146 60 Q152 57 152 64 L152 116 Q152 123 146 120 L114 102 Z" fill="#ffd23f"/>
    <rect x="16" y="56" width="104" height="80" rx="24" fill="#fff6e8"/>
    ${face(68, 92, { mood })}`,
  // Kalender: a page off the wall calendar, rings on top.
  "cos-calendar": (mood) => `
    <rect x="22" y="30" width="116" height="112" rx="22" fill="#fff6e8"/>
    <path d="M22 52 Q22 30 44 30 L116 30 Q138 30 138 52 L138 62 L22 62 Z" fill="#ff5a4d"/>
    <rect x="48" y="16" width="13" height="30" rx="6.5" fill="${INK}"/>
    <rect x="99" y="16" width="13" height="30" rx="6.5" fill="${INK}"/>
    ${face(80, 98, { mood })}`,
  // Daftar Konten: a clipboard holding the list.
  "cos-list": (mood) => `
    <rect x="26" y="26" width="108" height="124" rx="20" fill="#fff6e8"/>
    <rect x="56" y="14" width="48" height="26" rx="11" fill="${INK}"/>
    <rect x="48" y="112" width="64" height="9" rx="4.5" fill="${INK}" opacity=".14"/>
    <rect x="48" y="128" width="42" height="9" rx="4.5" fill="${INK}" opacity=".14"/>
    ${face(80, 72, { mood })}`,
  // Tulisan Cepat: a speech bubble with a lightning sticker — copy, fast.
  "cos-copy": (mood) => `
    <path d="M50 30 L114 30 Q146 30 146 62 L146 86 Q146 118 114 118 L66 118 L34 146 L42 114 Q14 106 14 80 L14 62 Q14 30 50 30 Z" fill="#fff6e8"/>
    <path d="M128 4 L106 40 L122 40 L112 66 L144 26 L127 26 L138 4 Z" fill="#ffd23f"/>
    ${face(78, 72, { mood })}`,
  // Seri: a caterpillar — episodes following one another.
  "cos-series": (mood) => `
    <ellipse cx="38" cy="140" rx="7" ry="5" fill="${INK}"/><ellipse cx="72" cy="140" rx="7" ry="5" fill="${INK}"/><ellipse cx="108" cy="140" rx="7" ry="5" fill="${INK}"/>
    <circle cx="30" cy="114" r="24" fill="#ffe0b0"/>
    <circle cx="62" cy="106" r="28" fill="#fff6e8"/>
    <rect x="98" y="22" width="6" height="34" rx="3" fill="${INK}" transform="rotate(-18 101 39)"/>
    <rect x="128" y="24" width="6" height="34" rx="3" fill="${INK}" transform="rotate(18 131 41)"/>
    <circle cx="96" cy="22" r="7" fill="#ff8fb1"/><circle cx="136" cy="24" r="7" fill="#ff8fb1"/>
    <circle cx="112" cy="86" r="38" fill="#ffe0b0"/>
    ${face(112, 84, { mood, scale: 0.9 })}`,

  // ---- New content: what kind of piece (js/views/new-content-wizard.js). ----
  // Video pendek: a phone standing up.
  "fmt-video": (mood) => `
    <rect x="42" y="10" width="76" height="142" rx="20" fill="${INK}"/>
    <rect x="50" y="22" width="60" height="118" rx="12" fill="#fff6e8"/>
    <rect x="68" y="14" width="24" height="5" rx="2.5" fill="#fff6e8" opacity=".35"/>
    ${face(80, 76, { mood, scale: 0.85 })}
    <path d="M73 106 L73 124 L89 115 Z" fill="${INK}" opacity=".18"/>`,
  // Carousel: three slides fanned out.
  "fmt-carousel": (mood) => `
    <rect x="26" y="34" width="78" height="104" rx="16" fill="#fff" opacity=".45" transform="rotate(-14 65 86)"/>
    <rect x="40" y="30" width="78" height="104" rx="16" fill="#ffe8c4" transform="rotate(-4 79 82)"/>
    <rect x="54" y="28" width="78" height="104" rx="16" fill="#fff6e8" transform="rotate(8 93 80)"/>
    <g transform="rotate(8 93 80)">${face(93, 76, { mood, scale: 0.85 })}</g>`,
  // Story: a face in its story ring, with the + badge.
  "fmt-story": (mood) => `
    <circle cx="80" cy="80" r="64" fill="#ff8fb1"/>
    <circle cx="80" cy="80" r="50" fill="#fff6e8"/>
    ${face(80, 76, { mood })}
    <circle cx="126" cy="126" r="20" fill="${INK}"/>
    <rect x="117" y="123" width="18" height="6" rx="3" fill="#fff"/><rect x="123" y="117" width="6" height="18" rx="3" fill="#fff"/>`,
  // Foto: a polaroid with a little sun.
  "fmt-photo": (mood) => `
    <g transform="rotate(6 80 80)">
      <rect x="24" y="18" width="112" height="128" rx="12" fill="#fff6e8"/>
      <rect x="36" y="30" width="88" height="80" rx="6" fill="#8fd3ff"/>
      <circle cx="106" cy="50" r="11" fill="#ffd23f"/>
      <path d="M36 110 L36 96 Q62 76 88 96 Q104 86 124 98 L124 110 Z" fill="#30d97d"/>
      ${face(76, 66, { mood, scale: 0.8 })}
    </g>`,
  // Video panjang: a television on its stand.
  "fmt-long": (mood) => `
    <rect x="70" y="118" width="20" height="22" fill="${INK}"/>
    <rect x="46" y="136" width="68" height="12" rx="6" fill="${INK}"/>
    <rect x="12" y="30" width="136" height="94" rx="20" fill="#fff6e8"/>
    <rect x="58" y="10" width="6" height="26" rx="3" fill="${INK}" transform="rotate(-24 61 23)"/>
    <rect x="96" y="10" width="6" height="26" rx="3" fill="${INK}" transform="rotate(24 99 23)"/>
    ${face(80, 74, { mood })}`,
};

export function appCharacterSVG(appKey, { mood = "happy", className = "" } = {}) {
  const draw = DRAW[appKey];
  if (!draw) return "";
  return `<svg class="${className}" viewBox="0 0 160 160" aria-hidden="true" focusable="false">${draw(mood)}</svg>`;
}
