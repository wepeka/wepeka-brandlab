// Pricing page. Three audiences land here:
//  - Logged-out visitors (no `opts.user`) — the plans inside the front page
//    (js/views/landing.js renders this module with `opts.embed`); every CTA
//    sends them to wepeka.com (WEPEKA_CONNECT_URL) instead of paying
//    directly — account creation and the 30-day trial claim both happen
//    there now (Fase 2 of .claude/handoff-satu-akun.md), never on Brandlab.
//    A plan's buy button carries its plan along (site-links.js buyUrl), so
//    the checkout opens by itself once they are back here signed in
//    (js/buy-intent.js) — no trial to claim first, no second click.
//  - Logged-in accounts with no running access (`opts.locked`, from
//    main.js's onAccountChange: state "none" or "expired") — an ended
//    trial, a lapsed subscription, or a Firebase user who's never claimed a
//    trial at all. There is no read-only in-app browsing anymore; this
//    screen (with a banner explaining which of those it is) IS what they
//    see instead of the app. Same content plus a "logged in as X" bar, and
//    Buy buttons that pay for real via Midtrans Snap.
//  - Paying/trial accounts that want to switch or add a plan.
// Payment goes through this repo's own `/api/midtrans/*` Vercel serverless
// functions (see api/_plans.js for the authoritative price list) since
// price + "did this actually get paid" can never be trusted to client-side
// JS alone — the amounts below are for display only.
//
// The page asks one question — "after the trial, how do you want to
// continue?" — and offers two answers side by side: a subscription (one
// card, size and period as toggles) or Founder Lifetime (pay once, join the
// Founder Circle). Agency-sized plans sit behind a collapsed row so a
// one-brand owner never sees a Rp 1jt+ number; add-ons only appear for
// accounts that already pay (they're a second decision, not a first one).
//
// Only sell what exists (audited against the source): no one-click IG/FB
// import, no white-label PDF — the Brand Book PDF carries Wepeka's mark.
import { gaEvent } from "../analytics.js";
import { metaTrack } from "../meta-pixel.js";
import { checkoutParams, rememberOrder, reportPurchase } from "../pending-orders.js";
import { icon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { logout } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { WEPEKA_CONNECT_URL, WEPEKA_SITE_URL, SUPPORT_WA_NUMBER, COMMUNITY_WA_GROUP_URL, AI_TOPUPS, AI_UNLIMITED, BRAND_ADDONS, buyUrl } from "../site-links.js";
import { takeBuyIntent } from "../buy-intent.js";
import { readPromo, readPromoInfo, rememberPromo, forgetPromo, checkPromo } from "../promo-code.js";
import { agreeLine, guaranteeLink } from "../legal-links.js";
import { showPayLoading, hidePayLoading, hidePayLoadingWhenSnapShows } from "../pay-loading.js";
// Firestore loads on demand (js/firebase.js loadFirestore): this page is
// the logged-out landing, and it paints before the SDK is even fetched.
import { db as fdb, auth, loadFirestore } from "../firebase.js";
import { isTrial, trialDaysLeft, TRIAL_DAYS, accessState, getCachedAccount } from "../account.js";
import { takePricingBrands } from "../pricing-pick.js";
import { localNumber } from "../upgrade-doors.js";

// Rupiah amounts with the thousands separator of the current language
// (Rp 300.000 in ID, Rp 300,000 in EN).
const rp = (n) => `Rp ${n.toLocaleString(getLang() === "en" ? "en-US" : "id-ID")}`;

const PAYMENT_WA_NUMBER = SUPPORT_WA_NUMBER;

// Whether this account may pay online, in which Midtrans mode and with which
// client key all come from the server (api/_payments.js, via
// create-transaction's `statusOnly`), so going live with Midtrans is an env
// change in Vercel, never a code change here. Until then checkout is closed
// to customers and every buy button says "Segera hadir" instead. Anything
// unexpected reads as closed.
async function paymentStatus(planKey) {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/midtrans/create-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ planKey, statusOnly: true }),
    });
    return res.ok ? await res.json() : { open: false };
  } catch {
    return { open: false };
  }
}

let snapScriptPromise = null;
function loadSnap({ production, clientKey }) {
  if (window.snap) return Promise.resolve();
  if (!snapScriptPromise) {
    snapScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = production ? "https://app.midtrans.com/snap/snap.js" : "https://app.sandbox.midtrans.com/snap/snap.js";
      script.setAttribute("data-client-key", clientKey);
      script.onload = resolve;
      script.onerror = () => reject(new Error(t("pricing.err.loadSnap")));
      document.head.appendChild(script);
    });
  }
  return snapScriptPromise;
}

// The "payment opens soon" note under the hero, per visitor: a guest or an
// account that never claimed a trial is pointed at the trial; an account
// whose trial/plan ended (locked out of the app, audit-1005) is told what
// still works — never "your access keeps running"; everyone else keeps
// their running plan or trial until it ends.
export function closedNoteKey(uid, account) {
  if (!uid) return "pricing.closed.noteGuest";
  const state = accessState(account);
  if (state === "expired") return "pricing.closed.noteLocked";
  if (state === "none") return "pricing.closed.noteGuest";
  return "pricing.closed.note";
}

// Checkout closed: every purchase happens on this site, so until online
// payment opens a buy button only says it's coming — no WhatsApp order.
// A locked-out account also hears, gently, that its data is safe.
async function showPaymentsClosed() {
  const { openModal, closeOverlay } = await import("../modals.js");
  const locked = accessState(getCachedAccount()) === "expired";
  openModal({
    title: t("pricing.closed.soonTitle"),
    bodyHTML: `<p style="margin:0;">${t("pricing.closed.body")}</p>${locked ? `<p style="margin:10px 0 0;">${t("pricing.closed.lockedSafe")}</p>` : ""}`,
    footHTML: `<button type="button" class="btn btn-primary" data-soon-ok>${t("common.close")}</button>`,
    onMount: (overlay) => overlay.querySelector("[data-soon-ok]").addEventListener("click", () => closeOverlay(overlay)),
  });
}

