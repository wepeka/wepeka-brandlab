// The front page of brandlab.wepeka.com for anyone who is not signed in: the
// same page as www.wepeka.com/brandlab (hero, guide videos, why, who it is
// for, the module walkthrough, value stack, FAQ, closing band), with the
// plans moved up right under the hero — whoever types this address mostly
// wants to know what it costs. Account holders get "Masuk ke Lab-mu" in the
// header, the hero and the sticky bar; on a browser that has signed in
// before (js/paywall.js) it is the main button.
//
// Where things come from:
//   copy         js/landing-copy.<lang>.js, a copy of wpk-dp's dictionary
//   numbers      the plan table in js/views/pricing.js (its {tokens})
//   plans        that same module, rendered with `embed`
//   videos       /api/guide-videos, the list the app itself plays
//   screenshots  assets/landing/shots, copies of wpk-dp's public/brandlab/shots
//
// In-page links are buttons that scroll (data-lp-goto), never "#anchor"
// hrefs: while signed out, every hashchange repaints this page (js/main.js).
//
// Every price button (the hero's Lifetime, a plan card's, the closing
// band's Founder) is a buy link: sign in or register on wepeka.com, then the
// checkout of that plan opens by itself back here (site-links.js buyUrl,
// js/buy-intent.js). No stop at a second plans page in between.
import { icon } from "../icons.js";
import { qs, qsa, escapeHtml } from "../dom.js";
import { t, getLang } from "../i18n.js";
import { gaEvent } from "../analytics.js";
import { rp } from "../purchase.js";
import { TRIAL_DAYS } from "../account.js";
import { TRIAL_AI_PER_DAY } from "../ai-usage.js";
import { WEPEKA_CONNECT_URL, WEPEKA_SITE_URL, SUPPORT_WA_NUMBER, buyUrl } from "../site-links.js";
import { termsLink, privacyLink } from "../legal-links.js";
import { showPayLoading, hidePayLoading } from "../pay-loading.js";
import { localNumber } from "../upgrade-doors.js";
import { render as renderPlans, SUBSCRIPTIONS, STUDIO, FOUNDER, AGENCY, FOUNDER_SLOT_CAPS, BOOK_STYLES_VALUE, LIFETIME_NORMAL_PRICE, AGENCY_NORMAL_PRICE } from "./pricing.js";

// One language per visitor, like the app's own dictionary.
const COPY = (await (getLang() === "en" ? import("../landing-copy.en.js") : import("../landing-copy.id.js"))).default;
const F = COPY.funnel;

// ---------- numbers the copy quotes ----------
// Typical monthly rate for a social media agency / manager on a small
// business account: the value stack's anchor (wpk-dp brandlab-plans.ts
// AGENCY_MONTHLY — keep the two in step).
const AGENCY_MONTHLY = { from: 1500000, to: 5000000 };
const STARTER = SUBSCRIPTIONS[1];
const PRO = SUBSCRIPTIONS[3];
const FOUNDER_CAP = FOUNDER_SLOT_CAPS[FOUNDER.slotField];
const yearlySaving = (plan) => plan.monthly * 12 - plan.yearly;

function copyVars() {
  return {
    days: TRIAL_DAYS,
    credits: TRIAL_AI_PER_DAY,
    cap: FOUNDER_CAP,
    brands: FOUNDER.brands,
    founderCredits: FOUNDER.credits,
    first: FOUNDER.tiers[0].people,
    next: FOUNDER.tiers[1].people,
    priceFirst: rp(FOUNDER.tiers[0].price),
    priceNext: rp(FOUNDER.tiers[1].price),
    normal: rp(LIFETIME_NORMAL_PRICE),
    styleValue: rp(BOOK_STYLES_VALUE),
    starterMonthly: rp(STARTER.monthly),
    starterYearly: rp(STARTER.yearly),
    starterCredits: STARTER.credits,
    saveStarter: rp(yearlySaving(STARTER)),
    proMonthly: rp(PRO.monthly),
    proYearly: rp(PRO.yearly),
    proCredits: PRO.credits,
    savePro: rp(yearlySaving(PRO)),
    studioMonthly: rp(STUDIO.monthly),
    studioYearly: rp(STUDIO.yearly),
    studioBrands: STUDIO.brands,
    studioCredits: STUDIO.credits,
    saveStudio: rp(yearlySaving(STUDIO)),
    agencyPrice: rp(AGENCY.price),
    agencyNormal: rp(AGENCY_NORMAL_PRICE),
    agencyBrands: AGENCY.brands,
    agencyCredits: AGENCY.credits,
    perBrand: rp(Math.round(AGENCY.price / AGENCY.brands / 1000) * 1000),
    ultimateCap: FOUNDER_SLOT_CAPS[AGENCY.slotField],
    from: rp(AGENCY_MONTHLY.from),
    to: rp(AGENCY_MONTHLY.to),
  };
}
const VARS = copyVars();
const fill = (str, extra) => String(str ?? "").replace(/\{(\w+)\}/g, (m, k) => (extra && k in extra ? extra[k] : k in VARS ? VARS[k] : m));
// Copy → HTML text: tokens filled, then escaped ("Brand DNA & Brand Book").
const x = (str, extra) => escapeHtml(fill(str, extra));
const arrow = () => icon("arrowRight", { size: 16 });

// Which Founder wave the next buyer pays for, from the seats taken (sold +
// held by an open checkout) — the same count the Founder card prices from.
export function founderNow(taken = 0) {
  const i = FOUNDER.tiers.findIndex((tier) => taken < tier.upTo);
  const soldOut = i === -1;
  const wave = FOUNDER.tiers[soldOut ? FOUNDER.tiers.length - 1 : i];
  const left = soldOut ? 0 : wave.upTo - taken;
  return { soldOut, wave, nextWave: soldOut ? null : FOUNDER.tiers[i + 1] || null, left, takenInWave: wave.people - left };
}

