// Membuat AKUN UJI untuk tim Midtrans (onboarding review) + satu brand dummy,
// supaya reviewer bisa langsung login di planner.wepeka.com/#/login dan
// mencoba alur bayar dari halaman #/pricing tanpa harus daftar lewat
// wepeka.com (jalur trial self-service masih ditutup admin).
//
// Jalankan SENDIRI (butuh kredensial Firebase Admin proyek wepeka-ba996):
//   SEED_EMAIL=midtrans.test@wepeka.com SEED_PASSWORD='<password pilihanmu>' \
//     node scripts/seed-midtrans-test-account.mjs
// Ganti password akun yang sudah ada: tambahkan argumen --reset-password.
// Kembalikan akun uji ke kondisi "baru" (trial 30 hari, belum pilih mode)
// supaya demo bayar bisa diulang dari awal:
//   SEED_EMAIL=... node scripts/seed-midtrans-test-account.mjs --reset-trial
// Hapus akun uji (Auth user + accounts doc + semua brand miliknya):
//   SEED_EMAIL=... node scripts/seed-midtrans-test-account.mjs --delete
//
// PENTING soal email: pakai alamat yang domainnya punya mail server (mis.
// @gmail.com). Login satu pintu di wepeka.com/community/login membuat baris
// member otomatis untuk akun Firebase ini, dan langkah itu menolak domain
// tanpa MX record (wepeka.com termasuk). Jangan pakai alias +tag dari Gmail
// yang sudah jadi member wepeka.com -- dianggap akun ganda.
//
// Kredensial admin dicari berurutan:
//   1. argumen path service account JSON:  node scripts/... key.json
//   2. env FIREBASE_ADMIN_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY
//   3. file ~/Documents/wpk-dp/.env.local (proyek Firebase yang sama)
//
// Yang ditulis:
//   - Firebase Auth user (email terverifikasi) -- dilewati kalau sudah ada
//   - accounts/{uid}: plan "trial" 30 hari, brandLimit 1 (sama persis dengan
//     createTrialAccount di wpk-dp src/lib/brandlab-db.ts)
//   - brands/{id}: satu brand contoh "Kopi Senja" milik akun itu
// Password TIDAK pernah dicetak ke layar/log. Aman dijalankan ulang:
// akun/brand yang sudah ada tidak ditimpa.

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const email = (process.env.SEED_EMAIL || "").trim().toLowerCase();
const password = process.env.SEED_PASSWORD || "";
const displayName = process.env.SEED_NAME || "Midtrans Reviewer";
const DELETE = process.argv.includes("--delete");
const RESET_TRIAL = process.argv.includes("--reset-trial");
if (!email || (!password && !DELETE && !RESET_TRIAL)) {
  console.error("Isi SEED_EMAIL dan SEED_PASSWORD (min. 8 karakter) lewat environment. Lihat komentar di atas file ini.");
  process.exit(1);
}
if (!DELETE && !RESET_TRIAL && password.length < 8) {
  console.error("SEED_PASSWORD minimal 8 karakter.");
  process.exit(1);
}

function loadCredential() {
  const keyPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (keyPath) return cert(JSON.parse(readFileSync(keyPath, "utf8")));
  let env = { ...process.env };
  if (!env.FIREBASE_ADMIN_PRIVATE_KEY) {
    const local = join(homedir(), "Documents/wpk-dp/.env.local");
    if (existsSync(local)) {
      for (const line of readFileSync(local, "utf8").split("\n")) {
        const m = /^\s*(FIREBASE_ADMIN_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1]] = v;
      }
    }
  }
  if (!env.FIREBASE_ADMIN_PRIVATE_KEY) {
    console.error("Kredensial Firebase Admin tidak ditemukan. Beri path service account JSON sebagai argumen, atau set env FIREBASE_ADMIN_*.");
    process.exit(1);
  }
  return cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
}

initializeApp({ credential: loadCredential() });
const auth = getAuth();
const db = getFirestore();