// planKey here matches accounts/{uid}.plan values on the server side (see
// api/midtrans/create-transaction.js's PRICES map) — the price itself is
// looked up server-side from planKey, never trusted from this call.
// `onSuccess` lets a caller outside this page (the Brand Book style picker)
// react once Snap reports success; the unlock itself still only ever comes
// from the webhook. `successToast: false` for a caller that says it its own
// way (this page's full-screen "setting up", enterAppWhenPaid).
let payStarting = false;
export async function payPlan(planKey, uid, { onSuccess, successToast = true } = {}) {
  if (!uid) {
    toast(t("pricing.err.needLogin"), "error");
    location.hash = "#/login";
    return;
  }
  // One checkout at a time: a double click must not open two (and hold two
  // Founder seats).
  if (payStarting) return;
  payStarting = true;
  // Up from the click until Midtrans's own window is there, so the wait
  // reads as "working on it" (js/pay-loading.js). Every way out below takes
  // it down.
  showPayLoading();
  let snapOpening = false;
  try {
    // The server derives uid from this token (Authorization header), never
    // from the request body — see api/midtrans/create-transaction.js.
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      toast(t("pricing.err.needLogin"), "error");
      location.hash = "#/login";
      return;
    }
    const status = await paymentStatus(planKey);
    // A plan this account can't buy at all (anything on top of a Lifetime
    // plan, a second queued downgrade) is said before "coming soon" or any
    // payment is offered.
    if (status.refused) {
      hidePayLoading();
      await showRefused(status.refused, planKey);
      return;
    }
    if (!status.open) {
      hidePayLoading();
      await showPaymentsClosed();
      return;
    }
    await loadSnap(status);
    // Switching plans while one still runs: say what happens to the old
    // one (credit now, or queued until it ends) before any payment opens.
    const confirmed = await confirmPlanSwitch(planKey, idToken);
    if (!confirmed) return;
    showPayLoading(); // back up if that question took it down
    const res = await fetch("/api/midtrans/create-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      // A Wepeka Community code kept from the Founder's Deal page or the
      // field below the plans (js/promo-code.js): the server applies it
      // where it is valid and ignores it everywhere else.
      body: JSON.stringify({ planKey, ...confirmed, ...(readPromo() ? { promo: readPromo() } : {}) }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t("pricing.err.createTx"));
    const { token, orderId, amount, label, promo } = await res.json();
    if (promo?.off) toast(t("pricing.promo.applied", { code: promo.code, off: rp(promo.off) }));
    const order = { orderId, planKey, amount, label };
    const { item, metaParams } = checkoutParams(order);
    // Remembered until its purchase is reported: a transfer paid after Snap
    // closes never reaches onSuccess below (js/pending-orders.js).
    rememberOrder(uid, order);
    gaEvent("begin_checkout", { currency: "IDR", value: amount, items: [item] });
    metaTrack("InitiateCheckout", metaParams, `ic-${orderId}`);
    let answered = false;
    window.snap.pay(token, {
      onSuccess: () => {
        answered = true;
        // GA4 purchase + Meta Purchase, with the same event id as the
        // webhook's Conversions API Purchase (api/midtrans/webhook.js).
        reportPurchase(uid, order);
        if (promo) forgetPromo();
        if (successToast) toast(t("pricing.pay.success"));
        onSuccess?.();
      },
      onPending: () => { answered = true; toast(t("pricing.pay.pending")); showPendingHelp("snap"); },
      onError: () => toast(t("pricing.pay.error"), "error"),
      // Closed without paying, often because the buyer's bank isn't in the
      // list: say which way is left.
      onClose: () => { if (!answered) showBankHelp(label); },
    });
    snapOpening = true;
    hidePayLoadingWhenSnapShows();
    // A checkout is open: have the congratulations page (js/pay-thanks.js)
    // downloaded by the time the payment lands.
    if (isPlanKey(planKey)) import("../pay-thanks.js").catch(() => {});
  } catch (err) {
    toast(err.message || t("pricing.err.start"), "error");
  } finally {
    payStarting = false;
    if (!snapOpening) hidePayLoading();
  }
}

// Plans replace each other, never stack (api/_plans.js switchQuote): an
// upgrade starts today with the unused part of the old period off the
// price; a downgrade waits until the current period ends. Add-ons and a
// plain renewal go straight to payment.
const PLAN_NAME_KEYS = ["starter", "pro", "studio", "founder", "founder-ultimate"];
// Exact key first: "founder-ultimate" also starts with "founder-".
const planNameOf = (key) => t(`pricing.planName.${PLAN_NAME_KEYS.find((p) => key === p) || PLAN_NAME_KEYS.find((p) => key.startsWith(`${p}-`)) || "starter"}`);
const isPlanKey = (planKey) => PLAN_NAME_KEYS.some((p) => planKey === p || (planKey.startsWith(`${p}-`) && /-(monthly|yearly)$/.test(planKey)));
const accountPlanKey = (plan, billing) => (["starter", "pro", "studio"].includes(plan) ? `${plan}-${billing || "monthly"}` : plan);
const longDate = (ms) => (ms ? new Date(ms).toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric" }) : "");

// A plan the server won't sell this account (create-transaction's `code`):
// its own words, plus the WhatsApp route where the team sorts it out by hand.
async function showRefused(refusal, planKey) {
  const known = ["lifetime-owned", "lifetime-top", "lifetime-manual", "scheduled"].includes(refusal?.code);
  const text = known ? t(`pricing.refused.${refusal.code}`, { date: longDate(refusal.startsAt) }) : escapeHtml(refusal?.error || t("pricing.err.start"));
  const viaWa = ["lifetime-owned", "lifetime-manual"].includes(refusal?.code);
  const wa = `https://wa.me/${PAYMENT_WA_NUMBER}?text=${encodeURIComponent(t("pricing.refused.waMessage", { item: planNameOf(planKey), email: auth.currentUser?.email || "-" }))}`;
  const { openModal } = await import("../modals.js");
  openModal({
    title: t("pricing.refused.title"),
    bodyHTML: `
      <p style="margin:0 0 16px;">${text}</p>
      ${viaWa ? `<a class="btn btn-primary btn-block" href="${wa}" target="_blank" rel="noopener noreferrer">${icon("chat", { size: 15 })}${t("pricing.pending.wa")}</a>` : ""}`,
  });
}

// Says what a plan purchase does to the plan already running before Snap
// opens. Resolves to what create-transaction needs along with the planKey
// ({} when there's nothing to confirm), or null when the buyer backs out or
// the server refuses. Unused value the new price can't absorb is spelled
// out and needs its own explicit OK (`acceptForfeit`, audit S-23).
async function confirmPlanSwitch(planKey, idToken) {
  const account = getCachedAccount();
  // Nothing running to switch from (trial, lapsed): just buy.
  if (!isPlanKey(planKey) || accessState(account) !== "paid") return {};
  const res = await fetch("/api/midtrans/create-transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ planKey, quoteOnly: true }),
  });
  const q = await res.json().catch(() => null);
  if (!res.ok) {
    if (q?.code) {
      hidePayLoading();
      await showRefused(q, planKey);
      return null;
    }
    throw new Error(q?.error || t("pricing.err.createTx"));
  }
  const next = account.scheduledPlan?.plan ? planNameOf(accountPlanKey(account.scheduledPlan.plan, account.scheduledPlan.billing)) : "";
  const vars = {
    from: planNameOf(accountPlanKey(account.plan, account.billing)), to: planNameOf(planKey), next,
    price: rp(q.price), credit: rp(q.credit || 0), pay: rp(q.amount),
    forfeit: rp(q.forfeit || 0), value: rp((q.credit || 0) + (q.forfeit || 0)),
    date: longDate(q.startsAt || q.scheduledStartsAt),
  };
  let title;
  let message;
  if (q.mode === "now" && q.lifetimeUpgrade) {
    title = t("pricing.switch.lifetimeTitle", vars);
    message = t("pricing.switch.lifetimeBody", vars);
  } else if (q.mode === "now") {
    title = t("pricing.switch.upTitle", vars);
    message = t(q.credit ? "pricing.switch.upBody" : "pricing.switch.upBodyNoCredit", vars);
    if (q.replacesScheduled && next) message += ` ${t("pricing.switch.scheduledNote", vars)}`;
  } else if (q.mode === "later") {
    title = t("pricing.switch.downTitle", vars);
    message = t("pricing.switch.downBody", vars);
  } else if (q.mode === "renew" && q.scheduledStartsAt && next) {
    title = t("pricing.switch.renewTitle", vars);
    message = t("pricing.switch.renewBody", vars);
  } else {
    return {};
  }
  if (q.forfeit) message += `<br><br><b>${t("pricing.switch.forfeitNote", vars)}</b>`;
  const { confirmDialog } = await import("../modals.js");
  hidePayLoading();
  const ok = await confirmDialog({ title, message, confirmLabel: t(q.forfeit ? "pricing.switch.payForfeit" : "pricing.switch.pay", vars), danger: !!q.forfeit });
  return ok ? { acceptForfeit: !!q.forfeit } : null;
}

