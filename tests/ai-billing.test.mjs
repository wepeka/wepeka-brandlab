import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { reserveCall, releaseCall, MAX_INFLIGHT, LEASE_TTL_MS, ADMIN_UIDS } from "../api/_aiQuota.js";

// api/ai.js reads its provider key when it loads — set a fake one first,
// and never let a test reach a real provider (globalThis.fetch is faked
// below for every handler test).
process.env.DEEPSEEK_API_KEY = "test-key";
delete process.env.AI_PROVIDER;
const { handleAiRequest, freeSpecFor, isHandoffOnly, fitHistory, cleanHistory, runAttempt, withOneRetry } = await import("../api/ai.js");

// ---------------------------------------------------------------------------
// A fake Firestore with the concurrency behaviour that matters here: every
// read yields (so transactions started together really interleave), and a
// transaction whose reads changed before it commits is retried — the
// optimistic contention the real one resolves the same way. Without that,
// "parallel calls can't overspend" would be true of any code.
const tick = () => new Promise((r) => setImmediate(r));
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
function fakeFirestore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, { data: clone(v), v: 1 }]));
  const ver = (p) => docs.get(p)?.v ?? 0;
  const snap = (d) => ({ exists: !!d, data: () => (d ? clone(d.data) : undefined) });
  const db = {
    retries: 0,
    doc(path) {
      return {
        path,
        async get() {
          await tick();
          return snap(docs.get(path));
        },
      };
    },
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const reads = new Map();
        const writes = [];
        const tx = {
          async get(ref) {
            await tick();
            reads.set(ref.path, ver(ref.path));
            return snap(docs.get(ref.path));
          },
          set(ref, data, opts) {
            writes.push([ref.path, clone(data), opts]);
          },
        };
        const result = await fn(tx);
        await tick();
        if ([...reads].some(([p, v]) => ver(p) !== v)) {
          db.retries++;
          continue;
        }
        for (const [p, data, opts] of writes) docs.set(p, { data: opts?.merge ? { ...(docs.get(p)?.data || {}), ...data } : data, v: ver(p) + 1 });
        return result;
      }
      throw new Error("fake firestore: too much contention");
    },
    read: (path) => clone(docs.get(path)?.data),
    write: (path, data) => docs.set(path, { data: clone(data), v: ver(path) + 1 }),
  };
  return db;
}

const NOW = new Date("2026-10-06T05:00:00Z"); // 12:00 WIB
const TODAY = "2026-10-06";
const MONTH = "2026-10";
let seq = 0;
const lease = () => `lease-${++seq}`;

