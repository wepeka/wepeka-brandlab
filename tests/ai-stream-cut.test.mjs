import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { auth } from "../js/firebase.js";
import { askBrandConsultant } from "../js/ai.js";

// The /api/ai stream (api/ai.js): `data: {"delta":"…"}` lines, an optional
// `data: {"error":…}` event, then `data: [DONE]`. A reply that never gets
// its [DONE] (or gets an error after some text) is cut off: js/ai.js still
// returns the text, and tells onText once more with { cut: true }.
function sse(events) {
  const body = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

let realFetch;
let nextResponse;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => nextResponse();
  auth.currentUser = { getIdToken: async () => "test-token" };
});
after(() => {
  globalThis.fetch = realFetch;
  auth.currentUser = null;
});

async function ask() {
  const calls = [];
  const reply = await askBrandConsultant({ provider: "deepseek" }, {
    brand: { id: "b1", name: "Kopi Senja" }, snapshotText: "", question: "gimana performa minggu ini?",
    onText: (text, meta) => calls.push({ text, meta: meta || null }),
  });
  return { reply, calls, cut: calls.some((c) => c.meta?.cut) };
}

describe("callProxy stream end", () => {
  test("a stream that ends with [DONE] is complete", async () => {
    nextResponse = () => sse([{ delta: "Halo, " }, { delta: "performanya naik." }, "[DONE]"]);
    const { reply, cut } = await ask();
    assert.equal(reply, "Halo, performanya naik.");
    assert.equal(cut, false);
  });
  test("no [DONE] (connection dropped) → cut", async () => {
    nextResponse = () => sse([{ delta: "Halo, performanya" }]);
    const { reply, calls, cut } = await ask();
    assert.equal(reply, "Halo, performanya");
    assert.equal(cut, true);
    assert.equal(calls.at(-1).text, "Halo, performanya");
  });
  test("an error event after some text → cut, text kept", async () => {
    nextResponse = () => sse([{ delta: "Halo" }, { error: "provider" }, "[DONE]"]);
    const { reply, cut } = await ask();
    assert.equal(reply, "Halo");
    assert.equal(cut, true);
  });
  test("an error before any text still throws", async () => {
    nextResponse = () => sse([{ error: "network" }, "[DONE]"]);
    await assert.rejects(ask());
  });
});
