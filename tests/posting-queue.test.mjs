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

// Every account on its own brands (owner, 2026-11-16): the same gallery,
// Drive in the header, no Mac folder, clients, footage or "Dicek klien".
test("Antrean: a customer's own brand gets the gallery with codes and Drive, without Wepeka's desk", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { render } = await import("../js/views/posting-queue.js");
  await store.initStore("u-customer-antrean");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Kopi Pagi" });
  store.createContent(b.id, { title: "Video jendela", status: "editing", scheduleDate: day(2), platform: "Instagram", format: "Reels", posting: { type: "reels", notes: [], versions: [{ id: "v1", n: 0, status: "pending", kind: "video", drive: { id: "d1" } }] } });
  store.createContent(b.id, { title: "Belum ada video", status: "draft", scheduleDate: day(3), platform: "Instagram", format: "Reels" });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: "u-customer-antrean" };
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    render(root, { brandId: b.id })?.();
    const html = root.innerHTML;
    assert.match(html, /Video jendela/);
    assert.match(html, /Belum ada video/);
    assert.match(html, /class="pq-g-code"[^>]*>KP-\d+</, "each piece gets its code");
    assert.match(html, /Upload videonya, cek dan beri catatan revisi/, "the lead speaks to them, not to the editor");
    assert.doesNotMatch(html, /id="pq-client"/, "no Klien button");
    assert.doesNotMatch(html, /data-status="client"/, "no 'Dicek klien' chip");
    assert.doesNotMatch(html, /data-view="footage"/, "no footage bank");
    assert.match(html, /id="pq-review"/, "review mode is there");
    // Working alone: the new cut is the one to post, nothing waits for a review.
    assert.match(html, /Video siap/);
    assert.doesNotMatch(html, /Mulai review \(1\)/);
    // Once a teammate works on the brand, the cut waits for a look.
    store.updateBrand(b.id, { memberIds: ["u-editor"], members: { "u-editor": { role: "editor", name: "Dodi" } } });
    render(root, { brandId: b.id })?.();
    assert.match(root.innerHTML, /Mulai review \(1\)/);
    assert.match(root.innerHTML, /Menunggu review/);
  } finally {
    auth.currentUser = was;
  }
});

// Download on the tile (owner, 2026-11-14: "kasih tombol download video di
// brandlab di antreannya"): Wepeka's side, a tile with a cut it can read
// gets the button, labelled with the cut it saves; an empty tile doesn't.
test("Antrean: a tile with a cut gets a download button for the IG pick (else the newest); no cut, no button", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { render } = await import("../js/views/posting-queue.js");
  const { canDownloadCut, downloadCutOf, ownDownloadLabel } = await import("../js/posting.js");
  await store.initStore("test-uid-antrean-dl");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Kopi Unduh" });
  const v = (id, n, status, extra = {}) => ({ id, n, status, kind: "video", drive: { id: `d-${id}`, ext: "mp4" }, ...extra });
  const two = store.createContent(b.id, { title: "Dua versi", status: "editing", scheduleDate: day(2), platform: "Instagram", format: "Reels", posting: { type: "reels", versions: [v("a", 0, "revision"), v("b", 1, "pending")], finalId: null, notes: [] } });
  const picked = store.createContent(b.id, { title: "Sudah dipilih", status: "editing", scheduleDate: day(3), platform: "Instagram", format: "Reels", posting: { type: "reels", versions: [v("c", 0, "approved"), v("d", 1, "pending")], finalId: "c", notes: [] } });
  store.createContent(b.id, { title: "Belum ada cut", status: "draft", scheduleDate: day(4), platform: "Instagram", format: "Reels", posting: { type: "reels", versions: [], notes: [] } });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    assert.equal(downloadCutOf(store.getContent(two.id)).id, "b", "no IG pick: the newest cut");
    assert.equal(downloadCutOf(store.getContent(picked.id)).id, "c", "the cut picked for Instagram");
    assert.equal(ownDownloadLabel(store.getContent(picked.id), downloadCutOf(store.getContent(picked.id))), "Unduh video · FINAL");
    // A Mac-folder cut needs the folder open in this browser (none in tests).
    assert.equal(canDownloadCut(store.getContent(two.id), { id: "x", n: 0, status: "pending", kind: "video", local: { file: "v1.mp4" } }), false);
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    render(root, { brandId: b.id })?.();
    const html = root.innerHTML;
    const tile = (title) => {
      const at = html.indexOf(title);
      assert.ok(at > 0, `${title} is in the gallery`);
      return html.slice(html.lastIndexOf("<article", at), html.indexOf("</article>", at));
    };
    assert.match(tile("Dua versi"), /class="pq-g-dl" data-dl="[^"]+" data-vid="b"[^>]*aria-label="Unduh video · Revisi 1"/);
    assert.match(tile("Sudah dipilih"), /data-vid="c"[^>]*aria-label="Unduh video · FINAL"/);
    assert.doesNotMatch(tile("Belum ada cut"), /pq-g-dl/);
  } finally {
    auth.currentUser = was;
  }
});

