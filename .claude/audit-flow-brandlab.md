# Review User Flow Brandlab — perspektif orang awam (16 Sep 2026)

Metode: baca semua kode alur (`main.js`, `layout.js`, `brands.js`, `beginner-home.js`, `brand-builder.js`, `brand-dna.js`, `brand-guidelines.js`, `campaigns.js`, `campaign-detail.js`, `content-os.js`, `creator.js`, `calendar.js`, `content-list.js`, `tour.js`, `guides/*`, `section-guide.js`, `guide-fab.js`, `brandlab-intro.js`, `mode-picker.js`, `tour-prompt.js`, `proactive-notif.js`, `mode-reminder.js`, `next-action.js`, seluruh `i18n/*`) + layar pricing & login di localhost:8743. Tidak login (tidak boleh ketik password), jadi bagian dalam app dijalankan secara mental dari kode. Fokus hanya alur, bukan visual/teknis.

Tiga persona yang dipakai: (1) benar-benar awam, (2) tahu mau bikin apa tapi nggak tahu prosesnya, (3) mau cepat, malas baca.

---

## 0. Peta alur yang ada sekarang (mode Pemula)

```
wepeka.com → Halaman harga → "Daftar untuk bayar" → #/login (mode MASUK, harus klik "Daftar")
→ form daftar (nama, email, password 3 syarat, konfirmasi, centang S&K) → halaman harga lagi → bayar
→ Splash "Selamat datang" (1,9 s) → Pilih tipe (Pemula/Pro) → Modal "Apa itu Wepeka Brandlab?" (+ tawaran tur)
→ [Nanti aja] banner "Disarankan: ikuti tur" → Halaman brand (0 brand): kartu "Bikin brand kamu dulu" + "Ikuti tur dulu"
→ Form brand (foto, warna, nama, deskripsi wajib ≥20 char) → "Simpan & lanjut" → Beranda brand

Beranda: Langkah 2/5 "Kenalin usahamu ke sistem" → Brand DNA (7 langkah + Review) → Simpan → Brand Builder HUB (2 pintu)
Beranda: Langkah 3/5 "Pilih warna & font" → /guidelines → tab FONDASI (read-only) → tab Sistem Warna → …
Beranda: Langkah 4/5 "Tentukan tujuan" → Campaign → [modal template] → [modal kalibrasi] → [prompt nama] → detail campaign (+ tur otomatis → Brainstorm → Creator)
Beranda: Langkah 5/5 "Terbitkan konten pertama" → Creator → [modal platform] → [modal AI] → panel draf → Syuting → Editing → Siap upload → Terbit
Setelah 5 selesai: Beranda jadi "Hari ini" (mesin next-action).
```

Lapisan bantuan yang aktif bersamaan: modal intro (tiap login), banner tur, kartu "Ikuti tur" di halaman brand, tombol Panduan per halaman, tombol Video per halaman, FAB "Panduan" (menu 4 item), FAB "Konsultasi AI", ikon "?", tur otomatis sekali-per-halaman di Beranda / Builder hub / Brand DNA / Guidelines / Content OS / Creator / Kalender / Campaign list / Campaign detail, banner notif proaktif, banner "coba mode Pro" (hari ke-7), titik berdenyut di tombol mode.

---

## 1. Yang sudah bagus — pertahankan

- **Beranda Pemula**: satu kartu "Langkah N dari 5" + satu tombol + estimasi menit + daftar 5 langkah yang terkunci berurutan. Ini jantung flow-nya dan sudah benar. Setelah 5 selesai berubah jadi "Hari ini" dengan satu aksi dari mesin next-action — konsep yang tepat.
- **Form brand**: deskripsi wajib, warn-box "Penting: tulis sedetail mungkin" + checklist isi + tombol "Bantu tulis pakai AI" + mic. Ini cara yang benar mengumpulkan konteks AI sekali di awal.
- **Brand DNA**: satu pertanyaan per langkah, contoh di tiap kolom, "jawaban tersimpan tiap Lanjut", tombol "Isi semua pakai AI" sebagai jalan pintas, Review yang bisa diedit langsung.
- **Pemilih tujuan konten** (Ngenalin brand / Bangun kepercayaan / Ngajak beli) menggantikan TOFU/MOFU/BOFU — contoh terjemahan jargon yang baik.
- **Modal "Konten ini buat platform apa?"** (Instagram / TikTok / Mirror) lalu AI langsung terbuka — beginner tidak pernah lihat form kosong.
- **Panel per tahap di Creator** (Syuting = teleprompter + satu tombol besar; Editing = satu tombol; Siap upload = centang platform + Selesai) — tidak bisa salah.
- **Campaign**: 3 kartu template dengan badge "disarankan", kartu "Langkah berikutnya" di detail, tombol tiap milestone tahu sumbernya, chip "← Kembali ke campaign" saat lompat ke Creator.
- **Copy Studio**: 3 pertanyaan → 3 pilihan → salin. Paling ringkas di seluruh app.
- **Lapisan "?"** yang diam sampai diklik, dan tiap tur punya "Tutup tur" + "Lewati langkah ini".

