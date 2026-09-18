# Plan: Tur Terpandu Content OS & Campaign ("belajar sambil ngerjain")

Disusun 14 Sep 2026 untuk dieksekusi oleh Opus/Sonnet. Semua selector, file, dan alur di bawah sudah dicek terhadap kode yang ada di repo ini (branch `feature/brand-guidelines-premium-redesign`, semua masih uncommitted).

## 0. Tujuan produk

User baru (pemilik usaha, bukan marketer) harus bisa, tanpa dijelaskan orang:

1. **Creator Studio**: bikin konten → generate hook/script/caption pakai AI → pilih hook → isi kelengkapan → centang "Ide selesai — lanjut ke syuting" → buka teleprompter → Selesai Syuting → Editing Done → centang platform yang sudah di-upload → Done → konten otomatis pindah ke **Published** (hilang dari sidebar Creator, muncul di tab Konten dan di Kalender sebagai tanggal terbit).
2. **Kalender**: buka **Bank Konten** → drag konten ke tanggal (atau klik tanggal → pilih dari daftar) → lihat **Jadwal Kerja** (tujuannya: sistem/AI baca jadwal ini) → **Jadwal Otomatis AI** (AI baca campaign, urgensi, konten yang sudah syuting, jadwal kerja) → tinjau → konfirmasi → **Ekspor ke Google Calendar** → ganti tampilan **Bulan/Minggu/Hari** → **Konten Baru** dari kalender.
3. **Campaign**: Campaign Baru → pilih template → level/mission → milestone yang otomatis vs manual → Brainstorm Konten (AI) → simpan ide → lanjut ke Creator → naik level.

Prinsip:

- **Belajar sambil ngerjain**, bukan cuma baca tooltip. Langkah kunci di-gate pada aksi asli (pola yang sudah ada di `js/tour.js`: `interactive: { type: "click" | "input" }`).
- **Pakai konten user sendiri**, bukan data dummy. Tur Creator dimulai dari "Konten Baru". Kalau brand sudah punya konten, tur memakai konten yang sedang dipilih.
- **Tidak pernah terjebak**: setiap langkah yang butuh AI/koneksi/campaign punya tombol "Lewati langkah ini".
- **Bisa diulang kapan saja** lewat tombol "Panduan" yang sudah ada di tiap section (`sectionGuideButtonHTML`), dan autoplay **sekali** di mode Guided (pola `maybeShowSectionTour`).
- **Bahasa Indonesia santai**, konsisten dengan copy Guided yang sudah ada ("kamu", "bikin", "nggak").

## 1. Kondisi sekarang (yang dipakai ulang)

| Komponen | File | Catatan |
|---|---|---|
| Engine spotlight | `js/tour.js` → `runSpotlightTour(steps, { onFinish, keepOnNavigate })` | Dim 4 strip + ring + tooltip. Gate `click` (dengan `extraSelectors`) dan `input` (`minLength`). `beforeStep` async. `waitForSelector` polling 4 detik lalu **skip diam-diam** kalau target tidak muncul. Tur mati saat `hashchange` kecuali `keepOnNavigate`. Hanya satu tur aktif; tur onboarding besar punya prioritas. |
| Section guide | `js/section-guide.js` | `maybeShowSectionTour(key, steps)` autoplay sekali (Guided saja), `sectionGuideButtonHTML(key)` + `wireSectionGuideButton(root, key, steps)`. Key localStorage `contentos:section-guide-seen:<key>`. |
| Tur yang sudah ada | `js/views/content-os.js` `TOUR_STEPS` (3 langkah tab), `js/views/campaigns.js` `TOUR_STEPS` (1 langkah), `js/views/beginner-home.js` | Yang di Content OS dan Campaign **akan diganti** oleh tur baru di plan ini. |
| Help "?" | `js/help.js` | Tetap, tidak disentuh. |
| CSS | `css/styles.css` baris ±950–976 (`.tour-overlay` z-index 95, `.tour-dim`, `.tour-highlight-ring`, `.tour-tooltip`, `.tour-hint`) | Modal `.overlay` z-index 70, teleprompter `.tp-overlay` 90, menu `.menu` 60 → tur selalu di atas semuanya, **bisa spotlight elemen di dalam modal/drawer/teleprompter**. |
| Replay | `js/views/settings.js` → tombol "Take the Tour" → `startOnboardingTour()` | Tambah 3 tombol replay tur baru di sini. |

Routing yang relevan (`js/main.js parseRoute`): Content OS sub-tab adalah **route berbeda** (`#/brand/:id/content-os/creator`, `/calendar`, `/list`, dan `/creator/:contentId`). Artinya pindah Creator → Kalender memicu `hashchange` dan mematikan tur biasa. Keputusan: **tiga tur terpisah per halaman** (Creator, Kalender, Campaign) yang **dirantai** lewat prompt di akhir tur, bukan satu tur raksasa dengan `keepOnNavigate`.

## 2. Perubahan engine (`js/tour.js`) — kerjakan dulu

Semua tambahan backward-compatible; tur onboarding lama tidak berubah perilaku.

### 2.1 Gate interaktif baru

Tambahkan ke `wireInteractive(step, target)`:

| `interactive.type` | Kapan lanjut | Dipakai untuk |
|---|---|---|
| `click` (ada) | klik target atau `extraSelectors` | tombol |
| `input` (ada) | `target.value.length >= minLength` | textarea/input |
| **`change`** | event `change` pada target, opsional `predicate(target) => boolean` (default: checkbox `checked === true`, select `value !== ""`) | centang "Ide selesai", centang "Uploaded to Instagram", pilih campaign |
| **`until`** | polling tiap 300 ms `predicate() => boolean` **dan/atau** event `db:change` di `window` | "tunggu hasil AI muncul" (`qs("#hooks-section .card")`), "tunggu konten dapat tanggal" (drag-and-drop), "tunggu status jadi published" |
| **`clickAny`** | klik salah satu elemen yang cocok `selector` (bukan hanya elemen pertama) | "Pakai" salah satu hook (`[data-insert-hook]`), pilih platform (`[data-platform-pick]`), pilih template campaign (`[data-quick-template]`) |

Catatan implementasi:

- `until` **tanpa timeout** (AI bisa 10–30 detik). Tampilkan hint "⏳ Tunggu hasilnya muncul…" dan biarkan tombol Lewati tetap aktif.
- `clickAny`: spotlight elemen pertama, tapi pasang listener ke semua `qsa(selector)`.
- Untuk `change` pada checkbox yang di-`updateContent` lalu repaint (Creator me-render ulang seluruh panel), listener cukup `{ once: true }` seperti `click`.

### 2.2 Opsi langkah baru

```js
{
  selector, title, body,
  beforeStep,            // ada
  interactive,           // ada + tipe baru
  skippable: true,       // tampilkan link "Lewati langkah ini" di tooltip (tanpa mematikan tur)
  skipIfMissing: true,   // (default true — perilaku lama) target tidak ada → lompat
  showIf: () => boolean, // evaluasi sebelum beforeStep; false → langkah dilewati tanpa jeda
  chapter: "Tulis konten", // label bab, ditampilkan di progress ("Bab 1 · Langkah 3/9")
  hint: "Klik 'Pakai' di hook yang paling kamu suka", // override teks hint default
  waitTimeout: 8000,     // override 4000 ms untuk target yang muncul setelah fetch/AI
  placement: "top" | "bottom" | "auto", // default auto (perilaku lama)
}
```

- `skippable` menambah `<button class="btn btn-ghost btn-sm" data-tour-skip-step>Lewati langkah ini</button>` di baris aksi. Wajib `true` untuk semua langkah yang butuh AI key, koneksi Instagram, atau campaign.
- Tombol lama: ganti teks ke Indonesia — `Back → Kembali`, `Skip → Tutup tur`, `Next → Lanjut`, `Done → Selesai`; progress `Step X of Y → Langkah X dari Y`.
- `onFinish(reason)` terima `"done" | "closed"` supaya chaining hanya jalan kalau tur benar-benar selesai.

### 2.3 Persistensi progres (opsional tapi disarankan)

Tur Creator ±25 langkah dan melewati reload (AI lambat, user refresh). Simpan `sessionStorage["contentos:tour-progress:<key>"] = index` tiap `showStep`; saat tur dimulai ulang di sesi yang sama dari tombol Panduan, tawarkan "Lanjut dari langkah N?" Kalau dirasa berlebihan, lewati dulu dan cukup rantai 3 tur pendek.

### 2.4 Helper chaining (`js/guides/common.js`, baru)

```js
export function offerNextTour({ title, body, ctaLabel, hash, startKey }) // modal kecil: "Lanjut ke Kalender?" → set sessionStorage["contentos:start-tour"] = startKey → location.hash = hash
export function consumePendingTour(key)  // dipanggil di render() halaman tujuan; kalau cocok, hapus flag & return true
export function tourSeen(key) / markTourSeen(key)   // wrapper localStorage "contentos:guide-seen:<key>"
```

## 3. Tur A — Creator Studio (`js/guides/creator-guide.js`, baru)

Entry: `js/views/creator.js` `paint()` setelah `wireHelpButtons(root)`. Tambah tombol `sectionGuideButtonHTML("creator")` di `page-head` (sebelah "Konten Baru") dan autoplay `maybeShowSectionTour("creator", buildCreatorSteps(ctx))` **hanya** saat Guided. Hapus 3 langkah lama di `content-os.js` `TOUR_STEPS` (ganti dengan 1 langkah pengantar tab, lihat §6).

Konteks yang dibaca saat build steps: `listContent(brandId)` (ada konten atau tidak), `hasAiKey(getSettings().ai)`, `listCampaigns(brandId).length`, `getMode()`.

**Cabang awal**: kalau brand belum punya konten yang belum terbit → mulai dari Bab 1 (buat konten). Kalau sudah ada → Bab 1 diganti 1 langkah "Ini daftar konten yang lagi dikerjakan, klik salah satu" (`.creator-item`, `clickAny`) lalu lompat ke Bab 2.

### Bab 1 · Bikin konten pertama

