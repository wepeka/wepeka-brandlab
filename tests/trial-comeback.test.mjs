// "Ajak balik akun trial" email (api/_community.js composeTrialComebackEmail
// + trialRecipients, sent by api/announcements/trial-comeback.js): who gets
// it, the two versions, and the live Founder seat line. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTrialComebackEmail, trialRecipients, LIFETIME_WA_GROUP_URL, buyUrl } from "../api/_community.js";
import { founderFacts } from "../api/offer.js";
import { ADMIN_UIDS } from "../api/_aiQuota.js";

const now = Date.UTC(2026, 9, 27, 3);
const day = 86_400_000;
const LIFETIME_INVITE = LIFETIME_WA_GROUP_URL.split("/").pop();

test("recipients: trial accounts only, running and ended, minus opted out, the team and duplicates", () => {
  const accounts = [
    { uid: "t1", email: "Run@x.test", status: "active", plan: "trial", trialEndsAt: now + 9 * day },
    { uid: "t2", email: "ended@x.test", status: "active", plan: "trial", trialEndsAt: now - 3 * day },
    { uid: "t3", email: "run@x.test", status: "active", plan: "trial", trialEndsAt: now + 2 * day },
    { uid: "p1", email: "paid@x.test", status: "active", plan: "founder", subscriptionExpiresAt: null },
    { uid: "d1", email: "gone@x.test", status: "deactivated", plan: "trial", trialEndsAt: now + day },
    { uid: "off", email: "off@x.test", status: "active", plan: "trial", trialEndsAt: now + day },
    { uid: "bad", email: "not-an-email", status: "active", plan: "trial", trialEndsAt: now + day },
    { uid: ADMIN_UIDS[0], email: "team@x.test", status: "active", plan: "trial", trialEndsAt: now + day },
  ];
  const list = trialRecipients(accounts, new Set(["off"]), now);
  assert.deepEqual(list.map((r) => [r.email, r.ended]), [["run@x.test", false], ["ended@x.test", true]]);
  assert.equal(list[0].endsAt, now + 9 * day);
});

test("a running trial: come back and look, days left, Founder seats from the live count", () => {
  const founder = founderFacts({ founderSlotsSold: 13 }, now);
  const m = composeTrialComebackEmail({ ended: false, endsAt: now + 9 * day, founder, now, appUrl: "https://brandlab.wepeka.com" });
  assert.equal(m.subject, "Brandlab udah kami rombak, sekarang jauh lebih gampang");
  assert.match(m.text, /Trial kamu masih jalan sampai 5 November, sisa 9 hari/);
  assert.match(m.text, /Buka Brandlab lagi: https:\/\/brandlab\.wepeka\.com\n/);
  assert.match(m.text, /Rp 499\.000 \(harga normal Rp 3\.000\.000\)/);
  assert.match(m.text, /Sisa 2 kursi di harga ini\. Habis itu naik jadi Rp 599\.000\./);
  assert.ok(m.text.includes(buyUrl("founder")) && m.html.includes(buyUrl("founder").replace(/&/g, "&amp;")), "the Founder button goes straight to its checkout");
  for (const part of [m.html, m.text]) assert.ok(!part.includes(LIFETIME_INVITE), "never the Lifetime group");
  assert.ok(m.html.includes("/assets/announcements/ui-1-beranda.jpg"));
  assert.match(m.text, /Matikan di Pengaturan → Pengingat: https:\/\/brandlab\.wepeka\.com\/#\/settings\/reminders/);
});

test("an ended trial: the data is still there, the button opens the plans", () => {
  const m = composeTrialComebackEmail({ ended: true, endsAt: now - 3 * day, founder: founderFacts({ founderSlotsSold: 13 }, now), now });
  assert.equal(m.subject, "Trial kamu udah selesai, tapi Brandlab-nya udah beda");
  assert.match(m.text, /Trial kamu selesai 24 Oktober\. Brand DNA, konten, dan target yang udah kamu isi masih aman tersimpan\./);
  assert.match(m.text, /Lanjut pakai Brandlab: https:\/\/brandlab\.wepeka\.com\/#\/pricing/);
});

test("the second wave and a sold-out Founder", () => {
  const wave2 = composeTrialComebackEmail({ founder: founderFacts({ founderSlotsSold: 20 }, now), endsAt: now + day, now });
  assert.match(wave2.text, /Rp 599\.000 \(harga normal Rp 3\.000\.000\)/);
  assert.match(wave2.text, /Sisa 30 kursi di harga ini\./);
  assert.doesNotMatch(wave2.text, /Habis itu naik/);
  const gone = composeTrialComebackEmail({ founder: founderFacts({ founderSlotsSold: 50 }, now), endsAt: now + day, now });
  assert.doesNotMatch(gone.text, /Founder Lifetime|kursi/);
  assert.match(gone.text, /Pilih paket Brandlab: Mulai Rp 49\.000 per bulan/);
  assert.match(gone.text, /Lihat paket: https:\/\/brandlab\.wepeka\.com\/#\/pricing/);
});
