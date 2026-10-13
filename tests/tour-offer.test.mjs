// The floating "Masih belum paham? Mau tur website?" pill (js/tour-offer.js):
// owed to a new account from the moment its first-run video opens, until the
// website tour starts or the pill is closed — on this browser and, through
// settings/{uid}.guideSeen, on the person's other devices.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// js/seen-flags.js reads window.localStorage, as in the browser.
globalThis.window.localStorage = globalThis.localStorage;

const store = await import("../js/store.js");
const { auth } = await import("../js/firebase.js");
const { setCachedAccount } = await import("../js/account.js");
const { __docs } = await import("./stubs/firebase-firestore.js");
const { tourOfferDue, armTourOffer, retireTourOffer, showTourOffer } = await import("../js/tour-offer.js");
const { t, setLang } = await import("../js/i18n.js");

const UID = "uid-akun-baru";
const DAY = 86400000;
await store.initStore(UID);
auth.currentUser = { uid: UID, email: "owner@kopi.id" };
setCachedAccount({ uid: UID, plan: "trial", status: "active", trialEndsAt: Date.now() + 30 * DAY });
const tick = () => new Promise((r) => setTimeout(r, 0));
const freshBrowser = () => localStorage.clear();
const reset = () => { freshBrowser(); store.updateSettings({ guideSeen: {} }); };

describe("when the pill is owed", () => {
  test("never to an account whose first-run video did not open", () => {
    reset();
    assert.equal(tourOfferDue(), false);
    assert.equal(showTourOffer(), null);
  });

  test("from the moment the video opens, on this browser and on the account", async () => {
    reset();
    armTourOffer();
    assert.equal(tourOfferDue(), true);
    await tick();
    assert.ok(__docs.get(`settings/${UID}`).guideSeen["tour:offer"] > 0, "written to settings/{uid}");
    freshBrowser();
    assert.equal(tourOfferDue(), true, "another device sees it from the account");
  });

  test("no longer once the tour started or the pill was closed", async () => {
    reset();
    armTourOffer();
    retireTourOffer();
    assert.equal(tourOfferDue(), false);
    await tick();
    assert.ok(__docs.get(`settings/${UID}`).guideSeen["tour:offer-closed"] > 0);
    freshBrowser();
    assert.equal(tourOfferDue(), false, "stays closed on another device");
    armTourOffer();
    assert.equal(tourOfferDue(), false, "arming again does not bring it back");
  });

  test("starting the tour leaves an account that was never offered untouched", () => {
    reset();
    retireTourOffer();
    assert.deepEqual(store.getSettings().guideSeen, {});
  });
});

test("the pill's words exist in both languages", () => {
  for (const lang of ["id", "en"]) {
    setLang(lang);
    for (const key of ["tour.offer.title", "tour.offer.sub", "tour.offer.where"]) assert.notEqual(t(key), key, `${key} (${lang})`);
  }
  setLang("id");
  assert.equal(t("tour.offer.title"), "Masih belum paham?");
  assert.equal(t("tour.offer.sub"), "Mau tur website?");
});
