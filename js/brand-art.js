// Pictures for My Brand's two parts — Brand DNA and Brand Book — in the
// launcher's style (js/app-icons.js): solid vector shapes coloured by CSS
// from the card's own two hues (`i-main` light tint, `i-ink` deep shade,
// `i-light` a paler tint), drawn big to run off the card's edge, with parts
// that move on hover. No mascots (owner, 2026-10-26).
const DRAW = {
  // A double helix: two strands crossing twice, rungs between them.
  dna: () => `
    <g class="i-helix">
      <rect class="i-light i-rung i-rung-1" x="38" y="10" width="44" height="9" rx="4.5"/>
      <rect class="i-light i-rung i-rung-2" x="38" y="56" width="44" height="9" rx="4.5"/>
      <rect class="i-light i-rung i-rung-3" x="38" y="101" width="44" height="9" rx="4.5"/>
      <path class="i-strand i-strand-a" d="M34 6 C34 34 86 32 86 60 C86 88 34 86 34 114"/>
      <path class="i-strand i-strand-b" d="M86 6 C86 34 34 32 34 60 C34 88 86 86 86 114"/>
    </g>`,
  // A closed book: spine, page edge, a ribbon, and a palette on the cover.
  book: () => `
    <g class="i-book">
      <rect class="i-light" x="84" y="18" width="14" height="86" rx="5"/>
      <rect class="i-main" x="22" y="12" width="70" height="98" rx="10"/>
      <rect class="i-ink" x="22" y="12" width="15" height="98" rx="7"/>
      <rect class="i-ink" x="46" y="34" width="34" height="7" rx="3.5"/>
      <rect class="i-ink" x="46" y="47" width="22" height="7" rx="3.5"/>
      <circle class="i-ink i-dot i-dot-1" cx="50" cy="82" r="7"/>
      <circle class="i-light i-dot i-dot-2" cx="66" cy="82" r="7"/>
      <circle class="i-ink i-dot i-dot-3" cx="82" cy="82" r="7"/>
      <path class="i-ink i-ribbon" d="M70 8 H82 V40 L76 34 L70 40 Z"/>
    </g>`,
};

export function brandArtSVG(key) {
  const draw = DRAW[key];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}

// The two parts' colours: warm, next to My Brand's own orange.
export const BRAND_PARTS = {
  dna: { color: "#FF8A3D", color2: "#FF4F6E" },
  book: { color: "#FFD23F", color2: "#FF8A2B" },
};
