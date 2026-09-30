// Meta Conversions API — the server-side twin of js/meta-pixel.js.
// Off (silent no-op) until both env vars are set in Vercel:
//   META_PIXEL_ID            same pixel as js/meta-pixel.js and wepeka.com
//   META_CAPI_ACCESS_TOKEN   Events Manager → pixel → Settings → Conversions API → Generate access token
// Optional: META_TEST_EVENT_CODE while checking in Events Manager → Test events.
import crypto from "crypto";

const PIXEL_ID = (process.env.META_PIXEL_ID || "").trim();
const ACCESS_TOKEN = (process.env.META_CAPI_ACCESS_TOKEN || "").trim();
const TEST_EVENT_CODE = (process.env.META_TEST_EVENT_CODE || "").trim();
const GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "").trim() || "v23.0";

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("=")) || null;
  }
  return null;
}

// Browser facts about the buyer, captured when they START a payment — the
// webhook itself comes from Midtrans, not their browser. Stored on the
// pending payments/{orderId} doc (no secrets in it).
export function metaContext(req) {
  const h = req.headers || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  const url = String(h.referer || "").split("#")[0] || null;
  return {
    ip: fwd || String(h["x-real-ip"] || "").trim() || null,
    userAgent: h["user-agent"] || null,
    fbp: readCookie(h.cookie, "_fbp"),
    fbc: readCookie(h.cookie, "_fbc"),
    url,
  };
}

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// Sends one event. Never throws; failures only log.
export async function sendMetaEvent({ name, eventId, context, email, externalId, customData, actionSource = "website" }) {
  if (!PIXEL_ID || !ACCESS_TOKEN) return;
  const user = {};
  const em = String(email || "").trim().toLowerCase();
  if (em) user.em = [sha256(em)];
  if (externalId) user.external_id = [sha256(String(externalId))];
  if (context?.ip) user.client_ip_address = context.ip;
  if (context?.userAgent) user.client_user_agent = context.userAgent;
  if (context?.fbp) user.fbp = context.fbp;
  if (context?.fbc) user.fbc = context.fbc;
  const body = {
    data: [{
      event_name: name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: actionSource,
      ...(context?.url ? { event_source_url: context.url } : {}),
      user_data: user,
      ...(customData ? { custom_data: customData } : {}),
    }],
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
  };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("[meta-capi]", name, res.status, (await res.text()).slice(0, 300));
  } catch (err) {
    console.error("[meta-capi]", name, err?.message);
  }
}
