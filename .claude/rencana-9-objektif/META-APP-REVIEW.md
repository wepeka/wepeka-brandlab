# Paket App Review Meta: Brandlab (app "wepeka")

Versi 25 November 2026. Menggantikan versi 24 Nov.
Dasar: riset dokumentasi resmi Meta tanggal 25 Nov 2026, semua bersumber. Ringkasan sumbernya ada di §11. Riset lengkap ada di file catatan sesi `meta-app-review-research-2026-11-25.md`.

App Meta: **wepeka** `1996512847700669`. Jenis Business, sudah Business-verified, Tech Provider, Published.

---

## 0. Ringkasnya (diperbarui 25 Nov, pagi)

**Keputusan final: dua app Meta, satu cara login per app** (aturan Meta: *"create an app for each setup"*).
- **App 1 "wepeka"** (yang ini): **Sambungkan Facebook** → Instagram + Halaman + iklan. Ajukan 9 izin + `public_profile`.
- **App 2 (baru, khusus Instagram)**: **Sambungkan Instagram** → angka organik IG saja. Ajukan 3 izin `instagram_business_*`. Paketnya di §12.

**Sudah beres di dashboard app 1 (diatur langsung 25 Nov):**
- ✅ Ikon 1024×1024 (logo Wepeka, latar transparan — Meta menolak latar putih). Status "Currently ineligible for submission" **sudah hilang**.
- ✅ Terms of Service URL `https://www.wepeka.com/syarat-ketentuan`
- ✅ App domains `wepeka.com`, `brandlab.wepeka.com`
- ✅ Platform Website `https://brandlab.wepeka.com/`
- ✅ Draf App Review berisi **tepat 10**: `read_insights`, `pages_manage_posts`, `pages_show_list`, `instagram_content_publish`, `business_management`, `ads_read`, `pages_read_engagement`, `public_profile`, `instagram_manage_insights`, `instagram_basic`. 19 lainnya dibuang (dicek ulang setelah halaman dimuat ulang).

**Sudah di kode (commit lokal, belum di-push):**
- Halaman **Akun Sosmed**: per brand pilih *Sambungkan Instagram* atau *Sambungkan Facebook*; pengingat sebelum jendela Facebook; *Tambah Facebook & iklan* untuk brand yang lewat Instagram; data langsung ditarik setelah tersambung.
- **Rincian dari Meta** di tiap konten (Isi angka): Instagram organik · Dari iklan · Facebook · Total.
- Angka dari iklan per postingan (`total_*` − organik) lewat jalur Facebook; reels Halaman yang di-cross-post ikut ditarik.
- **Data dari Meta tidak dikirim ke AI** (`js/meta-safe.js`). Jadi kebijakan privasi dan jawaban data handling **tidak perlu menyebut penyedia AI**.
- Hapus data lewat Meta menghapus data dari Meta; Sales menampilkan tayangan + klik iklan.

**Masih perlu:** push → panggilan API per izin (§4) → akun reviewer (§5) → kebijakan privasi (§3) → buat app 2 (§12) → rekam video (§6) → submit.

## 1. Urutan kerja (centang satu per satu)

**A. Dashboard Meta** (kamu, ±15 menit). Detailnya di §2.
- [ ] Upload ikon 1024×1024, tanpa logo Facebook/Instagram.
- [ ] Isi Terms of Service URL, App domains, dan platform Website.
- [ ] Buang 19 izin/fitur yang tidak dipakai dari draf App Review.

**B. Kebijakan privasi wepeka.com.** Teks tambahannya sudah jadi (§3); tinggal dipasang dan di-deploy di repo wpk-dp.

**C. Push kode Brandlab ke produksi.** Isinya: panel tarik data, Import baru, hapus data, Sales, dan tombol IG disembunyikan. Push hanya setelah kamu bilang "push".

**D. Panggilan API nyata** untuk izin yang belum punya (§4), **minimal 2 hari sebelum submit**.

**E. Akun reviewer Brandlab + brand demo** (§5).

**F. Rekam 9 screencast** (§6).

