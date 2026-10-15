// "Template hook" in Creator: 100 opening lines with blanks the owner
// fills in, in ten groups of ten. The picker is js/hook-template-picker.js;
// "Bantu isi pakai AI" (js/ai.js fillHookTemplate) only suggests what goes
// in the blanks — the owner picks, edits and decides.
//
// A blank is an UPPERCASE label in square brackets, the same in both
// languages' sense: "[TARGET AUDIENS]" / "[TARGET AUDIENCE]". A label used
// twice in one template is one blank (filled once, said twice). Plain data
// with no imports, like js/knowledge/hook-types.js. Group names and
// descriptions live in js/i18n/creator-copy.js under hooktpl.group.<key>.*.
//
// `funnels`: the stages a group suits best. Only puts a "cocok" dot on the
// group chips — every group stays open for every piece.

export const HOOK_TEMPLATE_GROUPS = [
  { key: "curiosity", term: "Curiosity gap", funnels: ["TOFU", "MOFU"] },
  { key: "interrupt", term: "Pattern interrupt", funnels: ["TOFU"] },
  { key: "pain", term: "Pain point", funnels: ["MOFU", "TOFU"] },
  { key: "contrarian", term: "Contrarian", funnels: ["TOFU"] },
  { key: "urgency", term: "FOMO & urgency", funnels: ["BOFU"] },
  { key: "proof", term: "Authority & social proof", funnels: ["MOFU", "BOFU"] },
  { key: "story", term: "Storytelling", funnels: ["TOFU", "MOFU"] },
  { key: "feeling", term: "Psychology & emotional trigger", funnels: ["MOFU"] },
  { key: "teach", term: "Educational & value", funnels: ["MOFU", "TOFU"] },
  { key: "sales", term: "Sales & conversion", funnels: ["BOFU"] },
];

const T = (n, group, id, en) => ({ n, group, id, en });