// ---------------------------------------------------------------------------
describe("reserveCall: charged before the call, so parallel calls can't overspend", () => {
  test("1 top-up credit left, 6 calls at once → exactly one gets it", async () => {
    const db = fakeFirestore({
      "aiUsage/u": { date: TODAY, count: 20, month: MONTH, monthCount: 20, totalCount: 20 },
      "accounts/u": { plan: "starter", status: "active", aiCredits: 1 },
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => reserveCall(db, "u", { period: "day", limit: 20, leaseId: lease(), maxInflight: Infinity, now: NOW })));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => r.ok).kind, "credits");
    assert.ok(results.filter((r) => !r.ok).every((r) => r.error === "quota"));
    assert.equal(db.read("accounts/u").aiCredits, 0);
    assert.equal(db.read("aiUsage/u").count, 20); // the plan was never charged "one over"
    assert.ok(db.retries > 0, "the fake really made the transactions collide");
  });

  test("1 plan credit left, 5 calls at once → one charged to the plan, the rest refused", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 19, month: MONTH, monthCount: 19, totalCount: 40 }, "accounts/u": { plan: "starter" } });
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveCall(db, "u", { period: "day", limit: 20, leaseId: lease(), maxInflight: Infinity, now: NOW })));
    assert.deepEqual(results.filter((r) => r.ok).map((r) => [r.kind, r.used]), [["plan", 20]]);
    assert.equal(db.read("aiUsage/u").count, 20);
  });

  test("spending order is unchanged: plan → AI Sepuasnya → top-up credits", async () => {
    const db = fakeFirestore({
      "aiUsage/u": { date: TODAY, count: 19 },
      "accounts/u": { plan: "starter", aiUnlimitedUntil: NOW.getTime() + 1e9, aiCredits: 5 },
    });
    const opts = () => ({ period: "day", limit: 20, leaseId: lease(), maxInflight: Infinity, now: NOW });
    assert.equal((await reserveCall(db, "u", opts())).kind, "plan");
    assert.equal((await reserveCall(db, "u", opts())).kind, "daily");
    assert.equal(db.read("accounts/u").aiCredits, 5); // untouched while Sepuasnya runs
    db.write("accounts/u", { plan: "starter", aiUnlimitedUntil: NOW.getTime() - 1, aiCredits: 5 });
    assert.equal((await reserveCall(db, "u", opts())).kind, "credits");
    assert.equal(db.read("accounts/u").aiCredits, 4);
  });

  test("trial total and Founder month periods count the right window", async () => {
    const db = fakeFirestore({ "aiUsage/t": { totalCount: 59 }, "aiUsage/f": { month: "2026-09", monthCount: 300 } });
    const t = await reserveCall(db, "t", { period: "total", limit: 60, leaseId: lease(), now: NOW });
    assert.deepEqual([t.ok, t.used], [true, 60]);
    assert.equal((await reserveCall(db, "t", { period: "total", limit: 60, leaseId: lease(), now: NOW })).error, "quota");
    const f = await reserveCall(db, "f", { period: "month", limit: 300, leaseId: lease(), now: NOW }); // new month
    assert.deepEqual([f.ok, f.used], [true, 1]);
  });

  test("admin stays unmetered", async () => {
    const db = fakeFirestore({ "aiUsage/a": { date: TODAY, count: 5000 } });
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveCall(db, ADMIN_UIDS[0], { period: "day", limit: Infinity, leaseId: lease(), maxInflight: Infinity, now: NOW })));
    assert.ok(results.every((r) => r.ok && r.kind === "plan"));
  });
});

