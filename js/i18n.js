// Minimal i18n: a flat key -> {en, id} dictionary, a t(key, vars) lookup,
// and a persisted language preference. Language switches reload the page
// (js/views/settings.js) rather than trying to live-reactively re-render
// every mounted view — simplest correct option in an app with no central
// render tree, and switching language is rare enough that a reload is fine.
import brand_guidelines from "./i18n/brand-guidelines.js";
import brand_dna_builder from "./i18n/brand-dna-builder.js";
import creator_copy from "./i18n/creator-copy.js";
import campaigns from "./i18n/campaigns.js";
import guides from "./i18n/guides.js";
import app_shell from "./i18n/app-shell.js";
import content from "./i18n/content.js";
import ai from "./i18n/ai.js";
import brand_pulse from "./i18n/brand-pulse.js";
import brainstorm from "./i18n/brainstorm.js";
import roadmap from "./i18n/roadmap.js";
import chat_hub from "./i18n/chat-hub.js";
import series from "./i18n/series.js";
import announcements from "./i18n/announcements.js";
import retention from "./i18n/retention.js";

const KEY = "wepeka-lang";

export function getLang() {
  return localStorage.getItem(KEY) === "en" ? "en" : "id";
}

export function setLang(lang) {
  localStorage.setItem(KEY, lang === "en" ? "en" : "id");
}

