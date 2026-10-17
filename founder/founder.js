// The Founder's Deal page (founder/index.html → brandlab.wepeka.com/founder),
// the landing for Instagram ads: the Lifetime offer first, live seats, one
// buy button that goes straight to sign-in → checkout (site-links.js buyUrl,
// js/buy-intent.js), the free trial as the second door, and the Wepeka
// Community code (js/promo-code.js, priced by api/_promo.js).
//
// Every number comes from /api/offer (seats sold, the open wave's price,
// how much a community code saves). The markup ships with the opening
// wave's numbers as placeholders, shown as a shimmer until the answer is in;
// FALLBACK is only used when that answer never comes.
import { buyUrl, WEPEKA_CONNECT_URL, SUPPORT_WA_NUMBER, COMMUNITY_WA_GROUP_URL } from "../js/site-links.js";
import { readPromoInfo, rememberPromo, forgetPromo, checkPromo, normalizePromo } from "../js/promo-code.js";
import { metaTrack } from "../js/meta-pixel.js";
import { gaEvent } from "../js/analytics.js";

// Same as api/_plans.js FOUNDER_TIERS, api/offer.js NORMAL_PRICES / PRO_MONTHLY
// and js/account.js TRIAL_DAYS (tests/founder-page.test.mjs keeps them equal).
export const FALLBACK = {
  tiers: [{ seats: 15, price: 499000 }, { seats: 35, price: 599000 }],
  normal: 3000000,
  proMonthly: 99000,
  trialDays: 30,
  agency: { price: 799000, brands: 15, cap: 15 },
};

// What Founders say about Brandlab, word for word and with their OK — the
// owner collects them ({ quote, name, business }). While the list is empty
// the block stays hidden: never a made-up quote.
export const TESTIMONIALS = [];