**G. Isi formulir App Review**: teks per izin (§7), instruksi reviewer (§8), dan pertanyaan data handling (§9). Lalu **Submit**.

**H. Selama direview: jangan ubah fitur Meta di Brandlab.** Meta menulis bahwa perubahan setelah submit "may require re-review".

---

## 2. Dashboard Meta: yang harus diubah

**App settings → Basic:**

| Kolom | Sekarang | Isi menjadi |
|---|---|---|
| App icon | kosong (ini yang memblokir) | PNG/JPG 1024×1024, tanpa logo FB/IG. Pakai logo Wepeka/Brandlab. |
| Display name | wepeka | Boleh tetap. Jangan pakai kata Facebook/Instagram/IG/Gram. |
| App domains | kosong | `wepeka.com` dan `brandlab.wepeka.com` |
| Terms of Service URL | kosong | `https://www.wepeka.com/syarat-ketentuan` |
| Privacy policy URL | sudah diisi | tetap `https://www.wepeka.com/kebijakan-privasi`, tapi isinya ditambah (§3) |
| User data deletion | callback sudah diisi | tetap |
| Category | Business and pages | tetap |
| Add platform | belum ada | **Website** → Site URL `https://brandlab.wepeka.com` |

Kalau formulir App Review menanyakan **App Purpose**, pilih **Clients**.

**Review → App Review → hapus (ikon tong sampah) 19 item ini:**

`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_branded_content_ads_brand`, `instagram_branded_content_brand`, `instagram_branded_content_creator`, `instagram_creator_marketplace_discovery`, `threads_business_basic`, `catalog_management`, `ads_management`, `email`, `Human Agent`, `Marketing API Access Tier`, `Business Asset User Profile Access`, `Instagram Public Content Access`.

**Yang tetap ada (10):**

`instagram_basic`, `instagram_manage_insights`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `business_management`, `ads_read`, `public_profile`.

Menurut FAQ FBLB, `public_profile` wajib punya Advanced Access sebelum app FBLB live.

Catatan:
- Menghapus izin dari draf App Review **tidak** mematikan auto-DM @winkhsin. Akun yang punya peran di app tetap memakai Standard Access.
- Kalau dashboard memaksa menambah `pages_read_user_content` sebagai dependency `instagram_basic`, ikuti saja. Di deskripsinya tulis "required by instagram_basic".

---

## 3. Kebijakan privasi: bagian yang harus ditambah

Menurut Meta, kebijakan privasi wajib menjelaskan **data Meta apa yang diambil, untuk apa, dan cara meminta penghapusan**. Halaman wepeka.com/kebijakan-privasi sekarang belum menyebut data Instagram, Halaman, maupun iklan.

Teks lengkapnya (Indonesia + English) ada di `.claude/rencana-9-objektif/privacy-meta-section.md`. Pasang sebagai bagian baru di `src/app/(store)/kebijakan-privasi/page.tsx` (repo `wepeka/wpk-dp`, branch master).

Ganti `[email kontak Wepeka]` dengan email yang benar-benar dibaca.

**AI: sudah diputuskan.** Data dari Meta tidak pernah dikirim ke AI (`META_DATA_TO_AI = false` di `js/meta-safe.js`). Teks privasi tidak perlu menyebut penyedia AI. Kalau suatu hari mau dinyalakan, penyedia AI-nya harus disebut dulu di kebijakan privasi dan jawaban data handling.

---

## 4. Panggilan API per izin (wajib sebelum submit)

Cek di **App Review → Permissions and Features**. Tiap izin menunjukkan jumlah panggilan API. Panggilan tercatat sampai 2 hari setelah terjadi.

