# Handoff — 2026-09-13/14 session (long session, 2 repos touched)

Lanjutin kerjaan di **dua project**:
- **Brandlab**: `/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA`, branch `feature/brand-guidelines-premium-redesign`
- **wpk-dp** (wepeka.com + admin dashboard): `/Users/wepeka/Documents/wpk-dp`, branch `master`

Semuanya masih **uncommitted** di kedua repo (standing rule: commit cuma kalau user eksplisit minta — belum pernah diminta). `npm run build` + `tsc --noEmit` + `eslint` semuanya **lolos bersih** di wpk-dp per akhir sesi ini. Brandlab dicek pakai `node --check` per file (nggak ada bundler/build step).

## Standing rules (masih berlaku)

- Server Brandlab lokal: port 8743 (`python3 serve.py`). Server wpk-dp lokal: port 3000 (`npm run dev`) — **keduanya sudah saya matikan** di akhir sesi ini, nyalain lagi kalau perlu.
- Brand test Brandlab: "English House Kediri" (a03c2d37-...), "Pinter Mandarin" **read-only jangan diubah**, "wepeka" (b4de8412-..., ownerId sekarang `iSwfTtIQm6VkYoHFbI6wl7BzBF53` = akun `wepekapparel@gmail.com`) = akun tim internal asli, sekarang **accountNumber #1, plan lifetime**.
- Akun `winsonpratamakho01@gmail.com` (uid `25p9scf3WNbXxlSu3NT3OFXxcmM2`) = akun test user sendiri, sudah di-set **accountNumber #2, plan lifetime, username @winsontest**.
- Git: jangan push/merge/deploy sendiri di kedua repo. Cuma commit kalau diminta eksplisit.
- **Jangan pernah tampilkan/echo isi private key** (Firebase service account, dsb) di chat — sudah ada polanya di sesi ini (baca file, proses via script, jangan `cat`/print isinya).

## Ringkasan besar — apa yang dikerjakan sesi ini

### 1. Brandlab: Sistem akun + paywall (Phase 1, dari rencana awal 6-fase)

Brandlab yang tadinya single-tenant (1 login bersama, semua data flat) sekarang multi-tenant:
- `js/account.js` (baru) — model `accounts/{uid}` (plan/status/brandLimit/accountNumber/username), signup email+Google, sistem username unik `@handle` ("Wepeka Account") via collection `usernames/{lowercased}`, nomor akun urut via counter Firestore (`meta/accountCounter`).
- `js/store.js` — semua collection (`brands`/`content`/`campaigns`/`routineTemplate`) sekarang punya `ownerId`, query di-filter per akun. `settings` jadi per-akun (dulu 1 doc global — ini penting, dulu API key AI dkk itu shared ke SEMUA akun).
- `firestore.rules` — ditulis ulang total (isolasi per-owner, plan/status cuma bisa diubah lewat Admin SDK).
- `js/views/login.js`, `js/views/pricing.js` — signup/Google, tombol bayar Midtrans (Snap) real (belum ada API key asli, masih placeholder).
- `api/midtrans/create-transaction.js`, `api/midtrans/webhook.js`, `api/cron/check-expiry.js` (baru, serverless Vercel) — harga dihitung server-side, webhook verifikasi signature, catat riwayat pembayaran ke koleksi `payments` (buat revenue tracking di admin).
- `js/views/brands.js` — limit 3 brand/akun.
- `scripts/migrate-ownerid.mjs` — migrasi satu-kali buat data lama (BELUM dijalankan ke prod oleh saya — sengaja, karena butuh service account key kamu sendiri; tapi migrasi manual buat 2 akun test di atas SUDAH saya lakukan langsung via console/script waktu insiden lockout).

**Bug nyata yang ketemu & dibenerin** (penting, baca ini kalau ada laporan "app-nya loading terus"):
1. `ensureAccountDoc` dulu SELALU pakai Firestore transaction, bahkan buat akun yang sudah ada (99% kasus) — transaction butuh round-trip jaringan yang jauh lebih rawan macet dibanding baca biasa. Sekarang: baca biasa dulu, transaction cuma kalau akun beneran baru.
2. `initStore()`'s error handler (permission-denied/network error) dulu nggak pernah nge-resolve promise-nya → app nyangkut selamanya di layar "Loading...". Sekarang tetap lanjut jalan (dengan toast error) walau salah satu collection gagal sync.

**BELUM SELESAI / butuh kamu**:
- Enable Google Sign-In di Firebase Console — **sudah dilakukan** kalau kamu ingat mengaktifkannya (cek ulang kalau ragu).
- Akun Midtrans belum ada — `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` masih placeholder.
- Firebase service account key **sudah kamu download** (`~/Downloads/wepeka-ba996-firebase-adminsdk-fbsvc-46efbb2190.json`) dan **sudah dipakai** buat isi `.env.local` wpk-dp (lokal). **BELUM diisi ke env var Vercel** (kedua project: Brandlab & wpk-dp) — perlu itu biar payment webhook & admin dashboard jalan di production.
- **Urutan deploy WAJIB**: (1) jalankan `scripts/migrate-ownerid.mjs` dulu ke prod, (2) deploy kode baru ke Vercel, (3) BARU deploy `firestore.rules` baru. Kalau rules dulu, tim ke-lockout dari data sendiri (sudah pernah kejadian, sudah dipulihkan).
- Urusan pindah kepemilikan project Vercel dari akun "marcelnich" (developer lama, masih pegang akses) ke akun user sendiri — **di-skip dulu**, belum diputuskan urutan/caranya.

### 2. wpk-dp: Dashboard admin Brandlab (`/admin/brandlab`)

- `src/lib/brandlab-db.ts` (baru) — akses Firestore Brandlab via Firebase Admin SDK dari sisi wpk-dp.
- `/admin/brandlab/overview` — statistik: total akun, breakdown per paket + revenue, pendaftar terbaru.
- `/admin/brandlab/accounts` — list + search (by ID/email/username) + form "Buat Akun Baru" (admin set email+password+paket langsung, skip Midtrans sepenuhnya).
- `/admin/brandlab/accounts/[uid]` — detail: ubah paket manual, Aktifkan/Read-only/Nonaktifkan, riwayat pembayaran.
- **PENTING**: `FIREBASE_ADMIN_PROJECT_ID`/`CLIENT_EMAIL`/`PRIVATE_KEY` sudah ada di `.env.local` LOKAL wpk-dp — **belum di Vercel production**.

### 3. wpk-dp: Form intake customer + auto-generate invoice/MoU (fitur baru, di luar Brandlab)

User minta: form publik buat customer isi data sendiri (brand, kontak, alamat, rekap ukuran apparel), masuk antrian admin, admin tinggal approve → auto keisi ke Generate Dokumen.

- `src/app/(store)/isi-data/page.tsx` (baru) — form publik, no-login. Kalau pilih "Apparel", muncul grid rekap ukuran XS–5XL (isi angka aja, BUKAN per orang) + tombol tambah ukuran custom (nama bebas + qty).
- `src/app/api/client-intake/route.ts` (baru) — endpoint publik nerima submission.
- `src/lib/db.ts` — `createSubmission`/`listPendingSubmissions`/`getSubmissionById`/`setSubmissionStatus` (tabel Supabase `client_submissions`, kolom `sizes jsonb`).
- `src/app/admin/documents/submissions/page.tsx` (baru, tab nav "Client Menunggu") — daftar submission, tombol "Jadikan Client" (auto redirect ke Generate Dokumen dengan client + size sudah ke-prefill) / "Tolak".
- `src/app/admin/documents/generate/page.tsx` — ini FILE LAMA `page.tsx` yang **dipindah** ke sini (lihat struktur baru di bawah).
- `src/components/admin/document-generator.tsx` — terima `prefillClientId`/`prefillSizes` buat auto-isi.

**Struktur folder `/admin/documents` berubah** (biar tab nav nggak nabrak — ada bug 2-tab-nyala-bareng yang ketemu & dibenerin dengan pola "root jadi redirect stub"):
```
/admin/documents            -> redirect ke /admin/documents/generate (file page.tsx baru, cuma redirect)
/admin/documents/generate   -> halaman utama lama (Client baru + Generate Dokumen + Dokumen Tersimpan)
/admin/documents/submissions -> halaman baru "Client Menunggu"
/admin/mou-content          -> nggak berubah
```
Pola yang sama SUDAH diterapkan duluan di `/admin/brandlab` (root=redirect, `overview` & `accounts` jadi leaf). Kalau nanti nambah tab baru lagi di hub manapun, **selalu taruh di leaf path terpisah**, jangan taruh konten di root hub kalau hub itu juga punya child page — itu penyebab bug-nya (`isPathActive` di `hub-tabs.tsx` dan `admin-hubs.ts` pakai prefix-match, `/admin/x` akan ke-anggap "active" juga buat semua `/admin/x/*`).

**BUTUH TINDAKAN KAMU SEBELUM FITUR INI BENERAN JALAN**:
- **Migrasi SQL BELUM dijalankan** — buka Supabase SQL Editor, jalankan isi `supabase/migrations/20260913_client_submissions.sql` (atau `RUN_ALL.sql` yang sudah include ini). Tanpa ini, submit form bakal gagal ("Gagal mengirim data").
- Setelah itu, test alur lengkap: isi `/isi-data` → cek muncul di `/admin/documents/submissions` → approve → cek ke-redirect ke Generate Dokumen dengan data ke-prefill.

## Item yang masih di-antrikan dari sesi-sesi sebelumnya (belum disentuh sesi ini)

- Limit AI usage + progress bar + top-up Rp10rb/hari (Phase 2 dari rencana awal — belum mulai sama sekali, butuh mindahin panggilan AI Brandlab ke server-side proxy dulu).
- i18n rollout ke 5 file besar Brandlab (`campaigns.js`, `creator.js`, `brand-dna.js`, `brand-builder.js`, `brand-guidelines.js`).
- Guide onboarding lebih detail + wajib isi deskripsi bisnis pas bikin brand baru (field-nya sudah ada, tinggal validasi).
- Auto-tracking campaign "Grow Social Media" + sync follower count dari dashboard ke campaign.
- Simplifikasi mode beginner (masih ada campaign/funnel field yang belum di-gate ke mode guided).

## Kalau mulai sesi baru

Kasih tahu Claude: **"Baca file .claude/next-session-prompt.md di folder [Brandlab/wpk-dp]"** (folder Brandlab yang paling lengkap konteksnya). Jangan langsung eksekusi item-item di atas tanpa ditanya dulu ke user mau prioritasin yang mana.

## Addendum — sesi 14 Sep 2026 (audit + revisi Brandlab)

Laporan audit lengkap: `.claude/audit-brandlab.md` (33 temuan). **Semua temuan sudah direvisi** di sesi ini kecuali yang sengaja ditunda:
- **#6 proxy AI server-side** — ditunda ke Phase 2 (limit AI). Sementara key AI global dibaca dari `settings/main` (lihat bawah).
- i18n: heading/CTA/empty state di jalur pemula sudah Indonesia semua, tapi string kecil di dalam file besar (calendar, content-list, brand-guidelines bagian dalam) masih campur — lanjutkan rollout i18n yang sudah diantre.

Perubahan utama (semua **uncommitted**, syntax-check + smoke test lolos, tidak ada error console):
- **Key AI global**: app membaca `settings/main` untuk semua akun (`store.js` `isGlobalAiActive/getGlobalAiSettings/updateGlobalAiSettings`, `account.js` `ADMIN_UIDS`, panel AI di `settings.js`, rule `settings/main` di `firestore.rules`). Risiko: key sampai ke browser semua user → proxy di Phase 2.
- **Mode default Guided** untuk akun tanpa pilihan eksplisit (`store.js` + `mode.js`). Akun tim internal yang belum pernah toggle akan mendarat di Guided sekali, tinggal klik toggle → tersimpan.
- **Tur**: satu tur aktif saja, teardown saat pindah route (kecuali onboarding), section-guide tidak menandai "seen" kalau kalah prioritas, step 1 juga dengar klik `#add-brand-quick`, langkah 11–15 Indonesia, `markTourDone` hanya untuk onboarding (`tour.js`, `section-guide.js`).
- **Komponen funnel bersama** `js/funnel-field.js` dipakai Creator, Content Editor, modal AI; label status versi Guided (`STATUS_LABELS_GUIDED`).
- **Campaigns Guided**: intro "Posisi kamu sekarang", aturan jadi accordion, edit/hapus milestone disembunyikan; **Custom campaign aktif di Advanced** (`openCustomCampaignFlow`); label status campaign Indonesia.
- **Ladder Grow Social/Personal (campaign baru saja)**: "Minggu aktif konsisten" jadi `auto-weeks` (dihitung dari publishedDate), "Engagement bermakna total" dihapus (dobel hitung), target konten mengikuti cadence (`uploadsPerWeek × minimal minggu`, min 8) — `createMissionsForTemplate(templateId, { startIndex, uploadsPerWeek })`.
- **Benchmark**: FCR default diturunkan (TOFU 1/0.3, MOFU 1.5/0.5, BOFU 2/0.7), MOFU ER avg 2.5; **override per platform** `settings.thresholdsByPlatform[platform][funnel]` (`updatePlatformThresholds`, `formulas.resolveThresholds`), UI di Pengaturan → Tolok Ukur dengan tooltip sumber.
- **Brand DNA**: template gabungan per step (`compose`), `voice: "third-person"` untuk audience/problem diteruskan ke `suggestBrandDnaOptions`, `parts` dipersist di `brandDNA.parts`, one-liner max 25 kata, top-up opsi kalau kurang dari `count`.
- **Consultant**: markdown ringan dirender, snapshot campaign bertingkat (level, bukan fase), chip pertanyaan awal.
- **Guidelines**: heading Indonesia, klaim "90 detik/90% warna" diganti, rekomendasi font terbuka default di Guided, progress hanya 4 bagian yang diisi user.
- Lainnya: health strip "Campaign di kalender" netral saat 0 campaign, dashboard empty state, deskripsi bisnis wajib ≥20 karakter, onboarding tidak dobel (banner vs kartu), routine/video disembunyikan saat 0 brand, CSS mobile (scroll-margin, FAB kecil), hub label "Brand DNA selesai · N tahap opsional".

Data uji di akun `fable-review@wepeka.com`: brand "Kopi Senja" + 1 konten + campaign "Naikin Followers IG Kopi Senja" (dibuat sebelum ladder diubah → masih pakai milestone lama). Boleh dihapus.

## Rencana berikutnya (diputuskan 14 Sep 2026 — eksekusi di sesi Opus)

Konteks penuh audit: `.claude/audit-brandlab.md`. Server lokal: `python3 serve.py` → http://localhost:8743. Akun uji: `fable-review@wepeka.com` / `FableReview2026!` (brand "Kopi Senja"). Key AI global sudah aktif untuk semua akun (provider DeepSeek) — tombol AI bisa langsung diuji. Pane browser bawaan sempit (±540px); emulasi viewport lebar memblokir klik, jadi klik di ukuran asli, screenshot boleh pakai emulasi.

**Jangan mulai sebelum tanya user mau prioritas mana.** Urutan yang disarankan:

### A. Sambung pipa integrasi (kode, kecil, dampak besar)
1. `js/views/creator.js:223` & `:718` — `generateScript` sekarang hanya dapat `brand.aiVoiceGuide`. Kirim `buildFullContext(brand, { campaigns })` (sudah ada di `js/ai.js`, belum dipakai siapa pun) + tone of voice; sesuaikan param `brandGuidelines` di `ai.js generateScript`.
2. `js/ai.js buildBrandContext` — tambahkan `brand.brandBuilder.personality`, `brand.brandBuilder.toneOfVoice` (4 spektrum + contoh pesan, lihat `brand-builder.js paintToneOfVoice`), `brand.brandGuidelines.visualDirection` & warna primer. Ini otomatis memperbaiki Consultant, campaign plan, brainstorm, value proposition.
3. Milestone `number` berlabel "Followers" terisi otomatis dari `instagram.js getAccountProfile().followers_count` kalau `brand.instagram` terhubung (+ tombol "Sinkron dari IG"); Shares/Saves total dari `content.performance`. Lokasi: `campaigns.js milestoneRowHTML/wireMissionJourney`, `store.js milestoneStatus`.
4. Tombol 👍/👎 + alasan di setiap hasil AI (DNA options, script/hook/caption, consultant, campaign plan) → koleksi Firestore `aiFeedback` (`{uid, brandId, feature, prompt, output, rating, note, createdAt}`) + rule tulis untuk pemilik. Fondasi eval set.
5. `js/proactive-notif.js` — notifikasi sadar campaign: streak `auto-weeks` akan putus dalam N hari, milestone belum diperbarui >14 hari.
6. Consultant bisa bertindak: tombol "Buatkan draft-nya" pada jawaban → `createContent({ title, funnel })`.
7. Sinkron performa otomatis mingguan lewat `instagram.js fetchMediaMetrics` untuk konten yang punya `publishedUrl`.

### B. UI dua mode — rename & alur (keputusan produk user)
- Rename "Guided/Advanced" → **"Pemula" / "Pro"** (`js/layout.js` tombol `#mode-toggle-btn`, `js/mode.js`), tampilkan label teks di HP.
- **Pilihan mode di login pertama**: dua kartu besar ("Aku pemilik usaha, baru mulai" / "Aku sudah biasa pegang sosmed") sebelum halaman Brands, simpan ke `settings.experienceMode`. Tempat: `js/main.js` setelah `initStore`, atau `js/brandlab-intro.js`.
- **Checklist 5 langkah** menetap di Beranda Pemula (`beginner-home.js`): Buat brand → Isi DNA → Warna & font → Campaign → Terbitkan konten pertama, tiap langkah tombol langsung; tur spotlight jadi opsional.
- **Navigasi Pemula 3 tab** (Beranda · Brand · Konten) di `js/layout.js`; sub-tab Content OS diganti "Tulis konten" / "Jadwal"; Kampanye jadi langkah di Beranda.
- Mobile Pemula: tombol Lanjut/Simpan sticky bawah (`brand-dna.js navHTML`, `brand-guidelines.js navHTML`), FAB Consultant → tombol "Tanya AI" di header saat wizard.
- Pro: widget/grafik tanpa data disembunyikan (bukan "—"), tooltip definisi ER/FCR/TOFU, sortir/filter tersimpan di Content List, ⌘K lompat cepat.
- Setiap istilah teknis di Pemula dapat tooltip lewat `js/help.js`.

### C. Playbook AI (user yang menulis, Claude buat kerangkanya)
Buat `js/knowledge/{hooks,platforms,benchmarks,branding}.md` (atau JS string) dan sisipkan per fitur di `js/ai.js` (script generator ← hooks+platforms; consultant ← semua). Tambah pass kedua "kritikus" untuk script & campaign plan. Fine-tuning belum perlu sebelum `aiFeedback` ≥500 contoh.

### Masih tertunda (butuh user)
Commit 30 file uncommitted; migrasi SQL Supabase (`supabase/migrations/20260913_client_submissions.sql` di repo wpk-dp); env var `FIREBASE_ADMIN_*` di Vercel; Midtrans key; proxy AI server-side (Phase 2).

## Daftar file yang diubah sesi 14 Sep 2026 (untuk cross-check saat commit)

File **baru**: `js/funnel-field.js` (picker funnel bersama + `STATUS_LABELS_GUIDED`), `.claude/audit-brandlab.md`.

File **diubah sesi ini**: `js/store.js`, `js/mode.js`, `js/formulas.js`, `js/account.js`, `firestore.rules`, `js/tour.js`, `js/section-guide.js`, `js/tour-prompt.js`, `js/ai.js`, `js/consultant-panel.js`, `js/i18n.js`, `js/views/campaigns.js`, `js/views/content-editor.js`, `js/views/creator.js`, `js/views/brand-dna.js`, `js/views/brand-guidelines.js`, `js/views/brand-builder.js`, `js/views/brand-home.js`, `js/views/beginner-home.js`, `js/views/brands.js`, `js/views/settings.js`, `js/views/dashboard.js`, `css/styles.css` (blok "Audit follow-ups" di paling bawah).

File yang tampil "modified" di git tapi **bukan** dari sesi ini (sisa sesi sebelumnya, belum di-commit): `js/auth.js`, `js/dom.js`, `js/facebook.js`, `js/icons.js`, `js/layout.js`, `js/main.js`, `js/brandbook-data.js`, `js/views/calendar.js`, `js/views/content-list.js`, `js/views/content-os.js`, `js/views/login.js`, `js/views/sales.js`, `.gitignore`.

Semua file di atas lolos `node --check`; smoke test di browser (Guided: beranda, campaign detail, editor konten, settings tolok ukur, typography, halaman brands) tanpa error console. Yang belum diuji lewat UI: pembuatan campaign baru (ladder baru diverifikasi lewat `createMissionsForTemplate` langsung) dan alur Custom campaign end-to-end.

## Addendum — 14 Sep 2026 (bagian A dikerjakan: 7 item "Sambung pipa integrasi")

Semua **uncommitted**. `node --check` lolos di semua file, uji unit Node (konteks brand, streak, total metrik, parser draft Consultant) lolos, semua modul ter-import bersih di browser. **Belum diuji lewat UI yang login** (Claude tidak boleh mengetik password) — perlu dicek manual.

