// Kerja Tim rules (firestore.rules "Brand teams") against the LOCAL
// Firestore emulator — `npm run test:rules` (project demo-brandlab, never a
// real one). One brand, b1, owned by owen (pro), shared with ed (editor) and
// vi (viewer); zed is a stranger with a plan of his own.
import { test, describe, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, setLogLevel, writeBatch } from "firebase/firestore";

const DAY = 86400000;
let env;

before(async () => {
  setLogLevel("error");
  env = await initializeTestEnvironment({
    projectId: "demo-brandlab",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const as = (uid) => env.authenticatedContext(uid).firestore();
const account = (uid, extra = {}) => ({ uid, plan: "pro", status: "active", brandLimit: 3, subscriptionExpiresAt: Date.now() + 30 * DAY, ...extra });
const members = {
  ed: { role: "editor", name: "Ed", email: "ed@test.local", addedAt: 1 },
  vi: { role: "viewer", name: "Vi", email: "vi@test.local", addedAt: 1 },
};
const sharedBrand = (extra = {}) => ({ id: "b1", ownerId: "owen", name: "Kopi", createdAt: 1, archived: false, members, memberIds: ["ed", "vi"], ownerName: "Owen", ...extra });
const content = (id, extra = {}) => ({ id, ownerId: "owen", brandId: "b1", title: id, ...extra });
const dataUrl = "data:image/png;base64,AAAA";

async function seedTeam({ owner = {}, brand = {} } = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, "accounts/owen"), account("owen", owner));
    await setDoc(doc(db, "accounts/zed"), account("zed"));
    await setDoc(doc(db, "brands/b1"), sharedBrand(brand));
    await setDoc(doc(db, "brands/b2"), { id: "b2", ownerId: "owen", name: "Solo", createdAt: 1, archived: false });
    for (const uid of ["ed", "vi"]) {
      await setDoc(doc(db, `memberships/${uid}`), { ownerIds: ["owen"], brands: { b1: { ownerId: "owen", role: members[uid].role } } });
    }
    await setDoc(doc(db, "content/c1"), content("c1"));
    await setDoc(doc(db, "content/c2"), content("c2", { brandId: "b2" }));
    await setDoc(doc(db, "campaigns/k1"), { id: "k1", ownerId: "owen", brandId: "b1", name: "Launch" });
    await setDoc(doc(db, "series/s1"), { id: "s1", ownerId: "owen", brandId: "b1", name: "Pagi" });
    await setDoc(doc(db, "aiUsage/owen"), { count: 3 });
  });
}
const memberQuery = (db, col, brandId = "b1", ownerId = "owen") =>
  getDocs(query(collection(db, col), where("ownerId", "==", ownerId), where("brandId", "==", brandId)));

describe("the members' query pattern (checked first: the whole design rests on it)", () => {
  test("a member lists a shared brand's docs with ownerId + brandId", async () => {
    await seedTeam();
    for (const uid of ["ed", "vi"]) {
      for (const col of ["content", "campaigns", "series"]) await assertSucceeds(memberQuery(as(uid), col));
    }
    const snap = await memberQuery(as("ed"), "content");
    if (snap.size !== 1 || snap.docs[0].id !== "c1") throw new Error(`expected only c1, got ${snap.docs.map((d) => d.id)}`);
  });
  test("…but not with brandId alone, not for an unshared brand, and never as a stranger", async () => {
    await seedTeam();
    await assertFails(getDocs(query(collection(as("ed"), "content"), where("brandId", "==", "b1"))));
    await assertFails(memberQuery(as("ed"), "content", "b2"));
    await assertFails(memberQuery(as("zed"), "content"));
    await assertFails(getDoc(doc(as("zed"), "content/c1")));
  });
  test("a member finds the brands shared with them", async () => {
    await seedTeam();
    await assertSucceeds(getDocs(query(collection(as("ed"), "brands"), where("memberIds", "array-contains", "ed"))));
    await assertSucceeds(getDoc(doc(as("vi"), "brands/b1")));
    await assertFails(getDoc(doc(as("ed"), "brands/b2")));
    await assertFails(getDoc(doc(as("zed"), "brands/b1")));
  });
});

