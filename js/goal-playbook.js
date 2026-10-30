// "Cara mencapainya" — My Goals' answer to "terus aku harus ngapain?".
// A target on its own ("Shares 160") says WHAT; a play says HOW: one concrete
// marketing move (a collab, a 48-hour promo, a countdown) with three plain
// steps. The owner picks one and either saves it (kept as a goal idea, see
// store.js addBrandIdea + playId) or runs it (its steps become the goal's
// to-do, js/goal-actions.js addGoalTask). Nothing is made until they tap.
//
// Plays are fixed advice in both languages, grouped by the target they help
// (GROUPS). A play's `ty` = what it is: a piece of content, a campaign (a
// small run of steps), or an event.
import { getLang } from "./i18n.js";

const P = (k, ty, ic, id, en) => ({ k, ty, ic, id, en });
const p = (t, w, s) => ({ t, w, s });

const PLAYS = {
  // ---- Sosmed Growth
  collab: P("collab", "campaign", "users",
    p("Collab post sama akun sejenis", "Audiens akun lain jadi kenal kamu — cara tercepat nambah followers.", ["Pilih 3 akun seukuran kamu dengan audiens yang mirip", "DM tawarkan collab post atau live bareng", "Posting bareng, lalu balas semua komentar di 24 jam pertama"]),
    p("Collab post with a similar account", "Their audience gets to know you — the fastest way to add followers.", ["Pick 3 accounts your size with a similar audience", "DM them a collab post or a joint live", "Post together, then answer every comment in the first 24 hours"])),
  giveaway: P("giveaway", "campaign", "megaphone",
    p("Giveaway mini 7 hari", "Hadiah kecil yang relevan, syaratnya follow + tag teman.", ["Tentukan hadiah yang cuma menarik buat calon pembelimu", "Posting aturan: follow, share ke Story, tag 2 teman", "Umumkan pemenang lewat Reels dan minta pemenang repost"]),
    p("7-day mini giveaway", "A small prize that fits your brand, entry = follow + tag friends.", ["Pick a prize only your future buyers would want", "Post the rules: follow, share to Story, tag 2 friends", "Announce the winner in a Reel and ask them to repost"])),
  batch: P("batch", "campaign", "calendar",
    p("Hari produksi sekali seminggu", "Satu hari rekam banyak, sisanya tinggal upload.", ["Tentukan satu hari tetap tiap minggu", "Rekam 3–4 konten sekaligus dari daftar ide", "Jadwalkan upload di hari-hari berbeda, ulangi tiap minggu"]),
    p("One production day a week", "Shoot a lot in one day, the rest is just uploading.", ["Pick one fixed day each week", "Shoot 3–4 pieces in one go from your idea list", "Schedule uploads on different days, repeat every week"])),
  series: P("series", "content", "refresh",
    p("Bikin satu seri mingguan", "Format yang sama tiap minggu — kamu tidak mulai dari nol tiap kali.", ["Pilih satu topik seri (mis. \"Tips 60 detik\")", "Tentukan hari tayang tetap", "Bikin 3 episode pertama sebelum tayang"]),
    p("Start one weekly series", "Same format every week — you never start from zero.", ["Pick a series topic (e.g. \"60-second tips\")", "Choose a fixed air day", "Make the first 3 episodes before you launch"])),
  relatable: P("relatable", "content", "send",
    p("Konten \"kirim ke temanmu yang…\"", "Orang nge-share konten yang mewakili diri mereka.", ["Tulis 5 situasi yang sering dialami pelangganmu", "Bikin satu konten: \"Kirim ini ke temanmu yang suka…\"", "Tutup dengan ajakan share di kalimat terakhir"]),
    p("\"Send this to a friend who…\" content", "People share what speaks for them.", ["Write 5 situations your customers live through", "Make one piece: \"Send this to the friend who…\"", "End with a clear ask to share"])),
  myth: P("myth", "content", "layers",
    p("Carousel mitos vs fakta", "Hal yang mengejutkan bikin orang ingin meneruskan.", ["Kumpulkan 3 mitos di bidangmu", "Bikin carousel: mitos → fakta", "Ajak audiens kirim ke orang yang masih percaya mitos itu"]),
    p("Myth vs fact carousel", "A surprise makes people pass it on.", ["Collect 3 myths in your field", "Make a carousel: myth → fact", "Ask people to send it to someone who still believes it"])),
  checklist: P("checklist", "content", "check",
    p("Carousel checklist langkah-langkah", "Orang menyimpan konten yang bisa dipakai nanti.", ["Pilih satu masalah pelangganmu", "Susun 5–7 langkah jelas, satu per slide", "Slide terakhir: \"Simpan buat nanti\""]),
    p("Step-by-step checklist carousel", "People save what they can use later.", ["Pick one problem your customer has", "Write 5–7 clear steps, one per slide", "Last slide: \"Save for later\""])),
  template: P("template", "content", "bookmark",
    p("Bagikan contoh / template siap pakai", "Sesuatu yang bisa langsung ditiru lebih sering disimpan.", ["Pilih yang kamu pakai sendiri (template, daftar, resep)", "Tampilkan hasil jadi + cara pakainya", "Ajak simpan supaya tidak lupa"]),
    p("Share a ready-to-use example or template", "Something people can copy right away gets saved more.", ["Pick something you use yourself (template, list, recipe)", "Show the finished result and how to use it", "Ask people to save it so they don't forget"])),
  question: P("question", "campaign", "chat",
    p("Tanya pendapat di tiap konten", "Pertanyaan yang bisa dijawab satu kata memancing komentar.", ["Akhiri 3 konten ke depan dengan pertanyaan pilihan (A atau B?)", "Balas setiap komentar dalam 1 jam pertama", "Angkat jawaban terbaik jadi konten berikutnya"]),
    p("Ask for opinions in every post", "A question answerable in one word pulls comments.", ["End your next 3 posts with an either/or question", "Answer every comment within the first hour", "Turn the best answer into your next post"])),
  poll: P("poll", "campaign", "chart",
    p("Polling Story dua kali seminggu", "Polling itu ringan — orang ikut tanpa mikir.", ["Buat polling 2 pilihan yang ringan", "Tayangkan Senin dan Kamis", "Bahas hasilnya di konten atau Story berikutnya"]),
    p("Story poll twice a week", "A poll is light — people join without thinking.", ["Make an easy 2-option poll", "Run it Monday and Thursday", "Talk about the result in your next post or Story"])),
  winner: P("winner", "content", "flame",
    p("Ulangi konten yang paling jalan", "Yang sudah terbukti disukai audiens, dibikin lagi dengan sudut baru.", ["Buka Hasil: lihat 3 konten dengan engagement tertinggi", "Cari kesamaan: hook, format, topik", "Bikin 2 versi baru dengan pola yang sama"]),
    p("Remake your best-performing content", "What your audience already liked, again with a new angle.", ["Open Results: find your 3 highest-engagement posts", "Spot what they share: hook, format, topic", "Make 2 new versions with the same pattern"])),
  hook: P("hook", "content", "bulb",
    p("Perkuat 3 detik pertama", "Hook yang kuat bikin orang berhenti scroll.", ["Tulis 5 hook berbeda untuk satu topik", "Pakai yang paling bikin penasaran", "Cek hasilnya setelah 48 jam"]),
    p("Sharpen the first 3 seconds", "A strong hook stops the scroll.", ["Write 5 different hooks for one topic", "Use the one that sparks most curiosity", "Check how it did after 48 hours"])),
  guest: P("guest", "campaign", "mic",
    p("Jadi tamu / undang tamu", "Dapat kepercayaan audiens orang lain.", ["Daftar 3 orang yang cocok diajak ngobrol bareng", "Ajak ngobrol 15 menit (live atau rekaman)", "Potong jadi 2–3 konten dan tag keduanya"]),
    p("Be a guest / invite a guest", "Borrow the trust another audience has in them.", ["List 3 people worth talking with", "Have a 15-minute chat (live or recorded)", "Cut it into 2–3 posts and tag each other"])),

  // ---- Community
  wagroup: P("wagroup", "campaign", "chat",
    p("Buka grup / channel khusus", "Tempat tetap buat kumpul: grup WhatsApp, Discord, atau Broadcast.", ["Pilih satu tempat kumpul (WA Community, Discord, dst)", "Tulis aturan singkat + alasan orang harus gabung", "Ajak 10 pelanggan terdekat dulu, lalu umumkan di konten"]),
    p("Open a group / channel", "A fixed place to gather: WhatsApp group, Discord or Broadcast.", ["Pick one place (WA Community, Discord, etc.)", "Write short rules and why people should join", "Invite your 10 closest customers first, then announce it in a post"])),
  invitebio: P("invitebio", "campaign", "link",
    p("Ajakan gabung di tiap konten", "Orang gabung kalau diajak, dan tahu untungnya.", ["Taruh link gabung di bio", "Tambah satu kalimat ajakan di caption tiap konten", "Sebut keuntungan yang cuma didapat member"]),
    p("A join invite in every post", "People join when asked and told what they get.", ["Put the join link in your bio", "Add one invite line to every caption", "Name what only members get"])),
  ritual: P("ritual", "campaign", "refresh",
    p("Ritual mingguan", "Kegiatan tetap yang ditunggu member tiap minggu.", ["Tentukan satu kegiatan (tanya jawab, tips, challenge kecil)", "Pilih hari & jam tetap", "Mention member yang aktif supaya mereka merasa dilihat"]),
    p("Weekly ritual", "A fixed activity members look forward to each week.", ["Pick one activity (Q&A, tip, small challenge)", "Fix a day and time", "Mention active members so they feel seen"])),
  challenge: P("challenge", "campaign", "flag",
    p("Challenge 7 hari", "Tantangan kecil bikin member balik tiap hari.", ["Bikin tantangan yang bisa dikerjakan 5 menit per hari", "Member setor hasil tiap hari di grup", "Beri apresiasi dan rekap di hari ke-7"]),
    p("7-day challenge", "A small challenge brings members back daily.", ["Make a task that takes 5 minutes a day", "Members post their result in the group every day", "Give thanks and a recap on day 7"])),
  ugcask: P("ugcask", "campaign", "image",
    p("Minta member share hasil pakai", "Konten dari member lebih dipercaya daripada konten dari kamu.", ["Siapkan hashtag atau stiker khusus", "Ajak member posting dan tag akunmu", "Repost tiap kiriman dan ucapkan terima kasih"]),
    p("Ask members to share how they use it", "Member posts are trusted more than yours.", ["Prepare a hashtag or sticker", "Ask members to post and tag you", "Repost every entry and say thanks"])),
  spotlight: P("spotlight", "content", "sparkle",
    p("Member of the week", "Member merasa dihargai, dan jadi cerita yang bisa kamu posting.", ["Pilih satu member tiap minggu", "Ceritakan kisahnya di Story atau feed", "Minta ia mengajak satu teman"]),
    p("Member of the week", "Members feel valued and you get a story to post.", ["Pick one member each week", "Tell their story in Story or the feed", "Ask them to bring one friend"])),
  testi: P("testi", "content", "heart",
    p("Kumpulkan testimoni", "Kata orang lain lebih meyakinkan daripada kata kamu.", ["Kirim 3 pertanyaan singkat ke pelanggan yang puas", "Rapikan jawabannya dan minta izin menampilkan", "Posting sebagai carousel \"kata mereka\""]),
    p("Collect testimonials", "Other people's words persuade more than yours.", ["Send 3 short questions to happy customers", "Tidy the answers and ask permission to post", "Post as a \"what they say\" carousel"])),
  referral: P("referral", "campaign", "megaphone",
    p("Ajak teman, dapat bonus", "Pelanggan paling percaya rekomendasi temannya.", ["Tentukan bonus sederhana untuk yang mengajak", "Kabari pelanggan lewat grup atau DM", "Catat siapa yang mengajak siapa"]),
    p("Bring a friend, get a bonus", "Customers trust a friend's recommendation most.", ["Pick a simple bonus for whoever brings someone", "Tell customers in the group or by DM", "Note who brought whom"])),
  meetup: P("meetup", "event", "calendar",
    p("Kumpul kecil online / offline", "Bertemu langsung bikin member makin dekat.", ["Tentukan tema dan tanggal (cukup 1 jam)", "Buka pendaftaran lewat grup", "Rekam momennya, jadikan konten recap"]),
    p("Small online / offline meetup", "Meeting in person brings members closer.", ["Pick a theme and a date (1 hour is enough)", "Open sign-ups in your group", "Capture the moment and turn it into a recap post"])),
  liveqa: P("liveqa", "event", "play",
    p("Live tanya jawab bareng member", "Member merasa didengar, kamu dapat bahan konten.", ["Kumpulkan pertanyaan dari grup", "Live 30 menit di Instagram", "Simpan cuplikan terbaik jadi Reels"]),
    p("Live Q&A with members", "Members feel heard, you get content material.", ["Collect questions from the group", "Go live for 30 minutes on Instagram", "Save the best bits as a Reel"])),

  // ---- Sales
  flash: P("flash", "campaign", "flame",
    p("Promo terbatas 48 jam", "Batas waktu bikin orang berani memutuskan.", ["Pilih satu produk + diskon atau bonus yang jelas", "Tayangkan hitung mundur di Story dan 2 konten", "Tutup tepat waktu dan umumkan hasilnya"]),
    p("48-hour limited promo", "A deadline helps people decide.", ["Pick one product and a clear discount or bonus", "Show a countdown in Story and 2 posts", "Close on time and announce the result"])),
  bundle: P("bundle", "campaign", "layers",
    p("Paket bundling hemat", "Pembeli ambil lebih banyak kalau paketnya terlihat untung.", ["Gabungkan 2–3 produk jadi satu paket hemat", "Bikin konten \"isi paketnya\"", "Tawarkan ke yang pernah bertanya"]),
    p("Value bundle", "Buyers take more when the bundle looks like a deal.", ["Combine 2–3 products into one saving pack", "Make an \"what's inside\" post", "Offer it to people who asked before"])),
  askdm: P("askdm", "campaign", "chat",
    p("Ajakan tanya di tiap konten", "Calon pembeli sering ragu mulai bertanya — pancing mereka.", ["Tambah \"DM kata INFO untuk detail\" di akhir konten", "Siapkan template balasan yang cepat", "Catat siapa yang bertanya"]),
    p("An ask-us line in every post", "Buyers hesitate to ask first — nudge them.", ["Add \"DM INFO for details\" at the end of posts", "Prepare a quick reply template", "Note who asked"])),
  faq: P("faq", "content", "help",
    p("Konten jawab pertanyaan yang sering muncul", "Jawaban yang jelas menghapus keraguan sebelum beli.", ["Kumpulkan 5 pertanyaan yang paling sering masuk", "Jawab satu per konten pendek", "Simpan semuanya di Highlight"]),
    p("Content answering your common questions", "Clear answers remove doubt before buying.", ["Collect the 5 questions you get most", "Answer one per short post", "Keep them all in a Highlight"])),
  testisales: P("testisales", "content", "heart",
    p("Carousel \"kata pembeli\"", "Bukti dari pembeli lain adalah dorongan beli terkuat.", ["Pilih 5 pembeli yang puas", "Minta foto atau ulasan satu kalimat", "Susun jadi carousel dan taruh di Highlight"]),
    p("\"What buyers say\" carousel", "Proof from other buyers is the strongest nudge.", ["Pick 5 happy buyers", "Ask for a photo or one-line review", "Make a carousel and keep it in a Highlight"])),
  reorder: P("reorder", "campaign", "refresh",
    p("Hubungi pembeli lama", "Menjual ke yang sudah pernah beli jauh lebih mudah.", ["Daftar pembeli 2–4 minggu terakhir", "Kirim pesan personal + penawaran beli lagi", "Catat siapa yang order ulang"]),
    p("Follow up past buyers", "Selling to people who already bought is much easier.", ["List buyers from the last 2–4 weeks", "Send a personal message + a re-order offer", "Note who orders again"])),
  offer: P("offer", "content", "money",
    p("Tulis penawaran satu halaman", "Orang baru harus paham harga, cara order, dan buktinya dalam 10 detik.", ["Tulis: harga, cara order, bukti", "Taruh di bio atau Highlight", "Tes: orang baru paham dalam 10 detik?"]),
    p("Write a one-page offer", "A newcomer should get price, how to order and proof in 10 seconds.", ["Write: price, how to order, proof", "Put it in your bio or a Highlight", "Test: does a newcomer get it in 10 seconds?"])),

  // ---- Event
  countdown: P("countdown", "content", "clock",
    p("Konten hitung mundur", "Teaser harian bikin orang menunggu hari-H.", ["Tentukan 5 hari tayang menjelang event", "Tiap hari satu teaser (lineup, tempat, bonus)", "Hari-H: ajakan terakhir + link daftar"]),
    p("Countdown content", "Daily teasers make people wait for the day.", ["Pick 5 posting days before the event", "One teaser a day (lineup, place, bonus)", "Event day: last call + sign-up link"])),
  presale: P("presale", "campaign", "calendar",
    p("Presale / daftar awal", "Yang daftar awal dapat harga atau bonus khusus.", ["Beri harga atau bonus khusus pendaftar awal", "Buka 7–10 hari dan tutup di tanggal pasti", "Umumkan sisa kuota di Story"]),
    p("Presale / early sign-up", "Early sign-ups get a special price or bonus.", ["Give early sign-ups a special price or bonus", "Open for 7–10 days and close on a fixed date", "Announce remaining spots in Story"])),
  invite10: P("invite10", "campaign", "users",
    p("Ajak 10 orang pertama langsung", "Peserta pertama paling mudah datang dari ajakan personal.", ["Daftar 10 orang yang paling pasti datang", "Kirim ajakan personal lewat DM atau WA", "Minta tiap orang membawa satu teman"]),
    p("Invite the first 10 people personally", "The first guests come easiest from a personal ask.", ["List the 10 people most likely to come", "Send a personal invite by DM or WhatsApp", "Ask each to bring one friend"])),
  recap: P("recap", "content", "image",
    p("Konten recap setelah event", "Event yang direkam jadi bahan promosi event berikutnya.", ["Siapkan orang yang merekam momen", "Posting highlight dalam 24 jam setelahnya", "Tag semua yang hadir"]),
    p("Post-event recap content", "A recorded event becomes promo for the next one.", ["Have someone capture the moments", "Post highlights within 24 hours", "Tag everyone who came"])),
};

