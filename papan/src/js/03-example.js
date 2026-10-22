// Example Brandlab data for a MADE-UP brand. In the real feature these widgets read the brand's own
// Brand DNA, Brand Book, campaigns, content, tasks, Insights and Pelacak Penjualan.
const LOGO_SVG = (fg = "#3B2418", acc = "#E2683C") => `<svg viewBox="0 0 220 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22h30v14a15 15 0 01-30 0z"/><path d="M40 26h5a6 6 0 010 12h-5"/><path d="M6 56c6-4 12-4 18 0s12 4 18 0"/></g><path d="M22 8c-3 3 3 6 0 9" stroke="${acc}" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="62" y="30" font-family="DM Serif Display, Georgia, serif" font-size="26" fill="${fg}">Kopi</text><text x="62" y="56" font-family="DM Serif Display, Georgia, serif" font-size="26" fill="${acc}">Tepian</text></svg>`;
const MARK_SVG = (fg = "#3B2418", acc = "#E2683C") => `<svg viewBox="0 0 52 64" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22h30v14a15 15 0 01-30 0z"/><path d="M36 26h5a6 6 0 010 12h-5"/><path d="M2 56c6-4 12-4 18 0s12 4 18 0"/></g><path d="M18 8c-3 3 3 6 0 9" stroke="${acc}" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`;

