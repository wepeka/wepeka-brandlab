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