| # | Selector | Judul | Isi tooltip | Gate |
|---|---|---|---|---|
| 1 | `#new-content` (extra: `#new-content-empty`) | Mulai dari sini | "Semua konten lahir dari tombol ini. Klik buat bikin konten pertamamu." | `click` |
| 2 | `[data-platform-pick]` (modal "Konten ini buat platform apa?") | Buat platform apa? | "Pilih satu. Pilih **Mirror** kalau video yang sama mau naik ke Instagram dan TikTok sekaligus — dibuatin dua kartu yang saling sinkron." | `clickAny` |
| 3 | `#f-title` (drawer Content Editor) | Kasih judul | "Judul kerja aja, buat kamu sendiri. Nanti bisa diganti." | `input` minLength 3 |
| 4 | `#f-idea` | Idenya apa? | "Satu-dua kalimat: konten ini mau ngomongin apa. Ini yang dibaca AI di langkah berikutnya." | `input` minLength 10, `skippable` |
| 5 | `#f-campaign` | Bagian dari campaign? | "Kaitkan ke campaign biar progres level-nya kehitung otomatis. Boleh dikosongin dulu." | `showIf: campaigns.length > 0`, `skippable`, tanpa gate |
| 6 | `[data-save]` (drawer) | Simpan | "Klik Simpan. Kontennya langsung muncul di daftar kiri." | `click` |

Catatan: drawer Content Editor dan Creator berbagi id `#f-title`/`#f-idea`/`#f-campaign`. Selama drawer terbuka, `qs()` mengembalikan yang di drawer karena drawer di-append ke `body` **setelah** `#app`? **Tidak dijamin** — `qs` = `querySelector` mengambil yang pertama di DOM, yaitu yang di Creator kalau panel drafting sedang tampil. Solusi: langkah 3–6 pakai selector berprefix `.overlay .drawer #f-title`, `.overlay .drawer [data-save]` (sudah dicek: `js/modals.js openDrawer` membuat `.overlay > .drawer`; modal biasa memakai `.overlay.center`).

### Bab 2 · Generate pakai AI

Setelah simpan, Creator repaint dan konten baru terpilih (`state.selectedId` = item pertama; pastikan dengan `beforeStep` yang klik `.creator-item[data-select="<id>"]` — simpan id konten baru dari `db:change` terakhir, atau cukup andalkan sort `updatedAt desc`).

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 7 | `#ai-generate-all` | Biar AI yang nulis draft-nya | "AI sudah baca Brand DNA, karakter, tone of voice, dan campaign aktif brand kamu. Klik buat bikin hook, script, dan caption sekaligus." | `click`; `showIf: hasAiKey`; kalau tidak ada key → ganti langkah 7–12 dengan 1 langkah "AI belum aktif" yang spotlight `#f-script` ("Tulis script manual di sini — atau aktifkan AI di Pengaturan → AI") |
| 8 | `#ai-prompt` (modal) | Ceritain kontennya | "Boleh detail, boleh garis besar. Ide dari langkah tadi sudah masuk otomatis. Ada tombol mic kalau lebih enak ngomong." | `input` minLength 10 |
| 9 | `#ai-funnel` | Tujuan kontennya | "Pilih: bikin orang kenal (TOFU), bikin orang percaya (MOFU), atau bikin orang beli (BOFU). Ini ngubah cara AI nulis." | tanpa gate |
| 10 | `#ai-generate` | Generate | "Klik. Tunggu 10–30 detik." | `click` |
| 11 | `#hooks-section .card` | Tunggu hasilnya | "Sabar sebentar, AI lagi nulis…" | `until: () => qs("#hooks-section [data-insert-hook]")`, `waitTimeout` besar, `skippable` |
| 12 | `[data-insert-hook]` | Pilih hook favoritmu | "Hook = 1–2 kalimat pertama yang bikin orang berhenti scroll. Klik **Pakai** di yang paling kena. Nggak ada yang cocok? Klik ikon ↻ buat minta hook baru." | `clickAny` |
| 13 | `.use-script-btn` | Pakai script-nya | "Script lengkap dengan format HOOK / ISI PEMBAHASAN. Klik **Pakai script ini** — nanti masih bisa diedit." | `click` |
| 14 | `.use-caption-btn` | Caption juga | "Caption buat postingan, sudah ada hashtag. Klik **Pakai caption ini**." | `click`, `skippable` (caption bisa kosong) |
| 15 | `.ai-feedback` (strip 👍/👎 pertama yang terlihat) | Bantu AI-nya belajar | "Tiap hasil AI ada 👍/👎. Isi kalau sempat — masukanmu dipakai buat bikin AI ini makin cocok sama brand kamu." | tanpa gate, `skipIfMissing` |
| 16 | `#ai-close` | Tutup | "Semua yang kamu pilih sudah masuk ke form. Tutup jendela ini." | `click` |

### Bab 3 · Lengkapi & serahkan ke syuting

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 17 | `#f-script` | Ini script kamu | "Edit sesuka hati. Tersimpan otomatis tiap kamu klik keluar dari kotaknya (lihat tulisan 'Tersimpan')." | tanpa gate |
| 18 | `#open-teleprompter` (yang di panel drafting) | Coba teleprompter | "Klik buat baca script layar penuh — teks jalan sendiri, kecepatan dan ukuran bisa diatur. Ini yang kamu pakai pas syuting." | `click` |
| 19 | `#tp-play` | Mainkan | "Play buat mulai, geser Speed kalau kecepetan. Tutup dengan tombol ✕ di pojok." | tanpa gate |
| 20 | `#tp-close` | Tutup teleprompter | "Nanti kita buka lagi dari tahap syuting." | `click` |
| 21 | `#f-cta` | Ajakan bertindak | "Penonton diminta ngapain setelah nonton? Follow, DM, klik link. Isi singkat." | `skippable`, tanpa gate |
| 22 | `#download-script-pdf` | Butuh versi cetak? | "Unduh PDF script buat dibawa ke lokasi syuting atau dikirim ke talent." | tanpa gate |
| 23 | `#mark-submitted input` | Ide selesai → syuting | "Kalau naskah sudah beres, centang ini. Kontennya pindah ke tahap **Execution** (syuting) — tampilannya berubah jadi cuma script + satu tombol besar." | `change` (checked) |

