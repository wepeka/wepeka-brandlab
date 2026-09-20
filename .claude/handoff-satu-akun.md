# Handoff: Satu akun Wepeka (wepeka.com + Brandlab), login Google, email wajib valid, Brandlab hanya bayar / trial 30 hari

Tanggal brief: 20 Sep 2026. Dokumen ini berdiri sendiri: semua path, fungsi, keputusan produk, dan kriteria selesai ada di sini. Salinan identik ada di `.claude/handoff-satu-akun.md` di kedua repo.

## 0. Cara mulai sesi baru

Kasih tahu Claude: **"Baca `.claude/handoff-satu-akun.md`, lanjutkan dari fase yang belum dicentang di bagian 9."** Kerjakan fase berurutan. Tiap fase selesai: jalankan cek di bagian 8, lalu centang di bagian 9 dan tulis addendum singkat di bawah dokumen ini (apa yang berubah, apa yang belum diuji).

## 1. Aturan main (berlaku di kedua repo)

- Repo wepeka.com: `/Users/wepeka/Documents/wpk-dp` (Next.js 16, Supabase). Baca `AGENTS.md` dulu. Cek: `npm run build`, `npx tsc --noEmit`, `npm run lint`.
- Repo Brandlab: `/Users/wepeka/Desktop/CONTENT PLANNER WEPEKA` (HTML/JS statis tanpa build, Firebase project `wepeka-ba996`, Vercel `/api`). Cek: `node --check js/<file>` untuk tiap file yang disentuh. Server lokal `python3 serve.py` → http://localhost:8743.
- **Jangan commit / push / deploy** kecuali user minta eksplisit. Jangan pernah echo isi private key Firebase (baca file, proses lewat script, jangan `cat`).
- **Claude tidak boleh mengetik password di browser.** Semua uji yang butuh login dilakukan user; siapkan checklist "belum diuji".
- Migrasi SQL Supabase dijalankan user lewat Dashboard SQL Editor (tidak ada CLI/psql di mesin ini). Tambahkan setiap migrasi baru ke `supabase/migrations/RUN_ALL.sql` dan `APPLY_NOW.sql`.
- Firestore rules: **kode dulu, rules belakangan** (pernah lockout tim karena rules dideploy duluan).
- Akun uji: `winsonpratamakho01@gmail.com` (uid `25p9scf3WNbXxlSu3NT3OFXxcmM2`, akun test user sendiri). Akun tim asli `wepekapparel@gmail.com` (uid `iSwfTtIQm6VkYoHFbI6wl7BzBF53`, admin, plan lifetime) jangan diubah. Brand "Pinter Mandarin" read-only.
- Semua copy lewat dictionary: wpk-dp `src/lib/community/copy.ts` (id+en), Brandlab `js/i18n/*.js` lewat `t()`. Jangan hardcode.

## 2. Masalah yang diselesaikan (semua ditelusuri ke kode, 20 Sep 2026)

Dua produk, dua sistem identitas, disambung cuma lewat **alamat email**:

| | wepeka.com | Brandlab |
|---|---|---|
| Kredensial | `members.password_hash` (scrypt, `src/lib/community/password.ts`) + cookie `wpk_member` | Firebase Auth (email/password + Google) |
| Data akun | `members` (Supabase) | `accounts/{uid}` (Firestore) |
| Jembatan | `/brandlab/connect` mint custom token → `planner.wepeka.com/#/sso?t=` | `js/main.js consumeWepekaToken` |

1. **Dua password untuk satu orang.** Sign-up wepeka.com meng-mirror password ke Firebase (`src/lib/brandlab-account.ts:95-113`), tapi kalau email sudah ada di Firebase password lama dibiarkan. `changePasswordAction` (`src/app/(store)/community/actions.ts:327`) cuma ganti Supabase; "Lupa password" Brandlab (`js/views/login.js:107`) cuma ganti Firebase.
2. **Member Google / lewat bridge tidak punya password di Firebase** (`firebaseUidForMember` buat user tanpa password; `src/app/api/community/firebase-session/route.ts:73` simpan hash acak) → form email+password Brandlab selalu "Email atau password salah".
3. **Email palsu diterima dan dicap verified.** Validasi cuma regex (`actions.ts:97`), tidak ada email verifikasi, tidak ada blokir domain sekali-pakai, tapi `emailVerified: true` di-set (`brandlab-account.ts:72,106`). Siapa pun bisa daftar pakai email orang lain; waktu pemilik asli login Google, Google ter-link ke akun pendaftar.
4. **Brandlab terbuka untuk semua member.** `/brandlab/connect` sengaja tanpa cek plan (`connect/route.ts:11-13`); Brandlab client bikin sendiri `accounts/{uid}` trial 7 hari (`js/account.js:71-85`); trial habis cuma read-only setengah jalan (app tetap render, simpan gagal dengan toast generik, `js/main.js:143-147`).
5. **Sesi tidak sinkron.** Firebase persist tanpa TTL, cookie wepeka 30 hari; SSO masuk saat sudah login uid lain tidak teardown store (`js/main.js:115,147`).
6. Bug pendukung: cron `api/cron/check-expiry.js:26` query `subscriptionExpiresAt < now` tanpa guard tipe; `api/midtrans/create-transaction.js` terima `uid` dari body tanpa auth; `api/midtrans/webhook.js:46` lolos cek amount untuk `LEGACY_PLANS`; `offer=trial` di URL SSO dibuang regex Brandlab (`js/main.js:367`); `usernameTaken`/`getMemberByUsername` (`src/lib/community/db.ts:636-643`) pakai `ilike` tanpa escape `_`.

## 3. Keputusan produk (sudah dikonfirmasi user, jangan ditanya ulang)

- **Firebase Auth jadi satu-satunya tempat kredensial** untuk kedua produk. Supabase `members` tetap data komunitas, dikunci ke `firebase_uid`.
- Login: **email+password DAN Google**. Email wajib **terverifikasi** (link verifikasi Firebase) + blokir domain sekali-pakai + cek MX.
- **Member lama wajib verifikasi email sekali** di login berikutnya.
- **Trial Brandlab 30 hari** (bukan 7), diklaim dari wepeka.com oleh akun terverifikasi. Misi trial tetap jadi syarat klaim (kalau user mau tanpa misi, hapus satu cek di `claimTrialAction`). Trial habis / tidak bayar → Brandlab **terkunci** (layar paket, data tetap tersimpan).

## 4. Prasyarat yang HARUS dilakukan user (bukan kode)

