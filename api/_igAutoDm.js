// Instagram comment → DM, our own (no ManyChat): someone comments "Branding",
// "Brandlab" or "mau dong" on a @winkhsin post → a public reply under the comment + a DM with one
// button → tapping it sends the pitch and the /founder link. Runs on the
// official Instagram API with Instagram Login (graph.instagram.com), fed by
// api/instagram/webhook.js. Off (every call a silent no-op) until the env
// vars below are set in Vercel. It answers comments on ONE account (the
// Meta app "wepeka" also holds wepeka.id and pinter.mandarin): @winkhsin
// unless IG_AUTODM_ACCOUNT_ID says otherwise.
//   IG_APP_SECRET     Meta app → Instagram → API setup → "Instagram app secret"
//                     (checks every webhook really came from Meta)
//   IG_ACCESS_TOKEN   the long-lived token generated for @wepeka there. It
//                     lives 60 days; the daily cron refreshes it into
//                     igAutoDm/token, which wins over the env value after that.
// Optional: IG_AUTODM_KEYWORDS (comma list, replaces DEFAULT_KEYWORDS), IG_VERIFY_TOKEN (the
// webhook's handshake word, not a secret — the app secret guards every POST),
// META_GRAPH_VERSION.
// Everything else here is pure and takes its Firestore/fetch from the caller
// (tests/ig-auto-dm.test.mjs).
import crypto from "crypto";

const GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "").trim() || "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

// @winkhsin's Instagram account id (Meta app "wepeka" → Instagram → API setup).
export const WINKHSIN_ACCOUNT_ID = "17841400566996586";
export const DEFAULT_VERIFY_TOKEN = "wepeka-branding";

export function autoDmAccountId(env = process.env) {
  return String(env.IG_AUTODM_ACCOUNT_ID || "").trim() || WINKHSIN_ACCOUNT_ID;
}

export const LINK = "https://brandlab.wepeka.com/founder?utm_source=instagram&utm_medium=dm&utm_campaign=komen_branding";
export const LINK_PAYLOAD = "IGDM_LINK";
// A second comment from the same person within this window gets no new DM
// (still fine to answer it in public — but not "cek DM" when none was sent).
export const DM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Two taps on the button (or the button + typing "branding") send the link once.
export const LINK_COOLDOWN_MS = 10 * 60 * 1000;
// A typed "mau dong" counts as the button only this long after message 1.
export const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Instagram only takes a refresh once the token is a day old; weekly is plenty
// for a 60-day token.
export const TOKEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

// Instagram's limits: button title 20 characters, button-template text 640,
// a plain text message 1000.
export const COPY = {
  publicReplies: [
    "Udah aku kirim ke DM ya kak 📩",
    "Cek inbox kak, linknya udah meluncur 🚀",
    "Siap kak, cek DM ya 👀",
  ],
  opener: "Hai kak! 👋 Ini ya, tools yang tadi kakak tanyain, namanya Wepeka BrandLab ✨\n\nPernah nggak sih kak, ngerasa ngurus brand tuh banyak banget yang harus dipikirin? 🤯 Mulai dari strategi, konten, marketing, evaluasi performa, sampai bingung next step-nya apa 🤔\n\nNah, what if semuanya bisa dikelola dalam satu tempat, bahkan ada sistem yang bisa kasih saran apa yang harus kakak lakukan selanjutnya berdasarkan data dan kondisi brand kakak sendiri? 📊💡\n\nPlus bisa kerja bareng tim, siapa ngerjain apa langsung kepantau 🤝\n\nYes, Wepeka BrandLab bakal temenin dan bantu perjalanan brand kakak! 🚀\nMau aku kasih linknya kah kak? 😆",
  openerButton: "Mau dong 👀",
  pitch: [
    "🔥 ‼️ Special Offer - FOUNDER'S LIFETIME ACCESS ‼️ 🔥",
    "Sekarang masih ada kesempatan join dengan slot terbatas. Cukup sekali bayar Rp599.000 dan bisa pakai BrandLab seumur hidup!",
    "Kalau dibagi setahun, jatuhnya cuma sekitar Rp1.641 per hari. Bayangin, punya sistem dan AI consultant pribadi untuk bantu manage dan grow brand setiap hari dengan biaya segitu. 😭",
    "",
    "Selain itu, kakak juga dapat:",
    "• Weekly Founder's Session: Sharing, evaluasi penggunaan BrandLab, diskusi bareng founder lain, sampai cari solusi untuk permasalahan bisnis bersama.",
    "• Continuous Development: Fitur dan kemampuan BrandLab akan terus dikembangkan supaya makin lengkap dan bermanfaat.",
    "",
    "Yuk kak, join sekarang sebelum slot Founder's Lifetime habis. Kita grow bareng-bareng! 🚀❤️",
  ].join("\n"),
  linkText: "Amankan slot Founder's Lifetime kakak di sini 👇",
  linkButton: "Join sekarang 🚀",
};

