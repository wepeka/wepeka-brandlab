// Pricing page. Three audiences land here:
//  - Logged-out visitors (no `opts.user`) — the marketing page; every CTA
//    sends them to wepeka.com (WEPEKA_CONNECT_URL) instead of paying
//    directly — account creation and the 30-day trial claim both happen
//    there now (Fase 2 of .claude/handoff-satu-akun.md), never on Brandlab.
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
import { icon } from "../icons.js";
import { qs, qsa, toast, escapeHtml } from "../dom.js";
import { logout } from "../auth.js";
import { t, getLang } from "../i18n.js";
import { WEPEKA_CONNECT_URL, WEPEKA_SITE_URL } from "../site-links.js";
import { db as fdb, auth } from "../firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { isTrial, trialDaysLeft, TRIAL_DAYS, accessState } from "../account.js";

// Rupiah amounts with the thousands separator of the current language
// (Rp 300.000 in ID, Rp 300,000 in EN).
const rp = (n) => `Rp ${n.toLocaleString(getLang() === "en" ? "en-US" : "id-ID")}`;

const PAYMENT_WA_NUMBER = "6285196627609"; // Wepeka support (same as wpk-dp src/lib/support.ts)

// TODO: ganti ke Client Key asli dari dashboard Midtrans (Settings → Access
// Keys). Client key itu bukan rahasia (aman ditaruh di frontend) — Server
// Key yang harus tetap cuma di env var Vercel, dipakai di api/midtrans/*.
const MIDTRANS_CLIENT_KEY = "SB-Mid-client-XXXXXXXXXXXXXXXX";
const MIDTRANS_IS_PRODUCTION = false;
const MIDTRANS_SNAP_URL = MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/snap.js"
  : "https://app.sandbox.midtrans.com/snap/snap.js";

let snapScriptPromise = null;
function loadSnap() {
  if (window.snap) return Promise.resolve();
  if (!snapScriptPromise) {
    snapScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MIDTRANS_SNAP_URL;
      script.setAttribute("data-client-key", MIDTRANS_CLIENT_KEY);
      script.onload = resolve;
      script.onerror = () => reject(new Error(t("pricing.err.loadSnap")));
      document.head.appendChild(script);
    });
  }
  return snapScriptPromise;
}

// planKey here matches accounts/{uid}.plan values on the server side (see
// api/midtrans/create-transaction.js's PRICES map) — the price itself is
// looked up server-side from planKey, never trusted from this call.
// `onSuccess` lets a caller outside this page (the Brand Book style picker)
// react once Snap reports success; the unlock itself still only ever comes
// from the webhook.
export async function payPlan(planKey, uid, { onSuccess } = {}) {
  if (!uid) {
    toast(t("pricing.err.needLogin"), "error");
    location.hash = "#/login";
    return;
  }
  try {
    await loadSnap();
    // The server derives uid from this token (Authorization header), never
    // from the request body — see api/midtrans/create-transaction.js.
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      toast(t("pricing.err.needLogin"), "error");
      location.hash = "#/login";
      return;
    }
    const res = await fetch("/api/midtrans/create-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ planKey }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t("pricing.err.createTx"));
    const { token } = await res.json();
    window.snap.pay(token, {
      onSuccess: () => {
        toast(t("pricing.pay.success"));
        onSuccess?.();
      },
      onPending: () => toast(t("pricing.pay.pending")),
      onError: () => toast(t("pricing.pay.error"), "error"),
    });
  } catch (err) {
    toast(err.message || t("pricing.err.start"), "error");
  }
}

// Display mirror of api/_plans.js + js/ai-usage.js's PLAN_QUOTA — keep in
// sync. planKey sent to the server is `${key}-${billing}` for subscriptions.
// The two owner sizes share one card ("1 brand" / "3 brand" toggle); the
// tier names Starter/Pro never appear on screen.
const SUBSCRIPTIONS = {
  1: { key: "starter", monthly: 49000, yearly: 399000, brands: 1, credits: 20 },
  3: { key: "pro", monthly: 99000, yearly: 799000, brands: 3, credits: 60 },
};
const PRO = SUBSCRIPTIONS[3];
const STUDIO = { key: "studio", monthly: 249000, yearly: 1990000, brands: 10, credits: 200 };

