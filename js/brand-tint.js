// Which colour tints the app while a brand is open (js/layout.js
// applyBrandTint → --brand-tint). The Brand Book's primary colour wins once
// it's set — that's the colour the owner actually decided their brand is —
// then the colour picked when the brand was created (brand.color, default
// #ffa52b), and only with neither does layout.js sample the logo. Display
// only: nothing here writes brand.color.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function brandTintColor(brand) {
  const book = typeof brand?.brandGuidelines?.colors?.primary === "string" ? brand.brandGuidelines.colors.primary.trim() : "";
  if (HEX.test(book)) return book;
  const picked = typeof brand?.color === "string" ? brand.color.trim() : "";
  return picked || "";
}
