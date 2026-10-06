// Uploaded files out of the brand document.
//
// Logos (main + 2 variants), mascots, moodboard photos, uploaded fonts and
// the Beranda cover used to sit as base64 data URLs inside brands/{id} —
// one doc Firestore caps at 1 MiB, rewritten whole on every edit. Each file
// now has its own doc:
//
//   brands/{brandId}/assets/{assetId} = { ownerId, brandId, kind, dataUrl, name?, createdAt }
//
// and the brand doc keeps, in the SAME field that held the data URL, the
// string "asset:<assetId>". Nothing about the brand's shape changes, so the
// least code had to move: js/store.js swaps refs for data URLs when a
// brand's assets are loaded (hydrate) and data URLs for refs when the brand
// is written (dehydrate) — every view keeps reading `logo.dataUrl` etc.
//
// Old brands whose fields still hold data URLs read exactly as before; their
// blobs move out the next time the brand is saved (store.js writeBrand), in
// the same batch as the brand write — never one without the other.
//
// assetId is a hash of the content: the same file always gets the same id,
// so re-saving never duplicates it and a retried migration is idempotent.
// Pure module — no Firestore — so the import guard and tests can use it.

export const ASSET_PREFIX = "asset:";
// One asset doc must stay under Firestore's 1 MiB with its other fields:
// mirrored in firestore.rules (brands/{id}/assets) — keep the two in sync.
export const ASSET_MAX_CHARS = 1_000_000;

export const isDataUrl = (v) => typeof v === "string" && v.startsWith("data:");
export const isAssetRef = (v) => typeof v === "string" && v.startsWith(ASSET_PREFIX) && v.length > ASSET_PREFIX.length;
export const assetIdOf = (ref) => String(ref).slice(ASSET_PREFIX.length);

