// The plan's brand limit, as kept by the client (js/store.js "Brand count")
// and repaired by the server (api/brands/recount.js). Its own file: the
// store's count state is per session, and these tests start from none.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { __docs, __writes, __reset, __faults, __refire } from "./stubs/firebase-firestore.js";
import * as store from "../js/store.js";
import { auth } from "../js/firebase.js";
import { recountBrandsFor, isActiveBrand } from "../api/brands/recount.js";

const UID = "uid-count";
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const counter = () => __docs.get(`brandCounts/${UID}`);
const clientCounterWrites = () => __writes.flatMap((w) => w.ops || [w]).filter((o) => o.path === `brandCounts/${UID}`);

// Counting starts on BRAND_COUNT_START (js/store.js); these tests run as
// if that day had come — except the last, which checks the time before it.
store.setBrandCountStart("2026-01-01");

// The server side of POST /api/brands/recount, against the stub's docs.
let recounts = 0;
auth.currentUser = { uid: UID, getIdToken: async () => "test-token" };
globalThis.fetch = async (url, opts) => {
  assert.equal(url, "/api/brands/recount");
  assert.equal(opts.headers.authorization, "Bearer test-token");
  recounts += 1;
  await wait(15);
  const count = [...__docs.entries()].filter(([k, d]) => /^brands\/[^/]+$/.test(k) && d.ownerId === UID && isActiveBrand(d)).length;
  __docs.set(`brandCounts/${UID}`, { count, op: "recount", at: Date.now() });
  return { ok: true, json: async () => ({ count }) };
};
async function withToasts(fn) {
  const getEl = document.getElementById;
  const st = globalThis.setTimeout;
  const err = console.error;
  document.getElementById = () => document.createElement("div");
  globalThis.setTimeout = (cb, ms, ...a) => { const h = st(cb, ms, ...a); h?.unref?.(); return h; };
  console.error = () => {};
  try {
    await fn();
  } finally {
    document.getElementById = getEl;
    globalThis.setTimeout = st;
    console.error = err;
  }
}

describe("brand count (review fixes 4/5)", () => {
  test("the client never creates the counter: the server recounts it, and a create waits for it", async () => {
    __reset();
    __docs.set("brands/b1", { id: "b1", ownerId: UID, name: "Satu", createdAt: 1 });
    __docs.set("brands/b2", { id: "b2", ownerId: UID, name: "Dua", createdAt: 2, archived: true });
    await store.initStore(UID);
    assert.equal(store.brandCountKnown(), false, "not known yet: the recount is still running");
    const b = store.createBrand({ name: "Tiga" }); // right away, before the count is known
    store.updateBrand(b.id, { tagline: "edit behind the pending create" });
    store.archiveBrand("b2", false); // an activity write: held until the count is known
    store.archiveBrand("b2", true);
    // Another tab/device's snapshot lands meanwhile (rebuilt from what the
    // server has): held edits and the pending brand stay on screen.
    __refire((ref) => ref.collRef?.path === "brands");
    await wait(1);
    assert.ok(store.listBrands().some((x) => x.id === b.id), "the pending create stays in the list");
    assert.equal(store.getBrand(b.id).tagline, "edit behind the pending create");
    await wait(80);
    assert.equal(__docs.get(`brands/${b.id}`).tagline, "edit behind the pending create", "written after its create, not refused as missing");
    assert.equal(__docs.get("brands/b2").archived, true, "held activity writes went out in order");
    assert.equal(recounts, 1);
    assert.equal(store.brandCountKnown(), true);
    const create = __writes.find((w) => (w.ops || []).some((o) => o.path === `brands/${b.id}`));
    const move = create.ops.find((o) => o.path === `brandCounts/${UID}`);
    assert.ok(move, "the create carries the count move, in the same batch");
    assert.equal(counter().count, 2, "1 active from the recount, +1 new brand, +1 unarchive, -1 archive");
    assert.equal(counter().op, "b2");
    assert.ok(clientCounterWrites().every((o) => o.op === "set" && o.data.op !== "recount"), "the client only ever moves it");
  });

  test("archive, unarchive and trash move it by one; ordinary edits don't touch it", async () => {
    const id = store.listBrands().find((x) => x.name === "Tiga").id;
    store.archiveBrand(id, true);
    await wait();
    assert.equal(counter().count, 1);
    store.archiveBrand(id, false);
    await wait();
    assert.equal(counter().count, 2);
    const before = clientCounterWrites().length;
    store.updateBrand(id, { tagline: "no change in activeness" });
    await wait();
    assert.equal(clientCounterWrites().length, before);
    store.deleteBrand("b1");
    await wait();
    assert.equal(counter().count, 1);
    assert.equal(counter().op, "b1");
  });

  test("a refused move recounts on the server and retries once", async () => {
    const id = store.listBrands().find((x) => x.name === "Tiga").id;
    __docs.set(`brandCounts/${UID}`, { count: 7, op: "elsewhere", at: 1 }); // drifted
    const n = recounts;
    __faults.denied = 1;
    store.archiveBrand(id, true);
    await wait(80);
    assert.equal(recounts, n + 1);
    assert.equal(__docs.get(`brands/${id}`).archived, true);
    assert.equal(counter().count, 0, "recounted (1 active) then moved down by one");
  });

  test("refused even after the recount: undone locally, with a message", async () => {
    await withToasts(async () => {
      __faults.denied = 2;
      const b = store.createBrand({ name: "Empat" });
      await wait(100);
      assert.equal(store.listBrands().some((x) => x.id === b.id), false, "the create is taken back");
      assert.equal(__docs.has(`brands/${b.id}`), false);
    });
  });
});