| Izin | Sudah ada? | Cara membuatnya |
|---|---|---|
| `instagram_basic`, `instagram_manage_insights` | kemungkinan sudah (Quatro tersambung dan disinkron 25 Nov) | — |
| `pages_show_list`, `pages_read_engagement`, `read_insights` | kemungkinan sudah (Halaman Quatrokidsclub ikut disinkron) | — |
| `ads_read` | **belum** (belum ada akun iklan yang dihubungkan) | Pengaturan → Akun Sosmed → Quatro → **Ganti akun** → Tambah akun iklan → pilih akun iklan Rupiah → Simpan → **Sinkron sekarang** |
| `instagram_content_publish` | **belum** | Posting satu video dari Brandlab ke akun IG milik Wepeka (Creator → Upload → Posting sekarang). Postingannya boleh diarsipkan setelahnya. |
| `pages_manage_posts` | **belum** | Video yang sama dengan centang **Bagikan juga ke Facebook** |
| `business_management` | belum pasti | Graph API Explorer → app wepeka → token dengan `business_management` → `GET /me/businesses` (Meta mengizinkan panggilan dari Graph API Explorer) |
| `public_profile` | otomatis | — |

Dua panggilan posting itu sekalian bisa jadi bahan screencast (§6).

---

## 5. Akun reviewer + brand demo

Meta menulis: *"We will test your app using our own test accounts. Do not include your personal … credentials."* Membuat test user di Meta juga sedang dimatikan. Jadi:

1. **Buat akun Brandlab khusus reviewer** dengan email dan password, misalnya email Wepeka yang kamu pegang. Akunnya kamu yang buat, dan passwordnya hanya kamu yang tahu.
2. Kirim emailnya ke aku. Aku akan:
   - menyalakan `metaBeta: true` supaya menu Akun Meta muncul;
   - membuat paketnya aktif lebih dari 60 hari, supaya tidak kena paywall selama review dan review ulang.
3. Login ke akun itu, ganti bahasa ke **English** (Settings → Language), lalu buat satu brand demo, misalnya **"Demo Coffee"**.
4. **Supaya reviewer bisa mencoba posting**, brand demo perlu satu video yang sudah disetujui. Posting di Brandlab mengambil video dari Google Drive pemilik brand, jadi:
   - hubungkan Google Drive milik akun Google Wepeka (bukan pribadi) ke akun reviewer;
   - unggah satu video pendek ke satu kartu konten;
   - tandai video itu siap posting.
   Kalau ini terlalu repot, reviewer tetap bisa menilai izin posting dari screencast, tapi risikonya izin itu ditolak karena "cannot test".
5. **Uji sendiri sehari sebelum submit**: buka jendela penyamaran, login dengan akun reviewer, lalu ikuti persis instruksi §8.

---

## 6. Screencast: aturan + naskah per izin

**Aturan Meta:**
- UI dalam bahasa Inggris. Bagian yang masih berbahasa Indonesia diberi teks keterangan bahasa Inggris.
- Minimal 1080p. Lebar layar maksimal 1440 (Mac: System Settings → Displays → pilih resolusi yang lebih kecil).
- **Tanpa suara.** Pakai mouse, perbesar kursor, boleh zoom dan anotasi.
- Tiap video dimulai dari **keadaan logout**, lalu login, lalu tombol Connect Facebook dan jendela izin Meta, lalu **data izin itu tampil di Brandlab**.
- **Satu klip per izin.** Cara paling hemat: rekam satu kali alur lengkap, lalu potong jadi 9 klip. Tiap klip memakai bagian login + izin yang sama, lalu bagian khusus izin itu.
- Aturan lama tetap: Claude tidak membuka Instagram di browser. Bagian "postingan muncul di Instagram" kamu rekam sendiri dari HP atau laptopmu.

**Bagian awal yang sama untuk semua klip (±40 detik):**
1. brandlab.wepeka.com dalam keadaan logout, lalu login dengan email.
2. ⋮ → **Settings** → **Social accounts** → klik **Connect Facebook** di brand demo.
3. Jendela Meta: pilih business portfolio → Instagram → Page → ad account → lihat daftar izin → Continue.
4. Kembali ke Brandlab: jendela **Which Instagram is …?** → pilih IG; Page ikut otomatis; buka **Add an ad account** → pilih → **Save**.

**Bagian khusus per izin:**

