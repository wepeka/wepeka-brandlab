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

const PAYMENT_WA_NUMBER = "62812xxxxxxx"; // TODO: ganti ke nomor WA asli sebelum di-share

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
const PRO = { key: "pro", monthly: 99000, yearly: 799000, brands: 3, credits: 60 };
// Kept purchasable, but deliberately out of the main line of sight — the
// page's one job is Founder Lifetime; these sit in a collapsed row.
const OTHER_PLANS = [
  { key: "starter", monthly: 49000, yearly: 399000, brands: 1, credits: 20 },
  { key: "studio", monthly: 249000, yearly: 1990000, brands: 10, credits: 200 },
];

// Two waves inside the same 50 slots (api/_plans.js FOUNDER_TIERS — keep in
// sync). The page never shows how many are sold, only which wave is open.
const FOUNDER = { key: "founder", slotField: "founderSlotsSold", tiers: [{ upTo: 15, people: 15, price: 299000 }, { upTo: 50, people: 35, price: 499000 }], brands: 3, credits: 300, features: ["proForever", "creditsMonth", "consultant", "ocr", "wa", "discord", "badge"] };
const ULTIMATE = { key: "founder-ultimate", slotField: "founderUltimateSlotsSold", price: 800000, brands: 15, credits: 500, features: ["studioForever", "creditsMonth", "community", "metaAds"] };
// Hard caps, mirrored from api/_plans.js SLOT_CAPS.
const FOUNDER_SLOT_CAPS = { founderSlotsSold: 50, founderUltimateSlotsSold: 15 };

// The comparison the hero is built on: what the same Pro feature set costs
// over this many years, each way of paying for it.
const LEDGER_YEARS = 3;

// Rough going rate for a social media agency / freelance manager serving a
// small business — an anchor for the value stack, shown as "kisaran".
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

const FAQ_KEYS = ["trial", "after", "which", "ai", "cancel", "credits", "slots"];

function waLink(planName, price) {
  const text = encodeURIComponent(t("pricing.wa.message", { plan: planName, price }));
  return `https://wa.me/${PAYMENT_WA_NUMBER}?text=${text}`;
}

const check = () => icon("check", { size: 15 });
const featureVars = (plan, f) => ({ n: f.startsWith("credits") ? plan.credits : plan.brands });
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

function ledgerHTML(founderPrice) {
  const rows = [
    { key: "monthly", total: PRO.monthly * 12 * LEDGER_YEARS },
    { key: "yearly", total: PRO.yearly * LEDGER_YEARS },
    { key: "founder", total: founderPrice, win: true },
  ];
  const max = rows[0].total;
  return `
    <div class="pricing-ledger">
      <p class="pricing-ledger-title">${t("pricing.ledger.title", { years: LEDGER_YEARS })}</p>
      ${rows.map((r, i) => `
        <div class="pricing-ledger-row ${r.win ? "is-win" : ""}">
          <div class="pricing-ledger-head"><span>${t(`pricing.ledger.${r.key}`)}</span><strong>${rp(r.total)}</strong></div>
          <div class="pricing-ledger-bar"><i style="--w:${Math.max(4, Math.round((r.total / max) * 100))}%;--d:${i * 140}ms"></i></div>
        </div>`).join("")}
      <p class="pricing-ledger-save">${t("pricing.ledger.save", { amount: rp(max - founderPrice) })}</p>
      <p class="pricing-ledger-fine">${t("pricing.ledger.fine", { founder: FOUNDER.credits, pro: PRO.credits })}</p>
    </div>`;
}

function payWayHTML({ planKey, kind, price, per, note, credits, win, soldOut }, uid) {
  return `
    <div class="pricing-way ${win ? "is-win" : ""}">
      ${win ? `<span class="pricing-ribbon">${t("pricing.bestDeal")}</span>` : ""}
      <h3 class="pricing-way-name">${t(`pricing.way.${kind}`)}</h3>
      <div class="pricing-price-row"><span class="pricing-price">${rp(price)}</span><span class="pricing-per">${per}</span></div>
      <p class="pricing-price-note">${note}</p>
      <p class="pricing-way-credits">${credits}</p>
      ${soldOut
        ? `<button type="button" class="btn btn-primary btn-block pricing-cta" disabled>${t("pricing.soldOut")}</button>`
        : ctaHTML(planKey, t(`pricing.way.${kind}.cta`), uid, win ? "btn-primary" : "btn-secondary")}
    </div>`;
}