### Bab 4 · Syuting → Editing → Upload → Published

Setelah langkah 23, `updateContent(status: "production")` → repaint → `executionPanel`.

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 24 | `.stage-script-display` | Mode syuting | "Di tahap ini kamu cuma butuh script. Ikon teleprompter di kanan atas buat baca sambil rekam." | tanpa gate, `waitTimeout` 6000 |
| 25 | `#stage-back` | Salah pencet? | "Tombol ini balikin konten ke tahap sebelumnya. Aman." | tanpa gate |
| 26 | `#mark-shot-big` | Selesai syuting | "Sudah rekam? Klik. (Buat tur ini boleh langsung klik.)" | `click` |
| 27 | `#mark-edited-big` | Editing selesai | "Tahap Editing cuma satu tombol — klik kalau videonya sudah jadi." | `click` |
| 28 | `#ai-thumb-gen-ready` | Thumbnail pakai AI | "Butuh thumbnail? AI bisa bikinin (perlu provider Gemini). Lewati kalau nggak perlu." | `skippable`, tanpa gate |
| 29 | `#copy-caption-ready` | Salin caption | "Klik buat salin caption ke clipboard, tinggal tempel di Instagram/TikTok." | tanpa gate, `skipIfMissing` |
| 30 | `#uploaded-instagram` (extra `#uploaded-tiktok`) | Sudah di-upload? | "Upload videonya di aplikasi Instagram/TikTok seperti biasa, lalu centang platform yang sudah. Nggak perlu dua-duanya." | `change` (checked), `extraSelectors` |
| 31 | `#mark-uploaded-done` | Done = terbit | "Klik Done. Kontennya otomatis jadi **Published** dengan tanggal hari ini — hilang dari daftar kerja di kiri, karena sudah selesai." | `click` |
| 32 | `.cos-tabs .tab:nth-child(2)` (tab "Konten") | Ke mana perginya? | "Konten yang sudah terbit pindah ke tab **Konten** → Published. Di sana kamu isi angka performanya (views, likes) nanti. Di Kalender juga muncul di tanggal terbitnya." | tanpa gate |

Penutup (langkah 33, selector `#new-content`): "Itu satu siklus penuh: Ide → AI → Syuting → Editing → Upload → Published. Ulangi buat konten berikutnya." Tombol Selesai → `markTourSeen("creator")` → `offerNextTour({ title: "Lanjut ke Kalender?", body: "Sekarang lihat cara jadwalin konten biar konsisten.", ctaLabel: "Buka Kalender", hash: "#/brand/<id>/content-os/calendar", startKey: "calendar" })`.

Catatan penting untuk eksekutor:

- **Konten yang dipakai tur ikut jadi Published sungguhan.** Beri tahu di langkah 26 ("buat tur ini boleh langsung klik") dan di penutup tambahkan: "Konten latihan tadi bisa kamu hapus dari tab Konten kalau nggak dipakai." Alternatif yang lebih bersih: di langkah 1 `beforeStep`, kalau brand belum punya konten, set `sessionStorage["contentos:tour-content-id"]` setelah `db:change` pertama, lalu di penutup tawarkan tombol "Hapus konten latihan" (`deleteContent(id)`). Pilih alternatif ini kalau waktu cukup.
- Creator me-render ulang seluruh `root` pada tiap `db:change` (autosave on blur). Engine sudah `waitForSelector` ulang tiap langkah, jadi aman; tapi **jangan** simpan referensi elemen lintas langkah.
- Di layar sempit (`@media max-width` 838 → `creator-layout` jadi 1 kolom) sidebar ada di atas; `scrollIntoView` sudah dipanggil engine.
- Selector `#open-teleprompter` ada dua kali (drafting dan execution) tapi tidak pernah bersamaan di DOM. Aman.

## 4. Tur B — Kalender (`js/guides/calendar-guide.js`, baru)

Entry: `js/views/calendar.js` `paint()` setelah `wireHelpButtons(root)`. Tambah `sectionGuideButtonHTML("calendar")` di `page-head` dan autoplay Guided sekali, atau paksa mulai kalau `consumePendingTour("calendar")` true.