| Klip | Izin | Yang direkam setelah bagian awal |
|---|---|---|
| 1 | `pages_show_list` | Zoom ke jendela pilih akun: daftar Page milik user, Page terpilih, lalu kartu brand yang menampilkan nama Page. |
| 2 | `business_management` | Zoom ke langkah Meta "choose business portfolio" dan pemilihan aset (ini token BISU). Lalu kartu brand dengan IG, Page, dan akun iklan dari portfolio itu. |
| 3 | `instagram_basic` | Kartu brand menampilkan @username. Lalu Content list → ⋮ → **Import from Instagram**: grid postingan dengan username, foto, tanggal, dan jumlah like. Pilih 2 postingan → **Add 2 posts** → kartunya muncul. |
| 4 | `instagram_manage_insights` | **Sync now**: panel progres berjalan sampai "Data is in!". Buka satu kartu konten: views, reach, saves, shares. Kartu brand: followers + reach 30 hari. |
| 5 | `instagram_content_publish` | Create → Creator → video demo → step **Upload** → caption + hashtag → **Post now** → status Published. Lalu (rekaman HP/laptopmu) postingan yang sama tampil di Instagram. |
| 6 | `pages_manage_posts` | Sama seperti klip 5 dengan centang **Also share to Facebook** → postingan tampil di Halaman Facebook. Keterangan: *"Brandlab only publishes; it does not edit or delete Page posts."* |
| 7 | `pages_read_engagement` | Kartu brand: nama Page + jumlah followers. Kartu konten dari video yang diposting ke Page: likes/comments Facebook. |
| 8 | `read_insights` | **Sync now** → kartu brand: "Page: N followers, 28-day reach N". Kartu video Page: views Facebook. |
| 9 | `ads_read` | **Sync now** → My Brand → **Sales** → "Content that made money": baris postingan dengan **Ad spend Rp …**, **Meta ads: N impressions · N clicks**, **Meta reports N purchases**. Zoom ke angka-angkanya. |

Syarat sebelum merekam:
- Kode 25 Nov sudah live.
- Akun IG, Page, dan akun iklan yang dipakai milik Wepeka dan punya peran di app.
- Ada iklan yang mempromosikan postingan yang sudah ada di Brandlab, aktif dalam 2 bulan terakhir, dari akun iklan Rupiah. Kalau belum ada, boost satu postingan dengan anggaran kecil.

---

## 7. Teks per izin (bahasa Inggris, tempel apa adanya)

Meta menulis *"Each permission and feature must have its own description. Do not copy and paste."* Karena itu tiap teks di bawah sengaja dibuat berbeda.

