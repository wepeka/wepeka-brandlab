// Copy Studio's vocabulary: what can be written (formats) and why (goals).
// Shared by the page (character limits, which fields to ask for) and ai.js
// (the writing rules each choice adds to the prompt), so adding a format or
// a goal happens in one place. Plain data with no imports, so ai.js stays
// free of store/DOM dependencies.
//
// Everything the user reads (labels, descriptions, the spec strip, field
// labels and placeholders) lives in js/i18n/creator-copy.js under
// copy.format.<key>.* / copy.goal.<key>.* / copy.lengthOpt.* / copy.rewrite.*
// / copy.known.*, so it follows the UI language — add those keys too when
// adding an entry here. `label` stays in this file only because ai.js puts
// it into the prompt.
//
// Every format carries the same three things so the model can't collapse
// them into one generic caption: what the text physically IS on that
// platform, its exact shape + hard limit, and a NEVER list of the habits
// that belong to the other formats. The user-facing summary of the same
// facts is the copy.format.<key>.spec1–3 keys.
// Platform numbers (verified Sep 2026): Threads 500 chars/post; Instagram
// caption 2,200 chars, cut after ~125 with "… lainnya"; TikTok caption
// 4,000 chars, ~2 lines shown; Instagram bio 150; TikTok bio 80; X 280.

const ONE_PIECE = "Write exactly ONE piece: `parts` has exactly 1 item.";

// Appended to every format so the shape is decided by the format, never by
// the goal or by the marketing principles in the system prompt.
const FORMAT_CONTRAST =
  "The format decides the SHAPE, the goal decides the CONTENT. Each format is a different product: a Threads post is not a feed caption (no hashtag block, no 'link di bio'), a Story line is not a post (no paragraphs, no call-to-action sentence), a WhatsApp broadcast is not a feed caption (no hashtags, no 'follow'). Match the shape and NEVER list above before anything else.";

export const COPY_FORMATS = [
  {
    key: "threads",
    label: "Threads",
    icon: "chat",
    limit: 500,
    limitLabel: "per post",
    rules: [
      "Platform: Threads (Meta). This is NOT a caption under a photo: the text IS the post. Write it the way a real person types a thought on their phone: one observation, opinion, small story, or question, in first person.",
      "Shape: a single punchy line, or 1–4 short paragraphs separated by blank lines. Line 1 must stand alone in the feed as the hook: a claim, a confession, a specific detail, or a question. Never a greeting and never the product name alone.",
      "Hard limit: 500 characters per post, counting spaces and emoji.",
      "NEVER: opening greetings ('Halo', 'Hai Kak', 'Hi guys'); a hashtag block (at most ONE topic tag, only if it reads naturally); *bold* or _italic_ markup (Threads shows the asterisks literally); 'link di bio'; hard-sell closers with exclamation marks ('Yuk order sekarang!!!').",
      "If there is a call to action, it is one quiet line at the end: a question for replies, 'balas di bawah', or a plain link exactly as given in the input.",
      "Emoji: zero to two, never as bullet points.",
    ],
  },
  {
    key: "story",
    label: "Caption Story",
    icon: "image",
    limit: 120,
    limitLabel: "total",
    rules: [
      "Instagram/Facebook Story text overlay: the words sit ON TOP of a photo or video and are read in about two seconds while the viewer's thumb hovers on the screen. It is a headline, not a message.",
      "Shape: 1–2 short lines, about 120 characters in total. Fragments are fine ('Baru sangrai pagi ini.'); paragraphs and full explanations are not. Line 1 carries the whole point; line 2 (optional) adds the twist or the one detail.",
      "NEVER: a greeting; hashtags; a URL or 'link di bio' inside the text (the link is a sticker); *bold* markup; a call-to-action sentence ('Yuk order', 'DM sekarang'). The call to action lives in the sticker, not in the text.",
      "One emoji at most.",
      "In `note`, suggest exactly ONE interactive sticker that fits the goal, written in Indonesian, using a sticker type that actually exists on Instagram: polling (2–4 options), kuis, kotak pertanyaan, slider emoji, link, countdown (for events), or lokasi. Format: 'Stiker polling: Udah pernah coba? — Udah / Belum' or 'Stiker link: Order di sini'.",
    ],
  },
  {
    key: "wa",
    label: "Broadcast WhatsApp",
    icon: "send",
    limit: 700,
    limitLabel: "total",
    rules: [
      "WhatsApp broadcast: a private chat message that lands in the phone of an existing customer who saved the business's number. They already know the business, so talk to them directly, one to one.",
      "Shape, in this order with a blank line between blocks: (1) one short, friendly greeting that works for everyone, e.g. 'Halo Kak 👋', no name placeholders like {nama}; (2) 1–3 short paragraphs with the actual news or offer; (3) ONE call to action that says exactly how to reply or order ('balas chat ini', or the number/link given in the input); (4) one polite opt-out line, e.g. 'Balas STOP kalau nggak mau dapat info lagi ya, Kak.'",
      "Formatting: WhatsApp's own markup only. *bold* for exactly the one thing they must not miss (the offer, date, or price); _italic_ rarely; emoji may serve as bullet points.",
      "About 700 characters at most.",
      "NEVER: hashtags; 'link di bio'; 'follow kami'; 'swipe up'; anything written for a public feed. Never a URL or phone number that isn't in the input.",
    ],
  },
  {
    key: "feed",
    label: "Caption feed",
    icon: "grid",
    limit: 2200,
    limitLabel: "total",
    previewChars: 125,
    rules: [
      "Instagram/TikTok feed caption: it goes UNDER a photo, carousel, or video. The visual carries the content; the caption adds the hook, the context, and the next step.",
      "Instagram cuts the caption after about 125 characters with '… lainnya', so line 1 must be a complete hook inside those first 125 characters. Hard limit: 2,200 characters (Instagram). TikTok allows 4,000 but shows only about two lines before 'lihat selengkapnya', so the same rule applies.",
      "Shape: hook line → blank line → 1–4 short paragraphs → ONE call to action (simpan, bagikan, komen, DM, or 'link di bio') → blank line → 3–8 relevant hashtags on the last line, mixing broad and niche, no spaces inside a tag.",
      "NEVER: *bold* or _italic_ markup (Instagram shows the asterisks literally); a URL in the caption (captions can't hold clickable links; say 'link di bio'); hashtags in the middle of sentences; a greeting as the first line; a WhatsApp-style opt-out line.",
    ],
  },
  {
    key: "other",
    label: "Lainnya",
    icon: "edit",
    limit: 0,
    limitLabel: "",
    rules: [],
  },
];

