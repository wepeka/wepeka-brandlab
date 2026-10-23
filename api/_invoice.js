// What an invoice needs beyond the order itself: its number, when it was
// paid in Indonesian words, and how it was paid. Pure (no Firestore, no
// fetch), tested in tests/invoice.test.mjs. api/_community.js lays the email
// out (composePaidEmail) and api/midtrans/webhook.js sends it.
const JAKARTA = "Asia/Jakarta";

// INV-<day it was paid, WIB>-<tail of the order id>. An order id ends in its
// creation time in base36 ("bl-<uid>-<time>", create-transaction.js), so the
// number is the same every time it's worked out for the same order — a
// retried notification or a resend never issues a second one.
export function invoiceNumber(orderId, paidAt = Date.now()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(paidAt)).replace(/\D/g, "");
  const tail = String(orderId || "").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "BRANDLAB";
  return `INV-${day}-${tail}`;
}

// "11.37" (WIB; the minutes are cut, never rounded up)
export const wibClock = (ms = Date.now()) => new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)).replace(":", ".");

// "13 Oktober 2026, 11.37 WIB"
export function paidAtLabel(paidAt = Date.now()) {
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: JAKARTA, day: "numeric", month: "long", year: "numeric" }).format(new Date(paidAt));
  return `${date}, ${wibClock(paidAt)} WIB`;
}

const BANKS = { bca: "BCA", bni: "BNI", bri: "BRI", mandiri: "Mandiri", permata: "Permata", cimb: "CIMB Niaga", bsi: "BSI", danamon: "Danamon", seabank: "SeaBank", mega: "Mega", maybank: "Maybank" };
const WALLETS = { gopay: "GoPay", qris: "QRIS", shopeepay: "ShopeePay", dana: "DANA", ovo: "OVO", akulaku: "Akulaku PayLater", kredivo: "Kredivo" };
const STORES = { indomaret: "Indomaret", alfamart: "Alfamart" };

// How the order was paid, read off Midtrans's notification. Those fields
// travel unsigned (only order_id/status_code/gross_amount are covered by the
// signature), so nothing is echoed back: a value we don't know gives the
// plain kind of payment, or "" — and the invoice then leaves the row out.
export function paymentMethodLabel(n = {}) {
  const type = String(n?.payment_type || "").toLowerCase();
  const bank = BANKS[String(n?.va_numbers?.[0]?.bank || n?.bank || (n?.permata_va_number ? "permata" : "")).toLowerCase()] || "";
  if (type === "bank_transfer") return bank ? `Transfer bank ${bank} (virtual account)` : "Transfer bank (virtual account)";
  if (type === "echannel") return "Mandiri Bill Payment";
  if (type === "credit_card") return bank ? `Kartu kredit/debit (${bank})` : "Kartu kredit/debit";
  if (type === "cstore") return STORES[String(n?.store || "").toLowerCase()] || "Gerai retail";
  return WALLETS[type] || "";
}
