// Papan home (Brandlab, team only): what opens when the Papan tab is clicked.
// Every board of the brand in folders (board.folder), the meetings held on
// them with their notulen (board.meetings, written when a notulen is saved —
// 11-panels.js recap), the tasks that came out of them, and how much of the
// brand's board space is used (LIMITS). Only board docs are read here; a
// notulen's full text is fetched when it is opened.
const Home = (() => {
  let el = null, folder = "all", unsub = null;
  const isOpen = () => !!el && !el.hidden;
  const can = () => Store.canWrite && !GUEST();
  const boardsIn = (f) => Store.boards().filter((b) => (f === "all" ? true : f === "" ? !b.folder : b.folder === f));
  const folders = () => [...new Set(Store.boards().map((b) => b.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));

  function open() {
    Store.closeBoard();
    UI.closePops(); $(".scrim")?.remove(); Panels.close?.();
    if (!el) {
      el = document.createElement("div");
      el.className = "home"; el.id = "home";
      document.body.appendChild(el);
      el.addEventListener("click", onClick);
    }
    el.hidden = false;
    document.body.classList.add("on-home");
    if (!unsub) unsub = Store.on((k) => { if (isOpen() && (k === "boards" || k === "lab")) render(); });
    render();
  }
  function close() {
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove("on-home");
  }
  function openBoard(id) { close(); Store.openBoard(id); }

  // ---------- render ----------
  function quotaHTML() {
    const n = Store.boards().length, max = LIMITS.boards, full = n >= max;
    return `<div class="home-quota${full ? " full" : n >= max - 2 ? " near" : ""}" role="status"><div class="hq-bar"><i style="width:${Math.min(100, (n / max) * 100)}%"></i></div><span><b>${n} dari ${max} papan</b> dipakai di brand ini · tiap papan maks. ${LIMITS.images} gambar${full ? ". Hapus papan lama supaya bisa bikin yang baru." : ""}</span></div>`;
  }
  function cardHTML(b) {
    const meets = (b.meetings || []).length;
    const info = [`diubah ${timeAgo(b.updatedAt || b.createdAt)}`, meets ? `${meets} rapat` : ""].filter(Boolean).join(" · ");
    return `<article class="hcard" data-open="${esc(b.id)}" tabindex="0" aria-label="Buka papan ${esc(b.name)}">
      <div class="pv">${b.thumb || `<span class="pv-empty">${ic("layers")}</span>`}</div>
      <div class="tx"><b>${esc(b.name || "Papan tanpa judul")}</b><span>${esc(info)}</span>
      <div class="chips">${b.folder ? `<span class="chip">${ic("folder")} ${esc(b.folder)}</span>` : ""}${b.share?.on ? `<span class="chip live">${ic("link")} Link aktif</span>` : ""}</div></div>
      <button class="icon-btn hc-more" data-more="${esc(b.id)}" data-popper aria-label="Pilihan untuk ${esc(b.name)}">${ic("dots")}</button></article>`;
  }
  function meetingsHTML() {
    const all = [];
    for (const b of Store.boards()) for (const m of b.meetings || []) all.push({ ...m, boardId: b.id, boardName: b.name });
    all.sort((a, c) => (c.at || 0) - (a.at || 0));
    const rows = all.slice(0, 8).map((m) => `<button class="hrow" data-meet="${esc(m.boardId)}:${esc(m.id)}">
      <span class="hr-date"><b>${esc(fmtDate(m.at, false))}</b><small>${esc(fmtDate(m.at).split(", ")[1] || "")}</small></span>
      <span class="hr-main"><b>${esc(m.title || m.boardName || "Rapat")}</b><small>${esc([durLabel(m.durationMs), m.people?.length ? `${m.people.length} orang` : "", m.decisions ? `${m.decisions} keputusan` : "", m.tasks ? `${m.tasks} tugas` : ""].filter((x) => x && x !== "–").join(" · "))}</small>
      ${m.people?.length ? `<small class="hr-people">${esc(m.people.slice(0, 6).join(", "))}${m.people.length > 6 ? ` +${m.people.length - 6}` : ""}</small>` : ""}</span>${ic("chevronDown", "i hr-go")}</button>`).join("");
    return `<section class="hside"><h3>${ic("clock")} Rapat & notulen</h3>${rows || `<p class="muted hs-empty">Belum ada notulen. Di papan, jalankan Timer saat rapat, lalu klik <b>Selesai rapat</b>: peserta, durasi, keputusan, dan tugas tersimpan di sini.</p>`}</section>`;
  }
  function tasksHTML() {
    const names = new Map(Store.boards().map((b) => [b.id, b.name]));
    const list = (Store.lab().tasks || []).filter((t) => t.board && names.has(t.board));
    const open = list.filter((t) => !t.done).sort((a, c) => String(a.due || "9999").localeCompare(String(c.due || "9999")));
    const done = list.filter((t) => t.done).length;
    const rows = open.slice(0, 8).map((t) => `<div class="htask"><input type="checkbox" data-task="${esc(t.id)}" aria-label="Tandai selesai: ${esc(t.title)}" ${can() ? "" : "disabled"}><span class="ht-main"><b>${esc(t.title)}</b><small>${esc([t.due ? `tenggat ${fmtDay(t.due)}` : "", t.goal ? `Tujuan: ${t.goal}` : ""].filter(Boolean).join(" · "))}</small><button class="linkbtn" data-open="${esc(t.board)}">${esc(names.get(t.board))}</button></span></div>`).join("");
    return `<section class="hside"><h3>${ic("task")} Tugas dari papan${open.length ? ` <span class="chip">${open.length}</span>` : ""}</h3>${rows || `<p class="muted hs-empty">${done ? `Semua ${done} tugas dari papan sudah selesai.` : "Belum ada tugas. Di notulen rapat, centang tugasnya lalu klik <b>Jadikan tugas</b>: tugas masuk ke Tujuan dan muncul di sini."}</p>`}
      ${BL() ? `<button class="linkbtn hs-more" data-go="goals">Lihat semua tugas di Tujuan</button>` : ""}</section>`;
  }
  function render() {
    if (!el) return;
    const all = Store.boards(), fs = folders();
    if (folder !== "all" && folder !== "" && !fs.includes(folder)) folder = "all";
    const list = boardsIn(folder);
    const brand = Store.lab()?.brand?.name || "";
    const chip = (k, label, n) => `<button class="fchip${folder === k ? " on" : ""}" data-folder="${esc(k)}">${k && k !== "all" ? ic("folder") : ""}${esc(label)} <small>${n}</small></button>`;
    el.innerHTML = `<div class="home-in">
      <header class="home-h"><div><div class="home-k">Papan${brand ? ` · ${esc(brand)}` : ""}</div><h1>Semua papan</h1></div><span class="spacer"></span>
        ${window.__papanChat ? `<button class="btn btn-ai" data-act="ask">${ic("sparkle")} <span class="hide-sm">Tanya Brandlab</span></button>` : ""}
        ${can() ? `<button class="btn btn-primary" data-act="new">${ic("plus")} Papan baru</button>` : ""}</header>
      ${quotaHTML()}
      <div class="home-cols"><div class="home-main">
        ${all.length ? `<div class="home-folders" role="tablist" aria-label="Folder">${chip("all", "Semua", all.length)}${fs.map((f) => chip(f, f, boardsIn(f).length)).join("")}${fs.length ? chip("", "Tanpa folder", boardsIn("").length) : ""}${can() ? `<button class="fchip add" data-act="folder">${ic("plus")} Folder baru</button>` : ""}</div>` : ""}
        ${list.length ? `<div class="home-cards">${list.map(cardHTML).join("")}</div>`
          : all.length ? `<p class="muted" style="margin:24px 4px">Folder ini masih kosong. Pindahkan papan ke sini lewat tombol ⋯ di kartunya.</p>`
          : `<div class="home-empty">${ic("layers")}<h2>Belum ada papan</h2><p class="muted">Papan untuk brainstorming dan rapat bareng tim: catatan, gambar, video, data brand, sampai notulen dan presentasi.</p>${can() ? `<button class="btn btn-primary" data-act="new">${ic("plus")} Papan baru</button>` : ""}</div>`}
      </div><aside class="home-side">${meetingsHTML()}${tasksHTML()}</aside></div></div>`;
  }

  // ---------- actions ----------
  function onClick(e) {
    const t = e.target.closest("[data-act], [data-folder], [data-more], [data-open], [data-meet], [data-task], [data-go]");
    if (!t || !el.contains(t)) return;
    if (t.dataset.task != null) { const id = t.dataset.task; Store.labSave("tasks", { id, done: t.checked }); toast(t.checked ? "Tugas selesai" : "Tugas dibuka lagi"); return; }
    if (t.dataset.more) { e.stopPropagation(); return cardMenu(t, t.dataset.more); }
    if (t.dataset.folder != null) { folder = t.dataset.folder; render(); return; }
    if (t.dataset.meet) { const [b, m] = t.dataset.meet.split(":"); return notulen(b, m); }
    if (t.dataset.go) return window.__papanGo?.(t.dataset.go);
    if (t.dataset.open) return openBoard(t.dataset.open);
    const a = t.dataset.act;
    if (a === "new") { if (!canAddBoard()) return; return UI.templates("new"); }
    if (a === "folder") return folderDialog();
    if (a === "ask") return window.__papanChat?.();
  }
  function canAddBoard() {
    if (Store.boards().length < LIMITS.boards) return true;
    toast(`Batas ${LIMITS.boards} papan per brand sudah tercapai. Hapus papan yang sudah tidak dipakai dulu.`, { ms: 6000 });
    return false;
  }
  function cardMenu(btn, id) {
    const b = Store.boards().find((x) => x.id === id); if (!b) return;
    const fs = folders().filter((f) => f !== b.folder);
    UI.pop(btn, `<button class="mi" data-pick="open">${ic("arrowRight")} Buka</button>
      ${can() ? `<button class="mi" data-pick="rename">${ic("edit")} Ganti nama</button>
      <div class="sep"></div><div class="mh">Pindah ke folder</div>
      ${fs.map((f) => `<button class="mi" data-pick="mv:${esc(f)}">${ic("folder")} ${esc(f)}</button>`).join("")}
      <button class="mi" data-pick="mvnew">${ic("plus")} Folder baru…</button>
      ${b.folder ? `<button class="mi" data-pick="mvout">${ic("x")} Keluarkan dari “${esc(b.folder)}”</button>` : ""}
      <div class="sep"></div><button class="mi" data-pick="del" style="color:var(--bad)">${ic("trash")} Hapus papan</button>` : ""}`, {
      onPick: (k, item) => {
        if (k === "open") return openBoard(id);
        if (k === "rename") { setTimeout(() => renameDialog(b), 0); return; }
        if (k.startsWith("mv:")) { Store.updateBoard({ folder: k.slice(3) }, id); toast(`Dipindah ke “${k.slice(3)}”`); return; }
        if (k === "mvout") { Store.updateBoard({ folder: null }, id); toast("Dikeluarkan dari folder"); return; }
        if (k === "mvnew") { setTimeout(() => folderDialog(id), 0); return; }
        if (k === "del") {
          if (item.dataset.sure) { Store.deleteBoard(id); toast("Papan dihapus"); return; }
          item.dataset.sure = "1"; item.innerHTML = `${ic("trash")} Yakin? Klik lagi untuk menghapus semua isinya`; return true;
        }
      } });
  }
  function renameDialog(b) {
    const s = UI.modal("Ganti nama papan", `<label class="lbl" for="hmName">Nama papan</label><input class="field" id="hmName" maxlength="80" value="${esc(b.name || "")}">`, `<button class="btn btn-ghost" data-x>Batal</button><button class="btn btn-primary" id="hmNameGo">Simpan</button>`, { cls: "sm" });
    const go = () => { const v = $("#hmName").value.trim(); if (!v) return toast("Tulis namanya dulu"); Store.updateBoard({ name: v }, b.id); s.remove(); };
    s.querySelector("[data-x]").onclick = () => s.remove();
    $("#hmNameGo").onclick = go; $("#hmName").onkeydown = (e) => { if (e.key === "Enter") go(); };
    setTimeout(() => $("#hmName")?.select(), 30);
  }
  // A folder is just a name on boards: make one by choosing which boards go in.
  function folderDialog(preset) {
    const list = Store.boards();
    const s = UI.modal("Folder baru", `<div class="stack"><div><label class="lbl" for="hmFolder">Nama folder (misalnya nama proyek atau campaign)</label><input class="field" id="hmFolder" maxlength="40" placeholder="Campaign Ramadan"></div>
      <div><label class="lbl">Papan yang masuk folder ini</label><div class="stack" style="gap:6px;max-height:300px;overflow:auto">${list.map((b) => `<label class="pickrow"><input type="checkbox" data-pb="${esc(b.id)}" ${b.id === preset ? "checked" : ""}><span class="t"><b>${esc(b.name)}</b><span>${b.folder ? `Sekarang di “${esc(b.folder)}”` : "Belum di folder"}</span></span></label>`).join("")}</div></div></div>`,
      `<button class="btn btn-ghost" data-x>Batal</button><button class="btn btn-primary" id="hmFolderGo">Buat folder</button>`, { cls: "sm" });
    s.querySelector("[data-x]").onclick = () => s.remove();
    $("#hmFolderGo").onclick = () => {
      const name = $("#hmFolder").value.replace(/\s+/g, " ").trim();
      const ids = $$("[data-pb]", s).filter((x) => x.checked).map((x) => x.dataset.pb);
      if (!name) return toast("Tulis nama foldernya dulu");
      if (!ids.length) return toast("Centang minimal satu papan untuk folder ini");
      for (const id of ids) Store.updateBoard({ folder: name }, id);
      s.remove(); folder = name; render();
      toast(`Folder “${name}” dibuat dengan ${ids.length} papan`);
    };
    setTimeout(() => $("#hmFolder")?.focus(), 30);
  }

  // ---------- notulen ----------
  async function notulen(boardId, meetingId) {
    const b = Store.boards().find((x) => x.id === boardId);
    const meta = (b?.meetings || []).find((m) => m.id === meetingId) || {};
    const s = UI.modal("Notulen rapat", `<div id="hmNot">${'<div class="thinking"><span class="spinner"></span>Memuat notulen…</div>'}</div>`, `<button class="btn btn-secondary" id="hmNotOpen">${ic("arrowRight")} Buka papan</button><button class="btn btn-primary" id="hmNotPdf" disabled>${ic("download")} Unduh PDF</button>`);
    $("#hmNotOpen").onclick = () => { s.remove(); openBoard(boardId); };
    const doc = await Store.getRecap(boardId, meetingId);
    if (!s.isConnected) return;
    if (!doc) { $("#hmNot").innerHTML = `<p class="muted">Notulen ini tidak ditemukan. Mungkin sudah dihapus.</p>`; return; }
    const r = doc.recap || {}, m = { ...meta, ...(doc.meeting || {}) };
    $("#hmNot").innerHTML = Exporter.notulenHTML(r, m, b?.name || "");
    $("#hmNotPdf").disabled = false;
    $("#hmNotPdf").onclick = () => Exporter.notulenPDF(r, m, b?.name || "", $("#hmNotPdf"));
  }

  return { open, close, get isOpen() { return isOpen(); }, canAddBoard, openBoard, render };
})();
