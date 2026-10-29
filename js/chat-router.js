// Which of the three assistants behind "Tanya Brandlab" a message is for,
// decided for free from its words when they make it obvious — Konsultan
// ("consultant", answers from the data), Brainstorm ("brainstorm", writes:
// ideas, hooks, scripts) or Teman ("companion", hears what happened and how
// the owner feels). null = not obvious: js/consultant-panel.js then asks
// js/ai.js classifyChatIntent (one tiny uncounted call).
//
// Order matters, and it is what the old rules got wrong: a request to WRITE
// something wins over every other word in the message. "Bikin script cerita
// awal mula brand" used to go to Teman (it says "cerita"), which then said
// "Brainstorm yang bikin itu, bukan aku" — the owner asked twice for one
// script. Pure, no imports: tests/chat-router.test.mjs.

// Verbs that only ever mean "make/write" → a request wherever the creative
// noun sits. "buat"/"kasih"/"tolong"… also mean "for"/"give"/"please"
// ("reservasi buat rapat"), so they count only right before the noun.
const NOUNS = "ide|idenya|idea|ideas|konten|kontennya|content|script|scriptnya|skrip|naskah|narasi|voice ?over|vo|hook|hooknya|caption|captionnya|judul|reels?|tiktok|carousel|post|postingan|story|thread|threads|copy|copywriting|tagline|slogan|angle|topik|tema|video";
const STRONG_WRITE = /\b(bikin|bikinin|bikinkan|buatin|buatkan|jadikan|jadiin|jadiinlah|tulis|tulisin|tuliskan|cariin|carikan|rapihin|rapiin|generate|write|create)\b/i;
const CREATIVE_NOUN = new RegExp(`\\b(${NOUNS})\\b`, "i");
const WEAK_WRITE = new RegExp(`\\b(buat|kasih|kasi|minta|bantu|bantuin|tolong|ganti|perbaiki|make|give me|suggest)\\s+(?:[\\p{L}\\d-]+\\s+){0,2}?(${NOUNS})\\b`, "iu");
const IDEA_WORDS = /\b(ide|idea|ideas|brainstorm|inspirasi|konten apa|bikin apa|posting apa|post apa|upload apa|topik|angle|hook|hooknya|mentok|buntu|stuck|script|scriptnya|skrip|naskah|narasi|voice ?over|caption)\b/i;
const FEELING = /\b(capek|cape|lelah|males|malas|bosan|bosen|stres|stress|pusing|semangat|semangatin|takut|khawatir|nyerah|menyerah|sedih|senang|seneng|curhat|kesel|kesal|galau|minder|insecure|overwhelmed|tired|burnout|exhausted|frustrated|down|bete|kecewa|bangga|lega|deg-?degan|happy|excited)\b|\b(mau|pengen|pingin|ingin) cerita\b|\b(nggak|gak|ga) ?tau (harus )?mulai\b|\bnggak tahu (harus )?mulai\b|\bbingung (harus )?mulai\b/i;
const HAPPENED = /\b(tadi ada|barusan|hari ini ada|kemarin ada|baru aja ada|baru saja ada)\b/i;
// Something that happened to the brand, said as news rather than asked as a
// question: an order, an offer, a launch, a sale record, a complaint, a busy
// or quiet day. That is the Teman's job — it offers to keep it in Memori
// Brand, which every other AI feature reads. Before, only the few
// HAPPENED phrases above reached the Teman, and only as the first message
// of an Obrolan: "dapet orderan 50 kaos" or "kemarin diajak collab" went to
// whoever was already talking and never became brand memory.
const NEWS = /\b(dapet|dapat)\s+(orderan|order|pesanan|tawaran|klien|client|reseller|endorse(?:an)?|kerja ?sama|sponsor)\b|\b(diajak|ditawarin|ditawari|diundang|dihubungi|di-?dm)\b|\b(launching|launch|rilis|ngerilis|buka cabang|pindah tempat|pop ?up|bazar|bazaar)\b|\brepeat order\b|\b(borong|ngeborong|sold ?out|habis terjual|ludes|laris|laku keras|tembus|rekor|naik drastis|turun drastis|anjlok)\b|\b(komplain|complain|protes|refund|retur|review jelek|ulasan jelek|bintang 1)\b|\b(rame|ramai|sepi)\b|\bada (?:yang|reseller|pelanggan|customer|orang|klien|toko)\b[^?]*\b(order|beli|pesen|pesan|nanya|ambil|komplain|minta|dm|tag)\b|\b(akhirnya|alhamdulillah|yeay|yay|wkwk)\b/i;
// A question wants an answer (the Konsultan, or Brainstorm) even when it
// mentions news: "kenapa konten aku sepi?", "omzet bulan ini berapa?".
const QUESTION = /\?|^\s*(apa|apakah|kenapa|mengapa|gimana|gmn|bagaimana|berapa|kapan|siapa|mana|di ?mana|boleh|bisakah|haruskah|perlu ?gak|mending|sebaiknya|kok)\b|\b(gimana|bagaimana|berapa|kenapa|mengapa|apa aja|apakah|harus apa|ngapain|mending|sebaiknya|menurutmu|menurut kamu|enaknya)\b/i;
export const isQuestion = (text) => QUESTION.test(String(text || ""));
const isNews = (s) => HAPPENED.test(s) || (NEWS.test(s) && !QUESTION.test(s));
const DATA = /\b(performa|performance|engagement|angka|statistik|insight|insights|follower|followers|reach|jangkauan|views|tayangan|penonton|jadwal|schedule|kalender|calendar|overdue|telat|level|milestone|progres|progress|berapa|how many|kenapa konten|why is|di mana|dimana|menu|fitur|benchmark|target|campaign|penjualan|omzet|sales|retensi|retention)\b/i;
// "Let's talk it through": a discussion goes to the thinking partner
// (Brainstorm), not the Konsultan's short data answers — unless it is about
// the owner's own numbers ("menurutmu kenapa reach aku turun").
const DISCUSS = /\b(bahas|bahasin|diskusi|diskusiin|ngobrolin|bedah|breakdown|bongkar|jelasin|jelaskan|menurutmu|menurut kamu|pendapatmu|pendapat kamu|gimana kalau|explain|discuss|strategi|strategy|analisa|analisis)\b/i;
// "Gimana cara bikin konten di kalender?" asks how the app works — it
// isn't a request to write anything, whatever verb it uses. (Narrow on
// purpose: "bikinin konten cara seduh kopi" and "caption buat menu baru"
// are still requests.)
const HOW_TO = /\b((?:gimana|gmn|gmana|bagaimana) cara(?:nya)?|caranya|how (?:do|can) i|di ?mana|where)\b/i;
// A plain ask for ideas/words in the middle of a mood ("capek banget, kasih
// ide dong") — Teman would only pass it on to Brainstorm. Only the
// unmistakable asks and nouns: "minta" ("pelanggan minta konten gratis")
// and "konten"/"post" ("capek bikin konten") are too often part of a vent.
const ASK_FOR_WORDS = /\b(kasih|kasi|bantu|bantuin|tolong|give me|suggest)\s+(?:[\p{L}\d-]+\s+){0,2}?(ide|idenya|idea|ideas|caption|captionnya|hook|hooknya|script|scriptnya|skrip|naskah|tagline|judul)\b/iu;

