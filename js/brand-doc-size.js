// Firestore refuses any document over 1 MiB, and a write that goes over
// doesn't fail loudly on screen: the brand just stops saving. So every
// upload asks here first, before anything is written, and is refused with
// a reason when it wouldn't fit.
//
// Uploaded files (logo and its variants, mascots, moodboard photos, fonts,
// the book photo, the Beranda cover) no longer live inside the brand doc:
// each is its own doc under brands/{id}/assets and the brand keeps a short
// "asset:<id>" ref (js/brand-assets.js). So what's measured here is the
// brand doc as it is STORED — files counted as refs, the sales log (its own
// subcollection too, js/sales-tracker.js) left out — plus a check that each
// new file fits its own asset doc.
import { toast } from "./dom.js";
import { t } from "./i18n.js";
import { brandAsStored, hasOversizedBlob } from "./brand-assets.js";

// Firestore's hard cap per document.
export const BRAND_DOC_LIMIT = 1024 * 1024;
// What the brand doc may fill: leaves ~120 KB for the text the owner keeps
// writing afterwards (DNA answers, notes, logs) and Firestore's own
// per-field overhead, which this estimate doesn't count.
export const BRAND_DOC_BUDGET = 900 * 1024;

// Measured in UTF-8 bytes — what Firestore counts.
export function brandDocBytes(brand) {
  const json = JSON.stringify(brandAsStored(brand));
  return typeof TextEncoder === "function" ? new TextEncoder().encode(json).length : json.length;
}

// Would the brand still fit once `patch` (the same top-level shape
// updateBrand takes) is applied? Every new file must fit its own asset doc;
// then the brand doc itself must stay within budget — a change that makes
// it smaller is always allowed, as long as the result is under the hard cap.
export function brandDocFits(brand, patch = {}, { budget = BRAND_DOC_BUDGET } = {}) {
  if (hasOversizedBlob(patch)) return false;
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
