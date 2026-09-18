# Audit Wepeka Brandlab — Guiding, AI, UI (14 Sep 2026)

Diuji langsung di http://localhost:8743 dengan akun `fable-review@wepeka.com` (akun kosong → brand contoh "Kopi Senja", kedai kopi di Kediri) di mode Guided dan Advanced, viewport 542px (HP) + 1280px (desktop), tema gelap + terang. Kode di-cross-check di `js/`. AI diuji live dengan key global (DeepSeek): Brand DNA options (3 field), CTA, Purpose, one-liner, AI Script Generator, AI Consultant.

Versi lengkap dengan konteks & contoh: lihat artifact "Audit Brandlab Kopi Senja".

## Perubahan kode yang dilakukan sesi ini (di luar audit, atas permintaan)
- API key AI dijadikan **global**: app membaca `settings/main` (dokumen lama yang masih berisi key Gemini + DeepSeek) untuk semua akun. `js/store.js` (listener `settings/main`, `isGlobalAiActive`, `getGlobalAiSettings`, `updateGlobalAiSettings`, `persistSettings` tidak lagi menyalin key ke doc per-akun), `js/account.js` (`ADMIN_UIDS` = akun wepeka), `js/views/settings.js` (panel AI: non-admin lihat "AI sudah aktif — disediakan Wepeka"; admin edit key global), `firestore.rules` (`settings/main`: read semua user login, write hanya uid admin).
- **Risiko**: key tetap sampai ke browser tiap user (bisa dibaca via DevTools). Solusi benar = proxy server-side (Phase 2). Belum di-commit.

## VERDICT SINGKAT
**Belum layak untuk dua persona sekaligus.** Fondasinya sangat bagus — Brand DNA wizard, AI Consultant, dan beginner-home adalah contoh yang benar. Tapi ada **6 gap besar** yang bikin orang awam nyasar (default mode Advanced, jalur pemula masih separuh Inggris, Content Editor & Campaigns belum punya versi Guided, tur bisa tumpang tindih) dan **2 gap** yang bikin marketer merasa dibatasi (Custom campaign "Coming soon" tanpa jalan masuk ke intake detail yang sebenarnya sudah ada di kode; benchmark satu set untuk semua platform padahal aturan campaign sendiri bilang tiap platform beda).

## KRITIS
1. **Akun baru default ke mode Advanced** — `js/store.js` `experienceMode: "advanced"`. Repro: login akun baru → topbar "Advanced". Fix: default `"guided"` untuk akun tanpa brand, atau tanya sekali di login pertama ("Kamu pemilik usaha atau marketer?").
2. **Tur spotlight tumpang tindih & tidak dibersihkan saat pindah halaman** — `js/tour.js` `runSpotlightTour` tanpa guard; `js/section-guide.js` auto-play per section. Repro (Guided): selesaikan Brand DNA → Simpan → redirect ke Builder hub (tur hub jalan) → klik Color System → tur Guidelines jalan di atasnya: dua tooltip bertumpuk, halaman gelap ganda. Fix: satu `activeTour` module-level (teardown yang lama sebelum mulai baru) + teardown di `hashchange`.
3. **Content Editor drawer selalu versi Advanced** — `js/views/content-editor.js` tidak pakai `getMode()`: TAHAP FUNNEL TOFU/MOFU/BOFU, CAMPAIGN + fase, STATUS "Idea/Scripting/Execution/Editing/Ready to Upload". Juga modal "AI Script & Hook Generator" (`creator.js`) punya chip FUNNEL STAGE TOFU/MOFU/BOFU, dan field Campaign di Creator berlabel "No campaign / No phase". Fix: pindahkan `funnelGuidedHTML` dari creator.js ke modul bersama (`js/funnel-field.js`) dan pakai di 3 tempat; di Guided ganti STATUS jadi "Ide → Nulis → Syuting → Edit → Siap upload → Terbit".
4. **Bahasa campur di jalur pemula** — halaman Brands ("Choose a brand to plan, publish, and track", kartu tur), tur langkah 11–15 Inggris (1–10 Indonesia), semua judul Brand Guidelines ("Do you already have a logo?", "What feeling should your colors create?", "Where should this brand show up?", "Your Brand Book is ready", "Use this"), Campaigns ("New Campaign", "No campaigns yet", "journey phase"), Creator empty state ("Nothing to write yet"), Settings ("Formulas", "Thresholds by Funnel Stage"), "Skip for now →" di DNA langkah 8. Fix: selesaikan i18n untuk `brands.js`, `tour.js`, `brand-guidelines.js`, `campaigns.js`, `creator.js`, `settings.js` — minimal semua heading/CTA.
5. **Campaigns tidak punya versi Guided sama sekali** — `js/views/campaigns.js` tanpa `getMode()`. Orang awam langsung dapat: pill "AWARENESS · Planning", 2 paragraf aturan ("kumulatif", "engagement pod", "Minimal aktif Level 1 → 8 minggu"), 9 milestone dengan input angka + tombol edit target + hapus. Deskripsi tiap milestone sudah bagus (bahasa sehari-hari) — pertahankan. Fix Guided: kartu pembuka "Campaign ini = tangga 5 level. Sekarang kamu di Level 1: Get Discovered. Yang perlu kamu lakukan minggu ini: …"; aturan jadi accordion "Aturan main"; sembunyikan edit-target/hapus milestone; sembunyikan pill objective/status.
6. **Key AI ada di browser semua user** (akibat permintaan "global"). Fix sebelum jualan: proxy `/api/ai` (Vercel) yang verifikasi Firebase ID token, key di env var; sekaligus fondasi limit AI (Phase 2).
7. **Custom campaign "Coming soon" tapi intake detailnya sudah ada** — `openCustomCampaignFlow` (objective picker, free-text goal, AI `generateCampaignPlan`) tidak bisa dijangkau: tombol `#open-custom-flow` tidak dirender, kartu Custom `disabled`. Marketer yang mau campaign Product Launch/Sales/Engagement mentok. Fix: aktifkan kartu Custom di Advanced (Guided boleh tetap 3 template).

