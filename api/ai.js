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
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { adminDb, requireAuth } from "./_firebaseAdmin.js";
import { quotaFor, reserveCall, releaseCall, MAX_INFLIGHT, isAdminUid, isReadOnlyAccount } from "./_aiQuota.js";

// Calls the app starts on its own — routing a chat message, the monthly
// lessons, re-writing saved advice that went stale, the key test — don't
// cost the owner a credit (js/ai.js countUsage:false). The browser names
// the feature, so the server only lets a call through free when it has the
// shape that feature really sends: never streamed, no chat history, no
// images, the same json mode, and at most `input` chars of system + user
// prompt; its reply is capped at `out` tokens, and at most
// FREE_CALLS_PER_DAY are free per account. Anything else that asks to be
// free is charged like a normal call. `input` was measured (2026-10-06) from
// the js/ai.js call itself, with a fully filled-in brand:
//   test     testAiConnection              26 ("Reply with exactly: OK" + "ping")
//   route    classifyChatIntent            ~1.5K + the owner's chat message
//   lessons  summarizeMonthLessons         ~0.8K + ~290 per post (90 posts ≈ 27K)
//   concept  summarizeConcept              brand + last 24 chat messages (long chat ≈ 96K)
//   campaign generateCampaignPlaybook free brand + pulse + levels ≈ 28K
//   sales    suggestSalesActions free      full context + sales snapshot ≈ 35K
const FREE_FEATURES = {
  test: { out: 16, input: 500, json: false },
  route: { out: 16, input: 10_000, json: false },
  lessons: { out: 600, input: 40_000, json: true },
  concept: { out: 800, input: 100_000, json: true },
  campaign: { out: 2600, input: 40_000, json: true },
  sales: { out: 1400, input: 48_000, json: true },
};
const FREE_CALLS_PER_DAY = 150;
// The free shape (above) for this call, or null when it has to be charged.
export function freeSpecFor(feature, { system = "", user = "", history = [], images = [], json = false, stream = false } = {}) {
  const spec = typeof feature === "string" && Object.hasOwn(FREE_FEATURES, feature) ? FREE_FEATURES[feature] : null;
  if (!spec || stream || history.length || images.length || !!json !== spec.json) return null;
  return system.length + user.length <= spec.input ? spec : null;
}
// Everything sent to the model — system + user + chat history — in chars.
// Measured 2026-10-06 with a fully filled-in brand: the biggest prompts
// without history are the concept summary of a long brainstorm (~96K) and
// the consultant (~48K with a 20K live-data snapshot). A chat adds up to 24
// turns × 8,000 chars (js/ai.js CHAT_TURNS/TURN_CHARS): ~114K for a heavy
// one (every reply at the clip), ~162K with the consultant's prompt. At
// 160K such a chat loses its OLDEST turn pair (fitHistory) instead of the
// whole call failing (it was a hard 413 past 200K); only a system + user
// prompt that is over the limit on its own is refused.
const MAX_INPUT_CHARS = 160_000;
const MAX_IMAGES = 6;
// No streamed reply in the app asks for more than 3,200 tokens (Brainstorm's
// longest mode) — and a stream cut off by its time budget is refunded, so
// it mustn't be able to ask for a reply that can't finish in time.
const MAX_STREAM_TOKENS = 4096;
// Time budgets, counted from the moment the request arrives. The browser
// gives up on a non-streamed call after 125 s (js/ai.js callProxy), so both
// attempts and the pause between them end by NON_STREAM_BUDGET_MS — the
// owner always gets the answer, or the error and the refund, before the
// browser stops listening. A stream has no total limit in the browser: it
// waits 130 s for the headers (which go out with the first line) and then
// 45 s of silence at most; here it gets STREAM_FIRST_DELTA_MS for the first
// words, STREAM_IDLE_MS of silence after that, and STREAM_BUDGET_MS in all.
// Everything stays well under vercel.json's maxDuration for this function
// (180 s), so the platform never kills a call between reserving its credit
// and refunding it.
// Long JSON calls (threads chain, copy, campaign plan) can take a minute.
const NON_STREAM_BUDGET_MS = 110_000;
const STREAM_BUDGET_MS = 160_000;
const STREAM_FIRST_DELTA_MS = 100_000;
const STREAM_IDLE_MS = 40_000;
// A retry only starts when at least this much of the budget is left.
const MIN_RETRY_MS = 15_000;

// A reply that is ONLY a hand-off line ("[[handoff:brainstorm]]", js/ai.js
// HANDOFF_RULE_*; js/ai-directives.js reads it): the chat passes the message
// straight on to that partner, whose answer is the one the owner pays for —
// this one is refunded (api/_aiQuota.js releaseCall, within today's free calls).
const HANDOFF_ONLY = /^(?:\s*\[\[handoff:(?:consultant|brainstorm|companion)\]\])+\s*$/i;
export function isHandoffOnly(text) {
  return HANDOFF_ONLY.test(String(text || ""));
}
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
// The newest turns of a cleaned history that fit in `room` chars — still
// starting with the owner (and, as before, ending on the assistant).
export function fitHistory(history, room) {
  let total = historyChars(history);
  let from = 0;
  while (from < history.length && (total > room || history[from].role !== "user")) total -= history[from++].content.length;
  return history.slice(from);
}

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
// "deepseek-chat" was retired on 24 Jul 2026 and has since been served,
// undocumented, by deepseek-flash. deepseek-flash thinks by default (and
// thinking tokens count against max_tokens, so a short cap can come back
// empty), hence the explicit "disabled" in deepSeekBody.
const DEEPSEEK_MODEL = "deepseek-flash";

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
    thinking: { type: "disabled" },
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

