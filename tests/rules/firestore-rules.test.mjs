// firestore.rules against the LOCAL Firestore emulator — never a real
// project: `npm run test:rules` runs
//   firebase emulators:exec --only firestore --project demo-brandlab …
// and a "demo-" project id can't reach any Firebase project at all. The
// emulator needs Java. Not part of `npm test` (tests/*.test.mjs only).
//
// Covers: owner vs stranger on brands/content/assets/sales (month docs),
// the plan brand limit (brandCounts: server-created only, every inactive →
// active move limited), account/billing fields, the asset size cap, and that
// what the CURRENT production app writes is still accepted (rules deploy
// first, app second).
import { test, describe, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, query, where, getDocs,
  arrayUnion, arrayRemove, Timestamp, setLogLevel, deleteField,
} from "firebase/firestore";

const ADMIN = "iSwfTtIQm6VkYoHFbI6wl7BzBF53";
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
const brand = (id, ownerId, extra = {}) => ({ id, ownerId, name: id, createdAt: 1, archived: false, ...extra });
const dataUrl = (total = 200) => {
  const head = "data:image/png;base64,";
  return head + "A".repeat(total - head.length);
};
const asset = (ownerId, brandId, extra = {}) => ({ ownerId, brandId, kind: "logo", dataUrl: dataUrl(), createdAt: 1, ...extra });
const entry = (id, extra = {}) => ({ id, productId: "p1", qty: 1, amount: 10000, date: "2026-10-01", repeat: false, referral: false, note: "", eventId: null, at: 1, ...extra });
const month = (ownerId, brandId, m, entries = [entry("s1")]) => ({ ownerId, brandId, month: m, entries });
const counterNow = (count, op) => ({ count, op, at: serverTimestamp() });

// alice (pro, 3 brands) owns brand a1; bob (pro) owns nothing.
async function seedBasics({ alice = {}, counter = null, brands = [brand("a1", "alice")] } = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, "accounts/alice"), account("alice", alice));
    await setDoc(doc(db, "accounts/bob"), account("bob"));
    for (const b of brands) await setDoc(doc(db, `brands/${b.id}`), b);
    if (counter) await setDoc(doc(db, "brandCounts/alice"), { ...counter, at: Timestamp.fromMillis(1) });
  });
}

