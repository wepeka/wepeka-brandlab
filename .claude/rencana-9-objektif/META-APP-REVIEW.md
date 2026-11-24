# Brandlab × Meta: setup, env, dan App Review

Tanggal: 24 November 2026
Kode: branch lokal `meta-connect-1124` (di atas `brandlab-9-objektif-1124` 8451551). **Belum di-push, belum dideploy.**
App Meta: **wepeka** `1996512847700669` (Business, Published, Tech Provider). Instagram app ID (Instagram Login): `2167626837971435`.

Isi dokumen:
1. Yang sudah dibangun (ringkas)
2. Pilihan tipe token dan alasannya
3. Langkah di dashboard Meta (Configuration FBLB, redirect URI, callback)
4. Env Vercel yang kamu isi sendiri
5. Urutan go-live sampai App Review
6. Teks App Review per izin (bahasa Inggris, siap tempel)
7. Naskah screencast per izin (kamu yang merekam)
8. Yang belum bisa dicek dari sini

---

## 1. Yang sudah dibangun

- **Pengaturan → Akun Meta** (`#/settings/meta`): satu kartu per brand yang boleh kamu atur. Dua tombol:
  - **Hubungkan lewat Facebook** (utama, Facebook Login for Business): Instagram profesional + Halaman Facebook + akun iklan dalam satu login. Setelah login, muncul jendela **Pilih akun untuk {brand}**. Pilihannya eksplisit: Instagram, Halaman, dan akun iklan, masing-masing bisa "Tidak pakai".
  - **Pakai Instagram saja** (Instagram Login): untuk akun IG tanpa Halaman. Langsung tersambung, tanpa jendela pilih.
  - Brand berikutnya bisa memakai login Facebook yang sama ("Pakai login Meta yang sudah ada?") tanpa login lagi.
  - Kartu yang sudah tersambung menampilkan akun, ringkasan angka (pengikut dan jangkauan), waktu sinkron terakhir, serta tombol **Sinkron sekarang**, **Ganti akun**, dan **Putuskan**.
- **Brankas token di server** (porting dari `feature/instagram-auto-sync` 1e9f5da + c3db5b2, tidak di-merge mentah):
  - Token dienkripsi AES-256-GCM dengan `IG_TOKEN_KEY`, disimpan di koleksi `metaGrants`, `metaConnections`, `metaOauthStates`, dan `metaDeletions` yang tertutup untuk semua client.
  - Dokumen brand hanya berisi nama dan ID (`brand.instagram`, `brand.facebook`, `brand.ads`).
  - Token lama yang kamu tempel di form brand tetap dipakai posting akun Wepeka sampai brand itu dihubungkan dengan cara baru. Setelah itu token lama dihapus otomatis.
- **Satu endpoint `/api/instagram/<action>`**: connect, callback, assets, select, disconnect, sync, graph (proxy baca saja), cron, deauthorize, data-deletion, deletion-status. `post.js` dan `webhook.js` yang sudah ada tetap fungsi terpisah.
- **Cron malam** `/api/instagram/cron` jam 03.00 WIB (20:00 UTC). Isinya:
  - refresh token Instagram Login;
  - angka konten bulan ini, plus postingan baru sejak tersambung (otomatis jadi kartu, atau ditautkan ke kartu dengan caption yang sama);
  - pengikut dan jangkauan Instagram serta Halaman;
  - angka video Facebook yang diposting dari Brandlab;
  - **biaya iklan per konten ke Sales**: pengeluaran "Iklan" dengan sumber otomatis, plus "Dilaporkan Meta: N pembelian · Rp X" yang tidak dijumlahkan ke penjualan. Hanya akun iklan dalam Rupiah.
- **Posting untuk semua user** (bukan hanya admin):
  - Siapa yang boleh: pemilik, Admin, dan Editor & Sosmed (izin **Posting**).
  - Di Creator → langkah Upload: **Jadwalkan ke Instagram**, **Posting sekarang**, dan **Bagikan juga ke Facebook**.
  - Cut yang dipakai adalah cut yang disetujui (atau cut terbaru untuk brand tanpa tim), diambil dari Google Drive pemilik. Akun Wepeka tetap memakai folder Mac seperti sebelumnya.