- [ ] Vercel wpk-dp **dan** Vercel Brandlab: `FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY` (catatan lama: belum diisi di production; tanpa ini bridge mati).
- [ ] Vercel wpk-dp: `NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID` (sudah di `.env.local` lokal).
- [ ] Firebase Console → Authentication → Sign-in method: Email/Password on, Google on, "Email enumeration protection" on.
- [ ] Firebase Console → Authentication → Settings → Authorized domains: `wepeka.com`, `www.wepeka.com`, `planner.wepeka.com`, `brandlab.wepeka.com`, domain preview Vercel, `localhost`.
- [ ] Firebase Console → Authentication → Templates: bahasa Indonesia, pengirim "Wepeka", **Action URL** = `https://www.wepeka.com/community/auth/action` (dibuat di Fase 1.4).
- [ ] Midtrans key asli (`js/views/pricing.js:33-36` masih placeholder). Di luar scope, tapi tanpa ini "bayar" tidak bisa diuji end-to-end.

## 5. Arsitektur target

```
Browser ──(Firebase web SDK: email+password / Google)──► Firebase Auth (wepeka-ba996)
   │  idToken (email_verified=true)
   ▼
wepeka.com  POST /api/community/firebase-session ──► verifyIdToken ──► members WHERE firebase_uid=uid
   │                                                                     (fallback email → backfill uid)
   │  cookie wpk_member (tetap)
   ▼
/brandlab/connect ──► brandlabAccess(uid) = paid | trial | expired | none
        paid/trial ──► custom token ──► planner.wepeka.com/#/sso?t=
        expired/none ──► /community/brandlab (klaim trial 30 hari / lihat paket)

Brandlab: accounts/{uid} HANYA dibuat Admin SDK (klaim trial dari wepeka.com, webhook Midtrans, admin).
          Tidak ada doc / expired → layar paket, app tidak dirender.
```

Satu definisi akses, diimplementasikan identik di `src/lib/brandlab-db.ts` (wpk-dp) dan `js/account.js` (Brandlab):
- `paid`   = `plan ∉ {free, trial}` ∧ `status == active` ∧ (`subscriptionExpiresAt` null ∨ > now)
- `trial`  = `plan == trial` ∧ `status == active` ∧ `trialEndsAt > now`
- selain itu `expired` (doc ada) / `none` (doc tidak ada)

## 6. Fase pengerjaan

### FASE 0 — Bug mandiri di Brandlab (kecil, aman, kerjakan dulu)

1. `api/cron/check-expiry.js`: di loop `lapsedSubs` tambah guard `typeof acc.subscriptionExpiresAt === "number" && acc.plan !== "trial"`; tambah query param `?dryRun=1` yang hanya mengembalikan `{ wouldFlip: [uid…] }` tanpa menulis. User menjalankan dry-run ke prod sebelum cron berikutnya.
2. `api/midtrans/create-transaction.js`: wajib header `Authorization: Bearer <Firebase ID token>`; `uid` dari `adminAuth().verifyIdToken()`, bukan body (tambah helper di `api/_firebaseAdmin.js`). Client `js/views/pricing.js payPlan` kirim `await auth.currentUser.getIdToken()`.
3. `api/midtrans/webhook.js`: `create-transaction` menulis `payments/{order_id}` `{ uid, planKey, amount, status: "pending", createdAt }`; webhook mencocokkan `planKey` + `amount` ke doc itu (bukan `custom_field2`) dan menolak kalau tidak ada / amount beda. `LEGACY_PLANS` hanya dihormati kalau doc pending-nya ada.
4. `js/main.js consumeWepekaToken`: kalau `auth.currentUser` ada dan uid-nya beda dari token yang masuk → `signOut` + `teardownApp()` + `storeReady = false` dulu. `boot()`: kalau `subscribedUid` berubah ke uid lain, reset `storeReady = false` sebelum `initStore`.

### FASE 1 — wepeka.com: Firebase Auth jadi satu-satunya login

**1.1 Schema** `supabase/migrations/20260924_members_firebase.sql` (+ RUN_ALL + APPLY_NOW):
```sql
alter table public.members add column if not exists firebase_uid text unique;
alter table public.members add column if not exists email_verified_at timestamptz;
alter table public.members alter column password_hash drop not null;  -- drop total di Fase 3
```
`src/lib/community/db.ts`: tambah `firebase_uid, email_verified_at` ke `MEMBER_COLUMNS` (baris ±261), ke `Member` type dan `toMember`; fungsi baru `getMemberByFirebaseUid(uid)`, `linkFirebaseUid(memberId, uid)`, `setEmailVerified(memberId)`; `createMember` menerima `firebaseUid` dan `passwordHash` opsional. Perbaiki `usernameTaken`/`getMemberByUsername` (±636-643): `.ilike` → `.eq("username", normalized)` (index sudah `lower(username)`), atau escape `_`/`%`.

**1.2 Kebijakan email** `src/lib/community/email-policy.ts` (baru, `server-only`):
- `normalizeEmail()` lowercase+trim; untuk gmail hapus titik dan `+tag` hanya untuk **cek duplikat** (alamat asli tetap disimpan).
- `isDisposableDomain()` dari paket `disposable-email-domains` (`npm i disposable-email-domains`) + daftar tambahan `disposable-extra.ts`.
- `hasMx(domain)` via `dns.promises.resolveMx`, timeout 3 detik, cache in-memory 1 jam, DNS gagal = tolak (fail-closed).
- `checkEmailPolicy(email) → { ok: true } | { error: "invalid" | "disposable" | "no_mx" }`.

**1.3 Endpoint pre-auth** (Node runtime, rate-limit per IP via `src/lib/rate-limit.ts`, dikecualikan di `src/proxy.ts` seperti `firebase-session` di baris ±75):
- `POST /api/community/register/precheck` `{ email, username }` → `checkEmailPolicy` + `getMemberByEmail` + `usernameTaken` → `{ ok }` / `{ error }`. Dipanggil client **sebelum** membuat user Firebase.
- `POST /api/community/register` `{ idToken, username, displayName, whatsapp, brandName }` → `verifyFirebaseIdToken` (varian yang **tidak** mensyaratkan verified; tambah param `requireVerified` di `src/lib/brandlab-account.ts verifyFirebaseIdToken`), ulangi policy + uniqueness, `createMember({ firebaseUid: uid, email, … })`. **Tidak** set cookie.
- `POST /api/community/firebase-session` (ubah `src/app/api/community/firebase-session/route.ts`): cari `getMemberByFirebaseUid(uid)`; tidak ada → fallback `getMemberByEmail` lalu `linkFirebaseUid` (member lama); tetap tidak ada → `404 { error: "no_member" }` (**jangan** auto-create lagi). Tetap wajib `email_verified === true`; saat lolos dan `emailVerifiedAt` null → `setEmailVerified`. Set cookie seperti sekarang.

