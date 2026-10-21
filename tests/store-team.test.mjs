// Kerja Tim in js/store.js: brands shared with this account load next to its
// own, what a member creates carries the brand owner, a viewer writes
// nothing, and owner-only work (Trash purge, export) never touches shared
// docs. On the test stubs (tests/stubs/firebase-firestore.js).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { __docs, __writes, __reset } from "./stubs/firebase-firestore.js";
import * as store from "../js/store.js";

const flush = () => new Promise((r) => setTimeout(r, 5));
const writesTo = (path) => __writes.flatMap((w) => (w.op === "batch" ? w.ops : [w])).filter((w) => w.path === path);
const DAY = 86400000;

function seedShared({ role = "editor", trashedAgo = null } = {}) {
  __docs.set("brands/b1", {
    id: "b1", ownerId: "owen", name: "Kopi Pagi", createdAt: 1, memberIds: ["rina"],
    members: { rina: { role, name: "Rina", email: "rina@test.local", addedAt: 1 } }, ownerName: "Owen",
  });
  __docs.set("content/c1", { id: "c1", ownerId: "owen", brandId: "b1", title: "Cara pesan", status: "idea" });
  if (trashedAgo !== null) __docs.set("content/c2", { id: "c2", ownerId: "owen", brandId: "b1", title: "Lama", deletedAt: Date.now() - trashedAgo });
  __docs.set("brands/r1", { id: "r1", ownerId: "rina", name: "Rina Craft", createdAt: 2 });
  __docs.set("content/r9", { id: "r9", ownerId: "rina", brandId: "r1", title: "Punya Rina" });
}

beforeEach(() => {
  __reset();
});

describe("loading shared brands", () => {
  test("a member sees the shared brand and its content next to their own", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    assert.deepEqual(store.listBrands().map((b) => b.id).sort(), ["b1", "r1"]);
    assert.deepEqual(store.listContent("b1").map((c) => c.id), ["c1"]);
    assert.deepEqual(store.listContent("r1").map((c) => c.id), ["r9"]);
    assert.equal(store.brandRole("b1"), "editor");
    assert.equal(store.brandRole("r1"), "owner");
    assert.equal(store.isSharedBrand("b1"), true);
    assert.equal(store.isSharedBrand("r1"), false);
  });

  test("what an editor creates in a shared brand belongs to its owner", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    const c = store.createContent("b1", { title: "Ide Rina" });
    const k = store.createCampaign("b1", { name: "Launch" });
    const s = store.createSeries("b1", { name: "Pagi" });
    const mine = store.createContent("r1", { title: "Punyaku" });
    await flush();
    assert.equal(writesTo(`content/${c.id}`)[0].data.ownerId, "owen");
    assert.equal(writesTo(`campaigns/${k.id}`)[0].data.ownerId, "owen");
    assert.equal(writesTo(`series/${s.id}`)[0].data.ownerId, "owen");
    assert.equal(writesTo(`content/${mine.id}`)[0].data.ownerId, "rina");
  });

  test("a viewer changes nothing: no local change, no write", async () => {
    seedShared({ role: "viewer" });
    await store.initStore("rina");
    await flush();
    __writes.length = 0;
    assert.equal(store.canEditBrand("b1"), false);
    assert.equal(store.updateContent("c1", { title: "x" }), null);
    assert.equal(store.createContent("b1", { title: "x" }), null);
    assert.equal(store.updateBrand("b1", { tagline: "x" }), null);
    await flush();
    assert.equal(store.getContent("c1").title, "Cara pesan");
    assert.equal(__writes.length, 0);
  });

  test("a shared brand's life is its owner's: no archive, delete or purge from a member", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    __writes.length = 0;
    store.archiveBrand("b1");
    store.deleteBrand("b1");
    store.purgeBrand("b1");
    await flush();
    assert.equal(__writes.length, 0);
  });
});

