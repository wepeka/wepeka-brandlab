// The five apps of a brand (owner's ask, 2026-10-26: "kaya aplikasi" —
// a home screen of big icons instead of a page full of widgets). One list
// for everything that names them: the Beranda launcher (js/views/home.js),
// the tab row and the phone's bottom bar (js/layout.js). Order = the order a
// new brand walks through them: identity first, then a goal, then content.
//
// `matches` = which route views light the app's tab up; `gated` = locked in
// Pemula until the brand identity is done (js/brand-progress.js identityDone);
// `color` = the app's own colour on its icon (the colours approved for the
// Kenalan Fitur videos, so a feature looks the same in the videos and here).
export const APPS = [
  { key: "builder", labelKey: "app.brand.name", subKey: "app.brand.sub", icon: "target", color: "#FFA52B", path: (id) => `#/brand/${id}/builder`, tour: "tab-builder", matches: ["builder", "dna", "guidelines"], guide: "brand-builder" },
  { key: "campaigns", labelKey: "app.goals.name", subKey: "app.goals.sub", icon: "flag", color: "#30D97D", path: (id) => `#/brand/${id}/campaigns`, tour: "tab-campaigns", matches: ["campaigns", "goals", "sales"], gated: true, guide: "campaigns" },
  { key: "content-os", labelKey: "app.create.name", subKey: "app.create.sub", icon: "edit", color: "#3B9BFF", path: (id) => `#/brand/${id}/content`, tour: "tab-content-os", matches: ["content-os"], guide: "creator" },
  { key: "report", labelKey: "app.report.name", subKey: "app.report.sub", icon: "chart", color: "#A974FF", path: (id) => `#/brand/${id}/report`, tour: "tab-report", matches: ["report"] },
  { key: "papan", labelKey: "app.board.name", subKey: "app.board.sub", icon: "papan", color: "#FF4F9A", path: (id) => `#/brand/${id}/papan`, tour: "tab-papan", matches: ["papan"] },
];

export const appByKey = (key) => APPS.find((a) => a.key === key) || null;
