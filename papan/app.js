"use strict";
/* ---- guest.js ---- */
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
    "bad-request": "Link papan ini tidak lengkap. Salin ulang dari pesan yang kamu terima.",
    "closed": "Pemilik papan baru saja menutup link ini. Minta link baru kalau masih mau ikut.",
  };
  // Shown only when going straight in didn't work (or the link was closed
  // mid-session): what happened, and a way to try again with a name.
  function gate(message) {
    let el = document.querySelector(".guest-gate");
    if (!el) { el = document.createElement("div"); el.className = "guest-gate"; document.body.appendChild(el); }
    const broken = !brandId || !boardId || !OK.test(secret || "");
    el.innerHTML = `<div class="guest-card" role="dialog" aria-modal="true" aria-labelledby="ggT">
      <div class="gk">Wepeka Brandlab · Papan</div>
      <h1 id="ggT">${broken ? "Link papan tidak lengkap" : "Kamu diajak ke sebuah papan"}</h1>
      <p class="muted">${broken ? "Salin ulang link dari pesan yang kamu terima, lalu buka lagi." : "Tanpa akun. Namamu terlihat oleh yang lain di papan."}</p>
      ${broken ? "" : `<form id="ggForm" novalidate><label class="lbl" for="ggName">Nama kamu (boleh dikosongkan)</label><input class="field" id="ggName" maxlength="40" autocomplete="name" placeholder="Tamu" value="${esc(ls.get("papan:guest:name"))}"><button class="btn btn-primary" type="submit" id="ggGo">Masuk ke papan</button></form>`}
      ${message ? `<p class="gerr" role="alert">${esc(message)}</p>` : ""}
      <p class="gfoot">Papan ini milik sebuah brand di Brandlab.</p></div>`;
    const f = el.querySelector("#ggForm");
    if (!f) return;
    const input = el.querySelector("#ggName");
    f.onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      // Shut out mid-session (the link was closed): start the page over;
      // it goes straight in again if the link works by now.
      if (closed) { if (name) ls.set("papan:guest:name", name); location.reload(); return; }
      el.querySelector("#ggGo").disabled = true;
      el.querySelector("#ggGo").textContent = "Membuka papan…";
      enter(name).then(() => el.remove(), (err) => gate(ERR[err?.code] || "Gagal tersambung. Periksa internetmu lalu coba lagi."));
    };
  }

  const join = async (name) => {
    const res = await fetch("/api/papan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", brandId, boardId, t: secret, name, key }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: out.error || "unknown" };
    return out;
  };

  // Straight in: the name this browser used before, else the server's "Tamu N".
  async function enter(name) {
    const first = !ls.get("papan:guest:name");
    const out = await join(name);
    ls.set("papan:guest:name", out.name);

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

    const uid = out.uid, canEdit = out.role === "edit", me = { name: out.name };
    lab.brand = { id: brandId, name: out.brand?.name || "", tagline: "", color: out.brand?.color || "" };
    lab.people = Object.values(out.people || {});
    labListeners.forEach((f) => { try { f(); } catch {} });
    const chip = document.querySelector(".brand-chip");
    if (chip) chip.innerHTML = `<span class="bn">${esc(lab.brand.name)}</span><span class="guest-chip">Tamu</span>`;
    window.__papanCanWrite = () => canEdit;
    // "Ganti nama" in the guest's ⋯ menu (10-ui.js).
    window.__papanRename = async (name) => {
      const r = await join(name);
      me.name = r.name; ls.set("papan:guest:name", r.name);
      Store.me.name = r.name; Collab.presence({ nm: r.name }); Store.emit("names");
      return r.name;
    };

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
      user: guestUser(F, fdb, brandId, boardId, uid, me, canEdit, out.people || {}),
      room: guestRoom(D, rdb, brandId, uid),
      sample: guestAi(() => auth.currentUser?.getIdToken(), hooks),
      downloads: papanDownloads,
      assets: null,
    });
    if (first) setTimeout(() => { try { toast(`Kamu masuk sebagai ${out.name}. Ganti nama lewat menu ⋯ di kanan atas.`); } catch {} }, 900);
  }

  const start = () => {
    if (!brandId || !boardId || !OK.test(secret || "")) return gate();
    enter(ls.get("papan:guest:name")).catch((err) => gate(ERR[err?.code] || "Gagal tersambung. Periksa internetmu lalu coba lagi."));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

// A guest's AI: api/ai.js charges the board owner's credits, at most
// GUEST_AI_PER_DAY (api/papan.js) answers per guest per day. Same JSON
// contract as the team's papanJson (js/ai.js): {"hasil": …}.
function guestAi(idToken, hooks) {
  const SYSTEM = [
    "Kamu Tanya Brandlab yang sedang membantu seorang tamu di Papan (whiteboard sebuah brand). Ikuti format jawaban yang diminta dengan tepat. Jangan mengarang angka, nama orang, tanggal, atau keputusan yang tidak ada di papan.",
    "Tulis seperti orang sungguhan yang paham branding, bukan seperti asisten AI: tanpa kata promosi yang berlebihan, langsung ke isi. Bahasa Indonesia santai (pakai 'kamu') kecuali diminta lain.",
    'Respond ONLY with valid JSON, no markdown fences: {"hasil": <the answer in exactly the format the request asks for>}',
  ].join("\n\n");
  const say = (msg) => { try { toast(msg); } catch {} };
  const sample = Object.assign(async (input) => ({ text: JSON.stringify(await sample.json(input)), truncated: false }), {
    async json(input) {
      const prompt = typeof input === "string" ? input : (input || []).map((m) => m.content).join("\n\n");
      let res, out = {};
      try {
        const token = await idToken();
        res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ system: SYSTEM, user: String(prompt).slice(0, 40000), maxTokens: 2000, json: true, feature: "papan" }),
        });
        out = await res.json().catch(() => ({}));
      } catch { say("AI gagal tersambung. Coba lagi."); throw { code: "upstream_error", shown: true }; }
      if (!res.ok) {
        const e = out.error;
        if (e === "link-off") hooks.denied();
        else say(e === "guest-limit" ? `Jatah AI-mu hari ini sudah habis (${out.limit || 10} jawaban). Coba lagi besok.` : e === "quota" ? "Kredit AI pemilik papan sedang habis." : e === "owner-inactive" || e === "readonly" ? "AI papan ini sedang tidak bisa dipakai." : e === "busy" ? "AI sedang sibuk. Coba lagi sebentar." : "AI gagal menjawab. Coba lagi.");
        throw { code: res.status === 429 ? "rate_limited" : "upstream_error", shown: true };
      }
      let parsed = null;
      try { parsed = JSON.parse(String(out.text || "").replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {}
      if (!parsed || typeof parsed !== "object" || !("hasil" in parsed)) throw { code: "invalid_json" };
      return parsed.hasil;
    },
    limits: async () => ({ maxPromptBytes: 40000 }),
  });
  return sample;
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

function guestUser(F, fdb, brandId, boardId, uid, me, canEdit, people) {
  const names = new Map();
  const guestName = (id) => {
    if (!names.has(id)) names.set(id, F.getDoc(F.doc(fdb, `brands/${brandId}/boards/${boardId}/guests/${id}`)).then((s) => (s.exists() ? String(s.data().name || "") : ""), () => ""));
    return names.get(id);
  };
  return {
    id: async () => uid,
    me: async () => ({ id: uid, name: me.name, avatarUrl: "", color: null, email: "", isOwner: false, canEdit }),
    name: async () => me.name,
    isOwner: async () => false,
    canEdit: async () => canEdit,
    can: async () => canEdit,
    async profiles(ids) {
      const out = {};
      for (const id of [].concat(ids || [])) {
        const guest = String(id).startsWith("pg-");
        const n = id === uid ? me.name : guest ? `${(await guestName(id)) || "Tamu"} (tamu)` : people[id] || "";
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

/* ---- host-brandlab.js ---- */
// Brandlab host (papan/build.mjs puts it right after guest.js). The canvas runs in an
// iframe on #/brand/:id/papan; Brandlab hands it a bridge
// (js/papan/bridge.js, window.parent.__papanBridge) and this file turns that
// into the window.claude.use() API the canvas was written against, so the
// same canvas code also runs inside claude.ai for prototypes.
(() => {
  let bridge = null;
  try { bridge = window.parent && window.parent !== window ? window.parent.__papanBridge : null; } catch { bridge = null; }
  window.__papanHost = "brandlab";
  // On the Papan page Brandlab hides its own floating buttons (css/styles.css),
  // so they can't cover the board's controls; the board's "Tanya Brandlab"
  // pill opens that same chat (window.__papanChat below).
  document.documentElement.classList.add("host-brandlab");
  // A board's guest link (api/papan.js): someone outside the team, no Brandlab.
  const tamu = !bridge && new URLSearchParams(location.search).get("tamu");
  if (tamu) { papanGuestHost(tamu); return; }
  if (!bridge) {
    // Opened on its own (bookmark, new tab): send people to the brand's page.
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;font-family:system-ui;background:#0c0b0a;color:#f6f4f1;padding:24px;text-align:center"><div><p style="font-size:16px;margin:0 0 12px">Papan dibuka dari dalam Brandlab.</p><a href="/" style="color:#ffa52b;font-weight:800">Buka Brandlab</a></div></div>`;
    });
    window.claude = { use: async () => null };
    return;
  }
  const jsonClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  window.__papanNS = bridge.brandId;
  window.__papanBridge = bridge;
  try { if (bridge.boardId) localStorage.setItem(`papan:${bridge.brandId}:lastBoard`, JSON.stringify(bridge.boardId)); } catch {}

  // Theme follows Brandlab (dark is Brandlab's default).
  window.__papanTheme = (th) => {
    const t = th || bridge.theme();
    document.documentElement.setAttribute("data-theme", t.theme === "light" ? "light" : "dark");
    document.documentElement.dataset.resolved = t.theme === "light" ? "light" : "dark";
    try { if (typeof Canvas !== "undefined") Canvas.scheduleRender(); } catch {}
  };
  window.__papanTheme();

  // Snapshots cross from Brandlab's window: copy them into this one.
  const wrapSnap = (s) => ({ id: s.id, exists: s.exists, data: () => jsonClone(s.data()), metadata: s.metadata });
  const wrapQuery = (q) => ({ docs: q.docs.map(wrapSnap), size: q.size, empty: q.empty, docChanges: () => q.docChanges().map((c) => ({ type: c.type, doc: wrapSnap(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })), metadata: q.metadata });
  const wrapDoc = (d) => ({
    id: d.id, path: d.path,
    get: async () => wrapSnap(await d.get()),
    set: (x) => d.set(jsonClone(x)), update: (x) => d.update(jsonClone(x)), delete: () => d.delete(),
    onSnapshot: (next, err) => d.onSnapshot((s) => next(wrapSnap(s)), err),
    collection: (sub) => wrapColl(d.collection(sub)),
  });
  const wrapColl = (c) => ({
    path: c.path, doc: (id) => wrapDoc(c.doc(id)), add: async (x) => wrapDoc(await c.add(jsonClone(x))), where: () => wrapColl(c),
    orderBy: (f, dir) => wrapColl(c.orderBy(f, dir)), limit: (n) => wrapColl(c.limit(n)),
    get: async () => wrapQuery(await c.get()),
    onSnapshot: (next, err) => c.onSnapshot((q) => next(wrapQuery(q)), err),
  });
  const db = { doc: (p) => wrapDoc(bridge.db.doc(p)), collection: (p) => wrapColl(bridge.db.collection(p)), cascadeDelete: true };

  // AI: the board's buttons, charged to the brand owner's credits in Brandlab.
  const sample = Object.assign(async (input) => ({ text: JSON.stringify(await sample.json(input)), truncated: false }), {
    async json(input) {
      const prompt = typeof input === "string" ? input : (input || []).map((m) => m.content).join("\n\n");
      try { return jsonClone(await bridge.ai.json(prompt)); }
      catch (e) {
        const msg = String(e?.message || "");
        if (msg) try { toast(msg); } catch {}
        throw { code: e?.code === "quota" || /kuota|habis|limit/i.test(msg) ? "rate_limited" : "upstream_error", message: msg, shown: true };
      }
    },
    limits: async () => ({ maxPromptBytes: 40000 }),
  });

  // The brand's real data for the widgets, and the simple actions on it.
  window.__papanLab = {
    get: () => jsonClone(bridge.lab.get()),
    save: (kind, item) => jsonClone(bridge.lab.save(kind, jsonClone(item))),
    onChange: (fn) => bridge.lab.onChange(fn),
  };
  window.__papanBrandContext = () => bridge.brandContext();
  window.__papanGo = (to, id) => bridge.go(to, id);
  window.__papanCanWrite = () => bridge.canWrite();
  // ✦ and the round button open Brandlab's own Tanya Brandlab, with the board.
  window.__papanChat = () => bridge.openChat(() => window.__papanSummary());
  // The board's guest link, from the Bagikan dialog (10-ui.js guestLinkHTML).
  window.__papanShare = async (id, opts) => jsonClone(await bridge.share(id, jsonClone(opts)));
  window.__papanGuestLink = (id, t) => bridge.guestLink(id, t);

  const adapters = { db, user: bridge.user, room: bridge.room || null, sample, downloads: papanDownloads, assets: null };
  window.claude = { use: async (name) => adapters[name] || null };
})();

/* ---- 01-util.js ---- */
// Small helpers shared by every module.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = (p = "") => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => {}; return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}
// Field-level patch that turns `a` into `b`; nested objects become nested patches,
// removed keys become null (the store treats null as "absent").
function diffPatch(a, b) {
  const p = {};
  a = a || {}; b = b || {};
  for (const k of Object.keys(b)) {
    if (deepEqual(a[k], b[k])) continue;
    if (isObj(a[k]) && isObj(b[k])) { const sub = diffPatch(a[k], b[k]); if (Object.keys(sub).length) p[k] = sub; }
    else p[k] = b[k] === undefined ? null : clone(b[k]);
  }
  for (const k of Object.keys(a)) if (!(k in b) && a[k] != null) p[k] = null;
  return p;
}
function deepMerge(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
// Applying a patch to local state: nulls delete keys.
function applyPatch(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = applyPatch(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o && k in o ? clone(o[k]) : null; return r; }

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const s = `${d.getDate()} ${BULAN[d.getMonth()]}`;
  return withTime ? `${s}, ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}` : s + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
}
function fmtDay(iso) { if (!iso) return ""; const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : "")); return isNaN(d) ? iso : `${d.getDate()} ${BULAN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`; }
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "baru saja";
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return fmtDate(ts);
}
const rupiah = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const num = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–");
const pct = (n, d = 1) => (isFinite(n) ? num(n, d) + "%" : "–");

// "(data contoh)" only in the claude.ai prototype with its made-up brand.
const EX = () => (window.__papanHost === "brandlab" ? "" : " (data contoh)");
const BL = () => window.__papanHost === "brandlab";
// Someone outside the team on the board's guest link (host/guest.js): no brand
// data, no AI, only this board.
const GUEST = () => !!window.__papanGuest;
const LS = {
  key: (k) => "papan:" + (window.__papanNS ? window.__papanNS + ":" : "") + k,
  get(k, d = null) { try { const v = localStorage.getItem(LS.key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS.key(k), JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(LS.key(k)); } catch {} },
};

function toast(msg, opts = {}) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (opts.action) {
    const b = document.createElement("button");
    b.textContent = opts.action;
    b.onclick = () => { el.remove(); opts.onAction && opts.onAction(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), opts.ms || (opts.action ? 6500 : 3200));
  return el;
}

// Text helpers for the free (rule-based) tools.
const STOP = new Set("yang dan di ke dari untuk dengan ini itu ada kita kami aku kamu jadi bisa akan pada atau juga tidak gak ga nggak buat biar lebih sangat sudah udah belum masih saja aja dong sih kok kan nya pun lagi para oleh dalam karena kalau kalo agar supaya tapi tetapi sama apa siapa mana gimana bagaimana per the a an of to in for on is are".split(" "));
function tokens(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(nya|kan|lah)$/,"")).filter((w) => w.length > 2);
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
function safeUrl(u) {
  try {
    const s = String(u || "").trim();
    const url = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch { return null; }
}
function looksLikeUrl(s) { return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(s || "").trim()); }
function initials(name) { const p = String(name || "?").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
function readableOn(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return "#1c1610";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1c1610" : "#ffffff";
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = [880, 1046, 1318][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.4);
    });
  } catch {}
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("gagal memuat " + src));
    document.head.appendChild(s);
  });
}

/* ---- 02-icons.js ---- */
// Stroke icons in Brandlab's own style (js/icons.js: 1.75 stroke, round caps); many paths copied from there.
const ICON = {
  plus: `<path d="M12 5v14M5 12h14"/>`,
  copy: `<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>`,
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>`,
  chart: `<path d="M4 19V9M11 19V5M18 19v-7"/><path d="M3 21h18"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`, chevronLeft: `<path d="M15 18l-6-6 6-6"/>`, chevronRight: `<path d="M9 6l6 6-6 6"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`,
  dots: `<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>`,
  edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>`,
  trash: `<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 019.5 3h5A1.5 1.5 0 0116 4.5V6"/><path d="M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>`,
  check: `<path d="M5 13l4 4L19 7"/>`, x: `<path d="M18 6L6 18M6 6l12 12"/>`,
  upload: `<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.5-5.5a2 2 0 00-2.8 0L4 19"/>`,
  link: `<path d="M9.5 14.5l5-5"/><path d="M7 17l-1.5 1.5a3.5 3.5 0 01-5-5L4 12"/><path d="M17 7l1.5-1.5a3.5 3.5 0 015 5L22 12"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  para: `<path d="M7 5h14l-4 14H3z"/>`,
  doc: `<path d="M5 3h14v13.5c-3.5-2.5-7 2.5-14 .5z"/>`,
  flow: `<rect x="7.5" y="2.5" width="9" height="5" rx="1.5"/><path d="M12 7.5v3"/><path d="M12 10.5l3.5 3-3.5 3-3.5-3z"/><path d="M12 16.5v2.5"/><rect x="7.5" y="19" width="9" height="2.5" rx="1"/>`,
  elbow: `<path d="M4 6h8v12h8"/><path d="M17 15l3 3-3 3"/>`,
  stopwatch: `<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.2 1.6M9.5 2.5h5M12 2.5V6M18.4 6.6l1.3-1.3"/>`,
  flame: `<path d="M12 21.5c-3.9 0-6.6-2.6-6.6-6.3 0-3.3 2.3-5.4 3.6-7.7.4 1.6 1.3 2.7 2.4 3.2.1-3.1 1.3-5.6 3.8-7.7-.2 3 1 4.7 2.3 6.5 1 1.4 1.9 2.9 1.9 5.2 0 3.9-3.1 6.8-7.4 6.8z"/>`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>`,
  arrowRight: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  users: `<circle cx="9" cy="8" r="3"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3 3 0 010 6"/><path d="M15 14a6 6 0 016 6"/>`,
  expand: `<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  heart: `<path d="M12 20s-7.5-4.7-9.7-9.4C.8 7.1 3 4 6.3 4c2 0 3.4 1 5.7 3.4C14.3 5 15.7 4 17.7 4 21 4 23.2 7.1 21.7 10.6 19.5 15.3 12 20 12 20z"/>`,
  comment: `<path d="M21 11.5a8.5 8.5 0 01-8.9 8.5 9 9 0 01-3.4-.6L3 21l1.7-4.9A8.5 8.5 0 1121 11.5z"/>`,
  book: `<path d="M4 19.5V5.5A2.5 2.5 0 016.5 3H20v15.5H6.5A2.5 2.5 0 004 21z"/><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>`,
  target: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>`,
  layers: `<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5"/>`,
  download: `<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 19h16"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.2 9.3a2.8 2.8 0 015.4.9c0 1.8-2.4 2.1-2.6 3.6"/><path d="M12 17v.01"/>`,
  send: `<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>`,
  bulb: `<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>`,
  unlock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>`,
  play: `<path d="M7 5l12 7-12 7z"/>`, pause: `<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>`,
  refresh: `<path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3"/><path d="M18 4v4h-4M6 20v-4h4"/>`,
  megaphone: `<path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z"/><path d="M15 9a4 4 0 010 6"/><path d="M18 6.5a8 8 0 010 11"/>`,
  money: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>`,
  palette: `<path d="M12 3a9 9 0 000 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-3.9-4-6.8-9-6.8z"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/>`,
  cursor: `<path d="M5 3l14 7.5-6.2 1.6L10 19z"/>`,
  hand: `<path d="M8 13V5.5a1.5 1.5 0 013 0V12"/><path d="M11 11.5V4a1.5 1.5 0 013 0v7.5"/><path d="M14 11.5V6a1.5 1.5 0 013 0v7"/><path d="M8 13l-1.6-1.8a1.6 1.6 0 00-2.4 2.1l3.3 4.4A6 6 0 0012.1 20H13a6 6 0 006-6v-4.5a1.5 1.5 0 00-3 0"/>`,
  sticky: `<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>`,
  text: `<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>`,
  shapes: `<rect x="3" y="12" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="7.5" r="4.5"/>`,
  square: `<rect x="4" y="4" width="16" height="16" rx="2"/>`, circle: `<circle cx="12" cy="12" r="8.5"/>`,
  diamond: `<path d="M12 3l9 9-9 9-9-9z"/>`, triangle: `<path d="M12 4l9 16H3z"/>`, pill: `<rect x="2.5" y="7" width="19" height="10" rx="5"/>`,
  connector: `<path d="M4 20L18 6"/><path d="M11 6h7v7"/>`,
  pen: `<path d="M3 21c3-1 4-4 7-4s3 3 6 2 4-5 5-8"/><path d="M14.5 4.5l4 4"/>`,
  eraser: `<path d="M8 20h12"/><path d="M5.6 15.6l8.5-8.5a2 2 0 012.8 0l2 2a2 2 0 010 2.8L12 18.8a2 2 0 01-1.4.6H8.7a2 2 0 01-1.4-.6l-1.7-1.7a2 2 0 010-2.8z"/><path d="M9.5 11.5l5 5"/>`,
  frame: `<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>`,
  undo: `<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>`,
  redo: `<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>`,
  minus: `<path d="M5 12h14"/>`, fit: `<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>`,
  table: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>`,
  checklist: `<path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M11 6h9M11 12h9M11 18h9"/>`,
  video: `<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>`,
  template: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>`,
  vote: `<path d="M7 11V20H4a1 1 0 01-1-1v-7a1 1 0 011-1h3z"/><path d="M7 11l4-7a2 2 0 012 2v4h5.5a2 2 0 012 2.3l-1.2 6.4A2 2 0 0117.3 20H7"/>`,
  history: `<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>`,
  slides: `<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M10 8l4 2-4 2z"/>`,
  share: `<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4"/>`,
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><path d="M9 9.5v.01M15 9.5v.01"/>`,
  tag: `<path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.4"/>`,
  dna: `<path d="M7 3c0 5 10 5 10 9s-10 4-10 9"/><path d="M17 3c0 5-10 5-10 9s10 4 10 9"/><path d="M8.5 6.5h7M8.5 17.5h7M10 12h4"/>`,
  task: `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8.5l1.6 1.6L12.5 7"/><path d="M8 15h8"/>`,
  calc: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>`,
  growth: `<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`,
  sales: `<path d="M6 7h12l-1 12H7z"/><path d="M9 7a3 3 0 016 0"/>`,
  content: `<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><path d="M8 13h8M8 16.5h5"/>`,
  group: `<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h4a2 2 0 012 2v4"/>`,
  front: `<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>`,
  back: `<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 16v3a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-3"/>`,
  file: `<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>`,
  map: `<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>`,
  approve: `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>`,
  moon: `<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>`,
  sun: `<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>`,
  keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>`,
  follow: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`,
  youtube: `<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.3l5 2.7-5 2.7z" fill="currentColor"/>`,
  tiktok: `<path d="M14 3v11.5a3.5 3.5 0 11-3.5-3.5"/><path d="M14 3c.5 2.6 2.2 4.2 5 4.5"/>`,
  instagram: `<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor"/>`,
  presentation: `<path d="M3 4h18"/><rect x="4" y="4" width="16" height="11" rx="1"/><path d="M12 15v4M8 21l4-2 4 2"/>`,
  wand: `<path d="M4 20L15 9"/><path d="M15 4v2M19 8h2M17.5 5.5l1.4-1.4M12.5 6.5L11 5M18 13l1.5 1.5"/>`,
  organize: `<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="3" y="11" width="7" height="10" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/>`,
  shield: `<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>`,
};
function ic(name, cls = "i") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;
}

/* ---- 03-example.js ---- */
// Example Brandlab data for a MADE-UP brand. In the real feature these widgets read the brand's own
// Brand DNA, Brand Book, campaigns, content, tasks, Insights and Pelacak Penjualan.
const LOGO_SVG = (fg = "#3B2418", acc = "#E2683C") => `<svg viewBox="0 0 220 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22h30v14a15 15 0 01-30 0z"/><path d="M40 26h5a6 6 0 010 12h-5"/><path d="M6 56c6-4 12-4 18 0s12 4 18 0"/></g><path d="M22 8c-3 3 3 6 0 9" stroke="${acc}" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="62" y="30" font-family="DM Serif Display, Georgia, serif" font-size="26" fill="${fg}">Kopi</text><text x="62" y="56" font-family="DM Serif Display, Georgia, serif" font-size="26" fill="${acc}">Tepian</text></svg>`;
const MARK_SVG = (fg = "#3B2418", acc = "#E2683C") => `<svg viewBox="0 0 52 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22h30v14a15 15 0 01-30 0z"/><path d="M36 26h5a6 6 0 010 12h-5"/><path d="M2 56c6-4 12-4 18 0s12 4 18 0"/></g><path d="M18 8c-3 3 3 6 0 9" stroke="${acc}" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`;

const LAB_BASE = {
  brand: { id: "kopi-tepian", name: "Kopi Tepian", tagline: "Ngopi pelan di tepi kota", color: "#C8875A" },
  dna: {
    visi: "Jadi tempat ngopi paling hangat di tepi Kali Brantas, tempat orang datang untuk pelan sejenak.",
    misi: "Menyajikan kopi lokal yang jujur rasanya, dengan suasana yang bikin orang betah dan ngobrol.",
    audiens: "Pekerja muda & mahasiswa 20–30 th di Kediri yang cari tempat kerja santai dan kopi enak di bawah Rp 30 rb.",
    kepribadian: ["Hangat", "Santai", "Jujur", "Sedikit jenaka"],
    nilai: ["Biji lokal Jawa Timur", "Harga masuk akal", "Ruang untuk ngobrol"],
    positioning: "Untuk anak muda Kediri yang butuh jeda, Kopi Tepian adalah kedai tepi sungai yang paling bikin betah, karena kopinya lokal, harganya jujur, dan suasananya pelan.",
    vp: "Kopi susu gula aren dari biji lokal, sore yang tenang di tepi sungai, Rp 22 rb.",
  },
  book: {
    colors: [
      { name: "Espresso", hex: "#3B2418", role: "Utama" },
      { name: "Kopi Susu", hex: "#C8875A", role: "Utama" },
      { name: "Krem", hex: "#F3E6D3", role: "Latar" },
      { name: "Daun", hex: "#4F7B5A", role: "Aksen" },
      { name: "Senja", hex: "#E2683C", role: "Aksen" },
    ],
    fonts: { display: "DM Serif Display", body: "Plus Jakarta Sans" },
    tone: { do: ["Ngobrol seperti teman", "Cerita kecil soal biji & proses", "Pakai 'kamu'"], dont: ["Teriak promo (WAJIB, BURUAN)", "Janji paling murah", "Bahasa kaku korporat"] },
    avoid: ["termurah", "paling murah", "wajib", "buruan", "murahan", "diskon gila", "gratis ongkir"],
  },
  campaigns: [
    { id: "c-ramadan", name: "Ramadan 2027: Buka Pelan", status: "plan", objective: "Naikkan transaksi sore (16.00–19.00) 30% selama Ramadan", audience: "Pekerja muda yang buka puasa di luar rumah", strategy: "Paket takjil + kopi, sesi ngabuburit di tepi sungai, konten cerita barista", channels: ["Instagram", "TikTok", "WhatsApp"], start: "2027-02-01", end: "2027-03-10", metrics: null },
    { id: "c-aren", name: "Kopi Susu Aren November", status: "ready", objective: "Kenalkan biji baru dari Dampit ke 2.000 orang", audience: "Mahasiswa sekitar kampus", strategy: "Sampling di kampus + konten 3 cara menikmati", channels: ["Instagram", "Offline"], start: "2026-11-01", end: "2026-11-30", metrics: null },
    { id: "c-ultah", name: "Ulang Tahun ke-3", status: "done", objective: "Ajak pelanggan lama datang lagi", audience: "Pelanggan setia", strategy: "Kode TEPIAN3 + mural tamu", channels: ["Instagram", "WhatsApp"], start: "2026-10-10", end: "2026-10-20", metrics: { reach: 18400, er: 9.1, leads: 312 } },
  ],
  content: [
    { id: "k1", title: "Behind the bar: seduh V60 biji Dampit", platform: "Instagram", date: "2026-10-24", status: "terjadwal", pic: "Admin IG" },
    { id: "k2", title: "3 cara menikmati kopi susu aren", platform: "TikTok", date: "2026-10-27", status: "produksi", pic: "Barista lead" },
    { id: "k3", title: "Sore di tepi sungai (carousel foto)", platform: "Instagram", date: "2026-10-30", status: "ide", pic: "Desainer" },
  ],
  tasks: [
    { id: "t1", title: "Rekap hasil kode TEPIAN3", owner: "Admin IG", due: "2026-10-23", done: true, priority: "sedang", campaignId: "c-ultah" },
    { id: "t2", title: "Hitung HPP paket takjil + kopi", owner: "Pemilik", due: "2026-11-05", done: false, priority: "tinggi", campaignId: "c-ramadan" },
    { id: "t3", title: "Foto menu Ramadan", owner: "Desainer", due: "2026-12-15", done: false, priority: "sedang", campaignId: "c-ramadan" },
  ],
  milestones: [
    { id: "m1", title: "Konsep Ramadan disetujui", due: "2026-11-15", progress: 40 },
    { id: "m2", title: "Menu & harga final", due: "2026-12-20", progress: 10 },
  ],
  growth: { weeks: ["2 Sep", "9 Sep", "16 Sep", "23 Sep", "30 Sep", "7 Okt", "14 Okt", "21 Okt"], followers: [4120, 4185, 4260, 4302, 4390, 4512, 4580, 4701], er: [6.1, 5.8, 7.2, 6.9, 8.4, 7.7, 9.1, 8.8], top: [{ title: "Behind the bar: seduh V60", er: 12.4 }, { title: "Kopi susu aren 3 cara", er: 10.1 }] },
  sales: { months: ["Mei", "Jun", "Jul", "Agu", "Sep", "Okt"], values: [38.2, 41.5, 40.1, 44.8, 47.3, 52.6], note: "Okt masih berjalan", link: { campaign: "Ulang Tahun ke-3", txt: "312 transaksi pakai kode TEPIAN3" } },
  people: ["Pemilik", "Admin IG", "Desainer", "Barista lead"],
};
const STICKY = { yellow: "#FFE27A", orange: "#FFC38B", pink: "#FFB3C7", violet: "#D6C4FF", blue: "#A8D8FF", green: "#B8F0C4", gray: "#E4E0D9", white: "#FFFFFF" };
const INKS = ["ink", "#ffa52b", "#ff6a5c", "#3ddc84", "#7ab8ff", "#b38cff", "#ff7eb6", "#8a8479"];
const inkColor = (c) => (c === "ink" || !c ? "var(--ink)" : c);
const STATUS_LABEL = { plan: "Perencanaan", ready: "Siap jalan", done: "Selesai", planning: "Perencanaan", active: "Berjalan", completed: "Selesai", archived: "Diarsipkan" };
const CSTATUS = ["ide", "produksi", "terjadwal", "terbit"];

/* ---- 04-templates.js ---- */
// Templates: each returns objects with local ids (L1, L2…) that insertObjects() remaps.
function TB() {
  const objs = []; let n = 0;
  const add = (o) => { o.id = "L" + (++n); objs.push(o); return o.id; };
  return {
    objs,
    frame: (x, y, w, h, title, color = "#ffa52b", ex = {}) => add({ type: "frame", x, y, w, h, text: title, color, ...ex }),
    sticky: (x, y, text, color = "yellow", ex = {}) => add({ type: "sticky", x, y, w: 200, h: 200, text, color, ...ex }),
    text: (x, y, w, text, fs = 17, ex = {}) => add({ type: "text", x, y, w, h: Math.round(fs * 1.5), text, fs, ...ex }),
    head: (x, y, w, text, fs = 40, ex = {}) => add({ type: "text", x, y, w, h: Math.round(fs * 1.25), text, fs, heading: true, ...ex }),
    shape: (x, y, w, h, shape, color, text = "", ex = {}) => add({ type: "shape", x, y, w, h, text, color, data: { shape, fill: true }, ...ex }),
    link: (a, b, ex = {}) => add({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: a }, to: { id: b }, arrow: "end", style: "curve", dash: false, ...ex } }),
    table: (x, y, w, rows, title = "") => add({ type: "table", x, y, w, h: 40 + rows.length * 34, text: title, data: { rows } }),
    check: (x, y, w, title, items) => add({ type: "checklist", x, y, w, h: 80 + items.length * 30, text: title, data: { items: items.map((t) => (typeof t === "string" ? { t, done: false } : t)) } }),
    widget: (x, y, w, h, kind, ex = {}) => add({ type: "widget", x, y, w, h, data: { kind, mode: "live", ...ex } }),
    embed: (x, y, w, h, url, title, desc) => add({ type: "embed", x, y, w, h, data: { ...parseLink(url), title, desc } }),
  };
}
const B = LAB_BASE.book.colors;
const TEMPLATES = [
  { id: "brainstorm", name: "Sesi brainstorming", desc: "Satu pertanyaan, banyak ide, vote di akhir", icon: "bulb", build() {
    const t = TB();
    t.frame(0, 0, 1180, 640, "Ide", "#ffa52b");
    t.head(40, 36, 1100, "Bagaimana kalau kita…?", 40);
    t.text(40, 96, 900, "Ganti pertanyaan di atas. Satu ide = satu sticky. Jangan bantah dulu, tambahi saja.", 16, { color: "#8a8479" });
    ["yellow", "orange", "pink", "violet", "blue"].forEach((c, i) => t.sticky(40 + i * 224, 160, "", c));
    ["green", "yellow", "orange", "pink", "violet"].forEach((c, i) => t.sticky(40 + i * 224, 396, "", c));
    t.frame(1230, 0, 470, 640, "Parkir dulu", "#8a8479");
    t.text(1260, 40, 400, "Ide bagus, tapi bukan untuk sekarang. Taruh di sini supaya tidak hilang.", 15, { color: "#8a8479" });
    t.sticky(1260, 160, "", "gray"); t.sticky(1480, 160, "", "gray");
    t.frame(0, 690, 1700, 170, "Aturan main", "#3ddc84");
    ["Semua ide boleh", "Tambah, jangan bantah", "Banyak dulu, bagus nanti", "Tiap orang 3 vote"].forEach((s, i) => t.shape(40 + i * 410, 740, 370, 80, "pill", "#3ddc84", s));
    return t.objs; } },
  { id: "mindmap", name: "Mind map", desc: "Satu topik di tengah, cabang ke segala arah", icon: "share", build() {
    const t = TB();
    const c = t.shape(560, 330, 280, 140, "ellipse", "#ffa52b", "Topik utama");
    const pos = [[160, 80], [560, 20], [960, 80], [160, 640], [560, 700], [960, 640]];
    const cols = ["#7ab8ff", "#b38cff", "#ff7eb6", "#3ddc84", "#ffc94a", "#ff6a5c"];
    pos.forEach(([x, y], i) => { const b = t.shape(x, y, 260, 90, "rect", cols[i], `Cabang ${i + 1}`); t.link(c, b, { arrow: "none" }); });
    return t.objs; } },
  { id: "campaign", name: "Perencanaan campaign", desc: "Tujuan sampai KPI dalam satu papan", icon: "megaphone", build() {
    const t = TB();
    t.frame(0, 0, 520, 420, "Tujuan", "#ffa52b"); t.sticky(30, 40, "Contoh: naikkan transaksi sore 30% dalam 6 minggu", "yellow"); t.text(250, 50, 240, "Satu tujuan yang bisa diukur. Angka + waktu.", 15, { color: "#8a8479" });
    t.frame(560, 0, 520, 420, "Audiens", "#7ab8ff"); t.sticky(590, 40, "Siapa mereka?", "blue"); t.sticky(810, 40, "Apa yang mereka butuhkan?", "blue");
    t.frame(1120, 0, 520, 420, "Pesan utama", "#b38cff"); t.sticky(1150, 40, "Satu kalimat yang harus mereka ingat", "violet");
    t.frame(0, 470, 520, 420, "Channel", "#3ddc84"); t.check(30, 510, 460, "Pakai channel apa?", ["Instagram", "TikTok", "WhatsApp", "Offline / di toko"]);
    t.frame(560, 470, 520, 420, "Timeline", "#ffc94a"); t.table(590, 510, 460, [["Minggu", "Kegiatan", "PIC"], ["1", "", ""], ["2", "", ""], ["3", "", ""], ["4", "", ""]]);
    t.frame(1120, 470, 520, 420, "Budget & KPI", "#ff6a5c"); t.widget(1150, 510, 460, 360, "calc", { calc: { tab: "budget" } });
    return t.objs; } },
  { id: "social", name: "Rencana konten sosmed", desc: "Seminggu konten per platform + pilar", icon: "calendar", build() {
    const t = TB();
    t.frame(0, 0, 980, 420, "Minggu ini", "#ffa52b");
    t.table(30, 40, 920, [["Hari", "Feed IG", "Reels / TikTok", "Story"], ["Senin", "", "", ""], ["Rabu", "", "", ""], ["Jumat", "", "", ""], ["Minggu", "", "", ""]]);
    t.frame(1020, 0, 520, 420, "Pilar konten", "#b38cff");
    [["Edukasi", "blue"], ["Di balik layar", "orange"], ["Promo", "pink"], ["Komunitas", "green"]].forEach(([s, c], i) => t.sticky(1050 + (i % 2) * 230, 40 + Math.floor(i / 2) * 180, s, c, { h: 160 }));
    t.widget(0, 460, 520, 300, "content");
    return t.objs; } },
  { id: "brief", name: "Creative brief", desc: "Brief satu halaman untuk desainer/videografer", icon: "file", build() {
    const t = TB();
    t.frame(0, 0, 900, 640, "Creative brief", "#ffa52b");
    t.table(30, 40, 840, [["Bagian", "Isi"], ["Latar belakang", ""], ["Tujuan", ""], ["Audiens", ""], ["Insight", ""], ["Satu pesan utama", ""], ["Wajib ada", "Logo, warna Brand Book"], ["Deliverables", ""], ["Deadline & PIC", ""]]);
    t.widget(940, 0, 420, 400, "brandbook");
    return t.objs; } },
  { id: "workshop", name: "Workshop strategi brand", desc: "Dari posisi sekarang ke posisi yang dituju", icon: "dna", build() {
    const t = TB();
    t.widget(0, 0, 420, 520, "dna");
    t.frame(460, 0, 470, 520, "Kita hari ini", "#7ab8ff"); t.sticky(490, 40, "", "blue"); t.sticky(710, 40, "", "blue");
    t.frame(970, 0, 470, 520, "Kita mau jadi", "#3ddc84"); t.sticky(1000, 40, "", "green"); t.sticky(1220, 40, "", "green");
    t.frame(1480, 0, 470, 520, "Yang harus berubah", "#ff6a5c"); t.sticky(1510, 40, "", "pink"); t.sticky(1730, 40, "", "pink");
    return t.objs; } },
  { id: "competitor", name: "Analisis kompetitor", desc: "Bandingkan harga, kelebihan, konten", icon: "search", build() {
    const t = TB();
    t.frame(0, 0, 1100, 380, "Kompetitor", "#7ab8ff");
    t.table(30, 40, 1040, [["Nama", "Harga", "Kelebihan", "Kekurangan", "Konten andalan"], ["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]]);
    t.frame(1140, 0, 470, 380, "Peluang kita", "#3ddc84"); t.sticky(1170, 40, "Yang belum dilakukan siapa pun…", "green");
    return t.objs; } },
  { id: "journey", name: "Customer journey", desc: "Tahu, tertarik, beli, pakai, rekomendasi", icon: "map", build: null },
  { id: "retro", name: "Retrospektif campaign", desc: "Yang berhasil, kurang, dan dicoba lagi", icon: "refresh", build() {
    const t = TB();
    [["Berhasil", "#3ddc84", "green"], ["Kurang", "#ff6a5c", "pink"], ["Coba lagi", "#7ab8ff", "blue"]].forEach(([s, c, sc], i) => { t.frame(i * 500, 0, 460, 520, s, c); t.sticky(i * 500 + 30, 40, "", sc); t.sticky(i * 500 + 240, 40, "", sc); });
    t.check(0, 570, 460, "Aksi berikutnya", ["", ""]);
    return t.objs; } },
  { id: "weekly", name: "Rapat marketing mingguan", desc: "Angka, update, hambatan, keputusan, tugas", icon: "clock", build() {
    const t = TB();
    t.widget(0, 0, 440, 360, "growth");
    t.frame(480, 0, 440, 360, "Update tim", "#7ab8ff"); t.sticky(510, 40, "", "blue");
    t.frame(960, 0, 440, 360, "Hambatan", "#ff6a5c"); t.sticky(990, 40, "", "pink");
    t.frame(0, 410, 440, 340, "Keputusan", "#3ddc84"); t.sticky(30, 450, "", "green", { tag: "keputusan" });
    t.check(480, 410, 440, "Tugas minggu depan", ["", ""]);
    t.widget(960, 410, 440, 340, "tasks");
    return t.objs; } },
  { id: "workflow", name: "Alur produksi konten", desc: "Ide sampai terbit, kartu bergerak ke kanan", icon: "content", build() {
    const t = TB();
    const cols = [["Ide", "#8a8479"], ["Script", "#7ab8ff"], ["Produksi", "#ffc94a"], ["Edit", "#b38cff"], ["Review", "#ff7eb6"], ["Terbit", "#3ddc84"]];
    const f = cols.map(([s, c], i) => t.frame(i * 290, 0, 260, 620, s, c));
    f.slice(1).forEach((id, i) => t.link(f[i], id, { style: "straight" }));
    t.sticky(30, 40, "Contoh: 3 cara menikmati kopi susu aren", "yellow", { w: 200, h: 160 });
    return t.objs; } },
  { id: "moodboard", name: "Moodboard", desc: "Gambar, video, link, dan warna", icon: "image", build() {
    const t = TB();
    t.frame(0, 0, 1180, 700, "Moodboard", "#ff7eb6");
    for (let i = 0; i < 6; i++) t.shape(30 + (i % 3) * 380, 50 + Math.floor(i / 3) * 300, 350, 270, "rect", "#8a8479", "Tempel gambar, video, atau link di sini", { data: { shape: "rect", fill: false, dash: true } });
    B.forEach((c, i) => t.shape(1220, 20 + i * 130, 200, 110, "rect", c.hex, c.name, { data: { shape: "rect", fill: true, solid: true } }));
    t.text(1220, 700, 400, "Rasa yang dicari: …", 18, { bold: true });
    return t.objs; } },
  { id: "swot", name: "SWOT", desc: "Kekuatan, kelemahan, peluang, ancaman", icon: "grid", build() {
    const t = TB();
    [["Kekuatan", "#3ddc84", "green"], ["Kelemahan", "#ff6a5c", "pink"], ["Peluang", "#7ab8ff", "blue"], ["Ancaman", "#ffc94a", "yellow"]].forEach(([s, c, sc], i) => {
      const x = (i % 2) * 620, y = Math.floor(i / 2) * 480; t.frame(x, y, 580, 440, s, c); t.sticky(x + 30, y + 40, "", sc); t.sticky(x + 250, y + 40, "", sc); });
    return t.objs; } },
  { id: "review", name: "Review performa campaign", desc: "Angka asli + pelajaran + langkah berikut", icon: "chart", build() {
    const t = TB();
    t.widget(0, 0, 440, 420, "campaign", { ref: "c-ultah" });
    t.widget(480, 0, 440, 420, "growth");
    t.widget(960, 0, 440, 420, "sales");
    [["Yang berhasil", "#3ddc84", "green"], ["Pelajaran", "#ffc94a", "yellow"], ["Langkah berikutnya", "#7ab8ff", "blue"]].forEach(([s, c, sc], i) => { t.frame(i * 480, 470, 440, 320, s, c); t.sticky(i * 480 + 30, 510, "", sc); });
    return t.objs; } },
];
TEMPLATES.find((t) => t.id === "journey").build = function () {
  const t = TB();
  const st = ["Tahu", "Tertarik", "Beli", "Pakai", "Rekomendasi"];
  const pills = st.map((s, i) => t.shape(220 + i * 240, 0, 220, 64, "pill", ["#7ab8ff", "#b38cff", "#ffa52b", "#3ddc84", "#ff7eb6"][i], s));
  pills.slice(1).forEach((p, i) => t.link(pills[i], p, { style: "straight" }));
  [["Yang dilakukan", "yellow"], ["Yang dirasakan", "pink"], ["Peluang", "green"]].forEach(([r, c], j) => {
    t.text(0, 190 + j * 230, 200, r, 17, { bold: true });
    st.forEach((_, i) => t.sticky(230 + i * 240, 110 + j * 230, "", c));
  });
  return t.objs;
};

// The example board people land on: a made-up coffee shop planning Ramadan 2027.
function exampleBoard() {
  const t = TB();
  t.head(0, -150, 1500, "Ramadan 2027: Buka Pelan", 54);
  t.text(0, -78, 1100, "Papan contoh. Brand fiktif Kopi Tepian. Semua angka dan nama di sini contoh, bukan data asli.", 17, { color: "#8a8479" });
  t.frame(0, 0, 760, 600, "1 · Masalah & insight", "#7ab8ff");
  const s1 = t.sticky(30, 40, "Jam 16–18 kedai sepi, padahal itu jam ngabuburit", "yellow");
  t.sticky(260, 40, "Tiap Ramadan pelanggan tanya: ada takjil nggak?", "yellow", { tag: "pertanyaan" });
  t.sticky(490, 40, "Kompetitor cuma kasih diskon, belum ada yang jual suasana", "orange");
  t.sticky(30, 280, "Tepi sungai = tempat ngabuburit favorit warga", "green");
  t.sticky(260, 280, "Keputusan: fokus jam 16.00–19.00, bukan perang diskon", "green", { tag: "keputusan" });
  t.frame(820, 0, 1180, 600, "2 · Ide campaign", "#ffa52b");
  const p = t.sticky(850, 40, "Paket Buka Pelan: takjil + kopi susu aren Rp 35 rb", "yellow", { votes: { "contoh-1": 1, "contoh-2": 1, "contoh-3": 1 }, tag: "terpilih" });
  t.sticky(1080, 40, "Ngabuburit Session: akustik tiap Jumat sore di tepi sungai", "violet", { votes: { "contoh-1": 1, "contoh-2": 1 } });
  t.sticky(1310, 40, "Seri video barista: kopi dan cerita keluarga", "pink", { votes: { "contoh-3": 1 } });
  t.sticky(1540, 40, "Kartu stempel Ramadan: 5x datang, gratis 1 kopi", "blue", { votes: { "contoh-2": 1, "contoh-4": 1 } });
  t.sticky(850, 280, "Ajak 3 penjual takjil sekitar buka lapak di halaman", "orange");
  const d = t.sticky(1080, 280, "DISKON 50% SEMUA MENU! BURUAN!", "pink");
  t.sticky(1310, 280, "Konten 'jam berapa paling enak ngabuburit di Kediri?'", "violet");
  t.link(s1, p);
  t.frame(0, 680, 760, 560, "3 · Moodboard & referensi", "#ff7eb6");
  t.embed(30, 720, 420, 300, "https://www.youtube.com/watch?v=AI4ynXzkSQo", "Referensi gaya video: seduh V60", "Nada tenang, close-up tangan barista");
  t.embed(480, 720, 250, 190, "https://www.instagram.com/explore/tags/ngabuburit/", "#ngabuburit di Instagram", "Cari foto suasana sore");
  [["#3B2418", "Espresso"], ["#C8875A", "Kopi Susu"], ["#E2683C", "Senja"]].forEach(([c, nm], i) => t.shape(30 + i * 150, 1060, 130, 130, "rect", c, nm, { data: { shape: "rect", fill: true, solid: true } }));
  t.text(480, 940, 260, "Rasa: hangat, pelan, keemasan sore", 22, { hand: true });
  t.frame(820, 680, 1180, 560, "4 · Rencana & angka", "#3ddc84");
  t.widget(850, 720, 400, 400, "calc", { calc: { tab: "margin", hpp: 14500, harga: 35000 } });
  t.check(1280, 720, 340, "Sebelum 15 Nov", [{ t: "Uji rasa paket takjil @Barista lead", done: true }, { t: "Tanya 3 penjual takjil mau kolaborasi", done: false }, { t: "Draft konten teaser 20/11 @Admin IG", done: false }]);
  t.widget(1650, 720, 320, 400, "tasks");
  t.widget(2060, 0, 400, 520, "dna");
  t.widget(2060, 560, 400, 360, "campaign", { ref: "c-ramadan" });
  t.widget(2060, 960, 400, 380, "brandbook");
  return { objs: t.objs, comments: [{ ref: d, text: "Ini bertentangan sama 'harga jujur' di Brand DNA nggak?", name: "Admin IG (contoh)" }, { ref: d, text: "Setuju. Ganti jadi bonus kecil, bukan potongan harga.", name: "Pemilik (contoh)", reply: true }] };
}

/* ---- 05-store.js ---- */
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
    if (GUEST() || now - lastTouch < 30000) return; // guests can't write the board doc itself
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

/* ---- 06-collab.js ---- */
// Live presence: who is here, cursors, who is typing, follow-the-presenter.
// In Brandlab this rides on Firebase Realtime Database (cheap, never stored); here on the artifact room.
const Collab = (() => {
  let room = null, user = null, followPeer = null;
  const names = new Map();
  const handlers = new Set();
  const emit = () => handlers.forEach((f) => f());
  let pendingIds = new Set();
  const flushNames = debounce(async () => {
    const ids = [...pendingIds]; pendingIds = new Set();
    if (!user || !ids.length) return;
    try {
      const ps = await user.profiles(ids);
      for (const [id, p] of Object.entries(ps)) names.set(id, { name: p.name || "", color: p.color, avatarUrl: p.avatarUrl, guest: !!p.guest });
      emit(); Store.emit("names");
    } catch {}
  }, 120);
  function want(id) { if (id && !names.has(id) && !String(id).startsWith("contoh") && !String(id).startsWith("me-")) { pendingIds.add(id); flushNames(); } }
  function nameOf(id, fallback) {
    if (!id) return fallback || "Seseorang";
    if (id === Store.me.id) return Store.me.name || "Kamu";
    if (String(id).startsWith("contoh")) return "Contoh";
    // A guest's live name (presence) wins over the cached one: they can rename themselves.
    if (fallback && String(id).startsWith("pg-")) return `${fallback} (tamu)`;
    const n = names.get(id); want(id);
    return (n && n.name) || fallback || "Seseorang";
  }
  const PALETTE = ["#ffa52b", "#7ab8ff", "#ff7eb6", "#3ddc84", "#b38cff", "#ffc94a", "#ff6a5c", "#5fd3d0"];
  function colorOf(id) {
    if (id === Store.me.id && Store.me.color) return Store.me.color;
    const n = names.get(id); if (n && n.color) return n.color;
    let h = 0; for (const c of String(id || "x")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  async function init(r, u) {
    room = r; user = u;
    if (!room) return;
    room.onPeers((ch) => {
      for (const p of ch.peers) want(p.by || p.presence?.uid);
      if (followPeer && ch.left.some((p) => p.peer === followPeer)) { stopFollow(); toast("Orang yang kamu ikuti sudah keluar"); }
      emit();
    }, (e) => console.warn("room", e && e.code));
    room.on("summon", (msg) => {
      if (msg.isMe) return;
      const nm = nameOf(msg.by || msg.data?.uid, msg.data?.nm);
      toast(`${nm} mengajak semua melihat layarnya`, { action: "Ikuti", onAction: () => follow(msg.peer) });
    }, () => {});
    room.onConnection(() => emit(), () => {});
  }
  function presence(patch) { if (room) room.presence(patch).catch(() => {}); }
  function others() {
    if (!room) return [];
    return room.peers().filter((p) => !p.sameTab && p.kind === "viewer");
  }
  function follow(peer) {
    followPeer = peer; presence({ follow: { of: peer } }); emit(); Store.emit("follow");
    const p = others().find((x) => x.peer === peer);
    toast(`Mengikuti layar ${p ? nameOf(p.by || p.presence?.uid, p.presence?.nm) : "teman"}. Geser kanvas untuk berhenti.`);
  }
  function stopFollow(silent) { if (!followPeer) return; followPeer = null; presence({ follow: null }); emit(); if (!silent) toast("Berhenti mengikuti"); }
  async function summon() {
    if (!room) return toast("Fitur ajak ikut butuh papan bersama");
    try { await room.emit("summon", { uid: Store.me.id, nm: Store.me.name }); toast("Semua yang sedang di papan diajak melihat layarmu"); }
    catch (e) { toast(e && e.code === "not_permitted" ? "Akunmu belum bisa mengajak semua di papan ini" : "Ajakan gagal terkirim"); }
  }
  return {
    init, presence, others, nameOf, colorOf, want, follow, stopFollow, summon,
    on: (f) => handlers.add(f), get followPeer() { return followPeer; }, get connected() { return !!room && room.connected(); }, get room() { return room; },
  };
})();

/* ---- 07-render.js ---- */
// How each object type draws itself. Pure HTML strings; Canvas decides when to repaint.
function parseLink(raw) {
  const u = safeUrl(raw); if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (/(^|\.)youtube\.com$/.test(host) || host === "youtu.be") {
    let m, vid = host === "youtu.be" ? u.pathname.slice(1).split("/")[0] : u.searchParams.get("v") || ((m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/)) && m[2]);
    if (vid && /^[\w-]{6,20}$/.test(vid)) return { kind: "youtube", url: u.href, vid, domain: "youtube.com", short: /\/shorts\//.test(u.pathname) };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) { const m = u.pathname.match(/@([\w.]+)/), v = u.pathname.match(/\/video\/(\d+)/); return { kind: "tiktok", url: u.href, handle: m ? m[1] : "", vid: v ? v[1] : "", domain: "tiktok.com" }; }
  if (/(^|\.)instagram\.com$/.test(host)) { const c = u.pathname.match(/\/(p|reel|reels|tv)\/([\w-]+)/); return { kind: "instagram", url: u.href, sub: /\/reel/.test(u.pathname) ? "Reel" : /\/p\//.test(u.pathname) ? "Post" : "Halaman", code: c ? c[2] : "", ctype: c ? (c[1] === "p" ? "p" : "reel") : "", domain: "instagram.com" }; }
  return { kind: "link", url: u.href, domain: host };
}
function embedSrc(d) {
  if (d.kind === "youtube" && d.vid) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.vid)}?autoplay=1&rel=0`;
  if (d.kind === "tiktok" && d.vid) return `https://www.tiktok.com/embed/v2/${encodeURIComponent(d.vid)}`;
  if (d.kind === "instagram" && d.code) return `https://www.instagram.com/${d.ctype === "p" ? "p" : "reel"}/${encodeURIComponent(d.code)}/embed`;
  return null;
}
const hexA = (hex, a) => { const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return `rgba(128,128,128,${a})`; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const stickyBg = (c) => STICKY[c] || (String(c).startsWith("#") ? c : STICKY.yellow);
const objText = (o) => (o.type === "embed" ? [o.data?.title, o.data?.desc].filter(Boolean).join(" — ") : o.type === "checklist" ? [o.text, ...(o.data?.items || []).map((i) => i.t)].filter(Boolean).join("; ") : o.type === "table" ? (o.data?.rows || []).map((r) => r.join(" | ")).join("\n") : o.type === "widget" ? WIDGETS[o.data?.kind]?.name || "" : o.text || "");

function shapeSVG(o) {
  const w = Math.max(4, o.w), h = Math.max(4, o.h), d = o.data || {}, c = o.color && o.color.startsWith("#") ? o.color : "#7ab8ff";
  const fill = d.solid ? c : d.fill === false ? "none" : hexA(c, 0.16);
  const st = `fill="${fill}" stroke="${d.solid ? "none" : c}" stroke-width="2.5" vector-effect="non-scaling-stroke"${d.dash ? ' stroke-dasharray="8 7"' : ""}`;
  let el;
  switch (d.shape) {
    case "ellipse": el = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1.5}" ry="${h / 2 - 1.5}" ${st}/>`; break;
    case "diamond": el = `<polygon points="${w / 2},1.5 ${w - 1.5},${h / 2} ${w / 2},${h - 1.5} 1.5,${h / 2}" ${st} stroke-linejoin="round"/>`; break;
    case "triangle": el = `<polygon points="${w / 2},1.5 ${w - 1.5},${h - 1.5} 1.5,${h - 1.5}" ${st} stroke-linejoin="round"/>`; break;
    case "pill": el = `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${(h - 3) / 2}" ${st}/>`; break;
    // flowchart: input/output and document
    case "para": el = `<polygon points="${w * 0.16},1.5 ${w - 1.5},1.5 ${w * 0.84},${h - 1.5} 1.5,${h - 1.5}" ${st} stroke-linejoin="round"/>`; break;
    case "doc": el = `<path d="M1.5 1.5 H${w - 1.5} V${h * 0.84} C${w * 0.72} ${h * 0.66} ${w * 0.42} ${h * 1.02} 1.5 ${h * 0.86} Z" ${st} stroke-linejoin="round"/>`; break;
    default: el = `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="14" ${st}/>`;
  }
  return `<svg class="sh" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${el}</svg>`;
}
function penPath(pts) {
  if (!pts || !pts.length) return "";
  if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} L${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`; }
  const l = pts[pts.length - 1]; return d + ` L${l[0]} ${l[1]}`;
}
function mentionWho(t) { const m = /@([\p{L}][\p{L}\s.]{0,24}?)(?=$|[,;.!?]| \d|\s{2})/u.exec(t || ""); return m ? m[1].trim() : ""; }

const R = {
  sticky(o) {
    const who = Collab.nameOf(o.createdBy);
    return `<div class="txt${(o.text || "").length > 90 ? " left" : ""}" data-ph="Tulis ide…">${esc(o.text)}</div><div class="author">${esc(who)}</div>`;
  },
  text(o) {
    const st = [`font-size:${o.fs || 18}px`];
    if (o.bold) st.push("font-weight:800");
    if (o.color && o.color !== "ink" && o.color !== "yellow") st.push(`color:${o.color}`);
    if (o.hand) st.push("font-family:var(--font-hand)");
    return `<div class="txt" style="${st.join(";")}">${esc(o.text)}</div>`;
  },
  shape(o) {
    const solid = o.data?.solid, c = o.color && o.color.startsWith("#") ? o.color : "#7ab8ff";
    const fs = o.fs || clamp(Math.min(o.w, o.h) / 6, 13, 26);
    return `${shapeSVG(o)}<div class="txt" style="font-size:${fs}px;${solid ? `color:${readableOn(c)}` : ""}">${esc(o.text)}</div>`;
  },
  pen(o) {
    const d = o.data || {};
    return `<svg viewBox="0 0 ${d.ow || o.w} ${d.oh || o.h}" preserveAspectRatio="none"><path d="${penPath(d.points)}" fill="none" stroke="${inkColor(o.color)}" stroke-width="${d.width || 3}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  },
  frame(o) {
    return `<div class="ftitle"><span class="bar" style="background:${esc(o.color || "#ffa52b")}"></span><span class="t">${esc(o.text || "Frame")}</span>${o.internal ? '<span class="internal-tag">Internal</span>' : ""}</div>`;
  },
  image(o) {
    const d = o.data || {};
    if (!d.src) return `<div class="loading">${d.dropped ? "Gambar tidak ikut tersimpan di versi ini" : "Mengunggah gambar…"}</div>`;
    return `<img src="${esc(d.src)}" alt="${esc(d.name || "Gambar")}" draggable="false">`;
  },
  file(o) {
    const d = o.data || {};
    return `<div class="ft">${esc((d.ext || "FILE").slice(0, 4).toUpperCase())}</div><div style="min-width:0;flex:1"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</b><span class="muted" style="font-size:12px">${d.size ? num(d.size / 1024) + " KB" : ""}</span><div>${d.src ? `<a class="open" style="font-size:12px;font-weight:800;color:var(--accent)" href="${esc(d.src)}" target="_blank" rel="noopener noreferrer">Buka file ↗</a>` : '<span class="muted" style="font-size:12px">Mengunggah…</span>'}</div></div>`;
  },
  table(o) {
    const rows = o.data?.rows || [[""]];
    return `${o.text ? `<div class="card-h"><span class="ic" style="background:var(--accent-soft);color:var(--accent)">${ic("table")}</span><b>${esc(o.text)}</b></div>` : ""}<div class="card-b" style="padding:0"><table>${rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td data-cell="${ri},${ci}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>`;
  },
  checklist(o) {
    const items = o.data?.items || [];
    const done = items.filter((i) => i.done && i.t).length, total = items.filter((i) => i.t).length;
    return `<div class="card-h"><span class="ic" style="background:var(--good-soft);color:var(--good)">${ic("checklist")}</span><b class="ttl">${esc(o.text || "Checklist")}</b><span class="muted tnum" style="font-size:12px;font-weight:800">${done}/${total}</span></div>
      <div class="card-b"><div class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>
      ${items.map((it, i) => { const who = mentionWho(it.t); return `<div class="item${it.done ? " done" : ""}"><input type="checkbox" data-act="check-item" data-i="${i}" ${it.done ? "checked" : ""} aria-label="Selesai"><span class="t" data-item="${i}">${esc(it.t) || '<span class="faint">Tulis tugas…</span>'}</span>${who ? `<span class="who">${esc(who)}</span>` : ""}</div>`; }).join("")}
      <button class="btn btn-ghost btn-xs readonly-hide" data-act="add-item" style="margin-top:4px">${ic("plus")} Tambah</button></div>`;
  },
  embed(o) {
    const d = o.data || {};
    const title = `<div class="tt" data-f="title">${esc(d.title || (d.kind === "link" ? d.domain : ""))}</div>`;
    const desc = d.desc ? `<div class="ds" data-f="desc">${esc(d.desc)}</div>` : "";
    const open = (lbl) => `<a class="open" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${lbl} ↗</a>`;
    // Videos play right on the board wherever the page may load the players
    // (Brandlab's CSP frame-src: YouTube, TikTok, Instagram); the claude.ai
    // prototype can't, so there the play button opens the video's page.
    const web = window.__papanWeb || BL(), canPlay = web && embedSrc(d);
    const playBtn = (cls, style = "") => canPlay ? `<button class="play" ${style} data-act="play-embed" aria-label="Putar di papan">${ic("play")}</button>` : `<a class="play" ${style} href="${esc(d.url)}" target="_blank" rel="noopener noreferrer" aria-label="Buka">${ic("play")}</a>`;
    if (d.kind === "youtube") return `<div class="media yt"${web && d.vid ? ` style="background:#000 url('https://i.ytimg.com/vi/${esc(d.vid)}/hqdefault.jpg') center/cover"` : ""}><span class="plat">${ic("youtube")} YouTube${d.short ? " Shorts" : ""}</span>${playBtn()}${web ? "" : '<span class="proto-note">Prototipe: diputar di tab baru</span>'}</div><div class="meta">${title}${desc}<div class="dom">${open("Putar di YouTube")}</div></div>`;
    if (d.kind === "tiktok") return `<div class="media tt"><span class="plat">${ic("tiktok")} TikTok${d.handle ? " · @" + esc(d.handle) : ""}</span>${playBtn("", 'style="color:#111"')}</div><div class="meta">${title}${desc}<div class="dom">${open("Buka di TikTok")}</div></div>`;
    if (d.kind === "instagram") return `<div class="media ig"><span class="plat">${ic("instagram")} Instagram ${esc(d.sub || "")}</span>${canPlay ? playBtn("", 'style="color:#d62976"') : ""}</div><div class="meta">${title}${desc}<div class="dom">${open("Buka di Instagram")}</div></div>`;
    const letter = (d.domain || "?").replace(/^www\./, "")[0] || "?";
    const col = Collab.colorOf(d.domain);
    return `<div class="meta" style="display:flex;gap:12px;align-items:flex-start;flex:1"><div class="fav" style="background:${col}">${esc(letter.toUpperCase())}</div><div style="min-width:0;flex:1">${title}${desc || '<div class="ds faint">Klik dua kali untuk menambah catatan</div>'}<div class="dom">${ic("link")}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.domain)}</span></div><div style="margin-top:6px">${open("Buka link")}</div></div></div>`;
  },
  widget(o) {
    const W = WIDGETS[o.data?.kind]; if (!W) return "";
    const L = Store.lab();
    const snap = o.data.mode === "snapshot" && o.data.snap;
    const src = snap ? o.data.snap : W.live ? W.live(o, L) : null;
    // Guests (GUEST()) don't see the brand's live data; a snapshot the team
    // froze on the board is part of the board, so that still shows.
    if (GUEST() && W.live && !snap) return `<div class="card-h" style="--wc:${W.color}"><span class="ic">${ic(W.icon)}</span><b>${esc(W.name)}</b></div><div class="card-b"><p class="muted" style="margin:0">Data brand di komponen ini hanya terlihat oleh tim brand.</p></div>`;
    const modeChip = W.live ? (snap ? `<span class="chip snap" title="Isi dibekukan">Snapshot ${fmtDate(o.data.snapAt)}</span>` : `<span class="chip live" title="Ikut berubah saat data Brandlab berubah">● Live</span>`) : "";
    return `<div class="card-h" style="--wc:${W.color}"><span class="ic">${ic(W.icon)}</span><b>${esc(W.title ? W.title(o, src, L) : W.name)}</b>${modeChip}${W.live && !inBrandlab() ? '<span class="chip ex" title="Brand fiktif untuk prototipe">Contoh</span>' : ""}</div>
      <div class="card-b">${W.body(o, src, L)}</div>
      ${W.foot !== false && !GUEST() ? `<div class="card-f"><button class="btn btn-secondary btn-xs" data-act="widget-detail">${ic("expand")} Detail</button>${W.live ? `<button class="btn btn-ghost btn-xs readonly-hide" data-act="widget-mode">${snap ? ic("refresh") + " Jadikan live" : ic("lock") + " Bekukan"}</button>` : ""}${W.open && inBrandlab() ? `<button class="btn btn-ghost btn-xs" data-act="open-in" data-to="${W.open}"${o.data.kind === "campaign" && src?.id ? ` data-id="${esc(src.id)}"` : ""}>${ic("arrowRight")} Buka</button>` : ""}</div>` : ""}`;
  },
  doc(o) {
    const r = o.data || {};
    const sec = (t, arr) => (arr && arr.length ? `<h4>${t}</h4><ul>${arr.map((x) => `<li>${esc(typeof x === "string" ? x : x.tugas + (x.pic ? ` (${x.pic}` + (x.deadline ? `, ${x.deadline}` : "") + ")" : ""))}</li>`).join("")}</ul>` : "");
    return `<div class="card-h"><span class="ic" style="background:var(--violet-soft);color:var(--violet)">${ic("file")}</span><b>${esc(o.text || "Ringkasan rapat")}</b><span class="chip">${fmtDate(r.at || o.createdAt)}</span></div>
      <div class="card-b">${r.ringkasan ? `<p style="margin:0 0 6px">${esc(r.ringkasan)}</p>` : ""}${r.peserta?.length ? `<p class="muted" style="margin:0 0 6px">Peserta: ${esc(r.peserta.join(", "))}</p>` : ""}${sec("Keputusan", r.keputusan)}${sec("Ide terpilih", r.terpilih)}${sec("Pertanyaan terbuka", r.pertanyaan)}${sec("Tugas", r.aksi)}${sec("Langkah berikutnya", r.langkah)}</div>`;
  },
};

// ---------- Brandlab widgets ----------
function spark(vals, color, h = 70) {
  const w = 300, min = Math.min(...vals), max = Math.max(...vals), pad = 6;
  const pts = vals.map((v, i) => [pad + (i * (w - pad * 2)) / (vals.length - 1), h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${line} L${last[0]} ${h} L${pts[0][0]} ${h}Z" fill="${hexA(color, 0.15)}"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${color}"/></svg>`;
}
function bars(vals, labels, color) {
  const max = Math.max(...vals);
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:84px;margin:6px 0 4px">${vals.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end"><span class="tnum" style="font-size:10px;font-weight:800">${num(v, 1)}</span><i style="display:block;width:100%;height:${(v / max) * 60}px;background:${i === vals.length - 1 ? color : hexA(color, 0.45)};border-radius:5px 5px 2px 2px"></i><span style="font-size:10px;color:var(--muted);font-weight:700">${esc(labels[i])}</span></div>`).join("")}</div>`;
}
const CALC_DEF = {
  budget: { label: "Budget iklan", fields: [["budget", "Budget (Rp)", 1500000], ["cpm", "Biaya / 1.000 tayang", 15000], ["ctr", "Klik dari tayang (%)", 1.2], ["cr", "Beli dari klik (%)", 4], ["aov", "Rata-rata belanja (Rp)", 35000]],
    out(v) { const tay = (v.budget / v.cpm) * 1000, klik = (tay * v.ctr) / 100, trx = (klik * v.cr) / 100, omzet = trx * v.aov; return [["Tayangan", num(tay)], ["Klik", num(klik)], ["Transaksi", num(trx, 1)], ["Omzet", rupiah(omzet)], ["ROAS", num(omzet / v.budget, 2) + "x", true], ["Biaya / transaksi", trx ? rupiah(v.budget / trx) : "–"]]; } },
  margin: { label: "Harga & margin", fields: [["hpp", "HPP / modal (Rp)", 14500], ["harga", "Harga jual (Rp)", 35000], ["target", "Target margin (%)", 60]],
    out(v) { const m = v.harga - v.hpp; return [["Untung / item", rupiah(m)], ["Margin", pct((m / v.harga) * 100), true], ["Markup", pct((m / v.hpp) * 100)], ["Harga utk target", rupiah(v.hpp / (1 - v.target / 100))]]; } },
  bep: { label: "Balik modal", fields: [["tetap", "Biaya tetap / bulan (Rp)", 18000000], ["harga", "Harga jual (Rp)", 28000], ["var", "Biaya variabel / item (Rp)", 11000]],
    out(v) { const u = v.tetap / (v.harga - v.var); return [["Item / bulan", isFinite(u) && u > 0 ? num(Math.ceil(u)) : "–", true], ["Item / hari", isFinite(u) && u > 0 ? num(Math.ceil(u / 30)) : "–"], ["Omzet BEP", isFinite(u) && u > 0 ? rupiah(u * v.harga) : "–"], ["Kontribusi / item", rupiah(v.harga - v.var)]]; } },
};
function calcValues(o) { const c = o.data?.calc || {}; const tab = c.tab || "budget"; const v = {}; for (const [k, , d] of CALC_DEF[tab].fields) v[k] = Number(c[k] ?? d); return { tab, v }; }
function calcOutHTML(tab, v) { return CALC_DEF[tab].out(v).map(([l, val, hl]) => `<div class="${hl ? "hl" : ""}"><b class="tnum">${val}</b><span>${l}</span></div>`).join(""); }

// Widgets read the brand's data through Store.lab(): Brandlab's own records in
// the Brandlab build (js/papan/bridge.js), the made-up example brand in the
// claude.ai prototype. They never invent numbers: no data → they say so.
const inBrandlab = () => window.__papanHost === "brandlab";
const openBtn = (to, label, id = "") => (inBrandlab() ? `<button class="btn btn-secondary btn-xs" data-act="open-in" data-to="${to}"${id ? ` data-id="${esc(id)}"` : ""}>${ic("arrowRight")} ${label}</button>` : "");
const emptyW = (msg, to, label) => `<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:4px 0"><p class="muted" style="margin:0">${msg}</p>${openBtn(to, label)}</div>`;
const rupiahShort = (n) => (!isFinite(n) ? "–" : Math.abs(n) >= 1e9 ? `Rp ${num(n / 1e9, 1)} M` : Math.abs(n) >= 1e6 ? `Rp ${num(n / 1e6, 1)} jt` : rupiah(n));
const statusLabel = (L, st) => L?.contentStatusLabels?.[st] || st;
const WIDGETS = {
  dna: { name: "Brand DNA", icon: "dna", color: "#ffa52b", live: (o, L) => L.dna, open: "dna",
    body: (o, d) => {
      if (!d || d.empty) return emptyW("Brand DNA belum diisi.", "dna", "Isi Brand DNA");
      const row = (k, v) => (v && (!Array.isArray(v) || v.length) ? `<div class="wrow"><span>${k}</span><div>${Array.isArray(v) ? `<div class="chips">${v.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : esc(v)}</div></div>` : "");
      return row("Positioning", d.positioning) + row("Audiens", d.audiens) + row("Kepribadian", d.kepribadian) + row("Nilai", d.nilai) + row("Value proposition", d.vp) + row("Visi", d.visi) + row("Misi", d.misi);
    } },
  brandbook: { name: "Brand Book", icon: "palette", color: "#ff7eb6", live: (o, L) => ({ ...L.book, brandName: L.brand?.name }), open: "brandbook",
    body: (o, b) => {
      if (!b) return "";
      const light = document.documentElement.dataset.resolved === "light";
      const logo = b.logo ? `<img src="${esc(b.logo)}" alt="Logo" style="max-height:46px;max-width:60%;object-fit:contain">` : inBrandlab() ? `<b style="font-family:var(--font-display);font-size:22px">${esc(b.brandName || "")}</b>` : LOGO_SVG(light ? "#3B2418" : "#F3E6D3");
      const colors = b.colors || [];
      if (!colors.length && !b.fonts?.display && !b.voice) return emptyW("Brand Book belum diisi.", "brandbook", "Isi Brand Book");
      return `<div style="height:46px;margin-bottom:10px;display:flex;align-items:center">${logo}</div>${colors.length ? `<div class="swatches">${colors.map((c) => `<button class="sw" data-act="copy-hex" data-hex="${c.hex}" title="Salin ${c.hex}"><i style="background:${c.hex}"></i><span>${esc(c.name)}</span><small>${c.hex}</small></button>`).join("")}</div>` : '<p class="faint" style="margin:0">Warna belum dipilih.</p>'}
        ${b.fonts?.display ? `<div class="wrow" style="margin-top:8px"><span>Font</span><div><b style="font-family:'${esc(b.fonts.display)}',serif;font-size:17px;font-weight:400">${esc(b.fonts.display)}</b> <span class="muted">judul</span>${b.fonts.body && b.fonts.body !== b.fonts.display ? `<br><span style="font-family:'${esc(b.fonts.body)}',sans-serif">${esc(b.fonts.body)}</span> <span class="muted">isi</span>` : ""}</div></div>` : ""}
        ${b.voice ? `<div class="wrow"><span>Gaya bicara</span><div>${esc(b.voice).slice(0, 400)}</div></div>` : ""}
        ${(b.tone?.do || []).length ? `<div class="wrow"><span>Gaya bicara</span><div>${b.tone.do.map((t) => "✓ " + esc(t)).join("<br>")}</div></div>` : ""}
        ${(b.tone?.dont || []).length ? `<div class="wrow"><span>Hindari</span><div>${b.tone.dont.map((t) => "✕ " + esc(t)).join("<br>")}</div></div>` : ""}`;
    } },
  campaign: { name: "Campaign", icon: "megaphone", color: "#7ab8ff", live: (o, L) => L.campaigns.find((c) => c.id === o.data.ref) || L.campaigns[0] || null, open: "campaign",
    title: (o, c) => (c ? c.name : "Campaign"),
    body(o, c) {
      if (!c) return emptyW("Belum ada campaign di brand ini.", "campaign", "Buat campaign");
      let tl = "";
      if (c.start && c.end) {
        const s = new Date(c.start), e = new Date(c.end), now = Date.now(), span = e - s;
        const a = new Date(Math.min(s, now) - 86400000 * 3), z = new Date(Math.max(e, now) + 86400000 * 3), tot = z - a;
        tl = `<div class="tl" style="--wc:#7ab8ff"><i style="left:${((s - a) / tot) * 100}%;width:${(span / tot) * 100}%"></i><b style="left:${((now - a) / tot) * 100}%" title="Hari ini"></b></div>`;
      }
      const m = c.metrics;
      return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap"><span class="pill s-${esc(c.status)}">${STATUS_LABEL[c.status] || esc(c.status)}</span>${c.start ? `<span class="muted" style="font-size:11.5px;font-weight:700">${fmtDay(c.start)}${c.end ? " – " + fmtDay(c.end) : ""}</span>` : ""}</div>${tl}
        ${c.objective ? `<div class="wrow"><span>Tujuan</span><div>${esc(c.objective)}</div></div>` : ""}${c.audience ? `<div class="wrow"><span>Audiens</span><div>${esc(c.audience)}</div></div>` : ""}${c.strategy ? `<div class="wrow"><span>Ide besar</span><div>${esc(c.strategy)}</div></div>` : ""}${(c.channels || []).length ? `<div class="wrow"><span>Channel</span><div class="chips">${c.channels.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></div>` : ""}
        ${m ? `<div class="statgrid" style="margin-top:8px"><div class="stat"><b class="tnum">${num(m.reach)}</b><span>Jangkauan</span></div><div class="stat"><b class="tnum">${pct(m.er)}</b><span>ER</span></div><div class="stat"><b class="tnum">${num(m.leads)}</b><span>Transaksi</span></div></div>`
          : c.counts ? `<div class="statgrid" style="margin-top:8px;grid-template-columns:1fr 1fr"><div class="stat"><b class="tnum">${num(c.counts.content)}</b><span>Konten</span></div><div class="stat"><b class="tnum">${num(c.counts.published)}</b><span>Sudah terbit</span></div></div>`
          : `<p class="faint" style="margin:8px 0 0;font-size:11.5px">Belum ada angka: campaign belum berjalan.</p>`}
        ${c.source ? `<button class="srclink" data-act="src" data-src="${esc(c.source.objectIds?.[0] || "")}">Dari papan ↗</button>` : ""}`;
    } },
  growth: { name: "Growth & Insights", icon: "growth", color: "#3ddc84", live: (o, L) => L.growth, open: "growth",
    body: (o, g) => {
      if (!g || (!(g.followers || []).length && g.latest == null)) return emptyW("Belum ada angka Instagram. Isi atau hubungkan Insights di Brandlab.", "growth", "Buka Insights");
      const f = g.followers || [], latest = g.latest ?? f[f.length - 1];
      const stats = [[num(latest), "Followers IG"]];
      if (f.length >= 2) stats.push([(f[f.length - 1] - f[0] >= 0 ? "+" : "") + num(f[f.length - 1] - f[0]), `sejak ${g.weeks?.[0] || "awal"}`]);
      if ((g.er || []).length) stats.push([pct(g.er[g.er.length - 1]), "ER minggu ini"]);
      else if (g.reach30d != null) stats.push([num(g.reach30d), "Jangkauan 30 hari"]);
      return `<div class="statgrid" style="grid-template-columns:repeat(${stats.length},1fr)">${stats.map(([v, l]) => `<div class="stat"><b class="tnum">${v}</b><span>${l}</span></div>`).join("")}</div>${f.length >= 2 ? spark(f, "#3ddc84") : ""}${(g.top || []).length ? `<div class="wrow"><span>Konten terbaik</span><div>${g.top.map((t) => `${esc(t.title)} <b class="tnum">${pct(t.er)}</b>`).join("<br>")}</div></div>` : ""}${g.updatedAt ? `<p class="faint" style="margin:6px 0 0;font-size:11px">Diperbarui ${fmtDate(g.updatedAt)}</p>` : ""}`;
    } },
  sales: { name: "Pelacak Penjualan", icon: "sales", color: "#ffc94a", live: (o, L) => L.sales, open: "sales",
    body: (o, s) => {
      if (!s) return emptyW("Belum ada penjualan yang dicatat.", "sales", "Buka Pelacak Penjualan");
      if (s.weeks) return `<div class="statgrid" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="tnum">${rupiahShort(s.month)}</b><span>Omzet bulan ini</span></div><div class="stat"><b class="tnum">${rupiahShort(s.total)}</b><span>Total tercatat</span></div></div>${s.values.some((v) => v > 0) ? bars(s.values.map((v) => v / 1e6), s.weeks, "#ffc94a") + '<p class="faint" style="margin:0;font-size:11px">Per minggu, dalam juta rupiah</p>' : '<p class="faint" style="margin:6px 0 0">Belum ada penjualan 8 minggu terakhir.</p>'}`;
      return `<div class="statgrid" style="grid-template-columns:1fr 1fr"><div class="stat"><b class="tnum">Rp ${num(s.values[s.values.length - 1], 1)} jt</b><span>Omzet ${esc(s.months[s.months.length - 1])} (${esc(s.note)})</span></div><div class="stat"><b class="tnum" style="color:var(--good)">+${pct(((s.values[s.values.length - 1] - s.values[0]) / s.values[0]) * 100, 0)}</b><span>sejak ${esc(s.months[0])}</span></div></div>${bars(s.values, s.months, "#ffc94a")}<div class="wrow"><span>Dari campaign</span><div><b>${esc(s.link.campaign)}</b>: ${esc(s.link.txt)}</div></div>`;
    } },
  calc: { name: "Kalkulator marketing", icon: "calc", color: "#b38cff", foot: false,
    body(o) { const { tab, v } = calcValues(o); return `<div class="calc"><div class="tabs">${Object.entries(CALC_DEF).map(([k, d]) => `<button data-act="calc-tab" data-tab="${k}" class="${k === tab ? "on" : ""}">${d.label}</button>`).join("")}</div><div class="in">${CALC_DEF[tab].fields.map(([k, l]) => `<label for="cf-${o.id}-${k}">${l}</label><input id="cf-${o.id}-${k}" type="number" step="any" inputmode="decimal" data-calc="${k}" value="${v[k]}">`).join("")}</div><div class="out">${calcOutHTML(tab, v)}</div></div>`; } },
  content: { name: "Rencana konten", icon: "content", color: "#ff8a5c", live: (o, L) => L.content, open: "content",
    body: (o, list, L) => (list || []).length ? `<div class="wlist">${list.map((k) => `<div class="wi"><span class="t">${esc(k.title)}<small>${[k.platform, k.date ? fmtDay(k.date) : "", k.pic].filter(Boolean).map(esc).join(" · ") || "tanpa jadwal"}</small></span>${k.source ? `<button class="srclink" data-act="src" data-src="${esc(k.source.objectIds?.[0] || "")}">papan</button>` : ""}<button class="pill s-${esc(k.status)}" data-act="cycle-content" data-cid="${esc(k.id)}" title="Klik untuk ganti status">${esc(statusLabel(L, k.status))}</button></div>`).join("")}</div>` : emptyW("Belum ada rencana konten.", "content", "Buka Konten") },
  tasks: { name: "Tugas & milestone", icon: "task", color: "#3ddc84", live: (o, L) => ({ tasks: L.tasks, milestones: L.milestones }), open: "tasks",
    body: (o, d) => {
      if (!d || (!(d.tasks || []).length && !(d.milestones || []).length)) return emptyW("Belum ada tugas atau tujuan.", "goals", "Buka Tujuan");
      return `${(d.milestones || []).map((m) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-weight:800;font-size:12px;gap:8px"><span>${esc(m.title)}</span><span class="muted">${m.due ? fmtDay(m.due) : `${m.progress}%`}</span></div><div class="tl" style="--wc:#3ddc84"><i style="left:0;width:${m.progress}%"></i></div></div>`).join("")}
      <div class="wlist">${(d.tasks || []).map((t) => `<div class="wi${t.done ? " done" : ""}"><input type="checkbox" data-act="toggle-task" data-tid="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="Selesai"><span class="t">${esc(t.title)}<small>${[t.owner || t.goal, t.due ? fmtDay(t.due) : "tanpa tenggat"].filter(Boolean).map(esc).join(" · ")}${t.priority === "tinggi" ? " · <b style='color:var(--bad)'>prioritas</b>" : ""}</small></span>${t.source ? `<button class="srclink" data-act="src" data-src="${esc(t.source.objectIds?.[0] || "")}">papan</button>` : ""}</div>`).join("")}</div>`;
    } },
};

/* ---- 08-canvas.js ---- */
// The infinite canvas: camera, rendering, selection and every pointer/keyboard interaction.
const Canvas = (() => {
  const cam = { x: 0, y: 0, z: 1 };
  let vp, world, framesL, linksL, objsL, overlay, selL, cursorsL;
  const els = new Map();
  const sel = new Set();
  let tool = "select", toolOpts = { shape: "rect", stickyColor: "yellow", penColor: "ink", penWidth: 3 };
  let drag = null, spaceDown = false, editing = null, clientView = false;
  const busy = new Set();
  const remoteOffsets = new Map();
  const pointers = new Map();
  const handlers = new Set();
  const emit = (k, d) => handlers.forEach((f) => f(k, d));

  // rAF pauses in background tabs; fall back to a timer so the canvas still updates there.
  const nextFrame = (fn) => (document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn));
  // ---------- camera ----------
  function rect() { return vp.getBoundingClientRect(); }
  function toWorld(cx, cy) { const r = rect(); return { x: (cx - r.left - cam.x) / cam.z, y: (cy - r.top - cam.y) / cam.z }; }
  function toScreen(wx, wy) { return { x: wx * cam.z + cam.x, y: wy * cam.z + cam.y }; }
  let camRaf = 0;
  function applyCam() {
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;
    const g = 24 * cam.z;
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
    world.style.setProperty("--iz", String(clamp(1 / cam.z, 1, 5)));
    if (!camRaf) camRaf = nextFrame(() => { camRaf = 0; drawOverlay(); drawCursors(); emit("cam"); sendView(); });
  }
  const sendView = (() => { let t = 0; return () => { const now = Date.now(); if (now - t < 120) return; t = now; const r = rect(); const c = toWorld(r.left + r.width / 2, r.top + r.height / 2); Collab.presence({ view: { cx: Math.round(c.x), cy: Math.round(c.y), z: +cam.z.toFixed(3), w: Math.round(r.width), h: Math.round(r.height) } }); }; })();
  function zoomAt(z, sx, sy) {
    z = clamp(z, 0.08, 4);
    const r = rect();
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z;
    cam.z = z; cam.x = sx - wx * z; cam.y = sy - wy * z;
    applyCam();
  }
  let anim = 0;
  function animateTo(t, ms = 380) {
    cancelAnimationFrame(anim);
    if (document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) { Object.assign(cam, t); applyCam(); return; }
    const s = { ...cam }, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      cam.x = s.x + (t.x - s.x) * e; cam.y = s.y + (t.y - s.y) * e; cam.z = s.z + (t.z - s.z) * e;
      applyCam();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function camFor(b, pad = 80, maxZ = 1.2) {
    const r = rect();
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)), 0.08, maxZ);
    return { z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z };
  }
  function fit(ids, animate = true) {
    const objs = (ids ? ids.map(Store.obj).filter(Boolean) : visibleObjects()).filter((o) => o.type !== "connector");
    if (!objs.length) { const t = { x: rect().width / 2, y: rect().height / 2, z: 1 }; animate ? animateTo(t) : (Object.assign(cam, t), applyCam()); return; }
    const t = camFor(bboxOf(objs), 70, ids ? 1.4 : 1);
    animate ? animateTo(t) : (Object.assign(cam, t), applyCam());
  }
  function centerWorld() { const r = rect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
  function lookAt(view) { // follow: match the presenter's centre and zoom
    const r = rect(); const z = clamp(Math.min(view.z * Math.min(r.width / (view.w || r.width), r.height / (view.h || r.height)), 4), 0.08, 4);
    animateTo({ z, x: r.width / 2 - view.cx * z, y: r.height / 2 - view.cy * z }, 260);
  }

  // ---------- geometry ----------
  function geo(o) {
    if (o.type === "text" || o.type === "table" || o.type === "checklist") { const el = els.get(o.id); const h = el ? el.offsetHeight : o.h; return { x: o.x, y: o.y, w: o.w, h: h || o.h, r: o.r || 0 }; }
    return { x: o.x, y: o.y, w: o.w, h: o.h, r: o.r || 0 };
  }
  function corners(g) {
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2, a = ((g.r || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const dx = (sx * g.w) / 2, dy = (sy * g.h) / 2; return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; });
  }
  function bboxOf(objs) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const o of objs) {
      const pts = o.type === "connector" ? connPoints(o) : corners(geo(o));
      for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function center(o) { const g = geo(o); return { x: g.x + g.w / 2, y: g.y + g.h / 2 }; }
  function edgePoint(o, toward) { // where a line from the centre toward a point leaves the box
    const g = geo(o), c = center(o);
    let dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const a = (-(g.r || 0) * Math.PI) / 180, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const t = Math.min(Math.abs((g.w / 2 + 6) / (lx || 1e-9)), Math.abs((g.h / 2 + 6) / (ly || 1e-9)));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  function endPos(end, other) {
    if (end && end.id) { const o = Store.obj(end.id); if (o) { const oc = other && other.id && Store.obj(other.id) ? center(Store.obj(other.id)) : other && other.x != null ? other : center(o); return edgePoint(o, oc); } }
    return { x: end?.x || 0, y: end?.y || 0 };
  }
  // Flowchart lines ("elbow"): they leave and enter a box at the middle of a
  // side, across or down depending on where the other end lies.
  function elbowEnds(d) {
    const fo = d.from?.id && Store.obj(d.from.id), to = d.to?.id && Store.obj(d.to.id);
    const pa = fo ? center(fo) : { x: d.from?.x || 0, y: d.from?.y || 0 }, pb = to ? center(to) : { x: d.to?.x || 0, y: d.to?.y || 0 };
    const horiz = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
    const side = (o, c, toward) => { const g = geo(o); return horiz ? { x: toward.x > c.x ? g.x + g.w + 4 : g.x - 4, y: c.y } : { x: c.x, y: toward.y > c.y ? g.y + g.h + 4 : g.y - 4 }; };
    return { a: fo ? side(fo, pa, pb) : pa, b: to ? side(to, pb, pa) : pb, horiz };
  }
  function connPoints(o) { const d = o.data || {}; if (d.style === "elbow") { const e = elbowEnds(d); return [e.a, e.b]; } return [endPos(d.from, d.to), endPos(d.to, d.from)]; }
  const visible = (o) => !(clientView && (o.internal || insideInternal(o)));
  function insideInternal(o) {
    if (o.type === "frame") return false;
    const c = o.type === "connector" ? null : center(o); if (!c) return false;
    for (const f of Store.objects()) if (f.type === "frame" && f.internal && c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h) return true;
    return false;
  }
  const visibleObjects = () => Store.objects().filter(visible);
  function frameChildren(f) {
    return Store.objects().filter((o) => o.id !== f.id && o.type !== "frame" && o.type !== "connector" && (() => { const c = center(o); return c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h; })());
  }

  // ---------- rendering ----------
  function contentKey(o) {
    const k = { t: o.type, ln: o.linked, text: o.text, c: o.color, d: o.data, tag: o.tag, st: o.status, v: o.votes, re: o.reactions, l: o.locked, i: o.internal, fs: o.fs, b: o.bold, h: o.heading, hand: o.hand, cb: o.createdBy };
    if (o.type === "sticky" || o.type === "shape") { k.w = Math.round(o.w); k.h = Math.round(o.h); }
    if (o.type === "widget") k.lab = Store.S.labVersion;
    if (o.type === "sticky") k.nm = Collab.nameOf(o.createdBy);
    if (o.type === "widget") k.th = document.documentElement.dataset.resolved;
    k.vote = Board.votingKey();
    k.cm = commentCount(o.id);
    k.flag = Flags.get(o.id);
    return JSON.stringify(k);
  }
  let commentCounts = new Map();
  function recountComments() { commentCounts = new Map(); for (const c of Store.comments()) if (!c.resolved && c.objectId && (!clientView || !c.internal)) commentCounts.set(c.objectId, (commentCounts.get(c.objectId) || 0) + 1); }
  const commentCount = (id) => commentCounts.get(id) || 0;
  function setGeom(el, o) {
    const dx = remoteOffsets.get(o.id)?.dx || 0, dy = remoteOffsets.get(o.id)?.dy || 0;
    el.style.left = o.x + dx + "px"; el.style.top = o.y + dy + "px"; el.style.width = o.w + "px";
    el.style.height = o.type === "text" || o.type === "table" || o.type === "checklist" ? "auto" : o.h + "px";
    if (o.type === "table" || o.type === "checklist") el.style.minHeight = "60px";
    el.style.transform = o.r ? `rotate(${o.r}deg)` : "";
    el.style.zIndex = String(o.z || 0);
  }
  function chrome(o) {
    let h = "";
    const tags = [];
    if (o.tag) tags.push(`<span class="tag ${o.tag}">${{ keputusan: "Keputusan", pertanyaan: "Pertanyaan", terpilih: "★ Terpilih" }[o.tag] || esc(o.tag)}</span>`);
    if (o.ai) tags.push('<span class="tag ai">✦ AI</span>');
    if (o.status) tags.push(`<span class="tag ${o.status}">${{ review: "Minta review", approved: "✓ Disetujui", revisi: "Perlu revisi" }[o.status]}</span>`);
    if (o.linked) for (const [k, l] of [["task", "Tugas"], ["content", "Konten"], ["campaign", "Campaign"]]) if (o.linked[k]) tags.push(`<span class="tag link">↗ ${l}</span>`);
    const f = Flags.get(o.id);
    if (f) tags.push(`<span class="tag ${f.kind}">${esc(f.label)}</span>`);
    if (tags.length && o.type !== "frame") h += `<div class="tags">${tags.join("")}</div>`;
    const bd = [];
    for (const [emo, who] of Object.entries(o.reactions || {})) {
      const ids = Object.entries(who || {}).filter(([, v]) => v).map(([k]) => k);
      if (ids.length) bd.push(`<button class="bdg${ids.includes(Store.me.id) ? " mine" : ""}" data-act="react" data-emo="${esc(emo)}" title="${esc(ids.map((i) => Collab.nameOf(i)).join(", "))}">${esc(emo)} ${ids.length}</button>`);
    }
    const cm = commentCount(o.id);
    if (cm) bd.push(`<button class="bdg cm" data-act="comments">${ic("comment")} ${cm}</button>`);
    if (bd.length && o.type !== "frame" && o.type !== "pen") h += `<div class="badges">${bd.join("")}</div>`;
    if (o.type === "sticky" || o.type === "shape" || o.type === "embed" || o.type === "image") {
      const v = Board.votesFor(o);
      // While voting: only your own vote shows (no bandwagon); counts come at the end.
      if (Board.votingActive()) { if (Store.canWrite && o.type === "sticky" && (o.text || "").trim()) h += `<button class="votebtn${v.mine ? " on" : ""}" data-act="vote" title="${v.mine ? "Batalkan vote" : "Vote ide ini"}" aria-label="${v.mine ? "Batalkan vote" : "Vote ide ini"}">${v.mine ? "✓" : "+"}</button>`; }
      else if (v.count) h += `<span class="votecount" title="${v.count} vote">${v.count}</span>`;
    }
    if (o.locked) h += `<span class="lockmark" title="Terkunci">${ic("lock")}</span>`;
    return h;
  }
  function renderObj(o) {
    if (o.type === "connector") return;
    let el = els.get(o.id);
    const layer = o.type === "frame" ? framesL : objsL;
    if (!el || el.parentNode !== layer) {
      if (el) el.remove();
      el = document.createElement("div"); el.dataset.id = o.id; el._key = null;
      layer.appendChild(el); els.set(o.id, el);
    }
    el.className = `obj o-${o.type}${["table", "checklist", "embed", "widget", "doc"].includes(o.type) ? " card" : ""}${o.type === "widget" ? " o-widget" : ""}${o.type === "checklist" ? " o-check" : ""}${o.type === "text" && o.heading ? " h" : ""}${o.locked ? " locked" : ""}${o.internal ? " internal" : ""}${visible(o) ? "" : " hidden-client"}`;
    if (o.type === "sticky") el.style.background = stickyBg(o.color);
    if (!busy.has(o.id)) setGeom(el, o);
    else el.style.zIndex = String(o.z || 0);
    const key = contentKey(o);
    if (key !== el._key && editing?.id !== o.id && !el.contains(document.activeElement)) {
      el.innerHTML = (R[o.type] ? R[o.type](o) : "") + chrome(o);
      el._key = key;
      if (o.type === "sticky") fitSticky(el, o);
    }
  }
  function fitSticky(el, o) {
    const t = el.querySelector(".txt"); if (!t) return;
    let fs = o.fs || clamp(o.w / 8, 14, 32);
    t.style.fontSize = fs + "px";
    let g = 0;
    while ((t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) && fs > 9 && g++ < 40) { fs -= 1; t.style.fontSize = fs + "px"; }
  }
  function renderLinks() {
    const out = [];
    const defsColor = new Set();
    for (const o of Store.objects()) {
      if (o.type !== "connector" || !visible(o)) continue;
      const d = o.data || {};
      const off = remoteOffsets.get(o.id);
      let [a, b] = connPoints(o);
      if (drag && drag.kind === "endpoint" && drag.id === o.id) { if (drag.end === "from") a = drag.pt; else b = drag.pt; }
      const col = inkColor(o.color);
      let path, endDir, startDir, mid;
      if (d.style === "elbow") {
        const horiz = elbowEnds(d).horiz;
        if (horiz) { const mx = (a.x + b.x) / 2; path = `M${a.x} ${a.y} H${mx} V${b.y} H${b.x}`; endDir = b.x >= mx ? 0 : Math.PI; startDir = a.x <= mx ? Math.PI : 0; mid = { x: mx, y: (a.y + b.y) / 2 }; }
        else { const my = (a.y + b.y) / 2; path = `M${a.x} ${a.y} V${my} H${b.x} V${b.y}`; endDir = b.y >= my ? Math.PI / 2 : -Math.PI / 2; startDir = a.y <= my ? -Math.PI / 2 : Math.PI / 2; mid = { x: (a.x + b.x) / 2, y: my }; }
      } else if (d.style === "curve") {
        const dx = b.x - a.x, dy = b.y - a.y, horiz = Math.abs(dx) > Math.abs(dy);
        const c1 = horiz ? { x: a.x + dx * 0.45, y: a.y } : { x: a.x, y: a.y + dy * 0.45 }, c2 = horiz ? { x: b.x - dx * 0.45, y: b.y } : { x: b.x, y: b.y - dy * 0.45 };
        path = `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
        endDir = Math.atan2(b.y - c2.y, b.x - c2.x); startDir = Math.atan2(a.y - c1.y, a.x - c1.x);
        mid = { x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x, y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y };
      } else { path = `M${a.x} ${a.y} L${b.x} ${b.y}`; endDir = Math.atan2(b.y - a.y, b.x - a.x); startDir = endDir + Math.PI; mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      const head = (p, ang) => { const L = 13, w = 0.45; return `<path d="M${p.x + L * Math.cos(ang + Math.PI - w)} ${p.y + L * Math.sin(ang + Math.PI - w)} L${p.x} ${p.y} L${p.x + L * Math.cos(ang + Math.PI + w)} ${p.y + L * Math.sin(ang + Math.PI + w)}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; };
      const isSel = sel.has(o.id);
      out.push(`<g data-id="${o.id}"${off ? ` transform="translate(${off.dx} ${off.dy})"` : ""}><path class="hit" d="${path}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/>${isSel ? `<path d="${path}" fill="none" stroke="var(--accent-fill)" stroke-width="7" stroke-opacity=".35" stroke-linecap="round"/>` : ""}<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round"${d.dash ? ' stroke-dasharray="9 8"' : ""}/>${d.arrow === "end" || d.arrow === "both" ? head(b, endDir) : ""}${d.arrow === "both" ? head(a, startDir) : ""}${d.label ? `<text class="clabel" x="${mid.x}" y="${mid.y}" text-anchor="middle" dominant-baseline="central">${esc(d.label)}</text>` : ""}</g>`);
    }
    linksL.innerHTML = out.join("");
  }
  function renderAll() {
    recountComments();
    const seen = new Set();
    for (const o of Store.objects()) { renderObj(o); seen.add(o.id); }
    for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); sel.delete(id); }
    renderLinks(); drawPeerMarks(); drawOverlay();
  }
  let rr = 0;
  function scheduleRender() { if (rr) return; rr = nextFrame(() => { rr = 0; renderAll(); }); }

  // ---------- selection overlay & contextual toolbar ----------
  function selObjs() { return [...sel].map(Store.obj).filter(Boolean); }
  function drawOverlay() {
    selL.innerHTML = "";
    const objs = selObjs();
    if (drag && drag.kind === "marquee") {
      const a = toScreen(drag.x1, drag.y1), b = toScreen(drag.x2, drag.y2);
      selL.insertAdjacentHTML("beforeend", `<div class="marquee" style="left:${Math.min(a.x, b.x)}px;top:${Math.min(a.y, b.y)}px;width:${Math.abs(a.x - b.x)}px;height:${Math.abs(a.y - b.y)}px"></div>`);
    }
    if (drag && (drag.kind === "connector" || (drag.kind === "qc" && drag.moved))) {
      const a = toScreen(drag.a.x, drag.a.y), b = toScreen(drag.pt.x, drag.pt.y);
      selL.insertAdjacentHTML("beforeend", `<svg class="ghost-line" style="left:0;top:0;width:100%;height:100%;overflow:visible"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent-fill)" stroke-width="2.5" stroke-dasharray="6 6"/></svg>`);
    }
    if (drag && drag.kind === "pen" && drag.pts.length > 1) {
      const d = penPath(drag.pts.map((p) => { const s = toScreen(p[0], p[1]); return [s.x, s.y]; }));
      selL.insertAdjacentHTML("beforeend", `<svg class="ghost-line" style="left:0;top:0;width:100%;height:100%;overflow:visible"><path d="${d}" fill="none" stroke="${inkColor(toolOpts.penColor)}" stroke-width="${toolOpts.penWidth * cam.z}" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    }
    if (drag && drag.kind === "create" && drag.moved) {
      const a = toScreen(Math.min(drag.x1, drag.x2), Math.min(drag.y1, drag.y2));
      selL.insertAdjacentHTML("beforeend", `<div class="marquee" style="left:${a.x}px;top:${a.y}px;width:${Math.abs(drag.x2 - drag.x1) * cam.z}px;height:${Math.abs(drag.y2 - drag.y1) * cam.z}px;border-radius:${drag.type === "frame" ? 14 : 6}px"></div>`);
    }
    if (!objs.length) { UI.ctx(null); return; }
    const showHandles = !drag || drag.kind === "resize" || drag.kind === "rotate";
    if (objs.length === 1 && objs[0].type === "connector") {
      const [a, b] = connPoints(objs[0]).map((p) => toScreen(p.x, p.y));
      if (showHandles && !objs[0].locked && Store.canWrite) {
        selL.insertAdjacentHTML("beforeend", `<div class="hdl ep" data-h="ep-from" style="left:${a.x}px;top:${a.y}px"></div><div class="hdl ep" data-h="ep-to" style="left:${b.x}px;top:${b.y}px"></div>`);
      }
      UI.ctx(objs, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      return;
    }
    let box;
    if (objs.length === 1) {
      const g = geo(objs[0]), p = toScreen(g.x, g.y);
      const w = g.w * cam.z, h = g.h * cam.z;
      const div = document.createElement("div");
      div.className = "selbox";
      div.style.cssText = `left:${p.x + w / 2}px;top:${p.y + h / 2}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${g.r || 0}deg);transform-origin:50% 50%`;
      selL.appendChild(div);
      if (showHandles && !objs[0].locked && Store.canWrite && !(drag && drag.kind === "move")) {
        const pts = handlePositions(g);
        for (const [k, pt] of Object.entries(pts)) {
          if ((objs[0].type === "text" || objs[0].type === "table" || objs[0].type === "checklist") && /^(n|s|nw|ne|sw|se)$/.test(k)) continue;
          const s = toScreen(pt.x, pt.y);
          selL.insertAdjacentHTML("beforeend", `<div class="hdl${k === "rot" ? " rot" : ""}" data-h="${k}" style="left:${s.x}px;top:${s.y}px;cursor:${k === "rot" ? "grab" : cursorFor(k, g.r || 0)}"></div>`);
        }
        // Flowchart: a + on each side adds the next step (click) or draws a line (drag).
        if (["shape", "sticky"].includes(objs[0].type) && !g.r) {
          const sides = { e: [g.x + g.w, g.y + g.h / 2, 1, 0], w: [g.x, g.y + g.h / 2, -1, 0], s: [g.x + g.w / 2, g.y + g.h, 0, 1], n: [g.x + g.w / 2, g.y, 0, -1] };
          for (const [k, [x, y, dx, dy]] of Object.entries(sides)) { const s = toScreen(x, y); selL.insertAdjacentHTML("beforeend", `<div class="hdl qc" data-h="qc-${k}" style="left:${s.x + dx * 24}px;top:${s.y + dy * 24}px" title="Klik: langkah berikutnya · Tarik: sambungkan">+</div>`); }
        }
      }
      const cs = corners(g).map((c) => toScreen(c.x, c.y));
      const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
      box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } else {
      const b = bboxOf(objs), p = toScreen(b.x, b.y);
      box = { x: p.x, y: p.y, w: b.w * cam.z, h: b.h * cam.z };
      selL.insertAdjacentHTML("beforeend", `<div class="selbox multi" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
      for (const o of objs) {
        if (o.type === "connector") continue;
        const g = geo(o), q = toScreen(g.x, g.y);
        selL.insertAdjacentHTML("beforeend", `<div class="selbox" style="left:${q.x + (g.w * cam.z) / 2}px;top:${q.y + (g.h * cam.z) / 2}px;width:${g.w * cam.z}px;height:${g.h * cam.z}px;transform:translate(-50%,-50%) rotate(${g.r || 0}deg);opacity:.5"></div>`);
      }
      if (showHandles && Store.canWrite && !objs.some((o) => o.locked) && !(drag && drag.kind === "move")) for (const k of ["nw", "ne", "sw", "se"]) {
        const s = { nw: [box.x, box.y], ne: [box.x + box.w, box.y], sw: [box.x, box.y + box.h], se: [box.x + box.w, box.y + box.h] }[k];
        selL.insertAdjacentHTML("beforeend", `<div class="hdl" data-h="m-${k}" style="left:${s[0]}px;top:${s[1]}px;cursor:${k === "nw" || k === "se" ? "nwse-resize" : "nesw-resize"}"></div>`);
      }
    }
    UI.ctx(drag || editing ? null : objs, box);
  }
  function handlePositions(g) {
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2, a = ((g.r || 0) * Math.PI) / 180;
    const P = (lx, ly) => ({ x: cx + lx * Math.cos(a) - ly * Math.sin(a), y: cy + lx * Math.sin(a) + ly * Math.cos(a) });
    const w = g.w / 2, h = g.h / 2;
    return { nw: P(-w, -h), n: P(0, -h), ne: P(w, -h), e: P(w, 0), se: P(w, h), s: P(0, h), sw: P(-w, h), w: P(-w, 0), rot: P(0, -h - 28 / cam.z) };
  }
  function cursorFor(k, r) {
    const base = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }[k];
    const a = (((base + r) % 180) + 180) % 180;
    return a < 22.5 || a >= 157.5 ? "ns-resize" : a < 67.5 ? "nesw-resize" : a < 112.5 ? "ew-resize" : "nwse-resize";
  }
  function select(ids, add = false) {
    if (!add) sel.clear();
    for (const id of ids) {
      const o = Store.obj(id); if (!o) continue;
      if (o.group) for (const g of Store.objects()) if (g.group === o.group) sel.add(g.id);
      sel.add(id);
    }
    afterSel();
  }
  function deselect() { if (!sel.size) return; sel.clear(); afterSel(); }
  function afterSel() { renderLinks(); drawOverlay(); Collab.presence({ sel: [...sel].slice(0, 12) }); emit("selection"); }

  // ---------- peers ----------
  function drawPeerMarks() {
    for (const el of els.values()) { el.classList.remove("peer-sel"); el.querySelector(":scope > .peer-tag")?.remove(); }
    const bid = Store.S.boardId;
    for (const p of Collab.others()) {
      const pr = p.presence || {}; if (pr.b !== bid) continue;
      const col = Collab.colorOf(p.by || pr.uid), nm = Collab.nameOf(p.by || pr.uid, pr.nm);
      for (const id of pr.sel || []) { const el = els.get(id); if (el) { el.classList.add("peer-sel"); el.style.setProperty("--peer", col); } }
      if (pr.edit) { const el = els.get(pr.edit); if (el) el.insertAdjacentHTML("beforeend", `<span class="peer-tag" style="background:${col}">${esc(nm)} sedang mengetik…</span>`); }
    }
  }
  function drawCursors() {
    const bid = Store.S.boardId;
    const seen = new Set();
    for (const p of Collab.others()) {
      const pr = p.presence || {};
      if (pr.b !== bid || !pr.cur) continue;
      seen.add(p.peer);
      let el = cursorsL.querySelector(`[data-peer="${p.peer}"]`);
      const col = Collab.colorOf(p.by || pr.uid), nm = Collab.nameOf(p.by || pr.uid, pr.nm) + (p.isMe ? " (tab lain)" : "");
      if (!el) { el = document.createElement("div"); el.className = "cursor"; el.dataset.peer = p.peer; cursorsL.appendChild(el); }
      const html = `<svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.6L9.6 20z" fill="${col}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span style="background:${col}">${esc(nm)}</span>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      const s = toScreen(pr.cur.x, pr.cur.y);
      el.style.transform = `translate(${s.x}px,${s.y}px)`;
    }
    for (const el of [...cursorsL.children]) if (!seen.has(el.dataset.peer)) el.remove();
  }
  function onPeers() {
    // live drag preview from teammates
    const bid = Store.S.boardId, next = new Map();
    for (const p of Collab.others()) { const pr = p.presence || {}; if (pr.b === bid && pr.drag) for (const id of pr.drag.ids || []) if (!busy.has(id)) next.set(id, { dx: pr.drag.dx, dy: pr.drag.dy, peer: p.peer }); }
    const changed = new Set([...remoteOffsets.keys(), ...next.keys()]);
    for (const id of changed) {
      const a = remoteOffsets.get(id), b = next.get(id);
      if (a && !b) { // drop: keep the ghost offset until the real position lands (or 2 s)
        if (!a.until) { a.until = Date.now() + 2000; a.x0 = Store.obj(id)?.x; a.y0 = Store.obj(id)?.y; }
        continue;
      }
      if (b) remoteOffsets.set(id, b);
    }
    for (const id of changed) { const o = Store.obj(id); const el = els.get(id); if (o && el && !busy.has(id)) setGeom(el, o); }
    renderLinks(); drawPeerMarks(); drawCursors();
    // follow
    if (Collab.followPeer) {
      const p = Collab.others().find((x) => x.peer === Collab.followPeer);
      const v = p && p.presence?.view;
      if (p && p.presence?.b && p.presence.b !== bid) Board.open(p.presence.b);
      if (v && (!lastFollow || lastFollow.cx !== v.cx || lastFollow.cy !== v.cy || lastFollow.z !== v.z)) { lastFollow = v; following = true; lookAt(v); setTimeout(() => (following = false), 300); }
    }
  }
  let lastFollow = null, following = false;
  function settleOffsets(ids) {
    for (const id of ids) { const a = remoteOffsets.get(id); if (!a || !a.until) continue; const o = Store.obj(id); if (!o || o.x !== a.x0 || o.y !== a.y0 || Date.now() > a.until) remoteOffsets.delete(id); }
  }
  setInterval(() => { let ch = false; for (const [id, a] of remoteOffsets) if (a.until && Date.now() > a.until) { remoteOffsets.delete(id); ch = true; } if (ch) scheduleRender(); }, 700);

  // ---------- hit testing ----------
  function objAt(target) { const el = target.closest && target.closest(".obj"); return el ? Store.obj(el.dataset.id) : null; }
  function connAt(target) { const g = target.closest && target.closest("g[data-id]"); return g ? Store.obj(g.dataset.id) : null; }
  function penHit(o, p, rad) {
    const d = o.data || {}; if (!d.points) return false;
    const g = geo(o), sx = g.w / (d.ow || g.w), sy = g.h / (d.oh || g.h);
    for (let i = 1; i < d.points.length; i++) {
      const a = { x: o.x + d.points[i - 1][0] * sx, y: o.y + d.points[i - 1][1] * sy }, b = { x: o.x + d.points[i][0] * sx, y: o.y + d.points[i][1] * sy };
      const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1, t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / l2, 0, 1);
      const dx = a.x + vx * t - p.x, dy = a.y + vy * t - p.y;
      if (dx * dx + dy * dy < rad * rad) return true;
    }
    return false;
  }
  function frameAtPoint(p) { // topmost frame whose title or body is under the point (frames sit under objects)
    const fr = Store.objects().filter((o) => o.type === "frame" && visible(o)).sort((a, b) => (b.z || 0) - (a.z || 0));
    return fr.find((f) => p.x > f.x && p.x < f.x + f.w && p.y > f.y && p.y < f.y + f.h) || null;
  }

  // ---------- pointer handling ----------
  function isInteractive(t) { return t.closest("input, textarea, select, a, button, [contenteditable='true'], .no-drag"); }
  function onDown(e) {
    if (e.target.closest(".ctx, .pop")) return;
    vp.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    const p = toWorld(e.clientX, e.clientY);
    UI.closePops();
    if (Collab.followPeer && !following) Collab.stopFollow();
    const h = e.target.closest(".hdl");
    if (h) { startHandle(e, h.dataset.h, p); return; }
    if (e.button === 1 || tool === "hand" || spaceDown) { startPan(e); return; }
    if (e.button === 2) return;
    if (editing && !e.target.closest(`[data-id="${editing.id}"]`)) finishEdit();
    const hitObj = objAt(e.target), hitConn = !hitObj && connAt(e.target);
    if (!Store.canWrite && tool !== "select") setTool("select");
    switch (tool) {
      case "pen": drag = { kind: "pen", pts: [[p.x, p.y]] }; capture(e); return;
      case "eraser": drag = { kind: "erase", hits: new Map() }; capture(e); eraseAt(p); return;
      case "connector": {
        const a = hitObj && hitObj.type !== "frame" ? { id: hitObj.id } : { x: p.x, y: p.y };
        drag = { kind: "connector", from: a, a: a.id ? center(hitObj) : p, pt: p }; capture(e); drawOverlay(); return;
      }
      case "comment": {
        const o = hitObj || hitConn || frameAtPoint(p);
        if (o) { select([o.id]); Panels.comments(o.id); } else toast("Klik sebuah objek untuk memberi komentar");
        return;
      }
      case "sticky": case "text": case "shape": case "frame":
        if (hitObj && isInteractive(e.target)) break;
        drag = { kind: "create", type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, moved: false }; capture(e); return;
    }
    // select tool
    if (isInteractive(e.target) && hitObj) { if (!sel.has(hitObj.id)) select([hitObj.id]); return; }
    // Voting: a click on a written sticky is a vote (a second click takes it back).
    if (Board.votingActive() && Store.canWrite && hitObj?.type === "sticky" && (hitObj.text || "").trim() && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (e.detail < 2) Board.toggleVote(hitObj);
      return;
    }
    let target = hitObj || hitConn;
    if (target && target.type === "frame" && !e.target.closest(".ftitle")) target = null; // frame body = empty canvas, title = frame
    if (!target && e.pointerType === "touch") { startPan(e); return; } // one finger on empty canvas pans on phones/tablets
    if (target) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) { if (sel.has(target.id)) { sel.delete(target.id); afterSel(); } else select([target.id], true); return; }
      if (!sel.has(target.id)) select([target.id]);
      if (e.detail >= 2) return;
      startMove(e, p);
      return;
    }
    if (!e.shiftKey) deselect();
    drag = { kind: "marquee", x1: p.x, y1: p.y, x2: p.x, y2: p.y, add: e.shiftKey, base: new Set(sel) };
    capture(e);
  }
  function capture(e) { try { vp.setPointerCapture(e.pointerId); } catch {} }
  function startPan(e) { drag = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; vp.classList.add("panning"); capture(e); }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    drag = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.z, mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cam } };
  }
  function startMove(e, p) {
    const objs = selObjs().filter((o) => !o.locked);
    if (!objs.length || !Store.canWrite) return;
    const ids = new Set(objs.map((o) => o.id));
    for (const o of objs) if (o.type === "frame") for (const c of frameChildren(o)) if (!c.locked) ids.add(c.id);
    // connectors with both free ends inside the selection move too
    const moving = [...ids].map(Store.obj);
    drag = { kind: "move", start: p, ids: [...ids], orig: new Map(moving.map((o) => [o.id, clone(o)])), moved: false };
    capture(e);
  }
  function startHandle(e, h, p) {
    const objs = selObjs(); if (!objs.length) return;
    if (h.startsWith("ep-")) { drag = { kind: "endpoint", id: objs[0].id, end: h.slice(3), orig: clone(objs[0]), pt: p }; capture(e); return; }
    if (h.startsWith("qc-")) { const o = objs[0]; drag = { kind: "qc", dir: h.slice(3), id: o.id, a: center(o), pt: p, sx: e.clientX, sy: e.clientY, moved: false }; capture(e); return; }
    if (h.startsWith("m-")) { const b = bboxOf(objs); drag = { kind: "mresize", h: h.slice(2), box: b, orig: new Map(objs.map((o) => [o.id, clone(o)])) }; capture(e); return; }
    const o = objs[0];
    if (h === "rot") { const c = center(o); drag = { kind: "rotate", id: o.id, c, a0: Math.atan2(p.y - c.y, p.x - c.x), r0: o.r || 0, orig: clone(o) }; }
    else drag = { kind: "resize", id: o.id, h, orig: clone(o), g: geo(o) };
    busy.add(o.id);
    capture(e);
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toWorld(e.clientX, e.clientY);
    if ((e.target instanceof Node && vp.contains(e.target)) || drag) Collab.presence({ cur: { x: Math.round(p.x), y: Math.round(p.y) }, b: Store.S.boardId });
    if (!drag) return;
    switch (drag.kind) {
      case "pan": cam.x = drag.cx + e.clientX - drag.sx; cam.y = drag.cy + e.clientY - drag.sy; applyCam(); break;
      case "qc": drag.pt = p; if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true; drawOverlay(); break;
      case "pinch": {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clamp(drag.z0 * (d / drag.d0), 0.08, 4), r = rect();
        const wx = (drag.mid0.x - r.left - drag.cam0.x) / drag.cam0.z, wy = (drag.mid0.y - r.top - drag.cam0.y) / drag.cam0.z;
        cam.z = z; cam.x = mid.x - r.left - wx * z; cam.y = mid.y - r.top - wy * z; applyCam(); break;
      }
      case "marquee": {
        drag.x2 = p.x; drag.y2 = p.y;
        const x1 = Math.min(drag.x1, drag.x2), x2 = Math.max(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2), y2 = Math.max(drag.y1, drag.y2);
        sel.clear(); for (const id of drag.base) sel.add(id);
        for (const o of visibleObjects()) {
          if (o.type === "frame") { if (o.x > x1 && o.y > y1 && o.x + o.w < x2 && o.y + o.h < y2) sel.add(o.id); continue; }
          const b = o.type === "connector" ? bboxOf([o]) : bboxOf([o]);
          if (b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1) sel.add(o.id);
        }
        renderLinks(); drawOverlay(); break;
      }
      case "move": {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx * cam.z, dy * cam.z) < 3) return;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        drag.moved = true; drag.dx = dx; drag.dy = dy;
        for (const id of drag.ids) {
          busy.add(id);
          const o = drag.orig.get(id), el = els.get(id);
          if (o.type === "connector") continue;
          if (el) { el.style.left = o.x + dx + "px"; el.style.top = o.y + dy + "px"; }
          const live = Store.obj(id); if (live) { live.x = o.x + dx; live.y = o.y + dy; } // keep connectors attached while dragging
        }
        for (const id of drag.ids) { const o = drag.orig.get(id); if (o.type === "connector") moveFreeEnds(id, o, dx, dy); }
        renderLinks(); drawOverlay();
        Collab.presence({ drag: { ids: drag.ids.slice(0, 40), dx: Math.round(dx), dy: Math.round(dy) } });
        break;
      }
      case "resize": doResize(p, e.shiftKey); break;
      case "mresize": doMultiResize(p); break;
      case "rotate": {
        let a = drag.r0 + ((Math.atan2(p.y - drag.c.y, p.x - drag.c.x) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 360) % 360; if (Math.abs(a) < 2 || Math.abs(a - 360) < 2) a = 0;
        const live = Store.obj(drag.id); live.r = a; setGeom(els.get(drag.id), live); renderLinks(); drawOverlay(); break;
      }
      case "endpoint": drag.pt = p; renderLinks(); drawOverlay(); break;
      case "connector": drag.pt = p; drawOverlay(); break;
      case "pen": { const l = drag.pts[drag.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * cam.z > 2) drag.pts.push([p.x, p.y]); drawOverlay(); break; }
      case "erase": eraseAt(p); break;
      case "create": drag.x2 = p.x; drag.y2 = p.y; drag.moved = drag.moved || Math.hypot((drag.x2 - drag.x1) * cam.z, (drag.y2 - drag.y1) * cam.z) > 6; drawOverlay(); break;
    }
  }
  function moveFreeEnds(id, o, dx, dy) {
    const live = Store.obj(id); if (!live) return;
    const d = clone(o.data);
    if (!d.from.id) { d.from.x += dx; d.from.y += dy; }
    if (!d.to.id) { d.to.x += dx; d.to.y += dy; }
    live.data = d;
  }
  function doResize(p, keep) {
    const o = drag.orig, g = drag.g, live = Store.obj(drag.id); if (!live) return;
    const h = drag.h, hx = h.includes("e") ? 1 : h.includes("w") ? -1 : 0, hy = h.includes("s") ? 1 : h.includes("n") ? -1 : 0;
    // Keep the opposite corner/edge (anchor A) fixed; work in the object's rotated axes.
    const a = ((g.r || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    const ax = (-hx * g.w) / 2, ay = (-hy * g.h) / 2;
    const A = { x: cx + ax * c - ay * s, y: cy + ax * s + ay * c };
    const vx = p.x - A.x, vy = p.y - A.y;
    const lx = vx * c + vy * s, ly = -vx * s + vy * c;
    const min = o.type === "text" ? 60 : 24;
    let w = hx ? Math.max(min, hx * lx) : g.w, hh = hy ? Math.max(min, hy * ly) : g.h;
    const ratioLock = keep || ((o.type === "image" || o.type === "pen" || o.type === "widget") && hx && hy);
    if (ratioLock && hx && hy) { const r = g.w / g.h; if (w / hh > r) hh = w / r; else w = hh * r; }
    const ox = hx ? (hx * w) / 2 : 0, oy = hy ? (hy * hh) / 2 : 0; // new centre relative to A, local axes
    const ncx = A.x + ox * c - oy * s, ncy = A.y + ox * s + oy * c;
    live.w = w; live.h = hh; live.x = ncx - w / 2; live.y = ncy - hh / 2;
    if (o.type === "text") live.h = o.h;
    const el = els.get(drag.id); setGeom(el, live);
    if (o.type === "sticky") fitSticky(el, live);
    if (o.type === "shape") { const svg = el.querySelector("svg.sh"); if (svg) svg.outerHTML = shapeSVG(live); }
    renderLinks(); drawOverlay();
  }
  function doMultiResize(p) {
    const b = drag.box, h = drag.h;
    const ax = h.includes("w") ? b.x + b.w : b.x, ay = h.includes("n") ? b.y + b.h : b.y;
    const sx = Math.max(0.1, Math.abs(p.x - ax) / b.w), sy = Math.max(0.1, Math.abs(p.y - ay) / b.h), s = Math.max(sx, sy);
    for (const [id, o] of drag.orig) {
      const live = Store.obj(id); if (!live) continue; busy.add(id);
      if (o.type === "connector") { const d = clone(o.data); for (const k of ["from", "to"]) if (!d[k].id) { d[k].x = ax + (d[k].x - ax) * s; d[k].y = ay + (d[k].y - ay) * s; } live.data = d; continue; }
      live.x = ax + (o.x - ax) * s; live.y = ay + (o.y - ay) * s; live.w = o.w * s; live.h = o.h * s;
      if (o.fs) live.fs = o.fs * s;
      const el = els.get(id); setGeom(el, live);
      if (o.type === "sticky") fitSticky(el, live);
      if (o.type === "text") { const t = el.querySelector(".txt"); if (t) t.style.fontSize = (o.fs || 18) * s + "px"; }
    }
    drag.s = s;
    renderLinks(); drawOverlay();
  }
  function eraseAt(p) {
    const rad = 10 / cam.z;
    for (const o of Store.objects()) {
      if (o.type !== "pen" || drag.hits.has(o.id) || o.locked || (GUEST() && o.createdBy !== Store.me.id)) continue;
      if (penHit(o, p, rad)) { drag.hits.set(o.id, clone(o)); const el = els.get(o.id); if (el) el.style.opacity = ".15"; }
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!drag) return;
    const d = drag; drag = null;
    vp.classList.remove("panning");
    if (d.kind === "pinch") { if (pointers.size === 1) { const [q] = pointers.values(); drag = { kind: "pan", sx: q.x, sy: q.y, cx: cam.x, cy: cam.y }; } return; }
    const p = toWorld(e.clientX, e.clientY);
    switch (d.kind) {
      case "qc": {
        const src = Store.obj(d.id); if (!src) break;
        if (!d.moved) { quickAdd(src, d.dir); break; }
        const hit = objUnder(e);
        if (hit && hit.id !== src.id && hit.type !== "frame" && hit.type !== "connector") { link(src, hit); break; }
        quickAdd(src, d.dir, p);
        break;
      }
      case "move": {
        Collab.presence({ drag: null });
        if (!d.moved) { for (const id of d.ids) busy.delete(id); break; }
        const changes = [];
        for (const id of d.ids) {
          const before = d.orig.get(id), after = clone(Store.obj(id) || before);
          if (before.type !== "connector") { after.x = Math.round(before.x + d.dx); after.y = Math.round(before.y + d.dy); }
          // restore the in-place mutation so commit() sees the real before
          Object.assign(Store.obj(id) || {}, { x: before.x, y: before.y, data: before.data });
          changes.push({ id, before, after });
        }
        for (const id of d.ids) busy.delete(id);
        Store.commit(changes); History.push(changes, "Pindah");
        break;
      }
      case "resize": case "rotate": {
        const live = Store.obj(d.id); busy.delete(d.id); if (!live) break;
        const after = { ...clone(live), x: Math.round(live.x), y: Math.round(live.y), w: Math.round(live.w), h: Math.round(live.h) };
        Object.assign(live, { x: d.orig.x, y: d.orig.y, w: d.orig.w, h: d.orig.h, r: d.orig.r });
        const ch = [{ id: d.id, before: d.orig, after }]; Store.commit(ch); History.push(ch, d.kind === "rotate" ? "Putar" : "Ubah ukuran");
        break;
      }
      case "mresize": {
        const changes = [];
        for (const [id, before] of d.orig) { const live = Store.obj(id); busy.delete(id); if (!live) continue; const after = clone(live); Object.assign(live, before); changes.push({ id, before, after }); }
        Store.commit(changes); History.push(changes, "Ubah ukuran");
        break;
      }
      case "endpoint": {
        const o = Store.obj(d.id); if (!o) break;
        const hit = objUnder(e);
        const end = hit && hit.type !== "connector" && hit.type !== "frame" ? { id: hit.id, x: null, y: null } : { id: null, x: Math.round(p.x), y: Math.round(p.y) };
        const after = clone(o); after.data[d.end] = end;
        const ch = [{ id: o.id, before: d.orig, after }]; Store.commit(ch); History.push(ch, "Sambung");
        break;
      }
      case "connector": {
        const hit = objUnder(e);
        const to = hit && hit.type !== "frame" && hit.type !== "connector" ? { id: hit.id } : { x: Math.round(p.x), y: Math.round(p.y) };
        if (to.id && to.id === d.from.id) break;
        if (!to.id && !d.from.id && Math.hypot((p.x - d.a.x) * cam.z, (p.y - d.a.y) * cam.z) < 12) { drawOverlay(); break; }
        const o = Store.newObject({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: null, x: null, y: null, ...d.from }, to: { id: null, x: null, y: null, ...to }, arrow: "end", style: "curve", dash: false } });
        add([o], { select: true, keepTool: true });
        break;
      }
      case "pen": {
        if (d.pts.length < 2) { drawOverlay(); break; }
        const xs = d.pts.map((q) => q[0]), ys = d.pts.map((q) => q[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(8, Math.max(...xs) - x), h = Math.max(8, Math.max(...ys) - y);
        const pts = d.pts.map((q) => [+(q[0] - x).toFixed(1), +(q[1] - y).toFixed(1)]);
        const o = Store.newObject({ type: "pen", x, y, w, h, color: toolOpts.penColor, data: { points: pts, ow: w, oh: h, width: toolOpts.penWidth } });
        add([o], { keepTool: true });
        break;
      }
      case "erase": {
        if (!d.hits.size) break;
        const ch = [...d.hits.values()].map((o) => ({ id: o.id, before: o, after: null }));
        Store.commit(ch); History.push(ch, "Hapus coretan");
        break;
      }
      case "create": {
        const x1 = Math.min(d.x1, d.x2), y1 = Math.min(d.y1, d.y2);
        const w = Math.abs(d.x2 - d.x1), h = Math.abs(d.y2 - d.y1);
        createAt(d.type, d.moved ? { x: x1, y: y1, w, h } : { cx: d.x1, cy: d.y1 });
        break;
      }
      case "marquee": drawOverlay(); afterSel(); break;
    }
  }
  function objUnder(e) {
    const els2 = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els2) { const o = el.closest && el.closest(".obj"); if (o && o.dataset.id) { const ob = Store.obj(o.dataset.id); if (ob && ob.type !== "frame") return ob; } }
    return null;
  }
  function onWheel(e) {
    e.preventDefault();
    if (Collab.followPeer && !following) Collab.stopFollow();
    const r = rect();
    if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-e.deltaY * 0.0105), e.clientX - r.left, e.clientY - r.top);
    else { cam.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; cam.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; applyCam(); }
  }
  function onDbl(e) {
    if (!Store.canWrite) return;
    let o = objAt(e.target);
    if (o && o.type === "frame" && !e.target.closest(".ftitle")) o = null;
    if (o) {
      if (o.locked) return toast("Objek terkunci. Buka kuncinya dulu.");
      const cell = e.target.closest("[data-cell]"), item = e.target.closest("[data-item]"), f = e.target.closest("[data-f]");
      if (cell) return startEdit(o.id, { cell: cell.dataset.cell });
      if (item) return startEdit(o.id, { item: +item.dataset.item });
      if (f) return startEdit(o.id, { field: f.dataset.f });
      if (o.type === "checklist" && e.target.closest(".ttl")) return startEdit(o.id, { title: true });
      if (["sticky", "text", "shape", "frame"].includes(o.type)) return startEdit(o.id);
      if (o.type === "widget") return Panels.widget(o.id);
      if (o.type === "embed") return startEdit(o.id, { field: "title" });
      return;
    }
    if (connAt(e.target) || tool !== "select") return;
    const p = toWorld(e.clientX, e.clientY);
    const f = frameAtPoint(p);
    if (f && e.target.closest(".ftitle")) return startEdit(f.id);
    createAt("sticky", { cx: p.x, cy: p.y });
  }

  // ---------- creating ----------
  function defaults(type) {
    switch (type) {
      case "sticky": return { w: 200, h: 200, color: toolOpts.stickyColor, text: "" };
      case "text": return { w: 320, h: 30, color: "ink", text: "", fs: 22 };
      case "shape": return { w: toolOpts.shape === "diamond" ? 240 : 220, h: toolOpts.shape === "pill" ? 80 : ["para", "doc", "rect"].includes(toolOpts.shape) ? 120 : 150, color: { pill: "#3ddc84", diamond: "#ffc94a", para: "#ff7eb6", doc: "#b38cff" }[toolOpts.shape] || "#7ab8ff", text: "", data: { shape: toolOpts.shape, fill: true } };
      case "frame": return { w: 640, h: 440, color: "#ffa52b", text: "Frame baru" };
    }
  }
  // Flowchart: the next step beside a box (or where the line was dropped),
  // joined by an arrow. After a start/end pill or a decision comes a process box.
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function link(src, dst) {
    const c = Store.newObject({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: src.id, x: null, y: null }, to: { id: dst.id, x: null, y: null }, arrow: "end", style: "elbow", dash: false } });
    add([c]); return c;
  }
  function quickAdd(src, dir, at) {
    if (!Store.canWrite) return;
    const g = geo(src), gap = 110, isShape = src.type === "shape";
    const shape = isShape ? (["pill", "diamond"].includes(src.data?.shape) ? "rect" : src.data?.shape || "rect") : null;
    const fresh = isShape && shape !== src.data?.shape;
    const w = fresh ? 220 : g.w, h = fresh ? 110 : g.h;
    let x, y;
    if (at) { x = at.x - w / 2; y = at.y - h / 2; }
    else {
      const [vx, vy] = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }[dir];
      x = vx > 0 ? g.x + g.w + gap : vx < 0 ? g.x - gap - w : g.x + g.w / 2 - w / 2;
      y = vy > 0 ? g.y + g.h + gap : vy < 0 ? g.y - gap - h : g.y + g.h / 2 - h / 2;
      for (let i = 0; i < 8 && Store.objects().some((o) => o.id !== src.id && !["connector", "frame", "pen"].includes(o.type) && overlaps(geo(o), { x, y, w, h })); i++) { x += vx * (w + gap); y += vy * (h + gap); }
    }
    const n = Store.newObject(isShape
      ? { type: "shape", x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), ...(src.fs ? { fs: src.fs } : {}), color: fresh ? "#7ab8ff" : src.color, text: "", data: { ...(src.data || {}), shape } }
      : { type: "sticky", x: Math.round(x), y: Math.round(y), w: g.w, h: g.h, color: src.color, text: "" });
    const c = Store.newObject({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: src.id, x: null, y: null }, to: { id: n.id, x: null, y: null }, arrow: "end", style: "elbow", dash: false } });
    add([n, c]);
    renderAll(); // the box must be on the page before its text can be edited
    select([n.id]);
    setTimeout(() => startEdit(n.id), 30);
    return n;
  }
  // Nearest empty spot around `near` for a w×h group, so new things (chat
  // ideas, a table, a flowchart) never land on top of what's already there.
  function freeSpot(w, h, near) {
    const boxes = Store.objects().filter((o) => o.type !== "connector").map((o) => bboxOf([o]));
    const gap = 40, step = 260;
    const free = (c) => !boxes.some((b) => c.x - w / 2 - gap < b.x + b.w && c.x + w / 2 + gap > b.x && c.y - h / 2 - gap < b.y + b.h && c.y + h / 2 + gap > b.y);
    if (free(near)) return near;
    for (let ring = 1; ring <= 14; ring++) {
      const cand = [];
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) cand.push({ x: near.x + dx * step, y: near.y + dy * step });
      }
      cand.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
      const hit = cand.find(free);
      if (hit) return hit;
    }
    return near;
  }
  function createAt(type, at) {
    const d = defaults(type);
    let o;
    if (at.w != null && at.w > 20 && at.h > 20 && type !== "sticky" && type !== "text") o = Store.newObject({ type, ...d, x: Math.round(at.x), y: Math.round(at.y), w: Math.round(at.w), h: Math.round(at.h) });
    else { const cx = at.cx ?? at.x + at.w / 2, cy = at.cy ?? at.y + at.h / 2; o = Store.newObject({ type, ...d, x: Math.round(cx - d.w / 2), y: Math.round(cy - (type === "text" ? 15 : d.h / 2)) }); }
    add([o], { select: true });
    setTool("select");
    if (cam.z < 0.45) { const r = rect(), z = 0.9; Object.assign(cam, { z, x: r.width / 2 - (o.x + o.w / 2) * z, y: r.height / 2 - (o.y + Math.min(o.h, 200) / 2) * z }); applyCam(); }
    setTimeout(() => startEdit(o.id), 30);
    return o;
  }
  function add(objs, opts = {}) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
    const ch = objs.map((o) => ({ id: o.id, before: null, after: o }));
    Store.commit(ch); History.push(ch, "Tambah");
    if (opts.select) select(objs.filter((o) => o.type !== "connector" || objs.length === 1).map((o) => o.id));
    if (!opts.keepTool) setTool("select");
    return objs;
  }
  // Insert a set of objects (template, paste, AI result) centred at a point, remapping ids.
  function insertObjects(list, at, opts = {}) {
    if (!list.length) return [];
    const map = new Map(list.map((o) => [o.id, uid("o")]));
    const real = list.filter((o) => o.type !== "connector");
    const b = real.length ? bboxRaw(real) : { x: 0, y: 0, w: 0, h: 0 };
    const c = at || centerWorld();
    const dx = Math.round(c.x - (b.x + b.w / 2)), dy = Math.round(c.y - (b.y + b.h / 2));
    const zF = Store.nextZ("frame"), zO = Store.nextZ("sticky");
    const groupMap = new Map();
    const out = list.map((o, i) => {
      const n = clone(o); n.id = map.get(o.id);
      if (n.type !== "connector") { n.x += dx; n.y += dy; }
      else { for (const k of ["from", "to"]) { const e = n.data[k]; if (e.id) e.id = map.get(e.id) || null; if (!e.id) { e.id = null; e.x = (e.x || 0) + dx; e.y = (e.y || 0) + dy; } } }
      if (n.group) { if (!groupMap.has(n.group)) groupMap.set(n.group, uid("g")); n.group = groupMap.get(n.group); }
      n.z = (n.type === "frame" ? zF : zO) + i;
      delete n.votes; if (!opts.keepMeta) { delete n.reactions; }
      if (o.votes && opts.keepVotes) n.votes = o.votes;
      return Store.newObject(n);
    });
    add(out, { select: opts.select !== false });
    return out;
  }
  function bboxRaw(objs) { let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const o of objs) { x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y); x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + o.h); } return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; }

  // ---------- text editing ----------
  function startEdit(id, part = {}) {
    const o = Store.obj(id); if (!o || o.locked || !Store.canWrite) return;
    const busyBy = Collab.others().find((p) => p.presence?.edit === id && p.presence?.b === Store.S.boardId);
    if (busyBy) return toast(`${Collab.nameOf(busyBy.by || busyBy.presence?.uid, busyBy.presence?.nm)} sedang mengedit ini`);
    if (editing) finishEdit();
    const el = els.get(id); if (!el) return;
    let t;
    if (part.cell) t = el.querySelector(`[data-cell="${part.cell}"]`);
    else if (part.item != null) t = el.querySelector(`[data-item="${part.item}"]`);
    else if (part.field) t = el.querySelector(`[data-f="${part.field}"]`) || (part.field === "desc" ? null : null);
    else if (part.title) t = el.querySelector(".ttl");
    else t = el.querySelector(o.type === "frame" ? ".ftitle .t" : ".txt");
    if (part.field === "desc" && !t) { const meta = el.querySelector(".meta"); if (meta) { meta.querySelector(".ds")?.remove(); t = document.createElement("div"); t.className = "ds"; t.dataset.f = "desc"; meta.querySelector(".tt")?.after(t); } }
    if (!t) return;
    if (part.item != null && t.querySelector(".faint")) t.textContent = "";
    editing = { id, part, before: clone(o), el: t };
    if (!sel.has(id)) select([id]);
    t.contentEditable = "true"; t.spellcheck = true;
    t.focus();
    const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    t.addEventListener("input", onEditInput);
    t.addEventListener("keydown", onEditKey);
    t.addEventListener("blur", onEditBlur);
    t.addEventListener("paste", onEditPaste);
    Collab.presence({ edit: id });
    drawOverlay(); UI.ctx(null);
  }
  function editedValue() { return editing.el.innerText.replace(/ /g, " ").replace(/\n$/, ""); }
  function applyEdit(o, part, v) {
    const n = clone(o);
    if (part.cell) { const [r, c] = part.cell.split(",").map(Number); n.data.rows[r][c] = v; }
    else if (part.item != null) { n.data.items[part.item].t = v; }
    else if (part.field) { n.data[part.field] = v; }
    else n.text = v;
    return n;
  }
  const liveSave = debounce(() => {
    if (!editing) return;
    const o = Store.obj(editing.id); if (!o) return;
    const after = applyEdit(o, editing.part, editedValue());
    Store.commit([{ id: o.id, before: o, after }]);
  }, 700);
  function onEditInput() {
    if (!editing) return;
    const o = Store.obj(editing.id);
    if (o && o.type === "sticky") { const el = els.get(o.id); fitSticky(el, o); }
    liveSave();
    drawOverlay();
  }
  function onEditPaste(e) { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); }
  function onEditKey(e) {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishEdit(); }
    else if (e.key === "Enter" && !e.shiftKey && editing && (editing.part.cell || editing.part.item != null || editing.part.field || editing.part.title || Store.obj(editing.id)?.type === "frame")) {
      e.preventDefault(); const part = editing.part, id = editing.id; finishEdit();
      if (part.item != null) { const o = Store.obj(id); if (o && o.data.items[part.item]?.t) Actions.addChecklistItem(id, part.item + 1); }
    }
    else if (e.key === "Tab" && editing && editing.part.cell) {
      e.preventDefault(); const [r, c] = editing.part.cell.split(",").map(Number); const id = editing.id; finishEdit();
      const o = Store.obj(id); const cols = o.data.rows[0].length; const nr = c + 1 < cols ? r : r + 1, nc = c + 1 < cols ? c + 1 : 0;
      if (nr < o.data.rows.length) setTimeout(() => startEdit(id, { cell: `${nr},${nc}` }), 10);
      else if (Store.canWrite) { // Tab past the last cell: a new row, like a spreadsheet
        const after = clone(o); after.data.rows.push(o.data.rows[0].map(() => ""));
        const ch = [{ id, before: o, after }]; Store.commit(ch); History.push(ch, "Tambah baris");
        setTimeout(() => startEdit(id, { cell: `${nr},0` }), 30);
      }
    }
  }
  function onEditBlur() { setTimeout(() => { if (editing && document.activeElement !== editing.el) finishEdit(); }, 0); }
  function finishEdit() {
    if (!editing) return;
    const { id, part, before, el } = editing;
    el.removeEventListener("input", onEditInput); el.removeEventListener("keydown", onEditKey); el.removeEventListener("blur", onEditBlur); el.removeEventListener("paste", onEditPaste);
    el.contentEditable = "false";
    const v = editedValue();
    editing = null;
    Collab.presence({ edit: null });
    const o = Store.obj(id);
    if (o) {
      const after = applyEdit(o, part, v);
      if ((o.type === "text" || (o.type === "sticky" && !(before.text || "").trim())) && !v.trim() && !part.field && !part.cell && part.item == null && (!GUEST() || o.createdBy === Store.me.id)) { const ch = [{ id, before, after: null }]; Store.commit(ch); History.push(ch, "Hapus"); sel.delete(id); }
      else { Store.commit([{ id, before: o, after }]); if (!deepEqual(before, after)) History.push([{ id, before, after: clone(Store.obj(id)) }], "Edit teks"); }
      const elo = els.get(id); if (elo) elo._key = null;
    }
    scheduleRender();
    getSelection().removeAllRanges();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector(".scrim, .deck, .plan, .present")) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (k === " " && !spaceDown) { spaceDown = true; vp.classList.add("panning"); e.preventDefault(); return; }
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? History.redo() : History.undo(); return; }
    if (mod && k === "y") { e.preventDefault(); History.redo(); return; }
    if (mod && k === "a") { e.preventDefault(); select(visibleObjects().map((o) => o.id)); return; }
    if (mod && k === "d") { e.preventDefault(); Actions.duplicate(); return; }
    if (mod && k === "c") { Actions.copy(); return; }
    if (mod && k === "x") { Actions.copy(); Actions.remove(); return; }
    if (mod && k === "g") { e.preventDefault(); e.shiftKey ? Actions.ungroup() : Actions.group(); return; }
    if (mod && k === "l") { e.preventDefault(); Actions.lock(); return; }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(cam.z * 1.2); return; }
    if (mod && k === "-") { e.preventDefault(); zoomAt(cam.z / 1.2); return; }
    if (mod) return;
    if (e.shiftKey && (k === "!" || e.code === "Digit1")) { fit(); return; }
    if (e.shiftKey && (k === ")" || e.code === "Digit0")) { zoomAt(1); return; }
    if (e.shiftKey && (k === "@" || e.code === "Digit2")) { if (sel.size) fit([...sel]); return; }
    switch (k) {
      case "delete": case "backspace": if (sel.size) { e.preventDefault(); Actions.remove(); } return;
      case "escape": if (drag) { drag = null; drawOverlay(); } else if (tool !== "select") setTool("select"); else deselect(); UI.closePops(); return;
      case "enter": { const o = selObjs()[0]; if (o && sel.size === 1) { e.preventDefault(); if (o.type === "widget") Panels.widget(o.id); else startEdit(o.id); } return; }
      case "arrowleft": case "arrowright": case "arrowup": case "arrowdown": if (sel.size) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; Actions.nudge(k === "arrowleft" ? -s : k === "arrowright" ? s : 0, k === "arrowup" ? -s : k === "arrowdown" ? s : 0); } return;
      case "/": e.preventDefault(); UI.slash(); return;
      case "?": UI.shortcuts(); return;
      case "+": case "=": zoomAt(cam.z * 1.2); return;
      case "-": zoomAt(cam.z / 1.2); return;
    }
    const tk = { v: "select", h: "hand", n: "sticky", t: "text", s: "shape", c: "connector", p: "pen", e: "eraser", f: "frame", m: "comment" }[k];
    if (tk) setTool(tk);
  }
  function onKeyUp(e) { if (e.key === " ") { spaceDown = false; if (tool !== "hand") vp.classList.remove("panning"); } }
  function setTool(t) {
    if (!Store.canWrite && !["select", "hand"].includes(t)) return;
    tool = t;
    vp.className = "vp t-" + t;
    emit("tool", t);
    if (t !== "select") UI.ctx(null);
  }

  // ---------- init ----------
  function init() {
    vp = $("#vp"); world = $("#world"); framesL = $("#framesL"); linksL = $("#linksL"); objsL = $("#objsL"); overlay = $("#overlay"); selL = $("#selL"); cursorsL = $("#cursorsL");
    vp.addEventListener("pointerdown", onDown);
    selL.addEventListener("pointerdown", (e) => { if (e.target.closest(".hdl")) onDown(e); });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("dblclick", onDbl);
    vp.addEventListener("click", (e) => Actions.onClick(e));
    vp.addEventListener("input", (e) => Actions.onInput(e));
    vp.addEventListener("pointerleave", () => Collab.presence({ cur: null }));
    vp.addEventListener("contextmenu", (e) => { const o = objAt(e.target) || connAt(e.target); if (o) { e.preventDefault(); if (!sel.has(o.id)) select([o.id]); UI.moreMenu(e.clientX, e.clientY); } });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", () => { drawOverlay(); drawCursors(); });
    Store.on((k, info) => {
      if (k === "objects") { if (info?.ids) settleOffsets(info.ids); for (const id of sel) if (!Store.obj(id)) sel.delete(id); scheduleRender(); }
      if (k === "comments" || k === "lab" || k === "names" || k === "voting") scheduleRender();
      if (k === "board-open") { for (const el of els.values()) el.remove(); els.clear(); sel.clear(); remoteOffsets.clear(); drawOverlay(); }
    });
    Collab.on(onPeers);
    applyCam();
  }
  return {
    init, cam, applyCam, zoomAt, fit, animateTo, centerWorld, toWorld, toScreen, select, deselect, sel, selObjs, setTool, get tool() { return tool; }, toolOpts,
    startEdit, finishEdit, insertObjects, add, createAt, freeSpot, renderAll, scheduleRender, geo, center, bboxOf, frameChildren, els, frameAtPoint, camFor, lookAt,
    on: (f) => handlers.add(f), get editing() { return editing; }, get clientView() { return clientView; }, set clientView(v) { clientView = v; scheduleRender(); }, visibleObjects, visible, drawOverlay,
    flash(id) { const el = els.get(id); if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } },
  };
})();

// Tags shown temporarily by the free tools (duplicates, brand-check results). Not saved.
const Flags = (() => {
  const m = new Map();
  return { get: (id) => m.get(id), set(id, f) { m.set(id, f); Canvas.scheduleRender(); }, clear() { m.clear(); Canvas.scheduleRender(); }, has: (id) => m.has(id) };
})();

/* ---- 09-actions.js ---- */
// Board-level state (voting, timer) and every action on objects.
const Board = (() => {
  const b = () => Store.board() || {};
  const round = () => b().voting?.round || 0;
  function votesFor(o) {
    const r = round(); if (!r) return { count: 0, mine: false };
    const v = o.votes || {};
    return { count: Object.values(v).filter((x) => x === r).length, mine: v[Store.me.id] === r };
  }
  function myVotesUsed() { const r = round(); return Store.objects().filter((o) => (o.votes || {})[Store.me.id] === r).length; }
  return {
    open(id) { if (id && id !== Store.S.boardId) Store.openBoard(id); },
    votingActive: () => !!b().voting?.active,
    votingKey: () => `${b().voting?.active ? 1 : 0}:${round()}:${myVotesUsed()}`,
    round, votesFor, myVotesUsed,
    votesLeft: () => (b().voting?.per || 3) - myVotesUsed(),
    votesPer: () => b().voting?.per || 3,
    startVoting(per = 3) { Store.updateBoard({ voting: { active: true, round: round() + 1, per, by: Store.me.id, at: Date.now() } }); Store.emit("voting"); toast(`Voting dimulai. Tiap orang punya ${per} vote.`); },
    endVoting() { Store.updateBoard({ voting: { active: false, endedAt: Date.now() } }); Store.emit("voting"); Panels.votes(); },
    toggleVote(o) {
      if (!Board.votingActive()) return;
      const v = votesFor(o);
      if (v.mine) Store.patchObj(o.id, { votes: { [Store.me.id]: 0 } });
      else if (Board.votesLeft() > 0) { Store.patchObj(o.id, { votes: { [Store.me.id]: round() } }); Canvas.flash(o.id); }
      else return toast("Vote kamu sudah habis. Batalkan satu vote dulu kalau mau pindah.");
      Store.emit("voting");
    },
    // Who voted this round (the facilitator sees turnout; the counts wait for the end).
    voters() { const r = round(), ids = new Set(); if (!r) return 0; for (const o of Store.objects()) for (const [id, x] of Object.entries(o.votes || {})) if (x === r) ids.add(id); return ids.size; },
    // Meeting timer, seen by everyone: a countdown ("down") or a stopwatch ("up").
    timer() { return b().timer || null; },
    timerMs(t = b().timer) { if (!t) return 0; if (t.mode === "up") return t.running ? Date.now() - t.startedAt : t.elapsed || 0; return t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining || 0; },
    startTimer(min) { const ms = min * 60000; Store.updateBoard({ timer: { mode: "down", dur: ms, endsAt: Date.now() + ms, running: true, remaining: ms, by: Store.me.id } }); Board.addPresent(); },
    startStopwatch() { Store.updateBoard({ timer: { mode: "up", startedAt: Date.now(), elapsed: 0, running: true, by: Store.me.id } }); Board.addPresent(); },
    pauseTimer() { const t = b().timer; if (!t) return; Store.updateBoard({ timer: t.mode === "up" ? { running: false, elapsed: Date.now() - t.startedAt } : { running: false, remaining: Math.max(0, t.endsAt - Date.now()) } }); },
    resumeTimer() { const t = b().timer; if (!t) return; Store.updateBoard({ timer: t.mode === "up" ? { running: true, startedAt: Date.now() - (t.elapsed || 0) } : { running: true, endsAt: Date.now() + (t.remaining || 0) } }); },
    resetTimer() { Store.updateBoard({ timer: null }); },
    // Meeting attendees: everyone on the board while a timer runs is added on
    // its own (by a team member's screen: guests can't write the board), and
    // anyone can be added by name. They go into the meeting recap.
    attendees() { return Object.entries(b().meeting?.people || {}).filter(([, n]) => n).map(([id, name]) => ({ id, name })); },
    addPresent() {
      if (!Store.canWrite || GUEST()) return;
      const have = b().meeting?.people || {}, add = {};
      const me = Store.me; if (me.id && !have[me.id]) add[me.id] = me.name || "Kamu";
      for (const p of Collab.others()) { const id = p.by || p.presence?.uid; if (id && p.presence?.b === Store.S.boardId && !have[id] && !p.isMe) add[id] = Collab.nameOf(id, p.presence?.nm); }
      if (Object.keys(add).length) Store.updateBoard({ meeting: { people: add } });
    },
    addAttendee(name) { const n = String(name || "").trim().slice(0, 60); if (n) Store.updateBoard({ meeting: { people: { [uid("p")]: n } } }); },
    removeAttendee(id) { Store.updateBoard({ meeting: { people: { [id]: null } } }); },
    clearAttendees() { Store.updateBoard({ meeting: null }); },
  };
})();

const Actions = (() => {
  let clip = null, clipText = "";
  const sel = () => Canvas.selObjs();
  function changeSel(fn, label) {
    const ch = [];
    for (const o of sel()) { if (o.locked && label !== "Kunci") continue; const after = fn(clone(o)); if (after) ch.push({ id: o.id, before: o, after }); }
    if (ch.length) { Store.commit(ch); History.push(ch, label); }
    return ch;
  }
  function attachedConnectors(ids) { const s = new Set(ids); return Store.objects().filter((o) => o.type === "connector" && !s.has(o.id) && (s.has(o.data?.from?.id) || s.has(o.data?.to?.id))); }

  function remove() {
    // A guest erases only what they put on the board (firestore.rules agrees).
    const objs = sel().filter((o) => !o.locked && (!GUEST() || o.createdBy === Store.me.id));
    if (!objs.length) return sel().length && toast(GUEST() ? "Tamu hanya bisa menghapus coretannya sendiri" : "Objek terkunci tidak bisa dihapus");
    const all = [...objs, ...attachedConnectors(objs.map((o) => o.id))];
    const ch = all.map((o) => ({ id: o.id, before: o, after: null }));
    Store.commit(ch); History.push(ch, "Hapus");
    Canvas.deselect();
    toast(`${objs.length} objek dihapus`, { action: "Urungkan", onAction: () => History.undo() });
  }
  function selectionWithLinks() {
    const objs = sel(); const ids = new Set(objs.map((o) => o.id));
    const links = Store.objects().filter((o) => o.type === "connector" && !ids.has(o.id) && ids.has(o.data?.from?.id) && ids.has(o.data?.to?.id));
    return [...objs, ...links].map(clone);
  }
  function duplicate() {
    const list = selectionWithLinks(); if (!list.length) return;
    const b = Canvas.bboxOf(list.filter((o) => o.type !== "connector"));
    Canvas.insertObjects(list, { x: b.x + b.w / 2 + 40, y: b.y + b.h / 2 + 40 });
  }
  function copy() {
    const list = selectionWithLinks(); if (!list.length) return;
    clip = list; clipText = list.map(objText).filter(Boolean).join("\n") || "papan";
    try { navigator.clipboard.writeText(clipText).catch(() => {}); } catch {}
    toast(`${list.length} objek disalin`);
  }
  function pasteClip(at) { if (clip) Canvas.insertObjects(clip, at); }
  function group() { const objs = sel(); if (objs.length < 2) return toast("Pilih 2 objek atau lebih untuk dikelompokkan"); const g = uid("g"); changeSel((o) => ({ ...o, group: g }), "Kelompokkan"); toast("Dikelompokkan. Ctrl/⌘ + Shift + G untuk memisah."); }
  function ungroup() { changeSel((o) => { delete o.group; return o; }, "Pisahkan"); }
  function lock() { const anyUnlocked = sel().some((o) => !o.locked); changeSel((o) => ({ ...o, locked: anyUnlocked }), "Kunci"); Canvas.drawOverlay(); }
  function nudge(dx, dy) { changeSel((o) => (o.type === "connector" ? null : { ...o, x: o.x + dx, y: o.y + dy }), "Geser"); }
  function order(front) { const z = front ? Store.nextZ("sticky") + 1 : Math.min(...Store.objects().map((o) => o.z || 0)) - 1; let i = 0; changeSel((o) => ({ ...o, z: z + (front ? i++ : -i++) }), front ? "Ke depan" : "Ke belakang"); }
  function setColor(c) {
    changeSel((o) => {
      if (o.type === "sticky") return STICKY[c] || c.startsWith("#") ? { ...o, color: c } : null;
      if (["shape", "frame", "text", "pen", "connector"].includes(o.type)) return { ...o, color: c };
      return null;
    }, "Warna");
  }
  function setTag(tag) { changeSel((o) => ({ ...o, tag: o.tag === tag ? null : tag }), "Tanda"); }
  function setStatus(st) { changeSel((o) => ({ ...o, status: o.status === st ? null : st }), "Status"); }
  function toggleInternal() { changeSel((o) => (o.type === "frame" ? { ...o, internal: !o.internal } : null), "Internal"); }
  function setConn(patch) { changeSel((o) => (o.type === "connector" ? { ...o, data: { ...o.data, ...patch } } : null), "Garis"); }
  function setFont(delta) { changeSel((o) => (["text", "sticky", "shape"].includes(o.type) ? { ...o, fs: clamp(Math.round((o.fs || (o.type === "text" ? 22 : 20)) * delta), 10, 160) } : null), "Ukuran huruf"); }
  function toggleReaction(o, emo) {
    if (!Store.canWrite) return;
    const cur = !!(o.reactions || {})[emo]?.[Store.me.id];
    Store.patchObj(o.id, { reactions: { [emo]: { [Store.me.id]: !cur } } });
  }
  function addChecklistItem(id, at) {
    const o = Store.obj(id); if (!o) return;
    const after = clone(o); const items = after.data.items || (after.data.items = []);
    const i = at == null ? items.length : at; items.splice(i, 0, { t: "", done: false });
    const ch = [{ id, before: o, after }]; Store.commit(ch); History.push(ch, "Tambah tugas");
    setTimeout(() => Canvas.startEdit(id, { item: i }), 40);
  }
  function tableEdit(op) {
    const o = sel()[0]; if (!o || o.type !== "table") return;
    const after = clone(o), rows = after.data.rows;
    if (op === "row+") rows.push(rows[0].map(() => ""));
    if (op === "row-" && rows.length > 1) rows.pop();
    if (op === "col+") rows.forEach((r) => r.push(""));
    if (op === "col-" && rows[0].length > 1) rows.forEach((r) => r.pop());
    if (op === "col+" || op === "col-") after.w = Math.max(200, o.w + (op === "col+" ? 150 : -150));
    const ch = [{ id: o.id, before: o, after }]; Store.commit(ch); History.push(ch, "Tabel");
  }
  function jumpTo(id) {
    const o = Store.obj(id);
    if (!o) return toast("Catatan asalnya ada di papan lain atau sudah dihapus");
    Canvas.fit([id]); Canvas.select([id]); setTimeout(() => Canvas.flash(id), 380);
  }

  // ---------- clicks inside objects ----------
  function onClick(e) {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const el = btn.closest(".obj"); const o = el && Store.obj(el.dataset.id); if (!o) return;
    const act = btn.dataset.act;
    e.stopPropagation();
    switch (act) {
      case "vote": return Board.toggleVote(o);
      case "react": return toggleReaction(o, btn.dataset.emo);
      case "comments": Canvas.select([o.id]); return Panels.comments(o.id);
      case "widget-detail": return Panels.widget(o.id);
      case "widget-mode": return toggleWidgetMode(o);
      case "copy-hex": { const hx = btn.dataset.hex; try { navigator.clipboard.writeText(hx).then(() => toast(`${hx} disalin`), () => toast(hx)); } catch { toast(hx); } return; }
      case "src": return jumpTo(btn.dataset.src);
      case "open-in": return window.__papanGo?.(btn.dataset.to, btn.dataset.id || null);
      case "play-embed": {
        const src = embedSrc(o.data || {}); const media = el.querySelector(".media"); if (!src || !media) return;
        media.innerHTML = `<iframe src="${esc(src)}" title="${esc(o.data.title || "Video")}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        return;
      }
    }
    if (!Store.canWrite) { e.preventDefault(); return toast("Kamu hanya bisa melihat papan ini"); }
    switch (act) {
      case "check-item": { const i = +btn.dataset.i; const after = clone(o); after.data.items[i].done = btn.checked; const ch = [{ id: o.id, before: o, after }]; Store.commit(ch); History.push(ch, "Centang"); return; }
      case "add-item": return addChecklistItem(o.id);
      case "toggle-task": { Store.labSave("tasks", { id: btn.dataset.tid, done: btn.checked }); toast(btn.checked ? `Tugas ditandai selesai di Brandlab${EX()}` : "Tugas dibuka lagi"); return; }
      case "cycle-content": { const L = Store.lab(), k = L.content.find((x) => x.id === btn.dataset.cid); if (!k) return; const order = L.contentStatuses || CSTATUS; const nx = order[(order.indexOf(k.status) + 1) % order.length]; Store.labSave("content", { id: k.id, status: nx }); return; }
      case "calc-tab": { const after = clone(o); after.data.calc = { ...(after.data.calc || {}), tab: btn.dataset.tab }; const ch = [{ id: o.id, before: o, after }]; Store.commit(ch); History.push(ch, "Kalkulator"); return; }
    }
  }
  const saveCalc = debounce((id) => {
    const o = Store.obj(id), el = Canvas.els.get(id); if (!o || !el) return;
    const after = clone(o); after.data.calc = { ...(after.data.calc || {}), tab: calcValues(o).tab };
    el.querySelectorAll("[data-calc]").forEach((i) => { after.data.calc[i.dataset.calc] = Number(i.value) || 0; });
    Store.commit([{ id, before: o, after }]);
  }, 500);
  function onInput(e) {
    const inp = e.target.closest("[data-calc]"); if (!inp) return;
    const el = inp.closest(".obj"), o = el && Store.obj(el.dataset.id); if (!o) return;
    const { tab, v } = calcValues(o);
    el.querySelectorAll("[data-calc]").forEach((i) => { v[i.dataset.calc] = Number(i.value) || 0; });
    el.querySelector(".out").innerHTML = calcOutHTML(tab, v);
    if (Store.canWrite) saveCalc(o.id);
  }
  function toggleWidgetMode(o) {
    if (!Store.canWrite) return;
    const W = WIDGETS[o.data.kind]; const after = clone(o);
    if (o.data.mode === "snapshot") { after.data.mode = "live"; after.data.snap = null; toast("Widget kembali live: ikut berubah saat data Brandlab berubah"); }
    else { after.data.mode = "snapshot"; after.data.snap = clone(W.live(o, Store.lab())); after.data.snapAt = Date.now(); toast("Dibekukan. Isinya tidak ikut berubah lagi."); }
    const ch = [{ id: o.id, before: o, after }]; Store.commit(ch); History.push(ch, "Mode widget");
  }

  // ---------- adding things ----------
  function at() { return UI.lastPoint || Canvas.centerWorld(); }
  function addSticky(p = at(), text = "", color) { const o = Store.newObject({ type: "sticky", x: Math.round(p.x - 100), y: Math.round(p.y - 100), w: 200, h: 200, text, color: color || Canvas.toolOpts.stickyColor }); Canvas.add([o], { select: true }); if (!text) setTimeout(() => Canvas.startEdit(o.id), 40); return o; }
  function addText(p = at()) { return Canvas.createAt("text", { cx: p.x, cy: p.y }); }
  function addShape(shape, p = at()) { Canvas.toolOpts.shape = shape; return Canvas.createAt("shape", { cx: p.x, cy: p.y }); }
  function addFrame(p = at()) { return Canvas.createAt("frame", { cx: p.x, cy: p.y }); }
  // A table of `rows` × `cols` (the first row is the header), or the rows given.
  function addTable(p = at(), rows = 3, cols = 3, data = null) {
    const grid = data || [Array.from({ length: cols }, (_, i) => `Kolom ${i + 1}`), ...Array.from({ length: Math.max(1, rows - 1) }, () => Array(cols).fill(""))];
    const n = grid[0].length, w = clamp(n * 150, 320, 1200), h = 40 + grid.length * 34;
    p = Canvas.freeSpot(w, h, p);
    const o = Store.newObject({ type: "table", x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h: 180, text: "", data: { rows: grid } });
    Canvas.add([o], { select: true }); return o;
  }
  // Rows copied from Google Sheets or Excel arrive tab-separated: a table, not stickies.
  function tableFromText(txt, p = at()) {
    const lines = txt.replace(/\r/g, "").split("\n").filter((l) => l.trim()).slice(0, 60);
    const rows = lines.map((l) => l.split("\t").map((c) => c.trim().replace(/^"(.*)"$/s, "$1").slice(0, 500)).slice(0, 20));
    const cols = Math.max(...rows.map((r) => r.length));
    const o = addTable(p, 0, 0, rows.map((r) => [...r, ...Array(cols - r.length).fill("")]));
    toast(`Tabel ${rows.length} baris × ${cols} kolom ditempel`);
    return o;
  }
  // "Flowchart dari langkah": one step per line, top to bottom. A line ending
  // in "?" is a decision: "Ya" carries on down, "Tidak" gets its own box.
  function flowFromText(text, p = at(), ends = true) {
    let steps = String(text || "").split(/\r?\n/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 30);
    if (!steps.length) { toast("Tulis minimal satu langkah"); return null; }
    if (ends && !/^mulai\b/i.test(steps[0])) steps.unshift("Mulai");
    if (ends && !/^selesai\b/i.test(steps[steps.length - 1])) steps.push("Selesai");
    const objs = [], W = 240, H = 104, GAP = 70;
    let y = 0, prev = null, k = 0;
    const id = () => "f" + k++;
    const join = (a, b, label) => objs.push({ id: id(), type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: a, x: null, y: null }, to: { id: b, x: null, y: null }, arrow: "end", style: "elbow", dash: false, ...(label ? { label } : {}) } });
    steps.forEach((s, i) => {
      const end = ends && ((i === 0 && /^mulai\b/i.test(s)) || (i === steps.length - 1 && /^selesai\b/i.test(s)));
      const dec = !end && /\?\s*$/.test(s);
      const shape = end ? "pill" : dec ? "diamond" : "rect";
      const w = dec ? 260 : W, h = end ? 72 : dec ? 150 : H;
      const o = { id: id(), type: "shape", x: -w / 2, y, w, h, fs: 18, color: { pill: "#3ddc84", diamond: "#ffc94a" }[shape] || "#7ab8ff", text: s, data: { shape, fill: true } };
      objs.push(o);
      if (prev) join(prev.id, o.id, prev.dec ? "Ya" : "");
      if (dec) {
        const no = { id: id(), type: "shape", x: w / 2 + 120, y: y + (h - H) / 2, w: W, h: H, fs: 18, color: "#ff7eb6", text: "Kalau tidak: …", data: { shape: "rect", fill: true } };
        objs.push(no); join(o.id, no.id, "Tidak");
      }
      prev = { id: o.id, dec };
      y += h + GAP;
    });
    const out = Canvas.insertObjects(objs, Canvas.freeSpot(260 + 120 + W, y, p), { select: false });
    Canvas.deselect();
    setTimeout(() => Canvas.fit(out.filter((o) => o.type !== "connector").map((o) => o.id)), 60);
    toast("Flowchart dibuat. Pilih kotak, lalu klik + di sisinya untuk menambah langkah.");
    return out;
  }
  function addChecklist(p = at()) { const o = Store.newObject({ type: "checklist", x: Math.round(p.x - 170), y: Math.round(p.y - 80), w: 340, h: 160, text: "Checklist", data: { items: [{ t: "", done: false }] } }); Canvas.add([o], { select: true }); setTimeout(() => Canvas.startEdit(o.id, { item: 0 }), 40); return o; }
  const WSIZE = { dna: [400, 520], brandbook: [400, 400], campaign: [400, 400], growth: [400, 360], sales: [400, 340], calc: [400, 400], content: [400, 300], tasks: [380, 400] };
  function addWidget(kind, p = at(), extra = {}) {
    const [w, h] = WSIZE[kind];
    const o = Store.newObject({ type: "widget", x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, data: { kind, mode: "live", ...(kind === "campaign" && Store.lab().campaigns[0] ? { ref: Store.lab().campaigns[0].id } : {}), ...extra } });
    Canvas.add([o], { select: true });
    return o;
  }
  function addEmbed(url, p = at()) {
    const d = parseLink(url);
    if (!d) return toast("Link tidak valid. Pakai alamat yang diawali https://"), null;
    const size = d.kind === "youtube" ? (d.short ? [260, 470] : [420, 320]) : d.kind === "tiktok" ? [260, 470] : d.kind === "instagram" ? [300, 360] : [360, 170];
    const title = d.kind === "youtube" ? "Video YouTube" : d.kind === "tiktok" ? "Video TikTok" : d.kind === "instagram" ? `${d.sub} Instagram` : d.domain;
    const o = Store.newObject({ type: "embed", x: Math.round(p.x - size[0] / 2), y: Math.round(p.y - size[1] / 2), w: size[0], h: size[1], data: { ...d, title, desc: "" } });
    Canvas.add([o], { select: true });
    toast(d.kind === "link" ? "Kartu link dibuat. Klik dua kali judulnya untuk mengganti." : "Video ditaruh di papan. Klik dua kali judulnya untuk memberi nama.");
    return o;
  }
  async function compress(file, max, q) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let blob = await new Promise((r) => c.toBlob(r, "image/webp", q));
      if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
      return { blob, w: c.width, h: c.height };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addFiles(files, p = at()) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
    let i = 0;
    for (const f of files) {
      const pos = { x: p.x + i * 40, y: p.y + i * 40 }; i++;
      if (f.type.startsWith("image/")) {
        const t = toast(`Mengunggah ${f.name}…`, { ms: 20000 });
        try {
          const big = await compress(f, 1600, 0.82);
          const small = Store.hasAssets ? null : await compress(f, 900, 0.72);
          const up = await Store.uploadImage(big.blob, small && small.blob);
          const w = Math.min(460, big.w), h = Math.round((w * big.h) / big.w);
          const o = Store.newObject({ type: "image", x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2), w, h, data: { src: up.src, assetId: up.assetId || null, name: f.name, kb: Math.round(big.blob.size / 1024) } });
          Canvas.add([o], { select: true });
        } catch (e) { console.warn(e); toast(`${f.name} tidak bisa dibaca sebagai gambar`); }
        t.remove();
      } else {
        if (!Store.hasAssets) { toast("File selain gambar butuh penyimpanan bersama (aktif saat papan tersambung)"); continue; }
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} lebih dari 20 MB`); continue; }
        const t = toast(`Mengunggah ${f.name}…`, { ms: 30000 });
        try {
          const up = await Store.uploadImage(f);
          const o = Store.newObject({ type: "file", x: Math.round(pos.x - 150), y: Math.round(pos.y - 45), w: 300, h: 90, data: { src: up.src, assetId: up.assetId || null, name: f.name, size: f.size, ext: (f.name.split(".").pop() || "file") } });
          Canvas.add([o], { select: true });
        } catch { toast(`${f.name} gagal diunggah. Format ini mungkin tidak didukung.`); }
        t.remove();
      }
    }
  }
  function pickFiles() {
    const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "image/*,application/pdf";
    inp.onchange = () => addFiles([...inp.files]);
    inp.click();
  }
  function addTemplate(id, p) {
    const t = TEMPLATES.find((x) => x.id === id); if (!t) return;
    const objs = t.build();
    const out = Canvas.insertObjects(objs, p || Canvas.centerWorld());
    setTimeout(() => Canvas.fit(out.map((o) => o.id)), 60);
    toast(`Template "${t.name}" ditambahkan`, { action: "Urungkan", onAction: () => History.undo() });
  }
  function textToStickies(text, p = at()) {
    const lines = text.split(/\r?\n/).map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 40);
    if (lines.length < 2) return addSticky(p, lines[0] || text.trim());
    const cols = Math.ceil(Math.sqrt(lines.length)), colors = Object.keys(STICKY).slice(0, 6);
    const objs = lines.map((t, i) => ({ id: "L" + i, type: "sticky", x: (i % cols) * 220, y: Math.floor(i / cols) * 220, w: 200, h: 200, text: t, color: colors[i % colors.length] }));
    Canvas.insertObjects(objs, p);
    toast(`${lines.length} baris jadi ${lines.length} sticky`);
  }
  function onPaste(e) {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    if (document.querySelector(".scrim, .deck, .plan")) return;
    if (!Store.canWrite) return;
    const dt = e.clipboardData; if (!dt) return;
    const files = [...dt.files || []];
    if (files.length) { e.preventDefault(); return addFiles(files); }
    const txt = dt.getData("text/plain");
    e.preventDefault();
    if (clip && (txt === clipText || !txt)) return pasteClip(at());
    if (!txt.trim()) return;
    if (looksLikeUrl(txt)) return addEmbed(txt.trim());
    if (/\t/.test(txt)) return tableFromText(txt);
    textToStickies(txt);
  }
  function onDrop(e) {
    e.preventDefault();
    const p = Canvas.toWorld(e.clientX, e.clientY);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) return addFiles(files, p);
    const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (u && looksLikeUrl(u.split("\n")[0])) addEmbed(u.split("\n")[0].trim(), p);
    else if (u) textToStickies(u, p);
  }
  return { remove, duplicate, copy, group, ungroup, lock, nudge, order, setColor, setTag, setStatus, toggleInternal, setConn, setFont, toggleReaction, addChecklistItem, tableEdit, jumpTo, tableFromText, flowFromText,
    onClick, onInput, onPaste, onDrop, addSticky, addText, addShape, addFrame, addTable, addChecklist, addWidget, addEmbed, addFiles, pickFiles, addTemplate, textToStickies, toggleWidgetMode, changeSel };
})();

/* ---- 10-ui.js ---- */
// Chrome around the canvas: top bar, toolbar, contextual toolbar, menus, + menu, slash commands, modals, tour.
const UI = (() => {
  let lastPoint = null, popEl = null, ctxSig = "";
  const AI_COST = '<span class="cost">1 kredit</span>', FREE = '<span class="cost free">gratis</span>';
  const ALL_ITEMS = [
    { sec: "Dasar", k: "sticky", name: "Sticky note", icon: "sticky", cmd: ["sticky", "ide", "catatan"], c: "#ffc94a", run: (p) => Actions.addSticky(p) },
    { sec: "Dasar", k: "text", name: "Teks", icon: "text", cmd: ["teks", "judul"], c: "#a19b92", run: (p) => Actions.addText(p) },
    { sec: "Dasar", k: "shape", name: "Bentuk", icon: "shapes", cmd: ["bentuk", "kotak", "lingkaran"], c: "#7ab8ff", run: (p) => Actions.addShape("rect", p) },
    { sec: "Dasar", k: "frame", name: "Frame", icon: "frame", cmd: ["frame", "bagian"], c: "#ffa52b", run: (p) => Actions.addFrame(p) },
    { sec: "Dasar", k: "table", name: "Tabel", icon: "table", cmd: ["tabel", "table"], c: "#5fd3d0", run: (p) => tablePicker(p) },
    { sec: "Dasar", k: "check", name: "Checklist", icon: "checklist", cmd: ["checklist", "todo"], c: "#3ddc84", run: (p) => Actions.addChecklist(p) },
    { sec: "Dasar", k: "image", name: "Gambar & file", icon: "image", cmd: ["gambar", "image", "file", "foto"], c: "#ff7eb6", run: () => Actions.pickFiles() },
    { sec: "Dasar", k: "link", name: "Link & video", icon: "video", cmd: ["video", "link", "youtube", "tiktok"], c: "#ff6a5c", run: (p) => linkDialog(p) },
    { sec: "Dasar", k: "tpl", name: "Template", icon: "template", cmd: ["template"], c: "#b38cff", run: () => templates() },
    { sec: "Diagram", k: "flow", name: "Flowchart dari langkah", icon: "flow", cmd: ["flowchart", "alur", "diagram", "flow"], c: "#7ab8ff", run: (p) => flowDialog(p) },
    { sec: "Diagram", k: "f-end", name: "Mulai / Selesai", icon: "pill", cmd: ["mulai", "selesai", "start"], c: "#3ddc84", run: (p) => Actions.addShape("pill", p) },
    { sec: "Diagram", k: "f-step", name: "Proses", icon: "square", cmd: ["proses", "langkah", "step"], c: "#7ab8ff", run: (p) => Actions.addShape("rect", p) },
    { sec: "Diagram", k: "f-dec", name: "Keputusan", icon: "diamond", cmd: ["keputusan", "decision", "pilihan"], c: "#ffc94a", run: (p) => Actions.addShape("diamond", p) },
    { sec: "Diagram", k: "f-io", name: "Input / Output", icon: "para", cmd: ["input", "output", "data"], c: "#ff7eb6", run: (p) => Actions.addShape("para", p) },
    { sec: "Diagram", k: "f-doc", name: "Dokumen", icon: "doc", cmd: ["dokumen", "laporan"], c: "#b38cff", run: (p) => Actions.addShape("doc", p) },
    { sec: "Komponen Brandlab", k: "dna", name: "Brand DNA", icon: "dna", cmd: ["brand-dna", "dna"], c: "#ffa52b", run: (p) => Actions.addWidget("dna", p) },
    { sec: "Komponen Brandlab", k: "brandbook", name: "Brand Book", icon: "palette", cmd: ["brand-book", "warna", "logo"], c: "#ff7eb6", run: (p) => Actions.addWidget("brandbook", p) },
    { sec: "Komponen Brandlab", k: "campaign", name: "Campaign", icon: "megaphone", cmd: ["campaign"], c: "#7ab8ff", run: (p) => Actions.addWidget("campaign", p) },
    { sec: "Komponen Brandlab", k: "growth", name: "Growth & Insights", icon: "growth", cmd: ["growth", "insights", "analitik"], c: "#3ddc84", run: (p) => Actions.addWidget("growth", p) },
    { sec: "Komponen Brandlab", k: "sales", name: "Penjualan", icon: "sales", cmd: ["penjualan", "sales"], c: "#ffc94a", run: (p) => Actions.addWidget("sales", p) },
    { sec: "Komponen Brandlab", k: "calc", name: "Kalkulator", icon: "calc", cmd: ["kalkulator", "budget", "margin"], c: "#b38cff", run: (p) => Actions.addWidget("calc", p) },
    { sec: "Komponen Brandlab", k: "content", name: "Rencana konten", icon: "content", cmd: ["konten", "content"], c: "#ff8a5c", run: (p) => Actions.addWidget("content", p) },
    { sec: "Komponen Brandlab", k: "tasks", name: "Tugas & milestone", icon: "task", cmd: ["tugas", "task", "milestone"], c: "#3ddc84", run: (p) => Actions.addWidget("tasks", p) },
    { sec: "Bantuan AI", k: "ask", name: "Tanya Brandlab", icon: "sparkle", cmd: ["tanya", "ai", "asisten", "chat"], c: "#b38cff", cost: AI_COST, run: () => Assistant.open() },
    { sec: "Bantuan AI", k: "ideas", name: "Minta ide", icon: "bulb", cmd: ["ide-ai", "brainstorm"], c: "#b38cff", cost: AI_COST, run: () => Panels.ideas() },
    { sec: "Bantuan AI", k: "organize", name: "Rapikan ide", icon: "organize", cmd: ["rapikan", "kelompok"], c: "#b38cff", cost: FREE, run: () => Panels.organize() },
    { sec: "Bantuan AI", k: "recap", name: "Ringkas rapat", icon: "file", cmd: ["ringkas", "rekap", "notulen"], c: "#b38cff", cost: FREE, run: () => Panels.recap() },
    { sec: "Bantuan AI", k: "check", name: "Cek konsistensi brand", icon: "shield", cmd: ["cek-brand", "konsisten"], c: "#b38cff", cost: FREE, run: () => Panels.consistency() },
    { sec: "Bantuan AI", k: "deck", name: "Jadikan presentasi", icon: "slides", cmd: ["presentasi", "deck", "slide"], c: "#ffa52b", cost: FREE, run: () => Deck.open() },
    { sec: "Rapat", k: "timer", name: "Timer rapat", icon: "clock", cmd: ["timer"], c: "#ffa52b", run: () => timerPop($("#timerBtn")) },
    { sec: "Rapat", k: "voting", name: "Mulai voting", icon: "vote", cmd: ["voting", "vote"], c: "#b38cff", run: () => votingPop($("#moreBtn")) },
  ];
  // Guests draw, write and ask the AI; brand components and meeting tools stay with the team.
  const ITEMS = GUEST() ? ALL_ITEMS.filter((i) => i.sec === "Dasar" || i.sec === "Diagram" || ["calc", "ask", "ideas", "organize"].includes(i.k)) : ALL_ITEMS;

  // ---------- popovers ----------
  function closePops() { if (popEl) { popEl.remove(); popEl = null; } $$(".tip").forEach((t) => t.remove()); }
  function pop(anchor, html, opts = {}) {
    closePops();
    const el = document.createElement("div");
    el.className = "pop glass " + (opts.cls || "");
    el.innerHTML = html;
    document.body.appendChild(el);
    popEl = el;
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const pw = el.offsetWidth, ph = el.offsetHeight, W = innerWidth, H = innerHeight;
    let x = opts.side === "right" ? r.right + 8 : r.left + (opts.center ? r.width / 2 - pw / 2 : 0);
    let y = opts.side === "right" ? r.top : opts.above ? r.top - ph - 8 : r.bottom + 8;
    if (y + ph > H - 8) y = Math.max(8, r.top - ph - 8);
    x = clamp(x, 8, W - pw - 8); y = clamp(y, 8, H - ph - 8);
    el.style.left = x + "px"; el.style.top = y + "px";
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b && opts.onPick) { const keep = opts.onPick(b.dataset.pick, b, e); if (!keep) closePops(); } });
    return el;
  }
  document.addEventListener("pointerdown", (e) => { if (popEl && !popEl.contains(e.target) && !e.target.closest("[data-popper]")) closePops(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (popEl) closePops(); else { const m = $(".scrim"); if (m && !m.dataset.locked) m.remove(); } } });

  function modal(title, body, foot = "", opts = {}) {
    $(".scrim")?.remove();
    const s = document.createElement("div");
    s.className = "scrim";
    s.innerHTML = `<div class="modal ${opts.cls || ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Tutup">${ic("x")}</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ""}</div>`;
    s.addEventListener("pointerdown", (e) => { if (e.target === s) s.remove(); });
    s.querySelector("[data-close]").onclick = () => s.remove();
    document.body.appendChild(s);
    return s;
  }

  // ---------- tooltips ----------
  function tips() {
    let t = null;
    document.addEventListener("pointerover", (e) => {
      const b = e.target.closest("[data-tip]"); if (!b || e.pointerType === "touch") return;
      t?.remove(); t = document.createElement("div"); t.className = "tip";
      t.innerHTML = esc(b.dataset.tip) + (b.dataset.key ? `<span class="kbd">${esc(b.dataset.key)}</span>` : "");
      document.body.appendChild(t);
      const r = b.getBoundingClientRect(), side = b.closest(".toolbar") && innerWidth > 760;
      const x = side ? r.right + 10 : r.left + r.width / 2 - t.offsetWidth / 2, y = side ? r.top + r.height / 2 - t.offsetHeight / 2 : r.bottom + 8 > innerHeight - 40 ? r.top - t.offsetHeight - 8 : r.bottom + 8;
      t.style.left = clamp(x, 6, innerWidth - t.offsetWidth - 6) + "px"; t.style.top = clamp(y, 6, innerHeight - 30) + "px";
    });
    document.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) { t?.remove(); t = null; } });
    document.addEventListener("pointerdown", () => { t?.remove(); t = null; });
  }

  // ---------- top bar ----------
  function updateTop() {
    const b = Store.board();
    $("#boardName").textContent = b ? b.name : "Pilih papan";
    // save state
    const ss = $("#saveState");
    const st = Store._status || {};
    ss.className = "save-state" + (Store.mode === "local" ? " off" : st.err ? " err" : st.busy ? " busy" : "");
    ss.querySelector(".lbl").textContent = Store.mode === "local" ? "Tersimpan di perangkat ini" : st.err ? st.err : st.busy ? "Menyimpan…" : "Tersimpan";
    ss.title = Store.mode === "local" ? "Papan bersama tidak tersedia di tampilan ini. Isinya hanya tersimpan di browser ini." : "Semua perubahan tersimpan dan terlihat oleh semua orang di papan ini";
    updateTimer(); updateAvatars(); updateBanner();
    $("#undoBtn").disabled = !History.canUndo; $("#redoBtn").disabled = !History.canRedo;
  }
  function updateAvatars() {
    const box = $("#avatars");
    const people = new Map();
    people.set("me", { id: Store.me.id, me: true });
    for (const p of Collab.others()) { const id = p.by || p.presence?.uid || p.peer; if (p.isMe) continue; if (!people.has(id)) people.set(id, { id, peer: p.peer, nm: p.presence?.nm, onBoard: p.presence?.b === Store.S.boardId }); }
    const arr = [...people.values()];
    const html = arr.slice(0, 5).map((p) => {
      const nm = p.me ? Store.me.name || "Kamu" : Collab.nameOf(p.id, p.nm);
      const col = Collab.colorOf(p.id);
      return `<button class="av${p.me ? " me" : ""}${p.peer && p.peer === Collab.followPeer ? " following" : ""}" style="background:${col}" data-popper data-av="${esc(p.me ? "" : p.peer)}" aria-label="${esc(nm)}" data-tip="${esc(p.me ? nm + " (kamu)" : nm + (p.onBoard ? "" : " · di papan lain"))}">${esc(initials(nm))}</button>`;
    }).join("") + (arr.length > 5 ? `<span class="av" style="background:var(--surface-2);color:var(--text)">+${arr.length - 5}</span>` : "");
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
  }
  function avatarMenu(btn) {
    const peer = btn.dataset.av;
    if (!peer) return pop(btn, `<div class="mh">Kamu</div><div style="padding:4px 10px 10px;font-size:13px">${esc(Store.me.name || "Kamu")} <span class="chip">${roleLabel()}</span></div>${Collab.others().length ? `<button class="mi" data-pick="summon">${ic("megaphone")} Ajak semua lihat layarku</button>` : '<p class="muted" style="font-size:12px;padding:0 10px 8px;margin:0">Belum ada orang lain di papan. Buka link ini di perangkat lain atau bagikan ke tim untuk mencoba kolaborasi.</p>'}`, { onPick: (k) => { if (k === "summon") Collab.summon(); } });
    const p = Collab.others().find((x) => x.peer === peer); if (!p) return;
    const nm = Collab.nameOf(p.by || p.presence?.uid, p.presence?.nm);
    pop(btn, `<div class="mh">${esc(nm)}</div>${Collab.followPeer === peer ? `<button class="mi" data-pick="unfollow">${ic("x")} Berhenti mengikuti</button>` : `<button class="mi" data-pick="follow">${ic("follow")} Ikuti layarnya</button>`}${p.presence?.cur ? `<button class="mi" data-pick="goto">${ic("cursor")} Lompat ke kursornya</button>` : ""}`, {
      onPick: (k) => {
        if (k === "follow") Collab.follow(peer);
        if (k === "unfollow") Collab.stopFollow();
        if (k === "goto") { const c = p.presence.cur; if (p.presence.b !== Store.S.boardId) Board.open(p.presence.b); const r = $("#vp").getBoundingClientRect(); Canvas.animateTo({ z: Canvas.cam.z, x: r.width / 2 - c.x * Canvas.cam.z, y: r.height / 2 - c.y * Canvas.cam.z }); }
      } });
  }
  const roleLabel = () => (Store.canWrite ? (Store._isOwner ? "Pemilik" : "Editor") : "Lihat saja");
  const clock = (ms) => { const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`; };
  let lastPresent = 0;
  function updateTimer() {
    const t = Board.timer(), chip = $("#timerBtn");
    if (!t) { chip.className = "timer-chip"; chip.innerHTML = `${ic("clock")}<span class="hide-sm">Timer</span>`; return; }
    const ms = Board.timerMs(t), up = t.mode === "up";
    const done = !up && t.running && ms <= 0;
    chip.className = "timer-chip" + (done ? " done" : t.running ? " run" : "");
    chip.innerHTML = `${ic(!t.running ? "pause" : up ? "stopwatch" : "clock")}<span class="tnum">${done ? "Waktu habis" : clock(ms)}</span>`;
    if (done && !chip._beeped) { chip._beeped = true; beep(); toast("Waktu rapat habis"); }
    if (!done) chip._beeped = false;
    // whoever is on the board while the clock runs joins the attendee list
    if (t.running && Date.now() - lastPresent > 15000) { lastPresent = Date.now(); Board.addPresent(); }
  }
  setInterval(updateTimer, 1000);
  let timerMode = "down";
  function timerPop(anchor) {
    const t = Board.timer(), can = Store.canWrite;
    if (t) timerMode = t.mode === "up" ? "up" : "down";
    const people = Board.attendees();
    const el = pop(anchor || $("#timerBtn"), `<div class="mh">Timer rapat (terlihat semua orang)</div>
      <div class="seg" role="tablist" style="margin:0 10px 10px"><button class="${timerMode === "down" ? "on" : ""}" data-pick="mode:down" role="tab">Hitung mundur</button><button class="${timerMode === "up" ? "on" : ""}" data-pick="mode:up" role="tab">Stopwatch</button></div>
      ${timerMode === "down"
        ? `<div class="row">${[5, 10, 15, 25, 45].map((m) => `<button class="btn btn-secondary btn-sm" data-pick="m${m}">${m} mnt</button>`).join("")}</div>
      <div class="row" style="align-items:center"><input class="field" id="tmin" type="number" min="1" max="240" placeholder="Menit" style="width:90px"><button class="btn btn-primary btn-sm" data-pick="custom">Mulai</button></div>`
        : `<div class="row"><button class="btn btn-primary btn-sm" data-pick="sw">${ic("stopwatch")} ${t?.mode === "up" ? "Mulai dari nol" : "Mulai stopwatch"}</button></div>`}
      ${t ? `<div class="sep"></div>${t.running ? `<button class="mi" data-pick="pause">${ic("pause")} Jeda</button>` : `<button class="mi" data-pick="resume">${ic("play")} Lanjutkan</button>`}<button class="mi" data-pick="reset">${ic("x")} Hapus timer</button>` : ""}
      <div class="sep"></div>
      <div class="mh">Peserta rapat (${people.length})</div>
      <div class="chips" style="padding:0 10px 8px;max-width:300px">${people.map((p) => `<span class="chip">${esc(p.name)}${can && !GUEST() ? ` <button class="chip-x" data-pick="rm:${esc(p.id)}" aria-label="Hapus ${esc(p.name)}">×</button>` : ""}</span>`).join("") || '<span class="faint" style="font-size:12px">Belum ada. Yang membuka papan saat timer berjalan tercatat otomatis.</span>'}</div>
      ${can && !GUEST() ? `<div class="row" style="align-items:center"><input class="field" id="tpName" placeholder="Tambah nama" style="width:150px" maxlength="60"><button class="btn btn-secondary btn-sm" data-pick="addp">Tambah</button>${people.length ? `<button class="btn btn-ghost btn-sm" data-pick="clearp">Kosongkan</button>` : ""}</div>` : ""}`, {
      center: true, onPick: (k) => {
        if (k.startsWith("mode:")) { timerMode = k.slice(5); setTimeout(() => timerPop(anchor), 0); return true; }
        if (!can || GUEST()) return toast(GUEST() ? "Timer diatur oleh tim brand" : "Kamu hanya bisa melihat papan ini");
        if (k[0] === "m" && /^m\d+$/.test(k)) Board.startTimer(+k.slice(1));
        if (k === "custom") { const v = +$("#tmin").value; if (!v) { toast("Isi jumlah menit dulu"); return true; } Board.startTimer(clamp(v, 1, 240)); }
        if (k === "sw") Board.startStopwatch();
        if (k === "pause") Board.pauseTimer(); if (k === "resume") Board.resumeTimer(); if (k === "reset") Board.resetTimer();
        const again = () => { setTimeout(() => timerPop(anchor), 60); return true; };
        if (k === "addp") { const n = $("#tpName").value.trim(); if (!n) { toast("Tulis namanya dulu"); return true; } Board.addAttendee(n); return again(); }
        if (k.startsWith("rm:")) { Board.removeAttendee(k.slice(3)); return again(); }
        if (k === "clearp") { Board.clearAttendees(); return again(); }
        setTimeout(updateTimer, 50);
      } });
    const inp = el.querySelector("#tpName"); if (inp) inp.onkeydown = (e) => { if (e.key === "Enter") el.querySelector('[data-pick="addp"]').click(); };
  }
  function votingPop(anchor) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
    if (Board.votingActive()) return pop(anchor, `<button class="mi" data-pick="end">${ic("check")} Selesai voting & lihat hasil</button>`, { onPick: () => Board.endVoting() });
    pop(anchor, `<div class="mh">Mulai voting</div><p style="font-size:12.5px;color:var(--muted);margin:0 10px 8px;max-width:260px">Semua orang di papan bisa vote sticky note. Hasilnya dipakai di ringkasan rapat dan presentasi.</p><div class="row">${[3, 5, 10].map((n) => `<button class="btn btn-secondary btn-sm" data-pick="${n}">${n} vote / orang</button>`).join("")}</div>`, { onPick: (k) => Board.startVoting(+k) });
  }
  function updateBanner() {
    const box = $("#banner");
    let h = "";
    if (Collab.followPeer) { const p = Collab.others().find((x) => x.peer === Collab.followPeer); h = `<span>${ic("follow")}</span><span>Mengikuti layar ${esc(p ? Collab.nameOf(p.by || p.presence?.uid, p.presence?.nm) : "")}</span><button class="btn btn-secondary btn-xs" data-b="unfollow">Berhenti</button>`; box.className = "banner glass"; }
    else if (Board.votingActive()) {
      const left = Math.max(0, Board.votesLeft()), per = Board.votesPer();
      const dots = `<span class="vdots" aria-hidden="true">${Array.from({ length: Math.min(per, 10) }, (_, i) => `<i class="${i < per - left ? "on" : ""}"></i>`).join("")}</span>`;
      h = `<span style="color:var(--violet)">${ic("vote")}</span><span>${Store.canWrite ? `Klik sticky untuk vote · sisa <b class="tnum">${left}</b> ${dots}` : "Voting sedang berjalan"} · hasil muncul saat selesai</span>${Store.canWrite && !GUEST() ? '<button class="btn btn-secondary btn-xs" data-b="endvote">Selesai & lihat hasil</button>' : ""}`;
      box.className = "banner glass violet";
    }
    else if (Canvas.clientView && !GUEST()) { h = `<span style="color:var(--bad)">${ic("eye")}</span><span>Tampilan klien: frame & komentar internal disembunyikan</span><button class="btn btn-secondary btn-xs" data-b="client">Keluar</button>`; box.className = "banner glass red"; }
    else if (!Store.canWrite) { h = `<span>${ic("eye")}</span><span>Kamu hanya bisa melihat papan ini</span>`; box.className = "banner glass"; }
    box.hidden = !h;
    if (box._h !== h) { box.innerHTML = h; box._h = h; }
    document.body.classList.toggle("voting", Board.votingActive());
  }

  // ---------- toolbar ----------
  function toolFlyout(t) {
    const btn = $(`[data-tool="${t}"]`);
    if (t === "sticky") pop(btn, `<div class="row">${Object.entries(STICKY).map(([k, v]) => `<button class="swb${Canvas.toolOpts.stickyColor === k ? " on" : ""}" style="background:${v}" data-pick="${k}" aria-label="Warna ${k}"></button>`).join("")}</div>`, { side: "right", onPick: (k) => { Canvas.toolOpts.stickyColor = k; updateToolbar(); } });
    if (t === "shape") pop(btn, `<div class="row">${["rect", "ellipse", "diamond", "triangle", "pill", "para", "doc"].map((s) => `<button class="icon-btn${Canvas.toolOpts.shape === s ? " on" : ""}" data-pick="${s}" aria-label="${{ rect: "Kotak", ellipse: "Oval", diamond: "Keputusan", triangle: "Segitiga", pill: "Mulai/Selesai", para: "Input/Output", doc: "Dokumen" }[s]}" data-tip="${{ rect: "Kotak / proses", ellipse: "Oval", diamond: "Keputusan", triangle: "Segitiga", pill: "Mulai / selesai", para: "Input / output", doc: "Dokumen" }[s]}">${ic({ rect: "square", ellipse: "circle" }[s] || s)}</button>`).join("")}</div>`, { side: "right", onPick: (k) => { Canvas.toolOpts.shape = k; } });
    if (t === "pen") pop(btn, `<div class="row">${INKS.map((c) => `<button class="swb${Canvas.toolOpts.penColor === c ? " on" : ""}" style="background:${inkColor(c)}" data-pick="c:${c}" aria-label="Warna"></button>`).join("")}</div><div class="row">${[2, 3, 6, 12].map((w) => `<button class="icon-btn${Canvas.toolOpts.penWidth === w ? " on" : ""}" data-pick="w:${w}" aria-label="Tebal ${w}"><span style="width:18px;height:${w}px;border-radius:9px;background:currentColor;display:block"></span></button>`).join("")}</div>`, { side: "right", onPick: (k) => { const [a, v] = k.split(":"); if (a === "c") Canvas.toolOpts.penColor = v; else Canvas.toolOpts.penWidth = +v; updateToolbar(); toolFlyout("pen"); return true; } });
  }
  function updateToolbar() {
    $$("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === Canvas.tool));
    const d = $('[data-tool="sticky"] .sw-dot'); if (d) d.style.background = STICKY[Canvas.toolOpts.stickyColor];
  }

  // ---------- contextual toolbar ----------
  function ctx(objs, box) {
    const el = $("#ctx");
    if (!objs || !objs.length || !box) { el.hidden = true; ctxSig = ""; return; }
    const types = new Set(objs.map((o) => o.type));
    const one = objs.length === 1 ? objs[0] : null;
    const sig = objs.map((o) => o.id + o.type + o.color + o.locked + o.tag + o.status + (o.data?.mode || "") + (o.data?.arrow || "") + (o.data?.style || "") + (o.data?.dash || "") + o.internal + o.group).join("|") + Store.canWrite + Board.votingActive();
    if (sig !== ctxSig) {
      ctxSig = sig;
      const b = [];
      const textish = [...types].every((t) => ["sticky", "text", "shape"].includes(t));
      const allStickyish = [...types].every((t) => ["sticky", "text", "shape", "embed"].includes(t));
      if (Store.canWrite) {
        if (![...types].every((t) => ["image", "widget", "embed", "table", "checklist", "file", "doc"].includes(t))) {
          const c = one ? (one.type === "sticky" ? stickyBg(one.color) : inkColor(one.color)) : "var(--muted)";
          b.push(`<button class="icon-btn" data-c="color" data-popper data-tip="Warna"><span class="cdot" style="background:${c}"></span></button>`);
        }
        if (textish) b.push(`<button class="icon-btn" data-c="font-" data-tip="Huruf lebih kecil" style="font-weight:800;font-size:12px">A−</button><button class="icon-btn" data-c="font+" data-tip="Huruf lebih besar" style="font-weight:800;font-size:15px">A+</button>`);
        if (one && one.type === "connector") b.push(`<button class="icon-btn" data-c="arrow" data-tip="Ujung panah">${ic("arrowRight")}</button><button class="icon-btn${one.data.style === "elbow" ? " on" : ""}" data-c="elbow" data-tip="Garis siku (flowchart)">${ic("elbow")}</button><button class="icon-btn${one.data.style === "curve" ? " on" : ""}" data-c="curve" data-tip="Garis lengkung">${ic("share")}</button><button class="btn btn-ghost btn-xs" data-c="label" data-tip="Tulisan di garis">${one.data.label ? esc(one.data.label).slice(0, 14) : "Label"}</button><button class="icon-btn${one.data.dash ? " on" : ""}" data-c="dash" data-tip="Garis putus-putus"><span style="font-weight:800;letter-spacing:1px">- -</span></button>`);
        if (one && one.type === "table") b.push(`<button class="btn btn-ghost btn-xs" data-c="row+">+ Baris</button><button class="btn btn-ghost btn-xs" data-c="col+">+ Kolom</button><button class="btn btn-ghost btn-xs" data-c="row-">− Baris</button><button class="btn btn-ghost btn-xs" data-c="col-">− Kolom</button>`);
        if (one && one.type === "frame") b.push(`<button class="icon-btn" data-c="rename" data-tip="Ganti nama">${ic("edit")}</button><button class="icon-btn${one.internal ? " on" : ""}" data-c="internal" data-tip="${one.internal ? "Tampilkan ke klien" : "Jadikan internal (disembunyikan dari klien)"}">${ic("eye")}</button>`);
      }
      if (one && one.type === "widget") b.push(`<button class="btn btn-ghost btn-xs" data-c="detail">${ic("expand")} Detail</button>`);
      if (one && one.type === "embed") b.push(`<a class="btn btn-ghost btn-xs" href="${esc(one.data.url)}" target="_blank" rel="noopener noreferrer">${ic("link")} Buka</a>`);
      if (one && one.type === "frame") b.push(`<button class="icon-btn" data-c="focus" data-tip="Fokus ke frame ini">${ic("fit")}</button>`);
      if (b.length) b.push('<span class="sep"></span>');
      if (allStickyish && Store.canWrite) b.push(`<button class="ai-pill" data-c="ai" data-popper>${ic("sparkle")} Bantuan</button><span class="sep"></span>`);
      b.push(`<button class="icon-btn" data-c="comment" data-tip="Komentar" data-key="M">${ic("comment")}</button>`);
      if (Store.canWrite) b.push(`<button class="icon-btn" data-c="react" data-popper data-tip="Reaksi">${ic("smile")}</button>`);
      if (Store.canWrite) {
        b.push(`<button class="icon-btn${objs.every((o) => o.locked) ? " on" : ""}" data-c="lock" data-tip="${objs.every((o) => o.locked) ? "Buka kunci" : "Kunci"}" data-key="Ctrl L">${ic(objs.every((o) => o.locked) ? "lock" : "unlock")}</button>`);
        b.push(`<button class="icon-btn" data-c="dup" data-tip="Duplikat" data-key="Ctrl D">${ic("copy")}</button>`);
        b.push(`<button class="icon-btn" data-c="del" data-tip="Hapus" data-key="Del">${ic("trash")}</button>`);
        b.push(`<button class="icon-btn" data-c="more" data-popper data-tip="Lainnya">${ic("dots")}</button>`);
      }
      if (one && one.type !== "connector") {
        const by = Collab.nameOf(one.createdBy), ed = one.updatedBy && one.updatedBy !== one.createdBy ? Collab.nameOf(one.updatedBy) : "";
        b.push(`<span class="meta">oleh ${esc(by)}${ed ? ` · diubah ${esc(ed)}` : ""} · ${timeAgo(one.updatedAt || one.createdAt || Date.now())}</span>`);
      }
      el.innerHTML = b.join("");
    }
    el.hidden = false;
    const vr = $("#vp").getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = box.x + box.w / 2 - w / 2, y = box.y - h - 18;
    if (y < 8) y = box.y + box.h + 18;
    if (y + h > vr.height - 8) y = Math.max(8, box.y + 10);
    el.style.left = clamp(x, 8, vr.width - w - 8) + "px"; el.style.top = clamp(y, 8, vr.height - h - 8) + "px";
  }
  function onCtx(e) {
    const b = e.target.closest("[data-c]"); if (!b) return;
    const c = b.dataset.c, objs = Canvas.selObjs(), one = objs.length === 1 ? objs[0] : null;
    switch (c) {
      case "color": {
        const sticky = objs.every((o) => o.type === "sticky");
        const list = sticky ? Object.entries(STICKY).map(([k, v]) => [k, v]) : [...INKS.map((k) => [k, inkColor(k)]), ...LAB_BASE.book.colors.map((x) => [x.hex, x.hex])];
        pop(b, `${sticky ? "" : '<div class="mh">Warna</div>'}<div class="row" style="max-width:250px">${list.map(([k, v]) => `<button class="swb" style="background:${v}" data-pick="${k}" aria-label="${k}"></button>`).join("")}</div>${!sticky ? '<div class="mh">Warna Brand Book (contoh)</div>' : ""}`, { center: true, onPick: (k) => Actions.setColor(k) });
        break;
      }
      case "font-": return Actions.setFont(1 / 1.15);
      case "font+": return Actions.setFont(1.15);
      case "arrow": { const n = { end: "both", both: "none", none: "end" }[one.data.arrow || "end"]; return Actions.setConn({ arrow: n }); }
      case "curve": return Actions.setConn({ style: one.data.style === "curve" ? "straight" : "curve" });
      case "elbow": return Actions.setConn({ style: one.data.style === "elbow" ? "straight" : "elbow" });
      case "label": {
        const el = pop(b, `<div class="mh">Tulisan di garis</div><div class="row">${["Ya", "Tidak", "Lalu", "Kalau gagal"].map((x) => `<button class="btn btn-secondary btn-xs" data-pick="t:${x}">${x}</button>`).join("")}</div><div class="row" style="align-items:center"><input class="field" id="clbl" maxlength="40" placeholder="Tulis sendiri" value="${esc(one.data.label || "")}" style="width:150px"><button class="btn btn-primary btn-sm" data-pick="set">Pasang</button>${one.data.label ? `<button class="btn btn-ghost btn-sm" data-pick="clear">Hapus</button>` : ""}</div>`, {
          center: true, onPick: (k) => {
            if (k.startsWith("t:")) Actions.setConn({ label: k.slice(2) });
            if (k === "set") Actions.setConn({ label: $("#clbl").value.trim() || null });
            if (k === "clear") Actions.setConn({ label: null });
          } });
        const inp = el.querySelector("#clbl"); if (inp) { setTimeout(() => inp.focus(), 30); inp.onkeydown = (e) => { if (e.key === "Enter") el.querySelector('[data-pick="set"]').click(); }; }
        return;
      }
      case "dash": return Actions.setConn({ dash: !one.data.dash });
      case "row+": case "row-": case "col+": case "col-": return Actions.tableEdit(c);
      case "rename": return Canvas.startEdit(one.id);
      case "internal": return Actions.toggleInternal();
      case "focus": return Canvas.fit([one.id]);
      case "detail": return Panels.widget(one.id);
      case "comment": return Panels.comments(objs[0].id);
      case "react": pop(b, `<div class="row">${["👍", "❤️", "🔥", "💡", "😂", "🎯", "👀", "✅"].map((m) => `<button class="emo" data-pick="${m}">${m}</button>`).join("")}</div>`, { center: true, onPick: (m) => objs.forEach((o) => Actions.toggleReaction(o, m)) }); break;
      case "lock": return Actions.lock();
      case "dup": return Actions.duplicate();
      case "del": return Actions.remove();
      case "more": return moreMenu(b);
      case "ai": return aiMenu(b);
    }
  }
  function moreMenu(x, y) {
    const objs = Canvas.selObjs(); if (!objs.length) return;
    const anchor = typeof x === "number" ? { x, y } : x;
    const notes = objs.filter((o) => ["sticky", "text", "shape"].includes(o.type));
    pop(anchor, `${Store.canWrite ? `<button class="mi" data-pick="front">${ic("front")} Bawa ke depan</button><button class="mi" data-pick="back">${ic("back")} Kirim ke belakang</button>
      ${objs.length > 1 ? `<button class="mi" data-pick="group">${ic("group")} Kelompokkan<span class="k"><span class="kbd">Ctrl G</span></span></button>` : ""}${objs.some((o) => o.group) ? `<button class="mi" data-pick="ungroup">${ic("group")} Pisahkan kelompok</button>` : ""}
      <div class="sep"></div><div class="mh">Tandai</div>
      <button class="mi" data-pick="tag:keputusan"><span class="dot" style="background:#1f9d57"></span> Keputusan</button>
      <button class="mi" data-pick="tag:pertanyaan"><span class="dot" style="background:#2f7fd6"></span> Pertanyaan terbuka</button>
      <button class="mi" data-pick="tag:terpilih"><span class="dot" style="background:var(--accent-fill)"></span> Ide terpilih</button>
      <div class="sep"></div><div class="mh">Persetujuan klien</div>
      <button class="mi" data-pick="st:review">${ic("eye")} Minta review</button><button class="mi" data-pick="st:approved">${ic("approve")} Setujui</button><button class="mi" data-pick="st:revisi">${ic("edit")} Minta revisi</button>
      ${notes.length ? `<div class="sep"></div><div class="mh">Jadikan kerja nyata</div><button class="mi" data-pick="tasks">${ic("task")} Jadikan tugas</button><button class="mi" data-pick="content">${ic("content")} Kirim ke Rencana konten</button><button class="mi" data-pick="campaign">${ic("megaphone")} Jadikan campaign</button>` : ""}
      <div class="sep"></div>` : ""}<button class="mi" data-pick="copy">${ic("copy")} Salin<span class="k"><span class="kbd">Ctrl C</span></span></button>${Store.canWrite ? `<button class="mi" data-pick="del">${ic("trash")} Hapus<span class="k"><span class="kbd">Del</span></span></button>` : ""}`, {
      onPick: (k) => {
        if (k === "front") Actions.order(true); if (k === "back") Actions.order(false);
        if (k === "group") Actions.group(); if (k === "ungroup") Actions.ungroup();
        if (k.startsWith("tag:")) Actions.setTag(k.slice(4)); if (k.startsWith("st:")) Actions.setStatus(k.slice(3));
        if (k === "tasks") Panels.tasks(); if (k === "content") Panels.toContent(); if (k === "campaign") Panels.campaign();
        if (k === "copy") Actions.copy(); if (k === "del") Actions.remove();
      } });
  }
  function aiMenu(anchor) {
    const objs = Canvas.selObjs().filter((o) => ["sticky", "text", "shape", "embed"].includes(o.type));
    const one = objs.length === 1;
    pop(anchor, `<div class="mh">Bantuan untuk ${objs.length} catatan</div>
      <button class="mi" data-pick="ask">${ic("sparkle")} Tanya Brandlab soal ini ${AI_COST}</button>
      ${one ? `<button class="mi" data-pick="rewrite">${ic("wand")} Tulis ulang / variasi ${AI_COST}</button>` : ""}
      ${!one ? `<button class="mi" data-pick="organize">${ic("organize")} Rapikan & kelompokkan ${FREE}</button>` : ""}
      <button class="mi" data-pick="check">${ic("shield")} Cek konsistensi brand ${FREE}</button>
      <button class="mi" data-pick="tasks">${ic("task")} Jadikan tugas ${FREE}</button>
      <button class="mi" data-pick="content">${ic("content")} Kirim ke Rencana konten ${FREE}</button>
      <button class="mi" data-pick="campaign">${ic("megaphone")} Jadikan campaign ${FREE}</button>
      <button class="mi" data-pick="ideas">${ic("bulb")} Minta ide lanjutan ${AI_COST}</button>`, {
      onPick: (k) => ({ ask: () => Assistant.open(), rewrite: () => Panels.rewrite(objs[0].id), organize: () => Panels.organize(), check: () => Panels.consistency(), tasks: () => Panels.tasks(), content: () => Panels.toContent(), campaign: () => Panels.campaign(), ideas: () => Panels.ideas(objs.map(objText).join("; ")) }[k]()) });
  }

  // ---------- + menu & slash ----------
  function addMenu(anchor) {
    const secs = [...new Set(ITEMS.map((i) => i.sec))];
    const el = pop(anchor, `<div class="search">${ic("search")}<input id="addq" placeholder="Cari, atau ketik / di kanvas" aria-label="Cari"></div><div id="addlist">${renderAddList(ITEMS, secs)}</div>`, { cls: "addmenu", side: innerWidth > 760 ? "right" : undefined, onPick: (k) => { runItem(k, true); } });
    const q = el.querySelector("#addq");
    q.focus();
    q.addEventListener("input", () => { const v = q.value.toLowerCase().trim(); const list = ITEMS.filter((i) => !v || i.name.toLowerCase().includes(v) || i.cmd.some((c) => c.includes(v))); el.querySelector("#addlist").innerHTML = list.length ? renderAddList(list, [...new Set(list.map((i) => i.sec))]) : '<p class="muted" style="padding:10px">Tidak ada yang cocok.</p>'; });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = el.querySelector("[data-pick]"); if (f) { runItem(f.dataset.pick, true); closePops(); } } });
  }
  function renderAddList(list, secs) {
    return secs.map((s) => `<div class="add-sec">${esc(s)}${s === "Komponen Brandlab" && !BL() ? '<span class="chip ex">data contoh</span>' : ""}</div><div class="addgrid">${list.filter((i) => i.sec === s).map((i) => `<button class="ai-item" data-pick="${i.sec}|${i.k}"><span class="ic" style="background:${hexA(i.c, 0.16)};color:${i.c}">${ic(i.icon)}</span>${esc(i.name)}${i.cost ? `<small>${i.cost}</small>` : ""}</button>`).join("")}</div>`).join("");
  }
  function runItem(key, atCenter) {
    const [sec, k] = key.split("|");
    const it = ITEMS.find((i) => i.sec === sec && i.k === k); if (!it) return;
    const writes = !["Bantuan AI"].includes(sec) || k !== "deck";
    if (!Store.canWrite && writes && k !== "deck" && k !== "recap") return toast("Kamu hanya bisa melihat papan ini");
    it.run(atCenter ? Canvas.centerWorld() : lastPoint || Canvas.centerWorld());
  }
  function slash() {
    const sp = lastPoint ? Canvas.toScreen(lastPoint.x, lastPoint.y) : null, vr = $("#vp").getBoundingClientRect();
    const anchor = sp ? { x: vr.left + sp.x, y: vr.top + sp.y } : { x: vr.left + vr.width / 2 - 150, y: vr.top + vr.height / 3 };
    const el = pop(anchor, `<input id="slq" placeholder="/ ketik perintah: campaign, tugas, video…" aria-label="Perintah"><div id="sll"></div>`, { cls: "slash", onPick: (k) => runItem(k) });
    const q = el.querySelector("#slq"), l = el.querySelector("#sll");
    let act = 0, list = ITEMS;
    const draw = () => { l.innerHTML = list.slice(0, 9).map((i, n) => `<button class="mi${n === act ? " act" : ""}" data-pick="${i.sec}|${i.k}">${ic(i.icon)} ${esc(i.name)}<span class="k"><code>/${i.cmd[0]}</code></span></button>`).join("") || '<p class="muted" style="padding:8px 10px;margin:0">Tidak ada perintah itu.</p>'; };
    draw(); q.focus();
    q.addEventListener("input", () => { const v = q.value.replace(/^\//, "").toLowerCase().trim(); list = ITEMS.filter((i) => !v || i.cmd.some((c) => c.startsWith(v)) || i.name.toLowerCase().includes(v)); act = 0; draw(); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { act = Math.min(act + 1, Math.min(list.length, 9) - 1); draw(); e.preventDefault(); }
      if (e.key === "ArrowUp") { act = Math.max(act - 1, 0); draw(); e.preventDefault(); }
      if (e.key === "Enter" && list[act]) { e.preventDefault(); closePops(); runItem(list[act].sec + "|" + list[act].k); }
    });
  }
  // Table size like a word processor: hover the grid, click to place.
  function tablePicker(p) {
    const N = 8;
    const s = modal("Tabel baru", `<div class="tpick" id="tpick">${Array.from({ length: N * N }, (_, i) => `<button class="tc" data-r="${Math.floor(i / N) + 1}" data-c="${(i % N) + 1}" aria-label="${Math.floor(i / N) + 1} baris × ${(i % N) + 1} kolom"></button>`).join("")}</div><p id="tpickL" style="margin:10px 0 0;text-align:center;font-weight:800">3 baris × 3 kolom</p><p class="muted" style="font-size:12px;margin:8px 0 0">Baris pertama jadi judul kolom. Tekan Tab di sel terakhir untuk menambah baris. Tabel dari Google Sheets atau Excel juga bisa langsung disalin lalu ditempel (Ctrl/⌘ V) di papan.</p>`, "", { cls: "sm" });
    const cells = [...s.querySelectorAll(".tc")];
    const hl = (r, c) => { cells.forEach((b) => b.classList.toggle("on", +b.dataset.r <= r && +b.dataset.c <= c)); s.querySelector("#tpickL").textContent = `${r} baris × ${c} kolom`; };
    cells.forEach((b) => { b.onmouseenter = b.onfocus = () => hl(+b.dataset.r, +b.dataset.c); b.onclick = () => { s.remove(); Actions.addTable(p, +b.dataset.r, +b.dataset.c); }; });
    hl(3, 3);
  }
  // Flowchart from a list of steps, free (no AI): Actions.flowFromText.
  function flowDialog(p) {
    const ex = "Klien kirim brief\nTim bikin konsep\nKonsep disetujui?\nProduksi konten\nPosting & pantau hasil";
    const s = modal("Flowchart dari langkah", `<label class="lbl" for="flowT">Tulis satu langkah per baris</label><textarea class="field" id="flowT" rows="7" style="resize:vertical">${esc(ex)}</textarea>
      <label class="pickrow" style="margin-top:10px"><input type="checkbox" id="flowEnds" checked><span class="t"><b>Tambah "Mulai" dan "Selesai"</b><span>Langkah yang diakhiri tanda tanya (?) jadi kotak keputusan dengan cabang Ya / Tidak.</span></span></label>`,
      `<button class="btn btn-ghost" data-close2>Batal</button><button class="btn btn-primary" id="flowGo">${ic("flow")} Buat flowchart</button>`, { cls: "sm" });
    s.querySelector("[data-close2]").onclick = () => s.remove();
    $("#flowGo").onclick = () => { if (Actions.flowFromText($("#flowT").value, p, $("#flowEnds").checked)) s.remove(); };
    setTimeout(() => { const t = $("#flowT"); t.focus(); t.select(); }, 30);
  }
  function linkDialog(p) {
    const s = modal("Tempel link atau video", `<label class="lbl" for="lnk">Link YouTube, TikTok, Instagram, atau website</label><input class="field" id="lnk" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"><div class="note" style="margin-top:12px">${ic("info")}<span>${window.__papanWeb || BL() ? "Bisa juga langsung tempel (Ctrl/⌘ V) link di kanvas. Video YouTube, TikTok, dan Instagram bisa diputar langsung di papan." : "Bisa juga langsung tempel (Ctrl/⌘ V) link di kanvas. Di prototipe ini video dibuka di tab baru karena halaman ini tidak boleh memuat pemutar luar. Di Brandlab nanti video YouTube dan TikTok diputar langsung di papan."}</span></div>`, `<button class="btn btn-ghost" data-close2>Batal</button><button class="btn btn-primary" id="lnkGo">Taruh di papan</button>`, { cls: "sm" });
    const go = () => { const v = $("#lnk").value.trim(); if (!v) return; if (Actions.addEmbed(v, p)) s.remove(); };
    $("#lnkGo").onclick = go; $("#lnk").onkeydown = (e) => { if (e.key === "Enter") go(); };
    s.querySelector("[data-close2]").onclick = () => s.remove();
    setTimeout(() => $("#lnk").focus(), 30);
  }

  // ---------- templates ----------
  function previewSVG(objs) {
    const real = objs.filter((o) => o.type !== "connector"); if (!real.length) return "";
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const o of real) { x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y - (o.type === "frame" ? 30 : 0)); x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + o.h); }
    const W = x2 - x1, H = y2 - y1;
    const sorted = [...real].sort((a, b) => (a.type === "frame" ? -1 : 0) - (b.type === "frame" ? -1 : 0));
    const out = sorted.map((o) => {
      const x = o.x - x1, y = o.y - y1;
      if (o.type === "frame") return `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" rx="18" fill="${hexA(o.color, 0.08)}" stroke="${hexA(o.color, 0.7)}" stroke-width="${W / 160}"/><rect x="${x}" y="${y - 26}" width="${Math.min(o.w * 0.5, 220)}" height="12" rx="6" fill="${o.color}" opacity=".8"/>`;
      if (o.type === "sticky") return `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" rx="6" fill="${stickyBg(o.color)}"/>`;
      if (o.type === "text") return `<rect x="${x}" y="${y + 4}" width="${o.w * 0.8}" height="${(o.fs || 18) * 0.7}" rx="4" fill="currentColor" opacity=".35"/>`;
      if (o.type === "shape") return o.data?.shape === "ellipse" ? `<ellipse cx="${x + o.w / 2}" cy="${y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" fill="${hexA(o.color, 0.5)}"/>` : `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" rx="${o.data?.shape === "pill" ? o.h / 2 : 10}" fill="${o.data?.fill === false ? "none" : hexA(o.color, o.data?.solid ? 0.95 : 0.45)}" stroke="${hexA(o.color, 0.8)}" stroke-width="${W / 220}"/>`;
      return `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" rx="14" fill="currentColor" opacity=".18"/><rect x="${x}" y="${y}" width="${o.w}" height="${Math.min(40, o.h * 0.15)}" rx="10" fill="${o.type === "widget" ? (WIDGETS[o.data?.kind]?.color || "#ffa52b") : "currentColor"}" opacity=".55"/>`;
    }).join("");
    return `<svg viewBox="-10 -10 ${W + 20} ${H + 20}" style="color:var(--text)" aria-hidden="true">${out}</svg>`;
  }
  function templates(mode = "insert") {
    const ex = exampleBoard();
    const cards = [mode === "new" ? `<button class="tcard" data-t="blank"><div class="pv" style="color:var(--faint)">${ic("plus")}</div><div class="tx"><b>Papan kosong</b><span>Mulai dari nol</span></div></button>${BL() ? "" : `<button class="tcard feat" data-t="example"><div class="pv">${previewSVG(ex.objs)}</div><div class="tx"><b>Papan contoh: Ramadan</b><span>Lihat semua fitur dipakai bareng</span></div></button>`}` : "", ...TEMPLATES.map((t) => `<button class="tcard" data-t="${t.id}"><div class="pv">${previewSVG(t.build())}</div><div class="tx"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></div></button>`)].join("");
    const s = modal(mode === "new" ? "Papan baru" : "Template", `<p class="muted" style="margin:0 0 14px">${mode === "new" ? "Pilih titik mulai. Semua template bisa diubah sesukamu." : "Template ditaruh di tengah layar. Warna dan isinya bisa diubah."}</p><div class="tgrid">${cards}</div>`);
    s.querySelector(".tgrid").addEventListener("click", async (e) => {
      const c = e.target.closest("[data-t]"); if (!c) return;
      const id = c.dataset.t; s.remove();
      if (mode === "insert") return Actions.addTemplate(id);
      if (id === "blank") return newBoard("Papan tanpa judul", []);
      if (id === "example") return App.createExample();
      const t = TEMPLATES.find((x) => x.id === id);
      newBoard(t.name, t.build());
    });
  }
  async function newBoard(name, objs) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan di sini");
    const map = new Map(objs.map((o) => [o.id, uid("o")]));
    const list = objs.map((o, i) => { const n = clone(o); n.id = map.get(o.id); if (n.type === "connector") for (const k of ["from", "to"]) { if (n.data[k].id) n.data[k].id = map.get(n.data[k].id); } n.z = i + 1; return Store.newObject(n); });
    await Store.createBoard({ name, objects: list, kind: "template" });
    setTimeout(() => Canvas.fit(null, false), 80);
  }
  function boardMenu(btn) {
    const list = Store.boards();
    const cur = Store.board();
    pop(btn, `<div class="boards-list">${cur && Store.canWrite ? `<div class="row" style="padding:6px"><input class="field" id="bname" value="${esc(cur.name)}" aria-label="Nama papan"></div>` : ""}<div class="mh">Papan brand ini</div>${list.map((b) => `<button class="mi${b.id === Store.S.boardId ? " act" : ""}" data-pick="open:${b.id}">${ic("layers")}<span class="bn">${esc(b.name)}</span><span class="k faint" style="font-size:11px">${timeAgo(b.updatedAt || b.createdAt)}</span></button>`).join("") || '<p class="muted" style="padding:6px 10px;margin:0">Belum ada papan.</p>'}
      ${Store.canWrite ? `<div class="sep"></div><button class="mi" data-pick="new">${ic("plus")} Papan baru</button>${cur ? `<button class="mi" data-pick="del" style="color:var(--bad)">${ic("trash")} Hapus papan ini</button>` : ""}` : ""}</div>`, {
      onPick: (k, b) => {
        if (k.startsWith("open:")) { Board.open(k.slice(5)); return; }
        if (k === "new") { templates("new"); return; }
        if (k === "del") {
          if (b.dataset.sure) { const id = Store.S.boardId; const next = Store.boards().find((x) => x.id !== id); Store.deleteBoard(id); if (next) Board.open(next.id); else App.showEmpty(); toast("Papan dihapus"); return; }
          b.dataset.sure = "1"; b.innerHTML = `${ic("trash")} Yakin? Klik lagi untuk menghapus semua isinya`; return true;
        }
      } });
    const inp = $("#bname");
    if (inp) { const save = () => { const v = inp.value.trim(); if (v && v !== cur.name) { Store.updateBoard({ name: v }); updateTop(); } }; inp.addEventListener("change", save); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { save(); closePops(); } }); }
  }
  function mainMenu(btn) {
    const theme = document.documentElement.dataset.theme || "system";
    if (GUEST()) return pop(btn, `<button class="mi" data-pick="rename">${ic("edit")} Ganti nama (${esc(Store.me.name)})</button>
      <button class="mi" data-pick="theme">${ic(theme === "light" ? "moon" : "sun")} Tema: ${{ system: "ikut perangkat", dark: "gelap", light: "terang" }[theme]}</button>
      <button class="mi" data-pick="keys">${ic("keyboard")} Pintasan keyboard<span class="k"><span class="kbd">?</span></span></button>
      <button class="mi" data-pick="tour">${ic("help")} Tur singkat</button>`, {
      onPick: (k) => {
        if (k === "rename") setTimeout(renameGuest, 0);
        if (k === "theme") App.setTheme({ system: "dark", dark: "light", light: "system" }[theme]);
        if (k === "keys") shortcuts(); if (k === "tour") tour(true);
      } });
    pop(btn, `<button class="mi" data-pick="history">${ic("history")} Riwayat versi</button>
      <button class="mi" data-pick="recap">${ic("file")} Ringkas rapat</button>
      <button class="mi" data-pick="vote">${ic("vote")} ${Board.votingActive() ? "Selesai voting" : "Mulai voting"}</button>
      <button class="mi" data-pick="results">${ic("chart")} Hasil voting</button>
      <button class="mi" data-pick="approvals">${ic("approve")} Persetujuan klien</button>
      <button class="mi" data-pick="client">${ic("eye")} ${Canvas.clientView ? "Keluar dari tampilan klien" : "Lihat sebagai klien"}</button>
      <div class="sep"></div>
      <button class="mi" data-pick="summon">${ic("megaphone")} Ajak semua lihat layarku</button>
      <button class="mi" data-pick="theme">${ic(theme === "light" ? "moon" : "sun")} Tema: ${{ system: "ikut perangkat", dark: "gelap", light: "terang" }[theme]}</button>
      <button class="mi" data-pick="keys">${ic("keyboard")} Pintasan keyboard<span class="k"><span class="kbd">?</span></span></button>
      <button class="mi" data-pick="tour">${ic("help")} Tur singkat</button>
      ${BL() ? "" : `<button class="mi" data-pick="plan">${ic("map")} Rencana fitur & biaya</button>`}${window.__papanSignOut ? `<div class="sep"></div><button class="mi" data-pick="logout">${ic("arrowRight")} Keluar (${esc(Store.me.email || Store.me.name)})</button>` : ""}`, {
      onPick: (k) => {
        if (k === "history") Panels.history(); if (k === "recap") Panels.recap();
        if (k === "vote") { if (Board.votingActive()) Board.endVoting(); else setTimeout(() => votingPop($("#moreBtn")), 0); }
        if (k === "results") Panels.votes(); if (k === "approvals") Panels.approvals();
        if (k === "client") { Canvas.clientView = !Canvas.clientView; updateBanner(); Panels.refresh(); }
        if (k === "summon") Collab.summon();
        if (k === "theme") { const n = { system: "dark", dark: "light", light: "system" }[theme]; App.setTheme(n); }
        if (k === "keys") shortcuts(); if (k === "tour") tour(true); if (k === "plan") Plan.open();
        if (k === "logout") window.__papanSignOut();
      } });
  }
  function shareDialog() {
    if (BL()) return shareDialogBrandlab();
    const others = Collab.others();
    modal("Bagikan papan", `<div class="stack">
      ${window.__papanWeb ? `<div><label class="lbl" for="shLink">Link papan ini</label><div style="display:flex;gap:8px"><input class="field" id="shLink" readonly value="${esc(location.origin + location.pathname + "?b=" + Store.S.boardId)}"><button class="btn btn-primary" id="shCopy">${ic("copy")} Salin</button></div><p class="muted" style="font-size:12px;margin:6px 0 0">Siapa pun yang login dengan akun Brandlab dan membuka link ini ikut jadi anggota papan dan bisa mengedit. Bagikan hanya ke tim.</p></div>`
        : `<div class="note">${ic("users")}<span><b>Coba kolaborasi sekarang:</b> pakai tombol <b>Share</b> di pojok kanan atas halaman Claude ini untuk mengundang orang, atau buka link yang sama di HP/laptop lain. Kursor, editan, vote, dan komentar langsung terlihat.</span></div>`}
      <div><label class="lbl">Peranmu di papan ini</label><div class="chips"><span class="chip live">${roleLabel()}</span>${Store.mode === "local" ? '<span class="chip dirty">Papan bersama belum tersambung di tampilan ini</span>' : ""}</div></div>
      <div><label class="lbl">Di papan sekarang (${others.length + 1})</label><div class="vlist"><div class="vi"><span class="av me" style="background:${Collab.colorOf(Store.me.id)};margin:0">${esc(initials(Store.me.name))}</span><div class="t"><b>${esc(Store.me.name || "Kamu")}</b><span>kamu</span></div></div>${others.map((p) => `<div class="vi"><span class="av" style="background:${Collab.colorOf(p.by || p.presence?.uid)};margin:0">${esc(initials(Collab.nameOf(p.by || p.presence?.uid, p.presence?.nm)))}</span><div class="t"><b>${esc(Collab.nameOf(p.by || p.presence?.uid, p.presence?.nm))}${p.isMe ? " (tab lain)" : ""}</b><span>${p.guest ? "tamu" : "anggota"}${p.presence?.b && p.presence.b !== Store.S.boardId ? " · di papan lain" : ""}</span></div><button class="btn btn-secondary btn-xs" data-follow="${p.peer}">Ikuti</button></div>`).join("")}</div></div>
      <div><label class="lbl">Di Brandlab nanti</label><div class="ptable-wrap"><table class="pt" style="min-width:0"><tr><th>Peran</th><th>Bisa apa</th></tr><tr><td><b>Pemilik</b></td><td>Semua, termasuk undang orang & hapus papan</td></tr><tr><td><b>Editor</b></td><td>Ubah isi papan, pakai AI (kredit pemilik)</td></tr><tr><td><b>Lihat saja</b></td><td>Lihat, komentar, vote</td></tr><tr><td><b>Klien (tamu)</b></td><td>Hanya frame yang tidak internal; komentar, vote, setujui</td></tr></table></div></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" id="shClient">${ic("eye")} ${Canvas.clientView ? "Keluar tampilan klien" : "Lihat sebagai klien"}</button><button class="btn btn-secondary" id="shSummon">${ic("megaphone")} Ajak semua lihat layarku</button></div></div>`, "", { cls: "sm" });
    const cp = $("#shCopy"); if (cp) cp.onclick = () => { const i = $("#shLink"); try { navigator.clipboard.writeText(i.value).then(() => toast("Link papan disalin"), () => { i.select(); toast("Tekan Ctrl/⌘ C untuk menyalin"); }); } catch { i.select(); } };
    $("#shClient").onclick = () => { Canvas.clientView = !Canvas.clientView; $(".scrim")?.remove(); updateBanner(); };
    $("#shSummon").onclick = () => { Collab.summon(); $(".scrim")?.remove(); };
    $$("[data-follow]").forEach((b) => (b.onclick = () => { Collab.follow(b.dataset.follow); $(".scrim")?.remove(); }));
  }
  function shareDialogBrandlab() {
    const others = Collab.others();
    let link = "";
    try { link = `${window.parent.location.origin}/#/brand/${window.__papanNS}/papan/${Store.S.boardId}`; } catch { link = ""; }
    modal("Bagikan papan", `<div class="stack">
      <div class="note">${ic("users")}<span>Papan ini milik brand, jadi semua anggota tim brand bisa membukanya: <b>Editor</b> ikut mengubah, <b>Lihat saja</b> hanya membaca. Kursor dan editan teman terlihat langsung.</span></div>
      ${link ? `<div><label class="lbl" for="shLink">Link papan ini (untuk anggota tim)</label><div style="display:flex;gap:8px"><input class="field" id="shLink" readonly value="${esc(link)}"><button class="btn btn-primary" id="shCopy">${ic("copy")} Salin</button></div></div>` : ""}
      <div><label class="lbl">Di papan sekarang (${others.length + 1})</label><div class="vlist"><div class="vi"><span class="av me" style="background:${Collab.colorOf(Store.me.id)};margin:0">${esc(initials(Store.me.name))}</span><div class="t"><b>${esc(Store.me.name || "Kamu")}</b><span>kamu</span></div></div>${others.map((p) => `<div class="vi"><span class="av" style="background:${Collab.colorOf(p.by)};margin:0">${esc(initials(Collab.nameOf(p.by)))}</span><div class="t"><b>${esc(Collab.nameOf(p.by))}</b><span>sedang di papan ini</span></div><button class="btn btn-secondary btn-xs" data-follow="${p.peer}">Ikuti</button></div>`).join("")}</div></div>
      ${guestLinkHTML()}
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" id="shTeam">${ic("users")} Undang anggota tim</button><button class="btn btn-secondary" id="shClient">${ic("eye")} ${Canvas.clientView ? "Keluar tampilan klien" : "Lihat sebagai klien"}</button>${others.length ? `<button class="btn btn-secondary" id="shSummon">${ic("megaphone")} Ajak semua lihat layarku</button>` : ""}</div></div>`, "", { cls: "sm" });
    const cp = $("#shCopy"); if (cp) cp.onclick = () => { const i = $("#shLink"); try { navigator.clipboard.writeText(i.value).then(() => toast("Link papan disalin"), () => { i.select(); toast("Tekan Ctrl/⌘ C untuk menyalin"); }); } catch { i.select(); } };
    $("#shTeam").onclick = () => { $(".scrim")?.remove(); window.__papanGo?.("team"); };
    wireGuestLink();
    $("#shClient").onclick = () => { Canvas.clientView = !Canvas.clientView; $(".scrim")?.remove(); updateBanner(); };
    $("#shSummon") && ($("#shSummon").onclick = () => { Collab.summon(); $(".scrim")?.remove(); });
    $$("[data-follow]").forEach((b) => (b.onclick = () => { Collab.follow(b.dataset.follow); $(".scrim")?.remove(); }));
  }
  function renameGuest() {
    const s = modal("Ganti nama", `<label class="lbl" for="gName">Nama yang terlihat oleh yang lain</label><input class="field" id="gName" maxlength="40" value="${esc(Store.me.name)}">`, `<button class="btn btn-ghost" data-close2>Batal</button><button class="btn btn-primary" id="gNameGo">Simpan</button>`, { cls: "sm" });
    const go = async () => {
      const v = $("#gName").value.trim(); if (!v) return toast("Tulis namamu dulu");
      try { const n = await window.__papanRename(v); s.remove(); toast(`Namamu sekarang ${n}`); }
      catch { toast("Nama gagal diganti. Coba lagi."); }
    };
    s.querySelector("[data-close2]").onclick = () => s.remove();
    $("#gNameGo").onclick = go;
    $("#gName").onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => $("#gName")?.select(), 30);
  }
  // Guest link (api/papan.js): people outside the team open this one board
  // with just a name. Owner and editors switch it; it lives on the board doc.
  function guestLinkHTML() {
    if (!window.__papanShare) return "";
    const s = Store.board()?.share || {}, on = !!s.on && !!s.t, can = Store.canWrite;
    const link = on ? window.__papanGuestLink(Store.S.boardId, s.t) : "";
    return `<div class="guest-link"><label class="pickrow"><input type="checkbox" id="gOn" ${on ? "checked" : ""} ${can ? "" : "disabled"}><span class="t"><b>Link tamu: siapa pun yang punya link bisa masuk</b><span>Tanpa akun: tamu langsung masuk dan bisa ganti nama sendiri. Tamu hanya membuka papan ini dan tidak melihat data brand. AI papan untuk tamu memakai kreditmu, maksimal 10 jawaban per tamu per hari.</span></span></label>
      ${on ? `<div style="display:flex;gap:8px;margin-top:8px"><select class="field" id="gRole" style="width:auto" ${can ? "" : "disabled"} aria-label="Yang bisa dilakukan tamu"><option value="edit" ${s.role !== "view" ? "selected" : ""}>Bisa coret-coret</option><option value="view" ${s.role === "view" ? "selected" : ""}>Lihat saja</option></select><input class="field" id="gLink" readonly value="${esc(link)}" aria-label="Link tamu"><button class="btn btn-primary" id="gCopy">${ic("copy")} Salin</button></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Tamu melihat semua isi papan ini, termasuk bagian internal. Simpan yang rahasia di papan lain.${can ? ` <button class="linkbtn" id="gRotate">Buat link baru</button> (link lama langsung tidak bisa dipakai).` : ""}</p>` : ""}</div>`;
  }
  function wireGuestLink() {
    const run = async (opts, done) => {
      try { await window.__papanShare(Store.S.boardId, opts); toast(done); }
      catch (e) { toast(e?.code === "owner-inactive" ? "Paket pemilik brand sedang tidak aktif" : e?.code === "not-editor" ? "Hanya pemilik dan editor yang bisa mengatur link tamu" : "Link tamu gagal diubah. Coba lagi."); }
      $(".scrim")?.remove(); shareDialogBrandlab();
    };
    const role = () => $("#gRole")?.value || Store.board()?.share?.role || "edit";
    $("#gOn") && ($("#gOn").onchange = (e) => run({ on: e.target.checked, role: role() }, e.target.checked ? "Link tamu aktif" : "Link tamu dimatikan"));
    $("#gRole") && ($("#gRole").onchange = () => run({ on: true, role: role() }, role() === "view" ? "Tamu sekarang hanya bisa melihat" : "Tamu sekarang bisa coret-coret"));
    $("#gRotate") && ($("#gRotate").onclick = () => run({ on: true, role: role(), rotate: true }, "Link baru dibuat. Link lama tidak bisa dipakai lagi."));
    $("#gCopy") && ($("#gCopy").onclick = () => { const i = $("#gLink"); try { navigator.clipboard.writeText(i.value).then(() => toast("Link tamu disalin"), () => { i.select(); toast("Tekan Ctrl/⌘ C untuk menyalin"); }); } catch { i.select(); } });
  }
  function shortcuts() {
    const rows = [["Pilih", "V"], ["Geser kanvas", "H / tahan Spasi"], ["Sticky note", "N"], ["Teks", "T"], ["Bentuk", "S"], ["Garis penghubung", "C"], ["Pena", "P"], ["Penghapus", "E"], ["Frame", "F"], ["Komentar", "M"], ["Perintah cepat", "/"], ["Batal / ulang", "Ctrl Z / Ctrl Shift Z"], ["Duplikat", "Ctrl D"], ["Salin / tempel", "Ctrl C / Ctrl V"], ["Kelompokkan", "Ctrl G"], ["Kunci", "Ctrl L"], ["Hapus", "Del"], ["Geser pelan / cepat", "Panah / Shift + panah"], ["Zoom", "Ctrl + scroll, + / −"], ["Lihat semua", "Shift 1"], ["Zoom 100%", "Shift 0"], ["Zoom ke pilihan", "Shift 2"], ["Sticky baru", "Klik dua kali di kanvas"]];
    modal("Pintasan keyboard", `<div class="ptable-wrap"><table class="pt" style="min-width:0">${rows.map(([a, b]) => `<tr><td>${a}</td><td style="text-align:right">${b.split(" / ").map((x) => `<span class="kbd">${x}</span>`).join(" / ")}</td></tr>`).join("")}</table></div><p class="muted" style="font-size:12px;margin:10px 0 0">Di Mac, Ctrl = ⌘.</p>`, "", { cls: "sm" });
  }

  // ---------- tour ----------
  const TOUR = [
    { sel: "#toolbar", t: "Alat utama", d: "Sticky, teks, bentuk, garis, pena, frame, dan komentar. Tombol + berisi semuanya, termasuk komponen Brandlab dan bantuan AI." },
    { sel: "#vp", t: "Kanvas tanpa batas", d: "Geser dengan dua jari atau tahan Spasi. Zoom dengan Ctrl + scroll. Klik dua kali di mana saja untuk sticky baru, atau ketik / untuk perintah cepat.", pad: -120 },
    { sel: "#avatars", t: "Kerja bareng, langsung", d: "Semua orang yang membuka papan muncul di sini, lengkap dengan kursornya. Klik fotonya untuk mengikuti layarnya." },
    { sel: "#fabAI", t: "Tanya Brandlab", d: "Ngobrol dengan AI yang membaca isi papan dan Brand DNA. Usulannya kamu centang dulu, baru jadi sticky, tugas, konten, atau campaign." },
    { sel: "#deckBtn", t: "Papan jadi presentasi", d: "Selesai rapat? Ubah isi papan jadi slide rapi dengan warna dan font brand, lalu unduh PPTX atau PDF." },
  ];
  function tour(force) {
    if (!force && LS.get("toured")) return;
    LS.set("toured", 1);
    const steps = TOUR.filter((s) => { const el = $(s.sel); return el && el.getClientRects().length; });
    let i = 0;
    const hole = document.createElement("div"); hole.className = "tour-hole";
    const card = document.createElement("div"); card.className = "tour-card"; card.setAttribute("role", "dialog");
    document.body.append(hole, card);
    const end = () => { hole.remove(); card.remove(); window.removeEventListener("resize", show); };
    function show() {
      const s = steps[i], el = $(s.sel); if (!el) return end();
      const r = el.getBoundingClientRect(), pad = s.pad ?? 8;
      const box = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      Object.assign(hole.style, { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" });
      card.innerHTML = `<span class="stt">${i + 1} dari ${steps.length}</span><h4>${s.t}</h4><p>${s.d}</p><div class="row"><button class="btn btn-ghost btn-sm" data-t="skip">Lewati</button><button class="btn btn-primary btn-sm" data-t="next">${i === steps.length - 1 ? "Mulai" : "Lanjut"}</button></div>`;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      let x = box.x + box.w + 14, y = box.y;
      if (x + cw > innerWidth - 12) { x = box.x; y = box.y + box.h + 14; }
      if (y + ch > innerHeight - 12) y = Math.max(12, box.y - ch - 14);
      if (s.pad < 0) { x = innerWidth / 2 - cw / 2; y = innerHeight / 2 - ch / 2; }
      card.style.left = clamp(x, 12, innerWidth - cw - 12) + "px"; card.style.top = clamp(y, 12, innerHeight - ch - 12) + "px";
    }
    card.addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (!b) return; if (b.dataset.t === "skip" || i === steps.length - 1) end(); else { i++; show(); } });
    window.addEventListener("resize", show);
    show();
  }

  function init() {
    tips();
    $("#toolbar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tool]");
      if (b) { const t = b.dataset.tool; const was = Canvas.tool === t; Canvas.setTool(t); if (["sticky", "shape", "pen"].includes(t) && (was || true)) toolFlyout(t); return; }
      if (e.target.closest("#addBtn")) addMenu($("#addBtn"));
      if (e.target.closest("#aiBtn")) Assistant.open();
    });
    Canvas.on((k) => { if (k === "tool") updateToolbar(); });
    $("#ctx").addEventListener("click", onCtx);
    $("#ctx").addEventListener("pointerdown", (e) => e.stopPropagation());
    $("#zoomIn").onclick = () => Canvas.zoomAt(Canvas.cam.z * 1.2);
    $("#zoomOut").onclick = () => Canvas.zoomAt(Canvas.cam.z / 1.2);
    $("#zoomFit").onclick = () => Canvas.fit();
    $("#zoomLbl").onclick = () => Canvas.zoomAt(1);
    Canvas.on((k) => { if (k === "cam") $("#zoomLbl").textContent = Math.round(Canvas.cam.z * 100) + "%"; });
    $("#undoBtn").onclick = () => History.undo();
    $("#redoBtn").onclick = () => History.redo();
    $("#boardBtn").onclick = (e) => { if (!GUEST()) boardMenu(e.currentTarget); };
    $("#timerBtn").onclick = (e) => timerPop(e.currentTarget);
    $("#moreBtn").onclick = (e) => mainMenu(e.currentTarget);
    $("#shareBtn").onclick = () => shareDialog();
    $("#deckBtn").onclick = () => Deck.open();
    $("#planBtn") && ($("#planBtn").onclick = () => Plan.open());
    $("#helpBtn").onclick = () => shortcuts();
    $("#fabAI").onclick = () => (Panels.current?.kind === "assistant" ? Panels.close() : Assistant.open());
    $("#avatars").addEventListener("click", (e) => { const b = e.target.closest(".av[data-popper]"); if (b) avatarMenu(b); });
    $("#banner").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (!b) return; if (b.dataset.b === "unfollow") Collab.stopFollow(); if (b.dataset.b === "endvote") Board.endVoting(); if (b.dataset.b === "client") { Canvas.clientView = false; } updateBanner(); });
    $("#vp").addEventListener("pointermove", (e) => { lastPoint = Canvas.toWorld(e.clientX, e.clientY); });
    $("#vp").addEventListener("pointerleave", () => { lastPoint = null; });
    document.addEventListener("paste", Actions.onPaste);
    $("#vp").addEventListener("dragover", (e) => e.preventDefault());
    $("#vp").addEventListener("drop", Actions.onDrop);
    Store.on((k, info) => { if (k === "status") { Store._status = info; updateTop(); } if (["boards", "history", "voting", "readonly", "follow", "objects"].includes(k)) updateTop(); if (k === "readonly") { document.body.classList.add("ro"); Canvas.setTool("select"); toast("Kamu hanya bisa melihat papan ini"); } });
    Collab.on(() => { updateAvatars(); updateBanner(); });
    updateToolbar();
  }
  function aiMenuGlobal(anchor) {
    pop(anchor, `<div class="mh">Bantuan (AI hanya kalau diminta)</div>
      <button class="mi" data-pick="ideas">${ic("bulb")} Minta ide dari Brand DNA ${AI_COST}</button>
      <button class="mi" data-pick="organize">${ic("organize")} Rapikan ide yang dipilih ${FREE}</button>
      <button class="mi" data-pick="recap">${ic("file")} Ringkas rapat ${FREE}</button>
      <button class="mi" data-pick="check">${ic("shield")} Cek konsistensi brand ${FREE}</button>
      <button class="mi" data-pick="deck">${ic("slides")} Jadikan presentasi ${FREE}</button>
      <div class="sep"></div><p class="muted" style="font-size:11.5px;margin:4px 10px 6px;max-width:280px">"Gratis" = dihitung dengan aturan, tanpa AI. Tiap alat punya tombol opsional untuk hasil lebih dalam dengan AI (1 kredit).</p>`, {
      side: innerWidth > 760 ? "right" : undefined, onPick: (k) => ({ ideas: () => Panels.ideas(), organize: () => Panels.organize(), recap: () => Panels.recap(), check: () => Panels.consistency(), deck: () => Deck.open() }[k]()) });
  }
  return { init, ctx, closePops, pop, modal, slash, shortcuts, moreMenu, templates, newBoard, updateTop, updateBanner, tour, previewSVG, timerPop, votingPop, get lastPoint() { return lastPoint; }, AI_COST, FREE };
})();

/* ---- 11-panels.js ---- */
// Side panel: comments, widget details, and every "review before it happens" flow (AI + free tools).
const Panels = (() => {
  let cur = null; // { kind, arg, render }
  const side = () => $("#side");
  function open(kind, arg, { title, icon = "info", body, foot = "", wire }) {
    cur = { kind, arg };
    const s = side();
    // fresh inner element each time, so listeners added by wire() never pile up on #side
    s.innerHTML = `<div class="side-in"><div class="side-h"><span class="ic">${ic(icon)}</span><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Tutup panel">${ic("x")}</button></div><div class="side-b">${body}</div>${foot ? `<div class="side-f">${foot}</div>` : ""}</div>`;
    s.classList.remove("wide");
    s.classList.add("open"); s.setAttribute("aria-hidden", "false");
    const inner = s.firstElementChild;
    inner.querySelector("[data-x]").onclick = close;
    wire && wire(inner);
  }
  function close() { side().classList.remove("open"); side().setAttribute("aria-hidden", "true"); cur = null; }
  function refresh() { if (!cur) return; if (cur.kind === "comments") comments(cur.arg, true); if (cur.kind === "approvals") approvals(); if (cur.kind === "votes") votes(); }
  const busyHTML = (t) => `<div class="thinking"><span class="spinner"></span>${esc(t)}</div>`;
  const notesFromSel = (all = true) => {
    const s = Canvas.selObjs().filter((o) => ["sticky", "text", "shape"].includes(o.type) && (o.text || "").trim());
    if (s.length || !all) return { list: s, fromSel: true };
    return { list: Store.objects().filter((o) => o.type === "sticky" && (o.text || "").trim() && Canvas.visible(o)), fromSel: false };
  };
  const aiNote = () => (AI.available ? "" : `<div class="note violet">${ic("info")}<span>${GUEST() ? "AI hanya untuk tim brand." : window.__papanWeb ? "AI belum tersambung. Muat ulang halaman." : "AI belum aktif di tampilan ini (butuh izin di Claude)."} Versi gratis tetap jalan.</span></div>`);

  // ---------- comments ----------
  function comments(objectId, keep) {
    const o = Store.obj(objectId);
    const all = Store.comments().filter((c) => c.objectId === objectId && (!Canvas.clientView || !c.internal));
    const tops = all.filter((c) => !c.parent).sort((a, b) => a.at - b.at);
    const showRes = cur && cur.kind === "comments" && cur.showRes;
    const one = (c, reply) => {
      const nm = Collab.nameOf(c.by, c.name);
      return `<div class="cmt${reply ? " reply" : ""}${c.resolved ? " resolved" : ""}"><span class="av" style="background:${Collab.colorOf(c.by || c.name)}">${esc(initials(nm))}</span><div class="bd"><div class="nm">${esc(nm)}<time>${timeAgo(c.at)}</time>${c.internal ? '<span class="chip dirty">Internal</span>' : ""}${c.resolved ? '<span class="chip live">Selesai</span>' : ""}</div><div class="tx">${esc(c.text)}</div>
        ${Store.canWrite ? `<div class="ac">${!reply ? `<button data-cr="${c.id}">Balas</button><button data-cres="${c.id}">${c.resolved ? "Buka lagi" : "Tandai selesai"}</button>` : ""}${c.by === Store.me.id ? `<button data-cdel="${c.id}">Hapus</button>` : ""}</div>` : ""}</div></div>`;
    };
    const shown = tops.filter((c) => showRes || !c.resolved);
    const resolvedN = tops.filter((c) => c.resolved).length;
    const body = `${o ? `<div class="note" style="margin-bottom:12px">${ic("comment")}<span>${esc((objText(o) || o.type).slice(0, 120))}</span></div>` : ""}
      ${shown.map((c) => one(c) + all.filter((r) => r.parent === c.id).sort((a, b) => a.at - b.at).map((r) => one(r, true)).join("") + `<div class="reply-box" data-for="${c.id}" hidden></div>`).join("") || '<p class="muted">Belum ada komentar. Mulai diskusi di bawah.</p>'}
      ${resolvedN ? `<button class="btn btn-ghost btn-xs" id="cmShowRes" style="margin-top:8px">${showRes ? "Sembunyikan" : "Tampilkan"} ${resolvedN} yang selesai</button>` : ""}`;
    const foot = Store.canWrite ? `<div class="composer" style="width:100%"><textarea class="field" id="cmText" rows="2" placeholder="Tulis komentar…"></textarea><div class="row"><label><input type="checkbox" id="cmInt"> Internal (klien tidak lihat)</label><button class="btn btn-primary btn-sm" id="cmSend">${ic("send")} Kirim</button></div></div>` : '<p class="muted" style="margin:0;font-size:12px">Kamu hanya bisa membaca komentar.</p>';
    const draft = keep && $("#cmText") ? $("#cmText").value : "";
    open("comments", objectId, { title: "Komentar", icon: "comment", body, foot, wire(s) {
      cur.showRes = showRes;
      const send = () => { const t = $("#cmText").value.trim(); if (!t) return; Store.addComment({ objectId, text: t, internal: $("#cmInt").checked }); $("#cmText").value = ""; };
      if ($("#cmText")) { $("#cmText").value = draft; $("#cmSend").onclick = send; $("#cmText").onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }; if (!keep) setTimeout(() => $("#cmText")?.focus(), 250); }
      $("#cmShowRes") && ($("#cmShowRes").onclick = () => { cur.showRes = !showRes; comments(objectId, true); });
      s.querySelectorAll("[data-cres]").forEach((b) => (b.onclick = () => { const c = Store.S.comments.get(b.dataset.cres); Store.updateComment(c.id, { resolved: !c.resolved }); }));
      s.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = () => Store.deleteComment(b.dataset.cdel)));
      s.querySelectorAll("[data-cr]").forEach((b) => (b.onclick = () => {
        const box = s.querySelector(`.reply-box[data-for="${b.dataset.cr}"]`); box.hidden = false;
        box.innerHTML = `<div class="composer" style="margin:6px 0 10px 38px"><textarea class="field" rows="2" placeholder="Balas…"></textarea><div class="row"><span></span><button class="btn btn-secondary btn-xs">Balas</button></div></div>`;
        const ta = box.querySelector("textarea"); ta.focus();
        box.querySelector("button").onclick = () => { const t = ta.value.trim(); if (t) Store.addComment({ objectId, text: t, parent: b.dataset.cr, internal: Store.S.comments.get(b.dataset.cr)?.internal || false }); };
      }));
    } });
  }

  // ---------- widget details ----------
  function widget(id) {
    const o = Store.obj(id); if (!o || o.type !== "widget") return;
    if (GUEST()) return toast("Detail komponen ini hanya untuk tim brand");
    if (BL()) return blWidget(o);
    const kind = o.data.kind, W = WIDGETS[kind], L = Store.lab();
    const live = o.data.mode !== "snapshot";
    const head = `<div class="chips" style="margin-bottom:12px">${live ? '<span class="chip live">● Live: terhubung ke data Brandlab</span>' : `<span class="chip snap">Snapshot ${fmtDate(o.data.snapAt)}</span>`}<span class="chip ex">Data contoh</span><span class="chip dirty" id="wDirty" hidden>Belum disimpan</span></div>`;
    const ro = !Store.canWrite;
    let body = head, foot = "", wire;
    const dirty = (s) => s.addEventListener("input", () => { const d = $("#wDirty"); if (d) d.hidden = false; });
    if (kind === "dna") {
      const d = L.dna;
      const f = (k, label, v, ta = true) => `<div><label class="lbl" for="dna-${k}">${label}</label>${ta ? `<textarea class="field" id="dna-${k}" rows="2" ${ro ? "readonly" : ""}>${esc(v)}</textarea>` : `<input class="field" id="dna-${k}" value="${esc(v)}" ${ro ? "readonly" : ""}>`}</div>`;
      body += `<div class="stack">${f("positioning", "Positioning", d.positioning)}${f("audiens", "Audiens", d.audiens)}${f("kepribadian", "Kepribadian (pisahkan dengan koma)", d.kepribadian.join(", "), false)}${f("nilai", "Nilai (pisahkan dengan koma)", d.nilai.join(", "), false)}${f("vp", "Value proposition", d.vp)}${f("visi", "Visi", d.visi)}${f("misi", "Misi", d.misi)}</div><div class="note" style="margin-top:12px">${ic("info")}<span>Di Brandlab, Simpan menulis langsung ke Brand DNA brand ini. Semua widget Live di semua papan ikut berubah.</span></div>`;
      foot = ro ? "" : `<button class="btn btn-primary" id="wSave">Simpan ke Brand DNA</button>`;
      wire = (s) => { dirty(s); $("#wSave") && ($("#wSave").onclick = () => { const g = (k) => $("#dna-" + k).value.trim(); Store.labDoc({ dna: { positioning: g("positioning"), audiens: g("audiens"), kepribadian: g("kepribadian").split(",").map((x) => x.trim()).filter(Boolean), nilai: g("nilai").split(",").map((x) => x.trim()).filter(Boolean), vp: g("vp"), visi: g("visi"), misi: g("misi") } }); $("#wDirty").hidden = true; toast("Brand DNA tersimpan (data contoh). Widget live ikut berubah."); }); };
    } else if (kind === "campaign") {
      const c = W.live(o, L) || {};
      body += `<div class="stack"><div><label class="lbl" for="wRef">Campaign yang ditampilkan</label><select class="field" id="wRef" ${ro ? "disabled" : ""}>${L.campaigns.map((x) => `<option value="${x.id}" ${x.id === c.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
        <div><label class="lbl" for="cName">Nama</label><input class="field" id="cName" value="${esc(c.name)}" ${ro ? "readonly" : ""}></div>
        <div><label class="lbl" for="cObj">Tujuan</label><textarea class="field" id="cObj" rows="2" ${ro ? "readonly" : ""}>${esc(c.objective)}</textarea></div>
        <div><label class="lbl" for="cAud">Audiens</label><textarea class="field" id="cAud" rows="2" ${ro ? "readonly" : ""}>${esc(c.audience)}</textarea></div>
        <div><label class="lbl" for="cStr">Strategi</label><textarea class="field" id="cStr" rows="2" ${ro ? "readonly" : ""}>${esc(c.strategy)}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label class="lbl" for="cS">Mulai</label><input class="field" type="date" id="cS" value="${esc(c.start)}" ${ro ? "readonly" : ""}></div><div><label class="lbl" for="cE">Selesai</label><input class="field" type="date" id="cE" value="${esc(c.end)}" ${ro ? "readonly" : ""}></div></div>
        <div><label class="lbl" for="cSt">Status</label><select class="field" id="cSt" ${ro ? "disabled" : ""}>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>`;
      foot = ro ? "" : `<button class="btn btn-primary" id="wSave">Simpan ke Campaign</button>`;
      wire = (s) => { dirty(s);
        $("#wRef").onchange = () => { const after = clone(o); after.data.ref = $("#wRef").value; const ch = [{ id, before: o, after }]; Store.commit(ch); History.push(ch, "Ganti campaign"); widget(id); };
        $("#wSave") && ($("#wSave").onclick = () => { Store.labSave("campaigns", { id: c.id, name: $("#cName").value.trim(), objective: $("#cObj").value.trim(), audience: $("#cAud").value.trim(), strategy: $("#cStr").value.trim(), start: $("#cS").value, end: $("#cE").value, status: $("#cSt").value }); $("#wDirty").hidden = true; toast("Campaign tersimpan (data contoh)"); }); };
    } else if (kind === "tasks" || kind === "content") {
      const isT = kind === "tasks", list = isT ? L.tasks : L.content;
      body += `<div class="stack">${list.map((x) => `<div class="task-card" data-row="${esc(x.id)}"><div class="full hd">${isT ? `<input type="checkbox" data-k="done" ${x.done ? "checked" : ""} ${ro ? "disabled" : ""} aria-label="Selesai">` : ""}<input class="field" data-k="title" value="${esc(x.title)}" ${ro ? "readonly" : ""} aria-label="Judul"></div>
        ${isT ? `<div><label class="lbl">PIC</label><select class="field" data-k="owner" ${ro ? "disabled" : ""}><option value="">Belum ada</option>${L.people.map((p) => `<option ${p === x.owner ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div><div><label class="lbl">Tenggat</label><input class="field" type="date" data-k="due" value="${esc(x.due || "")}" ${ro ? "readonly" : ""}></div>`
          : `<div><label class="lbl">Status</label><select class="field" data-k="status" ${ro ? "disabled" : ""}>${CSTATUS.map((s) => `<option ${s === x.status ? "selected" : ""}>${s}</option>`).join("")}</select></div><div><label class="lbl">Tanggal</label><input class="field" type="date" data-k="date" value="${esc(x.date || "")}" ${ro ? "readonly" : ""}></div>`}
        ${x.source ? `<div class="full"><button class="srclink" data-src="${esc(x.source.objectIds?.[0] || "")}">Lihat catatan asalnya di papan ↗</button></div>` : ""}</div>`).join("")}</div>`;
      foot = ro ? "" : `<button class="btn btn-primary" id="wSave">Simpan perubahan</button>`;
      wire = (s) => { dirty(s);
        s.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => Actions.jumpTo(b.dataset.src)));
        $("#wSave") && ($("#wSave").onclick = () => { s.querySelectorAll("[data-row]").forEach((r) => { const it = { id: r.dataset.row }; r.querySelectorAll("[data-k]").forEach((i) => (it[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value)); Store.labSave(kind, it); }); $("#wDirty").hidden = true; toast("Tersimpan (data contoh)"); }); };
    } else {
      body += `<div class="card" style="position:relative;box-shadow:none">${W.body(o, live ? W.live(o, L) : o.data.snap, L)}</div><div class="note" style="margin-top:12px">${ic("info")}<span>${kind === "brandbook" ? "Brand Book diubah di halamannya sendiri. Di sini kamu bisa menyalin kode warna." : "Angka ini dibaca dari Insights dan Pelacak Penjualan. Papan tidak pernah mengarang angka: kalau datanya belum ada, widget bilang belum ada."}</span></div>`;
    }
    if (!ro && W.live) foot += `<button class="btn btn-secondary" id="wMode">${live ? ic("lock") + " Bekukan jadi snapshot" : ic("refresh") + " Jadikan live lagi"}</button>`;
    open("widget", id, { title: W.name, icon: W.icon, body, foot, wire(s) { wire && wire(s); $("#wMode") && ($("#wMode").onclick = () => { Actions.toggleWidgetMode(Store.obj(id)); widget(id); }); } });
  }

  // ---------- ideas ----------
  function ideas(seed) {
    const f = Canvas.selObjs().find((o) => o.type === "frame");
    const topic = seed || (f ? f.text : (Store.board()?.name || "").replace(/^Contoh · /, ""));
    open("ideas", null, { title: "Minta ide", icon: "bulb", body: `<div class="stack">${aiNote()}
      <div><label class="lbl" for="iTopic">Topik</label><textarea class="field" id="iTopic" rows="2">${esc(topic)}</textarea></div>
      <div><label class="lbl">Arah</label><div class="seg" id="iDir">${["Konten", "Campaign", "Promo tanpa diskon", "Nama & tagline", "Bebas"].map((d, i) => `<button data-v="${d}" class="${i === 0 ? "on" : ""}">${d}</button>`).join("")}</div></div>
      <div><label class="lbl">Jumlah</label><div class="seg" id="iN">${[5, 8, 12].map((n, i) => `<button data-v="${n}" class="${i === 1 ? "on" : ""}">${n} ide</button>`).join("")}</div></div>
      <div class="note">${ic("dna")}<span>Ide dibuat dari Brand DNA & Brand Book Kopi Tepian, jadi nadanya sesuai brand. Kamu yang memilih mana yang masuk papan.</span></div>
      <div id="iOut"></div></div>`,
      foot: `<button class="btn btn-ai" id="iGo" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Minta ide ${UI.AI_COST}</button><button class="btn btn-secondary" id="iFree">${ic("bulb")} Pancingan gratis</button>`,
      wire(s) {
        s.querySelectorAll(".seg").forEach((g) => g.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }));
        const val = (id) => s.querySelector(`#${id} .on`).dataset.v;
        $("#iGo").onclick = async () => {
          const out = $("#iOut"); out.innerHTML = busyHTML("Menyusun ide dari Brand DNA…");
          const res = await AI.ideas($("#iTopic").value.trim(), val("iDir"), +val("iN"));
          if (!res) { out.innerHTML = ""; return; }
          pickList(out, res.map((r) => ({ t: r.ide, d: r.alasan })), "ai");
        };
        $("#iFree").onclick = () => pickList($("#iOut"), Rules.prompts($("#iTopic").value.trim(), val("iDir"), +val("iN")).map((t) => ({ t, d: "Pertanyaan pancingan, jawab di sticky" })), "prompt");
      } });
  }
  function pickList(out, items, kind) {
    out.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 8px"><b style="font-size:13px">${kind === "ai" ? "Pilih ide yang mau dipakai" : "Pilih pancingan yang mau dipakai"}</b><button class="btn btn-ghost btn-xs" data-all>Pilih semua</button></div><div class="stack" style="gap:8px">${items.map((it, i) => `<label class="pickrow"><input type="checkbox" data-i="${i}"><span class="t"><b>${esc(it.t)}</b>${it.d ? `<span>${esc(it.d)}</span>` : ""}</span></label>`).join("")}</div><button class="btn btn-primary" data-put style="margin-top:12px;width:100%" disabled>Taruh di papan</button>`;
    const btn = out.querySelector("[data-put]"), boxes = [...out.querySelectorAll("input[type=checkbox]")];
    const upd = () => { const n = boxes.filter((b) => b.checked).length; btn.disabled = !n; btn.textContent = n ? `Taruh ${n} di papan` : "Pilih minimal satu"; };
    boxes.forEach((b) => (b.onchange = upd));
    out.querySelector("[data-all]").onclick = () => { const all = boxes.every((b) => b.checked); boxes.forEach((b) => (b.checked = !all)); upd(); };
    btn.onclick = () => {
      if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
      const chosen = boxes.filter((b) => b.checked).map((b) => items[+b.dataset.i]);
      const cols = Math.min(4, chosen.length);
      const objs = chosen.map((it, i) => ({ id: "L" + i, type: "sticky", x: (i % cols) * 220, y: Math.floor(i / cols) * 220, w: 200, h: 200, text: it.t, color: kind === "ai" ? "violet" : "blue", ai: kind === "ai" }));
      const out2 = Canvas.insertObjects(objs, placeNear());
      setTimeout(() => Canvas.fit(out2.map((o) => o.id)), 60);
      toast(`${chosen.length} sticky ditaruh. Edit sesukamu.`);
    };
  }
  function placeNear() {
    const s = Canvas.selObjs();
    if (s.length) { const b = Canvas.bboxOf(s); return { x: b.x + b.w + 520, y: b.y + b.h / 2 }; }
    return Canvas.centerWorld();
  }

  // ---------- rewrite ----------
  function rewrite(id) {
    const o = Store.obj(id); if (!o) return;
    const MODES = [["Perjelas", "Perjelas kalimatnya, tetap singkat"], ["Lebih singkat", "Ringkas jadi maksimal 8 kata"], ["3 variasi headline", "Buat 3 variasi headline yang berbeda sudut pandangnya"], ["Caption IG", "Jadikan 2 pilihan caption Instagram pendek dengan ajakan yang tidak memaksa"], ["Brief singkat", "Jadikan creative brief 3 kalimat: tujuan, pesan, visual"]];
    open("rewrite", id, { title: "Tulis ulang", icon: "wand", body: `<div class="stack">${aiNote()}<div class="note">${ic("sticky")}<span>${esc(o.text)}</span></div><div class="layout-grid">${MODES.map(([m], i) => `<button data-m="${i}">${m}</button>`).join("")}</div><div id="rwOut"></div><p class="muted" style="font-size:12px;margin:0">AI hanya memberi pilihan. Teks aslimu tidak berubah sampai kamu pilih.</p></div>`,
      wire(s) {
        s.querySelectorAll("[data-m]").forEach((b) => (b.onclick = async () => {
          if (!AI.available) return toast("AI belum aktif di tampilan ini");
          s.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b));
          const out = $("#rwOut"); out.innerHTML = busyHTML("Menulis pilihan…");
          const res = await AI.rewrite(o.text, MODES[+b.dataset.m][1]);
          if (!res) { out.innerHTML = ""; return; }
          out.innerHTML = res.map((t, i) => `<div class="flagrow" style="margin-bottom:8px"><div style="white-space:pre-wrap;font-size:13.5px">${esc(t)}</div><div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-secondary btn-xs" data-rep="${i}">Ganti teks</button><button class="btn btn-ghost btn-xs" data-add="${i}">Taruh di sebelah</button></div></div>`).join("");
          out.querySelectorAll("[data-rep]").forEach((x) => (x.onclick = () => { const cur = Store.obj(id); const ch = [{ id, before: cur, after: { ...clone(cur), text: res[+x.dataset.rep] } }]; Store.commit(ch); History.push(ch, "Tulis ulang"); toast("Teks diganti", { action: "Urungkan", onAction: () => History.undo() }); }));
          out.querySelectorAll("[data-add]").forEach((x) => (x.onclick = () => { const cur = Store.obj(id); Canvas.insertObjects([{ id: "L1", type: "sticky", x: 0, y: 0, w: cur.w, h: cur.h, text: res[+x.dataset.add], color: "violet", ai: true }], { x: cur.x + cur.w * 1.5 + 30, y: cur.y + cur.h / 2 }); }));
        }));
      } });
  }

  // ---------- organize ----------
  function organize() {
    const { list, fromSel } = notesFromSel();
    if (list.length < 2) return toast("Butuh minimal 2 sticky berisi teks");
    let groups = Rules.cluster(list);
    const dups = Rules.duplicates(list);
    const render = (s) => {
      $("#orgGroups").innerHTML = groups.map((g, gi) => `<div class="group-card"><input class="gname" data-g="${gi}" value="${esc(g.name)}" aria-label="Nama kelompok"><div class="gitems">${g.ids.map((id) => { const o = Store.obj(id); return o ? `<span class="mini-sticky" style="background:${stickyBg(o.color)}">${esc(o.text.slice(0, 40))}</span>` : ""; }).join("")}</div></div>`).join("");
      s.querySelectorAll(".gname").forEach((i) => (i.oninput = () => (groups[+i.dataset.g].name = i.value)));
    };
    open("organize", null, { title: "Rapikan ide", icon: "organize", body: `<div class="stack"><p class="lead">${fromSel ? `${list.length} catatan terpilih` : `Semua ${list.length} sticky di papan (pilih beberapa dulu kalau mau sebagian)`} dikelompokkan berdasarkan kata yang mirip. Gratis, tanpa AI.</p>
      ${dups.length ? `<div class="flagrow bad"><div class="q">${dups.length} pasang catatan mirip</div>${dups.slice(0, 5).map(([a, b]) => `<div class="why">“${esc(Store.obj(a).text.slice(0, 50))}” ≈ “${esc(Store.obj(b).text.slice(0, 50))}”</div>`).join("")}<button class="btn btn-secondary btn-xs" id="orgDup" style="margin-top:8px">Tandai di papan</button></div>` : '<div class="note">' + ic("check") + "<span>Tidak ada catatan yang dobel.</span></div>"}
      <div id="orgGroups" class="stack" style="gap:8px"></div>${AI.available ? "" : aiNote()}</div>`,
      foot: `<button class="btn btn-primary" id="orgGo">${ic("organize")} Susun di papan</button><button class="btn btn-ai" id="orgAI" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Tema lebih tepat ${UI.AI_COST}</button>`,
      wire(s) {
        render(s);
        $("#orgDup") && ($("#orgDup").onclick = () => { for (const [a, b] of dups) { Flags.set(b, { kind: "dup", label: "Mirip catatan lain" }); Flags.set(a, { kind: "dup", label: "Mirip catatan lain" }); } toast("Catatan mirip ditandai. Tanda hilang saat halaman dimuat ulang."); });
        $("#orgAI").onclick = async () => { $("#orgGroups").innerHTML = busyHTML("Mencari tema…"); const g = await AI.themes(list); if (g) groups = g; render(s); };
        $("#orgGo").onclick = () => { if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini"); arrange(groups); };
      } });
  }
  function arrange(groups) {
    const all = groups.flatMap((g) => g.ids).map(Store.obj).filter(Boolean);
    const b = Canvas.bboxOf(all);
    let x = b.x + b.w + 160; const y = b.y;
    const changes = [];
    let z = Store.nextZ("frame");
    groups.forEach((g, gi) => {
      const items = g.ids.map(Store.obj).filter(Boolean); if (!items.length) return;
      const cols = Math.min(3, items.length), rows = Math.ceil(items.length / cols);
      const fw = 40 + cols * 220, fh = 60 + rows * 220;
      const color = ["#ffa52b", "#7ab8ff", "#ff7eb6", "#3ddc84", "#b38cff", "#ffc94a"][gi % 6];
      const fr = Store.newObject({ type: "frame", x, y, w: fw, h: fh, text: g.name || `Kelompok ${gi + 1}`, color, z: z++ });
      changes.push({ id: fr.id, before: null, after: fr });
      items.forEach((o, i) => changes.push({ id: o.id, before: o, after: { ...clone(o), x: x + 30 + (i % cols) * 220, y: y + 40 + Math.floor(i / cols) * 220, r: 0 } }));
      x += fw + 60;
    });
    Store.commit(changes); History.push(changes, "Rapikan");
    setTimeout(() => Canvas.fit(changes.map((c) => c.id)), 60);
    toast(`${groups.length} kelompok disusun`, { action: "Urungkan", onAction: () => History.undo() });
  }

  // ---------- meeting recap ----------
  function recap() {
    let r = Rules.recap();
    if (!r.peserta?.length) r.peserta = Board.attendees().map((p) => p.name);
    const SECS = [["ringkasan", "Gambaran rapat", true], ["peserta", "Peserta rapat"], ["topik", "Topik yang dibahas"], ["ide", "Ide utama"], ["keputusan", "Keputusan"], ["terpilih", "Ide terpilih (dari voting)"], ["pertanyaan", "Pertanyaan terbuka"], ["aksi", "Tugas"], ["langkah", "Langkah berikutnya"]];
    const draw = () => {
      $("#rcBody").innerHTML = SECS.map(([k, label, single]) => {
        if (single) return `<div class="recap-sec"><h5>${label}</h5><textarea class="field" data-k="${k}" rows="3">${esc(r[k] || "")}</textarea></div>`;
        const arr = r[k] || [];
        return `<div class="recap-sec"><h5>${label} <small>${k === "keputusan" ? "hanya yang ditandai Keputusan" : k === "aksi" ? "PIC & tenggat hanya kalau ditulis" : ""}</small></h5><div class="editlist" data-list="${k}">${arr.map((x, i) => k === "aksi"
          ? `<div class="er"><input type="checkbox" data-tk="${i}" aria-label="Jadikan tugas" style="margin-top:10px;accent-color:var(--accent-fill)"><textarea class="field" data-k="${k}" data-i="${i}" rows="1">${esc(x.tugas)}</textarea><input class="field" data-pic="${i}" value="${esc(x.pic || "")}" placeholder="PIC" style="width:86px"><input class="field" data-dl="${i}" value="${esc(x.deadline || "")}" placeholder="Tenggat" style="width:86px"><button class="icon-btn x" data-del="${k}:${i}" aria-label="Hapus">${ic("x")}</button></div>`
          : `<div class="er"><textarea class="field" data-k="${k}" data-i="${i}" rows="1">${esc(x)}</textarea><button class="icon-btn x" data-del="${k}:${i}" aria-label="Hapus">${ic("x")}</button></div>`).join("") || '<span class="faint" style="font-size:12px">Kosong</span>'}</div><button class="btn btn-ghost btn-xs" data-addrow="${k}" style="margin-top:6px">${ic("plus")} Tambah</button></div>`;
      }).join("");
    };
    const read = () => {
      $$("#rcBody [data-k]").forEach((el) => { const k = el.dataset.k; if (el.dataset.i == null) r[k] = el.value; else if (k === "aksi") r.aksi[+el.dataset.i].tugas = el.value; else r[k][+el.dataset.i] = el.value; });
      $$("#rcBody [data-pic]").forEach((el) => (r.aksi[+el.dataset.pic].pic = el.value.trim()));
      $$("#rcBody [data-dl]").forEach((el) => (r.aksi[+el.dataset.dl].deadline = el.value.trim()));
    };
    open("recap", null, { title: "Ringkasan rapat", icon: "file", body: `<div class="stack"><p class="lead">Disusun dari isi papan: frame, tanda Keputusan/Pertanyaan, vote, checklist, dan komentar. Periksa dan ubah dulu sebelum disimpan.</p>${aiNote()}<div id="rcBody" class="stack"></div><div id="rcPast"></div></div>`,
      foot: `<button class="btn btn-primary" id="rcSave">Simpan</button><button class="btn btn-secondary" id="rcPin">Tempel di papan</button>${BL() && Store.lab().goals?.length > 1 ? `<select class="field" id="rcGoal" style="width:auto;max-width:160px" aria-label="Tujuan untuk tugas">${Store.lab().goals.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select>` : ""}<button class="btn btn-secondary" id="rcTasks">Jadikan tugas</button><button class="btn btn-ai" id="rcAI" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Rapikan bahasa ${UI.AI_COST}</button>`,
      async wire(s) {
        draw();
        s.addEventListener("click", (e) => {
          const d = e.target.closest("[data-del]"), a = e.target.closest("[data-addrow]");
          if (d) { read(); const [k, i] = d.dataset.del.split(":"); r[k].splice(+i, 1); draw(); }
          if (a) { read(); const k = a.dataset.addrow; (r[k] = r[k] || []).push(k === "aksi" ? { tugas: "", pic: "", deadline: "" } : ""); draw(); }
        });
        $("#rcAI").onclick = async () => { read(); const box = $("#rcBody"); const keep = box.innerHTML; box.innerHTML = busyHTML("Merapikan bahasa ringkasan…"); const res = await AI.recap(r); if (res) { r = res; toast("Bahasanya dirapikan. Keputusan, PIC, dan tenggat tidak ditambah."); } draw(); void keep; };
        $("#rcSave").onclick = async () => { read(); if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini"); await Store.saveColl("recaps", { recap: clone(r) }, 20); toast("Ringkasan tersimpan di papan ini"); past(); };
        $("#rcPin").onclick = () => { read(); const o = Store.newObject({ type: "doc", x: 0, y: 0, w: 420, h: 520, text: "Ringkasan rapat", data: { ...clone(r), at: Date.now() } }); const c = Canvas.centerWorld(); o.x = Math.round(c.x - 210); o.y = Math.round(c.y - 260); Canvas.add([o], { select: true }); };
        $("#rcTasks").onclick = () => {
          read(); const picks = $$("#rcBody [data-tk]").filter((x) => x.checked).map((x) => r.aksi[+x.dataset.tk]).filter((x) => x.tugas.trim());
          if (!picks.length) return toast("Centang tugas yang mau dibuat dulu");
          if (BL()) { const L = Store.lab(); if (!L.goals?.length) return toast("Tugas di Brandlab menempel ke sebuah Tujuan. Buat Tujuan dulu.", { action: "Buka Tujuan", onAction: () => window.__papanGo?.("goals") }); const gid = $("#rcGoal")?.value || L.goals[0].id; for (const t of picks) Store.labSave("tasks", { goalId: gid, title: t.tugas.trim(), due: Rules.parseDate(t.deadline) || "" }); return toast(`${picks.length} tugas dibuat di Tujuan “${L.goals.find((g) => g.id === gid)?.name || ""}”`); }
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          for (const t of picks) Store.labSave("tasks", { id: uid("t"), title: t.tugas.trim(), owner: t.pic || "", due: Rules.parseDate(t.deadline) || "", done: false, priority: "sedang", source: { boardId: Store.S.boardId, objectIds: t.ids || [] } });
          toast(`${picks.length} tugas dibuat di Brandlab${EX()}`);
        };
        past();
        async function past() {
          const list = await Store.listColl("recaps", 10);
          const el = $("#rcPast"); if (!el) return;
          el.innerHTML = list.length ? `<div class="mh" style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--faint);margin:6px 0">Tersimpan</div>${list.map((x) => `<div class="ver"><div class="t"><b>${fmtDate(x.at)}</b><span>oleh ${esc(Collab.nameOf(x.by))} · ${(x.recap?.keputusan || []).length} keputusan, ${(x.recap?.aksi || []).length} tugas</span></div><button class="btn btn-ghost btn-xs" data-open="${x.id}">Buka</button></div>`).join("")}` : "";
          el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const x = list.find((y) => y.id === b.dataset.open); r = clone(x.recap); draw(); toast("Ringkasan lama dibuka"); }));
        }
      } });
  }

  // ---------- brand consistency ----------
  function consistency() {
    const { list, fromSel } = notesFromSel();
    if (!list.length) return toast("Belum ada catatan untuk dicek");
    const results = list.map((o) => ({ o, ...Rules.brandCheck(o.text) }));
    const draw = (res) => res.map((x) => `<div class="flagrow ${x.ok ? "good" : "bad"}"><div class="q">${x.ok ? "✓" : "!"} ${esc(x.o.text.slice(0, 90))}</div>${x.reasons.map((r) => `<div class="why">${esc(r)}</div>`).join("")}${x.sug ? `<div class="sug"><b>Saran:</b> ${esc(x.sug)}<div style="margin-top:6px"><button class="btn btn-secondary btn-xs" data-use="${x.o.id}">Pakai saran ini</button></div></div>` : ""}</div>`).join("");
    open("consistency", null, { title: "Cek konsistensi brand", icon: "shield", body: `<div class="stack"><p class="lead">${fromSel ? list.length + " catatan terpilih" : "Semua sticky"} dicek terhadap kata yang dihindari dan gaya bicara di Brand Book. Saran tidak pernah dipasang otomatis.</p>${aiNote()}<div id="ccOut" class="stack" style="gap:8px">${draw(results)}</div></div>`,
      foot: `<button class="btn btn-secondary" id="ccFlag">Tandai di papan</button><button class="btn btn-ai" id="ccAI" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Cek lebih dalam ${UI.AI_COST}</button>`,
      wire(s) {
        let cur2 = results;
        const bindUse = () => s.querySelectorAll("[data-use]").forEach((b) => (b.onclick = () => { const x = cur2.find((y) => y.o.id === b.dataset.use); const o = Store.obj(x.o.id); if (!o || !Store.canWrite) return; const ch = [{ id: o.id, before: o, after: { ...clone(o), text: x.sug } }]; Store.commit(ch); History.push(ch, "Pakai saran"); toast("Teks diganti", { action: "Urungkan", onAction: () => History.undo() }); }));
        bindUse();
        $("#ccFlag").onclick = () => { for (const x of cur2) Flags.set(x.o.id, x.ok ? { kind: "ok", label: "Sesuai brand" } : { kind: "flag", label: "Cek brand" }); toast("Hasil ditandai di papan"); };
        $("#ccAI").onclick = async () => { $("#ccOut").innerHTML = busyHTML("Membandingkan dengan Brand DNA…"); const res = await AI.brandCheck(list); if (res) cur2 = res; $("#ccOut").innerHTML = draw(cur2); bindUse(); };
      } });
  }

  // ---------- notes → tasks / content / campaign ----------
  function tasks() {
    const { list } = notesFromSel(false);
    if (!list.length) return toast("Pilih sticky yang mau dijadikan tugas");
    if (BL()) return blTasks(list);
    const L = Store.lab();
    const rows = list.map((o) => ({ o, ...Rules.parseTask(o.text) }));
    open("tasks", null, { title: "Jadikan tugas", icon: "task", body: `<div class="stack"><p class="lead">PIC dan tenggat hanya terisi kalau tertulis di catatan (misal "@Desainer" atau "15/11"). Sisanya kamu yang tentukan.</p><div class="task-grid">${rows.map((r, i) => `<div class="task-card" data-i="${i}"><div class="full"><label class="lbl">Tugas</label><input class="field" data-k="title" value="${esc(r.title)}"></div>
      <div><label class="lbl">PIC</label><select class="field" data-k="owner"><option value="">Belum ada</option>${L.people.map((p) => `<option ${p === r.owner ? "selected" : ""}>${esc(p)}</option>`).join("")}${r.owner && !L.people.includes(r.owner) ? `<option selected>${esc(r.owner)}</option>` : ""}</select></div>
      <div><label class="lbl">Tenggat</label><input class="field" type="date" data-k="due" value="${esc(r.due)}"></div>
      <div><label class="lbl">Prioritas</label><select class="field" data-k="priority">${["rendah", "sedang", "tinggi"].map((p) => `<option ${p === r.priority ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div><label class="lbl">Campaign</label><select class="field" data-k="campaignId"><option value="">–</option>${L.campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div></div>`).join("")}</div></div>`,
      foot: `<button class="btn btn-primary" id="tkGo">Buat ${rows.length} tugas</button>`,
      wire(s) {
        $("#tkGo").onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          const changes = [];
          s.querySelectorAll(".task-card").forEach((c) => { const r = rows[+c.dataset.i]; const t = { id: uid("t"), done: false, source: { boardId: Store.S.boardId, objectIds: [r.o.id] } }; c.querySelectorAll("[data-k]").forEach((i) => (t[i.dataset.k] = i.value)); Store.labSave("tasks", t); const o = Store.obj(r.o.id); if (o) changes.push({ id: o.id, before: o, after: { ...clone(o), linked: { ...(o.linked || {}), task: t.id } } }); });
          if (changes.length) { Store.commit(changes); History.push(changes, "Jadikan tugas"); }
          close(); toast(`${rows.length} tugas dibuat di Brandlab${EX()}. Catatan aslinya tetap di papan.`, { action: "Tampilkan", onAction: () => Actions.addWidget("tasks") });
        };
      } });
  }
  function toContent() {
    const { list } = notesFromSel(false);
    if (!list.length) return toast("Pilih sticky ide konten dulu");
    if (BL()) return blContent(list);
    const L = Store.lab();
    open("content", null, { title: "Kirim ke Rencana konten", icon: "content", body: `<div class="stack"><p class="lead">Masuk sebagai status <b>ide</b>. Tanggal dan PIC bisa diisi sekarang atau nanti di Brandlab.</p>${list.map((o, i) => { const p = Rules.parseTask(o.text); return `<div class="task-card" data-i="${i}"><div class="full"><label class="lbl">Judul konten</label><input class="field" data-k="title" value="${esc(p.title)}"></div><div><label class="lbl">Platform</label><select class="field" data-k="platform">${["Instagram", "TikTok", "YouTube", "WhatsApp"].map((x) => `<option ${Rules.channels(o.text)[0] === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div><label class="lbl">Tanggal</label><input class="field" type="date" data-k="date" value="${esc(p.due)}"></div><div class="full"><label class="lbl">PIC</label><select class="field" data-k="pic"><option value="">Belum ada</option>${L.people.map((x) => `<option ${x === p.owner ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div></div>`; }).join("")}</div>`,
      foot: `<button class="btn btn-primary" id="ctGo">Kirim ${list.length} ide</button>`,
      wire(s) {
        $("#ctGo").onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          const changes = [];
          s.querySelectorAll(".task-card").forEach((c) => { const o = list[+c.dataset.i]; const k = { id: uid("k"), status: "ide", source: { boardId: Store.S.boardId, objectIds: [o.id] } }; c.querySelectorAll("[data-k]").forEach((i) => (k[i.dataset.k] = i.value)); Store.labSave("content", k); const cur = Store.obj(o.id); if (cur) changes.push({ id: o.id, before: cur, after: { ...clone(cur), linked: { ...(cur.linked || {}), content: k.id } } }); });
          if (changes.length) { Store.commit(changes); History.push(changes, "Kirim ke konten"); }
          close(); toast(`${list.length} ide masuk Rencana konten${EX()}`, { action: "Tampilkan", onAction: () => Actions.addWidget("content") });
        };
      } });
  }
  function campaign(prefill) {
    const { list } = notesFromSel(false);
    if (!list.length) return toast("Pilih sticky ide campaign dulu");
    let d = { ...Rules.campaignDraft(list), ...(prefill || {}) };
    if (BL()) return blCampaign(list, d);
    const form = () => `<div><label class="lbl" for="cpN">Nama campaign</label><input class="field" id="cpN" value="${esc(d.name)}"></div><div><label class="lbl" for="cpO">Tujuan (sebaiknya ada angka)</label><textarea class="field" id="cpO" rows="2">${esc(d.objective)}</textarea></div><div><label class="lbl" for="cpA">Audiens</label><textarea class="field" id="cpA" rows="2">${esc(d.audience)}</textarea></div><div><label class="lbl" for="cpS">Strategi</label><textarea class="field" id="cpS" rows="3">${esc(d.strategy)}</textarea></div>
      <div><label class="lbl">Channel</label><div class="chips">${["Instagram", "TikTok", "YouTube", "WhatsApp", "Offline"].map((c) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-ch="${c}" ${d.channels.includes(c) ? "checked" : ""} style="accent-color:var(--accent-fill)"> ${c}</label>`).join("")}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label class="lbl" for="cpSt">Mulai</label><input class="field" type="date" id="cpSt" value="${esc(d.start)}"></div><div><label class="lbl" for="cpE">Selesai</label><input class="field" type="date" id="cpE" value="${esc(d.end)}"></div></div>
      <label class="pickrow" style="padding:8px"><input type="checkbox" id="cpW" checked><span class="t"><b>Taruh widget campaign di papan</b><span>Supaya tim lihat statusnya langsung</span></span></label>`;
    open("campaign", null, { title: "Jadikan campaign", icon: "megaphone", body: `<div class="stack"><p class="lead">Draft dari ${list.length} catatan. Catatan aslinya tetap di papan dan tersambung ke campaign ini.</p>${aiNote()}<div id="cpForm" class="stack">${form()}</div></div>`,
      foot: `<button class="btn btn-primary" id="cpGo">Buat campaign</button><button class="btn btn-ai" id="cpAI" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Isi draft ${UI.AI_COST}</button>`,
      wire(s) {
        $("#cpAI").onclick = async () => { const f = $("#cpForm"); f.innerHTML = busyHTML("Menyusun draft campaign dari catatanmu…"); const res = await AI.campaign(list); if (res) d = { ...d, ...res }; f.innerHTML = form(); };
        $("#cpGo").onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          const c = { id: uid("c"), name: $("#cpN").value.trim() || "Campaign baru", objective: $("#cpO").value.trim(), audience: $("#cpA").value.trim(), strategy: $("#cpS").value.trim(), channels: $$("#cpForm [data-ch]").filter((x) => x.checked).map((x) => x.dataset.ch), start: $("#cpSt").value, end: $("#cpE").value, status: "plan", metrics: null, source: { boardId: Store.S.boardId, objectIds: list.map((o) => o.id) } };
          Store.labSave("campaigns", c);
          const changes = list.map((o) => ({ id: o.id, before: o, after: { ...clone(o), linked: { ...(o.linked || {}), campaign: c.id } } }));
          Store.commit(changes); History.push(changes, "Jadikan campaign");
          if ($("#cpW").checked) { const b = Canvas.bboxOf(list); Actions.addWidget("campaign", { x: b.x + b.w + 260, y: b.y + 200 }, { ref: c.id }); }
          close(); toast(`Campaign “${c.name}” dibuat${EX()}`);
        };
      } });
  }

  // ---------- versions ----------
  async function history() {
    open("history", null, { title: "Riwayat versi", icon: "history", body: `<div class="stack"><div style="display:flex;gap:8px"><input class="field" id="vName" placeholder="Nama versi, misal: Sebelum rapat klien"><button class="btn btn-primary" id="vSave">Simpan</button></div><p class="muted" style="font-size:12px;margin:0">Versi otomatis tersimpan tiap 10 menit saat ada perubahan, dan sebelum kamu memulihkan versi lain.</p><div id="vList">${busyHTML("Memuat…")}</div></div>` ,
      wire(s) {
        const load = async () => {
          const list = await Store.listColl("versions", 30);
          $("#vList").innerHTML = list.length ? list.map((v) => `<div class="ver"><div style="width:74px;height:46px;flex:none;border-radius:8px;background:var(--canvas);overflow:hidden;padding:3px;box-sizing:border-box">${UI.previewSVG(v.objects || [])}</div><div class="t"><b>${esc(v.name || "Versi")}</b><span>${fmtDate(v.at)} · ${esc(Collab.nameOf(v.by))} · ${(v.objects || []).length} objek${v.auto ? " · otomatis" : ""}</span></div><div class="confirm"><button class="btn btn-secondary btn-xs" data-rv="${v.id}">Pulihkan</button></div></div>`).join("") : '<p class="muted">Belum ada versi tersimpan.</p>';
          s.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = async () => {
            if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
            if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Yakin pulihkan?"; b.classList.replace("btn-secondary", "btn-danger"); return; }
            const v = list.find((x) => x.id === b.dataset.rv);
            await Versions.restore(v); load();
          }));
        };
        $("#vSave").onclick = async () => { if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini"); await Versions.save($("#vName").value.trim() || "Versi manual", false); $("#vName").value = ""; toast("Versi tersimpan"); load(); };
        load();
      } });
  }

  // ---------- votes & approvals ----------
  function votes() {
    const r = Board.round();
    const list = Store.objects().filter((o) => o.type === "sticky").map((o) => ({ o, n: Board.votesFor(o).count })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const max = list[0]?.n || 1;
    // While voting runs the counts stay hidden (no bandwagon), only the turnout shows.
    if (Board.votingActive()) return open("votes", null, { title: "Voting berjalan", icon: "vote",
      body: `<div class="stack"><div class="note violet">${ic("vote")}<span>Hasil disembunyikan sampai voting selesai, supaya tiap orang memilih sendiri. Klik sticky untuk vote.</span></div><p><b class="tnum">${Board.voters()}</b> orang sudah vote · tiap orang ${Board.votesPer()} vote.</p></div>`,
      foot: Store.canWrite && !GUEST() ? `<button class="btn btn-primary" id="vtEnd">Selesai & lihat hasil</button>` : "",
      wire() { $("#vtEnd") && ($("#vtEnd").onclick = () => Board.endVoting()); } });
    open("votes", null, { title: "Hasil voting", icon: "vote", body: `<div class="stack">${!r ? '<p class="muted">Belum pernah ada voting di papan ini.</p>' : list.length ? list.map((x) => `<div class="res-row"><span class="t" title="${esc(x.o.text)}">${esc(x.o.text)}</span><span class="bar"><i style="width:${(x.n / max) * 100}%"></i></span><b class="tnum">${x.n}</b><button class="icon-btn" data-go="${x.o.id}" aria-label="Lihat">${ic("arrowRight")}</button></div>`).join("") : '<p class="muted">Belum ada vote masuk.</p>'}</div>`,
      foot: Store.canWrite ? `${list.length ? `<button class="btn btn-primary" id="vtTop">Tandai 3 teratas sebagai terpilih</button>` : ""}${Board.votingActive() ? `<button class="btn btn-secondary" id="vtEnd">Selesai voting</button>` : `<button class="btn btn-secondary" id="vtNew">Voting baru</button>`}` : "",
      wire(s) {
        s.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => Actions.jumpTo(b.dataset.go)));
        $("#vtTop") && ($("#vtTop").onclick = () => { const ch = list.slice(0, 3).map((x) => ({ id: x.o.id, before: x.o, after: { ...clone(x.o), tag: "terpilih" } })); Store.commit(ch); History.push(ch, "Tandai terpilih"); toast("3 ide teratas ditandai Terpilih"); });
        $("#vtEnd") && ($("#vtEnd").onclick = () => Board.endVoting());
        $("#vtNew") && ($("#vtNew").onclick = (e) => UI.votingPop(e.currentTarget));
      } });
  }
  function approvals() {
    const list = Store.objects().filter((o) => o.status);
    const g = (st) => list.filter((o) => o.status === st);
    const row = (o) => `<div class="vi"><div class="t"><b>${esc((objText(o) || o.type).slice(0, 70))}</b><span>${{ review: "Menunggu review", approved: "Disetujui", revisi: "Perlu revisi" }[o.status]} · ${esc(Collab.nameOf(o.updatedBy))} · ${timeAgo(o.updatedAt)}</span></div><button class="icon-btn" data-go="${o.id}" aria-label="Lihat">${ic("arrowRight")}</button>${Store.canWrite && o.status === "review" ? `<button class="btn btn-secondary btn-xs" data-ap="${o.id}">Setujui</button><button class="btn btn-ghost btn-xs" data-rv="${o.id}">Revisi</button>` : ""}</div>`;
    open("approvals", null, { title: "Persetujuan klien", icon: "approve", body: `<div class="stack"><p class="lead">Tandai frame atau ide lewat menu ⋯ → Minta review. Klien bisa menyetujui atau minta revisi. Di Brandlab, klien masuk sebagai tamu dan hanya melihat yang tidak internal.</p>
      ${[["review", "Menunggu review"], ["revisi", "Perlu revisi"], ["approved", "Disetujui"]].map(([k, t]) => `<div><label class="lbl">${t} (${g(k).length})</label><div class="vlist">${g(k).map(row).join("") || '<span class="faint" style="font-size:12px">Belum ada</span>'}</div></div>`).join("")}</div>`,
      wire(s) {
        s.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => Actions.jumpTo(b.dataset.go)));
        const setSt = (id, st) => { const o = Store.obj(id); const ch = [{ id, before: o, after: { ...clone(o), status: st } }]; Store.commit(ch); History.push(ch, "Persetujuan"); approvals(); };
        s.querySelectorAll("[data-ap]").forEach((b) => (b.onclick = () => setSt(b.dataset.ap, "approved")));
        s.querySelectorAll("[data-rv]").forEach((b) => (b.onclick = () => setSt(b.dataset.rv, "revisi")));
      } });
  }

  // ---------- Brandlab: records go into the real features ----------
  function linkNotes(list, key, id, label) {
    const ch = list.map((o) => Store.obj(o.id)).filter(Boolean).map((o) => ({ id: o.id, before: o, after: { ...clone(o), linked: { ...(o.linked || {}), [key]: id } } }));
    if (ch.length) { Store.commit(ch); History.push(ch, label); }
  }
  function blWidget(o) {
    const kind = o.data.kind, W = WIDGETS[kind], L = Store.lab();
    const live = o.data.mode !== "snapshot";
    const src = live ? (W.live ? W.live(o, L) : null) : o.data.snap;
    const camp = kind === "campaign";
    open("widget", o.id, { title: W.name, icon: W.icon,
      body: `<div class="stack"><div class="chips">${W.live ? (live ? '<span class="chip live">● Live: data brand ini</span>' : `<span class="chip snap">Snapshot ${fmtDate(o.data.snapAt)}</span>`) : ""}</div>
        ${camp && L.campaigns.length > 1 && Store.canWrite ? `<div><label class="lbl" for="wRef">Campaign yang ditampilkan</label><select class="field" id="wRef">${L.campaigns.map((x) => `<option value="${esc(x.id)}" ${x.id === src?.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>` : ""}
        <div class="card" style="position:relative;box-shadow:none"><div class="card-b">${W.body(o, src, L)}</div></div>
        <div class="note">${ic("info")}<span>Ubah isinya di halaman aslinya di Brandlab, supaya semua fitur ikut memakai versi yang sama. Widget live langsung ikut berubah.</span></div></div>`,
      foot: `${W.open ? `<button class="btn btn-primary" id="wOpen">${ic("arrowRight")} Buka di Brandlab</button>` : ""}${Store.canWrite && W.live ? `<button class="btn btn-secondary" id="wMode">${live ? ic("lock") + " Bekukan jadi snapshot" : ic("refresh") + " Jadikan live lagi"}</button>` : ""}`,
      wire(s) {
        $("#wOpen", s) && ($("#wOpen", s).onclick = () => window.__papanGo?.(W.open, camp ? src?.id : null));
        $("#wMode", s) && ($("#wMode", s).onclick = () => { Actions.toggleWidgetMode(Store.obj(o.id)); blWidget(Store.obj(o.id)); });
        $("#wRef", s) && ($("#wRef", s).onchange = (e) => { const cur = Store.obj(o.id); const after = clone(cur); after.data.ref = e.target.value; const ch = [{ id: cur.id, before: cur, after }]; Store.commit(ch); History.push(ch, "Ganti campaign"); blWidget(Store.obj(o.id)); });
      } });
  }
  function blTasks(list) {
    const L = Store.lab();
    if (!L.goals?.length) return open("tasks", null, { title: "Jadikan tugas", icon: "task", body: `<div class="note">${ic("info")}<span>Tugas di Brandlab selalu menempel ke sebuah <b>Tujuan</b>, supaya kelihatan di roadmap dan Beranda. Brand ini belum punya Tujuan.</span></div>`, foot: `<button class="btn btn-primary" id="tkGoal">${ic("arrowRight")} Buat Tujuan</button>`, wire(s) { $("#tkGoal", s).onclick = () => window.__papanGo?.("goals"); } });
    const rows = list.map((o) => ({ o, ...Rules.parseTask(o.text) }));
    open("tasks", null, { title: "Jadikan tugas", icon: "task", body: `<div class="stack"><div><label class="lbl" for="tkG">Masuk ke Tujuan</label><select class="field" id="tkG">${L.goals.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></div>
      <p class="lead">Tenggat hanya terisi kalau tertulis di catatan (misal "15/11").</p><div class="task-grid">${rows.map((r, i) => `<div class="task-card" data-i="${i}"><div class="full"><label class="lbl">Tugas</label><input class="field" data-k="title" value="${esc(r.title)}"></div><div class="full"><label class="lbl">Tenggat</label><input class="field" type="date" data-k="due" value="${esc(r.due)}"></div></div>`).join("")}</div></div>`,
      foot: `<button class="btn btn-primary" id="tkGo">Buat ${rows.length} tugas</button>`,
      wire(s) {
        $("#tkGo", s).onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          const gid = $("#tkG", s).value; let n = 0;
          s.querySelectorAll(".task-card").forEach((c) => { const r = rows[+c.dataset.i]; const t = { goalId: gid }; c.querySelectorAll("[data-k]").forEach((i) => (t[i.dataset.k] = i.value)); const res = Store.labSave("tasks", t); if (res?.id) { n++; linkNotes([r.o], "task", res.id, "Jadikan tugas"); } });
          close(); toast(`${n} tugas masuk Tujuan “${L.goals.find((g) => g.id === gid)?.name || ""}”. Catatan aslinya tetap di papan.`, { action: "Buka Tujuan", onAction: () => window.__papanGo?.("tasks", gid) });
        };
      } });
  }
  function blContent(list) {
    open("content", null, { title: "Kirim ke Konten", icon: "content", body: `<div class="stack"><p class="lead">Masuk ke Konten sebagai <b>ide</b>. Jadwal bisa diisi sekarang atau nanti di Kalender.</p>${list.map((o, i) => { const p = Rules.parseTask(o.text); return `<div class="task-card" data-i="${i}"><div class="full"><label class="lbl">Judul konten</label><input class="field" data-k="title" value="${esc(p.title)}"></div><div><label class="lbl">Platform</label><select class="field" data-k="platform">${["Instagram", "TikTok", "YouTube", "Facebook", "LinkedIn", "WhatsApp"].map((x) => `<option ${Rules.channels(o.text)[0] === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div><label class="lbl">Jadwal</label><input class="field" type="date" data-k="date" value="${esc(p.due)}"></div></div>`; }).join("")}</div>`,
      foot: `<button class="btn btn-primary" id="ctGo">Kirim ${list.length} ide</button>`,
      wire(s) {
        $("#ctGo", s).onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          let n = 0, last = null;
          s.querySelectorAll(".task-card").forEach((c) => { const o = list[+c.dataset.i]; const k = { idea: o.text }; c.querySelectorAll("[data-k]").forEach((i) => (k[i.dataset.k] = i.value)); const res = Store.labSave("content", k); if (res?.id) { n++; last = res.id; linkNotes([o], "content", res.id, "Kirim ke konten"); } });
          close(); toast(`${n} ide masuk Konten`, { action: "Buka", onAction: () => window.__papanGo?.("content", n === 1 ? last : null) });
        };
      } });
  }
  function blCampaign(list, d) {
    const L = Store.lab();
    open("campaign", null, { title: "Jadikan campaign", icon: "megaphone", body: `<div class="stack"><p class="lead">Draft dari ${list.length} catatan, masuk ke Campaign sebagai <b>perencanaan</b>. Lengkapi di halaman Campaign.</p>${aiNote()}<div id="cpForm" class="stack">
      <div><label class="lbl" for="cpN">Nama campaign</label><input class="field" id="cpN" value="${esc(d.name)}"></div>
      <div><label class="lbl" for="cpObj">Jenis tujuan</label><select class="field" id="cpObj">${(L.objectives || []).map((x) => `<option value="${esc(x.id)}" ${x.id === "custom" ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></div>
      <div><label class="lbl" for="cpO">Pesan utama</label><textarea class="field" id="cpO" rows="2">${esc(d.objective)}</textarea></div>
      <div><label class="lbl" for="cpA">Audiens</label><textarea class="field" id="cpA" rows="2">${esc(d.audience)}</textarea></div>
      <div><label class="lbl" for="cpS">Ide besar</label><textarea class="field" id="cpS" rows="3">${esc(d.strategy)}</textarea></div>
      <div><label class="lbl">Channel</label><div class="chips">${["Instagram", "TikTok", "YouTube", "WhatsApp", "Offline"].map((c) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-ch="${c}" ${d.channels.includes(c) ? "checked" : ""} style="accent-color:var(--accent-fill)"> ${c}</label>`).join("")}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label class="lbl" for="cpSt">Mulai</label><input class="field" type="date" id="cpSt" value="${esc(d.start)}"></div><div><label class="lbl" for="cpE">Selesai</label><input class="field" type="date" id="cpE" value="${esc(d.end)}"></div></div>
      <label class="pickrow" style="padding:8px"><input type="checkbox" id="cpW" checked><span class="t"><b>Taruh widget campaign di papan</b><span>Supaya tim lihat statusnya langsung</span></span></label></div></div>`,
      foot: `<button class="btn btn-primary" id="cpGo">Buat campaign</button><button class="btn btn-ai" id="cpAI" ${AI.available ? "" : "disabled"}>${ic("sparkle")} Isi draft ${UI.AI_COST}</button>`,
      wire(s) {
        $("#cpAI", s).onclick = async () => { const keep = { name: $("#cpN", s).value }; $("#cpForm", s).style.opacity = ".5"; const res = await AI.campaign(list); $("#cpForm", s).style.opacity = ""; if (!res) return; if (res.name) $("#cpN", s).value = res.name || keep.name; if (res.objective) $("#cpO", s).value = res.objective; if (res.audience) $("#cpA", s).value = res.audience; if (res.strategy) $("#cpS", s).value = res.strategy; };
        $("#cpGo", s).onclick = () => {
          if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
          const c = { name: $("#cpN", s).value.trim() || "Campaign baru", objectiveId: $("#cpObj", s).value, objective: $("#cpO", s).value.trim(), audience: $("#cpA", s).value.trim(), strategy: $("#cpS", s).value.trim(), channels: $$("[data-ch]", s).filter((x) => x.checked).map((x) => x.dataset.ch), start: $("#cpSt", s).value, end: $("#cpE", s).value };
          const res = Store.labSave("campaigns", c);
          if (!res?.id) return toast("Campaign gagal dibuat. Coba lagi.");
          linkNotes(list, "campaign", res.id, "Jadikan campaign");
          if ($("#cpW", s).checked) { const b = Canvas.bboxOf(list); Actions.addWidget("campaign", { x: b.x + b.w + 260, y: b.y + 200 }, { ref: res.id }); }
          close(); toast(`Campaign “${c.name}” dibuat`, { action: "Buka", onAction: () => window.__papanGo?.("campaign", res.id) });
        };
      } });
  }

  Store.on((k) => { if (k === "comments" && cur?.kind === "comments") refresh(); if (k === "voting" && cur?.kind === "votes") votes(); if (k === "board-open") close(); });
  return { open, close, refresh, comments, widget, ideas, rewrite, organize, recap, consistency, tasks, toContent, campaign, history, votes, approvals, get current() { return cur; } };
})();

// Auto versions (every 10 minutes of the viewer's own edits) and restore.
const Versions = (() => {
  let lastAuto = Date.now(), dirty = false;
  Store.on((k, info) => { if (k === "objects" && info?.local) dirty = true; if (k === "board-open") { lastAuto = Date.now(); dirty = false; } });
  setInterval(() => { if (dirty && Store.canWrite && !GUEST() && Date.now() - lastAuto > 10 * 60000) { save("Otomatis", true); } }, 60000);
  async function save(name, auto) { dirty = false; lastAuto = Date.now(); try { await Store.saveColl("versions", { name, auto, objects: Store.snapshotObjects() }, 30); } catch (e) { console.warn(e); if (!auto) toast("Versi gagal disimpan"); } }
  async function restore(v) {
    await save("Sebelum dipulihkan", true);
    const target = new Map((v.objects || []).map((o) => [o.id, o]));
    const ch = [];
    for (const o of Store.objects()) if (!target.has(o.id)) ch.push({ id: o.id, before: o, after: null });
    for (let o of target.values()) {
      const c = Store.obj(o.id);
      if (o.type === "image" && o.data?.dropped && c?.data?.src) o = { ...o, data: { ...o.data, src: c.data.src, dropped: false } };
      if (!c || !deepEqual(c, o)) ch.push({ id: o.id, before: c || null, after: o });
    }
    Store.commit(ch); History.push(ch, "Pulihkan versi");
    toast(`Papan dipulihkan ke “${v.name || "versi"}”`, { action: "Urungkan", onAction: () => History.undo() });
    setTimeout(() => Canvas.fit(), 100);
  }
  return { save, restore };
})();

/* ---- 11z-assistant.js ---- */
// "Tanya Brandlab" inside the board: one chat that reads the board + Brand DNA and answers with
// suggestions the owner ticks before anything lands (sticky, task, content, campaign draft).
// Prototype: answered by Claude via AI.ask. In Brandlab: the existing consultant panel + api/ai.js on the owner's credits.
const Assistant = (() => {
  let msgs = [], busy = false, scope = "board";
  const KINDS = { sticky: "Sticky", tugas: "Tugas", konten: "Konten", campaign: "Campaign" };
  const key = () => "chat:" + (Store.S.boardId || "x");
  const load = () => { msgs = LS.get(key(), []) || []; };
  const save = () => LS.set(key(), msgs.slice(-40));
  const used = () => msgs.filter((m) => m.role === "ai" && !m.err).length;

  function boardContext(selOnly, alsoSel = false) {
    const objs = selOnly ? Canvas.selObjs() : Store.objects().filter(Canvas.visible);
    const frames = Store.objects().filter((o) => o.type === "frame" && Canvas.visible(o)).sort((a, b) => a.y - b.y || a.x - b.x);
    const line = (o) => {
      const v = Board.votesFor(o).count, tags = [o.tag, o.status].filter(Boolean).join(", ");
      const t = objText(o).replace(/\s+/g, " ").slice(0, 220);
      return t ? `- [${o.type}] ${t}${v ? ` (${v} vote)` : ""}${tags ? ` [${tags}]` : ""}` : "";
    };
    const out = [];
    if (selOnly) out.push("YANG DIPILIH:", ...objs.map(line).filter(Boolean));
    else {
      // Brandlab's chat: what's selected first, then still the whole board,
      // so "rangkum papan ini" works with a note still selected.
      if (alsoSel && Canvas.sel.size) out.push("YANG DIPILIH:", ...Canvas.selObjs().map(line).filter(Boolean), "");
      const used = new Set();
      for (const f of frames) {
        const kids = objs.filter((o) => o.type !== "frame" && o.type !== "connector" && Rules.inside(o, f));
        kids.forEach((k) => used.add(k.id));
        out.push(`## ${f.text}${f.internal ? " (internal)" : ""}`, ...kids.map(line).filter(Boolean));
      }
      const rest = objs.filter((o) => !used.has(o.id) && o.type !== "frame" && o.type !== "connector").map(line).filter(Boolean);
      if (rest.length) out.push("## Di luar frame", ...rest);
      const cm = Store.comments().filter((c) => !c.resolved && !c.parent).slice(0, 8).map((c) => `- komentar: ${c.text.slice(0, 160)}`);
      if (cm.length) out.push("## Komentar terbuka", ...cm);
    }
    const L = Store.lab();
    out.push(BL() ? "## Data Brandlab" : "## Data Brandlab (contoh)", `Campaign: ${L.campaigns.map((c) => `${c.name} (${STATUS_LABEL[c.status]})`).join("; ")}`, `Tugas terbuka: ${L.tasks.filter((t) => !t.done).map((t) => t.title).join("; ") || "-"}`, `Rencana konten: ${L.content.map((k) => `${k.title} (${k.status})`).join("; ")}`);
    return out.join("\n").slice(0, 7000);
  }
  function prompt(question) {
    const hist = msgs.slice(-8).map((m) => `${m.role === "user" ? "TIM" : "KAMU"}: ${m.text}`).join("\n");
    return `Kamu adalah Tanya Brandlab, partner diskusi branding & marketing untuk tim ${Store.lab().brand.name}. Kamu membantu tim berpikir: beri bahan, pilihan, dan sudut pandang. Tim yang memilih dan memutuskan.
ATURAN: Bahasa Indonesia santai, pakai "kamu". Jawab langsung ke inti, maksimal ±150 kata kecuali diminta panjang. Jangan mengarang angka, nama orang, tanggal, atau keputusan yang tidak ada di papan/data. Kalau datanya tidak ada, bilang terus terang. Hindari kata yang dihindari Brand Book.

${AI.brandContext()}

ISI PAPAN "${(Store.board()?.name || "").replace(/^Contoh · /, "")}":
${boardContext(scope === "sel" && Canvas.sel.size > 0)}

${hist ? "OBROLAN SEBELUMNYA:\n" + hist + "\n\n" : ""}PERTANYAAN TIM: ${question}

Kalau cocok, sertakan usulan yang bisa langsung dipakai (maks 8): "sticky" untuk ide/catatan, "tugas" untuk pekerjaan, "konten" untuk ide konten, "campaign" untuk konsep campaign. Isi "pic" dan "tanggal" HANYA kalau tim menyebutnya. Kalau tidak perlu usulan, kirim array kosong.
Balas HANYA JSON: {"balasan": "teks jawaban, boleh baris baru dan '- ' untuk poin", "usulan": [{"jenis": "sticky|tugas|konten|campaign", "teks": "maks 18 kata", "detail": "opsional, 1 kalimat", "pic": "", "tanggal": "YYYY-MM-DD atau kosong", "platform": ""}]}`;
  }
  function clean(res, question) {
    if (!res || typeof res !== "object") return null;
    const said = (msgs.filter((m) => m.role === "user").map((m) => m.text).join(" ") + " " + question + " " + Store.objects().map(objText).join(" ")).toLowerCase();
    const usulan = (Array.isArray(res.usulan) ? res.usulan : []).filter((u) => u && KINDS[u.jenis] && String(u.teks || "").trim()).slice(0, 8).map((u) => ({
      jenis: u.jenis, teks: String(u.teks).trim(), detail: String(u.detail || "").trim(),
      pic: u.pic && said.includes(String(u.pic).toLowerCase()) ? String(u.pic) : "", // never invent an owner
      tanggal: /^\d{4}-\d{2}-\d{2}$/.test(u.tanggal || "") ? u.tanggal : "", platform: String(u.platform || ""),
    }));
    return { text: String(res.balasan || res.reply || "").trim() || "(Tidak ada jawaban.)", usulan };
  }
  async function send(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    if (!AI.available) return toast("AI belum aktif di tampilan ini");
    msgs.push({ role: "user", text, at: Date.now() }); save();
    busy = true; render(true);
    const res = clean(await AI.ask(prompt(text)), text);
    busy = false;
    if (res) msgs.push({ role: "ai", text: res.text, usulan: res.usulan, at: Date.now() });
    else msgs.push({ role: "ai", err: true, text: "Jawaban belum masuk. Coba kirim lagi.", at: Date.now() });
    save(); render(true);
  }
  const fmt = (t) => {
    const lines = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
    let html = "", inList = false;
    for (const l of lines) {
      const m = /^\s*[-•*]\s+(.*)/.exec(l) || /^\s*\d+[.)]\s+(.*)/.exec(l);
      if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; }
      else { if (inList) { html += "</ul>"; inList = false; } if (l.trim()) html += `<p>${l}</p>`; }
    }
    return html + (inList ? "</ul>" : "");
  };
  function msgHTML(m, i) {
    if (m.role === "user") return `<div class="cb me"><div class="bub">${fmt(m.text)}</div></div>`;
    const us = m.usulan || [];
    return `<div class="cb ai"><span class="aiav">${ic("sparkle")}</span><div class="bub${m.err ? " err" : ""}">${fmt(m.text)}
      ${us.length ? `<div class="sug-box" data-m="${i}"><div class="sug-h"><b>Usulan</b><button class="btn btn-ghost btn-xs" data-sall="${i}">Pilih semua</button></div>${us.map((u, j) => `<label class="sug${u.done ? " done" : ""}"><input type="checkbox" data-s="${i}:${j}" ${u.done ? "disabled" : ""}><span class="t"><span class="chip">${KINDS[u.jenis]}</span> ${esc(u.teks)}${u.detail ? `<small>${esc(u.detail)}</small>` : ""}${u.pic || u.tanggal ? `<small>${esc([u.pic, u.tanggal && fmtDay(u.tanggal)].filter(Boolean).join(" · "))}</small>` : ""}${u.done ? `<small class="ok">✓ ${esc(u.done)}</small>` : ""}</span></label>`).join("")}
      <div class="sug-act" data-act-for="${i}"></div></div>` : ""}</div></div>`;
  }
  function actions(i) {
    const box = $(`.sug-act[data-act-for="${i}"]`); if (!box) return;
    const picked = $$(`[data-s^="${i}:"]`).filter((x) => x.checked).map((x) => msgs[i].usulan[+x.dataset.s.split(":")[1]]);
    const n = (k) => picked.filter((u) => u.jenis === k).length;
    const btn = (k, label) => `<button class="btn btn-secondary btn-xs" data-do="${k}:${i}" ${picked.length ? "" : "disabled"}>${label}</button>`;
    box.innerHTML = picked.length ? [btn("papan", `Taruh ${picked.length} di papan`), n("tugas") || n("sticky") ? btn("tugas", `Jadikan tugas`) : "", n("konten") || n("sticky") ? btn("konten", "Kirim ke konten") : "", n("campaign") ? btn("campaign", "Buka draft campaign") : ""].join("") : '<span class="faint" style="font-size:11.5px">Centang usulan yang mau dipakai</span>';
  }
  function apply(kind, i) {
    if (!Store.canWrite) return toast("Kamu hanya bisa melihat papan ini");
    const idx = $$(`[data-s^="${i}:"]`).filter((x) => x.checked).map((x) => +x.dataset.s.split(":")[1]);
    const items = idx.map((j) => msgs[i].usulan[j]);
    if (!items.length) return;
    if (kind === "papan") {
      const cols = Math.min(4, items.length);
      const color = { sticky: "violet", tugas: "green", konten: "orange", campaign: "blue" };
      const objs = items.map((u, k) => ({ id: "L" + k, type: "sticky", x: (k % cols) * 220, y: Math.floor(k / cols) * 220, w: 200, h: 200, text: u.teks, color: color[u.jenis], ai: true }));
      const s = Canvas.selObjs(); const at = s.length ? (() => { const b = Canvas.bboxOf(s); return { x: b.x + b.w + 500, y: b.y + b.h / 2 }; })() : Canvas.centerWorld();
      const out = Canvas.insertObjects(objs, at);
      setTimeout(() => Canvas.fit(out.map((o) => o.id)), 60);
      idx.forEach((j) => (msgs[i].usulan[j].done = "di papan"));
    }
    if (kind === "tugas") {
      for (const j of idx) { const u = msgs[i].usulan[j]; Store.labSave("tasks", { id: uid("t"), title: u.teks, owner: u.pic, due: u.tanggal, done: false, priority: "sedang", source: { boardId: Store.S.boardId, objectIds: [] } }); u.done = "jadi tugas"; }
      toast(`${idx.length} tugas dibuat di Brandlab${EX()}`, { action: "Tampilkan", onAction: () => Actions.addWidget("tasks") });
    }
    if (kind === "konten") {
      for (const j of idx) { const u = msgs[i].usulan[j]; Store.labSave("content", { id: uid("k"), title: u.teks, platform: Rules.channels(u.platform + " " + u.teks)[0] || "Instagram", date: u.tanggal, pic: u.pic, status: "ide", source: { boardId: Store.S.boardId, objectIds: [] } }); u.done = "di Rencana konten"; }
      toast(`${idx.length} ide masuk Rencana konten${EX()}`, { action: "Tampilkan", onAction: () => Actions.addWidget("content") });
    }
    if (kind === "campaign") {
      const u = items.find((x) => x.jenis === "campaign");
      const tmp = Store.newObject({ type: "sticky", x: Canvas.centerWorld().x, y: Canvas.centerWorld().y, w: 200, h: 200, text: u.teks + (u.detail ? "\n" + u.detail : ""), color: "blue", ai: true });
      Canvas.add([tmp], { select: true });
      u.done = "draft campaign dibuka";
      save(); return Panels.campaign({ name: u.teks.slice(0, 60), strategy: u.detail ? `${u.teks}\n${u.detail}` : u.teks });
    }
    save(); render();
  }
  function render(scrollEnd) {
    const box = $("#asMsgs"); if (!box) return;
    const sel = Canvas.sel.size;
    box.innerHTML = (msgs.length ? msgs.map(msgHTML).join("") : `<div class="as-empty"><span class="aiav big">${ic("sparkle")}</span><b>Ngobrol soal isi papan ini</b><p>Aku membaca semua catatan, vote, keputusan, dan Brand DNA ${esc(Store.lab().brand.name)}. Usulanku tidak masuk papan sebelum kamu centang.</p></div>`)
      + (busy ? `<div class="cb ai"><span class="aiav">${ic("sparkle")}</span><div class="bub"><span class="typing"><i></i><i></i><i></i></span></div></div>` : "");
    $$(".sug-act", box).forEach((b) => actions(+b.dataset.actFor));
    $("#asScope").innerHTML = `<button data-sc="board" class="${scope === "board" || !sel ? "on" : ""}">Seluruh papan</button><button data-sc="sel" class="${scope === "sel" && sel ? "on" : ""}" ${sel ? "" : "disabled"}>Yang dipilih${sel ? ` (${sel})` : ""}</button>`;
    $("#asUsed").textContent = used() ? `${used()} jawaban di obrolan ini = ${used()} kredit Brandlab` : "Tiap jawaban = 1 kredit AI Brandlab";
    $("#asSend").disabled = busy || !AI.available;
    if (scrollEnd) box.scrollTop = box.scrollHeight;
  }
  const CHIPS = () => {
    const c = ["Ringkas papan ini dalam 5 poin", "Kasih 5 ide lanjutan dari ide terpilih", "Ide mana yang paling sesuai Brand DNA, dan kenapa?", "Susun langkah minggu ini dari keputusan rapat", "Tulis 3 caption IG untuk ide terpilih"];
    if (Canvas.sel.size) c.unshift("Kembangkan catatan yang aku pilih");
    return c;
  };
  function open(seed) {
    if (window.__papanChat) return window.__papanChat(); // Brandlab: its own Tanya Brandlab, with this board
    load();
    if (Canvas.sel.size) scope = "sel";
    Panels.open("assistant", null, { title: "Tanya Brandlab", icon: "sparkle",
      body: `<div class="as-wrap">${AI.available ? "" : `<div class="note violet" style="margin-bottom:10px">${ic("info")}<span>${window.__papanWeb ? "AI belum tersambung. Muat ulang halaman, atau login lagi." : "AI belum aktif di tampilan ini. Buka link di claude.ai lalu izinkan AI saat diminta."} Alat gratis di bawah tetap jalan.</span></div>`}
        <div class="note" style="margin-bottom:10px">${ic("info")}<span>${GUEST() ? "Dijawab AI Brandlab dengan kredit pemilik papan. Untukmu maksimal 10 jawaban per hari." : window.__papanWeb ? "Dijawab AI Brandlab (DeepSeek) dengan persona Tanya Brandlab. Beta: maksimal 40 jawaban per hari per akun." : "Prototipe: jawaban dibuat Claude dengan persona, aturan, dan data brand yang sama. Di Brandlab: AI Brandlab, memakai kredit pemilik."}</span></div>
        <div id="asMsgs" class="as-msgs" aria-live="polite"></div></div>`,
      foot: `<div class="as-foot"><div class="as-chips" id="asChips">${CHIPS().map((c) => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>
        <div class="seg" id="asScope"></div>
        <div class="as-comp"><textarea class="field" id="asText" rows="2" placeholder="Tanya atau minta bantuan… (Enter kirim, Shift+Enter baris baru)"></textarea><button class="btn btn-ai" id="asSend" aria-label="Kirim">${ic("send")}</button></div>
        <div class="as-meta"><span id="asUsed"></span><span class="as-tools">Gratis: <button data-tool2="organize">Rapikan</button> · <button data-tool2="recap">Ringkas</button> · <button data-tool2="check">Cek brand</button> · <button data-tool2="deck">Slide</button>${msgs.length ? ' · <button data-tool2="clear">Obrolan baru</button>' : ""}</span></div></div>`,
      wire(s) {
        s.parentElement.classList.add("wide");
        const ta = $("#asText");
        const go = () => { const v = ta.value; ta.value = ""; send(v); };
        $("#asSend").onclick = go;
        ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
        ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; });
        s.addEventListener("click", (e) => {
          const ch = e.target.closest("[data-chip]"); if (ch) return send(ch.dataset.chip);
          const sc = e.target.closest("[data-sc]"); if (sc && !sc.disabled) { scope = sc.dataset.sc; return render(); }
          const all = e.target.closest("[data-sall]"); if (all) { const i = all.dataset.sall; const bx = $$(`[data-s^="${i}:"]:not(:disabled)`); const on = bx.every((x) => x.checked); bx.forEach((x) => (x.checked = !on)); return actions(+i); }
          const d = e.target.closest("[data-do]"); if (d) { const [k, i] = d.dataset.do.split(":"); return apply(k, +i); }
          const t = e.target.closest("[data-tool2]"); if (t) { const k = t.dataset.tool2; if (k === "clear") { msgs = []; save(); return open(); } return { organize: () => Panels.organize(), recap: () => Panels.recap(), check: () => Panels.consistency(), deck: () => Deck.open() }[k](); }
        });
        s.addEventListener("change", (e) => { const c = e.target.closest("[data-s]"); if (c) actions(+c.dataset.s.split(":")[0]); });
        render(true);
        if (seed) send(seed); else setTimeout(() => ta.focus(), 250);
      } });
  }
  Canvas.on((k) => { if (k === "selection" && Panels.current?.kind === "assistant") render(); });
  Store.on((k) => { if (k === "ai" && Panels.current?.kind === "assistant") render(); });
  // Brandlab's chat reads the board and can put its ideas on it.
  function place(items) {
    if (!Store.canWrite || !items?.length) return 0;
    const cols = Math.min(4, items.length);
    const objs = items.slice(0, 12).map((u, k) => ({ id: "L" + k, type: "sticky", x: (k % cols) * 220, y: Math.floor(k / cols) * 220, w: 200, h: 200, text: String(u.text || "").slice(0, 280), color: "violet", ai: true }));
    const s = Canvas.selObjs(); const near = s.length ? (() => { const b = Canvas.bboxOf(s); return { x: b.x + b.w + 300, y: b.y + b.h / 2 }; })() : Canvas.centerWorld();
    const rows = Math.ceil(objs.length / cols);
    const out = Canvas.insertObjects(objs, Canvas.freeSpot(cols * 220 - 20, rows * 220 - 20, near));
    setTimeout(() => {
      // Show them without zooming in; in Brandlab the chat panel covers the
      // right side of the board, so they land left of the middle.
      const t = Canvas.camFor(Canvas.bboxOf(out), 70, 1);
      if (window.__papanHost === "brandlab" && window.innerWidth > 900) t.x -= Math.min(230, window.innerWidth * 0.16);
      Canvas.animateTo(t);
    }, 60);
    return out.length;
  }
  window.__papanSummary = () => `Papan "${(Store.board()?.name || "").replace(/^Contoh · /, "")}"\n${boardContext(false, true)}`;
  window.__papanPlace = place;
  return { open, send, place };
})();

/* ---- 12-ai.js ---- */
// AI only runs when someone presses a button marked "1 kredit". Everything marked "gratis" is plain rules below.
// Prototype: answers come from Claude via the viewer's own account. In Brandlab: api/ai.js (DeepSeek) on the owner's credits.
const AI = (() => {
  let sample = null;
  function brandContext() {
    if (window.__papanBrandContext) return window.__papanBrandContext();
    const L = Store.lab(), d = L.dna, b = L.book;
    return `BRAND: ${L.brand.name} (${L.brand.tagline})
Positioning: ${d.positioning}
Audiens: ${d.audiens}
Kepribadian: ${d.kepribadian.join(", ")}
Nilai: ${d.nilai.join(", ")}
Value proposition: ${d.vp}
Gaya bicara, lakukan: ${b.tone.do.join("; ")}
Gaya bicara, hindari: ${b.tone.dont.join("; ")}
Kata yang dihindari: ${b.avoid.join(", ")}`;
  }
  async function ask(prompt, tier = "default") {
    if (!sample) { toast("AI belum aktif di tampilan ini"); return null; }
    try { return await sample.json(prompt, { modelTier: tier }); }
    catch (e) {
      const c = e && e.code;
      if (e && e.shown) return null; // the host already said what went wrong
      if (c === "not_granted") { sample = null; Store.emit("ai"); toast("Izin AI tidak diberikan. Versi gratis tetap bisa dipakai."); }
      else if (c === "rate_limited") toast("AI sedang sibuk. Coba lagi sebentar.");
      else if (c === "invalid_json") toast("Jawaban AI tidak terbaca. Coba sekali lagi.");
      else toast("AI gagal menjawab. Coba lagi.");
      return null;
    }
  }
  const RULE = "Tulis dalam Bahasa Indonesia santai (pakai 'kamu'), sesuai gaya bicara brand. Jangan mengarang angka, nama orang, tanggal, atau keputusan yang tidak ada di data.";
  return {
    init(s) { sample = s; },
    ask,
    get available() { return !!sample; },
    brandContext,
    async ideas(topic, dir, n) {
      const r = await ask(`${brandContext()}\n\nTugas: beri ${n} ide untuk topik "${topic}". Arah: ${dir}. ${RULE} Ide harus konkret dan bisa dikerjakan kedai kecil. Jangan pakai diskon besar atau janji paling murah.\nBalas HANYA JSON array: [{"ide": "maks 14 kata", "alasan": "1 kalimat kenapa cocok dengan brand"}]`);
      return Array.isArray(r) ? r.filter((x) => x && x.ide).slice(0, n).map((x) => ({ ide: String(x.ide), alasan: String(x.alasan || "") })) : r == null ? null : (toast("Format jawaban AI tidak sesuai"), null);
    },
    async rewrite(text, instr) {
      const r = await ask(`${brandContext()}\n\nTeks asli: "${text}"\nTugas: ${instr}. ${RULE}\nBalas HANYA JSON array berisi 1–3 string pilihan.`, "quick");
      return Array.isArray(r) ? r.map(String).filter(Boolean).slice(0, 3) : null;
    },
    async themes(notes) {
      const list = notes.map((o, i) => `${i}. ${o.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
      const r = await ask(`Kelompokkan catatan brainstorming berikut menjadi 2–6 tema. Setiap catatan masuk tepat satu tema. Nama tema maksimal 4 kata, Bahasa Indonesia.\n\n${list}\n\nBalas HANYA JSON: [{"tema": "…", "nomor": [0, 3]}]`, "quick");
      if (!Array.isArray(r)) return null;
      const used = new Set();
      const groups = r.map((g) => ({ name: String(g.tema || "Tema"), ids: (g.nomor || []).map(Number).filter((i) => notes[i] && !used.has(i) && used.add(i)).map((i) => notes[i].id) })).filter((g) => g.ids.length);
      const rest = notes.map((o, i) => i).filter((i) => !used.has(i)).map((i) => notes[i].id);
      if (rest.length) groups.push({ name: "Lainnya", ids: rest });
      return groups;
    },
    async recap(r) {
      const res = await ask(`Rapikan bahasa ringkasan rapat ini supaya enak dibaca. ATURAN KERAS: jangan menambah keputusan, ide terpilih, PIC, atau tenggat baru. Jumlah item "keputusan" dan "aksi" harus sama dengan aslinya. Boleh memperjelas kalimat dan menulis ulang "ringkasan" (maks 3 kalimat).\n\n${JSON.stringify(r)}\n\nBalas HANYA JSON dengan kunci yang sama.`);
      if (!res || typeof res !== "object") return null;
      const out = clone(r);
      if (typeof res.ringkasan === "string") out.ringkasan = res.ringkasan;
      for (const k of ["topik", "ide", "pertanyaan", "langkah"]) if (Array.isArray(res[k])) out[k] = res[k].map(String).slice(0, Math.max(r[k].length, 1) + 2);
      // decisions, voted ideas, owners, deadlines: wording only, never new items or new names/dates
      for (const k of ["keputusan", "terpilih"]) if (Array.isArray(res[k])) out[k] = r[k].map((x, i) => String(res[k][i] || x));
      if (Array.isArray(res.aksi)) out.aksi = r.aksi.map((x, i) => ({ ...x, tugas: String(res.aksi[i]?.tugas || x.tugas) }));
      return out;
    },
    async brandCheck(notes) {
      const list = notes.map((o, i) => `${i}. ${o.text.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
      const r = await ask(`${brandContext()}\n\nCek tiap catatan apakah cocok dengan brand di atas. Jelaskan singkat kenapa. Kalau tidak cocok, beri saran tulisan pengganti (opsional). ${RULE}\n\n${list}\n\nBalas HANYA JSON: [{"nomor": 0, "cocok": true, "alasan": "…", "saran": "…atau kosong"}]`);
      if (!Array.isArray(r)) return null;
      return notes.map((o, i) => { const x = r.find((y) => Number(y.nomor) === i) || {}; return { o, ok: !!x.cocok, reasons: [String(x.alasan || "Tidak ada catatan dari AI")], sug: x.cocok ? null : x.saran ? String(x.saran) : null }; });
    },
    async campaign(notes) {
      const r = await ask(`${brandContext()}\n\nSusun draft campaign dari catatan rapat berikut:\n${notes.map((o) => "- " + o.text).join("\n")}\n\n${RULE} Tujuan sebaiknya terukur tapi JANGAN mengarang angka yang tidak ada di catatan; kalau tidak ada angka, tulis tujuan tanpa angka dan beri tanda [isi target].\nBalas HANYA JSON: {"name": "", "objective": "", "audience": "", "strategy": "", "channels": ["Instagram"]}`);
      if (!r || typeof r !== "object") return null;
      return { name: String(r.name || ""), objective: String(r.objective || ""), audience: String(r.audience || ""), strategy: String(r.strategy || ""), channels: Array.isArray(r.channels) ? r.channels.map(String) : [] };
    },
    async polishDeck(slides) {
      const slim = slides.map((s, i) => ({ i, title: s.title, subtitle: s.subtitle, bullets: s.bullets, items: (s.items || []).map((x) => x.title), body: s.body }));
      const r = await ask(`Rapikan teks slide presentasi berikut: judul lebih tajam (maks 7 kata), poin lebih singkat (maks 12 kata). Jangan menambah fakta, angka, nama, atau tanggal baru. Jumlah poin dan item tetap sama.\n${JSON.stringify(slim)}\nBalas HANYA JSON array dengan bentuk yang sama.`);
      if (!Array.isArray(r)) return null;
      return slides.map((s, i) => {
        const x = r.find((y) => Number(y.i) === i); if (!x) return s;
        const n = clone(s);
        if (x.title) n.title = String(x.title);
        if (x.subtitle && s.subtitle) n.subtitle = String(x.subtitle);
        if (Array.isArray(x.bullets) && s.bullets) n.bullets = s.bullets.map((b, j) => String(x.bullets[j] || b));
        if (Array.isArray(x.items) && s.items) n.items = s.items.map((it, j) => ({ ...it, title: String(x.items[j] || it.title) }));
        if (x.body && s.body) n.body = String(x.body);
        return n;
      });
    },
  };
})();

const Rules = (() => {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function cluster(notes) {
    const tk = new Map(notes.map((o) => [o.id, new Set(tokens(o.text))]));
    const left = new Set(notes.map((o) => o.id));
    const groups = [];
    while (left.size && groups.length < 5) {
      const count = new Map();
      for (const id of left) for (const w of tk.get(id)) count.set(w, (count.get(w) || 0) + 1);
      const best = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
      if (!best) break;
      const ids = [...left].filter((id) => tk.get(id).has(best[0]));
      // second keyword shared by most of the group, for a clearer name
      const c2 = new Map(); for (const id of ids) for (const w of tk.get(id)) if (w !== best[0]) c2.set(w, (c2.get(w) || 0) + 1);
      const sec = [...c2.entries()].filter(([, n]) => n >= Math.max(2, ids.length / 2)).sort((a, b) => b[1] - a[1])[0];
      groups.push({ name: cap(best[0]) + (sec ? " & " + sec[0] : ""), ids });
      ids.forEach((id) => left.delete(id));
    }
    if (left.size) {
      if (!groups.length) { // nothing shared: fall back to the colours people used
        const byColor = new Map(); for (const id of left) { const c = Store.obj(id)?.color || "lain"; if (!byColor.has(c)) byColor.set(c, []); byColor.get(c).push(id); }
        const NAMES = { yellow: "Kuning", orange: "Oranye", pink: "Merah muda", violet: "Ungu", blue: "Biru", green: "Hijau", gray: "Abu", white: "Putih" };
        for (const [c, ids] of byColor) groups.push({ name: "Catatan " + (NAMES[c] || "lain"), ids });
      } else groups.push({ name: "Lainnya", ids: [...left] });
    }
    return groups;
  }
  function duplicates(notes) {
    const out = [];
    const tk = notes.map((o) => tokens(o.text));
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
      const same = notes[i].text.trim().toLowerCase() === notes[j].text.trim().toLowerCase();
      if (same || (tk[i].length >= 2 && tk[j].length >= 2 && jaccard(tk[i], tk[j]) >= 0.5)) out.push([notes[i].id, notes[j].id]);
    }
    return out;
  }
  function prompts(topic, dir, n) {
    const L = Store.lab(), d = L.dna || {}, t = topic || "ide ini", aud = (d.audiens || "pelangganmu").split(/[,.]/)[0].replace(/^Pekerja muda & mahasiswa/, "pekerja muda & mahasiswa");
    const kp = (d.kepribadian || [])[0] || "hangat", nl = (d.nilai || [])[0] || "nilai brand-mu";
    const all = [
      `Bagaimana ${t} bisa terasa ${kp.toLowerCase()} buat ${aud}?`,
      `Apa yang bikin orang cerita ke temannya soal ${t}?`,
      `Kalau tanpa diskon sama sekali, apa nilai ${t} yang bikin orang datang?`,
      `Momen kecil apa di ${L.brand.name} yang bisa jadi konten tentang ${t}?`,
      `Bagaimana kalau ${t} dibuat bareng pelanggan?`,
      `Apa kebalikan dari yang dilakukan kompetitor untuk ${t}?`,
      `Bagaimana "${nl}" bisa jadi cerita di ${t}?`,
      `Satu hal kecil yang bisa dicoba minggu ini untuk ${t}?`,
      `Apa yang dilihat, didengar, dan dicium pelanggan saat ${t}?`,
      `Siapa partner lokal yang cocok diajak untuk ${t}?`,
      `Bagaimana membuat ${t} jadi kebiasaan, bukan sekali lewat?`,
      `Cerita di balik layar apa yang belum pernah kita ceritakan soal ${t}?`,
    ];
    if (dir === "Nama & tagline") all.unshift(`Tiga kata yang paling menggambarkan ${t}?`, `Kalau ${t} jadi orang, dia orang seperti apa?`);
    if (dir === "Konten") all.unshift(`Format apa yang paling cocok untuk ${t}: video pendek, carousel, atau story?`);
    return all.slice(0, n);
  }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
  function parseDate(s) {
    s = String(s || "").toLowerCase();
    const now = new Date(); let d = null;
    let m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(s);
    if (m) d = new Date(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), +m[2] - 1, +m[1]);
    if (!d) { m = /\b(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|ags|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?(?:\s+(\d{4}))?/.exec(s); if (m) d = new Date(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[2]] - 1, +m[1]); }
    if (!d && /\bbesok\b/.test(s)) d = new Date(now.getTime() + 86400000);
    if (!d || isNaN(d)) return "";
    if (!m || !m[3]) if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)) d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseTask(text) {
    const people = Store.lab().people;
    let owner = "";
    const who = mentionWho(text);
    if (who) owner = people.find((p) => p.toLowerCase() === who.toLowerCase() || who.toLowerCase().startsWith(p.toLowerCase())) || who;
    const due = parseDate(text);
    const priority = /penting|urgent|segera|asap|!!/i.test(text) ? "tinggi" : "sedang";
    let title = text.replace(/@[\p{L}][\p{L}\s.]{0,24}?(?=$|[,;.!?]| \d|\s{2})/u, "").replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/, "").replace(/^(keputusan|tugas|todo)\s*:\s*/i, "").replace(/\s{2,}/g, " ").trim();
    return { title: title.slice(0, 140), owner, due, priority };
  }
  function channels(text) {
    const s = String(text || "").toLowerCase(), out = [];
    if (/\big\b|instagram|reels?|carousel|story|feed/.test(s)) out.push("Instagram");
    if (/tiktok/.test(s)) out.push("TikTok");
    if (/youtube|\byt\b|shorts/.test(s)) out.push("YouTube");
    if (/\bwa\b|whatsapp/.test(s)) out.push("WhatsApp");
    if (/offline|di toko|lapak|halaman|event|akustik|session|kampus/.test(s)) out.push("Offline");
    return out;
  }
  function brandCheck(text) {
    const L = Store.lab(), reasons = [];
    const low = String(text || "").toLowerCase();
    const hit = (L.book?.avoid || []).filter((w) => w && low.includes(w));
    if (hit.length) reasons.push(`Ada kata yang dihindari di Brand Book: “${hit.join("”, “")}”.`);
    const letters = (text.match(/\p{L}/gu) || []).length, caps = (text.match(/\p{Lu}/gu) || []).length;
    const shouty = letters > 8 && caps / letters > 0.6;
    if (shouty) reasons.push(`Hampir semua huruf kapital, terasa berteriak.${(L.dna?.kepribadian || []).length ? ` Kepribadian brand: ${L.dna.kepribadian.slice(0, 2).join(", ").toLowerCase()}.` : ""}`);
    const excl = (text.match(/!/g) || []).length >= 2;
    if (excl) reasons.push("Banyak tanda seru, kurang cocok dengan gaya ngobrol seperti teman.");
    const disc = /(diskon|potongan|off|sale)\s*\d{2,}\s*%|\d{2,}\s*%\s*(off|diskon)/i.test(text);
    if (disc) reasons.push(BL() ? "Diskon besar: pastikan sesuai positioning dan nilai di Brand DNA, bukan sekadar perang harga." : `Diskon besar bertentangan dengan nilai “${L.dna.nilai[1]}” dan positioning yang menjual suasana, bukan harga.`);
    let sug = null;
    if ((shouty || excl) && !hit.length && !disc) { const t = text.replace(/!+/g, ".").replace(/\.{2,}/g, ".").toLowerCase(); sug = t.charAt(0).toUpperCase() + t.slice(1); }
    return { ok: !reasons.length, reasons: reasons.length ? reasons : ["Tidak ada kata yang dihindari dan nadanya santai."], sug };
  }
  function campaignDraft(notes) {
    const L = Store.lab();
    const f = Store.objects().find((x) => x.type === "frame" && notes.every((o) => { const c = Canvas.center(o); return c.x > x.x && c.x < x.x + x.w && c.y > x.y && c.y < x.y + x.h; }));
    const objective = notes.find((o) => /naik|tambah|target|tujuan|\d+\s*%|transaksi|penjualan/i.test(o.text));
    const ch = [...new Set(notes.flatMap((o) => channels(o.text)))];
    return {
      name: (f ? f.text.replace(/^\d+\s*[·.)-]\s*/, "") : notes[0].text).slice(0, 48),
      objective: objective ? objective.text : "",
      audience: L.dna?.audiens || "",
      strategy: notes.map((o) => "• " + o.text.replace(/\s+/g, " ")).join("\n"),
      channels: ch.length ? ch : ["Instagram"],
      start: "", end: "",
    };
  }
  function inside(o, f) { const c = Canvas.center(o); return c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h; }
  function recap() {
    const objs = Store.objects().filter(Canvas.visible), b = Store.board() || {};
    const frames = objs.filter((o) => o.type === "frame").sort((a, c) => a.y - c.y || a.x - c.x);
    const notes = objs.filter((o) => ["sticky", "text", "shape"].includes(o.type) && (o.text || "").trim() && !(o.type === "text" && o.heading));
    const stickies = objs.filter((o) => o.type === "sticky" && (o.text || "").trim());
    const score = (o) => Board.votesFor(o).count * 3 + Object.values(o.reactions || {}).reduce((n, w) => n + Object.values(w || {}).filter(Boolean).length, 0) + (Store.comments().filter((c) => c.objectId === o.id).length);
    const voted = stickies.filter((o) => Board.votesFor(o).count > 0).sort((a, c) => Board.votesFor(c).count - Board.votesFor(a).count);
    const picked = [...new Set([...stickies.filter((o) => o.tag === "terpilih"), ...voted.slice(0, 3)])];
    const ide = stickies.filter((o) => !o.tag || o.tag === "terpilih").sort((a, c) => score(c) - score(a)).slice(0, 6);
    const keputusan = notes.filter((o) => o.tag === "keputusan").map((o) => o.text.replace(/^keputusan\s*:\s*/i, "").trim());
    const pertanyaan = [...notes.filter((o) => o.tag === "pertanyaan"), ...stickies.filter((o) => !o.tag && /\?\s*$/.test(o.text))].map((o) => o.text.trim());
    const openComments = Store.comments().filter((c) => !c.resolved && !c.parent && /\?\s*$/.test(c.text));
    for (const c of openComments) pertanyaan.push(`${c.text} (komentar)`);
    const aksi = [];
    for (const cl of objs.filter((o) => o.type === "checklist")) for (const it of cl.data?.items || []) if (it.t && !it.done) { const p = parseTask(it.t); aksi.push({ tugas: p.title, pic: p.owner, deadline: p.due ? fmtDay(p.due) : "", ids: [cl.id] }); }
    const L = Store.lab();
    for (const t of L.tasks.filter((t) => t.source?.boardId === Store.S.boardId && !t.done)) if (!aksi.some((a) => a.tugas === t.title)) aksi.push({ tugas: t.title, pic: t.owner || "", deadline: t.due ? fmtDay(t.due) : "", ids: t.source.objectIds || [] });
    const totalVotes = stickies.reduce((n, o) => n + Board.votesFor(o).count, 0);
    const name = (b.name || "Rapat").replace(/^Contoh · /, "");
    const ringkasan = `Rapat “${name}” membahas ${frames.length ? frames.length + " bagian (" + frames.map((f) => f.text.replace(/^\d+\s*·\s*/, "")).join(", ") + ")" : "isi papan"}. Tercatat ${stickies.length} ide${totalVotes ? `, ${totalVotes} vote` : ""}, ${keputusan.length} keputusan, dan ${aksi.length} tugas yang belum selesai.`;
    return {
      ringkasan,
      topik: frames.map((f) => f.text.replace(/^\d+\s*·\s*/, "")),
      ide: ide.map((o) => o.text),
      keputusan,
      terpilih: picked.map((o) => `${o.text}${Board.votesFor(o).count ? ` (${Board.votesFor(o).count} vote)` : ""}`),
      pertanyaan: [...new Set(pertanyaan)],
      aksi,
      langkah: aksi.length ? [`Bagi ${aksi.length} tugas ke PIC dan pasang tenggat`, keputusan.length ? "Kabari tim yang tidak ikut rapat soal keputusan di atas" : "Tentukan keputusan yang masih terbuka", "Jadwalkan cek progres minggu depan"] : ["Tentukan tugas dari ide yang terpilih"],
    };
  }
  return { cluster, duplicates, prompts, parseDate, parseTask, channels, brandCheck, campaignDraft, recap, inside };
})();

/* ---- 13-deck.js ---- */
// Board → Deck: structured slides built from frames (rules, free), optional AI polish, present, PPTX/PDF export.
const Deck = (() => {
  let slides = [], idx = 0, theme = "brand", root = null, saveSoon = null;
  // Hex helpers for a theme built from any brand's colours.
  const hx = (h) => { const m = /^#?([\da-f]{6})$/i.exec(h || ""); return m ? parseInt(m[1], 16) : null; };
  const mix = (a, b, w) => { const x = hx(a), y = hx(b); if (x == null || y == null) return a; const ch = (n, s) => (n >> s) & 255; const m2 = (s) => Math.round(ch(x, s) * (1 - w) + ch(y, s) * w); return "#" + [16, 8, 0].map((s) => m2(s).toString(16).padStart(2, "0")).join(""); };
  const lum = (h) => { const n = hx(h); return n == null ? 0 : (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000; };
  const loadedFonts = new Set();
  function ensureFont(name) {
    if (!name || loadedFonts.has(name) || /^(Grift Black|JUST Sans)$/.test(name)) return;
    loadedFonts.add(name);
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;700&display=swap`;
    document.head.appendChild(l);
  }
  const THEMES = {
    brand: () => {
      const L = Store.lab(), book = L.book || {}, cs = book.colors || [];
      if (!window.__papanHost) { const c = LAB_BASE.book.colors; return { name: "Brand Book Kopi Tepian", bg: c[2].hex, fg: c[0].hex, dark: c[0].hex, light: c[2].hex, acc: c[4].hex, acc2: c[3].hex, card: "#EAD8BF", disp: LAB_BASE.book.fonts.display, body: LAB_BASE.book.fonts.body, logo: null }; }
      const by = (r) => cs.find((c) => c.role === r)?.hex;
      const prim = by("Utama") || cs[0]?.hex, sec = by("Kedua") || cs[1]?.hex, acc = by("Aksen") || sec || prim;
      if (!prim) return { ...THEMES.lab(), name: "Brandlab (Brand Book belum ada warna)" };
      let bg = by("Latar") || "#F7F4EE", fg = by("Teks") || (lum(bg) > 140 ? "#1f1a14" : "#f6f4f1");
      if (Math.abs(lum(bg) - lum(fg)) < 90) fg = lum(bg) > 140 ? "#1f1a14" : "#f6f4f1";
      const dark = lum(prim) < 140 ? prim : mix(prim, "#000000", 0.55);
      const disp = book.fonts?.display || "DM Serif Display", body = book.fonts?.body || "Plus Jakarta Sans";
      ensureFont(disp); ensureFont(body);
      return { name: `Brand Book ${L.brand?.name || ""}`.trim(), bg, fg, dark, light: lum(bg) > 140 ? bg : "#f6f4f1", acc: acc || "#ffa52b", acc2: sec || acc || "#ffc94a", card: mix(bg, fg, 0.08), disp, body, logo: book.logo || null, brandName: L.brand?.name || "" };
    },
    lab: () => ({ name: "Brandlab gelap", bg: "#131211", fg: "#f6f4f1", dark: "#0c0b0a", light: "#f6f4f1", acc: "#ffa52b", acc2: "#ffc94a", card: "#1f1d1a", disp: "Grift Black", body: "JUST Sans" }),
  };
  const T = () => THEMES[theme]();
  const LAYOUTS = { cover: "Sampul", agenda: "Agenda", summary: "Ringkasan", statement: "Pernyataan", bullets: "Poin", ideas: "Kartu ide", two: "Dua kolom", mood: "Moodboard", stats: "Angka & grafik", timeline: "Linimasa", table: "Tabel", campaign: "Campaign", identity: "Identitas brand", closing: "Penutup" };

  // ---------- build from the board ----------
  function frameContents(f) { return Store.objects().filter((o) => o.type !== "frame" && o.type !== "connector" && Rules.inside(o, f)); }
  function build(opts) {
    const L = Store.lab(), b = Store.board() || {};
    const name = (b.name || "Papan").replace(/^Contoh · /, "");
    const frames = Store.objects().filter((o) => o.type === "frame" && opts.frames.includes(o.id)).sort((a, c) => Math.round(a.y / 300) - Math.round(c.y / 300) || a.x - c.x);
    const out = [];
    out.push({ layout: "cover", kicker: "Hasil rapat tim", title: name, subtitle: `${L.brand.name} · ${fmtDate(Date.now(), false)}` });
    if (frames.length > 2) out.push({ layout: "agenda", title: "Yang kita bahas", bullets: frames.map((f) => f.text.replace(/^\d+\s*·\s*/, "")) });
    if (opts.recap) { const r = Rules.recap(); out.push({ layout: "summary", title: "Ringkasan", body: r.ringkasan, bullets: r.keputusan.length ? r.keputusan : r.topik.slice(0, 4), side: r.keputusan.length ? "Keputusan" : "Topik" }); }
    for (const f of frames) out.push(...slidesForFrame(f));
    if (opts.voted) {
      const top = Store.objects().filter((o) => o.type === "sticky" && (Board.votesFor(o).count || o.tag === "terpilih")).sort((a, c) => Board.votesFor(c).count - Board.votesFor(a).count).slice(0, 4);
      if (top.length) out.push({ layout: "ideas", title: "Ide terpilih", items: top.map((o) => ({ title: o.text, votes: Board.votesFor(o).count, color: o.color })) });
    }
    if (opts.identity) out.push({ layout: "identity", title: "Tetap sesuai brand", subtitle: L.dna.positioning, colors: L.book.colors.map((c) => ({ name: c.name, hex: c.hex })), fonts: L.book.fonts });
    if (opts.actions) {
      const r = Rules.recap();
      if (r.aksi.length) out.push({ layout: "timeline", title: "Rencana aksi", rows: r.aksi.slice(0, 6).map((a) => ({ label: a.tugas, date: a.deadline || "–", owner: a.pic || "Belum ada PIC" })) });
      out.push({ layout: "bullets", title: "Langkah berikutnya", bullets: r.langkah });
    }
    out.push({ layout: "closing", title: "Terima kasih", subtitle: L.brand.tagline });
    return out.map((s) => ({ id: uid("s"), ...s }));
  }
  function slidesForFrame(f) {
    const title = f.text.replace(/^\d+\s*·\s*/, "");
    const items = frameContents(f);
    const stickies = items.filter((o) => (o.type === "sticky" || o.type === "shape") && (o.text || "").trim()).sort((a, c) => Board.votesFor(c).count - Board.votesFor(a).count || a.y - c.y || a.x - c.x);
    const media = items.filter((o) => o.type === "image" || o.type === "embed");
    const tables = items.filter((o) => o.type === "table");
    const checks = items.filter((o) => o.type === "checklist");
    const widgets = items.filter((o) => o.type === "widget");
    const texts = items.filter((o) => o.type === "text" && (o.text || "").trim()).sort((a, c) => (c.fs || 18) - (a.fs || 18));
    const out = [];
    if (media.length >= 2 || (media.length && stickies.length < 2)) {
      const sw = items.filter((o) => o.type === "shape" && o.data?.solid).map((o) => ({ kind: "swatch", hex: o.color, label: o.text }));
      out.push({ layout: "mood", title, tiles: [...media.map((o) => o.type === "image" ? { kind: "img", src: o.data.src } : { kind: "link", title: o.data.title, sub: o.data.kind === "link" ? o.data.domain : o.data.kind === "youtube" ? "Video YouTube" : o.data.kind === "tiktok" ? "Video TikTok" : "Instagram", url: o.data.url }), ...sw].slice(0, 6), note: texts[0]?.text || "" });
    } else if (stickies.length) {
      for (let i = 0; i < stickies.length; i += 6) out.push({ layout: "ideas", title: i ? `${title} (lanjutan)` : title, items: stickies.slice(i, i + 6).map((o) => ({ title: o.text, votes: Board.votesFor(o).count, tag: o.tag === "keputusan" ? "Keputusan" : o.tag === "pertanyaan" ? "Pertanyaan" : o.tag === "terpilih" ? "Terpilih" : "", color: o.color })) });
    }
    for (const t of tables) out.push({ layout: "table", title: t.text || title, rows: (t.data.rows || []).slice(0, 8).map((r) => r.slice(0, 5)) });
    for (const c of checks) out.push({ layout: "bullets", title: c.text || title, bullets: (c.data.items || []).filter((i) => i.t).map((i) => (i.done ? "✓ " : "") + i.t) });
    for (const w of widgets) { const s = widgetSlide(w, title); if (s) out.push(s); }
    if (!out.length && texts.length) out.push({ layout: "statement", title, big: texts[0].text, body: texts.slice(1).map((t) => t.text).join(" ") });
    if (!out.length) out.push({ layout: "statement", title, big: title, body: "" });
    return out;
  }
  function widgetSlide(w, frameTitle) {
    const L = Store.lab(), k = w.data.kind, src = w.data.mode === "snapshot" && w.data.snap ? w.data.snap : WIDGETS[k].live ? WIDGETS[k].live(w, L) : null;
    if (k === "campaign" && src) return { layout: "campaign", title: src.name, kv: [["Tujuan", src.objective], ["Audiens", src.audience], ["Strategi", src.strategy], ["Channel", (src.channels || []).join(", ")], ["Waktu", `${fmtDay(src.start)} – ${fmtDay(src.end)}`]], stats: src.metrics ? [{ v: num(src.metrics.reach), l: "Jangkauan" }, { v: pct(src.metrics.er), l: "ER" }, { v: num(src.metrics.leads), l: "Transaksi" }] : [] };
    if (k === "growth" && src) return { layout: "stats", title: "Pertumbuhan Instagram", stats: [{ v: num(src.followers.at(-1)), l: "Followers" }, { v: "+" + num(src.followers.at(-1) - src.followers[0]), l: "8 minggu terakhir" }, { v: pct(src.er.at(-1)), l: "ER minggu ini" }], chart: { labels: src.weeks.map((x) => x.split(" ")[0] + " " + (x.split(" ")[1] || "")), values: src.followers } };
    if (k === "sales" && src) return { layout: "stats", title: "Penjualan", stats: [{ v: "Rp " + num(src.values.at(-1), 1) + " jt", l: `Omzet ${src.months.at(-1)}` }, { v: "+" + pct(((src.values.at(-1) - src.values[0]) / src.values[0]) * 100, 0), l: `sejak ${src.months[0]}` }, { v: src.link.txt.split(" ")[0], l: src.link.campaign }], chart: { labels: src.months, values: src.values } };
    if (k === "calc") { const { tab, v } = calcValues(w); return { layout: "stats", title: CALC_DEF[tab].label, stats: CALC_DEF[tab].out(v).slice(0, 3).map(([l, val]) => ({ v: val, l })) }; }
    if (k === "tasks" && src) return { layout: "timeline", title: "Tugas & milestone", rows: [...src.milestones.map((m) => ({ label: "◆ " + m.title, date: fmtDay(m.due), owner: m.progress + "%" })), ...src.tasks.filter((t) => !t.done).slice(0, 4).map((t) => ({ label: t.title, date: t.due ? fmtDay(t.due) : "–", owner: t.owner || "–" }))] };
    if (k === "content" && src) return { layout: "timeline", title: "Rencana konten", rows: src.slice(0, 6).map((c) => ({ label: c.title, date: fmtDay(c.date), owner: c.platform })) };
    if (k === "dna" && src) return { layout: "statement", title: "Brand DNA", big: src.positioning, body: "Nilai: " + src.nilai.join(" · ") };
    if (k === "brandbook" && src) return { layout: "identity", title: "Identitas brand", subtitle: frameTitle, colors: src.colors, fonts: src.fonts };
    return null;
  }

  // ---------- render ----------
  const E = (path, html, tag = "div", cls = "") => `<${tag} class="${cls}" data-f="${path}">${html}</${tag}>`;
  function slideHTML(s, n, total) {
    const t = T(), L = Store.lab();
    const logo = theme === "brand" && t.logo ? `<img src="${esc(t.logo)}" alt="" style="height:100%;width:auto;max-width:100%;object-fit:contain">` : theme === "brand" && window.__papanHost ? `<span style="font-family:'${esc(t.disp)}';font-size:24px;color:${s.layout === "closing" ? t.dark : t.acc}">${esc(t.brandName || "")}</span>` : theme === "brand" ? LOGO_SVG(s.layout === "cover" ? t.light : t.dark, t.acc) : `<span style="font-family:'Grift Black';font-size:28px;color:${s.layout === "closing" ? t.dark : t.acc}">Brandlab</span>`;
    const foot = s.layout === "cover" || s.layout === "closing" ? "" : `<div class="pg">${n} / ${total}</div><div class="logo-s">${logo}</div>`;
    const tx = (v) => esc(v || "");
    let inner = "";
    switch (s.layout) {
      case "cover": inner = `${E("kicker", tx(s.kicker), "div", "k")}${E("title", tx(s.title), "h1")}${E("subtitle", tx(s.subtitle), "div", "sub")}<div class="bigmark">${theme === "brand" && !window.__papanHost ? MARK_SVG(t.light, t.acc) : theme === "brand" && t.logo ? `<img src="${esc(t.logo)}" alt="" style="width:100%;height:100%;object-fit:contain">` : ""}</div>`; break;
      case "closing": inner = `${E("title", tx(s.title), "h1")}${E("subtitle", tx(s.subtitle), "div", "sub")}<div style="position:absolute;right:88px;bottom:60px;width:260px">${logo}</div>`; break;
      case "statement": inner = `${E("title", tx(s.title), "div", "k")}${E("big", tx(s.big), "div", "big")}${s.body ? E("body", tx(s.body), "div", "body") : ""}`; break;
      case "agenda": case "bullets": inner = `${E("title", tx(s.title), "h2")}<ul class="bl">${(s.bullets || []).map((b, i) => E("bullets." + i, tx(b), "li")).join("")}</ul>`; break;
      case "summary": inner = `${E("title", tx(s.title), "h2")}<div class="two"><div>${E("body", tx(s.body), "div", "")}</div><div class="col"><h3>${tx(s.side)}</h3><ul class="bl">${(s.bullets || []).map((b, i) => E("bullets." + i, tx(b), "li")).join("")}</ul></div></div>`; break;
      case "ideas": { const n2 = (s.items || []).length; inner = `${E("title", tx(s.title), "h2")}<div class="ideas n${Math.min(n2, 6)}">${(s.items || []).map((it, i) => `<div class="idea">${it.tag ? `<span class="itag">${tx(it.tag)}</span>` : ""}${E(`items.${i}.title`, tx(it.title), "div", "it")}${it.votes ? `<span class="iv">${it.votes} vote</span>` : ""}</div>`).join("")}</div>`; break; }
      case "two": inner = `${E("title", tx(s.title), "h2")}<div class="two"><div class="col"><ul class="bl">${(s.bullets || []).map((b, i) => E("bullets." + i, tx(b), "li")).join("")}</ul></div><div class="col">${E("body", tx(s.body))}</div></div>`; break;
      case "mood": inner = `${E("title", tx(s.title), "h2")}<div class="mood">${(s.tiles || []).map((m) => m.kind === "img" ? `<div class="mi"><img src="${esc(m.src)}" alt=""></div>` : m.kind === "swatch" ? `<div class="mi sw" style="background:${esc(m.hex)};color:${readableOn(m.hex)}">${tx(m.label)}</div>` : `<div class="mi lnk"><b>${tx(m.title)}</b><span>${tx(m.sub)}</span></div>`).join("")}</div>`; break;
      case "stats": { const max = s.chart ? Math.max(...s.chart.values) : 1, min = s.chart ? Math.min(...s.chart.values) * 0.9 : 0; inner = `${E("title", tx(s.title), "h2")}<div class="stats">${(s.stats || []).map((x) => `<div><b>${tx(x.v)}</b><span>${tx(x.l)}</span></div>`).join("")}</div>${s.chart ? `<div class="chart">${s.chart.values.map((v, i) => `<div class="cb"><em>${num(v, 1)}</em><i style="height:${((v - min) / (max - min || 1)) * 150 + 20}px;opacity:${i === s.chart.values.length - 1 ? 1 : 0.55}"></i><span>${tx(s.chart.labels[i])}</span></div>`).join("")}</div>` : ""}`; break; }
      case "timeline": inner = `${E("title", tx(s.title), "h2")}<div class="tline">${(s.rows || []).map((r, i) => `<div class="tr">${E(`rows.${i}.date`, tx(r.date), "span", "d")}${E(`rows.${i}.label`, tx(r.label), "b")}${E(`rows.${i}.owner`, tx(r.owner), "span", "o")}</div>`).join("")}</div>`; break;
      case "table": inner = `${E("title", tx(s.title), "h2")}<table class="st">${(s.rows || []).map((r, ri) => `<tr>${r.map((c, ci) => `<td data-f="rows.${ri}.${ci}">${tx(c)}</td>`).join("")}</tr>`).join("")}</table>`; break;
      case "campaign": inner = `<div class="k">Campaign</div>${E("title", tx(s.title), "h2")}<div class="camp"><div class="kv">${(s.kv || []).map(([k, v], i) => `<span>${tx(k)}</span>${E(`kv.${i}.1`, tx(v))}`).join("")}</div><div>${(s.stats || []).length ? `<div class="stats" style="grid-template-columns:1fr">${s.stats.map((x) => `<div><b>${tx(x.v)}</b><span>${tx(x.l)}</span></div>`).join("")}</div>` : `<div class="idea" style="min-height:0"><div class="ib" style="opacity:.8">Angka muncul otomatis setelah campaign berjalan.</div></div>`}</div></div>`; break;
      case "identity": inner = `${E("title", tx(s.title), "h2")}<div class="idbox">${(s.colors || []).slice(0, 5).map((c) => `<div style="background:${esc(c.hex)};color:${readableOn(c.hex)}">${tx(c.name)}<span style="font-weight:600;opacity:.8">${esc(c.hex)}</span></div>`).join("")}</div><div class="two"><div><div class="k" style="margin-bottom:8px">Font</div><div style="font-family:'${esc(s.fonts?.display)}';font-size:44px">${tx(s.fonts?.display)}</div><div style="font-size:24px;margin-top:6px">${tx(s.fonts?.body)}</div></div>${E("subtitle", tx(s.subtitle), "div", "body")}</div>`; break;
    }
    const style = `--s-bg:${t.bg};--s-fg:${t.fg};--s-dark:${t.dark};--s-light:${t.light};--s-acc:${t.acc};--s-acc2:${t.acc2};--s-card:${t.card};--s-disp:'${t.disp}',Georgia,serif;--s-body:'${t.body}',system-ui,sans-serif`;
    return `<div class="slide ${s.layout}" style="${style}">${inner}${foot}</div>`;
  }
  function setPath(obj, path, v) { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) { const k = /^\d+$/.test(ks[i]) ? +ks[i] : ks[i]; if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; } o[/^\d+$/.test(ks.at(-1)) ? +ks.at(-1) : ks.at(-1)] = v; }

  // ---------- editor ----------
  function open() {
    if (!Store.board()) return toast("Buka papan dulu");
    close();
    root = document.createElement("div"); root.className = "deck"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Presentasi");
    document.body.appendChild(root);
    Store.getDeck().then((d) => { if (d && d.slides?.length) { slides = d.slides; theme = d.theme || "brand"; idx = 0; editor(); } else { theme = "brand"; pick(); } });
    root.innerHTML = `<div class="deck-top"><h2>Jadikan presentasi</h2></div><div class="deck-pick">${'<div class="thinking"><span class="spinner"></span>Memuat…</div>'}</div>`;
  }
  function close() { root?.remove(); root = null; }
  function pick() {
    const frames = Store.objects().filter((o) => o.type === "frame" && Canvas.visible(o)).sort((a, c) => Math.round(a.y / 300) - Math.round(c.y / 300) || a.x - c.x);
    const hasVotes = Store.objects().some((o) => Board.votesFor(o).count || o.tag === "terpilih");
    root.innerHTML = `<div class="deck-top"><h2>Jadikan presentasi</h2><span style="flex:1"></span><button class="btn btn-ghost" data-d="close">${ic("x")}<span class="lbl">Tutup</span></button></div>
      <div class="deck-pick"><h3>Pilih isi slide</h3><p class="muted" style="margin:0 0 18px">Tiap frame jadi slide dengan tata letak yang cocok dengan isinya: kartu ide, moodboard, tabel, angka, atau linimasa. Bukan screenshot papan.</p>
      <div class="stack">${frames.length ? frames.map((f) => `<label class="pickrow"><input type="checkbox" data-fr="${f.id}" checked><span class="t"><b>${esc(f.text)}</b><span>${frameContents(f).length} objek</span></span></label>`).join("") : `<div class="note">${ic("info")}<span>Papan ini belum punya frame. Kelompokkan isi papan dengan Frame (F) supaya tiap bagian jadi slide.</span></div>`}
      <div class="add-sec">Tambahan</div>
      <label class="pickrow"><input type="checkbox" id="dRecap" checked><span class="t"><b>Ringkasan & keputusan</b><span>Dari tanda Keputusan di papan</span></span></label>
      <label class="pickrow${hasVotes ? "" : " off"}"><input type="checkbox" id="dVoted" ${hasVotes ? "checked" : "disabled"}><span class="t"><b>Ide terpilih</b><span>${hasVotes ? "Dari hasil voting" : "Belum ada voting di papan ini"}</span></span></label>
      <label class="pickrow"><input type="checkbox" id="dIdent"><span class="t"><b>Identitas brand</b><span>Warna, font, positioning dari Brand Book</span></span></label>
      <label class="pickrow"><input type="checkbox" id="dAct" checked><span class="t"><b>Rencana aksi & langkah berikutnya</b><span>Dari checklist dan tugas papan ini</span></span></label>
      <div class="add-sec">Gaya</div><div class="seg" id="dTheme"><button data-v="brand" class="${theme === "brand" ? "on" : ""}">${esc(THEMES.brand().name)}</button><button data-v="lab" class="${theme === "lab" ? "on" : ""}">Brandlab gelap</button></div>
      <label class="pickrow" style="margin-top:6px"><input type="checkbox" id="dAI" ${AI.available ? "" : "disabled"}><span class="t"><b>Rapikan teks slide dengan AI ${UI.AI_COST}</b><span>${AI.available ? "Judul lebih tajam, poin lebih singkat. Tidak menambah fakta." : "AI belum aktif di tampilan ini"}</span></span></label>
      <button class="btn btn-primary" data-d="build" style="margin-top:8px;padding:13px">${ic("slides")} Buat slide</button></div></div>`;
    root.querySelector("#dTheme").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; theme = b.dataset.v; root.querySelectorAll("#dTheme button").forEach((x) => x.classList.toggle("on", x === b)); };
    root.onclick = async (e) => {
      const d = e.target.closest("[data-d]")?.dataset.d;
      if (d === "close") close();
      if (d === "build") {
        slides = build({ frames: $$("[data-fr]", root).filter((x) => x.checked).map((x) => x.dataset.fr), recap: $("#dRecap").checked, voted: $("#dVoted").checked, identity: $("#dIdent").checked, actions: $("#dAct").checked });
        if ($("#dAI").checked) { e.target.closest("button").innerHTML = '<span class="spinner"></span> Merapikan teks…'; const p = await AI.polishDeck(slides); if (p) slides = p; }
        idx = 0; persist(); editor();
      }
    };
  }
  function persist() { if (Store.canWrite) Store.saveDeck({ slides, theme }); }
  function editor() {
    if (!root) return;
    saveSoon = debounce(persist, 900);
    root.onclick = null;
    root.innerHTML = `<div class="deck-top"><button class="btn btn-ghost btn-sm" data-d="back">${ic("chevronLeft")}<span class="lbl">Pilih ulang isi</span></button><h2 style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((Store.board()?.name || "").replace(/^Contoh · /, ""))}</h2>
      <button class="btn btn-secondary btn-sm" data-d="pptx">${ic("download")}<span class="lbl">PPTX</span></button><button class="btn btn-secondary btn-sm" data-d="pdf">${ic("download")}<span class="lbl">PDF</span></button><button class="btn btn-primary btn-sm" data-d="present">${ic("play")}<span class="lbl">Presentasikan</span></button><button class="icon-btn" data-d="close" aria-label="Tutup">${ic("x")}</button></div>
      <div class="deck-main"><div class="deck-thumbs" id="dThumbs"></div><div class="deck-stage" id="dStage"></div><div class="deck-side" id="dSide"></div></div>`;
    root.addEventListener("click", onDeckClick);
    drawThumbs(); drawStage(); drawSide();
  }
  function scaleBox(el, w) { const s = w / 1280; el.style.width = w + "px"; el.style.height = 720 * s + "px"; el.firstElementChild.style.transform = `scale(${s})`; }
  function drawThumbs() {
    const box = $("#dThumbs", root);
    box.innerHTML = slides.map((s, i) => `<button class="thumb${i === idx ? " on" : ""}" data-i="${i}" draggable="true" aria-label="Slide ${i + 1}"><span class="n">${i + 1}</span><div class="tv">${slideHTML(s, i + 1, slides.length)}</div></button>`).join("") + `<button class="btn btn-secondary btn-sm" data-d="add">${ic("plus")} Slide</button>`;
    box.querySelectorAll(".tv").forEach((tv) => { const w = tv.clientWidth || 170; tv.firstElementChild.style.transform = `scale(${w / 1280})`; });
    // drag to reorder
    let from = null;
    box.querySelectorAll(".thumb").forEach((t) => {
      t.ondragstart = () => (from = +t.dataset.i);
      t.ondragover = (e) => { e.preventDefault(); box.querySelectorAll(".thumb").forEach((x) => x.classList.toggle("drop-above", x === t)); };
      t.ondrop = (e) => { e.preventDefault(); const to = +t.dataset.i; if (from == null || from === to) return; const [s] = slides.splice(from, 1); slides.splice(to, 0, s); idx = to; from = null; saveSoon(); drawThumbs(); drawStage(); drawSide(); };
      t.ondragend = () => box.querySelectorAll(".thumb").forEach((x) => x.classList.remove("drop-above"));
    });
  }
  function drawStage() {
    const st = $("#dStage", root); if (!slides[idx]) return;
    st.innerHTML = `<div class="sv">${slideHTML(slides[idx], idx + 1, slides.length)}</div><div class="hint">Klik teks di slide untuk mengubahnya. Seret slide di kiri untuk mengurutkan.</div>`;
    const sv = st.querySelector(".sv");
    const fitW = () => { const r = st.getBoundingClientRect(); const w = Math.min(r.width - 40, ((r.height - 70) * 16) / 9); scaleBox(sv, Math.max(200, w)); };
    fitW();
    const slideEl = sv.firstElementChild; slideEl.classList.add("editing");
    slideEl.querySelectorAll("[data-f]").forEach((el) => { el.contentEditable = "true"; el.spellcheck = true; el.addEventListener("input", () => { setPath(slides[idx], el.dataset.f, el.innerText.replace(/\n$/, "")); saveSoon(); clearTimeout(el._t); el._t = setTimeout(drawThumbs, 600); }); el.addEventListener("keydown", (e) => e.stopPropagation()); });
  }
  function drawSide() {
    const s = slides[idx]; if (!s) return;
    $("#dSide", root).innerHTML = `<div><label class="lbl">Tata letak</label><div class="layout-grid">${Object.entries(LAYOUTS).map(([k, v]) => `<button data-lay="${k}" class="${s.layout === k ? "on" : ""}">${v}</button>`).join("")}</div></div>
      <div><label class="lbl">Gaya</label><div class="seg"><button data-th="brand" class="${theme === "brand" ? "on" : ""}">Brand Book</button><button data-th="lab" class="${theme === "lab" ? "on" : ""}">Brandlab</button></div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" data-d="dup">${ic("copy")} Duplikat</button><button class="btn btn-danger btn-sm" data-d="del">${ic("trash")} Hapus slide</button></div>
      <div class="note">${ic("info")}<span>Tersimpan otomatis untuk papan ini${Store.mode === "db" ? " dan terlihat semua anggota" : ""}. Font PPTX: ${esc(T().disp)} & ${esc(T().body)}; pasang font itu di laptop presentasi supaya sama persis.</span></div>`;
  }
  function convertLayout(s, lay) {
    const texts = [s.title, s.big, s.body, ...(s.bullets || []), ...(s.items || []).map((x) => x.title), ...(s.rows || []).map((r) => (Array.isArray(r) ? r.join(" · ") : r.label))].filter(Boolean);
    const n = { id: s.id, layout: lay, title: s.title || texts[0] || "Judul" };
    if (["bullets", "agenda", "summary", "two"].includes(lay)) n.bullets = s.bullets || (s.items || []).map((x) => x.title) || texts.slice(1, 6);
    if (lay === "summary" || lay === "two") { n.body = s.body || s.big || ""; n.side = s.side || "Poin"; }
    if (lay === "ideas") n.items = s.items || (s.bullets || texts.slice(1, 7)).map((t) => ({ title: t }));
    if (lay === "statement") { n.big = s.big || texts[1] || s.title; n.body = s.body || ""; }
    if (lay === "cover" || lay === "closing") { n.subtitle = s.subtitle || Store.lab().brand.tagline; n.kicker = s.kicker || ""; }
    if (lay === "timeline") n.rows = s.rows && !Array.isArray(s.rows[0]) ? s.rows : (s.bullets || (s.items || []).map((x) => x.title) || []).map((t) => ({ label: t, date: "–", owner: "" }));
    if (lay === "table") n.rows = s.rows && Array.isArray(s.rows[0]) ? s.rows : [["Poin", "Catatan"], ...(s.bullets || (s.items || []).map((x) => x.title) || []).map((t) => [t, ""])];
    if (lay === "stats") { n.stats = s.stats || [{ v: "–", l: "Angka 1" }, { v: "–", l: "Angka 2" }, { v: "–", l: "Angka 3" }]; n.chart = s.chart; }
    if (lay === "mood") n.tiles = s.tiles || [];
    if (lay === "campaign") { n.kv = s.kv || [["Tujuan", ""], ["Audiens", ""], ["Strategi", ""]]; n.stats = s.stats || []; }
    if (lay === "identity") { const L = Store.lab(); n.colors = s.colors || L.book.colors; n.fonts = s.fonts || L.book.fonts; n.subtitle = s.subtitle || L.dna.positioning; }
    return n;
  }
  async function onDeckClick(e) {
    const t = e.target.closest("[data-i], [data-d], [data-lay], [data-th]"); if (!t || !root.contains(t)) return;
    if (t.dataset.i != null && t.classList.contains("thumb")) { idx = +t.dataset.i; drawThumbs(); drawStage(); drawSide(); return; }
    if (t.dataset.lay) { slides[idx] = convertLayout(slides[idx], t.dataset.lay); saveSoon(); drawThumbs(); drawStage(); drawSide(); return; }
    if (t.dataset.th) { theme = t.dataset.th; saveSoon(); drawThumbs(); drawStage(); drawSide(); return; }
    switch (t.dataset.d) {
      case "close": persist(); close(); break;
      case "back": pick(); break;
      case "add": slides.splice(idx + 1, 0, { id: uid("s"), layout: "bullets", title: "Judul slide", bullets: ["Poin pertama"] }); idx++; saveSoon(); drawThumbs(); drawStage(); drawSide(); break;
      case "dup": slides.splice(idx + 1, 0, { ...clone(slides[idx]), id: uid("s") }); idx++; saveSoon(); drawThumbs(); drawStage(); drawSide(); break;
      case "del": if (slides.length < 2) return toast("Sisakan minimal satu slide"); slides.splice(idx, 1); idx = Math.max(0, idx - 1); saveSoon(); drawThumbs(); drawStage(); drawSide(); break;
      case "present": present(idx); break;
      case "pptx": exportPPTX(t); break;
      case "pdf": exportPDF(t); break;
    }
  }

  // ---------- present ----------
  function present(start = 0) {
    let i = start;
    const p = document.createElement("div"); p.className = "present show-ui"; p.tabIndex = 0;
    p.innerHTML = `<div class="sv" style="position:relative"></div><div class="pbar"></div><div class="pctl glass"><button class="icon-btn" data-p="prev" aria-label="Sebelumnya">${ic("chevronLeft")}</button><span class="tnum" style="font-weight:800;font-size:13px;min-width:54px;text-align:center" id="pNum"></span><button class="icon-btn" data-p="next" aria-label="Berikutnya">${ic("chevronRight")}</button><button class="icon-btn" data-p="full" aria-label="Layar penuh">${ic("expand")}</button><button class="icon-btn" data-p="x" aria-label="Keluar">${ic("x")}</button></div>`;
    document.body.appendChild(p);
    const sv = p.querySelector(".sv");
    const draw = () => { sv.innerHTML = slideHTML(slides[i], i + 1, slides.length); const s = Math.min(innerWidth / 1280, innerHeight / 720); sv.style.width = 1280 * s + "px"; sv.style.height = 720 * s + "px"; sv.firstElementChild.style.transform = `scale(${s})`; p.querySelector(".pbar").style.width = ((i + 1) / slides.length) * 100 + "%"; p.querySelector("#pNum").textContent = `${i + 1} / ${slides.length}`; Collab.presence({ slide: i }); };
    const go = (d) => { i = clamp(i + d, 0, slides.length - 1); draw(); };
    const end = () => { p.remove(); window.removeEventListener("keydown", key, true); window.removeEventListener("resize", draw); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
    const key = (e) => { e.stopPropagation(); if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); } if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); } if (e.key === "Escape") end(); if (e.key === "Home") { i = 0; draw(); } if (e.key === "End") { i = slides.length - 1; draw(); } };
    let hideT; const showUI = () => { p.classList.add("show-ui"); clearTimeout(hideT); hideT = setTimeout(() => p.classList.remove("show-ui"), 2200); };
    p.addEventListener("pointermove", showUI);
    p.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (!b) return go(e.clientX > innerWidth / 3 ? 1 : -1); ({ prev: () => go(-1), next: () => go(1), x: end, full: () => (document.fullscreenElement ? document.exitFullscreen() : p.requestFullscreen?.())?.catch?.(() => toast("Layar penuh tidak tersedia di tampilan ini")) })[b.dataset.p](); });
    window.addEventListener("keydown", key, true); window.addEventListener("resize", draw);
    draw(); showUI(); p.focus();
  }

  // ---------- export ----------
  async function downloads() { try { return await window.claude?.use?.("downloads"); } catch { return null; } }
  async function save(filename, blob) {
    const dl = await downloads();
    if (!dl) return toast("Unduhan tidak tersedia di tampilan ini");
    try { await dl.save({ filename, data: blob }); toast(`${filename} siap`); }
    catch (e) { if (e?.code !== "cancelled" && e?.code !== "declined") toast("Unduhan dibatalkan atau gagal"); }
  }
  const fileBase = () => ((Store.board()?.name || "presentasi").replace(/^Contoh · /, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "presentasi");
  async function svgToPng(svg, w, h) {
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode().catch(() => {});
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); return c.toDataURL("image/png");
  }
  async function imgData(src) {
    if (!src) return null; if (src.startsWith("data:")) return src;
    try { const r = await fetch(src); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch { return null; }
  }
  async function exportPPTX(btn) {
    const old = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js");
      const t = T(), P = new window.PptxGenJS(); P.layout = "LAYOUT_WIDE"; P.title = Store.board()?.name || "Presentasi";
      const H = (c) => c.replace("#", "");
      const logoPng = theme === "brand" ? (t.logo ? t.logo : window.__papanHost ? null : await svgToPng(LOGO_SVG(t.dark, t.acc), 660, 192)) : null;
      const logoLight = theme === "brand" ? (t.logo ? t.logo : window.__papanHost ? null : await svgToPng(LOGO_SVG(t.light, t.acc), 660, 192)) : null;
      const X = (px) => px / 96; // slide is 1280x720 px = 13.333 x 7.5 in
      for (let n = 0; n < slides.length; n++) {
        const s = slides[n], sl = P.addSlide();
        const dark = s.layout === "cover", acc = s.layout === "closing";
        sl.background = { color: H(dark ? t.dark : acc ? t.acc : t.bg) };
        const fg = H(dark ? t.light : acc ? t.dark : t.fg);
        const title = (txt, y = 72, size = 34) => sl.addText(txt || "", { x: X(88), y: X(y), w: X(1104), h: X(90), fontFace: t.disp, fontSize: size, color: fg, valign: "top", fit: "shrink" });
        const bullets = (arr, y = 190, w = 1104, x = 88) => arr && arr.length && sl.addText(arr.map((b) => ({ text: b, options: { bullet: { code: "25A0" }, paraSpaceAfter: 10 } })), { x: X(x), y: X(y), w: X(w), h: X(460), fontFace: t.body, fontSize: 19, color: fg, valign: "top", fit: "shrink" });
        switch (s.layout) {
          case "cover": sl.addText(s.kicker || "", { x: X(88), y: X(210), w: X(900), h: X(40), fontFace: t.body, fontSize: 14, bold: true, color: H(t.acc), charSpacing: 4 }); sl.addText(s.title || "", { x: X(88), y: X(260), w: X(950), h: X(200), fontFace: t.disp, fontSize: 54, color: fg, valign: "top", fit: "shrink" }); sl.addText(s.subtitle || "", { x: X(88), y: X(480), w: X(900), h: X(50), fontFace: t.body, fontSize: 18, color: fg }); if (logoLight) sl.addImage({ data: logoLight, x: X(980), y: X(600), w: X(220), h: X(64) }); break;
          case "closing": sl.addText(s.title || "", { x: X(88), y: X(250), w: X(1000), h: X(150), fontFace: t.disp, fontSize: 66, color: fg }); sl.addText(s.subtitle || "", { x: X(88), y: X(410), w: X(900), h: X(50), fontFace: t.body, fontSize: 20, color: fg }); break;
          case "statement": sl.addText(s.title || "", { x: X(88), y: X(150), w: X(1000), h: X(40), fontFace: t.body, fontSize: 14, bold: true, color: H(t.acc), charSpacing: 4 }); sl.addText(s.big || "", { x: X(88), y: X(200), w: X(1050), h: X(260), fontFace: t.disp, fontSize: 36, color: fg, valign: "top", fit: "shrink" }); if (s.body) sl.addText(s.body, { x: X(88), y: X(480), w: X(950), h: X(120), fontFace: t.body, fontSize: 17, color: fg, valign: "top", fit: "shrink" }); break;
          case "agenda": case "bullets": title(s.title); bullets(s.bullets); break;
          case "summary": case "two": title(s.title); sl.addText(s.body || "", { x: X(88), y: X(190), w: X(520), h: X(440), fontFace: t.body, fontSize: 18, color: fg, valign: "top", fit: "shrink" }); if (s.side) sl.addText(s.side.toUpperCase(), { x: X(660), y: X(190), w: X(530), h: X(30), fontFace: t.body, fontSize: 13, bold: true, color: H(t.acc), charSpacing: 3 }); bullets(s.bullets, 230, 530, 660); break;
          case "ideas": { title(s.title); const it = s.items || [], cols = it.length <= 2 ? it.length : it.length === 4 ? 2 : 3, rows = Math.ceil(it.length / cols), gw = 1104, gh = 440, cw = (gw - (cols - 1) * 22) / cols, ch = Math.min(200, (gh - (rows - 1) * 22) / rows);
            it.forEach((x, i) => { const cx = 88 + (i % cols) * (cw + 22), cy = 190 + Math.floor(i / cols) * (ch + 22); sl.addShape(P.ShapeType.roundRect, { x: X(cx), y: X(cy), w: X(cw), h: X(ch), fill: { color: H(t.card) }, line: { color: H(t.card) }, rectRadius: 0.15 }); sl.addText((x.tag ? x.tag.toUpperCase() + "\n" : "") + x.title, { x: X(cx + 18), y: X(cy + 14), w: X(cw - 36), h: X(ch - 28), fontFace: t.body, fontSize: 16, bold: true, color: fg, valign: "top", fit: "shrink" }); if (x.votes) sl.addText(`${x.votes} vote`, { x: X(cx + cw - 110), y: X(cy - 14), w: X(96), h: X(28), fontFace: t.body, fontSize: 11, bold: true, color: H(t.dark), fill: { color: H(t.acc) }, align: "center", rectRadius: 0.2 }); }); break; }
          case "mood": { title(s.title); const tl = s.tiles || []; for (let i = 0; i < tl.length; i++) { const m = tl[i], cx = 88 + (i % 3) * 376, cy = 190 + Math.floor(i / 3) * 236, w = 360, h = 220;
            if (m.kind === "img") { const d = await imgData(m.src); if (d) sl.addImage({ data: d, x: X(cx), y: X(cy), w: X(w), h: X(h), sizing: { type: "cover", w: X(w), h: X(h) } }); }
            else if (m.kind === "swatch") { sl.addShape(P.ShapeType.roundRect, { x: X(cx), y: X(cy), w: X(w), h: X(h), fill: { color: H(m.hex) }, line: { color: H(m.hex) }, rectRadius: 0.12 }); sl.addText(m.label || m.hex, { x: X(cx + 16), y: X(cy + h - 50), w: X(w - 32), h: X(36), fontFace: t.body, fontSize: 14, bold: true, color: readableOn(m.hex).replace("#", "") }); }
            else { sl.addShape(P.ShapeType.roundRect, { x: X(cx), y: X(cy), w: X(w), h: X(h), fill: { color: H(t.card) }, line: { color: H(t.card) }, rectRadius: 0.12 }); sl.addText([{ text: m.title || "", options: { bold: true, fontSize: 15, breakLine: true } }, { text: m.sub || "", options: { fontSize: 11 } }], { x: X(cx + 18), y: X(cy + h - 110), w: X(w - 36), h: X(96), fontFace: t.body, color: fg, valign: "bottom", hyperlink: m.url ? { url: m.url } : undefined }); } } break; }
          case "stats": { title(s.title); (s.stats || []).forEach((x, i) => { const cx = 88 + i * 376; sl.addShape(P.ShapeType.roundRect, { x: X(cx), y: X(190), w: X(356), h: X(130), fill: { color: H(t.card) }, line: { color: H(t.card) }, rectRadius: 0.12 }); sl.addText([{ text: x.v, options: { fontFace: t.disp, fontSize: 30, breakLine: true } }, { text: x.l, options: { fontSize: 12, bold: true } }], { x: X(cx + 20), y: X(200), w: X(320), h: X(110), fontFace: t.body, color: fg, valign: "middle", fit: "shrink" }); });
            if (s.chart) sl.addChart(P.ChartType.bar, [{ name: s.title, labels: s.chart.labels, values: s.chart.values }], { x: X(88), y: X(350), w: X(1104), h: X(300), barDir: "col", chartColors: [H(t.acc)], catAxisLabelColor: fg, valAxisLabelColor: fg, valAxisHidden: true, valGridLine: { style: "none" }, showValue: true, dataLabelColor: fg, dataLabelFontSize: 10, catAxisLabelFontSize: 11 }); break; }
          case "timeline": title(s.title); (s.rows || []).forEach((r, i) => { const cy = 190 + i * 76; sl.addShape(P.ShapeType.roundRect, { x: X(88), y: X(cy), w: X(1104), h: X(62), fill: { color: H(t.card) }, line: { color: H(t.card) }, rectRadius: 0.12 }); sl.addText(r.date, { x: X(108), y: X(cy), w: X(190), h: X(62), fontFace: t.body, fontSize: 15, bold: true, color: H(t.acc2), valign: "middle" }); sl.addText(r.label, { x: X(310), y: X(cy), w: X(640), h: X(62), fontFace: t.body, fontSize: 15, bold: true, color: fg, valign: "middle", fit: "shrink" }); sl.addText(r.owner, { x: X(960), y: X(cy), w: X(212), h: X(62), fontFace: t.body, fontSize: 13, color: fg, valign: "middle", align: "right" }); }); break;
          case "table": title(s.title); sl.addTable((s.rows || []).map((r, ri) => r.map((c) => ({ text: String(c || ""), options: { bold: ri === 0, color: ri === 0 ? H(t.acc2) : fg, fontSize: ri === 0 ? 12 : 13, fontFace: t.body } }))), { x: X(88), y: X(190), w: X(1104), border: { type: "solid", pt: 0.5, color: H(t.card) }, autoPage: false }); break;
          case "campaign": title(s.title, 100); sl.addText("CAMPAIGN", { x: X(88), y: X(60), w: X(400), h: X(30), fontFace: t.body, fontSize: 13, bold: true, color: H(t.acc), charSpacing: 3 }); sl.addTable((s.kv || []).map(([k, v]) => [{ text: k, options: { bold: true, color: fg, fontSize: 13 } }, { text: String(v || ""), options: { color: fg, fontSize: 14 } }]), { x: X(88), y: X(210), w: X(640), colW: [X(150), X(490)], fontFace: t.body, border: { type: "none" } }); (s.stats || []).forEach((x, i) => sl.addText([{ text: x.v, options: { fontFace: t.disp, fontSize: 26, breakLine: true } }, { text: x.l, options: { fontSize: 12, bold: true } }], { x: X(780), y: X(210 + i * 130), w: X(410), h: X(116), fontFace: t.body, color: fg, fill: { color: H(t.card) }, margin: 14 })); break;
          case "identity": title(s.title); (s.colors || []).slice(0, 5).forEach((c, i) => { sl.addShape(P.ShapeType.roundRect, { x: X(88 + i * 224), y: X(190), w: X(206), h: X(150), fill: { color: H(c.hex) }, line: { color: H(c.hex) }, rectRadius: 0.12 }); sl.addText(`${c.name}\n${c.hex}`, { x: X(100 + i * 224), y: X(280), w: X(186), h: X(54), fontFace: t.body, fontSize: 12, bold: true, color: readableOn(c.hex).replace("#", "") }); }); sl.addText([{ text: s.fonts?.display || "", options: { fontFace: s.fonts?.display, fontSize: 28, breakLine: true } }, { text: s.fonts?.body || "", options: { fontFace: s.fonts?.body, fontSize: 16 } }], { x: X(88), y: X(380), w: X(520), h: X(120), color: fg }); sl.addText(s.subtitle || "", { x: X(660), y: X(380), w: X(530), h: X(220), fontFace: t.body, fontSize: 15, color: fg, valign: "top", fit: "shrink" }); break;
        }
        if (!dark && !acc) { sl.addText(`${n + 1} / ${slides.length}`, { x: X(88), y: X(660), w: X(200), h: X(30), fontFace: t.body, fontSize: 11, color: fg, transparency: 45 }); if (logoPng) sl.addImage({ data: logoPng, x: X(1080), y: X(650), w: X(120), h: X(35) }); }
      }
      const blob = await P.write({ outputType: "blob" });
      await save(fileBase() + ".pptx", blob);
    } catch (e) { console.error(e); toast("PPTX gagal dibuat: " + (e.message || "coba lagi")); }
    btn.innerHTML = old; btn.disabled = false;
  }
  async function exportPDF(btn) {
    const old = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
      await document.fonts.ready;
      const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:720px;overflow:hidden";
      document.body.appendChild(host);
      const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "px", format: [1280, 720], hotfixes: ["px_scaling"] });
      for (let i = 0; i < slides.length; i++) {
        host.innerHTML = slideHTML(slides[i], i + 1, slides.length);
        const c = await window.html2canvas(host.firstElementChild, { scale: 1.5, useCORS: true, backgroundColor: null, logging: false, width: 1280, height: 720 });
        if (i) pdf.addPage([1280, 720], "landscape");
        pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 1280, 720);
      }
      host.remove();
      await save(fileBase() + ".pdf", pdf.output("blob"));
    } catch (e) { console.error(e); toast("PDF gagal dibuat: " + (e.message || "coba lagi")); }
    btn.innerHTML = old; btn.disabled = false;
  }
  window.addEventListener("resize", () => { if (root && $("#dStage", root)) { drawStage(); drawThumbs(); } });
  return { open, close, get slides() { return slides; } };
})();

/* ---- 15-main.js ---- */
// Boot: chrome, capabilities (shared db, presence, AI, files), first board.
const App = (() => {
  const hostTheme = document.documentElement.getAttribute("data-theme");
  function resolveTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    const light = t ? t === "light" : matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.dataset.resolved = light ? "light" : "dark";
    Canvas.scheduleRender();
  }
  function setTheme(t) {
    if (t === "system") { if (hostTheme) document.documentElement.setAttribute("data-theme", hostTheme); else document.documentElement.removeAttribute("data-theme"); }
    else document.documentElement.setAttribute("data-theme", t);
    LS.set("theme", t); resolveTheme();
  }
  function chrome() {
    const tb = [["select", "cursor", "Pilih", "V"], ["hand", "hand", "Geser kanvas", "H"], null, ["sticky", "sticky", "Sticky note", "N"], ["text", "text", "Teks", "T"], ["shape", "shapes", "Bentuk", "S"], ["connector", "connector", "Garis penghubung", "C"], ["pen", "pen", "Pena", "P"], ["eraser", "eraser", "Penghapus coretan", "E"], ["frame", "frame", "Frame", "F"], ["comment", "comment", "Komentar", "M"], null];
    $("#toolbar").innerHTML = tb.map((t) => (t ? `<button class="icon-btn${["hand", "select", "comment"].includes(t[0]) ? "" : " readonly-hide"}" data-tool="${t[0]}" data-tip="${t[2]}" data-key="${t[3]}" aria-label="${t[2]}">${ic(t[1])}${t[0] === "sticky" ? '<span class="sw-dot"></span>' : ""}</button>` : '<span class="sep readonly-hide"></span>')).join("")
      + `<button class="icon-btn plus readonly-hide" id="addBtn" data-popper data-tip="Tambah apa saja" data-key="/" aria-label="Tambah">${ic("plus")}</button><button class="icon-btn aib readonly-hide" id="aiBtn" data-tip="Tanya Brandlab (AI)" aria-label="Tanya Brandlab">${ic("sparkle")}</button>`;
    $("#fabAI").innerHTML = `${ic("sparkle")}<span>Tanya Brandlab</span>`;
    $("#zoombar").innerHTML = `<button class="icon-btn readonly-hide" id="undoBtn" data-tip="Batal" data-key="Ctrl Z" aria-label="Batal">${ic("undo")}</button><button class="icon-btn readonly-hide" id="redoBtn" data-tip="Ulangi" data-key="Ctrl Shift Z" aria-label="Ulangi">${ic("redo")}</button><span class="sep readonly-hide"></span><button class="icon-btn" id="zoomOut" data-tip="Perkecil" data-key="−" aria-label="Perkecil">${ic("minus")}</button><button class="zl tnum" id="zoomLbl" data-tip="Zoom 100%" data-key="Shift 0">100%</button><button class="icon-btn" id="zoomIn" data-tip="Perbesar" data-key="+" aria-label="Perbesar">${ic("plus")}</button><button class="icon-btn" id="zoomFit" data-tip="Lihat semua" data-key="Shift 1" aria-label="Lihat semua">${ic("fit")}</button>`;
    $("#helpBtn").innerHTML = ic("keyboard");
    $("#boardBtn").insertAdjacentHTML("beforeend", ic("chevronDown"));
    $("#brandMark").innerHTML = MARK_SVG("#F3E6D3", "#E2683C");
    $("#shareBtn").insertAdjacentHTML("afterbegin", ic("users"));
    $("#deckBtn").insertAdjacentHTML("afterbegin", ic("slides"));
    $("#planBtn").insertAdjacentHTML("afterbegin", ic("map"));
    $("#moreBtn").innerHTML = ic("dots");
    if (BL()) { // Brandlab: the real brand in the chip, no prototype extras
      const L = Store.lab(), b = L?.brand || {};
      const chip = $(".brand-chip");
      if (chip) chip.innerHTML = `<span class="bm" style="background:${esc(b.color || "var(--accent-fill)")};color:${readableOn(b.color || "#ffa52b")};font-weight:800;font-size:11px">${esc(initials(b.name || "B"))}</span><span class="bn">${esc(b.name || "")}</span>`;
      $("#planBtn")?.remove();
      $(".logo")?.remove();
    }
  }
  function showEmpty() {
    const e = $("#empty"); e.hidden = false;
    if (GUEST()) { e.innerHTML = `<div class="glass" style="border-radius:22px;padding:28px;max-width:460px;width:calc(100% - 32px);box-sizing:border-box;text-align:center"><h2 style="font-family:var(--font-display);font-weight:400;font-size:24px;margin:0 0 8px">Papan ini sudah tidak ada</h2><p class="muted" style="margin:0">Mungkin sudah dihapus oleh pemiliknya.</p></div>`; return; }
    e.innerHTML = `<div class="glass" style="border-radius:22px;padding:28px;max-width:560px;width:calc(100% - 32px);box-sizing:border-box;text-align:center">
      <div class="logo-mark" style="width:52px;height:52px;margin:0 auto 14px;font-size:24px;border-radius:15px;font-family:var(--font-display)">P</div>
      <h2 style="font-family:var(--font-display);font-weight:400;font-size:26px;margin:0 0 8px">Belum ada papan</h2>
      <p class="muted" style="margin:0 0 20px">${BL() ? "Papan untuk brainstorming bareng tim: catatan, gambar, video, data brand, sampai jadi presentasi. Mulai dari kosong atau dari template." : "Mulai dari papan contoh untuk melihat semua fitur dipakai, atau bikin papan sendiri."}</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${Store.canWrite ? (BL() ? `<button class="btn btn-primary" id="emNew">${ic("plus")} Papan baru</button>` : `<button class="btn btn-primary" id="emEx">${ic("layers")} Buka papan contoh</button><button class="btn btn-secondary" id="emNew">${ic("plus")} Papan baru</button>`) : '<p class="muted">Pemilik papan belum membuat papan apa pun.</p>'}${BL() ? "" : `<button class="btn btn-ghost" id="emPlan">${ic("map")} Baca rencananya</button>`}</div></div>`;
    $("#emEx") && ($("#emEx").onclick = () => createExample());
    $("#emNew") && ($("#emNew").onclick = () => UI.templates("new"));
    $("#emPlan") && ($("#emPlan").onclick = () => Plan.open());
  }
  function hideEmpty() { $("#empty").hidden = true; }
  async function createExample() {
    hideEmpty();
    const ex = exampleBoard();
    const map = new Map(ex.objs.map((o) => [o.id, uid("o")]));
    const objs = ex.objs.map((o, i) => {
      const n = clone(o); n.id = map.get(o.id);
      if (n.type === "connector") for (const k of ["from", "to"]) if (n.data[k].id) n.data[k].id = map.get(n.data[k].id);
      n.z = i + 1;
      return { ...Store.newObject(n), createdBy: "contoh", updatedBy: "contoh" };
    });
    let parent = null;
    const comments = ex.comments.map((c, i) => { const cm = { id: uid("c"), objectId: map.get(c.ref), text: c.text, name: c.name, by: "contoh-" + i, at: Date.now() - (ex.comments.length - i) * 600000, resolved: false, internal: false, parent: c.reply ? parent : null }; if (!c.reply) parent = cm.id; return cm; });
    await Store.createBoard({ name: "Contoh · Campaign Ramadan 2027", objects: objs, comments, kind: "example", meta: { voting: { active: false, round: 1, per: 3 } } });
  }
  // Whole board if it is readable, otherwise the first frame (reading order) at a comfortable zoom.
  function readableFit() {
    Canvas.fit(null, false);
    if (Canvas.cam.z >= 0.32) return;
    const f = Store.objects().filter((o) => o.type === "frame").sort((a, b) => Math.round(a.y / 300) - Math.round(b.y / 300) || a.x - b.x)[0];
    if (f) Canvas.fit([f.id], false);
  }
  async function use(name) { try { return window.claude && window.claude.use ? await window.claude.use(name) : null; } catch { return null; } }
  async function boot() {
    const t = LS.get("theme", "system"); if (t !== "system") setTheme(t); else resolveTheme();
    matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", resolveTheme);
    new MutationObserver(resolveTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    chrome();
    Canvas.init(); UI.init();
    // capabilities resolve in parallel; the page works without any of them
    const [db, user, room, sample, assets] = await Promise.all(["db", "user", "room", "sample", "assets"].map(use));
    const me = {};
    let canWrite = true;
    if (user) {
      try { me.id = await user.id(); } catch {}
      try { const v = await user.me(); me.name = v.name || ""; me.color = v.color || null; me.email = v.email || ""; } catch {}
      try { const c = await user.can("data.write"); if (c === false) canWrite = false; } catch {}
      try { Store._isOwner = await user.isOwner(); } catch {}
    }
    me.name = me.name || "Kamu";
    await Store.init({ db, assets, me, canWrite });
    if (!Store.canWrite) document.body.classList.add("ro");
    if (GUEST()) Canvas.clientView = true; // guests see the board the way a client does
    Collab.init(room, user); AI.init(sample);
    Collab.presence({ uid: Store.me.id, nm: Store.me.name, b: null });
    // first board
    let opened = false;
    Store.on((k, info) => {
      if (k === "boards" && !opened && Store.S.boardsLoaded) {
        opened = true;
        const list = Store.boards(), last = LS.get("lastBoard");
        const pick = list.find((b) => b.id === last) || (BL() ? null : list.find((b) => b.kind === "example")) || list[0];
        if (pick) Store.openBoard(pick.id);
        else if (Store.mode === "local") createExample();
        else showEmpty();
      }
      if (k === "boards" && opened && Store.S.boardId && !Store.boards().some((b) => b.id === Store.S.boardId)) {
        const next = Store.boards()[0]; if (next) { toast("Papan ini dihapus oleh anggota lain"); Store.openBoard(next.id); } else showEmpty();
      }
      if (k === "board-open") { hideEmpty(); Collab.presence({ b: info.id, sel: [], edit: null }); UI.updateTop(); try { window.__papanBridge?.boardChanged(info.id); } catch {} }
      if (k === "objects" && info?.first) { setTimeout(() => { readableFit(); setTimeout(() => UI.tour(), 500); }, 30); }
    });
    if (Store.S.boardsLoaded && !opened) Store.emit("boards");
  }
  return { boot, setTheme, createExample, showEmpty, readableFit };
})();
App.boot();
