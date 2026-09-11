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
const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEEPSEEK_API_BASE = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

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

async function callDeepSeek(apiKey, system, userPrompt, maxTokens) {
  const res = await fetch(DEEPSEEK_API_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new AiApiError(json.error?.message || `DeepSeek API request failed (${res.status}).`);
  }
  return json.choices?.[0]?.message?.content || "";
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

async function callModel(ai, system, userPrompt, maxTokens = 1024) {
  if (ai.provider === "gemini") {
    if (!ai.geminiApiKey) throw new AiApiError("No Gemini API key set.");
    return callGemini(ai.geminiApiKey, system, userPrompt);
  }
  if (ai.provider === "deepseek") {
    if (!ai.deepseekApiKey) throw new AiApiError("No DeepSeek API key set.");
    return callDeepSeek(ai.deepseekApiKey, system, userPrompt, maxTokens);
  }
  if (!ai.anthropicApiKey) throw new AiApiError("No Anthropic API key set.");
  return callClaude(ai.anthropicApiKey, system, userPrompt, maxTokens);
}

// ai: { provider: "anthropic" | "gemini" | "deepseek", anthropicApiKey, geminiApiKey, deepseekApiKey }
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
// `only`: pass "hooks" | "script" | "caption" to regenerate just that one
// piece (e.g. the hook wasn't landing but the script was fine) instead of
// redoing all three every time — cheaper and doesn't disturb what the user
// already accepted. Omit for the original all-three-at-once behavior.
export async function generateScript(
  ai,
  { title, idea, platform, format, funnel, prompt, duration, goal, mofuGoal, bofuOffer, articleText, brandGuidelines, only }
) {
  const wantsHooks = !only || only === "hooks";
  const wantsScript = !only || only === "script";
  const wantsCaption = !only || only === "caption";
  const responseShape = [
    wantsHooks ? '"hooks": ["hook 1", "hook 2", "hook 3"]' : "",
    wantsScript ? '"script": "HOOK\\n...\\n\\nISI PEMBAHASAN\\n..."' : "",
    wantsCaption ? '"caption": "a short caption for the post, with 3-5 relevant hashtags"' : "",
  ]
    .filter(Boolean)
    .join(", ");
  const system = [
    "You are a short-form social video scriptwriter. Match the language of the user's input (Indonesian or English).",
    wantsScript
      ? [
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
    brandGuidelines
      ? `Brand voice/style to follow strictly: ${brandGuidelines}`
      : "No specific brand voice was given — keep it natural and conversational.",
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
export async function suggestSchedule(ai, { items, startDate, daysAhead = 21, routineNotes = [], brand, campaigns = [] }) {
  if (!items.length) return new Map();
  const readiness = { editing: 1, scheduled: 0, production: 2, draft: 3, idea: 4 };
  // brand/campaigns are optional — omitting them keeps this behaving
  // exactly as it did before campaign-awareness existed. When given, the
  // caller (calendar.js) also tags each item with a `campaignPhase` label
  // so the model can see which items share a campaign window without
  // suggestSchedule needing to know anything about phase shapes itself.
  const contextBlock = brand ? buildFullContext(brand, { campaigns }) : "";
  const system = [
    "You are a social media content calendar planner.",
    contextBlock,
    `Distribute the given content items across the ${daysAhead} days starting ${startDate} (inclusive), one date per item, format YYYY-MM-DD.`,
    "Each item's stage tells you how close it is to actually being postable — schedule items closer to ready (already shot/edited) sooner than ones still being written or filmed, since those need more lead time.",
    "Prefer spreading items evenly rather than clustering on the same day. Avoid scheduling the same funnel stage (TOFU/MOFU/BOFU) on consecutive scheduled days where there's enough variety to avoid it.",
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
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : `Brand: ${brand.name} (no brand identity details filled in yet).`;
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
`.trim();

// One-line summary of a campaign for prompt context — the shared building
// block for every AI feature that needs to describe a campaign to the
// model: the campaign list below, the single active campaign in
// suggestPhaseContent, and the "Active campaigns" section of
// buildFullContext. One definition instead of three near-duplicate
// inline formats drifting apart.
export function campaignSummaryLine(c, brand) {
  const window = c.startDate || c.endDate ? ` | window=${c.startDate || "?"}..${c.endDate || "?"}` : "";
  return `- id=${c.id} | name=${c.name} | objective=${c.objective} | key message=${c.keyMessage || "(none set)"} | audience=${c.targetAudience || brand?.brandDNA?.targetAudience || "(not set)"}${window}`;
}

// Extends buildBrandContext with active-campaign awareness — the shared
// layer any AI feature can pull from instead of assembling its own
// campaign summary inline. Archived campaigns are left out; they're not
// live strategy anymore.
export function buildFullContext(brand, { campaigns = [] } = {}) {
  const active = campaigns.filter((c) => c.status !== "archived");
  const parts = [
    buildBrandContext(brand),
    active.length ? `Active campaigns:\n${active.map((c) => campaignSummaryLine(c, brand)).join("\n")}` : "",
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
  if (!campaigns.length) throw new AiApiError("This brand has no campaigns yet — create one first.");
  const system = [
    "You help a brand manager decide which marketing campaign — and which phase of its journey — a new content idea best serves, and suggest a content angle for it.",
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
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
    throw new AiApiError("Couldn't read a campaign suggestion back from the AI response.");
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
export async function suggestBrandDnaOptions(ai, { brand, question, guide, draftAnswer, priorAnswers = [], avoid = [], count = 3 }) {
  const system = [
    "You help a small business owner sharpen their own answer to one question in a guided brand-identity questionnaire built on the StoryBrand framework (customer = hero of their own story, brand = guide, not the hero; a clear problem the hero faces; a simple plan; a direct call to action; what's at stake — success if they act, failure if they don't).",
    `Given their own draft answer, write ${count} distinct options for how to phrase it better as their real answer. Every option must be SHORT and PUNCHY — one sentence, ideally under 15 words, never a paragraph. But brevity must never cost substance: cut filler and throat-clearing, not the actual StoryBrand thinking the question's guide (below) is asking for — each option should still clearly do that framing's job (e.g. name the real problem, keep the customer as hero, make the brand read as guide not hero), just say it tighter than the raw draft, never vaguer or more generic. Never generic marketing advice about how to answer.`,
    "Make the options meaningfully different from each other in angle or phrasing — not near-duplicates of the same sentence. None of them should read as filler or padding just to sound more 'complete.'",
    "Match the language of the draft (Indonesian or English).",
    buildBrandContext(brand),
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"options": ["option 1", "option 2", "option 3"]} — exactly ${count} items.`,
  ].join("\n\n");

  const user = [
    `Question: ${question}`,
    guide ? `What this question is really asking: ${guide}` : "",
    priorAnswers.length ? `\nWhat they've already said in earlier steps:\n${priorAnswers.map((a) => `- ${a}`).join("\n")}` : "",
    draftAnswer ? `\nTheir own draft answer — sharpen this, don't invent something unrelated:\n${draftAnswer}` : "\nThey haven't written a draft yet — suggest reasonable starting points based on the brand info above.",
    avoid.length ? `\nAlready shown, don't repeat these (write genuinely different options):\n${avoid.map((a) => `- ${a}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callModel(ai, system, user, 800);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const options = Array.isArray(parsed.options) ? parsed.options.filter(Boolean) : [];
    if (!options.length) throw new Error("empty");
    return options;
  } catch {
    throw new AiApiError("Couldn't read answer options back from the AI response.");
  }
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
    "Exactly ONE sentence. Match the language of the answers given below (Indonesian or English).",
    "Respond with ONLY the sentence — no preamble, no quotes, no markdown.",
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

// Drafts an entire campaign — including goals for its enabled journey
// phases — from one plain-language goal, using the brand's full context so
// a Gen Z fashion brand's launch plan reads differently from a B2B
// service's, instead of a generic template with the brand's name swapped
// in. Never applied silently — the caller opens this in the same
// review-before-save modal used for manual campaign creation.
// `enabledPhases`: the subset of CAMPAIGN_PHASE_TEMPLATE this campaign
// actually uses (Website/Event/Community only if the brand has/plans that
// infrastructure) — matched back by name, not position, since the enabled
// set varies per campaign.
export async function generateCampaignPlan(ai, { brand, objectiveText, objective, enabledPhases, socialPlatforms = [] }) {
  const system = [
    "You draft a marketing campaign plan for a specific brand, tailored to that brand's actual character, audience, and products — not a generic template.",
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    socialPlatforms.length ? `Social platforms this brand actively uses: ${socialPlatforms.join(", ")}.` : "",
    `This campaign's journey uses exactly these phases, in this order — write a specific \`goal\` for each: what it should accomplish for THIS campaign, for THIS brand, not a generic definition of the phase:\n${enabledPhases.map((p) => `- ${p.name}: ${p.description}`).join("\n")}`,
    "The \"cta\" field is a short call-to-action phrase reused everywhere this campaign shows up — flyers, website, bio link, story stickers — so it must be extremely short: 2-4 words, imperative, like \"Join now!\", \"Daftar sekarang!\", or \"Grab yours today\". Never a sentence or an explanation.",
    "Match the language of the user's stated goal (Indonesian or English).",
    `Respond ONLY with valid JSON, no markdown fences, exactly this shape: {"name": "...", "targetAudience": "...", "problemOrOpportunity": "...", "insight": "...", "bigIdea": "...", "keyMessage": "...", "offer": "...", "cta": "...", "channels": ["...", "..."], "phases": [{"name": "...", "goal": "..."}, ...]} — phases array MUST have exactly ${enabledPhases.length} items, one per phase listed above, "name" matching those exactly, same order.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [`Campaign objective category: ${objective}`, `What the user said they want: ${objectiveText}`].join("\n");

  const raw = await callModel(ai, system, user, 1200);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const goalByName = {};
    (parsed.phases || []).forEach((p) => { if (p?.name) goalByName[p.name.toLowerCase()] = p.goal || ""; });
    const phases = enabledPhases.map((p) => ({ name: p.name, goal: goalByName[p.name.toLowerCase()] || "" }));
    return {
      name: parsed.name || "", targetAudience: parsed.targetAudience || "", problemOrOpportunity: parsed.problemOrOpportunity || "",
      insight: parsed.insight || "", bigIdea: parsed.bigIdea || "", keyMessage: parsed.keyMessage || "",
      offer: parsed.offer || "", cta: parsed.cta || "", channels: Array.isArray(parsed.channels) ? parsed.channels : [], phases,
    };
  } catch {
    throw new AiApiError("Couldn't read a campaign plan back from the AI response.");
  }
}

// Campaign-level sibling of suggestPhaseContent below — for campaigns whose
// content isn't bucketed into phases at all (Grow Social Media's
// autoLinkAllContent ladder has none), ideas are scoped to the campaign's
// whole objective and, if given, whichever mission is currently active —
// so a brand-new account and one already chasing "Build Advocacy" get
// genuinely different suggestions from the same button.
export async function brainstormCampaignIdeas(ai, { brand, campaign, mission, existingTitles = [] }) {
  const system = [
    "You brainstorm short-form content ideas for a brand's marketing campaign, tailored to the brand's actual character and audience.",
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    campaignSummaryLine(campaign, brand),
    mission ? `This campaign is currently working on: "${mission.name}" — ${mission.description}${mission.tagline ? ` (${mission.tagline})` : ""}. Ideas should help move the needle on THIS stage specifically, not the campaign in general.` : "",
    existingTitles.length ? `Content already made for this campaign (don't repeat these ideas):\n${existingTitles.map((t) => `- ${t}`).join("\n")}` : "",
    "Suggest 3-4 NEW content ideas. Match the brand's language (Indonesian or English).",
    'Respond ONLY with valid JSON, no markdown fences: {"ideas": [{"title": "...", "angle": "1-2 sentences", "format": "e.g. Reels, Carousel, Story"}, ...]}',
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await callModel(ai, system, "Suggest the ideas now.", 800);
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return { ideas: (parsed.ideas || []).slice(0, 4).map((i) => ({ title: i.title || "", angle: i.angle || "", format: i.format || "" })) };
  } catch {
    throw new AiApiError("Couldn't read content ideas back from the AI response.");
  }
}

// Suggests 2-3 content ideas for one specific campaign phase — given what's
// already been made for it, so it doesn't repeat itself. Returns ideas only;
// the caller decides whether to turn one into an actual Content item.
export async function suggestPhaseContent(ai, { brand, campaign, phase, existingTitles = [] }) {
  const system = [
    "You suggest short-form content ideas for one specific phase of a marketing campaign, tailored to the brand's actual character and audience.",
    buildBrandContext(brand),
    MARKETING_FRAMEWORKS_CONTEXT,
    campaignSummaryLine(campaign, brand),
    `Offer: ${campaign.offer || "(not set)"}. CTA: ${campaign.cta || "(not set)"}.`,
    `This phase ("${phase.name}") goal: ${phase.goal || "(not set — infer something reasonable for this phase and campaign)"}.`,
    existingTitles.length ? `Content already made for this phase (don't repeat these ideas):\n${existingTitles.map((t) => `- ${t}`).join("\n")}` : "",
    "Suggest 2-3 NEW content ideas for this phase. Match the brand's language (Indonesian or English).",
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
    throw new AiApiError("Couldn't read content ideas back from the AI response.");
  }
}

export { AiApiError };