// What a comment (or a short DM) must say. Any case: "Brandlab", "BRANDLAB".
export const DEFAULT_KEYWORDS = ["branding", "brandlab", "brand lab", "mau dong"];
// Typed instead of tapping "Mau dong 👀" — only for someone who got message 1
// (REPLY_WINDOW_MS), so "mau dong" in an ordinary chat stays Winson's.
export const REPLY_KEYWORDS = ["mau dong", "mau"];
// A DM longer than this is a real conversation, never answered by the bot.
const DM_MAX_WORDS = 4;

export function keywords(env = process.env) {
  const list = String(env.IG_AUTODM_KEYWORDS || "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_KEYWORDS;
}

const words = (text) => String(text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The first keyword the text contains as whole word(s): "Branding!!",
// "#brandlab", "Mau dong kak" — but not "rebranding" or "brandingnya".
export function matchKeyword(text, list = keywords()) {
  const padded = ` ${words(text).join(" ")} `;
  return list.find((k) => padded.includes(` ${words(k).join(" ")} `)) || null;
}
export const hasKeyword = (text, list = keywords()) => matchKeyword(text, list) !== null;

// A short DM ("Brandlab", "mau dong kak 🙏") → { keyword, reply } or null.
// Longer DMs are real conversations and stay Winson's.
export function dmTrigger(text, list = keywords()) {
  if (words(text).length > DM_MAX_WORDS) return null;
  const reply = matchKeyword(text, REPLY_KEYWORDS);
  if (reply) return { keyword: reply, reply: true };
  const keyword = matchKeyword(text, list);
  return keyword ? { keyword, reply: false } : null;
}

export function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The things a webhook payload asks of us, in order:
//   { kind: "comment", accountId, commentId, fromId, username, text }
//   { kind: "wantsLink", accountId, senderId, via }  (button tap / keyword DM)
// Our own comments and DMs (echoes) are never in it.
export function readEvents(payload, list = keywords(), onlyAccount = autoDmAccountId()) {
  const out = [];
  if (payload?.object !== "instagram") return out;
  for (const entry of payload.entry || []) {
    const accountId = String(entry.id || "");
    if (onlyAccount && accountId !== onlyAccount) continue;
    for (const change of entry.changes || []) {
      if (change.field !== "comments") continue;
      const v = change.value || {};
      const fromId = String(v.from?.id || "");
      if (!v.id || !fromId || fromId === accountId) continue;
      if (!hasKeyword(v.text, list)) continue;
      out.push({ kind: "comment", accountId, commentId: String(v.id), fromId, username: v.from?.username || "", text: v.text || "" });
    }
    for (const m of entry.messaging || []) {
      const senderId = String(m.sender?.id || "");
      if (!senderId || senderId === accountId || m.message?.is_echo) continue;
      if (m.postback?.payload === LINK_PAYLOAD) out.push({ kind: "wantsLink", accountId, senderId, via: "button" });
      else if (m.message?.quick_reply?.payload === LINK_PAYLOAD) out.push({ kind: "wantsLink", accountId, senderId, via: "button" });
      else if (m.message?.text) {
        const hit = dmTrigger(m.message.text, list);
        if (hit) out.push({ kind: "wantsLink", accountId, senderId, via: hit.reply ? "reply" : "dm" });
      }
    }
  }
  return out;
}

const buttonTemplate = (text, button) => ({
  attachment: { type: "template", payload: { template_type: "button", text, buttons: [button] } },
});

export function openerMessage() {
  return buttonTemplate(COPY.opener, { type: "postback", title: COPY.openerButton, payload: LINK_PAYLOAD });
}
// When Instagram refuses the button (private replies are picky): the whole
// thing in one text, link included.
export function openerFallback() {
  return { text: `${COPY.opener.replace(/\n[^\n]*$/, "")}\n\nCek detailnya di sini 👇\n${LINK}` };
}
export function linkMessage() {
  return buttonTemplate(COPY.linkText, { type: "web_url", url: LINK, title: COPY.linkButton });
}
export function publicReply(commentId) {
  let n = 0;
  for (const ch of String(commentId)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return COPY.publicReplies[n % COPY.publicReplies.length];
}

// graph(path, body) → parsed JSON; throws with Instagram's error message.
export function graphClient(token, fetchImpl = fetch) {
  return async (path, body) => {
    const res = await fetchImpl(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const err = new Error(data.error?.message || `Instagram ${res.status}`);
      err.code = data.error?.code;
      throw err;
    }
    return data;
  };
}

// deps: { graph, claimComment(id, data) → bool, person(id) → doc|null,
//         savePerson(id, patch), now }
export async function handleEvents(events, deps) {
  const results = [];
  for (const ev of events) {
    try {
      results.push(ev.kind === "comment" ? await onComment(ev, deps) : await onWantsLink(ev, deps));
    } catch (err) {
      console.error("[ig-auto-dm]", ev.kind, err?.message);
      results.push({ kind: ev.kind, error: err?.message || String(err) });
    }
  }
  return results;
}

async function onComment(ev, { graph, claimComment, person, savePerson, now = Date.now() }) {
  // Meta repeats a webhook it thinks we missed; one comment = one DM, ever.
  if (!(await claimComment(ev.commentId, { fromId: ev.fromId, username: ev.username, text: ev.text.slice(0, 300), at: now }))) {
    return { kind: "comment", skipped: "duplicate" };
  }
  const known = await person(ev.fromId);
  if (known?.dmAt && now - known.dmAt < DM_COOLDOWN_MS) return { kind: "comment", skipped: "recent" };

  let sent = "button";
  try {
    await graph("me/messages", { recipient: { comment_id: ev.commentId }, message: openerMessage() });
  } catch (err) {
    console.warn("[ig-auto-dm] button DM refused, sending text:", err?.message);
    // A private reply is one message per comment, but a refused one never
    // counted.
    await graph("me/messages", { recipient: { comment_id: ev.commentId }, message: openerFallback() });
    sent = "text";
  }
  await savePerson(ev.fromId, { username: ev.username, dmAt: now, lastCommentId: ev.commentId, ...(sent === "text" ? { linkAt: now } : {}) });
  // Only after the DM really went out — "cek DM" with nothing in it is worse
  // than silence. A failed public reply doesn't undo the DM.
  try {
    await graph(`${ev.commentId}/replies`, { message: publicReply(ev.commentId) });
  } catch (err) {
    console.warn("[ig-auto-dm] public reply failed:", err?.message);
  }
  return { kind: "comment", sent };
}

async function onWantsLink(ev, { graph, person, savePerson, now = Date.now() }) {
  const known = await person(ev.senderId);
  if (ev.via === "reply" && !(known?.dmAt && now - known.dmAt < REPLY_WINDOW_MS)) return { kind: "wantsLink", skipped: "no-opener" };
  if (known?.linkAt && now - known.linkAt < LINK_COOLDOWN_MS) return { kind: "wantsLink", skipped: "recent" };
  await graph("me/messages", { recipient: { id: ev.senderId }, message: { text: COPY.pitch } });
  try {
    await graph("me/messages", { recipient: { id: ev.senderId }, message: linkMessage() });
  } catch (err) {
    console.warn("[ig-auto-dm] link button refused, sending text:", err?.message);
    await graph("me/messages", { recipient: { id: ev.senderId }, message: { text: `${COPY.linkText}\n${LINK}` } });
  }
  await savePerson(ev.senderId, { linkAt: now, linkVia: ev.via });
  return { kind: "wantsLink", sent: true };
}

// ---- the token -------------------------------------------------------------

export async function currentToken(db, env = process.env) {
  const snap = await db.doc("igAutoDm/token").get();
  return (snap.exists && snap.data().value) || String(env.IG_ACCESS_TOKEN || "").trim() || null;
}

// Daily cron: swaps the token for a fresh 60-day one once a week. Never throws.
export async function refreshToken(db, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const snap = await db.doc("igAutoDm/token").get();
    const saved = snap.exists ? snap.data() : {};
    const token = saved.value || String(env.IG_ACCESS_TOKEN || "").trim();
    if (!token) return "off";
    if (saved.refreshedAt && now - saved.refreshedAt < TOKEN_REFRESH_MS) return "fresh";
    const res = await fetchImpl(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      console.error("[ig-auto-dm] token refresh failed:", data.error?.message || res.status);
      return "failed";
    }
    await db.doc("igAutoDm/token").set({ value: data.access_token, refreshedAt: now, expiresAt: now + (Number(data.expires_in) || 0) * 1000 });
    return "refreshed";
  } catch (err) {
    console.error("[ig-auto-dm] token refresh failed:", err?.message);
    return "failed";
  }
}