// Two waves inside the same 50 slots (api/_plans.js FOUNDER_TIERS — keep in
// sync). The page never shows how many are sold, only which wave is open.
const FOUNDER = { key: "founder", slotField: "founderSlotsSold", tiers: [{ upTo: 15, people: 15, price: 499000 }, { upTo: 50, people: 35, price: 699000 }], brands: 3, credits: 300, features: ["proForever", "contentMonth", "upcoming", "bookStyles", "circle", "review", "badge"] };
const AGENCY = { key: "founder-ultimate", slotField: "founderUltimateSlotsSold", price: 1490000, brands: 15, credits: 500 };
// Hard caps, mirrored from api/_plans.js SLOT_CAPS.
const FOUNDER_SLOT_CAPS = { founderSlotsSold: 50, founderUltimateSlotsSold: 15 };
// What the three premium Brand Book styles cost bought one by one
// (api/_plans.js BOOK_STYLE_ADDONS) — the bundle line on the Founder card.
const BOOK_STYLES_VALUE = 3 * 20000;

// Rough going rate for a social media agency / freelance manager serving a
// small business — the one anchor on the page, shown as "kisaran".
const AGENCY_MONTHLY = [1500000, 5000000];

// `payKey` add-ons are bought on the spot (api/_plans.js ADDONS — keep in
// sync) by accounts on a pay-once plan; everything else is ordered via
// WhatsApp and added by hand.
const ADDONS = [
  { key: "credits300", price: 20000 },
  { key: "credits1000", price: 79000 },
  { key: "brand", price: 19000, perMonth: true, forWho: "subs" },
  { key: "brandLife1", price: 99000, payKey: "addon-brand-1", forWho: "lifetime" },
  { key: "brandLife3", price: 249000, payKey: "addon-brand-3", forWho: "lifetime", save: 48000 },
];
const ADDON_ELIGIBLE_PLANS = ["founder", "founder-ultimate", "lifetime"];

const FAQ_KEYS = ["trial", "after", "which", "circle", "ai", "cancel", "credits", "slots"];

function waLink(planName, price) {
  const text = encodeURIComponent(t("pricing.wa.message", { plan: planName, price }));
  return `https://wa.me/${PAYMENT_WA_NUMBER}?text=${text}`;
}

const check = () => icon("check", { size: 15 });
const featureVars = (plan, f) => (f === "bookStyles" ? { price: rp(BOOK_STYLES_VALUE) } : { n: /credit|content/i.test(f) ? plan.credits : plan.brands });
const featuresHTML = (plan) => plan.features.map((f) => `<li>${check()}<span>${t(`pricing.f.${f}`, featureVars(plan, f))}</span></li>`).join("");

// Logged in → pay for real. Logged out → wepeka.com (register or log in
// there, then SSO back here already signed in), which starts the trial;
// the plan is picked again from inside once they've seen the product.
function ctaHTML(planKey, label, uid, cls = "btn-secondary") {
  const classes = `btn ${cls} btn-block pricing-cta`;
  return uid
    ? `<button type="button" class="${classes}" data-pay="${planKey}">${label}</button>`
    : `<a class="${classes}" data-plan="${planKey}" href="${WEPEKA_CONNECT_URL}">${label}</a>`;
}
const soldOutHTML = (cls = "btn-primary") => `<button type="button" class="btn ${cls} btn-block pricing-cta" disabled>${t("pricing.soldOut")}</button>`;

// Index of the wave currently on sale, from the live sold-count. Unknown
// count (still loading / read failed) shows the first wave — the amount
// actually charged is decided server-side either way.
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
function subscriptionCardHTML(sel, uid) {
  const plan = SUBSCRIPTIONS[sel.brands];
  const price = sel.yearly ? plan.yearly : plan.monthly;
  const planKey = `${plan.key}-${sel.yearly ? "yearly" : "monthly"}`;
  return `
    <div class="pricing-way">
      <h3 class="pricing-way-name">${t("pricing.way.subscription")}</h3>
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
      ${ctaHTML(planKey, t("pricing.way.subscription.cta"), uid)}
    </div>`;
}

