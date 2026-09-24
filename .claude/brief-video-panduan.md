# Brief Video Panduan Brandlab — 6 video (22 Sep 2026)

Struktur: 1 video Kenalan (autoplay setelah bumper "Hi {nama}, welcome to Brandlab") + 1 video per app:
Brand Builder, Campaign, Content OS, Copy Studio, Pelacak Penjualan.

Registry: `js/guide-videos.js` → `GUIDE_VIDEOS` (6 entri). Tombol Video ada di 11 halaman; halaman di dalam
satu app membuka video app itu **di chapter halamannya** (`GUIDE_TO_VIDEO[...].start`, detik). Setelah rekam,
isi `start` dengan timestamp asli dan samakan `seconds` dengan durasi asli.

Publish = ganti `src` entri dengan link YouTube (unlisted boleh) / Vimeo / .mp4. Timestamp otomatis dipakai
(`?start=` YouTube, `#t=` Vimeo/mp4).

## Aturan umum rekaman
- Screen recording desktop 16:9, cursor terlihat, zoom ke tombol saat disebut. VO jelas, tanpa musik keras.
- Bahasa santai "kamu", sama seperti copy app. Satu kalimat = satu aksi di layar.
- Tiap video ditutup dengan kalimat yang sama: **"Kalau mau dipandu langsung di halamannya, klik tombol Panduan di sebelah tombol Video."**
- Pakai brand demo yang datanya sudah terisi (Brand DNA, warna, 1 campaign, beberapa konten) supaya layar tidak kosong.
- Jangan tunjukkan token/harga, dan jangan tunjukkan tombol AI thumbnail (saat ini selalu gagal).
- Di video per app, tiap chapter mulai dengan kalimat pembuka yang berdiri sendiri, karena penonton bisa masuk dari tengah.

## Urutan produksi
1. Kenalan (autoplay hanya untuk akun baru, sekali; selebihnya lewat menu ? > Video perkenalan — paling banyak ditonton)
2. Content OS (dipakai tiap hari)
3. Brand Builder
4. Campaign
5. Copy Studio
6. Pelacak Penjualan

---

## 1. Kenalan sama Brandlab — talking head (±90 detik)
Key: `kenalan`. Muncul: autoplay setelah bumper welcome saat akun baru pertama dibuka (sekali), lalu lewat tombol Video di Beranda dan menu ? > Video perkenalan. Video yang sama dipakai sebagai iklan (ending iklan) dan potongan 15 detik (dua paragraf pertama + "Mulai di wepeka.com").

Format: satu take talking head ke kamera, tanpa footage/montase. Insert layar app opsional. HP di tripod setinggi mata, dekat jendela. Rekam dua ending berurutan di take yang sama.

Psikologi: kontras sebelum/sesudah, jobs-to-be-done ("grow brand"), activation energy rendah, endowment ("brand kamu", "sistem kamu"), goal-gradient. Tanpa klaim angka/testimoni.

Script:
> Aku mau nanya. Kamu punya usaha, produknya bagus, tapi tiap mau bikin konten… bengong, kan? Posting hari ini, minggu depan hilang. Brand-nya jalan di tempat.
> Aku ngerti banget, karena aku pernah di situ. Dan masalahnya bukan kamu kurang niat. Masalahnya kamu belum punya sistem.
> Makanya aku bikin Wepeka Brandlab. Intinya satu: sistem buat grow brand kamu. Dari nentuin brand kamu itu sebenarnya siapa, sampai kontennya terbit dan angkanya kelihatan naik. Semua di satu tempat. Dan AI-nya kenal brand kamu, bukan AI yang nulis template umum.
> Mulainya gampang. Kamu ceritain usahamu sekali, pakai bahasamu sendiri. Dari situ Brandlab nyusun Brand DNA kamu: siapa pelangganmu, apa masalah mereka, kenapa mereka harus pilih kamu. Pilih warna, pilih font, Brand Book kamu jadi. Tentukan tujuan, misalnya naikin followers, dan Brandlab pecah jadi level-level kecil, jadi kamu selalu tahu minggu ini harus ngapain. Terus tinggal bikin konten. Kamu bilang mau ngomongin apa, AI tulisin hook, script, caption. Baca, rekam, terbit.
> Dan ini yang paling aku suka. Tiap kamu buka Brandlab, dia kasih satu langkah paling penting hari ini. Kamu nggak perlu mikir dari nol lagi. Tiap konten yang terbit otomatis dihitung ke tujuanmu. Level naik, angkanya kelihatan, dan kamu lihat sendiri brand kamu tumbuh, minggu demi minggu.
> Brand besar nggak tumbuh karena beruntung. Mereka tumbuh karena punya sistem. Sekarang kamu juga bisa.

