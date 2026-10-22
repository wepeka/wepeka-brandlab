// Guest host (papan/build.mjs puts it before host-brandlab.js, which calls
// papanGuestHost when /papan/ is opened on its own with ?tamu=…).
//
// A board's guest link is /papan/?tamu=<brandId>.<boardId>.<secret>
// (api/papan.js, "Link tamu" in the board's Bagikan dialog). The guest types a
// name, the server hands back a sign-in for this one board, and this file
// gives the canvas the same window.claude.use() adapters js/papan/bridge.js
// gives the team, minus what guests don't get: brand data, AI, other boards.
// It keeps its own Firebase app ("papan-guest", in-memory sign-in) so a
// guest session never mixes with a Brandlab sign-in in the same browser.

// Unduhan (PNG, PPTX, PDF) the same way for the team and for guests.
const papanDownloads = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return { status: "saved" };
  },
};

function papanGuestHost(param) {
  const [brandId, boardId, secret] = String(param || "").split(".");
  window.__papanHost = "brandlab";
  window.__papanGuest = true;
  window.__papanNS = `tamu-${brandId}`;
  document.documentElement.classList.add("host-brandlab", "papan-guest");
  window.__papanTheme = () => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.dataset.resolved = "dark";
  };
  window.__papanTheme();

  // Brand components show nothing to guests (07-render.js); the chip shows the
  // brand's name once the server has said which brand this is.
  const lab = {
    brandlab: true, guest: true, brand: { id: brandId, name: "", tagline: "", color: "" },
    dna: { empty: true }, book: { colors: [], fonts: {}, logo: "", voice: "", tone: { do: [], dont: [] }, avoid: [] },
    campaigns: [], content: [], contentStatuses: [], contentStatusLabels: {}, tasks: [], milestones: [], goals: [],
    growth: null, sales: null, people: [], objectives: [],
  };
  const labListeners = new Set();
  window.__papanLab = { get: () => lab, save: () => null, onChange: (fn) => { labListeners.add(fn); return () => labListeners.delete(fn); } };
  window.__papanBrandContext = () => "";
  window.__papanGo = () => {};

  let resolveReady, closed = false;
  const ready = new Promise((r) => (resolveReady = r));
  window.claude = { use: async (name) => ((await ready) || {})[name] || null };

  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const OK = /^[A-Za-z0-9_-]{20,64}$/;
  let key = ls.get("papan:guest:key");
  if (!OK.test(key)) {
    const b = crypto.getRandomValues(new Uint8Array(24));
    key = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    ls.set("papan:guest:key", key);
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ERR = {
    "link-off": "Link ini sudah tidak aktif. Minta link baru ke orang yang membagikannya.",
    "not-found": "Papan ini tidak ditemukan. Mungkin sudah dihapus.",
    "owner-inactive": "Papan ini sedang tidak bisa dibuka. Hubungi orang yang membagikannya.",
    "bad-request": "Tulis namamu dulu.",
    "closed": "Pemilik papan baru saja menutup link ini. Minta link baru kalau masih mau ikut.",
  };
  function gate(message) {
    let el = document.querySelector(".guest-gate");
    if (!el) { el = document.createElement("div"); el.className = "guest-gate"; document.body.appendChild(el); }
    const broken = !brandId || !boardId || !OK.test(secret || "");
    el.innerHTML = `<div class="guest-card" role="dialog" aria-modal="true" aria-labelledby="ggT">
      <div class="gk">Wepeka Brandlab · Papan</div>
      <h1 id="ggT">${broken ? "Link papan tidak lengkap" : "Kamu diajak ke sebuah papan"}</h1>
      <p class="muted">${broken ? "Salin ulang link dari pesan yang kamu terima, lalu buka lagi." : "Tulis namamu supaya yang lain tahu siapa yang sedang ikut mencoret-coret."}</p>
      ${broken ? "" : `<form id="ggForm" novalidate><label class="lbl" for="ggName">Nama kamu</label><input class="field" id="ggName" maxlength="40" autocomplete="name" value="${esc(ls.get("papan:guest:name"))}"><button class="btn btn-primary" type="submit" id="ggGo">Masuk ke papan</button></form>`}
      ${message ? `<p class="gerr" role="alert">${esc(message)}</p>` : ""}
      <p class="gfoot">Tanpa akun. Papan ini milik sebuah brand di Brandlab.</p></div>`;
    const f = el.querySelector("#ggForm");
    if (!f) return;
    const input = el.querySelector("#ggName");
    setTimeout(() => input.focus(), 50);
    f.onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return gate(ERR["bad-request"]);
      // Shut out mid-session (the link was closed): start the page over and
      // join straight away with this name.
      if (closed) { ls.set("papan:guest:name", name); try { sessionStorage.setItem("papan:guest:auto", "1"); } catch {} location.reload(); return; }
      el.querySelector("#ggGo").disabled = true;
      el.querySelector("#ggGo").textContent = "Membuka papan…";
      enter(name).then(() => el.remove(), (err) => gate(ERR[err?.code] || "Gagal tersambung. Periksa internetmu lalu coba lagi."));
    };
  }

  async function enter(name) {
    const res = await fetch("/api/papan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", brandId, boardId, t: secret, name, key }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: out.error || "unknown" };
    ls.set("papan:guest:name", name);

    const V = "12.18.0", sdk = (m) => import(`https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`);
    // Local testing on the Firebase emulators: the app's own switch (js/emulator.js).
    let emu = null;
    if (["localhost", "127.0.0.1"].includes(location.hostname)) { try { const m = await import("/js/emulator.js"); if (m.IS_EMULATOR) emu = m; } catch {} }
    const [{ initializeApp }, A, F, D] = await Promise.all([sdk("app"), sdk("auth"), sdk("firestore"), sdk("database")]);
    const config = emu ? emu.EMULATOR_CONFIG : {
      apiKey: "AIzaSyDcApVGM0CyxfcTERsrwr7CK07YWlQT_vI",
      authDomain: "wepeka-ba996.firebaseapp.com",
      projectId: "wepeka-ba996",
      storageBucket: "wepeka-ba996.firebasestorage.app",
      messagingSenderId: "494668744644",
      appId: "1:494668744644:web:e4bdc9aea34800849f0691",
    };
    const app = initializeApp(config, "papan-guest");
    const auth = A.initializeAuth(app, { persistence: A.inMemoryPersistence });
    if (emu) A.connectAuthEmulator(auth, emu.EMULATOR_AUTH_URL, { disableWarnings: true });
    await A.signInWithCustomToken(auth, out.token);
    const fdb = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true, localCache: F.memoryLocalCache() });
    if (emu) F.connectFirestoreEmulator(fdb, emu.EMULATOR_FIRESTORE.host, emu.EMULATOR_FIRESTORE.port);
    const rdb = D.getDatabase(app, emu ? emu.EMULATOR_DATABASE.url : "https://wepeka-ba996-default-rtdb.asia-southeast1.firebasedatabase.app");
    if (emu) D.connectDatabaseEmulator(rdb, emu.EMULATOR_DATABASE.host, emu.EMULATOR_DATABASE.port);

    const uid = out.uid, canEdit = out.role === "edit";
    lab.brand = { id: brandId, name: out.brand?.name || "", tagline: "", color: out.brand?.color || "" };
    lab.people = Object.values(out.people || {});
    labListeners.forEach((f) => { try { f(); } catch {} });
    const chip = document.querySelector(".brand-chip");
    if (chip) chip.innerHTML = `<span class="bn">${esc(lab.brand.name)}</span><span class="guest-chip">Tamu</span>`;
    window.__papanCanWrite = () => canEdit;

    // The team turns the link off or makes a new one: this guest is out at
    // once (the rules refuse the next read). "Lihat saja" ↔ "coret-coret"
    // takes effect without reloading.
    const hooks = {
      denied() {
        if (closed) return; closed = true;
        try { auth.signOut(); } catch {}
        gate(ERR.closed);
      },
      share(sh) {
        const edit = sh?.role === "edit";
        if (typeof Store === "undefined" || Store.canWrite === edit) return;
        Store.canWrite = edit;
        window.__papanCanWrite = () => edit;
        document.body.classList.toggle("ro", !edit);
        try { UI.updateBanner(); } catch {}
        if (typeof toast === "function") toast(edit ? "Kamu sekarang bisa ikut coret-coret" : "Pemilik papan mengubah aksesmu jadi lihat saja");
      },
    };
    resolveReady({
      db: guestDb(F, fdb, brandId, boardId, out.ownerId, hooks),
      user: guestUser(F, fdb, brandId, boardId, uid, name, canEdit, out.people || {}),
      room: guestRoom(D, rdb, brandId, uid),
      sample: null,
      downloads: papanDownloads,
      assets: null,
    });
  }

  let auto = false;
  try { auto = sessionStorage.getItem("papan:guest:auto") === "1"; sessionStorage.removeItem("papan:guest:auto"); } catch {}
  const start = () => { gate(); if (auto && ls.get("papan:guest:name")) document.querySelector("#ggForm")?.requestSubmit(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

// ---------- guest adapters: js/papan/bridge.js's, for one board ----------
const papanCodec = (() => {
  const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const encode = (v) => (Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? { _a: encode(x) } : encode(x))) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) : v);
  const decode = (v) => (Array.isArray(v) ? v.map((x) => (isPlain(x) && Object.keys(x).length === 1 && Array.isArray(x._a) ? decode(x._a) : decode(x))) : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)])) : v);
  const clean = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return { isPlain, encode, decode, clean };
})();

