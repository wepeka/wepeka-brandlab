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
    const out = Canvas.insertObjects(objs, freeSpot(cols * 220 - 20, rows * 220 - 20, near));
    setTimeout(() => {
      // Show them without zooming in; in Brandlab the chat panel covers the
      // right side of the board, so they land left of the middle.
      const t = Canvas.camFor(Canvas.bboxOf(out), 70, 1);
      if (window.__papanHost === "brandlab" && window.innerWidth > 900) t.x -= Math.min(230, window.innerWidth * 0.16);
      Canvas.animateTo(t);
    }, 60);
    return out.length;
  }
  // Nearest empty spot around `near` for a w×h group, so chat ideas never
  // land on top of a frame, widget or another note.
  function freeSpot(w, h, near) {
    const boxes = Store.objects().filter((o) => o.type !== "connector").map((o) => Canvas.bboxOf([o]));
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
  window.__papanSummary = () => `Papan "${(Store.board()?.name || "").replace(/^Contoh · /, "")}"\n${boardContext(false, true)}`;
  window.__papanPlace = place;
  return { open, send, place };
})();
