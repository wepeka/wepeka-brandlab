// database.rules.json (Kerja Tim's live layer) against the LOCAL Realtime
// Database emulator — `npm run test:rules` (project demo-brandlab).
// teams/b1 = { owen: owner, ed: editor, vi: viewer }; zed is not on it.
import { test, describe, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { ref, set, get, remove } from "firebase/database";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-brandlab",
    database: { rules: readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8"), host: "127.0.0.1", port: 9000 },
  });
});
after(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled((ctx) => set(ref(ctx.database(), "teams/b1"), { owen: "owner", ed: "editor", vi: "viewer" }));
});
const as = (uid) => env.authenticatedContext(uid).database();
const pres = { name: "Ed", page: "#/brand/b1", at: 1 };

describe("live layer rules", () => {
  test("team members see each other; a stranger sees nothing", async () => {
    await assertSucceeds(get(ref(as("vi"), "presence/b1")));
    await assertSucceeds(get(ref(as("ed"), "cursors/b1")));
    await assertFails(get(ref(as("zed"), "presence/b1")));
    await assertFails(get(ref(as("zed"), "teams/b1")));
    await assertSucceeds(get(ref(as("ed"), "teams/b1")));
  });
  test("everyone writes only their own presence and cursor", async () => {
    await assertSucceeds(set(ref(as("ed"), "presence/b1/ed"), pres));
    await assertFails(set(ref(as("ed"), "presence/b1/vi"), pres));
    await assertFails(set(ref(as("zed"), "presence/b1/zed"), pres));
    await assertSucceeds(set(ref(as("vi"), "cursors/b1/vi"), { page: "#/", sel: "#x", fx: 0.1, fy: 0.2, at: 1 }));
    await assertSucceeds(remove(ref(as("ed"), "presence/b1/ed")));
    await assertFails(set(ref(as("ed"), "presence/b1/ed"), { page: "#/" }), "needs a name and a time");
  });
  test("the Script is written by the owner and editors, never a viewer", async () => {
    await assertSucceeds(set(ref(as("ed"), "scripts/b1/c1"), { text: "halo", by: "ed", at: 1 }));
    await assertSucceeds(set(ref(as("owen"), "scripts/b1/c1"), { text: "halo2", by: "owen", at: 2 }));
    await assertFails(set(ref(as("vi"), "scripts/b1/c1"), { text: "x", by: "vi", at: 3 }));
    await assertFails(set(ref(as("zed"), "scripts/b1/c1"), { text: "x", by: "zed", at: 3 }));
  });
  test("nobody writes the team copy but the server", async () => {
    await assertFails(set(ref(as("owen"), "teams/b1/zed"), "editor"));
  });
});
