// Update Brandlab (owner, 2026-11-24: "mulai sekarang ada updates apapun
// sekecil apapun masuk di updates brandlab di pengumuman dan email sertakan
// tutorial dan screenshootnya").
//
// Every change people can notice gets one entry in UPDATES, written in the
// same commit as the change itself, so the post goes live with the feature
// and never before it:
//   { id: "YYYY-MM-DD-slug", kind: "feature"|"fix", title, body,
//     steps: ["…", "…"],                    the tutorial, one tap per line
//     images: [{ src: "/assets/announcements/<date>/….jpg", caption }],
//     link: "#/route", linkLabel }          where "Coba sekarang" goes
// tests/updates.test.mjs checks each one has a tutorial and screenshots
// that exist.
//
// After a deploy, api/cron/updates.js (every 10 minutes) posts each new
// entry to Pengumuman as announcements/upd-<id> — the page and its "Baru"
// dot pick it up live — and fixes a post whose entry was edited. Then,
// once a day between 09.00 and 20.00 WIB, everything posted since the last
// email goes out as ONE email (composeUpdatesEmail): one email a day at
// most, never one per small fix, and Resend's daily limit (shared with
// invoices and payment reminders) keeps room — at most MAIL_DAILY a day,
// the rest the next day, nobody twice.
//
// Pure: the cron does the reading and writing.

// Newest first: the first entry sits on top of Pengumuman. Pictures live in
// assets/announcements/<date>/ (1280×800 JPG, a phone shot on a 16:10 card).
const IMG = (name, caption) => ({ src: `/assets/announcements/2026-11-24/${name}.jpg`, caption });

