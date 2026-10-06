// Minimal in-memory stand-in for
// https://www.gstatic.com/firebasejs/*/firebase-firestore.js — covers
// exactly what js/store.js imports (grepped from its import block):
// collection, doc, query, where, onSnapshot, setDoc, updateDoc, deleteDoc,
// deleteField, writeBatch.
//
// js/store.js keeps its own in-memory `db` mirror and mutates it directly
// on every write (see persist()/commitInChunks()) — reads never go through
// these functions again. So this stub does NOT need to simulate a real
// round-trip: onSnapshot just needs to fire once (empty) so initStore()'s
// per-collection `ready` flags all flip true and its returned promise
// resolves, matching how the real SDK's first snapshot behaves.
//
// Writes land in a tiny in-memory document store (`__docs`, path → data)
// and are logged in order (`__writes`), so data-layer tests can check WHAT
// would reach Firestore: a partial update vs a whole-doc rewrite, an asset
// doc written before the brand that points at it, and so on. updateDoc
// refuses a missing doc like the real SDK; getDocs/getDoc read `__docs`.
// Listeners never see these writes (store.js never needs them to).
export const __docs = new Map();
export const __writes = [];
// Live listeners: __refire(test) delivers a fresh snapshot (from __docs) to
// each one whose ref passes `test(ref)` — another tab or device changing data.
export const __listeners = [];
export function __refire(test = () => true) {
  __listeners.filter((l) => test(l.ref)).forEach((l) => l.fire());
}
// Paths this "device" has cached (getDoc puts them there; getDocFromCache
// only answers for them) and every one-doc read, as "cache:<path>" or
// "server:<path>" — to test cache-first reads.
export const __cached = new Set();
export const __reads = [];
export function __reset() {
  __docs.clear();
  __writes.length = 0;
  __cached.clear();
  __reads.length = 0;
}

export function initializeFirestore(app, opts) {
  return { app, opts, _stub: true };
}
// Cache settings (js/firebase.js) — plain markers; nothing is cached here.
export function persistentLocalCache(settings = {}) {
  return { kind: "persistent", ...settings };
}
export function persistentMultipleTabManager() {
  return { kind: "multiTab" };
}
export function memoryLocalCache() {
  return { kind: "memory" };
}
// Every call to the cache lifecycle functions is recorded here, so tests
// can check that a logout really wipes the local cache.
export const __lifecycle = [];
export async function terminate() {
  __lifecycle.push("terminate");
}
export async function clearIndexedDbPersistence() {
  __lifecycle.push("clearIndexedDbPersistence");
  if (__faults.clear > 0) {
    __faults.clear -= 1;
    const err = new Error("stub: Firestore already started");
    err.code = "failed-precondition";
    throw err;
  }
}
export async function waitForPendingWrites() {
  __lifecycle.push("waitForPendingWrites");
}

export function collection(db, ...segments) {
  return { _type: "collection", db, path: segments.join("/") };
}

export function doc(db, ...segments) {
  return { _type: "doc", db, path: segments.join("/") };
}

export function query(collRef, ...clauses) {
  return { _type: "query", collRef, clauses };
}

export function where(field, op, value) {
  return { _type: "where", field, op, value };
}

// Fires one snapshot asynchronously (matching the real SDK's
// async-even-when-cached behavior) with whatever `__docs` holds for that
// doc/query at that moment — empty unless a test seeded it — then never
// fires again. Good enough for initStore()'s "wait for first snapshot of
// every collection" logic, and for tests that start from existing data.
export function onSnapshot(ref, ...args) {
  // The real SDK also takes (ref, options, onNext, onError).
  if (args[0] && typeof args[0] === "object" && typeof args[0] !== "function") args = args.slice(1);
  const [onNext, onError] = args;
  const fire = () => {
    try {
      if (ref && ref._type === "doc") {
        onNext(snapOf(ref.path));
      } else {
        onNext({ docs: matching(ref) });
      }
    } catch (e) {
      if (onError) onError(e);
    }
  };
  queueMicrotask(fire);
  const entry = { ref, fire };
  __listeners.push(entry);
  return () => {
    const i = __listeners.indexOf(entry);
    if (i >= 0) __listeners.splice(i, 1);
  };
}

const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v) && !v._delete && !v._arrayUnion && !v._arrayRemove && !v._serverTimestamp;
// Firestore compares values, not key order.
const same = (a, b) => {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};
// One field value as Firestore would store it, given what was there before.
function resolveValue(prev, v) {
  if (v && v._arrayUnion) {
    const list = Array.isArray(prev) ? [...prev] : [];
    v._arrayUnion.forEach((el) => { if (!list.some((x) => same(x, el))) list.push(el); });
    return list;
  }
  if (v && v._arrayRemove) {
    const list = Array.isArray(prev) ? [...prev] : [];
    return list.filter((x) => !v._arrayRemove.some((el) => same(x, el)));
  }
  if (v && v._serverTimestamp) return Date.now();
  return v;
}
function mergeInto(target, data) {
  const out = { ...(target || {}) };
  Object.entries(data).forEach(([k, v]) => {
    if (v && v._delete) delete out[k];
    else if (isPlain(v) && isPlain(out[k])) out[k] = mergeInto(out[k], v);
    else out[k] = resolveValue(out[k], v);
  });
  return out;
}
function applySet(path, data, options = {}) {
  const prev = __docs.get(path);
  let next;
  if (options.mergeFields) {
    next = { ...(prev || {}) };
    options.mergeFields.forEach((k) => {
      const v = data[k];
      if (v && v._delete) delete next[k];
      else next[k] = resolveValue(next[k], v);
    });
  } else if (options.merge) {
    next = mergeInto(prev, data);
  } else {
    next = mergeInto({}, data);
  }
  __docs.set(path, next);
}
function applyUpdate(path, data) {
  if (!__docs.has(path)) {
    const err = new Error(`No document to update: ${path}`);
    err.code = "not-found";
    throw err;
  }
  const next = { ...__docs.get(path) };
  Object.entries(data).forEach(([k, v]) => {
    if (v && v._delete) delete next[k];
    else next[k] = resolveValue(next[k], v);
  });
  __docs.set(path, next);
}

