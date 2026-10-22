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