export const UPDATES = [
  {
    id: "2026-11-24-antrean-video",
    kind: "feature",
    title: "Antrean Video sekarang bisa dipakai semua akun",
    body: "Taruh video yang sudah jadi di Antrean Video, langsung di brand kamu. Videonya disimpan di Google Drive kamu sendiri.\n\n- Tiap konten punya kode video (misalnya KP-6), jadi gampang dicari\n- Tulis catatan revisi tepat di detik yang mau diubah\n- Status kelihatan jelas: Belum ada video, Perlu dicek, Direvisi, Siap, Terjadwal, Sudah tayang",
    steps: [
      "Buka **Create**, lalu pilih **Antrean Video**.",
      "Pertama kali, tekan **Hubungkan Google Drive** dan pilih akun Google kamu. Cukup sekali.",
      "Buka kontennya, lalu tekan **Pilih video** (atau seret file MP4/MOV ke kotaknya).",
      "Putar videonya. Berhenti di bagian yang mau diubah, tulis catatannya, lalu tekan **Tambah catatan**.",
      "Sudah oke? Tekan **Setujui**. Videonya pindah ke **Siap upload**.",
    ],
    images: [
      IMG("antrean-galeri", "Semua video brand kamu di satu galeri, lengkap dengan statusnya."),
      IMG("antrean-catatan", "Catatan revisi menempel di detik videonya (di sini 0:04)."),
    ],
    link: "#/go/content/antrean",
    linkLabel: "Buka Antrean Video",
  },
  {
    id: "2026-11-24-siap-upload",
    kind: "feature",
    title: "Siap upload: video, caption, dan thumbnail di satu tempat",
    body: "Di Antrean Video sekarang ada tab **Siap upload**. Semua yang kamu butuhkan buat posting ada di satu kartu, jadi tidak perlu bolak-balik.\n\n- Unduh video final (di HP: langsung simpan ke galeri)\n- Salin caption dan hashtag sekali ketuk\n- Unduh atau ganti thumbnail\n- Tandai **Sudah tayang** setelah diposting",
    steps: [
      "Buka **Antrean Video**, lalu pilih tab **Siap upload**.",
      "Tekan **Unduh video**. Di HP, tekan **Simpan video ke HP** supaya masuk ke galeri.",
      "Tekan **Unduh thumbnail** untuk sampulnya, atau **Ganti thumbnail** kalau mau pakai gambar lain.",
      "Tekan **Salin caption** dan **Salin hashtag**, lalu tempel waktu posting di Instagram.",
      "Setelah tayang, tekan **Sudah tayang**. Kalau mau, tempel link postingannya lewat **Tambah link postingan**.",
    ],
    images: [
      IMG("siap-upload", "Tab Siap upload di laptop."),
      IMG("siap-upload-hp", "Di HP: Simpan video ke HP, lalu salin caption."),
    ],
    link: "#/go/content/antrean",
    linkLabel: "Buka Siap upload",
  },
  {
    id: "2026-11-24-create-upload",
    kind: "feature",
    title: "Di Create juga bisa unduh video dan upload",
    body: "Kalau kamu kerja dari **Creator**, tidak perlu pindah ke Antrean Video. Di tahap **Upload**, video final, thumbnail, judul, dan caption sudah siap diambil.",
    steps: [
      "Buka **Create**, lalu **Creator**, dan pilih kontennya.",
      "Pilih tahap **5 Upload** di bagian atas.",
      "Tekan **Unduh video**, **Unduh thumbnail**, dan **Salin caption**.",
      "Posting di Instagram, lalu tekan **Sudah aku posting**.",
    ],
    images: [IMG("create-upload", "Tahap Upload di Creator: semua bahan posting dalam satu kotak.")],
    link: "#/go/content/creator",
    linkLabel: "Buka Creator",
  },
  {
    id: "2026-11-24-peran-tim",
    kind: "feature",
    title: "Peran tim: pilih siapa bisa apa",
    body: "Sekarang ada 5 peran untuk anggota tim, masing-masing dengan ikon dan warna sendiri: **Admin**, **Content Creator**, **Editor & Sosmed**, **Sales**, dan **Viewer (lihat saja)**. Ada juga **Klien** untuk klienmu.\n\nAksesnya benar-benar dikunci, bukan cuma menunya yang disembunyikan. Misalnya Editor & Sosmed tidak bisa melihat angka penjualan.",
    steps: [
      "Buka **Pengaturan**, lalu **Tim**, dan tekan **Undang anggota**.",
      "Isi email anggota dan pilih brand yang dibagikan.",
      "Pilih perannya. Penjelasan singkat tiap peran muncul di bawahnya.",
      "Tekan **Kirim undangan**.",
      "Mau atur lebih detail? Di dalam brand, tekan ikon **tambah orang** di kanan atas, lalu **Atur akses** di samping nama anggota.",
    ],
    images: [
      IMG("undang-peran", "Pilih peran waktu mengundang anggota."),
      IMG("tim-peran", "Peran tiap anggota kelihatan dari ikon dan warnanya."),
      IMG("atur-akses", "Atur akses: pilih level untuk tiap bagian Brandlab."),
    ],
    link: "#/settings/team",
    linkLabel: "Buka Pengaturan Tim",
  },
  {
    id: "2026-11-24-panduan-peran",
    kind: "feature",
    title: "Panduan peran: lihat tiap peran bisa apa",
    body: "Bingung pilih peran? Sekarang ada **Panduan peran**. Klik salah satu peran untuk melihat apa yang bisa dan tidak bisa dilakukan, plus tabel perbandingan semua peran.",
    steps: [
      "Tekan **Apa bedanya tiap peran?** Tautan ini ada di dialog Bagikan, di menu pilih peran, di Pengaturan Tim, dan di Atur akses.",
      "Klik nama peran di bagian atas untuk melihat daftar **Bisa** dan **Tidak bisa**.",
      "Geser ke bawah untuk tabel semua peran. Di HP, tabelnya bisa digeser ke samping.",
      "Anggota tim bisa membuka panduan ini dari chip **Kamu di sini sebagai …** di Beranda.",
    ],
    images: [
      IMG("panduan-peran", "Klik peran, langsung kelihatan bisa apa saja."),
      IMG("panduan-tabel", "Tabel perbandingan semua peran."),
    ],
    link: "#/settings/team",
    linkLabel: "Buka Pengaturan Tim",
  },
  {
    id: "2026-11-24-klien",
    kind: "feature",
    title: "Kirim video ke klien lewat Brandlab",
    body: "Sekarang kamu bisa mengundang klien ke brand-nya. Revisi di dalam tim tetap di tim. Klien baru melihat videonya setelah kamu tekan **Kirim ke klien**.\n\n- Klien bisa melihat semua isi brand, tapi tidak bisa mengubah apa pun\n- Di Antrean Video, klien menonton, memberi catatan revisi per detik, dan menyetujui\n- Video untuk klien disimpan di Google Drive milik klien",
    steps: [
      "Buka **Pengaturan**, lalu **Tim**, tekan **Undang anggota**, dan pilih peran **Klien**.",
      "Klien membuka Brandlab dan menghubungkan Google Drive-nya di **Antrean Video**.",
      "Upload video dan revisi bareng tim seperti biasa, lalu tekan **Setujui**.",
      "Di video yang sudah disetujui, tekan **Kirim ke klien**.",
      "Klien menonton, memberi catatan atau menyetujui. Catatannya langsung masuk ke kamu.",
    ],
    images: [
      IMG("klien-kirim", "Kirim ke klien muncul setelah video disetujui tim."),
      IMG("klien-panduan", "Klien bisa melihat semua, tapi tidak bisa mengubah apa pun."),
    ],
    link: "#/settings/team",
    linkLabel: "Undang klien",
  },
  {
    id: "2026-11-24-uang-per-konten",
    kind: "feature",
    title: "Lihat uang yang dihasilkan tiap konten",
    body: "Di **Pelacak Penjualan** sekarang ada kartu **Konten yang menghasilkan uang**. Kamu bisa lihat konten mana yang benar-benar menjual, berapa biaya produksinya, dan apakah iklannya balik modal.\n\n- **ROAS iklan**: uang dari iklan dibagi biaya iklan\n- **Balik modal konten organik**: uang dari konten dibagi biaya produksi\n- Penjualan dipisah: pasti, perkiraan, dan belum diketahui, jadi angkanya tidak dihitung dobel",
    steps: [
      "Buka **Pelacak Penjualan**, lalu tekan **Catat Pemasukan**.",
      "Pilih produknya, lalu di **Dari mana** pilih **Konten sosmed** atau **Iklan (Ads)**.",
      "Di **Dari konten yang mana?** pilih kontennya. Kalau kamu cuma menebak, centang **Sumbernya cuma perkiraan**.",
      "Isi **Biaya produksi** tiap konten di kartu **Konten yang menghasilkan uang**.",
      "Biaya iklan dicatat lewat **Catat Pengeluaran**, pilih **Iklan & promosi**, lalu pilih kontennya.",
    ],
    images: [
      IMG("sales-konten", "ROAS, balik modal, dan ROI tiap konten."),
      IMG("sales-catat", "Waktu mencatat penjualan, pilih konten asalnya."),
    ],
    link: "#/go/sales",
    linkLabel: "Buka Pelacak Penjualan",
  },
  {
    id: "2026-11-24-billboard",
    kind: "feature",
    title: "Wepeka Billboard sekarang ada di Brandlab",
    body: "Berita branding dan marketing terbaru dari Wepeka Billboard sekarang bisa dibaca langsung di Brandlab. Berita terbaru juga muncul sebagai banner di Beranda.",
    steps: [
      "Lihat banner **Wepeka Billboard** di Beranda, lalu tekan **Baca di Wepeka Billboard**.",
      "Atau buka menu titik tiga di kanan atas, lalu pilih **Wepeka Billboard**.",
      "Tidak mau lihat bannernya? Tekan **✕**. Banner muncul lagi kalau ada berita baru.",
    ],
    images: [
      IMG("billboard-beranda", "Banner berita terbaru di Beranda."),
      IMG("billboard-halaman", "Halaman Wepeka Billboard di Brandlab."),
    ],
    link: "#/billboard",
    linkLabel: "Buka Wepeka Billboard",
  },
  {
    id: "2026-11-24-status-video-daftar",
    kind: "feature",
    title: "Status video kelihatan di Daftar Konten",
    body: "Di **Daftar Konten**, di bawah status tiap konten sekarang ada kode video dan status videonya (misalnya **KP-3 · Terjadwal 07:00**). Jadi kamu langsung tahu video mana yang belum siap.",
    steps: [
      "Buka **Create**, lalu **Daftar Konten**.",
      "Pilih platformnya, misalnya **Reels**.",
      "Lihat kolom **Status**: kode dan status video ada di bawahnya.",
    ],
    images: [IMG("daftar-konten-status", "Kode dan status video di bawah status konten.")],
    link: "#/go/content/list",
    linkLabel: "Buka Daftar Konten",
  },
  {
    id: "2026-11-24-cara-pakai-update",
    kind: "feature",
    title: "Tiap update sekarang ada cara pakai dan screenshot",
    body: "Mulai sekarang, setiap update Brandlab sekecil apa pun masuk ke **Pengumuman**, lengkap dengan cara pakai langkah demi langkah, contoh tampilannya, dan tombol yang langsung membuka halamannya.\n\nUpdate yang sama juga dikirim lewat email, paling banyak sekali sehari.",
    steps: [
      "Tekan **Update** (ikon lonceng) di kanan atas, lalu **Lihat semua**. Di HP, ada di menu titik tiga.",
      "Baca bagian **Cara pakai** di tiap update.",
      "Tekan tombol di bawahnya untuk langsung membuka halamannya.",
      "Tidak mau terima emailnya? Buka **Pengaturan**, lalu **Pengingat**, dan matikan **Email pengumuman**.",
    ],
    images: [
      IMG("pengumuman-cara-pakai", "Cara pakai dan screenshot di tiap update."),
      IMG("email-update", "Email update: semua update hari itu dalam satu email."),
    ],
    link: "#/updates",
    linkLabel: "Buka Pengumuman",
  },
  {
    id: "2026-11-24-hp-halaman-pas",
    kind: "fix",
    title: "Pengumuman dan Pengaturan pas di layar HP",
    body: "Di HP, halaman di luar brand (Pengumuman, Pengaturan, Wepeka Billboard) tadinya sedikit lebih lebar dari layar, jadi tampilannya mengecil. Sekarang sudah pas.",
    steps: [
      "Buka Brandlab di HP.",
      "Buka **Pengumuman** atau **Pengaturan**. Halamannya sekarang pas di layar, tidak perlu di-zoom.",
    ],
    images: [IMG("hp-pengumuman-pas", "Pengumuman di HP, pas selebar layar.")],
    link: "#/updates",
    linkLabel: "Buka Pengumuman",
  },
];

