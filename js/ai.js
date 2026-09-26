// AI text generation — called directly from the browser, no backend
// involved. Three providers, picked in Settings → AI:
//  - Anthropic (Claude): supports direct browser access via the
//    anthropic-dangerous-direct-browser-access header.
//  - Google (Gemini): its Generative Language API also allows direct
//    browser calls.
//  - DeepSeek: OpenAI-compatible chat completions API, also CORS-open for
//    direct browser calls.
// All three confirmed against the real APIs — a bad key gets a proper error
// response back, not a CORS failure — so any of them is safe to use with no
// server in between. The user's own key for whichever provider they pick is
// stored locally, same as every other integration in this app.
import { TONE_AXES, toneAxisLabel, toneExampleMessage, VISUAL_DIRECTIONS } from "./brandbook-data.js";
import { COPY_LENGTHS, COPY_REWRITES, copyFormatRules, formatByKey, goalByKey } from "./knowledge/copy-formats.js";
import { aiLimitReached, recordAiUsage, aiDailyLimit, aiQuotaPeriod } from "./ai-usage.js";
import { t, getLang } from "./i18n.js";
import { isAdmin, currentUid } from "./account.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEEPSEEK_API_BASE = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

class AiApiError extends Error {}

// Provider/setup failures. The Wepeka admin sees the real detail (which
// provider, the key, the status code) to fix it; everyone else gets the
// same problem in plain words — a customer can't add an API key (the AI
// panel in Settings is admin-only) and "Error dari Claude" means nothing
// to someone who only knows this app as Brandlab.
function aiSetupError(key, vars = {}) {
  return new AiApiError(isAdmin(currentUid()) ? t(key, vars) : t(`${key}.user`, vars));
}

// Shared by every provider call: a network failure, a non-JSON body, or an
// API error becomes an AiApiError whose message is already in the UI
// language (the provider's own error text, when it sends one, is kept as-is
// inside that message).
async function fetchJson(url, options, provider) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw aiSetupError("ai.error.network", { provider });
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw res.ok ? aiSetupError("ai.error.badResponse", { provider }) : aiSetupError("ai.error.requestFailed", { provider, status: res.status });
  }
  if (!res.ok || json?.error) {
    const message = json?.error?.message;
    throw message ? aiSetupError("ai.error.provider", { provider, message }) : aiSetupError("ai.error.requestFailed", { provider, status: res.status });
  }
  return json;
}

// The system prompts stay English instructions to the model; this one line
// tells it which language the text the owner actually reads must come back
// in — the app's UI language (js/i18n.js). `keepSourceLanguage` names the
// user's own text for functions that polish/rewrite it: that text's language
// wins only when it clearly differs from the UI language.
export function outputLanguageRule({ keepSourceLanguage = "" } = {}) {
  const lang = getLang() === "en" ? "natural, friendly US English" : "Indonesian (Bahasa Indonesia), casual-friendly and natural";
  const base = `OUTPUT LANGUAGE: write every piece of text meant for the user in ${lang}. JSON keys, fixed section labels, and codes specified elsewhere in these instructions stay exactly as given.`;
  return keepSourceLanguage ? `${base} Exception: if ${keepSourceLanguage} is clearly written in a different language, keep that language instead.` : base;
}

// One user turn for the Messages API: the screenshots first (so the model
// reads them before the question), then the text.
function claudeUserContent(userPrompt, images = []) {
  if (!images.length) return userPrompt;
  return [
    ...images.map((d) => { const m = d.match(/^data:([^;]+);base64,(.+)$/); return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null; }).filter(Boolean),
    { type: "text", text: userPrompt },
  ];
}

async function callClaude(apiKey, system, userPrompt, maxTokens, { temperature, images = [] } = {}) {
  const json = await fetchJson(ANTHROPIC_API_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      system,
      messages: [{ role: "user", content: claudeUserContent(userPrompt, images) }],
    }),
  }, "Claude");
  return json.content?.[0]?.text || "";
}

// Same request as callClaude, but streamed: onText(fullTextSoFar) fires as
// tokens arrive so a chat reply shows up word by word instead of after the
// whole answer is done. Errors are shaped exactly like fetchJson's.
async function callClaudeStream(apiKey, system, userPrompt, maxTokens, onText, { temperature, images = [] } = {}) {
  let res;
  try {
    res = await fetch(ANTHROPIC_API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, stream: true, ...(temperature !== undefined ? { temperature } : {}), system, messages: [{ role: "user", content: claudeUserContent(userPrompt, images) }] }),
    });
  } catch {
    throw aiSetupError("ai.error.network", { provider: "Claude" });
  }
  if (!res.ok || !res.body) {
    let message = "";
    try { message = (await res.json())?.error?.message || ""; } catch { /* not JSON */ }
    throw message ? aiSetupError("ai.error.provider", { provider: "Claude", message }) : aiSetupError("ai.error.requestFailed", { provider: "Claude", status: res.status });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        full += ev.delta.text;
        onText(full);
      } else if (ev.type === "error") {
        throw aiSetupError("ai.error.provider", { provider: "Claude", message: ev.error?.message || "" });
      }
    }
  }
  return full;
}

