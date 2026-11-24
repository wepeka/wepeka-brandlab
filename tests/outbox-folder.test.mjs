// The Mac folder handle and the URLs of its files (js/outbox.js), on fakes of
// IndexedDB and Chrome's File System Access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreOutbox, connectOutbox, outboxFileURL } from "../js/outbox.js";

// ---- fakes ---------------------------------------------------------------
const saved = new Map(); // what IndexedDB holds
globalThis.indexedDB = {
  open() {
    const req = {};
    const db = {
      transaction() {
        const tx = {};
        tx.objectStore = () => ({
          get: (k) => ({ result: saved.get(k) }),
          put: (v, k) => { saved.set(k, v); return { result: k }; },
          createObjectStore() {},
        });
        setTimeout(() => tx.oncomplete?.());
        return tx;
      },
    };
    setTimeout(() => { req.result = db; req.onsuccess?.(); });
    return req;
  },
};

// A folder: { "Quatro/QKC-1 x/v1.mp4": { bytes, lastModified } } with answer =
// what queryPermission does ("granted", or "hang" for a Chrome that never answers).
function folder(files, answer = "granted") {
  const dir = (prefix, name) => ({
    kind: "directory",
    name,
    queryPermission: () => (answer === "hang" ? new Promise(() => {}) : Promise.resolve(answer)),
    async getDirectoryHandle(n) { return dir(`${prefix}${n}/`, n); },
    async getFileHandle(n) {
      const path = `${prefix}${n}`;
      if (!files[path]) throw new DOMException("not found", "NotFoundError");
      return { kind: "file", name: n, getFile: async () => new File([files[path].bytes], n, { lastModified: files[path].lastModified }) };
    },
  });
  return dir("", "Brandlab Outbox");
}

test("a saved folder Chrome never answers for: forgotten, so the connect button shows", async () => {
  window.showDirectoryPicker = async () => folder({});
  saved.set("root", folder({}, "hang"));
  const t0 = Date.now();
  const s = await restoreOutbox({ wait: 30 });
  assert.ok(Date.now() - t0 < 1000, "does not wait for Chrome forever");
  assert.deepEqual(s, { connected: false, name: "Brandlab Outbox", needsPermission: false });
});

test("a saved folder Chrome answers for keeps working as before", async () => {
  saved.set("root", folder({}, "granted"));
  assert.equal((await restoreOutbox({ wait: 30 })).connected, true);
  saved.set("root", folder({}, "prompt"));
  assert.deepEqual(await restoreOutbox({ wait: 30 }), { connected: false, name: "Brandlab Outbox", needsPermission: true });
});

test("file URLs are never revoked while the tab lives, one per file, fresh when the file changes", async () => {
  // Quatro had 46 pieces with cuts, up to 11 each: more than the old cap of 40.
  const files = {};
  for (let i = 1; i <= 60; i++) files[`Quatro/QKC-${i} Konten/v1.mp4`] = { bytes: `cut ${i}`, lastModified: 1000 };
  window.showDirectoryPicker = async () => folder(files);
  await connectOutbox();
  const revoked = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => { revoked.push(u); revoke(u); };
  try {
    const first = await outboxFileURL("Quatro/QKC-1 Konten", "v1.mp4");
    for (let i = 2; i <= 60; i++) await outboxFileURL(`Quatro/QKC-${i} Konten`, "v1.mp4");
    assert.deepEqual(revoked, [], "the video on screen keeps its URL");
    assert.equal(await outboxFileURL("Quatro/QKC-1 Konten", "v1.mp4"), first, "same file, same URL");
    files["Quatro/QKC-1 Konten/v1.mp4"] = { bytes: "cut 1, rendered again", lastModified: 2000 };
    assert.notEqual(await outboxFileURL("Quatro/QKC-1 Konten", "v1.mp4"), first, "a rewritten file gets a new URL");
    await assert.rejects(outboxFileURL("Quatro/QKC-1 Konten", "v9.mp4"), { name: "NotFoundError" });
  } finally {
    URL.revokeObjectURL = revoke;
  }
});