1. **Creator** kirim `buildFullContext` (DNA + personality + tone of voice + visual + campaign aktif) ke `generateScript` (param baru `brandContext` + `campaignLine`); thumbnail pakai `buildBrandContext`. Tidak ada lagi `aiVoiceGuide` di creator.js.
2. **`ai.js buildBrandContext`** + `brandBuilderContextLines` (personality, 4 spektrum tone + contoh pesan + kata dihindari, hanya kalau stage sudah disimpan) + `brandGuidelinesContextLines` (visual direction, warna primer/sekunder/aksen). Otomatis ikut ke Consultant, campaign plan, brainstorm, value proposition.
3. **Milestone otomatis** (`campaigns.js`): Followers dari `getAccountProfile` (auto tiap ≥6 jam saat buka detail campaign, + tombol "Sinkron dari IG"); Shares/Saves dari `store.js contentMetricTotal` (+ tombol "Hitung dari konten"). Field baru per milestone: `source` ("instagram" | "content" | "manual") dan `updatedAt`. Angka yang diketik manual (atau lama tanpa source) tidak pernah ditimpa otomatis. Campaign dapat `igFollowersSyncedAt`.
4. **👍/👎** (`js/ai-feedback.js`) di: opsi Brand DNA, hooks/script/caption Creator, jawaban Consultant, draft campaign plan → koleksi `aiFeedback` (`store.js recordAiFeedback`). **Rule baru di `firestore.rules` (create-only oleh pemilik) — ikut urutan deploy rules yang sudah ada.**
5. **Notifikasi proaktif** sadar campaign: streak `auto-weeks` putus dalam ≤2 hari (`store.js streakBreakInDays`), angka milestone >14 hari tidak diperbarui. Kunci i18n baru `proactiveNotif.streak/staleMilestones/ctaPublish/ctaMilestones`.
6. **Consultant** bisa keluarkan `[[draft:FUNNEL|Judul]]` → tombol "Buatkan draft" → `createContent` → "Buka" ke Creator.
7. **Sinkron performa IG mingguan** (`js/instagram-sync.js`, dipicu dari `main.js` 8 detik setelah load, `brand.instagram.lastAutoSyncAt`). Tombol "refresh all" di Content List sekarang lewat modul yang sama dan menulis `performanceByPlatform.instagram` + total `performance` (dulu cuma `performance` datar, yang diabaikan kalau ada breakdown).

Bonus fix: "Coba opsi lain" di Brand DNA dulu menjatuhkan `voice` (batch kedua kehilangan sudut pandang orang ketiga).

Cek manual yang disarankan: buka detail campaign Grow Social di brand yang IG-nya terhubung; generate script dan lihat 👍/👎; tanya Consultant "konten apa yang cocok minggu ini?" lalu klik "Buatkan draft".

## Addendum — 14 Sep 2026: integrasi API Instagram "Segera hadir" untuk customer

Keputusan user: app mau dijual, jadi API Instagram per user **tidak dipakai dulu**. Semua fitur API Instagram hanya aktif untuk akun `wepekapparel@gmail.com` (uid `iSwfTtIQm6VkYoHFbI6wl7BzBF53`, `ADMIN_UIDS`). Satu pintu: `canUseInstagramApi()` di `js/account.js`.

Yang dikunci untuk akun lain: form koneksi Instagram di Edit Brand (diganti kartu "Segera hadir"), Import dari Instagram dan Refresh Semua Metrik (menu Daftar Konten, label "(Segera Hadir)"), tombol Ambil dari Instagram di editor konten, Account Overview di Dashboard, sinkron Followers milestone, dan sinkron performa mingguan. Shares/Saves dari data konten tetap jalan untuk semua akun (tanpa API).

**Belum dikunci** (user hanya menyebut Instagram): koneksi Facebook Page dan Marketing/Ads di Edit Brand, plus Import dari Facebook. Tanyakan kalau mau diperlakukan sama.

## Plan baru (14 Sep 2026): tur terpandu Content OS & Campaign

File: `.claude/plan-guided-tour-content-os.md`. Tiga tur berantai "belajar sambil ngerjain" (Creator → Kalender → Campaign) memakai engine `js/tour.js` yang diperluas (gate `change`/`until`/`clickAny`, `skippable`, `showIf`, bab). Belum dieksekusi — user berencana mengoper ke Opus/Sonnet. Kerjakan §2 (engine) dulu, lalu §3–§5 berurutan, cek §10.

## Addendum — 14 Sep 2026: tur terpandu §2 (engine) + §4 Kalender + §5 Campaign

Dikerjakan dari `.claude/prompt-tur-kalender-campaign.md`. Semua **uncommitted**, `node --check` lolos di semua file di bawah. **§3 (tur Creator) belum dikerjakan** — di luar cakupan tugas ini.

### File baru
- `js/guides/common.js` — `tourSeen/markTourSeen` (`localStorage contentos:guide-seen:<key>`), `setPendingTour/consumePendingTour/clearPendingTour` (`sessionStorage contentos:start-tour`), `offerNextTour`, `showTourRecap`, `startGuideOnMount` (pending → mulai paksa di kedua mode; selain itu `maybeShowSectionTour` sekali di Guided), `waitForIdle` (tur tidak mulai selama ada `.overlay`/`.tp-overlay`/tur lain, mis. modal Jadwal Kerja pertama kali atau tur hub Content OS), `wireGuideButton`, `adaptForAccount` (akun readonly: langkah `write` jadi skippable + hint), `replayGuideForBrand` (Pengaturan; pilih brand kalau lebih dari satu).
- `js/guides/calendar-guide.js` — prasyarat bank kosong (3 langkah) + 19 langkah §4.
- `js/guides/campaign-guide.js` — C1 list (+ cabang Event dan Custom), C2 detail: `buildMissionSteps`, `buildEventSteps`, `buildPhaseSteps`.

### File diubah
- `js/tour.js` — engine §2: gate `change`/`until`/`clickAny`; opsi `skippable`, `skipIfMissing`, `showIf`, `chapter`, `hint`, `waitTimeout`, `placement`, plus `dim: false` (tambahan: langkah drag di kalender butuh grid terlihat) dan `selector` boleh array fallback. Label Indonesia (Kembali/Tutup tur/Lanjut/Selesai, "Langkah X dari Y"), `onFinish("done"|"closed")` (pindah route tetap tidak memanggil onFinish), `body.tour-active`, reposition saat `db:change` + timer 300 ms. Gate didengar di `document` (capture) dan target di-resolve ulang saat event, karena Kalender/Campaign me-render ulang DOM tiap `db:change`. `resolveTarget` memilih elemen yang terlihat dulu. Back menelusuri langkah yang benar-benar tampil. Body tooltip mendukung `**tebal**` (di-escape). `startOnboardingTour` tidak diubah.
- `js/section-guide.js` — `maybeShowSectionTour(key, steps, options)` meneruskan `options` (backward-compatible).
- `js/views/calendar.js` — tombol Panduan di eyebrow page-head, `startCalendarGuideOnMount` sekali per mount di `render()`.
- `js/views/campaigns.js` — `TOUR_STEPS` lama dihapus; tombol Panduan di list (sudah ada) dan detail (baru), start sekali per mount di `render()`.
- `js/views/settings.js` — tombol "Ulangi panduan Kalender" dan "Ulangi panduan Campaign" di kartu Guided tour. Tombol Creator belum dibuat (tur Creator belum ada).
- `css/styles.css` — di blok `.tour-*`: `b` tebal, `.tour-skip-step`, `.tour-no-dim`, `body.tour-active .consultant-fab{display:none}`, padding tooltip di ≤720px.

### Selector/gate yang berbeda dari tabel plan (dan alasannya)
- Kalender 4: `.cal-cell.today` (fallback `.cal-cell:not(.outside)`), gate `click` → `until` `.date-bank-menu` muncul. Klik pada kartu konten di dalam sel tidak membuka menu, jadi gate klik bisa maju padahal menu tidak muncul.
- Kalender 9: `extraSelectors` ditambah `.overlay.center [data-close]` (tutup via ✕ juga lanjut).
- Kalender 10: gate `click` → `until .auto-schedule-list` (tunggu AI di langkah ini, hint menjelaskan). `showIf` juga butuh ada konten tanpa tanggal; kalau tidak, tombolnya cuma toast dan tur akan diam.
- Kalender 11: tanpa gate (menunggu sudah di langkah 10), `showIf` modal tinjau ada. Kalender 12: `extraSelectors` `#auto-schedule-cancel`, skippable.
- Kalender 16: `#cal-today` → `.cal-nav` (kontainer panah + Hari Ini, sesuai isi tooltip).
- Kalender prasyarat "Simpan": `until` drawer tertutup (simpan gagal karena judul kosong tidak ikut maju).
- Campaign C1 4: `#terms-agree` → `#terms-agree-label` (label pembungkus checkbox; checkbox-nya terlalu kecil untuk spotlight), gate tetap `change`.
- C1 5: isi tooltip kosong di plan → "Klik **Lanjut**."
- C1 6: gate `click` → `until #prompt-input` muncul. Jalur "Sudah, aku mau pilih mission" tidak menutup modal (pilih mission + Lanjut dulu).
- C1 7: `.overlay.center input.input` → `#prompt-input` (id asli di `modals.js promptDialog`).
- C2 8–9: plan "until lalu clickAny" dipecah: langkah 8 (`#brainstorm-ai`) `until` ide muncul, langkah 9 `clickAny` `[data-use-brainstorm-idea]`. Ditambah satu langkah `#bs-title` (tulis ide manual) saat tidak ada ide AI, supaya tanpa key AI tur tetap selesai (§8).
- C2 10: set pending `creator` kalau `tourSeen("creator")` false; kalau 400 ms kemudian masih di halaman detail (tidak ada ide disimpan), flag itu dihapus lagi.
- Kunci autoplay: `calendar`, `campaign-list`, `campaign-detail`. Kunci lama `campaigns` sengaja tidak dipakai untuk autoplay karena sudah terisi oleh tur 1 langkah lama, jadi tur baru tidak akan pernah autoplay untuk user lama. Kunci pending chain tetap `calendar`, `campaigns`, `campaign-detail`. `tourSeen("campaigns")` ditandai saat tur C2 selesai/ditutup.
- §2.3 (resume progres di sessionStorage) tidak dikerjakan (opsional di plan).

### Sudah diuji
- `node --check` semua file di atas; semua modul ter-import bersih di browser (tanpa login); jumlah langkah terbangun: Kalender 22 (3 prasyarat + 19), C1 tanpa campaign 15 (termasuk cabang Event/Custom), C2 event 10, C2 fase 5.
- Uji engine di halaman sintetis: `click` pada elemen yang di-render ulang, `clickAny` elemen kedua, `input` minLength, `change` (dan sudah-tercentang saat kembali), `until`, `showIf` false, target hilang, `skipIfMissing:false` di tengah layar, Back, "Lewati langkah ini", Esc → `closed`, Selesai → `done`, `hashchange` tanpa onFinish, `**tebal**` + escape HTML, viewport 375 px (tooltip di dalam layar), FAB Consultant tersembunyi selama tur.
- **Bug yang ketemu & dibenerin saat uji:** jalur lompat langkah (`showIf` false / target hilang / akhir langkah) keluar lewat `return` di dalam `try`, jadi pemanggilan langkah berikutnya setelah blok `finally` tidak pernah jalan dan tur membeku. Sekarang dipanggil di dalam `finally`.
- Cek statis: semua selector di kedua guide ada di source view terkait.

### Belum diuji (butuh login di pane browser — Claude tidak boleh mengetik password)
- Semua alur UI §10 untuk Kalender dan Campaign di akun `fable-review@wepeka.com` (brand "Kopi Senja"): drag ke tanggal, klik tanggal, Jadwal Kerja simpan, Auto-Schedule + konfirmasi, Minggu/Hari/Bulan, rantai Kalender → Campaign, C1 → C2 otomatis, Brainstorm → Creator, tombol Panduan list/detail/kalender di kedua mode, dua tombol Pengaturan, error console di halaman asli, dan regresi tur onboarding lama.

### Sisa pekerjaan
- §3 tur Creator (`js/guides/creator-guide.js`) + tombol "Ulangi panduan Creator" di Pengaturan + penawaran Kalender dari penutup tur Creator.
- §6 lain: pangkas `TOUR_STEPS` hub `content-os.js` (sekarang tombol Panduan hub masih tampil juga di tab Kalender, dan tur 3 langkah hub autoplay duluan saat kunjungan pertama; tur Kalender menunggu sampai itu selesai), redirect autoplay hub → Creator, tautan di `beginner-home.js`.

## Addendum — 14 Sep 2026 (lanjutan): perbaikan bug tur + 5 permintaan user

Semua **uncommitted**, `node --check` lolos. Bagian "Belum diuji" di addendum sebelumnya sebagian sudah terjawab di bawah.

### Bug yang dilaporkan user ("Selesai", "Lewati langkah ini", "Tutup tur" tidak jalan)
- **Membeku saat melompati langkah:** perbaikan `then?.()` di dalam `finally` (`js/tour.js showStep`) sudah ada di disk, tapi pane browser user masih menjalankan modul lama. Pindah hash tidak me-reload modul ES. Setelah reload penuh, "Selesai" menutup tur dan "Lewati" pindah langkah.
- **CSS:** `.tour-skip-step{display:block}` mengalahkan `[hidden]` bawaan browser, jadi tautan "Lewati langkah ini" tampil di semua langkah. Ditambah `.tour-skip-step[hidden]{display:none}`.
- **"Tutup tur":** di uji otomatis selalu menutup, baik kode lama maupun baru, dan tombolnya tidak tertutup elemen lain. Kemungkinan besar ikut gejala membeku. Tidak bisa direproduksi terpisah.
- **Onboarding "Yuk mulai":** dulu hanya klik kartu brand pertama yang memajukan tur. Sekarang `clickAny`, kartu brand mana pun.

### Permintaan user
1. **Autoplay hanya untuk user yang belum pernah tur di halaman itu.** Setelah pernah tampil, tur hanya jalan lewat tombol Panduan. Status "sudah pernah" sekarang disimpan di akun (`settings.guideSeen`, lewat `section-guide.js guideSeen/markGuideSeen`) selain localStorage. Flag lama yang hanya ada di localStorage disalin ke akun sekali. Akun readonly tetap hanya localStorage. `tourSeen/markTourSeen` di `js/guides/common.js` memakai kunci `tour:<key>` di map yang sama. Autoplay tetap hanya di mode Guided, yang jadi default akun baru.
2. **AI dummy selama tur:** `js/tour-demo.js` baru. `isTourDemo()` bernilai true selama `body.tour-active`. Dipakai di Jadwal Otomatis AI (`calendar.js runAutoSchedule`), Brainstorm Konten, draf campaign Custom, dan saran konten fase (`campaigns.js`). Tanpa API key, tanpa request ke provider. Hasil diberi label "Contoh", ada toast "Mode tur: ini contoh hasil AI, nggak makan token.", dan strip 👍/👎 tidak dipasang untuk draf contoh supaya tidak masuk `aiFeedback`. Langkah AI di kedua guide tidak lagi disembunyikan saat tidak ada key, dan copy-nya menyebut hasilnya contoh. Catatan: selama tur apa pun aktif, keempat tombol itu memakai contoh. Generate hook/script di Creator belum dibuat versi dummy karena tur Creator (§3) belum ada.
3. **Fetch Instagram untuk user biasa:** user bilang "nanti", jadi **belum diubah**. Kondisi sekarang, semua fitur API IG sudah dikunci `canUseInstagramApi()` (hanya akun wepekapparel) dan tampil sebagai "Segera hadir". Kalau mau dihilangkan sepenuhnya, titiknya: `content-editor.js:306`, `content-list.js:179/308/381`, `brands.js:587`, `instagram-import.js:16`, `dashboard.js:27`, `campaigns.js igConnected`.
4. **Onboarding tour highlight kartu app besar, bukan tab topbar:** Brand Builder, Kampanye, Content OS memakai `[data-app]` di beranda Guided, fallback `.brand-widget[data-go]` di beranda Advanced. Beranda, ganti brand, notifikasi, dan pengaturan tetap di topbar karena tidak punya kartu.
5. **Klik Brand Builder dulu sebelum DNA dan Guidelines:** langkah Brand Builder di onboarding sekarang ber-gate klik kartu. Tur lalu pindah ke hub Brand Builder, menyorot pintu Brand DNA lalu Brand Guidelines, lalu kembali ke beranda untuk Kampanye dan Content OS. Hub selalu dipakai walau kartu Guided menaut langsung ke tahap berikutnya.

### File diubah ronde ini
`js/tour.js`, `js/tour-demo.js` (baru), `js/section-guide.js`, `js/guides/common.js`, `js/guides/calendar-guide.js`, `js/guides/campaign-guide.js`, `js/views/calendar.js`, `js/views/campaigns.js`, `css/styles.css`.

### Diuji di browser (login, brand "English House Kediri", mode Guided, tanpa menulis data selain flag `guideSeen`)
- Tur detail campaign sampai Selesai + modal ringkasan. Tutup tur, Lewati, ide contoh muncul, 0 request AI.
- Tur Kalender sampai Selesai: buka bank, lewati drag, klik tanggal membuka menu, Jadwal Kerja ditutup lewat ✕, jadwal contoh 2 baris lalu dibatalkan, Minggu/Hari/Bulan. 0 request AI.
- Tur onboarding sampai tertutup: klik kartu brand, klik kartu Brand Builder, pintu DNA dan Guidelines di hub, target Kampanye/Content OS = kartu 286×325 (bukan tab 120×37), tidak ada tur halaman lain yang ikut autoplay.
- Flag akun tersimpan: `tour:calendar`, `tour:campaigns`.
- Console: hanya error 400 resource yang sudah ada sebelum perubahan, muncul bersama peringatan token Instagram "Followers sync".

### Belum diuji
Beranda mode Advanced (`.brand-widget`), C1 bikin campaign sampai C2 otomatis (menulis data), cabang Event/Custom, drag-and-drop dengan mouse asli, viewport 375 px di halaman asli, dan flag akun di perangkat kedua.

## Addendum — 14 Sep 2026 (lanjutan 2): terms "baca dulu", Custom "Segera hadir", badge rekomendasi

Semua **uncommitted**, `node --check` lolos.

1. **Tur campaign di Syarat & Ketentuan tidak lagi menyuruh centang atau klik Lanjut.** Langkah lama "Aturan main", "Setuju: Centang.", dan "Lanjut" diganti dua langkah di `js/guides/campaign-guide.js`:
   - "Baca dulu aturan mainnya": minta baca pelan-pelan sampai habis, tombolnya "Oke, aku baca dulu".
   - Langkah menunggu dengan `quiet: true`: overlay dan tooltip hilang total supaya teks bersih, lalu tur lanjut sendiri saat modal terms tertutup, lewat Lanjut maupun ✕.
   - Opsi engine baru di `js/tour.js`: `quiet` (CSS `.tour-overlay.tour-quiet{display:none}`) dan `nextLabel`.
   - Catatan: yang punya terms hanya Grow Personal Branding dan Event (`store.js MISSION_LADDERS` / `EVENT_PLAN_TERMS`). Grow Social Media langsung ke pertanyaan kalibrasi.
2. **Custom campaign "Segera hadir" di semua mode.** Kartu Custom di modal Campaign Baru jadi nonaktif ("Segera hadir — campaign dari satu kalimat tujuanmu lagi disiapkan."). `openCustomCampaignFlow` tetap ada di `campaigns.js` tapi tidak bisa diakses. Copy empty state mode Advanced tidak lagi menyebut template Custom. Cabang Custom di tur dihapus.
3. **Badge di Grow Social Media:** "Recommended campaign buat bangun social mediamu" (`CAMPAIGN_QUICK_TEMPLATES[].recommended`, kelas `.is-recommended` + `.campaign-reco-badge` di `css/styles.css`). Copy tur "Pilih tujuan" ikut menyebut rekomendasi ini.

File ronde ini: `js/tour.js`, `js/guides/campaign-guide.js`, `js/views/campaigns.js`, `css/styles.css`.

Diuji di browser (English House Kediri, tanpa membuat data): empat kartu template (badge hanya di Grow Social Media, Custom nonaktif, tombol Custom lama tidak ada di DOM); Event → modal terms → langkah "baca dulu" → "Oke, aku baca dulu" → overlay tersembunyi dan teks terms bisa diklik/digulir → tutup modal via ✕ → tur selesai (`done`), `body.tour-active` hilang.

## Addendum — 14 Sep 2026 (lanjutan 3): placeholder video penjelasan

Semua **uncommitted**, `node --check` lolos. Video belum direkam, jadi semua tampil sebagai placeholder "Video lagi disiapkan".

- **`js/guide-videos.js` (baru):** daftar video `GUIDE_VIDEOS` (`kenalan`, `creator`, `brand-dna`, `brand-guidelines`, `campaign`, `kalender`, `konten-dashboard`), masing-masing `{ title, duration, src: "" }`. Untuk mengisi video asli cukup isi `src` dengan URL .mp4/.webm atau link YouTube/Vimeo. Tidak ada CSP di `index.html`/`vercel.json`, jadi embed aman.
  - `videoKeyForGuide` memetakan kunci Panduan ke video. Content OS dipilih per sub-tab: creator, kalender, atau konten-dashboard.
  - `openGuideVideo` membuka modal pemutar.
  - `guideVideoButtonHTML` membuat tombol "Video". Kliknya ditangani satu listener delegasi di `document`.
