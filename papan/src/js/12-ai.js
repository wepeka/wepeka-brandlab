// AI only runs when someone presses a button marked "1 kredit". Everything marked "gratis" is plain rules below.
// Prototype: answers come from Claude via the viewer's own account. In Brandlab: api/ai.js (DeepSeek) on the owner's credits.
const AI = (() => {
  let sample = null;
  function brandContext() {
    if (window.__papanBrandContext) return window.__papanBrandContext();
    const L = Store.lab(), d = L.dna, b = L.book;
    return `BRAND: ${L.brand.name} (${L.brand.tagline})
Positioning: ${d.positioning}
Audiens: ${d.audiens}
Kepribadian: ${d.kepribadian.join(", ")}
Nilai: ${d.nilai.join(", ")}
Value proposition: ${d.vp}
Gaya bicara, lakukan: ${b.tone.do.join("; ")}
Gaya bicara, hindari: ${b.tone.dont.join("; ")}
Kata yang dihindari: ${b.avoid.join(", ")}`;
  }
  async function ask(prompt, tier = "default") {
    if (!sample) { toast("AI belum aktif di tampilan ini"); return null; }
    try { return await sample.json(prompt, { modelTier: tier }); }
    catch (e) {
      const c = e && e.code;
      if (e && e.shown) return null; // the host already said what went wrong
      if (c === "not_granted") { sample = null; Store.emit("ai"); toast("Izin AI tidak diberikan. Versi gratis tetap bisa dipakai."); }
      else if (c === "rate_limited") toast("AI sedang sibuk. Coba lagi sebentar.");
      else if (c === "invalid_json") toast("Jawaban AI tidak terbaca. Coba sekali lagi.");
      else toast("AI gagal menjawab. Coba lagi.");
      return null;
    }
  }
  const RULE = "Tulis dalam Bahasa Indonesia santai (pakai 'kamu'), sesuai gaya bicara brand. Jangan mengarang angka, nama orang, tanggal, atau keputusan yang tidak ada di data.";
  return {
    init(s) { sample = s; },
    ask,
    get available() { return !!sample; },
    brandContext,
    async ideas(topic, dir, n) {
      const r = await ask(`${brandContext()}\n\nTugas: beri ${n} ide untuk topik "${topic}". Arah: ${dir}. ${RULE} Ide harus konkret dan bisa dikerjakan kedai kecil. Jangan pakai diskon besar atau janji paling murah.\nBalas HANYA JSON array: [{"ide": "maks 14 kata", "alasan": "1 kalimat kenapa cocok dengan brand"}]`);
      return Array.isArray(r) ? r.filter((x) => x && x.ide).slice(0, n).map((x) => ({ ide: String(x.ide), alasan: String(x.alasan || "") })) : r == null ? null : (toast("Format jawaban AI tidak sesuai"), null);
    },
    async rewrite(text, instr) {
      const r = await ask(`${brandContext()}\n\nTeks asli: "${text}"\nTugas: ${instr}. ${RULE}\nBalas HANYA JSON array berisi 1–3 string pilihan.`, "quick");
      return Array.isArray(r) ? r.map(String).filter(Boolean).slice(0, 3) : null;
    },
    async themes(notes) {
      const list = notes.map((o, i) => `${i}. ${o.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
      const r = await ask(`Kelompokkan catatan brainstorming berikut menjadi 2–6 tema. Setiap catatan masuk tepat satu tema. Nama tema maksimal 4 kata, Bahasa Indonesia.\n\n${list}\n\nBalas HANYA JSON: [{"tema": "…", "nomor": [0, 3]}]`, "quick");
      if (!Array.isArray(r)) return null;
      const used = new Set();
      const groups = r.map((g) => ({ name: String(g.tema || "Tema"), ids: (g.nomor || []).map(Number).filter((i) => notes[i] && !used.has(i) && used.add(i)).map((i) => notes[i].id) })).filter((g) => g.ids.length);
      const rest = notes.map((o, i) => i).filter((i) => !used.has(i)).map((i) => notes[i].id);
      if (rest.length) groups.push({ name: "Lainnya", ids: rest });
      return groups;
    },
    async recap(r) {
      const res = await ask(`Rapikan bahasa ringkasan rapat ini supaya enak dibaca. ATURAN KERAS: jangan menambah keputusan, ide terpilih, PIC, atau tenggat baru. Jumlah item "keputusan" dan "aksi" harus sama dengan aslinya. Boleh memperjelas kalimat dan menulis ulang "ringkasan" (maks 3 kalimat).\n\n${JSON.stringify(r)}\n\nBalas HANYA JSON dengan kunci yang sama.`);
      if (!res || typeof res !== "object") return null;
      const out = clone(r);
      if (typeof res.ringkasan === "string") out.ringkasan = res.ringkasan;
      for (const k of ["topik", "ide", "pertanyaan", "langkah"]) if (Array.isArray(res[k])) out[k] = res[k].map(String).slice(0, Math.max(r[k].length, 1) + 2);
      // decisions, voted ideas, owners, deadlines: wording only, never new items or new names/dates
      for (const k of ["keputusan", "terpilih"]) if (Array.isArray(res[k])) out[k] = r[k].map((x, i) => String(res[k][i] || x));
      if (Array.isArray(res.aksi)) out.aksi = r.aksi.map((x, i) => ({ ...x, tugas: String(res.aksi[i]?.tugas || x.tugas) }));
      return out;
    },
    async brandCheck(notes) {
      const list = notes.map((o, i) => `${i}. ${o.text.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
      const r = await ask(`${brandContext()}\n\nCek tiap catatan apakah cocok dengan brand di atas. Jelaskan singkat kenapa. Kalau tidak cocok, beri saran tulisan pengganti (opsional). ${RULE}\n\n${list}\n\nBalas HANYA JSON: [{"nomor": 0, "cocok": true, "alasan": "…", "saran": "…atau kosong"}]`);
      if (!Array.isArray(r)) return null;
      return notes.map((o, i) => { const x = r.find((y) => Number(y.nomor) === i) || {}; return { o, ok: !!x.cocok, reasons: [String(x.alasan || "Tidak ada catatan dari AI")], sug: x.cocok ? null : x.saran ? String(x.saran) : null }; });
    },
    async campaign(notes) {
      const r = await ask(`${brandContext()}\n\nSusun draft campaign dari catatan rapat berikut:\n${notes.map((o) => "- " + o.text).join("\n")}\n\n${RULE} Tujuan sebaiknya terukur tapi JANGAN mengarang angka yang tidak ada di catatan; kalau tidak ada angka, tulis tujuan tanpa angka dan beri tanda [isi target].\nBalas HANYA JSON: {"name": "", "objective": "", "audience": "", "strategy": "", "channels": ["Instagram"]}`);
      if (!r || typeof r !== "object") return null;
      return { name: String(r.name || ""), objective: String(r.objective || ""), audience: String(r.audience || ""), strategy: String(r.strategy || ""), channels: Array.isArray(r.channels) ? r.channels.map(String) : [] };
    },
    // The deck as a real recap: per frame a takeaway + 3–5 points that merge
    // the notes (not a copy of every sticky), plus the meeting's summary and
    // next steps. Grounded in the board only. `parts` from Deck.recapInput().
    async deckRecap(parts, extra) {
      const r = await ask(`${brandContext()}\n\nKamu menyusun presentasi HASIL RAPAT dari isi papan tim di bawah. Pembaca presentasi tidak ikut rapat, jadi tiap slide harus langsung menjelaskan apa hasilnya.

Untuk TIAP bagian (frame) tulis:
- "judul": maks 7 kata, boleh memakai judul aslinya,
- "inti": 1 kalimat utuh (maks 24 kata) berisi kesimpulan bagian itu, bukan daftar,
- "poin": 3–5 poin (maks 14 kata per poin) yang MERANGKUM catatan: gabungkan catatan yang mirip, dahulukan yang paling banyak vote atau bertanda Keputusan. Jangan menyalin semua catatan satu per satu.
Lalu "ringkasan": 2–3 kalimat untuk seluruh rapat, dan "langkah": 2–4 langkah berikutnya yang memang tersirat dari papan.

ATURAN KERAS: hanya dari isi papan. Jangan menambah angka, nama orang, tanggal, merek, atau keputusan yang tidak ada. Kalau sebuah bagian hampir kosong, tulis inti yang jujur (misalnya "Bagian ini belum diisi banyak.") dan poin boleh kosong. ${RULE}

Isi papan:
${JSON.stringify({ papan: extra?.name || "", keputusan: extra?.keputusan || [], tugas: extra?.tugas || [], bagian: parts })}

Balas HANYA JSON: {"bagian": [{"id": "…", "judul": "…", "inti": "…", "poin": ["…"]}], "ringkasan": "…", "langkah": ["…"]}`);
      if (!r || typeof r !== "object" || !Array.isArray(r.bagian)) return r == null ? null : (toast("Format jawaban AI tidak sesuai"), null);
      const byId = new Map();
      for (const b of r.bagian) if (b && b.id) byId.set(String(b.id), { judul: String(b.judul || "").slice(0, 90), inti: String(b.inti || "").slice(0, 240), poin: (Array.isArray(b.poin) ? b.poin : []).map(String).filter(Boolean).slice(0, 5).map((x) => x.slice(0, 160)) });
      return { byId, ringkasan: String(r.ringkasan || "").slice(0, 600), langkah: (Array.isArray(r.langkah) ? r.langkah : []).map(String).filter(Boolean).slice(0, 4) };
    },
  };
})();

const Rules = (() => {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function cluster(notes) {
    const tk = new Map(notes.map((o) => [o.id, new Set(tokens(o.text))]));
    const left = new Set(notes.map((o) => o.id));
    const groups = [];
    while (left.size && groups.length < 5) {
      const count = new Map();
      for (const id of left) for (const w of tk.get(id)) count.set(w, (count.get(w) || 0) + 1);
      const best = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
      if (!best) break;
      const ids = [...left].filter((id) => tk.get(id).has(best[0]));
      // second keyword shared by most of the group, for a clearer name
      const c2 = new Map(); for (const id of ids) for (const w of tk.get(id)) if (w !== best[0]) c2.set(w, (c2.get(w) || 0) + 1);
      const sec = [...c2.entries()].filter(([, n]) => n >= Math.max(2, ids.length / 2)).sort((a, b) => b[1] - a[1])[0];
      groups.push({ name: cap(best[0]) + (sec ? " & " + sec[0] : ""), ids });
      ids.forEach((id) => left.delete(id));
    }
    if (left.size) {
      if (!groups.length) { // nothing shared: fall back to the colours people used
        const byColor = new Map(); for (const id of left) { const c = Store.obj(id)?.color || "lain"; if (!byColor.has(c)) byColor.set(c, []); byColor.get(c).push(id); }
        const NAMES = { yellow: "Kuning", orange: "Oranye", pink: "Merah muda", violet: "Ungu", blue: "Biru", green: "Hijau", gray: "Abu", white: "Putih" };
        for (const [c, ids] of byColor) groups.push({ name: "Catatan " + (NAMES[c] || "lain"), ids });
      } else groups.push({ name: "Lainnya", ids: [...left] });
    }
    return groups;
  }
  function duplicates(notes) {
    const out = [];
    const tk = notes.map((o) => tokens(o.text));
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
      const same = notes[i].text.trim().toLowerCase() === notes[j].text.trim().toLowerCase();
      if (same || (tk[i].length >= 2 && tk[j].length >= 2 && jaccard(tk[i], tk[j]) >= 0.5)) out.push([notes[i].id, notes[j].id]);
    }
    return out;
  }
  function prompts(topic, dir, n) {
    const L = Store.lab(), d = L.dna || {}, t = topic || "ide ini", aud = (d.audiens || "pelangganmu").split(/[,.]/)[0].replace(/^Pekerja muda & mahasiswa/, "pekerja muda & mahasiswa");
    const kp = (d.kepribadian || [])[0] || "hangat", nl = (d.nilai || [])[0] || "nilai brand-mu";
    const all = [
      `Bagaimana ${t} bisa terasa ${kp.toLowerCase()} buat ${aud}?`,
      `Apa yang bikin orang cerita ke temannya soal ${t}?`,
      `Kalau tanpa diskon sama sekali, apa nilai ${t} yang bikin orang datang?`,
      `Momen kecil apa di ${L.brand.name} yang bisa jadi konten tentang ${t}?`,
      `Bagaimana kalau ${t} dibuat bareng pelanggan?`,
      `Apa kebalikan dari yang dilakukan kompetitor untuk ${t}?`,
      `Bagaimana "${nl}" bisa jadi cerita di ${t}?`,
      `Satu hal kecil yang bisa dicoba minggu ini untuk ${t}?`,
      `Apa yang dilihat, didengar, dan dicium pelanggan saat ${t}?`,
      `Siapa partner lokal yang cocok diajak untuk ${t}?`,
      `Bagaimana membuat ${t} jadi kebiasaan, bukan sekali lewat?`,
      `Cerita di balik layar apa yang belum pernah kita ceritakan soal ${t}?`,
    ];
    if (dir === "Nama & tagline") all.unshift(`Tiga kata yang paling menggambarkan ${t}?`, `Kalau ${t} jadi orang, dia orang seperti apa?`);
    if (dir === "Konten") all.unshift(`Format apa yang paling cocok untuk ${t}: video pendek, carousel, atau story?`);
    return all.slice(0, n);
  }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
  function parseDate(s) {
    s = String(s || "").toLowerCase();
    const now = new Date(); let d = null;
    let m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(s);
    if (m) d = new Date(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), +m[2] - 1, +m[1]);
    if (!d) { m = /\b(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|ags|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?(?:\s+(\d{4}))?/.exec(s); if (m) d = new Date(m[3] ? +m[3] : now.getFullYear(), MONTHS[m[2]] - 1, +m[1]); }
    if (!d && /\bbesok\b/.test(s)) d = new Date(now.getTime() + 86400000);
    if (!d || isNaN(d)) return "";
    if (!m || !m[3]) if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)) d.setFullYear(d.getFullYear() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseTask(text) {
    const people = Store.lab().people;
    let owner = "";
    const who = mentionWho(text);
    if (who) owner = people.find((p) => p.toLowerCase() === who.toLowerCase() || who.toLowerCase().startsWith(p.toLowerCase())) || who;
    const due = parseDate(text);
    const priority = /penting|urgent|segera|asap|!!/i.test(text) ? "tinggi" : "sedang";
    let title = text.replace(/@[\p{L}][\p{L}\s.]{0,24}?(?=$|[,;.!?]| \d|\s{2})/u, "").replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/, "").replace(/^(keputusan|tugas|todo)\s*:\s*/i, "").replace(/\s{2,}/g, " ").trim();
    return { title: title.slice(0, 140), owner, due, priority };
  }
  function channels(text) {
    const s = String(text || "").toLowerCase(), out = [];
    if (/\big\b|instagram|reels?|carousel|story|feed/.test(s)) out.push("Instagram");
    if (/tiktok/.test(s)) out.push("TikTok");
    if (/youtube|\byt\b|shorts/.test(s)) out.push("YouTube");
    if (/\bwa\b|whatsapp/.test(s)) out.push("WhatsApp");
    if (/offline|di toko|lapak|halaman|event|akustik|session|kampus/.test(s)) out.push("Offline");
    return out;
  }
  function brandCheck(text) {
    const L = Store.lab(), reasons = [];
    const low = String(text || "").toLowerCase();
    const hit = (L.book?.avoid || []).filter((w) => w && low.includes(w));
    if (hit.length) reasons.push(`Ada kata yang dihindari di Brand Book: “${hit.join("”, “")}”.`);
    const letters = (text.match(/\p{L}/gu) || []).length, caps = (text.match(/\p{Lu}/gu) || []).length;
    const shouty = letters > 8 && caps / letters > 0.6;
    if (shouty) reasons.push(`Hampir semua huruf kapital, terasa berteriak.${(L.dna?.kepribadian || []).length ? ` Kepribadian brand: ${L.dna.kepribadian.slice(0, 2).join(", ").toLowerCase()}.` : ""}`);
    const excl = (text.match(/!/g) || []).length >= 2;
    if (excl) reasons.push("Banyak tanda seru, kurang cocok dengan gaya ngobrol seperti teman.");
    const disc = /(diskon|potongan|off|sale)\s*\d{2,}\s*%|\d{2,}\s*%\s*(off|diskon)/i.test(text);
    if (disc) reasons.push(BL() ? "Diskon besar: pastikan sesuai positioning dan nilai di Brand DNA, bukan sekadar perang harga." : `Diskon besar bertentangan dengan nilai “${L.dna.nilai[1]}” dan positioning yang menjual suasana, bukan harga.`);
    let sug = null;
    if ((shouty || excl) && !hit.length && !disc) { const t = text.replace(/!+/g, ".").replace(/\.{2,}/g, ".").toLowerCase(); sug = t.charAt(0).toUpperCase() + t.slice(1); }
    return { ok: !reasons.length, reasons: reasons.length ? reasons : ["Tidak ada kata yang dihindari dan nadanya santai."], sug };
  }
  function campaignDraft(notes) {
    const L = Store.lab();
    const f = Store.objects().find((x) => x.type === "frame" && notes.every((o) => { const c = Canvas.center(o); return c.x > x.x && c.x < x.x + x.w && c.y > x.y && c.y < x.y + x.h; }));
    const objective = notes.find((o) => /naik|tambah|target|tujuan|\d+\s*%|transaksi|penjualan/i.test(o.text));
    const ch = [...new Set(notes.flatMap((o) => channels(o.text)))];
    return {
      name: (f ? f.text.replace(/^\d+\s*[·.)-]\s*/, "") : notes[0].text).slice(0, 48),
      objective: objective ? objective.text : "",
      audience: L.dna?.audiens || "",
      strategy: notes.map((o) => "• " + o.text.replace(/\s+/g, " ")).join("\n"),
      channels: ch.length ? ch : ["Instagram"],
      start: "", end: "",
    };
  }
  function inside(o, f) { const c = Canvas.center(o); return c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h; }
  function recap() {
    const objs = Store.objects().filter(Canvas.visible), b = Store.board() || {};
    const frames = objs.filter((o) => o.type === "frame").sort((a, c) => a.y - c.y || a.x - c.x);
    const notes = objs.filter((o) => ["sticky", "text", "shape"].includes(o.type) && (o.text || "").trim() && !(o.type === "text" && o.heading));
    const stickies = objs.filter((o) => o.type === "sticky" && (o.text || "").trim());
    const score = (o) => Board.votesFor(o).count * 3 + Object.values(o.reactions || {}).reduce((n, w) => n + Object.values(w || {}).filter(Boolean).length, 0) + (Store.comments().filter((c) => c.objectId === o.id).length);
    const voted = stickies.filter((o) => Board.votesFor(o).count > 0).sort((a, c) => Board.votesFor(c).count - Board.votesFor(a).count);
    const picked = [...new Set([...stickies.filter((o) => o.tag === "terpilih"), ...voted.slice(0, 3)])];
    const ide = stickies.filter((o) => !o.tag || o.tag === "terpilih").sort((a, c) => score(c) - score(a)).slice(0, 6);
    const keputusan = notes.filter((o) => o.tag === "keputusan").map((o) => o.text.replace(/^keputusan\s*:\s*/i, "").trim());
    const pertanyaan = [...notes.filter((o) => o.tag === "pertanyaan"), ...stickies.filter((o) => !o.tag && /\?\s*$/.test(o.text))].map((o) => o.text.trim());
    const openComments = Store.comments().filter((c) => !c.resolved && !c.parent && /\?\s*$/.test(c.text));
    for (const c of openComments) pertanyaan.push(`${c.text} (komentar)`);
    const aksi = [];
    for (const cl of objs.filter((o) => o.type === "checklist")) for (const it of cl.data?.items || []) if (it.t && !it.done) { const p = parseTask(it.t); aksi.push({ tugas: p.title, pic: p.owner, deadline: p.due ? fmtDay(p.due) : "", ids: [cl.id] }); }
    const L = Store.lab();
    for (const t of L.tasks.filter((t) => t.source?.boardId === Store.S.boardId && !t.done)) if (!aksi.some((a) => a.tugas === t.title)) aksi.push({ tugas: t.title, pic: t.owner || "", deadline: t.due ? fmtDay(t.due) : "", ids: t.source.objectIds || [] });
    const totalVotes = stickies.reduce((n, o) => n + Board.votesFor(o).count, 0);
    const name = (b.name || "Rapat").replace(/^Contoh · /, "");
    const ringkasan = `Rapat “${name}” membahas ${frames.length ? frames.length + " bagian (" + frames.map((f) => f.text.replace(/^\d+\s*·\s*/, "")).join(", ") + ")" : "isi papan"}. Tercatat ${stickies.length} ide${totalVotes ? `, ${totalVotes} vote` : ""}, ${keputusan.length} keputusan, dan ${aksi.length} tugas yang belum selesai.`;
    return {
      ringkasan,
      topik: frames.map((f) => f.text.replace(/^\d+\s*·\s*/, "")),
      ide: ide.map((o) => o.text),
      keputusan,
      terpilih: picked.map((o) => `${o.text}${Board.votesFor(o).count ? ` (${Board.votesFor(o).count} vote)` : ""}`),
      pertanyaan: [...new Set(pertanyaan)],
      aksi,
      langkah: aksi.length ? [`Bagi ${aksi.length} tugas ke PIC dan pasang tenggat`, keputusan.length ? "Kabari tim yang tidak ikut rapat soal keputusan di atas" : "Tentukan keputusan yang masih terbuka", "Jadwalkan cek progres minggu depan"] : ["Tentukan tugas dari ide yang terpilih"],
    };
  }
  return { cluster, duplicates, prompts, parseDate, parseTask, channels, brandCheck, campaignDraft, recap, inside };
})();
