// Logging out leaves nothing of the previous person in this tab's
// sessionStorage (audit S-25).
import { test } from "node:test";
import assert from "node:assert/strict";

test("logout clears sessionStorage", async () => {
  const store = new Map([["copyStudio:b1", "draft"], ["lastBrand", "b1"]]);
  globalThis.sessionStorage = { clear: () => store.clear(), getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { logout } = await import("../js/auth.js");
  await logout();
  assert.equal(store.size, 0);
});