**1.4 UI auth** (client, `firebase` sudah di package.json):
- `src/lib/community/firebase-client.ts` (baru, `"use client"`): `getFirebaseAuth()` lazy dari `src/lib/firebase-web.ts firebaseWebConfig()`; `signUpWithEmail`, `signInWithEmail`, `signInWithGoogle` (pindahkan dari `google-auth-button.tsx`), `sendVerification(user, next)` dengan `actionCodeSettings.url = ${origin}/community/auth/action?next=`, `resetPassword(email)`, `postSession(idToken)`.
- `src/components/community/auth-form.tsx` tulis ulang (bukan server action):
  - **Join**: precheck → `createUserWithEmailAndPassword` → `updateProfile({displayName})` → `sendEmailVerification` → `POST /register` → layar **"Cek email kamu"** (tombol kirim ulang; tombol "Sudah verifikasi, lanjut" = `user.reload()` + `getIdToken(true)` + `postSession`).
  - **Login**: `signInWithEmailAndPassword` → `!user.emailVerified` → layar "Cek email" yang sama → verified → `postSession` → `window.location.assign(next)`. `auth/invalid-credential` → "Email atau password salah"; `no_member` → ke `/community/join?email=` terisi.
  - **Google**: seperti sekarang; `no_member` → ke join dengan email+nama terisi (Google sudah verified, precheck tetap jalan untuk username).
  - Link "Lupa password?" → `/community/lupa-password` (halaman baru, `sendPasswordResetEmail`).
- `src/app/(store)/community/auth/action/page.tsx` (baru, client): `mode=verifyEmail` → `applyActionCode` → "Email terverifikasi" → `postSession` bila masih signed-in, kalau tidak → ke login; `mode=resetPassword` → `verifyPasswordResetCode` + `confirmPasswordReset`. Ini Action URL di Firebase Console.
- Copy baru `src/lib/community/copy.ts` namespace `auth` (id+en): `verifyTitle, verifyBody, resend, resent, alreadyVerified, disposable, noMx, noMember, forgot, resetTitle, resetSent, newPassword, passwordUpdated, verifiedTitle, …`.
- Profil `src/app/(store)/community/(members)/profile/page.tsx`: form "Ganti password" → komponen client `src/components/community/change-password.tsx` (`reauthenticateWithCredential` + `updatePassword`); hapus `changePasswordAction`. Akun Google-only → teks "Password diatur lewat Google".
- Hapus dari jalur aktif: `joinAction`, `loginAction`, `EMAIL_RE` (`actions.ts`), `mirrorMemberToFirebase` (`brandlab-account.ts`). `password.ts` dipertahankan sampai Fase 3 untuk skrip migrasi.

**1.5 Gate verifikasi member lama**
- `src/lib/community/session.ts requireMember()`: kalau `member.emailVerifiedAt` null → `redirect("/community/verify?next=…")`. Terapkan juga di `(members)/layout.tsx` dan `brandlab/connect`.
- Halaman `/community/verify` (client): sign-in Firebase (email+password / Google) → kirim verifikasi → setelah verified `postSession` (yang men-set `email_verified_at`). Untuk member hasil migrasi tanpa password (lihat 1.6 fallback) tawarkan tombol "Atur password" (reset email).
- `src/proxy.ts`: hanya tambah pengecualian endpoint pre-auth baru; gate sesungguhnya di `requireMember`.

**1.6 Skrip migrasi** `scripts/migrate-members-to-firebase.mjs` (jalankan lokal dengan service account dari `.env.local`, idempotent):
1. Tiap `members` row: `getUserByEmail`; ada → simpan `firebase_uid`; tidak ada → `importUsers` batch `hash: { algorithm: "STANDARD_SCRYPT", memoryCost: 16384, parallelization: 1, blockSize: 8, derivedKeyLength: 64 }`, `passwordHash = Buffer.from(hashHex, "hex")`, `passwordSalt = Buffer.from(saltHex, "utf8")` (Node `crypto.scrypt` default N=16384 r=8 p=1; salt dipakai sebagai string hex UTF-8, lihat `password.ts`). **Uji pada akun test dulu.** Kalau Firebase menolak parameter → fallback: buat user tanpa password, tandai di laporan, halaman `/community/verify` menawarkan "Atur password" (reset email sekaligus membuktikan kepemilikan).
2. Set `emailVerified: false` untuk semua user Firebase **tanpa** provider `google.com` (dicap verified tanpa bukti). Ini yang memaksa verifikasi sekali.
3. Tulis `firebase_uid` ke setiap row; laporkan email gagal (alias gmail duplikat, dsb.) untuk ditangani manual.

### FASE 2 — Brandlab hanya untuk yang bayar atau trial 30 hari

**2.1 Sumber kebenaran akses** (wpk-dp `src/lib/brandlab-db.ts`):
- `brandlabAccess(uid) → { state: "paid"|"trial"|"expired"|"none", account }` menggantikan `isBrandlabMemberEmail()`. Sync `members.is_brandlab` di `profile/page.tsx:43-53` dan hub `(members)/brandlab/page.tsx` pakai ini (by `firebase_uid`).
- `createTrialAccount(uid, email, displayName)` (Admin SDK, transaction): tolak kalau `accounts/{uid}` ada; ambil `meta/accountCounter`; tulis `{ uid, email, displayName, accountNumber, username: null, createdAt, plan: "trial", status: "active", brandLimit: 1, trialEndsAt: now + 30d, subscriptionExpiresAt: null, paidAt: null }` (pindahan `defaultAccount()` dari `js/account.js:39-57`).

**2.2 Klaim trial dari wepeka.com** (`src/app/(store)/community/brandlab-actions.ts claimTrialAction`):
- Wajib `emailVerifiedAt` + `firebaseUid` + `trialMissionDoneAt`; `createTrialAccount(...)`; `setTrialClaimed`; redirect `/brandlab/connect` (hapus `?offer=trial`).
- Copy "7 hari" → "30 hari" di `copy.ts` (namespace `brandlab`, `guide`), komentar `20260923_trial_mission.sql`.
- Hub `(members)/brandlab/page.tsx`: `paid`/`trial` → "Buka Brandlab" (+ sisa hari trial); `expired` → "Trial/paket habis" + tombol `/brandlab/connect?to=pricing`; `none` → misi → klaim.

**2.3 `/brandlab/connect`** (`src/app/(store)/brandlab/connect/route.ts`):
- Rate limit `brandlab-connect` 20/10 menit per IP. Wajib member + `emailVerifiedAt` + `firebaseUid` (null → `/community/verify`).
- `brandlabAccess`: `paid`/`trial` → mint token → handoff; `expired` + `?to=pricing` → mint token, handoff `#/sso?t=…&to=pricing`; `expired` tanpa itu / `none` → redirect `/community/brandlab`.
- `firebaseUidForMember` di `brandlab-account.ts` tidak lagi membuat user Firebase; `mintBrandlabToken(member)` pakai `member.firebaseUid` langsung.

