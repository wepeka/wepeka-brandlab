// The Firestore data layer (js/firebase.js, js/auth.js, js/store.js):
// local cache lifecycle, partial writes, assets/sales out of the brand doc.
// Runs against the in-memory stubs in tests/stubs/ — nothing here talks to
// a real Firebase project.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { __lifecycle, __faults as __lifecycleFaults } from "./stubs/firebase-firestore.js";

describe("local cache lifecycle (js/firebase.js, js/auth.js)", () => {
  test("nothing loads the Firestore SDK before it's needed", async () => {
    const fb = await import("../js/firebase.js");
    await import("../js/auth.js");
    await import("../js/account.js");
    assert.equal(fb.db, null, "store.js, account.js and auth.js are imported, Firestore is not");
    await fb.loadFirestore();
    assert.ok(fb.db, "loaded on first use");
  });

  test("logout flushes queued writes first, then wipes the Firestore cache", async () => {
    globalThis.indexedDB = globalThis.indexedDB || {};
    globalThis.sessionStorage = globalThis.sessionStorage || { clear() {} };
    const { loadFirestore } = await import("../js/firebase.js");
    await loadFirestore();
    __lifecycle.length = 0;
    const { logout } = await import("../js/auth.js");
    await logout();
    assert.deepEqual(__lifecycle, ["waitForPendingWrites", "terminate", "clearIndexedDbPersistence"]);
  });

  test("the login screen's static import graph never pulls in the Firestore SDK", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(new URL("..", import.meta.url).pathname);
    const re = /^\s*(?:import|export)\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;
    const seen = new Set();
    const offenders = [];
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        const spec = m[1];
        if (/firebase-firestore\.js$/.test(spec)) offenders.push(path.relative(root, file));
        else if (!spec.startsWith("http")) {
          const next = path.resolve(path.dirname(file), spec);
          if (fs.existsSync(next)) walk(next);
        }
      }
    };
    walk(path.join(root, "js/main.js"));
    assert.deepEqual(offenders, []);
    assert.ok(seen.size > 20);
  });

  test("a different person's leftover cache is cleared before first use", async () => {
    globalThis.indexedDB = globalThis.indexedDB || {};
    const { claimLocalCache } = await import("../js/firebase.js");
    localStorage.removeItem("brandlab:cacheUid");
    __lifecycle.length = 0;
    await claimLocalCache("uid-a");
    assert.deepEqual(__lifecycle, [], "first sign-in on this browser: nothing to clear");
    await claimLocalCache("uid-a");
    assert.deepEqual(__lifecycle, [], "same person again: the cache stays");
    await claimLocalCache("uid-b");
    assert.deepEqual(__lifecycle, ["clearIndexedDbPersistence"]);
    assert.equal(localStorage.getItem("brandlab:cacheUid"), "uid-b");
  });

  test("someone else's cache that can't be cleared in place is wiped with one reload (fix 10)", async () => {
    globalThis.indexedDB = globalThis.indexedDB || {};
    const session = new Map();
    globalThis.sessionStorage = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k), clear: () => session.clear() };
    let reloads = 0;
    globalThis.location = { reload: () => { reloads += 1; } };
    const { claimLocalCache } = await import("../js/firebase.js");
    localStorage.setItem("brandlab:cacheUid", "uid-old");
    __lifecycleFaults.clear = 1; // the pricing page already started Firestore
    claimLocalCache("uid-new"); // never resolves: the page reloads
    await flush();
    assert.equal(reloads, 1);
    assert.equal(localStorage.getItem("brandlab:cacheUid"), "uid-old", "not claimed until it's actually cleared");
    __lifecycleFaults.clear = 1; // after the reload it still can't (another tab holds it)
    await claimLocalCache("uid-new");
    assert.equal(reloads, 1, "no reload loop");
    assert.equal(localStorage.getItem("brandlab:cacheUid"), "uid-new");
    delete globalThis.location;
  });

  test("the Firestore instance asks for the persistent multi-tab cache", async () => {
    const { loadFirestore } = await import("../js/firebase.js");
    await loadFirestore();
    const { db } = await import("../js/firebase.js");
    assert.equal(db.opts.experimentalAutoDetectLongPolling, true);
    assert.ok(["persistent", "memory"].includes(db.opts.localCache.kind));
  });
});

// ---------------------------------------------------------------------------
import { __docs, __writes, __reset } from "./stubs/firebase-firestore.js";
import * as store from "../js/store.js";

const flush = () => new Promise((r) => setTimeout(r, 5));
const lastWrite = (path) => [...__writes].reverse().find((w) => w.path === path || (w.op === "batch" && w.ops.some((o) => o.path === path)));