---

## 2. Bagian yang berpotensi membingungkan orang awam

### 2.1 Sebelum masuk app
1. **"Daftar untuk bayar" mendarat di halaman MASUK** ("Selamat datang kembali"). Persona 1 mengira salah klik; link "Daftar" kecil di bawah. (`pricing.js` → `#/login`, `login.js` `state.mode = "login"`.)
2. Setelah daftar, user dilempar balik ke halaman harga yang sama seperti sebelum daftar. Tidak ada kalimat "Akun jadi, tinggal bayar". Bar "Masuk sebagai … — belum ada paket aktif" ada, tapi kecil.

### 2.2 Pembukaan pertama: tiga gerbang + empat undangan tur
3. Splash → pilih tipe → modal "Apa itu Wepeka Brandlab?" → baru halaman brand. Tiga layar sebelum tombol pertama yang berguna.
4. Modal intro **muncul di setiap login** (`shownThisSession` = flag modul, reset tiap page load). User berbayar hari ke-30 masih ditanya "Apa itu Wepeka Brandlab?". Ini friction berulang terbesar untuk persona 3.
5. Isi modal intro (tanpa video) bicara soal Brand DNA "diisi berurutan, satu tahap dulu baru kebuka" dan Guidelines "bebas urutan" + catatan cek merek DJKI — detail level Pro pada detik ke-10, sebelum user punya brand. Timing terlalu cepat dan tidak menyebut Campaign/Konten yang justru 2 dari 5 langkah Pemula.
6. Tur yang sama ditawarkan **4 kali** di satu layar: tombol utama modal intro, banner atas, tombol "Ikuti tur dulu" di kartu hero, dan FAB Panduan → "Kenalan dari awal". Sementara tombol "Bikin brand pertama" bersaing dengan "Mulai tur (disarankan)" — user awam tidak tahu bahwa tur itu **adalah** cara bikin brand (tur 0-brand memandu isi form). Copy "tur 2 menit nunjukin semuanya ada di mana" malah mengesankan jalan-jalan lihat fitur.

### 2.3 Tur onboarding vs mode Pemula
7. Setelah "Simpan" di form brand (langkah tur ke-5), Pemula langsung dipindah ke Beranda brand. Langkah tur berikutnya (`#my-routine-card`, lalu `.brand-tile` clickAny) ada di halaman *semua brand* yang sudah ditinggalkan → tur menunggu 4 s + 4 s dengan hint "⏳ Sebentar…" lalu diam-diam lompat. Delapan detik layar gelap tanpa penjelasan tepat setelah aksi pertama user.
8. Langkah tur "Pengingat harian (Rutinitasku)" dan "Klik salah satu brand" tidak relevan untuk Pemula 1 brand (halaman itu dilewati saat boot).
9. Langkah 3 tur Beranda menyorot tombol mode dan bilang "kalau sudah terbiasa, pindah ke Pro" — di hari pertama. Ditambah titik berdenyut di tombol itu dan banner hari ke-7. Informasi yang tepat tapi tiga kali dan terlalu awal.

### 2.4 Langkah 1 → 2: pertanyaan yang sama dua kali
10. Form brand: "Usahamu ini jualan apa, buat siapa?" (wajib, 3–5 kalimat). Lalu Beranda Langkah 2: "Jawab beberapa pertanyaan: jualan apa, buat siapa, apa bedanya." Persona 1: "Lho, barusan kan udah?" Padahal tombol "Isi semua pakai AI" di DNA memang membaca deskripsi itu — tapi user harus memilihnya sendiri di atas pertanyaan pertama.