// Until the server answers: no seat numbers anywhere, first wave's price.
const NO_FACTS = { live: false, founderTaken: 0, agencyTaken: 0, payOpen: null };

// ---------- small pieces ----------
const headHTML = (eyebrow, title, sub) => `
  <div class="lp-head lp-reveal">
    ${eyebrow ? `<span class="pricing-pill pricing-pill--eyebrow">${x(eyebrow)}</span>` : ""}
    <h2 class="lp-h2">${x(title)}</h2>
    ${sub ? `<p class="lp-sub">${x(sub)}</p>` : ""}
  </div>`;

const checksHTML = (points, cls = "") => `<ul class="lp-checks ${cls}">${points.map((p) => `<li>${icon("check", { size: 15 })}<span>${x(p)}</span></li>`).join("")}</ul>`;

const trialLink = (place, label, cls = "lp-btn--pink") =>
  `<a class="btn lp-btn ${cls}" href="${WEPEKA_CONNECT_URL}" data-lp-cta="${place}">${label}${arrow()}</a>`;
const enterLink = (place, cls = "lp-btn--pink") =>
  `<a class="btn lp-btn ${cls}" href="#/login" data-lp-enter="${place}">${t("landing.enter")}${arrow()}</a>`;

// The Founder seat counter: seats left in the open wave as one big number,
// the price cut from Lifetime's normal price, what happens once they are
// gone, and the wave's seats drawn one by one (owner's decision 2026-10-12:
// show how many are taken). Nothing while the count is unknown or sold out.
function seatCounterHTML(facts, size = "lg") {
  if (!facts.live) return "";
  const now = founderNow(facts.founderTaken);
  if (now.soldOut) return "";
  const s = F.seatCounter;
  const then = now.nextWave ? x(s.thenUp, { next: rp(now.nextWave.price) }) : x(s.thenNormal);
  const pips = Array.from({ length: now.wave.people }, (_, i) => `<i${i < now.takenInWave ? ' class="is-taken"' : ""}></i>`).join("");
  const takenText = now.takenInWave > 0 ? x(s.taken, { taken: now.takenInWave, total: now.wave.people }) : x(s.noneTaken, { total: now.wave.people });
  return `
    <button type="button" class="lp-seats lp-seats--${size}" data-lp-goto="harga">
      <span class="lp-seats-top">
        <span class="lp-seats-n">${now.left}</span>
        <span class="lp-seats-text">
          <span class="lp-seats-label">${x(s.label)}<span class="lp-live" title="${x(s.live)}"></span></span>
          <span class="lp-seats-price">${x(s.atPrice)} <s>${rp(LIFETIME_NORMAL_PRICE)}</s> <strong>${rp(now.wave.price)}</strong>. <em>${then}</em></span>
        </span>
      </span>
      <span class="lp-seats-row"><span class="lp-pips" aria-hidden="true">${pips}</span><span>${takenText}</span></span>
      <span class="lp-seats-grow">${icon("chart", { size: 14 })}<span>${x(s.grow)}</span></span>
    </button>`;
}

function contactHTML() {
  const c = F.contact;
  const href = `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(c.message)}`;
  return `
    <a class="lp-contact" href="${href}" target="_blank" rel="noopener noreferrer">
      <span class="lp-contact-ic">${icon("chat", { size: 18 })}</span>
      <span class="lp-contact-text"><strong>${x(c.title)}</strong><span>${x(c.body)} <b>${localNumber(SUPPORT_WA_NUMBER)}</b></span></span>
    </a>`;
}

