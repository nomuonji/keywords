# Trend article research

`trend_article_research` is the read-only MCP entry point for X/web trend editors such as Grok.

It combines:

1. a trend topic and caller-proposed query variants,
2. Google Ads historical demand,
3. a bounded, cached SERP check,
4. optional Keywords Operator site structure context,
5. literal existing-page overlap hints.

The tool deliberately does **not** publish, save Treasury rows, mutate site structure, or choose a final article automatically.

## Why zero-volume keywords are retained

Fresh X trends often appear before Google Ads has useful historical volume. The tool therefore checks positive-demand candidates first, then uses remaining SERP capacity on caller-prioritized fresh terms even when recorded volume is zero.

## Suggested Grok flow

1. Discover a coherent event/topic from X and corroborating web sources.
2. Generate 5-20 natural search queries that a user could type after seeing the event.
3. Call `trend_article_research` with `maxSerpChecks` normally between 2 and 4.
4. Compare the returned demand, SERP evidence, and `existingPageMatches`.
5. Choose one of: skip, update an existing page, or prepare a new article brief.
6. Preserve the topic, source URLs, detected time, chosen keyword set, and site/page target in the article metadata.

For production use, pass `siteConceptId` so the editor can avoid obvious duplicate coverage.