// After Snap reports success on the pricing page itself: wait for the
// webhook to flip accounts/{uid} to a paid state (main.js's onAccountChange
// re-boots and refreshes the cache), then step into the app — a brand-new
// buyer lands on the congratulations page, then the mode picker + first-run
// flow exactly like a fresh account. The wait is the full-screen "setting
// up" sheet (js/pay-loading.js), not this page with a toast on it: someone
// who has just paid shouldn't be looking at prices (owner, 2026-10-13).
function enterAppWhenPaid() {
  showPayLoading("pricing.pay.settingUp", "pricing.pay.settingUpNote");
  const startedAt = Date.now();
  const tick = () => {
    if (accessState(getCachedAccount()) === "paid") {
      hidePayLoading();
      // main.js has usually left the plans already (leavePlansIfThanksDue).
      if (location.hash.startsWith("#/pricing")) location.hash = "#/";
      return;
    }
    if (Date.now() - startedAt > 90_000) {
      hidePayLoading();
      toast(t("pricing.pay.pending"));
      showPendingHelp("slow");
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

// Display mirror of api/_plans.js + js/ai-usage.js's PLAN_QUOTA — keep in
// sync. planKey sent to the server is `${key}-${billing}` for subscriptions.
// The two owner sizes share one card ("1 brand" / "3 brand" toggle); the
// tier names Starter/Pro never appear on screen.
const SUBSCRIPTIONS = {
  1: { key: "starter", monthly: 49000, yearly: 399000, brands: 1, credits: 20 },
  3: { key: "pro", monthly: 99000, yearly: 799000, brands: 3, credits: 100 },
};
const STUDIO = { key: "studio", monthly: 249000, yearly: 1990000, brands: 10, credits: 200 };

// Two waves inside the same 50 slots (api/_plans.js FOUNDER_TIERS — keep in
// sync). The page never shows how many are sold, only which wave is open.
const FOUNDER = { key: "founder", slotField: "founderSlotsSold", tiers: [{ upTo: 15, people: 15, price: 499000 }, { upTo: 50, people: 35, price: 599000 }], brands: 3, credits: 100, features: ["proForever", "contentDayForever", "upcoming", "bookStyles", "circle", "review", "badge"] };
const AGENCY = { key: "founder-ultimate", slotField: "founderUltimateSlotsSold", price: 799000, brands: 15, credits: 100 };
// Hard caps, mirrored from api/_plans.js SLOT_CAPS.
const FOUNDER_SLOT_CAPS = { founderSlotsSold: 50, founderUltimateSlotsSold: 15 };
// What the three premium Brand Book styles cost bought one by one
// (api/_plans.js BOOK_STYLE_ADDONS) — the bundle line on the Founder card.
const BOOK_STYLES_VALUE = 3 * 20000;

// Lifetime's normal price — what Lifetime costs once the Founder waves are
// gone (owner's decision, 2026-09-28). Shown struck through above the
// Founder price as the page's anchor, and stated as a fact in the Founder
// note and the "slots" FAQ, so it must stay TRUE: if the post-Founder price
// ever changes, change it here. Keep wpk-dp src/lib/brandlab-plans.ts in step.
// 2026-10-12 (owner's decision): Rp 3.000.000 for the 3-brand Lifetime, and
// Rp 6.000.000 for the 15-brand one (Agency Lifetime) — wherever a Lifetime
// price shows, its normal price shows struck through next to it.
const LIFETIME_NORMAL_PRICE = 3000000;
const AGENCY_NORMAL_PRICE = 6000000;

// Every add-on is bought on the spot (`payKey` = api/_plans.js ADDONS, which
// sets the real price and re-checks who may buy it) by the accounts
// `forWho` names; anyone else sees it without a buy button.
const ADDONS = [
  { key: AI_UNLIMITED.key, price: AI_UNLIMITED.price, payKey: AI_UNLIMITED.payKey, per30: true, forWho: "paid" },
  ...AI_TOPUPS.map(({ key, price, payKey }) => ({ key, price, payKey, forWho: "paid" })),
  ...BRAND_ADDONS.sub.map(({ key, price, payKey }) => ({ key, price, payKey, per30: true, forWho: "paid" })),
  ...BRAND_ADDONS.lifetime.map(({ key, price, payKey, save }) => ({ key, price, payKey, save, forWho: "lifetime" })),
];
const ADDON_ELIGIBLE_PLANS = ["founder", "founder-ultimate", "lifetime"];
const SUBSCRIPTION_PLANS = ["starter", "pro", "studio"];
function canBuyAddon(a, account) {
  if (accessState(account) !== "paid") return false;
  if (a.forWho === "lifetime") return ADDON_ELIGIBLE_PLANS.includes(account?.plan);
  if (a.forWho === "subs") return SUBSCRIPTION_PLANS.includes(account?.plan);
  return true;
}

// Only the four questions that stand between "interested" and "paying";
// the rest (trial details, credits, the Circle) live on wepeka.com/brandlab.
const FAQ_KEYS = ["which", "slots", "cancel", "after"];

// A payment that's taking a while gets a card that stays on screen — what's
// happening, what to do, and a WhatsApp button — instead of one toast that
// vanishes and leaves "sudah bayar tapi kok belum masuk?" unanswered.
function showPendingHelp(kind) {
  const host = document.querySelector(".pricing-shell");
  if (!host) return;
  host.querySelector(".pricing-pending-help")?.remove();
  const wa = `https://wa.me/${PAYMENT_WA_NUMBER}?text=${encodeURIComponent(t("pricing.pending.waMessage"))}`;
  host.insertAdjacentHTML("afterbegin", `
    <div class="pricing-pending-help" role="status">
      <b>${t(kind === "snap" ? "pricing.pending.snapTitle" : "pricing.pending.slowTitle")}</b>
      <p>${t(kind === "snap" ? "pricing.pending.snapBody" : "pricing.pending.slowBody")}</p>
      <a class="btn btn-secondary btn-sm" href="${wa}" target="_blank" rel="noopener">${icon("chat", { size: 13 })}${t("pricing.pending.wa")}</a>
    </div>`);
  host.querySelector(".pricing-pending-help").scrollIntoView({ behavior: "smooth", block: "start" });
}

// BCA isn't among the banks Midtrans offers this account yet (owner's note,
// 2026-10-13): said under the plans and again when the payment window is
// closed without paying, with the admin's WhatsApp as the way to pay by BCA
// or anything else the window doesn't list.
function bankWaLink(email, item) {
  const text = t(email ? "pricing.bank.waMessage" : "pricing.bank.waMessageGuest", { item: item || "Wepeka Brandlab", email });
  return `https://wa.me/${PAYMENT_WA_NUMBER}?text=${encodeURIComponent(text)}`;
}
const bankNoteHTML = (email) => `<p class="pricing-trust pricing-bank-note">${icon("info", { size: 13 })}<span>${t("pricing.bank.note")} <a href="${bankWaLink(email)}" target="_blank" rel="noopener noreferrer">${t("pricing.bank.cta")}</a></span></p>`;
function showBankHelp(item) {
  const host = document.querySelector(".pricing-shell");
  // Not over a "waiting for your payment" card: that transfer has started.
  if (!host || host.querySelector(".pricing-pending-help:not(.pricing-bank-help):not(.pricing-closed-note)")) return;
  host.querySelector(".pricing-bank-help")?.remove();
  host.insertAdjacentHTML("afterbegin", `
    <div class="pricing-pending-help pricing-bank-help" role="status">
      <b>${t("pricing.bank.closedTitle")}</b>
      <p>${t("pricing.bank.note")}</p>
      <a class="btn btn-secondary btn-sm" href="${bankWaLink(auth.currentUser?.email, item)}" target="_blank" rel="noopener noreferrer">${icon("chat", { size: 13 })}${t("pricing.bank.cta")}</a>
    </div>`);
  host.querySelector(".pricing-bank-help").scrollIntoView({ behavior: "smooth", block: "start" });
}

function waLink(planName, price) {
  const text = encodeURIComponent(t("pricing.wa.message", { plan: planName, price }));
  return `https://wa.me/${PAYMENT_WA_NUMBER}?text=${text}`;
}

const check = () => icon("check", { size: 15 });
const featureVars = (plan, f) => (f === "bookStyles" ? { price: rp(BOOK_STYLES_VALUE) } : { n: /credit|content/i.test(f) ? plan.credits : plan.brands });
const featuresHTML = (plan) => plan.features.map((f) => `<li>${check()}<span>${t(`pricing.f.${f}`, featureVars(plan, f))}</span></li>`).join("");

// Logged in → pay for real. Logged out → wepeka.com (register or log in
// there, then SSO back here already signed in) with the plan riding along,
// so its checkout opens the moment they are back (js/buy-intent.js).
function ctaHTML(planKey, label, uid, cls = "btn-secondary") {
  const classes = `btn ${cls} btn-block pricing-cta`;
  return uid
    ? `<button type="button" class="${classes}" data-pay="${planKey}">${label}</button>`
    : `<a class="${classes}" data-plan="${planKey}" href="${buyUrl(planKey)}">${label}</a>`;
}
const soldOutHTML = (cls = "btn-primary") => `<button type="button" class="btn ${cls} btn-block pricing-cta" disabled>${t("pricing.soldOut")}</button>`;
const disabledCtaHTML = (label, cls = "btn-secondary") => `<button type="button" class="btn ${cls} btn-block pricing-cta" disabled>${label}</button>`;

// A Lifetime account never buys another plan on top (api/_plans.js
// switchQuote refuses it; audit S-15) — its cards say so instead of
// offering a checkout. The one way up left is Founder → Agency Lifetime,
// for the difference. "legacy" = the pre-subscription all-in-one Lifetime.
const LIFETIME_PLAN_KEYS = ["founder", "founder-ultimate", "lifetime"];
function ownedLifetime(account) {
  const plan = account?.plan;
  if (!LIFETIME_PLAN_KEYS.includes(plan)) return null;
  return plan === "founder" ? "founder" : plan === "founder-ultimate" ? "agency" : "legacy";
}
// The note also opens the Komunitas sheet (js/community.js): the Lifetime
// group, the general group and the two accounts to follow. Someone who paid
// from another app (GoPay) comes back to this page, and "you're Lifetime"
// without the way into the group read as a dead end (owner, 2026-10-13).
function ownedNoteHTML(owned) {
  return `
    <div class="pricing-pending-help pricing-closed-note" role="status">
      <b>${t("pricing.owned.title")}</b>
      <p>${t(`pricing.owned.${owned}`)}</p>
      <button type="button" class="btn btn-secondary btn-sm" data-open-community>${icon("users", { size: 13 })}${t("pricing.owned.community")}</button>
    </div>`;
}

// Index of the wave currently on sale, from the live sold-count. Unknown
// count (still loading / read failed) shows the first wave — the amount
// actually charged is decided server-side either way.
// Seats gone = sold + held by a checkout still open (meta/founderSlots
// .holds, api/_plans.js seatsTaken — keep in sync): a held seat is priced
// and capped like a sold one until its Snap window closes (audit S-17).
export function seatsTakenOf(slots, field, now = Date.now(), exceptKey = null) {
  const held = Object.entries(slots?.holds?.[field] || {}).filter(([key, until]) => key !== exceptKey && Number(until) > now).length;
  return (Number(slots?.[field]) || 0) + held;
}

// The viewer's own hold key — the same opaque key as api/_plans.js
// holdKeyFor — so their own open checkout never counts against them (the
// server skips it too): no false "sold out" or second-wave price after they
// close Snap at the last seat or the last first-wave seat.
export async function holdKeyOf(uid) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`brandlab-seat:${uid}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function openTier(sold) {
  const i = FOUNDER.tiers.findIndex((tier) => (sold || 0) < tier.upTo);
  return i === -1 ? FOUNDER.tiers.length : i;
}

function tiersHTML(open) {
  return `<div class="pricing-tiers">${FOUNDER.tiers.map((tier, i) => {
    const state = i < open ? "is-gone" : i === open ? "is-open" : "is-next";
    return `
      <div class="pricing-tier ${state}">
        <span class="pricing-tier-who">${t(i === 0 ? "pricing.tier.first" : "pricing.tier.next", { n: tier.people })}</span>
        <strong>${rp(tier.price)}</strong>
        <span class="pricing-tier-state">${t(`pricing.tier.${state}`)}</span>
      </div>`;
  }).join("")}</div>`;
}

function segHTML(name, options) {
  return `<div class="pricing-seg" role="group">${options
    .map((o) => `<button type="button" class="pricing-seg-btn ${o.on ? "is-on" : ""}" data-seg="${name}" data-value="${o.value}" aria-pressed="${o.on}">${o.label}</button>`)
    .join("")}</div>`;
}

// One card for both owner sizes: the toggles pick starter/pro and
// monthly/yearly; the planKey follows.
function subscriptionCardHTML(sel, uid, owned) {
  const plan = SUBSCRIPTIONS[sel.brands];
  const price = sel.yearly ? plan.yearly : plan.monthly;
  const planKey = `${plan.key}-${sel.yearly ? "yearly" : "monthly"}`;
  return `
    <div class="pricing-way">
      <div class="pricing-way-top"><span class="pricing-pill">${t("pricing.sub.badge")}</span></div>
      <h3 class="pricing-way-title">${t("pricing.way.subscription")}</h3>
      <div class="pricing-price-row"><span class="pricing-price">${rp(price)}</span><span class="pricing-per">${t(sel.yearly ? "pricing.perYearShort" : "pricing.perMonthShort")}</span></div>
      <p class="pricing-price-note">${sel.yearly ? t("pricing.sub.yearlySave", { amount: rp(plan.monthly * 12 - plan.yearly) }) : t(`pricing.sub.anchor.${plan.key}`)}</p>
      ${segHTML("brands", [
        { value: 1, label: t("pricing.f.brands1"), on: sel.brands === 1 },
        { value: 3, label: t("pricing.f.brands", { n: 3 }), on: sel.brands === 3 },
      ])}
      ${segHTML("period", [
        { value: "monthly", label: t("pricing.period.monthly"), on: !sel.yearly },
        { value: "yearly", label: t("pricing.period.yearly"), on: sel.yearly },
      ])}
      <p class="pricing-way-credits">${t("pricing.f.contentDay", { n: plan.credits })}</p>
      ${owned ? disabledCtaHTML(t("pricing.owned.notNeeded")) : ctaHTML(planKey, t("pricing.way.subscription.cta"), uid)}
    </div>`;
}

// The card the page exists for: normal price struck through, the Founder
// price the next buyer actually pays, the two waves, what's included, and
// one pink button — mirroring wepeka.com/brandlab's Founder card.
function founderCardHTML({ open, tier, soldOut }, uid, owned) {
  const cap = FOUNDER_SLOT_CAPS[FOUNDER.slotField];
  const savePct = Math.round((1 - tier.price / LIFETIME_NORMAL_PRICE) * 100);
  return `
    <div class="pricing-way is-win">
      <span class="pricing-way-glow" aria-hidden="true"></span>
      <div class="pricing-way-top">
        <span class="pricing-pill pricing-pill--pink">${icon("sparkle", { size: 12 })}${t("pricing.founder.pill", { cap })}</span>
      </div>
      <h3 class="pricing-way-title">${t("pricing.way.lifetime")}</h3>
      <p class="pricing-anchor"><s>${t("pricing.lifetime.normal", { price: rp(LIFETIME_NORMAL_PRICE) })}</s>${soldOut ? "" : `<span class="pricing-save">${t("pricing.lifetime.save", { pct: savePct })}</span>`}</p>
      <div class="pricing-price-row"><span class="pricing-price">${rp(tier.price)}</span><span class="pricing-per">${t("pricing.payOnce")}</span></div>
      <p class="pricing-price-note">${t("pricing.lifetime.normalNote", { cap, price: rp(LIFETIME_NORMAL_PRICE) })}</p>
      ${tiersHTML(open)}
      <ul class="pricing-features pricing-features--2col">${featuresHTML(FOUNDER)}</ul>
      ${owned ? disabledCtaHTML(t(owned === "founder" ? "pricing.owned.current" : "pricing.owned.included"), "btn-primary") : soldOut ? soldOutHTML() : ctaHTML(FOUNDER.key, `${t("pricing.founder.cta")}${icon("arrowRight", { size: 16 })}`, uid, "btn-primary pricing-cta--pink")}
      ${owned || soldOut ? "" : guaranteeHTML()}
    </div>`;
}

// The 14-day money-back guarantee on Lifetime plans (wepeka.com terms #garansi).
const guaranteeHTML = () => `<p class="pricing-guarantee">${icon("shield", { size: 14 })}<span>${t("pricing.lifetime.guarantee", { terms: guaranteeLink() })}</span></p>`;

// The Wepeka Community code (api/_promo.js): a line saying it is on, or a
// folded field to type one in, with where to get it (the community's
// WhatsApp group description). Lifetime plans only — the server decides.
function promoHTML() {
  const kept = readPromoInfo();
  if (kept) {
    return `
      <div class="pricing-promo is-on" data-promo>
        <p>${icon("check", { size: 14 })}<span>${kept.off ? t("pricing.promo.on", { code: kept.code, off: rp(kept.off) }) : t("pricing.promo.onNoAmount", { code: kept.code })}</span>
        <button type="button" class="pricing-promo-remove" data-promo-remove>${t("pricing.promo.remove")}</button></p>
      </div>`;
  }
  return `
    <details class="pricing-promo" data-promo>
      <summary>${icon("sparkle", { size: 13 })}${t("pricing.promo.ask")}${icon("chevronDown", { size: 15 })}</summary>
      <form class="pricing-promo-form" data-promo-form novalidate>
        <input name="promo" class="input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="${t("pricing.promo.placeholder")}" aria-label="${t("pricing.promo.placeholder")}">
        <button type="submit" class="btn btn-secondary btn-sm">${t("pricing.promo.apply")}</button>
      </form>
      <p class="pricing-promo-msg" data-promo-msg role="status" aria-live="polite"></p>
      <p class="pricing-promo-where">${t("pricing.promo.where")} <a href="${COMMUNITY_WA_GROUP_URL}" target="_blank" rel="noopener noreferrer">${t("pricing.promo.join")}</a></p>
    </details>`;
}

function wirePromo(root, repaint) {
  qs("[data-promo-remove]", root)?.addEventListener("click", () => { forgetPromo(); repaint(); });
  const form = qs("[data-promo-form]", root);
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.elements.promo;
    const msg = qs("[data-promo-msg]", root);
    const btn = form.querySelector("button");
    if (!input.value.trim()) { input.focus(); return; }
    btn.disabled = true;
    msg.textContent = t("pricing.promo.checking");
    try {
      const r = await checkPromo(input.value);
      if (!r.ok) { msg.textContent = t("pricing.promo.bad"); return; }
      rememberPromo(r.code, Date.now(), r.off.founder || r.off["founder-ultimate"] || 0);
      repaint();
    } catch {
      msg.textContent = t("pricing.promo.error");
    } finally {
      btn.disabled = false;
    }
  });
}

function otherPlanHTML(plan, uid, owned) {
  const name = t(`pricing.${plan.key}.name`);
  return `
    <div class="pricing-other-row">
      <div class="pricing-other-info">
        <strong>${name}</strong>
        <span>${t(`pricing.${plan.key}.who`)}</span>
        <span class="pricing-other-meta">${t("pricing.f.brands", { n: plan.brands })} · ${t("pricing.f.contentDay", { n: plan.credits })}</span>
      </div>
      <div class="pricing-other-actions">
        ${owned
          ? disabledCtaHTML(t("pricing.owned.notNeeded"))
          : `${ctaHTML(`${plan.key}-monthly`, t("pricing.perMonth", { price: rp(plan.monthly) }), uid)}
        ${ctaHTML(`${plan.key}-yearly`, t("pricing.perYear", { price: rp(plan.yearly) }), uid)}`}
      </div>
    </div>`;
}

// Agency Lifetime's button: the upgrade (pay the difference) for a Founder,
// "your plan" for an Agency account, nothing to buy for the old Lifetime.
function agencyCtaHTML(uid, agencySoldOut, owned) {
  if (owned === "agency") return disabledCtaHTML(t("pricing.owned.current"));
  if (owned === "legacy") return disabledCtaHTML(t("pricing.owned.notNeeded"));
  if (agencySoldOut) return soldOutHTML("btn-secondary");
  if (owned === "founder") return ctaHTML(AGENCY.key, t("pricing.owned.upgrade"), uid, "btn-primary");
  return ctaHTML(AGENCY.key, `${rp(AGENCY.price)} · ${t("pricing.payOnce")}`, uid);
}

// Studio + Agency Lifetime, collapsed: a different buyer (people who run
// client brands), so their prices stay out of an owner's line of sight —
// open from the start for a Founder, whose one upgrade lives here.
function agencyHTML(uid, agencySoldOut, owned, open = false) {
  const perBrand = rp(Math.round(AGENCY.price / AGENCY.brands / 1000) * 1000);
  return `
    <details class="pricing-other" id="ultimate" ${owned === "founder" || open ? "open" : ""}>
      <summary>${t("pricing.agency.title")}${icon("chevronDown", { size: 16 })}</summary>
      ${otherPlanHTML(STUDIO, uid, owned)}
      <div class="pricing-other-row">
        <div class="pricing-other-info">
          <strong>${t("pricing.founder-ultimate.name")}</strong>
          <span>${t("pricing.ultimate.sub", { n: AGENCY.brands })}</span>
          <span class="pricing-other-meta">${t("pricing.f.brands", { n: AGENCY.brands })} · ${t("pricing.f.contentDay", { n: AGENCY.credits })} · ${t("pricing.ultimate.perBrand", { price: perBrand })} · ${t("pricing.ultimate.slots", { cap: FOUNDER_SLOT_CAPS[AGENCY.slotField] })}</span>
          ${agencySoldOut ? "" : `<span class="pricing-anchor"><s>${t("pricing.lifetime.normal", { price: rp(AGENCY_NORMAL_PRICE) })}</s><span class="pricing-save">${t("pricing.lifetime.save", { pct: Math.round((1 - AGENCY.price / AGENCY_NORMAL_PRICE) * 100) })}</span></span>`}
        </div>
        <div class="pricing-other-actions">
          ${agencyCtaHTML(uid, agencySoldOut, owned)}
        </div>
      </div>
      <p class="pricing-renew-note">${t("pricing.agency.note")}</p>
      ${agencySoldOut || owned ? "" : guaranteeHTML()}
    </details>`;
}

function accountBarHTML(user, account) {
  // Logged out: a visible way in, right at the top. A returning customer on
  // a new device lands here first, and "Sudah punya akun? Masuk" used to sit
  // only in the footer, below the FAQ (audit A-07).
  if (!user) {
    return `<div class="pricing-account-bar">
      <span>${t("pricing.alreadyHave")}</span>
      <a class="btn btn-primary btn-sm" href="#/login" id="pricing-login">${t("pricing.loginCta")}${icon("arrowRight", { size: 13 })}</a>
    </div>`;
  }
  let status = t("pricing.loggedInAs", { email: escapeHtml(user.email || "") });
  const state = accessState(account);
  if (state === "trial") {
    status += " " + t("pricing.status.trial", { days: trialDaysLeft(account) });
  } else if (state === "expired") {
    status += " " + (isTrial(account) ? t("pricing.status.trialEnded") : t("pricing.status.readonly"));
  } else if (state === "none") {
    status += " " + t("pricing.status.none");
  } else {
    // A plan's display name, never its internal key ("founder-ultimate").
    const plan = account?.plan;
    const name = PLAN_NAME_KEYS.includes(plan) ? t(`pricing.planName.${plan}`) : plan === "lifetime" ? "Lifetime" : "Brandlab";
    status += " " + t("pricing.status.plan", { plan: escapeHtml(name) });
  }
  return `<div class="pricing-account-bar">
      <span>${status}</span>
      <button type="button" class="btn btn-ghost btn-sm" id="pricing-logout">${icon("logout", { size: 13 })}${t("topbar.logout")}</button>
    </div>`;
}

// Shown only when main.js's onAccountChange rendered this screen because the
// account has no running access (state "none" or "expired") — a distinct,
// prominent banner above the marketing content explaining why they're here
// and what to do next, instead of leaving them to infer it from the account
// bar's one-line status alone.
function lockedBannerHTML(account) {
  const state = accessState(account);
  if (state === "none") {
    return `<section class="pricing-locked-banner">
      <h2>${t("pricing.locked.noneTitle")}</h2>
      <p>${t("pricing.locked.noneBody")}</p>
      <a class="btn btn-secondary pricing-cta" href="${WEPEKA_SITE_URL}/community/brandlab">${t("pricing.locked.claimCta")}</a>
    </section>`;
  }
  return `<section class="pricing-locked-banner">
    <h2>${t("pricing.locked.expiredTitle")}</h2>
    <p>${t("pricing.locked.expiredBody")}</p>
    <button type="button" class="btn btn-secondary" id="locked-book">${icon("download", { size: 14 })}${t("pricing.locked.bookCta")}</button>
  </section>`;
}

// An ended trial/plan doesn't render the app, but the Brand Book they built
// stays theirs: read their brands straight from Firestore (reads stay open to
// the owner, see firestore.rules) and open the same preview + PDF, read-only.
// Loaded on click only — most visitors of this screen never press it.
async function openLockedBrandBook(uid, btn) {
  if (!uid) return;
  btn.disabled = true;
  try {
    const { collection, query, where, getDocs } = await loadFirestore();
    const snap = await getDocs(query(collection(fdb, "brands"), where("ownerId", "==", uid)));
    const brands = snap.docs.map((d) => d.data()).filter((b) => !b.archived);
    if (!brands.length) {
      toast(t("pricing.locked.bookNone"), "error");
      return;
    }
    const { openBrandBookReadOnly } = await import("./brand-guidelines.js");
    if (brands.length === 1) {
      openBrandBookReadOnly(brands[0]);
      return;
    }
    const { openModal, closeOverlay } = await import("../modals.js");
    const overlay = openModal({
      title: t("pricing.locked.bookPick"),
      bodyHTML: `<div class="flex" style="flex-direction:column;gap:8px;">${brands
        .map((b, i) => `<button type="button" class="btn btn-secondary" data-book="${i}" style="justify-content:flex-start;">${escapeHtml(b.name || "")}</button>`)
        .join("")}</div>`,
    });
    qsa("[data-book]", overlay).forEach((b) => {
      b.addEventListener("click", () => {
        closeOverlay(overlay);
        openBrandBookReadOnly(brands[Number(b.dataset.book)]);
      });
    });
  } catch (err) {
    console.error("Brand Book unavailable", err);
    toast(t("pricing.locked.bookFail"), "error");
  } finally {
    btn.disabled = false;
  }
}

function addonsHTML(account) {
  return `
    <section class="pricing-addons">
      <h2 class="pricing-section-title">${t("pricing.addons.title")}</h2>
      <p class="pricing-sub pricing-section-sub">${t("pricing.addons.sub")}</p>
      <div class="pricing-addon-grid">
        ${ADDONS.map((a) => {
          const name = t(`pricing.addons.${a.key}`);
          const price = a.per30 ? t("pricing.addons.per30", { price: rp(a.price) }) : rp(a.price);
          const inner = `
            <span>${name}</span><strong>${price}</strong>
            ${a.forWho ? `<em>${t(a.forWho === "paid" ? `pricing.addons.note.${a.key}` : `pricing.addons.for.${a.forWho}`)}${a.save ? ` · ${t("pricing.addons.save", { amount: rp(a.save) })}` : ""}</em>` : ""}`;
          return canBuyAddon(a, account)
            ? `<button type="button" class="pricing-addon" data-pay-addon="${a.payKey}">${inner}</button>`
            : `<div class="pricing-addon is-unavailable">${inner}</div>`;
        }).join("")}
      </div>
    </section>`;
}

// `embed`: only the plans themselves (cards, trust lines, agency plans, the
// Founder note), for the front page, which brings its own header, hero and
// FAQ. `onFacts` hears what the server said about seats and checkout, so
// that page's seat counters show the same numbers as the cards.
export function render(root, { user, account, backHref, locked, embed = false, onFacts = null } = {}) {
  const uid = user?.uid || null;
  const owned = uid ? ownedLifetime(account) : null;
  // Add-ons are a second decision: only accounts that already pay see them.
  const showAddons = !!uid && !["trial", "expired", "none"].includes(accessState(account));
  let slots = null;
  let myHold = null;
  // null until the server answers; { open:false } swaps the "pay securely
  // via Midtrans" line for the "coming soon" note (api/_payments.js).
  let payState = null;
  const sel = { brands: takePricingBrands(), yearly: false };
  const tellFacts = () => onFacts?.({
    live: !!slots,
    founderTaken: seatsTakenOf(slots, FOUNDER.slotField, Date.now(), myHold),
    agencyTaken: seatsTakenOf(slots, AGENCY.slotField, Date.now(), myHold),
    payOpen: payState ? !!payState.open : null,
  });

  const paint = () => {
  const open = openTier(slots ? seatsTakenOf(slots, FOUNDER.slotField, Date.now(), myHold) : null);
  const founderSoldOut = open >= FOUNDER.tiers.length;
  const tier = FOUNDER.tiers[Math.min(open, FOUNDER.tiers.length - 1)];
  const agencySoldOut = seatsTakenOf(slots, AGENCY.slotField, Date.now(), myHold) >= FOUNDER_SLOT_CAPS[AGENCY.slotField];
  const faqVars = {
    days: TRIAL_DAYS,
    cap: FOUNDER_SLOT_CAPS[FOUNDER.slotField],
    first: FOUNDER.tiers[0].people,
    next: FOUNDER.tiers[1].people,
    priceFirst: rp(FOUNDER.tiers[0].price),
    priceNext: rp(FOUNDER.tiers[1].price),
    normal: rp(LIFETIME_NORMAL_PRICE),
  };

  const waysHTML = `
      <section class="pricing-ways-section">
        ${owned ? ownedNoteHTML(owned) : ""}
        ${payState && !payState.open ? `
          <div class="pricing-pending-help pricing-closed-note" role="status">
            <b>${t("pricing.closed.title")}</b>
            <p>${t(closedNoteKey(uid, account))}</p>
          </div>` : ""}
        <div class="pricing-ways">
          ${founderCardHTML({ open, tier, soldOut: founderSoldOut }, uid, owned)}
          ${subscriptionCardHTML(sel, uid, owned)}
        </div>
        ${owned || (founderSoldOut && agencySoldOut) ? "" : promoHTML()}
        ${payState && !payState.open ? "" : `<p class="pricing-trust">${icon("check", { size: 13 })}${t("pricing.trust")}</p>${bankNoteHTML(user?.email)}`}
        ${uid ? "" : `<p class="pricing-trust pricing-trust--trial">${t("pricing.trialNote", { days: TRIAL_DAYS })}</p>`}
        ${agencyHTML(uid, agencySoldOut, owned, embed)}
      </section>

      <p class="pricing-founder-note">${t("pricing.renewNote")} ${t("pricing.founder.note")}</p>`;

  // Laid out like wepeka.com/brandlab's offer section (same purple mesh,
  // pink Founder card, rounded cards), but trimmed to what it takes to
  // decide: a short hero, the two cards straight away (Founder first),
  // one trust line, then everything secondary folded away.
  root.innerHTML = embed ? `<div class="pricing-embed">${waysHTML}</div>` : `
    <div class="pricing-page">
    <div class="pricing-shell">
      <div class="pricing-header">
        <div class="brand-mark" style="justify-content:center;">
          <span class="brand-logo" role="img" aria-label="Wepeka"></span>
          <span class="brand-mark-divider"></span>
          Brandlab
        </div>
      </div>

      ${backHref ? `<a class="hint pricing-back" href="${backHref}">${icon("chevronLeft", { size: 13 })}${t("pricing.back")}</a>` : ""}
      ${accountBarHTML(user, account)}
      ${locked ? lockedBannerHTML(account) : ""}

      <section class="pricing-hero">
        <span class="pricing-pill pricing-pill--eyebrow">${t("pricing.hero.eyebrow")}</span>
        <h1 class="pricing-title">${t("pricing.hero.title")}</h1>
        <p class="pricing-sub">${t("pricing.hero.subShort")}</p>
      </section>

      ${waysHTML}

      ${showAddons ? addonsHTML(account) : ""}

      <section class="pricing-faq">
        <h2 class="pricing-section-title">${t("pricing.faq.title")}</h2>
        ${FAQ_KEYS.map((k, i) => `
          <details class="pricing-faq-item" ${i === 0 ? "open" : ""}>
            <summary>${t(`pricing.faq.${k}.q`, faqVars)}${icon("chevronDown", { size: 16 })}</summary>
            <p>${t(`pricing.faq.${k}.a`, faqVars)}</p>
          </details>`).join("")}
      </section>

      <p class="hint pricing-foot">
        <a href="${waLink("Brandlab", "")}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${t("pricing.askWa", { number: localNumber(SUPPORT_WA_NUMBER) })}</a>
        ${user ? "" : `
          <span class="pricing-foot-sep">·</span>
          ${t("pricing.alreadyHave")} <a href="#/login" style="color:var(--accent);margin-left:4px;">${t("auth.loginHere")}</a>
          <span class="pricing-foot-sep">·</span>
          <a href="${WEPEKA_CONNECT_URL}" style="color:var(--accent);">${t("auth.wepeka.login")}</a>`}
      </p>
      <p class="pricing-legal">${agreeLine("legal.agreePay")}</p>
    </div>
    </div>
  `;

  qs("#pricing-logout", root)?.addEventListener("click", () => logout());
  qs("#locked-book", root)?.addEventListener("click", (e) => openLockedBrandBook(uid, e.currentTarget));
  qs("[data-open-community]", root)?.addEventListener("click", () => {
    import("../community.js").then((m) => m.openCommunityModal()).catch((e) => console.warn("community sheet unavailable", e));
  });
  qsa("[data-pay]", root).forEach((btn) => {
    btn.addEventListener("click", () => payPlan(btn.dataset.pay, uid, { onSuccess: enterAppWhenPaid, successToast: false }));
  });
  // An add-on doesn't change the plan, so there's nothing to "enter" after.
  qsa("[data-pay-addon]", root).forEach((btn) => {
    btn.addEventListener("click", () => payPlan(btn.dataset.payAddon, uid));
  });
  wirePromo(root, repaintInPlace);
  qsa("[data-seg]", root).forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.seg === "brands") sel.brands = Number(btn.dataset.value);
      else sel.yearly = btn.dataset.value === "yearly";
      repaintInPlace();
    });
  });
  };

  const repaintInPlace = () => {
    const y = window.scrollY;
    paint();
    window.scrollTo(0, y);
  };

  paint();

  // A buy button pressed before signing in (js/buy-intent.js): its checkout
  // opens now, without asking for the same click again.
  if (uid && !embed) {
    const wanted = takeBuyIntent();
    if (wanted) payPlan(wanted, uid, { onSuccess: enterAppWhenPaid, successToast: false });
  }

  paymentStatus().then((status) => {
    if (!root.isConnected) return;
    payState = status;
    tellFacts();
    if (!status.open) repaintInPlace();
  });

  // The live sold-count decides which Founder wave is open (and whether
  // anything is sold out) — it is never displayed. Repaint only if it
  // changes what the page says.
  Promise.all([loadFirestore().then(({ doc, getDoc }) => getDoc(doc(fdb, "meta", "founderSlots"))), uid ? holdKeyOf(uid).catch(() => null) : null])
    .then(([snap, key]) => {
      if (!root.isConnected) return;
      const before = openTier(null);
      slots = snap.exists() ? snap.data() : {};
      myHold = key;
      tellFacts();
      const agencyGone = seatsTakenOf(slots, AGENCY.slotField, Date.now(), myHold) >= FOUNDER_SLOT_CAPS[AGENCY.slotField];
      if (openTier(seatsTakenOf(slots, FOUNDER.slotField, Date.now(), myHold)) === before && !agencyGone) return;
      repaintInPlace();
    })
    .catch((err) => console.warn("Founder slot count unavailable", err));
}

// The plan table, for the front page's copy (its {tokens}).
export { SUBSCRIPTIONS, STUDIO, FOUNDER, AGENCY, FOUNDER_SLOT_CAPS, BOOK_STYLES_VALUE, LIFETIME_NORMAL_PRICE, AGENCY_NORMAL_PRICE };
