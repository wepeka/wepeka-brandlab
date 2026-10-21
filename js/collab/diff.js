// Kerja Tim: what changed between two versions of a brand section, so a
// save writes only that — and a teammate's save of another part of the
// same section survives. Pure functions, no Firebase (tests/collab.test.mjs).
//
// leafDiff(base, next) → [{ path: ["brandDNA", "mission"], value } | { path, delete: true }]
//   Plain objects are walked; arrays, strings, numbers… are leaves (an
//   array is replaced whole — id-keyed lists go through listEdit instead).
// applyPaths(obj, changes) → a copy of obj with the changes in.
// merge3(local, base, remote) → for every leaf the local copy still has as
//   it was (== base), the remote value; what was changed locally stays.
// listEdit(before, after) / applyListEdit(list, edit): id-keyed lists
//   (ideas, goals, notes, Memori Brand) as what was added, changed and
//   removed, applied on top of another copy of the list.
export const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const same = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export function leafDiff(base, next, path = []) {
  if (isPlainObject(base) && isPlainObject(next)) {
    const out = [];
    for (const k of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!(k in next) || next[k] === undefined) {
        if (k in base && base[k] !== undefined) out.push({ path: [...path, k], delete: true });
        continue;
      }
      out.push(...leafDiff(base[k], next[k], [...path, k]));
    }
    return out;
  }
  return same(base, next) ? [] : [{ path, value: next }];
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export function applyPaths(obj, changes) {
  const root = isPlainObject(obj) ? clone(obj) : {};
  for (const c of changes) {
    if (!c.path.length) continue;
    let node = root;
    for (const k of c.path.slice(0, -1)) {
      if (!isPlainObject(node[k])) node[k] = {};
      node = node[k];
    }
    const last = c.path[c.path.length - 1];
    if (c.delete) delete node[last];
    else node[last] = clone(c.value);
  }
  return root;
}

export function merge3(local, base, remote) {
  if (isPlainObject(local) && isPlainObject(base) && isPlainObject(remote)) {
    const out = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(remote)])) {
      const m = merge3(local[k], base[k], remote[k]);
      if (m !== undefined) out[k] = m;
    }
    return out;
  }
  // Untouched here → take theirs; touched here → keep ours.
  return same(local, base) ? remote : local;
}

const idOf = (x) => (x && typeof x === "object" && (typeof x.id === "string" || typeof x.id === "number") ? String(x.id) : null);
// null when the lists aren't id-keyed (an item without an id, or a repeated id).
export function listEdit(before = [], after = []) {
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  const bIds = b.map(idOf);
  const aIds = a.map(idOf);
  if (bIds.includes(null) || aIds.includes(null) || new Set(bIds).size !== bIds.length || new Set(aIds).size !== aIds.length) return null;
  const bMap = new Map(b.map((x) => [idOf(x), x]));
  const aSet = new Set(aIds);
  const added = [];
  const changed = [];
  a.forEach((x, index) => {
    const id = idOf(x);
    if (!bMap.has(id)) added.push({ index, item: x });
    else if (!same(bMap.get(id), x)) changed.push(x);
  });
  const removed = bIds.filter((id) => !aSet.has(id));
  return { added, changed, removed, empty: !added.length && !changed.length && !removed.length };
}
export function applyListEdit(list = [], edit) {
  const out = (Array.isArray(list) ? list : []).filter((x) => !edit.removed.includes(idOf(x)));
  const changedById = new Map(edit.changed.map((x) => [idOf(x), x]));
  for (let i = 0; i < out.length; i++) {
    const id = idOf(out[i]);
    if (changedById.has(id)) {
      out[i] = changedById.get(id);
      changedById.delete(id);
    }
  }
  // A changed item someone else had removed comes back: the edit is newer.
  changedById.forEach((x) => out.push(x));
  for (const { index, item } of edit.added) {
    if (out.some((x) => idOf(x) === idOf(item))) continue;
    out.splice(Math.min(index, out.length), 0, item);
  }
  return out;
}
