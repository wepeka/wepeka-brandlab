// "Cara mencapainya" — My Goals' answer to "terus aku harus ngapain?".
// A target on its own ("Shares 160") says WHAT; a play says HOW: one concrete
// marketing move (a collab, a 48-hour promo, a countdown) with three plain
// steps. The owner picks one and either saves it (kept as a goal idea, see
// store.js addBrandIdea + playId) or runs it (its steps become the goal's
// to-do, js/goal-actions.js addGoalTask). Nothing is made until they tap.
//
// Plays are fixed advice in both languages, each resting on a principle from
// a known marketing book (BOOKS), grouped by the target they help (GROUPS). A play's `ty` = what it is: a piece of content, a campaign (a
// small run of steps), or an event.
import { getLang } from "./i18n.js";

// Every play rests on a named principle from a well-known marketing book
// (owner, 2026-10-30: "berkaca ke buku2 marketing ternama … jadi reasoning
// dll nya ada basisnya"). `b` = [book, principle id, principle en] — kept
// here as the play's source, NOT shown on the card (owner, same day:
// "gausah dikasi dasar teorinya"); the play's "why" is that principle
// applied in plain words. Ideas only — no wording copied from the books.
export const BOOKS = {
  influence: { t: "Influence", a: "Robert Cialdini" },
  storybrand: { t: "Building a StoryBrand", a: "Donald Miller" },
  mms: { t: "Marketing Made Simple", a: "Donald Miller" },
  thisis: { t: "This Is Marketing", a: "Seth Godin" },
  purplecow: { t: "Purple Cow", a: "Seth Godin" },
  contagious: { t: "Contagious", a: "Jonah Berger" },
  stick: { t: "Made to Stick", a: "Chip & Dan Heath" },
  hooked: { t: "Hooked", a: "Nir Eyal" },
  offers: { t: "$100M Offers", a: "Alex Hormozi" },
  brandsgrow: { t: "How Brands Grow", a: "Byron Sharp" },
  showwork: { t: "Show Your Work!", a: "Austin Kleon" },
  jab: { t: "Jab, Jab, Jab, Right Hook", a: "Gary Vaynerchuk" },
  ogilvy: { t: "Ogilvy on Advertising", a: "David Ogilvy" },
  momtest: { t: "The Mom Test", a: "Rob Fitzpatrick" },
  irrational: { t: "Predictably Irrational", a: "Dan Ariely" },
  theyask: { t: "They Ask, You Answer", a: "Marcus Sheridan" },
  gettogether: { t: "Get Together", a: "Bailey Richardson, Kevin Huynh & Kai Elmer Sotto" },
  gathering: { t: "The Art of Gathering", a: "Priya Parker" },
  tinyhabits: { t: "Tiny Habits", a: "BJ Fogg" },
};

const P = (k, ty, ic, id, en, b) => ({ k, ty, ic, id, en, b });
const p = (t, w, s) => ({ t, w, s });
const B = (src, id, en) => ({ src, id, en });

