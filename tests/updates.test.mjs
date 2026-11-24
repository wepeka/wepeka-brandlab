// Update Brandlab (api/_updates.js, api/cron/updates.js): every update
// people can notice ships with a tutorial and screenshots (owner,
// 2026-11-24), is posted to Pengumuman once, and goes out in at most one
// email a day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { UPDATES, docIdOf, postFields, planUpdatePosts, digestStep, hashOf, wibDay, MAIL_DAILY } from "../api/_updates.js";
import { composeUpdatesEmail, composeAnnouncementEmail } from "../api/_community.js";

test("every update has a title, a tutorial, screenshots that exist, and a way in", () => {
  assert.ok(UPDATES.length > 0);
  const ids = new Set();
  for (const u of UPDATES) {
    assert.match(u.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/, u.id);
    assert.ok(!ids.has(u.id), `duplicate ${u.id}`);
    ids.add(u.id);
    assert.ok(["feature", "fix"].includes(u.kind), u.id);
    assert.ok(u.title && u.title.length <= 140, u.id);
    assert.ok(u.body?.trim(), `${u.id}: body`);
    assert.ok(Array.isArray(u.steps) && u.steps.length >= 2 && u.steps.length <= 10, `${u.id}: 2–10 steps`);
    assert.ok(Array.isArray(u.images) && u.images.length >= 1 && u.images.length <= 6, `${u.id}: 1–6 screenshots`);
    for (const img of u.images) {
      assert.match(img.src, /^\/assets\/announcements\/.+\.(jpg|png)$/, img.src);
      const file = new URL(`..${img.src}`, import.meta.url);
      assert.ok(existsSync(file), `missing ${img.src}`);
      assert.ok(statSync(file).size < 400 * 1024, `${img.src} is over 400 KB`);
      assert.ok(img.caption?.trim(), `${img.src}: caption`);
    }
    assert.match(u.link, /^#\/(go\/[a-z0-9/-]+|settings\/[a-z-]+|billboard|updates)$/, `${u.id}: link`);
    assert.ok(u.linkLabel?.trim(), `${u.id}: linkLabel`);
    // No made-up words for Wepeka, no "WPK".
    assert.ok(!/\bWPK\b/.test(`${u.title} ${u.body} ${u.steps.join(" ")}`), u.id);
  }
});

test("new entries are posted once, newest on top; an edited entry updates its post", () => {
  const ups = [{ id: "2026-12-02-b", kind: "fix", title: "B", body: "b", steps: ["1", "2"], images: [{ src: "/x.jpg" }] }, { id: "2026-12-01-a", kind: "feature", title: "A", body: "a", steps: ["1", "2"], images: [] }];
  const first = planUpdatePosts(ups, {}, 1000);
  assert.deepEqual(first.create.map((x) => x.id), ["upd-2026-12-01-a", "upd-2026-12-02-b"]);
  assert.ok(first.create[1].data.createdAt > first.create[0].data.createdAt, "the first entry is the newest post");
  assert.equal(first.create[0].data.source, "updates");
  const existing = Object.fromEntries(first.create.map((x) => [x.id, x.data]));
  assert.deepEqual(planUpdatePosts(ups, existing, 2000), { create: [], change: [] });
  const edited = [{ ...ups[0], title: "B2" }, ups[1]];
  const again = planUpdatePosts(edited, existing, 3000);
  assert.deepEqual(again.create, []);
  assert.deepEqual(again.change.map((x) => x.id), ["upd-2026-12-02-b"]);
  assert.equal(again.change[0].patch.title, "B2");
  assert.equal(again.change[0].patch.createdAt, undefined, "an edit doesn't move the post or mail it again");
  assert.equal(docIdOf(ups[0]), "upd-2026-12-02-b");
  assert.notEqual(hashOf(ups[0]), hashOf(edited[0]));
  assert.deepEqual(postFields(ups[0]).images, [{ src: "/x.jpg", caption: "" }]);
});

test("the email goes once a day, 09.00–20.00 WIB, within the daily budget, and resumes", () => {
  const at = (iso) => Date.parse(iso); // UTC
  const nine = at("2026-12-01T02:30:00Z"); // 09.30 WIB
  const night = at("2026-12-01T15:00:00Z"); // 22.00 WIB
  const one = [{ id: "upd-x" }];
  assert.equal(digestStep({}, one, night).mode, "none");
  assert.equal(digestStep({}, [], nine).mode, "none");
  assert.deepEqual(digestStep({}, one, nine), { mode: "start", budget: MAIL_DAILY });
  const today = wibDay(nine);
  assert.equal(digestStep({ day: today, ids: ["upd-x"], sentTo: ["a"], total: 1 }, one, nine).mode, "none", "already mailed today");
  // Cut short by the budget: the rest goes out, never a second digest first.
  const half = { day: "2026-11-30", ids: ["upd-x"], sentTo: ["a"], total: 3, sentToday: { day: "2026-11-30", n: MAIL_DAILY } };
  assert.deepEqual(digestStep(half, one, nine), { mode: "continue", budget: MAIL_DAILY });
  assert.equal(digestStep({ ...half, day: today, sentToday: { day: today, n: MAIL_DAILY } }, one, nine).mode, "none");
  assert.equal(digestStep({ ...half, sentToday: { day: today, n: MAIL_DAILY - 5 } }, one, nine).budget, 5);
});

test("the update email: each update with its steps, screenshots and button; one subject", () => {
  const posts = UPDATES.slice(0, 3).map(postFields);
  const m = composeUpdatesEmail(posts, { appUrl: "https://brandlab.wepeka.com", now: Date.parse("2026-11-24T03:00:00Z") });
  assert.match(m.subject, /^Update Brandlab: .+ \+ 2 lainnya$/);
  assert.match(m.html, /3 update baru di Brandlab/);
  assert.match(m.html, /24 November 2026/);
  for (const p of posts) {
    assert.ok(m.html.includes(p.title.replace(/&/g, "&amp;")), p.title);
    assert.ok(m.html.includes(`https://brandlab.wepeka.com${p.images[0].src}`), "absolute screenshot URL");
    assert.ok(m.html.includes(`https://brandlab.wepeka.com/${p.link}`), "the button opens the page");
  }
  assert.match(m.html, /Cara pakai/);
  assert.match(m.text, /Cara pakai:\n1\. /);
  assert.match(m.html, /Pengaturan &rarr; Pengingat/);
  // Gmail clips mail over ~102 KB: the whole release must fit.
  const all = composeUpdatesEmail(UPDATES.map(postFields));
  assert.ok(Buffer.byteLength(all.html) < 100 * 1024, `email is ${Buffer.byteLength(all.html)} bytes`);
  assert.match(composeUpdatesEmail([posts[0]]).subject, /^Update Brandlab: [^+]+$/);
  // A long day: 12 cards, the rest pointed to Pengumuman, still under the clip.
  const many = Array.from({ length: 15 }, (_, i) => ({ ...postFields(UPDATES[i % UPDATES.length]), title: `Update ${i + 1}` }));
  const big = composeUpdatesEmail(many);
  assert.match(big.html, /15 update baru di Brandlab/);
  assert.match(big.html, /Ada <b>3 update lainnya<\/b>/);
  assert.ok(Buffer.byteLength(big.html) < 102 * 1024, `long email is ${Buffer.byteLength(big.html)} bytes`);
});

test("a single announcement email carries its steps too", () => {
  const m = composeAnnouncementEmail({ title: "X", body: "Lead", steps: ["Buka **A**", "Tekan B"] });
  assert.match(m.html, /Cara pakai/);
  assert.match(m.html, /<b>A<\/b>/);
  assert.match(m.text, /1\. Buka A/);
});
