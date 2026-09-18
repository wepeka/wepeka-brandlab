# Plan: Campaign sebagai lapisan orkestrasi ("Completion Paths")

Tanggal: 15 Sep 2026. Status: **analisis + desain, belum ada kode**. Dibuat setelah audit menyeluruh `js/views/campaigns.js`, `js/store.js`, `js/views/creator.js`, `content-editor.js`, `calendar.js`, `content-list.js`, `dashboard.js`, `sales.js`, `instagram*.js`, `formulas.js`, `proactive-notif.js`, `consultant-panel.js`, `ai.js`, `main.js`, `beginner-home.js`, `brand-home.js`, `guides/*`.

Prinsip yang diminta user: setiap goal/milestone/task campaign harus punya jalur jelas untuk **diperbarui** dan **diperbaiki**; satu sumber kebenaran per angka; navigasi lintas fitur membawa konteks; penyelesaian otomatis kalau sistem bisa memverifikasi; UI tetap sederhana.

---

## 0. Ringkasan (baca ini dulu)

**Diagnosis.** Campaign hari ini adalah *daftar angka yang diketik*, bukan lapisan yang memahami hubungan. Akar masalahnya satu: milestone menyimpan `kind` + `label` + `value`, bukan **sumber data**. Akibatnya app menebak sumber lewat label ("Followers" → Instagram, "Shares" → performa konten), angka followers tidak punya rumah selain di dalam milestone, angka disalin ke lima level, dan tiap milestone tampil sebagai kotak input kosong.

**Solusi inti (satu keputusan arsitektur, sisanya turunan):**

1. **Metric Source Registry** — tiap milestone menunjuk `metric` (mis. `profile.followers`, `content.published`, `content.metric:shares`, `manual.number`). Registry tahu cara membaca angkanya, dari fitur mana, kapan terakhir diperbarui, tombol apa untuk *update* dan tombol apa untuk *improve*. Milestone tidak pernah menyimpan angka yang bisa dibaca dari tempat lain.
2. **Brand Insights** — `brand.insights.instagram = { followers, reach, profileVisits, updatedAt, source }` + riwayat ringkas. Satu tempat untuk angka profil, diisi manual (modal "Perbarui Insights") atau API (akun admin). Campaign membaca dari sini.
3. **Next Action engine** — fungsi murni `nextActions(brand, campaign, content, settings)` yang menghasilkan 1 aksi utama + 2 sekunder. Dipakai kartu "Langkah berikutnya" di detail campaign, kartu campaign di Beranda Pemula, banner proaktif, dan snapshot Consultant. Menggantikan teks "Minggu ini: …" yang hard-coded.
4. **Nav context** — `go(hash, ctx)` menyimpan `{ from, campaignId, missionId, phaseId, contentId, intent }` satu slot di sessionStorage (pola yang sudah ada untuk tur). Creator/Kalender/Quick Fill membaca dan langsung membuka hal yang dimaksud; chip "← Kembali ke campaign" di topbar selama konteks hidup.
5. **Auto-complete by default** — milestone otomatis kecuali sumbernya `manual.*`. Naik level otomatis saat semua target + minimal minggu tercapai. Angka manual dicatat lewat satu tombol "Catat angka" (sheet), bukan 8 input di halaman.

**Yang dihapus/digabung:** pohon SVG milestone, input angka per baris, tombol "Sinkron dari IG"/"Hitung dari konten", copy-forward nilai antar level, tiga renderer milestone (mission/event/phase) → satu, teks "Minggu ini" hard-coded, aturan campaign di `proactive-notif.js` (pindah ke engine).

**Urutan eksekusi:** 5 tahap (§10). Tahap 1–2 sudah memberi 80% nilai (registry + insights + next action + layout baru). Tahap 3 (nav context) yang membuat "satu klik ke alat yang benar" terasa.

---

## 1. Apa yang ada sekarang (fakta, dengan referensi)

### 1.1 Tiga sistem campaign, tiga UI, tiga logika milestone

| Jenis | Data | Milestone | UI | Cara selesai |
|---|---|---|---|---|
| **Mission ladder** (Grow Social, Grow Personal) | `campaign.missions[]` 5 level, `autoLinkAllContent` | `kind`: `auto`, `auto-weeks`, `auto-er-count`, `number`, `check` (`store.js:1144`) | pohon SVG + tangga + 8–15 baris input (`campaigns.js:940-1345`) | ketik angka, centang, klik "Lanjut ke Level Berikutnya" (`campaigns.js:1437`) |
| **Event** | `campaign.eventPlan.phases[]` berjendela tanggal | `auto` (hitung konten by `createdAt` di jendela), `check`, `number` (`store.js:1611`) | timeline pill + baris input (`campaigns.js:1628-1738`) | ketik/centang; fase jalan sendiri by tanggal |
| **Custom/phase** (belum bisa dibuat dari UI) | `campaign.phases[]` 7 fase tetap | teks bebas + checkbox (`campaigns.js:1960`) | journey node + panel (`campaigns.js:1894-2092`) | centang manual |

### 1.2 Sumber data hari ini

