// The "purchase" event for orders that are paid after Snap has closed.
//
// A card or e-wallet payment finishes inside Snap, and js/views/pricing.js
// reports it from Snap's onSuccess. A bank transfer, a virtual account and
// some QRIS payments don't: Snap only says "pending", the buyer pays in
// their banking app, the Midtrans webhook unlocks the plan — and onSuccess
// never runs, so GA4 never heard of the purchase (Meta still did, from the
// webhook's Conversions API event).
//
// So every checkout is remembered here (localStorage, per account) the
// moment its Snap transaction exists. When the app boots or the account doc
// changes (the webhook writes it for every kind of purchase), the server is
// asked what became of the remembered orders — api/midtrans/order-status.js;
// payments/{order_id} itself is closed to clients. A paid one is reported
// exactly as onSuccess would have, once, then forgotten; one the server
// calls closed (expired, cancelled, denied) or unknown, or that is over a
// week old, is just forgotten.
//
// Analytics only: nothing here unlocks anything, and nothing here may throw
// into the checkout or the boot.
import { gaEvent } from "./analytics.js";
import { metaTrack, withinMetaDedup } from "./meta-pixel.js";
import { auth } from "./firebase.js";

export const ORDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Mirrors api/_payments.js ORDER_STATUS_MAX (one request asks about them all).
export const MAX_ORDERS = 10;
const KEY_PREFIX = "brandlab:pending-orders:";
// A check waits a moment (the boot paints first; an account change may be
// one of several in a row) and they stay at least this far apart.
const CHECK_DELAY_MS = 3000;
const CHECK_GAP_MS = 30_000;

// ---------- Pure parts (tests/pending-orders.test.mjs) ----------

// GA4's item and Meta's parameters for one order — the same for
// begin_checkout / InitiateCheckout and for purchase / Purchase.
export function checkoutParams({ planKey, amount, label }) {
  return {
    item: { item_id: planKey, item_name: label || planKey, price: amount, quantity: 1 },
    metaParams: { currency: "IDR", value: amount, content_ids: [planKey], content_name: label || planKey, content_type: "product" },
  };
}

const isOrder = (o) => !!o && typeof o.orderId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.orderId)
  && typeof o.planKey === "string" && !!o.planKey && Number.isFinite(o.amount) && Number.isFinite(o.at);

// What is still worth asking about: well-formed, at most a week old, the
// newest MAX_ORDERS. Whatever localStorage held is never trusted as is.
export function freshOrders(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.filter((o) => isOrder(o) && now - o.at <= ORDER_MAX_AGE_MS).slice(-MAX_ORDERS);
}

// The list with one more checkout on it (the same order twice counts once).
export function withOrder(list, { orderId, planKey, amount, label }, now = Date.now()) {
  const order = { orderId, planKey, amount: Number(amount), label: typeof label === "string" ? label : "", at: now };
  if (!isOrder(order)) return freshOrders(list, now);
  return freshOrders([...freshOrders(list, now).filter((o) => o.orderId !== orderId), order], now);
}

// The server's answer applied to the remembered orders: `paid` are reported
// and forgotten, `keep` are asked about again later ("pending", or an order
// the answer says nothing about); anything else is dropped.
export function settleOrders(list, statuses, now = Date.now()) {
  const paid = [];
  const keep = [];
  freshOrders(list, now).forEach((o) => {
    const status = statuses && Object.prototype.hasOwnProperty.call(statuses, o.orderId) ? statuses[o.orderId] : undefined;
    if (status === "paid") paid.push(o);
    else if (status === "pending" || status === undefined) keep.push(o);
  });
  return { paid, keep };
}

// ---------- Remembering ----------

function readOrders(uid) {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + uid);
    if (!raw) return [];
    const stored = JSON.parse(raw);
    const fresh = freshOrders(stored);
    // Stale or broken entries leave storage the moment they are seen.
    if (!Array.isArray(stored) || fresh.length !== stored.length) writeOrders(uid, fresh);
    return fresh;
  } catch {
    return []; // storage blocked or not JSON: nothing remembered
  }
}
function writeOrders(uid, list) {
  try {
    if (list.length) window.localStorage.setItem(KEY_PREFIX + uid, JSON.stringify(list));
    else window.localStorage.removeItem(KEY_PREFIX + uid);
  } catch {
    /* storage blocked: the purchase is then only reported by Snap's onSuccess */
  }
}

// payPlan calls this as soon as create-transaction answers.
export function rememberOrder(uid, order) {
  try {
    if (uid && order) writeOrders(uid, withOrder(readOrders(uid), order));
  } catch {
    /* never in the way of the checkout */
  }
}

// ---------- Reporting ----------

// One purchase per order per page, whoever notices first (Snap's onSuccess
// or the check below); GA4 also de-duplicates on transaction_id and Meta on
// the event id — the same id as the webhook's Conversions API Purchase
// (api/midtrans/webhook.js).
// An order noticed more than Meta's matching window after its checkout (the
// payment came after that) goes to GA4 alone: Meta already has it from the
// webhook, and an unmatched second Purchase would count the sale twice.
const reported = new Set();
export function reportPurchase(uid, order) {
  try {
    if (!order?.orderId || reported.has(order.orderId)) return false;
    reported.add(order.orderId);
    const { item, metaParams } = checkoutParams(order);
    gaEvent("purchase", { transaction_id: order.orderId, currency: "IDR", value: order.amount, items: [item] });
    if (withinMetaDedup(order.at)) metaTrack("Purchase", metaParams, order.orderId);
    if (uid) writeOrders(uid, readOrders(uid).filter((o) => o.orderId !== order.orderId));
    return true;
  } catch {
    return false; // analytics must never break the app
  }
}

// The Wepeka hand-off carries a sign-in token in the fragment (#/sso?t=…);
// nothing is reported while it's there (main.js wipes it before signing in).
const tokenInUrl = () => location.hash.startsWith("#/sso");

let timer = null;
let lastCheckAt = 0;

// Asks the server once, now. Exported for the test; the app goes through
// checkPendingOrders below.
export async function runCheck(uid) {
  lastCheckAt = Date.now();
  try {
    const user = auth.currentUser;
    if (!user || user.uid !== uid || tokenInUrl()) return;
    const orders = readOrders(uid);
    if (!orders.length) return;
    const idToken = await user.getIdToken();
    const res = await fetch("/api/midtrans/order-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ orderIds: orders.map((o) => o.orderId) }),
    });
    if (!res.ok) return; // asked again on the next account change or boot
    const statuses = (await res.json())?.orders;
    if (!statuses || typeof statuses !== "object") return;
    if (auth.currentUser?.uid !== uid || tokenInUrl()) return;
    // Read again: Snap's onSuccess, or another tab, may have reported one
    // (or a new checkout may have started) while the server was answering.
    const { paid, keep } = settleOrders(readOrders(uid), statuses);
    paid.forEach((o) => reportPurchase(uid, o));
    writeOrders(uid, keep);
  } catch {
    /* offline, signed out meanwhile, …: asked again next time */
  }
}

// main.js calls this on every accounts/{uid} snapshot (the first one of a
// boot included) and never waits for it. Free when nothing is remembered:
// one localStorage read, no request.
export function checkPendingOrders(uid) {
  try {
    if (!uid || timer || !readOrders(uid).length) return;
    const wait = Math.max(CHECK_DELAY_MS, lastCheckAt + CHECK_GAP_MS - Date.now());
    timer = setTimeout(() => {
      timer = null;
      runCheck(uid);
    }, wait);
  } catch {
    /* analytics must never break the boot */
  }
}
