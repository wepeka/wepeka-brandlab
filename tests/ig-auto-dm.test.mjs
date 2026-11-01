// Instagram comment → DM (api/_igAutoDm.js + api/instagram/webhook.js): what
// counts as "Branding", which webhook events we act on, what goes out to
// Instagram and in which order. No network, no Firestore — fakes for both.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  hasKeyword, isKeywordOnly, keywords, verifySignature, readEvents, handleEvents, publicReply, refreshToken,
  COPY, LINK, LINK_PAYLOAD, openerMessage, openerFallback, linkMessage, DM_COOLDOWN_MS,
} from "../api/_igAutoDm.js";
import handler, { metaJson, rawBody } from "../api/instagram/webhook.js";

const ACCOUNT = "17841400000000001";
const commentPayload = (text, { from = "555", id = "c1" } = {}) => ({
  object: "instagram",
  entry: [{ id: ACCOUNT, time: 1, changes: [{ field: "comments", value: { id, text, from: { id: from, username: "rani.store" }, media: { id: "m1" } } }] }],
});
const messagingPayload = (m) => ({ object: "instagram", entry: [{ id: ACCOUNT, time: 1, messaging: [{ sender: { id: "777" }, recipient: { id: ACCOUNT }, ...m }] }] });

function fakeDeps({ refuse = () => false } = {}) {
  const calls = [];
  const claimed = new Set();
  const people = new Map();
  return {
    calls, people,
    graph: async (path, body) => {
      calls.push({ path, body });
      if (refuse(path, body)) throw new Error("refused");
      return { ok: true };
    },
    claimComment: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    person: async (id) => people.get(id) || null,
    savePerson: async (id, patch) => people.set(id, { ...(people.get(id) || {}), ...patch }),
    now: 1_000_000_000,
  };
}

describe("what counts as the keyword", () => {
  test("the word anywhere, any case, with punctuation or a hashtag", () => {
    for (const t of ["Branding", "branding!!", "BRANDING 🔥", "#branding", "mau branding kak", "Branding."]) assert.ok(hasKeyword(t, ["branding"]), t);
  });
  test("not inside another word", () => {
    for (const t of ["rebranding", "brandingnya keren", "brand", ""]) assert.equal(hasKeyword(t, ["branding"]), false, t);
  });
  test("IG_AUTODM_KEYWORDS adds more", () => {
    assert.deepEqual(keywords({ IG_AUTODM_KEYWORDS: " Branding, BrandLab ," }), ["branding", "brandlab"]);
    assert.deepEqual(keywords({}), ["branding"]);
  });
  test("a DM triggers only when it is the keyword alone", () => {
    assert.ok(isKeywordOnly("Branding 🙏", ["branding"]));
    assert.equal(isKeywordOnly("kak aku mau tanya soal branding", ["branding"]), false);
  });
});

describe("reading Meta's webhook", () => {
  test("a matching comment from someone else", () => {
    assert.deepEqual(readEvents(commentPayload("Branding"), ["branding"]), [
      { kind: "comment", accountId: ACCOUNT, commentId: "c1", fromId: "555", username: "rani.store", text: "Branding" },
    ]);
  });
  test("our own comments and other words are ignored", () => {
    assert.deepEqual(readEvents(commentPayload("Branding", { from: ACCOUNT }), ["branding"]), []);
    assert.deepEqual(readEvents(commentPayload("keren kak"), ["branding"]), []);
    assert.deepEqual(readEvents({ object: "page", entry: [] }), []);
  });
  test("the button tap, a quick reply and a keyword DM ask for the link", () => {
    assert.equal(readEvents(messagingPayload({ postback: { payload: LINK_PAYLOAD, title: "Mau dong" } }))[0].via, "button");
    assert.equal(readEvents(messagingPayload({ message: { mid: "x", text: "Mau", quick_reply: { payload: LINK_PAYLOAD } } }))[0].via, "button");
    assert.equal(readEvents(messagingPayload({ message: { mid: "x", text: "branding" } }), ["branding"])[0].via, "dm");
  });
  test("normal DMs and our own echoes are left alone", () => {
    assert.deepEqual(readEvents(messagingPayload({ message: { mid: "x", text: "halo kak, harga berapa?" } })), []);
    assert.deepEqual(readEvents(messagingPayload({ message: { mid: "x", text: "branding", is_echo: true } }), ["branding"]), []);
  });
});

