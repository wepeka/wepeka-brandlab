# Brief: perbaikan user flow Brandlab (mode Pemula & Pro)

Sumber: `.claude/audit-flow-brandlab.md` (review 16 Sep 2026). Brief ini berdiri sendiri — semua path, fungsi, dan kriteria selesai ada di sini.

## Konteks & aturan main

- Repo: `/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA`, plain HTML/JS/CSS tanpa build step. Cek sintaks per file dengan `node --check js/…`. Server lokal: `python3 serve.py` → http://localhost:8743.
- **Jangan commit/push/deploy** kecuali diminta eksplisit. Jangan pernah echo isi private key.
- Brand test: "English House Kediri"; "Pinter Mandarin" **read-only jangan diubah**; "wepeka" = akun tim asli.
- Claude tidak boleh mengetik password di browser — uji yang butuh login dilakukan user, tulis daftar "belum diuji" di akhir.
- Prinsip: **tiap langkah berakhir di Beranda**, **tiap pertanyaan ditanya sekali**, **tutorial tidak pernah mengubah data**. Jangan menambah fitur/langkah baru; yang diminta adalah menghapus, menggabung, memindah, menyederhanakan.
- Mode internal: `guided` (tampil "Pemula") / `advanced` (tampil "Pro"), lewat `getMode()` di `js/mode.js`. Semua copy lewat `t()` di `js/i18n/*.js` (id + en), jangan hardcode.
- Kerjakan per fase, urut. Tiap fase selesai: `node --check` semua file yang disentuh, lalu catat di `.claude/next-session-prompt.md` (addendum baru) apa yang berubah + apa yang belum diuji.

---

## FASE 1 — Tutorial tidak boleh mengubah data (paling penting)

### 1.1 Tur Creator berhenti di "Ide selesai"
File: `js/guides/creator-guide.js`, `js/i18n/guides.js`.
- `executionSteps()` sekarang berisi langkah dengan `write: true` (`#mark-shot-big`, `#mark-edited-big`, `#uploaded-instagram`, `#mark-uploaded-done`) yang menulis status asli sampai `published`. Ubah agar **tidak ada gate `write`/`interactive` setelah `#mark-submitted`**:
  - Pertahankan langkah `#mark-submitted` (change gate) sebagai langkah terakhir yang menulis.
  - Sisa tahap (Syuting → Editing → Siap upload → Terbit) jadi **satu langkah info** tanpa gate, menunjuk `.stage-script-display` (atau centered `skipIfMissing:false`), dengan body baru di i18n: menjelaskan tiga tombol besar berikutnya dan bahwa "Selesai" = terbit hari ini. Hapus langkah `shot`, `edited`, `thumb`, `copyCaption`, `uploaded`, `done`, `where`, `cycle` dari tur.
  - Hapus kalimat "(Buat tur ini boleh langsung klik.)" dan "Konten latihan tadi bisa kamu hapus…" dari `guide.creator.*`.
- Recap (`guide.creator.recap`) tetap menyebut ritme Ide → AI → Syuting → Editing → Upload → Terbit.
- Kriteria selesai: menjalankan tur Creator dari awal sampai akhir pada brand kosong menghasilkan tepat **1 konten berstatus `production`** (bukan `published`), Beranda Langkah 5 **belum** ✓, campaign Grow Social tetap 0 konten terbit.

### 1.2 Hapus pengalihan paksa Content OS → Creator
File: `js/views/content-os.js` baris ±902–906 (blok `if (activeSub === "dashboard" && !guideSeen("content-os") && !tourSeen("creator"))`).
- Hapus blok itu. Tab yang diklik = tab yang tampil, di kedua mode.
- Kriteria: Pro klik "Content OS" pertama kali → Dashboard; Pemula klik "Konten" → Creator (karena tab pertama Pemula memang Creator) tanpa `setPendingTour`.