async function callGemini(apiKey, system, userPrompt, { temperature, images = [] } = {}) {
  const json = await fetchJson(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [...images.map(dataUrlToInlinePart).filter(Boolean), { text: userPrompt }] }],
      ...(temperature !== undefined ? { generationConfig: { temperature } } : {}),
    }),
  }, "Gemini");
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// `json` asks DeepSeek for its JSON output mode (the prompt must already say
// "JSON" somewhere, which every structured prompt in this file does) — the
// reply is then guaranteed to parse instead of occasionally arriving wrapped
// in prose or fences. `temperature` is the OpenAI-style knob (DeepSeek's
// default is 1.0, which is too loose for form-filling suggestions).
function deepSeekBody(system, userPrompt, maxTokens, { temperature, json = false, stream = false } = {}) {
  return {
    model: DEEPSEEK_MODEL,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(stream ? { stream: true } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
  };
}

async function callDeepSeek(apiKey, system, userPrompt, maxTokens, opts = {}) {
  const json = await fetchJson(DEEPSEEK_API_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(deepSeekBody(system, userPrompt, maxTokens, opts)),
  }, "DeepSeek");
  return json.choices?.[0]?.message?.content || "";
}

// DeepSeek streamed (OpenAI-style SSE: `data: {...}` lines, `data: [DONE]`
// at the end) — same contract as callClaudeStream: onText(fullTextSoFar)
// fires as tokens arrive, so a chat reply shows up word by word.
async function callDeepSeekStream(apiKey, system, userPrompt, maxTokens, onText, opts = {}) {
  let res;
  try {
    res = await fetch(DEEPSEEK_API_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(deepSeekBody(system, userPrompt, maxTokens, { ...opts, stream: true })),
    });
  } catch {
    throw aiSetupError("ai.error.network", { provider: "DeepSeek" });
  }
  if (!res.ok || !res.body) {
    let message = "";
    try { message = (await res.json())?.error?.message || ""; } catch { /* not JSON */ }
    throw message ? aiSetupError("ai.error.provider", { provider: "DeepSeek", message }) : aiSetupError("ai.error.requestFailed", { provider: "DeepSeek", status: res.status });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      const delta = ev.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onText(full);
      }
    }
  }
  return full;
}

// Which settings field holds the active key, per provider — the one place
// that maps provider -> field name so Settings and every "is AI usable
// right now" check elsewhere in the app stay in sync automatically.
const AI_KEY_FIELD = { anthropic: "anthropicApiKey", gemini: "geminiApiKey", deepseek: "deepseekApiKey" };

// Every view that shows/hides its AI buttons based on whether a key is
// configured for the currently-picked provider calls this instead of
// re-deriving the same provider -> key-field mapping inline.
export function hasAiKey(ai) {
  return !!ai[AI_KEY_FIELD[ai.provider] || "anthropicApiKey"];
}

// Claude and Gemini read screenshots; DeepSeek's chat model is text-only,
// so surfaces that take a photo fall back to OCR (js/ocr.js) there.
export function aiCanSeeImages(ai) {
  return hasAiKey(ai) && ai.provider !== "deepseek";
}

// Every text call funnels through here, so this is where the daily quota
// (js/ai-usage.js) is checked and counted: refused before the request when
// the cap is reached, counted once after a successful response. A failed
// request never counts.
// `temperature` / `json` are optional per-call hints (see deepSeekBody);
// `onText(soFar, { whole })` streams the answer where the provider can, and
// hands over the finished text in one piece (whole: true) where it can't —
// the caller decides whether to animate a reply that arrived all at once.
// `images`: data: URLs sent along with the prompt (Claude / Gemini only —
// DeepSeek refuses them with a clear error so the caller can OCR instead).
async function callModel(ai, system, userPrompt, maxTokens = 1024, { countUsage = true, onText = null, temperature, json = false, images = [] } = {}) {
  if (countUsage && aiLimitReached()) {
    const limit = aiDailyLimit();
    const period = aiQuotaPeriod();
    const key = limit === 0
      ? "ai.error.readonly"
      : period === "month" ? "ai.error.quotaMonth" : period === "total" ? "ai.error.quotaTotal" : "ai.error.quota";
    throw new AiApiError(t(key, { limit }));
  }
  let out;
  let streamed = false;
  if (ai.provider === "gemini") {
    if (!ai.geminiApiKey) throw aiSetupError("ai.error.noKey", { provider: "Gemini" });
    out = await callGemini(ai.geminiApiKey, system, userPrompt, { temperature, images });
  } else if (ai.provider === "deepseek") {
    if (!ai.deepseekApiKey) throw aiSetupError("ai.error.noKey", { provider: "DeepSeek" });
    if (images.length) throw aiSetupError("ai.error.noVision", { provider: "DeepSeek" });
    streamed = !!onText;
    out = onText
      ? await callDeepSeekStream(ai.deepseekApiKey, system, userPrompt, maxTokens, onText, { temperature, json })
      : await callDeepSeek(ai.deepseekApiKey, system, userPrompt, maxTokens, { temperature, json });
  } else {
    if (!ai.anthropicApiKey) throw aiSetupError("ai.error.noKey", { provider: "Anthropic" });
    streamed = !!onText;
    out = onText
      ? await callClaudeStream(ai.anthropicApiKey, system, userPrompt, maxTokens, onText, { temperature, images })
      : await callClaude(ai.anthropicApiKey, system, userPrompt, maxTokens, { temperature, images });
  }
  // Providers without streaming hand over the finished text in one piece.
  if (onText && !streamed && out) onText(out, { whole: true });
  if (countUsage) recordAiUsage();
  return out;
}

// ai: { provider: "anthropic" | "gemini" | "deepseek", anthropicApiKey, geminiApiKey, deepseekApiKey }
export async function testAiConnection(ai) {
  await callModel(ai, "Reply with exactly: OK", "ping", 5, { countUsage: false });
  return true;
}