Prasyarat: minimal 1 konten tanpa tanggal supaya Bank Konten tidak kosong. `beforeStep` langkah 1: kalau `listContent(brandId).filter(c => !c.scheduleDate && c.status !== "published").length === 0`, tampilkan langkah alternatif "Bank kosong — bikin satu konten dulu" yang spotlight `#new-content` (`click`) lalu drawer `#f-title` + `[data-save]` (seperti Bab 1 Tur A), baru lanjut.

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 1 | `.cal-grid` | Ini kalender kontenmu | "Tiap kotak = satu hari. Warna kecil di kiri judul = tujuan konten (kenal/percaya/beli). Hari libur nasional sudah ditandai." | tanpa gate |
| 2 | `#toggle-bank` | Buka Bank Konten | "Semua konten yang **belum punya tanggal** ngumpul di sini, dikelompokkan per tahap (Drafting, Syuting, Editing, Siap Upload). Klik." | `click` |
| 3 | `.bank-item` | Seret ke tanggal | "Tahan salah satu kartu ini, seret ke hari yang kamu mau, lepas. Selesai — kontennya terjadwal. (Di HP: klik tanggalnya langsung, lihat langkah berikut.)" | `until`: ada konten yang tadi tanpa tanggal sekarang punya `scheduleDate` (bandingkan set id sebelum/sesudah lewat `db:change`), `skippable` |
| 4 | `.cal-cell:not(.outside)` (pilih sel tanggal hari ini `.cal-cell.today`) | Cara kedua: klik tanggal | "Klik kotak tanggal kosong → muncul daftar Bank Konten → pilih satu. Nggak perlu drag. Cocok di HP." | `click` → menu `.date-bank-menu` muncul |
| 5 | `.date-bank-menu` | Pilih dari daftar | "Klik salah satu buat langsung dijadwalkan di tanggal itu, atau **Konten baru** di bawah." | `skippable`, tanpa gate (klik di luar menutup menu) |
| 6 | `.cal-item` | Pindah tanggal juga bisa | "Konten yang sudah di kalender bisa diseret ke hari lain. Klik kartunya buat edit atau cabut dari kalender." | `skipIfMissing`, tanpa gate |
| 7 | `#edit-cadence` | Jadwal Kerja = otak penjadwalan | "Ini hari syuting, hari edit, hari upload, dan maksimal berapa konten per hari. **Sistem dan AI baca jadwal ini** — bukan buat pajangan. Klik buat lihat." | `click` |
| 8 | `#cadence-upload-chips` (modal Jadwal Kerja; chip hari: `#cadence-shoot-chips`, `#cadence-edit-chips`, `#cadence-upload-chips`; batas per hari `#cadence-per-day` — semua sudah dicek di `js/cadence-setup.js`) | Atur sekali, dipakai di mana-mana | "Pilih hari-harinya. Ini otomatis ngisi My Routine (pengingat harian di halaman Brands) dan jadi aturan buat AI Auto-Schedule." | tanpa gate |
| 9 | `#cadence-save` (extra `#cadence-skip`) | Simpan | "Simpan kalau sudah pas." | `click` |
| 10 | `#ai-autoschedule` | Jadwal Otomatis AI | "Males nyusun satu-satu? AI ini baca **campaign aktif dan urgensinya**, **tahap tiap konten** (yang sudah syuting/edit didahulukan), **Jadwal Kerja** kamu, dan aturan nggak numpuk tujuan yang sama sehari. Klik." | `click`; `showIf: hasAiKey`; `skippable` |
| 11 | `.auto-schedule-list` (modal "Tinjau Jadwal AI") | Tinjau dulu, belum tersimpan | "Ini usulan, bukan keputusan. Tanggal tiap baris bisa kamu ubah dulu." | `until: () => qs(".auto-schedule-list")`, `waitTimeout` besar, `skippable` |
| 12 | `#auto-schedule-confirm` | Konfirmasi | "Klik buat masukin semua ke kalender. Masih bisa diseret-seret setelahnya." | `click` |
| 13 | `#export-gcal` | Ekspor ke Google Calendar | "Unduh file .ics, lalu impor ke Google Calendar (atau Apple/Outlook). Jadwal kontenmu muncul di HP bareng jadwal lain." | tanpa gate (jangan gate: memicu download) |
| 14 | `[data-view="week"]` | Tampilan Minggu | "Klik buat lihat minggu ini saja sebagai daftar." | `click` |
| 15 | `[data-view="day"]` | Tampilan Hari | "Fokus satu hari. Cocok buat cek 'hari ini ngapain'." | `click` |
| 16 | `#cal-today` (extra `#cal-prev`, `#cal-next`) | Navigasi | "Panah buat maju/mundur, **Hari Ini** buat balik." | tanpa gate |
| 17 | `[data-view="month"]` | Balik ke Bulan | "Klik Bulan lagi." | `click` |
| 18 | `.cal-timeline` | Garis campaign | "Kalau campaign punya tanggal mulai–selesai, muncul garis di atas kalender biar kelihatan konten mana yang jatuh di masa campaign." | `skipIfMissing`, tanpa gate |
| 19 | `#new-content` | Konten baru dari sini | "Nggak harus lewat Creator — bikin konten langsung dari kalender, isi tanggalnya sekalian." | tanpa gate |

Penutup: "Rutinitasnya: bikin di Creator → taruh di Kalender (atau biar AI) → kerjain sesuai hari kerja." Kalau brand belum punya campaign atau tur campaign belum pernah dilihat → `offerNextTour` ke `#/brand/<id>/campaigns` dengan `startKey: "campaigns"`.

Catatan eksekutor:

- Drag-and-drop HTML5 tidak jalan di touch. Langkah 3 wajib `skippable` dan langkah 4 wajib ada.
- Ekspor `.ics` memicu `a.click()` download; jangan gate `click` supaya tidak memaksa download saat tur.
- `paint()` kalender me-render ulang seluruh root tiap `db:change` dan tiap ganti view — engine akan `waitForSelector` ulang. Aman.
- Langkah 3 `until` predicate: simpan `const before = new Set(unscheduledIds)` di `beforeStep`, predicate = `[...before].some(id => getContent(id)?.scheduleDate)`.