### 1.3 Matikan autoplay tur di halaman selain Beranda & Creator
File: `js/views/brand-builder.js` (`maybeShowSectionTour("brand-builder")`), `js/views/brand-dna.js` (`"brand-dna"`), `js/views/brand-guidelines.js` (`"brand-guidelines"`), `js/views/content-os.js` (`"content-os"`), `js/guides/calendar-guide.js` (`startCalendarGuideOnMount`), `js/guides/campaign-guide.js` (`startCampaignListGuideOnMount`, `startCampaignDetailGuideOnMount`).
- Hapus panggilan `maybeShowSectionTour(...)` di file-file itu; **pertahankan** `wireSectionGuideButton`/`wireGuideButton` (tombol Panduan tetap bisa memutar tur). Untuk `startGuideOnMount`, pertahankan hanya jalur `forced` (pending dari tombol replay Settings / rantai tur); buang jalur `maybeShowSectionTour(autoplayKey…)` — cara paling kecil: tambahkan opsi `autoplay: false` di `startGuideOnMount` (`js/guides/common.js`) dan pakai di Kalender & Campaign.
- Yang tetap autoplay sekali: Beranda Pemula (`beginner-home.js`, 4 langkah — lihat 3.4 untuk pemangkasan) dan Creator (`startCreatorGuideOnMount`, hanya guided).
- Tur detail campaign: hapus `brainstormSteps()` bagian yang berakhir mendorong ke Creator (`#brainstorm-done` gate + `clearCreatorRequestStep`); tur berhenti di halaman itu. Boleh tetap menjelaskan tombol Brainstorm sebagai info.

---

## FASE 2 — Pembukaan: satu layar, satu tawaran tur

### 2.1 Modal intro hanya sekali seumur akun
File: `js/brandlab-intro.js`, `js/main.js` (±baris 186), `js/store.js` (settings).
- Ganti `let shownThisSession` dengan cek `getSettings().introSeenAt`; set `updateSettings({ introSeenAt })` saat modal ditutup dengan tombol mana pun. Modal tetap bisa dibuka dari FAB Panduan → "Kenalan dari awal" (`js/guide-fab.js` act `onboarding` → panggil `maybeShowBrandlabIntro({ force: true })`, tambahkan param `force`).
- Jangan sentuh gate video (`introVideoWatchedAt`) — biarkan seperti sekarang, hanya berlaku saat modal memang tampil.

### 2.2 Gabungkan pilih tipe + intro
File: `js/mode-picker.js`, `js/i18n/guides.js` (`modes.pick.*`), `js/i18n.js` (`intro.*`).
- Di atas dua kartu Pemula/Pro tampilkan `intro.pitch` (2 kalimat). Setelah kartu dipilih, **jangan** tampilkan modal intro lagi pada boot pertama (`main.js`: panggil `maybeShowBrandlabIntro` hanya jika `!firstEverOpen`; dengan 2.1 ia otomatis tidak tampil lagi setelah `introSeenAt` diset — set `introSeenAt` saat mode dipilih).
- Buang `intro.note` (cek merek DJKI) dan dua baris grup DNA/Guidelines dari modal — sisakan pitch + tombol.

### 2.3 Satu undangan tur
File: `js/tour-prompt.js`, `js/views/brands.js`, `js/main.js`.
- Hapus banner `maybeShowTourPrompt` (dan panggilan `onLater` di `main.js`). Hapus `onboardingCardHTML()` ("Baru di sini? Mulai dari dasarnya") dan `setupVideoCardHTML()` ("Video panduan setup — Segera hadir") dari `brands.js`.
- Sisakan: tombol "Ikuti tur dulu" di kartu hero 0-brand (`#start-tour`) **hanya untuk Pro**; di Pemula sembunyikan (Beranda + form brand adalah onboarding-nya). FAB Panduan tetap punya "Kenalan dari awal".
- Hapus `has-news` (titik berdenyut) di tombol mode (`js/layout.js` `modeExplainerSeen`).

### 2.4 Tur onboarding (Pro / dari FAB)
File: `js/tour.js` `startOnboardingTour()`.
- Hapus langkah `#my-routine-card` dan langkah `.brand-tile` clickAny ("Yuk mulai") dari daftar setelah form brand. Setelah `[data-save]` langsung ke `#brand-switch-btn` dst (semua sudah ada di halaman brand). Ini menghilangkan jeda 8 detik "Sebentar…" di Pemula kalau tur dipicu dari FAB.

### 2.5 Halaman harga → daftar
File: `js/views/pricing.js`, `js/views/login.js`, `js/main.js`.
- Link "Daftar untuk bayar" mengarah ke `#/login?mode=signup` atau `#/signup`; `login.js` membaca hash dan mulai di `state.mode = "signup"`. `main.js` `showLogin` harus mengenali hash baru.

