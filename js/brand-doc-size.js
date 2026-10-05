// Everything a brand owns — logo and its variants, mascots, moodboard
// photos, uploaded fonts, the book photo, the Beranda cover — is stored as
// base64 inside the ONE brand document, and Firestore refuses any document
// over 1 MiB. A write that goes over doesn't fail loudly on screen: the
// brand just stops saving. So every upload asks here first, before anything
// is written, and is refused with a reason when it wouldn't fit.
import { toast } from "./dom.js";
import { t } from "./i18n.js";

// Firestore's hard cap per document.
export const BRAND_DOC_LIMIT = 1024 * 1024;
// What uploads may fill: leaves ~120 KB for the text the owner keeps
// writing afterwards (DNA answers, notes, logs) and Firestore's own
// per-field overhead, which this estimate doesn't count.
export const BRAND_DOC_BUDGET = 900 * 1024;

// The brand as it would be written (store.js updateBrand sends the whole
// object), measured in UTF-8 bytes — what Firestore counts.
export function brandDocBytes(brand) {
  const json = JSON.stringify(brand || {});
  return typeof TextEncoder === "function" ? new TextEncoder().encode(json).length : json.length;
}

// Would the brand still fit once `patch` (the same top-level shape
// updateBrand takes) is applied? A change that makes the doc smaller is
// always allowed (swapping a big logo for a lighter one), as long as the
// result is under the hard cap.
export function brandDocFits(brand, patch = {}, { budget = BRAND_DOC_BUDGET } = {}) {
  const after = brandDocBytes({ ...(brand || {}), ...patch });
  if (after <= budget) return true;
  return after < BRAND_DOC_LIMIT && after <= brandDocBytes(brand);
}

// The check plus the toast, for upload handlers: true = go ahead and save.
export function guardBrandDocSize(brand, patch) {
  if (brandDocFits(brand, patch)) return true;
  toast(t("brandDoc.tooBig"), "error");
  return false;
}
