// Papan (whiteboard) rules — firestore.rules "Papan" + database.rules.json
// papanLive — against the LOCAL emulators (`npm run test:rules`, project
// demo-brandlab). Brand b1 is owned by owen (pro), shared with ed (editor) and
// vi (viewer); zed is a stranger; b2 is owen's solo brand.
import { test, describe, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, setLogLevel } from "firebase/firestore";
import { ref, set, get, remove } from "firebase/database";

const DAY = 86400000;
let env;
before(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: "demo-papan-rules",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
    database: { rules: readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8"), host: "127.0.0.1", port: 9000 },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const acc = (uid, extra = {}) => ({ uid, plan: "pro", status: "active", brandLimit: 3, subscriptionExpiresAt: Date.now() + 30 * DAY, ...extra });
    await setDoc(doc(db, "accounts/owen"), acc("owen"));
    await setDoc(doc(db, "accounts/zed"), acc("zed"));
    await setDoc(doc(db, "brands/b1"), { id: "b1", ownerId: "owen", name: "Kopi", createdAt: 1, archived: false, ownerName: "Owen", memberIds: ["ed", "vi"], members: { ed: { role: "editor", name: "Ed" }, vi: { role: "viewer", name: "Vi" } } });
    await setDoc(doc(db, "brands/b2"), { id: "b2", ownerId: "owen", name: "Solo", createdAt: 1, archived: false });
    await setDoc(doc(db, "brands/b1/boards/k1"), { ownerId: "owen", brandId: "b1", name: "Rapat" });
    await setDoc(doc(db, "brands/b1/boards/k1/objects/o1"), { ownerId: "owen", brandId: "b1", boardId: "k1", type: "sticky", text: "Ide" });
    await set(ref(ctx.database(), "teams/b1"), { owen: "owner", ed: "editor", vi: "viewer" });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const live = (uid) => env.authenticatedContext(uid).database();
const sticky = (extra = {}) => ({ ownerId: "owen", brandId: "b1", boardId: "k1", type: "sticky", text: "Baru", ...extra });

describe("Papan boards in Firestore", () => {
  test("the owner and both members read boards and what's on them; a stranger reads nothing", async () => {
    for (const uid of ["owen", "ed", "vi"]) {
      await assertSucceeds(getDocs(collection(as(uid), "brands/b1/boards")));
      await assertSucceeds(getDocs(collection(as(uid), "brands/b1/boards/k1/objects")));
    }
    await assertFails(getDocs(collection(as("zed"), "brands/b1/boards")));
    await assertFails(getDoc(doc(as("zed"), "brands/b1/boards/k1/objects/o1")));
  });
  test("owner and editor add, change and remove things on a board, stamped with the owner", async () => {
    await assertSucceeds(setDoc(doc(as("owen"), "brands/b1/boards/k1/objects/o2"), sticky()));
    await assertSucceeds(setDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o3"), sticky()));
    await assertSucceeds(updateDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o1"), { text: "Diubah Ed", x: 10 }));
    await assertSucceeds(deleteDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o3")));
    await assertSucceeds(setDoc(doc(as("ed"), "brands/b1/boards/k1/comments/c1"), { ownerId: "owen", brandId: "b1", boardId: "k1", text: "Setuju" }));
    await assertSucceeds(setDoc(doc(as("ed"), "brands/b1/boards/k2"), { ownerId: "owen", brandId: "b1", name: "Papan Ed" }));
  });
  test("a viewer and a stranger change nothing", async () => {
    await assertFails(setDoc(doc(as("vi"), "brands/b1/boards/k1/objects/o9"), sticky()));
    await assertFails(updateDoc(doc(as("vi"), "brands/b1/boards/k1/objects/o1"), { text: "x" }));
    await assertFails(deleteDoc(doc(as("vi"), "brands/b1/boards/k1/objects/o1")));
    await assertFails(setDoc(doc(as("zed"), "brands/b1/boards/k1/objects/o9"), sticky({ ownerId: "zed" })));
    await assertFails(deleteDoc(doc(as("zed"), "brands/b1/boards/k1")));
  });
  test("ownership, brand and board stamps can't be bent", async () => {
    await assertFails(setDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o9"), sticky({ ownerId: "ed" })), "a member's doc carries the owner");
    await assertFails(setDoc(doc(as("owen"), "brands/b1/boards/k1/objects/o9"), sticky({ boardId: "k2" })), "wrong board");
    await assertFails(setDoc(doc(as("owen"), "brands/b1/boards/k1/objects/o9"), sticky({ brandId: "b2" })), "wrong brand");
    await assertFails(updateDoc(doc(as("owen"), "brands/b1/boards/k1/objects/o1"), { ownerId: "zed" }), "owner can't hand it away");
    await assertFails(setDoc(doc(as("owen"), "brands/b1/boards/k1/secrets/x"), { ownerId: "owen", brandId: "b1", boardId: "k1" }), "unknown subcollection");
  });
  test("an editor can't write on the owner's solo brand", async () => {
    await assertFails(setDoc(doc(as("ed"), "brands/b2/boards/k9"), { ownerId: "owen", brandId: "b2", name: "x" }));
    await assertSucceeds(setDoc(doc(as("owen"), "brands/b2/boards/k9"), { ownerId: "owen", brandId: "b2", name: "Solo board" }));
  });
  test("an editor paused beyond the owner's seats only reads", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "brands/b1"), { members: { ed: { role: "editor", name: "Ed", seatPaused: true } } }, { merge: true }));
    await assertFails(setDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o9"), sticky()));
    await assertFails(updateDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o1"), { text: "x" }));
    await assertFails(deleteDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o1")));
    await assertSucceeds(getDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o1")));
  });
  test("nobody writes once the owner's plan has lapsed", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "accounts/owen"), { uid: "owen", plan: "pro", status: "expired", brandLimit: 3 }));
    await assertFails(setDoc(doc(as("owen"), "brands/b1/boards/k1/objects/o9"), sticky()));
    await assertFails(setDoc(doc(as("ed"), "brands/b1/boards/k1/objects/o9"), sticky()));
    await assertSucceeds(getDoc(doc(as("vi"), "brands/b1/boards/k1/objects/o1")), "reading still works");
  });
});

describe("Papan live cursors in the Realtime Database", () => {
  test("team members see the board's cursors; a stranger doesn't", async () => {
    await assertSucceeds(get(ref(live("vi"), "papanLive/b1/k1/peers")));
    await assertFails(get(ref(live("zed"), "papanLive/b1/k1/peers")));
  });
  test("everyone writes only their own cursor, signed with their uid", async () => {
    await assertSucceeds(set(ref(live("ed"), "papanLive/b1/k1/peers/ed"), { by: "ed", p: { cur: { x: 1, y: 2 } }, at: 1 }));
    await assertFails(set(ref(live("ed"), "papanLive/b1/k1/peers/vi"), { by: "ed", p: { cur: { x: 1, y: 2 } }, at: 1 }));
    await assertFails(set(ref(live("ed"), "papanLive/b1/k1/peers/ed"), { by: "vi", p: { x: 1 }, at: 1 }), "can't pose as someone else");
    await assertFails(set(ref(live("zed"), "papanLive/b1/k1/peers/zed"), { by: "zed", p: { x: 1 }, at: 1 }));
    await assertSucceeds(remove(ref(live("ed"), "papanLive/b1/k1/peers/ed")));
  });
  test("moments (\"look at my screen\") come from a member, under their own name", async () => {
    await assertSucceeds(set(ref(live("ed"), "papanLive/b1/k1/events/e1"), { topic: "summon", by: "ed", at: 1 }));
    await assertFails(set(ref(live("ed"), "papanLive/b1/k1/events/e2"), { topic: "summon", by: "vi", at: 1 }));
    await assertFails(set(ref(live("zed"), "papanLive/b1/k1/events/e3"), { topic: "summon", by: "zed", at: 1 }));
  });
});

// Guests on a board's guest link (api/papan.js): a custom token whose papan
// claim names the brand, the board and the link's secret.
describe("Papan guests on a board's link", () => {
  const T = "s".repeat(24);
  const guest = (uid = "pg-1", claim = {}) => env.authenticatedContext(uid, { papan: { b: "b1", k: "k1", t: T, r: "edit", ...claim } });
  const gfs = (uid, claim) => guest(uid, claim).firestore();
  const glive = (uid, claim) => guest(uid, claim).database();
  const setShare = (share) => env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), "brands/b1/boards/k1"), { share });
    await set(ref(ctx.database(), "papanShare/b1/k1"), { ...share, owner: "owen" });
  });
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "brands/b1/boards/k2"), { ownerId: "owen", brandId: "b1", name: "Lain" });
      await setDoc(doc(db, "brands/b1/boards/k1/objects/mine"), { ownerId: "owen", brandId: "b1", boardId: "k1", type: "pen", createdBy: "pg-1" });
      await setDoc(doc(db, "brands/b1/boards/k1/versions/v1"), { ownerId: "owen", brandId: "b1", boardId: "k1", name: "Versi" });
      await setDoc(doc(db, "brands/b1/boards/k1/guests/pg-1"), { ownerId: "owen", brandId: "b1", boardId: "k1", name: "Sari" });
    });
    await setShare({ on: true, role: "edit", t: T });
  });
  const gsticky = (extra = {}) => sticky({ createdBy: "pg-1", ...extra });

  test("a guest reads this board, what's on it and the guest names, nothing else", async () => {
    await assertSucceeds(getDoc(doc(gfs(), "brands/b1/boards/k1")));
    await assertSucceeds(getDocs(collection(gfs(), "brands/b1/boards/k1/objects")));
    await assertSucceeds(getDocs(collection(gfs(), "brands/b1/boards/k1/comments")));
    await assertSucceeds(getDoc(doc(gfs(), "brands/b1/boards/k1/guests/pg-1")));
    await assertFails(getDoc(doc(gfs(), "brands/b1/boards/k1/versions/v1")), "no version history");
    await assertFails(getDoc(doc(gfs(), "brands/b1/boards/k2")), "another board");
    await assertFails(getDocs(collection(gfs(), "brands/b1/boards")), "the board list");
    await assertFails(getDoc(doc(gfs(), "brands/b1")), "the brand itself");
  });
  test("a guest adds and moves things, stamped with the owner, signed as themselves", async () => {
    await assertSucceeds(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g1"), gsticky()));
    await assertSucceeds(updateDoc(doc(gfs(), "brands/b1/boards/k1/objects/o1"), { x: 40, text: "Dipindah tamu" }), "someone else's sticky");
    await assertSucceeds(setDoc(doc(gfs(), "brands/b1/boards/k1/comments/c1"), { ownerId: "owen", brandId: "b1", boardId: "k1", by: "pg-1", text: "Bagus" }));
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g2"), gsticky({ createdBy: "ed" })), "posing as someone else");
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g3"), gsticky({ ownerId: "pg-1" })), "owning it");
    await assertFails(updateDoc(doc(gfs(), "brands/b1/boards/k1/objects/mine"), { createdBy: "ed" }), "changing who made it");
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/versions/v2"), { ownerId: "owen", brandId: "b1", boardId: "k1", name: "x" }), "versions");
    await assertFails(updateDoc(doc(gfs(), "brands/b1/boards/k1"), { name: "Diganti tamu" }), "the board itself");
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k2/objects/g4"), gsticky({ boardId: "k2" })), "another board");
  });
  test("a guest erases only what they made", async () => {
    await assertSucceeds(deleteDoc(doc(gfs(), "brands/b1/boards/k1/objects/mine")));
    await assertFails(deleteDoc(doc(gfs(), "brands/b1/boards/k1/objects/o1")));
    await assertFails(deleteDoc(doc(gfs(), "brands/b1/boards/k1")));
  });
  test("on a view-only link a guest reads but changes nothing", async () => {
    await setShare({ on: true, role: "view", t: T });
    await assertSucceeds(getDocs(collection(gfs(), "brands/b1/boards/k1/objects")));
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g1"), gsticky()));
    await assertFails(deleteDoc(doc(gfs(), "brands/b1/boards/k1/objects/mine")));
  });
  test("a link switched off or replaced shuts old guests out at once", async () => {
    await setShare({ on: false, role: "edit", t: T });
    await assertFails(getDoc(doc(gfs(), "brands/b1/boards/k1")));
    await setShare({ on: true, role: "edit", t: "n".repeat(24) });
    await assertFails(getDocs(collection(gfs(), "brands/b1/boards/k1/objects")));
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g1"), gsticky()));
    await assertSucceeds(getDoc(doc(gfs("pg-2", { t: "n".repeat(24) }), "brands/b1/boards/k1")), "the new link works");
  });
  test("guests write nothing once the owner's plan has lapsed", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "accounts/owen"), { uid: "owen", plan: "pro", status: "expired", brandLimit: 3 }));
    await assertFails(setDoc(doc(gfs(), "brands/b1/boards/k1/objects/g1"), gsticky()));
  });
  test("guests share the board's live cursors; old links and other boards don't", async () => {
    await assertSucceeds(get(ref(glive(), "papanLive/b1/k1/peers")));
    await assertSucceeds(set(ref(glive(), "papanLive/b1/k1/peers/pg-1"), { by: "pg-1", p: { cur: { x: 1, y: 2 } }, at: 1 }));
    await assertSucceeds(set(ref(glive(), "papanLive/b1/k1/events/e1"), { topic: "summon", by: "pg-1", at: 1 }));
    await assertFails(set(ref(glive(), "papanLive/b1/k1/peers/ed"), { by: "pg-1", p: {}, at: 1 }), "someone else's cursor");
    await assertFails(get(ref(glive("pg-1", { k: "k2" }), "papanLive/b1/k2/peers")), "a board the link isn't for");
    await assertFails(get(ref(glive(), "papanShare/b1/k1")), "the link secret");
    await setShare({ on: true, role: "edit", t: "n".repeat(24) });
    await assertFails(get(ref(glive(), "papanLive/b1/k1/peers")), "a replaced link");
  });
  test("the owner of a solo brand sees their guests' cursors", async () => {
    await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "papanShare/b2/k9"), { on: true, role: "edit", t: T, owner: "owen" }));
    await assertSucceeds(get(ref(live("owen"), "papanLive/b2/k9/peers")));
    await assertSucceeds(set(ref(live("owen"), "papanLive/b2/k9/peers/owen"), { by: "owen", p: {}, at: 1 }));
    await assertFails(get(ref(live("zed"), "papanLive/b2/k9/peers")));
  });
});
