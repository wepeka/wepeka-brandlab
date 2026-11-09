// The shoot's raw clips, onto Wepeka's Mac by themselves (owner, 2026-11-09:
// "nanti kamu tinggal buka drivenya di folder apa bisa langsung kamu edit").
// The client's crew sends them into the client's Google Drive (js/footage.js,
// api/_footage.js); while Brandlab is open on the Mac with the Outbox folder
// connected, every clip is copied into the piece's own folder:
//   <Outbox>/<brand>/<code date title>/footage/IMG_0412.MOV
// — the same folder the cuts go into, so the edit starts right there.
// One tab copies at a time (Web Locks); a clip already there with the same
// size is left alone; one removed from the list stays on the Mac.
import { auth } from "./firebase.js";
import { outboxClipSize, outboxClipWriter } from "./outbox.js";

const API = "https://www.googleapis.com/drive/v3";

// What this tab knows of each piece's copy: { total, done, name, pct, error }.
const PROGRESS = new Map();
const watchers = new Set();
const tell = (id) => watchers.forEach((fn) => fn(id));
export const macProgress = (contentId) => PROGRESS.get(contentId) || null;
export function onMacProgress(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

// A name the Mac (and Chrome's folder writer) takes: no slashes or colons,
// not ending in a dot or a space.
export const macName = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 140).replace(/[.\s]+$/, "") || "footage";

async function review(action, body) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/review/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken || ""}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "server"), { code: json.error || "server", status: res.status });
  return json;
}

// A key to the client's Drive, per brand, for the hour it lasts.
const keys = new Map();
async function keyFor(c) {
  const k = keys.get(c.brandId);
  if (k && k.exp > Date.now() + 5 * 60_000) return k.token;
  const r = await review("footage-key", { contentId: c.id });
  keys.set(c.brandId, { token: r.accessToken, exp: Date.now() + (r.expiresIn || 3600) * 1000 });
  return r.accessToken;
}

async function copyClip(c, key, f, onPct) {
  const res = await fetch(`${API}/files/${encodeURIComponent(f.id)}?alt=media`, { headers: { authorization: `Bearer ${await keyFor(c)}` } });
  if (res.status === 401) keys.delete(c.brandId);
  if (res.status === 404) return "gone"; // deleted from their Drive meanwhile
  if (!res.ok || !res.body) throw Object.assign(new Error("drive"), { code: "drive", status: res.status });
  const total = Number(res.headers.get("content-length")) || f.size || 0;
  const out = await outboxClipWriter(key, macName(f.name));
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(value);
      got += value.length;
      if (total) onPct(got / total);
    }
    await out.close();
  } catch (e) {
    await out.abort?.().catch(() => {});
    throw e;
  }
  return "ok";
}

const onMac = new Set(); // `${contentId}/${clipId}` already checked or copied
const failedAt = new Map(); // contentId → when a copy last failed (wait a bit before the next try)
let running = false;
let again = false;

// pieces(): the contents with footage.files. keyOf(c): the piece's folder in the
// Outbox. remember(c, key): called once a piece's clips start landing, so
// its folder keeps that name even if the date or title changes later.
export async function syncFootageToMac(pieces, { keyOf, remember }) {
  if (running) { again = true; return; }
  running = true;
  try {
    const job = async () => {
      do {
        again = false;
        for (const c of pieces()) await syncPiece(c, keyOf(c), remember);
      } while (again);
    };
    if (navigator.locks?.request) await navigator.locks.request("brandlab-footage-mac", { ifAvailable: true }, (lock) => (lock ? job() : null));
    else await job();
  } finally {
    running = false;
  }
}

async function syncPiece(c, key, remember) {
  const files = c.footage?.files || [];
  if (!files.length || !key) return;
  if (Date.now() - (failedAt.get(c.id) || 0) < 2 * 60_000) return;
  const p = { total: files.length, done: 0, name: "", pct: 0, error: "", key };
  PROGRESS.set(c.id, p);
  const todo = [];
  for (const f of files) {
    const id = `${c.id}/${f.id}`;
    if (onMac.has(id)) { p.done++; continue; }
    const size = await outboxClipSize(key, macName(f.name));
    if (size >= 0 && (!f.size || size === f.size)) { onMac.add(id); p.done++; } else todo.push(f);
  }
  tell(c.id);
  if (todo.length) remember(c, key);
  for (const f of todo) {
    p.name = f.name;
    p.pct = 0;
    tell(c.id);
    try {
      const r = await copyClip(c, key, f, (pct) => { p.pct = pct; tell(c.id); });
      onMac.add(`${c.id}/${f.id}`);
      if (r === "ok") p.done++;
      else p.total--;
    } catch (e) {
      p.error = e.code || "copy";
      failedAt.set(c.id, Date.now());
      console.warn("[footage] copy to Mac", f.name, e.code || e.message);
    }
  }
  p.name = "";
  tell(c.id);
}
