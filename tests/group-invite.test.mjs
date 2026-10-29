// "Gabung grup WhatsApp" email (api/_community.js composeGroupInviteEmail,
// sent by api/announcements/group-invite.js): Lifetime accounts get both
// groups, everyone else only the general one. No network, no Firestore.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeGroupInviteEmail, announcementRecipients, composeAnnouncementEmail,
  BRANDLAB_WA_GROUP_URL, LIFETIME_WA_GROUP_URL, GUIDE_WA_URL,
} from "../api/_community.js";
import { ADMIN_UIDS } from "../api/_aiQuota.js";

const LIFETIME_INVITE = LIFETIME_WA_GROUP_URL.split("/").pop();
const now = Date.UTC(2026, 9, 21);
const day = 86_400_000;

test("a regular or trial account: the general group only, never the Lifetime link", () => {
  const m = composeGroupInviteEmail({ circle: false, appUrl: "https://brandlab.wepeka.com" });
  assert.equal(m.subject, "Gabung grup WhatsApp Brandlab, biar nggak ketinggalan info");
  for (const part of [m.html, m.text]) {
    assert.ok(part.includes(BRANDLAB_WA_GROUP_URL));
    assert.ok(!part.includes(LIFETIME_INVITE));
    assert.ok(!part.includes(GUIDE_WA_URL), "the guided setup belongs to the payment email");
  }
  assert.match(m.text, /Matikan di Pengaturan → Pengingat: https:\/\/brandlab\.wepeka\.com\/#\/settings\/reminders/);
});

test("a Lifetime account: both groups, its own first, and the text twin says the same", () => {
  const m = composeGroupInviteEmail({ circle: true });
  assert.equal(m.subject, "2 grup WhatsApp untuk Founder Brandlab");
  for (const part of [m.html, m.text]) {
    assert.ok(part.includes(LIFETIME_WA_GROUP_URL) && part.includes(BRANDLAB_WA_GROUP_URL));
    assert.ok(part.indexOf(LIFETIME_WA_GROUP_URL) < part.indexOf(BRANDLAB_WA_GROUP_URL), "their own group first");
    assert.ok(!part.includes(GUIDE_WA_URL));
  }
  assert.match(m.html, /jangan dibagikan/);
});

test("recipients carry whether they are Lifetime (Founder, Founder Ultimate, Lifetime, the team)", () => {
  const accounts = [
    { uid: "f1", email: "founder@x.test", status: "active", plan: "founder", subscriptionExpiresAt: null },
    { uid: "f2", email: "ultimate@x.test", status: "active", plan: "founder-ultimate", subscriptionExpiresAt: null },
    { uid: "t1", email: "trial@x.test", status: "active", plan: "trial", trialEndsAt: now + 5 * day },
    { uid: "t2", email: "expired@x.test", status: "active", plan: "trial", trialEndsAt: now - day },
    { uid: "p1", email: "pro@x.test", status: "active", plan: "pro", subscriptionExpiresAt: now + 20 * day },
    { uid: ADMIN_UIDS[0], email: "team@x.test", status: "active", plan: "pro", subscriptionExpiresAt: null },
    { uid: "off", email: "off@x.test", status: "active", plan: "founder", subscriptionExpiresAt: null },
  ];
  const list = announcementRecipients(accounts, new Set(["off"]), now);
  assert.deepEqual(list.map((r) => [r.email, r.circle]), [
    ["founder@x.test", true],
    ["ultimate@x.test", true],
    ["trial@x.test", false],
    ["pro@x.test", false],
    ["team@x.test", true],
  ]);
});

test("an announcement email still never carries the Lifetime link", () => {
  const m = composeAnnouncementEmail({ title: "Fitur baru", body: "Isi" });
  assert.ok(!m.html.includes(LIFETIME_INVITE) && !m.text.includes(LIFETIME_INVITE));
});

test("Founder session email: date, Discord, question page and the Lifetime group, in both parts", async () => {
  const { composeFounderSessionEmail, FOUNDER_SESSION } = await import("../api/_community.js");
  const m = composeFounderSessionEmail({ appUrl: "https://brandlab.wepeka.com" });
  assert.match(m.subject, /19\.00 WIB/);
  for (const part of [m.html, m.text]) {
    assert.ok(part.includes(FOUNDER_SESSION.discordUrl));
    assert.ok(part.includes("https://brandlab.wepeka.com/#/updates/sesi"));
    assert.ok(part.includes(LIFETIME_WA_GROUP_URL));
    assert.ok(part.includes("30 Oktober"));
  }
});
