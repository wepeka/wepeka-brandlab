// Data layer. Shared mode = the artifact's db (one doc per object, like the planned Firestore
// layout brands/{id}/boards/{boardId}/objects/{objId}); local mode = this browser only.
const Store = (() => {
  let db = null, assets = null, mode = "local", canWrite = true;
  const me = { id: null, name: "Kamu", color: "#ffa52b" };
  const S = { boards: new Map(), boardId: null, objects: new Map(), comments: new Map(),
    labOver: { doc: {}, tasks: new Map(), campaigns: new Map(), content: new Map() }, labVersion: 0, loaded: false, boardsLoaded: false };
  const subs = {};
  const handlers = new Set();
  const emit = (kind, info) => handlers.forEach((fn) => { try { fn(kind, info); } catch (e) { console.error(e); } });
  let LAB = "lab/kopi-tepian";
  const objPath = (id, bid = S.boardId) => `boards/${bid}/objects/${id}`;

  // ---------- write queue: one write at a time per doc, coalesced, max 8 in flight ----------
  const queues = new Map(), waiting = [], pendingLocal = new Map();
  let inflight = 0, lastError = null;
  function status() { emit("status", { busy: inflight > 0 || waiting.length > 0, err: lastError, mode, canWrite }); }
  function write(path, op, data) {
    if (mode !== "db") { saveLocalSoon(); return; }
    if (!canWrite) return;
    let q = queues.get(path);
    if (!q) { q = { running: false, next: null }; queues.set(path, q); }
    const n = q.next;
    if (!n || op === "delete" || op === "set") q.next = { op, data: data && clone(data) };
    else if (n.op === "set") q.next = { op: "set", data: applyPatch(n.data, data) };
    else if (n.op === "update") q.next = { op: "update", data: deepMerge(n.data, data) };
    else q.next = { op, data: clone(data) };
    pump(path);
    status();
  }
  function pump(path) {
    const q = queues.get(path);
    if (!q || q.running || !q.next) return;
    if (inflight >= 8) { if (!waiting.includes(path)) waiting.push(path); return; }
    q.running = true; inflight++;
    const job = q.next; q.next = null;
    run(path, job).catch(async (e) => {
      if (e && (e.code === "unavailable" || e.code === "resource_exhausted")) { await sleep(500 + Math.random() * 900); return run(path, job); }
      throw e;
    }).then(() => { lastError = null; }).catch((e) => onWriteError(e, path, job)).finally(() => {
      inflight--; q.running = false;
      if (q.next) pump(path); else { queues.delete(path); pendingLocal.delete(path); }
      while (inflight < 8 && waiting.length) pump(waiting.shift());
      status();
    });
  }
  function stripNulls(o) { if (!isObj(o)) return o; const r = {}; for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) r[k] = isObj(v) ? stripNulls(v) : v; return r; }
  function run(path, job) {
    const ref = db.doc(path);
    if (job.op === "delete") return ref.delete();
    if (job.op === "set") return ref.set(stripNulls(job.data));
    return ref.update(job.data);
  }
  async function onWriteError(e, path, job) {
    const code = e && e.code;
    console.warn("write failed", path, code, e && e.message);
    if (code === "invalid_argument" && job.op === "update") {
      // the doc may not exist yet (or was deleted by someone else): recreate from local state if we still have it
      const m = /^boards\/([^/]+)\/objects\/([^/]+)$/.exec(path);
      const local = m && m[1] === S.boardId && S.objects.get(m[2]);
      if (local) { try { await db.doc(path).set(stripNulls(local)); return; } catch (e2) { e = e2; } } else return;
    }
    if (e && e.code === "invalid_argument" && /256|size|large|besar/i.test(e.message || "")) { toast("Objek ini terlalu besar untuk disimpan. Coba gambar yang lebih kecil."); return; }
    if (e && e.code === "invalid_argument") { canWrite = false; emit("readonly"); lastError = "Kamu hanya bisa melihat papan ini."; return; }
    if (e && e.code === "quota_exceeded") { lastError = "Penyimpanan penuh"; toast("Penyimpanan papan penuh. Hapus beberapa objek atau papan lama."); return; }
    if (e && e.code === "revoked") { lastError = "Akses berubah"; return; }
    lastError = "Gagal menyimpan"; toast("Ada perubahan yang gagal tersimpan. Coba lagi sebentar.");
  }

  // ---------- local mode ----------
  function saveLocalNow() {
    if (mode !== "local") return;
    LS.set("boards", [...S.boards.values()]);
    if (S.boardId) {
      const ok = LS.set("b:" + S.boardId, { objects: [...S.objects.values()], comments: [...S.comments.values()] });
      if (!ok) toast("Penyimpanan perangkat ini penuh. Hapus gambar besar atau papan lama.");
    }
    LS.set("lab", { doc: S.labOver.doc, tasks: [...S.labOver.tasks.values()], campaigns: [...S.labOver.campaigns.values()], content: [...S.labOver.content.values()] });
    emit("status", { busy: false, mode });
  }
  const saveLocalSoon = debounce(saveLocalNow, 350);
  addEventListener("pagehide", saveLocalNow);

  // ---------- init / subscriptions ----------
  async function init(opts) {
    db = opts.db || null; assets = opts.assets || null;
    if (window.__papanLab) window.__papanLab.onChange(() => { S.labVersion++; emit("lab"); });
    Object.assign(me, opts.me || {});
    if (!me.id) { me.id = LS.get("me") || uid("me-"); LS.set("me", me.id); }
    canWrite = opts.canWrite !== false;
    mode = db ? "db" : "local";
    if (mode === "db") {
      subs.boards = db.collection("boards").onSnapshot((snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") S.boards.delete(ch.doc.id);
          else S.boards.set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id });
        }
        S.boardsLoaded = true;
        emit("boards");
      }, (e) => { console.warn("boards sub", e); fallbackLocal(); });
    } else loadLocal();
    status();
  }
  function fallbackLocal() {
    if (mode === "local") return;
    Object.values(subs).forEach((u) => { try { u(); } catch {} });
    mode = "local"; db = null; loadLocal(); status();
    toast("Papan bersama tidak tersambung. Perubahan disimpan di perangkat ini saja.");
  }
  function loadLocal() {
    for (const b of LS.get("boards", [])) S.boards.set(b.id, b);
    const l = LS.get("lab", null);
    if (l) { S.labOver.doc = l.doc || {}; for (const k of ["tasks", "campaigns", "content"]) for (const x of l[k] || []) S.labOver[k].set(x.id, x); }
    S.boardsLoaded = true; S.labVersion++;
    setTimeout(() => emit("boards"), 0);
  }
  // Example Brandlab data lives next to each board, so everyone on a board sees the same records.
  function subscribeLab(bid) {
    ["lab", "lab_tasks", "lab_campaigns", "lab_content"].forEach((k) => { if (subs[k]) { try { subs[k](); } catch {} delete subs[k]; } });
    LAB = `lab/${bid}`;
    S.labOver = { doc: {}, tasks: new Map(), campaigns: new Map(), content: new Map() }; S.labVersion++;
    subs.lab = db.doc(LAB).onSnapshot((d) => { S.labOver.doc = d.exists ? d.data() : {}; S.labVersion++; emit("lab"); }, () => {});
    for (const k of ["tasks", "campaigns", "content"]) {
      subs["lab_" + k] = db.collection(`${LAB}/${k}`).onSnapshot((snap) => {
        for (const ch of snap.docChanges()) { if (ch.type === "removed") S.labOver[k].delete(ch.doc.id); else S.labOver[k].set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id }); }
        S.labVersion++; emit("lab");
      }, () => {});
    }
  }
  function closeBoardSubs() { ["objects", "comments"].forEach((k) => { if (subs[k]) { try { subs[k](); } catch {} delete subs[k]; } }); }
  function openBoard(id) {
    if (S.boardId === id && S.loaded) return;
    if (mode === "local" && S.boardId && S.loaded) saveLocalNow(); // flush before the board switches under the debounce
    closeBoardSubs();
    S.boardId = id; S.objects.clear(); S.comments.clear(); S.loaded = false;
    LS.set("lastBoard", id);
    emit("board-open", { id });
    if (mode === "db") {
      if (!window.__papanLab) subscribeLab(id);
      subs.objects = db.collection(`boards/${id}/objects`).onSnapshot((snap) => {
        if (S.boardId !== id) return;
        const ids = new Set();
        for (const ch of snap.docChanges()) {
          const oid = ch.doc.id; ids.add(oid);
          if (ch.type === "removed") { S.objects.delete(oid); continue; }
          let o = { ...ch.doc.data(), id: oid };
          const pl = pendingLocal.get(objPath(oid, id));
          if (pl) o = applyPatch(o, pl);
          S.objects.set(oid, o);
        }
        const first = !S.loaded; S.loaded = true;
        emit("objects", { ids, remote: true, first });
      }, (e) => { console.warn("objects sub", e); if (e.code !== "revoked") toast("Sinkron papan terputus. Muat ulang halaman untuk menyambung lagi."); });
      subs.comments = db.collection(`boards/${id}/comments`).onSnapshot((snap) => {
        if (S.boardId !== id) return;
        for (const ch of snap.docChanges()) { if (ch.type === "removed") S.comments.delete(ch.doc.id); else S.comments.set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id }); }
        emit("comments");
      }, () => {});
    } else {
      const d = LS.get("b:" + id, { objects: [], comments: [] });
      for (const o of d.objects || []) S.objects.set(o.id, o);
      for (const c of d.comments || []) S.comments.set(c.id, c);
      S.loaded = true;
      setTimeout(() => { emit("objects", { ids: new Set(S.objects.keys()), first: true }); emit("comments"); }, 0);
    }
  }

  // ---------- objects ----------
  let lastTouch = 0;
  function touchBoard() {
    const now = Date.now();
    if (now - lastTouch < 30000) return;
    lastTouch = now;
    updateBoard({ updatedAt: now, updatedBy: me.id });
  }
  function commit(changes) {
    const ids = new Set();
    for (const ch of changes) {
      const { id, before, after } = ch;
      const path = objPath(id);
      if (after == null) {
        if (!S.objects.has(id) && before == null) continue;
        S.objects.delete(id); write(path, "delete");
      } else if (before == null || !S.objects.has(id)) {
        const o = { ...after, id, updatedBy: me.id, updatedAt: Date.now() };
        S.objects.set(id, o); write(path, "set", o);
      } else {
        const patch = diffPatch(before, after);
        if (!Object.keys(patch).length) continue;
        patch.updatedBy = me.id; patch.updatedAt = Date.now();
        const cur = S.objects.get(id);
        S.objects.set(id, applyPatch(cur, patch));
        pendingLocal.set(path, deepMerge(pendingLocal.get(path) || {}, patch));
        write(path, "update", patch);
      }
      ids.add(id);
    }
    if (ids.size) { touchBoard(); emit("objects", { ids, local: true }); }
    return ids;
  }
  // Patch without undo (votes, reactions, checkbox ticks inside widgets).
  function patchObj(id, patch) {
    const cur = S.objects.get(id); if (!cur) return;
    const p = { ...patch, updatedBy: me.id, updatedAt: Date.now() };
    S.objects.set(id, applyPatch(cur, p));
    const path = objPath(id);
    pendingLocal.set(path, deepMerge(pendingLocal.get(path) || {}, p));
    write(path, "update", p);
    emit("objects", { ids: new Set([id]), local: true });
  }
  function newObject(o) {
    const n = Date.now();
    return { z: nextZ(o.type), color: "yellow", text: "", ...o, id: o.id || uid("o"), createdBy: me.id, createdAt: n, updatedBy: me.id, updatedAt: n };
  }
  function nextZ(type) {
    let m = 0; for (const o of S.objects.values()) if ((o.type === "frame") === (type === "frame")) m = Math.max(m, o.z || 0);
    return m + 1;
  }

  // ---------- boards ----------
  function boards() { return [...S.boards.values()].filter((b) => !b.deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
  function board() { return S.boards.get(S.boardId) || null; }
  function updateBoard(patch, id = S.boardId) {
    if (!id) return;
    const cur = S.boards.get(id) || { id };
    S.boards.set(id, applyPatch(cur, patch));
    write(`boards/${id}`, S.boards.has(id) && cur.createdAt ? "update" : "set", S.boards.has(id) && cur.createdAt ? patch : S.boards.get(id));
    emit("boards");
  }
  async function createBoard({ name, objects = [], comments = [], kind = "blank", id, meta: extra = {} }) {
    const bid = id || uid("b");
    if (mode === "local" && S.boardId && S.loaded) saveLocalNow();
    const n = Date.now();
    const meta = { id: bid, name, kind, createdAt: n, createdBy: me.id, updatedAt: n, updatedBy: me.id, voting: { active: false, round: 0, per: 3 }, ...extra };
    S.boards.set(bid, meta);
    write(`boards/${bid}`, "set", meta);
    emit("boards");
    const prev = S.boardId;
    S.boardId = bid; // so objPath targets the new board
    for (const o of objects) write(objPath(o.id, bid), "set", o);
    for (const c of comments) write(`boards/${bid}/comments/${c.id}`, "set", c);
    if (mode === "local") LS.set("b:" + bid, { objects, comments });
    S.boardId = prev;
    openBoard(bid);
    if (mode === "db") { for (const o of objects) S.objects.set(o.id, o); for (const c of comments) S.comments.set(c.id, c); S.loaded = true; emit("objects", { ids: new Set(objects.map((o) => o.id)), first: true }); emit("comments"); }
    return bid;
  }
  async function deleteBoard(id) {
    const b = S.boards.get(id); if (!b) return;
    if (mode === "db" && db.cascadeDelete) write(`boards/${id}`, "delete"); // the web host removes the whole board in one go
    else if (mode === "db") {
      try {
        const objs = await db.collection(`boards/${id}/objects`).get();
        for (const d of objs.docs) write(`boards/${id}/objects/${d.id}`, "delete");
        const cm = await db.collection(`boards/${id}/comments`).get();
        for (const d of cm.docs) write(`boards/${id}/comments/${d.id}`, "delete");
      } catch {}
      write(`boards/${id}`, "delete");
    } else LS.del("b:" + id);
    S.boards.delete(id);
    emit("boards");
  }

  // ---------- comments ----------
  function addComment(c) {
    const cm = { id: uid("c"), by: me.id, at: Date.now(), resolved: false, internal: false, parent: null, ...c };
    S.comments.set(cm.id, cm);
    write(`boards/${S.boardId}/comments/${cm.id}`, "set", cm);
    emit("comments");
    return cm;
  }
  function updateComment(id, patch) {
    const c = S.comments.get(id); if (!c) return;
    S.comments.set(id, { ...c, ...patch });
    write(`boards/${S.boardId}/comments/${id}`, "update", patch);
    emit("comments");
  }
  function deleteComment(id) {
    for (const c of [...S.comments.values()]) if (c.id === id || c.parent === id) { S.comments.delete(c.id); write(`boards/${S.boardId}/comments/${c.id}`, "delete"); }
    emit("comments");
  }

  // ---------- Brandlab (example) data ----------
  let labCache = null;
  function lab() {
    if (window.__papanLab) { if (!labCache || labCache.v !== S.labVersion) labCache = { v: S.labVersion, data: window.__papanLab.get() }; return labCache.data; }
    if (labCache && labCache.v === S.labVersion) return labCache.data;
    const base = clone(LAB_BASE);
    const d = S.labOver.doc || {};
    if (d.dna) base.dna = { ...base.dna, ...d.dna };
    for (const k of ["tasks", "campaigns", "content"]) {
      const m = new Map(base[k].map((x) => [x.id, x]));
      for (const [id, x] of S.labOver[k]) { if (x.deleted) m.delete(id); else m.set(id, { ...(m.get(id) || {}), ...x, id }); }
      base[k] = [...m.values()].sort((a, b) => String(a.due || a.date || a.start || "").localeCompare(String(b.due || b.date || b.start || "")));
    }
    labCache = { v: S.labVersion, data: base };
    return base;
  }
  function labSave(kind, item) {
    if (window.__papanLab) { const r = window.__papanLab.save(kind, item); S.labVersion++; emit("lab"); return r || item; }
    const full = { ...(lab()[kind].find((x) => x.id === item.id) || {}), ...item };
    S.labOver[kind].set(full.id, full); S.labVersion++;
    write(`${LAB}/${kind}/${full.id}`, "set", full);
    emit("lab");
    return full;
  }
  function labDoc(patch) {
    if (window.__papanLab) return;
    S.labOver.doc = deepMerge(S.labOver.doc || {}, patch); S.labVersion++;
    write(LAB, "set", S.labOver.doc);
    emit("lab");
  }

  // ---------- versions, recaps, deck ----------
  function snapshotObjects() {
    let objs = [...S.objects.values()].map((o) => clone(o));
    let size = JSON.stringify(objs).length;
    if (size > 230000 || window.__papanWeb) objs = objs.map((o) => (o.type === "image" && String(o.data?.src || "").startsWith("data:") ? { ...o, data: { ...o.data, src: "", dropped: true } } : o));
    return objs;
  }
  async function listColl(name, n = 30) {
    if (mode === "db") {
      try { const s = await db.collection(`boards/${S.boardId}/${name}`).orderBy("at", "desc").limit(n).get(); return s.docs.map((d) => ({ ...d.data(), id: d.id })); }
      catch { return []; }
    }
    return LS.get(`${name}:${S.boardId}`, []);
  }
  async function saveColl(name, item, keep = 30) {
    const it = { id: uid(name[0]), at: Date.now(), by: me.id, ...item };
    if (mode === "db") {
      await db.doc(`boards/${S.boardId}/${name}/${it.id}`).set(stripNulls(it));
      if (name === "versions") {
        const all = await listColl("versions", 60);
        all.slice(keep).forEach((v) => db.doc(`boards/${S.boardId}/versions/${v.id}`).delete().catch(() => {}));
      }
    } else {
      const arr = [it, ...LS.get(`${name}:${S.boardId}`, [])].slice(0, keep);
      if (!LS.set(`${name}:${S.boardId}`, arr)) LS.set(`${name}:${S.boardId}`, arr.slice(0, 5));
    }
    return it;
  }
  async function deleteFrom(name, id) {
    if (mode === "db") await db.doc(`boards/${S.boardId}/${name}/${id}`).delete().catch(() => {});
    else LS.set(`${name}:${S.boardId}`, LS.get(`${name}:${S.boardId}`, []).filter((x) => x.id !== id));
  }
  async function getDeck() {
    if (mode === "db") { try { const d = await db.doc(`boards/${S.boardId}/decks/main`).get(); return d.exists ? d.data() : null; } catch { return null; } }
    return LS.get("deck:" + S.boardId, null);
  }
  function saveDeck(deck) {
    const d = { ...deck, at: Date.now(), by: me.id };
    if (mode === "db") write(`boards/${S.boardId}/decks/main`, "set", d);
    else LS.set("deck:" + S.boardId, d);
  }

  // ---------- images ----------
  async function uploadImage(blob, small) {
    if (assets) {
      try { const r = await assets.upload(blob); return { src: r.url, assetId: r.id }; }
      catch (e) { console.warn("asset upload failed", e && e.code); }
    }
    return { src: await blobToDataURL(small || blob) };
  }
  const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

  return {
    S, me, on: (fn) => handlers.add(fn), emit, init, openBoard, boards, board, updateBoard, createBoard, deleteBoard,
    obj: (id) => S.objects.get(id), objects: () => [...S.objects.values()], commit, patchObj, newObject, nextZ,
    comments: () => [...S.comments.values()], addComment, updateComment, deleteComment,
    lab, labSave, labDoc, snapshotObjects, listColl, saveColl, deleteFrom, getDeck, saveDeck, uploadImage,
    get mode() { return mode; }, get canWrite() { return canWrite; }, set canWrite(v) { canWrite = v; }, get hasAssets() { return !!assets; },
  };
})();

