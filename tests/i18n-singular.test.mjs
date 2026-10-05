import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { t, setLang, getLang } from "../js/i18n.js";
import { formatPercent } from "../js/dom.js";

const original = getLang();
after(() => setLang(original));

describe("t(): English singulars (<key>.one)", () => {
  test("a count of exactly 1 reads singular in English", () => {
    setLang("en");
    assert.equal(t("roadmap.days.left", { n: 1 }), "1 day left");
    assert.equal(t("camp.m.daysAgo", { count: 1 }), "1 day ago");
    assert.equal(t("pricing.status.trial", { days: 1 }), "Trial — 1 day left.");
    assert.match(t("cadence.updatedFromWizard", { n: 1 }), /^Work schedule updated: 1 upload a week\./);
  });

  test("any other count keeps the plural", () => {
    setLang("en");
    assert.equal(t("roadmap.days.left", { n: 2 }), "2 days left");
    assert.equal(t("roadmap.days.left", { n: 0 }), "0 days left");
    assert.equal(t("camp.m.daysAgo", { count: 11 }), "11 days ago");
  });

  test("Indonesian always reads the base key", () => {
    setLang("id");
    assert.equal(t("roadmap.days.left", { n: 1 }), "1 hari lagi");
    assert.equal(t("pricing.status.trial", { days: 1 }), "Trial — sisa 1 hari.");
  });

  test("keys without a .one variant are untouched", () => {
    setLang("en");
    assert.match(t("calendar.more", { count: 1 }), /1/);
    assert.equal(t("nav.home"), "Home");
    assert.equal(t("no.such.key", { n: 1 }), "no.such.key");
  });
});

describe("formatPercent follows the app language", () => {
  test("Indonesian uses a decimal comma, English a decimal point", () => {
    setLang("id");
    assert.equal(formatPercent(4.5), "4,5%");
    assert.equal(formatPercent(12, 0), "12%");
    setLang("en");
    assert.equal(formatPercent(4.5), "4.5%");
    assert.equal(formatPercent(4.56, 2), "4.56%");
  });

  test("missing values still read as a dash", () => {
    assert.equal(formatPercent(null), "—");
    assert.equal(formatPercent(NaN), "—");
  });
});
