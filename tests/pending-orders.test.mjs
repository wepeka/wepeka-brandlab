// GA4 "purchase" for orders paid after Snap closed (js/pending-orders.js):
// a checkout is remembered, the server is asked what became of it, a paid
// one is reported once — the same event Snap's onSuccess sends — and then
// forgotten. Runs the real analytics module against a fake gtag queue; the
// server's answer is a fake fetch. No network.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

// js/analytics.js is only on for *.wepeka.com and loads gtag by appending a
// <script>; both are faked here so events land in window.dataLayer.
globalThis.location = { hostname: "brandlab.wepeka.com", origin: "https://brandlab.wepeka.com", hash: "#/" };
globalThis.document.head = { appendChild() {} };
globalThis.window.localStorage = globalThis.localStorage;

const { auth } = await import("../js/firebase.js");
const {
  checkoutParams, freshOrders, withOrder, settleOrders, rememberOrder, reportPurchase, runCheck, checkPendingOrders,
  ORDER_MAX_AGE_MS, MAX_ORDERS,
} = await import("../js/pending-orders.js");
const { ORDER_STATUS_MAX } = await import("../api/_payments.js");

const DAY = 86400000;
const NOW = Date.parse("2026-10-12T03:00:00Z");
const UID = "uidPembeli01";
const KEY = `brandlab:pending-orders:${UID}`;
const order = (n, extra = {}) => ({ orderId: `bl-${UID}-k${n}`, planKey: "starter-monthly", amount: 49000, label: "Brandlab Starter — Bulanan", ...extra });
const stored = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const purchases = (orderId) => (window.dataLayer || []).map((args) => [...args]).filter((args) => args[0] === "event" && args[1] === "purchase" && (!orderId || args[2].transaction_id === orderId));

// What the server would answer, and what it was asked.
const asked = [];
function serverSays(answer) {
  globalThis.fetch = async (url, init) => {
    asked.push({ url, init, body: JSON.parse(init.body) });
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : { ok: true, json: async () => ({ orders: answer }) };
  };
}
function signIn(uid = UID) {
  auth.currentUser = { uid, email: "owner@kopi.id", getIdToken: async () => "id-token" };
}
function reset() {
  localStorage.clear();
  asked.length = 0;
  location.hash = "#/";
  signIn();
}

describe("what is sent for an order", () => {
  test("one definition for checkout and purchase, GA4 item and Meta parameters", () => {
    assert.deepEqual(checkoutParams(order(1)), {
      item: { item_id: "starter-monthly", item_name: "Brandlab Starter — Bulanan", price: 49000, quantity: 1 },
      metaParams: { currency: "IDR", value: 49000, content_ids: ["starter-monthly"], content_name: "Brandlab Starter — Bulanan", content_type: "product" },
    });
    assert.equal(checkoutParams({ planKey: "ai-300", amount: 15000 }).item.item_name, "ai-300");
  });
});

describe("remembered orders", () => {
  test("a checkout is added with its time; the same order twice counts once", () => {
    const one = withOrder([], order(1), NOW);
    assert.deepEqual(one, [{ ...order(1), at: NOW }]);
    const again = withOrder(one, order(1), NOW + 5000);
    assert.deepEqual(again, [{ ...order(1), at: NOW + 5000 }]);
    assert.equal(withOrder(again, order(2), NOW + 6000).length, 2);
  });
  test("over a week old is dropped", () => {
    const list = withOrder([], order(1), NOW);
    assert.equal(freshOrders(list, NOW + ORDER_MAX_AGE_MS).length, 1);
    assert.equal(freshOrders(list, NOW + ORDER_MAX_AGE_MS + 1).length, 0);
    assert.equal(ORDER_MAX_AGE_MS, 7 * DAY);
    assert.deepEqual(withOrder(list, order(2), NOW + 8 * DAY).map((o) => o.orderId), [order(2).orderId]);
  });
  test("only the newest few are kept — as many as one request may ask about", () => {
    let list = [];
    for (let i = 0; i < MAX_ORDERS + 3; i++) list = withOrder(list, order(i), NOW + i);
    assert.equal(list.length, MAX_ORDERS);
    assert.equal(list[0].orderId, order(3).orderId);
    assert.equal(list.at(-1).orderId, order(MAX_ORDERS + 2).orderId);
    assert.equal(MAX_ORDERS, ORDER_STATUS_MAX);
  });
  test("whatever else is in storage is ignored, and a broken order is never added", () => {
    assert.deepEqual(freshOrders("nope", NOW), []);
    assert.deepEqual(freshOrders([null, 5, {}, { orderId: "a b", planKey: "x", amount: 1, at: NOW }, { orderId: "ok", planKey: "", amount: 1, at: NOW }, { orderId: "ok", planKey: "x", amount: "1", at: NOW }], NOW), []);
    assert.deepEqual(withOrder([], { orderId: "bl-x-1", planKey: "starter-monthly" }, NOW), []);
    assert.deepEqual(withOrder([], { planKey: "starter-monthly", amount: 49000 }, NOW), []);
  });
});