## 5. Tur C — Campaign (`js/guides/campaign-guide.js`, baru)

Entry: `js/views/campaigns.js` `paintList()` (ganti `TOUR_STEPS` lama) dan `paintDetail()`. Karena list dan detail adalah route berbeda (`/campaigns` vs `/campaigns/:id`), tur ini **dua bagian**: C1 di list (bikin campaign) yang di akhir mengarahkan ke detail, dan C2 di detail (mengerjakan level), otomatis lanjut lewat `consumePendingTour("campaign-detail")`.

### C1 · Bikin campaign (halaman list)

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 1 | `#new-campaign` | Campaign = tujuan besar | "Contoh: naikin followers Instagram. Campaign dipecah jadi level kecil biar jelas minggu ini harus ngapain. Klik Campaign Baru." | `click`; kalau sudah ada campaign, `showIf` → ganti dengan langkah "klik campaign yang ada" (`[data-open-campaign]`, `clickAny`) lalu langsung C2 |
| 2 | `[data-quick-template]` | Pilih tujuan | "Template siap pakai: Grow Social Media, Personal Branding, Event. Pilih yang paling dekat sama tujuanmu." (Pro: sebut juga `#open-custom-flow` untuk campaign custom dari satu kalimat tujuan) | `clickAny` |
| 3 | `#terms-scroll` | Aturan main | "Baca sampai bawah — ini komitmen cara kerja level-levelnya (angka kumulatif, kualitas harus tetap sehat, nggak bisa loncat level)." | `until: () => !qs("#terms-agree").disabled`, `skippable` |
| 4 | `#terms-agree` | Setuju | "Centang." | `change` |
| 5 | `#terms-continue` | Lanjut | | `click` |
| 6 | `#calib-fresh` (extra `#calib-pick-open`) | Mulai dari Level 1 | "Baru pertama kali? Klik **Belum, mulai dari Mission 1**. Kalau sudah pernah ngejar followers sebelumnya, boleh pilih level." | `click` |
| 7 | `.overlay.center input.input` (satu-satunya input di `promptDialog`) | Kasih nama | "Misalnya 'Naikin Followers IG 2026'." | `input` minLength 3 |
| 8 | `.overlay.center [data-confirm]` | Buat | "Klik. Campaign-nya jadi, langsung ke halaman detailnya." | `click` |

Setelah `createCampaign`, kode existing pindah ke `#/brand/<id>/campaigns/<campaignId>` → tur C1 mati (hashchange). Sebelum itu, `beforeStep` langkah 8 set `sessionStorage["contentos:start-tour"] = "campaign-detail"`.

Cabang **Event** (`data-quick-template="event"`): setelah langkah 2 muncul modal peran/skala (`#ef-objectives`, `#ef-submit`). Sederhanakan: langkah 3–6 diganti "Isi data event-nya, lalu Lanjut" (`#ef-submit`, `click`). Cabang **Custom** (Pro): `#intake-goal` (`input`), `#intake-objective`, tombol generate (cek id), lalu modal `#c-name` … `[data-save]`. Tulis cabangnya tapi prioritas rendah.

### C2 · Kerjakan level (halaman detail, campaign dengan `missions`)

| # | Selector | Judul | Isi | Gate |
|---|---|---|---|---|
| 1 | `.guided-next-card` (Guided) / `.mission-panel-head` (Pro) | Posisi kamu sekarang | "Kamu di Level 1. Tiap level punya beberapa angka yang harus dicatat; konten yang kamu bikin di Content OS dihitung otomatis." | tanpa gate |
| 2 | `.mission-ladder` (kontainer; badge per level `.mission-badge`) | Tangga level | "5 level. Yang gelap belum kebuka — boleh diintip, tapi progresnya baru bisa dicatat kalau gilirannya sampai." | tanpa gate |
| 3 | `.mission-tree` (kontainer, sudah dicek) — node-nya `.mission-node` | Pohon milestone | "Tiap cabang = satu milestone. Nomornya sama dengan daftar di bawah. Cabang terisi = sudah tercapai." | tanpa gate |
| 4 | `#mission-milestones .mission-milestone-row:nth-child(1)` | Milestone otomatis vs manual | "Yang ada tulisan **'Terisi otomatis'** dihitung sistem (konten terbit, minggu aktif, Shares/Saves dari data performa). Yang ada kotak angka harus kamu isi dari Insights akunmu." | tanpa gate |
| 5 | `[data-milestone-number]` (pertama) | Isi angka asli | "Ketik angka apa adanya — nggak harus sudah kena target. Yang penting jujur dicatat. Tekan Enter." | `input` minLength 1, `skippable` |
| 6 | `[data-milestone-sync]` (pertama) | Tombol hitung | "Klik buat ambil angkanya dari data yang sudah ada di sistem." | `skipIfMissing`, `skippable`, tanpa gate |
| 7 | `#brainstorm-content` | Bingung mau bikin konten apa? | "Klik. AI kasih ide konten yang cocok buat level ini." | `click` |
| 8 | `#brainstorm-ai` | Minta AI | "Klik **Minta AI kasih ide**." | `click`, `showIf: hasAiKey`, `skippable` |
| 9 | `[data-use-brainstorm-idea]` | Simpan ide | "Pilih satu yang kamu suka → **Simpan sebagai Ide**. Langsung masuk ke Creator Studio, sudah terkait ke campaign ini." | `until: () => qs("[data-use-brainstorm-idea]")` lalu `clickAny`, `skippable` |
| 10 | `#brainstorm-done` | Selesai | "Klik Selesai. Kalau ada ide tersimpan, kamu dibawa ke Creator buat mulai nulis." | `click` |