### 2.5 Brand DNA
11. Langkah compose (Pelanggan / Masalah / Kepercayaan): user mengisi 2 kotak, tapi tombol **Lanjut tetap mati** sampai klik "Gabungkan jadi satu jawaban". Hint di bawah Lanjut berbunyi "Isi dulu jawabannya" — padahal sudah diisi. Ini titik stuck paling mungkin di seluruh wizard.
12. Per langkah ada sampai 4 tombol AI (kartu "AI isi semua", "Pakai AI buat mikirin ini" ×2, "Minta opsi dari AI"). Untuk persona 1 tidak jelas mana yang "AI-nya".
13. Istilah "StoryBrand", "pemandu bukan pahlawan", "one-liner" muncul tanpa pengantar.
14. Setelah **Simpan Brand DNA** user dilempar ke **Brand Builder hub** (dua pintu, tur hub 2 langkah), bukan balik ke Beranda yang menyuruhnya ke sini. Kosakatanya beda: Beranda bilang "Kenalin usahamu" / "Pilih warna & font", hub bilang "Brand DNA" / "Brand Guidelines". Persona 2 bertanya "ini halaman apa, terus aku ke mana?"

### 2.6 Langkah 3 "Pilih warna & font" — janji vs kenyataan
15. Beranda menjanjikan "±5 menit, tinggal pilih dari pilihan yang sudah disiapkan". Tombolnya mendarat di `/guidelines` tanpa section → tab pertama **Fondasi Brand** (rekap read-only Brand DNA + "Lanjut"). Bukan warna.
16. Halaman Guidelines menampilkan 8 tab (Fondasi, Logo, Sistem Warna, Tipografi, Arah Visual, Tone of Voice, Penerapan, Review & PDF), progress "0/5 bagian selesai", dan preview Brand Book di kanan. Skalanya jauh lebih besar dari "pilih warna & font".
17. Tab warna: pilih rumus (Monokromatik / Bertetangga / Tabrakan / Segitiga Ceria) **dan** ketik hex / eyedropper / ekstrak foto. Chip "kesan" memang men-set warna dasar otomatis, tapi urutannya ("1. rumus", "2. warna dasar") tidak memberi tahu bahwa cukup klik satu chip. Tipografi lebih baik (rekomendasi + "Pakai kombinasi ini").
18. **Tidak ada pintu keluar** setelah warna & font dipilih. Langkah 3 Beranda dianggap selesai saat `colors.primary` terisi, tapi user tidak diberi tahu; tombol "Simpan Brand Book" hanya ada di tab Review, dan link kembali menuju halaman grup Brand Guidelines (lapisan lain lagi), bukan Beranda. Gelembung "Brand kamu sudah siap! Sekarang tentukan tujuannya" hanya muncul kalau **semua 5 bagian** (termasuk upload logo & tone of voice) selesai — jadi untuk jalur Pemula 5-menit, callout itu praktis tidak pernah muncul.
19. Tiga definisi "selesai" untuk hal yang sama: Beranda (warna utama ada), Guidelines (5 bagian), Builder hub (Brand DNA 8/8 + Guidelines n/5 "Berjalan"). User lihat ✓ di satu tempat dan "1/5" di tempat lain.

