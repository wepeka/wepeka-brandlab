// Back from a payment made outside this tab.
//
// GoPay on a phone hands the buyer to the Gojek/GoPay app; the checkout
// asks Midtrans to send them back to the app's own address afterwards
// (api/_payments.js snapReturnParams), and Midtrans adds what happened to
// that address: ?order_id=…&result=success|failure from the Gojek app,
// ?order_id=…&status_code=…&transaction_status=… from its finish redirect.
//
// Nothing here unlocks anything — the plan only ever changes through the
// webhook. This reads the outcome once (so main.js can say the right thing:
// "setting up", "failed", or "sign in first" in a browser that isn't signed
// in) and takes those parameters out of the address bar at once: the order
// id contains the account's uid, and it has no business staying in the
// address, in history or in analytics.

const OURS = ["order_id", "result", "status_code", "transaction_status"];

// Pure (tests/pay-return.test.mjs): the outcome in a query string, and the
// query string without Midtrans's parameters. No order id = not a return.
export function parsePayReturn(search) {
  const params = new URLSearchParams(search || "");
  if (!params.get("order_id")) return { result: null, search: search || "" };
  const said = params.get("result");
  const status = params.get("transaction_status");
  const result = said === "success" || said === "failure" ? said
    : status === "settlement" || status === "capture" ? "success"
    : status === "deny" || status === "cancel" || status === "expire" || status === "failure" ? "failure"
    : "unknown";
  OURS.forEach((key) => params.delete(key));
  const rest = params.toString();
  return { result, search: rest ? `?${rest}` : "" };
}

// Once, at boot, before anything reads the address. "success" | "failure" |
// "unknown" (came back, outcome not said) | null (an ordinary visit).
export function consumePayReturn() {
  try {
    const { result, search } = parsePayReturn(location.search);
    if (result) history.replaceState(null, "", location.pathname + search + location.hash);
    return result;
  } catch {
    return null; // never in the way of the boot
  }
}
