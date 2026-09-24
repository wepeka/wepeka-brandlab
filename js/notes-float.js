// Floating "Coretan" notes — a sticky-note button beside the chat FAB that
// opens a small notes panel over whatever page is open inside a brand. The
// notes themselves (and "Setor ke chat") are js/scratch-pad.js; this only
// decides where they float and which pad is showing: the brand's, or — while
// a campaign page is open — that campaign's (a toggle switches between them).
// Mounted/unmounted per render by js/layout.js, same as the consultant FAB.
import { getCampaign, onChange } from "./store.js";
import { scratchPadHTML, wireScratchPad, scratchCount } from "./scratch-pad.js";
import { icon } from "./icons.js";
import { escapeHtml as esc, qs } from "./dom.js";
import { t } from "./i18n.js";

const OPEN_KEY = "brandlab:notes-open";
let mounted = null; // { brandId, fab, panel, off, onHash }
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

function setOpen(open) {
  if (!mounted) return;
  mounted.panel.hidden = !open;
  mounted.fab.classList.toggle("is-open", open);
  writeOpen(open);
  paint();
  if (open) qs(".scratch-add", mounted.panel)?.focus();
}

export function mountNotesFloat(brandId) {
  if (mounted?.brandId === brandId) { paint(); return; }
  unmountNotesFloat();
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "notes-fab";
  fab.setAttribute("aria-label", t("scratch.title"));
  fab.title = t("scratch.fabTitle");
  fab.innerHTML = `${icon("edit", { size: 18 })}<span class="notes-fab-count"></span>`;
  const panel = document.createElement("div");
  panel.className = "notes-float";
  panel.hidden = true;
  document.body.append(fab, panel);
  fab.addEventListener("click", () => setOpen(panel.hidden));
  const onHash = () => { scope = "auto"; paint(); };
  window.addEventListener("hashchange", onHash);
  mounted = { brandId, fab, panel, off: onChange(paint), onHash };
  if (readOpen()) setOpen(true);
  else paint();
}

export function unmountNotesFloat() {
  if (!mounted) return;
  mounted.off?.();
  window.removeEventListener("hashchange", mounted.onHash);
  mounted.fab.remove();
  mounted.panel.remove();
  mounted = null;
}