**2.4 Brandlab client**:
- `js/account.js`: `ensureAccountDoc` → hanya `getDoc` (hapus transaction pembuatan); `TRIAL_DAYS = 30`; tambah `accessState(account)` dengan definisi bagian 5.
- `js/main.js onAccountChange`: `none`/`expired`/`readonly` → `teardownApp()` + `renderPricingScreen(root, { account, user, locked: true })` dengan banner "Data kamu aman, aktifkan paket untuk lanjut" / (none) "Klaim trial 30 hari di wepeka.com" → `${WEPEKA_SITE_URL}/community/brandlab`. App **tidak** dirender. `deactivated` tetap `lockedScreenHTML`. Hapus cabang `plan === "free"` (tercakup `expired`).
- `js/main.js consumeWepekaToken`: regex `^#\/sso\?t=([^&]+)(?:&to=([a-z]+))?` → setelah login, `to === "pricing"` → `location.hash = "#/pricing"`.
- `js/views/login.js` Google: `isNewUser` → `await result.user.delete()` (bukan hanya signOut) lalu redirect `WEPEKA_CONNECT_URL`. Email+password: `auth/invalid-credential` → pesan yang menyarankan "Lupa password" atau "Masuk lewat wepeka.com" (key i18n baru).
- `firestore.rules` `accounts`: `allow create: if false`; hapus bound `trialEndsAt` 7 hari (baris 17-26). `accountActive()` tetap.
- `js/i18n/*`: "7 hari" → "30 hari"; copy layar terkunci baru.
- Deploy: kode Brandlab dulu → verifikasi klaim trial server-side sudah live → **baru** deploy rules.

### FASE 3 — Bersih-bersih
- wpk-dp: hapus `password.ts`, `mirrorMemberToFirebase`, `isBrandlabMemberEmail`; migrasi `alter table members drop column password_hash` (setelah 1.6 terverifikasi); `getMemberByEmail` tidak mengembalikan hash.
- Admin `/admin/community/members`: tampilkan status verifikasi + `firebase_uid`. `/admin/brandlab/accounts` "Buat Akun Baru": buat user Firebase + member row + `accounts` doc sekaligus (Admin SDK).
- Update `AGENTS.md` (Community members area, Admin auth, tambah "Identity = Firebase Auth") dan `README.md` Brandlab (bagian Login salah total).
- `.env.example` kedua repo: hapus komentar mirror/`ADMIN_EMAILS`, tambah catatan Action URL.

## 7. Urutan rollout (ada dependensi lintas repo)

1. User: prasyarat bagian 4.
2. Fase 0 (Brandlab) → deploy → dry-run cron.
3. Fase 1.1 migrasi SQL → 1.2–1.5 kode → deploy wpk-dp.
4. Fase 1.6 skrip migrasi (akun test dulu, lalu semua).
5. Fase 2 wpk-dp → deploy.
6. Fase 2 Brandlab kode → deploy → **baru** rules.
7. Fase 3.

## 8. Checklist uji (manual, user yang ketik password)

- [ ] Daftar `x@mailinator.com` → ditolak di precheck, tidak ada user Firebase terbentuk.
- [ ] Daftar `a@contoh-tidak-ada.id` (tanpa MX) → ditolak.
- [ ] Daftar email asli → layar "Cek email"; sebelum klik link `/community/library` redirect ke verify; klik link → `wepeka.com/community/auth/action` → masuk, cookie ada.
- [ ] Login Google email belum terdaftar → join dengan email terisi → isi username → langsung masuk.
- [ ] Login Google email yang sudah daftar via password → masuk ke member yang sama (satu `firebase_uid`, tidak ada row baru).
- [ ] Member lama login → dipaksa verifikasi sekali → berikutnya tidak.
- [ ] Ganti password di profil → login Brandlab dengan password baru berhasil.
- [ ] `/brandlab/connect` tanpa trial → `/community/brandlab`; klaim → `accounts/{uid}` `trialEndsAt ≈ +30 hari`, Brandlab terbuka; set `trialEndsAt` lampau via console → Brandlab layar paket, app tidak render, data tetap ada.
- [ ] Brandlab login Google akun baru → user Firebase terhapus, diarahkan ke wepeka.com.
- [ ] `POST /api/midtrans/create-transaction` tanpa token → 401.
- [ ] Cron dry-run tidak berisi akun lifetime/trial aktif.
- [ ] wpk-dp: `npm run build`, `npx tsc --noEmit`, `npm run lint` bersih. Brandlab: `node --check` semua file yang disentuh, tidak ada error console di `#/login` dan `#/pricing`.

## 9. Progres

- [x] Fase 0
- [x] Fase 1.1 schema (migrasi SQL sudah dijalankan user di Supabase Dashboard, 20 Sep 2026)
- [x] Fase 1.2 email policy
- [x] Fase 1.3 endpoint
- [x] Fase 1.4 UI auth
- [x] Fase 1.5 gate verifikasi
- [x] Fase 1.6 skrip migrasi ditulis DAN sudah dijalankan live untuk semua member (20 Sep 2026, lihat addendum) — kode Fase 1 sendiri belum di-deploy
- [x] Fase 2.1–2.3 wpk-dp (kode — belum di-deploy)
- [x] Fase 2.4 Brandlab (kode — belum di-deploy, rules belum di-deploy sama sekali)
- [x] Fase 3 (kode + dokumentasi — migrasi drop `password_hash` DITULIS, belum dijalankan; lihat addendum)

## 10. Di luar scope (di-flag saja)
- Proxy AI server-side (API key di `settings/main` terbaca semua akun).
- `brandLimit`/kuota AI hanya client-side.
- Midtrans key asli, domain `brandlab.wepeka.com`, kepemilikan project Vercel.
- Rate limit in-memory per instance Vercel (pertimbangkan Upstash).

## Addendum — 20 Sep 2026, Fase 0 selesai

Semua 4 item Brandlab dikerjakan di repo `CONTENT PLANNER WEPEKA`, `node --check` bersih untuk semua file yang disentuh:

1. **`api/cron/check-expiry.js`** — guard `typeof acc.subscriptionExpiresAt === "number" && acc.plan !== "trial"` ditambahkan di loop `lapsedSubs`; endpoint sekarang menerima `?dryRun=1` → balas `{ ok: true, dryRun: true, wouldFlip: [uid…] }` tanpa menulis apa pun.
2. **`api/midtrans/create-transaction.js`** — `uid` sekarang wajib dari `Authorization: Bearer <Firebase ID token>` lewat `requireAuth()` (baru, di `api/_firebaseAdmin.js`, pakai `firebase-admin/auth`), bukan dari `req.body.uid`. Client `js/views/pricing.js payPlan` mengirim `await auth.currentUser.getIdToken()` di header; kalau tidak ada sesi, langsung diarahkan ke `#/login` tanpa memanggil endpoint.
3. **`api/midtrans/webhook.js`** — ditulis ulang: `create-transaction.js` sekarang menulis `payments/{order_id}` `{ uid, planKey, plan, amount, status: "pending", createdAt }` segera setelah Midtrans mengembalikan token. Webhook tidak lagi mempercayai `custom_field1`/`custom_field2` (keduanya tidak ikut ditandatangani Midtrans) — ia mencari `payments/{order_id}` (order_id ikut ditandatangani), menolak (`400`) kalau dokumen itu tidak ada, mencocokkan `gross_amount` ke `pending.amount`, lalu baru menjalankan transaction yang sama seperti sebelumnya (increment slot, set plan/status, dst.) dan mengubah status jadi `"paid"`. `LEGACY_PLANS` otomatis hanya bisa lewat kalau dokumen pending itu ada (yang untuk planKey legacy praktis tidak pernah terjadi lagi dari jalur ini).
4. **`js/main.js`** — `consumeWepekaToken()`: decode klaim `uid` dari custom token (base64 JWT payload, tanpa verifikasi signature — hanya untuk deteksi) sebelum sign-in; kalau `auth.currentUser` ada dan uid-nya beda dari token yang masuk → `logout()` + `teardownApp()` + `storeReady = false` + `subscribedUid = null` dulu. `boot()`: kalau `subscribedUid` berubah ke uid lain (tanpa lewat `user === null`), `storeReady` di-reset ke `false` sebelum masuk cabang `initStore` di `onAccountChange`.

