// Retention / watch-time analytics (js/retention.js), the insight
// screenshot reader (js/ai.js extractInsightsFromImage, js/ocr.js), the
// Quick Fill retention section (js/views/content-list.js), the Pro Home
// widgets (js/views/brand-home-analytics.js) and photos in the chat
// (js/consultant-panel.js).
export default {
  // Ratings / verdicts (js/retention.js)
  "ret.rating.good": { en: "Strong", id: "Bagus" },
  "ret.rating.average": { en: "Average", id: "Rata-rata" },
  "ret.rating.poor": { en: "Weak", id: "Lemah" },
  "ret.diag.hook": { en: "Most viewers leave in the first 3 seconds — the hook isn't stopping the scroll.", id: "Sebagian besar penonton pergi di 3 detik pertama — hook-nya belum bikin orang berhenti scroll." },
  "ret.diag.middle": { en: "The hook works, but viewers drift off mid-video — the middle needs tightening.", id: "Hook-nya jalan, tapi penonton kabur di tengah video — bagian tengahnya perlu dipadatkan." },
  "ret.diag.ending": { en: "People watch most of it but leave before the end — the closing and CTA get missed.", id: "Orang nonton hampir semua, tapi pergi sebelum selesai — penutup dan CTA-nya kelewat." },
  "ret.diag.loop": { en: "Average watch time is longer than the video — people are replaying it. Great sign.", id: "Rata-rata waktu tonton lebih panjang dari videonya — orang nonton ulang. Sinyal bagus." },
  "ret.diag.solid": { en: "Retention is strong across the board — this is a format worth repeating.", id: "Retensinya bagus dari awal sampai akhir — format ini layak diulang." },
  "ret.diag.mixed": { en: "Retention is okay, not great — small gains are possible in the hook and pacing.", id: "Retensinya lumayan, belum maksimal — hook dan tempo masih bisa dipoles." },
  "ret.diag.dropAt": { en: "Biggest drop at second {sec} ({pts} points).", id: "Drop terbesar di detik {sec} ({pts} poin)." },
  "ret.diag.holdButNoAction": { en: "Attention was held, yet engagement is low — the video asks for nothing. Add a clear reason to save, share or comment.", id: "Perhatian dapet, tapi engagement rendah — videonya nggak minta apa-apa. Kasih alasan jelas buat save, share, atau komen." },
  "ret.diag.nicheButLoyal": { en: "Many skip early, but those who stay engage a lot — the hook speaks to too few people, the content itself lands.", id: "Banyak yang skip di awal, tapi yang bertahan engagement-nya tinggi — hook-nya cuma nyangkut ke sedikit orang, isinya sendiri kena." },

  // Metric labels
  "ret.field.videoLengthSec": { en: "Video length (sec)", id: "Durasi video (dtk)" },
  "ret.field.avgWatchTimeSec": { en: "Avg watch time (sec)", id: "Rata-rata ditonton (dtk)" },
  "ret.field.hookPct": { en: "Still watching at 3s (%)", id: "Masih nonton di detik 3 (%)" },
  "ret.field.completionPct": { en: "Watched to the end (%)", id: "Nonton sampai habis (%)" },
  "ret.kpi.hook": { en: "Hook (3s)", id: "Hook (3 dtk)" },
  "ret.kpi.watch": { en: "Avg watched", id: "Rata-rata ditonton" },
  "ret.kpi.completion": { en: "Finished", id: "Selesai ditonton" },
  "ret.kpi.of": { en: "of length", id: "dari durasi" },

  // Quick Fill (js/views/content-list.js)
  "ret.qf.dropTitle": { en: "Drop insight screenshots here, or click to choose", id: "Tarik screenshot insight ke sini, atau klik untuk pilih" },
  "ret.qf.dropSub": { en: "Numbers or the retention graph — Instagram, TikTok. Several at once is fine.", id: "Angka atau grafik retensi — Instagram, TikTok. Boleh beberapa sekaligus." },
  "ret.qf.reading": { en: "Reading screenshot {n} of {total}…", id: "Membaca screenshot {n} dari {total}…" },
  "ret.qf.readAi": { en: "AI read it", id: "Dibaca AI" },
  "ret.qf.readOcr": { en: "Read by text scan (set up AI in Settings for the graph too)", id: "Dibaca lewat scan teks (aktifkan AI di Pengaturan supaya grafiknya ikut terbaca)" },
  "ret.qf.found": { en: "{metrics} numbers · retention {ret}", id: "{metrics} angka · retensi {ret}" },
  "ret.qf.foundRet": { en: "found", id: "terbaca" },
  "ret.qf.noRet": { en: "not found", id: "tidak ada" },
  "ret.qf.section": { en: "Retention (watch time)", id: "Retensi (watch time)" },
  "ret.qf.sectionSub": { en: "Filled from the retention graph screenshot — fix any number by hand.", id: "Terisi dari screenshot grafik retensi — angka bisa dikoreksi manual." },
  "ret.qf.verdictTitle": { en: "Reading", id: "Bacaan" },
  "ret.qf.noVerdict": { en: "Add the video length and at least one retention number to get a reading.", id: "Isi durasi video dan minimal satu angka retensi untuk dapat bacaan." },

  // Home widgets (js/views/brand-home-analytics.js)
  "brandHome.analytics.widget.retention": { en: "Retention (watch time)", id: "Retensi (watch time)" },
  "brandHome.analytics.widget.retentionRanking": { en: "Retention by content", id: "Retensi per konten" },
  "brandHome.analytics.widget.engagementMix": { en: "Engagement mix (per reach)", id: "Komposisi engagement (per reach)" },
  "brandHome.analytics.empty.retention": { en: "No retention data yet. Open a published post → Fill engagement → drop the retention graph screenshot.", id: "Belum ada data retensi. Buka konten terbit → Isi engagement → tarik screenshot grafik retensinya." },
  "brandHome.analytics.empty.engagementMix": { en: "Needs reach plus saves, shares or comments on published posts.", id: "Butuh reach plus saves, shares, atau komentar di konten terbit." },
  "ret.widget.n": { en: "{n} posts with data", id: "{n} konten ada data" },
  "ret.widget.askAi": { en: "Ask AI for advice", id: "Minta saran AI" },
  "ret.widget.askAi.seed": { en: "Analyze my content's retention and tell me exactly what to fix first.", id: "Analisis retensi konten aku dan kasih tahu persisnya apa yang harus dibenahi dulu." },
  "ret.widget.topDiag": { en: "Most common issue: ", id: "Masalah paling sering: " },
  "ret.diagShort.hook": { en: "weak hook", id: "hook lemah" },
  "ret.diagShort.middle": { en: "drop-off mid-video", id: "kabur di tengah" },
  "ret.diagShort.ending": { en: "leave before the end", id: "pergi sebelum selesai" },
  "ret.diagShort.mixed": { en: "so-so retention", id: "retensi setengah-setengah" },
  "ret.mix.saveRate": { en: "Saves", id: "Saves" },
  "ret.mix.shareRate": { en: "Shares", id: "Shares" },
  "ret.mix.commentRate": { en: "Comments", id: "Komentar" },
  "ret.mix.likeRate": { en: "Likes", id: "Likes" },
  "ret.mix.hint": { en: "Saves and shares are the distribution signals — above ~1% of reach each is strong.", id: "Saves dan shares itu sinyal distribusi — di atas ~1% dari reach masing-masing sudah bagus." },

  // Chat photos (js/consultant-panel.js)
  "chat.image.attach": { en: "Attach a screenshot", id: "Lampirkan screenshot" },
  "chat.image.remove": { en: "Remove image", id: "Hapus gambar" },
  "chat.image.defaultQuestion": { en: "Read this screenshot and tell me what to improve.", id: "Baca screenshot ini dan kasih tahu apa yang perlu dibenahi." },
  "chat.image.max": { en: "Up to {n} images per message.", id: "Maksimal {n} gambar per pesan." },
  "chat.image.ocrNote": { en: "Only the text in the screenshot could be read this time — not the graph itself.", id: "Kali ini yang terbaca cuma teks di screenshot — grafiknya belum ikut terbaca." },
  "chat.image.ocrEmpty": { en: "No readable text found in the screenshot.", id: "Tidak ada teks yang bisa dibaca dari screenshot." },
  "chat.image.tooBig": { en: "That image couldn't be read.", id: "Gambar itu tidak bisa dibaca." },
  "chat.metrics.title": { en: "Numbers read from the photo", id: "Angka yang terbaca dari foto" },
  "chat.metrics.save": { en: "Save to a post…", id: "Simpan ke konten…" },
  "chat.metrics.saved": { en: "Saved to \"{title}\"", id: "Tersimpan ke \"{title}\"" },
  "chat.metrics.pickTitle": { en: "Which post are these numbers for?", id: "Angka ini untuk konten yang mana?" },
  "chat.metrics.pickSearch": { en: "Search a published post…", id: "Cari konten terbit…" },
  "chat.metrics.pickEmpty": { en: "No published posts yet.", id: "Belum ada konten terbit." },

  // AI (js/ai.js)
  "ai.error.noVision.user": { en: "This photo can't be read by the AI right now. Type the numbers instead, or try again later.", id: "Foto ini belum bisa dibaca AI sekarang. Ketik angkanya aja, atau coba lagi nanti." },
  "ai.error.noVision": { en: "{provider} can't read images. Switch to Claude or Gemini in Settings → AI.", id: "{provider} nggak bisa membaca gambar. Ganti ke Claude atau Gemini di Pengaturan → AI." },
  "ai.error.badExtract": { en: "The screenshot couldn't be read as insight numbers.", id: "Screenshot itu tidak terbaca sebagai angka insight." },
};
