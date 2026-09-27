// Tap-to-use example answers for the Brand DNA wizard (js/views/brand-dna.js).
// A blank box is the hardest part for someone who has never written a
// "target audience" before, so the questions that trip people up most get a
// few short starting points picked for their kind of business. Deterministic
// (a keyword guess over the business description) — no AI call, no quota.
// Tapping one only fills the box; the owner edits it into their own words.
import { getLang } from "./i18n.js";

const KINDS = [
  ["food", /kopi|coffee|kafe|cafe|kedai|makan|minum|kuliner|resto|warung|bakery|roti|kue|cake|snack|jajan|catering|dapur|food|drink|boba|teh|juice|jus/i],
  ["fashion", /kaos|baju|fashion|pakaian|hijab|jilbab|sepatu|tas|batik|apparel|clothing|distro|outfit|celana|dress/i],
  ["edu", /kursus|les|kelas|bimbel|belajar|sekolah|training|pelatihan|mandarin|english|inggris|bahasa|coding|edukasi|course|tutor/i],
  ["beauty", /salon|kecantikan|skincare|kosmetik|makeup|make up|barber|spa|nail|beauty|perawatan/i],
  ["service", /jasa|bengkel|servis|service|laundry|desain|design|fotograf|photo|konsultan|agency|agensi|kontraktor|travel|rental|sewa|cleaning/i],
];

export function businessKind(brand = {}) {
  const text = `${brand.businessDescription || ""} ${brand.name || ""}`;
  return (KINDS.find(([, re]) => re.test(text)) || ["general"])[0];
}