Ending di dalam app:
> Dan kamu udah di dalamnya. Di tiap halaman ada tombol Video sama Panduan kalau butuh arahan. Sekarang, mulai dari langkah satu: bikin brand kamu. Sampai ketemu di dalam.

Ending iklan:
> Wepeka Brandlab. Sistem buat grow brand kamu. Mulai hari ini di wepeka.com.

Kalau bagian "cara mulai" terasa panjang, potong kalimat Brand Book.

---

## 2. Brand Builder: Brand DNA & Guidelines — ±2,5 menit
Key: `brand-builder`. Muncul: hub Brand Builder, Brand DNA (dari awal), Brand Guidelines (chapter 2, `start: 80`).

### Chapter 1 — Brand DNA (0:00–1:20)
Layar: hub dua pintu → 7 langkah → "Isi semua pakai AI" → langkah compose + "Gabungkan jadi satu jawaban" → Review → Simpan.

Script:
> Brand Builder itu fondasi brand kamu, dua bagian: Brand DNA, siapa kamu dan kenapa orang harus pilih kamu. Brand Guidelines, tampilan brand kamu. Dua-duanya dibaca AI tiap kali nulis konten, jadi isi sekali, kepakai terus.
> Mulai dari Brand DNA. Tujuh langkah, satu pertanyaan per langkah. Pelanggan kamu siapa dan mereka pengen apa. Masalah apa yang bikin mereka pusing. Kenapa mereka harus percaya kamu. Gampangnya mereka mulai dari mana. Ajakan kamu apa. Apa yang berubah buat mereka. Terakhir, identitas: tagline, nilai, produk, tujuan.
> Nggak mau ngetik satu-satu? Klik "Isi semua pakai AI". AI baca deskripsi brand kamu dan mengisi semuanya, kamu tinggal koreksi.
> Kalau isi manual, di beberapa langkah ada dua kotak. Isi keduanya, lalu klik "Gabungkan jadi satu jawaban" supaya tombol Lanjut aktif. Jawaban tersimpan tiap klik Lanjut, jadi aman berhenti di tengah.
> Di akhir ada Review, semua bisa diedit langsung. Klik Simpan. Brand DNA kamu jadi, bisa diunduh PDF juga.

### Chapter 2 — Brand Guidelines (1:20–2:30)
Layar: baris tab → tab Warna: chip kesan → palet jadi → tab Tipografi: "Pakai kombinasi ini" → preview Brand Book → Review & PDF.

Script:
> Sekarang Brand Guidelines: logo, warna, font, gaya visual, dan cara ngomong. Hasil akhirnya Brand Book yang bisa diunduh PDF.
> Tab-nya bebas urutan. Yang wajib buat mulai cuma dua: Warna dan Tipografi.
> Tab Warna: jawab satu pertanyaan, brand kamu mau kasih kesan apa. Klik satu kesan, palet langsung jadi. Mau atur sendiri? Pilih rumus warna atau ketik kode warnamu.
> Tab Tipografi: pilih rasa font yang kamu mau, klik "Pakai kombinasi ini". Selesai.
> Preview di kanan itu Brand Book kamu, berubah langsung tiap kamu pilih sesuatu. Logo, arah visual, dan tone of voice bisa dilengkapi kapan saja.
> Sudah puas, buka tab Review dan simpan Brand Book-nya.

---

## 3. Campaign: tujuan besar, dipecah per level — ±2 menit
Key: `campaign`. Muncul: daftar Campaign (dari awal), detail campaign (chapter 2, `start: 30`), Brainstorm (chapter 3, `start: 95`).

### Chapter 1 — Bikin campaign (0:00–0:30)
Layar: Campaign Baru → 3 template → aturan main → pilih level → nama → buat.

Script:
> Campaign itu tujuan besar, misalnya naikin followers Instagram. Brandlab memecahnya jadi level kecil supaya jelas minggu ini harus ngapain.
> Klik Campaign Baru, pilih template yang paling dekat: Grow Social Media, Personal Branding, atau Event. Baca aturan mainnya, karena itu cara progres kamu dihitung. Baru pertama? Pilih mulai dari Mission 1. Kasih nama, buat.

