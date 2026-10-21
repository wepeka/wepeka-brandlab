// Local API server for the Firebase Emulator Suite (`npm run emu`) — never
// production. Runs the real /api handlers on the emulators with:
//   - no real secrets: the service account and every payment/push secret are
//     dropped, the AI and email keys are fake;
//   - a fake AI provider: DeepSeek requests are answered here (the same JSON
//     or SSE shape the real API sends), so nothing is billed;
//   - an email outbox: Resend requests are kept in memory and listed at
//     GET /__dev/outbox (invite links, sign-up codes);
//   - every other outgoing request refused.
// `python3 serve.py --emu` forwards /api/* here. Loopback only, port 8787.
//
//   npm run emu            # terminal 1: emulators (Java needed)
//   npm run dev:api        # terminal 2: this server
//   python3 serve.py --emu # terminal 3: the app, open http://localhost:8743/?emu=1
import http from "node:http";
import { pathToFileURL } from "node:url";

const env = process.env;
for (const k of Object.keys(env)) {
  if (/^(FIREBASE_ADMIN_|MIDTRANS_|META_|VAPID_|GOOGLE_APPLICATION_CREDENTIALS$|CRON_SECRET$|ANTHROPIC_|GEMINI_|DEEPSEEK_|RESEND_)/.test(k)) delete env[k];
}
Object.assign(env, {
  BRANDLAB_EMULATOR: "1",
  GCLOUD_PROJECT: "demo-brandlab",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  AI_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "fake-dev-key",
  RESEND_API_KEY: "fake-dev-key",
  RESEND_FROM: "Brandlab Dev <dev@localhost>",
});

// ---------- outgoing requests ----------
const realFetch = globalThis.fetch;
export const outbox = [];
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const FAKE_TEXT = "Ini jawaban contoh dari AI palsu (emulator lokal). Tidak ada kredit asli yang terpakai.";
function fakeDeepSeek(init) {
  let body = {};
  try {
    body = JSON.parse(init?.body || "{}");
  } catch {
    /* keep {} */
  }
  const json = body.response_format?.type === "json_object";
  const text = json ? '{"fake":true}' : FAKE_TEXT;
  if (!body.stream) {
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const words = text.split(/(?<= )/);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      for (const w of words) {
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`));
        await new Promise((r) => setTimeout(r, 30));
      }
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctrl.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fakeResend(url, init) {
  let body = null;
  try {
    body = JSON.parse(init?.body || "null");
  } catch {
    /* keep null */
  }
  const list = Array.isArray(body) ? body : [body];
  const ids = list.map((m) => {
    const id = `dev-${outbox.length + 1}`;
    outbox.push({ id, at: new Date().toISOString(), to: m?.to, subject: m?.subject, text: m?.text, html: m?.html });
    console.log(`[outbox] ${id} → ${m?.to} · ${m?.subject}`);
    return { id };
  });
  const out = url.pathname.endsWith("/batch") ? { data: ids } : ids[0];
  return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.deepseek.com") return fakeDeepSeek(init);
  if (url.hostname === "api.resend.com") return fakeResend(url, init);
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init);
  throw new Error(`dev-api: outgoing request blocked (${url.origin})`);
};

// ---------- Vercel-style req/res on plain Node http ----------
const ROUTES = {
  "/api/ai": "../api/ai.js",
  "/api/team": "../api/team.js",
  "/api/brands/recount": "../api/brands/recount.js",
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  if (/json/i.test(req.headers["content-type"] || "")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function vercelRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    return res;
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  vercelRes(res);
  try {
    if (url.pathname === "/__dev/outbox") {
      if (req.method === "DELETE") outbox.length = 0;
      return res.status(200).json({ outbox });
    }
    const mod = ROUTES[url.pathname];
    if (!mod) return res.status(404).json({ error: "not-in-dev-api", path: url.pathname });
    req.query = Object.fromEntries(url.searchParams);
    req.body = await readBody(req);
    const handler = (await import(new URL(mod, import.meta.url))).default;
    await handler(req, res);
  } catch (err) {
    console.error("[dev-api]", url.pathname, err);
    if (!res.headersSent) res.status(500).json({ error: "dev-api", message: String(err?.message || err) });
    else res.end();
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(8787, "127.0.0.1", () => console.log("dev-api on http://127.0.0.1:8787 (emulator only, fake AI + email outbox)"));
}
export { server };