// ---------- parts that follow the live seat count ----------
// Each one fills a [data-lp-live] box and is painted again when the server
// answers (seats taken, checkout open or not).
const LIVE = {
  heroSeats(facts) {
    const counter = seatCounterHTML(facts);
    if (counter) return counter;
    return founderNow(facts.founderTaken).soldOut ? "" : `<p class="lp-limited">${icon("sparkle", { size: 13 })}${x(COPY.ctaLimited)}</p>`;
  },
  heroCta(facts, returning) {
    const now = founderNow(facts.founderTaken);
    const buy = now.soldOut ? "" : `
      <a class="btn btn-secondary lp-btn lp-buy" href="${buyUrl(FOUNDER.key)}" data-lp-buy="hero">
        <span class="lp-buy-tag">${x(COPY.ctaBuyTag)}</span>
        ${x(COPY.ctaBuy, { price: "" }).trim()} <s>${rp(LIFETIME_NORMAL_PRICE)}</s> ${rp(now.wave.price)}${arrow()}
      </a>`;
    if (returning) {
      return `
        <div class="lp-hero-btns">
          ${enterLink("hero")}
          <button type="button" class="btn btn-secondary lp-btn" data-lp-goto="harga">${x(F.seePlans)}</button>
        </div>
        <p class="lp-hero-alt">${t("auth.noAccount")} <a href="${WEPEKA_CONNECT_URL}" data-lp-cta="hero-alt">${x(COPY.cta)}</a></p>`;
    }
    return `
      <div class="lp-hero-btns">
        ${trialLink("hero", x(COPY.cta))}
        ${buy}
      </div>
      <p class="lp-hero-alt">${t("pricing.alreadyHave")} <a href="#/login" data-lp-enter="hero-alt">${t("landing.enter")}${icon("arrowRight", { size: 13 })}</a></p>`;
  },
  stackTotal(facts) {
    const s = F.stack;
    const now = founderNow(facts.founderTaken);
    const savePct = Math.round((1 - now.wave.price / LIFETIME_NORMAL_PRICE) * 100);
    return `
      <p class="lp-stack-label">${x(s.totalLabel)}</p>
      ${now.soldOut ? "" : `<p class="lp-stack-was"><span>${x(s.normalLabel)}</span><s>${rp(LIFETIME_NORMAL_PRICE)}</s><span class="pricing-save">${x(F.offer.founder.save, { pct: savePct })}</span></p>`}
      <p class="lp-stack-price ${now.soldOut ? "is-gone" : ""}">${rp(now.wave.price)}</p>
      <p class="lp-stack-desc">${x(s.totalDesc)}</p>`;
  },
  finalCta(facts, returning) {
    const c = F.finalCta;
    const now = founderNow(facts.founderTaken);
    const counter = seatCounterHTML(facts, "md");
    return `
      <div class="lp-hero-btns">
        ${returning ? enterLink("final") : ""}
        ${trialLink("final", x(c.trialCta), returning ? "btn-secondary" : "lp-btn--pink")}
        ${now.soldOut ? "" : `<a class="btn btn-secondary lp-btn" href="${buyUrl(FOUNDER.key)}" data-lp-buy="final">${x(c.founderCta)}${arrow()}</a>`}
      </div>
      ${counter || (now.soldOut ? "" : `<p class="lp-final-note">${x(F.slotsChipUnknown)}</p>`)}
      ${returning ? "" : `<p class="lp-hero-alt">${t("pricing.alreadyHave")} <a href="#/login" data-lp-enter="final">${t("landing.enter")}${icon("arrowRight", { size: 13 })}</a></p>`}`;
  },
  sticky(facts, returning) {
    const now = founderNow(facts.founderTaken);
    // An account holder is offered the way in, not a trial.
    const title = returning ? t("pricing.alreadyHave") : x(F.sticky.title);
    const slot = now.soldOut ? "" : facts.live ? `${x(F.slotsChip, { n: now.left, price: rp(now.wave.price) })} <s>${rp(LIFETIME_NORMAL_PRICE)}</s>` : x(F.slotsChipUnknown);
    const button = returning
      ? `<a class="btn lp-btn lp-btn--pink" href="#/login" data-lp-enter="sticky">${t("landing.enter")}${arrow()}</a>`
      : `<a class="btn lp-btn lp-btn--pink" href="${WEPEKA_CONNECT_URL}" data-lp-cta="sticky"><span class="lp-sticky-long">${title}</span><span class="lp-sticky-short">${x(F.sticky.cta)}</span>${arrow()}</a>`;
    return `
      <span class="lp-sticky-ic">${icon("sparkle", { size: 18 })}</span>
      <span class="lp-sticky-text"><strong>${title}</strong>${slot ? `<span>${slot}</span>` : ""}</span>
      ${button}`;
  },
};
const liveBox = (name, facts, returning, tag = "div", cls = "") => `<${tag} class="${cls}" data-lp-live="${name}">${LIVE[name](facts, returning)}</${tag}>`;

// ---------- sections ----------
function navHTML(returning) {
  const links = [["harga", "plans"], ["video", "videos"], ["modul", "features"], ["faq", "faq"]];
  return `
    <header class="lp-nav">
      <div class="lp-nav-in">
        <div class="brand-mark">
          <span class="brand-logo" role="img" aria-label="Wepeka"></span>
          <span class="brand-mark-divider"></span>
          Brandlab
        </div>
        <nav class="lp-nav-links" aria-label="${t("landing.nav.label")}">
          ${links.map(([id, key]) => `<button type="button" data-lp-goto="${id}"${id === "video" ? " data-lp-needs-videos hidden" : ""}>${t(`landing.nav.${key}`)}</button>`).join("")}
        </nav>
        <div class="lp-nav-actions">
          <a class="btn btn-sm ${returning ? "lp-btn--pink" : "btn-secondary"}" href="#/login" id="lp-login" data-lp-enter="nav">${t("landing.enter")}</a>
          ${returning ? "" : `<a class="btn btn-sm lp-btn--pink lp-nav-try" href="${WEPEKA_CONNECT_URL}" data-lp-cta="nav">${t("landing.tryShort")}</a>`}
        </div>
      </div>
    </header>`;
}

function heroHTML(facts, returning) {
  return `
    <section class="lp-hero">
      <span class="pricing-pill pricing-pill--eyebrow">${x(COPY.eyebrow)}</span>
      <h1 class="lp-h1">${x(COPY.title)}</h1>
      <p class="lp-lead">${x(COPY.subtitle)}</p>
      ${liveBox("heroSeats", facts, returning, "div", "lp-hero-seats")}
      ${liveBox("heroCta", facts, returning, "div", "lp-hero-cta")}
      <div class="lp-audience">
        <p>${x(COPY.audienceTitle)}</p>
        <ul>${COPY.audienceItems.map((a) => `<li><span aria-hidden="true">✓</span><span><strong>${x(a.who)}</strong> — ${x(a.why)}</span></li>`).join("")}</ul>
      </div>
      <button type="button" class="lp-cue" data-lp-goto="harga"><span>${x(F.seePlans)}</span><span class="lp-cue-ic">${icon("chevronDown", { size: 18 })}</span></button>
    </section>`;
}

// The plans: the trial first (it is the way in), then the two ways to
// continue — the pricing page's own cards, so the prices, the open Founder
// wave and "sold out" are the same ones checkout uses.
function plansHTML() {
  const o = F.offer;
  return `
    <section class="lp-section" id="lp-harga">
      ${headHTML(o.eyebrow, o.title, o.subtitle)}
      <div class="lp-trial lp-reveal">
        <div class="lp-trial-main">
          <span class="lp-tag lp-tag--green">${x(o.trial.badge)}</span>
          <h3>${x(o.trial.title)}</h3>
          <p>${x(o.trial.body)}</p>
        </div>
        ${checksHTML(o.trial.points, "lp-checks--green")}
        <div class="lp-trial-cta">
          ${trialLink("plans-trial", x(o.trial.cta), "btn-secondary")}
          <p>${x(o.trial.note)}</p>
        </div>
      </div>
      <div id="lp-plans"></div>
      <div class="lp-center">${contactHTML()}</div>
    </section>`;
}

