// AI text generation — called directly from the browser, no backend
// involved. Two providers, picked in Settings → AI:
//  - Anthropic (Claude): supports direct browser access via the
//    anthropic-dangerous-direct-browser-access header.
//  - Google (Gemini): its Generative Language API also allows direct
//    browser calls.
// Both confirmed against the real APIs — a bad key gets a proper error
// response back, not a CORS failure — so either is safe to use with no
// server in between. The user's own key for whichever provider they pick is
// stored locally, same as every other integration in this app.
const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

class AiApiError extends Error {}

async function callClaude(apiKey, system, userPrompt, maxTokens) {
  const res = await fetch(ANTHROPIC_API_BASE, {
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
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new AiApiError(json.error?.message || `Claude API request failed (${res.status}).`);
  }
  return json.content?.[0]?.text || "";
}

async function callGemini(apiKey, system, userPrompt) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userPrompt }] }],
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new AiApiError(json.error?.message || `Gemini API request failed (${res.status}).`);
  }
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callModel(ai, system, userPrompt, maxTokens = 1024) {
  if (ai.provider === "gemini") {
    if (!ai.geminiApiKey) throw new AiApiError("No Gemini API key set.");
    return callGemini(ai.geminiApiKey, system, userPrompt);
  }
  if (!ai.anthropicApiKey) throw new AiApiError("No Anthropic API key set.");
  return callClaude(ai.anthropicApiKey, system, userPrompt, maxTokens);
}

// ai: { provider: "anthropic" | "gemini", anthropicApiKey, geminiApiKey }
export async function testAiConnection(ai) {
  await callModel(ai, "Reply with exactly: OK", "ping", 5);
  return true;
}