const G = (id, short, en, plays) => ({ id, short, en, plays });

// What each group helps, and which plays (short label for the chips).
export const GROUPS = {
  followers: G("followers", "Followers", "Followers", ["collab", "giveaway"]),
  consistent: G("consistent", "Rutin posting", "Posting rhythm", ["batch", "series"]),
  shares: G("shares", "Shares", "Shares", ["relatable", "myth"]),
  saves: G("saves", "Saves", "Saves", ["checklist", "template"]),
  comments: G("comments", "Komentar", "Comments", ["question", "poll"]),
  engagement: G("engagement", "Engagement", "Engagement", ["winner", "hook"]),
  collabs: G("collabs", "Kolaborasi", "Collabs", ["collab", "guest"]),
  members: G("members", "Member", "Members", ["wagroup", "invitebio"]),
  active: G("active", "Member aktif", "Active members", ["ritual", "challenge"]),
  ugc: G("ugc", "Konten member", "Member content", ["ugcask", "spotlight"]),
  advocacy: G("advocacy", "Rekomendasi", "Word of mouth", ["testi", "referral"]),
  meet: G("meet", "Event komunitas", "Community event", ["meetup", "liveqa"]),
  sold: G("sold", "Penjualan", "Sales", ["flash", "bundle"]),
  inquiries: G("inquiries", "Calon pembeli", "Leads", ["askdm", "faq"]),
  proof: G("proof", "Testimoni", "Testimonials", ["testisales", "testi"]),
  repeat: G("repeat", "Beli lagi", "Repeat buyers", ["reorder", "referral"]),
  offer: G("offer", "Penawaran", "Offer", ["offer", "flash"]),
  event: G("event", "Event", "Event", ["countdown", "presale", "invite10", "recap"]),
};

