// "Layar penuh" — writing a script in Creator without squinting at a box.
// The Script field opens full screen: one big, calm page to type on, the
// length worked out live from the narration (js/script-format.js), a button
// that drops in the next beat ([detik] BAGIAN / Visual / Teks layar /
// Narasi), a preview of the beats, the teleprompter, and "Diskusi AI" — the
// same script chat as everywhere (js/consultant-panel.js openScriptChat),
// docked beside the page on a wide screen so the owner reads, asks and
// applies a revision without anything covering the script.
//
// The page reads like a script, not like a text box: each line is styled by
// what it is — a beat header as a small caption, Visual / Teks layar small
// and quiet, and the Narasi (what gets said) in a speech bubble — while the
// text underneath stays the one plain string every other screen reads.
//
// With "Kartu" chosen (js/script-cards.js) the page holds the same cards as
// Creator, just bigger — one editor at two sizes, not a second one.
//
// It only edits text; the caller (js/views/creator.js) owns saving:
// `onChange(text)` fires (debounced) while typing and once more on close.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { t } from "./i18n.js";
import { parseScript, scriptBeatsHTML, scriptLength, scriptLineKind } from "./script-format.js";
import { mountScriptCards } from "./script-cards.js";

const SAVE_DELAY = 500;
// Typing within this many ms of the last keystroke is one undo step.
const TYPING_GAP = 1000;
const UNDO_MAX = 200;

// ---- One <div> per line --------------------------------------------------
// A line's label ("Narasi: ") sits in <span class="sf-k"> so it can be
// smaller than the words after it. The browser types into this page as
// usual; after each edit the lines are read back as text and any line the
// browser left in another shape (Enter splitting a label, a merge wrapping
// text in a styled span) is redrawn.

const KIND_CLASS = { head: "sf-head", visual: "sf-visual", onScreen: "sf-screen", say: "sf-say", blank: "sf-blank", note: "sf-note" };

// An unlabelled line right under a labelled one belongs to it (parseScript
// reads it the same way); a blank line or a header ends that.
function classify(lines) {
  let field = "";
  return lines.map((line) => {
    const { kind, labelLength } = scriptLineKind(line);
    if (kind === "head") { field = ""; return { kind, labelLength: 0 }; }
    if (kind) { field = kind; return { kind, labelLength }; }
    if (!line.trim()) { field = ""; return { kind: "blank", labelLength: 0 }; }
    return { kind: field || "note", labelLength: 0 };
  });
}

// A Narasi and the lines that continue it share one bubble.
function lineClass(infos, lines, i) {
  const { kind, labelLength } = infos[i];
  const cls = ["sf-line", KIND_CLASS[kind]];
  if (kind === "say") {
    if (labelLength || infos[i - 1]?.kind !== "say") cls.push("sf-first");
    if (infos[i + 1]?.kind !== "say" || infos[i + 1].labelLength) cls.push("sf-last");
    if (labelLength && labelLength === lines[i].length) cls.push("is-blank");
  }
  return cls.join(" ");
}

function fillLine(div, text, labelLength) {
  div.textContent = "";
  if (!text) { div.appendChild(document.createElement("br")); return; }
  if (labelLength) {
    const k = document.createElement("span");
    k.className = "sf-k";
    k.textContent = text.slice(0, labelLength);
    div.appendChild(k);
  }
  const rest = text.slice(labelLength);
  if (rest) div.appendChild(document.createTextNode(rest));
}

// Is this <div> exactly what fillLine would draw for `text`?
function isDrawn(div, text, labelLength) {
  const kids = div.childNodes;
  if (!text) return kids.length === 1 && kids[0].nodeName === "BR";
  let i = 0;
  if (labelLength) {
    const k = kids[0];
    if (!k || k.nodeName !== "SPAN" || k.attributes.length !== 1 || k.className !== "sf-k" || k.childNodes.length !== 1 || k.firstChild.nodeType !== 3 || k.firstChild.data !== text.slice(0, labelLength)) return false;
    i = 1;
  }
  const rest = text.slice(labelLength);
  if (!rest) return kids.length === i;
  return kids.length === i + 1 && kids[i].nodeType === 3 && kids[i].data === rest;
}

const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE|TR)$/;

// The lines of whatever is in `node` — the page, or a cloned slice of it
// (for caret offsets). Blocks and <br> break lines; a <br> that only holds
// an empty line open counts once.
function readLines(node) {
  const lines = [];
  let cur = "";
  let open = false;
  const end = () => { lines.push(cur); cur = ""; open = false; };
  const walk = (parent) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) {
        n.data.replace(/ /g, " ").split("\n").forEach((part, i) => { if (i) end(); cur += part; open = true; });
      } else if (n.nodeName === "BR") {
        end();
      } else if (BLOCK.test(n.nodeName)) {
        if (cur) end();
        open = true;
        walk(n);
        if (open) end();
      } else if (n.nodeType === 1) {
        walk(n);
      }
    }
  };
  walk(node);
  if (open) end();
  return lines.length ? lines : [""];
}