**Sudah diuji (otomatis, bukan lewat browser):** `node --check` semua 6 file yang disentuh; smoke test lokal `handler()` `create-transaction.js` dengan request tanpa header `Authorization` dan dengan token palsu → keduanya `401` (script tidak disimpan, dijalankan sekali dari scratchpad).

**Belum diuji (butuh env Vercel / akun uji, sesuai aturan Claude tidak boleh mengetik password):**
- Item checklist bagian 8 yang relevan Fase 0: `POST /api/midtrans/create-transaction` tanpa token → 401 (diverifikasi via smoke test, belum lewat browser asli dengan Firebase yang jalan), dan "Cron dry-run tidak berisi akun lifetime/trial aktif" — user perlu deploy dulu lalu jalankan `?dryRun=1` ke prod.
- Pembayaran end-to-end (Midtrans key masih placeholder, lihat bagian 4) belum bisa diuji sama sekali sampai key asli diisi.
- Belum ada percobaan nyata "buka token SSO untuk akun lain saat sudah login akun lain" di browser — logikanya baru diverifikasi lewat pembacaan kode, bukan klik nyata.

**Lanjutan:** mulai Fase 1 (`wepeka.com`: Firebase Auth jadi satu-satunya login) sesuai bagian 6 & 7.

## Addendum — 20 Sep 2026, Fase 1 (1.1–1.6) selesai di kode, wpk-dp

Semua sub-fase 1.1–1.6 dikerjakan di repo `wpk-dp`. `npx tsc --noEmit`, `npm run lint`, `npm run build` bersih total (26 route, termasuk semua yang baru). Diff hanya menyentuh file-file di bawah — tidak ada perubahan di luar scope Fase 1.

**1.1 Schema + data layer:**
- Migrasi baru `supabase/migrations/20260926_members_firebase.sql` (juga di-append ke `RUN_ALL.sql` + `APPLY_NOW.sql`, item ke-9): `members.firebase_uid` (unique), `members.email_verified_at`, `password_hash` jadi nullable.
- `src/lib/community/db.ts`: `Member.firebaseUid`/`emailVerifiedAt` baru; `getMemberByFirebaseUid`, `linkFirebaseUid`, `setEmailVerified` baru; `createMember` terima `firebaseUid`/`emailVerified` opsional, `passwordHash` opsional (default null — member baru tidak pernah dapat hash asli lagi). `usernameTaken`/`getMemberByUsername`: `.ilike` → `.eq` pada username yang dinormalisasi (bug wildcard `_`/`%` di AGENTS.md ikut kebenerin).

**1.2 Email policy** — `src/lib/community/email-policy.ts` (baru): `checkEmailPolicy()` = regex + `isDisposableDomain()` (paket `disposable-email-domains`, ditambahkan ke `package.json`) + `hasMx()` (DNS MX lookup, timeout 3 detik fail-closed, cache in-memory 1 jam). `normalizeEmail()` ada tapi **catatan jujur**: bentuk canonical Gmail (hapus titik/`+tag`) cuma dipakai untuk keperluan lokal — dedup-check yang jalan di precheck/register tetap pakai `getMemberByEmail` biasa (exact match), karena mendeteksi alias Gmail lintas-row butuh kolom canonical terindeks yang belum ada di schema. Bukan bug, tapi juga bukan proteksi penuh terhadap alias Gmail — di luar scope Fase 1 kalau mau dibuat lebih ketat.

**1.3 Endpoint pre-auth** (dikecualikan dari cookie-guard di `src/proxy.ts`, masing-masing rate-limited sendiri):
- `POST /api/community/register/precheck` — cek awal (email + username) sebelum bikin user Firebase.
- `POST /api/community/register` (baru) — bikin row `members` untuk Firebase user yang baru dibuat client. **Tidak** set cookie. `verifyFirebaseIdToken` di `src/lib/brandlab-account.ts` dapat param baru `requireVerified` (default `true`; `false` di sini saja).
- `POST /api/community/firebase-session` ditulis ulang total: cari `getMemberByFirebaseUid`, fallback `getMemberByEmail` + `linkFirebaseUid` untuk member lama, kalau tetap tidak ada → `404 no_member` (**tidak lagi auto-create**). `emailVerifiedAt` di-set saat lolos.

**1.4 UI auth** — semua client-driven ke Firebase langsung (bukan server action lagi):
- `src/lib/community/firebase-client.ts` (baru): `getFirebaseAuth`, `signUpWithEmail`, `signInWithEmail`, `signInWithGoogle`, `sendVerification`, `resetPassword`, `postSession`.
- `src/components/community/auth-form.tsx` ditulis ulang: join = precheck → createUser → sendEmailVerification → POST /register → layar "cek email" (resend / "sudah verifikasi, lanjut"); login = signIn → cek `emailVerified` → layar sama atau langsung `postSession`; `no_member` (login maupun Google) → redirect ke `/community/join` dengan email(+nama) terisi.
- `src/components/community/google-auth-button.tsx` ditulis ulang pakai `firebase-client.ts`.
- Halaman baru: `/community/auth/action` (verify-email + reset-password link handler — **Action URL di Firebase Console WAJIB diarahkan ke sini**, lihat prasyarat bagian 4), `/community/lupa-password` (`ResetPasswordForm`, selalu bilang "terkirim" tanpa membocorkan email terdaftar atau tidak — **butuh "Email enumeration protection" ON**), `/community/verify` (dipakai Fase 1.5, isinya reuse `<AuthForm mode="login">`).
- Profil: form ganti password lama (`changePasswordAction`, server action) **dihapus**; diganti `ChangePasswordForm` (client, `reauthenticateWithCredential` + `updatePassword`), otomatis menampilkan pesan "diatur lewat Google" untuk akun Google-only.
- `joinAction`/`loginAction`/`EMAIL_RE`/`mirrorMemberToFirebase` **dibiarkan ada** (tidak dipanggil lagi dari UI) sesuai rencana — baru benar-benar dihapus di Fase 3.
- Copy baru lengkap (ID+EN): `auth.verify.*`, `auth.forgotPassword`, `auth.errors.{disposable,no_mx,closed,no_member}`, namespace `resetPassword`, `authAction`, `verifyGate`, `profile.passwordGoogleOnly`, `profile.passwordReloginNotice`, `profile.errors.invalid`.

