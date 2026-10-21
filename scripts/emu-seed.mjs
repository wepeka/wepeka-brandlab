// Fills the local Firebase Emulator Suite with a demo team — never production
// (project demo-brandlab, emulator hosts only). Run after `npm run emu`:
//
//   npm run emu:seed                 # owner + brand, nobody shared yet
//   npm run emu:seed -- --with-member # Rina (editor) + Dimas (viewer) already on the brand
//
// Wipes the emulator first. The brand, its content, campaign and series are
// made by the app's own js/store.js (on the test stubs), so their shape is
// exactly what the app writes; the docs are then copied into the emulator.
//
// Test accounts (emulator only, password for all: brandlab-dev-123):
//   winson@test.local  owner, plan pro      (uid owner-winson)
//   rina@test.local    editor               (uid member-rina)
//   dimas@test.local   viewer               (uid member-dimas)
//   budi@test.local    not on the team      (uid outsider-budi)
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const PROJECT = "demo-brandlab";
const FS_HOST = "127.0.0.1:8080";
const AUTH_HOST = "127.0.0.1:9099";
const RTDB_HOST = "127.0.0.1:9000";
Object.assign(process.env, { FIRESTORE_EMULATOR_HOST: FS_HOST, FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST, FIREBASE_DATABASE_EMULATOR_HOST: RTDB_HOST, GCLOUD_PROJECT: PROJECT });
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

export const PASSWORD = "brandlab-dev-123";
export const PEOPLE = {
  owner: { uid: "owner-winson", email: "winson@test.local", displayName: "Winson" },
  editor: { uid: "member-rina", email: "rina@test.local", displayName: "Rina" },
  viewer: { uid: "member-dimas", email: "dimas@test.local", displayName: "Dimas" },
  outsider: { uid: "outsider-budi", email: "budi@test.local", displayName: "Budi" },
};
const DAY = 86_400_000;

async function wipe() {
  const fsUrl = `http://${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const authUrl = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`;
  for (const url of [fsUrl, authUrl]) {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) throw new Error(`emulator not reachable (${url}): HTTP ${res.status} — run npm run emu first`);
  }
}