---

## FASE 3 — Beranda sebagai peta: tiap langkah pulang ke Beranda

### 3.1 Langkah 2: DNA dibuka sudah terisi AI (Pemula)
File: `js/views/brand-dna.js`, `js/views/beginner-home.js`, `js/i18n/brand-dna-builder.js`.
- Di Pemula, saat `#/brand/:id/dna` dibuka dan `countAnswered(answers) === 0` dan AI aktif: jalankan `generateBrandDnaDraft` otomatis (tampilkan status "AI lagi nulis draf… ±20 detik"), simpan via `persistDna`, lalu tampilkan **Review** (`state.stepIndex = STEPS.length`) dengan subjudul baru: "Ini yang kami tangkap dari ceritamu — koreksi kalau ada yang kurang pas, lalu Simpan." Tambahkan link kecil di Review "Mau jawab sendiri satu-satu? →" yang set `stepIndex = 0`.
- Kalau AI gagal/nonaktif → jatuh ke wizard seperti sekarang (kartu AI-fill tetap ada).
- Copy Beranda `beginner.step.dna.title/desc`: ganti jadi "Cek profil brand kamu" / "AI sudah menulis profil brand dari ceritamu tadi. Baca sebentar, koreksi yang kurang pas." (id + en). Tombol: "Cek & koreksi".
- Pro tidak berubah.

### 3.2 "Gabungkan" otomatis
File: `js/views/brand-dna.js` (`wireComposeOrFunnelStep`, `navHTML`, `updateNextState`).
- Pada langkah `kind: "compose"`: Lanjut aktif kalau kotak-kotak terisi **atau** textarea gabungan terisi. Saat Lanjut/"Simpan progress" diklik dan textarea gabungan kosong, jalankan logika `#compose-answer` dulu (compose dari `step.compose(parts)`), baru `persistDna`. Tombol "Gabungkan" tetap ada (opsional). Hint `dna.nav.fillFirst` tetap valid karena sekarang benar-benar hanya muncul kalau kotak kosong.

### 3.3 Tujuan setelah Simpan DNA & Guidelines
File: `js/views/brand-dna.js` (`wireReview` → `#wiz-save`), `js/views/brand-guidelines.js` (`wireReview` → `#wiz-save`).
- Pemula: `location.hash = #/brand/:id` (Beranda). Pro: tetap ke hub. Flag `DNA_JUST_COMPLETED_KEY` boleh dibaca juga oleh `beginner-home.js` untuk toast "Brand DNA selesai 🎉".

### 3.4 Beranda: pangkas tur & perbaiki tag funnel
File: `js/views/beginner-home.js`, `js/views/beginner-content-os.js`, `js/funnel-field.js`.
- `TOUR_STEPS` Beranda: hapus langkah `#mode-toggle-btn`. Sisakan hero, journey, consultant (3 langkah).
- `todoRowsHTML` (beginner-home) dan `upNextRowHTML` (beginner-content-os): ganti `${c.funnel}` dengan label Pemula `t(\`creator.funnel.guided.${c.funnel}.title\`)` (helper kecil di `funnel-field.js`, mis. `funnelLabel(funnel)`), fallback "" kalau kosong.

---

## FASE 4 — Langkah 3 "Pilih warna & font" sesuai janjinya

File: `js/views/beginner-home.js`, `js/views/brand-builder.js`, `js/views/brand-guidelines.js`, `js/i18n/brand-guidelines.js`.

### 4.1 Mendarat di Warna, bukan Fondasi
- `beginner-home.js` step `visual.href` → `#/brand/${brandId}/guidelines/color`; `editHref.visual` sama.

### 4.2 Hapus lapisan halaman grup
- `brand-builder.js` `hubDoorHTML`: pintu Guidelines → `#/brand/:id/guidelines/color` (bukan `/builder/guidelines`). `paintGroup` boleh dibiarkan untuk URL lama, tapi tidak ada lagi link yang menuju ke sana; `backLinkHTML` di `brand-guidelines.js` → `#/brand/:id/builder` (Pro) atau Beranda (Pemula).