describe("releaseCall: refunds exactly what was reserved, once", () => {
  test("a failed call gives the plan credit back, and only once", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 3, month: MONTH, monthCount: 3, totalCount: 9 } });
    const id = lease();
    await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW });
    assert.equal(db.read("aiUsage/u").count, 4);
    const first = await releaseCall(db, "u", id, { outcome: "fail", period: "day", now: NOW });
    assert.deepEqual([first.refunded, first.used], [true, 3]);
    const second = await releaseCall(db, "u", id, { outcome: "fail", period: "day", now: NOW });
    assert.deepEqual([second.released, second.refunded], [false, false]);
    assert.deepEqual(db.read("aiUsage/u"), { date: TODAY, count: 3, month: MONTH, monthCount: 3, totalCount: 9 });
    assert.deepEqual(db.read("aiInflight/u").leases, {});
  });

  test("two refunds racing each other still refund once", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 3, month: MONTH, monthCount: 3, totalCount: 3 } });
    const id = lease();
    await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW });
    const both = await Promise.all([releaseCall(db, "u", id, { outcome: "fail", now: NOW }), releaseCall(db, "u", id, { outcome: "fail", now: NOW })]);
    assert.equal(both.filter((r) => r.refunded).length, 1);
    assert.equal(db.read("aiUsage/u").count, 3);
  });

  test("a top-up credit goes back to the top-up credits, not the plan", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 20, month: MONTH, monthCount: 20, totalCount: 20 }, "accounts/u": { plan: "starter", aiCredits: 2 } });
    const id = lease();
    assert.equal((await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW })).kind, "credits");
    assert.equal(db.read("accounts/u").aiCredits, 1);
    await releaseCall(db, "u", id, { outcome: "fail", now: NOW });
    assert.equal(db.read("accounts/u").aiCredits, 2);
    assert.equal(db.read("aiUsage/u").count, 20);
  });

  test("an AI Sepuasnya call is given back to AI Sepuasnya's counter", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 20, extraDate: TODAY, extraCount: 7 }, "accounts/u": { plan: "starter", aiUnlimitedUntil: NOW.getTime() + 1e9, aiCredits: 3 } });
    const id = lease();
    assert.equal((await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW })).kind, "daily");
    await releaseCall(db, "u", id, { outcome: "fail", now: NOW });
    assert.equal(db.read("aiUsage/u").extraCount, 7);
    assert.equal(db.read("accounts/u").aiCredits, 3);
  });

  test("a successful call keeps its charge and frees its slot", async () => {
    const db = fakeFirestore({});
    const id = lease();
    await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW });
    const r = await releaseCall(db, "u", id, { outcome: "ok", period: "day", now: NOW });
    assert.deepEqual([r.released, r.refunded], [true, false]);
    assert.equal(db.read("aiUsage/u").count, 1);
    assert.deepEqual(db.read("aiInflight/u").leases, {});
  });

  test("a call that ran past midnight doesn't take a credit off the new day", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 5, month: MONTH, monthCount: 5, totalCount: 5 } });
    const id = lease();
    await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: new Date("2026-10-06T16:59:30Z") }); // 23:59:30 WIB
    db.write("aiUsage/u", { ...db.read("aiUsage/u"), date: "2026-10-07", count: 2 }); // the new day already started
    await releaseCall(db, "u", id, { outcome: "fail", now: new Date("2026-10-06T17:01:00Z") });
    assert.equal(db.read("aiUsage/u").count, 2);
    assert.equal(db.read("aiUsage/u").totalCount, 5);
  });

  test("a handoff-only reply is refunded as one of today's free calls — while they last", async () => {
    const db = fakeFirestore({ "aiUsage/u": { date: TODAY, count: 4, freeDate: TODAY, freeCount: 148 } });
    for (const expected of [true, true, false]) {
      const id = lease();
      await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW });
      const r = await releaseCall(db, "u", id, { outcome: "handoff", freeLimit: 150, now: NOW });
      assert.equal(r.refunded, expected);
    }
    assert.equal(db.read("aiUsage/u").count, 5); // two refunded, the third (over the free cap) charged
    assert.equal(db.read("aiUsage/u").freeCount, 150);
  });

  test("a free call that fails gives its free slot back", async () => {
    const db = fakeFirestore({ "aiUsage/u": { freeDate: TODAY, freeCount: 10 } });
    const id = lease();
    assert.equal((await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, free: true, freeLimit: 150, now: NOW })).kind, "free");
    assert.equal(db.read("aiUsage/u").freeCount, 11);
    await releaseCall(db, "u", id, { outcome: "fail", now: NOW });
    assert.equal(db.read("aiUsage/u").freeCount, 10);
    assert.equal(db.read("aiUsage/u").count, undefined); // the plan was never touched
  });

  test("past today's free allowance a free call is charged like any other", async () => {
    const db = fakeFirestore({ "aiUsage/u": { freeDate: TODAY, freeCount: 150 } });
    const r = await reserveCall(db, "u", { period: "day", limit: 20, leaseId: lease(), free: true, freeLimit: 150, now: NOW });
    assert.equal(r.kind, "plan");
  });
});

