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
  // The platform cards on Daftar Konten → Terbit (js/views/content-list.js).
  instagram: () => `
    <g class="i-ig">
      <rect class="i-main" x="14" y="14" width="92" height="92" rx="28"/>
      <path class="i-ink i-ig-lens" fill-rule="evenodd" d="M60 34a26 26 0 1 1 0 52a26 26 0 1 1 0-52zm0 12a14 14 0 1 0 0 28a14 14 0 1 0 0-28z"/>
      <circle class="i-ink i-ig-flash" cx="86" cy="34" r="7"/>
    </g>`,
  tiktok: () => {
    const note = "M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";
    return `<g class="i-tt"><g transform="translate(12 12) scale(4)">
      <path class="i-main i-tt-echo" d="${note}"/>
      <path class="i-ink" d="${note}"/>
    </g></g>`;
  },
  facebook: () => `
    <g class="i-fb">
      <circle class="i-main" cx="60" cy="60" r="48"/>
      <path class="i-ink i-fb-f" d="M65 108V68h13l2-15H65v-9c0-4.4 1.6-7.4 7.8-7.4H81V23.2c-1.4-.2-6.2-.6-11.8-.6C57.6 22.6 50 29.6 50 42.6V53H37v15h13v40z"/>
    </g>`,
  youtube: () => `
    <g class="i-yt">
      <rect class="i-main" x="8" y="26" width="104" height="72" rx="24"/>
      <path class="i-ink i-round i-play" d="M50 46 L78 62 L50 78 Z"/>
    </g>`,
  "other-platforms": () => `
    <rect class="i-ink i-slide-back" x="34" y="14" width="72" height="72" rx="20"/>
    <rect class="i-main i-slide-front" x="14" y="34" width="72" height="72" rx="20"/>`,
};

export function appIconSVG(appKey) {
  const draw = DRAW[appKey];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}
