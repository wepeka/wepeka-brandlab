// What Brandlab's AI may read (2026-11-25): numbers Brandlab got from Meta
// (Instagram/Facebook through "Akun Sosmed", or a pasted token) stay out of
// every AI prompt. The AI runs on outside providers (DeepSeek by default,
// Gemini, Anthropic) that the Meta App Review answers and the privacy policy
// don't list as processors of Meta data — so, legal and safe first:
//   - a card's Instagram and Facebook figures and the from-ads part go; the
//     owner's own numbers (typed or read from a screenshot) and TikTok's stay;
//   - the brand's follower/reach figures from Meta go;
//   - the automatic Meta ad-spend expenses go (Sales stays what the owner logged).
// The choke points: brand-pulse.js pulseTextFor, consultant-panel.js
// buildSnapshot, views/report.js reportAdviceState, sales-tracker.js
// salesSnapshotText. Flip META_DATA_TO_AI only once the providers are vetted
// and listed (privacy policy + Meta's data handling answers).
export const META_DATA_TO_AI = false;

const FROM_META = ["instagram", "facebook"];
const fromMeta = (x) => !!x && FROM_META.includes(x.source);

export function contentForAi(c) {
  if (META_DATA_TO_AI || !c) return c;
  const by = c.performanceByPlatform || {};
  const metaKeys = new Set([...Object.keys(by.instagram || {}), ...Object.keys(by.facebook || {})]);
  if (!metaKeys.size && !c.igPaid) return c;
  const rest = Object.fromEntries(Object.entries(by).filter(([k]) => !FROM_META.includes(k)));
  const performance = { ...(c.performance || {}) };
  for (const k of metaKeys) {
    if (!(k in performance)) continue;
    const vals = Object.values(rest).map((p) => p?.[k]).filter((v) => v !== undefined && v !== null && v !== "");
    performance[k] = vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  }
  const { igPaid, ...keep } = c;
  return { ...keep, performanceByPlatform: rest, performance };
}

export function brandForAi(b) {
  if (META_DATA_TO_AI || !b) return b;
  const insights = { ...(b.insights || {}) };
  let changed = false;
  for (const p of FROM_META) if (fromMeta(insights[p])) { delete insights[p]; changed = true; }
  const history = Array.isArray(b.insightsHistory) ? b.insightsHistory : [];
  const kept = history.filter((h) => !fromMeta(h));
  if (!changed && kept.length === history.length) return b;
  return { ...b, insights, insightsHistory: kept };
}

export const isMetaAdExpense = (e) => e?.attribution === "auto" && String(e?.id || "").startsWith("meta-ads-");
export function trackerForAi(tracker) {
  if (META_DATA_TO_AI || !tracker) return tracker;
  const expenses = (tracker.expenses || []).filter((e) => !isMetaAdExpense(e));
  return expenses.length === (tracker.expenses || []).length ? tracker : { ...tracker, expenses };
}

export const contentListForAi = (list) => (META_DATA_TO_AI ? list : (list || []).map(contentForAi));