function whyHTML() {
  const w = F.why;
  const cardIcons = ["target", "money", "flag"];
  const pointIcons = ["chart", "sparkle", "users"];
  const stepIcons = ["book", "calendar", "chart", "refresh"];
  return `
    <section class="lp-section" id="lp-kenapa">
      ${headHTML(w.eyebrow, w.title, w.lead)}
      <div class="lp-why-cards">
        ${w.cards.map((card, i) => `
          <article class="lp-card lp-why-card ${i === w.cards.length - 1 ? "is-hot" : ""} lp-reveal">
            <div class="lp-why-top"><span class="lp-why-ic">${icon(cardIcons[i] || "sparkle", { size: 20 })}</span><span class="lp-why-no">0${i + 1}</span></div>
            <h3>${x(card.title)}</h3>
            <p>${x(card.body)}</p>
          </article>`).join("")}
      </div>
      <div class="lp-vision lp-reveal">
        <div class="lp-vision-top">
          <div>
            <span class="lp-vision-eyebrow">${x(w.vision.eyebrow)}</span>
            <h3>${x(w.vision.title)}</h3>
            <p>${x(w.vision.body)}</p>
          </div>
          <ul>${w.vision.points.map((pt, i) => `<li><span>${icon(pointIcons[i] || "sparkle", { size: 18 })}</span><span>${x(pt)}</span></li>`).join("")}</ul>
        </div>
        <div class="lp-fly">
          <p class="lp-fly-label">${x(w.vision.flywheel.label)}</p>
          <ol>
            ${w.vision.flywheel.steps.map((step, i) => `
              <li>
                <span class="lp-fly-n">${i + 1}</span>
                <div><strong>${icon(stepIcons[i] || "refresh", { size: 14 })}${x(step.title)}</strong><p>${x(step.body)}</p></div>
              </li>`).join("")}
          </ol>
          <p class="lp-fly-note">${icon("refresh", { size: 14 })}<span>${x(w.vision.flywheel.note)}</span></p>
        </div>
      </div>
    </section>`;
}

function fitHTML() {
  const f = F.fit;
  const list = (items, name) => `<ul>${items.map((item) => `<li>${icon(name, { size: 16 })}<span>${x(item)}</span></li>`).join("")}</ul>`;
  return `
    <section class="lp-section" id="lp-cocok">
      ${headHTML(f.eyebrow, f.title, f.subtitle)}
      <div class="lp-fit">
        <div class="lp-card lp-fit-card is-yes lp-reveal">
          <h3><span>${icon("check", { size: 16 })}</span>${x(f.yesTitle)}</h3>
          ${list(f.yes, "check")}
        </div>
        <div class="lp-card lp-fit-card is-no lp-reveal">
          <h3><span>${icon("x", { size: 16 })}</span>${x(f.noTitle)}</h3>
          ${list(f.no, "x")}
        </div>
      </div>
    </section>`;
}

// One entry per module, in the order of the copy's modules.items: the hue
// its screenshots were taken in (the demo brand's Brand Color changes per
// module, and the frame picks the same hue), its screenshots with their
// corner tag, and which guide videos belong under it (by description key).
// `wide`: a single screenshot too dense for half a row (the goal roadmap).
const SHOT_DIR = "assets/landing/shots";
const MODULES = [
  { color: "#FFA52B", videos: ["dna", "book"], shots: [["01-brand-dna.jpg", "AI"], ["02-brand-book-warna.jpg", "Warna"]] },
  { color: "#30D97D", videos: ["grow", "goal", "event"], shots: [["03-tujuan-roadmap.jpg", "Roadmap"]], wide: true },
  { color: "#3B9BFF", videos: ["script", "flow", "series"], shots: [["05-creator-script.jpg", "Script"], ["06-teleprompter.jpg", "Teleprompter"], ["04-daftar-konten.jpg", "Terbit"]] },
  { color: "#0EA5E9", videos: ["calendar"], shots: [["07-kalender.jpg", "Jadwal"]] },
  { color: "#A974FF", videos: ["list"], shots: [["08-insight-screenshot.jpg", "Report"], ["08-laporan-pdf.jpg", "PDF"]] },
  { color: "#FF6FAE", videos: ["aiIntro", "ask", "credits"], shots: [["09-tanya-brandlab.jpg", "AI"]] },
  { color: "#D946EF", videos: ["sales", "quick"], shots: [["10-brainstorm.jpg", "Brainstorm"], ["10-tulisan-cepat.jpg", "Tulisan Cepat"]] },
];

// A screenshot in a browser-window frame; click opens it large.
function frameHTML([file, badge], alt) {
  const src = `${SHOT_DIR}/${file}`;
  const label = escapeHtml(alt);
  return `
    <figure class="lp-frame">
      <div class="lp-frame-box">
        <div class="lp-frame-bar"><i></i><i></i><i></i><span class="lp-frame-chip"><img src="assets/wepeka-favicon-32.png" alt="" width="16" height="16" />Wepeka Brandlab</span></div>
        <button type="button" class="lp-frame-shot" data-lp-zoom="${src}" data-lp-alt="${label}" aria-label="${x(F.modules.zoom)}: ${label}">
          <img src="${src}" alt="${label}" width="1920" height="1200" loading="lazy" decoding="async" />
        </button>
      </div>
      <span class="lp-frame-badge">${escapeHtml(badge)}</span>
    </figure>`;
}

