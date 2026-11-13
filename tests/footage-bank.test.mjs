// Antrean Video → Footage (js/footage-bank.js, 2026-11-12): which videos have
// the shoot's raw clips, the bank of them, and what still waits on the shoot.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.location ??= { hash: "#/", href: "http://localhost/", pathname: "/" };
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const DAY = 86400000;
const clip = (name, at, size = 10 * 1024 ** 2) => ({ id: `id-${name}`, name, size, type: "video/mp4", at, who: "Dessy" });

test("when a clip was shot, read from the camera's own file name", async () => {
  const { shotAt } = await import("../js/footage-bank.js");
  const at = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h, mi, s).getTime();
  assert.equal(shotAt("DJI_20261111182103_0456_D.MP4"), at(2026, 11, 11, 18, 21, 3));
  assert.equal(shotAt("PXL_20261111_182103123.mp4"), at(2026, 11, 11, 18, 21, 3));
  assert.equal(shotAt("VID_20261110_090000.mp4"), at(2026, 11, 10, 9, 0, 0));
  assert.equal(shotAt("2026-11-11 18.21.03.mov"), at(2026, 11, 11, 18, 21, 3));
  assert.equal(shotAt("IMG_0412.MOV"), null);
  assert.equal(shotAt("20261340999999.mp4"), null, "not a real date");
});

test("a piece's clips in the order they were shot; pieces newest arrival first; the totals", async () => {
  const { clipsInOrder, footagePieces, footageTotals, footageCount } = await import("../js/footage-bank.js");
  const a = { id: "a", footage: { files: [clip("DJI_20261111183015_0466_D.MP4", 5), clip("DJI_20261111163403_0283_D.MP4", 9), clip("IMG_0001.MOV", 1)] } };
  const b = { id: "b", footage: { files: [clip("DJI_20261110164111_0122_D.MP4", 20)] } };
  const none = { id: "c" };
  // IMG_0001 has no camera time: it goes by when it arrived (1), so first.
  assert.deepEqual(clipsInOrder(a).map((f) => f.name), ["IMG_0001.MOV", "DJI_20261111163403_0283_D.MP4", "DJI_20261111183015_0466_D.MP4"]);
  assert.deepEqual(footagePieces([a, none, b]).map((c) => c.id), ["b", "a"], "b's clip arrived last");
  assert.deepEqual(footageTotals([a, b]), { pieces: 2, clips: 4, bytes: 40 * 1024 ** 2 });
  assert.equal(footageCount(none), 0);
});

test("waiting on the shoot: a video at Syuting or Edit with no clip and no cut — not a carousel, a trial, or one already cut", async () => {
  const { needsFootage, waitingForFootage } = await import("../js/footage-bank.js");
  const base = { platform: "Instagram", format: "Reels", status: "production" };
  assert.equal(needsFootage(base), true);
  assert.equal(needsFootage({ ...base, status: "editing" }), true);
  assert.equal(needsFootage({ ...base, status: "idea" }), false, "not planned for a shoot yet");
  assert.equal(needsFootage({ ...base, format: "Carousel" }), false);
  assert.equal(needsFootage({ ...base, posting: { type: "carousel" } }), false);
  assert.equal(needsFootage({ ...base, trialOf: "x" }), false);
  assert.equal(needsFootage({ ...base, footage: { files: [clip("a.mp4", 1)] } }), false);
  assert.equal(needsFootage({ ...base, posting: { versions: [{ id: "v1" }] } }), false, "already has a cut");
  assert.equal(needsFootage({ ...base, platform: "TikTok" }), false);
  const list = waitingForFootage([{ ...base, id: "late", scheduleDate: "2026-11-20" }, { ...base, id: "nodate" }, { ...base, id: "soon", scheduleDate: "2026-11-13" }]);
  assert.deepEqual(list.map((c) => c.id), ["soon", "late", "nodate"]);
});