- **Tombol Video di sebelah setiap Panduan:** `sectionGuideButtonHTML` sekarang membungkus Panduan dan Video dalam `.section-guide-actions`, jadi semua halaman yang punya Panduan otomatis dapat tombol Video tanpa ubah view.
- **Widget di tur:** opsi baru `runSpotlightTour(..., { video })` di `js/tour.js`. Widget "🎬 Tonton video penjelasan dulu" tampil di langkah pertama yang benar-benar muncul dan bisa ditutup (✕). Setelah ditutup, widget tidak muncul lagi di tur itu, termasuk saat Kembali. Kalau user pindah langkah, isi video dikosongkan supaya pemutaran berhenti.
  - Dipasang di tur section lewat `section-guide.js`, tur Kalender (`kalender`), tur Campaign list/detail (`campaign`), dan tur onboarding (`kenalan`).
- **Kartu "Video panduan setup" di halaman Brands:** teksnya tidak lagi menyebut koneksi Instagram/Facebook.
- **CSS:** `.section-guide-actions`, `.section-video-btn`, `.tour-video*`, `.guide-video-*`.

Diuji di browser: tombol Video muncul di tab Content OS dan page-head Kalender (baris tab tetap 2 anak, layout tidak rusak), serta di halaman Campaign; modal placeholder terbuka dengan judul dan catatan durasi; widget video muncul di langkah pertama tur Kalender, tertutup dengan ✕, tidak muncul di langkah 2 atau saat Kembali ke langkah 1, lalu Tutup tur bersih.

Belum diuji: Beranda mode Guided, karena akun uji sedang di mode Advanced saat pengujian. Belum diuji juga di halaman Brand Builder, Brand DNA, dan Guidelines.

## Addendum — 14 Sep 2026 (lanjutan 4): §3 Tur Creator Studio

Prioritas yang dipilih user dari daftar "Sisa pekerjaan" sesi sebelumnya. Semua **uncommitted**, `node --check` lolos di semua file di bawah. **Belum diuji lewat UI yang login** (Claude tidak boleh mengetik password) — pane browser cuma dicek modul ter-import bersih tanpa error di halaman pricing (belum login), tidak sampai memuat `creator.js`/`creator-guide.js` karena keduanya baru dimuat setelah login masuk ke brand.

### File baru
- `js/guides/creator-guide.js` — `buildCreatorSteps({ brandId })`, `startCreatorGuide(brandId)`, `startCreatorGuideOnMount(brandId)`. Satu siklus penuh: Bab 1 bikin konten (atau lompat ke konten yang sudah ada), Bab 2 generate AI (dummy), Bab 3 lengkapi & serahkan ke syuting, Bab 4 Syuting → Editing → Upload → Published. Penutup nawarin lanjut ke tur Kalender (`offerNextTour`) kalau `tourSeen("calendar")` masih false, kalau sudah pernah cukup `showTourRecap`.

### File diubah
- `js/views/creator.js` — tombol Panduan+Video di header (`sectionGuideButtonHTML("creator")`, video key `"creator"` sudah ada duluan di `guide-videos.js`), `startCreatorGuideOnMount(brandId)` sekali per mount di `render()`, `wireGuideButton` di `paint()`. **AI dummy**: `openAiScriptModal` sekarang punya `const demo = isTourDemo();` — kalau demo, bypass cek `hasAiKey` (modal tetap kebuka tanpa key), `runGenerate` dan kedua tombol Regenerate (hook/script) manggil `demoGenerateScript` (baru, `js/tour-demo.js`) bukan `generateScript` asli, toast `DEMO_TOAST`, dan strip 👍/👎 (`mountAiFeedback`) tidak dipasang buat hasil demo (sama seperti pola Custom campaign draft) — jadi hasil contoh nggak pernah masuk `aiFeedback`.
- `js/tour-demo.js` — `demoGenerateScript({ only })` baru, bentuk balikan sama seperti `ai.js generateScript` (`{ hooks, script, caption }`), menghormati `only: "hooks" | "script"` buat regenerate.
- `js/views/settings.js` — tombol "Ulangi panduan Creator" (`replayGuideForBrand({ startKey: "creator", path: ... "/content-os/creator" })`), taruh sebelum tombol Kalender/Campaign yang sudah ada.

### Selector/gate yang beda dari plan (dan alasannya)
- Langkah "strip 👍/👎, isi kalau sempat" di plan **dihapus** dari daftar langkah — karena AI dummy sekarang selalu dipakai selama tur aktif (`isTourDemo()` = `body.tour-active`), strip itu **tidak pernah dipasang** selama tur berjalan (disengaja, biar hasil contoh tidak masuk eval set), jadi langkahnya nggak akan pernah muncul. Daripada nyimpen step mati, langsung dihapus.
- Semua langkah AI (`#ai-generate-all`, dst.) **tidak** di-`showIf: hasAiKey` seperti draf awal plan — sengaja disamakan sama pola tur Kalender/Campaign yang sudah ada duluan: AI dummy jalan terus selama tur, jadi nggak butuh key sama sekali, kunci Pengaturan → AI tetap dipakai normal di luar tur.
- Bab 1 (drawer Content Editor) pakai selector `.overlay .drawer #f-title/#f-idea/#f-campaign/[data-save]` (bukan `#f-title` polos) — id-nya sama persis dengan field Creator sendiri di baliknya, pola yang sama yang sudah dipakai `calendar-guide.js`.
- Cabang awal: kalau brand sudah punya konten yang belum terbit (`status !== "published"`), Bab 1 diganti 1 langkah `clickAny .creator-item` lalu langsung ke Bab 2 — sesuai plan.

### Belum diuji (butuh login di pane browser — Claude tidak boleh mengetik password)
Seluruh alur UI Creator: Bab 1 bikin konten baru dari nol, cabang "sudah ada konten", AI dummy generate hook/script/caption + Regenerate, teleprompter buka/tutup, checkbox Ide selesai → Execution → Editing → Ready to Upload → Published, tombol Video/Panduan di header (mode Guided & Advanced), tombol "Ulangi panduan Creator" di Pengaturan, dan rantai penutup Creator → tawaran Kalender.

### Sisa pekerjaan (belum berubah dari sesi sebelumnya, kecuali §3 di atas)
1. ~~§3 Tur Creator Studio~~ — **selesai di atas**.
2. ~~§6 sisa~~ — **selesai, lihat addendum berikutnya di bawah**.
3. **Video asli:** kalau user sudah kirim link video, isi `src` di `js/guide-videos.js`.
4. **Hilangkan fetch Instagram untuk user biasa** — masih ditunda ("nanti").
5. **Uji yang belum:** semua item addendum sebelumnya (Beranda Guided, Brand Builder/DNA/Guidelines, C1→C2 nulis data, drag-and-drop asli, viewport 375px) + item Creator + item hub di bawah.
6. ~~Cek temuan campaign hilang di akun tim~~ — **dikonfirmasi user (14 Sep 2026): itu perbuatan user sendiri, bukan bug tur.** Tidak perlu diselidiki lebih lanjut.

## Addendum — 14 Sep 2026 (lanjutan 5): §6 beres-beres hub Content OS

Semua **uncommitted**, `node --check` lolos. Modul dicek ter-import bersih (halaman belum-login, `content-os.js` sendiri tidak eager-loaded jadi belum tersentuh langsung) — **belum diuji lewat UI login**.

### File diubah — `js/views/content-os.js`
- **`TOUR_STEPS` hub dipangkas dari 3 langkah (Dashboard/Kalender/Creator Studio, masing-masing nyorot satu tab) jadi 1 langkah** yang nyorot `.cos-tabs` (seluruh tab bar) sekaligus, tanpa gate — karena Creator dan Kalender sekarang punya Panduan+tur sendiri, hub nggak perlu lagi jelasin keduanya satu-satu.
- **Tombol Panduan hub + tur 1-langkahnya sekarang cuma tampil di tab Dashboard dan Konten** (`hubGuideOwnsThisTab = activeSub !== "creator" && activeSub !== "calendar"`) — sebelumnya tombol Panduan hub ini nongol juga di tab Kalender dan Creator, dobel sama tombol Panduan masing-masing yang sudah ada di page-head-nya sendiri.
- **Redirect autoplay pertama hub → Creator**: begitu masuk ke `render()` dengan `activeSub === "dashboard"` (rute hub polos), mode Guided, hub belum pernah dilihat (`!guideSeen("content-os")`), dan tur Creator belum pernah dilihat (`!tourSeen("creator")`) — set `setPendingTour("creator")` lalu `location.hash` langsung ke `.../content-os/creator`, **sebelum** apa pun di hub dirender (return awal, sama pola kayak redirect `!brand`). Begitu tur Creator sudah pernah (`tourSeen("creator")` true — abis tur kelar, atau habis diulang dari Pengaturan), redirect ini berhenti dan hub jalan normal, termasuk tur 1-langkahnya sendiri kalau belum pernah.

### Kenapa "tautan Mulai panduan di beginner-home.js" (bagian ke-3 dari item ini) **tidak ditambah**
Dicek dulu: `js/views/beginner-home.js` kartu Content OS **sudah** ngarah langsung ke `#/brand/:id/content-os/creator` ("Langkah 1: Tulis konten pertama") begitu brand belum punya konten. Karena Creator sekarang sudah punya autoplay sendiri (`startCreatorGuideOnMount`, dibikin di addendum sebelumnya) yang jalan otomatis begitu mode Guided + belum pernah dilihat — **apa pun jalan masuknya** (klik kartu ini, klik tab Creator langsung, atau kena redirect hub di atas) — nambah tombol "Mulai panduan" terpisah di kartu ini cuma bakal dobel sama yang udah otomatis jalan. Ditinggal apa adanya; kalau nanti checklist 5-langkah Beranda Pemula (Rencana B) beneran dibikin, sisipkan link `startKey: "creator"` di langkah "Terbitkan konten pertama"-nya di situ.

### Belum diuji (butuh login)
Kunjungan pertama akun Guided baru ke Content OS lewat rute hub polos (harus langsung lompat ke Creator + tur Creator autoplay di sana, bukan nyangkut di hub); tur 1-langkah hub muncul sekali di tab Dashboard/Konten setelah tur Creator pernah dilihat; tombol Panduan TIDAK dobel lagi di tab Kalender dan Creator; akun yang sudah pernah lihat hub versi lama (`guideSeen("content-os")` sudah true) tidak ke-redirect tapi tetap dapet tur Creator otomatis begitu masuk tab Creator.

## Addendum — 14 Sep 2026 (lanjutan 6): fitur baru Copy Studio ("Bikin Tulisan")

Permintaan user: generator tulisan pendek (Threads, caption Story, broadcast WhatsApp, caption feed, format lain) dari 3 pertanyaan (buat apa, tujuan apa, mau nyampein apa), letaknya di beranda brand. Semua **uncommitted**, `node --check` lolos semua file.

### Keputusan user
- Halaman sendiri `#/brand/:id/copy` + pintu masuk di **kedua** beranda (bukan tab Content OS, bukan ganti kartu Sales).
- Semua format masuk v1: Threads (satu post / thread berantai), Caption Story, Broadcast WhatsApp, Caption feed, Lainnya (ketik sendiri).
- **Hasil tidak disimpan sama sekali**: tidak ada koleksi Firestore, tidak ada "Jadikan konten", tidak ada perubahan `firestore.rules`. State hidup selama halaman terbuka saja (halaman sengaja tidak repaint di `db:change`).
- Guided: wizard 3 layar (kartu besar, auto-lanjut). Advanced: satu form ringkas (chip).

### File baru
- `js/views/copy-studio.js` — halaman: wizard/form, validasi kolom wajib (tombol Generate mati + petunjuk "Isi dulu: …"), 3 varian dengan **preview mirip aslinya** (kartu Threads + garis thread + penghitung x/500 merah kalau lewat, gelembung chat WA dengan `*tebal*`/`_miring_`/`~coret~`, bingkai Story 9:16 + saran stiker, post feed + hashtag berwarna, kartu polos untuk Lainnya). Aksi per varian: Salin / Salin semua, "Salin post ini" per post thread, **Buka di WhatsApp** (`wa.me/?text=`, tanpa API), Edit manual, chip **Pendekin / Lebih santai / Lebih jualan**, 👍/👎 (`aiFeedback`, feature `copy-<format>`). Pengingat kalau Brand DNA/tone of voice masih kosong. Tur Panduan 9 langkah (autoplay sekali di Guided) + tombol Video.
- `js/knowledge/copy-formats.js` — satu sumber untuk format, tujuan (termasuk kolom per tujuan, mana yang wajib), panjang, dan instruksi rewrite; dipakai halaman (label) dan `ai.js` (aturan prompt). Bibit "Playbook AI" (rencana C).
- `js/voice-input.js` — `wireMic` dipindah dari `creator.js` supaya dipakai ulang; sekarang juga memicu event `input` setelah dikte.

### File diubah
- `js/ai.js` — `generateCopy` dan `rewriteCopy` (+ `parseJsonObject`, `normalizeCopyVariant`, `COPY_FACTS_RULE`). Konteks brand lewat `buildFullContext`. Aturan penting di prompt: **fakta tetap** (nama, angka, harga, tanggal, kontak persis), **dilarang mengarang** testimoni/nama/rating/diskon/deadline/stok; **testimoni dikutip verbatim** dan hanya diatribusikan ke nama yang diberikan (kalau kosong: "salah satu pelanggan kami"); WA tanpa placeholder `{nama}` + baris opt-out "Balas STOP". Output JSON `{variants:[{parts,note}]}`, parsing tahan fence/teks sebelum-sesudah JSON, fallback teks mentah. max_tokens 3500 untuk thread berantai, 1800 lainnya.
- `js/tour-demo.js` — `demoGenerateCopy`, `demoRewriteCopy` (testimoni tetap persis; hasil berlabel "Contoh"; strip 👍/👎 tidak dipasang untuk output demo).
- `js/main.js` — rute `copy`. `js/views/brand-home.js` — widget `copyWidgetHTML` (featured) di baris Campaign; **Sales jadi 1 kolom** (sebelumnya 2) supaya grid tetap rapi. `js/views/beginner-home.js` — baris **"Alat cepat" → Bikin Tulisan** di bawah kartu app, tidak dikunci. `js/i18n.js` — `brandHome.widget.copy.*`. `js/help.js` — entri `copy-studio`. `js/guide-videos.js` — video `copy` (placeholder, `src` kosong) + mapping `copy-studio`. `js/views/creator.js` — import `wireMic` dari modul baru. `css/styles.css` — blok "Copy Studio" di paling bawah (token `--copy` dan warna chat WA untuk tema gelap/terang, preview, wizard, `.copy-preview .avatar` karena `.avatar` tidak punya gaya dasar).

### Perbaikan engine tur (`js/tour.js`) — berdampak ke SEMUA tur
Ketemu saat uji: kalau tooltip terlalu tinggi untuk muat di atas maupun di bawah target (kasus nyata: langkah pertama yang membawa widget video), `position()` menaruh tooltip **menimpa target**, sehingga klik yang ditunggu gate justru kena tooltip dan tur macet. Sekarang: di samping target kalau ada ruang; di layar sempit, di ruang kosong yang lebih besar (atas/bawah) dengan `max-height` + scroll di dalam tooltip (`setTooltipCap`); scroll tooltip dipertahankan saat reposition tiap 300 ms. Kasus yang muat di atas/bawah perilakunya identik dengan sebelumnya. Diuji: 1024×768 (tooltip di samping, klik kena target) dan 280×648 (tooltip di atas dengan cap 216px, klik kena target). **Tur Kalender/Campaign/Creator/onboarding belum diuji ulang di halaman asli** setelah perubahan ini.

### Cara uji yang dipakai (tanpa login)
Harness sementara `_copy-harness/` (sudah **dihapus**): memuat `copy-studio.js` asli + CSS asli, dengan `store.js`/`account.js` di-stub lewat import map dan endpoint DeepSeek dipalsukan (tidak ada request ke provider, tidak ada data tersentuh). Plus uji Node untuk prompt/parsing `generateCopy`/`rewriteCopy` dengan `fetch` palsu. Flag `contentos:section-guide-seen:copy-studio` yang terpasang di localStorage `localhost:8743` selama uji sudah dihapus lagi.

Lolos: wizard Guided (format → tujuan → isi, tombol Kembali, chip ganti format/tujuan), form Advanced, tema terang, gerbang kolom wajib, generate WA promo (prompt membawa produk/harga + aturan tujuan), thread berantai (3 post, penghitung 563/500 merah, salin per post, max_tokens 3500), Pendekin (hanya varian itu yang berubah), Edit manual, format WA tebal/miring/coret (bug miring sebelum titik dua ketemu dan dibenerin), tur autoplay tanpa API key (pakai demo), tombol Panduan replay, 0 error console.

### Belum diuji (butuh login di app asli)
Rute asli `#/brand/:id/copy` dari router; widget di beranda Advanced (grid baru Campaign + Copy Studio + Sales) dan baris "Alat cepat" di beranda Guided; kualitas output AI sungguhan (DeepSeek) terutama kepatuhan testimoni verbatim dan batas 500 karakter Threads; tombol Salin (clipboard) dan Buka di WhatsApp di browser nyata; mic; tampilan 375 px di halaman asli; regresi tur lain setelah perubahan `tour.js`.

### Catatan untuk Phase 2 (limit AI)
Copy Studio menambah panggilan AI yang sering (generate 3 varian + rewrite per varian). Waktu limit AI + proxy server-side dikerjakan, `generateCopy` dan `rewriteCopy` wajib ikut dihitung.

## Addendum — 14 Sep 2026: Copy Studio ("Bikin Tulisan") — format dibedakan & diakuratkan

Keluhan user: hasil Threads / Caption Story / Broadcast WA / Caption feed kelihatan sama semua. Penyebab: aturan per format di prompt cuma 3–4 baris tanpa larangan silang, jadi model menulis semua format dengan pola caption; angka batas juga tidak akurat (feed ditulis 1.500, aslinya 2.200 dan hanya ±125 karakter pertama tampil).

Diubah (**uncommitted**, `node --check` lolos, preview dicek visual lewat harness di browser karena Claude tidak boleh login):
- `js/knowledge/copy-formats.js` — tiap format sekarang punya `limit`, `spec` (strip Indonesia untuk UI), dan `rules` dengan bagian "Shape" + "NEVER" (larangan kebiasaan format lain). `FORMAT_CONTRAST` ditempel ke semua format ("format menentukan bentuk, tujuan menentukan isi"). Angka: Threads 500/post; Story ±120 total, CTA lewat stiker (jenis stiker yang benar-benar ada: polling 2–4 opsi, kuis, kotak pertanyaan, slider emoji, link, countdown, lokasi); WA ±700 dengan urutan sapaan→isi→cara balas→STOP; feed 2.200 (IG) dengan hook di 125 karakter pertama, hashtag 3–8 di baris terakhir, tanpa *tebal*/URL. `KNOWN_CUSTOM_FORMATS` untuk "Lainnya": bio Instagram 150, bio TikTok 80, post X 280. Helper baru: `formatSpec`, `formatLimit`, `knownCustomFormat`.
- `js/ai.js` — `generateCopy`/`rewriteCopy`: heading aturan format diberi prioritas di atas prinsip marketing, ada instruksi self-check terhadap NEVER list & batas sebelum menjawab.
- `js/views/copy-studio.js` — strip spesifikasi format (`.copy-spec`) di bawah pilihan format (kedua mode, ikut berubah saat mengetik format "Lainnya"); tag format di header hasil; penghitung karakter per format (`charMetaHTML`, merah kalau lewat; Threads per post); preview feed dilipat di 125 karakter dengan tombol "… lainnya"; saran stiker Story digambar sebagai stiker di frame.
- `js/tour-demo.js` — contoh tur per format dibedakan (Threads single tanpa sapaan/hashtag, Story 2 baris, feed dengan hashtag).
- `js/help.js` — teks bantuan Copy Studio menjelaskan beda tiap format.
- `css/styles.css` — blok "Copy Studio: format spec strip + platform-accurate previews" di paling bawah.

Belum diuji: hasil AI nyata setelah prompt baru (perlu login + key AI). Cek manual: generate Threads vs Caption feed untuk pesan yang sama dan bandingkan.

## Addendum — 14 Sep 2026: Lampu (fill light) di Teleprompter

`js/views/teleprompter.js` — tombol **Lampu** di baris kontrol. Saat aktif, latar overlay di sekeliling panel jadi bidang cahaya (`--tp-light` = `color-mix(warna, terang%, #000)`), panel mengecil (56vw × 70vh) supaya area cahaya lebih luas, klik latar tidak menutup teleprompter. Kontrol: slider Terang 20–100%, 5 preset warna (putih, hangat, dingin, pink, hijau) + picker warna bebas. Pengaturan terakhir disimpan di `localStorage contentos:tp-light`. Bonus: tombol layar penuh (`requestFullscreen`, ikon baru `expand` di `js/icons.js`) dan Screen Wake Lock (best effort, butuh HTTPS) supaya layar tidak mati saat take. CSS di blok "Teleprompter fill light" paling bawah `css/styles.css` (+ util `.sr-only`). Diuji lewat `openTeleprompter` langsung di browser: tanpa error console. Tur creator (`#tp-play`, `#tp-close`) tidak berubah.

## Addendum — 15 Sep 2026: Campaign "Completion Paths" (analisis, belum ada kode)

User minta Campaign jadi lapisan orkestrasi: tiap milestone tahu sumber datanya, jalur update & improve, navigasi bawa konteks, auto-complete. Hasil audit + desain lengkap di **`.claude/plan-campaign-orchestration.md`** (registry sumber metrik, `brand.insights`, Next Action engine, nav-context, layout detail baru, migrasi read-time, 5 tahap eksekusi, 7 keputusan yang butuh user di §11). **Jangan mulai Tahap 1 sebelum user menjawab §11.**