const PLAYS = {
  // ---- Sosmed Growth
  collab: P("collab", "campaign", "users",
    p("Collab post sama akun sejenis", "Akun tumbuh terutama dari orang yang belum kenal kamu. Collab menaruhmu langsung di depan audiens baru yang mirip pembelimu.", ["Pilih 3 akun seukuran kamu dengan audiens yang mirip", "DM tawarkan collab post atau live bareng", "Posting bareng, lalu balas semua komentar di 24 jam pertama"]),
    p("Collab post with a similar account", "Accounts grow mostly from people who don't know you yet. A collab puts you straight in front of a new audience that looks like your buyers.", ["Pick 3 accounts your size with a similar audience", "DM them a collab post or a joint live", "Post together, then answer every comment in the first 24 hours"]),
    [B("brandsgrow", "Jangkau orang baru", "Reach new buyers"), B("influence", "Kesukaan (liking)", "Liking")]),
  giveaway: P("giveaway", "campaign", "megaphone",
    p("Giveaway mini 7 hari", "Memberi duluan bikin orang ingin membalas. Hadiahnya harus cuma menarik buat calon pembelimu, supaya yang datang bukan pemburu gratisan.", ["Tentukan hadiah yang cuma menarik buat calon pembelimu", "Posting aturan: follow, share ke Story, tag 2 teman", "Umumkan pemenang lewat Reels dan minta pemenang repost"]),
    p("7-day mini giveaway", "Giving first makes people want to give back. The prize must only appeal to your future buyers, so you don't pull in freebie hunters.", ["Pick a prize only your future buyers would want", "Post the rules: follow, share to Story, tag 2 friends", "Announce the winner in a Reel and ask them to repost"]),
    [B("influence", "Timbal balik (reciprocity)", "Reciprocity"), B("thisis", "Audiens terkecil yang tepat", "Smallest viable audience")]),
  niche: P("niche", "content", "target",
    p("Konten buat satu jenis orang saja", "Konten untuk semua orang tidak terasa untuk siapa-siapa. Pilih satu kelompok kecil yang jelas, layani mereka sampai mereka merasa \"ini aku banget\".", ["Tulis satu kalimat: konten ini buat siapa (mis. \"ibu kerja yang masak 15 menit\")", "Bikin 3 konten yang cuma nyambung buat orang itu", "Lihat siapa yang komentar, lalu bikin lagi buat mereka"]),
    p("Content for one kind of person only", "Content for everyone feels like it's for no one. Pick one small, clear group and serve them until they think \"that's so me\".", ["Write one line: who this is for (e.g. \"working moms who cook in 15 minutes\")", "Make 3 posts that only click for that person", "See who comments, then make more for them"]),
    [B("thisis", "Audiens terkecil yang tepat", "Smallest viable audience")]),
  jab: P("jab", "campaign", "heart",
    p("Kasih dulu 3 kali, baru jualan", "Audiens mau mendengar tawaranmu setelah kamu berkali-kali membantu mereka tanpa minta apa-apa.", ["Rencanakan 3 konten yang murni membantu (tips, jawaban, hiburan)", "Konten ke-4 baru ajakan beli atau follow", "Ulangi pola ini dan bandingkan hasilnya"]),
    p("Give three times, then sell", "People listen to your offer after you've helped them again and again without asking.", ["Plan 3 posts that purely help (tips, answers, fun)", "Only the 4th post asks to buy or follow", "Repeat the pattern and compare the results"]),
    [B("jab", "Beri nilai sebelum meminta", "Give value before you ask"), B("influence", "Timbal balik (reciprocity)", "Reciprocity")]),
  batch: P("batch", "campaign", "calendar",
    p("Hari produksi sekali seminggu", "Kebiasaan bertahan kalau dibikin gampang dan punya pemicu tetap. Satu hari rekam banyak membuat posting rutin tidak lagi berat.", ["Tentukan satu hari tetap tiap minggu (itu pemicunya)", "Rekam 3–4 konten sekaligus dari daftar ide", "Jadwalkan upload di hari-hari berbeda, ulangi tiap minggu"]),
    p("One production day a week", "A habit lasts when it's easy and has a fixed prompt. Shooting a lot in one day takes the weight out of posting regularly.", ["Pick one fixed day each week (that's your prompt)", "Shoot 3–4 pieces in one go from your idea list", "Schedule uploads on different days, repeat every week"]),
    [B("tinyhabits", "Perilaku = motivasi + kemampuan + pemicu", "Behaviour = motivation + ability + prompt")]),
  series: P("series", "content", "refresh",
    p("Bikin satu seri mingguan", "Format yang sama tiap minggu jadi ciri yang dikenali sekilas, dan audiens mulai menunggu harinya.", ["Pilih satu topik seri (mis. \"Tips 60 detik\")", "Tentukan hari tayang tetap dan tampilan pembuka yang sama", "Bikin 3 episode pertama sebelum tayang"]),
    p("Start one weekly series", "The same format every week becomes something people recognise at a glance, and they start waiting for the day.", ["Pick a series topic (e.g. \"60-second tips\")", "Choose a fixed air day and the same opening look", "Make the first 3 episodes before you launch"]),
    [B("brandsgrow", "Aset khas brand (distinctive assets)", "Distinctive brand assets"), B("hooked", "Pemicu → kebiasaan", "Triggers → habit")]),
  distinct: P("distinct", "campaign", "palette",
    p("Pakai ciri khas yang sama terus", "Orang mengenali brand dari ciri yang konsisten: warna, kalimat pembuka, suara, gaya foto. Makin konsisten, makin cepat diingat.", ["Pilih 2–3 ciri: warna, kalimat pembuka, atau gaya visual", "Pakai di setiap konten selama sebulan tanpa ganti", "Tanya 3 follower: apa yang mereka ingat dari kontenmu"]),
    p("Keep the same signature elements", "People recognise a brand by consistent cues: colour, opening line, sound, photo style. The more consistent, the faster you're remembered.", ["Pick 2–3 cues: colour, opening line or visual style", "Use them in every post for a month without changing", "Ask 3 followers what they remember about your posts"]),
    [B("brandsgrow", "Aset khas brand (distinctive assets)", "Distinctive brand assets")]),
  showwork: P("showwork", "content", "image",
    p("Tunjukkan proses di balik layar", "Orang tertarik pada prosesnya, bukan cuma hasil jadi. Berbagi sedikit setiap hari bikin kamu dikenal tanpa harus selalu punya konten besar.", ["Rekam satu momen kerja tiap hari (bahan, salah, percobaan)", "Posting singkat dengan satu kalimat yang kamu pelajari", "Kumpulkan seminggu jadi satu konten rangkuman"]),
    p("Show the work behind the scenes", "People are drawn to the process, not just the finished thing. Sharing a little every day gets you known without needing big posts.", ["Capture one work moment a day (materials, mistakes, tries)", "Post it short with one line you learned", "Gather the week into one recap post"]),
    [B("showwork", "Bagikan proses, bukan cuma hasil", "Share the process, not just the result")]),
  relatable: P("relatable", "content", "send",
    p("Konten \"kirim ke temanmu yang…\"", "Orang membagikan hal yang membuat mereka terlihat baik atau mewakili diri mereka di depan teman.", ["Tulis 5 situasi yang sering dialami pelangganmu", "Bikin satu konten: \"Kirim ini ke temanmu yang suka…\"", "Tutup dengan ajakan share di kalimat terakhir"]),
    p("\"Send this to a friend who…\" content", "People share what makes them look good or speaks for them in front of friends.", ["Write 5 situations your customers live through", "Make one piece: \"Send this to the friend who…\"", "End with a clear ask to share"]),
    [B("contagious", "Mata uang sosial (social currency)", "Social currency")]),
  myth: P("myth", "content", "layers",
    p("Carousel mitos vs fakta", "Pesan yang melawan dugaan bikin orang berhenti dan ingin tahu kenapa. Kejutan itulah yang diteruskan ke orang lain.", ["Kumpulkan 3 mitos di bidangmu", "Bikin carousel: mitos → fakta + alasannya", "Ajak audiens kirim ke orang yang masih percaya mitos itu"]),
    p("Myth vs fact carousel", "A message that breaks expectations makes people stop and want to know why. That surprise is what gets passed on.", ["Collect 3 myths in your field", "Make a carousel: myth → fact + the reason", "Ask people to send it to someone who still believes it"]),
    [B("stick", "Tak terduga (unexpected)", "Unexpected")]),
  story: P("story", "content", "book",
    p("Cerita pelanggan, produk nyelip di dalamnya", "Orang meneruskan cerita, bukan iklan. Kalau produkmu bagian penting dari ceritanya, ia ikut terbawa setiap kali ceritanya dibagikan.", ["Pilih satu pelanggan dengan masalah yang jelas", "Ceritakan: masalahnya → titik balik → hasilnya", "Pastikan produkmu jadi kunci titik baliknya, bukan tempelan"]),
    p("A customer story with your product inside", "People pass on stories, not ads. If your product is a key part of the story, it travels every time the story is shared.", ["Pick one customer with a clear problem", "Tell it: the problem → the turning point → the result", "Make your product the key to the turning point, not an add-on"]),
    [B("contagious", "Cerita (stories)", "Stories"), B("storybrand", "Pelanggan = tokoh utama", "The customer is the hero")]),
  emotion: P("emotion", "content", "flame",
    p("Konten yang bikin kagum atau ketawa", "Emosi yang membangkitkan (kagum, seru, lucu) bikin orang bergerak dan membagikan. Emosi yang melemaskan, seperti sedih, jarang dibagikan.", ["Pilih satu momen di bidangmu yang bikin orang \"wah\" atau ketawa", "Tunjukkan dalam 3 detik pertama, jangan disimpan di akhir", "Tutup dengan ajakan tag teman yang perlu lihat"]),
    p("Content that amazes or makes people laugh", "High-energy emotions (awe, excitement, amusement) get people to act and share. Low-energy ones like sadness rarely get shared.", ["Pick one moment in your field that makes people go \"wow\" or laugh", "Show it in the first 3 seconds, don't save it for the end", "End by asking them to tag a friend who needs to see it"]),
    [B("contagious", "Emosi yang membangkitkan", "High-arousal emotion")]),
  checklist: P("checklist", "content", "check",
    p("Carousel checklist langkah-langkah", "Informasi yang benar-benar berguna disimpan dan dibagikan, karena orang senang menolong orang lain.", ["Pilih satu masalah pelangganmu", "Susun 5–7 langkah jelas, satu per slide", "Slide terakhir: \"Simpan buat nanti\""]),
    p("Step-by-step checklist carousel", "Truly useful information gets saved and shared, because people like helping others.", ["Pick one problem your customer has", "Write 5–7 clear steps, one per slide", "Last slide: \"Save for later\""]),
    [B("contagious", "Nilai praktis (practical value)", "Practical value")]),
  template: P("template", "content", "bookmark",
    p("Bagikan contoh / template siap pakai", "Hadiah yang langsung bisa dipakai membuat orang merasa berutang baik, dan disimpan karena berguna.", ["Pilih yang kamu pakai sendiri (template, daftar, resep)", "Tampilkan hasil jadi + cara pakainya", "Ajak simpan supaya tidak lupa"]),
    p("Share a ready-to-use example or template", "A gift people can use right away leaves goodwill behind, and gets saved because it's useful.", ["Pick something you use yourself (template, list, recipe)", "Show the finished result and how to use it", "Ask people to save it so they don't forget"]),
    [B("contagious", "Nilai praktis (practical value)", "Practical value"), B("influence", "Timbal balik (reciprocity)", "Reciprocity")]),
  question: P("question", "campaign", "chat",
    p("Tanya pendapat di tiap konten", "Makin mudah aksinya, makin banyak yang ikut. Orang yang sudah \"menanam\" sedikit (satu komentar) lebih mungkin balik lagi.", ["Akhiri 3 konten ke depan dengan pertanyaan pilihan (A atau B?)", "Balas setiap komentar dalam 1 jam pertama", "Angkat jawaban terbaik jadi konten berikutnya"]),
    p("Ask for opinions in every post", "The easier the action, the more people join. People who've put in a little (one comment) are more likely to come back.", ["End your next 3 posts with an either/or question", "Answer every comment within the first hour", "Turn the best answer into your next post"]),
    [B("hooked", "Aksi mudah + investasi kecil", "Easy action + small investment")]),
  poll: P("poll", "campaign", "chart",
    p("Polling Story dua kali seminggu", "Polling itu aksi paling ringan, dan pemicu yang datang di hari tetap membuat orang terbiasa ikut.", ["Buat polling 2 pilihan yang ringan", "Tayangkan Senin dan Kamis", "Bahas hasilnya di konten atau Story berikutnya"]),
    p("Story poll twice a week", "A poll is the lightest action there is, and a prompt on fixed days gets people used to joining.", ["Make an easy 2-option poll", "Run it Monday and Thursday", "Talk about the result in your next post or Story"]),
    [B("hooked", "Pemicu + aksi paling mudah", "Trigger + easiest action")]),
  winner: P("winner", "content", "flame",
    p("Ulangi konten yang paling jalan", "Jangan menebak apa yang disukai audiens: uji, lihat datanya, lalu ulangi yang terbukti menang.", ["Buka Hasil: lihat 3 konten dengan engagement tertinggi", "Cari kesamaan: hook, format, topik", "Bikin 2 versi baru dengan pola yang sama"]),
    p("Remake your best-performing content", "Don't guess what your audience likes: test, read the data, then repeat what has proven to win.", ["Open Results: find your 3 highest-engagement posts", "Spot what they share: hook, format, topic", "Make 2 new versions with the same pattern"]),
    [B("ogilvy", "Uji terus, ulangi yang menang", "Keep testing, repeat the winners")]),
  hook: P("hook", "content", "bulb",
    p("Perkuat 3 detik pertama", "Jauh lebih banyak orang membaca judul daripada isinya. Di video, 3 detik pertama adalah judulnya: kalau gagal di sini, isinya tidak ditonton.", ["Tulis 5 hook berbeda untuk satu topik", "Pakai yang paling bikin penasaran atau menyebut manfaat jelas", "Cek hasilnya setelah 48 jam"]),
    p("Sharpen the first 3 seconds", "Far more people read the headline than the body. In video the first 3 seconds are the headline: lose them there and the rest goes unseen.", ["Write 5 different hooks for one topic", "Use the most curious one or the one with a clear benefit", "Check how it did after 48 hours"]),
    [B("ogilvy", "Judul menentukan dibaca atau tidak", "The headline decides if it's read"), B("stick", "Tak terduga (unexpected)", "Unexpected")]),
  remarkable: P("remarkable", "campaign", "sparkle",
    p("Bikin satu hal yang layak dibicarakan", "Yang biasa-biasa saja tidak terlihat. Orang membicarakan hal yang beda dan pantas diceritakan ulang.", ["Tulis apa yang semua pesaingmu lakukan dengan cara yang sama", "Pilih satu hal yang bisa kamu lakukan beda (kemasan, layanan, cara bicara)", "Jalankan dan jadikan konten cerita di baliknya"]),
    p("Do one thing worth talking about", "The ordinary is invisible. People talk about what's different and worth retelling.", ["List what all your competitors do the same way", "Pick one thing you can do differently (packaging, service, voice)", "Do it and post the story behind it"]),
    [B("purplecow", "Jadi luar biasa (remarkable)", "Be remarkable")]),
  guest: P("guest", "campaign", "mic",
    p("Jadi tamu / undang tamu", "Orang lebih percaya pada yang dianggap ahli dan pada orang yang sudah mereka sukai. Tampil bersama tamu meminjam keduanya.", ["Daftar 3 orang yang dipercaya audiensmu", "Ajak ngobrol 15 menit (live atau rekaman)", "Potong jadi 2–3 konten dan tag keduanya"]),
    p("Be a guest / invite a guest", "People trust those seen as experts and those they already like. Appearing with a guest borrows both.", ["List 3 people your audience trusts", "Have a 15-minute chat (live or recorded)", "Cut it into 2–3 posts and tag each other"]),
    [B("influence", "Otoritas (authority)", "Authority"), B("brandsgrow", "Jangkau orang baru", "Reach new buyers")]),

  // ---- Community
  wagroup: P("wagroup", "campaign", "chat",
    p("Buka grup / channel khusus", "Komunitas tumbuh dari orang yang sudah dekat, bukan dari platformnya. Mulai dari segelintir orang yang paling peduli.", ["Pilih satu tempat kumpul (WA Community, Discord, dst)", "Tulis aturan singkat + alasan orang harus gabung", "Ajak 10 pelanggan terdekat dulu, lalu umumkan di konten"]),
    p("Open a group / channel", "Communities grow from people who are already close, not from the platform. Start with the few who care most.", ["Pick one place (WA Community, Discord, etc.)", "Write short rules and why people should join", "Invite your 10 closest customers first, then announce it in a post"]),
    [B("gettogether", "Mulai dari orangnya", "Start with your people")]),
  invitebio: P("invitebio", "campaign", "link",
    p("Ajakan gabung di tiap konten", "Orang bergabung dengan kelompok yang sesuai jati dirinya: \"orang seperti kita melakukan hal seperti ini\". Sebut jelas siapa yang cocok.", ["Taruh link gabung di bio", "Tambah satu kalimat ajakan yang menyebut siapa yang cocok gabung", "Sebut keuntungan yang cuma didapat member"]),
    p("A join invite in every post", "People join groups that fit who they are: \"people like us do things like this\". Say clearly who belongs.", ["Put the join link in your bio", "Add one invite line naming who belongs", "Name what only members get"]),
    [B("thisis", "\"Orang seperti kita\"", "\"People like us\"")]),
  unity: P("unity", "campaign", "users",
    p("Bikin rasa \"kita\" di komunitas", "Orang paling mudah bilang ya pada kelompok yang mereka anggap bagian dari dirinya. Nama, istilah, dan kebiasaan bersama membentuk rasa \"kita\".", ["Beri nama untuk member (mis. \"Teman Kopi\")", "Pakai 2–3 istilah atau salam yang cuma dipahami member", "Ajak member ikut menentukan satu hal (nama produk, tema bulan depan)"]),
    p("Build a sense of \"us\"", "People say yes most easily to a group they feel part of. A name, shared words and habits build that \"us\".", ["Give members a name (e.g. \"Coffee Friends\")", "Use 2–3 words or greetings only members understand", "Let members decide one thing (a product name, next month's theme)"]),
    [B("influence", "Kesatuan (unity)", "Unity")]),
  ritual: P("ritual", "campaign", "refresh",
    p("Ritual mingguan", "Kebiasaan terbentuk dari putaran yang berulang: pemicu tetap → ikut → dapat sesuatu → makin terikat. Lakukan bersama, jangan cuma mengumumkan.", ["Tentukan satu kegiatan (tanya jawab, tips, challenge kecil)", "Pilih hari & jam tetap", "Mention member yang aktif supaya mereka merasa dilihat"]),
    p("Weekly ritual", "Habits form from a repeating loop: fixed prompt → join in → get something → feel more attached. Do it together, don't just announce.", ["Pick one activity (Q&A, tip, small challenge)", "Fix a day and time", "Mention active members so they feel seen"]),
    [B("hooked", "Putaran kebiasaan (hook model)", "The hook model"), B("gettogether", "Lakukan bersama", "Do things together")]),
  challenge: P("challenge", "campaign", "flag",
    p("Challenge 7 hari", "Komitmen kecil yang diucapkan di depan orang lain membuat orang ingin konsisten dengannya sampai selesai.", ["Bikin tantangan yang bisa dikerjakan 5 menit per hari", "Minta member menulis \"aku ikut\" di grup sebelum mulai", "Member setor hasil tiap hari; beri apresiasi dan rekap di hari ke-7"]),
    p("7-day challenge", "A small commitment said in front of others makes people want to stay consistent with it to the end.", ["Make a task that takes 5 minutes a day", "Ask members to write \"I'm in\" in the group before it starts", "Members post daily; give thanks and a recap on day 7"]),
    [B("influence", "Komitmen & konsistensi", "Commitment & consistency")]),
  roles: P("roles", "campaign", "flag",
    p("Kasih peran ke member paling aktif", "Komunitas bertahan kalau member ikut memiliki, bukan cuma menonton. Peran kecil membuat mereka ikut menjaga.", ["Pilih 2–3 member yang paling sering aktif", "Tawarkan peran: penyambut member baru, host sesi, pengumpul pertanyaan", "Sebut peran mereka di depan grup dan beri terima kasih tiap bulan"]),
    p("Give your most active members a role", "A community lasts when members share ownership instead of watching. A small role makes them help look after it.", ["Pick the 2–3 most active members", "Offer a role: welcomer, session host, question collector", "Name their role in front of the group and thank them monthly"]),
    [B("gettogether", "Bagi kepemilikan", "Share ownership")]),
  ugcask: P("ugcask", "campaign", "image",
    p("Minta member share hasil pakai", "Kalau ragu, orang melihat apa yang dilakukan orang lain yang mirip dirinya. Konten member yang terlihat publik adalah bukti itu.", ["Siapkan hashtag atau stiker khusus", "Ajak member posting dan tag akunmu", "Repost tiap kiriman dan ucapkan terima kasih"]),
    p("Ask members to share how they use it", "When unsure, people look at what others like them do. Member posts in public are that proof.", ["Prepare a hashtag or sticker", "Ask members to post and tag you", "Repost every entry and say thanks"]),
    [B("influence", "Bukti sosial (social proof)", "Social proof"), B("contagious", "Terlihat publik (public)", "Public")]),
  spotlight: P("spotlight", "content", "sparkle",
    p("Member of the week", "Orang peduli pada posisinya di kelompok. Diakui di depan member lain menaikkan status mereka, dan memberi kamu cerita nyata untuk diposting.", ["Pilih satu member tiap minggu", "Ceritakan kisahnya di Story atau feed", "Minta ia mengajak satu teman"]),
    p("Member of the week", "People care about their place in a group. Being recognised in front of others raises their status and gives you a real story to post.", ["Pick one member each week", "Tell their story in Story or the feed", "Ask them to bring one friend"]),
    [B("thisis", "Status di dalam kelompok", "Status in the group")]),
  testi: P("testi", "content", "heart",
    p("Kumpulkan testimoni", "Kata orang lain yang mirip calon pembeli lebih meyakinkan daripada kata kamu sendiri.", ["Kirim 3 pertanyaan singkat ke pelanggan yang puas: sebelum, sesudah, untuk siapa", "Rapikan jawabannya dan minta izin menampilkan", "Posting sebagai carousel \"kata mereka\""]),
    p("Collect testimonials", "Words from people like your buyers persuade more than your own.", ["Send 3 short questions to happy customers: before, after, who it's for", "Tidy the answers and ask permission to post", "Post as a \"what they say\" carousel"]),
    [B("influence", "Bukti sosial (social proof)", "Social proof")]),
  referral: P("referral", "campaign", "megaphone",
    p("Ajak teman, dapat bonus", "Kita lebih mudah bilang ya pada orang yang kita kenal dan sukai. Rekomendasi teman melewati keraguan yang tidak bisa dilewati iklan.", ["Tentukan bonus sederhana untuk yang mengajak dan yang diajak", "Kabari pelanggan lewat grup atau DM", "Catat siapa yang mengajak siapa"]),
    p("Bring a friend, get a bonus", "We say yes more easily to people we know and like. A friend's word gets past doubts an ad can't.", ["Pick a simple bonus for both the referrer and the friend", "Tell customers in the group or by DM", "Note who brought whom"]),
    [B("influence", "Kesukaan (liking)", "Liking")]),
  meetup: P("meetup", "event", "calendar",
    p("Kumpul kecil online / offline", "Pertemuan yang berkesan punya satu tujuan yang spesifik, bukan sekadar \"kumpul-kumpul\". Tujuan yang jelas menentukan siapa diundang dan apa yang terjadi.", ["Tulis satu tujuan spesifik (mis. \"saling tukar resep andalan\")", "Buka pendaftaran lewat grup, cukup 1 jam", "Rekam momennya, jadikan konten recap"]),
    p("Small online / offline meetup", "A memorable gathering has one specific purpose, not just \"hanging out\". A clear purpose decides who's invited and what happens.", ["Write one specific purpose (e.g. \"swap our best recipes\")", "Open sign-ups in your group, 1 hour is enough", "Capture the moment and turn it into a recap post"]),
    [B("gathering", "Tujuan yang spesifik", "A specific purpose")]),
  liveqa: P("liveqa", "event", "play",
    p("Live tanya jawab bareng member", "Brand yang dipercaya berperan sebagai pemandu: menunjukkan bahwa ia paham masalah audiens (empati) dan tahu jalan keluarnya (otoritas).", ["Kumpulkan pertanyaan dari grup", "Live 30 menit: ulangi masalahnya dulu, baru jawab", "Simpan cuplikan terbaik jadi Reels"]),
    p("Live Q&A with members", "A trusted brand acts as a guide: it shows it understands the audience's problem (empathy) and knows the way out (authority).", ["Collect questions from the group", "Go live for 30 minutes: restate the problem first, then answer", "Save the best bits as a Reel"]),
    [B("storybrand", "Brand = pemandu (empati + otoritas)", "Brand as guide (empathy + authority)")]),

  // ---- Sales
  flash: P("flash", "campaign", "flame",
    p("Promo terbatas 48 jam", "Sesuatu terasa lebih berharga saat kesempatannya terbatas. Batasnya harus nyata: tutup tepat waktu, jangan diperpanjang.", ["Pilih satu produk + diskon atau bonus yang jelas", "Tayangkan hitung mundur di Story dan 2 konten", "Tutup tepat waktu dan umumkan hasilnya"]),
    p("48-hour limited promo", "Things feel more valuable when the chance is limited. The limit must be real: close on time, never extend.", ["Pick one product and a clear discount or bonus", "Show a countdown in Story and 2 posts", "Close on time and announce the result"]),
    [B("influence", "Kelangkaan (scarcity)", "Scarcity")]),
  bundle: P("bundle", "campaign", "layers",
    p("Paket bundling hemat", "Tawaran terasa \"gak masuk akal kalau ditolak\" saat nilainya jauh di atas harganya. Tumpuk manfaat dan bonus sampai harga terlihat kecil.", ["Gabungkan 2–3 produk jadi satu paket", "Tulis nilai tiap isi dan totalnya, lalu tampilkan harga paket", "Tawarkan ke yang pernah bertanya"]),
    p("Value bundle", "An offer feels \"silly to refuse\" when its value is far above its price. Stack benefits and bonuses until the price looks small.", ["Combine 2–3 products into one pack", "Show the value of each item and the total, then the pack price", "Offer it to people who asked before"]),
    [B("offers", "Persamaan nilai (value equation)", "The value equation")]),
  guarantee: P("guarantee", "campaign", "check",
    p("Kasih garansi yang berani", "Orang menunda beli karena takut rugi. Garansi memindahkan risiko dari pembeli ke kamu, jadi keyakinan mereka naik.", ["Tentukan garansi yang sanggup kamu tanggung (tukar, uang kembali, revisi)", "Tulis syaratnya singkat dan jelas", "Tampilkan di konten jualan dan di Highlight"]),
    p("Offer a bold guarantee", "People put off buying because they fear losing out. A guarantee moves the risk from the buyer to you, so their confidence goes up.", ["Pick a guarantee you can afford (exchange, refund, revision)", "Write the terms short and clear", "Show it in sales posts and in a Highlight"]),
    [B("offers", "Hilangkan risiko pembeli", "Reverse the buyer's risk")]),
  decoy: P("decoy", "campaign", "money",
    p("Tiga pilihan harga", "Orang menilai harga dengan membandingkan. Pilihan ketiga yang sengaja kurang menarik membuat pilihan utamamu terlihat paling masuk akal.", ["Susun 3 pilihan: kecil, utama, dan satu pembanding", "Bikin pembandingnya hanya sedikit lebih murah dari yang utama tapi isinya jauh lebih sedikit", "Tandai yang utama sebagai \"paling banyak dipilih\""]),
    p("Three price options", "People judge price by comparing. A third, deliberately weaker option makes your main one look the obvious choice.", ["Lay out 3 options: small, main, and a comparison", "Make the comparison only a bit cheaper than the main but with much less", "Mark the main one \"most chosen\""]),
    [B("irrational", "Efek umpan (decoy effect)", "The decoy effect")]),
  askdm: P("askdm", "campaign", "chat",
    p("Ajakan tanya di tiap konten", "Pelanggan tidak bergerak kalau tidak diajak dengan jelas. Satu ajakan langsung yang sama di setiap konten.", ["Tambah \"DM kata INFO untuk detail\" di akhir konten", "Siapkan template balasan yang cepat", "Catat siapa yang bertanya"]),
    p("An ask-us line in every post", "Customers don't move unless clearly asked. One direct call to action, the same in every post.", ["Add \"DM INFO for details\" at the end of posts", "Prepare a quick reply template", "Note who asked"]),
    [B("storybrand", "Ajakan bertindak yang jelas", "A clear call to action")]),
  faq: P("faq", "content", "help",
    p("Jawab pertanyaan pembeli secara terbuka", "Brand yang paling jujur menjawab pertanyaan pembeli (harga, kekurangan, perbandingan) jadi yang paling dipercaya.", ["Kumpulkan 5 pertanyaan yang paling sering masuk", "Jawab satu per konten pendek, termasuk yang tidak enak", "Simpan semuanya di Highlight"]),
    p("Answer buyers' questions openly", "The brand that answers buyers' questions most honestly (price, downsides, comparisons) becomes the most trusted.", ["Collect the 5 questions you get most", "Answer one per short post, the awkward ones too", "Keep them all in a Highlight"]),
    [B("theyask", "Jawab yang ditanyakan pembeli", "Answer what buyers ask")]),
  price: P("price", "content", "money",
    p("Konten \"berapa sih harganya, dan kenapa\"", "Harga adalah hal pertama yang ingin diketahui pembeli. Menjelaskan apa yang membuat harga naik-turun membangun kepercayaan sebelum mereka DM.", ["Sebut kisaran harga produkmu dengan jujur", "Jelaskan 3 hal yang membuat harganya segitu", "Tutup dengan \"cocok buat siapa\" dan ajakan tanya"]),
    p("\"What does it cost, and why\" content", "Price is the first thing buyers want to know. Explaining what drives it builds trust before they DM.", ["State your price range honestly", "Explain 3 things that make it cost that much", "End with who it suits and an invite to ask"]),
    [B("theyask", "Bicara soal harga terbuka", "Talk about price openly")]),
  leadgen: P("leadgen", "campaign", "download",
    p("Hadiah gratis untuk nomor WA", "Kebanyakan orang belum siap beli hari ini. Hadiah gratis yang berguna (panduan, checklist) membuka percakapan, lalu kamu rawat sampai mereka siap.", ["Bikin satu PDF atau checklist yang menyelesaikan masalah kecil", "Tawarkan gratis lewat konten: \"DM kata PANDUAN\"", "Kirim 3 pesan lanjutan dalam seminggu: tips, cerita, tawaran"]),
    p("A free resource for a WhatsApp number", "Most people aren't ready to buy today. A useful free resource (guide, checklist) opens the conversation, then you nurture until they're ready.", ["Make one PDF or checklist that solves a small problem", "Offer it free in a post: \"DM GUIDE\"", "Send 3 follow-up messages over a week: tip, story, offer"]),
    [B("mms", "Lead generator + pesan lanjutan", "Lead generator + follow-up")]),
  stakes: P("stakes", "content", "target",
    p("Tunjukkan apa yang dipertaruhkan", "Cerita yang menggerakkan menunjukkan dua hal: hidup pelanggan setelah masalahnya selesai, dan apa yang hilang kalau dibiarkan.", ["Tulis satu kalimat \"sesudah\": hidup pelanggan setelah pakai produkmu", "Tulis satu kalimat \"kalau dibiarkan\": ruginya, jujur dan tanpa menakut-nakuti", "Bikin satu konten yang memuat dua-duanya"]),
    p("Show what's at stake", "A story that moves people shows two things: the customer's life once the problem is solved, and what they lose if they leave it.", ["Write one \"after\" line: the customer's life after your product", "Write one \"if left alone\" line: the cost, honest and without scaring", "Make one post that holds both"]),
    [B("storybrand", "Sukses vs kegagalan", "Success vs failure")]),
  momtest: P("momtest", "campaign", "comment",
    p("Ngobrol dengan 5 pembeli, pakai kata-kata mereka", "Tanya tentang hidup dan kejadian nyata mereka, bukan pendapat soal produkmu. Kalimat asli pembeli adalah copy jualan terbaik.", ["Hubungi 5 pembeli terakhir", "Tanya: kapan terakhir mengalami masalah ini, apa yang sudah dicoba", "Pakai kalimat mereka persis di caption dan penawaranmu"]),
    p("Talk to 5 buyers, use their words", "Ask about their life and real past events, not opinions on your product. A buyer's own words are the best sales copy.", ["Reach out to your last 5 buyers", "Ask: when did this problem last happen, what have you tried", "Use their exact words in captions and your offer"]),
    [B("momtest", "Tanya kejadian nyata, bukan pendapat", "Ask about real events, not opinions")]),
  testisales: P("testisales", "content", "heart",
    p("Carousel \"kata pembeli\"", "Bukti paling kuat datang dari pembeli yang mirip calon pembeli: situasinya sama, keraguannya sama.", ["Pilih 5 pembeli yang mirip target pembelimu", "Minta foto atau ulasan satu kalimat tentang hasilnya", "Susun jadi carousel dan taruh di Highlight"]),
    p("\"What buyers say\" carousel", "The strongest proof comes from buyers like your prospects: same situation, same doubts.", ["Pick 5 buyers who look like your target buyer", "Ask for a photo or one-line review about the result", "Make a carousel and keep it in a Highlight"]),
    [B("influence", "Bukti sosial (social proof)", "Social proof")]),
  reorder: P("reorder", "campaign", "refresh",
    p("Hubungi pembeli lama", "Orang yang sudah pernah bilang ya cenderung tetap konsisten dengan pilihannya. Pesan pribadi yang tepat waktu cukup untuk mengingatkan.", ["Daftar pembeli 2–4 minggu terakhir", "Kirim pesan personal + penawaran beli lagi", "Catat siapa yang order ulang"]),
    p("Follow up past buyers", "People who've said yes once tend to stay consistent with that choice. A personal, well-timed message is enough of a reminder.", ["List buyers from the last 2–4 weeks", "Send a personal message + a re-order offer", "Note who orders again"]),
    [B("influence", "Komitmen & konsistensi", "Commitment & consistency")]),
  offer: P("offer", "content", "money",
    p("Tulis penawaran satu halaman", "Orang baru harus paham dalam 5 detik: kamu menawarkan apa, bikin hidupnya lebih baik bagaimana, dan cara belinya.", ["Tulis 3 baris: apa yang kamu jual, hasil untuk pembeli, cara order", "Taruh di bio atau Highlight", "Tes ke orang baru: paham dalam 5 detik?"]),
    p("Write a one-page offer", "A newcomer should get it in 5 seconds: what you offer, how it makes life better, and how to buy.", ["Write 3 lines: what you sell, the result for the buyer, how to order", "Put it in your bio or a Highlight", "Test on a newcomer: do they get it in 5 seconds?"]),
    [B("storybrand", "Lolos tes 5 detik (grunt test)", "Pass the grunt test")]),

  // ---- Event
  countdown: P("countdown", "content", "clock",
    p("Konten hitung mundur", "Kursi dan waktu yang makin sedikit terasa makin berharga. Pengingat harian juga jadi pemicu supaya event tidak terlupa.", ["Tentukan 5 hari tayang menjelang event", "Tiap hari satu teaser (lineup, tempat, sisa kursi)", "Hari-H: ajakan terakhir + link daftar"]),
    p("Countdown content", "Seats and time running out feel more valuable. A daily reminder also acts as a trigger so the event isn't forgotten.", ["Pick 5 posting days before the event", "One teaser a day (lineup, place, seats left)", "Event day: last call + sign-up link"]),
    [B("influence", "Kelangkaan (scarcity)", "Scarcity"), B("contagious", "Pemicu (triggers)", "Triggers")]),
  presale: P("presale", "campaign", "calendar",
    p("Presale / daftar awal", "Yang sudah mendaftar awal cenderung menepati pilihannya dan datang, bahkan ikut mengajak.", ["Beri harga atau bonus khusus pendaftar awal", "Buka 7–10 hari dan tutup di tanggal pasti", "Umumkan sisa kuota di Story"]),
    p("Presale / early sign-up", "People who sign up early tend to stick with that choice and show up, even bring others.", ["Give early sign-ups a special price or bonus", "Open for 7–10 days and close on a fixed date", "Announce remaining spots in Story"]),
    [B("influence", "Komitmen & konsistensi", "Commitment & consistency")]),
  invite10: P("invite10", "campaign", "users",
    p("Ajak 10 orang pertama langsung", "Ajakan pribadi dari orang yang dikenal jauh lebih kuat daripada poster. Mulai dari lingkaran terdekat.", ["Daftar 10 orang yang paling pasti datang", "Kirim ajakan personal lewat DM atau WA", "Minta tiap orang membawa satu teman"]),
    p("Invite the first 10 people personally", "A personal invite from someone you know is far stronger than a poster. Start with your closest circle.", ["List the 10 people most likely to come", "Send a personal invite by DM or WhatsApp", "Ask each to bring one friend"]),
    [B("influence", "Kesukaan (liking)", "Liking"), B("gettogether", "Mulai dari orangnya", "Start with your people")]),
  eventpurpose: P("eventpurpose", "campaign", "target",
    p("Satu tujuan event yang spesifik", "\"Biar rame\" bukan tujuan. Tujuan yang spesifik menentukan siapa yang diundang, acaranya apa, dan bikin orang tahu kenapa harus datang.", ["Tulis tujuan event dalam satu kalimat yang spesifik", "Coret bagian acara yang tidak mendukung tujuan itu", "Pakai kalimat tujuan itu di semua ajakan"]),
    p("One specific event purpose", "\"Get a crowd\" isn't a purpose. A specific one decides who's invited and what happens, and tells people why they should come.", ["Write the event's purpose in one specific sentence", "Cut parts of the programme that don't serve it", "Use that sentence in every invite"]),
    [B("gathering", "Tujuan yang spesifik", "A specific purpose")]),
  eventhero: P("eventhero", "content", "sparkle",
    p("Peserta jadi tokoh utama", "Promosi event yang kuat bercerita tentang perubahan peserta, bukan tentang penyelenggara.", ["Tulis: peserta datang dengan masalah apa", "Tulis: mereka pulang membawa apa", "Bikin konten ajakan dari sudut peserta, bukan \"kami mengadakan…\""]),
    p("Make attendees the hero", "Strong event promo tells the story of how attendees change, not of the organiser.", ["Write: what problem attendees come with", "Write: what they leave with", "Make the invite post from the attendee's side, not \"we are hosting…\""]),
    [B("storybrand", "Pelanggan = tokoh utama", "The customer is the hero")]),
  recap: P("recap", "content", "image",
    p("Konten recap setelah event", "Ramainya event yang terlihat adalah bukti untuk event berikutnya: orang ingin ikut apa yang sudah didatangi banyak orang.", ["Siapkan orang yang merekam momen", "Posting highlight dalam 24 jam setelahnya", "Tag semua yang hadir"]),
    p("Post-event recap content", "A visibly full event is proof for the next one: people want in on what others already showed up for.", ["Have someone capture the moments", "Post highlights within 24 hours", "Tag everyone who came"]),
    [B("influence", "Bukti sosial (social proof)", "Social proof"), B("contagious", "Terlihat publik (public)", "Public")]),
};

