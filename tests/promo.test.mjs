// Wepeka Community codes (api/_promo.js) and the Founder's Deal page
// (founder/, api/offer.js): what a code takes off, where it never leaks, what
// the page says for each seat state, and the numbers it must keep equal to
// the server's. No network, no Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const { PROMO_CODES, normalizePromo, promoFor, applyPromo, communityOffer } = await import("../api/_promo.js");
const { FOUNDER_TIERS, FIRST_WAVE_REOPENED, PLANS, MIN_CHARGE } = await import("../api/_plans.js");
const { founderFacts, agencyFacts, youtubeId, otherPlans, NORMAL_PRICES, PRO_MONTHLY } = await import("../api/offer.js");
const { composePaidEmail } = await import("../api/_community.js");
const { composeSaleNote } = await import("../api/_ownerNotify.js");
const page = await import("../founder/founder.js");
const client = await import("../js/promo-code.js");

const CODE = Object.keys(PROMO_CODES)[0];
const ROOT = path.resolve(import.meta.dirname, "..");

describe("community code (api/_promo.js)", () => {
  test("typed loosely, read the same way on both sides", () => {
    assert.equal(normalizePromo(` ${CODE.toLowerCase().slice(0, 3)} ${CODE.slice(3)} `), CODE);
    assert.equal(client.normalizePromo("wpk-community!"), normalizePromo("wpk-community!"));
    assert.equal(normalizePromo(null), "");
  });

  test("only on the plans it names", () => {
    for (const plan of PROMO_CODES[CODE].plans) assert.ok(PLANS[plan], `${plan} is a real plan`);
    assert.equal(promoFor(CODE, "founder")?.off, PROMO_CODES[CODE].off);
    assert.equal(promoFor(CODE, "pro-monthly"), null);
    assert.equal(promoFor("NOPE", "founder"), null);
    assert.equal(promoFor("", "founder"), null);
  });

  test("never charges less than Midtrans accepts", () => {
    assert.deepEqual(applyPromo(499000, { off: 50000 }, MIN_CHARGE), { amount: 449000, off: 50000 });
    assert.deepEqual(applyPromo(30000, { off: 50000 }, MIN_CHARGE), { amount: MIN_CHARGE, off: 30000 - MIN_CHARGE });
    assert.deepEqual(applyPromo(499000, null), { amount: 499000, off: 0 });
  });

  test("the page learns the discount, never the code", () => {
    assert.deepEqual(communityOffer({ A: { off: 30000, plans: ["founder"] }, B: { off: 50000, plans: ["founder", "founder-ultimate"] } }), { founder: 50000, "founder-ultimate": 50000 });
    assert.ok(!JSON.stringify(communityOffer()).includes(CODE));
  });

  test("the page names no payment method that isn't live (QRIS is off, 2026-10-15)", async () => {
    const html = await readFile(path.join(ROOT, "founder/index.html"), "utf8");
    assert.doesNotMatch(html, /QRIS/i);
  });

  test("Founders are guided over chat, never promised a 1-on-1 session (owner 2026-10-24)", async () => {
    const { t } = await import("../js/i18n.js");
    const texts = {
      page: await readFile(path.join(ROOT, "founder/index.html"), "utf8"),
      email: Object.values(composePaidEmail({ name: "Rani", label: "Brandlab Founder Lifetime", amount: 499000, orderId: "bl-1", isPlan: true, lifetime: true })).join(" "),
      app: ["community.guideNote", "circle.review.body", "circle.teaser.reviewBody"].map((k) => t(k)).join(" "),
    };
    for (const [where, text] of Object.entries(texts)) assert.doesNotMatch(text, /1-on-1|one-on-one|video call|call singkat|short call|sesi kenalan/i, where);
  });

  test("no code is written in anything shipped to the browser", async () => {
    const shipped = ["js", "founder", "css", "assets", "index.html"];
    const hits = [];
    const scan = async (p) => {
      const full = path.join(ROOT, p);
      const entries = await readdir(full, { withFileTypes: true }).catch(() => null);
      if (!entries) {
        if (/\.(js|html|css|json|svg|txt|webmanifest)$/.test(p)) {
          const text = await readFile(full, "utf8");
          for (const code of Object.keys(PROMO_CODES)) if (text.toUpperCase().includes(code)) hits.push(`${p}: ${code}`);
        }
        return;
      }
      for (const e of entries) await scan(path.join(p, e.name));
    };
    for (const p of shipped) await scan(p);
    assert.deepEqual(hits, []);
  });
});

