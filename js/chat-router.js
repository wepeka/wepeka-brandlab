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
const FEELING = /\b(capek|cape|lelah|males|malas|bosan|bosen|stres|stress|pusing|semangat|semangatin|takut|khawatir|nyerah|menyerah|sedih|senang|seneng|curhat|kesel|kesal|galau|minder|insecure|overwhelmed|tired|burnout|exhausted|frustrated)\b|\b(mau|pengen|pingin|ingin) cerita\b|\b(nggak|gak|ga) ?tau (harus )?mulai\b|\bnggak tahu (harus )?mulai\b|\bbingung (harus )?mulai\b/i;
const HAPPENED = /\b(tadi ada|barusan|hari ini ada|kemarin ada|baru aja ada|baru saja ada)\b/i;
const DATA = /\b(performa|performance|engagement|angka|statistik|insight|insights|follower|followers|reach|jangkauan|views|tayangan|penonton|jadwal|schedule|kalender|calendar|overdue|telat|level|milestone|progres|progress|berapa|how many|kenapa konten|why is|di mana|dimana|menu|fitur|benchmark|target|campaign|penjualan|omzet|sales|retensi|retention)\b/i;
// "Let's talk it through": a discussion goes to the thinking partner
// (Brainstorm), not the Konsultan's short data answers — unless it is about
// the owner's own numbers ("menurutmu kenapa reach aku turun").
const DISCUSS = /\b(bahas|bahasin|diskusi|diskusiin|ngobrolin|bedah|breakdown|bongkar|jelasin|jelaskan|menurutmu|menurut kamu|pendapatmu|pendapat kamu|gimana kalau|explain|discuss|strategi|strategy|analisa|analisis)\b/i;

export function routeByRules(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  // 1. "bikinin script…", "tolong tuliskan caption…" — even mid-feeling.
  if (STRONG_WRITE.test(s) && CREATIVE_NOUN.test(s)) return "brainstorm";
  // 2. feelings and news ("capek kerja buat konten tiap hari", "tadi ada
  //    yang borong 20 cup, bisa jadi konten?") — Teman also files the news.
  if (FEELING.test(s) || HAPPENED.test(s)) return "companion";
  // 3. "kasih ide konten buat campaign…", "ganti hook-nya"
  if (WEAK_WRITE.test(s)) return "brainstorm";
  // 4. only one side's words
  const idea = IDEA_WORDS.test(s) || DISCUSS.test(s);
  const data = DATA.test(s);
  if (idea && !data) return "brainstorm";
  if (data && !idea) return "consultant";
  return null;
}
