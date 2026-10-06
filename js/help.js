// Contextual "?" help — one icon per section, plus a few key terms (Brand
// DNA, Brand Guidelines, moodboard, tone of voice...). Hover (on devices
// with a mouse) or click shows a short "what this is + how to use it"
// popover. Deliberately NOT a popup that appears on its own (that's
// the topbar ? popover) and NOT a tour
// (js/tour.js) — this is the quiet layer, silent until someone wonders
// "apa ini?".
//
// helpButtonHTML(key)          → the highlighted "?" button
// helpTermHTML(key, label)     → a dotted-underline label that explains
//                                itself on hover, followed by the "?"
import { icon } from "./icons.js";
import { qsa, escapeHtml, openMenu, closeMenu } from "./dom.js";
import { getLang } from "./i18n.js";

// key -> { id: {title, body}, en: {title, body} }. Body is 1-3 short
// sentences: what it is, then how to use it.
const HELP_CONTENT = {
  "brand-builder-hub": {
    id: { title: "Brand Builder", body: "Dua pintu: Brand DNA (fondasi — siapa pelanggan, masalah, positioning, nama, tagline) dan Brand Book (identitas visual — logo, warna, tipografi, tone of voice). Isi Brand DNA dulu kalau brand ini masih baru, baru lanjut ke Guidelines." },
    en: { title: "Brand Builder", body: "Two doors: Brand DNA (the foundation — customers, problem, positioning, name, tagline) and the Brand Book (visual identity — logo, colors, typography, tone of voice). Start with Brand DNA if the brand is new, then move on to Guidelines." },
  },
  "calendar": {
    id: { title: "Kalender", body: "Jadwal semua konten brand ini dalam satu tampilan bulanan. Klik tanggal buat lihat apa yang udah dijadwalin, atau tambah konten baru langsung dari sini biar nggak ada hari yang bolong. Tanggal yang sudah lewat nggak bisa dipakai buat jadwal baru." },
    en: { title: "Calendar", body: "Every piece of this brand's content in one monthly view. Click a date to see what's scheduled or add new content right there so no day is left empty. Dates that have already passed can't be used for new schedules." },
  },
  "creator": {
    id: { title: "Creator", body: "Tempat nulis satu konten sampai selesai — hook, script, caption — dibantu AI, mengikuti Brand DNA dan tone of voice brand ini biar hasilnya konsisten. Klik Konten Baru, pilih platform, lalu AI langsung bantu bikin draft-nya." },
    en: { title: "Creator", body: "Where one piece of content gets written start to finish — hook, script, caption — with AI help that follows this brand's DNA and tone of voice. Click New Content, pick a platform, and the AI helps you draft it right away." },
  },
  "campaigns": {
    id: { title: "Tujuan", body: "Tujuan yang lagi dikejar brand ini sekarang. Tiap milestone tahu sumber angkanya (tab Konten, Instagram Insights, performa konten, atau catatanmu) dan kasih satu tombol buat memperbaruinya." },
    en: { title: "Goals", body: "The goal this brand is working toward right now. Every milestone knows where its number comes from (the Content tab, Instagram Insights, content performance, or your own notes) and gives you one button to update it." },
  },
  "campaign-detail": {
    id: { title: "Detail Campaign", body: "Dibaca dari atas ke bawah: posisi kamu sekarang (angka utama), apa yang perlu dikerjain (Langkah berikutnya), lalu milestone dan kontennya. Angka nggak pernah diketik manual di sini — semua ada sumbernya, kecuali yang memang cuma kamu yang tahu (dicatat lewat lembar Catat angka)." },
    en: { title: "Campaign Detail", body: "Read top to bottom: where you stand now (the headline number), what to do next (Next step), then milestones and their content. Numbers are never typed here by hand — each has a source, except the ones only you know (logged through the manual-entry sheet)." },
  },
  "content-list": {
    id: { title: "Daftar Konten", body: "Tempat cek konten yang udah ada — pilih mau lihat semua, yang udah terjadwal, atau yang udah terbit. Buat nulis konten baru dari nol, pakai Creator, bukan di sini." },
    en: { title: "Content List", body: "Where you check existing content — everything, what's scheduled, or what's published. To write new content from scratch, use Creator instead." },
  },
  "content-os": {
    id: { title: "Konten", body: "Lima tab buat satu alur: Creator (nulis konten), Kalender (jadwalkan), Daftar Konten (cek yang udah ada), Tulisan Cepat (tulisan singkat siap pakai), dan Seri (rencanakan konten berseri). Selalu urutan yang sama, di kedua mode." },
    en: { title: "Content", body: "Five tabs for one flow: Creator (write content), Calendar (schedule it), Content List (check what's there), Quick Copy (short ready-to-use copy), and Series (plan multi-part content). Always the same order, in both modes." },
  },
  "brand-dna": {
    id: { title: "Brand DNA", body: "Wizard satu pertanyaan per langkah biar nggak kayak ngisi form kosong. Lima langkah pertama itu inti — audiens, masalah, kenapa harus percaya, rencana, dan ajakan bertindak. Jawaban tersimpan tiap kali klik Lanjut, jadi aman ditinggal kapan aja." },
    en: { title: "Brand DNA", body: "A wizard with one question per step, so it never feels like a blank form. The first five steps are the core — audience, problem, why trust you, plan, and call to action. Answers are saved every time you click Next, so it's safe to leave anytime." },
  },
  "brand-guidelines": {
    id: { title: "Brand Book itu apa?", body: "Buku aturan tampilan brand kamu — ibarat dress code. Isinya logo dan cara pakainya, warna, font, arah visual, dan tone of voice, biar semua konten dan desain (siapa pun yang bikin) kelihatan dari brand yang sama. Bagiannya bebas urutan; hasil akhirnya bisa diunduh jadi Brand Book (PDF)." },
    en: { title: "What is the Brand Book?", body: "Your brand's rulebook for how it looks and sounds — like a dress code. Logo and how to use it, colors, fonts, visual direction and tone of voice, so every piece of content and design (whoever makes it) looks like the same brand. Sections can be done in any order; the result downloads as a Brand Book (PDF)." },
  },
  "settings": {
    id: { title: "Pengaturan", body: "Berlaku ke semua brand kamu, bukan per-brand: daftar brand, bahasa, akun & paket, Sampah (yang dihapus, bisa dipulihkan 30 hari), dan backup data. Di mode Pro ada juga daftar platform & format konten." },
    en: { title: "Settings", body: "Applies to all your brands, not just one: your brand list, language, account & plan, Trash (deleted items, restorable for 30 days) and data backup. Pro also adds the platform and content format lists." },
  },
  "sales": {
    id: { title: "Pelacak Penjualan", body: "Tempat mencatat penjualan. Yang kamu isi cuma satu: tiap ada yang beli, pilih produk dan jumlahnya. Total, tren mingguan, campaign Sales Growth, saran AI, dan export Excel/PDF semuanya ngikut dari catatan itu. Brandlab belum bisa baca data penjualan otomatis, jadi semua angka di sini dari kamu." },
    en: { title: "Sales Tracker", body: "Where sales get logged. You only type one thing: whenever someone buys, pick the product and how many. Totals, the weekly trend, your Sales Growth campaign, AI advice and the Excel/PDF export all follow from that log. Brandlab can't read sales data automatically, so every number here comes from you." },
  },
  "copy-studio": {
    id: { title: "Tulisan Cepat", body: "Tulisan pendek siap pakai: Threads, caption Story, broadcast WhatsApp, caption feed. Pilih format dan tujuan, ceritain mau nyampein apa, AI tulisin 3 pilihan pakai gaya bahasa brand ini. Hasilnya nggak disimpan, jadi salin dulu sebelum pindah halaman." },
    en: { title: "Quick Copy", body: "Short ready-to-use copy: Threads posts, Story captions, WhatsApp broadcasts, feed captions. Pick a format and goal, say what you want to get across, and AI writes 3 options in this brand's voice. Results aren't saved, so copy them before leaving the page." },
  },
  "home": {
    id: { title: "Beranda", body: "\"Hari ini\" selalu bilang satu hal yang perlu kamu kerjain sekarang — identitas brand yang belum selesai, atau langkah paling penting begitu identitasnya rampung. \"Minggu ini\" merangkum 7 hari terakhir (yang terbit, penjualan, report PDF) dan jadwal 7 hari ke depan. Di \"Lainnya\": langkah dasar, Teman Brand (ceritain kejadian di brand-mu; tekan Rangkum supaya jadi momen yang kamu pilih untuk diingat semua fitur AI), dan ajakan menyusun roadmap. Mode Pro juga punya analitik di paling bawah." },
    en: { title: "Home", body: "\"Today\" always tells you the one thing to do now — your unfinished brand identity, or the most important step once that's done. \"This week\" sums up the last 7 days (what went out, sales, the PDF report) and the next 7 days' schedule. Under \"More\": the basic steps, the Companion (tell it what happened in your brand; hit Recap to turn it into moments you pick for every AI feature to remember), and the roadmap invite. Pro mode also has analytics at the bottom." },
  },

  "brainstorm": {
    id: { title: "Tanya Brandlab", body: "Satu tempat ngobrol dengan AI. Tanya soal brand, minta ide konten, atau cerita kejadian hari ini — AI yang nentuin kamu butuh saran, ide, atau tempat cerita. Kalau ada yang layak disimpan, AI yang nawarin: ide yang kamu suka masuk Tersimpan (bisa jadi draft kapan saja), kejadian penting masuk Memori Brand (dibaca semua fitur AI saat bikin script). Semua obrolan ada di kiri dan bisa dilanjut." },
    en: { title: "Ask Brandlab", body: "One place to talk to the AI. Ask about your brand, ask for content ideas, or tell it what happened today — it works out whether you need advice, ideas, or someone to tell. When something is worth keeping, the AI offers it: ideas you like go to Saved (a draft whenever you're ready), things that happened go to brand memory (read by every AI feature when it writes). Every conversation is on the left, ready to carry on." },
  },

  // Key terms — shown next to the words themselves.
  "term-brand-dna": {
    id: { title: "Brand DNA itu apa?", body: "Fondasi brand kamu dalam kata-kata: siapa pelanggannya, masalah apa yang kamu selesaikan, kenapa mereka harus percaya dan pilih kamu, sampai tagline. Semua fitur AI dan campaign membaca dari sini." },
    en: { title: "What is Brand DNA?", body: "Your brand's foundation in words: who the customers are, what problem you solve, why they should trust and choose you, and your tagline. Every AI feature and campaign reads from it." },
  },
  "term-brand-guidelines": {
    id: { title: "Brand Book itu apa?", body: "Aturan tampilan brand kamu — logo, warna, font, arah visual, dan tone of voice — biar semua konten kelihatan dari brand yang sama. Bisa diunduh jadi PDF untuk dikasih ke desainer atau tim." },
    en: { title: "What is the Brand Book?", body: "The rules for how your brand looks — logo, colors, fonts, visual direction and tone of voice — so all content looks like it comes from the same brand. Download it as a PDF to hand to a designer or your team." },
  },
  "term-logo": {
    id: { title: "Perlu logo, nggak?", body: "Logo nggak wajib buat langkah Warna & Font — boleh dilewati dulu. Tapi Brand Book pakai logo ini buat halaman aturan pemakaian (jarak aman, background, larangan), jadi upload begitu ada. Belum punya? Generate dulu pakai ChatGPT, lalu upload di sini." },
    en: { title: "Do I need a logo?", body: "A logo isn't required for the Colors & Fonts step — you can skip it for now. But the Brand Book uses it for the usage-rules pages (clear space, backgrounds, don'ts), so upload one once you have it. Don't have one? Generate it with ChatGPT first, then upload it here." },
  },
  "term-color": {
    id: { title: "Sistem warna itu apa?", body: "3 warna utama (Primary, Secondary, Accent) plus warna background dan teks. Dipakai konsisten di semua konten biar orang langsung ngenalin brand kamu dari warnanya." },
    en: { title: "What's a color system?", body: "3 main colors (Primary, Secondary, Accent) plus background and text colors, used consistently across all content so people recognize your brand by its colors." },
  },
  "term-typography": {
    id: { title: "Tipografi itu apa?", body: "Pasangan font brand: satu buat judul, satu buat teks isi (boleh satu lagi buat aksen). Maksimal 2–3 font biar rapi dan gampang dikenali." },
    en: { title: "What's typography?", body: "Your brand's font pairing: one for headings, one for body text (optionally one accent). At most 2–3 fonts keeps things tidy and recognizable." },
  },
  "term-direction": {
    id: { title: "Arah visual itu apa?", body: "Gaya keseluruhan tampilan brand (misal minimalis, hangat, bold). Menentukan bentuk sudut, jarak, dan gaya foto di seluruh Brand Book." },
    en: { title: "What's visual direction?", body: "The overall style of your brand's look (e.g. minimalist, warm, bold). It sets corner shapes, spacing and photo style throughout the Brand Book." },
  },
  "term-moodboard": {
    id: { title: "Moodboard itu apa?", body: "Kumpulan 5–10 foto referensi yang nunjukin \"rasa\" visual brand: warna, cahaya, suasana, gaya foto. Bukan buat diposting — contekan biar semua konten kelihatan satu keluarga." },
    en: { title: "What's a moodboard?", body: "A set of 5–10 reference photos showing your brand's visual \"feel\": colors, light, mood, photo style. Not for posting — a cheat sheet so all your content looks like one family." },
  },
  "term-tone": {
    id: { title: "Tone of voice itu apa?", body: "Cara brand kamu ngomong: formal atau santai, sederhana atau teknis, serius atau playful. Dipakai AI waktu nulis caption, naskah, dan balasan biar suaranya konsisten." },
    en: { title: "What's tone of voice?", body: "How your brand talks: formal or casual, simple or technical, serious or playful. The AI uses it when writing captions, scripts and replies so the voice stays consistent." },
  },
  "term-applications": {
    id: { title: "Penerapan brand itu apa?", body: "Tempat-tempat brand kamu muncul (Instagram, kemasan, kartu nama, dll). Brand Book bikin contoh dan aturannya buat tiap tempat yang kamu pilih." },
    en: { title: "What are brand applications?", body: "The places your brand shows up (Instagram, packaging, business cards, etc.). The Brand Book adds examples and rules for each one you pick." },
  },
};