### Chapter 2 — Baca halaman detail (0:30–1:35)
Layar: angka utama → kartu "Langkah berikutnya" → tangga level → milestone + tombol sumbernya → "Catat angka manual".

Script:
> Ini halaman detail campaign. Paling atas, angka utama: target terpenting di level ini. Di bawahnya kartu Langkah Berikutnya. Sistem baca campaign, konten, dan datamu, lalu kasih satu langkah paling penting sekarang. Tombolnya bawa kamu ke alat yang tepat, dan di sana ada tombol balik ke campaign ini.
> Tangga level: level naik otomatis begitu semua milestone wajib tercapai. Tiap milestone punya sumber: dihitung otomatis dari konten yang terbit, dari Instagram Insights, atau dicatat manual. Tiap baris punya tombolnya sendiri, kamu nggak ngetik angka sembarangan di sini.
> Semua konten yang kamu terbitkan buat brand ini otomatis dihitung ke campaign, nggak perlu di-link manual.

### Chapter 3 — Brainstorm (1:35–2:00)
Layar: tombol Brainstorm di campaign → obrolan: AI bertanya, user tap jawaban → ide muncul → Simpan → "Buat draft" ke Creator → tombol "langsung 3 ide".

Script:
> Bingung mau bikin konten apa? Klik Brainstorm. AI yang bertanya, kamu tinggal tap jawabannya. Beberapa pertanyaan, lalu ide muncul. Buru-buru? Klik "Lewati pertanyaan, langsung 3 ide".
> Ide yang pas, Simpan. Dari ide tersimpan, klik Buat Draft, kamu langsung dibawa ke Creator dengan ide itu sudah terisi.
> Ritme campaign: cek level, brainstorm, tulis di Creator, jadwalkan, terbit, lalu perbarui angka tiap minggu.

---

## 4. Content OS: nulis, jadwalkan, baca hasil — ±3 menit
Key: `content-os`. Muncul: Creator (dari awal), Kalender (chapter 2, `start: 80`), Semua konten & Dashboard (chapter 3, `start: 135`).

### Chapter 1 — Creator Studio (0:00–1:20)
Layar: empat tab Content OS → Konten Baru → modal platform → modal AI (prompt, tujuan) → hasil (hook, script, caption) → form draf → teleprompter → centang "Ide selesai" → Syuting → Editing → Siap upload → Terbit.

Script:
> Content OS itu tempat konten dikerjakan. Empat tab: Creator buat nulis, Kalender buat jadwal, Semua Konten buat lihat semuanya, Dashboard buat hasilnya.
> Mulai dari Creator. Semua konten lahir dari tombol Konten Baru. Pilih platform: Instagram, TikTok, atau Mirror kalau video yang sama mau naik ke dua-duanya.
> Ceritakan kontennya mau ngomongin apa, boleh garis besar, boleh pakai mic. Pilih tujuannya: bikin orang kenal, percaya, atau beli. Ini mengubah cara AI nulis. Klik Generate.
> AI sudah baca Brand DNA, tone of voice, dan campaign aktif kamu. Pilih hook yang paling kena, Pakai script, Pakai caption. Semua masuk ke form, masih bisa diedit, tersimpan otomatis.
> Naskah beres? Centang "Ide selesai". Konten pindah ke tahap syuting: tampilannya cuma script dan satu tombol besar. Buka teleprompter, baca sambil rekam, klik Selesai syuting. Lalu Selesai editing. Terakhir centang platform tempat kamu posting, klik Selesai. Konten otomatis Terbit.
> Ritmenya selalu sama: Ide, AI, Syuting, Editing, Upload, Terbit.

### Chapter 2 — Kalender (1:20–2:15)
Layar: Bank Konten → drag ke tanggal → klik tanggal kosong → pilih dari daftar → Jadwal Kerja → Jadwal Otomatis AI → tinjau → konfirmasi → tampilan Minggu.

Script:
> Kalender itu tempat konten dapat tanggal. Bank Konten di samping berisi konten yang belum dijadwalkan.
> Dua cara: seret kartu dari Bank ke tanggal, atau klik kotak tanggal kosong dan pilih dari daftar. Yang kedua enak di HP. Konten di kalender bisa diseret ke hari lain, atau klik kartunya buat edit.
> Tombol Jadwal Kerja adalah otak penjadwalan: hari syuting, hari edit, hari upload, maksimal berapa konten per hari. Atur sekali, sistem dan AI membacanya.
> Males nyusun satu-satu? Klik Jadwal Otomatis AI. AI baca campaign aktif, tahap tiap konten, dan Jadwal Kerja kamu. Hasilnya usulan dulu, tinjau, lalu konfirmasi.
> Rutinitasnya: bikin di Creator, taruh di Kalender, kerjakan sesuai hari kerjamu.

