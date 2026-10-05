import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pickTintTextColor, contrastRatio } from "../js/dom.js";

const DARK = "#1c1610";
const LIGHT = "#f6f4f1";

describe("contrastRatio (WCAG 2.x)", () => {
  test("black on white is 21:1, a colour on itself is 1:1", () => {
    assert.equal(contrastRatio("#000000", "#ffffff").toFixed(1), "21.0");
    assert.equal(contrastRatio("#4caf50", "#4caf50"), 1);
  });

  test("accepts #rgb, #rrggbb and rgb() the same way", () => {
    assert.equal(contrastRatio("#0af", "#000"), contrastRatio("rgb(0, 170, 255)", "#000000"));
  });
});

describe("pickTintTextColor", () => {
  // The colours the old YIQ > 140 rule got wrong: it put light text on
  // them (2.09 / 2.53 / 2.85:1); dark text reads at 5.7–7.8:1.
  for (const bg of ["#00bcd4", "#4caf50", "#2196f3"]) {
    test(`${bg} gets the dark text colour`, () => {
      assert.equal(pickTintTextColor(bg), DARK);
      assert.ok(contrastRatio(DARK, bg) >= 4.5);
    });
  }

  test("dark brand colours still get the light text colour", () => {
    for (const bg of ["#000000", "#9c27b0", "#795548", "#b4530a"]) {
      assert.equal(pickTintTextColor(bg), LIGHT, bg);
    }
  });

  test("pale colours (and the app's own amber) get the dark text colour", () => {
    for (const bg of ["#ffffff", "#ffeb3b", "#ffa52b"]) {
      assert.equal(pickTintTextColor(bg), DARK, bg);
    }
  });

  test("always returns whichever of the two has the higher contrast", () => {
    for (const bg of ["#e91e63", "#f44336", "#607d8b", "#3f51b5", "#009688", "#ff5722", "rgb(120, 120, 120)"]) {
      const picked = pickTintTextColor(bg);
      const other = picked === DARK ? LIGHT : DARK;
      assert.ok(contrastRatio(picked, bg) >= contrastRatio(other, bg), bg);
      assert.ok(contrastRatio(picked, bg) >= 3, `${bg} should reach at least 3:1`);
    }
  });

  test("unparseable input falls back to the dark text colour", () => {
    assert.equal(pickTintTextColor("not-a-colour"), DARK);
    assert.equal(pickTintTextColor(undefined), DARK);
  });
});