describe("owner vs stranger", () => {
  test("brands: only the owner reads or writes", async () => {
    await seedBasics();
    await assertSucceeds(getDoc(doc(as("alice"), "brands/a1")));
    await assertFails(getDoc(doc(as("bob"), "brands/a1")));
    await assertFails(updateDoc(doc(as("bob"), "brands/a1"), { name: "mine now" }));
    await assertFails(setDoc(doc(as("bob"), "brands/a1"), brand("a1", "bob")));
    await assertFails(updateDoc(doc(as("alice"), "brands/a1"), { ownerId: "bob" }), "ownerId can't be handed over");
    await assertSucceeds(updateDoc(doc(as("alice"), "brands/a1"), { tagline: "pagi" }));
  });

  test("content: only the owner reads or writes", async () => {
    await seedBasics();
    await assertSucceeds(setDoc(doc(as("alice"), "content/c1"), { id: "c1", ownerId: "alice", brandId: "a1", title: "x" }));
    await assertFails(getDoc(doc(as("bob"), "content/c1")));
    await assertFails(setDoc(doc(as("bob"), "content/c2"), { id: "c2", ownerId: "alice", brandId: "a1" }));
    await assertFails(deleteDoc(doc(as("bob"), "content/c1")));
  });

  test("assets: the owner writes them with the brand, reads and deletes them; a stranger can't", async () => {
    await seedBasics();
    const alice = as("alice");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a1/assets/ax1"), asset("alice", "a1"));
    batch.update(doc(alice, "brands/a1"), { brandGuidelines: { logo: { dataUrl: "asset:ax1" } } });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDocs(query(collection(alice, "brands/a1/assets"), where("ownerId", "==", "alice"))));
    const bob = as("bob");
    await assertFails(getDoc(doc(bob, "brands/a1/assets/ax1")));
    await assertFails(setDoc(doc(bob, "brands/a1/assets/bx"), asset("bob", "a1")), "not under someone else's brand");
    await assertFails(setDoc(doc(bob, "brands/a1/assets/ax2"), asset("alice", "a1")));
    await assertFails(deleteDoc(doc(bob, "brands/a1/assets/ax1")));
    await assertFails(setDoc(doc(alice, "brands/a1/assets/ax3"), asset("alice", "other-brand")), "brandId must be the parent");
    await assertSucceeds(deleteDoc(doc(alice, "brands/a1/assets/ax1")));
  });

  test("sales: the owner keeps a doc per month; a stranger can't", async () => {
    await seedBasics();
    const alice = as("alice");
    const ref = doc(alice, "brands/a1/sales/2026-10");
    await assertSucceeds(setDoc(ref, { ownerId: "alice", brandId: "a1", month: "2026-10", entries: arrayUnion(entry("s1")) }, { merge: true }));
    await assertSucceeds(setDoc(ref, { ownerId: "alice", brandId: "a1", month: "2026-10", entries: arrayUnion(entry("s2", { note: null, source: { campaignId: "c", contentId: null } })) }, { merge: true }), "an old entry moved as it is");
    await assertSucceeds(setDoc(ref, { ownerId: "alice", brandId: "a1", month: "2026-10", entries: arrayRemove(entry("s1")) }, { merge: true }));
    await assertSucceeds(setDoc(doc(alice, "brands/a1/sales/undated"), month("alice", "a1", "undated")));
    await assertFails(setDoc(doc(alice, "brands/a1/sales/s3"), month("alice", "a1", "s3")), "doc id is a month");
    await assertFails(setDoc(doc(alice, "brands/a1/sales/2026-11"), month("alice", "a1", "2026-12")), "month field = doc id");
    await assertFails(setDoc(doc(alice, "brands/a1/sales/2026-11"), { ...month("alice", "a1", "2026-11"), extra: 1 }));
    const bob = as("bob");
    await assertFails(getDoc(doc(bob, "brands/a1/sales/2026-10")));
    await assertFails(setDoc(doc(bob, "brands/a1/sales/2026-09"), month("bob", "a1", "2026-09")));
    await assertFails(deleteDoc(doc(bob, "brands/a1/sales/2026-10")));
    await assertSucceeds(deleteDoc(ref));
  });

  test("an ended trial can't write files or sales", async () => {
    await seedBasics({ alice: { plan: "trial", trialEndsAt: Date.now() - DAY, subscriptionExpiresAt: null } });
    await assertFails(setDoc(doc(as("alice"), "brands/a1/assets/ax"), asset("alice", "a1")));
    await assertFails(setDoc(doc(as("alice"), "brands/a1/sales/2026-10"), month("alice", "a1", "2026-10")));
    await assertSucceeds(getDoc(doc(as("alice"), "brands/a1")), "still reads its data");
  });
});

