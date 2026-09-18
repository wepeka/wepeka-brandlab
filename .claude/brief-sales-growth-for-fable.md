# Brief: Sales Growth (third Grow Brand engine)

**For:** a fresh chat session (referred to here as "you")
**From:** a prior session that just finished Social Media Growth + Community Growth
**Status of this brief:** the other two-thirds of Grow Brand are DONE and live in this repo. This is a self-contained spec for building the third, matching their architecture. You have not seen the earlier conversation — everything you need is below or in the referenced files.

---

## 1. What Grow Brand already is (read this first, in the code, not just here)

BrandLab's "Grow Brand" feature deploys independent growth-tracking campaigns when the user clicks it. As of this brief, TWO of the planned three exist:

- **Social Media Growth** — 2 levels (Dikenal → Dipercaya), built in `js/goal-plan.js` (`buildSocialGrowthPlan`, `SOCIAL_LEVELS`, `placeStartSocialLevel`).
- **Community Growth** — 3 levels (Bergabung → Partisipasi Aktif → Rasa Memiliki), same file (`buildCommunityGrowthPlan`, `COMMUNITY_LEVELS`, `placeStartCommunityLevel`).

Both are launched together from one wizard, `js/views/goal-wizard.js` (`openGoalWizard`), which asks each track's own onboarding questions, previews both plans, and creates them as two separate Firestore campaign documents on one "Deploy" click. Each is a normal `campaign` document with `campaign.missions` (the level ladder) and `campaign.goalPlan = { version: 3, track: "social" | "community", ... }`.