describe("invoice and sale note with a code", () => {
  test("the invoice shows the list price, the community line and the total", () => {
    const mail = composePaidEmail({ name: "Sari", email: "s@x.id", label: "Brandlab Founder Lifetime", amount: 449000, price: 449000, credit: 0, discount: 50000, discountLabel: `Diskon Wepeka Community (${CODE})`, orderId: "bl-1", invoiceNo: "INV-1" });
    assert.match(mail.text, /Brandlab Founder Lifetime: Rp 499\.000/);
    assert.match(mail.text, new RegExp(`Diskon Wepeka Community \\(${CODE}\\): − Rp 50\\.000`));
    assert.match(mail.html, /Rp 449\.000/);
  });

  test("without a code the invoice is unchanged", () => {
    const mail = composePaidEmail({ label: "Brandlab Founder Lifetime", amount: 499000, price: 499000, credit: 0, orderId: "bl-1" });
    assert.match(mail.text, /Brandlab Founder Lifetime: Rp 499\.000/);
    assert.doesNotMatch(mail.text, /Diskon/);
  });

  test("the owner sees which sales came with a code", () => {
    const note = composeSaleNote({ label: "Brandlab Founder Lifetime", amount: 449000, discount: 50000, discountLabel: "Diskon Wepeka Community (X)" });
    assert.match(note.text, /Kode: Diskon Wepeka Community \(X\), − Rp 50\.000/);
    assert.doesNotMatch(composeSaleNote({ label: "x", amount: 1 }).text, /Kode:/);
  });
});

describe("offer facts (api/offer.js)", () => {
  test("waves, seats left and the next price", () => {
    const one = founderFacts({ founderSlotsSold: 4 });
    assert.equal(one.price, FOUNDER_TIERS[0].amount);
    assert.deepEqual([one.wave, one.waveTaken, one.waveSize, one.waveLeft, one.nextPrice], [1, 4, 5, 1, FOUNDER_TIERS[1].amount]);
    const two = founderFacts({ founderSlotsSold: 20 });
    assert.deepEqual([two.wave, two.waveTaken, two.waveSize, two.waveLeft, two.nextPrice, two.price], [2, 5, 35, 30, null, FOUNDER_TIERS[1].amount]);
    assert.equal(founderFacts({ founderSlotsSold: 50 }).soldOut, true);
    assert.equal(agencyFacts({ founderUltimateSlotsSold: 15 }).soldOut, true);
  });

  test("an open checkout's hold counts as taken", () => {
    const f = founderFacts({ founderSlotsSold: 16, holds: { founderSlotsSold: { abc: Date.now() + 60000, old: Date.now() - 1 } } });
    assert.equal(f.taken, 17);
    assert.equal(f.wave, 2);
  });

  test("the intro video's id", () => {
    assert.equal(youtubeId("https://www.youtube.com/watch?v=YJAy54kzekY"), "YJAy54kzekY");
    assert.equal(youtubeId("https://youtu.be/YJAy54kzekY?t=3"), "YJAy54kzekY");
    assert.equal(youtubeId("https://vimeo.com/1"), null);
  });
});

