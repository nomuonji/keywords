# Market Discovery MVP (2026-10-14)

## Purpose
Explore real market categories without letting an LLM select only familiar niches. This is an observation system, not an automated product recommendation or sales forecast.

## Architecture
- Source: Rakuten Web Service official Genre Search (2026-07-01) and Ichiba Ranking (2022-06-01). The existing private `nomuonji/api` Vercel project proxies actions `rakuten-ichiba/genres` and `rakuten-ichiba/ranking`, plus the read-only MCP interface, with existing credentials unchanged.
- Selection: `scripts/market-discovery.mjs` visits six least-observed root genres, two least-recently-observed root genres, and two specific previous genres. Date-hash resolves ties, independently of model text. It reads up to 15 ranked products in each category and never uses a creative AI seed.
- Schedule: `.github/workflows/market-discovery.yml`, daily 04:47 JST, plus manual workflow dispatch. It runs a mock-source smoke test before live sampling. It does not use Firestore or SEO worker queues.
- Durable observations: public `market-data` branch, `data/latest.json`. Maintains up to 90 days of rank observations containing genre IDs/names, item codes and ranks, not product titles, prices, images, descriptions, affiliate links or buyer attributes.
- UI: Keywords web app `?view=market`, fetches the derived snapshot and loads live item titles/links only when an operator opens a category. The data branch is not a deployment target according to `vercel.json`.

## Evidence policy
Ranking position != disclosed sales quantity. Same-item overlap on subsequent observations shows repeated rank presence, not conversion. It does not prove an individual's consumption motivation. No automatic offer publication, A8 approval mutations, Tweets Operator changes, nor promotion to the Free Consult sellable catalog. Validate downstream with reviews, search demand and actual affiliate outcomes.

## Reliability
- If root genres are unavailable or zero categories succeed, stop with nonzero exit and preserve previous snapshot.
- HTTP 429, upstream quota and authorization errors stop additional requests.
- Upstream category 404 and missing ranking are recorded as incomplete, not as zero sales.
- Read paths validate numeric genre IDs, bound ranking count and return only minimal projections. CDN caching reduces duplicate calls.
- Default history uses rolling 90-day values; it must not be treated as a permanent archival rights grant. Persisting product identifiers only instead of product text limits stored third-party material.
- GitHub Actions repository policy must allow `GITHUB_TOKEN` contents write. If the first run cannot push `market-data`, adjust repository Actions permissions explicitly instead of silently treating the workflow as operational.
- Runtime acceptance criteria: first workflow run passes smoke, fetches 10 categories (or reports partial outcomes), pushes `market-data`, and UI reads and opens live products. Until then the UI explicitly reports that observations are pending.

## Official API / rights
- https://webservice.rakuten.co.jp/documentation/ichiba-genre-search
- https://webservice.rakuten.co.jp/documentation/ichiba-item-ranking
- https://webservice.faq.rakuten.net/hc/ja/articles/900001974343

## Next stage (not implemented)
Evidence-backed consumer motives: source URLs and timestamps from actual reviews/questions; validate hypotheses independently. Only then evaluate products in `nomuonji/free-consult-blog:data/sellable-catalog.json` with its existing publication gates. Avoid automatic psychographic classification from rank alone.