describe("partial writes (goal 4)", () => {
  test("updateBrand sends only the changed top-level fields; undefined deletes the field", async () => {
    await store.initStore("uid-partial");
    __reset();
    const b = store.createBrand({ name: "Kopi" });
    await flush();
    const create = __writes[0].op === "batch" ? __writes[0].ops.find((o) => o.path === `brands/${b.id}`) : __writes[0];
    assert.equal(create.op, "set", "a create still writes the whole doc");
    assert.equal(create.data.name, "Kopi");
    store.updateBrand(b.id, { tagline: "pagi", ads: undefined });
    await flush();
    const w = lastWrite(`brands/${b.id}`);
    assert.equal(w.op, "update");
    assert.deepEqual(Object.keys(w.data).sort(), ["ads", "tagline"]);
    assert.deepEqual(w.data.ads, { _delete: true });
    assert.equal(__docs.get(`brands/${b.id}`).name, "Kopi", "untouched fields stay as stored");
  });

  test("a stale in-memory field is never written back by an unrelated edit", async () => {
    __reset();
    const b = store.createBrand({ name: "Teh" });
    await flush();
    // Another device renamed the brand on the server; this tab still has "Teh".
    __docs.set(`brands/${b.id}`, { ...__docs.get(`brands/${b.id}`), name: "Teh Baru" });
    store.updateBrand(b.id, { color: "#123456" });
    await flush();
    assert.equal(__docs.get(`brands/${b.id}`).name, "Teh Baru");
    assert.equal(__docs.get(`brands/${b.id}`).color, "#123456");
  });

  test("content, campaign and series updates are field-level too", async () => {
    __reset();
    const b = store.createBrand({ name: "Roti" });
    const c = store.createContent(b.id, { title: "a" });
    const camp = store.createCampaign(b.id, { name: "x" });
    const ser = store.createSeries(b.id, { name: "s" });
    await flush();
    store.updateContent(c.id, { performance: { views: 5 } });
    store.updateCampaign(camp.id, { status: "active" });
    store.updateSeries(ser.id, { dna: { tone: "santai" } });
    store.deleteContent(c.id);
    await flush();
    const writes = __writes.filter((w) => w.op === "update");
    assert.deepEqual(Object.keys(writes[0].data).sort(), ["performance", "updatedAt"]);
    assert.equal(writes[0].data.performance.views, 5);
    assert.ok("insightScreenshot" in writes[0].data.performance, "performance is merged, then replaced whole");
    assert.deepEqual(Object.keys(writes[1].data).sort(), ["status", "updatedAt"]);
    assert.deepEqual(Object.keys(writes[2].data).sort(), ["dna", "updatedAt"]);
    assert.deepEqual(Object.keys(writes[3].data), ["deletedAt"]);
  });

  test("settings write only what changed, creating the doc if needed", async () => {
    __reset();
    store.updateFormulas({ engagementRate: "likes / reach * 100" });
    await flush();
    const w = __writes.find((x) => x.path === "settings/uid-partial");
    assert.deepEqual(w.options, { mergeFields: ["formulas"] });
    assert.deepEqual(Object.keys(w.data), ["formulas"]);
  });

  test("soft-deleting a brand cascades as field updates in one batch", async () => {
    __reset();
    const b = store.createBrand({ name: "Batik" });
    const c = store.createContent(b.id, { title: "post" });
    await flush();
    __writes.length = 0;
    store.deleteBrand(b.id);
    await flush();
    const batch = __writes.find((w) => w.op === "batch");
    assert.deepEqual(batch.ops.map((o) => [o.op, o.path, Object.keys(o.data)]), [
      ["update", `brands/${b.id}`, ["deletedAt"]],
      ["update", `content/${c.id}`, ["deletedAt"]],
    ], "no brandCounts write: this account has no counter, and the client never creates one");
    store.restoreBrand(b.id);
    await flush();
    assert.equal(__docs.get(`brands/${b.id}`).deletedAt, null);
  });
});

