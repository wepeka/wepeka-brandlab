// The Sales app's pictures, in the launcher's picture style (js/app-icons.js):
// solid vector shapes in the card's own colours — `i-main` = a light tint,
// `i-ink` = a deep shade, both fully opaque (css .lh-card-art / .lh-pic).
// A wallet is the shared shape: on the app card coins hop out of it, on the
// "Pemasukan" card a coin drops in (arrow down), on "Pengeluaran" a coin
// flies out (arrow up) — so money in and money out read at a glance,
// before any word. The moving parts carry i-* classes that css animates.
function wallet() {
  return `
    <rect class="i-main" x="10" y="44" width="100" height="64" rx="16"/>
    <rect class="i-ink" x="10" y="44" width="100" height="15" rx="7.5"/>
    <rect class="i-ink" x="76" y="66" width="38" height="24" rx="12"/>
    <circle class="i-main" cx="90" cy="78" r="5"/>`;
}
const coin = (cls, cx, cy, r) => `
    <g class="${cls}"><circle class="i-main" cx="${cx}" cy="${cy}" r="${r}"/><circle class="i-ink" cx="${cx}" cy="${cy}" r="${(r * 0.46).toFixed(1)}"/></g>`;

const DRAW = {
  // The app's own picture on Beranda.
  app: () => `${coin("i-coin i-coin-1", 44, 26, 17)}${coin("i-coin i-coin-2", 74, 18, 13)}${wallet()}`,
  income: () => `
    <path class="i-ink i-round i-arrow-in" d="M28 4 V26 M18 17 L28 28 L38 17"/>
    ${coin("i-coin i-coin-drop", 64, 22, 17)}${wallet()}`,
  expense: () => `
    <path class="i-ink i-round i-arrow-out" d="M100 30 V6 M90 15 L100 4 L110 15"/>
    ${coin("i-coin i-coin-fly", 60, 24, 17)}${wallet()}`,
};

export function salesArtSVG(kind) {
  const draw = DRAW[kind];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}
