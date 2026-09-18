Proyek: Brandlab di `/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA` (branch `feature/brand-guidelines-premium-redesign`). Pindah ke folder ini dulu, jangan kerja di scratch workspace.

Baca berurutan sebelum melakukan apa pun:
1. `.claude/next-session-prompt.md` — konteks repo, aturan, akun uji. Fokus ke addendum paling bawah (tur terpandu §2/§4/§5, perbaikan bug tur, AI dummy, terms "baca dulu", Custom "Segera hadir", placeholder video).
2. `.claude/plan-guided-tour-content-os.md` — plan lengkap tur terpandu.

## Status sekarang (semua uncommitted)

Sudah selesai dan diuji di browser:
- Engine tur `js/tour.js`: gate `click`/`clickAny`/`input`/`change`/`until`, opsi `skippable`, `showIf`, `quiet`, `nextLabel`, `dim`, `video`; label Indonesia; bug "tur membeku saat melompati langkah" sudah diperbaiki.
- `js/guides/common.js`, `js/guides/calendar-guide.js` (tur Kalender), `js/guides/campaign-guide.js` (tur Campaign list + detail, cabang Event).
- Autoplay tur hanya sekali per halaman untuk user yang belum pernah; status disimpan di akun (`settings.guideSeen`). Setelah itu hanya lewat tombol Panduan.
- AI dummy selama tur (`js/tour-demo.js`): Jadwal Otomatis AI, Brainstorm Konten, draf campaign, saran konten fase. Tanpa token.
- Tur di Syarat & Ketentuan hanya minta user membaca, tidak menyuruh centang/klik Lanjut.
- Custom campaign "Segera hadir" di semua mode. Badge "Recommended campaign buat bangun social mediamu" di Grow Social Media.
- Tur onboarding menyorot kartu app besar (bukan tab toolbar) dan minta klik Brand Builder dulu sebelum menunjukkan Brand DNA dan Guidelines.
- Placeholder video (`js/guide-videos.js`): tombol "Video" di sebelah setiap Panduan dan widget video yang bisa ditutup di langkah pertama tur. Semua `src` masih kosong.

## Sisa pekerjaan (tanyakan dulu ke aku mau prioritas yang mana)

1. **§3 Tur Creator Studio** (`js/guides/creator-guide.js`) sesuai plan, termasuk tombol Panduan + Video di header Creator, AI dummy untuk generate hook/script/caption selama tur, tombol "Ulangi panduan Creator" di Pengaturan, dan penutup tur Creator yang menawarkan lanjut ke Kalender.
2. **§6 sisa:** pangkas `TOUR_STEPS` hub `js/views/content-os.js` (tombol Panduan hub masih tampil juga di tab Kalender), redirect autoplay pertama hub ke Creator, tautan "Mulai panduan" di `js/views/beginner-home.js`.
3. **Video asli:** kalau aku sudah kirim link video, isi `src` di `js/guide-videos.js` (mp4/webm atau YouTube/Vimeo).
4. **Hilangkan fetch Instagram untuk user biasa** (aku bilang "nanti"). Titiknya sudah dicatat di addendum: `content-editor.js`, `content-list.js`, `brands.js`, `instagram-import.js`, `dashboard.js`, `campaigns.js igConnected`.
5. **Uji yang belum:** Beranda mode Guided (tombol Video + tur), halaman Brand Builder/Brand DNA/Guidelines, beranda mode Advanced, bikin campaign lewat tur sampai tur detail mulai otomatis (menulis data — pakai akun uji), drag-and-drop dengan mouse asli, viewport 375 px di halaman asli.
6. **Cek temuan terakhir:** pane browser sesi lalu login ke akun tim (brand English House Kediri, Pinter Mandarin, wepeka), bukan akun uji. Di akun itu mode sekarang Advanced dan campaign English House Kediri (`76f9b714-…`) sudah tidak ada. Grep memastikan kode tur tidak menghapus campaign atau mengganti mode. Tanyakan ke aku apakah itu perbuatanku sendiri sebelum menyelidiki.

## Aturan

- Jangan commit, push, merge, atau deploy. Jangan sentuh repo `/Users/wepeka/Documents/wpk-dp`.
- Jangan pernah echo isi API key atau private key.
- Jangan mengetik password di browser; kalau belum login, minta aku login manual. Uji yang menulis data pakai akun uji (lihat file nomor 1), bukan akun tim. Brand "Pinter Mandarin" read-only, jangan diubah.
- Semua file JS yang diubah harus lolos `node --check`. Tidak ada build step. Server lokal: `python3 serve.py` → http://localhost:8743 (cek dulu apakah port sudah listen).
- Setelah mengubah JS, reload penuh tab browser sebelum menguji; pindah hash tidak memuat ulang modul.
- Copy tur Bahasa Indonesia santai ("kamu", "bikin"), kata yang harus diklik ditebalkan.
- Di akhir, tambahkan addendum ke `.claude/next-session-prompt.md` dan ringkas hasilnya ke aku dalam bahasa Indonesia.