const LAB_BASE = {
  brand: { id: "kopi-tepian", name: "Kopi Tepian", tagline: "Ngopi pelan di tepi kota", color: "#C8875A" },
  dna: {
    visi: "Jadi tempat ngopi paling hangat di tepi Kali Brantas, tempat orang datang untuk pelan sejenak.",
    misi: "Menyajikan kopi lokal yang jujur rasanya, dengan suasana yang bikin orang betah dan ngobrol.",
    audiens: "Pekerja muda & mahasiswa 20–30 th di Kediri yang cari tempat kerja santai dan kopi enak di bawah Rp 30 rb.",
    kepribadian: ["Hangat", "Santai", "Jujur", "Sedikit jenaka"],
    nilai: ["Biji lokal Jawa Timur", "Harga masuk akal", "Ruang untuk ngobrol"],
    positioning: "Untuk anak muda Kediri yang butuh jeda, Kopi Tepian adalah kedai tepi sungai yang paling bikin betah, karena kopinya lokal, harganya jujur, dan suasananya pelan.",
    vp: "Kopi susu gula aren dari biji lokal, sore yang tenang di tepi sungai, Rp 22 rb.",
  },
  book: {
    colors: [
      { name: "Espresso", hex: "#3B2418", role: "Utama" },
      { name: "Kopi Susu", hex: "#C8875A", role: "Utama" },
      { name: "Krem", hex: "#F3E6D3", role: "Latar" },
      { name: "Daun", hex: "#4F7B5A", role: "Aksen" },
      { name: "Senja", hex: "#E2683C", role: "Aksen" },
    ],
    fonts: { display: "DM Serif Display", body: "Plus Jakarta Sans" },
    tone: { do: ["Ngobrol seperti teman", "Cerita kecil soal biji & proses", "Pakai 'kamu'"], dont: ["Teriak promo (WAJIB, BURUAN)", "Janji paling murah", "Bahasa kaku korporat"] },
    avoid: ["termurah", "paling murah", "wajib", "buruan", "murahan", "diskon gila", "gratis ongkir"],
  },
  campaigns: [
    { id: "c-ramadan", name: "Ramadan 2027: Buka Pelan", status: "plan", objective: "Naikkan transaksi sore (16.00–19.00) 30% selama Ramadan", audience: "Pekerja muda yang buka puasa di luar rumah", strategy: "Paket takjil + kopi, sesi ngabuburit di tepi sungai, konten cerita barista", channels: ["Instagram", "TikTok", "WhatsApp"], start: "2027-02-01", end: "2027-03-10", metrics: null },
    { id: "c-aren", name: "Kopi Susu Aren November", status: "ready", objective: "Kenalkan biji baru dari Dampit ke 2.000 orang", audience: "Mahasiswa sekitar kampus", strategy: "Sampling di kampus + konten 3 cara menikmati", channels: ["Instagram", "Offline"], start: "2026-11-01", end: "2026-11-30", metrics: null },
    { id: "c-ultah", name: "Ulang Tahun ke-3", status: "done", objective: "Ajak pelanggan lama datang lagi", audience: "Pelanggan setia", strategy: "Kode TEPIAN3 + mural tamu", channels: ["Instagram", "WhatsApp"], start: "2026-10-10", end: "2026-10-20", metrics: { reach: 18400, er: 9.1, leads: 312 } },
  ],
  content: [
    { id: "k1", title: "Behind the bar: seduh V60 biji Dampit", platform: "Instagram", date: "2026-10-24", status: "terjadwal", pic: "Admin IG" },
    { id: "k2", title: "3 cara menikmati kopi susu aren", platform: "TikTok", date: "2026-10-27", status: "produksi", pic: "Barista lead" },
    { id: "k3", title: "Sore di tepi sungai (carousel foto)", platform: "Instagram", date: "2026-10-30", status: "ide", pic: "Desainer" },
  ],
  tasks: [
    { id: "t1", title: "Rekap hasil kode TEPIAN3", owner: "Admin IG", due: "2026-10-23", done: true, priority: "sedang", campaignId: "c-ultah" },
    { id: "t2", title: "Hitung HPP paket takjil + kopi", owner: "Pemilik", due: "2026-11-05", done: false, priority: "tinggi", campaignId: "c-ramadan" },
    { id: "t3", title: "Foto menu Ramadan", owner: "Desainer", due: "2026-12-15", done: false, priority: "sedang", campaignId: "c-ramadan" },
  ],
  milestones: [
    { id: "m1", title: "Konsep Ramadan disetujui", due: "2026-11-15", progress: 40 },
    { id: "m2", title: "Menu & harga final", due: "2026-12-20", progress: 10 },
  ],
  growth: { weeks: ["2 Sep", "9 Sep", "16 Sep", "23 Sep", "30 Sep", "7 Okt", "14 Okt", "21 Okt"], followers: [4120, 4185, 4260, 4302, 4390, 4512, 4580, 4701], er: [6.1, 5.8, 7.2, 6.9, 8.4, 7.7, 9.1, 8.8], top: [{ title: "Behind the bar: seduh V60", er: 12.4 }, { title: "Kopi susu aren 3 cara", er: 10.1 }] },
  sales: { months: ["Mei", "Jun", "Jul", "Agu", "Sep", "Okt"], values: [38.2, 41.5, 40.1, 44.8, 47.3, 52.6], note: "Okt masih berjalan", link: { campaign: "Ulang Tahun ke-3", txt: "312 transaksi pakai kode TEPIAN3" } },
  people: ["Pemilik", "Admin IG", "Desainer", "Barista lead"],
};
const STICKY = { yellow: "#FFE27A", orange: "#FFC38B", pink: "#FFB3C7", violet: "#D6C4FF", blue: "#A8D8FF", green: "#B8F0C4", gray: "#E4E0D9", white: "#FFFFFF" };
const INKS = ["ink", "#ffa52b", "#ff6a5c", "#3ddc84", "#7ab8ff", "#b38cff", "#ff7eb6", "#8a8479"];
const inkColor = (c) => (c === "ink" || !c ? "var(--ink)" : c);
const STATUS_LABEL = { plan: "Perencanaan", ready: "Siap jalan", done: "Selesai", planning: "Perencanaan", active: "Berjalan", completed: "Selesai", archived: "Diarsipkan" };
const CSTATUS = ["ide", "produksi", "terjadwal", "terbit"];