### 2.7 Langkah 4 Campaign
20. "Pilih tujuan" = 3 modal berturut-turut: pilih template → kalibrasi ("Kamu udah pernah jalanin proses growth kayak gini?") → prompt nama (sudah terisi, "boleh langsung Enter"). Untuk orang yang baru saja memilih "Aku pemilik usaha, baru mulai", pertanyaan kalibrasi dan prompt nama adalah dua klik tanpa keputusan.
21. Halaman detail campaign untuk brand yang belum punya konten sama sekali: headline "Followers 0/1000 · belum pernah dicatat", dan kartu **"Langkah berikutnya: Isi angka Insights Instagram"** (prioritas 2 di `next-action.js` mengalahkan Brainstorm prioritas 7). Hal pertama yang diminta setelah "pilih tujuan" adalah membuka Dasbor Profesional Instagram dan menyalin angka — sebelum satu konten pun ada. Persona 1 (mungkin belum punya akun profesional) berhenti di sini.
22. Di bawahnya langsung tampil pohon SVG + 7 milestone (1.000 followers, 50 konten, 8 minggu, 150 share, 150 save, 50 DM, 5 video ER>10%) + "Catat angka manual (4)". Untuk "Langkah 4, ±3 menit" ini terlalu banyak angka pada momen yang salah; yang perlu dilihat user saat itu hanya "tujuanmu tercatat, sekarang bikin konten".
23. Tur detail campaign otomatis (Guided) berakhir dengan Brainstorm → simpan ide → "Selesai" → **dipindah ke Creator**. Jadi langkah 4 diam-diam menyeret user ke langkah 5 tanpa lewat Beranda; wajar untuk persona 2, membingungkan untuk persona 1 yang mengandalkan Beranda sebagai "peta".

### 2.8 Langkah 5 Konten — dua sistem "berikutnya" yang tidak nyambung
24. Beranda bilang urutannya "tulis naskah → taruh di jadwal → upload". Creator bilang "Ide → Syuting → Editing → Siap upload → Terbit" dan **tidak pernah menanyakan tanggal**. Tanggal hanya bisa diisi di Kalender (drag) atau drawer editor di tab Semua konten. Beginner yang mengikuti Creator sampai "Terbit" tidak pernah menjadwalkan apa pun, dan tidak tahu itu langkah yang dilewati. Halaman "Ringkasan" (yang bilang "Jadwalkan konten kamu → Buka Kalender") justru ditaruh sebagai tab ke-4 dalam mode Pemula, jadi hampir tidak pernah terlihat.
25. Pertanyaan tujuan konten (Ngenalin/Kepercayaan/Ngajak beli) ditanya **dua kali**: di modal AI dan lagi di panel draf.
26. Modal AI untuk Pemula masih memuat Durasi video, "Tujuan video ini apa?", dan "Artikel/referensi" — tiga field tambahan yang tidak dibutuhkan untuk konten pertama.
27. Panel "Siap upload" punya tombol AI thumbnail yang **selalu gagal** ("Butuh provider Gemini") karena key global sekarang DeepSeek. Tombol mati di panel yang seharusnya paling sederhana.
28. Tab "Semua konten" membuka pemilih "Mau cek apa?" lalu tabel dengan kolom Funnel/Engagement/Konv. Follower/Kesehatan — tabel Pro, tidak ada versi Pemula (audit 14 Sep sudah mencatat editor drawer; tabelnya juga).

### 2.9 Tur "belajar sambil ngerjain" Creator — bentrok dengan data asli
29. Tur Creator (±25 langkah) **otomatis** jalan saat Pemula pertama kali membuka Creator (dan **kedua mode** saat pertama kali membuka Content OS: `content-os.js` mengalihkan Dashboard → Creator dan memaksa tur). Hasil AI memang contoh (tanpa token), tetapi perubahan status **ditulis sungguhan**: "Ide selesai → syuting", "Selesai syuting", "Selesai editing", centang "Sudah di Instagram", "Selesai" = **Terbit hari ini**. Copy-nya sendiri bilang "(Buat tur ini boleh langsung klik)" dan di akhir "konten latihan tadi bisa kamu hapus".
    Akibat: (a) Langkah 5 Beranda tercentang ✓ padahal user belum menerbitkan apa pun → Beranda berubah jadi "Hari ini: Langkah dasar sudah beres"; (b) campaign Grow Social (autoLinkAllContent) menghitung konten palsu itu sebagai "Konten orisinal terbit 1/50" dan memulai streak minggu aktif; (c) konten itu muncul di Kalender di tanggal hari ini. Ini tabrakan flow paling serius: tutorial mengubah kebenaran data.
30. Pro yang klik "Content OS" pertama kali ingin lihat Dashboard, tapi dibawa ke Creator dengan tur interaktif. Persona 3 menutup tur dan mendapati dirinya di halaman yang tidak ia klik.