**1.5 Gate verifikasi** — `requireMember()` (`session.ts`) redirect ke `/community/verify` kalau `emailVerifiedAt` null (sebelum cek member null, sama seperti spek). Guard yang sama ditambahkan manual di `(members)/layout.tsx` (pakai `getMember()` langsung) dan `brandlab/connect/route.ts`.

**1.6 Skrip migrasi** — `scripts/migrate-members-to-firebase.mjs` (baru): baca `.env.local` sendiri (tanpa dependency baru), `--dry-run` dan `--only=<email>` untuk uji aman. Per member: link ke Firebase user yang sudah ada (by email) atau `importUsers` bawa hash scrypt asli (`STANDARD_SCRYPT`, uid deterministik dari member id biar idempotent); baris yang ditolak Firebase di-retry sekali tanpa password. Di akhir, sapu semua Firebase user tanpa provider `google.com` → paksa `emailVerified: false`.

**Sudah diuji:**
- `tsc`/`lint`/`build` bersih.
- Smoke test browser (dev server lokal, Firebase project asli) untuk `/community/join`, `/login`, `/lupa-password`, `/verify`, `/auth/action` (mode `verifyEmail` & `resetPassword` dengan `oobCode` palsu) — semua render benar, tidak ada error console, dan jalur gagal (`applyActionCode`/`verifyPasswordResetCode` menolak oobCode palsu) benar-benar memanggil Firebase asli dan menampilkan layar error yang tepat.
- Precheck disposable-email diuji end-to-end lewat browser (`test@mailinator.com` → `{ok:false,error:"disposable"}` → banner error tampil benar di form).
- Dry-run `scripts/migrate-members-to-firebase.mjs --dry-run` terhubung ke Supabase asli dan gagal tepat di titik yang diharapkan: kolom `firebase_uid` belum ada (migrasi SQL belum dijalankan) — mengonfirmasi kredensial & query script benar, bukan bug.

**Belum diuji (butuh migrasi SQL live + akun sungguhan, Claude tidak boleh mengetik password):**
- Alur signup/login/verify email penuh dengan email sungguhan (klik link asli).
- Google sign-in sampai selesai (popup OAuth).
- `scripts/migrate-members-to-firebase.mjs` jalan sungguhan (dry-run maupun live) — **baru bisa setelah `APPLY_NOW.sql` dijalankan di Supabase Dashboard**.
- Checklist bagian 8 yang butuh password: semuanya, sesuai aturan main.

**Update 20 Sep 2026, sore — migrasi SQL + skrip 1.6 sudah dijalankan live (bukan cuma dry-run):**
- User menjalankan `20260926_members_firebase.sql` di Supabase Dashboard SQL Editor. Dikonfirmasi lewat `--dry-run` yang langsung berhasil connect (sebelumnya gagal dengan `42703 column does not exist`).
- `scripts/migrate-members-to-firebase.mjs` dijalankan dua kali: `--only=marchelnich@gmail.com` dulu (satu-satunya baris yang lewat jalur "buat user Firebase baru" — jalur paling berisiko, karena bawa hash scrypt asli), diverifikasi manual (row Supabase dapat `firebase_uid`, user Firebase baru punya provider `password`, `emailVerified: false`) — baru lanjut full run tanpa filter untuk 3 sisanya (semua jalur "link ke user Firebase yang sudah ada", termasuk akun tim `wepekapparel@gmail.com` yang tidak diubah plan/status Firestore-nya, cuma ditautkan `firebase_uid`-nya).
- Hasil akhir, 4/4 member: `firebase_uid` terisi, `email_verified_at` masih null untuk semua (memang belum ada yang klik link verifikasi — itu benar, bukan bug), 0 gagal.
- **Kode Fase 1 (1.2–1.5) sendiri BELUM di-commit/push/deploy** — jadi urutan ini justru lebih aman dari yang dikhawatirkan di atas: migrasi data selesai duluan, sebelum `requireMember()`'s gate ke `/community/verify` benar-benar hidup di production, jadi tidak ada jeda di mana member ke-lock-out. Situs production saat ini masih jalan kode lama dan tidak peduli kolom `firebase_uid`/`email_verified_at` yang baru.

**Sebelum deploy kode Fase 1 ke production, masih perlu:**
- Firebase Console → Authentication → Settings → **Email enumeration protection: ON** (dipakai `/community/lupa-password` supaya tidak bocorin email terdaftar).
- Firebase Console → Authentication → Templates → **Action URL = `https://www.wepeka.com/community/auth/action`** (tanpa ini, link verifikasi/reset akan mendarat di halaman hosted Firebase, bukan di app).
- Env var `FIREBASE_ADMIN_*`/`NEXT_PUBLIC_FIREBASE_*` di Vercel production (lokal sudah lengkap).
- Commit + push + deploy kode Fase 1 (belum dilakukan — nunggu instruksi eksplisit user, sesuai aturan main bagian 1).

**Lanjutan:** setelah prasyarat di atas + deploy dikonfirmasi, lanjut Fase 2 (Brandlab hanya untuk yang bayar/trial 30 hari) sesuai bagian 6 & 7.

## Addendum — 20 Sep 2026, Fase 2 (2.1–2.4) selesai di kode, kedua repo

Semua sub-fase dikerjakan. wpk-dp: `tsc`/`lint`/`build` bersih (termasuk fix react-hooks/purity yang ketemu lint di hub page). Brandlab: `node --check` bersih di semua file yang disentuh. **Tidak ada yang di-deploy** (kode maupun `firestore.rules`) — semuanya masih di working tree lokal.

**2.1 Sumber kebenaran akses** — `src/lib/brandlab-db.ts`: `BrandlabPlan` diperluas (dulu cuma 5 nilai lama, sekarang + `trial`/`starter`/`pro`/`studio`/`founder`/`founder-ultimate` biar cocok sama `api/_plans.js` Brandlab yang sebenarnya — tanpa ini banyak akun akan salah diklasifikasi). `BrandlabAccount.trialEndsAt` baru. `brandlabAccess(uid)` + `createTrialAccount(uid,email,displayName)` baru, persis definisi bagian 5. Efek samping yang ikut kebenerin karena perluasan `BrandlabPlan`: `PLAN_LABEL` (`brandlab-labels.ts`) dan breakdown-per-paket di `/admin/brandlab/overview` — dulu cuma tahu 4 paket lama, sekarang semua paket masuk hitungan "akun berbayar" (trial dipisah ke barisnya sendiri, bukan ikut kehitung "sudah bayar").

