// Instagram's webhook for the comment → DM automation (api/_igAutoDm.js).
// GET = Meta checking the callback URL once (hub.challenge); POST = a new
// comment on a @winkhsin post or a DM event. Every POST is signed with the
// Instagram app secret over the raw body, so the body is read unparsed.
import { adminDb } from "../_firebaseAdmin.js";
import { verifySignature, readEvents, handleEvents, graphClient, currentToken, keywords, DEFAULT_VERIFY_TOKEN } from "../_igAutoDm.js";

export const config = { api: { bodyParser: false } };

// Meta signs its own JSON spelling: "/" as "\/" and every non-ASCII
// character as \uXXXX (emoji as two surrogates).
export function metaJson(value) {
  return JSON.stringify(value)
    .replace(/\//g, "\\/")
    .replace(/[\u007f-￿]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

export async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  // The runtime already read the stream into req.body: rebuild Meta's text.
  const body = req.body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return body && typeof body === "object" ? metaJson(body) : "";
}

export function firestoreDeps(db) {
  return {
    async claimComment(id, data) {
      try {
        await db.doc(`igAutoDmComments/${id}`).create(data);
        return true;
      } catch (err) {
        if (err?.code === 6 || /already exists/i.test(err?.message || "")) return false;
        throw err;
      }
    },
    async person(id) {
      const snap = await db.doc(`igAutoDmPeople/${id}`).get();
      return snap.exists ? snap.data() : null;
    },
    savePerson: (id, patch) => db.doc(`igAutoDmPeople/${id}`).set(patch, { merge: true }),
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const q = req.query || {};
    const verifyToken = String(process.env.IG_VERIFY_TOKEN || "").trim() || DEFAULT_VERIFY_TOKEN;
    if (verifyToken && q["hub.mode"] === "subscribe" && q["hub.verify_token"] === verifyToken) {
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    return res.status(403).end();
  }
  if (req.method !== "POST") return res.status(405).end();

  const secret = String(process.env.IG_APP_SECRET || "").trim();
  if (!secret) {
    console.error("Instagram webhook: IG_APP_SECRET is not set for this deployment");
    return res.status(500).end();
  }
  const raw = await rawBody(req);
  if (!verifySignature(raw, req.headers["x-hub-signature-256"], secret)) {
    console.error("Instagram webhook: invalid signature");
    return res.status(403).end();
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return res.status(400).end();
  }

  const events = readEvents(payload, keywords());
  if (!events.length) return res.status(200).json({ ok: true, events: 0 });

  const db = adminDb();
  const token = await currentToken(db);
  if (!token) {
    console.error("Instagram webhook: no IG_ACCESS_TOKEN — comment left unanswered");
    return res.status(200).json({ ok: false, reason: "no-token" });
  }
  // Answer only after the work: Vercel may stop the function once the
  // response is out. Always 200 — a non-2xx makes Meta resend the batch, and
  // a comment it already handled is skipped anyway.
  const results = await handleEvents(events, { graph: graphClient(token), ...firestoreDeps(db) });
  return res.status(200).json({ ok: true, results });
}