**Read these four files before writing any code — they ARE the pattern to follow, not just prior art:**
1. `js/goal-plan.js` — the growth math (feasibility bands, curve-fitting, Dunbar circles) and the two plan builders. Sales needs a third builder here, `buildSalesGrowthPlan`, following the exact same shape.
2. `js/views/goal-wizard.js` — the onboarding UI. Sales needs a third step added to `order`/`state` here, or you may decide it needs its own separate flow (see §4 — Sales' data shape is genuinely different, so think about this rather than force-fitting).
3. `js/campaign-metrics.js` — the metric-source registry (`METRIC_SOURCES`) that every milestone reads through, and the milestone/stage reading logic (`readMilestone`, `readStage`). Note lines ~218-222: `sales.leads` and `sales.revenue` are ALREADY stubbed here as manual-number sources with a note ("Sales Tracker doesn't exist yet" — `camp.m.note.salesSoon`). That stub is exactly why Sales Growth can ship now: no backend sales-tracking integration exists or is planned, so every sales number is manually entered by the user, same as Community's member counts.
4. `js/cross-campaign.js` — deterministic cross-track insights (currently Social↔Community only). It's written generically (`RULES` array, each rule takes `{ social, community }`) — extending it to a third track is expected; see §6.

Also skim `js/views/campaigns.js` (the campaign list — Grow Brand's three tracks render as a grouped section with the insight banner above them) and `js/i18n/campaigns.js` (all the `goal.*` / `store.ms.*` copy for the two existing tracks — Sales needs its own block in the same file, following the SAME i18n round-trip pattern described at the top of that file and in `js/goal-plan.js`'s own header comment).

## 2. The constraint that matters most: no fake analytics

BrandLab currently has **no ads tracking, no ROAS/CPC/CPM/CPA, no attribution, and no real sales-tracking backend**. `js/ads.js` is a nascent, read-only Meta ads client (`fetchAdInsights`: spend/impressions/reach/clicks/cpm only) used ONLY inside the Content Editor's per-post "ads performance" panel — it is NOT wired into any campaign, goal, or milestone, and must stay that way for Sales Growth. Do not:
- Ask the user for ROAS, CPC, CPM, CPA, CTR, or ad spend anywhere in Sales Growth onboarding or its detail page.
- Compute or display a "conversion rate" unless you can show the actual numerator and denominator both came from real data (manually entered sales ÷ manually entered leads/inquiries is fine and IS real; inventing a rate from partial data is not).
- Connect `js/ads.js` into Sales Growth's UI. It's fine to leave the architecture open for a future ads integration (e.g., don't hardcode assumptions that would block it later), but nothing ads-related becomes user-facing here.

Everything Sales Growth tracks must be either (a) something the app can already read (nothing currently — there is no sales API) or (b) something the user types in by hand. Right now that means (b) for everything. Say so honestly in the UI — don't dress up manual entry as automatic tracking.

## 3. Onboarding — what to actually ask

Start with: **"What products or services do you currently sell?"** — allow multiple entries (a list, not one field). Per product/service, ask:
- Name
- Selling price
- Amount sold so far
- Target amount sold
- Target timeframe

Optionally (never mandatory) collect: revenue so far, revenue target, approximate cost, current monthly sales. A beginner who only knows product/price/sold/target must already be able to create a working campaign — don't gate creation on the optional fields.

**Adapt the vocabulary to the business model** — don't force everyone into "units sold":
- Product business → units sold
- Agency → projects / clients completed
- SaaS → subscribers
- Course → students
- Restaurant → orders

A simple business-type picker (or just letting the "amount" label read differently per a chosen unit noun) is enough — don't overbuild a taxonomy. Look at how `js/goal-plan.js`'s `SALES_UNITS`-equivalent used to work in the OLD (now-removed) goal-plan.js if you want prior art — it's gone from the current file (search git history / `.claude/plan-campaign-orchestration.md` if you need it), but the concept (a chip-select for the counting unit) is a reasonable pattern to reuse, generalized beyond just "orders vs. revenue" to the 5 business-model nouns above.

## 4. The real design challenge: multiple products vs. one scalar target

Social Media Growth and Community Growth each track ONE number (followers, members). Sales Growth is different: the user may list several products/services, each with its own price/sold/target. Decide deliberately how this rolls up:
- Does the campaign track an aggregate (total units sold across all products, or total revenue) as its headline milestone, with per-product numbers as supporting detail?
- Or does each product get its own milestone within the same level (e.g. "Product A: 12/50 sold", "Product B: 3/20 sold" as separate rows)?

Either is defensible — but whichever you pick, do NOT collapse dissimilar products into one meaningless blended percentage (e.g. don't average "50% of units-sold target" with "20% of revenue target" into one number — that's exactly the anti-pattern the rest of Grow Brand was just fixed to avoid, see `js/views/campaign-detail.js`'s `headlineHTML` — a recent fix there stopped a milestone-count ratio from being shown as a bare misleading "%"). If you aggregate, aggregate like-for-like (all units sold, or all revenue, not both mixed).

## 5. Funnel

Internally: Awareness → Interest → Consideration → Intent → Conversion → Repeat Purchase → Advocacy. Beginner-facing UI wording: "People discover you → Become interested → Consider buying → Buy → Buy again → Recommend you." Don't make users learn the marketing terms to operate the system — same principle Social/Community already follow (see how `js/funnel-field.js` translates TOFU/MOFU/BOFU to plain language for Guided mode, and how `store.mission.*` level names/descriptions in `js/i18n/campaigns.js` avoid jargon).

Sales' 2-3 levels (design your own count, following the Social/Community precedent of using real bottleneck-placement logic like `placeStartSocialLevel`/`placeStartCommunityLevel`) should map roughly to that funnel: something like "Get first sales" (early proof, testimonials) → "Grow orders" (repeat rate, referrals) rather than a flat single level.

## 6. Cross-campaign intelligence

`js/cross-campaign.js` is deliberately generic — extend `crossCampaignInsights()` to look up a `sales` track the same way it looks up `social`/`community` (`campaigns.find((c) => c.goalPlan?.version === 3 && c.goalPlan.track === "sales" && isRunning(c))`), and add 1-2 new deterministic rules once Sales exists, e.g. the flagship example from BrandLab's original design brief: "followers/reach growing, sales flat" → suggest checking offer clarity, CTA, or purchase flow (NOT "your offer is the problem" — same "likely, not known" confidence discipline the existing two rules already follow: only fire when both sides are logged and fresh, cap confidence at "likely," never assert a specific number you can't actually compute).

## 7. What NOT to touch

- `js/ads.js` — leave alone entirely.
- Social Media Growth / Community Growth's own logic in `js/goal-plan.js` — additive only, don't refactor their builders while adding a third.
- Don't reintroduce the OLD single-campaign 4-level "Grow Brand" ladder (`GOAL_LEVELS`/`buildGrowBrandPlan`) — it was deliberately removed in favor of the track-pure model. If you need to see what it looked like for reference, it's in git history before this brief's commit (or ask the user).

## 8. i18n — do this correctly, it's easy to get subtly wrong

This codebase stores a LITERAL canonical string (Indonesian) as each milestone's `label`/`unit`/level `name` in Firestore, then re-translates it at render time via a reverse lookup (`js/store.js`: `MS_LABEL_KEYS`, `UNIT_KEYS`, `MISSION_KEYS`). That means:
- Milestone `label` and `unit` fields in `buildSalesGrowthPlan` must be **hardcoded literal strings**, not `t()` calls — and each new one needs a matching `store.ms.*` / `store.unit.*` entry added to `js/i18n/campaigns.js` (see how `store.ms.goalCreateGroup` / `store.ms.goalAdvocates` were added for Community Growth as the template).
- Level `name` fields need a `store.mission.<key>.name/desc/tagline` entry and a matching addition to `MISSION_KEYS` in `js/store.js` (see how `com1`/`com2`/`com3` were added there for Community Growth).
- `description` fields can just call `t("goal.ms.xxxDesc")` directly (these don't round-trip as strictly — consistent with how the existing tracks do it).

Get this wrong and level names/milestone labels will render correctly at creation time but silently stay frozen in whichever language was active when the campaign was created, instead of following the user's language toggle. Not a crash, just a quality regression — worth doing right the first time since you're literally copying a working example.

## 9. Where the real estate is

`js/views/sales.js` currently is a literal "coming soon" stub (nav tab was removed until this exists — check `js/main.js` / `js/layout.js` for the nav-gating and restore it once Sales Growth is real). This page is presumably where Sales Growth's campaign(s) should surface, OR — more consistent with how Social/Community work — Sales Growth might just be a third campaign card in the existing `js/views/campaigns.js` grouped Grow Brand section (grep for `growBrandSectionHTML` there) rather than a separate page. Decide based on what `js/views/sales.js` was originally scoped for (check `.claude/next-session-prompt.md` and `.claude/brief-fix-user-flow.md` in this repo for its history) versus whether Grow Brand's existing campaign-detail page (`js/views/campaign-detail.js`) is simply the right home for it, same as the other two tracks.

## 10. Definition of done

- `buildSalesGrowthPlan` in `js/goal-plan.js`, mirroring the other two builders' shape and quality (real feasibility math, not arbitrary numbers).
- Onboarding step(s) for Sales added to (or alongside) `js/views/goal-wizard.js`, asking only what §3 lists, with business-model-adapted vocabulary.
- Sales campaign renders in the Grow Brand grouped section in `js/views/campaigns.js` and its own detail page via the existing generic `campaignStages`/`readMilestone` machinery — no new rendering system needed if the milestone shape matches the existing contract.
- `js/cross-campaign.js` extended with the sales track and at least the "visibility growing, sales flat" insight, confidence-capped and evidence-gated like the existing two rules.
- Zero new ROAS/CPC/CPM/CPA/attribution surface anywhere.
- New i18n entries follow §8's round-trip pattern.
- `node --check` clean on every touched file; ideally verified live in a browser the way the prior session did (`js/goal-plan.js` and friends are pure functions — importable and testable directly via `await import('/js/goal-plan.js')` in a browser console without needing to log in, since Firestore reads/writes aren't required to test the plan-building math itself).
