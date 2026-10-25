// Small helpers shared by every module.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = (p = "") => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => {}; return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}
// Field-level patch that turns `a` into `b`; nested objects become nested patches,
// removed keys become null (the store treats null as "absent").
function diffPatch(a, b) {
  const p = {};
  a = a || {}; b = b || {};
  for (const k of Object.keys(b)) {
    if (deepEqual(a[k], b[k])) continue;
    if (isObj(a[k]) && isObj(b[k])) { const sub = diffPatch(a[k], b[k]); if (Object.keys(sub).length) p[k] = sub; }
    else p[k] = b[k] === undefined ? null : clone(b[k]);
  }
  for (const k of Object.keys(a)) if (!(k in b) && a[k] != null) p[k] = null;
  return p;
}
function deepMerge(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
// Applying a patch to local state: nulls delete keys.
function applyPatch(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete out[k];
    else if (isObj(v) && isObj(out[k])) out[k] = applyPatch(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o && k in o ? clone(o[k]) : null; return r; }

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  const s = `${d.getDate()} ${BULAN[d.getMonth()]}`;
  return withTime ? `${s}, ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}` : s + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
}
function fmtDay(iso) { if (!iso) return ""; const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : "")); return isNaN(d) ? iso : `${d.getDate()} ${BULAN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`; }
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "baru saja";
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return fmtDate(ts);
}
// "45 mnt", "1 j 20 mnt" for a meeting's length.
function durLabel(ms) { const m = Math.round((ms || 0) / 60000); if (!ms || m < 1) return ms ? "< 1 mnt" : "–"; return m < 60 ? `${m} mnt` : `${Math.floor(m / 60)} j${m % 60 ? ` ${m % 60} mnt` : ""}`; }
// How much one brand may keep, so the shared database stays small: boards per
// brand and pictures per board (pictures are stored inside the board's data).
// A host can set window.__papanLimits; Brandlab uses these.
const LIMITS = { boards: 20, images: 30, ...(window.__papanLimits || {}) };
const rupiah = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const num = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–");
const pct = (n, d = 1) => (isFinite(n) ? num(n, d) + "%" : "–");

// "(data contoh)" only in the claude.ai prototype with its made-up brand.
const EX = () => (window.__papanHost === "brandlab" ? "" : " (data contoh)");
const BL = () => window.__papanHost === "brandlab";
// Someone outside the team on the board's guest link (host/guest.js): no brand
// data, no AI, only this board.
const GUEST = () => !!window.__papanGuest;
const LS = {
  key: (k) => "papan:" + (window.__papanNS ? window.__papanNS + ":" : "") + k,
  get(k, d = null) { try { const v = localStorage.getItem(LS.key(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS.key(k), JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(LS.key(k)); } catch {} },
};

function toast(msg, opts = {}) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (opts.action) {
    const b = document.createElement("button");
    b.textContent = opts.action;
    b.onclick = () => { el.remove(); opts.onAction && opts.onAction(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), opts.ms || (opts.action ? 6500 : 3200));
  return el;
}

// Text helpers for the free (rule-based) tools.
const STOP = new Set("yang dan di ke dari untuk dengan ini itu ada kita kami aku kamu jadi bisa akan pada atau juga tidak gak ga nggak buat biar lebih sangat sudah udah belum masih saja aja dong sih kok kan nya pun lagi para oleh dalam karena kalau kalo agar supaya tapi tetapi sama apa siapa mana gimana bagaimana per the a an of to in for on is are".split(" "));
function tokens(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(nya|kan|lah)$/,"")).filter((w) => w.length > 2);
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
function safeUrl(u) {
  try {
    const s = String(u || "").trim();
    const url = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch { return null; }
}
function looksLikeUrl(s) { return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(String(s || "").trim()); }
function initials(name) { const p = String(name || "?").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
function readableOn(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return "#1c1610";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1c1610" : "#ffffff";
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = [880, 1046, 1318][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.4);
    });
  } catch {}
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if ([...document.scripts].some((s) => s.src === src)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("gagal memuat " + src));
    document.head.appendChild(s);
  });
}