// The brand's docs as js/store.js writes them, read back from the stub.
async function brandDocs(ownerUid) {
  const fs = await import("../tests/stubs/firebase-firestore.js");
  fs.__reset();
  const store = await import("../js/store.js");
  await store.initStore(ownerUid);
  const b = store.createBrand({
    name: "Kopi Pagi",
    color: "#c7773b",
    businessDescription: "Kedai kopi drive-thru untuk pekerja kantoran di Surabaya.",
    brandDNA: {
      targetAudience: "Pekerja kantoran 25–35 tahun di Surabaya yang butuh kopi enak sebelum jam 8",
      problemSolved: "Antre lama di kedai kopi bikin telat masuk kantor",
      differentiation: "3 tahun melayani 400+ pelanggan tetap, rata-rata siap 2 menit",
      mission: "1) Pesan lewat WA 2) Ambil di jendela drive-thru 3) Sampai kantor tepat waktu",
      callToAction: "Pesan sekarang lewat WhatsApp",
      tagline: "Kopi pagi, tanpa antre",
      oneLiner: "Kopi Pagi bantu pekerja kantoran Surabaya dapat kopi enak dalam 2 menit, tanpa antre.",
    },
  });
  const iso = (daysAgo) => store.localISODate(new Date(Date.now() - daysAgo * DAY));
  ["Cara pesan 2 menit", "Di balik bar", "Menu baru: Es Kopi Pagi"].forEach((title, i) => store.createContent(b.id, {
    title, status: "published", publishedDate: iso(2 + i * 3), format: i % 2 ? "Reels" : "Carousel", funnel: ["TOFU", "MOFU", "BOFU"][i % 3], platform: "Instagram",
    performance: { views: 1500 + i * 120, reach: 1000, likes: 80, comments: 5, shares: 3, saves: 4, followersGained: 12, confirmedAt: Date.now() - (2 + i * 3) * DAY },
  }));
  store.createContent(b.id, { title: "Video jendela drive-thru", status: "draft", scheduleDate: iso(-3), format: "Reels", funnel: "TOFU", platform: "Instagram" });
  store.createContent(b.id, { title: "Carousel: 5 menu pagi", status: "idea", format: "Carousel", platform: "Instagram", funnel: "TOFU" });
  store.createCampaign(b.id, { name: "Launch Es Kopi Pagi", objective: "launch", startDate: iso(-1), endDate: iso(-30) });
  store.createSeries(b.id, { name: "Pagi tanpa antre" });
  await new Promise((r) => setTimeout(r, 50));
  const docs = [...fs.__docs.entries()].filter(([path]) => /^(brands|content|campaigns|series|brandCounts)\//.test(path));
  return { brandId: b.id, docs };
}

async function main() {
  const withMember = process.argv.includes("--with-member");
  await wipe();
  initializeApp({ projectId: PROJECT, databaseURL: `http://${RTDB_HOST}?ns=${PROJECT}` });
  const auth = getAuth();
  const db = getFirestore();

  for (const p of Object.values(PEOPLE)) await auth.createUser({ ...p, password: PASSWORD, emailVerified: true });

  const { owner, editor, viewer } = PEOPLE;
  const { brandId, docs } = await brandDocs(owner.uid);
  const batch = db.batch();
  for (const [path, data] of docs) batch.set(db.doc(path), JSON.parse(JSON.stringify(data)));
  batch.set(db.doc(`accounts/${owner.uid}`), {
    uid: owner.uid, email: owner.email, status: "active", plan: "pro", billing: "monthly",
    subscriptionExpiresAt: Date.now() + 30 * DAY, brandLimit: 3, accountNumber: 1, createdAt: Date.now() - 60 * DAY,
  });
  // Welcome videos, tour and the after-payment page already seen.
  const guideSeen = { "video:akun-baru": 1, "video:kenalan": 1, "video:tanya-brandlab": 1, "tour:onboarding": 1, "community:welcome": 1 };
  for (const p of Object.values(PEOPLE)) batch.set(db.doc(`settings/${p.uid}`), { experienceMode: "advanced", experienceModeChosen: true, guideSeen });
  batch.set(db.doc(`brandCounts/${owner.uid}`), { count: 1, op: "seed", at: new Date() });

  if (withMember) {
    const at = Date.now();
    const members = {
      [editor.uid]: { role: "editor", name: editor.displayName, email: editor.email, addedAt: at },
      [viewer.uid]: { role: "viewer", name: viewer.displayName, email: viewer.email, addedAt: at },
    };
    batch.set(db.doc(`brands/${brandId}`), { members, memberIds: [editor.uid, viewer.uid], ownerName: owner.displayName }, { merge: true });
    for (const m of [editor, viewer]) {
      batch.set(db.doc(`memberships/${m.uid}`), {
        ownerIds: [owner.uid],
        brands: { [brandId]: { ownerId: owner.uid, role: members[m.uid].role, brandName: "Kopi Pagi", ownerName: owner.displayName } },
      });
    }
  }
  await batch.commit();
  // The live layer's copy of the team (api/team.js mirrorTeams).
  const rtdb = getDatabase();
  await rtdb.ref("/").set(null);
  if (withMember) await rtdb.ref(`teams/${brandId}`).set({ [owner.uid]: "owner", [editor.uid]: "editor", [viewer.uid]: "viewer" });
  console.log(`Seeded the emulator: brand Kopi Pagi (${brandId})${withMember ? " shared with Rina (editor) and Dimas (viewer)" : ""}.`);
  console.log(`Sign in at http://localhost:8743/?emu=1 with winson@test.local / ${PASSWORD} (rina@, dimas@, budi@ on http://127.0.0.1:8743/?emu=1).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
