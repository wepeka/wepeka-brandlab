// The front page a signed-out visitor gets (js/views/landing.js), rendered
// in Node with the test stubs: its order, its doors (trial / "Masuk ke
// Lab-mu"), the seat counter, and the guide-video list built from the
// admin's titles. No browser, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

globalThis.window.scrollTo ??= () => {};
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const { landingHTML, founderNow, buildLibrary } = await import("../js/views/landing.js");
const { render: renderPlans } = await import("../js/views/pricing.js");
const { t } = await import("../js/i18n.js");
const { WEPEKA_CONNECT_URL, buyUrl } = await import("../js/site-links.js");
const { rememberBuyIntent, takeBuyIntent } = await import("../js/buy-intent.js");

const mem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const live = (founderTaken) => ({ live: true, founderTaken, agencyTaken: 0, payOpen: true });
const heroOf = (html) => html.slice(html.indexOf('class="lp-hero"'), html.indexOf('id="lp-harga"'));

describe("front page", () => {
  test("the plans come right after the hero, then the videos and the rest", () => {
    const html = landingHTML();
    const order = ["lp-hero", 'id="lp-harga"', 'id="lp-video"', 'id="lp-kenapa"', 'id="lp-cocok"', 'id="lp-modul"', 'id="lp-nilai"', 'id="lp-faq"', "lp-final"].map((mark) => html.indexOf(mark));
    assert.ok(order.every((at) => at > 0), "every section is there");
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test("every {token} in the copy is filled", () => {
    for (const returning of [false, true]) {
      for (const facts of [undefined, live(2), live(20), live(50)]) {
        assert.deepEqual(landingHTML({ returning, facts }).match(/\{\w+\}/g), null);
      }
    }
  });

  test("in-page links never touch the hash (a hashchange repaints the page while signed out)", () => {
    const hrefs = [...landingHTML().matchAll(/href="(#[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    assert.deepEqual([...new Set(hrefs)], ["#/login"]);
  });

  test("a new visitor's main button is the trial; account holders get Masuk ke Lab-mu in the header and under the buttons", () => {
    const html = landingHTML();
    const hero = heroOf(html);
    assert.ok(hero.indexOf(WEPEKA_CONNECT_URL) < hero.indexOf("#/login"), "trial first");
    assert.match(html, /href="#\/login" id="lp-login"/);
    assert.ok(hero.includes(t("landing.enter")));
    assert.ok(hero.includes(t("pricing.alreadyHave")));
  });

  test("a browser that has signed in before gets Masuk ke Lab-mu as the main button, and still sees the plans", () => {
    const html = landingHTML({ returning: true });
    const hero = heroOf(html);
    assert.ok(hero.indexOf("#/login") < hero.indexOf(WEPEKA_CONNECT_URL), "enter first");
    assert.ok(html.includes('id="lp-plans"'));
    assert.ok(!html.includes("lp-nav-try"), "no second button competing in the header");
  });

  test("the seat counter shows only a live count, and never once every seat is gone", () => {
    assert.ok(!landingHTML().includes("lp-seats-n"), "unknown count: no number");
    const some = landingHTML({ facts: live(2) });
    assert.match(some, /class="lp-seats-n">13</);
    assert.equal(some.match(/class="lp-pips"[^>]*>(.*?)<\/span>/)[1].split('class="is-taken"').length - 1, 2);
    const gone = landingHTML({ facts: live(50) });
    assert.ok(!gone.includes("lp-seats-n"));
    assert.ok(!gone.includes("lp-buy"), "no Lifetime button either");
  });

  test("the price buttons are buy links for Founder, not a scroll to the plans", () => {
    const html = landingHTML({ facts: live(2) });
    const buys = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*data-lp-buy="(\w+)"/g)].map((m) => `${m[2]} ${m[1]}`);
    assert.deepEqual(buys, [`hero ${buyUrl("founder")}`, `final ${buyUrl("founder")}`]);
  });

  test("the Founder wave follows the seats taken", () => {
    assert.deepEqual([founderNow(0).wave.price, founderNow(0).left], [499000, 15]);
    assert.deepEqual([founderNow(14).left, founderNow(14).takenInWave, founderNow(14).nextWave.price], [1, 14, 699000]);
    assert.deepEqual([founderNow(15).wave.price, founderNow(15).left, founderNow(15).nextWave], [699000, 35, null]);
    assert.equal(founderNow(50).soldOut, true);
  });
});

describe("front page: guide videos", () => {
  const src = (id) => `https://youtu.be/${id}`;
  const videos = {
    "tanya-brandlab": { parts: [{ title: "Perkenalan AI Brandlab", src: src("aaaaaaaaaa1"), seconds: 77 }, { title: "AI Credits", src: src("aaaaaaaaaa2"), seconds: 104 }] },
    "content-os": { parts: [{ title: "Creator", src: src("bbbbbbbbbb1"), seconds: 97 }, { title: "Kalender", src: src("bbbbbbbbbb2"), seconds: 100 }, { title: "Draft Konten", src: src("bbbbbbbbbb3"), seconds: 75 }] },
    kenalan: { src: src("ccccccccccc"), seconds: 95 },
    copy: { parts: [{ title: "Tulisan Cepat", src: "https://cdn.example.com/tulisan.mp4", seconds: 70 }] },
  };

  test("the introduction comes first, then the app's own order, each part filed by its title", () => {
    const lib = buildLibrary(videos);
    assert.deepEqual(lib.map((v) => `${v.id}:${v.topic}:${v.blurbKey}`), [
      "kenalan-0:intro:intro",
      "content-os-0:content:script",
      "content-os-1:content:calendar",
      "content-os-2:content:list",
      "copy-0:content:quick",
      "tanya-brandlab-0:ai:aiIntro",
      "tanya-brandlab-1:ai:credits",
    ]);
  });

  test("an untitled video takes the stock name; a file link is not a YouTube video", () => {
    const lib = buildLibrary(videos);
    assert.ok(lib[0].title.length > 0);
    assert.equal(lib[0].youtubeId, "ccccccccccc");
    assert.equal(lib.find((v) => v.id === "copy-0").youtubeId, null);
  });

  test("no videos published: an empty list", () => {
    assert.deepEqual(buildLibrary({}), []);
    assert.deepEqual(buildLibrary(undefined), []);
  });
});

describe("pricing page, embedded in the front page", () => {
  const paint = (opts) => {
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [] };
    renderPlans(root, opts);
    return root.innerHTML;
  };

  test("only the plans: no header, hero or FAQ of its own, agency plans open", () => {
    const html = paint({ embed: true });
    assert.ok(html.includes("pricing-ways"));
    assert.ok(!html.includes("pricing-hero") && !html.includes("pricing-faq") && !html.includes("pricing-shell"));
    assert.match(html, /<details class="pricing-other" id="ultimate" open>/);
    assert.ok(!html.includes("data-pay="), "a signed-out visitor never pays here");
  });

  test("each plan's button carries its own plan to the sign-in door", () => {
    const html = paint({ embed: true });
    const links = [...html.matchAll(/data-plan="([^"]+)" href="([^"]+)"/g)];
    assert.deepEqual(links.map((m) => m[1]).sort(), ["founder", "founder-ultimate", "starter-monthly", "studio-monthly", "studio-yearly"]);
    for (const [, planKey, href] of links) assert.equal(href, buyUrl(planKey));
  });

  test("a remembered plan is opened by the signed-in plans page only, and only once", async () => {
    rememberBuyIntent("founder");
    paint({ embed: true });
    paint({});
    assert.equal(mem.size, 1, "a signed-out page leaves it alone");
    // The checkout it opens stops at "no session" here (no browser, no
    // Firebase user) and says so in a toast, which needs somewhere to go.
    const getElementById = document.getElementById;
    document.getElementById = () => ({ appendChild() {}, querySelector: () => null });
    try {
      paint({ user: { uid: "u1", email: "owner@kopi.id" }, account: null, locked: true });
      assert.equal(takeBuyIntent(), null, "taken by the checkout it opened");
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      document.getElementById = getElementById;
    }
  });

  test("it says nothing about seats or checkout until the server has answered", () => {
    const seen = [];
    paint({ embed: true, onFacts: (facts) => seen.push(facts) });
    assert.deepEqual(seen, []);
  });
});