Kalau langkah 10 memicu pindah ke Creator (ada ide tersimpan), tur C2 mati — itu **memang alur yang diinginkan**. Set `sessionStorage["contentos:start-tour"] = "creator"` di `beforeStep` langkah 10 hanya jika `tourSeen("creator")` false, supaya user yang mulai dari Campaign tetap dapat tur Creator.

Kalau tidak pindah (tidak ada ide disimpan), lanjut:

| 11 | `#mission-advance` | Naik level | "Tombol ini nyala kalau semua milestone sudah **dicatat** (bukan harus tercapai). Klik → Level 2 kebuka, angka Followers dibawa otomatis." | tanpa gate (jangan paksa naik level saat tur) |
| 12 | `.guided-rules` / `.hint` aturan (Pro) | Aturan main | "Campaign ini tanpa batas waktu; semua konten brand kehitung; angka kumulatif." | `skipIfMissing`, tanpa gate |
| 13 | `#edit-campaign` | Ubah campaign | "Nama, tanggal, pesan utama diubah di sini." | tanpa gate |

Penutup: "Ritmenya: cek level → Brainstorm → tulis di Creator → jadwalkan di Kalender → terbit → update angka milestone tiap minggu." `markTourSeen("campaigns")`.

Campaign **phase-based** (Custom, tanpa `missions`) dan **Event** (`eventPlan`) pakai C2 versi pendek: `.journey-track` ("fase perjalanan"), `[data-phase-node]` (`clickAny`), `#phase-ai-suggest`, `#phase-add-content`; Event: `#event-milestones`, `#event-add-milestone`. Tulis sebagai `buildPhaseSteps()` dan `buildEventSteps()` di file yang sama.

## 6. Titik masuk & urutan tur

1. **Beranda Pemula** (`js/views/beginner-home.js`): checklist 5 langkah dari plan B (kalau sudah ada) — langkah "Terbitkan konten pertama" mengarah ke Creator dengan `startKey: "creator"`. Kalau checklist belum ada, cukup tombol "Mulai panduan Content OS" di kartu Content OS.
2. **Content OS hub** (`js/views/content-os.js`): `TOUR_STEPS` lama dipangkas jadi 1 langkah (tab bar, tanpa gate) + tombol "Panduan" tetap. Autoplay pertama kali Guided: hub → langsung `location.hash` ke Creator dengan `startKey: "creator"` kalau `tourSeen("creator")` false.
3. **Creator**: autoplay sekali (Guided) atau `consumePendingTour("creator")`.
4. **Kalender**: `consumePendingTour("calendar")` atau autoplay sekali (Guided).
5. **Campaign list/detail**: `consumePendingTour("campaigns" | "campaign-detail")` atau autoplay sekali (Guided).
6. **Pengaturan → Akun** (`js/views/settings.js` ±baris 460): tambah tiga tombol "Ulangi panduan Creator / Kalender / Campaign" (navigasi + `startKey`).
7. Tombol **Panduan** (`sectionGuideButtonHTML`) di header Creator, Kalender, Campaign list, Campaign detail — selalu tampil, dua mode.

Urutan default yang ditawarkan: **Creator → Kalender → Campaign**. Alasan: user melihat hasil nyata (satu konten terbit) sebelum diminta mengerti konsep level. Kalau user masuk dari Campaign duluan, rantainya Campaign → Creator → Kalender (langkah 10 C2 sudah menangani).

## 7. Gaya copy

- Bahasa Indonesia santai, "kamu", tanpa jargon tanpa penjelasan (TOFU selalu dijelaskan "bikin orang kenal", dst).
- Judul ≤ 5 kata. Isi ≤ 2 kalimat, maksimal 3 baris di tooltip 320 px. Kata yang harus diklik ditulis **tebal** (engine sekarang pakai `textContent`; ubah ke `innerHTML` dengan `escapeHtml` lalu ganti `**x**` → `<b>x</b>`, atau terima `bodyHTML`).
- Setiap langkah bergate menyebut aksinya secara eksplisit di kalimat terakhir ("Klik …", "Centang …", "Seret …").
- Angka Step: "Bab 2 · Langkah 3 dari 9".

## 8. Kasus tepi yang wajib ditangani