// ---------------------------------------------------------------------------
describe("chat threads per brand (goal 3b, review fix 1)", () => {
  test("threads load for the brand on screen; other brands' threads stay out of memory", async () => {
    __reset();
    const a = store.createBrand({ name: "A" });
    const bb = store.createBrand({ name: "B" });
    await store.watchBrandScope(a.id);
    store.createBrainstorm(a.id, { title: "ide A" });
    assert.equal(store.listBrainstorms(a.id).length, 1);
    await store.watchBrandScope(bb.id);
    assert.equal(store.listBrainstorms(a.id).length, 0, "switching brands drops the previous brand's threads");
    assert.equal(store.scopeBrandId(), bb.id);
  });

  test("an AI reply that lands after a brand switch is still saved to its thread", async () => {
    __reset();
    const a = store.createBrand({ name: "A2" });
    const bb = store.createBrand({ name: "B2" });
    await flush();
    __docs.set(`brainstorms/consult-${a.id}`, { id: `consult-${a.id}`, ownerId: "uid-partial", brandId: a.id, mode: "consult", messages: [{ id: "q1", role: "user", text: "tanya" }] });
    await store.watchBrandScope(a.id);
    const th = store.getConsultThread(a.id);
    assert.ok(th);
    await store.watchBrandScope(bb.id); // the owner moved on while the answer streamed
    assert.equal(store.getBrainstorm(th.id), null);
    const msg = store.appendBrainstormMessage(th.id, { role: "assistant", text: "jawaban" });
    assert.ok(msg, "the reply isn't dropped");
    await flush();
    const stored = __docs.get(`brainstorms/consult-${a.id}`);
    assert.deepEqual(stored.messages.map((m) => m.text), ["tanya", "jawaban"]);
    assert.equal(stored.brandId, a.id);
    // Removing the question after the brand switch: done on the server's copy.
    store.removeBrainstormMessage(th.id, "q1");
    await flush();
    assert.deepEqual(__docs.get(`brainstorms/consult-${a.id}`).messages.map((m) => m.text), ["jawaban"]);
  });

  test("a placeholder thread never wipes the server's log when a message is edited or removed", async () => {
    __reset();
    const b = store.createBrand({ name: "C" });
    await store.watchBrandScope(b.id);
    await flush();
    // The server already has this brand's companion log (another device),
    // which this tab's snapshot hadn't carried yet.
    __docs.set(`brainstorms/companion-${b.id}`, { id: `companion-${b.id}`, ownerId: "uid-partial", brandId: b.id, messages: [{ id: "m1", text: "lama" }] });
    const th = store.ensureCompanionThread(b.id);
    const mine = store.appendBrainstormMessage(th.id, { role: "user", text: "baru" });
    await flush();
    const create = __writes.find((w) => w.path === `brainstorms/companion-${b.id}`);
    assert.deepEqual(create.options, { merge: true });
    assert.equal("messages" in create.data, false);
    store.updateBrainstormMessage(th.id, mine.id, { rated: true });
    await flush();
    let stored = __docs.get(`brainstorms/companion-${b.id}`).messages;
    assert.deepEqual(stored.map((m) => m.text), ["lama", "baru"], "the unseen message survives");
    assert.equal(stored[1].rated, true);
    assert.ok(__writes.some((w) => w.op === "tx"), "rewritten through the server's copy");
    store.updateBrainstorm(th.id, { messages: [] }); // "clear" from this tab
    await flush();
    stored = __docs.get(`brainstorms/companion-${b.id}`).messages;
    assert.deepEqual(stored.map((m) => m.text), ["lama"], "only what this tab had is cleared");
  });

  test("a thread this tab created itself is rewritten directly", async () => {
    __reset();
    const b = store.createBrand({ name: "D" });
    await store.watchBrandScope(b.id);
    const th = store.createBrainstorm(b.id, { title: "baru" });
    const m = store.appendBrainstormMessage(th.id, { role: "user", text: "x" });
    await flush();
    __writes.length = 0;
    store.removeBrainstormMessage(th.id, m.id);
    await flush();
    assert.deepEqual(__writes.map((w) => w.op), ["update"]);
  });

  test("deleting a brand removes its threads even when they were never loaded", async () => {
    __reset();
    const b = store.createBrand({ name: "E" });
    await flush();
    __docs.set("brainstorms/t-old", { id: "t-old", ownerId: "uid-partial", brandId: b.id, messages: [] });
    __docs.set("brainstorms/t-other", { id: "t-other", ownerId: "uid-partial", brandId: "someone-else", messages: [] });
    store.deleteBrand(b.id);
    await flush();
    assert.equal(__docs.has("brainstorms/t-old"), false);
    assert.equal(__docs.has("brainstorms/t-other"), true);
  });
});

// ---------------------------------------------------------------------------
import { __faults, __cached, __reads } from "./stubs/firebase-firestore.js";
import { brandDocFits } from "../js/brand-doc-size.js";
import { checkImport } from "../js/account.js";
import { isAssetRef, assetIdFor, ASSET_MAX_CHARS } from "../js/brand-assets.js";