## Addendum — 15 Sep 2026: Setup campaign Event jadi 3 langkah + fase menyesuaikan sisa waktu

**Uncommitted**, `node --check` lolos, wizard diuji visual di browser lewat harness (modul di-import ulang dengan export sementara; tombol Buat campaign tidak ditekan karena butuh login), logika fase diuji lewat `buildEventPhases` langsung di browser.

- `js/views/campaigns.js`: `openEventRoleSelect` + `eventFieldHTML` + `openEventSetupForm` (form 10–13 field) diganti `openEventSetupWizard`: (1) peran (+ tipe partisipasi kalau peserta), (2) nama, tanggal event, mulai promosi (default hari ini), lokasi opsional, dengan baris hint sisa hari (hijau cukup / amber mepet / merah tanggal lewat), (3) skala sebagai 4 kartu tier (bukan angka), tujuan (chip), dan ringkasan timeline yang akan dibuat (fase + tanggal nyata + catatan fase yang digabung). `finishEventCampaign` sekarang menerima `scaleId` langsung; `eventPlan.setup` hanya `{ eventName, eventDate, campaignStartDate, eventLocation }`. Field lama (budget, ukuran booth, platform, performa sebelumnya, audiens sosmed, target-target) dihapus karena tidak pernah dibaca kode mana pun. Header detail event: "Event 24 Sep · 9 hari lagi" + catatan fase gabungan (`eventCountdownLabel`).
- `js/store.js`: `EVENT_SETUP_FIELDS` dihapus; `buildEventPhases` memadatkan offset fase pra-event ke sisa waktu nyata (`nominalEventRunway` = offset fase pertama + 14 hari), fase yang tidak kebagian hari digabung ke fase pra-event terakhir yang muat (`mergedFrom`), `dateLabel` jadi tanggal nyata ("15–23 Sep", "Hari-H · 10 Okt"), field `preEvent` di fase. Helper baru diekspor: `formatEventDate`, `formatEventRange`, `daysBetween`, `nominalEventRunway`, `localISODate` (yang lama diekspor + default arg). **Bug lama diperbaiki**: `addDays` memakai `toISOString` (UTC) sehingga di WIB semua offset fase mundur satu hari.
- `js/guides/campaign-guide.js`: langkah tur setup event sekarang menunggu `.ev-wizard` tertutup (gate `until`), bukan klik `#ef-submit`.
- `css/styles.css`: blok "Event setup wizard".
- Campaign event lama (dibuat sebelum ini) tetap memakai `dateLabel` gaya "T-30 → T-14"; tidak dimigrasi.

## Addendum — 15 Sep 2026: Rekonstruksi Campaign (Tahap 1–4 dari `plan-campaign-orchestration.md`) — SELESAI, uncommitted

Semua file lolos `node --check`; halaman detail (ladder + event), engine, registry, dan modal diuji lewat harness di browser dengan data buatan (tanpa login). **Belum diuji dengan data Firestore nyata** — cek manual yang disarankan ada di bawah.

**Baru**
- `js/campaign-metrics.js` — registry sumber metrik (`METRIC_SOURCES`, `metricSource`), `normalizeMilestone` (read-time, tanpa migrasi disk), `campaignStages` (ladder/event/phase → satu bentuk), `activeStageIndex`, `readMilestone`/`readStage`, `campaignHeadline`, `ladderAdvanceState` (target + `MISSION_MIN_WEEKS`), `campaignActivities`, `PIPELINE`, `ageLabel`, `STALE_DAYS=7`.
- `js/next-action.js` — `nextActions(ctx, limit)` 11 aturan berprioritas + `brandTopAction`.
- `js/nav-context.js` — `go(hash, ctx)`, `consumeNavContext`, `noteNavigation`, `returnTo`, `clearNavContext` (slot sessionStorage `contentos:nav-ctx`, TTL 10 menit; event `nav:context` kalau route sama).
- `js/views/insights-modal.js` — `openInsightsModal({ brandId, onSaved, reason })` → `updateBrandInsights` (followers, reach 30 hari, kunjungan profil, tanggal; tombol API untuk akun admin).
- `js/views/campaign-detail.js` — `paintDetail` layout tunggal: headline → Langkah berikutnya → pill tahap → milestone (dot progres, sumber + umur data, satu tombol aksi, menu ⋯ di Pro) → "Catat angka manual" (sheet) → Aktivitas (pipeline chips → Daftar Konten terfilter, Brainstorm, Konten baru, 5 konten terakhir) → Skor event. Auto-advance level (microtask) + kartu perayaan; Pro: menu ⋯ (tambah checklist/angka manual, paksa naik level). `openBrainstormModal` pindah ke sini; setelah simpan → `go()` ke Creator pada ide pertama.

**Store** (`js/store.js`): `brand.insights[platform]` + `brand.insightsHistory` (cap 60) via `updateBrandInsights`/`getBrandInsights`/`insightsBaseline`; `campaign.manualMetrics[milestoneId]` via `setCampaignManualMetric`; `completeCampaignStage`; ekspor `consecutiveActiveWeeks`, `MISSION_MIN_WEEKS`, `localISODate`. **Dihapus**: `milestoneStatus`, `missionCanAdvance`, `eventMilestoneStatus`, `EVENT_SETUP_FIELDS`.

**Diubah**: `campaigns.js` (detail lama dibuang seluruhnya, kartu list tampil headline + aksi), `consultant-panel.js` (snapshot dari engine + id campaign, `[[goto:campaign:ID]]`, `[[open:insights]]`, draft terkait campaign aktif), `ai.js` (prompt directive baru), `proactive-notif.js` (aturan campaign = `brandTopAction` prioritas ≤4; DNA dapat CTA), `beginner-home.js` + `brand-home.js` (kartu/widget campaign = aksi teratas + deep link ke detail), `dashboard.js` (kartu "Profil Instagram" dari `brand.insights` + sparkline riwayat), `creator.js` (konsumsi nav-context: pilih konten / picker konten baru dengan campaign terisi; picker menerima `defaults`), `calendar.js` (nav-context: bank terbuka, item disorot, filter campaign; timeline event per fase + bintang hari-H), `content-list.js` (nav-context: filter campaign + Quick Fill langsung untuk `intent:"performance"`), `content-editor.js` (dropdown fase disembunyikan untuk campaign ladder), `layout.js` (chip "← Kembali ke …"), `main.js` (`noteNavigation`), `guides/campaign-guide.js` (tur detail = layout baru, `#cd-brainstorm`), `help.js`, `css/styles.css` (blok "Campaign detail" + kalender).

**Keputusan §11 yang dipakai (asumsi, belum dikonfirmasi user)**: Grow Social hitung semua konten brand tapi hanya yang terbit; komentar otomatis dari `performance.comments`; naik level otomatis (Pro bisa paksa); insights Instagram saja; riwayat 60; custom/phase campaign ikut layout baru; Sales Tracker = stub manual dengan catatan.

**Cek manual dengan akun uji**: (1) buka campaign Grow Social lama → milestone Followers harus tampil dari nilai legacy ("Instagram Insights · X hari lalu"), lalu Perbarui Insights → angka pindah ke `brand.insights`; (2) klik aksi "Buka di Creator" → Creator memilih konten itu + chip Kembali; (3) Brainstorm → simpan ide → Creator membuka ide itu; (4) "Isi performa" → Daftar Konten langsung buka Quick Fill; (5) event campaign lama masih tampil (label fase lama "T-30 → T-14" tetap); (6) Kalender bulan dengan event campaign → segmen fase + ★ hari-H; (7) Beranda Pemula kartu Campaign → langsung ke detail campaign.

**Belum dikerjakan dari plan**: §12.2 Rencana Aktivitas (papan brainstorm per fase + `campaignTag`/`milestoneId` di konten), §12.4 tipe event, §12.5 Catat Hari-H, §12.6 laporan event; i18n string baru masih Indonesia hard-coded; Tahap 5 (hapus kunci i18n `proactiveNotif.streak/staleMilestones/ctaPublish/ctaMilestones` yang tidak dipakai).

## Addendum — 15 Sep 2026: Mode Pemula "nggak perlu mikir" (bagian B dari rencana 14 Sep)

Permintaan user: guided mode harus bisa diikuti orang awam yang nol soal branding/marketing, tanpa bikin pusing. Semua **uncommitted**, `node --check` lolos, dicek visual lewat halaman uji sementara (sudah dihapus) di desktop + viewport 375px, tanpa error console dari kode baru.

### Yang berubah
- **Rename Guided/Advanced → Pemula/Pro** di UI (`js/mode.js` `MODE_LABELS`, `js/layout.js` `modeToggleTitle/modeToggleInnerHTML`). Kunci internal tetap `guided`/`advanced` (tersimpan di settings semua akun, dicek di banyak view). Label "Pemula"/"Pro" sekarang tetap tampil di HP (override `#mode-toggle-btn.mode-toggle span` di ≤560px).
- **Layar pilih mode saat login pertama** — `js/mode-picker.js` (baru), dipanggil dari `main.js` setelah `initStore` kalau `hasChosenMode()` false. Dua kartu: "Aku pemilik usaha, baru mulai" (Pemula, badge rekomendasi) / "Aku sudah biasa pegang sosmed" (Pro). Menyimpan `settings.experienceMode` + `settings.experienceModeChosen: true`. Saat layar ini tampil, intro modal + banner tur **tidak** ikut muncul di boot itu (biar nggak numpuk); mereka kembali normal di boot berikutnya. Akun yang `experienceMode === "advanced"` dianggap sudah memilih (tidak pernah lihat picker). Akun tim yang masih default guided tanpa flag akan lihat picker **sekali**.
- **Pemula + 1 brand: langsung masuk ke brand** di route pertama setelah boot (`main.js` `firstRouteAfterBoot`), bukan halaman "pilih brand" dengan satu pilihan. Navigasi manual ke "Semua Brand" tetap diam di halaman brands.
- **Navigasi Pemula 3 tab**: Beranda · Brand · Konten (`layout.js` `GUIDED_TABS`, dengan `matches` per route: campaigns → Beranda aktif, dna/guidelines → Brand, copy → Konten). Sales Tracker dan link wepeka.com disembunyikan di Pemula (masih bisa lewat URL).
- **Beranda Pemula ditulis ulang** (`js/views/beginner-home.js`): satu kartu hero "Langkah N dari 5" dengan satu tombol (`#journey-hero`), plus daftar perjalanan 5 langkah (`#beginner-journey`): Bikin brand → Kenalin usahamu ke sistem (Brand DNA) → Pilih warna & font (Guidelines, cek `brandGuidelines.colors.primary`) → Tentukan tujuan bulan ini (Campaign) → Terbitkan konten pertama (ada konten `published`). Langkah kebuka urut (yang belum giliran = div tanpa href, ikon gembok). Setelah 5/5, hero jadi "Hari ini" dari `brandTopAction` (`js/next-action.js`) dan daftar perjalanan jadi `<details>` terlipat. "Bikin Tulisan" hanya tampil setelah DNA selesai; "To Do" kosong tidak dirender. Atribut `data-app="builder|campaigns|content-os"` dipertahankan di baris langkah supaya tur onboarding (`tour.js`) tetap menemukan targetnya. `TOUR_STEPS` beranda diganti ke selector baru.
- **Halaman Brands Pemula**: 0 brand → satu kartu "Langkah 1 dari 5 · Bikin brand kamu dulu" dengan satu tombol (`#add-brand` id tetap untuk tur). Ada brand → judul "Brand kamu." Form brand di Pemula: label bahasa sehari-hari, field brandbook/tone disembunyikan (`hidden`, tetap di DOM karena handler simpan membacanya), catatan koneksi IG/FB dihilangkan, tombol "Simpan & lanjut", dan **setelah brand dibuat langsung masuk ke `#/brand/<id>`**.
- **Tab Content OS di Pemula** (`content-os.js` `GUIDED_SUB_TABS`): Tulis konten · Jadwal · Semua konten · Ringkasan (urutan kerja dulu). Eyebrow "Content OS" → "Konten". Tur hub 1-langkah diganti kalimat netral.
- `js/help.js` teks "beginner-home" diperbarui. CSS: blok "Pemula mode" di paling bawah `css/styles.css` (`.mode-pick-*`, `.journey-hero*`, `.journey-step*`, `.journey-collapsed`, `.guided-first-brand`). Tidak bentrok dengan `.journey-node/track` milik Campaign Journey.

### Belum diuji (butuh login)
Alur end-to-end di akun asli: picker → bikin brand → auto masuk brand → hero langkah 2 → klik "Mulai jawab" → balik Beranda (progress "Sudah N dari 8 pertanyaan") → sampai 5/5 → hero "Hari ini". Tur onboarding di Beranda baru (target `[data-app]` sekarang baris list, bukan kartu besar). Callout "Brand kamu sudah siap!" saat builder selesai.

### Ide lanjutan (belum dikerjakan, tanya user dulu)
- Intro modal "Apa itu Brandlab?" masih muncul tiap login untuk semua akun; untuk Pemula lebih baik cukup sekali.
- Tombol Lanjut/Simpan sticky bawah di wizard DNA/Guidelines untuk HP (`brand-dna.js navHTML`, `brand-guidelines.js navHTML`).
- Tooltip istilah (funnel, ER, hook) via `js/help.js` di layar dalam (Creator, Campaign) untuk Pemula.
- Campaign di Pemula: kalau cuma satu template yang direkomendasikan, pertimbangkan langsung buka Grow Social Media tanpa modal pilih template.

## Addendum — 15 Sep 2026 (lanjutan): pohon progres campaign kembali + Pemula lebih sepi fitur

Permintaan user: (1) branch progres "kayak pohon" di campaign yang direkomendasikan untuk pemula, (2) mode Pemula jangan kebanyakan fitur. Semua **uncommitted**, `node --check` lolos, dicek visual lewat halaman uji sementara (sudah dihapus) di viewport 375px, mode Pemula dan Pro, tanpa error console dari kode baru.

### Pohon progres (`js/views/campaign-detail.js`)
- `missionTreeHTML(stage, readings)` di-port dari `campaigns.js` versi commit lama (hilang saat detail ditulis ulang). Tampil di dalam `.mission-panel` untuk stage `kind === "level"` (Grow Social Media / Personal Branding) di **kedua mode**, di atas daftar milestone. Satu batang, satu cabang per milestone (kecuali `notApplicable`), cabang terisi sesuai `reading.pct`, halo hijau kalau `met`. Nomor di cabang = nomor baris `.cd-row[data-milestone-index]`; klik node menyorot barisnya (`.cd-row.is-highlight`), hover/fokus node menampilkan tooltip lama (`.mission-node[data-tooltip]`, CSS sudah ada).
- Ukuran node/garis diperbesar dari versi lama (r 17, stroke 6, font 15) supaya terbaca di HP. Di ≤720px pohon `min-width:520px` di dalam `.cd-tree-scroll` (scroll horizontal) dan scroll awal diposisikan ke tengah supaya batangnya di tengah layar.
- CSS: `.cd-tree-scroll`, `.cd-tree`, `.cd-tree-legend`, `.cd-row.is-highlight` (paling bawah `css/styles.css`).

### Pemula lebih sepi (semua `getMode() === "guided"`)
- **Detail campaign**: tombol Ubah jadi ghost kecil; chip pipeline (Ide/Naskah/Syuting/...) di Aktivitas disembunyikan (tombol Brainstorm/Konten baru dan daftar konten tetap). Menu ⋯ dan menu milestone sudah tersembunyi dari sesi sebelumnya.
- **List campaign** (`campaigns.js` `campaignCard`): tanpa tag objective/status dan tanpa menu ⋯ di kartu; paragraf pengantar dipendekkan.
- **Kalender**: tombol Export Google Calendar disembunyikan (`qs("#export-gcal")?.`).
- **Daftar konten** (`content-list.js`): Import, ⋯ menu, Pilih (bulk), toggle platform metrik, dan kartu Top performers disembunyikan; semua wiring pakai `?.`.
- **Pengaturan** (`settings.js` `visiblePanels()`): Pemula hanya panel Brand dan Akun (`GUIDED_PANEL_KEYS`), default panel = yang pertama tersedia. Dropdown gear di topbar (`layout.js`) tanpa shortcut AI di Pemula.
- **Creator**: eyebrow "Creator Studio — Mission" → "Tulis konten" di Pemula.

### Belum diuji (butuh login)
Tooltip node saat hover di layar sentuh asli, klik node → sorot baris di halaman asli, tur detail campaign dengan pohon baru (selector tur tidak berubah), halaman Pengaturan Pemula saat deep-link `#/settings/ai` (harusnya jatuh ke Brand).

## Addendum — 15 Sep 2026 (lanjutan 2): pertanyaan dipangkas, "AI isi semua" Brand DNA, meter AI harian

Permintaan user: pertanyaan jangan kebanyakan, Brand DNA bisa di-generate AI semua, semua akun lihat bar pemakaian AI + limit harian. Semua **uncommitted**, `node --check` lolos, dicek di halaman uji sementara (dihapus) viewport 375px, Pemula & Pro, tanpa error console dari kode baru.

### Meter AI harian
- **`js/ai-usage.js` (baru)**: `aiDailyLimit()` (admin `ADMIN_UIDS` = tanpa batas; lainnya `accounts/{uid}.aiDailyLimit` kalau ada, default `DEFAULT_AI_DAILY_LIMIT = 30`), `aiUsageToday()`, `aiUsageRemaining()`, `aiLimitReached()`, `recordAiUsage()`. Hitungan disimpan di `settings/{uid}.aiUsage = { date, count }` (rules sudah mengizinkan pemilik menulis settings sendiri; tidak perlu perubahan rules). Reset otomatis karena tanggal berganti.
- **`js/ai.js callModel`**: menolak dengan `AiApiError` ("Jatah AI hari ini sudah habis (N kali)...") sebelum request kalau limit tercapai, `recordAiUsage()` setelah respons sukses. Request gagal tidak dihitung. `testAiConnection` pakai `{ countUsage: false }`. Thumbnail Gemini (`generateThumbnail`) **belum** dihitung.
- **Topbar (`js/layout.js`)**: pill `#ai-usage-btn` (ikon bot + bar + "12/30", amber ≥80%, merah 100%; admin tampil "AI N" tanpa bar) di semua mode, klik → popover penjelasan. Di-update live lewat `db:change`.
- Ini meter client-side (key AI masih di browser). Enforcement sebenarnya tetap butuh proxy server (Phase 2). **Admin dashboard wpk-dp belum punya field `aiDailyLimit`** — kalau mau top-up per akun, tambahkan di `/admin/brandlab/accounts/[uid]`.

### Brand DNA (`js/views/brand-dna.js`, `js/ai.js`)
- **`generateBrandDnaDraft(ai, { brand, answers })`** (ai.js): satu panggilan → JSON semua field DNA (termasuk `mission` format "1) .. 2) .. 3) ..", `tagline`, `oneLiner`, `personality/values/productsServices`). Jawaban yang sudah ada dikirim sebagai "keep verbatim" dan tidak ditimpa di sisi klien.
- **Kartu "Isi semua pakai AI"** di atas setiap langkah wizard (`aiFillCardHTML/wireAiFill`, kompak setelah langkah 1). Klik → isi field kosong → `updateBrand` → lompat ke Review. Label berubah "Isi yang kosong" kalau sudah ada jawaban.
- **Review sekarang editable** (`reviewSection` jadi textarea, `captureReview` dipanggil di Simpan/Kembali/PDF). Semua 13 field tampil termasuk yang kosong (placeholder = petunjuk).
- **Pemula lebih sedikit kotak**: `stepParts(step)` menyaring part `optionalInGuided` (audience.worry, problem.duration, trust.loyalty). Langkah "identity" di Pemula hanya Tagline (chip personality/values/products disembunyikan; bisa diisi di Review). Pro tidak berubah.
- Total kotak Pemula: 18 → 13 (belum termasuk jalur AI yang melewati semuanya).

### Campaign (`js/views/campaigns.js`)
- Pemula: prompt nama campaign sudah terisi default (`GUIDED_DEFAULT_NAMES` + nama brand), label "boleh langsung Enter". Prompt tetap ada karena tur campaign menunggu `#prompt-input`.

### Belum diuji (butuh login + key AI)
Hasil nyata `generateBrandDnaDraft` (kualitas JSON dari DeepSeek/Claude), alur "Isi semua" → Review → Simpan → Beranda langkah 2 jadi selesai, hitungan meter naik setelah panggilan AI sungguhan, dan tur Brand DNA dengan kartu AI baru di atas langkah 1.

## Addendum — 15 Sep 2026 (lanjutan 3): animasi kecil

Permintaan user: animasi pindah halaman, AI ngetik, kirim pesan, dsb. Semua **uncommitted**, `node --check` lolos, dicek di halaman uji sementara (dihapus), tanpa error console.

