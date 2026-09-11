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

export function setTheme(theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