// 53-bit string hash (cyrb53), run with two seeds: ~106 bits, plenty for
// the few dozen files a brand holds. Synchronous, so dehydrating stays
// inside store.js's synchronous write path.
function hash53(str, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const idCache = new Map();
export function assetIdFor(dataUrl) {
  let id = idCache.get(dataUrl);
  if (!id) {
    id = `a${hash53(dataUrl, 1).toString(36)}${hash53(dataUrl, 7).toString(36)}${dataUrl.length.toString(36)}`;
    if (idCache.size > 400) idCache.clear();
    idCache.set(dataUrl, id);
  }
  return id;
}

// Every field that can hold an uploaded file, as [value, kind, name]:
//   coverPhoto                                   (Beranda cover)
//   brandGuidelines.logo.dataUrl / secondaryDataUrl / logotypeDataUrl
//   brandGuidelines.mascots[].dataUrl            (name = mascot name)
//   brandGuidelines.moodboard[].dataUrl
//   brandGuidelines.customFonts[name]            (name = font family)
// NOT brandGuidelines.bookPhoto: the production app before this release
// turns any bookPhoto that isn't data:image/ or https:// into "" when it
// saves the Brand Book (its answersFromBrand) — a tab still running it
// would unlink a ref. It stays inline in the brand doc for now.
// `fn(value, kind, name)` returns the replacement; parts that didn't change
// are returned as the very same objects (nothing is copied needlessly), and
// `brand` itself is never mutated. Works on a partial brand ({ coverPhoto })
// too. The brand avatar stays inline on purpose: it's small (400px) and the
// brand list shows every brand's at once.
const LOGO_SLOTS = [["dataUrl", "logo"], ["secondaryDataUrl", "logo-secondary"], ["logotypeDataUrl", "logotype"]];
const LIST_SLOTS = [["mascots", "mascot"], ["moodboard", "moodboard"]];
function mapGuidelines(bg, fn) {
  let out = bg;
  const set = (k, v) => {
    if (out === bg) out = { ...bg };
    out[k] = v;
  };
  if (bg.logo && typeof bg.logo === "object") {
    let logo = bg.logo;
    LOGO_SLOTS.forEach(([field, kind]) => {
      if (typeof logo[field] !== "string") return;
      const v = fn(logo[field], kind, null);
      if (v === logo[field]) return;
      if (logo === bg.logo) logo = { ...logo };
      logo[field] = v;
    });
    if (logo !== bg.logo) set("logo", logo);
  }
  LIST_SLOTS.forEach(([key, kind]) => {
    const list = bg[key];
    if (!Array.isArray(list)) return;
    let changed = false;
    const next = list.map((item) => {
      if (!item || typeof item.dataUrl !== "string") return item;
      const v = fn(item.dataUrl, kind, item.name || null);
      if (v === item.dataUrl) return item;
      changed = true;
      return { ...item, dataUrl: v };
    });
    if (changed) set(key, next);
  });
  if (bg.customFonts && typeof bg.customFonts === "object" && !Array.isArray(bg.customFonts)) {
    let fonts = bg.customFonts;
    Object.entries(bg.customFonts).forEach(([name, value]) => {
      if (typeof value !== "string") return;
      const v = fn(value, "font", name);
      if (v === value) return;
      if (fonts === bg.customFonts) fonts = { ...fonts };
      fonts[name] = v;
    });
    if (fonts !== bg.customFonts) set("customFonts", fonts);
  }
  return out;
}
export function mapBlobSlots(brand, fn) {
  if (!brand || typeof brand !== "object") return brand;
  let out = brand;
  if (typeof brand.coverPhoto === "string") {
    const v = fn(brand.coverPhoto, "cover", null);
    if (v !== brand.coverPhoto) out = { ...out, coverPhoto: v };
  }
  if (brand.brandGuidelines && typeof brand.brandGuidelines === "object") {
    const bg = mapGuidelines(brand.brandGuidelines, fn);
    if (bg !== brand.brandGuidelines) out = { ...out, brandGuidelines: bg };
  }
  return out;
}
// The top-level brand fields that can carry files.
export const BLOB_FIELDS = ["brandGuidelines", "coverPhoto"];

export function blobValues(brand) {
  const out = [];
  mapBlobSlots(brand, (value, kind, name) => {
    out.push({ value, kind, name });
    return value;
  });
  return out;
}
// Inline files that the next save will move out (see isStorableBlob).
export const hasInlineBlobs = (brand) => blobValues(brand).some((s) => isStorableBlob(s.value));
export function assetRefsOf(brand) {
  return new Set(blobValues(brand).filter((s) => isAssetRef(s.value)).map((s) => assetIdOf(s.value)));
}

// A data URL firestore.rules accepts as an asset doc (size, "data:…,…", no
// newline). Anything else — an oversized font that only just fit the old
// brand doc, say — stays inline where it is, rather than failing every save
// of the brand on a migration the rules would refuse.
export const isStorableBlob = (v) => isDataUrl(v) && v.length <= ASSET_MAX_CHARS && v.indexOf(",") > 5 && !v.includes("\n");

// Data URLs → refs. Returns the brand as it is stored plus the files to
// write as asset docs ({ id, kind, name, dataUrl }, one per distinct file).
export function dehydrateBlobs(brand) {
  const uploads = new Map();
  const stored = mapBlobSlots(brand, (value, kind, name) => {
    if (!isStorableBlob(value)) return value;
    const id = assetIdFor(value);
    if (!uploads.has(id)) uploads.set(id, { id, kind, name, dataUrl: value });
    return ASSET_PREFIX + id;
  });
  return { stored, uploads: [...uploads.values()] };
}
// Refs → data URLs, for whichever ids `lookup(id)` knows; unknown refs stay.
export function hydrateBlobs(brand, lookup) {
  return mapBlobSlots(brand, (value) => {
    if (!isAssetRef(value)) return value;
    const dataUrl = lookup(assetIdOf(value));
    return typeof dataUrl === "string" && dataUrl ? dataUrl : value;
  });
}

// The brand doc's size as stored, for size checks: files as refs (~30
// chars each) and no sales entries (brands/{id}/sales, js/sales-tracker.js).
export function brandAsStored(brand) {
  const out = mapBlobSlots(brand || {}, (v) => (isStorableBlob(v) ? `${ASSET_PREFIX}a0000000000000000000000000` : v));
  if (Array.isArray(out?.salesTracker?.entries)) {
    const { entries, ...rest } = out.salesTracker;
    return { ...out, salesTracker: rest };
  }
  return out;
}
// Any file in `value` (a brand or a patch of one) too big for its own doc.
export const hasOversizedBlob = (value) => blobValues(value).some((s) => isDataUrl(s.value) && s.value.length > ASSET_MAX_CHARS);
