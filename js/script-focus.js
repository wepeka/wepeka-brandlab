// "Layar penuh" — writing a script in Creator without squinting at a box.
// The Script field opens full screen: one big, calm page to type on, the
// length worked out live from the narration (js/script-format.js), a button
// that drops in the next beat ([detik] BAGIAN / Visual / Teks layar /
// Narasi), a preview of the beats, the teleprompter, and "Diskusi AI" — the
// same script chat as everywhere (js/consultant-panel.js openScriptChat),
// docked beside the page on a wide screen so the owner reads, asks and
// applies a revision without anything covering the script.
//
// It only edits text; the caller (js/views/creator.js) owns saving:
// `onChange(text)` fires (debounced) while typing and once more on close.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { parseScript, scriptBeatsHTML, scriptLength } from "./script-format.js";

const SAVE_DELAY = 500;

export function openScriptFocus({ title = "", value = "", lang = "id", onChange = () => {}, onClose = () => {}, onDiscuss = null, onTeleprompter = null } = {}) {
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
        <button type="button" class="btn btn-ghost btn-sm" data-focus-beat title="${escapeHtml(t("cr.focus.addBeatTitle"))}">${icon("plus", { size: 14 })}<span>${t("cr.focus.addBeat")}</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-focus-preview aria-pressed="false">${icon("eye", { size: 14 })}<span>${t("cr.focus.preview")}</span></button>
        ${onTeleprompter ? `<button type="button" class="btn btn-ghost btn-sm" data-focus-tp>${icon("teleprompter", { size: 14 })}<span>${t("cr.focus.teleprompter")}</span></button>` : ""}
        ${onDiscuss ? `<button type="button" class="btn btn-secondary btn-sm" data-focus-discuss>${icon("chat", { size: 14 })}<span>${t("cr.focus.discuss")}</span></button>` : ""}
      </div>
    </div>
    <div class="script-focus-body">
      <textarea class="script-focus-text" spellcheck="true" aria-label="${escapeHtml(t("cr.f.script"))}" placeholder="${escapeHtml(t("cr.focus.ph"))}"></textarea>
      <div class="script-focus-preview" hidden></div>
      <p class="script-focus-hint">${t("cr.focus.hint")}</p>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add("script-focus-open");

  const ta = el.querySelector(".script-focus-text");
  const preview = el.querySelector(".script-focus-preview");
  const lenEl = el.querySelector("[data-focus-len]");
  const previewBtn = el.querySelector("[data-focus-preview]");
  ta.value = value || "";

  const paintLength = () => {
    const { words, seconds } = scriptLength(ta.value);
    lenEl.textContent = words ? t("cr.ai.lengthBadge", { s: seconds, w: words }) : "";
  };
  paintLength();

  let timer = 0;
  const flush = () => { clearTimeout(timer); timer = 0; onChange(ta.value); };
  ta.addEventListener("input", () => {
    paintLength();
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  });

  const setPreview = (on) => {
    preview.hidden = !on;
    ta.hidden = on;
    previewBtn.setAttribute("aria-pressed", String(on));
    previewBtn.querySelector("span").textContent = on ? t("cr.focus.edit") : t("cr.focus.preview");
    if (on) preview.innerHTML = scriptBeatsHTML(ta.value, escapeHtml) || `<p class="script-focus-plain">${escapeHtml(ta.value || t("cr.noScript")).replace(/\n/g, "<br>")}</p>`;
    else ta.focus();
  };
  previewBtn.addEventListener("click", () => setPreview(preview.hidden));

  // The next beat, timed after the last one, caret on its Visual line.
  el.querySelector("[data-focus-beat]").addEventListener("click", () => {
    if (!preview.hidden) setPreview(false);
    const beats = parseScript(ta.value)?.beats || [];
    const end = Number(String(beats[beats.length - 1]?.time || "").split("-")[1]) || 0;
    const block = t(lang === "en" ? "cr.focus.beatTemplateEn" : "cr.focus.beatTemplate", { from: end, to: end + 5 });
    const before = ta.value.replace(/\s+$/, "");
    ta.value = `${before}${before ? "\n\n" : ""}${block}`;
    const caret = ta.value.length - block.length + block.indexOf(":") + 2;
    ta.focus();
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input"));
  });

  el.querySelector("[data-focus-tp]")?.addEventListener("click", () => { flush(); onTeleprompter(ta.value); });
  el.querySelector("[data-focus-discuss]")?.addEventListener("click", () => { flush(); onDiscuss(); });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    flush();
    el.remove();
    document.body.classList.remove("script-focus-open", "script-focus-docked");
    onClose(ta.value);
  };
  el.querySelector("[data-focus-done]").addEventListener("click", close);
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (!preview.hidden) setPreview(false);
    else close();
  });
  setTimeout(() => ta.focus(), 30);

  return {
    el,
    get value() { return ta.value; },
    // A revision applied from the docked chat lands here too.
    setValue(text) {
      ta.value = text || "";
      paintLength();
      if (!preview.hidden) setPreview(true);
    },
    close,
  };
}
