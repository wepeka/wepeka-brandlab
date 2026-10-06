// Settings → Pengingat (js/reminders.js): opt-in upload reminders — push
// notifications, calendar subscription, email.
export default {
  "settings.panel.reminders": { en: "Reminders", id: "Pengingat" },

  "reminders.title": { en: "Upload reminders", id: "Pengingat upload" },
  "reminders.sub": {
    en: "Choose how Brandlab reminds you of your upload schedule. Everything stays off until you turn it on yourself.",
    id: "Pilih cara Brandlab mengingatkan jadwal upload-mu. Semuanya mati sampai kamu sendiri yang menyalakan.",
  },
  "reminders.needActive": { en: "Reminders can be turned on while your plan is active.", id: "Pengingat bisa dinyalakan selama paketmu aktif." },
  "reminders.on": { en: "On", id: "Nyala" },
  "reminders.off": { en: "Off", id: "Mati" },
  "reminders.turnOn": { en: "Turn on", id: "Nyalakan" },
  "reminders.turnOff": { en: "Turn off", id: "Matikan" },
  "reminders.failed": { en: "Something went wrong. Try again in a moment.", id: "Gagal. Coba lagi sebentar." },

  "reminders.push.title": { en: "Phone/browser notifications", id: "Notifikasi di HP/browser" },
  "reminders.push.sub": {
    en: "Every morning around 7, when something is scheduled that day. Mondays also bring a short recap of last week.",
    id: "Tiap pagi sekitar jam 7, kalau ada konten yang dijadwalkan hari itu. Senin pagi ada rekap singkat minggu lalu.",
  },
  "reminders.push.askNote": { en: "Your browser will ask for permission first. This applies to this device only.", id: "Browser akan minta izin dulu. Berlaku untuk perangkat ini saja." },
  "reminders.push.iosInstall": {
    en: "On iPhone/iPad, notifications only work from Brandlab on your Home Screen: open it in Safari, tap Share → Add to Home Screen, open Brandlab from that icon and turn this on there. Or use the calendar subscription below.",
    id: "Di iPhone/iPad, notifikasi hanya jalan dari Brandlab di Layar Utama: buka di Safari, ketuk Bagikan → Tambah ke Layar Utama, buka Brandlab dari ikon itu, lalu nyalakan di sini. Atau pakai Langganan kalender di bawah.",
  },
  "reminders.push.unsupported": {
    en: "This browser can't receive notifications yet. Use the calendar subscription below, it works on every phone.",
    id: "Browser ini belum bisa menerima notifikasi. Pakai Langganan kalender di bawah, jalan di semua HP.",
  },
  "reminders.push.denied": {
    en: "Notifications are blocked for this site. Tap the lock icon next to the site address → Notifications → Allow, then reload this page.",
    id: "Notifikasi diblokir untuk situs ini. Ketuk ikon gembok di sebelah alamat situs → Notifikasi → Izinkan, lalu muat ulang halaman ini.",
  },
  "reminders.push.deniedIos": {
    en: "Notifications are blocked. Open iPhone Settings → Notifications → Brandlab → Allow Notifications, then come back here.",
    id: "Notifikasi diblokir. Buka Pengaturan iPhone → Notifikasi → Brandlab → Izinkan Notifikasi, lalu kembali ke sini.",
  },
  "reminders.push.test": { en: "Send test", id: "Kirim tes" },
  "reminders.push.otherDevices": { en: "Also on for {n} other devices: {list}.", id: "Juga nyala di {n} perangkat lain: {list}." },
  "reminders.push.otherDevices.one": { en: "Also on for 1 other device: {list}.", id: "Juga nyala di 1 perangkat lain: {list}." },
  "reminders.push.offAll": { en: "Turn off everywhere", id: "Matikan semua" },
  "reminders.push.blockedToast": { en: "Notification permission was refused. This card shows how to allow it.", id: "Izin notifikasi ditolak. Cara mengizinkannya ada di kartu ini." },
  "reminders.push.notAllowed": { en: "Notifications weren't allowed.", id: "Notifikasi belum diizinkan." },
  "reminders.push.onToast": { en: "Notifications are on for this device.", id: "Notifikasi nyala di perangkat ini." },
  "reminders.push.offToast": { en: "Notifications turned off.", id: "Notifikasi dimatikan." },
  "reminders.push.testNoDevice": { en: "This device isn't saved yet. Wait a moment and try again.", id: "Perangkat ini belum tersimpan. Tunggu sebentar lalu coba lagi." },
  "reminders.push.testFailed": { en: "The test couldn't be sent. Try again in a moment.", id: "Tes gagal terkirim. Coba lagi sebentar." },
  "reminders.push.testGone": { en: "This device is no longer registered. Turn notifications off and on again.", id: "Perangkat ini sudah tidak terdaftar. Matikan lalu nyalakan lagi." },
  "reminders.push.testSent": { en: "Test sent. Check your notifications.", id: "Tes terkirim. Cek notifikasinya." },

  "reminders.cal.title": { en: "Calendar subscription", id: "Langganan kalender" },
  "reminders.cal.sub": {
    en: "Your upload schedule shows up in Google Calendar or the iPhone Calendar, with a reminder at 8 in the morning. Works on every phone.",
    id: "Jadwal upload muncul di Google Calendar atau Kalender iPhone, dengan pengingat jam 8 pagi. Jalan di semua HP.",
  },
  "reminders.cal.private": { en: "It's your own calendar. Nobody else sees it.", id: "Ini kalendermu sendiri. Tidak ada orang lain yang melihatnya." },
  "reminders.cal.linkLabel": { en: "Calendar link", id: "Link kalender" },
  "reminders.cal.copy": { en: "Copy link", id: "Salin link" },
  "reminders.cal.google": { en: "Add to Google Calendar", id: "Tambah ke Google Calendar" },
  "reminders.cal.iphone": { en: "Add to iPhone Calendar", id: "Tambah ke Kalender iPhone" },
  "reminders.cal.googleSlow": {
    en: "Google Calendar can take a few hours to pick up changes. Keep this link to yourself; if it gets out, make a new one.",
    id: "Google Calendar bisa butuh beberapa jam untuk memperbarui jadwal. Simpan link ini untuk dirimu sendiri; kalau tersebar, buat link baru.",
  },
  "reminders.cal.rotate": { en: "Make a new link", id: "Buat link baru" },
  "reminders.cal.onToast": { en: "Calendar subscription is on. Add the link to your calendar.", id: "Langganan kalender nyala. Tambahkan link-nya ke kalendermu." },
  "reminders.cal.copied": { en: "Link copied.", id: "Link disalin." },
  "reminders.cal.rotateTitle": { en: "Make a new link?", id: "Buat link baru?" },
  "reminders.cal.rotateMsg": {
    en: "The old link stops working within about 15 minutes. A calendar that uses the old link has to be added again with the new one.",
    id: "Link lama berhenti jalan dalam ±15 menit. Kalender yang memakai link lama perlu ditambah ulang dengan link baru.",
  },
  "reminders.cal.rotated": { en: "New link ready. Add it to your calendar again.", id: "Link baru siap. Tambahkan lagi ke kalendermu." },
  "reminders.cal.offTitle": { en: "Turn off the calendar subscription?", id: "Matikan langganan kalender?" },
  "reminders.cal.offMsg": {
    en: "The link stops working. Also remove the Brandlab calendar from your calendar app so old dates don't linger.",
    id: "Link-nya berhenti jalan. Hapus juga kalender Brandlab dari aplikasi kalendermu supaya jadwal lama tidak tersisa.",
  },
  "reminders.cal.offToast": { en: "Calendar subscription turned off.", id: "Langganan kalender dimatikan." },

  "reminders.email.title": { en: "Email", id: "Email" },
  "reminders.email.sub": {
    en: "A summary of the day's uploads every morning around 7, only when something is scheduled.",
    id: "Ringkasan jadwal upload tiap pagi sekitar jam 7, hanya kalau ada jadwal hari itu.",
  },
  "reminders.email.to": { en: "Sent to {email}.", id: "Dikirim ke {email}." },
  "reminders.email.onToast": { en: "Email reminders are on.", id: "Pengingat email nyala." },
  "reminders.email.offToast": { en: "Email reminders turned off.", id: "Pengingat email dimatikan." },
};
