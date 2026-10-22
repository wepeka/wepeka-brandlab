// Papan guest links (api/papan.js): who may switch a board's link, what a
// guest gets when joining, and that an old or switched-off link is refused.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runPapan, guestUid, cleanGuestName, sameSecret, canShareBoard, newLinkSecret, PapanError } from "../api/papan.js";

const DAY = 86400000;
function fakeDeps(seed) {
  const docs = new Map(Object.entries(seed));
  const rt = new Map();
  const ref = (path) => ({
    path,
    async get() { const v = docs.get(path); return { id: path.split("/").pop(), exists: v !== undefined, data: () => (v === undefined ? undefined : structuredClone(v)) }; },
    async update(patch) { docs.set(path, { ...docs.get(path), ...structuredClone(patch) }); },
    async set(v, opts) { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...structuredClone(v) } : structuredClone(v)); },
    collection: (sub) => ({
      doc: (id) => ref(`${path}/${sub}/${id}`),
      count: () => ({ get: async () => ({ data: () => ({ count: [...docs.keys()].filter((k) => k.startsWith(`${path}/${sub}/`) && !k.slice(path.length + sub.length + 2).includes("/")).length }) }) }),
    }),
  });
  const tokens = [];
  return {
    docs, rt, tokens,
    db: { doc: ref },
    rtdb: { ref: (p) => ({ set: async (v) => rt.set(p, v) }) },
    auth: {
      createCustomToken: async (uid, claims) => { tokens.push({ uid, claims }); return `token-for-${uid}`; },
      getUser: async () => ({ displayName: "Winson" }),
    },
    now: () => 1_000_000,
  };
}
const seed = () => ({
  "accounts/owen": { status: "active", plan: "pro", subscriptionExpiresAt: 1_000_000 + 30 * DAY },
  "brands/b1": { ownerId: "owen", name: "Kopi Pagi", color: "#c7773b", members: { ed: { role: "editor", name: "Ed" }, vi: { role: "viewer", name: "Vi" }, pz: { role: "editor", name: "Pz", seatPaused: true } } },
  "brands/b1/boards/k1": { ownerId: "owen", brandId: "b1", name: "Rapat" },
});
const KEY = "k".repeat(32);
const expectErr = async (p, code) => { await assert.rejects(p, (e) => e instanceof PapanError && e.code === code); };

describe("Papan guest link helpers", () => {
  test("a guest id comes from the browser's key, the same every time", () => {
    assert.equal(guestUid(KEY), guestUid(KEY));
    assert.match(guestUid(KEY), /^pg-[0-9a-f]{24}$/);
    assert.notEqual(guestUid(KEY), guestUid("x".repeat(32)));
  });
  test("names are trimmed, single-spaced, without markup, at most 40 characters", () => {
    assert.equal(cleanGuestName("  Sari   Dewi \n"), "Sari Dewi");
    assert.equal(cleanGuestName("<b>Andi</b>"), "bAndi/b");
    assert.equal(cleanGuestName("a".repeat(60)).length, 40);
    assert.equal(cleanGuestName(""), "");
  });
  test("secrets compare exactly and never match empty", () => {
    const s = newLinkSecret();
    assert.match(s, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(sameSecret(s, s));
    assert.ok(!sameSecret(s, s.slice(1)));
    assert.ok(!sameSecret("", ""));
  });
  test("owner and editors may switch the link; viewers and paused editors may not", () => {
    const b = seed()["brands/b1"];
    assert.ok(canShareBoard(b, "owen"));
    assert.ok(canShareBoard(b, "ed"));
    assert.ok(!canShareBoard(b, "vi"));
    assert.ok(!canShareBoard(b, "pz"));
    assert.ok(!canShareBoard(b, "zed"));
  });
});

describe("api/papan share + join", () => {
  test("an editor turns the link on; a guest joins with a name and gets a token for this board only", async () => {
    const d = fakeDeps(seed());
    const { share } = await runPapan(d, "share", { uid: "ed" }, { brandId: "b1", boardId: "k1", on: true, role: "edit" });
    assert.equal(share.on, true);
    assert.equal(share.role, "edit");
    assert.deepEqual(d.rt.get("papanShare/b1/k1"), { on: true, role: "edit", t: share.t, owner: "owen" });
    const out = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t: share.t, name: " Sari ", key: KEY });
    assert.equal(out.uid, guestUid(KEY));
    assert.equal(out.name, "Sari");
    assert.equal(out.role, "edit");
    assert.equal(out.ownerId, "owen");
    assert.deepEqual(out.brand, { name: "Kopi Pagi", color: "#c7773b" });
    assert.equal(out.people.owen, "Winson");
    assert.equal(out.people.ed, "Ed");
    assert.deepEqual(d.tokens[0].claims, { papan: { b: "b1", k: "k1", t: share.t, r: "edit" } });
    assert.equal(d.docs.get(`brands/b1/boards/k1/guests/${out.uid}`).name, "Sari");
  });
  test("a viewer, a stranger or nobody signed in can't switch the link", async () => {
    const d = fakeDeps(seed());
    await expectErr(runPapan(d, "share", { uid: "vi" }, { brandId: "b1", boardId: "k1", on: true }), "not-editor");
    await expectErr(runPapan(d, "share", { uid: "zed" }, { brandId: "b1", boardId: "k1", on: true }), "not-editor");
    await expectErr(runPapan(d, "share", null, { brandId: "b1", boardId: "k1", on: true }), "auth");
  });
  test("a switched-off, wrong or replaced link is refused", async () => {
    const d = fakeDeps(seed());
    const first = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true })).share.t;
    const second = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true, rotate: true })).share.t;
    assert.notEqual(first, second);
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t: first, name: "Sari", key: KEY }), "link-off");
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t: "x".repeat(24), name: "Sari", key: KEY }), "link-off");
    await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: false });
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t: second, name: "Sari", key: KEY }), "link-off");
    assert.equal(d.rt.get("papanShare/b1/k1").on, false);
  });
  test("the link keeps its secret when only the role changes", async () => {
    const d = fakeDeps(seed());
    const a = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true, role: "edit" })).share;
    const b = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true, role: "view" })).share;
    assert.equal(a.t, b.t);
    const out = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t: b.t, name: "Sari", key: KEY });
    assert.equal(out.role, "view");
  });
  test("without a name a guest goes straight in as Tamu N, and keeps that name next time", async () => {
    const d = fakeDeps(seed());
    const { t } = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true })).share;
    const a = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, name: "  ", key: KEY });
    assert.equal(a.name, "Tamu 1");
    const b = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, key: "y".repeat(32) });
    assert.equal(b.name, "Tamu 2");
    const again = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, key: KEY });
    assert.equal(again.name, "Tamu 1");
    const renamed = await runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, name: "Sari", key: KEY });
    assert.equal(renamed.name, "Sari");
    assert.equal(d.docs.get(`brands/b1/boards/k1/guests/${a.uid}`).name, "Sari");
  });
  test("a bad key, a missing board or a lapsed owner plan: no entry", async () => {
    const d = fakeDeps(seed());
    const { t } = (await runPapan(d, "share", { uid: "owen" }, { brandId: "b1", boardId: "k1", on: true })).share;
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, name: "Sari", key: "short" }), "bad-request");
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "nope", t, name: "Sari", key: KEY }), "not-found");
    d.docs.set("accounts/owen", { status: "expired", plan: "pro" });
    await expectErr(runPapan(d, "join", null, { brandId: "b1", boardId: "k1", t, name: "Sari", key: KEY }), "owner-inactive");
  });
});
