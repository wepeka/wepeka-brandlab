# Audit Menyeluruh Wepeka Brandlab — Guiding, AI, dan UI

## Akses

- URL: **http://localhost:8743** (server lokal sudah nyala)
- Login: email `fable-review@wepeka.com`, password `FableReview2026!` — akun ini baru dan kosong (belum ada brand), jadi kamu akan mulai persis dari titik nol yang sama seperti user awam beneran mengalami first-time setup. Buat brand contoh sendiri sebagai bagian dari audit Bagian 1.
- Source code app ini ada di folder `/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA` — boleh dibaca langsung kalau perlu cross-check kode di balik sebuah layar (path file disebut di tiap bagian di bawah).

Kamu akan mengaudit **Wepeka Brandlab**, sebuah SaaS branding + content operating system. Brand dibangun lewat wizard bergaya StoryBrand (Brand DNA), lalu sistem kontennya (Content OS) mengatur kalender, campaign, dan Creator Studio pakai kerangka funnel TOFU/MOFU/BOFU. App ini punya 2 mode yang bisa di-toggle kapan saja: **Guided** (untuk pemilik brand awam, non-marketer) dan **Advanced** (untuk marketer/tim profesional) — toggle-nya ada di topbar, disimpan di `settings.experienceMode`.

Tujuan besarnya: pastikan produk ini **benar-benar dua hal sekaligus** — cukup jelas dan tanpa jargon buat orang yang belum pernah pegang tools marketing sama sekali, DAN cukup dalam/powerful buat marketer profesional supaya mereka merasa ini beneran berguna, bukan tools yang di-dumbing-down. Jangan cuma baca kode — **benar-benar klik dan pakai app-nya** di kedua mode, seolah-olah kamu dua persona berbeda.

Jangan cuma laporkan hal yang jelek — kalau ada alur yang sudah bagus dan jadi contoh yang benar, sebutkan juga biar jadi acuan buat bagian lain yang belum sebagus itu.

## Bagian 1 — Guiding: Beginner vs Power User

Untuk tiap flow di bawah, jalanin **dua kali**: sekali sebagai orang awam total (mode Guided, pura-pura ini pertama kalinya kamu dengar istilah "brand positioning" atau "funnel"), sekali sebagai marketer berpengalaman (mode Advanced, kamu tahu semua istilah tapi mau lihat apakah tools-nya kasih kontrol yang cukup detail).

Flow yang wajib dicek:
1. **Onboarding brand baru** — dari klik "Add Brand" sampai brand pertama jadi. Ada validasi nama+deskripsi bisnis? Kalau tour/guide muncul (`js/tour.js`), apakah instruksinya jelas buat orang awam?
2. **Brand DNA wizard** (`js/views/brand-dna.js`) — satu per satu step (audience, purpose, personality, positioning, naming, tagline). Di mode Guided, apa istilah-istilah StoryBrand ini dijelaskan dengan bahasa sehari-hari? Di mode Advanced, apa marketer bisa skip penjelasan dan langsung kerja cepat?
3. **Brand Guidelines** (warna, tipografi, logo) — sama, cek dua sisi.
4. **Content OS**: Dashboard, Kalender, Content List, Creator Studio (`js/views/creator.js`, `js/views/content-editor.js`). Di sini ada temuan dari sesi sebelumnya yang **belum selesai**: Creator Studio sudah punya versi Guided buat funnel stage (kartu "Tujuan konten ini apa?" ganti TOFU/MOFU/BOFU), tapi field Campaign di Creator Studio dan field Campaign+Funnel di Content Editor drawer (`content-editor.js`) **masih selalu tampil versi Advanced-nya** walau lagi di mode Guided. Verifikasi ini masih ada, dan cari kemungkinan tempat lain yang sama masalahnya (search penggunaan `getMode()` di seluruh `js/views/`, dan bandingkan ke tempat yang seharusnya pakai tapi nggak dipakai).
5. **Campaigns** (`js/views/campaigns.js`) — terutama campaign template ("Grow Social Media", event, dll) dan mission ladder-nya. Ini fitur paling "advanced" secara konsep (milestone, coverage, mission tree) — apa versi Guided-nya ada sama sekali, atau orang awam bakal langsung bingung?
6. **Dashboard/Analytics** (`js/views/dashboard.js`, `js/views/brand-home.js` vs `js/views/beginner-home.js`) — bandingkan versi beginner-home vs advanced home. Apa beginner-home beneran actionable (bukan cuma versi kosong dari advanced), dan apa advanced-home kasih insight yang beneran dibutuhkan marketer (bukan cuma angka mentah)?

Untuk tiap flow, catat: (a) istilah/jargon yang muncul tanpa penjelasan di mode Guided, (b) di mode Advanced, kontrol/fitur apa yang berasa "terlalu simpel"/kurang untuk kerjaan profesional, (c) potongan alur yang bikin orang nyasar/bingung mau ngapain selanjutnya (apalagi kalau di-generate).

## Bagian 2 — Integrasi AI dan Kebenaran Landasan Teori

