import { test } from "node:test";
import assert from "node:assert/strict";
import { postingState, formatIssues, driveFolderPath, driveFileName, cleanName } from "../js/posting.js";

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