describe("the messages", () => {
  test("Instagram's length limits", () => {
    assert.ok(COPY.openerButton.length <= 20 && COPY.linkButton.length <= 20);
    assert.ok(COPY.opener.length <= 640 && COPY.linkText.length <= 640);
    assert.ok(COPY.pitch.length <= 1000, `pitch is ${COPY.pitch.length}`);
    assert.ok(openerFallback().text.length <= 1000);
  });
  test("the opener's button asks for the link; the link button opens /founder with UTM", () => {
    assert.equal(openerMessage().attachment.payload.buttons[0].payload, LINK_PAYLOAD);
    assert.equal(linkMessage().attachment.payload.buttons[0].url, LINK);
    assert.match(LINK, /^https:\/\/brandlab\.wepeka\.com\/founder\?utm_source=instagram&utm_medium=dm&utm_campaign=komen_branding$/);
    assert.ok(openerFallback().text.includes(LINK) && !openerFallback().text.includes("Mau aku kirim linknya?"));
  });
  test("public replies rotate but stay the same for one comment", () => {
    assert.equal(publicReply("c1"), publicReply("c1"));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => publicReply(`1789${i}`)));
    assert.equal(seen.size, COPY.publicReplies.length);
  });
  test("no 1-on-1 promise in the pitch", () => {
    assert.doesNotMatch(COPY.pitch + COPY.opener, /1-on-1|1 on 1|video call/i);
  });
});

describe("what goes out", () => {
  test("a comment: private-reply DM with the button, then the public reply", async () => {
    const d = fakeDeps();
    const [r] = await handleEvents(readEvents(commentPayload("Branding"), ["branding"]), d);
    assert.deepEqual(r, { kind: "comment", sent: "button" });
    assert.deepEqual(d.calls.map((c) => c.path), ["me/messages", "c1/replies"]);
    assert.deepEqual(d.calls[0].body.recipient, { comment_id: "c1" });
    assert.ok(COPY.publicReplies.includes(d.calls[1].body.message));
    assert.equal(d.people.get("555").dmAt, d.now);
  });
  test("Meta sending the same comment twice → one DM", async () => {
    const d = fakeDeps();
    const ev = readEvents(commentPayload("Branding"), ["branding"]);
    await handleEvents(ev, d);
    const [again] = await handleEvents(ev, d);
    assert.equal(again.skipped, "duplicate");
    assert.equal(d.calls.length, 2);
  });
  test("the same person on another post within 24 h → no second DM, no 'cek DM'", async () => {
    const d = fakeDeps();
    await handleEvents(readEvents(commentPayload("Branding", { id: "c1" }), ["branding"]), d);
    const [r] = await handleEvents(readEvents(commentPayload("branding", { id: "c2" }), ["branding"]), d);
    assert.equal(r.skipped, "recent");
    assert.equal(d.calls.length, 2);
    // …but after a day they get it again.
    const later = { ...d, now: d.now + DM_COOLDOWN_MS + 1 };
    assert.equal((await handleEvents(readEvents(commentPayload("branding", { id: "c3" }), ["branding"]), later))[0].sent, "button");
  });
  test("button refused → the whole thing as text with the link", async () => {
    const d = fakeDeps({ refuse: (path, body) => path === "me/messages" && body.message.attachment });
    const [r] = await handleEvents(readEvents(commentPayload("Branding"), ["branding"]), d);
    assert.equal(r.sent, "text");
    assert.ok(d.calls[1].body.message.text.includes(LINK));
    assert.equal(d.calls[2].path, "c1/replies");
  });
  test("DM failing completely → no public 'cek DM' reply", async () => {
    const d = fakeDeps({ refuse: (path) => path === "me/messages" });
    const [r] = await handleEvents(readEvents(commentPayload("Branding"), ["branding"]), d);
    assert.ok(r.error);
    assert.equal(d.calls.some((c) => c.path.endsWith("/replies")), false);
  });
  test("the tap: pitch text, then the link button — once per 10 minutes", async () => {
    const d = fakeDeps();
    const ev = readEvents(messagingPayload({ postback: { payload: LINK_PAYLOAD } }));
    await handleEvents(ev, d);
    assert.deepEqual(d.calls.map((c) => c.body.message.text ? "text" : "button"), ["text", "button"]);
    assert.equal(d.calls[0].body.message.text, COPY.pitch);
    assert.deepEqual(d.calls[0].body.recipient, { id: "777" });
    assert.equal((await handleEvents(ev, d))[0].skipped, "recent");
    assert.equal(d.calls.length, 2);
  });
});