| Angka | Di mana disimpan | Cara masuk | Timestamp | Ditampilkan? |
|---|---|---|---|---|
| Followers | **hanya** `missions[i].milestones[j].value` label "Followers" | ketik manual, atau API (`getAccountProfile`, admin saja) (`campaigns.js:1253`) | `milestone.updatedAt`, `campaign.igFollowersSyncedAt` | tidak pernah (`campaigns.js:1338` hanya label "Terisi otomatis") |
| Reach / profile visits akun | **tidak ada** untuk akun non-API | — | — | Dashboard "Account Overview" hanya kalau API, tidak dipersist (`dashboard.js:535`) |
| Shares / Saves | disalin ke milestone dari `contentMetricTotal` (`campaigns.js:1238`) | per-konten manual/OCR/API | `milestone.updatedAt` | tidak |
| Konten terbit | dihitung live | — | — | ya |
| Minggu aktif | dihitung live dari `publishedDate` | — | — | ya |
| Video ER > 10% | dihitung di view; **stub di store selalu 0** (`store.js:1166`) → Consultant baca 0 | — | — | ya (view) |
| DM / komentar bermakna / kolaborasi / dll | ketik manual | — | `updatedAt` | tidak |
| Sales / leads | **tidak ada** (`sales.js` = "Coming soon") | — | — | — |

### 1.3 Hubungan konten ↔ campaign

- Konten hanya punya `campaignId` + `campaignPhaseId`. **Tidak ada** `missionId`/`milestoneId` (`store.js:582-634`).
- Grow Social `autoLinkAllContent`: semua konten brand dihitung, **termasuk ide dan draft** untuk milestone "Konten orisinal terbit" (`store.js:1147-1150` pakai `content.length`). Label bilang "terbit", angka menghitung draft. Bug.
- Event `auto`: menghitung konten **apa pun** yang `createdAt`-nya di jendela fase, tanpa cek `campaignId` atau status (`store.js:1615`). Bug serupa.
- Brainstorm menyimpan ide dengan `campaignId` lalu pindah ke Creator **tanpa memilih** ide itu (`campaigns.js:1587`) → Creator memilih item pertama sembarang.
- Consultant "Buatkan draft" membuat konten **tanpa** `campaignId` (`consultant-panel.js:209`).
- Content Editor tetap menampilkan dropdown fase untuk campaign ladder (`content-editor.js:120-132`), Creator sudah menyembunyikannya.

### 1.4 Navigasi

- Route hash tanpa query, regex anchored (`main.js:24-49`). Tidak ada mekanisme "buka X dengan konteks Y lalu kembali ke Z". Satu-satunya kanal: sessionStorage untuk tur (`guides/common.js:15`).
- Deep link ke **satu campaign** dari luar halaman campaign hanya ada satu: banner proaktif untuk angka basi (`proactive-notif.js:88`). Beranda Pemula, Beranda Pro, widget, Consultant (`CONSULTANT_ROUTES` tanpa `campaign:id`), semua mengarah ke **daftar** campaign.
- Tidak ada back link kontekstual; detail campaign hanya punya "Semua campaign".

### 1.5 "Langkah berikutnya" hari ini

- Beranda Pemula: kartu Campaign hanya dua state, dua-duanya ke daftar (`beginner-home.js:80-82`).
- Detail campaign Guided: teks "Minggu ini: terbitkan 2–3 konten, lalu isi angka Followers…" hard-coded, dua varian (`campaigns.js:963-967`).
- Banner proaktif: 4 aturan (overdue, streak, angka basi > 14 hari, DNA), satu CTA, sekali per sesi (`proactive-notif.js`).

### 1.6 Duplikasi data

1. Nilai milestone `number` **disalin ke level berikutnya** saat naik level (`campaigns.js:1452-1457`) → followers yang sama ada di ≤5 objek, hanya level aktif yang di-refresh.
2. Shares/Saves disimpan di campaign padahal turunan dari `content.performance`; tidak di-resync kalau pernah diketik manual (`campaigns.js:1242`).
3. `content.performance` (flat) vs `content.performanceByPlatform` — dua representasi, `formulas.js` baca yang flat. (Di luar cakupan plan ini, dicatat.)
4. Kredensial Instagram per brand (di luar cakupan).

### 1.7 Kepadatan UI

Detail campaign ladder: judul + meta + 3 stat + kartu intro + accordion aturan + tangga 5 level + pohon SVG 8–15 node (angka saja, tanpa label) + panel mission dengan 8–15 baris (label, deskripsi, input, target, tombol sync, edit target, pill status, hapus) + input tambah milestone + tombol Brainstorm + tombol Lanjut. Untuk pemula ini 3 layar penuh sebelum tahu harus ngapain.

### 1.8 Jawaban atas pertanyaan audit

