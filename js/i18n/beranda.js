// Beranda (js/views/home.js) after the 2026-10-06 tidy-up: the "Minggu ini"
// weekly loop and the finished-goal recap (js/weekly-recap.js), the "Lainnya"
// area, the 2-day "Isi angka" action (js/next-action.js), the low AI credit
// note (js/ai-low-credit.js) and saved ideas in the Content Bank
// (js/views/calendar.js).
export default {
  // Layout
  "beranda.more.title": { en: "More", id: "Lainnya" },
  "beranda.today.seePlan": { en: "See the plan", id: "Lihat rencananya" },
  "beranda.companion.memory": { en: "Brand memory · {n}", id: "Memori brand · {n}" },
  "beranda.companion.memoryEmpty": { en: "Brand memory", id: "Memori brand" },
  "beranda.tour.week.title": { en: "Your week", id: "Minggu kamu" },
  "beranda.tour.week.body": { en: "What went out in the last 7 days, what's coming in the next 7, and the weekly report. An empty week? \"Fill this week's schedule\" asks the chat for a plan; you pick what to keep.", id: "Apa yang terbit 7 hari terakhir, apa yang terjadwal 7 hari ke depan, dan report mingguan. Minggunya kosong? \"Isi jadwal minggu ini\" minta usulan jadwal ke chat; kamu yang pilih mana yang disimpan." },

  // "Minggu ini" (js/weekly-recap.js)
  "beranda.week.title": { en: "This week", id: "Minggu ini" },
  "beranda.week.sub": { en: "{from} – {to}", id: "{from} – {to}" },
  "beranda.week.last": { en: "Last 7 days", id: "7 hari terakhir" },
  "beranda.week.next": { en: "Next 7 days", id: "7 hari ke depan" },
  "beranda.week.stat.published": { en: "published / planned", id: "terbit / direncanakan" },
  "beranda.week.stat.publishedNoPlan": { en: "published", id: "konten terbit" },
  "beranda.week.stat.streak": { en: "weeks in a row", id: "minggu beruntun" },
  "beranda.week.stat.views": { en: "views", id: "views" },
  "beranda.week.stat.sales": { en: "sales · {n} orders", id: "penjualan · {n} transaksi" },
  "beranda.week.stat.sales.one": { en: "sales · {n} order", id: "penjualan · {n} transaksi" },
  "beranda.week.best": { en: "Best post", id: "Paling ramai" },
  "beranda.week.bestViews": { en: "{n} views", id: "{n} views" },
  "beranda.week.quiet": { en: "Nothing went out in the last 7 days. One post this week is enough to get going again.", id: "Belum ada yang terbit 7 hari terakhir. Satu konten minggu ini sudah cukup buat jalan lagi." },
  "beranda.week.report.due": { en: "Your last-7-days report is ready.", id: "Report 7 hari terakhir siap diunduh." },
  "beranda.week.scheduleCount": { en: "{n} posts", id: "{n} konten" },
  "beranda.week.scheduleCount.one": { en: "{n} post", id: "{n} konten" },
  "beranda.week.empty": { en: "Nothing is scheduled for the next 7 days yet.", id: "Belum ada konten yang dijadwalkan 7 hari ke depan." },
  "beranda.week.allShown": { en: "They're on the Today or Goal card above.", id: "Semuanya sudah ada di kartu Hari ini atau Tujuan di atas." },
  "beranda.week.plan": { en: "Fill this week's schedule", id: "Isi jadwal minggu ini" },
  "beranda.week.planTitle": { en: "Brandlab suggests a week of posts in the chat; you tick the ones to keep ({cost})", id: "Brandlab kasih usulan jadwal seminggu di chat; kamu centang yang mau disimpan ({cost})" },
  "beranda.week.summary": { en: "{published}/{planned} published · {n} coming up", id: "{published}/{planned} terbit · {n} terjadwal" },

  // Finished Event / Grow Brand ladder (js/weekly-recap.js)
  "beranda.recap.eyebrow.event": { en: "Event finished", id: "Event selesai" },
  "beranda.recap.eyebrow.ladder": { en: "Goal reached", id: "Tujuan tercapai" },
  "beranda.recap.title": { en: "{name} is done 🎉", id: "{name} sudah selesai 🎉" },
  "beranda.recap.content": { en: "{published} of {planned} posts published", id: "{published} dari {planned} konten terbit" },
  "beranda.recap.noContent": { en: "No posts were linked to it", id: "Belum ada konten yang ditautkan" },
  "beranda.recap.sales": { en: "{rp} from {n} sales logged", id: "{rp} dari {n} penjualan tercatat" },
  "beranda.recap.levels": { en: "{done} of {total} levels done", id: "{done} dari {total} level selesai" },
  "beranda.recap.body": { en: "The momentum is still warm. Set the next goal while you still remember what worked.", id: "Momentumnya masih hangat. Pasang tujuan berikutnya selagi kamu masih ingat apa yang berhasil." },
  "beranda.recap.next": { en: "Set your next goal", id: "Pasang tujuan berikutnya" },
  "beranda.recap.open": { en: "See the summary", id: "Lihat ringkasannya" },
  "beranda.recap.dismiss": { en: "Close this recap", id: "Tutup ringkasan ini" },

  // "Isi angka" two days after posting (js/next-action.js performanceCheckAction)
  "next.perfCheck.label": { en: "Add the numbers for \"{title}\"", id: "Isi angka \"{title}\"" },
  "next.perfCheck.why2": { en: "It went up {days} days ago, so the first numbers are in. One quick entry and Brandlab learns which posts work.", id: "Sudah {days} hari sejak tayang, angka awalnya sudah kebaca. Sekali isi, Brandlab jadi tahu konten mana yang jalan." },
  "next.perfCheck.why7": { en: "A week since it went up: the numbers have settled. Update them once more so your report is right.", id: "Seminggu sejak tayang, angkanya sudah stabil. Perbarui sekali lagi biar laporannya akurat." },
  "next.perfCheck.more": { en: "{n} more posts are waiting for numbers too.", id: "{n} konten lain juga menunggu angkanya." },
  "next.perfCheck.more.one": { en: "{n} more post is waiting for numbers too.", id: "{n} konten lain juga menunggu angkanya." },
  "next.perfCheck.cta": { en: "Add numbers", id: "Isi angka" },

  // Low AI credit (js/ai-low-credit.js)
  "aiLow.day": { en: "{n} AI credits left today. They refill tomorrow, and everything without AI keeps working.", id: "Kredit AI kamu sisa {n} untuk hari ini. Besok terisi lagi, dan fitur tanpa AI tetap jalan seperti biasa." },
  "aiLow.day.one": { en: "{n} AI credit left today. It refills tomorrow, and everything without AI keeps working.", id: "Kredit AI kamu sisa {n} untuk hari ini. Besok terisi lagi, dan fitur tanpa AI tetap jalan seperti biasa." },
  "aiLow.month": { en: "{n} AI credits left this month. They refill at the start of next month; everything without AI keeps working.", id: "Kredit AI kamu sisa {n} bulan ini. Awal bulan depan terisi lagi; fitur tanpa AI tetap jalan." },
  "aiLow.month.one": { en: "{n} AI credit left this month. It refills at the start of next month; everything without AI keeps working.", id: "Kredit AI kamu sisa {n} bulan ini. Awal bulan depan terisi lagi; fitur tanpa AI tetap jalan." },
  "aiLow.total": { en: "{n} AI credits left in your trial. When they run out, AI features pause until you pick a plan; everything else keeps working.", id: "Kredit AI trial kamu sisa {n}. Kalau habis, fitur AI berhenti dulu sampai kamu pilih paket; fitur lain tetap jalan." },
  "aiLow.total.one": { en: "{n} AI credit left in your trial. When it runs out, AI features pause until you pick a plan; everything else keeps working.", id: "Kredit AI trial kamu sisa {n}. Kalau habis, fitur AI berhenti dulu sampai kamu pilih paket; fitur lain tetap jalan." },

  // Pro analytics: the "Performing content" period picker (js/views/brand-home-analytics.js)
  "bha.periodAria": { en: "Period", id: "Periode" },

  // Saved ideas in the Content Bank (js/views/calendar.js)
  "bankIdea.group": { en: "Saved ideas", id: "Ide tersimpan" },
  "bankIdea.discuss": { en: "Discuss in chat", id: "Bahas di chat" },
  "bankIdea.discussAria": { en: "Discuss in chat: {title}", id: "Bahas di chat: {title}" },
  "bankIdea.place": { en: "Schedule this idea: tap a date", id: "Jadwalkan ide ini: ketuk tanggal" },
  "bankIdea.scheduled": { en: "The idea is on the calendar now, as a new piece of content.", id: "Ide masuk kalender sebagai konten baru." },
};