- **Pindah halaman**: `main.view` dan `#cos-mount` pakai `@keyframes view-in` (fade + naik 8px, 0.28s). Otomatis jalan tiap route karena shell di-render ulang. `.journey-hero` ikut.
- **AI Consultant (`js/consultant-panel.js`)**: bubble pending jadi tiga titik memantul (`.typing-dots`); bubble user/asisten baru dapat kelas `is-new` (slide dari kanan/kiri); tombol kirim `is-sent` (pop 0.4s); panel dapat `is-opening` tiap dibuka (scale/translate). Balasan asisten di-reveal per karakter lewat `typewriterReveal(el, { cps, onTick })` (diekspor) — berbasis waktu dengan `requestAnimationFrame` (bukan interval, supaya tab yang di-throttle tinggal mengejar), berjalan di text node jadi markdown ringan/tombol nav tetap utuh; tombol nav disembunyikan selama `.is-typing`, ada caret berkedip di paragraf terakhir. Dilewati saat `prefers-reduced-motion`.
- **Status "AI lagi mikir"** (`.ocr-status` yang punya `.spinner`): fade-in + teks shimmer (`:has()`).
- **Hasil AI & daftar**: stagger `reveal-up` untuk `[id^="polish-options"] > *`, `.copy-variant`, `#ai-result > *`, `.hooks-list > *`, `.brand-grid > *`, `.bb-hub-grid > *`, `.journey-list > .journey-step`, `.cd-row`.
- **Sentuhan kecil**: `.btn` transisi + `.btn-primary:hover` naik 1px dengan glow tint brand; `.tab:active` mengecil; toast lebih halus; FAB Consultant `:active`.
- Semua dimatikan di `@media (prefers-reduced-motion: reduce)`.
- Belum diuji: kirim pesan Consultant sungguhan (butuh login + key AI) — alur pending → balasan → typewriter diuji dengan DOM sintetis saja.

## Addendum — 15 Sep 2026 (lanjutan 4): transisi halaman halus, tombol Panduan melayang, halaman awal akun baru, splash Welcome

Semua **uncommitted**, `node --check` lolos, dicek di halaman uji sementara (dihapus) viewport 375px tanpa error console.

- **Transisi halaman (`js/main.js renderRoute`)**: shell (topbar) sekarang **dipertahankan** selama brand dan mode sama (`app.dataset.shellKey`), hanya `#view-root` yang diganti: `.view-leave` (fade out 110ms) → `updateShellForRoute()` (layout.js: toggle `.tab.active` via `data-tab-key`, refresh chip "Kembali ke ...") → `.view-enter` (fade+naik 0.32s). Rebuild shell penuh hanya saat masuk/keluar brand atau ganti mode. `main.view` tidak lagi beranimasi default; `#cos-mount` tidak beranimasi terpisah.
- **Tombol Panduan melayang** — `js/guide-fab.js` (baru), dimount dari `layout.js wireShell` (idempoten), di-unmount di `main.js teardownApp`. Pill "Panduan" di kiri bawah (Consultant tetap kanan bawah), disembunyikan selama `body.tour-active`. Menu: "Tur halaman ini" (klik `[data-section-guide-btn]` halaman, fallback `#start-tour`, lalu `startOnboardingTour`), "Tonton video" (klik `[data-guide-video-btn]`, hanya kalau ada), "Tanya AI" (klik `#consultant-fab`, hanya kalau ada), "Kenalan dari awal" (onboarding tour). Tidak ada registry: cukup memakai tombol yang sudah ada di halaman.
- **Halaman awal akun baru (`brands.js`)**: kartu fokus "Bikin brand kamu dulu" sekarang untuk **kedua mode** (dulu hanya Pemula; Pro mendarat di grid kosong). Ada tombol "Ikuti tur dulu" (`#start-tour`). Kartu onboarding di halaman brands disembunyikan hanya kalau banner tur **benar-benar** ada di DOM (`qs(".tour-prompt")`), bukan sekadar `tourPromptPending()` — itu penyebab halaman kosong setelah boot pertama yang menampilkan picker (banner dilewati, kartu ikut hilang).
- **Splash "Welcome to Brandlab"** (`main.js showWelcomeSplash`): sekali per boot setelah login (flag `welcomeShownThisBoot`, direset di `teardownApp` jadi login berikutnya dapat lagi), 1.9 detik (0.9 detik saat reduced motion), warna dari token tema (hitam/putih mengikuti mode). Urutan boot pertama: splash → picker Pemula/Pro → route. Boot berikutnya: splash → intro/notif/tur banner → route.
- CSS: `.view-enter/.view-leave`, `.welcome-splash*`, `.guide-fab*`, aturan mobile, reduced-motion.
- Belum diuji dengan login sungguhan: urutan splash → picker → halaman, transisi saat klik tab di app asli (diuji lewat simulasi `updateShellForRoute` + kelas), dan chip "Kembali ke campaign" setelah shell dipertahankan.

## Addendum — 16 Sep 2026: FASE 1 dari `.claude/brief-fix-user-flow.md` (tutorial tidak boleh mengubah data)

Sumber: `.claude/audit-flow-brandlab.md` (audit 16 Sep) → `.claude/brief-fix-user-flow.md`. Mengerjakan brief ini per fase, dimulai dari Fase 1. Semua **uncommitted**, `node --check` lolos di semua file di bawah.

### 1.1 Tur Creator berhenti di "Ide selesai"
- `js/guides/creator-guide.js` `executionSteps()`: dari 10 langkah (shootMode, stageBack, shot, edited, thumb, copyCaption, uploaded, done, where, cycle — separuhnya `write:true`) jadi **1 langkah info**, selector `.stage-script-display`, `skipIfMissing:false`. `#mark-submitted` (di `scriptingSteps()`) tetap gate `write` terakhir.
- `js/i18n/guides.js`: body `guide.creator.shootMode.body` ditulis ulang (jelasin 3 tombol besar berikutnya: Selesai syuting → Selesai editing → Selesai upload = otomatis Terbit hari ini). 8 key yang sudah tidak dipakai (`shot`, `edited`, `thumb`, `copyCaption`, `uploaded`, `done`, `where`, `cycle`) dan `stageBack` dihapus dari kamus — ini otomatis membuang dua kalimat yang diminta brief ("Buat tur ini boleh langsung klik." dan "Konten latihan tadi bisa kamu hapus…"), karena keduanya ada di key yang dihapus. `guide.creator.recap` tidak diubah.
- Kriteria brief (jalankan tur Creator dari awal → tepat 1 konten `production`, bukan `published`) **belum diuji lewat UI login**.

### 1.2 Hapus pengalihan paksa Content OS → Creator
- `js/views/content-os.js`: blok `if (activeSub === "dashboard" && !guideSeen("content-os") && !tourSeen("creator")) { setPendingTour("creator"); location.hash = ...; return; }` dihapus total. Import `guideSeen` (dari `section-guide.js`) dan `tourSeen`/`setPendingTour` (dari `guides/common.js`) ikut dibuang karena sudah tidak dipakai di file ini.
- Catatan: kriteria brief "Pemula klik Konten → Creator" baru akan benar setelah Fase 6.5 (redirect route tanpa-sub di Pemula ke Creator) dikerjakan — nav "Konten" untuk kedua mode masih menuju `#/brand/:id/content-os` tanpa sub, jadi saat ini keduanya mendarat di Dashboard/Ringkasan seperti sebelumnya (redirect paksa yang dihapus tidak digantikan apa pun di fase ini, sesuai instruksi "hapus", bukan "pindah ke tempat lain").

### 1.3 Matikan autoplay tur di halaman selain Beranda & Creator
- `js/guides/common.js` `startGuideOnMount`: tambah opsi `autoplay = true`. Saat `autoplay:false`, jalur non-forced (`maybeShowSectionTour`) dilewati sepenuhnya — tur di halaman itu hanya bisa mulai dari pending-tour chain atau tombol Panduan.
- Dipasang `autoplay: false` di: `startCalendarGuideOnMount` (`calendar-guide.js`), `startCampaignListGuideOnMount` & `startCampaignDetailGuideOnMount` (`campaign-guide.js`).
- Panggilan `maybeShowSectionTour(...)` dihapus langsung (bukan lewat opsi, karena bukan lewat `startGuideOnMount`) di: `js/views/brand-builder.js` (hub `"brand-builder"`), `js/views/brand-dna.js` (`"brand-dna"`), `js/views/brand-guidelines.js` (`"brand-guidelines"`), `js/views/content-os.js` (`"content-os"`). Di keempat file itu `wireSectionGuideButton`/tombol Panduan **dipertahankan** — tur masih bisa diputar manual. Import `maybeShowSectionTour` yang jadi tidak dipakai ikut dibuang dari masing-masing file.
- Tetap autoplay sekali seperti sebelumnya (tidak disentuh fase ini): Beranda Pemula (`beginner-home.js`) dan Creator (`startCreatorGuideOnMount`, guided-only lewat `maybeShowSectionTour` bawaan).
- Tur detail campaign: `brainstormSteps()` (`campaign-guide.js`) — langkah `#brainstorm-done` (gate klik yang berakhir mendorong ke Creator) dan fungsi `clearCreatorRequestStep` (+ pemakaiannya di `buildDetailSteps`) dihapus. Tur sekarang berhenti setelah langkah manual/`#bs-title` lalu lanjut ke "Edit campaign" — tidak ada lagi hand-off ke Creator dari tur ini. Efek rambatan (dibersihkan sekalian): `buildDetailSteps` tidak lagi butuh param `detailHash` (signature jadi `buildDetailSteps(campaign)`), `buildCampaignDetailSteps` tidak lagi butuh `brandId` (signature jadi `buildCampaignDetailSteps({ campaignId })` — caller tetap boleh kirim `{brandId, campaignId}`, `brandId` cuma diabaikan). `guide.camp.done.title/body` (key yang jadi tidak dipakai) dihapus dari `js/i18n/guides.js`.

### Sudah diuji
- `node --check` untuk: `js/guides/creator-guide.js`, `js/i18n/guides.js`, `js/views/content-os.js`, `js/views/brand-builder.js`, `js/views/brand-dna.js`, `js/views/brand-guidelines.js`, `js/guides/calendar-guide.js`, `js/guides/campaign-guide.js`, `js/guides/common.js`.
- Grep bersih: tidak ada referensi tersisa ke key/fungsi yang dihapus (`clearCreatorRequestStep`, key `guide.creator.{shot,edited,thumb,copyCaption,uploaded,done,where,cycle,stageBack}`, `guide.camp.done`) di seluruh `js/`.
- Server lokal (`python3 serve.py` → :8743) dibuka tanpa login: halaman harga (`/`) dan `#/login` render tanpa error console.

### Belum diuji (butuh login — Claude tidak boleh mengetik password)
Semua kriteria "selesai" per sub-fase di atas yang butuh akun nyata: tur Creator brand kosong → 1 konten `production`; Beranda Langkah 5 belum ✓; campaign Grow Social tetap 0 konten terbit; Pro klik Content OS → Dashboard; tur Kalender/Campaign/Brand Builder/Brand DNA/Brand Guidelines tidak lagi autoplay sendiri di kunjungan pertama (hanya lewat tombol Panduan); tombol Panduan di keempat halaman itu masih memutar tur dengan benar; tur detail campaign berhenti di halaman itu (tidak lompat ke Creator) setelah "Selesai" di langkah brainstorm manual.

### Lanjutan
Fase 2 (pembukaan: satu layar, satu tawaran tur) dikerjakan berikutnya sesuai urutan brief.

## Addendum — 16 Sep 2026 (lanjutan): FASE 2 dari `.claude/brief-fix-user-flow.md` (pembukaan: satu layar, satu tawaran tur)

Semua **uncommitted**, `node --check` lolos di semua file di bawah. Server lokal dibuka tanpa login (pricing, login plain, login `?mode=signup`) — 0 error console di ketiganya.

### 2.1 Modal intro hanya sekali seumur akun
- `js/brandlab-intro.js`: `shownThisSession` (flag sesi) diganti cek `getSettings().introSeenAt`. Modal menulis `updateSettings({ introSeenAt })` sekali (`markIntroSeen`, dijaga `seenMarked` supaya cuma sekali walau beberapa listener nyala) saat ditutup lewat tombol OK/Ikuti tur/Nanti aja **maupun** ✕ header, klik backdrop, atau Esc (tiga terakhir didengar paralel karena dipasang di dalam `openModal`, bukan lewat callback — tidak mengubah `js/modals.js`). Param baru `force` melewati cek `introSeenAt` (dipakai FAB).
- `js/guide-fab.js`: item "Kenalan dari awal" tidak lagi langsung `startOnboardingTour()` — sekarang memanggil `maybeShowBrandlabIntro({ offerTour: true, force: true })`, jadi modal (dengan tombol "Ikuti tur"-nya sendiri) yang tampil lagi, bukan langsung tur.

### 2.2 Gabungkan pilih tipe + intro
- `js/mode-picker.js`: `intro.pitch` (2 kalimat) ditampilkan di antara judul dan sub, di atas dua kartu. Klik kartu mode langsung menulis `settings.introSeenAt` juga (selain `setMode`) — jadi modal intro tidak pernah muncul lagi persis setelah boot pertama.
- `js/main.js`: pemanggilan `maybeShowBrandlabIntro` (+ `maybeShowProactiveNotif`/`maybeShowModeReminder`) dipindah ke dalam `if (!firstEverOpen)` — boot pertama (setelah picker) tidak lagi menampilkan modal, notifikasi proaktif, atau reminder mode di atas picker.
- `js/brandlab-intro.js`: `intro.note` (cek merek DJKI) dan blok dua baris grup Brand DNA/Guidelines dibuang dari isi modal — sisa pitch + tombol saja. Helper `groupRow` ikut dibuang (tidak dipakai lagi).
- i18n: `intro.note`, `intro.dnaDesc`, `intro.guidelinesDesc` dihapus dari `js/i18n.js` (tidak dipakai di tempat lain). CSS `.intro-note`, `.intro-groups`, `.intro-group-*` dihapus dari `css/styles.css`; `.mode-pick-pitch` baru ditambahkan.

### 2.3 Satu undangan tur
- **`js/tour-prompt.js` dihapus seluruhnya** — setelah `onLater` di `main.js` dan `onboardingCardHTML()` di `brands.js` (satu-satunya dua pemakai `maybeShowTourPrompt`/`tourPromptPending`) dibuang, file ini jadi sepenuhnya tidak terpakai (dicek: tidak ada import lain ke file ini di seluruh `js/`, `mode-reminder.js` cuma memakai nama class CSS `.tour-prompt*` yang sama, bukan modulnya). `onLater` juga dibuang dari parameter `maybeShowBrandlabIntro` (tidak ada pemanggil yang mengisinya lagi).
- `js/views/brands.js`: `onboardingCardHTML()` ("Baru di sini? Mulai dari dasarnya") dan `setupVideoCardHTML()` ("Video panduan setup — Segera hadir") beserta pemanggilan, gating (`showOnboarding`/`ONBOARDING_DISMISSED_KEY`/`tourPromptPending`), dan listener `#dismiss-onboarding` dihapus. CSS turunannya (`.onboarding-card`, `.setup-video-card`, dan varian anaknya) ikut dihapus dari `css/styles.css`; i18n `brands.onboard.badge/title/sub`, `brands.video.title/sub` dihapus dari `js/i18n/app-shell.js` (`brands.onboard.cta` **dipertahankan** — dipakai tombol "Ulangi panduan" di Settings).
- Hero kartu 0-brand: tombol "Ikuti tur dulu" (`#start-tour`) sekarang **hanya dirender di Pro** (`!guided`); Pemula tidak menampilkannya sama sekali (Beranda + form brand adalah onboarding-nya).
- `js/layout.js`: titik berdenyut `has-news` di tombol mode dihapus total — `MODE_EXPLAINER_SEEN_KEY`/`modeExplainerSeen`/`markModeExplainerSeen` dan pemakaiannya dibuang, tombol mode tidak lagi punya kelas kondisional. CSS `.mode-toggle.has-news::after` + `@keyframes mode-dot` + `.mode-toggle{position:relative}` (cuma dipakai buat dot itu) dihapus dari `css/styles.css`.

### 2.4 Tur onboarding (Pro / dari FAB)
- `js/tour.js` `startOnboardingTour()`: langkah `#my-routine-card` (info Jadwal Kerja) dan langkah kedua `.brand-tile clickAny` ("Yuk mulai") dihapus dari rangkaian setelah form brand/daftar brand. Setelah `[data-save]` (brand baru) atau langkah pertama `.brand-tile` (akun yang sudah punya brand), tur langsung lanjut ke `#brand-switch-btn` dst.
  - **Perubahan tambahan di luar teks brief, demi tidak merusak jalur akun-yang-sudah-punya-brand**: langkah `.brand-tile` PERTAMA (cabang `else`, sebelumnya cuma info tanpa gate) sekarang diberi `interactive: { type: "clickAny" }` — ini jadi satu-satunya mekanisme "masuk ke brand" yang tersisa untuk jalur itu, menggantikan langkah kedua yang dihapus. Body-nya (`tour.onb.brands.body`, "klik buat masuk ke dashboard...") sudah cocok tanpa perlu diubah.
  - **Belum diuji, tolong dicek manual**: jalur `!hasBrands` (akun baru, 0 brand) di mode **Pro** — `openBrandModal`'s save handler (`js/views/brands.js`) hanya auto-navigate ke `#/brand/:id` untuk mode **guided**; Pro tetap di halaman semua-brand setelah simpan. Brief menyebut "setelah [data-save] langsung ke #brand-switch-btn dst (semua sudah ada di halaman brand)" — ini benar untuk Pemula, tapi kalau tur ini dipicu di akun Pro yang baru dibuat dan belum punya brand sama sekali, `#brand-switch-btn` mungkin belum ada di halaman saat itu (tur akan skip lewat `skipIfMissing` default setelah timeout, bukan macet, tapi langkah itu tidak akan tersorot). Silakan uji: buat akun baru → pilih Pro → FAB "Kenalan dari awal" → Ikuti tur → isi form brand pertama → Simpan.
  - i18n `tour.onb.pick.title/body`, `tour.onb.routine.title/body` dihapus dari `js/i18n/guides.js` (tidak dipakai lagi).

### 2.5 Halaman harga → daftar
- `js/views/pricing.js`: tiga CTA "Daftar untuk bayar" (`planDetailHTML`, hero, float bar) sekarang mengarah ke `#/login?mode=signup` (bukan `#/login` polos). Link "Masuk di sini" (`#pricing-login-link`, sudah bayar & punya akun) **tidak diubah** — tetap `#/login` biasa.
- `js/views/login.js`: `initialMode()` baru membaca `?mode=signup` dari `location.hash` saat render pertama; `state.mode` mulai dari situ, bukan selalu `"login"`.
- `js/main.js`: `showLogin` di `boot()` diubah dari `location.hash === "#/login"` (persis) jadi `location.hash.startsWith("#/login")`, supaya hash dengan query string (`#/login?mode=signup`) tetap dikenali dan tidak jatuh ke halaman harga.
- **Sudah diuji tanpa login**: klik "Daftar untuk bayar — Rp 300.000" (hero) dan versi kartu paket sama-sama mengarah ke `#/login?mode=signup`; navigasi langsung ke hash itu mendarat di form "Buat akun" (signup) sejak render pertama; `#/login` polos tetap mendarat di form "Masuk" (login). 0 error console di ketiganya.

### Belum diuji (butuh login)
Modal intro benar-benar hanya muncul sekali per akun lintas device (butuh dua sesi login berbeda); FAB "Kenalan dari awal" membuka modal (bukan langsung tur) dan tombol "Ikuti tur" di dalamnya jalan; mode picker menampilkan pitch dengan benar dan langsung set `introSeenAt`; hero 0-brand: tombol "Ikuti tur dulu" muncul di Pro, hilang di Pemula; tur onboarding penuh (kasus Pro + 0 brand, lihat catatan 2.4 di atas); alur signup sungguhan (submit form, bukan cuma render).

### Lanjutan
Fase 3 (Beranda sebagai peta) berikutnya sesuai urutan brief.

## Addendum — 16 Sep 2026 (lanjutan 2): FASE 3 dari `.claude/brief-fix-user-flow.md` (Beranda sebagai peta)

Semua **uncommitted**, `node --check` lolos di semua file di bawah. Verifikasi tanpa login diperluas: selain buka halaman harga/login, setiap modul yang disentuh (termasuk yang normalnya baru ter-lazy-load setelah masuk ke sebuah brand, seperti `brand-dna.js`/`beginner-home.js`) di-`import()` langsung dari console browser — semua 19 modul resolve bersih, 0 error console.

### 3.1 Langkah 2: DNA dibuka sudah terisi AI (Pemula)
- `js/views/brand-dna.js` `render()`: kalau `getMode()==="guided"`, bukan deep-link ke step tertentu, `countAnswered(answers)===0`, dan `hasAiKey(ai)` — jalankan `runAutoDraft` (fungsi baru) otomatis: panggil `generateBrandDnaDraft` (logika sama persis dengan tombol "Isi semua pakai AI" yang sudah ada), `persistDna`, lalu `state.stepIndex = STEPS.length` (Review) + `state.autoDrafted = true`. Gagal/exception → jatuh ke wizard step 0 seperti biasa (tidak ada perubahan path itu).
- `paint()`: layar baru saat `state.autoDrafting` — kartu status "AI lagi nulis draf Brand DNA kamu... ±20 detik" (pakai key `dna.aiFill.working` yang sudah ada, sama persis teksnya dengan yang diminta brief), tanpa nav/tombol lain.
- `reviewHTML(state)`: kalau `state.autoDrafted`, subjudul ganti jadi `dna.review.subAuto` ("Ini yang kami tangkap dari ceritamu — koreksi kalau ada yang kurang pas, lalu Simpan.") + link baru `#dna-answer-manually` ("Mau jawab sendiri satu-satu? →", key `dna.review.answerManually`) yang men-set `state.stepIndex = 0` dan refresh (wired di `wireReview`). Review manual (bukan hasil auto-draft) tidak berubah tampilannya.
- `js/views/beginner-home.js`: step DNA di journey pakai key baru — `beginner.step.dna.title` = "Cek profil brand kamu", `.desc` = "AI sudah menulis profil brand dari ceritamu tadi...", `.cta` tunggal = "Cek & koreksi" (menggantikan `ctaContinue`/`ctaStart` yang dihapus dari `js/i18n/brand-dna-builder.js`, sudah dicek tidak dipakai di tempat lain).
- Pro: tidak ada perubahan sama sekali di jalur ini (`getMode()==="guided"` menjaga semuanya).

