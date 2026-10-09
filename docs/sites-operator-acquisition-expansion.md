# Sites Operator: organic Search managerから獲得・流通まで伸ばすための拡張仕様（未実装）

Status: **partially implemented** · 2026-10-09. First-party control-plane API (candidate/approval/verified site launch + experiment receipts) is implemented in Sites Operator 0.22.0; autonomous multi-channel publishing and attributable analytics are not enabled.
Owner decision required before changing the Macro Policy objective or enabling any external publishing.

## Background: what the live system actually does

The scheduled `Site SEO Task Planner` is the **single** active SEO Manager. It follows `seo_agent_context(role=planner)`, active `seo_portfolio_policy_get` and [sites-operator-planner-manual.md](./sites-operator-planner-manual.md). The configured objective is `gsc_clicks`; implementation is delegated to the existing Site SEO Worker, not a second planner. Current task types are `revise`, `merge`, `delete`, `internal_links`, `technical`, `new_article`, `site_expansion`, `data_expansion`, `schema_expansion`.

This provides credible site improvements but **not** a native marketing funnel. `seo_task_create` cannot own a social creative or referral campaign. GA4/GSC compact digests are SEO analytics, not attribution of campaign distribution. Closing a PR is not a visitor. Examples from connected live evidence:

| Existing observation | What it means | What it cannot prove |
| --- | --- | --- |
| Job World GSC prior 28d 441 impressions/4 clicks, current 28d 6 impressions/0 clicks (through Oct 5) | Search exposure declined sharply | The Oct 9 redesign caused or fixed this |
| Book Discovery 414→14 impressions, 9→0 clicks | Search exposure declined sharply | All records are deindexed, or social distribution is impossible |
| Yohaku 16→4 impressions, 0→0 clicks | Weak visible Search acquisition | New brand art alone can bring visitors |
| Completed AWS hub Task with failed Pages deployment verification | Code merged ≠ live published artifact | Search experiment has begun |
| Job World optimization event collection mostly proposed/implemented | Early-stage feedback records exist | 14/28d outcome can already be evaluated |

URL Inspection's incorrect slashless-target baseline was reconciled; later canonical inspections were blocked by missing credentials. Inadequate inspection coverage must stay unknown.

## Goal

Optimize for **incremental qualified visits and repeat use**, with measured Search as one channel. Preserve the value of sources and genuine editorial style. Do not overgrow weak article inventory, spam social communities, rebrand sites automatically, or imply paid growth resources.

The correct operating unit is a **Growth Initiative** (a falsifiable site-level visitor-acquisition thesis), not an endless succession of independent `revise` tasks.

### The five-stage loop

1. **Diagnose:** complete site-/landing-/channel-level baselines, indexability samples, and source quality. Identify the bottleneck: not indexed, no impressions, poor CTR, no distribution, weak landing value, weak return usage. Missing metrics cannot become zeros.
2. **Choose a bet:** real audience/job-to-be-done, existing public signal, unique data/product affordance, why one would discover/share it, expected benefits and contradiction tests. Compare with doing nothing and using existing assets.
3. **Build an actual instrument:** at most one coherent first-party feature or landing experience, plus reusable short description, optional social visual, source/brand checks and analytics events. One owner and one rollback boundary. A first-party `site_expansion` SEO task is permitted only when it honestly satisfies the existing Search objective.
4. **Distribute:** explicit channel/account/format/cadence, one destination URL and UTM, creative ID, spam/rights/privacy safety gates, actual publish receipt and observed impressions/referrals. No inferred posting from draft creation and no blanket cross-posting.
5. **Evaluate and reallocate:** Search exposure, non-Search referrals, landing conversions/engagement and repeat visits, along with cost/uncertainty and counterfactual limitations. Stop/modify/expand, preserving losing experiments and next challenge.

## Additive control-plane entities (proposed)

Do **not** overload `seoTasks` or recycle `optimizationEvents` under misleading names. Keep their existing meaning and the old API working.

