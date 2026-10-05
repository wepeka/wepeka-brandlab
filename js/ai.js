// AI text generation — calls the server-side proxy at /api/ai (see that
// file) instead of a provider directly. The proxy holds the real API key
// (a Vercel env var, never Firestore, never the browser) and enforces the
// account's quota server-side; this file just builds prompts and reads
// results, the same job it always did.
import { TONE_AXES, toneAxisLabel, toneExampleMessage, VISUAL_DIRECTIONS } from "./brandbook-data.js";
import { COPY_LENGTHS, COPY_REWRITES, copyFormatRules, formatByKey, goalByKey } from "./knowledge/copy-formats.js";
import { aiLimitReached, aiDailyLimit, aiQuotaPeriod } from "./ai-usage.js";
import { auth } from "./firebase.js";
import { t, getLang } from "./i18n.js";
import { isAdmin, currentUid } from "./account.js";
import { brandVoiceText, listBrandIdeas } from "./store.js";
import { HOOK_TYPES, hookTypeByKey, structureByKey } from "./knowledge/hook-types.js";
import { renderScript } from "./script-format.js";

class AiApiError extends Error {}

// Every "out of AI credits" refusal, whichever feature hit it, also tells
// the shell — js/ai-topup.js answers with the top-up / upgrade notice.
function quotaOutError(key, detail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai:quota-out", { detail }));
  return new AiApiError(t(key, { limit: detail.limit }));
}

// Provider/setup failures. The Wepeka admin sees the real detail (which
// provider, the status code, the provider's own message) to fix it;
// everyone else gets the same problem in plain words — a customer can't see
// the AI proxy's config (that lives in Vercel env vars) and "Error dari
// DeepSeek" means nothing to someone who only knows this app as Brandlab.
function aiSetupError(key, vars = {}) {
  return new AiApiError(isAdmin(currentUid()) ? t(key, vars) : t(`${key}.user`, vars));
}

// Server error code (api/ai.js's { error, message } body, or an SSE
// `{"error":...}` event) -> a UI-language AiApiError. Reuses the existing
// provider/network/badResponse/noVision keys (aiSetupError already branches
// admin vs. plain-language) — "session"/"deactivated" are the two genuinely
// new cases a client-side key setup could never hit before.
function proxyError(code, extra = {}) {
  switch (code) {
    case "quota": {
      const { limit, period } = extra;
      const key = limit === 0 ? "ai.error.readonly" : period === "month" ? "ai.error.quotaMonth" : period === "total" ? "ai.error.quotaTotal" : "ai.error.quota";
      return quotaOutError(key, { limit, period });
    }
    case "auth":
    case "account":
      return new AiApiError(t("ai.error.session"));
    case "deactivated":
      return new AiApiError(t("ai.error.deactivated"));
    case "readonly":
      return new AiApiError(t("ai.error.readonly"));
    case "too-large":
      return new AiApiError(t("ai.error.tooLarge"));
    case "images":
      return new AiApiError(t("ai.error.tooManyImages"));
    case "noVision":
      return aiSetupError("ai.error.noVision", { provider: "AI" });
    case "badResponse":
      return aiSetupError("ai.error.badResponse", { provider: "AI" });
    case "network":
      return aiSetupError("ai.error.network", { provider: "AI" });
    case "setup":
      return aiSetupError("ai.error.setup", { key: extra.message || "API key" });
    case "noServer":
      return new AiApiError(t("ai.error.noServer"));
    case "provider":
    default:
      // No detail from the server → the plain message, never a bare "AI error:".
      return extra.message ? aiSetupError("ai.error.provider", { provider: "AI", message: extra.message }) : new AiApiError(t("ai.error.provider.user"));
  }
}

// The one HTTP call every AI feature in this file ends up making: POSTs to
// /api/ai with a fresh Firebase ID token, and either returns the finished
// text (non-stream) or feeds `onText(fullTextSoFar)` as SSE chunks arrive
// (stream) — same onText(text, {whole}) contract callModel always offered
// its callers, so nothing downstream of callModel had to change. A stream
// that stops before the end also calls onText(fullText, { cut: true }).
async function callProxy(system, userPrompt, maxTokens, { temperature, json = false, images = [], stream = false, countUsage = true, feature = "", history = [] } = {}, onText = null) {
  let token;
  try {
    token = await auth.currentUser?.getIdToken();
  } catch {
    token = null;
  }
  if (!token) throw proxyError("auth");

  const ctrl = new AbortController();
  const timeoutMs = stream ? 130000 : 65000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ system, user: userPrompt, maxTokens, temperature, json, stream, images, countUsage, feature, ...(history.length ? { history } : {}) }),
      signal: ctrl.signal,
    });
  } catch {
    throw proxyError("network");
  } finally {
    clearTimeout(timer);
  }
  if ([404, 405, 501].includes(res.status)) throw proxyError("noServer");

  if (!stream) {
    let body;
    try {
      body = await res.json();
    } catch {
      throw proxyError("badResponse");
    }
    if (!res.ok || body?.error) throw proxyError(body?.error || "network", body || {});
    if (onText && body.text) onText(body.text, { whole: true });
    return body.text || "";
  }

  if (!res.ok || !res.body) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // The stream already started (headers sent) — no JSON body to read.
    }
    throw proxyError(body?.error || "network", body || {});
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let streamErr = null;
  // A complete answer ends with the server's "[DONE]" and no error event.
  // Anything else (an error mid-answer, the connection dropping, the idle
  // timeout below) is a cut-off reply: its text is still returned, as it
  // always was, but onText hears once more with { cut: true } so a chat
  // can say so and offer "Coba lagi" instead of passing it off as finished.
  let sawDone = false;
  let broke = false;
  // The fetch timeout above only covers the headers; a stream that goes
  // silent mid-answer would otherwise hang the caller forever.
  const STREAM_IDLE_MS = 45000;
  const readWithIdleTimeout = () => new Promise((resolve, reject) => {
    const idle = setTimeout(() => { reader.cancel().catch(() => {}); reject(proxyError("network")); }, STREAM_IDLE_MS);
    reader.read().then((r) => { clearTimeout(idle); resolve(r); }, (e) => { clearTimeout(idle); reject(e); });
  });
  for (;;) {
    let chunk;
    try { chunk = await readWithIdleTimeout(); } catch (e) { if (full) { broke = true; break; } throw e instanceof AiApiError ? e : proxyError("network"); }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") { sawDone = true; continue; }
      let ev;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }
      if (ev.error) { streamErr = ev; continue; }
      if (typeof ev.delta === "string" && ev.delta) {
        full += ev.delta;
        onText?.(full);
      }
    }
  }
  if (!full && streamErr) throw proxyError(streamErr.error, streamErr);
  if (full && (broke || streamErr || !sawDone)) onText?.(full, { cut: true });
  return full;
}

// The system prompts stay English instructions to the model; this one line
// tells it which language the text the owner actually reads must come back
// in — the app's UI language (js/i18n.js). `keepSourceLanguage` names the
// user's own text for functions that polish/rewrite it: that text's language
// wins only when it clearly differs from the UI language.
// `brand`/`audienceLanguage` (optional): when the brand this content is FOR
// has an audience language set (js/views/brands.js — "" = follow the app's
// own UI language), audience-facing generated content follows THAT instead
// — a shop run in Indonesian can still write English captions for an
// English-speaking audience. Conversational features (the consultant,
// brainstorm, companion chats) talk to the OWNER, not the audience, so they
// never pass a brand here and always stay in the UI language.
export function outputLanguageRule({ keepSourceLanguage = "", brand = null, audienceLanguage = "" } = {}) {
  const forced = audienceLanguage || brand?.audienceLanguage || "";
  const lang = forced
    ? (forced === "en" ? "natural, friendly US English" : "Indonesian (Bahasa Indonesia), casual-friendly and natural")
    : getLang() === "en" ? "natural, friendly US English" : "Indonesian (Bahasa Indonesia), casual-friendly and natural";
  const base = `OUTPUT LANGUAGE: write every piece of text meant for the user in ${lang}. JSON keys, fixed section labels, and codes specified elsewhere in these instructions stay exactly as given.`;
  return keepSourceLanguage ? `${base} Exception: if ${keepSourceLanguage} is clearly written in a different language, keep that language instead.` : base;
}

// Every view that shows/hides its AI buttons reads this instead of poking
// at settings.ai fields directly. No key fields exist client-side anymore
// (see api/ai.js) — "configured" just means the shared config picked a
// provider and didn't explicitly switch it off.
export function hasAiKey(ai) {
  return !!ai?.provider && ai.enabled !== false;
}

// Claude and Gemini read screenshots; DeepSeek's chat model is text-only,
// so surfaces that take a photo fall back to OCR (js/ocr.js) there.
export function aiCanSeeImages(ai) {
  return hasAiKey(ai) && ai.provider !== "deepseek";
}

// Every text call funnels through here, so this is where the daily quota
// pre-check (js/ai-usage.js) happens before even bothering the network —
// api/ai.js is the one that actually enforces it (and counts a successful
// call), this is just a snappier "no" than waiting for a round trip.
// `temperature` / `json` are optional per-call hints (see api/ai.js's
// deepSeekBody); `onText(soFar, { whole })` streams the answer where the
// provider can, and hands over the finished text in one piece (whole: true)
// where it can't — the caller decides whether to animate a reply that
// arrived all at once. `images`: data: URLs sent along with the prompt
// (Claude / Gemini only — DeepSeek refuses them, see aiCanSeeImages).
async function callModel(ai, system, userPrompt, maxTokens = 1024, { countUsage = true, onText = null, temperature, json = false, images = [], feature = "", history = [] } = {}) {
  if (countUsage && aiLimitReached()) {
    const limit = aiDailyLimit();
    const period = aiQuotaPeriod();
    const key = limit === 0
      ? "ai.error.readonly"
      : period === "month" ? "ai.error.quotaMonth" : period === "total" ? "ai.error.quotaTotal" : "ai.error.quota";
    throw quotaOutError(key, { limit, period });
  }
  return callProxy(system, userPrompt, maxTokens, { temperature, json, images, stream: !!onText, countUsage, feature, history }, onText);
}

export async function testAiConnection(ai) {
  await callModel(ai, "Reply with exactly: OK", "ping", 5, { countUsage: false, feature: "test" });
  return true;
}