function guestDb(F, fdb, brandId, boardId, ownerId, hooks) {
  const { isPlain, encode, decode, clean } = papanCodec;
  const base = `brands/${brandId}/`;
  const STAMPS = ["ownerId", "brandId", "boardId"];
  const unstamp = (d) => { if (!d) return d; const o = { ...d }; STAMPS.forEach((k) => delete o[k]); return decode(o); };
  const meta = (m) => ({ fromCache: m.fromCache, hasPendingWrites: m.hasPendingWrites });
  const snapDoc = (s) => ({ id: s.id, exists: s.exists(), data: () => (s.exists() ? unstamp(s.data()) : undefined), metadata: meta(s.metadata) });
  const snapQuery = (s) => ({ docs: s.docs.map(snapDoc), size: s.size, empty: s.empty, docChanges: () => s.docChanges().map((c) => ({ type: c.type, doc: snapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })), metadata: meta(s.metadata) });
  const err = (e) => ({ code: e?.code === "permission-denied" ? "permission_denied" : "unavailable", message: String(e?.message || e) });
  const onErr = (cb) => (e) => { if (e?.code === "permission-denied") hooks.denied(); cb && cb(err(e)); };
  function toUpdates(patch, prefix = [], out = []) {
    for (const [k, v] of Object.entries(patch)) {
      const p = [...prefix, k];
      if (isPlain(v) && Object.keys(v).length) toUpdates(v, p, out);
      else out.push(new F.FieldPath(...p), v === null ? F.deleteField() : encode(v));
    }
    return out;
  }
  function docRef(path) {
    const ref = () => F.doc(fdb, base + path);
    return {
      id: path.split("/").pop(), path,
      async get() { try { return snapDoc(await F.getDoc(ref())); } catch (e) { throw err(e); } },
      async set(data) { try { await F.setDoc(ref(), { ...encode(clean(data) || {}), ownerId, brandId, boardId }); } catch (e) { throw err(e); } },
      async update(patch) {
        const p = clean(patch) || {}; STAMPS.forEach((k) => delete p[k]);
        const args = toUpdates(p); if (!args.length) return;
        try { await F.updateDoc(ref(), ...args); } catch (e) { throw err(e); }
      },
      async delete() { try { await F.deleteDoc(ref()); } catch (e) { throw err(e); } },
      onSnapshot(next, fail) { return F.onSnapshot(ref(), (s) => next(snapDoc(s)), onErr(fail)); },
      collection: (sub) => collRef(`${path}/${sub}`),
    };
  }
  function collRef(path, q = {}) {
    // The board list a guest sees is this one board.
    if (path === "boards") {
      const one = (d, type) => ({ docs: d.exists ? [d] : [], size: d.exists ? 1 : 0, empty: !d.exists, docChanges: () => (type ? [{ type, doc: d, oldIndex: -1, newIndex: 0 }] : []), metadata: d.metadata });
      return {
        path, doc: (id) => docRef(`boards/${id}`), where: () => collRef(path), orderBy: () => collRef(path), limit: () => collRef(path),
        async get() { return one(await docRef(`boards/${boardId}`).get(), null); },
        onSnapshot(next, fail) {
          let had = false;
          return docRef(`boards/${boardId}`).onSnapshot((d) => {
            const type = d.exists ? (had ? "modified" : "added") : had ? "removed" : null; had = d.exists;
            next(one(d, type));
            if (d.exists) hooks.share(d.data().share);
          }, fail);
        },
      };
    }
    const api = {
      path,
      doc: (id) => docRef(`${path}/${id || Math.random().toString(36).slice(2, 12)}`),
      async add(data) { const d = api.doc(); await d.set(data); return d; },
      where: () => api,
      orderBy: (field, dir = "asc") => collRef(path, { ...q, field, dir }),
      limit: (n) => collRef(path, { ...q, n }),
      build() {
        const c = F.collection(fdb, base + path), parts = [];
        if (q.field) parts.push(F.orderBy(q.field, q.dir));
        if (q.n) parts.push(F.limit(q.n));
        return parts.length ? F.query(c, ...parts) : c;
      },
      async get() { try { return snapQuery(await F.getDocs(api.build())); } catch (e) { throw err(e); } },
      onSnapshot(next, fail) { return F.onSnapshot(api.build(), (s) => next(snapQuery(s)), onErr(fail)); },
    };
    return api;
  }
  return { doc: docRef, collection: (p) => collRef(p), cascadeDelete: true };
}