function modulesHTML() {
  const m = F.modules;
  return `
    <section class="lp-section" id="lp-modul">
      ${headHTML(m.eyebrow, m.title, m.subtitle)}
      <ol class="lp-modules">
        ${m.items.map((item, i) => {
          const mod = MODULES[i] || MODULES[0];
          const gallery = mod.shots.length > 1 || mod.wide;
          const text = `
            <div class="lp-mod-name"><span>${i + 1}</span><h3>${x(item.name)}</h3></div>
            <p class="lp-mod-tag">${x(item.tagline)}</p>
            ${checksHTML(item.points, gallery ? "lp-checks--2col" : "")}
            <div class="lp-watch" data-lp-watch-for="${i}" hidden></div>`;
          const shots = mod.shots.map((shot) => frameHTML(shot, mod.shots.length > 1 ? `${fill(item.name)} — ${shot[1]}` : fill(item.name))).join("");
          return `
            <li class="lp-mod ${gallery ? "is-gallery" : ""} ${i % 2 === 1 ? "is-flip" : ""}" style="--m:${mod.color}">
              <div class="lp-mod-text lp-reveal">${text}</div>
              <div class="lp-mod-shots lp-mod-shots--${mod.wide ? "wide" : mod.shots.length} lp-reveal">${shots}</div>
            </li>`;
        }).join("")}
      </ol>
      <div class="lp-center lp-mod-foot lp-reveal">
        <p>${x(m.modeNote)}</p>
        ${trialLink("modules", x(m.cta))}
      </div>
    </section>`;
}

function stackHTML(facts) {
  const s = F.stack;
  return `
    <section class="lp-section" id="lp-nilai">
      ${headHTML(s.eyebrow, s.title, s.subtitle)}
      <div class="lp-card lp-stack lp-reveal">
        <ul>
          ${s.rows.map((row) => `
            <li>
              <div class="lp-stack-what"><span>${icon("check", { size: 14 })}</span><div><strong>${x(row.name)}</strong><p>${x(row.desc)}</p></div></div>
              <p class="lp-stack-value ${row.struck ? "is-struck" : ""}">${row.value ? x(row.value) : x(s.included)}</p>
            </li>`).join("")}
        </ul>
        ${liveBox("stackTotal", facts, false, "div", "lp-stack-total")}
      </div>
      <p class="lp-fine">${x(s.fine)}</p>
    </section>`;
}

function faqHTML() {
  const f = F.faq;
  return `
    <section class="lp-section" id="lp-faq">
      ${headHTML(f.eyebrow, f.title)}
      <div class="pricing-faq lp-faq lp-reveal">
        ${f.items.map((item, i) => `
          <details class="pricing-faq-item" ${i === 0 ? "open" : ""}>
            <summary>${x(item.q)}${icon("chevronDown", { size: 16 })}</summary>
            <p${item.aClosed ? ` data-lp-closed="${x(item.aClosed)}"` : ""}>${x(item.a)}</p>
          </details>`).join("")}
      </div>
    </section>`;
}

function finalHTML(facts, returning) {
  const c = F.finalCta;
  return `
    <section class="lp-section lp-section--plain">
      <div class="lp-final lp-reveal">
        <h2 class="lp-h2">${x(c.title)}</h2>
        <p class="lp-sub">${x(c.body)}</p>
        ${liveBox("finalCta", facts, returning, "div", "lp-final-cta")}
        <div class="lp-center">${contactHTML()}</div>
      </div>
    </section>`;
}

const footHTML = () => `
  <footer class="lp-foot">
    <div class="brand-mark"><span class="brand-logo" role="img" aria-label="Wepeka"></span><span class="brand-mark-divider"></span>Brandlab</div>
    <p class="lp-foot-legal">${termsLink()}<span aria-hidden="true">·</span>${privacyLink()}</p>
    <p>${t("landing.foot")} <a href="${WEPEKA_SITE_URL}" target="_blank" rel="noopener noreferrer">wepeka.com</a></p>
  </footer>`;

// The whole page as markup. `returning`: this browser has signed in before.
export function landingHTML({ returning = false, facts = NO_FACTS } = {}) {
  return `
    <div class="pricing-page lp">
      ${navHTML(returning)}
      ${heroHTML(facts, returning)}
      ${plansHTML()}
      <section class="lp-section" id="lp-video" hidden></section>
      ${whyHTML()}
      ${fitHTML()}
      ${modulesHTML()}
      ${stackHTML(facts)}
      ${faqHTML()}
      ${finalHTML(facts, returning)}
      ${footHTML()}
      ${liveBox("sticky", facts, returning, "div", "lp-sticky")}
    </div>`;
}

// ---------- guide videos ----------
// The app's own guide videos (Admin → Brandlab → Video Panduan) as one flat
// list: the "what is Brandlab" video first — it is the big one — then the
// app's tab order, each filed under a topic. Mirrors wpk-dp's
// lib/brandlab-guide-library.ts.
const SLOT_ORDER = [
  ["kenalan", "intro"],
  ["akun-baru", "intro"],
  ["beranda", "intro"],
  ["brand-builder", "brand"],
  ["campaign", "goals"],
  ["sales", "goals"],
  ["content-os", "content"],
  ["copy", "content"],
  ["tanya-brandlab", "ai"],
];
// A part's one-line description is picked from its admin title; first match
// wins, and a slot's last rule has no pattern and catches everything else.
const BLURB_RULES = {
  kenalan: [{ blurb: "intro" }],
  "akun-baru": [{ blurb: "welcome" }],
  beranda: [{ match: /mode|menu|pengaturan|setting/i, blurb: "settings" }, { blurb: "home" }],
  "brand-builder": [{ match: /book|guideline|pedoman/i, blurb: "book" }, { blurb: "dna" }],
  campaign: [{ match: /event/i, blurb: "event" }, { match: /grow/i, blurb: "grow" }, { blurb: "goal" }],
  sales: [{ blurb: "sales" }],
  "content-os": [
    { match: /kalender|calendar|jadwal/i, blurb: "calendar" },
    { match: /daftar|dra(f|ft)\b|database/i, blurb: "list" },
    { match: /\bseri(es)?\b/i, blurb: "series" },
    { match: /flow|alur|syuting|terbit|produksi/i, blurb: "flow" },
    { blurb: "script" },
  ],
  copy: [{ blurb: "quick" }],
  "tanya-brandlab": [
    { match: /credit|kredit/i, blurb: "credits" },
    { match: /perkenalan|kenalan|intro/i, blurb: "aiIntro" },
    { blurb: "ask" },
  ],
};
const TOPIC_ORDER = ["intro", "brand", "goals", "content", "ai"];
// One colour per topic, the same family as the matching module's frame.
const TOPIC_COLOR = { intro: "#d946ef", brand: "#06b6d4", goals: "#8b5cf6", content: "#ec4899", ai: "#f59e0b" };
// Phones show this many rows until "see all" is pressed.
const COLLAPSED_ROWS = 5;
// Same pattern as js/guide-videos.js (that module is the in-app player and
// far too heavy to load here for one expression).
const YOUTUBE_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/|video\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/i;

