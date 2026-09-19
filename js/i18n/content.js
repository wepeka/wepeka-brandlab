// i18n dictionary — Content list/editor, calendar, dashboard, brand home, analytics, report, sales, cadence, insights. Key prefixes: cnt. rep. sales. bha.
// Shape: "key": { en: "...", id: "..." }. Merged into js/i18n.js.
export default {
  // ── Shared metric wording (content editor / list OCR + Instagram fetch)
  "cnt.metric.one": { en: "metric", id: "metrik" },
  "cnt.metric.many": { en: "metrics", id: "metrik" },

  // ── Formula validation (js/formulas.js, shown in Settings)
  "cnt.formula.empty": { en: "The formula is empty.", id: "Rumusnya masih kosong." },
  "cnt.formula.chars": { en: "Only numbers, metric names, and + - * / ( ) are allowed.", id: "Cuma boleh angka, nama metrik, dan + - * / ( )." },
  "cnt.formula.unknown": { en: "Unknown metric: {names}", id: "Metrik nggak dikenal: {names}" },
  "cnt.formula.invalid": { en: "The formula isn't valid arithmetic.", id: "Rumusnya bukan hitungan yang valid." },

  // ── Content editor (guided mode labels)
  "cnt.editor.guidedCampaignLabel": { en: "Which campaign is this part of?", id: "Bagian dari campaign apa?" },
  "cnt.editor.guidedStatusLabel": { en: "How far along is it?", id: "Sampai mana prosesnya?" },

  // ── Content OS hub
  "cnt.os.tour.title": { en: "Content", id: "Konten" },
  "cnt.os.tour.body": { en: "Four tabs: write content, schedule it, see all your content, and a summary of the results. All of this brand's content lives here.", id: "Empat tab: tulis konten, atur jadwalnya, lihat semua konten, dan ringkasan hasilnya. Semua konten brand ini ada di sini." },

  // ── Dashboard

  // ── Calendar
  "cal.eventDay": { en: "Event day", id: "Hari-H" },
  "cal.eventDayTitle": { en: "Event day: {names}", id: "Hari-H: {names}" },
  "cal.eventFallback": { en: "Event", id: "Event" },
  "cal.holiday.newYear": { en: "New Year's Day", id: "Tahun Baru Masehi" },
  "cal.holiday.israMiraj": { en: "Isra Mi'raj", id: "Isra Mikraj" },
  "cal.holiday.chineseNewYear": { en: "Chinese New Year", id: "Tahun Baru Imlek" },
  "cal.holiday.nyepi": { en: "Nyepi (Day of Silence)", id: "Hari Suci Nyepi" },
  "cal.holiday.eidFitr": { en: "Eid al-Fitr", id: "Idulfitri" },
  "cal.holiday.goodFriday": { en: "Good Friday", id: "Wafat Yesus Kristus" },
  "cal.holiday.easter": { en: "Easter", id: "Paskah" },
  "cal.holiday.labor": { en: "Labor Day", id: "Hari Buruh" },
  "cal.holiday.ascension": { en: "Ascension Day", id: "Kenaikan Yesus Kristus" },
  "cal.holiday.eidAdha": { en: "Eid al-Adha", id: "Iduladha" },
  "cal.holiday.vesak": { en: "Vesak Day", id: "Hari Raya Waisak" },
  "cal.holiday.pancasila": { en: "Pancasila Day", id: "Hari Lahir Pancasila" },
  "cal.holiday.islamicNewYear": { en: "Islamic New Year", id: "Tahun Baru Islam" },
  "cal.holiday.independence": { en: "Independence Day", id: "HUT RI" },
  "cal.holiday.mawlid": { en: "Prophet Muhammad's Birthday", id: "Maulid Nabi Muhammad" },
  "cal.holiday.christmas": { en: "Christmas Day", id: "Hari Natal" },
  "cal.cuti.chineseNewYear": { en: "Collective leave: Chinese New Year", id: "Cuti Bersama Imlek" },
  "cal.cuti.nyepi": { en: "Collective leave: Nyepi", id: "Cuti Bersama Nyepi" },
  "cal.cuti.eidFitr": { en: "Collective leave: Eid al-Fitr", id: "Cuti Bersama Idulfitri" },
  "cal.cuti.ascension": { en: "Collective leave: Ascension Day", id: "Cuti Bersama Kenaikan Isa Almasih" },
  "cal.cuti.eidAdha": { en: "Collective leave: Eid al-Adha", id: "Cuti Bersama Iduladha" },
  "cal.cuti.christmas": { en: "Collective leave: Christmas", id: "Cuti Bersama Natal" },

  // ── Instagram insights modal
  "ins.title": { en: "Update Instagram insights", id: "Perbarui Insights Instagram" },
  // #1: same modal, generalized for any Social Media Growth campaign's
  // platform (TikTok/Facebook/Other have no API fetch — manual entry only).
  "ins.titleFor": { en: "Update {platform} insights", id: "Perbarui Insights {platform}" },
  "ins.intro": { en: "Open Instagram → your profile → <b>Professional dashboard</b> → <b>Account insights</b>, then copy the numbers here.", id: "Buka Instagram → profil → <b>Dasbor profesional</b> → <b>Insight akun</b>, lalu salin angkanya ke sini." },
  "ins.lastRecorded": { en: "Last recorded <b>{age}</b>{source}.", id: "Terakhir dicatat <b>{age}</b>{source}." },
  "ins.fromApi": { en: " (from the API)", id: " (dari API)" },
  "ins.never": { en: "Not recorded yet.", id: "Belum pernah dicatat." },
  "ins.fetchFollowers": { en: "Pull followers from Instagram", id: "Ambil followers dari Instagram" },
  "ins.followers": { en: "Followers", id: "Followers" },
  "ins.followersPlaceholder": { en: "e.g. 1486", id: "misal: 1486" },
  "ins.reach30": { en: "Reach (30 days)", id: "Reach 30 hari" },
  "ins.optional": { en: "(optional)", id: "(opsional)" },
  "ins.reachPlaceholder": { en: "Accounts reached", id: "Akun yang dijangkau" },
  "ins.visits30": { en: "Profile visits (30 days)", id: "Kunjungan profil 30 hari" },
  "ins.visitsPlaceholder": { en: "Profile visits", id: "Kunjungan profil" },
  "ins.date": { en: "Date of these numbers", id: "Tanggal angka ini" },
  "ins.noFollowerCount": { en: "Instagram didn't return a follower count.", id: "Instagram nggak mengirim jumlah followers." },
  "ins.fetchedToast": { en: "Followers from Instagram: {count}", id: "Followers dari Instagram: {count}" },
  "ins.fetchFailed": { en: "Couldn't pull from Instagram: {msg}", id: "Gagal ambil dari Instagram: {msg}" },
  "ins.needFollowers": { en: "Enter the follower count first.", id: "Isi jumlah followers dulu." },
  "ins.savedToast": { en: "Insights saved. Campaigns that track followers are updated too.", id: "Insights tersimpan. Campaign yang membaca followers ikut terbarui." },

  // ── Report
  "rep.generate": { en: "Generate", id: "Buat" },
  "rep.range.week": { en: "This week", id: "Minggu ini" },
  "rep.range.month": { en: "This month", id: "Bulan ini" },
  "rep.range.overall": { en: "All time", id: "Semua waktu" },
  "rep.range.custom": { en: "Custom", id: "Atur sendiri" },
  "rep.range.start": { en: "Start", id: "Mulai" },
  "rep.range.end": { en: "End", id: "Sampai" },
  "rep.range.overallSummary": { en: "All time — everything ever published", id: "Semua waktu — semua konten yang pernah terbit" },
  "rep.previewTitle": { en: "Report preview", id: "Pratinjau laporan" },
  "rep.share": { en: "Share", id: "Bagikan" },
  "rep.print": { en: "Print", id: "Cetak" },
  "rep.downloadPdf": { en: "Download PDF", id: "Download PDF" },
  "rep.pdfHint": { en: "In the print dialog, choose \"Save as PDF\" as the destination.", id: "Di jendela cetak, pilih \"Simpan sebagai PDF\" sebagai tujuan." },
  "rep.shareTitle": { en: "{brand} — Performance report", id: "{brand} — Laporan performa" },
  "rep.copied": { en: "Report summary copied to clipboard", id: "Ringkasan laporan disalin ke clipboard" },
  "rep.clipboardFailed": { en: "Couldn't access the clipboard — try Print or Download instead.", id: "Nggak bisa akses clipboard — coba Cetak atau Download aja." },
  "rep.shareUnsupported": { en: "Sharing isn't supported in this browser — try Print or Download instead.", id: "Browser ini belum mendukung fitur bagikan — coba Cetak atau Download aja." },
  "rep.sheetTitle": { en: "Performance report", id: "Laporan performa" },
  "rep.generatedOn": { en: "Generated {date}", id: "Dibuat {date}" },
  "rep.stat.published": { en: "Content published", id: "Konten terbit" },
  "rep.stat.totalViews": { en: "Total views", id: "Total views" },
  "rep.stat.totalReach": { en: "Total reach", id: "Total reach" },
  "rep.stat.healthy": { en: "Healthy content", id: "Konten sehat" },
  "rep.th.content": { en: "Content", id: "Konten" },
  "rep.th.avgEngagement": { en: "Avg. engagement", id: "Rata-rata engagement" },
  "rep.th.avgFollowerConv": { en: "Avg. follower conv.", id: "Rata-rata konv. follower" },
  "rep.noTop": { en: "No published content with views in this period.", id: "Belum ada konten terbit dengan views di periode ini." },

  // ── Sales (placeholder page)
  "sales.eyebrow": { en: "Sales Tracker", id: "Sales Tracker" },
};
