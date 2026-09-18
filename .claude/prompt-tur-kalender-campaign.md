Baca `.claude/next-session-prompt.md` (konteks repo) lalu `.claude/plan-guided-tour-content-os.md` (plan lengkap). Tugasmu: **eksekusi §4 (Tur Kalender) dan §5 (Tur Campaign)** dari plan itu, di repo Brandlab ini (`/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA`, branch `feature/brand-guidelines-premium-redesign`).

## Sebelum mulai

1. Cek apakah §2 (perluasan engine `js/tour.js`) dan `js/guides/common.js` sudah ada: cari `clickAny`, `until`, `skippable`, `showIf`, `offerNextTour`, `consumePendingTour`. 
   - Kalau **sudah ada**: pakai apa adanya, jangan ubah API-nya. Baca `js/guides/creator-guide.js` (kalau ada) dan ikuti polanya persis.
   - Kalau **belum ada**: kerjakan §2 dulu sesuai plan (gate `change`/`until`/`clickAny`, opsi `skippable`/`showIf`/`chapter`/`hint`/`waitTimeout`, label Indonesia, `onFinish(reason)`, `body.tour-active`), lalu `js/guides/common.js`. Tur onboarding lama (`startOnboardingTour`) harus tetap jalan tanpa perubahan perilaku.
2. Baca file yang akan disentuh sebelum mengedit: `js/views/calendar.js`, `js/views/campaigns.js`, `js/cadence-setup.js`, `js/modals.js`, `js/section-guide.js`, `js/tour.js`, `css/styles.css` (blok `.tour-*` ±baris 950).

## Yang dikerjakan

**§4 Tur Kalender** → file baru `js/guides/calendar-guide.js`, dipanggil dari `js/views/calendar.js`:
- 19 langkah persis seperti tabel §4 (selector, judul, isi, gate). Jangan ubah copy kecuali ada selector yang ternyata tidak ada; kalau begitu, cari yang benar di kode dan catat di laporan akhir.
- Prasyarat "bank kosong → bikin satu konten dulu" (lihat paragraf Prasyarat §4).
- Langkah drag (3) pakai gate `until` dengan predicate set-id sebelum/sesudah (catatan eksekutor §4), wajib `skippable`. Langkah 4–5 jalur klik tanggal untuk HP.
- Ekspor (13) **tanpa** gate klik.
- Tombol Panduan (`sectionGuideButtonHTML("calendar")`) di `page-head`, autoplay sekali di Guided (`maybeShowSectionTour`) atau paksa mulai kalau `consumePendingTour("calendar")` true. Panggil **sekali per mount** (flag di closure `render()`), bukan tiap `paint()`.
- Penutup: kalau belum ada campaign atau tur campaign belum pernah dilihat → `offerNextTour` ke `#/brand/<id>/campaigns` dengan `startKey: "campaigns"`.

**§5 Tur Campaign** → file baru `js/guides/campaign-guide.js`, dipanggil dari `js/views/campaigns.js`:
- C1 (list, 8 langkah) dan C2 (detail, 13 langkah) persis tabel §5. Ganti `TOUR_STEPS` lama di `campaigns.js`.
- C1 langkah 8 `beforeStep`: set `sessionStorage["contentos:start-tour"] = "campaign-detail"` sebelum campaign dibuat, supaya C2 mulai otomatis di halaman detail lewat `consumePendingTour("campaign-detail")`.
- C2 langkah 10: set `start-tour = "creator"` hanya kalau `tourSeen("creator")` false.
- Cabang Event dan Custom: tulis `buildEventSteps()`/`buildPhaseSteps()` versi pendek seperti disebut di §5 (prioritas rendah, boleh minimal tapi harus ada dan tidak error).
- Tombol Panduan di list **dan** detail; autoplay sekali di Guided; panggil sekali per mount.

**§6 poin 6 & 9 (kecil):** di `js/views/settings.js` dekat tombol "Take the Tour" tambah dua tombol "Ulangi panduan Kalender" dan "Ulangi panduan Campaign" (navigasi + `startKey`). Tombol Creator ditambah oleh yang mengerjakan §3, jangan dibuat kalau tur Creator belum ada.

## Aturan

- Jangan commit, push, merge, atau deploy. Jangan sentuh repo wpk-dp. Jangan pernah echo isi private key/API key.
- Jangan ubah alur bisnis kalender/campaign; tur hanya menempel di UI yang sudah ada. Boleh menambah atribut `data-tour="..."` kalau selector rapuh.
- Semua copy Bahasa Indonesia santai ("kamu", "bikin"), kata yang harus diklik ditebalkan sesuai §7.
- Setiap file yang diubah lolos `node --check`. Tidak ada build step.
- Uji di browser bawaan: server `python3 serve.py` → `http://localhost:8743` (kalau port 8743 sudah listen, jangan jalankan lagi). Akun uji `fable-review@wepeka.com` (brand "Kopi Senja"). Kalau pane browser belum login, **jangan mengetik password** — minta user login manual lalu lanjut. Jangan sentuh brand "Pinter Mandarin".
- Cek kriteria §10 yang relevan (Kalender, Campaign, tombol Panduan, Pengaturan, tanpa error console, viewport 375 px). Laporkan apa adanya kalau ada yang belum bisa diuji.

## Di akhir

Tambahkan addendum ke `.claude/next-session-prompt.md`: file yang diubah/dibuat, selector yang terpaksa diganti dari plan, apa yang sudah diuji di UI dan apa yang belum, serta sisa pekerjaan (§3 tur Creator kalau belum ada). Lalu ringkas ke aku dalam bahasa Indonesia.