describe("plan brand limit (brandCounts)", () => {
  test("no counter yet: brand writes are accepted exactly as today", async () => {
    await seedBasics({ alice: { brandLimit: 1 } });
    await assertSucceeds(setDoc(doc(as("alice"), "brands/a2"), brand("a2", "alice")), "phase 1: not limited until the account has a counter");
  });

  test("with a counter, a new active brand needs the counter move in the same batch", async () => {
    await seedBasics({ counter: { count: 1, op: "a1" } });
    await assertFails(setDoc(doc(as("alice"), "brands/a2"), brand("a2", "alice")));
    const alice = as("alice");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertSucceeds(batch.commit());
  });

  test("a new brand can't take the count past the plan's limit", async () => {
    await seedBasics({ alice: { brandLimit: 1 }, counter: { count: 1, op: "a1" } });
    const alice = as("alice");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertFails(batch.commit());
  });

  test("permanent and monthly slots raise the limit", async () => {
    await seedBasics({ alice: { brandLimit: 1, extraBrands: 1, brandSlotsUntil: [Date.now() + 10 * DAY] }, counter: { count: 1, op: "a1" } });
    const alice = as("alice");
    let batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertSucceeds(batch.commit());
    batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a3"), brand("a3", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(3, "a3"));
    await assertSucceeds(batch.commit());
    batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a4"), brand("a4", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(4, "a4"));
    await assertFails(batch.commit(), "1 + 1 + 1 = 3");
  });

  test("Wepeka's own account isn't limited", async () => {
    await seed(async (db) => {
      await setDoc(doc(db, `accounts/${ADMIN}`), account(ADMIN, { brandLimit: 1 }));
      await setDoc(doc(db, "brands/w1"), brand("w1", ADMIN));
      await setDoc(doc(db, `brandCounts/${ADMIN}`), { count: 1, op: "w1", at: Timestamp.fromMillis(1) });
    });
    const admin = as(ADMIN);
    const batch = writeBatch(admin);
    batch.set(doc(admin, "brands/w2"), brand("w2", ADMIN));
    batch.set(doc(admin, `brandCounts/${ADMIN}`), counterNow(2, "w2"));
    await assertSucceeds(batch.commit());
  });

  test("the counter only moves by one, for the brand it names", async () => {
    await seedBasics({ counter: { count: 1, op: "a1" } });
    const alice = as("alice");
    let batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(3, "a2"));
    await assertFails(batch.commit(), "+2 for one brand");
    batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a1"));
    await assertFails(batch.commit(), "names another brand");
    await assertFails(setDoc(doc(alice, "brandCounts/alice"), counterNow(0, "a1")), "down without any brand change");
    await assertFails(setDoc(doc(alice, "brandCounts/alice"), counterNow(0, "a1/sales/s1")), "op must be a plain id");
    await assertFails(setDoc(doc(alice, "brandCounts/alice"), { count: 0, op: "a1", at: Timestamp.fromMillis(5) }), "at must be the server time");
    await assertFails(deleteDoc(doc(alice, "brandCounts/alice")));
    await assertFails(setDoc(doc(as("bob"), "brandCounts/alice"), counterNow(0, "a1")));
    await assertFails(getDoc(doc(as("bob"), "brandCounts/alice")));
  });

  test("archiving and trashing move the count down; unarchiving and restoring are limited too", async () => {
    await seedBasics({ alice: { brandLimit: 1 }, counter: { count: 1, op: "a1" }, brands: [brand("a1", "alice"), brand("a2", "alice", { archived: true }), brand("a3", "alice", { deletedAt: 5 })] });
    const alice = as("alice");
    await assertFails(updateDoc(doc(alice, "brands/a1"), { deletedAt: Date.now() }), "trash without the counter");
    await assertSucceeds(updateDoc(doc(alice, "brands/a1"), { tagline: "an ordinary edit needs nothing" }));
    let batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a2"), { archived: false });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertFails(batch.commit(), "unarchiving past the limit (create archived → unarchive can't get around it)");
    batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a3"), { deletedAt: null });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a3"));
    await assertFails(batch.commit(), "restoring from Trash past the limit");
    batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a1"), { deletedAt: Date.now() });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(0, "a1"));
    await assertSucceeds(batch.commit());
    batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a2"), { archived: false });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(1, "a2"));
    await assertSucceeds(batch.commit(), "within the limit again");
    await assertSucceeds(deleteDoc(doc(alice, "brands/a1")), "purging a trashed brand: no counter move");
  });

  test("a brand created archived doesn't need the counter", async () => {
    await seedBasics({ alice: { brandLimit: 1 }, counter: { count: 1, op: "a1" } });
    await assertSucceeds(setDoc(doc(as("alice"), "brands/a2"), brand("a2", "alice", { archived: true })));
  });

  test("only the server creates the counter", async () => {
    await seedBasics();
    const alice = as("alice");
    const batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertFails(batch.commit(), "a client can't start (or pick) its own count");
    await assertSucceeds(setDoc(doc(alice, "brands/a2"), brand("a2", "alice")), "without a counter: accepted as before");
  });

  test("a count of 0 can't go below 0 — the server recount is the way out", async () => {
    await seedBasics({ counter: { count: 0, op: "x" } });
    const alice = as("alice");
    let batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a1"), { archived: true });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(0, "a1"));
    await assertFails(batch.commit());
    await seed((db) => setDoc(doc(db, "brandCounts/alice"), { count: 1, op: "recount", at: Timestamp.fromMillis(2) }));
    batch = writeBatch(alice);
    batch.update(doc(alice, "brands/a1"), { archived: true });
    batch.set(doc(alice, "brandCounts/alice"), counterNow(0, "a1"));
    await assertSucceeds(batch.commit(), "after the recount");
  });
});

