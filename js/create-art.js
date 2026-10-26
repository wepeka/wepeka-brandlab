// Pictures inside Create (Pemula): one per part of Create (the landing's
// cards, js/views/content-os.js) and one per kind of piece (the new-content
// cards, js/views/new-content-wizard.js). Same language as the Beranda app
// pictures (js/app-icons.js): solid vector shapes in the card's own colours —
// `i-main` a light tint of the card, `i-ink` a deep shade — no faces, no
// mascots (owner, 2026-10-27), drawn big so the card crops them. Colours and
// the move each one makes on hover live in css/styles.css (.cl-art, .nw-art).
const DRAW = {
  // Creator: a clapperboard — the take starts.
  creator: () => `
    <rect class="i-main" x="12" y="50" width="96" height="60" rx="12"/>
    <path class="i-ink" d="M44 66 L44 96 L72 81 Z"/>
    <g class="a-clap">
      <rect class="i-ink" x="12" y="30" width="96" height="18" rx="6"/>
      <path class="i-main" d="M26 30 H40 L32 48 H18 Z M54 30 H68 L60 48 H46 Z M82 30 H96 L88 48 H74 Z"/>
    </g>`,
  // Kalender: a calendar page, rings on top, one day picked.
  calendar: () => `
    <rect class="i-main" x="14" y="22" width="92" height="88" rx="14"/>
    <path class="i-ink" d="M14 36 Q14 22 28 22 H92 Q106 22 106 36 V46 H14 Z"/>
    <rect class="i-main" x="34" y="10" width="11" height="24" rx="5.5"/>
    <rect class="i-main" x="75" y="10" width="11" height="24" rx="5.5"/>
    <g class="i-ink">
      <rect x="26" y="58" width="16" height="14" rx="4"/><rect x="52" y="58" width="16" height="14" rx="4"/>
      <rect x="26" y="82" width="16" height="14" rx="4"/><rect x="52" y="82" width="16" height="14" rx="4"/>
    </g>
    <g class="a-day"><circle class="i-ink" cx="86" cy="80" r="15"/><path class="i-main" d="M79 80 L84 85 L93 75 L96 78 L84 90 L76 83 Z"/></g>`,
  // Daftar Konten: a clipboard with a ticked list.
  list: () => `
    <rect class="i-main" x="18" y="16" width="84" height="96" rx="14"/>
    <rect class="i-ink" x="42" y="8" width="36" height="18" rx="8"/>
    <g class="i-ink">
      <rect x="30" y="40" width="14" height="14" rx="4"/><rect class="a-line a-line-1" x="52" y="43" width="38" height="8" rx="4"/>
      <rect x="30" y="62" width="14" height="14" rx="4"/><rect class="a-line a-line-2" x="52" y="65" width="30" height="8" rx="4"/>
      <rect x="30" y="84" width="14" height="14" rx="4"/><rect class="a-line a-line-3" x="52" y="87" width="34" height="8" rx="4"/>
    </g>`,
  // Tulisan Cepat: a speech bubble with a lightning bolt — copy, fast.
  copy: () => `
    <path class="i-main" d="M30 14 H90 Q110 14 110 34 V70 Q110 90 90 90 H52 L28 110 L32 88 Q10 84 10 66 V34 Q10 14 30 14 Z"/>
    <path class="i-ink a-bolt" d="M66 24 L42 58 H58 L50 82 L80 44 H63 L72 24 Z"/>`,
  // Seri: episodes stacked one after another.
  series: () => `
    <g class="a-back"><rect class="i-ink" x="30" y="12" width="64" height="44" rx="10"/></g>
    <g class="a-mid"><rect class="i-ink" x="22" y="28" width="76" height="52" rx="11" opacity=".72"/></g>
    <rect class="i-main" x="12" y="46" width="96" height="64" rx="13"/>
    <path class="i-ink" d="M50 64 L50 92 L74 78 Z"/>`,

  // ---- Kinds of piece (the new-content cards) ----
  video: () => `
    <rect class="i-ink" x="34" y="6" width="52" height="108" rx="13"/>
    <rect class="i-main" x="40" y="16" width="40" height="88" rx="7"/>
    <path class="i-ink a-play" d="M53 46 L53 74 L74 60 Z"/>`,
  carousel: () => `
    <g class="a-fan-1"><rect class="i-ink" x="18" y="22" width="60" height="78" rx="10" transform="rotate(-12 48 61)"/></g>
    <g class="a-fan-2"><rect class="i-ink" x="30" y="18" width="60" height="78" rx="10" opacity=".7" transform="rotate(-3 60 57)"/></g>
    <rect class="i-main" x="44" y="16" width="60" height="78" rx="10" transform="rotate(7 74 55)"/>
    <g class="i-ink"><circle cx="52" cy="108" r="4"/><circle cx="64" cy="108" r="4" opacity=".5"/><circle cx="76" cy="108" r="4" opacity=".5"/></g>`,
  photo: () => `
    <rect class="i-main" x="10" y="16" width="100" height="88" rx="12"/>
    <circle class="i-ink a-sun" cx="82" cy="40" r="11"/>
    <path class="i-ink" d="M10 92 L42 56 L62 78 L76 64 L110 96 V92 Q110 104 98 104 H22 Q10 104 10 92 Z"/>`,
  story: () => `
    <circle class="i-ink a-ring" cx="58" cy="58" r="48"/>
    <circle class="i-main" cx="58" cy="58" r="37"/>
    <circle class="i-ink" cx="58" cy="50" r="12"/>
    <path class="i-ink" d="M34 80 Q58 58 82 80 Q72 92 58 92 Q44 92 34 80 Z"/>
    <circle class="i-ink" cx="96" cy="96" r="16"/>
    <path class="i-main" d="M93 86 H99 V93 H106 V99 H99 V106 H93 V99 H86 V93 H93 Z"/>`,
  long: () => `
    <rect class="i-ink" x="52" y="92" width="16" height="16"/>
    <rect class="i-ink" x="34" y="104" width="52" height="10" rx="5"/>
    <rect class="i-main" x="6" y="18" width="108" height="76" rx="14"/>
    <rect class="i-ink" x="16" y="28" width="88" height="56" rx="8"/>
    <path class="i-main a-play" d="M52 42 L52 70 L74 56 Z"/>`,
};

export function createArtSVG(key) {
  const draw = DRAW[key];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}