describe("brand doc", () => {
  test("an editor edits the brand's content fields, nothing that belongs to the owner", async () => {
    await seedTeam();
    const ed = as("ed");
    await assertSucceeds(updateDoc(doc(ed, "brands/b1"), { tagline: "pagi", "brandDNA.mission": "x" }));
    for (const patch of [{ memberIds: ["ed"] }, { members: {} }, { ownerName: "Ed" }, { archived: true }, { deletedAt: Date.now() },
      { instagram: { accessToken: "x" } }, { facebook: {} }, { ownerId: "ed" }, { chatSessions: [] }, { teamSettings: {} }]) {
      await assertFails(updateDoc(doc(ed, "brands/b1"), patch), JSON.stringify(patch));
    }
  });
  test("a viewer and a stranger can't edit it", async () => {
    await seedTeam();
    await assertFails(updateDoc(doc(as("vi"), "brands/b1"), { tagline: "x" }));
    await assertFails(updateDoc(doc(as("zed"), "brands/b1"), { tagline: "x" }));
  });
  test("the owner edits as before but can't touch the team fields (server only)", async () => {
    await seedTeam();
    const owen = as("owen");
    await assertSucceeds(updateDoc(doc(owen, "brands/b1"), { tagline: "pagi" }));
    await assertFails(updateDoc(doc(owen, "brands/b1"), { memberIds: ["ed", "vi", "zed"] }));
    await assertFails(updateDoc(doc(owen, "brands/b1"), { "members.zed": { role: "editor" } }));
    await assertFails(setDoc(doc(owen, "brands/b3"), { id: "b3", ownerId: "owen", name: "x", createdAt: 1, members: {}, memberIds: [] }));
  });
  test("once the owner's plan lapses the editor can't write", async () => {
    await seedTeam({ owner: { subscriptionExpiresAt: Date.now() - DAY } });
    await assertFails(updateDoc(doc(as("ed"), "brands/b1"), { tagline: "x" }));
    await assertSucceeds(getDoc(doc(as("ed"), "brands/b1")), "still readable");
  });
});

describe("content, campaigns, series", () => {
  test("an editor paused beyond the owner's seats reads like a viewer", async () => {
    await seedTeam({ brand: { members: { ...members, ed: { ...members.ed, seatPaused: true } } } });
    const ed = as("ed");
    await assertSucceeds(getDoc(doc(ed, "brands/b1")));
    await assertSucceeds(memberQuery(ed, "content"));
    await assertFails(updateDoc(doc(ed, "content/c1"), { caption: "baru" }));
    await assertFails(setDoc(doc(ed, "content/c9"), content("c9")));
    await assertFails(updateDoc(doc(ed, "brands/b1"), { name: "Kopi Baru" }));
    await assertFails(setDoc(doc(ed, "brainstorms/t9"), { id: "t9", ownerId: "ed", brandId: "b1", messages: [] }));
  });
  test("an editor creates them stamped with the owner, and updates them", async () => {
    await seedTeam();
    const ed = as("ed");
    await assertSucceeds(setDoc(doc(ed, "content/c9"), content("c9")));
    await assertSucceeds(updateDoc(doc(ed, "content/c1"), { caption: "baru" }));
    await assertSucceeds(setDoc(doc(ed, "campaigns/k9"), { id: "k9", ownerId: "owen", brandId: "b1", name: "x" }));
    await assertSucceeds(updateDoc(doc(ed, "campaigns/k1"), { name: "y" }));
    await assertSucceeds(setDoc(doc(ed, "series/s9"), { id: "s9", ownerId: "owen", brandId: "b1", name: "x" }));
    await assertSucceeds(updateDoc(doc(ed, "series/s1"), { "dna.tone": "santai" }));
    await assertSucceeds(updateDoc(doc(ed, "content/c1"), { deletedAt: Date.now() }), "the soft delete is an update");
  });
  test("…but not as themselves, not elsewhere, not moved out, and never deleted for good", async () => {
    await seedTeam();
    const ed = as("ed");
    await assertFails(setDoc(doc(ed, "content/c8"), content("c8", { ownerId: "ed" })), "own ownerId needs an own plan");
    await assertFails(setDoc(doc(ed, "content/c7"), content("c7", { brandId: "b2" })), "unshared brand");
    await assertFails(updateDoc(doc(ed, "content/c2"), { caption: "x" }), "unshared brand");
    await assertFails(updateDoc(doc(ed, "content/c1"), { brandId: "b2" }));
    await assertFails(updateDoc(doc(ed, "content/c1"), { ownerId: "ed" }));
    await assertFails(deleteDoc(doc(ed, "content/c1")));
  });
  test("a viewer reads only; a stranger gets nothing", async () => {
    await seedTeam();
    await assertSucceeds(getDoc(doc(as("vi"), "content/c1")));
    await assertFails(updateDoc(doc(as("vi"), "content/c1"), { caption: "x" }));
    await assertFails(setDoc(doc(as("vi"), "content/c9"), content("c9")));
    await assertFails(setDoc(doc(as("zed"), "content/c9"), content("c9")));
  });
  test("a removed member loses access at once", async () => {
    await seedTeam();
    await seed((db) => updateDoc(doc(db, "brands/b1"), { members: { vi: members.vi }, memberIds: ["vi"] }));
    await assertFails(getDoc(doc(as("ed"), "brands/b1")));
    await assertFails(memberQuery(as("ed"), "content"));
    await assertFails(updateDoc(doc(as("ed"), "content/c1"), { caption: "x" }));
  });
  test("the owner's own paths still work as before", async () => {
    await seedTeam();
    const owen = as("owen");
    await assertSucceeds(getDocs(query(collection(owen, "content"), where("ownerId", "==", "owen"))));
    await assertSucceeds(updateDoc(doc(owen, "content/c1"), { caption: "x" }));
    await assertSucceeds(deleteDoc(doc(owen, "content/c2")));
  });
});

