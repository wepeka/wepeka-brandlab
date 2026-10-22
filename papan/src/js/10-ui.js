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
    return `<div class="guest-link"><label class="pickrow"><input type="checkbox" id="gOn" ${on ? "checked" : ""} ${can ? "" : "disabled"}><span class="t"><b>Link tamu: siapa pun yang punya link bisa masuk</b><span>Tanpa akun, cukup tulis nama. Tamu hanya membuka papan ini, tidak melihat data brand, dan tidak memakai AI.</span></span></label>
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
