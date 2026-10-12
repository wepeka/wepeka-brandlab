// GA4 "start_trial" (js/trial-start.js): once per account, only for a trial
// account that is new — never for the trials that already existed when this
// shipped — and never while the sign-in token is still in the address bar.
// Runs the real analytics module against a fake gtag queue; no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// js/analytics.js is only on for *.wepeka.com and loads gtag by appending a
// <script>; both are faked here so events land in window.dataLayer.
globalThis.location = { hostname: "brandlab.wepeka.com", origin: "https://brandlab.wepeka.com", hash: "#/" };
globalThis.document.head = { appendChild() {} };
// js/seen-flags.js reads window.localStorage, as in the browser.
globalThis.window.localStorage = globalThis.localStorage;

const store = await import("../js/store.js");
const { auth } = await import("../js/firebase.js");
const { setCachedAccount } = await import("../js/account.js");
const { __docs } = await import("./stubs/firebase-firestore.js");
const { trialStartDue, sendTrialStartIfDue, trackTrialStart, TRIAL_START_WINDOW_MS } = await import("../js/trial-start.js");
const { withinMetaDedup, META_DEDUP_MS } = await import("../js/meta-pixel.js");

const DAY = 86400000;
const UID = "uid-trial-baru";
const SEEN_KEY = "analytics:start-trial";
const trial = (ageMs = 60_000) => ({ uid: UID, plan: "trial", status: "active", createdAt: Date.now() - ageMs, trialEndsAt: Date.now() - ageMs + 30 * DAY });
const sentEvents = () => (window.dataLayer || []).map((args) => [...args]).filter((args) => args[0] === "event");
const tick = () => new Promise((r) => setTimeout(r, 0));
// A page load on a browser that has never seen this account: a fresh copy
// of the module (its once-per-page memory) and no browser flag.
const freshPage = async (tag) => {
  localStorage.clear();
  return import(`../js/trial-start.js?${tag}`);
};

describe("which account counts as a trial that just started", () => {
  test("a running trial created moments or a couple of days ago", () => {
    assert.equal(trialStartDue(trial()), true);
    assert.equal(trialStartDue(trial(2 * DAY)), true);
    assert.equal(TRIAL_START_WINDOW_MS, 3 * DAY);
  });
  test("a device clock a little behind the server still counts", () => {
    assert.equal(trialStartDue(trial(-5 * 60_000)), true);
  });
  test("not a trial that already existed (older than the window)", () => {
    assert.equal(trialStartDue(trial(3 * DAY + 60_000)), false);
    assert.equal(trialStartDue(trial(20 * DAY)), false);
  });
  test("not once it has been reported", () => {
    assert.equal(trialStartDue(trial(), { seen: true }), false);
  });
  test("not a paid plan, an ended trial, a paused account or no account", () => {
    assert.equal(trialStartDue({ plan: "starter", status: "active", createdAt: Date.now(), subscriptionExpiresAt: Date.now() + 30 * DAY }), false);
    assert.equal(trialStartDue({ plan: "founder", status: "active", createdAt: Date.now(), subscriptionExpiresAt: null }), false);
    assert.equal(trialStartDue({ ...trial(), trialEndsAt: Date.now() - 1 }), false);
    assert.equal(trialStartDue({ ...trial(), status: "deactivated" }), false);
    assert.equal(trialStartDue(null), false);
  });
  test("not without a usable creation time", () => {
    assert.equal(trialStartDue({ ...trial(), createdAt: undefined }), false);
    assert.equal(trialStartDue({ ...trial(), createdAt: null }), false);
    assert.equal(trialStartDue({ ...trial(), createdAt: "2026-10-12" }), false);
    assert.equal(trialStartDue({ ...trial(), createdAt: 0 }), false);
  });
});

describe("Meta's browser twin of a server event", () => {
  test("only inside Meta's 48-hour matching window — later it would count twice", () => {
    const now = Date.parse("2026-10-12T03:00:00Z");
    assert.equal(META_DEDUP_MS, 2 * DAY);
    assert.equal(withinMetaDedup(now - 60_000, now), true);
    assert.equal(withinMetaDedup(now - 47 * 3600_000, now), true);
    assert.equal(withinMetaDedup(now - 49 * 3600_000, now), false);
    assert.equal(withinMetaDedup(now - 3 * DAY, now), false);
  });
  test("an unknown server time counts as just now", () => {
    assert.equal(withinMetaDedup(undefined), true);
    assert.equal(withinMetaDedup(null), true);
  });
});

describe("sending start_trial", () => {
  test("a new trial account: one event, nothing personal in it, and it is remembered on the account", async () => {
    await store.initStore(UID);
    auth.currentUser = { uid: UID, email: "owner@kopi.id", displayName: "Rani Contoh" };
    setCachedAccount({ ...trial(), email: "owner@kopi.id", displayName: "Rani Contoh" });

    trackTrialStart();
    assert.equal(sentEvents().length, 0, "waits for the server's copy first, never blocks the boot");
    await tick();

    assert.deepEqual(sentEvents(), [["event", "start_trial", { plan: "trial" }]]);
    assert.doesNotMatch(JSON.stringify(sentEvents()), /uid-trial-baru|kopi\.id|Rani/);
    assert.ok(store.getSettings().guideSeen[SEEN_KEY] > 0);
    assert.equal(localStorage.getItem(`brandlab:trial-start:${UID}`), "1");
    await tick();
    assert.ok(__docs.get(`settings/${UID}`).guideSeen[SEEN_KEY] > 0, "written to settings/{uid} for other devices");
  });

  test("never twice: same page, a reload, or another device", async () => {
    assert.equal(sendTrialStartIfDue(), false);
    trackTrialStart();
    await tick();
    // Another device: no browser flag, a fresh page — the mark on the account stops it.
    const other = await freshPage("device-2");
    assert.equal(other.sendTrialStartIfDue(), false);
    assert.equal(sentEvents().length, 1);
  });

  test("a trial that already existed is neither reported nor marked", async () => {
    store.updateSettings({ guideSeen: {} });
    const page = await freshPage("old-trial");
    setCachedAccount(trial(10 * DAY));
    assert.equal(page.sendTrialStartIfDue(), false);
    assert.equal(sentEvents().length, 1);
    assert.equal(store.getSettings().guideSeen[SEEN_KEY], undefined);
    assert.equal(localStorage.getItem(`brandlab:trial-start:${UID}`), null);
  });

  test("signed out: nothing", async () => {
    const page = await freshPage("signed-out");
    setCachedAccount(trial());
    auth.currentUser = null;
    assert.equal(page.sendTrialStartIfDue(), false);
    page.trackTrialStart();
    await tick();
    assert.equal(sentEvents().length, 1);
    auth.currentUser = { uid: UID };
  });

  test("not while the sign-in token is in the address bar — sent once it is gone", async () => {
    const page = await freshPage("sso");
    setCachedAccount(trial());
    location.hash = "#/sso?t=eyJhbGciOi.token";
    assert.equal(page.sendTrialStartIfDue(), false);
    assert.equal(sentEvents().length, 1);
    assert.equal(store.getSettings().guideSeen[SEEN_KEY], undefined, "not marked as sent");

    location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    assert.equal(sentEvents().length, 2);
    assert.deepEqual(sentEvents()[1], ["event", "start_trial", { plan: "trial" }]);
    window.dispatchEvent(new Event("hashchange"));
    assert.equal(sentEvents().length, 2);
  });
});