// Generates hook variations, a full script (always in the fixed HOOK /
// ISI PEMBAHASAN format), and a caption. Takes the same structured
// questions the app's wizard asks up front — funnel stage (with its own
// follow-up: MOFU asks what to demonstrate, BOFU asks what's being sold),
// target duration, the video's goal, an optional pasted article for source
// material, and the brand's own voice guide — instead of one vague prompt,
// so the model has the same context a human writer would ask for.
// `only`: pass "hooks" | "script" | "caption" to regenerate just that one
// piece (e.g. the hook wasn't landing but the script was fine) instead of
// redoing all three every time — cheaper and doesn't disturb what the user
// already accepted. Omit for the original all-three-at-once behavior.
export async function generateScript(
  ai,
  { title, idea, platform, format, funnel, effort, brief, prompt, duration, goal, mofuGoal, bofuOffer, articleText, brandContext, seriesContext, campaignLine, only, hashtags = [] }
) {
  const wantsHooks = !only || only === "hooks";
  const wantsScript = !only || only === "script";
  const wantsCaption = !only || only === "caption";
  // #1: a Carousel is a stack of still slides, not a spoken video script —
  // ask the model for a slide array instead of forcing the HOOK/ISI
  // PEMBAHASAN shape onto something nobody narrates.
  const isCarousel = (format || "").toLowerCase().includes("carousel");
  const responseShape = [
    wantsHooks ? '"hooks": ["hook 1", "hook 2", "hook 3"]' : "",
    wantsScript
      ? isCarousel
        ? '"slides": [{"slideNumber": 1, "text": "..."}, {"slideNumber": 2, "text": "..."}]'
        : '"script": "HOOK\\n...\\n\\nISI PEMBAHASAN\\n..."'
      : "",
    wantsCaption
      ? hashtags.length
        ? `"caption": "a short caption for the post, ending with exactly these hashtags and no others: ${hashtags.join(" ")}"`
        : '"caption": "a short caption for the post, with 3-5 relevant hashtags"'
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  const system = [
    isCarousel ? "You are a short-form social media carousel writer." : "You are a short-form social video scriptwriter.",
    outputLanguageRule(),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    wantsScript
      ? isCarousel
        ? "Write the on-slide text for a carousel post as an array of slides, in \"slides\": one short, punchy block of text per slide (not spoken narration). Slide 1 is the cover/hook that stops the scroll, the middle slides each carry exactly one clear point, and the last slide closes with a takeaway or CTA. Use 5 to 8 slides unless the content clearly needs fewer or more."
        : [
            "The script MUST always use exactly this section format, with these two Indonesian labels in capitals, nothing else:",
            "HOOK",
            "(1-2 sentences that stop the scroll)",
            "",
            "ISI PEMBAHASAN",
            "(the main content, delivered in the brand's voice)",
          ].join("\n")
      : "",
    only === "hooks" ? "Only write hooks (the opening 1-2 sentences that stop the scroll) — no full script, no caption." : "",
    only === "caption" ? "Only write a caption — no hooks, no script." : "",
    brandContext
      ? `Brand context — write FOR this audience and IN this brand's voice. The tone-of-voice settings, personality traits, and words to avoid below are rules, not suggestions:\n${brandContext}`
      : "No specific brand voice was given — keep it natural and conversational.",
    // Series Context sits between Brand Context and the current topic: the
    // brand's own voice always wins on tone conflicts, the series just adds
    // its recurring concept/structure/hook style on top.
    seriesContext || "",
    "FACTS ARE FIXED: any number, price, opening hour, place name, or product name that appears in the brand context or the user's input must be repeated exactly as given (e.g. 'jam 1 malam' stays 'jam 1 malam', 'Rp15.000' stays 'Rp15.000') — never round, convert, or paraphrase them, and never invent new figures.",
    articleText && wantsScript ? "An article/reference text is provided below — pull the most relevant, attention-worthy points from it for ISI PEMBAHASAN instead of inventing unrelated content." : "",
    `Respond ONLY with valid JSON, no markdown code fences, exactly this shape: {${responseShape}}`,
  ]
    .filter(Boolean)
    .join("\n");

  const funnelLine = {
    TOFU: "Funnel stage: TOFU (awareness) — goal is to stop the scroll and be memorable, not to sell.",
    MOFU: `Funnel stage: MOFU (consideration) — the video should demonstrate/show: ${mofuGoal || "(not specified — infer something reasonable)"}.`,
    BOFU: `Funnel stage: BOFU (conversion) — the video should sell/push toward: ${bofuOffer || "(not specified — infer something reasonable)"}.`,
  }[funnel || "TOFU"];
  // #5: production effort is independent of funnel stage — a TOFU idea can
  // still be asked for as an "agak niat" bigger production, and a BOFU pitch
  // can still be asked for as a single quick take.
  const effortLine =
    effort === "involved"
      ? "Execution effort: this can be a more involved production — multiple shots/angles, a location change, props, or a short narrative are all fine if they serve the content."
      : "Execution effort: keep this extremely easy to execute — something one person can shoot in a single take with no special props, crew, or editing, and post within minutes.";

  const user = [
    `Platform: ${platform || "Instagram"}`,
    `Format: ${format || "Reels"}`,
    funnelLine,
    effortLine,
    duration ? `Target duration: ${duration}` : "",
    goal ? `Goal of this specific video: ${goal}` : "",
    campaignLine ? `This piece belongs to campaign: ${campaignLine}` : "",
    title ? `Title: ${title}` : "",
    idea ? `Idea so far: ${idea}` : "",
    prompt ? `What this content should be about: ${prompt}` : "",
    !title && !idea && !prompt ? "No title, idea, or description given — infer something reasonable and generic for this brand/platform/format." : "",
    // #5: a free-text brief from the "discuss with AI" field — audience
    // size, budget, or any other context the user typed — the generated
    // content should follow this closely, as if a creative brief.
    brief ? `\n--- Creative brief from the user (follow this closely) ---\n${brief.slice(0, 3000)}` : "",
    articleText ? `\n--- Reference article/text ---\n${articleText.slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callModel(ai, system, user, 1600);
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    const slides = isCarousel && Array.isArray(parsed.slides)
      ? parsed.slides.map((s, i) => ({ slideNumber: Number(s?.slideNumber) || i + 1, text: String(s?.text || "").trim() })).filter((s) => s.text)
      : [];
    // `script` still carries a flat string too — everywhere else in the app
    // (content.script field, teleprompter, PDF export) reads one script
    // string, so a carousel's slides are joined into the same shape while
    // `slides` (used by the Creator Studio result view) keeps them separate.
    const script = slides.length ? slides.map((s) => `Slide ${s.slideNumber}\n${s.text}`).join("\n\n") : parsed.script || "";
    return { hooks: parsed.hooks || [], script, caption: parsed.caption || "", slides };
  } catch {
    // Model didn't return clean JSON — show the raw text as the script
    // rather than losing the generation entirely.
    return { hooks: [], script: raw, caption: "", slides: [] };
  }
}

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

  const raw = await callModel(ai, system, user, format === "threads" && threadMode === "chain" ? 3500 : 1800);
  const variants = (parseJsonObject(raw)?.variants || []).map(normalizeCopyVariant).filter(Boolean);
  if (variants.length) return { variants };
  if (!raw.trim()) throw new AiApiError(t("ai.error.emptyResponse"));
  // Model didn't return clean JSON — keep the text rather than losing it.
  return { variants: [{ parts: [raw.trim()], note: "" }] };
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
  const variant = normalizeCopyVariant(parseJsonObject(await callModel(ai, system, user, 2500)));
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
    .map((it) => `id=${it.id} | funnel=${it.funnel || "TOFU"} | stage=${it.status} (readiness ${readiness[it.status] ?? 5}, lower=more ready)${it.campaignPhase ? ` | campaign phase=${it.campaignPhase}` : ""} | title=${it.title || "Untitled"}`)
    .join("\n");

  const raw = await callModel(ai, system, user, 2000);
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    const map = new Map();
    (parsed.schedule || []).forEach((row) => {
      if (row?.id && row?.date) map.set(row.id, row.date);
    });
    return rebalanceWeeklyFunnelMix(map, items, startDate);
  } catch {
    throw new AiApiError(t("ai.error.readSchedule"));
  }
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
  const raw = await callModel(ai, system, user, 10);
  const match = raw.toUpperCase().match(/TOFU|MOFU|BOFU/);
  if (!match) throw new AiApiError(t("ai.error.funnel"));
  return match[0];
}

// Turns a data: URL (e.g. a brand's logo, already stored that way from the
// avatar/logo upload flow) into the inline-image part shape Gemini expects.
function dataUrlToInlinePart(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
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
    brand.aiVoiceGuide ? `Voice & tone guide: ${brand.aiVoiceGuide}` : "",
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
  // what the user already decided, without each caller having to know about `campaign.ideas`.
  const ideas = c.ideas?.length ? ` | captured ideas: ${c.ideas.slice(0, 10).map((i) => i.text).join("; ")}` : "";
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
export function buildSeriesContext(series) {
  if (!series) return "";
  const dna = series.dna || {};
  const lines = [
    `Series: ${series.name}`,
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
  ].filter(Boolean);
  if (!lines.length) return "";
  return [
    `This piece is an episode of the recurring series "${series.name}" — stay consistent with the series concept and style below, but write a genuinely new episode: never reuse the same hook or CTA wording verbatim, and don't make it feel copy-pasted or templated.`,
    lines.join("\n"),
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
    outputLanguageRule(),
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

  const raw = await callModel(ai, system, user, 600);
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    const campaign = campaigns.find((c) => c.id === parsed.campaignId);
    const phaseValid = campaign?.phases?.some((p) => p.id === parsed.phaseId);
    return {
      campaignId: campaign ? campaign.id : null,
      phaseId: phaseValid ? parsed.phaseId : null,
      angle: parsed.angle || "",
      rationale: parsed.rationale || "",
    };
  } catch {
    throw new AiApiError(t("ai.error.readCampaignFit"));
  }
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
    outputLanguageRule({ keepSourceLanguage: "their draft answer" }),
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
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    if (!note && typeof parsed.note === "string") note = parsed.note.trim();
    return Array.isArray(parsed.options) ? parsed.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim()) : [];
  };
  // Low-ish temperature: this is form-filling, not brainstorming — the
  // options should stay on the owner's own idea instead of drifting.
  const callOpts = { temperature: 0.6, json: true };
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
    outputLanguageRule(),
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

  const parsed = parseJsonObject(await callModel(ai, system, user, 1600, { temperature: 0.6, json: true }));
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
    outputLanguageRule(),
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

  const raw = await callModel(ai, system, user, 200);
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
    outputLanguageRule(),
    'Respond ONLY with valid JSON, no markdown fences: {"ideas": [{"text": "...", "description": "..."}, ...]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, "Suggest the ideas now.", 1400);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      ideas: (parsed.ideas || [])
        .map((i) => ({ text: String(i.text || "").trim(), description: String(i.description || "").trim() }))
        .filter((i) => i.text)
        .slice(0, 4),
    };
  } catch {
    throw new AiApiError(t("ai.error.readIdeas"));
  }
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
    outputLanguageRule(),
    'Respond ONLY with valid JSON, no markdown fences: {"concept": {"title": "...", "summary": "...", "howToRun": ["...", "..."]}, "levels": [{"index": 0, "activities": [{"title": "...", "how": "...", "type": "..."}]}]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await callModel(ai, system, "Write the plan now.", 2600, { countUsage: !free });
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const c = parsed.concept || {};
    return {
      concept: { title: String(c.title || ""), summary: String(c.summary || ""), howToRun: (c.howToRun || []).map(String).slice(0, 8) },
      levels: (parsed.levels || []).map((l) => ({
        index: Number(l.index) || 0,
        activities: (l.activities || []).slice(0, 4).map((a) => ({ title: String(a.title || ""), how: String(a.how || ""), type: String(a.type || "") })).filter((a) => a.title),
      })),
    };
  } catch {
    throw new AiApiError(t("ai.error.readIdeas"));
  }
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
    outputLanguageRule(),
    'Respond ONLY with valid JSON, no markdown fences: {"ideas": [{"title": "...", "angle": "1-2 sentences", "format": "e.g. Reels, Carousel, Story"}, ...]}',
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Suggest the ideas now.", 700);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return (parsed.ideas || []).slice(0, 3).map((i) => ({ title: i.title || "", angle: i.angle || "", format: i.format || "" }));
  } catch {
    throw new AiApiError(t("ai.error.readIdeas"));
  }
}

