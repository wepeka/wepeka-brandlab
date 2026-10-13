// The terms, the refund policy and the privacy policy are on wepeka.com;
// the app links to them where someone signs in or pays (js/legal-links.js):
// the login card, the front page's footer and the plans page. Rendered in
// Node with the test stubs — no browser, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

globalThis.window.scrollTo ??= () => {};
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { TERMS_URL, PRIVACY_URL, REFUND_URL } = await import("../js/site-links.js");
const { agreeLine } = await import("../js/legal-links.js");
const { landingHTML } = await import("../js/views/landing.js");
const { render: renderPlans } = await import("../js/views/pricing.js");
const { renderAuthScreen } = await import("../js/views/login.js");
const { setLang } = await import("../js/i18n.js");

const el = () => ({ addEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], focus() {}, style: {}, dataset: {}, value: "" });
const fakeRoot = () => ({ innerHTML: "", isConnected: true, querySelector: () => el(), querySelectorAll: () => [] });
const plans = (opts) => {
  const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [] };
  renderPlans(root, opts);
  return root.innerHTML;
};
const opensInNewTab = (html, url) => html.includes(`<a href="${url}" target="_blank" rel="noopener noreferrer">`);

describe("terms and privacy links", () => {
  test("the addresses are the site's own pages; refund is a section of the terms", () => {
    assert.equal(TERMS_URL, "https://www.wepeka.com/syarat-ketentuan");
    assert.equal(PRIVACY_URL, "https://www.wepeka.com/kebijakan-privasi");
    assert.equal(REFUND_URL, `${TERMS_URL}#refund`);
  });

  test("every sentence has its links filled in, in both languages", () => {
    for (const lang of ["id", "en"]) {
      setLang(lang);
      for (const key of ["legal.agreeLogin", "legal.agreePay"]) {
        const line = agreeLine(key);
        assert.equal(line.match(/\{\w+\}/g), null, `${key} (${lang})`);
        assert.ok(opensInNewTab(line, TERMS_URL) && opensInNewTab(line, PRIVACY_URL), `${key} (${lang})`);
      }
      assert.ok(opensInNewTab(agreeLine("legal.agreePay"), REFUND_URL), `refund (${lang})`);
    }
    setLang("id");
  });

  test("the login card says what logging in agrees to", () => {
    const root = fakeRoot();
    renderAuthScreen(root);
    const line = root.innerHTML.slice(root.innerHTML.indexOf('class="auth-legal"'));
    assert.ok(line.startsWith('class="auth-legal"'));
    assert.match(line, /Dengan masuk, kamu menyetujui/);
    assert.ok(opensInNewTab(line, TERMS_URL) && opensInNewTab(line, PRIVACY_URL));
  });

  test("the front page's footer links to both pages", () => {
    const html = landingHTML();
    const foot = html.slice(html.indexOf('class="lp-foot"'));
    assert.ok(opensInNewTab(foot, TERMS_URL) && opensInNewTab(foot, PRIVACY_URL));
  });

  test("the plans page says what paying agrees to, for visitors and accounts alike", () => {
    for (const opts of [{}, { user: { uid: "u1", email: "owner@kopi.id" }, account: { plan: "trial", trialEndsAt: Date.now() + 86400000 } }]) {
      const html = plans(opts);
      const line = html.slice(html.indexOf('class="pricing-legal"'));
      assert.ok(line.startsWith('class="pricing-legal"'));
      for (const url of [TERMS_URL, REFUND_URL, PRIVACY_URL]) assert.ok(opensInNewTab(line, url), url);
    }
  });

  test("the plans inside the front page leave it to the footer", () => {
    assert.ok(!plans({ embed: true }).includes("pricing-legal"));
  });
});
