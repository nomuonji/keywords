# On-demand market intelligence

The market-research layer is intentionally **on demand**. Nothing in this feature schedules scans or silently persists them.

## Tool roles

### `market_signal_scan`

Low-level current-signal sensor.

Sources:

- **Google Trends** — official public Trending RSS. Search intent / attention spikes.
- **TikTok Creative Center trends** — public hashtag rows when server-rendered. Social attention / content creation.
- **Hacker News** — official public Firebase API. Early-adopter attention, launches, technical/problem discussion.

Use this when you only need the current surface.

### `market_intelligence_research`

Default tool for product/marketing opportunity research.

It has two modes:

- **No query**: evidence-first broad market scan. The tool still reads broad Google Trends / TikTok Creative Center / Hacker News context, but it no longer depends on those feeds to invent a candidate market. It first runs generic site-restricted TikTok / YouTube Shorts searches such as purchase, comparison, and free-tool discovery patterns, keeps canonical public posts, preserves best-effort engagement provenance, and extracts market labels from observed titles / snippets / hashtags. Generic format labels such as `買ってよかったもの`, `おすすめ商品`, and `ランキング` are discarded because they describe a content frame rather than a market. These labels are returned in `marketDiscovery.clusters`; their order reflects observed evidence breadth and market-category specificity, not an opportunity score. When `researchGoal: "social_affiliate"` is used, validation slots are first distributed across the generic discovery seeds (purchase / comparison / free-tool) so one content format cannot monopolize all candidates, then the selected observed clusters are re-rooted as explicit market queries and passed through the normal SERP, Google Ads demand, social-content, semantic-intent, and coverage gates. Only `marketDiscovery.validatedCandidates[*].coverage.conclusionAllowed === true` may support a ranking or recommendation.
- **With query**: hypothesis-led research. Broad Google/TikTok trend headlines are not used as support for the query. Hacker News switches to relevance search, SERP related searches / People Also Ask are collected through the cached SERP layer, and Google Ads demand is fetched for the query plus intent-prioritized related search terms. The result also contains an `intentTree` so company/entity, investment, career/qualification, informational, and core problem/solution demand are not silently merged. Japanese corporate suffixes are normalized across spacing variants (for example 株式会社 / 株式 会社), and English company markers avoid incident IDs such as `INC-2026...`. App Store evidence is query-specific and is skipped when the explicit query intent is clearly non-product (for example entity, investment, news, or pure research-information intent).

It then adds:

- **TikTok Top Ads / Spotlight** — public high-performing creative evidence. Extracts visible likes, CTR percentile, budget tier and descriptive creative rationale when exposed. It classifies recurring mechanics such as comparison, social proof, problem-solution, demonstration, transformation, curiosity gap, identity/inclusion, urgency, ranking/list, spectacle and personalization.
- **Pinterest Trends public surface** — best-effort observation only. Pinterest's official Trends API is restricted, so this adapter does not emulate private APIs. If the public page exposes no machine-readable trend payload it returns a warning instead of fabricating data.
- **Apple App Store Search API** — official keyword-oriented commercialization check when `query` is supplied. Returns observed apps, price, genre, ratings/rating counts and current-version release dates.

The tool returns a `thesisFrame` rather than an automatic product recommendation. The calling agent must write the actual market thesis from the returned evidence.

Example:

```json
{
  "query": "habit tracker",
  "geo": "JP",
  "limit": 10
}
```

In query mode, the primary evidence is returned under `queryFocus`. Read `queryFocus.intentTree` before interpreting any volume:

- `searchSurface.relatedSearches`
- `searchSurface.peopleAlsoAsk`
- `searchSurface.topResults`
- `searchDemand.results`
- `intentTree.targetIntents`
- `intentTree.branches[*].role`
- `intentTree.primaryEvidenceKeywords`
- `intentTree.excludedFromPrimaryThesis`
- `intentTree.senseSelectionRequired` / `senseGuidance`
- query-relevant Hacker News observations, attached to the same intent branches
- App Store commercialization when applicable

Intent branch roles are:

- `primary` — may establish the main market thesis.
- `contextual` — may explain the market but cannot establish demand alone.
- `adjacent_market` — a distinct nearby market (for example investment or qualification demand) that must be re-rooted and validated separately.
- `out_of_scope` — normally entity/company navigation in a generic market query; preserved for provenance but excluded from the main thesis.

Never sum search volume across different intent branches as though they were one market.

When `senseSelectionRequired` is true, the phrase itself is semantically/intent-wise underspecified. No branch is promoted to primary merely because it is a generic problem/solution/commercial intent. The first packet is discovery-only: inspect the branches and their independent demand evidence, choose one sense/intent, then re-run `market_intelligence_research` with an intent-bearing query before writing a thesis. Ambiguous-root demand expansion samples across multiple intent branches rather than privileging a fixed default branch set.

App Store evidence has `evidenceScope = lexical_search_only`. It includes a bounded `descriptionExcerpt` so the agent can verify semantic fit; a matching app name alone is not commercialization proof for the selected market sense.

The expected reasoning order is:

