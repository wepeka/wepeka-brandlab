// The pricing page's markup for each kind of visitor, rendered in Node with
// the test stubs — no browser, no Firestore, no network (fetch is replaced
// so the "can this account pay online?" check fails closed, as it does in
// the app whenever the server can't be reached).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

globalThis.window.scrollTo ??= () => {};
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { render } = await import("../js/views/pricing.js");
const { t } = await import("../js/i18n.js");

function paint(opts) {
  const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [] };
  render(root, opts);
  return root.innerHTML;
}
const user = { uid: "u1", email: "owner@kopi.id" };
const payButtons = (html) => [...html.matchAll(/data-pay="([^"]+)"/g)].map((m) => m[1]);

describe("pricing page", () => {
  test("a logged-out visitor gets a Masuk button at the top, not only in the footer (A-07)", () => {
    const html = paint({});
    const login = html.indexOf('id="pricing-login"');
    assert.ok(login > 0);
    assert.ok(login < html.indexOf("pricing-hero"), "above the hero");
    assert.match(html, /href="#\/login" id="pricing-login"/);
  });

  test("under the plans: BCA is still in process, and the admin's WhatsApp is the way to pay with it", () => {
    const bankHref = (html) => html.match(/pricing-bank-note[\s\S]*?href="([^"]+)"/)?.[1] || "";
    const html = paint({ user, account: { plan: "trial", status: "active", trialEndsAt: Date.now() + 86400000 } });
    assert.ok(html.includes(t("pricing.bank.note")));
    assert.ok(html.includes(t("pricing.bank.cta")));
    assert.ok(html.indexOf("pricing-bank-note") > html.indexOf(t("pricing.trust")), "right under the payment line");
    assert.match(bankHref(html), /^https:\/\/wa\.me\/6285196627609\?text=/);
    assert.match(decodeURIComponent(bankHref(html)), /BCA.*owner@kopi\.id/);
    // Signed out: the same note, without an account email in the message.
    const guest = decodeURIComponent(bankHref(paint({})));
    assert.match(guest, /BCA/);
    assert.doesNotMatch(guest, /Email akun|undefined/);
  });

  test("a trial account can buy every plan", () => {
    const html = paint({ user, account: { plan: "trial", status: "active", trialEndsAt: Date.now() + 86400000 } });
    assert.deepEqual(payButtons(html).sort(), ["founder", "founder-ultimate", "starter-monthly", "studio-monthly", "studio-yearly"].sort());
  });

  test("a Founder sees no subscription or Founder checkout — only the Agency upgrade (S-15)", () => {
    const html = paint({ user, account: { plan: "founder", status: "active", subscriptionExpiresAt: null } });
    assert.deepEqual(payButtons(html), ["founder-ultimate"]);
    assert.ok(html.includes(t("pricing.owned.founder")));
    assert.ok(html.includes(t("pricing.owned.upgrade")));
  });

  test("an Agency account has nothing to buy but add-ons (S-15)", () => {
    const html = paint({ user, account: { plan: "founder-ultimate", status: "active", subscriptionExpiresAt: null } });
    assert.deepEqual(payButtons(html), []);
    assert.ok(html.includes(t("pricing.owned.agency")));
  });

  test("the old all-in-one Lifetime is not offered plans either", () => {
    assert.deepEqual(payButtons(paint({ user, account: { plan: "lifetime", status: "active" } })), []);
  });
});
