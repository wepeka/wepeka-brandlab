import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, ROLE_KEYS, presetPerms, memberPerms, can, coarseRole, cleanPerms, levelOf, withLevel, roleOfMember, MODULES } from "../js/permissions.js";

const brand = (members) => ({ id: "b", ownerId: "owner", members });

test("the owner can do everything; a stranger nothing", () => {
  const b = brand({});
  for (const mod of MODULES) assert.equal(can(b, "owner", mod, "edit"), true);
  assert.equal(can(b, "someone", "create", "view"), false);
  assert.equal(can(null, "owner", "create"), false);
});

test("the presets follow the brief: Editor & Sosmed never sees Sales, Sales sees money, Viewer only looks", () => {
  const p = (role) => presetPerms(role);
  // Editor & Sosmed (the Video Editor and the Social Media Manager as one,
  // 2026-11-24): uploads, reviews, approves, posts — no money.
  assert.deepEqual(p("smm").video, ["view", "upload", "comment", "revise", "approve"]);
  assert.ok(p("smm").publish.includes("publish"));
  assert.ok(p("smm").create.includes("edit"));
  assert.equal(p("smm").sales, undefined);
  // A Klien only sees and reviews videos; nothing about money.
  assert.deepEqual(p("klien").video, ["view", "comment", "revise", "approve"]);
  // Sees everything, changes nothing (2026-11-24).
  assert.deepEqual(p("klien").sales, ["view"]);
  for (const mod of ["brand", "goals", "create", "report", "board"]) assert.deepEqual(p("klien")[mod], ["view"], mod);
  assert.equal(p("klien").publish, undefined);
  assert.equal(p("klien").chat, undefined);
  // Sales: money yes, content read-only.
  assert.deepEqual(p("sales").sales, ["view", "edit", "delete"]);
  assert.deepEqual(p("sales").create, ["view"]);
  // Viewer: looks at everything but Sales; no AI.
  assert.equal(p("viewer").sales, undefined);
  assert.equal(p("viewer").chat, undefined);
  for (const mod of ["brand", "goals", "create", "video", "report", "board"]) assert.deepEqual(p("viewer")[mod], ["view"]);
  // Admin: everything but the team itself.
  assert.ok(p("admin").sales.includes("edit"));
  assert.equal(p("admin").team, undefined);
  // Every preset only uses known modules/actions and has view with any action.
  for (const key of Object.keys(PRESETS)) assert.deepEqual(presetPerms(key), cleanPerms(PRESETS[key]));
  assert.deepEqual(ROLE_KEYS, ["admin", "creator", "smm", "sales", "viewer"]);
});

test("the old two-way role stays meaningful: editor only for those who write content", () => {
  assert.equal(coarseRole(presetPerms("admin")), "editor");
  assert.equal(coarseRole(presetPerms("creator")), "editor");
  assert.equal(coarseRole(presetPerms("smm")), "editor");
  assert.equal(coarseRole(presetPerms("klien")), "viewer");
  assert.equal(coarseRole(presetPerms("sales")), "viewer");
  assert.equal(coarseRole(presetPerms("viewer")), "viewer");
});

test("members from before roles: editor reads as Admin, viewer as Viewer (no Sales any more), a Klien sees all", () => {
  const b = brand({ e: { role: "editor" }, v: { role: "viewer" }, k: { role: "viewer", klien: true } });
  assert.equal(can(b, "e", "sales", "edit"), true);
  assert.equal(can(b, "v", "sales", "view"), false);
  assert.equal(can(b, "v", "create", "view"), true);
  assert.equal(can(b, "k", "video", "approve"), true);
  // A client sees everything and changes nothing (2026-11-24).
  assert.equal(can(b, "k", "sales", "view"), true);
  assert.equal(can(b, "k", "sales", "edit"), false);
  assert.equal(can(b, "k", "create", "edit"), false);
  assert.equal(roleOfMember(b.members.e), "admin");
  assert.equal(roleOfMember(b.members.k), "klien");
});

test("a paused seat or a member switched off only looks, or nothing", () => {
  const b = brand({
    s: { role: "editor", preset: "admin", p: presetPerms("admin"), seatPaused: true },
    d: { role: "editor", preset: "admin", p: presetPerms("admin"), disabled: true },
  });
  assert.equal(can(b, "s", "create", "view"), true);
  assert.equal(can(b, "s", "create", "edit"), false);
  assert.equal(can(b, "s", "sales", "view"), true);
  assert.deepEqual(memberPerms(b.members.d), {});
  assert.equal(can(b, "d", "create", "view"), false);
});

test("the owner's own boxes: levels per module, cleaned, custom shown as such", () => {
  let p = presetPerms("creator");
  assert.equal(levelOf(p, "video"), "upload");
  assert.equal(levelOf(p, "sales"), "none");
  p = withLevel(p, "sales", "view");
  assert.deepEqual(p.sales, ["view"]);
  p = withLevel(p, "video", "approve");
  assert.deepEqual(p.video, ["view", "comment", "revise", "approve"]);
  assert.equal(levelOf(p, "video"), "approve");
  // Junk never survives.
  assert.deepEqual(cleanPerms({ sales: ["edit", "hack"], nope: ["view"], chat: [] }), { sales: ["view", "edit"] });
  assert.equal(roleOfMember({ role: "viewer", preset: "creator", p, custom: true }), "custom");
});

