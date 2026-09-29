// Server-side calls to Midtrans beyond Snap: transaction status (to read the
// saved card token after the first payment) and the Subscription API (auto-
// renew). The leading underscore keeps Vercel from exposing this as a route.
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const PROD = process.env.MIDTRANS_IS_PRODUCTION === "true";
const API = PROD ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";

// Auto-renew is off until Midtrans has enabled recurring on the merchant
// account (production) — set MIDTRANS_RECURRING=true in Vercel after that.
export const RECURRING_ON = process.env.MIDTRANS_RECURRING === "true";

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Basic " + Buffer.from(`${SERVER_KEY}:`).toString("base64"),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = Array.isArray(data?.validation_messages) ? data.validation_messages.join("; ") : data?.status_message || `HTTP ${res.status}`;
    throw new Error(`Midtrans ${method} ${path}: ${reason}`);
  }
  return data;
}

export const transactionStatus = (orderId) => call("GET", `/v2/${encodeURIComponent(orderId)}/status`);

// "YYYY-MM-DD HH:MM:SS +0700" in Jakarta time, the format Midtrans wants.
export function midtransTime(ms) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0700`;
}

// Charges the saved card `amount` every `intervalMonths`, first on `startAt`.
// No retries beyond Midtrans's default (3, hourly); a card that keeps
// failing just lets the account run out like a manual payer's would.
export function createSubscription({ name, amount, token, startAt, intervalMonths, email }) {
  return call("POST", "/v1/subscriptions", {
    name,
    amount: String(amount),
    currency: "IDR",
    payment_type: "credit_card",
    token,
    schedule: { interval: intervalMonths, interval_unit: "month", start_time: midtransTime(startAt) },
    ...(email ? { customer_details: { email } } : {}),
  });
}

export const disableSubscription = (id) => call("POST", `/v1/subscriptions/${encodeURIComponent(id)}/disable`);