// Once a month the app (js/main.js → js/brand-learning.js) turns last
// month's post numbers into 2–4 plain lessons that stay in the brand's
// memory for good. Started by the app, so free for the owner.
export async function summarizeMonthLessons(ai, { brand, month, rows }) {
  const system = [
    "You read one month of a small brand's own post numbers and write the 2-4 lessons worth remembering for next month's content.",
    outputLanguageRule(),
    `Brand: ${brand?.name || ""}.`,
    "Each lesson is ONE short sentence built on a comparison the numbers actually show (a format vs the others, a funnel stage, a hook style, a topic) with the figure in it — e.g. 'Reels edukasi rata-rata 2x views dibanding foto produk (3.100 vs 1.400).' Never generic advice, never a number that isn't in the data, and skip anything the data is too thin to show.",
    'Respond ONLY with valid JSON, no markdown fences: {"lessons":["...","..."]}',
  ].join("\n\n");
  const table = rows.map((r) => `- "${r.title}" | ${r.format || "?"} | ${r.funnel || "?"} | views ${r.views ?? "?"} | ER ${r.er === null || r.er === undefined ? "?" : Number(r.er).toFixed(1) + "%"}${r.hook ? ` | hook: ${r.hook}` : ""}`).join("\n");
  const raw = await callModel(ai, system, `Month ${month}, posts:\n${table}`, 500, { countUsage: false });
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
  const raw = await callModel(ai, system, "Suggest them now.", 300);
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
    outputLanguageRule(),
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
  const raw = await callModel(ai, system, "Write the plan now.", Math.min(4000, 400 + total * 110));
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
    outputLanguageRule(),
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    NATURAL_WRITING_CONTEXT,
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"pillars": [{"title": "...", "desc": "..."}]} — exactly 3 items.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Write the 3 value proposition pillars now.", 500);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const pillars = Array.isArray(parsed.pillars) ? parsed.pillars.filter((p) => p?.title && p?.desc) : [];
    if (!pillars.length) throw new Error("empty");
    return pillars.slice(0, 3);
  } catch {
    throw new AiApiError(t("ai.error.readValueProp"));
  }
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
    outputLanguageRule(),
    NATURAL_WRITING_CONTEXT,
    buildBrandContext(brand),
    `Colors — primary: ${colors.primary}, secondary: ${colors.secondary || colors.primary}, accent: ${colors.accent || colors.primary}.`,
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"primary": "...", "secondary": "...", "accent": "..."}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Write the colour essence sentences now.", 400);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.primary) throw new Error("empty");
    return { primary: parsed.primary, secondary: parsed.secondary || "", accent: parsed.accent || "" };
  } catch {
    throw new AiApiError(t("ai.error.readColorEssence"));
  }
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
  const raw = await callModel(ai, system, "Read this screenshot.", 900, { images: [dataUrl] });
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
    "You are a practical branding & marketing consultant embedded inside this brand's own tool.",
    outputLanguageRule(),
    "Answer the user's LATEST message and nothing else, reading it in the light of the conversation so far (a short follow-up refers to what was just discussed). The brand data below is background: use only the parts that answer this question. Do not bring up other campaigns, numbers, streaks or problems the user didn't ask about — no 'the rest can wait, but…' add-ons. Only when they ask what to do first or what's most urgent, name the top one or two things.",
    "You give specific, actionable advice grounded in THIS brand's actual context and data below — never generic marketing platitudes. When the brand's tracked data below is relevant to the question, cite the actual numbers (e.g. 'ada 3 konten overdue', 'engagement rate rata-rata 2.1%') instead of speaking abstractly.",
    buildBrandContext(brand),
    pulseText || "",
    MARKETING_FRAMEWORKS_CONTEXT,
    RETENTION_SPECIALIST_CONTEXT,
    NATURAL_WRITING_CONTEXT,
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
    "Keep it short: lead with the answer in 2-4 sentences, or at most 3 short bullets when listing steps. No preamble, no recap at the end. Apply the marketing/branding thinking above naturally; never quote or name-drop the source books to the user.",
    `If the user's message itself tells something that HAPPENED to the brand (a sale or a change in sales, an offer, a notable customer, a collab, a launch, a complaint, an event, a new product or price) that is not already in the brand context above, answer as usual and add ONE line [[moment:KIND|short title, max 80 chars, in the user's language|the specifics they gave, max 160 chars, or empty]] with KIND one of ${kinds.length ? kinds.join(", ") : "sales-spike, offer, vip, collab, launch, complaint, event, other"} — the app asks them whether to save it to brand memory. Never for questions, plans or feelings.`,
    "You advise; you do not write content. If the user asks you to come up with content ideas, topics, hooks or angles, do NOT list them — answer in one sentence that says what kind of content the data points to, then end with the line [[handoff:brainstorm]] (the app turns it into a button that asks the Brainstorm tab, which saves ideas and makes drafts). If the user is only venting or telling how they feel with no question in it, reply in one warm sentence and end with [[handoff:companion]]. Never both, and never for an actual question about the brand.",
    `When your answer tells the user to go do something in a specific screen of this app, or they ask where a screen is, end with ONE line for the single most relevant screen, in the exact form [[goto:KEY]] using ONLY these keys: ${routesList}. To point at ONE specific campaign from the live data above, use [[goto:campaign:ID]] with that campaign's exact id instead — only a campaign your answer names, never another one. Use [[open:insights]] only when the answer is about refreshing Instagram profile numbers. At most one of these per reply, on its own line at the very end, and none when the answer doesn't send them anywhere.`,
    "When there is an obvious next question, end with at most 2 follow-ups, each on its own line in the exact form [[ask:Question]] — written the way THIS user would ask it (their language, short, max ~8 words), answerable from this brand's context and data above. The app turns each into a button. Skip them when the answer is complete on its own. Never repeat a question already asked in this conversation, and never mention or explain these lines.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const transcript = history.map((h) => `${h.role === "user" ? "User" : "Consultant"}: ${h.text}`).join("\n\n");
  const user = [transcript, `User: ${question}`].filter(Boolean).join("\n\n");

  return callModel(ai, system, user, hasPhoto ? 1400 : 1000, { onText, images });
}