// A request to WRITE something ("bikinin caption promo", "tuliskan script
// cerita awal mula brand"): the Konsultan and Teman answer one with only
// [[handoff:brainstorm]] — a charged reply with nothing in it before
// Brainstorm writes it — so js/consultant-panel.js sends these straight to
// Brainstorm even from those tabs.
export function isWriteRequest(text) {
  const s = String(text || "");
  return STRONG_WRITE.test(s) && CREATIVE_NOUN.test(s) && !HOW_TO.test(s);
}

// Mid-conversation the owner keeps talking to whoever answered
// (js/consultant-panel.js decideEngine); only asking for something written
// moves an ongoing Konsultan/Teman talk over to Brainstorm: "bikinin script
// yang itu", or a plain "kasih ide konten…". They would only answer
// [[handoff:brainstorm]] and cost a second call.
export function movesToBrainstorm(text) {
  return isWriteRequest(text) || ASK_FOR_WORDS.test(String(text || ""));
}

// The other way round: a talk that started as a brainstorm (or a vent)
// turns to the owner's own numbers — "terus performa konten aku gimana?",
// "followers aku naik berapa?". Brainstorm has no live data and only
// answered "tanya Konsultan" ([[handoff:consultant]]), so the Konsultan
// takes it, with its charts. Not when the numbers are someone else's
// ("followers mereka berapa?" while dissecting another brand).
const OTHERS = /\b(mereka|dia|kompetitor|competitor|brand lain|brand itu|brand tsb|their|they|them)\b/i;
export function movesToConsultant(text) {
  const s = String(text || "");
  return routeByRules(s) === "consultant" && QUESTION.test(s) && !OTHERS.test(s);
}

// Mid-conversation, news about the brand goes to the Teman — the one that
// files it in Memori Brand. Only news: a worry or a mood in the middle of a
// talk ("tapi aku takut rugi") stays with whoever is talking (the 2026-10-06
// test: passing those to the Teman made one talk feel like a switchboard).
export function movesToCompanion(text) {
  const s = String(text || "");
  return isNews(s) && !isWriteRequest(s) && !ASK_FOR_WORDS.test(s) && !QUESTION.test(s) && !OTHERS.test(s);
}

// Talk about content — under such an answer the chat offers "Jadikan
// script" / "Kasih 3 ide". Under anything else (a data answer, a pricing
// question, a worry) those buttons only pushed ideas nobody asked for.
const CONTENT_TALK = /\b(bedah|breakdown|viral|trend|tren|marketing|campaign|kampanye|branding)\b/i;
export function isContentTalk(text) {
  const s = String(text || "");
  return IDEA_WORDS.test(s) || CREATIVE_NOUN.test(s) || CONTENT_TALK.test(s);
}

export function routeByRules(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  // 1. "bikinin script…", "tolong tuliskan caption…" — even mid-feeling.
  if (isWriteRequest(s)) return "brainstorm";
  // 2. feelings and news ("capek kerja buat konten tiap hari", "tadi ada
  //    yang borong 20 cup, bisa jadi konten?") — Teman also files the news.
  //    A clear ask for ideas outranks the mood, never the news.
  if (FEELING.test(s) && !isNews(s) && ASK_FOR_WORDS.test(s)) return "brainstorm";
  if (FEELING.test(s) || isNews(s)) return "companion";
  // 3. "kasih ide konten buat campaign…", "ganti hook-nya"
  if (WEAK_WRITE.test(s)) return "brainstorm";
  // 4. only one side's words
  const idea = IDEA_WORDS.test(s) || DISCUSS.test(s);
  const data = DATA.test(s);
  if (idea && !data) return "brainstorm";
  if (data && !idea) return "consultant";
  return null;
}