export const HOOK_TEMPLATES = [
  // 1. Curiosity gap
  T(1, "curiosity", "Kenapa [BRAND] bisa [HASIL MENGEJUTKAN], padahal [FAKTA KONTRADIKTIF]?", "Why does [BRAND] [SURPRISING RESULT] when [CONTRADICTING FACT]?"),
  T(2, "curiosity", "Ada satu hal tentang [TOPIK] yang jarang banget orang bahas.", "There's one thing about [TOPIC] almost nobody talks about."),
  T(3, "curiosity", "Ternyata alasan [TARGET AUDIENS] melakukan [PERILAKU] bukan karena [ASUMSI UMUM].", "Turns out [TARGET AUDIENCE] [BEHAVIOUR] not because of [COMMON ASSUMPTION]."),
  T(4, "curiosity", "Kamu mungkin nggak sadar kalau [HAL SEDERHANA] sebenarnya bisa [DAMPAK BESAR].", "You might not realise that [SIMPLE THING] can actually [BIG IMPACT]."),
  T(5, "curiosity", "Rahasia di balik [KESUKSESAN] ternyata bukan [FAKTOR YANG DIANGGAP PENTING].", "The secret behind [SUCCESS] isn't [FACTOR PEOPLE THINK MATTERS]."),
  T(6, "curiosity", "Kenapa [BRAND/ORANG] sengaja melakukan [KEPUTUSAN TIDAK BIASA]?", "Why did [BRAND/PERSON] deliberately [UNUSUAL DECISION]?"),
  T(7, "curiosity", "Aku baru menemukan sesuatu yang menarik dari [BRAND/TOPIK].", "I just found something interesting about [BRAND/TOPIC]."),
  T(8, "curiosity", "Apa yang terjadi kalau [TARGET AUDIENS] berhenti melakukan [KEBIASAAN]?", "What happens if [TARGET AUDIENCE] stop [HABIT]?"),
  T(9, "curiosity", "Ada alasan kenapa [PRODUK] bisa dihargai [HARGA PRODUK], sementara [PRODUK PEMBANDING] cuma [HARGA PEMBANDING].", "There's a reason [PRODUCT] sells for [PRODUCT PRICE] while [COMPARISON PRODUCT] only gets [COMPARISON PRICE]."),
  T(10, "curiosity", "Satu keputusan kecil ini mengubah cara [AUDIENS] melihat [BRAND].", "This one small decision changed how [AUDIENCE] see [BRAND]."),

  // 2. Pattern interrupt
  T(11, "interrupt", "Stop [AKTIVITAS] kalau kamu masih [KESALAHAN].", "Stop [ACTIVITY] if you're still [MISTAKE]."),
  T(12, "interrupt", "Jangan [TINDAKAN UMUM] sebelum kamu paham [KONSEP].", "Don't [COMMON ACTION] before you understand [CONCEPT]."),
  T(13, "interrupt", "[HAL YANG DIANGGAP BAGUS] justru bisa menghancurkan [HASIL YANG DIINGINKAN].", "[THING SEEN AS GOOD] can actually ruin [DESIRED RESULT]."),
  T(14, "interrupt", "Aku bakal bilang sesuatu yang mungkin bikin [TARGET AUDIENS] nggak nyaman.", "I'm about to say something that might make [TARGET AUDIENCE] uncomfortable."),
  T(15, "interrupt", "[ANGKA] [TARGET AUDIENS] melakukan [KEBIASAAN], tapi melupakan [HAL PENTING].", "[NUMBER] [TARGET AUDIENCE] [HABIT], but forget [IMPORTANT THING]."),
  T(16, "interrupt", "Lupakan [NASIHAT POPULER]. Ini yang sebenarnya perlu kamu perhatikan.", "Forget [POPULAR ADVICE]. Here's what you really need to watch."),
  T(17, "interrupt", "Kalau aku jadi [KOMPETITOR/POSISI], aku bakal [TINDAKAN TAK TERDUGA].", "If I were [COMPETITOR/POSITION], I'd [UNEXPECTED ACTION]."),
  T(18, "interrupt", "[BRAND] melakukan [TINDAKAN ANEH], dan justru itu yang bikin [HASIL].", "[BRAND] did [STRANGE ACTION], and that's exactly why [RESULT]."),
  T(19, "interrupt", "Kamu nggak butuh [SOLUSI POPULER]. Kamu butuh [SOLUSI ALTERNATIF].", "You don't need [POPULAR SOLUTION]. You need [ALTERNATIVE SOLUTION]."),
  T(20, "interrupt", "[PERNYATAAN KONTROVERSIAL]. Dan aku bisa jelasin alasannya.", "[CONTROVERSIAL STATEMENT]. And I can explain why."),

  // 3. Pain point
  T(21, "pain", "Udah [USAHA YANG DILAKUKAN], tapi masih [MASALAH]?", "Already [EFFORT MADE], but still [PROBLEM]?"),
  T(22, "pain", "Kenapa [KOMPETITOR] bisa [HASIL], sementara kamu masih [KESULITAN]?", "Why can [COMPETITOR] [RESULT] while you're still [STRUGGLE]?"),
  T(23, "pain", "Kalau kamu sering [MASALAH], mungkin penyebabnya adalah [AKAR MASALAH].", "If you often [PROBLEM], the cause might be [ROOT CAUSE]."),
  T(24, "pain", "Capek [AKTIVITAS] tapi nggak pernah [HASIL YANG DIINGINKAN]?", "Tired of [ACTIVITY] but never [DESIRED RESULT]?"),
  T(25, "pain", "Masalah terbesar [TARGET AUDIENS] bukan [ASUMSI], tapi [MASALAH SEBENARNYA].", "The biggest problem for [TARGET AUDIENCE] isn't [ASSUMPTION], it's [REAL PROBLEM]."),
  T(26, "pain", "Percuma [USAHA] kalau kamu masih [KESALAHAN].", "There's no point [EFFORT] if you're still [MISTAKE]."),
  T(27, "pain", "Sudah habis [SUMBER DAYA], tapi [HASIL] masih belum berubah?", "Already spent [RESOURCE], but [RESULT] still hasn't changed?"),
  T(28, "pain", "[TARGET AUDIENS] sering kehilangan [PELUANG] cuma karena [KESALAHAN].", "[TARGET AUDIENCE] often lose [OPPORTUNITY] just because of [MISTAKE]."),
  T(29, "pain", "Kalau [MASALAH] terus terjadi, coba cek [FAKTOR].", "If [PROBLEM] keeps happening, check [FACTOR]."),
  T(30, "pain", "Kamu mungkin kehilangan [HASIL/KESEMPATAN] setiap kali melakukan [KEBIASAAN].", "You might be losing [RESULT/OPPORTUNITY] every time you [HABIT]."),

  // 4. Contrarian
  T(31, "contrarian", "[HAL POPULER] nggak selalu bikin [HASIL POSITIF].", "[POPULAR THING] doesn't always lead to [POSITIVE RESULT]."),
  T(32, "contrarian", "Berhenti menganggap [ASUMSI UMUM] sebagai [KEBENARAN].", "Stop treating [COMMON ASSUMPTION] as [TRUTH]."),
  T(33, "contrarian", "[FAKTOR YANG DIREMEHKAN] bisa lebih penting daripada [FAKTOR POPULER].", "[UNDERRATED FACTOR] can matter more than [POPULAR FACTOR]."),
  T(34, "contrarian", "Kenapa aku nggak setuju dengan [PENDAPAT POPULER]?", "Why I don't agree with [POPULAR OPINION]."),
  T(35, "contrarian", "Semakin kamu [KEBIASAAN], semakin sulit kamu [TUJUAN].", "The more you [HABIT], the harder it gets to [GOAL]."),
  T(36, "contrarian", "[ANGKA BESAR/METRIK] belum tentu berarti [KESUKSESAN].", "[BIG NUMBER/METRIC] doesn't necessarily mean [SUCCESS]."),
  T(37, "contrarian", "[STRATEGI POPULER] bisa jadi keputusan terburuk untuk [KONDISI].", "[POPULAR STRATEGY] could be the worst decision for [SITUATION]."),
  T(38, "contrarian", "Orang bilang [NASIHAT UMUM], tapi coba lihat [BUKTI/CONTOH].", "People say [COMMON ADVICE], but look at [PROOF/EXAMPLE]."),
  T(39, "contrarian", "[HAL YANG DIANGGAP KELEMAHAN] justru bisa menjadi [KEUNGGULAN].", "[THING SEEN AS A WEAKNESS] can actually become [STRENGTH]."),
  T(40, "contrarian", "Kamu nggak harus [TINDAKAN UMUM] untuk bisa [HASIL].", "You don't have to [COMMON ACTION] to [RESULT]."),

  // 5. FOMO & urgency
  T(41, "urgency", "Kalau kamu masih [KEBIASAAN LAMA], kamu bisa tertinggal dalam [PERUBAHAN].", "If you're still [OLD HABIT], you could fall behind on [CHANGE]."),
  T(42, "urgency", "Sebelum [PERISTIWA/PERUBAHAN] terjadi, kamu perlu tahu [HAL PENTING].", "Before [EVENT/CHANGE] happens, you need to know [IMPORTANT THING]."),
  T(43, "urgency", "Semakin lama kamu menunda [TINDAKAN], semakin besar risiko [KONSEKUENSI].", "The longer you put off [ACTION], the bigger the risk of [CONSEQUENCE]."),
  T(44, "urgency", "[PELUANG] ini mungkin nggak akan selalu tersedia dengan [KONDISI].", "This [OPPORTUNITY] might not always be available with [CONDITION]."),
  T(45, "urgency", "Selagi [KOMPETITOR] masih [KEBIASAAN], kamu bisa mulai [STRATEGI].", "While [COMPETITOR] are still [HABIT], you can start [STRATEGY]."),
  T(46, "urgency", "Jangan tunggu sampai [KONDISI BURUK] baru mulai [TINDAKAN].", "Don't wait until [BAD SITUATION] to start [ACTION]."),
  T(47, "urgency", "[TREN/PERUBAHAN] mulai mengubah [INDUSTRI]. Kamu sudah siap?", "[TREND/CHANGE] is starting to change [INDUSTRY]. Are you ready?"),
  T(48, "urgency", "Kamu punya waktu sampai [DEADLINE AKTUAL] untuk mendapatkan [PENAWARAN].", "You have until [REAL DEADLINE] to get [OFFER]."),
  T(49, "urgency", "Kalau [TARGET AUDIENS] nggak mulai [TINDAKAN], apa dampaknya dalam [PERIODE]?", "If [TARGET AUDIENCE] don't start [ACTION], what happens in [PERIOD]?"),
  T(50, "urgency", "Sekarang [KESEMPATAN/PRODUK] masih [KONDISI AKTUAL], tapi [PERUBAHAN YANG DIUMUMKAN].", "Right now [OPPORTUNITY/PRODUCT] is still [CURRENT CONDITION], but [ANNOUNCED CHANGE]."),

  // 6. Authority & social proof
  T(51, "proof", "Setelah [JUMLAH] [PROJECT/PENGALAMAN], aku belajar satu hal tentang [TOPIK].", "After [NUMBER] [PROJECTS/EXPERIENCES], I learned one thing about [TOPIC]."),
  T(52, "proof", "Aku sudah mencoba [STRATEGI] selama [DURASI], dan ini hasilnya.", "I tried [STRATEGY] for [DURATION], and here's what happened."),
  T(53, "proof", "Ini yang terjadi setelah kami mengubah [FAKTOR] di [PROJECT].", "This is what happened after we changed [FACTOR] in [PROJECT]."),
  T(54, "proof", "Dari [JUMLAH] [KASUS/KLIEN], ada satu pola yang terus muncul.", "Out of [NUMBER] [CASES/CLIENTS], one pattern keeps showing up."),
  T(55, "proof", "Aku mau tunjukin data sebenarnya dari [EKSPERIMEN].", "Let me show you the real data from [EXPERIMENT]."),
  T(56, "proof", "Dulu aku percaya [ASUMSI], sampai aku mengalami [PENGALAMAN].", "I used to believe [ASSUMPTION], until I went through [EXPERIENCE]."),
  T(57, "proof", "[BRAND/ORANG] berhasil [HASIL]. Ini strategi yang mereka gunakan.", "[BRAND/PERSON] managed to [RESULT]. Here's the strategy they used."),
  T(58, "proof", "Ini kesalahan yang pernah aku lakukan saat [AKTIVITAS].", "This is a mistake I once made while [ACTIVITY]."),
  T(59, "proof", "Aku membandingkan [STRATEGI A] dengan [STRATEGI B], dan menemukan [INSIGHT].", "I compared [STRATEGY A] with [STRATEGY B], and found [INSIGHT]."),
  T(60, "proof", "Ini [JUMLAH] pelajaran paling penting dari [PENGALAMAN/PROJECT].", "Here are the [NUMBER] most important lessons from [EXPERIENCE/PROJECT]."),

  // 7. Storytelling
  T(61, "story", "Bayangin kamu [SITUASI], lalu tiba-tiba [KONFLIK].", "Imagine you're [SITUATION], then suddenly [CONFLICT]."),
  T(62, "story", "Awalnya [BRAND/ORANG] cuma [KONDISI AWAL], sampai [TITIK BALIK].", "At first [BRAND/PERSON] was just [STARTING POINT], until [TURNING POINT]."),
  T(63, "story", "Ada satu [BRAND/ORANG] yang berani [TINDAKAN BERISIKO].", "There's one [BRAND/PERSON] who dared to [RISKY ACTION]."),
  T(64, "story", "Semua orang mengira [ASUMSI], sampai [KEJADIAN TAK TERDUGA].", "Everyone thought [ASSUMPTION], until [UNEXPECTED EVENT]."),
  T(65, "story", "Cerita ini dimulai ketika [BRAND/ORANG] mengalami [MASALAH].", "This story starts when [BRAND/PERSON] ran into [PROBLEM]."),
  T(66, "story", "Dalam [PERIODE], [BRAND] berubah dari [KONDISI AWAL] menjadi [KONDISI AKHIR].", "In [PERIOD], [BRAND] went from [STARTING POINT] to [END POINT]."),
  T(67, "story", "[BRAND] hampir [KEGAGALAN], lalu memutuskan [TINDAKAN].", "[BRAND] almost [FAILURE], then decided to [ACTION]."),
  T(68, "story", "Waktu pertama kali aku [PENGALAMAN], aku nggak menyangka [HASIL].", "The first time I [EXPERIENCE], I never expected [RESULT]."),
  T(69, "story", "Mereka cuma punya [SUMBER DAYA TERBATAS], tapi berhasil [HASIL].", "They only had [LIMITED RESOURCES], but managed to [RESULT]."),
  T(70, "story", "Satu keputusan [ORANG/BRAND] mengubah [SITUASI] selamanya.", "One decision by [PERSON/BRAND] changed [SITUATION] forever."),

  // 8. Psychology & emotional trigger
  T(71, "feeling", "Kenapa orang rela [PERILAKU] demi [PRODUK/BRAND]?", "Why are people willing to [BEHAVIOUR] for [PRODUCT/BRAND]?"),
  T(72, "feeling", "Secara psikologis, [FAKTOR] bisa memengaruhi cara orang [KEPUTUSAN].", "Psychologically, [FACTOR] can shape how people [DECISION]."),
  T(73, "feeling", "Orang nggak cuma membeli [PRODUK], mereka juga mencari [NILAI EMOSIONAL].", "People don't just buy [PRODUCT], they're also looking for [EMOTIONAL VALUE]."),
  T(74, "feeling", "Ada alasan kenapa [TARGET AUDIENS] lebih percaya [PILIHAN A] daripada [PILIHAN B].", "There's a reason [TARGET AUDIENCE] trust [OPTION A] more than [OPTION B]."),
  T(75, "feeling", "Pernah sadar kenapa [PENGALAMAN] membuat kamu merasa [EMOSI]?", "Ever noticed why [EXPERIENCE] makes you feel [EMOTION]?"),
  T(76, "feeling", "[BRAND] nggak sekadar menjual [PRODUK], tapi membangun [IDENTITAS/PERASAAN].", "[BRAND] isn't just selling [PRODUCT], it's building [IDENTITY/FEELING]."),
  T(77, "feeling", "Apa yang membuat [TARGET AUDIENS] rela membayar [HARGA] untuk [PRODUK]?", "What makes [TARGET AUDIENCE] happy to pay [PRICE] for [PRODUCT]?"),
  T(78, "feeling", "Kalau [TARGET AUDIENS] merasa [EMOSI], kemungkinan mereka akan [PERILAKU].", "When [TARGET AUDIENCE] feel [EMOTION], they're likely to [BEHAVIOUR]."),
  T(79, "feeling", "Kita sering berpikir membeli [FUNGSI PRODUK], padahal kita juga menginginkan [MAKNA].", "We think we're buying [PRODUCT FUNCTION], but we also want [MEANING]."),
  T(80, "feeling", "Kenapa [PESAN/IDENTITAS] lebih mudah diingat daripada [INFORMASI BIASA]?", "Why is [MESSAGE/IDENTITY] easier to remember than [ORDINARY INFORMATION]?"),

  // 9. Educational & value
  T(81, "teach", "[JUMLAH] kesalahan [TOPIK] yang wajib dihindari [TARGET AUDIENS].", "[NUMBER] [TOPIC] mistakes [TARGET AUDIENCE] must avoid."),
  T(82, "teach", "Cara [MENCAPAI HASIL] tanpa harus [PENGORBANAN UMUM].", "How to [ACHIEVE RESULT] without [USUAL SACRIFICE]."),
  T(83, "teach", "Kalau kamu ingin [TUJUAN], pahami [JUMLAH] hal ini dulu.", "If you want [GOAL], understand these [NUMBER] things first."),
  T(84, "teach", "Bedanya [KONSEP A], [KONSEP B], dan [KONSEP C] dalam [CONTOH].", "The difference between [CONCEPT A], [CONCEPT B] and [CONCEPT C] in [EXAMPLE]."),
  T(85, "teach", "Aku jelasin [KONSEP SULIT] dalam [DURASI].", "I'll explain [HARD CONCEPT] in [DURATION]."),
  T(86, "teach", "Ini framework [JUMLAH] langkah untuk [HASIL].", "Here's a [NUMBER]-step framework for [RESULT]."),
  T(87, "teach", "Sebelum melakukan [TINDAKAN], jawab [JUMLAH] pertanyaan ini.", "Before you [ACTION], answer these [NUMBER] questions."),
  T(88, "teach", "[JUMLAH] strategi yang bisa kamu gunakan untuk mengatasi [MASALAH].", "[NUMBER] strategies you can use to fix [PROBLEM]."),
  T(89, "teach", "Kalau aku mulai [BISNIS/PROJECT] dari nol, ini langkah pertamaku.", "If I started [BUSINESS/PROJECT] from zero, this would be my first step."),
  T(90, "teach", "Ini cara mengevaluasi [TOPIK] menggunakan [METODE/INDIKATOR].", "Here's how to evaluate [TOPIC] using [METHOD/INDICATOR]."),

  // 10. Sales & conversion
  T(91, "sales", "Kalau kamu kesulitan [MASALAH], [PRODUK/SOLUSI] bisa membantu [MANFAAT].", "If you're struggling with [PROBLEM], [PRODUCT/SOLUTION] can help you [BENEFIT]."),
  T(92, "sales", "Bayangin bisa [HASIL YANG DIINGINKAN] tanpa harus [KESULITAN].", "Imagine being able to [DESIRED RESULT] without [HASSLE]."),
  T(93, "sales", "Kenapa masih [CARA LAMA] kalau kamu bisa [ALTERNATIF]?", "Why still [OLD WAY] when you could [ALTERNATIVE]?"),
  T(94, "sales", "Ini yang kamu dapatkan dengan [HARGA] untuk [PRODUK].", "This is what you get for [PRICE] with [PRODUCT]."),
  T(95, "sales", "Aku mau tunjukin gimana [PRODUK] membantu [TARGET AUDIENS] melakukan [AKTIVITAS].", "Let me show you how [PRODUCT] helps [TARGET AUDIENCE] [ACTIVITY]."),
  T(96, "sales", "Daripada menghabiskan [WAKTU/BIAYA] untuk [AKTIVITAS], coba [SOLUSI].", "Instead of spending [TIME/MONEY] on [ACTIVITY], try [SOLUTION]."),
  T(97, "sales", "[PRODUK] dibuat untuk [TARGET AUDIENS] yang ingin [TUJUAN].", "[PRODUCT] is made for [TARGET AUDIENCE] who want [GOAL]."),
  T(98, "sales", "Kalau [PRODUK] bisa menyelesaikan [MASALAH], apakah [MANFAAT] relevan buat kamu?", "If [PRODUCT] could solve [PROBLEM], would [BENEFIT] matter to you?"),
  T(99, "sales", "Kamu bisa mencoba [PRODUK] selama [DURASI TRIAL] sebelum memutuskan [TINDAKAN].", "You can try [PRODUCT] for [TRIAL LENGTH] before deciding to [ACTION]."),
  T(100, "sales", "Untuk kamu yang ingin [HASIL], sekarang ada [PENAWARAN AKTUAL] dengan [KEUNTUNGAN].", "For anyone who wants [RESULT], there's now [CURRENT OFFER] with [BENEFIT]."),
];

