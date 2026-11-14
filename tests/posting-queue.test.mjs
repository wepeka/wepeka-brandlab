// Antrean Video (js/views/posting-queue.js): what's past its date and still
// not up is IN the "Semua" gallery, first, marked late (owner, 2026-11-12:
// "yang sudah terlambat pun masih bisa dilihat di semua"; before that it
// waited in a closed "Lewat tanggal" fold).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Jakarta";
globalThis.location ??= { hash: "#/", href: "http://localhost/", pathname: "/" };
globalThis.fetch = async () => {
  throw new Error("no network in tests");
};

const DAY = 86400000;

test("Antrean: a late piece sits in the 'Semua' gallery, first and marked late; posted pieces aren't late", async () => {
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
    assert.doesNotMatch(html, /<details/, "no closed fold any more");
    const galleries = html.match(/<div class="pq-gal">/g) || [];
    assert.equal(galleries.length, 1, "one gallery");
    const tile = (title) => {
      const at = html.indexOf(title);
      assert.ok(at > 0, `${title} is in the gallery`);
      return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
    };
    assert.ok(html.indexOf("Kemarin belum naik") < html.indexOf("Besok tayang"), "the late piece comes first");
    assert.match(tile("Kemarin belum naik"), /class="pq-g [^"]*is-late/);
    assert.match(tile("Kemarin belum naik"), /pq-g-late">Terlambat</);
    assert.doesNotMatch(tile("Besok tayang"), /is-late/);
    // Over all time a posted piece stays under its own "Sudah tayang" chip.
    assert.doesNotMatch(html, /Kemarin sudah naik/);
  } finally {
    auth.currentUser = was;
  }
});

// Sent to the client or not, on every tile of a brand with a Klien (owner,
// 2026-11-14: "aku bingung di brandlab mana yang sudah aku kirim client yang
// mana yang belum, bisa kamu kasih tanda?").
test("Antrean: each tile says whether its newest cut went to the client", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { render } = await import("../js/views/posting-queue.js");
  await store.initStore("test-uid-antrean-klien");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Quatro" });
  store.updateBrand(b.id, { members: { "u-klien": { role: "viewer", klien: true, name: "Dessy" } }, memberIds: ["u-klien"] });
  const other = store.createBrand({ name: "Tanpa klien" });
  const v = (id, n, status) => ({ id, n, status, kind: "video" });
  const piece = (brandId, title, posting, extra = {}) => store.createContent(brandId, { title, status: "editing", scheduleDate: day(2), platform: "Instagram", format: "Reels", posting: { type: "reels", notes: [], finalId: null, ...posting }, ...extra });
  piece(b.id, "Belum pernah dikirim", { versions: [v("a1", 0, "pending")] });
  piece(b.id, "Terbaru sudah dikirim", { versions: [v("b1", 0, "revision"), v("b2", 1, "pending")], client: { versionId: "b2", status: "waiting", sentAt: Date.now() - 3600000 }, previews: { b1: { drive: [{ id: "d1" }] }, b2: { drive: [{ id: "d2" }] } } });
  piece(b.id, "Ada versi baru", { versions: [v("c1", 0, "revision"), v("c2", 1, "revision"), v("c3", 2, "pending")], client: { versionId: "c2", status: "revision", sentAt: Date.now() - 7200000 }, previews: { c2: { drive: [{ id: "d3" }] } } });
  piece(b.id, "Klien setuju", { versions: [v("e1", 0, "approved")], finalId: "e1", client: { versionId: "e1", status: "approved", sentAt: Date.now() - 9000000 } });
  piece(b.id, "Klien minta ubah", { versions: [v("f1", 0, "revision")], client: { versionId: "f1", status: "revision", sentAt: Date.now() - 9000000 } });
  piece(b.id, "Sudah naik", { versions: [v("g1", 0, "approved")], finalId: "g1", ig: { state: "published", byHand: true } }, { status: "published", publishedDate: day(-1), scheduleDate: day(-1) });
  piece(other.id, "Brand tanpa klien", { versions: [v("h1", 0, "pending")] });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    const paint = (brandId) => {
      const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
      render(root, { brandId })?.();
      return root.innerHTML;
    };
    const html = paint(b.id);
    const tile = (title) => {
      const at = html.indexOf(title);
      assert.ok(at > 0, `${title} is in the gallery`);
      return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
    };
    assert.match(tile("Belum pernah dikirim"), /pq-g-cl is-none[^>]*>.*Belum dikirim ke klien</s);
    assert.match(tile("Terbaru sudah dikirim"), /pq-g-cl is-sent is-waiting[^>]*title="Revisi 1 sudah dikirim ke klien · [^"]+">.*Sudah dikirim ke klien</s);
    assert.match(tile("Ada versi baru"), /pq-g-cl is-newer[^>]*title="Klien masih memegang Revisi 1 \(dikirim [^)]+\); versi terbaru belum dikirim">.*Revisi 2 belum dikirim</s);
    assert.match(tile("Klien setuju"), /pq-g-cl is-sent is-approved[^>]*>.*Disetujui klien</s);
    assert.match(tile("Klien minta ubah"), /pq-g-cl is-sent is-revision[^>]*>.*Klien minta revisi</s);
    // Posted: done, no mark; a brand without a client: no mark at all.
    const posted = paint(b.id).includes("Sudah naik") ? tile("Sudah naik") : "";
    assert.doesNotMatch(posted, /pq-g-cl/);
    assert.doesNotMatch(paint(other.id), /pq-g-cl/);
  } finally {
    auth.currentUser = was;
  }
});