test("the server's copy (api/_permissions.js) is the same table as the app's", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../js/permissions.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/_permissions.js", import.meta.url), "utf8").split("\n").slice(3).join("\n");
  assert.equal(api, app, "copy js/permissions.js into api/_permissions.js (below its 3-line header)");
});

test("the server writes a role as its preset, its map and the old two-way role", async () => {
  const { memberRoleOf, ROLES, roleShown } = await import("../api/_team.js");
  assert.ok(["admin", "creator", "smm", "sales", "viewer", "klien", "klienEdit", "editor", "viewer"].every((r) => ROLES.includes(r)));
  const v = memberRoleOf("sales");
  assert.equal(v.role, "viewer");
  assert.equal(v.preset, "sales");
  assert.equal(memberRoleOf("video").preset, "smm", "an invite made as Video Editor becomes Editor & Sosmed");
  assert.deepEqual(v.p.sales, ["view", "edit", "delete"]);
  assert.equal(memberRoleOf("creator").role, "editor");
  // An old app sending "editor" gets an Admin.
  assert.equal(memberRoleOf("editor").preset, "admin");
  assert.equal(memberRoleOf("editor").role, "editor");
  // Clients keep their mark and old role.
  assert.deepEqual([memberRoleOf("klien").role, memberRoleOf("klien").klien], ["viewer", true]);
  assert.equal(roleShown({ role: "viewer", preset: "sales", p: {} }), "sales");
});

test("a member's app: only the apps and pages their role opens, money never held, writes per module", async () => {
  const store = await import("../js/store.js");
  const { APPS, VIEW_MODULE } = await import("../js/apps.js");
  const { roleChipHTML, roleLabel } = await import("../js/role-look.js");
  await store.initStore("u-vid");
  const brand = {
    id: "b-team", ownerId: "owner-x", name: "Kopi Tim",
    members: { "u-vid": { role: "viewer", preset: "klien", klien: true, p: presetPerms("klien") } },
    memberIds: ["u-vid"],
    salesTracker: { products: [{ id: "p", name: "Kopi", price: 1, cost: 1 }], lastAdvice: { summary: "Omzet Rp 9.000.000" } },
  };
  // What the app shows a Klien: every app to look at (2026-11-24, "client
  // bisa lihat semua tapi gabisa ubah2"), nothing to change, no AI.
  const shown = APPS.filter((a) => store.canDo(brand, a.module, "view")).map((a) => a.key);
  assert.deepEqual(shown.sort(), ["builder", "campaigns", "content-os", "deck", "papan", "report", "sales"]);
  assert.equal(store.canDo(brand, VIEW_MODULE.sales), true);
  for (const mod of ["brand", "goals", "create", "sales", "board", "publish"]) assert.equal(store.canDo(brand, mod, "edit"), false, mod);
  assert.equal(store.canDo(brand, VIEW_MODULE.chat), false);
  // Editor & Sosmed: no money.
  const smm = { ...brand, members: { "u-vid": { role: "editor", preset: "smm", p: presetPerms("smm") } } };
  assert.equal(store.canDo(smm, VIEW_MODULE.sales), false);
  assert.equal(store.canDo(brand, "video", "approve"), true);
  assert.equal(store.canDo(brand, "video", "upload"), false);
  // The role's look: icon + name.
  assert.match(roleChipHTML("smm"), /role-chip/);
  assert.equal(roleLabel("smm"), "Editor & Sosmed");
  assert.equal(roleLabel("editor"), "Admin");
});

// Panduan peran (owner, 2026-11-24: "ada guide dan penjelasannya dalam tabel
// yang mudah dipahami soal role"): the guide reads the permission table
// itself, so it can't promise what a role can't do.
test("the role guide says exactly what the permission table allows", async () => {
  const { guideLevel } = await import("../js/role-guide.js");
  const { t } = await import("../js/i18n.js");
  assert.equal(guideLevel("owner", "team"), "manage");
  assert.equal(guideLevel("owner", "video"), "all");
  assert.equal(guideLevel("smm", "video"), "editor", "Editor & Sosmed uploads AND approves");
  assert.equal(guideLevel("creator", "video"), "upload");
  assert.equal(guideLevel("klien", "video"), "approve");
  assert.equal(guideLevel("viewer", "sales"), "none");
  assert.equal(guideLevel("sales", "sales"), "edit");
  assert.equal(guideLevel("admin", "team"), "none", "only the owner manages the team");
  // Every level and module the guide can show has its words.
  for (const role of ["owner", "admin", "creator", "smm", "sales", "viewer", "klien"]) {
    for (const mod of ["brand", "goals", "create", "video", "publish", "report", "sales", "board", "chat", "team"]) {
      const lv = guideLevel(role, mod);
      const key = lv === "none" ? `rg.no.${mod}` : `rg.can.${mod}.${lv}`;
      assert.notEqual(t(key), key, `missing text ${key}`);
      assert.notEqual(t(`rg.lv.${lv}`), `rg.lv.${lv}`, `missing level ${lv}`);
    }
  }
});
