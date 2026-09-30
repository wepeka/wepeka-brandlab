// Who may pay online right now. Until Midtrans approves the production
// account, Snap runs on SANDBOX keys — where Midtrans's public test cards
// "pay" — so a sandbox checkout open to everyone would hand out real plans
// for free. Owner's decision (2026-10-01): while MIDTRANS_IS_PRODUCTION is not
// "true", online checkout is closed to everyone except Wepeka's own team and
// the demo accounts the Midtrans reviewer uses to approve the production
// account; everyone else is sent to WhatsApp (js/views/pricing.js).
//
// Going live = set MIDTRANS_IS_PRODUCTION=true, MIDTRANS_SERVER_KEY and
// MIDTRANS_CLIENT_KEY (production values) in Vercel, then redeploy. No code
// change: the browser reads the mode and client key from
// create-transaction.js's `statusOnly` answer.
import { isAdminUid } from "./_aiQuota.js";

export const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";

// The sandbox client key the app has always used — only a fallback for when
// MIDTRANS_CLIENT_KEY isn't set (client keys are public by design).
const SANDBOX_CLIENT_KEY = "Mid-client-EVWF2l7q9QOMVSjO";
export const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || (MIDTRANS_IS_PRODUCTION ? "" : SANDBOX_CLIENT_KEY);

// Demo accounts from the Midtrans onboarding document (25 Sep) — they must
// keep a working sandbox checkout or the reviewer can't approve production.
// More can be added without a deploy of this file via MIDTRANS_TESTER_EMAILS
// (comma-separated).
const TESTER_EMAILS = new Set([
  "brandlab.reviewer.midtrans@gmail.com",
  "wepeka.cobabrandlab@gmail.com",
  ...String(process.env.MIDTRANS_TESTER_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
]);

export function isPaymentTester(uid, account) {
  return isAdminUid(uid) || TESTER_EMAILS.has(String(account?.email || "").trim().toLowerCase());
}

export function paymentsOpenFor(uid, account) {
  return MIDTRANS_IS_PRODUCTION || isPaymentTester(uid, account);
}

// Card payments Midtrans flags for review ("challenge") are not paid yet —
// only an explicit accept (or no fraud check at all, e.g. bank transfer).
export function isSettled(transactionStatus, fraudStatus) {
  return ["capture", "settlement"].includes(transactionStatus) && (fraudStatus == null || fraudStatus === "accept");
}