### 2.10 Tumpukan bantuan & banner
31. Sembilan halaman punya tur otomatis sekali-per-halaman (Beranda 4 langkah, Builder hub 2, DNA 1, Guidelines 1, Content OS hub 1, Creator ±25, Kalender ±19, Campaign list ±8, Campaign detail ±12). Untuk persona 3, tiap halaman baru = satu overlay gelap yang harus ditutup. Untuk persona 1, tur 19 langkah Kalender (Bank Konten, drag, klik tanggal, Jadwal Kerja, AI Auto-Schedule, ekspor .ics, Minggu/Hari/Bulan, garis campaign) jauh melampaui yang ia butuhkan ("taruh konten di tanggal").
32. Pada boot non-pertama bisa muncul sekaligus: modal intro + banner tur + banner notif proaktif + banner "coba Pro" (ketiganya di-prepend ke `body`). Topbar terdorong tiga baris ke bawah.
33. Dua FAB (Panduan kiri-bawah, Konsultasi AI kanan-bawah) + tombol "Panduan" dan "Video" di header tiap halaman. Menu FAB item pertama ("Tur halaman ini") hanya mengklik tombol Panduan yang sudah terlihat di halaman yang sama.
34. Dua sistem jadwal kerja: "Rutinitasku → Atur" di halaman semua brand (brand/hari/kegiatan/jam) dan "Jadwal Kerja" di Kalender (hari syuting/edit/upload). Cadence memang menyinkron ke routine, tapi user melihat dua form berbeda untuk hal yang sama.

### 2.11 Istilah & sisa bahasa
35. Tag **TOFU/MOFU/BOFU mentah** masih tampil di Beranda Pemula (baris "Jadwal terdekat": `${c.funnel}`) dan di Ringkasan Pemula, padahal pemilihnya sudah diterjemahkan.
36. Nama template campaign ("Grow Social Media", "Grow Personal Branding"), label "Brand Builder", "Brand DNA", "Brand Guidelines", "Brand Book", "Creator Studio", "Mission", "Level", "milestone", "Insights", "Reach", "Shares/Saves", "engagement pod", "Leading/Tracking/Kerning", "Monokromatik/Triadik" — semua dipakai tanpa pengantar di jalur Pemula. Sebagian wajar untuk pengguna Indonesia (caption, script), sebagian tidak (milestone, insights, kerning).
37. Aturan main Grow Social ("kumulatif", "engagement pod", "minimal aktif 8 minggu", "vakum 14 hari") tersembunyi di accordion — bagus — tetapi banner proaktif bisa tiba-tiba bilang "streak 1 minggu putus dalam 2 hari" pada user yang belum pernah membaca kata "streak".
38. Nav Pro masih menampilkan tab "Pelacak Penjualan" yang isinya "Segera hadir"; halaman semua brand menampilkan kartu "Video panduan setup — Segera hadir". Placeholder yang bisa diklik = jalan buntu.

---

## 3. Bottleneck / friction terbesar (urut dampak)

1. **Tur Creator menulis status asli** (butir 29) — merusak Langkah 5, campaign, kalender, dan kepercayaan user pada angka.
2. **Modal intro tiap login + 4 undangan tur + 9 tur otomatis** — persona 3 merasa "app ini terus ngomong".
3. **Simpan Brand DNA → hub, bukan Beranda** dan **Langkah 3 tanpa pintu keluar** — dua kali user kehilangan "peta" tepat setelah menyelesaikan sesuatu.
4. **"Gabungkan jadi satu jawaban" wajib** sebelum Lanjut aktif — stuck diam-diam di Langkah 2.
5. **Campaign baru → "Isi angka Insights Instagram"** sebelum ada konten — meminta pekerjaan yang salah pada waktu yang salah.
6. **Jadwal tidak pernah ditanya** di jalur Creator, padahal Beranda menjanjikannya.
7. **Pertanyaan ganda**: deskripsi brand vs DNA; tujuan konten di modal AI vs panel; kalibrasi + nama campaign.

---

## 4. Step yang sebaiknya dihapus, digabung, dipindah, atau disederhanakan