describe("the endpoint", () => {
  const SECRET = "test-secret";
  const sign = (raw) => "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  function call({ method = "POST", raw = "", headers = {}, query = {} }) {
    const req = Object.assign(Readable.from(raw ? [Buffer.from(raw)] : []), { method, headers, query });
    const out = { status: 0, body: null };
    const res = {
      status(s) { out.status = s; return res; },
      send(b) { out.body = b; return res; },
      json(b) { out.body = b; return res; },
      end() { return res; },
    };
    return handler(req, res).then(() => out);
  }

  test("Meta's verification GET echoes the challenge only with the right token", async () => {
    process.env.IG_VERIFY_TOKEN = "wepeka-verify";
    const ok = await call({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "wepeka-verify", "hub.challenge": "123" } });
    assert.deepEqual([ok.status, ok.body], [200, "123"]);
    assert.equal((await call({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" } })).status, 403);
  });
  test("an unsigned or wrongly signed POST is refused", async () => {
    process.env.IG_APP_SECRET = SECRET;
    const raw = JSON.stringify(commentPayload("Branding"));
    assert.equal((await call({ raw })).status, 403);
    assert.equal((await call({ raw, headers: { "x-hub-signature-256": sign(raw + " ") } })).status, 403);
  });
  test("a signed POST with nothing for us → 200 without touching Firestore", async () => {
    process.env.IG_APP_SECRET = SECRET;
    const raw = JSON.stringify(commentPayload("keren kak"));
    const r = await call({ raw, headers: { "x-hub-signature-256": sign(raw) } });
    assert.deepEqual([r.status, r.body], [200, { ok: true, events: 0 }]);
  });
  test("body already parsed by the runtime → Meta's own spelling rebuilt", async () => {
    const payload = { object: "instagram", entry: [{ changes: [{ value: { text: "Branding 🔥 é", url: "a/b" } }] }] };
    const metaRaw = '{"object":"instagram","entry":[{"changes":[{"value":{"text":"Branding \\ud83d\\udd25 \\u00e9","url":"a\\/b"}}]}]}';
    assert.equal(metaJson(payload), metaRaw);
    const req = Object.assign(Readable.from([]), { body: payload });
    assert.equal(await rawBody(req), metaRaw);
    assert.ok(verifySignature(metaRaw, sign(metaRaw), SECRET));
  });
});

describe("the token", () => {
  const fakeDb = (data) => {
    const store = { data };
    return { store, doc: () => ({ get: async () => ({ exists: !!store.data, data: () => store.data }), set: async (v) => { store.data = v; } }) };
  };
  test("off without a token, untouched within a week", async () => {
    assert.equal(await refreshToken(fakeDb(null), { env: {}, fetchImpl: () => assert.fail() }), "off");
    assert.equal(await refreshToken(fakeDb({ value: "t", refreshedAt: 500 }), { env: {}, now: 1000, fetchImpl: () => assert.fail() }), "fresh");
  });
  test("after a week: swapped and saved; a failure only logs", async () => {
    const db = fakeDb(null);
    const now = 10 * 86400000;
    const ok = async (url) => ({ ok: true, json: async () => (assert.match(url, /ig_refresh_token&access_token=seed$/), { access_token: "new", expires_in: 5184000 }) });
    assert.equal(await refreshToken(db, { env: { IG_ACCESS_TOKEN: "seed" }, fetchImpl: ok, now }), "refreshed");
    assert.deepEqual(db.store.data, { value: "new", refreshedAt: now, expiresAt: now + 5184000000 });
    const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "expired" } }) });
    assert.equal(await refreshToken(fakeDb({ value: "t", refreshedAt: 0 }), { env: {}, fetchImpl: bad, now }), "failed");
  });
});
