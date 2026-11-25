import { test } from "node:test";
import assert from "node:assert/strict";
import { postingState, formatIssues, driveFolderPath, driveFileName, cleanName, readsFromMac, phoneCopyWanted } from "../js/posting.js";

const v = (id, status, extra = {}) => ({ id, n: 0, status, w: 540, h: 960, dur: 10, size: 1e6, type: "video/mp4", ...extra });

test("a piece's video state follows its newest version, then its Instagram slot", () => {
  assert.equal(postingState({ status: "draft" }), "none");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "pending")], notes: [] } }), "review");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "revision")], notes: [] } }), "revision");
  // an approved older cut doesn't hide a newer one waiting for a look
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "approved"), v("b", "pending")], finalId: "a", notes: [] } }), "review");
  assert.equal(postingState({ status: "editing", posting: { versions: [v("a", "revision"), v("b", "approved")], finalId: "b", notes: [] } }), "ready");
  assert.equal(postingState({ status: "scheduled", posting: { versions: [v("a", "approved")], finalId: "a", notes: [], ig: { state: "scheduled" } } }), "scheduled");
  assert.equal(postingState({ status: "scheduled", posting: { versions: [v("a", "approved")], finalId: "a", notes: [], ig: { state: "failed" } } }), "failed");
  assert.equal(postingState({ status: "published", posting: { versions: [v("a", "approved")], finalId: "a", notes: [] } }), "published");
});

test("a piece holding only the client's Drive folder (footage started, no cut yet) reads as no video, not a crash", () => {
  // 2026-11-10 QKC-30: posting = { clientFolder } broke the whole Create page
  assert.equal(postingState({ status: "production", posting: { clientFolder: "f1" } }), "none");
  assert.equal(postingState({ status: "production", posting: { clientFolder: "f1", versions: [v("a", "pending")] } }), "review");
  assert.equal(postingState({ status: "published", posting: { clientFolder: "f1" } }), "none");
});

test("videos land in the owner's Drive as Brandlab / brand / month / piece, the posted cut marked FINAL", () => {
  const c = { scheduleDate: "2026-11-04", title: "Video jendela drive-thru" };
  assert.deepEqual(driveFolderPath({ name: "Kopi Pagi" }, c, "id"), ["Brandlab", "Kopi Pagi", "2026-11 November", "04 Nov · Video jendela drive-thru"]);
  // slashes would make Drive folders inside folders
  assert.equal(driveFolderPath({ name: "A/B Coffee" }, { title: "Promo 1/2" }, "id")[1], "A-B Coffee");
  assert.equal(driveFolderPath({ name: "X" }, { title: "Promo 1/2" }, "id")[2], "Tanpa tanggal");
  assert.equal(driveFileName({ n: 0 }, "mov"), "Original.mov");
  assert.equal(driveFileName({ n: 2 }, "mp4", true), "Revisi 2 (FINAL).mp4");
});

test("Outbox folder names never end in a dot or a space (Chrome skips those folders)", () => {
  assert.equal(cleanName('WIN-25 2026-11-04 "Logo itu harus ngejelasin bisnismu." Nggak.'), "WIN-25 2026-11-04 -Logo itu harus ngejelasin bisnismu.- Nggak");
  assert.equal(cleanName("KP-3 2026-11-03 Tunggu dulu..."), "KP-3 2026-11-03 Tunggu dulu");
  // cut at 90 characters right after a dot or a space
  assert.equal(cleanName(`${"a".repeat(88)}. b`), "a".repeat(88));
  assert.equal(cleanName("KP-12 2026-11-03 Cara pesan lewat WA"), "KP-12 2026-11-03 Cara pesan lewat WA");
});