function founderCardHTML({ open, tier, soldOut }, uid) {
  return `
    <div class="pricing-way is-win">
      <span class="pricing-ribbon">${t("pricing.bestDeal")}</span>
      <span class="pricing-limited">${t("pricing.founder.pill", { cap: FOUNDER_SLOT_CAPS[FOUNDER.slotField] })}</span>
      <h3 class="pricing-way-name">${t("pricing.way.lifetime")}</h3>
      <div class="pricing-price-row"><span class="pricing-price">${rp(tier.price)}</span><span class="pricing-per">${t("pricing.payOnce")}</span></div>
      <p class="pricing-price-note">${t("pricing.way.lifetime.note", { yearly: rp(PRO.yearly), price: rp(tier.price) })}</p>
      ${tiersHTML(open)}
      <ul class="pricing-features">${featuresHTML(FOUNDER)}</ul>
      ${soldOut ? soldOutHTML() : ctaHTML(FOUNDER.key, `${t("pricing.founder.cta")}${icon("arrowRight", { size: 16 })}`, uid, "btn-primary")}
    </div>`;
}

function otherPlanHTML(plan, uid) {
  const name = t(`pricing.${plan.key}.name`);
  return `
    <div class="pricing-other-row">
      <div class="pricing-other-info">
        <strong>${name}</strong>
        <span>${t(`pricing.${plan.key}.who`)}</span>
        <span class="pricing-other-meta">${t("pricing.f.brands", { n: plan.brands })} · ${t("pricing.f.contentDay", { n: plan.credits })}</span>
      </div>
      <div class="pricing-other-actions">
        ${ctaHTML(`${plan.key}-monthly`, t("pricing.perMonth", { price: rp(plan.monthly) }), uid)}
        ${ctaHTML(`${plan.key}-yearly`, t("pricing.perYear", { price: rp(plan.yearly) }), uid)}
      </div>
    </div>`;
}

// Studio + Agency Lifetime, collapsed: a different buyer (people who run
// client brands), so their prices stay out of an owner's line of sight.
function agencyHTML(uid, agencySoldOut) {
  const perBrand = rp(Math.round(AGENCY.price / AGENCY.brands / 1000) * 1000);
  return `
    <details class="pricing-other" id="ultimate">
      <summary>${t("pricing.agency.title")}${icon("chevronDown", { size: 16 })}</summary>
      ${otherPlanHTML(STUDIO, uid)}
      <div class="pricing-other-row">
        <div class="pricing-other-info">
          <strong>${t("pricing.founder-ultimate.name")}</strong>
          <span>${t("pricing.ultimate.sub", { n: AGENCY.brands })}</span>
          <span class="pricing-other-meta">${t("pricing.f.brands", { n: AGENCY.brands })} · ${t("pricing.f.contentMonth", { n: AGENCY.credits })} · ${t("pricing.ultimate.perBrand", { price: perBrand })} · ${t("pricing.ultimate.slots", { cap: FOUNDER_SLOT_CAPS[AGENCY.slotField] })}</span>
        </div>
        <div class="pricing-other-actions">
          ${agencySoldOut ? soldOutHTML("btn-secondary") : ctaHTML(AGENCY.key, `${rp(AGENCY.price)} · ${t("pricing.payOnce")}`, uid)}
        </div>
      </div>
      <p class="pricing-renew-note">${t("pricing.agency.note")}</p>
    </details>`;
}