test("Antrean: the Galeri tile says which videos have footage, and the Footage view lists the bank and what still waits", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { render } = await import("../js/views/posting-queue.js");
  await store.initStore("test-uid-footage-bank");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Quatro" });
  const cut = { type: "reels", versions: [{ id: "v1", n: 0, status: "pending", kind: "video" }], notes: [] };
  store.createContent(b.id, { title: "Mic Up dua", status: "editing", scheduleDate: day(2), platform: "Instagram", format: "Reels", footage: { files: [clip("DJI_20261111182103_0456_D.MP4", Date.now()), clip("DJI_20261111182132_0457_D.MP4", Date.now())] } });
  store.createContent(b.id, { title: "Mic Up satu", status: "editing", scheduleDate: day(1), platform: "Instagram", format: "Reels", posting: cut, footage: { files: [clip("DJI_20261110164111_0122_D.MP4", Date.now() - DAY)] } });
  store.createContent(b.id, { title: "Bukan Cuma Main", status: "editing", scheduleDate: day(1), platform: "Instagram", format: "Reels" });
  store.createContent(b.id, { title: "Carousel pembuka", status: "editing", scheduleDate: day(1), platform: "Instagram", format: "Carousel" });
  const was = auth.currentUser;
  let view = null;
  try {
    view = globalThis.localStorage?.getItem("posting:queueView");
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    globalThis.localStorage?.setItem("posting:queueView", "list");
    render(root, { brandId: b.id })?.();
    let html = root.innerHTML;
    const tile = (title) => {
      const at = html.indexOf(title);
      assert.ok(at > 0, `${title} is in the gallery`);
      return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
    };
    assert.match(html, /data-view="footage"/, "the Footage view is offered on a brand with footage");
    assert.match(tile("Mic Up dua"), /has-ft/);
    assert.match(tile("Mic Up dua"), /Footage siap/);
    assert.match(tile("Mic Up dua"), /2 klip/);
    assert.match(tile("Mic Up satu"), /class="pq-g-ft"[^>]*>.*?1 klip<\/span>/s, "a piece with a cut shows the count");
    assert.doesNotMatch(tile("Bukan Cuma Main"), /pq-g-ft|has-ft/);

    globalThis.localStorage?.setItem("posting:queueView", "footage");
    render(root, { brandId: b.id })?.();
    html = root.innerHTML;
    assert.match(html, /class="fb"/, "the Footage view is open");
    assert.match(html, /3 klip footage/);
    assert.ok(html.indexOf("Mic Up dua") < html.indexOf("Mic Up satu"), "the newest arrival first");
    assert.equal((html.match(/data-fb-clip=/g) || []).length, 3, "a still per clip");
    const wait = html.slice(html.indexOf('class="fb-wait"'), html.indexOf("</section>", html.indexOf('class="fb-wait"')));
    assert.match(wait, /Bukan Cuma Main/, "the video still waiting on the shoot is named");
    assert.doesNotMatch(wait, /Carousel pembuka/, "a carousel needs no shoot");
    assert.doesNotMatch(wait, /Mic Up/);
  } finally {
    auth.currentUser = was;
    if (view == null) globalThis.localStorage?.removeItem("posting:queueView");
    else globalThis.localStorage?.setItem("posting:queueView", view);
  }
});

test("a brand with no client and no footage keeps Galeri and Feed only", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { render } = await import("../js/views/posting-queue.js");
  const b = store.createBrand({ name: "winkhsin" });
  store.createContent(b.id, { title: "Reel biasa", status: "editing", platform: "Instagram", format: "Reels" });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    globalThis.localStorage?.setItem("posting:queueView", "footage");
    render(root, { brandId: b.id })?.();
    assert.doesNotMatch(root.innerHTML, /data-view="footage"/);
    assert.doesNotMatch(root.innerHTML, /class="fb"/, "falls back to the gallery");
    assert.match(root.innerHTML, /class="pq-gal"/);
  } finally {
    auth.currentUser = was;
    globalThis.localStorage?.removeItem("posting:queueView");
  }
});

test("footage comes onto the Mac only for a piece asked for with 'Salin ke Mac' (2026-11-13: 'Copy pas mau edit'), and stops once it's out", async () => {
  const { copiesFootageToMac } = await import("../js/posting.js");
  const { wishMac, wantsMac } = await import("../js/footage-mac.js");
  const files = [clip("DJI_20261112100000_0001_D.MP4", 1)];
  const editing = { id: "ask-1", status: "editing", footage: { files } };
  const other = { id: "ask-2", status: "editing", footage: { files } };
  assert.equal(copiesFootageToMac(editing), false, "nothing comes down by itself");
  wishMac("ask-1");
  assert.equal(copiesFootageToMac(editing), true);
  assert.equal(copiesFootageToMac(other), false, "only the piece asked for");
  assert.equal(copiesFootageToMac({ id: "ask-1", status: "editing" }), false, "no clips, nothing to copy");
  // posted: the wish is let go, so a folder cleared afterwards stays empty
  const out = { ...editing, status: "published", posting: { versions: [{ id: "v", status: "approved" }], finalId: "v", notes: [] } };
  assert.equal(copiesFootageToMac(out), false);
  assert.equal(wantsMac("ask-1"), false);
});