// Keys are grouped by the file/area they're used in, so a translator (or a
// future contributor) can find "where does this string render" quickly.
const CORE = {
  // Topbar / nav (js/layout.js)
  "nav.home": { en: "Home", id: "Beranda" },
  "nav.builder": { en: "Brand Builder", id: "Brand Builder" },
  "nav.main": { en: "Main menu", id: "Menu utama" },
  "nav.campaigns": { en: "Goals", id: "Tujuan" },
  "nav.sales": { en: "Sales Tracker", id: "Pelacak Penjualan" },
  "nav.allBrands": { en: "All Brands", id: "Semua Brand" },
  "nav.brand": { en: "Brand", id: "Brand" },
  "nav.content": { en: "Content", id: "Konten" },
  "topbar.menu": { en: "Menu", id: "Menu" },
  "common.more": { en: "More", id: "Lainnya" },
  "contentEditor.tab.schedule": { en: "Schedule", id: "Jadwal" },
  "contentEditor.advanced": { en: "Advanced", id: "Lanjutan" },
  "menu.modeSwitch": { en: "{current} mode · switch to {other}", id: "Mode {current} · pindah ke {other}" },
  "help.pageGuide": { en: "Guide for this page", id: "Panduan halaman ini" },
  "help.askAi": { en: "Ask Brandlab", id: "Tanya Brandlab" },
  "help.tour": { en: "Website tour", id: "Tur website" },
  "nav.locked": { en: "Opens once your brand identity is done", id: "Terbuka setelah identitas brand selesai" },
  // Home (js/views/home.js)
  "home.eyebrow": { en: "Home", id: "Beranda" },
  "home.sub.identity": { en: "First things first: build your brand identity.", id: "Satu langkah dulu: bangun identitas brand kamu." },
  "home.streak.line": { en: "🔥 {n} weeks in a row posting!", id: "🔥 {n} minggu berturut-turut posting!" },
  "home.identity.title": { en: "Build your brand identity", id: "Bangun identitas brand" },
  "home.identity.desc": { en: "Brand DNA is the base for every post and campaign. Finish this first — Konten is already open, and Tujuan unlocks once it's done.", id: "Brand DNA jadi dasar semua konten dan campaign. Selesaikan ini dulu — Konten sudah terbuka dari awal, dan Tujuan kebuka begitu ini selesai." },
  "home.identity.dna": { en: "Brand DNA", id: "Brand DNA" },
  "home.identity.book": { en: "Brand Book (colors, fonts, logo…)", id: "Brand Book (warna, font, logo…)" },
  "home.identity.bookBasics": { en: "Colors & fonts", id: "Warna & Font" },
  "home.identity.done": { en: "Done", id: "Selesai" },
  "home.identity.missing": { en: "Still to fill: {list}", id: "Tinggal diisi: {list}" },
  "home.identity.draftPending": { en: "All filled by AI — read it once and press Save so it counts as yours.", id: "Semua sudah diisi AI — baca sekali lalu tekan Simpan biar dihitung jawabanmu." },
  "home.identity.field.targetAudience": { en: "your customer", id: "pelanggan kamu" },
  "home.identity.field.problemSolved": { en: "their problem", id: "masalah mereka" },
  "home.identity.field.differentiation": { en: "why trust you", id: "kenapa percaya kamu" },
  "home.identity.field.mission": { en: "the 3-step plan", id: "rencana 3 langkah" },
  "home.identity.field.callToAction": { en: "your call to action", id: "ajakan kamu" },
  "home.identity.field.successOutcome": { en: "what changes for them", id: "hasil buat mereka" },
  "home.identity.field.failureOutcome": { en: "what they risk", id: "risiko kalau diam" },
  "home.identity.field.tagline": { en: "tagline", id: "tagline" },
  "home.identity.ctaStart": { en: "Start Brand DNA", id: "Mulai Brand DNA" },
  "home.identity.ctaContinue": { en: "Continue Brand DNA", id: "Lanjutkan Brand DNA" },
  "home.identity.ctaBook": { en: "Set colors & fonts", id: "Lengkapi Warna & Font" },
  "home.next.lockedToast": { en: "Finish your brand identity first — this opens right after.", id: "Selesaikan identitas brand dulu, bagian ini terbuka setelah itu." },
  "home.report": { en: "Report", id: "Laporan" },
  "topbar.toggleTheme": { en: "Toggle light/dark theme", id: "Ganti tema terang/gelap" },
  "topbar.notifications": { en: "Notifications", id: "Notifikasi" },
  "topbar.settings": { en: "Settings", id: "Pengaturan" },
  "topbar.logout": { en: "Log out", id: "Keluar" },
  "notif.overdue": { en: "Overdue", id: "Terlambat" },
  "notif.dueToday": { en: "Due today", id: "Jadwal hari ini" },
  "notif.dueSoon": { en: "Coming up soon", id: "Jadwal terdekat" },
  "notif.allCaughtUp": { en: "You're all caught up.", id: "Semua sudah beres." },

  // Settings (js/views/settings.js)
  "settings.title": { en: "Configure Wepeka Brandlab", id: "Atur Wepeka Brandlab" },
  "settings.sub": { en: "Your brands, language and account — plus the building blocks every brand shares.", id: "Brand, bahasa, dan akun kamu — plus bahan dasar yang dipakai semua brand." },
  "settings.panel.platforms": { en: "Platforms", id: "Platform" },
  "settings.panel.formats": { en: "Content formats", id: "Format konten" },
  "settings.panel.brands": { en: "Brand management", id: "Kelola Brand" },
  "settings.panel.ai": { en: "AI", id: "AI" },
  "settings.panel.bg": { en: "Brand background", id: "Background Brand" },
  "settings.panel.language": { en: "Language", id: "Bahasa" },
  "settings.panel.data": { en: "Data", id: "Data" },
  "settings.panel.trash": { en: "Trash", id: "Sampah" },
  "set.plan.title": { en: "Your plan", id: "Paket kamu" },
  "set.plan.next": { en: "Next plan", id: "Paket berikutnya" },
  "set.plan.nextValue": { en: "{name} from {date}", id: "{name} mulai {date}" },
  "set.autoRenew.title": { en: "Auto-renew", id: "Perpanjang otomatis" },
  "set.autoRenew.row": { en: "{amount} · card {card} · next charge {date}", id: "{amount} · kartu {card} · tagihan berikutnya {date}" },
  "set.autoRenew.stop": { en: "Stop auto-renew", id: "Berhenti perpanjang otomatis" },
  "set.autoRenew.confirmTitle": { en: "Stop auto-renew?", id: "Berhenti perpanjang otomatis?" },
  "set.autoRenew.confirmBody": { en: "Your card won't be charged again. Everything you've paid for stays active until its end date.", id: "Kartumu tidak akan ditagih lagi. Yang sudah dibayar tetap aktif sampai tanggal berakhirnya." },
  "set.autoRenew.stopped": { en: "Auto-renew stopped.", id: "Perpanjang otomatis dihentikan." },
  "set.autoRenew.fail": { en: "Couldn't stop it — try again in a moment.", id: "Gagal menghentikan — coba lagi sebentar." },
  "set.plan.name": { en: "Plan", id: "Paket" },
  "set.plan.status": { en: "Status", id: "Status" },
  "set.plan.brands": { en: "Brands", id: "Brand" },
  "set.plan.trial": { en: "Free trial", id: "Trial gratis" },
  "set.plan.subscription": { en: "Subscription · {n} brand(s)", id: "Langganan · {n} brand" },
  "set.plan.status.trial": { en: "{n} day(s) left", id: "Sisa {n} hari" },
  "set.plan.status.lifetime": { en: "Forever — paid once", id: "Selamanya — sekali bayar" },
  "set.plan.status.until": { en: "Active until {date}", id: "Aktif sampai {date}" },
  "set.plan.status.active": { en: "Active", id: "Aktif" },
  "set.plan.status.readonly": { en: "View-only — pick a plan to keep working", id: "Lihat-saja — pilih paket untuk lanjut" },
  "set.plan.credits.day": { en: "{used} of {limit} used today", id: "{used} dari {limit} terpakai hari ini" },
  "set.plan.credits.month": { en: "{used} of {limit} used this month", id: "{used} dari {limit} terpakai bulan ini" },
  "set.plan.credits.total": { en: "{used} of {limit} used in your trial", id: "{used} dari {limit} terpakai selama trial" },
  "set.plan.creditsUnlimited": { en: "Unlimited", id: "Tanpa batas" },
  "set.plan.see": { en: "See plans", id: "Lihat paket" },
  "settings.panel.account": { en: "Account", id: "Akun" },
  "settings.language.title": { en: "Language", id: "Bahasa" },
  "settings.language.sub": { en: "Switches every label, button, and message in the app. Saved on this device.", id: "Mengganti semua label, tombol, dan pesan di aplikasi. Tersimpan di perangkat ini." },
  "settings.language.en": { en: "English", id: "English" },
  "settings.language.id": { en: "Bahasa Indonesia", id: "Bahasa Indonesia" },
  "settings.language.reloading": { en: "Switching language…", id: "Mengganti bahasa…" },

  // Proactive notification banner (js/proactive-notif.js)

  // Brand Home (js/views/brand-home.js)
  "brandHome.widget.campaign.count": { en: "{count} campaign(s)", id: "{count} campaign" },
  "brandHome.widget.contentOs.sub": { en: "{total} piece(s) · {published} published", id: "{total} konten · {published} terbit" },
  "brandHome.upNext.title": { en: "Up next", id: "Jadwal berikutnya" },
  "brandHome.upNext.calendarLink": { en: "Calendar →", id: "Kalender →" },
  "brandHome.analytics.title": { en: "Analytics", id: "Analitik" },
  "brandHome.analytics.customize": { en: "Customize", id: "Sesuaikan" },
  "brandHome.analytics.customizeHint": { en: "Show on Home", id: "Tampilkan di Home" },
  "brandHome.analytics.periodAll": { en: "All time", id: "Semua waktu" },
  "brandHome.analytics.empty.noPublished": { en: "Publish some content to see analytics here.", id: "Terbitkan konten dulu buat lihat analitiknya di sini." },
  "brandHome.analytics.empty.noWidgets": { en: "Nothing selected — click Customize to turn some widgets back on.", id: "Belum ada yang dipilih — klik Sesuaikan buat nyalain widget-nya lagi." },
  "brandHome.analytics.empty.trend": { en: "Not enough published content yet to chart a trend.", id: "Konten terbitnya belum cukup buat dibikin grafik tren." },
  "brandHome.analytics.empty.breakdown": { en: "No engagement data yet. Add likes and comments to your published posts and this fills in.", id: "Belum ada data engagement. Isi angka likes & komentar di konten yang sudah terbit, nanti ini terisi." },
  "brandHome.analytics.empty.topContent": { en: "No published content with views yet. Add the view count to a published post and it shows up here.", id: "Belum ada konten terbit dengan views. Isi jumlah views di konten yang sudah terbit, nanti muncul di sini." },
  "brandHome.analytics.empty.cta": { en: "Open Content", id: "Buka Konten" },
  "brandHome.analytics.empty.health": { en: "Publish content and add its performance numbers to see content health.", id: "Terbitkan konten dan isi angka performanya buat lihat kesehatan konten." },
  "brandHome.analytics.widget.growthViews": { en: "Views trend (8 weeks)", id: "Tren views (8 minggu)" },
  "brandHome.analytics.widget.growthEngagement": { en: "Engagement rate trend (8 weeks)", id: "Tren engagement rate (8 minggu)" },
  "brandHome.analytics.widget.topContent": { en: "Top-performing content", id: "Konten dengan performa terbaik" },
  "brandHome.analytics.widget.platformBreakdown": { en: "Performance by platform", id: "Performa per platform" },
  "brandHome.analytics.widget.formatBreakdown": { en: "Performance by format", id: "Performa per format" },
  "brandHome.analytics.widget.funnelBreakdown": { en: "Performance by funnel", id: "Performa per funnel" },
  "brandHome.analytics.widget.contentHealth": { en: "Content health", id: "Kesehatan konten" },

  // Shared across views
  "common.untitled": { en: "Untitled", id: "Tanpa judul" },
  "common.cancel": { en: "Cancel", id: "Batal" },
  "common.edit": { en: "Edit", id: "Edit" },
  "common.remove": { en: "Remove", id: "Hapus" },
  "common.scheduled": { en: "Scheduled", id: "Terjadwal" },
  "common.close": { en: "Close", id: "Tutup" },

  // Calendar (js/views/calendar.js)
  "calendar.dow.sun": { en: "Sun", id: "Min" },
  "calendar.dow.mon": { en: "Mon", id: "Sen" },
  "calendar.dow.tue": { en: "Tue", id: "Sel" },
  "calendar.dow.wed": { en: "Wed", id: "Rab" },
  "calendar.dow.thu": { en: "Thu", id: "Kam" },
  "calendar.dow.fri": { en: "Fri", id: "Jum" },
  "calendar.dow.sat": { en: "Sat", id: "Sab" },
  "calendar.month.0": { en: "January", id: "Januari" },
  "calendar.month.1": { en: "February", id: "Februari" },
  "calendar.month.2": { en: "March", id: "Maret" },
  "calendar.month.3": { en: "April", id: "April" },
  "calendar.month.4": { en: "May", id: "Mei" },
  "calendar.month.5": { en: "June", id: "Juni" },
  "calendar.month.6": { en: "July", id: "Juli" },
  "calendar.month.7": { en: "August", id: "Agustus" },
  "calendar.month.8": { en: "September", id: "September" },
  "calendar.month.9": { en: "October", id: "Oktober" },
  "calendar.month.10": { en: "November", id: "November" },
  "calendar.month.11": { en: "December", id: "Desember" },
  "calendar.autoschedule.noKey": { en: "The AI isn't available right now. Try again in a moment — if it keeps happening, message the Wepeka team.", id: "AI-nya lagi belum bisa dipakai. Coba lagi sebentar — kalau masih, kabari tim Wepeka ya." },
  "calendar.autoschedule.nothingToSchedule": { en: "Nothing unscheduled to auto-schedule right now.", id: "Tidak ada konten yang perlu dijadwalkan otomatis sekarang." },
  "calendar.autoschedule.asking": { en: "Asking AI for a schedule for {count} item(s)…", id: "Meminta AI menyusun jadwal untuk {count} konten…" },
  "calendar.autoschedule.noResult": { en: "AI didn't return a usable schedule — try again.", id: "AI tidak mengembalikan jadwal yang bisa dipakai — coba lagi." },
  "calendar.autoschedule.failed": { en: "Couldn't auto-schedule.", id: "Gagal menjadwalkan otomatis." },
  "calendar.autoschedule.reviewTitle": { en: "Review AI schedule", id: "Tinjau Jadwal AI" },
  "calendar.autoschedule.reviewSub": { en: "Nothing is scheduled yet — review the dates below (or adjust any of them), then confirm.", id: "Belum ada yang dijadwalkan — tinjau tanggal di bawah (atau ubah), lalu konfirmasi." },
  "calendar.autoschedule.confirm": { en: "Confirm & add to calendar", id: "Konfirmasi & Tambah ke Kalender" },
  "calendar.autoschedule.done": { en: "Scheduled {count} item(s) — drag any of them to adjust further.", id: "{count} konten terjadwal — seret untuk menyesuaikan lagi." },
  "calendar.eyebrow": { en: "Content calendar", id: "Kalender Konten" },
  "calendar.autoscheduleBtn": { en: "AI Auto-Schedule", id: "Jadwal Otomatis AI" },
  "calendar.editCadenceBtn": { en: "Work schedule", id: "Jadwal Kerja" },
  "calendar.newContentBtn": { en: "New content", id: "Konten Baru" },
  "calendar.prevPeriod": { en: "Previous period", id: "Periode sebelumnya" },
  "calendar.nextPeriod": { en: "Next period", id: "Periode berikutnya" },
  "calendar.today": { en: "Today", id: "Hari Ini" },
  "calendar.view.month": { en: "Month", id: "Bulan" },
  "calendar.view.week": { en: "Week", id: "Minggu" },
  "calendar.view.day": { en: "Day", id: "Hari" },
  "calendar.more": { en: "+{count} more", id: "+{count} lagi" },
  "calendar.untitledCampaign": { en: "Untitled campaign", id: "Campaign tanpa nama" },
  "calendar.agendaEmpty": { en: "Nothing on the calendar this {view} yet", id: "Belum ada konten di {view} ini" },
  "calendar.agendaEmptyBody": { en: "Schedule an idea you already have, or make a new one.", id: "Jadwalkan ide yang sudah ada, atau bikin konten baru." },
  "calendar.funnelClash": { en: "Heads up: {date} already has another {funnel} piece scheduled.", id: "Perhatian: {date} sudah ada konten {funnel} lain yang terjadwal." },
  "calendar.removeFromCalendar": { en: "Remove from calendar", id: "Hapus dari kalender" },
  "calendar.removeConfirmTitle": { en: "Remove from calendar?", id: "Hapus dari kalender?" },
  "calendar.removeConfirmMsg": { en: "This just clears its scheduled date — the content itself stays, and it shows back up in the list of undated content (click any date box).", id: "Ini cuma menghapus tanggal jadwalnya — kontennya tetap ada, dan muncul lagi di daftar konten tanpa tanggal (klik kotak tanggal mana pun)." },
  "calendar.removedToast": { en: "Removed from calendar", id: "Dihapus dari kalender" },
  "calendar.dateBankEmpty": { en: "Nothing unscheduled right now.", id: "Belum ada yang perlu dijadwalkan sekarang." },
  "calendar.contentBankBtn": { en: "Content Bank", id: "Bank Konten" },
  "calendar.bank.title": { en: "Content Bank", id: "Bank Konten" },
  "calendar.bank.hint": { en: "Content with no date yet. Drag one onto a day, or tap the calendar icon then tap a date. Click a title to open it.", id: "Konten yang belum punya tanggal. Seret ke salah satu hari, atau ketuk ikon kalender lalu ketuk tanggalnya. Klik judulnya untuk membuka." },
  "calendar.bank.empty": { en: "Nothing unscheduled — everything's on the calendar already.", id: "Tidak ada yang belum dijadwalkan — semua sudah masuk kalender." },
  "calendar.bank.drafting": { en: "Drafting", id: "Draf" },
  "calendar.bank.execution": { en: "Shooting", id: "Produksi" },
  "calendar.bank.editing": { en: "Editing", id: "Editing" },
  "calendar.bank.readyToUpload": { en: "Ready to upload", id: "Siap upload" },
  "calendar.bank.overdue": { en: "Missed its date — reschedule", id: "Lewat jadwal — jadwalkan ulang" },
  "calendar.bank.place": { en: "Pick a date for this", id: "Pilih tanggal untuk konten ini" },
  "calendar.bank.placing": { en: "Tap a date on the calendar for {title}.", id: "Ketuk tanggal di kalender untuk {title}." },
  "calendar.bank.dropBack": { en: "Drop here to take it off the calendar", id: "Lepas di sini untuk mengeluarkan dari kalender" },
  "calendar.bank.movedBack": { en: "Back in the Content Bank — no date yet", id: "Balik ke Bank Konten — belum ada tanggal" },
  "cal.bank.showAll": { en: "Show all content", id: "Tampilkan semua konten" },
  "calendar.createNewContent": { en: "Create new content", id: "Buat konten baru" },
  // Clear one month (js/views/calendar.js openClearMonth, in "Atur jadwal")
  // — same effect as "Remove from calendar" (openCalItemMenu) on every
  // ticked piece at once: content stays, only its date is cleared, so it
  // lands back in the Content Bank instead of being deleted.
  "calendar.clear.btn": { en: "Clear {month}", id: "Kosongkan {month}" },
  "calendar.clear.desc": { en: "Take the upcoming pieces of this month off the calendar. They go back to the Content Bank — nothing is deleted.", id: "Lepas tanggal konten yang akan datang di bulan ini. Kontennya balik ke Bank Konten — tidak ada yang dihapus." },
  "calendar.clear.empty": { en: "Nothing upcoming is scheduled in {month} — nothing to clear.", id: "Tidak ada konten terjadwal yang akan datang di {month} — tidak ada yang perlu dikosongkan." },
  "calendar.clear.title": { en: "Clear {month}?", id: "Kosongkan {month}?" },
  "calendar.clear.sub": { en: "Ticked pieces lose their date only — the content itself stays and goes back to the Content Bank. Untick anything you want to keep on the calendar. Already-published content is never touched.", id: "Konten yang dicentang cuma dilepas tanggalnya — kontennya tetap ada dan balik ke Bank Konten. Hapus centang yang mau tetap di kalender. Konten yang sudah published tidak diubah." },
  "calendar.clear.confirm": { en: "Clear {count} piece(s)", id: "Kosongkan {count} konten" },
  "calendar.clear.done": { en: "{count} piece(s) cleared from {month} — back in the Content Bank.", id: "{count} konten dikosongkan dari {month} — balik ke Bank Konten." },

  // Content wrapper (js/views/content-os.js)
  // "Content List", not "Content" — the top-level nav tab is already
  // "Konten"/"Content" (nav.content below); this sub-tab needs its own
  // name so a tab isn't sitting inside a tab of the same name.
  "contentOs.tab.list": { en: "Content List", id: "Daftar Konten" },
  "contentOs.tab.creator": { en: "Creator", id: "Creator" },
  "contentOs.tab.calendar": { en: "Calendar", id: "Kalender" },
  "contentOs.tab.copy": { en: "Quick copy", id: "Tulisan Cepat" },
  "contentOs.tab.series": { en: "Series", id: "Seri" },
  "contentOs.cadence.title": { en: "Set your work schedule", id: "Atur Jadwal Kerja" },
  "cadence.updatedFromWizard": { en: "Work schedule updated: {n} uploads a week. Change the days any time in Calendar → Work schedule.", id: "Jadwal Kerja diperbarui: {n} upload per minggu. Hari-harinya bisa diubah kapan saja di Kalender → Jadwal Kerja." },
  "evtabs.plan": { en: "Plan", id: "Rencana" },
  "evtabs.targets": { en: "Targets & checklist", id: "Target & checklist" },
  "evtabs.targetsLater": { en: "Appears once the plan is on your calendar", id: "Muncul setelah rencana dipasang ke kalender" },
  "contentOs.cadence.sub": { en: "This sets up AI Auto-Schedule in the Calendar for {brand} and fills in the Shoot/Edit/Upload rows in My Routine automatically — set it once here instead of in both places.", id: "Ini sekaligus ngatur Jadwal Otomatis AI di Kalender buat {brand} dan ngisi baris Syuting/Edit/Upload di My Routine otomatis — cukup atur sekali di sini, nggak perlu di dua tempat." },
  "contentOs.cadence.shootLabel": { en: "Which days do you shoot?", id: "Hari apa aja syuting?" },
  "contentOs.cadence.editLabel": { en: "Which days do you edit?", id: "Hari apa aja edit konten?" },
  "contentOs.cadence.uploadLabel": { en: "Which days do you upload?", id: "Hari apa aja upload?" },
  "contentOs.cadence.perDayLabel": { en: "How many pieces can you upload in a day?", id: "Berapa konten bisa di-upload dalam sehari?" },
  "contentOs.cadence.note": { en: "Even if more than 1 a day is allowed, the system still won't put 2 pieces of the same funnel stage (TOFU/MOFU/BOFU) on the same day.", id: "Walaupun bisa lebih dari 1 sehari, sistem tetap nggak akan naruh 2 konten dengan tahap funnel yang sama (TOFU/MOFU/BOFU) di hari yang sama." },
  "contentOs.cadence.skip": { en: "Later", id: "Nanti aja" },
  "contentOs.cadence.save": { en: "Save", id: "Simpan" },

  // Content list / Content Database (js/views/content-list.js)
  "common.delete": { en: "Delete", id: "Hapus" },
  "common.save": { en: "Save", id: "Simpan" },
  "contentList.views.all": { en: "All content", id: "Semua Konten" },
  "contentList.views.published": { en: "Published", id: "Terbit" },
  "contentList.views.drafts": { en: "Drafts & ideas", id: "Draf & Ide" },
  "contentList.views.archived": { en: "Archived", id: "Arsip" },
  "contentList.allSeries": { en: "All series", id: "Semua seri" },
  "contentList.age.week": { en: "This week", id: "Minggu ini" },
  "contentList.age.month": { en: "1 week – 1 month", id: "1 minggu – 1 bulan" },
  "contentList.age.old": { en: "Over 1 month", id: "Lebih dari 1 bulan" },
  "contentList.eyebrow": { en: "Content database", id: "Database Konten" },
  "contentList.newContent": { en: "New content", id: "Konten Baru" },
  "contentList.updateEngagement": { en: "Update engagement", id: "Update Engagement" },
  "contentList.moreActions": { en: "More actions", id: "Aksi lain" },
  "contentList.searchPlaceholder": { en: "Search titles or ideas…", id: "Cari judul atau ide…" },
  "contentList.searchAria": { en: "Search content", id: "Cari konten" },
  "contentList.allCampaigns": { en: "All campaigns", id: "Semua campaign" },
  "contentList.filter": { en: "Filter", id: "Filter" },
  "contentList.clearFilters": { en: "Clear filters", id: "Bersihkan filter" },
  "contentList.th.title": { en: "Title", id: "Judul" },
  "contentList.th.platformFormat": { en: "Platform / Format", id: "Platform / Format" },
  "contentList.th.campaign": { en: "Campaign", id: "Campaign" },
  "contentList.th.status": { en: "Status", id: "Status" },
  "contentList.th.date": { en: "Date", id: "Tanggal" },
  "contentList.th.views": { en: "Views", id: "Views" },
  "contentList.th.engagement": { en: "Engagement", id: "Engagement" },
  // ── Empty content list — two cases: nothing at all (with ready-to-click
  // starter ideas) vs. a filter/search that just has no match (js/views/
  // content-list.js, UI polish: empty states).
  "contentList.emptyNone.title": { en: "No content yet", id: "Belum ada konten" },
  "contentList.emptyNone.body": { en: "Create your first piece, or start from one of these ideas.", id: "Bikin konten pertamamu, atau mulai dari salah satu ide di bawah ini." },
  "contentList.emptyNone.ideasLabel": { en: "Or start from one of these", id: "Atau mulai dari salah satu ide ini" },
  "contentList.emptyNone.genericSubject": { en: "your product or service", id: "produk atau jasamu" },
  "contentList.emptyNone.genericAudience": { en: "your customers", id: "pelanggan kamu" },
  "contentList.emptyNone.idea1Title": { en: "Introduce {subject}", id: "Kenalan sama {subject}" },
  "contentList.emptyNone.idea1Body": { en: "A short post introducing {subject} to someone who's never heard of it — what it is and who it's for.", id: "Postingan singkat kenalin {subject} ke orang yang belum pernah dengar — apa itu dan buat siapa." },
  "contentList.emptyNone.idea2Title": { en: "Answer a common question", id: "Jawab pertanyaan yang sering ditanya" },
  "contentList.emptyNone.idea2Body": { en: "Pick the question {audience} ask most about {subject} and answer it in one post.", id: "Ambil pertanyaan yang paling sering ditanyain {audience} soal {subject}, terus jawab dalam satu postingan." },
  "contentList.emptyNone.idea3Title": { en: "Show the proof", id: "Tunjukkan buktinya" },
  "contentList.emptyNone.idea3Body": { en: "A testimonial, before/after, or behind-the-scenes that makes {subject} easy to trust.", id: "Testimoni, before/after, atau di balik layar yang bikin {subject} gampang dipercaya." },
  "contentList.emptyFiltered.title": { en: "No content matches", id: "Konten tidak ditemukan" },
  "contentList.emptyFiltered.body": { en: "Try a different search, or clear the filters.", id: "Coba kata kunci lain, atau hapus filternya." },
  "contentList.importInstagram": { en: "Import from Instagram", id: "Import dari Instagram" },
  "contentList.connectInEditBrand": { en: "(connect in Edit Brand)", id: "(hubungkan di Edit Brand)" },
  "contentList.refreshAllIg": { en: "Refresh all Instagram metrics", id: "Refresh Semua Metrik Instagram" },
  "contentList.deleteAllContent": { en: "Delete all content ({count})", id: "Hapus Semua Konten ({count})" },
  "contentList.nothingToDelete": { en: "There's no content to delete.", id: "Tidak ada konten untuk dihapus." },
  "contentList.deleteAllTitle": { en: "Move ALL content for this brand to Trash?", id: "Pindahkan SEMUA konten brand ini ke Sampah?" },
  "contentList.deleteAllMsg": { en: "Moves all {count} content record(s) for {brand} (including archived ones) to Trash together. Restore within {days} days in Settings → Trash, or they're gone for good.", id: "Memindahkan semua {count} konten milik {brand} (termasuk yang diarsip) ke Sampah bersamaan. Bisa dipulihkan dalam {days} hari lewat Pengaturan → Sampah, lewat itu hilang permanen." },
  "contentList.deleteEverything": { en: "Move to Trash", id: "Pindahkan ke Sampah" },
  "contentList.allContentDeleted": { en: "All content moved to Trash", id: "Semua konten dipindahkan ke Sampah" },
  "contentList.unarchive": { en: "Unarchive", id: "Keluarkan dari arsip" },
  "contentList.archive": { en: "Archive", id: "Arsipkan" },
  "contentList.contentRestored": { en: "Content restored", id: "Konten dipulihkan" },
  "contentList.contentArchived": { en: "Content archived", id: "Konten diarsipkan" },
  "contentList.deleteContentTitle": { en: "Move this content to Trash?", id: "Pindahkan konten ini ke Sampah?" },
  "contentList.contentDeleted": { en: "Content moved to Trash", id: "Konten dipindahkan ke Sampah" },
  "contentList.fillEngagement": { en: "Fill engagement", id: "Isi engagement" },
  "contentList.eq.title": { en: "Update engagement", id: "Update Engagement" },
  "contentList.eq.published": { en: "Published {date}", id: "Terbit {date}" },
  "contentList.eq.neverFilled": { en: " · Never filled in", id: " · Belum pernah diisi" },
  "contentList.eq.fill": { en: "Fill", id: "Isi" },
  "contentList.eq.allDone": { en: "All published content is up to date.", id: "Semua konten yang terbit sudah ter-update." },
  "contentList.eq.close": { en: "Close", id: "Tutup" },
  "contentList.qf.title": { en: "Fill in engagement", id: "Isi Engagement" },
  "contentList.qf.screenshotLabel": { en: "Insights screenshot", id: "Screenshot Insight" },
  "contentList.qf.dropSub": { en: "or click to browse — metrics get pulled automatically", id: "atau klik buat pilih file — metriknya diambil otomatis" },
  "contentList.qf.analyzing": { en: "Reading the screenshot…", id: "Lagi baca screenshot…" },
  "contentList.qf.analyzingPct": { en: "Reading the screenshot… {pct}%", id: "Lagi baca screenshot… {pct}%" },
  "contentList.qf.foundMetrics": { en: "Found {count} {metricWord} — double-check the numbers below before saving.", id: "Ketemu {count} {metricWord} — cek lagi angkanya di bawah sebelum simpan." },
  "contentList.qf.noMetricsFound": { en: "Couldn't confidently read any metrics — fill them in manually below.", id: "Nggak ada metrik yang kebaca dengan yakin — isi manual di bawah." },
  "contentList.qf.analyzeFailed": { en: "Couldn't analyze the image.", id: "Gagal analisis gambar." },
  "contentList.qf.backToList": { en: "Back to list", id: "Kembali ke daftar" },
  "contentList.qf.updatedToast": { en: '"{title}" updated.', id: '"{title}" diupdate.' },
  // #12: ad-hoc celebration (js/celebrate.js) when a Quick Fill save is what
  // pushes a piece's engagement rate into "good" — see openQuickFillModal.
  "celebrate.erWinTitle": { en: "Your content just hit a healthy ER! 🎉", id: "Kontenmu baru aja hit ER yang sehat! 🎉" },
  "contentList.fp.funnel": { en: "Funnel", id: "Funnel" },
  "contentList.fp.format": { en: "Format", id: "Format" },
  "contentList.fp.allFormats": { en: "All formats", id: "Semua format" },
  "contentList.fp.platform": { en: "Platform", id: "Platform" },
  "contentList.fp.allPlatforms": { en: "All platforms", id: "Semua platform" },
  "contentList.fp.age": { en: "Content age", id: "Umur konten" },
  "contentList.fp.allAges": { en: "Any age", id: "Semua umur" },
  "contentList.ig.refreshTitle": { en: "Refresh Instagram metrics", id: "Refresh Metrik Instagram" },
  "contentList.ig.refreshing": { en: "Refreshing…", id: "Memperbarui…" },
  "contentList.ig.close": { en: "Close", id: "Tutup" },
  "contentList.ig.done": { en: "Done — {ok} refreshed{failedPart}", id: "Selesai — {ok} diperbarui{failedPart}" },
  "contentList.ig.failedPart": { en: ", {count} failed", id: ", {count} gagal" },
  "contentList.ig.noneTracked": { en: "No Instagram content is being tracked yet — use Import from Instagram first.", id: "Belum ada konten Instagram yang dilacak — pakai Import dari Instagram dulu." },
  "contentList.ig.unreachable": { en: "Couldn't reach Instagram: {msg}", id: "Nggak bisa terhubung ke Instagram: {msg}" },

  // Performance stats — key prefix kept from an earlier standalone
  // "Dashboard" page; that page is gone, this data now lives in the
  // Report PDF (js/views/report.js) and Home's widgets (js/widget-card.js).
  // Every section is its own closable widget (js/widget-card.js
  // widgetHeadHTML/widgetCollapsedHTML) — collapse persists per brand
  // (brand.dashboardCollapsed) so the page stays as clean as the user left it.
  "dashboard.widget.collapse": { en: "Collapse", id: "Tutup" },
  "dashboard.stat.avgER": { en: "Avg. engagement rate", id: "Rata-rata Engagement Rate" },
  "dashboard.perfByFunnel": { en: "Performance by funnel", id: "Performa per Funnel" },
  "dashboard.topPerforming": { en: "Top performing content", id: "Konten Berperforma Terbaik" },
  "dashboard.healthy": { en: "Healthy", id: "Sehat" },
  "dashboard.average": { en: "Average", id: "Cukup" },
  "dashboard.underperforming": { en: "Underperforming", id: "Kurang Perform" },

  // Content Editor drawer (js/views/content-editor.js)
  "contentEditor.editTitle": { en: "Edit content", id: "Edit Konten" },
  "contentEditor.newTitle": { en: "New content", id: "Konten Baru" },
  "contentEditor.archive": { en: "Archive", id: "Arsipkan" },
  "contentEditor.unarchive": { en: "Unarchive", id: "Keluarkan dari arsip" },
  "contentEditor.cancel": { en: "Cancel", id: "Batal" },
  "contentEditor.save": { en: "Save", id: "Simpan" },
  "contentEditor.tab.basic": { en: "Basic info", id: "Info Dasar" },
  "contentEditor.title.label": { en: "Content title", id: "Judul Konten" },
  "contentEditor.title.placeholder": { en: "e.g. 3 ways to keep coffee fresh longer", id: "misal: 3 cara simpan kopi biar tetap wangi" },
  "contentEditor.idea.label": { en: "Content idea", id: "Ide Konten" },
  "contentEditor.idea.placeholder": { en: "What is this content about, and why now?", id: "Konten ini tentang apa, dan kenapa sekarang?" },
  "contentEditor.contentFor.label": { en: "Content for", id: "Konten Untuk" },
  "contentEditor.quickpick.reels": { en: "Reels (Instagram)", id: "Reels (Instagram)" },
  "contentEditor.quickpick.tiktok": { en: "TikTok", id: "TikTok" },
  "contentEditor.quickpick.hint": { en: "Shortcut for Platform + Format below — still fully editable for Facebook, YouTube, Carousel, etc.", id: "Pintasan buat Platform + Format di bawah — tetap bisa diubah bebas buat Facebook, YouTube, Carousel, dll." },
  "contentEditor.platform.label": { en: "Platform", id: "Platform" },
  "contentEditor.format.label": { en: "Format", id: "Format" },
  "contentEditor.campaign.label": { en: "Campaign", id: "Campaign" },
  "contentEditor.campaign.aiSuggest": { en: "Suggest campaign & angle using AI", id: "Sarankan campaign & angle pakai AI" },
  "contentEditor.campaign.aiSuggestDisabled": { en: "Create a campaign first", id: "Bikin campaign dulu" },
  "contentEditor.campaign.none": { en: "No campaign", id: "Tanpa campaign" },
  "contentEditor.phase.none": { en: "No phase", id: "Tanpa fase" },
  "contentEditor.campaign.noneYet": { en: "No campaigns yet — create one from the Goals tab to link this content to it.", id: "Belum ada campaign — bikin dulu di tab Tujuan buat menghubungkan konten ini ke sana." },
  "contentEditor.series.label": { en: "Content Series (concept)", id: "Seri Konten (konsep)" },
  "contentEditor.series.none": { en: "Not part of a series", id: "Bukan bagian dari seri" },
  "contentEditor.series.hint": { en: "Pick a saved recurring series and this piece writes in that concept's tone, structure and style.", id: "Pilih seri rutin yang sudah disimpan, konten ini bakal ditulis pakai tone, struktur, dan gaya dari konsep itu." },
  "contentEditor.funnel.aiDetect": { en: "Detect from caption/idea using AI", id: "Deteksi dari caption/ide pakai AI" },
  "contentEditor.status.label": { en: "Status", id: "Status" },
  "contentEditor.scheduleDate.label": { en: "Schedule date", id: "Tanggal Jadwal" },
  "contentEditor.publishedDate.label": { en: "Published date", id: "Tanggal Terbit" },
  "contentEditor.publishedUrl.label": { en: "Published URL", id: "URL Terbit" },
  "contentEditor.publishedUrl.hint": { en: "Paste the link here once the post is live.", id: "Tempel link-nya di sini begitu kontennya sudah tayang." },
  "contentEditor.ai.needsKey": { en: "The AI isn't available right now. Try again in a moment — if it keeps happening, message the Wepeka team.", id: "AI-nya lagi belum bisa dipakai. Coba lagi sebentar — kalau masih, kabari tim Wepeka ya." },
  "contentEditor.ai.thinking": { en: "Thinking…", id: "Lagi mikir…" },
  "contentEditor.ai.suggested": { en: "Suggested: {campaign}", id: "Saran: {campaign}" },
  "contentEditor.ai.angle": { en: "Angle: {angle}", id: "Angle: {angle}" },
  "contentEditor.ai.useThisCampaign": { en: "Use this campaign", id: "Pakai campaign ini" },
  "contentEditor.ai.noCampaignFit": { en: "No campaign seemed like a clear fit for this idea.", id: "Nggak ada campaign yang kelihatan cocok buat ide ini." },
  "contentEditor.ai.campaignApplied": { en: "Campaign applied — remember to save.", id: "Campaign diterapkan — jangan lupa simpan." },
  "contentEditor.ai.detecting": { en: "Detecting…", id: "Lagi mendeteksi…" },
  "contentEditor.ai.detected": { en: "Detected {funnel}.", id: "Terdeteksi {funnel}." },
  "contentEditor.archive.unarchiveTitle": { en: "Unarchive content?", id: "Keluarkan konten dari arsip?" },
  "contentEditor.archive.archiveTitle": { en: "Archive content?", id: "Arsipkan konten?" },
  "contentEditor.archive.unarchiveMessage": { en: "It will reappear in your content database.", id: "Konten ini akan muncul lagi di database kontenmu." },
  "contentEditor.archive.archiveMessage": { en: "It stays in your database but is hidden from active views.", id: "Konten ini tetap ada di database tapi disembunyikan dari tampilan aktif." },
  "contentEditor.archive.restored": { en: "Content restored", id: "Konten dipulihkan" },
  "contentEditor.archive.archived": { en: "Content archived", id: "Konten diarsipkan" },
  "contentEditor.needTitle": { en: "Give this content a title first.", id: "Kasih judul dulu buat konten ini." },
  "contentEditor.updated": { en: "Content updated", id: "Konten diperbarui" },
  "contentEditor.created": { en: "Content created", id: "Konten dibuat" },

  // Creator — guided-mode funnel picker (js/views/creator.js)
  "creator.funnel.guidedLabel": { en: "What's this content for?", id: "Tujuan konten ini apa?" },
  "funnel.short.TOFU": { en: "Get known", id: "Kenalan" },
  "funnel.short.MOFU": { en: "Build trust", id: "Yakinkan" },
  "funnel.short.BOFU": { en: "Sell", id: "Jualan" },
  "creator.funnel.guided.TOFU.title": { en: "Introduce your brand to new people", id: "Ngenalin brand ke orang baru" },
  "creator.funnel.guided.TOFU.desc": { en: "Reach people who don't know your brand yet", id: "Fokus jangkau orang yang belum kenal brand kamu" },
  "creator.funnel.guided.MOFU.title": { en: "Inform & build trust", id: "Ngasih info & bangun kepercayaan" },
  "creator.funnel.guided.MOFU.desc": { en: "Educate or show value to build confidence", id: "Edukasi atau nunjukin value biar makin percaya" },
  "creator.funnel.guided.BOFU.title": { en: "Drive a purchase", id: "Ngajak beli / closing" },
  "creator.funnel.guided.BOFU.desc": { en: "Push people to take action or buy now", id: "Dorong orang buat langsung action atau beli" },

  // Revisi 15 Sep 2026 — shared bits
  "common.back": { en: "Back", id: "Kembali" },
  "common.backTo": { en: "Back to {label}", id: "Kembali ke {label}" },
  "common.later": { en: "Later", id: "Nanti aja" },

  // Welcome splash (js/main.js)

  // Intro modal + tour offer (js/brandlab-intro.js)
  "intro.pitch": { en: "Brandlab gives your brand a complete, consistent identity — agency-level — without you having to be a designer or branding expert. You fill in what you know about your business; the system keeps the result tidy, consistent and ready to use.", id: "Brandlab bikin brand kamu punya identitas lengkap dan konsisten — setara hasil agency — tanpa kamu harus jadi desainer atau ahli branding. Kamu isi apa yang kamu tahu tentang bisnis kamu, sistem yang jaga hasilnya tetap rapi, konsisten, dan siap dipakai." },

  // AI consultant (js/consultant-panel.js)
  "consultant.fabHint": { en: "You can ask AI, you know! 👋", id: "Kamu bisa tanya AI lho! 👋" },
  "consultant.starter.performance": { en: "How is my brand performing?", id: "Gimana performa brandku?" },
  "consultant.starter.week": { en: "What should I do first this week?", id: "Minggu ini aku sebaiknya ngapain dulu?" },
  "consultant.starter.quiet": { en: "Why is my content getting so little response?", id: "Kenapa kontenku sepi?" },

  // Mode switch explainer + 1-week reminder (js/layout.js, js/mode-reminder.js)
  "mode.guided.name": { en: "Beginner", id: "Pemula" },
  "mode.advanced.name": { en: "Pro", id: "Pro" },
  "mode.guided.desc": { en: "Step by step. Only what you need right now, plain words, guides everywhere.", id: "Langkah demi langkah. Cuma fitur yang kamu butuhin sekarang, bahasa sederhana, panduan di mana-mana." },
  "mode.advanced.desc": { en: "Everything at once: performance charts, campaigns, funnel (TOFU/MOFU/BOFU), benchmarks, sales tracker.", id: "Semua fitur sekaligus: grafik performa, campaign, funnel (TOFU/MOFU/BOFU), benchmark, sales tracker." },
  "mode.switchTo": { en: "Switch to {mode}", id: "Pindah ke mode {mode}" },

  // Brand form — business description (js/views/brands.js)
  "brandForm.descWarningTitle": { en: "Tip: the more detail, the better", id: "Tips: makin detail, makin pas" },
  "brandForm.descWarning": { en: "Every AI feature in Brandlab (Brand DNA, scripts, captions, auto-schedule, the AI consultant) reads this description. A vague description means vague AI results across the whole app.", id: "Semua fitur AI di Brandlab (Brand DNA, naskah, caption, jadwal otomatis, konsultan AI) membaca deskripsi ini. Deskripsi asal-asalan = hasil AI asal-asalan di seluruh aplikasi." },
  "brandForm.descChecklist": { en: "Include: what you sell, who buys it, where (city/online), price range, and what makes you different.", id: "Masukkan: jualan apa, siapa pembelinya, di mana (kota/online), kisaran harga, dan bedanya kamu dari yang lain." },
  "brandForm.aiHelp": { en: "Write with AI", id: "Bantu tulis pakai AI" },
  "brandForm.aiNeedNotes": { en: "Type a few rough notes first (what you sell, for whom) — the AI will turn them into a proper description.", id: "Ketik dulu catatan kasar (jualan apa, buat siapa) — nanti AI yang rapiin jadi deskripsi lengkap." },
  "brandForm.aiWorking": { en: "AI is writing…", id: "AI lagi nulis…" },
  "brandForm.aiDone": { en: "Done — read it again and fix anything that isn't accurate.", id: "Jadi — baca ulang dan benerin kalau ada yang nggak sesuai." },
  "brandForm.aiNoKey": { en: "The AI isn't available right now. Try again in a moment — if it keeps happening, message the Wepeka team.", id: "AI-nya lagi belum bisa dipakai. Coba lagi sebentar — kalau masih, kabari tim Wepeka ya." },
  "brandForm.mic": { en: "Explain by voice", id: "Jelasin pakai suara" },
  "brandForm.needDesc": { en: "Tell us what this brand does first — at least one full sentence (20 characters). AI uses this in every feature.", id: "Ceritain dulu brand ini bergerak di bidang apa — minimal satu kalimat (20 karakter). AI pakai ini di semua fitur." },

  // Creator (js/views/creator.js)
  "creator.teleprompterCta": { en: "Use the teleprompter here", id: "Pakai teleprompter di sini" },
  "creator.teleprompterHint": { en: "Read your script from the screen while recording — it scrolls by itself.", id: "Baca naskah dari layar sambil rekam — teksnya jalan sendiri." },

  // Calendar / scheduling (js/views/calendar.js, js/views/content-editor.js)
  "calendar.pastDate": { en: "Content can't be scheduled on a date that has already passed. Pick today or later.", id: "Konten nggak bisa dijadwalkan di tanggal yang sudah lewat. Pilih hari ini atau setelahnya." },
  "contentOs.cadence.tipTitle": { en: "Tip if you don't have a proper social media team", id: "Saran kalau belum punya tim sosmed yang proper" },
  "contentOs.cadence.tipBody": { en: "Give shooting and editing their own fixed days instead of doing everything every day. Example: Monday = shoot 5–7 videos at once, Tuesday = edit them all, then upload one a day. Your time is easier to manage, you always have a stock of content, and you can post every day without rushing.", id: "Sediakan hari tetap buat syuting dan editing, jangan semuanya dikerjain tiap hari. Contoh: Senin = syuting 5–7 video sekaligus, Selasa = edit semuanya, lalu upload 1 konten tiap hari. Waktumu lebih gampang diatur, stok konten selalu ada, dan kamu bisa upload tiap hari dengan leluasa." },
  "contentOs.cadence.tipApply": { en: "Use this example", id: "Pakai contoh ini" },

  // How-to examples (js/howto.js)

  // Brand Guidelines (js/views/brand-guidelines.js)
  "guidelines.step.foundation": { en: "Brand Foundation", id: "Fondasi Brand" },
  "guidelines.step.logo": { en: "Logo", id: "Logo" },
  "guidelines.step.color": { en: "Color System", id: "Sistem Warna" },
  "guidelines.step.typography": { en: "Typography", id: "Tipografi" },
  "guidelines.step.direction": { en: "Visual Direction", id: "Arah Visual" },
  "guidelines.step.tone": { en: "Tone of Voice", id: "Tone of Voice" },
  "guidelines.step.applications": { en: "Brand Applications", id: "Penerapan Brand" },
  "guidelines.step.review": { en: "Review & PDF", id: "Review & PDF" },
  "guidelines.progress": { en: "{done}/{total} sections done", id: "{done}/{total} bagian selesai" },
  "guidelines.next": { en: "Next", id: "Lanjut" },
  "guidelines.finish": { en: "Done", id: "Selesai" },
  "guidelines.bookSaved": { en: "Brand Book saved", id: "Brand Book tersimpan" },
  "guidelines.backHome": { en: "Back to Home", id: "Balik ke Beranda" },
  "guidelines.finishVisual.done": { en: "Colors & fonts saved", id: "Warna & font tersimpan" },
  "guidelines.logo.title": { en: "Do you already have a logo?", id: "Sudah punya logo?" },
  "guidelines.logo.sub": { en: "Your logo is your brand's face — every other Brand Book page is built around it.", id: "Logo itu wajah brand kamu — semua halaman Brand Book lainnya dibangun berdasarkan logo ini." },
  "guidelines.logo.yes": { en: "Yes, I have a logo", id: "Sudah, aku punya logo" },
  "guidelines.logo.no": { en: "Not yet", id: "Belum punya" },
  "guidelines.logo.main": { en: "Main logo", id: "Logo utama" },
  "guidelines.logo.uploadMain": { en: "Upload logo", id: "Upload logo" },
  "guidelines.logo.uploadVariant": { en: "Upload {name}", id: "Upload {name}" },
  "guidelines.moodboard.addPhotos": { en: "Add photos (5–10)", id: "Tambah foto (5–10)" },
  "guidelines.logo.pngHint": { en: "A PNG or SVG with a transparent background works best.", id: "Paling bagus PNG atau SVG dengan background transparan." },
  "guidelines.logo.forms": { en: "A logo usually takes one of three forms: a **wordmark** (just your name, styled), an **icon** (a symbol on its own), or a **combination** of both — the safest choice when you're just starting out.", id: "Logo biasanya ada tiga bentuk: **wordmark** (nama brand yang didesain), **ikon** (simbol aja), atau **kombinasi** keduanya — pilihan paling aman kalau baru mulai." },
  "guidelines.logo.flat": { en: "Keep it flat and simple — modern logos skip gradients and 3D effects so they still read clearly at app-icon size.", id: "Bikin flat dan simpel — logo modern nggak pakai gradasi atau efek 3D biar tetap jelas walau sekecil ikon aplikasi." },
  "guidelines.logo.chatgptTitle": { en: "Can't design one yourself? Make it with ChatGPT", id: "Belum bisa desain sendiri? Bikin pakai ChatGPT" },
  "guidelines.logo.chatgptS1": { en: "Optional but recommended: sketch a rough idea on paper and take a photo — just the basic shape or symbol.", id: "Opsional tapi disarankan: sketsa kasar di kertas lalu foto — cukup bentuk atau simbol dasarnya." },
  "guidelines.logo.chatgptS2": { en: "Open ChatGPT, attach the sketch photo (if any) and paste prompt 1. You get 3 concepts.", id: "Buka ChatGPT, lampirkan foto sketsa (kalau ada), tempel prompt 1. Kamu dapat 3 konsep." },
  "guidelines.logo.chatgptS3": { en: "Pick one: paste prompt 2 and fill in its number. You get the final logo on a transparent background, plus an icon-only and an all-white version.", id: "Pilih satu: tempel prompt 2 dan isi nomornya. Kamu dapat logo final ber-background transparan, plus versi ikon saja dan versi putih." },
  "guidelines.logo.chatgptS4": { en: "Paste prompt 3 to get the SVG vector file (for printing, banners, merch) and a 4000 px transparent PNG. Upload the PNG or SVG in the box below and keep the SVG for your printer.", id: "Tempel prompt 3 untuk dapat file vektor SVG (buat cetak, spanduk, merchandise) dan PNG transparan 4000 px. Upload PNG atau SVG-nya di kotak bawah, simpan file SVG-nya buat tukang cetak." },
  "guidelines.logo.promptStep1": { en: "Prompt 1 · 3 concepts", id: "Prompt 1 · 3 konsep" },
  "guidelines.logo.promptStep2": { en: "Prompt 2 · final logo, transparent", id: "Prompt 2 · logo final, transparan" },
  "guidelines.logo.promptStep3": { en: "Prompt 3 · SVG + high-res PNG", id: "Prompt 3 · SVG + PNG resolusi tinggi" },
  "guidelines.logo.svgTip": { en: "If the SVG shapes drift from the image, reply \"match the shapes to the final logo image exactly\". The transparent PNG is what Brandlab needs; the SVG is for anything printed large.", id: "Kalau bentuk di SVG melenceng dari gambarnya, balas \"samakan bentuknya persis dengan gambar logo final\". Brandlab cukup pakai PNG transparan; SVG buat apa pun yang dicetak besar." },
  "guidelines.logo.copyPrompt": { en: "Copy prompt", id: "Salin prompt" },
  "guidelines.logo.openChatgpt": { en: "Open ChatGPT", id: "Buka ChatGPT" },
  "guidelines.logo.uploadAiTitle": { en: "Upload your generated logo", id: "Upload logo hasil generate" },
  "guidelines.logo.uploadAiBody": { en: "This section isn't finished until the logo is uploaded — the Brand Book needs it.", id: "Bagian Logo belum selesai sampai logonya di-upload — Brand Book butuh logo ini." },
  "guidelines.logo.pending": { en: "Not finished: logo not uploaded yet", id: "Belum selesai: logo belum di-upload" },
  "guidelines.logo.saved": { en: "Logo saved — the Logo section is done.", id: "Logo tersimpan — bagian Logo selesai." },
  "guidelines.logo.promptCopied": { en: "Prompt copied — paste it in ChatGPT.", id: "Prompt disalin — tempel di ChatGPT." },
  "guidelines.direction.title": { en: "Which visual direction is closest to your brand?", id: "Arah visual mana yang paling dekat dengan brand kamu?" },
  "guidelines.direction.sub": { en: "Pick up to 2 — this sets the spacing, shapes and energy of everything else.", id: "Pilih maksimal 2 — ini menentukan jarak, bentuk, dan energi semua elemen lainnya." },
  "guidelines.direction.max2": { en: "Pick up to 2 — remove one first", id: "Maksimal 2 — hapus salah satu dulu" },
  "guidelines.moodboard.label": { en: "Moodboard", id: "Moodboard" },
  "guidelines.moodboard.optional": { en: "(optional)", id: "(opsional)" },
  "guidelines.moodboard.whatTitle": { en: "What's a moodboard?", id: "Moodboard itu apa?" },
  "guidelines.moodboard.whatBody": { en: "A collection of 5–10 reference photos that show the visual \"feel\" of your brand: colors, lighting, mood, photo style. It's not for posting — it's a cheat sheet so your content, product photos and designs all look like one family.", id: "Kumpulan 5–10 foto referensi yang nunjukin \"rasa\" visual brand kamu: warna, pencahayaan, suasana, gaya foto. Bukan buat diposting — ini contekan biar semua konten, foto produk, dan desainmu kelihatan satu keluarga." },
  "guidelines.moodboard.exampleTitle": { en: "Example: a cozy coffee shop's moodboard", id: "Contoh: moodboard kedai kopi yang hangat" },
  "guidelines.moodboard.ex1": { en: "Coffee beans close-up, warm light", id: "Close-up biji kopi, cahaya hangat" },
  "guidelines.moodboard.ex2": { en: "Wooden interior", id: "Interior kayu" },
  "guidelines.moodboard.ex3": { en: "Hands holding a cup", id: "Tangan pegang cangkir" },
  "guidelines.moodboard.ex4": { en: "Brown–cream colors", id: "Warna cokelat–krem" },
  "guidelines.moodboard.ex5": { en: "Late-afternoon mood", id: "Suasana sore" },
  "guidelines.moodboard.ex6": { en: "Handwritten menu board", id: "Papan menu tulisan tangan" },
  "guidelines.moodboard.how": { en: "How: search Pinterest for your business type + a mood word (e.g. \"coffee shop cozy warm\"), save 5–10 photos that feel right, then upload them here.", id: "Caranya: cari di Pinterest pakai jenis usahamu + kata suasana (misal \"coffee shop cozy warm\"), simpan 5–10 foto yang terasa pas, lalu upload di sini." },
  "guidelines.moodboard.promptTitle": { en: "Or search real photos: keywords for Pinterest", id: "Atau cari foto asli: keyword buat Pinterest" },
  "guidelines.moodboard.gptTitle": { en: "Make your moodboard with ChatGPT", id: "Bikin moodboard pakai ChatGPT" },
  "guidelines.moodboard.gptPrompt": { en: "Moodboard prompt", id: "Prompt moodboard" },
  "guidelines.moodboard.gptBody": { en: "Copy this prompt, paste it in ChatGPT, download the image and upload it below. It's built from your visual direction, colors and business.", id: "Salin prompt ini, tempel di ChatGPT, download gambarnya, lalu upload di bawah. Prompt-nya disusun dari arah visual, warna, dan bidang usahamu." },
  "guidelines.moodboard.promptEmpty": { en: "Pick a visual direction above and the keywords to paste into Pinterest appear right here.", id: "Pilih arah visual di atas — keyword buat dipaste ke Pinterest langsung muncul di sini." },
  "guidelines.moodboard.copyPrompt": { en: "Copy", id: "Salin" },
  "guidelines.moodboard.promptCopied": { en: "Keywords copied — paste them into Pinterest's search box.", id: "Keyword disalin — tempel di kolom pencarian Pinterest." },
  "guidelines.moodboard.searchWith": { en: "Search with it:", id: "Cari pakai ini:" },
  "guidelines.tone.title": { en: "How does your brand talk?", id: "Brand kamu ngomongnya gimana?" },
  "guidelines.tone.sub": { en: "Your brand already has a face (logo) and clothes (colors/fonts). Now: how does it speak? Slide each bar — the percentages show how far it leans to each side, and the example message changes instantly.", id: "Brand kamu udah punya wajah (logo) dan pakaian (warna/font). Sekarang: gimana cara dia ngomong? Geser tiap bar — persentasenya nunjukin seberapa condong ke tiap sisi, dan contoh pesannya langsung berubah." },
  "guidelines.tone.axis.formal.left": { en: "Formal", id: "Formal" },
  "guidelines.tone.axis.formal.right": { en: "Casual", id: "Santai" },
  "guidelines.tone.axis.language.left": { en: "Simple", id: "Sederhana" },
  "guidelines.tone.axis.language.right": { en: "Complex", id: "Kompleks" },
  "guidelines.tone.axis.character.left": { en: "Serious", id: "Serius" },
  "guidelines.tone.axis.character.right": { en: "Playful", id: "Playful" },
  "guidelines.tone.axis.emotion.left": { en: "Reserved", id: "Kalem" },
  "guidelines.tone.axis.emotion.right": { en: "Expressive", id: "Ekspresif" },
  "guidelines.tone.exampleTitle": { en: "Example — your brand announcing the shop closes early today", id: "Contoh — brand kamu ngasih tahu toko tutup lebih awal hari ini" },
  "guidelines.tone.avoidLabel": { en: "Words/styles to avoid (optional)", id: "Kata/gaya yang dihindari (opsional)" },
  "guidelines.tone.avoidPlaceholder": { en: "e.g. too much slang, technical jargon...", id: "misal: bahasa gaul berlebihan, jargon teknis..." },
  "guidelines.tone.detectTitle": { en: "Detect automatically from how you talk (optional)", id: "Deteksi otomatis dari cara kamu ngomong (opsional)" },
  "guidelines.tone.detectBody": { en: "Type — or say with the mic — a few sentences the way your brand usually talks (a caption, a WhatsApp reply to a customer). AI reads the style and moves the bars for you.", id: "Ketik — atau ucapkan pakai mic — beberapa kalimat seperti biasanya brand kamu ngomong (caption, balasan WhatsApp ke pelanggan). AI baca gaya bahasanya dan geser bar-nya otomatis." },
  "guidelines.tone.detectPlaceholder": { en: "e.g. Hi! Our new iced palm-sugar coffee is out today — come grab one before 5pm ☕", id: "misal: Halo kak! Es kopi gula aren kita udah ready hari ini, buruan mampir sebelum jam 5 yaa ☕" },
  "guidelines.tone.detectBtn": { en: "Detect my style", id: "Deteksi gaya bahasa" },
  "guidelines.tone.detecting": { en: "Reading your style…", id: "Lagi baca gaya bahasamu…" },
  "guidelines.tone.detected": { en: "Bars adjusted to your writing. Slide them again if anything feels off.", id: "Bar sudah disesuaikan dengan tulisanmu. Geser lagi kalau ada yang kurang pas." },
  "guidelines.tone.needText": { en: "Write at least two sentences first.", id: "Tulis minimal dua kalimat dulu." },
  "guidelines.tone.saveNext": { en: "Save & continue", id: "Simpan & lanjut" },
  "guidelines.tone.saved": { en: "Tone of Voice saved", id: "Tone of Voice disimpan" },
  "guidelines.tone.add": { en: "Add", id: "Tambah" },

  // ---- Trash / soft delete (js/store.js listTrash etc.) — brand, campaign,
  // content and series "Delete" confirms across js/views/brands.js,
  // js/views/settings.js, js/views/campaigns.js, js/views/campaign-detail.js,
  // js/views/content-list.js, js/views/series.js. Shared title/confirm
  // label, one message per entity kind so it can say what specifically
  // moves with it. ----
  "trash.unknownBrand": { en: "(brand no longer here)", id: "(brand sudah tidak ada)" },
  "delete.toTrash.title": { en: "Move to Trash?", id: "Pindahkan ke Sampah?" },
  "delete.toTrash.confirm": { en: "Move to Trash", id: "Pindahkan ke Sampah" },
  "delete.toTrash.suffix": { en: "Restorable from Settings → Trash for {days} days, then it's gone for good.", id: "Bisa dipulihkan lewat Pengaturan → Sampah selama {days} hari, lewat itu hilang permanen." },
  "delete.toTrash.brandMessage": { en: "The brand and everything inside it ({count} piece(s) of content, its campaigns and series) move to Trash together. Restore within {days} days in Settings → Trash, or it's gone for good.", id: "Brand ini beserta semua isinya ({count} konten, campaign dan seri-nya) pindah ke Sampah bersamaan. Bisa dipulihkan dalam {days} hari lewat Pengaturan → Sampah, lewat itu hilang permanen." },
  "delete.toTrash.brandDone": { en: "Brand moved to Trash.", id: "Brand dipindahkan ke Sampah." },
  "delete.toTrash.contentMessage": { en: "Moves to Trash. Restore within {days} days in Settings → Trash, or it's gone for good.", id: "Pindah ke Sampah. Bisa dipulihkan dalam {days} hari lewat Pengaturan → Sampah, lewat itu hilang permanen." },
  "delete.toTrash.contentDone": { en: "Moved to Trash.", id: "Dipindahkan ke Sampah." },
  "set.trash.title": { en: "Trash", id: "Sampah" },
  "set.trash.sub": { en: "Deleted brands, campaigns, content and series wait here for {days} days before they're gone for good.", id: "Brand, campaign, konten dan seri yang dihapus menunggu di sini {days} hari sebelum hilang permanen." },
  "set.trash.empty": { en: "Trash is empty.", id: "Sampah kosong." },
  "set.trash.kind.brand": { en: "Brand", id: "Brand" },
  "set.trash.kind.campaign": { en: "Campaign", id: "Campaign" },
  "set.trash.kind.content": { en: "Content", id: "Konten" },
  "set.trash.kind.series": { en: "Series", id: "Seri" },
  "set.trash.daysLeft": { en: "{n} day(s) left", id: "sisa {n} hari" },
  "set.trash.restore": { en: "Restore", id: "Pulihkan" },
  "set.trash.restored": { en: "Restored.", id: "Berhasil dipulihkan." },
  "set.trash.purgeAria": { en: "Delete \"{name}\" permanently", id: "Hapus permanen \"{name}\"" },
  "set.trash.purgeTitle": { en: "Delete permanently?", id: "Hapus permanen?" },
  "set.trash.purgeMsg": { en: "This can't be undone — it won't be in Trash anymore.", id: "Ini nggak bisa dibatalkan — nggak akan ada lagi di Sampah." },
  "set.trash.purged": { en: "Deleted permanently.", id: "Terhapus permanen." },

};

