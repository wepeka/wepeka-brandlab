// Floating "Coretan" notes — a sticky-note button beside the chat FAB that
// opens a small notes panel over whatever page is open inside a brand. The
// same button holds "Cari ide" (js/idea-search.js): a tap shows a little
// menu with both, and while either panel is open the button closes it. The
// notes themselves (and "Setor ke chat") are js/scratch-pad.js; this only
// decides where they float and which pad is showing: the brand's, or — while
// a campaign page is open — that campaign's (a toggle switches between them).
// Mounted/unmounted per render by js/layout.js, same as the consultant FAB.
import { getCampaign, onChange } from "./store.js";
import { scratchPadHTML, wireScratchPad, scratchCount } from "./scratch-pad.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, qs } from "./dom.js";
import { t } from "./i18n.js";
import { faceHTML, wireFace } from "./fab-face.js";
import { openIdeaSearch, closeIdeaSearch, isIdeaSearchOpen, TOOLS_EVENT } from "./idea-search.js";

const OPEN_KEY = "brandlab:notes-open";
let mounted = null; // { brandId, fab, menu, panel, off, onHash, onTools, onDoc }
let scope = "auto"; // "auto" = campaign if on a campaign page, else brand; or "brand"

const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const writeOpen = (v) => { try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* private mode */ } };