// The abort signal of the provider attempt running right now (runAttempt
// below) — providerFetch picks it up, so an attempt that runs out of time
// also stops the provider request itself, not just our wait for it.
const attemptSignal = new AsyncLocalStorage();

async function providerFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Unlike the timer above (which only covers the wait for the headers),
  // the attempt's budget keeps covering the body — DeepSeek sends its
  // headers at once and the answer much later.
  const outer = attemptSignal.getStore();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", () => ctrl.abort(), { once: true });
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

// Runs one provider attempt within `ms` — and, with `idleMs`, with no more
// than `idleMs` between two touch() calls (the stream touches on every
// delta; `firstIdleMs` is the wait allowed before the first one). Past
// either it rejects with a "timeout" error and aborts the provider request
// (providerFetch reads attemptSignal).
export function runAttempt(fn, ms, { idleMs = 0, firstIdleMs = idleMs } = {}) {
  const ctrl = new AbortController();
  let fail;
  let idle = null;
  const limit = new Promise((_, reject) => {
    fail = reject;
  });
  const stop = (why) => () => {
    fail(new AiProxyError("timeout", why, 504, false));
    ctrl.abort();
  };
  const total = setTimeout(stop("time budget used up"), Math.max(0, ms));
  const arm = (wait) => {
    clearTimeout(idle);
    if (wait) idle = setTimeout(stop("no reply from the provider"), wait);
  };
  const touch = () => arm(idleMs);
  arm(firstIdleMs);
  return Promise.race([attemptSignal.run(ctrl.signal, () => fn(touch)), limit]).finally(() => {
    clearTimeout(total);
    clearTimeout(idle);
  });
}