| Aksi | Step | Alasan |
|---|---|---|
| **Gabung** | Pilih tipe + modal intro → satu layar | Dua kalimat "apa itu Brandlab" muat di atas dua kartu Pemula/Pro. Modal intro cukup hidup di FAB "Kenalan dari awal". |
| **Hapus (pengulangan)** | Modal intro pada login ke-2 dst | Tampilkan sekali; `introSeenAt` di settings akun. |
| **Hapus** | Banner tur + kartu "Ikuti tur" + tombol "Ikuti tur dulu" di hero | Sisakan satu tempat: tombol di hero (0 brand) dan FAB. |
| **Hapus (Pemula)** | Tur onboarding 13 langkah | Di Pemula, Beranda 5-langkah + form brand yang sudah ber-hint **adalah** onboarding. Tur besar cukup untuk Pro / dari FAB. Kalau dipertahankan: buang langkah Rutinitasku & "klik brand", dan akhiri di form brand (hindari 8 detik "Sebentar…"). |
| **Hapus** | Langkah tur Beranda soal tombol mode | Cukup banner hari ke-7. |
| **Gabung** | Langkah 1 deskripsi + Langkah 2 DNA | Setelah brand dibuat, DNA dibuka langsung dalam keadaan **sudah diisi AI dari deskripsi** dan mendarat di Review ("Ini yang kami tangkap dari ceritamu — koreksi kalau ada yang kurang pas"). Jalur 7 pertanyaan tetap ada sebagai "Mau jawab sendiri satu-satu?". Langkah 2 berubah dari "jawab 7 pertanyaan" jadi "baca & koreksi". |
| **Sederhanakan** | "Gabungkan jadi satu jawaban" | Jalankan otomatis saat Lanjut/Simpan progress; tombol tetap ada untuk yang mau lihat hasilnya dulu. Hint Lanjut: "Klik Gabungkan dulu" kalau tombol dipertahankan. |
| **Pindah** | Tujuan Simpan Brand DNA | Pemula → Beranda (langkah 3 langsung jadi hero). Pro → hub seperti sekarang. |
| **Hapus lapisan** | Halaman grup `/builder/guidelines` (7 kartu tahap) | Wizard Guidelines sudah punya baris tab + progress yang sama. Pintu Guidelines → langsung wizard. |
| **Pindah** | Tujuan tombol "Pilih warna" | Mendarat di tab **Sistem Warna**, bukan Fondasi. |
| **Sederhanakan (Pemula)** | Tab Guidelines | Tampilkan Warna → Font → Selesai. Logo, Tone of Voice, Arah Visual, Penerapan, Review PDF jadi "Lengkapi Brand Book" yang ditawarkan Beranda **setelah** 5 langkah dasar (masuk ke mesin "Hari ini"). Warna: tampilkan chip kesan dulu sebagai "pilih satu", rumus + hex jadi "Sesuaikan". Tambahkan tombol "Selesai, balik ke Beranda" saat warna & font terisi (tombol yang sama dengan Simpan Brand Book, cuma dipindah). |
| **Satukan** | Definisi "selesai" Guidelines | Satu angka: Beranda, hub, dan halaman Guidelines membaca fungsi yang sama. |
| **Hapus (Pemula)** | Modal kalibrasi + prompt nama campaign | Klik template → campaign langsung jadi (Mission 1, nama default). Ganti nama lewat Edit. Pro boleh tetap. |
| **Ubah urutan** | Next action saat 0 konten | Selama campaign belum punya satu pun konten terkait, "Brainstorm / bikin konten pertama" harus di atas "Isi Insights". Insights baru diminta setelah ada konten terbit. |
| **Sembunyikan (Pemula)** | Pohon + daftar milestone pada campaign baru | Tampilkan kolaps ("Lihat 7 target level ini") sampai ada konten pertama. |
| **Hapus** | Tur detail campaign yang berakhir di Creator | Tur berhenti di halamannya sendiri; Beranda yang mengarahkan ke langkah 5. |
| **Hapus (Pemula)** | Durasi video, Tujuan video, Artikel di modal AI | Sisakan "Konten ini mau ngomongin apa?" + tujuan. |
| **Hapus** | Pemilih tujuan konten di panel draf **atau** di modal AI | Tanya sekali (modal), panel hanya menampilkan pilihan dengan link "ubah". |
| **Pindah** | Tanggal upload | Tanyakan di panel "Siap upload" ("Kapan mau di-upload?" — field yang sudah ada di drawer editor). Kalender tetap untuk mengatur ulang. |
| **Hapus** | Tombol AI thumbnail di panel Siap upload | Sampai provider gambar aktif. |
| **Hapus (Pemula)** | Tab "Ringkasan" Content OS | Beranda sudah memuat "Konten yang lagi jalan" dan "Jadwal terdekat". Tiga tab: Tulis konten / Jadwal / Semua konten. |
| **Ubah** | Tur Creator | Berhenti di "Ide selesai — lanjut ke syuting"; tahap Syuting/Editing/Upload dijelaskan sebagai langkah info (tanpa gate `write`). Tidak ada konten yang di-"Terbit"-kan oleh tutorial. Kalau tetap ingin siklus penuh: jalankan pada konten contoh yang otomatis dihapus dan **tidak** dihitung campaign/streak/Beranda. |
| **Matikan** | Tur otomatis Kalender, Campaign list/detail, Content OS hub, Builder hub, DNA, Guidelines | Cukup Beranda (1× , 3 langkah) dan Creator (sampai "Ide selesai"). Sisanya lewat tombol Panduan. |
| **Hapus** | Pengalihan Content OS → Creator + tur paksa (kedua mode) | Landing Content OS = tab yang diklik. |
| **Gabung** | Rutinitasku (halaman semua brand) ↔ Jadwal Kerja | Satu form (Jadwal Kerja), Rutinitasku hanya menampilkan hasilnya. |
| **Sembunyikan** | Tab Pelacak Penjualan (Pro), kartu "Video panduan setup — Segera hadir" | Sampai fiturnya ada. |
| **Perbaiki** | Tag `c.funnel` mentah di Beranda & Ringkasan Pemula | Pakai label yang sama dengan pemilih tujuan. |
| **Perbaiki** | "Daftar untuk bayar" → login | Buka `#/login` dalam mode daftar. |