### 4.3 Tab Pemula: Warna → Font → Selesai
- `brand-guidelines.js`: di Pemula, `STEPS` yang ditampilkan di `sectionTabsHTML` hanya `color`, `typography`; `navHTML` pada `typography` menampilkan tombol "Selesai, balik ke Beranda" (aktif kalau `isStepFilled("color")` dan `isStepFilled("typography")`) yang memanggil commit + `location.hash = Beranda`. Tab Fondasi/Logo/Arah/Tone/Penerapan/Review tetap bisa diakses lewat URL dan di Pro (tanpa perubahan).
- `guidelinesProgressHTML` di Pemula menghitung 2 bagian (warna, font) → "1/2 bagian selesai"; `PROGRESS_STEP_KEYS` dipilih per mode.
- Tab Warna: pindahkan blok chip kesan (`bb-chip-row` data-feeling) ke **atas** blok rumus, dengan judul "1. Pilih kesan (satu klik, palet jadi)"; rumus + hex + eyedropper + ekstrak foto masuk `<details>` "Sesuaikan sendiri". Logika `wireColorStep` (chip → anchor primary + formula) sudah mendukung ini, tidak perlu diubah.

### 4.4 Satu definisi "selesai" untuk visual
- Buat `export function visualBasicsDone(brand)` di `brand-builder.js` = `colors.primary && fonts.primary && fonts.secondary`. Pakai di `beginner-home.js` (`hasGuidelines`), dan di `hubDoorHTML` Pemula tampilkan "Warna & font selesai" bila true, bukan "n/5 tahap". `isBrandBuilderComplete` (Pro/celebration) tidak berubah.
- Callout Beranda `beginner.callout.builderDone` ("Brand kamu sudah siap! Sekarang tentukan tujuannya"): picu saat `visualBasicsDone` pertama kali true di Pemula (bukan hanya saat semua 5 bagian selesai). Simpan flag sekali-pakai di sessionStorage seperti `BUILDER_JUST_COMPLETED_KEY`.
- Logo/Tone/Arah/Penerapan di Pemula ditawarkan lewat mesin "Hari ini": tambahkan satu aksi fallback di `todayHeroHTML` (`beginner-home.js`) — kalau tidak ada aksi campaign dan `!brand.brandGuidelines?.logo?.dataUrl` → "Lengkapi Brand Book: upload logo" → `#/brand/:id/guidelines/logo`. Ini bukan fitur baru, hanya link ke halaman yang sudah ada.

---

## FASE 5 — Campaign: satu klik, dan langkah pertama yang masuk akal

File: `js/views/campaigns.js`, `js/next-action.js`, `js/views/campaign-detail.js`, `js/i18n/campaigns.js`.

### 5.1 Pemula: template → langsung jadi
- `openNewCampaignFlow`: kalau `getMode() === "guided"` dan template bukan `event`, lewati `openMissionCalibration` (startIndex 0) **dan** `promptDialog` nama (pakai `GUIDED_DEFAULT_NAMES`). Terms (Grow Personal) tetap. Pro tidak berubah.

### 5.2 Next action saat belum ada konten
- `next-action.js` `nextActions`: kalau `linked.length === 0` (belum ada konten terkait campaign), dorong `brainstorm` **sebelum** `insights` (prioritas 1.5 atau ubah `insights.priority` jadi 8 selama `linked.length === 0`). Label brainstorm Pemula: "Bikin konten pertama untuk campaign ini".

### 5.3 Detail campaign Pemula saat 0 konten
- `campaign-detail.js` `paintDetail`: di Pemula, jika `acts.linked.length === 0`, bungkus `missionTreeHTML` + `milestoneListHTML` + `ladderRulesHTML` dalam `<details class="cd-optional"><summary>Lihat semua target level ini (n)</summary>…</details>` (tertutup). Headline tetap tampil.
- Toast `camp.new.createdLadder` → "\"{name}\" dibuat — sekarang bikin konten pertamanya." (id + en).

---

## FASE 6 — Creator: tanya sekali, tanggal ada di tempatnya

File: `js/views/creator.js`, `js/i18n/creator-copy.js`.

### 6.1 Modal AI Pemula lebih pendek
- `openAiScriptModal` (non-lite) di Pemula: hanya prompt + `funnelFieldHTML` (+ follow-up MOFU/BOFU). Sembunyikan Durasi, "Tujuan video", Artikel (bungkus `getMode() !== "guided"`). `genParams` sudah `?.`-aman.

