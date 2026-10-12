// A door elsewhere in the app can ask the pricing page to open with the
// 3-brand subscription already selected instead of the 1-brand one — a trial
// that wants a second brand (js/brand-offer.js) must not land on the plan
// that still holds one. One-shot: the page takes the wish and forgets it.
const KEY = "brandlab:pricing-brands";

export function askPricingBrands(n) {
  try {
    sessionStorage.setItem(KEY, String(n));
  } catch {
    // no storage: the page opens on its default size
  }
}

export function takePricingBrands() {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v === "3" ? 3 : 1;
  } catch {
    return 1;
  }
}