// milestone key → group, per kind. Anything unlisted falls back to the kind's
// first group (followers / members / sold).
const KEY_GROUP = {
  social: { followers: "followers", published: "consistent", streak: "consistent", cadence: "consistent", shares: "shares", saves: "saves", comments: "comments", er: "engagement", dm: "comments", collabs: "collabs" },
  community: { members: "members", activeMembers: "active", activity: "active", ritual: "active", ritualPlan: "active", memberLed: "active", subInitiatives: "active", ugc: "ugc", crossPost: "ugc", advocates: "advocacy", testimonials: "advocacy", referred: "advocacy", events: "meet" },
  sales: { sold: "sold", revenue: "sold", inquiries: "inquiries", leads: "inquiries", testimonials: "proof", repeat: "repeat", referrals: "repeat", offer: "offer" },
};
const KIND_DEFAULT = { social: "followers", community: "members", sales: "sold", event: "event", other: "followers" };

export const groupOfKey = (kind, key) => (kind === "event" ? "event" : KEY_GROUP[kind]?.[key] || KIND_DEFAULT[kind] || "followers");

const pick = (o) => (getLang() === "en" ? o.en : o.id);

// A play in the current language: { id, type, icon, title, why, steps }
export function playView(play) {
  if (!play) return null;
  const v = pick(play);
  return { id: play.k, type: play.ty, icon: play.ic, title: v.t, why: v.w, steps: v.s };
}

