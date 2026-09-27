import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml } from "../js/dom.js";

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
