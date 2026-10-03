// Server-side AI proxy — the ONLY place that ever holds a provider API key
// now (DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY, set in Vercel's
// env, never in Firestore). js/ai.js's callProxy() is the one client-side
// caller: it sends { system, user, history, maxTokens, temperature, json,
// stream, images, countUsage, feature } with a Firebase ID token, and gets back
// either { text, usage } or, when `stream` is true, a text/event-stream of
// `data: {"delta":"..."}` lines ending in `data: [DONE]`.
//
// Provider request bodies/models here are the exact ones js/ai.js used to
// build client-side (deepSeekBody, claudeUserContent, the three model ids) —
// moved server-side so a customer's browser never sees a key again.
import { adminDb, requireAuth } from "./_firebaseAdmin.js";
import { quotaFor, availability, consumeQuota, consumeFreeCall, isAdminUid, isReadOnlyAccount } from "./_aiQuota.js";

// Calls the app starts on its own — routing a chat message, the monthly
// lessons, re-writing saved advice that went stale, the key test — don't
// cost the owner a credit (js/ai.js countUsage:false). The server, not the
// browser, decides which those are: only these features, each with its own
// output cap, and at most FREE_CALLS_PER_DAY per account; anything else that
// asks to be free is charged like a normal call.
const FREE_FEATURES = { test: 16, route: 16, lessons: 600, concept: 800, campaign: 2600, sales: 1400 };
const FREE_CALLS_PER_DAY = 150;
// Far above the largest real prompt (full brand context + a month of posts),
// far below what it takes to run up a bill with one request.
const MAX_INPUT_CHARS = 200_000;
const MAX_IMAGES = 6;
// Earlier turns of a chat, sent as real conversation turns ({ role:
// "user"|"assistant", content }) instead of a transcript pasted into one
// message — the model follows who said what, and the provider's prefix
// cache reuses everything up to the newest turn.
const MAX_HISTORY = 40;

// Untrusted input → alternating turns that start with the owner. Same-role
// neighbours are merged (Anthropic refuses two in a row), empty ones dropped.
export function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const content = typeof m?.content === "string" ? m.content.trim() : "";
    if (!role || !content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // The newest message is sent separately as `user`, so history ends on the
  // assistant's turn; a trailing owner turn would make two in a row.
  if (out.length && out[out.length - 1].role === "user") out.pop();
  return out;
}
const historyChars = (h) => h.reduce((a, m) => a + m.content.length, 0);

// Vercel: stream the response body instead of buffering it whole before
// sending — required for the SSE path below to actually arrive incrementally.
export const config = { supportsResponseStreaming: true };

const AI_PROVIDER = process.env.AI_PROVIDER || "deepseek";
const KEYS = {
  deepseek: process.env.DEEPSEEK_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
};

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.6-flash";
const DEEPSEEK_API_BASE = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

const NON_STREAM_TIMEOUT_MS = 60000;
const STREAM_TIMEOUT_MS = 120000;
const RETRY_DELAY_MS = 1500;

class AiProxyError extends Error {
  constructor(code, message, status = 502, retryable = false) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// One user turn for the Messages API: screenshots first, then the text —
// same shape js/ai.js built client-side before this moved server-side.
function claudeMessages(history, userPrompt, images) {
  return [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: claudeUserContent(userPrompt, images) }];
}
function geminiContents(history, userPrompt, images) {
  return [
    ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [...images.map(dataUrlToInlinePart).filter(Boolean), { text: userPrompt }] },
  ];
}
function claudeUserContent(userPrompt, images = []) {
  if (!images.length) return userPrompt;
  return [
    ...images
      .map((d) => {
        const m = /^data:([^;]+);base64,(.+)$/.exec(d);
        return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
      })
      .filter(Boolean),
    { type: "text", text: userPrompt },
  ];
}
function dataUrlToInlinePart(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  return m ? { inlineData: { mimeType: m[1], data: m[2] } } : null;
}
function deepSeekBody(system, userPrompt, maxTokens, { temperature, json = false, stream = false, history = [] } = {}) {
  return {
    model: DEEPSEEK_MODEL,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(stream ? { stream: true } : {}),
    messages: [
      { role: "system", content: system },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userPrompt },
    ],
  };
}