if (RESET_TRIAL) {
  const u = await auth.getUserByEmail(email);
  const ref = db.doc(`accounts/${u.uid}`);
  const acc = (await ref.get()).data();
  if (!acc || !String(acc.note || "").includes("Akun uji")) {
    console.error("accounts doc ini TIDAK bertanda akun uji -- dibatalkan demi keamanan.");
    process.exit(1);
  }
  await ref.set({
    plan: "trial", status: "active", brandLimit: 1, billing: null,
    trialEndsAt: Date.now() + TRIAL_DAYS * DAY_MS, subscriptionExpiresAt: null, paidAt: null, bookStyles: [],
  }, { merge: true });
  // settings/{uid} carries the chosen Pemula/Pro mode -- dropping it brings
  // back the mode picker + first-run flow on the next open.
  await db.doc(`settings/${u.uid}`).delete().catch(() => {});
  console.log(`Akun ${email} dikembalikan ke trial 30 hari (mode belum dipilih).`);
  process.exit(0);
}

if (DELETE) {
  let victim = null;
  try { victim = await auth.getUserByEmail(email); } catch (err) { if (err.code !== "auth/user-not-found") throw err; }
  if (!victim) { console.log(`Tidak ada Auth user ${email} -- tidak ada yang dihapus.`); process.exit(0); }
  const acc = await db.doc(`accounts/${victim.uid}`).get();
  if (acc.exists && !String(acc.data().note || "").includes("Akun uji")) {
    console.error("accounts doc ini TIDAK bertanda akun uji -- dibatalkan demi keamanan.");
    process.exit(1);
  }
  const owned = await db.collection("brands").where("ownerId", "==", victim.uid).get();
  const batch = db.batch();
  owned.docs.forEach((d) => batch.delete(d.ref));
  if (acc.exists) batch.delete(acc.ref);
  await batch.commit();
  await auth.deleteUser(victim.uid);
  console.log(`Dihapus: Auth user ${email} (uid ${victim.uid}), accounts doc, ${owned.size} brand.`);
  process.exit(0);
}

// 1. Firebase Auth user
let user;
try {
  user = await auth.getUserByEmail(email);
  if (process.argv.includes("--reset-password")) {
    await auth.updateUser(user.uid, { password });
    console.log(`Auth user sudah ada: ${email} (uid ${user.uid}) -- password DIGANTI.`);
  } else {
    console.log(`Auth user sudah ada: ${email} (uid ${user.uid}) -- password tidak diubah (pakai --reset-password untuk mengganti).`);
  }
} catch (err) {
  if (err.code !== "auth/user-not-found") throw err;
  user = await auth.createUser({ email, password, displayName, emailVerified: true });
  console.log(`Auth user dibuat: ${email} (uid ${user.uid})`);
}
const uid = user.uid;

// 2. accounts/{uid} -- trial 30 hari (shape = wpk-dp createTrialAccount)
const accountRef = db.doc(`accounts/${uid}`);
const counterRef = db.doc("meta/accountCounter");
const created = await db.runTransaction(async (tx) => {
  const [accountSnap, counterSnap] = await Promise.all([tx.get(accountRef), tx.get(counterRef)]);
  if (accountSnap.exists) return false;
  const accountNumber = counterSnap.exists ? (counterSnap.data().next ?? 1) : 1;
  tx.set(counterRef, { next: accountNumber + 1 }, { merge: true });
  tx.set(accountRef, {
    uid, email, displayName, accountNumber, username: null,
    createdAt: Date.now(), plan: "trial", status: "active", brandLimit: 1,
    trialEndsAt: Date.now() + TRIAL_DAYS * DAY_MS, subscriptionExpiresAt: null, paidAt: null,
    // penanda supaya gampang dikenali & dibersihkan nanti
    note: "Akun uji untuk review onboarding Midtrans -- boleh dihapus setelah live.",
  });
  return true;
});
console.log(created ? "accounts doc dibuat (trial 30 hari)." : "accounts doc sudah ada -- dibiarkan.");