---

## 5. Flow yang bertabrakan / tidak konsisten

- **Beranda vs Creator vs Ringkasan** soal kapan menjadwalkan (butir 24).
- **Tur Creator vs kebenaran data** (butir 29) — tutorial ✓-kan Langkah 5, memberi makan campaign & kalender.
- **Beranda "Pilih warna & font" vs Guidelines 8 tab / Builder hub 5 bagian** — tiga skala dan tiga definisi selesai untuk satu langkah.
- **Simpan DNA → hub** vs **Beranda sebagai peta** — Beranda janji "sistem yang nunjukin langkah berikutnya", lalu melepas user di halaman yang bukan Beranda.
- **Pemilih tujuan konten** dua kali; **deskripsi usaha** dua kali; **kalibrasi + nama** untuk keputusan yang sudah diambil ("baru mulai").
- **Tur onboarding (halaman semua brand)** vs **Pemula 1 brand yang tidak pernah melihat halaman itu**.
- **Rutinitasku vs Jadwal Kerja**; **Panduan halaman vs FAB "Tur halaman ini"**; **modal intro vs FAB "Kenalan dari awal"**; **titik berdenyut mode vs langkah tur mode vs banner hari-7**.
- **Content OS Pro**: tab "Dashboard" pertama tapi kunjungan pertama dipaksa ke Creator.

---

## 6. Rekomendasi urutan flow paling natural (Pemula)

```
1. Daftar (langsung mode daftar) → bayar → Splash
2. SATU layar: "Kamu tipe yang mana?" + dua kalimat apa itu Brandlab. Pilih Pemula.
3. Form brand: nama + "jualan apa, buat siapa" (form sekarang). Simpan → Beranda.
4. Beranda — Langkah 2/5 "Cek profil brand yang kami tangkap dari ceritamu":
   Brand DNA terbuka langsung di Review, sudah terisi AI. Koreksi → Simpan → Beranda.
   (Link kecil: "Mau jawab sendiri satu-satu?" → wizard 7 langkah, Lanjut otomatis menggabungkan.)
5. Beranda — Langkah 3/5 "Pilih warna & font": mendarat di Warna (klik satu chip kesan → palet jadi)
   → Font (Pakai kombinasi ini) → "Selesai, balik ke Beranda".
6. Beranda — Langkah 4/5 "Tentukan tujuan": klik satu kartu template → campaign jadi → detail campaign
   yang hanya menampilkan: "Level 1: Mulai Dikenal" + satu tombol "Bikin konten pertama" (target lengkap kolaps). Tidak ada tur otomatis.
7. Beranda — Langkah 5/5 "Terbitkan konten pertama": Creator → platform → AI (prompt + tujuan) →
   panel draf → "Ide selesai" → Syuting → Editing → Siap upload (+ "Kapan mau upload?") → Terbit → Beranda.
   Tur Creator (sekali, otomatis) berhenti di "Ide selesai"; sisanya lewat tombol Panduan.
8. Beranda "Hari ini": mesin next-action mengambil alih. Di sinilah baru muncul, satu per satu dan sesuai kondisi:
   "Isi angka Insights" (setelah ada konten terbit), "Lengkapi Brand Book: logo & tone of voice", "Atur Jadwal Kerja", tawaran mode Pro (hari ke-7).
```

