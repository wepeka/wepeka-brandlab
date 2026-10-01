import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, wireClickableCards } from "../js/dom.js";

describe("escapeHtml", () => {
  test("escapes all five HTML-significant characters", () => {
    assert.equal(escapeHtml(`< > & " '`), "&lt; &gt; &amp; &quot; &#39;");
  });

  test("escapes & before the characters it would otherwise double-escape", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  test("passes plain text through untouched", () => {
    assert.equal(escapeHtml("hello world"), "hello world");
  });

  test("null/undefined/empty become an empty string, not 'null'/'undefined'", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(""), "");
  });

  test("coerces non-string input (e.g. a number) to a string first", () => {
    assert.equal(escapeHtml(42), "42");
  });
});

// A stand-in for a rendered card: just the bits wireClickableCards touches.
function fakeCard(attrs = {}) {
  const listeners = {};
  const el = {
    attrs: { ...attrs },
    clicks: 0,
    tabIndex: -1,
    hasAttribute(name) { return name in this.attrs; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    click() { this.clicks++; },
    press(key, target = el) {
      let prevented = false;
      (listeners.keydown || []).forEach((fn) => fn({ key, target, preventDefault() { prevented = true; } }));
      return prevented;
    },
  };
  if ("tabindex" in attrs) el.tabIndex = Number(attrs.tabindex);
  return el;
}
const rootWith = (...els) => ({ querySelectorAll: () => els });

describe("wireClickableCards", () => {
  test("makes a card focusable and announces it as a button by default", () => {
    const card = fakeCard();
    wireClickableCards(rootWith(card), ".card");
    assert.equal(card.tabIndex, 0);
    assert.equal(card.attrs.role, "button");
  });

  test("keeps a role or tabindex the markup already set", () => {
    const card = fakeCard({ role: "link", tabindex: "-1" });
    wireClickableCards(rootWith(card), ".card", { role: "button" });
    assert.equal(card.attrs.role, "link");
    assert.equal(card.tabIndex, -1);
  });

  test("Enter and Space click the card; other keys don't", () => {
    const card = fakeCard();
    wireClickableCards(rootWith(card), ".card");
    assert.equal(card.press("Enter"), true);
    assert.equal(card.press(" "), true);
    assert.equal(card.press("a"), false);
    assert.equal(card.clicks, 2);
  });

  test("a key pressed on a button inside the card is left to that button", () => {
    const card = fakeCard();
    wireClickableCards(rootWith(card), ".card");
    assert.equal(card.press("Enter", { tagName: "BUTTON" }), false);
    assert.equal(card.clicks, 0);
  });
});
