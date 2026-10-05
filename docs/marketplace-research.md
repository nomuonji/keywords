# Marketplace research

## Purpose

Marketplace research complements Google/SERP research with evidence from platform-internal search surfaces. It is read-only and should be treated as market evidence, not as an automatic ranking or product-selection score.

The first adapter is BOOTH. The MCP entry point is `marketplace_research`.

## Architecture

Marketplace-specific fetching and parsing belongs in `packages/research/src/marketplace.ts`.

The shared contract is `MarketplaceAdapter`:

- `id`: stable marketplace identifier.
- `capabilities`: declares suggestions, result counts, product cards, likes, and supported sort modes.
- `research(input)`: returns normalized marketplace observations.

The MCP layer in `api/mcp.ts` is only an adapter. Do not put BOOTH selectors, URLs, or parsing rules in the MCP server.

To add another marketplace such as SUZURI, note, or another storefront:

1. Implement a new `MarketplaceAdapter` in the research package.
2. Normalize output to the shared result types.
3. Register the adapter in the `adapters` map.
4. Expose platform-specific sort/filter values only where they are actually supported.
5. Add one parser/contract smoke case based on stable public markup or a documented endpoint.
6. Keep crawling bounded and cache upstream observations if repeated scheduled research is added later.

The tool accepts a string `marketplace` rather than a closed MCP enum so adding a new adapter does not require changing the public input contract. Supported sources and capabilities are discoverable from `remote_keyword_status`.

## BOOTH evidence

The BOOTH adapter currently collects:

- autocomplete tag suggestions,
- total search-result count,
- related tags extracted from BOOTH's search-page description,
- observed product cards,
- price,
- shop,
- category/brand identifiers exposed by the listing,
- wish-list counts when the public BOOTH endpoint is available,
- observed shop/category concentration,
- overlap between requested sort views.

Supported BOOTH sort modes are:

- `popularity`
- `wish_lists`
- `new`

The default request uses only `popularity`. Callers may request up to three sort views when comparison is useful.

## Interpretation

Do not equate a BOOTH result count with search demand. It is a competition/supply observation.

Do not equate wish-list count with sales.

A useful workflow is:

1. Expand a seed through marketplace suggestions and related tags.
2. Compare result counts and observed seller concentration.
3. Compare popularity, wish-list, and new views when needed.
4. Join promising terms with Google Ads demand or SERP evidence.
5. Save only evidence-backed candidates through the existing treasury/theme workflow.

Avoid a composite marketplace opportunity score. Keep the underlying observations visible so the agent can explain why a candidate survives or fails.

## Operational limits

- Search pages are bounded to page 1-10.
- At most three sort views are fetched per call.
- At most 60 products are parsed per view.
- Autocomplete is one request per tool call.
- Wish-list enrichment is best-effort and does not fail the whole research call.
- Adult age-gated result pages are rejected rather than bypassed.
- Requests are restricted to BOOTH hosts and use a timeout.

If scheduled marketplace research is introduced, add caching and a conservative refresh policy before increasing request volume.