const png = (tag, n = 2000) => `data:image/png;base64,${tag}${"A".repeat(n)}`;
const OLD_UID = "uid-assets";
function seedOldBrand(id) {
  __docs.set(`brands/${id}`, {
    id, ownerId: OLD_UID, name: "Lama", createdAt: 1, avatar: "data:image/png;base64,AVATAR",
    coverPhoto: png("cover"),
    brandGuidelines: {
      logo: { hasLogo: true, dataUrl: png("logo"), secondaryDataUrl: "", logotypeDataUrl: png("type") },
      mascots: [{ name: "Kiki", description: "", dataUrl: png("kiki") }],
      moodboard: [{ dataUrl: png("mood1") }, { dataUrl: png("mood2") }],
      customFonts: { "My Font": "data:font/woff2;base64,FONT" },
      bookPhoto: "data:image/jpeg;base64,BOOK",
      colors: { primary: "#111111" },
    },
  });
}
const assetDocs = (id) => [...__docs.keys()].filter((k) => k.startsWith(`brands/${id}/assets/`));
// A failed sync shows a toast (js/dom.js): give it a root to land in, and
// don't let its 6 s timer hold the test process open.
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
// The Brand Book page saves its whole answers object as brandGuidelines.
const saveBrandBook = (id) => store.updateBrand(id, { brandGuidelines: { ...store.getBrand(id).brandGuidelines } });