## PENTING
8. "Gabungkan jadi satu jawaban" cuma menyambung kalimat: hasilnya "20-35. Kamu pengen nongkrong santai… Takut kopi mahal…" — bertentangan dengan `principle` langkah itu sendiri ("harus menyambungkan sebab-akibat"). Fix: template per step (`Pelanggan kami: {role} usia {age} yang {goal}. Yang bikin mereka khawatir: {worry}.`) atau panggil AI untuk merangkai.
9. Opsi AI untuk field *audiens* ditulis orang kedua ("Kamu pengen nongkrong…") karena aturan "pakai 'kamu' lebih dari 'kami'" di `suggestBrandDnaOptions` — benar untuk copy ke pelanggan, salah untuk deskripsi internal siapa pelanggannya. Fix: tambah `voice: "third-person"` untuk step audience/problem, dan ubah aturan jadi "kalau pertanyaan tentang pelanggan, tulis 'mereka'".
10. One-liner terlalu panjang (52 kata) — prompt `generateOneLiner` cuma "ONE sentence". Fix: "maksimal 25 kata, lolos grunt test".
11. Revisit langkah compose: kotak-kotak kosong, jawaban gabungan tersembunyi (collapsed) → terlihat hilang. Fix: simpan `parts` ke brandDNA atau buka textarea gabungan kalau sudah terisi.
12. Sinyal progress saling bertentangan: toast "Brand DNA 100% selesai!" lalu hub "Brand DNA 3/5 tahap selesai"; Guidelines "2/6 bagian selesai" sebelum diisi. Fix: satu definisi progress, label yang sama di semua tempat.
13. Health strip Beranda (Advanced): "Jendela kalender: Semua tercover" hijau padahal "Belum ada kampanye"/0% coverage dan "14 hari kosong" merah (`brand-home.js` `uncovered === 0` vacuous). Fix: kalau 0 campaign → "Belum ada kampanye" abu-abu. Label "Bolong konten (14h)" → "Hari tanpa konten (14 hari ke depan)".
14. Klaim warna: "Riset bilang orang nilai brand cuma dalam 90 detik, dan 90% dari penilaian itu dari warna." (`brand-guidelines.js` langkah Color System). Sumbernya Singh (2006) yang mengutip laporan industri CCICOLOR, rentang aslinya "62–90%", bukan riset peer-reviewed. Fix: "Kesan pertama terbentuk dalam hitungan detik, dan warna termasuk yang paling dulu ditangkap orang — jadi pilih dengan sengaja, bukan asal suka."
15. Langkah Typography: pemula disuruh "cari & download font dulu di Google Fonts/DaFont/Envato", rekomendasi Wepeka disembunyikan di tombol "Bingung?". Fix Guided: tampilkan "Wepeka Rekomendasi" terbuka + pasangan font siap pakai di atas, upload font di bawah (collapsed). Deskripsi kategori font ("Serif = formal, mewah…", "Script = feminin") framing-nya "kesan umum di industri", bukan fakta.
16. AI Consultant menampilkan `**tebal**` dan `*miring*` sebagai asterisk mentah (`escapeHtml`). Fix: renderer markdown ringan (bold/italic/list) atau instruksi "jangan pakai markdown".
17. Snapshot Consultant salah model: campaign Grow Social (mission ladder, `autoLinkAllContent`) dilaporkan "0/4 fase journey" → AI bilang "Ada 4 fase di campaign kamu". Fix `consultant-panel.js buildSnapshot`: kalau `campaign.missions` → laporkan level aktif + milestone tercapai.
18. Benchmark: satu set threshold untuk semua platform (TOFU ER good 8%/avg 4%, MOFU 6/3, BOFU 4/2; konversi follower good 2%/1%/…) padahal EVENT_PLAN_TERMS sendiri bilang "Beda Platform Beda Benchmark", dan tidak ada sumber. ER by reach (rumus app) di 2025–26: Reels IG median ±4–6%, TikTok ±5–8%, akun <5K biasanya lebih tinggi — jadi 8% "good" bisa dipertahankan untuk akun kecil, tapi 4% "average" ketinggian untuk MOFU/BOFU. Konversi follower (followers gained / reach) lazimnya 0,1–0,5%; 1–2% itu istimewa, bukan "average". Fix: default per platform + tooltip "Angka ini asumsi awal untuk akun kecil, ubah sesuai data kamu"; turunkan followerConversion average ke 0,3% dan good ke 1%.
19. Mission ladder: konsisten internal, tapi (a) "Minggu aktif konsisten" diisi manual padahal app punya tanggal terbit — bisa otomatis; (b) "Engagement bermakna total" tumpang tindih dengan Shares/Saves/DM (double count); (c) Level 1 = 50 konten + 1.000 followers dalam ≥8 minggu ≈ 6 post/minggu — berat untuk pemilik usaha solo; (d) milestone "5 video ER > 10%" sangat agresif — jelaskan ini wajar hanya untuk akun kecil.
20. Dashboard Advanced kosong = dinding "—" dan 0 tanpa arahan. beginner-home justru contoh yang benar (3 aplikasi + "Langkah 1: …" + To Do). Fix: empty state dashboard → satu CTA "Terbitkan konten pertama dan isi datanya".
21. Onboarding pertama menumpuk: intro modal + banner "Mulai Tur" + kartu "Take the Tour" + "MY ROUTINE — TODAY" + "Setup walkthrough video COMING SOON" untuk akun 0 brand. Fix: satu urutan (intro → tur), sembunyikan routine & video sampai ada brand.
22. Tur langkah 1 hanya mendengarkan klik `#add-brand`; klik "+" kecil (`#add-brand-quick`) membuka modal tapi tur nyangkut di step 1 dan lapisan gelap menutupi modal. Fix: listener di kedua tombol, atau hide `#add-brand-quick` saat tur.
23. Deskripsi bisnis tidak divalidasi di luar tur (`brands.js` hanya nama). Fix: wajib ≥20 karakter + helper "AI pakai ini di semua fitur".
24. Mobile: FAB Consultant menutupi hint "Isi dulu jawabannya buat lanjut" dan tombol Simpan di dasar wizard; header sticky menutupi field pertama saat scroll. Fix: `scroll-margin-top` pada field; FAB naik/hilang saat ada footer aksi.
25. Eyebrow beginner-home menampilkan "Panduan ? Panduan" (label + tombol section-guide sama-sama "Panduan").