async function providerFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (cause) {
    throw new AiProxyError("network", cause?.message || "network error", 504, true);
  } finally {
    clearTimeout(timer);
  }
}
async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
// A 401/402/403 is almost always a bad/expired key on OUR side — never the
// caller's fault, and never worth echoing the provider's own auth text back
// to a non-admin. Anything else keeps whatever message the provider sent
// (admin only gets to see it — see the handler below).
function providerError(status, body) {
  const message = body?.error?.message || body?.message || "";
  const retryable = status === 429 || status >= 500;
  if (status === 401 || status === 402 || status === 403) return new AiProxyError("provider", message, 502, false);
  if (!body) return new AiProxyError("badResponse", "unreadable provider response", 502, retryable);
  return new AiProxyError("provider", message || `HTTP ${status}`, 502, retryable);
}

async function callNonStream({ provider, apiKey, system, user, history = [], maxTokens, temperature, json, images }) {
  if (provider === "gemini") {
    const res = await providerFetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: geminiContents(history, user, images),
          ...(temperature !== undefined ? { generationConfig: { temperature } } : {}),
        }),
      },
      NON_STREAM_TIMEOUT_MS
    );
    const body = await readJsonSafe(res);
    if (!res.ok) throw providerError(res.status, body);
    return { text: body?.candidates?.[0]?.content?.parts?.[0]?.text || "", usage: body?.usageMetadata || null };
  }
  if (provider === "deepseek") {
    if (images.length) throw new AiProxyError("noVision", "DeepSeek can't read images.", 400, false);
    const res = await providerFetch(
      DEEPSEEK_API_BASE,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(deepSeekBody(system, user, maxTokens, { temperature, json, history })) },
      NON_STREAM_TIMEOUT_MS
    );
    const body = await readJsonSafe(res);
    if (!res.ok) throw providerError(res.status, body);
    return { text: body?.choices?.[0]?.message?.content || "", usage: body?.usage || null };
  }
  // anthropic (default)
  const res = await providerFetch(
    ANTHROPIC_API_BASE,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        system,
        messages: claudeMessages(history, user, images),
      }),
    },
    NON_STREAM_TIMEOUT_MS
  );
  const body = await readJsonSafe(res);
  if (!res.ok) throw providerError(res.status, body);
  return { text: body?.content?.[0]?.text || "", usage: body?.usage || null };
}

// One retry, 1.5s later, only for a provider hiccup (429/5xx) — never for a
// bad-request-shaped error, which would just fail the same way again.
async function withOneRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiProxyError && err.retryable) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return await fn();
    }
    throw err;
  }
}

async function pumpOpenAiSse(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = ev.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    }
  }
}
async function pumpAnthropicSse(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") onDelta(ev.delta.text);
      else if (ev.type === "error") throw new AiProxyError("provider", ev.error?.message || "", 502, false);
    }
  }
}