// Generates hook variations, a full script (always in the fixed HOOK /
// ISI PEMBAHASAN format), and a caption. Takes the same structured
// questions the app's wizard asks up front — funnel stage (with its own
// follow-up: MOFU asks what to demonstrate, BOFU asks what's being sold),
// target duration, the video's goal, an optional pasted article for source
// material, and the brand's own voice guide — instead of one vague prompt,
// so the model has the same context a human writer would ask for.
export async function generateScript(
  ai,
  { title, idea, platform, format, funnel, prompt, duration, goal, mofuGoal, bofuOffer, articleText, brandGuidelines }
) {
  const system = [
    "You are a short-form social video scriptwriter. Match the language of the user's input (Indonesian or English).",
    "The script MUST always use exactly this section format, with these two Indonesian labels in capitals, nothing else:",
    "HOOK",
    "(1-2 sentences that stop the scroll)",
    "",
    "ISI PEMBAHASAN",
    "(the main content, delivered in the brand's voice)",
    brandGuidelines
      ? `Brand voice/style to follow strictly: ${brandGuidelines}`
      : "No specific brand voice was given — keep it natural and conversational.",
    articleText ? "An article/reference text is provided below — pull the most relevant, attention-worthy points from it for ISI PEMBAHASAN instead of inventing unrelated content." : "",
    'Respond ONLY with valid JSON, no markdown code fences, exactly this shape: {"hooks": ["hook 1", "hook 2", "hook 3"], "script": "HOOK\\n...\\n\\nISI PEMBAHASAN\\n...", "caption": "a short caption for the post, with 3-5 relevant hashtags"}',
  ]
    .filter(Boolean)
    .join("\n");

  const funnelLine = {
    TOFU: "Funnel stage: TOFU (awareness) — goal is to stop the scroll and be memorable, not to sell.",
    MOFU: `Funnel stage: MOFU (consideration) — the video should demonstrate/show: ${mofuGoal || "(not specified — infer something reasonable)"}.`,
    BOFU: `Funnel stage: BOFU (conversion) — the video should sell/push toward: ${bofuOffer || "(not specified — infer something reasonable)"}.`,
  }[funnel || "TOFU"];

  const user = [
    `Platform: ${platform || "Instagram"}`,
    `Format: ${format || "Reels"}`,
    funnelLine,
    duration ? `Target duration: ${duration}` : "",
    goal ? `Goal of this specific video: ${goal}` : "",
    title ? `Title: ${title}` : "",
    idea ? `Idea so far: ${idea}` : "",
    prompt ? `What this content should be about: ${prompt}` : "",
    !title && !idea && !prompt ? "No title, idea, or description given — infer something reasonable and generic for this brand/platform/format." : "",
    articleText ? `\n--- Reference article/text ---\n${articleText.slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callModel(ai, system, user, 1600);
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    return { hooks: parsed.hooks || [], script: parsed.script || "", caption: parsed.caption || "" };
  } catch {
    // Model didn't return clean JSON — show the raw text as the script
    // rather than losing the generation entirely.
    return { hooks: [], script: raw, caption: "" };
  }
}

// Spreads a batch of not-yet-scheduled content across the days ahead —
// avoids stacking the same funnel stage back-to-back where it can, leans on
// weekdays, and schedules whatever's closest to actually being ready
// (Editing/Ready to Upload) sooner than what's still being written or shot.
// routineNotes are the user's own free-text rules from "My Routine" (e.g.
// "upload daily", "MOFU on Tuesdays") — read as instructions, not decoration.
// items: [{ id, title, funnel, status }]. Returns a Map of id -> "YYYY-MM-DD";
// any id the model didn't return just stays unscheduled rather than guessing.
export async function suggestSchedule(ai, { items, startDate, daysAhead = 21, routineNotes = [] }) {
  if (!items.length) return new Map();
  const readiness = { editing: 1, scheduled: 0, production: 2, draft: 3, idea: 4 };
  const system = [
    "You are a social media content calendar planner.",
    `Distribute the given content items across the ${daysAhead} days starting ${startDate} (inclusive), one date per item, format YYYY-MM-DD.`,
    "Each item's stage tells you how close it is to actually being postable — schedule items closer to ready (already shot/edited) sooner than ones still being written or filmed, since those need more lead time.",
    "Prefer spreading items evenly rather than clustering on the same day. Avoid scheduling the same funnel stage (TOFU/MOFU/BOFU) on consecutive scheduled days where there's enough variety to avoid it.",
    routineNotes.length
      ? `The user's own stated scheduling rules/objectives (follow these as hard constraints where possible, e.g. specific days for specific funnel stages, daily posting, etc.):\n${routineNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
    'Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"schedule": [{"id": "...", "date": "YYYY-MM-DD"}, ...]} — one entry per item given, same ids.',
  ]
    .filter(Boolean)
    .join("\n");
  const user = items
    .map((it) => `id=${it.id} | funnel=${it.funnel || "TOFU"} | stage=${it.status} (readiness ${readiness[it.status] ?? 5}, lower=more ready) | title=${it.title || "Untitled"}`)
    .join("\n");

  const raw = await callModel(ai, system, user, 2000);
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned);
    const map = new Map();
    (parsed.schedule || []).forEach((row) => {
      if (row?.id && row?.date) map.set(row.id, row.date);
    });
    return map;
  } catch {
    throw new AiApiError("Couldn't read a schedule back from the AI response.");
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
  if (!match) throw new AiApiError("Couldn't determine a funnel stage from this.");
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

// Image generation is a separate, paid-only Gemini capability (confirmed
// against the real API: the free tier's quota for it is 0, unlike text
// generation which is free) — needs billing enabled on the same Google
// Cloud project the API key belongs to. Returns a data: URL ready to use
// directly as a thumbnail.
export async function generateThumbnail(ai, { title, idea, brandGuidelines, logoDataUrl }) {
  if (ai.provider !== "gemini") throw new AiApiError("Thumbnail generation currently needs the Gemini provider (Settings → AI).");
  if (!ai.geminiApiKey) throw new AiApiError("No Gemini API key set.");

  const prompt = [
    "Generate a single eye-catching vertical (9:16) thumbnail image for a short-form social video.",
    "No readable body text baked into the image except a short punchy title treatment if it fits naturally.",
    title ? `Video title: ${title}` : "",
    idea ? `Video is about: ${idea}` : "",
    brandGuidelines ? `Match this brand's visual/voice style: ${brandGuidelines}` : "",
    logoDataUrl ? "A reference logo/mascot image is attached — let its colors and character inform the thumbnail's style, without just pasting the logo flat onto the image." : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [{ text: prompt }];
  const logoPart = dataUrlToInlinePart(logoDataUrl);
  if (logoPart) parts.push(logoPart);

  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(ai.geminiApiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  const json = await res.json();
  // eslint-disable-next-line no-console
  console.log("[AI] generateThumbnail →", JSON.stringify(json).slice(0, 400));
  if (!res.ok || json.error) {
    throw new AiApiError(json.error?.message || `Gemini image request failed (${res.status}).`);
  }
  const responseParts = json.candidates?.[0]?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new AiApiError("Gemini didn't return an image for this request.");
  return `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
}

export { AiApiError };