describe("brand files out of the brand doc (goal 5, review fixes 2/3/6/8)", () => {
  test("an old brand reads as before; an unrelated save moves nothing (fix 8)", async () => {
    __reset();
    seedOldBrand("old1");
    await store.initStore(OLD_UID);
    assert.equal(store.getBrand("old1").coverPhoto, png("cover"), "inline files read unchanged");
    store.updateBrand("old1", { tagline: "baru" });
    store.updateBrand("old1", { developmentLog: [] }); // e.g. Brand Pulse
    await flush();
    assert.equal(__docs.get("brands/old1").coverPhoto, png("cover"));
    assert.equal(assetDocs("old1").length, 0);
  });

  test("saving the Brand Book moves its files out — except the book photo (fix 2)", async () => {
    __reset();
    seedOldBrand("old1b");
    await store.initStore(OLD_UID);
    saveBrandBook("old1b");
    await flush();
    const stored = __docs.get("brands/old1b");
    const bg = stored.brandGuidelines;
    assert.ok(isAssetRef(bg.logo.dataUrl));
    assert.ok(isAssetRef(bg.logo.logotypeDataUrl));
    assert.ok(isAssetRef(bg.mascots[0].dataUrl));
    assert.ok(isAssetRef(bg.moodboard[1].dataUrl));
    assert.ok(isAssetRef(bg.customFonts["My Font"]));
    assert.equal(bg.bookPhoto, "data:image/jpeg;base64,BOOK", "the old app would turn an asset ref here into \"\"");
    assert.equal(bg.logo.secondaryDataUrl, "", "empty slots stay empty");
    assert.equal(stored.coverPhoto, png("cover"), "the cover moves only when the cover is saved");
    assert.equal(stored.avatar, "data:image/png;base64,AVATAR");
    assert.equal(assetDocs("old1b").length, 6);
    const logoAsset = __docs.get(`brands/old1b/assets/${assetIdFor(png("logo"))}`);
    assert.deepEqual({ ...logoAsset, createdAt: 0 }, { ownerId: OLD_UID, brandId: "old1b", kind: "logo", dataUrl: png("logo"), createdAt: 0 });
    const batch = __writes.find((w) => w.op === "batch");
    assert.equal(batch.ops.at(-1).path, "brands/old1b", "files first, the brand pointing at them last, one batch");
    assert.equal(store.getBrand("old1b").brandGuidelines.logo.dataUrl, png("logo"), "in memory still the file");
    store.updateBrand("old1b", { coverPhoto: store.getBrand("old1b").coverPhoto });
    await flush();
    assert.ok(isAssetRef(__docs.get("brands/old1b").coverPhoto));
  });

  test("a failed save leaves the inline files where they were", async () => {
    __reset();
    seedOldBrand("old2");
    await store.initStore(OLD_UID);
    await withToasts(async () => {
      __faults.commit = 1;
      saveBrandBook("old2");
      await flush();
    });
    assert.equal(__docs.get("brands/old2").brandGuidelines.logo.dataUrl, png("logo"));
    assert.equal(assetDocs("old2").length, 0);
    saveBrandBook("old2");
    await flush();
    assert.ok(isAssetRef(__docs.get("brands/old2").brandGuidelines.logo.dataUrl));
  });

  test("replacing a file never deletes the old one at save time (fix 3)", async () => {
    __reset();
    await store.initStore(OLD_UID);
    const b = store.createBrand({ name: "Baru" });
    await flush();
    store.updateBrand(b.id, { coverPhoto: png("c1") });
    await flush();
    await store.initStore(OLD_UID);
    store.updateBrand(b.id, { coverPhoto: png("c2") });
    await flush();
    assert.equal(assetDocs(b.id).length, 2, "c1 stays: another tab or device may still point at it");
    assert.equal(store.getBrand(b.id).coverPhoto, png("c2"));
  });

  test("the sweep marks unused files first and deletes them only 14 days after the mark (round 2, fix 5)", async () => {
    __reset();
    const id = "sweepme";
    const used = assetIdFor(png("used"));
    const DAY = 86400000;
    const now = Date.now();
    __docs.set(`brands/${id}`, { id, ownerId: OLD_UID, name: "S", coverPhoto: `asset:${used}` });
    // Created long ago: age alone never deletes anything.
    __docs.set(`brands/${id}/assets/${used}`, { ownerId: OLD_UID, brandId: id, kind: "cover", dataUrl: png("used"), createdAt: now - 300 * DAY, unusedSince: now - 30 * DAY });
    __docs.set(`brands/${id}/assets/aold`, { ownerId: OLD_UID, brandId: id, kind: "cover", dataUrl: png("old"), createdAt: now - 300 * DAY });
    __docs.set(`brands/${id}/assets/amarked`, { ownerId: OLD_UID, brandId: id, kind: "cover", dataUrl: png("m"), createdAt: 1, unusedSince: now - 20 * DAY });
    __docs.set(`brands/${id}/assets/afresh`, { ownerId: OLD_UID, brandId: id, kind: "cover", dataUrl: png("f"), createdAt: 1, unusedSince: now - 3 * DAY });
    await store.initStore(OLD_UID);
    const first = await store.sweepBrandAssets(id, { now, force: true });
    assert.deepEqual(first, { marked: 1, cleared: 1, deleted: 1 });
    assert.equal(__docs.has(`brands/${id}/assets/amarked`), false, "unused for 20 days since its mark");
    assert.ok(__docs.get(`brands/${id}/assets/aold`).unusedSince > 0, "just marked, kept");
    assert.ok(__docs.has(`brands/${id}/assets/afresh`), "marked 3 days ago, kept");
    assert.equal("unusedSince" in __docs.get(`brands/${id}/assets/${used}`), false, "referenced again: mark cleared");
  });

  test("files load without blocking the brand scope, cache first, and fill in", async () => {
    __reset();
    const id = "refbrand";
    const aid = assetIdFor(png("L"));
    __docs.set(`brands/${id}`, { id, ownerId: OLD_UID, name: "R", brandGuidelines: { logo: { dataUrl: `asset:${aid}` } } });
    __docs.set(`brands/${id}/assets/${aid}`, { ownerId: OLD_UID, brandId: id, kind: "logo", dataUrl: png("L"), createdAt: 1 });
    __cached.add(`brands/${id}/assets/${aid}`); // this device read it before
    await store.initStore(OLD_UID);
    await store.watchBrandScope(id);
    await store.loadBrandAssets(id);
    assert.equal(store.getBrand(id).brandGuidelines.logo.dataUrl, png("L"));
    assert.deepEqual(__reads.filter((r) => r.includes(aid)), [`cache:brands/${id}/assets/${aid}`], "no billed server read");
    assert.equal(store.resolveAsset(id, `asset:${aid}`), png("L"));
    assert.equal(store.resolveAsset(id, png("inline")), png("inline"), "an old inline value resolves to itself");
    assert.deepEqual(store.hydrateGuidelines(id, { logo: { dataUrl: `asset:${aid}` } }), { logo: { dataUrl: png("L") } });
  });

  test("the locked screen's read-only book fetches a raw brand's files", async () => {
    const aid = assetIdFor(png("RAW"));
    __docs.set(`brands/rawb/assets/${aid}`, { ownerId: OLD_UID, brandId: "rawb", kind: "logo", dataUrl: png("RAW"), createdAt: 1 });
    const raw = { id: "rawb", ownerId: OLD_UID, brandGuidelines: { logo: { dataUrl: `asset:${aid}` } } };
    assert.equal((await store.withBrandAssets(raw)).brandGuidelines.logo.dataUrl, png("RAW"));
    const gone = await store.withBrandAssets({ id: "rawb", brandGuidelines: { logo: { dataUrl: "asset:amissing" } } }, { strict: true });
    assert.equal(gone.brandGuidelines.logo.dataUrl, "asset:amissing", "a file that isn't there is no error");
    __faults.read = 1;
    await assert.rejects(store.withBrandAssets({ id: "rawb", brandGuidelines: { logo: { dataUrl: "asset:aunreadable" } } }, { strict: true }), "a read that fails is");
  });

  test("purging a brand deletes its files and sales too", async () => {
    __reset();
    seedOldBrand("old3");
    await store.initStore(OLD_UID);
    saveBrandBook("old3");
    await flush();
    __docs.set("brands/old3/sales/2026-10", { ownerId: OLD_UID, brandId: "old3", month: "2026-10", entries: [] });
    assert.ok(assetDocs("old3").length > 0);
    store.purgeBrand("old3");
    await flush();
    assert.equal(__docs.has("brands/old3"), false);
    assert.equal(assetDocs("old3").length, 0);
    assert.equal(__docs.has("brands/old3/sales/2026-10"), false);
  });

  test("the backup carries files inline; restoring writes the brand first, then its files (fix 9)", async () => {
    __reset();
    seedOldBrand("old4");
    await store.initStore(OLD_UID);
    saveBrandBook("old4");
    await flush();
    await store.prepareExport();
    const json = store.exportJSON();
    const exported = JSON.parse(json).brands.find((b) => b.id === "old4");
    assert.equal(exported.brandGuidelines.logo.dataUrl, png("logo"));
    __reset();
    await store.importJSON(json);
    const firstBrandWrite = __writes.findIndex((w) => (w.ops || [w]).some((o) => o.path === "brands/old4"));
    const firstAssetWrite = __writes.findIndex((w) => (w.ops || [w]).some((o) => o.path.startsWith("brands/old4/assets/")));
    assert.ok(firstBrandWrite >= 0 && firstBrandWrite < firstAssetWrite, "rules only take files under an existing brand");
    assert.ok(isAssetRef(__docs.get("brands/old4").brandGuidelines.logo.dataUrl));
    assert.equal(assetDocs("old4").length, 7, "6 Brand Book files + the cover (still inline in the backup)");
  });

  test("a missing file is left out of the backup and reported; a failed read still fails the export (round 2, fix 6)", async () => {
    __reset();
    __docs.set("brands/broken", { id: "broken", ownerId: OLD_UID, name: "Batik", coverPhoto: "asset:agone" });
    await store.initStore(OLD_UID);
    const skipped = await store.prepareExport();
    assert.deepEqual(skipped, [{ brandName: "Batik", kind: "cover" }]);
    assert.equal(JSON.parse(store.exportJSON()).brands.find((b) => b.id === "broken").coverPhoto, "", "no dead ref in the file");
    __docs.set("brands/broken2", { id: "broken2", ownerId: OLD_UID, name: "B2", coverPhoto: "asset:aunread" });
    await store.initStore(OLD_UID);
    __faults.read = 1;
    await assert.rejects(store.prepareExport());
  });

  test("size guard: the doc is measured with files as refs; one file must fit its own doc", () => {
    const brand = { id: "b", name: "Kopi" };
    assert.equal(brandDocFits(brand, { brandGuidelines: { moodboard: Array.from({ length: 12 }, (_, i) => ({ dataUrl: png(`m${i}`, 300_000) })) } }), true, "12 big photos no longer fill the brand doc");
    assert.equal(brandDocFits(brand, { coverPhoto: png("huge", ASSET_MAX_CHARS) }), false);
    assert.equal(brandDocFits(brand, { brandGuidelines: { bookPhoto: png("book", 960 * 1024) } }), false, "the book photo still counts inline");
  });

  test("import guard: a backup brand bigger than 1 MB because of its files is fine", () => {
    const b = { id: "big", name: "Big", createdAt: 1, brandGuidelines: { moodboard: Array.from({ length: 4 }, (_, i) => ({ dataUrl: png(`m${i}`, 400_000) })) } };
    assert.doesNotThrow(() => checkImport(JSON.stringify({ brands: [b] }), [], { plan: "pro", status: "active", brandLimit: 3 }));
    const tooBig = { ...b, coverPhoto: png("x", ASSET_MAX_CHARS) };
    assert.throws(() => checkImport(JSON.stringify({ brands: [tooBig] }), [], { plan: "pro", status: "active", brandLimit: 3 }));
  });

  test("an oversized old file isn't migrated, so it can't fail every save", async () => {
    __reset();
    const huge = `data:font/woff2;base64,${"A".repeat(ASSET_MAX_CHARS + 10)}`;
    __docs.set("brands/odd", { id: "odd", ownerId: OLD_UID, name: "Odd", createdAt: 1, brandGuidelines: { customFonts: { Big: huge }, logo: { dataUrl: png("ok") } } });
    await store.initStore(OLD_UID);
    saveBrandBook("odd");
    await flush();
    const stored = __docs.get("brands/odd").brandGuidelines;
    assert.equal(stored.customFonts.Big, huge);
    assert.ok(isAssetRef(stored.logo.dataUrl));
  });
});

