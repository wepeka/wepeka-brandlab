// Which colour tints the app while a brand is open (js/layout.js
// applyBrandTint → --brand-tint): the colour picked for the brand
// (brand.color — Edit Brand → Brand Color), and only without one does
// layout.js sample the logo. The Brand Book's primary colour deliberately
// does NOT take over: it's often a deep, muted brand colour, and tinting
// every button and pill with it made the whole app look flat (2026-10-07,
// owner feedback). Display only: nothing here writes brand.color.
export function brandTintColor(brand) {
  const picked = typeof brand?.color === "string" ? brand.color.trim() : "";
  return picked || "";
}
