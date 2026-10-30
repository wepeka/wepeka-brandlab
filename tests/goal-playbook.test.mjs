// "Cara mencapainya" (js/goal-playbook.js): every play reads in both
// languages with three steps, every group points at real plays, a target
// maps to the right group, and "Jalankan" turns the steps into goal tasks
// that remember which play they came from.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { initStore, createBrand, createCampaign, getCampaign } from "../js/store.js";
import { GROUPS, PLAY_IDS, findPlay, playsOfGroup, groupOfKey, openGroups } from "../js/goal-playbook.js";
import { addGoalTask } from "../js/goal-actions.js";
import { setLang } from "../js/i18n.js";
const campaignsI18n = (await import("../js/i18n/campaigns.js")).default;

before(() => initStore?.());

describe("playbook data", () => {
  test("every play has title, why and three steps in both languages", () => {
    for (const lang of ["id", "en"]) {
      setLang?.(lang);
      for (const id of PLAY_IDS) {
        const p = findPlay(id);
        assert.ok(p.title && p.why, `${id}/${lang} title+why`);
        assert.equal(p.steps.length, 3, `${id}/${lang} steps`);
        assert.ok(p.steps.every((s) => s.length > 3), `${id}/${lang} step text`);
        assert.ok(["content", "campaign", "event"].includes(p.type), `${id} type`);
      }
    }
    setLang?.("id");
  });
  test("every group lists plays that exist", () => {
    for (const g of Object.values(GROUPS)) {
      assert.ok(g.plays.length >= 2, g.id);
      assert.equal(playsOfGroup(g.id).length, g.plays.length, g.id);
    }
  });
  test("targets map to a group, unknown keys fall back to the kind's first", () => {
    assert.equal(groupOfKey("social", "shares"), "shares");
    assert.equal(groupOfKey("social", "nope"), "followers");
    assert.equal(groupOfKey("community", "ugc"), "ugc");
    assert.equal(groupOfKey("sales", "leads"), "inquiries");
    assert.equal(groupOfKey("event", "anything"), "event");
  });
  test("openGroups: unmet required first, one chip per group, never empty", () => {
    const r = (key, met, required = true) => ({ met, milestone: { key, required } });
    const out = openGroups("social", [r("followers", true), r("published", false), r("streak", false), r("saves", false, false), r("shares", false)]);
    assert.deepEqual(out.map((o) => o.group), ["consistent", "shares", "saves"]);
    assert.equal(openGroups("social", [r("followers", true)])[0].group, "followers");
    assert.equal(openGroups("event", [])[0].group, "event");
  });
  test("pb.* strings exist in both languages", () => {
    const keys = Object.keys(campaignsI18n).filter((k) => k.startsWith("pb."));
    assert.ok(keys.length >= 15);
    keys.forEach((k) => assert.ok(campaignsI18n[k].id && campaignsI18n[k].en, k));
  });
});

describe("running a play", () => {
  test("addGoalTask keeps fromPlay on the step it makes", () => {
    const brand = createBrand({ name: "Kopi Test" });
    const camp = createCampaign(brand.id, {
      name: "Sosmed Growth", status: "active", goalPlan: { version: 3, track: "social" },
      missions: [{ id: "l1", name: "Level satu", milestones: [{ id: "m1", kind: "number", metric: "manual.number", label: "Followers", target: 100, required: true }] }],
    });
    const res = addGoalTask(camp.id, { title: "Pilih 3 akun", why: "x", fromPlay: "Collab post" });
    assert.ok(res.ok);
    const ms = getCampaign(camp.id).missions[0].milestones.find((m) => m.label === "Pilih 3 akun");
    assert.equal(ms.fromPlay, "Collab post");
    assert.equal(ms.required, false);
  });
});

describe("what to do on the tree card", () => {
  test("every numeric target of every kind has a plain sentence in both languages", async () => {
    const { whatToDo } = await import("../js/goal-playbook.js");
    const keys = { social: ["followers", "published", "streak", "shares", "saves", "comments", "er", "dm", "collabs"], community: ["members", "activeMembers", "ugc", "advocates", "testimonials", "crossPost", "memberLed", "referred", "events", "subInitiatives"], sales: ["product", "inquiries", "testimonials", "repeat", "referrals"] };
    for (const lang of ["id", "en"]) {
      setLang?.(lang);
      for (const [kind, list] of Object.entries(keys)) list.forEach((k) => assert.ok(whatToDo(kind, k).length > 20, `${kind}.${k}/${lang}`));
    }
    setLang?.("id");
    assert.equal(whatToDo("social", "nope"), "");
  });
});

describe("AI-made plays", () => {
  test("addMadePlays registers plays that findPlay can resolve and drops broken ones", async () => {
    const { addMadePlays } = await import("../js/goal-playbook.js");
    const out = addMadePlays([
      { title: "Challenge foto kopi pagi", why: "Member punya alasan balik.", steps: ["Tentukan tema", "Ajak posting", "Repost terbaik"], type: "campaign" },
      { title: "", steps: ["a", "b", "c"] },
      { title: "Kurang langkah", steps: ["cuma satu"] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(findPlay(out[0].id).title, "Challenge foto kopi pagi");
    assert.equal(findPlay(out[0].id).steps.length, 3);
  });
});
