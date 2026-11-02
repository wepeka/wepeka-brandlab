// Antrean Video (js/views/posting-queue.js): what's past its date and still
// not up sits folded ABOVE the gallery (owner, 2026-11-03: folded under ~90
// tiles, Winson Wrapped #4 read as "hilang" the day after its date).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.location ??= { hash: "#/", href: "http://localhost/", pathname: "/" };
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const DAY = 86400000;

test("Antrean: 'Lewat tanggal, belum tayang' comes before the gallery, posted pieces stay out of it", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { render } = await import("../js/views/posting-queue.js");
  await store.initStore("test-uid-antrean");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Kopi Pagi" });
  const cut = (status) => ({ type: "reels", versions: [{ id: "v1", n: 0, status, kind: "video" }], finalId: status === "approved" ? "v1" : null, notes: [] });
  store.createContent(b.id, { title: "Besok tayang", status: "editing", scheduleDate: day(1), platform: "Instagram", format: "Reels", posting: cut("pending") });
  store.createContent(b.id, { title: "Kemarin belum naik", status: "scheduled", scheduleDate: day(-1), platform: "Instagram", format: "Reels", posting: { ...cut("approved"), time: "23:00" } });
  store.createContent(b.id, { title: "Kemarin sudah naik", status: "published", publishedDate: day(-1), scheduleDate: day(-1), platform: "Instagram", format: "Reels", posting: { ...cut("approved"), ig: { state: "published", byHand: true } } });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    render(root, { brandId: b.id })?.();
    const html = root.innerHTML;
    const fold = html.indexOf('data-fold="late"');
    const gallery = html.indexOf('<div class="pq-gal">', html.indexOf("</details>"));
    assert.ok(fold > 0, "the late fold is there");
    assert.ok(gallery > fold, "and it comes before the main gallery");
    const late = html.slice(fold, html.indexOf("</details>"));
    assert.match(late, /Kemarin belum naik/);
    assert.doesNotMatch(late, /Besok tayang/);
    assert.doesNotMatch(late, /Kemarin sudah naik/, "a piece marked posted isn't late");
    assert.match(html.slice(gallery), /Besok tayang/);
  } finally {
    auth.currentUser = was;
  }
});