function campaignOnPage(brandId) {
  const m = location.hash.match(/^#\/brand\/([^/]+)\/campaigns\/([^/?]+)/);
  return m && m[1] === brandId ? getCampaign(m[2]) : null;
}

function paint() {
  if (!mounted) return;
  const { brandId, fab, panel } = mounted;
  const camp = campaignOnPage(brandId);
  const campaignId = camp && scope === "auto" ? camp.id : null;
  const n = scratchCount(brandId, campaignId);
  fab.querySelector(".notes-fab-count").textContent = n ? String(n) : "";
  const menuCount = mounted.menu.querySelector(".tools-menu-count");
  if (menuCount) menuCount.textContent = n ? String(n) : "";
  if (panel.hidden) return;
  // A repaint mid-edit would throw away what's being typed in a note.
  if (panel.contains(document.activeElement) && document.activeElement.classList.contains("scratch-editbox")) return;
  const typing = panel.contains(document.activeElement) && document.activeElement.classList.contains("scratch-add");
  panel.innerHTML = `
    <div class="notes-head">
      <span class="notes-title">${icon("edit", { size: 14 })}${t("scratch.title")}</span>
      <button type="button" class="icon-btn notes-close" aria-label="${t("common.close")}" title="${t("common.close")}">${icon("x", { size: 14 })}</button>
    </div>
    ${
      camp
        ? `<div class="notes-scope">
            <button type="button" class="${campaignId ? "is-active" : ""}" data-notes-scope="auto">${esc(camp.name || t("nav.campaigns"))}</button>
            <button type="button" class="${campaignId ? "" : "is-active"}" data-notes-scope="brand">${t("scratch.scopeBrand")}</button>
          </div>`
        : ""
    }
    <div class="notes-body">${scratchPadHTML({ brandId, campaignId })}</div>`;
  panel.querySelector(".notes-close").addEventListener("click", () => setOpen(false));
  panel.querySelectorAll("[data-notes-scope]").forEach((b) => b.addEventListener("click", () => { scope = b.dataset.notesScope; paint(); }));
  wireScratchPad(panel, { brandId, campaignId, fromLabel: t("scratch.title"), onSent: () => setOpen(false) });
  if (typing) {
    const add = qs(".scratch-add", panel);
    add?.focus();
    add?.setSelectionRange(add.value.length, add.value.length);
  }
}

// The button shows ✕ while a panel (notes or Cari ide) is open.
function syncFab() {
  if (!mounted) return;
  const open = !mounted.panel.hidden || isIdeaSearchOpen();
  mounted.fab.classList.toggle("is-open", open);
}

function setMenu(open) {
  if (!mounted) return;
  mounted.menu.hidden = !open;
  mounted.fab.setAttribute("aria-expanded", String(open));
  if (open) mounted.menu.querySelector("button")?.focus();
}

function setOpen(open) {
  if (!mounted) return;
  if (open) window.dispatchEvent(new CustomEvent(TOOLS_EVENT, { detail: { tool: "notes", open: true } }));
  mounted.panel.hidden = !open;
  writeOpen(open);
  syncFab();
  paint();
  if (open) qs(".scratch-add", mounted.panel)?.focus();
}

export function mountNotesFloat(brandId) {
  if (mounted?.brandId === brandId) { paint(); return; }
  unmountNotesFloat();
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "notes-fab";
  fab.setAttribute("aria-label", t("tools.fab"));
  fab.setAttribute("aria-haspopup", "menu");
  fab.setAttribute("aria-expanded", "false");
  fab.title = t("tools.fab");
  // A sticky note with a face and a magnifier (js/fab-face.js); ✕ while a
  // panel is open.
  fab.innerHTML = `${faceHTML()}<span class="notes-fab-lens" aria-hidden="true">${icon("search", { size: 10 })}</span><span class="fab-x" aria-hidden="true">${icon("x", { size: 16 })}</span><span class="notes-fab-count"></span>`;
  const menu = document.createElement("div");
  menu.className = "tools-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-tool="notes" title="${esc(t("scratch.fabTitle"))}">
      <span class="tools-menu-ic is-notes">${icon("edit", { size: 16 })}</span>
      <span class="tools-menu-text"><b>${t("scratch.title")}</b><small>${t("tools.notesSub")}</small></span>
      <span class="tools-menu-count"></span>
    </button>
    <button type="button" role="menuitem" data-tool="search" title="${esc(t("isr.fabTitle"))}">
      <span class="tools-menu-ic is-search">${icon("search", { size: 16 })}</span>
      <span class="tools-menu-text"><b>${t("isr.title")}</b><small>${t("tools.searchSub")}</small></span>
    </button>`;
  const panel = document.createElement("div");
  panel.className = "notes-float";
  panel.hidden = true;
  document.body.append(fab, menu, panel);
  wireFace(fab);
  fab.addEventListener("click", () => {
    // A panel is open: the button (now ✕) closes it.
    if (!panel.hidden || isIdeaSearchOpen()) { setMenu(false); setOpen(false); closeIdeaSearch(); return; }
    setMenu(menu.hidden);
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (!b) return;
    setMenu(false);
    if (b.dataset.tool === "notes") setOpen(true);
    else openIdeaSearch();
  });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { setMenu(false); fab.focus(); } });
  const onDoc = (e) => { if (!menu.hidden && !menu.contains(e.target) && !fab.contains(e.target)) setMenu(false); };
  document.addEventListener("pointerdown", onDoc);
  // Cari ide opened or closed (from here, Creator, or the notes panel
  // opening): close the notes when it opens, and keep the ✕ right.
  const onTools = (e) => {
    if (e.detail?.tool === "search" && e.detail.open && !panel.hidden) { panel.hidden = true; writeOpen(false); }
    syncFab();
  };
  window.addEventListener(TOOLS_EVENT, onTools);
  const onHash = () => { scope = "auto"; paint(); };
  window.addEventListener("hashchange", onHash);
  mounted = { brandId, fab, menu, panel, off: onChange(paint), onHash, onTools, onDoc };
  if (readOpen()) setOpen(true);
  else paint();
}

export function unmountNotesFloat() {
  if (!mounted) return;
  mounted.off?.();
  window.removeEventListener("hashchange", mounted.onHash);
  window.removeEventListener(TOOLS_EVENT, mounted.onTools);
  document.removeEventListener("pointerdown", mounted.onDoc);
  mounted.menu.remove();
  mounted.fab.remove();
  mounted.panel.remove();
  mounted = null;
}
