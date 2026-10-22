// Templates: each returns objects with local ids (L1, L2…) that insertObjects() remaps.
function TB() {
  const objs = []; let n = 0;
  const add = (o) => { o.id = "L" + (++n); objs.push(o); return o.id; };
  return {
    objs,
    frame: (x, y, w, h, title, color = "#ffa52b", ex = {}) => add({ type: "frame", x, y, w, h, text: title, color, ...ex }),
    sticky: (x, y, text, color = "yellow", ex = {}) => add({ type: "sticky", x, y, w: 200, h: 200, text, color, ...ex }),
    text: (x, y, w, text, fs = 17, ex = {}) => add({ type: "text", x, y, w, h: Math.round(fs * 1.5), text, fs, ...ex }),
    head: (x, y, w, text, fs = 40, ex = {}) => add({ type: "text", x, y, w, h: Math.round(fs * 1.25), text, fs, heading: true, ...ex }),
    shape: (x, y, w, h, shape, color, text = "", ex = {}) => add({ type: "shape", x, y, w, h, text, color, data: { shape, fill: true }, ...ex }),
    link: (a, b, ex = {}) => add({ type: "connector", x: 0, y: 0, w: 0, h: 0, color: "ink", data: { from: { id: a }, to: { id: b }, arrow: "end", style: "curve", dash: false, ...ex } }),
    table: (x, y, w, rows, title = "") => add({ type: "table", x, y, w, h: 40 + rows.length * 34, text: title, data: { rows } }),
    check: (x, y, w, title, items) => add({ type: "checklist", x, y, w, h: 80 + items.length * 30, text: title, data: { items: items.map((t) => (typeof t === "string" ? { t, done: false } : t)) } }),
    widget: (x, y, w, h, kind, ex = {}) => add({ type: "widget", x, y, w, h, data: { kind, mode: "live", ...ex } }),
    embed: (x, y, w, h, url, title, desc) => add({ type: "embed", x, y, w, h, data: { ...parseLink(url), title, desc } }),
  };
}
const B = LAB_BASE.book.colors;
const TEMPLATES = [
  { id: "brainstorm", name: "Sesi brainstorming", desc: "Satu pertanyaan, banyak ide, vote di akhir", icon: "bulb", build() {
    const t = TB();
    t.frame(0, 0, 1180, 640, "Ide", "#ffa52b");
    t.head(40, 36, 1100, "Bagaimana kalau kita…?", 40);
    t.text(40, 96, 900, "Ganti pertanyaan di atas. Satu ide = satu sticky. Jangan bantah dulu, tambahi saja.", 16, { color: "#8a8479" });
    ["yellow", "orange", "pink", "violet", "blue"].forEach((c, i) => t.sticky(40 + i * 224, 160, "", c));
    ["green", "yellow", "orange", "pink", "violet"].forEach((c, i) => t.sticky(40 + i * 224, 396, "", c));
    t.frame(1230, 0, 470, 640, "Parkir dulu", "#8a8479");
    t.text(1260, 40, 400, "Ide bagus, tapi bukan untuk sekarang. Taruh di sini supaya tidak hilang.", 15, { color: "#8a8479" });
    t.sticky(1260, 160, "", "gray"); t.sticky(1480, 160, "", "gray");
    t.frame(0, 690, 1700, 170, "Aturan main", "#3ddc84");
    ["Semua ide boleh", "Tambah, jangan bantah", "Banyak dulu, bagus nanti", "Tiap orang 3 vote"].forEach((s, i) => t.shape(40 + i * 410, 740, 370, 80, "pill", "#3ddc84", s));
    return t.objs; } },
  { id: "mindmap", name: "Mind map", desc: "Satu topik di tengah, cabang ke segala arah", icon: "share", build() {
    const t = TB();
    const c = t.shape(560, 330, 280, 140, "ellipse", "#ffa52b", "Topik utama");
    const pos = [[160, 80], [560, 20], [960, 80], [160, 640], [560, 700], [960, 640]];
    const cols = ["#7ab8ff", "#b38cff", "#ff7eb6", "#3ddc84", "#ffc94a", "#ff6a5c"];
    pos.forEach(([x, y], i) => { const b = t.shape(x, y, 260, 90, "rect", cols[i], `Cabang ${i + 1}`); t.link(c, b, { arrow: "none" }); });
    return t.objs; } },
  { id: "campaign", name: "Perencanaan campaign", desc: "Tujuan sampai KPI dalam satu papan", icon: "megaphone", build() {
    const t = TB();
    t.frame(0, 0, 520, 420, "Tujuan", "#ffa52b"); t.sticky(30, 40, "Contoh: naikkan transaksi sore 30% dalam 6 minggu", "yellow"); t.text(250, 50, 240, "Satu tujuan yang bisa diukur. Angka + waktu.", 15, { color: "#8a8479" });
    t.frame(560, 0, 520, 420, "Audiens", "#7ab8ff"); t.sticky(590, 40, "Siapa mereka?", "blue"); t.sticky(810, 40, "Apa yang mereka butuhkan?", "blue");
    t.frame(1120, 0, 520, 420, "Pesan utama", "#b38cff"); t.sticky(1150, 40, "Satu kalimat yang harus mereka ingat", "violet");
    t.frame(0, 470, 520, 420, "Channel", "#3ddc84"); t.check(30, 510, 460, "Pakai channel apa?", ["Instagram", "TikTok", "WhatsApp", "Offline / di toko"]);
    t.frame(560, 470, 520, 420, "Timeline", "#ffc94a"); t.table(590, 510, 460, [["Minggu", "Kegiatan", "PIC"], ["1", "", ""], ["2", "", ""], ["3", "", ""], ["4", "", ""]]);
    t.frame(1120, 470, 520, 420, "Budget & KPI", "#ff6a5c"); t.widget(1150, 510, 460, 360, "calc", { calc: { tab: "budget" } });
    return t.objs; } },
  { id: "social", name: "Rencana konten sosmed", desc: "Seminggu konten per platform + pilar", icon: "calendar", build() {
    const t = TB();
    t.frame(0, 0, 980, 420, "Minggu ini", "#ffa52b");
    t.table(30, 40, 920, [["Hari", "Feed IG", "Reels / TikTok", "Story"], ["Senin", "", "", ""], ["Rabu", "", "", ""], ["Jumat", "", "", ""], ["Minggu", "", "", ""]]);
    t.frame(1020, 0, 520, 420, "Pilar konten", "#b38cff");
    [["Edukasi", "blue"], ["Di balik layar", "orange"], ["Promo", "pink"], ["Komunitas", "green"]].forEach(([s, c], i) => t.sticky(1050 + (i % 2) * 230, 40 + Math.floor(i / 2) * 180, s, c, { h: 160 }));
    t.widget(0, 460, 520, 300, "content");
    return t.objs; } },
  { id: "brief", name: "Creative brief", desc: "Brief satu halaman untuk desainer/videografer", icon: "file", build() {
    const t = TB();
    t.frame(0, 0, 900, 640, "Creative brief", "#ffa52b");
    t.table(30, 40, 840, [["Bagian", "Isi"], ["Latar belakang", ""], ["Tujuan", ""], ["Audiens", ""], ["Insight", ""], ["Satu pesan utama", ""], ["Wajib ada", "Logo, warna Brand Book"], ["Deliverables", ""], ["Deadline & PIC", ""]]);
    t.widget(940, 0, 420, 400, "brandbook");
    return t.objs; } },
  { id: "workshop", name: "Workshop strategi brand", desc: "Dari posisi sekarang ke posisi yang dituju", icon: "dna", build() {
    const t = TB();
    t.widget(0, 0, 420, 520, "dna");
    t.frame(460, 0, 470, 520, "Kita hari ini", "#7ab8ff"); t.sticky(490, 40, "", "blue"); t.sticky(710, 40, "", "blue");
    t.frame(970, 0, 470, 520, "Kita mau jadi", "#3ddc84"); t.sticky(1000, 40, "", "green"); t.sticky(1220, 40, "", "green");
    t.frame(1480, 0, 470, 520, "Yang harus berubah", "#ff6a5c"); t.sticky(1510, 40, "", "pink"); t.sticky(1730, 40, "", "pink");
    return t.objs; } },
  { id: "competitor", name: "Analisis kompetitor", desc: "Bandingkan harga, kelebihan, konten", icon: "search", build() {
    const t = TB();
    t.frame(0, 0, 1100, 380, "Kompetitor", "#7ab8ff");
    t.table(30, 40, 1040, [["Nama", "Harga", "Kelebihan", "Kekurangan", "Konten andalan"], ["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]]);
    t.frame(1140, 0, 470, 380, "Peluang kita", "#3ddc84"); t.sticky(1170, 40, "Yang belum dilakukan siapa pun…", "green");
    return t.objs; } },
  { id: "journey", name: "Customer journey", desc: "Tahu, tertarik, beli, pakai, rekomendasi", icon: "map", build: null },
  { id: "retro", name: "Retrospektif campaign", desc: "Yang berhasil, kurang, dan dicoba lagi", icon: "refresh", build() {
    const t = TB();
    [["Berhasil", "#3ddc84", "green"], ["Kurang", "#ff6a5c", "pink"], ["Coba lagi", "#7ab8ff", "blue"]].forEach(([s, c, sc], i) => { t.frame(i * 500, 0, 460, 520, s, c); t.sticky(i * 500 + 30, 40, "", sc); t.sticky(i * 500 + 240, 40, "", sc); });
    t.check(0, 570, 460, "Aksi berikutnya", ["", ""]);
    return t.objs; } },
  { id: "weekly", name: "Rapat marketing mingguan", desc: "Angka, update, hambatan, keputusan, tugas", icon: "clock", build() {
    const t = TB();
    t.widget(0, 0, 440, 360, "growth");
    t.frame(480, 0, 440, 360, "Update tim", "#7ab8ff"); t.sticky(510, 40, "", "blue");
    t.frame(960, 0, 440, 360, "Hambatan", "#ff6a5c"); t.sticky(990, 40, "", "pink");
    t.frame(0, 410, 440, 340, "Keputusan", "#3ddc84"); t.sticky(30, 450, "", "green", { tag: "keputusan" });
    t.check(480, 410, 440, "Tugas minggu depan", ["", ""]);
    t.widget(960, 410, 440, 340, "tasks");
    return t.objs; } },
  { id: "workflow", name: "Alur produksi konten", desc: "Ide sampai terbit, kartu bergerak ke kanan", icon: "content", build() {
    const t = TB();
    const cols = [["Ide", "#8a8479"], ["Script", "#7ab8ff"], ["Produksi", "#ffc94a"], ["Edit", "#b38cff"], ["Review", "#ff7eb6"], ["Terbit", "#3ddc84"]];
    const f = cols.map(([s, c], i) => t.frame(i * 290, 0, 260, 620, s, c));
    f.slice(1).forEach((id, i) => t.link(f[i], id, { style: "straight" }));
    t.sticky(30, 40, "Contoh: 3 cara menikmati kopi susu aren", "yellow", { w: 200, h: 160 });
    return t.objs; } },
  { id: "moodboard", name: "Moodboard", desc: "Gambar, video, link, dan warna", icon: "image", build() {
    const t = TB();
    t.frame(0, 0, 1180, 700, "Moodboard", "#ff7eb6");
    for (let i = 0; i < 6; i++) t.shape(30 + (i % 3) * 380, 50 + Math.floor(i / 3) * 300, 350, 270, "rect", "#8a8479", "Tempel gambar, video, atau link di sini", { data: { shape: "rect", fill: false, dash: true } });
    B.forEach((c, i) => t.shape(1220, 20 + i * 130, 200, 110, "rect", c.hex, c.name, { data: { shape: "rect", fill: true, solid: true } }));
    t.text(1220, 700, 400, "Rasa yang dicari: …", 18, { bold: true });
    return t.objs; } },
  { id: "swot", name: "SWOT", desc: "Kekuatan, kelemahan, peluang, ancaman", icon: "grid", build() {
    const t = TB();
    [["Kekuatan", "#3ddc84", "green"], ["Kelemahan", "#ff6a5c", "pink"], ["Peluang", "#7ab8ff", "blue"], ["Ancaman", "#ffc94a", "yellow"]].forEach(([s, c, sc], i) => {
      const x = (i % 2) * 620, y = Math.floor(i / 2) * 480; t.frame(x, y, 580, 440, s, c); t.sticky(x + 30, y + 40, "", sc); t.sticky(x + 250, y + 40, "", sc); });
    return t.objs; } },
  { id: "review", name: "Review performa campaign", desc: "Angka asli + pelajaran + langkah berikut", icon: "chart", build() {
    const t = TB();
    t.widget(0, 0, 440, 420, "campaign", { ref: "c-ultah" });
    t.widget(480, 0, 440, 420, "growth");
    t.widget(960, 0, 440, 420, "sales");
    [["Yang berhasil", "#3ddc84", "green"], ["Pelajaran", "#ffc94a", "yellow"], ["Langkah berikutnya", "#7ab8ff", "blue"]].forEach(([s, c, sc], i) => { t.frame(i * 480, 470, 440, 320, s, c); t.sticky(i * 480 + 30, 510, "", sc); });
    return t.objs; } },
];
TEMPLATES.find((t) => t.id === "journey").build = function () {
  const t = TB();
  const st = ["Tahu", "Tertarik", "Beli", "Pakai", "Rekomendasi"];
  const pills = st.map((s, i) => t.shape(220 + i * 240, 0, 220, 64, "pill", ["#7ab8ff", "#b38cff", "#ffa52b", "#3ddc84", "#ff7eb6"][i], s));
  pills.slice(1).forEach((p, i) => t.link(pills[i], p, { style: "straight" }));
  [["Yang dilakukan", "yellow"], ["Yang dirasakan", "pink"], ["Peluang", "green"]].forEach(([r, c], j) => {
    t.text(0, 190 + j * 230, 200, r, 17, { bold: true });
    st.forEach((_, i) => t.sticky(230 + i * 240, 110 + j * 230, "", c));
  });
  return t.objs;
};

// The example board people land on: a made-up coffee shop planning Ramadan 2027.
function exampleBoard() {
  const t = TB();
  t.head(0, -150, 1500, "Ramadan 2027: Buka Pelan", 54);
  t.text(0, -78, 1100, "Papan contoh. Brand fiktif Kopi Tepian. Semua angka dan nama di sini contoh, bukan data asli.", 17, { color: "#8a8479" });
  t.frame(0, 0, 760, 600, "1 · Masalah & insight", "#7ab8ff");
  const s1 = t.sticky(30, 40, "Jam 16–18 kedai sepi, padahal itu jam ngabuburit", "yellow");
  t.sticky(260, 40, "Tiap Ramadan pelanggan tanya: ada takjil nggak?", "yellow", { tag: "pertanyaan" });
  t.sticky(490, 40, "Kompetitor cuma kasih diskon, belum ada yang jual suasana", "orange");
  t.sticky(30, 280, "Tepi sungai = tempat ngabuburit favorit warga", "green");
  t.sticky(260, 280, "Keputusan: fokus jam 16.00–19.00, bukan perang diskon", "green", { tag: "keputusan" });
  t.frame(820, 0, 1180, 600, "2 · Ide campaign", "#ffa52b");
  const p = t.sticky(850, 40, "Paket Buka Pelan: takjil + kopi susu aren Rp 35 rb", "yellow", { votes: { "contoh-1": 1, "contoh-2": 1, "contoh-3": 1 }, tag: "terpilih" });
  t.sticky(1080, 40, "Ngabuburit Session: akustik tiap Jumat sore di tepi sungai", "violet", { votes: { "contoh-1": 1, "contoh-2": 1 } });
  t.sticky(1310, 40, "Seri video barista: kopi dan cerita keluarga", "pink", { votes: { "contoh-3": 1 } });
  t.sticky(1540, 40, "Kartu stempel Ramadan: 5x datang, gratis 1 kopi", "blue", { votes: { "contoh-2": 1, "contoh-4": 1 } });
  t.sticky(850, 280, "Ajak 3 penjual takjil sekitar buka lapak di halaman", "orange");
  const d = t.sticky(1080, 280, "DISKON 50% SEMUA MENU! BURUAN!", "pink");
  t.sticky(1310, 280, "Konten 'jam berapa paling enak ngabuburit di Kediri?'", "violet");
  t.link(s1, p);
  t.frame(0, 680, 760, 560, "3 · Moodboard & referensi", "#ff7eb6");
  t.embed(30, 720, 420, 300, "https://www.youtube.com/watch?v=AI4ynXzkSQo", "Referensi gaya video: seduh V60", "Nada tenang, close-up tangan barista");
  t.embed(480, 720, 250, 190, "https://www.instagram.com/explore/tags/ngabuburit/", "#ngabuburit di Instagram", "Cari foto suasana sore");
  [["#3B2418", "Espresso"], ["#C8875A", "Kopi Susu"], ["#E2683C", "Senja"]].forEach(([c, nm], i) => t.shape(30 + i * 150, 1060, 130, 130, "rect", c, nm, { data: { shape: "rect", fill: true, solid: true } }));
  t.text(480, 940, 260, "Rasa: hangat, pelan, keemasan sore", 22, { hand: true });
  t.frame(820, 680, 1180, 560, "4 · Rencana & angka", "#3ddc84");
  t.widget(850, 720, 400, 400, "calc", { calc: { tab: "margin", hpp: 14500, harga: 35000 } });
  t.check(1280, 720, 340, "Sebelum 15 Nov", [{ t: "Uji rasa paket takjil @Barista lead", done: true }, { t: "Tanya 3 penjual takjil mau kolaborasi", done: false }, { t: "Draft konten teaser 20/11 @Admin IG", done: false }]);
  t.widget(1650, 720, 320, 400, "tasks");
  t.widget(2060, 0, 400, 520, "dna");
  t.widget(2060, 560, 400, 360, "campaign", { ref: "c-ramadan" });
  t.widget(2060, 960, 400, 380, "brandbook");
  return { objs: t.objs, comments: [{ ref: d, text: "Ini bertentangan sama 'harga jujur' di Brand DNA nggak?", name: "Admin IG (contoh)" }, { ref: d, text: "Setuju. Ganti jadi bonus kecil, bukan potongan harga.", name: "Pemilik (contoh)", reply: true }] };
}