- **Izin per peran** (§2.1, sama di app dan server):

  | Aksi | Siapa |
  |---|---|
  | Hubungkan, pilih akun, putuskan | Pemilik, atau anggota dengan My Brand **edit** + **Posting** (peran Admin) |
  | Sinkron sekarang | Izin Posting atau Create edit |
  | Baca lewat proxy (impor postingan, feed Antrean) | Semua anggota yang aksesnya aktif |
  | Posting | Izin Posting |
  | Biaya iklan | Hanya yang punya akses Sales (disimpan di `sales`, bukan di dokumen brand) |

- **Masih dikunci sampai App Review lolos.** Saat ini hanya admin dan akun dengan `metaBeta: true` (atau `instagramBeta: true`) di `accounts/{uid}` yang bisa membukanya. Untuk membuka ke semua: `META_FOR_EVERYONE = true` di `js/account.js` + env `META_OPEN=1`.
- **Tes:** 32 tes baru (`tests/meta-connect.test.mjs`). Suite 1420/1422. Yang gagal hanya 2 tes lama: "Beranda Pro" (sudah gagal sebelumnya) dan `data-layer`, yang lulus 39/39 bila dijalankan di folder tanpa spasi. Build lulus.
- **Harness lokal:** router asli + Meta palsu. Jalur Facebook, jalur Instagram, pilih akun, pakai login lagi, sinkron, impor, posting dari Drive, Sales, dan Putuskan sudah dicoba di laptop dan HP 390 px.

## 2. Tipe token: business integration system user (BISU)

Sumber: developers.facebook.com/docs/facebook-login/facebook-login-for-business ("Supported access tokens"), dibaca 24 Nov 2026.

- Menurut Meta, **user access token** dipakai "if your app takes actions in real time, based on input from the user". Token ini berumur pendek, dan sekitar 60 hari setelah ditukar.
- Menurut Meta, **BISU token** dipakai "if your app performs programmatic, automated actions on your business clients' assets without having to rely on input from an app user, or require re-authentication at a future date". Token ini khusus Tech Provider, defaultnya tidak kedaluwarsa, dan klien memilih aset persis (Page, IG, ad account) di jendela Meta.

**Pilihan: BISU** ("System-user access token", masa berlaku **Never**). Alasannya:
1. Brandlab bekerja tanpa user di depan layar: posting terjadwal dijalankan cron per menit, sinkron jalan tiap malam. Ini persis kasus BISU. Dengan user token, posting terjadwal dan sinkron akan mati diam-diam setelah 60 hari kalau user tidak login ulang.
2. Wepeka sudah Tech Provider. BISU memang khusus Tech Provider, dan Meta merekomendasikannya untuk aplikasi yang melayani bisnis klien.
3. Aksesnya didelegasikan eksplisit per aset, jadi lebih sempit daripada user token yang mewarisi semua akses orangnya. Klien bisa mencabutnya sendiri di Business Settings → Integrations → Connected apps.
4. "Instagram API with Unified Login" (FBLB + BISU, ditandai "recommended for new integrations") bahkan tidak butuh Page. Sementara itu Meta melabeli "API setup with Instagram login" sebagai LEGACY.

**Konsekuensinya:** klien harus punya (atau membuat) **business portfolio**. Untuk yang tidak mau, ada tombol **Pakai Instagram saja**.

**Cadangan:** kodenya juga menerima configuration bertipe user token. Server membedakan keduanya lewat `/me?fields=client_business_id`. Kalau user token, server menukarnya ke token 60 hari. Kerja Instagram dan Halaman tetap memakai Page token (tidak kedaluwarsa), sementara iklan berhenti setelah 60 hari dan kartu meminta "Hubungkan lagi".

## 3. Langkah di dashboard Meta

Nama menu di dashboard bisa sedikit berbeda dari yang ditulis di sini. Yang penting isiannya.

### 3a. Tambahkan izin yang belum ada di use case
Di app 1996512847700669 → **Use cases**:
- Use case Facebook Login for Business / Pages: pastikan `pages_manage_posts` dan `read_insights` ada. Menurut rencana keduanya belum ada di draf.
- Hapus dari draf App Review semua yang tidak ada di daftar §6 (Threads, katalog, branded content, Human Agent, Public Content Access, `ads_management`, izin pesan/komentar).