function guestUser(F, fdb, brandId, boardId, uid, name, canEdit, people) {
  const names = new Map();
  const guestName = (id) => {
    if (!names.has(id)) names.set(id, F.getDoc(F.doc(fdb, `brands/${brandId}/boards/${boardId}/guests/${id}`)).then((s) => (s.exists() ? String(s.data().name || "") : ""), () => ""));
    return names.get(id);
  };
  return {
    id: async () => uid,
    me: async () => ({ id: uid, name, avatarUrl: "", color: null, email: "", isOwner: false, canEdit }),
    name: async () => name,
    isOwner: async () => false,
    canEdit: async () => canEdit,
    can: async () => canEdit,
    async profiles(ids) {
      const out = {};
      for (const id of [].concat(ids || [])) {
        const guest = String(id).startsWith("pg-");
        const n = id === uid ? name : guest ? `${(await guestName(id)) || "Tamu"} (tamu)` : people[id] || "";
        out[id] = { id, name: n, avatarUrl: "", color: null, email: null, isMe: id === uid, guest };
      }
      return out;
    },
    search: async () => [],
  };
}

function guestRoom(D, rdb, brandId, uid) {
  const clean = papanCodec.clean;
  let mine = {}, board = null, peers = Object.freeze([]), offset = 0, connected = false;
  let nodeRef = null, unBoard = null, unEvents = null, flushT = null;
  const peerHandlers = new Set(), topicHandlers = new Map(), connHandlers = new Set();
  D.onValue(D.ref(rdb, ".info/serverTimeOffset"), (s) => (offset = s.val() || 0));
  D.onValue(D.ref(rdb, ".info/connected"), (s) => {
    connected = !!s.val(); connHandlers.forEach((f) => f(connected));
    if (connected && nodeRef) { D.onDisconnect(nodeRef).remove().catch(() => {}); writeNow(); }
  });
  const writeNow = () => { flushT = null; if (nodeRef) D.set(nodeRef, { by: uid, p: clean(mine), at: D.serverTimestamp() }).catch(() => {}); };
  const schedule = () => { if (!flushT) flushT = setTimeout(writeNow, 90); };
  const emitPeers = (joined, left, updated) => { const c = { peers, joined, left, updated }; peerHandlers.forEach((f) => f(c)); };
  function switchBoard(b) {
    if (nodeRef) { D.onDisconnect(nodeRef).cancel().catch(() => {}); D.remove(nodeRef).catch(() => {}); }
    unBoard && unBoard(); unEvents && unEvents(); unBoard = unEvents = null;
    const left = peers; peers = Object.freeze([]); board = b; nodeRef = null;
    if (left.length) emitPeers([], left, []);
    if (!b) return;
    nodeRef = D.ref(rdb, `papanLive/${brandId}/${b}/peers/${uid}`);
    D.onDisconnect(nodeRef).remove().catch(() => {});
    let prev = new Map();
    unBoard = D.onValue(D.ref(rdb, `papanLive/${brandId}/${b}/peers`), (s) => {
      const val = s.val() || {}, list = [], joined = [], updated = [], gone = [];
      for (const [k, v] of Object.entries(val)) {
        const old = prev.get(k), pj = JSON.stringify(v.p || {});
        const peer = old && old._pj === pj ? old : Object.freeze({ peer: k, by: v.by || k, isMe: k === uid, sameTab: k === uid, kind: "viewer", guest: String(k).startsWith("pg-"), presence: Object.freeze(v.p || {}), updatedAt: Date.now(), _pj: pj });
        list.push(peer); if (!old) joined.push(peer); else if (old !== peer) updated.push(peer);
      }
      const cur = new Map(list.map((p) => [p.peer, p]));
      for (const [k, p] of prev) if (!cur.has(k)) gone.push(p);
      prev = cur; peers = Object.freeze(list);
      emitPeers(joined, gone, updated);
    }, () => {});
    unEvents = D.onChildAdded(D.query(D.ref(rdb, `papanLive/${brandId}/${b}/events`), D.orderByChild("at"), D.startAt(Date.now() + offset - 1500)), (c) => {
      const v = c.val(); if (!v) return;
      const msg = { topic: v.topic, data: v.data, peer: v.by, by: v.by, isMe: v.by === uid, sameTab: v.by === uid, kind: "viewer", guest: String(v.by).startsWith("pg-") };
      (topicHandlers.get(v.topic) || []).forEach((f) => { try { f(msg); } catch (e) { console.error(e); } });
    });
    writeNow();
  }
  return {
    presence(patch) {
      for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete mine[k]; else mine[k] = v; }
      if ("b" in patch && (patch.b || null) !== board) switchBoard(patch.b || null); else schedule();
      return Promise.resolve();
    },
    peers: () => peers,
    onPeers(fn) { peerHandlers.add(fn); setTimeout(() => fn({ peers, joined: peers, left: [], updated: [] }), 0); return () => peerHandlers.delete(fn); },
    on(topic, fn) { if (!topicHandlers.has(topic)) topicHandlers.set(topic, []); topicHandlers.get(topic).push(fn); return () => { const a = topicHandlers.get(topic); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; },
    async emit(topic, data) {
      if (!board) return;
      const r = D.push(D.ref(rdb, `papanLive/${brandId}/${board}/events`));
      await D.set(r, { topic, data: clean(data ?? null), by: uid, at: D.serverTimestamp() });
      setTimeout(() => D.remove(r).catch(() => {}), 20000);
    },
    connected: () => connected,
    refresh() { if (board) switchBoard(board); },
    onConnection(fn) { connHandlers.add(fn); setTimeout(() => fn(connected), 0); return () => connHandlers.delete(fn); },
    async canSendToClaudeSession() { return "off"; },
    close() { switchBoard(null); },
  };
}