// Siap upload (owner, 2026-11-24: "kalau orang sudah siap upload bisa
// download videonya langsung dari brandlab trs bisa copas caption dsb").
test("Antrean → Siap upload: only what's ready and not up yet, each with its file, its words and 'Sudah tayang'", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { render } = await import("../js/views/posting-queue.js");
  const { uploadCutOf, hashtagsOf, markPostedByHand } = await import("../js/posting.js");
  await store.initStore("u-siap-upload");
  const day = (n) => store.localISODate(new Date(Date.now() + n * DAY));
  const b = store.createBrand({ name: "Kopi Siap" });
  const v = (id, n, status) => ({ id, n, status, kind: "video", drive: { id: `d-${id}`, ext: "mp4" } });
  const piece = (title, posting, extra = {}) => store.createContent(b.id, { title, status: "editing", scheduleDate: day(2), platform: "Instagram", format: "Reels", posting: { type: "reels", notes: [], finalId: null, ...posting }, ...extra });
  const ready = piece("Sudah disetujui", { versions: [v("a", 0, "revision"), v("b", 1, "approved")], finalId: "b" }, { caption: "Kopi baru!\n#kopi #pagi" });
  piece("Masih direvisi", { versions: [v("c", 0, "revision")] });
  piece("Belum ada video", { versions: [] });
  const posted = piece("Sudah naik", { versions: [v("e", 0, "approved")], finalId: "e", ig: { state: "published", byHand: true } }, { status: "published", publishedDate: day(-1) });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: "u-siap-upload" };
    assert.equal(uploadCutOf(store.getContent(ready.id)).v.id, "b", "the approved cut");
    assert.equal(uploadCutOf(store.getContent(ready.id)).label, "Unduh video · FINAL");
    assert.deepEqual(hashtagsOf(store.getContent(ready.id).caption), ["#kopi", "#pagi"]);
    localStorage.setItem("posting:queueView", "upload");
    const root = { innerHTML: "", isConnected: true, querySelector: () => null, querySelectorAll: () => [], classList: { contains: () => false } };
    render(root, { brandId: b.id })?.();
    const html = root.innerHTML;
    assert.match(html, /class="pqu-list"/, "opens on Siap upload");
    assert.match(html, /Sudah disetujui/);
    assert.doesNotMatch(html, /Masih direvisi/);
    assert.doesNotMatch(html, /pqu-card[^]*Sudah naik/);
    assert.match(html, /data-u-dl="[^"]+"/, "a computer gets the download");
    assert.match(html, /Salin hashtag \(2\)/);
    assert.match(html, /data-u-posted=/);
    assert.match(html, /data-view="upload"/, "the view is offered");
    // "Sudah tayang": a post link is tidied, anything else refused.
    assert.equal(markPostedByHand(ready.id, "bukan link"), false);
    assert.equal(store.getContent(ready.id).status, "editing");
    assert.equal(markPostedByHand(ready.id, "https://www.instagram.com/reel/DAbc123xyz/?igsh=x"), true);
    const after = store.getContent(ready.id);
    assert.equal(after.status, "published");
    assert.equal(after.publishedUrl, "https://www.instagram.com/reel/DAbc123xyz/");
    assert.deepEqual([after.posting.ig.state, after.posting.ig.byHand], ["published", true]);
    assert.equal(store.getContent(posted.id).status, "published");
  } finally {
    auth.currentUser = was;
    try { localStorage.removeItem("posting:queueView"); } catch { /* fine */ }
  }
});

// The same kit on Creator's Upload step (owner, 2026-11-24: "tampilan di
// create juga sama bisa download video dan upload").
test("upload kit: one component for Antrean and Creator — the cut, the cover, the title, caption and hashtags", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { uploadKitHTML, uploadCopyHTML } = await import("../js/posting.js");
  await store.initStore("u-kit");
  const b = store.createBrand({ name: "Kopi Kit" });
  const v = (id, n, status) => ({ id, n, status, kind: "video", drive: { id: `d-${id}`, ext: "mp4" } });
  const withCover = store.createContent(b.id, { title: "Ada cover", status: "editing", platform: "Instagram", format: "Reels", caption: "Halo #kopi", thumbnail: "data:image/png;base64,AAAA", posting: { type: "reels", notes: [], versions: [v("a", 0, "approved")], finalId: "a" } });
  const noCut = store.createContent(b.id, { title: "Belum ada video", status: "editing", platform: "Instagram", format: "Reels", posting: { type: "reels", notes: [], versions: [] } });
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: "u-kit" };
    const kit = uploadKitHTML(store.getContent(withCover.id), { captionCopy: true });
    assert.match(kit, /data-u-dl="[^"]+"[^>]*><span>Unduh video · FINAL</);
    assert.match(kit, /data-u-cover=/);
    assert.match(kit, /data-u-copy="title"/);
    assert.match(kit, /data-u-copy="caption"/);
    assert.match(kit, /Salin hashtag \(1\)/);
    // No cut yet: says so instead of a dead button; no cover without one.
    const empty = uploadKitHTML(store.getContent(noCut.id));
    assert.doesNotMatch(empty, /data-u-dl|data-u-prep/);
    assert.match(empty, /pqu-nofile/);
    assert.doesNotMatch(empty, /data-u-cover/);
    assert.equal(uploadCopyHTML(store.getContent(noCut.id), "caption"), "", "nothing to copy");
  } finally {
    auth.currentUser = was;
  }
});
