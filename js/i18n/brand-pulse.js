// i18n dictionary — Brand Pulse signals (js/brand-pulse.js) and the Home
// Companion card (js/views/home.js). Key prefix: pulse.
// Shape: "key": { en: "...", id: "..." }. Merged into js/i18n.js.
export default {
  "pulse.untitledContent": { en: "Untitled content", id: "Konten tanpa judul" },

  "pulse.viral.title": { en: "\"{title}\" is taking off", id: "\"{title}\" lagi naik" },
  "pulse.viral.detailMedian": { en: "{views} views vs a median of {median}", id: "{views} views vs median {median}" },
  "pulse.viral.detailLow": { en: "{views} views — well above what this brand usually gets", id: "{views} views — jauh di atas biasanya" },

  "pulse.topFormat.title": { en: "{format} · {funnel} is this brand's best format right now", id: "{format} · {funnel} lagi jadi format terbaik" },
  "pulse.topFormat.detail": { en: "{count} posts averaging {er}% ER vs the brand's {brandEr}% average", id: "{count} post rata-rata ER {er}% vs rata-rata brand {brandEr}%" },

  "pulse.engagementDrop.title": { en: "Engagement has been slipping", id: "Engagement lagi turun" },
  "pulse.engagementDrop.detail": { en: "Last 5 posts averaged {recent}% ER, down from {prev}% before that", id: "5 post terakhir rata-rata ER {recent}%, turun dari {prev}% sebelumnya" },

  "pulse.followerJump.title": { en: "{platform} followers jumped", id: "Followers {platform} melonjak" },
  "pulse.followerJump.detail": { en: "+{delta} ({pct}%) since the last check", id: "+{delta} ({pct}%) sejak pengecekan terakhir" },
  "pulse.followerDrop.title": { en: "{platform} followers dropped", id: "Followers {platform} turun" },
  "pulse.followerDrop.detail": { en: "{delta} ({pct}%) since the last check", id: "{delta} ({pct}%) sejak pengecekan terakhir" },

  "pulse.salesUp.title": { en: "Sales are up this week", id: "Penjualan lagi naik minggu ini" },
  "pulse.salesUp.detail": { en: "+{pct}% vs the past 4 weeks' average", id: "+{pct}% vs rata-rata 4 minggu sebelumnya" },
  "pulse.salesDown.title": { en: "Sales are down this week", id: "Penjualan lagi turun minggu ini" },
  "pulse.salesDown.detail": { en: "-{pct}% vs the past 4 weeks' average", id: "-{pct}% vs rata-rata 4 minggu sebelumnya" },

  "pulse.streakBreak.title": { en: "Your {weeks}-week posting streak is at risk", id: "Streak posting {weeks} minggu berturut-turut berisiko putus" },
  "pulse.streakBreak.detail": { en: "Breaks in {days} day(s) without a new publish", id: "Putus dalam {days} hari kalau belum ada yang terbit" },

  "pulse.overdue.title": { en: "{count} piece(s) of content are overdue", id: "{count} konten sudah lewat jadwal" },
  "pulse.overdue.detail": { en: "Scheduled but not published yet", id: "Sudah dijadwalkan tapi belum terbit" },

  "pulse.staleCampaign.title": { en: "\"{name}\"'s numbers are out of date", id: "Angka campaign \"{name}\" sudah usang" },
  "pulse.staleCampaign.detail": { en: "The headline milestone hasn't been refreshed in a while", id: "Milestone utamanya belum diperbarui belakangan ini" },

  "pulse.log.auto": { en: "auto", id: "otomatis" },
  "pulse.log.note": { en: "owner's note", id: "catatan owner" },
  "pulse.log.ai": { en: "AI", id: "AI" },
  "pulse.header": { en: "What's happening in this brand (most recent first):", id: "Yang sedang terjadi di brand ini (terbaru dulu):" },
  "pulse.footer": { en: "Use this when recommending anything; favor what's already in motion.", id: "Pakai ini saat merekomendasikan; utamakan yang sedang jalan." },

  // Home Companion card (js/views/home.js)
  "home.companion.title": { en: "Companion", id: "Teman Brand" },
  "companion.greeting.morning": { en: "Morning! What happened with {brand} today?", id: "Pagi! Hari ini ada kejadian apa di {brand}?" },
  "companion.greeting.afternoon": { en: "Hey! Anything new with {brand} today?", id: "Halo! Hari ini ada kejadian apa di {brand}?" },
  "companion.greeting.evening": { en: "Evening! How did {brand} do today?", id: "Malam! Hari ini gimana kabarnya {brand}?" },
  "companion.observation.quiet": { en: "It's been quiet this week — nothing standing out yet.", id: "Minggu ini tenang — belum ada yang menonjol." },
  "companion.askAgain": { en: "Anything else you want to tell me?", id: "Ada lagi yang mau diceritakan?" },
  "companion.placeholder": { en: "Type or talk — a sale, a comment, anything…", id: "Ketik atau ngomong — ada penjualan, komen, apa aja…" },
  "companion.send": { en: "Send", id: "Kirim" },
  "companion.continueInBrainstorm": { en: "Keep talking in Brainstorm", id: "Lanjut ngobrol di Brainstorm" },
  "companion.action.similarContent": { en: "Make similar content", id: "Bikin konten serupa" },
  "companion.action.rideMomentum": { en: "Ride the momentum", id: "Manfaatkan momentum" },
  "companion.action.openCreator": { en: "Open Creator", id: "Buka Creator" },
  "companion.action.openSales": { en: "Open Sales Tracker", id: "Buka Sales Tracker" },
  "companion.log.title": { en: "Recent log", id: "Log terakhir" },
  "companion.log.summary": { en: "{n} new thing(s) this week", id: "{n} hal baru minggu ini" },
  "companion.log.empty": { en: "Nothing logged yet.", id: "Belum ada catatan." },
  "companion.saveFailed": { en: "Couldn't save that — try again.", id: "Gagal menyimpan — coba lagi." },
  "companion.aiUnavailable": { en: "Got it, noted. (AI can't reply right now.)", id: "Oke, dicatat. (AI belum bisa membalas sekarang.)" },
  "companion.seed.viral": { en: "{title} — riding the wave, let's make a follow-up", id: "{title} — lagi naik, bikin konten lanjutan yuk" },
  "companion.seed.followerJump": { en: "{platform} followers just jumped — how do we ride this momentum?", id: "Followers {platform} lagi melonjak — gimana manfaatin momentumnya?" },
};