describe("assets and sales under a shared brand", () => {
  test("an editor uploads with the owner's stamp; members read; only the owner deletes", async () => {
    await seedTeam();
    const ed = as("ed");
    await assertSucceeds(setDoc(doc(ed, "brands/b1/assets/a1"), { ownerId: "owen", brandId: "b1", kind: "logo", dataUrl, createdAt: 1 }));
    await assertFails(setDoc(doc(ed, "brands/b1/assets/a2"), { ownerId: "ed", brandId: "b1", kind: "logo", dataUrl, createdAt: 1 }));
    await assertSucceeds(getDoc(doc(as("vi"), "brands/b1/assets/a1")));
    await assertFails(getDoc(doc(as("zed"), "brands/b1/assets/a1")));
    await assertFails(setDoc(doc(as("vi"), "brands/b1/assets/a3"), { ownerId: "owen", brandId: "b1", kind: "logo", dataUrl, createdAt: 1 }));
    await assertFails(deleteDoc(doc(ed, "brands/b1/assets/a1")));
    await assertSucceeds(setDoc(doc(ed, "brands/b1/sales/2026-10"), { ownerId: "owen", brandId: "b1", month: "2026-10", entries: [] }));
    await assertSucceeds(getDocs(collection(as("vi"), "brands/b1/sales")));
    await assertFails(getDocs(collection(as("zed"), "brands/b1/sales")));
  });
});

describe("rule budget", () => {
  test("an editor's Brand Book save (brand + 12 new files in one batch) stays within the get() limits", async () => {
    await seedTeam();
    const ed = as("ed");
    const batch = writeBatch(ed);
    for (let i = 0; i < 12; i++) {
      batch.set(doc(ed, `brands/b1/assets/f${i}`), { ownerId: "owen", brandId: "b1", kind: "moodboard", dataUrl, createdAt: 1 });
    }
    batch.update(doc(ed, "brands/b1"), { "brandGuidelines.moodboard": ["asset:f0"] });
    await assertSucceeds(batch.commit());
  });
});