test("format check only speaks up about what Instagram would refuse or crop", () => {
  assert.deepEqual(formatIssues(v("a", "pending")), []);
  assert.equal(formatIssues(v("a", "pending", { w: 1920, h: 1080 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { dur: 901 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { size: 301 * 1048576 })).length, 1);
  assert.equal(formatIssues(v("a", "pending", { type: "video/webm" })).length, 1);
});

test("brandlab.json tells Claude the decision, the cut, the cover and every note by file", async () => {
  const { decisionsFor } = await import("../js/posting.js");
  const c = {
    title: "WA", scheduleDate: "2026-11-03", caption: "Cap", status: "editing",
    posting: {
      type: "reels", time: "19:00", cover: "cover-2.jpg", finalId: null,
      versions: [{ id: "a", n: 0, status: "revision", local: { file: "v1.mp4" } }, { id: "b", n: 1, status: "pending", local: { file: "v2.mp4" } }],
      notes: [{ id: "n", versionId: "a", t: 12, text: "Logo kepotong", done: false }, { id: "w", versionId: "b", t: null, text: "Speed 1.15x semua", done: false }],
    },
  };
  const d = decisionsFor(c);
  assert.equal(d.status, "review");
  assert.equal(d.final, "");
  assert.equal(d.cover, "cover-2.jpg");
  assert.deepEqual(d.versions, [{ file: "v1.mp4", status: "revision" }, { file: "v2.mp4", status: "pending" }]);
  assert.deepEqual(d.notes, [
    { id: "n", file: "v1.mp4", at: "0:12", seconds: 12, text: "Logo kepotong", done: false, from: "winson" },
    { id: "w", file: "v2.mp4", at: null, seconds: null, text: "Speed 1.15x semua", done: false, from: "winson" },
  ], "a whole-video note has no second");
});

test("an Instagram post link is tidied to its permalink, anything else refused", async () => {
  const { igPermalink } = await import("../js/posting.js");
  assert.equal(igPermalink("https://www.instagram.com/reel/DAbc_12-x/?igsh=abc"), "https://www.instagram.com/reel/DAbc_12-x/");
  assert.equal(igPermalink("instagram.com/reels/DAbc123"), "https://www.instagram.com/reel/DAbc123/");
  assert.equal(igPermalink("https://www.instagram.com/kopipagi/p/CxYz987/"), "https://www.instagram.com/p/CxYz987/");
  assert.equal(igPermalink("https://tiktok.com/@x/video/1"), "");
});

test("Send to editor: only the owner's account gets the button, and only for a cut in the Mac folder", async () => {
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { editorBlockHTML, editorChip, decisionsFor } = await import("../js/posting.js");
  const c = {
    id: "c1", title: "WA", status: "editing",
    posting: {
      local: { key: "Kopi Pagi/KP-1 2026-11-03 WA" }, type: "reels",
      versions: [{ id: "a", n: 0, status: "revision", kind: "video", local: { file: "v1.mp4" } }],
      notes: [{ id: "n1", versionId: "a", t: 12, text: "Logo kepotong", done: false }, { id: "n0", versionId: "a", t: 3, text: "Musik", done: true }],
    },
  };
  const pending = { ...c, posting: { ...c.posting, editor: { status: "requested", requestedAt: "2026-11-02T10:00:00.000Z", version: "v1.mp4", message: "", noteIds: ["n1"] } } };
  const was = auth.currentUser;
  try {
    // A collaborator, a brand member, a customer: nothing at all, in any state.
    for (const who of [{ uid: "member-uid" }, { uid: "customer-uid" }, null]) {
      auth.currentUser = who;
      assert.equal(editorBlockHTML(c), "");
      assert.equal(editorBlockHTML(c, { editorOpen: true }), "");
      assert.equal(editorBlockHTML(pending), "");
      assert.equal(editorChip(pending), null);
    }

    auth.currentUser = { uid: ADMIN_UIDS[0] };
    assert.match(editorBlockHTML(c), /id="pst-ed-open"[\s\S]*Send to editor/);
    const form = editorBlockHTML(c, { editorOpen: true });
    assert.match(form, /data-ed-note="n1" checked/, "open notes of the newest cut come pre-ticked");
    assert.doesNotMatch(form, /data-ed-note="n0"/, "notes already fixed stay out");
    assert.match(form, /id="pst-ed-msg"/);
    assert.equal(editorBlockHTML({ ...c, posting: { ...c.posting, local: null } }), "", "no Mac folder, no button");
    // Sent: no button, the chip and "Batalkan" instead.
    assert.doesNotMatch(editorBlockHTML(pending), /pst-ed-open/);
    assert.match(editorBlockHTML(pending), /id="pst-ed-undo"/);
    assert.equal(editorChip(pending).key, "pending");
    // Claude's v2 is in: "Revisi 1 masuk" until that cut is decided, then nothing.
    const v2 = { id: "b", n: 1, status: "pending", kind: "video", local: { file: "v2.mp4" } };
    const delivered = { ...c, posting: { ...pending.posting, versions: [...c.posting.versions, v2], editor: { ...pending.posting.editor, status: "done", doneAt: "2026-11-02T11:00:00.000Z" } } };
    assert.equal(editorChip(delivered).key, "delivered");
    assert.equal(editorChip(delivered).label, "Revisi 1 masuk");
    assert.equal(editorChip({ ...delivered, posting: { ...delivered.posting, versions: [c.posting.versions[0], { ...v2, status: "approved" }] } }), null);
    // brandlab.json carries the same request.
    assert.deepEqual(decisionsFor(pending).editor, pending.posting.editor);
    assert.equal(decisionsFor(c).editor, null);
  } finally {
    auth.currentUser = was;
  }
});

test("Ask editor to make thumbnail: owner only, for a video cut in the Mac folder", async () => {
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { thumbBlockHTML, decisionsFor } = await import("../js/posting.js");
  const c = {
    id: "c1", title: "WA", status: "editing",
    posting: { local: { key: "Kopi Pagi/KP-1 2026-11-03 WA" }, type: "reels", covers: [], versions: [{ id: "a", n: 0, status: "pending", kind: "video", local: { file: "v1.mp4" } }], notes: [] },
  };
  const asked = { ...c, posting: { ...c.posting, thumb: { status: "requested", requestedAt: "2026-11-02T10:00:00.000Z", version: "v1.mp4", at: 4, message: "", had: [] } } };
  const was = auth.currentUser;
  try {
    for (const who of [{ uid: "member-uid" }, null]) {
      auth.currentUser = who;
      assert.equal(thumbBlockHTML(c), "");
      assert.equal(thumbBlockHTML(asked), "");
    }
    auth.currentUser = { uid: ADMIN_UIDS[0] };
    assert.match(thumbBlockHTML(c), /id="pst-th-open"[\s\S]*Ask editor to make thumbnail/);
    const form = thumbBlockHTML(c, { thumbOpen: true, t: 4.2 });
    assert.match(form, /id="pst-th-msg"/);
    assert.match(form, /id="pst-th-frame" checked/);
    assert.match(form, /0:04/, "the frame on screen");
    assert.match(thumbBlockHTML(asked), /id="pst-th-undo"/);
    assert.doesNotMatch(thumbBlockHTML(asked), /pst-th-open/);
    assert.equal(thumbBlockHTML({ ...c, posting: { ...c.posting, local: null } }), "", "no Mac folder, no button");
    assert.equal(thumbBlockHTML({ ...c, posting: { ...c.posting, versions: [{ id: "s", n: 0, status: "pending", kind: "set", local: { file: "slides", slides: ["01.jpg"] } }] } }), "", "carousels have no thumbnail");
    assert.deepEqual(decisionsFor(asked).thumbnail, asked.posting.thumb);
    assert.equal(decisionsFor(c).thumbnail, null);
  } finally {
    auth.currentUser = was;
  }
});

// Every account (owner, 2026-11-16: "aktivasi ke semua orang user brandlab
// biasa"): Video & posting on the brands it owns, Drive only; Wepeka's desk
// (Mac folder, editor, Instagram posting, clients) stays Wepeka's.
test("Video & posting: every account on its own brands; Wepeka's brands keep the Klien view; the desk stays Wepeka's", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { ADMIN_UIDS } = await import("../js/account.js");
  const { canUsePosting, canSeePosting, isClientView, isWepekaDesk, editorBlockHTML, editTipsToo } = await import("../js/posting.js");
  await store.initStore("u-customer");
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: "u-customer" };
    const own = store.createBrand({ name: "Kopi Pagi" });
    assert.equal(isWepekaDesk(), false);
    assert.equal(canUsePosting(own), true, "their own brand");
    assert.equal(canUsePosting(own.id), true, "by id too");
    assert.equal(canSeePosting({ brandId: own.id }), true, "a piece of it");
    // Someone else's brand shared through Kerja Tim: not theirs to keep videos for.
    const shared = { id: "b-shared", ownerId: "u-other", members: { "u-customer": { role: "editor" } } };
    assert.equal(canUsePosting(shared), false);
    // A Wepeka brand where they're the Klien: the client view, as before.
    const quatro = { id: "b-quatro", ownerId: ADMIN_UIDS[0], members: { "u-customer": { role: "viewer", klien: true } } };
    assert.equal(canUsePosting(quatro), false);
    assert.equal(isClientView(quatro), true);
    assert.equal(canSeePosting(quatro), true);
    // Nothing to resolve: nothing.
    assert.equal(canUsePosting(undefined), false);
    // The editor queue needs the Mac folder: still nowhere for a customer.
    const c = { id: "c1", brandId: own.id, posting: { local: { key: "x/y" }, versions: [{ id: "a", n: 0, status: "pending", kind: "video", local: { file: "v1.mp4" } }], notes: [] } };
    assert.equal(editorBlockHTML(c), "");
    // Editing tips stay above the video until the first cut.
    assert.equal(editTipsToo({ id: "c2", brandId: own.id }), true);
    assert.equal(editTipsToo(c), false);

    auth.currentUser = { uid: ADMIN_UIDS[0] };
    assert.equal(isWepekaDesk(), true);
    assert.equal(canUsePosting(shared), true, "Wepeka's account: every brand it sees");
    assert.equal(isClientView(quatro), false);
    assert.equal(editTipsToo({ id: "c2", brandId: own.id }), false);
  } finally {
    auth.currentUser = was;
  }
});