// Per-area dictionaries (js/i18n/*.js) are merged on top of CORE. Keys are
// namespaced per area, so nothing should collide — scripts check that.
const EXTRA = {
  "brand-guidelines": brand_guidelines,
  "brand-dna-builder": brand_dna_builder,
  "creator-copy": creator_copy,
  "campaigns": campaigns,
  "guides": guides,
  "app-shell": app_shell,
  "content": content,
  "ai": ai,
  "brand-pulse": brand_pulse,
  "brainstorm": brainstorm,
  "roadmap": roadmap,
  "chat-hub": chat_hub,
  "series": series,
  "announcements": announcements,
  "retention": retention,
};
const DICT = Object.assign({}, CORE, ...Object.values(EXTRA));

// For the key/translation checker only.
export function __i18nSources() {
  return { core: CORE, extra: EXTRA };
}

// Pemula reads plain words: no "milestone", "engagement" or TOFU/MOFU/BOFU.
// main.js tells this module which mode is on (i18n.js can't import mode.js
// — mode.js imports this file). Applied to our own copy only, before the
// {vars} go in, so names the owner typed are never touched.
let plainLanguage = () => false;
export function setPlainLanguageResolver(fn) {
  plainLanguage = typeof fn === "function" ? fn : () => false;
}
const FUNNEL_PLAIN = { id: { TOFU: "Kenalan", MOFU: "Yakinkan", BOFU: "Jualan" }, en: { TOFU: "Get known", MOFU: "Build trust", BOFU: "Sell" } };
const JARGON = /milestone|engagement|campaign|\bTOFU\b|\bMOFU\b|\bBOFU\b/i;
export function plainWords(str, lang = getLang()) {
  if (!str || !JARGON.test(str)) return str;
  const en = lang === "en";
  const cap = (orig, word) => (orig[0] === orig[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  // "Target tiap milestone…" would read "Target tiap target"; call it a step there.
  const hasTarget = /target/i.test(str);
  return str
    .replace(/\s*\((?:TOFU|MOFU|BOFU)(?:\s*\/\s*(?:TOFU|MOFU|BOFU))*\)/g, "")
    .replace(/(?<![{\w])(TOFU|MOFU|BOFU)(?![\w}])/g, (m) => FUNNEL_PLAIN[en ? "en" : "id"][m])
    .replace(/(?<![{\w])engagement rate(?![\w}])/gi, (m) => cap(m, en ? "interaction rate" : "tingkat interaksi"))
    .replace(/(?<![{\w])engagement(?![\w}])/gi, (m) => cap(m, en ? "interactions" : "interaksi"))
    .replace(/(?<![{\w])milestones?(?![\w}])/gi, (m) => cap(m, en ? (/s$/i.test(m) ? "targets" : "target") : hasTarget ? "langkah" : "target"))
    // "Campaign" is a Pro word (owner decision 2026-10-01): Pemula calls the
    // same thing a Tujuan — the tab, its button and every line about it.
    .replace(/(?<![{\w])(campaign)(s?)(?:-(nya|mu|ku))?(?![\w}])/gi, (m, word, plural, suffix) => cap(word, en ? (plural ? "goals" : "goal") : "tujuan") + (suffix && !en ? suffix : ""));
}

export function t(key, vars) {
  const entry = DICT[key];
  let str = entry ? entry[getLang()] || entry.en : key;
  if (entry && plainLanguage()) str = plainWords(str);
  if (vars) for (const k in vars) str = str.split(`{${k}}`).join(vars[k]);
  return str;
}