describe("in-flight guard (not a usage cap)", () => {
  test(`at most ${MAX_INFLIGHT} calls in flight; the rest are refused uncharged`, async () => {
    const db = fakeFirestore({ "accounts/u": { plan: "pro" } });
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveCall(db, "u", { period: "day", limit: 60, leaseId: lease(), now: NOW })));
    assert.equal(results.filter((r) => r.ok).length, MAX_INFLIGHT);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.error === "busy"));
    assert.equal(db.read("aiUsage/u").count, MAX_INFLIGHT); // only the calls that run are charged
  });

  test("a slot comes back when its call ends", async () => {
    const db = fakeFirestore({});
    const ids = [lease(), lease(), lease()];
    for (const id of ids) assert.ok((await reserveCall(db, "u", { period: "day", limit: 60, leaseId: id, now: NOW })).ok);
    assert.equal((await reserveCall(db, "u", { period: "day", limit: 60, leaseId: lease(), now: NOW })).error, "busy");
    await releaseCall(db, "u", ids[0], { outcome: "ok", now: NOW });
    assert.ok((await reserveCall(db, "u", { period: "day", limit: 60, leaseId: lease(), now: NOW })).ok);
  });

  test("leases of calls that died expire, so nobody is locked out", async () => {
    const stale = NOW.getTime() - LEASE_TTL_MS - 1;
    const db = fakeFirestore({ "aiInflight/u": { leases: { a: { at: stale, kind: "plan" }, b: { at: stale, kind: "plan" }, c: { at: stale, kind: "plan" } } } });
    const r = await reserveCall(db, "u", { period: "day", limit: 60, leaseId: "fresh", now: NOW });
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(db.read("aiInflight/u").leases), ["fresh"]); // the dead ones were cleaned up
    const fresh = NOW.getTime() - LEASE_TTL_MS + 5000;
    const busy = fakeFirestore({ "aiInflight/u": { leases: { a: { at: fresh }, b: { at: fresh }, c: { at: fresh } } } });
    assert.equal((await reserveCall(busy, "u", { period: "day", limit: 60, leaseId: lease(), now: NOW })).error, "busy");
  });

  test("AI Sepuasnya is never refused for usage — hundreds of calls a day go through", async () => {
    const db = fakeFirestore({
      "aiUsage/u": { date: TODAY, count: 20, extraDate: TODAY, extraCount: 100000 },
      "accounts/u": { plan: "starter", aiUnlimitedUntil: NOW.getTime() + 1e9, aiCredits: 0 },
    });
    for (let i = 0; i < 300; i++) {
      const id = lease();
      const r = await reserveCall(db, "u", { period: "day", limit: 20, leaseId: id, now: NOW });
      assert.equal(r.kind, "daily");
      await releaseCall(db, "u", id, { outcome: "ok", now: NOW });
    }
    assert.equal(db.read("aiUsage/u").extraCount, 100300);
  });
});

// ---------------------------------------------------------------------------
describe("free calls (countUsage:false) must look like the feature they name", () => {
  const route = { system: "x".repeat(1500), user: "kenapa reach turun?" };
  test("the app's own calls fit", () => {
    assert.equal(freeSpecFor("test", { system: "Reply with exactly: OK", user: "ping" })?.out, 16);
    assert.equal(freeSpecFor("route", route)?.out, 16);
    assert.ok(freeSpecFor("lessons", { system: "x".repeat(900), user: "y".repeat(27000), json: true }));
    assert.ok(freeSpecFor("concept", { system: "x".repeat(15000), user: "y".repeat(82000), json: true }));
    assert.ok(freeSpecFor("campaign", { system: "x".repeat(28000), user: "Write the plan now.", json: true }));
    assert.ok(freeSpecFor("sales", { system: "x".repeat(27500), user: "y".repeat(8000), json: true }));
  });
  test("anything bigger or differently shaped is charged", () => {
    assert.equal(freeSpecFor("route", { ...route, user: "y".repeat(9000) }), null); // over its input cap
    assert.equal(freeSpecFor("route", { ...route, stream: true }), null);
    assert.equal(freeSpecFor("route", { ...route, history: [{ role: "user", content: "a" }] }), null);
    assert.equal(freeSpecFor("route", { ...route, images: ["data:image/png;base64,AAAA"] }), null);
    assert.equal(freeSpecFor("lessons", { system: "x", user: "y", json: false }), null); // lessons always asks for JSON
    assert.equal(freeSpecFor("route", { ...route, json: true }), null);
    assert.equal(freeSpecFor("consultant", route), null);
    for (const sneaky of ["constructor", "__proto__", "toString", "", undefined, { feature: "route" }]) assert.equal(freeSpecFor(sneaky, route), null, String(sneaky));
  });
});