export const DOC_PREFIX = "upd-";
export const docIdOf = (u) => `${DOC_PREFIX}${u.id}`;
// Email window (WIB) and how many update emails a day may use.
export const MAIL_FROM_HOUR = 9;
export const MAIL_TO_HOUR = 20;
export const MAIL_DAILY = 80;

const WIB_MS = 7 * 3600 * 1000;
export const wibDay = (ms) => new Date(ms + WIB_MS).toISOString().slice(0, 10);
export const wibHour = (ms) => new Date(ms + WIB_MS).getUTCHours();
export const inMailWindow = (ms) => wibHour(ms) >= MAIL_FROM_HOUR && wibHour(ms) < MAIL_TO_HOUR;

// A short fingerprint of what a post shows, so an edited entry updates it.
export function hashOf(u) {
  const s = JSON.stringify([u.kind, u.title, u.body, u.steps, u.images, u.link, u.linkLabel]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

// The fields of a post (announcements/{id}, read by js/announcements.js).
export function postFields(u) {
  return {
    kind: u.kind === "fix" ? "fix" : "feature",
    title: String(u.title || "").trim().slice(0, 140),
    body: String(u.body || "").trim().slice(0, 4000),
    steps: (u.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10),
    images: (u.images || []).filter((x) => x?.src).slice(0, 6).map((x) => ({ src: String(x.src), caption: String(x.caption || "") })),
    link: String(u.link || ""),
    linkLabel: String(u.linkLabel || ""),
    source: "updates",
    updateId: u.id,
    hash: hashOf(u),
  };
}

// What to write. `existing`: { docId: data } of the posts already there.
// New ones are posted oldest first, a millisecond apart, so the newest
// entry (first in UPDATES) sits on top of Pengumuman.
// → { create: [{ id, data }], change: [{ id, patch }] }
export function planUpdatePosts(updates, existing, now) {
  const create = [];
  const change = [];
  const fresh = [...updates].reverse().filter((u) => !existing[docIdOf(u)]);
  fresh.forEach((u, i) => create.push({ id: docIdOf(u), data: { ...postFields(u), createdAt: now + i, updatedAt: now + i, authorUid: "brandlab" } }));
  for (const u of updates) {
    const had = existing[docIdOf(u)];
    if (had && had.hash !== hashOf(u)) change.push({ id: docIdOf(u), patch: { ...postFields(u), updatedAt: now } });
  }
  return { create, change };
}

// Whether the email may go now, and which: `state` is mailings/updates-digest
// ({ day, ids, sentTo, total, sentToday: { day, n } }); `unmailed` the update
// posts nobody was emailed yet (newest first).
// → { mode: "continue" | "start" | "none", budget, why }
export function digestStep(state, unmailed, now, { daily = MAIL_DAILY } = {}) {
  if (!inMailWindow(now)) return { mode: "none", why: "window" };
  const today = wibDay(now);
  const usedToday = state?.sentToday?.day === today ? state.sentToday.n || 0 : 0;
  const budget = Math.max(0, daily - usedToday);
  if (!budget) return { mode: "none", why: "budget" };
  const pending = state?.ids?.length && state.total != null && (state.sentTo || []).length < state.total;
  if (pending) return { mode: "continue", budget };
  if (state?.day === today) return { mode: "none", why: "today" };
  if (!unmailed.length) return { mode: "none", why: "nothing" };
  return { mode: "start", budget };
}
