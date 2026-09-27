// Test bootstrap, loaded via `node --import ./tests/setup.mjs --test tests/`
// (see package.json's "test" script). Runs before any test file, so it can:
//   (a) register the resolve hook (tests/hooks.mjs) that redirects the
//       app's https://www.gstatic.com/firebasejs/* imports to local fakes
//       (tests/stubs/) — Node's default ESM loader can't fetch https: URLs
//       at all, so without this every import of js/firebase.js or
//       js/store.js throws immediately.
//   (b) define the minimal browser globals (window/document/localStorage/
//       CustomEvent/requestAnimationFrame) several app modules touch at
//       module scope or in the synchronous parts of their exported
//       functions (js/i18n.js's localStorage-backed getLang/setLang,
//       js/store.js's window.addEventListener/dispatchEvent in
//       onChange()/persist(), js/dom.js's document.* calls).
//
// This is a plain Node test run, not a browser — these are the smallest
// fakes that let the real app modules load and run their pure/in-memory
// logic, not a DOM implementation.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

// ---- localStorage ----
if (!globalThis.localStorage) {
  class MemoryStorage {
    #store = new Map();
    getItem(key) {
      return this.#store.has(key) ? this.#store.get(key) : null;
    }
    setItem(key, value) {
      this.#store.set(String(key), String(value));
    }
    removeItem(key) {
      this.#store.delete(key);
    }
    clear() {
      this.#store.clear();
    }
  }
  globalThis.localStorage = new MemoryStorage();
}

// ---- window ----
// js/store.js only needs EventTarget behavior (addEventListener/
// removeEventListener/dispatchEvent) via onChange()/persist(); Node's
// global EventTarget/CustomEvent (available since Node 19) cover the rest.
if (!globalThis.window) {
  globalThis.window = new EventTarget();
}

// ---- document ----
// Nothing exercised by these tests calls document.* at module scope, but
// js/dom.js's toast()/showWelcomeBumper()/etc. reach for it inside
// functions the store/formulas flows can indirectly trigger on error
// paths — a minimal no-op stub keeps those from throwing instead of
// silently doing nothing, which is all this stub needs to do.
if (!globalThis.document) {
  const makeEl = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    appendChild() {},
    removeChild() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  });
  globalThis.document = {
    getElementById() { return null; },
    createElement() { return makeEl(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    body: makeEl(),
  };
}

// ---- requestAnimationFrame ----
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