// `__acks.hold = true`: writes still land (and are logged) the moment
// they're made — like Firestore's local queue — but their promises only
// resolve on __acks.release(), like a server that hasn't answered yet.
export const __acks = { hold: false, waiting: [], release() { this.waiting.splice(0).forEach((r) => r()); } };
const acked = () => (__acks.hold ? new Promise((r) => __acks.waiting.push(r)) : Promise.resolve());
export function setDoc(ref, data, options = {}) {
  __writes.push({ op: "set", path: ref.path, data, options });
  try { applySet(ref.path, data, options); } catch (e) { return Promise.reject(e); }
  return acked();
}
export function updateDoc(ref, data) {
  __writes.push({ op: "update", path: ref.path, data });
  try { applyUpdate(ref.path, data); } catch (e) { return Promise.reject(e); }
  return acked();
}
export async function deleteDoc(ref) {
  __writes.push({ op: "delete", path: ref.path });
  __docs.delete(ref.path);
}
export function deleteField() {
  return { _delete: true };
}
export function serverTimestamp() {
  return { _serverTimestamp: true };
}
export function arrayUnion(...elements) {
  return { _arrayUnion: elements };
}
export function arrayRemove(...elements) {
  return { _arrayRemove: elements };
}

// All ops of a batch apply together on commit (an update of a missing doc
// fails the whole batch, as in the real SDK). `__faults.commit = n` makes
// the next n commits fail, to test what a failed write leaves behind.
export const __faults = { commit: 0, denied: 0, clear: 0, read: 0 };
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, options = {}) { ops.push({ op: "set", path: ref.path, data, options }); },
    delete(ref) { ops.push({ op: "delete", path: ref.path }); },
    update(ref, data) { ops.push({ op: "update", path: ref.path, data }); },
    async commit() {
      if (__faults.commit > 0) {
        __faults.commit -= 1;
        throw new Error("stub: commit failed");
      }
      if (__faults.denied > 0) {
        __faults.denied -= 1;
        const err = new Error("stub: Missing or insufficient permissions.");
        err.code = "permission-denied";
        throw err;
      }
      const before = new Map(__docs);
      try {
        ops.forEach((o) => {
          if (o.op === "set") applySet(o.path, o.data, o.options);
          else if (o.op === "update") applyUpdate(o.path, o.data);
          else __docs.delete(o.path);
        });
      } catch (e) {
        __docs.clear();
        before.forEach((v, k) => __docs.set(k, v));
        throw e;
      }
      __writes.push({ op: "batch", ops });
      await acked();
    },
  };
}

const snapOf = (path) => ({ id: path.split("/").pop(), ref: { _type: "doc", path }, exists: () => __docs.has(path), data: () => (__docs.has(path) ? structuredClone(__docs.get(path)) : undefined) });
export async function getDoc(ref) {
  if (__faults.read > 0) {
    __faults.read -= 1;
    const err = new Error("stub: read failed");
    err.code = "unavailable";
    throw err;
  }
  __reads.push(`server:${ref.path}`);
  __cached.add(ref.path);
  return snapOf(ref.path);
}
export async function getDocFromServer(ref) {
  __reads.push(`server:${ref.path}`);
  return snapOf(ref.path);
}
export async function getDocFromCache(ref) {
  if (!__cached.has(ref.path) || !__docs.has(ref.path)) {
    const err = new Error("stub: not in cache");
    err.code = "unavailable";
    throw err;
  }
  __reads.push(`cache:${ref.path}`);
  return snapOf(ref.path);
}
// Direct children of the collection that pass every `where("f", "==", v)`.
function matching(ref) {
  const coll = ref._type === "query" ? ref.collRef : ref;
  const clauses = ref._type === "query" ? ref.clauses.filter((c) => c && c._type === "where") : [];
  const depth = coll.path.split("/").length + 1;
  return [...__docs.keys()]
    .filter((p) => p.startsWith(coll.path + "/") && p.split("/").length === depth)
    .map(snapOf)
    .filter((d) => clauses.every((c) => c.op === "==" && d.data()[c.field] === c.value));
}
export async function getDocs(ref) {
  const docs = matching(ref);
  return { docs, empty: !docs.length, size: docs.length };
}
// Reads see __docs; the writes apply together once `fn` resolves.
export async function runTransaction(_db, fn) {
  const ops = [];
  const tx = {
    get: async (ref) => snapOf(ref.path),
    set(ref, data, options = {}) { ops.push({ op: "set", path: ref.path, data, options }); return tx; },
    update(ref, data) { ops.push({ op: "update", path: ref.path, data }); return tx; },
    delete(ref) { ops.push({ op: "delete", path: ref.path }); return tx; },
  };
  const result = await fn(tx);
  ops.forEach((o) => {
    if (o.op === "set") applySet(o.path, o.data, o.options);
    else if (o.op === "update") applyUpdate(o.path, o.data);
    else __docs.delete(o.path);
  });
  __writes.push({ op: "tx", ops });
  return result;
}