// ---------------------------------------------------------------------------
import { getTracker, logSale, deleteSale, clearAllSales, trackerTotals, addProduct } from "../js/sales-tracker.js";

const monthDocs = (id) => [...__docs.keys()].filter((k) => k.startsWith(`brands/${id}/sales/`)).sort();
const entry = (id, date, qty = 1, at = 1) => ({ id, productId: "p1", qty, amount: qty * 10000, date, repeat: false, referral: false, note: "", eventId: null, at });
function seedSalesBrand(id) {
  __docs.set(`brands/${id}`, {
    id, ownerId: OLD_UID, name: "Toko", createdAt: 1,
    salesTracker: {
      model: "product", openingRevenue: 0,
      products: [{ id: "p1", name: "Kopi", price: 10000, openingSold: 0, archived: false }],
      entries: [entry("s-a", "2026-09-30", 1, 1), entry("s-b", "2026-10-02", 2, 2)],
    },
  });
}

describe("sales log in month docs (goal 6, review fixes 6/8)", () => {
  test("old inline entries read as before; the next Sales Tracker save moves them into month docs", async () => {
    __reset();
    seedSalesBrand("toko1");
    await store.initStore(OLD_UID);
    await store.watchBrandScope("toko1");
    assert.equal(getTracker(store.getBrand("toko1")).entries.length, 2);
    store.updateBrand("toko1", { tagline: "unrelated" });
    await flush();
    assert.equal(__docs.get("brands/toko1").salesTracker.entries.length, 2, "an unrelated save moves nothing");
    logSale("toko1", { productId: "p1", qty: 3, date: "2026-10-05" });
    await flush();
    assert.deepEqual(monthDocs("toko1"), ["brands/toko1/sales/2026-09", "brands/toko1/sales/2026-10"]);
    assert.deepEqual(__docs.get("brands/toko1/sales/2026-10").entries.map((e) => e.id).slice(0, 1), ["s-b"]);
    assert.equal(__docs.get("brands/toko1/sales/2026-10").entries.length, 2);
    assert.equal(__docs.get("brands/toko1/sales/2026-10").ownerId, OLD_UID);
    const stored = __docs.get("brands/toko1").salesTracker;
    assert.equal("entries" in stored, false, "no entries left inside the brand doc");
    assert.equal(stored.products.length, 1, "products stay on the brand doc");
    assert.equal(trackerTotals(getTracker(store.getBrand("toko1"))).sold, 6);
  });

  test("a sale logged elsewhere in the same month isn't overwritten (arrayUnion, not a rewrite)", async () => {
    __reset();
    seedSalesBrand("toko2");
    await store.initStore(OLD_UID);
    await store.watchBrandScope("toko2");
    // Another device's sale this month, which this tab hasn't seen.
    __docs.set("brands/toko2/sales/2026-10", { ownerId: OLD_UID, brandId: "toko2", month: "2026-10", entries: [entry("s-x", "2026-10-03", 5, 3)] });
    logSale("toko2", { productId: "p1", qty: 1, date: "2026-10-06" });
    await flush();
    const ids = __docs.get("brands/toko2/sales/2026-10").entries.map((e) => e.id);
    assert.ok(ids.includes("s-x"));
    assert.ok(ids.includes("s-b"));
    assert.equal(ids.length, 3);
  });

  test("month docs merge with inline entries, once each", async () => {
    __reset();
    seedSalesBrand("toko3");
    __docs.set("brands/toko3/sales/2026-10", { ownerId: OLD_UID, brandId: "toko3", month: "2026-10", entries: [entry("s-b", "2026-10-02", 2, 2), entry("s-c", "2026-10-03", 5, 3)] });
    await store.initStore(OLD_UID);
    await store.watchBrandScope("toko3");
    assert.deepEqual(getTracker(store.getBrand("toko3")).entries.map((e) => e.id), ["s-a", "s-b", "s-c"]);
  });

  test("deleting a sale removes it from its month; clearing removes them all", async () => {
    __reset();
    seedSalesBrand("toko4");
    await store.initStore(OLD_UID);
    await store.watchBrandScope("toko4");
    logSale("toko4", { productId: "p1", date: "2026-10-04" });
    await flush();
    await store.watchBrandScope("elsewhere");
    await store.watchBrandScope("toko4"); // listeners report what was stored
    deleteSale("toko4", "s-b");
    await flush();
    assert.deepEqual(__docs.get("brands/toko4/sales/2026-10").entries.map((e) => e.date), ["2026-10-04"]);
    clearAllSales("toko4");
    await flush();
    assert.equal(monthDocs("toko4").every((p) => __docs.get(p).entries.length === 0), true);
    assert.equal(getTracker(store.getBrand("toko4")).entries.length, 0);
  });

  test("a products-only change writes no sales docs", async () => {
    __reset();
    seedSalesBrand("toko5");
    await store.initStore(OLD_UID);
    await store.watchBrandScope("toko5");
    logSale("toko5", { productId: "p1", date: "2026-10-04" });
    await flush();
    await store.initStore(OLD_UID); // the brand listener reports the moved-out entries
    __writes.length = 0;
    addProduct("toko5", { name: "Teh", price: 8000 });
    await flush();
    assert.deepEqual(__writes.map((w) => w.op), ["update"], "one brand update, no month doc");
  });

  test("a brand without the Sales Tracker never reads sales; one with it says it's loading until then", async () => {
    __reset();
    __docs.set("brands/plain", { id: "plain", ownerId: OLD_UID, name: "Plain", createdAt: 1 });
    seedSalesBrand("toko6");
    await store.initStore(OLD_UID);
    assert.equal(store.isBrandSalesReady("plain"), true);
    assert.equal(getTracker(store.getBrand("plain")).loading, false);
    assert.equal(getTracker(store.getBrand("toko6")).loading, true, "not final yet");
    await store.ensureBrandSales("toko6");
    assert.equal(getTracker(store.getBrand("toko6")).loading, false);
  });
});