### 3b. Buat Configuration (halaman business-login/configurations masih kosong)
**Facebook Login for Business → Configurations → Create configuration**:
1. **Name:** `Brandlab – Hubungkan akun Meta`
2. **Login variation:** General
3. **Access token:** **System-user access token**, **Token expiration: Never**
4. **Assets:** Pages, Instagram accounts, Ad accounts
5. **Permissions** (9, tidak lebih): `instagram_basic`, `instagram_manage_insights`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`, `pages_manage_posts`, `read_insights`, `ads_read`
6. **Create**, lalu salin **Configuration ID** ke env `META_LOGIN_CONFIG_ID`.

### 3c. Redirect URI dan callback
Satu redirect untuk kedua jalur:

| Di mana | Isi |
|---|---|
| Facebook Login for Business → **Settings** → Valid OAuth Redirect URIs | `https://brandlab.wepeka.com/api/instagram/callback` |
| (di halaman yang sama) Client OAuth login **On**, Web OAuth login **On**, Enforce HTTPS **On**, Use Strict Mode **On**, Login with JavaScript SDK **Off** | |
| Facebook Login for Business → Settings → **Deauthorize callback URL** | `https://brandlab.wepeka.com/api/instagram/deauthorize` |
| App settings → Basic → **Data deletion callback URL** (sudah diisi 29 Okt, cek saja) | `https://brandlab.wepeka.com/api/instagram/data-deletion` |
| Instagram → API setup with Instagram login → Business login settings: redirect, deauthorize, data deletion (**sudah diisi 29 Okt**) | sama dengan tiga URL di atas |

Kalau mau mencoba di preview Vercel: tambahkan `https://<preview>.vercel.app/api/instagram/callback` ke kedua daftar redirect, lalu set `META_REDIRECT_URI` di env Preview. Lebih sederhana mencoba langsung di brandlab.wepeka.com dengan akunmu (fitur masih terkunci untuk user lain).

## 4. Env Vercel (project content-os, Production). Kamu isi sendiri.

| Nama | Isi | Dari mana |
|---|---|---|
| `META_APP_ID` | `1996512847700669` | App settings → Basic |
| `META_APP_SECRET` | (rahasia) | App settings → Basic → App secret → Show |
| `META_LOGIN_CONFIG_ID` | ID dari langkah 3b | Configurations |
| `IG_APP_ID` | `2167626837971435` | Instagram → API setup with Instagram login |
| `IG_APP_SECRET` | (rahasia) | idem → Instagram app secret |
| `IG_TOKEN_KEY` | hasil `openssl rand -base64 32` | buat sendiri di Terminal. **Jangan pernah diganti.** Kalau diganti, semua brand harus menyambung ulang. |
| `CRON_SECRET` | sudah ada | dipakai juga oleh `/api/instagram/cron` |
| `META_OPEN` | **jangan diisi dulu**. Isi `1` setelah App Review lolos. | |
| `META_REDIRECT_URI` | opsional, hanya untuk domain lain | |

Rahasia tidak pernah ditulis di kode, LOG, atau dokumen ini.

## 5. Urutan go-live sampai App Review

1. Kamu cek, lalu bilang "push". Branch `meta-connect-1124` naik (preview dulu kalau mau). Tidak perlu deploy rules karena koleksi baru sudah tertutup secara default. Blok di `firestore.rules` hanya menuliskannya secara eksplisit.
2. Isi env (§4) dan buat Configuration (§3), lalu redeploy supaya env terbaca.
3. Hubungkan brand-mu sendiri lewat **Pengaturan → Akun Meta**. Admin sudah otomatis boleh. Selama Standard Access, hanya akun yang punya peran di app Meta yang bisa login.
4. Untuk reviewer: buat akun Brandlab khusus reviewer (email @wepeka.com), set `metaBeta: true` di `accounts/{uid}`, dan siapkan satu brand contoh dengan satu video yang sudah disetujui di Drive.
5. Rekam screencast (§7), kirim App Review dengan teks §6. Meta kini mereview seluruh app dan pengajuan tidak bisa diedit, jadi pastikan semuanya lengkap dulu.
6. Setelah lolos (Advanced Access), buka untuk semua: `META_FOR_EVERYONE = true` + `META_OPEN=1`. **Di commit yang sama**, tambahkan entri di `api/_updates.js` (Cara pakai + screenshot) sesuai aturan pengumuman. Entri itu sengaja belum dibuat sekarang karena user biasa belum bisa memakai fitur ini.

## 6. Teks App Review per izin (tempel apa adanya)