describe("the server's answer", () => {
  const list = [order(1), order(2), order(3), order(4), order(5)].map((o) => ({ ...o, at: NOW }));
  const id = (n) => order(n).orderId;
  test("paid is reported, pending is kept, closed and unknown are dropped", () => {
    const { paid, keep } = settleOrders(list, { [id(1)]: "paid", [id(2)]: "pending", [id(3)]: "closed", [id(4)]: "unknown", [id(5)]: "pending" }, NOW);
    assert.deepEqual(paid.map((o) => o.orderId), [id(1)]);
    assert.deepEqual(keep.map((o) => o.orderId), [id(2), id(5)]);
  });
  test("an order the answer says nothing about is kept for next time", () => {
    const { paid, keep } = settleOrders(list, { [id(1)]: "paid" }, NOW);
    assert.equal(paid.length, 1);
    assert.equal(keep.length, 4);
    assert.equal(settleOrders(list, null, NOW).keep.length, 5);
  });
  test("a stale order is dropped even while the server still calls it pending", () => {
    const { paid, keep } = settleOrders(list, { [id(1)]: "pending" }, NOW + 8 * DAY);
    assert.deepEqual([paid, keep], [[], []]);
  });
});

describe("Snap's onSuccess", () => {
  test("reports the purchase and forgets the order; a second call sends nothing", () => {
    reset();
    const o = order(10);
    rememberOrder(UID, o);
    assert.equal(stored().length, 1);
    assert.equal(reportPurchase(UID, o), true);
    assert.deepEqual(purchases(o.orderId), [["event", "purchase", {
      transaction_id: o.orderId, currency: "IDR", value: 49000,
      items: [{ item_id: "starter-monthly", item_name: "Brandlab Starter — Bulanan", price: 49000, quantity: 1 }],
    }]]);
    assert.equal(localStorage.getItem(KEY), null);
    assert.equal(reportPurchase(UID, o), false);
    assert.equal(purchases(o.orderId).length, 1);
  });
  test("works with storage blocked (nothing remembered, still reported once)", () => {
    reset();
    const o = order(11);
    const real = window.localStorage;
    window.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    try {
      rememberOrder(UID, o);
      assert.equal(reportPurchase(UID, o), true);
    } finally {
      window.localStorage = real;
    }
    assert.equal(purchases(o.orderId).length, 1);
  });
});

