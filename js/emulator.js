// Local testing on the Firebase Emulator Suite (firebase.json "emulators")
// instead of the real project — for the team features, which need two
// signed-in people and rules that are not deployed yet. Only ever on this
// Mac's dev server: the page must be on localhost/127.0.0.1 port 8743 AND
// have been opened once with ?emu=1 (remembered in localStorage until
// ?emu=0; sessionStorage would not do, logout clears it). The production
// host can never match, so the switch is inert there.
//
// In emulator mode the app talks to project "demo-brandlab": a demo-* id is
// never a real project, so nothing here can reach production data even by
// mistake, and the browser keeps that sign-in and cache apart from the real
// one (both are keyed by apiKey/project).
export const EMULATOR_PORT = "8743";
const FLAG = "brandlab:emu";

export function emulatorWanted(loc, storage) {
  try {
    if (!loc || !["localhost", "127.0.0.1"].includes(loc.hostname) || String(loc.port) !== EMULATOR_PORT) return false;
    const q = new URLSearchParams(loc.search || "").get("emu");
    if (q === "1") storage?.setItem(FLAG, "1");
    if (q === "0") storage?.removeItem(FLAG);
    return storage?.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function browserStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const IS_EMULATOR = typeof location !== "undefined" && emulatorWanted(location, browserStorage());

export const EMULATOR_CONFIG = {
  apiKey: "demo-key",
  authDomain: "demo-brandlab.firebaseapp.com",
  projectId: "demo-brandlab",
  appId: "demo-app",
};
export const EMULATOR_AUTH_URL = "http://127.0.0.1:9099";
export const EMULATOR_FIRESTORE = { host: "127.0.0.1", port: 8080 };

// A red corner chip on every page in emulator mode, so a test session can
// never be mistaken for the real app.
if (IS_EMULATOR && typeof document !== "undefined") {
  const chip = () => {
    if (document.getElementById("emu-chip")) return;
    const el = document.createElement("div");
    el.id = "emu-chip";
    el.textContent = "EMULATOR · data tiruan";
    el.title = "Firebase Emulator lokal (demo-brandlab). Buka ?emu=0 untuk kembali ke data asli.";
    el.style.cssText = "position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:2147483647;background:#d62828;color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap;padding:4px 9px;border-radius:0 0 6px 6px;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;";
    document.body.appendChild(el);
  };
  if (document.body) chip();
  else document.addEventListener("DOMContentLoaded", chip);
}
