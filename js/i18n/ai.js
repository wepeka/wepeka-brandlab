// i18n dictionary — User-facing AI errors/labels in ai.js, ai-feedback, ai-usage, voice input. Key prefix: ai.
// Shape: "key": { en: "...", id: "..." }. Merged into js/i18n.js.
export default {
  // js/ai.js — request / provider errors
  "ai.error.quota": { en: "You've used up today's AI quota ({limit} uses). It resets automatically tomorrow. Need more? Contact Wepeka to top up.", id: "Jatah AI hari ini sudah habis ({limit} kali). Reset otomatis besok. Butuh lebih? Hubungi Wepeka buat tambah jatah." },
  "ai.error.quotaMonth": { en: "You've used up this month's AI credits ({limit}). They reset automatically on the 1st. Need more? Contact Wepeka to top up.", id: "AI credit bulan ini sudah habis ({limit}). Reset otomatis tanggal 1. Butuh lebih? Hubungi Wepeka buat top-up." },
  "ai.error.quotaTotal": { en: "You've used all {limit} AI credits included in your trial. Everything you've built is saved — upgrade to keep generating.", id: "AI credit trial kamu ({limit}) sudah habis semua. Semua yang udah kamu buat aman tersimpan — upgrade buat lanjut generate." },
  "ai.error.readonly": { en: "This account is in view-only mode — pick a plan to use AI again. Your data is all still here.", id: "Akun ini lagi mode lihat-saja — pilih paket dulu buat pakai AI lagi. Semua datamu tetap aman." },
  "ai.error.noKey": { en: "No {provider} API key set yet. Add one in Settings → AI.", id: "API key {provider} belum diisi. Isi dulu di Pengaturan → AI." },
  "ai.error.provider": { en: "{provider} error: {message}", id: "Error dari {provider}: {message}" },
  "ai.error.requestFailed": { en: "{provider} request failed ({status}). Try again in a moment.", id: "Permintaan ke {provider} gagal ({status}). Coba lagi sebentar lagi." },
  "ai.error.network": { en: "Couldn't reach {provider}. Check your internet connection and try again.", id: "Nggak bisa terhubung ke {provider}. Cek koneksi internet kamu, lalu coba lagi." },
  "ai.error.badResponse": { en: "{provider} sent back a response the app couldn't read. Try again.", id: "Balasan dari {provider} nggak bisa dibaca aplikasi. Coba lagi." },
  "ai.error.noKey.user": { en: "The AI isn't available right now. Try again in a moment — if it keeps happening, message the Wepeka team.", id: "AI-nya lagi belum bisa dipakai. Coba lagi sebentar — kalau masih, kabari tim Wepeka ya." },
  "ai.error.setup": { en: "The AI key isn't set on the server yet: add {key} in Vercel (project content-os → Settings → Environment Variables), then redeploy.", id: "Kunci AI belum dipasang di server: tambahkan {key} di Vercel (proyek content-os → Settings → Environment Variables), lalu redeploy." },
  "ai.error.setup.user": { en: "The AI isn't switched on yet. Try again later — if it keeps happening, let the Wepeka team know.", id: "AI-nya belum diaktifkan. Coba lagi nanti ya — kalau masih begini, kabari tim Wepeka." },
  "ai.error.noServer": { en: "AI doesn't run on this local server (it has no /api). Try it on planner.wepeka.com.", id: "AI nggak jalan di server lokal ini (tidak ada /api). Coba di planner.wepeka.com." },
  "ai.error.provider.user": { en: "The AI is having trouble right now. Try again in a moment.", id: "AI-nya lagi gangguan. Coba lagi sebentar ya." },
  "ai.error.requestFailed.user": { en: "The AI is busy right now. Try again in a moment.", id: "AI-nya lagi sibuk. Coba lagi sebentar ya." },
  "ai.error.network.user": { en: "Couldn't reach the AI. Check your internet connection and try again.", id: "Nggak bisa nyambung ke AI. Cek koneksi internet kamu, lalu coba lagi." },
  "ai.error.badResponse.user": { en: "The AI's answer came back garbled. Try again.", id: "Jawaban AI-nya kacau. Coba lagi ya." },
  "ai.error.emptyResponse": { en: "The AI didn't give an answer. Try again.", id: "AI nggak ngasih jawaban. Coba lagi." },
  "ai.error.unreadable": { en: "The AI didn't return a result the app could read. Try again.", id: "AI nggak ngasih hasil yang bisa dibaca. Coba lagi." },
  "ai.error.readEdit": { en: "Couldn't read the edited text from the AI. Try again.", id: "Gagal membaca hasil edit dari AI. Coba lagi." },
  "ai.error.readSchedule": { en: "Couldn't read a schedule from the AI's response. Try again.", id: "Gagal membaca jadwal dari jawaban AI. Coba lagi." },
  "ai.error.funnel": { en: "Couldn't figure out a funnel stage for this content.", id: "Tahap funnel untuk konten ini nggak bisa ditentukan." },
  "ai.error.noCampaigns": { en: "This brand has no campaigns yet. Create one first.", id: "Brand ini belum punya campaign. Bikin satu dulu, ya." },
  "ai.error.readCampaignFit": { en: "Couldn't read a campaign suggestion from the AI's response. Try again.", id: "Gagal membaca saran campaign dari jawaban AI. Coba lagi." },
  "ai.error.readOptions": { en: "Couldn't read answer options from the AI's response. Try again.", id: "Gagal membaca pilihan jawaban dari jawaban AI. Coba lagi." },
  "ai.error.readDnaDraft": { en: "Couldn't read the Brand DNA draft from the AI's response. Try again.", id: "Gagal membaca draft Brand DNA dari jawaban AI. Coba lagi." },
  "ai.error.readIdeas": { en: "Couldn't read content ideas from the AI's response. Try again.", id: "Gagal membaca ide konten dari jawaban AI. Coba lagi." },
  "ai.error.readValueProp": { en: "Couldn't read the value proposition from the AI's response. Try again.", id: "Gagal membaca value proposition dari jawaban AI. Coba lagi." },
  "ai.error.readColorEssence": { en: "Couldn't read the color essence from the AI's response. Try again.", id: "Gagal membaca makna warna dari jawaban AI. Coba lagi." },

  // js/ai.js — screens the AI consultant can link to (CONSULTANT_ROUTES)
  "ai.route.dna": { en: "Brand DNA", id: "Brand DNA" },
  "ai.route.guidelines": { en: "Brand Guidelines", id: "Panduan Brand" },
  "ai.route.builder": { en: "Brand Builder", id: "Brand Builder" },
  "ai.route.campaigns": { en: "Goals", id: "Tujuan" },
  "ai.route.contentOs": { en: "Content", id: "Konten" },
  "ai.route.contentList": { en: "Content List", id: "Daftar Konten" },
  "ai.route.creator": { en: "Creator", id: "Creator" },
  "ai.route.calendar": { en: "Calendar", id: "Kalender" },
  "ai.route.sales": { en: "Sales tracker", id: "Pelacak Penjualan" },
  "ai.route.copy": { en: "Quick copy", id: "Tulisan Cepat" },
  "ai.route.brainstorm": { en: "Brainstorm", id: "Brainstorm" },
  "ai.route.home": { en: "Brand Home", id: "Beranda Brand" },

  // js/ai-feedback.js
  "ai.feedback.question": { en: "Was this helpful?", id: "Hasilnya membantu?" },
  "ai.feedback.up": { en: "Helpful", id: "Membantu" },
  "ai.feedback.down": { en: "Not helpful", id: "Kurang membantu" },
  "ai.feedback.notePlaceholder": { en: "What was missing? (optional)", id: "Apa yang kurang? (opsional)" },
  "ai.feedback.send": { en: "Send", id: "Kirim" },
  "ai.feedback.thanks": { en: "Thanks, we've noted your feedback.", id: "Makasih, masukanmu dicatat." },

  // js/voice-input.js
  "ai.voice.unsupported": { en: "Voice input isn't supported in this browser", id: "Input suara nggak didukung di browser ini" },
  "ai.voice.error": { en: "Voice input error: {error}", id: "Input suara bermasalah: {error}" },
  "ai.auto.reason": { en: "Updated on its own because: {reason}", id: "Diperbarui otomatis karena: {reason}" },
  "ai.auto.busy": { en: "Something new happened ({reason}) — updating…", id: "Ada kabar baru ({reason}) — lagi memperbarui…" },
  "ai.auto.today": { en: "updated on its own today", id: "diperbarui otomatis hari ini" },

  // api/ai.js's server-side error codes, mapped in js/ai.js's proxyError()
  "ai.error.session": { en: "Your session expired — log in again and try that once more.", id: "Sesi kamu habis — login lagi, lalu coba sekali lagi." },
  "ai.error.deactivated": { en: "This account has been deactivated. Contact Wepeka for help.", id: "Akun ini sudah dinonaktifkan. Hubungi Wepeka untuk bantuan." },

  // js/views/brands.js — the brand modal's audience-language select
  "ai.audienceLang.label": { en: "Audience language", id: "Bahasa audiens" },
  "ai.audienceLang.hint": {
    en: "Which language AI-written content for this brand's audience (scripts, copy, campaign plans) uses. Leave on \"Follow app language\" unless this brand's audience reads a different one.",
    id: "Bahasa apa yang dipakai AI untuk konten buat audiens brand ini (naskah, tulisan, rencana campaign). Biarkan di \"Ikuti bahasa aplikasi\" kalau audiens brand ini bahasanya sama.",
  },
  "ai.audienceLang.auto": { en: "Follow app language", id: "Ikuti bahasa aplikasi" },
  "ai.audienceLang.id": { en: "Indonesian", id: "Bahasa Indonesia" },
  "ai.audienceLang.en": { en: "English", id: "Bahasa Inggris" },

  // js/views/settings.js — admin-only AI panel (Settings → AI)
  "ai.admin.enabledLabel": { en: "AI enabled for everyone", id: "AI aktif untuk semua orang" },
  "ai.admin.keysNote": {
    en: "The actual API key lives in a Vercel environment variable now (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY, matched against AI_PROVIDER) — never in Firestore or the browser. This just tells the app which provider is active.",
    id: "API key-nya sekarang disimpan di environment variable Vercel (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY, sesuai AI_PROVIDER) — bukan di Firestore atau browser lagi. Ini cuma kasih tahu aplikasi provider mana yang aktif.",
  },
  "ai.admin.clearOldKeys": { en: "Delete old keys from settings/main", id: "Hapus kunci lama dari settings/main" },
  "ai.admin.clearOldKeysConfirmBody": {
    en: "This removes any anthropicApiKey/geminiApiKey/deepseekApiKey fields still sitting in settings/main.ai from before the AI proxy — they're unused now. Safe to run even if they're already gone.",
    id: "Ini menghapus field anthropicApiKey/geminiApiKey/deepseekApiKey yang mungkin masih ada di settings/main.ai dari sebelum ada AI proxy — sudah nggak dipakai lagi. Aman dijalankan meski sudah nggak ada.",
  },
  "ai.admin.clearOldKeysDone": { en: "Old keys removed (or were already gone).", id: "Kunci lama sudah dihapus (atau memang sudah nggak ada)." },
};