// Formats people type into "Lainnya" that have a real, checkable limit.
// Matched by keyword on the user's own wording; anything else gets the
// generic "follow that format's conventions" rule and no counter.
export const KNOWN_CUSTOM_FORMATS = [
  { key: "tiktokBio", match: /\bbio\b.*\btiktok\b|\btiktok\b.*\bbio\b/i, label: "Bio TikTok", limit: 80, rule: "TikTok bio: hard limit 80 characters. One line that says what the account is for, plus at most one call to action. No hashtags." },
  { key: "igBio", match: /\bbio\b/i, label: "Bio Instagram", limit: 150, rule: "Instagram bio: hard limit 150 characters. Line breaks are allowed; 2–4 short lines: what the business is, who it's for, and one call to action pointing at the link button. No hashtags unless they're the brand's own tag." },
  { key: "x", match: /\b(x|twitter|tweet)\b/i, label: "Post X", limit: 280, rule: "X (Twitter) post: hard limit 280 characters. One idea, first line is the hook, at most one hashtag, no markup." },
];

export const COPY_GOALS = [
  {
    key: "testimoni",
    label: "Testimoni",
    icon: "heart",
    messageOptional: true,
    fields: [
      { key: "quote", label: "Testimoni aslinya", aiLabel: "Customer's exact words (quote verbatim, never alter)", type: "textarea", required: true },
      { key: "customer", label: "Nama atau inisial pelanggan", aiLabel: "Customer name/initial", type: "input" },
      { key: "product", label: "Produk/layanan yang dipakai", aiLabel: "Product/service used", type: "input" },
    ],
    rules: [
      "Goal: social proof from a REAL customer testimonial.",
      "The customer's words are given below. Quote them VERBATIM inside quotation marks. You may shorten with '…', but never change, add, or improve a word.",
      "Attribute the quote only to the name or initial given. If none is given, say 'salah satu pelanggan kami'. Never invent a name.",
      "Never add other testimonials, ratings, customer counts, or results beyond what the customer said.",
      "The customer is the hero; the brand is the guide that helped.",
    ],
  },
  {
    key: "promo",
    label: "Promo / jualan",
    icon: "target",
    fields: [
      { key: "product", label: "Produk/layanan", aiLabel: "Product/service", type: "input", required: true },
      { key: "price", label: "Harga atau promonya", aiLabel: "Price/offer", type: "input" },
      { key: "period", label: "Periode promo", aiLabel: "Offer period", type: "input" },
      { key: "howToOrder", label: "Cara order", aiLabel: "How to order", type: "input" },
    ],
    rules: [
      "Goal: get a purchase or inquiry now.",
      "Lead with what the customer gets, not the product spec. Make the offer and the next step impossible to miss.",
      "Use only the price, discount, deadline and ordering method given. If one isn't given, don't mention it at all.",
      "No urgency or scarcity ('stok tinggal 3!') unless the input states it.",
    ],
  },
  {
    key: "edukasi",
    label: "Edukasi / tips",
    icon: "book",
    fields: [],
    rules: [
      "Goal: give genuinely useful, specific value (tips, how-to, myth vs fact) that people want to save or share.",
      "Teach first. Mention the brand lightly at the end, if at all.",
    ],
  },
  {
    key: "cerita",
    label: "Cerita / behind the scene",
    icon: "users",
    fields: [],
    rules: [
      "Goal: make people feel close to the people and process behind the brand.",
      "Tell it as a small story with one concrete moment or detail. Honest, not bragging.",
    ],
  },
  {
    key: "event",
    label: "Pengumuman / event",
    icon: "calendar",
    fields: [
      { key: "when", label: "Kapan", aiLabel: "When", type: "input" },
      { key: "where", label: "Di mana", aiLabel: "Where", type: "input" },
      { key: "howToJoin", label: "Cara ikut atau daftar", aiLabel: "How to join", type: "input" },
    ],
    rules: [
      "Goal: announce it clearly so people remember what, when, where, and how to join.",
      "Put the essential details where they can't be missed. Use only the details given.",
    ],
  },
  {
    key: "interaksi",
    label: "Ajak interaksi",
    icon: "comment",
    fields: [],
    rules: [
      "Goal: start a conversation: replies, votes, or comments.",
      "End with one easy question most of the audience can answer in a few words.",
    ],
  },
];