describe("an order paid after Snap closed", () => {
  test("pending: nothing is sent and it stays remembered; paid: the same purchase event, once, then forgotten", async () => {
    reset();
    const o = order(20, { planKey: "bookstyle-pop", amount: 20000, label: "Brand Book — Gaya Pop" });
    rememberOrder(UID, o);

    serverSays({ [o.orderId]: "pending" });
    await runCheck(UID);
    assert.equal(purchases(o.orderId).length, 0);
    assert.equal(stored().length, 1);

    serverSays({ [o.orderId]: "paid" });
    await runCheck(UID);
    assert.deepEqual(purchases(o.orderId), [["event", "purchase", {
      transaction_id: o.orderId, currency: "IDR", value: 20000,
      items: [{ item_id: "bookstyle-pop", item_name: "Brand Book — Gaya Pop", price: 20000, quantity: 1 }],
    }]]);
    assert.equal(localStorage.getItem(KEY), null);

    // Asked with the caller's token and the order ids — nothing else.
    assert.equal(asked.length, 2);
    assert.equal(asked[0].url, "/api/midtrans/order-status");
    assert.equal(asked[0].init.method, "POST");
    assert.equal(asked[0].init.headers.Authorization, "Bearer id-token");
    assert.deepEqual(asked[0].body, { orderIds: [o.orderId] });

    // Nothing left to ask about: no request, no second event.
    await runCheck(UID);
    assert.equal(asked.length, 2);
    assert.equal(purchases(o.orderId).length, 1);
  });

  test("closed or unknown to the server: forgotten without an event", async () => {
    reset();
    const [a, b, c] = [order(30), order(31), order(32)];
    [a, b, c].forEach((o) => rememberOrder(UID, o));
    serverSays({ [a.orderId]: "closed", [b.orderId]: "unknown", [c.orderId]: "pending" });
    await runCheck(UID);
    assert.equal(purchases().filter((p) => [a, b, c].some((o) => o.orderId === p[2].transaction_id)).length, 0);
    assert.deepEqual(stored().map((o) => o.orderId), [c.orderId]);
  });

  test("offline, a server error or a strange answer: the order is kept for next time", async () => {
    reset();
    const o = order(40);
    rememberOrder(UID, o);
    serverSays(new Error("offline"));
    await runCheck(UID);
    serverSays(() => ({ ok: false, status: 500, json: async () => ({ error: "x" }) }));
    await runCheck(UID);
    serverSays(() => ({ ok: true, json: async () => ({}) }));
    await runCheck(UID);
    serverSays(() => ({ ok: true, json: async () => { throw new Error("not json"); } }));
    await runCheck(UID);
    assert.equal(asked.length, 4);
    assert.equal(stored().length, 1);
    assert.equal(purchases(o.orderId).length, 0);
  });

  test("Snap's onSuccess lands while the server is answering: still one purchase", async () => {
    reset();
    const o = order(50);
    rememberOrder(UID, o);
    let answer;
    serverSays(() => new Promise((r) => { answer = r; }));
    const check = runCheck(UID);
    await new Promise((r) => setTimeout(r, 0));
    reportPurchase(UID, o); // onSuccess
    answer({ ok: true, json: async () => ({ orders: { [o.orderId]: "paid" } }) });
    await check;
    assert.equal(purchases(o.orderId).length, 1);
    assert.equal(localStorage.getItem(KEY), null);
  });

  test("a checkout started while the server is answering is not lost", async () => {
    reset();
    const [a, b] = [order(60), order(61)];
    rememberOrder(UID, a);
    let answer;
    serverSays(() => new Promise((r) => { answer = r; }));
    const check = runCheck(UID);
    await new Promise((r) => setTimeout(r, 0));
    rememberOrder(UID, b);
    answer({ ok: true, json: async () => ({ orders: { [a.orderId]: "paid" } }) });
    await check;
    assert.equal(purchases(a.orderId).length, 1);
    assert.deepEqual(stored().map((o) => o.orderId), [b.orderId]);
  });

  test("an old stored order is dropped without asking, and leaves storage", async () => {
    reset();
    localStorage.setItem(KEY, JSON.stringify([{ ...order(70), at: Date.now() - 8 * DAY }]));
    serverSays({ [order(70).orderId]: "paid" });
    checkPendingOrders(UID); // what main.js calls: nothing to ask, so no timer either
    await runCheck(UID);
    assert.equal(asked.length, 0);
    assert.equal(purchases(order(70).orderId).length, 0);
    assert.equal(localStorage.getItem(KEY), null);
  });

  test("an old order next to a recent one: only the recent one is asked about", async () => {
    reset();
    const recent = order(72);
    localStorage.setItem(KEY, JSON.stringify([{ ...order(71), at: Date.now() - 8 * DAY }, { ...recent, at: Date.now() - DAY }, "rusak"]));
    serverSays({ [recent.orderId]: "pending" });
    await runCheck(UID);
    assert.deepEqual(asked[0].body, { orderIds: [recent.orderId] });
    assert.deepEqual(stored().map((o) => o.orderId), [recent.orderId]);
  });

  test("only for the account that is signed in, and never signed out", async () => {
    reset();
    const o = order(80);
    rememberOrder(UID, o);
    serverSays({ [o.orderId]: "paid" });
    signIn("uidOrangLain");
    await runCheck(UID);
    await runCheck("uidOrangLain"); // has nothing remembered of its own
    auth.currentUser = null;
    await runCheck(UID);
    assert.equal(asked.length, 0);
    assert.equal(purchases(o.orderId).length, 0);
    assert.equal(stored().length, 1);
  });

  test("never while the sign-in token is in the address bar", async () => {
    reset();
    const o = order(90);
    rememberOrder(UID, o);
    serverSays({ [o.orderId]: "paid" });
    location.hash = "#/sso?t=eyJhbGciOi.token";
    await runCheck(UID);
    assert.equal(asked.length, 0);
    assert.equal(stored().length, 1);
    location.hash = "#/";
    await runCheck(UID);
    assert.equal(purchases(o.orderId).length, 1);
  });
});