// Creator's script writer — "naskah siap syuting". The model fills in JSON
// (three-layer hooks + timed beats); js/script-format.js turns that into the
// one script string the app stores, so the layout, labels and timing are
// always the same however the model phrased them.
//
// What the owner chooses in the modal (js/views/creator.js) steers it:
// `hookTypes` (keys from js/knowledge/hook-types.js, up to 3; empty = the
// model mixes 3 different types), `structure` (the ALUR of the body, "auto"
// = the model picks), and the length (`duration`, e.g. "30 dtk"), which
// becomes a narration word budget instead of a vague "<1 menit".
//
// Every hook opens the SAME body (same promise), so the owner can swap
// hooks for free — "Pakai" just replaces the HOOK beat (applyHook).
// `only`: "hooks" | "script" | "caption" regenerates just that part;
// `body` (the script on screen) keeps new hooks leading into it, and
// `hook` (the one picked) keeps a rewritten body following it.
// Returns { hooks: [{ type, say, onScreen, visual, why }], script, beats,
// caption, slides, angle, targetSec }.
export function durationToSeconds(duration, format = "") {
  const s = String(duration || "").toLowerCase().replace(",", ".");
  if (!s.trim()) return /long|panjang|youtube/i.test(format) ? 150 : /story/i.test(format) ? 15 : 30;
  if (s.includes("<1")) return 45; // the old "<1 menit" chip
  const mmss = s.match(/(\d+):(\d{2})/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
  const n = range ? (Number(range[1]) + Number(range[2])) / 2 : Number((s.match(/\d+(?:\.\d+)?/) || [])[0]);
  if (!Number.isFinite(n) || n <= 0) return 30;
  const minutes = /m(e)?n|min|menit/.test(s) && !/detik|dtk|sec|\bs\b/.test(s);
  return Math.round(Math.min(600, Math.max(8, minutes ? n * 60 : n)));
}

// How strong short-form video works — the craft every script prompt reasons
// with (short-form specific, unlike the book principles in
// MARKETING_FRAMEWORKS_CONTEXT, which suit strategy more than a 30-second video).
export const SHORT_FORM_CRAFT = `
How strong short-form videos work (apply it, never mention it):
- One video = one idea and one promise. The hook makes the promise, the body pays it off, nothing else gets in.
- The first frame must work on mute: bold text on screen + a visual action. Most people start watching without sound.
- Write for the ear: short spoken sentences (mostly under 12 words), everyday words, the way this brand talks to a friend. No written-language connectors ("selain itu", "adapun", "oleh karena itu").
- Specific beats general: the brand's real product names, prices, places and hours. One concrete detail is worth more than three adjectives.
- Show, don't claim: every claim in what is said has something on camera that proves it.
- Keep it moving: something changes every beat — the shot, the angle or the text — so there is never dead air.
- Pay off before the ask: the viewer gets the value first; the call to action comes last, once.
- Realistic to shoot: the brand's own place, products and people, filmed with a phone. No actors, drones, studios or stock footage unless asked.`.trim();

// Scripts get their own, stricter version of COPY_FACTS_RULE: invented
// urgency and invented personal stories were what the old prompt slipped
// into BOFU scripts ("stok terbatas", "aku dulu juga gitu").
const SCRIPT_FACTS_RULE = [
  "FACTS ARE FIXED: every number, price, opening hour, place, product and name from the brand context or the owner's input is repeated exactly (\"Rp15.000\" stays \"Rp15.000\", \"jam 1 malam\" stays \"jam 1 malam\").",
  "ABOUT THE BUSINESS ITSELF — how it makes, sources, prepares or delivers things, its services, policies, guarantees, opening times, prices and offers — state ONLY what the brand context or the owner's input says. Never add a step, a habit or a policy to sound richer (no \"direbus tiap hari\", \"boleh lihat dapurnya\", \"gratis ongkir\", \"garansi\" unless given). General knowledge about the product category (what real palm sugar looks like, why small classes help) is fine. When a beat needs a process the facts don't describe, make the Visual a filming instruction (\"rekam proses kalian menyiapkan gula aren\") and keep the narration to what is known — wrong: \"Tiap hari kita lelehkan sendiri\" (not in the facts); right: \"Ini gula aren Blitar yang kami pakai.\"",
  "NEVER INVENT urgency or proof: no stock limits, deadlines or pressure (\"stok terbatas\", \"jangan sampai kehabisan\", \"hari ini aja\", \"buruan\") unless the input says so; no testimonials, ratings, statistics, awards, customer counts or results that aren't given; no made-up numbers about anyone else either (how long other places make people wait, what others charge); no personal experience of the owner (\"aku dulu juga…\") and no customer story presented as something that really happened.",
  "If one real detail would make the video much stronger and it isn't given, write a placeholder like [isi: jumlah pelanggan per hari] — at most one per script — instead of making it up.",
].join(" ");

// The CTA beat asks for one thing; the model's habit is to tack a second one
// on ("…mampir malam ini. Simpan dulu videonya.").
const ONE_ASK = " One ask only — never two in a row (not \"mampir malam ini, simpan juga videonya\").";
const FUNNEL_CTA = {
  TOFU: "Funnel: TOFU (awareness). The goal is to be stopped for and remembered, not to sell. The CTA beat asks for ONE light thing — follow, save, comment, or tag a friend — and mentions the brand naturally, not as a pitch.",
  MOFU: "Funnel: MOFU (consideration). The goal is trust: show how it works or why it is different. The CTA beat asks for ONE thing — save it, ask in the comments/DM, or try something — with the brand as the one who can help.",
  BOFU: "Funnel: BOFU (conversion). The goal is a purchase/booking/visit. The CTA beat gives ONE clear step using the brand's own call to action and the exact offer from the facts (product, price, period, where to order).",
};

// Beats after the hook (the CTA included) for a video of `sec` seconds.
function bodyBeatCount(sec) {
  if (sec <= 20) return [2, 2];
  if (sec <= 40) return [3, 4];
  if (sec <= 70) return [4, 5];
  if (sec <= 110) return [5, 7];
  return [6, 9];
}

// The model writes "COMMON MISTAKE" or "Bikin penasaran" as often as the
// key itself — read any of those back to the catalog key.
const HOOK_TYPE_ALIASES = {
  curiosity: ["curiosity", "penasaran", "curiosity gap"],
  contrarian: ["contrarian", "lawan arus"],
  mistake: ["mistake", "kesalahan", "common mistake"],
  result: ["result", "hasil", "result first"],
  number: ["number", "angka", "specific number"],
  story: ["story", "cerita", "drop-in"],
  callout: ["callout", "call-out", "call out", "panggil"],
  pov: ["pov", "relatable", "relate"],
  secret: ["secret", "behind", "rahasia", "balik layar", "dapur"],
  versus: ["versus", " vs", "perbandingan", "comparison"],
  warning: ["warning", "peringatan"],
  test: ["test", "experiment", "uji"],
};
function hookTypeKeyOf(raw) {
  const s = ` ${String(raw || "").toLowerCase().replace(/[_]/g, " ")}`;
  if (HOOK_TYPE_ALIASES[s.trim()]) return s.trim();
  return Object.keys(HOOK_TYPE_ALIASES).find((k) => HOOK_TYPE_ALIASES[k].some((a) => s.includes(a))) || "";
}

function cleanHook(h, allowed) {
  if (!h || typeof h !== "object") return typeof h === "string" && h.trim() ? { type: "", say: h.trim(), onScreen: "", visual: "", why: "" } : null;
  const say = String(h.say || h.text || h.hook || "").trim();
  if (!say) return null;
  const type = hookTypeKeyOf(h.type);
  return {
    type: allowed.has(type) ? type : "",
    say: say.slice(0, 300),
    onScreen: String(h.onScreen || h.on_screen || h.text_on_screen || "").trim().slice(0, 120),
    visual: String(h.visual || "").trim().slice(0, 300),
    why: String(h.why || "").trim().slice(0, 240),
  };
}

export async function generateScript(
  ai,
  { title, idea, platform, format, funnel, effort, brief, prompt, duration, goal, mofuGoal, bofuOffer, articleText, brandContext, seriesContext, campaignLine, only, hashtags = [], hookTypes = [], structure = "auto", audienceLanguage = "", body = "", hook = null, avoidHooks = [] }
) {
  const wantsHooks = !only || only === "hooks";
  const wantsScript = !only || only === "script";
  const wantsCaption = !only || only === "caption";
  const isCarousel = (format || "").toLowerCase().includes("carousel");
  const lang = audienceLanguage || getLang();
  const sec = durationToSeconds(duration, format);
  const min = Math.round(sec * 2.1);
  const max = Math.round(sec * 2.7);
  const [minBeats, maxBeats] = bodyBeatCount(sec);
  const avgBeats = (minBeats + maxBeats) / 2;
  const perBeatMin = Math.max(6, Math.floor((min - 9) / avgBeats));
  const perBeatMax = Math.max(perBeatMin + 3, Math.floor((max - 9) / avgBeats));
  const f = FUNNELS_CTA_KEY(funnel);
  const picked = [...new Set((hookTypes || []).filter((k) => hookTypeByKey(k)))].slice(0, 3);
  const allowed = new Set(HOOK_TYPES.map((h) => h.key));
  const struct = structureByKey(structure);
  const hookCount = picked.length === 1 ? 3 : picked.length === 2 ? 4 : 3;

  const hookRules = wantsHooks
    ? [
        isCarousel
          ? `HOOKS — write ${hookCount} alternative COVER slides (slide 1). Each: "say" = the cover headline, max 9 words, the promise of the carousel; "visual" = what the cover image shows (one concrete photo idea); "why" = one short plain sentence: why this would make THIS audience swipe; "type" = its hook type key; "onScreen" = "".`
          : `HOOKS — write ${hookCount} hooks. Each hook has three layers that work together: "say" = the first spoken line, max 12 words (under 10 is better: it must be said in about 3 seconds), carrying the promise of the video; "onScreen" = max 7 words of bold text overlay, readable on mute and not a copy of "say"; "visual" = what the very first frame shows — one concrete action or close-up that can really be filmed (never "aesthetic shot" or "b-roll"); plus "why" = one short plain sentence: why this would stop THIS audience scrolling; and "type" = its hook type key.`,
        "All hooks open the SAME video: they make the same promise and lead into the same body, so any of them can be swapped in without changing the rest. They must differ in approach, not just in wording. Never open with a greeting (\"Hai guys\", \"Halo semuanya\"), \"Di video ini\", or the brand name alone.",
        picked.length
          ? `Hook types to use (${picked.length === 1 ? `all ${hookCount} hooks are this type, each a clearly different take on it` : picked.length === 2 ? "two hooks of each type" : "one hook of each type"}):\n${picked.map((k) => `- ${k}: ${hookTypeByKey(k).rule}`).join("\n")}`
          : `Hook types: pick ${hookCount} DIFFERENT types from this list — the ones that fit this piece and funnel best:\n${HOOK_TYPES.map((h) => `- ${h.key}: ${h.rule}`).join("\n")}`,
        avoidHooks.length ? `Hooks already shown to the owner (write new ones, don't reuse these):\n${avoidHooks.slice(0, 9).map((h) => `- ${h}`).join("\n")}` : "",
      ].filter(Boolean).join("\n")
    : "";

  const bodyRules = wantsScript
    ? isCarousel
      ? [
          `SLIDES — after the cover, write the remaining slides (4 to 7) as "slides": one short block of on-slide text each (max ~25 words, not narration). One clear point per slide${struct.beats ? `, following this flow: ${struct.beats}` : ", in the flow that fits the topic best"}; the last slide is the takeaway + one call to action.`,
        ].join("\n")
      : [
          `BODY — after the hook: ${minBeats === maxBeats ? minBeats : `${minBeats}-${maxBeats}`} beats, the last one being the CTA.${struct.beats ? ` Follow this flow: ${struct.beats} → CTA.` : " Pick the flow that fits this piece (problem → fix, a short story, steps, a list, myth vs fact, before → after, behind the scenes) and stick to it."}`,
          `Each beat: "label" = 1-3 words in capitals naming what the beat does, in the output language (e.g. MASALAH, BUKTI, LANGKAH 1, CTA); "visual" = what to film — the shot and the action, concrete, different from the beat before; "onScreen" = a short text overlay or ""; "say" = the exact words, 2-3 short spoken sentences, about ${perBeatMin}-${perBeatMax} words (the CTA beat may be shorter).`,
          `LENGTH — the video is about ${sec} seconds: the narration of ONE hook plus all beats together is between ${min} and ${max} words — NEVER more than ${max}. Cut information before you cut clarity.`,
        ].join("\n")
    : "";

  const effortLine =
    effort === "involved"
      ? "Production: this can be a bigger shoot — several locations, props, other people on camera, or a short narrative are fine if they serve the idea."
      : "Production: keep it simple to shoot — one person with a phone, in the brand's own place, a few shots (talking to camera plus close-ups of the product, place or process). No crew, no special props.";

  const shape = [
    wantsHooks ? '"angle": "one sentence: the single promise of this video"' : "",
    wantsHooks ? '"hooks": [{"type": "hook type key", "say": "...", "onScreen": "...", "visual": "...", "why": "..."}]' : "",
    wantsScript ? (isCarousel ? '"slides": [{"text": "..."}]' : '"beats": [{"label": "...", "visual": "...", "onScreen": "...", "say": "..."}]') : "",
    wantsCaption
      ? hashtags.length
        ? `"caption": "a short caption (2-4 sentences) that adds what the video doesn't say — a question to the audience, the offer, or a detail taken from the facts (never a new one) — ending with exactly these hashtags and no others: ${hashtags.join(" ")}"`
        : '"caption": "a short caption (2-4 sentences) that adds what the video doesn\'t say — a question to the audience, the offer, or a detail taken from the facts (never a new one) — with 3-5 relevant hashtags"'
      : "",
  ].filter(Boolean).join(", ");

  const system = [
    isCarousel
      ? "You write Instagram/TikTok carousel posts for small businesses in Indonesia: a cover that stops the scroll and slides that are easy to read in two seconds each."
      : "You are a short-form video scriptwriter for small businesses in Indonesia. You write scripts an owner can shoot alone with one phone and understand at a glance: every beat says what to SHOW, what TEXT goes on screen and what to SAY.",
    outputLanguageRule({ audienceLanguage: lang }),
    SHORT_FORM_CRAFT,
    NATURAL_WRITING_CONTEXT,
    hookRules,
    bodyRules,
    only === "caption" ? "Only write the caption — no hooks, no script." : "",
    FUNNEL_CTA[f] + ONE_ASK + (f === "MOFU" && mofuGoal ? ` What it should demonstrate: ${mofuGoal}.` : "") + (f === "BOFU" && bofuOffer ? ` What it sells: ${bofuOffer}.` : ""),
    effortLine,
    SCRIPT_FACTS_RULE,
    brandContext
      ? `Brand context — write FOR this audience and IN this brand's voice. Tone-of-voice settings, personality traits, the form of address and words to avoid are rules, not suggestions:\n${brandContext}`
      : "No brand context was given — keep it natural and conversational.",
    seriesContext || "",
    articleText && wantsScript ? "A reference text is given below — build the body from its most relevant, attention-worthy points instead of inventing unrelated content." : "",
    `Before answering, check: ${[wantsHooks ? "every hook is short, from the requested types and opens the same promise" : "", wantsScript && !isCarousel ? `the narration of one hook plus the beats stays under ${max} words, there is exactly one ask and it sits in the last beat` : "", "every sentence about how the business works, what it offers or how it does things is in the facts (delete any that isn't), and no urgency or proof is added"].filter(Boolean).join("; ")}.`,
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {${shape}}`,
  ].filter(Boolean).join("\n\n");

  const hookLine = hook ? (typeof hook === "string" ? hook : [hook.say, hook.onScreen && `(on screen: ${hook.onScreen})`, hook.visual && `(first frame: ${hook.visual})`].filter(Boolean).join(" ")) : "";
  const user = [
    `Platform: ${platform || "Instagram"} · Format: ${format || "Reels"} · Target length: ${isCarousel ? "one carousel post" : `${sec} seconds`}`,
    goal ? `Goal of this piece: ${goal}` : "",
    campaignLine ? `This piece belongs to campaign: ${campaignLine}` : "",
    title ? `Title: ${title}` : "",
    idea ? `Idea so far: ${idea}` : "",
    prompt ? `What the owner wants this content to be about: ${prompt}` : "",
    !title && !idea && !prompt ? "No topic given — pick the single most useful topic for this brand right now from its context, and say it in \"angle\"." : "",
    only === "script" && hookLine ? `The video opens with this hook — it is already written, so do NOT repeat it or rephrase it as a beat; "beats" start right AFTER it and pay off its promise: ${hookLine}` : "",
    only === "hooks" && body.trim() ? `\n--- The body these hooks must lead into (do not rewrite it) ---\n${body.slice(0, 3000)}` : "",
    brief ? `\n--- Creative brief from the owner (follow it closely) ---\n${brief.slice(0, 3000)}` : "",
    articleText ? `\n--- Reference text ---\n${articleText.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n");

  const maxTokens = only === "caption" ? 500 : only === "hooks" ? 1000 : only === "script" ? 1800 : 2600;
  const raw = await callModel(ai, system, user, maxTokens, { json: true, feature: "script", temperature: SCRIPT_TEMPERATURE });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.unreadable"));

  const hooks = (Array.isArray(parsed.hooks) ? parsed.hooks : []).map((h) => cleanHook(h, allowed)).filter(Boolean).slice(0, 4);
  if (wantsHooks && !hooks.length) throw new AiApiError(t("ai.error.unreadable"));
  // The caption has come back under another key ("Caption", "captions")
  // often enough to look for it rather than drop it.
  const captionKey = Object.keys(parsed).find((k) => /^captions?$/i.test(k));
  const captionRaw = captionKey ? parsed[captionKey] : "";
  const caption = String(Array.isArray(captionRaw) ? captionRaw[0] || "" : captionRaw || "").trim();
  if (isCarousel) {
    const rest = (Array.isArray(parsed.slides) ? parsed.slides : []).map((s) => String(typeof s === "string" ? s : s?.text || "").trim()).filter(Boolean);
    const cover = hooks[0]?.say || (hook ? (typeof hook === "string" ? hook : hook.say) : "");
    const slides = (cover ? [cover, ...rest] : rest).map((text, i) => ({ slideNumber: i + 1, text }));
    if (wantsScript && rest.length === 0) throw new AiApiError(t("ai.error.unreadable"));
    const script = slides.map((s) => `Slide ${s.slideNumber}\n${s.text}`).join("\n\n");
    return { hooks, script: wantsScript ? script : "", beats: [], caption, slides: wantsScript ? slides : [], angle: String(parsed.angle || "").trim(), targetSec: null };
  }
  const beats = (Array.isArray(parsed.beats) ? parsed.beats : [])
    .map((b) => ({ label: String(b?.label || "").trim(), visual: String(b?.visual || "").trim(), onScreen: String(b?.onScreen || b?.on_screen || "").trim(), say: String(b?.say || "").trim() }))
    .filter((b) => b.say || b.visual);
  if (wantsScript && !beats.length) throw new AiApiError(t("ai.error.unreadable"));
  const opener = hooks[0] || (hook && typeof hook === "object" ? hook : hook ? { say: String(hook) } : null);
  dropRepeatedHook(beats, opener);
  const script = wantsScript ? renderScript([...(opener ? [{ label: "HOOK", ...opener }] : []), ...beats], { lang }) : "";
  return { hooks, script, beats, caption, slides: [], angle: String(parsed.angle || "").trim(), targetSec: sec };
}
// Lower than the provider default (1.0): the facts rule holds noticeably
// better (tested against DeepSeek, 2026-10-03), and the three hooks still
// differ because the prompt asks for different types.
const SCRIPT_TEMPERATURE = Number(globalThis.__SCRIPT_TEMP__) || 0.7;
// The model sometimes writes the hook again as the first beat ("MASALAH:
// <the hook> + one more line") — the script would then say it twice.
const normWords = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
function dropRepeatedHook(beats, opener) {
  const h = normWords(opener?.say);
  if (!h || !beats.length) return;
  const first = beats[0];
  const said = normWords(first.say);
  if (!said.startsWith(h)) return;
  const rest = String(first.say).trim().replace(/^[\s\S]*?[.!?…](\s+|$)/, "").trim();
  if (rest && normWords(rest) !== said) beats[0] = { ...first, say: rest, onScreen: normWords(first.onScreen) === normWords(opener.onScreen) ? "" : first.onScreen };
  else beats.shift();
}
const FUNNELS_CTA_KEY = (f) => (["TOFU", "MOFU", "BOFU"].includes(String(f || "").toUpperCase()) ? String(f).toUpperCase() : "TOFU");

// Shared by Copy Studio's generate and rewrite — the one rule that matters
// most for copy a business posts under its own name.
const COPY_FACTS_RULE =
  "FACTS ARE FIXED: every name, number, price, date, time, place, phone number, link, and product name from the input must appear exactly as given, never rounded, converted, or paraphrased. NEVER INVENT: no made-up testimonials, customer names, ratings, statistics, awards, discounts, prices, deadlines, stock limits, or contact details. If something isn't in the input, leave it out.";

function parseJsonObject(raw) {
  const cleaned = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

// Every chat-shaped feature below (consultant, brainstorm, companion,
// discuss-a-script) sends its thread as real conversation turns
// ({ role, content }, api/ai.js `history`), not a transcript pasted into one
// message: the model keeps track of who said what, and the provider's
// prefix cache reuses every earlier turn, so a long chat stays cheap.
// It used to keep only the last 8 messages — four exchanges — which is why
// a chat "forgot" the script it wrote a minute ago and asked again.
// The caller (js/consultant-panel.js historyForModel) also keeps the very
// first exchange when a thread is longer than this, so the original ask
// never falls off.
const CHAT_TURNS = 24;
const TURN_CHARS = 8000;
export function chatTurns(history = [], n = CHAT_TURNS) {
  return history
    .slice(-n)
    .map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.text ?? h.content ?? "").slice(0, TURN_CHARS) }))
    .filter((h) => h.content.trim());
}

function normalizeCopyVariant(v) {
  const parts = (Array.isArray(v?.parts) ? v.parts : [v?.text]).map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  return parts.length ? { parts, note: typeof v?.note === "string" ? v.note.trim() : "" } : null;
}

// Copy Studio: `count` variants of one short piece (Threads post or thread,
// Story caption, WhatsApp broadcast, feed caption, or a format the user
// named). Format/goal rules live in js/knowledge/copy-formats.js. Returns
// { variants: [{ parts: string[], note: string }] } — `parts` is one string
// per post (only a Threads chain has more than one), `note` is format extra
// (the Story sticker suggestion).
export async function generateCopy(
  ai,
  { brandContext = "", format, customFormat = "", goal, message = "", details = {}, length = "medium", threadMode = "single", campaignLine = "", count = 3 }
) {
  const goalDef = goalByKey(goal);
  const formatLabel = format === "other" ? customFormat || "other" : formatByKey(format)?.label || format;
  const lengthRule = COPY_LENGTHS.find((l) => l.key === length)?.rule || "";
  const system = [
    "You write short marketing copy for a small business, in that brand's own voice.",
    outputLanguageRule(),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    brandContext
      ? `Brand context — write FOR this audience and IN this brand's voice. Tone-of-voice settings, personality traits, and words to avoid are rules, not suggestions:\n${brandContext}`
      : "No brand details were given, so keep it natural and conversational.",
    `Format rules for ${formatLabel} (these decide the SHAPE of the text and override any structure implied by the principles above):`,
    ...copyFormatRules(format, { threadMode, customFormat }).map((r) => `- ${r}`),
    goalDef ? "Goal rules (these decide the CONTENT, never the shape):" : "",
    ...(goalDef?.rules || []).map((r) => `- ${r}`),
    lengthRule ? `Length: ${lengthRule} Never exceed the format's hard limit.` : "",
    COPY_FACTS_RULE,
    `Write ${count} variants that take genuinely different angles or hooks, not the same text reworded. All ${count} must follow the same format rules.`,
    "Before answering, check each variant against the format's NEVER list and hard limit; fix anything that breaks them.",
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"variants":[{"parts":["..."],"note":"..."}]}. "parts" holds the text, one string per post. "note" is only for a format that asks for one; otherwise an empty string.',
  ]
    .filter(Boolean)
    .join("\n");

  const detailLines = (goalDef?.fields || [])
    .filter((f) => (details[f.key] || "").trim())
    .map((f) => `${f.aiLabel || f.label}: ${f.key === "quote" ? `"""${details[f.key].trim()}"""` : details[f.key].trim()}`);
  const user = [
    `Format: ${formatLabel}${format === "threads" ? ` (${threadMode === "chain" ? "thread of several posts" : "single post"})` : ""}`,
    goalDef ? `Goal: ${goalDef.label}` : "",
    campaignLine ? `This belongs to campaign: ${campaignLine}` : "",
    ...detailLines,
    message.trim() ? `What the business wants to say: ${message.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callModel(ai, system, user, format === "threads" && threadMode === "chain" ? 3500 : 1800, { json: true, feature: "copy" });
  const variants = (parseJsonObject(raw)?.variants || []).map(normalizeCopyVariant).filter(Boolean);
  if (!variants.length) throw new AiApiError(t("ai.error.emptyResponse"));
  return { variants };
}

// Copy Studio's "Pendekin / Lebih santai / Lebih jualan" on one variant.
// `rewrite` is a COPY_REWRITES key. Returns { parts, note }.
export async function rewriteCopy(ai, { brandContext = "", format, customFormat = "", threadMode = "single", parts = [], note = "", rewrite }) {
  const rule = COPY_REWRITES.find((r) => r.key === rewrite)?.rule || rewrite;
  const system = [
    "You edit short marketing copy for a small business, in that brand's own voice.",
    outputLanguageRule({ keepSourceLanguage: "the original text" }),
    brandContext ? `Brand context (voice rules):\n${brandContext}` : "",
    "Format rules (the text must still fit this format's shape, NEVER list, and hard limit after the edit):",
    ...copyFormatRules(format, { threadMode, customFormat }).map((r) => `- ${r}`),
    `Edit instruction: ${rule}`,
    "Anything in quotation marks that came from a customer must stay word for word.",
    COPY_FACTS_RULE,
    NATURAL_WRITING_CONTEXT,
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"parts":["..."],"note":"..."}.',
  ]
    .filter(Boolean)
    .join("\n");
  const user = [...parts.map((p, i) => `--- part ${i + 1} ---\n${p}`), note ? `--- note ---\n${note}` : ""].filter(Boolean).join("\n");
  const variant = normalizeCopyVariant(parseJsonObject(await callModel(ai, system, user, 2500, { json: true, feature: "copy" })));
  if (!variant) throw new AiApiError(t("ai.error.readEdit"));
  return variant;
}

// #3: after the model returns its schedule, nudge it so each 7-day window
// (from startDate) covers TOFU, MOFU and BOFU rather than trusting the
// prompt alone — a real post-pass, not just asking nicely. For every week
// missing a funnel stage, it looks for another week that has TWO OR MORE
// items of that missing stage (so the donor keeps at least one) and a
// stage of its own with two or more items in the receiving week, then swaps
// the two items' dates. Item counts per week and per day never change —
// only which day each item lands on — so this can never invent, drop, or
// double-book anything; it just reshuffles for better weekly variety, and
// only when the item pool actually has enough of each stage to allow it
// ("kalau bisa" — best-effort, not a guarantee when the pool doesn't have it).
function weekIndexOf(dateStr, startDate) {
  const DAY = 86400000;
  return Math.floor((new Date(`${dateStr}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / (7 * DAY));
}
function rebalanceWeeklyFunnelMix(map, items, startDate) {
  const FUNNELS = ["TOFU", "MOFU", "BOFU"];
  const funnelOf = new Map(items.map((it) => [it.id, it.funnel || "TOFU"]));
  const weeks = new Map(); // weekIdx -> { TOFU: [id], MOFU: [id], BOFU: [id] }
  map.forEach((date, id) => {
    const w = weekIndexOf(date, startDate);
    if (!weeks.has(w)) weeks.set(w, { TOFU: [], MOFU: [], BOFU: [] });
    weeks.get(w)[funnelOf.get(id) || "TOFU"].push(id);
  });
  for (const [w, buckets] of weeks) {
    for (const need of FUNNELS.filter((f) => buckets[f].length === 0)) {
      let donorWeek = null;
      let donorId = null;
      for (const [ow, obuckets] of weeks) {
        if (ow === w || obuckets[need].length < 2) continue;
        donorWeek = obuckets;
        donorId = obuckets[need][obuckets[need].length - 1];
        break;
      }
      if (!donorId) continue; // pool has no spare item of this stage anywhere else
      const surplusFunnel = FUNNELS.find((f) => buckets[f].length >= 2);
      if (!surplusFunnel) continue; // this week has nothing safe to trade away
      const receiverId = buckets[surplusFunnel][buckets[surplusFunnel].length - 1];
      const tmp = map.get(donorId);
      map.set(donorId, map.get(receiverId));
      map.set(receiverId, tmp);
      donorWeek[need].pop();
      donorWeek[surplusFunnel].push(receiverId);
      buckets[surplusFunnel].pop();
      buckets[need].push(donorId);
    }
  }
  return map;
}