describe("before BRAND_COUNT_START (review round 2, fix 3)", () => {
  test("no recount, no counter writes, no waiting — old tabs keep working", async () => {
    store.setBrandCountStart("2099-01-01");
    __reset();
    const n = recounts;
    const UID2 = "uid-early";
    __docs.set("brands/e1", { id: "e1", ownerId: UID2, name: "E", createdAt: 1 });
    await store.initStore(UID2);
    assert.equal(store.brandCountKnown(), true, "nothing to wait for");
    const b = store.createBrand({ name: "Early" });
    store.archiveBrand("e1", true);
    await wait();
    assert.equal(recounts, n, "the server isn't asked to create a counter yet");
    assert.equal(__docs.has(`brandCounts/${UID2}`), false);
    assert.equal(__writes.flatMap((w) => w.ops || [w]).some((o) => o.path.startsWith("brandCounts/")), false);
    assert.ok(__docs.has(`brands/${b.id}`));
    await withToasts(async () => {
      __faults.denied = 1;
      store.archiveBrand("e1", false);
      await wait();
    });
    assert.equal(recounts, n, "a refusal doesn't trigger a recount before the start date either");
    store.setBrandCountStart("2026-01-01");
  });
});

describe("POST /api/brands/recount (api/brands/recount.js)", () => {
  // A fake Admin Firestore: docs by path, brand queries by ownerId.
  function fakeDb({ account = { status: "active", plan: "pro" }, counter = null, brands = [] } = {}) {
    const docs = new Map([["accounts/u1", account], ["brandCounts/u1", counter]].filter(([, v]) => v));
    const writes = [];
    const db = {
      writes,
      collection: () => ({ where: (field, op, value) => ({ select: () => ({ query: true, field, value }) }) }),
      doc: (path) => ({ path }),
      runTransaction: async (fn) => fn({
        get: async (ref) => (ref.query
          ? { docs: brands.filter((b) => b[ref.field] === ref.value).map((b) => ({ data: () => b })) }
          : { exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
        set: (ref, data) => writes.push({ path: ref.path, data }),
      }),
    };
    return db;
  }
  const NOW = 1_800_000_000_000;

  test("counts active brands only — the app's definition — and writes the counter in one transaction", async () => {
    const db = fakeDb({ brands: [
      { ownerId: "u1" }, { ownerId: "u1", archived: true }, { ownerId: "u1", deletedAt: 5 }, { ownerId: "u1", archived: false, deletedAt: null }, { ownerId: "u2" },
    ] });
    assert.deepEqual(await recountBrandsFor(db, "u1", { now: NOW }), { count: 2 });
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].path, "brandCounts/u1");
    assert.equal(db.writes[0].data.count, 2);
    assert.equal(db.writes[0].data.op, "recount");
    assert.ok(db.writes[0].data.lastRecountAt, "stamped for the throttle");
  });

  test("at most once per 30 s per account: in between, the stored count comes back unchanged (round 2, fix 8)", async () => {
    const db = fakeDb({ counter: { count: 4, op: "x", lastRecountAt: { toMillis: () => NOW - 10_000 } }, brands: [{ ownerId: "u1" }] });
    assert.deepEqual(await recountBrandsFor(db, "u1", { now: NOW }), { count: 4, throttled: true });
    assert.equal(db.writes.length, 0);
    const later = fakeDb({ counter: { count: 4, op: "x", lastRecountAt: { toMillis: () => NOW - 40_000 } }, brands: [{ ownerId: "u1" }] });
    assert.deepEqual(await recountBrandsFor(later, "u1", { now: NOW }), { count: 1 });
  });

  test("refuses an account that can't write brands", async () => {
    for (const account of [null, { status: "deactivated", plan: "pro" }, { status: "readonly", plan: "pro" }, { status: "active", plan: "trial", trialEndsAt: NOW - 1 }, { status: "active", plan: "pro", subscriptionExpiresAt: NOW - 1 }]) {
      await assert.rejects(recountBrandsFor(fakeDb({ account }), "u1", { now: NOW }), (e) => e.status === 403, JSON.stringify(account));
    }
  });
});