export function openScriptFocus({ title = "", value = "", lang = "id", mode = "text", onChange = () => {}, onClose = () => {}, onDiscuss = null, onTeleprompter = null } = {}) {
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
        ${cards ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-focus-beat title="${escapeHtml(t("cr.focus.addBeatTitle"))}">${icon("plus", { size: 14 })}<span>${t("cr.focus.addBeat")}</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-focus-preview aria-pressed="false">${icon("eye", { size: 14 })}<span>${t("cr.focus.preview")}</span></button>`}
        ${onTeleprompter ? `<button type="button" class="btn btn-ghost btn-sm" data-focus-tp>${icon("teleprompter", { size: 14 })}<span>${t("cr.focus.teleprompter")}</span></button>` : ""}
        ${onDiscuss ? `<button type="button" class="btn btn-secondary btn-sm" data-focus-discuss>${icon("chat", { size: 14 })}<span>${t("cr.focus.discuss")}</span></button>` : ""}
      </div>
    </div>
    <div class="script-focus-body">
      ${cards
        ? `<div class="script-focus-cards"></div>
      <p class="script-focus-hint">${t("cr.focus.cardsHint")}</p>`
        : `<div class="script-focus-text" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" aria-label="${escapeHtml(t("cr.f.script"))}" data-ph="${escapeHtml(t("cr.focus.ph"))}"></div>
      <div class="script-focus-preview" hidden></div>
      <p class="script-focus-hint">${t("cr.focus.hint")}</p>`}
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

  // What both kinds of page answer to: focus(), setValue(text), escape()
  // (true when Esc was used up inside the page) and destroy().
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
      escape: () => false,
      destroy: () => box.destroy(),
    };
  };

  const textPage = () => {
    const page = el.querySelector(".script-focus-text");
    const preview = el.querySelector(".script-focus-preview");
    const previewBtn = el.querySelector("[data-focus-preview]");
    const sayPh = t("cr.focus.sayPh");

    // Draws `lines` into the page, touching only lines that changed shape.
    // True when anything was redrawn (the caret then needs putting back).
    const paint = (lines) => {
      const infos = classify(lines);
      let redrawn = false;
      if ([...page.childNodes].some((n) => n.nodeName !== "DIV")) { page.textContent = ""; redrawn = true; }
      lines.forEach((text, i) => {
        let div = page.children[i];
        if (!div) { div = page.appendChild(document.createElement("div")); redrawn = true; }
        if (!isDrawn(div, text, infos[i].labelLength)) { fillLine(div, text, infos[i].labelLength); redrawn = true; }
        if (div.hasAttribute("style")) div.removeAttribute("style");
        const cls = lineClass(infos, lines, i);
        if (div.className !== cls) div.className = cls;
        if (infos[i].kind === "say" && !div.dataset.ph) div.dataset.ph = sayPh;
      });
      while (page.children.length > lines.length) { page.lastElementChild.remove(); redrawn = true; }
      page.classList.toggle("is-empty", !lines.join(""));
      return redrawn;
    };

    // Caret <-> offset in `current`.
    const pointOffset = (node, off) => {
      const r = document.createRange();
      r.setStart(page, 0);
      r.setEnd(node, off);
      let o = readLines(r.cloneContents()).join("\n").length;
      // Between two line <div>s = the start of the second one.
      if (node === page && off > 0 && off < page.childNodes.length) o += 1;
      return o;
    };
    const selOffsets = () => {
      const sel = getSelection();
      if (!sel.rangeCount || !page.contains(sel.anchorNode) || !page.contains(sel.focusNode)) return null;
      const r = sel.getRangeAt(0);
      const start = pointOffset(r.startContainer, r.startOffset);
      return { start, end: r.collapsed ? start : pointOffset(r.endContainer, r.endOffset) };
    };
    const placeCaret = (offset) => {
      const lines = current.split("\n");
      let line = 0;
      let o = Math.max(0, offset);
      while (line < lines.length - 1 && o > lines[line].length) { o -= lines[line].length + 1; line++; }
      const div = page.children[line];
      if (!div) return;
      o = Math.min(o, lines[line].length);
      const texts = [];
      const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) texts.push(walker.currentNode);
      let node = div;
      let at = 0;
      // On the seam between the label and the words, the caret goes with the words.
      for (let i = 0; i < texts.length; i++) {
        const len = texts[i].data.length;
        if (o < len || (o === len && i === texts.length - 1)) { node = texts[i]; at = o; break; }
        o -= len;
      }
      const r = document.createRange();
      r.setStart(node, at);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      div.scrollIntoView({ block: "nearest" });
    };

    const setText = (text, caret = null) => {
      current = text;
      paint(text.split("\n"));
      if (caret !== null) placeCaret(caret);
      changed();
    };

    // Undo is ours: redrawing a line would confuse the browser's own history.
    const undoStack = [];
    const redoStack = [];
    let lastTyping = 0;
    let lastKind = "";
    const snapshot = () => ({ text: current, caret: selOffsets()?.end ?? current.length });
    const pushUndo = () => {
      undoStack.push(snapshot());
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack.length = 0;
      lastTyping = 0;
    };
    const travel = (from, to) => {
      if (!from.length) return;
      to.push(snapshot());
      const s = from.pop();
      setText(s.text, s.caret);
      lastTyping = 0;
    };
    const replace = (start, end, insert) => {
      pushUndo();
      setText(current.slice(0, start) + insert + current.slice(end), start + insert.length);
    };

    // After the browser typed: read the lines back, redraw what needs it.
    let composing = false;
    const sync = () => {
      const lines = readLines(page);
      const text = lines.join("\n");
      const at = selOffsets();
      const before = current;
      current = text;
      if (paint(lines) && at) placeCaret(at.end);
      if (text !== before) changed();
    };

    page.addEventListener("beforeinput", (e) => {
      const type = e.inputType;
      if (type === "historyUndo" || type === "historyRedo") {
        e.preventDefault();
        if (type === "historyUndo") travel(undoStack, redoStack);
        else travel(redoStack, undoStack);
        return;
      }
      if (type.startsWith("format")) { e.preventDefault(); return; }
      if ((type === "insertParagraph" || type === "insertLineBreak") && e.cancelable) {
        e.preventDefault();
        const at = selOffsets();
        if (at) replace(at.start, at.end, "\n");
        return;
      }
      const kind = type.startsWith("delete") ? "delete" : "insert";
      const now = Date.now();
      if (now - lastTyping > TYPING_GAP || kind !== lastKind) pushUndo();
      lastTyping = now;
      lastKind = kind;
    });
    page.addEventListener("input", (e) => { if (!e.isComposing && !composing) sync(); });
    page.addEventListener("compositionstart", () => { composing = true; });
    page.addEventListener("compositionend", () => { composing = false; sync(); });
    page.addEventListener("paste", (e) => {
      e.preventDefault();
      const at = selOffsets();
      if (at) replace(at.start, at.end, (e.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n"));
    });
    const copy = (e, cut) => {
      const at = selOffsets();
      if (!at || at.start === at.end) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", current.slice(at.start, at.end));
      if (cut) replace(at.start, at.end, "");
    };
    page.addEventListener("copy", (e) => copy(e, false));
    page.addEventListener("cut", (e) => copy(e, true));
    page.addEventListener("keydown", (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) travel(redoStack, undoStack); else travel(undoStack, redoStack); }
      else if (k === "y" && e.ctrlKey) { e.preventDefault(); travel(redoStack, undoStack); }
      else if (k === "b" || k === "i" || k === "u") e.preventDefault();
    });

    // Where the caret was, so coming back from Pratinjau lands there again.
    let lastCaret = 0;
    const onSelection = () => { const at = selOffsets(); if (at) lastCaret = at.end; };
    document.addEventListener("selectionchange", onSelection);
    const focusPage = () => {
      page.focus({ preventScroll: true });
      placeCaret(Math.min(lastCaret, current.length));
    };

    paint(current.split("\n"));

    const setPreview = (on) => {
      preview.hidden = !on;
      page.hidden = on;
      previewBtn.setAttribute("aria-pressed", String(on));
      previewBtn.querySelector("span").textContent = on ? t("cr.focus.edit") : t("cr.focus.preview");
      if (on) preview.innerHTML = scriptBeatsHTML(current, escapeHtml) || `<p class="script-focus-plain">${escapeHtml(current || t("cr.noScript")).replace(/\n/g, "<br>")}</p>`;
      else focusPage();
    };
    previewBtn.addEventListener("click", () => setPreview(preview.hidden));

    // The next beat, timed after the last one, caret on its Visual line.
    el.querySelector("[data-focus-beat]").addEventListener("click", () => {
      if (!preview.hidden) setPreview(false);
      const beats = parseScript(current)?.beats || [];
      const end = Number(String(beats[beats.length - 1]?.time || "").split("-")[1]) || 0;
      const block = t(lang === "en" ? "cr.focus.beatTemplateEn" : "cr.focus.beatTemplate", { from: end, to: end + 5 });
      const before = current.replace(/\s+$/, "");
      const text = `${before}${before ? "\n\n" : ""}${block}`;
      pushUndo();
      page.focus({ preventScroll: true });
      setText(text, text.length - block.length + block.indexOf(":") + 2);
      page.lastElementChild?.scrollIntoView({ block: "nearest" });
    });

    return {
      focus: focusPage,
      // A revision applied from the docked chat lands here too — one undo step.
      setValue: (text) => {
        pushUndo();
        setText(text);
        if (!preview.hidden) setPreview(true);
      },
      escape: () => {
        if (preview.hidden) return false;
        setPreview(false);
        return true;
      },
      destroy: () => document.removeEventListener("selectionchange", onSelection),
    };
  };

  const editor = cards ? cardsPage() : textPage();
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
    if (!editor.escape()) close();
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
