// The five apps of a brand (owner's ask, 2026-10-26: "kaya aplikasi" —
// a home screen of big icons instead of a page full of widgets). One list
// for everything that names them: the Beranda launcher (js/views/home.js),
// the tab row and the phone's bottom bar (js/layout.js). Order = the order a
// new brand walks through them: identity first, then a goal, then content.
//
// `matches` = which route views light the app's tab up; `tab: false` = a
// launcher card with no tab (the Pitch Deck, 2026-10-29, sits next to Board
// on Beranda; Sales, 2026-10-30 — "jadi apps juga" — under today's step; the
// phone's bar stays at five); `gated` = locked in
// Pemula until the brand identity is done (js/brand-progress.js identityDone);
// `color` = the app's own colour (the colours approved for the Kenalan Fitur
// videos, so a feature looks the same in the videos and here); `color2` = the
// second stop of its card's gradient, a neighbouring hue so the gradient
// reads clearly (owner, 2026-10-27: "gradasinya kurang kelihatan").
export const APPS = [
  { key: "builder", labelKey: "app.brand.name", subKey: "app.brand.sub", icon: "target", color: "#FFA52B", color2: "#FF5F2E", path: (id) => `#/brand/${id}/builder`, tour: "tab-builder", matches: ["builder", "dna", "guidelines"], guide: "brand-builder" },
  { key: "campaigns", labelKey: "app.goals.name", subKey: "app.goals.sub", icon: "flag", color: "#30D97D", color2: "#0FA3A3", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns", matches: ["campaigns", "goals"], gated: true, guide: "campaigns" },
  { key: "content-os", labelKey: "app.create.name", subKey: "app.create.sub", icon: "edit", color: "#3B9BFF", color2: "#4F55F5", path: (id) => `#/brand/${id}/content`, tour: "tab-content-os", matches: ["content-os"], guide: "creator" },
  { key: "report", labelKey: "app.report.name", subKey: "app.report.sub", icon: "chart", color: "#A974FF", color2: "#E04FD8", path: (id) => `#/brand/${id}/report`, tour: "tab-report", matches: ["report"] },
  { key: "papan", labelKey: "app.board.name", subKey: "app.board.sub", icon: "papan", color: "#FF4F9A", color2: "#FF7A45", path: (id) => `#/brand/${id}/papan`, tour: "tab-papan", matches: ["papan"] },
  { key: "sales", labelKey: "app.sales.name", subKey: "app.sales.sub", icon: "wallet", color: "#C8F03C", color2: "#2BC96B", path: (id) => `#/brand/${id}/sales`, matches: ["sales"], tab: false, guide: "sales" },
  { key: "deck", labelKey: "app.deck.name", subKey: "app.deck.sub", icon: "play", color: "#FFD23F", color2: "#FF9F1C", path: (id) => `#/brand/${id}/deck`, matches: ["deck"], tab: false },
];

// How many slides the Pitch Deck has (js/views/deck.js SLIDES), for its
// launcher card — kept here so Beranda doesn't load the deck to count them.
export const DECK_SLIDE_COUNT = 10;

export const appByKey = (key) => APPS.find((a) => a.key === key) || null;