Pembuka umum (kolom "App description / how the app uses data"):
> Wepeka Brandlab (brandlab.wepeka.com) is a content-planning web app for small businesses and creators in Indonesia. A brand owner connects their Instagram professional account, Facebook Page and Meta ad account once, then plans, schedules and publishes posts from Brandlab and sees each post's performance and ad spend next to their own sales records. Tokens are stored encrypted on our server and never sent to the browser. Users can disconnect at any time in Settings → Meta accounts, and we honour deauthorization and data-deletion callbacks.

**Facebook Login for Business**

- **instagram_basic**
  > We read the connected Instagram professional account's username, profile and media list (id, caption, permalink, timestamp, thumbnail). The username is shown in Settings → Meta accounts so the user can confirm which account is connected, and the media list lets the user import their existing posts into Brandlab's content list and see their profile grid in the Video Queue.
- **instagram_manage_insights**
  > We read insights for the user's own posts (views, reach, saves, shares, reposts, follows, profile visits) and account-level reach and follower count. They are shown on each post in Brandlab's content list, in the Report page, and used for the user's follower goals. A server job refreshes them once a day.
- **instagram_content_publish**
  > When the user presses "Post now" or "Schedule to Instagram" on an approved video in Brandlab's Creator (Upload step), our server creates a media container from the user's own video and publishes it at the time the user chose. Nothing is posted without that explicit action.
- **pages_show_list**
  > After Facebook Login for Business, we list the Facebook Pages the user shared with Brandlab so they can pick which Page belongs to each brand (Settings → Meta accounts → "Pick the accounts").
- **pages_read_engagement**
  > We read the selected Page's name and follower count, and the likes, comments and views of videos the user published to that Page from Brandlab, to show them on the brand's Meta card and on each post's numbers.
- **business_management**
  > Our Facebook Login for Business configuration uses a business integration system user token, so clients grant Brandlab access to the Instagram accounts, Pages and ad accounts owned by their business portfolio. We use this permission only to read which assets the client assigned to Brandlab and show them in the account picker. We do not create, change or delete anything in the client's business portfolio.
- **pages_manage_posts**
  > When the user turns on "Also share to Facebook" before posting, we publish the same approved video (or photos) to the selected Facebook Page right after Instagram, with the caption the user wrote. Only on that explicit action.
- **read_insights**
  > We read the selected Page's 28-day reach and the Page videos' insights, and show them on the brand's Meta card and in the follower/reach numbers Brandlab uses for the user's Facebook goals.
- **ads_read**
  > We read spend, impressions, clicks and Meta-reported purchases for the ads in the ad account the user selected, and match each ad to the Instagram post it promotes. Spend appears in the user's Sales page as an automatic "Ads" expense next to that post, with Meta-reported purchases shown separately (never added to the user's own sales). Only team members the owner gave Sales access can see it. We never create or edit ads.

**Instagram Login** (akun IG tanpa Page)

- **instagram_business_basic**: sama dengan `instagram_basic` di atas. Pakai kalimat yang sama, ganti "Facebook Login for Business" menjadi "Instagram Login".
- **instagram_business_manage_insights**: sama dengan `instagram_manage_insights`.
- **instagram_business_content_publish**: sama dengan `instagram_content_publish`.

Langkah untuk reviewer (kolom "Testing instructions"):
> 1. Go to https://brandlab.wepeka.com and sign in with the test account below.
> 2. Open the ⋮ menu → Settings → "Akun Meta" (Meta accounts).
> 3. On the brand "<nama brand contoh>", click "Hubungkan lewat Facebook" (Connect with Facebook) and finish Facebook Login for Business with your test business, sharing an Instagram professional account, a Page and an ad account.
> 4. In "Pilih akun untuk …" (Pick the accounts), select them and click "Simpan" (Save). Click "Sinkron sekarang" (Sync now) to load numbers.
> 5. Publishing: Create → Creator → the piece "<judul>" → step 5 Upload → tick "Bagikan juga ke Facebook" → "Posting sekarang" (Post now).
> 6. Ad spend: My Brand → Sales → "Konten yang menghasilkan uang".
> 7. Instagram Login: on another brand click "Pakai Instagram saja" (Instagram only).
> Test account: <email> / <password> (we can switch the interface to English: Settings → Language).

## 7. Naskah screencast per izin

Yang merekam kamu sendiri. Aturan Instagram tetap berlaku: Claude tidak mengoperasikan Instagram di browser mana pun.