// One retry, 1.5s later, only for a provider hiccup (429/5xx) — never for a
// bad-request-shaped error, which would just fail the same way again — and
// only while the request's budget (`deadline`, ms epoch) still leaves
// MIN_RETRY_MS for it. Each attempt gets whatever is left of the budget.
export async function withOneRetry(fn, deadline = Date.now() + NON_STREAM_TIMEOUT_MS) {
  try {
    return await runAttempt(fn, deadline - Date.now());
  } catch (err) {
    if (err instanceof AiProxyError && err.retryable && deadline - Date.now() - RETRY_DELAY_MS >= MIN_RETRY_MS) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return await runAttempt(fn, deadline - Date.now());
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
  const startedAt = Date.now();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  let uid;
  try {
    ({ uid } = await requireAuth(req));
  } catch (err) {
    return res.status(err.status || 401).json({ error: "auth" });
  }
  return handleAiRequest(req, res, { db: adminDb(), uid, startedAt });
}

// Everything after the token check, given the Firestore handle and the
// verified uid — split out so tests can drive the whole charge → call →
// refund path with a fake Firestore and a fake provider.
export async function handleAiRequest(req, res, { db, uid, startedAt = Date.now() }) {
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

  // An ended trial or lapsed plan has no AI (the app shows the pricing
  // screen instead); refuse here too so the endpoint can't be used directly.
  if (!isAdminUid(uid) && isReadOnlyAccount(account)) return res.status(403).json({ error: "readonly" });
  if (typeof system !== "string" || typeof user !== "string" || system.length + user.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ error: "too-large" });
  }
  // A long chat that no longer fits loses its oldest turns, not the call.
  const history = fitHistory(cleanHistory(historyRaw), MAX_INPUT_CHARS - system.length - user.length);
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return res.status(400).json({ error: "images" });

  // Never trust the browser's token budget blindly — clamp to what the
  // largest legitimate call (the 48-item content plan) actually needs.
  let maxTokens = Math.min(8192, Math.max(16, Number(maxTokensRaw) || 1024));
  if (wantStream) maxTokens = Math.min(maxTokens, MAX_STREAM_TOKENS);

  // Free only when it has the shape of one of the app's own background
  // calls (FREE_FEATURES) and today's free allowance has room — decided in
  // reserveCall below; otherwise it's a normal call.
  const freeSpec = countUsage === false ? freeSpecFor(feature, { system, user, history, images, json: wantJson, stream: wantStream }) : null;

  const provider = AI_PROVIDER;
  const apiKey = KEYS[provider];
  if (!apiKey) {
    console.error(`api/ai: no API key set for provider "${provider}" (feature=${feature || "?"})`);
    // Its own code, not "provider": nothing is wrong with the AI service —
    // the key was never set in Vercel, and the admin needs to be told so.
    return res.status(503).json({ error: "setup", message: isAdminUid(uid) ? `${provider.toUpperCase()}_API_KEY` : undefined });
  }

  // Charge first (api/_aiQuota.js reserveCall): one transaction takes one
  // of the account's in-flight slots and the credit that pays for this call
  // — a free slot for a background call that fits FREE_FEATURES, else the
  // plan's allowance, then AI Sepuasnya, then top-up credits — so calls
  // started together can never spend the same credit. From here on,
  // settle() always runs (the finally below): it gives the slot back and
  // refunds the credit when no usable reply came out of the call.
  const quota = quotaFor(account, uid);
  const leaseId = randomUUID();
  let settling = null;
  const settle = (outcome) => {
    settling ||= releaseCall(db, uid, leaseId, { outcome, period: quota.period, freeLimit: FREE_CALLS_PER_DAY }).catch((err) => {
      console.error("api/ai: releasing the call failed", uid, outcome, err?.message);
      return null;
    });
    return settling;
  };
  let reserved;
  try {
    // Admin (Wepeka's own account) stays unmetered, in-flight slots included.
    reserved = await reserveCall(db, uid, { period: quota.period, limit: quota.limit, leaseId, free: !!freeSpec, freeLimit: FREE_CALLS_PER_DAY, maxInflight: isAdminUid(uid) ? Infinity : MAX_INFLIGHT });
  } catch (err) {
    console.error("api/ai: reserving the call failed", uid, err?.message);
    await settle("fail"); // in case the transaction landed after all
    return res.status(500).json({ error: "unknown" });
  }
  if (!reserved.ok && reserved.error === "busy") {
    // Not a usage cap (AI Sepuasnya stays unlimited): the account already
    // has MAX_INFLIGHT calls running; nothing was charged.
    return res.status(429).json({ error: "busy", limit: MAX_INFLIGHT });
  }
  if (!reserved.ok) {
    return res.status(429).json({ error: "quota", limit: quota.limit, period: quota.period, usage: { used: reserved.planUsed, limit: quota.limit, period: quota.period, dailyUsed: reserved.dailyUsed, dailyLimit: reserved.dailyLimit, credits: reserved.credits } });
  }
  // Only a call a free slot paid for gets the free reply length; past
  // today's free allowance it's a normal call, with its normal length.
  if (reserved.kind === "free") maxTokens = Math.min(maxTokens, freeSpec.out);
  const outcomeOf = (text) => (!String(text || "").trim() ? "fail" : isHandoffOnly(text) ? "handoff" : "ok");

  try {
    if (wantStream) {
      // The headers go out with the first line (as Node always sent them),
      // so until the first words arrive the browser is still within its
      // 130 s wait for the response, not its 45 s silence limit.
      let headersSent = false;
      const send = (line) => {
        if (!headersSent) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          headersSent = true;
        }
        res.write(`data: ${line}\n\n`);
      };
      let text = "";
      let open = true;
      let failure = null;
      try {
        await runAttempt(
          (touch) =>
            callStream({ provider, apiKey, system, user, history, maxTokens, temperature, images }, (delta) => {
              if (!open) return;
              touch();
              text += delta;
              send(JSON.stringify({ delta }));
            }),
          startedAt + STREAM_BUDGET_MS - Date.now(),
          { idleMs: STREAM_IDLE_MS, firstIdleMs: STREAM_FIRST_DELTA_MS }
        );
      } catch (err) {
        failure = err;
      }
      open = false;
      // A stream that failed — even part-way, which the app shows as a
      // cut-off reply with "Coba lagi" — is refunded. Settled before
      // [DONE], so the meter is already right when the reply ends.
      await settle(failure ? "fail" : outcomeOf(text));
      if (failure) {
        const code = failure instanceof AiProxyError ? failure.code : "network";
        const message = isAdminUid(uid) && failure instanceof AiProxyError ? failure.message : undefined;
        console.error("api/ai stream error", provider, feature, code, failure?.message);
        send(JSON.stringify({ error: code, message }));
      }
      send("[DONE]");
      return res.end();
    }

    try {
      const { text } = await withOneRetry(() => callNonStream({ provider, apiKey, system, user, history, maxTokens, temperature, json: wantJson, images }), startedAt + NON_STREAM_BUDGET_MS);
      const settled = await settle(outcomeOf(text));
      return res.status(200).json({ text, usage: { used: settled?.used ?? reserved.used, limit: quota.limit, period: quota.period } });
    } catch (err) {
      await settle("fail");
      if (err instanceof AiProxyError) {
        console.error("api/ai provider error", provider, feature, err.status, err.code, err.message);
        const message = isAdminUid(uid) ? err.message : undefined;
        return res.status(err.status).json({ error: err.code, message });
      }
      console.error("api/ai unexpected error", err);
      return res.status(500).json({ error: "unknown" });
    }
  } finally {
    // The backstop: anything that threw past the paths above still gives
    // the slot back and refunds (a no-op once settled).
    await settle("fail");
  }
}