Prinsip yang mengikat semuanya: **tiap langkah berakhir di Beranda**, tiap pertanyaan ditanya **sekali**, dan tidak ada tutorial yang **mengubah data**.

---

## 7. Jalankan tiga skenario

**Persona 1 — benar-benar awam.** Lolos daftar (agak tersandung di "Daftar untuk bayar" → layar Masuk). Pilih Pemula. Modal intro: baca "Brand DNA diisi berurutan…" — belum paham, klik "Mulai tur (disarankan)" karena disarankan. Tur memandu isi form brand — bagus. Setelah Simpan: layar gelap 8 detik "Sebentar…" — mengira app hang, klik "Tutup tur". Beranda: jelas, klik "Mulai jawab". Langkah 2 DNA: isi 2 kotak, Lanjut mati, hint "Isi dulu jawabannya" — bingung ±30 detik sampai menemukan "Gabungkan". Selesai 7 langkah, Simpan → Brand Builder hub dengan dua pintu + tur 2 langkah: "aku di mana?". Klik pintu Guidelines → 7 kartu tahap → klik Sistem Warna → 8 tab + preview: "katanya 5 menit?". Pilih chip kesan, palet jadi. Tidak tahu harus apa; klik tab Logo → "Belum punya" → disuruh ke ChatGPT. Berhenti. Kalau sampai Campaign: pilih Grow Social → dua modal → detail: "Followers 0/1000, isi Insights Instagram" → tidak punya akun profesional → berhenti.

**Persona 2 — tahu mau bikin apa (mis. konten Reels rutin), tidak tahu prosesnya.** Bosan dengan Langkah 2–4, tapi Beranda mengunci Langkah 5 sampai campaign ada. Lompat lewat tab "Konten" → Creator → tur 25 langkah otomatis menghadang; ikuti sampai akhir → konten latihan "Terbit" → Beranda: Langkah 5 ✓, "Langkah dasar sudah beres" — padahal belum bikin apa-apa. Bikin konten asli: alur Ide→Syuting→Edit→Upload jelas; tidak pernah ditanya tanggal, tidak tahu ada Kalender kecuali link kecil di bawah. Campaign menghitung konten latihan sebagai konten pertama.

**Persona 3 — mau cepat.** Pilih Pro. Tiap login: modal "Apa itu Wepeka Brandlab?" + banner tur → dua klik sebelum kerja. Beranda Pro: strip kesehatan dengan tiga badge merah dan widget; klik "Content OS" → dialihkan ke Creator + tur interaktif → "Tutup tur" → bukan halaman yang diklik. Klik Kalender → tur 19 langkah → tutup. Klik Campaign → tur → tutup. Tab "Pelacak Penjualan" → "Segera hadir". Kesan: app-nya lebih sibuk menjelaskan daripada dipakai.

---

## 8. Catatan verifikasi

- Semua klaim di atas ditelusuri ke kode (file/fungsi disebut di tiap butir). Yang belum dilihat di layar langsung karena butuh login: durasi jeda tur 8 detik (dari `waitTimeout` 4000 × 2 langkah), tumpukan 3 banner (dari urutan panggilan di `main.js`), dan tampilan halaman Guidelines/Campaign untuk brand kosong.
- Audit 14 Sep (`.claude/audit-brandlab.md`) butir 1, 2, 12, 13, 21, 22 terlihat sudah ditangani di kode sekarang; butir 3 (editor drawer Advanced), 5 (Campaign Pemula — sebagian), 15 (Typography — sudah), 24 (FAB di HP) masih relevan.
