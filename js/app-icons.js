// The apps' pictures on the Beranda launcher (js/apps.js): solid vector
// shapes in the card's own colours — a light tint of the card plus a deep
// shade for details, fully opaque — drawn big so they run off the card's
// edge (owner, 2026-10-26/27: no mascots; "buat vector aja, gausa opacity
// rendah"; then "nge-overlap jadi gak kelihatan full, warnanya nyatu sama
// kartunya", with an animation on hover). Colours and motion live in
// css/styles.css (.lh-card-art): `i-main` = the tint, `i-ink` = the shade,
// the other classes are the parts that move.
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
  return `<g class="i-seal"><g class="i-main">${bumps}<circle cx="60" cy="60" r="42"/></g><polygon class="i-ink i-round i-star" points="${star}"/></g>`;
}

const DRAW = {
  builder: seal,
  campaigns: () => `
    <rect class="i-ink" x="24" y="12" width="12" height="98" rx="6"/>
    <path class="i-main i-round i-flag" d="M36 18 H94 L80 39 L94 60 H36 Z"/>`,
  "content-os": () => `
    <g class="i-pencil"><g transform="rotate(38 60 60)">
      <rect class="i-ink" x="45" y="6" width="30" height="20" rx="9"/>
      <rect class="i-main" x="45" y="22" width="30" height="62"/>
      <path class="i-main i-round-thin" d="M45 84 H75 L60 110 Z"/>
      <path class="i-ink" d="M54 99 H66 L60 110 Z"/>
    </g></g>`,
  report: () => `
    <rect class="i-main i-bar i-bar-1" x="14" y="62" width="24" height="42" rx="8"/>
    <rect class="i-main i-bar i-bar-2" x="48" y="24" width="24" height="80" rx="8"/>
    <rect class="i-main i-bar i-bar-3" x="82" y="44" width="24" height="60" rx="8"/>
    <rect class="i-ink" x="8" y="104" width="104" height="8" rx="4"/>`,
  papan: () => `
    <g class="i-note">
      <path class="i-main i-round" d="M20 20 H100 V76 L76 100 H20 Z"/>
      <path class="i-ink i-fold" d="M106 76 L76 106 V86 Q76 76 86 76 Z"/>
      <rect class="i-ink i-line i-line-1" x="30" y="38" width="52" height="9" rx="4.5"/>
      <rect class="i-ink i-line i-line-2" x="30" y="56" width="34" height="9" rx="4.5"/>
    </g>`,
  deck: () => `
    <rect class="i-ink i-slide-back" x="30" y="14" width="76" height="56" rx="10"/>
    <g class="i-slide-front">
      <rect class="i-main i-round" x="14" y="38" width="86" height="64" rx="12"/>
      <path class="i-ink i-round i-play" d="M49 56 L73 70 L49 84 Z"/>
    </g>`,
};

export function appIconSVG(appKey) {
  const draw = DRAW[appKey];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}
