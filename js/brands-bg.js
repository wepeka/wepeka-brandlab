// Background of the all-brands home (js/views/brands.js). Full-viewport
// drifting colour wash whose palette the Wepeka admin can swap per season
// (Settings → "Background Brand"). The choice lives in settings/main under
// `brandsBg` (same admin-write / everyone-read doc as the shared AI key), so
// every account sees the same background.
//
// The element is mounted on <body>, NOT inside main.view: main.view runs a
// transform animation (view-in) and Chromium then treats it as the
// containing block for position:fixed descendants, which clipped the wash to
// the content column instead of the whole screen.
import { getGlobalBrandsBg } from "./store.js";

// base = [top-left, bottom-right] of the dark base gradient; blobs = the three
// drifting glows. Every preset is deliberately dark — `glow` (blob opacity)
// is what the admin's intensity slider changes.
export const BG_PRESETS = [
  { key: "default",  label: "Indigo Malam (default)", base: ["#0b0a14", "#050505"], blobs: ["#6366f1", "#7c3aed", "#4f46e5"] },
  { key: "ramadan",  label: "Ramadan",               base: ["#07120e", "#040604"], blobs: ["#059669", "#d4a017", "#047857"] },
  { key: "lebaran",  label: "Lebaran",               base: ["#0d1208", "#050604"], blobs: ["#65a30d", "#eab308", "#15803d"] },
  { key: "merdeka",  label: "17 Agustus",            base: ["#140707", "#060404"], blobs: ["#dc2626", "#e5e7eb", "#b91c1c"] },
  { key: "halloween",label: "Halloween",             base: ["#0f0805", "#050403"], blobs: ["#ea580c", "#7c3aed", "#c2410c"] },
  { key: "natal",    label: "Natal",                 base: ["#07110b", "#050504"], blobs: ["#16a34a", "#dc2626", "#15803d"] },
  { key: "imlek",    label: "Imlek",                 base: ["#150606", "#060404"], blobs: ["#dc2626", "#f59e0b", "#991b1b"] },
  { key: "valentine",label: "Valentine",             base: ["#12070d", "#050405"], blobs: ["#db2777", "#f472b6", "#9d174d"] },
  { key: "newyear",  label: "Tahun Baru",            base: ["#090b12", "#040405"], blobs: ["#eab308", "#3b82f6", "#a16207"] },
  { key: "mono",     label: "Hitam Polos",           base: ["#0a0a0a", "#030303"], blobs: ["#525252", "#404040", "#737373"] },
];
export const DEFAULT_GLOW = 0.16; // was .32 — noticeably darker out of the box

const clampGlow = (n) => Math.min(0.5, Math.max(0.02, Number.isFinite(+n) ? +n : DEFAULT_GLOW));
const validHex = (s, fb) => (/^#[0-9a-f]{6}$/i.test(s || "") ? s : fb);

// Normalises whatever is stored into { preset, base, blobs, glow }.
export function resolveBrandsBg(raw = getGlobalBrandsBg()) {
  const preset = BG_PRESETS.find((p) => p.key === raw?.preset) || BG_PRESETS[0];
  const custom = raw?.preset === "custom";
  const base = custom ? [validHex(raw.base?.[0], preset.base[0]), validHex(raw.base?.[1], preset.base[1])] : preset.base;
  const blobs = custom ? [0, 1, 2].map((i) => validHex(raw.blobs?.[i], preset.blobs[i])) : preset.blobs;
  return { preset: custom ? "custom" : preset.key, base, blobs, glow: clampGlow(raw?.glow ?? DEFAULT_GLOW) };
}

export function bgHTML(cls = "") {
  return `<div class="brands-bg ${cls}"><span class="bg-blob bg-blob-1"></span><span class="bg-blob bg-blob-2"></span><span class="bg-blob bg-blob-3"></span></div>`;
}

// Paints the palette onto a .brands-bg element through CSS variables.
export function paintBrandsBg(el, cfg = resolveBrandsBg()) {
  if (!el) return;
  el.style.setProperty("--bgb-base-1", cfg.base[0]);
  el.style.setProperty("--bgb-base-2", cfg.base[1]);
  cfg.blobs.forEach((c, i) => el.style.setProperty(`--bgb-blob-${i + 1}`, c));
  el.style.setProperty("--bgb-glow", String(cfg.glow));
}

// Mounts the full-screen background on <body> and keeps it in sync with the
// shared setting. Returns the teardown to call when the view goes away.
export function mountBrandsBg() {
  document.querySelectorAll("body > .brands-bg").forEach((n) => n.remove());
  const wrap = document.createElement("div");
  wrap.innerHTML = bgHTML();
  const el = wrap.firstElementChild;
  paintBrandsBg(el);
  document.body.prepend(el);
  const onChange = () => paintBrandsBg(el);
  window.addEventListener("db:change", onChange);
  return () => { window.removeEventListener("db:change", onChange); el.remove(); };
}