describe("when the server is asked", () => {
  test("nothing remembered: no request at all", () => {
    reset();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      serverSays({});
      checkPendingOrders(UID);
      checkPendingOrders(null);
      mock.timers.tick(120_000);
      assert.equal(asked.length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  test("a moment after boot or an account change, several changes in a row ask once, and checks stay apart", async () => {
    reset();
    // A fresh page: no check has run yet (the tests above ran several).
    const page = await import("../js/pending-orders.js?fresh-page");
    const o = order(100);
    page.rememberOrder(UID, o);
    serverSays({ [o.orderId]: "pending" });
    const settle = () => new Promise((r) => setImmediate(r));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      page.checkPendingOrders(UID);
      page.checkPendingOrders(UID);
      page.checkPendingOrders(UID);
      assert.equal(asked.length, 0, "not on the boot's critical path");
      mock.timers.tick(3000);
      await settle();
      assert.equal(asked.length, 1);

      // The webhook's write right after that check: asked again, but not at once.
      page.checkPendingOrders(UID);
      mock.timers.tick(3000);
      await settle();
      assert.equal(asked.length, 1);
      mock.timers.tick(27_000);
      await settle();
      assert.equal(asked.length, 2);
    } finally {
      mock.timers.reset();
    }
  });
});

// The real checkout (js/views/pricing.js payPlan) against a fake Snap and a
// fake server: what it remembers, and that each way of finishing reports
// the purchase exactly once.
describe("checkout through payPlan", () => {
  const events = (name) => (window.dataLayer || []).map((args) => [...args]).filter((args) => args[0] === "event" && args[1] === name);
  let snapCallbacks = null;
  let orderStatus = "pending";
  function fakeCheckout(orderId, { amount = 499000, label = "Brandlab Founder Lifetime" } = {}) {
    window.snap = { pay: (_token, callbacks) => { snapCallbacks = callbacks; } };
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === "/api/midtrans/order-status") return { ok: true, json: async () => ({ orders: Object.fromEntries(body.orderIds.map((id) => [id, orderStatus])) }) };
      if (body.statusOnly) return { ok: true, json: async () => ({ open: true, production: false, clientKey: "client-key" }) };
      return { ok: true, json: async () => ({ token: "snap-token", orderId, amount, label }) };
    };
  }
  const founderItem = { item_id: "founder", item_name: "Brandlab Founder Lifetime", price: 499000, quantity: 1 };
  // payPlan's toasts need a #toast-root and leave a timer behind.
  async function withToasts(fn) {
    const getEl = document.getElementById;
    document.getElementById = () => document.createElement("div");
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await fn();
    } finally {
      mock.timers.reset();
      document.getElementById = getEl;
    }
  }

  test("a transfer: Snap says pending, the order is remembered, and the purchase is reported once the server says paid", () => withToasts(async () => {
    reset();
    const { payPlan } = await import("../js/views/pricing.js");
    const orderId = `bl-${UID}-p1`;
    orderStatus = "pending";
    fakeCheckout(orderId);
    const begun = events("begin_checkout").length;

    await payPlan("founder", UID);
    assert.deepEqual(events("begin_checkout").slice(begun), [["event", "begin_checkout", { currency: "IDR", value: 499000, items: [founderItem] }]]);
    assert.deepEqual(stored().map(({ at, ...o }) => o), [{ orderId, planKey: "founder", amount: 499000, label: "Brandlab Founder Lifetime" }]);

    snapCallbacks.onPending();
    await runCheck(UID);
    assert.equal(purchases(orderId).length, 0);
    assert.equal(stored().length, 1);

    orderStatus = "paid"; // the buyer paid in their banking app; the webhook settled it
    await runCheck(UID);
    assert.deepEqual(purchases(orderId), [["event", "purchase", { transaction_id: orderId, currency: "IDR", value: 499000, items: [founderItem] }]]);
    assert.equal(localStorage.getItem(KEY), null);
    await runCheck(UID);
    assert.equal(purchases(orderId).length, 1);
  }));

  test("a card: Snap's onSuccess reports it, the caller's onSuccess still runs, and a later check adds nothing", () => withToasts(async () => {
    reset();
    const { payPlan } = await import("../js/views/pricing.js");
    const orderId = `bl-${UID}-p2`;
    orderStatus = "paid";
    fakeCheckout(orderId);
    let entered = 0;

    await payPlan("founder", UID, { onSuccess: () => { entered += 1; } });
    assert.equal(stored().length, 1);
    snapCallbacks.onSuccess();
    assert.equal(entered, 1);
    assert.deepEqual(purchases(orderId), [["event", "purchase", { transaction_id: orderId, currency: "IDR", value: 499000, items: [founderItem] }]]);
    assert.equal(localStorage.getItem(KEY), null);

    rememberOrder(UID, { orderId, planKey: "founder", amount: 499000, label: "Brandlab Founder Lifetime" }); // even if it were still remembered
    await runCheck(UID);
    assert.equal(purchases(orderId).length, 1);
  }));
});
