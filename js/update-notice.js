// "Brandlab sudah diperbarui · Muat ulang" (owner, 2026-11-02).
// A tab keeps running the code it opened with, so after a deploy a tab left
// open on the Mac quietly misses new features (the "Send to editor" button
// stayed hidden in a tab opened before 57f1093). Every production build
// renames js/main-<hash>.js whenever any module changes (esbuild cascades
// chunk hashes into the entry), so this tab compares its own entry script
// with the one the live index.html points at, and offers a reload once they
// differ. Dev (serve.py, plain js/main.js) has no hash, so it stays off.
import { t } from "./i18n.js";
import { icon } from "./icons.js";

const CHECK_EVERY = 5 * 60 * 1000;
const MIN_GAP = 60 * 1000;

// The module entry an index.html loads, e.g. "js/main-76VMJATZ.js".
export function mainScriptOf(html) {
  return String(html || "").match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1] || "";
}
export const isHashedEntry = (src) => /(^|\/)main-[A-Za-z0-9]{6,}\.js$/.test(src || "");

let mine = "";
let lastCheck = 0;
let shown = false;
let timer = 0;

export async function checkForUpdate() {
  if (shown || !mine) return false;
  lastCheck = Date.now();
  try {
    const res = await fetch("/", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return false;
    const live = mainScriptOf(await res.text());
    if (!isHashedEntry(live) || live === mine) return false;
  } catch { return false; } // offline: try again next time
  showBar();
  return true;
}

function showBar() {
  shown = true;
  clearInterval(timer);
  const bar = document.createElement("div");
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `${icon("refresh", { size: 15 })}<span>${t("app.update.title")}</span>
    <button type="button" class="update-bar-go">${t("app.update.reload")}</button>
    <button type="button" class="update-bar-x" aria-label="${t("common.close")}">${icon("x", { size: 14 })}</button>`;
  bar.querySelector(".update-bar-go").addEventListener("click", () => location.reload());
  bar.querySelector(".update-bar-x").addEventListener("click", () => bar.remove());
  document.body.appendChild(bar);
}

export function initUpdateNotice() {
  const src = document.querySelector('script[type="module"][src]')?.getAttribute("src") || "";
  if (!isHashedEntry(src)) return;
  mine = src;
  const soon = () => { if (document.visibilityState === "visible" && Date.now() - lastCheck > MIN_GAP) checkForUpdate(); };
  timer = setInterval(soon, CHECK_EVERY);
  document.addEventListener("visibilitychange", soon);
  window.addEventListener("focus", soon);
}
