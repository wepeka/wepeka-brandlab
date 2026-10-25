// Downloads that aren't slides: the board itself as a PDF (the whole board,
// then one page per frame, then its links and videos) and a meeting's notulen
// as a plain-text PDF. Same libraries as the deck's PDF (13-deck.js).
const Exporter = (() => {
  const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  const H2C = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
  async function save(filename, blob) {
    let dl = null;
    try { dl = await window.claude?.use?.("downloads"); } catch { dl = null; }
    if (!dl) return toast("Unduhan tidak tersedia di tampilan ini");
    try { await dl.save({ filename, data: blob }); toast(`${filename} siap`); }
    catch (e) { if (e?.code !== "cancelled" && e?.code !== "declined") toast("Unduhan dibatalkan atau gagal"); }
  }
  const slug = (s, d) => (String(s || "").replace(/^Contoh · /, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || d);
  // jsPDF's built-in fonts only know Latin-1 (plus curly quotes): drop emoji and the like.
  const pdfText = (s) => String(s ?? "").replace(/[–—]/g, "-").replace(/[^\u0000-ÿ‘’“”•…]/g, "").replace(/\s+\n/g, "\n").trim();
  const busy = (btn) => { if (!btn) return () => {}; const old = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; return () => { btn.innerHTML = old; btn.disabled = false; }; };

  // Every link and video on the board (or inside one frame), for the PDF's last page and the deck.
  function linksOf(objs = Store.objects()) {
    const out = [], seen = new Set();
    for (const o of objs) {
      if (o.type !== "embed" || !o.data?.url || seen.has(o.data.url) || !Canvas.visible(o)) continue;
      seen.add(o.data.url);
      const kind = { youtube: "Video YouTube", tiktok: "Video TikTok", instagram: "Instagram" }[o.data.kind] || o.data.domain || "Link";
      out.push({ title: o.data.title || o.text || o.data.url, kind, url: o.data.url });
    }
    return out;
  }

  // ---------- the board ----------
  async function boardPDF(btn) {
    const b = Store.board();
    if (!b || !Store.S.loaded) return toast("Buka papan dulu");
    if (!Store.objects().length) return toast("Papan ini masih kosong");
    const done = busy(btn);
    const t = toast("Menyiapkan PDF papan…", { ms: 60000 });
    const vp = $("#vp"), links = $("#linksL"), cam = { ...Canvas.cam };
    const keep = { bg: vp.style.backgroundImage, l: links.getAttribute("style") || "", vb: links.getAttribute("viewBox") };
    try {
      await loadScript(H2C); await loadScript(JSPDF); await document.fonts.ready;
      Canvas.deselect();
      // The connector layer is a 1px SVG that overflows; give it the board's real size while capturing.
      const real = Store.objects().filter((o) => o.type !== "connector" && Canvas.visible(o));
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const o of real) { x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y - 40); x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + (o.h || 200)); }
      links.setAttribute("viewBox", `${x1 - 200} ${y1 - 200} ${x2 - x1 + 400} ${y2 - y1 + 400}`);
      links.style.left = x1 - 200 + "px"; links.style.top = y1 - 200 + "px"; links.style.width = x2 - x1 + 400 + "px"; links.style.height = y2 - y1 + 400 + "px";
      vp.style.backgroundImage = "none";
      const bg = getComputedStyle(vp).backgroundColor;
      const r = vp.getBoundingClientRect(), scale = clamp(2400 / Math.max(r.width, 1), 1.5, 3);
      const shot = async (ids) => {
        Canvas.fit(ids, false);
        await sleep(260);
        const c = await window.html2canvas(vp, { scale, backgroundColor: bg, useCORS: true, logging: false, ignoreElements: (el) => el.tagName === "IFRAME" });
        return c;
      };
      const frames = real.filter((o) => o.type === "frame").sort((a, c) => Math.round(a.y / 300) - Math.round(c.y / 300) || a.x - c.x);
      const pages = [{ title: b.name, c: await shot(null) }];
      for (const f of frames) pages.push({ title: (f.text || "Frame").replace(/^\d+\s*·\s*/, ""), c: await shot([f.id]) });
      const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "px", format: [pages[0].c.width, pages[0].c.height], hotfixes: ["px_scaling"] });
      const brand = Store.lab()?.brand?.name || "";
      pages.forEach((p, i) => {
        const W = p.c.width, Hh = p.c.height;
        if (i) pdf.addPage([W, Hh], W >= Hh ? "landscape" : "portrait");
        pdf.addImage(p.c.toDataURL("image/jpeg", 0.88), "JPEG", 0, 0, W, Hh);
        const fs = Math.round(W / 90);
        const alpha = (a) => { if (pdf.GState && pdf.setGState) pdf.setGState(new pdf.GState({ opacity: a })); };
        pdf.setFillColor(0, 0, 0); alpha(0.55); pdf.rect(0, Hh - fs * 2.6, W, fs * 2.6, "F"); alpha(1);
        pdf.setTextColor(255, 255, 255); pdf.setFontSize(fs);
        pdf.text(pdfText(`${i ? p.title + " · " : ""}${b.name}${brand ? " · " + brand : ""}`), fs * 1.4, Hh - fs * 0.95);
        pdf.text(`${i + 1} / ${pages.length + (linksOf().length ? 1 : 0)}`, W - fs * 1.4, Hh - fs * 0.95, { align: "right" });
      });
      const ls = linksOf();
      if (ls.length) {
        const W = pages[0].c.width, Hh = pages[0].c.height, fs = Math.round(W / 70), m = fs * 3;
        pdf.addPage([W, Hh], "landscape");
        pdf.setTextColor(30, 26, 20); pdf.setFontSize(fs * 1.6); pdf.text("Link & video di papan ini", m, m + fs);
        let y = m + fs * 3.4;
        for (const l of ls) {
          if (y > Hh - m) { pdf.addPage([W, Hh], "landscape"); y = m; }
          pdf.setFontSize(fs); pdf.setTextColor(30, 26, 20); pdf.text(pdfText(`${l.kind}: ${l.title}`).slice(0, 120), m, y);
          pdf.setFontSize(fs * 0.8); pdf.setTextColor(180, 83, 10); pdf.textWithLink(l.url.slice(0, 140), m, y + fs * 1.2, { url: safeUrl(l.url)?.href || "" });
          y += fs * 3;
        }
      }
      await save(slug(b.name, "papan") + ".pdf", pdf.output("blob"));
    } catch (e) { console.error(e); toast("PDF papan gagal dibuat: " + (e.message || "coba lagi")); }
    finally {
      vp.style.backgroundImage = keep.bg;
      links.setAttribute("style", keep.l);
      if (keep.vb == null) links.removeAttribute("viewBox"); else links.setAttribute("viewBox", keep.vb);
      Object.assign(Canvas.cam, cam); Canvas.applyCam(); Canvas.scheduleRender();
      t.remove?.(); done();
    }
  }

  // ---------- notulen ----------
  const SECS = [["topik", "Topik yang dibahas"], ["keputusan", "Keputusan"], ["terpilih", "Ide terpilih (dari voting)"], ["ide", "Ide utama"], ["pertanyaan", "Pertanyaan terbuka"], ["aksi", "Tugas"], ["langkah", "Langkah berikutnya"], ["links", "Link & video"]];
  function metaLine(m) {
    const when = m.startedAt || m.at;
    const end = m.endedAt ? new Date(m.endedAt) : null;
    return [when ? fmtDate(when) + (end ? `–${String(end.getHours()).padStart(2, "0")}.${String(end.getMinutes()).padStart(2, "0")}` : "") : "", m.durationMs ? `durasi ${durLabel(m.durationMs)}` : "", m.people?.length ? `${m.people.length} peserta` : ""].filter(Boolean).join(" · ");
  }
  function notulenHTML(r, m, boardName) {
    const list = (k) => {
      const a = r[k] || [];
      if (!a.length) return "";
      if (k === "aksi") return `<table class="nt-tasks"><tr><th>Tugas</th><th>PIC</th><th>Tenggat</th></tr>${a.map((x) => `<tr><td>${esc(x.tugas)}</td><td>${esc(x.pic || "–")}</td><td>${esc(x.deadline || "–")}</td></tr>`).join("")}</table>`;
      if (k === "links") return `<ul>${a.map((l) => `<li>${esc(l.kind)}: <a href="${esc(safeUrl(l.url)?.href || "#")}" target="_blank" rel="noopener">${esc(l.title)}</a></li>`).join("")}</ul>`;
      return `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    };
    return `<div class="notulen"><div class="nt-head"><b>${esc(m.title || boardName || "Rapat")}</b><span>${esc(metaLine(m))}</span></div>
      ${m.people?.length ? `<h5>Peserta</h5><p>${esc(m.people.join(", "))}</p>` : ""}
      ${r.ringkasan ? `<h5>Gambaran rapat</h5><p>${esc(r.ringkasan)}</p>` : ""}
      ${SECS.map(([k, label]) => { const h = list(k); return h ? `<h5>${label}</h5>${h}` : ""; }).join("")}</div>`;
  }
  async function notulenPDF(r, m, boardName, btn) {
    const done = busy(btn);
    try {
      await loadScript(JSPDF);
      const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      const W = pdf.internal.pageSize.getWidth(), Hh = pdf.internal.pageSize.getHeight(), M = 50, TW = W - M * 2;
      let y = M;
      const room = (h) => { if (y + h > Hh - M) { pdf.addPage(); y = M; } };
      const para = (txt, size = 11, color = [40, 36, 30], bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(...color);
        for (const line of pdf.splitTextToSize(pdfText(txt), TW)) { room(size * 1.45); pdf.text(line, M, y); y += size * 1.45; }
      };
      const head = (txt) => { y += 10; room(34); pdf.setDrawColor(230, 222, 208); pdf.line(M, y - 4, W - M, y - 4); y += 12; para(txt, 12.5, [180, 83, 10], true); y += 2; };
      const bullets = (arr) => { for (const x of arr) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); const lines = pdf.splitTextToSize(pdfText(x), TW - 14); room(lines.length * 16); pdf.setTextColor(40, 36, 30); pdf.text("•", M, y); lines.forEach((l, i) => pdf.text(l, M + 14, y + i * 16)); y += lines.length * 16 + 3; } };
      const brand = Store.lab()?.brand?.name || "";
      para("NOTULEN RAPAT", 10, [180, 83, 10], true); y += 2;
      para(m.title || boardName || "Rapat", 22, [25, 22, 18], true);
      para([boardName && m.title !== boardName ? `Papan: ${boardName}` : "", brand].filter(Boolean).join(" · "), 10.5, [110, 100, 90]);
      para(metaLine(m), 10.5, [110, 100, 90]);
      if (m.people?.length) { head("Peserta"); para(m.people.join(", ")); }
      if (r.ringkasan) { head("Gambaran rapat"); para(r.ringkasan); }
      for (const [k, label] of SECS) {
        const a = r[k] || []; if (!a.length) continue;
        head(label);
        if (k === "aksi") bullets(a.map((x) => `${x.tugas}${x.pic ? ` — PIC: ${x.pic}` : ""}${x.deadline ? ` — tenggat: ${x.deadline}` : ""}`));
        else if (k === "links") for (const l of a) { room(32); para(`${l.kind}: ${l.title}`, 11); pdf.setFontSize(9.5); pdf.setTextColor(180, 83, 10); pdf.textWithLink(String(l.url).slice(0, 110), M, y, { url: safeUrl(l.url)?.href || "" }); y += 16; }
        else bullets(a);
      }
      const n = pdf.getNumberOfPages();
      for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8.5); pdf.setTextColor(150, 140, 128); pdf.text(pdfText(`Dibuat di Brandlab Papan · ${i}/${n}`), W - M, Hh - 24, { align: "right" }); }
      const day = new Date(m.startedAt || m.at || Date.now());
      await save(`notulen-${slug(m.title || boardName, "rapat")}-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}.pdf`, pdf.output("blob"));
    } catch (e) { console.error(e); toast("PDF notulen gagal dibuat: " + (e.message || "coba lagi")); }
    done();
  }
  return { boardPDF, notulenHTML, notulenPDF, linksOf, pdfText };
})();