// A non-breaking space keeps "Rp" and its number on one line.
export const rp = (n) => `Rp\u00a0${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// "1,5 menit" from 95 seconds (rounded to half minutes, at least "1 menit").
export function minutesLabel(seconds) {
  const half = Math.max(2, Math.round((Number(seconds) || 0) / 30));
  return `${String(half / 2).replace(".", ",")} menit`;
}

// "15 kursi pertama Rp 499.000, 35 berikutnya Rp 599.000"
export function tiersSentence(tiers) {
  return tiers.map((t, i) => `${t.seats} ${i === 0 ? "kursi pertama" : "berikutnya"} ${rp(t.price)}`).join(", ");
}

// What the page says, from /api/offer's answer (null = no answer) and the
// community code in hand ({ code, off } or null). Pure, so it is tested
// without a browser.
// "Lihat paket lain": the trial, each subscription with both prices, and
// Agency Lifetime. Buy links get their href in paint() like every [data-buy].
function othersHTML(offer) {
  const trialDoor = `${WEPEKA_CONNECT_URL}?join=1`;
  const row = (name, meta, actions, extra = "") => `<div class="fd-other"><div class="fd-other-info"><b>${name}</b><span>${meta}</span>${extra}</div><div class="fd-other-actions">${actions}</div></div>`;
  const credits = (n) => (n ? ` · ${n} AI credit/hari` : "");
  const rows = [row("Trial gratis", `${FALLBACK.trialDays} hari · 1 brand${credits(offer.trialCredits)} · tanpa kartu`, `<a class="fd-other-btn" href="${trialDoor}" data-trial="others">Coba gratis</a>`)];
  for (const p of offer.others || []) {
    const name = p.key === "studio" ? `Studio · ${p.brands} brand` : `Langganan ${p.brands} brand`;
    rows.push(row(name, `${p.brands} brand${credits(p.credits)} · bisa berhenti kapan aja`,
      `<a class="fd-other-btn" href="#" data-buy="others" data-plan="${p.key}-monthly">${rp(p.monthly)}/bulan</a><a class="fd-other-btn" href="#" data-buy="others" data-plan="${p.key}-yearly">${rp(p.yearly)}/tahun</a>`,
      p.monthly * 12 > p.yearly ? `<em>Tahunan hemat ${rp(p.monthly * 12 - p.yearly)}</em>` : ""));
  }
  const a = offer.agency;
  if (a) {
    rows.push(row(`Agency Lifetime · ${a.brands} brand`, `${a.brands} brand${credits(a.credits)} · sekali bayar · ${a.soldOut ? "kursi habis" : `sisa ${a.cap - a.taken} dari ${a.cap} kursi`}`,
      a.soldOut ? `<span class="fd-other-btn is-off">Habis</span>` : `<a class="fd-other-btn is-main" href="#" data-buy="others" data-plan="founder-ultimate">${rp(a.price)} sekali</a>`,
      a.normal ? `<em><s>${rp(a.normal)}</s> harga normal</em>` : ""));
  }
  return rows.join("");
}

// What a plan costs as the page shows it (analytics value of a buy click).
export function planPrice(offer, plan, founderPay) {
  if (plan === "founder") return founderPay;
  if (plan === "founder-ultimate") return Number(offer?.agency?.price) || FALLBACK.agency.price;
  const [key, billing] = plan.split("-");
  const p = (offer?.others || []).find((o) => o.key === key);
  return p ? p[billing] : 0;
}

export function offerView(offer, promo = null) {
  const f = offer?.founder || null;
  const tiers = f?.tiers?.length ? f.tiers : FALLBACK.tiers;
  const cap = f?.cap || tiers.reduce((n, t) => n + t.seats, 0);
  const normal = f?.normal || FALLBACK.normal;
  const price = f ? f.price : tiers[0].price;
  const soldOut = !!f?.soldOut;
  const promoOff = promo && !soldOut ? Math.min(Number(promo.off) || 0, price - 1000) : 0;
  const pay = price - Math.max(0, promoOff);
  const payOpen = offer ? offer.payOpen !== false : true;
  const proMonthly = Number(offer?.proMonthly) || FALLBACK.proMonthly;
  const communityOff = Number(offer?.community?.founder) || 0;
  const lastWave = f ? f.nextPrice == null : false;
  const left = f ? f.waveLeft : null;
  const leftWord = left === 1 ? "Tinggal <b>1 kursi</b>" : `Sisa <b>${left} kursi</b>`;
  const seatNote = !f || soldOut ? ""
    : lastWave ? `${leftWord} terakhir. Habis itu Lifetime kembali ${rp(normal)}.`
    : `${leftWord} di harga ini. Habis itu naik jadi ${rp(f.nextPrice)}.`;
  const agency = offer?.agency || null;
  const agencyPrice = agency?.price || FALLBACK.agency.price;
  const months = Math.floor(pay / proMonthly) + 1;
  // Lifetime per day over 1, 2 and 5 years, and the first whole year at
  // which a day costs under Rp 1.000 (the owner's "di bawah 1000 rupiah").
  const perDay = (years) => Math.round(pay / (365 * years));
  const underYears = [1, 2, 3, 4, 5].find((y) => perDay(y) < 1000);
  return {
    known: !!f,
    soldOut,
    canBuy: !soldOut && payOpen,
    payOpen,
    promoOn: promoOff > 0,
    community: communityOff > 0 && !soldOut && payOpen,
    others: !!offer?.others?.length && payOpen,
    text: {
      price: rp(pay),
      priceBefore: rp(price),
      priceMath: rp(pay),
      normal: rp(normal),
      savePct: `Hemat ${Math.round((1 - pay / normal) * 100)}%`,
      capLabel: `cuma ${cap} kursi`,
      liveLabel: f && !soldOut ? `Sisa ${left} kursi` : "Kursi terbatas",
      waveLabel: f ? `Gelombang ${f.wave} · ${rp(price)}` : "",
      waveTaken: f ? String(f.waveTaken) : "0",
      waveSize: f ? String(f.waveSize) : "",
      ctaLabel: `Beli Lifetime · ${rp(pay)}`,
      stickyPrice: rp(pay),
      stickySub: f && !soldOut ? `sekali bayar · sisa ${left} kursi` : "sekali bayar · selamanya",
      proYear: `${rp(proMonthly * 12)} / tahun`,
      mathNote: `Lebih murah dari ${months} bulan langganan Pro, dan setelah itu nggak ada tagihan lagi.`,
      faqTiers: `${tiersSentence(tiers)}, lalu Lifetime kembali ${rp(normal)}.`,
      tiersNote: `${tiersSentence(tiers)}. Setelah ${cap} kursi, Lifetime kembali ${rp(normal)}.`,
      finalLead: `Brandlab terus berkembang, dan semua yang rilis nanti ikut kamu dapat. Kursi Founder cuma ${cap}; habis itu Lifetime kembali ${rp(normal)}. Kalau kamu serius bangun brand, ini saatnya.`,
      chipLabel: promoOff > 0 ? `Kode ${promo.code} aktif · hemat ${rp(promoOff)}` : `Hemat ${rp(communityOff)} lagi pakai kode Wepeka Community`,
      codeTitle: `Hemat ${rp(communityOff)} lagi lewat Wepeka Community`,
      promoCode: promo?.code || "",
      promoSave: promoOff > 0 ? `− ${rp(promoOff)}` : "",
      codeOnText: promoOff > 0 ? `Kode <b>${esc(promo.code)}</b> aktif. Harga Founder-mu jadi <b>${rp(pay)}</b>.` : "",
      agencyLine: `${agency?.brands || FALLBACK.agency.brands} brand, ${rp(agencyPrice)} sekali bayar`,
      agencyCap: String(agency?.cap || FALLBACK.agency.cap),
      trialDays: String(FALLBACK.trialDays),
      videoLen: offer?.video?.seconds ? `(${minutesLabel(offer.video.seconds)})` : "",
      perDayHead: underYears === 1 ? `Dihitung setahun saja, per harinya sudah di bawah ${rp(1000)}.`
        : underYears ? `Dipakai ${underYears} tahun, per harinya di bawah ${rp(1000)}.`
        : "Makin lama dipakai, makin murah per harinya.",
      othersList: offer?.others ? othersHTML(offer) : "",
      perDayRows: [1, 2, 5].map((y) => `<div class="fd-perday-row"><span>${y} tahun</span><i style="--w:${Math.max(6, Math.round((perDay(y) / perDay(1)) * 100))}%"></i><b>${rp(perDay(y))}/hari</b></div>`).join(""),
    },
    html: new Set(["seatNote", "codeOnText", "perDayRows", "othersList"]),
    seatNote,
    pips: f ? { size: f.waveSize, taken: f.waveTaken } : null,
    agencyOpen: !agency?.soldOut,
  };
}

// The buy link for a plan. `join=1`: people from an ad mostly have no
// Wepeka account yet, so wepeka.com opens its sign-up form first (a
// signed-in member skips it). The community code rides along so it
// survives a sign-up finished in another browser (wpk-dp connect passes
// `promo` through; js/main.js keeps it).
export function buyHref(planKey, code) {
  // Only the pay-once plans take a community code (api/_promo.js).
  const c = /^founder/.test(planKey) ? normalizePromo(code) : "";
  return `${buyUrl(planKey)}&join=1${c ? `&promo=${encodeURIComponent(c)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Browser only below.
if (typeof document !== "undefined" && document.querySelector("[data-founder]")) start();

function start() {
  let offer = null;
  let promo = readPromoInfo();
  let viewSent = false;

  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const paint = () => {
    const v = offerView(offer, promo);
    for (const [key, value] of Object.entries({ ...v.text, seatNote: v.seatNote })) {
      for (const el of all(`[data-f="${key}"]`)) {
        if (v.html.has(key)) el.innerHTML = value;
        else el.textContent = value;
      }
    }
    const show = {
      seats: v.known && !v.soldOut, seatsUnknown: !v.known, soldOut: v.soldOut, notSoldOut: !v.soldOut,
      canBuy: v.canBuy, cantBuy: !v.canBuy, payClosed: !v.payOpen && !v.soldOut,
      community: v.community, promoOn: v.promoOn, promoOff: !v.promoOn, video: !!offer?.video, others: v.others,
    };
    for (const el of all("[data-show]")) el.hidden = !show[el.dataset.show];
    if (offer) for (const el of all(".is-pending")) el.classList.remove("is-pending");
    const pips = document.querySelector('[data-f="pips"]');
    if (pips && v.pips) {
      pips.classList.toggle("is-many", v.pips.size > 18);
      pips.innerHTML = Array.from({ length: v.pips.size }, (_, i) => `<span class="fd-pip${i < v.pips.taken ? " is-taken" : ""}"></span>`).join("");
    }
    const thumb = document.querySelector('[data-f="videoThumb"]');
    if (thumb && offer?.video?.id && !thumb.getAttribute("src")) thumb.src = `https://i.ytimg.com/vi/${offer.video.id}/hqdefault.jpg`;
    for (const a of all("[data-buy]")) a.href = buyHref(a.dataset.plan || "founder", v.promoOn ? promo.code : null);
    for (const a of all('[data-plan="founder-ultimate"]')) a.hidden = !v.agencyOpen;
    return v;
  };

  // Doors whose address lives in shared constants, not in the markup.
  // The trial door, sign-up form first like the buy buttons (wpk-dp connect `join=1`).
  for (const a of all("[data-trial]")) a.href = `${WEPEKA_CONNECT_URL}?join=1`;
  for (const a of all("[data-join]")) a.href = COMMUNITY_WA_GROUP_URL;
  for (const a of all("[data-wa]")) a.href = `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(a.dataset.waText || "Halo Wepeka, aku mau tanya soal Founder Lifetime Brandlab.")}`;

  // A link with the code in it (?kode=…, e.g. from the community group):
  // apply it, then take it out of the address bar and of analytics.
  const params = new URLSearchParams(location.search);
  const linkCode = params.get("kode") || params.get("promo");
  if (linkCode) {
    params.delete("kode");
    params.delete("promo");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
  }

  const quotes = document.querySelector("[data-quotes]");
  if (quotes && TESTIMONIALS.length) {
    quotes.innerHTML = TESTIMONIALS.map((q) => `<figure class="fd-quote"><blockquote>“${esc(q.quote)}”</blockquote><figcaption><b>${esc(q.name)}</b>${q.business ? ` · ${esc(q.business)}` : ""}</figcaption></figure>`).join("");
    quotes.hidden = false;
  }

  gaEvent("page_view", { page_location: location.href.split("#")[0], page_path: "/founder", page_title: document.title });
  metaTrack("PageView");
  paint();

  const sendView = (v) => {
    if (viewSent || !offer) return;
    viewSent = true;
    const value = Number(offer.founder?.price) || FALLBACK.tiers[0].price;
    gaEvent("view_item", { currency: "IDR", value, items: [{ item_id: "founder", item_name: "Brandlab Founder Lifetime", price: value }] });
    metaTrack("ViewContent", { content_ids: ["founder"], content_name: "Brandlab Founder Lifetime", content_type: "product", currency: "IDR", value });
    return v;
  };

  fetch("/api/offer")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`offer ${r.status}`))))
    .then((body) => { offer = body; sendView(paint()); })
    .catch(() => {
      // No live numbers: the waves are stated instead of a seat count.
      for (const el of all(".is-pending")) el.classList.remove("is-pending");
      paint();
    });

  // A kept code is checked again (it may have been changed since); a code
  // from the link is checked and applied.
  const confirmCode = (raw, fromLink) => checkPromo(raw).then((r) => {
    if (r.ok) {
      promo = { code: r.code, off: Number(r.off.founder) || 0 };
      rememberPromo(r.code, Date.now(), promo.off);
      if (fromLink) gaEvent("promo_applied", { source: "link" });
    } else if (!fromLink) {
      promo = null;
      forgetPromo();
    }
    paint();
  }).catch(() => {});
  if (linkCode) confirmCode(linkCode, true);
  else if (promo) confirmCode(promo.code, false);


  // ---- buttons ----
  const go = (href) => setTimeout(() => { location.href = href; }, 160);
  document.addEventListener("click", (e) => {
    const buy = e.target.closest("[data-buy]");
    if (buy) {
      e.preventDefault();
      const plan = buy.dataset.plan || "founder";
      const v = offerView(offer, promo);
      const value = planPrice(offer, plan, Number(v.text.price.replace(/\D/g, "")));
      gaEvent("add_to_cart", { currency: "IDR", value, items: [{ item_id: plan, price: value }], cta_location: buy.dataset.buy, promo: v.promoOn ? "community" : "none" });
      metaTrack("AddToCart", { content_ids: [plan], content_type: "product", currency: "IDR", value });
      go(buy.href);
      return;
    }
    const trial = e.target.closest("[data-trial]");
    if (trial) {
      e.preventDefault();
      gaEvent("trial_click", { cta_location: trial.dataset.trial });
      go(trial.href);
      return;
    }
    if (e.target.closest("[data-join]")) gaEvent("community_join_click", {});
    if (e.target.closest("[data-guide-link]")) gaEvent("guide_click", {});
    const site = e.target.closest("[data-site]");
    if (site) gaEvent("website_click", { cta_location: site.dataset.site });
    const wa = e.target.closest("[data-wa]");
    if (wa) gaEvent("whatsapp_click", { cta_location: wa.dataset.waText ? "bca" : "final" });
    if (e.target.closest("[data-code-remove]")) {
      promo = null;
      forgetPromo();
      paint();
    }
    const video = e.target.closest("[data-video]");
    if (video && offer?.video) {
      const frame = document.createElement("iframe");
      frame.src = `https://www.youtube-nocookie.com/embed/${offer.video.id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
      frame.title = "Apa itu Brandlab?";
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      video.replaceWith(frame);
      gaEvent("video_start", { video_title: "Apa itu Brandlab?" });
    }
  });

  const form = document.querySelector("[data-code-form]");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.elements.code;
    const msg = document.querySelector('[data-f="codeMsg"]');
    const btn = form.querySelector("button");
    if (!normalizePromo(input.value)) { input.focus(); return; }
    btn.disabled = true;
    msg.className = "fd-code-msg is-wait";
    msg.textContent = "Mengecek kode…";
    try {
      const r = await checkPromo(input.value);
      if (!r.ok) {
        msg.className = "fd-code-msg";
        msg.textContent = "Kodenya belum cocok. Cek lagi di deskripsi grup WhatsApp Wepeka Community.";
        return;
      }
      promo = { code: r.code, off: Number(r.off.founder) || 0 };
      rememberPromo(r.code, Date.now(), promo.off);
      msg.textContent = "";
      input.value = "";
      paint();
      gaEvent("promo_applied", { source: "form" });
    } catch {
      msg.className = "fd-code-msg";
      msg.textContent = "Kodenya belum bisa dicek. Coba lagi sebentar.";
    } finally {
      btn.disabled = false;
    }
  });

  // ---- the buy bar at the bottom: once the hero's button is scrolled
  // past, and out of the way again at the closing offer ----
  const bar = document.querySelector("[data-sticky]");
  const heroBtn = document.querySelector('[data-buy="hero"]');
  const finalSec = document.querySelector(".fd-final");
  if (bar && heroBtn && finalSec && "IntersectionObserver" in window) {
    let pastHero = false;
    let atFinal = false;
    const update = () => {
      const on = pastHero && !atFinal && !heroBtn.hidden;
      bar.classList.toggle("is-on", on);
      bar.setAttribute("aria-hidden", on ? "false" : "true");
      bar.querySelector("a")?.setAttribute("tabindex", on ? "0" : "-1");
    };
    new IntersectionObserver(([en]) => { pastHero = !en.isIntersecting && en.boundingClientRect.top < 0; update(); }).observe(heroBtn);
    new IntersectionObserver(([en]) => { atFinal = en.isIntersecting; update(); }, { rootMargin: "0px 0px -35% 0px" }).observe(finalSec);
  }
}