test("review flow: someone working alone is never asked to approve their own cut; a team brand reviews, then reviews again", async () => {
  const store = await import("../js/store.js");
  const { auth } = await import("../js/firebase.js");
  const { postingState, isSoloBrand, stateLabelOf, reviewQueue } = await import("../js/posting.js");
  await store.initStore("u-solo");
  const was = auth.currentUser;
  try {
    auth.currentUser = { uid: "u-solo" };
    const solo = store.createBrand({ name: "Sendiri Saja" });
    const team = store.createBrand({ name: "Ada Tim" });
    store.updateBrand(team.id, { memberIds: ["u-editor"], members: { "u-editor": { role: "editor", name: "Dodi" } } });
    assert.equal(isSoloBrand(solo), true);
    assert.equal(isSoloBrand(store.getBrand(team.id)), false);

    const pending = { versions: [v("a", "pending")], notes: [] };
    const soloPiece = store.createContent(solo.id, { title: "Solo", status: "editing", platform: "Instagram", posting: pending });
    const teamPiece = store.createContent(team.id, { title: "Tim", status: "editing", platform: "Instagram", posting: pending });
    // Alone: the newest cut is simply the one to post.
    assert.equal(postingState(store.getContent(soloPiece.id)), "ready");
    assert.equal(stateLabelOf(store.getContent(soloPiece.id)), "Video siap");
    // A team: the first cut waits for a review; the review list counts it.
    assert.equal(postingState(store.getContent(teamPiece.id)), "review");
    assert.equal(stateLabelOf(store.getContent(teamPiece.id)), "Menunggu review");
    assert.deepEqual(reviewQueue().map((x) => x.c.id), [teamPiece.id]);
    // A revised cut after notes: "Review ulang".
    store.updateContent(teamPiece.id, { posting: { versions: [v("a", "revision"), v("b", "pending", { n: 1 })], notes: [] } });
    assert.equal(stateLabelOf(store.getContent(teamPiece.id)), "Review ulang");
    // Approved; with a date and a caption it's ready to upload.
    store.updateContent(teamPiece.id, { posting: { versions: [v("a", "revision"), v("b", "approved", { n: 1 })], finalId: "b", notes: [] } });
    assert.equal(stateLabelOf(store.getContent(teamPiece.id)), "Disetujui");
    store.updateContent(teamPiece.id, { scheduleDate: "2026-12-01", caption: "Halo" });
    assert.equal(stateLabelOf(store.getContent(teamPiece.id)), "Siap upload");
    // A note on a solo cut still asks for changes (their own to-do).
    store.updateContent(soloPiece.id, { posting: { versions: [v("a", "revision")], notes: [] } });
    assert.equal(postingState(store.getContent(soloPiece.id)), "revision");
  } finally {
    auth.currentUser = was;
  }
});

