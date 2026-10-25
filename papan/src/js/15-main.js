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
    if (BL() && !GUEST()) $("#homeBtn").innerHTML = ic("grid"); else $("#homeBtn")?.remove();
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
        // Brandlab team: the Papan tab opens the home (14-home.js); a board's
        // own address (#/brand/:id/papan/:boardId) opens that board.
        if (BL() && !GUEST()) {
          const want = window.__papanBridge?.boardId;
          if (want && Store.boards().some((b) => b.id === want)) Store.openBoard(want);
          else Home.open();
          return;
        }
        const list = Store.boards(), last = LS.get("lastBoard");
        const pick = list.find((b) => b.id === last) || (BL() ? null : list.find((b) => b.kind === "example")) || list[0];
        if (pick) Store.openBoard(pick.id);
        else if (Store.mode === "local") createExample();
        else showEmpty();
      }
      if (k === "boards" && opened && Store.S.boardId && !Store.boards().some((b) => b.id === Store.S.boardId)) {
        if (BL() && !GUEST()) { toast("Papan ini dihapus"); Home.open(); return; }
        const next = Store.boards()[0]; if (next) { toast("Papan ini dihapus oleh anggota lain"); Store.openBoard(next.id); } else showEmpty();
      }
      if (k === "board-open") { hideEmpty(); Home.close(); Collab.presence({ b: info.id, sel: [], edit: null }); UI.updateTop(); try { window.__papanBridge?.boardChanged(info.id); } catch {} }
      if (k === "board-close") { Collab.presence({ b: null, sel: [], edit: null }); try { window.__papanBridge?.boardChanged(null); } catch {} }
      if (k === "objects" && info?.first) { setTimeout(() => { readableFit(); setTimeout(() => UI.tour(), 500); }, 30); }
    });
    if (Store.S.boardsLoaded && !opened) Store.emit("boards");
  }
  return { boot, setTheme, createExample, showEmpty, readableFit };
})();
App.boot();