Kolom deskripsi umum app:
> Wepeka Brandlab (https://brandlab.wepeka.com) is a web app that helps small businesses and creators in Indonesia plan, publish and measure their social media content. A business connects its Instagram professional account, Facebook Page and (optionally) Meta ad account once through Facebook Login for Business, using a Business Integration System User token (we are a Tech Provider). Brandlab then imports the business's posts, shows each post's performance, publishes posts only when the user presses "Post now" or "Schedule", and records ad spend as an expense next to the business's own sales. Tokens are encrypted on our servers and never reach the browser. Users disconnect in Settings → Social accounts at any time, and we honour Meta's deauthorize and data deletion callbacks.

**instagram_basic**
> After a business connects with Facebook Login for Business, Brandlab reads the Instagram professional account's ID and username to show which account is connected on the brand's card (Settings → Social accounts), and reads the account's media list (ID, caption, permalink, timestamp, thumbnail) for "Import from Instagram", where the user picks which of their existing posts to add to their content list. Without it the user would have to copy every post into Brandlab by hand, and we could not show which account a brand is using.

**instagram_manage_insights**
> Brandlab shows each imported post's own performance (views, reach, likes, comments, shares, saves) on the post's card and in the monthly report, plus the account's follower count and 30-day reach on the brand's card. The data is refreshed when the user presses "Sync now" and once a night. We only read insights of the business's own connected account, never of other accounts. Without this permission the user would have to type every number from screenshots.

**instagram_content_publish**
> In Brandlab's Creator, a user prepares a post (video or photos plus caption). When they press "Post now" or "Schedule to Instagram" in the Upload step, our server creates the media container from the user's own file and publishes it to their connected Instagram account at the time they chose. Nothing is ever published without that explicit action. This lets a team plan, approve and publish from one place instead of switching apps.

**pages_show_list**
> After Facebook Login for Business, Brandlab lists the Facebook Pages the business shared with us in the account picker ("Which Instagram is this brand's?" → Facebook Page), so the user can link the right Page to each brand. It also lets us find the Page that belongs to the selected Instagram account. Without it the user could not choose a Page.

**pages_read_engagement**
> For the Page the user linked to a brand, Brandlab reads the Page's name and follower count to show them on the brand's card, and reads likes and comments on videos the user published to that Page from Brandlab, shown on that post's card next to its Instagram numbers. It is also required by pages_manage_posts, read_insights and the Instagram permissions above.

**pages_manage_posts**
> When the user ticks "Also share to Facebook" before pressing "Post now" or "Schedule", Brandlab publishes the same approved video (or photos) with the user's caption to the Facebook Page linked to the brand, right after Instagram. Brandlab only creates posts the user asked for; it does not edit or delete Page posts. This saves teams from uploading the same video twice.

**read_insights**
> Brandlab reads the linked Page's 28-day reach (page_total_media_view_unique) and the view counts of videos the user published to the Page from Brandlab, and shows them on the brand's card and on each post's numbers, so the business sees its Facebook results next to Instagram in one report. Page insights are not available through pages_read_engagement alone.

**business_management**
> Brandlab is a Tech Provider and connects clients through Facebook Login for Business with a Business Integration System User token, so clients can grant access to Instagram accounts, Pages and ad accounts owned by their business portfolio. Meta's documentation states that business_management is required when making API requests as a business system user, and it is a default, required permission of the Pages and Instagram content-management use cases. We use it only so the system user token can read the assets the client assigned (shown in the account picker). Brandlab never creates, claims or changes business assets, ad accounts or business settings.

**ads_read**
> If a business links an ad account (optional), Brandlab reads, per ad, the spend, impressions, clicks and Meta-reported purchases for the last two months, and matches each ad to the Instagram post it promotes. In the Sales page the spend appears as an automatic "Ads" expense next to that post, with impressions, clicks and Meta-reported purchases shown beside it (never added to the business's own sales), so the owner sees what each piece of content cost and earned. Only team members the owner gave Sales access can see it. Brandlab never creates or edits ads.

**public_profile** (kalau diminta)
> Granted with Facebook Login for Business; we read only the app-scoped user ID to keep each login separate. Required by Meta for Facebook Login for Business apps.

---

## 8. Instruksi untuk reviewer (bahasa Inggris)

Untuk kolom App Verification / Platform Settings → Web → "how to access and test". Ganti bagian `<…>`.

> **Login:** https://brandlab.wepeka.com → "Sign in with email" → email: `<reviewer email>` · password: `<password>`. The account has an active plan and the interface is set to English (Settings → Language). Brandlab sign-in uses email/Google; Facebook Login for Business is used afterwards to connect a business's Meta assets.
>
> **Connect (all permissions):** open the ⋮ menu (top right) → Settings → "Social accounts". On the brand "Demo Coffee", click "Connect Facebook". In Meta's window choose a business portfolio (Meta requires one for this login), an Instagram professional account, a Facebook Page and, optionally, an ad account. Back in Brandlab, in "Which Instagram is Demo Coffee's?" pick the Instagram account (its Page is filled in automatically), optionally open "Add an ad account", then click "Save".
>
> 1. **instagram_basic, pages_show_list, business_management:** the brand card now shows the Instagram username, the Page and the ad account. Content → ⋮ → "Import from Instagram" lists the account's posts; pick some and click "Add N posts".
> 2. **instagram_manage_insights, read_insights, pages_read_engagement:** on the brand card click "Sync now". A panel shows each step; when it says "Data is in!", the card shows Instagram followers and 30-day reach and the Page's followers and 28-day reach. Open any imported post: its views, reach, saves and shares are filled in.
> 3. **instagram_content_publish, pages_manage_posts:** Create → Creator → the piece "Demo video" → step 5 "Upload" → write a caption → tick "Also share to Facebook" → "Post now". The status turns to Published and the post appears on the Instagram account and the Page.
> 4. **ads_read:** after "Sync now" with an ad account linked, open My Brand → Sales → "Content that made money": posts promoted by ads show the ad spend, impressions, clicks and Meta-reported purchases.
> 5. **Disconnect:** Settings → Social accounts → "Disconnect" removes the tokens.
>
> Screen recordings for each permission follow exactly these steps. If anything blocks you, contact `<email>`.

---

## 9. Pertanyaan data handling (bahasa Inggris)

Pertanyaan ini muncul di langkah 2 pengajuan dan nanti ditanyakan tiap tahun di Data Use Checkup.

1. **Processors / service providers with access to Platform Data:**
   - **Vercel Inc.**: hosting and serverless functions. Countries: United States, plus the edge network.
   - **Google LLC** (Firebase Firestore, Firebase Storage, Google Cloud): database and files. Country: `<region project Firebase; cek di Firebase console → Project settings → Default GCP resource location>`.
   - **Google Drive**: the owner's own Drive, only for the owner's video files. Not Meta data.
   - AI providers: none — Brandlab keeps Meta data out of its AI features.
2. **Responsible entity (controller):** Wepeka, a sole proprietorship of Winson Pratama Kho, Indonesia.
3. **National-security requests in the past 12 months:** No.
4. **Policies for such requests:** answer honestly. If none exist yet, choose the closest options, such as "review legality" and "disclose only the minimum required".

**Data Protection Assessment** (dikirim lewat email dan Alert Inbox setelah Advanced Access; 60 hari untuk mengisi). Siapkan dari sekarang:
- **2FA di semua alat:** GitHub, Vercel, Google/Firebase, Meta. Vercel-mu masih perlu dibereskan, jadi ini prioritas.
- Token Meta dienkripsi AES-256-GCM di server, dan app secret serta token tidak pernah ada di perangkat user. Data lain terenkripsi saat disimpan oleh Google/Vercel, dan koneksi memakai TLS 1.2+.
- Data tiap klien terpisah per brand (aturan Firestore + pemeriksaan di server). Brandlab memproses data hanya atas perintah klien.
- Penghapusan: Putuskan menghapus token. Permintaan hapus lewat Meta menghapus token beserta data dari Meta (sudah ada di kode). Permintaan lewat email ditangani paling lama 30 hari.
- Saluran laporan keamanan publik, misalnya alamat email di wepeka.com.

---

## 10. Setelah lolos, dan Instagram Login

**Setelah Advanced Access keluar:**
1. Buka untuk semua: `META_FOR_EVERYONE = true` di `js/account.js` + env `META_OPEN=1`.
2. Di commit yang sama, tambahkan entri pengumuman di `api/_updates.js` (Cara pakai + screenshot).
3. Perbaiki dulu "angka manual tidak ditimpa sinkron" sebelum dibuka untuk semua.
4. Isi Data Protection Assessment kalau dikirim.

**"Pakai Instagram saja" (akun IG tanpa Halaman/portfolio).** Ada tiga jalan:
- **Instagram API with Unified Login** (paling disarankan Meta). Konfigurasi FBLB yang sama bisa menerima login lewat Instagram, memakai izin `instagram_*` yang sama, tanpa review tambahan. Syaratnya klien punya business portfolio, dan konfigurasinya harus berlabel "Instagram Login Compatible".
- **App Meta terpisah** khusus Instagram Login, dengan review sendiri.
- Pengajuan kedua di app yang sama, dengan risiko ditolak karena aturan "not both".

Kita putuskan setelah pengajuan pertama lolos.

---

## 11. Sumber utama (dibaca 25 Nov 2026)

- Proses + syarat pengajuan: developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review, …/app-review/submission-guide
- Aturan screencast: developers.facebook.com/docs/app-review/submission-guide/screen-recordings
- Allowed usage per izin: developers.facebook.com/documentation/development/permissions
- `business_management` wajib untuk system user: developers.facebook.com/documentation/pages-api/manage-pages
- `read_insights` untuk /insights Halaman: developers.facebook.com/docs/graph-api/reference/insights
- "Facebook Login or Instagram Login but not both": developers.facebook.com/documentation/instagram-platform/app-review
- Access Verification dihapus 9 Okt 2026: developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps
- Test user dimatikan: developers.facebook.com/documentation/development/build-and-test/test-users
- Kebijakan privasi: developers.facebook.com/documentation/development/terms-and-policies/privacy-policy
- Data Protection Assessment: developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/data-protection-assessment

Belum terkonfirmasi dari dokumentasi:
- apakah akun uji reviewer Meta punya IG profesional, Halaman, dan akun iklan sendiri;
- apakah `pages_manage_posts` tetap disetujui untuk "hanya posting" (teks screencast Meta menyebut buat, ubah, hapus);
- cara banding resmi kalau ditolak (halaman "After You Submit" milik Meta kosong).

---

## 12. App 2: khusus Instagram Login

**Kenapa:** Meta tidak mengizinkan satu app memakai login Facebook dan login Instagram sekaligus. Tombol **Sambungkan Instagram** butuh app sendiri.

**Langkah membuat (± 5 menit, dikerjakan setelah kamu setuju):**
1. developers.facebook.com → **Create app** → tipe **Business** → sambungkan ke business portfolio Wepeka yang sudah terverifikasi. Nama: **Wepeka Brandlab IG**.
2. Use case: **Manage messaging & content on Instagram** → **API setup with Instagram login**. Izin: `instagram_business_basic`, `instagram_business_manage_insights`, `instagram_business_content_publish`. **Jangan** tambah izin pesan atau komentar.
3. Business login settings: redirect `https://brandlab.wepeka.com/api/instagram/callback`, deauthorize `https://brandlab.wepeka.com/api/instagram/deauthorize`, data deletion `https://brandlab.wepeka.com/api/instagram/data-deletion`.
4. App settings → Basic: ikon yang sama (`meta-app-icon-1024.png`), privacy + terms URL, domain, platform Website — sama seperti app 1.
5. Vercel env: `IG_APP_ID` = Instagram app ID app 2. **`IG_APP_SECRET` kamu tempel sendiri.** Lalu redeploy.
6. Di app 1 "wepeka": hapus setup "API setup with Instagram login" supaya satu app = satu cara login. (Auto-DM @winkhsin ikut pindah ke app 2 kalau suatu hari dinyalakan lagi.)

**Teks per izin (English):**
- **instagram_business_basic**
  > When a business connects through "Connect Instagram" (Settings → Social accounts), Brandlab reads the Instagram professional account's ID and username to show which account is connected on the brand's card, and the account's media list so the user can import their existing posts into Brandlab's content list ("Import from Instagram").
- **instagram_business_manage_insights**
  > Brandlab shows each post's own organic numbers (views, reach, likes, comments, shares, saves) on the post's card ("Breakdown from Meta") and in the monthly report, and the account's follower count and 30-day reach on the brand's card. Refreshed on "Sync now" and once a night. Only the connected account's own insights are read.
- **instagram_business_content_publish**
  > When the user presses "Post now" or "Schedule to Instagram" for a prepared post in Brandlab's Creator (Upload step), our server publishes the user's own video or photos with their caption to the connected Instagram account at the chosen time. Nothing is published without that action.

**Screencast (3 klip, aturan sama dengan §6):** logout → login Brandlab → Settings → Social accounts → **Connect Instagram** → jendela Instagram (login + izin) → kembali, kartu menampilkan @username dan panel tarik data berjalan.
- Klip 1 `instagram_business_basic`: @username di kartu + Import from Instagram.
- Klip 2 `instagram_business_manage_insights`: Sync now → buka satu konten → Breakdown from Meta (Instagram organic).
- Klip 3 `instagram_business_content_publish`: Creator → Upload → caption + hashtag → Post now → postingan tampil di Instagram (rekaman HP/laptopmu).

**Instruksi reviewer:** sama dengan §8, tapi pakai tombol **Connect Instagram** pada brand demo kedua.