// "Otomatis" in "Tanya Brandlab" (js/consultant-panel.js): one box in front
// of the Consultant (askBrandConsultant), the Brainstorm partner
// (chatBrainstorm) and the Companion (companionChat). When the panel's own
// keyword rules can't tell which one a message is for, this asks the model —
// a one-word answer, ~5 tokens, never counted against the owner's AI
// credits (it isn't a feature, it's the receptionist).
export async function classifyChatIntent(ai, { message, lastEngine = "" }) {
  const last = { consultant: "data", brainstorm: "ideas", companion: "friend" }[lastEngine] || "";
  const system = [
    "You route ONE message from a small-business brand owner to the right assistant inside their brand tool. Reply with exactly one word and nothing else: data, ideas, or friend.",
    "data — they ask about their brand's numbers, performance, schedule, campaign progress, strategy, what to do first, how or where to do something in the app, or any question that wants a concrete, factual answer.",
    "ideas — they want content ideas, topics, angles, hooks, inspiration, or to think through what to make or post next.",
    "friend — they tell what happened today or in the business (a sale, a customer, an offer, a problem), vent, share how they feel, or want encouragement, without asking for anything.",
    last ? `The previous reply came from: ${last}. A short follow-up ("iya", "yang pertama", "ok lanjut", "kenapa?") usually belongs to the same assistant.` : "",
    "The message may be in Indonesian or English. If genuinely unsure, answer data.",
  ].filter(Boolean).join("\n");
  const raw = String(await callModel(ai, system, message, 5, { countUsage: false })).trim().toLowerCase();
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
  const raw = await callModel(ai, system, `Sales data:\n${snapshotText}`, 1400, { countUsage: !free });
  const parsed = parseJsonObject(raw);
  const actions = (parsed?.actions || [])
    .map((a) => ({ title: String(a?.title || "").trim(), why: String(a?.why || "").trim(), how: String(a?.how || "").trim() }))
    .filter((a) => a.title)
    .slice(0, 3);
  if (actions.length) return { summary: String(parsed.summary || "").trim(), actions };
  if (!raw.trim()) throw new AiApiError(t("ai.error.emptyResponse"));
  return { summary: raw.trim(), actions: [] };
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
    "You are this brand owner's thinking partner — warm and direct, like a friend who actually pays attention, never a corporate assistant and never a coach lecturing them.",
    outputLanguageRule(),
    buildBrandContext(brand),
    pulseText || "",
    "Reply to the owner's latest message in 2-3 short sentences, conversational, no bullet points, no headers. React to what they actually said. You may offer ONE concrete, specific suggestion if it clearly calls for one — never a generic pep talk.",
    "If they mention something personal or just vent, respond like a friend would (briefly, kindly) and don't turn it into marketing advice.",
    `If what they said is something that HAPPENED to this brand — a sale or a change in sales, an offer or proposal, a notable customer, a collab, a launch, a complaint or problem, an event, a new product or price — end with ONE line in the exact form [[moment:KIND|short title, max 80 chars, concrete, in the owner's language|the specifics they gave (numbers, names, dates), max 160 chars, or empty]] where KIND is one of ${kinds.length ? kinds.join(", ") : "sales-spike, offer, vip, collab, launch, complaint, event, other"}. The app offers to save it to brand memory (what every other AI feature reads when writing scripts and planning). Only for things that actually happened to the brand — never for feelings, plans, wishes or questions, and never something already in the memory above.`,
    "If they ask you for content ideas, topics or hooks, don't make them up here: say in one sentence that the Brainstorm tab does that and end with [[handoff:brainstorm]]. If they ask about their numbers, performance, schedule, strategy or how to do something in the app, say in one sentence that the Konsultan tab answers from the data and end with [[handoff:consultant]]. At most one handoff line, and only when they actually asked for that.",
    "You may end with ONE follow-up question in the exact form [[ask:Question]], written the way this owner would ask it (short, casual). Only one, and only when a natural follow-up actually exists.",
    "Never invent numbers or events the owner didn't mention and that aren't in the context above. Never mention or explain the [[...]] lines.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = history.map((h) => `${h.role === "user" ? "Owner" : "Friend"}: ${h.text}`).join("\n\n");
  const user = [transcript, `Owner: ${message}`].filter(Boolean).join("\n\n");
  return callModel(ai, system, user, 350);
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
  const raw = await callModel(ai, system, `Chat to recap:\n\n${transcript}`, 700);
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
export async function chatBrainstorm(ai, { brand, campaigns = [], pulseText = "", campaign = null, stageText = "", content = null, goalId = null, eventCampaign = null, series = null, savedIdeas = [], history = [], message, mode = "chat", turns = 1, onText = null }) {
  const goal = goalId ? (brand?.goals || []).find((g) => g.id === goalId) : null;
  const scope = [
    goal ? `This conversation is about ONE goal the owner is working toward — help them think about how to get there:\n${goalLine(goal)}\nYou cannot change the roadmap yourself. When something should change (the date, the weekly posting rhythm, the expected attendance), say exactly what and why, and tell the owner to use "Re-plot" on the roadmap page. Never say the plan has been changed.` : "",
    eventCampaign ? `EVENT the owner is preparing (its phases; use these exact phase names when you file a step under a phase):\n${campaignSummaryLine(eventCampaign, brand)}\nPhases: ${(eventCampaign.eventPlan?.phases || []).map((p) => `${p.name} (${p.dateFrom}..${p.dateTo})`).join("; ")}\nMilestones already in it (never suggest these again): ${(eventCampaign.eventPlan?.phases || []).flatMap((p) => (p.milestones || []).map((m) => m.label)).slice(0, 40).join("; ")}` : "",
    campaign ? `This conversation is about ONE campaign of the brand:\n${campaignSummaryLine(campaign, brand)}${stageText ? `\nCurrent focus: ${stageText}` : ""}` : "",
    content ? `This conversation is about ONE piece of content the owner is working on: title="${content.title || "(untitled)"}", funnel=${content.funnel || "?"}, format=${content.format || "?"}, platform=${content.platform || "?"}${content.idea ? `, current idea note: "${content.idea}"` : ""}.` : "",
    series
      ? `This conversation is about a NEW EPISODE of the owner's recurring series "${series.name}" — every idea/draft you propose must be a fresh episode of it, consistent with the series' saved concept/tone/structure below, not a generic idea:\n${buildSeriesContext(series)}`
      : "",
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
        "The owner pressed the button to get ideas NOW, so the questions are over. Use everything said in the conversation so far, and the brand data above to fill any gap. Open with ONE short sentence (max 15 words), then exactly 3 concrete suggestions, each as its own line in the exact form [[idea:Short title (max 8 words)|why it fits THIS brand + the first step, one sentence, max 22 words]] (when an event is being prepared, an offline step may be a [[task:…]] line instead and counts as one of the 3). The 3 must take clearly different angles. End with 2 [[ask:…]] lines of next steps (max 5 words each), such as 'Kembangkan yang pertama'.",
      ]
    : [
        "You are a real thinking partner, not a form to fill in. Answer whatever the owner asks directly, like a knowledgeable friend would: give your honest opinion, weigh angles and trade-offs, push back when something is weak. Length follows the question: a line or two for something simple, a few short paragraphs when they want to dig in. No headers.",
        "Ask a question only when the answer would truly change what you say, never as a reflex, and never more than one per reply.",
        "If the owner asks about their numbers, performance, schedule, campaign progress, or where something is in the app, answer briefly from the data above and end with the line [[handoff:consultant]] so they can dig into it in the Konsultan tab. Only then.",
        "Only write [[idea:Short title (max 8 words)|why it fits THIS brand + the first step, one sentence, max 22 words]] lines when the owner asks for ideas, or when the conversation has clearly landed on something concrete (max 3, clearly different angles; offline steps for an event may be [[task:…]] lines instead). Otherwise write none.",
        "You may end with at most 2 [[ask:…]] lines: short tap-to-answer follow-ups (max 5 words each) written the way the owner would say them, specific to THIS brand.",
        "When the owner says they like an idea or picks one but not that they'll make it now, confirm in one sentence, ask whether you should keep it for later, and add [[save:That idea's title|why it fits, one sentence]] — the app shows a 'save to saved ideas' button. When they say they will make it now, confirm in one sentence and add [[draft:FUNNEL|Content title]] (FUNNEL is exactly TOFU, MOFU or BOFU) instead. At most 2 of these per reply.",
        "Never repeat an idea that was already shown or saved. Never mention or explain the [[...]] lines.",
      ];
  const system = [
    "You are the brand owner's brainstorm partner inside their own planning tool: a sharp friend who already knows the brand. Short, warm, to the point — you ask, they answer, then you propose.",
    outputLanguageRule(),
    buildFullContext(brand, { campaigns, pulseText }),
    mode === "ideas" ? MARKETING_FRAMEWORKS_CONTEXT : "",
    NATURAL_WRITING_CONTEXT,
    scope,
    ...rules,
    eventCampaign
      ? "NOT EVERYTHING IS CONTENT. An event is mostly real-world work: recruiting people (alumni, speakers, volunteers), booking the venue, finding sponsors or partners, inviting guests, preparing materials, rehearsing. Those are STEPS, each written as its own line in the exact form [[task:Short action without the number (max 8 words)|why or how, one sentence|target number or empty|unit like 'alumni' or empty|phase name from the list above]] — e.g. [[task:Cari alumni untuk jadi pembicara|Mereka bisa cerita pengalaman belajar langsung.|6|alumni|Foundation]]. Content pieces to publish stay [[idea:…]] lines. One suggestion may produce both: the step 'find 6 alumni' and the content idea 'a short video from each alumnus'. Prefer steps whenever the thing to do happens offline. At most 3 [[task:…]] lines per reply."
      : "There is no event in preparation right now, so do not write [[task:…]] lines; use [[idea:…]] for everything.",
    "Ground everything in this brand's actual context and data above; when the pulse says something is in motion (a post taking off, a sales dip), use it. Never invent numbers or events.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = history.map((h) => `${h.role === "user" ? "Owner" : "Partner"}: ${h.text}`).join("\n\n");
  const user = [transcript, `Owner: ${message}`].filter(Boolean).join("\n\n");
  return callModel(ai, system, user, mode === "ideas" ? 750 : mode === "plot" ? 1400 : 700, { onText });
}

// "Diskusi dengan AI" beside a script in Creator: a free chat that can see the
// piece being written (title, idea, format, funnel, script, caption) plus the
// brand. It answers, critiques and offers other angles, and asks first when
// it isn't clear what to change. A concrete rewrite comes wrapped in
// [[revise:script]]…[[/revise]] (or caption), which ai-directives.js turns
// into an "Apply" card — the model never edits anything itself.
export async function discussScript(ai, { brand, campaigns = [], pulseText = "", content, series = null, history = [], message, onText = null }) {
  const isCarousel = (content?.format || "").toLowerCase().includes("carousel");
  const piece = [
    `Title: ${content?.title || "(untitled)"}`,
    `Funnel: ${content?.funnel || "?"} · Format: ${content?.format || "?"} · Platform: ${content?.platform || "?"}`,
    content?.idea ? `Idea note: ${content.idea}` : "",
    `CURRENT SCRIPT:\n${(content?.script || "").trim() || "(empty)"}`,
    `CURRENT CAPTION:\n${(content?.caption || "").trim() || "(empty)"}`,
  ].filter(Boolean).join("\n");
  const system = [
    "You are the brand owner's script partner inside their own planning tool: a sharp editor who already knows the brand. You are discussing ONE piece of content with them.",
    outputLanguageRule(),
    buildFullContext(brand, { campaigns, pulseText }),
    series ? `This piece belongs to the recurring series "${series.name}"; keep to its concept, tone and structure:\n${buildSeriesContext(series)}` : "",
    NATURAL_WRITING_CONTEXT,
    `THE PIECE:\n${piece}`,
    "Answer questions, critique honestly (say WHY something is weak, referring to the actual lines), and propose other angles when asked. Be concrete about this script, not generic. Plain conversational text, short paragraphs, no headers.",
    "If the owner's direction for a change is not clear yet (which part? more casual? shorter? which angle?), ask ONE short question first instead of rewriting.",
    `When you have something concrete to change, give the COMPLETE replacement text wrapped exactly like this: [[revise:script]]new full script[[/revise]] (or [[revise:caption]]new full caption[[/revise]]). ${isCarousel ? 'This is a carousel: write the script as "Slide 1", "Slide 2"… each on its own line followed by that slide\'s text.' : 'Keep the script in the fixed format: "HOOK", the 1-2 sentence hook, a blank line, "ISI PEMBAHASAN", the main content.'} Put at most ONE revise block per reply, always with the full text (never a fragment), and keep the words around it to a sentence or two about what changed. Never write a revise block for a mere question or critique, and never mention or explain the [[...]] syntax.`,
    "Never invent numbers, prices or events that are not in the context above.",
  ].filter(Boolean).join("\n\n");
  const transcript = history.map((h) => `${h.role === "user" ? "Owner" : "Partner"}: ${h.text}`).join("\n\n");
  const user = [transcript, `Owner: ${message}`].filter(Boolean).join("\n\n");
  return callModel(ai, system, user, 1500, { onText });
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
  const raw = await callModel(ai, system, transcript, 700, { countUsage: false });
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
  const raw = await callModel(ai, system, user, 400);
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
  const raw = await callModel(ai, system, `Sample:\n${text}`, 200);
  const obj = parseJsonObject(raw);
  const out = {};
  for (const key of ["formal", "language", "character", "emotion"]) {
    const n = Number(obj?.[key]);
    if (!Number.isFinite(n)) throw new AiApiError(t("ai.error.unreadable"));
    out[key] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}