describe("private to one person", () => {
  test("chat threads: an editor's own, unreadable by the owner; a viewer can't start one", async () => {
    await seedTeam();
    const thread = (ownerId) => ({ id: `t-${ownerId}`, ownerId, brandId: "b1", messages: [] });
    await assertSucceeds(setDoc(doc(as("ed"), "brainstorms/t-ed"), thread("ed")));
    await assertSucceeds(updateDoc(doc(as("ed"), "brainstorms/t-ed"), { title: "ide" }));
    await assertFails(getDoc(doc(as("owen"), "brainstorms/t-ed")));
    await assertFails(setDoc(doc(as("vi"), "brainstorms/t-vi"), thread("vi")));
    await assertFails(setDoc(doc(as("ed"), "brainstorms/t-x"), { ...thread("ed"), brandId: "b2" }));
  });
  test("people/{uid}: only that person, only while on the brand", async () => {
    await seedTeam();
    await assertSucceeds(setDoc(doc(as("ed"), "brands/b1/people/ed"), { uid: "ed", brandId: "b1", chatSessions: [] }));
    await assertFails(getDoc(doc(as("owen"), "brands/b1/people/ed")));
    await assertFails(setDoc(doc(as("ed"), "brands/b1/people/vi"), { uid: "vi", brandId: "b1" }));
    await assertFails(setDoc(doc(as("zed"), "brands/b1/people/zed"), { uid: "zed", brandId: "b1" }));
    await assertFails(setDoc(doc(as("ed"), "brands/b1/people/ed"), { uid: "ed", brandId: "b1", role: "owner" }), "only known keys");
  });
  test("private/: the owner's tokens, never a member's", async () => {
    await seedTeam();
    await assertSucceeds(setDoc(doc(as("owen"), "brands/b1/private/integrations"), { ownerId: "owen", instagram: { accessToken: "t" } }));
    await assertSucceeds(getDoc(doc(as("owen"), "brands/b1/private/integrations")));
    await assertFails(getDoc(doc(as("ed"), "brands/b1/private/integrations")));
    await assertFails(setDoc(doc(as("ed"), "brands/b1/private/integrations"), { ownerId: "owen" }));
  });
});

describe("server-written team docs", () => {
  test("memberships and invites: read own, never written by a client", async () => {
    await seedTeam();
    await seed((db) => setDoc(doc(db, "invites/h1"), { ownerId: "owen", email: "x@test.local", brandIds: ["b1"], role: "editor" }));
    await assertSucceeds(getDoc(doc(as("ed"), "memberships/ed")));
    await assertFails(getDoc(doc(as("ed"), "memberships/vi")));
    await assertFails(setDoc(doc(as("ed"), "memberships/ed"), { ownerIds: ["owen", "zed"] }));
    await assertSucceeds(getDoc(doc(as("owen"), "invites/h1")));
    await assertFails(getDoc(doc(as("ed"), "invites/h1")));
    await assertFails(setDoc(doc(as("owen"), "invites/h2"), { ownerId: "owen" }));
    await assertFails(getDoc(doc(as("owen"), "inviteCodes/h1")));
    await assertFails(getDoc(doc(as("owen"), "codeGuards/h1")));
    await assertFails(setDoc(doc(as("owen"), "codeGuards/h1"), { sends: 0, wrong: 0 }));
    await assertFails(getDoc(doc(as("owen"), "teamMail/2026-10-22")));
    await assertFails(setDoc(doc(as("owen"), "teamMail/2026-10-22"), { total: 0 }));
  });
  test("aiUsage: members read the owner's counter (one pool); strangers don't", async () => {
    await seedTeam();
    await assertSucceeds(getDoc(doc(as("ed"), "aiUsage/owen")));
    await assertSucceeds(getDoc(doc(as("vi"), "aiUsage/owen")));
    await assertFails(getDoc(doc(as("zed"), "aiUsage/owen")));
  });
  test("settings: a member without a plan keeps their own; someone with neither can't", async () => {
    await seedTeam();
    await assertSucceeds(setDoc(doc(as("ed"), "settings/ed"), { experienceMode: "guided" }));
    await assertSucceeds(setDoc(doc(as("zed"), "settings/zed"), { experienceMode: "guided" }));
    await assertFails(setDoc(doc(as("nobody"), "settings/nobody"), { experienceMode: "guided" }));
  });
});