export const findPlay = (id) => playView(PLAYS[id]);
export const groupLabel = (id) => (GROUPS[id] ? (getLang() === "en" ? GROUPS[id].en : GROUPS[id].short) : "");
export const playsOfGroup = (id) => (GROUPS[id]?.plays || []).map((k) => playView(PLAYS[k])).filter(Boolean);

// The targets the owner can still push, as groups (one chip each, in the order
// the level lists them, required ones first). `readings` = readStage().readings.
export function openGroups(kind, readings = []) {
  if (kind === "event") return [{ group: "event", reading: null }];
  const seen = new Set();
  const out = [];
  const open = readings.filter((r) => !r.milestone.notApplicable && !r.milestone.delegatedTo && !r.met);
  [...open.filter((r) => r.milestone.required !== false), ...open.filter((r) => r.milestone.required === false)].forEach((r) => {
    const g = groupOfKey(kind, r.milestone.key);
    if (seen.has(g)) return;
    seen.add(g);
    out.push({ group: g, reading: r });
  });
  if (!out.length) out.push({ group: KIND_DEFAULT[kind] || "followers", reading: null });
  return out;
}

// "Ide lain": the target's own plays first, then the other plays of the same
// kind of goal, deduped, shown a page at a time (page = the group's own count).
export function playsPage(kind, group, round = 0) {
  const own = GROUPS[group]?.plays || [];
  const ids = [...own];
  if (kind !== "event") Object.values(KEY_GROUP[kind] || {}).forEach((g) => (GROUPS[g]?.plays || []).forEach((k) => { if (!ids.includes(k)) ids.push(k); }));
  const size = Math.max(2, own.length);
  const pages = Math.max(1, Math.ceil(ids.length / size));
  const start = (((round % pages) + pages) % pages) * size;
  const ring = [...ids, ...ids];
  return { plays: ring.slice(start, start + Math.min(size, ids.length)).map((k) => playView(PLAYS[k])).filter(Boolean), pages };
}

