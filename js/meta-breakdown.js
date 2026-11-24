// One post's numbers from Meta, each source apart (2026-11-25): Instagram
// organic, what came from ads (Facebook Login only: Meta's totals minus the
// organic numbers, api/_instagram.js paidFromTotals), and Facebook (the
// same video on the Page). Shown on top of "Isi angka" (js/views/content-
// list.js openQuickFillModal). Pure, so tests can run it.
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, num(o?.[k])]));
const KEYS = ["views", "likes", "comments"];
const has = (o) => Object.values(o).some((v) => v !== null);

export function metaBreakdown(c) {
  const by = c?.performanceByPlatform || {};
  const ig = { ...pick(by.instagram, KEYS), ...pick(by.instagram, ["reach", "shares", "saves"]) };
  const fb = pick(by.facebook, KEYS);
  const ads = c?.igPaid ? pick(c.igPaid, KEYS) : null;
  if (!has(ig) && !has(fb) && !(ads && has(ads))) return null;
  const sum = (k) => {
    const parts = [ig[k], ads?.[k], fb[k]].filter((v) => v !== null);
    return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  };
  return {
    ig,
    ads,
    fb: has(fb) ? fb : null,
    total: Object.fromEntries(KEYS.map((k) => [k, sum(k)])),
    adsKnown: !!c?.igPaid,
  };
}