**2.2 Klaim trial** — `brandlab-actions.ts#claimTrialAction`: sekarang wajib `emailVerifiedAt`+`firebaseUid` (redirect ke `/community/verify` kalau belum), lalu `createTrialAccount()` (idempotent — kalau `accounts/{uid}` sudah ada duluan dari sebelum Fase 2, dilewati saja, tidak error) baru `setTrialClaimed`, redirect ke `/brandlab/connect` polos (tanpa `?offer=trial` — mekanisme `offer` diganti total oleh `to=pricing`, lihat 2.3). Hub `(members)/brandlab/page.tsx` ditulis ulang total pakai `brandlabAccess()`: paid/trial → "Buka Brand Lab" (+ sisa hari trial kalau trial), expired → banner + tombol `/brandlab/connect?to=pricing`, none → alur misi lama. Semua copy "7 hari" di namespace `brandlab` (ID+EN) jadi "30 hari".

**2.3 `/brandlab/connect`** — ditulis ulang: rate limit 20/10 menit per IP, wajib `emailVerifiedAt`+`firebaseUid`, pakai `brandlabAccess()` buat cabang paid/trial (mint token, handoff biasa) vs expired+`?to=pricing` (mint token, handoff `&to=pricing`) vs expired-tanpa-itu/none (redirect `/community/brandlab`, **tidak** mint token sama sekali). `brandlab-account.ts`: `firebaseUidForMember` (yang dulu bisa bikin user Firebase baru) **dihapus total** — `mintBrandlabToken` sekarang langsung pakai `member.firebaseUid` yang sudah pasti ada (dijamin gate di atas). `brandlabHandoffUrl`'s param `offer` diganti `to` (satu-satunya nilai yang dipakai: `"pricing"`).

