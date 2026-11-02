// Video codes (owner, 2026-11-02: "ada kode videonya biar aku ngomong ke
// Claude gampang"). Every Instagram piece of Wepeka's own brands gets a short
// code to say or paste: the brand's letters and a number, KP-12; a trial cut
// of it is KP-12B, KP-12C … The number is saved on the piece once (videoNo,
// quietly — it isn't an edit) and never handed out twice in a brand; the
// letters follow the brand's name. Private, like the rest of Video & posting:
// only its admin-gated callers run ensureCodes().
import { listBrands, listContent, setContentQuiet } from "./store.js";

// "KP-12", "KP-12B", "WIN-3" at the start of a folder name or a sentence.
export const CODE_RE = /^([A-Z][A-Z0-9]{0,5})-(\d{1,4})([B-Z])?(?=$|[\s·_–-])/;
export const TRIAL_LETTERS = "BCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// "Kopi Pagi" → KP, "Pinter Mandarin" → PM, "@winkhsin" → WIN.
export function brandPrefix(name) {
  const words = String(name || "").normalize("NFKD").replace(/[^A-Za-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "V";
  const p = (words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 3).map((w) => w[0]).join("")).toUpperCase();
  return /^[A-Z]/.test(p) ? p : `V${p}`;
}

// Two brands with the same letters: the newer one gets a 2 (KP, KP2).
export function prefixesOf(brands) {
  const out = new Map();
  const seen = new Map();
  [...brands].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id))).forEach((b) => {
    const p = brandPrefix(b.name);
    const n = (seen.get(p) || 0) + 1;
    seen.set(p, n);
    out.set(b.id, n > 1 ? `${p}${n}` : p);
  });
  return out;
}

export const codeOf = (c, prefix) => (c?.videoNo ? `${prefix}-${c.videoNo}${c.trialOf ? c.trial || "" : ""}` : "");

// "KP-12B" → { code: "KP-12B", base: "KP-12", letter: "B" }.
export function parseCode(s) {
  const m = CODE_RE.exec(String(s || "").trim().toUpperCase());
  if (!m) return null;
  return { code: `${m[1]}-${Number(m[2])}${m[3] || ""}`, base: `${m[1]}-${Number(m[2])}`, letter: m[3] || "" };
}

// The pieces that carry a code: Instagram ones, minus posts that went out
// before Video & posting existed.
export const codedPiece = (c) => (!c.platform || /instagram/i.test(c.platform)) && !(c.status === "published" && !c.posting?.versions?.length);

// The numbers to save for one brand: oldest piece first, a number taken by
// an older piece (two devices at once) moves to the newer one, and a number
// once used — even by a piece now in Trash — isn't used again. A trial takes
// its piece's number. `all` = every piece of the brand, Trash included.
export function planCodes(items, all = items) {
  const order = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
  let max = all.reduce((m, c) => (c.trialOf ? m : Math.max(m, Number(c.videoNo) || 0)), 0);
  const out = [];
  const seen = new Set();
  const numberOf = new Map(all.filter((c) => !c.trialOf && c.videoNo).map((c) => [c.id, Number(c.videoNo)]));
  for (const c of items.filter((x) => !x.trialOf).sort(order)) {
    let n = Number(c.videoNo) || 0;
    if (!n || seen.has(n)) {
      n = ++max;
      out.push({ id: c.id, videoNo: n });
    }
    seen.add(n);
    numberOf.set(c.id, n);
  }
  for (const c of items.filter((x) => x.trialOf).sort(order)) {
    const n = numberOf.get(c.trialOf) || 0;
    if (n && Number(c.videoNo) !== n) out.push({ id: c.id, videoNo: n });
  }
  return out;
}

// A new trial of a piece: same day, kind and caption, its own videos.
export function trialFields(parent, letter, title = parent.title) {
  return {
    title: `${title || ""} · Trial ${letter}`.replace(/^ · /, ""),
    scheduleDate: parent.scheduleDate || "", platform: parent.platform || "Instagram", format: parent.format || "Reels", funnel: parent.funnel || "TOFU",
    status: "production", caption: parent.caption || "",
    trialOf: parent.id, trial: letter, videoNo: Number(parent.videoNo) || 0,
  };
}

export function nextTrialLetter(parentId, pieces) {
  const used = new Set(pieces.filter((c) => c.trialOf === parentId).map((c) => c.trial));
  return TRIAL_LETTERS.find((l) => !used.has(l)) || "";
}

// ---- runtime ------------------------------------------------------------------
export function ensureCodes() {
  for (const b of listBrands()) {
    const all = listContent(b.id, { includeArchived: true, includeDeleted: true });
    planCodes(listContent(b.id).filter(codedPiece), all).forEach(({ id, videoNo }) => setContentQuiet(id, { videoNo }));
  }
}

let prefixCache = { key: "", map: new Map() };
function prefixFor(brandId) {
  const brands = listBrands();
  const key = brands.map((b) => `${b.id}:${b.name}`).join("|");
  if (key !== prefixCache.key) prefixCache = { key, map: prefixesOf(brands) };
  return prefixCache.map.get(brandId) || "V";
}
export const videoCode = (c) => (c?.videoNo ? codeOf(c, prefixFor(c.brandId)) : "");

export function findByCode(code) {
  const want = parseCode(code)?.code;
  if (!want) return null;
  for (const b of listBrands()) {
    const hit = listContent(b.id).find((c) => c.videoNo && videoCode(c) === want);
    if (hit) return hit;
  }
  return null;
}