// Spreads a batch of not-yet-scheduled content across the days ahead —
// avoids stacking the same funnel stage back-to-back where it can, leans on
// weekdays, and schedules whatever's closest to actually being ready
// (Editing/Ready to Upload) sooner than what's still being written or shot.
// routineNotes are the user's own free-text rules from "My Routine" (e.g.
// "upload daily", "MOFU on Tuesdays") — read as instructions, not decoration.
// items: [{ id, title, funnel, status }]. Returns a Map of id -> "YYYY-MM-DD";
// any id the model didn't return just stays unscheduled rather than guessing.
export async function suggestSchedule(ai, { items, startDate, daysAhead = 21, routineNotes = [], brand, campaigns = [], pulseText = "" }) {
  if (!items.length) return new Map();
  const readiness = { editing: 1, scheduled: 0, production: 2, draft: 3, idea: 4 };
  // brand/campaigns are optional — omitting them keeps this behaving
  // exactly as it did before campaign-awareness existed. When given, the
  // caller (calendar.js) also tags each item with a `campaignPhase` label
  // so the model can see which items share a campaign window without
  // suggestSchedule needing to know anything about phase shapes itself.
  const contextBlock = brand ? buildFullContext(brand, { campaigns, pulseText }) : "";
  const system = [
    "You are a social media content calendar planner.",
    contextBlock,
    `Distribute the given content items across the ${daysAhead} days starting ${startDate} (inclusive), one date per item, format YYYY-MM-DD.`,
    "Each item's stage tells you how close it is to actually being postable — schedule items closer to ready (already shot/edited) sooner than ones still being written or filmed, since those need more lead time.",
    "Prefer spreading items evenly rather than clustering on the same day. Avoid scheduling the same funnel stage (TOFU/MOFU/BOFU) on consecutive scheduled days where there's enough variety to avoid it.",
    "Every 7-day window starting from the start date should include at least one TOFU, one MOFU, and one BOFU item whenever the given items include all three stages — a healthy week has a mix, not all of one stage.",
    contextBlock ? "Where an item is tagged with a campaign phase, prefer a date inside that campaign's window (see Active campaigns above) when one is given, and keep items from the same phase reasonably spread rather than all on one day." : "",
    routineNotes.length
      ? `The user's own stated scheduling rules/objectives (follow these as hard constraints where possible, e.g. specific days for specific funnel stages, daily posting, etc.):\n${routineNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"schedule": [{"id": "...", "date": "YYYY-MM-DD"}, ...]} — one entry per item given, same ids.',
  ]
    .filter(Boolean)
    .join("\n");
  const user = items
    .map((it) => `id=${it.id} | funnel=${it.funnel || "TOFU"} | stage=${it.status} (readiness ${readiness[it.status] ?? 5}, lower=more ready)${it.campaignPhase ? ` | campaign phase=${it.campaignPhase}` : ""}${it.series ? ` | series=${it.series}` : ""} | title=${it.title || "Untitled"}`)
    .join("\n");

  const raw = await callModel(ai, system, user, 2000, { json: true, feature: "schedule" });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.readSchedule"));
  const map = new Map();
  (parsed.schedule || []).forEach((row) => {
    if (row?.id && row?.date) map.set(row.id, row.date);
  });
  return rebalanceWeeklyFunnelMix(map, items, startDate);
}

// Reads whatever caption/idea/title exists and picks the single closest
// funnel stage — useful once a caption's already written and the funnel
// wasn't set carefully when the idea was first created.
export async function classifyFunnel(ai, { caption, idea, title }) {
  const system =
    "Classify short-form social content into exactly one funnel stage: " +
    "TOFU (broad awareness/entertainment, no clear ask), " +
    "MOFU (educational/consideration content that demonstrates value or how something works), or " +
    "BOFU (direct sales/conversion push with a clear offer or CTA to buy/sign up). " +
    "Respond with ONLY one word: TOFU, MOFU, or BOFU.";
  const user = [caption ? `Caption: ${caption}` : "", idea ? `Idea: ${idea}` : "", title ? `Title: ${title}` : ""].filter(Boolean).join("\n") || "No content given — respond TOFU.";
  const raw = await callModel(ai, system, user, 10, { feature: "funnel" });
  const match = raw.toUpperCase().match(/TOFU|MOFU|BOFU/);
  if (!match) throw new AiApiError(t("ai.error.funnel"));
  return match[0];
}


// Assembles a brand's structured identity into one labeled context block —
// the shared replacement for every AI feature independently doing its own
// `brand?.aiVoiceGuide || ""`. Falls back gracefully: a brand with only the
// old aiVoiceGuide field filled in (created before Brand DNA existed) still
// gets a usable, non-empty block instead of an empty one.
export function buildBrandContext(brand) {
  if (!brand) return "";
  const dna = brand.brandDNA || {};
  const lines = [
    `Brand: ${brand.name}`,
    brand.businessDescription ? `What this brand does: ${brand.businessDescription}` : "",
    dna.oneLiner ? `One-liner: ${dna.oneLiner}` : "",
    dna.tagline ? `Tagline: ${dna.tagline}` : "",
    dna.purpose ? `Purpose (why this brand exists): ${dna.purpose}` : "",
    dna.vision ? `Vision: ${dna.vision}` : "",
    dna.mission ? `Mission: ${dna.mission}` : "",
    dna.targetAudience ? `Target audience: ${dna.targetAudience}` : "",
    dna.problemSolved ? `Problem this brand solves: ${dna.problemSolved}` : "",
    dna.positioning ? `Positioning: ${dna.positioning}` : "",
    dna.differentiation ? `What makes this brand different: ${dna.differentiation}` : "",
    dna.callToAction ? `Call to action: ${dna.callToAction}` : "",
    dna.successOutcome ? `What success looks like for the customer: ${dna.successOutcome}` : "",
    dna.failureOutcome ? `What the customer risks by doing nothing: ${dna.failureOutcome}` : "",
    dna.personality?.length ? `Brand personality: ${dna.personality.join(", ")}` : "",
    dna.values?.length ? `Brand values: ${dna.values.join(", ")}` : "",
    dna.productsServices?.length ? `Products/services: ${dna.productsServices.join(", ")}` : "",
    brandVoiceText(brand) ? `Voice & tone guide: ${brandVoiceText(brand)}` : "",
    // Aturan tulisan (js/writing-rules.js): how customers are addressed, and
    // the fixed hashtags — set by the owner, never guessed.
    brand.writingRules?.customerCall ? `Address the customer as "${brand.writingRules.customerCall}" (e.g. "${brand.writingRules.customerCall}, …") whenever the text speaks to them directly — never switch to another form of address.` : "",
    brand.writingRules?.hashtags?.length ? `Fixed hashtags: ${brand.writingRules.hashtags.join(" ")}. A social media caption ends with exactly these hashtags, in this order, and no other hashtags. Formats that don't use hashtags (WhatsApp, Story text, bios, Threads) get none.` : "",
    ...brandBuilderContextLines(brand),
    ...brandGuidelinesContextLines(brand),
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : `Brand: ${brand.name} (no brand identity details filled in yet).`;
}

// Brand Builder's Personality + Tone of Voice stages (brand.brandBuilder) —
// only reported once the user has actually saved that stage (`source` set),
// so an untouched 50/50/50/50 default never gets passed off as a real choice.
function brandBuilderContextLines(brand) {
  const bb = brand.brandBuilder || {};
  const lines = [];
  const p = bb.personality;
  if (p?.primary?.length) {
    lines.push(
      [
        `Brand character${p.feeling ? ` (${p.feeling})` : ""}: core traits ${p.primary.join(", ")}`,
        p.secondary?.length ? `; supporting traits ${p.secondary.join(", ")}` : "",
        p.avoid?.length ? `; must never come across as ${p.avoid.join(", ")}` : "",
      ].join("")
    );
  }
  const tov = bb.toneOfVoice;
  if (tov?.source) {
    const axes = TONE_AXES.map((a) => `${a.left}↔${a.right}: ${toneAxisLabel(a, tov[a.key] ?? 50)} (${tov[a.key] ?? 50}/100 toward ${a.right})`);
    lines.push(`Tone of voice: ${axes.join("; ")}`);
    lines.push(`Example of this tone (same message, this brand's voice): ${toneExampleMessage(tov.formal ?? 50, tov.character ?? 50)}`);
    if (tov.avoidWords?.length) lines.push(`Words/styles to avoid: ${tov.avoidWords.join(", ")}`);
  }
  return lines;
}

// Brand Guidelines' visual choices — lets image/caption/campaign features
// stay consistent with the look the brand already committed to.
function brandGuidelinesContextLines(brand) {
  const g = brand.brandGuidelines || {};
  const lines = [];
  if (g.visualDirection?.length) {
    lines.push(`Visual direction: ${g.visualDirection.map((d) => `${d}${VISUAL_DIRECTIONS[d] ? ` (${VISUAL_DIRECTIONS[d].description})` : ""}`).join("; ")}`);
  }
  const c = g.colors || {};
  const colors = [c.primary && `primary ${c.primary}`, c.secondary && `secondary ${c.secondary}`, c.accent && `accent ${c.accent}`].filter(Boolean);
  if (colors.length) lines.push(`Brand colors: ${colors.join(", ")}`);
  return lines;
}

// Distilled, original-wording reference to a handful of widely-known
// marketing/branding books — principle names + one-line descriptions this
// app writes itself, never the books' own text. Used as reasoning support
// for AI features (e.g. suggestCampaignFit below), not something the AI is
// meant to cite or name-drop back at the user.
export const MARKETING_FRAMEWORKS_CONTEXT = `
Marketing & branding principles to reason with (apply the thinking, never quote or name the source book to the user):
- Give before you ask, and earn attention by being genuinely useful or remarkable to a specific smallest-viable audience, rather than shouting at everyone (This Is Marketing).
- Frame the customer as the hero of their own story and the brand as their guide, not the hero — a clear plot beats a clever pitch (Building a StoryBrand).
- A simple customer journey has three parts: what happens before they know you, during their first purchase/experience, and after — each needs its own simple next step (Marketing Made Simple).
- Ideas spread when they carry Social currency, a Trigger, Emotion, Public visibility, Practical value, and a Story (STEPPS) — content earns sharing, it isn't just posted (Contagious).
- Messages stick when they're Simple, Unexpected, Concrete, Credible, Emotional, and told as a Story (SUCCESs) (Made to Stick).
- Modern marketing blends digital speed/data with human, experience-led touches — meet audiences phygitally (physical + digital) and design for participation, not just broadcast (Marketing 6.0).
- People say yes more easily when six levers are in play: Reciprocity (give first), Commitment & Consistency (small agreed steps make bigger ones easier), Social Proof (show others already did this), Liking (relatable, similar, genuinely warm), Authority (real credentials/experience shown, not claimed), and Scarcity (genuinely limited time/spots, never faked) (Influence).
`.trim();

// Distilled from Wikipedia's "Signs of AI writing" (the checklist the
// humanizer-zh editing skill is built on) — every AI feature that writes
// something a customer or the owner will actually read gets this, so
// output doesn't come back sounding like generic AI copy regardless of
// which provider/model produced it.
export const NATURAL_WRITING_CONTEXT = `
Write like a real person who knows this brand — not like an AI assistant. Specifically:
- No inflated significance: never "menjadi bukti", "mencerminkan", "menjadi tonggak penting" for something ordinary — just say what it is.
- No travel-brochure/promotional adjectives ("penuh semangat", "kaya akan", "berkualitas premium", "solusi terbaik", "wujudkan bersama kami") — describe the actual thing, not a vibe.
- No vague authority ("para ahli percaya", "menurut riset industri") without a specific source — if you don't have one from the brand context, don't claim it.
- Don't force everything into exactly three items (three benefits, three adjectives, three steps in a row) — two or four is fine when that's what's actually there.
- Vary sentence length and structure between lines/sentences — don't make three in a row the same shape, and don't end every paragraph on the same tidy one-liner.
- Skip "bukan hanya X, tapi juga Y" and "ini bukan sekadar X — ini Y" constructions.
- Skip a closer that's just generic optimism ("masa depan cerah", "langkah menuju kesuksesan") — end on something concrete instead.
- Cut connective throat-clearing ("selain itu", "pada akhirnya", "tidak dapat dipungkiri") when the sentence works without it.
- State things directly instead of hedging ("mungkin bisa dibilang", "dalam beberapa hal") when you're actually sure.
`.trim();

// One-line summary of a campaign for prompt context — the shared building
// block for every AI feature that needs to describe a campaign to the
// model: the campaign list below, the single active campaign in
// suggestPhaseContent, and the "Active campaigns" section of
// buildFullContext. One definition instead of three near-duplicate
// inline formats drifting apart.
export function campaignSummaryLine(c, brand) {
  const window = c.startDate || c.endDate ? ` | window=${c.startDate || "?"}..${c.endDate || "?"}` : "";
  // Ideas kept on the campaign's own "Ide Campaign" widget (js/views/campaign-detail.js
  // ideasWidgetHTML) flow into every AI call that already includes this line — content
  // generation, brainstorming, the Rencana playbook — so execution stays aligned with
  // what the user already decided, without each caller having to know about the ideas inbox.
  const campaignIdeas = brand?.id ? listBrandIdeas(brand.id, { campaignId: c.id }) : [];
  const ideas = campaignIdeas.length ? ` | captured ideas: ${campaignIdeas.slice(0, 10).map((i) => i.text).join("; ")}` : "";
  // Events (js/store.js buildEventPhases) aren't a growth ladder — they're
  // a single date the whole campaign counts down to, and the brand's role
  // that day (running it vs. renting a booth vs. speaking) changes what
  // "good content" even means. Without this, every AI feature that reuses
  // this summary line (brainstorm, idea generation, the playbook) treats
  // an event exactly like a generic campaign and never mentions the date
  // or the countdown, which is the one thing that actually matters here.
  const event = c.eventPlan
    ? ` | EVENT: role=${c.eventPlan.role}${c.eventPlan.participationType ? `(${c.eventPlan.participationType})` : ""}, date=${c.eventPlan.eventDate}, days left=${Math.max(0, daysUntil(c.eventPlan.eventDate))}, location=${c.eventPlan.setup?.eventLocation || "(not set)"}, objectives=${(c.eventPlan.objectives || []).join(", ") || "(none set)"}`
    : "";
  // Sales the owner tagged with this campaign (or its event) in the Sales
  // Tracker — read straight off the brand doc, like everything else here.
  const tagged = (brand?.salesTracker?.entries || []).filter((e) => e.source?.campaignId === c.id || e.eventId === c.id);
  const sales = tagged.length ? ` | sales tagged to this campaign: ${tagged.reduce((a, e) => a + (Number(e.qty) || 0), 0)} sold, Rp ${Math.round(tagged.reduce((a, e) => a + (Number(e.amount) || 0), 0))} in ${tagged.length} logged sales` : "";
  return `- id=${c.id} | name=${c.name} | objective=${c.objective} | key message=${c.keyMessage || "(none set)"} | audience=${c.targetAudience || brand?.brandDNA?.targetAudience || "(not set)"}${window}${ideas}${event}${sales}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return 0;
  const ms = new Date(`${dateStr}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}

// Roadmap ke Tujuan (js/goal-roadmap.js): the dated goals the owner is
// working toward, read straight off brand.goals so every AI surface knows a
// deadline exists and what the plan around it looks like. Plain data only;
// ai.js never imports the store.
function goalLine(g) {
  const r = g.roadmap || {};
  const lanes = (r.lanes || []).map((l) => `${l.name} ${l.startDate}..${l.endDate}`).join("; ");
  const flags = (r.warnings || []).filter((w) => w.level === "warn").map((w) => w.code).join(",");
  return `- id=${g.id} | ${g.name} | date=${g.targetDate} | days left=${Math.max(0, daysUntil(g.targetDate))} | status=${g.status} | expected attendees=${g.inputs?.expectedAudience ?? "?"} | weekly post capacity=${r.capacity?.perWeek ?? "?"} | lanes: ${lanes || "(none)"}${flags ? ` | plan flags: ${flags}` : ""}`;
}
function goalsContextBlock(brand) {
  const goals = (brand?.goals || []).filter((g) => ["draft", "installing", "partial", "active"].includes(g.status)).slice(0, 3);
  return goals.length ? `Goals (dated targets the owner is working toward; each has a roadmap of lanes and weekly posts):\n${goals.map(goalLine).join("\n")}` : "";
}

// Extends buildBrandContext with active-campaign awareness — the shared
// layer any AI feature can pull from instead of assembling its own
// campaign summary inline. Archived campaigns are left out; they're not
// live strategy anymore.
// `pulseText` (js/brand-pulse.js buildPulseText — a caller-computed block of
// "what's happening in this brand right now") is the third and last part,
// Series Context — the middle layer between Brand Context and the current
// topic/request (Brand Context → Series Context → Current Topic). Mirrors
// buildBrandContext's "one labeled line per filled field" shape so a new
// episode reads exactly how the series was set up, without the owner
// re-explaining the concept every time. Only called when a piece of
// content/conversation is actually linked to a series — an empty return
// here means "no series", not "series with nothing filled in".
export function buildSeriesContext(series, { episodes = [] } = {}) {
  if (!series) return "";
  const dna = series.dna || {};
  const lines = [
    `Series: ${series.name}`,
    `The series name is the title of a recurring show format, not a topic to explain: an episode is a new instalment of the show, never a lesson about what the name means.`,
    dna.description ? `Concept: ${dna.description}` : "",
    dna.mainTopic ? `Main topic: ${dna.mainTopic}` : "",
    dna.objective ? `Objective: ${dna.objective}` : "",
    dna.targetAudience ? `Series audience: ${dna.targetAudience}` : "",
    dna.platform ? `Platform: ${dna.platform}` : "",
    dna.format ? `Format: ${dna.format}` : "",
    dna.tone ? `Tone of voice for this series: ${dna.tone}` : "",
    dna.writingStyle ? `Writing style: ${dna.writingStyle}` : "",
    dna.storytellingStyle ? `Storytelling style: ${dna.storytellingStyle}` : "",
    dna.structure ? `Usual content structure (follow the shape, not word-for-word):\n${dna.structure}` : "",
    dna.typicalHook ? `Typical hook style (write a NEW hook in this spirit — never copy it verbatim):\n${dna.typicalHook}` : "",
    dna.averageLength ? `Average length: ${dna.averageLength}` : "",
    dna.ctaStyle ? `Typical CTA style (write a NEW closing line in this spirit — never copy it verbatim):\n${dna.ctaStyle}` : "",
    dna.visualStyle ? `Visual style notes: ${dna.visualStyle}` : "",
    dna.thingsToAvoid ? `Avoid in this series: ${dna.thingsToAvoid}` : "",
    dna.additionalInstructions ? `Additional instructions for this series: ${dna.additionalInstructions}` : "",
    episodes.length ? `Episodes already made (this is the pattern to continue: same kind of subject and angle, a different subject each time; never repeat one):\n${episodes.map((x) => `- ${x}`).join("\n")}` : "",
  ].filter(Boolean);
  if (!lines.length) return "";
  return [
    `This piece is an episode of the recurring series "${series.name}" — stay consistent with the series concept and style below, but write a genuinely new episode: never reuse the same hook or CTA wording verbatim, and don't make it feel copy-pasted or templated.`,
    lines.join("\n"),
  ].join("\n");
}

// Newest-first titles of the pieces linked to one series: the clearest
// signal of what the series actually is ("Bedah Brand: Coca-Cola",
// "Bedah Brand: McD" says "one famous brand per episode" far better than
// the bare name, which a model reads literally as "how to analyse a brand").
export function seriesEpisodeTitles(series, content = [], max = 8) {
  if (!series) return [];
  return content
    .filter((c) => c.seriesId === series.id && !c.deletedAt && c.title)
    .sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")))
    .slice(0, max)
    .map((c) => c.title);
}

// Brand-wide chats (no series picked) still need to know the brand's
// series exist: an owner typing "ide buat series bedah brand" mid
// conversation means "the next episodes of MY show", not the literal
// words. One line per series with its concept and latest episodes.
// `days`: weekday → series from Ritme Kerja (js/week-plan.js seriesDays), so
// "Rabu ini posting apa?" has an answer.
const WEEKDAY_EN = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export function buildSeriesOverview(seriesList = [], content = [], { days = null } = {}) {
  const rows = seriesList.filter((s) => s?.name).map((s) => {
    const dna = s.dna || {};
    const concept = dna.description || dna.mainTopic || "";
    const eps = seriesEpisodeTitles(s, content, 5);
    const airs = days ? [...days].filter(([, x]) => x.id === s.id).map(([d]) => WEEKDAY_EN[d]).filter(Boolean) : [];
    return `- "${s.name}"${concept ? ` — ${concept}` : ""}${airs.length ? ` | airs every ${airs.join(" and ")} (a post on that day should be an episode of it)` : ""}${eps.length ? ` | episodes so far: ${eps.map((x) => `"${x}"`).join(", ")}` : ""}`;
  });
  if (!rows.length) return "";
  return [
    "The brand runs these recurring content series. A series name is the title of a recurring show format, NOT a topic to teach. When the owner mentions one (even loosely or in lowercase), every idea for it must be a NEW EPISODE of that show that follows its concept and the pattern of its past episodes — e.g. if past episodes each take apart one well-known company, propose other well-known companies to take apart, not tips or theory about the series name.",
    rows.join("\n"),
  ].join("\n");
}

// so every feature built on top of buildFullContext picks it up for free.
export function buildFullContext(brand, { campaigns = [], pulseText = "" } = {}) {
  const active = campaigns.filter((c) => c.status !== "archived");
  const parts = [
    buildBrandContext(brand),
    active.length ? `Active campaigns:\n${active.map((c) => campaignSummaryLine(c, brand)).join("\n")}` : "",
    goalsContextBlock(brand),
    pulseText || "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

// Extends campaignSummaryLine with per-phase content counts — expects the
// caller to have already attached a `phaseCounts` array (from store.js's
// campaignPhaseContentCounts) to each campaign object. ai.js deliberately
// never imports store.js itself (every function here takes plain data as
// params); this keeps that boundary intact while still letting the prompt
// see which phases are already full vs. still empty.
function campaignWithPhasesSummary(c, brand) {
  const base = campaignSummaryLine(c, brand);
  if (!c.phaseCounts?.length) return base;
  const phases = c.phaseCounts
    .map((p) => `${p.name} (${p.count} item${p.count === 1 ? "" : "s"}${p.count === 0 ? " — EMPTY" : ""}, id=${p.id})`)
    .join("; ");
  return `${base}\n  Phases: ${phases}`;
}

// Given a brand's context and its live campaigns (each annotated with
// per-phase content counts), suggests which campaign AND which phase of
// its journey a raw content idea best serves, plus a content angle — so a
// user dropping in an idea doesn't have to manually figure out which
// strategic bucket it belongs to, or which part of that bucket still needs
// filling in. Never auto-applies anything; the caller always leaves the
// suggestion for the user to accept or ignore.
export async function suggestCampaignFit(ai, { brand, campaigns, idea, title }) {
  if (!campaigns.length) throw new AiApiError(t("ai.error.noCampaigns"));
  const system = [
    "You help a brand manager decide which marketing campaign — and which phase of its journey — a new content idea best serves, and suggest a content angle for it.",
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    outputLanguageRule({ brand }),
    "Given the idea below and this brand's active campaigns (each listing its phases and how many content items are already linked to each), pick the single best-fit campaign and phase (or campaignId null if truly nothing fits), and suggest a short content angle — a specific way to shoot/frame this idea so it clearly serves that phase's goal.",
    "When more than one phase could reasonably fit, prefer the one with FEWER linked items (or marked EMPTY) over one that already has plenty — the goal is helping the campaign's journey fill in evenly, not stacking everything onto whichever phase it superficially resembles most.",
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"campaignId": "the chosen campaign\'s id, or null", "phaseId": "the chosen phase\'s id within that campaign, or null", "angle": "1-2 sentences describing the content angle", "rationale": "1-2 sentences on why this campaign/phase/angle, in plain language, no jargon or book names — mention if the phase being empty was part of why"}',
  ].join("\n\n");

  const user = [
    title ? `Title: ${title}` : "",
    idea ? `Idea: ${idea}` : "",
    !title && !idea ? "No title or idea given yet." : "",
    "\nCampaigns:",
    ...campaigns.map((c) => campaignWithPhasesSummary(c, brand)),
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callModel(ai, system, user, 600, { json: true, feature: "campaign" });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.readCampaignFit"));
  const campaign = campaigns.find((c) => c.id === parsed.campaignId);
  const phaseValid = campaign?.phases?.some((p) => p.id === parsed.phaseId);
  return {
    campaignId: campaign ? campaign.id : null,
    phaseId: phaseValid ? parsed.phaseId : null,
    angle: parsed.angle || "",
    rationale: parsed.rationale || "",
  };
}

// Powers the "Get AI options" button on the Brand DNA wizard's question
// steps. The user is expected to have written a genuine attempt already —
// this doesn't invent an answer from nothing, it takes what they actually
// said and offers a few sharper ways to phrase it, so THEY pick the one
// that's right rather than AI silently overwriting their draft with a
// single guess. JSON (a list), unlike the plain-text single-answer
// functions elsewhere in this file, since the caller needs to render each
// option as its own pickable card.
// `voice`: "third-person" for questions that DESCRIBE the customer (who
// they are, what problem they have) — the answer is an internal brand
// note, so it says "mereka"; "second-person" for messages aimed AT the
// customer (CTA, success/failure, purpose as a promise) where StoryBrand's
// "you, not we" rule applies. Omit for the default (message voice).
export async function suggestBrandDnaOptions(ai, { brand, question, guide, principle, draftAnswer, priorAnswers = [], siblingAnswers = [], partRule = "", avoid = [], count = 3, maxWords, voice }) {
  const lengthRule = maxWords
    ? `Every option must be AT MOST ${maxWords} words — read it like a command or a button label, not a sentence. It's a direct call to action: one imperative verb + what they get, nothing else. No setup, no benefit explanation, no "supaya"/"agar" clause tacked on.`
    : partRule
      ? "Every option is a SHORT FRAGMENT of at most 12 words — the piece that fits in this one box, not a whole sentence. No capital letter at the start, no period at the end."
      : "Every option must be SHORT and PUNCHY — one sentence, ideally under 15 words, never a paragraph.";
  const voiceRule =
    voice === "third-person"
      ? "VOICE: this question DESCRIBES the customer for the brand's own notes — write about them in the third person ('mereka', 'pelanggan', 'ibu-ibu usia 30-an'), never address them as 'kamu'/'you' and never write it as an ad line."
      : "VOICE: say 'you'/'kamu' more than 'we'/'kami'; the customer is the hero, so keep the brand's own name and self-praise out of the sentence unless the question is specifically about the brand's authority.";
  const system = [
    "You help a small business owner sharpen their own answer to one question in a guided brand-identity questionnaire built on the StoryBrand framework: the CUSTOMER is the hero of their own story (never the brand); the PROBLEM has a concrete external side and the feeling it causes; the BRAND is a GUIDE — shows empathy (understands the hero's exact situation) and authority (has done this before) — but is never the hero itself; the GUIDE hands the hero a simple PLAN; the GUIDE calls the hero to one clear, direct ACTION; and the story ends in either SUCCESS (what the hero concretely gains) or FAILURE (what they concretely risk by doing nothing).",
    `Given their own draft answer, write ${count} distinct options for how to phrase it better as their real answer — the SAME idea they wrote, said tighter, clearer and more concrete.`,
    // The #1 complaint about this feature was answers that wandered off into
    // invented detail. Grounding comes before every style rule on purpose.
    "GROUNDING — the most important rule: sharpen, never invent. Every concrete detail in an option (a situation, place, number, reason, consequence, product, person) must already appear in their draft, in the brand context, or in what they said in earlier steps. Do NOT add new facts or scenarios to sound richer — if the draft is thin, the option stays short and plain rather than padded with made-up specifics. Keep the draft's meaning: reshape what they wrote, never replace it with a different idea of your own. If the draft already fits the question, the options only tidy the wording.",
    "THE DRAFT IS THE ANCHOR. Someone comparing the draft and an option must instantly see it is the SAME thought, only sharper — so every option keeps the draft's key word(s) or idea visibly in it. If the draft is a single vague word (e.g. 'identitas', 'lancar', 'murah'), expand THAT word into what it concretely means for this brand's customer, keeping the word itself; never swap it for a different, 'better' idea you would have picked from the brand context. When the draft seems unrelated to the brand or too thin to work with, still stay on the draft's idea (connect it to the brand only where the brand context genuinely supports it) and say so briefly in \"note\".",
    partRule
      ? `SCOPE — this is ONE small box inside a bigger sentence, not the whole answer. ${partRule} Write only the piece that belongs in this box; anything that belongs in the other boxes of this question (listed below if already filled) must NOT be repeated here.`
      : "",
    lengthRule,
    "Plain words, zero jargon, sounds like a real person talking — never an ad tagline. It must pass StoryBrand's 'grunt test': a half-distracted person gets it in under 5 seconds.",
    "Cut filler, throat-clearing and generic marketing buzzwords (\"solusi terbaik\", \"kualitas premium\", \"bersama kami wujudkan\", \"the best choice\", etc). Never write generic marketing advice about how to answer — write the answer itself.",
    voiceRule,
    principle ? `A StoryBrand-specific craft rule applies to THIS question — treat it as the actual bar for a good answer, not just a style note: ${principle}` : "",
    "Make the options meaningfully different from each other in angle or phrasing — not near-duplicates of the same line. None of them should read as filler or padding just to sound more 'complete.'",
    outputLanguageRule({ keepSourceLanguage: "their draft answer", brand }),
    NATURAL_WRITING_CONTEXT,
    buildBrandContext(brand),
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"note": "", "options": ["option 1", "option 2", "option 3"]} — exactly ${count} items, every item a non-empty string. "note" is normally an empty string; fill it with ONE short, friendly sentence in the draft's language only when the draft was too thin or vague to sharpen well (e.g. a single word) or doesn't seem to match the brand — tell the owner what to add so the options get more precise. Never put advice in the options themselves.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Question: ${question}`,
    guide ? `What this question is really asking: ${guide}` : "",
    priorAnswers.length ? `\nWhat they've already said in earlier steps (context only — don't repeat it inside the option):\n${priorAnswers.map((a) => `- ${a}`).join("\n")}` : "",
    siblingAnswers.length ? `\nOther boxes of this same question, already filled (the option must fit next to these, not repeat them):\n${siblingAnswers.map((a) => `- ${a}`).join("\n")}` : "",
    draftAnswer ? `\nTheir own draft answer — sharpen this, don't invent something unrelated:\n${draftAnswer}` : "\nThey haven't written a draft yet — suggest reasonable starting points based ONLY on the brand info above (and say nothing the brand info doesn't support).",
    avoid.length ? `\nAlready shown, don't repeat these (write genuinely different options):\n${avoid.map((a) => `- ${a}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let note = "";
  const parseOptions = (raw) => {
    const parsed = parseJsonObject(raw);
    if (!parsed) throw new Error("empty");
    if (!note && typeof parsed.note === "string") note = parsed.note.trim();
    return Array.isArray(parsed.options) ? parsed.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim()) : [];
  };
  // Low-ish temperature: this is form-filling, not brainstorming — the
  // options should stay on the owner's own idea instead of drifting.
  const callOpts = { temperature: 0.6, json: true, feature: "dna" };
  let options;
  try {
    options = parseOptions(await callModel(ai, system, user, 800, callOpts));
    if (!options.length) throw new Error("empty");
  } catch {
    throw new AiApiError(t("ai.error.readOptions"));
  }
  // Models occasionally return fewer than asked — top up once with the
  // ones already shown marked as taken, so the picker never shows a lone
  // option when three were promised.
  if (options.length < count) {
    try {
      const more = parseOptions(
        await callModel(ai, system, `${user}\n\nAlready shown, don't repeat these (write genuinely different options):\n${[...avoid, ...options].map((a) => `- ${a}`).join("\n")}`, 800, callOpts)
      );
      options = [...options, ...more.filter((m) => !options.includes(m))].slice(0, count);
    } catch {
      // keep what we have
    }
  }
  // `note` (usually "") is the AI's one-line heads-up when the draft was
  // too thin or off-brand to sharpen well — the picker shows it above the
  // options so the owner knows what to add instead of just getting odd cards.
  return { options: options.slice(0, count), note };
}

// One call that drafts the whole Brand DNA from the business description
// (plus whatever the owner already answered, which is kept verbatim). This
// is the Pemula path: instead of 8 steps of questions, AI writes the first
// draft and the owner corrects it on the Review screen. Returns the same
// field names the wizard stores in brand.brandDNA; `mission` uses the
// wizard's "1) .. 2) .. 3) .." format so decomposeFunnel3Plan can split it.
const DNA_DRAFT_FIELDS = ["targetAudience", "problemSolved", "differentiation", "mission", "callToAction", "successOutcome", "failureOutcome", "purpose", "vision", "tagline", "oneLiner"];
const DNA_DRAFT_LISTS = ["personality", "values", "productsServices"];

export async function generateBrandDnaDraft(ai, { brand, answers = {} }) {
  const kept = [...DNA_DRAFT_FIELDS, ...DNA_DRAFT_LISTS].filter((k) => (Array.isArray(answers[k]) ? answers[k].length : (answers[k] || "").trim()));
  const system = [
    "You draft a complete brand identity ('Brand DNA') for a small business owner, following the StoryBrand framework: the CUSTOMER is the hero (never the brand); the PROBLEM has an external side and the feeling it causes; the BRAND is the GUIDE (empathy + authority), never the hero; the guide gives a simple 3-step PLAN; calls the hero to one direct ACTION; and the story ends in SUCCESS (what the customer concretely gains, including who they become) or FAILURE (what they honestly lose by doing nothing, no fear-mongering).",
    "Write in plain, spoken language. Concrete, specific to THIS business, zero marketing buzzwords ('solusi terbaik', 'kualitas premium', 'nomor satu'). Every line must pass the grunt test: a distracted stranger gets it in 5 seconds.",
    "GROUNDING: build every field from what the owner actually wrote about the business. Never invent numbers, awards, years of experience, customer counts, prices, locations or guarantees that the description doesn't give — where the description is silent, keep that field general and short rather than making something up. The owner will correct the draft, so an honest plain line beats an impressive invented one.",
    outputLanguageRule({ brand }),
    "Field rules: targetAudience = who they are + what they want (third person, 'mereka'), 1-2 sentences. problemSolved = external problem → the feeling it causes, 1-2 sentences. differentiation = why trust and pick this brand, with a concrete proof if the description gives one, 1-2 sentences. mission = the 3-step plan in EXACTLY this format: '1) <aksi> 2) <aksi> 3) <aksi>' — each an action the customer takes or experiences, chronological. callToAction = at most 8 words, starts with an action verb, like a button label. successOutcome and failureOutcome = 1 sentence each. purpose = why this brand exists beyond profit, 1 sentence. vision = concrete long-term picture, 1 sentence. tagline = at most 6 words. oneLiner = ONE sentence, at most 25 words: problem → what the brand does → result. personality = 3 short adjectives. values = 3 short words. productsServices = 1-4 short items.",
    kept.length ? `These fields were already written by the owner — copy them back EXACTLY as given, do not rewrite them: ${kept.join(", ")}.` : "",
    NATURAL_WRITING_CONTEXT,
    buildBrandContext(brand),
    `Respond ONLY with valid JSON, no markdown fences, exactly these keys: {${[...DNA_DRAFT_FIELDS.map((k) => `"${k}": "..."`), ...DNA_DRAFT_LISTS.map((k) => `"${k}": ["..."]`)].join(", ")}}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `Business: ${brand?.name || ""}`,
    brand?.businessDescription ? `What the owner says about it:\n${brand.businessDescription}` : "No description given — write a plausible draft from the brand name alone and keep it easy to correct.",
    kept.length ? `\nAlready answered (keep verbatim):\n${kept.map((k) => `${k}: ${Array.isArray(answers[k]) ? answers[k].join(", ") : answers[k]}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = parseJsonObject(await callModel(ai, system, user, 1600, { temperature: 0.6, json: true, feature: "dna" }));
  if (!parsed) throw new AiApiError(t("ai.error.readDnaDraft"));
  const out = {};
  DNA_DRAFT_FIELDS.forEach((k) => { out[k] = typeof parsed[k] === "string" ? parsed[k].trim() : ""; });
  DNA_DRAFT_LISTS.forEach((k) => { out[k] = Array.isArray(parsed[k]) ? parsed[k].map((v) => String(v).trim()).filter(Boolean).slice(0, 6) : []; });
  return out;
}



// The Review step's headline deliverable — a single StoryBrand-style
// "one-liner" (problem the customer has -> what this brand does about it ->
// the result they get), built from the whole wizard's answers instead of
// asked as its own separate question. Plain text (unlike the options-list
// JSON above), so it drops straight into an editable field.
export async function generateOneLiner(ai, { brand, answers = {} }) {
  const system = [
    "You write a single \"one-liner\" for a brand: one sentence that a customer immediately understands, following the shape problem -> what this brand does -> the result the customer gets.",
    "It should read like something the business owner would actually say out loud, not a slogan or ad tagline — plain, concrete, zero jargon or buzzwords.",
    "Exactly ONE sentence of AT MOST 25 words — if it runs longer, cut details (keep one problem, one thing the brand does, one result), never add commas to squeeze more in. It must pass the grunt test: a distracted stranger gets it in 5 seconds.",
    outputLanguageRule({ brand }),
    "Respond with ONLY the sentence — no preamble, no quotes, no markdown.",
    NATURAL_WRITING_CONTEXT,
    buildBrandContext(brand),
  ].join("\n\n");

  const user = [
    answers.targetAudience ? `Customer: ${answers.targetAudience}` : "",
    answers.problemSolved ? `Problem: ${answers.problemSolved}` : "",
    answers.differentiation ? `What makes this brand the right pick: ${answers.differentiation}` : "",
    answers.mission ? `The plan/process: ${answers.mission}` : "",
    answers.successOutcome ? `The result the customer gets: ${answers.successOutcome}` : "",
  ]
    .filter(Boolean)
    .join("\n") || "Not enough answers given yet — write a generic but plausible placeholder one-liner based on the brand info above.";

  const raw = await callModel(ai, system, user, 200, { feature: "dna" });
  return raw.trim();
}


// Short "idea bubble" suggestions for the campaign's Ideas widget
// (js/views/campaign-detail.js ideasWidgetHTML) — a short phrase PLUS a
// one-line explanation (shown when the bubble/card is opened), not the
// longer structured cards the old brainstorm modal used to get, and tailored per track since a community/sales idea usually
// isn't a piece of content at all (an activity, a promo tactic). Kept
// deliberately few — a handful of ideas worth actually doing beats a wall
// of them nobody will execute.
export async function generateIdeaBubbles(ai, { brand, campaign, track, existingIdeas = [], extra = "", pulseText = "" }) {
  const framing = {
    social: "Suggest short content/post ideas for this brand's social media — one-liners a creator could turn straight into a Reels/carousel/story concept.",
    community: "Suggest short community activity ideas — things to DO with the community beyond posting content (meetups, challenges, collabs, member spotlights, giveaways, referral pushes).",
    sales: "Suggest short selling ideas and tactics — promos, bundles, offers, follow-up angles, ways to close more sales. Never suggest paid ads or anything needing ad spend data.",
    // The campaign summary line above already carries role/date/days-left
    // (js/ai.js campaignSummaryLine) — lean on that instead of restating
    // it, but steer the KIND of idea toward the event's actual timeline
    // (teaser/countdown content before it, day-of content, a recap after)
    // and toward what this brand specifically does there.
    event: "Suggest short content ideas for promoting and running this EVENT — teasers/countdown posts building up to it, what to post live on the day, and a recap/thank-you after. Match the angle to the brand's role at the event (running the whole thing vs. renting a booth vs. speaking/sponsoring) and how many days are left before it — an idea due next week should read differently from one for six months out.",
  }[track] || "Suggest short campaign ideas — practical, doable moves that push this campaign forward.";
  const system = [
    `You brainstorm SHORT idea bubbles for a brand's marketing campaign. ${framing}`,
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    campaignSummaryLine(campaign, brand),
    existingIdeas.length ? `Ideas already captured for this campaign (don't repeat these):\n${existingIdeas.map((i) => `- ${i}`).join("\n")}` : "",
    extra ? `Extra context from the user: ${extra}` : "",
    "Suggest 4 NEW ideas — a small, genuinely doable set, not a long list nobody will get through. Each idea: text = ONE short phrase, under 10 words, ready to show as a small chip/bubble in a UI. description = the full explanation someone sees once they open that idea (not shown upfront, so it can afford real detail) — 3-5 sentences covering why it fits THIS brand specifically (reference something concrete from its Brand DNA/context, not a generic reason), the concrete steps to actually pull it off, and what a realistic outcome looks like. Written like a strategist briefing a teammate, not a tagline.",
    outputLanguageRule({ brand }),
    'Respond ONLY with valid JSON, no markdown fences: {"ideas": [{"text": "...", "description": "..."}, ...]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, "Suggest the ideas now.", 1400, { json: true, feature: "campaign" });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.readIdeas"));
  return {
    ideas: (parsed.ideas || [])
      .map((i) => ({ text: String(i.text || "").trim(), description: String(i.description || "").trim() }))
      .filter((i) => i.text)
      .slice(0, 4),
  };
}

// "Rencana" for a Grow Brand campaign (js/views/campaign-detail.js): thinks
// past content — what the community should BE and how to run it, or how
// this brand should actually sell — plus concrete non-content activities
// per level. `levels` = [{ index, name, description, targets: ["..."] }].
// Returns { concept: { title, summary, howToRun: [] }, levels: [{ index, activities: [{ title, how, type }] }] }.
// `free`: the app refreshed it on its own after a new signal (js/views/
// campaign-detail.js) — not counted against the owner's credits.
export async function generateCampaignPlaybook(ai, { brand, campaign, track, levels, extra = "", pulseText = "", free = false }) {
  const brief = {
    community: [
      "You are a community strategist. Design this brand's community and how to run it.",
      "concept.title = a community name idea + its one-line idea. concept.summary = who it is for, what members get, why they'd stay (2-3 sentences). concept.howToRun = 4-6 practical operating rules: the weekly ritual and its day, how to welcome new members, how to get the first people in, who moderates, what to do when it goes quiet.",
      "activities = things to DO with the community beyond posting content: meetups, challenges, member spotlights, co-creation, giveaways for members, referral programs, collaborations with other communities, live sessions, offline activations.",
    ],
    sales: [
      "You are a sales strategist for small brands. Design how this brand should actually sell.",
      "concept.title = the core selling approach in one line. concept.summary = why this approach fits this brand, product and price point (2-3 sentences). concept.howToRun = 4-6 practical operating rules: the main sales channel, the follow-up routine for inquiries, how to ask for testimonials, how to bring buyers back.",
      "activities = ways to SELL beyond posting content: bundles, limited drops, pre-orders, promo calendar moments, WhatsApp follow-up scripts, reseller/affiliate programs, live selling, bazaars/pop-ups, loyalty perks, referral rewards. Never suggest paid ads or anything needing ad spend data.",
    ],
    social: [
      "You are a social media growth strategist. Design how this account should grow.",
      "concept.title = the account's growth angle in one line. concept.summary = the content territory this account should own and why people would follow it (2-3 sentences). concept.howToRun = 4-6 practical operating rules: the weekly rhythm, the signature series, how to reply/engage, how to find collaborators.",
      "activities = growth moves beyond regular posting: collaborations, a signature series, giveaways, comment/DM routines, UGC calls, trend-jacking moments, cross-platform repurposing, offline moments worth filming.",
    ],
  }[track] || [];
  const system = [
    ...brief,
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    campaignSummaryLine(campaign, brand),
    `The campaign runs in these levels, in order (each with its own targets):\n${levels.map((l) => `Level ${l.index + 1} — ${l.name}: ${l.description || ""} Targets: ${l.targets.join("; ")}`).join("\n")}`,
    extra ? `Extra context from the user: ${extra}` : "",
    "For EVERY level give 2-3 activities that directly help reach THAT level's targets, realistic for a small team with little budget. Each: title (short, imperative), how (2-3 sentences: the concrete steps), type (one word: event, program, promo, collab, routine, offer).",
    outputLanguageRule({ brand }),
    'Respond ONLY with valid JSON, no markdown fences: {"concept": {"title": "...", "summary": "...", "howToRun": ["...", "..."]}, "levels": [{"index": 0, "activities": [{"title": "...", "how": "...", "type": "..."}]}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, "Write the plan now.", 2600, { countUsage: !free, json: true, feature: "campaign" });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.readIdeas"));
  const c = parsed.concept || {};
  return {
    concept: { title: String(c.title || ""), summary: String(c.summary || ""), howToRun: (c.howToRun || []).map(String).slice(0, 8) },
    levels: (parsed.levels || []).map((l) => ({
      index: Number(l.index) || 0,
      activities: (l.activities || []).slice(0, 4).map((a) => ({ title: String(a.title || ""), how: String(a.how || ""), type: String(a.type || "") })).filter((a) => a.title),
    })),
  };
}

// Suggests 2-3 content ideas for one specific campaign phase — given what's
// already been made for it, so it doesn't repeat itself. Returns ideas only;
// the caller decides whether to turn one into an actual Content item.
export async function suggestPhaseContent(ai, { brand, campaign, phase, existingTitles = [], pulseText = "" }) {
  const system = [
    "You suggest short-form content ideas for one specific phase of a marketing campaign, tailored to the brand's actual character and audience.",
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    campaignSummaryLine(campaign, brand),
    `Offer: ${campaign.offer || "(not set)"}. CTA: ${campaign.cta || "(not set)"}.`,
    `This phase ("${phase.name}") goal: ${phase.goal || "(not set — infer something reasonable for this phase and campaign)"}.`,
    existingTitles.length ? `Content already made for this phase (don't repeat these ideas):\n${existingTitles.map((t) => `- ${t}`).join("\n")}` : "",
    "Suggest 2-3 NEW content ideas for this phase.",
    outputLanguageRule({ brand }),
    'Respond ONLY with valid JSON, no markdown fences: {"ideas": [{"title": "...", "angle": "1-2 sentences", "format": "e.g. Reels, Carousel, Story"}, ...]}',
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Suggest the ideas now.", 700, { json: true, feature: "campaign" });
  const parsed = parseJsonObject(raw);
  if (!parsed) throw new AiApiError(t("ai.error.readIdeas"));
  return (parsed.ideas || []).slice(0, 3).map((i) => ({ title: i.title || "", angle: i.angle || "", format: i.format || "" }));
}

// Once a month the app (js/main.js → js/brand-learning.js) turns last
// month's post numbers into 2–4 plain lessons that stay in the brand's
// memory for good. Started by the app, so free for the owner.
export async function summarizeMonthLessons(ai, { brand, month, rows }) {
  const system = [
    "You read one month of a small brand's own post numbers and write the 2-4 lessons worth remembering for next month's content.",
    outputLanguageRule({ brand }),
    `Brand: ${brand?.name || ""}.`,
    "Each lesson is ONE short sentence built on a comparison the numbers actually show (a format vs the others, a funnel stage, a hook style, a topic) with the figure in it — e.g. 'Reels edukasi rata-rata 2x views dibanding foto produk (3.100 vs 1.400).' Never generic advice, never a number that isn't in the data, and skip anything the data is too thin to show.",
    'Respond ONLY with valid JSON, no markdown fences: {"lessons":["...","..."]}',
  ].join("\n\n");
  const table = rows.map((r) => `- "${r.title}" | ${r.format || "?"} | ${r.funnel || "?"} | views ${r.views ?? "?"} | ER ${r.er === null || r.er === undefined ? "?" : Number(r.er).toFixed(1) + "%"}${r.hook ? ` | hook${r.hookType ? ` (${r.hookType} type)` : ""}: ${r.hook}` : ""}`).join("\n");
  const raw = await callModel(ai, system, `Month ${month}, posts:\n${table}`, 500, { countUsage: false, json: true, feature: "lessons" });
  const parsed = parseJsonObject(raw);
  return (parsed?.lessons || []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 4);
}

// "Sarankan hashtag" in Aturan tulisan (js/writing-rules.js): candidates
// for the brand's fixed hashtags — the owner picks, nothing is applied on
// its own. One credit (they clicked).
export async function suggestHashtags(ai, { brand, pulseText = "", current = [] }) {
  const system = [
    "You suggest the fixed hashtags a small brand puts at the end of every Instagram/TikTok caption.",
    buildBrandContext(brand),
    pulseText || "",
    current.length ? `Already chosen (don't repeat): ${current.join(" ")}` : "",
    "Suggest 12 hashtags: 2-3 for the brand itself (its name or tagline as one tag), 4-5 for its niche/product in the language its audience searches in, 2-3 local (city/region if the context gives one), 1-2 community/audience tags. Real, commonly used tags only; no spaces, no emojis, no generic filler like #love #instagood #fyp.",
    'Respond ONLY with valid JSON, no markdown fences: {"hashtags":["#...","#..."]}',
  ].filter(Boolean).join("\n\n");
  const raw = await callModel(ai, system, "Suggest them now.", 300, { json: true, feature: "hashtags" });
  const parsed = parseJsonObject(raw);
  const out = [];
  (parsed?.hashtags || []).forEach((h) => {
    const tag = `#${String(h || "").replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
    if (tag.length > 1 && !out.some((x) => x.toLowerCase() === tag.toLowerCase()) && !current.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  });
  if (!out.length) throw new AiApiError(t("ai.error.readIdeas"));
  return out.slice(0, 12);
}

// "Buat rencana konten" on a campaign's page (js/views/campaign-detail.js):
// a whole content plan for the next few weeks, in the order the campaign's
// stages run, grounded in the brand and in what has already worked
// (`proven`: short lines about posts that sold or took off). Returns exactly
// `weeks × perWeek` items, oldest first; the page puts the dates on. One
// call, counted against the owner's credits (they clicked it).
export async function generateCampaignContentPlan(ai, { brand, campaign, weeks, perWeek, startDate, stages = [], formats = [], existingTitles = [], proven = [], pulseText = "" }) {
  const total = weeks * perWeek;
  const system = [
    "You plan a campaign's content calendar for a small brand: what to post, week by week, so the campaign moves forward — not a list of random ideas.",
    outputLanguageRule({ brand }),
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    `The campaign:\n${campaignSummaryLine(campaign, brand)}\nOffer: ${campaign.offer || "(not set)"}. CTA: ${campaign.cta || "(not set)"}.`,
    stages.length ? `Its stages, in order (use these exact names in "phase"):\n${stages.map((s) => `- ${s.name}${s.dateFrom ? ` (${s.dateFrom}..${s.dateTo})` : ""}${s.goal ? `: ${s.goal}` : ""}`).join("\n")}` : "",
    proven.length ? `What already worked for this brand — lean on these patterns (not copies):\n${proven.map((p) => `- ${p}`).join("\n")}` : "",
    existingTitles.length ? `Content already planned or made for this campaign (never repeat these):\n${existingTitles.slice(0, 40).map((x) => `- ${x}`).join("\n")}` : "",
    `Plan ${weeks} week(s) starting ${startDate}, ${perWeek} post(s) per week: exactly ${total} items, in posting order. Mix the funnel sensibly across each week (mostly TOFU early on, more MOFU/BOFU as the campaign matures, a BOFU push near the end), and vary the formats.`,
    formats.length ? `Formats this brand uses (pick from these): ${formats.join(", ")}.` : "",
    `Respond ONLY with valid JSON, no markdown fences: {"items":[{"week":1,"title":"short concrete content title","angle":"one sentence: what it says and why it fits this week","format":"one of the formats","funnel":"TOFU|MOFU|BOFU","phase":"stage name or empty"}]}`,
  ].filter(Boolean).join("\n\n");
  const raw = await callModel(ai, system, "Write the plan now.", Math.min(8000, 400 + total * 110), { json: true, feature: "campaign" });
  const parsed = parseJsonObject(raw);
  const items = (parsed?.items || [])
    .map((x) => ({
      week: Math.max(1, Math.round(Number(x?.week)) || 1),
      title: String(x?.title || "").trim().slice(0, 140),
      angle: String(x?.angle || "").trim().slice(0, 300),
      format: String(x?.format || "").trim().slice(0, 40),
      funnel: ["TOFU", "MOFU", "BOFU"].includes(String(x?.funnel || "").toUpperCase()) ? String(x.funnel).toUpperCase() : "TOFU",
      phase: String(x?.phase || "").trim().slice(0, 60),
    }))
    .filter((x) => x.title)
    .slice(0, total);
  if (!items.length) throw new AiApiError(t("ai.error.readIdeas"));
  return items;
}

// "Rencanakan minggu ini" (js/consultant-panel.js's weekPlan chat card): a
// whole week's content, one idea per already-decided date. Unlike the
// campaign plan above, the CALLER picks every date (js/week-plan.js —
// real free upload days, cadence and existing content already excluded)
// and just asks the model to fill each one in; the model is never allowed
// to invent a date of its own, which is what keeps "don't post twice on a
// day the owner can't shoot" true no matter what it writes.
// `campaign`: the owner picked one specific active campaign before
// generating (the menu on "Rencanakan minggu ini" in Calendar/Creator, or
// the scope picker next to "Ganti semua") — every item in the plan then
// serves THIS campaign, instead of the default "tag opportunistically
// across whatever's active" behavior.
// `current`+`request`: a revision — the owner asked for a change in chat
// (e.g. "yang Rabu ganti lebih jualan", or a per-row "Ganti ide ini") and
// `current` is the plan on the table; the model changes only what was
// asked and returns `changed:false` when the message wasn't actually about
// the plan (an off-topic question), so the chat can answer in words
// instead of replacing a fine plan.
export async function generateWeekPlan(ai, { brand, campaigns = [], campaign = null, slots = [], formats = [], existingTitles = [], proven = [], pulseText = "", current = null, request = "", seriesOverview = "", seriesSlots = [] }) {
  const active = campaign ? [] : campaigns.filter((c) => c.status === "active" || c.status === "planning");
  const system = [
    campaign
      ? "You plan one week of content that all pushes a single active campaign forward — every item should serve this campaign's message and offer, not general brand awareness."
      : "You plan one brand's content calendar for the coming days — concrete, postable ideas for specific dates, grounded in this brand's own context.",
    outputLanguageRule({ brand }),
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    campaign
      ? `This entire week's plan is for this campaign — every item's "campaign" field must be exactly this name:\n${campaignSummaryLine(campaign, brand)}\nOffer: ${campaign.offer || "(not set)"}. CTA: ${campaign.cta || "(not set)"}.`
      : active.length ? `Active campaigns — if a date's idea genuinely fits one of these, name it exactly in "campaign" (else leave "campaign" empty; never force a fit):\n${active.map((c) => campaignSummaryLine(c, brand)).join("\n")}` : "",
    seriesOverview,
    seriesSlots.length
      ? `Fixed series days — the item on each of these dates MUST be a NEW EPISODE of that recurring series (same concept and pattern as its past episodes, a subject it hasn't covered yet; title in the series' own naming style), never a generic post:\n${seriesSlots.map((x) => `- ${x.date}: series "${x.series.name}"\n${buildSeriesContext(x.series, { episodes: x.episodes || [] })}`).join("\n")}`
      : "",
    proven.length ? `What already worked for this brand — lean on these patterns (not copies):\n${proven.map((p) => `- ${p}`).join("\n")}` : "",
    existingTitles.length ? `Content already planned or made for this brand (never repeat these):\n${existingTitles.slice(0, 40).map((x) => `- ${x}`).join("\n")}` : "",
    `These exact dates are the only ones you may use, one item per date, in this order (do not add, skip, merge, or reschedule any of them):\n${slots.map((d) => `- ${d} (${dayNameEn(d)})`).join("\n")}`,
    "Mix the funnel sensibly across the week (not every day TOFU), and vary the formats.",
    formats.length ? `Formats this brand uses (pick from these): ${formats.join(", ")}.` : "",
    current
      ? [
          `The owner already has this plan on the table:\n${current.map((it) => `- ${it.date}: "${it.title}" (${it.funnel}${it.format ? `, ${it.format}` : ""}${it.campaignName ? `, campaign: ${it.campaignName}` : ""}) — ${it.angle || ""}`).join("\n")}`,
          `The owner just wrote: "${request}"`,
          "If that message asks for a change to the plan (a specific day, a general direction, adding more sales focus, etc.), rewrite the FULL plan — one item per date above — changing only what was actually asked and keeping the rest as-is. Set \"changed\" to true and \"note\" to one short sentence (max 20 words) saying what changed.",
          "If that message is NOT about changing the plan (an unrelated question, a comment, a thank-you), do not rewrite anything: return the exact same items unchanged, set \"changed\" to false, and put a short normal reply answering the owner in \"note\".",
        ].join("\n")
      : "",
    `Respond ONLY with valid JSON, no markdown fences: {"changed": true, "note": "one short sentence", "items": [{"date":"YYYY-MM-DD","title":"short concrete content title","angle":"one sentence: what it says and why it fits that day","format":"one of the formats","funnel":"TOFU|MOFU|BOFU","campaign":"exact active campaign name or empty"}]}`,
  ].filter(Boolean).join("\n\n");
  const raw = await callModel(ai, system, current ? "Answer now." : "Write the plan now.", Math.min(8000, 400 + slots.length * 150), { json: true, feature: "weekplan" });
  const parsed = parseJsonObject(raw);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  if (!parsed || !rawItems.some((x) => String(x?.title || "").trim())) throw new AiApiError(t("ai.error.readIdeas"));
  // Trimmed to sane types/lengths only — matching each item to one of the
  // caller's own `slots`, resolving a campaign name to an id, and dropping
  // an unrecognized format all happen in js/week-plan.js's
  // normalizePlanItems, which the chat card calls with this same shape.
  const items = rawItems.map((x) => ({
    date: String(x?.date || "").trim(),
    title: String(x?.title || "").trim().slice(0, 140),
    angle: String(x?.angle || "").trim().slice(0, 300),
    format: String(x?.format || "").trim().slice(0, 40),
    funnel: ["TOFU", "MOFU", "BOFU"].includes(String(x?.funnel || "").toUpperCase()) ? String(x.funnel).toUpperCase() : "TOFU",
    campaign: String(x?.campaign || "").trim(),
  }));
  return { changed: parsed.changed !== false, note: String(parsed.note || "").trim().slice(0, 400), items };
}

const dayNameEn = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });

// Powers the Brand Guidelines PDF's "Value Proposition" page — the one
// piece of that document's content that genuinely has no deterministic
// source (unlike Color/Typography, which are lookups from
// brandbook-data.js). The page TEMPLATE (layout, card shapes, where this
// text sits) is fixed in brand-guidelines.js; this only ever supplies the
// text that fills it, on demand, cached into brand.brandGuidelines.aiCopy
// once generated — never re-called on every render.
export async function generateValueProposition(ai, { brand }) {
  const system = [
    "You write the 'Value Proposition' page of a brand guidelines document — 3 short pillars explaining concretely why a customer should pick this brand over alternatives.",
    "Each pillar: a punchy 2-4 word title (not a full sentence, not generic like 'Kualitas Terbaik') plus one supporting sentence (max 18 words) — grounded in the brand's own real context below, never a generic claim with nothing concrete behind it.",
    outputLanguageRule({ brand }),
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"pillars": [{"title": "...", "desc": "..."}]} — exactly 3 items.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Write the 3 value proposition pillars now.", 500, { json: true, feature: "guidelines" });
  const parsed = parseJsonObject(raw);
  const pillars = Array.isArray(parsed?.pillars) ? parsed.pillars.filter((p) => p?.title && p?.desc) : [];
  if (!pillars.length) throw new AiApiError(t("ai.error.readValueProp"));
  return pillars.slice(0, 3);
}

// Powers the Brand Guidelines PDF's "Colour Essence" page — one short
// sentence per role (primary/secondary/accent) explaining what that
// SPECIFIC hex, for THIS brand, is meant to evoke — not generic color
// theory ("blue means trust") repeated identically for every brand that
// happens to pick a blue.
export async function generateColorEssence(ai, { brand, colors, colorFeelings = [] }) {
  const system = [
    "You write the 'Colour Essence' page of a brand guidelines document — for each of the brand's Primary, Secondary, and Accent colors, one short sentence (max 16 words) explaining the feeling that specific color is meant to evoke for THIS brand.",
    "Ground each sentence in the brand's own context and that exact hex/character — never interchangeable color-theory trivia that would read the same for any other brand with a similar hue.",
    colorFeelings.length ? `The owner picked these color feelings when choosing this palette: ${colorFeelings.join(", ")}.` : "",
    outputLanguageRule({ brand }),
    NATURAL_WRITING_CONTEXT,
    buildBrandContext(brand),
    `Colors — primary: ${colors.primary}, secondary: ${colors.secondary || colors.primary}, accent: ${colors.accent || colors.primary}.`,
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"primary": "...", "secondary": "...", "accent": "..."}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Write the colour essence sentences now.", 400, { json: true, feature: "guidelines" });
  const parsed = parseJsonObject(raw);
  if (!parsed?.primary) throw new AiApiError(t("ai.error.readColorEssence"));
  return { primary: parsed.primary, secondary: parsed.secondary || "", accent: parsed.accent || "" };
}

// Powers the "Konsultasi AI" floating chat panel (js/consultant-panel.js) —
// a free-form branding advisor grounded in this brand's own DNA, the same
// distilled marketing-book principles every other AI feature here already
// leans on, AND a live snapshot of this brand's actual tracked data
// (overdue content, engagement, campaign coverage, DNA/Guidelines
// completeness) so its advice can point at real numbers instead of staying
// generic. ai.js still never imports store.js itself — snapshotText is
// built by the caller (consultant-panel.js) from real store data and
// handed in as plain text, same boundary every other function here keeps.
// history: [{ role: "user"|"assistant", text }] — folded into the user
// turn as a plain transcript rather than each provider's own multi-turn
// message array, since all three providers here are only ever called with
// one system + one user string (see callModel above); good enough for a
// short advisory chat without touching that shared plumbing.
// Every screen the consultant is allowed to point someone at — kept as one
// list so the prompt and the click-to-navigate handler in
// js/consultant-panel.js both read off the same source of truth. `path` is
// appended to `#/brand/:id/`; "" means the brand's own home page.
// How a social media specialist reads short-form video performance — the
// same floors js/retention.js rates with, so the consultant's words and the
// app's badges never disagree.
export const RETENTION_SPECIALIST_CONTEXT = `
How to read short-form video performance (Reels / TikTok), as a social media specialist would:
- Hook = % of viewers still watching at second 3 (Instagram shows the inverse as "skip rate"). >=70% strong, 50-70% average, <50% weak: the first 1-3 seconds (first frame, first words, on-screen text) are the problem, not the topic.
- Average watch time / video length = % of the video watched. By length: <=15s: >=75% strong, >=55% ok; 16-30s: >=60% / >=40%; 31-60s: >=45% / >=30%; >60s: >=35% / >=20%. Above 100% means replays (loops), a very strong sign.
- Completion (% who reached the end): <=15s: >=45% strong, >=25% ok; 16-30s: >=35% / >=18%; 31-60s: >=25% / >=12%; >60s: >=15% / >=7%.
- The retention curve's biggest drop tells where to cut: a cliff in the first 3s = hook; a slide in the middle = pacing / no payoff yet, cut the dead air; a drop right before the end = the ending drags or the CTA comes too late.
- Cross-read with engagement: strong retention + weak engagement = the video asks for nothing (add a reason to save/share/comment); weak hook + strong engagement = the hook speaks to too few people but the content itself lands; views far above reach = replays.
- Saves and shares per reach are the distribution signals (>=1% of reach each is strong); comments >=0.5% of reach is healthy.
- Advice must name the specific second / part of the video and the specific change (e.g. "put the result on screen in the first frame", "cut seconds 4-9 where nothing new happens"), never generic "make it more engaging".`;

// Reads one insight screenshot (Instagram / TikTok post insights, or the
// retention graph) into numbers. Strict JSON out, normalized here so the
// caller gets the same shape as js/ocr.js analyzeScreenshot. One AI credit
// per screenshot.
export async function extractInsightsFromImage(ai, dataUrl) {
  const system = [
    "You read screenshots of social media post insights (Instagram Reels/posts, TikTok, Facebook) and return the numbers as JSON. Reply with ONLY a JSON object, no markdown fences, no prose.",
    'Shape: {"platform":"instagram|tiktok|facebook|other","metrics":{"views":null,"reach":null,"likes":null,"comments":null,"shares":null,"saves":null,"profileVisits":null,"followersGained":null},"retention":{"videoLengthSec":null,"avgWatchTimeSec":null,"skipRatePct":null,"hookPct":null,"completionPct":null,"curve":[]},"confidence":"high|medium|low","notes":""}',
    "Rules: every value is a plain number or null, never a string. Expand K/M/rb/jt suffixes (12.3K = 12300, 1,2 jt = 1200000). Times like 0:07 or 7s = 7 seconds; 1:05 = 65. Percentages as numbers (38% = 38). Labels may be Indonesian: Ditonton/Tayangan = views, Jangkauan/Akun yang dijangkau = reach, Suka = likes, Komentar = comments, Dibagikan/Kiriman = shares, Disimpan = saves, Kunjungan profil = profileVisits, Mengikuti/Pengikut baru = followersGained, Waktu tonton rata-rata = avgWatchTimeSec, Rasio lewati = skipRatePct.",
    'Retention graph: x-axis is time in the video, y-axis is the % of viewers still watching. Sample it as curve: [{"sec":0,"pct":100},...] with 6 to 12 evenly spaced points including the last one at the video\'s end. hookPct = the curve\'s value at second 3 (if the graph starts below 100 at 0s, use what it shows). completionPct = the value at the last second. videoLengthSec = where the x-axis ends. If a metric is not in the picture, leave it null, never guess.',
    "If the picture is not an insights screenshot at all, return every metric null and say why in notes.",
  ].join("\n");
  const raw = await callModel(ai, system, "Read this screenshot.", 900, { images: [dataUrl], json: true, feature: "insights" });
  const json = parseJsonObject(raw);
  if (!json || typeof json !== "object") throw new AiApiError(t("ai.error.badExtract"));
  const n = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const metrics = {};
  Object.entries(json.metrics || {}).forEach(([k, v]) => { const x = n(v); if (x !== null) metrics[k] = Math.round(x); });
  const r = json.retention || {};
  const retention = {
    videoLengthSec: n(r.videoLengthSec), avgWatchTimeSec: n(r.avgWatchTimeSec), skipRatePct: n(r.skipRatePct), hookPct: n(r.hookPct), completionPct: n(r.completionPct),
    curve: Array.isArray(r.curve) ? r.curve.map((p) => ({ sec: n(p?.sec), pct: n(p?.pct) })).filter((p) => p.sec !== null && p.pct !== null) : [],
  };
  return { platform: json.platform || "other", metrics, retention, confidence: json.confidence || "medium", notes: String(json.notes || ""), source: "ai" };
}

export const CONSULTANT_ROUTES = [
  { key: "dna", label: t("ai.route.dna"), path: "dna" },
  { key: "guidelines", label: t("ai.route.guidelines"), path: "guidelines" },
  { key: "builder", label: t("ai.route.builder"), path: "builder" },
  { key: "campaigns", label: t("ai.route.campaigns"), path: "campaigns" },
  { key: "content-os", label: t("ai.route.contentOs"), path: "content" },
  { key: "content-list", label: t("ai.route.contentList"), path: "content/list" },
  { key: "creator", label: t("ai.route.creator"), path: "content/creator" },
  { key: "calendar", label: t("ai.route.calendar"), path: "content/calendar" },
  { key: "sales", label: t("ai.route.sales"), path: "sales" },
  { key: "copy", label: t("ai.route.copy"), path: "content/copy" },
  { key: "brainstorm", label: t("ai.route.brainstorm"), path: "brainstorm" },
  { key: "home", label: t("ai.route.home"), path: "" },
];

export async function askBrandConsultant(ai, { brand, snapshotText, pulseText = "", history = [], question, onText = null, kinds = [], images = [], imageText = "" }) {
  const routesList = CONSULTANT_ROUTES.map((r) => `${r.key} = ${r.label}`).join(", ");
  const hasPhoto = images.length > 0 || !!imageText;
  const system = [
    // ---- STATIC: identical every turn, so DeepSeek's prefix cache can
    // reuse it — brand/pulse/live-data/photo blocks (genuinely different
    // turn to turn) go last instead.
    "You are a practical branding & marketing consultant embedded inside this brand's own tool.",
    outputLanguageRule(),
    "Answer the user's LATEST message and nothing else, reading it in the light of the conversation so far (a short follow-up refers to what was just discussed). The brand data below is background: use only the parts that answer this question. Do not bring up other campaigns, numbers, streaks or problems the user didn't ask about — no 'the rest can wait, but…' add-ons. Only when they ask what to do first or what's most urgent, name the top one or two things.",
    "You give specific, actionable advice grounded in THIS brand's actual context and data below — never generic marketing platitudes. When the brand's tracked data below is relevant to the question, cite the actual numbers (e.g. 'ada 3 konten overdue', 'engagement rate rata-rata 2.1%') instead of speaking abstractly.",
    MARKETING_FRAMEWORKS_CONTEXT,
    RETENTION_SPECIALIST_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    "Lead with the answer. By default keep it to 2-4 sentences, or at most 3 short bullets when listing steps; when they ask you to explain, go deeper or discuss, give a fuller answer (up to ~300 words, short '### ' headers or numbered points). No preamble, no recap at the end. Apply the marketing/branding thinking above naturally; never quote or name-drop the source books to the user.",
    `If the user's message itself tells something that HAPPENED to the brand (a sale or a change in sales, an offer, a notable customer, a collab, a launch, a complaint, an event, a new product or price) that is not already in the brand context above, answer as usual and add ONE line [[moment:KIND|short title, max 80 chars, in the user's language|the specifics they gave, max 160 chars, or empty]] with KIND one of ${kinds.length ? kinds.join(", ") : "sales-spike, offer, vip, collab, launch, complaint, event, other"} — the app asks them whether to save it to brand memory. Never for questions, plans or feelings.`,
    HANDOFF_RULE_CONSULTANT,
    `When your answer tells the user to go do something in a specific screen of this app, or they ask where a screen is, end with ONE line for the single most relevant screen, in the exact form [[goto:KEY]] using ONLY these keys: ${routesList}. To point at ONE specific campaign from the live data above, use [[goto:campaign:ID]] with that campaign's exact id instead — only a campaign your answer names, never another one. Use [[open:insights]] only when the answer is about refreshing Instagram profile numbers. At most one of these per reply, on its own line at the very end, and none when the answer doesn't send them anywhere.`,
    "When there is an obvious next question, end with at most 2 follow-ups, each on its own line in the exact form [[ask:Question]] — written the way THIS user would ask it (their language, short, max ~8 words), answerable from this brand's context and data above. The app turns each into a button. Skip them when the answer is complete on its own. Never repeat a question already asked in this conversation, and never mention or explain these lines.",
    // ---- DYNAMIC: brand-, pulse-, data- and photo-specific, so it never
    // matches an earlier turn's prefix past this point anyway.
    buildBrandContext(brand),
    pulseText || "",
    snapshotText ? `Live tracked data for this brand right now:\n${snapshotText}` : "",
    hasPhoto
      ? [
          images.length
            ? `The user attached ${images.length} screenshot(s) of their own post insights (Instagram / TikTok numbers or a retention graph). Read every number and the graph carefully: K/M/rb/jt suffixes, 0:07 = 7 seconds, Indonesian labels (Ditonton = views, Jangkauan = reach, Disimpan = saves, Dibagikan = shares, Waktu tonton rata-rata = average watch time, Rasio lewati = skip rate). A retention graph's x-axis is time in the video and y-axis is % still watching. When only the graph is shown (no printed numbers), read the values off it: videoLengthSec = where the x-axis ends, hookPct = the curve at second 3, completionPct = the curve at the end, avgWatchTimeSec = the area under the curve (the average of the curve's % over the whole length, times the length, divided by 100).`
            : `The user attached a screenshot of their post insights; the provider can't see images, so here is the text scanned from it (numbers may be slightly garbled):\n${imageText}`,
          "Open with ONE short line stating the key numbers you read (so the user can check you read them right), then diagnose like the specialist above: name the exact problem (hook / middle / ending / no ask) with the second it happens, and give 2-3 concrete fixes for the NEXT video. Compare against this brand's tracked averages above when they exist.",
          "End with ONE line in the exact form [[metrics:key=value;key=value]] listing every number you read, using ONLY these keys: views, reach, likes, comments, shares, saves, profileVisits, followersGained, videoLengthSec, avgWatchTimeSec, hookPct (% still watching at second 3; if the screenshot shows skip rate, hookPct = 100 minus skip rate), completionPct (% who reached the end), skipRatePct. Plain numbers only (12300 not 12.3K, seconds not 0:07). Omit the line entirely if the picture has no such numbers.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return callModel(ai, system, question, hasPhoto ? 1400 : 1000, { onText, images, feature: "consultant", history: chatTurns(history) });
}

// "Otomatis" in "Tanya Brandlab" (js/consultant-panel.js): one box in front
// of the Consultant (askBrandConsultant), the Brainstorm partner
// (chatBrainstorm) and the Companion (companionChat). When the panel's own
// keyword rules can't tell which one a message is for, this asks the model —
// a one-word answer, ~5 tokens, never counted against the owner's AI
// credits (it isn't a feature, it's the receptionist).
// A script the owner asked for goes into one [[script:…]]…[[/script]] block
// (js/ai-directives.js), which the chat shows as a "Script siap" card with
// "Setujui & simpan ke Creator" — so a script written in chat lands in a
// real draft in one tap instead of being copy-pasted out of a bubble.
// Same beat shape as Creator's writer (js/script-format.js), so a script
// written here parses into the same beats, gets the same timing when it is
// saved, and reads the same in the teleprompter.
const SCRIPT_DIRECTIVE_RULE = [
  "WRITING A SCRIPT: when the owner asks for a script, naskah, narasi or voice-over for a video (or says yes to your offer to write one), write the WHOLE finished script inside ONE block, exactly in this shape:",
  "[[script:FUNNEL|Short content title (max 10 words)|Format]]",
  "[0-3 dtk] HOOK",
  "Visual: what the very first frame shows — one concrete action that can really be filmed",
  "Teks layar: max 7 words of bold on-screen text",
  "Narasi: the first spoken line, max 12 words",
  "",
  "[3-9 dtk] BEAT NAME IN CAPITALS",
  "Visual: …",
  "Teks layar: … (only when it helps)",
  "Narasi: 1-3 short spoken sentences",
  "",
  "…more beats; the last one is CTA with exactly ONE ask…",
  "CAPTION: a ready-to-post caption, 2-4 sentences, with 3-5 relevant hashtags (or the brand's fixed hashtags when the context names them)",
  "[[/script]]",
  "FUNNEL is exactly TOFU, MOFU or BOFU. Format is one of: Reels, Short Video, Carousel, Story, Long Video, Static Post. In English replies the labels are \"[0-3 s]\", \"Visual:\", \"On-screen text:\", \"Voice:\".",
  "Unless they say otherwise the video is about 30 seconds: all narration together about 60-80 words (people speak about 2.5 words a second), timings that add up. Every beat changes the shot. The business facts in the brand context are the only facts: no invented process, policy, urgency, testimonial or number.",
  "A script about the brand's own story, people or history (how it started, the founder, a real customer) uses ONLY what the context says. When those facts aren't there, still write the full script, but put clearly marked placeholders where the real story goes — e.g. 'Narasi: Kami mulai tahun [isi: tahun mulai] karena [isi: alasan sebenarnya].' — and after the block ask for those details in one sentence. Never invent a backstory, a founder's feelings or a customer's words.",
  "When they ask to change a script you already wrote (shorter, another hook, more casual), apply it at once and write the FULL new block again — never only the changed part, never ask first.",
  "Hook styles you can switch to when they want a stronger opening: curiosity gap, contrarian, common mistake, result first, specific number (from the facts only), story drop-in, call-out of the audience, POV, behind the scenes, versus, honest warning, on-camera test.",
  "Outside the block write only ONE short sentence before it (what you made and why it fits), and after it at most 2 [[ask:…]] follow-ups such as 'Pendekin jadi 15 detik' or 'Coba hook lawan arus'. Never paste the script outside the block, never two script blocks, and never [[draft:…]] for the same piece.",
].join("\n");

// Konsultan and Teman never answer "the other tab does that": a message
// that belongs to another assistant comes back as ONLY the handoff line,
// and js/consultant-panel.js sends the same message on to that assistant
// right away (sendMessage → reroute), so the owner gets the real answer in
// the same turn instead of a button to press and a question to repeat.
const HANDOFF_RULE_CONSULTANT =
  "You answer from the data and give advice. When the latest message is mainly a request to WRITE or invent something — content ideas, topics, hooks, a script, a caption, a post — reply with ONLY the line [[handoff:brainstorm]] and nothing else: the app passes it straight to the writing partner, who has the same brand data. When the owner is only venting or sharing how they feel, with no question in it, reply with ONLY [[handoff:companion]]. Everything else is yours to answer — never point them elsewhere for something you can answer.";
const HANDOFF_RULE_COMPANION =
  "When the latest message is mainly a request to write or invent something — content ideas, hooks, a script, a caption — reply with ONLY the line [[handoff:brainstorm]]. When it is mainly a question about their numbers, schedule, campaigns, strategy or how to use the app, reply with ONLY [[handoff:consultant]]. The app passes the message on at once, so add nothing else. A passing 'menurutmu bisa jadi konten?' after telling you what happened is still yours: react, give your honest take in a sentence, and you may add ONE [[idea:Short title|why, one sentence]] line.";

export async function classifyChatIntent(ai, { message, lastEngine = "" }) {
  const last = { consultant: "data", brainstorm: "ideas", companion: "friend" }[lastEngine] || "";
  const system = [
    "You route ONE message from a small-business brand owner to the right assistant inside their brand tool. Reply with exactly one word and nothing else: data, ideas, or friend.",
    "data — they ask about their brand's numbers, performance, schedule, campaign progress, strategy, what to do first, how or where to do something in the app, or any question that wants a concrete, factual answer.",
    "ideas — they want content ideas, topics, angles, hooks, inspiration, to think through what to make or post next, a script, caption or voice-over written, OR to discuss / break down a topic in depth (another brand's marketing, a case, a trend, a strategy idea — 'bedah marketing Mixue', 'kita bahas kenapa X viral').",
    "friend — they tell what happened today or in the business (a sale, a customer, an offer, a problem), vent, share how they feel, or want encouragement, without asking for anything.",
    last ? `The previous reply came from: ${last}. A short follow-up ("iya", "yang pertama", "ok lanjut", "kenapa?") usually belongs to the same assistant.` : "",
    "Any request to write or invent something is ideas, whatever else it mentions. Examples: 'bikin script cerita awal mula brand' → ideas; 'kasih ide konten buat campaign ramadan' → ideas; 'kenapa reach aku turun?' → data; 'bedah strategi marketing Mixue dong' → ideas; 'kenapa harga Rp15rb kemahalan menurut data penjualanku?' → data; 'tadi ada pelanggan borong 20 cup' → friend; 'capek banget, sepi' → friend.",
    "The message may be in Indonesian or English. If genuinely unsure, answer data.",
  ].filter(Boolean).join("\n");
  const raw = String(await callModel(ai, system, message, 5, { countUsage: false, feature: "route" })).trim().toLowerCase();
  if (raw.startsWith("idea")) return "brainstorm";
  if (raw.startsWith("friend")) return "companion";
  return "consultant";
}

// Sales Tracker's "what should I do with these numbers?" — three concrete
// next moves from the brand's own sales log (js/sales-tracker.js
// salesSnapshotText). The snapshot holds only numbers the owner typed in;
// the rules below keep the model from inventing anything beyond them (no
// ads metrics, no conversion rates, no market data).
// Returns { summary, actions: [{ title, why, how }] }.
// `free`: a refresh the app started on its own (a new signal) — not counted
// against the owner's credits.
export async function suggestSalesActions(ai, { brand, snapshotText, campaigns = [], pulseText = "", free = false }) {
  const system = [
    "You are a practical sales & marketing advisor for a small business, embedded inside this brand's own sales tracker.",
    outputLanguageRule(),
    buildFullContext(brand, { campaigns, pulseText }),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    "Rules about numbers (strict): use ONLY the figures in the sales data the user sends. Never invent or estimate a number that isn't there — no conversion rates, no ROAS/CPC/CPM/CPA, no ad spend, no market size, no competitor figures. This business has no ads or traffic data at all, so never assume any. When you cite a number, cite it exactly as given.",
    "Rules about certainty: the data shows WHAT is happening, not WHY. Phrase causes as possibilities worth checking, never as facts. If the log is too thin to say anything specific (e.g. fewer than ~5 logged sales), say so plainly in the summary and make the actions about getting the first sales and logging them — do not pretend to see a pattern.",
    "Give exactly 3 actions the owner can start THIS WEEK without a budget for ads, ordered by likely impact. Each must point at something specific in the data (a product that's selling, one that has gone quiet, a weekly dip, repeat buyers, referrals) and be concrete enough to act on today. No generic advice like 'improve your marketing'.",
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"summary":"2-3 sentences on what the numbers show","actions":[{"title":"short imperative","why":"which number this comes from","how":"2-3 concrete steps in one short paragraph"}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, `Sales data:\n${snapshotText}`, 1400, { countUsage: !free, json: true, feature: "sales" });
  const parsed = parseJsonObject(raw);
  const actions = (parsed?.actions || [])
    .map((a) => ({ title: String(a?.title || "").trim(), why: String(a?.why || "").trim(), how: String(a?.how || "").trim() }))
    .filter((a) => a.title)
    .slice(0, 3);
  if (!actions.length) throw new AiApiError(t("ai.error.unreadable"));
  return { summary: String(parsed.summary || "").trim(), actions };
}

// The Teman tab of the chat (js/consultant-panel.js) — a friend's reply to
// what the owner just said, in the flow of a real conversation, not a
// consultant's report. Short on purpose: this fires on every message, so it
// has to stay cheap and quick to read. `history` is the recent thread (the
// raw chat — the only AI call that ever sees it), `pulseText` is
// js/brand-pulse.js buildPulseText: the moments the owner already confirmed
// plus auto signals, so the reply knows what's in motion without re-reading
// the chat. When the owner tells it something that happened to the brand,
// the reply ends with a [[moment:…]] line the app turns into a "save to
// brand memory" card — that is how the brand's story reaches every other
// AI feature, one owner-approved note at a time.
export async function companionChat(ai, { brand, pulseText = "", history = [], message, kinds = [] }) {
  const system = [
    // ---- STATIC first (prefix-cache friendly) — brand/pulse last.
    "You are this brand owner's thinking partner — warm and direct, like a friend who actually pays attention, never a corporate assistant and never a coach lecturing them.",
    outputLanguageRule(),
    "Reply to the owner's latest message in 2-3 short sentences, conversational, no bullet points, no headers. React to what they actually said. You may offer ONE concrete, specific suggestion if it clearly calls for one — never a generic pep talk.",
    "If they mention something personal or just vent, respond like a friend would (briefly, kindly) and don't turn it into marketing advice.",
    `If what they said is something that HAPPENED to this brand — a sale or a change in sales, an offer or proposal, a notable customer, a collab, a launch, a complaint or problem, an event, a new product or price — end with ONE line in the exact form [[moment:KIND|short title, max 80 chars, concrete, in the owner's language|the specifics they gave (numbers, names, dates), max 160 chars, or empty]] where KIND is one of ${kinds.length ? kinds.join(", ") : "sales-spike, offer, vip, collab, launch, complaint, event, other"}. The app offers to save it to brand memory (what every other AI feature reads when writing scripts and planning). Only for things that actually happened to the brand — never for feelings, plans, wishes or questions, and never something already in the memory above.`,
    HANDOFF_RULE_COMPANION,
    "You may end with ONE follow-up question in the exact form [[ask:Question]], written the way this owner would ask it (short, casual). Only one, and only when a natural follow-up actually exists.",
    "Never invent numbers or events the owner didn't mention and that aren't in the context above. Never mention or explain the [[...]] lines.",
    // ---- DYNAMIC last.
    buildBrandContext(brand),
    pulseText || "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return callModel(ai, system, message, 350, { feature: "companion", history: chatTurns(history) });
}

// Turns a stretch of Teman chat into "moments" — the few brand-relevant,
// actionable things that happened (a sales spike, an offer, a VIP customer,
// a collab, a complaint…) as short structured items the owner then ticks
// before they enter brand memory (js/store.js addBrandMoments). Together
// with the per-message [[moment:…]] line above, this is how raw chat
// becomes something other AI features can read, so it's told to leave
// personal venting and anything not about the brand out entirely. Returns
// { summary, moments: [{ kind, title, detail, action }] } — the caller
// validates kinds/lengths (js/brand-memory.js validateRecap).
export async function recapCompanion(ai, { brand, pulseText = "", messages = [], today, kinds = [], actions = [] }) {
  const system = [
    "You read a short chat between a small-business brand owner and their AI companion, and extract the brand-relevant moments worth remembering as short structured notes.",
    outputLanguageRule(),
    buildBrandContext(brand),
    pulseText ? `Already in the brand's memory (do NOT repeat these as new moments):\n${pulseText}` : "",
    `Today is ${today}.`,
    "A moment is something that happened to THIS BRAND that could shape what content or campaign comes next: unusually high or low sales, an offer or proposal received, a notable or VIP customer, a collaboration, a launch, a complaint or problem, an event. Only include things the owner actually said — never infer or invent.",
    "Leave out entirely: personal feelings, venting, private or family matters, health, anything not about the brand, and the companion's own replies. If the owner said nothing brand-relevant, return an empty moments list.",
    `Respond with ONLY a JSON object: {"summary": "one warm sentence in the owner's language recapping what they shared", "moments": [{"kind": one of ${kinds.map((k) => `"${k}"`).join(", ")}, "title": "max 80 chars, concrete, in the owner's language", "detail": "max 160 chars: the specifics the owner gave (numbers, names, dates) or empty string", "action": null or one of ${actions.map((a) => `"${a}"`).join(", ")} — "content" when it's worth making a post about, "brainstorm" when it needs thinking through (an offer, a collab, a launch), "sales" when it's about sales numbers}]}`,
    "At most 6 moments. No markdown, no commentary outside the JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = messages.map((m) => `${m.role === "user" ? "Owner" : "Companion"}: ${m.text}`).join("\n\n");
  const raw = await callModel(ai, system, `Chat to recap:\n\n${transcript}`, 700, { json: true, feature: "recap" });
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj !== "object") throw new AiApiError(t("ai.error.unreadable"));
  return { summary: String(obj.summary || "").trim(), moments: Array.isArray(obj.moments) ? obj.moments : [] };
}

// The Brainstorm partner (js/consultant-panel.js) — a short chat first, ideas
// second. It asks what kind of content the owner wants (one question at a
// time, each with tap-to-answer buttons [[ask:…]]) and only shows option
// cards ([[idea:…]]) once the owner has answered — or pressed "Langsung kasih
// ide", which is the "ideas" mode. `turns` counts the owner's messages so far.
// `onText` streams the reply as it is written. The brand, its campaigns and
// its pulse ride along through buildFullContext, plus whatever the thread is
// scoped to.
export async function chatBrainstorm(ai, { brand, campaigns = [], pulseText = "", campaign = null, stageText = "", content = null, goalId = null, eventCampaign = null, series = null, seriesEpisodes = [], seriesOverview = "", savedIdeas = [], history = [], message, mode = "chat", turns = 1, onText = null }) {
  const goal = goalId ? (brand?.goals || []).find((g) => g.id === goalId) : null;
  const scope = [
    goal ? `This conversation is about ONE goal the owner is working toward — help them think about how to get there:\n${goalLine(goal)}\nYou cannot change the roadmap yourself. When something should change (the date, the weekly posting rhythm, the expected attendance), say exactly what and why, and tell the owner to use "Re-plot" on the roadmap page. Never say the plan has been changed.` : "",
    eventCampaign ? `EVENT the owner is preparing (its phases; use these exact phase names when you file a step under a phase):\n${campaignSummaryLine(eventCampaign, brand)}\nPhases: ${(eventCampaign.eventPlan?.phases || []).map((p) => `${p.name} (${p.dateFrom}..${p.dateTo})`).join("; ")}\nMilestones already in it (never suggest these again): ${(eventCampaign.eventPlan?.phases || []).flatMap((p) => (p.milestones || []).map((m) => m.label)).slice(0, 40).join("; ")}` : "",
    campaign ? `This conversation is about ONE campaign of the brand:\n${campaignSummaryLine(campaign, brand)}${stageText ? `\nCurrent focus: ${stageText}` : ""}` : "",
    content ? `This conversation is about ONE piece of content the owner is working on: title="${content.title || "(untitled)"}", funnel=${content.funnel || "?"}, format=${content.format || "?"}, platform=${content.platform || "?"}${content.idea ? `, current idea note: "${content.idea}"` : ""}.` : "",
    series
      ? `This conversation is about a NEW EPISODE of the owner's recurring series "${series.name}" — every idea/draft you propose must be a fresh episode of it, consistent with the series' saved concept/tone/structure below, not a generic idea:\n${buildSeriesContext(series, { episodes: seriesEpisodes })}`
      : seriesOverview,
    savedIdeas.length ? `Ideas already shown or saved in this conversation (never repeat them):\n${savedIdeas.map((i) => `- ${i}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  // Talk first, ideas second. The AI asks what the owner wants (with tap-to-
  // answer buttons, [[ask:…]]) and only puts option cards on the table once
  // the owner has answered — or pressed "Langsung kasih ide", which is the
  // "ideas" mode below. `turns` = how many messages the owner has sent in
  // this thread, this one included.
  const rules = mode === "plot"
    ? [
        "The owner just dumped their raw scratch notes (Coretan) into the chat: unordered, half-formed, maybe contradictory. Your job is to MAP them, not to judge each one.",
        "Reply in this shape: (1) one or two sentences starting like 'Jadi maumu…' that sum up what they seem to be after, in plain words; (2) a numbered list of the better flow or order — for a campaign, the phases/steps in sequence — each line saying which notes it groups and why it comes at that point; (3) what's missing, overlapping or contradictory, briefly; (4) at most 2 questions that would sharpen it.",
        "Use their notes, the brand data and (when scoped) the campaign above. Don't drop a note silently: if one doesn't fit, say so. Never invent numbers or facts.",
        "Only if a concrete content idea clearly falls out of it, add up to 3 [[idea:Short title (max 8 words)|why + first step, max 22 words]] lines. End with 2-3 [[ask:…]] lines (max 5 words each) of next steps, e.g. 'Rapikan jadi rencana', 'Fokus ke langkah 1'.",
      ]
    : mode === "ideas"
    ? [
        "The owner pressed the button to get ideas NOW, so the questions are over. Use everything said in the conversation so far, and the brand data above to fill any gap. Open with ONE short sentence (max 15 words), then exactly 3 concrete suggestions, each as its own line in the exact form [[idea:Short title (max 8 words)|why it fits THIS brand + the first step, one sentence, max 22 words]] (when an event is being prepared, an offline step may be a [[task:…]] line instead and counts as one of the 3). The 3 must take clearly different angles. End with 2 [[ask:…]] lines of next steps (max 5 words each, plain words, no marketing jargon such as TOFU/MOFU/BOFU or funnel), such as 'Bikinin script yang pertama'.",
      ]
    : [
        // Value first. The old version ("you ask, they answer, then you
        // propose") opened most replies with a question, and owners felt the
        // chat went round in circles before it gave them anything.
        "Every reply moves the work forward with something concrete — an idea, a draft, a direct answer, a decision. Never a reply that only asks questions.",
        "If the request is vague, don't interrogate: make the most sensible assumption from the brand data, name it in a few words (e.g. 'Aku anggap buat mahasiswa yang nugas malam —'), and deliver. They will correct you if it's off.",
        "Ask at most ONE question per reply, only at the end, and only when the answer would really change the next step. Never ask something the conversation already answered.",
        "When they want ideas or ask what to post: one short sentence, then exactly 3 ideas as [[idea:Short title (max 8 words)|why it fits THIS brand + the first step, one sentence, max 22 words]] lines, each a clearly different angle (offline steps for an event may be [[task:…]] lines instead). Never ideas only as prose. Otherwise write [[idea:…]] lines only when the conversation has clearly landed on something concrete.",
        "When they pick one ('yang kedua', 'oke itu'): go straight to the next useful thing — the script if it's a video, the post copy if it's a post, the first concrete steps if it's an activity — instead of confirming the choice again.",
        "When they ask to change something you wrote (shorter, a punchier hook, more casual): apply it at once, give the full new version, and say in one line what changed.",
        // "Bedah marketing X" used to get two short paragraphs (or worse, the
        // Konsultan's 2-4 sentences): owners took their thinking to ChatGPT
        // and only came back to paste. Depth is now the default for a real
        // discussion, and every discussion ends one tap away from content.
        "DISCUSSION: when the owner wants to discuss, understand or break something down — another brand's marketing ('bedah marketing …'), a case, a trend, a strategy, an idea of their own — be the senior strategist friend they would otherwise ask ChatGPT: a real, substantive analysis with your own opinion, concrete examples, what is smart and what is weak, and what THIS brand can take from it. Make it easy to read on a phone: short '### ' headers or numbered points when it has parts, short paragraphs; 200-450 words when they want depth, a line or two for something simple. No recap at the end.",
        "Facts about other companies, people or events: state only what is widely documented and you are confident about; mark anything uncertain with 'kalau nggak salah' or '(perlu dicek)'; never invent numbers, quotes, dates or campaign results.",
        "A discussion is for making something: after a substantive answer, end with 2 [[ask:…]] next steps that turn it into content for THIS brand (e.g. 'Jadikan script Reels', 'Jadikan carousel 5 slide', 'Cari angle buat brand-ku'). When they say 'jadikan script/konten/carousel', write the [[script:…]] block from the strongest angle of the discussion right away.",
        "Push back when something is weak, and weigh trade-offs honestly.",
        "If they ask about their numbers, performance, schedule, campaign progress, or where something is in the app, answer briefly from the data above and end with the line [[handoff:consultant]] so they can dig in with the Konsultan. Only then.",
        "You may end with at most 2 [[ask:…]] lines: tap-to-send next steps (max 5 words each) in the owner's own words, plain language — never marketing jargon such as TOFU/MOFU/BOFU or funnel.",
        "When the owner says they like an idea or picks one but not that they'll make it now, confirm in one sentence, ask whether you should keep it for later, and add [[save:That idea's title|why it fits, one sentence]] — the app shows a 'save to saved ideas' button. When they say they will make it now, confirm in one sentence and add [[draft:FUNNEL|Content title]] (FUNNEL is exactly TOFU, MOFU or BOFU) instead. At most 2 of these per reply.",
        SCRIPT_DIRECTIVE_RULE,
        "Never repeat an idea that was already shown or saved, and never offer again one they turned down. Never mention or explain the [[...]] lines.",
      ];
  // buildFullContext's "Active campaigns" list would otherwise repeat the
  // exact campaign the `scope` block above already describes in full —
  // drop it (and a preparing event, same deal) from that list rather than
  // saying the same campaign twice in one prompt.
  const campaignsForContext = campaigns.filter((c) => c.id !== campaign?.id && c.id !== eventCampaign?.id);
  const system = [
    // ---- STATIC first (prefix-cache friendly) — brand/campaign/pulse and
    // the scope block (goal/campaign/content/series this thread is about)
    // are the parts that actually change turn to turn, so they go last.
    "You are the brand owner's creative partner inside their own planning tool: a sharp friend who already knows the brand. Warm, direct and generous with concrete material — you bring options and drafts, they pick, edit and decide.",
    outputLanguageRule(),
    mode === "ideas" ? MARKETING_FRAMEWORKS_CONTEXT : "",
    NATURAL_WRITING_CONTEXT,
    ...rules,
    eventCampaign
      ? "NOT EVERYTHING IS CONTENT. An event is mostly real-world work: recruiting people (alumni, speakers, volunteers), booking the venue, finding sponsors or partners, inviting guests, preparing materials, rehearsing. Those are STEPS, each written as its own line in the exact form [[task:Short action without the number (max 8 words)|why or how, one sentence|target number or empty|unit like 'alumni' or empty|phase name from the list above]] — e.g. [[task:Cari alumni untuk jadi pembicara|Mereka bisa cerita pengalaman belajar langsung.|6|alumni|Foundation]]. Content pieces to publish stay [[idea:…]] lines. One suggestion may produce both: the step 'find 6 alumni' and the content idea 'a short video from each alumnus'. Prefer steps whenever the thing to do happens offline. At most 3 [[task:…]] lines per reply."
      : "There is no event in preparation right now, so do not write [[task:…]] lines; use [[idea:…]] for everything.",
    "Ground everything in this brand's actual context and data; when the pulse says something is in motion (a post taking off, a sales dip), use it. Never invent numbers or events.",
    // ---- DYNAMIC last.
    buildFullContext(brand, { campaigns: campaignsForContext, pulseText }),
    scope,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Room for a full shoot-ready script + caption (SCRIPT_DIRECTIVE_RULE);
  // max_tokens is a ceiling, a normal short reply still stops early.
  return callModel(ai, system, message, mode === "ideas" ? 750 : mode === "plot" ? 1400 : 3200, { onText, feature: "brainstorm", history: chatTurns(history) });
}

// "Diskusi dengan AI" beside a script in Creator: a free chat that can see the
// piece being written (title, idea, format, funnel, script, caption) plus the
// brand. It answers, critiques and offers other angles, and asks first when
// it isn't clear what to change. A concrete rewrite comes wrapped in
// [[revise:script]]…[[/revise]] (or caption), which ai-directives.js turns
// into an "Apply" card — the model never edits anything itself.
export async function discussScript(ai, { brand, campaigns = [], pulseText = "", content, series = null, seriesEpisodes = [], history = [], message, onText = null }) {
  const isCarousel = (content?.format || "").toLowerCase().includes("carousel");
  const piece = [
    `Title: ${content?.title || "(untitled)"}`,
    `Funnel: ${content?.funnel || "?"} · Format: ${content?.format || "?"} · Platform: ${content?.platform || "?"}`,
    content?.idea ? `Idea note: ${content.idea}` : "",
    `CURRENT SCRIPT:\n${(content?.script || "").trim() || "(empty)"}`,
    `CURRENT CAPTION:\n${(content?.caption || "").trim() || "(empty)"}`,
  ].filter(Boolean).join("\n");
  const system = [
    // ---- STATIC first (prefix-cache friendly) — brand/series/the-piece
    // itself are what actually differ call to call, so they go last.
    "You are the brand owner's script partner inside their own planning tool: a sharp editor who already knows the brand. You are discussing ONE piece of content with them.",
    outputLanguageRule(),
    NATURAL_WRITING_CONTEXT,
    "Answer questions, critique honestly (say WHY something is weak, quoting the actual line), and propose other angles when asked. Be concrete about this script, not generic. Plain conversational text, short paragraphs, no headers.",
    // Value first: the old "ask ONE short question first" turned every
    // "kurang menarik" into a round of questions before anything changed.
    "When the owner asks for a change — even a vague one ('kurang menarik', 'bikin lebih seru', 'terserah kamu') — don't ask what they mean: pick the change most likely to help (usually a sharper hook, a faster middle, a clearer payoff or a single clear ask), make it, and say in one line what you changed and one other direction you could take. Ask first only when two readings would lead to opposite edits, and even then offer your best guess in the same reply.",
    `A concrete change always comes as the COMPLETE replacement text wrapped exactly like this: [[revise:script]]new full script[[/revise]] (or [[revise:caption]]new full caption[[/revise]]). ${isCarousel ? 'This is a carousel: write the script as "Slide 1", "Slide 2"… each on its own line followed by that slide\'s text.' : 'Write the script as beats, the same shape the app uses everywhere (upgrade an old "HOOK / ISI PEMBAHASAN" script to it when you rewrite): a header line per beat like "[0-3 dtk] HOOK", then "Visual:" (what to film), "Teks layar:" (short on-screen text, only when it helps) and "Narasi:" (the exact words) lines; the last beat is the CTA with one ask. In English replies the labels are "[0-3 s]", "Visual:", "On-screen text:", "Voice:".'} Put at most ONE revise block per reply, always the full text (never a fragment), and keep the words around it to a sentence or two. Never write a revise block for a mere question, and never mention or explain the [[...]] syntax.`,
    "End with at most 2 [[ask:…]] lines: quick next edits the owner might want, max 5 words each, in their words (e.g. 'Pendekin jadi 15 detik', 'Coba hook lawan arus', 'Lebih santai').",
    "Never invent numbers, prices, processes, policies or events that are not in the brand's context and data.",
    // ---- DYNAMIC last.
    buildFullContext(brand, { campaigns, pulseText }),
    series ? `This piece belongs to the recurring series "${series.name}"; keep to its concept, tone and structure:\n${buildSeriesContext(series, { episodes: seriesEpisodes })}` : "",
    `THE PIECE:\n${piece}`,
  ].filter(Boolean).join("\n\n");
  return callModel(ai, system, message, 1800, { onText, feature: "discuss", history: chatTurns(history) });
}

export { AiApiError };

// "Simpan diskusi ini jadi konsep" (Bank Konsep): turns a brainstorm chat into
// a title, angle, key-point notes and 2-3 candidate hooks. It's a system
// call, not something the owner typed a prompt for, so it doesn't count
// against their quota. The owner edits the result before it is saved.
export async function summarizeConcept(ai, { brand, messages = [], scopeText = "" }) {
  const system = [
    "You turn a brainstorm conversation between a brand owner and their AI partner into ONE content concept the owner can save and pick up later.",
    outputLanguageRule(),
    brand ? buildBrandContext(brand) : "",
    scopeText ? `The conversation was about: ${scopeText}` : "",
    "Use only what was actually discussed; never invent facts, numbers or events. Pick the direction the conversation landed on (or the strongest one if it did not land).",
    'Respond with ONLY a JSON object: {"title": "short concept title, max 8 words", "angle": "the angle in 1-2 sentences", "notes": "the key points to remember, 2-5 short lines separated by newlines", "hooks": ["hook 1", "hook 2", "hook 3"]}. Hooks are 1-sentence scroll-stoppers in the brand\'s voice.',
    NATURAL_WRITING_CONTEXT,
  ].filter(Boolean).join("\n\n");
  const transcript = messages.filter((m) => m.text).slice(-24).map((m) => `${m.role === "user" ? "Owner" : "Partner"}: ${m.text}`).join("\n\n");
  const raw = await callModel(ai, system, transcript, 700, { countUsage: false, json: true, feature: "concept" });
  const obj = parseJsonObject(raw);
  if (!obj || typeof obj !== "object") throw new AiApiError(t("ai.error.unreadable"));
  const clean = (v) => String(v || "").trim();
  return {
    title: clean(obj.title).slice(0, 140),
    angle: clean(obj.angle).slice(0, 400),
    notes: clean(Array.isArray(obj.notes) ? obj.notes.join("\n") : obj.notes).slice(0, 1200),
    hooks: (Array.isArray(obj.hooks) ? obj.hooks : []).map(clean).filter(Boolean).slice(0, 3),
  };
}


// Turns a brand owner's rough notes ("jual kopi susu, anak kuliah, kediri")
// into the business description every other AI feature reads as its base
// context (buildBrandContext). Adds nothing the notes don't say — an
// invented price or city here would leak into every later prompt.
export async function draftBusinessDescription(ai, { name = "", notes }) {
  const system = [
    "You turn a small-business owner's rough notes into a clear business description that other AI tools will use as background context about this brand.",
    "Write 3-5 plain sentences covering, where the notes give it: what they sell, who buys it, where they operate (city/online), price range, and what makes them different.",
    "Use ONLY facts present in the notes. Never invent prices, locations, years, numbers, awards, product names or customer types. If something isn't in the notes, leave it out.",
    outputLanguageRule(),
    "Plain words, no marketing hype, no emojis, no markdown, no preamble.",
    NATURAL_WRITING_CONTEXT,
  ].join("\n\n");
  const user = `${name ? `Brand name: ${name}\n` : ""}Owner's notes:\n${notes}`;
  const raw = await callModel(ai, system, user, 400, { feature: "dna" });
  return raw.trim();
}

// Reads a few sentences of how the brand actually talks and places them on
// the Tone of Voice spectrums used in Brand Guidelines (0 = left label,
// 100 = right label) so the bars can be set automatically.
export async function detectToneOfVoice(ai, { brand, text }) {
  const system = [
    "You analyze the writing style of a short sample written by a brand and score it on 4 spectrums, each an integer from 0 to 100.",
    "formal: 0 = very formal, 100 = very casual. language: 0 = very simple everyday words, 100 = complex or technical. character: 0 = serious, 100 = playful. emotion: 0 = reserved and calm, 100 = very expressive (exclamations, emojis, strong feelings).",
    "Judge only the style of the sample, not what the brand sells. 50 means balanced.",
    'Respond with ONLY a JSON object: {"formal": n, "language": n, "character": n, "emotion": n}',
    brand ? buildBrandContext(brand) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, `Sample:\n${text}`, 200, { json: true, feature: "dna" });
  const obj = parseJsonObject(raw);
  const out = {};
  for (const key of ["formal", "language", "character", "emotion"]) {
    const n = Number(obj?.[key]);
    if (!Number.isFinite(n)) throw new AiApiError(t("ai.error.unreadable"));
    out[key] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}