describe("owner-only work never touches shared docs", () => {
  test("the 30-day Trash sweep purges only this account's own rows", async () => {
    seedShared({ trashedAgo: 40 * DAY });
    __docs.set("content/r8", { id: "r8", ownerId: "rina", brandId: "r1", title: "Lama punyaku", deletedAt: Date.now() - 40 * DAY });
    await store.initStore("rina");
    await flush();
    __writes.length = 0;
    store.purgeOldTrash();
    await flush();
    assert.equal(writesTo("content/c2").length, 0, "the owner's trashed doc stays");
    assert.equal(writesTo("content/r8").filter((w) => w.op === "delete").length, 1);
  });

  test("a backup holds this account's own docs only, never the team fields", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    const out = JSON.parse(store.exportJSON());
    assert.deepEqual(out.brands.map((b) => b.id), ["r1"]);
    assert.deepEqual(out.content.map((c) => c.id), ["r9"]);
  });
});

describe("the owner's side of a shared brand", () => {
  test("its tokens come from private/ in memory only, and go back there on a save", async () => {
    __docs.set("brands/o1", {
      id: "o1", ownerId: "owen", name: "Kopi Pagi", createdAt: 1, memberIds: ["rina"],
      members: { rina: { role: "editor" } }, instagram: { username: "kopipagi", igUserId: "1" },
    });
    __docs.set("brands/o1/private/integrations", { ownerId: "owen", instagram: { accessToken: "IG" } });
    await store.initStore("owen");
    await flush();
    await flush();
    const b = store.getBrand("o1");
    assert.equal(b.instagram.accessToken, "IG", "merged in memory");
    assert.equal(store.isSharedBrand(b), true);
    assert.equal(store.brandRole(b), "owner");
    __writes.length = 0;
    store.updateBrand("o1", { instagram: { ...b.instagram, lastAutoSyncAt: 5 } });
    await flush();
    const brandWrite = writesTo("brands/o1").at(-1);
    assert.doesNotMatch(JSON.stringify(brandWrite.data), /"IG"/, "the token never goes to the brand doc");
    assert.equal(__docs.get("brands/o1").instagram.lastAutoSyncAt, 5);
    assert.equal(__docs.get("brands/o1").instagram.accessToken, undefined);
    assert.equal(__docs.get("brands/o1").instagram.username, "kopipagi");
    const priv = writesTo("brands/o1/private/integrations").at(-1);
    assert.equal(priv.data.instagram.accessToken, "IG");
    assert.deepEqual(priv.options, { merge: true });
  });

  test("a solo brand saves exactly as before (token stays inline)", async () => {
    __docs.set("brands/s1", { id: "s1", ownerId: "owen", name: "Solo", createdAt: 1, instagram: { username: "solo", accessToken: "T" } });
    await store.initStore("owen");
    await flush();
    __writes.length = 0;
    store.updateBrand("s1", { instagram: { ...store.getBrand("s1").instagram, lastAutoSyncAt: 1 } });
    await flush();
    assert.equal(writesTo("brands/s1").at(-1).data.instagram.accessToken, "T");
    assert.equal(writesTo("brands/s1/private/integrations").length, 0);
  });
});