const G = (id, short, en, plays) => ({ id, short, en, plays });

// What each group helps, and which plays (short label for the chips).
export const GROUPS = {
  followers: G("followers", "Followers", "Followers", ["collab", "giveaway", "niche", "jab", "guest"]),
  consistent: G("consistent", "Rutin posting", "Posting rhythm", ["batch", "series", "distinct", "showwork"]),
  shares: G("shares", "Shares", "Shares", ["relatable", "myth", "story", "emotion"]),
  saves: G("saves", "Saves", "Saves", ["checklist", "template", "showwork"]),
  comments: G("comments", "Komentar", "Comments", ["question", "poll", "jab"]),
  engagement: G("engagement", "Engagement", "Engagement", ["winner", "hook", "emotion", "remarkable"]),
  collabs: G("collabs", "Kolaborasi", "Collabs", ["collab", "guest"]),
  members: G("members", "Member", "Members", ["wagroup", "invitebio", "unity"]),
  active: G("active", "Member aktif", "Active members", ["ritual", "challenge", "roles"]),
  ugc: G("ugc", "Konten member", "Member content", ["ugcask", "spotlight"]),
  advocacy: G("advocacy", "Rekomendasi", "Word of mouth", ["testi", "referral"]),
  meet: G("meet", "Event komunitas", "Community event", ["meetup", "liveqa"]),
  sold: G("sold", "Penjualan", "Sales", ["flash", "bundle", "guarantee", "decoy"]),
  inquiries: G("inquiries", "Calon pembeli", "Leads", ["askdm", "faq", "price", "leadgen"]),
  proof: G("proof", "Testimoni", "Testimonials", ["testisales", "testi"]),
  repeat: G("repeat", "Beli lagi", "Repeat buyers", ["reorder", "referral"]),
  offer: G("offer", "Penawaran", "Offer", ["offer", "stakes", "momtest", "guarantee"]),
  event: G("event", "Event", "Event", ["countdown", "presale", "invite10", "recap", "eventpurpose", "eventhero"]),
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

// Plays the AI wrote for this brand ("Bikin ide baru"): kept for the session so
// Jalankan / Simpan can find them by id like a fixed play. Saved ones keep
// their steps on the idea itself, so nothing here has to outlive a reload.
const MADE = new Map();
export function addMadePlays(list = []) {
  return list.map((m, n) => {
    const title = String(m.title || "").trim();
    const steps = (m.steps || []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3);
    if (!title || steps.length < 2) return null;
    let h = 0;
    for (const ch of title + steps.join("|")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const v = { id: `ai-${h.toString(36)}-${n}`, type: ["content", "campaign", "event"].includes(m.type) ? m.type : "campaign", icon: "sparkle", title, why: String(m.why || "").trim(), steps, made: true };
    MADE.set(v.id, v);
    return v;
  }).filter(Boolean);
}

export const findPlay = (id) => MADE.get(id) || playView(PLAYS[id]);
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
// kind of goal, deduped, shown a page at a time (2 cards; an Event shows 4).
export function playsPage(kind, group, round = 0) {
  const own = GROUPS[group]?.plays || [];
  const ids = [...own];
  if (kind !== "event") Object.values(KEY_GROUP[kind] || {}).forEach((g) => (GROUPS[g]?.plays || []).forEach((k) => { if (!ids.includes(k)) ids.push(k); }));
  const size = kind === "event" ? 4 : 2;
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
