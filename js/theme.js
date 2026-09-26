// Two-state theme (dark/light), persisted per-device. Dark stays the
// default on first visit — it's the product's actual brand identity
// (wepeka.com's warm near-black), not a neutral default to auto-flip based
// on OS preference.
const KEY = "wepeka-theme";

export function getTheme() {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme = getTheme()) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

// Switching repaints everything at once: elements carry different
// background/colour transition speeds, so animating them left a moment of
// dark text on a still-dark card (unreadable) mid-switch. Transitions are
// off for the switch itself, back on two frames later.
export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme(theme);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