describe("private chats in a shared brand", () => {
  test("a member's rolling threads carry their uid; the owner's keep the plain ids", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    assert.equal(store.consultThreadId("b1"), "consult-b1-rina");
    assert.equal(store.companionThreadId("b1"), "companion-b1-rina");
    assert.equal(store.scriptThreadId("c1", "b1"), "script-c1-rina");
    assert.equal(store.consultThreadId("r1"), "consult-r1", "her own brand: as before");
    const th = store.ensureConsultThread("b1");
    await flush();
    assert.equal(th.ownerId, "rina", "the thread is hers, not the owner's");
  });
  test("her chat sessions go to people/{uid}, never onto the shared brand doc", async () => {
    seedShared();
    await store.initStore("rina");
    await flush();
    await store.watchBrandScope("b1");
    __writes.length = 0;
    store.setChatSessions("b1", [{ id: "s1", title: "Ide" }]);
    store.setCompanionState("b1", { lastAskedAt: "2026-10-22" });
    await flush();
    assert.equal(writesTo("brands/b1").length, 0);
    const p = writesTo("brands/b1/people/rina");
    assert.equal(p.length, 2);
    assert.deepEqual(p[0].options, { merge: true });
    assert.deepEqual(store.chatSessionsOf("b1"), [{ id: "s1", title: "Ide" }]);
    assert.equal(store.companionStateOf("b1").lastAskedAt, "2026-10-22");
  });
  test("a solo brand keeps its sessions on the brand doc", async () => {
    __docs.set("brands/s1", { id: "s1", ownerId: "owen", name: "Solo", createdAt: 1 });
    await store.initStore("owen");
    await flush();
    __writes.length = 0;
    store.setChatSessions("s1", [{ id: "x" }]);
    await flush();
    assert.deepEqual(writesTo("brands/s1").at(-1).data.chatSessions, [{ id: "x" }]);
  });
});

describe("two people saving one shared brand", () => {
  test("Rina's mission and Winson's vision both survive; both new ideas are kept", async () => {
    seedShared();
    __docs.set("brands/b1", { ...__docs.get("brands/b1"), brandDNA: { mission: "m", vision: "v" }, ideas: [{ id: "i1", text: "lama" }] });
    await store.initStore("rina");
    await flush();
    // Meanwhile Winson saved (the server has it; Rina's copy doesn't yet).
    const server = __docs.get("brands/b1");
    __docs.set("brands/b1", { ...server, brandDNA: { ...server.brandDNA, vision: "v-winson" }, ideas: [{ id: "i9", text: "ide Winson" }, ...server.ideas] });
    const b = store.getBrand("b1");
    store.updateBrand("b1", { brandDNA: { ...b.brandDNA, mission: "m-rina" } });
    store.addBrandIdea("b1", { text: "ide Rina" });
    await flush();
    await flush();
    const after = __docs.get("brands/b1");
    assert.equal(after.brandDNA.mission, "m-rina");
    assert.equal(after.brandDNA.vision, "v-winson", "Winson's vision was not overwritten");
    const texts = after.ideas.map((i) => i.text).sort();
    assert.deepEqual(texts, ["ide Rina", "ide Winson", "lama"]);
    assert.equal(after.editedBy.brandDNA.uid, "rina");
  });
  test("a page's own copy (base): only what the page changed is written", async () => {
    seedShared();
    __docs.set("brands/b1", { ...__docs.get("brands/b1"), brandDNA: { mission: "m", vision: "v" } });
    await store.initStore("rina");
    await flush();
    const opened = { ...store.getBrand("b1").brandDNA }; // the page's copy, when it opened
    // A teammate's vision arrives in memory after the page opened.
    store.getBrand("b1").brandDNA = { ...store.getBrand("b1").brandDNA, vision: "v-baru" };
    __docs.set("brands/b1", { ...__docs.get("brands/b1"), brandDNA: { mission: "m", vision: "v-baru" } });
    store.updateBrand("b1", { brandDNA: { ...opened, mission: "m-rina" } }, { base: { brandDNA: opened } });
    await flush();
    assert.deepEqual(__docs.get("brands/b1").brandDNA, { mission: "m-rina", vision: "v-baru" });
    assert.deepEqual(store.getBrand("b1").brandDNA, { mission: "m-rina", vision: "v-baru" });
  });
  test("a solo brand still writes its sections whole", async () => {
    __docs.set("brands/s1", { id: "s1", ownerId: "owen", name: "Solo", createdAt: 1, brandDNA: { mission: "m" } });
    await store.initStore("owen");
    await flush();
    __writes.length = 0;
    store.updateBrand("s1", { brandDNA: { mission: "m2" } });
    await flush();
    const w = writesTo("brands/s1").at(-1);
    assert.deepEqual(Object.keys(w.data), ["brandDNA"]);
  });
});