### 3.2 "Gabungkan" otomatis
- `js/views/brand-dna.js`: logika compose (dari tombol "Gabungkan") diekstrak jadi fungsi bersama `composeAnswerFromParts(root, state, step)`, dipakai baik oleh tombol `#compose-answer` maupun (baru) oleh Next dan "Simpan progress" — keduanya sekarang memanggil `ensureComposed()` sebelum `captureStep`/`persistDna`: kalau step `kind:"compose"` dan textarea gabungan masih kosong, compose dulu dari kotak-kotak yang terisi.
- `liveStepFilled` dan `isStepFilled` (yang terakhir sekarang menerima `state` utuh, bukan cuma `state.answers`, supaya bisa baca `state.parts` juga — 3 titik pemanggil disesuaikan) untuk step `compose`: Lanjut aktif kalau textarea gabungan **atau** minimal satu kotak terisi (dicek lewat `currentPartValues`/`state.parts[step.key]`). Hint `dna.nav.fillFirst` tidak diubah — otomatis cuma muncul kalau benar-benar kosong semua.
- Tombol "Gabungkan" tetap ada dan masih bisa diklik manual (opsional, tidak dihapus).

### 3.3 Tujuan setelah Simpan DNA & Guidelines
- `js/views/brand-builder.js`: flag `DNA_JUST_COMPLETED_KEY` dipecah jadi dua fungsi ekspor — `markDnaJustCompleted(brandId)` (setter) dan `consumeDnaJustCompleted(brandId)` (baca+hapus sekali, mengembalikan boolean) — menggantikan akses `sessionStorage` langsung yang tadinya ada di dua file berbeda dengan konstanta yang diduplikasi. `paintHub` sekarang pakai `consumeDnaJustCompleted` (perilaku Pro tidak berubah: animasi pintu DNA menyala).
- `js/views/brand-dna.js` `wireReview` → `#wiz-save`: pakai `markDnaJustCompleted` (import dari `brand-builder.js`, tidak ada siklus impor — dicek `brand-builder.js`/`brand-home.js` tidak balik impor `brand-dna.js`). Tujuan setelah simpan: **Pemula → `#/brand/:id` (Beranda)**, **Pro → `#/brand/:id/builder` (hub, tidak berubah)**.
- `js/views/beginner-home.js`: import `consumeDnaJustCompleted`, dipanggil di `paint()` — kalau true, `toast(t("dna.celebrate.done"))` ("Brand DNA selesai 🎉"). Key baru di `js/i18n/brand-dna-builder.js`.
- `js/views/brand-guidelines.js` `wireReview` → `#wiz-save` (Simpan Brand Book/Review 12-tahap Pro): **Pemula → selalu Beranda** (sebelumnya ikut logika `isBrandBuilderComplete` yang sama untuk kedua mode); **Pro → tetap hub**, kecuali kasus lama yang dipertahankan: kalau save ini yang menyelesaikan SELURUH Builder (kedua pintu), tetap lompat ke Beranda + `markBuilderJustCompleted` seperti sebelumnya.

### 3.4 Beranda: pangkas tur & perbaiki tag funnel
- `js/views/beginner-home.js` `TOUR_STEPS`: langkah `#mode-toggle-btn` ("Mode Pemula atau Pro") dihapus — sisa 3 langkah (hero, journey, consultant). Key i18n `beginner.tour.mode.title/body` dihapus dari `js/i18n/brand-dna-builder.js` (tidak dipakai lagi).
- `js/funnel-field.js`: helper baru `funnelLabel(funnel)` — `t(\`creator.funnel.guided.\${funnel}.title\`)` kalau funnel valid (ada di `FUNNELS`), fallback `""`.
- `todoRowsHTML` (`beginner-home.js`) dan `upNextRowHTML` (`beginner-content-os.js`): tag funnel di baris konten sekarang pakai `funnelLabel(c.funnel)` (label Pemula, mis. "Kenalan"/"Percaya"/"Beli") bukan akronim mentah `c.funnel` (TOFU/MOFU/BOFU). Efek samping yang ikut dibenerin: `upNextRowHTML` sebelumnya bisa crash kalau `c.funnel` kosong (`c.funnel.toLowerCase()` tanpa guard) — sekarang aman lewat `(c.funnel || "")`.

### Belum diuji (butuh login)
Auto-draft DNA nyata (hasil `generateBrandDnaDraft` dari provider AI sungguhan, bukan cuma alur kode) pada brand kosong mode Pemula; link "Mau jawab sendiri satu-satu?" balik ke step 0 dengan draf AI tidak hilang; Next/"Simpan progress" pada step compose dengan kotak terisi tapi belum klik Gabungkan; tujuan redirect setelah Simpan DNA/Guidelines di kedua mode (termasuk kasus Pro yang menyelesaikan seluruh Builder lewat Guidelines); toast "Brand DNA selesai 🎉" di Beranda; tur Beranda 3 langkah; tag funnel Indonesia di baris "Kerjaan minggu ini"/"Selanjutnya".

### Lanjutan
Fase 4 (Langkah 3 "Pilih warna & font") berikutnya sesuai urutan brief.

## Addendum — 16 Sep 2026 (lanjutan 3): FASE 4 dari `.claude/brief-fix-user-flow.md` (Langkah 3 "Pilih warna & font" sesuai janjinya)

Semua **uncommitted**, `node --check` lolos di semua file di bawah. Verifikasi tanpa login: halaman harga/login render bersih; setiap modul yang disentuh di-`import()` langsung dari console browser **setelah reload penuh** — catatan penting soal cara uji ini di bagian bawah.

### 4.1 Mendarat di Warna, bukan Fondasi
- `js/views/beginner-home.js`: step "visual" `href` dan `editHref.visual` → `#/brand/:id/guidelines/color` (sebelumnya `#/brand/:id/guidelines`, yang defaultnya jatuh ke Fondasi).

### 4.2 Hapus lapisan halaman grup
- `js/views/brand-builder.js` `hubDoorHTML`: pintu Guidelines → `#/brand/:id/guidelines/color` (bukan `#/brand/:id/builder/guidelines`). `paintGroup` (halaman grup 12-tahap lama) **dibiarkan ada** untuk siapa pun yang masih punya link lama — dicek dengan grep, tidak ada lagi link fungsional yang menuju ke sana di seluruh `js/` (cuma komentar dokumentasi yang menyebutnya).
- `js/views/brand-guidelines.js` `paint()`: `backLinkHTML` sekarang `#/brand/:id` + label "Beranda" di Pemula, `#/brand/:id/builder` + label "Brand Builder" di Pro (persis pola back-link Brand DNA).

### 4.3 Tab Pemula: Warna → Font → Selesai
- `sectionTabsHTML`: di Pemula (`getMode()==="guided"`), baris tab hanya render Warna dan Font (index STEPS aslinya dipertahankan lewat `STEPS.indexOf`, jadi klik tab tetap navigasi benar); tab Review tidak ditampilkan. Fondasi/Logo/Arah/Tone/Penerapan/Review **tetap bisa diakses via URL langsung** dan tidak berubah sama sekali di Pro.
- `guidelinesProgressHTML`: `PROGRESS_STEP_KEYS_GUIDED = ["color","typography"]` dipakai di Pemula → label "1/2 bagian selesai"; Pro tetap `PROGRESS_STEP_KEYS` (5 bagian) seperti semula.
- `navHTML`: di step Typography + Pemula, tombol "Lanjut" diganti tombol baru `#wiz-finish-visual` ("Selesai, balik ke Beranda", key `guidelines.finishVisual`) — aktif kalau `isStepFilled("color", ...)` **dan** `isStepFilled("typography", ...)`. Klik → `updateBrand` (commit langsung, sama pola dengan `#wiz-save` di Review) + `markVisualBasicsJustDone` (flag baru, lihat 4.4) + toast + `location.hash = Beranda`. Step lain (termasuk Warna) tetap tombol "Lanjut" biasa.
- Tab Warna (`colorStepHTML`): urutan dibalik — blok chip kesan sekarang PALING ATAS dengan judul baru "1. Pilih kesan (satu klik, palet jadi)" (key `bg.color.pickFeeling`); blok rumus warna + input hex/eyedropper/ekstrak-foto (+ preview warna dari foto) dipindah ke dalam `<details class="mb-explain">` berjudul "Sesuaikan sendiri" (key `bg.color.manualDetails`, styling dipakai ulang dari blok penjelasan moodboard yang sudah ada). Preview palet otomatis + blok "Sesuaikan" (swatch primary/secondary/accent/background/text final) **tetap selalu terlihat di luar** `<details>` — itu representasi jawaban final yang harus tetap kelihatan, bukan bagian yang disembunyikan. `wireColorStep` **tidak diubah sama sekali** (semua `qs`/`qsa`-nya cari lewat id/selector yang masih ada di DOM, `<details>` tertutup tidak menghapus anak-anaknya). Copy `bg.color.sub` ikut ditulis ulang (dulu menjanjikan "dua langkah: rumus dulu baru warna dasar", sekarang menyebut jalur satu-klik). `bg.color.step1`/`step2` kehilangan prefix angka "1./2." karena sekarang jadi sub-label di dalam details (menghindari dobel-nomor dengan "1. Pilih kesan" di luar).

### 4.4 Satu definisi "selesai" untuk visual
- `js/views/brand-builder.js`: `export function visualBasicsDone(brand)` = `colors.primary && fonts.primary && fonts.secondary`. `isBrandBuilderComplete` (Pro/perayaan Builder penuh) **tidak disentuh**.
- `hubDoorHTML`: pintu Guidelines di Pemula sekarang menampilkan "Warna & font selesai" (key `builder.progress.visualDone`) atau "Warna & font belum diisi" (`builder.progress.visualPending`) — bukan "n/5 tahap" — lewat `visualBasicsDone(brand)`. Bar progres (pct) tetap dihitung dari 5 tahap yang sama seperti sebelumnya (brief cuma minta labelnya, bukan angka barnya, yang diganti). Pro tidak berubah.
- `js/views/beginner-home.js`: `hasGuidelines` (dipakai buat `done` step "visual" di journey) sekarang `visualBasicsDone(brand)`, bukan cek manual `colors.primary` doang — jadi step ini juga otomatis butuh font terisi, konsisten dengan definisi tunggal.
- Flag baru **`markVisualBasicsJustDone`/`consumeVisualBasicsJustDone`** (`brand-builder.js`, pola sama persis dengan `BUILDER_JUST_COMPLETED_KEY`) — di-set dari tombol "Selesai, balik ke Beranda" (4.3) di `brand-guidelines.js`. `beginner-home.js` `paint()` sekarang mengonsumsi KEDUA flag secara terpisah (bukan `||` short-circuit, supaya kalau kebetulan dua-duanya nyala di kunjungan yang sama tetap kekonsumsi semua) dan menggabungkan hasilnya — callout bubble "Brand kamu sudah siap! Sekarang tentukan tujuannya 🎯" (`beginner.callout.builderDone`, key lama, tidak diubah) dan animasi "celebrate" di baris journey "visual" sekarang jalan begitu Warna+Font selesai, bukan cuma nunggu Logo/Arah/Tone/Penerapan juga rampung.
- `todayHeroHTML`: cabang fallback baru ditambahkan SEBELUM fallback "Tulis konten berikutnya" — kalau tidak ada aksi campaign (`!top`) dan `!brand.brandGuidelines?.logo?.dataUrl`, tampilkan "Lengkapi Brand Book: upload logo" (key `beginner.today.logo.*`) → `#/brand/:id/guidelines/logo`. Cuma link ke halaman Logo yang sudah ada, bukan fitur baru. Kalau logo sudah ada (atau nanti sudah diupload), jatuh ke fallback lama seperti sebelumnya.

### Catatan pengujian (penting buat sesi berikutnya)
Cek "semua modul ter-`import()` bersih dari console" **wajib jalan setelah reload penuh (`location.reload()`)**, bukan berturut-turut di tab yang sama tanpa reload — ES module punya cache per-URL persis, jadi modul A yang meng-`import` modul B lewat path relatif polos (`from "./brand-builder.js"`) akan tetap memegang versi B yang sudah ter-cache dari pengecekan sebelumnya di sesi browser yang sama, walau file di disk sudah berubah. Sempat kejadian di sesi ini: `beginner-home.js`/`brand-guidelines.js` sempat "gagal" import karena `brand-builder.js` versi lama (sebelum `visualBasicsDone` dkk ditambahkan) masih di-cache tab — setelah `location.reload()`, keduanya OK.

### Belum diuji (butuh login)
Klik pintu Guidelines dari hub Brand Builder (Pro & Pemula) mendarat di tab Warna; back-link dari Warna/Font balik ke tempat yang benar di kedua mode; tab Warna hanya tampil 2 (Warna, Font) di Pemula dan 7 di Pro; klik satu chip kesan langsung menyiapkan palet otomatis lalu "Sesuaikan sendiri" collapsed berisi rumus/hex/eyedropper/ekstrak-foto; tombol "Selesai, balik ke Beranda" nonaktif sampai Warna+Font terisi, aktifnya balik ke Beranda + toast + callout "Brand kamu sudah siap"; label pintu Guidelines "Warna & font selesai" di hub Pemula; kartu "Hari ini" menawarkan upload logo saat brand tanpa campaign aktif dan belum punya logo.

### Lanjutan
Fase 5 (Campaign: satu klik, dan langkah pertama yang masuk akal) berikutnya sesuai urutan brief.

## Addendum — 16 Sep 2026 (lanjutan 4): FASE 5 dari `.claude/brief-fix-user-flow.md` (Campaign: satu klik, langkah pertama masuk akal)

Semua **uncommitted**, `node --check` lolos di semua file JS di bawah. Verifikasi tanpa login (reload penuh dulu, lihat catatan Fase 4): `campaigns.js`, `next-action.js`, `campaign-detail.js` ter-`import()` bersih, 0 error console.

### 5.1 Pemula: template → langsung jadi
- `js/views/campaigns.js` `openNewCampaignFlow`: untuk template bukan `event`, cabang `toCalibration` sekarang cek `getMode()==="guided"` duluan — kalau true, langsung `finishQuickCampaign(...)` tanpa `openMissionCalibration` (startIndex default 0 dari `createMissionsForTemplate`). Pro tidak berubah (tetap lewat kalibrasi kalau ladder-nya punya `calibration`).
- `finishQuickCampaign`: di Pemula, `promptDialog` nama dilewati total — pakai `defaultName` (`GUIDED_DEFAULT_NAMES[template.id] || template.label` + nama brand) langsung. Pro tetap diminta isi nama (dialog sama, cuma value awal dikosongkan karena defaultnya sekarang cuma dipakai Pemula). Key i18n `camp.new.nameLabelGuided` dihapus (tidak dipakai lagi — labelnya sudah tidak pernah muncul karena dialognya sendiri di-skip).
- Terms (gate khusus Grow Personal Branding) **tidak disentuh** — tetap tampil di kedua mode sebelum `toCalibration` dipanggil.

### 5.2 Next action saat belum ada konten
- `js/next-action.js` `nextActions`, item #7 (brainstorm): tambah `const noContentYet = linked.length === 0` (lebih ketat dari kondisi tampil `!pipeline.length` yang sudah ada — campaign yang isinya cuma konten published punya `pipeline.length===0` tapi `linked.length>0`, jadi tetap priority normal). Kalau `noContentYet`: `priority: 1.5` (dari 7 — otomatis mengalahkan `insights` yang priority-nya 2 atau 8, tanpa perlu utak-atik priority insights itu sendiri) **dan** label diganti `next.brainstorm.labelFirstGuided` ("Bikin konten pertama untuk campaign ini") **khusus di Pemula** (`getMode()==="guided"`); Pro tetap label lama (labelWindow/labelLevel yang menyebut nama stage).
- Import baru: `getMode` dari `./mode.js` (belum pernah diimpor di file ini sebelumnya).

### 5.3 Detail campaign Pemula saat 0 konten
- `js/views/campaign-detail.js` `paintDetail`: kalau `guided && acts.linked.length===0`, tiga blok (`missionTreeHTML`, `milestoneListHTML`, `ladderRulesHTML`) dibungkus `<details class="cd-optional">` tertutup (tanpa atribut `open`) dengan `<summary>` "Lihat semua target level ini ({n})" (`camp.detail.optionalTargets`, n = `stageRead.readings.length`). Headline dan next-action di atasnya **tidak ikut terbungkus**, tetap tampil seperti biasa. Pro dan Pemula-yang-sudah-punya-konten tidak berubah (blok tiga itu tampil polos seperti sebelumnya).
- CSS baru `.cd-optional` (+ `summary` tanpa marker bawaan browser) di `css/styles.css`, gaya kecil menyatu dengan namespace `.cd-*` yang sudah ada di file itu.
- Toast `camp.new.createdLadder` ditulis ulang: "\"{name}\" dibuat — sekarang bikin konten pertamanya." (dulu menyuruh "klik Brainstorm konten buat ide Mission 1" — technical/Pro-flavored; sekarang netral untuk kedua mode, dan Mission 1 sudah otomatis jadi fokus lewat 5.2 di atas jadi tidak perlu disebut eksplisit di toast).

### Belum diuji (butuh login)
Klik template Grow Social/Personal Branding di Pemula → langsung jadi campaign tanpa dialog kalibrasi/nama (Terms tetap muncul untuk Grow Personal); Pro masih lihat kalibrasi + dialog nama seperti biasa; campaign baru 0 konten → next action "Bikin konten pertama untuk campaign ini" muncul di atas Insights; detail campaign 0 konten di Pemula → mission tree/milestone/rules collapsed di balik "Lihat semua target level ini (n)"; toast setelah bikin campaign baru.

### Lanjutan
Fase 6 (Creator: tanya sekali, tanggal ada di tempatnya) berikutnya sesuai urutan brief.

## Addendum — 16 Sep 2026 (lanjutan 5): FASE 6 dari `.claude/brief-fix-user-flow.md` (Creator: tanya sekali, tanggal di tempatnya)

Semua **uncommitted**, `node --check` lolos di semua file JS di bawah. Verifikasi tanpa login (reload penuh dulu): `creator.js`, `content-editor.js`, `content-os.js` ter-`import()` bersih, 0 error console.

### 6.1 Modal AI Pemula lebih pendek
- `js/views/creator.js` `openAiScriptModal` (non-lite): blok Durasi + "Tujuan video" + Artikel sekarang dibungkus `getMode() !== "guided"` — Pemula cuma lihat prompt + `funnelFieldHTML` (+ follow-up MOFU/BOFU yang sudah ada). `genParams()` tidak diubah — semua pembacaan `#ai-duration-custom`/`#ai-goal`/`#ai-article` sudah pakai `?.` dan `state.duration` tetap punya default value walau chip-nya tidak dirender, jadi generate tetap jalan normal di Pemula.

### 6.2 Tujuan konten ditanya sekali
- `campaignFunnelFieldsHTML` (Pemula): kalau `c.funnel` sudah terisi, render baris ringkas "Tujuan: {label}" + link "ubah" (fungsi baru `funnelGoalFieldHTML`) — bukan picker penuh. Klik "ubah" **tidak** memicu `refresh()` (itu cuma akan menggambar ulang baris ringkas yang sama) — sebagai gantinya, `#funnel-goal-wrap` di-swap langsung jadi `funnelFieldHTML(...)` lewat DOM, lalu `wireFunnelField` dipasang ulang pakai handler `pickFunnel` yang sama dengan yang dipakai saat render awal (satu fungsi, dipakai dua tempat). Setelah user benar-benar pilih funnel baru, `pickFunnel` tetap `refresh()` seperti biasa — baris ringkas lalu muncul lagi dengan nilai baru. Kalau `c.funnel` belum terisi sama sekali, tetap tampil picker penuh seperti sekarang. Pro tidak berubah (masih selalu picker penuh).
- i18n baru: `cr.funnel.goalSummary` ("Tujuan: {label}"), `cr.funnel.change` ("ubah").

### 6.3 Tanggal upload di panel Siap upload
- `readyToUploadPanel`: field baru `<input type="date" id="f-schedule" min={hari ini}>` (label `contentEditor.scheduleDate.label`, key yang sama dipakai drawer editor) ditambahkan di atas centang platform. Wiring di `paint()`: listen `blur` **dan** `change` (native date picker tidak selalu memicu `blur` di semua browser/OS — brief eksplisit minta keduanya) lewat satu handler `commitSchedule` yang no-op kalau nilainya tidak berubah (jadi aman didengar dua event sekaligus). Tanggal lampau ditolak dengan toast `calendar.pastDate` (key yang sama dengan drawer editor) dan input dikembalikan ke nilai lama. Import baru: `localISODate` dari `store.js`. Field ini otomatis muncul di Kalender karena `scheduleDate` adalah field content yang sama, tidak ada perubahan di `calendar.js`.