export const PLAY_IDS = Object.keys(PLAYS);

// One plain sentence per target: what the owner actually DOES to move it
// (shown in the tree's card). Anything not listed falls back to the target's
// own description.
const DO = {
  social: {
    followers: ["Ajak orang baru lewat collab, giveaway, dan konten yang gampang dibagikan. Perbarui angkanya di Insights tiap minggu.", "Bring new people in with collabs, giveaways and shareable posts. Update the number in Insights every week."],
    published: ["Upload sesuai jadwalmu. Cukup terbitkan kontennya; Brandlab menghitungnya sendiri.", "Post on your schedule. Just publish; Brandlab counts it for you."],
    streak: ["Upload minimal sekali tiap minggu, jangan sampai ada minggu kosong.", "Post at least once every week, with no empty weeks."],
    cadence: ["Upload di hari-hari yang sudah kamu atur di Jadwal Kerja.", "Post on the days you set in your work schedule."],
    shares: ["Bikin konten yang orang ingin kirim ke temannya, lalu ajak mereka share di kalimat terakhir.", "Make posts people want to send to a friend, and ask for the share at the end."],
    saves: ["Bikin konten yang berguna dipakai nanti: checklist, langkah-langkah, atau template. Ajak orang menyimpannya.", "Make posts worth keeping: checklists, steps or templates. Ask people to save them."],
    comments: ["Akhiri konten dengan pertanyaan mudah dan balas tiap komentar di jam pertama.", "End posts with an easy question and reply to every comment in the first hour."],
    er: ["Bikin ulang konten yang paling disukai audiensmu dengan sudut baru dan hook yang lebih kuat.", "Remake what your audience liked most, with a new angle and a sharper hook."],
    dm: ["Ajak orang kirim DM di akhir konten, lalu balas dengan ramah dan cepat.", "Invite people to DM you at the end of posts, then reply kindly and fast."],
    collabs: ["Ajak akun yang audiensnya mirip untuk collab post atau live bareng, lalu catat hasilnya.", "Invite an account with a similar audience for a collab post or live, then log it."],
  },
  community: {
    members: ["Buka satu tempat kumpul (grup atau channel), ajak pelanggan terdekat dulu, lalu taruh ajakan di bio dan caption.", "Open one place to gather (group or channel), invite closest customers first, then put the invite in your bio and captions."],
    activeMembers: ["Bikin ritual mingguan dan challenge kecil supaya member punya alasan balik tiap minggu.", "Run a weekly ritual and small challenges so members have a reason to come back."],
    ugc: ["Minta member membagikan hasil pakai dan tag akunmu, lalu repost dan ucapkan terima kasih.", "Ask members to share how they use it and tag you, then repost with thanks."],
    advocates: ["Beri alasan dan bonus kecil bagi member yang mengajak temannya.", "Give members a reason and a small bonus for bringing a friend."],
    testimonials: ["Tanya 3 pertanyaan singkat ke member yang puas, minta izin, lalu posting jadi konten.", "Ask happy members 3 short questions, get permission, then post it."],
    referred: ["Beri bonus sederhana bagi member yang mengajak teman, dan catat siapa mengajak siapa.", "Give a simple bonus for bringing a friend and note who brought whom."],
    crossPost: ["Pilih kiriman terbaik dari member, minta izin, lalu posting di akun utamamu dan tag orangnya.", "Pick the best member posts, ask permission, then post them on your main account and tag them."],
    memberLed: ["Beri member kesempatan memimpin satu kegiatan, misalnya sesi berbagi atau challenge, dan kamu cukup mendampingi.", "Let a member lead one activity, like a sharing session or challenge, while you just support."],
    subInitiatives: ["Dukung member yang mau bikin sub-grup atau kegiatan sendiri: kasih ruang, bantuan kecil, dan sorotan.", "Back members who want their own sub-group or activity: give space, small help and a spotlight."],
    events: ["Adakan kumpul kecil (online atau offline) sekitar 1 jam, lalu jadikan recap konten.", "Hold a small meetup (online or offline) of about 1 hour, then turn it into a recap post."],
  },
  sales: {
    product: ["Jalankan promo dengan batas waktu atau paket bundling untuk produk ini, dan umumkan di konten dan Story.", "Run a time-limited promo or a bundle for this product and announce it in posts and Stories."],
    sold: ["Jalankan promo dengan batas waktu atau paket bundling, dan umumkan di konten dan Story.", "Run a time-limited promo or a bundle and announce it in posts and Stories."],
    inquiries: ["Taruh ajakan tanya di tiap konten dan jawab pertanyaan yang sering muncul lewat konten.", "Put an ask-us line in every post and answer common questions as content."],
    testimonials: ["Minta foto atau ulasan satu kalimat dari pembeli yang puas, lalu tampilkan.", "Ask happy buyers for a photo or one-line review, then show them."],
    repeat: ["Hubungi pembeli 2–4 minggu setelah beli dengan penawaran beli lagi.", "Message buyers 2–4 weeks after purchase with a re-order offer."],
    referrals: ["Beri bonus kecil bagi pembeli yang mengajak teman, dan catat siapa mengajak siapa.", "Give buyers a small bonus for bringing a friend and note who brought whom."],
    offer: ["Tulis harga, cara order, dan bukti dalam satu halaman, lalu taruh di bio atau Highlight.", "Write price, how to order and proof on one page, then put it in your bio or a Highlight."],
  },
};

export function whatToDo(kind, key) {
  const row = DO[kind]?.[key];
  return row ? row[getLang() === "en" ? 1 : 0] : "";
}