| Pertanyaan | Jawaban hari ini |
|---|---|
| Pemula tahu harus ngapain? | Tidak. Satu kalimat generik, sisanya angka kosong. |
| Tiap item punya jalur selesai yang jelas? | Tidak. `number` = kotak kosong; tidak disebut angkanya dari mana. |
| Data dimasukkan dua kali? | Ya: followers (tiap level), shares/saves (per konten lalu ke milestone), status terbit (checkbox Creator + kalender). |
| Navigasi bawa konteks? | Tidak. |
| Task bisa selesai otomatis? | Sebagian (konten terbit, minggu aktif, ER). Naik level selalu manual. |
| Goal referensi data existing? | Sebagian (shares/saves), followers tidak punya data existing. |
| Campaign–Creator–Kalender–Analytics–Sales nyambung? | Creator↔Campaign lewat `campaignId` saja; Kalender baca jendela campaign (read-only); Analytics tidak kenal campaign; Sales kosong. |
| UI terlalu padat? | Ya (§1.7). |
| Ada yang bisa dihapus/digabung? | Ya (§0, §6.6). |

---

## 2. Prinsip arsitektur

1. **Milestone = metric + target (+ filter).** Bukan `kind` + `label` + `value`. Sumber angka dideklarasikan, bukan ditebak dari label.
2. **Angka hidup di rumahnya.** Profil → `brand.insights`. Performa → `content.performance`. Proses → `content.status`. Penjualan → Sales Tracker (kalau ada). Campaign hanya menyimpan target dan angka yang memang tidak bisa dilihat app (`manual.*`), sekali per campaign, bukan per level.
3. **Aktivitas = konten.** Tidak ada entitas "task" baru. "Bikin 3 Reels" = milestone `content.published` filter `format: Reel` target 3. "Reel kolaborasi belum dibuat" = konten status `idea` yang terkait campaign. Pipeline konten (ide → naskah → syuting → edit → siap upload → terbit) sudah ada dan sudah jadi state machine yang benar.
4. **Satu engine untuk "langkah berikutnya".** Semua permukaan (detail campaign, beranda, banner, Consultant, kartu list) membaca fungsi yang sama, jadi tidak ada dua pendapat tentang apa yang harus dilakukan.
5. **Navigasi membawa konteks dan jalan pulang.** Klik dari campaign membuka alat yang tepat pada item yang tepat, dengan chip kembali.
6. **Otomatis kalau bisa diverifikasi, manual kalau tidak, dan manual harus jujur bilang "app tidak bisa melihat ini".**

---

## 3. Model data

### 3.1 Metric Source Registry (`js/campaign-metrics.js`, baru)

Modul ini boleh mengimpor `store.js` **dan** `formulas.js` (memutus siklus yang memaksa stub `auto-er-count` di store). Tiap sumber:

```js
{
  key: "profile.followers",
  label: "Followers Instagram",
  unit: "followers",
  auto: true,                       // dihitung app / dibaca dari data existing
  home: "insights",                 // fitur pemilik data
  read(ctx) → { current, updatedAt, available, note },
  update: { label: "Perbarui Insights", open: "insights-modal" },   // DATA ACTION
  improve: { label: "Bikin konten", go: "creator" },                // GROWTH ACTION
  staleAfterDays: 7,
}
```

| key | Rumah | Cara baca | Otomatis | Update (data) | Improve (growth) |
|---|---|---|---|---|---|
| `profile.followers` | Brand Insights | `brand.insights[platform].followers` | ya (manual entry di satu tempat, atau API) | Perbarui Insights (modal) | Bikin konten / Brainstorm |
| `profile.reach`, `profile.profileVisits` | Brand Insights | idem | idem | idem | idem |
| `content.published` | Content OS | count konten pool dengan `status === "published"` (+ filter opsional `format`, `platform`, `phaseId`, `missionId`) | ya | — | Konten baru / Brainstorm |
| `content.scheduled` | Kalender | count `scheduleDate` terisi & status ≥ scheduled | ya | — | Jadwalkan (Kalender) |
| `content.streakWeeks` | Content OS | `consecutiveActiveWeeks` | ya | — | Terbitkan minggu ini |
| `content.metric:<shares|saves|comments|views|likes>` | Performa konten | `contentMetricTotal` | ya (angka per konten diisi user/OCR/API) | Isi performa (Quick Fill konten yang belum ada datanya) | Bikin konten |
| `content.erCount` | Performa konten | count published dengan ER ≥ threshold | ya | Isi performa | Bikin konten |
| `content.topCount` | Performa konten | count published dengan views ≥ rata-rata akun × 1 | ya | Isi performa | — |
| `manual.number` | Campaign | `campaign.manualMetrics[metricId].value` | tidak | Catat angka (sheet) | opsional per template |
| `manual.check` | Campaign | `campaign.manualMetrics[metricId].done` | tidak | Tandai selesai | — |
| `sales.leads`, `sales.revenue` | Sales Tracker | `available: false` sampai fitur ada → fallback tampil sebagai `manual.number` dengan catatan "Sales Tracker segera hadir" | nanti | Catat penjualan | — |
| `brand.guidelinesComplete` | Brand Guidelines | `brand.brandGuidelines.colors.primary` dll. | ya | Lengkapi Guidelines | — |

Catatan: "DM bermakna" tetap manual (app tidak melihat DM). "Komentar bermakna" bisa `content.metric:comments` dengan catatan "termasuk semua komentar". Keputusan user (§11).

### 3.2 Bentuk milestone baru

