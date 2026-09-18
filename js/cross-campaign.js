// Cross-campaign intelligence for Grow Brand: deterministic correlations
// across a brand's independent Social Media Growth / Community Growth
// / Sales Growth campaigns. This is the one place BrandLab compares the
// tracks — everywhere else they stay
// separate on purpose.
//
// Every insight is built from real milestone readings (js/campaign-metrics.js)
// — never a metric neither campaign can actually read — and is phrased as
// an observed PATTERN, not a proven cause. Comparing two live numbers is an
// inference, not a fact, so confidence here never goes above "likely"; an
// insight only fires when BOTH sides of the comparison are logged and not
// stale — if either side is missing or out of date, nothing is said at all.
// BrandLab should never sound more certain than its data allows.
import { campaignStages, activeStageIndex, readStage, campaignHeadline, stageStartedAt } from "./campaign-metrics.js";
import { t } from "./i18n.js";

const isRunning = (c) => c && !["archived", "completed"].includes(c.status);
function trackSnapshot(campaign, ctx) {
  if (!isRunning(campaign)) return null;
  const stages = campaignStages(campaign);
  const idx = activeStageIndex(campaign, stages, ctx.content);
  const stage = stages[idx];
  if (!stage) return null;
  // Every reading needs the campaign it belongs to (content pool, manual
  // numbers) — the shared ctx only carries the brand-wide parts.
  const own = { ...ctx, campaign };
  const head = campaignHeadline(campaign, stages, idx, own);
  if (!head) return null;
  const { readings } = readStage(stage, own);
  return { campaign, stage, head, readings, stageAgeDays: Math.floor((Date.now() - stageStartedAt(campaign, stage)) / 86400000) };
}
const fresh = (reading) => !!reading && reading.logged && !reading.stale;

const SALES_MIN_DAYS = 14;
const RULES = [
  // Followers/engagement progress meaningfully ahead of community progress.
  ({ social, community }) => {
    if (!social || !community || !fresh(social.head.reading) || !fresh(community.head.reading)) return null;
    const gap = social.head.reading.pct - community.head.reading.pct;
    if (gap < 0.25) return null;
    return {
      id: "social-ahead",
      confidence: "likely",
      text: t("cross.socialAhead.text"),
      detail: t("cross.socialAhead.detail", { socialPct: Math.round(social.head.reading.pct * 100), communityPct: Math.round(community.head.reading.pct * 100) }),
      areas: [t("cross.area.communityInvite"), t("cross.area.communityRitual")],
    };
  },
  // Community engaged and growing, but the content pace feeding it has stalled.
  ({ social, community }) => {
    if (!social || !community) return null;
    const published = social.readings.find((r) => r.milestone.metric === "content.published");
    if (!published || !fresh(published) || !fresh(community.head.reading)) return null;
    if (published.pct >= 0.6 || community.head.reading.pct < 0.4) return null;
    return {
      id: "content-behind-community",
      confidence: "likely",
      text: t("cross.contentBehindCommunity.text"),
      detail: t("cross.contentBehindCommunity.detail", { publishedPct: Math.round(published.pct * 100) }),
      areas: [t("cross.area.contentPace")],
    };
  },
  // Visibility growing, sales flat. Both numbers are real readings (followers
  // from Insights, sold from the user's own log) — but WHY they diverge is
  // not something this data can know, so the copy only points at places to
  // look (offer clarity, CTA, purchase flow), never at a cause.
  ({ social, sales }) => {
    if (!social || !sales || !fresh(social.head.reading) || !fresh(sales.head.reading)) return null;
    // A sales level that only just started is at 0% by definition — that's
    // not "flat", it's new. Give it two weeks before comparing.
    if (sales.stageAgeDays < SALES_MIN_DAYS) return null;
    const gap = social.head.reading.pct - sales.head.reading.pct;
    if (gap < 0.25 || sales.head.reading.pct >= 0.5) return null;
    return {
      id: "visibility-ahead-of-sales",
      confidence: "likely",
      text: t("cross.salesFlat.text"),
      detail: t("cross.salesFlat.detail", { socialPct: Math.round(social.head.reading.pct * 100), salesPct: Math.round(sales.head.reading.pct * 100) }),
      areas: [t("cross.area.offerClarity"), t("cross.area.cta"), t("cross.area.purchaseFlow")],
    };
  },
  // People are asking, few are buying: inquiries well ahead of sales in the
  // same level — both typed in by the user, both fresh.
  ({ sales }) => {
    if (!sales) return null;
    const inquiries = sales.readings.find((r) => r.milestone.metric === "sales.leads" && !r.milestone.notApplicable);
    if (!inquiries || !fresh(inquiries) || !fresh(sales.head.reading) || sales.stageAgeDays < SALES_MIN_DAYS) return null;
    if (inquiries.pct - sales.head.reading.pct < 0.3) return null;
    return {
      id: "inquiries-ahead-of-sales",
      confidence: "likely",
      text: t("cross.inquiriesAhead.text"),
      detail: t("cross.inquiriesAhead.detail", { inquiryPct: Math.round(inquiries.pct * 100), salesPct: Math.round(sales.head.reading.pct * 100) }),
      areas: [t("cross.area.followUp"), t("cross.area.purchaseFlow")],
    };
  },
];

// { campaigns, content, brand, settings } → insight[] (empty when the
// brand doesn't run both tracks yet, or there isn't enough fresh data to
// say anything responsibly).
export function crossCampaignInsights({ campaigns, content, brand, settings }) {
  const ctx = { brand, content, settings };
  // With #1 (multiple concurrent social campaigns per platform), more than
  // one can be running at once — pick the oldest as the representative
  // "social" snapshot for cross-track comparisons. A per-platform breakdown
  // would need each rule to loop over every social campaign; out of scope
  // for now, this just keeps the existing single-campaign comparisons sane.
  const socialCampaign = campaigns
    .filter((c) => c.goalPlan?.version === 3 && c.goalPlan.track === "social" && isRunning(c))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
  const communityCampaign = campaigns.find((c) => c.goalPlan?.version === 3 && c.goalPlan.track === "community" && isRunning(c));
  const salesCampaign = campaigns.find((c) => c.goalPlan?.version === 3 && c.goalPlan.track === "sales" && isRunning(c));
  const social = trackSnapshot(socialCampaign, ctx);
  const community = trackSnapshot(communityCampaign, ctx);
  const sales = trackSnapshot(salesCampaign, ctx);
  // Each rule checks for the tracks it needs — with fewer than two running
  // there's nothing to compare (the one sales-only rule still needs Sales).
  if ([social, community, sales].filter(Boolean).length < 2 && !sales) return [];
  return RULES.map((rule) => rule({ social, community, sales })).filter(Boolean);
}