### Chapter 3 — Semua Konten & Dashboard (2:15–3:00)
Layar: tab Semua konten: "Mau cek apa?", tabel → drawer editor → tab Dashboard: konten terbit, engagement, tren → Pengaturan tolok ukur.

Script:
> Tab Semua Konten: mulai dari pertanyaan "mau cek apa", tabelnya menyesuaikan. Tiap baris satu konten dengan tujuan, tahap, platform, dan performanya. Klik baris buat buka editor di samping: ubah judul, tanggal, tahap, atau isi angka hasilnya.
> Tab Dashboard merangkum konten yang terbit: berapa yang terbit, rata-rata engagement, konten mana yang paling jalan, dan trennya. Angka di sini juga yang dipakai Campaign buat menilai milestone. Warna sehat atau tidaknya mengikuti tolok ukur di Pengaturan.
> Kebiasaan yang bikin dashboard berguna: tiap konten terbit, isi angkanya seminggu kemudian. Sekali seminggu cukup.

---

## 5. Copy Studio: tulisan siap posting — ±60 detik
Key: `copy`. Muncul: Alat → Copy Studio.

Layar: pilih format (Threads, Story, WhatsApp, caption feed, lainnya) → pilih tujuan → isi pesan → Generate → 3 pilihan dengan preview → tulis ulang → Salin.

Script:
> Copy Studio buat tulisan pendek yang bukan video: post Threads, teks Story, broadcast WhatsApp, caption feed, atau format lain yang kamu tulis sendiri.
> Tiga pertanyaan. Satu, mau bikin tulisan buat apa. Tiap format beda bentuk dan batas karakternya. Dua, tujuannya: testimoni, promo, edukasi, cerita, event, atau interaksi. Tiga, mau nyampein apa.
> Klik Generate. AI nulis tiga pilihan pakai gaya bahasa brand kamu, lengkap dengan preview mirip aslinya.
> Kurang pas? Klik tulis ulang. Cocok? Edit seperlunya, lalu Salin.
> Hasilnya nggak disimpan, jadi salin dulu sebelum pindah halaman.

---

## 6. Pelacak Penjualan: catat tiap penjualan — ±60 detik
Key: `sales`. Muncul: Alat → Pelacak Penjualan.

Layar: tambah produk/layanan → Catat penjualan: pilih produk, jumlah, total otomatis → centang pembeli ulang → Angka Penting → grafik 8 minggu → saran AI → riwayat.

Script:
> Pelacak Penjualan cuma minta satu hal: catat tiap penjualan. Sisanya dihitung sendiri.
> Mulai dari apa yang kamu jual. Tambah produk atau layanan dengan harganya. Setelah itu mencatat penjualan cuma dua langkah: pilih produk, isi jumlah. Totalnya terisi otomatis dari harga dikali jumlah, boleh diubah ke angka sebenarnya kalau ada diskon atau harga proyek yang beda-beda.
> Ada centang pembeli ulang. Kalau kamu tahu, centang, karena ini yang mengisi target di campaign Sales Growth.
> Di bawahnya: Angka Penting, tren delapan minggu terakhir, dan saran AI. AI baca catatanmu dan Brand DNA, lalu kasih tiga hal buat dikerjakan minggu ini.
> Brandlab belum bisa baca penjualan otomatis, jadi kebiasaannya sederhana: tiap ada penjualan, catat.

---

## Setelah rekam (per video)
1. Upload ke YouTube (unlisted) atau Vimeo.
2. Di `js/guide-videos.js`: ganti `src` entri, samakan `seconds` dengan durasi asli.
3. Untuk video per app: isi `start` di `GUIDE_TO_VIDEO` dengan timestamp chapter asli (brand-guidelines, campaign-detail, brainstorm, calendar, konten-dashboard).
4. Tes di localhost: tombol Video di halaman chapter (mis. Kalender) harus membuka video di detik yang benar; "Tonton ulang" mulai dari awal; setelah selesai/lewati muncul tiga pilihan.
