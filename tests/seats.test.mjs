// Founder / Agency seat holds (audit S-17): the math in api/_plans.js and
// the transaction glue in api/_seats.js against a tiny in-memory Firestore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PLANS, HOLD_MS, holdKeyFor, seatsTaken, reserveSeat, convertSeat, releaseSeat, seatFields } from "../api/_plans.js";
import { holdSeat, releaseHold } from "../api/_seats.js";
import { seatsTakenOf } from "../js/views/pricing.js";

const now = Date.UTC(2026, 9, 1, 3);
const F = "founderSlotsSold";
const founder = PLANS.founder;

describe("seat holds: the math", () => {
  test("a live hold counts like a sold seat; an expired one doesn't", () => {
    const doc = { [F]: 10, holds: { [F]: { a: now + 1000, b: now - 1 } } };
    assert.equal(seatsTaken(doc, F, now), 11);
    assert.equal(seatsTakenOf(doc, F, now), 11, "the pricing page counts the same way");
  });
  test("the price wave follows sold + held: the 15th seat held, the next buyer pays the second wave", () => {
    const doc = { [F]: 14 };
    const first = reserveSeat(doc, F, "a", founder, now);
    assert.equal(first.price, 499000);
    const second = reserveSeat({ ...doc, holds: { [F]: first.holds } }, F, "b", founder, now);
    assert.equal(second.price, 699000);
  });
  test("concurrent buyers at the last seat: the second is refused", () => {
    const doc = { [F]: 49 };
    const first = reserveSeat(doc, F, "a", founder, now);
    assert.ok(first);
    assert.equal(reserveSeat({ ...doc, holds: { [F]: first.holds } }, F, "b", founder, now), null);
  });
  test("reopening your own checkout refreshes your hold instead of taking a second seat", () => {
    const doc = { [F]: 49, holds: { [F]: { a: now + 1000 } } };
    const again = reserveSeat(doc, F, "a", founder, now);
    assert.deepEqual(again.holds, { a: now + HOLD_MS });
  });
  test("a hold drops expired ones from the map", () => {
    const r = reserveSeat({ [F]: 1, holds: { [F]: { old: now - 5 } } }, F, "a", founder, now);
    assert.deepEqual(Object.keys(r.holds), ["a"]);
  });
  test("paying converts the hold into a sale", () => {
    const c = convertSeat({ [F]: 20, holds: { [F]: { a: now + 1000, b: now + 1000 } } }, F, "a", now);
    assert.deepEqual(c, { sold: 21, holds: { b: now + 1000 }, overCap: false });
  });
  test("a payment whose hold had lapsed and the seat went elsewhere is past the cap", () => {
    assert.equal(convertSeat({ [F]: 50 }, F, "a", now).overCap, true);
  });
  test("an expired order gives back only the hold it made", () => {
    const doc = { holds: { [F]: { a: now + 1000 } } };
    assert.deepEqual(releaseSeat(doc, F, "a", now + 1000, now), {});
    assert.deepEqual(releaseSeat(doc, F, "a", now + 999, now), { a: now + 1000 }, "refreshed by a newer checkout: kept");
  });
  test("hold keys are opaque, stable per account", () => {
    assert.equal(holdKeyFor("uid-1"), holdKeyFor("uid-1"));
    assert.notEqual(holdKeyFor("uid-1"), holdKeyFor("uid-2"));
    assert.doesNotMatch(holdKeyFor("uid-1"), /uid/);
  });
  test("writes replace the slot's holds map whole", () => {
    assert.deepEqual(seatFields(F, { sold: 3, holds: {} }).update, { [`holds.${F}`]: {}, [F]: 3 });
    assert.deepEqual(seatFields(F, { holds: { a: 1 } }).set, { holds: { [F]: { a: 1 } } });
  });
});

// Just enough of the Admin SDK for one doc: get/set/update with dotted paths.
function fakeDb(initial) {
  let data = initial;
  const ref = { path: "meta/founderSlots" };
  const snap = () => ({ exists: data !== undefined, data: () => data });
  const apply = {
    set: (_r, v) => { data = structuredClone(v); },
    update: (_r, v) => {
      data = structuredClone(data);
      for (const [path, value] of Object.entries(v)) {
        const parts = path.split(".");
        let o = data;
        for (const p of parts.slice(0, -1)) o = o[p] ??= {};
        o[parts.at(-1)] = value;
      }
    },
  };
  return {
    doc: () => ref,
    runTransaction: async (fn) => fn({ get: async () => snap(), ...apply }),
    read: () => data,
  };
}

describe("seat holds: the transaction glue", () => {
  test("holding on a fresh doc, then releasing", async () => {
    const db = fakeDb(undefined);
    const r = await holdSeat(db, founder, "uid-1", now);
    assert.equal(r.price, 499000);
    assert.deepEqual(db.read(), { holds: { [F]: { [holdKeyFor("uid-1")]: now + HOLD_MS } } });
    await releaseHold(db, r.hold, now);
    assert.deepEqual(db.read().holds[F], {});
  });
  test("a sold-out slot holds nothing", async () => {
    const db = fakeDb({ [F]: 50 });
    assert.equal(await holdSeat(db, founder, "uid-1", now), null);
  });
});