// ---------------------------------------------------------------------------
describe("writes don't wait for the server's answer (review round 2, fix 1)", () => {
  test("each write is handed to Firestore at once, even while earlier ones are unanswered", async () => {
    const { __acks } = await import("./stubs/firebase-firestore.js");
    __reset();
    const b = store.createBrand({ name: "Offline" });
    await flush();
    __acks.hold = true; // offline: nothing gets acknowledged
    try {
      store.updateBrand(b.id, { tagline: "satu" });
      store.updateBrand(b.id, { color: "#123456" });
      store.updateBrand(b.id, { coverPhoto: png("off") });
      store.updateBrand(b.id, { ideas: [{ id: "i1", text: "ide" }] });
      await flush();
      const stored = __docs.get(`brands/${b.id}`);
      assert.equal(stored.tagline, "satu");
      assert.equal(stored.color, "#123456");
      assert.ok(isAssetRef(stored.coverPhoto));
      assert.equal(stored.ideas.length, 1, "all four are in Firestore's queue (which survives a reload), none waiting in page memory");
    } finally {
      __acks.hold = false;
      __acks.release();
    }
  });

  test("a Brand Book save re-sends no file the server already has (fix 2)", async () => {
    __reset();
    seedOldBrand("resend");
    await store.initStore(OLD_UID);
    saveBrandBook("resend");
    await flush();
    await store.initStore(OLD_UID); // a server-confirmed snapshot of the saved brand
    await flush();
    __writes.length = 0;
    saveBrandBook("resend"); // e.g. a colour change: the Brand Book saves every step
    await flush();
    assert.deepEqual(__writes.map((w) => w.op), ["update"], "just the brand fields, no asset doc");
  });
});