// key → kind → { id: [...], en: [...] }. Keys match the wizard's box ids:
// part keys (who, want, visible, feel) and answer fields (callToAction, tagline).
const EXAMPLES = {
  who: {
    food: { id: ["Mahasiswa sekitar kampus", "Pekerja kantoran yang butuh ngopi pagi", "Keluarga muda di akhir pekan"], en: ["Students near campus", "Office workers who need a morning coffee", "Young families on weekends"] },
    fashion: { id: ["Remaja 16–24 yang suka gaya kasual", "Ibu muda yang cari baju nyaman", "Komunitas yang butuh kaos seragam"], en: ["Teens 16–24 into casual style", "Young mums looking for comfy clothes", "Communities needing matching tees"] },
    edu: { id: ["Orang tua dengan anak SD–SMP", "Karyawan yang mau naik jabatan", "Mahasiswa yang mau kerja di luar negeri"], en: ["Parents of primary/middle schoolers", "Employees aiming for a promotion", "Students who want to work abroad"] },
    beauty: { id: ["Perempuan 20–35 yang sibuk kerja", "Calon pengantin", "Remaja dengan kulit berjerawat"], en: ["Busy working women 20–35", "Brides-to-be", "Teens with acne-prone skin"] },
    service: { id: ["Pemilik usaha kecil di kota ini", "Keluarga yang nggak sempat ngurus sendiri", "Kantor yang butuh vendor tepercaya"], en: ["Small business owners in town", "Families with no time to do it themselves", "Offices needing a reliable vendor"] },
    general: { id: ["Warga sekitar yang cari yang dekat", "Anak muda 18–30 yang aktif di Instagram", "Ibu rumah tangga yang teliti soal harga"], en: ["Locals who want something nearby", "Young people 18–30 active on Instagram", "Price-conscious homemakers"] },
  },
  want: {
    food: { id: ["tempat nongkrong yang enak tapi murah", "kopi yang konsisten rasanya", "makanan cepat saji yang tetap sehat"], en: ["a nice hangout that's still cheap", "coffee that tastes the same every time", "quick food that's still healthy"] },
    fashion: { id: ["tampil keren tanpa mahal", "bahan adem buat dipakai seharian", "ukuran yang pas di badan"], en: ["to look good without spending much", "cool fabric for all-day wear", "sizes that actually fit"] },
    edu: { id: ["anaknya naik nilai", "bisa ngobrol lancar dalam 3 bulan", "sertifikat yang diakui"], en: ["better grades for their kids", "to speak fluently in 3 months", "a recognised certificate"] },
    beauty: { id: ["kulit sehat tanpa ribet", "tampil percaya diri di acara penting", "perawatan yang aman dan terjangkau"], en: ["healthy skin without the hassle", "to feel confident at big events", "safe, affordable treatments"] },
    service: { id: ["urusan beres tanpa harus mikir", "hasil rapi dan tepat waktu", "harga jelas dari awal"], en: ["it handled without having to think", "neat work, on time", "a clear price up front"] },
    general: { id: ["barang bagus dengan harga masuk akal", "pelayanan yang ramah dan cepat", "sesuatu yang bisa dibanggakan"], en: ["good quality at a fair price", "friendly, fast service", "something to be proud of"] },
  },
  visible: {
    food: { id: ["kopi enak di sini mahal semua", "antre lama pas jam makan siang", "tempatnya penuh, nggak dapat duduk"], en: ["good coffee around here is expensive", "long queues at lunchtime", "places are packed, nowhere to sit"] },
    fashion: { id: ["beli online sering nggak sesuai foto", "bahannya panas dan cepat melar", "modelnya pasaran"], en: ["online buys rarely match the photos", "fabric is hot and stretches fast", "the designs are everywhere"] },
    edu: { id: ["sudah les tapi nilai nggak naik", "gurunya kaku dan membosankan", "jadwalnya bentrok dengan kerja"], en: ["lessons but no better grades", "stiff, boring teachers", "the schedule clashes with work"] },
    beauty: { id: ["sudah coba banyak produk, nggak cocok", "takut hasilnya malah rusak", "salon bagus harganya mahal"], en: ["tried lots of products, none worked", "afraid it'll make things worse", "good salons are pricey"] },
    service: { id: ["tukang sering molor dari janji", "harga tiba-tiba naik di tengah jalan", "susah dihubungi setelah bayar"], en: ["providers always run late", "the price jumps halfway through", "hard to reach after paying"] },
    general: { id: ["susah cari yang kualitasnya konsisten", "pelayanannya lambat", "harganya nggak jelas"], en: ["hard to find consistent quality", "slow service", "unclear prices"] },
  },
  feel: {
    general: { id: ["kesel dan merasa rugi", "capek harus cari-cari terus", "malu kalau hasilnya jelek"], en: ["annoyed and short-changed", "tired of searching all the time", "embarrassed when it turns out badly"] },
  },
  callToAction: {
    food: { id: ["Mampir sore ini", "Pesan lewat WhatsApp sekarang", "Coba menu barunya minggu ini"], en: ["Drop by this afternoon", "Order on WhatsApp now", "Try the new menu this week"] },
    fashion: { id: ["Cek koleksi terbaru", "Pesan sekarang sebelum habis", "DM ukuranmu"], en: ["See the new collection", "Order before it sells out", "DM us your size"] },
    edu: { id: ["Daftar kelas percobaan gratis", "Chat admin buat jadwal", "Ikut tes level sekarang"], en: ["Book a free trial class", "Chat us for the schedule", "Take the level test now"] },
    beauty: { id: ["Booking jadwal sekarang", "Konsultasi gratis via WhatsApp", "Coba paket pertama"], en: ["Book a slot now", "Free consultation on WhatsApp", "Try the starter package"] },
    service: { id: ["Minta penawaran gratis", "Chat kami sekarang", "Jadwalkan survei"], en: ["Get a free quote", "Chat with us now", "Schedule a visit"] },
    general: { id: ["Chat kami sekarang", "Pesan hari ini", "Kunjungi toko kami"], en: ["Chat with us now", "Order today", "Visit our store"] },
  },
  tagline: {
    food: { id: ["Ngopi hemat, rasa niat", "Enaknya bikin balik lagi", "Teman ngobrol paling setia"], en: ["Good coffee, student prices", "So good you'll be back", "Your favourite place to talk"] },
    fashion: { id: ["Nyaman dipakai, pede dilihat", "Gaya kamu, harga kita", "Adem dari pagi sampai malam"], en: ["Comfy to wear, proud to show", "Your style, our price", "Cool from morning to night"] },
    edu: { id: ["Belajar seru, hasil nyata", "Dari bingung jadi lancar", "Pintar tanpa tegang"], en: ["Fun learning, real results", "From confused to fluent", "Smart without the stress"] },
    beauty: { id: ["Cantik yang aman", "Rawat diri tanpa ribet", "Pede mulai hari ini"], en: ["Beauty you can trust", "Self-care made simple", "Confident from today"] },
    service: { id: ["Beres, rapi, tepat waktu", "Serahkan ke kami", "Kerja jujur, hasil bagus"], en: ["Done, neat, on time", "Leave it to us", "Honest work, great results"] },
    general: { id: ["Kualitas yang bisa dipegang", "Dekat, ramah, terpercaya", "Pilihan orang sini"], en: ["Quality you can count on", "Close, friendly, trusted", "The local favourite"] },
  },
};

export function dnaExamples(key, kind) {
  const set = EXAMPLES[key];
  if (!set) return [];
  const byKind = set[kind] || set.general || Object.values(set)[0];
  return byKind[getLang()] || byKind.id || [];
}