describe("activity fields hold only what the app writes (round 2, fix 4)", () => {
  test("deletedAt: null/absent or a timestamp; archived: a boolean", async () => {
    await seedBasics();
    const alice = as("alice");
    for (const bad of [{ deletedAt: 0 }, { deletedAt: "" }, { deletedAt: false }, { deletedAt: -5 }, { archived: "yes" }, { archived: 1 }]) {
      await assertFails(setDoc(doc(alice, "brands/bad"), brand("bad", "alice", bad)), `create ${JSON.stringify(bad)}`);
      await assertFails(updateDoc(doc(alice, "brands/a1"), bad), `update ${JSON.stringify(bad)}`);
    }
    await assertSucceeds(setDoc(doc(alice, "brands/ok"), brand("ok", "alice", { archived: false, deletedAt: null })));
    await assertSucceeds(updateDoc(doc(alice, "brands/ok"), { deletedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(alice, "brands/ok"), { deletedAt: null, archived: true }));
  });

  test("an old doc with an odd value can still be edited otherwise", async () => {
    await seedBasics({ brands: [brand("a1", "alice", { archived: "legacy" })] });
    await assertSucceeds(updateDoc(doc(as("alice"), "brands/a1"), { tagline: "still editable" }));
  });
});

describe("server fields stay the server's (round 2, fixes 5/8)", () => {
  test("lastRecountAt (recount throttle) is kept by client count moves, never set by them", async () => {
    await seedBasics({ counter: { count: 1, op: "a1" } });
    await seed((db) => updateDoc(doc(db, "brandCounts/alice"), { lastRecountAt: Timestamp.fromMillis(3) }));
    const alice = as("alice");
    let batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"));
    await assertFails(batch.commit(), "a plain set would drop lastRecountAt");
    batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), { ...counterNow(2, "a2"), lastRecountAt: serverTimestamp() }, { merge: true });
    await assertFails(batch.commit(), "can't stamp it itself");
    batch = writeBatch(alice);
    batch.set(doc(alice, "brands/a2"), brand("a2", "alice"));
    batch.set(doc(alice, "brandCounts/alice"), counterNow(2, "a2"), { merge: true });
    await assertSucceeds(batch.commit(), "what js/store.js countOp sends");
  });

  test("the sweep's unusedSince mark: a timestamp, set or cleared by the owner", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "brands/a1/assets/ax"), asset("alice", "a1")));
    await assertSucceeds(updateDoc(doc(alice, "brands/a1/assets/ax"), { unusedSince: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(alice, "brands/a1/assets/ax"), { unusedSince: deleteField() }));
    await assertFails(updateDoc(doc(alice, "brands/a1/assets/ax"), { unusedSince: "soon" }));
    await assertFails(updateDoc(doc(as("bob"), "brands/a1/assets/ax"), { unusedSince: serverTimestamp() }));
  });
});

describe("account and billing fields are not client-writable", () => {
  test("only displayName/username change on accounts/{uid}", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(updateDoc(doc(alice, "accounts/alice"), { displayName: "Alice" }));
    for (const patch of [
      { plan: "founder" }, { status: "active", plan: "studio" }, { brandLimit: 99 }, { extraBrands: 5 },
      { brandSlotsUntil: [Date.now() + 365 * DAY] }, { bookStyles: ["pop", "scrap", "photo"] },
      { subscriptionExpiresAt: null }, { aiCredits: 9999 }, { trialEndsAt: Date.now() + 365 * DAY },
    ]) {
      await assertFails(updateDoc(doc(alice, "accounts/alice"), patch), JSON.stringify(patch));
    }
    await assertFails(setDoc(doc(as("carol"), "accounts/carol"), account("carol")), "accounts are only created server-side");
    await assertFails(deleteDoc(doc(alice, "accounts/alice")));
    await assertFails(getDoc(doc(as("bob"), "accounts/alice")));
  });

  test("AI quota, payments and the customer counter stay closed", async () => {
    await seedBasics();
    await seed(async (db) => {
      await setDoc(doc(db, "aiUsage/alice"), { used: 1 });
      await setDoc(doc(db, "meta/accountCounter"), { next: 42 });
      await setDoc(doc(db, "meta/founderSlots"), { founderSlotsSold: 3 });
    });
    const alice = as("alice");
    await assertSucceeds(getDoc(doc(alice, "aiUsage/alice")));
    await assertFails(setDoc(doc(alice, "aiUsage/alice"), { used: 0 }));
    await assertFails(getDoc(doc(alice, "meta/accountCounter")), "no client reads it; it leaked the customer count");
    await assertFails(getDocs(collection(alice, "payments")));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "meta/founderSlots")), "still public for the pricing page");
  });
});