```js
{ id, metric: "profile.followers", target: 1000, unit: "followers",
  label: "Followers", description, highlight: true,
  filter: null | { format: "Reel", phaseId, missionId },
  threshold: null,          // untuk erCount
  required: true }          // event
```

Tidak ada `value`, `done`, `source`, `updatedAt` di milestone. Angka manual di `campaign.manualMetrics[milestone.id] = { value | done, updatedAt }` — **satu per campaign**, dibaca semua level (target kumulatif memang membandingkan angka yang sama).

### 3.3 Brand Insights (baru)

```js
brand.insights = {
  instagram: { followers, reach30d, profileVisits30d, updatedAt, source: "manual"|"instagram" },
  tiktok: { ... }   // nanti
}
brand.insightsHistory = [ { platform, followers, reach30d, profileVisits30d, at } ]  // append tiap update, cap 60
```

Riwayat memberi: "naik 236 sejak campaign mulai", grafik kecil di Dashboard, dan `followersGained` per periode tanpa mengetik ulang. Isi via modal **Perbarui Insights** (3 angka + tanggal, opsional screenshot OCR halaman Insights akun; `ocr.js` sudah ada untuk insight post, perlu pola baru untuk insight akun) atau otomatis dari API untuk akun yang punya.

### 3.4 Migrasi (read-time, tanpa script, pola `phases` yang sudah ada)

| Lama | Baru |
|---|---|
| `kind:"number"` label "Followers" | `metric:"profile.followers"`; nilai lama dipindah ke `brand.insights.instagram.followers` kalau `brand.insights` kosong (ambil `updatedAt` terbaru dari semua level) |
| `kind:"number"` label Shares/Saves | `content.metric:shares` / `:saves`; nilai lama dibuang (turunan) |
| `kind:"auto"` | `content.published` (+ `filter.phaseId` untuk non-autoLink) |
| `kind:"auto-weeks"` | `content.streakWeeks` |
| `kind:"auto-er-count"` | `content.erCount` + `threshold` |
| `kind:"number"` lainnya | `manual.number`; `value` + `updatedAt` level aktif → `campaign.manualMetrics[id]` |
| `kind:"check"` | `manual.check`; `done` → `manualMetrics` |
| phase milestone `{text, done}` | `manual.check` dengan `phaseId` |
| event `kind:"auto"` | `content.published` filter `{ campaignId, dateFrom, dateTo }` (bukan `createdAt` sembarang) |

Mapping disimpan di satu fungsi `normalizeMilestone(ms, campaign)` di `campaign-metrics.js`. Data lama tidak ditulis ulang sampai user menyimpan campaign (sama seperti `phases`).

---

## 4. Next Action engine (`js/next-action.js`, baru)

`nextActions({ brand, campaign, content, settings }) → [{ id, priority, label, why, cta: { label, kind: "go"|"open", target, ctx }, milestoneId?, contentId? }]`. Murni, tanpa DOM, bisa diuji dengan Node.

Aturan, urutan prioritas (berhenti mengumpulkan setelah 3):

| # | Kondisi | Aksi utama | Ke mana |
|---|---|---|---|
| 1 | Konten terkait `scheduleDate < hari ini` & belum terbit | "Sudah upload? Tandai terbit" | Creator, contentId, panel Siap Upload |
| 2 | Sumber `profile.*` dipakai milestone & `updatedAt` > 7 hari atau kosong | "Perbarui Insights Instagram" | modal in-place |
| 3 | Konten terkait di `scheduled` (jadwal ≤ 3 hari) | "Upload {judul}" | Creator, contentId |
| 4 | Streak putus ≤ 2 hari (`streakBreakInDays`) | "Terbitkan 1 konten minggu ini" | Creator (konten paling siap) atau Kalender |
| 5 | Konten terkait di `editing` / `production` / `draft` | "Selesaikan edit / Syuting / Tulis naskah {judul}" | Creator, contentId |
| 6 | Ada `idea` terkait tanpa jadwal | "Jadwalkan {judul}" | Kalender, highlight contentId |
| 7 | Tidak ada konten terkait di pipeline | "Brainstorm konten buat level ini" | modal Brainstorm (mission ctx) |
| 8 | Konten terbit ≥ 3 hari tanpa `performance.confirmedAt` | "Isi performa {judul}" | Quick Fill, contentId |
| 9 | Ada `manual.*` yang belum pernah dicatat | "Catat angka: {label}" | sheet Catat angka |
| 10 | Semua milestone `metTarget` tapi minimal minggu belum | "Semua target tercapai — {n} minggu lagi buat naik level" (info) | — |
| 11 | Semua tercapai + minimal minggu | auto-advance (toast + confetti); tombol hanya "Lihat level berikutnya" | — |

`why` selalu satu kalimat yang menyebut milestone yang dipengaruhi: "Reel ini dihitung ke *Konten terbit 12/50* dan bantu *Followers 1.486/2.000*." Untuk campaign event, aturan 1–8 sama, ditambah "fase {nama} berakhir {n} hari lagi, {k} milestone wajib belum tercapai".