| Kasus | Penanganan |
|---|---|
| Tidak ada AI key (`hasAiKey` false) | Semua langkah AI `showIf` → diganti satu langkah penjelasan + arahan ke Pengaturan → AI. Tur tetap selesai. |
| Akun `readonly` (`isReadOnly(getCachedAccount())` dari `js/account.js`) | Tur tetap bisa dibuka tapi langkah bergate write (simpan, centang, drag) jadi `skippable` dengan hint "Akun kamu mode baca saja". |
| Brand tanpa campaign | Langkah 5 Tur A dan langkah 18 Tur B dilewati (`showIf`/`skipIfMissing`). Penutup Tur B menawarkan Tur C. |
| Layar HP (≤ 720 px) | Drag tidak tersedia → langkah 4–5 Tur B jadi jalur utama. Tooltip engine sudah clamp ke viewport. FAB Consultant bisa menutupi tombol besar → di `runSpotlightTour` tambahkan class `tour-active` ke `body` dan CSS `body.tour-active .consultant-fab{display:none}`. |
| AI lambat / gagal | `until` tanpa timeout + `skippable`. Kalau `toast` error muncul, user klik Lewati. |
| User refresh di tengah tur | Tur mati; tombol Panduan selalu ada. (Opsional §2.3 resume.) |
| Tur onboarding besar sedang jalan | `runSpotlightTour` sudah menolak tur kedua; `maybeShowSectionTour` tidak menandai seen. Tidak berubah. |
| Selector ganda (`#f-title` di drawer vs Creator) | Pakai prefix kontainer drawer (lihat catatan Bab 1). Verifikasi nama class drawer di `js/modals.js`. |
| Repaint saat `db:change` menghapus elemen yang sedang di-spotlight | Engine sudah polling ulang target tiap langkah; tambahkan `MutationObserver` ringan atau `resizeHandler` juga dipanggil saat `db:change` supaya ring mengikuti elemen yang baru dirender (elemen lama hilang → `qs` ambil yang baru). |

## 9. File yang disentuh (urutan pengerjaan)

1. `js/tour.js` — gate `change`/`until`/`clickAny`, opsi `skippable`/`showIf`/`chapter`/`hint`/`waitTimeout`, label Indonesia, `onFinish(reason)`, `body.tour-active`, reposition on `db:change`.
2. `css/styles.css` — `.tour-chapter`, `[data-tour-skip-step]`, `body.tour-active .consultant-fab{display:none}`, tooltip `max-width` di HP.
3. `js/guides/common.js` — `offerNextTour`, `consumePendingTour`, `tourSeen/markTourSeen`.
4. `js/guides/creator-guide.js` — `buildCreatorSteps({ brandId })` + `startCreatorGuide(root, brandId)`.
5. `js/views/creator.js` — tombol Panduan di header, `data-tour` attributes bila selector rapuh (mis. `data-tour="mark-submitted"` pada label checkbox), panggil guide di akhir `paint()` **sekali per mount** (jangan tiap repaint — pakai flag di `render()` closure).
6. `js/guides/calendar-guide.js` + `js/views/calendar.js` (tombol Panduan, panggil sekali per mount).
7. `js/guides/campaign-guide.js` + `js/views/campaigns.js` (ganti `TOUR_STEPS`, panggil di `paintList` dan `paintDetail` sekali per mount).
8. `js/views/content-os.js` — pangkas `TOUR_STEPS`, redirect autoplay pertama ke Creator.
9. `js/views/settings.js` — tiga tombol ulangi panduan.
10. `js/views/beginner-home.js` — tautan "Mulai panduan" (atau lewat checklist plan B).
11. `js/i18n.js` — hanya kalau copy tur mau dua bahasa; kalau tidak, hardcode Indonesia seperti tur onboarding sekarang.

Semua file baru harus lolos `node --check`. Tidak ada build step.

## 10. Kriteria selesai (dicek manual di `http://localhost:8743`, akun uji `fable-review@wepeka.com`)

- [ ] Brand kosong, mode Guided: buka Content OS → otomatis ke Creator → tur A jalan dari "Konten Baru" sampai konten jadi Published, semua gate merespons aksi asli.
- [ ] Setiap langkah AI bisa dilewati; tanpa AI key tur tetap selesai.
- [ ] Penutup tur A menawarkan Kalender; klik → tur B mulai otomatis di Kalender.
- [ ] Tur B: drag ke tanggal memajukan langkah; klik tanggal juga; Jadwal Kerja terbuka dan tersimpan; Auto-Schedule menampilkan modal tinjau dan konfirmasi menulis `scheduleDate`; Minggu/Hari/Bulan berganti; ekspor tidak dipaksa.
- [ ] Tur C1: dari "Campaign Baru" sampai campaign dibuat, lanjut otomatis ke C2 di halaman detail; Brainstorm → simpan ide → pindah ke Creator.
- [ ] Tombol "Panduan" di Creator, Kalender, Campaign (list & detail) memutar ulang tur di kedua mode.
- [ ] Pengaturan → Akun punya tiga tombol ulangi panduan.
- [ ] Tidak ada error console; tur mati bersih saat pindah route (`hashchange`) dan saat Esc.
- [ ] Di viewport 375 px: tooltip tidak keluar layar, FAB tersembunyi saat tur, jalur "klik tanggal" jalan.
- [ ] Konten latihan bisa dihapus dari penutup tur A (kalau opsi itu diambil).

## 11. Di luar cakupan plan ini

- Video tutorial (kartu "sedang direkam" di Brands tetap).
- Tur untuk tab Dashboard/Konten (cukup help "?").
- Tur Brand Builder (sudah ada section guide sendiri).
- Rename Guided/Advanced → Pemula/Pro dan checklist Beranda (plan B di `next-session-prompt.md`) — kalau plan B dikerjakan duluan, sesuaikan label mode di copy tur.