Tips umum:
- Rekam layar laptop (QuickTime → New Screen Recording). Satu video boleh mencakup beberapa izin, asal tiap izin terlihat jelas.
- Ganti bahasa Brandlab ke **English** dulu (Pengaturan → Bahasa) supaya reviewer paham, atau beri teks keterangan.
- Tunjukkan selalu: (1) login ke Brandlab, (2) jendela izin Meta, (3) fitur yang memakai izin itu, (4) hasilnya di Instagram/Facebook bila izinnya menulis sesuatu.

**Video A: Facebook Login for Business** (sekitar 3–4 menit, mencakup 9 izin)
1. Buka brandlab.wepeka.com, login. Keterangan: *"Signing in to Brandlab."*
2. ⋮ → Settings → **Meta accounts**. Klik **Connect with Facebook** pada brand contoh.
3. Jendela Meta: tunjukkan pilihan business portfolio, Instagram account, Page, dan ad account, lalu daftar izin. *(business_management, pages_show_list)*
4. Kembali ke Brandlab: jendela **Pick the accounts** menampilkan Instagram, Pages, dan ad accounts. Pilih, lalu **Save**. *(pages_show_list, instagram_basic, ads_read)*
5. Kartu brand menampilkan @username, nama Page, dan akun iklan. Klik **Sync now**. Angka pengikut dan jangkauan Instagram serta Page muncul. *(instagram_basic, instagram_manage_insights, pages_read_engagement, read_insights)*
6. Content list → ⋮ → **Import from Instagram**: grid postingan muncul. Pilih dua, Import, lalu buka satu kartu dan tunjukkan views, reach, dan saves. *(instagram_basic, instagram_manage_insights)*
7. Create → Creator → video yang sudah disetujui → langkah **Upload**. Centang **Also share to Facebook**, klik **Post now**, konfirmasi. Tunggu status "Published". *(instagram_content_publish, pages_manage_posts)*
8. Buka Instagram (HP atau web, dari akunmu sendiri) dan Halaman Facebook: tunjukkan postingan yang baru tayang. *(instagram_content_publish, pages_manage_posts)*
9. Pindah ke My Brand → **Sales** → "Content that made money": baris postingan dengan **Ad spend Rp …** dan **Meta reports … purchases**. *(ads_read)*
10. Kembali ke Settings → Meta accounts → **Disconnect** (opsional, menunjukkan user bisa mencabut).

**Video B: Instagram Login** (sekitar 2 menit, mencakup 3 izin)
1. Login Brandlab → Settings → Meta accounts → pada brand lain klik **Instagram only**.
2. Jendela Instagram: login dengan akun IG profesional tanpa Page dan tunjukkan 3 izinnya.
3. Kembali: kartu "via Instagram" dengan @username. **Sync now**: angka muncul. *(instagram_business_basic, instagram_business_manage_insights)*
4. Creator → Upload → **Post now**. Tunjukkan postingannya di Instagram. *(instagram_business_content_publish)*

Syarat sebelum merekam:
- Kodenya sudah live dan env sudah diisi.
- Akun IG dan Halaman yang dipakai harus punya peran di app (Standard Access).
- Ada satu video yang sudah disetujui di Drive brand contoh.
- Ada iklan aktif atau baru saja aktif dari akun iklan Rupiah yang mempromosikan postingan yang sudah ada di Brandlab (untuk langkah 9 video A). Biaya iklan baru masuk setelah sinkron.

## 8. Yang belum bisa dicek dari sini

- Panggilan ke Meta sungguhan belum pernah terjadi. Semua tes memakai Meta palsu. Pemeriksaan pertama di produksi: login dengan akunmu, lalu lihat apakah jendela Pick the accounts terisi.
- **Belum terverifikasi di dokumentasi untuk token BISU:** apakah `/me/accounts` selalu mengembalikan Page beserta Page token-nya. Kode punya cadangan `/{page-id}?fields=access_token`, dan kalau tidak ada Page token, BISU dipakai langsung. Kalau Page tidak muncul di picker, kabari aku.
- Nama metrik Page setelah perubahan Juni 2026: kode mencoba `page_total_media_view_unique`, lalu `page_impressions_unique`. Kalau dua-duanya ditolak, jangkauan Page tampil "–" (pengikut tetap tampil).
- Penjualan yang dilaporkan Meta dihitung dari `omni_purchase` / `purchase`. Iklan tanpa pixel tidak punya angka ini.
- Posting dari Drive lewat HP dengan video besar (ratusan MB) belum dites di perangkat asli.