test("away from the Mac (the phone), a Mac-folder cut with its Drive copy reads from Drive; on the Mac the folder stays the source", () => {
  const local = { id: "l1", local: { file: "v1.mp4" } };
  const copied = { ...local, drive: { id: "d1", copy: true } };
  assert.equal(readsFromMac(local, true), true);
  assert.equal(readsFromMac(copied, true), true, "Mac folder open: never the copy");
  assert.equal(readsFromMac(copied, false), false, "phone: the Drive copy");
  assert.equal(readsFromMac(local, false), true, "no copy yet: still the folder (shows 'open on the Mac')");
  assert.equal(readsFromMac({ id: "d", drive: { id: "x" } }, false), false, "a Drive cut is never local");
  assert.equal(readsFromMac({ id: "s", kind: "set", local: { file: "v1", slides: ["01.jpg"] }, driveFiles: [{ id: "a" }] }, false), false, "phone: a carousel's copied slides");
});

test("phone copies: the newest cut and the approved one of a piece in the works (video, photo or carousel), made since it shipped, once", () => {
  const from = Date.parse("2026-11-25T00:00:00Z"), at = from + 1000;
  const cut = (id, extra = {}) => ({ id, n: 0, status: "pending", at, kind: "video", local: { file: `${id}.mp4` }, ...extra });
  const piece = (posting, extra = {}) => ({ status: "editing", ...extra, posting: { local: { key: "winkhsin/WIN-1 x" }, notes: [], ...posting } });
  const ids = (c) => phoneCopyWanted(c, from).map((v) => v.id);
  assert.deepEqual(ids(piece({ versions: [cut("v1"), cut("v2")] })), ["v2"], "older cuts stay Mac-only");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { status: "approved" }), cut("v2")], finalId: "v1" })), ["v2", "v1"], "plus the approved one");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { drive: { id: "d" } })] })), [], "already copied");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { at: from - 1 })] })), [], "made before it shipped");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { kind: "set", local: { file: "v1", slides: ["01.jpg", "02.jpg"] } })] })), ["v1"], "a carousel's slides too (2026-11-25)");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { kind: "set", local: { file: "v1", slides: [] } })] })), [], "an empty slide folder: nothing to copy");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { kind: "image", local: { file: "foto.jpg" } })] })), ["v1"], "a photo too");
  assert.deepEqual(ids(piece({ versions: [cut("v1", { kind: "set", local: { file: "v1", slides: ["01.jpg"] }, driveFiles: [{ id: "a" }] })] })), [], "slides already copied");
  assert.deepEqual(ids(piece({ versions: [cut("v1")] }, { status: "published" })), [], "already posted");
  assert.deepEqual(ids({ status: "editing", posting: { versions: [{ ...cut("v1"), local: undefined, drive: { id: "x" } }], notes: [] } }), [], "not a Mac-folder piece");
});