function accountBarHTML(user, account) {
  if (!user) return "";
  let status = t("pricing.loggedInAs", { email: escapeHtml(user.email || "") });
  const state = accessState(account);
  if (state === "trial") {
    status += " " + t("pricing.status.trial", { days: trialDaysLeft(account) });
  } else if (state === "expired") {
    status += " " + (isTrial(account) ? t("pricing.status.trialEnded") : t("pricing.status.readonly"));
  } else if (state === "none") {
    status += " " + t("pricing.status.none");
  } else {
    status += " " + t("pricing.status.plan", { plan: escapeHtml(String(account.plan)) });
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
      <a class="btn btn-primary pricing-cta" href="${WEPEKA_SITE_URL}/community/brandlab">${t("pricing.locked.claimCta")}</a>
    </section>`;
  }
  return `<section class="pricing-locked-banner">
    <h2>${t("pricing.locked.expiredTitle")}</h2>
    <p>${t("pricing.locked.expiredBody")}</p>
  </section>`;
}

// "Kurang apa lagi" — the Founder bundle stacked against what the same help
// costs elsewhere (the agency line is the page's only price anchor), ending
// on the one number they actually pay.
function stackHTML(founderPrice) {
  const rows = [
    { key: "agency", value: t("pricing.stack.agency.value", { from: rp(AGENCY_MONTHLY[0]), to: rp(AGENCY_MONTHLY[1]) }), struck: true },
    { key: "consultant", value: t("pricing.stack.included") },
    { key: "tools", value: t("pricing.stack.included") },
    { key: "circle", value: t("pricing.stack.included") },
    { key: "upcoming", value: t("pricing.stack.included") },
  ];
  return `
    <section class="pricing-stack">
      <span class="pricing-limited">${t("pricing.limited")}</span>
      <h2 class="pricing-section-title">${t("pricing.stack.title")}</h2>
      <div class="pricing-stack-card">
        ${rows.map((r) => `
          <div class="pricing-stack-row ${r.struck ? "is-struck" : ""}">
            <div><strong>${t(`pricing.stack.${r.key}.name`)}</strong><span>${t(`pricing.stack.${r.key}.desc`)}</span></div>
            <em>${r.value}</em>
          </div>`).join("")}
        <div class="pricing-stack-total">
          <div><strong>${t("pricing.stack.total")}</strong><span>${t("pricing.stack.totalDesc")}</span></div>
          <em>${rp(founderPrice)}</em>
        </div>
      </div>
      <p class="pricing-founder-note">${t("pricing.stack.fine")}</p>
    </section>`;
}

function addonsHTML(canBuyAddons) {
  return `
    <section class="pricing-addons">
      <h2 class="pricing-section-title">${t("pricing.addons.title")}</h2>
      <p class="pricing-sub pricing-section-sub">${t("pricing.addons.sub")}</p>
      <div class="pricing-addon-grid">
        ${ADDONS.map((a) => {
          const name = t(`pricing.addons.${a.key}`);
          const price = a.perMonth ? t("pricing.perMonth", { price: rp(a.price) }) : rp(a.price);
          const inner = `
            <span>${name}</span><strong>${price}</strong>
            ${a.forWho ? `<em>${t(`pricing.addons.for.${a.forWho}`)}${a.save ? ` · ${t("pricing.addons.save", { amount: rp(a.save) })}` : ""}</em>` : ""}`;
          return a.payKey && canBuyAddons
            ? `<button type="button" class="pricing-addon" data-pay="${a.payKey}">${inner}</button>`
            : `<a class="pricing-addon" href="${waLink(name, price)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
        }).join("")}
      </div>
    </section>`;
}

export function render(root, { user, account, backHref, locked } = {}) {
  const uid = user?.uid || null;
  const canBuyAddons = !!uid && ADDON_ELIGIBLE_PLANS.includes(account?.plan);
  // Add-ons are a second decision: only accounts that already pay see them.
  const showAddons = !!uid && !["trial", "expired", "none"].includes(accessState(account));
  let slots = null;
  const sel = { brands: 1, yearly: false };

  const paint = () => {
  const open = openTier(slots?.[FOUNDER.slotField]);
  const founderSoldOut = open >= FOUNDER.tiers.length;
  const tier = FOUNDER.tiers[Math.min(open, FOUNDER.tiers.length - 1)];
  const agencySoldOut = (Number(slots?.[AGENCY.slotField]) || 0) >= FOUNDER_SLOT_CAPS[AGENCY.slotField];
  const faqVars = {
    days: TRIAL_DAYS,
    cap: FOUNDER_SLOT_CAPS[FOUNDER.slotField],
    first: FOUNDER.tiers[0].people,
    next: FOUNDER.tiers[1].people,
    priceFirst: rp(FOUNDER.tiers[0].price),
    priceNext: rp(FOUNDER.tiers[1].price),
  };

  root.innerHTML = `
    <div class="pricing-shell">
      <div class="pricing-header">
        <div class="brand-mark" style="justify-content:center;">
          <img class="brand-logo" src="assets/wepeka-logo.png" alt="Wepeka" />
          <span class="brand-mark-divider"></span>
          Brandlab
        </div>
      </div>

      ${backHref ? `<a class="hint pricing-back" href="${backHref}">${icon("chevronLeft", { size: 13 })}${t("pricing.back")}</a>` : ""}
      ${accountBarHTML(user, account)}
      ${locked ? lockedBannerHTML(account) : ""}

      <section class="pricing-hero">
        <span class="pricing-limited">${t("pricing.limited")} · ${t("pricing.founder.pill", { cap: FOUNDER_SLOT_CAPS[FOUNDER.slotField] })}</span>
        <h1 class="pricing-title">${t("pricing.hero.title")}</h1>
        <p class="pricing-sub">${t("pricing.hero.sub")}</p>
        ${uid ? "" : `<p class="pricing-trial-note">${check()}<span>${t("pricing.trialNote", { days: TRIAL_DAYS })}</span></p>`}
      </section>

      <section class="pricing-ways-section">
        <div class="pricing-ways">
          ${subscriptionCardHTML(sel, uid)}
          ${founderCardHTML({ open, tier, soldOut: founderSoldOut }, uid)}
        </div>
        <p class="pricing-renew-note pricing-renew-note--plain">${t("pricing.renewNote")}</p>
        ${agencyHTML(uid, agencySoldOut)}
      </section>

      ${stackHTML(tier.price)}
      <p class="pricing-founder-note">${t("pricing.founder.note")}</p>

      ${showAddons ? addonsHTML(canBuyAddons) : ""}

      <section class="pricing-faq">
        <h2 class="pricing-section-title">${t("pricing.faq.title")}</h2>
        ${FAQ_KEYS.map((k, i) => `
          <details class="pricing-faq-item" ${i === 0 ? "open" : ""}>
            <summary>${t(`pricing.faq.${k}.q`, faqVars)}${icon("chevronDown", { size: 16 })}</summary>
            <p>${t(`pricing.faq.${k}.a`, faqVars)}</p>
          </details>`).join("")}
      </section>

      <p class="hint pricing-foot">
        <a href="${waLink("Brandlab", "")}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${t("pricing.askWa")}</a>
        ${user ? "" : `
          <span class="pricing-foot-sep">·</span>
          ${t("pricing.alreadyHave")} <a href="#/login" style="color:var(--accent);margin-left:4px;">${t("auth.loginHere")}</a>
          <span class="pricing-foot-sep">·</span>
          <a href="${WEPEKA_CONNECT_URL}" style="color:var(--accent);">${t("auth.wepeka.login")}</a>`}
      </p>
    </div>
  `;

  qs("#pricing-logout", root)?.addEventListener("click", () => logout());
  qsa("[data-pay]", root).forEach((btn) => {
    btn.addEventListener("click", () => payPlan(btn.dataset.pay, uid));
  });
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

  // The live sold-count decides which Founder wave is open (and whether
  // anything is sold out) — it is never displayed. Repaint only if it
  // changes what the page says.
  getDoc(doc(fdb, "meta", "founderSlots"))
    .then((snap) => {
      if (!root.isConnected) return;
      const before = openTier(null);
      slots = snap.exists() ? snap.data() : {};
      const agencyGone = (Number(slots[AGENCY.slotField]) || 0) >= FOUNDER_SLOT_CAPS[AGENCY.slotField];
      if (openTier(slots[FOUNDER.slotField]) === before && !agencyGone) return;
      repaintInPlace();
    })
    .catch((err) => console.warn("Founder slot count unavailable", err));
}
