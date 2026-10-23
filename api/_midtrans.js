// Server-side calls to Midtrans beyond opening Snap: transaction status (to
// read the saved card token after the first payment; whether an order has a
// transaction at all), cancelling an unused Snap checkout, and the
// Subscription API (auto-renew). The leading underscore keeps Vercel from
// exposing this as a route.
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const PROD = process.env.MIDTRANS_IS_PRODUCTION === "true";
const API = PROD ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
const SNAP = PROD ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
const basicAuth = (key) => "Basic " + Buffer.from(`${key}:`).toString("base64");

// Auto-renew is off until Midtrans has enabled recurring on the merchant
// account (production) — set MIDTRANS_RECURRING=true in Vercel after that.
export const RECURRING_ON = process.env.MIDTRANS_RECURRING === "true";

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: basicAuth(SERVER_KEY),
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

// Whether Midtrans has a transaction for an order: "none" (the buyer never
// picked a way to pay — Midtrans answers 404 "Transaction doesn't exist"),
// its transaction_status ("pending", "settlement", …), or null when it
// couldn't tell. Never throws.
export async function orderTransaction(orderId, { serverKey = SERVER_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!serverKey || !orderId) return null;
  try {
    const res = await fetchImpl(`${API}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: { Accept: "application/json", Authorization: basicAuth(serverKey) },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 || String(data?.status_code) === "404") return "none";
    return res.ok && data?.transaction_status ? String(data.transaction_status) : null;
  } catch {
    return null;
  }
}

// Ends a Snap checkout before its window does, so its token can't start a
// payment any more. Midtrans refuses ("Transaction is on progress") once
// the buyer has picked a way to pay. → { ok } (`already`: it was cancelled
// before) | { ok: false, error }. Never throws.
export async function cancelSnapToken(token, { serverKey = SERVER_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!serverKey || !/^[A-Za-z0-9-]{8,100}$/.test(String(token || ""))) return { ok: false, error: "no-token" };
  try {
    const res = await fetchImpl(`${SNAP}/snap/v1/transactions/${token}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: basicAuth(serverKey) },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.canceled_at) return { ok: true };
    const reason = [data?.error_messages, data?.status_message, data?.message].flat().filter(Boolean).join("; ") || `HTTP ${res.status}`;
    if (/already cancel/i.test(reason)) return { ok: true, already: true };
    return { ok: false, error: reason };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}

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