describe("handoff-only replies", () => {
  test("only a reply that is nothing but hand-off lines counts", () => {
    assert.ok(isHandoffOnly("[[handoff:brainstorm]]"));
    assert.ok(isHandoffOnly("  [[handoff:Companion]]\n"));
    assert.ok(!isHandoffOnly("Sip! [[handoff:brainstorm]]"));
    assert.ok(!isHandoffOnly("[[handoff:brainstorm]] ini idenya: ..."));
    assert.ok(!isHandoffOnly("[[handoff:somewhere]]"));
    assert.ok(!isHandoffOnly(""));
  });
});

describe("history trimming (MAX_INPUT_CHARS)", () => {
  test("oldest turns go first, and what's left still starts with the owner", () => {
    const h = cleanHistory(Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}:`.padEnd(8000, "x") })));
    const kept = fitHistory(h, 50_000);
    assert.ok(kept.reduce((a, m) => a + m.content.length, 0) <= 50_000);
    assert.equal(kept[0].role, "user");
    assert.equal(kept.at(-1).content, h.at(-1).content);
    assert.deepEqual(fitHistory(h, 1e9), h);
    assert.deepEqual(fitHistory(h, 0), []);
  });
});

describe("time budget helpers", () => {
  test("an attempt that runs out of time is aborted and fails as a timeout", async () => {
    let aborted = false;
    const started = Date.now();
    await assert.rejects(
      runAttempt(() => new Promise(() => {}), 50).catch((e) => {
        aborted = true;
        throw e;
      }),
      (e) => e.code === "timeout" && e.status === 504
    );
    assert.ok(aborted && Date.now() - started < 1000);
  });
  test("silence longer than the idle limit fails; steady deltas keep it alive", async () => {
    await assert.rejects(runAttempt(() => new Promise(() => {}), 5000, { idleMs: 40 }), (e) => e.code === "timeout");
    const steady = await runAttempt(async (touch) => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 20));
        touch();
      }
      return "done";
    }, 5000, { idleMs: 60 });
    assert.equal(steady, "done");
    // A slow first token gets its own, longer wait (the browser is still
    // waiting for the headers then, not counting silence).
    const slowStart = await runAttempt(async (touch) => {
      await new Promise((r) => setTimeout(r, 120));
      touch();
      return "started";
    }, 5000, { idleMs: 40, firstIdleMs: 400 });
    assert.equal(slowStart, "started");
  });
  test("an error that isn't a provider hiccup is never retried", async () => {
    let calls = 0;
    await assert.rejects(withOneRetry(async () => {
      calls++;
      throw new Error("bug");
    }, Date.now() + 60_000));
    assert.equal(calls, 1);
  });
});

// ---------------------------------------------------------------------------
// The whole handler (api/ai.js handleAiRequest) against a fake Firestore and
// a fake DeepSeek.
function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    chunks: [],
    ended: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      this.ended = true;
      return this;
    },
    writeHead(c) {
      this.statusCode = c;
    },
    write(s) {
      assert.ok(!this.ended, "write after end");
      this.chunks.push(s);
      return true;
    },
    end() {
      this.ended = true;
    },
  };
  return res;
}
const events = (res) => res.chunks.map((c) => c.replace(/^data: /, "").trim()).map((p) => (p === "[DONE]" ? p : JSON.parse(p)));

const providerCalls = [];
let provider = null; // (body, signal) => Response
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /api\.deepseek\.com/);
    const body = JSON.parse(opts.body);
    providerCalls.push(body);
    return provider(body, opts.signal);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});
const jsonReply = (content) => () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const sseReply = (parts, { stallAfter = false } = {}) => (_body, signal) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const p of parts) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
        if (stallAfter) {
          signal?.addEventListener("abort", () => c.error(new Error("aborted")));
          return;
        }
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    }),
    { status: 200 }
  );
const neverAnswers = () => (_body, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

const starter = () => ({ "accounts/u": { plan: "starter", status: "active" } });
async function call(db, body, { uid = "u", startedAt } = {}) {
  const res = fakeRes();
  providerCalls.length = 0;
  await handleAiRequest({ body }, res, { db, uid, startedAt });
  return res;
}

describe("api/ai.js handler: charge, call, refund", () => {
  test("a normal reply is charged once and reports the new count", async () => {
    const db = fakeFirestore(starter());
    provider = jsonReply("Halo!");
    const res = await call(db, { system: "s", user: "u", feature: "copy" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { text: "Halo!", usage: { used: 1, limit: 20, period: "day" } });
    assert.equal(db.read("aiUsage/u").count, 1);
    assert.deepEqual(db.read("aiInflight/u").leases, {});
  });

  test("a provider error refunds the credit (once) and reports the error", async () => {
    const db = fakeFirestore(starter());
    provider = () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "provider");
    assert.equal(db.read("aiUsage/u").count, 0);
    assert.deepEqual(db.read("aiInflight/u").leases, {});
  });

  test("a provider hiccup is retried once while there's time, then refunded", async () => {
    const db = fakeFirestore(starter());
    provider = () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(providerCalls.length, 2);
    assert.equal(res.statusCode, 502);
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("no retry when the budget can't fit one", async () => {
    const db = fakeFirestore(starter());
    provider = () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
    // 110 s budget, 100 s gone: 10 s left, under the 15 s a retry needs.
    await call(db, { system: "s", user: "u" }, { startedAt: Date.now() - 100_000 });
    assert.equal(providerCalls.length, 1);
  });

  test("an empty reply is refunded", async () => {
    const db = fakeFirestore(starter());
    provider = jsonReply("   ");
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.usage.used, 0);
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("a provider that never answers runs into the budget: 504, refunded, request aborted", async () => {
    const db = fakeFirestore(starter());
    let signal;
    provider = (_b, s) => {
      signal = s;
      return neverAnswers()(_b, s);
    };
    const started = Date.now();
    const res = await call(db, { system: "s", user: "u" }, { startedAt: Date.now() - 110_000 + 300 });
    assert.ok(Date.now() - started < 5000);
    assert.equal(res.statusCode, 504);
    assert.equal(res.body.error, "timeout");
    assert.ok(signal.aborted);
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("headers at once, then a body that never ends (DeepSeek's keep-alive) is still cut by the budget", async () => {
    const db = fakeFirestore(starter());
    let bodyAborted = false;
    provider = (_b, signal) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("\n\n")); // keep-alive blank lines, no answer yet
            signal.addEventListener("abort", () => {
              bodyAborted = true;
              c.error(new Error("aborted"));
            });
          },
        }),
        { status: 200 }
      );
    const res = await call(db, { system: "s", user: "u" }, { startedAt: Date.now() - 110_000 + 300 });
    assert.equal(res.statusCode, 504);
    assert.ok(bodyAborted);
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("a stream is charged; a stream that is only a hand-off is refunded", async () => {
    const db = fakeFirestore(starter());
    provider = sseReply(["Ide ", "pertama..."]);
    let res = await call(db, { system: "s", user: "u", stream: true, feature: "brainstorm" });
    assert.deepEqual(events(res), [{ delta: "Ide " }, { delta: "pertama..." }, "[DONE]"]);
    assert.equal(db.read("aiUsage/u").count, 1);
    provider = sseReply(["[[hand", "off:brainstorm]]"]);
    res = await call(db, { system: "s", user: "u", stream: true, feature: "consultant" });
    assert.equal(events(res).at(-1), "[DONE]");
    assert.equal(db.read("aiUsage/u").count, 1); // refunded
    assert.equal(db.read("aiUsage/u").freeCount, 1); // paid for with a free call
  });

  test("a non-streamed hand-off (Teman) is refunded too", async () => {
    const db = fakeFirestore(starter());
    provider = jsonReply("[[handoff:consultant]]");
    const res = await call(db, { system: "s", user: "u", feature: "companion" });
    assert.equal(res.body.usage.used, 0);
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("a stream that stalls part-way is cut by the budget, ends cleanly and is refunded", async () => {
    const db = fakeFirestore(starter());
    provider = sseReply(["Setengah "], { stallAfter: true });
    const res = await call(db, { system: "s", user: "u", stream: true }, { startedAt: Date.now() - 160_000 + 300 });
    const ev = events(res);
    assert.deepEqual(ev[0], { delta: "Setengah " });
    assert.equal(ev.at(-2).error, "timeout");
    assert.equal(ev.at(-1), "[DONE]");
    assert.equal(db.read("aiUsage/u").count, 0);
  });

  test("streams can't ask for more than 4,096 tokens", async () => {
    const db = fakeFirestore(starter());
    provider = sseReply(["ok"]);
    await call(db, { system: "s", user: "u", stream: true, maxTokens: 8192 });
    assert.equal(providerCalls[0].max_tokens, 4096);
  });

  test("a free background call is free and short; dressed-up ones are charged", async () => {
    const db = fakeFirestore(starter());
    provider = jsonReply("data");
    await call(db, { system: "x".repeat(1500), user: "kenapa reach turun?", maxTokens: 5000, countUsage: false, feature: "route" });
    assert.equal(providerCalls[0].max_tokens, 16);
    assert.equal(db.read("aiUsage/u").count ?? 0, 0);
    assert.equal(db.read("aiUsage/u").freeCount, 1);
    // Same feature name, but a big prompt / a stream / another json mode → a normal call.
    await call(db, { system: "x".repeat(1500), user: "y".repeat(20_000), maxTokens: 5000, countUsage: false, feature: "route" });
    assert.equal(providerCalls[0].max_tokens, 5000);
    await call(db, { system: "s", user: "u", countUsage: false, feature: "lessons", json: false });
    await call(db, { system: "s", user: "u", countUsage: false, feature: "constructor" });
    assert.equal(typeof providerCalls[0].max_tokens, "number");
    assert.equal(db.read("aiUsage/u").count, 3);
    assert.equal(db.read("aiUsage/u").freeCount, 1);
  });

  test("a 4th call while 3 are running is refused with 'busy' and costs nothing", async () => {
    const at = Date.now();
    const db = fakeFirestore({ ...starter(), "aiInflight/u": { leases: { a: { at, kind: "plan" }, b: { at, kind: "plan" }, c: { at, kind: "plan" } } } });
    provider = jsonReply("x");
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, "busy");
    assert.equal(providerCalls.length, 0);
    assert.equal(db.read("aiUsage/u"), undefined);
  });

  test("out of credits is still the same 429 quota answer", async () => {
    const db = fakeFirestore({ ...starter(), "aiUsage/u": { date: TODAY_JKT(), count: 20 } });
    provider = jsonReply("x");
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, "quota");
    assert.deepEqual([res.body.limit, res.body.period, res.body.usage.used], [20, "day", 20]);
    assert.equal(providerCalls.length, 0);
  });

  test("AI Sepuasnya with a huge day still gets its answer", async () => {
    const db = fakeFirestore({
      "accounts/u": { plan: "starter", status: "active", aiUnlimitedUntil: Date.now() + 1e9 },
      "aiUsage/u": { date: TODAY_JKT(), count: 20, extraDate: TODAY_JKT(), extraCount: 99999 },
    });
    provider = jsonReply("Siap!");
    const res = await call(db, { system: "s", user: "u" });
    assert.equal(res.statusCode, 200);
    assert.equal(db.read("aiUsage/u").extraCount, 100000);
  });

  test("a very long chat is trimmed from its oldest turns instead of refused", async () => {
    const db = fakeFirestore(starter());
    provider = sseReply(["ok"]);
    const history = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i}`.padEnd(8000, "x") }));
    const res = await call(db, { system: "s".repeat(60_000), user: "pertanyaan", stream: true, history });
    assert.equal(res.statusCode, 200);
    const msgs = providerCalls[0].messages;
    const total = msgs.reduce((a, m) => a + m.content.length, 0);
    assert.ok(total <= 160_000, String(total));
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs.at(-2).content, history.at(-1).content); // the newest turn survives
    const tooBig = await call(db, { system: "s".repeat(170_000), user: "u" });
    assert.equal(tooBig.statusCode, 413);
  });
});

function TODAY_JKT() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
