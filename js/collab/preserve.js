// Kerja Tim: a page repainting because data changed (a teammate's save, or
// one's own echoing back) must never take away what someone is typing.
// Every store.onChange listener runs through preserveEditing(): the field
// with the focus is found again after the repaint and gets back its text,
// caret, selection and scroll, and the focus itself. A repaint waits while
// a card is being dragged (the calendar) or a word is being composed (IME),
// and runs once that ends. No Firebase here (tests/collab.test.mjs).
const TEXT_INPUTS = /^(text|search|email|url|tel|number|password|)$/;
const isEditable = (el) => !!el && ((el.tagName === "TEXTAREA") || (el.tagName === "INPUT" && TEXT_INPUTS.test(el.type || "")) || el.isContentEditable);

const cssEscape = (v) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
// How to find "the same field" in the new page.
function selectorFor(el) {
  if (el.id) return `#${cssEscape(el.id)}`;
  for (const attr of ["data-lock", "data-field", "data-key", "name"]) {
    const v = el.getAttribute(attr);
    if (v) return `${el.tagName.toLowerCase()}[${attr}="${cssEscape(v)}"]`;
  }
  return null;
}

export function captureEditing(doc = typeof document !== "undefined" ? document : null) {
  const el = doc?.activeElement;
  if (!isEditable(el)) return null;
  const selector = selectorFor(el);
  if (!selector) return null;
  const text = el.isContentEditable ? null : el.value;
  let start = null;
  let end = null;
  let dir = "none";
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
    dir = el.selectionDirection || "none";
  } catch {
    /* number inputs have no selection */
  }
  return { el, selector, text, start, end, dir, scrollTop: el.scrollTop || 0, scrollLeft: el.scrollLeft || 0 };
}

// After a repaint: when the field was rebuilt, the new one gets the text,
// caret and focus the old one had. A field that survived the repaint is
// left alone.
export function restoreEditing(snap, doc = typeof document !== "undefined" ? document : null) {
  if (!snap || !doc) return false;
  if (snap.el.isConnected && doc.activeElement === snap.el) return false;
  const next = doc.querySelector(snap.selector);
  if (!next || next === snap.el || !isEditable(next)) return false;
  if (snap.text !== null && next.value !== snap.text) next.value = snap.text;
  try {
    next.focus({ preventScroll: true });
  } catch {
    next.focus();
  }
  try {
    if (snap.start !== null && typeof next.setSelectionRange === "function") next.setSelectionRange(snap.start, snap.end, snap.dir);
  } catch {
    /* not every input type takes a selection */
  }
  next.scrollTop = snap.scrollTop;
  next.scrollLeft = snap.scrollLeft;
  return true;
}

// ---- waiting out drags and IME composition ----
let busyDrag = false;
let busyCompose = false;
const queued = new Set();
function flush() {
  if (busyDrag || busyCompose) return;
  const fns = [...queued];
  queued.clear();
  fns.forEach((fn) => {
    try {
      runPreserving(fn);
    } catch (e) {
      console.error(e);
    }
  });
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("dragstart", () => { busyDrag = true; }, true);
  const dragDone = () => {
    busyDrag = false;
    setTimeout(flush, 0);
  };
  document.addEventListener("dragend", dragDone, true);
  document.addEventListener("drop", dragDone, true);
  document.addEventListener("compositionstart", () => { busyCompose = true; }, true);
  document.addEventListener("compositionend", () => {
    busyCompose = false;
    setTimeout(flush, 0);
  }, true);
}

function runPreserving(fn) {
  const snap = captureEditing();
  const out = fn();
  restoreEditing(snap);
  return out;
}

// What store.onChange hands to window.addEventListener.
export function preserveEditing(fn) {
  return (...args) => {
    if (busyDrag || busyCompose) {
      queued.add(() => fn(...args));
      return undefined;
    }
    return runPreserving(() => fn(...args));
  };
}