Semua fitur AI lewat satu titik: `js/ai.js` (`callModel` dipanggil dari fungsi-fungsi: `generateScript`, `suggestSchedule`, `classifyFunnel`, `generateThumbnail`, `suggestBrandDnaOptions`, `suggestBrandNames`, `checkBrandNameLength`, `generateOneLiner`, `generateCampaignPlan`, `brainstormCampaignIdeas`, `suggestPhaseContent`, `generateValueProposition`, `generateColorEssence`, `askBrandConsultant`).

Untuk **tiap fungsi AI** di atas, cek dua hal terpisah:

**A. Integrasi** — apa fitur ini beneran nempel ke alur kerja user (misal: hasil generate langsung bisa dipakai/diedit di tempat, bukan modal terpisah yang harus copy-paste manual), atau berasa ditempel belakangan (tombol AI yang keluar dari alur utama)? Apa AI Consultant (`askBrandConsultant`, lihat `js/consultant-panel.js`) beneran "tahu" data brand yang lagi dibuka (brand DNA, campaign aktif, dst) waktu jawab pertanyaan, atau jawabannya generik?

**B. Landasan teori** — ini bagian paling penting. Baca prompt/instruksi yang dikirim ke AI di tiap fungsi (biasanya string besar di `js/ai.js` atau file terkait), lalu evaluasi:
- **Brand DNA / naming / positioning / value proposition**: apa prompt-nya benar-benar mengikuti kerangka StoryBrand (Donald Miller) atau kerangka positioning yang mapan (misal Al Ries & Jack Trout), bukan cuma "tulis paragraf brand yang menarik" generik? Apa nasihat yang dihasilkan AI konsisten dengan definisi asli istilah-istilah itu?
- **Funnel classification (`classifyFunnel`) dan threshold engagement/conversion** (lihat `js/store.js`, `defaultDB().settings.thresholds` — ada angka `good`/`average` per TOFU/MOFU/BOFU untuk engagementRate dan followerConversionRate): apa angka-angka benchmark ini masuk akal secara industri (bandingkan ke benchmark engagement rate Instagram/TikTok yang lazim dipakai di 2025-2026), atau angka sembarangan?
- **Content scheduling (`suggestSchedule`)**: apa rekomendasinya berbasis prinsip yang valid (misal waktu posting berdasarkan jam aktif audiens, frekuensi posting yang sehat per platform), atau cuma template acak?
- **Campaign planning (`generateCampaignPlan`, `brainstormCampaignIdeas`, `suggestPhaseContent`)**: apa strukturnya (pre-event/event/post-event, milestone wajib vs opsional — lihat `MISSION_LADDERS` dan copy panjang di sekitar situ soal "Data Asli Aja", "Target Bukan Jaminan", dst di `js/store.js`) konsisten dan nggak saling kontradiksi?
- **Warna & tipografi (`generateColorEssence`, rekomendasi font pairing di Brand Guidelines)**: apa penjelasan psikologi warna / prinsip pairing font yang dikasih ke user itu akurat (bukan mitos populer yang sebenarnya nggak ada dasar risetnya)?

Kalau nemu klaim yang salah/menyesatkan/terlalu disederhanakan, **kutip persis kalimatnya**, sebutkan di mana nemunya (nama fitur + kira-kira kapan muncul), dan jelasin kenapa itu salah/perlu diperbaiki plus versi yang benar.

## Bagian 3 — UI

Cek di desktop DAN mobile (resize viewport):
- Konsistensi visual antar halaman (spacing, warna, tipografi) — pakai `css/styles.css` sebagai referensi kalau perlu cross-check kelas yang dipakai.
- Dark/light theme — apa semua elemen kebaca jelas di kedua tema, nggak ada teks/ikon yang ketelan background.
- Kontras warna & ukuran target sentuh (accessibility dasar) — cukup buat orang yang matanya nggak awas atau di HP kecil.
- Responsif — apa ada elemen yang kepotong/tumpang tindih di layar sempit (khususnya tabel data di Content List/Dashboard, dan grid ukuran apparel kalau kebetulan lihat wpk-dp juga).
- Kesan keseluruhan: apa tampilannya berasa "premium"/bisa dipercaya buat marketer profesional pegang, atau berasa murahan/template generik?

## Format Laporan

Kelompokkan temuan jadi 3 level: **Kritis** (blocking, bikin salah satu persona — awam atau pro — nggak bisa/nggak mau pakai), **Penting** (nggak blocking tapi ngurangin kepercayaan/kualitas), **Nice-to-have**. Tiap temuan kasih: lokasi (nama halaman/fitur, file kalau kelihatan dari kode), langkah reproduksi singkat, dan saran perbaikan konkret — bukan cuma "kurang jelas", tapi "ganti kalimat X jadi Y" atau "tambah tooltip di sini isinya Z".

Tutup dengan verdict singkat: apa Brandlab sekarang **sudah layak** dipakai orang awam sekaligus marketer profesional, atau ada berapa gap besar yang harus dibenerin dulu sebelum bisa dibilang begitu.
