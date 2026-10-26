// Pictures for the four kinds of goal in My Goals (Pemula): Sosmed Growth,
// Community, Sales and Event. Same language as the Beranda app pictures
// (js/app-icons.js) and Create's (js/create-art.js): solid vector shapes in
// the card's own colours — `i-main` a light tint of the card, `i-ink` a deep
// shade — no faces, no mascots (owner, 2026-10-27), drawn big so the card
// crops them. Colours and the move each one makes on hover live in
// css/campaign.css (.gl-pic, the GOALS FOR PEMULA block).
const DRAW = {
  // Sosmed Growth: a phone whose chart climbs, a heart popping up.
  social: () => `
    <rect class="i-ink" x="22" y="10" width="58" height="104" rx="14"/>
    <rect class="i-main" x="29" y="21" width="44" height="82" rx="8"/>
    <g class="i-ink">
      <rect class="a-bar a-bar-1" x="36" y="74" width="8" height="20" rx="3"/>
      <rect class="a-bar a-bar-2" x="48" y="62" width="8" height="32" rx="3"/>
      <rect class="a-bar a-bar-3" x="60" y="48" width="8" height="46" rx="3"/>
    </g>
    <g class="a-heart">
      <path class="i-main" d="M80 8 H106 Q116 8 116 18 V38 Q116 48 106 48 H98 L88 58 L89 48 H80 Q70 48 70 38 V18 Q70 8 80 8 Z"/>
      <path class="i-ink" d="M93 40 C80 32 81 20 88 20 C90.4 20 92 21.6 93 23.6 C94 21.6 95.6 20 98 20 C105 20 106 32 93 40 Z"/>
    </g>`,
  // Community: a group chat — a message, and a reply being typed.
  community: () => `
    <path class="i-main" d="M28 12 H74 Q92 12 92 30 V52 Q92 70 74 70 H46 L26 88 L30 69 Q10 66 10 50 V30 Q10 12 28 12 Z"/>
    <g class="i-ink"><rect x="24" y="30" width="50" height="9" rx="4.5"/><rect x="24" y="46" width="32" height="9" rx="4.5"/></g>
    <g class="a-reply">
      <path class="i-ink" d="M58 58 H96 Q114 58 114 76 V88 Q114 106 96 106 H94 L104 118 L80 106 H58 Q40 106 40 88 V76 Q40 58 58 58 Z"/>
      <g class="i-main"><circle class="a-dot a-dot-1" cx="61" cy="82" r="6"/><circle class="a-dot a-dot-2" cx="77" cy="82" r="6"/><circle class="a-dot a-dot-3" cx="93" cy="82" r="6"/></g>
    </g>`,
  // Sales: a shopping bag, a coin dropping in.
  sales: () => `
    <path class="i-ink" d="M36 46 V34 Q36 8 60 8 Q84 8 84 34 V46 H75 V34 Q75 17 60 17 Q45 17 45 34 V46 Z"/>
    <path class="i-main" d="M16 42 H104 L97 108 Q96 116 88 116 H32 Q24 116 23 108 Z"/>
    <rect class="i-ink" x="20" y="58" width="80" height="10"/>
    <g class="a-coin">
      <circle class="i-ink" cx="88" cy="88" r="20"/>
      <circle class="i-main" cx="88" cy="88" r="12"/>
      <rect class="i-ink" x="85" y="80" width="6" height="16" rx="3"/>
    </g>`,
  // Event: a ticket with a star, a second one behind it.
  event: () => `
    <g class="a-back"><path class="i-ink" d="M18 22 H104 V36 Q94 36 94 46 Q94 56 104 56 V70 H18 V56 Q28 56 28 46 Q28 36 18 36 Z" transform="rotate(12 61 46)"/></g>
    <g class="a-ticket" transform="rotate(-10 60 70)">
      <path class="i-main" d="M10 42 H110 V58 Q99 58 99 70 Q99 82 110 82 V98 H10 V82 Q21 82 21 70 Q21 58 10 58 Z"/>
      <g class="i-ink"><rect x="80" y="46" width="4" height="9" rx="2"/><rect x="80" y="61" width="4" height="9" rx="2"/><rect x="80" y="76" width="4" height="9" rx="2"/></g>
      <path class="i-ink a-star" d="M48 52 L53.3 63.2 L65.6 64.7 L56.6 73.2 L58.9 85.4 L48 79.4 L37.1 85.4 L39.4 73.2 L30.4 64.7 L42.7 63.2 Z"/>
    </g>`,
};

export function goalArtSVG(kind) {
  const draw = DRAW[kind];
  return draw ? `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${draw()}</svg>` : "";
}

// The four kinds, their two-hue gradient (owner, 2026-10-27: "biar jelas ada
// sosmed growth, community, dan sales, lalu event"). One list for the
// landing cards, the "Tujuan baru" picker and a goal's own page.
export const GOAL_KINDS = [
  { key: "social", color: "#4EA3FF", color2: "#5B5BF0" },
  { key: "community", color: "#C58BFF", color2: "#FF6FB5" },
  { key: "sales", color: "#3DDC84", color2: "#0FA3A3" },
  { key: "event", color: "#FFB13D", color2: "#FF6A3D" },
];
export const goalKindByKey = (key) => GOAL_KINDS.find((k) => k.key === key) || null;
