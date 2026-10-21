import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeEmail, maskEmail, newToken, hashToken, newCode, hashCode, codeCheck, inviteState, seatsUsed, inviteLink,
  composeInviteEmail, composeCodeEmail, joinNames, CODE_MAX_ATTEMPTS,
} from "../api/_team.js";
import { TEAM_SEATS, teamSeatsFor, PLANS } from "../api/_plans.js";
import { firstShareScrub } from "../api/team.js";

const DAY = 86400000;

describe("emails, tokens, codes (api/_team.js)", () => {
  test("emails are compared trimmed and lowercased; junk is empty", () => {
    assert.equal(normalizeEmail("  Sari@Contoh.ID "), "sari@contoh.id");
    assert.equal(normalizeEmail("bukan email"), "");
    assert.equal(maskEmail("sari@contoh.id"), "s***@contoh.id");
    assert.equal(maskEmail(""), "");
  });
  test("a token is long and random; only its hash is kept", () => {
    const t = newToken();
    assert.ok(t.length >= 40);
    assert.notEqual(t, newToken());
    assert.match(hashToken(t), /^[a-f0-9]{64}$/);
  });
  test("a code is 6 digits and checked by hash, attempts and expiry", () => {
    const code = newCode();
    assert.match(code, /^\d{6}$/);
    const stored = { hash: hashCode("inv1", code), expiresAt: Date.now() + 60_000, attempts: 0 };
    assert.equal(codeCheck(stored, "inv1", code), "ok");
    assert.equal(codeCheck(stored, "inv1", code === "000000" ? "111111" : "000000"), "wrong");
    assert.equal(codeCheck(stored, "inv2", code), "wrong", "bound to its invite");
    assert.equal(codeCheck({ ...stored, attempts: CODE_MAX_ATTEMPTS }, "inv1", code), "locked");
    assert.equal(codeCheck({ ...stored, expiresAt: Date.now() - 1 }, "inv1", code), "expired");
    assert.equal(codeCheck(null, "inv1", code), "expired");
  });
  test("an invite's state", () => {
    const now = Date.now();
    assert.equal(inviteState({ status: "pending", expiresAt: now + DAY }, now), "pending");
    assert.equal(inviteState({ status: "pending", expiresAt: now - 1 }, now), "expired");
    assert.equal(inviteState({ status: "accepted", expiresAt: now + DAY }, now), "accepted");
    assert.equal(inviteState({ status: "revoked", expiresAt: now + DAY }, now), "revoked");
  });
  test("the link only points at the live app or this Mac's dev server", () => {
    assert.equal(inviteLink("abc", "http://localhost:8743"), "http://localhost:8743/#/undangan/abc");
    assert.equal(inviteLink("abc", "http://127.0.0.1:8743"), "http://127.0.0.1:8743/#/undangan/abc");
    assert.equal(inviteLink("abc", "https://evil.example"), "https://brandlab.wepeka.com/#/undangan/abc");
    assert.equal(inviteLink("abc", ""), "https://brandlab.wepeka.com/#/undangan/abc");
  });
});

describe("seats", () => {
  const now = Date.now();
  const brands = [
    { id: "b1", members: { r: { email: "rina@x.id" }, d: { email: "dimas@x.id" } } },
    { id: "b2", members: { r: { email: "rina@x.id" } } },
  ];
  test("a person on several brands counts once; pending invites for new emails count too", () => {
    assert.equal(seatsUsed(brands, [], { now }), 2);
    const invites = [
      { id: "i1", email: "sari@x.id", status: "pending", expiresAt: now + DAY },
      { id: "i2", email: "rina@x.id", status: "pending", expiresAt: now + DAY }, // already a member
      { id: "i3", email: "old@x.id", status: "pending", expiresAt: now - 1 }, // expired
      { id: "i4", email: "gone@x.id", status: "revoked", expiresAt: now + DAY },
    ];
    assert.equal(seatsUsed(brands, invites, { now }), 3);
    assert.equal(seatsUsed(brands, invites, { now, exceptInviteId: "i1" }), 2);
  });
  test("seats per plan: the owner is not a seat, every sold plan has a number", () => {
    assert.equal(teamSeatsFor({ plan: "pro" }), 3);
    assert.equal(teamSeatsFor({ plan: "founder-ultimate" }), 10);
    assert.equal(teamSeatsFor({ plan: "free" }), 0);
    assert.equal(teamSeatsFor(null), 0);
    for (const p of Object.values(PLANS)) assert.ok(Number.isInteger(TEAM_SEATS[p.plan]), p.plan);
  });
});

describe("emails", () => {
  test("the invite says who, which brands, which role, and the link", () => {
    const m = composeInviteEmail({ ownerName: "Winson", brandNames: ["Kopi Pagi", "Batik Rara"], role: "editor", link: "https://brandlab.wepeka.com/#/undangan/t", email: "sari@x.id" });
    assert.match(m.subject, /Winson mengundangmu ke tim Kopi Pagi dan Batik Rara/);
    assert.match(m.text, /Editor/);
    assert.match(m.text, /#\/undangan\/t/);
    assert.match(m.html, /Gabung ke tim/);
    assert.doesNotMatch(m.html, /<script/i);
  });
  test("names and links are escaped in the HTML", () => {
    const m = composeInviteEmail({ ownerName: "<b>x</b>", brandNames: ["A&B"], role: "viewer", link: "https://brandlab.wepeka.com/#/undangan/t", email: "a@b.id" });
    assert.doesNotMatch(m.html, /<b>x<\/b>/);
    assert.match(m.html, /A&amp;B/);
  });
  test("the code email shows the code", () => {
    const m = composeCodeEmail({ code: "481072", ownerName: "Winson", brandNames: ["Kopi Pagi"] });
    assert.match(m.subject, /481072/);
    assert.match(m.html, /481072/);
  });
  test("joinNames", () => {
    assert.equal(joinNames(["A"]), "A");
    assert.equal(joinNames(["A", "B", "C"]), "A, B dan C");
  });
});

describe("first share: what leaves the brand doc before members can read it", () => {
  test("Instagram/Facebook/ads tokens move to private, the owner's chats to people/", () => {
    const s = firstShareScrub({
      instagram: { username: "kopipagi", igUserId: "1", accessToken: "IG" },
      facebook: { pageId: "2", pageName: "Kopi", pageAccessToken: "FB" },
      ads: { accountId: "3", accessToken: "AD" },
      chatSessions: [{ id: "s1" }],
      companion: { lastAskedAt: 1 },
    });
    assert.deepEqual(s.secrets, { instagram: { accessToken: "IG" }, facebook: { pageAccessToken: "FB" }, ads: { accessToken: "AD" } });
    assert.deepEqual(s.brandPatch.instagram, { username: "kopipagi", igUserId: "1" });
    assert.deepEqual(s.brandPatch.facebook, { pageId: "2", pageName: "Kopi" });
    assert.deepEqual(s.brandPatch.ads, { accountId: "3" });
    assert.deepEqual(s.personal, { chatSessions: [{ id: "s1" }], companion: { lastAskedAt: 1 } });
  });
  test("nothing to move → null", () => {
    assert.equal(firstShareScrub({ name: "x", instagram: { username: "a" } }), null);
  });
});