## NICE-TO-HAVE
26. Tur section Guided masih pakai "purpose, audiens, positioning" tanpa penjelasan — ganti "kenapa brand ini ada, siapa pelanggannya, kenapa harus pilih kamu".
27. Hook AI mengubah fakta ("jam 1 malam" → "jam 1 pagi") — tambah aturan "angka/jam/harga dari brand context harus persis".
28. `suggestBrandDnaOptions` kadang balik 2 opsi saat diminta 3 — validasi `count` & minta ulang sekali.
29. Toast "AI bisa bantu isi konten per fase di dalam" untuk campaign tanpa fase → "AI bisa bantu brainstorm konten buat Mission 1".
30. Cadence modal hint masih sebut "funnel yang sama (TOFU/MOFU/BOFU)" → "konten dengan tujuan sama".
31. Add Brand modal: teks Brand Color & label field Inggris.
32. Consultant: tambah chip pertanyaan awal ("Minggu ini ngapain dulu?", "Kontenku kenapa sepi?").
33. Milestone kind "check" tanpa cara ukur — tambah link ke Dashboard rata-rata ER akun.

## Bagian 2 — per fungsi AI (ringkas)
| Fungsi | Integrasi | Landasan teori |
|---|---|---|
| suggestBrandDnaOptions | ✅ inline, "Pakai", "Coba opsi lain" — contoh terbaik | ✅ StoryBrand lengkap (hero/guide/plan/CTA/stakes, grunt test, principle per field). ⚠ voice orang kedua bocor ke deskripsi audiens |
| generateOneLiner | ✅ langsung ke field editable | ✅ shape problem→solusi→hasil; ⚠ tanpa batas kata |
| suggestBrandNames / checkBrandNameLength | ✅ (Brand Builder Naming) | ✅ descriptive vs coined, portmanteau, unit pengucapan; jujur soal cek merek manual (DJKI) — bagus |
| generateValueProposition / generateColorEssence | ✅ di-cache di brandGuidelines.aiCopy | ✅ dipaksa spesifik brand, bukan trivia warna; ⚠ copy statis di UI ("90%") yang bermasalah, bukan prompt-nya |
| generateScript | ✅ modal → pilih hook/script/caption → "Use" | ✅ funnel-aware (MOFU tanya demo, BOFU tanya offer), format HOOK/ISI; ⚠ modal masih TOFU/MOFU/BOFU di Guided |
| suggestSchedule | ✅ auto-schedule di Kalender, hormati cadence & rutinitas | ⚠ prinsip valid (readiness, sebar funnel, window campaign) tapi TIDAK ada input jam aktif audiens/insight platform — hanya tanggal, bukan jam; sebut jelas di UI |
| classifyFunnel | ✅ ikon AI di editor | ✅ definisi TOFU/MOFU/BOFU standar |
| suggestCampaignFit | ✅ ikon AI di editor, tidak auto-apply | ✅ prefer fase kosong (coverage) — masuk akal |
| generateCampaignPlan | ⚠ tidak terjangkau (Custom "Coming soon") | ✅ struktur lengkap (insight, big idea, key message, offer, CTA 2–4 kata, phases) |
| brainstormCampaignIdeas / suggestPhaseContent | ✅ dalam detail campaign, sadar mission aktif & judul yang sudah ada | ✅ |
| generateThumbnail | ⚠ hanya Gemini, provider global sekarang DeepSeek → tombol gagal dengan pesan "needs the Gemini provider" | — |
| askBrandConsultant | ✅ sadar DNA + data live + tombol navigasi — contoh terbaik | ✅ MARKETING_FRAMEWORKS_CONTEXT (StoryBrand, This Is Marketing, STEPPS, SUCCESs, Cialdini) dipakai tanpa name-drop; ⚠ markdown mentah; snapshot salah untuk mission ladder |

## Yang sudah bagus (jadikan acuan)
- Brand DNA wizard: pertanyaan dipecah, `guide` + `principle` + contoh per field, AI sebagai "opsi untuk dipilih" bukan pengganti jawaban.
- beginner-home: 3 aplikasi terkunci berurutan + CTA "Langkah 1: …" + To Do konkret.
- Modal "Konten ini buat platform apa?" & "Mau cek apa?" di Content List: sederhana, Indonesia, tanpa jargon.
- Deskripsi milestone di mission ladder: bahasa sehari-hari yang tepat.
- AI Consultant: jawaban spesifik ("0 konten terbit", "rating Google 4.8") + tombol lompat ke layar.
- Tema terang & gelap keduanya rapi; layout responsif tidak ada yang terpotong di 542px.