describe("Brand Book fills loaded files into its own answers (round 2, fix 7)", () => {
  test("in place: the object the step handlers hold keeps a pick made while files loaded", async () => {
    __reset();
    const id = "inplace";
    const aid = assetIdFor(png("IP"));
    __docs.set(`brands/${id}`, { id, ownerId: OLD_UID, name: "I", brandGuidelines: { logo: { dataUrl: `asset:${aid}` }, moodboard: [{ dataUrl: `asset:${aid}` }] } });
    __docs.set(`brands/${id}/assets/${aid}`, { ownerId: OLD_UID, brandId: id, kind: "logo", dataUrl: png("IP"), createdAt: 1 });
    await store.initStore(OLD_UID);
    const answers = { logo: { dataUrl: `asset:${aid}`, secondaryDataUrl: "", logotypeDataUrl: "" }, moodboard: [{ dataUrl: `asset:${aid}` }], customFonts: {}, bookPhoto: "" };
    const held = answers; // what a handler captured
    answers.bookPhoto = "data:image/jpeg;base64,PICKED"; // picked while loading
    await store.loadBrandAssets(id);
    assert.equal(store.fillGuidelinesFiles(id, answers), true);
    assert.equal(held.logo.dataUrl, png("IP"));
    assert.equal(held.moodboard[0].dataUrl, png("IP"));
    assert.equal(held.bookPhoto, "data:image/jpeg;base64,PICKED");
    assert.equal(store.fillGuidelinesFiles(id, answers), false, "nothing left to fill");
  });
});
