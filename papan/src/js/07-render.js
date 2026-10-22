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