// Undo/redo of the viewer's own actions. Undo only reverts the fields that action changed,
// so a teammate's vote or edit to other fields survives.
const History = (() => {
  const undo = [], redo = [];
  function push(changes, label) {
    if (!changes || !changes.length) return;
    undo.push({ changes: clone(changes), label }); if (undo.length > 120) undo.shift();
    redo.length = 0;
    Store.emit("history");
  }
  function revert(entry, dir) {
    const out = [];
    for (const ch of entry.changes) {
      const from = dir === "undo" ? ch.after : ch.before, to = dir === "undo" ? ch.before : ch.after;
      const cur = Store.obj(ch.id);
      if (to == null) out.push({ id: ch.id, before: cur || from, after: null });
      else if (from == null || !cur) out.push({ id: ch.id, before: null, after: to });
      else {
        const keys = Object.keys(diffPatch(from, to));
        const target = { ...cur };
        for (const k of keys) { if (to[k] === undefined) delete target[k]; else target[k] = clone(to[k]); }
        out.push({ id: ch.id, before: cur, after: target });
      }
    }
    Store.commit(out);
    return out;
  }
  return {
    push,
    undo() { const e = undo.pop(); if (!e) return toast("Belum ada yang bisa dibatalkan"); revert(e, "undo"); redo.push(e); Store.emit("history"); Store.emit("selection-check"); },
    redo() { const e = redo.pop(); if (!e) return; revert(e, "redo"); undo.push(e); Store.emit("history"); },
    get canUndo() { return undo.length > 0; }, get canRedo() { return redo.length > 0; },
  };
})();