const BLANK_RE = /\[([A-Z0-9][A-Z0-9 /&'-]*)\]/g;

// The template in the app's language (Indonesian unless it's English).
export const templateText = (tpl, lang = "id") => (lang === "en" ? tpl.en : tpl.id);

// The blanks of a template line, in order, each once.
export function templateBlanks(text) {
  const out = [];
  for (const m of String(text || "").matchAll(BLANK_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// What the owner reads next to a blank's box: "TARGET AUDIENS" → "target audiens".
export const blankLabel = (blank) => String(blank || "").toLowerCase();

// The template split into text and blanks, for drawing it with the blanks
// marked: [{ text } | { blank }].
export function templateParts(text) {
  const parts = [];
  let at = 0;
  const s = String(text || "");
  for (const m of s.matchAll(BLANK_RE)) {
    if (m.index > at) parts.push({ text: s.slice(at, m.index) });
    parts.push({ blank: m[1] });
    at = m.index + m[0].length;
  }
  if (at < s.length) parts.push({ text: s.slice(at) });
  return parts;
}

// The finished line. A filled blank is written as typed (a blank that opens
// the sentence gets a capital first letter); an empty one stays as a marked
// placeholder — "[isi: target audiens]", the same mark the AI script writer
// leaves for a real fact it doesn't have — so it's visible in the script.
export function fillTemplate(text, values = {}, { lang = "id" } = {}) {
  const ask = lang === "en" ? "fill in" : "isi";
  return templateParts(text)
    .map((p, i) => {
      if (p.text !== undefined) return p.text;
      const v = String(values[p.blank] ?? "").replace(/\s+/g, " ").trim();
      if (!v) return `[${ask}: ${blankLabel(p.blank)}]`;
      return i === 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v;
    })
    .join("");
}

// Blanks that only real data can fill — a number, price, duration,
// deadline, offer, a result or an experience the owner had. The picker
// asks for real data on templates with one of these; the AI leaves them
// empty unless the brand facts say it.
const FACT_RE = /\b(ANGKA|JUMLAH|HARGA|DURASI|DEADLINE|PERIODE|AKTUAL|DIUMUMKAN|PENAWARAN|DATA|EKSPERIMEN|PENGALAMAN|PROJECT|KLIEN|KASUS|NUMBER|PRICE|DURATION|LENGTH|DEADLINE|PERIOD|CURRENT|ANNOUNCED|OFFER|EXPERIMENT|EXPERIENCES?|PROJECTS?|CLIENTS|CASES)\b/;
export const isFactBlank = (blank) => FACT_RE.test(String(blank || ""));

export const templateByNumber = (n) => HOOK_TEMPLATES.find((x) => x.n === Number(n)) || null;
export const templatesInGroup = (key) => HOOK_TEMPLATES.filter((x) => x.group === key);

// The groups that suit a funnel stage best, in catalog order (a "cocok"
// dot on screen — never a pre-made choice beyond which group opens first).
export function recommendedTemplateGroups(funnel, n = 3) {
  const first = HOOK_TEMPLATE_GROUPS.filter((g) => g.funnels[0] === funnel);
  const also = HOOK_TEMPLATE_GROUPS.filter((g) => g.funnels[0] !== funnel && g.funnels.includes(funnel));
  return [...first, ...also].slice(0, n).map((g) => g.key);
}