// Streams normalized `data: {"delta":"..."}` chunks to `onDelta`. Gemini has
// no streaming path wired up here (this app has never needed it) — it just
// resolves in one shot and hands its whole answer over as a single delta,
// same fallback the old client-side code gave a non-streaming provider.
async function callStream({ provider, apiKey, system, user, history = [], maxTokens, temperature, images }, onDelta) {
  if (provider === "gemini") {
    const { text } = await callNonStream({ provider, apiKey, system, user, history, maxTokens, temperature, images, json: false });
    if (text) onDelta(text);
    return;
  }
  if (provider === "deepseek") {
    if (images.length) throw new AiProxyError("noVision", "DeepSeek can't read images.", 400, false);
    const res = await providerFetch(
      DEEPSEEK_API_BASE,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(deepSeekBody(system, user, maxTokens, { temperature, stream: true, history })) },
      STREAM_TIMEOUT_MS
    );
    if (!res.ok || !res.body) throw providerError(res.status, await readJsonSafe(res));
    return pumpOpenAiSse(res.body, onDelta);
  }
  const res = await providerFetch(
    ANTHROPIC_API_BASE,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
        system,
        messages: claudeMessages(history, user, images),
      }),
    },
    STREAM_TIMEOUT_MS
  );
  if (!res.ok || !res.body) throw providerError(res.status, await readJsonSafe(res));
  return pumpAnthropicSse(res.body, onDelta);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }

  const db = adminDb();
  const accountSnap = await db.doc(`accounts/${uid}`).get();
  if (!accountSnap.exists) return res.status(404).json({ error: "account" });
  const account = accountSnap.data();
  if (account.status === "deactivated") return res.status(403).json({ error: "deactivated" });

  const {
    system = "",
    user = "",
    maxTokens: maxTokensRaw = 1024,
    temperature,
    json: wantJson = false,
    stream: wantStream = false,
    images = [],
    countUsage = true,
    feature = "",
    history: historyRaw = [],
  } = req.body || {};
  const history = cleanHistory(historyRaw);

  // An ended trial or lapsed plan has no AI (the app shows the pricing
  // screen instead); refuse here too so the endpoint can't be used directly.
  if (!isAdminUid(uid) && isReadOnlyAccount(account)) return res.status(403).json({ error: "readonly" });
  if (typeof system !== "string" || typeof user !== "string" || system.length + user.length + historyChars(history) > MAX_INPUT_CHARS) {
    return res.status(413).json({ error: "too-large" });
  }
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return res.status(400).json({ error: "images" });

  // Never trust the browser's token budget blindly — clamp to what the
  // largest legitimate call (the 48-item content plan) actually needs.
  let maxTokens = Math.min(8192, Math.max(16, Number(maxTokensRaw) || 1024));

  // Free only when the feature is one of the app's own background calls and
  // today's free allowance isn't used up; otherwise it's a normal call.
  let charged = countUsage !== false;
  if (!charged) {
    const cap = FREE_FEATURES[feature];
    if (cap && (await consumeFreeCall(db, uid, new Date(), FREE_CALLS_PER_DAY))) maxTokens = Math.min(maxTokens, cap);
    else charged = true;
  }

  const quota = quotaFor(account, uid);
  let used = 0;
  if (charged) {
    // The plan's allowance first, then AI Harian, then top-up credits
    // (api/_aiQuota.js availability) — only refused when all are empty.
    const usageSnap = await db.doc(`aiUsage/${uid}`).get();
    const avail = availability(account, uid, usageSnap.exists ? usageSnap.data() : null);
    used = avail.planUsed;
    if (!avail.bucket) {
      return res.status(429).json({ error: "quota", limit: quota.limit, period: quota.period, usage: { used, limit: quota.limit, period: quota.period, dailyUsed: avail.dailyUsed, dailyLimit: avail.dailyLimit, credits: avail.credits } });
    }
  }

  const provider = AI_PROVIDER;
  const apiKey = KEYS[provider];
  if (!apiKey) {
    console.error(`api/ai: no API key set for provider "${provider}" (feature=${feature || "?"})`);
    // Its own code, not "provider": nothing is wrong with the AI service —
    // the key was never set in Vercel, and the admin needs to be told so.
    return res.status(503).json({ error: "setup", message: isAdminUid(uid) ? `${provider.toUpperCase()}_API_KEY` : undefined });
  }

  if (wantStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    try {
      await callStream({ provider, apiKey, system, user, history, maxTokens, temperature, images }, (delta) => {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      });
      if (charged) await consumeQuota(db, uid, quota.period, new Date(), { limit: quota.limit });
    } catch (err) {
      const code = err instanceof AiProxyError ? err.code : "network";
      const message = isAdminUid(uid) && err instanceof AiProxyError ? err.message : undefined;
      console.error("api/ai stream error", provider, feature, code, err?.message);
      res.write(`data: ${JSON.stringify({ error: code, message })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  try {
    const { text } = await withOneRetry(() => callNonStream({ provider, apiKey, system, user, history, maxTokens, temperature, json: wantJson, images }));
    let usageOut = { used, limit: quota.limit, period: quota.period };
    if (charged) {
      const next = await consumeQuota(db, uid, quota.period, new Date(), { limit: quota.limit });
      usageOut = { used: next.used, limit: quota.limit, period: quota.period };
    }
    return res.status(200).json({ text, usage: usageOut });
  } catch (err) {
    if (err instanceof AiProxyError) {
      console.error("api/ai provider error", provider, feature, err.status, err.code, err.message);
      const message = isAdminUid(uid) ? err.message : undefined;
      return res.status(err.status).json({ error: err.code, message });
    }
    console.error("api/ai unexpected error", err);
    return res.status(500).json({ error: "unknown" });
  }
}