### 6.2 Tujuan konten ditanya sekali
- Panel draf (`draftingPanel` → `campaignFunnelFieldsHTML`): di Pemula, kalau `c.funnel` sudah terisi dari modal, tampilkan hanya baris ringkas "Tujuan: {label} · ubah" (klik "ubah" membuka picker inline yang sama). Kalau belum terisi, tampilkan picker penuh seperti sekarang. Pro tidak berubah.

### 6.3 Tanggal upload di panel Siap upload
- `readyToUploadPanel`: tambahkan field `<input type="date" id="f-schedule" min=today>` berlabel `t("contentEditor.scheduleDate.label")` (label & hint `calendar.pastDate` sudah ada) di atas centang platform; `blur/change` → `updateContent(id, { scheduleDate })`. Ini memindahkan field yang sudah ada di drawer editor, bukan fitur baru. Kalender otomatis menampilkannya.

### 6.4 Sembunyikan tombol thumbnail yang selalu gagal
- `readyToUploadPanel` dan `content-editor.js` (`#ai-thumb-gen`): render tombol hanya jika `getSettings().ai?.provider === "gemini"` (cek `ai.geminiApiKey`). Field Thumbnail (upload manual) tetap.

### 6.5 Tab Pemula: buang "Ringkasan"
- `content-os.js` `GUIDED_SUB_TABS`: hapus entri `dashboard`. Route `content-os` tanpa sub di Pemula → redirect ke `creator`. `beginner-content-os.js` tidak dipakai lagi di Pemula (boleh dihapus setelah tidak ada import). Copy `cnt.os.tour.body` "Empat tab" → "Tiga tab".

---

## FASE 7 — Bersih-bersih tumpukan bantuan & buntu

- `js/layout.js` `TABS` (Pro): sembunyikan `sales` sampai halamannya ada (halaman `sales.js` tetap bisa diakses via URL/widget Beranda — atau hapus juga `salesWidgetHTML` di `brand-home.js`; pilih salah satu, konsisten).
- `js/guide-fab.js` `itemsHTML`: hapus item `page` ("Tur halaman ini") — tombol Panduan sudah ada di header tiap halaman. Menu FAB = Video (jika ada), Tanya AI, Kenalan dari awal.
- `js/views/brands.js`: hapus `myRoutineHTML` beserta wiring-nya dari halaman semua brand (Jadwal Kerja di Kalender + `syncCadenceRoutine` tetap menjadi satu-satunya sumber; kalau `listRoutineTemplate` masih dipakai AI Auto-Schedule lewat `routineNotesForBrand`, biarkan datanya, hanya UI-nya yang dihapus). Kartu "Kerjaan minggu ini" dan overdue tetap.
- Banner: `js/main.js` — pada satu boot maksimal **satu** banner: urutan prioritas proaktif (overdue/streak) > mode reminder. Implementasi: `maybeShowProactiveNotif()` mengembalikan boolean; panggil `maybeShowModeReminder()` hanya jika false.
- Copy: nama template campaign (`CAMPAIGN_QUICK_TEMPLATES.label`) lewat `t()` dengan versi id ("Naikin Followers", "Bangun Personal Brand", "Event"); label hardcode "Script", "Caption", "CTA", "Thumbnail" di `creator.js` → `t()`. Istilah "milestone" di copy Pemula → "target".

---

## Urutan pengerjaan & pengujian

1. Fase 1 → 2 → 3 → 4 → 5 → 6 → 7. Setiap fase satu addendum di `.claude/next-session-prompt.md`.
2. Uji tanpa login: `node --check` semua file yang disentuh; buka http://localhost:8743 untuk memastikan halaman harga/login tidak error di console (`preview_start` / navigate).
3. Uji dengan login (dilakukan user, siapkan checklist-nya): akun baru → pilih Pemula → form brand → Beranda; Langkah 2 langsung Review terisi AI → Simpan → Beranda; Langkah 3 mendarat di Warna, klik satu chip, pilih kombinasi font, "Selesai" → Beranda + callout; Langkah 4 satu klik template → detail campaign kolaps, next action "Bikin konten pertama"; Langkah 5 tur Creator berhenti di "Ide selesai", tidak ada konten Terbit; login kedua tidak ada modal intro & tidak ada banner tur; Pro klik Content OS → Dashboard.
4. Jangan ubah: engine tur (`runSpotlightTour`), mesin campaign-metrics, formulas, Firestore rules, AI prompts.