```ts
type GrowthInitiative = {
  id: string; siteId: string; revision: number;
  hypothesis: string; audience: string; userJob: string;
  assetUrl?: string; sourceObservations: Array<{url:string; observedAt:string; finding:string}>;
  program: "search_recovery"|"organic_product"|"distribution"|"retention";
  status: "researching"|"candidate"|"approved"|"building"|"live"|"evaluating"|"stopped";
  objectiveMetric: "gsc_clicks"|"organic_sessions"|"referral_sessions"|"engaged_sessions"|"returning_users";
  baseline: {start:string;end:string;completeness:"complete"|"partial"|"missing";value?:number};
  plannedReviewDays: number[]; ownerRole: string;
  taskIds: string[]; directionId?: string; rollback: string;
  falsification: string; guardrails: string[];
};
type DistributionExperiment = {
  id: string; initiativeId: string; siteId: string;
  channel: "x"|"threads"|"youtube_shorts"|"github"|"other";
  accountRef?: string; sourceAssetRef: string; targetUrl: string;
  utmCampaign: string; creativeVariant: string;
  state: "idea"|"ready"|"published"|"observed"|"abandoned";
  publishReceipt?: {platformPostUrl:string; publishedAt:string};
  metrics?: {impressions?:number;outboundClicks?:number;referralSessions?:number;recordedAt:string};
};
```

All externally facing actions must use a connector that is explicitly authenticated/authorized for that action; unsupported channels stay `ready`/`unknown` without inventing results. Source URLs and exact time windows are mandatory for observed figures. New events and connectors may be added later; do not require costly APIs to begin.

### Delivery contracts

- Search SEO Task -> existing Site SEO Worker -> GitHub PR+CI+main -> actual Cloudflare/external host deployment verification -> Search follow-up.
- First-party growth asset -> existing site Worker where capability permits; otherwise a separately approved worker contract; proof is source URL/PR/production readback.
- Distribution -> existing Tweets Operator **only for an account/content type explicitly approved in its current settings**; other platforms require actual tools, not hypothetical calls. Creative approval and cadence guardrails are first-class. Never convert an SEO Task into a social-publish request.
- Metrics -> GSC/GA4 snapshots with channel/referral and UTM dimensions where reliable, social-native published-post metrics with real IDs, differentiated `not_measured` from `zero`.

### Product interface

Site Monitor is a human-facing dashboard, never a planning source. Expose an **Initiatives** view tied to the canonical Sites Operator campaign records: search health, current bottleneck, hypothesis, asset, delivery, first distribution, baseline/due review, evidence and observed growth. Useful KPI: *initiatives reaching a verified live user-facing asset and a real evaluation*, **not** completed Task count.

### Governance and backward compatibility

1. Owner chooses whether to broaden the Macro Policy objective beyond `gsc_clicks`; never let recurring Manager mutate it autonomously.
2. Retain the 40/40/20 SEO allocation as long as currently active, not as a hardcoded rule. New growth allocation must be versioned separately or added with migration and owner acceptance, rather than quietly spending search-only budgets on social work.
3. Respect all existing decided Site Directions, including each site's audience/content boundaries. Strategic shifts, large indexability changes and cross-brand rewrites continue to require human decisions.
4. Roll out initially on two independent pilots with genuine existing assets (Job World graph-based 2-hop share object; Yohaku privacy-first household scenario utility, for example), rather than dispatching identical social schedules to every site.
5. Recheck at 14 and 28 days **from verified publication or campaign launch**, not PR merge. Missing observed referrals should trigger diagnostics, not fabricated success.
6. Rollback to the original SEO-only workflow must not invalidate existing SEO Tasks, delivery receipts or optimization history.

## Implementation order / objective acceptance

- **Phase A — active now:** strengthen Search acquisition review and rollout/outcome gates in the Planner Manual and its scheduled Manager prompt, within the existing owner-approved SEO policy. No API/scope change.
- **Phase B — API implemented (behind existing MCP authentication):** growth_initiative_create/get/list/update and distribution_experiment_create/get/list/update use versioned Firestore records, site isolation, audit trail, dedupe, approval/launch/receipt gates and an offline smoke suite. **Still open:** a first-party dashboard and policy-driven automatic portfolio investment. Do not confuse API availability with permission to publish. State tests: no status `live` without actual asset publication, no `published` without receipt, missing measurement not zero, no cross-site attribution.
- **Phase C — not implemented: requires approved publisher auth and safe contracts:** experiment publisher bridge, idempotency, account approval/anti-spam, analytics attribution, feedback-driven reallocation. Test one bounded channel-specific real asset end to end.
- **Exit criterion:** at least one initiative can be observed as source-grounded hypothesis -> built live asset -> real publication -> measured site visit/funnel -> keep/adjust/stop decision, without manual chat memory, fake SEO tasks or phantom outcomes. The operator must demonstrate this before claiming it is a complete marketing system.