export const COPY_LENGTHS = [
  { key: "short", label: "Pendek", rule: "Keep it as short as the format allows." },
  { key: "medium", label: "Sedang", rule: "Medium length for the format." },
  { key: "long", label: "Panjang", rule: "Use the fuller end of the format's length, without padding." },
];

export const COPY_REWRITES = [
  { key: "shorter", label: "Pendekin", rule: "Make it noticeably shorter and punchier. Keep the same key message, facts, and call to action." },
  { key: "casual", label: "Lebih santai", rule: "Make it more casual and conversational, like chatting with a friend, still in the brand's voice." },
  { key: "salesy", label: "Lebih jualan", rule: "Make it more persuasive toward taking action: a sharper benefit and a clearer call to action. Never add discounts, prices, deadlines, scarcity, or claims that aren't already in the text." },
];

export const formatByKey = (key) => COPY_FORMATS.find((f) => f.key === key) || null;
export const goalByKey = (key) => COPY_GOALS.find((g) => g.key === key) || null;
export const knownCustomFormat = (customFormat = "") => KNOWN_CUSTOM_FORMATS.find((k) => k.match.test(customFormat)) || null;

// Character budget for the counter in the results: { limit, perPart }.
// perPart is true for Threads (each post has its own 500), false when the
// whole text shares one limit. limit 0 means "no counter".
export function formatLimit(formatKey, customFormat = "") {
  if (formatKey === "other") return { limit: knownCustomFormat(customFormat)?.limit || 0, perPart: false };
  const f = formatByKey(formatKey);
  return { limit: f?.limit || 0, perPart: formatKey === "threads" };
}

export function copyFormatRules(formatKey, { threadMode = "single", customFormat = "" } = {}) {
  if (formatKey === "other") {
    const known = knownCustomFormat(customFormat);
    return [
      `Format requested by the user: "${customFormat || "general marketing copy"}". Follow that format's usual length and conventions.`,
      known ? known.rule : "",
      "NEVER add habits from other formats that the user didn't ask for: no hashtag block, no WhatsApp opt-out line, no greeting, no *bold* markup unless the format is known to render it.",
      ONE_PIECE,
    ].filter(Boolean);
  }
  const rules = formatByKey(formatKey)?.rules || [];
  if (formatKey === "threads" && threadMode === "chain") {
    return [
      ...rules,
      "Write a thread of 3–7 posts: `parts` has one item per post, each under 500 characters. Start each post with its number, like '1/5'. Post 1 is the hook and promises what the thread delivers; each middle post carries ONE idea; the last post closes with the one quiet call to action. Never write '(lanjut di bawah)' or 'thread 🧵' filler.",
      FORMAT_CONTRAST,
    ];
  }
  return [...rules, FORMAT_CONTRAST, ONE_PIECE];
}

export function missingRequired(goalKey, details = {}) {
  return (goalByKey(goalKey)?.fields || []).filter((f) => f.required && !(details[f.key] || "").trim());
}