function otherPlanHTML(plan, uid) {
  const name = t(`pricing.${plan.key}.name`);
  return `
    <div class="pricing-other-row">
      <div class="pricing-other-info">
        <strong>${name}</strong>
        <span>${t(`pricing.${plan.key}.who`)}</span>
        <span class="pricing-other-meta">${t(plan.brands === 1 ? "pricing.f.brands1" : "pricing.f.brands", { n: plan.brands })} · ${t("pricing.f.credits", { n: plan.credits })}</span>
      </div>
      <div class="pricing-other-actions">
        ${ctaHTML(`${plan.key}-monthly`, t("pricing.perMonth", { price: rp(plan.monthly) }), uid)}
        ${ctaHTML(`${plan.key}-yearly`, t("pricing.perYear", { price: rp(plan.yearly) }), uid)}
      </div>
    </div>`;
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

// "Kurang apa lagi" — the offer stacked against what the same help costs
// elsewhere, ending on the one number they actually pay.
function stackHTML(founderPrice) {
  const rows = [
    { key: "agency", value: t("pricing.stack.agency.value", { from: rp(AGENCY_MONTHLY[0]), to: rp(AGENCY_MONTHLY[1]) }), struck: true },
    { key: "consultant", value: t("pricing.stack.included") },
    { key: "tools", value: t("pricing.stack.included") },
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

export function render(root, { user, account, backHref, locked } = {}) {
  const uid = user?.uid || null;
  const canBuyAddons = !!uid && ADDON_ELIGIBLE_PLANS.includes(account?.plan);
  let slots = null;

  const paint = () => {
  const open = openTier(slots?.[FOUNDER.slotField]);
  const founderSoldOut = open >= FOUNDER.tiers.length;
  const tier = FOUNDER.tiers[Math.min(open, FOUNDER.tiers.length - 1)];
  const nextTier = FOUNDER.tiers[open + 1];
  const months = Math.round(tier.price / PRO.monthly);
  const ultimateSoldOut = (Number(slots?.[ULTIMATE.slotField]) || 0) >= FOUNDER_SLOT_CAPS[ULTIMATE.slotField];
  const founderCta = (label, cls) => founderSoldOut
    ? `<button type="button" class="btn ${cls} btn-block pricing-cta" disabled>${t("pricing.soldOut")}</button>`
    : ctaHTML(FOUNDER.key, label, uid, cls);

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
        <div class="pricing-hero-main">
          <span class="pricing-limited">${t("pricing.limited")} · ${t("pricing.founder.pill", { cap: FOUNDER_SLOT_CAPS[FOUNDER.slotField] })}</span>
          <h1 class="pricing-title">${t("pricing.hero.title")}</h1>
          <p class="pricing-sub">${t("pricing.hero.sub", { months })}</p>
          <div class="pricing-hero-price">
            ${nextTier ? `<span class="pricing-was">${rp(nextTier.price)}</span>` : ""}
            <span class="pricing-price">${rp(tier.price)}</span>
            <span class="pricing-per">${t("pricing.payOnce")}</span>
          </div>
          ${tiersHTML(open)}
          ${founderCta(`${t("pricing.founder.cta")}${icon("arrowRight", { size: 16 })}`, "btn-primary pricing-hero-cta")}
          ${uid ? "" : `<p class="pricing-trial-note">${check()}<span>${t("pricing.trialNote", { days: TRIAL_DAYS })}</span></p>`}
        </div>
        ${ledgerHTML(tier.price)}
      </section>

      <ul class="pricing-features pricing-hero-features">${featuresHTML(FOUNDER)}</ul>

      ${stackHTML(tier.price)}

      <section class="pricing-ways-section">
        <h2 class="pricing-section-title">${t("pricing.ways.title")}</h2>
        <p class="pricing-sub pricing-section-sub">${t("pricing.ways.sub", { n: PRO.brands })}</p>
        <div class="pricing-ways">
          ${payWayHTML({ planKey: "pro-monthly", kind: "monthly", price: PRO.monthly, per: t("pricing.perMonthShort"), note: t("pricing.way.monthly.note", { total: rp(PRO.monthly * 12) }), credits: t("pricing.f.credits", { n: PRO.credits }) }, uid)}
          ${payWayHTML({ planKey: "pro-yearly", kind: "yearly", price: PRO.yearly, per: t("pricing.perYearShort"), note: t("pricing.way.yearly.note"), credits: t("pricing.f.credits", { n: PRO.credits }) }, uid)}
          ${payWayHTML({ planKey: FOUNDER.key, kind: "lifetime", price: tier.price, per: t("pricing.payOnce"), note: t("pricing.way.lifetime.note"), credits: t("pricing.f.creditsMonth", { n: FOUNDER.credits }), win: true, soldOut: founderSoldOut }, uid)}
        </div>
        <details class="pricing-other">
          <summary>${t("pricing.other.title")}${icon("chevronDown", { size: 16 })}</summary>
          ${OTHER_PLANS.map((plan) => otherPlanHTML(plan, uid)).join("")}
          <p class="pricing-renew-note">${t("pricing.renewNote")}</p>
        </details>
      </section>

      <section class="pricing-ultimate" id="ultimate">
        <div class="pricing-ultimate-main">
          <span class="pricing-ultimate-tag">${t("pricing.ultimate.tag")}</span>
          <h2 class="pricing-ultimate-title">${t("pricing.founder-ultimate.name")}</h2>
          <p class="pricing-ultimate-sub">${t("pricing.ultimate.sub", { n: ULTIMATE.brands })}</p>
          <ul class="pricing-features">${featuresHTML(ULTIMATE)}</ul>
        </div>
        <div class="pricing-ultimate-buy">
          <div class="pricing-ultimate-brands"><strong>${ULTIMATE.brands}</strong><span>${t("pricing.ultimate.brandsLabel")}</span></div>
          <div class="pricing-price-row"><span class="pricing-price">${rp(ULTIMATE.price)}</span><span class="pricing-per">${t("pricing.payOnce")}</span></div>
          <p class="pricing-price-note">${t("pricing.ultimate.perBrand", { price: rp(Math.round(ULTIMATE.price / ULTIMATE.brands / 100) * 100) })}</p>
          <p class="pricing-ultimate-limit">${t("pricing.limited")} · ${t("pricing.ultimate.slots", { cap: FOUNDER_SLOT_CAPS[ULTIMATE.slotField] })}</p>
          ${ultimateSoldOut
            ? `<button type="button" class="btn pricing-ultimate-cta btn-block pricing-cta" disabled>${t("pricing.soldOut")}</button>`
            : ctaHTML(ULTIMATE.key, t("pricing.choose", { plan: t("pricing.founder-ultimate.name") }), uid, "pricing-ultimate-cta")}
        </div>
      </section>
      <p class="pricing-founder-note">${t("pricing.founder.note")}</p>

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
      </section>

      <section class="pricing-faq">
        <h2 class="pricing-section-title">${t("pricing.faq.title")}</h2>
        ${FAQ_KEYS.map((k, i) => `
          <details class="pricing-faq-item" ${i === 0 ? "open" : ""}>
            <summary>${t(`pricing.faq.${k}.q`, { days: TRIAL_DAYS })}${icon("chevronDown", { size: 16 })}</summary>
            <p>${t(`pricing.faq.${k}.a`, { days: TRIAL_DAYS, months })}</p>
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
  };

  paint();

  // The live sold-count decides which Founder wave is open (and whether
  // anything is sold out) — it is never displayed. Repaint only if it
  // changes what the page says, so the ledger's entrance doesn't replay.
  getDoc(doc(fdb, "meta", "founderSlots"))
    .then((snap) => {
      if (!root.isConnected) return;
      const before = openTier(null);
      slots = snap.exists() ? snap.data() : {};
      const ultimateGone = (Number(slots[ULTIMATE.slotField]) || 0) >= FOUNDER_SLOT_CAPS[ULTIMATE.slotField];
      if (openTier(slots[FOUNDER.slotField]) === before && !ultimateGone) return;
      const y = window.scrollY;
      paint();
      window.scrollTo(0, y);
    })
    .catch((err) => console.warn("Founder slot count unavailable", err));
}
