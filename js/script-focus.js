// "Layar penuh" — writing a script in Creator without squinting at a box.
// The Script field opens full screen: one big, calm page to write on, the
// length worked out live from the narration (js/script-format.js), the
// teleprompter, and "Diskusi AI" — the same script chat as everywhere
// (js/consultant-panel.js openScriptChat), docked beside the page on a wide
// screen so the owner reads, asks and applies a revision without anything
// covering the script.
//
// It is the same editor as in Creator, just bigger: "Biasa" is one plain
// page that shows only the words (plainScript / applyPlainScript keep the
// parts, Visual and Teks layar of the stored text), "Pro" the cards
// (js/script-cards.js).
//
// It only edits text; the caller (js/views/creator.js) owns saving:
// `onChange(text)` fires (debounced) while typing and once more on close.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { scriptLength, plainScript, applyPlainScript } from "./script-format.js";
import { mountScriptCards } from "./script-cards.js";

const SAVE_DELAY = 500;

export function openScriptFocus({ title = "", value = "", lang = "id", mode = "plain", onChange = () => {}, onClose = () => {}, onDiscuss = null, onTeleprompter = null } = {}) {
  const cards = mode === "cards";
  const el = document.createElement("div");
  el.className = "script-focus";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", t("cr.focus.aria"));
  el.innerHTML = `
    <div class="script-focus-head">
      <button type="button" class="btn btn-primary btn-sm" data-focus-done>${icon("check", { size: 14 })}<span>${t("cr.focus.done")}</span></button>
      <div class="script-focus-title">
        <strong>${escapeHtml(title || t("common.untitled"))}</strong>
        <span class="script-focus-len" data-focus-len></span>
      </div>
      <div class="script-focus-actions">
        ${onTeleprompter ? `<button type="button" class="btn btn-ghost btn-sm" data-focus-tp>${icon("teleprompter", { size: 14 })}<span>${t("cr.focus.teleprompter")}</span></button>` : ""}
        ${onDiscuss ? `<button type="button" class="btn btn-secondary btn-sm" data-focus-discuss>${icon("chat", { size: 14 })}<span>${t("cr.focus.discuss")}</span></button>` : ""}
      </div>
    </div>
    <div class="script-focus-body">
      ${cards
        ? `<div class="script-focus-cards"></div>
      <p class="script-focus-hint">${t("cr.focus.cardsHint")}</p>`
        : `<textarea class="script-focus-text" spellcheck="true" aria-label="${escapeHtml(t("cr.f.script"))}" placeholder="${escapeHtml(t("cr.f.scriptPh"))}"></textarea>
      <p class="script-focus-hint">${t("cr.focus.hint")}<span data-focus-more hidden> ${t("cr.plain.more")}</span></p>`}
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add("script-focus-open");

  const lenEl = el.querySelector("[data-focus-len]");
  let current = String(value || "").replace(/\r\n?/g, "\n");

  // The cards show their own length on top.
  const paintLength = () => {
    if (cards) return;
    const { words, seconds } = scriptLength(current);
    lenEl.textContent = words ? t("cr.ai.lengthBadge", { s: seconds, w: words }) : "";
  };

  let timer = 0;
  const flush = () => { clearTimeout(timer); timer = 0; onChange(current); };
  const changed = () => {
    paintLength();
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  };

  // What both kinds of page answer to: focus(), setValue(text) and destroy().
  const cardsPage = () => {
    const box = mountScriptCards(el.querySelector(".script-focus-cards"), {
      value: current,
      lang,
      large: true,
      onInput: (text) => { current = text; changed(); },
    });
    return {
      focus: () => box.focus(),
      setValue: (text) => { current = text; box.setValue(text); changed(); },
      destroy: () => box.destroy(),
    };
  };

  const plainPage = () => {
    const box = el.querySelector(".script-focus-text");
    const more = el.querySelector("[data-focus-more]");
    // The script the page was filled from: what is typed is written back
    // into it, so undoing an edit also brings back that part's directions.
    let base = current;
    const fill = () => {
      const shown = plainScript(base);
      box.value = shown.text;
      more.hidden = !shown.directed;
    };
    fill();
    box.addEventListener("input", () => {
      current = applyPlainScript(base, box.value, { lang });
      changed();
    });
    return {
      focus: () => box.focus({ preventScroll: true }),
      // A revision applied from the docked chat lands here too.
      setValue: (text) => { base = current = text; fill(); changed(); },
      destroy: () => {},
    };
  };

  const editor = cards ? cardsPage() : plainPage();
  paintLength();

  el.querySelector("[data-focus-tp]")?.addEventListener("click", () => { flush(); onTeleprompter(current); });
  el.querySelector("[data-focus-discuss]")?.addEventListener("click", () => { flush(); onDiscuss(); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    flush();
    editor.destroy();
    el.remove();
    document.body.classList.remove("script-focus-open", "script-focus-docked");
    onClose(current);
  };
  el.querySelector("[data-focus-done]").addEventListener("click", close);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  });
  setTimeout(() => editor.focus(), 30);

  return {
    el,
    get value() { return current; },
    setValue(text) {
      editor.setValue(String(text || "").replace(/\r\n?/g, "\n"));
    },
    close,
  };
}
