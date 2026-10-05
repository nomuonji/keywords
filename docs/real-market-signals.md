# Real Market Signals

## Purpose

`market_signal_research` is a pre-ideation evidence tool.

It exists to stop agents from beginning market/product reasoning from model intuition alone. The tool first reads current external market surfaces and returns normalized observations. The agent may reason from those observations afterwards, but the adapter itself does not invent a product idea, opportunity score, target customer, or winner.

This is intentionally different from `marketplace_research`:

- `marketplace_research` asks what products exist inside one marketplace for a supplied query.
- `market_signal_research` can start without a query and asks what people are currently adopting, paying attention to, discussing, or launching across different real-world surfaces.

## Initial sources

### Steam

Role: consumer commercial/adoption proxy.

Discovery surfaces:

- Popular New Releases
- Global Top Sellers

Search surface:

- Steam Store keyword search

Observed evidence:

- rank in the requested view
- title and release date
- current price / discount
- public user-review totals and positive share when available

Review counts are not unit sales. Free products can also accumulate reviews. Treat them as adoption/engagement evidence.

Steam's public search pages are used for discovery. Review enrichment uses the public Steam store review response recognized by Steamworks documentation; failures are best-effort and must not fail the whole market scan.

### Apple App Store

Role: structured consumer app adoption proxy.

The official iTunes Search API provides keyword-oriented software search. Observed fields include:

- price
- rating
- rating count
- genre
- original release date
- current-version release date

Rating counts are not downloads or revenue.

The official Search API is keyword-oriented, so this adapter is intentionally skipped in queryless discover mode until a stable official chart feed is configured.

### Hacker News / Algolia

Role: current attention, problem-expression, and new-product-expression evidence.

Discovery views:

- front page
- recent Show HN
- recent Ask HN

Search views:

- relevance
- recent matching stories

Observed fields:

- points
- comment count
- date
- title/text excerpt
- linked product/page
- discussion URL

HN attention is not willingness to pay. Its purpose is to expose emerging behavior and language that can be compared against commercial surfaces.

## Research modes

### discover

No seed query is required.

Use this when the goal is to begin thinking from the market rather than from a model-generated category.

Example:

```text
market_signal_research
mode=discover
sources=[steam,hacker_news]
steamView=popular_new
hnWindowDays=30
```

The expected reasoning loop is:

```text
current observations
  -> repeated behavior/desire
  -> adjacent manifestations
  -> candidate concept
  -> additional falsification
```

Do not jump directly from one observed product to a clone.

### search

A query is required.

Use it to inspect whether one behavior/desire appears across multiple surfaces.

Example:

```text
market_signal_research
mode=search
query=habit tracker
sources=[steam,app_store,hacker_news]
includeGoogleDemand=true
```

When `includeGoogleDemand=true`, the MCP layer also attaches the existing Google Ads historical demand result for the exact query. Language/geography must be supplied when the default is inappropriate.

## Evidence semantics

Keep the signals separate.

| Source | Signal | It does not prove |
| --- | --- | --- |
| Steam | adoption/commercial proxy | unit sales or revenue |
| App Store | adoption/commercial proxy | downloads or subscription revenue |
| Hacker News | attention/problem expression | willingness to pay |
| Google Ads (optional) | search demand | product-market fit |

There is deliberately no composite opportunity score.

A strong research thesis should explain how multiple independent observations point to the same human behavior/desire, where they disagree, what is still unknown, and what observation would falsify the thesis.

## Source selection policy

A source is suitable for direct integration when it has all or most of:

1. current market/user activity rather than static advice;
2. stable public or official read access;
3. structured fields that an agent can compare without visual guessing;
4. clear semantics for what the observed metric actually means;
5. bounded requests that can run safely from scheduled/interactive research.

Sources deliberately not included in v1:

- Product Hunt: public API requires authentication and its documentation says commercial use requires permission.
- itch.io: useful for publishing/prototyping but public discovery is primarily HTML browsing, and it was not selected as the primary evidence source for this problem.
- Shopify App Store: commercially valuable and merchant reviews are strong evidence, but v1 avoids depending on a brittle search-page HTML parser. It is a candidate for a later adapter after a stable ingestion contract is verified.
- Reddit: valuable qualitative evidence, but direct unauthenticated API assumptions are intentionally avoided.

## Safety / operational bounds

- read-only external requests;
- 12 second timeout per request;
- fixed allow-listed hosts;
- at most 20 observations per view;
- Steam review enrichment is bounded to the returned Steam observations;
- source failures become warnings so one blocked surface does not erase other evidence;
- no external source data is persisted by this research adapter.

Persistence, if desired, should go through existing research/theme command models so evidence and later agent judgment remain separate.