describe("Founder's Deal page (founder/founder.js)", () => {
  const offer = (sold, extra = {}) => ({
    founder: founderFacts({ founderSlotsSold: sold }), agency: agencyFacts({}), proMonthly: PRO_MONTHLY,
    community: communityOffer(), payOpen: true, video: null, ...extra,
  });

  test("its fallback numbers are the server's", async () => {
    // Shown as 15 + 35: the 2 re-opened wave-1 seats count inside wave 2.
    assert.deepEqual(page.FALLBACK.tiers, FOUNDER_TIERS.map((t, i) => ({ seats: t.upTo - (i ? FOUNDER_TIERS[i - 1].upTo : 0) + (i === 0 ? -FIRST_WAVE_REOPENED : FIRST_WAVE_REOPENED), price: t.amount })));
    assert.equal(page.FALLBACK.normal, NORMAL_PRICES.founder);
    assert.equal(page.FALLBACK.proMonthly, PRO_MONTHLY);
    assert.equal(page.FALLBACK.agency.price, PLANS["founder-ultimate"].amount);
    const account = await readFile(path.join(ROOT, "js/account.js"), "utf8");
    assert.equal(page.FALLBACK.trialDays, Number(account.match(/TRIAL_DAYS = (\d+)/)[1]));
    const pricing = await readFile(path.join(ROOT, "js/views/pricing.js"), "utf8");
    assert.equal(NORMAL_PRICES.founder, Number(pricing.match(/LIFETIME_NORMAL_PRICE = (\d+)/)[1]));
    assert.equal(NORMAL_PRICES["founder-ultimate"], Number(pricing.match(/AGENCY_NORMAL_PRICE = (\d+)/)[1]));
  });

  test("wave 1: price, seats left, what comes next", () => {
    const v = page.offerView(offer(4));
    const nb = (s) => s.replace(/ /g, " ");
    assert.equal(nb(v.text.price), "Rp 499.000");
    assert.equal(nb(v.text.ctaLabel), "Beli Lifetime · Rp 499.000");
    assert.match(nb(v.seatNote), /Tinggal <b>1 kursi<\/b> di harga ini\. Habis itu naik jadi Rp 599\.000\./);
    assert.equal(v.canBuy, true);
    assert.equal(v.community, true);
  });

  test("last wave, last seat, sold out", () => {
    const nb = (s) => s.replace(/ /g, " ");
    assert.match(nb(page.offerView(offer(20)).seatNote), /Sisa <b>30 kursi<\/b> terakhir\. Habis itu Lifetime kembali Rp 3\.000\.000\./);
    assert.match(page.offerView(offer(49)).seatNote, /Tinggal <b>1 kursi<\/b>/);
    const gone = page.offerView(offer(50));
    assert.equal(gone.soldOut, true);
    assert.equal(gone.canBuy, false);
    assert.equal(gone.community, false);
  });

  test("a code lowers every price on the page", () => {
    const v = page.offerView(offer(4), { code: CODE, off: 50000 });
    const nb = (s) => s.replace(/ /g, " ");
    assert.equal(v.promoOn, true);
    assert.equal(nb(v.text.price), "Rp 449.000");
    assert.equal(nb(v.text.stickyPrice), "Rp 449.000");
    assert.equal(nb(v.text.priceBefore), "Rp 499.000");
  });

  test("per day: the real division, and the first year under Rp 1.000", () => {
    const nb = (s) => s.replace(/\u00a0/g, " ");
    const v = page.offerView(offer(4));
    // Rp 499.000 / 365 = 1.367 — a single year is NOT under Rp 1.000; two are.
    assert.match(nb(v.text.perDayRows), /1 tahun<\/span>.*Rp 1\.367\/hari/);
    assert.match(nb(v.text.perDayRows), /2 tahun<\/span>.*Rp 684\/hari/);
    assert.match(nb(v.text.perDayRows), /5 tahun<\/span>.*Rp 273\/hari/);
    assert.equal(nb(v.text.perDayHead), "Dipakai 2 tahun, per harinya di bawah Rp 1.000.");
    // With the community code (Rp 449.000) still 1.230 a day over one year.
    assert.match(nb(page.offerView(offer(4), { code: CODE, off: 50000 }).text.perDayRows), /Rp 1\.230\/hari/);
    // The last wave too: 599.000 / 730 = 820.
    assert.equal(nb(page.offerView(offer(20)).text.perDayHead), "Dipakai 2 tahun, per harinya di bawah Rp 1.000.");
  });

  test("no answer from the server: the waves are stated instead", () => {
    const v = page.offerView(null);
    assert.equal(v.known, false);
    assert.equal(v.canBuy, true);
    assert.match(v.text.tiersNote.replace(/ /g, " "), /^15 kursi pertama Rp 499\.000, 35 berikutnya Rp 599\.000\./);
  });

  test("payments closed: the trial is the door", () => {
    const v = page.offerView(offer(4, { payOpen: false }));
    assert.equal(v.canBuy, false);
    assert.equal(v.payOpen, false);
  });

  test("buy links open sign-up first and carry the code", () => {
    assert.equal(page.buyHref("founder", null), "https://www.wepeka.com/brandlab/connect?to=pricing&plan=founder&join=1");
    assert.equal(page.buyHref("founder", ` ${CODE.toLowerCase()} `), `https://www.wepeka.com/brandlab/connect?to=pricing&plan=founder&join=1&promo=${CODE}`);
  });

  test("subscription links never carry a code", () => {
    assert.equal(page.buyHref("pro-monthly", CODE), "https://www.wepeka.com/brandlab/connect?to=pricing&plan=pro-monthly&join=1");
    assert.match(page.buyHref("founder-ultimate", CODE), new RegExp(`&promo=${CODE}$`));
  });

  test("other plans at the bottom: the billed prices, credits and the trial", () => {
    const o = { ...offer(4), others: otherPlans(), trialCredits: 40 };
    for (const p of otherPlans()) {
      assert.equal(p.monthly, PLANS[`${p.key}-monthly`].amount);
      assert.equal(p.yearly, PLANS[`${p.key}-yearly`].amount);
      assert.equal(p.brands, PLANS[`${p.key}-monthly`].brandLimit);
    }
    const html = page.offerView(o).text.othersList.replace(/\u00a0/g, " ");
    assert.match(html, /Trial gratis/);
    assert.match(html, /Langganan 3 brand.*Rp 99\.000\/bulan.*Rp 799\.000\/tahun/s);
    assert.match(html, /Studio · 10 brand/);
    assert.match(html, /Agency Lifetime · 15 brand.*sisa 15 dari 15 kursi.*Rp 799\.000 sekali/s);
    assert.equal(page.planPrice(o, "studio-yearly", 0), PLANS["studio-yearly"].amount);
    assert.equal(page.offerView({ ...o, payOpen: false }).others, false);
  });

  test("video length in half minutes", () => {
    assert.equal(page.minutesLabel(95), "1,5 menit");
    assert.equal(page.minutesLabel(20), "1 menit");
    assert.equal(page.minutesLabel(130), "2 menit");
  });
});

describe("the kept code (js/promo-code.js)", () => {
  test("kept for two weeks, with its display amount", () => {
    client.forgetPromo();
    assert.equal(client.readPromo(), null);
    const now = Date.now();
    assert.equal(client.rememberPromo(" wpk community ", now, 50000), "WPKCOMMUNITY");
    assert.deepEqual(client.readPromoInfo(now + 1000), { code: "WPKCOMMUNITY", off: 50000 });
    assert.equal(client.readPromo(now + client.PROMO_FRESH_MS + 1), null);
    assert.equal(client.rememberPromo("ab"), null);
    client.forgetPromo();
  });

  test("checked against /api/offer", async () => {
    const fetchImpl = async (url) => ({ ok: true, json: async () => ({ promo: url.endsWith("=GOOD") ? { ok: true, code: "GOOD", off: { founder: 50000 } } : { ok: false } }) });
    assert.deepEqual(await client.checkPromo("good", fetchImpl), { ok: true, code: "GOOD", off: { founder: 50000 } });
    assert.equal((await client.checkPromo("bad", fetchImpl)).ok, false);
  });
});
