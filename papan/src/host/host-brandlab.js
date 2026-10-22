// Brandlab host (papan/build.mjs puts this first). The canvas runs in an
// iframe on #/brand/:id/papan; Brandlab hands it a bridge
// (js/papan/bridge.js, window.parent.__papanBridge) and this file turns that
// into the window.claude.use() API the canvas was written against, so the
// same canvas code also runs inside claude.ai for prototypes.
(() => {
  let bridge = null;
  try { bridge = window.parent && window.parent !== window ? window.parent.__papanBridge : null; } catch { bridge = null; }
  window.__papanHost = "brandlab";
  // Brandlab's own chat button sits over the board, so the board's purple
  // "Tanya Brandlab" pill would be a second door to the same chat.
  document.documentElement.classList.add("host-brandlab");
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

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return { status: "saved" };
    },
  };

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

  const adapters = { db, user: bridge.user, room: bridge.room || null, sample, downloads, assets: null };
  window.claude = { use: async (name) => adapters[name] || null };
})();