Yang **menghapus** logika lama: `guidedIntro` "Minggu ini" (`campaigns.js:963`), aturan streak/stale di `proactive-notif.js:43-55` (banner memanggil engine, ambil aksi #1 dari campaign aktif tiap brand), teks kartu campaign di `beginner-home.js:80-82`.

---

## 5. Layout detail campaign (satu layout untuk ketiga jenis)

```
┌ page-head ───────────────────────────────────────────────┐
│ ← Semua campaign                                Ubah  ⋯  │
│ Naikin Followers IG Kopi Senja                            │
│ [Level 1 dari 5 · Get Discovered]  atau  [Pre-Event · 12 hari lagi] │
├ HEADLINE ────────────────────────────────────────────────┤
│ 1.486 / 2.000 followers   ▓▓▓▓▓▓▓░░░ 74%                 │
│ Diperbarui 3 hari lalu · Instagram Insights   [Perbarui] │  ← milestone `highlight` pertama
├ LANGKAH BERIKUTNYA ──────────────────────────────────────┤
│ ▶ Upload "Reel kolaborasi @barista.kediri"               │
│   Dihitung ke Konten terbit 12/50 · Streak aman sampai Jumat │
│   [Buka di Creator]        Lalu: Jadwalkan 2 ide · Isi performa 1 konten │
├ NAVIGASI TAHAP ──────────────────────────────────────────┤
│ ○──●──○──○──○   (tangga level / timeline event / fase)    │
├ MILESTONE ───────────────────────────────────────────────┤
│ ✓ Konten terbit        12 / 50   Content OS   otomatis   │
│ ● Minggu aktif          3 / 8    Content OS   otomatis   │
│ ● Followers        1.486 / 1.000 Insights · 3 hari lalu  [Perbarui] │
│ ○ Shares              38 / 150   Performa konten          [Isi performa] │
│ ○ DM bermakna          — / 50    dicatat manual           [Catat]  │
│ ○ ER sehat vs platform             dicatat manual         [Tandai] │
│                                        [Catat semua angka manual] │
├ AKTIVITAS (konten terkait) ──────────────────────────────┤
│ Ide 2 · Naskah 1 · Syuting 0 · Edit 1 · Siap upload 1 · Terbit 12 │
│ [Brainstorm konten]  [Konten baru]        lihat semua →  │
└──────────────────────────────────────────────────────────┘
```

### 5.1 Anatomi baris milestone
`status-dot · label · current/target · chip sumber (nama fitur + "otomatis" atau "diperbarui X hari lalu") · satu tombol aksi`. Tombol aksi = `update` dari registry kalau data basi/kosong, kalau tidak = `improve`; untuk sumber otomatis tanpa aksi → tidak ada tombol. Tidak ada input inline, tidak ada edit target/hapus di Guided (Pro: menu ⋯ per baris).

### 5.2 Perlakuan data basi (tanpa banner)
- Chip sumber berubah amber + teks "diperbarui 8 hari lalu" → tombol baris jadi "Perbarui".
- Headline: kalimat kecil di bawah angka.
- Engine menaikkannya ke Langkah Berikutnya hanya kalau > `staleAfterDays`.
- Banner proaktif tetap sekali per sesi, hanya aksi #1.

### 5.3 Sheet "Catat angka" (`openManualMetricsSheet`)
Drawer berisi **hanya** milestone `manual.*` level aktif: label, deskripsi "app nggak bisa lihat ini, jadi kamu yang catat", input, "terakhir dicatat X". Satu Simpan. Ini menggantikan 8 input inline.

### 5.4 Modal "Perbarui Insights" (`js/views/insights-modal.js`, baru)
Platform (IG default), followers, reach 30 hari, kunjungan profil 30 hari, tanggal (default hari ini), opsional unggah screenshot Insights akun → OCR. Simpan → `brand.insights` + `insightsHistory`. Dipanggil dari: baris milestone, headline, Dashboard (kartu "Profil Instagram" baru, pengganti Account Overview yang hanya untuk API), Beranda Pemula, banner, Consultant `[[open:insights]]`. Kalau akun punya API: tombol "Ambil dari Instagram" di modal yang sama.

### 5.5 Naik level
Otomatis saat semua `metTarget` **dan** minimal minggu (`MISSION_MIN_WEEKS`) terpenuhi: toast + kartu "Level 1 selesai 🎉" + level berikut terbuka. Pro: menu ⋯ "Lanjut walau belum tercapai" (aturan lama: logged sudah cukup) dengan konfirmasi. Guided tidak punya tombol Lanjut sama sekali.

### 5.6 Dihapus
- `missionTreeHTML` (pohon SVG) + hover sync (`campaigns.js:1124-1211, 1492-1505`).
- Input `data-milestone-number`, `data-milestone-check`, tombol `data-milestone-sync`, `autoSyncContentMilestones`, `syncFollowersFromInstagram` (pindah ke insights modal / registry), copy-forward di `#mission-advance`.
- `milestoneRowHTML`, `eventMilestoneRowHTML`, `milestonesHTML` → satu `milestoneRowHTML(ms, reading)`.
- Stat grid "Konten terkait / Views organik / Gabungan" di atas (pindah ke blok Aktivitas sebagai angka kecil).
- Kartu "Posisi kamu sekarang" (isinya jadi sub-judul + Langkah Berikutnya).

---

## 6. Navigasi berkonteks (`js/nav-context.js`, baru)

```js
go(hash, { from: location.hash, fromLabel: "Campaign Kopi Senja", campaignId, missionId, phaseId, contentId, intent: "publish"|"schedule"|"performance"|"new-content", defaults: { format, platform } })
consumeNavContext(view)  // baca + hapus slot; TTL 10 menit
```

| Tujuan | Yang dibaca | Perilaku |
|---|---|---|
| Creator | `contentId` → pilih item, buka panel sesuai `intent` (`publish` → Siap Upload); tanpa `contentId` + `intent:"new-content"` → buka picker platform dengan `campaignId/phaseId/missionId/format` sudah terisi | field campaign terisi, tidak bisa lupa |
| Kalender | `contentId` → buka Bank Konten dengan item disorot; `campaignId` → filter bank ke campaign itu | |
| Daftar Konten / Quick Fill | `contentId` + `intent:"performance"` → langsung buka Quick Fill item itu | |
| Insights | tidak perlu route, modal | |
| Brand Guidelines | `section` | sudah ada |
| Sales | belum ada | |

**Chip kembali:** `layout.js` merender `← Kembali ke {fromLabel}` di bawah topbar selama slot ada; klik → `location.hash = from` dan hapus slot; navigasi manual ke rute lain menghapus slot. Setelah kembali, detail campaign repaint dari data live (sudah begitu lewat `db:change`), jadi "campaign mengenali progres" otomatis.

**Perbaikan langsung yang ikut:** brainstorm → `go(creator, { contentId: idPertamaTersimpan })`; Consultant `[[draft]]` mengisi `campaignId` campaign aktif + `missionId`; `CONSULTANT_ROUTES` dapat `campaign` (id dari snapshot) dan `insights` (modal).

---

## 7. Penyelesaian otomatis: sebelum → sesudah

| Item | Sebelum | Sesudah |
|---|---|---|
| Konten terbit N | otomatis, **tapi menghitung draft** | otomatis, hanya `published` |
| Minggu aktif | otomatis | tetap |
| Shares/Saves | disalin ke milestone kalau `source` cocok | dibaca live, tidak disimpan |
| Followers | ketik per level / API | `brand.insights` (1 tempat) |
| Video ER > 10% | view benar, store stub 0 | satu implementasi di registry |
| Bikin/jadwalkan/terbitkan N Reel | tidak ada | `content.published` / `content.scheduled` + filter |
| Naik level | tombol manual | otomatis saat target + minggu; Pro bisa paksa |
| Fase event | by tanggal | tetap |
| Konten terkait event | by `createdAt` semua konten | `campaignId` + terbit di jendela |
| Tandai terbit | checkbox Creator | tetap manual (tanpa API), tapi jadi aksi #1 saat jadwal lewat |
| DM/kolaborasi/komunitas | ketik | tetap manual, lewat sheet, dengan label jujur |

---

## 8. Permukaan lain yang membaca engine yang sama

- **Beranda Pemula** kartu Campaign: judul campaign aktif + headline + aksi #1 dengan deep link `#/brand/:id/campaigns/:cid` (ganti `beginner-home.js:80-82`). Kalau > 1 campaign aktif, yang paling mendesak (prioritas terendah).
- **Beranda Pro** widget Campaign & health strip: headline + aksi #1 per campaign, link ke detail.
- **Kartu daftar campaign**: headline + aksi #1 (ganti "Views organik/Gabungan").
- **Banner proaktif**: aksi #1 campaign paling mendesak lintas brand; aturan DNA tetap.
- **Consultant snapshot**: per campaign: id, headline, 3 aksi engine, milestone basi → AI bisa menjawab "minggu ini ngapain" dengan data yang sama dengan UI, dan `[[goto:campaign:ID]]`.
- **Kalender**: jendela campaign sudah ada; tambah badge "menuju milestone X" di tooltip item terkait (opsional).
- **Dashboard**: kartu "Profil Instagram" (angka dari `brand.insights` + grafik riwayat + tombol Perbarui) menggantikan Account Overview API-only.

---

## 9. Bug yang ketemu dan diperbaiki apa pun keputusan desainnya

1. `milestoneStatus` `auto` menghitung semua status (`store.js:1147`) → hanya `published`.
2. `auto-er-count` stub di store (`store.js:1166`) → Consultant baca 0.
3. Event `auto` menghitung konten tak terkait (`store.js:1615`).
4. Brainstorm pindah ke Creator tanpa memilih ide (`campaigns.js:1587`).
5. Consultant draft tanpa `campaignId` (`consultant-panel.js:209`).
6. Content Editor tampilkan dropdown fase untuk ladder (`content-editor.js:120`).
7. Banner proaktif DNA-only tanpa CTA (`proactive-notif.js:90`).
8. `facebook-import.js` tidak digate `canUseInstagramApi()` (keputusan user, lihat handoff).
9. `milestone.updatedAt` tidak pernah ditampilkan.

---

## 10. Rencana eksekusi (5 tahap, tiap tahap bisa di-commit terpisah)

**Tahap 1 — Fondasi data (kode, tanpa perubahan UI besar).** `js/campaign-metrics.js` (registry + `normalizeMilestone` + `readMilestone`), `brand.insights` + `insightsHistory` di `store.js` (`updateBrandInsights`), `campaign.manualMetrics` (`setManualMetric`), modal Perbarui Insights, `firestore.rules` tidak berubah (field baru di doc yang sama). Hapus stub `auto-er-count`, perbaiki bug 1–3. Uji Node: normalisasi ladder lama → metric, pembacaan tiap sumber.

**Tahap 2 — Engine + layout detail.** `js/next-action.js` + uji Node. Tulis ulang `paintDetail` ke layout §5 untuk ladder; event dan phase dipetakan ke layout yang sama (navigasi tahap berbeda, sisanya sama). Sheet Catat angka. Hapus pohon, input inline, copy-forward. Auto-advance.

**Tahap 3 — Nav context.** `js/nav-context.js`, chip kembali di `layout.js`, Creator/Kalender/Quick Fill membaca konteks, brainstorm + Consultant + tombol aksi memakai `go()`.

**Tahap 4 — Permukaan lain.** Beranda Pemula/Pro, kartu list, banner proaktif, Consultant snapshot + route `campaign:id` + `[[open:insights]]`, Dashboard kartu Profil.

**Tahap 5 — Rapikan.** Tur campaign (`campaign-guide.js`) disesuaikan ke layout baru; i18n; hapus kode mati; catatan handoff.

Perkiraan file tersentuh: baru 4 (`campaign-metrics.js`, `next-action.js`, `nav-context.js`, `views/insights-modal.js`), diubah ~12 (`store.js`, `campaigns.js` besar, `creator.js`, `calendar.js`, `content-list.js`, `content-editor.js`, `dashboard.js`, `beginner-home.js`, `brand-home.js`, `proactive-notif.js`, `consultant-panel.js`, `ai.js`, `layout.js`, `guides/campaign-guide.js`, `styles.css`).

---

## 11. Keputusan yang butuh user sebelum Tahap 1

1. **Grow Social menghitung semua konten brand** (`autoLinkAllContent`). Usul: tetap, tapi hanya yang terbit, dan blok Aktivitas menampilkan konten yang secara eksplisit terkait. Setuju?
2. **Komentar bermakna** → otomatis dari `content.performance.comments` (semua komentar) atau tetap manual? Usul: otomatis + label "total komentar".
3. **Naik level otomatis** dengan syarat minimal minggu, atau tetap tombol? Usul: otomatis di Guided, Pro boleh paksa.
4. **Platform insights**: mulai Instagram saja? Usul: ya, struktur sudah per platform.
5. **Riwayat insights**: simpan tiap update (cap 60) — setuju?
6. **Custom campaign** (phase-based) sekarang tidak bisa dibuat dari UI. Ikut dipetakan ke layout baru (murah) atau tetap diparkir?
7. **Sales Tracker**: cukup stub di registry (milestone tampil manual + catatan), atau mulai model data minimal `sales` (tanggal, nominal, sumber, contentId)?

---

## 12. Campaign Event (organizer / tenant booth / participant) — usulan optimasi (15 Sep 2026)

Fakta sekarang: 3 peran (`EVENT_ROLES`), form setup 10–13 field sekaligus (`EVENT_SETUP_FIELDS`), fase dengan offset tetap dari tanggal event (`ORGANIZER_PHASES` T-30/T-14/T-7/H/T+14; `buildEventPhases` `store.js:1350`), `dateFrom/dateTo` sudah dihitung tapi UI hanya menampilkan `dateLabel` "T-30 → T-14". Mayoritas milestone `number` manual (Awareness organizer: 8 dari 9). Kalender hanya menggambar satu bar campaign `startDate→endDate` (`calendar.js:461`), tanpa fase, tanpa penanda hari-H. Brainstorm untuk event dipanggil dengan `mission: null` (`campaigns.js:1823`) → AI tidak tahu fase. Konten dihitung ke fase lewat `createdAt` di jendela (bug §9.3).

**Bug runway:** offset tetap → kalau campaign dibuat H-10, fase Foundation (`dateTo = T-30`) dan Awareness sudah lewat saat dibuat, semua milestone-nya langsung "Terlewat". Perlu kompresi fase proporsional terhadap runway (start → event) dengan minimum 1 hari per fase, dan fase yang tidak muat digabung ke fase berikutnya.

### 12.1 Fase bertanggal + masuk kalender (murah, dampak besar)
- Header detail event: "Bazar Kediri · Sabtu 18 Okt · **23 hari lagi**"; tiap pill fase menampilkan tanggal nyata "6–12 Okt · 4 hari lagi" bukan "T-14 → T-7"; fase aktif ditentukan hari ini.
- Kalender: bar campaign event dipecah jadi segmen per fase (warna berbeda, label nama fase), sel hari-H dapat penanda ⭐, batas fase jadi garis tipis. Klik segmen → Bank Konten difilter ke fase itu + tombol "Konten baru untuk fase ini" (`campaignPhaseId` terisi lewat nav-context §6).
- Ekspor ICS ikut menulis hari-H dan batas fase sebagai all-day event.
- Engine §4 untuk event: "Fase Awareness berakhir 3 hari lagi, 2 milestone wajib belum tercapai" + aksi konten fase itu.

### 12.2 Rencana Aktivitas: brainstorm terstruktur yang langsung diplot ke fase, milestone, dan tanggal (inti permintaan)
Layar baru di detail event (dan ditawarkan sekali setelah setup): papan **Rencana Aktivitas**, kolom = fase (dengan tanggal), kartu = aktivitas.
- **AI mengusulkan** 3–5 aktivitas per fase dari peran + setup + objectives + Brand DNA. Contoh tenant: teaser "kami di booth A12", promo khusus pengunjung booth (kode), jadwal live/demo di booth, story countdown, hari-H story tiap 2 jam + ajakan foto di booth (UGC), pasca: thank-you + follow-up leads + promo lanjutan. Organizer: key visual, pengumuman, speaker reveal, early-bird, countdown, reminder H-1, recap, testimoni.
- **Ruang ide sendiri**: input bebas (+ mic, sudah ada `voice-input.js`) → tombol "Plotkan" → AI menaruh ke fase, milestone, format, dan tanggal yang paling pas (mengikuti jendela fase dan Jadwal Kerja brand). User bisa geser antar kolom (drag) atau ubah tanggal.
- **Terima** = `createContent` dengan `campaignId`, `campaignPhaseId`, `milestoneId` (field baru), `campaignTag` (baru: `teaser|promo|value|countdown|reminder|live|ugc-call|recap|social-proof|thank-you`), `scheduleDate` (default: tengah jendela fase pada hari upload), `status:"idea"`. Langsung tampil di Kalender dan Creator.
- Tiap kartu menunjukkan "dihitung ke: Terbitkan 7 konten countdown" supaya orang tahu kenapa aktivitas itu ada.

### 12.3 Milestone event jadi otomatis lewat tag (bukan angka manual)
Dengan `campaignTag` + `milestoneId` di konten, milestone seperti "Terbitkan X konten countdown", "X konten reminder", "X konten value", "Recap terbit", "Konten speaker/tenant terbit" berubah dari `number/check` manual menjadi `content.published` filter `{ phaseId, tag }` di registry §3. Reach/views/shares/saves/komentar per fase = `content.metric:*` filter jendela fase (dari performa konten yang diisi user). Kunjungan profil = `profile.profileVisits`. Sisa yang benar-benar manual: pendaftar, attendee, leads, penjualan, mention, UGC orang lain, kolaborasi → sheet Catat angka, dan nanti Sales Tracker.
Per fase tampilkan 3–4 milestone **wajib** terbuka, opsional dilipat. Final score per kategori tetap.

### 12.4 Setup lebih ringan, bertahap
3 langkah: (1) event dasar: nama, tanggal, lokasi, peran, tipe event (bazar/pameran, workshop/seminar, launching, festival/konser, meetup komunitas, online); (2) skala & target: perkiraan audiens → tier, target yang direkomendasikan sistem tampil dan bisa diubah, "audiens sosmed sekarang" diambil dari `brand.insights` (tidak ditanya lagi); (3) objective. Tipe event mengubah usulan aktivitas dan panjang fase default.

### 12.5 Hari-H: tally cepat + rundown
- Mode **Catat Hari-H** (layar HP): tombol besar +1 pengunjung booth, +1 lead, +Rp penjualan, +1 UGC; disimpan ke `campaign.manualMetrics` dengan timestamp. Ini yang membuat "sistem ikut andil" terasa di lapangan.
- Rundown hari-H = konten fase Event Day dengan jam (tampilan hari di Kalender sudah ada); brainstorm mengusulkan slot pagi/siang/sore.

### 12.6 Pasca-event: laporan + baseline
- "Laporan event" dari `report.js` (angka per kategori, konten terbaik, target vs aktual) + kolom "pelajaran" yang disimpan di `campaign.eventPlan.learnings`.
- Setup event berikutnya menawarkan pra-isi dari aktual event sebelumnya (aturan "Perbaikan Berkelanjutan" di `EVENT_PLAN_TERMS` akhirnya punya mekanisme).

### 12.7 Urutan
1. Tanggal fase di UI + kompresi runway + segmen fase di kalender (Tahap 2–3 plan utama).
2. Rencana Aktivitas + `milestoneId`/`campaignTag` + registry filter (Tahap 2 + 3).
3. Setup bertahap + tipe event.
4. Catat Hari-H.
5. Laporan + baseline.

Pertanyaan: (a) tipe event mana yang paling sering dipakai user Wepeka (bazar/booth?) supaya library aktivitas dimulai dari situ; (b) Rencana Aktivitas ditawarkan otomatis setelah setup, atau tombol di detail saja; (c) tally hari-H cukup di `manualMetrics` atau mulai koleksi `sales` minimal (nyambung ke §11.7).
