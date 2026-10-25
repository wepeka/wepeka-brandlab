// The Meta Pixel helper (js/meta-pixel.js) is on for *.wepeka.com. Whatever
// happens while its script is loaded or an event is sent, the callers — the
// boot (initMetaPixel) and the checkout (payPlan) — must never see an error.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// The helper is only on for *.wepeka.com (as tests/pending-orders.test.mjs).
globalThis.location = { hostname: "brandlab.wepeka.com", origin: "https://brandlab.wepeka.com", hash: "#/" };
globalThis.window.addEventListener ||= () => {};

const { metaTrack, initMetaPixel, withinMetaDedup, META_DEDUP_MS } = await import("../js/meta-pixel.js");

describe("Meta Pixel helper", () => {
  test("sending an event never throws, even where the pixel script cannot be inserted", () => {
    const realFbq = window.fbq;
    delete window.fbq;
    const realGet = document.getElementsByTagName;
    document.getElementsByTagName = () => { throw new Error("no script tag"); };
    try {
      assert.doesNotThrow(() => metaTrack("InitiateCheckout", { currency: "IDR", value: 49000 }, "ic-test"));
      assert.doesNotThrow(() => metaTrack("PageView"));
      assert.doesNotThrow(() => initMetaPixel());
    } finally {
      document.getElementsByTagName = realGet;
      if (realFbq) window.fbq = realFbq;
    }
  });
  test("a shared board's guest key in the address never reaches Meta", () => {
    const realFbq = window.fbq, realHash = location.hash, sent = [];
    window.fbq = (...a) => sent.push(a);
    try {
      location.hash = "#/brand/brandA1/papan/boardB2/abcdefghijklmnopqrstuvwx";
      metaTrack("PageView");
      assert.equal(sent.length, 0);
      location.hash = "#/brand/brandA1/papan/boardB2";
      metaTrack("PageView");
      assert.equal(sent.length, 1);
    } finally {
      location.hash = realHash;
      if (realFbq) window.fbq = realFbq; else delete window.fbq;
    }
  });
  test("a browser twin is only sent inside Meta's 48-hour matching window", () => {
    const now = Date.parse("2026-10-12T03:00:00Z");
    assert.equal(withinMetaDedup(now - META_DEDUP_MS + 1000, now), true);
    assert.equal(withinMetaDedup(now - META_DEDUP_MS - 1000, now), false);
    assert.equal(withinMetaDedup(undefined, now), true);
  });
});