export function buildLibrary(videos) {
  const out = [];
  for (const [slot, topic] of SLOT_ORDER) {
    const entry = videos?.[slot];
    const parts = entry?.parts?.length ? entry.parts : entry?.src ? [{ title: "", src: entry.src, seconds: entry.seconds }] : [];
    parts.forEach((part, i) => {
      const title = String(part.title || "");
      const blurbKey = BLURB_RULES[slot].find((rule) => !rule.match || rule.match.test(title)).blurb;
      out.push({
        id: `${slot}-${i}`,
        topic,
        blurbKey,
        title: title || F.videos.names[blurbKey],
        blurb: F.videos.blurbs[blurbKey],
        seconds: Math.max(0, Math.round(Number(part.seconds) || 0)),
        youtubeId: String(part.src).match(YOUTUBE_RE)?.[1] || null,
        src: String(part.src),
      });
    });
  }
  return out;
}

const duration = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const noThumbHTML = () => `<span class="lp-thumb lp-thumb--none">${icon("play", { size: 16 })}</span>`;
// YouTube's own thumbnail; thumbFallback() steps down when it is missing.
const thumbHTML = (item, large = false) =>
  item.youtubeId
    ? `<img class="lp-thumb" src="https://i.ytimg.com/vi/${item.youtubeId}/${large ? "maxresdefault" : "mqdefault"}.jpg" alt="" ${large ? "" : 'loading="lazy" '}decoding="async" data-lp-yt="${item.youtubeId}" />`
    : noThumbHTML();

// A video without the big thumbnail answers with a tiny grey stand-in (120 px
// wide, sent as a 404 that still renders), so an error and a too-small image
// both step down: big → standard → the topic-coloured placeholder.
function thumbFallback(e) {
  const img = e.target;
  if (!img?.dataset?.lpYt) return;
  if (e.type === "load" && img.naturalWidth > 120) return;
  if (img.dataset.lpStep) {
    img.outerHTML = noThumbHTML();
    return;
  }
  img.dataset.lpStep = "1";
  img.src = `https://i.ytimg.com/vi/${img.dataset.lpYt}/hqdefault.jpg`;
}