// 3. Satu brand contoh (shape = js/store.js createBrand + default*())
const existing = await db.collection("brands").where("ownerId", "==", uid).limit(1).get();
if (!existing.empty) {
  console.log(`Brand sudah ada untuk akun ini (${existing.docs[0].data().name}) -- tidak ditambah.`);
} else {
  const id = randomUUID();
  const brand = {
    id, ownerId: uid, name: "Kopi Senja", avatar: "", color: "#8B5E3C",
    driveLink: "", brandbookLink: "", logoAssets: [],
    businessDescription: "Kedai kopi kecil di Kediri yang menjual kopi susu botolan dan biji kopi lokal. Pelanggan utama mahasiswa dan pekerja muda usia 20-32 tahun. Jualan lewat Instagram, TikTok, dan pesan-antar.",
    aiVoiceGuide: "Hangat, santai, sedikit humor. Pakai bahasa sehari-hari, hindari kata teknis kopi yang rumit.",
    brandDNA: {
      tagline: "Pelan-pelan, tapi pasti nikmat.",
      oneLiner: "Kopi susu botolan yang bikin sore kamu lebih tenang.",
      purpose: "Bikin orang berhenti sebentar dan menikmati jeda.",
      vision: "Jadi kopi susu lokal favorit anak muda Kediri.",
      mission: "Menyajikan kopi lokal berkualitas dengan harga ramah kantong.",
      targetAudience: "Mahasiswa dan pekerja muda 20-32 tahun di Kediri.",
      problemSolved: "Kopi enak biasanya mahal atau jauh; Kopi Senja murah dan bisa diantar.",
      positioning: "Kopi susu lokal yang santai dan terjangkau.",
      differentiation: "Biji kopi dari petani Kediri, resep susu sendiri, botol bisa ditukar.",
      callToAction: "Pesan Kopi Senja hari ini.",
      successOutcome: "Sore lebih tenang, dompet tetap aman.",
      failureOutcome: "Sore tetap gelisah dengan kopi instan yang hambar.",
      personality: ["Hangat", "Santai", "Jujur"],
      values: ["Lokal", "Sederhana", "Konsisten"],
      productsServices: ["Kopi susu botolan 250 ml", "Biji kopi arabika Kediri 200 g", "Paket kopi kantor"],
    },
    brandGuidelines: {
      logo: { hasLogo: false, dataUrl: "", secondaryDataUrl: "", logotypeDataUrl: "" },
      mascots: [], colorFeelings: ["Hangat", "Tenang"], colorFormula: "",
      colors: { primary: "#8B5E3C", secondary: "#F3E9DC", accent: "#E07A2F", background: "#FFFBF5", text: "#2B1D14" },
      typographyFeelings: ["Ramah"],
      fonts: { primary: "Poppins", secondary: "Inter", accent: "" },
      customFonts: {}, extraFonts: [],
      typeSpacing: {
        primary: { lineHeight: 1.15, letterSpacing: 0 },
        secondary: { lineHeight: 1.6, letterSpacing: 0 },
        accent: { lineHeight: 1.3, letterSpacing: 0 },
      },
      visualDirection: [], moodboard: [], applications: [],
      aiCopy: { valueProposition: null, colorEssence: null },
    },
    brandBuilder: {
      stage: "foundation", completedStages: [],
      personality: { feeling: "", primary: [], secondary: [], avoid: [], source: "" },
      toneOfVoice: { formal: 35, language: 40, character: 60, emotion: 55, avoidWords: [], source: "" },
      naming: { hasName: true, name: "Kopi Senja", source: "" },
      consistencyDismissed: [],
    },
    instagram: { accessToken: "", igUserId: "", username: "", connectedAt: null },
    facebook: { pageId: "", pageAccessToken: "", pageName: "", connectedAt: null },
    ads: { adAccountId: "", adsAccessToken: "", accountName: "", connectedAt: null },
    createdAt: Date.now(), archived: false,
  };
  await db.doc(`brands/${id}`).set(brand);
  console.log("Brand contoh 'Kopi Senja' dibuat.");
}

console.log(`\nSelesai. Login satu pintu: https://www.wepeka.com/community/login  (email: ${email})`);
console.log("Lalu buka https://www.wepeka.com/brandlab/connect?to=pricing -> masuk Brandlab langsung di halaman Paket & Harga.");
process.exit(0);
