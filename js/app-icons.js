// The five apps' own pictures (js/apps.js) on the Beranda launcher: solid
// vector shapes, white with a few dark details, fully opaque (owner,
// 2026-10-26: "icon yang ada di kartunya buat vector aja, gausa pake warna
// opacity rendah" — and earlier: no mascots, and solid silhouettes over
// thin outlines). Drawn in a 120×120 box; the card sets the size.
const INK = "#1b1a17";
const W = "#ffffff";

function seal() {
  // A scalloped badge: twelve bumps round a disc, a star in the middle.
  const bumps = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `<circle cx="${(60 + Math.cos(a) * 40).toFixed(1)}" cy="${(60 + Math.sin(a) * 40).toFixed(1)}" r="13"/>`;
  }).join("");
  const star = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 9 : 21;
    return `${(60 + Math.cos(a) * r).toFixed(1)},${(60 + Math.sin(a) * r).toFixed(1)}`;
  }).join(" ");
  return `<g fill="${W}">${bumps}<circle cx="60" cy="60" r="42"/></g><polygon points="${star}" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`;
}

const DRAW = {
  builder: seal,
  campaigns: () => `
    <rect x="24" y="12" width="12" height="98" rx="6" fill="${INK}"/>
    <path d="M36 18 H94 L80 39 L94 60 H36 Z" fill="${W}" stroke="${W}" stroke-width="10" stroke-linejoin="round"/>`,
  "content-os": () => `
    <g transform="rotate(38 60 60)">
      <rect x="45" y="6" width="30" height="20" rx="9" fill="${INK}"/>
      <rect x="45" y="22" width="30" height="62" fill="${W}"/>
      <path d="M45 84 H75 L60 110 Z" fill="${W}" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M54 99 H66 L60 110 Z" fill="${INK}"/>
    </g>`,
  report: () => `
    <rect x="14" y="62" width="24" height="42" rx="8" fill="${W}"/>
    <rect x="48" y="24" width="24" height="80" rx="8" fill="${W}"/>
    <rect x="82" y="44" width="24" height="60" rx="8" fill="${W}"/>
    <rect x="8" y="104" width="104" height="8" rx="4" fill="${INK}"/>`,
  papan: () => `
    <path d="M20 20 H100 V76 L76 100 H20 Z" fill="${W}" stroke="${W}" stroke-width="12" stroke-linejoin="round"/>
    <path d="M106 76 L76 106 V86 Q76 76 86 76 Z" fill="${INK}"/>
    <rect x="30" y="38" width="52" height="9" rx="4.5" fill="${INK}"/>
    <rect x="30" y="56" width="34" height="9" rx="4.5" fill="${INK}"/>`,
};

export function appIconSVG(appKey) {
  const draw = DRAW[appKey];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}