function embedHTML(item) {
  const vimeo = item.src.match(VIMEO_RE)?.[1];
  const url = item.youtubeId
    ? `https://www.youtube-nocookie.com/embed/${item.youtubeId}?autoplay=1&rel=0&playsinline=1`
    : vimeo
      ? `https://player.vimeo.com/video/${vimeo}?autoplay=1`
      : null;
  return url
    ? `<iframe src="${url}" title="${escapeHtml(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
    : `<video src="${escapeHtml(item.src)}" controls autoplay playsinline></video>`;
}

// The 16:9 frame: a poster with a play button until it is played, then the
// video itself.
function stageHTML(item, playing, tag) {
  const box = (inner) => `<div class="lp-stage-box" style="--tc:${TOPIC_COLOR[item.topic]}">${inner}</div>`;
  if (playing) return box(embedHTML(item));
  return box(`
    <button type="button" class="lp-stage-poster" data-lp-play="${item.id}" data-lp-place="stage" aria-label="${x(F.videos.play)}: ${escapeHtml(item.title)}">
      ${thumbHTML(item, true)}
      <span class="lp-stage-shade"></span>
      <span class="lp-stage-play">${icon("play", { size: 28 })}</span>
      <span class="lp-stage-meta">
        <span>${tag ? `<span class="lp-tag lp-tag--topic">${escapeHtml(tag)}</span>` : ""}<strong>${escapeHtml(item.title)}</strong></span>
        <span class="lp-dur">${duration(item.seconds)}</span>
      </span>
    </button>`);
}

function videosHTML(items) {
  const v = F.videos;
  const minutes = Math.max(1, Math.round(items.reduce((sum, item) => sum + item.seconds, 0) / 60));
  const topics = TOPIC_ORDER.filter((k) => items.some((item) => item.topic === k));
  return `
    ${headHTML(v.eyebrow, v.title, v.subtitle)}
    <div class="lp-vid">
      <div class="lp-vid-main">
        <div class="lp-stage" data-lp-stage></div>
        <div class="lp-vid-now" data-lp-now></div>
      </div>
      <aside class="lp-vid-side">
        <div class="lp-vid-panel">
        <div class="lp-vid-tools">
          <div class="lp-vid-title"><h3>${x(v.libraryTitle)}</h3><span>${x(v.count, { n: items.length, min: minutes })}</span></div>
          <label class="lp-vid-search">
            <span class="sr-only">${x(v.searchLabel)}</span>
            ${icon("search", { size: 16 })}
            <input type="search" class="input" placeholder="${x(v.searchPlaceholder)}" data-lp-search />
          </label>
          <div class="lp-vid-topics">
            ${["all", ...topics].map((k) => `<button type="button" class="lp-chip" data-lp-topic="${k}"${k === "all" ? "" : ` style="--tc:${TOPIC_COLOR[k]}"`} aria-pressed="${k === "all"}">${x(v.topics[k])}</button>`).join("")}
          </div>
        </div>
        <ul class="lp-vid-list" data-lp-list></ul>
        <button type="button" class="lp-vid-more" data-lp-more hidden></button>
        </div>
      </aside>
    </div>`;
}

// ---------- pop-up (a video opened from a module, a screenshot opened large) ----------
function openLightbox({ title, sub = "", bodyHTML, kind }) {
  const back = document.activeElement;
  const box = document.createElement("div");
  box.className = `lp-lightbox lp-lightbox--${kind}`;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", title);
  box.innerHTML = `
    <div class="lp-lightbox-in">
      <div class="lp-lightbox-head">
        <div><strong>${escapeHtml(title)}</strong>${sub ? `<span>${escapeHtml(sub)}</span>` : ""}</div>
        <button type="button" class="lp-lightbox-x" aria-label="${x(kind === "video" ? F.videos.close : F.modules.zoomClose)}">${icon("x", { size: 20 })}</button>
      </div>
      <div class="lp-lightbox-body">${bodyHTML}</div>
    </div>`;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    box.remove();
    document.body.style.overflow = "";
    back?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  // Outside the picture or the player (or on the picture itself: it is
  // already as large as it gets) closes; the video's own controls don't.
  box.addEventListener("click", (e) => {
    if (e.target.closest(".lp-lightbox-x") || !e.target.closest(kind === "video" ? ".lp-lightbox-in" : ".lp-lightbox-head")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  document.body.appendChild(box);
  qs(".lp-lightbox-x", box).focus();
}

// ---------- the page ----------
// `returning`: this browser has signed in before, so "Masuk ke Lab-mu" is
// the main button. `goto`: a section to open on ("harga" for #/pricing).
export function render(root, { returning = false, goto = null } = {}) {
  let facts = NO_FACTS;
  root.innerHTML = landingHTML({ returning, facts });
  const page = qs(".lp", root);
  if (!page) return; // markup only (tests): nothing to wire

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (id, smooth = true) => qs(`#lp-${id}`, root)?.scrollIntoView({ behavior: smooth && !reduced ? "smooth" : "auto", block: "start" });

  // Sections fade up as they scroll in. Only once this script has run and
  // the browser can tell us when: without it everything is simply visible.
  let seen = null;
  if (!reduced && "IntersectionObserver" in window) {
    page.dataset.lpAnim = "1";
    seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        seen.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
  }
  const watchReveals = (scope) => qsa(".lp-reveal", scope).forEach((el) => (seen ? seen.observe(el) : el.classList.add("is-in")));
  watchReveals(page);

  // ----- plans + what the server says about seats and checkout -----
  const paintLive = () => {
    qsa("[data-lp-live]", page).forEach((el) => {
      el.innerHTML = LIVE[el.dataset.lpLive](facts, returning);
    });
    // "How do I buy" is answered truthfully while online checkout is closed.
    if (facts.payOpen === false) {
      qsa("[data-lp-closed]", page).forEach((el) => {
        el.textContent = el.dataset.lpClosed;
        el.removeAttribute("data-lp-closed");
      });
    }
  };
  renderPlans(qs("#lp-plans", page), {
    embed: true,
    onFacts: (next) => {
      if (!root.isConnected) return;
      facts = next;
      paintLive();
    },
  });

  // ----- guide videos -----
  let items = [];
  const vid = { currentId: null, playing: false, query: "", topic: "all", expanded: false };
  const videoBox = qs("#lp-video", page);
  const current = () => items.find((item) => item.id === vid.currentId) || items[0];
  const paintStage = () => {
    const item = current();
    const stage = qs("[data-lp-stage]", videoBox);
    stage.innerHTML = stageHTML(item, vid.playing, item.id === items[0].id ? fill(F.videos.featuredTag) : fill(F.videos.topics[item.topic]));
    qs("[data-lp-now]", videoBox).innerHTML = `<span class="lp-dot" style="--tc:${TOPIC_COLOR[item.topic]}"></span><div><strong>${escapeHtml(item.title)}</strong><p>${x(item.blurb)}</p></div>`;
  };
  const paintList = () => {
    const v = F.videos;
    const words = vid.query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((item) => {
      if (vid.topic !== "all" && item.topic !== vid.topic) return false;
      const hay = `${item.title} ${item.blurb} ${v.topics[item.topic]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const filtering = words.length > 0 || vid.topic !== "all";
    const active = current();
    const list = qs("[data-lp-list]", videoBox);
    list.classList.toggle("is-all", filtering || vid.expanded);
    list.innerHTML = shown.length === 0
      ? `<li class="lp-vid-empty">${x(v.empty)}</li>`
      : shown.map((item, i) => `
          <li${i >= COLLAPSED_ROWS ? ' class="lp-vid-extra"' : ""}>
            <button type="button" class="lp-vid-row ${item.id === active.id ? "is-active" : ""}" style="--tc:${TOPIC_COLOR[item.topic]}" data-lp-play="${item.id}" data-lp-place="list"${item.id === active.id ? ' aria-current="true"' : ""}>
              <span class="lp-vid-thumb">${thumbHTML(item)}<span class="lp-dur">${duration(item.seconds)}</span></span>
              <span class="lp-vid-text">
                <span class="lp-vid-topic">${item.id === active.id && vid.playing ? x(v.playing) : x(v.topics[item.topic])}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${x(item.blurb)}</span>
              </span>
            </button>
          </li>`).join("");
    const more = qs("[data-lp-more]", videoBox);
    more.hidden = filtering || items.length <= COLLAPSED_ROWS;
    more.textContent = vid.expanded ? fill(v.showLess) : fill(v.showAll, { n: items.length });
    qsa("[data-lp-topic]", videoBox).forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.lpTopic === vid.topic)));
  };
  const play = (item, place) => {
    vid.currentId = item.id;
    vid.playing = true;
    paintStage();
    paintList();
    gaEvent("brandlab_video_play", { video_title: item.title, video_place: place });
    if (place !== "list") return;
    // Phones: the player sits above the list, so bring it back into view.
    const stage = qs("[data-lp-stage]", videoBox);
    const rect = stage.getBoundingClientRect();
    if (rect.top < 72 || rect.bottom > window.innerHeight) stage.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };
  // Opened from a module's "watch" chip: a pop-up, so the walkthrough stays
  // where it is. Two videos must never talk over each other.
  const watch = (item) => {
    if (vid.playing) {
      vid.playing = false;
      paintStage();
      paintList();
    }
    gaEvent("brandlab_video_play", { video_title: item.title, video_place: "module" });
    openLightbox({ kind: "video", title: item.title, sub: fill(item.blurb), bodyHTML: stageHTML(item, true) });
  };
  const showVideos = (list) => {
    items = list;
    if (!items.length || !root.isConnected) return;
    videoBox.innerHTML = videosHTML(items);
    videoBox.hidden = false;
    qsa("[data-lp-needs-videos]", page).forEach((el) => (el.hidden = false));
    paintStage();
    paintList();
    watchReveals(videoBox);
    // Each module gets chips for its own videos (three at most).
    qsa("[data-lp-watch-for]", page).forEach((el) => {
      const wanted = MODULES[Number(el.dataset.lpWatchFor)]?.videos || [];
      const mine = wanted.flatMap((key) => items.filter((item) => item.blurbKey === key)).slice(0, 3);
      if (!mine.length) return;
      el.innerHTML = `<span>${x(F.videos.moduleWatch)}</span>${mine.map((item) => `<button type="button" class="lp-watch-chip" data-lp-watch="${item.id}">${icon("play", { size: 12 })}${escapeHtml(item.title)}<em>${duration(item.seconds)}</em></button>`).join("")}`;
      el.hidden = false;
    });
    if (goto === "video") scrollTo("video", false);
  };
  if (typeof fetch === "function") {
    fetch("/api/guide-videos")
      .then((res) => (res.ok ? res.json() : { videos: {} }))
      .then((data) => showVideos(buildLibrary(data?.videos || {})))
      .catch(() => {}); // no videos: the section simply stays hidden
  }
  videoBox.addEventListener("input", (e) => {
    if (!e.target.matches("[data-lp-search]")) return;
    vid.query = e.target.value;
    paintList();
  });
  page.addEventListener("load", thumbFallback, true);
  page.addEventListener("error", thumbFallback, true);

  // ----- clicks -----
  page.addEventListener("click", (e) => {
    const el = e.target.closest("[data-lp-goto],[data-lp-play],[data-lp-watch],[data-lp-topic],[data-lp-more],[data-lp-zoom],[data-lp-cta],[data-lp-enter],[data-lp-buy],a[data-plan]");
    if (!el) return;
    const d = el.dataset;
    // A buy link (here or on a plan card): it leaves for wepeka.com to sign
    // in, which takes a moment — say where it is going meanwhile.
    if (d.lpBuy || d.plan) {
      showPayLoading("pricing.pay.leaving", "pricing.pay.leavingNote");
      gaEvent("brandlab_cta", { location: d.lpBuy || "plans", intent: "buy", plan: d.plan || FOUNDER.key });
      return;
    }
    const video = items.find((item) => item.id === (d.lpPlay || d.lpWatch));
    if (d.lpGoto) scrollTo(d.lpGoto);
    else if (d.lpPlay) video && play(video, d.lpPlace || "stage");
    else if (d.lpWatch) video && watch(video);
    else if (d.lpTopic) {
      vid.topic = d.lpTopic;
      paintList();
    } else if ("lpMore" in d) {
      vid.expanded = !vid.expanded;
      paintList();
    } else if (d.lpZoom) {
      openLightbox({ kind: "shot", title: d.lpAlt || "", bodyHTML: `<img src="${escapeHtml(d.lpZoom)}" alt="${escapeHtml(d.lpAlt || "")}" />` });
    } else if (d.lpCta) gaEvent("brandlab_cta", { location: d.lpCta, intent: "open" });
    else if (d.lpEnter) gaEvent("brandlab_cta", { location: d.lpEnter, intent: "login" });
  });

  // ----- header shadow + the sticky trial bar -----
  // The bar slides in once the hero has scrolled away. It stays out of the
  // way while the plans are on screen (their own buttons are right there,
  // and on a phone it would sit on top of them) and near the closing band.
  const nav = qs(".lp-nav", page);
  const bar = qs(".lp-sticky", page);
  const plans = qs("#lp-harga", page);
  const onScroll = () => {
    if (!root.isConnected) {
      window.removeEventListener("scroll", onScroll);
      return;
    }
    const y = window.scrollY;
    const vh = window.innerHeight;
    const nearEnd = y + vh > document.documentElement.scrollHeight - 720;
    const box = plans.getBoundingClientRect();
    const atPlans = box.top < vh * 0.7 && box.bottom > vh * 0.6;
    const on = y > vh * 0.85 && !atPlans && !nearEnd;
    nav.classList.toggle("is-scrolled", y > 24);
    bar.classList.toggle("is-on", on);
    bar.inert = !on;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.scrollTo(0, 0);
  onScroll();
  // Back from the sign-in page with the browser's Back button: the page
  // comes out of the back/forward cache as it was left, sheet included.
  const onShow = (e) => {
    if (!root.isConnected) window.removeEventListener("pageshow", onShow);
    else if (e.persisted) hidePayLoading();
  };
  window.addEventListener("pageshow", onShow);

  if (goto && goto !== "video") scrollTo(goto, false);
}
