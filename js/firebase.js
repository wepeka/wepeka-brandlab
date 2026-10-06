// Shared cloud backend for Wepeka Brandlab — Firestore (data) + Auth (login).
// Images stay embedded as base64 directly in Firestore documents (no
// Firebase Storage) since Storage now requires a billing card attached,
// even for free-tier usage — this keeps setup 100% free/no-card-required.
// This config object is NOT a secret like the
// Anthropic/Gemini keys elsewhere in this app: Firebase's web config is a
// public client identifier by design. Real access control lives entirely in
// firestore.rules / storage.rules (requires a logged-in user), not in
// hiding this object — safe to commit as-is.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcApVGM0CyxfcTERsrwr7CK07YWlQT_vI",
  authDomain: "wepeka-ba996.firebaseapp.com",
  projectId: "wepeka-ba996",
  storageBucket: "wepeka-ba996.firebasestorage.app",
  messagingSenderId: "494668744644",
  appId: "1:494668744644:web:e4bdc9aea34800849f0691",
};

export const app = initializeApp(firebaseConfig);
// Plain getFirestore() defaults to the WebChannel streaming transport,
// which fails outright in some restrictive/proxied network environments
// (seen in this session's sandboxed browser: a bare fetch() to the same
// Firestore REST endpoint worked fine, but the SDK's own connection never
// came up). experimentalAutoDetectLongPolling falls back to plain HTTP
// long-polling when streaming doesn't work, and is a no-op cost-wise
// wherever streaming already works fine.
//
// The cache lives in IndexedDB (shared by every open tab), so a reopen
// paints from what this device already has and the listeners only fetch
// what changed — instead of re-downloading every brand, content item and
// chat thread on each visit. Where IndexedDB is missing (some private
// modes) it stays in memory, exactly as before; the SDK also falls back to
// memory on its own if IndexedDB fails later, at first use.
function createDb(fs) {
  const base = { experimentalAutoDetectLongPolling: true };
  if (typeof indexedDB !== "undefined") {
    try {
      return fs.initializeFirestore(app, { ...base, localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) {
      console.warn("[firestore] persistent cache unavailable, using memory", e);
    }
  }
  return fs.initializeFirestore(app, { ...base, localCache: fs.memoryLocalCache() });
}
export const auth = getAuth(app);

// Firestore (~680 KB of SDK) is NOT part of the first download: a logged-out
// visitor gets the login/pricing screen from Firebase app + auth alone.
// loadFirestore() fetches the SDK and creates the instance the first time
// anything needs it (js/store.js / js/account.js once someone is signed in,
// the pricing page's seat count) and resolves to the SDK module, so callers
// take its functions from there. `db` is a live binding: null until then,
// the instance afterwards — `import { db }` keeps working as before.
export let db = null;
let sdk = null;
let loading = null;
export function loadFirestore() {
  if (!loading) {
    loading = import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js").then((fs) => {
      sdk = fs;
      db = createDb(fs);
      return fs;
    });
    // A failed download (offline, blocked) may be retried by the next caller.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

// Lets queued writes reach the server before the person signs out (a sign
// out switches the SDK to another user's write queue). Offline it gives up
// after `ms` instead of holding the logout hostage.
export async function flushPendingWrites(ms = 3000) {
  if (!db) return; // Firestore never loaded on this page: nothing queued
  try {
    await withTimeout(sdk.waitForPendingWrites(db), ms);
  } catch {
    /* offline or slow: nothing more to do here */
  }
}

// A shared device must never show — or keep on disk — the previous
// person's data: stops this tab's Firestore client and deletes the local
// cache. The instance can't be used afterwards, so every caller reloads the
// page (or signs straight into another account and then reloads). Never
// throws; safe to call more than once.
let wiping = null;
export function wipeLocalFirestore() {
  if (!wiping) {
    wiping = (async () => {
      // Never loaded on this page: nothing in memory, and the cache on disk
      // was already claimed/cleared by whoever loaded it (claimLocalCache).
      if (!db) return;
      try {
        await sdk.terminate(db);
      } catch (e) {
        console.warn("[firestore] terminate failed", e);
      }
      if (typeof indexedDB === "undefined") return;
      try {
        // Other tabs let go of the cache once they see the sign-out too.
        await withTimeout(sdk.clearIndexedDbPersistence(db), 2500);
      } catch (e) {
        console.warn("[firestore] cache not cleared", e);
      }
    })();
  }
  return wiping;
}

// Called once per sign-in before Firestore is first used: when this browser
// last held someone else's cache (a session that expired instead of
// logging out), it is deleted before the new person's data is read. If the
// client already started (a logged-out visit to the pricing page reads the
// seat count), it can't be cleared in place: stop it, clear, and reload —
// once per tab, so a cache another tab holds open can't loop the page.
const CACHE_OWNER_KEY = "brandlab:cacheUid";
const CACHE_RELOAD_KEY = "brandlab:cacheClaimReload";
export async function claimLocalCache(uid) {
  let prev = null;
  try {
    prev = localStorage.getItem(CACHE_OWNER_KEY);
  } catch {
    /* storage off */
  }
  if (prev && prev !== uid && typeof indexedDB !== "undefined") {
    let cleared = false;
    try {
      const fs = await loadFirestore();
      await withTimeout(fs.clearIndexedDbPersistence(db), 2500);
      cleared = true;
    } catch (e) {
      console.warn("[firestore] previous cache not cleared in place", e);
    }
    if (!cleared && typeof location !== "undefined" && typeof location.reload === "function") {
      let tried = false;
      try {
        tried = sessionStorage.getItem(CACHE_RELOAD_KEY) === uid;
        if (!tried) sessionStorage.setItem(CACHE_RELOAD_KEY, uid);
      } catch {
        tried = true; // no sessionStorage: can't guard a loop, don't reload
      }
      if (!tried) {
        await wipeLocalFirestore();
        location.reload();
        return new Promise(() => {}); // the page is going away
      }
    }
  }
  try {
    sessionStorage.removeItem(CACHE_RELOAD_KEY);
  } catch {
    /* storage off */
  }
  try {
    localStorage.setItem(CACHE_OWNER_KEY, uid);
  } catch {
    /* storage off */
  }
}