**2.4 Brandlab client** (repo `CONTENT PLANNER WEPEKA`):
- `js/account.js`: `TRIAL_DAYS = 30`. `ensureAccountDoc` dikosongkan jadi cuma `getDoc` — `defaultAccount()` dan transaction pembuatannya **dihapus total** (klien tidak pernah bikin `accounts/{uid}` lagi). `accessState(account)` baru, definisi identik `brandlabAccess()` di wpk-dp.
- `js/main.js`: `onAccountChange` ditulis ulang — `isDeactivated` tetap dapat `lockedScreenHTML` sendiri; state `none`/`expired` (gabungan, dari `accessState()`) dapat `renderPricingScreen(..., {locked:true})`, **tidak ada lagi mode baca-saja di dalam app** untuk akun yang trial/langganannya habis (beda dari perilaku lama yang masih render app-nya). `consumeWepekaToken`: regex nambah grup `&to=`, kalau `to==="pricing"` set `location.hash = "#/pricing"` setelah login.
- `js/views/pricing.js`: `render()` terima opsi `locked` baru; kalau true tampilkan `lockedBannerHTML()` (banner beda buat "none" — ajak klaim trial di wepeka.com, link ke `/community/brandlab` — vs "expired" — cuma bilang datanya aman). `accountBarHTML` dipindah ke `accessState()`. CSS `.pricing-locked-banner` baru di `css/styles.css`.
- `js/auth.js`: `loginWithGoogle()` — akun Google baru sekarang di-**delete** (`result.user.delete()`), bukan cuma `signOut`, biar tidak nyangkut selamanya sebagai user Firebase kosong tanpa akun.
- `js/views/login.js`: error `auth/invalid-credential`/`wrong-password`/`user-not-found` sekarang dapat pesan baru yang eksplisit nyaranin "Lupa password?" atau tombol "Lanjut pakai akun Wepeka" di layar yang sama (key i18n baru `auth.err.wrongCredentialsHint`).
- `firestore.rules`: `accounts` → `allow create: if false` (dulu ada bound 7-hari, sekarang klien tidak boleh bikin sama sekali). `meta/accountCounter` ikut dikunci (`allow write: if false`) karena satu-satunya penulis client-side-nya (`ensureAccountDoc`'s transaction) sudah hilang.
- Bonus kebenaran yang ikut diperbaiki karena TRIAL_DAYS berubah (bukan disengaja dicari, ketemu waktu grep "7 hari"): copy AI-usage total-pool trial ("7-day" → "30-day", di `js/i18n/app-shell.js` + komentar `js/ai-usage.js`), komentar dokumentasi di kepala `js/views/pricing.js` yang sudah tidak akurat (sempat bilang Brandlab masih punya alur sign-up sendiri — sudah tidak, sejak sebelum sesi ini).

**Perlu keputusan produk (belum saya putuskan sendiri):** jatah AI credit trial (`PLAN_QUOTA.trial.limit` di `js/ai-usage.js`) masih **60**, angka yang dipilih untuk trial 7 hari. Sekarang trialnya 4x lebih panjang (30 hari) tapi jatah AI-nya sama — mungkin perlu dinaikkan biar sepadan, tapi ini keputusan bisnis/biaya yang saya tidak ambil sendiri.

**Sudah diuji:**
- `tsc`/`lint`/`build` bersih (wpk-dp), `node --check` bersih (Brandlab, semua file yang disentuh).
- **Browser, data production asli** (`http://localhost:8743`, akun tim `wepekapparel@gmail.com`, plan `lifetime`, read-only — tidak ada tombol dipencet/data ditulis): `#/pricing` menampilkan "Current plan: lifetime" lewat `accessState()`/`accountBarHTML()` yang baru, tanpa error console; `#/` (daftar brand) render normal — mengonfirmasi jalur "paid" di `onAccountChange` yang baru tidak regresi untuk akun yang sudah bayar.

**Belum diuji (butuh akun trial/expired sungguhan atau login, sesuai aturan main):**
- Layar locked (`locked:true`, state "none" dan "expired") — butuh akun yang benar-benar belum/sudah habis trial-nya; saya sengaja tidak memalsukan status akun asli manapun (termasuk akun tim) buat memicu ini.
- `claimTrialAction` end-to-end (misi trial → klaim → `createTrialAccount` → `/brandlab/connect` → masuk app dengan `plan:"trial"`).
- Google sign-in akun baru → benar-benar ke-delete (bukan cuma sign-out).
- Pesan `auth.err.wrongCredentialsHint` saat login salah password.
- `/brandlab/connect?to=pricing` end-to-end dari hub wepeka.com.

**⚠️ Sebelum deploy Fase 2:**
- Deploy kode Brandlab **dan** wpk-dp dulu bersamaan (keduanya saling bergantung: hub wepeka.com sekarang panggil `createTrialAccount`, Brandlab sekarang mengasumsikan tidak ada lagi trial yang dibuat sendiri).
- **Baru setelah itu** deploy `firestore.rules` — persis urutan yang direncanakan di bagian 6 ("verifikasi klaim trial server-side sudah live → baru deploy rules"), supaya tidak ada jendela waktu di mana rules sudah menolak `create` tapi kode lama (yang masih mencoba bikin sendiri) masih live.
- Member yang SUDAH pernah masuk Brandlab sebelum Fase 2 (accounts/{uid} sudah ada, entah plan `free`/lain) akan otomatis masuk kategori "expired" begitu kode ini live — itu benar sesuai definisi bagian 5, tapi berarti mereka langsung lihat layar locked, bukan app, sampai klaim trial atau bayar. Kabari member lama soal ini kalau perlu.

**Lanjutan:** setelah kode Fase 1+2 dan `firestore.rules` dikonfirmasi jalan (deploy + test manual), lanjut Fase 3 (bersih-bersih: hapus `password.ts`, `mirrorMemberToFirebase`, `isBrandlabMemberEmail`, `joinAction`/`loginAction`/`EMAIL_RE`, drop kolom `password_hash`, dst — bagian 6).

## Addendum — 20 Sep 2026, Fase 3 (bersih-bersih) selesai di kode, kedua repo

`tsc`/`lint`/`build` bersih (wpk-dp). **Migrasi drop kolom belum dijalankan** (lihat peringatan di bawah) — kalau itu belum jalan, semua kode ini tetap kompatibel dengan kolom `password_hash` yang masih ada tapi sudah tidak dibaca/ditulis sama sekali oleh kode manapun.

**wpk-dp — dihapus total (bukan cuma "berhenti dipanggil" seperti Fase 1):**
- `src/lib/community/password.ts` (file dihapus) — `hashPassword`/`verifyPassword` tidak dipakai lagi di mana pun.
- `joinAction`, `loginAction`, `EMAIL_RE`, `passwordField`, `ipLimited`, dan import-import yang cuma dipakai keduanya (`createMember`/`getMemberByEmail`/`defaultAvatarFor`/`mirrorMemberToFirebase`/`clientIp`/`headers`/dll) — semua dihapus dari `community/actions.ts`. File itu sekarang cuma punya `logoutAction` tersisa dari area auth (join/login penuh di client, lihat Fase 1).
- `mirrorMemberToFirebase` (`brandlab-account.ts`) dan `isBrandlabMemberEmail` (`brandlab-db.ts`) — dihapus total, sudah tidak dipanggil dari mana pun sejak Fase 1/2.
- `updateMemberPassword` (`db.ts`) — dihapus, tidak ada pemanggil lagi setelah `ChangePasswordForm` (Fase 1) berpindah ke Firebase langsung.
- `getMemberByEmail` sekarang select `MEMBER_COLUMNS` (bukan `"*"`) dan return `Member` polos — tidak ada lagi field `passwordHash` yang ikut kebawa. `createMember` sekarang wajib `firebaseUid` (tidak ada lagi jalur tanpa itu).
- Migrasi baru `supabase/migrations/20260927_drop_password_hash.sql` (juga di `RUN_ALL.sql`/`APPLY_NOW.sql` sebagai item ke-10) — `alter table members drop column if exists password_hash`.

**wpk-dp — admin:**
- `/admin/community/members`: badge "Unverified" (kalau `email_verified_at` null) + baris `firebase: <uid>` (atau "no Firebase uid yet" kalau belum migrasi) di tiap kartu member.
- `/admin/brandlab/actions.ts#createAccountAction`: sekarang, setelah bikin user Firebase + `accounts/{uid}`, JUGA bikin (atau link ke yang sudah ada by email) baris `members` Supabase — akun yang dibuat admin langsung jadi akun Wepeka penuh, bukan cuma Brandlab. Best-effort, tidak pernah gagalkan pembuatan akun Brandlab-nya kalau bagian Community-nya error.

**Bug regresi yang ketemu & dibenerin sambil jalan (bukan diminta eksplisit, tapi konsekuensi langsung dari kode Fase 1):** alur join baru (client-driven, Fase 1) ternyata TIDAK membawa member baru ke `/community/mulai` (panduan XP/koin) dulu sebelum ke tujuan akhirnya — beda dari `joinAction` lama yang selalu mampir ke sana. Ketemu waktu mengecek komentar basi yang menyebut `joinAction`. Dibenerin di `AuthForm`'s `handleContinue`: redirect ke `/community/mulai?next=...` khusus untuk `mode==="join"`, member lama yang verifikasi lewat `/community/verify` (mode "login") tetap langsung ke tujuan seperti sebelumnya.

**Dokumentasi:**
- `AGENTS.md`: bagian "Community members area" ditulis ulang — "Identity = Firebase Auth" dijelaskan lengkap (join key `firebase_uid`, gate verifikasi, siapa yang boleh bikin baris `members`). Bagian "Admin auth" dapat catatan soal `createAccountAction` yang baru. Referensi basi ke `isBrandlabMemberEmail()` dan `password_hash` di bagian lain (Schema 20260920, Conventions added) ikut dibenerin.
- `README.md` Brandlab: bagian "Login" ditulis ulang total (sebelumnya bilang ini "local access lock" localStorage-only — sudah SANGAT tidak akurat, aplikasinya sudah pakai Firebase Auth+Firestore+Midtrans sejak lama). **Catatan jujur:** sisa README ini (deskripsi "Plain HTML/CSS/JS... semua data di localStorage" di baris 1-5, dan beberapa bagian lain) masih menggambarkan versi prototipe yang jauh lebih lama dan TIDAK saya sentuh — di luar scope Fase 3 yang cuma minta bagian Login. Kalau mau README-nya akurat total perlu sesi terpisah.
- `.env.example` kedua repo: wpk-dp — hapus komentar `ADMIN_EMAILS` (tidak relevan, soal admin dashboard bukan member auth), komentar `NEXT_PUBLIC_FIREBASE_*` dan `FIREBASE_ADMIN_*` ditulis ulang biar akurat (dulu bilang "cuma buat tombol Google", sekarang jelasin ini seluruh identitas Community) + instruksi Action URL/enumeration protection dipindah ke sini juga. Brandlab — sudah dicek, tidak ada komentar "mirror" atau `ADMIN_EMAILS` yang perlu dihapus (mungkin sudah tidak ada dari awal).

**Belum diuji:** migrasi drop kolom (sengaja belum dijalankan — nunggu konfirmasi eksplisit karena ini destruktif/tidak bisa dibalik), `createAccountAction` yang baru end-to-end (butuh login admin), badge Unverified di `/admin/community/members` (butuh login admin).

**Fase 3 = fase terakhir di rencana ini.** Semua kode (Fase 0–3) sekarang ada di working tree kedua repo, belum ada yang di-commit/push/deploy. Ringkasan apa yang masih perlu dilakukan sebelum production benar-benar pakai sistem baru ini:
1. Firebase Console: Action URL + Email enumeration protection (bagian 4).
2. Vercel: isi env var `FIREBASE_ADMIN_*`/`NEXT_PUBLIC_FIREBASE_*` di production.
3. Commit + push + deploy kode wpk-dp DAN Brandlab bersamaan (saling bergantung, lihat addendum Fase 2).
4. Setelah kode live dan klaim trial server-side dikonfirmasi jalan → baru deploy `firestore.rules` Brandlab.
5. Setelah SEMUA di atas jalan lancar → jalankan migrasi `20260927_drop_password_hash.sql` di Supabase Dashboard (cek dulu `scripts/migrate-members-to-firebase.mjs --dry-run` menunjukkan 0 member tanpa `firebase_uid`).