describe("asset size and shape", () => {
  test("a file up to the cap is accepted; one character more is refused", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "brands/a1/assets/big"), asset("alice", "a1", { dataUrl: dataUrl(1_000_000) })));
    await assertFails(setDoc(doc(alice, "brands/a1/assets/big2"), asset("alice", "a1", { dataUrl: dataUrl(1_000_001) })));
  });

  test("only data URLs, known kinds and the known fields", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertFails(setDoc(doc(alice, "brands/a1/assets/x1"), asset("alice", "a1", { dataUrl: "https://example.com/logo.png" })));
    await assertFails(setDoc(doc(alice, "brands/a1/assets/x2"), asset("alice", "a1", { kind: "video" })));
    await assertFails(setDoc(doc(alice, "brands/a1/assets/x5"), asset("alice", "a1", { kind: "book-photo" })), "the book photo stays inline in this release");
    await assertFails(setDoc(doc(alice, "brands/a1/assets/x3"), asset("alice", "a1", { extra: true })));
    await assertSucceeds(setDoc(doc(alice, "brands/a1/assets/x4"), asset("alice", "a1", { kind: "font", name: "My Font", dataUrl: "data:font/woff2;base64,AAAA" })));
  });
});

describe("what the current production app writes is still accepted", () => {
  test("whole-doc brand create, update and purge (no counter)", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "brands/a2"), brand("a2", "alice", { brandGuidelines: { logo: { dataUrl: dataUrl(5000) } } })));
    await assertSucceeds(setDoc(doc(alice, "brands/a2"), brand("a2", "alice", { deletedAt: Date.now() })));
    await assertSucceeds(setDoc(doc(alice, "brands/a2"), brand("a2", "alice", { deletedAt: null })));
    await assertSucceeds(setDoc(doc(alice, "brands/a2"), brand("a2", "alice", { archived: true })));
    await assertSucceeds(deleteDoc(doc(alice, "brands/a2")));
  });

  test("a premium Brand Book style picked for preview is still saved (the PDF is what's gated)", async () => {
    await seedBasics();
    await assertSucceeds(updateDoc(doc(as("alice"), "brands/a1"), { brandGuidelines: { bookStyle: "pop" } }));
  });

  test("chat threads: whole-doc writes as today, and the new merge/arrayUnion writes", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "brainstorms/t1"), { id: "t1", ownerId: "alice", brandId: "a1", messages: [] }));
    await assertSucceeds(setDoc(doc(alice, "brainstorms/companion-a1"), { id: "companion-a1", ownerId: "alice", brandId: "a1", mode: "companion" }, { merge: true }));
    await assertSucceeds(setDoc(doc(alice, "brainstorms/companion-a1"), { id: "companion-a1", ownerId: "alice", brandId: "a1", messages: arrayUnion({ id: "m1", text: "hai" }), updatedAt: 1 }, { merge: true }));
    await assertSucceeds(getDocs(query(collection(alice, "brainstorms"), where("ownerId", "==", "alice"), where("brandId", "==", "a1"))));
    await assertFails(setDoc(doc(as("bob"), "brainstorms/companion-a1"), { messages: arrayUnion({ id: "x" }) }, { merge: true }));
  });

  test("settings: whole-doc and mergeFields writes", async () => {
    await seedBasics();
    const alice = as("alice");
    await assertSucceeds(setDoc(doc(alice, "settings/alice"), { formulas: { engagementRate: "likes / reach * 100" } }, { mergeFields: ["formulas"] }));
    await assertFails(setDoc(doc(as("bob"), "settings/alice"), { formulas: {} }, { mergeFields: ["formulas"] }));
  });
});