export function helpEntry(key) {
  const e = HELP_CONTENT[key];
  return e ? e[getLang()] || e.id : null;
}

export function helpButtonHTML(key) {
  const entry = helpEntry(key);
  if (!entry) return "";
  return `<button type="button" class="icon-btn help-btn" data-help="${key}" title="${escapeHtml(entry.title)}" aria-label="${escapeHtml(entry.title)}">${icon("help", { size: 15 })}</button>`;
}

export function helpTermHTML(key, label) {
  if (!helpEntry(key)) return escapeHtml(label);
  return `<span class="help-term" data-help-term="${key}" tabindex="0">${escapeHtml(label)}</span>${helpButtonHTML(key)}`;
}

const canHover = () => !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

// Call once after the view's innerHTML is set. Safe to call even if the
// view has no help buttons.
export function wireHelpButtons(root) {
  qsa("[data-help], [data-help-term]", root).forEach((el) => {
    const key = el.dataset.help || el.dataset.helpTerm;
    let pop = null;
    let hoverOpened = false;
    let openTimer = null;
    let closeTimer = null;
    const isOpen = () => !!pop && pop.isConnected;
    const scheduleClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (isOpen() && hoverOpened) closeMenu();
      }, 220);
    };
    const open = () => {
      const entry = helpEntry(key);
      if (!entry || isOpen()) return;
      const rect = el.getBoundingClientRect();
      pop = openMenu(el, { className: "help-popover", top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)) });
      if (!pop) return;
      pop.innerHTML = `<div class="help-popover-title">${escapeHtml(entry.title)}</div><p class="help-popover-body">${escapeHtml(entry.body)}</p>`;
      pop.addEventListener("mouseenter", () => clearTimeout(closeTimer));
      pop.addEventListener("mouseleave", () => { if (hoverOpened) scheduleClose(); });
    };
    el.addEventListener("click", (e) => {
      // Help buttons can sit inside a link (Brand Builder's doors) — never navigate.
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      if (isOpen()) {
        if (hoverOpened) {
          hoverOpened = false; // hovered open, clicked → keep it open
          return;
        }
        closeMenu();
        return;
      }
      hoverOpened = false;
      open();
    });
    if (canHover()) {
      el.addEventListener("mouseenter", () => {
        clearTimeout(closeTimer);
        if (isOpen()) return;
        openTimer = setTimeout(() => {
          hoverOpened = true;
          open();
        }, 180);
      });
      el.addEventListener("mouseleave", () => {
        clearTimeout(openTimer);
        if (hoverOpened) scheduleClose();
      });
    }
  });
}
