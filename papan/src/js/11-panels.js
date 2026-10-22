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