```text
observed signals
-> underlying behavior / desire
-> current fulfillment
-> creative mechanic that triggers attention
-> independent commercialization evidence
-> adjacency dimensions
-> concept
-> disconfirming evidence / next validation
```

For concepts, explicitly classify distance from the incumbent as:

- `copy_like`
- `adjacent`
- `speculative`

Do not jump directly from a popular product or ad to a clone.

## Velocity snapshots

### `market_signal_snapshot_save`

Explicitly performs a fresh `market_intelligence_research` call and persists that packet in Firestore.

Snapshots are **never automatic**. Do not call this tool merely because research ran. Save only when the user asks to preserve a baseline or when a concrete longitudinal research objective requires one.

### `market_signal_snapshot_compare`

Compare:

- one saved snapshot with another saved snapshot, or
- one saved snapshot with a fresh live research packet.

The result includes:

- entries newly appearing on observed surfaces;
- entries no longer observed;
- same-source/same-label numeric deltas;
- relative deltas where the previous value is non-zero;
- a bounded velocity highlight list.

An entry appearing/disappearing from a ranked surface is not itself proof of demand growth/collapse. Treat velocity as a trigger for investigation.

## Evidence semantics

Never collapse the sources into one composite Opportunity Score.

| Observation | Useful as | Does not prove |
| --- | --- | --- |
| Google Trends approximate traffic | search attention / spike | purchases |
| TikTok posts/views | social creation and view attention | willingness to pay |
| TikTok Top Ads CTR percentile | cross-category creative/mechanic reference | query-specific demand, absolute conversion or product-market fit |
| HN score/comments | early-adopter attention / discussion | mass-market demand |
| Pinterest public trend evidence | aspiration/planning signal when available | purchases |
| App Store rating counts | adoption/engagement proxy | downloads, subscription revenue |
| App Store upfront price | one commercialization form | overall monetization strength |

Missing or blocked evidence stays missing. Do not infer a positive or negative result from a source that failed to return data.

## Market-thesis requirement

After `market_intelligence_research`, the agent should produce 1–3 evidence-backed theses. Each thesis should state:

1. observed behavior/desire;
2. at least two independent supporting observations when available;
3. the current way that desire is fulfilled;
4. the creative/marketing mechanic associated with attention;
5. adjacency dimensions worth testing (audience, format, context, social loop, output artifact, distribution, business model);
6. concept distance: copy-like, adjacent or speculative;
7. contrary evidence and payment unknowns;
8. the cheapest next validation.

The goal is **evidence-backed lateral marketing**, not literal market-in cloning and not unconstrained product-out ideation.

## Intent regression discipline

Intent behavior is covered by `scripts/market-intent-regression-smoke.ts` and `npm run test:market-intent`. The regression set deliberately mixes software, finance, education, creator markets, professional services, consumer needs, entities, investment terms, qualifications, and polysemous roots. Changes that broaden a keyword rule should include a negative control so a generic token does not silently start matching unrelated domains.

## Deferred sources

- **YouTube** — official Data API support is still deferred until a `YOUTUBE_API_KEY` is configured in the Keywords deployment.
- **Meta Ad Library** — general commercial-ad discovery still lacks a stable unauthenticated official machine interface suitable for this MCP contract.

RapidAPI can still be used selectively for missing fields, but it is not the primary market-sensor foundation because free tiers are too restrictive for broad scanning.


## Query-relevant social output evidence

For query-focused market research, `market_intelligence_research` can inspect real public content indexed from TikTok, YouTube Shorts, and optionally Instagram Reels. The default query-focused pass uses TikTok and YouTube Shorts.

This evidence is deliberately separated from TikTok Creative Center and Top Ads:

- indexed social results answer **what output formats actually exist around this query**;
- TikTok public-page hydration, when exposed, can add best-effort views / likes / comments / shares;
- search-engine position is not treated as native social popularity;
- missing indexed results or missing metrics mean **unavailable evidence**, never zero demand or zero engagement;
- TikTok Top Ads remains cross-category creative reference only.

Use `researchGoal: "social_affiliate"` when the task is to find affiliate markets that can also be expressed through short-form social content. The returned `coverage` object is binding for agent interpretation. If `coverage.conclusionAllowed` is false, do not rank or recommend markets until the missing required evidence is retrieved.

For query-less discovery, the same rule now applies one level earlier: `marketDiscovery.clusters` are only observed hypotheses. The server automatically validates a bounded set of top observed clusters under `social_affiliate`; candidates that fail semantic-sense selection or any required evidence class remain visible but are not eligible for recommendation. Generic discovery never treats search-engine position as native popularity and does not convert the cluster order into a composite score.

`coverage.status` has three states:

- `sufficient`: query market evidence, multiple social surfaces, and at least some engagement evidence are present;
- `partial`: enough evidence exists to form a thesis, but one or more strengthening evidence classes are unavailable;
- `insufficient`: a required class such as query market evidence, social output evidence, or semantic-sense selection is missing.

Affiliate program availability, payout, approval conditions, and conversion rules remain a separate verification step; market attention alone must not be called easy monetization.
