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
// resolves, matching how the real SDK's first snapshot behaves. Every
// write function below is a no-op that resolves — store.js's persist()
// treats them as fire-and-forget background syncs.

export function initializeFirestore(app, opts) {
  return { app, opts, _stub: true };
}

export function collection(db, path) {
  return { _type: "collection", db, path };
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

// Fires one empty snapshot asynchronously (matching the real SDK's
// async-even-when-cached behavior) then never fires again — good enough
// for initStore()'s "wait for first snapshot of every collection" logic.
export function onSnapshot(ref, onNext, onError) {
  queueMicrotask(() => {
    try {
      if (ref && ref._type === "doc") {
        onNext({ exists: () => false, data: () => undefined });
      } else {
        onNext({ docs: [] });
      }
    } catch (e) {
      if (onError) onError(e);
    }
  });
  return () => {};
}

export async function setDoc() {
  return undefined;
}
export async function updateDoc() {
  return undefined;
}
export async function deleteDoc() {
  return undefined;
}
export function deleteField() {
  return { _delete: true };
}
export function serverTimestamp() {
  return { _serverTimestamp: true };
}

export function writeBatch() {
  return {
    set() {},
    delete() {},
    update() {},
    async commit() {
      return undefined;
    },
  };
}