### 6.4 Sembunyikan tombol thumbnail yang selalu gagal
- `js/views/content-editor.js` (`bodyTemplate`, tombol `#ai-thumb-gen`) dan `js/views/creator.js` (`readyToUploadPanel`, tombol `#ai-thumb-gen-ready`): tombol AI-generate sekarang hanya dirender kalau `settings.ai?.provider === "gemini" && settings.ai?.geminiApiKey` ada isinya. Field Thumbnail (upload manual, drag file) **tidak disentuh** — tetap selalu ada. Wiring kedua tombol sudah pakai pola `if (btn) {...}` yang aman kalau elemen tidak ada, jadi tidak perlu perubahan lain.

### 6.5 Tab Pemula: buang "Ringkasan"
- `js/views/content-os.js`: `GUIDED_SUB_TABS` sekarang cuma 3 entri (creator/calendar/list, entri `dashboard` dihapus). Route dengan `activeSub==="dashboard"` (baik URL polos `#/brand/:id/content-os` maupun link lama `/dashboard`) di Pemula sekarang **redirect** (`location.hash = .../content-os/creator`) alih-alih merender apa pun — cabang render terakhir (`else { dashboardView.render(...) }`) sekarang murni jalur Pro (guided+dashboard sudah keluar duluan lewat redirect).
- **`js/views/beginner-content-os.js` dihapus** — satu-satunya importer (`content-os.js`) sudah tidak memakainya lagi (dicek: tidak ada file lain yang mengimpornya). 11 key i18n `beginner.cos.*` yang cuma dipakai file itu ikut dihapus dari `js/i18n/brand-dna-builder.js` (dicek satu per satu, tidak dipakai di tempat lain); komentar section header di file i18n itu juga diperbarui (tidak lagi menyebut file yang sudah dihapus).
- Copy tur hub: `TOUR_STEPS` (const statis) diubah jadi `tourSteps()` (fungsi, dihitung ulang tiap dipakai) supaya body-nya bisa beda per mode alih-alih satu string tetap — brief cuma minta ganti "Empat tab" → "Tiga tab", tapi tab hub Pro **masih tetap 4** (Ringkasan/Daftar Konten/Creator/Kalender, tidak berubah), jadi kalau diganti begitu saja secara global copy-nya jadi salah buat Pro. Solusinya: key baru `cnt.os.tour.bodyGuided` ("Tiga tab...") dipakai khusus Pemula lewat `getMode()`, key lama `cnt.os.tour.body` ("Empat tab...") tetap dipakai apa adanya untuk Pro.

### Belum diuji (butuh login)
Modal AI di Creator Pemula cuma tampil prompt+funnel (Pro tetap lengkap); isi tujuan sekali di modal AI lalu buka draf → baris ringkas "Tujuan: ... · ubah", klik ubah → picker muncul inline tanpa reload aneh; field tanggal di panel Siap upload tersimpan dan muncul di Kalender; tanggal lampau ditolak dengan toast; tombol thumbnail AI hilang total di akun tanpa Gemini key (baik di Creator maupun drawer Content Editor), field upload manual tetap bisa dipakai; Pemula: tab Konten cuma 3 (tanpa Ringkasan), buka `#/brand/:id/content-os` polos langsung lompat ke Creator; tur hub Content OS bilang "Tiga tab" di Pemula dan "Empat tab" di Pro.

### Lanjutan
Fase 7 (Bersih-bersih tumpukan bantuan & buntu) berikutnya sesuai urutan brief — ini fase terakhir.

## Addendum — 16 Sep 2026 (lanjutan 6): FASE 7 dari `.claude/brief-fix-user-flow.md` (bersih-bersih tumpukan bantuan & buntu) — SEMUA 7 FASE BRIEF SELESAI

Semua **uncommitted**, `node --check` lolos di semua file JS di bawah. Verifikasi tanpa login (reload penuh dulu): 10 modul kunci ter-`import()` bersih, 0 error console; halaman harga juga dicek ulang bersih.

### Sales: sembunyikan sampai halamannya ada
- Brief kasih pilihan "sembunyikan tab (widget tetap) ATAU hapus juga widget-nya, konsisten". Dipilih: **hapus keduanya** — `js/views/sales.js` masih literal kartu "Coming soon" 29 baris, jadi konsisten dengan pola "jangan iklankan fitur yang belum jadi" yang sudah dipakai di fase-fase sebelumnya (kartu onboarding/video Fase 2.3).
- `js/layout.js` `TABS` (Pro): entri `sales` dihapus. `js/views/brand-home.js`: `salesWidgetHTML()` + pemanggilannya + `"sales"` di daftar `data-go` yang valid dihapus. Halaman `sales.js` sendiri **tidak disentuh** — tetap bisa dibuka lewat `#/brand/:id/sales` langsung. Key i18n `nav.sales`/`brandHome.widget.sales.*` **sengaja dibiarkan** (bukan dihapus) karena ini "sembunyikan sampai siap", bukan penghapusan permanen — gampang dipasang lagi nanti.

### FAB Panduan: buang "Tur halaman ini"
- `js/guide-fab.js`: item `page` (beserta pengecekan `[data-section-guide-btn]`/`#start-tour` dan cabang `runAction`-nya) dihapus — setiap halaman sudah punya tombol Panduan sendiri di header. Menu FAB sekarang persis 3 kemungkinan: Video (kalau ada), Tanya AI, Kenalan dari awal. Import `startOnboardingTour` ikut dihapus (tidak dipakai lagi di file ini). Key i18n `guide.fab.page.t/m` dihapus dari `js/i18n/guides.js`.

### Hapus Jadwal Kerja ("Rutinitasku") dari halaman semua brand
- `js/views/brands.js`: seluruh blok `myRoutineHTML`/`routineTodayRow`/`routineManageHTML`/`routineManageDayGroup`/`wireMyRoutine` + helper `todayDayKey`/`isRoutineAutoDoneToday`/`ROUTINE_AUTO_STATUS_PAST` dihapus (satu blok besar, ~180 baris). Import `listRoutineTemplate, addRoutineItem, removeRoutineItem, markRoutineDoneToday, ROUTINE_DAYS, ROUTINE_ACTIVITIES` dari `store.js` dihapus dari file ini — **fungsi-fungsi itu sendiri di `store.js` tidak disentuh** (brief eksplisit: `listRoutineTemplate` masih dipakai AI Auto-Schedule lewat `routineNotesForBrand` di tempat lain). Kartu "Kerjaan minggu ini" (`weeklyWorkHTML`) dan overdue (`overdueRemindersHTML`) **tidak diubah**, masih di posisi yang sama.
- Karena `state` (routineManageOpen/addActivity/addDays) jadi sepenuhnya tidak terpakai setelah ini, `render()`/`paint()` disederhanakan — `paint(root, state, refresh)` jadi `paint(root, refresh)`. 29 key i18n `brands.routine.*`/`brands.activity.*`/`brands.day.*` dihapus dari `js/i18n/app-shell.js` (dicek semua benar-benar tidak dipakai di tempat lain). CSS `.routine-task-row`/`.routine-auto-badge` dkk dihapus dari `css/styles.css`.

### Banner: maksimal satu per boot
- `js/proactive-notif.js` `maybeShowProactiveNotif()` sekarang mengembalikan boolean (`true` kalau banner beneran tampil, `false` kalau tidak ada yang perlu dilaporkan atau sudah pernah tampil sesi ini).
- `js/main.js`: `maybeShowModeReminder()` sekarang hanya dipanggil kalau `maybeShowProactiveNotif()` mengembalikan `false` — urutan prioritas: overdue/streak (proaktif) menang atas ajakan pindah mode Pro.

### Copy: nama template, label hardcode, "milestone" → "target"
- `js/views/campaigns.js` `CAMPAIGN_QUICK_TEMPLATES`: `label` tiga template sekarang lewat `t()` (`camp.new.tpl.growSocial/growPersonal/event`) — versi id "Naikin Followers"/"Bangun Personal Brand"/"Event". Otomatis ikut ke semua tempat yang membaca `template.label` (judul modal kalibrasi, dialog nama, judul modal Terms).
- `js/views/creator.js`: 5 label hardcode ("Thumbnail", "Caption" ×2, "Script", "CTA") diganti `t("cr.f.thumbnail")`/`t("cr.f.caption")`/`t("cr.f.script")`/`t("cr.f.cta")` — dua key baru ditambah di `js/i18n/creator-copy.js` (`cr.f.thumbnail`, `cr.f.cta`), dua lainnya (`cr.f.script`, `cr.f.caption`) sudah ada dan tinggal dipakai ulang.
- **"milestone" → "target" di copy Pemula**: dicek dulu (grep menyeluruh) — 29 kemunculan kata "milestone" di teks Indonesia di seluruh i18n. Mayoritas ternyata BUKAN Pemula-visible: teks Syarat & Ketentuan (dipakai kedua mode, bukan jargon UI biasa), string di menu titik-tiga campaign (`openMoreMenu`/`openMilestoneMenu`, sudah Pro-only lewat `${guided ? "" : ...}` yang ada sejak sebelum sesi ini), dan copy tur (`guide.camp.*`, sengaja tidak disentuh — tur mengajarkan konsepnya, beda konteks dari label UI sehari-hari). Yang benar-benar diganti (mode-aware lewat `getMode()==="guided"`, key `*Guided` baru, Pro tidak berubah):
  - `js/views/campaign-detail.js`: headline "/ {total} milestone tercapai" → "target tercapai" (`camp.detail.milestonesReachedGuided`); empty state "Belum ada milestone di tahap ini" → "Belum ada target di tahap ini" (`camp.detail.noMilestonesGuided`).
  - `js/views/campaigns.js`: hint di wizard Event "Target tiap milestone dihitung dari ini..." → "Angka tiap target dihitung dari ini..." (`camp.event.audienceHintGuided`).
  - `js/next-action.js` (3 tempat, next actions yang tampil di kartu "Hari ini" Beranda maupun campaign detail): `next.insights.whyGuided`, `next.advance.whyGuided`, `next.windowEnd.labelGuided`.
  - **Belum diaudit tuntas** (di luar 4 titik di atas): kemungkinan masih ada sisa di alur/layar lain yang belum diperiksa satu-satu — kalau user menemukan "milestone" lain yang kelihatan di Pemula, tinggal pola yang sama (key `*Guided` + `getMode()==="guided"`) bisa dipakai ulang.

### Sudah diuji tanpa login
`node --check` semua file; 10 modul (`layout.js`, `brand-home.js`, `guide-fab.js`, `brands.js`, `proactive-notif.js`, `main.js`, `campaigns.js`, `creator.js`, `campaign-detail.js`, `next-action.js`) ter-`import()` bersih setelah reload penuh; halaman harga & login (`#/login`, `#/login?mode=signup`) masih render benar, 0 error console.

### Belum diuji (butuh login)
Tab "Sales" hilang dari nav Pro, halaman `#/brand/:id/sales` masih bisa dibuka manual; menu FAB cuma 3 item; halaman semua-brand tidak ada lagi kartu "Rutinitasku", "Kerjaan minggu ini" dan overdue tetap ada; hanya satu banner tampil per login (uji dengan brand yang overdue DAN akun Pemula >7 hari sekaligus — proaktif yang menang); nama template campaign berbahasa Indonesia di modal "Campaign Baru"; label Script/Caption/CTA/Thumbnail di Creator; kata "target" (bukan "milestone") di headline & empty state campaign detail, wizard Event, dan kartu "Hari ini" — semua khusus mode Pemula, Pro tidak berubah.

---

## RINGKASAN: SEMUA 7 FASE BRIEF SUDAH DIKERJAKAN (16 Sep 2026)

Brief lengkap di `.claude/brief-fix-user-flow.md` (7 fase) sudah dikerjakan berurutan dalam satu sesi panjang — lihat 7 addendum di atas (masing-masing berjudul "FASE 1" s.d. "FASE 7") untuk detail lengkap per fase, apa yang diuji, dan apa yang belum diuji. Semua perubahan **uncommitted**, semua file yang disentuh lolos `node --check`, dan setiap fase diverifikasi tanpa login (import modul bersih + halaman harga/login tanpa error console) sebelum lanjut ke fase berikutnya.

**Yang paling butuh perhatian user selanjutnya** (rangkuman "belum diuji" lintas fase — semuanya butuh login, Claude tidak boleh mengetik password):
1. **Seluruh alur Pemula end-to-end**: akun baru → pilih Pemula → form brand → Beranda → Langkah 2 (DNA auto-draft AI) → Langkah 3 (Warna & Font) → Langkah 4 (Campaign satu klik) → Langkah 5 (tur Creator berhenti di "Ide selesai"). Ini alur inti yang seluruh brief ini targetkan, dan belum ada satu pun bagian yang dicoba dengan login sungguhan.
2. **Fase 4.4 edge case**: tur onboarding Pro yang baru dibuat + 0 brand — kemungkinan `#brand-switch-btn` belum ada saat tur sampai di situ (lihat detail di addendum Fase 2).
3. **Konsistensi "milestone→target"**: hanya 4 titik yang diaudit tuntas (lihat addendum Fase 7 di atas) — kemungkinan ada sisa di layar lain.
4. File `.claude/plan-guided-tour-content-os.md` dan `.claude/prompt-tur-kalender-campaign.md` (kalau masih ada) kemungkinan sudah sebagian usang setelah Fase 1 memangkas beberapa langkah tur — belum dicek ulang terhadap brief baru ini.

**Belum dilakukan sama sekali** (di luar cakupan brief ini, dan memang tidak diminta): commit apa pun (semua uncommitted sesuai aturan main brief), migrasi `scripts/migrate-ownerid.mjs` ke prod, isi env var Vercel, akun Midtrans asli — semua ini sisa dari sesi-sesi sebelum brief ini dan masih menunggu tindakan user seperti tercatat di addendum-addendum lama di atas.

Server lokal (`python3 serve.py` → :8743) masih menyala dari sesi ini kalau mau lanjut dicek — kalau tidak lagi dipakai, boleh dimatikan.

---

## ADDENDUM: PERJALANAN BERANDA PEMULA JADI 4 LANGKAH + FIX CENTANG PALSU (16 Sep 2026)

Permintaan user: "di perjalanan kamu pada brand awal ada bug, kan ada brief diminta cek profile belum isi brand dna tapi udah ke centang / jadi ubah perjalanan kamu jadi lebih direct aja: 1. Buat akun brand, 2. Perkuat/buat brand DNA & guidelines kamu (ke centang kalau udah selesai 100% 2-2 nya), 3. Mulai rencanakan lebih terarah dan buat campaign, 4. Buat konten pertamamu sampai jadi dan upload."

### Bug centang palsu — akar masalah
Fase 3.1 bikin Brand DNA **auto-draft oleh AI begitu halaman dibuka** (`runAutoDraft` di `js/views/brand-dna.js`) dan langsung menyimpannya. Karena "selesai" diukur dari jumlah field terisi (`brandDnaCompleteness` → 8/8), langkah "Cek profil brand kamu" di Beranda ter-centang **sebelum user membaca satu kata pun**.

Fix: draft AI sekarang ditandai.
- `js/views/brand-dna.js` — `persistDna(brandId, state, { aiDraft = false } = {})` menulis `brandDNA.aiDraftPending`. Dua jalur AI (`runAutoDraft` dan `wireAiFill`) memanggil dengan `{ aiDraft: true }`; semua simpan lain (Next, "Simpan progress", Save) pakai default `false` sehingga flag-nya hilang begitu user benar-benar menyimpan.
- `js/views/brand-home.js` — satu definisi bersama `brandDnaDone(brand)`: 8/8 terisi **dan** `!aiDraftPending`. Semua yang men-centang atau membuka langkah berikutnya wajib lewat sini, bukan lewat hitungan field mentah.
- `js/views/brand-builder.js` — `isBrandBuilderComplete()` pakai `brandDnaDone()` juga (bug yang sama: tanpa ini, simpan Guidelines bisa melempar user ke Home seolah setup beres padahal DNA masih draft AI). Angka "8/8 pertanyaan terisi" di pintu hub sengaja dibiarkan — itu memang cuma hitungan field terisi.

### Perjalanan 5 langkah → 4 langkah
`buildJourney` di `js/views/beginner-home.js`: langkah `dna` + `visual` digabung jadi satu langkah `identity`.
- Centang hanya kalau **dnaDone && visualBasicsDone** (persis permintaan "2-2 nya 100%").
- Tombolnya pintar: kalau DNA belum → ke `#/brand/:id/dna` ("Isi Brand DNA"); kalau DNA sudah tapi warna/font belum → ke `#/brand/:id/guidelines/color` ("Lanjut ke warna & font"). Baris progress menyebut sisa yang mana (`progressDna` / `progressGuidelines` / `progressPartial`).
- Link "Ubah" langkah ini membuka hub Brand Builder (dua pintunya ada di sana).
- `TOTAL_STEPS = 4`; animasi celebrate sekarang bersandar pada `s.key === "identity"`; kartu quick-tool Copy Studio pakai `journey.dnaDone` yang di-return `buildJourney`.

### Copy (`js/i18n/brand-dna-builder.js`)
- Judul mengikuti kata-kata user: "Buat akun brand", "Perkuat Brand DNA & Guidelines kamu", "Rencanakan arah dan buat campaign", "Buat konten pertama sampai upload".
- Key baru: `beginner.step.identity.title|desc|ctaDna|ctaGuidelines|progressDna|progressGuidelines|progressPartial` (en + id).
- 7 key lama dihapus (`beginner.step.dna.title|desc|cta|progress`, `beginner.step.visual.title|desc|cta`) — sudah dicek 0 pemakaian di luar file i18n.
- Komentar header `beginner-home.js` yang masih menulis "5-step journey" diperbarui.

### Diuji
`node --check` seluruh `js/**/*.js` bersih. Di browser (login user, brand "ternak lele", mode Pemula): Beranda render "3 dari 4 selesai" dengan empat baris berjudul baru, hero "LANGKAH 4 DARI 4 — Buat konten pertama sampai upload", 0 error console; hub Brand Builder juga render bersih setelah `brandDnaDone` dipakai bersama.

### Belum diuji
Jalur bug-nya sendiri **belum bisa direproduksi ulang** — butuh brand baru yang Brand DNA-nya masih draft AI (brand yang ada sudah tersimpan manual, `aiDraftPending` tidak ada). Yang perlu dicek user: buka brand baru → Brand DNA auto-draft → balik ke Beranda, langkah 2 harus **belum** ter-centang dan tombolnya "Isi Brand DNA"; lalu simpan DNA → centang setengah jalan ("Tinggal warna & font") → simpan Warna+Font → baru ter-centang penuh.

### Masih tertunda
`resetVideoSeen()` (pembersih flag `video:copy` yang ikut tertulis waktu uji video) belum bisa dijalankan — tab popup `accounts.google.com` masih terbuka dan memblokir eksekusi JavaScript/navigasi di browser tool. Tutup tab popup itu, lalu jalankan sekali dari console: `(await import("/js/guide-videos.js")).resetVideoSeen()`.

---

## ADDENDUM: KENAPA VIDEO AUTOPLAY TIDAK MUNCUL DI AKUN BARU (16 Sep 2026)

User: "masih gak ada lo video yang autoplay setelah orang masuk ke akun baru???"

### Akar masalah: flag "sudah pernah lihat" itu per-BROWSER, bukan per-AKUN
Semua tanda "sudah pernah ditampilkan" punya cermin di `localStorage` **tanpa nama akun**:
`contentos:video-seen:<key>`, `contentos:section-guide-seen:<key>`, `contentos:guide-seen:<key>`, `contentos:tour-completed`.
Pertanyaan yang dijawab flag ini per-orang ("akun ini sudah lihat video kenalan belum?"), tapi localStorage menjawabnya per-browser. Akibatnya **akun kedua yang login di laptop yang sama lahir dalam keadaan "sudah lihat semuanya"**: tidak ada video kenalan, tidak ada panduan per-section, tidak ada tawaran tur. Persis gejala yang dilaporkan — daftar akun baru di browser yang sudah pernah menjalankan alurnya.

Fix: `js/seen-flags.js` (modul baru) — `readFlag/writeFlag/clearFlag/flagKey`, menamai setiap key dengan uid yang sedang login (`currentUid()` dari `account.js`, fallback `anon` kalau belum ada). Dipakai di:
- `js/guide-videos.js` (`videoSeen`, `markVideoSeen`, `resetVideoSeen`)
- `js/section-guide.js` (`guideSeen`, `markGuideSeen`)
- `js/guides/common.js` (`tourSeen`; helper `store()` disederhanakan jadi sessionStorage saja, karena bagian localStorage-nya pindah ke seen-flags)
- `js/tour.js` (`hasTourRun`/`markTourDone`) — sekalian dikasih cermin di akun (`settings.guideSeen["tour:onboarding"]`), yang tadinya satu-satunya flag tanpa cermin akun sama sekali.

**Efek samping yang disengaja:** flag lama yang tak bernama akun jadi diabaikan. Untuk video & panduan section tidak terasa, karena cermin akun di Firestore sudah ada dan itu yang dipakai. Untuk **tur onboarding**, akun lama belum punya cermin akun, jadi tawaran tur ("Mulai tur") akan muncul **sekali lagi** untuk akun yang sudah pernah ikut tur — setelah itu tersimpan di akun dan tidak muncul lagi.

