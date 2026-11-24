// The account picker's ordering (js/meta-connect.js openMetaPicker), kept
// free of the browser so tests can run it: which Instagram looks like the
// brand, which Page belongs to an Instagram account, and which accounts
// another brand of the same owner already uses.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function looksLike(brandName, accountName) {
  const a = norm(brandName);
  const b = norm(accountName);
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
}
// The Page an Instagram account belongs to, as Meta reports it.
export function pageForIg(ig, pages) {
  if (!ig) return "";
  if (ig.pageId && pages.some((p) => p.id === ig.pageId)) return ig.pageId;
  const linked = pages.find((p) => p.igId && p.igId === ig.id);
  if (linked) return linked.id;
  const named = pages.filter((p) => norm(p.name) && norm(p.name) === norm(ig.username));
  return named.length === 1 ? named[0].id : "";
}
// Free accounts first (the brand-name look-alike on top), then the ones
// another brand uses. The current choice always counts as free.
export function sortForBrand(items, { brandName, usedBy = {}, current = "", label }) {
  const rows = items.map((x) => ({ ...x, usedBy: x.id === current ? "" : usedBy[x.id] || "", match: looksLike(brandName, label(x)) }));
  const rank = (x) => (x.id === current ? 0 : x.match ? 1 : 2);
  const free = rows.filter((x) => !x.usedBy).sort((a, b) => rank(a) - rank(b));
  const used = rows.filter((x) => x.usedBy);
  return { free, used };
}