### Fix kedua: satu boot bisa merender mode picker dua kali
`onAccountChange` di `js/main.js` dipanggil ulang **setiap kali dokumen `accounts/{uid}` berubah**, dan sesudah registrasi ada beberapa tulisan beruntun. Tanpa penjaga, panggilan kedua menimpa `app.innerHTML` (menghapus picker yang sedang dilihat orangnya), merender picker baru, dan meninggalkan panggilan pertama menunggu klik pada tombol yang sudah tidak ada — jadi `maybeAutoPlayVideo("kenalan")` milik panggilan itu **tidak pernah jalan**. Ditambah `modePickerShown` (module-level, di-reset di `teardownApp()` supaya logout → login akun lain tetap dapat pickernya sendiri).

### Fix ketiga: autoplay tidak lagi hilang diam-diam
`maybeAutoPlayVideo` dulu: `if (!v || !v.src || screenIsBusy() || videoSeen(key)) return false;` — satu baris, empat alasan, nol jejak.
Sekarang tiap alasan ditulis ke console (`[video] "kenalan" tidak diputar otomatis: ...`), dan kalau penyebabnya cuma **layar lagi sibuk** (ada modal/tur lain), showing-nya **tidak dibuang** — ditunggu 400ms sampai 20x lalu diputar begitu layar bebas.

### Diuji
`node --check` semua file bersih; app boot ulang tanpa error console dengan modul baru; tombol "Video" di Beranda membuka modal "Kenalan sama Brandlab" berisi panel placeholder "Video lagi disiapkan" — jadi mesin modalnya benar, yang tadinya salah cuma penjaga di depannya.

### Belum diuji / perlu dicek user
Alur aslinya (daftar akun benar-benar baru → pilih Pemula → video muncul sendiri) belum bisa dicoba Claude: butuh registrasi + password, dan tab popup `accounts.google.com` masih memblokir eksekusi JavaScript di browser tool. **Kalau masih tidak muncul, buka Console — sekarang alasannya tertulis di sana.**

**Penting:** semua perubahan ini masih **uncommitted dan belum di-deploy**. Kalau akun baru itu didaftarkan di situs yang sudah online (bukan `localhost:8743`), tidak ada satu pun perbaikan ini yang ada di sana.

---

## ADDENDUM: VIDEO PENJELASAN JADI TAKEOVER + 3 PILIHAN DI AKHIR (16 Sep 2026)

Koreksi user atas desain sebelumnya: **bukan kartu tawaran** — yang diminta video besar yang **langsung muncul sendiri di layar** (placeholder dulu), bisa di-skip, dan **setelah videonya selesai muncul tiga pilihan**: (Putar ulang videonya) (Masih mau tur website) (Saya sudah paham), lalu tulisan "kamu bisa putar di sini lagi videonya sewaktu-waktu".

### Yang berubah
- **Kartu tawaran dihapus total.** `maybeOfferVideo`, `offerCardHTML`, `activeOffer`, `hintWhenPlayerCloses`, dan seluruh CSS `.video-offer*` hilang. Lima halaman yang tadinya pakai kartu sekarang pakai `maybeAutoPlayVideo` seperti video pertama: `brand-dna.js`, `brand-guidelines.js`, `campaigns.js`, `content-os.js`, `copy-studio.js`. Jadi **keenam titik** (setelah pilih mode + 5 halaman) berperilaku sama: video besar muncul sendiri, sekali per akun.
- **`openGuideVideo(videoKey, { onTour, hint })` sekarang punya dua keadaan:**
  1. *nonton* — player besar + tombol "Lewati video";
  2. *selesai* — tiga tombol pilihan. Pindah ke keadaan 2 lewat: video `ended` (file mp4/webm), tombol Lewati, timer sepanjang `seconds` (embed YouTube/Vimeo, karena akhir videonya tidak bisa dipantau tanpa API-nya), atau **langsung** kalau entri-nya masih placeholder (tidak ada yang bisa ditonton).
- **"Masih mau tur website"** menutup modal lalu **menekan tombol Panduan halaman itu sendiri** (`[data-section-guide-btn]`) — tiap halaman yang punya video punya tombol itu, jadi tidak perlu wiring per-halaman dan tidak ada risiko circular import. Untuk video pertama (yang main sebelum ada halaman apa pun di layar), fallback-nya `startOnboardingTour()`.
- **"Kamu bisa putar ulang video penjelasannya di sini kapan aja"** muncul sebagai bubble yang menunjuk tombol Video — **apa pun cara modalnya ditutup** (pilih "sudah paham", tombol X, Escape, klik luar). Kalau yang dipilih tur, bubble-nya ditahan sampai turnya selesai (memantau class `tour-active` di `<body>`) supaya tidak rebutan layar dengan spotlight.
- **Tur tidak boleh jalan di belakang video**: `runSpotlightTour` (js/tour.js) menolak start selama ada `[data-guide-video-modal]` di layar. Menolak (bukan mengantre) supaya tanda "belum pernah lihat" milik tur itu tetap utuh — tur otomatisnya masih dapat giliran di kunjungan berikutnya.
- CSS baru: `.guide-video-skip`, `.guide-video-choices`, `.guide-video-choices-head`, `.guide-video-choice-row` (tombolnya menumpuk satu kolom di bawah 560px). Catatan jebakan: `[hidden]` cuma `display:none` di level UA, jadi `.guide-video-skip{display:flex}` sempat mengalahkannya — sekarang ada baris `.guide-video-skip[hidden], .guide-video-choices[hidden]{ display:none; }` khusus untuk itu.
- i18n (`js/i18n/guides.js`): key `guide.video.offer.body|watch|skip` dihapus; ditambah `guide.video.skip`, `guide.video.choices.head|replay|tour|done`; `guide.video.offer.replay` ditulis ulang jadi kalimat "kamu bisa putar ulang di sini kapan aja".

### Diuji di browser (login user, brand "ternak lele")
Klik tombol Video di Beranda → modal "Kenalan sama Brandlab" muncul dengan panel placeholder, tombol Lewati **tersembunyi** (benar, karena placeholder tidak ada yang diputar), dan tiga pilihan tampil. Klik "Saya sudah paham" → modal tutup, bubble "Kamu bisa putar ulang video penjelasannya di sini kapan aja." muncul. Buka lagi → "Masih mau tur website" → modal tutup, tur Beranda jalan → setelah tur habis, bubble yang sama muncul. 0 error console, `node --check` semua file bersih.

### Belum diuji
Autoplay-nya sendiri di akun yang benar-benar baru (butuh registrasi + password) — lihat addendum sebelumnya soal flag per-akun dan log `[video] ... tidak diputar otomatis: ...` di Console. Juga belum diuji dengan video sungguhan: jalur `ended` (mp4) dan jalur timer (YouTube/Vimeo) baru diuji lewat cabang placeholder-nya. Semua masih **uncommitted dan belum di-deploy**.

---

## REVISI BRAND DNA + BRAND GUIDELINES (16 Sep 2026)

Lima revisi dari user, semuanya sudah dikerjakan dan diuji di browser (brand "ternak lele", mode Pemula, port 8743).

### 1. Pemula wajib isi Brand DNA sendiri; "isi semua pakai AI" harus konfirmasi dulu
- **Auto-draft dihapus total.** `js/views/brand-dna.js` dulu punya blok di `render()`: kalau mode Pemula + DNA masih kosong + ada API key, dia langsung memanggil `runAutoDraft()` — AI mengisi 8 jawaban dan menyimpannya **sebelum pemiliknya membaca satu pertanyaan pun**. Blok itu, fungsi `runAutoDraft()`, dan cabang spinner `state.autoDrafting` di `paint()` sudah dibuang. Sekarang `render()` cuma `refresh()` — selalu mulai dari wizard langkah 1.
- **Tombolnya tetap ada, tapi lewat `confirmDialog`.** `wireAiFill()` sekarang menunggu konfirmasi sebelum memanggil AI. Isinya (`dna.aiFill.confirm.*` di `js/i18n/brand-dna-builder.js`): "Pastiin penjelasan brand kamu udah lengkap dulu — AI cuma bisa nebak dari situ. Tetap disaranin isi satu-satu: ini DNA brand kamu, jawabannya baru kepake kalau memang keluar dari kamu sendiri. Hasil AI cuma draft — baca, koreksi, dan belum dihitung selesai sampai kamu simpan sendiri." Tombolnya: [Aku isi sendiri aja] [Oke, bikin draft AI].
- `confirmDialog` di `js/modals.js` sekarang menerima `cancelLabel` (default tetap `common.cancel`, jadi semua pemanggil lama tidak berubah).
- Setelah AI selesai, `state.autoDrafted = true` di-set di `wireAiFill` (dulu di-set `runAutoDraft`), supaya Review tetap menampilkan "ini baru draf, baca dulu" + link "jawab sendiri aja".
- `aiDraftPending` tidak berubah — hasil AI tetap tidak mencentang langkah di Beranda sampai pemiliknya menyimpan sendiri.

### 2. Kode warna bisa diketik
- `colorFieldHTML()` (js/views/brand-guidelines.js): caption hex read-only diganti `hexInputHTML()` — text field beneran, di kartu besar (Utama/Sekunder/Aksen) maupun baris kecil (Latar/Teks). Baris kecil sekarang cuma menyisakan RGB/CMYK sebagai teks, hex-nya pindah ke kotak.
- Helper baru `normalizeHex()`: terima `#1a1816`, `1a1816`, `#abc`, atau dengan spasi; shorthand 3 digit dimekarkan. Tidak valid → `null`.
- Commit pakai `change` (blur) **dan** Enter langsung (Enter memanggil `commitHex()` sendiri, bukan lewat `blur()`, karena repaint mencabut node-nya jadi tidak mungkin dobel). Nilai ngawur dikembalikan ke nilai tersimpan + toast `bg.color.hexInvalid` ("Itu bukan kode warna. Contoh: #1A1816"), bukan menghapus warnanya.
- `#color-base-hex` (di dalam "Sesuaikan sendiri") ikut pakai `normalizeHex` supaya dua tempat ini berperilaku sama.
- CSS baru `.bb-hex-input` di css/styles.css (monospace, 88px, di kartu besar jadi 100%).

### 3. Brand Guidelines di Pemula = sama persis dengan Pro
- `sectionTabsHTML()`: filter `guided` dibuang — 7 tab + Review & PDF tampil di dua mode. Dulu Pemula cuma lihat Sistem Warna + Tipografi, jadi dia "menyelesaikan Brand Guidelines" tanpa pernah ditawari Logo, Arah Visual, Tone of Voice, Penerapan, apalagi Brand Book-nya.
- `PROGRESS_STEP_KEYS_GUIDED` dihapus; progress bar selalu n/5.
- `navHTML()`: tombol `#wiz-finish-visual` khusus Pemula di langkah Tipografi dihapus, diganti tombol "Balik ke Beranda" universal (lihat poin 5).
- **Catatan yang perlu keputusan user:** `visualBasicsDone()` (js/views/brand-builder.js) sengaja TIDAK diubah — centang langkah 2 di Beranda masih dipicu oleh warna + font saja, bukan kelima bagian. Kalau user mau centangnya baru nyala setelah Logo/Arah/Tone juga terisi, itu satu baris di `visualBasicsDone`.

### 4. Moodboard: pilih mood → keluar prompt keyword siap paste
- Mood = chip Arah Visual yang memang sudah ada (Minimalis/Editorial/Berani/...). Begitu dipilih, di blok Moodboard muncul satu kartu per mood terpilih.
- `MOODBOARD_PROMPT_KEYWORDS` (10 arah, keyword-nya sengaja bahasa Inggris — Pinterest/Unsplash/Envato hasilnya jauh lebih bagus), `brandSectorLabel()` (ambil klausa pertama `businessDescription`, maks 45 karakter), `moodboardPromptText()`, `moodboardSearchLinksHTML()`, `moodboardPromptsHTML()`.
- Hasil nyata di brand "ternak lele": `bold moodboard for ternak lele terbaik di indonesia brand, high contrast, oversized type, saturated color, poster energy, natural colors`.
- Tiap kartu: nama mood + tombol Salin + teks prompt (`user-select:all`, jadi sekali klik keblok semua kalau clipboard diblokir) + link Pinterest/Unsplash/Envato yang **mencari pakai prompt itu**.
- Belum pilih mood → kotak kosong "Pilih arah visual di atas — keyword buat dipaste ke Pinterest langsung muncul di sini."
- Baris lama "Cari foto referensi: Pinterest · Envato · Unsplash" dihapus (jadi duplikat yang lebih jelek), berikut `MOODBOARD_SOURCE_LINKS` dan key `guidelines.moodboard.sources`.
- CSS baru: `.mb-prompt-block`, `.mb-prompt-title`, `.mb-prompt-empty`, `.mb-prompt`, `.mb-prompt-head`, `.mb-prompt-mood`, `.mb-prompt-text`, `.mb-prompt-links`.

### 5. Tombol "Balik ke Beranda" kalau sudah selesai
- **Brand Guidelines**: muncul di `navHTML()` (jadi ada di SETIAP langkah) dan di Review, begitu warna + font benar-benar terisi. Handler `goHomeFromGuidelines()` — simpan, `markVisualBasicsJustDone()`, toast, lalu ke `#/brand/:id`. Sama di dua mode.
- **Brand DNA**: muncul di Review kalau `brandDnaCompleteness` sudah 100%. Handler `#wiz-home` menyimpan persis seperti `#wiz-save` (termasuk `markDnaJustCompleted`), bedanya selalu mendarat di Beranda (Pro-nya `#wiz-save` masih ke hub).
- Key baru `guidelines.backHome` ("Balik ke Beranda" / "Back to Home") di js/i18n.js.

### Diuji di browser
Tab Pemula sudah menampilkan 8 bagian; ketik `c0392b` di Utama → swatch, palet otomatis, dan preview ikut berubah; `#abc` → `#AABBCC`; `hijau tua` → dikembalikan + toast; klik "Berani" → prompt moodboard keluar lengkap dengan link pencarian; dialog konfirmasi AI muncul dan "Aku isi sendiri aja" membatalkan tanpa memanggil AI; "Balik ke Beranda" dari Review Brand DNA menyimpan lalu mendarat di Beranda dengan perjalanan tetap 3/4; Review & PDF Brand Book sekarang bisa dibuka dari mode Pemula. Tidak ada error console; `node --check` bersih untuk semua file JS. Lebar 375px: `.bb-color-field` dan `.bb-color-main-row` tidak overflow.

### Catatan
Warna brand "ternak lele" sempat diubah waktu tes lalu **dikembalikan** ke `#3F7D4D / #3F7D6D / #507D3F`; pilihan Arah Visual "Berani" juga sudah di-uncheck lagi. Semua perubahan **uncommitted dan belum di-deploy**.

## Addendum — 17 Sep 2026: brief "revisi Brand Lab" (trial credits, domain redirect prep)

Sumber: brief user ("revisi brandlab") soal trial, pricing, Founding Member, AI credit, migrasi domain. **Audit dulu, ternyata sebagian besar sudah ada** (trial 7 hari/1 brand, akun jadi read-only tapi data aman setelah trial habis, Founder 2-wave capped 50 tanpa nunjukin sisa slot, badge trial + meter AI credit di topbar, SSO dari wepeka.com lewat `#/sso?t=`). User diberi 4 pertanyaan (lihat di bawah) sebelum eksekusi — jawabannya: **pertahankan tier AI credit yang sudah ada** (jangan diratakan ke 50/hari), **pertahankan harga Founder Rp299rb/499rb** (jangan diubah ke Rp399rb/500rb dari brief), **scope ketat cuma brief baru ini** (jangan gabung ke rencana UX flow `.claude/brief-fix-user-flow.md`), **siapkan yang bisa disiapkan buat domain, sisanya di-flag** (jangan sentuh repo wpk-dp).

Satu-satunya gap numerik yang jelas dan disepakati: **trial AI credit dulu 5/hari (≈35 total), brief minta 100 TOTAL buat seluruh 7 hari** (bukan reset harian). Sudah diperbaiki:

- `js/ai-usage.js` — `PLAN_QUOTA.trial` dari `{period:"day", limit:5}` jadi `{period:"total", limit:100}`. Periode baru `"total"`: `usageTotal()` baca `aiUsage.totalCount` (tidak pernah direset tanggal/bulan, cuma numpuk terus — aman karena begitu akun bukan trial lagi field ini nggak kepakai). `recordAiUsage()` sekarang nulis `totalCount` juga selain `count`/`monthCount` yang sudah ada.
- `js/layout.js` (`aiUsagePopoverHTML`), `js/ai.js` (`callModel` pesan quota habis) — cabang period ditambah `"total"` (selain `"month"`/default harian).
- `js/i18n/app-shell.js` — key baru `app.aiUsage.{title,left,out,explain}Total` (en+id), copy `pricing.faq.trial.a` yang masih bilang "5 AI credit per hari" diperbaiki jadi "100 AI credit buat sepanjang trial".
- `js/i18n/ai.js` — key baru `ai.error.quotaTotal`.
- `js/views/pricing.js` — addon "Top-up 300 AI credits" dari Rp29.000 jadi **Rp20.000** (persis brief §12); masih dijual manual lewat WhatsApp (tidak ada `payKey`), belum diotomasi lewat Midtrans — kalau nanti mau instant, perlu tambah entri di `api/_plans.js ADDONS` + logic penambahan credit (bukan brand) di `api/midtrans/webhook.js`. "Top-up 1.000" (Rp79rb) dibiarkan, brief cuma nyebut satu angka (20rb/300).

**Domain (planner.wepeka.com → brandlab.wepeka.com):** tidak ada referensi domain hardcode di kode (Firebase `authDomain` pakai `wepeka-ba996.firebaseapp.com`, beda dari domain hosting app). Yang **sudah disiapkan**: `vercel.json` — blok `redirects` baru, host `planner.wepeka.com` → `https://brandlab.wepeka.com/:path*` (301). Ini baru aktif kalau kedua domain sudah di-attach ke project Vercel. **Yang BELUM bisa dikerjakan dari sini, butuh kamu**:
1. Vercel dashboard: tambahkan `brandlab.wepeka.com` sebagai domain project ini (project `content-os`, lihat `.vercel/project.json`), arahkan DNS (CNAME/A sesuai instruksi Vercel).
2. Firebase Console → Authentication → Settings → Authorized domains: tambahkan `brandlab.wepeka.com` (dan `planner.wepeka.com` boleh tetap ada selama masa transisi) — **tanpa ini, login/Google Sign-In dari domain baru akan ditolak Firebase**.
3. Cek juga sisi wepeka.com (`wpk-dp`, `WEPEKA_CONNECT_URL` = `wepeka.com/brandlab/connect`) kalau ada link balik yang hardcode `planner.wepeka.com` — **belum dicek**, repo itu tidak disentuh sesi ini.

**Sengaja tidak diubah** (dikonfirmasi ke user, brief menyebutnya tapi keputusan user pertahankan yang sudah ada): AI credit paid tier tetap Starter 20/hari · Pro 60/hari · Studio 200/hari · Founder 300/bulan · Founder Ultimate 500/bulan (bukan rata 50/hari); harga Founder tetap Rp299rb/Rp499rb (bukan Rp399rb/Rp500rb); alur "Complete Mission → Claim Trial → Founding Member Offer" di sisi Community (kemungkinan besar ada di `wpk-dp`, lihat `WEPEKA_CONNECT_URL`) tidak dicek/diubah; `.claude/brief-fix-user-flow.md` (Fase 1–7, tur nulis status konten asli dkk) tetap terpisah, belum dieksekusi.

### Diuji
`node --check` lolos di semua file di atas + `vercel.json` valid JSON. Browser (akun `wepekapparel@gmail.com`, plan lifetime/admin — unmetered, jadi meter trial TIDAK kelihatan dari akun ini): halaman `#/pricing` render tanpa error console, addon "Top-up 300 AI credits" tampil Rp20.000, FAQ trial tampil teks baru. **Belum diuji**: meter/popover AI credit trial (`X/100`, bukan `X/60`) di akun yang benar-benar berstatus trial — butuh login akun trial asli (Claude tidak boleh ketik password). Checklist buat kamu: signup akun baru → cek badge topbar bilang berapa hari trial tersisa (sudah ada sebelumnya) → pakai AI sekali → cek meter jadi "1/100" bukan "1/5", dan setelah lewat tengah malam angkanya TIDAK reset ke 0.

### Addendum kecil — 17 Sep 2026 (lanjutan): trial credit diturunkan 100 → 60
User minta angka trial AI credit diturunkan. `PLAN_QUOTA.trial.limit` di `js/ai-usage.js` jadi `60` (tetap `period: "total"`, tidak reset harian). Copy `pricing.faq.trial.a` (en+id) di `js/i18n/app-shell.js` ikut diperbaiki ("60 AI credit buat sepanjang trial"). `node --check` lolos, dicek di browser (`#/pricing`, akun lifetime) tanpa error console.

## Addendum — 20 Sep 2026: handoff "satu akun" (Firebase Auth tunggal, email verified, Brandlab bayar / trial 30 hari)

Audit funnel login kedua produk selesai, keputusan produk sudah dikonfirmasi user, belum ada kode yang diubah. Brief lengkap yang berdiri sendiri: `.claude/handoff-satu-akun.md` (salinan identik di repo wpk-dp `.claude/handoff-satu-akun.md`). Mulai dari Fase 0 (bug mandiri Brandlab: cron expiry, auth create-transaction, webhook, SSO teardown), lalu Fase 1 di wpk-dp.
